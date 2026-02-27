# Round 3: Senior Backend Engineer — Final Consensus & Recommendations

## 1. Final Rust Module Architecture

After three rounds of debate, here is the locked-in Rust architecture.

### Crate Layout

```
obelisk/
├── Cargo.toml                     # Workspace root
├── src-tauri/
│   ├── Cargo.toml                 # Tauri app crate
│   └── src/
│       ├── main.rs                # Entry point (minimal — just calls lib::run)
│       ├── lib.rs                 # Tauri builder setup, state registration
│       ├── error.rs               # BackendError enum + module error re-exports
│       ├── state.rs               # AppState struct
│       ├── pty/
│       │   ├── mod.rs             # Re-exports
│       │   ├── backend.rs         # PtyBackend trait + RealPtyBackend impl
│       │   ├── manager.rs         # PtyManager: orchestrates spawn/write/resize/kill
│       │   ├── read_thread.rs     # Per-PTY read loop + buffer flush logic
│       │   └── osc_parser.rs      # Streaming OSC state machine
│       ├── workspace/
│       │   ├── mod.rs
│       │   ├── types.rs           # Workspace, Surface, Pane, LayoutNode structs
│       │   ├── state.rs           # WorkspaceState: mutation methods + event emission
│       │   └── persistence.rs     # JSON save/restore, atomic writes, crash recovery
│       ├── git/
│       │   └── mod.rs             # Git info polling (branch, dirty, ahead/behind)
│       ├── ports/
│       │   └── mod.rs             # Listening port detection
│       ├── notifications/
│       │   ├── mod.rs             # NotificationStore
│       │   └── system.rs          # OS-level notification dispatch
│       ├── ipc_server/
│       │   ├── mod.rs             # Server lifecycle (bind, accept, shutdown)
│       │   ├── protocol.rs        # JSON-RPC request/response types
│       │   └── handlers.rs        # Method dispatch
│       ├── browser/
│       │   └── mod.rs             # Multi-webview management (Phase 5)
│       └── commands/
│           ├── mod.rs             # Re-exports all command modules
│           ├── pty_commands.rs     # pty_spawn, pty_write, pty_resize, pty_kill
│           ├── workspace_commands.rs
│           ├── notification_commands.rs
│           ├── git_commands.rs
│           ├── port_commands.rs
│           └── browser_commands.rs
├── cli/
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs                # clap CLI entry
│       └── client.rs              # IPC socket client
└── justfile                       # Cross-language task runner
```

### Workspace Cargo.toml

```toml
[workspace]
members = ["src-tauri", "cli"]
resolver = "2"

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
thiserror = "2"
tracing = "0.1"
uuid = { version = "1", features = ["v4"] }
```

**Decision on shared protocol crate**: We do NOT create `obelisk-protocol` until Phase 7 when the CLI actually needs shared types. Until then, IPC protocol types live in `src-tauri/src/ipc_server/protocol.rs`. When Phase 7 arrives, we extract the shared types into a new crate. This follows PM's YAGNI argument, which the team reached consensus on. The refactor is mechanical and low-risk.

### Key Traits

```rust
/// PTY abstraction for testability. Production uses RealPtyBackend (portable-pty).
/// Tests use MockPtyBackend (mockall).
pub trait PtyBackend: Send + Sync {
    fn spawn(&self, config: &PtyConfig) -> Result<PtyHandle, PtyError>;
    fn write(&self, handle: &PtyHandle, data: &[u8]) -> Result<usize, PtyError>;
    fn resize(&self, handle: &PtyHandle, size: PtySize) -> Result<(), PtyError>;
    fn kill(&self, handle: &PtyHandle) -> Result<(), PtyError>;
    fn try_clone_reader(&self, handle: &PtyHandle) -> Result<Box<dyn Read + Send>, PtyError>;
}

/// Event emission abstraction. Production uses TauriEventEmitter.
/// Tests use MockEventEmitter (records emitted events for assertions).
pub trait EventEmitter: Send + Sync {
    fn emit<S: Serialize + Clone>(&self, event: &str, payload: S) -> Result<(), EmitError>;
}

/// Persistence abstraction. Production uses FsPersistence.
/// Tests use MockPersistence or in-memory store.
pub trait PersistenceBackend: Send + Sync {
    fn save(&self, key: &str, data: &[u8]) -> Result<(), PersistenceError>;
    fn load(&self, key: &str) -> Result<Option<Vec<u8>>, PersistenceError>;
    fn delete(&self, key: &str) -> Result<(), PersistenceError>;
}

/// Command execution abstraction for git/port scanning.
/// Tests use MockCommandRunner returning canned output.
pub trait CommandRunner: Send + Sync {
    fn run(&self, cmd: &str, args: &[&str], cwd: &Path) -> Result<CommandOutput, CommandError>;
}
```

## 2. Tauri Command API Specification (Final)

All commands are async. All return `Result<T, BackendError>`. All use `#[serde(rename_all = "camelCase")]` on structs exposed to the frontend.

### PTY Commands

```rust
#[tauri::command]
#[tracing::instrument(skip(state, app))]
async fn pty_spawn(
    state: State<'_, AppState>,
    app: AppHandle,
    shell: Option<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
) -> Result<PtySpawnResult, BackendError>
// Returns: { "ptyId": "uuid" }
// Side effects: spawns read thread, begins emitting pty-data-{ptyId} events

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn pty_write(
    state: State<'_, AppState>,
    pty_id: String,
    data: String,  // base64-encoded
) -> Result<(), BackendError>
// Errors: PtyNotFound, WriteFailed

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn pty_resize(
    state: State<'_, AppState>,
    pty_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), BackendError>
// Errors: PtyNotFound, ResizeFailed

#[tauri::command]
#[tracing::instrument(skip(state))]
async fn pty_kill(
    state: State<'_, AppState>,
    pty_id: String,
) -> Result<(), BackendError>
// Errors: PtyNotFound
// Graceful: sends SIGHUP/Ctrl+C first, then escalates after 2s timeout
```

### Workspace Commands

```rust
#[tauri::command]
#[tracing::instrument(skip(state, app))]
async fn workspace_create(
    state: State<'_, AppState>,
    app: AppHandle,
    name: Option<String>,
    cwd: Option<String>,
) -> Result<WorkspaceInfo, BackendError>
// Side effects: creates workspace with one surface and one terminal pane,
// spawns PTY, emits workspace-changed event

#[tauri::command]
#[tracing::instrument(skip(state, app))]
async fn workspace_close(
    state: State<'_, AppState>,
    app: AppHandle,
    workspace_id: String,
) -> Result<(), BackendError>
// Side effects: kills all PTYs in workspace, emits workspace-changed event

#[tauri::command]
async fn workspace_list(
    state: State<'_, AppState>,
) -> Result<Vec<WorkspaceInfo>, BackendError>

#[tauri::command]
#[tracing::instrument(skip(state, app))]
async fn pane_split(
    state: State<'_, AppState>,
    app: AppHandle,
    pane_id: String,
    direction: SplitDirection,
    shell: Option<String>,
) -> Result<PaneSplitResult, BackendError>
// Side effects: spawns new PTY, updates layout tree, emits workspace-changed event

#[tauri::command]
#[tracing::instrument(skip(state, app))]
async fn pane_close(
    state: State<'_, AppState>,
    app: AppHandle,
    pane_id: String,
) -> Result<(), BackendError>
// Side effects: kills PTY, updates layout tree, emits workspace-changed event
// If last pane in workspace: closes workspace

#[tauri::command]
async fn session_save(
    state: State<'_, AppState>,
) -> Result<(), BackendError>
```

## 3. Event Payload Specifications (Final)

### Decision: Single `workspace-changed` event with full state

Frontend asked in Round 2: "Do you agree with a single `workspace-changed` event (full state) vs fine-grained events?"

**Yes, I agree.** Full state replacement is the right call for these reasons:
1. A workspace with 20 panes serializes to ~5-10KB of JSON. Negligible.
2. Eliminates ordering bugs from multi-event structural changes.
3. Frontend can do a simple `store.setState({ workspace: newState })` with no merge logic.
4. Tech lead's Round 2 endorses this: "full state replacement with shallow comparison in Zustand."

If we ever hit a scenario where this is a bottleneck (unlikely), we can add delta events later. For now, simplicity wins.

### Complete Event Catalog

```rust
// ---- PTY Events ----

/// Batched PTY output, emitted at up to 60Hz per PTY.
/// Event name: "pty-data-{pty_id}"
#[derive(Serialize, Clone)]
pub struct PtyDataPayload {
    pub data: String,  // base64-encoded terminal output
}

/// PTY process exited.
/// Event name: "pty-exit-{pty_id}"
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PtyExitPayload {
    pub exit_code: Option<i32>,
    pub signal: Option<i32>,  // Unix only, None on Windows
}

// ---- Workspace Events ----

/// Workspace structure changed. Contains full state after mutation.
/// Event name: "workspace-changed"
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceChangedPayload {
    pub workspace_id: String,
    pub change_type: ChangeType,
    pub workspace: WorkspaceInfo,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "snake_case")]
pub enum ChangeType {
    Created,
    Closed,
    PaneSplit,
    PaneClosed,
    SurfaceCreated,
    SurfaceClosed,
    Renamed,
}

// ---- Notification Events ----

/// OSC notification detected in PTY output.
/// Event name: "notification"
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NotificationPayload {
    pub id: String,
    pub pane_id: String,
    pub workspace_id: String,
    pub title: String,
    pub body: Option<String>,
    pub osc_type: u32,
    pub timestamp: u64,  // unix ms
}

// ---- Metadata Events ----

/// Git info changed for a pane's working directory.
/// Event name: "git-info-{pane_id}"
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitInfoPayload {
    pub branch: Option<String>,
    pub is_dirty: bool,
    pub ahead: u32,
    pub behind: u32,
}

/// Listening ports changed for a pane's working directory.
/// Event name: "ports-changed-{pane_id}"
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PortsChangedPayload {
    pub ports: Vec<PortInfoEntry>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PortInfoEntry {
    pub port: u16,
    pub pid: Option<u32>,
    pub process_name: Option<String>,
}
```

## 4. Error Handling Patterns (Final)

### Resolved: No `anyhow`, Fully Typed Errors

Tech lead accepted the challenge. The final pattern:

```rust
// Per-module error types
#[derive(Debug, thiserror::Error)]
pub enum PtyError {
    #[error("PTY not found: {id}")]
    NotFound { id: String },
    #[error("spawn failed: {0}")]
    SpawnFailed(#[source] std::io::Error),
    #[error("write failed: {0}")]
    WriteFailed(#[source] std::io::Error),
    #[error("resize failed: {0}")]
    ResizeFailed(String),
    #[error("already terminated: {id}")]
    AlreadyTerminated { id: String },
}

#[derive(Debug, thiserror::Error)]
pub enum WorkspaceError {
    #[error("workspace not found: {id}")]
    NotFound { id: String },
    #[error("pane not found: {id}")]
    PaneNotFound { id: String },
    #[error("invalid split: {reason}")]
    InvalidSplit { reason: String },
}

#[derive(Debug, thiserror::Error)]
pub enum PersistenceError {
    #[error("save failed: {0}")]
    SaveFailed(#[source] std::io::Error),
    #[error("load failed: {0}")]
    LoadFailed(#[source] std::io::Error),
    #[error("corrupted data: {0}")]
    Corrupted(String),
}

// Top-level error — the only error type Tauri commands return
#[derive(Debug, thiserror::Error)]
pub enum BackendError {
    #[error(transparent)]
    Pty(#[from] PtyError),
    #[error(transparent)]
    Workspace(#[from] WorkspaceError),
    #[error(transparent)]
    Persistence(#[from] PersistenceError),
}

// Tauri v2 requires Serialize on command error types
impl Serialize for BackendError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut s = serializer.serialize_struct("BackendError", 2)?;
        s.serialize_field("kind", &self.error_kind())?;
        s.serialize_field("message", &self.to_string())?;
        s.end()
    }
}

impl BackendError {
    fn error_kind(&self) -> &'static str {
        match self {
            Self::Pty(PtyError::NotFound { .. }) => "PtyNotFound",
            Self::Pty(PtyError::SpawnFailed(_)) => "SpawnFailed",
            Self::Pty(PtyError::WriteFailed(_)) => "WriteFailed",
            Self::Pty(PtyError::ResizeFailed(_)) => "ResizeFailed",
            Self::Pty(PtyError::AlreadyTerminated { .. }) => "PtyAlreadyTerminated",
            Self::Workspace(WorkspaceError::NotFound { .. }) => "WorkspaceNotFound",
            Self::Workspace(WorkspaceError::PaneNotFound { .. }) => "PaneNotFound",
            Self::Workspace(WorkspaceError::InvalidSplit { .. }) => "InvalidSplit",
            Self::Persistence(PersistenceError::SaveFailed(_)) => "PersistenceSaveFailed",
            Self::Persistence(PersistenceError::LoadFailed(_)) => "PersistenceLoadFailed",
            Self::Persistence(PersistenceError::Corrupted(_)) => "PersistenceCorrupted",
        }
    }
}
```

Frontend receives:
```typescript
interface BackendError {
  kind: "PtyNotFound" | "SpawnFailed" | "WriteFailed" | /* ... */;
  message: string;
}
```

This gives the frontend structured error matching via `kind` without exposing Rust internals.

## 5. Resolving Open Debates

### 5.1 Coverage Threshold: RESOLVED

**Final position: 95% CI gate + 100% on business logic modules.**

The debate was between QA's 100% blanket mandate and my 95% proposal. Here is the final compromise that I believe all parties can accept:

- **CI gate**: `cargo llvm-cov --workspace --fail-under 95` (blocks merge)
- **Business logic modules must be 100%**: `pty/`, `workspace/`, `ipc_server/protocol.rs`, `osc_parser.rs`, `persistence.rs` — these are verified individually in CI with `--fail-under 100`
- **Glue code can be lower**: `main.rs`, `lib.rs`, `commands/*.rs` (thin wrappers), platform-specific branches not runnable on the CI platform
- **No escape hatches**: No `#[cfg(not(tarpaulin_include))]` without code review justification

Rationale: This satisfies QA's intent (all business logic is proven correct) while acknowledging the reality that some code (platform-specific branches, entry points, Tauri builder glue) cannot be fully covered on a single CI platform. The 95% overall gate catches regression — if someone adds untested code, the number drops.

For frontend: 95% overall, 100% on stores and hooks. Components at 90% minimum. Frontend engineer and QA can finalize the exact per-directory thresholds.

### 5.2 E2E Retry Policy: RESOLVED

**Final position: 0 retries for unit/integration, 1 retry for E2E, with mandatory investigation.**

QA wants zero retries everywhere. Frontend argues E2E needs 1 retry due to inherent Playwright + WebDriver flakiness. My position:

- Unit tests and integration tests: **0 retries**. If they fail, they fail. These test deterministic logic.
- E2E tests: **1 automatic retry** in CI. But any test that uses its retry more than 5% of CI runs gets flagged and must be investigated within 48 hours. If it can't be stabilized, it's quarantined.
- PTY integration tests (real PTY): **0 retries**, but assertions use polling with timeout rather than immediate assertion. This handles OS scheduling jitter without hiding real failures.

```rust
// Example: PTY integration test uses polling, not retry
#[tokio::test]
async fn test_echo_output() {
    let manager = PtyManager::new(RealPtyBackend::new());
    let id = manager.spawn(test_pty_config()).await.unwrap();
    manager.write(&id, b"echo hello\n").await.unwrap();

    // Poll for output instead of immediate assertion
    let output = timeout(Duration::from_secs(5), async {
        loop {
            let data = manager.read_accumulated(&id).await;
            if data.contains("hello") {
                return data;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }).await.expect("timed out waiting for PTY output");

    assert!(output.contains("hello"));
}
```

### 5.3 `workspace-changed` Event Design: RESOLVED

**Final position: Single event with full workspace state.** (See Section 3 above.)

Consensus: Backend, Frontend, Tech Lead all agree. PM has no objection. QA has no objection (simpler to test).

### 5.4 Shared Protocol Crate Timing: RESOLVED

**Final position: Phase 7.** Types live in `src-tauri` until the CLI needs them.

PM argued YAGNI. Frontend agreed. Tech lead proposed it but accepted deferral in Round 2. Backend (me) originally agreed with tech lead but accepted PM's argument: extracting a crate for a consumer that doesn't exist yet adds build complexity for no current value. When Phase 7 starts, the first task is extracting `obelisk-protocol`.

### 5.5 Optimistic Updates: RESOLVED

**Final position: No optimistic updates on structural mutations.**

Frontend made a strong argument in Round 2: the roundtrip through Rust for structural changes (split, close, create) is < 5ms locally. Optimistic updates add reconciliation complexity for zero perceptible latency benefit. Frontend waits for `workspace-changed` event before updating the store.

UI-only state (focus, scroll, panel visibility) updates immediately since it never touches Rust.

### 5.6 PTY Output Batching Strategy: RESOLVED

**Final position: Start simple, add batching when benchmarks justify it.**

PM's YAGNI argument wins here. Phase 1 implementation:

```rust
// Phase 1: Simple read-and-emit loop
fn pty_read_loop(reader: Box<dyn Read>, pty_id: String, emitter: Arc<dyn EventEmitter>) {
    let mut buf = [0u8; 4096];
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,  // EOF
            Ok(n) => {
                let data = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                let _ = emitter.emit(&format!("pty-data-{}", pty_id), PtyDataPayload { data });
            }
            Err(e) => {
                tracing::error!(pty_id = %pty_id, error = %e, "PTY read error");
                break;
            }
        }
    }
}
```

Phase 1 acceptance criterion includes a throughput benchmark. If the benchmark shows problems (target: > 50 MB/s pipeline throughput), we add the ring buffer + 60fps batching in a follow-up task within Phase 1. But we don't build it speculatively.

### 5.7 `notify` Crate for Git Watching: RESOLVED

**Final position: Polling first (Phase 3b), filesystem watching as optimization if needed.**

PM's argument is correct: polling every 3-5 seconds is good enough for a sidebar metadata display. The `notify` crate adds a dependency and complexity (cross-platform filesystem event handling has its own bugs). If users report stale git info, we add watching then.

### 5.8 Process Groups / Job Objects: RESOLVED

**Final position: Phase 1 requirement.**

Tech lead asked whether this could wait. No. Orphaned child processes are a correctness bug, not a polish item. If the Tauri app crashes or is force-killed, orphaned shells will linger forever, consuming resources. This is table stakes for a terminal multiplexer.

Implementation:
- Unix: `CommandBuilder::new(shell).set_process_group(true)` (portable-pty supports this via `setsid`)
- Windows: `CommandBuilder::new(shell).set_job_object(true)` (portable-pty supports this)
- Both are single-line configurations on the CommandBuilder.

### 5.9 WebGL Context Limit: Backend Position

Frontend asks about WebGL context pooling. This is entirely a frontend concern — the Rust backend is unaffected by how the frontend renders terminal output. My recommendation to Frontend: start with canvas fallback for non-visible terminals (Phase 1), add context pooling only if measured WebGL performance advantage justifies the complexity.

### 5.10 IPC Authentication: Backend Position

Tech lead asked about IPC socket authentication. My position: **not needed for MVP.** The IPC socket is local-only (Unix socket with 0700 permissions, named pipe with user ACL). Any process running as the same user can already read the user's files, spawn processes, etc. Token auth adds complexity for a threat model that doesn't exist on a single-user local app. If we ever support remote CLI access (unlikely), revisit then.

### 5.11 Scrollback Size Default

Tech lead asks about default scrollback lines. **Backend has no preference** — this is an xterm.js frontend configuration. I suggest 5000 lines as default (frontend's proposal), configurable via settings. The Rust side doesn't store scrollback at all (xterm.js owns it). For persistence (Phase 3b), the frontend serializes scrollback via SerializeAddon and sends it to Rust for storage.

## 6. Testing Infrastructure for Rust (Final)

### Test Dependencies

```toml
[dev-dependencies]
mockall = "0.13"
proptest = "1"
tempfile = "3"
test-log = { version = "0.2", features = ["trace"] }
tokio = { version = "1", features = ["full", "test-util"] }
assert_matches = "1.5"
```

### Unit Test Organization

Every module has a `#[cfg(test)] mod tests` inline. Tests for `pty/manager.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use mockall::predicate::*;

    fn mock_backend() -> MockPtyBackend {
        MockPtyBackend::new()
    }

    fn mock_emitter() -> MockEventEmitter {
        MockEventEmitter::new()
    }

    // -- spawn tests --
    #[tokio::test]
    async fn spawn_returns_pty_id() { ... }
    #[tokio::test]
    async fn spawn_with_custom_shell() { ... }
    #[tokio::test]
    async fn spawn_with_custom_cwd() { ... }
    #[tokio::test]
    async fn spawn_with_invalid_shell_returns_error() { ... }
    #[tokio::test]
    async fn spawn_starts_read_thread() { ... }
    #[tokio::test]
    async fn spawn_sets_process_group() { ... }

    // -- write tests --
    #[tokio::test]
    async fn write_to_valid_pty() { ... }
    #[tokio::test]
    async fn write_to_nonexistent_pty_returns_not_found() { ... }
    #[tokio::test]
    async fn write_to_terminated_pty_returns_error() { ... }
    #[tokio::test]
    async fn write_base64_decodes_before_pty_write() { ... }

    // -- resize tests --
    #[tokio::test]
    async fn resize_valid_pty() { ... }
    #[tokio::test]
    async fn resize_nonexistent_pty_returns_error() { ... }
    #[tokio::test]
    async fn resize_zero_dimensions_returns_error() { ... }

    // -- kill tests --
    #[tokio::test]
    async fn kill_valid_pty_cleans_up() { ... }
    #[tokio::test]
    async fn kill_nonexistent_returns_error() { ... }
    #[tokio::test]
    async fn kill_already_terminated_returns_error() { ... }
    #[tokio::test]
    async fn kill_stops_read_thread() { ... }

    // -- concurrent operation tests --
    #[tokio::test]
    async fn concurrent_writes_to_same_pty() { ... }
    #[tokio::test]
    async fn spawn_multiple_ptys_simultaneously() { ... }
}
```

### Integration Test Organization

```
src-tauri/tests/
├── pty_integration.rs       # Real PTY lifecycle tests
├── osc_parser_exhaustive.rs # Golden file + proptest for OSC parsing
├── workspace_state.rs       # State mutation sequences
├── persistence.rs           # Save/load roundtrip, crash recovery, corruption
└── ipc_integration.rs       # Socket server + client exchange (Phase 7)
```

Integration tests for real PTY (as QA demanded):

```rust
// tests/pty_integration.rs

#[tokio::test]
async fn spawn_real_shell_and_read_prompt() { ... }

#[tokio::test]
async fn write_echo_read_output() { ... }

#[tokio::test]
async fn rapid_sequential_writes() { ... }

#[tokio::test]
async fn large_output_cat_head() { ... }

#[tokio::test]
async fn resize_changes_columns() { ... }

#[tokio::test]
async fn kill_during_running_process() { ... }

#[tokio::test]
async fn shell_exit_triggers_cleanup() { ... }

#[tokio::test]
async fn concurrent_ptys_independent() { ... }
```

All PTY integration tests use polling-with-timeout assertions (not sleep), as described in the retry policy resolution.

### Property-Based Tests for OSC Parser

```rust
// In osc_parser.rs #[cfg(test)]
use proptest::prelude::*;

proptest! {
    #[test]
    fn never_panics_on_arbitrary_input(data in proptest::collection::vec(any::<u8>(), 0..10000)) {
        let mut parser = OscParser::new();
        let _ = parser.feed(&data);
    }

    #[test]
    fn forwards_all_input_bytes(data in proptest::collection::vec(any::<u8>(), 0..10000)) {
        let mut parser = OscParser::new();
        let result = parser.feed(&data);
        assert_eq!(result.forwarded.len(), data.len());
    }

    #[test]
    fn extracts_osc9_correctly(payload in "[a-zA-Z0-9 ]{1,200}") {
        let mut parser = OscParser::new();
        let input = format!("\x1b]9;{}\x07", payload);
        let result = parser.feed(input.as_bytes());
        assert_eq!(result.notifications.len(), 1);
        assert_eq!(result.notifications[0].title, payload);
    }

    #[test]
    fn handles_split_across_boundaries(
        data in proptest::collection::vec(any::<u8>(), 0..1000),
        split_point in 0..1000usize
    ) {
        let split_point = split_point.min(data.len());
        let mut parser1 = OscParser::new();
        let mut parser2 = parser1.clone();

        // Feed all at once
        let result_whole = parser1.feed(&data);

        // Feed in two parts
        let result_part1 = parser2.feed(&data[..split_point]);
        let result_part2 = parser2.feed(&data[split_point..]);

        // Same notifications extracted regardless of split point
        let combined_notifications: Vec<_> = result_part1.notifications.iter()
            .chain(result_part2.notifications.iter())
            .collect();
        assert_eq!(result_whole.notifications.len(), combined_notifications.len());
    }
}
```

### Benchmark Harness (criterion)

```rust
// benches/pty_throughput.rs
use criterion::{criterion_group, criterion_main, Criterion, Throughput};

fn bench_base64_encode(c: &mut Criterion) {
    let data = vec![0u8; 16384]; // 16KB chunk
    let mut group = c.benchmark_group("base64_encode");
    group.throughput(Throughput::Bytes(data.len() as u64));
    group.bench_function("16kb", |b| {
        b.iter(|| base64::engine::general_purpose::STANDARD.encode(&data))
    });
    group.finish();
}

fn bench_osc_parser(c: &mut Criterion) {
    let data = include_bytes!("../fixtures/pty/large_output.bin");
    let mut group = c.benchmark_group("osc_parser");
    group.throughput(Throughput::Bytes(data.len() as u64));
    group.bench_function("10mb_scan", |b| {
        b.iter(|| {
            let mut parser = OscParser::new();
            parser.feed(data)
        })
    });
    group.finish();
}

fn bench_event_serialization(c: &mut Criterion) {
    let payload = PtyDataPayload {
        data: base64::engine::general_purpose::STANDARD.encode(&[0u8; 16384]),
    };
    c.bench_function("serialize_pty_event", |b| {
        b.iter(|| serde_json::to_string(&payload).unwrap())
    });
}

criterion_group!(benches, bench_base64_encode, bench_osc_parser, bench_event_serialization);
criterion_main!(benches);
```

## 7. Performance Targets (Final)

| Metric | Target | How Measured |
|--------|--------|-------------|
| PTY pipeline throughput | > 50 MB/s | criterion bench: read → base64 → serialize |
| OSC parser throughput | > 200 MB/s | criterion bench: feed 10MB |
| Event serialization | < 10 us per event | criterion bench: serialize 16KB payload |
| Input latency (pty_write → pty_read) | < 5 ms | Integration test with timing |
| Workspace state serialization | < 1 ms for 20-pane workspace | criterion bench |
| Session save (atomic write) | < 50 ms for typical state | criterion bench |
| Memory per PTY | < 100 KB Rust-side | Manual profiling |
| Startup time (cold) | < 500 ms to first terminal prompt | E2E test with timing |

## 8. Cross-Platform Verification (Final)

### Per-Platform CI Matrix

| Test Suite | Linux (every PR) | macOS (every PR) | Windows (nightly + release) |
|-----------|-------------------|-------------------|---------------------------|
| `cargo test --workspace` | Y | Y | Y |
| `cargo llvm-cov` (95% gate) | Y | N | N |
| `cargo clippy` | Y | N | N |
| `cargo fmt --check` | Y | N | N |
| `bun test --coverage` | Y | N | N |
| `bun run lint` | Y | N | N |
| E2E (Playwright + tauri-driver) | Y | Y (merge to main) | Y (nightly) |
| criterion benchmarks | Y (store results) | N | N |

**Windows nightly rationale**: Windows CI runners are the slowest and most expensive. Running on every PR adds 5-10 minutes to CI. Running nightly catches Windows-specific regressions within 24 hours, which is acceptable for development velocity. When a Windows-specific bug is found, we add a targeted regression test that runs on every PR.

### Platform-Specific Test Cases

```rust
#[cfg(unix)]
#[test]
fn default_shell_uses_shell_env_var() {
    std::env::set_var("SHELL", "/bin/zsh");
    assert_eq!(default_shell(), "/bin/zsh");
}

#[cfg(unix)]
#[test]
fn default_shell_falls_back_to_bin_sh() {
    std::env::remove_var("SHELL");
    assert_eq!(default_shell(), "/bin/sh");
}

#[cfg(windows)]
#[test]
fn default_shell_prefers_pwsh() {
    // Runs on Windows CI only
    // Test that shell detection order is pwsh > powershell > cmd
}

#[cfg(windows)]
#[test]
fn pty_handles_crlf_output() {
    // ConPTY may emit CRLF — verify our pipeline doesn't double-translate
}

#[cfg(unix)]
#[test]
fn pty_process_group_cleanup() {
    // Verify child processes are killed when parent PTY is killed
}

#[cfg(windows)]
#[test]
fn pty_job_object_cleanup() {
    // Verify Job Object terminates children on parent kill
}
```

## 9. Summary: What Is Decided

| Decision | Resolution | Agreed By |
|----------|-----------|-----------|
| Source of truth | Rust owns structural state | All 5 |
| Frontend stores | 2 stores: `workspaceStore` (mirror) + `uiStore` (focus, UI) | Backend, Frontend, Tech Lead |
| Event design | Single `workspace-changed` with full state | Backend, Frontend, Tech Lead |
| Error types | thiserror, no anyhow, structured `{ kind, message }` serialization | Backend, Tech Lead |
| Coverage gate | 95% overall, 100% on business logic modules | Backend, PM, Tech Lead |
| E2E retries | 0 for unit/integration, 1 for E2E with investigation mandate | Backend, Frontend |
| PTY batching | Simple emit first, add batching when benchmarks justify | PM, Backend |
| Shared protocol crate | Phase 7, not Phase 1 | PM, Frontend, Backend |
| Optimistic updates | No optimistic updates on structural mutations | Frontend, Backend |
| Process cleanup | Phase 1 requirement (process groups + Job Objects) | Backend, Tech Lead |
| Git watching | Polling first, `notify` crate if users need it | PM, Backend |
| IPC auth | Not needed for MVP | Backend |
| ts-rs timing | Phase 1 (tech lead's position won — it's low cost, high value) | Tech Lead, Frontend, QA |
| Windows CI | Nightly + release, not every PR | Backend, PM |
| Scrollback default | 5000 lines, configurable | Frontend, Backend defers |
| Phase 3 split | 3a (layout persistence) + 3b (scrollback + metadata) | PM, Backend, Tech Lead |
| Quality gates | Apply to merge to main, not to starting work | PM, Backend |
