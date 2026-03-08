# Round 2: Frontend Engineer — Cross-Role Debate

## 1. Responding to Backend's Event/Command Contracts

### Agreement: Rust as Source of Truth
Backend and I independently reached the same conclusion: **Rust must own structural state**. This is now consensus across both sides of the bridge. I fully support the backend's proposed mutation flow:

```
Frontend invoke() → Rust mutates state → emits event → Frontend syncs
```

This means the frontend Zustand stores become **read projections**, not authoritative state. The practical implication is significant: **we do NOT need Zustand's `persist` middleware at all.** Persistence is entirely a Rust concern. Frontend stores are ephemeral mirrors.

### Pushback: Optimistic Updates Need Careful Design
Backend says "optimistic updates are fine for UI responsiveness, but must reconcile on event receipt." I partially disagree. For a terminal multiplexer, most operations are fast enough that we should **not** do optimistic updates on structural changes (split, close, create workspace). The roundtrip through Rust will be < 5ms locally — imperceptible to the user. Optimistic updates introduce reconciliation bugs (what if Rust rejects the split because we hit a maximum pane limit?).

**Where optimistic updates ARE appropriate:**
- UI-only state: focus tracking, scroll position, search queries, panel open/close
- These never go to Rust, so there is nothing to reconcile

**Where they are NOT appropriate:**
- Workspace create/close, pane split/close, PTY spawn/kill
- Wait for Rust confirmation via event before updating the store

### Agreement: Event Batching at 60fps
Backend proposes a ring buffer flushing PTY data at ~16ms intervals. This aligns perfectly with my recommendation for `requestAnimationFrame`-based coalescing on the frontend. The combined strategy:
1. **Rust side**: Ring buffer accumulates reads, flushes at 60Hz max
2. **Frontend side**: `useTerminal` writes data directly to xterm.js instance (no React state update), coalesced via `requestAnimationFrame` if multiple events arrive in the same frame

### Challenge: Backend's Command Signatures Need Adjustment
Backend's proposed command signatures use `PtyId` as a custom type:
```rust
async fn pty_write(state: ..., id: PtyId, data: String) -> Result<(), BackendError>
```

On the TypeScript side, `PtyId` serializes to a plain string. The `ts-rs` approach we both agree on will handle this, but I want to explicitly contract that:
- All IDs crossing the bridge are `string` in TypeScript
- Tauri's invoke argument naming must use `camelCase` in TS and `snake_case` in Rust — Tauri handles the conversion automatically via serde rename, but we must verify this in contract tests

### Proposed Frontend Event Contract
Building on backend's event list, here is the complete event subscription map the frontend needs:

| Event | Payload | Frontend Handler |
|-------|---------|-----------------|
| `pty-data-{ptyId}` | `{ data: string }` (base64) | Decode → `terminal.write()` (outside React) |
| `pty-exit-{ptyId}` | `{ code: number }` | Show "Process exited" overlay, update pane state |
| `notification` | `{ id, title, body, paneId, timestamp }` | Update `notificationStore`, show badge/ring |
| `workspace-changed` | `WorkspaceState` | Replace entire workspace projection in store |
| `git-info-{paneId}` | `{ branch, dirty, prNumber? }` | Update sidebar metadata for pane |
| `port-info-{paneId}` | `{ ports: Port[] }` | Update sidebar port list for pane |

**Key addition**: I'm proposing a single `workspace-changed` event that sends the full workspace state instead of fine-grained events (`pane-added`, `pane-removed`, `surface-switched`, etc.). Reasons:
- Simpler to implement and test — one handler, one store update
- Avoids ordering bugs with multiple events for a single user action (e.g., split = add pane + update layout, which is 2 events)
- Full state replacement with shallow comparison in Zustand avoids re-render issues
- The workspace state is small (kilobytes) — no performance concern sending it fully

Backend, do you agree with this simplification?

---

## 2. Challenging / Accepting Tech Lead's Architecture Decisions

### Accepted: `ts-rs` for Type Generation
Both tech lead and I recommended this independently. It should be a Phase 1 deliverable — the build system generates TS types from Rust structs before frontend compilation. This is load-bearing infrastructure.

### Accepted: `tracing` for Rust Logging
Tech lead's recommendation for `tracing` from day 1 is correct. On the frontend side, I propose we create a lightweight `log()` utility that:
- In dev: writes to `console.log` / `console.error`
- In prod: sends critical errors to Rust via a `log_frontend_error` Tauri command

This gives us unified log files without adding heavy frontend logging infrastructure.

### Challenge: Error Recovery Architecture Needs More Frontend Detail
Tech lead correctly flags the PRD's lack of error recovery. I want to make the frontend strategy concrete:

**Error Boundary Hierarchy:**
```
<AppErrorBoundary>          ← Catches fatal app-level errors, shows "restart" screen
  <AppLayout>
    <Sidebar />             ← No error boundary needed (lightweight, stable)
    <WorkspaceContainer>
      <PaneErrorBoundary>   ← Catches per-pane errors
        <PaneWrapper>
          <TerminalPane />  ← Most likely to error (xterm.js, WebGL)
          <BrowserPane />   ← Second most likely (iframe load failures)
        </PaneWrapper>
      </PaneErrorBoundary>
    </WorkspaceContainer>
  </AppLayout>
</AppErrorBoundary>
```

`PaneErrorBoundary` catches errors from a single pane and renders a recovery UI:
- "This terminal encountered an error. [Restart] [Close]"
- Clicking Restart invokes `pty_kill` then `pty_spawn` for the same pane
- Clicking Close invokes `pane_close`

This prevents a single crashing terminal from taking down the entire app.

### Challenge: Shared Protocol Crate is Premature
Tech lead proposes an `obelisk-protocol` crate for IPC types shared between `src-tauri` and `cli`. I think this is correct **but not for Phase 1**. The CLI is Phase 7. Extracting a shared crate now introduces complexity for a consumer that doesn't exist yet. I recommend:
- Phase 1-6: IPC types live in `src-tauri`
- Phase 7: Extract `obelisk-protocol` when the CLI actually needs them
- This follows YAGNI while keeping the refactor path clear

### Accepted: CI from Phase 1
Agree with tech lead that CI should be operational from Phase 1. The frontend CI jobs I need:
- `bun install && bun run typecheck` — TypeScript compilation
- `bun test` — Vitest unit + integration tests
- `bun run lint` — ESLint
- Coverage threshold enforcement

### Challenge: `just` vs `package.json` Scripts
Tech lead recommends `just` for cross-language task orchestration. For frontend developers, the standard entry point is `package.json` scripts. I'd prefer:
- `package.json` scripts for frontend-only tasks (`bun test`, `bun run lint`, `bun run dev`)
- `just` (or similar) only for cross-language orchestration (`just dev` runs `bun tauri dev`)
- Don't force frontend developers to learn another tool for their daily workflow

---

## 3. Addressing PM's Scope Concerns from Frontend Complexity Perspective

### Agreement: MVP is Phases 1-3
PM is right to focus on Phases 1-3 as the MVP. From the frontend perspective, these phases have very different complexity profiles:

| Phase | Frontend Complexity | Key Risk |
|-------|-------------------|----------|
| Phase 1 | **High** — xterm.js integration, WebGL management, PTY data flow | Getting terminal rendering correct and performant |
| Phase 2 | **Very High** — recursive split layout, workspace state management, surface tabs | PaneSplitter recursive rendering, keyboard navigation |
| Phase 3 | **Medium** — persistence is mostly Rust; frontend just serializes scrollback | SerializeAddon reliability, restore fidelity |

Phase 2 is the most frontend-heavy and risky phase. I recommend budgeting more time for it than Phase 1 or Phase 3.

### Agreement: Move Keyboard Shortcuts into Phase 2
PM's suggestion to move basic keybindings into Phase 2 is absolutely correct. A split-pane multiplexer without keyboard navigation is unusable. The shortcuts that must ship with Phase 2:

| Shortcut | Action |
|----------|--------|
| `Cmd/Ctrl+Shift+H` | Split horizontal |
| `Cmd/Ctrl+Shift+V` | Split vertical |
| `Cmd/Ctrl+W` | Close pane |
| `Cmd/Ctrl+N` | New workspace |
| `Cmd/Ctrl+1-9` | Switch workspace |
| `Cmd/Ctrl+Tab` | Next surface |
| `Cmd/Ctrl+Arrow` | Focus adjacent pane |

These can be hardcoded in Phase 2. The command palette and customization (Phase 6) just wraps them in a discoverable UI.

### Pushback on PM's TDD Stance for Components
PM says TDD on React components "often leads to brittle tests that test implementation details" and suggests preferring integration tests over unit tests for components. I partially disagree:

**Where I agree:** Testing JSX output structure (e.g., "does this div have this class?") is brittle and low-value.

**Where I disagree:** Testing component **behavior** via TDD is high-value and not brittle:
- Does `TerminalPane` call `terminal.dispose()` on unmount? (Tests a real memory leak bug)
- Does `Sidebar` highlight the active workspace? (Tests a behavioral contract)
- Does `PaneSplitter` render the correct number of panels for a given layout tree? (Tests the core algorithm)

The key is testing **what** the component does, not **how** it renders. Testing Library enforces this by querying by role/text, not by CSS class. I will use TDD for components, but I will write behavioral tests, not structural snapshot tests.

### Phase 3 Splitting Suggestion: Accepted
PM suggests splitting Phase 3 into 3a (layout persistence) and 3b (scrollback + metadata). From the frontend side, this makes sense:
- 3a: Rust persists layout, frontend restores pane structure on load — straightforward
- 3b: Frontend serializes scrollback via `SerializeAddon`, sends to Rust for storage — more complex, requires careful memory management for large buffers

---

## 4. Debating Testing Approach with QA

### Challenge: 100% Coverage is Wrong for Frontend
QA mandates 100% line coverage for both Rust and React. I strongly support 100% for Rust (the PTY engine, parser, state logic — safety-critical code). But for React, **100% line coverage is counterproductive**. Here's why:

1. **Unreachable code in JSX branches**: React components often have conditional renders that are technically dead code in certain prop combinations. Forcing 100% means writing contrived tests.

2. **Third-party integration code**: Testing that we correctly call `xterm.js` or `react-resizable-panels` APIs in every edge case is testing *their* library, not our code.

3. **Diminishing returns**: Going from 90% to 100% coverage in React code typically requires 3x the testing effort for marginal quality improvement. That effort is better spent on E2E tests that catch real user-facing bugs.

**My counter-proposal:**
- **Stores and hooks: 100% coverage** — these are pure logic, easy to test, and where the real bugs live
- **Components: 90% coverage minimum** — test behavior thoroughly, but don't chase every JSX branch
- **E2E: All PRD verification scenarios** — these catch integration bugs that unit tests miss
- **Visual regression on key screens** — catches CSS/rendering bugs that code coverage ignores

### Agreement: Phase 0 for Test Infrastructure
QA's "Phase 0" concept is correct. Before writing any feature code, we need:
- Vitest configured with jsdom environment
- `@testing-library/react` installed
- xterm.js mock module created
- Tauri bridge mock created
- CI pipeline running tests on every push

These mocks are **critical infrastructure**. The xterm.js mock and Tauri bridge mock are the foundation of every frontend test.

### Challenge: No Retries Policy is Too Strict for E2E
QA says "Tests get 0 retries in CI." For unit and integration tests, I agree. But for E2E tests with Playwright + Tauri WebDriver, some flakiness is inherent:
- Browser startup timing
- WebDriver connection establishment
- xterm.js WebGL initialization
- Platform-specific font rendering timing

**Counter-proposal**: Allow E2E tests 1 retry in CI, but require investigation of any test that retries more than 5% of the time. This balances CI reliability with practical flakiness in end-to-end testing.

### Agreement: Vitest Snapshot Tests are Low-Value
QA mentions "React components: Vitest snapshot tests for rendered output." I do NOT recommend snapshot tests for this project. They are brittle, break on any render change, and teach nothing about correctness. I will use behavioral tests (Testing Library queries) instead.

However, **golden file tests for OSC parser output** (QA's suggestion) are excellent. Those are stable, well-defined, and catch real regressions. Similarly, golden file tests for serialized workspace state are valuable.

### Proposed Test Boundary: What's Component-Level vs E2E

| Test Target | Component Test | E2E Test |
|------------|---------------|----------|
| Terminal renders and accepts input | Mock xterm.js, verify hook calls | Real xterm.js, verify text appears |
| Split pane creates two panels | Mock layout store, verify component tree | Click split button, verify two terminals exist |
| Workspace switch | Mock store, verify active workspace changes | Click workspace in sidebar, verify terminal switches |
| Notification appears | Mock store, verify badge renders | Trigger OSC in terminal, verify badge and panel |
| Session restore | Mock persistence, verify components render | Close and reopen app, verify layout matches |

Component tests are fast (ms) and run on every save. E2E tests are slow (seconds) and run in CI. Both are needed, but they test different things.

---

## 5. Proposed Concrete Component API Contracts

Here are the component APIs I'm committing to. These should be reviewed by the full team:

### TerminalPane
```typescript
interface TerminalPaneProps {
  paneId: string;
  ptyId: string;
  isActive: boolean;       // receives focus and keyboard input
  onReady?: () => void;    // called when xterm.js is initialized
}
```
Internally uses `useTerminal(paneId, ptyId)` hook.

### PaneSplitter (LayoutRenderer)
```typescript
interface PaneSplitterProps {
  layout: LayoutNode;      // recursive tree from Rust state
  activePaneId: string;
  onPaneClick: (paneId: string) => void;
}

type LayoutNode =
  | { type: 'leaf'; paneId: string }
  | { type: 'split'; direction: 'horizontal' | 'vertical'; children: [LayoutNode, LayoutNode]; sizes: [number, number] };
```

### Sidebar
```typescript
interface SidebarProps {
  workspaces: Workspace[];
  activeWorkspaceId: string;
  onWorkspaceSelect: (id: string) => void;
  onWorkspaceCreate: () => void;
  onWorkspaceClose: (id: string) => void;
}
```

### PaneWrapper
```typescript
interface PaneWrapperProps {
  pane: Pane;              // { id, type: 'terminal' | 'browser', ptyId?, url? }
  isActive: boolean;
  hasNotification: boolean; // blue ring indicator
}
```

### NotificationPanel
```typescript
interface NotificationPanelProps {
  isOpen: boolean;
  onClose: () => void;
  // Reads from notificationStore internally
}
```

### Hooks

```typescript
// useTerminal — manages xterm.js lifecycle
function useTerminal(paneId: string, ptyId: string): {
  terminalRef: RefCallback<HTMLDivElement>;
  isReady: boolean;
  searchTerminal: (query: string) => void;
  serializeTerminal: () => string;
}

// useTauriEvent — generic Tauri event subscription with cleanup
function useTauriEvent<T>(eventName: string, handler: (payload: T) => void): void;

// useKeyboardShortcuts — registers global keyboard handlers
function useKeyboardShortcuts(shortcuts: ShortcutMap): void;
```

---

## 6. Cross-Platform CSS/Rendering Differences

### Font Rendering: The Hidden Complexity
This is a concern nobody else has raised in depth. Terminal font rendering varies significantly across platforms:

| Platform | Renderer | Effect |
|----------|---------|--------|
| macOS | Core Text (subpixel AA) | Slightly wider glyphs, heavier stroke weight |
| Windows | DirectWrite/ClearType | Different subpixel rendering, may look thinner |
| Linux | FreeType/fontconfig | Depends heavily on user's fontconfig settings |

This matters because `FitAddon.fit()` calculates terminal cols/rows based on **measured character dimensions**. The same 800px-wide terminal may be 100 columns on macOS but 102 columns on Linux with the same font.

**Impact on Rust:** When the frontend sends `pty_resize(cols, rows)` to Rust, the values will differ per platform for the same pixel dimensions. This is correct behavior (the terminal IS a different size in character terms), but it means:
- Screenshot-based visual regression tests need **per-platform baselines**
- E2E tests that assert column/row counts must account for platform differences
- Serialized scrollback must store character data, not pixel positions

### Scrollbar Styling
Tauri uses the platform's native webview, which means:
- macOS: WebKit scrollbars (overlay by default, thin)
- Windows: Chromium scrollbars (always visible, wider)
- Linux: Varies by distro (WebKitGTK)

For consistent UX, I recommend custom scrollbar styling via CSS:
```css
::-webkit-scrollbar { width: 8px; }
::-webkit-scrollbar-track { background: var(--bg-secondary); }
::-webkit-scrollbar-thumb { background: var(--border-color); border-radius: 4px; }
```

This works in WebKit and Chromium-based webviews (covers all Tauri targets).

### Window Chrome
Tauri provides native window decorations by default. For a terminal multiplexer, I recommend:
- **macOS**: Use native traffic light buttons (titleBarStyle: "overlay" in Tauri config)
- **Windows/Linux**: Use native title bar for familiarity
- Do NOT implement a custom titlebar — it's a rabbit hole of drag regions, double-click handling, and platform quirks that provides minimal value

---

## 7. Areas of Consensus Across All Analyses

Summarizing what all 5 team members agree on:

1. **Rust as single source of truth** for workspace/pane structure (frontend, backend, tech lead agree)
2. **`ts-rs` for type generation** (frontend, tech lead agree)
3. **Phase 0 test infrastructure** before any feature code (QA, tech lead, PM agree; frontend accepts)
4. **CI from Phase 1** on all 3 platforms (tech lead, QA, PM agree)
5. **WebGL fallback to canvas** is mandatory (frontend, tech lead agree)
6. **Base64 is fine initially** but needs benchmarking (all agree)
7. **Keyboard shortcuts in Phase 2**, not Phase 6 (PM, frontend agree)
8. **Error boundaries per pane** (frontend, tech lead agree)
9. **Event batching at 60fps** for PTY data (frontend, backend agree)
10. **TDD for stores/hooks/Rust** is high-value; TDD for React JSX is lower-value but still worth doing for behavior (PM and frontend align on this nuance)

---

## 8. Open Questions for the Team

1. **Backend**: Do you agree with a single `workspace-changed` event (full state) vs fine-grained events? This simplifies the frontend significantly.

2. **Tech lead**: Should we evaluate `specta` as an alternative to `ts-rs`? Specta has tighter Tauri integration for auto-generating command type bindings.

3. **QA**: Can we agree on 90% component coverage + 100% store/hook coverage as the frontend threshold, rather than blanket 100%?

4. **PM**: Should we create a "Phase 1.5" milestone for the keyboard shortcut system, or bake it directly into Phase 2?

5. **All**: The PRD uses `SurfaceTabBar` in Phase 2 description but omits it from the file tree. Confirm we need it — I believe surfaces (tabs within a workspace) are essential for the multiplexer UX.
