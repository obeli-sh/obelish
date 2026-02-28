use crate::error::BackendError;
use crate::notifications::store::NotificationStore;
use crate::persistence::session::SessionManager;
use crate::pty::emitter::TauriEventEmitter;
use crate::pty::types::{PtyConfig, PtySpawnResult};
use crate::pty::PtyManager;
use crate::scrollback::ScrollbackStorage;
use crate::settings::manager::SettingsManager;
use crate::settings::Settings;
use crate::workspace::WorkspaceState;
use base64::Engine as _;
use obelisk_protocol::{LayoutNode, Notification, SplitDirection, WorkspaceInfo};
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
    pub server_start_time: Instant,
    pub ipc_socket_path: PathBuf,
}

impl AppState {
    pub fn new(
        session_manager: SessionManager,
        scrollback_storage: ScrollbackStorage,
        settings_manager: SettingsManager,
        ipc_socket_path: PathBuf,
    ) -> Self {
        Self {
            pty_manager: PtyManager::new(Arc::new(crate::pty::backend::RealPtyBackend::new())),
            workspace_state: Arc::new(RwLock::new(WorkspaceState::new())),
            session_manager: Arc::new(session_manager),
            scrollback_storage,
            notification_store: Arc::new(RwLock::new(NotificationStore::new(1000))),
            settings_manager,
            server_start_time: Instant::now(),
            ipc_socket_path,
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
    pub fn from_app_state(state: &AppState) -> Self {
        Self {
            workspace_state: state.workspace_state.clone(),
            notification_store: state.notification_store.clone(),
            session_manager: state.session_manager.clone(),
            server_start_time: state.server_start_time,
            ipc_socket_path: state.ipc_socket_path.clone(),
        }
    }
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
    name: Option<String>,
    shell: Option<String>,
    cwd: Option<String>,
) -> Result<WorkspaceInfo, BackendError> {
    let pane_id = uuid::Uuid::new_v4().to_string();

    let config = PtyConfig {
        shell,
        cwd,
        env: None,
        rows: None,
        cols: None,
    };
    let emitter = Arc::new(TauriEventEmitter::new(app.clone()));
    let pty_id = state.pty_manager.spawn(config, emitter)?;

    let ws_name = name.unwrap_or_else(|| {
        let ws = state
            .workspace_state
            .read()
            .expect("workspace state lock poisoned");
        format!("Workspace {}", ws.list_workspaces().len() + 1)
    });

    let mut ws = state
        .workspace_state
        .write()
        .expect("workspace state lock poisoned");
    let workspace = ws.create_workspace(ws_name, pane_id, pty_id);

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

    state.session_manager.mark_dirty();

    let _ = app.emit(
        "workspace-removed",
        serde_json::json!({ "workspaceId": workspace_id }),
    );

    Ok(())
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
#[tracing::instrument(skip(state, app))]
pub fn pane_split(
    state: State<'_, AppState>,
    app: AppHandle,
    pane_id: String,
    direction: SplitDirection,
    shell: Option<String>,
    cwd: Option<String>,
) -> Result<WorkspaceInfo, BackendError> {
    let new_pane_id = uuid::Uuid::new_v4().to_string();

    let config = PtyConfig {
        shell,
        cwd,
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

    if !result.pty_id.is_empty() {
        let _ = state.pty_manager.kill(&result.pty_id);
    }

    if let Err(e) = state.scrollback_storage.delete(&pane_id) {
        tracing::warn!("Failed to delete scrollback for pane {pane_id}: {e}");
    }

    state.session_manager.mark_dirty();

    if let Some(workspace) = &result.workspace {
        let _ = app.emit(
            "workspace-changed",
            serde_json::json!({ "workspaceId": workspace.id, "workspace": workspace }),
        );
    } else {
        // Workspace was closed because last pane was removed
        let _ = app.emit(
            "workspace-removed",
            serde_json::json!({ "workspaceId": "closed" }),
        );
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

    // Spawn PTYs for each pane (skip browser panes which don't need PTYs)
    for pane in session.panes.values() {
        if matches!(pane.pane_type, obelisk_protocol::PaneType::Browser) {
            continue;
        }

        let cwd = pane.cwd.as_deref().and_then(|c| {
            if std::path::Path::new(c).exists() {
                Some(c.to_string())
            } else {
                tracing::warn!("Saved cwd {c} no longer exists, using default");
                None
            }
        });

        let config = PtyConfig {
            shell: None,
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

fn create_default_workspace(
    state: &State<'_, AppState>,
    app: &AppHandle,
) -> Result<Vec<WorkspaceInfo>, BackendError> {
    let pane_id = uuid::Uuid::new_v4().to_string();
    let config = PtyConfig {
        shell: None,
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
    let workspace = ws.create_workspace("Workspace 1".to_string(), pane_id, pty_id);

    let _ = app.emit(
        "workspace-changed",
        serde_json::json!({ "workspaceId": workspace.id, "workspace": workspace }),
    );

    Ok(vec![workspace])
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
        AppState::new(
            session_manager,
            scrollback_storage,
            settings_manager,
            socket_path,
        )
    }

    #[test]
    fn ipc_app_context_from_app_state_shares_workspace() {
        let tmp = TempDir::new().unwrap();
        let app_state = make_app_state(&tmp);

        // Create a workspace in AppState
        {
            let mut ws = app_state.workspace_state.write().unwrap();
            ws.create_workspace("Test".to_string(), "p1".to_string(), "pty1".to_string());
        }

        let ipc_ctx = IpcAppContext::from_app_state(&app_state);

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

        let ipc_ctx = IpcAppContext::from_app_state(&app_state);

        // IpcAppContext should see the same notification
        let store = ipc_ctx.notification_store().read().unwrap();
        assert_eq!(store.list().len(), 1);
        assert_eq!(store.list()[0].title, "Hello");
    }

    #[test]
    fn ipc_app_context_returns_correct_socket_path() {
        let tmp = TempDir::new().unwrap();
        let app_state = make_app_state(&tmp);
        let ipc_ctx = IpcAppContext::from_app_state(&app_state);

        assert_eq!(ipc_ctx.socket_path(), tmp.path().join("test.sock"));
    }

    #[test]
    fn ipc_app_context_returns_server_start_time() {
        let tmp = TempDir::new().unwrap();
        let app_state = make_app_state(&tmp);
        let before = Instant::now();
        let ipc_ctx = IpcAppContext::from_app_state(&app_state);
        // start_time should be very close to now (set during AppState::new)
        let elapsed = before.elapsed();
        let ctx_elapsed = ipc_ctx.server_start_time().elapsed();
        assert!(ctx_elapsed >= elapsed || ctx_elapsed.as_millis() < 1000);
    }

    #[test]
    fn ipc_app_context_session_manager_works() {
        let tmp = TempDir::new().unwrap();
        let app_state = make_app_state(&tmp);
        let ipc_ctx = IpcAppContext::from_app_state(&app_state);

        // Session manager should be functional
        assert!(!ipc_ctx.session_manager().is_dirty());
        ipc_ctx.session_manager().mark_dirty();
        assert!(ipc_ctx.session_manager().is_dirty());
        // Should be visible through the shared Arc
        assert!(app_state.session_manager.is_dirty());
    }

    #[tokio::test]
    async fn ipc_server_starts_with_app_context() {
        let tmp = TempDir::new().unwrap();
        let app_state = make_app_state(&tmp);
        let socket_path = tmp.path().join("ipc-test.sock");
        let mut ipc_ctx = IpcAppContext::from_app_state(&app_state);
        ipc_ctx.ipc_socket_path = socket_path.clone();

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
