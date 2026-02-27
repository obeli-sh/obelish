# Round 2 — Senior QA Engineer: Cross-Role Debate

After reading all Round 1 analyses, I have specific challenges for each role and concrete proposals for testing infrastructure that must be built before any feature code.

---

## 1. Challenging the PM — "TDD Adds Friction" is Wrong

The PM wrote:

> "TDD adds friction (still test, but integration tests may be more valuable)" for React components, Tauri command wrappers, and CSS/theming.

I push back strongly:

**React components**: The PM says "prefer integration tests and E2E tests. Unit test the hooks and stores, not the JSX." This is a false dichotomy. We need **both**. Unit tests on components catch rendering bugs (wrong props passed, missing conditional rendering, broken aria attributes) that integration tests miss because integration tests focus on behavior chains. The TDD cycle for components is fast — write a test that asserts a component renders with given props, see it fail, implement the component. This takes 2 minutes per component and saves 20 minutes of debugging later.

**Tauri command wrappers**: The PM says "thin wrappers, test the underlying functions." But the wrappers ARE the contract. If someone changes the Tauri command name from `pty_write` to `write_pty` on the Rust side but forgets to update `tauri-bridge.ts`, the app breaks silently. A unit test on the bridge that asserts `invoke('pty_write', { ... })` is called with the exact string catches this. These tests cost almost nothing to write and maintain.

**CSS/theming**: The PM is right here — visual regression via Playwright screenshots is the correct strategy. No argument.

**The PM's "MVP is Phases 1-3 only" is correct** and I fully support this. But within that MVP, every line must be TDD'd. The time spent writing tests first is paid back immediately in fewer integration bugs. The data supports this: studies show TDD reduces defect density by 40-90% (IBM/Microsoft empirical studies, 2008). For a terminal multiplexer where bugs in PTY handling can hang the entire app, this is critical.

---

## 2. Challenging the Tech Lead — E2E Framework Choice

The tech lead proposes:

> "Use WebdriverIO with Tauri's official driver for E2E. Alternatively, test the frontend in isolation with Playwright against a mock Tauri backend."

I challenge this:

**WebdriverIO vs Playwright**: Playwright is superior for this project. Here's why:
- Playwright has first-class TypeScript support (our frontend language)
- Playwright's auto-wait mechanism reduces flaky tests significantly
- Playwright has built-in screenshot comparison (visual regression)
- Playwright supports multiple browsers out of the box
- Tauri v2 has `tauri-driver` which implements the WebDriver protocol — both WebdriverIO and Playwright can use it via their WebDriver/CDP integrations
- The frontend team is more likely to already know Playwright than WebdriverIO

**My recommendation**: Playwright for ALL E2E tests (frontend isolation and full Tauri app). Use `tauri-driver` as the bridge when testing the full app.

**The tech lead's `ts-rs` recommendation is excellent** — auto-generating TypeScript types from Rust structs eliminates an entire class of contract bugs. This should be a Phase 0 infrastructure requirement, not optional.

**The shared protocol crate (`obelisk-protocol`) is a good idea** but needs to be tested:
- Every type in the protocol crate needs `proptest` for serialization round-trips
- The protocol crate should have its own test suite that verifies JSON schema compatibility

---

## 3. Challenging the Frontend Engineer — Component Testing is Not Thorough Enough

The frontend engineer wrote:

> "Every component should have unit tests covering: rendering with various props, user interactions, state transitions, error states."

This is a good start but **incomplete**. Missing from the frontend testing strategy:

### 3.1 No Mention of Cleanup Testing
The frontend analysis identifies xterm.js memory leaks as a high-severity risk but the testing strategy doesn't include explicit cleanup tests. For every component that subscribes to events or creates resources:

```typescript
it('cleans up Tauri event listeners on unmount', () => {
  const unlisten = vi.fn();
  (listen as Mock).mockResolvedValue(unlisten);

  const { unmount } = render(<TerminalPane paneId="p1" ptyId="pty1" />);
  unmount();

  expect(unlisten).toHaveBeenCalled();
});
```

Every component that calls `listen()` must have a corresponding cleanup test. Every component that creates an xterm.js `Terminal` must have a disposal test. This should be a **mandatory checklist item** in code review.

### 3.2 WebGL Context Limit Testing
The frontend identifies WebGL context limits (8-16 per page) as a high-severity risk but proposes no test for it. We need:

```typescript
it('falls back to canvas when WebGL context creation fails', () => {
  // Mock WebGL context creation to fail
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);

  render(<TerminalPane paneId="p1" ptyId="pty1" />);

  // Verify CanvasAddon was loaded instead of WebglAddon
  expect(mockTerminal.loadAddon).toHaveBeenCalledWith(
    expect.any(CanvasAddon)
  );
});
```

### 3.3 Store Splitting Creates Integration Risk
The frontend proposes splitting `workspaceStore` into 4 stores (workspace, layout, pane, focus). This is good for re-render optimization but **creates integration risk**. When stores are separated, cross-store consistency becomes a testing concern:

- Test: Creating a workspace in `workspaceStore` creates a default surface in `layoutStore` and a default pane in `paneStore`
- Test: Closing a pane in `paneStore` updates `layoutStore` tree and `focusStore` focus target
- Test: Deleting a workspace in `workspaceStore` cascades to all related stores

These cross-store integration tests must exist BEFORE the stores are split. Write the integration tests first (TDD), then refactor the monolithic store into separate stores while keeping tests green.

### 3.4 Storybook is Not Testing
The frontend mentions Storybook for component development and Chromatic/Percy for visual regression. **Storybook is a development tool, not a testing tool.** Stories are not tests — they don't have assertions, they don't fail CI, they don't prevent regressions. They are useful for development but must not be counted as "tested."

Visual regression should be done via Playwright screenshot comparison, not an external service like Chromatic. Reasons:
- Chromatic/Percy add cost and external dependency
- Playwright screenshots run in CI with zero additional cost
- Screenshots are stored as golden files in the repo — reviewable in PRs

---

## 4. Challenging the Backend Engineer — Are Mocks Realistic?

The backend engineer proposes:

> `MockPtyBackend` via mockall trait mocking for PTY operations

I challenge the **completeness** of this mock strategy:

### 4.1 The Mock PTY Doesn't Capture Timing
Real PTY behavior is inherently asynchronous. When you `write()` to a PTY, the output doesn't come back synchronously — it goes through the shell process, which might produce output immediately, or after a delay, or never. The `MockPtyBackend` returns controlled values, which is fine for testing the manager's state logic, but **does not test**:

- Race conditions between write and read
- EOF detection timing
- Partial read behavior (read returning less data than available)
- Backpressure when the read buffer fills up

**My requirement**: In addition to unit tests with mocks, every PTY operation must have an integration test with a real PTY process. These integration tests are where the real bugs will be found.

Specific integration tests needed:
```
test_spawn_and_read_prompt       # Spawn shell, verify prompt appears
test_write_echo_read             # Write "echo hello\n", read back "hello"
test_rapid_writes                # Write 100 commands in quick succession, verify all output
test_large_output                # Run "cat /dev/urandom | head -c 1M", verify all bytes received
test_resize_updates_columns      # Resize, run "tput cols", verify output matches
test_kill_during_read            # Start a long process, kill PTY, verify clean shutdown
test_shell_exit                  # Run "exit", verify EOF detection and cleanup
test_concurrent_ptys             # Spawn 10 PTYs simultaneously, verify independence
```

### 4.2 OSC Parser Needs Adversarial Testing
The backend proposes property-based testing for the OSC parser, which is excellent. But I want to ensure the property tests cover adversarial inputs:

```rust
proptest! {
    // Parser never panics on any input
    #[test]
    fn never_panics(data in prop::collection::vec(any::<u8>(), 0..10000)) {
        let mut parser = OscParser::new();
        parser.feed(&data); // must not panic
    }

    // Parser always forwards all input bytes (never drops data)
    #[test]
    fn forwards_all_bytes(data in prop::collection::vec(any::<u8>(), 0..10000)) {
        let mut parser = OscParser::new();
        let (forwarded, notifications) = parser.feed(&data);
        // Total bytes in forwarded + notification payloads == input length
        // (notifications are also forwarded to xterm.js per the design)
        assert_eq!(forwarded.len(), data.len());
    }

    // Parser correctly extracts known notification patterns
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

### 4.3 IPC Server Needs Stress Testing
The backend proposes basic IPC integration tests. I need **stress tests**:

- 100 concurrent client connections
- Client connects and disconnects rapidly (connection churn)
- Client sends malformed JSON (fuzzing)
- Client sends oversized payloads (>1MB)
- Server under load: 1000 requests/second sustained
- Client disconnects mid-response (half-open connection handling)

These stress tests should run as a separate CI job (they take longer) but must pass before Phase 7 is considered complete.

### 4.4 Atomic Write Testing
The backend's `atomic_write` function is critical for data integrity. It needs:

```rust
#[test]
fn atomic_write_survives_concurrent_reads() { ... }

#[test]
fn atomic_write_leaves_no_tmp_files_on_success() { ... }

#[test]
fn atomic_write_leaves_tmp_file_on_panic() { ... }

#[test]
fn corrupt_main_file_falls_back_to_backup() { ... }
```

---

## 5. Addressing PM's Concern About Testing Slowing Development

The PM suggests TDD adds friction on some areas. Here is the data:

### Cost of TDD
- Writing tests first adds ~15-30% to initial development time
- This is real and undeniable

### Return on TDD Investment
- Defect density reduction: 40-90% (IBM/Microsoft studies)
- Debugging time saved: Average bug takes 10x longer to find in integration than in unit test
- Refactoring confidence: With 100% coverage, any refactor is immediately validated
- Onboarding: New developers understand behavior from tests, not comments

### Specific to Obelisk
This is a **cross-platform terminal multiplexer**. The problem domain is inherently complex:
- 3 operating systems with different PTY implementations
- Bidirectional async data flow (PTY I/O, IPC, Tauri events)
- Stateful session persistence with crash recovery
- Streaming parser with partial-sequence handling

Without comprehensive tests, bugs in these areas will be discovered by users, not developers. Fixing a ConPTY race condition that was caught in a unit test takes 10 minutes. Fixing the same bug discovered by a user on Windows after release takes days of reproduction, debugging, and patch deployment.

**The testing mandate is not slowing us down. The testing mandate is preventing us from shipping a broken product.**

---

## 6. Specific Testing Requirements Per Phase

### Phase 0: Test Infrastructure (MUST BE FIRST)

Before any feature code, these must be operational:

| Item | Description | Acceptance Criteria |
|------|-------------|---------------------|
| Rust CI job | `cargo test`, `cargo clippy`, `cargo fmt --check` | Green on all 3 OSes |
| Rust coverage | `cargo-llvm-cov --fail-under 100` | Blocks merge if <100% |
| Frontend CI job | `bun test`, `bun lint`, `bun typecheck` | Green |
| Frontend coverage | Vitest `coverage.thresholds.lines: 100` | Blocks merge if <100% |
| E2E CI job | Playwright + `tauri-driver` | Green on Linux (expand to all OSes in Phase 2) |
| Pre-commit hooks | `cargo test --lib` + `bun test --changed` | Blocks commit if tests fail |
| PR template | Includes "Test Plan" section | Required field |
| `ts-rs` pipeline | Rust structs → TypeScript types | Generated types match Rust |
| Tauri API mock | `__mocks__/@tauri-apps/api` | Available for all frontend tests |
| xterm.js mock | `__mocks__/@xterm/xterm` | Available for terminal component tests |
| Test fixture directory | `fixtures/` with PTY output, OSC sequences, workspace configs | Committed to repo |

**This is not optional. This is Phase 0. No feature code until all items above pass.**

### Phase 1: Core Terminal — Test Requirements

| Test Category | Count | Examples |
|--------------|-------|---------|
| PtyManager unit tests | 15+ | spawn/write/read/resize/kill success and error paths |
| PtyBackend mock tests | 10+ | Manager logic without real PTY |
| OSC parser unit tests (placeholder) | 5+ | Basic parsing structure (full tests in Phase 4) |
| TerminalPane component tests | 8+ | Render, mount/unmount, xterm lifecycle, event subscription |
| useTerminal hook tests | 10+ | Data flow, resize, cleanup, error handling |
| tauri-bridge tests | 5+ | Each PTY command invocation |
| PTY integration tests | 8+ | Real PTY lifecycle on all 3 OSes |
| E2E smoke tests | 3+ | App launches, terminal appears, typing works |
| Performance benchmark | 1+ | PTY throughput baseline |

### Phase 2: Workspaces — Test Requirements

| Test Category | Count | Examples |
|--------------|-------|---------|
| workspaceStore unit tests | 15+ | Create/close/switch, state transitions |
| layoutStore unit tests | 15+ | Split/close/resize, tree validation |
| paneStore unit tests | 10+ | Create/close, type management |
| focusStore unit tests | 10+ | Focus tracking, keyboard navigation |
| Cross-store integration tests | 10+ | Workspace create cascades, pane close cascades |
| Sidebar component tests | 8+ | Render, active highlight, keyboard navigation |
| PaneSplitter component tests | 10+ | Single pane, splits, nested splits, resize |
| SurfaceTabBar component tests | 8+ | Tab list, create/switch/close |
| Keyboard shortcut tests | 10+ | Ctrl+N, Ctrl+1-9, Ctrl+Shift+H/V, etc. |
| E2E tests | 5+ | Create workspace, split pane, navigate |

### Phases 3-8: Similar detail required (I defer to the final testing strategy document)

---

## 7. Quality Gates: Strict and Non-Negotiable

| Gate | Hard Requirements |
|------|-------------------|
| Phase 0 → 1 | CI pipeline green. Coverage enforcement active. Pre-commit hooks verified. Tauri API mock available. |
| Phase 1 → 2 | 100% Rust coverage on PTY modules. 100% frontend coverage on terminal components. PTY integration tests pass on all 3 OSes. Throughput benchmark baseline established. |
| Phase 2 → 3 | 100% coverage on all store + layout code. Split pane E2E passes. Cross-store integration tests pass. |
| Phase 3 → 4 | Persistence round-trip tests pass (including crash recovery). Git/port metadata tests pass. Session restore E2E passes on all 3 OSes. |
| Phase 4 → 5 | OSC parser proptest passes (1M+ cases). Notification E2E passes. Zero false positive notifications. |
| Phase 5 → 6 | Browser pane E2E passes (iframe mode). URL navigation tests pass. |
| Phase 6 → 7 | Command palette E2E passes. All keyboard shortcuts verified via automated tests. No shortcut conflicts. |
| Phase 7 → 8 | CLI E2E passes. IPC stress tests pass. Protocol coverage 100%. |
| Release | Full E2E suite on all 3 OSes. Performance benchmarks within targets. No open P0/P1 bugs. No flaky tests in the suite. |

---

## 8. Concrete Test Infrastructure to Build in Phase 0

### 8.1 Tauri API Mock (Frontend)

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

export function clearEventMocks() {
  eventHandlers.clear();
  listen.mockClear();
}
```

### 8.2 xterm.js Mock (Frontend)

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

  constructor(options?: any) {
    this.options = options;
  }
}
```

### 8.3 Rust Test Utilities

```rust
// src-tauri/src/test_utils.rs (compiled only in test)
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

    pub fn osc99_notification(body: &str) -> Vec<u8> {
        format!("\x1b]99;;{}\x07", body).into_bytes()
    }
}
```

### 8.4 CI Configuration

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]

jobs:
  rust-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: clippy, rustfmt
      - run: cargo fmt --all -- --check
      - run: cargo clippy --workspace -- -D warnings

  rust-test:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - run: cargo test --workspace

  rust-coverage:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
        with:
          components: llvm-tools-preview
      - uses: taiki-e/install-action@cargo-llvm-cov
      - run: cargo llvm-cov --workspace --fail-under 100

  frontend-lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun run lint
      - run: bun run typecheck

  frontend-test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun test --coverage

  e2e:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: dtolnay/rust-toolchain@stable
      - uses: oven-sh/setup-bun@v2
      - run: bun install
      - run: bun tauri build
      - run: bun run test:e2e
```

---

## 9. Agreement with Other Roles

To be fair, several proposals across roles are excellent and I fully endorse:

- **PM**: MVP scoping to Phases 1-3. Moving keyboard shortcuts to Phase 2. Splitting Phase 3 into 3a/3b. All correct.
- **Tech Lead**: `ts-rs` for type generation. `PtyBackend` trait for testability. `tracing` for logging. Shared protocol crate. CI from Phase 1. All correct.
- **Frontend**: Rust as source of truth for structural state. Zustand selectors for re-render optimization. xterm.js lifecycle management concerns. All correct.
- **Backend**: Dedicated threads for PTY reads. Ring buffer with 60fps batching. Atomic writes for persistence. Process groups/Job Objects for orphan prevention. All correct.

The engineering quality across this team is high. My job is to ensure that quality is **proven by tests**, not assumed by good design.

---

## 10. Summary: Non-Negotiable QA Requirements

1. **Phase 0 is real**. Test infrastructure before feature code. No exceptions.
2. **100% coverage**. Measured by `cargo-llvm-cov` and Vitest. Enforced in CI. Blocks merge.
3. **TDD on everything**. Red-green-refactor visible in git history. Reviewers check this.
4. **Cross-platform CI from day 1**. Not "we'll test Windows later."
5. **Integration tests for PTY**. Mocks are necessary but not sufficient. Real PTY tests required.
6. **Contract tests for Rust-React boundary**. `ts-rs` + explicit invoke/event tests.
7. **Cleanup tests for every resource**. xterm.js disposal, event listener cleanup, PTY process cleanup.
8. **Property-based testing for parsers**. OSC parser must survive arbitrary input.
9. **Quality gates between phases**. No shortcuts, no "we'll add tests later."
10. **Zero flaky tests**. Quarantine immediately, fix within 48 hours, or delete.
