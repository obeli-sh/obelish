# Phase 1: Project Scaffold + Core Terminal

## Objectives & Scope

Phase 1 delivers two things:

1. **Project infrastructure** (first PR): A fully operational development environment with CI, test frameworks, mocks, coverage enforcement, and pre-commit hooks. No feature code.
2. **A working terminal** (subsequent PRs): A Tauri v2 app window with a single xterm.js terminal connected to the user's default shell via a Rust PTY backend, with bidirectional data flow, resize support, and throughput benchmarks.

At the end of Phase 1, running `bun tauri dev` launches a window where the user can type commands and see output. Nothing more — no workspaces, no split panes, no persistence. Just a rock-solid terminal.

---

## User Stories

1. **As a developer**, I can clone the repo, run `bun install && bun tauri dev`, and see an app window with a terminal prompt within 60 seconds.
2. **As a developer**, I can type commands in the terminal and see output rendered correctly, including colors and cursor movement.
3. **As a developer**, I can resize the app window and the terminal adapts its column/row count automatically.
4. **As a developer**, I can run TUI programs (vim, htop, less) and they render correctly.
5. **As a contributor**, I can run `just test` and all tests pass. I can run `just lint` and see no warnings. CI enforces this on every PR.

---

## Technical Implementation

### PR #1: Infrastructure (No Feature Code)

#### 1.1 Project Scaffold
- Run `bun create tauri-app` with react-ts template
- Set up Cargo workspace in root `Cargo.toml`:
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
- Create `cli/` crate as placeholder (empty `lib.rs`)
- Configure `justfile` with targets: `dev`, `test`, `lint`, `coverage`, `build`

#### 1.2 Rust Test Infrastructure
- Add dev-dependencies: `mockall`, `proptest`, `tempfile`, `test-log`, `tokio` (test-util), `assert_matches`, `criterion`
- Create `src-tauri/fixtures/` directory with subdirectories: `pty/`, `osc/`, `workspace/`
- Add placeholder fixture files
- Configure `tracing-subscriber` in test setup via `test-log`

#### 1.3 Frontend Test Infrastructure
- Configure Vitest with jsdom environment
- Install `@testing-library/react`, `@testing-library/user-event`, `@vitest/coverage-v8`
- Create `src/__mocks__/@tauri-apps/api/core.ts`:
  ```typescript
  const invokeHandlers = new Map<string, (...args: any[]) => any>();
  export const invoke = vi.fn((cmd: string, args?: any) => {
    const handler = invokeHandlers.get(cmd);
    if (handler) return handler(args);
    throw new Error(`No mock handler for command: ${cmd}`);
  });
  export function mockInvoke(cmd: string, handler: (...args: any[]) => any) {
    invokeHandlers.set(cmd, handler);
  }
  export function clearInvokeMocks() { invokeHandlers.clear(); invoke.mockClear(); }
  ```
- Create `src/__mocks__/@tauri-apps/api/event.ts` with `listen`, `emitMockEvent`, `clearEventMocks`
- Create `src/__mocks__/@xterm/xterm.ts` with mock Terminal class
- Configure Vitest coverage thresholds: `{ lines: 95, branches: 90, functions: 95 }`

#### 1.4 CI Pipeline (GitHub Actions)
- `rust-lint`: `cargo fmt --check` + `cargo clippy --workspace -- -D warnings` + `cargo audit`
- `rust-test-linux`: `cargo test --workspace` + `cargo llvm-cov --workspace --fail-under 95`
- `rust-test-macos`: `cargo test --workspace`
- `frontend-check`: `bun install` + `bun run typecheck` + `bun run lint` + `bun test --coverage`
- `build`: `bun tauri build` on Linux + macOS
- Nightly job: Windows `cargo test --workspace` + E2E on all 3 OSes

#### 1.5 Pre-commit Hooks
- `cargo test --lib` (fast unit tests only)
- `bun test --changed` (only tests affected by changed files)
- `cargo fmt --check`
- Installed via git hooks, documented in CONTRIBUTING.md

#### 1.6 Type Generation Setup
- Evaluate `ts-rs` vs `specta` for Rust-to-TypeScript type generation
- Configure chosen tool to emit types to `src/lib/generated/types.ts`
- Add type generation step to `just build` and CI

---

### PR #2: PTY Backend (Rust)

#### 2.1 Error Types
- Define `PtyError` enum with `thiserror`:
  - `NotFound { id: String }`
  - `SpawnFailed(#[source] std::io::Error)`
  - `WriteFailed(#[source] std::io::Error)`
  - `ResizeFailed(String)`
  - `AlreadyTerminated { id: String }`
- Define `BackendError` top-level enum with `#[from]` conversions
- Implement `Serialize` on `BackendError` producing `{ kind, message }` JSON

#### 2.2 PtyBackend Trait
```rust
pub trait PtyBackend: Send + Sync {
    fn spawn(&self, config: &PtyConfig) -> Result<PtyHandle, PtyError>;
    fn write(&self, handle: &PtyHandle, data: &[u8]) -> Result<usize, PtyError>;
    fn resize(&self, handle: &PtyHandle, size: PtySize) -> Result<(), PtyError>;
    fn kill(&self, handle: &PtyHandle) -> Result<(), PtyError>;
    fn try_clone_reader(&self, handle: &PtyHandle) -> Result<Box<dyn Read + Send>, PtyError>;
}
```

#### 2.3 RealPtyBackend
- Implements `PtyBackend` using `portable-pty`
- Cross-platform shell detection:
  - Unix: `$SHELL` or `/bin/sh`
  - Windows: `pwsh` > `powershell` > `$COMSPEC` > `cmd.exe`
- Process groups (Unix: `setsid`) and Job Objects (Windows) on spawn
- `TERM=xterm-256color` environment variable set on spawn

#### 2.4 PtyManager
- Holds `Arc<dyn PtyBackend>` and `HashMap<String, PtySession>`
- `spawn()`: Creates PTY via backend, starts read thread, returns PTY ID
- `write()`: Looks up PTY by ID, writes data
- `resize()`: Looks up PTY by ID, resizes
- `kill()`: Graceful shutdown (SIGHUP/Ctrl+C first, escalate after 2s), joins read thread, removes from map
- Thread-safe via `Arc<RwLock<HashMap<...>>>`

#### 2.5 PTY Read Thread
- Dedicated `std::thread` per PTY (not tokio blocking pool)
- Simple read loop for Phase 1:
  ```rust
  fn pty_read_loop(reader: Box<dyn Read>, pty_id: String, emitter: Arc<dyn EventEmitter>) {
      let mut buf = [0u8; 4096];
      loop {
          match reader.read(&mut buf) {
              Ok(0) => break,
              Ok(n) => {
                  let data = base64::engine::general_purpose::STANDARD.encode(&buf[..n]);
                  let _ = emitter.emit(&format!("pty-data-{}", pty_id), PtyDataPayload { data });
              }
              Err(_) => break,
          }
      }
      let _ = emitter.emit(&format!("pty-exit-{}", pty_id), PtyExitPayload { exit_code: None, signal: None });
  }
  ```
- EventEmitter trait for testability (production: TauriEventEmitter, tests: MockEventEmitter)

#### 2.6 Tauri Commands
```rust
#[tauri::command]
#[tracing::instrument(skip(state, app))]
async fn pty_spawn(state: State<'_, AppState>, app: AppHandle, shell: Option<String>, cwd: Option<String>, env: Option<HashMap<String, String>>) -> Result<PtySpawnResult, BackendError>

#[tauri::command]
async fn pty_write(state: State<'_, AppState>, pty_id: String, data: String) -> Result<(), BackendError>

#[tauri::command]
async fn pty_resize(state: State<'_, AppState>, pty_id: String, cols: u16, rows: u16) -> Result<(), BackendError>

#[tauri::command]
async fn pty_kill(state: State<'_, AppState>, pty_id: String) -> Result<(), BackendError>
```

---

### PR #3: Terminal Frontend (React)

#### 3.1 Tauri Bridge
- `src/lib/tauri-bridge.ts`: Typed wrappers for all PTY commands
  ```typescript
  export const tauriBridge = {
    pty: {
      spawn: (args: PtySpawnArgs) => invoke<PtySpawnResult>('pty_spawn', args),
      write: (ptyId: string, data: string) => invoke<void>('pty_write', { ptyId, data }),
      resize: (ptyId: string, cols: number, rows: number) => invoke<void>('pty_resize', { ptyId, cols, rows }),
      kill: (ptyId: string) => invoke<void>('pty_kill', { ptyId }),
    },
  } as const;
  ```

#### 3.2 useTerminal Hook
- Creates xterm.js `Terminal` instance
- Manages lifecycle: open on DOM attach, dispose on component removal
- Loads FitAddon + WebGL addon (with canvas fallback)
- Subscribes to `pty-data-{ptyId}` Tauri event, writes decoded base64 directly to xterm.js (no React state)
- Sends keystrokes via `terminal.onData` -> `tauriBridge.pty.write()`
- Handles resize: `ResizeObserver` -> `FitAddon.fit()` -> `tauriBridge.pty.resize()`
- Cleans up all event listeners and disposes terminal on unmount

#### 3.3 TerminalPane Component
```typescript
interface TerminalPaneProps {
  paneId: string;
  ptyId: string;
  isActive: boolean;
  onReady?: () => void;
}
```
- Renders a `div` container and passes `ref` to `useTerminal`
- Focuses terminal when `isActive` changes

#### 3.4 App Shell
- Minimal `App.tsx` that spawns one PTY on mount and renders a single `TerminalPane`
- Error boundary at the app level
- Dark theme CSS variables in `styles/index.css`
- Custom scrollbar styling for cross-platform consistency

---

### PR #4: Throughput Benchmark

#### 4.1 Rust Benchmarks (criterion)
- `bench_base64_encode`: Encode 16KB chunks. Target: >50 MB/s throughput.
- `bench_event_serialization`: Serialize `PtyDataPayload` with 16KB base64. Target: <10us per event.
- `bench_osc_parser_placeholder`: Placeholder for Phase 4.

#### 4.2 Frontend Benchmark
- Manual benchmark script: generate large base64 payload, measure `atob()` + `terminal.write()` latency
- Document baseline numbers in the PR

---

## TDD Approach

Every line of production code is driven by a failing test. The git history for each PR follows:

```
test: add PtyManager spawn success test
feat: implement PtyManager::spawn
test: add PtyManager spawn with invalid shell test
feat: handle spawn error path
test: add PtyManager write test
feat: implement PtyManager::write
... (repeat for each method/behavior)
```

### TDD Sequence for PR #2 (PTY Backend)

1. Write `PtyBackend` trait definition (no test needed — it is an interface)
2. **Test**: `spawn_returns_valid_pty_id` using MockPtyBackend -> **Implement** `PtyManager::spawn`
3. **Test**: `spawn_with_invalid_shell_returns_error` -> **Implement** error path
4. **Test**: `spawn_starts_read_thread` -> **Implement** read thread spawning
5. **Test**: `spawn_sets_process_group` -> **Implement** process group config
6. **Test**: `write_to_valid_pty_succeeds` -> **Implement** `PtyManager::write`
7. **Test**: `write_to_nonexistent_pty_returns_not_found` -> **Implement** error path
8. **Test**: `write_to_terminated_pty_returns_error` -> **Implement** error path
9. **Test**: `resize_valid_pty` -> **Implement** `PtyManager::resize`
10. **Test**: `resize_nonexistent_returns_error` -> **Implement** error path
11. **Test**: `kill_valid_pty_cleans_up` -> **Implement** `PtyManager::kill`
12. **Test**: `kill_nonexistent_returns_error` -> **Implement** error path
13. **Test**: `kill_already_terminated_returns_error` -> **Implement** error path
14. **Test**: `kill_stops_read_thread` -> **Implement** thread join
15. **Test**: `concurrent_writes_to_same_pty` -> **Implement** locking
16. **Test**: `spawn_multiple_ptys_simultaneously` -> **Implement** concurrent spawn

### TDD Sequence for PR #3 (Terminal Frontend)

1. **Test**: `tauriBridge.pty.spawn calls invoke correctly` -> **Implement** bridge function
2. **Test**: `tauriBridge.pty.write sends base64 data` -> **Implement** bridge function
3. **Test**: `tauriBridge.pty.resize sends cols and rows` -> **Implement** bridge function
4. **Test**: `tauriBridge.pty.kill calls invoke correctly` -> **Implement** bridge function
5. **Test**: `useTerminal creates Terminal instance on mount` -> **Implement** hook creation
6. **Test**: `useTerminal subscribes to pty-data event` -> **Implement** event subscription
7. **Test**: `useTerminal writes decoded data to terminal` -> **Implement** data handler
8. **Test**: `useTerminal sends keystrokes via pty_write` -> **Implement** onData handler
9. **Test**: `useTerminal calls pty_resize on terminal resize` -> **Implement** resize
10. **Test**: `useTerminal disposes terminal on unmount` -> **Implement** cleanup
11. **Test**: `useTerminal unlistens from events on unmount` -> **Implement** cleanup
12. **Test**: `useTerminal falls back to canvas when WebGL fails` -> **Implement** fallback
13. **Test**: `TerminalPane renders container div` -> **Implement** component
14. **Test**: `TerminalPane focuses terminal when isActive` -> **Implement** focus logic

---

## Unit Tests

### Rust Unit Tests (in `#[cfg(test)]` modules)

| Module | Test | Description |
|--------|------|-------------|
| `pty/manager.rs` | `spawn_returns_pty_id` | Mock backend returns handle, manager returns ID |
| | `spawn_with_custom_shell` | Custom shell passed to backend |
| | `spawn_with_custom_cwd` | Custom working directory passed to backend |
| | `spawn_with_invalid_shell_returns_error` | Backend returns SpawnFailed, manager propagates |
| | `spawn_starts_read_thread` | Verify read thread is spawned (mock emitter receives events) |
| | `spawn_sets_process_group` | Verify process group config passed to backend |
| | `write_to_valid_pty` | Data written to correct PTY handle |
| | `write_to_nonexistent_pty_returns_not_found` | Error on unknown ID |
| | `write_to_terminated_pty_returns_error` | Error on killed PTY |
| | `write_base64_decodes_before_write` | Verify base64 decoding |
| | `resize_valid_pty` | Correct dimensions passed to backend |
| | `resize_nonexistent_returns_error` | Error on unknown ID |
| | `resize_zero_dimensions_returns_error` | Validation check |
| | `kill_valid_pty_cleans_up` | PTY removed from map, thread joined |
| | `kill_nonexistent_returns_error` | Error on unknown ID |
| | `kill_already_terminated_returns_error` | Error on double kill |
| | `kill_stops_read_thread` | Read thread exits cleanly |
| | `concurrent_writes_to_same_pty` | No deadlocks under concurrent writes |
| | `spawn_multiple_ptys_simultaneously` | Multiple PTYs coexist |
| `pty/backend.rs` | `default_shell_unix` | Returns `$SHELL` or `/bin/sh` |
| | `default_shell_windows` | Returns `pwsh` > `powershell` > `$COMSPEC` |
| `error.rs` | `backend_error_serializes_kind_and_message` | Verify JSON output shape |
| | `pty_error_converts_to_backend_error` | #[from] conversion works |

**Target: 100% line coverage on `pty/` module.**

### Frontend Unit Tests (Vitest)

| File | Test | Description |
|------|------|-------------|
| `tauri-bridge.test.ts` | `pty.spawn calls invoke with correct args` | Verify command name and arg shape |
| | `pty.write sends ptyId and base64 data` | Verify args |
| | `pty.resize sends ptyId, cols, rows` | Verify args |
| | `pty.kill sends ptyId` | Verify args |
| | `pty.spawn propagates errors` | Verify error handling |
| `useTerminal.test.ts` | `creates Terminal instance on mount` | Mock Terminal constructor called |
| | `opens terminal on DOM element` | `terminal.open()` called with element |
| | `subscribes to pty-data event` | `listen('pty-data-{ptyId}')` called |
| | `writes decoded base64 data to terminal` | `terminal.write()` receives decoded data |
| | `sends keystrokes via pty_write` | `invoke('pty_write')` called on onData |
| | `resizes terminal and sends pty_resize` | FitAddon.fit + invoke called |
| | `disposes terminal on unmount` | `terminal.dispose()` called |
| | `cleans up event listeners on unmount` | `unlisten()` called |
| | `falls back to canvas when WebGL fails` | Canvas addon loaded on WebGL error |
| | `does not trigger React re-renders on PTY data` | No useState updates in data path |
| `TerminalPane.test.tsx` | `renders terminal container` | Container div present in DOM |
| | `passes ref to useTerminal` | Terminal opens in container |
| | `focuses terminal when isActive changes` | `terminal.focus()` called |
| | `calls onReady when terminal initializes` | Callback invoked |

**Target: 100% on tauri-bridge and useTerminal. 95%+ on TerminalPane.**

---

## Integration Tests

### Rust Integration Tests (`src-tauri/tests/`)

| Test | Description | Platforms |
|------|-------------|-----------|
| `spawn_real_shell_and_read_prompt` | Spawn default shell, poll for prompt characters in output | All 3 |
| `write_echo_read_output` | Write `echo hello\n`, poll for "hello" in output | All 3 |
| `rapid_sequential_writes` | Write 100 `echo N\n` commands, verify all 100 outputs appear | All 3 |
| `large_output_cat_head` | Run `cat /dev/urandom | head -c 100K` (or equivalent), verify byte count | Linux, macOS |
| `resize_changes_columns` | Resize PTY, run `tput cols`, verify output matches new cols | All 3 |
| `kill_during_running_process` | Start `sleep 60`, kill PTY, verify clean shutdown within 5s | All 3 |
| `shell_exit_triggers_cleanup` | Run `exit`, verify PTY exit event and cleanup | All 3 |
| `concurrent_ptys_independent` | Spawn 10 PTYs, write unique data to each, verify no cross-contamination | All 3 |

All PTY integration tests use polling with `tokio::time::timeout(Duration::from_secs(5), ...)` — never `sleep`.

---

## E2E Tests

### Playwright + tauri-driver

| Test | Description |
|------|-------------|
| `app_launches_with_terminal` | App window appears, terminal container is visible |
| `terminal_shows_prompt` | After launch, shell prompt text appears within 5s |
| `typing_produces_output` | Type `echo obelisk-test`, press Enter, verify "obelisk-test" appears in output |

E2E tests run on Linux for every PR, on all 3 OSes on merge to main.

---

## Acceptance Criteria

1. `bun tauri dev` launches an app window with a terminal on macOS, Linux, and Windows
2. Typing in the terminal sends keystrokes to the shell and output appears
3. ANSI colors render correctly (test with `ls --color` or `echo -e '\033[31mred\033[0m'`)
4. Resizing the window updates the terminal column/row count
5. TUI programs (vim, less) work correctly on macOS and Linux
6. `just test` passes all unit, integration, and E2E tests
7. CI is green on Linux and macOS. Windows nightly passes.
8. Rust coverage >= 95% overall, 100% on `pty/` module
9. Frontend coverage >= 95% overall, 100% on stores/hooks/bridge
10. PTY throughput benchmark baseline established: >50 MB/s or justification if lower
11. No orphaned shell processes after PTY kill or app close

---

## Risks & Mitigations

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| `portable-pty` ConPTY issues on Windows | High | Medium | Windows nightly CI, platform-specific integration tests, `PtyBackend` trait as swap layer |
| xterm.js WebGL fails on some systems | Medium | Medium | Canvas fallback implemented in Phase 1, tested explicitly |
| Base64 encoding too slow for large output | Medium | Low | Benchmark in Phase 1 measures actual throughput. Ring buffer + batching design from backend is ready to deploy if needed. |
| Tauri v2 event system throughput limit | Medium | Low | Benchmark measures end-to-end pipeline. If Tauri events are the bottleneck, investigate binary event channels. |
| Test infrastructure takes longer than expected | Low | Medium | PR #1 is infrastructure-only, no feature code dependency. Team can review in parallel. |
| Cross-platform CI flakiness | Medium | Medium | macOS runner issues are common. Nightly run catches Windows issues. 1 retry for E2E only. |

---

## Dependencies

- None. Phase 1 is the foundation. All subsequent phases depend on Phase 1.
- External dependencies: `portable-pty` ^0.8, `tauri` ^2, `xterm.js` ^5.5, `react` ^19, `zustand` ^5
- All dependency versions pinned in `Cargo.lock` and `bun.lockb`, committed to git.
