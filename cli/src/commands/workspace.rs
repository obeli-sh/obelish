use crate::client::{ClientError, IpcClient};
use crate::output;
use clap::Subcommand;
use obelisk_protocol::methods::*;

#[derive(Subcommand)]
pub enum WorkspaceAction {
    /// Create a new workspace
    New {
        /// Workspace name
        #[arg(long)]
        name: Option<String>,
    },
    /// List all workspaces
    List,
    /// Close a workspace
    Close {
        /// Workspace ID
        id: String,
    },
    /// Focus a workspace
    Focus {
        /// Workspace ID
        id: String,
    },
}

pub async fn execute(
    action: WorkspaceAction,
    client: &mut IpcClient,
    json: bool,
) -> Result<(), ClientError> {
    match action {
        WorkspaceAction::New { name } => {
            let params = serde_json::to_value(WorkspaceCreateParams {
                name,
                shell: None,
                cwd: None,
            })
            .unwrap();
            let result = client.call(METHOD_WORKSPACE_CREATE, Some(params)).await?;
            output::print_result(&result, json);
        }
        WorkspaceAction::List => {
            let result = client.call(METHOD_WORKSPACE_LIST, None).await?;
            output::print_result(&result, json);
        }
        WorkspaceAction::Close { id } => {
            let params = serde_json::to_value(WorkspaceCloseParams { id }).unwrap();
            client.call(METHOD_WORKSPACE_CLOSE, Some(params)).await?;
            println!("Workspace closed.");
        }
        WorkspaceAction::Focus { id } => {
            let params = serde_json::to_value(WorkspaceFocusParams { id }).unwrap();
            client.call(METHOD_WORKSPACE_FOCUS, Some(params)).await?;
            println!("Workspace focused.");
        }
    }
    Ok(())
}
