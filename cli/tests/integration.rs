#![cfg(unix)]

//! CLI integration tests: IPC round-trip over Unix socket.
//!
//! These tests create a mock IPC server using obelisk-protocol framing,
//! then send CLI-style RPC requests and verify responses. This validates
//! the full wire protocol without depending on the main obelisk crate.

use std::path::PathBuf;
use std::sync::{Arc, RwLock};

use obelisk_protocol::error::*;
use obelisk_protocol::framing;
use obelisk_protocol::methods::*;
use obelisk_protocol::rpc::{RpcRequest, RpcResponse};
use serde_json::{json, Value};
use tempfile::TempDir;
use tokio::net::UnixListener;

// ---------------------------------------------------------------------------
// Mock server state & dispatcher
// ---------------------------------------------------------------------------

/// Lightweight workspace record for mock server state.
#[derive(Clone, Debug)]
struct MockWorkspace {
    id: String,
    name: String,
}

/// Shared mock server state behind a lock.
#[derive(Clone)]
struct MockState {
    workspaces: Arc<RwLock<Vec<MockWorkspace>>>,
    notifications: Arc<RwLock<Vec<Value>>>,
    session_saved: Arc<RwLock<bool>>,
}

impl MockState {
    fn new() -> Self {
        Self {
            workspaces: Arc::new(RwLock::new(Vec::new())),
            notifications: Arc::new(RwLock::new(Vec::new())),
            session_saved: Arc::new(RwLock::new(false)),
        }
    }
}

/// Dispatch an incoming RPC request against mock state, returning an RpcResponse.
fn mock_dispatch(method: &str, params: Option<Value>, state: &MockState, id: Value) -> RpcResponse {
    match method {
        METHOD_WORKSPACE_LIST => {
            let ws = state.workspaces.read().unwrap();
            let list: Vec<Value> = ws
                .iter()
                .map(|w| json!({"id": w.id, "name": w.name}))
                .collect();
            RpcResponse::success(id, json!(list))
        }
        METHOD_WORKSPACE_CREATE => {
            let name = params
                .as_ref()
                .and_then(|p| p.get("name"))
                .and_then(|n| n.as_str())
                .map(|s| s.to_string());

            let ws_id = uuid::Uuid::new_v4().to_string();
            let ws_name = name.unwrap_or_else(|| {
                let ws = state.workspaces.read().unwrap();
                format!("Workspace {}", ws.len() + 1)
            });

            let workspace = MockWorkspace {
                id: ws_id.clone(),
                name: ws_name.clone(),
            };
            state.workspaces.write().unwrap().push(workspace);

            RpcResponse::success(
                id,
                json!({
                    "id": ws_id,
                    "name": ws_name,
                    "surfaces": [],
                    "activeSurfaceIndex": 0,
                    "createdAt": 0,
                }),
            )
        }
        METHOD_WORKSPACE_CLOSE => {
            let close_id = match params
                .as_ref()
                .and_then(|p| p.get("id"))
                .and_then(|v| v.as_str())
            {
                Some(s) => s.to_string(),
                None => {
                    return RpcResponse::error(
                        id,
                        ERR_INVALID_PARAMS,
                        "Missing or invalid params".to_string(),
                    );
                }
            };

            let mut ws = state.workspaces.write().unwrap();
            if let Some(pos) = ws.iter().position(|w| w.id == close_id) {
                if ws.len() <= 1 {
                    return RpcResponse::error(
                        id,
                        ERR_WORKSPACE_NOT_FOUND,
                        "Cannot close last workspace".to_string(),
                    );
                }
                ws.remove(pos);
                RpcResponse::success(id, json!(null))
            } else {
                RpcResponse::error(
                    id,
                    ERR_WORKSPACE_NOT_FOUND,
                    format!("Workspace not found: {close_id}"),
                )
            }
        }
        METHOD_SESSION_SAVE => {
            *state.session_saved.write().unwrap() = true;
            RpcResponse::success(id, json!(null))
        }
        METHOD_NOTIFY_SEND => {
            let title = match params
                .as_ref()
                .and_then(|p| p.get("title"))
                .and_then(|v| v.as_str())
            {
                Some(s) => s.to_string(),
                None => {
                    return RpcResponse::error(
                        id,
                        ERR_INVALID_PARAMS,
                        "Missing title param".to_string(),
                    );
                }
            };
            let body = params
                .as_ref()
                .and_then(|p| p.get("body"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string());

            state
                .notifications
                .write()
                .unwrap()
                .push(json!({"title": title, "body": body}));

            RpcResponse::success(id, json!(null))
        }
        METHOD_SESSION_INFO => RpcResponse::success(
            id,
            json!({
                "pid": std::process::id(),
                "socket_path": "/tmp/mock.sock",
                "workspace_count": state.workspaces.read().unwrap().len(),
                "uptime_secs": 42,
            }),
        ),
        _ => RpcResponse::error(
            id,
            ERR_METHOD_NOT_FOUND,
            format!("Method not found: {method}"),
        ),
    }
}

// ---------------------------------------------------------------------------
// Mock server accept loop
// ---------------------------------------------------------------------------

/// Spawn a mock IPC server that accepts connections and dispatches requests.
/// Returns the socket path, a shutdown sender, and the join handle.
async fn start_mock_server(
    temp_dir: &TempDir,
) -> (
    PathBuf,
    MockState,
    tokio::sync::watch::Sender<bool>,
    tokio::task::JoinHandle<()>,
) {
    let socket_path = temp_dir.path().join("test.sock");
    let listener = UnixListener::bind(&socket_path).unwrap();
    let state = MockState::new();
    let (shutdown_tx, mut shutdown_rx) = tokio::sync::watch::channel(false);

    let server_state = state.clone();
    let handle = tokio::spawn(async move {
        loop {
            tokio::select! {
                result = listener.accept() => {
                    match result {
                        Ok((stream, _)) => {
                            let st = server_state.clone();
                            tokio::spawn(async move {
                                let (mut reader, mut writer) = tokio::io::split(stream);
                                loop {
                                    match framing::read_message(&mut reader).await {
                                        Ok(request) => {
                                            let response = mock_dispatch(
                                                &request.method,
                                                request.params,
                                                &st,
                                                request.id.clone(),
                                            );
                                            if framing::write_message(&mut writer, &response).await.is_err() {
                                                break;
                                            }
                                        }
                                        Err(obelisk_protocol::framing::FramingError::UnexpectedEof) => break,
                                        Err(_) => break,
                                    }
                                }
                            });
                        }
                        Err(_) => break,
                    }
                }
                _ = shutdown_rx.changed() => break,
            }
        }
    });

    (socket_path, state, shutdown_tx, handle)
}

/// Helper: connect to the mock server and return split reader/writer.
async fn connect(
    socket_path: &std::path::Path,
) -> (
    tokio::io::ReadHalf<tokio::net::UnixStream>,
    tokio::io::WriteHalf<tokio::net::UnixStream>,
) {
    let stream = tokio::net::UnixStream::connect(socket_path).await.unwrap();
    tokio::io::split(stream)
}

/// Helper: send an RPC request and read the response.
async fn rpc_call(
    reader: &mut tokio::io::ReadHalf<tokio::net::UnixStream>,
    writer: &mut tokio::io::WriteHalf<tokio::net::UnixStream>,
    method: &str,
    params: Option<Value>,
    id: Value,
) -> RpcResponse {
    let request = RpcRequest {
        jsonrpc: "2.0".to_string(),
        method: method.to_string(),
        params,
        id,
    };
    framing::write_request(writer, &request).await.unwrap();
    framing::read_response(reader).await.unwrap()
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[tokio::test]
async fn workspace_crud_round_trip() {
    let temp_dir = TempDir::new().unwrap();
    let (socket_path, _state, shutdown_tx, _handle) = start_mock_server(&temp_dir).await;
    let (mut reader, mut writer) = connect(&socket_path).await;

    // 1. List workspaces — should be empty
    let resp = rpc_call(
        &mut reader,
        &mut writer,
        METHOD_WORKSPACE_LIST,
        None,
        json!(1),
    )
    .await;
    assert!(resp.error.is_none(), "workspace.list should succeed");
    assert_eq!(resp.result, Some(json!([])));
    assert_eq!(resp.id, json!(1));

    // 2. Create a workspace
    let resp = rpc_call(
        &mut reader,
        &mut writer,
        METHOD_WORKSPACE_CREATE,
        Some(json!({"name": "IntegrationWS"})),
        json!(2),
    )
    .await;
    assert!(resp.error.is_none(), "workspace.create should succeed");
    let ws = resp.result.unwrap();
    assert_eq!(ws["name"], "IntegrationWS");
    let ws_id = ws["id"].as_str().unwrap().to_string();

    // 3. List workspaces — should have one entry
    let resp = rpc_call(
        &mut reader,
        &mut writer,
        METHOD_WORKSPACE_LIST,
        None,
        json!(3),
    )
    .await;
    assert!(resp.error.is_none());
    let list = resp.result.unwrap();
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["name"], "IntegrationWS");

    // 4. Create second workspace so close is allowed
    let resp = rpc_call(
        &mut reader,
        &mut writer,
        METHOD_WORKSPACE_CREATE,
        Some(json!({"name": "TempWS"})),
        json!(4),
    )
    .await;
    assert!(resp.error.is_none());

    // 5. Close first workspace
    let resp = rpc_call(
        &mut reader,
        &mut writer,
        METHOD_WORKSPACE_CLOSE,
        Some(json!({"id": ws_id})),
        json!(5),
    )
    .await;
    assert!(resp.error.is_none(), "workspace.close should succeed");

    // 6. List workspaces — should have one remaining
    let resp = rpc_call(
        &mut reader,
        &mut writer,
        METHOD_WORKSPACE_LIST,
        None,
        json!(6),
    )
    .await;
    assert!(resp.error.is_none());
    let list = resp.result.unwrap();
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["name"], "TempWS");

    let _ = shutdown_tx.send(true);
}

#[tokio::test]
async fn workspace_close_nonexistent_returns_error() {
    let temp_dir = TempDir::new().unwrap();
    let (socket_path, _state, shutdown_tx, _handle) = start_mock_server(&temp_dir).await;
    let (mut reader, mut writer) = connect(&socket_path).await;

    // Create one workspace first to avoid "last workspace" guard
    rpc_call(
        &mut reader,
        &mut writer,
        METHOD_WORKSPACE_CREATE,
        Some(json!({"name": "WS1"})),
        json!(1),
    )
    .await;

    // Attempt to close a nonexistent workspace
    let resp = rpc_call(
        &mut reader,
        &mut writer,
        METHOD_WORKSPACE_CLOSE,
        Some(json!({"id": "does-not-exist"})),
        json!(2),
    )
    .await;
    assert!(resp.error.is_some());
    assert_eq!(resp.error.unwrap().code, ERR_WORKSPACE_NOT_FOUND);

    let _ = shutdown_tx.send(true);
}

#[tokio::test]
async fn session_save_round_trip() {
    let temp_dir = TempDir::new().unwrap();
    let (socket_path, state, shutdown_tx, _handle) = start_mock_server(&temp_dir).await;
    let (mut reader, mut writer) = connect(&socket_path).await;

    assert!(!*state.session_saved.read().unwrap());

    let resp = rpc_call(
        &mut reader,
        &mut writer,
        METHOD_SESSION_SAVE,
        None,
        json!(1),
    )
    .await;
    assert!(resp.error.is_none(), "session.save should succeed");
    // result is null which serde deserializes as None for Option<Value>
    assert!(
        resp.result.is_none() || resp.result == Some(json!(null)),
        "session.save result should be null"
    );

    assert!(
        *state.session_saved.read().unwrap(),
        "session should be marked as saved"
    );

    let _ = shutdown_tx.send(true);
}

#[tokio::test]
async fn session_info_round_trip() {
    let temp_dir = TempDir::new().unwrap();
    let (socket_path, _state, shutdown_tx, _handle) = start_mock_server(&temp_dir).await;
    let (mut reader, mut writer) = connect(&socket_path).await;

    let resp = rpc_call(
        &mut reader,
        &mut writer,
        METHOD_SESSION_INFO,
        None,
        json!(1),
    )
    .await;
    assert!(resp.error.is_none(), "session.info should succeed");

    let result = resp.result.unwrap();
    assert_eq!(result["pid"], std::process::id());
    assert!(result["socket_path"].is_string());
    assert!(result["workspace_count"].is_number());
    assert!(result["uptime_secs"].is_number());

    let _ = shutdown_tx.send(true);
}

#[tokio::test]
async fn notification_send_round_trip() {
    let temp_dir = TempDir::new().unwrap();
    let (socket_path, state, shutdown_tx, _handle) = start_mock_server(&temp_dir).await;
    let (mut reader, mut writer) = connect(&socket_path).await;

    let resp = rpc_call(
        &mut reader,
        &mut writer,
        METHOD_NOTIFY_SEND,
        Some(json!({"title": "Build passed", "body": "All 42 tests green"})),
        json!(1),
    )
    .await;
    assert!(resp.error.is_none(), "notify.send should succeed");

    let notifications = state.notifications.read().unwrap();
    assert_eq!(notifications.len(), 1);
    assert_eq!(notifications[0]["title"], "Build passed");
    assert_eq!(notifications[0]["body"], "All 42 tests green");

    let _ = shutdown_tx.send(true);
}

#[tokio::test]
async fn notification_send_without_body() {
    let temp_dir = TempDir::new().unwrap();
    let (socket_path, state, shutdown_tx, _handle) = start_mock_server(&temp_dir).await;
    let (mut reader, mut writer) = connect(&socket_path).await;

    let resp = rpc_call(
        &mut reader,
        &mut writer,
        METHOD_NOTIFY_SEND,
        Some(json!({"title": "Alert"})),
        json!(1),
    )
    .await;
    assert!(resp.error.is_none());

    let notifications = state.notifications.read().unwrap();
    assert_eq!(notifications.len(), 1);
    assert_eq!(notifications[0]["title"], "Alert");
    assert_eq!(notifications[0]["body"], Value::Null);

    let _ = shutdown_tx.send(true);
}

#[tokio::test]
async fn unknown_method_returns_method_not_found() {
    let temp_dir = TempDir::new().unwrap();
    let (socket_path, _state, shutdown_tx, _handle) = start_mock_server(&temp_dir).await;
    let (mut reader, mut writer) = connect(&socket_path).await;

    let resp = rpc_call(&mut reader, &mut writer, "unicorn.fly", None, json!(99)).await;
    assert!(resp.error.is_some());
    let err = resp.error.unwrap();
    assert_eq!(err.code, ERR_METHOD_NOT_FOUND);
    assert!(
        err.message.contains("unicorn.fly"),
        "error message should mention the unknown method"
    );
    assert_eq!(resp.id, json!(99));

    let _ = shutdown_tx.send(true);
}

#[tokio::test]
async fn invalid_params_returns_error() {
    let temp_dir = TempDir::new().unwrap();
    let (socket_path, _state, shutdown_tx, _handle) = start_mock_server(&temp_dir).await;
    let (mut reader, mut writer) = connect(&socket_path).await;

    // workspace.close requires {"id": "..."} — send without id
    let resp = rpc_call(
        &mut reader,
        &mut writer,
        METHOD_WORKSPACE_CLOSE,
        Some(json!({"wrong": "field"})),
        json!(1),
    )
    .await;
    assert!(resp.error.is_some());
    assert_eq!(resp.error.unwrap().code, ERR_INVALID_PARAMS);

    let _ = shutdown_tx.send(true);
}

#[tokio::test]
async fn notify_send_missing_title_returns_error() {
    let temp_dir = TempDir::new().unwrap();
    let (socket_path, _state, shutdown_tx, _handle) = start_mock_server(&temp_dir).await;
    let (mut reader, mut writer) = connect(&socket_path).await;

    let resp = rpc_call(
        &mut reader,
        &mut writer,
        METHOD_NOTIFY_SEND,
        Some(json!({"body": "no title"})),
        json!(1),
    )
    .await;
    assert!(resp.error.is_some());
    assert_eq!(resp.error.unwrap().code, ERR_INVALID_PARAMS);

    let _ = shutdown_tx.send(true);
}

#[tokio::test]
async fn workspace_create_auto_generates_name() {
    let temp_dir = TempDir::new().unwrap();
    let (socket_path, _state, shutdown_tx, _handle) = start_mock_server(&temp_dir).await;
    let (mut reader, mut writer) = connect(&socket_path).await;

    // Create without name — should auto-generate "Workspace 1"
    let resp = rpc_call(
        &mut reader,
        &mut writer,
        METHOD_WORKSPACE_CREATE,
        None,
        json!(1),
    )
    .await;
    assert!(resp.error.is_none());
    let ws = resp.result.unwrap();
    assert_eq!(ws["name"], "Workspace 1");

    let _ = shutdown_tx.send(true);
}

#[tokio::test]
async fn multiple_requests_on_same_connection() {
    let temp_dir = TempDir::new().unwrap();
    let (socket_path, _state, shutdown_tx, _handle) = start_mock_server(&temp_dir).await;
    let (mut reader, mut writer) = connect(&socket_path).await;

    // Send 5 sequential requests on the same connection
    for i in 1..=5 {
        let resp = rpc_call(
            &mut reader,
            &mut writer,
            METHOD_WORKSPACE_LIST,
            None,
            json!(i),
        )
        .await;
        assert!(resp.error.is_none(), "request {i} should succeed");
        assert_eq!(resp.id, json!(i), "response id should match request {i}");
    }

    let _ = shutdown_tx.send(true);
}

#[tokio::test]
async fn concurrent_clients() {
    let temp_dir = TempDir::new().unwrap();
    let (socket_path, _state, shutdown_tx, _handle) = start_mock_server(&temp_dir).await;

    // Spawn 3 concurrent clients
    let mut handles = Vec::new();
    for i in 0..3 {
        let path = socket_path.clone();
        handles.push(tokio::spawn(async move {
            let (mut reader, mut writer) = connect(&path).await;
            let resp = rpc_call(
                &mut reader,
                &mut writer,
                METHOD_WORKSPACE_LIST,
                None,
                json!(i),
            )
            .await;
            assert!(resp.error.is_none(), "client {i} should get success");
            assert_eq!(resp.id, json!(i));
        }));
    }

    for h in handles {
        h.await.expect("client task should not panic");
    }

    let _ = shutdown_tx.send(true);
}

#[tokio::test]
async fn workspace_close_last_workspace_returns_error() {
    let temp_dir = TempDir::new().unwrap();
    let (socket_path, _state, shutdown_tx, _handle) = start_mock_server(&temp_dir).await;
    let (mut reader, mut writer) = connect(&socket_path).await;

    // Create a single workspace
    let resp = rpc_call(
        &mut reader,
        &mut writer,
        METHOD_WORKSPACE_CREATE,
        Some(json!({"name": "OnlyWS"})),
        json!(1),
    )
    .await;
    let ws_id = resp.result.unwrap()["id"].as_str().unwrap().to_string();

    // Attempt to close the last workspace
    let resp = rpc_call(
        &mut reader,
        &mut writer,
        METHOD_WORKSPACE_CLOSE,
        Some(json!({"id": ws_id})),
        json!(2),
    )
    .await;
    assert!(resp.error.is_some(), "closing last workspace should fail");
    assert_eq!(resp.error.unwrap().code, ERR_WORKSPACE_NOT_FOUND);

    let _ = shutdown_tx.send(true);
}
