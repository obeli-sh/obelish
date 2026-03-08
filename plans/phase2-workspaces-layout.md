# Phase 2: Workspaces + Split Layout + Navigation

## Objectives & Scope

Phase 2 transforms Obelisk from a single-terminal window into a full terminal multiplexer. It delivers:

1. **Workspace management**: Create, close, and switch between workspaces, each containing independent terminal sessions.
2. **Split panes**: Horizontal and vertical splits within a workspace, with recursive nesting.
3. **Surface tabs**: Multiple tab surfaces per workspace, each with its own pane layout.
4. **Sidebar**: A persistent sidebar showing all workspaces and their metadata.
5. **Keyboard navigation**: Hardcoded shortcuts for all core operations (split, close, navigate, switch workspace).
6. **State synchronization**: Rust-owned workspace state projected to React via a single `workspace-changed` event.

At the end of Phase 2, a user can create multiple workspaces, split terminals in any direction, switch between them with keyboard shortcuts, and navigate panes without touching the mouse.

---

## User Stories

1. **As a developer**, I can press `Ctrl/Cmd+N` to create a new workspace with a fresh terminal.
2. **As a developer**, I can press `Ctrl/Cmd+Shift+H` or `Ctrl/Cmd+Shift+V` to split the current pane horizontally or vertically.
3. **As a developer**, I can press `Ctrl/Cmd+Arrow` to move focus between adjacent panes.
4. **As a developer**, I can press `Ctrl/Cmd+W` to close the focused pane (and its terminal).
5. **As a developer**, I can press `Ctrl/Cmd+1-9` to switch between workspaces.
6. **As a developer**, I can see all my workspaces listed in a sidebar, with the active one highlighted.
7. **As a developer**, I can create multiple tabs (surfaces) within a workspace and switch between them with `Ctrl/Cmd+Tab`.
8. **As a developer**, when I split a pane, a new terminal spawns automatically in the new pane.
9. **As a developer**, when I close the last pane in a workspace, the workspace closes.
10. **As a developer**, my terminals are not destroyed when I switch tabs — I can switch back and my scrollback is preserved.

---

## Technical Implementation

### PR #1: Rust Workspace State Model

#### 1.1 Data Types (`workspace/types.rs`)

```rust
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceInfo {
    pub id: String,
    pub name: String,
    pub surfaces: Vec<SurfaceInfo>,
    pub active_surface_index: usize,
    pub created_at: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SurfaceInfo {
    pub id: String,
    pub name: String,
    pub layout: LayoutNode,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(tag = "type")]
pub enum LayoutNode {
    #[serde(rename = "leaf")]
    Leaf { pane_id: String },
    #[serde(rename = "split")]
    Split {
        direction: SplitDirection,
        children: Box<[LayoutNode; 2]>,
        sizes: [f64; 2], // percentages, sum to 1.0
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SplitDirection {
    Horizontal,
    Vertical,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaneInfo {
    pub id: String,
    pub pty_id: String,
    pub pane_type: PaneType,
    pub cwd: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PaneType {
    Terminal,
    Browser, // Phase 5
}
```

These types are auto-generated to TypeScript via `ts-rs`/`specta`, emitted to `src/lib/generated/types.ts`.

#### 1.2 Workspace State Manager (`workspace/state.rs`)

- Holds `Vec<WorkspaceInfo>` and `active_workspace_id`
- Methods: `create_workspace()`, `close_workspace()`, `split_pane()`, `close_pane()`, `create_surface()`, `close_surface()`
- Every mutation emits a `workspace-changed` event with the affected workspace's full state
- Layout tree operations:
  - `split_pane(pane_id, direction)`: Finds the leaf node for `pane_id`, replaces it with a `Split` node containing the original leaf and a new leaf
  - `close_pane(pane_id)`: Finds the leaf node, removes it. If its parent split now has only one child, collapse the split to the remaining child. If it was the last pane in the surface, close the surface. If it was the last surface, close the workspace.
- Thread-safe via `Arc<RwLock<WorkspaceState>>` in `AppState`

#### 1.3 Workspace Error Types

```rust
#[derive(Debug, thiserror::Error)]
pub enum WorkspaceError {
    #[error("workspace not found: {id}")]
    NotFound { id: String },
    #[error("pane not found: {id}")]
    PaneNotFound { id: String },
    #[error("surface not found: {id}")]
    SurfaceNotFound { id: String },
    #[error("invalid split: {reason}")]
    InvalidSplit { reason: String },
    #[error("cannot close last workspace")]
    LastWorkspace,
}
```

#### 1.4 Tauri Commands

```rust
#[tauri::command]
async fn workspace_create(state: ..., app: ..., name: Option<String>, cwd: Option<String>) -> Result<WorkspaceInfo, BackendError>
// Creates workspace with one surface, one pane, spawns PTY

#[tauri::command]
async fn workspace_close(state: ..., app: ..., workspace_id: String) -> Result<(), BackendError>
// Kills all PTYs, removes workspace, emits workspace-changed

#[tauri::command]
async fn workspace_list(state: ...) -> Result<Vec<WorkspaceInfo>, BackendError>
// Returns all workspaces (used for initial state load)

#[tauri::command]
async fn pane_split(state: ..., app: ..., pane_id: String, direction: SplitDirection, shell: Option<String>) -> Result<PaneSplitResult, BackendError>
// Splits pane, spawns new PTY, emits workspace-changed

#[tauri::command]
async fn pane_close(state: ..., app: ..., pane_id: String) -> Result<(), BackendError>
// Kills PTY, removes pane from layout, emits workspace-changed
```

#### 1.5 `obelisk-protocol` Crate Extraction

Create `obelisk-protocol/` crate in the Cargo workspace. Move `WorkspaceInfo`, `SurfaceInfo`, `LayoutNode`, `PaneInfo`, `SplitDirection`, `PaneType` into it. Both `src-tauri` and (eventually) `cli` depend on it.

---

### PR #2: Frontend State + Sidebar

#### 2.1 workspaceStore (Rust Mirror)

```typescript
interface WorkspaceStoreState {
  workspaces: Record<string, WorkspaceInfo>;
  activeWorkspaceId: string | null;
  getActiveWorkspace: () => WorkspaceInfo | null;
  getActiveSurface: () => SurfaceInfo | null;
  getActiveLayout: () => LayoutNode | null;
  getPaneById: (id: string) => PaneInfo | null;
  // Internal sync methods (called by event listener, not by components)
  _syncWorkspace: (id: string, state: WorkspaceInfo) => void;
  _removeWorkspace: (id: string) => void;
  _setActiveWorkspace: (id: string) => void;
}
```

- Initialized by calling `tauriBridge.workspace.list()` on app mount
- Updated by `workspace-changed` event listener
- No Zustand `persist` middleware (Rust owns persistence)

#### 2.2 uiStore (Frontend-Owned)

```typescript
interface UiStoreState {
  focusedPaneId: string | null;
  sidebarOpen: boolean;
  notificationPanelOpen: boolean;
  setFocusedPane: (id: string | null) => void;
  toggleSidebar: () => void;
  toggleNotificationPanel: () => void;
  focusAdjacentPane: (direction: 'up' | 'down' | 'left' | 'right') => void;
}
```

- `focusAdjacentPane` traverses the layout tree to find the neighbor in the given direction

#### 2.3 Sidebar Component

```typescript
interface SidebarProps {
  workspaces: WorkspaceInfo[];
  activeWorkspaceId: string;
  onWorkspaceSelect: (id: string) => void;
  onWorkspaceCreate: () => void;
  onWorkspaceClose: (id: string) => void;
}
```

- Renders workspace list with active highlight
- "New Workspace" button
- Close button per workspace (with confirmation if >1 pane)
- Semantic HTML: `<nav>` with `<ul>` list items
- Keyboard navigable: arrow keys to traverse, Enter to select

#### 2.4 Tauri Bridge Extensions

Add to `tauriBridge`:
```typescript
workspace: {
  create: (args?: { name?: string; cwd?: string }) => invoke<WorkspaceInfo>('workspace_create', args ?? {}),
  close: (workspaceId: string) => invoke<void>('workspace_close', { workspaceId }),
  list: () => invoke<WorkspaceInfo[]>('workspace_list'),
},
pane: {
  split: (paneId: string, direction: SplitDirection, shell?: string) => invoke<PaneSplitResult>('pane_split', { paneId, direction, shell }),
  close: (paneId: string) => invoke<void>('pane_close', { paneId }),
},
```

---

### PR #3: Split Pane Layout

#### 3.1 PaneSplitter (Recursive Layout Renderer)

```typescript
interface PaneSplitterProps {
  layout: LayoutNode;
  activePaneId: string;
  onPaneClick: (paneId: string) => void;
}
```

- Recursively renders `react-resizable-panels` `PanelGroup` and `Panel` components
- `LayoutNode.Leaf` renders a `PaneWrapper` (which renders `TerminalPane`)
- `LayoutNode.Split` renders a `PanelGroup` with two children and a `PanelResizeHandle`
- `React.memo` on `PaneWrapper` to prevent re-renders during resize of sibling panes
- Minimum pane size: calculated based on container width and minimum 40 columns

#### 3.2 PaneWrapper

```typescript
interface PaneWrapperProps {
  pane: PaneInfo;
  isActive: boolean;
  hasNotification: boolean; // Phase 4, false for now
}
```

- Discriminates `pane.paneType`: renders `TerminalPane` for "terminal", placeholder for "browser" (Phase 5)
- Visual active indicator (border highlight)
- Click handler sets `uiStore.focusedPaneId`

#### 3.3 PaneErrorBoundary

- Wraps each `PaneWrapper`
- On error: renders recovery UI with "Restart" and "Close" buttons
- "Restart" calls `tauriBridge.pty.kill()` then `tauriBridge.pty.spawn()` for the same pane
- "Close" calls `tauriBridge.pane.close()`
- Prevents a single crashing terminal from taking down the app

#### 3.4 SurfaceTabBar

```typescript
interface SurfaceTabBarProps {
  surfaces: SurfaceInfo[];
  activeSurfaceId: string;
  onSurfaceSelect: (id: string) => void;
  onSurfaceCreate: () => void;
  onSurfaceClose: (id: string) => void;
}
```

- Renders tab list with `role="tablist"` / `role="tab"` ARIA pattern
- Active tab highlighted
- Close button per tab
- "+" button to create new surface

#### 3.5 Terminal Detach/Re-Attach for Tab Switching

- When switching surfaces, inactive surface content uses `display: none` (not unmounting)
- xterm.js instances stay alive in memory — scrollback preserved
- When a surface becomes active, `FitAddon.fit()` is called to recalculate dimensions
- This avoids disposing/recreating terminals on every tab switch

---

### PR #4: Keyboard Shortcuts

#### 4.1 useKeyboardShortcuts Hook

```typescript
function useKeyboardShortcuts(shortcuts: ShortcutDefinition[]): void
```

- Registers `keydown` handler at `window` level with `capture: true`
- Platform-aware: `metaKey` on macOS, `ctrlKey` on Windows/Linux
- Calls `e.preventDefault()` and `e.stopPropagation()` on matched shortcuts (prevents xterm.js from receiving them)
- Does NOT capture `Ctrl+C`, `Ctrl+D`, `Ctrl+Z` (terminal signals)

#### 4.2 Shortcut Map

| Shortcut | macOS | Windows/Linux | Action |
|----------|-------|---------------|--------|
| Split horizontal | `Cmd+Shift+H` | `Ctrl+Shift+H` | `tauriBridge.pane.split(focusedPaneId, 'horizontal')` |
| Split vertical | `Cmd+Shift+V` | `Ctrl+Shift+V` | `tauriBridge.pane.split(focusedPaneId, 'vertical')` |
| Close pane | `Cmd+W` | `Ctrl+W` | `tauriBridge.pane.close(focusedPaneId)` |
| New workspace | `Cmd+N` | `Ctrl+N` | `tauriBridge.workspace.create()` |
| Switch workspace 1-9 | `Cmd+1-9` | `Ctrl+1-9` | Switch to Nth workspace |
| Next surface | `Cmd+Tab` | `Ctrl+Tab` | Activate next surface tab |
| Focus up | `Cmd+Up` | `Ctrl+Up` | `uiStore.focusAdjacentPane('up')` |
| Focus down | `Cmd+Down` | `Ctrl+Down` | `uiStore.focusAdjacentPane('down')` |
| Focus left | `Cmd+Left` | `Ctrl+Left` | `uiStore.focusAdjacentPane('left')` |
| Focus right | `Cmd+Right` | `Ctrl+Right` | `uiStore.focusAdjacentPane('right')` |

#### 4.3 Conflict Handling

- `Cmd+W` on macOS: Tauri's default is to close the window. Override via `keydown` handler with `preventDefault()`. Verify in E2E that the window stays open.
- `Ctrl+C/D/Z`: Explicitly excluded from shortcut matching — these pass through to the terminal.
- `Cmd+Q` on macOS: NOT overridden — standard app quit behavior.

---

### PR #5: AppLayout Composition

#### 5.1 AppLayout Component

Assembles the full application layout:

```
<AppErrorBoundary>
  <AppLayout>
    <Sidebar ... />
    <MainArea>
      <WorkspaceContainer workspaceId={activeId}>
        <SurfaceTabBar ... />
        <SurfaceContent>
          <PaneSplitter layout={...} ... />
        </SurfaceContent>
      </WorkspaceContainer>
    </MainArea>
  </AppLayout>
</AppErrorBoundary>
```

#### 5.2 Initial Load Flow

1. App mounts, calls `tauriBridge.workspace.list()`
2. If empty (first launch), calls `tauriBridge.workspace.create()` to create a default workspace
3. Subscribes to `workspace-changed` event
4. Renders sidebar + active workspace layout

#### 5.3 Workspace Switching

- Clicking a sidebar workspace or pressing `Ctrl/Cmd+1-9` sets `workspaceStore.activeWorkspaceId`
- The `WorkspaceContainer` re-renders with the new workspace's layout
- Previously focused pane is remembered per workspace in `uiStore`

---

## TDD Approach

### TDD Sequence for PR #1 (Rust Workspace State)

1. **Test**: `create_workspace_returns_workspace_info` -> **Implement** `WorkspaceState::create_workspace`
2. **Test**: `create_workspace_has_one_surface_with_one_pane` -> **Implement** default surface/pane creation
3. **Test**: `create_workspace_emits_workspace_changed_event` -> **Implement** event emission
4. **Test**: `close_workspace_removes_from_state` -> **Implement** `close_workspace`
5. **Test**: `close_workspace_kills_all_ptys` -> **Implement** PTY cleanup
6. **Test**: `close_last_workspace_returns_error` -> **Implement** guard
7. **Test**: `split_pane_creates_new_leaf` -> **Implement** `split_pane`
8. **Test**: `split_pane_replaces_leaf_with_split_node` -> **Implement** tree mutation
9. **Test**: `split_pane_spawns_new_pty` -> **Implement** PTY spawn on split
10. **Test**: `split_pane_emits_workspace_changed` -> **Implement** event
11. **Test**: `close_pane_removes_leaf` -> **Implement** `close_pane`
12. **Test**: `close_pane_collapses_parent_split` -> **Implement** tree simplification
13. **Test**: `close_last_pane_closes_surface` -> **Implement** cascade
14. **Test**: `close_last_surface_closes_workspace` -> **Implement** cascade
15. **Test**: `split_nonexistent_pane_returns_error` -> **Implement** error path
16. **Test**: `layout_tree_invariant_all_panes_are_leaves` (proptest) -> **Verify** tree operations maintain invariants

### TDD Sequence for PR #2 (Frontend State + Sidebar)

1. **Test**: `workspaceStore starts empty` -> **Implement** initial state
2. **Test**: `_syncWorkspace adds workspace` -> **Implement** sync
3. **Test**: `_syncWorkspace updates existing workspace` -> **Implement** update
4. **Test**: `_removeWorkspace removes workspace` -> **Implement** remove
5. **Test**: `getActiveWorkspace returns correct workspace` -> **Implement** selector
6. **Test**: `getActiveSurface returns correct surface` -> **Implement** selector
7. **Test**: `uiStore setFocusedPane updates state` -> **Implement** action
8. **Test**: `uiStore focusAdjacentPane traverses layout tree` -> **Implement** tree traversal
9. **Test**: `Sidebar renders workspace list` -> **Implement** component
10. **Test**: `Sidebar highlights active workspace` -> **Implement** active style
11. **Test**: `Sidebar create button calls onWorkspaceCreate` -> **Implement** button
12. **Test**: `Sidebar close button calls onWorkspaceClose` -> **Implement** button
13. **Test**: `Sidebar is keyboard navigable` -> **Implement** keyboard handlers

### TDD Sequence for PR #3 (Split Pane Layout)

1. **Test**: `PaneSplitter renders single leaf as TerminalPane` -> **Implement** leaf rendering
2. **Test**: `PaneSplitter renders horizontal split as two panels` -> **Implement** split rendering
3. **Test**: `PaneSplitter renders vertical split as two panels` -> **Implement** direction
4. **Test**: `PaneSplitter renders nested splits (3 levels)` -> **Implement** recursion
5. **Test**: `PaneWrapper renders TerminalPane for terminal type` -> **Implement** discriminator
6. **Test**: `PaneWrapper shows active border when isActive` -> **Implement** styling
7. **Test**: `PaneWrapper click sets focused pane` -> **Implement** click handler
8. **Test**: `PaneErrorBoundary renders children normally` -> **Implement** happy path
9. **Test**: `PaneErrorBoundary catches error and shows recovery UI` -> **Implement** error state
10. **Test**: `PaneErrorBoundary restart calls pty_kill then pty_spawn` -> **Implement** restart
11. **Test**: `SurfaceTabBar renders tabs` -> **Implement** tab list
12. **Test**: `SurfaceTabBar highlights active tab` -> **Implement** active style
13. **Test**: `SurfaceTabBar tab click calls onSurfaceSelect` -> **Implement** click handler
14. **Test**: `SurfaceTabBar has correct ARIA roles` -> **Implement** a11y attributes

### TDD Sequence for PR #4 (Keyboard Shortcuts)

1. **Test**: `useKeyboardShortcuts registers handler on mount` -> **Implement** hook
2. **Test**: `useKeyboardShortcuts removes handler on unmount` -> **Implement** cleanup
3. **Test**: `Ctrl+Shift+H triggers horizontal split` -> **Implement** split shortcut
4. **Test**: `Cmd+Shift+V triggers vertical split on macOS` -> **Implement** platform detection
5. **Test**: `Ctrl+W closes focused pane` -> **Implement** close shortcut
6. **Test**: `Ctrl+N creates new workspace` -> **Implement** create shortcut
7. **Test**: `Ctrl+1-9 switches workspaces` -> **Implement** workspace switching
8. **Test**: `Ctrl+Arrow navigates panes` -> **Implement** focus navigation
9. **Test**: `Ctrl+C is NOT captured (passes to terminal)` -> **Verify** exclusion
10. **Test**: `Ctrl+D is NOT captured` -> **Verify** exclusion
11. **Test**: `shortcut prevents event propagation to xterm.js` -> **Verify** stopPropagation

---

## Unit Tests

### Rust Unit Tests

| Module | Test | Description |
|--------|------|-------------|
| `workspace/state.rs` | `create_workspace_returns_valid_info` | Workspace has ID, name, 1 surface, 1 pane |
| | `create_workspace_spawns_pty` | PTY spawn is called during creation |
| | `create_workspace_emits_event` | `workspace-changed` event with `Created` type |
| | `close_workspace_removes_it` | Workspace no longer in list |
| | `close_workspace_kills_ptys` | All associated PTYs killed |
| | `close_workspace_emits_event` | `workspace-changed` event with `Closed` type |
| | `close_last_workspace_errors` | Cannot close the only remaining workspace |
| | `list_workspaces_returns_all` | All workspaces returned |
| `workspace/state.rs` (layout) | `split_pane_horizontal` | Leaf becomes Split with horizontal direction |
| | `split_pane_vertical` | Leaf becomes Split with vertical direction |
| | `split_pane_spawns_pty` | New PTY created for new pane |
| | `split_pane_emits_event` | `workspace-changed` event with `PaneSplit` type |
| | `split_nonexistent_pane_errors` | Error on unknown pane ID |
| | `close_pane_removes_leaf` | Pane removed from layout tree |
| | `close_pane_collapses_parent` | Parent split reduced to remaining child |
| | `close_pane_kills_pty` | Associated PTY killed |
| | `close_last_pane_closes_surface` | Surface removed when empty |
| | `close_last_surface_closes_workspace` | Workspace removed when no surfaces |
| | `deeply_nested_split_then_close` | 4-level deep split, close inner pane, tree collapses correctly |
| `workspace/types.rs` (proptest) | `layout_tree_serialize_roundtrip` | Any LayoutNode serializes and deserializes correctly |
| | `split_close_maintains_valid_tree` | Random sequence of splits and closes always produces a valid tree |

**Target: 100% line coverage on `workspace/` module.**

### Frontend Unit Tests

| File | Test | Description |
|------|------|-------------|
| `workspaceStore.test.ts` | 15+ tests | All store actions, selectors, event sync |
| `uiStore.test.ts` | 10+ tests | Focus tracking, panel visibility, adjacent pane navigation |
| `Sidebar.test.tsx` | 8+ tests | Rendering, active highlight, keyboard nav, create/close buttons |
| `PaneSplitter.test.tsx` | 10+ tests | Leaf, horizontal split, vertical split, nested, resize handle |
| `PaneWrapper.test.tsx` | 5+ tests | Type discrimination, active border, click handler |
| `PaneErrorBoundary.test.tsx` | 5+ tests | Normal render, error catch, restart, close |
| `SurfaceTabBar.test.tsx` | 8+ tests | Tab list, active tab, create/close, ARIA roles |
| `useKeyboardShortcuts.test.ts` | 11+ tests | All shortcuts, platform detection, exclusions |
| `tauri-bridge.test.ts` (extensions) | 5+ tests | workspace.create/close/list, pane.split/close |

**Target: 100% on stores, hooks, bridge. 90%+ on components.**

---

## Integration Tests

### Rust Integration Tests

| Test | Description |
|------|-------------|
| `workspace_create_with_real_pty` | Create workspace, verify PTY spawns, terminal prompt appears |
| `split_pane_creates_two_terminals` | Split pane, verify two independent PTYs exist and produce output |
| `close_pane_kills_pty_cleanly` | Close pane, verify PTY process exits, no orphans |
| `close_workspace_kills_all_ptys` | Create workspace with 3 panes, close workspace, verify all PTYs killed |
| `layout_tree_operations_sequence` | Create workspace, split 5 times, close 3 panes, verify tree integrity |
| `workspace_changed_event_contains_full_state` | Create workspace, split, verify event payload matches expected state |

### Frontend Integration Tests

| Test | Description |
|------|-------------|
| `workspace creation flow` | Mock Tauri, click "New Workspace", verify store update and sidebar item |
| `split pane flow` | Mock Tauri, trigger split shortcut, verify layout update and two terminal containers |
| `workspace switch flow` | Mock Tauri, click workspace in sidebar, verify active workspace changes and layout re-renders |
| `pane close cascade` | Mock Tauri, close last pane, verify workspace disappears from sidebar |
| `keyboard shortcut integration` | Render full AppLayout with mocked Tauri, test shortcut -> invoke -> event -> UI update chain |

---

## E2E Tests

| Test | Description |
|------|-------------|
| `create_workspace_via_keyboard` | Press `Ctrl+N`, verify new workspace appears in sidebar with terminal |
| `split_horizontal` | Press `Ctrl+Shift+H`, verify two terminals side by side |
| `split_vertical` | Press `Ctrl+Shift+V`, verify two terminals stacked |
| `close_pane_via_keyboard` | Split, then `Ctrl+W`, verify pane closes and layout collapses |
| `switch_workspace` | Create 2 workspaces, press `Ctrl+2`, verify second workspace is active |
| `navigate_panes` | Split, press `Ctrl+Right`, verify focus moves to right pane |
| `surface_tabs` | Create new surface tab, verify tab appears and new terminal is shown |
| `last_pane_closes_workspace` | Close all panes, verify workspace removed from sidebar |

---

## Acceptance Criteria

1. User can create multiple workspaces, each with independent terminals
2. User can split panes horizontally and vertically, to at least 4 levels of nesting
3. User can close panes; layout collapses correctly (no empty splits)
4. User can navigate between panes using `Ctrl/Cmd+Arrow` keys
5. User can switch workspaces using sidebar click or `Ctrl/Cmd+1-9`
6. User can create and switch surface tabs within a workspace
7. Switching surfaces preserves terminal scrollback (no terminal destruction)
8. All keyboard shortcuts work on macOS (`Cmd`) and Linux/Windows (`Ctrl`)
9. `Ctrl+C`, `Ctrl+D`, `Ctrl+Z` pass through to the terminal (not captured)
10. Sidebar shows all workspaces with active workspace highlighted
11. Error boundary prevents a crashing terminal from taking down the app
12. All tests pass on all platforms in CI
13. Coverage: 95% overall, 100% on `workspace/` Rust module, 100% on stores/hooks
14. `obelisk-protocol` crate created with shared workspace types

---

## Risks & Mitigations

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| `react-resizable-panels` performance with deep nesting (6+ levels) | Medium | Medium | Prototype in isolation first. `React.memo` on PaneWrapper. If too slow, evaluate `allotment` or CSS Grid. |
| Layout tree operations have edge cases (close pane in complex tree) | High | Medium | Property-based testing with proptest: random split/close sequences must always produce valid trees. |
| Keyboard shortcut conflicts with OS or xterm.js | Medium | Medium | Test all shortcuts on all 3 platforms in E2E. Maintain exclusion list for terminal signals. |
| `workspace-changed` event ordering with rapid mutations | Low | Low | Rust mutex serializes mutations. Event payloads contain full state, so out-of-order events still result in correct final state. |
| WebGL context exhaustion with many panes | Medium | Medium | Canvas fallback from Phase 1. Only active surface terminals get WebGL; hidden surfaces use canvas. |
| `Cmd+W` conflict on macOS (default: close window) | High | High | Override in `keydown` handler with `capture: true` and `preventDefault()`. Verify in E2E test. |
| Adjacent pane focus navigation algorithm correctness | Medium | Medium | The layout tree traversal for "find neighbor in direction X" is non-trivial. TDD with specific tree shapes (L-shape, nested, unequal sizes). |

---

## Dependencies

- **Phase 1**: All Phase 1 acceptance criteria must be met (working terminal, CI green, coverage thresholds met, benchmark baseline established).
- **Phase 1 deliverables used**: `PtyManager`, `TerminalPane`, `useTerminal`, `tauriBridge.pty.*`, CI pipeline, test infrastructure, mocks.
- **New external dependencies**: None. `react-resizable-panels` is already listed in the PRD's `package.json`.
