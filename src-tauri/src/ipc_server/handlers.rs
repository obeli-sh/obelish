use obelisk_protocol::error::*;
use obelisk_protocol::methods::*;
use obelisk_protocol::rpc::RpcResponse;
use serde_json::Value;

use super::IpcContext;

pub fn dispatch<C: IpcContext>(
    method: &str,
    params: Option<Value>,
    context: &C,
    id: Value,
) -> RpcResponse {
    match method {
        METHOD_WORKSPACE_LIST => handle_workspace_list(context, id),
        METHOD_WORKSPACE_CREATE => handle_workspace_create(params, context, id),
        METHOD_WORKSPACE_CLOSE => handle_workspace_close(params, context, id),
        METHOD_WORKSPACE_FOCUS => handle_workspace_focus(params, context, id),
        METHOD_PANE_CLOSE => handle_pane_close(params, context, id),
        METHOD_NOTIFY_SEND => handle_notify_send(params, context, id),
        METHOD_SESSION_INFO => handle_session_info(context, id),
        METHOD_SESSION_SAVE => handle_session_save(context, id),
        _ => RpcResponse::error(
            id,
            ERR_METHOD_NOT_FOUND,
            format!("Method not found: {method}"),
        ),
    }
}

fn handle_workspace_list<C: IpcContext>(context: &C, id: Value) -> RpcResponse {
    let ws = context
        .workspace_state()
        .read()
        .expect("workspace state lock poisoned");
    let workspaces = ws.list_workspaces().to_vec();
    RpcResponse::success(id, serde_json::to_value(workspaces).unwrap())
}

fn handle_workspace_create<C: IpcContext>(
    params: Option<Value>,
    context: &C,
    id: Value,
) -> RpcResponse {
    let create_params: obelisk_protocol::methods::WorkspaceCreateParams = match params {
        Some(p) => match serde_json::from_value(p) {
            Ok(v) => v,
            Err(e) => {
                return RpcResponse::error(id, ERR_INVALID_PARAMS, format!("Invalid params: {e}"))
            }
        },
        None => obelisk_protocol::methods::WorkspaceCreateParams {
            name: None,
            shell: None,
            cwd: None,
        },
    };

    let name = create_params.name.unwrap_or_else(|| {
        let ws = context
            .workspace_state()
            .read()
            .expect("workspace state lock poisoned");
        format!("Workspace {}", ws.list_workspaces().len() + 1)
    });

    let pane_id = uuid::Uuid::new_v4().to_string();
    let pty_id = String::new(); // No PTY spawning through IPC

    let mut ws = context
        .workspace_state()
        .write()
        .expect("workspace state lock poisoned");
    let workspace = ws.create_workspace(
        name,
        pane_id,
        pty_id,
        String::new(),
        String::new(),
        None,
        false,
    );
    drop(ws);

    context.session_manager().mark_dirty();

    RpcResponse::success(id, serde_json::to_value(workspace).unwrap())
}

fn handle_workspace_close<C: IpcContext>(
    params: Option<Value>,
    context: &C,
    id: Value,
) -> RpcResponse {
    let close_params: obelisk_protocol::methods::WorkspaceCloseParams = match params {
        Some(p) => match serde_json::from_value(p) {
            Ok(v) => v,
            Err(e) => {
                return RpcResponse::error(id, ERR_INVALID_PARAMS, format!("Invalid params: {e}"))
            }
        },
        None => return RpcResponse::error(id, ERR_INVALID_PARAMS, "Missing params".to_string()),
    };

    let mut ws = context
        .workspace_state()
        .write()
        .expect("workspace state lock poisoned");

    match ws.close_workspace(&close_params.id) {
        Ok(_pty_ids) => {
            drop(ws);
            context.session_manager().mark_dirty();
            RpcResponse::success(id, serde_json::json!(null))
        }
        Err(crate::error::WorkspaceError::NotFound { .. }) => RpcResponse::error(
            id,
            ERR_WORKSPACE_NOT_FOUND,
            format!("Workspace not found: {}", close_params.id),
        ),
        Err(crate::error::WorkspaceError::LastWorkspace) => RpcResponse::error(
            id,
            ERR_WORKSPACE_NOT_FOUND,
            "Cannot close last workspace".to_string(),
        ),
        Err(e) => RpcResponse::error(id, ERR_INTERNAL, format!("Internal error: {e}")),
    }
}

fn handle_workspace_focus<C: IpcContext>(
    params: Option<Value>,
    context: &C,
    id: Value,
) -> RpcResponse {
    let focus_params: obelisk_protocol::methods::WorkspaceFocusParams = match params {
        Some(p) => match serde_json::from_value(p) {
            Ok(v) => v,
            Err(e) => {
                return RpcResponse::error(id, ERR_INVALID_PARAMS, format!("Invalid params: {e}"))
            }
        },
        None => return RpcResponse::error(id, ERR_INVALID_PARAMS, "Missing params".to_string()),
    };

    let mut ws = context
        .workspace_state()
        .write()
        .expect("workspace state lock poisoned");

    match ws.focus_workspace(&focus_params.id) {
        Ok(()) => RpcResponse::success(id, serde_json::json!(null)),
        Err(crate::error::WorkspaceError::NotFound { .. }) => RpcResponse::error(
            id,
            ERR_WORKSPACE_NOT_FOUND,
            format!("Workspace not found: {}", focus_params.id),
        ),
        Err(e) => RpcResponse::error(id, ERR_INTERNAL, format!("Internal error: {e}")),
    }
}

fn handle_pane_close<C: IpcContext>(params: Option<Value>, context: &C, id: Value) -> RpcResponse {
    let close_params: obelisk_protocol::methods::PaneCloseParams = match params {
        Some(p) => match serde_json::from_value(p) {
            Ok(v) => v,
            Err(e) => {
                return RpcResponse::error(id, ERR_INVALID_PARAMS, format!("Invalid params: {e}"))
            }
        },
        None => return RpcResponse::error(id, ERR_INVALID_PARAMS, "Missing params".to_string()),
    };

    let mut ws = context
        .workspace_state()
        .write()
        .expect("workspace state lock poisoned");

    match ws.close_pane(&close_params.pane_id) {
        Ok(_result) => RpcResponse::success(id, serde_json::json!(null)),
        Err(crate::error::WorkspaceError::PaneNotFound { .. }) => RpcResponse::error(
            id,
            ERR_PANE_NOT_FOUND,
            format!("Pane not found: {}", close_params.pane_id),
        ),
        Err(e) => RpcResponse::error(id, ERR_INTERNAL, format!("Internal error: {e}")),
    }
}

fn handle_notify_send<C: IpcContext>(params: Option<Value>, context: &C, id: Value) -> RpcResponse {
    let notify_params: obelisk_protocol::methods::NotifySendParams = match params {
        Some(p) => match serde_json::from_value(p) {
            Ok(v) => v,
            Err(e) => {
                return RpcResponse::error(id, ERR_INVALID_PARAMS, format!("Invalid params: {e}"))
            }
        },
        None => return RpcResponse::error(id, ERR_INVALID_PARAMS, "Missing params".to_string()),
    };

    let notification = obelisk_protocol::Notification {
        id: uuid::Uuid::new_v4().to_string(),
        pane_id: notify_params.pane_id.unwrap_or_default(),
        workspace_id: notify_params.workspace_id.unwrap_or_default(),
        osc_type: 9,
        title: notify_params.title,
        body: notify_params.body,
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs(),
        read: false,
    };

    let mut store = context
        .notification_store()
        .write()
        .expect("notification store lock poisoned");
    store.add(notification);

    RpcResponse::success(id, serde_json::json!(null))
}

fn handle_session_info<C: IpcContext>(context: &C, id: Value) -> RpcResponse {
    let ws = context
        .workspace_state()
        .read()
        .expect("workspace state lock poisoned");
    let workspace_count = ws.list_workspaces().len();
    drop(ws);

    let uptime = context.server_start_time().elapsed().as_secs();
    let result = obelisk_protocol::methods::SessionInfoResult {
        pid: std::process::id(),
        socket_path: context.socket_path().to_string_lossy().to_string(),
        workspace_count,
        uptime_secs: uptime,
    };

    RpcResponse::success(id, serde_json::to_value(result).unwrap())
}

fn handle_session_save<C: IpcContext>(context: &C, id: Value) -> RpcResponse {
    let ws = context
        .workspace_state()
        .read()
        .expect("workspace state lock poisoned");
    let session = ws.to_session_state();
    drop(ws);

    match context.session_manager().save_from_session(&session) {
        Ok(()) => RpcResponse::success(id, serde_json::json!(null)),
        Err(e) => RpcResponse::error(id, ERR_INTERNAL, format!("Failed to save session: {e}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::notifications::store::NotificationStore;
    use crate::persistence::fs::FsPersistence;
    use crate::persistence::session::SessionManager;
    use crate::workspace::WorkspaceState;
    use std::sync::{Arc, RwLock};
    use std::time::Instant;
    use tempfile::TempDir;

    #[derive(Clone)]
    struct TestContext {
        workspace_state: Arc<RwLock<WorkspaceState>>,
        notification_store: Arc<RwLock<NotificationStore>>,
        session_manager: Arc<SessionManager>,
        start_time: Instant,
        socket_path: std::path::PathBuf,
        _temp_dir: Arc<TempDir>,
    }

    impl TestContext {
        fn new() -> Self {
            let temp_dir = TempDir::new().unwrap();
            let backend = Arc::new(FsPersistence::new(temp_dir.path()).unwrap());
            Self {
                workspace_state: Arc::new(RwLock::new(WorkspaceState::new())),
                notification_store: Arc::new(RwLock::new(NotificationStore::new(100))),
                session_manager: Arc::new(SessionManager::new(backend)),
                start_time: Instant::now(),
                socket_path: temp_dir.path().join("test.sock"),
                _temp_dir: Arc::new(temp_dir),
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
            &self.socket_path
        }
    }

    #[test]
    fn workspace_list_returns_empty_array() {
        let ctx = TestContext::new();
        let resp = dispatch(METHOD_WORKSPACE_LIST, None, &ctx, serde_json::json!(1));
        assert!(resp.error.is_none());
        let result = resp.result.unwrap();
        assert_eq!(result, serde_json::json!([]));
    }

    #[test]
    fn workspace_create_returns_workspace() {
        let ctx = TestContext::new();
        let params = serde_json::json!({"name": "Test WS"});
        let resp = dispatch(
            METHOD_WORKSPACE_CREATE,
            Some(params),
            &ctx,
            serde_json::json!(2),
        );
        assert!(resp.error.is_none());
        let result = resp.result.unwrap();
        assert_eq!(result["name"], "Test WS");
        assert!(result["id"].is_string());
        assert!(result["surfaces"].is_array());
    }

    #[test]
    fn workspace_create_without_name_auto_generates() {
        let ctx = TestContext::new();
        let resp = dispatch(METHOD_WORKSPACE_CREATE, None, &ctx, serde_json::json!(3));
        assert!(resp.error.is_none());
        let result = resp.result.unwrap();
        assert_eq!(result["name"], "Workspace 1");
    }

    #[test]
    fn workspace_close_nonexistent_returns_error() {
        let ctx = TestContext::new();
        // Need at least one workspace to avoid LastWorkspace error
        {
            let mut ws = ctx.workspace_state.write().unwrap();
            ws.create_workspace(
                "WS 1".to_string(),
                "p1".to_string(),
                "pty1".to_string(),
                String::new(),
                String::new(),
                None,
                false,
            );
        }

        let params = serde_json::json!({"id": "nonexistent"});
        let resp = dispatch(
            METHOD_WORKSPACE_CLOSE,
            Some(params),
            &ctx,
            serde_json::json!(4),
        );
        assert!(resp.error.is_some());
        assert_eq!(resp.error.unwrap().code, ERR_WORKSPACE_NOT_FOUND);
    }

    #[test]
    fn workspace_focus_sets_active() {
        let ctx = TestContext::new();
        let ws1_id;
        let ws2_id;
        {
            let mut ws = ctx.workspace_state.write().unwrap();
            let ws1 = ws.create_workspace(
                "WS 1".to_string(),
                "p1".to_string(),
                "pty1".to_string(),
                String::new(),
                String::new(),
                None,
                false,
            );
            ws1_id = ws1.id;
            let ws2 = ws.create_workspace(
                "WS 2".to_string(),
                "p2".to_string(),
                "pty2".to_string(),
                String::new(),
                String::new(),
                None,
                false,
            );
            ws2_id = ws2.id;
        }

        // Active should be ws2 (last created)
        {
            let ws = ctx.workspace_state.read().unwrap();
            assert_eq!(ws.active_workspace_id(), Some(ws2_id.as_str()));
        }

        // Focus ws1
        let params = serde_json::json!({"id": ws1_id});
        let resp = dispatch(
            METHOD_WORKSPACE_FOCUS,
            Some(params),
            &ctx,
            serde_json::json!(5),
        );
        assert!(resp.error.is_none());

        // Verify ws1 is now active
        {
            let ws = ctx.workspace_state.read().unwrap();
            assert_eq!(ws.active_workspace_id(), Some(ws1_id.as_str()));
        }
    }

    #[test]
    fn workspace_focus_nonexistent_returns_error() {
        let ctx = TestContext::new();
        let params = serde_json::json!({"id": "nonexistent"});
        let resp = dispatch(
            METHOD_WORKSPACE_FOCUS,
            Some(params),
            &ctx,
            serde_json::json!(6),
        );
        assert!(resp.error.is_some());
        assert_eq!(resp.error.unwrap().code, ERR_WORKSPACE_NOT_FOUND);
    }

    #[test]
    fn pane_close_nonexistent_returns_error() {
        let ctx = TestContext::new();
        let params = serde_json::json!({"pane_id": "nonexistent"});
        let resp = dispatch(METHOD_PANE_CLOSE, Some(params), &ctx, serde_json::json!(7));
        assert!(resp.error.is_some());
        assert_eq!(resp.error.unwrap().code, ERR_PANE_NOT_FOUND);
    }

    #[test]
    fn notify_send_adds_notification() {
        let ctx = TestContext::new();
        let params = serde_json::json!({
            "title": "Test Notification",
            "body": "Hello World"
        });
        let resp = dispatch(METHOD_NOTIFY_SEND, Some(params), &ctx, serde_json::json!(8));
        assert!(resp.error.is_none());

        let store = ctx.notification_store.read().unwrap();
        assert_eq!(store.list().len(), 1);
        assert_eq!(store.list()[0].title, "Test Notification");
        assert_eq!(store.list()[0].body, Some("Hello World".to_string()));
    }

    #[test]
    fn session_info_returns_pid() {
        let ctx = TestContext::new();
        let resp = dispatch(METHOD_SESSION_INFO, None, &ctx, serde_json::json!(9));
        assert!(resp.error.is_none());
        let result = resp.result.unwrap();
        assert_eq!(result["pid"], std::process::id());
        assert!(result["socket_path"].is_string());
        assert_eq!(result["workspace_count"], 0);
        assert!(result["uptime_secs"].is_number());
    }

    #[test]
    fn session_save_persists() {
        let ctx = TestContext::new();
        // Create a workspace first
        {
            let mut ws = ctx.workspace_state.write().unwrap();
            ws.create_workspace(
                "WS".to_string(),
                "p1".to_string(),
                "pty1".to_string(),
                String::new(),
                String::new(),
                None,
                false,
            );
        }

        let resp = dispatch(METHOD_SESSION_SAVE, None, &ctx, serde_json::json!(10));
        assert!(resp.error.is_none());

        // Verify session was saved
        let loaded = ctx.session_manager.load().unwrap();
        assert!(loaded.is_some());
        assert_eq!(loaded.unwrap().workspaces.len(), 1);
    }

    #[test]
    fn workspace_create_marks_session_dirty() {
        let ctx = TestContext::new();
        assert!(!ctx.session_manager.is_dirty());
        let resp = dispatch(METHOD_WORKSPACE_CREATE, None, &ctx, serde_json::json!(20));
        assert!(resp.error.is_none());
        assert!(
            ctx.session_manager.is_dirty(),
            "session should be marked dirty after workspace.create"
        );
    }

    #[test]
    fn workspace_close_marks_session_dirty() {
        let ctx = TestContext::new();
        // Create two workspaces so we can close one
        let ws1_id;
        {
            let mut ws = ctx.workspace_state.write().unwrap();
            ws1_id = ws
                .create_workspace(
                    "WS 1".to_string(),
                    "p1".to_string(),
                    "pty1".to_string(),
                    String::new(),
                    String::new(),
                    None,
                    false,
                )
                .id;
            ws.create_workspace(
                "WS 2".to_string(),
                "p2".to_string(),
                "pty2".to_string(),
                String::new(),
                String::new(),
                None,
                false,
            );
        }

        assert!(!ctx.session_manager.is_dirty());
        let params = serde_json::json!({"id": ws1_id});
        let resp = dispatch(
            METHOD_WORKSPACE_CLOSE,
            Some(params),
            &ctx,
            serde_json::json!(21),
        );
        assert!(resp.error.is_none());
        assert!(
            ctx.session_manager.is_dirty(),
            "session should be marked dirty after workspace.close"
        );
    }

    #[test]
    fn unknown_method_returns_error() {
        let ctx = TestContext::new();
        let resp = dispatch("foo.bar", None, &ctx, serde_json::json!(11));
        assert!(resp.error.is_some());
        assert_eq!(resp.error.unwrap().code, ERR_METHOD_NOT_FOUND);
    }

    #[test]
    fn invalid_params_returns_error() {
        let ctx = TestContext::new();
        // workspace.close expects {"id": "..."} but we send {"wrong": "field"}
        let params = serde_json::json!({"wrong": "field"});
        let resp = dispatch(
            METHOD_WORKSPACE_CLOSE,
            Some(params),
            &ctx,
            serde_json::json!(12),
        );
        assert!(resp.error.is_some());
        assert_eq!(resp.error.unwrap().code, ERR_INVALID_PARAMS);
    }
}
