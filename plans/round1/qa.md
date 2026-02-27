# Round 1 — Senior QA Engineer Analysis

## 1. Testing Philosophy

Every line of production code in Obelisk must be driven by a failing test written first. This is non-negotiable. The PRD specifies 8 implementation phases, but **Phase 0 is test infrastructure** — before a single feature line lands, the test tooling, CI pipeline, and coverage enforcement must be operational.

The CLAUDE.md mandates: *"We should always do changes strongly tested using automated tests. Always use TDD to ANY change."* This means:
- No PR merges without associated tests
- No feature branches without test-first commits (red-green-refactor visible in git history)
- CI blocks merge if coverage drops below threshold

---

## 2. Testing Pyramid Design

### Target Ratio: 70% Unit / 20% Integration / 10% E2E

| Layer | Rust | React/TypeScript |
|-------|------|------------------|
| **Unit** | `cargo test` per module, `mockall` for trait mocking, `proptest` for property-based | Vitest + Testing Library per component/hook/store |
| **Integration** | Multi-module tests (PTY manager + OSC parser, workspace state + persistence, IPC server + handler dispatch) | Tauri command invocation mocks, store + component wiring, event subscription chains |
| **E2E** | — | Playwright via Tauri's WebDriver support, full app scenarios |

### Unit Tests (70%)
- **Rust**: Every struct, every function, every error path. `#[cfg(test)]` modules co-located. Target: **100% line coverage** measured by `cargo-llvm-cov`.
- **React**: Every component renders correctly with given props. Every store action produces expected state. Every hook returns expected values. Target: **100% line coverage** measured by Vitest's c8/istanbul.

### Integration Tests (20%)
- **Rust**: Tests in `tests/` directory that exercise multiple modules together. PTY spawn + read + write cycle. Workspace create + persist + restore cycle. IPC server accepts connection + dispatches command + returns response.
- **React**: Tests that mount components with real Zustand stores (not mocked). Tests that verify Tauri command invocations produce correct UI updates via mocked `@tauri-apps/api`.

### E2E Tests (10%)
- Full application launch via Tauri's WebDriver.
- Scenarios: create workspace, type in terminal, split pane, receive notification, persist session, restore session.
- Run on all 3 platforms in CI.

---

## 3. TDD Methodology Enforcement

### What TDD looks like per layer:

#### Rust TDD Cycle
1. Write a failing `#[test]` in the module's test submodule
2. Run `cargo test --lib` — see it fail (RED)
3. Write minimum code to pass (GREEN)
4. Refactor while keeping tests green (REFACTOR)
5. Commit with message: `test: add test for X` then `feat: implement X`

Example for `PtyManager::spawn`:
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn spawn_returns_valid_pty_id() {
        let manager = PtyManager::new();
        let id = manager.spawn("/bin/bash", None, None).await.unwrap();
        assert!(!id.is_empty());
    }

    #[tokio::test]
    async fn spawn_with_invalid_shell_returns_error() {
        let manager = PtyManager::new();
        let result = manager.spawn("/nonexistent", None, None).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn kill_unknown_id_returns_error() {
        let manager = PtyManager::new();
        let result = manager.kill("nonexistent-id").await;
        assert!(result.is_err());
    }
}
```

#### React TDD Cycle
1. Write a failing Vitest test using Testing Library
2. Run `bun test` — see it fail (RED)
3. Write minimum component/hook/store code to pass (GREEN)
4. Refactor (REFACTOR)

Example for `workspaceStore`:
```typescript
describe('workspaceStore', () => {
  it('starts with empty workspaces', () => {
    const state = useWorkspaceStore.getState();
    expect(state.workspaces).toEqual([]);
  });

  it('creates a workspace with default name', () => {
    useWorkspaceStore.getState().createWorkspace();
    const state = useWorkspaceStore.getState();
    expect(state.workspaces).toHaveLength(1);
    expect(state.workspaces[0].name).toBeDefined();
  });

  it('sets new workspace as active', () => {
    useWorkspaceStore.getState().createWorkspace();
    const state = useWorkspaceStore.getState();
    expect(state.activeWorkspaceId).toBe(state.workspaces[0].id);
  });
});
```

### Enforcement Mechanisms
- **Pre-commit hook**: Runs `cargo test --lib` and `bun test --changed` — blocks commit if tests fail
- **CI**: Runs full test suite + coverage check — blocks merge if coverage < 100%
- **PR template**: Requires "Test Plan" section describing what tests were added
- **Code review**: Reviewers must verify test-first commit order in git log

---

## 4. Test Infrastructure (Phase 0 Requirements)

### Rust Test Stack
| Tool | Purpose |
|------|---------|
| `cargo test` | Built-in test runner |
| `cargo-llvm-cov` | Coverage measurement (LLVM-based, accurate) |
| `mockall` | Trait-based mocking for dependency injection |
| `proptest` | Property-based testing (PTY data, OSC sequences, workspace configs) |
| `tokio::test` | Async test runtime |
| `assert_cmd` + `predicates` | CLI binary integration testing |
| `tempfile` | Temporary directories for persistence tests |
| `test-log` | Capture log output in tests |

### Frontend Test Stack
| Tool | Purpose |
|------|---------|
| Vitest | Test runner (Vite-native, fast) |
| `@testing-library/react` | Component rendering + queries |
| `@testing-library/user-event` | User interaction simulation |
| `jsdom` | Browser environment for unit tests |
| `msw` (Mock Service Worker) | API/Tauri command mocking |
| Playwright | E2E browser automation |
| `@vitest/coverage-v8` | Coverage measurement |

### E2E Test Stack
| Tool | Purpose |
|------|---------|
| Playwright | Cross-browser E2E test runner |
| `tauri-driver` | WebDriver bridge for Tauri apps |
| Docker (Linux CI) | Headless Linux testing |
| GitHub Actions matrix | Windows + macOS + Linux runners |

### CI Pipeline (GitHub Actions)
```yaml
# Required jobs that must pass before merge:
- rust-test:        cargo test --workspace
- rust-coverage:    cargo llvm-cov --fail-under 100
- rust-clippy:      cargo clippy -- -D warnings
- frontend-test:    bun test --coverage
- frontend-lint:    bun lint
- e2e-linux:        playwright + tauri-driver (ubuntu)
- e2e-macos:        playwright + tauri-driver (macos-latest)
- e2e-windows:      playwright + tauri-driver (windows-latest)
```

---

## 5. Coverage Targets and Enforcement

### Targets
| Scope | Target | Rationale |
|-------|--------|-----------|
| Rust unit + integration | 100% line | Mandate from CLAUDE.md; Rust code handles PTY (safety-critical), persistence, IPC |
| React unit + integration | 100% line | Every component, hook, and store must be fully tested |
| E2E | Critical path coverage | All 8 phase verification scenarios as automated E2E tests |

### Enforcement
- `cargo-llvm-cov` with `--fail-under 100` in CI
- Vitest with `coverage.thresholds.lines: 100` in `vitest.config.ts`
- Coverage reports uploaded as CI artifacts
- Coverage badge in README
- **No `#[cfg(not(test))]` escape hatches** — if code can't be tested, redesign it

### Dealing with Hard-to-Cover Code
- Platform-specific code: Use trait abstraction + platform-specific impls, each tested on their platform
- `main.rs` / `main.tsx` entry points: Keep minimal (< 10 lines), tested via integration/E2E
- External API calls: Mock at trait boundary, test the mock path and the real path separately

---

## 6. Cross-Platform Test Matrix

### CI Matrix Design
```
             | Unit Tests | Integration | E2E  | Coverage |
-------------|-----------|-------------|------|----------|
Linux (x64)  |     Y     |      Y      |  Y   |    Y     |
macOS (arm)  |     Y     |      Y      |  Y   |    N*    |
Windows (x64)|     Y     |      Y      |  Y   |    N*    |
```
*Coverage only computed once (Linux) to save CI time; other platforms verify tests pass.

### Platform-Specific Tests
- **PTY tests**: Must run on all 3 OSes. `portable-pty` uses ConPTY on Windows, native on Unix — behavior differences must be tested.
- **IPC tests**: Unix socket on macOS/Linux, named pipe on Windows — both paths need integration tests.
- **Path handling**: Windows backslashes vs Unix forward slashes in workspace persistence.
- **Notification tests**: OS notification API differences (notification-daemon on Linux, Notification Center on macOS, Windows toast).
- **Shell tests**: Default shell detection (/bin/bash, /bin/zsh, cmd.exe, powershell.exe).

### Tests That MUST Be Cross-Platform
1. PTY spawn/write/read/resize/kill lifecycle
2. Workspace persistence save/restore (path serialization)
3. IPC server bind/accept/dispatch/respond
4. CLI binary end-to-end (connect, send command, receive response)
5. OS notification delivery
6. Port scanning

---

## 7. Hard-to-Test Areas and Strategies

### 7.1 PTY Behavior
**Challenge**: Real PTY processes are stateful, timing-dependent, and OS-specific.
**Strategy**:
- Create a `PtyBackend` trait with `spawn`, `write`, `read`, `resize`, `kill` methods
- Production: `RealPtyBackend` wrapping `portable-pty`
- Tests: `MockPtyBackend` (via `mockall`) for unit tests
- Integration tests: Use real PTY but with controlled scripts (`echo "hello"`, `cat`, `sleep 0.1 && echo done`)
- Use `tokio::time::timeout` to prevent hanging tests
- Platform-specific test fixtures: bash scripts for Unix, batch/PowerShell for Windows

### 7.2 xterm.js Rendering
**Challenge**: WebGL rendering cannot be tested in jsdom.
**Strategy**:
- Unit test the `useTerminal` hook logic (data flow, event subscriptions) without rendering xterm.js
- Mock `Terminal` class from `@xterm/xterm` in unit tests
- Visual regression tests via Playwright screenshots (E2E layer)
- Golden file comparison for terminal output sequences

### 7.3 OS Notifications
**Challenge**: OS notifications are fire-and-forget, hard to verify programmatically.
**Strategy**:
- Abstract behind `NotificationSender` trait
- Unit test: mock sender verifies correct payload
- Integration test on CI: Verify `tauri-plugin-notification` is called with correct arguments (mock the plugin)
- E2E: Skip OS notification verification; trust the plugin. Test the in-app notification UI instead.

### 7.4 Browser Embedding
**Challenge**: Iframe content and Tauri multi-webview are hard to control in tests.
**Strategy**:
- Unit test `BrowserPane` component with mocked iframe (verify src, toolbar state)
- Integration test: Verify URL navigation updates toolbar state
- E2E: Load a local test server URL in browser pane, verify navigation works
- Multi-webview (unstable): Separate test suite gated behind feature flag

### 7.5 Tauri Multi-Webview (Unstable)
**Challenge**: Behind feature flag, may not be available on all platforms.
**Strategy**:
- Feature-gated test module: `#[cfg(feature = "unstable")]`
- Separate CI job for unstable features
- Fallback behavior (iframe mode) has its own comprehensive tests

---

## 8. Testing the Rust <-> React Boundary

This is the highest-risk area. Tauri commands and events are the only bridge between backend and frontend. If this bridge breaks, the app is broken.

### Tauri Command Testing
**Rust side**:
- Unit test each command function independently (they're just functions)
- Integration test: Register commands in a test Tauri app, invoke them, verify responses

**React side**:
- Mock `@tauri-apps/api`'s `invoke()` function
- Verify each component/hook calls `invoke()` with correct command name and arguments
- Verify correct handling of success and error responses

**Contract testing**:
- Define TypeScript types that mirror Rust structs (already in `lib/types.ts`)
- Use a shared schema (JSON Schema or manual test) to verify Rust serialization matches TypeScript expectations
- Integration test: Serialize Rust struct → JSON → parse in TypeScript test → verify fields match

### Tauri Event Testing
**Rust side**:
- Unit test: Verify `emit()` is called with correct event name and payload
- Use `mockall` to mock the Tauri `AppHandle` if possible, or use Tauri's test utilities

**React side**:
- Mock `listen()` from `@tauri-apps/api/event`
- Verify event handlers process payloads correctly
- Test event subscription cleanup (no memory leaks)

### Specific Bridge Tests Required
| Command | Rust Test | React Test |
|---------|-----------|------------|
| `pty_spawn` | Returns valid ID, handles errors | Calls invoke correctly, updates store |
| `pty_write` | Writes to correct PTY, errors on bad ID | Sends base64-encoded data |
| `pty_resize` | Resizes correct PTY | Sends correct cols/rows from FitAddon |
| `pty_kill` | Kills process, cleans up | Updates store, removes pane |
| `pty-data-{id}` event | Emits correct event name with base64 data | Decodes and writes to xterm.js |
| `notification` event | Emits with correct payload | Updates notification store, shows UI |
| workspace commands | CRUD operations on state | Store mutations match expected |

---

## 9. Performance Testing

### Throughput Benchmarks
- **PTY data throughput**: `cat /dev/urandom | head -c 10M` — measure time from PTY read to xterm.js render
- **Target**: > 50 MB/s sustained throughput
- **Tool**: Rust `criterion` benchmarks for the PTY read/encode path

### Memory Leak Detection
- **Rust**: Run `valgrind` or `cargo-valgrind` on long-running PTY sessions
- **Frontend**: Playwright + Chrome DevTools Protocol — take heap snapshots before and after creating/destroying 100 terminals
- **Detection**: CI job that runs the app for 5 minutes with automated workspace create/destroy cycles, checks memory growth < 10%

### Latency Testing
- **Input latency**: Measure time from `pty_write` invoke to character appearing on screen
- **Target**: < 16ms (one frame at 60fps)
- **Tool**: Custom Playwright test with performance marks

### Benchmark Regression
- Store benchmark results in git (JSON golden files)
- CI compares against baseline, fails if > 10% regression
- Use `criterion`'s built-in comparison for Rust benchmarks

---

## 10. Regression Testing Strategy

### Snapshot Tests
- **React components**: Vitest snapshot tests for rendered output
- **Rust serialization**: Golden file tests for JSON output of workspace state, notification payloads
- **Terminal sequences**: Golden file tests for OSC parser output given known input sequences

### Visual Regression
- Playwright screenshot comparison for:
  - Default app layout
  - Split pane configurations
  - Notification panel
  - Command palette
  - Settings modal
- Tolerance: < 0.1% pixel difference (accounts for font rendering differences)
- Platform-specific baselines (fonts render differently per OS)

### Behavioral Regression
- Every bug fix must include a regression test
- E2E smoke suite runs on every PR
- Full E2E suite runs on merge to main

---

## 11. Test Data and Fixtures

### Mock PTY Output
- `fixtures/pty/simple_prompt.txt` — basic bash prompt output
- `fixtures/pty/colored_output.txt` — ANSI color sequences
- `fixtures/pty/large_output.bin` — 10MB of random terminal data for throughput testing
- `fixtures/pty/unicode_output.txt` — CJK, emoji, RTL text

### Terminal Sequences
- `fixtures/osc/notification_osc9.txt` — OSC 9 notification sequence
- `fixtures/osc/notification_osc99.txt` — OSC 99 notification sequence
- `fixtures/osc/notification_osc777.txt` — OSC 777 notification sequence
- `fixtures/osc/mixed_data_and_osc.txt` — Terminal data interleaved with OSC sequences

### Workspace Configurations
- `fixtures/workspace/single_pane.json` — minimal workspace
- `fixtures/workspace/complex_layout.json` — nested splits, multiple surfaces
- `fixtures/workspace/corrupted.json` — malformed JSON for error handling tests
- `fixtures/workspace/v1_migration.json` — old format for migration testing

### IPC Fixtures
- `fixtures/ipc/valid_requests.json` — all valid JSON-RPC requests
- `fixtures/ipc/invalid_requests.json` — malformed requests for error path testing
- `fixtures/ipc/large_payload.json` — stress test payload

---

## 12. Flaky Test Prevention

### Known Flake Risks
1. **PTY timing**: Read after write may not return immediately
2. **Port scanning**: Ports may be occupied by other processes
3. **OS notifications**: Delivery timing is non-deterministic
4. **xterm.js rendering**: WebGL initialization timing
5. **File system**: Temp file cleanup race conditions

### Prevention Strategies
- **Retry budget**: Tests get 0 retries in CI. If a test is flaky, it gets quarantined immediately.
- **Timeouts**: Every async test has an explicit timeout (5s unit, 30s integration, 60s E2E)
- **Deterministic data**: Use fixed seeds for `proptest`, controlled scripts for PTY tests
- **Resource isolation**: Each test gets its own temp dir, its own PTY, its own IPC socket path
- **Cleanup**: `Drop` impls for Rust test fixtures, `afterEach` cleanup in Vitest/Playwright
- **No sleep**: Never use `sleep()` in tests. Use polling with timeout or event-driven waiting.
- **Quarantine protocol**: Flaky test detected → immediately moved to `#[ignore]` / `test.skip` → issue filed → fixed within 48 hours → restored

---

## 13. Per-Phase Test Requirements

### Phase 1: Project Scaffold + Core Terminal
**Must have before code**:
- CI pipeline operational with Rust + Frontend test jobs
- Coverage enforcement active (100% threshold)
- Pre-commit hooks installed

**Test cases**:
- `PtyManager::spawn` — success, invalid shell, spawn limit
- `PtyManager::write` — valid write, invalid ID, write after kill
- `PtyManager::read` — receives PTY output, handles binary data, base64 encoding correctness
- `PtyManager::resize` — valid resize, invalid dimensions, resize after kill
- `PtyManager::kill` — clean kill, double kill, kill during read
- `TerminalPane` — renders xterm.js instance, displays cursor
- `useTerminal` — subscribes to PTY events, sends keystrokes, handles resize
- Integration: Full PTY lifecycle (spawn → write → read → resize → kill)

### Phase 2: Workspaces + Split Layout
- `workspaceStore` — create/close/switch workspace, all state transitions
- `Sidebar` — renders workspace list, active workspace highlight
- `PaneSplitter` — renders single pane, horizontal split, vertical split, nested splits
- Split/close actions — correct layout tree mutations
- Surface tabs — create/switch/close surface
- Keyboard shortcuts — Ctrl+N creates workspace, Ctrl+1-9 switches

### Phase 3: Session Persistence + Metadata
- `persistence.rs` — save/restore round-trip, corrupted file handling, missing file handling
- Scrollback serialization — xterm SerializeAddon integration
- `git/mod.rs` — branch detection, dirty status, PR number extraction
- `ports/mod.rs` — listening port detection, refresh cycle
- Integration: Close app → reopen → verify layout + scrollback restored

### Phase 4: Notifications
- `osc_parser.rs` — parse OSC 9, 99, 777, ignore unknown, handle partial sequences, handle interleaved data
- `notificationStore` — add notification, mark read, clear, badge count
- Notification UI — panel renders notifications, badge shows count, pane ring appears
- OS notification — correct payload sent to tauri-plugin-notification
- Integration: PTY output with OSC → parser extracts → store updated → UI reflects

### Phase 5: Browser Panels
- `BrowserPane` — renders iframe with correct src, toolbar state
- `BrowserToolbar` — URL input, back/forward/refresh buttons
- Navigation — URL changes update iframe, toolbar reflects current URL
- Multi-webview (feature-gated) — native webview creation, position sync

### Phase 6: Command Palette + Keyboard Shortcuts
- `useKeyboardShortcuts` — registers/unregisters handlers, conflict detection
- `CommandPalette` — renders, filters commands, executes selected
- `SettingsModal` — renders settings, keybinding editor saves changes
- Fuzzy search — correct ranking of results

### Phase 7: CLI
- `ipc_server` — binds socket/pipe, accepts connection, dispatches command, returns response
- `protocol.rs` — serialize/deserialize all JSON-RPC message types
- CLI binary — each subcommand sends correct IPC message and displays response
- Error handling — server not running, invalid command, timeout
- Integration: CLI → IPC → server → handler → response → CLI output

### Phase 8: Polish
- Theme switching — CSS variables update, persisted preference
- Font customization — terminal font changes, persisted
- Packaging — built artifacts run correctly (smoke test)

---

## 14. Quality Gates Between Phases

No phase can begin until the previous phase's gate passes:

| Gate | Criteria |
|------|----------|
| Phase 1 → 2 | 100% coverage on all Phase 1 code. PTY lifecycle E2E passes on all 3 OSes. CI pipeline green. |
| Phase 2 → 3 | 100% coverage on workspace/layout code. Split pane E2E passes. |
| Phase 3 → 4 | Persistence round-trip E2E passes. Git/port info displays correctly. |
| Phase 4 → 5 | OSC parser property tests pass. Notification E2E passes. |
| Phase 5 → 6 | Browser pane E2E passes. Iframe and multi-webview (if available) tested. |
| Phase 6 → 7 | Command palette E2E passes. All keyboard shortcuts verified. |
| Phase 7 → 8 | CLI end-to-end tested. IPC protocol fully covered. |
| Release | Full E2E suite passes on all 3 OSes. No open P0/P1 bugs. Performance benchmarks within targets. |

---

## 15. Summary of Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| PTY behavior differs across OSes | HIGH | Cross-platform CI matrix, platform-specific test fixtures |
| xterm.js hard to unit test | MEDIUM | Mock Terminal class for logic tests, Playwright for visual |
| Tauri command/event contract drift | HIGH | Shared type definitions, contract tests, integration tests |
| Flaky async tests | HIGH | No retries, strict timeouts, deterministic data, quarantine protocol |
| 100% coverage slows development | MEDIUM | It's the cost of quality. Infrastructure investment in Phase 0 pays off later. |
| OS notification untestable | LOW | Mock at boundary, trust the plugin, test in-app UI |
| Multi-webview unstable API changes | MEDIUM | Feature-gated tests, iframe fallback always tested |
