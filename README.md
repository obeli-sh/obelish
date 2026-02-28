# Obelisk

A modern terminal emulator built with Tauri v2 and React, featuring workspaces, split panes, browser panels, and a CLI for scripting.

<!-- screenshots here -->

## Features

- **Workspaces** — Organize terminal sessions into named workspaces
- **Split panes** — Resizable horizontal/vertical splits with drag-to-resize
- **Browser panels** — Embed web pages alongside terminals
- **Command palette** — Fuzzy-search commands and keyboard shortcuts
- **CLI** — Control the running app from another terminal via Unix socket IPC
- **Notifications** — In-app notification system
- **Session persistence** — Save and restore workspace layouts with zstd-compressed scrollback
- **Settings** — Configurable shell, font, and theme options
- **WebGL rendering** — GPU-accelerated terminal rendering via xterm.js

## Prerequisites

- [Rust](https://rustup.rs/) (stable)
- [Bun](https://bun.sh/) (or Node.js)
- [just](https://github.com/casey/just) (command runner)

### Linux

```sh
sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libappindicator3-dev librsvg2-dev
```

### macOS

Xcode Command Line Tools (`xcode-select --install`).

### Windows

[WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (included in Windows 11, installable on Windows 10).

## Getting Started

```sh
git clone <repo-url> obelisk
cd obelisk
bun install
just dev
```

## Development

| Command | Description |
|---|---|
| `just dev` | Start Tauri dev server with hot-reload |
| `just test` | Run Rust and frontend tests |
| `just lint` | Run cargo fmt, clippy, eslint, and typecheck |
| `just coverage` | Run tests with coverage reports |
| `just bench` | Run Rust benchmarks (Criterion) |

### Frontend-only commands

```sh
bun test              # Run Vitest
bun run test:watch    # Watch mode
bun run test:coverage # Coverage report
bun run lint          # ESLint
bun run typecheck     # TypeScript check
```

## Project Structure

```
obelisk/
├── src-tauri/          # Tauri/Rust backend
│   └── src/
│       ├── pty/            # PTY management
│       ├── workspace/      # Workspace logic
│       ├── persistence/    # Session save/restore
│       ├── scrollback/     # Scrollback buffer + zstd compression
│       ├── notifications/  # Notification system
│       ├── metadata/       # Pane metadata (cwd, process)
│       ├── settings/       # App settings
│       ├── ipc_server/     # Unix socket IPC server
│       └── commands.rs     # Tauri command handlers
├── src/                # React frontend
│   ├── components/         # UI components
│   ├── stores/             # Zustand state stores
│   ├── hooks/              # React hooks
│   ├── lib/                # Utilities and generated types
│   └── __mocks__/          # Test mocks for Tauri APIs
├── cli/                # CLI binary (obelisk-cli)
│   └── src/commands/       # workspace, pane, notify, session
├── obelisk-protocol/   # Shared IPC protocol types
├── justfile            # Development commands
└── vitest.config.ts    # Frontend test configuration
```

## CLI

The `obelisk` CLI communicates with a running Obelisk instance over a Unix socket.

### Build

```sh
just release-cli
# Binary at target/release/obelisk
```

### Usage

```sh
# Workspaces
obelisk workspace list
obelisk workspace new --name "Dev"
obelisk workspace focus <id>
obelisk workspace close <id>

# Panes
obelisk pane close <id>

# Notifications
obelisk notify "Build complete" --body "All tests passed"

# Session
obelisk session info
obelisk session save
```

### Global flags

| Flag | Description |
|---|---|
| `--json` | Output as JSON |
| `--socket <path>` | Override socket path (default: auto-discover) |

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop framework | Tauri v2 |
| Backend | Rust |
| Frontend | React 19, TypeScript |
| Terminal | xterm.js 6 (WebGL) |
| State management | Zustand 5 |
| Layout | react-resizable-panels |
| Search | Fuse.js |
| CLI parser | clap 4 |
| IPC protocol | JSON-RPC over Unix socket |
| PTY | portable-pty |
| Compression | zstd |
| Frontend tests | Vitest, Testing Library |
| Rust tests | cargo test, mockall, proptest, Criterion |
| Bundler | Vite 6 |

## Testing

```sh
just test       # All tests (Rust + frontend)
just coverage   # With coverage reports
```

### Coverage thresholds (frontend)

| Metric | Threshold |
|---|---|
| Lines | 95% |
| Functions | 95% |
| Statements | 95% |
| Branches | 90% |

## Building for Release

```sh
just release        # Build Tauri app (deb, AppImage, dmg, msi)
just release-cli    # Build CLI binary
just release-all    # Build both
just check-sizes    # Print binary and bundle sizes
```

## License

TBD
