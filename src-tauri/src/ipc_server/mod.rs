pub mod connection;
pub mod discovery;
pub mod error;
pub mod handlers;
pub mod listener;

use std::path::PathBuf;
use tokio::sync::watch;

use error::IpcError;

pub struct IpcServer {
    socket_path: PathBuf,
    shutdown_tx: watch::Sender<bool>,
}

impl IpcServer {
    pub async fn start<C: IpcContext + Send + Sync + 'static>(
        context: C,
        socket_path: PathBuf,
    ) -> Result<Self, IpcError> {
        // Remove stale socket file if it exists
        if socket_path.exists() {
            let _ = std::fs::remove_file(&socket_path);
        }

        let listener =
            tokio::net::UnixListener::bind(&socket_path).map_err(IpcError::BindFailed)?;

        // Restrict socket to owner-only access
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&socket_path, std::fs::Permissions::from_mode(0o600))
                .map_err(|e| {
                    IpcError::BindFailed(std::io::Error::new(
                        e.kind(),
                        format!("failed to set socket permissions: {e}"),
                    ))
                })?;
        }

        let (shutdown_tx, shutdown_rx) = watch::channel(false);

        let ctx = std::sync::Arc::new(context);
        tokio::spawn(listener::accept_loop(listener, ctx, shutdown_rx));

        // Write discovery entry
        let entry = discovery::DiscoveryEntry {
            pid: std::process::id(),
            socket_path: socket_path.to_string_lossy().to_string(),
            started_at: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs(),
        };
        let _ = discovery::write_entry(&entry);

        Ok(Self {
            socket_path,
            shutdown_tx,
        })
    }

    pub fn socket_path(&self) -> &std::path::Path {
        &self.socket_path
    }

    pub async fn stop(&self) -> Result<(), IpcError> {
        let _ = self.shutdown_tx.send(true);
        let _ = std::fs::remove_file(&self.socket_path);
        let _ = discovery::remove_entry(std::process::id());
        Ok(())
    }
}

/// Trait for handler context — allows testing without real AppState
pub trait IpcContext: Clone {
    fn workspace_state(
        &self,
    ) -> &std::sync::Arc<std::sync::RwLock<crate::workspace::WorkspaceState>>;
    fn notification_store(
        &self,
    ) -> &std::sync::Arc<std::sync::RwLock<crate::notifications::store::NotificationStore>>;
    fn session_manager(&self) -> &crate::persistence::session::SessionManager;
    fn server_start_time(&self) -> std::time::Instant;
    fn socket_path(&self) -> &std::path::Path;
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
    use std::sync::{Arc, RwLock};
    use std::time::Instant;
    use tempfile::TempDir;

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

    impl IpcContext for TestContext {
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

    #[tokio::test]
    async fn server_start_and_stop() {
        let temp_dir = Arc::new(TempDir::new().unwrap());
        let ctx = TestContext::new(temp_dir.clone());
        let socket_path = ctx.socket_path_buf.clone();

        let server = IpcServer::start(ctx, socket_path.clone()).await.unwrap();
        assert!(socket_path.exists());

        server.stop().await.unwrap();
        assert!(!socket_path.exists());
    }

    #[tokio::test]
    async fn server_handles_request() {
        let temp_dir = Arc::new(TempDir::new().unwrap());
        let ctx = TestContext::new(temp_dir.clone());
        let socket_path = ctx.socket_path_buf.clone();

        let server = IpcServer::start(ctx, socket_path.clone()).await.unwrap();

        // Connect and send a request
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

        assert!(response.error.is_none());
        assert_eq!(response.result, Some(json!([])));
        assert_eq!(response.id, json!(1));

        server.stop().await.unwrap();
    }

    #[tokio::test]
    async fn server_handles_multiple_requests_on_same_connection() {
        let temp_dir = Arc::new(TempDir::new().unwrap());
        let ctx = TestContext::new(temp_dir.clone());
        let socket_path = ctx.socket_path_buf.clone();

        let server = IpcServer::start(ctx, socket_path.clone()).await.unwrap();

        let stream = tokio::net::UnixStream::connect(&socket_path).await.unwrap();
        let (mut reader, mut writer) = tokio::io::split(stream);

        // First request: workspace.list
        let req1 = RpcRequest {
            jsonrpc: "2.0".to_string(),
            method: METHOD_WORKSPACE_LIST.to_string(),
            params: None,
            id: json!(1),
        };
        framing::write_request(&mut writer, &req1).await.unwrap();
        let resp1 = framing::read_response(&mut reader).await.unwrap();
        assert!(resp1.error.is_none());
        assert_eq!(resp1.id, json!(1));

        // Second request: workspace.create
        let req2 = RpcRequest {
            jsonrpc: "2.0".to_string(),
            method: obelisk_protocol::methods::METHOD_WORKSPACE_CREATE.to_string(),
            params: Some(json!({"name": "Test"})),
            id: json!(2),
        };
        framing::write_request(&mut writer, &req2).await.unwrap();
        let resp2 = framing::read_response(&mut reader).await.unwrap();
        assert!(resp2.error.is_none());
        assert_eq!(resp2.id, json!(2));
        assert_eq!(resp2.result.as_ref().unwrap()["name"], "Test");

        server.stop().await.unwrap();
    }

    #[tokio::test]
    async fn server_handles_client_disconnect() {
        let temp_dir = Arc::new(TempDir::new().unwrap());
        let ctx = TestContext::new(temp_dir.clone());
        let socket_path = ctx.socket_path_buf.clone();

        let server = IpcServer::start(ctx, socket_path.clone()).await.unwrap();

        // Connect, send one request, then drop the connection
        {
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
            assert!(response.error.is_none());
        }
        // Connection dropped here

        // Give the server a moment to handle the disconnect
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;

        // Server should still be running and accept new connections
        let stream = tokio::net::UnixStream::connect(&socket_path).await.unwrap();
        let (mut reader, mut writer) = tokio::io::split(stream);

        let request = RpcRequest {
            jsonrpc: "2.0".to_string(),
            method: METHOD_WORKSPACE_LIST.to_string(),
            params: None,
            id: json!(2),
        };
        framing::write_request(&mut writer, &request).await.unwrap();
        let response = framing::read_response(&mut reader).await.unwrap();
        assert!(response.error.is_none());
        assert_eq!(response.id, json!(2));

        server.stop().await.unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn socket_has_owner_only_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let temp_dir = Arc::new(TempDir::new().unwrap());
        let ctx = TestContext::new(temp_dir.clone());
        let socket_path = ctx.socket_path_buf.clone();

        let server = IpcServer::start(ctx, socket_path.clone()).await.unwrap();

        let metadata = std::fs::metadata(&socket_path).unwrap();
        let mode = metadata.permissions().mode() & 0o777;
        assert_eq!(
            mode, 0o600,
            "Socket should have 0600 permissions, got {:o}",
            mode
        );

        server.stop().await.unwrap();
    }
}
