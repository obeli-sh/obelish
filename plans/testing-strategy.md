# Obelisk — Comprehensive Testing Strategy

This document is the authoritative testing strategy for Obelisk, derived from three rounds of team debate. It governs all testing decisions across all 8 implementation phases.

---

## 1. Testing Philosophy

**TDD-first. 100% coverage on core modules. No shortcuts.**

Every line of production code in Obelisk is driven by a failing test written first. The CLAUDE.md mandates: "We should always do changes strongly tested using automated tests. Always use TDD to ANY change."

This means:
- No PR merges without associated tests
- No feature branches without test-first commits (red-green-refactor visible in git history)
- CI blocks merge if coverage drops below threshold
- Test infrastructure must be operational before any feature code

---

## 2. Test Infrastructure

### 2.1 Rust Test Stack

| Tool | Purpose | Phase |
|------|---------|-------|
| `cargo test` | Built-in test runner | 1 |
| `tokio::test` | Async test runtime | 1 |
| `cargo-llvm-cov` | Coverage measurement (LLVM-based) | 1 |
| `mockall` | Trait-based mocking | 1 |
| `proptest` | Property-based testing | 1 |
| `tempfile` | Temporary directories for persistence tests | 1 |
| `test-log` | Capture log output in tests | 1 |
| `criterion` | Benchmarks | 1 |
| `assert_cmd` + `predicates` | CLI binary integration testing | 7 |

### 2.2 Frontend Test Stack

| Tool | Purpose | Phase |
|------|---------|-------|
| Vitest | Test runner (Vite-native) | 1 |
| `@testing-library/react` | Component rendering + queries | 1 |
| `@testing-library/user-event` | User interaction simulation | 1 |
| `jsdom` | Browser environment for unit tests | 1 |
| `@vitest/coverage-v8` | Coverage measurement | 1 |
| Playwright | E2E browser automation + visual regression | 1 |

### 2.3 E2E Test Stack

| Tool | Purpose | Phase |
|------|---------|-------|
| Playwright | Cross-platform E2E test runner | 1 |
| `tauri-driver` | WebDriver bridge for Tauri apps | 1 |
| GitHub Actions matrix | Windows + macOS + Linux runners | 1 |

### 2.4 CI Pipeline

```yaml
# PR checks (blocking):
- rust-lint:       cargo fmt --check && cargo clippy -- -D warnings
- rust-test:       cargo test --workspace (Linux + macOS)
- rust-coverage:   cargo llvm-cov --workspace --fail-under 95 (Linux)
- frontend-lint:   bun run lint && bun run typecheck
- frontend-test:   bun test --coverage (thresholds enforced)
- e2e-linux:       playwright + tauri-driver (Linux)

# Non-blocking on PR:
- e2e-macos:       playwright + tauri-driver (macOS, informational)

# Triggered for PTY/IPC/persistence changes:
- rust-test-win:   cargo test --workspace (Windows)

# Merge to main (blocking):
- All PR checks + e2e on all 3 OSes

# Nightly:
- Full Windows test suite + coverage
- Performance benchmarks (criterion, compare to baseline)
- Dependency audit (cargo audit + bun audit)
- Long-running memory monitoring
```

### 2.5 Mock Infrastructure (Phase 1 First PR)

**Tauri API Mock:**
```typescript
// src/__mocks__/@tauri-apps/api/core.ts
const invokeHandlers = new Map<string, (...args: any[]) => any>();

export const invoke = vi.fn((cmd: string, args?: any) => {
  const handler = invokeHandlers.get(cmd);
  if (handler) return handler(args);
  throw new Error(`No mock handler for command: ${cmd}`);
});

export function mockInvoke(cmd: string, handler: (...args: any[]) => any) {
  invokeHandlers.set(cmd, handler);
}

export function clearInvokeMocks() {
  invokeHandlers.clear();
  invoke.mockClear();
}
```

```typescript
// src/__mocks__/@tauri-apps/api/event.ts
type EventHandler = (event: { payload: any }) => void;
const eventHandlers = new Map<string, EventHandler[]>();

export const listen = vi.fn((event: string, handler: EventHandler) => {
  const handlers = eventHandlers.get(event) || [];
  handlers.push(handler);
  eventHandlers.set(event, handlers);
  const unlisten = vi.fn(() => {
    const idx = handlers.indexOf(handler);
    if (idx >= 0) handlers.splice(idx, 1);
  });
  return Promise.resolve(unlisten);
});

export function emitMockEvent(event: string, payload: any) {
  const handlers = eventHandlers.get(event) || [];
  handlers.forEach(h => h({ payload }));
}
```

**xterm.js Mock:**
```typescript
// src/__mocks__/@xterm/xterm.ts
export class Terminal {
  options: any;
  onData = vi.fn(() => ({ dispose: vi.fn() }));
  onResize = vi.fn(() => ({ dispose: vi.fn() }));
  onTitleChange = vi.fn(() => ({ dispose: vi.fn() }));
  open = vi.fn();
  write = vi.fn((_data: any, callback?: () => void) => callback?.());
  dispose = vi.fn();
  loadAddon = vi.fn();
  focus = vi.fn();
  clear = vi.fn();
  reset = vi.fn();
  constructor(options?: any) { this.options = options; }
}
```

**Rust Test Utilities:**
```rust
// src-tauri/src/test_utils.rs
#[cfg(test)]
pub mod fixtures {
    use std::path::PathBuf;
    use tempfile::TempDir;

    pub fn fixture_path(name: &str) -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("fixtures")
            .join(name)
    }

    pub fn temp_workspace_dir() -> TempDir {
        tempfile::tempdir().expect("Failed to create temp dir")
    }

    pub fn osc9_notification(body: &str) -> Vec<u8> {
        format!("\x1b]9;{}\x07", body).into_bytes()
    }
}
```

---

## 3. Testing Pyramid

### Target Ratio: 70% Unit / 20% Integration / 10% E2E

| Layer | Rust | Frontend |
|-------|------|----------|
| **Unit (70%)** | `#[cfg(test)]` inline modules. Every function, every error path. `mockall` for trait mocking, `proptest` for property-based. | Vitest + Testing Library. Every store action, every hook lifecycle, every component behavior. |
| **Integration (20%)** | `tests/` directory. Real PTY lifecycle, cross-module interactions, IPC server end-to-end. | Component trees with real Zustand stores, mocked Tauri API. Cross-store interaction tests. |
| **E2E (10%)** | — | Playwright + `tauri-driver`. Full app launch, critical user journeys. |

---

## 4. Per-Phase Test Plans

### Phase 1: Project Scaffold + Core Terminal

**Infrastructure (First PR):**
- CI pipeline operational with all jobs defined
- Coverage enforcement active (95% gate, even if 0% because no code yet)
- All mock files compile and are importable
- Pre-commit hooks run without error
- `justfile` with `dev`, `test`, `lint`, `coverage` targets

**Unit Tests:**

| Module | Test Cases | Coverage Target |
|--------|-----------|-----------------|
| `PtyManager::spawn` | Valid shell, invalid shell, custom cwd, custom env, spawn limit | 100% |
| `PtyManager::write` | Valid write, invalid ID, write after kill, base64 encoding | 100% |
| `PtyManager::read` | Receives output, handles binary data, base64 correctness | 100% |
| `PtyManager::resize` | Valid resize, invalid dimensions, resize after kill | 100% |
| `PtyManager::kill` | Clean kill, double kill, kill during read | 100% |
| `PtyBackend` trait | Mock backend responds correctly for all operations | 100% |
| `TerminalPane` | Renders container, mounts/unmounts xterm, subscribes to events, disposes on unmount | 95%+ |
| `useTerminal` | Creates Terminal, subscribes to pty-data, writes decoded data, handles resize, cleans up | 100% |
| `tauri-bridge` (PTY commands) | Each command calls invoke with correct name and args | 100% |

**Integration Tests:**

| Test | Description |
|------|-------------|
| `test_pty_full_lifecycle` | Spawn shell, write command, read output, resize, kill |
| `test_pty_spawn_and_read_prompt` | Spawn shell, verify prompt appears within timeout |
| `test_pty_write_echo_read` | Write `echo hello\n`, verify output contains `hello` |
| `test_pty_rapid_writes` | Write 100 commands in quick succession, verify all output |
| `test_pty_large_output` | Run `cat /dev/urandom | head -c 1M`, verify all bytes received |
| `test_pty_resize_updates_columns` | Resize, run `tput cols`, verify output matches |
| `test_pty_kill_during_read` | Start long process, kill PTY, verify clean shutdown |
| `test_pty_shell_exit` | Run `exit`, verify EOF detection and cleanup |
| `test_pty_concurrent` | Spawn 10 PTYs, verify independence |

**E2E Tests:**

| Test | Description |
|------|-------------|
| `test_app_launches` | `bun tauri dev` starts, window appears |
| `test_terminal_renders` | Terminal pane visible, cursor blinking |
| `test_terminal_input_output` | Type command, verify output appears |

**Benchmarks:**

| Benchmark | Target |
|-----------|--------|
| PTY read + base64 encode (10MB) | < 200ms |
| Event serialization (16KB payload) | < 10us |

### Phase 2: Workspaces + Split Layout + Keybindings

**Unit Tests:**

| Module | Test Cases | Coverage Target |
|--------|-----------|-----------------|
| `workspaceStore` | Start empty, sync workspace, remove workspace, set active, selectors | 100% |
| `uiStore` | Focus tracking, sidebar toggle, notification panel toggle | 100% |
| Rust `workspace/state.rs` | Create workspace, add surface, add pane, split layout, close pane, layout tree validation | 100% |
| `Sidebar` | Renders list, highlights active, click selects, create button, close button | 95%+ |
| `SurfaceTabBar` | Renders tabs, active tab highlight, create/switch/close | 95%+ |
| `PaneSplitter` | Single pane, horizontal split, vertical split, nested splits, correct panel count | 95%+ |
| `PaneWrapper` | Renders TerminalPane for terminal type, renders BrowserPane for browser type | 95%+ |
| `PaneErrorBoundary` | Renders children, catches errors, shows recovery UI, restart/close callbacks | 95%+ |
| `useKeyboardShortcuts` | Registers handlers, fires correct action, cleans up on unmount | 100% |

**Integration Tests:**

| Test | Description |
|------|-------------|
| Cross-store: workspace create | Creating workspace updates workspaceStore and triggers Rust event |
| Cross-store: pane close | Closing pane updates workspace layout and focus store |
| Cross-store: workspace switch | Switching workspace updates both stores correctly |
| Keyboard shortcuts | All shortcuts trigger correct Tauri bridge calls |
| `workspace-changed` event handler | Event updates store correctly for all changeType values |

**E2E Tests:**

| Test | Description |
|------|-------------|
| `test_create_workspace` | Click new workspace, verify it appears in sidebar |
| `test_split_pane_horizontal` | Keyboard shortcut splits pane, two terminals visible |
| `test_split_pane_vertical` | Keyboard shortcut splits vertically |
| `test_close_pane` | Close one pane, remaining pane fills space |
| `test_keyboard_navigation` | Navigate between panes with arrow keys |
| `test_workspace_switch` | Switch workspaces via Ctrl+1/2/3 |

### Phase 3a: Layout Persistence

**Unit Tests:**

| Module | Test Cases | Coverage Target |
|--------|-----------|-----------------|
| `persistence.rs` | Serialize workspace, deserialize workspace, round-trip identity, corrupted JSON handling, missing file handling, atomic write mechanics | 100% |
| `PersistenceBackend` trait | Mock backend save/load operations | 100% |

**Integration Tests:**

| Test | Description |
|------|-------------|
| `test_save_restore_roundtrip` | Create workspace with splits, save, load, verify identical layout |
| `test_corrupted_file_recovery` | Write garbage to session file, verify app starts with default state |
| `test_atomic_write_no_partial` | Kill process during save, verify session file is not corrupted |
| `test_autosave_trigger` | Verify autosave fires every 30 seconds |
| `test_crash_recovery` | Simulate unclean shutdown, verify last autosave is restored |

**E2E Tests:**

| Test | Description |
|------|-------------|
| `test_close_reopen_layout_restored` | Create layout, close app, reopen, verify layout matches |
| `test_crash_recovery_e2e` | Force-kill app, reopen, verify last autosave restored |

### Phase 3b: Metadata + Scrollback

**Unit Tests:**

| Module | Test Cases | Coverage Target |
|--------|-----------|-----------------|
| `git/mod.rs` | Branch detection, dirty status, PR number extraction, no-git-repo handling | 100% |
| `ports/mod.rs` | Port detection on each platform, empty ports, refresh cycle | 100% |
| `useGitInfo` hook | Subscribes to git-info event, updates state, cleans up | 100% |
| `usePortScanner` hook | Subscribes to ports-changed event, updates state, cleans up | 100% |

**Integration Tests:**

| Test | Description |
|------|-------------|
| `test_git_info_in_git_repo` | Run in git repo, verify branch detected |
| `test_git_info_outside_repo` | Run outside git repo, verify graceful handling |
| `test_scrollback_serialize_restore` | Fill terminal, serialize, restore, verify content matches |

### Phase 4: Notifications

**Unit Tests:**

| Module | Test Cases | Coverage Target |
|--------|-----------|-----------------|
| `osc_parser.rs` | OSC 9, OSC 99, OSC 777, unknown OSC ignored, partial sequences across read boundaries, interleaved data+OSC, malformed sequences, empty payload | 100% |
| `notificationStore` | Add notification, mark read, clear, badge count, per-pane filtering | 100% |
| `NotificationPanel` | Renders notifications, mark read, clear all | 95%+ |
| `NotificationBadge` | Shows count, hides when zero | 95%+ |

**Property-Based Tests (proptest):**

```rust
proptest! {
    #[test]
    fn never_panics(data in prop::collection::vec(any::<u8>(), 0..10000)) {
        let mut parser = OscParser::new();
        parser.feed(&data); // must not panic
    }

    #[test]
    fn forwards_all_bytes(data in prop::collection::vec(any::<u8>(), 0..10000)) {
        let mut parser = OscParser::new();
        let (forwarded, _) = parser.feed(&data);
        assert_eq!(forwarded.len(), data.len());
    }

    #[test]
    fn extracts_osc9(payload in "[a-zA-Z0-9 ]{1,100}") {
        let mut parser = OscParser::new();
        let input = format!("\x1b]9;{}\x07", payload);
        let (_, notifications) = parser.feed(input.as_bytes());
        assert_eq!(notifications.len(), 1);
        assert_eq!(notifications[0].body, payload);
    }
}
```

**Integration Tests:**

| Test | Description |
|------|-------------|
| `test_pty_osc_notification_detected` | Write OSC 9 sequence to PTY, verify notification event emitted |
| `test_notification_ui_updates` | Receive notification event, verify badge count and panel content |

**E2E Tests:**

| Test | Description |
|------|-------------|
| `test_osc_notification_e2e` | Run `printf '\e]9;Hello\a'` in terminal, verify blue ring + badge + panel |
| `test_os_notification` | Verify tauri-plugin-notification is called (mock the system notification) |

### Phase 5: Browser Panels

**Unit Tests:**

| Module | Test Cases | Coverage Target |
|--------|-----------|-----------------|
| `BrowserPane` | Renders iframe with correct src, toolbar state | 90%+ |
| `BrowserToolbar` | URL input, back/forward/refresh buttons, navigation callback | 90%+ |
| `useBrowser` hook | URL state management, navigation history | 100% |

**Integration Tests:**

| Test | Description |
|------|-------------|
| `test_browser_navigation` | Navigate to URL, verify iframe src updates |
| `test_browser_toolbar_sync` | Navigate, verify toolbar URL matches |

**E2E Tests:**

| Test | Description |
|------|-------------|
| `test_browser_pane_renders` | Split pane, open browser, verify iframe visible |
| `test_browser_local_url` | Navigate to localhost URL, verify page loads |

### Phase 6: Command Palette + Keyboard Shortcuts

**Unit Tests:**

| Module | Test Cases | Coverage Target |
|--------|-----------|-----------------|
| `CommandPalette` | Renders, filters commands by query, executes selected, closes on Escape | 95%+ |
| `useCommands` | Registers commands, fuzzy search ranking, conflict detection | 100% |
| `SettingsModal` | Renders settings, keybinding editor, save/cancel | 95%+ |
| `KeybindingEditor` | Captures keypress, validates no conflict, saves | 95%+ |

**E2E Tests:**

| Test | Description |
|------|-------------|
| `test_command_palette_opens` | Ctrl+Shift+P opens palette |
| `test_command_palette_search` | Type query, verify filtered results |
| `test_command_palette_execute` | Select command, verify action executes |

### Phase 7: CLI + IPC

**Unit Tests:**

| Module | Test Cases | Coverage Target |
|--------|-----------|-----------------|
| `ipc_server/protocol.rs` | Serialize/deserialize all JSON-RPC message types, malformed input handling | 100% |
| `ipc_server/handlers.rs` | Dispatch each method, return correct response, error for unknown method | 100% |
| `ipc_server/mod.rs` | Bind socket/pipe, accept connection, handle disconnect | 100% |
| CLI `client.rs` | Connect to socket, send request, receive response, handle timeout | 100% |
| CLI `main.rs` | Each subcommand generates correct IPC message | 100% |

**Integration Tests:**

| Test | Description |
|------|-------------|
| `test_ipc_full_cycle` | Start server, connect client, send request, receive response |
| `test_ipc_concurrent_clients` | 10 clients simultaneously, all receive correct responses |
| `test_ipc_malformed_request` | Send garbage, verify error response (not crash) |
| `test_cli_workspace_create` | Run `obelisk new --name test`, verify workspace created in app |
| `test_cli_pane_split` | Run `obelisk split -h`, verify pane split in app |

**Stress Tests (nightly CI):**

| Test | Description |
|------|-------------|
| `test_ipc_100_concurrent_clients` | 100 clients connect simultaneously |
| `test_ipc_connection_churn` | Rapid connect/disconnect cycles |
| `test_ipc_oversized_payload` | Send >1MB payload, verify graceful rejection |
| `test_ipc_1000_requests_per_second` | Sustained throughput test |

### Phase 8: Polish

**Visual Regression Tests:**

| Screen | Platforms |
|--------|-----------|
| Default app layout | Linux, macOS, Windows |
| Split pane configurations (H, V, nested) | Linux, macOS, Windows |
| Notification panel | Linux, macOS, Windows |
| Command palette | Linux, macOS, Windows |
| Settings modal | Linux, macOS, Windows |
| Light theme | Linux, macOS, Windows |
| Dark theme | Linux, macOS, Windows |

**Packaging Smoke Tests:**

| Package | Test |
|---------|------|
| macOS .dmg | Install, launch, terminal works |
| Windows .msi | Install, launch, terminal works |
| Linux AppImage | Run, terminal works |
| Linux .deb | Install, launch, terminal works |

---

## 5. Cross-Platform Test Matrix

```
                    | Unit | Integration | E2E  | Coverage | Benchmark |
--------------------|------|-------------|------|----------|-----------|
Linux (every PR)    |  Y   |      Y      |  Y   |    Y     |     N     |
macOS (every PR)    |  Y   |      Y      | info |    N     |     N     |
Windows (nightly)   |  Y   |      Y      |  Y   |    Y     |     N     |
All (merge to main) |  Y   |      Y      |  Y   |    Y     |     N     |
Nightly             |  Y   |      Y      |  Y   |    Y     |     Y     |
```

### Platform-Specific Tests

**Windows-only:**
- ConPTY spawn and I/O
- Named pipe IPC bind/connect
- Shell detection (pwsh > powershell > cmd)
- Path separator handling in persistence
- Job Object child process cleanup

**macOS-only:**
- Unix PTY with `/bin/zsh` default
- Unix socket IPC
- Notification Center integration

**Linux-only:**
- Unix PTY with `$SHELL` or `/bin/bash`
- Unix socket IPC with permission checks
- `/proc/net/tcp` port scanning

---

## 6. Coverage Enforcement

### Targets

| Scope | CI Gate | Target |
|-------|---------|--------|
| Rust overall | 95% | 98% |
| Rust core modules (pty, workspace, osc_parser, persistence, ipc/protocol) | 100% | 100% |
| React overall | 95% | 98% |
| React stores + hooks | 100% | 100% |
| React components | 90% | 95% |
| `tauri-bridge.ts` | 100% | 100% |

### Tools

- **Rust:** `cargo-llvm-cov` with `--fail-under 95`. Per-module check via CI script parsing JSON output.
- **React:** Vitest `coverage.thresholds: { lines: 95, branches: 90, functions: 95 }` with per-file overrides.

### Exclusion Policy

- Code excluded from the 100% mandate must have a justification comment: `// Coverage exclusion: Tauri builder glue, tested via integration tests`
- No `#[cfg(not(tarpaulin_include))]` on business logic modules
- Coverage reports uploaded as CI artifacts on every merge to main

---

## 7. Performance Testing

### 7.1 Benchmarks (criterion)

| Benchmark | Target | Phase |
|-----------|--------|-------|
| PTY read + base64 encode (10MB) | < 200ms | 1 |
| OSC parser throughput (10MB) | < 50ms | 4 |
| Event serialization (16KB payload) | < 10us | 1 |
| Workspace state serialization | < 1ms | 2 |
| Session persistence write (10 workspaces) | < 50ms | 3a |
| JSON-RPC parse + dispatch | < 100us | 7 |

### 7.2 End-to-End Latency

| Measurement | Target | Method |
|-------------|--------|--------|
| Keystroke to PTY write | < 5ms | Playwright performance marks |
| PTY output to screen render | < 16ms | Custom E2E benchmark |
| Pane split response time | < 100ms | E2E timing |
| Workspace switch time | < 50ms | E2E timing |
| Session restore (10 panes) | < 2s | E2E timing |
| App cold start | < 2s | E2E timing |

### 7.3 Memory Monitoring (Nightly)

| Check | Threshold |
|-------|-----------|
| Create/destroy 100 terminals | Memory growth < 10MB after GC |
| 10 terminals idle for 5 minutes | No memory growth |
| Large output (10MB to single terminal) | Peak memory < 200MB |
| Memory per terminal | < 20MB (xterm.js + scrollback) |

### 7.4 Benchmark Regression

- Store benchmark results as JSON golden files in git
- Nightly CI compares against baseline
- CI fails if regression > 10% on any benchmark
- Use `criterion`'s built-in comparison for Rust benchmarks

---

## 8. Regression Prevention

### Golden File Tests

| Domain | Input | Expected Output | Update Command |
|--------|-------|----------------|----------------|
| OSC parser | Byte sequences | (forwarded bytes, notifications) | `UPDATE_GOLDEN=1 cargo test` |
| Workspace serialization | Workspace struct | JSON output | `UPDATE_GOLDEN=1 cargo test` |
| IPC protocol | Request JSON | Response JSON | `UPDATE_GOLDEN=1 cargo test` |

Golden files are committed to git. Updates require explicit environment variable and PR review.

### Visual Regression

- Playwright screenshots on merge to main
- Per-platform baselines (font rendering differs)
- Tolerance: < 0.5% pixel difference
- Captured screens: default layout, split panes, notification panel, command palette, settings modal, all themes
- Baselines updated manually via PR

### Bug Regression

- Every bug fix PR must include a test that fails without the fix and passes with it
- Regression tests are tagged: `#[regression("GH-123")]` / `it.regression('GH-123', ...)`
- Regression tests are permanent

---

## 9. Flaky Test Protocol

### Detection
- CI tracks test pass/fail history per test
- Any test that fails then passes on retry is flagged
- Weekly report of flaky test rate

### Response
1. **Immediate:** Mark test with `@flaky` annotation
2. **Within 24 hours:** File an issue with reproduction steps
3. **Within 48 hours:** Fix must be merged, or test is moved to quarantine suite
4. **Quarantine suite:** Runs nightly only. Tests in quarantine > 1 week are deleted.

### Retry Policy
- Unit tests: 0 retries
- Integration tests: 0 retries
- E2E tests: 1 retry
- Any E2E test retrying > 5% of runs triggers investigation

### Prevention Checklist (Code Review)
- [ ] No `sleep()` calls in tests (use polling/events with timeout)
- [ ] All async operations have explicit timeouts
- [ ] Each test creates its own resources (temp dirs, sockets, PTY instances)
- [ ] Tests clean up after themselves (Drop impls, afterEach hooks)
- [ ] No dependency on test execution order
- [ ] No shared mutable global state between tests
- [ ] Deterministic test data (fixed seeds for proptest, hardcoded fixtures)
- [ ] No `#[ignore]` or `test.skip` without a linked issue

---

## 10. Test Data and Fixtures

### Directory Structure

```
fixtures/
├── pty/
│   ├── simple_prompt.txt          # Basic shell prompt output
│   ├── colored_output.txt         # ANSI color escape sequences
│   ├── unicode_output.txt         # CJK, emoji, RTL text
│   └── large_output_10mb.bin      # Throughput testing data
├── osc/
│   ├── osc9_simple.bin            # ESC]9;Hello\a
│   ├── osc99_notification.bin     # ESC]99;;body\a
│   ├── osc777_notify.bin          # ESC]777;notify;title;body\a
│   ├── mixed_data_and_osc.bin     # Interleaved terminal output and OSC
│   ├── partial_osc.bin            # OSC split across read boundaries
│   └── malformed_osc.bin          # Invalid/truncated sequences
├── workspace/
│   ├── single_pane.json           # Minimal valid workspace
│   ├── multi_workspace.json       # 3 workspaces, various layouts
│   ├── deep_nested_splits.json    # 4-level deep split tree
│   ├── corrupted.json             # Malformed JSON for error handling
│   ├── empty.json                 # Empty workspace list
│   └── large_state.json           # 20 workspaces, 100 panes
├── ipc/
│   ├── valid_requests/            # One file per JSON-RPC method
│   ├── invalid_requests/          # Malformed requests
│   └── responses/                 # Expected responses for contract tests
└── screenshots/                   # Visual regression golden files
    ├── linux/
    ├── macos/
    └── windows/
```

### Programmatic Fixtures

Some fixtures are generated in test setup:
- PTY output with specific ANSI sequences (builder pattern)
- Workspace state with N panes (factory function)
- Random but deterministic data (seeded RNG for proptest)

### Mock Strategies

| Dependency | Mock | Used In |
|-----------|------|---------|
| `portable-pty` | `PtyBackend` trait + `MockPtyBackend` (mockall) | Rust unit tests |
| Tauri `invoke()` | `__mocks__/@tauri-apps/api/core.ts` | Frontend unit/integration |
| Tauri `listen()` | `__mocks__/@tauri-apps/api/event.ts` | Frontend unit/integration |
| xterm.js | `__mocks__/@xterm/xterm.ts` | Frontend terminal tests |
| Filesystem | `tempfile` crate | Rust persistence tests |
| Git commands | `CommandRunner` trait + mock | Rust git module tests |
| Time | `tokio::time::pause()` | Rust async timing tests |

---

## 11. Quality Gates Between Phases

| Transition | Gate Criteria |
|-----------|---------------|
| Phase 1 first PR -> features | CI green. Mocks available. Coverage reporting active. |
| Phase 1 -> Phase 2 | 95% overall Rust coverage. 100% on pty module. PTY integration tests pass on 3 OSes. Throughput benchmark baseline established. E2E: app launches, terminal works. |
| Phase 2 -> Phase 3a | 100% on stores/hooks. 100% on Rust workspace module. Split pane E2E passes. Keyboard shortcuts E2E passes. |
| Phase 3a -> Phase 3b | Persistence round-trip E2E passes on 3 OSes. Crash recovery test passes. |
| Phase 3b -> Phase 4 | Git/port metadata tests pass. Scrollback serialization verified. |
| Phase 4 -> Phase 5 | OSC parser proptest (100k+ cases). Notification E2E passes. |
| Phase 5 -> Phase 6 | Browser pane iframe E2E passes. |
| Phase 6 -> Phase 7 | Command palette E2E passes. All shortcuts verified. |
| Phase 7 -> Phase 8 | CLI E2E passes. IPC stress test passes. |
| Release | Full E2E on 3 OSes. No P0/P1 bugs. Performance within targets. No flaky tests (retry rate < 5%). |

Gates apply to **merging to main**, not to starting work. Developers may work on Phase N+1 branches while Phase N is being finalized.
