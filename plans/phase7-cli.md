# Phase 7: CLI + IPC Server

## 1. Objectives & Scope

Phase 7 delivers a standalone CLI binary (`obelisk`) that communicates with the running Obelisk desktop app over a local IPC channel (Unix socket on macOS/Linux, named pipe on Windows). This enables power users and scripts to automate Obelisk from the command line without interacting with the GUI.

**In scope:**
- IPC server in the Tauri app (Unix socket / named pipe listener)
- JSON-RPC 2.0 protocol with length-prefixed framing
- Extraction of `obelisk-protocol` shared crate from `src-tauri`
- CLI binary with clap-derived subcommands
- CLI client that connects to the IPC socket, sends requests, and prints responses
- Session discovery for multi-instance support

**Out of scope:**
- Remote access (TCP/network exposure — explicitly rejected in Round 2)
- Authentication tokens (deferred — local socket permissions are sufficient per consensus)
- Plugin system via IPC
- Streaming/subscription events from server to CLI (one-shot request/response only for MVP)

**Key consensus decisions applied:**
- No TCP fallback for IPC (Backend Round 2, security concern, unanimous)
- Shared protocol crate created in this phase (PM Round 3, YAGNI until CLI needs it)
- PID-based socket naming with discovery file for multi-instance (Backend Round 1)
- `thiserror` for errors, no `anyhow` (Backend Round 2, Tech Lead Round 3)
- `tracing` for all logging (Tech Lead Round 1)

## 2. Rust Module Architecture

### Crate Extraction: `obelisk-protocol`

Phase 7 begins by extracting shared types into a new crate:

```toml
# Root Cargo.toml (updated)
[workspace]
members = ["src-tauri", "cli", "obelisk-protocol"]
resolver = "2"
```

```
obelisk-protocol/
├── Cargo.toml
└── src/
    ├── lib.rs             # Re-exports
    ├── rpc.rs             # RpcRequest, RpcResponse, RpcError structs
    ├── methods.rs         # Method enum + typed param/result structs per method
    ├── types.rs           # WorkspaceInfo, SurfaceInfo, PaneInfo, LayoutNode
    │                      # (moved from src-tauri/src/workspace/types.rs)
    └── error.rs           # Protocol-level error codes
```

### IPC Server Module (in `src-tauri`)

```
src-tauri/src/ipc_server/
├── mod.rs                 # IpcServer: lifecycle (start, stop, socket path)
├── listener.rs            # Accept loop: spawns a task per connection
├── connection.rs          # Per-connection read/write with length-prefixed framing
├── protocol.rs            # Re-exports from obelisk-protocol + deserialization helpers
├── handlers.rs            # Method dispatch: method string -> handler function -> response
└── discovery.rs           # Discovery file management (write on start, remove on stop)
```

### CLI Crate

```
cli/
├── Cargo.toml
└── src/
    ├── main.rs            # clap CLI entry, subcommand dispatch
    ├── client.rs          # IPC socket client: connect, send request, read response
    ├── commands/
    │   ├── mod.rs
    │   ├── workspace.rs   # obelisk workspace {new,list,close,focus}
    │   ├── pane.rs        # obelisk pane {split,close,focus}
    │   ├── notify.rs      # obelisk notify <message>
    │   └── session.rs     # obelisk session {info,save}
    ├── output.rs          # Formatter: table, json, or plain text output
    └── discovery.rs       # Find running Obelisk instance socket path
```

### Key Structs and Traits

```rust
// === obelisk-protocol/src/rpc.rs ===

#[derive(Debug, Serialize, Deserialize)]
pub struct RpcRequest {
    pub jsonrpc: String,  // must be "2.0"
    pub id: u64,
    pub method: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RpcResponse {
    pub jsonrpc: String,
    pub id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RpcError {
    pub code: i32,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<serde_json::Value>,
}

impl RpcResponse {
    pub fn success(id: u64, result: serde_json::Value) -> Self { ... }
    pub fn error(id: u64, code: i32, message: String) -> Self { ... }
}

// === obelisk-protocol/src/methods.rs ===

pub const METHOD_WORKSPACE_CREATE: &str = "workspace.create";
pub const METHOD_WORKSPACE_LIST: &str = "workspace.list";
pub const METHOD_WORKSPACE_CLOSE: &str = "workspace.close";
pub const METHOD_WORKSPACE_FOCUS: &str = "workspace.focus";
pub const METHOD_PANE_SPLIT: &str = "pane.split";
pub const METHOD_PANE_CLOSE: &str = "pane.close";
pub const METHOD_PANE_FOCUS: &str = "pane.focus";
pub const METHOD_NOTIFY_SEND: &str = "notify.send";
pub const METHOD_SESSION_INFO: &str = "session.info";
pub const METHOD_SESSION_SAVE: &str = "session.save";

// === obelisk-protocol/src/error.rs ===

pub const ERR_PARSE: i32 = -32700;
pub const ERR_INVALID_REQUEST: i32 = -32600;
pub const ERR_METHOD_NOT_FOUND: i32 = -32601;
pub const ERR_INVALID_PARAMS: i32 = -32602;
pub const ERR_INTERNAL: i32 = -32603;
// Application-specific errors: -32000 to -32099
pub const ERR_WORKSPACE_NOT_FOUND: i32 = -32001;
pub const ERR_PANE_NOT_FOUND: i32 = -32002;
pub const ERR_SPAWN_FAILED: i32 = -32003;

// === src-tauri/src/ipc_server/mod.rs ===

pub struct IpcServer {
    socket_path: PathBuf,
    shutdown_tx: Option<tokio::sync::watch::Sender<bool>>,
    handle: Option<tokio::task::JoinHandle<()>>,
}

impl IpcServer {
    pub async fn start(
        state: Arc<AppState>,
        app_handle: AppHandle,
    ) -> Result<Self, IpcError> { ... }

    pub async fn stop(&mut self) -> Result<(), IpcError> { ... }

    pub fn socket_path(&self) -> &Path { ... }
}

// === src-tauri/src/ipc_server/connection.rs ===

/// Length-prefixed framing: u32 big-endian length + JSON bytes
pub async fn read_message<R: AsyncRead + Unpin>(reader: &mut R) -> Result<RpcRequest, IpcError> { ... }
pub async fn write_message<W: AsyncWrite + Unpin>(writer: &mut W, response: &RpcResponse) -> Result<(), IpcError> { ... }

// === src-tauri/src/ipc_server/handlers.rs ===

pub async fn dispatch(
    method: &str,
    params: serde_json::Value,
    state: &AppState,
    app_handle: &AppHandle,
) -> Result<serde_json::Value, RpcError> { ... }
```

### IPC Error Types

```rust
#[derive(Debug, thiserror::Error)]
pub enum IpcError {
    #[error("failed to bind socket: {0}")]
    BindFailed(#[source] std::io::Error),
    #[error("accept failed: {0}")]
    AcceptFailed(#[source] std::io::Error),
    #[error("connection read error: {0}")]
    ReadError(#[source] std::io::Error),
    #[error("connection write error: {0}")]
    WriteError(#[source] std::io::Error),
    #[error("invalid message: {0}")]
    InvalidMessage(String),
    #[error("server not running")]
    NotRunning,
    #[error("server already running")]
    AlreadyRunning,
}
```

## 3. Implementation Steps — TDD Order

### Step 1: Extract `obelisk-protocol` crate

1. Create `obelisk-protocol/` crate in workspace
2. Move `WorkspaceInfo`, `SurfaceInfo`, `PaneInfo`, `LayoutNode`, `SplitDirection` from `src-tauri/src/workspace/types.rs` to `obelisk-protocol/src/types.rs`
3. Update `src-tauri` to depend on `obelisk-protocol`
4. Verify all existing tests still pass (pure refactor, no behavior change)

### Step 2: Protocol types (TDD)

1. **Test**: `RpcRequest` deserializes from valid JSON-RPC 2.0
2. **Test**: `RpcRequest` rejects invalid `jsonrpc` version
3. **Test**: `RpcResponse::success()` serializes correctly
4. **Test**: `RpcResponse::error()` serializes correctly
5. **Test**: Every method constant string is unique and lowercase dot-separated
6. **Implement**: `RpcRequest`, `RpcResponse`, `RpcError` structs
7. **Test**: Roundtrip: serialize request -> deserialize -> matches original (proptest)
8. **Implement**: Method constants and typed param/result structs

### Step 3: Length-prefixed framing (TDD)

1. **Test**: `read_message` reads a length-prefixed JSON message from a byte buffer
2. **Test**: `write_message` writes length prefix + JSON bytes
3. **Test**: Roundtrip: write then read produces same message
4. **Test**: `read_message` with truncated length prefix returns error
5. **Test**: `read_message` with truncated body returns error
6. **Test**: `read_message` with oversized length (> 1MB) returns error
7. **Test**: `read_message` with invalid JSON after valid length returns error
8. **Implement**: `read_message` and `write_message` functions

### Step 4: Handler dispatch (TDD)

1. **Test**: `dispatch("workspace.list", ...)` returns list of workspaces
2. **Test**: `dispatch("workspace.create", { name: "test" })` creates workspace
3. **Test**: `dispatch("workspace.close", { workspaceId: "..." })` closes workspace
4. **Test**: `dispatch("workspace.focus", { workspaceId: "..." })` sets active workspace
5. **Test**: `dispatch("pane.split", { paneId: "...", direction: "horizontal" })` splits pane
6. **Test**: `dispatch("pane.close", { paneId: "..." })` closes pane
7. **Test**: `dispatch("notify.send", { title: "...", body: "..." })` creates notification
8. **Test**: `dispatch("session.info")` returns session metadata
9. **Test**: `dispatch("session.save")` triggers persistence
10. **Test**: `dispatch("unknown.method", ...)` returns method-not-found error
11. **Test**: `dispatch("workspace.close", { invalid params })` returns invalid-params error
12. **Implement**: `dispatch` function routing methods to existing AppState operations

### Step 5: IPC server lifecycle (TDD)

1. **Test**: `IpcServer::start()` creates socket file at expected path
2. **Test**: `IpcServer::start()` when socket already exists removes stale socket and rebinds
3. **Test**: `IpcServer::stop()` removes socket file
4. **Test**: `IpcServer::stop()` gracefully disconnects active clients
5. **Test**: Double `start()` returns `AlreadyRunning` error
6. **Test**: `stop()` on non-running server returns `NotRunning` error
7. **Implement**: `IpcServer` with `interprocess::local_socket`

### Step 6: Connection handling (TDD — integration)

1. **Test**: Client connects, sends valid request, receives correct response
2. **Test**: Client sends multiple requests on same connection (pipelining)
3. **Test**: Client disconnects mid-request — server handles gracefully
4. **Test**: Server handles 10 concurrent clients independently
5. **Test**: Server handles malformed JSON — returns parse error, doesn't crash
6. **Test**: Server handles oversized payload — returns error
7. **Test**: Client connects after server stops — connection refused
8. **Implement**: Accept loop + per-connection task

### Step 7: Discovery file (TDD)

1. **Test**: `start()` writes discovery file with PID and socket path
2. **Test**: `stop()` removes discovery entry
3. **Test**: Discovery file is in platform-appropriate location
4. **Test**: Multiple instances write separate entries
5. **Test**: Stale entries (PID no longer running) are cleaned on read
6. **Implement**: Discovery file manager

### Step 8: CLI client (TDD)

1. **Test**: `IpcClient::connect(path)` connects to a running server
2. **Test**: `IpcClient::connect(path)` to non-existent socket returns clear error
3. **Test**: `IpcClient::send(request)` sends length-prefixed request and reads response
4. **Test**: `IpcClient::send(request)` with server timeout returns error
5. **Implement**: `IpcClient` in `cli/src/client.rs`

### Step 9: CLI subcommands (TDD)

1. **Test**: `obelisk workspace new` sends `workspace.create` RPC
2. **Test**: `obelisk workspace new --name "test"` passes name param
3. **Test**: `obelisk workspace list` sends `workspace.list`, prints table
4. **Test**: `obelisk workspace close <id>` sends `workspace.close`
5. **Test**: `obelisk workspace focus <id>` sends `workspace.focus`
6. **Test**: `obelisk pane split --direction horizontal` sends `pane.split`
7. **Test**: `obelisk pane close` sends `pane.close`
8. **Test**: `obelisk notify "Hello"` sends `notify.send`
9. **Test**: `obelisk session info` prints session information
10. **Test**: `obelisk session save` triggers save
11. **Test**: `obelisk --json workspace list` outputs JSON format
12. **Test**: `obelisk` with no subcommand prints help
13. **Test**: `obelisk workspace close <nonexistent>` prints error
14. **Implement**: clap subcommand definitions and dispatch logic

### Step 10: CLI discovery (TDD)

1. **Test**: CLI discovers running instance from discovery file
2. **Test**: CLI with no running instance prints "Obelisk is not running"
3. **Test**: CLI with multiple instances lists them and uses `--instance` flag
4. **Implement**: Discovery file reader in CLI

## 4. TDD Approach — Per Module

### `obelisk-protocol` (rpc.rs, methods.rs, error.rs)
- **Write failing test**: Deserialize a JSON-RPC request string
- **Implement**: `RpcRequest` struct with serde derives
- **Green**: Test passes
- **Refactor**: Add validation (jsonrpc version check)
- **Property tests**: Arbitrary valid requests serialize/deserialize to identity

### `ipc_server/connection.rs` (framing)
- **Write failing test**: `read_message` from a `Cursor<Vec<u8>>` containing a length-prefixed JSON
- **Implement**: Read 4 bytes as u32 big-endian, read that many bytes, deserialize as JSON
- **Green**: Test passes
- **Add edge case tests**: Truncated prefix, truncated body, oversized, invalid JSON
- **Implement**: Error handling for each edge case
- **Property test**: Any valid `RpcRequest` round-trips through write_message + read_message

### `ipc_server/handlers.rs` (dispatch)
- **Write failing test**: `dispatch("workspace.list", ..., &mock_state)` returns JSON array
- **Implement**: Match on method string, call appropriate AppState method, serialize result
- **Green**: Test passes
- **Add tests for each method**: One test per method, one test for unknown method, one for invalid params
- **Implement**: All method handlers

### `ipc_server/mod.rs` (server lifecycle)
- **Write failing test**: `IpcServer::start()` creates socket
- **Implement**: Bind to local socket, spawn accept loop
- **Green**: Test passes
- **Add tests**: stop cleans up, double start fails, concurrent clients

### `cli/src/client.rs` (CLI client)
- **Write failing test**: Connect to a test server, send request, receive response
- **Implement**: Connect via `interprocess`, write/read with framing
- **Green**: Test passes

### `cli/src/commands/*.rs` (CLI subcommands)
- **Write failing test**: Parse `["workspace", "new", "--name", "test"]` args, verify correct RPC request generated
- **Implement**: clap command definition + request builder
- **Green**: Test passes
- Use `assert_cmd` crate for CLI binary integration tests

## 5. Unit Tests — Complete List

### `obelisk-protocol` (target: 100% coverage)

```
rpc.rs:
  test_deserialize_valid_request
  test_deserialize_request_missing_jsonrpc_fails
  test_deserialize_request_wrong_jsonrpc_version
  test_deserialize_request_without_params_uses_default
  test_serialize_success_response
  test_serialize_error_response
  test_serialize_response_omits_null_fields
  test_response_success_constructor
  test_response_error_constructor
  proptest_request_roundtrip
  proptest_response_roundtrip

methods.rs:
  test_all_method_constants_unique
  test_method_constants_lowercase_dot_separated
  test_workspace_create_params_deserialize
  test_workspace_close_params_deserialize
  test_pane_split_params_deserialize
  test_notify_send_params_deserialize
  test_session_info_result_serialize

error.rs:
  test_standard_error_codes_are_negative
  test_app_error_codes_in_range
```

### `ipc_server/connection.rs` (target: 100% coverage)

```
  test_read_message_valid
  test_read_message_empty_stream_returns_eof
  test_read_message_truncated_length
  test_read_message_truncated_body
  test_read_message_oversized_rejects
  test_read_message_invalid_json
  test_write_message_correct_format
  test_write_read_roundtrip
  proptest_write_read_roundtrip_arbitrary_request
```

### `ipc_server/handlers.rs` (target: 100% coverage)

```
  test_dispatch_workspace_list
  test_dispatch_workspace_create
  test_dispatch_workspace_create_with_name
  test_dispatch_workspace_close
  test_dispatch_workspace_close_not_found
  test_dispatch_workspace_focus
  test_dispatch_pane_split_horizontal
  test_dispatch_pane_split_vertical
  test_dispatch_pane_close
  test_dispatch_pane_close_not_found
  test_dispatch_notify_send
  test_dispatch_session_info
  test_dispatch_session_save
  test_dispatch_unknown_method
  test_dispatch_invalid_params
  test_dispatch_missing_required_param
```

### `ipc_server/mod.rs` (target: 100% coverage)

```
  test_start_creates_socket
  test_start_stale_socket_removed
  test_stop_removes_socket
  test_stop_disconnects_clients
  test_double_start_returns_error
  test_stop_when_not_running_returns_error
  test_socket_path_format_unix    #[cfg(unix)]
  test_socket_path_format_windows #[cfg(windows)]
```

### `ipc_server/discovery.rs` (target: 100% coverage)

```
  test_write_discovery_entry
  test_remove_discovery_entry
  test_read_discovery_finds_running_instance
  test_read_discovery_cleans_stale_entries
  test_multiple_instances_listed
  test_discovery_file_location_unix    #[cfg(unix)]
  test_discovery_file_location_windows #[cfg(windows)]
```

### `cli/src/client.rs` (target: 100% coverage)

```
  test_connect_to_server
  test_connect_nonexistent_socket
  test_send_and_receive
  test_send_timeout
  test_connection_closed_by_server
```

### `cli/src/commands/*.rs` (target: 100% coverage)

```
workspace.rs:
  test_parse_workspace_new
  test_parse_workspace_new_with_name
  test_parse_workspace_new_with_cwd
  test_parse_workspace_list
  test_parse_workspace_close
  test_parse_workspace_focus
  test_workspace_new_builds_correct_rpc
  test_workspace_list_builds_correct_rpc
  test_workspace_close_builds_correct_rpc

pane.rs:
  test_parse_pane_split_horizontal
  test_parse_pane_split_vertical
  test_parse_pane_close
  test_parse_pane_focus
  test_pane_split_builds_correct_rpc
  test_pane_close_builds_correct_rpc

notify.rs:
  test_parse_notify_with_title
  test_parse_notify_with_title_and_body
  test_notify_builds_correct_rpc

session.rs:
  test_parse_session_info
  test_parse_session_save
  test_session_info_builds_correct_rpc

output.rs:
  test_format_workspace_list_table
  test_format_workspace_list_json
  test_format_error_message
  test_format_session_info
```

## 6. Integration Tests

```
src-tauri/tests/ipc_integration.rs:
  test_server_client_workspace_list       # Start server, connect client, list workspaces
  test_server_client_workspace_crud       # Create, list, close workspace via IPC
  test_server_client_pane_split           # Split pane via IPC, verify new pane exists
  test_server_client_notify               # Send notification via IPC, verify event emitted
  test_server_client_session_save         # Trigger save via IPC, verify file written
  test_server_concurrent_clients          # 10 clients sending requests simultaneously
  test_server_client_disconnect_handling  # Client disconnects mid-session
  test_server_malformed_json              # Client sends garbage, server returns error
  test_server_oversized_payload           # Client sends >1MB, server rejects
  test_server_rapid_reconnect             # Connect/disconnect 100 times rapidly
  test_server_under_load                  # 100 requests/sec for 10 seconds

cli/tests/cli_integration.rs:
  test_cli_workspace_new                  # Run CLI binary, verify workspace created in app
  test_cli_workspace_list                 # Run CLI, verify output matches app state
  test_cli_workspace_close                # Run CLI, verify workspace removed
  test_cli_pane_split                     # Run CLI, verify pane split in app
  test_cli_notify                         # Run CLI, verify notification appears
  test_cli_session_info                   # Run CLI, verify output format
  test_cli_no_server_running              # Run CLI without app, verify error message
  test_cli_json_output                    # Run CLI with --json, verify valid JSON
  test_cli_multiple_instances             # Two app instances, CLI selects correct one
```

## 7. E2E Tests

```
tests/e2e/cli.spec.ts:
  test("obelisk workspace new creates a workspace in the running app")
  test("obelisk workspace list shows all workspaces")
  test("obelisk pane split creates a split in the active pane")
  test("obelisk notify sends notification visible in notification panel")
  test("obelisk session save persists state that survives restart")
```

## 8. Acceptance Criteria

1. **IPC server starts automatically** with the Tauri app and stops on app exit
2. **Socket is cleaned up** on both clean and unclean shutdown (stale socket detection)
3. **`obelisk workspace new --name test`** creates a workspace visible in the running app's sidebar
4. **`obelisk workspace list`** prints a table of all workspaces with IDs and names
5. **`obelisk pane split --direction horizontal`** splits the active pane in the running app
6. **`obelisk notify "Hello from CLI"`** produces a notification in the notification panel
7. **`obelisk session save`** triggers a persistence write
8. **`obelisk session info`** prints server PID, socket path, workspace count, uptime
9. **`obelisk --json workspace list`** outputs valid JSON
10. **`obelisk` with no running app** prints "Obelisk is not running. Start the app first." and exits with code 1
11. **Multiple concurrent CLI commands** do not corrupt server state
12. **All IPC stress tests pass** (100 concurrent clients, malformed input, rapid reconnection)
13. **CLI binary size** < 5 MB (static linking, release build)
14. **100% test coverage** on `obelisk-protocol`, `ipc_server/protocol.rs`, `ipc_server/handlers.rs`, `ipc_server/connection.rs`
15. **95% test coverage** on `ipc_server/mod.rs`, `cli/src/`

## 9. Cross-Platform Verification

### Unix-Specific (macOS + Linux)
- Socket created at `$XDG_RUNTIME_DIR/obelisk-{pid}.sock` (Linux) or `$TMPDIR/obelisk-{pid}.sock` (macOS)
- Socket permissions: 0700 (user-only access)
- Stale socket detection: if socket file exists but PID is dead, remove and rebind
- Discovery file at `$XDG_RUNTIME_DIR/obelisk-discovery.json` or `$TMPDIR/obelisk-discovery.json`

### Windows-Specific
- Named pipe at `\\.\pipe\obelisk-{pid}`
- Named pipe ACL: current user only (set via Windows API)
- Discovery file at `%LOCALAPPDATA%\obelisk\discovery.json`
- CLI binary has `.exe` extension
- Path arguments in workspace.create use `\` separators but are normalized internally

### Platform-Specific Tests

```rust
#[cfg(unix)]
mod unix_tests {
    #[tokio::test]
    async fn socket_has_correct_permissions() {
        let server = IpcServer::start(...).await.unwrap();
        let metadata = std::fs::metadata(server.socket_path()).unwrap();
        let permissions = metadata.permissions();
        assert_eq!(permissions.mode() & 0o777, 0o700);
    }

    #[tokio::test]
    async fn stale_socket_removed_on_start() {
        // Create a socket file with no listener
        std::fs::write("/tmp/obelisk-stale.sock", "").unwrap();
        // Start should succeed by removing stale socket
        let server = IpcServer::start_at("/tmp/obelisk-stale.sock", ...).await.unwrap();
        assert!(server.socket_path().exists());
    }
}

#[cfg(windows)]
mod windows_tests {
    #[tokio::test]
    async fn named_pipe_created() {
        let server = IpcServer::start(...).await.unwrap();
        let pipe_path = server.socket_path();
        assert!(pipe_path.to_str().unwrap().starts_with(r"\\.\pipe\obelisk-"));
    }
}
```

## 10. Dependencies on Prior Phases

| Dependency | Phase | What's Needed |
|-----------|-------|---------------|
| AppState with workspace operations | Phase 2 | `workspace_create`, `workspace_close`, `workspace_list`, `pane_split`, `pane_close` must exist |
| Session persistence | Phase 3a | `session_save` must be functional |
| Notification store | Phase 4 | `notify.send` method needs NotificationStore to create notifications |
| Event emission | Phase 2 | IPC handlers reuse the same state mutation logic that emits `workspace-changed` events to the frontend |

The IPC handlers do NOT implement their own state logic. They call the same `AppState` methods that Tauri commands call. This ensures CLI and GUI operations produce identical results and identical events.

## 11. Stress Testing Plan

Phase 7 quality gate requires these stress tests to pass (run as a separate CI job, not on every PR):

| Test | Description | Pass Criteria |
|------|-------------|---------------|
| Concurrent clients | 100 clients connect simultaneously, each sends 10 requests | All 1000 responses correct, no timeouts |
| Rapid reconnect | Single client connects/disconnects 500 times in 10 seconds | No socket leaks, server stable |
| Malformed input fuzzing | 1000 random byte sequences sent as messages | Server returns error for each, never crashes |
| Large payload | Client sends 10MB JSON payload | Server rejects with error, doesn't OOM |
| Sustained load | 1000 requests/sec for 30 seconds | p99 latency < 50ms, no errors |
| Half-open connections | Client sends request header but disconnects before body | Server times out and cleans up connection |
