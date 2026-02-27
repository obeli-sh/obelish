# Round 2: Senior Backend Engineer — Cross-Role Debate

## 1. Responding to Frontend's Expectations about Tauri Commands and Events

### Points of Agreement
Frontend and I fully agree on:
- **Rust as single source of truth** for structural state. Both independently arrived at this conclusion. This is now consensus.
- **ts-rs for type generation**. Tech lead also recommends this. Three independent votes — this is decided.
- **Base64 batching per animation frame**. Frontend's `requestAnimationFrame` coalescing on their side pairs perfectly with my 16ms flush interval on the Rust side. The two halves of the same strategy.

### Concrete Command Signatures (Responding to Frontend's and Tech Lead's proposals)

Tech lead proposed `invoke<string>('pty_spawn', { shell?: string, cwd?: string })`. Frontend expects `invoke<PtySpawnResult>('pty_spawn', args)`. Let me nail down the exact Rust signatures that the frontend will call, with camelCase field names since Tauri uses `#[serde(rename_all = "camelCase")]` by default:

```rust
// --- PTY Commands ---

#[tauri::command]
async fn pty_spawn(
    state: State<'_, AppState>,
    app: AppHandle,
    shell: Option<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
) -> Result<PtySpawnResult, BackendError>

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PtySpawnResult {
    pty_id: String,
}

#[tauri::command]
async fn pty_write(
    state: State<'_, AppState>,
    pty_id: String,
    data: String,  // base64-encoded keystrokes
) -> Result<(), BackendError>

#[tauri::command]
async fn pty_resize(
    state: State<'_, AppState>,
    pty_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), BackendError>

#[tauri::command]
async fn pty_kill(
    state: State<'_, AppState>,
    pty_id: String,
) -> Result<(), BackendError>

// --- Workspace Commands ---

#[tauri::command]
async fn workspace_create(
    state: State<'_, AppState>,
    app: AppHandle,
    name: Option<String>,
    cwd: Option<String>,
) -> Result<WorkspaceInfo, BackendError>

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceInfo {
    id: String,
    name: String,
    surfaces: Vec<SurfaceInfo>,
    created_at: u64,  // unix timestamp ms
}

#[tauri::command]
async fn workspace_close(
    state: State<'_, AppState>,
    app: AppHandle,
    workspace_id: String,
) -> Result<(), BackendError>

#[tauri::command]
async fn workspace_list(
    state: State<'_, AppState>,
) -> Result<Vec<WorkspaceInfo>, BackendError>

#[tauri::command]
async fn pane_split(
    state: State<'_, AppState>,
    app: AppHandle,
    pane_id: String,
    direction: SplitDirection,
    shell: Option<String>,
) -> Result<PaneSplitResult, BackendError>

#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum SplitDirection {
    Horizontal,
    Vertical,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PaneSplitResult {
    new_pane_id: String,
    pty_id: String,
}

#[tauri::command]
async fn pane_close(
    state: State<'_, AppState>,
    app: AppHandle,
    pane_id: String,
) -> Result<(), BackendError>
```

### Event Payloads (Concrete Definitions)

```rust
// Emitted per-PTY, up to 60 times/sec with batched data
// Event name: "pty-data-{pty_id}"
#[derive(Serialize, Clone)]
struct PtyDataEvent {
    data: String,  // base64-encoded terminal output
}

// Emitted when PTY process exits
// Event name: "pty-exit-{pty_id}"
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PtyExitEvent {
    exit_code: Option<i32>,  // None if killed by signal
    signal: Option<i32>,     // Unix only
}

// Emitted on workspace structural changes
// Event name: "workspace-changed"
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct WorkspaceChangedEvent {
    workspace_id: String,
    change_type: WorkspaceChangeType,
    state: WorkspaceInfo,  // full workspace state after change
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "snake_case")]
enum WorkspaceChangeType {
    Created,
    Closed,
    PaneSplit,
    PaneClosed,
    SurfaceCreated,
    SurfaceClosed,
    Renamed,
}

// Emitted when OSC notification detected
// Event name: "notification"
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct NotificationEvent {
    id: String,
    pane_id: String,
    workspace_id: String,
    title: String,
    body: Option<String>,
    osc_type: u32,  // 9, 99, or 777
    timestamp: u64,
}

// Emitted when git info changes
// Event name: "git-info-{pane_id}"
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct GitInfoEvent {
    branch: Option<String>,
    is_dirty: bool,
    ahead: u32,
    behind: u32,
}

// Emitted when port scan detects changes
// Event name: "ports-changed-{pane_id}"
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PortsChangedEvent {
    ports: Vec<PortInfo>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PortInfo {
    port: u16,
    pid: Option<u32>,
    process_name: Option<String>,
}
```

### Disagreement with Frontend: Store Splitting

Frontend proposes splitting `workspaceStore` into 4 stores (`workspaceStore`, `layoutStore`, `paneStore`, `focusStore`). **I challenge this if Rust is the source of truth.**

If Rust owns structural state and the frontend merely mirrors it via `workspace-changed` events, the frontend doesn't need separate stores for layout and panes — it just needs a projection of whatever Rust emits. The `WorkspaceChangedEvent` contains the full `WorkspaceInfo` (which includes surfaces and panes). The frontend store becomes essentially a cache:

```typescript
// One store is sufficient since it's just a mirror
interface WorkspaceMirrorStore {
  workspaces: Map<string, WorkspaceInfo>;
  activeWorkspaceId: string | null;
  // UI-only state below
  focusedPaneId: string | null;
  sidebarOpen: boolean;
}
```

Splitting into 4 stores creates unnecessary complexity when the data arrives as a single event payload. However, I concede that a separate `focusStore` for UI-only focus state is reasonable since focus tracking is purely a frontend concern.

**Counter-proposal**: 2 stores max. `workspaceStore` (mirrors Rust state) + `uiStore` (focus, sidebar, panel visibility).

## 2. Challenging and Accepting Tech Lead's Cross-Cutting Proposals

### Accepted: Shared Protocol Crate
Tech lead's proposal for `obelisk-protocol` as a third workspace member is correct. The IPC protocol types (JSON-RPC request/response, method enums, param/result types) are shared between `src-tauri` and `cli`. Duplicating them is a bug waiting to happen.

```toml
[workspace]
members = ["src-tauri", "cli", "obelisk-protocol"]
```

**I extend this**: `obelisk-protocol` should also contain the `WorkspaceInfo`, `PaneInfo`, `SurfaceInfo` structs since both the CLI (for display) and the Tauri app (for state) need them.

### Accepted: tracing over log/println
Agreed. `tracing` with structured spans is strictly better. One addition: we should use `tracing::instrument` on all Tauri command handlers for automatic span creation:

```rust
#[tauri::command]
#[tracing::instrument(skip(state, app))]
async fn pty_spawn(...) -> Result<PtySpawnResult, BackendError> { ... }
```

### Accepted: ts-rs for Type Generation
Three-way consensus (me, tech lead, frontend). Decided.

### Accepted: just (justfile) for Task Orchestration
No objections. Better than Makefile for cross-platform.

### Challenged: thiserror + anyhow

Tech lead says "use `thiserror` for typed errors, `anyhow` for internal propagation." **I disagree with using anyhow anywhere in library code.** `anyhow` erases error types and makes matching impossible. Our error types should be fully typed end-to-end:

```rust
// Module-specific errors
#[derive(Debug, thiserror::Error)]
pub enum PtyError {
    #[error("spawn failed: {0}")]
    SpawnFailed(#[source] std::io::Error),
    #[error("not found: {id}")]
    NotFound { id: String },
    #[error("already killed: {id}")]
    AlreadyKilled { id: String },
    #[error("write failed: {0}")]
    WriteFailed(#[source] std::io::Error),
    #[error("resize failed: {0}")]
    ResizeFailed(String),
}

// Top-level error that Tauri commands return
#[derive(Debug, thiserror::Error)]
pub enum BackendError {
    #[error(transparent)]
    Pty(#[from] PtyError),
    #[error(transparent)]
    Workspace(#[from] WorkspaceError),
    #[error(transparent)]
    Ipc(#[from] IpcError),
    #[error(transparent)]
    Persistence(#[from] PersistenceError),
}

// Serialize impl for Tauri (Tauri requires Serialize on error types)
impl Serialize for BackendError {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        // Serialize as { "kind": "PtyNotFound", "message": "..." }
        let mut map = s.serialize_map(Some(2))?;
        map.serialize_entry("kind", &self.error_kind())?;
        map.serialize_entry("message", &self.to_string())?;
        map.end()
    }
}
```

This gives the frontend structured errors it can match on (`kind` field), not opaque strings. Tech lead's suggestion of `Result<T, String>` for Tauri is the old Tauri v1 pattern — Tauri v2 supports `Result<T, E>` where `E: Serialize`.

### Challenged: CI Pipeline Timing

Tech lead says "Set up CI in Phase 1, not Phase 8." I agree with the intent but **the implementation should be even more aggressive**: CI should be the very first thing we build, before any feature code. QA calls this "Phase 0" and I support that framing. The first PR should be:
1. Cargo workspace with empty lib crates
2. `justfile` with `dev`, `test`, `lint` targets
3. GitHub Actions workflow
4. Pre-commit hooks

No feature code. Just infrastructure.

### Challenged: TCP Fallback for IPC on Windows

Tech lead suggests "use localhost TCP as a fallback on Windows" for IPC. **I strongly disagree.** TCP opens a network port, which is a security surface. Any process (or remote attacker on the same network) could connect. Named pipes on Windows have ACL-based security. The `interprocess` crate's named pipe support works — if we hit bugs, we fix or patch the crate. Never fall back to TCP.

## 3. Addressing PM's Risk Concerns with Technical Solutions

### Risk: portable-pty Maintenance
PM flags that portable-pty may be stale. **Technical solution**: The `PtyBackend` trait I proposed in Round 1 is our insurance policy. If portable-pty dies, we can write a `RawPtyBackend` that calls ConPTY/POSIX APIs directly. The trait boundary means zero changes to `PtyManager` or any consumer. This is a 2-day swap, not a rewrite.

Additionally, portable-pty 0.8 is quite stable. The wezterm project may have slowed, but the PTY crate is feature-complete for our needs. We don't need active development — we need it to work. It does.

### Risk: Phase 3 Complexity
PM suggests splitting Phase 3 into 3a (layout persistence) and 3b (scrollback + metadata). **I strongly agree from a backend perspective.** Here's why:

- **3a (layout persistence)** is pure Rust serialization — `serde_json::to_string(&workspace_state)` → atomic write. This is straightforward and testable. Maybe 2-3 days of Rust work.
- **3b (scrollback)** requires coordination with the frontend (xterm.js SerializeAddon sends data back to Rust for storage). This crosses the bridge and is harder to test. It also has compression concerns (scrollback for 20 terminals could be 50MB+).
- **3c (git/port metadata)** is a separate subsystem entirely — file watchers, subprocess spawning, caching. It has nothing to do with persistence.

Lumping these together hides the complexity. Split them.

### Risk: Cross-Platform Testing from Day 1
PM says "Start cross-platform testing from day 1." **I agree, with a caveat**: Windows CI is slow and expensive. My proposal:

1. **Linux CI**: Every PR. Full test suite + coverage.
2. **macOS CI**: Every PR. Full test suite, no coverage (saves time).
3. **Windows CI**: Nightly + release branches. Full test suite.

This catches Windows issues within 24 hours while keeping PR CI fast. When we find a Windows bug, we add a platform-specific regression test that runs on every PR from then on.

### Risk: Keyboard Shortcuts in Phase 2
PM says "Move basic keybindings into Phase 2." **From the backend, I have no objection** — keyboard shortcuts are entirely a frontend concern in Phase 2 (they trigger `invoke()` calls that already exist). The Rust side doesn't need changes for this.

## 4. Debating Testing Boundaries with QA

### Where I Agree with QA

**Phase 0 test infrastructure**: QA is right that test tooling comes first. I fully endorse the Rust test stack (`cargo-llvm-cov`, `mockall`, `proptest`, `tempfile`, `test-log`). These are exactly the right tools.

**PtyBackend trait for mocking**: QA and I independently arrived at the same `PtyBackend` trait design. This is now triple-consensus (me, QA, tech lead all mention it).

**Contract testing between Rust and TypeScript**: QA's proposal for shared schema verification is critical. With `ts-rs`, we can auto-generate TypeScript types from Rust structs, then test in CI that the generated types compile and match the frontend's expectations.

### Where I Challenge QA

**100% line coverage is unrealistic and counterproductive for certain code paths.** QA demands `--fail-under 100` for Rust. I have specific concerns:

1. **Platform-specific code under `#[cfg(windows)]`**: Linux CI can't cover Windows-only branches. QA acknowledges this ("Coverage only computed once (Linux)") but then demands 100%. These are contradictory. The Windows-only code paths (ConPTY init, named pipe binding, Job Object setup, shell detection via `$COMSPEC`) will show as uncovered on Linux.

2. **Error paths that require OS failures**: Some error paths (e.g., "filesystem ran out of space during atomic write", "socket bind failed because address in use") are nearly impossible to trigger deterministically in unit tests without mocking the entire OS layer. Adding mock traits for every OS call just to hit 100% coverage adds complexity with diminishing returns.

3. **`main.rs` entry point and Tauri setup code**: QA says "Keep minimal (< 10 lines)." Agreed in principle, but Tauri's builder pattern (registering commands, setting up state, configuring plugins) is inherently untestable at the unit level — it's integration glue.

**My counter-proposal**:
- **95% line coverage** as the CI gate for Rust, with explicit `#[cfg(not(tarpaulin_include))]` annotations on genuinely untestable glue code (must be justified in code review)
- **100% coverage on business logic modules** (pty, workspace, osc_parser, ipc_server/protocol, persistence) — enforced per-module
- Platform-specific code tested on its platform in the nightly CI run

### What Needs Real PTY vs Mocked?

QA asks this directly. My answer:

**Must use real PTY (integration tests)**:
- Spawn shell + verify prompt appears (validates portable-pty actually works)
- Write `echo hello\n` + read output (validates I/O pipeline end-to-end)
- Resize + verify `$COLUMNS`/`$LINES` change (validates resize signal delivery)
- Shell exit + verify EOF detection + cleanup (validates lifecycle)
- ConPTY-specific: TUI apps (at least `vim -c "q"` and `less /dev/null`)

**Can use mocked PTY (unit tests)**:
- `PtyManager` dispatch logic (route write to correct PTY, error on unknown ID)
- Concurrent operation handling (many writers, many PTYs)
- Backpressure / buffer management logic
- OSC parser (pure function — doesn't need PTY at all, just byte streams)
- Event emission (verify correct event name/payload format)

**QA's "no retries in CI" policy is correct** but needs a safety valve. Some PTY tests are inherently timing-sensitive (especially on Windows ConPTY). I propose: tests that interact with real PTY processes get a `#[timeout(10_000)]` attribute and use retry-with-backoff internally for output assertions (poll until output matches or timeout, rather than a single assertion). This is not retrying the test — it's waiting for the OS to deliver data.

## 5. Error Handling Contract Between Rust and React

### Error Shape
Every Tauri command error reaches the frontend as a rejected promise. The error payload should be structured:

```typescript
// Frontend receives this on invoke() rejection
interface BackendError {
  kind: string;    // "PtyNotFound" | "SpawnFailed" | "WorkspaceNotFound" | ...
  message: string; // Human-readable description
}

// Usage:
try {
  await tauriBridge.pty.spawn({ cwd: '/tmp' });
} catch (e: unknown) {
  const err = e as BackendError;
  switch (err.kind) {
    case 'SpawnFailed':
      showError('Failed to start terminal: ' + err.message);
      break;
    case 'PtyNotFound':
      // Stale pane reference — remove from UI
      removePaneFromStore(paneId);
      break;
    default:
      showGenericError(err.message);
  }
}
```

### Error Categories and Frontend Behavior

| Error Kind | Frontend Response |
|-----------|-------------------|
| `SpawnFailed` | Show error overlay on pane, offer retry |
| `PtyNotFound` | Remove pane from layout (stale reference) |
| `WriteFailed` | Show "disconnected" indicator on pane |
| `WorkspaceNotFound` | Refresh workspace list from Rust |
| `PersistenceError` | Show toast warning, continue operating |
| `IpcError` | Internal — CLI shows error, not relevant to frontend |
| `InvalidOperation` | Show toast with message (user tried impossible action) |

### Non-Error Scenarios That Need Handling

- **PTY process exits normally**: Not an error. Rust emits `pty-exit-{id}` event. Frontend shows "Process exited (code 0)" with option to restart or close pane.
- **PTY process crashes (non-zero exit)**: Same event with non-zero code. Frontend shows exit code and optional restart.
- **Workspace close with running PTYs**: Rust kills all PTYs in workspace, then closes. Not an error. Frontend receives `workspace-changed` event with `Closed` type.

## 6. Responding to Tech Lead's Performance Concerns

### Benchmark Harness in Phase 1
Tech lead says "Implement a benchmark harness early (Phase 1). Measure time from PTY write to xterm.js render. Target: <5ms for typical output, <50ms for bulk data."

**I agree, and I'll own the Rust side of this.** Concrete plan:

```rust
// benches/pty_throughput.rs (criterion)
fn bench_pty_read_encode(c: &mut Criterion) {
    // Measure: read N bytes from PTY → base64 encode → ready for emission
    // Baseline: 10MB should complete in < 200ms
}

fn bench_osc_parse_throughput(c: &mut Criterion) {
    // Measure: parse N bytes through OSC state machine
    // Baseline: 10MB should complete in < 50ms (must not bottleneck read path)
}

fn bench_event_serialization(c: &mut Criterion) {
    // Measure: serialize PtyDataEvent with 16KB base64 payload
    // Baseline: < 10μs per event
}
```

The frontend side needs a complementary benchmark (base64 decode + xterm.js write latency). I'll define the Rust-side numbers; frontend engineer defines theirs. Combined target: **< 16ms total pipeline latency** for a single frame of PTY output.

### Memory Concern: Scrollback Buffers
Tech lead mentions scrollback memory. **From the Rust side**, I don't store scrollback — xterm.js owns the buffer. The Rust read thread only holds the current flush buffer (~16KB max). With 20 terminals, that's 320KB of Rust-side memory for buffers. Negligible.

The memory concern is entirely on the frontend (xterm.js scrollback). Frontend engineer should address this.

## 7. Areas of Consensus Across All Roles

After reading all five analyses, these points have multi-role consensus and should be considered **decided**:

1. **Rust is source of truth for structural state** (Backend, Frontend, Tech Lead — 3/5)
2. **ts-rs for type generation** (Backend, Frontend, Tech Lead — 3/5)
3. **PtyBackend trait for testability** (Backend, Tech Lead, QA — 3/5)
4. **Phase 0 for test infrastructure** (QA, Tech Lead, Backend — 3/5)
5. **Base64 with batching is acceptable** (Backend, Frontend, Tech Lead — 3/5, PM flagged as risk but accepted mitigation)
6. **tracing crate for logging** (Tech Lead, Backend — 2/5, no objections from others)
7. **Keyboard shortcuts in Phase 2** (PM, Frontend — 2/5, no objections from Backend/Tech Lead)
8. **Phase 3 split into sub-phases** (PM, Backend — 2/5)
9. **WebGL fallback to canvas** (Tech Lead, Frontend — 2/5)

## 8. Open Questions That Need Resolution in Round 3

1. **Coverage threshold**: 100% (QA) vs 95% + per-module 100% on business logic (Backend). Need to converge.
2. **Frontend store count**: 4 stores (Frontend) vs 2 stores (Backend). Need Frontend's response to the "mirror store" argument.
3. **Windows CI frequency**: Every PR (QA) vs nightly (Backend). Cost/benefit analysis needed.
4. **IPC multi-instance strategy**: PID-based socket naming vs single-instance enforcement. PM/Tech Lead haven't weighed in.
5. **Shared crate scope**: Just IPC protocol types (Tech Lead) or also workspace/pane structs (Backend)?
6. **Error payload format**: Structured `{ kind, message }` (Backend) — does Frontend agree?
