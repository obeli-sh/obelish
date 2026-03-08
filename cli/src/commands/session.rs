use crate::client::{ClientError, IpcClient};
use crate::output;
use clap::Subcommand;
use obelisk_protocol::methods::*;

#[derive(Subcommand)]
pub enum SessionAction {
    /// Show session info
    Info,
    /// Save session state
    Save,
}

pub async fn execute(
    action: SessionAction,
    client: &mut IpcClient,
    json: bool,
) -> Result<(), ClientError> {
    match action {
        SessionAction::Info => {
            let result = client.call(METHOD_SESSION_INFO, None).await?;
            output::print_result(&result, json);
        }
        SessionAction::Save => {
            client.call(METHOD_SESSION_SAVE, None).await?;
            println!("Session saved.");
        }
    }
    Ok(())
}
