// Standard JSON-RPC error codes
pub const ERR_PARSE: i32 = -32700;
pub const ERR_INVALID_REQUEST: i32 = -32600;
pub const ERR_METHOD_NOT_FOUND: i32 = -32601;
pub const ERR_INVALID_PARAMS: i32 = -32602;
pub const ERR_INTERNAL: i32 = -32603;

// App-specific error codes
pub const ERR_WORKSPACE_NOT_FOUND: i32 = -32001;
pub const ERR_PANE_NOT_FOUND: i32 = -32002;

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn standard_codes_are_negative() {
        assert!(ERR_PARSE < 0);
        assert!(ERR_INVALID_REQUEST < 0);
        assert!(ERR_METHOD_NOT_FOUND < 0);
        assert!(ERR_INVALID_PARAMS < 0);
        assert!(ERR_INTERNAL < 0);
    }

    #[test]
    fn app_codes_are_in_expected_range() {
        let app_codes = [ERR_WORKSPACE_NOT_FOUND, ERR_PANE_NOT_FOUND];
        for code in app_codes {
            assert!(
                (-32099..=-32000).contains(&code),
                "App code {code} should be in -32099..=-32000"
            );
        }
    }

    #[test]
    fn all_codes_are_unique() {
        let codes: HashSet<i32> = [
            ERR_PARSE,
            ERR_INVALID_REQUEST,
            ERR_METHOD_NOT_FOUND,
            ERR_INVALID_PARAMS,
            ERR_INTERNAL,
            ERR_WORKSPACE_NOT_FOUND,
            ERR_PANE_NOT_FOUND,
        ]
        .into_iter()
        .collect();
        assert_eq!(codes.len(), 7);
    }
}
