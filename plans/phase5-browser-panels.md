# Phase 5: Browser Panels — Implementation Plan

## 1. Objectives & Scope

Phase 5 adds embedded browser panels to Obelisk. Users can open a browser pane alongside terminal panes, navigate to URLs (typically `localhost` dev servers), and interact with web content without leaving the multiplexer.

### In Scope
- Iframe-based `BrowserPane` component for cross-platform reliability
- `BrowserToolbar` with URL bar, back/forward/refresh buttons
- Browser pane as a pane type within the existing split layout system
- Tauri multi-webview native browser behind a feature flag (`unstable`)
- Coordinate sync between React layout and native webview position/size
- Keyboard shortcut to open a browser pane in a split

### Out of Scope
- Bookmarks or browser history
- Browser extensions
- DevTools integration
- Cookie or session management
- Tabbed browsing within a single browser pane

### Key Decision References (from Rounds 1-3)
- Tauri `unstable` multi-webview is high risk — iframe-only is the primary implementation (tech lead Round 1, PM Round 1)
- Phase 5 is post-MVP — browser panels are low priority compared to terminal functionality (PM Round 1)
- Visual regression testing deferred to Phase 5+ (tech lead Round 3)
- 95% coverage CI gate, 90% minimum for components (QA Round 3)

---

## 2. Component Architecture

### Component Tree

```
<PaneWrapper pane={browserPane}>
  <PaneErrorBoundary paneId={pane.id} onRestart={...} onClose={...}>
    <BrowserPane
      paneId={pane.id}
      url={pane.url}
      isActive={isActive}
      useNativeWebview={featureFlags.unstableMultiWebview}
    />
  </PaneErrorBoundary>
</PaneWrapper>
```

### New Components

#### BrowserPane
```typescript
interface BrowserPaneProps {
  paneId: string;
  url: string;
  isActive: boolean;
  useNativeWebview: boolean;  // feature-flagged
}
```

Renders either an iframe or manages a native Tauri webview. The iframe is the default and always-available path. The native webview is gated behind a feature flag and requires `tauri unstable` features.

#### BrowserToolbar
```typescript
interface BrowserToolbarProps {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  onNavigate: (url: string) => void;
  onBack: () => void;
  onForward: () => void;
  onRefresh: () => void;
}
```

A thin horizontal bar above the browser content with URL input, navigation buttons, and loading indicator.

#### useBrowser (Hook)
```typescript
function useBrowser(paneId: string, initialUrl: string): {
  iframeRef: RefCallback<HTMLIFrameElement>;
  currentUrl: string;
  canGoBack: boolean;
  canGoForward: boolean;
  isLoading: boolean;
  navigate: (url: string) => void;
  goBack: () => void;
  goForward: () => void;
  refresh: () => void;
}
```

Manages browser navigation state. For iframe mode, navigation history is tracked internally (browsers restrict access to iframe's `history` object for cross-origin content). For native webview mode, navigation delegates to Tauri commands.

### Rust-Side Components (for native webview only)

#### New Tauri Commands (feature-gated)
```rust
#[cfg(feature = "unstable")]
#[tauri::command]
async fn browser_create(
    app: AppHandle,
    pane_id: String,
    url: String,
    bounds: WebviewBounds,
) -> Result<(), BackendError>

#[cfg(feature = "unstable")]
#[tauri::command]
async fn browser_navigate(
    app: AppHandle,
    pane_id: String,
    url: String,
) -> Result<(), BackendError>

#[cfg(feature = "unstable")]
#[tauri::command]
async fn browser_resize(
    app: AppHandle,
    pane_id: String,
    bounds: WebviewBounds,
) -> Result<(), BackendError>

#[cfg(feature = "unstable")]
#[tauri::command]
async fn browser_close(
    app: AppHandle,
    pane_id: String,
) -> Result<(), BackendError>

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WebviewBounds {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
```

---

## 3. Implementation Steps — TDD Order

Each step follows red-green-refactor. Tests are written FIRST.

### Step 1: Pane Type Extension
**Test first:**
```typescript
// workspaceStore.test.ts
it('supports browser pane type in workspace state', () => {
  const ws = mockWorkspaceWithBrowserPane();
  useWorkspaceStore.getState()._syncWorkspace(ws.id, ws);
  const pane = useWorkspaceStore.getState().getPaneById('browser-pane-1');
  expect(pane?.type).toBe('browser');
  expect(pane?.url).toBe('http://localhost:3000');
});
```

**Implement:**
- Extend `PaneInfo` type to include `url?: string` for browser panes
- Extend `PaneType` enum: `'terminal' | 'browser'`
- Update `PaneWrapper` to conditionally render `BrowserPane` based on pane type
- Add Rust-side `PaneType::Browser { url: String }` variant
- Add `pane_open_browser` Tauri command

### Step 2: BrowserToolbar Component
**Test first:**
```typescript
describe('BrowserToolbar', () => {
  it('renders URL input with current URL', () => {
    render(<BrowserToolbar url="http://localhost:3000" {...defaultProps} />);
    expect(screen.getByRole('textbox', { name: /url/i })).toHaveValue('http://localhost:3000');
  });

  it('calls onNavigate when URL is submitted', async () => {
    const onNavigate = vi.fn();
    render(<BrowserToolbar url="" onNavigate={onNavigate} {...defaultProps} />);
    const input = screen.getByRole('textbox', { name: /url/i });
    await userEvent.clear(input);
    await userEvent.type(input, 'http://localhost:8080{Enter}');
    expect(onNavigate).toHaveBeenCalledWith('http://localhost:8080');
  });

  it('disables back button when canGoBack is false', () => {
    render(<BrowserToolbar canGoBack={false} {...defaultProps} />);
    expect(screen.getByRole('button', { name: /back/i })).toBeDisabled();
  });

  it('disables forward button when canGoForward is false', () => {
    render(<BrowserToolbar canGoForward={false} {...defaultProps} />);
    expect(screen.getByRole('button', { name: /forward/i })).toBeDisabled();
  });

  it('calls onRefresh when refresh button clicked', async () => {
    const onRefresh = vi.fn();
    render(<BrowserToolbar onRefresh={onRefresh} {...defaultProps} />);
    await userEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(onRefresh).toHaveBeenCalled();
  });

  it('shows loading indicator when isLoading is true', () => {
    render(<BrowserToolbar isLoading={true} {...defaultProps} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('normalizes URLs without protocol', async () => {
    const onNavigate = vi.fn();
    render(<BrowserToolbar url="" onNavigate={onNavigate} {...defaultProps} />);
    const input = screen.getByRole('textbox', { name: /url/i });
    await userEvent.type(input, 'localhost:3000{Enter}');
    expect(onNavigate).toHaveBeenCalledWith('http://localhost:3000');
  });
});
```

**Implement:**
- `BrowserToolbar` component with URL input, back/forward/refresh buttons
- URL normalization (add `http://` if missing)
- Loading spinner indicator
- CSS Module for toolbar styling

### Step 3: useBrowser Hook (Iframe Mode)
**Test first:**
```typescript
describe('useBrowser (iframe mode)', () => {
  it('initializes with the provided URL', () => {
    const { result } = renderHook(() => useBrowser('p1', 'http://localhost:3000'));
    expect(result.current.currentUrl).toBe('http://localhost:3000');
  });

  it('navigate updates currentUrl', () => {
    const { result } = renderHook(() => useBrowser('p1', 'http://localhost:3000'));
    act(() => result.current.navigate('http://localhost:8080'));
    expect(result.current.currentUrl).toBe('http://localhost:8080');
  });

  it('tracks navigation history for back/forward', () => {
    const { result } = renderHook(() => useBrowser('p1', 'http://localhost:3000'));
    expect(result.current.canGoBack).toBe(false);

    act(() => result.current.navigate('http://localhost:8080'));
    expect(result.current.canGoBack).toBe(true);
    expect(result.current.canGoForward).toBe(false);

    act(() => result.current.goBack());
    expect(result.current.currentUrl).toBe('http://localhost:3000');
    expect(result.current.canGoForward).toBe(true);
  });

  it('goForward restores URL after goBack', () => {
    const { result } = renderHook(() => useBrowser('p1', 'http://localhost:3000'));
    act(() => result.current.navigate('http://localhost:8080'));
    act(() => result.current.goBack());
    act(() => result.current.goForward());
    expect(result.current.currentUrl).toBe('http://localhost:8080');
  });

  it('navigate after goBack clears forward history', () => {
    const { result } = renderHook(() => useBrowser('p1', 'http://localhost:3000'));
    act(() => result.current.navigate('http://localhost:8080'));
    act(() => result.current.goBack());
    act(() => result.current.navigate('http://localhost:9090'));
    expect(result.current.canGoForward).toBe(false);
  });

  it('reports loading state via onLoad iframe event', () => {
    // Test isLoading transitions
  });
});
```

**Implement:**
- `useBrowser` hook with internal navigation history stack
- `navigate`, `goBack`, `goForward`, `refresh` actions
- `isLoading` state tracking via iframe `onLoad` event
- Ref callback for iframe DOM attachment

### Step 4: BrowserPane Component (Iframe Mode)
**Test first:**
```typescript
describe('BrowserPane (iframe mode)', () => {
  it('renders iframe with correct src', () => {
    render(<BrowserPane paneId="p1" url="http://localhost:3000" isActive={true} useNativeWebview={false} />);
    const iframe = screen.getByTitle(/browser/i);
    expect(iframe).toHaveAttribute('src', 'http://localhost:3000');
  });

  it('renders BrowserToolbar above iframe', () => {
    render(<BrowserPane paneId="p1" url="http://localhost:3000" isActive={true} useNativeWebview={false} />);
    expect(screen.getByRole('textbox', { name: /url/i })).toBeInTheDocument();
  });

  it('updates iframe src when navigating via toolbar', async () => {
    render(<BrowserPane paneId="p1" url="http://localhost:3000" isActive={true} useNativeWebview={false} />);
    const input = screen.getByRole('textbox', { name: /url/i });
    await userEvent.clear(input);
    await userEvent.type(input, 'http://localhost:8080{Enter}');
    const iframe = screen.getByTitle(/browser/i);
    expect(iframe).toHaveAttribute('src', 'http://localhost:8080');
  });

  it('applies sandbox attribute to iframe for security', () => {
    render(<BrowserPane paneId="p1" url="http://localhost:3000" isActive={true} useNativeWebview={false} />);
    const iframe = screen.getByTitle(/browser/i);
    expect(iframe).toHaveAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
  });

  it('sets appropriate iframe permissions', () => {
    render(<BrowserPane paneId="p1" url="http://localhost:3000" isActive={true} useNativeWebview={false} />);
    const iframe = screen.getByTitle(/browser/i);
    expect(iframe).toHaveAttribute('allow', 'clipboard-read; clipboard-write');
  });
});
```

**Implement:**
- `BrowserPane` component rendering `BrowserToolbar` + `<iframe>`
- Iframe with `sandbox` attribute for security
- Wire toolbar actions to `useBrowser` hook
- CSS Module for layout (toolbar fixed at top, iframe fills remaining space)

### Step 5: Split into Browser Pane Action
**Test first (Rust):**
```rust
#[tokio::test]
async fn pane_open_browser_creates_browser_pane() {
    let state = test_app_state();
    let ws = state.workspace_state.read().await;
    // ... create workspace with terminal pane first
    let result = pane_open_browser(state.clone(), app.clone(), pane_id, "http://localhost:3000".into(), "horizontal".into()).await;
    assert!(result.is_ok());
    let ws = state.workspace_state.read().await;
    let new_pane = ws.get_pane(&result.unwrap().new_pane_id);
    assert!(matches!(new_pane.pane_type, PaneType::Browser { .. }));
}
```

**Test first (Frontend):**
```typescript
it('opens browser pane via tauriBridge', async () => {
  (invoke as Mock).mockResolvedValue({ newPaneId: 'bp1' });
  await tauriBridge.pane.openBrowser('p1', 'http://localhost:3000', 'horizontal');
  expect(invoke).toHaveBeenCalledWith('pane_open_browser', {
    paneId: 'p1',
    url: 'http://localhost:3000',
    direction: 'horizontal',
  });
});
```

**Implement:**
- Rust `pane_open_browser` command that splits the layout and creates a browser-type pane
- Frontend `tauriBridge.pane.openBrowser()` wrapper
- Keyboard shortcut: `Cmd/Ctrl+Shift+B` to open browser in a split

### Step 6: PaneWrapper Browser Type Rendering
**Test first:**
```typescript
describe('PaneWrapper', () => {
  it('renders TerminalPane for terminal type', () => {
    render(<PaneWrapper pane={terminalPane} isActive={true} hasNotification={false} />);
    expect(screen.getByTestId('terminal-container-p1')).toBeInTheDocument();
  });

  it('renders BrowserPane for browser type', () => {
    render(<PaneWrapper pane={browserPane} isActive={true} hasNotification={false} />);
    expect(screen.getByTitle(/browser/i)).toBeInTheDocument();
  });
});
```

**Implement:**
- Update `PaneWrapper` switch statement to handle `browser` pane type

### Step 7: Native Webview Integration (Feature-Flagged)
**Test first (Rust):**
```rust
#[cfg(feature = "unstable")]
#[tokio::test]
async fn browser_create_opens_native_webview() {
    let app = test_app_handle();
    let result = browser_create(app, "p1".into(), "http://localhost:3000".into(), test_bounds()).await;
    assert!(result.is_ok());
}

#[cfg(feature = "unstable")]
#[tokio::test]
async fn browser_resize_updates_webview_bounds() {
    // ...
}

#[cfg(feature = "unstable")]
#[tokio::test]
async fn browser_close_removes_webview() {
    // ...
}
```

**Implement:**
- Rust commands for Tauri multi-webview management
- Frontend: `BrowserPane` detects `useNativeWebview` prop and renders a positioned overlay div that Rust aligns the native webview to
- `ResizeObserver` on the overlay div to keep native webview bounds in sync with the React layout
- Fallback: if `unstable` feature is not available, silently fall back to iframe mode

### Step 8: Position Sync (Native Webview)
**Test first:**
```typescript
describe('BrowserPane (native webview mode)', () => {
  it('calls browser_create with correct bounds on mount', async () => {
    render(<BrowserPane paneId="p1" url="http://localhost:3000" isActive={true} useNativeWebview={true} />);
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('browser_create', expect.objectContaining({
        paneId: 'p1',
        url: 'http://localhost:3000',
      }));
    });
  });

  it('calls browser_resize when container resizes', async () => {
    // Mock ResizeObserver to trigger with new dimensions
  });

  it('calls browser_close on unmount', () => {
    const { unmount } = render(<BrowserPane paneId="p1" url="http://localhost:3000" isActive={true} useNativeWebview={true} />);
    unmount();
    expect(invoke).toHaveBeenCalledWith('browser_close', { paneId: 'p1' });
  });
});
```

**Implement:**
- `ResizeObserver` on browser container div
- Debounced `browser_resize` calls (every 100ms max during resize)
- `browser_close` on unmount

---

## 4. TDD Approach — Per Component

| Component | Write Test | Implement | Refactor |
|-----------|-----------|-----------|----------|
| `BrowserToolbar` | Test rendering, button states, URL submission, URL normalization | Minimal component with URL input + buttons | Extract URL normalization utility |
| `useBrowser` | Test navigation history, back/forward state, loading state | Hook with history stack and iframe ref | Extract history management to separate module if complex |
| `BrowserPane` (iframe) | Test iframe rendering, sandbox attrs, toolbar integration | Component composing toolbar + iframe | CSS module cleanup |
| `BrowserPane` (native) | Test Tauri command invocations, resize sync, cleanup | Conditional rendering with ResizeObserver | Debounce utility extraction |
| `PaneWrapper` update | Test type discrimination renders correct pane | Add `browser` case to switch | N/A |
| Rust commands | Test pane type creation, webview lifecycle | Tauri commands + browser module | N/A |

---

## 5. Unit Tests

### BrowserToolbar (8 tests minimum)
- Renders URL input with current URL
- Calls onNavigate on Enter
- Disables back button when canGoBack is false
- Disables forward button when canGoForward is false
- Calls onBack when back clicked
- Calls onForward when forward clicked
- Calls onRefresh when refresh clicked
- Normalizes URLs without protocol prefix
- Shows loading indicator when isLoading is true

### useBrowser Hook (10 tests minimum)
- Initializes with provided URL
- Navigate updates currentUrl
- Tracks back/forward history
- goBack returns to previous URL
- goForward after goBack restores URL
- Navigate after goBack clears forward history
- canGoBack is false initially
- canGoForward is false initially
- refresh does not change URL or history
- isLoading tracks iframe load state

### BrowserPane - Iframe Mode (7 tests minimum)
- Renders iframe with correct src
- Renders toolbar above iframe
- Updates iframe src on navigation
- Applies sandbox attribute
- Sets iframe permissions (clipboard)
- Fills available space below toolbar
- Handles iframe load errors gracefully

### BrowserPane - Native Webview Mode (5 tests minimum, feature-gated)
- Calls browser_create on mount with bounds
- Calls browser_resize on container resize
- Calls browser_close on unmount
- Falls back to iframe if native webview creation fails
- Passes navigation commands to Rust

### tauri-bridge Browser Commands (4 tests minimum)
- openBrowser calls invoke with correct args
- browserNavigate calls invoke with correct args
- browserResize calls invoke with correct args
- browserClose calls invoke with correct args

### Rust browser_commands (6 tests minimum, feature-gated)
- browser_create succeeds with valid pane and URL
- browser_create fails for nonexistent pane
- browser_navigate updates URL
- browser_resize updates bounds
- browser_close removes webview
- browser_close for nonexistent pane returns error

### PaneWrapper Update (2 tests minimum)
- Renders TerminalPane for terminal type
- Renders BrowserPane for browser type

**Total minimum unit tests: 42**

---

## 6. Integration Tests

### Component Integration (5 tests minimum)
- BrowserPane + BrowserToolbar: Navigate via toolbar updates iframe src
- BrowserPane + PaneSplitter: Browser pane renders correctly in split layout
- BrowserPane + PaneErrorBoundary: Iframe error is caught and shows recovery UI
- Workspace with mixed terminal + browser panes: Both render correctly
- Browser pane resize triggers FitAddon on adjacent terminal panes (no interference)

### Store Integration (3 tests minimum)
- Creating a browser pane via workspace-changed event updates workspaceStore
- Closing a browser pane via workspace-changed event removes it from store
- Browser pane URL is preserved in workspace state

### Rust Integration (3 tests minimum, feature-gated)
- Full lifecycle: create workspace -> open browser pane -> navigate -> close
- Browser pane persists URL in workspace state
- Workspace close kills all browser webviews

**Total minimum integration tests: 11**

---

## 7. E2E Tests

### Iframe Mode (4 tests minimum)
1. **Open browser pane**: Split pane -> select browser -> URL loads in iframe
2. **Navigate**: Type URL in toolbar -> iframe navigates to new URL
3. **Back/Forward**: Navigate to 3 URLs -> back -> forward -> URLs are correct
4. **Mixed layout**: Terminal + browser in split -> both functional simultaneously

### Native Webview Mode (2 tests, run only with `unstable` feature)
5. **Native webview renders**: Open browser pane in native mode -> content visible
6. **Position sync**: Resize the split -> native webview repositions correctly

**Total minimum E2E tests: 4 (+ 2 feature-gated)**

---

## 8. Acceptance Criteria

1. User can split a terminal pane and open a browser pane via keyboard shortcut (`Cmd/Ctrl+Shift+B`)
2. Browser pane displays `BrowserToolbar` with URL input, back/forward/refresh buttons
3. User can type a URL and press Enter to navigate
4. Back and forward buttons work correctly after navigation
5. Iframe mode works on all 3 platforms (macOS, Linux, Windows)
6. Iframe has `sandbox` attribute for security
7. Browser pane coexists with terminal panes in split layouts without interference
8. Browser pane URL is included in workspace state (visible via `workspace-changed` event)
9. Closing a browser pane does not affect adjacent terminal panes
10. Error in browser pane is caught by `PaneErrorBoundary` and does not crash the app
11. (Feature-flagged) Native webview renders content and stays synchronized with React layout position
12. All tests pass on all 3 platforms in CI
13. Coverage meets thresholds (95% overall, 90% minimum for browser components)

---

## 9. Accessibility Requirements

- `BrowserToolbar` URL input has `aria-label="URL"` and `role="textbox"`
- Navigation buttons have `aria-label` attributes: "Go back", "Go forward", "Refresh page"
- Disabled buttons have `aria-disabled="true"` and are not focusable
- Loading indicator has `role="progressbar"` with `aria-label="Loading"`
- Iframe has `title` attribute for screen readers: `title="Browser panel"`
- Keyboard navigation: Tab enters toolbar, arrow keys move between toolbar buttons, Escape returns focus to parent pane
- Browser pane is reachable via the same `Cmd/Ctrl+Arrow` pane navigation as terminal panes

---

## 10. Dependencies on Prior Phases

| Dependency | Phase | What's Needed |
|-----------|-------|---------------|
| Split pane system | Phase 2 | `PaneSplitter` supports mixed pane types |
| `PaneWrapper` type discrimination | Phase 2 | Switch on pane type to render correct component |
| `PaneErrorBoundary` | Phase 2 | Wraps browser panes for error isolation |
| `workspaceStore` | Phase 2 | Mirrors browser pane state from Rust |
| Keyboard shortcut system | Phase 2 | Registers `Cmd/Ctrl+Shift+B` for browser split |
| `workspace-changed` event | Phase 2 | Includes browser pane data in workspace state |
| Session persistence | Phase 3a | Persists browser pane URLs in layout JSON |
| Rust workspace types | Phase 2 | `PaneType::Browser` variant in workspace state |
