use crate::error::BackendError;
use crate::pty::emitter::TauriEventEmitter;
use crate::pty::types::{PtyConfig, PtySpawnResult};
use crate::pty::PtyManager;
use crate::workspace::WorkspaceState;
use obelisk_protocol::{SplitDirection, WorkspaceInfo};
use std::collections::HashMap;
use std::sync::{Arc, RwLock};
use tauri::{AppHandle, Emitter, State};

pub struct AppState {
    pub pty_manager: PtyManager,
    pub workspace_state: Arc<RwLock<WorkspaceState>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            pty_manager: PtyManager::new(Arc::new(crate::pty::backend::RealPtyBackend::new())),
            workspace_state: Arc::new(RwLock::new(WorkspaceState::new())),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
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
    name: String,
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

    let mut ws = state.workspace_state.write().unwrap();
    let workspace = ws.create_workspace(name, pane_id, pty_id);

    let _ = app.emit("workspace-changed", &workspace);

    Ok(workspace)
}

#[tauri::command]
#[tracing::instrument(skip(state, app))]
pub fn workspace_close(
    state: State<'_, AppState>,
    app: AppHandle,
    workspace_id: String,
) -> Result<(), BackendError> {
    let pty_ids = {
        let mut ws = state.workspace_state.write().unwrap();
        ws.close_workspace(&workspace_id)?
    };

    for pty_id in pty_ids {
        let _ = state.pty_manager.kill(&pty_id);
    }

    let _ = app.emit("workspace-changed", &workspace_id);

    Ok(())
}

#[tauri::command]
#[tracing::instrument(skip(state))]
pub fn workspace_list(state: State<'_, AppState>) -> Result<Vec<WorkspaceInfo>, BackendError> {
    let ws = state.workspace_state.read().unwrap();
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

    let mut ws = state.workspace_state.write().unwrap();
    let result = ws.split_pane(&pane_id, direction, new_pane_id, new_pty_id)?;

    let _ = app.emit("workspace-changed", &result.workspace);

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
        let mut ws = state.workspace_state.write().unwrap();
        ws.close_pane(&pane_id)?
    };

    let _ = state.pty_manager.kill(&result.pty_id);

    let _ = app.emit("workspace-changed", &pane_id);

    Ok(())
}
