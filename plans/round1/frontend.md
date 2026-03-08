# Round 1: Frontend Engineering Analysis

## 1. Component Architecture Critique

The proposed component tree is generally well-structured, but I have several concerns:

### Strengths
- Clear separation between layout, workspace, terminal, and browser concerns
- Dedicated hook files (`useTerminal`, `useBrowser`) keep component logic separate from rendering
- Notification components broken into granular pieces (Panel, Badge, Item)

### Concerns

**PaneSplitter as a single recursive component is risky.** Recursive rendering of `react-resizable-panels` groups can cause cascading re-renders when any pane resizes. Each split creates a nested `PanelGroup > Panel > PanelGroup > Panel...` tree. With 6+ panes, this can be deeply nested and hard to debug. I recommend:
- A `LayoutRenderer` component that flattens the layout tree and renders panels using a key-based strategy
- Memoize each pane wrapper aggressively with `React.memo` and stable references

**Missing intermediate components.** The PRD jumps from `WorkspaceContainer` to `PaneSplitter` to `PaneWrapper`, but there's no `SurfaceTabBar` component listed in the file tree (though it's mentioned in Phase 2). The component tree should include:
```
WorkspaceContainer
├── SurfaceTabBar          (missing from file tree)
└── SurfaceContent
    └── PaneSplitter
        └── PaneWrapper
            ├── TerminalPane
            └── BrowserPane
```

**PaneWrapper needs a type discriminator.** It wraps both `TerminalPane` and `BrowserPane`, so it needs a pane type enum and conditional rendering. This should be explicit in the type definitions.

**No error boundary strategy.** A crashing terminal or browser pane should not take down the entire app. Each `PaneWrapper` should be wrapped in a React error boundary with a recovery UI.

---

## 2. State Management Design

### Zustand: Right Choice?

Zustand is a strong choice here for several reasons:
- Hook-based API fits React 19 patterns
- Built-in `persist` middleware handles session persistence to disk
- Minimal boilerplate compared to Redux
- Supports selectors and subscriptions for fine-grained reactivity

### Store Structure Concerns

**The `workspaceStore` is carrying too much responsibility.** It manages workspaces, surfaces, panes, layout tree, and active/focused state. This should be split into:

1. **`workspaceStore`** — workspace list, active workspace, create/close/switch
2. **`layoutStore`** — layout tree per surface, split/close/resize operations
3. **`paneStore`** — individual pane state (type, pty_id, metadata)
4. **`focusStore`** — focus tracking, pane activation, keyboard navigation

This separation prevents unnecessary re-renders. A pane resizing should not cause the sidebar workspace list to re-render.

**Store-to-Rust synchronization is undefined.** The PRD says Rust has its own workspace state structs but doesn't define who is the source of truth. I recommend:
- **Rust is the source of truth** for PTY state, workspace structure, and persistence
- **React stores are projections** of Rust state, synced via Tauri events
- All mutations go through `invoke()` to Rust, which emits state change events back
- This avoids dual-state bugs where React and Rust disagree

**Persistence strategy.** Zustand's `persist` middleware writes to localStorage by default. For Tauri, we need a custom storage adapter that writes to the Tauri app data dir via `@tauri-apps/plugin-fs`. Alternatively, if Rust is the source of truth, persistence should happen entirely on the Rust side.

---

## 3. xterm.js Integration

This is the most complex frontend concern. Key issues:

### Lifecycle Management
- xterm.js `Terminal` instances must be `.open()`-ed on a DOM element and `.dispose()`-d on unmount
- The `useTerminal` hook must handle: creation, attaching to DOM via ref callback, fitting, event subscription, and cleanup
- **Critical:** When a pane is hidden (e.g., switching surfaces/tabs), the terminal should NOT be disposed — it must be detached and re-attached. Disposing loses all scrollback state.

### Proposed `useTerminal` hook contract:
```typescript
function useTerminal(paneId: string, ptyId: string): {
  terminalRef: RefCallback<HTMLDivElement>;
  isReady: boolean;
  search: (query: string) => void;
  serialize: () => string;
}
```

### Memory Leaks
- Each terminal creates a WebGL context. Browsers limit WebGL contexts (typically 8-16 per page). With many panes, we'll hit this limit.
- **WebGL fallback strategy:** Use `CanvasAddon` as fallback when WebGL context creation fails. The PRD mentions WebGL addon but doesn't address the context limit.
- Pool WebGL contexts: only active/visible terminals get WebGL; off-screen terminals fall back to canvas or are detached entirely.

### Addon Management
- FitAddon, WebglAddon, SearchAddon, SerializeAddon — each must be `.dispose()`-d separately
- Create an addon lifecycle manager that pairs creation with disposal

### Data Flow Performance
- Base64 encoding PTY data adds ~33% overhead. For large output (e.g., `cat` a big file), this matters.
- Tauri events are JSON-serialized. Each event goes through IPC serialization. For high-throughput PTY output, consider batching: accumulate data for 8-16ms, then send one event per frame.
- `xterm.js.write()` should be called carefully — rapid sequential writes cause layout thrashing. Use `xterm.js.write(data, callback)` to chain writes properly.

---

## 4. Split Pane Implementation

### react-resizable-panels Assessment

This library is solid for the use case:
- Supports nested `PanelGroup` for recursive splits
- Handles keyboard-accessible resize
- Persists sizes via `autoSaveId`

### Concerns

**Recursive rendering with dynamic depth.** The layout tree in the PRD is a binary tree where each node is either a split (horizontal/vertical) or a leaf (pane). Rendering this recursively works but:
- Each re-render of a parent `PanelGroup` re-renders all children
- Resizing one split triggers resize observers in all nested children
- Solution: Use `React.memo` on `PaneWrapper` and ensure the layout tree uses stable references (Immer or structural sharing in Zustand)

**Minimum pane size.** Terminals need a minimum size to be usable (~80 columns, ~24 rows at standard font size). `react-resizable-panels` supports `minSize` as a percentage, but we need pixel-based minimums. This requires calculating percentage thresholds based on the container size.

**Drag handles styling.** The resize handle between panes must be visible but minimal (2-4px). On touch devices, it needs a larger hit target. `react-resizable-panels` provides a `PanelResizeHandle` component but its default styling is minimal.

---

## 5. Tauri Bridge Typing

### How to Keep `invoke()` Type-Safe

The PRD mentions `lib/tauri-bridge.ts` for typed wrappers. Here's the pattern I recommend:

```typescript
// types.ts — shared types matching Rust structs
interface PtySpawnArgs { cwd?: string; shell?: string; env?: Record<string, string> }
interface PtySpawnResult { pty_id: string }

// tauri-bridge.ts — typed wrappers
import { invoke } from '@tauri-apps/api/core';

export const tauriBridge = {
  pty: {
    spawn: (args: PtySpawnArgs) => invoke<PtySpawnResult>('pty_spawn', args),
    write: (ptyId: string, data: string) => invoke<void>('pty_write', { ptyId, data }),
    resize: (ptyId: string, cols: number, rows: number) => invoke<void>('pty_resize', { ptyId, cols, rows }),
    kill: (ptyId: string) => invoke<void>('pty_kill', { ptyId }),
  },
  workspace: {
    create: (name: string) => invoke<WorkspaceState>('workspace_create', { name }),
    // ...
  },
} as const;
```

### Keeping Types in Sync
- Use `ts-rs` crate on the Rust side to auto-generate TypeScript type definitions from Rust structs
- Run type generation as a build step: `cargo test` exports `.ts` files into `src/lib/generated/`
- This eliminates manual type duplication between Rust and TypeScript

---

## 6. CSS Architecture

### Recommendation: CSS Modules + CSS Variables

- **CSS Modules** for component-scoped styles (avoid class name collisions, good tree-shaking)
- **CSS Variables** for theming (colors, fonts, spacing) — defined in `:root` and overridden per theme class
- **NOT Tailwind** — xterm.js integration requires precise CSS control; Tailwind's utility approach clashes with terminal rendering requirements

### Theme System Design
```css
/* themes/variables.css */
:root {
  --bg-primary: #1e1e2e;
  --bg-secondary: #181825;
  --text-primary: #cdd6f4;
  --terminal-bg: #11111b;
  --border-color: #313244;
  --accent: #89b4fa;
  --font-mono: 'JetBrains Mono', 'Cascadia Code', monospace;
  --font-size-terminal: 14px;
}

[data-theme="light"] {
  --bg-primary: #eff1f5;
  /* ... */
}
```

### Cross-Platform Rendering Differences
- Font rendering differs between Windows (ClearType), macOS (Core Text), and Linux (FreeType). Terminal font metrics will vary.
- The `FitAddon` calculates character dimensions — these will differ per platform. We need to test that terminal column/row counts are correct on all three.
- Scrollbar styling differs across platforms. Use `::-webkit-scrollbar` for consistency, but test native scrollbars as fallback.

---

## 7. Performance

### React Re-render Optimization

**Critical paths:**
1. PTY data streaming — `xterm.js.write()` is called via Tauri events. This should NOT trigger React re-renders. The event listener in `useTerminal` should write directly to the xterm instance without updating React state.
2. Pane resize — Only the affected `PanelGroup` should re-render, not the entire workspace.
3. Sidebar updates — Git info and port scanning results should update only affected sidebar items.

**Strategies:**
- Use Zustand selectors to subscribe to specific slices: `useWorkspaceStore(s => s.activeWorkspaceId)` instead of `useWorkspaceStore()`
- `React.memo` on all leaf components (`TerminalPane`, `BrowserPane`, `SidebarWorkspaceItem`)
- Move PTY data handling entirely outside React's render cycle — use refs and direct DOM manipulation via xterm.js API
- Use `useSyncExternalStore` for Tauri event subscriptions if needed

### Virtual Scrolling
- Not needed for terminal content (xterm.js handles its own scrollback buffer internally)
- May be needed for notification panel if thousands of notifications accumulate — use `react-virtuoso` or similar

### Large Terminal Output
- xterm.js has a configurable scrollback buffer (default 1000 lines). Set to something reasonable (5000-10000).
- The SerializeAddon serializes the entire buffer — for persistence, this could be large. Consider compressing serialized data or only persisting the last N lines.

---

## 8. Accessibility

### Keyboard Navigation
- Tab order: Sidebar -> Surface tabs -> Active pane
- Within split panes: Ctrl+Arrow to move focus between panes
- All sidebar items must be keyboard-navigable (arrow keys for list navigation, Enter to select)
- Command palette must trap focus while open

### Screen Reader Support
- xterm.js has limited screen reader support. Enable the `accessibilityAddon` or use `aria-live` regions for terminal output summaries.
- Pane split/close actions should announce via `aria-live="polite"`
- Sidebar workspace items need `role="treeitem"` with `aria-expanded` for nested surfaces

### ARIA Attributes
- `PanelResizeHandle` needs `role="separator"` with `aria-valuenow` (react-resizable-panels provides this)
- Notification badge needs `role="status"` with `aria-label="N unread notifications"`
- Surface tabs need `role="tablist"` / `role="tab"` / `role="tabpanel"` pattern

### Focus Management
- When splitting a pane, focus should move to the new pane
- When closing a pane, focus should move to an adjacent pane
- When switching workspaces, focus should move to the previously focused pane in that workspace

---

## 9. Frontend Testing Strategy

### Component Testing (Vitest + React Testing Library)

Every component should have unit tests covering:
- Rendering with various props
- User interactions (click, keyboard, resize)
- State transitions
- Error states

**xterm.js Mocking:** xterm.js requires a DOM and canvas API. For unit tests:
```typescript
// __mocks__/xterm.ts
export class Terminal {
  onData = vi.fn(() => ({ dispose: vi.fn() }));
  onResize = vi.fn(() => ({ dispose: vi.fn() }));
  open = vi.fn();
  write = vi.fn();
  dispose = vi.fn();
  loadAddon = vi.fn();
  // ...
}
```

Mock at the module level with `vi.mock('@xterm/xterm')`. Test the `useTerminal` hook in isolation using `renderHook()`.

### Tauri Bridge Mocking
```typescript
// Mock @tauri-apps/api/core
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

// Mock @tauri-apps/api/event
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(vi.fn())), // returns unlisten function
  emit: vi.fn(),
}));
```

### Store Testing
- Test Zustand stores in isolation (they're just functions)
- Test store actions produce correct state transitions
- Test selectors return correct derived data

### Visual Regression
- Use Storybook for component development
- Chromatic or Percy for visual regression testing
- Capture terminal rendering in different themes/fonts

### Integration Testing
- Test component trees together (e.g., Sidebar + WorkspaceContainer interaction)
- Use `@testing-library/user-event` for realistic interaction simulation

### E2E Testing
- Playwright with Tauri WebDriver protocol
- Test full user journeys: create workspace, split pane, type in terminal, verify output

---

## 10. TDD for React Components

### Approach: Outside-In TDD

For each component:

1. **Write the test first** — Define what the component should render and how it should behave
2. **Run the test** — Confirm it fails (red)
3. **Implement minimally** — Write just enough code to pass (green)
4. **Refactor** — Clean up while tests stay green

### Example: TerminalPane TDD cycle

```typescript
// Step 1: Write test
describe('TerminalPane', () => {
  it('renders a terminal container div', () => {
    render(<TerminalPane paneId="p1" ptyId="pty1" />);
    expect(screen.getByTestId('terminal-container-p1')).toBeInTheDocument();
  });

  it('initializes xterm.js on mount', () => {
    render(<TerminalPane paneId="p1" ptyId="pty1" />);
    expect(Terminal).toHaveBeenCalled();
    expect(mockTerminal.open).toHaveBeenCalled();
  });

  it('disposes terminal on unmount', () => {
    const { unmount } = render(<TerminalPane paneId="p1" ptyId="pty1" />);
    unmount();
    expect(mockTerminal.dispose).toHaveBeenCalled();
  });

  it('subscribes to PTY data events', () => {
    render(<TerminalPane paneId="p1" ptyId="pty1" />);
    expect(listen).toHaveBeenCalledWith('pty-data-pty1', expect.any(Function));
  });

  it('writes received PTY data to terminal', async () => {
    render(<TerminalPane paneId="p1" ptyId="pty1" />);
    const handler = (listen as Mock).mock.calls[0][1];
    handler({ payload: btoa('hello') });
    expect(mockTerminal.write).toHaveBeenCalledWith(/* decoded data */);
  });
});
```

### TDD for Hooks
- Use `renderHook()` from `@testing-library/react`
- Test hook state transitions and cleanup
- Mock external dependencies (Tauri, xterm.js)

### TDD for Stores
- Import store, call actions, assert state changes
- No rendering needed — stores are pure logic
- Test async actions with proper async handling

---

## Summary of Key Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| WebGL context limit | High | Canvas fallback, context pooling |
| Recursive split re-renders | Medium | React.memo, stable layout tree references |
| Dual state (React + Rust) | High | Single source of truth in Rust |
| xterm.js memory leaks on tab switch | High | Detach/re-attach instead of dispose/create |
| Cross-platform font metrics | Medium | Platform-specific FitAddon testing |
| Base64 encoding overhead | Medium | Batching PTY data per animation frame |
| Accessibility | Medium | Plan from day 1, not bolt on later |
