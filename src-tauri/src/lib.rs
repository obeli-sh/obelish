pub mod commands;
pub mod error;
pub mod pty;
pub mod workspace;

use commands::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::pty_spawn,
            commands::pty_write,
            commands::pty_resize,
            commands::pty_kill,
            commands::workspace_create,
            commands::workspace_close,
            commands::workspace_list,
            commands::pane_split,
            commands::pane_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
