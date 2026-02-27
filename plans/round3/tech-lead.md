# Round 3: Senior Tech Lead — Final Recommendations

After three rounds of debate, the team has converged on most decisions. This document records the final architecture decisions, resolves remaining open questions, and establishes the technical standards that will govern development.

---

## 1. Final Architecture Decisions

### 1.1 Source of Truth: Rust (DECIDED)
**Decision**: Rust owns all structural state. React stores are read projections.
**Rationale**: 5/5 team members agree. This eliminates dual-state bugs, simplifies persistence, and enables CLI access to state without the frontend.
**Contract**: All structural mutations flow through `invoke()` -> Rust -> `workspace-changed` event -> React store update.

### 1.2 Frontend Store Architecture: 2 Stores (DECIDED)
**Decision**: `workspaceStore` (mirrors Rust state) + `uiStore` (focus, sidebar, panel visibility).
**Rationale**: Backend, Tech Lead, and PM aligned on this. Frontend proposed 4 stores but the "mirror store" argument is compelling — since Rust emits full workspace state in a single event, splitting the mirror into 3 stores adds synchronization overhead with no benefit. Frontend should use Zustand selectors for re-render optimization within the single workspace store.
**Resolution of Frontend's concern**: Fine-grained subscriptions via selectors achieve the same re-render optimization without store splitting.

### 1.3 PTY Data Pipeline: Base64 + Benchmark (DECIDED)
**Decision**: Base64 encoding with immediate emit in Phase 1. Add batching (ring buffer + 60fps flush) only if benchmarks show it's needed.
**Rationale**: PM's "benchmark first, optimize later" argument wins. Backend's ring buffer design is excellent engineering ready to be deployed when data justifies it. Phase 1 acceptance criterion: >50 MB/s throughput.
**Performance target**: <16ms end-to-end pipeline latency for a single frame of PTY output.

### 1.4 Thread Model: Dedicated OS Threads for PTY Reads (DECIDED)
**Decision**: `std::thread` per PTY for blocking reads. Channel-based communication to tokio async world.
**Rationale**: Backend and Tech Lead aligned. Explicit lifecycle control, no dependency on tokio blocking pool sizing.

### 1.5 Type Generation: ts-rs (DECIDED)
**Decision**: Use `ts-rs` to generate TypeScript types from Rust structs, emitted to `src/lib/generated/types.ts`.
**Rationale**: 3/5 team members independently recommended it. Frontend raised `specta` as an alternative (tighter Tauri integration). **Resolution**: Evaluate both in Phase 0. `specta` has advantages for Tauri command typing (generates entire `invoke()` wrappers). If `specta` works well, prefer it. If it's too opinionated, use `ts-rs`. The key requirement is auto-generation — the specific tool is secondary.
**PM's timing concern**: PM said to defer until types exceed ~15. I overrule this — the infrastructure cost of setting up ts-rs/specta is a one-time 2-hour task. The cost of manual type drift bugs is ongoing. Set it up in Phase 0.

### 1.6 Error Handling: thiserror, No anyhow (DECIDED)
**Decision**: Module-level errors via `thiserror`. No `anyhow` in library code.
**Rationale**: Backend's argument is correct — `anyhow` erases types and makes matching impossible. Frontend needs structured errors with `kind` field for specific error handling.
**Error serialization**: Backend's `{ kind, message }` format for Tauri command errors. Frontend agreed.
**No `.unwrap()` in production**: Use `.expect("context")` or propagate with `?`.

### 1.7 Logging: tracing (DECIDED)
**Decision**: `tracing` crate with `tracing-subscriber` + `tracing-appender` for file rotation.
**Rationale**: No objections from any team member. Backend adds `#[tracing::instrument]` on Tauri command handlers.
**Frontend logging**: Lightweight wrapper. Console in dev, forward critical errors to Rust in prod.

### 1.8 IPC: No TCP Fallback (DECIDED)
**Decision**: Unix socket + named pipe only. No TCP fallback.
**Rationale**: Backend's security argument is correct. TCP opens a network surface. Named pipe ACLs provide proper security on Windows. If `interprocess` has bugs, we fix upstream, not fall back to TCP.
**Multi-instance**: PID-based socket naming with a discovery file listing active sessions.

### 1.9 Session Persistence: JSON for MVP, Trait-Based Storage (DECIDED)
**Decision**: JSON persistence for MVP. Storage behind a trait (`PersistenceBackend`) so we can swap to SQLite later if needed.
**Atomic writes**: Backend's temp file + fsync + rename pattern is the implementation standard.
**Crash recovery**: Phase 3a includes basic crash recovery (detect unclean shutdown, restore from last save).

### 1.10 Shared Protocol Crate: Defer to Phase 7 (DECIDED)
**Decision**: IPC types live in `src-tauri` for Phases 1-6. Extract `obelisk-protocol` crate when CLI needs them in Phase 7.
**Rationale**: PM's YAGNI argument. Backend wants to include workspace types too, which strengthens the eventual crate. But building it before the CLI exists is premature.
**Phase 7 scope**: When extracting, include both IPC protocol types AND workspace/pane/surface data types.

---

## 2. Testing Infrastructure Requirements

### 2.1 Phase 0: Non-Negotiable (DECIDED)
**Decision**: Test infrastructure is the first deliverable. It is part of Phase 1's first PR, not a separate phase.
**Rationale**: PM's point about avoiding waterfall gates is valid. QA's point about infrastructure-first is valid. Compromise: Phase 1's first PR is exclusively infrastructure (CI + mocks + coverage + fixtures). No feature code until that PR is green. This satisfies QA's "no feature code without infrastructure" requirement without adding a formal Phase 0.

### 2.2 Coverage Targets (DECIDED)
**Decision**:
- **Rust**: 95% overall CI gate. 100% mandatory on business logic modules (`pty/`, `workspace/`, `ipc_server/protocol.rs`, `osc_parser.rs`, `persistence.rs`). Platform-specific code tested on its platform.
- **React**: 95% overall CI gate. 100% on stores and hooks. 90% minimum on components.
- **E2E**: All PRD phase verification scenarios automated.

**Rationale**: This resolves the QA (100%) vs PM/Backend (95%) debate. 95% as the blocking CI gate prevents flapping on trivial uncovered lines (match arms, entry points, platform-specific branches on wrong OS). 100% on business logic ensures the critical code is fully tested. QA's intent is honored; PM's practicality is preserved.

**Coverage exclusion policy**: `#[cfg(not(tarpaulin_include))]` is allowed only on entry point glue code (Tauri builder pattern in `main.rs`/`lib.rs`). Must be justified in code review. Cannot be used on business logic.

### 2.3 Cross-Platform CI (DECIDED)
**Decision**:
- **Every PR**: Linux (full test suite + coverage) + macOS (full test suite, no coverage).
- **Nightly**: Windows (full test suite). If a Windows failure is found, a platform-specific regression test is added to the PR suite.
- **Release branches**: Full suite on all 3 OSes.
- **E2E**: Linux on every PR. All 3 OSes on merge to main.

**Rationale**: Backend's cost-conscious proposal is correct. Windows CI is slow and expensive. Nightly catches Windows issues within 24 hours. Once a Windows issue is found and fixed, the regression test ensures it never recurs in PR CI.

### 2.4 E2E Framework: Playwright (DECIDED)
**Decision**: Playwright for all E2E tests, using `tauri-driver` for full-app tests.
**Rationale**: QA's argument is compelling — first-class TypeScript support, auto-wait, built-in screenshot comparison, team familiarity.

### 2.5 E2E Retry Policy (DECIDED)
**Decision**: 0 retries for unit and integration tests. 1 retry for E2E tests. Any E2E test retrying >5% of runs triggers investigation.
**Rationale**: Frontend's argument about inherent E2E flakiness (browser startup, WebDriver connection, WebGL init) is valid. One retry is a reasonable safety valve without hiding real bugs.

### 2.6 Flaky Test Protocol (DECIDED)
**Decision**: Flaky test -> immediate quarantine (`#[ignore]` / `test.skip`) -> issue filed -> fix within 48 hours -> restore. No `#[ignore]` without a linked issue.

### 2.7 Visual Regression (DECIDED)
**Decision**: Defer to Phase 5+ when UI is stable. Use Playwright screenshots, not Chromatic/Percy. Per-platform baselines required.
**Rationale**: PM's argument that early-stage UI changes too fast for visual regression baselines to be meaningful.

### 2.8 PTY Testing Strategy (DECIDED)
**Decision**: Both mock and real PTY tests required.
- **Unit tests**: `MockPtyBackend` via mockall for manager logic.
- **Integration tests**: Real PTY for lifecycle (spawn, read, write, resize, kill, exit detection).
- **Real PTY test list** (from QA):
  - spawn + read prompt
  - write echo + read output
  - rapid writes (100 commands)
  - large output (1MB)
  - resize + verify columns
  - kill during read
  - shell exit + cleanup
  - concurrent PTYs (10 simultaneous)
- **Timing handling**: Poll with timeout for PTY output assertions (not sleep, not single assert).

### 2.9 Property-Based Testing (DECIDED)
**Decision**: `proptest` for OSC parser (never panics, forwards all bytes, extracts known patterns), base64 roundtrip, workspace state invariants, persistence serialization roundtrip.

---

## 3. Coding Standards

### 3.1 Rust Standards
```
- Edition 2021
- clippy::pedantic enabled (with reasonable allows)
- cargo fmt enforced in CI
- No .unwrap() in production code
- thiserror for all error types
- tracing for all logging (no println!, no log crate)
- #[tracing::instrument] on all Tauri command handlers
- Traits for all external interfaces (PtyBackend, PersistenceBackend, EventEmitter)
- tokio::sync::RwLock for state accessed in async contexts
- serde(rename_all = "camelCase") on all types crossing the bridge
```

### 3.2 TypeScript Standards
```
- strict mode in tsconfig.json
- ESLint with recommended + React rules
- No `any` types (use `unknown` and narrow)
- Zustand selectors for all store subscriptions
- React.memo on all leaf components
- RefCallback (not useRef) for xterm.js container
- Every invoke() call in try/catch or .catch()
- Clean up all Tauri event listeners on unmount
- Dispose all xterm.js instances on unmount
```

### 3.3 Git Standards
```
- Conventional commits: feat:, fix:, test:, refactor:, docs:, chore:
- TDD visible in commits: "test: add X tests" then "feat: implement X"
- Cargo.lock and bun.lockb committed
- No force pushes to main
- PRs require: tests, CI green, code review, "Test Plan" section
```

### 3.4 Naming Conventions
```
Rust: snake_case functions/vars, PascalCase types/traits/enums, SCREAMING_SNAKE constants
TypeScript: camelCase functions/vars, PascalCase components/types/interfaces
Files: kebab-case for TS, snake_case for Rust
Tauri commands: snake_case (pty_spawn, workspace_create)
Tauri events: kebab-case with ID suffix (pty-data-{id}, workspace-changed)
Stores: useXxxStore
Hooks: useXxx
```

---

## 4. CI/CD Pipeline Design

### Phase 1 CI (First PR)
```yaml
name: CI
on: [push, pull_request]

jobs:
  rust-lint:
    runs-on: ubuntu-latest
    steps:
      - cargo fmt --check
      - cargo clippy --workspace -- -D warnings
      - cargo audit

  rust-test-linux:
    runs-on: ubuntu-latest
    steps:
      - cargo test --workspace
      - cargo llvm-cov --workspace --fail-under 95

  rust-test-macos:
    runs-on: macos-latest
    steps:
      - cargo test --workspace

  frontend-check:
    runs-on: ubuntu-latest
    steps:
      - bun install
      - bun run typecheck
      - bun run lint
      - bun test --coverage  # threshold: 95%

  build:
    needs: [rust-lint, rust-test-linux, frontend-check]
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - bun tauri build
```

### Nightly CI (Windows + Full E2E)
```yaml
name: Nightly
on:
  schedule:
    - cron: '0 4 * * *'

jobs:
  rust-test-windows:
    runs-on: windows-latest
    steps:
      - cargo test --workspace

  e2e-all-platforms:
    strategy:
      matrix:
        os: [ubuntu-latest, macos-latest, windows-latest]
    runs-on: ${{ matrix.os }}
    steps:
      - bun tauri build
      - bun run test:e2e
```

---

## 5. Performance Budgets

| Metric | Target | Measurement |
|--------|--------|-------------|
| PTY throughput | >50 MB/s | criterion bench: read + base64 encode |
| Pipeline latency (typical) | <5ms | PTY write -> xterm.js render |
| Pipeline latency (bulk) | <50ms per 16KB frame | Benchmark harness |
| End-to-end pipeline | <16ms per frame | Combined Rust + Frontend |
| Event serialization | <10us per event | criterion bench |
| App cold start | <2s | E2E measurement |
| Workspace switch | <100ms | E2E measurement |
| Split pane | <200ms | E2E measurement |
| Memory per terminal | <20MB | xterm.js + scrollback |
| Memory growth (1hr, 10 terminals) | <10% | Long-running profiling |

---

## 6. The Rust <-> React Contract (Final)

### Commands (React -> Rust)

All commands are async. All return `Result<T, BackendError>`. Error shape: `{ kind: string, message: string }`.

| Command | Args | Return | Phase |
|---------|------|--------|-------|
| `pty_spawn` | `{ shell?, cwd?, env? }` | `{ ptyId }` | 1 |
| `pty_write` | `{ ptyId, data }` | `void` | 1 |
| `pty_resize` | `{ ptyId, cols, rows }` | `void` | 1 |
| `pty_kill` | `{ ptyId }` | `void` | 1 |
| `workspace_create` | `{ name?, cwd? }` | `WorkspaceInfo` | 2 |
| `workspace_close` | `{ workspaceId }` | `void` | 2 |
| `workspace_list` | `{}` | `WorkspaceInfo[]` | 2 |
| `pane_split` | `{ paneId, direction, shell? }` | `{ newPaneId, ptyId }` | 2 |
| `pane_close` | `{ paneId }` | `void` | 2 |
| `session_save` | `{}` | `void` | 3a |
| `session_restore` | `{}` | `WorkspaceInfo[]` | 3a |
| `notification_list` | `{ paneId? }` | `Notification[]` | 4 |
| `notification_mark_read` | `{ notificationId }` | `void` | 4 |

### Events (Rust -> React)

| Event | Payload | Frequency | Phase |
|-------|---------|-----------|-------|
| `pty-data-{ptyId}` | `{ data }` (base64) | <=60/sec per PTY | 1 |
| `pty-exit-{ptyId}` | `{ exitCode?, signal? }` | Once | 1 |
| `workspace-changed` | `{ workspaceId, changeType, state }` | On structural mutation | 2 |
| `notification` | `{ id, paneId, workspaceId, title, body?, oscType, timestamp }` | On OSC detection | 4 |
| `git-info-{paneId}` | `{ branch?, isDirty, ahead, behind }` | On change | 3b |
| `ports-changed-{paneId}` | `{ ports: [{ port, pid?, processName? }] }` | On change | 3b |

### Optimistic Updates Policy
**No optimistic updates on structural changes.** Local roundtrip is <5ms. Wait for Rust confirmation via `workspace-changed` event. Optimistic updates only for UI-local state (focus, scroll, panel open/close).

---

## 7. Error Handling Patterns

### Rust Side
```rust
// Per-module errors
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
}

// Top-level BackendError with From impls
#[derive(Debug, thiserror::Error)]
pub enum BackendError {
    #[error(transparent)]
    Pty(#[from] PtyError),
    #[error(transparent)]
    Workspace(#[from] WorkspaceError),
    // ...
}

// Serialize for frontend consumption
impl Serialize for BackendError {
    fn serialize<S>(&self, s: S) -> Result<S::Ok, S::Error> { ... }
    // Output: { "kind": "PtyNotFound", "message": "not found: abc-123" }
}
```

### Frontend Side
```typescript
// Error boundary per pane
<PaneErrorBoundary paneId={pane.id}>
  <PaneWrapper ... />
</PaneErrorBoundary>

// Structured error handling on invoke
try {
  await tauriBridge.pty.spawn(args);
} catch (e) {
  const err = e as BackendError;
  handlePtyError(err);
}
```

---

## 8. Final Revised Phase Plan

### Phase 1: Infrastructure + Core Terminal
**First PR (infrastructure only)**:
- Tauri v2 project scaffold
- Cargo workspace (`src-tauri`, `cli` placeholder)
- GitHub Actions CI (lint, test, build on Linux + macOS)
- Coverage enforcement (95% gate)
- Vitest + React Testing Library configured
- Tauri API mock + xterm.js mock
- `justfile` with `dev`, `test`, `lint`, `build` targets
- Pre-commit hooks

**Feature PRs**:
- `PtyBackend` trait + `RealPtyBackend` (portable-pty)
- `PtyManager` with spawn/write/resize/kill
- Tauri commands: `pty_spawn`, `pty_write`, `pty_resize`, `pty_kill`
- PTY read thread with event emission
- `TerminalPane` + `useTerminal` hook
- Base64 bidirectional data flow
- Terminal resize (FitAddon + ResizeObserver)
- WebGL with canvas fallback
- PTY throughput benchmark (criterion)

**Acceptance**: `bun tauri dev` -> working terminal on Linux, macOS. Benchmark baseline established.

### Phase 2: Workspaces + Split Layout + Keybindings
- Rust workspace state model (Workspace, Surface, Pane, LayoutNode)
- Tauri commands: `workspace_create`, `workspace_close`, `workspace_list`, `pane_split`, `pane_close`
- `workspace-changed` event emission
- `workspaceStore` (single store, mirrors Rust state)
- `uiStore` (focus, sidebar, panel open/close)
- `Sidebar` + `SidebarWorkspaceItem`
- `SurfaceTabBar`
- `PaneSplitter` recursive layout renderer
- `PaneWrapper` with type discriminator
- `PaneErrorBoundary`
- Basic keyboard shortcuts (split, close, navigate, switch workspace)

**Acceptance**: Multiple workspaces, split panes, surface tabs, keyboard navigation. E2E tests pass.

### Phase 3a: Layout Persistence (MVP Boundary)
- Rust persistence module with `PersistenceBackend` trait
- JSON serialization of workspace state
- Atomic file writes (temp + fsync + rename)
- Save on close, restore on launch
- Corrupted file recovery (fall back to default)
- Autosave every 30s
- Clean shutdown marker for crash detection

**Acceptance**: Close app, reopen -> layout restored. Kill app (unclean), reopen -> last autosave restored.

### Phase 3b: Metadata + Scrollback
- Scrollback serialization (SerializeAddon -> compressed file per pane)
- Git info polling (every 3-5s)
- Port scanning
- Sidebar metadata display

**Acceptance**: Close app, reopen -> scrollback visible. Git branch shows in sidebar.

### Phases 4-8: As revised in Round 2
- Phase 4: Notifications (OSC parser + notification UI)
- Phase 5: Browser panels (iframe + multi-webview)
- Phase 6: Command palette + keybinding customization
- Phase 7: CLI + IPC (extract `obelisk-protocol` crate)
- Phase 8a: Theming + font customization
- Phase 8b: Packaging + distribution

---

## 9. Resolved Open Questions

| Question | Resolution | Owner |
|----------|-----------|-------|
| WebGL context limit | Canvas fallback for non-visible terminals. Pool WebGL contexts for visible terminals only. Implement in Phase 1. | Frontend |
| IPC authentication | Defer to Phase 7. Local-only risk is acceptable for MVP. | Backend |
| Scrollback size default | 5000 lines. Configurable in settings. Profile memory in QA. | Frontend + QA |
| Process group / Job Objects | Phase 1 requirement for orphan prevention. Non-negotiable for clean PTY lifecycle. | Backend |
| workspace-changed full state vs granular | Full state replacement. Payload is small (KB). Simplifies frontend and testing. | Backend + Frontend |
| ts-rs vs specta | Evaluate both in Phase 0 infrastructure PR. Prefer specta if Tauri integration is smooth. | Tech Lead |
| Error type ownership | Backend owns Rust error types. Frontend owns error handling UI. Contract (kind + message) is the interface. | Backend + Frontend |
| Quality gates | Gates apply to merging to main, not to starting work on next phase. | QA + PM |
| Coverage threshold | 95% CI gate. 100% on business logic modules. See section 2.2. | QA |
| Store architecture | 2 stores (workspaceStore + uiStore). See section 1.2. | Frontend |

---

## 10. Risk Mitigation Summary

| Risk | Mitigation | Status |
|------|-----------|--------|
| PTY throughput bottleneck | Benchmark in Phase 1, batching design ready to deploy | PLANNED |
| Tauri unstable multi-webview | Iframe-only for Phases 1-4, multi-webview optional in Phase 5 | DEFERRED |
| portable-pty maintenance | PtyBackend trait abstraction, swap-ready | DESIGNED |
| Type drift Rust/TS | ts-rs or specta auto-generation | PHASE 0 |
| ConPTY Windows quirks | Nightly CI on Windows, platform regression tests | PLANNED |
| xterm.js memory leaks | Disposal tests on every terminal component, memory profiling in QA | PLANNED |
| IPC socket collisions | PID-based naming + discovery file | DESIGNED |
| Orphaned processes | Process groups (Unix) + Job Objects (Windows) from Phase 1 | PHASE 1 |
| Crash data loss | Atomic writes + autosave + crash recovery | PHASE 3a |
| State desync Rust/React | Single source of truth (Rust), full state events, no optimistic structural updates | DECIDED |
