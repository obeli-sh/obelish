# Obelisk — Cross-Platform Terminal Multiplexer

## Context

cmux is a macOS-only terminal app (Swift/AppKit) for managing multiple AI coding agent sessions with split panes, embedded browser, notifications, and CLI automation. The goal is to build **Obelisk** — a cross-platform alternative using **Tauri v2 + React** that runs on Windows, Mac, and Linux.

The obelisk repo is currently empty. This plan scaffolds the entire project from scratch.

---

## Tech Stack

- **Backend**: Tauri v2 (Rust) — PTY management, IPC server, session persistence, git/port scanning
- **Frontend**: React 19 + TypeScript + Vite + Bun
- **Terminal**: xterm.js with WebGL addon, connected to Rust PTY via Tauri events
- **Browser**: Iframe fallback + Tauri multi-webview (behind `unstable` feature flag)
- **State**: Zustand stores with persistence
- **CLI**: Standalone Rust binary communicating via Unix socket / named pipe

---

## Project Structure

```
obelisk/
├── src-tauri/                          # Rust backend
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   ├── capabilities/default.json
│   ├── icons/
│   ├── build.rs
│   └── src/
│       ├── main.rs                     # Entry point
│       ├── lib.rs                      # Tauri builder, state, setup
│       ├── pty/
│       │   ├── mod.rs
│       │   ├── manager.rs              # PtyManager: spawn, I/O relay, resize, kill
│       │   └── osc_parser.rs           # OSC 9/99/777 notification detection
│       ├── workspace/
│       │   ├── mod.rs
│       │   ├── state.rs                # Workspace/Surface/Pane/LayoutNode structs
│       │   └── persistence.rs          # JSON save/restore to app data dir
│       ├── git/mod.rs                  # Branch, dirty status, PR number
│       ├── ports/mod.rs                # Listening port detection
│       ├── notifications/
│       │   ├── mod.rs                  # Notification store + routing
│       │   └── system.rs               # OS-level notifications
│       ├── ipc_server/
│       │   ├── mod.rs                  # Unix socket / named pipe listener
│       │   ├── protocol.rs             # JSON-RPC request/response types
│       │   └── handlers.rs             # Command dispatch
│       ├── browser/mod.rs              # Tauri multi-webview management
│       └── commands/
│           ├── mod.rs
│           ├── pty_commands.rs          # pty_spawn, pty_write, pty_resize, pty_kill
│           ├── workspace_commands.rs    # create/close workspace, split/close pane
│           ├── notification_commands.rs
│           ├── git_commands.rs
│           ├── port_commands.rs
│           └── browser_commands.rs
│
├── src/                                # React frontend
│   ├── main.tsx
│   ├── App.tsx
│   ├── styles/
│   │   ├── index.css                   # CSS variables, base styles
│   │   ├── themes/{dark,light}.css
│   │   ├── terminal.css
│   │   └── sidebar.css
│   ├── components/
│   │   ├── layout/
│   │   │   ├── AppLayout.tsx           # Sidebar + MainArea
│   │   │   ├── Sidebar.tsx
│   │   │   ├── SidebarWorkspaceItem.tsx
│   │   │   └── MainArea.tsx
│   │   ├── workspace/
│   │   │   ├── WorkspaceContainer.tsx
│   │   │   ├── PaneSplitter.tsx        # Recursive split renderer (react-resizable-panels)
│   │   │   └── PaneWrapper.tsx
│   │   ├── terminal/
│   │   │   ├── TerminalPane.tsx
│   │   │   ├── TerminalSearch.tsx
│   │   │   └── useTerminal.ts          # xterm.js ↔ Rust PTY bridge
│   │   ├── browser/
│   │   │   ├── BrowserPane.tsx         # Iframe + native webview dual mode
│   │   │   ├── BrowserToolbar.tsx
│   │   │   └── useBrowser.ts
│   │   ├── notifications/
│   │   │   ├── NotificationPanel.tsx
│   │   │   ├── NotificationBadge.tsx
│   │   │   └── NotificationItem.tsx
│   │   ├── command-palette/
│   │   │   ├── CommandPalette.tsx
│   │   │   └── useCommands.ts
│   │   └── settings/
│   │       ├── SettingsModal.tsx
│   │       └── KeybindingEditor.tsx
│   ├── stores/
│   │   ├── workspaceStore.ts           # Central store: workspaces, panes, layout
│   │   ├── notificationStore.ts
│   │   └── settingsStore.ts            # Theme, keybindings, font, shell
│   ├── hooks/
│   │   ├── useTauriEvent.ts
│   │   ├── useKeyboardShortcuts.ts
│   │   ├── usePortScanner.ts
│   │   └── useGitInfo.ts
│   └── lib/
│       ├── tauri-bridge.ts             # Typed invoke() wrappers
│       ├── keybindings.ts              # Default shortcuts
│       ├── types.ts
│       └── constants.ts
│
├── cli/                                # Standalone CLI binary
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs                     # clap commands
│       └── client.rs                   # Socket/pipe client
│
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── .gitignore
```

---

## Architecture Decisions

| Decision | Choice | Why |
|----------|--------|-----|
| PTY | `portable-pty` | From wezterm, cross-platform (ConPTY on Windows), battle-tested |
| Terminal renderer | xterm.js + WebGL addon | Industry standard, GPU-accelerated, huge addon ecosystem |
| PTY data encoding | Base64 over Tauri events | Tauri events are JSON; binary needs encoding. Simple and fast enough |
| State management | Zustand | Minimal boilerplate, hook-based, built-in persistence middleware |
| Split panes | `react-resizable-panels` | Accessible, nested groups, handles edge cases well |
| Browser embed | Iframe + Tauri multi-webview | Iframe works now everywhere; native webview for better experience later |
| Session storage | JSON in app data dir | Simple, human-readable. SQLite is overkill initially |
| CLI IPC | Unix socket / named pipe | Standard OS primitives, no network exposure |
| Notifications | OSC parse in Rust → Tauri event → React store | Must intercept before frontend; uses existing Tauri event system |

---

## Data Flow: Terminal

```
User keystroke → xterm.js onData → invoke('pty_write') → Rust PtyManager.write() → PTY stdin
PTY stdout → Rust read thread → osc_parser (intercept notifs) → emit('pty-data-{id}', base64) → xterm.js.write()
Resize → ResizeObserver → FitAddon.fit() → invoke('pty_resize') → PtyManager.resize() → SIGWINCH
```

## Data Flow: Notifications

```
Agent writes OSC 9/99/777 → Rust PTY read loop → osc_parser extracts → emit('notification') →
React notificationStore → UI: pane blue ring + sidebar badge + notification panel + optional OS toast
```

---

## Key Dependencies

### Rust (src-tauri/Cargo.toml)
- `tauri = "2"` (features: `unstable` for multi-webview)
- `portable-pty = "0.8"` — cross-platform PTY
- `serde`, `serde_json` — serialization
- `tokio` (features: `full`) — async runtime
- `base64 = "0.22"` — PTY data encoding
- `interprocess = "2"` — Unix socket + named pipe IPC
- `uuid` (features: `v4`) — ID generation
- `tauri-plugin-shell`, `tauri-plugin-notification`, `tauri-plugin-os`, `tauri-plugin-fs`

### Frontend (package.json)
- `react`, `react-dom` ^19
- `@tauri-apps/api` ^2, `@tauri-apps/plugin-*` ^2
- `@xterm/xterm` ^5.5, `@xterm/addon-fit`, `@xterm/addon-webgl`, `@xterm/addon-search`, `@xterm/addon-serialize`
- `react-resizable-panels` ^2.1
- `zustand` ^5
- `fuse.js` ^7, `nanoid` ^5, `clsx` ^2

### CLI (cli/Cargo.toml)
- `clap` ^4 (features: `derive`), `serde`, `serde_json`, `interprocess` ^2

---

## Implementation Phases

### Phase 1: Project Scaffold + Core Terminal
1. Initialize Tauri v2 project with `bun create tauri-app` (react-ts template)
2. Set up project structure (all directories and module files)
3. Implement `PtyManager` with `portable-pty` (spawn, write, resize, kill)
4. Create `pty_commands.rs` Tauri commands
5. Build `TerminalPane` + `useTerminal` hook (xterm.js ↔ PTY bridge)
6. Wire bidirectional data flow: PTY output → base64 → Tauri event → xterm.js and reverse
7. Terminal resize via ResizeObserver + FitAddon

### Phase 2: Workspaces + Split Layout
8. Define workspace/surface/pane data model in Zustand (`workspaceStore.ts`)
9. Define Rust-side workspace state structs
10. Build `Sidebar` + `SidebarWorkspaceItem` components
11. Build `PaneSplitter` recursive renderer with `react-resizable-panels`
12. Implement split-pane actions (horizontal/vertical split, close pane)
13. Multiple surfaces (tabs) per workspace with `SurfaceTabBar`
14. Workspace create/close/switch with Ctrl/Cmd+N, Ctrl/Cmd+1-9

### Phase 3: Session Persistence + Metadata
15. Session save on close → JSON file in Tauri app data dir
16. Session restore on launch (layout, working directories)
17. Scrollback serialization via xterm `SerializeAddon`
18. Git info extraction (branch, dirty, PR number) → sidebar display
19. Port scanning → sidebar display

### Phase 4: Notifications
20. OSC parser in Rust PTY read loop (`osc_parser.rs`)
21. Notification store + Tauri event routing
22. Notification UI: pane blue ring, sidebar badge, notification panel (Ctrl/Cmd+I)
23. OS-level notifications via `tauri-plugin-notification`

### Phase 5: Browser Panels
24. Iframe-based `BrowserPane` for cross-platform reliability
25. `BrowserToolbar` (URL bar, back/forward, refresh)
26. Tauri multi-webview native browser (behind feature flag)
27. Coordinate sync between React layout and native webview position

### Phase 6: Command Palette + Keyboard Shortcuts
28. Global keyboard shortcut system (`useKeyboardShortcuts`)
29. Command palette with fuzzy search (Ctrl/Cmd+Shift+P)
30. Settings modal with keybinding customization

### Phase 7: CLI
31. IPC server in Rust (Unix socket / named pipe)
32. JSON-RPC protocol
33. CLI binary with clap: `obelisk new`, `obelisk split`, `obelisk notify`, `obelisk focus`, etc.

### Phase 8: Polish
34. Theme system (dark/light/system)
35. Font customization
36. Cross-platform testing and edge case fixes
37. Packaging (deb/AppImage/dmg/msi)

---

## Verification

1. **Phase 1 check**: `bun tauri dev` launches app window, typing in terminal works, shell prompt appears
2. **Phase 2 check**: Can create multiple workspaces, split panes, navigate sidebar
3. **Phase 3 check**: Close and reopen app → layout restored with scrollback
4. **Phase 4 check**: Run `printf '\e]9;Hello from agent\a'` in terminal → blue ring appears on pane, notification shows in panel
5. **Phase 5 check**: Split pane → open browser → navigate to localhost URL
6. **Phase 6 check**: Ctrl/Cmd+Shift+P opens palette, shortcuts work
7. **Phase 7 check**: `obelisk new --name test` creates workspace in running app
8. **Full E2E**: Multiple workspaces with terminals + browser, notifications flowing, session persisted across restart
