# Round 2: Senior Tech Lead — Cross-Role Debate and Technical Standards

## 1. Mediating Frontend vs Backend: Source of Truth

The **most important architectural agreement** from Round 1 is that both Frontend (section 2) and Backend (section 5) independently arrived at the same conclusion: **Rust must be the source of truth** for structural state.

I'm formalizing this as the first technical standard:

**STANDARD: Rust owns all structural state (workspaces, surfaces, panes, PTY associations). React stores are read projections synced via Tauri events. All mutations flow through `invoke()` to Rust, which emits state-change events back.**

Frontend owns UI-local state only: focus tracking, scroll positions, search state, panel open/closed. These never need persistence or CLI visibility.

### Resolving the Zustand Question
The Frontend proposes splitting `workspaceStore` into 4 stores (workspace, layout, pane, focus). I **partially agree**:
- `focusStore` should stay separate (pure UI state).
- But `workspaceStore`, `layoutStore`, and `paneStore` are all projections of the same Rust state. Splitting them into 3 stores creates synchronization complexity between React stores. Instead, I propose:
  - **One `workspaceStore`** that mirrors the Rust workspace tree structure, updated as a whole on each Rust event.
  - **One `uiStore`** for focus, scroll, panel open/closed.
  - Use Zustand selectors for fine-grained subscriptions to prevent unnecessary re-renders, as Frontend correctly suggested.

This keeps the architecture simple while achieving the re-render optimization Frontend needs.

---

## 2. Responding to PM's Scope Concerns

### PM says: "Lock MVP to Phases 1-3."
**I agree 100%.** The PM's prioritization is sound. Phases 1-3 give us a usable terminal multiplexer. Everything else is enhancement.

### PM says: "Move keyboard shortcuts into Phase 2."
**I agree.** A multiplexer without keyboard-driven pane navigation is broken. Basic shortcuts (split, close pane, switch workspace, navigate between panes) are part of the core multiplexer functionality, not polish. Phase 6 should only cover the command palette, fuzzy search, and customization UI.

### PM says: "Split Phase 3 into 3a (layout persistence) and 3b (scrollback + metadata)."
**I agree.** Layout persistence is straightforward (serialize the Rust workspace state to JSON). Scrollback serialization and git/port scanning are independent features with different complexity profiles. Splitting them lets us ship persistence sooner and iterate on metadata later.

### PM says: "Phase 8 is too vague."
**I agree.** Theming is a UI task. Packaging is CI/DevOps. Font customization is a settings task. These should be separate items, not a catch-all "polish" phase. However, for planning purposes, grouping them as "post-MVP polish" is fine — the important thing is that each has clear acceptance criteria.

### PM's concern about `portable-pty` health:
The PM is right to flag this. Backend's analysis (section 1) confirms that portable-pty is the best option available. The `PtyBackend` trait abstraction that I proposed in Round 1 (and Backend independently proposed) serves as our insurance policy — if portable-pty becomes unmaintained, we can swap in a different implementation behind the same trait.

---

## 3. Addressing QA's Testing Infrastructure

### Phase 0: Test Infrastructure
QA's proposal for a "Phase 0" is correct — we cannot TDD without test infrastructure. I'm promoting this to a concrete deliverable:

**Phase 0 deliverables** (before any feature work):
1. Cargo workspace with `src-tauri` and `cli` crates
2. `cargo test` running with `tokio::test` support
3. `mockall` integrated for trait mocking
4. `proptest` integrated
5. `cargo-llvm-cov` in CI
6. Vitest configured with jsdom, React Testing Library, coverage-v8
7. Tauri API mock (`__mocks__/@tauri-apps/api/`) for frontend tests
8. xterm.js mock (`__mocks__/@xterm/xterm.ts`) for frontend tests
9. GitHub Actions CI pipeline with Rust + Frontend + cross-platform matrix
10. Pre-commit hooks for test enforcement
11. `just` (justfile) for cross-language task orchestration

### 100% Coverage Target: My Position
QA proposes 100% line coverage. This is **aspirational but needs nuance**:

- **100% is the right target for Rust code.** The Rust side handles PTY management, state, persistence, IPC — all critical paths where bugs are catastrophic. Rust's type system catches many errors, but coverage ensures we exercise all code paths.
- **100% for React code is achievable with caveats.** We should exclude: entry point files (`main.tsx`, `App.tsx` bootstrapping), CSS imports, and type-only files. Everything else should be 100%.
- **For E2E: coverage percentage is meaningless.** Instead, we should have a checklist of critical user journeys that must pass, as QA outlined in section 13.

**STANDARD: Rust coverage >= 95% (target 100%). React coverage >= 95% (target 100%). Both enforced in CI. E2E covers all phase verification scenarios.**

I'm setting 95% as the blocking threshold rather than 100% to avoid CI flapping over trivial uncovered lines (like unreachable arms in match statements), while still requiring extremely high coverage.

### Flaky Test Prevention
QA's "zero retry" policy is correct. I'll add:
- **STANDARD: No `#[ignore]` or `test.skip` in the main test suite without a linked issue.** Quarantined tests must have a 48-hour resolution SLA.
- **STANDARD: All async tests have explicit timeouts.** Rust: `#[tokio::test(flavor = "multi_thread", start_paused = true)]` where applicable. Frontend: `vi.setConfig({ testTimeout: 5000 })`.

---

## 4. Proposing Concrete Technical Standards

Based on all Round 1 inputs, here are the technical standards I'm establishing:

### 4.1 Error Handling
```
STANDARD: Rust errors
- Module-level error enums using `thiserror`
- BackendError as the top-level Tauri command error type
- Every Tauri command returns Result<T, BackendError>
- Internal functions use module-specific errors; convert at command boundary
- Never use .unwrap() in production code (use .expect() with context, or propagate)

STANDARD: Frontend errors
- Every invoke() call wrapped in try/catch or .catch()
- Error boundary around each PaneWrapper
- TauriError type for structured error handling
- Errors logged to Rust via invoke('log_error', ...) for unified log files
```

### 4.2 Logging
```
STANDARD: Use `tracing` crate with structured logging
- tracing-subscriber with EnvFilter for log levels
- Spans for: PTY sessions, IPC connections, workspace operations
- Log to file: Tauri app data dir / logs/ with daily rotation (tracing-appender)
- Frontend: minimal logger, critical errors forwarded to Rust
- Debug builds: RUST_LOG=debug. Release builds: RUST_LOG=info
```

### 4.3 Naming Conventions
```
STANDARD: Rust
- snake_case for functions, variables, modules
- PascalCase for types, traits, enums
- SCREAMING_SNAKE_CASE for constants
- Module structure mirrors file structure

STANDARD: TypeScript
- camelCase for functions, variables
- PascalCase for components, types, interfaces
- kebab-case for file names (components use PascalCase files: TerminalPane.tsx)
- Stores: useXxxStore naming convention
- Hooks: useXxx naming convention

STANDARD: Tauri Commands
- snake_case for command names (pty_spawn, workspace_create)
- snake_case for parameter names (pty_id, workspace_id)
- Events: kebab-case with dynamic ID suffix (pty-data-{id}, pty-exit-{id})
```

### 4.4 Git Workflow
```
STANDARD: Branching
- main: always shippable
- feature/* : feature branches, one per phase task
- fix/* : bug fix branches

STANDARD: Commits
- Conventional commits: feat:, fix:, test:, refactor:, docs:, chore:
- TDD commits should show test-first: "test: add spawn tests" then "feat: implement PtyManager::spawn"
- Every PR requires: tests, passing CI, code review

STANDARD: PRs
- Must include "Test Plan" section
- Must not decrease coverage
- Must pass on all 3 platforms
```

### 4.5 Dependency Management
```
STANDARD:
- Cargo.lock and bun.lockb committed to git
- cargo audit and bun audit in CI
- Workspace dependencies in root Cargo.toml
- Pin major versions of critical deps (tauri, portable-pty, xterm.js)
- No wildcard version ranges
```

---

## 5. Defining the Rust <-> React Contract

### Shared Protocol Types

Both Backend and Frontend agree on `ts-rs` for type generation. Formalizing:

**STANDARD: Use `ts-rs` to auto-generate TypeScript types from Rust structs. Types are generated into `src/lib/generated/types.ts` as a build step. Manual type definitions in `types.ts` are prohibited for any type that has a Rust counterpart.**

### The Contract

#### Commands (React -> Rust)

| Command | Args (Rust struct) | Return | Notes |
|---------|-------------------|--------|-------|
| `pty_spawn` | `PtySpawnArgs { shell?, cwd?, env? }` | `Result<PtyId, BackendError>` | Returns ID, starts read thread |
| `pty_write` | `PtyWriteArgs { id, data }` | `Result<(), BackendError>` | data is base64-encoded |
| `pty_resize` | `PtyResizeArgs { id, cols, rows }` | `Result<(), BackendError>` | cols/rows are u16 |
| `pty_kill` | `PtyKillArgs { id }` | `Result<(), BackendError>` | Kills process, cleans up |
| `workspace_create` | `WorkspaceCreateArgs { name? }` | `Result<WorkspaceState, BackendError>` | Returns full new workspace |
| `workspace_close` | `WorkspaceCloseArgs { id }` | `Result<(), BackendError>` | Kills all PTYs in workspace |
| `pane_split` | `PaneSplitArgs { pane_id, direction }` | `Result<PaneState, BackendError>` | direction: "horizontal" | "vertical" |
| `pane_close` | `PaneCloseArgs { pane_id }` | `Result<(), BackendError>` | Kills associated PTY |
| `session_save` | `()` | `Result<(), BackendError>` | Manual save trigger |

#### Events (Rust -> React)

| Event | Payload | Frequency |
|-------|---------|-----------|
| `pty-data-{id}` | `{ data: string }` (base64) | Up to 60/sec per PTY (batched) |
| `pty-exit-{id}` | `{ code: i32 }` | Once per PTY |
| `workspace-changed` | `WorkspaceState` (full state) | On any structural mutation |
| `notification` | `{ pane_id, title, body, urgency }` | On OSC detection |
| `git-info-{pane_id}` | `{ branch, dirty, pr_number? }` | On change detection |
| `port-info-{pane_id}` | `{ ports: PortInfo[] }` | On change detection |

**Key design decision**: `workspace-changed` emits the full workspace state on every structural mutation, rather than granular events. This simplifies the frontend — just replace the store state. The payload is small (workspace tree JSON). If this becomes a performance issue, we can add granular events later.

---

## 6. Challenging and Defending Architecture Decisions

### Challenge: Base64 encoding for PTY data
Both PM and Frontend flagged this. Backend (section 3) argues the real bottleneck is Tauri event serialization, not base64 itself. I agree with Backend's assessment — but the concern is valid enough to warrant early benchmarking.

**Decision**: Keep base64 for Phase 1. Add a throughput benchmark as a Phase 1 acceptance criterion (PM's recommendation). If throughput is below 50 MB/s, investigate Tauri raw event channels or shared memory alternatives in Phase 2.

### Challenge: react-resizable-panels for deep nesting
Frontend (section 4) raises valid concerns about cascading re-renders. Backend is silent on this (it's purely a frontend concern).

**Decision**: Prototype the split layout in an isolated component test before integrating. Use `React.memo` on `PaneWrapper` and Zustand selectors for fine-grained updates. If react-resizable-panels proves too slow with 6+ deep nesting, we evaluate alternatives (CSS Grid-based custom layout, or `allotment`).

### Challenge: JSON for session storage (vs SQLite)
The PRD says JSON. This is fine for the MVP. But as Backend's persistence analysis (section 6) shows, we need atomic writes, crash recovery, and potentially separate scrollback files. If the state grows complex enough to need queries or migrations, we should be prepared to switch to SQLite.

**Decision**: JSON for MVP (Phases 1-3). Evaluate SQLite for post-MVP if state complexity warrants it. The `persistence.rs` module should be behind a trait so the storage backend is swappable.

### Defend: Dedicated OS threads for PTY reads
Backend (section 2) argues for `std::thread` over `tokio::spawn_blocking`. I fully agree. `portable-pty` is synchronous, and each PTY read is a blocking call. Dedicated threads give us:
- Explicit lifecycle control (we can name the thread, set stack size)
- No dependency on tokio's blocking thread pool sizing
- Clear communication boundary via channels

**Decision**: Confirmed. Dedicated `std::thread` per PTY for reads. Channel-based communication to the async world.

### Defend: Tauri v2 over Electron
Not challenged by anyone — consensus. The binary size, memory footprint, and native integration advantages are clear. The trade-off (smaller ecosystem) is acceptable for our scope.

---

## 7. Technical Debt Decisions

### What we accept as known tech debt for MVP:
1. **Base64 encoding** — may need optimization later, but works for now.
2. **JSON persistence** — may need SQLite later for complex state.
3. **No plugin system** — the IPC server could support plugins, but YAGNI for MVP.
4. **No auto-update** — Tauri has built-in updater, but defer to post-MVP.
5. **No accessibility testing automation** — Frontend raised accessibility concerns, which are valid. For MVP, we implement basic ARIA attributes and keyboard navigation, but defer automated accessibility testing to post-MVP.

### What we refuse as tech debt:
1. **No test infrastructure** — must be Phase 0. Non-negotiable.
2. **No error handling** — every code path must handle errors properly from day 1.
3. **No cross-platform CI** — must run on all 3 platforms from Phase 1.
4. **No type safety at the Rust/React boundary** — ts-rs from day 1.
5. **No PTY cleanup on crash** — process groups / Job Objects from day 1.

---

## 8. Revised Phase Plan (Incorporating Team Feedback)

```
Phase 0: Test Infrastructure + Project Scaffold
  - CI pipeline, test frameworks, mocks, coverage enforcement
  - Cargo workspace, justfile, project structure

Phase 1: Core Terminal
  - PtyBackend trait + RealPtyBackend implementation
  - PtyManager with spawn/write/resize/kill
  - Base64 event pipeline
  - TerminalPane + useTerminal hook
  - PTY throughput benchmark (acceptance criterion: >50 MB/s)
  - Basic keyboard shortcuts for terminal (Ctrl+C, etc.)

Phase 2: Workspaces + Split Layout + Navigation
  - Workspace state model (Rust)
  - Workspace create/close/switch
  - Split panes (horizontal/vertical)
  - Sidebar with workspace list
  - Surface tabs
  - Keyboard shortcuts: split, close pane, navigate panes, switch workspace
  - (Moved from Phase 6: basic keyboard navigation)

Phase 3a: Layout Persistence
  - Session save on close (atomic writes)
  - Session restore on launch (layout, working directories)
  - Crash recovery (clean shutdown marker, .bak files)

Phase 3b: Metadata
  - Scrollback serialization (xterm SerializeAddon)
  - Git info extraction (branch, dirty, PR) → sidebar
  - Port scanning → sidebar
  - File system watching (notify crate) for git changes

Phase 4: Notifications
Phase 5: Browser Panels
Phase 6: Command Palette + Customization
Phase 7: CLI + IPC
Phase 8a: Theming + Font Customization
Phase 8b: Packaging + Distribution
```

---

## 9. Open Questions for Round 3

1. **WebGL context limit**: Frontend says 8-16 contexts per page. With many terminals, this is a real problem. Do we implement context pooling in Phase 1, or accept canvas fallback for non-visible terminals?

2. **IPC authentication**: I proposed a token-based auth for the IPC socket. Is this needed for MVP (Phase 7), or can we defer to post-MVP? The security risk is local-only.

3. **Scrollback size default**: How many lines? xterm.js default is 1000. Frontend suggests 5000-10000. QA needs to test memory impact. What's the right default?

4. **Process group / Job Object**: Backend mentions this for orphan process cleanup. Should this be a Phase 1 requirement, or can we tolerate orphaned processes during development and add it in Phase 2?

5. **`workspace-changed` full state vs granular events**: I proposed full state replacement. If a workspace has 20+ panes, is the serialization overhead of sending the full tree on every pane resize worth worrying about?
