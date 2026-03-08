pub mod commands;
pub mod error;
#[cfg(unix)]
pub mod ipc_server;
pub mod metadata;
pub mod notifications;
pub mod persistence;
pub mod project;
pub mod pty;
pub mod scrollback;
pub mod settings;
pub mod workspace;

use std::sync::Arc;
use std::time::Duration;

use commands::AppState;
use persistence::fs::FsPersistence;
use persistence::session::SessionManager;
use settings::manager::SettingsManager;
use tauri::Manager;

#[cfg(unix)]
fn compute_socket_path() -> std::path::PathBuf {
    let runtime_dir = std::env::var("XDG_RUNTIME_DIR")
        .or_else(|_| std::env::var("TMPDIR"))
        .unwrap_or_else(|_| "/tmp".to_string());
    std::path::PathBuf::from(runtime_dir).join(format!("obelisk-{}.sock", std::process::id()))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data directory");

            let backend = Arc::new(
                FsPersistence::new(&app_data_dir).expect("failed to create persistence backend"),
            );
            let session_manager = SessionManager::new(backend.clone());
            let scrollback_storage =
                scrollback::ScrollbackStorage::new(app_data_dir.join("scrollback"))
                    .expect("failed to create scrollback storage");
            let settings_backend = Arc::new(
                FsPersistence::new(app_data_dir.join("settings"))
                    .expect("failed to create settings persistence backend"),
            );
            let settings_manager = SettingsManager::new(settings_backend);

            #[cfg(unix)]
            let socket_path = Some(compute_socket_path());
            #[cfg(not(unix))]
            let socket_path: Option<std::path::PathBuf> = None;

            let project_backend = Arc::new(
                FsPersistence::new(app_data_dir.join("projects"))
                    .expect("failed to create project persistence backend"),
            );
            let mut project_store = project::ProjectStore::new(project_backend);
            if let Err(e) = project_store.load() {
                tracing::warn!("Failed to load projects: {e}");
            }

            let app_state = AppState::new(
                session_manager,
                scrollback_storage,
                settings_manager,
                socket_path.clone(),
                project_store,
            );
            app.manage(app_state);

            // Start IPC server on Unix platforms
            #[cfg(unix)]
            if let Some(socket_path) = socket_path {
                let state = app.state::<AppState>();
                let ipc_context =
                    commands::IpcAppContext::from_app_state(&state, socket_path.clone());
                let app_handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    match ipc_server::IpcServer::start(ipc_context, socket_path).await {
                        Ok(server) => {
                            tracing::info!(
                                "IPC server started at {}",
                                server.socket_path().display()
                            );
                            let state = app_handle.state::<AppState>();
                            state.ipc_server.lock().unwrap().replace(server);
                        }
                        Err(e) => {
                            tracing::error!("Failed to start IPC server: {e}");
                        }
                    }
                });
            }

            // Start autosave timer (30s interval)
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_secs(30));
                loop {
                    interval.tick().await;
                    let state = app_handle.state::<AppState>();
                    if !state.session_manager.is_dirty() {
                        continue;
                    }
                    // Clone session state under lock, then release before I/O
                    let session = {
                        let ws = state
                            .workspace_state
                            .read()
                            .expect("workspace state lock poisoned");
                        ws.to_session_state()
                    };
                    if let Err(e) = state.session_manager.save_from_session(&session) {
                        tracing::error!("Autosave failed: {e}");
                    }
                }
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::pty_spawn,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_kill,
            commands::workspace_create,
            commands::workspace_close,
            commands::workspace_rename,
            commands::workspace_list,
            commands::workspace_reorder,
            commands::pane_split,
            commands::pane_open_browser,
            commands::pane_swap,
            commands::pane_move,
            commands::pane_close,
            commands::session_save,
            commands::session_restore,
            commands::scrollback_save,
            commands::scrollback_load,
            commands::notification_list,
            commands::notification_mark_read,
            commands::notification_clear,
            commands::settings_get,
            commands::settings_update,
            commands::settings_reset,
            commands::shell_list,
            commands::project_list,
            commands::project_add,
            commands::project_remove,
            commands::worktree_list,
            commands::worktree_create,
            commands::list_directories,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let state = app_handle.state::<AppState>();

                // Stop IPC server
                #[cfg(unix)]
                {
                    if let Some(server) = state.ipc_server.lock().unwrap().take() {
                        tauri::async_runtime::block_on(async {
                            if let Err(e) = server.stop().await {
                                tracing::error!("Failed to stop IPC server: {e}");
                            }
                        });
                    }
                }
                let session = {
                    let ws = state
                        .workspace_state
                        .read()
                        .expect("workspace state lock poisoned");
                    ws.to_session_state()
                };
                if let Err(e) = state.session_manager.save_from_session(&session) {
                    tracing::error!("Failed to save state on exit: {e}");
                }
                if let Err(e) = state.session_manager.write_clean_shutdown_marker() {
                    tracing::error!("Failed to write clean shutdown marker: {e}");
                }
            }
        });
}
