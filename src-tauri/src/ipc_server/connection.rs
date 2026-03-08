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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notifications::store::NotificationStore;
    use crate::persistence::fs::FsPersistence;
    use crate::persistence::session::SessionManager;
    use crate::workspace::WorkspaceState;
    use obelisk_protocol::framing;
    use obelisk_protocol::methods::METHOD_WORKSPACE_LIST;
    use obelisk_protocol::rpc::RpcRequest;
    use serde_json::json;
    use std::path::PathBuf;
    use std::sync::{Arc, RwLock};
    use std::time::Instant;
    use tempfile::TempDir;
    use tokio::io::AsyncWriteExt;

    #[derive(Clone)]
    struct TestContext {
        workspace_state: Arc<RwLock<WorkspaceState>>,
        notification_store: Arc<RwLock<NotificationStore>>,
        session_manager: Arc<SessionManager>,
        start_time: Instant,
        socket_path_buf: PathBuf,
        _temp_dir: Arc<TempDir>,
    }

    impl TestContext {
        fn new(temp_dir: Arc<TempDir>) -> Self {
            let persist_dir = temp_dir.path().join("persist");
            std::fs::create_dir_all(&persist_dir).unwrap();
            let backend = Arc::new(FsPersistence::new(&persist_dir).unwrap());
            let socket_path = temp_dir.path().join("test.sock");
            Self {
                workspace_state: Arc::new(RwLock::new(WorkspaceState::new())),
                notification_store: Arc::new(RwLock::new(NotificationStore::new(100))),
                session_manager: Arc::new(SessionManager::new(backend)),
                start_time: Instant::now(),
                socket_path_buf: socket_path,
                _temp_dir: temp_dir,
            }
        }
    }

    impl super::super::IpcContext for TestContext {
        fn workspace_state(&self) -> &Arc<RwLock<WorkspaceState>> {
            &self.workspace_state
        }
        fn notification_store(&self) -> &Arc<RwLock<NotificationStore>> {
            &self.notification_store
        }
        fn session_manager(&self) -> &SessionManager {
            &self.session_manager
        }
        fn server_start_time(&self) -> Instant {
            self.start_time
        }
        fn socket_path(&self) -> &std::path::Path {
            &self.socket_path_buf
        }
    }

    /// Helper: bind a listener, spawn handle_connection, return socket path for clients.
    async fn setup_server(ctx: TestContext) -> (PathBuf, tokio::task::JoinHandle<()>) {
        let socket_path = ctx.socket_path_buf.clone();
        let listener = tokio::net::UnixListener::bind(&socket_path).unwrap();
        let context = Arc::new(ctx);

        let handle = tokio::spawn(async move {
            // Accept exactly one connection and handle it
            if let Ok((stream, _)) = listener.accept().await {
                handle_connection(stream, context).await;
            }
        });

        (socket_path, handle)
    }

    #[tokio::test]
    async fn round_trip_request_response() {
        let temp_dir = Arc::new(TempDir::new().unwrap());
        let ctx = TestContext::new(temp_dir.clone());
        let (socket_path, server_handle) = setup_server(ctx).await;

        let stream = tokio::net::UnixStream::connect(&socket_path).await.unwrap();
        let (mut reader, mut writer) = tokio::io::split(stream);

        let request = RpcRequest {
            jsonrpc: "2.0".to_string(),
            method: METHOD_WORKSPACE_LIST.to_string(),
            params: None,
            id: json!(1),
        };

        framing::write_request(&mut writer, &request).await.unwrap();
        let response = framing::read_response(&mut reader).await.unwrap();

        assert!(response.error.is_none(), "expected success response");
        assert_eq!(response.id, json!(1));
        assert_eq!(response.result, Some(json!([])));

        drop(writer);
        drop(reader);
        let _ = server_handle.await;
    }

    #[tokio::test]
    async fn client_disconnect_handled_gracefully() {
        let temp_dir = Arc::new(TempDir::new().unwrap());
        let ctx = TestContext::new(temp_dir.clone());
        let (socket_path, server_handle) = setup_server(ctx).await;

        // Connect and immediately drop — server should not panic
        {
            let _stream = tokio::net::UnixStream::connect(&socket_path).await.unwrap();
            // stream is dropped here
        }

        // Server task should finish without error
        let result = tokio::time::timeout(std::time::Duration::from_secs(2), server_handle).await;
        assert!(result.is_ok(), "server should exit after client disconnect");
        assert!(
            result.unwrap().is_ok(),
            "server task should not panic on client disconnect"
        );
    }

    #[tokio::test]
    async fn malformed_frame_returns_parse_error() {
        let temp_dir = Arc::new(TempDir::new().unwrap());
        let ctx = TestContext::new(temp_dir.clone());
        let (socket_path, server_handle) = setup_server(ctx).await;

        let stream = tokio::net::UnixStream::connect(&socket_path).await.unwrap();
        let (mut reader, mut writer) = tokio::io::split(stream);

        // Write a valid length prefix but garbage JSON body
        let garbage = b"this is not valid json";
        let len = (garbage.len() as u32).to_be_bytes();
        writer.write_all(&len).await.unwrap();
        writer.write_all(garbage).await.unwrap();
        writer.flush().await.unwrap();

        // Server should send back an error response
        let response = framing::read_response(&mut reader).await.unwrap();
        assert!(
            response.error.is_some(),
            "expected error response for malformed frame"
        );
        assert_eq!(
            response.error.as_ref().unwrap().code,
            obelisk_protocol::error::ERR_PARSE,
        );
        assert_eq!(response.id, serde_json::Value::Null);

        drop(writer);
        drop(reader);
        let _ = server_handle.await;
    }

    #[tokio::test]
    async fn sequential_requests_on_same_connection() {
        let temp_dir = Arc::new(TempDir::new().unwrap());
        let ctx = TestContext::new(temp_dir.clone());
        let (socket_path, server_handle) = setup_server(ctx).await;

        let stream = tokio::net::UnixStream::connect(&socket_path).await.unwrap();
        let (mut reader, mut writer) = tokio::io::split(stream);

        // Send three sequential requests
        for i in 1..=3 {
            let request = RpcRequest {
                jsonrpc: "2.0".to_string(),
                method: METHOD_WORKSPACE_LIST.to_string(),
                params: None,
                id: json!(i),
            };
            framing::write_request(&mut writer, &request).await.unwrap();
            let response = framing::read_response(&mut reader).await.unwrap();
            assert!(response.error.is_none(), "request {i} should succeed");
            assert_eq!(response.id, json!(i), "response id should match request id");
            assert_eq!(response.result, Some(json!([])));
        }

        drop(writer);
        drop(reader);
        let _ = server_handle.await;
    }
}
