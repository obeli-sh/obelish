# Round 1: Senior Backend Engineer — Initial Analysis

## 1. PTY Management Deep Dive

### portable-pty API Surface
`portable-pty` (from the wezterm project) provides `PtySystem::default()` which yields `NativePtySystem`. Key API:
- `open_pair(size)` → returns `(MasterPty, SlavePty)`
- `SlavePty::spawn_command(cmd)` → `Child` handle
- `MasterPty` implements `Write` (stdin) and can produce a `Read`-able reader via `try_clone_reader()`
- `MasterPty::resize(PtySize)` for SIGWINCH

### ConPTY vs Unix PTY Differences
| Aspect | Unix (macOS/Linux) | Windows (ConPTY) |
|--------|-------------------|-------------------|
| API | `/dev/ptmx` + POSIX forkpty | `CreatePseudoConsole` Win32 API |
| Signal | SIGWINCH for resize | ConPTY handles resize via API |
| EOF detection | Reader returns 0 bytes | Reader returns error |
| Shell | `$SHELL` or `/bin/bash` | `cmd.exe` or `powershell.exe` |
| Env vars | `TERM=xterm-256color` | `TERM` less relevant |
| Latency | Very low | Higher — ConPTY adds processing layer |
| Color | Full ANSI escape support | ConPTY translates; some edge cases |

**Risk**: ConPTY has known bugs with certain escape sequences (especially mouse protocols and some SGR attributes). We should test with popular TUI apps (vim, htop, tmux-within-obelisk) on Windows early.

### Process Lifecycle
```
spawn() → Child { pid/handle }
  ↓
read loop (dedicated thread) → emits events
  ↓
wait_for_exit() → ExitStatus
  ↓
cleanup: close master pty, drop reader, remove from manager map
```

**Critical concern**: When a shell exits, the PTY reader must detect EOF and trigger cleanup. On Unix this is clean (read returns 0). On Windows, `portable-pty`'s reader may return `Err` with specific error codes. We need platform-specific EOF detection logic wrapped in a cross-platform trait.

**Resource cleanup**: We must ensure that if the Tauri app is force-killed, orphaned child processes are reaped. On Unix we can use process groups (`setpgid`). On Windows, Job Objects can auto-terminate children when the parent dies. `portable-pty` supports `CommandBuilder::set_job_object()` on Windows — we should always use this.

## 2. Async Architecture

### Tokio Runtime Strategy
Tauri v2 uses tokio under the hood. Our async architecture:

```
Main Thread: Tauri event loop (UI + window management)
Tokio Runtime: async commands, IPC server, git/port polling
Dedicated OS Threads: PTY read loops (one per pane)
```

**Why dedicated threads for PTY reads**: `portable-pty`'s reader is synchronous (`std::io::Read`). Wrapping in `tokio::task::spawn_blocking` is an option, but each blocked task consumes a tokio blocking thread from the pool. With many terminals open (10-20+), this could exhaust the default blocking thread pool (512 threads is plenty, but each thread holds stack memory). Better approach: **spawn explicit `std::thread`s for PTY reads** with explicit channel-based communication back to the async world.

### Thread Management for PTY I/O
```
Per-PTY:
  - 1 std::thread for reading (blocking read loop)
  - Writes go through: tokio command handler → mpsc::Sender → master_pty.write()

Channel design:
  - Read thread → tokio::sync::mpsc → event emission task
  - Command handler → std::sync::mpsc or crossbeam → read thread (for shutdown signal)
```

**Alternative considered**: Using `tokio::io::AsyncFd` to wrap the Unix PTY fd. This would be more efficient but is Unix-only and not supported on Windows. For cross-platform consistency, dedicated threads are better.

### Backpressure Handling
If the frontend can't keep up with PTY output (e.g., `cat /dev/urandom`), we need backpressure:
1. **Bounded channel** between read thread and event emitter (e.g., capacity 64)
2. When channel is full, **coalesce**: accumulate in a buffer, send in bulk when space opens
3. Frontend-side: xterm.js can handle large writes efficiently with `write()` accepting callbacks
4. **Rate limiting**: Cap event emission to ~60Hz — batch PTY output into frames

**My recommendation**: Use a ring buffer in the read thread. On each read, append to buffer. A timer (or channel availability) triggers flushing the buffer as a single base64 event. This naturally coalesces fast output.

## 3. Data Flow Concerns

### Base64 Encoding Overhead
- Base64 inflates data by ~33%
- For typical terminal output (a few KB per frame), this is negligible
- For `cat large_file`, output can burst to MB/s — encoding adds CPU but is fast (base64 crate is SIMD-optimized)
- **Real bottleneck**: Tauri event serialization (JSON wrapping) and webview IPC, not base64 itself

### Event Throughput Limits
- Tauri events go through the webview IPC bridge (postMessage on the JS side)
- Each event has overhead: serialization, message passing, deserialization
- **Measured concern**: At high output rates (>1000 events/sec), the IPC bridge can lag
- **Mitigation**: Batch PTY output — emit at most one event per ~16ms (60fps) per PTY, with accumulated data

### Buffering Strategy
```rust
struct PtyReadBuffer {
    inner: Vec<u8>,       // accumulates raw bytes
    last_flush: Instant,  // track time since last emission
    dirty: bool,
}

// Flush when:
// 1. Buffer exceeds 16KB, OR
// 2. 16ms elapsed since last flush AND buffer is dirty, OR
// 3. EOF detected
```

This prevents both flooding (fast output) and lag (slow output still flushes quickly).

## 4. IPC Server Design

### Unix Socket vs Named Pipe Abstraction
The `interprocess` crate provides:
- `LocalSocketListener` / `LocalSocketStream` — abstracts Unix sockets (Linux/macOS) and named pipes (Windows)
- Single API, platform-specific implementation underneath

**Socket path convention**:
- Unix: `$XDG_RUNTIME_DIR/obelisk.sock` or `/tmp/obelisk-{uid}.sock`
- Windows: `\\.\pipe\obelisk-{username}`

**Concern**: Multiple instances. If a user runs two Obelisk instances, the socket name collides. Solution: include a session ID or PID in the socket name, and maintain a "discovery" file listing active sessions.

### JSON-RPC Protocol Design
```rust
// Request
#[derive(Serialize, Deserialize)]
struct RpcRequest {
    jsonrpc: String,     // "2.0"
    id: u64,
    method: String,      // "workspace.create", "pane.split", "notify"
    params: serde_json::Value,
}

// Response
#[derive(Serialize, Deserialize)]
struct RpcResponse {
    jsonrpc: String,
    id: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<RpcError>,
}

#[derive(Serialize, Deserialize)]
struct RpcError {
    code: i32,
    message: String,
    data: Option<serde_json::Value>,
}
```

**Methods**: `workspace.create`, `workspace.list`, `workspace.focus`, `pane.split`, `pane.focus`, `pane.close`, `notify.send`, `session.info`

**Framing**: Length-prefixed messages. Each message is `u32 (big-endian length) + JSON bytes`. This avoids delimiter issues with newline-based framing in JSON.

## 5. State Management

### Workspace State: Rust vs Frontend
The PRD puts workspace state in both Zustand (frontend) and Rust structs. This creates a **dual-state problem** — which is the source of truth?

**My recommendation**: **Rust is the source of truth** for structural state (what workspaces exist, what panes are in them, their PTY associations). Frontend mirrors this via events. Reasons:
1. The CLI needs to query/modify state without the frontend
2. Session persistence is simpler from one source
3. Avoids race conditions between frontend and backend state

**Frontend owns**: UI-only state (which pane is focused, scroll position, search state, panel open/closed). These don't need to persist or be visible to CLI.

### Consistency Guarantees
- All structural mutations go through Tauri commands → Rust updates state → emits event → frontend syncs
- Frontend never directly mutates structural state
- Optimistic updates are fine for UI responsiveness, but must reconcile on event receipt
- Use a monotonic version counter on workspace state to detect stale updates

## 6. Session Persistence

### JSON Serialization Concerns
The workspace tree (with nested layout nodes) serializes cleanly to JSON via serde. However:
- **Don't persist**: PTY handles, thread handles, channel senders — these are runtime-only
- **Do persist**: Layout tree, working directories, shell commands, pane metadata, scrollback references
- Scrollback: Store separately as compressed files (one per pane), referenced by ID

### Atomic Writes
Never write directly to the session file — a crash mid-write corrupts it:
```rust
// 1. Write to temp file
// 2. fsync temp file
// 3. rename temp → target (atomic on POSIX; on Windows use ReplaceFile)
fn atomic_write(path: &Path, data: &[u8]) -> io::Result<()> {
    let tmp = path.with_extension("tmp");
    let mut f = File::create(&tmp)?;
    f.write_all(data)?;
    f.sync_all()?;
    std::fs::rename(&tmp, path)?;
    Ok(())
}
```

### Crash Recovery
- On startup, check for `.tmp` file — if present, the previous write was interrupted
- Keep last-known-good session as `.bak`
- Save session periodically (every 30s) and on every structural change (workspace create/close, pane split/close)
- Use `tauri::RunEvent::ExitRequested` to trigger final save

## 7. OSC Parsing

### Streaming Parser Design
OSC sequences: `ESC ] <code> ; <payload> BEL` or `ESC ] <code> ; <payload> ESC \`

**Challenge**: PTY read boundaries don't align with escape sequence boundaries. A single read might contain:
- A partial OSC sequence (started but not terminated)
- Multiple complete sequences
- A mix of normal output and sequences

**Parser design**: State machine per PTY:
```rust
enum OscParserState {
    Normal,
    Esc,                    // saw ESC
    OscStart,               // saw ESC ]
    OscCode(String),        // accumulating code digits
    OscPayload(u32, Vec<u8>), // code known, accumulating payload
    EscInPayload(u32, Vec<u8>), // saw ESC inside payload, waiting for \
}
```

**Important**: The parser must pass through all bytes to xterm.js — it only *intercepts* notifications, it doesn't *consume* them. xterm.js also handles OSC sequences for its own purposes (title changes, etc.).

### Handling Partial Sequences Across Read Boundaries
- Parser retains state between reads
- On each read chunk, feed bytes through the state machine
- When a complete OSC 9/99/777 is detected, emit notification event
- All bytes (including OSC sequences) are forwarded to the frontend
- If the PTY closes while in a partial state, discard the incomplete sequence

## 8. Git/Port Scanning

### Non-Blocking Polling
Both git info and port scanning should be polled periodically, not blocking the PTY flow.

**Git polling**:
```rust
// Run in tokio::spawn, poll every 2-5 seconds per workspace
async fn poll_git_info(cwd: PathBuf) -> Option<GitInfo> {
    let output = tokio::process::Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(&cwd)
        .output()
        .await?;
    // parse branch, also check `git status --porcelain` for dirty
    // ...
}
```

**Port scanning**: On Linux, parse `/proc/net/tcp`; on macOS, use `lsof -iTCP -sTCP:LISTEN -nP`; on Windows, use `netstat -ano`. All via async process spawning.

### Caching Strategy
- Cache git info per working directory, invalidate on poll
- For port scanning, diff previous results to avoid re-emitting unchanged ports
- Emit events only on change (not every poll cycle)

### inotify/FSEvents for Git
Instead of polling git, we could watch `.git/HEAD` and `.git/index` for changes:
- Linux: `inotify` (via `notify` crate)
- macOS: `FSEvents` (via `notify` crate)
- Windows: `ReadDirectoryChangesW` (via `notify` crate)

**Recommendation**: Use the `notify` crate for filesystem watching, with polling as a fallback. This gives near-instant git status updates without constant subprocess spawning.

## 9. Tauri Command Design

### Sync vs Async Commands
All PTY commands should be **async** (they involve channel sends and state locks):
```rust
#[tauri::command]
async fn pty_spawn(
    state: tauri::State<'_, AppState>,
    shell: Option<String>,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
) -> Result<PtyId, BackendError> { ... }

#[tauri::command]
async fn pty_write(
    state: tauri::State<'_, AppState>,
    id: PtyId,
    data: String,  // base64 encoded
) -> Result<(), BackendError> { ... }

#[tauri::command]
async fn pty_resize(
    state: tauri::State<'_, AppState>,
    id: PtyId,
    cols: u16,
    rows: u16,
) -> Result<(), BackendError> { ... }
```

### Error Types
```rust
#[derive(Debug, thiserror::Error, Serialize)]
pub enum BackendError {
    #[error("PTY not found: {0}")]
    PtyNotFound(String),
    #[error("PTY spawn failed: {0}")]
    SpawnFailed(String),
    #[error("IO error: {0}")]
    Io(String),
    #[error("Workspace not found: {0}")]
    WorkspaceNotFound(String),
    #[error("Invalid operation: {0}")]
    InvalidOperation(String),
    #[error("Serialization error: {0}")]
    Serialization(String),
}
```

Tauri commands must return `Result<T, E>` where `E: Serialize`. Using `thiserror` for ergonomic error definitions.

### State Injection
Tauri's `State<'_, T>` for dependency injection:
```rust
struct AppState {
    pty_manager: Arc<PtyManager>,
    workspace_state: Arc<RwLock<WorkspaceState>>,
    ipc_server: Arc<IpcServer>,
    notification_store: Arc<RwLock<NotificationStore>>,
}
```

Use `Arc<RwLock<T>>` for shared mutable state. Prefer `tokio::sync::RwLock` for state accessed in async contexts (avoids holding std locks across await points).

## 10. Rust Testing Strategy

### Unit Tests with Mocked PTY
Define a trait for PTY operations:
```rust
#[cfg_attr(test, mockall::automock)]
pub trait PtyBackend: Send + Sync {
    fn spawn(&self, config: PtyConfig) -> Result<PtyHandle, PtyError>;
    fn write(&self, id: &PtyId, data: &[u8]) -> Result<(), PtyError>;
    fn resize(&self, id: &PtyId, size: PtySize) -> Result<(), PtyError>;
    fn kill(&self, id: &PtyId) -> Result<(), PtyError>;
}
```

This allows testing `PtyManager` logic without real PTY processes:
- Test spawn → returns handle
- Test write to nonexistent PTY → error
- Test resize → correct dimensions passed
- Test kill → cleanup happens
- Test concurrent operations → no deadlocks

### Integration Tests
- Spawn a real shell, write `echo hello\n`, assert output contains `hello`
- Test resize actually changes terminal dimensions (check `$COLUMNS`/`$LINES`)
- Test shell exit detection → PTY cleanup
- Test IPC server: connect via socket, send JSON-RPC, verify response

### Cargo Test Infrastructure
```
src-tauri/
  tests/
    pty_integration.rs      # Real PTY tests (may need to be #[ignore] on CI without TTY)
    ipc_integration.rs      # Socket server/client tests
    workspace_state.rs      # State manipulation tests
    persistence.rs          # Save/load roundtrip tests
    osc_parser.rs           # Exhaustive parser tests
```

## 11. TDD for Rust

### Property-Based Testing
Use `proptest` for:
- OSC parser: arbitrary byte sequences should never panic, should always produce valid output
- Base64 roundtrip: encode → decode = identity
- Workspace state: any sequence of create/split/close operations produces a valid tree
- JSON persistence: serialize → deserialize = identity for all state types

### Test Fixtures
```rust
fn test_pty_config() -> PtyConfig {
    PtyConfig {
        shell: "/bin/sh".into(),
        cwd: std::env::temp_dir(),
        env: HashMap::new(),
        size: PtySize { rows: 24, cols: 80 },
    }
}

fn test_workspace() -> Workspace {
    Workspace {
        id: WorkspaceId::new(),
        name: "test".into(),
        surfaces: vec![test_surface()],
        active_surface: 0,
    }
}
```

### Mock Strategies for System Interfaces
| Interface | Mock Strategy |
|-----------|--------------|
| PTY | `MockPtyBackend` via mockall |
| Filesystem | `tempdir` + real fs, or trait-based mock |
| Git commands | Mock `CommandRunner` trait |
| Network (ports) | Mock data parsing, not actual `netstat` |
| Tauri events | `MockEventEmitter` trait |
| Time | `tokio::time::pause()` in tests |

## 12. Cross-Platform Concerns

### Windows-Specific PTY Quirks
1. **ConPTY startup delay**: First write after spawn may not appear immediately — add a small delay or wait for first read
2. **CRLF vs LF**: ConPTY may translate line endings. xterm.js expects raw output — ensure no double translation
3. **Environment variables**: `SHELL` doesn't exist on Windows. Shell detection: `$COMSPEC` → `cmd.exe`, or check for `pwsh.exe`/`powershell.exe` in PATH
4. **Path separators**: Use `std::path::PathBuf` everywhere, never hardcode `/`
5. **Process termination**: On Windows, `Child::kill()` is `TerminateProcess` (harsh). Prefer sending Ctrl+C via PTY write (`\x03`) first, then escalate

### Shell Detection
```rust
fn default_shell() -> String {
    #[cfg(unix)]
    {
        std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into())
    }
    #[cfg(windows)]
    {
        // Prefer pwsh > powershell > cmd
        if which::which("pwsh").is_ok() {
            "pwsh".into()
        } else if which::which("powershell").is_ok() {
            "powershell".into()
        } else {
            std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".into())
        }
    }
}
```

### Path Handling
- All paths stored as `String` in serialized state (not `PathBuf`) for JSON compatibility
- Convert to `PathBuf` at use site
- Use `dirs` crate for platform-appropriate directories (home, app data, runtime)

### Signal Handling
- Unix: SIGCHLD for child process exit, SIGWINCH for resize
- Windows: No SIGCHLD — must poll `Child::try_wait()` or use wait handles
- Abstraction: `PtyBackend` trait hides these differences

## Summary of Key Risks & Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| ConPTY escape sequence bugs | Medium | Test with vim/htop/tmux on Windows early |
| Dual state (Rust + Zustand) desync | High | Rust as single source of truth for structural state |
| PTY output flooding | Medium | Ring buffer + 60fps frame batching |
| Crash data loss | Medium | Atomic writes + periodic saves + crash recovery |
| OSC parser correctness | Medium | Property-based testing with arbitrary bytes |
| IPC socket name collision | Low | PID/session-based naming + discovery file |
| Orphaned child processes | Medium | Process groups (Unix) + Job Objects (Windows) |
| Blocking async runtime | High | Dedicated threads for PTY I/O, never block tokio |
