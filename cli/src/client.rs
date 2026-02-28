use obelisk_protocol::framing;
use obelisk_protocol::rpc::{RpcRequest, RpcResponse};
use std::path::Path;
use thiserror::Error;
use tokio::net::UnixStream;

#[derive(Debug, Error)]
pub enum ClientError {
    #[error("failed to connect to {path}: {source}")]
    ConnectionFailed {
        path: String,
        source: std::io::Error,
    },
    #[error("failed to send request: {0}")]
    SendFailed(#[from] obelisk_protocol::framing::FramingError),
    #[error("server returned error: [{code}] {message}")]
    RpcError { code: i32, message: String },
}

#[derive(Debug)]
pub struct IpcClient {
    reader: tokio::io::ReadHalf<UnixStream>,
    writer: tokio::io::WriteHalf<UnixStream>,
}

impl IpcClient {
    pub async fn connect(path: &Path) -> Result<Self, ClientError> {
        let stream =
            UnixStream::connect(path)
                .await
                .map_err(|e| ClientError::ConnectionFailed {
                    path: path.display().to_string(),
                    source: e,
                })?;
        let (reader, writer) = tokio::io::split(stream);
        Ok(Self { reader, writer })
    }

    pub async fn send(&mut self, request: RpcRequest) -> Result<RpcResponse, ClientError> {
        framing::write_request(&mut self.writer, &request)
            .await
            .map_err(ClientError::SendFailed)?;
        let response = framing::read_response(&mut self.reader)
            .await
            .map_err(ClientError::SendFailed)?;
        Ok(response)
    }

    /// Convenience: send and check for RPC error, returning the result value or error
    pub async fn call(
        &mut self,
        method: &str,
        params: Option<serde_json::Value>,
    ) -> Result<serde_json::Value, ClientError> {
        let request = RpcRequest {
            jsonrpc: "2.0".to_string(),
            method: method.to_string(),
            params,
            id: serde_json::Value::Number(1.into()),
        };
        let response = self.send(request).await?;
        if let Some(error) = response.error {
            return Err(ClientError::RpcError {
                code: error.code,
                message: error.message,
            });
        }
        Ok(response.result.unwrap_or(serde_json::Value::Null))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use obelisk_protocol::framing;
    use obelisk_protocol::rpc::RpcResponse;
    use serde_json::json;
    use tokio::net::UnixListener;

    #[tokio::test]
    async fn connect_to_nonexistent_socket_fails() {
        let result = IpcClient::connect(Path::new("/tmp/nonexistent-obelisk-test.sock")).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, ClientError::ConnectionFailed { .. }));
        assert!(err.to_string().contains("failed to connect to"));
    }

    #[tokio::test]
    async fn send_and_receive_success_response() {
        let dir = tempfile::tempdir().unwrap();
        let sock_path = dir.path().join("test.sock");

        let listener = UnixListener::bind(&sock_path).unwrap();

        // Spawn a mock server
        let server_handle = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (mut reader, mut writer) = tokio::io::split(stream);

            // Read the request
            let req = framing::read_message(&mut reader).await.unwrap();
            assert_eq!(req.method, "test.method");

            // Send back a success response
            let resp = RpcResponse::success(req.id, json!({"status": "ok"}));
            framing::write_message(&mut writer, &resp).await.unwrap();
        });

        let mut client = IpcClient::connect(&sock_path).await.unwrap();
        let result = client.call("test.method", None).await.unwrap();
        assert_eq!(result, json!({"status": "ok"}));

        server_handle.await.unwrap();
    }

    #[tokio::test]
    async fn send_and_receive_error_response() {
        let dir = tempfile::tempdir().unwrap();
        let sock_path = dir.path().join("test.sock");

        let listener = UnixListener::bind(&sock_path).unwrap();

        let server_handle = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (mut reader, mut writer) = tokio::io::split(stream);

            let req = framing::read_message(&mut reader).await.unwrap();

            let resp = RpcResponse::error(req.id, -32601, "Method not found".to_string());
            framing::write_message(&mut writer, &resp).await.unwrap();
        });

        let mut client = IpcClient::connect(&sock_path).await.unwrap();
        let result = client.call("nonexistent.method", None).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(matches!(err, ClientError::RpcError { code: -32601, .. }));
        assert!(err.to_string().contains("Method not found"));

        server_handle.await.unwrap();
    }

    #[tokio::test]
    async fn call_with_params() {
        let dir = tempfile::tempdir().unwrap();
        let sock_path = dir.path().join("test.sock");

        let listener = UnixListener::bind(&sock_path).unwrap();

        let server_handle = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (mut reader, mut writer) = tokio::io::split(stream);

            let req = framing::read_message(&mut reader).await.unwrap();
            assert_eq!(req.method, "workspace.create");
            assert_eq!(req.params, Some(json!({"name": "test-ws"})));

            let resp = RpcResponse::success(req.id, json!({"id": "ws-1"}));
            framing::write_message(&mut writer, &resp).await.unwrap();
        });

        let mut client = IpcClient::connect(&sock_path).await.unwrap();
        let result = client
            .call("workspace.create", Some(json!({"name": "test-ws"})))
            .await
            .unwrap();
        assert_eq!(result, json!({"id": "ws-1"}));

        server_handle.await.unwrap();
    }

    #[test]
    fn client_error_display() {
        let err = ClientError::RpcError {
            code: -32600,
            message: "Invalid Request".to_string(),
        };
        assert_eq!(
            err.to_string(),
            "server returned error: [-32600] Invalid Request"
        );
    }
}
