use serde::{Deserialize, Serialize};

pub const METHOD_WORKSPACE_CREATE: &str = "workspace.create";
pub const METHOD_WORKSPACE_LIST: &str = "workspace.list";
pub const METHOD_WORKSPACE_CLOSE: &str = "workspace.close";
pub const METHOD_WORKSPACE_FOCUS: &str = "workspace.focus";
pub const METHOD_PANE_SPLIT: &str = "pane.split";
pub const METHOD_PANE_CLOSE: &str = "pane.close";
pub const METHOD_NOTIFY_SEND: &str = "notify.send";
pub const METHOD_SESSION_INFO: &str = "session.info";
pub const METHOD_SESSION_SAVE: &str = "session.save";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceCreateParams {
    pub name: Option<String>,
    pub shell: Option<String>,
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceCloseParams {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct WorkspaceFocusParams {
    pub id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PaneSplitParams {
    pub pane_id: String,
    pub direction: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PaneCloseParams {
    pub pane_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct NotifySendParams {
    pub title: String,
    pub body: Option<String>,
    pub workspace_id: Option<String>,
    pub pane_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SessionInfoResult {
    pub pid: u32,
    pub socket_path: String,
    pub workspace_count: usize,
    pub uptime_secs: u64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashSet;

    #[test]
    fn all_method_constants_are_unique() {
        let methods: HashSet<&str> = [
            METHOD_WORKSPACE_CREATE,
            METHOD_WORKSPACE_LIST,
            METHOD_WORKSPACE_CLOSE,
            METHOD_WORKSPACE_FOCUS,
            METHOD_PANE_SPLIT,
            METHOD_PANE_CLOSE,
            METHOD_NOTIFY_SEND,
            METHOD_SESSION_INFO,
            METHOD_SESSION_SAVE,
        ]
        .into_iter()
        .collect();
        assert_eq!(methods.len(), 9);
    }

    #[test]
    fn all_method_constants_are_lowercase_dot_separated() {
        let methods = [
            METHOD_WORKSPACE_CREATE,
            METHOD_WORKSPACE_LIST,
            METHOD_WORKSPACE_CLOSE,
            METHOD_WORKSPACE_FOCUS,
            METHOD_PANE_SPLIT,
            METHOD_PANE_CLOSE,
            METHOD_NOTIFY_SEND,
            METHOD_SESSION_INFO,
            METHOD_SESSION_SAVE,
        ];
        for method in methods {
            assert!(
                method.contains('.'),
                "{method} should contain a dot separator"
            );
            assert_eq!(
                method,
                method.to_lowercase(),
                "{method} should be lowercase"
            );
        }
    }

    #[test]
    fn workspace_create_params_deserializes() {
        let json_str = r#"{"name":"my-ws","shell":"/bin/zsh","cwd":"/tmp"}"#;
        let params: WorkspaceCreateParams = serde_json::from_str(json_str).unwrap();
        assert_eq!(params.name, Some("my-ws".to_string()));
        assert_eq!(params.shell, Some("/bin/zsh".to_string()));
        assert_eq!(params.cwd, Some("/tmp".to_string()));
    }

    #[test]
    fn pane_split_params_deserializes() {
        let json_str = r#"{"pane_id":"p1","direction":"horizontal"}"#;
        let params: PaneSplitParams = serde_json::from_str(json_str).unwrap();
        assert_eq!(params.pane_id, "p1");
        assert_eq!(params.direction, "horizontal");
    }

    #[test]
    fn session_info_result_serializes() {
        let result = SessionInfoResult {
            pid: 1234,
            socket_path: "/tmp/obelisk.sock".to_string(),
            workspace_count: 3,
            uptime_secs: 600,
        };
        let value = serde_json::to_value(&result).unwrap();
        assert_eq!(
            value,
            json!({
                "pid": 1234,
                "socket_path": "/tmp/obelisk.sock",
                "workspace_count": 3,
                "uptime_secs": 600
            })
        );
    }
}
