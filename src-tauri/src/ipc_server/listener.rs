use std::sync::Arc;
use tokio::net::UnixListener;
use tokio::sync::watch;

use super::IpcContext;

pub async fn accept_loop<C: IpcContext + Send + Sync + 'static>(
    listener: UnixListener,
    context: Arc<C>,
    mut shutdown_rx: watch::Receiver<bool>,
) {
    loop {
        tokio::select! {
            result = listener.accept() => {
                match result {
                    Ok((stream, _addr)) => {
                        let ctx = context.clone();
                        tokio::spawn(async move {
                            super::connection::handle_connection(stream, ctx).await;
                        });
                    }
                    Err(e) => {
                        tracing::error!("Failed to accept connection: {e}");
                    }
                }
            }
            _ = shutdown_rx.changed() => {
                tracing::info!("IPC server shutting down");
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

    /// Helper: bind listener and spawn accept_loop, return socket path and shutdown sender.
    async fn setup_accept_loop(
        ctx: TestContext,
    ) -> (PathBuf, watch::Sender<bool>, tokio::task::JoinHandle<()>) {
        let socket_path = ctx.socket_path_buf.clone();
        let listener = tokio::net::UnixListener::bind(&socket_path).unwrap();
        let context = Arc::new(ctx);
        let (shutdown_tx, shutdown_rx) = watch::channel(false);

        let handle = tokio::spawn(accept_loop(listener, context, shutdown_rx));

        (socket_path, shutdown_tx, handle)
    }

    /// Helper: send one request and read the response on a connected stream.
    async fn send_request_and_read_response(
        reader: &mut tokio::io::ReadHalf<tokio::net::UnixStream>,
        writer: &mut tokio::io::WriteHalf<tokio::net::UnixStream>,
        id: serde_json::Value,
    ) -> obelisk_protocol::rpc::RpcResponse {
        let request = RpcRequest {
            jsonrpc: "2.0".to_string(),
            method: METHOD_WORKSPACE_LIST.to_string(),
            params: None,
            id,
        };
        framing::write_request(writer, &request).await.unwrap();
        framing::read_response(reader).await.unwrap()
    }

    #[tokio::test]
    async fn multiple_clients_served_simultaneously() {
        let temp_dir = Arc::new(TempDir::new().unwrap());
        let ctx = TestContext::new(temp_dir.clone());
        let (socket_path, shutdown_tx, server_handle) = setup_accept_loop(ctx).await;

        // Connect three clients concurrently
        let mut handles = Vec::new();
        for i in 0..3 {
            let path = socket_path.clone();
            handles.push(tokio::spawn(async move {
                let stream = tokio::net::UnixStream::connect(&path).await.unwrap();
                let (mut reader, mut writer) = tokio::io::split(stream);
                let resp = send_request_and_read_response(&mut reader, &mut writer, json!(i)).await;
                assert!(resp.error.is_none(), "client {i} should get success");
                assert_eq!(resp.id, json!(i));
                assert_eq!(resp.result, Some(json!([])));
            }));
        }

        for h in handles {
            h.await.expect("client task should not panic");
        }

        let _ = shutdown_tx.send(true);
        let _ = server_handle.await;
    }

    #[tokio::test]
    async fn shutdown_signal_causes_accept_loop_to_exit() {
        let temp_dir = Arc::new(TempDir::new().unwrap());
        let ctx = TestContext::new(temp_dir.clone());
        let (_socket_path, shutdown_tx, server_handle) = setup_accept_loop(ctx).await;

        // Send shutdown signal
        shutdown_tx.send(true).unwrap();

        // accept_loop should exit promptly
        let result = tokio::time::timeout(std::time::Duration::from_secs(2), server_handle).await;
        assert!(
            result.is_ok(),
            "accept_loop should exit after shutdown signal"
        );
        assert!(
            result.unwrap().is_ok(),
            "accept_loop task should not panic on shutdown"
        );
    }

    #[tokio::test]
    async fn accept_continues_after_bad_client() {
        let temp_dir = Arc::new(TempDir::new().unwrap());
        let ctx = TestContext::new(temp_dir.clone());
        let (socket_path, shutdown_tx, server_handle) = setup_accept_loop(ctx).await;

        // Bad client: connect and send garbage, then disconnect
        {
            let stream = tokio::net::UnixStream::connect(&socket_path).await.unwrap();
            let (_, mut writer) = tokio::io::split(stream);
            // Write a valid length prefix with garbage JSON
            let garbage = b"not json at all!!!";
            let len = (garbage.len() as u32).to_be_bytes();
            writer.write_all(&len).await.unwrap();
            writer.write_all(garbage).await.unwrap();
            writer.flush().await.unwrap();
            // Drop the stream
        }

        // Allow the server a moment to process the bad client
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        // Good client: should still be served
        let stream = tokio::net::UnixStream::connect(&socket_path).await.unwrap();
        let (mut reader, mut writer) = tokio::io::split(stream);
        let response = send_request_and_read_response(&mut reader, &mut writer, json!(42)).await;

        assert!(
            response.error.is_none(),
            "good client should get a success response"
        );
        assert_eq!(response.id, json!(42));
        assert_eq!(response.result, Some(json!([])));

        let _ = shutdown_tx.send(true);
        let _ = server_handle.await;
    }
}
