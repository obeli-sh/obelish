# Round 3: Senior PM — Final Consensus and Recommendations

---

## 1. Resolved Debates

After three rounds, here are my final calls on the open debates. I am making pragmatic decisions — not everyone will be happy, but every decision has clear rationale and a path to revisit if circumstances change.

### 1.1 Coverage Threshold: 95% gate, 100% target

**Decision: 95% line coverage as the CI gate. 100% on core business logic modules.**

QA wants 100% enforced. Backend and I proposed 95%. The tech lead landed at 95% gate with 100% target. Here is the final ruling:

- **Rust CI gate: 95% line coverage** via `cargo-llvm-cov --fail-under 95`
- **Rust per-module mandate: 100%** on `pty/`, `workspace/`, `osc_parser`, `ipc_server/protocol.rs`, `persistence.rs` — enforced by per-module coverage checks in CI
- **React CI gate: 95% line coverage** via Vitest thresholds
- **React per-category mandate: 100%** on stores and hooks. **90% minimum** on components.
- **E2E: No coverage metric.** Instead, a checklist of mandatory user journeys that must pass.

**Rationale**: 100% as a hard gate causes CI to flap on trivial uncovered lines (match arms, entry points, platform-specific code that can only run on one OS). 95% keeps us honest. The per-module mandates ensure the critical code is fully covered. QA gets rigor where it matters; the team does not waste time writing tests to cover unreachable code.

**Revisit trigger**: If we find bugs in production that would have been caught by the missing 5%, we tighten the gate.

### 1.2 E2E Retry Policy: 1 retry for E2E only

**Decision: 0 retries for unit/integration tests. 1 retry for E2E tests.**

QA wants 0 retries everywhere. Frontend argues E2E flakiness is inherent (browser startup, WebDriver timing, WebGL init). I side with Frontend on this:

- Unit and integration tests: **0 retries**. If they're flaky, they're quarantined immediately.
- E2E tests: **1 retry** in CI. Any test that retries more than 5% of runs across a 2-week window gets quarantined and must be fixed within 48 hours.

**Rationale**: E2E tests interact with real OS resources (window management, GPU, filesystem). Denying any retry means CI will block legitimate merges on one-off OS hiccups. One retry is a pragmatic safety valve.

### 1.3 Event Design: Single `workspace-changed` with full state

**Decision: Single `workspace-changed` event emitting full `WorkspaceState`.**

Frontend proposed this. Backend agreed and added a `change_type` field (which is useful for logging/debugging). Tech lead proposed it in the contract. This is consensus.

- Frontend replaces the entire workspace projection in the store on each event.
- Zustand selectors handle re-render optimization.
- If the workspace grows to 50+ panes and serialization becomes measurable overhead, we revisit with granular events. For MVP (realistically 2-10 panes), full state replacement is fine.

### 1.4 Shared Protocol Crate Timing: Phase 2, not Phase 1 or Phase 7

**Decision: Create `obelisk-protocol` in Phase 2.**

I originally said Phase 7. Tech lead and backend want Phase 1. Here is the compromise:

- Phase 1 has only PTY commands. There is no IPC, no CLI, no workspace commands in Rust yet. A shared crate with 3 types is overhead.
- Phase 2 introduces workspace state structs (`WorkspaceInfo`, `SurfaceInfo`, `PaneInfo`, `LayoutNode`) that will definitely be reused by the CLI later. This is the natural extraction point.
- The crate starts small: just the shared data types. IPC protocol types (`RpcRequest`, `RpcResponse`) get added in Phase 7 when the CLI needs them.

**Rationale**: Phase 2 is when the type surface area grows past the threshold where manual sync becomes risky. Not too early (Phase 1), not too late (Phase 7).

### 1.5 Store Architecture: 2 stores

**Decision: 2 Zustand stores: `workspaceStore` + `uiStore`.**

Tech lead proposed this in Round 2, backend agreed. Frontend originally wanted 4 stores but the "mirror store" argument is strong: since Rust is the source of truth and emits full state via `workspace-changed`, having 3 separate stores that parse the same event payload into 3 slices creates coordination complexity for no benefit. Two stores:

- **`workspaceStore`**: Direct projection of Rust's `WorkspaceState`. Updated on each `workspace-changed` event. Read-only from the frontend's perspective (all mutations go through `invoke()`).
- **`uiStore`**: Frontend-only state: `focusedPaneId`, `sidebarOpen`, `notificationPanelOpen`, `searchState`, scroll positions.

If performance profiling shows that the `workspaceStore` causes excessive re-renders in specific components despite Zustand selectors, we can extract slices at that point — with data, not theory.

### 1.6 Phase 0 vs "First PR of Phase 1"

**Decision: Phase 0 is the first PR of Phase 1. Not a separate phase.**

QA, tech lead, and backend all want "Phase 0" for test infrastructure. I agree it must be built first, but I refuse to create a separate phase with its own quality gate, timeline, and tracking overhead. Here is what actually happens:

- **Phase 1, PR #1**: Project scaffold + CI pipeline + test infrastructure + mocks + coverage enforcement. Zero feature code. This PR must be green on all 3 OS runners before anything else merges.
- **Phase 1, PR #2+**: Feature work (PTY manager, terminal pane, etc.), all TDD.

The practical outcome is identical to QA's "Phase 0." The difference is project management overhead — one fewer phase to track, one fewer gate to manage. Call it Phase 0 internally if it makes QA happy, but on the timeline it is Phase 1 work.

---

## 2. Final Consensus Items (Unanimous or Strong Majority)

These are decided. No further debate needed.

| Decision | Status | Supporting Roles |
|----------|--------|-----------------|
| Rust as single source of truth for structural state | **Decided** | All 5 roles |
| `PtyBackend` trait for testability | **Decided** | Tech Lead, Backend, QA |
| `ts-rs` for Rust-to-TypeScript type generation | **Decided** | Tech Lead, Frontend, Backend |
| Keyboard shortcuts move to Phase 2 | **Decided** | PM, Frontend, Tech Lead |
| Phase 3 splits into 3a (layout persistence) and 3b (metadata + scrollback) | **Decided** | PM, Backend, Tech Lead |
| `tracing` crate for Rust logging from day 1 | **Decided** | Tech Lead, Backend |
| `thiserror` for typed errors, no `anyhow` in library code | **Decided** | Backend, Tech Lead |
| Structured error payloads `{ kind, message }` to frontend | **Decided** | Backend, Frontend |
| Playwright for E2E (not WebdriverIO) | **Decided** | QA, Frontend |
| WebGL fallback to canvas mandatory | **Decided** | Frontend, Tech Lead |
| Base64 encoding for PTY data, benchmark in Phase 1 | **Decided** | All roles |
| Dedicated `std::thread` per PTY for reads | **Decided** | Backend, Tech Lead |
| No optimistic updates for structural mutations | **Decided** | Frontend, Backend |
| No TCP fallback for IPC — Unix socket / named pipe only | **Decided** | Backend (strong), Tech Lead |
| Atomic file writes for persistence | **Decided** | Backend, QA |
| Process groups (Unix) + Job Objects (Windows) from Phase 1 | **Decided** | Backend |
| `just` (justfile) for cross-language orchestration | **Decided** | Tech Lead, Backend |
| Pre-commit hooks for test enforcement | **Decided** | QA |
| Conventional commits (`feat:`, `test:`, `fix:`, etc.) | **Decided** | Tech Lead |

---

## 3. Risk Mitigation Strategies

| Risk | Severity | Mitigation | Owner |
|------|----------|------------|-------|
| PTY throughput bottleneck | High | Benchmark harness in Phase 1. Target: <16ms per frame pipeline. If base64+JSON is too slow, investigate Tauri binary event channels. | Backend |
| `portable-pty` becomes unmaintained | Medium | `PtyBackend` trait as abstraction layer. Pin known-good version. | Backend |
| WebGL context limit (8-16 per page) | Medium | Canvas fallback when WebGL fails. Only active/visible terminals get WebGL. Implement in Phase 1. | Frontend |
| Cross-platform PTY behavioral differences | High | CI matrix on all 3 OSes from Phase 1. Platform-specific integration tests. | QA + Backend |
| Type drift between Rust and TypeScript | High | `ts-rs` auto-generation from Phase 2. Contract tests for command invocations. | Tech Lead |
| Tauri `unstable` multi-webview breaks | Medium | Iframe-only for MVP. Multi-webview behind feature flag, Phase 5 only. | Tech Lead |
| Session state corruption | Medium | Atomic writes, `.bak` files, graceful fallback to default state. | Backend |
| xterm.js memory leaks | Medium | Strict lifecycle: `.dispose()` on unmount, event listener cleanup. Mandatory cleanup tests for every component. | Frontend + QA |
| Recursive split re-render performance | Medium | `React.memo` on `PaneWrapper`, Zustand selectors. Prototype in isolated test before integration. | Frontend |
| CI flakiness blocking merges | Medium | 0 retries for unit/integration, 1 retry for E2E. Quarantine protocol: fix within 48h or delete. | QA |

---

## 4. MVP Scope — Locked Down

**MVP = Phase 1 + Phase 2 + Phase 3a**

Delivers: A cross-platform terminal multiplexer where a user can:
1. Open the app and get a working terminal
2. Create multiple workspaces
3. Split panes horizontally and vertically
4. Navigate panes and workspaces via keyboard shortcuts
5. Close and reopen the app with layout preserved

This is the minimum viable product. Everything else is enhancement.

### What is NOT in MVP:
- Scrollback persistence (Phase 3b)
- Git/port metadata display (Phase 3b)
- Notifications / OSC parsing (Phase 4)
- Browser panels (Phase 5)
- Command palette / keybinding customization (Phase 6)
- CLI / IPC (Phase 7)
- Theming / font customization / packaging (Phase 8)

### MVP Acceptance Criteria:
1. `bun tauri dev` launches on macOS, Linux, and Windows
2. Terminal renders, accepts input, shows shell output
3. Terminal throughput benchmark passes (>50 MB/s or <16ms per frame)
4. User can create multiple workspaces via keyboard shortcut
5. User can split panes horizontally and vertically
6. User can navigate between panes with keyboard
7. Closing the app and reopening restores the layout
8. All tests pass on all 3 platforms in CI
9. Coverage meets thresholds (95% overall, 100% on core modules)
10. No known P0 bugs

---

## 5. Testing Investment Recommendations Per Phase

| Phase | TDD Intensity | Test Types | Coverage Focus |
|-------|--------------|------------|----------------|
| Phase 1 (Core Terminal) | **Maximum** — this is the foundation. Every PTY operation test-first. | Unit (PtyManager, useTerminal), Integration (real PTY lifecycle), E2E (app launches, terminal works), Benchmark (throughput) | 100% on `pty/`, `useTerminal`, `tauri-bridge` |
| Phase 2 (Workspaces + Layout) | **High** — state management and layout are complex. | Unit (stores, PaneSplitter, Sidebar), Integration (cross-store, split cascades), E2E (workspace CRUD, keyboard nav) | 100% on stores, hooks. 90%+ on components |
| Phase 3a (Persistence) | **High** — data integrity is critical. | Unit (serialize/deserialize, atomic write), Integration (save/restore round-trip), E2E (close → reopen) | 100% on `persistence.rs` |
| Phase 3b (Metadata) | **Medium** — less critical, more cosmetic. | Unit (git parser, port parser, SerializeAddon integration), Integration (polling cycle) | 95% on metadata modules |
| Phase 4 (Notifications) | **High** — parser correctness is critical. | Unit (OSC parser exhaustive), Property-based (arbitrary bytes), Integration (PTY → parser → store → UI) | 100% on `osc_parser.rs` |
| Phase 5 (Browser) | **Low** — mostly integration with iframe/webview. | Integration (URL navigation), E2E (browser pane renders, toolbar works) | 90% on browser components |
| Phase 6 (Command Palette) | **Medium** — UI-heavy, well-understood patterns. | Unit (fuzzy search, shortcut resolution), E2E (palette opens, executes commands) | 95% |
| Phase 7 (CLI + IPC) | **High** — protocol correctness and IPC reliability matter. | Unit (protocol parsing), Integration (socket lifecycle, command dispatch), Stress (concurrent connections, malformed input) | 100% on `ipc_server/`, `protocol`, CLI binary |
| Phase 8 (Polish) | **Low** — visual and packaging work. | Visual regression (Playwright screenshots), Smoke tests (built artifacts launch) | N/A |

---

## 6. Final Phase Breakdown

### Phase 1: Project Scaffold + Core Terminal
**PR #1**: Scaffold + CI + test infrastructure + mocks
**PR #2+**: PTY engine, terminal rendering, data flow, benchmarks

### Phase 2: Workspaces + Split Layout + Navigation
Workspace model, sidebar, split panes, surface tabs, keyboard shortcuts
Create `obelisk-protocol` crate for shared types

### Phase 3a: Layout Persistence (MVP boundary)
Save/restore layout, atomic writes, crash recovery

### Phase 3b: Metadata + Scrollback
Git info, port scanning, scrollback serialization

### Phase 4: Notifications
OSC parser, notification store, UI (badges, panel, blue ring), OS notifications

### Phase 5: Browser Panels
Iframe browser pane, toolbar, multi-webview (feature-flagged)

### Phase 6: Command Palette + Customization
Fuzzy search palette, keybinding customization UI, settings modal

### Phase 7: CLI + IPC
IPC server, JSON-RPC protocol, CLI binary with clap

### Phase 8a: Theming + Font Customization
Dark/light/system themes, terminal font settings

### Phase 8b: Packaging + Distribution
macOS .dmg, Windows .msi, Linux AppImage/.deb, auto-updater

---

## 7. Remaining Risks That Cannot Be Fully Mitigated

These are risks we accept and monitor:

1. **Tauri v2 ecosystem maturity**: Tauri v2 stable was released in late 2024. Plugin ecosystem is still catching up. We may hit gaps that require writing custom plugins or workarounds. Mitigation: budget time for Tauri-specific troubleshooting.

2. **xterm.js + WebGL across diverse hardware**: WebGL rendering on Linux varies wildly depending on GPU drivers. Some users will get canvas fallback. This is acceptable — canvas is slower but functional.

3. **Windows ConPTY edge cases**: ConPTY has known bugs with certain escape sequences. We test with common tools (vim, htop, etc.) but we cannot test every TUI application. Users will report edge cases.

4. **Team velocity on TDD**: The 15-30% overhead QA cited is real. We accept this cost because the alternative (shipping buggy PTY handling in a multiplexer) is worse. But stakeholders should know the velocity impact.

---

## 8. Decision Ownership

| Area | Owner | Backup |
|------|-------|--------|
| Rust architecture (PTY, state, IPC) | Backend | Tech Lead |
| React architecture (components, stores, hooks) | Frontend | Tech Lead |
| CI/CD pipeline | Tech Lead | QA |
| Test strategy and coverage enforcement | QA | Tech Lead |
| Scope and priority | PM | — |
| Cross-platform issues | Backend (Rust) + Frontend (rendering) | QA (testing) |
| Error type definitions | Backend | Tech Lead |
| Tauri bridge contract (`ts-rs`, commands, events) | Tech Lead | Backend + Frontend |

---

## 9. What I Want in the Final Phase Plans

The final phase documents (Phase 1 and Phase 2) must include:

1. **Concrete deliverables** — not "implement PTY manager" but "implement `PtyManager` with `spawn()`, `write()`, `resize()`, `kill()` methods behind `PtyBackend` trait"
2. **TDD sequence** — which tests are written first, what do they test, what is the implementation order
3. **Acceptance criteria** — measurable, not subjective
4. **Test counts** — minimum number of unit, integration, and E2E tests per component
5. **Risk callouts** — what could go wrong in this specific phase and how we handle it
6. **Cross-platform notes** — what behaves differently on Windows/Mac/Linux

This is what ships. The debates are over. Time to build.
