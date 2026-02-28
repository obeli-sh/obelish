use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RpcRequest {
    pub jsonrpc: String,
    pub method: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub params: Option<Value>,
    pub id: Value,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RpcResponse {
    pub jsonrpc: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
    pub id: Value,
}

impl RpcResponse {
    pub fn success(id: Value, result: Value) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            result: Some(result),
            error: None,
            id,
        }
    }

    pub fn error(id: Value, code: i32, message: String) -> Self {
        Self {
            jsonrpc: "2.0".to_string(),
            result: None,
            error: Some(RpcError {
                code,
                message,
                data: None,
            }),
            id,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn deserialize_valid_request() {
        let json_str =
            r#"{"jsonrpc":"2.0","method":"workspace.create","params":{"name":"test"},"id":1}"#;
        let req: RpcRequest = serde_json::from_str(json_str).unwrap();
        assert_eq!(req.jsonrpc, "2.0");
        assert_eq!(req.method, "workspace.create");
        assert_eq!(req.params, Some(json!({"name": "test"})));
        assert_eq!(req.id, json!(1));
    }

    #[test]
    fn reject_request_with_wrong_jsonrpc_version() {
        let json_str = r#"{"jsonrpc":"1.0","method":"test","id":1}"#;
        let req: RpcRequest = serde_json::from_str(json_str).unwrap();
        assert_ne!(req.jsonrpc, "2.0");
    }

    #[test]
    fn serialize_success_response() {
        let resp = RpcResponse::success(json!(1), json!({"status": "ok"}));
        let serialized = serde_json::to_value(&resp).unwrap();
        assert_eq!(serialized["jsonrpc"], "2.0");
        assert_eq!(serialized["result"]["status"], "ok");
        assert!(serialized.get("error").is_none());
        assert_eq!(serialized["id"], 1);
    }

    #[test]
    fn serialize_error_response() {
        let resp = RpcResponse::error(json!(2), -32600, "Invalid Request".to_string());
        let serialized = serde_json::to_value(&resp).unwrap();
        assert_eq!(serialized["jsonrpc"], "2.0");
        assert_eq!(serialized["error"]["code"], -32600);
        assert_eq!(serialized["error"]["message"], "Invalid Request");
        assert!(serialized.get("result").is_none());
        assert_eq!(serialized["id"], 2);
    }

    #[test]
    fn success_constructor_fields() {
        let resp = RpcResponse::success(json!(42), json!("hello"));
        assert_eq!(resp.jsonrpc, "2.0");
        assert_eq!(resp.result, Some(json!("hello")));
        assert!(resp.error.is_none());
        assert_eq!(resp.id, json!(42));
    }

    #[test]
    fn error_constructor_fields() {
        let resp = RpcResponse::error(json!("abc"), -32601, "Method not found".to_string());
        assert_eq!(resp.jsonrpc, "2.0");
        assert!(resp.result.is_none());
        let err = resp.error.unwrap();
        assert_eq!(err.code, -32601);
        assert_eq!(err.message, "Method not found");
        assert!(err.data.is_none());
    }

    #[test]
    fn roundtrip_request() {
        let req = RpcRequest {
            jsonrpc: "2.0".to_string(),
            method: "pane.split".to_string(),
            params: Some(json!({"pane_id": "p1", "direction": "horizontal"})),
            id: json!(99),
        };
        let serialized = serde_json::to_string(&req).unwrap();
        let deserialized: RpcRequest = serde_json::from_str(&serialized).unwrap();
        assert_eq!(req, deserialized);
    }

    #[test]
    fn roundtrip_response() {
        let resp = RpcResponse::success(json!(5), json!({"count": 3}));
        let serialized = serde_json::to_string(&resp).unwrap();
        let deserialized: RpcResponse = serde_json::from_str(&serialized).unwrap();
        assert_eq!(resp, deserialized);
    }
}
