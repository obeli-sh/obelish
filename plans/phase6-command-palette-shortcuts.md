# Phase 6: Command Palette & Keyboard Shortcuts — Implementation Plan

## 1. Objectives & Scope

Phase 6 adds a discoverable command palette and user-customizable keyboard shortcuts. Phase 2 shipped hardcoded keyboard shortcuts for core actions (split, close, navigate). Phase 6 wraps those commands in a searchable palette UI, adds the ability to customize keybindings, and surfaces all available actions for discoverability.

### In Scope
- Command palette overlay (`Cmd/Ctrl+Shift+P`) with fuzzy search
- Command registry — single source of truth for all available actions
- Keybinding customization UI in settings modal
- Settings modal for general preferences (font, scrollback, theme selector)
- Conflict detection for custom keybindings
- Persist custom keybindings to settings store (Rust-owned)
- Platform-aware modifier display (`Cmd` on macOS, `Ctrl` on Windows/Linux)

### Out of Scope
- Plugin/extension system for adding custom commands
- Multiple keybinding profiles
- Vim/Emacs keybinding modes
- Command history or recent commands

### Key Decision References (from Rounds 1-3)
- Basic keyboard shortcuts were moved to Phase 2 (PM Round 1, all agreed)
- Phase 6 is specifically for the palette and customization UI (PM Round 1)
- CSS Modules + CSS Variables for theming (frontend Round 1)
- 95% coverage CI gate, 100% on stores/hooks (QA Round 3)
- No optimistic updates on structural changes — palette commands invoke Rust then wait for events (frontend Round 2)
- Settings persistence is Rust-owned via the settings Tauri commands (tech lead Round 3)

---

## 2. Component Architecture

### Component Tree

```
<App>
  ...existing tree...
  <CommandPalette
    isOpen={uiStore.commandPaletteOpen}
    onClose={closePalette}
    commands={commandRegistry.getAll()}
    onExecute={executeCommand}
  />
  <SettingsModal
    isOpen={uiStore.settingsOpen}
    onClose={closeSettings}
  >
    <KeybindingEditor
      commands={commandRegistry.getAll()}
      keybindings={settingsStore.keybindings}
      onUpdate={updateKeybinding}
      onReset={resetKeybinding}
    />
  </SettingsModal>
</App>
```

### New Components

#### CommandPalette
```typescript
interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  commands: Command[];
  onExecute: (commandId: string) => void;
}
```

Overlay modal with search input. Filters commands via fuzzy search (fuse.js). Keyboard navigable (arrow keys to select, Enter to execute, Escape to close). Shows command name, description, and current keybinding.

#### SettingsModal
```typescript
interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  children: React.ReactNode;
}
```

Generic modal container for settings sections. Phase 6 adds the keybinding editor. Phase 8 adds theme and font settings sections.

#### KeybindingEditor
```typescript
interface KeybindingEditorProps {
  commands: Command[];
  keybindings: Record<string, KeyBinding>;
  onUpdate: (commandId: string, binding: KeyBinding) => void;
  onReset: (commandId: string) => void;
}

interface KeyBinding {
  key: string;          // e.g., "h", "w", "1", "ArrowUp"
  mod: boolean;         // Cmd (macOS) or Ctrl (Windows/Linux)
  shift: boolean;
  alt: boolean;
}
```

List of commands with their current keybindings. Click a binding to enter "recording mode" — press a key combination to set it. Shows conflict warnings if a binding is already used.

### New Hooks

#### useCommands
```typescript
function useCommands(): {
  commands: Command[];
  execute: (commandId: string) => void;
  getCommand: (id: string) => Command | undefined;
}
```

Provides access to the command registry and execution. Commands are registered once at app startup and do not change. Each command has an `id`, `label`, `description`, `category`, `defaultBinding`, and an `execute` function.

#### useKeyboardShortcuts (Updated)
The Phase 2 version used a hardcoded shortcut map. Phase 6 replaces it with a dynamic system that reads from `settingsStore.keybindings`:

```typescript
function useKeyboardShortcuts(): void;
// Reads keybindings from settingsStore
// Registers a single window-level keydown listener
// Matches incoming keystrokes against all bindings
// Executes the matching command
```

### New Store

#### settingsStore
```typescript
interface SettingsStoreState {
  keybindings: Record<string, KeyBinding>;  // commandId -> binding
  theme: 'dark' | 'light' | 'system';
  terminalFontFamily: string;
  terminalFontSize: number;
  scrollbackLines: number;
  // Actions
  updateKeybinding: (commandId: string, binding: KeyBinding) => void;
  resetKeybinding: (commandId: string) => void;
  resetAllKeybindings: () => void;
  updateTheme: (theme: 'dark' | 'light' | 'system') => void;
  updateFontFamily: (font: string) => void;
  updateFontSize: (size: number) => void;
  _syncSettings: (settings: Settings) => void;  // from Rust event
}
```

Like `workspaceStore`, `settingsStore` is a projection of Rust state. All mutations go through `invoke()` to Rust, which persists to the settings JSON file and emits a `settings-changed` event.

### Rust-Side

#### New Tauri Commands
```rust
#[tauri::command]
async fn settings_get(state: State<'_, AppState>) -> Result<Settings, BackendError>

#[tauri::command]
async fn settings_update(
    state: State<'_, AppState>,
    app: AppHandle,
    key: String,
    value: serde_json::Value,
) -> Result<(), BackendError>
// Emits "settings-changed" event after update

#[tauri::command]
async fn settings_reset(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), BackendError>
```

#### New Event
```rust
// Event name: "settings-changed"
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SettingsChangedPayload {
    pub settings: Settings,
}
```

### Command Registry

```typescript
// lib/commands.ts — single source of truth for all commands
interface Command {
  id: string;
  label: string;
  description: string;
  category: 'workspace' | 'pane' | 'terminal' | 'browser' | 'navigation' | 'app';
  defaultBinding: KeyBinding | null;
  execute: () => void | Promise<void>;
}

const commands: Command[] = [
  {
    id: 'pane.splitHorizontal',
    label: 'Split Pane Horizontally',
    description: 'Split the focused pane into two horizontal panels',
    category: 'pane',
    defaultBinding: { key: 'h', mod: true, shift: true, alt: false },
    execute: () => tauriBridge.pane.split(uiStore.getState().focusedPaneId!, 'horizontal'),
  },
  {
    id: 'pane.splitVertical',
    label: 'Split Pane Vertically',
    description: 'Split the focused pane into two vertical panels',
    category: 'pane',
    defaultBinding: { key: 'v', mod: true, shift: true, alt: false },
    execute: () => tauriBridge.pane.split(uiStore.getState().focusedPaneId!, 'vertical'),
  },
  {
    id: 'pane.close',
    label: 'Close Pane',
    description: 'Close the focused pane',
    category: 'pane',
    defaultBinding: { key: 'w', mod: true, shift: false, alt: false },
    execute: () => tauriBridge.pane.close(uiStore.getState().focusedPaneId!),
  },
  {
    id: 'workspace.create',
    label: 'New Workspace',
    description: 'Create a new workspace',
    category: 'workspace',
    defaultBinding: { key: 'n', mod: true, shift: false, alt: false },
    execute: () => tauriBridge.workspace.create(),
  },
  {
    id: 'app.commandPalette',
    label: 'Command Palette',
    description: 'Open the command palette',
    category: 'app',
    defaultBinding: { key: 'p', mod: true, shift: true, alt: false },
    execute: () => uiStore.getState().toggleCommandPalette(),
  },
  {
    id: 'app.settings',
    label: 'Open Settings',
    description: 'Open the settings panel',
    category: 'app',
    defaultBinding: { key: ',', mod: true, shift: false, alt: false },
    execute: () => uiStore.getState().toggleSettings(),
  },
  {
    id: 'app.toggleNotifications',
    label: 'Toggle Notification Panel',
    description: 'Show or hide the notification panel',
    category: 'app',
    defaultBinding: { key: 'i', mod: true, shift: false, alt: false },
    execute: () => uiStore.getState().toggleNotificationPanel(),
  },
  // ... workspace switch 1-9, pane navigation, browser open, etc.
];
```

---

## 3. Implementation Steps — TDD Order

### Step 1: Command Registry
**Test first:**
```typescript
describe('Command Registry', () => {
  it('returns all registered commands', () => {
    const cmds = getCommands();
    expect(cmds.length).toBeGreaterThan(0);
  });

  it('every command has a unique id', () => {
    const cmds = getCommands();
    const ids = cmds.map(c => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every command has a label and category', () => {
    const cmds = getCommands();
    cmds.forEach(cmd => {
      expect(cmd.label).toBeTruthy();
      expect(cmd.category).toBeTruthy();
    });
  });

  it('getCommandById returns correct command', () => {
    const cmd = getCommandById('pane.splitHorizontal');
    expect(cmd?.label).toBe('Split Pane Horizontally');
  });

  it('getCommandById returns undefined for unknown id', () => {
    expect(getCommandById('nonexistent')).toBeUndefined();
  });

  it('commands with defaultBinding have valid key structures', () => {
    const cmds = getCommands().filter(c => c.defaultBinding);
    cmds.forEach(cmd => {
      expect(cmd.defaultBinding!.key).toBeTruthy();
      expect(typeof cmd.defaultBinding!.mod).toBe('boolean');
      expect(typeof cmd.defaultBinding!.shift).toBe('boolean');
      expect(typeof cmd.defaultBinding!.alt).toBe('boolean');
    });
  });
});
```

**Implement:**
- `lib/commands.ts` — command definitions and registry functions
- Export `getCommands()`, `getCommandById()`, `getCommandsByCategory()`

### Step 2: settingsStore
**Test first:**
```typescript
describe('settingsStore', () => {
  beforeEach(() => useSettingsStore.setState(defaultSettingsState));

  it('initializes with default keybindings', () => {
    const state = useSettingsStore.getState();
    expect(state.keybindings['pane.splitHorizontal']).toEqual({
      key: 'h', mod: true, shift: true, alt: false,
    });
  });

  it('updateKeybinding changes the binding for a command', () => {
    useSettingsStore.getState().updateKeybinding('pane.splitHorizontal', {
      key: 'd', mod: true, shift: true, alt: false,
    });
    expect(useSettingsStore.getState().keybindings['pane.splitHorizontal'].key).toBe('d');
  });

  it('resetKeybinding restores default for a command', () => {
    useSettingsStore.getState().updateKeybinding('pane.splitHorizontal', {
      key: 'd', mod: true, shift: true, alt: false,
    });
    useSettingsStore.getState().resetKeybinding('pane.splitHorizontal');
    expect(useSettingsStore.getState().keybindings['pane.splitHorizontal'].key).toBe('h');
  });

  it('resetAllKeybindings restores all defaults', () => {
    useSettingsStore.getState().updateKeybinding('pane.splitHorizontal', {
      key: 'd', mod: true, shift: true, alt: false,
    });
    useSettingsStore.getState().resetAllKeybindings();
    expect(useSettingsStore.getState().keybindings['pane.splitHorizontal'].key).toBe('h');
  });

  it('_syncSettings replaces all settings from Rust event', () => {
    const newSettings = { ...defaultSettings, theme: 'light' as const };
    useSettingsStore.getState()._syncSettings(newSettings);
    expect(useSettingsStore.getState().theme).toBe('light');
  });

  it('getEffectiveBinding returns custom binding over default', () => {
    useSettingsStore.getState().updateKeybinding('pane.close', {
      key: 'q', mod: true, shift: false, alt: false,
    });
    const binding = useSettingsStore.getState().keybindings['pane.close'];
    expect(binding.key).toBe('q');
  });
});
```

**Implement:**
- `stores/settingsStore.ts` with keybindings, theme, font settings
- Default keybindings initialized from command registry's `defaultBinding`
- `_syncSettings` handler for `settings-changed` Tauri event

### Step 3: Fuzzy Search Utility
**Test first:**
```typescript
describe('fuzzy search', () => {
  const commands = [
    { id: '1', label: 'Split Pane Horizontally', category: 'pane' },
    { id: '2', label: 'Split Pane Vertically', category: 'pane' },
    { id: '3', label: 'Close Pane', category: 'pane' },
    { id: '4', label: 'New Workspace', category: 'workspace' },
    { id: '5', label: 'Open Settings', category: 'app' },
  ];

  it('returns all commands for empty query', () => {
    const results = fuzzySearchCommands(commands, '');
    expect(results).toHaveLength(5);
  });

  it('filters by partial match', () => {
    const results = fuzzySearchCommands(commands, 'split');
    expect(results).toHaveLength(2);
    expect(results.map(r => r.id)).toEqual(['1', '2']);
  });

  it('handles fuzzy matching', () => {
    const results = fuzzySearchCommands(commands, 'sph');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe('1'); // "Split Pane Horizontally" matches "sph"
  });

  it('matches category names', () => {
    const results = fuzzySearchCommands(commands, 'workspace');
    expect(results.some(r => r.id === '4')).toBe(true);
  });

  it('returns empty for no match', () => {
    const results = fuzzySearchCommands(commands, 'zzzzz');
    expect(results).toHaveLength(0);
  });

  it('ranks exact prefix matches higher', () => {
    const results = fuzzySearchCommands(commands, 'close');
    expect(results[0].id).toBe('3');
  });
});
```

**Implement:**
- `lib/fuzzy-search.ts` using `fuse.js` for fuzzy matching
- Search across `label`, `description`, and `category` fields
- Return results sorted by relevance score

### Step 4: CommandPalette Component
**Test first:**
```typescript
describe('CommandPalette', () => {
  const commands = mockCommands();
  const onExecute = vi.fn();
  const onClose = vi.fn();

  it('renders nothing when closed', () => {
    render(<CommandPalette isOpen={false} onClose={onClose} commands={commands} onExecute={onExecute} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders overlay with search input when open', () => {
    render(<CommandPalette isOpen={true} onClose={onClose} commands={commands} onExecute={onExecute} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('searchbox')).toBeInTheDocument();
  });

  it('focuses search input on open', () => {
    render(<CommandPalette isOpen={true} onClose={onClose} commands={commands} onExecute={onExecute} />);
    expect(screen.getByRole('searchbox')).toHaveFocus();
  });

  it('lists all commands initially', () => {
    render(<CommandPalette isOpen={true} onClose={onClose} commands={commands} onExecute={onExecute} />);
    expect(screen.getAllByRole('option').length).toBe(commands.length);
  });

  it('filters commands as user types', async () => {
    render(<CommandPalette isOpen={true} onClose={onClose} commands={commands} onExecute={onExecute} />);
    await userEvent.type(screen.getByRole('searchbox'), 'split');
    const options = screen.getAllByRole('option');
    options.forEach(opt => {
      expect(opt.textContent?.toLowerCase()).toContain('split');
    });
  });

  it('highlights first result by default', () => {
    render(<CommandPalette isOpen={true} onClose={onClose} commands={commands} onExecute={onExecute} />);
    const firstOption = screen.getAllByRole('option')[0];
    expect(firstOption).toHaveAttribute('aria-selected', 'true');
  });

  it('navigates results with arrow keys', async () => {
    render(<CommandPalette isOpen={true} onClose={onClose} commands={commands} onExecute={onExecute} />);
    await userEvent.keyboard('{ArrowDown}');
    const secondOption = screen.getAllByRole('option')[1];
    expect(secondOption).toHaveAttribute('aria-selected', 'true');
  });

  it('executes selected command on Enter', async () => {
    render(<CommandPalette isOpen={true} onClose={onClose} commands={commands} onExecute={onExecute} />);
    await userEvent.keyboard('{Enter}');
    expect(onExecute).toHaveBeenCalledWith(commands[0].id);
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    render(<CommandPalette isOpen={true} onClose={onClose} commands={commands} onExecute={onExecute} />);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when clicking overlay backdrop', async () => {
    render(<CommandPalette isOpen={true} onClose={onClose} commands={commands} onExecute={onExecute} />);
    await userEvent.click(screen.getByTestId('palette-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('displays keybinding next to command', () => {
    render(<CommandPalette isOpen={true} onClose={onClose} commands={commands} onExecute={onExecute} />);
    // Assuming first command has a keybinding
    expect(screen.getByText(/Ctrl\+Shift\+H|Cmd\+Shift\+H/)).toBeInTheDocument();
  });

  it('executes command on click', async () => {
    render(<CommandPalette isOpen={true} onClose={onClose} commands={commands} onExecute={onExecute} />);
    await userEvent.click(screen.getAllByRole('option')[2]);
    expect(onExecute).toHaveBeenCalledWith(commands[2].id);
  });
});
```

**Implement:**
- `CommandPalette` component with overlay, search input, scrollable results list
- Fuse.js integration for fuzzy search
- Arrow key navigation with `aria-selected` tracking
- Display keybinding badges next to command labels
- CSS Module for palette styling (centered overlay, blur backdrop)
- Focus trap: Tab stays within the palette while open

### Step 5: useKeyboardShortcuts (Dynamic Version)
**Test first:**
```typescript
describe('useKeyboardShortcuts (dynamic)', () => {
  it('executes command matching keybinding', () => {
    const execute = vi.fn();
    renderHook(() => useKeyboardShortcuts());

    // Simulate Ctrl+Shift+H
    fireEvent.keyDown(window, { key: 'h', ctrlKey: true, shiftKey: true });
    // Verify the splitHorizontal command was executed
  });

  it('uses custom keybinding from settingsStore', () => {
    useSettingsStore.getState().updateKeybinding('pane.splitHorizontal', {
      key: 'd', mod: true, shift: true, alt: false,
    });
    renderHook(() => useKeyboardShortcuts());

    fireEvent.keyDown(window, { key: 'd', ctrlKey: true, shiftKey: true });
    // Verify splitHorizontal executed
  });

  it('does not execute when modifier does not match', () => {
    renderHook(() => useKeyboardShortcuts());
    fireEvent.keyDown(window, { key: 'h', ctrlKey: false, shiftKey: true });
    // Verify no command executed
  });

  it('does not capture terminal passthrough keys', () => {
    renderHook(() => useKeyboardShortcuts());
    fireEvent.keyDown(window, { key: 'c', ctrlKey: true }); // Ctrl+C
    // Verify NOT intercepted (should reach terminal)
  });

  it('cleans up event listener on unmount', () => {
    const removeListenerSpy = vi.spyOn(window, 'removeEventListener');
    const { unmount } = renderHook(() => useKeyboardShortcuts());
    unmount();
    expect(removeListenerSpy).toHaveBeenCalledWith('keydown', expect.any(Function), expect.any(Object));
  });

  it('updates bindings when settingsStore changes', () => {
    renderHook(() => useKeyboardShortcuts());
    // Change binding after hook is mounted
    act(() => {
      useSettingsStore.getState().updateKeybinding('pane.splitHorizontal', {
        key: 'x', mod: true, shift: true, alt: false,
      });
    });
    // New binding should work
    fireEvent.keyDown(window, { key: 'x', ctrlKey: true, shiftKey: true });
    // Verify splitHorizontal executed
  });
});
```

**Implement:**
- Rewrite `useKeyboardShortcuts` to read from `settingsStore.keybindings`
- Match keystroke against all active bindings
- Passthrough list: `Ctrl+C`, `Ctrl+D`, `Ctrl+Z`, `Ctrl+L` — never intercepted
- Uses `capture: true` to fire before xterm.js

### Step 6: Keybinding Conflict Detection
**Test first:**
```typescript
describe('keybinding conflict detection', () => {
  it('detects conflict when two commands share the same binding', () => {
    const bindings = {
      'pane.splitHorizontal': { key: 'h', mod: true, shift: true, alt: false },
      'pane.close': { key: 'h', mod: true, shift: true, alt: false },
    };
    const conflicts = detectConflicts(bindings);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].commands).toEqual(['pane.splitHorizontal', 'pane.close']);
  });

  it('returns empty array when no conflicts', () => {
    const bindings = {
      'pane.splitHorizontal': { key: 'h', mod: true, shift: true, alt: false },
      'pane.close': { key: 'w', mod: true, shift: false, alt: false },
    };
    expect(detectConflicts(bindings)).toHaveLength(0);
  });

  it('treats different modifiers as non-conflicting', () => {
    const bindings = {
      'cmd1': { key: 'h', mod: true, shift: true, alt: false },
      'cmd2': { key: 'h', mod: true, shift: false, alt: false },
    };
    expect(detectConflicts(bindings)).toHaveLength(0);
  });
});
```

**Implement:**
- `lib/keybinding-utils.ts` — `detectConflicts()`, `bindingToString()`, `bindingsEqual()`
- `bindingToString()` for display: `"Ctrl+Shift+H"` or `"Cmd+Shift+H"` based on platform

### Step 7: KeybindingEditor Component
**Test first:**
```typescript
describe('KeybindingEditor', () => {
  it('lists all commands with their current bindings', () => {
    render(<KeybindingEditor commands={mockCommands()} keybindings={defaultBindings} onUpdate={vi.fn()} onReset={vi.fn()} />);
    expect(screen.getByText('Split Pane Horizontally')).toBeInTheDocument();
    expect(screen.getByText(/Ctrl\+Shift\+H|Cmd\+Shift\+H/)).toBeInTheDocument();
  });

  it('enters recording mode when binding is clicked', async () => {
    render(<KeybindingEditor commands={mockCommands()} keybindings={defaultBindings} onUpdate={vi.fn()} onReset={vi.fn()} />);
    await userEvent.click(screen.getByText(/Ctrl\+Shift\+H|Cmd\+Shift\+H/));
    expect(screen.getByText(/press a key combination/i)).toBeInTheDocument();
  });

  it('records new keybinding and calls onUpdate', async () => {
    const onUpdate = vi.fn();
    render(<KeybindingEditor commands={mockCommands()} keybindings={defaultBindings} onUpdate={onUpdate} onReset={vi.fn()} />);
    // Click to start recording
    await userEvent.click(screen.getByText(/Ctrl\+Shift\+H|Cmd\+Shift\+H/));
    // Press new key combination
    fireEvent.keyDown(screen.getByTestId('keybinding-recorder'), { key: 'd', ctrlKey: true, shiftKey: true });
    expect(onUpdate).toHaveBeenCalledWith('pane.splitHorizontal', {
      key: 'd', mod: true, shift: true, alt: false,
    });
  });

  it('shows conflict warning for duplicate bindings', () => {
    const conflictingBindings = {
      ...defaultBindings,
      'pane.close': { key: 'h', mod: true, shift: true, alt: false }, // conflicts with splitHorizontal
    };
    render(<KeybindingEditor commands={mockCommands()} keybindings={conflictingBindings} onUpdate={vi.fn()} onReset={vi.fn()} />);
    expect(screen.getByText(/conflict/i)).toBeInTheDocument();
  });

  it('calls onReset to restore default binding', async () => {
    const onReset = vi.fn();
    render(<KeybindingEditor commands={mockCommands()} keybindings={defaultBindings} onUpdate={vi.fn()} onReset={onReset} />);
    await userEvent.click(screen.getAllByRole('button', { name: /reset/i })[0]);
    expect(onReset).toHaveBeenCalledWith('pane.splitHorizontal');
  });

  it('cancels recording on Escape', async () => {
    render(<KeybindingEditor commands={mockCommands()} keybindings={defaultBindings} onUpdate={vi.fn()} onReset={vi.fn()} />);
    await userEvent.click(screen.getByText(/Ctrl\+Shift\+H|Cmd\+Shift\+H/));
    fireEvent.keyDown(screen.getByTestId('keybinding-recorder'), { key: 'Escape' });
    expect(screen.queryByText(/press a key combination/i)).not.toBeInTheDocument();
  });

  it('groups commands by category', () => {
    render(<KeybindingEditor commands={mockCommands()} keybindings={defaultBindings} onUpdate={vi.fn()} onReset={vi.fn()} />);
    expect(screen.getByText('Pane')).toBeInTheDocument();
    expect(screen.getByText('Workspace')).toBeInTheDocument();
    expect(screen.getByText('App')).toBeInTheDocument();
  });
});
```

**Implement:**
- `KeybindingEditor` component with command list grouped by category
- "Recording mode" overlay that captures the next keystroke as the new binding
- Conflict detection display (warning badge next to conflicting bindings)
- Reset button per binding

### Step 8: SettingsModal Component
**Test first:**
```typescript
describe('SettingsModal', () => {
  it('renders nothing when closed', () => {
    render(<SettingsModal isOpen={false} onClose={vi.fn()}><div>content</div></SettingsModal>);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders dialog with children when open', () => {
    render(<SettingsModal isOpen={true} onClose={vi.fn()}><div>content</div></SettingsModal>);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('content')).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const onClose = vi.fn();
    render(<SettingsModal isOpen={true} onClose={onClose}><div>content</div></SettingsModal>);
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes when clicking backdrop', async () => {
    const onClose = vi.fn();
    render(<SettingsModal isOpen={true} onClose={onClose}><div>content</div></SettingsModal>);
    await userEvent.click(screen.getByTestId('settings-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('traps focus within the modal', () => {
    render(<SettingsModal isOpen={true} onClose={vi.fn()}><button>btn1</button><button>btn2</button></SettingsModal>);
    // Tab should cycle within modal, not escape to app
  });
});
```

**Implement:**
- Generic modal component with backdrop, close on Escape, focus trap
- CSS Module for modal styling

### Step 9: Settings Persistence via Rust
**Test first (Rust):**
```rust
#[tokio::test]
async fn settings_get_returns_default_settings() {
    let state = test_app_state();
    let result = settings_get(state).await.unwrap();
    assert_eq!(result.theme, "dark");
    assert!(result.keybindings.contains_key("pane.splitHorizontal"));
}

#[tokio::test]
async fn settings_update_persists_keybinding_change() {
    let state = test_app_state();
    settings_update(state.clone(), app.clone(), "keybindings.pane.splitHorizontal".into(), json!({"key": "d", "mod": true, "shift": true, "alt": false})).await.unwrap();
    let result = settings_get(state).await.unwrap();
    assert_eq!(result.keybindings["pane.splitHorizontal"]["key"], "d");
}

#[tokio::test]
async fn settings_update_emits_settings_changed_event() {
    // Verify event is emitted after update
}

#[tokio::test]
async fn settings_reset_restores_defaults() {
    let state = test_app_state();
    settings_update(state.clone(), app.clone(), "theme".into(), json!("light")).await.unwrap();
    settings_reset(state.clone(), app.clone()).await.unwrap();
    let result = settings_get(state).await.unwrap();
    assert_eq!(result.theme, "dark");
}
```

**Test first (Frontend bridge):**
```typescript
describe('tauriBridge.settings', () => {
  it('get calls invoke correctly', async () => {
    (invoke as Mock).mockResolvedValue(defaultSettings);
    const result = await tauriBridge.settings.get();
    expect(invoke).toHaveBeenCalledWith('settings_get');
    expect(result.theme).toBe('dark');
  });

  it('update calls invoke with key and value', async () => {
    await tauriBridge.settings.update('theme', 'light');
    expect(invoke).toHaveBeenCalledWith('settings_update', { key: 'theme', value: 'light' });
  });

  it('reset calls invoke', async () => {
    await tauriBridge.settings.reset();
    expect(invoke).toHaveBeenCalledWith('settings_reset');
  });
});
```

**Implement:**
- Rust `settings_get`, `settings_update`, `settings_reset` commands
- Settings stored as JSON in Tauri app data directory (same atomic write pattern as session persistence)
- `settings-changed` event emitted after every update
- Frontend `tauriBridge.settings` wrappers

### Step 10: Wire Everything Together
**Test first:**
```typescript
describe('Command palette integration', () => {
  it('Cmd/Ctrl+Shift+P opens palette', () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true, shiftKey: true });
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('executing a command from palette triggers the action', async () => {
    render(<App />);
    fireEvent.keyDown(window, { key: 'p', ctrlKey: true, shiftKey: true });
    // Type to filter
    await userEvent.type(screen.getByRole('searchbox'), 'new workspace');
    await userEvent.keyboard('{Enter}');
    // Verify workspace.create was invoked
    expect(invoke).toHaveBeenCalledWith('workspace_create', expect.any(Object));
  });
});
```

**Implement:**
- Register `Cmd/Ctrl+Shift+P` for command palette toggle
- Register `Cmd/Ctrl+,` for settings modal toggle
- Wire command execution through `useCommands` hook
- Load settings from Rust on app startup via `settings_get`
- Subscribe to `settings-changed` event for live updates

---

## 4. TDD Approach — Per Component

| Component | Write Test | Implement | Refactor |
|-----------|-----------|-----------|----------|
| Command Registry | Test uniqueness, lookups, structure | Define all commands | Group by category |
| settingsStore | Test CRUD, sync, defaults | Zustand store | N/A |
| Fuzzy Search | Test filtering, ranking, edge cases | Fuse.js wrapper | Tune scoring weights |
| CommandPalette | Test open/close, search, navigation, execute | Overlay + search + list | Extract PaletteItem component |
| useKeyboardShortcuts | Test matching, passthrough, cleanup, dynamic updates | Window keydown handler | N/A |
| Conflict Detection | Test duplicate detection, modifier differentiation | Utility function | N/A |
| KeybindingEditor | Test recording mode, conflicts, reset, grouping | Editor component | Extract RecordingOverlay |
| SettingsModal | Test open/close, focus trap, backdrop click | Generic modal | N/A |
| Rust settings commands | Test get/update/reset, persistence, events | Tauri commands | N/A |

---

## 5. Unit Tests

### Command Registry (6 tests minimum)
- All commands have unique IDs
- All commands have label and category
- getCommandById returns correct command
- getCommandById returns undefined for unknown
- getCommandsByCategory filters correctly
- Default bindings are valid KeyBinding structures

### settingsStore (8 tests minimum)
- Initializes with default keybindings
- updateKeybinding changes binding
- resetKeybinding restores default
- resetAllKeybindings restores all defaults
- _syncSettings replaces full state
- Theme setting updates correctly
- Font settings update correctly
- Scrollback setting updates correctly

### Fuzzy Search (6 tests minimum)
- Empty query returns all commands
- Partial match filters correctly
- Fuzzy matching works (non-contiguous characters)
- Category name matching
- No match returns empty
- Exact prefix match ranks highest

### CommandPalette (12 tests minimum)
- Hidden when isOpen is false
- Renders overlay when open
- Focuses search input on open
- Lists all commands initially
- Filters on input
- Highlights first result
- Arrow key navigation
- Enter executes selected
- Escape closes
- Backdrop click closes
- Displays keybinding badges
- Click on command executes it

### useKeyboardShortcuts (6 tests minimum)
- Executes matching command
- Uses custom bindings from store
- Ignores non-matching keystrokes
- Does not capture passthrough keys (Ctrl+C, Ctrl+D)
- Cleans up listener on unmount
- Reacts to settings store changes

### Conflict Detection (3 tests minimum)
- Detects duplicate bindings
- No false positives
- Different modifiers are not conflicts

### KeybindingEditor (7 tests minimum)
- Lists commands with bindings grouped by category
- Enters recording mode on click
- Records new binding and calls onUpdate
- Shows conflict warning
- Calls onReset for default
- Cancels recording on Escape
- Displays platform-appropriate modifier labels

### SettingsModal (5 tests minimum)
- Hidden when closed
- Renders dialog when open
- Closes on Escape
- Closes on backdrop click
- Traps focus

### Rust Settings Commands (4 tests minimum)
- settings_get returns defaults
- settings_update persists change
- settings_update emits event
- settings_reset restores defaults

### Tauri Bridge Settings (3 tests minimum)
- get calls invoke correctly
- update calls invoke with key/value
- reset calls invoke correctly

**Total minimum unit tests: 60**

---

## 6. Integration Tests

### Component Integration (5 tests minimum)
- CommandPalette + useCommands: Executing palette command triggers Tauri invoke
- KeybindingEditor + settingsStore: Changing binding updates store and persists via Rust
- useKeyboardShortcuts + settingsStore: Custom binding triggers correct command
- SettingsModal + KeybindingEditor: Full settings flow from open to edit to save
- Command palette respects custom keybindings (shows updated shortcut labels)

### Store Integration (3 tests minimum)
- settingsStore syncs with Rust on settings-changed event
- uiStore.commandPaletteOpen toggled by keyboard shortcut
- Settings persist across simulated app restart (load from Rust on init)

### Rust Integration (2 tests minimum)
- Full settings lifecycle: get defaults -> update -> get updated -> reset -> get defaults
- Settings file atomic write verified (temp file pattern)

**Total minimum integration tests: 10**

---

## 7. E2E Tests

1. **Command palette opens and closes**: Press `Cmd/Ctrl+Shift+P` -> palette visible -> Escape -> palette hidden
2. **Search and execute command**: Open palette -> type "split" -> select "Split Horizontally" -> pane splits
3. **Keyboard shortcut executes command**: Press `Cmd/Ctrl+Shift+H` -> pane splits horizontally
4. **Custom keybinding**: Open settings -> change split shortcut -> new shortcut works -> old shortcut does not
5. **Settings persist**: Change keybinding -> close settings -> reopen settings -> change is preserved
6. **Conflict detection visible**: Set two commands to same keybinding -> conflict warning visible in editor

**Total minimum E2E tests: 6**

---

## 8. Acceptance Criteria

1. `Cmd/Ctrl+Shift+P` opens the command palette overlay
2. Command palette shows all registered commands with labels and current keybindings
3. Typing in the search box filters commands via fuzzy search
4. Arrow keys navigate the results list; Enter executes the selected command
5. Escape or clicking the backdrop closes the palette
6. `Cmd/Ctrl+,` opens the settings modal
7. Settings modal contains a keybinding editor section
8. Clicking a keybinding enters recording mode; pressing a key combination sets the new binding
9. Conflict detection shows a warning when two commands share the same keybinding
10. Reset button restores a command's default keybinding
11. Custom keybindings take effect immediately (no app restart)
12. Custom keybindings persist across app restarts (saved to Rust settings file)
13. Terminal passthrough keys (`Ctrl+C`, `Ctrl+D`, `Ctrl+Z`) are never intercepted by the shortcut system
14. Platform-appropriate modifier labels: "Cmd" on macOS, "Ctrl" on Windows/Linux
15. All tests pass on all 3 platforms in CI
16. Coverage meets thresholds (95% overall, 100% on settingsStore and hooks)

---

## 9. Accessibility Requirements

### Command Palette
- `role="dialog"` with `aria-label="Command palette"`
- Search input: `role="searchbox"` with `aria-label="Search commands"`
- Results list: `role="listbox"` with `aria-label="Command results"`
- Each result: `role="option"` with `aria-selected` for the highlighted item
- `aria-activedescendant` on the listbox tracks the highlighted option
- Focus trapped within the palette while open
- Screen reader announces number of results: `aria-live="polite"` region with "N results"

### Settings Modal
- `role="dialog"` with `aria-label="Settings"` and `aria-modal="true"`
- Close button with `aria-label="Close settings"`
- Focus trapped within the modal
- Return focus to previously focused element on close

### Keybinding Editor
- Each keybinding row is a `<button>` with `aria-label="Change keybinding for {command label}"`
- Recording mode announced via `aria-live="assertive"`: "Press a key combination"
- Conflict warning: `role="alert"` with descriptive text
- Reset buttons: `aria-label="Reset {command label} to default"`

---

## 10. Dependencies on Prior Phases

| Dependency | Phase | What's Needed |
|-----------|-------|---------------|
| Keyboard shortcut system (hardcoded) | Phase 2 | `useKeyboardShortcuts` hook to be refactored |
| `uiStore` | Phase 2 | `commandPaletteOpen`, `settingsOpen` state |
| `workspaceStore` | Phase 2 | Command execution targets (focused pane, active workspace) |
| Session persistence (Rust) | Phase 3a | Same atomic write pattern for settings file |
| Notification toggle | Phase 4 | `toggleNotificationPanel` command registered |
| Browser pane open | Phase 5 | `openBrowser` command registered |
| All Tauri commands | Phases 1-5 | Commands reference invoke wrappers for all actions |
| `fuse.js` dependency | package.json | Already listed in PRD dependencies |
