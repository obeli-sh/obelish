pub mod notify;
pub mod pane;
pub mod session;
pub mod workspace;

use crate::client::ClientError;
use clap::Subcommand;
use std::path::Path;

#[derive(Subcommand)]
pub enum Command {
    /// Workspace operations
    Workspace {
        #[command(subcommand)]
        action: workspace::WorkspaceAction,
    },
    /// Pane operations
    Pane {
        #[command(subcommand)]
        action: pane::PaneAction,
    },
    /// Send a notification
    Notify {
        /// Notification title
        title: String,
        /// Notification body
        #[arg(long)]
        body: Option<String>,
    },
    /// Session operations
    Session {
        #[command(subcommand)]
        action: session::SessionAction,
    },
}

pub async fn execute(command: Command, socket_path: &Path, json: bool) -> Result<(), ClientError> {
    let mut client = crate::client::IpcClient::connect(socket_path).await?;
    match command {
        Command::Workspace { action } => workspace::execute(action, &mut client, json).await,
        Command::Pane { action } => pane::execute(action, &mut client, json).await,
        Command::Notify { title, body } => notify::execute(title, body, &mut client, json).await,
        Command::Session { action } => session::execute(action, &mut client, json).await,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::Parser;

    #[derive(Parser)]
    #[command(name = "obelisk")]
    struct TestCli {
        #[arg(long, global = true)]
        json: bool,
        #[arg(long, global = true)]
        socket: Option<String>,
        #[command(subcommand)]
        command: Command,
    }

    #[test]
    fn parse_workspace_list() {
        let cli = TestCli::try_parse_from(["obelisk", "workspace", "list"]).unwrap();
        assert!(matches!(
            cli.command,
            Command::Workspace {
                action: workspace::WorkspaceAction::List
            }
        ));
        assert!(!cli.json);
    }

    #[test]
    fn parse_workspace_new_with_name() {
        let cli =
            TestCli::try_parse_from(["obelisk", "workspace", "new", "--name", "Test"]).unwrap();
        match cli.command {
            Command::Workspace {
                action: workspace::WorkspaceAction::New { name },
            } => {
                assert_eq!(name, Some("Test".to_string()));
            }
            _ => panic!("Wrong command parsed"),
        }
    }

    #[test]
    fn parse_workspace_new_without_name() {
        let cli = TestCli::try_parse_from(["obelisk", "workspace", "new"]).unwrap();
        match cli.command {
            Command::Workspace {
                action: workspace::WorkspaceAction::New { name },
            } => {
                assert_eq!(name, None);
            }
            _ => panic!("Wrong command parsed"),
        }
    }

    #[test]
    fn parse_workspace_close() {
        let cli = TestCli::try_parse_from(["obelisk", "workspace", "close", "ws-123"]).unwrap();
        match cli.command {
            Command::Workspace {
                action: workspace::WorkspaceAction::Close { id },
            } => {
                assert_eq!(id, "ws-123");
            }
            _ => panic!("Wrong command parsed"),
        }
    }

    #[test]
    fn parse_workspace_focus() {
        let cli = TestCli::try_parse_from(["obelisk", "workspace", "focus", "ws-123"]).unwrap();
        match cli.command {
            Command::Workspace {
                action: workspace::WorkspaceAction::Focus { id },
            } => {
                assert_eq!(id, "ws-123");
            }
            _ => panic!("Wrong command parsed"),
        }
    }

    #[test]
    fn parse_pane_close() {
        let cli = TestCli::try_parse_from(["obelisk", "pane", "close", "pane-456"]).unwrap();
        match cli.command {
            Command::Pane {
                action: pane::PaneAction::Close { id },
            } => {
                assert_eq!(id, "pane-456");
            }
            _ => panic!("Wrong command parsed"),
        }
    }

    #[test]
    fn parse_notify() {
        let cli =
            TestCli::try_parse_from(["obelisk", "notify", "Hello", "--body", "World"]).unwrap();
        match cli.command {
            Command::Notify { title, body } => {
                assert_eq!(title, "Hello");
                assert_eq!(body, Some("World".to_string()));
            }
            _ => panic!("Wrong command parsed"),
        }
    }

    #[test]
    fn parse_notify_without_body() {
        let cli = TestCli::try_parse_from(["obelisk", "notify", "Hello"]).unwrap();
        match cli.command {
            Command::Notify { title, body } => {
                assert_eq!(title, "Hello");
                assert_eq!(body, None);
            }
            _ => panic!("Wrong command parsed"),
        }
    }

    #[test]
    fn parse_session_info() {
        let cli = TestCli::try_parse_from(["obelisk", "session", "info"]).unwrap();
        assert!(matches!(
            cli.command,
            Command::Session {
                action: session::SessionAction::Info
            }
        ));
    }

    #[test]
    fn parse_session_save() {
        let cli = TestCli::try_parse_from(["obelisk", "session", "save"]).unwrap();
        assert!(matches!(
            cli.command,
            Command::Session {
                action: session::SessionAction::Save
            }
        ));
    }

    #[test]
    fn parse_json_flag() {
        let cli = TestCli::try_parse_from(["obelisk", "--json", "workspace", "list"]).unwrap();
        assert!(cli.json);
    }

    #[test]
    fn parse_socket_override() {
        let cli =
            TestCli::try_parse_from(["obelisk", "--socket", "/tmp/test.sock", "workspace", "list"])
                .unwrap();
        assert_eq!(cli.socket, Some("/tmp/test.sock".to_string()));
    }

    #[test]
    fn parse_invalid_subcommand_fails() {
        let result = TestCli::try_parse_from(["obelisk", "invalid"]);
        assert!(result.is_err());
    }

    #[test]
    fn parse_missing_subcommand_fails() {
        let result = TestCli::try_parse_from(["obelisk"]);
        assert!(result.is_err());
    }
}
