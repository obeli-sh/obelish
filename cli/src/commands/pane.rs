use crate::client::{ClientError, IpcClient};
use clap::Subcommand;
use obelisk_protocol::methods::*;

#[derive(Subcommand)]
pub enum PaneAction {
    /// Close a pane
    Close {
        /// Pane ID
        id: String,
    },
}

pub async fn execute(
    action: PaneAction,
    client: &mut IpcClient,
    _json: bool,
) -> Result<(), ClientError> {
    match action {
        PaneAction::Close { id } => {
            let params = serde_json::to_value(PaneCloseParams { pane_id: id }).unwrap();
            client.call(METHOD_PANE_CLOSE, Some(params)).await?;
            println!("Pane closed.");
        }
    }
    Ok(())
}
