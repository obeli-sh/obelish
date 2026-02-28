use std::sync::Arc;
use tokio::net::UnixStream;

use obelisk_protocol::framing;

use super::IpcContext;

pub async fn handle_connection<C: IpcContext + Send + Sync + 'static>(
    stream: UnixStream,
    context: Arc<C>,
) {
    let (mut reader, mut writer) = tokio::io::split(stream);
    loop {
        match framing::read_message(&mut reader).await {
            Ok(request) => {
                let response = super::handlers::dispatch(
                    &request.method,
                    request.params,
                    &*context,
                    request.id.clone(),
                );
                if let Err(e) = framing::write_message(&mut writer, &response).await {
                    tracing::warn!("Failed to write response: {e}");
                    break;
                }
            }
            Err(obelisk_protocol::framing::FramingError::UnexpectedEof) => {
                break; // Client disconnected
            }
            Err(e) => {
                tracing::warn!("Failed to read request: {e}");
                let error_response = obelisk_protocol::rpc::RpcResponse::error(
                    serde_json::Value::Null,
                    obelisk_protocol::error::ERR_PARSE,
                    format!("Parse error: {e}"),
                );
                let _ = framing::write_message(&mut writer, &error_response).await;
                break;
            }
        }
    }
}
