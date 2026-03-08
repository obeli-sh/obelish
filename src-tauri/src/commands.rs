use crate::error::BackendError;
use crate::metadata::git::{create_worktree, list_worktrees, RealCommandRunner};
use crate::notifications::store::NotificationStore;
use crate::persistence::session::SessionManager;
use crate::project::ProjectStore;
use crate::pty::backend::{RealPtyBackend, ShellInfo};
use crate::pty::emitter::TauriEventEmitter;
use crate::pty::types::{PtyConfig, PtySpawnResult};
use crate::pty::PtyManager;
use crate::scrollback::ScrollbackStorage;
use crate::settings::manager::SettingsManager;
use crate::settings::Settings;
use crate::workspace::state::PaneDropPosition;
use crate::workspace::WorkspaceState;
use base64::Engine as _;
use obelisk_protocol::{
    LayoutNode, Notification, ProjectInfo, SplitDirection, WorkspaceInfo, WorktreeInfo,
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::Instant;
use tauri::{AppHandle, Emitter, State};

pub struct AppState {
    pub pty_manager: PtyManager,
    pub workspace_state: Arc<RwLock<WorkspaceState>>,
    pub session_manager: Arc<SessionManager>,
    pub scrollback_storage: ScrollbackStorage,
    pub notification_store: Arc<RwLock<NotificationStore>>,
    pub settings_manager: SettingsManager,
    pub project_store: Arc<RwLock<ProjectStore>>,
    pub server_start_time: Instant,
    pub ipc_socket_path: Option<PathBuf>,
    #[cfg(unix)]
    pub ipc_server: std::sync::Mutex<Option<crate::ipc_server::IpcServer>>,
}

impl AppState {
    pub fn new(
        session_manager: SessionManager,
        scrollback_storage: ScrollbackStorage,
        settings_manager: SettingsManager,
        ipc_socket_path: Option<PathBuf>,
        project_store: ProjectStore,
    ) -> Self {
        Self {
            pty_manager: PtyManager::new(Arc::new(crate::pty::backend::RealPtyBackend::new())),
            workspace_state: Arc::new(RwLock::new(WorkspaceState::new())),
            session_manager: Arc::new(session_manager),
            scrollback_storage,
            notification_store: Arc::new(RwLock::new(NotificationStore::new(1000))),
            project_store: Arc::new(RwLock::new(project_store)),
            settings_manager,
            server_start_time: Instant::now(),
            ipc_socket_path,
            #[cfg(unix)]
            ipc_server: std::sync::Mutex::new(None),
        }
    }
}

#[cfg(unix)]
#[derive(Clone)]
pub struct IpcAppContext {
    pub workspace_state: Arc<RwLock<WorkspaceState>>,
    pub notification_store: Arc<RwLock<NotificationStore>>,
    pub session_manager: Arc<SessionManager>,
    pub server_start_time: Instant,
    pub ipc_socket_path: PathBuf,
}

#[cfg(unix)]
impl IpcAppContext {
    pub fn from_app_state(state: &AppState, socket_path: PathBuf) -> Self {
        Self {
            workspace_state: state.workspace_state.clone(),
            notification_store: state.notification_store.clone(),
            session_manager: state.session_manager.clone(),
            server_start_time: state.server_start_time,
            ipc_socket_path: socket_path,
        }
    }
}

fn resolve_default_shell_with_available(
    default_shell: &str,
    available_shells: &[ShellInfo],
) -> Option<String> {
    let shell = default_shell.trim();
    if shell.is_empty() {
        return None;
    }
    if available_shells
        .iter()
        .any(|candidate| candidate.path == shell)
    {
        Some(shell.to_string())
    } else {
        None
    }
}

fn resolve_default_shell(settings_manager: &SettingsManager) -> Option<String> {
    let configured_default_shell = settings_manager.get().default_shell;
    let available_shells = RealPtyBackend::enumerate_shells();
    let resolved =
        resolve_default_shell_with_available(&configured_default_shell, &available_shells);
    if !configured_default_shell.trim().is_empty() && resolved.is_none() {
        tracing::warn!(
            "Configured default shell '{}' is unavailable; falling back to system default shell",
            configured_default_shell
        );
    }
    resolved
}

#[cfg(unix)]
impl crate::ipc_server::IpcContext for IpcAppContext {
    fn workspace_state(&self) -> &Arc<RwLock<WorkspaceState>> {
        &self.workspace_state
    }
    fn notification_store(&self) -> &Arc<RwLock<NotificationStore>> {
        &self.notification_store
    }
    fn session_manager(&self) -> &SessionManager {
        &self.session_manager
    }
    fn server_start_time(&self) -> Instant {
        self.server_start_time
    }
    fn socket_path(&self) -> &std::path::Path {
        &self.ipc_socket_path
    }
}

#[tauri::command]
#[tracing::instrument(skip(state, app))]
pub fn pty_spawn(
    state: State<'_, AppState>,
    app: AppHandle,
    shell: Option<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
    rows: Option<u16>,
    cols: Option<u16>,
) -> Result<PtySpawnResult, BackendError> {
    let config = PtyConfig {
        shell,
        cwd,
        env,
        rows,
        cols,
    };
    let emitter = Arc::new(TauriEventEmitter::new(app));
    let pty_id = state.pty_manager.spawn(config, emitter)?;
    Ok(PtySpawnResult { pty_id })
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub fn pty_write(
    state: State<'_, AppState>,
    pty_id: String,
    data: String,
) -> Result<(), BackendError> {
    state.pty_manager.write(&pty_id, &data)?;
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub fn pty_resize(
    state: State<'_, AppState>,
    pty_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), BackendError> {
    state.pty_manager.resize(&pty_id, cols, rows)?;
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub fn pty_kill(state: State<'_, AppState>, pty_id: String) -> Result<(), BackendError> {
    state.pty_manager.kill(&pty_id)?;
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip(state, app))]
pub fn workspace_create(
    state: State<'_, AppState>,
    app: AppHandle,
    project_id: String,
    worktree_path: String,
    name: Option<String>,
    shell: Option<String>,
) -> Result<WorkspaceInfo, BackendError> {
    let pane_id = uuid::Uuid::new_v4().to_string();

    let shell = shell.or_else(|| resolve_default_shell(&state.settings_manager));
    let config = PtyConfig {
        shell,
        cwd: Some(worktree_path.clone()),
        env: None,
        rows: None,
        cols: None,
    };
    let emitter = Arc::new(TauriEventEmitter::new(app.clone()));
    let pty_id = state.pty_manager.spawn(config, emitter)?;

    let branch_name = {
        let runner = crate::metadata::git::RealCommandRunner;
        crate::metadata::git::get_git_info(&runner, &worktree_path).and_then(|info| info.branch)
    };

    let is_root_worktree = true; // Will be refined when ProjectStore exists

    let ws_name = name.unwrap_or_else(|| {
        branch_name.clone().unwrap_or_else(|| {
            std::path::Path::new(&worktree_path)
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_else(|| "Workspace".to_string())
        })
    });

    let mut ws = state
        .workspace_state
        .write()
        .expect("workspace state lock poisoned");
    let workspace = ws.create_workspace(
        ws_name,
        pane_id,
        pty_id,
        project_id,
        worktree_path.clone(),
        branch_name,
        is_root_worktree,
    );

    state.session_manager.mark_dirty();

    let _ = app.emit(
        "workspace-changed",
        serde_json::json!({ "workspaceId": workspace.id, "workspace": workspace }),
    );

    Ok(workspace)
}

#[tauri::command]
#[tracing::instrument(skip(state, app))]
pub fn workspace_close(
    state: State<'_, AppState>,
    app: AppHandle,
    workspace_id: String,
) -> Result<(), BackendError> {
    // Collect pane IDs before closing for scrollback cleanup
    let pane_ids = {
        let ws = state
            .workspace_state
            .read()
            .expect("workspace state lock poisoned");
        if let Some(workspace) = ws.get_workspace(&workspace_id) {
            let mut ids = Vec::new();
            for surface in &workspace.surfaces {
                collect_layout_pane_ids(&surface.layout, &mut ids);
            }
            ids
        } else {
            Vec::new()
        }
    };

    let pty_ids = {
        let mut ws = state
            .workspace_state
            .write()
            .expect("workspace state lock poisoned");
        ws.close_workspace(&workspace_id)?
    };

    // Emit event BEFORE PTY cleanup so the frontend gets the state update
    // immediately. PTY kills can block on Windows (ConPTY pipe drain) and
    // would otherwise delay the IPC response, freezing the UI.
    state.session_manager.mark_dirty();

    let _ = app.emit(
        "workspace-removed",
        serde_json::json!({ "workspaceId": workspace_id }),
    );

    // PTY cleanup after event emission — no longer blocks the UI
    for pty_id in pty_ids {
        if !pty_id.is_empty() {
            let _ = state.pty_manager.kill(&pty_id);
        }
    }

    for pane_id in &pane_ids {
        if let Err(e) = state.scrollback_storage.delete(pane_id) {
            tracing::warn!("Failed to delete scrollback for pane {pane_id}: {e}");
        }
    }

    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip(state, app))]
pub fn workspace_rename(
    state: State<'_, AppState>,
    app: AppHandle,
    workspace_id: String,
    new_name: String,
) -> Result<WorkspaceInfo, BackendError> {
    let mut ws = state
        .workspace_state
        .write()
        .expect("workspace state lock poisoned");
    let workspace = ws.rename_workspace(&workspace_id, new_name)?;
    state.session_manager.mark_dirty();
    let _ = app.emit(
        "workspace-changed",
        serde_json::json!({ "workspaceId": workspace.id, "workspace": workspace }),
    );
    Ok(workspace)
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub fn workspace_list(state: State<'_, AppState>) -> Result<Vec<WorkspaceInfo>, BackendError> {
    let ws = state
        .workspace_state
        .read()
        .expect("workspace state lock poisoned");
    Ok(ws.list_workspaces().to_vec())
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub fn workspace_reorder(
    state: State<'_, AppState>,
    workspace_ids: Vec<String>,
) -> Result<(), BackendError> {
    let mut ws = state
        .workspace_state
        .write()
        .expect("workspace state lock poisoned");
    ws.reorder_workspaces(&workspace_ids)?;
    state.session_manager.mark_dirty();
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip(state, app))]
pub fn pane_split(
    state: State<'_, AppState>,
    app: AppHandle,
    pane_id: String,
    direction: SplitDirection,
    shell: Option<String>,
) -> Result<WorkspaceInfo, BackendError> {
    let new_pane_id = uuid::Uuid::new_v4().to_string();

    let worktree_cwd = {
        let ws = state
            .workspace_state
            .read()
            .expect("workspace state lock poisoned");
        ws.find_workspace_by_pane(&pane_id)
            .map(|w| w.worktree_path.clone())
            .filter(|p| !p.is_empty())
    };

    let shell = shell.or_else(|| resolve_default_shell(&state.settings_manager));
    let config = PtyConfig {
        shell,
        cwd: worktree_cwd,
        env: None,
        rows: None,
        cols: None,
    };
    let emitter = Arc::new(TauriEventEmitter::new(app.clone()));
    let new_pty_id = state.pty_manager.spawn(config, emitter)?;

    let mut ws = state
        .workspace_state
        .write()
        .expect("workspace state lock poisoned");
    let result = ws.split_pane(&pane_id, direction, new_pane_id, new_pty_id.clone());

    if result.is_err() {
        drop(ws);
        let _ = state.pty_manager.kill(&new_pty_id);
    }
    let result = result?;

    state.session_manager.mark_dirty();

    let _ = app.emit(
        "workspace-changed",
        serde_json::json!({ "workspaceId": result.workspace.id, "workspace": result.workspace }),
    );

    Ok(result.workspace)
}

#[tauri::command]
#[tracing::instrument(skip(state, app))]
pub fn pane_open_browser(
    state: State<'_, AppState>,
    app: AppHandle,
    pane_id: String,
    url: String,
    direction: SplitDirection,
) -> Result<WorkspaceInfo, BackendError> {
    let new_pane_id = uuid::Uuid::new_v4().to_string();

    let mut ws = state
        .workspace_state
        .write()
        .expect("workspace state lock poisoned");
    let result = ws.open_browser_pane(&pane_id, direction, new_pane_id, url)?;

    state.session_manager.mark_dirty();

    let _ = app.emit(
        "workspace-changed",
        serde_json::json!({ "workspaceId": result.workspace.id, "workspace": result.workspace }),
    );

    Ok(result.workspace)
}

#[tauri::command]
#[tracing::instrument(skip(state, app))]
pub fn pane_swap(
    state: State<'_, AppState>,
    app: AppHandle,
    pane_id: String,
    target_pane_id: String,
) -> Result<WorkspaceInfo, BackendError> {
    let workspace = {
        let mut ws = state
            .workspace_state
            .write()
            .expect("workspace state lock poisoned");
        ws.swap_panes(&pane_id, &target_pane_id)?
    };

    state.session_manager.mark_dirty();

    let _ = app.emit(
        "workspace-changed",
        serde_json::json!({ "workspaceId": workspace.id, "workspace": workspace }),
    );

    Ok(workspace)
}

fn move_pane_with_side_effects<F>(
    workspace_state: &Arc<RwLock<WorkspaceState>>,
    session_manager: &SessionManager,
    pane_id: &str,
    target_pane_id: &str,
    position: PaneDropPosition,
    mut emit_workspace_changed: F,
) -> Result<WorkspaceInfo, BackendError>
where
    F: FnMut(&WorkspaceInfo),
{
    let workspace = {
        let mut ws = workspace_state
            .write()
            .expect("workspace state lock poisoned");
        ws.move_pane(pane_id, target_pane_id, position)?
    };

    session_manager.mark_dirty();
    emit_workspace_changed(&workspace);

    Ok(workspace)
}

#[tauri::command]
#[tracing::instrument(skip(state, app))]
pub fn pane_move(
    state: State<'_, AppState>,
    app: AppHandle,
    pane_id: String,
    target_pane_id: String,
    position: PaneDropPosition,
) -> Result<WorkspaceInfo, BackendError> {
    move_pane_with_side_effects(
        &state.workspace_state,
        &state.session_manager,
        &pane_id,
        &target_pane_id,
        position,
        |workspace| {
            let _ = app.emit(
                "workspace-changed",
                serde_json::json!({ "workspaceId": workspace.id, "workspace": workspace }),
            );
        },
    )
}

#[tauri::command]
#[tracing::instrument(skip(state, app))]
pub fn pane_close(
    state: State<'_, AppState>,
    app: AppHandle,
    pane_id: String,
) -> Result<(), BackendError> {
    let result = {
        let mut ws = state
            .workspace_state
            .write()
            .expect("workspace state lock poisoned");
        ws.close_pane(&pane_id)?
    };

    // Emit events BEFORE PTY cleanup so the frontend gets the state update
    // immediately. PTY kill can block on Windows (ConPTY pipe drain) and
    // would otherwise delay the IPC response, freezing the UI.
    state.session_manager.mark_dirty();

    if let Some(workspace) = &result.workspace {
        let _ = app.emit(
            "workspace-changed",
            serde_json::json!({ "workspaceId": workspace.id, "workspace": workspace }),
        );
    } else if let Some(closed_id) = &result.closed_workspace_id {
        let _ = app.emit(
            "workspace-removed",
            serde_json::json!({ "workspaceId": closed_id }),
        );
    }

    // PTY cleanup after event emission — no longer blocks the UI
    if !result.pty_id.is_empty() {
        let _ = state.pty_manager.kill(&result.pty_id);
    }

    if let Err(e) = state.scrollback_storage.delete(&pane_id) {
        tracing::warn!("Failed to delete scrollback for pane {pane_id}: {e}");
    }

    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub fn session_save(state: State<'_, AppState>) -> Result<(), BackendError> {
    let ws = state
        .workspace_state
        .read()
        .expect("workspace state lock poisoned");
    state.session_manager.save(&ws)?;
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip(state, app))]
pub fn session_restore(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<WorkspaceInfo>, BackendError> {
    // Check for unclean shutdown
    let was_clean = state
        .session_manager
        .check_clean_shutdown()
        .unwrap_or(false);
    if !was_clean {
        tracing::warn!("Detected unclean shutdown, attempting to restore from last save");
    }

    // Delete the clean shutdown marker (will be written on next clean shutdown)
    let _ = state.session_manager.delete_clean_shutdown_marker();

    // Try to load saved state
    let session = match state.session_manager.load() {
        Ok(Some(session)) => session,
        Ok(None) => {
            tracing::info!("No saved session found, creating default workspace");
            return create_default_workspace(&state, &app);
        }
        Err(e) => {
            tracing::warn!("Failed to load session state: {e}, creating default workspace");
            return create_default_workspace(&state, &app);
        }
    };

    // Restore workspace state
    let mut ws = state
        .workspace_state
        .write()
        .expect("workspace state lock poisoned");
    *ws = WorkspaceState::from_session_state(session.clone());

    // Build pane -> worktree_path lookup from workspace layouts
    let pane_worktree_map: HashMap<String, String> = {
        let mut map = HashMap::new();
        for workspace in &session.workspaces {
            if workspace.worktree_path.is_empty() {
                continue;
            }
            for surface in &workspace.surfaces {
                collect_layout_pane_ids_to_map(&surface.layout, &workspace.worktree_path, &mut map);
            }
        }
        map
    };

    // Spawn PTYs for each pane (skip browser panes which don't need PTYs)
    for pane in session.panes.values() {
        if matches!(pane.pane_type, obelisk_protocol::PaneType::Browser) {
            continue;
        }

        let cwd = pane_worktree_map
            .get(&pane.id)
            .filter(|p| !p.is_empty() && std::path::Path::new(p).exists())
            .cloned()
            .or_else(|| {
                pane.cwd.as_deref().and_then(|c| {
                    if std::path::Path::new(c).exists() {
                        Some(c.to_string())
                    } else {
                        tracing::warn!("Saved cwd {c} no longer exists, using default");
                        None
                    }
                })
            });

        let shell = resolve_default_shell(&state.settings_manager);
        let config = PtyConfig {
            shell,
            cwd,
            env: None,
            rows: None,
            cols: None,
        };
        let emitter = Arc::new(TauriEventEmitter::new(app.clone()));
        match state.pty_manager.spawn(config, emitter) {
            Ok(new_pty_id) => {
                // Update the pane's pty_id to the newly spawned PTY
                ws.update_pane_pty(&pane.id, new_pty_id);
            }
            Err(e) => {
                tracing::error!("Failed to spawn PTY for pane {}: {e}", pane.id);
                // Clear the stale pty_id so the frontend knows this pane is broken
                ws.update_pane_pty(&pane.id, String::new());
            }
        }
    }

    let workspaces = ws.list_workspaces().to_vec();

    // Emit workspace-changed for each restored workspace
    for workspace in &workspaces {
        let _ = app.emit(
            "workspace-changed",
            serde_json::json!({ "workspaceId": workspace.id, "workspace": workspace }),
        );
    }

    Ok(workspaces)
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub fn scrollback_save(
    state: State<'_, AppState>,
    pane_id: String,
    data: String,
) -> Result<(), BackendError> {
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&data)
        .map_err(|e| crate::error::PersistenceError::Corrupted {
            reason: format!("invalid base64: {e}"),
        })?;
    state.scrollback_storage.save(&pane_id, &bytes)?;
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub fn scrollback_load(
    state: State<'_, AppState>,
    pane_id: String,
) -> Result<Option<String>, BackendError> {
    match state.scrollback_storage.load(&pane_id)? {
        Some(bytes) => Ok(Some(
            base64::engine::general_purpose::STANDARD.encode(&bytes),
        )),
        None => Ok(None),
    }
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub fn notification_list(state: State<'_, AppState>) -> Result<Vec<Notification>, BackendError> {
    let store = state
        .notification_store
        .read()
        .expect("notification store lock poisoned");
    Ok(store.list().to_vec())
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub fn notification_mark_read(state: State<'_, AppState>, id: String) -> Result<(), BackendError> {
    let mut store = state
        .notification_store
        .write()
        .expect("notification store lock poisoned");
    store.mark_read(&id);
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub fn notification_clear(state: State<'_, AppState>) -> Result<(), BackendError> {
    let mut store = state
        .notification_store
        .write()
        .expect("notification store lock poisoned");
    store.clear();
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub fn settings_get(state: State<'_, AppState>) -> Result<Settings, BackendError> {
    Ok(state.settings_manager.get())
}

#[tauri::command]
#[tracing::instrument(skip(state, app))]
pub fn settings_update(
    state: State<'_, AppState>,
    app: AppHandle,
    key: String,
    value: serde_json::Value,
) -> Result<(), BackendError> {
    state.settings_manager.update(&key, value)?;
    let _ = app.emit("settings-changed", state.settings_manager.get());
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip(state, app))]
pub fn settings_reset(state: State<'_, AppState>, app: AppHandle) -> Result<(), BackendError> {
    state.settings_manager.reset()?;
    let _ = app.emit("settings-changed", state.settings_manager.get());
    Ok(())
}

fn collect_layout_pane_ids(layout: &LayoutNode, ids: &mut Vec<String>) {
    match layout {
        LayoutNode::Leaf { pane_id, .. } => ids.push(pane_id.clone()),
        LayoutNode::Split { children, .. } => {
            collect_layout_pane_ids(&children[0], ids);
            collect_layout_pane_ids(&children[1], ids);
        }
    }
}

fn collect_layout_pane_ids_to_map(
    layout: &LayoutNode,
    worktree_path: &str,
    map: &mut HashMap<String, String>,
) {
    match layout {
        LayoutNode::Leaf { pane_id, .. } => {
            map.insert(pane_id.clone(), worktree_path.to_string());
        }
        LayoutNode::Split { children, .. } => {
            collect_layout_pane_ids_to_map(&children[0], worktree_path, map);
            collect_layout_pane_ids_to_map(&children[1], worktree_path, map);
        }
    }
}

#[tauri::command]
pub fn shell_list() -> Vec<ShellInfo> {
    RealPtyBackend::enumerate_shells()
}

fn create_default_workspace(
    state: &State<'_, AppState>,
    app: &AppHandle,
) -> Result<Vec<WorkspaceInfo>, BackendError> {
    let pane_id = uuid::Uuid::new_v4().to_string();
    let shell = resolve_default_shell(&state.settings_manager);
    let config = PtyConfig {
        shell,
        cwd: None,
        env: None,
        rows: None,
        cols: None,
    };
    let emitter = Arc::new(TauriEventEmitter::new(app.clone()));
    let pty_id = state.pty_manager.spawn(config, emitter)?;

    let mut ws = state
        .workspace_state
        .write()
        .expect("workspace state lock poisoned");
    let workspace = ws.create_workspace(
        "Workspace 1".to_string(),
        pane_id,
        pty_id,
        String::new(), // project_id
        String::new(), // worktree_path
        None,          // branch_name
        false,         // is_root_worktree
    );

    let _ = app.emit(
        "workspace-changed",
        serde_json::json!({ "workspaceId": workspace.id, "workspace": workspace }),
    );

    Ok(vec![workspace])
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub fn project_list(state: State<'_, AppState>) -> Result<Vec<ProjectInfo>, BackendError> {
    let store = state
        .project_store
        .read()
        .expect("project store lock poisoned");
    Ok(store.list().to_vec())
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub fn project_add(
    state: State<'_, AppState>,
    root_path: String,
) -> Result<ProjectInfo, BackendError> {
    let mut store = state
        .project_store
        .write()
        .expect("project store lock poisoned");
    let project = store.add(root_path)?;
    Ok(project)
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub fn project_remove(state: State<'_, AppState>, project_id: String) -> Result<(), BackendError> {
    let mut store = state
        .project_store
        .write()
        .expect("project store lock poisoned");
    store.remove(&project_id)?;
    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub fn worktree_list(
    state: State<'_, AppState>,
    project_id: String,
) -> Result<Vec<WorktreeInfo>, BackendError> {
    let store = state
        .project_store
        .read()
        .expect("project store lock poisoned");
    let project = store.get(&project_id).ok_or_else(|| {
        BackendError::Workspace(crate::error::WorkspaceError::NotFound {
            id: project_id.clone(),
        })
    })?;
    let runner = RealCommandRunner;
    Ok(list_worktrees(&runner, &project.root_path))
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub fn worktree_create(
    state: State<'_, AppState>,
    project_id: String,
    branch_name: String,
) -> Result<WorktreeInfo, BackendError> {
    let store = state
        .project_store
        .read()
        .expect("project store lock poisoned");
    let project = store.get(&project_id).ok_or_else(|| {
        BackendError::Workspace(crate::error::WorkspaceError::NotFound {
            id: project_id.clone(),
        })
    })?;
    let worktree_path = format!(
        "{}/.worktrees/{}",
        project.root_path,
        branch_name.replace('/', "-")
    );
    let runner = RealCommandRunner;
    let wt = create_worktree(&runner, &project.root_path, &branch_name, &worktree_path).map_err(
        |e| {
            BackendError::Workspace(crate::error::WorkspaceError::InvalidOperation {
                reason: format!("Failed to create worktree: {e}"),
            })
        },
    )?;
    Ok(wt)
}

#[tauri::command]
#[tracing::instrument]
pub fn list_directories(partial_path: String, wsl: Option<bool>) -> Vec<String> {
    if wsl.unwrap_or(false) {
        return list_directories_wsl(&partial_path);
    }
    list_directories_native(&partial_path)
}

fn list_directories_native(partial_path: &str) -> Vec<String> {
    let path = std::path::Path::new(partial_path);

    // If the path ends with a separator or is a directory, list its children.
    // Otherwise, treat it as a prefix: list the parent and filter by prefix.
    let (dir, prefix) = if path.is_dir() {
        (path.to_path_buf(), String::new())
    } else {
        let parent = path.parent().unwrap_or(path);
        let file_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("")
            .to_lowercase();
        (parent.to_path_buf(), file_name)
    };

    let Ok(entries) = std::fs::read_dir(&dir) else {
        return Vec::new();
    };

    let mut results: Vec<String> = entries
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().map(|t| t.is_dir()).unwrap_or(false))
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            // Skip hidden directories
            if name.starts_with('.') {
                return None;
            }
            if !prefix.is_empty() && !name.to_lowercase().starts_with(&prefix) {
                return None;
            }
            // Return full path with trailing separator
            let full = e.path();
            Some(full.to_string_lossy().to_string())
        })
        .collect();

    results.sort();
    results.truncate(20);
    results
}

/// List directories inside WSL by shelling out to `wsl.exe`.
/// `partial_path` is a Unix-style path like "/home/user/pro".
fn list_directories_wsl(partial_path: &str) -> Vec<String> {
    // Determine directory to list and optional prefix filter.
    // If partial_path ends with '/' treat it as a directory to list.
    // Otherwise split into parent dir + prefix to filter by.
    let (dir, prefix) = if partial_path.ends_with('/') || partial_path == "/" {
        (partial_path.to_string(), String::new())
    } else {
        match partial_path.rfind('/') {
            Some(pos) => {
                let parent = if pos == 0 { "/" } else { &partial_path[..pos] };
                let file_part = partial_path[pos + 1..].to_lowercase();
                (parent.to_string(), file_part)
            }
            None => return Vec::new(),
        }
    };

    // Shell out: list directories only, one per line, no hidden
    // ls -1 -p shows dirs with trailing /, then we filter
    let output = std::process::Command::new("wsl.exe")
        .args(["--", "ls", "-1", "-p", &dir])
        .output();

    let Ok(output) = output else {
        return Vec::new();
    };

    if !output.status.success() {
        return Vec::new();
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let trailing_sep = if dir.ends_with('/') { "" } else { "/" };

    let mut results: Vec<String> = stdout
        .lines()
        .filter_map(|line| {
            let line = line.trim();
            // ls -p appends '/' to directories
            if !line.ends_with('/') {
                return None;
            }
            let name = &line[..line.len() - 1];
            if name.is_empty() || name.starts_with('.') {
                return None;
            }
            if !prefix.is_empty() && !name.to_lowercase().starts_with(&prefix) {
                return None;
            }
            Some(format!("{}{}{}", dir, trailing_sep, name))
        })
        .collect();

    results.sort();
    results.truncate(20);
    results
}

#[cfg(test)]
mod default_shell_resolution_tests {
    use super::*;

    #[test]
    fn resolve_default_shell_with_available_returns_none_for_empty_setting() {
        let available = vec![ShellInfo {
            path: "/bin/bash".to_string(),
            name: "Bash".to_string(),
        }];
        assert_eq!(resolve_default_shell_with_available("", &available), None);
    }

    #[test]
    fn resolve_default_shell_with_available_returns_shell_when_present() {
        let available = vec![
            ShellInfo {
                path: "/bin/bash".to_string(),
                name: "Bash".to_string(),
            },
            ShellInfo {
                path: "/usr/bin/zsh".to_string(),
                name: "Zsh".to_string(),
            },
        ];
        assert_eq!(
            resolve_default_shell_with_available("/usr/bin/zsh", &available),
            Some("/usr/bin/zsh".to_string())
        );
    }

    #[test]
    fn resolve_default_shell_with_available_returns_none_when_missing() {
        let available = vec![ShellInfo {
            path: "/bin/bash".to_string(),
            name: "Bash".to_string(),
        }];
        assert_eq!(
            resolve_default_shell_with_available("/usr/bin/fish", &available),
            None
        );
    }
}

#[cfg(test)]
mod pane_move_command_tests {
    use super::*;
    use crate::persistence::fs::FsPersistence;
    use tempfile::TempDir;

    fn make_session_manager(tmp: &TempDir) -> Arc<SessionManager> {
        let backend = Arc::new(FsPersistence::new(tmp.path().join("sessions")).unwrap());
        Arc::new(SessionManager::new(backend))
    }

    fn make_workspace_with_split() -> (Arc<RwLock<WorkspaceState>>, String, String, String) {
        let workspace_state = Arc::new(RwLock::new(WorkspaceState::new()));
        let mut ws = workspace_state.write().unwrap();
        let workspace = ws.create_workspace(
            "Workspace 1".to_string(),
            "pane-1".to_string(),
            "pty-1".to_string(),
            String::new(),
            String::new(),
            None,
            false,
        );
        ws.split_pane(
            "pane-1",
            SplitDirection::Horizontal,
            "pane-2".to_string(),
            "pty-2".to_string(),
        )
        .unwrap();
        (
            workspace_state.clone(),
            workspace.id,
            "pane-1".to_string(),
            "pane-2".to_string(),
        )
    }

    #[test]
    fn move_pane_with_side_effects_marks_session_dirty_and_emits() {
        let tmp = TempDir::new().unwrap();
        let session_manager = make_session_manager(&tmp);
        let (workspace_state, workspace_id, source_pane_id, target_pane_id) =
            make_workspace_with_split();
        let mut emitted_workspace_ids = Vec::new();

        assert!(!session_manager.is_dirty());

        let workspace = move_pane_with_side_effects(
            &workspace_state,
            &session_manager,
            &source_pane_id,
            &target_pane_id,
            PaneDropPosition::Bottom,
            |emitted_workspace| emitted_workspace_ids.push(emitted_workspace.id.clone()),
        )
        .unwrap();

        assert_eq!(workspace.id, workspace_id);
        assert!(session_manager.is_dirty());
        assert_eq!(emitted_workspace_ids, vec![workspace_id]);
    }

    #[test]
    fn move_pane_with_side_effects_does_not_mark_dirty_or_emit_on_error() {
        let tmp = TempDir::new().unwrap();
        let session_manager = make_session_manager(&tmp);
        let workspace_state = Arc::new(RwLock::new(WorkspaceState::new()));
        {
            let mut ws = workspace_state.write().unwrap();
            ws.create_workspace(
                "Workspace 1".to_string(),
                "pane-1".to_string(),
                "pty-1".to_string(),
                String::new(),
                String::new(),
                None,
                false,
            );
            ws.create_workspace(
                "Workspace 2".to_string(),
                "pane-2".to_string(),
                "pty-2".to_string(),
                String::new(),
                String::new(),
                None,
                false,
            );
        }
        let mut emitted = 0;

        let result = move_pane_with_side_effects(
            &workspace_state,
            &session_manager,
            "pane-1",
            "pane-2",
            PaneDropPosition::Left,
            |_| emitted += 1,
        );

        assert!(result.is_err());
        assert!(!session_manager.is_dirty());
        assert_eq!(emitted, 0);
    }
}

#[cfg(all(test, unix))]
mod ipc_context_tests {
    use super::*;
    use crate::ipc_server::IpcContext;
    use crate::persistence::fs::FsPersistence;
    use tempfile::TempDir;

    fn make_app_state(tmp: &TempDir) -> AppState {
        let backend = Arc::new(FsPersistence::new(tmp.path()).unwrap());
        let session_manager = SessionManager::new(backend.clone());
        let scrollback_dir = tmp.path().join("scrollback");
        std::fs::create_dir_all(&scrollback_dir).unwrap();
        let scrollback_storage = crate::scrollback::ScrollbackStorage::new(scrollback_dir).unwrap();
        let settings_backend = Arc::new(FsPersistence::new(tmp.path().join("settings")).unwrap());
        let settings_manager = SettingsManager::new(settings_backend);
        let socket_path = tmp.path().join("test.sock");
        let project_backend = Arc::new(FsPersistence::new(tmp.path().join("projects")).unwrap());
        let project_store = crate::project::ProjectStore::new(project_backend);
        AppState::new(
            session_manager,
            scrollback_storage,
            settings_manager,
            Some(socket_path),
            project_store,
        )
    }

    #[test]
    fn ipc_app_context_from_app_state_shares_workspace() {
        let tmp = TempDir::new().unwrap();
        let app_state = make_app_state(&tmp);

        // Create a workspace in AppState
        {
            let mut ws = app_state.workspace_state.write().unwrap();
            ws.create_workspace(
                "Test".to_string(),
                "p1".to_string(),
                "pty1".to_string(),
                String::new(),
                String::new(),
                None,
                false,
            );
        }

        let ipc_ctx = IpcAppContext::from_app_state(&app_state, tmp.path().join("test.sock"));

        // IpcAppContext should see the same workspace
        let ws = ipc_ctx.workspace_state().read().unwrap();
        assert_eq!(ws.list_workspaces().len(), 1);
        assert_eq!(ws.list_workspaces()[0].name, "Test");
    }

    #[test]
    fn ipc_app_context_from_app_state_shares_notifications() {
        let tmp = TempDir::new().unwrap();
        let app_state = make_app_state(&tmp);

        // Add a notification in AppState
        {
            let mut store = app_state.notification_store.write().unwrap();
            store.add(obelisk_protocol::Notification {
                id: "n1".to_string(),
                pane_id: String::new(),
                workspace_id: String::new(),
                osc_type: 9,
                title: "Hello".to_string(),
                body: None,
                timestamp: 0,
                read: false,
            });
        }

        let ipc_ctx = IpcAppContext::from_app_state(&app_state, tmp.path().join("test.sock"));

        // IpcAppContext should see the same notification
        let store = ipc_ctx.notification_store().read().unwrap();
        assert_eq!(store.list().len(), 1);
        assert_eq!(store.list()[0].title, "Hello");
    }

    #[test]
    fn ipc_app_context_returns_correct_socket_path() {
        let tmp = TempDir::new().unwrap();
        let app_state = make_app_state(&tmp);
        let ipc_ctx = IpcAppContext::from_app_state(&app_state, tmp.path().join("test.sock"));

        assert_eq!(ipc_ctx.socket_path(), tmp.path().join("test.sock"));
    }

    #[test]
    fn ipc_app_context_returns_server_start_time() {
        let tmp = TempDir::new().unwrap();
        let app_state = make_app_state(&tmp);
        let before = Instant::now();
        let ipc_ctx = IpcAppContext::from_app_state(&app_state, tmp.path().join("test.sock"));
        // start_time should be very close to now (set during AppState::new)
        let elapsed = before.elapsed();
        let ctx_elapsed = ipc_ctx.server_start_time().elapsed();
        assert!(ctx_elapsed >= elapsed || ctx_elapsed.as_millis() < 1000);
    }

    #[test]
    fn ipc_app_context_session_manager_works() {
        let tmp = TempDir::new().unwrap();
        let app_state = make_app_state(&tmp);
        let ipc_ctx = IpcAppContext::from_app_state(&app_state, tmp.path().join("test.sock"));

        // Session manager should be functional
        assert!(!ipc_ctx.session_manager().is_dirty());
        ipc_ctx.session_manager().mark_dirty();
        assert!(ipc_ctx.session_manager().is_dirty());
        // Should be visible through the shared Arc
        assert!(app_state.session_manager.is_dirty());
    }

    #[test]
    fn app_state_ipc_server_starts_as_none() {
        let tmp = TempDir::new().unwrap();
        let app_state = make_app_state(&tmp);
        assert!(app_state.ipc_server.lock().unwrap().is_none());
    }

    #[test]
    fn app_state_ipc_socket_path_is_some() {
        let tmp = TempDir::new().unwrap();
        let app_state = make_app_state(&tmp);
        assert_eq!(
            app_state.ipc_socket_path,
            Some(tmp.path().join("test.sock"))
        );
    }

    #[tokio::test]
    async fn ipc_server_starts_with_app_context() {
        let tmp = TempDir::new().unwrap();
        let app_state = make_app_state(&tmp);
        let socket_path = tmp.path().join("ipc-test.sock");
        let ipc_ctx = IpcAppContext::from_app_state(&app_state, socket_path.clone());

        let server = crate::ipc_server::IpcServer::start(ipc_ctx, socket_path.clone())
            .await
            .unwrap();
        assert!(socket_path.exists());

        // Connect and send a workspace.list request
        let stream = tokio::net::UnixStream::connect(&socket_path).await.unwrap();
        let (mut reader, mut writer) = tokio::io::split(stream);

        let request = obelisk_protocol::rpc::RpcRequest {
            jsonrpc: "2.0".to_string(),
            method: obelisk_protocol::methods::METHOD_WORKSPACE_LIST.to_string(),
            params: None,
            id: serde_json::json!(1),
        };
        obelisk_protocol::framing::write_request(&mut writer, &request)
            .await
            .unwrap();
        let response = obelisk_protocol::framing::read_response(&mut reader)
            .await
            .unwrap();
        assert!(response.error.is_none());
        assert_eq!(response.result, Some(serde_json::json!([])));

        server.stop().await.unwrap();
        assert!(!socket_path.exists());
    }
}

#[cfg(test)]
mod list_directories_tests {
    use super::*;

    #[test]
    fn returns_empty_for_nonexistent_path() {
        let result = list_directories("/this/path/does/not/exist/at/all".to_string(), None);
        assert!(result.is_empty());
    }

    #[test]
    fn lists_subdirectories_of_valid_path() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir(tmp.path().join("alpha")).unwrap();
        std::fs::create_dir(tmp.path().join("beta")).unwrap();
        // Create a file (should not appear in results)
        std::fs::write(tmp.path().join("file.txt"), b"hello").unwrap();

        let result = list_directories(tmp.path().to_string_lossy().to_string(), None);
        assert_eq!(result.len(), 2);
        assert!(result.iter().any(|p| p.ends_with("alpha")));
        assert!(result.iter().any(|p| p.ends_with("beta")));
    }

    #[test]
    fn filters_by_prefix() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir(tmp.path().join("alpha")).unwrap();
        std::fs::create_dir(tmp.path().join("beta")).unwrap();
        std::fs::create_dir(tmp.path().join("almond")).unwrap();

        // Partial path ending with "al" should match alpha and almond
        let partial = tmp.path().join("al").to_string_lossy().to_string();
        let result = list_directories(partial, None);
        assert_eq!(result.len(), 2);
        assert!(result.iter().all(|p| {
            let name = std::path::Path::new(p)
                .file_name()
                .unwrap()
                .to_str()
                .unwrap();
            name.starts_with("al")
        }));
    }

    #[test]
    fn skips_hidden_directories() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir(tmp.path().join(".hidden")).unwrap();
        std::fs::create_dir(tmp.path().join("visible")).unwrap();

        let result = list_directories(tmp.path().to_string_lossy().to_string(), None);
        assert_eq!(result.len(), 1);
        assert!(result[0].ends_with("visible"));
    }

    #[test]
    fn path_with_trailing_separator_lists_children() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir(tmp.path().join("child")).unwrap();

        let mut path_str = tmp.path().to_string_lossy().to_string();
        if !path_str.ends_with(std::path::MAIN_SEPARATOR) {
            path_str.push(std::path::MAIN_SEPARATOR);
        }

        let result = list_directories(path_str, None);
        assert_eq!(result.len(), 1);
        assert!(result[0].ends_with("child"));
    }

    #[test]
    fn wsl_lists_home_directory() {
        // Only run on machines where wsl.exe is available
        let has_wsl = std::process::Command::new("wsl.exe")
            .args(["--", "echo", "ok"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !has_wsl {
            eprintln!("Skipping WSL test: wsl.exe not available");
            return;
        }

        let result = list_directories("/home/".to_string(), Some(true));
        println!("WSL /home/ results: {:?}", result);
        assert!(
            !result.is_empty(),
            "WSL /home/ should list at least one user directory"
        );
        assert!(result.iter().all(|p| p.starts_with("/home/")));
    }

    #[test]
    fn wsl_filters_by_prefix() {
        let has_wsl = std::process::Command::new("wsl.exe")
            .args(["--", "echo", "ok"])
            .output()
            .map(|o| o.status.success())
            .unwrap_or(false);
        if !has_wsl {
            eprintln!("Skipping WSL test: wsl.exe not available");
            return;
        }

        // /usr/ has bin, lib, etc — filter by "bi" should match bin
        let result = list_directories("/usr/bi".to_string(), Some(true));
        println!("WSL /usr/bi results: {:?}", result);
        assert!(result.iter().any(|p| p.ends_with("/bin")));
        assert!(!result.iter().any(|p| p.ends_with("/lib")));
    }
}
