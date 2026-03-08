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

    #[test]
    fn resolve_default_shell_with_available_returns_none_for_whitespace_only() {
        let available = vec![ShellInfo {
            path: "/bin/bash".to_string(),
            name: "Bash".to_string(),
        }];
        assert_eq!(
            resolve_default_shell_with_available("   ", &available),
            None
        );
    }

    #[test]
    fn resolve_default_shell_with_available_returns_some_when_in_list() {
        let available = vec![
            ShellInfo {
                path: "/bin/bash".to_string(),
                name: "Bash".to_string(),
            },
            ShellInfo {
                path: "/bin/zsh".to_string(),
                name: "Zsh".to_string(),
            },
        ];
        assert_eq!(
            resolve_default_shell_with_available("/bin/bash", &available),
            Some("/bin/bash".to_string())
        );
    }

    #[test]
    fn resolve_default_shell_with_available_returns_none_for_unlisted_shell() {
        let available = vec![ShellInfo {
            path: "/bin/bash".to_string(),
            name: "Bash".to_string(),
        }];
        assert_eq!(
            resolve_default_shell_with_available("/usr/local/bin/nushell", &available),
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

    #[test]
    fn relative_path_traversal_does_not_panic() {
        // Relative traversal paths like "../../../etc" should not panic.
        // The function may return results (resolved relative to CWD) or empty,
        // but it must never crash.
        let result = list_directories("../../../etc".to_string(), None);
        // Just assert it doesn't panic; result depends on the OS and CWD
        let _ = result;
    }

    #[test]
    fn relative_path_dot_dot_only_does_not_panic() {
        let result = list_directories("..".to_string(), None);
        let _ = result;
    }

    #[test]
    fn absolute_path_returns_directories_or_empty() {
        // An absolute path that exists should return results; one that doesn't
        // should return empty — but neither should panic.
        #[cfg(unix)]
        {
            let result = list_directories("/tmp".to_string(), None);
            // /tmp exists on virtually all Unix systems
            let _ = result;
        }
        #[cfg(windows)]
        {
            let result = list_directories(r"C:\".to_string(), None);
            assert!(!result.is_empty());
        }
    }

    #[test]
    fn nonexistent_absolute_path_returns_empty() {
        let result = list_directories(
            "/nonexistent/path/that/should/not/exist/xyz123".to_string(),
            None,
        );
        assert!(result.is_empty());
    }

    #[test]
    fn empty_string_does_not_panic() {
        let result = list_directories(String::new(), None);
        let _ = result;
    }

    #[test]
    fn path_with_null_bytes_does_not_panic() {
        // Paths containing null bytes are invalid on all platforms;
        // the function should handle them gracefully.
        let result = list_directories("/tmp/\0evil".to_string(), None);
        assert!(result.is_empty());
    }
}

#[cfg(test)]
mod cross_platform_path_tests {
    use super::*;

    // --- list_directories cross-platform tests ---

    #[test]
    fn list_directories_handles_forward_slash_paths() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir(tmp.path().join("subdir")).unwrap();

        // Convert path to use forward slashes (simulates Unix-style input on any platform)
        let path_str = tmp.path().to_string_lossy().replace('\\', "/");
        let result = list_directories(path_str, None);
        assert_eq!(result.len(), 1);
        assert!(result[0].contains("subdir"));
    }

    #[test]
    fn list_directories_handles_trailing_separator_cross_platform() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir(tmp.path().join("child")).unwrap();

        // Test with forward slash trailing separator
        let mut path_str = tmp.path().to_string_lossy().to_string();
        if !path_str.ends_with('/') && !path_str.ends_with('\\') {
            path_str.push('/');
        }
        let result = list_directories(path_str, None);
        assert_eq!(result.len(), 1);
        assert!(result[0].contains("child"));
    }

    #[cfg(windows)]
    #[test]
    fn list_directories_handles_backslash_paths() {
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir(tmp.path().join("windir")).unwrap();

        let path_str = tmp.path().to_string_lossy().to_string();
        // On Windows, paths naturally use backslashes
        assert!(path_str.contains('\\'));
        let result = list_directories(path_str, None);
        assert_eq!(result.len(), 1);
        assert!(result[0].contains("windir"));
    }

    #[cfg(windows)]
    #[test]
    fn list_directories_handles_drive_letter_path() {
        // C:\ should be listable on Windows (contains Windows, Users, etc.)
        let result = list_directories(r"C:\".to_string(), None);
        assert!(!result.is_empty(), "C:\\ should contain directories");
    }

    #[cfg(windows)]
    #[test]
    fn list_directories_handles_drive_letter_prefix_filter() {
        // C:\U should filter for directories starting with U (e.g., Users)
        let result = list_directories(r"C:\U".to_string(), None);
        assert!(
            result.iter().any(|p| p.contains("Users")),
            "C:\\U should match Users directory, got: {:?}",
            result
        );
    }

    // --- list_directories WSL-style path tests (run on all platforms) ---

    #[test]
    fn list_directories_wsl_false_does_not_use_wsl() {
        // When wsl=Some(false), should use native path handling
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir(tmp.path().join("native")).unwrap();
        let result = list_directories(tmp.path().to_string_lossy().to_string(), Some(false));
        assert_eq!(result.len(), 1);
        assert!(result[0].contains("native"));
    }

    #[test]
    fn list_directories_wsl_none_does_not_use_wsl() {
        // When wsl=None, should use native path handling
        let tmp = tempfile::tempdir().unwrap();
        std::fs::create_dir(tmp.path().join("default")).unwrap();
        let result = list_directories(tmp.path().to_string_lossy().to_string(), None);
        assert_eq!(result.len(), 1);
        assert!(result[0].contains("default"));
    }

    // --- project_add cross-platform path tests ---

    fn make_project_store() -> Arc<RwLock<ProjectStore>> {
        let tmp = tempfile::tempdir().unwrap();
        let backend = Arc::new(
            crate::persistence::fs::FsPersistence::new(tmp.path().join("projects")).unwrap(),
        );
        // Leak the tempdir so it lives long enough for the test
        std::mem::forget(tmp);
        Arc::new(RwLock::new(ProjectStore::new(backend)))
    }

    #[test]
    fn project_add_extracts_name_from_unix_style_path() {
        let store = make_project_store();
        let project = store
            .write()
            .unwrap()
            .add("/home/user/my-project".to_string())
            .unwrap();
        assert_eq!(project.name, "my-project");
    }

    #[test]
    fn project_add_extracts_name_from_wsl_mount_path() {
        let store = make_project_store();
        let project = store
            .write()
            .unwrap()
            .add("/mnt/c/Users/dev/repos/cool-app".to_string())
            .unwrap();
        assert_eq!(project.name, "cool-app");
    }

    #[cfg(windows)]
    #[test]
    fn project_add_extracts_name_from_windows_path() {
        let store = make_project_store();
        let project = store
            .write()
            .unwrap()
            .add(r"C:\Users\dev\repos\win-project".to_string())
            .unwrap();
        assert_eq!(project.name, "win-project");
    }
}

/// Integration tests that exercise the same logic as Tauri commands
/// by operating on the underlying subsystems directly.
/// Since Tauri commands are thin wrappers around these subsystems,
/// testing the composition here is equivalent to integration-testing
/// the commands.
#[cfg(test)]
mod command_integration_tests {
    use super::*;
    use crate::persistence::fs::FsPersistence;
    use crate::pty::backend::{PtyBackend, SpawnedPty};
    use crate::pty::emitter::MockEventEmitter;
    use std::io::{Read as IoRead, Write as IoWrite};
    use tempfile::TempDir;

    // --- Test doubles ---

    struct SinkWriter;
    impl IoWrite for SinkWriter {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    struct EmptyReader;
    impl IoRead for EmptyReader {
        fn read(&mut self, _buf: &mut [u8]) -> std::io::Result<usize> {
            Ok(0)
        }
    }

    struct FakeChild;
    impl crate::pty::backend::ChildController for FakeChild {
        fn kill(&mut self) -> Result<(), crate::error::PtyError> {
            Ok(())
        }
        fn is_alive(&mut self) -> Result<bool, crate::error::PtyError> {
            Ok(false)
        }
    }

    struct FakeResizer;
    impl crate::pty::backend::PtyResizer for FakeResizer {
        fn resize(&self, _rows: u16, _cols: u16) -> Result<(), crate::error::PtyError> {
            Ok(())
        }
    }

    struct FakePtyBackend;
    impl PtyBackend for FakePtyBackend {
        fn spawn(
            &self,
            _config: &crate::pty::types::PtyConfig,
        ) -> Result<SpawnedPty, crate::error::PtyError> {
            Ok(SpawnedPty {
                writer: Box::new(SinkWriter),
                reader: Box::new(EmptyReader),
                child: Box::new(FakeChild),
                resizer: Box::new(FakeResizer),
            })
        }
    }

    struct FailingPtyBackend;
    impl PtyBackend for FailingPtyBackend {
        fn spawn(
            &self,
            _config: &crate::pty::types::PtyConfig,
        ) -> Result<SpawnedPty, crate::error::PtyError> {
            Err(crate::error::PtyError::SpawnFailed(std::io::Error::new(
                std::io::ErrorKind::Other,
                "fake spawn failure",
            )))
        }
    }

    // --- Helpers ---

    struct TestHarness {
        pty_manager: PtyManager,
        workspace_state: Arc<RwLock<WorkspaceState>>,
        session_manager: Arc<SessionManager>,
        scrollback_storage: ScrollbackStorage,
        notification_store: Arc<RwLock<NotificationStore>>,
        settings_manager: SettingsManager,
        project_store: Arc<RwLock<ProjectStore>>,
        emitter: Arc<MockEventEmitter>,
        _temp_dir: TempDir,
    }

    impl TestHarness {
        fn new() -> Self {
            Self::with_backend(Arc::new(FakePtyBackend))
        }

        fn with_backend(backend: Arc<dyn PtyBackend>) -> Self {
            let tmp = TempDir::new().unwrap();
            let persistence = Arc::new(FsPersistence::new(tmp.path().join("sessions")).unwrap());
            let scrollback_dir = tmp.path().join("scrollback");
            std::fs::create_dir_all(&scrollback_dir).unwrap();
            let settings_backend =
                Arc::new(FsPersistence::new(tmp.path().join("settings")).unwrap());
            let project_backend =
                Arc::new(FsPersistence::new(tmp.path().join("projects")).unwrap());

            Self {
                pty_manager: PtyManager::new(backend),
                workspace_state: Arc::new(RwLock::new(WorkspaceState::new())),
                session_manager: Arc::new(SessionManager::new(persistence)),
                scrollback_storage: ScrollbackStorage::new(scrollback_dir).unwrap(),
                notification_store: Arc::new(RwLock::new(NotificationStore::new(1000))),
                settings_manager: SettingsManager::new(settings_backend),
                project_store: Arc::new(RwLock::new(ProjectStore::new(project_backend))),
                emitter: Arc::new(MockEventEmitter::new()),
                _temp_dir: tmp,
            }
        }

        fn with_failing_pty() -> Self {
            Self::with_backend(Arc::new(FailingPtyBackend))
        }

        /// Simulates workspace_create command logic
        fn create_workspace(
            &self,
            name: &str,
            worktree_path: &str,
        ) -> Result<WorkspaceInfo, BackendError> {
            let pane_id = uuid::Uuid::new_v4().to_string();
            let config = crate::pty::types::PtyConfig {
                shell: None,
                cwd: if worktree_path.is_empty() {
                    None
                } else {
                    Some(worktree_path.to_string())
                },
                env: None,
                rows: None,
                cols: None,
            };
            let pty_id = self.pty_manager.spawn(config, self.emitter.clone())?;

            let mut ws = self
                .workspace_state
                .write()
                .expect("workspace state lock poisoned");
            let workspace = ws.create_workspace(
                name.to_string(),
                pane_id,
                pty_id,
                String::new(),
                worktree_path.to_string(),
                None,
                false,
            );
            self.session_manager.mark_dirty();
            Ok(workspace)
        }
    }

    // === Workspace lifecycle tests ===

    #[test]
    fn workspace_create_spawns_pty_and_creates_workspace() {
        let h = TestHarness::new();
        let ws = h.create_workspace("Test WS", "").unwrap();
        assert_eq!(ws.name, "Test WS");
        assert!(!ws.id.is_empty());
        assert_eq!(ws.surfaces.len(), 1);

        let state = h.workspace_state.read().unwrap();
        assert_eq!(state.list_workspaces().len(), 1);
        assert!(h.session_manager.is_dirty());
    }

    #[test]
    fn workspace_create_with_failing_pty_returns_error() {
        let h = TestHarness::with_failing_pty();
        let result = h.create_workspace("Test", "");
        assert!(result.is_err());
        // Workspace should NOT have been created
        let state = h.workspace_state.read().unwrap();
        assert_eq!(state.list_workspaces().len(), 0);
    }

    #[test]
    fn workspace_list_returns_all_workspaces() {
        let h = TestHarness::new();
        h.create_workspace("WS 1", "").unwrap();
        h.create_workspace("WS 2", "").unwrap();
        h.create_workspace("WS 3", "").unwrap();

        let state = h.workspace_state.read().unwrap();
        let workspaces = state.list_workspaces();
        assert_eq!(workspaces.len(), 3);
        assert_eq!(workspaces[0].name, "WS 1");
        assert_eq!(workspaces[1].name, "WS 2");
        assert_eq!(workspaces[2].name, "WS 3");
    }

    #[test]
    fn workspace_list_empty_returns_empty_vec() {
        let h = TestHarness::new();
        let state = h.workspace_state.read().unwrap();
        assert!(state.list_workspaces().is_empty());
    }

    #[test]
    fn workspace_rename_updates_name() {
        let h = TestHarness::new();
        let ws = h.create_workspace("Old Name", "").unwrap();

        let mut state = h.workspace_state.write().unwrap();
        let renamed = state
            .rename_workspace(&ws.id, "New Name".to_string())
            .unwrap();
        assert_eq!(renamed.name, "New Name");
        assert_eq!(renamed.id, ws.id);
    }

    #[test]
    fn workspace_rename_nonexistent_returns_error() {
        let h = TestHarness::new();
        let mut state = h.workspace_state.write().unwrap();
        let result = state.rename_workspace("nonexistent", "New Name".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn workspace_reorder_changes_order() {
        let h = TestHarness::new();
        let ws1 = h.create_workspace("WS 1", "").unwrap();
        let ws2 = h.create_workspace("WS 2", "").unwrap();
        let ws3 = h.create_workspace("WS 3", "").unwrap();

        let mut state = h.workspace_state.write().unwrap();
        state
            .reorder_workspaces(&[ws3.id.clone(), ws1.id.clone(), ws2.id.clone()])
            .unwrap();

        let workspaces = state.list_workspaces();
        assert_eq!(workspaces[0].id, ws3.id);
        assert_eq!(workspaces[1].id, ws1.id);
        assert_eq!(workspaces[2].id, ws2.id);
    }

    #[test]
    fn workspace_reorder_with_missing_ids_returns_error() {
        let h = TestHarness::new();
        h.create_workspace("WS 1", "").unwrap();

        let mut state = h.workspace_state.write().unwrap();
        let result = state.reorder_workspaces(&["nonexistent".to_string()]);
        assert!(result.is_err());
    }

    #[test]
    fn workspace_close_removes_workspace_and_kills_ptys() {
        let h = TestHarness::new();
        let ws1 = h.create_workspace("WS 1", "").unwrap();
        let ws2 = h.create_workspace("WS 2", "").unwrap();

        // Close ws1
        let pty_ids = {
            let mut state = h.workspace_state.write().unwrap();
            state.close_workspace(&ws1.id).unwrap()
        };

        // PTY cleanup (simulates what the command does)
        for pty_id in &pty_ids {
            if !pty_id.is_empty() {
                let _ = h.pty_manager.kill(pty_id);
            }
        }

        let state = h.workspace_state.read().unwrap();
        assert_eq!(state.list_workspaces().len(), 1);
        assert_eq!(state.list_workspaces()[0].id, ws2.id);
    }

    #[test]
    fn workspace_close_last_workspace_returns_error() {
        let h = TestHarness::new();
        let ws = h.create_workspace("Only WS", "").unwrap();

        let mut state = h.workspace_state.write().unwrap();
        let result = state.close_workspace(&ws.id);
        assert!(result.is_err());
    }

    #[test]
    fn workspace_close_nonexistent_returns_error() {
        let h = TestHarness::new();
        h.create_workspace("WS 1", "").unwrap();

        let mut state = h.workspace_state.write().unwrap();
        let result = state.close_workspace("nonexistent");
        assert!(result.is_err());
    }

    // === Pane lifecycle tests ===

    #[test]
    fn pane_split_creates_new_pane_with_pty() {
        let h = TestHarness::new();
        let ws = h.create_workspace("WS", "").unwrap();
        let pane_id = match &ws.surfaces[0].layout {
            LayoutNode::Leaf { pane_id, .. } => pane_id.clone(),
            _ => panic!("expected leaf"),
        };

        // Simulate pane_split command
        let new_pane_id = uuid::Uuid::new_v4().to_string();
        let config = crate::pty::types::PtyConfig {
            shell: None,
            cwd: None,
            env: None,
            rows: None,
            cols: None,
        };
        let new_pty_id = h.pty_manager.spawn(config, h.emitter.clone()).unwrap();

        let mut state = h.workspace_state.write().unwrap();
        let result = state
            .split_pane(
                &pane_id,
                SplitDirection::Horizontal,
                new_pane_id,
                new_pty_id,
            )
            .unwrap();
        assert_eq!(result.workspace.id, ws.id);
        // Layout should now be a split
        match &result.workspace.surfaces[0].layout {
            LayoutNode::Split { children, .. } => assert_eq!(children.len(), 2),
            _ => panic!("expected split layout"),
        }
    }

    #[test]
    fn pane_split_nonexistent_pane_returns_error() {
        let h = TestHarness::new();
        h.create_workspace("WS", "").unwrap();

        let mut state = h.workspace_state.write().unwrap();
        let result = state.split_pane(
            "nonexistent",
            SplitDirection::Vertical,
            "new-pane".to_string(),
            "new-pty".to_string(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn pane_split_cleans_up_pty_on_workspace_error() {
        let h = TestHarness::new();
        // Simulate what happens when split_pane fails after PTY spawn
        let config = crate::pty::types::PtyConfig {
            shell: None,
            cwd: None,
            env: None,
            rows: None,
            cols: None,
        };
        let pty_id = h.pty_manager.spawn(config, h.emitter.clone()).unwrap();

        // split_pane will fail because pane doesn't exist
        let mut state = h.workspace_state.write().unwrap();
        let result = state.split_pane(
            "nonexistent",
            SplitDirection::Horizontal,
            "new-pane".to_string(),
            pty_id.clone(),
        );
        assert!(result.is_err());
        drop(state);

        // Command logic would kill the orphaned PTY
        let kill_result = h.pty_manager.kill(&pty_id);
        assert!(kill_result.is_ok());
    }

    #[test]
    fn pane_swap_exchanges_pane_positions() {
        let h = TestHarness::new();
        let ws = h.create_workspace("WS", "").unwrap();
        let pane1_id = match &ws.surfaces[0].layout {
            LayoutNode::Leaf { pane_id, .. } => pane_id.clone(),
            _ => panic!("expected leaf"),
        };

        // Split to create second pane
        let pane2_id = uuid::Uuid::new_v4().to_string();
        let config = crate::pty::types::PtyConfig {
            shell: None,
            cwd: None,
            env: None,
            rows: None,
            cols: None,
        };
        let pty2_id = h.pty_manager.spawn(config, h.emitter.clone()).unwrap();

        let mut state = h.workspace_state.write().unwrap();
        state
            .split_pane(
                &pane1_id,
                SplitDirection::Horizontal,
                pane2_id.clone(),
                pty2_id,
            )
            .unwrap();

        // Swap panes
        let result = state.swap_panes(&pane1_id, &pane2_id);
        assert!(result.is_ok());
    }

    #[test]
    fn pane_swap_nonexistent_returns_error() {
        let h = TestHarness::new();
        h.create_workspace("WS", "").unwrap();

        let mut state = h.workspace_state.write().unwrap();
        let result = state.swap_panes("nonexistent", "also-nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn pane_close_removes_pane_and_kills_pty() {
        let h = TestHarness::new();
        let ws = h.create_workspace("WS", "").unwrap();
        let pane1_id = match &ws.surfaces[0].layout {
            LayoutNode::Leaf { pane_id, .. } => pane_id.clone(),
            _ => panic!("expected leaf"),
        };

        // Split to create second pane
        let pane2_id = uuid::Uuid::new_v4().to_string();
        let config = crate::pty::types::PtyConfig {
            shell: None,
            cwd: None,
            env: None,
            rows: None,
            cols: None,
        };
        let pty2_id = h.pty_manager.spawn(config, h.emitter.clone()).unwrap();

        let mut state = h.workspace_state.write().unwrap();
        state
            .split_pane(
                &pane1_id,
                SplitDirection::Horizontal,
                pane2_id.clone(),
                pty2_id.clone(),
            )
            .unwrap();

        // Close pane2
        let result = state.close_pane(&pane2_id).unwrap();
        drop(state);

        // Command logic: kill PTY
        if !result.pty_id.is_empty() {
            let _ = h.pty_manager.kill(&result.pty_id);
        }

        // Workspace should still exist with only pane1
        let state = h.workspace_state.read().unwrap();
        assert_eq!(state.list_workspaces().len(), 1);
        match &state.list_workspaces()[0].surfaces[0].layout {
            LayoutNode::Leaf { pane_id, .. } => assert_eq!(*pane_id, pane1_id),
            _ => panic!("expected leaf after closing split partner"),
        }
    }

    #[test]
    fn pane_close_nonexistent_returns_error() {
        let h = TestHarness::new();
        h.create_workspace("WS", "").unwrap();

        let mut state = h.workspace_state.write().unwrap();
        let result = state.close_pane("nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn pane_open_browser_creates_browser_pane() {
        let h = TestHarness::new();
        let ws = h.create_workspace("WS", "").unwrap();
        let pane_id = match &ws.surfaces[0].layout {
            LayoutNode::Leaf { pane_id, .. } => pane_id.clone(),
            _ => panic!("expected leaf"),
        };

        let new_pane_id = uuid::Uuid::new_v4().to_string();
        let mut state = h.workspace_state.write().unwrap();
        let result = state.open_browser_pane(
            &pane_id,
            SplitDirection::Horizontal,
            new_pane_id,
            "https://example.com".to_string(),
        );
        assert!(result.is_ok());

        // Layout should now be a split
        let workspaces = state.list_workspaces();
        match &workspaces[0].surfaces[0].layout {
            LayoutNode::Split { children, .. } => assert_eq!(children.len(), 2),
            _ => panic!("expected split layout after browser pane open"),
        }
    }

    #[test]
    fn pane_open_browser_nonexistent_pane_returns_error() {
        let h = TestHarness::new();
        h.create_workspace("WS", "").unwrap();

        let mut state = h.workspace_state.write().unwrap();
        let result = state.open_browser_pane(
            "nonexistent",
            SplitDirection::Horizontal,
            "new-pane".to_string(),
            "https://example.com".to_string(),
        );
        assert!(result.is_err());
    }

    // === Session save/restore tests ===

    #[test]
    fn session_save_persists_workspace_state() {
        let h = TestHarness::new();
        h.create_workspace("WS 1", "").unwrap();
        h.create_workspace("WS 2", "").unwrap();

        // Simulate session_save command
        let ws = h.workspace_state.read().unwrap();
        h.session_manager.save(&ws).unwrap();
        drop(ws);

        // Verify saved
        let loaded = h.session_manager.load().unwrap();
        assert!(loaded.is_some());
        assert_eq!(loaded.unwrap().workspaces.len(), 2);
    }

    #[test]
    fn session_save_empty_state_works() {
        let h = TestHarness::new();
        let ws = h.workspace_state.read().unwrap();
        h.session_manager.save(&ws).unwrap();
    }

    // === Scrollback tests ===

    #[test]
    fn scrollback_save_and_load_roundtrip() {
        let h = TestHarness::new();
        let data = b"terminal scrollback content";
        let b64 = base64::engine::general_purpose::STANDARD.encode(data);

        // Simulate scrollback_save: decode base64 then save
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(&b64)
            .unwrap();
        h.scrollback_storage.save("pane-1", &bytes).unwrap();

        // Simulate scrollback_load: load then encode base64
        let loaded = h.scrollback_storage.load("pane-1").unwrap();
        assert!(loaded.is_some());
        let loaded_b64 = base64::engine::general_purpose::STANDARD.encode(loaded.unwrap());
        assert_eq!(loaded_b64, b64);
    }

    #[test]
    fn scrollback_load_nonexistent_returns_none() {
        let h = TestHarness::new();
        let loaded = h.scrollback_storage.load("nonexistent").unwrap();
        assert!(loaded.is_none());
    }

    #[test]
    fn scrollback_save_invalid_base64_fails() {
        // Simulate what scrollback_save does with invalid base64
        let result = base64::engine::general_purpose::STANDARD.decode("not valid base64!!!");
        assert!(result.is_err());
    }

    // === Notification tests ===

    #[test]
    fn notification_list_returns_all_notifications() {
        let h = TestHarness::new();
        {
            let mut store = h.notification_store.write().unwrap();
            store.add(obelisk_protocol::Notification {
                id: "n1".to_string(),
                pane_id: "p1".to_string(),
                workspace_id: "ws1".to_string(),
                osc_type: 9,
                title: "Test".to_string(),
                body: None,
                timestamp: 0,
                read: false,
            });
        }

        let store = h.notification_store.read().unwrap();
        let list = store.list();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].title, "Test");
    }

    #[test]
    fn notification_mark_read_updates_notification() {
        let h = TestHarness::new();
        {
            let mut store = h.notification_store.write().unwrap();
            store.add(obelisk_protocol::Notification {
                id: "n1".to_string(),
                pane_id: "p1".to_string(),
                workspace_id: "ws1".to_string(),
                osc_type: 9,
                title: "Test".to_string(),
                body: None,
                timestamp: 0,
                read: false,
            });
        }

        {
            let mut store = h.notification_store.write().unwrap();
            store.mark_read("n1");
        }

        let store = h.notification_store.read().unwrap();
        assert!(store.list()[0].read);
    }

    #[test]
    fn notification_mark_read_nonexistent_is_noop() {
        let h = TestHarness::new();
        let mut store = h.notification_store.write().unwrap();
        store.mark_read("nonexistent"); // Should not panic
        assert_eq!(store.list().len(), 0);
    }

    #[test]
    fn notification_clear_removes_all() {
        let h = TestHarness::new();
        {
            let mut store = h.notification_store.write().unwrap();
            store.add(obelisk_protocol::Notification {
                id: "n1".to_string(),
                pane_id: "p1".to_string(),
                workspace_id: "ws1".to_string(),
                osc_type: 9,
                title: "Test 1".to_string(),
                body: None,
                timestamp: 0,
                read: false,
            });
            store.add(obelisk_protocol::Notification {
                id: "n2".to_string(),
                pane_id: "p2".to_string(),
                workspace_id: "ws1".to_string(),
                osc_type: 9,
                title: "Test 2".to_string(),
                body: None,
                timestamp: 0,
                read: false,
            });
        }

        {
            let mut store = h.notification_store.write().unwrap();
            store.clear();
        }

        let store = h.notification_store.read().unwrap();
        assert!(store.list().is_empty());
    }

    // === Settings tests ===

    #[test]
    fn settings_get_returns_defaults() {
        let h = TestHarness::new();
        let settings = h.settings_manager.get();
        assert_eq!(settings, Settings::default());
    }

    #[test]
    fn settings_update_and_get_roundtrip() {
        let h = TestHarness::new();
        h.settings_manager
            .update("theme", serde_json::json!("light"))
            .unwrap();
        let settings = h.settings_manager.get();
        assert_eq!(settings.theme, "light");
    }

    #[test]
    fn settings_update_invalid_key_returns_error() {
        let h = TestHarness::new();
        let result = h
            .settings_manager
            .update("nonexistent.key", serde_json::json!("value"));
        assert!(result.is_err());
    }

    #[test]
    fn settings_update_invalid_type_returns_error() {
        let h = TestHarness::new();
        let result = h
            .settings_manager
            .update("terminalFontSize", serde_json::json!("not a number"));
        assert!(result.is_err());
    }

    #[test]
    fn settings_reset_restores_defaults() {
        let h = TestHarness::new();
        h.settings_manager
            .update("theme", serde_json::json!("light"))
            .unwrap();
        h.settings_manager.reset().unwrap();
        assert_eq!(h.settings_manager.get(), Settings::default());
    }

    // === Shell list test ===

    #[test]
    fn shell_list_returns_non_empty() {
        // shell_list() calls RealPtyBackend::enumerate_shells()
        let shells = shell_list();
        // On any platform, at least one shell should be found
        assert!(!shells.is_empty());
        for shell in &shells {
            assert!(!shell.path.is_empty());
            assert!(!shell.name.is_empty());
        }
    }

    // === Project lifecycle tests ===

    #[test]
    fn project_list_initially_empty() {
        let h = TestHarness::new();
        let store = h.project_store.read().unwrap();
        assert!(store.list().is_empty());
    }

    #[test]
    fn project_add_and_list() {
        let h = TestHarness::new();
        let project = {
            let mut store = h.project_store.write().unwrap();
            store.add("/home/user/myproject".to_string()).unwrap()
        };
        assert_eq!(project.name, "myproject");

        let store = h.project_store.read().unwrap();
        assert_eq!(store.list().len(), 1);
        assert_eq!(store.list()[0].id, project.id);
    }

    #[test]
    fn project_add_duplicate_returns_existing() {
        let h = TestHarness::new();
        let mut store = h.project_store.write().unwrap();
        let p1 = store.add("/home/user/myproject".to_string()).unwrap();
        let p2 = store.add("/home/user/myproject".to_string()).unwrap();
        assert_eq!(p1.id, p2.id);
        assert_eq!(store.list().len(), 1);
    }

    #[test]
    fn project_remove_deletes_project() {
        let h = TestHarness::new();
        let project = {
            let mut store = h.project_store.write().unwrap();
            store.add("/home/user/myproject".to_string()).unwrap()
        };

        {
            let mut store = h.project_store.write().unwrap();
            store.remove(&project.id).unwrap();
        }

        let store = h.project_store.read().unwrap();
        assert!(store.list().is_empty());
    }

    #[test]
    fn project_remove_nonexistent_is_noop() {
        let h = TestHarness::new();
        let mut store = h.project_store.write().unwrap();
        store.remove("nonexistent-id").unwrap(); // Should not panic
    }

    // === collect_layout_pane_ids tests ===

    #[test]
    fn collect_layout_pane_ids_leaf() {
        let layout = LayoutNode::Leaf {
            pane_id: "p1".to_string(),
            pty_id: "pty1".to_string(),
        };
        let mut ids = Vec::new();
        collect_layout_pane_ids(&layout, &mut ids);
        assert_eq!(ids, vec!["p1"]);
    }

    #[test]
    fn collect_layout_pane_ids_split() {
        let layout = LayoutNode::Split {
            direction: SplitDirection::Horizontal,
            sizes: [0.5, 0.5],
            children: Box::new([
                LayoutNode::Leaf {
                    pane_id: "p1".to_string(),
                    pty_id: "pty1".to_string(),
                },
                LayoutNode::Leaf {
                    pane_id: "p2".to_string(),
                    pty_id: "pty2".to_string(),
                },
            ]),
        };
        let mut ids = Vec::new();
        collect_layout_pane_ids(&layout, &mut ids);
        assert_eq!(ids, vec!["p1", "p2"]);
    }

    #[test]
    fn collect_layout_pane_ids_nested_split() {
        let layout = LayoutNode::Split {
            direction: SplitDirection::Horizontal,
            sizes: [0.5, 0.5],
            children: Box::new([
                LayoutNode::Leaf {
                    pane_id: "p1".to_string(),
                    pty_id: "pty1".to_string(),
                },
                LayoutNode::Split {
                    direction: SplitDirection::Vertical,
                    sizes: [0.5, 0.5],
                    children: Box::new([
                        LayoutNode::Leaf {
                            pane_id: "p2".to_string(),
                            pty_id: "pty2".to_string(),
                        },
                        LayoutNode::Leaf {
                            pane_id: "p3".to_string(),
                            pty_id: "pty3".to_string(),
                        },
                    ]),
                },
            ]),
        };
        let mut ids = Vec::new();
        collect_layout_pane_ids(&layout, &mut ids);
        assert_eq!(ids, vec!["p1", "p2", "p3"]);
    }

    // === collect_layout_pane_ids_to_map tests ===

    #[test]
    fn collect_layout_pane_ids_to_map_leaf() {
        let layout = LayoutNode::Leaf {
            pane_id: "p1".to_string(),
            pty_id: "pty1".to_string(),
        };
        let mut map = HashMap::new();
        collect_layout_pane_ids_to_map(&layout, "/home/user/project", &mut map);
        assert_eq!(map.get("p1").unwrap(), "/home/user/project");
    }

    #[test]
    fn collect_layout_pane_ids_to_map_split() {
        let layout = LayoutNode::Split {
            direction: SplitDirection::Horizontal,
            sizes: [0.5, 0.5],
            children: Box::new([
                LayoutNode::Leaf {
                    pane_id: "p1".to_string(),
                    pty_id: "pty1".to_string(),
                },
                LayoutNode::Leaf {
                    pane_id: "p2".to_string(),
                    pty_id: "pty2".to_string(),
                },
            ]),
        };
        let mut map = HashMap::new();
        collect_layout_pane_ids_to_map(&layout, "/project", &mut map);
        assert_eq!(map.len(), 2);
        assert_eq!(map.get("p1").unwrap(), "/project");
        assert_eq!(map.get("p2").unwrap(), "/project");
    }

    // === Full lifecycle integration test ===

    #[test]
    fn full_workspace_lifecycle_create_split_close_pane_close_workspace() {
        let h = TestHarness::new();

        // 1. Create two workspaces
        let ws1 = h.create_workspace("WS 1", "").unwrap();
        let ws2 = h.create_workspace("WS 2", "").unwrap();
        assert_eq!(h.workspace_state.read().unwrap().list_workspaces().len(), 2);

        // 2. Split a pane in ws1
        let pane1_id = match &ws1.surfaces[0].layout {
            LayoutNode::Leaf { pane_id, .. } => pane_id.clone(),
            _ => panic!("expected leaf"),
        };

        let new_pane_id = uuid::Uuid::new_v4().to_string();
        let config = crate::pty::types::PtyConfig {
            shell: None,
            cwd: None,
            env: None,
            rows: None,
            cols: None,
        };
        let new_pty_id = h.pty_manager.spawn(config, h.emitter.clone()).unwrap();

        {
            let mut state = h.workspace_state.write().unwrap();
            state
                .split_pane(
                    &pane1_id,
                    SplitDirection::Vertical,
                    new_pane_id.clone(),
                    new_pty_id.clone(),
                )
                .unwrap();
        }

        // 3. Close the new pane
        {
            let mut state = h.workspace_state.write().unwrap();
            let result = state.close_pane(&new_pane_id).unwrap();
            if !result.pty_id.is_empty() {
                drop(state);
                let _ = h.pty_manager.kill(&result.pty_id);
            }
        }

        // 4. Verify ws1 is back to single pane
        {
            let state = h.workspace_state.read().unwrap();
            let ws = state.get_workspace(&ws1.id).unwrap();
            match &ws.surfaces[0].layout {
                LayoutNode::Leaf { pane_id, .. } => assert_eq!(*pane_id, pane1_id),
                _ => panic!("expected leaf after pane close"),
            }
        }

        // 5. Close ws1
        {
            let mut state = h.workspace_state.write().unwrap();
            let pty_ids = state.close_workspace(&ws1.id).unwrap();
            drop(state);
            for pty_id in pty_ids {
                if !pty_id.is_empty() {
                    let _ = h.pty_manager.kill(&pty_id);
                }
            }
        }

        // 6. Only ws2 remains
        let state = h.workspace_state.read().unwrap();
        assert_eq!(state.list_workspaces().len(), 1);
        assert_eq!(state.list_workspaces()[0].id, ws2.id);
    }

    // === Session dirty tracking across operations ===

    #[test]
    fn session_dirty_flag_tracks_modifications() {
        let h = TestHarness::new();
        assert!(!h.session_manager.is_dirty());

        // Create workspace marks dirty
        h.create_workspace("WS", "").unwrap();
        assert!(h.session_manager.is_dirty());

        // Save clears dirty
        let ws = h.workspace_state.read().unwrap();
        h.session_manager.save(&ws).unwrap();
        drop(ws);
        assert!(!h.session_manager.is_dirty());
    }

    // === Scrollback cleanup on pane close ===

    #[test]
    fn scrollback_deleted_on_pane_close() {
        let h = TestHarness::new();
        let ws = h.create_workspace("WS", "").unwrap();
        let pane1_id = match &ws.surfaces[0].layout {
            LayoutNode::Leaf { pane_id, .. } => pane_id.clone(),
            _ => panic!("expected leaf"),
        };

        // Split to create second pane
        let pane2_id = uuid::Uuid::new_v4().to_string();
        let config = crate::pty::types::PtyConfig {
            shell: None,
            cwd: None,
            env: None,
            rows: None,
            cols: None,
        };
        let pty2_id = h.pty_manager.spawn(config, h.emitter.clone()).unwrap();
        {
            let mut state = h.workspace_state.write().unwrap();
            state
                .split_pane(
                    &pane1_id,
                    SplitDirection::Horizontal,
                    pane2_id.clone(),
                    pty2_id,
                )
                .unwrap();
        }

        // Save scrollback for pane2
        h.scrollback_storage
            .save(&pane2_id, b"scrollback data")
            .unwrap();
        assert!(h.scrollback_storage.load(&pane2_id).unwrap().is_some());

        // Close pane2 (simulating what pane_close command does)
        {
            let mut state = h.workspace_state.write().unwrap();
            let result = state.close_pane(&pane2_id).unwrap();
            drop(state);
            if !result.pty_id.is_empty() {
                let _ = h.pty_manager.kill(&result.pty_id);
            }
        }
        // Delete scrollback
        let _ = h.scrollback_storage.delete(&pane2_id);

        // Scrollback should be gone
        assert!(h.scrollback_storage.load(&pane2_id).unwrap().is_none());
    }

    // === PTY lifecycle through commands ===

    #[test]
    fn pty_write_resize_kill_through_manager() {
        let h = TestHarness::new();
        let config = crate::pty::types::PtyConfig {
            shell: None,
            cwd: None,
            env: None,
            rows: None,
            cols: None,
        };
        let pty_id = h.pty_manager.spawn(config, h.emitter.clone()).unwrap();

        // Write (simulates pty_write command)
        let data = base64::engine::general_purpose::STANDARD.encode(b"hello");
        h.pty_manager.write(&pty_id, &data).unwrap();

        // Resize (simulates pty_resize command)
        h.pty_manager.resize(&pty_id, 120, 40).unwrap();

        // Kill (simulates pty_kill command)
        h.pty_manager.kill(&pty_id).unwrap();

        // Write after kill should fail
        let result = h.pty_manager.write(&pty_id, &data);
        assert!(result.is_err());
    }

    #[test]
    fn pty_write_to_nonexistent_returns_error() {
        let h = TestHarness::new();
        let data = base64::engine::general_purpose::STANDARD.encode(b"hello");
        let result = h.pty_manager.write("nonexistent", &data);
        assert!(result.is_err());
    }

    #[test]
    fn pty_resize_to_nonexistent_returns_error() {
        let h = TestHarness::new();
        let result = h.pty_manager.resize("nonexistent", 80, 24);
        assert!(result.is_err());
    }

    #[test]
    fn pty_kill_nonexistent_returns_error() {
        let h = TestHarness::new();
        let result = h.pty_manager.kill("nonexistent");
        assert!(result.is_err());
    }

    #[test]
    fn pty_resize_zero_dimensions_returns_error() {
        let h = TestHarness::new();
        let config = crate::pty::types::PtyConfig {
            shell: None,
            cwd: None,
            env: None,
            rows: None,
            cols: None,
        };
        let pty_id = h.pty_manager.spawn(config, h.emitter.clone()).unwrap();
        let result = h.pty_manager.resize(&pty_id, 0, 24);
        assert!(result.is_err());
    }

    // === Worktree command tests ===

    #[test]
    fn worktree_list_with_nonexistent_project_returns_error() {
        let h = TestHarness::new();
        let store = h.project_store.read().unwrap();
        let result = store.get("nonexistent");
        assert!(result.is_none());
    }

    #[test]
    fn worktree_create_with_nonexistent_project_returns_error() {
        let h = TestHarness::new();
        let store = h.project_store.read().unwrap();
        // Simulates what worktree_create does: first gets project, returns error if missing
        let result = store.get("nonexistent").ok_or_else(|| {
            BackendError::Workspace(crate::error::WorkspaceError::NotFound {
                id: "nonexistent".to_string(),
            })
        });
        assert!(result.is_err());
    }
}
