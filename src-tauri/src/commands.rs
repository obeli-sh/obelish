use crate::error::BackendError;
use crate::persistence::session::SessionManager;
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
    pub session_manager: SessionManager,
}

impl AppState {
    pub fn new(session_manager: SessionManager) -> Self {
        Self {
            pty_manager: PtyManager::new(Arc::new(crate::pty::backend::RealPtyBackend::new())),
            workspace_state: Arc::new(RwLock::new(WorkspaceState::new())),
            session_manager,
        }
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
    let pty_ids = {
        let mut ws = state
            .workspace_state
            .write()
            .expect("workspace state lock poisoned");
        ws.close_workspace(&workspace_id)?
    };

    for pty_id in pty_ids {
        let _ = state.pty_manager.kill(&pty_id);
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

    let _ = state.pty_manager.kill(&result.pty_id);

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

    // Spawn PTYs for each pane
    for pane in session.panes.values() {
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
