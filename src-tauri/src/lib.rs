pub mod commands;
pub mod error;
pub mod metadata;
pub mod notifications;
pub mod persistence;
pub mod pty;
pub mod scrollback;
pub mod workspace;

use std::sync::Arc;
use std::time::Duration;

use commands::AppState;
use persistence::fs::FsPersistence;
use persistence::session::SessionManager;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("failed to resolve app data directory");

            let backend = Arc::new(
                FsPersistence::new(&app_data_dir).expect("failed to create persistence backend"),
            );
            let session_manager = SessionManager::new(backend);
            let scrollback_storage = scrollback::ScrollbackStorage::new(
                app_data_dir.join("scrollback"),
            )
            .expect("failed to create scrollback storage");
            let app_state = AppState::new(session_manager, scrollback_storage);
            app.manage(app_state);

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
            commands::workspace_list,
            commands::pane_split,
            commands::pane_open_browser,
            commands::pane_close,
            commands::session_save,
            commands::session_restore,
            commands::scrollback_save,
            commands::scrollback_load,
            commands::notification_list,
            commands::notification_mark_read,
            commands::notification_clear,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                let state = app_handle.state::<AppState>();
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
