use crate::client::{ClientError, IpcClient};
use obelisk_protocol::methods::*;

pub async fn execute(
    title: String,
    body: Option<String>,
    client: &mut IpcClient,
    _json: bool,
) -> Result<(), ClientError> {
    let params = serde_json::to_value(NotifySendParams {
        title,
        body,
        workspace_id: None,
        pane_id: None,
    })
    .unwrap();
    client.call(METHOD_NOTIFY_SEND, Some(params)).await?;
    println!("Notification sent.");
    Ok(())
}
