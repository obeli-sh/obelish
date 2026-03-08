# Round 1: Senior Tech Lead Analysis

## 1. Architecture Validation

### Overall Assessment
The Tauri v2 + React + Rust stack is a **sound choice** for a cross-platform terminal multiplexer. It gives us native performance for PTY management (Rust) while leveraging the web ecosystem for UI (React + xterm.js). This is essentially the same architecture that powers VS Code's terminal (Electron + xterm.js + node-pty), but with Tauri's smaller footprint and Rust's safety guarantees.

### Tech Choices: Validated
- **Tauri v2 over Electron**: Correct. Smaller binary (~10MB vs ~100MB+), lower memory, native OS integration. Trade-off: smaller ecosystem, less battle-tested for complex apps. Acceptable risk.
- **React 19 + Vite + Bun**: Solid. Bun for speed, Vite for fast HMR, React 19 for concurrent features. No concerns here.
- **Zustand over Redux/Jotai**: Good fit. Minimal boilerplate, works well for the state shape described (workspaces, panes, layout trees). Persistence middleware is a bonus.
- **xterm.js + WebGL addon**: Industry standard. Used by VS Code, Hyper, Tabby. No better alternative exists for web-based terminal rendering.
- **Base64 encoding for PTY data**: This is the simplest approach and works. However, base64 adds ~33% overhead. For high-throughput scenarios (e.g., `cat` of a large file), this could be noticeable. We should benchmark and potentially switch to binary event channels if Tauri v2 supports them, or consider chunked streaming.

### Red Flags
1. **Tauri `unstable` feature flag for multi-webview**: This is a real risk. The browser panel feature (Phase 5) depends on an unstable API. We should design the browser subsystem so iframe-only mode is fully functional and the multi-webview path is truly optional.
2. **No mention of error recovery architecture**: The PRD describes happy paths but not what happens when PTY processes die unexpectedly, when IPC connections break, or when state gets corrupted.
3. **Monolithic `lib.rs` setup**: The PRD's `lib.rs` is described as "Tauri builder, state, setup" — this will become a god-module fast. Need clear module boundaries from day 1.

---

## 2. Dependency Risk Assessment

### portable-pty (Critical Dependency)
- **Maturity**: Part of the wezterm project. Actively maintained, used in production by wezterm (a serious terminal emulator). This is the best Rust PTY crate available.
- **Risk**: Moderate. wezterm's author (Wez Furlong) maintains it, but it's tightly coupled to wezterm's release cycle. If wezterm development slows, so does portable-pty.
- **Windows ConPTY**: portable-pty handles ConPTY, but ConPTY has known quirks (resizing race conditions, ANSI passthrough issues on older Windows 10 builds). We need to test on Windows 10 1809+ and Windows 11 separately.
- **Mitigation**: Pin to a known-good version. Write an abstraction layer (`PtyBackend` trait) so we could swap implementations if needed.

### Tauri v2
- **Maturity**: v2 stable was released in late 2024. It's production-ready for standard use cases.
- **Risk**: Low for core features. High for `unstable` multi-webview. The plugin ecosystem is still catching up to v2.
- **Event system**: Tauri's event system is the backbone of our PTY data flow. It's JSON-based, which forces the base64 encoding approach. Need to verify event throughput limits under load.

### xterm.js
- **Maturity**: Very mature, v5.5 is stable.
- **Risk**: Low. Largest risk is memory leaks from improper lifecycle management (not disposing terminals, not cleaning up addons).
- **WebGL addon**: Can fail on systems without WebGL support or with broken GPU drivers. Must have canvas fallback.

### interprocess (IPC)
- **Maturity**: v2 is relatively new. Unix sockets are well-tested; named pipes on Windows less so.
- **Risk**: Medium. Named pipe support on Windows is the main concern. Alternative: use localhost TCP as a fallback on Windows.

---

## 3. Cross-Cutting Concerns

### Error Handling Strategy
The PRD is silent on error handling. We need a clear strategy:

1. **Rust side**: Use `thiserror` for typed errors, `anyhow` for internal propagation. Every Tauri command must return `Result<T, String>` (Tauri's requirement), but internally we use proper error types.
2. **Frontend side**: Every `invoke()` call must have error handling. Create a `TauriError` type and a generic error boundary component.
3. **PTY errors**: PTY process death should trigger a "Process exited" overlay on the terminal pane, not crash the app.
4. **State corruption**: If persisted JSON is corrupted, fall back to default state. Never crash on restore.

### Logging
- **Rust**: Use `tracing` crate with `tracing-subscriber`. Structured logging with spans for PTY sessions, IPC connections, etc.
- **Frontend**: Lightweight logger that forwards critical errors to Rust via `invoke()` for unified log files.
- **Log location**: Tauri's app data dir / `logs/`. Rotation with `tracing-appender`.

### Crash Recovery
- Autosave workspace state every 30 seconds (configurable).
- On startup, detect if previous session exited cleanly (write a "clean shutdown" marker).
- If unclean shutdown detected, offer to restore previous session.

---

## 4. Build System and CI

### Cargo Workspace
```toml
# Root Cargo.toml
[workspace]
members = ["src-tauri", "cli"]
resolver = "2"

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
interprocess = "2"
tokio = { version = "1", features = ["full"] }
```

This is clean: two crates sharing dependencies. The CLI and Tauri app share `interprocess` for IPC, `serde` for protocol types. Consider a third shared crate (`obelisk-protocol`) for IPC types used by both.

### Monorepo Tooling
- **Bun** for frontend package management and scripts.
- **Cargo** for Rust workspace.
- **Task runner**: Use `just` (justfile) or `cargo-make` for cross-language orchestration (e.g., `just dev` runs both `bun tauri dev`). Avoid Makefile complexity.

### CI Pipeline Design
```
on: [push, pull_request]

jobs:
  rust-check:
    - cargo fmt --check
    - cargo clippy -- -D warnings
    - cargo test --workspace

  frontend-check:
    - bun install
    - bun run lint (eslint)
    - bun run typecheck (tsc --noEmit)
    - bun run test (vitest)

  integration:
    matrix: [ubuntu-latest, windows-latest, macos-latest]
    - bun tauri build
    - Run headless E2E tests (if feasible)

  security:
    - cargo audit
    - bun audit
```

---

## 5. Performance Concerns

### PTY Data Throughput
This is the **single most critical performance path** in the entire application.

```
PTY stdout → Rust read thread → base64 encode → JSON serialize → IPC to webview → JSON parse → base64 decode → xterm.js write
```

Each step adds latency. Concerns:
1. **Base64 overhead**: 33% size increase. For a `cat /dev/urandom | xxd` scenario, this matters.
2. **JSON serialization**: Tauri events are JSON-wrapped. Double serialization cost.
3. **Chunking strategy**: How large should PTY read buffers be? Too small = too many events (IPC overhead). Too large = UI update latency. Need to find the sweet spot (likely 4KB-16KB chunks with coalescing).
4. **Backpressure**: If xterm.js can't render fast enough, events queue up. Need a flow control mechanism or event coalescing on the Rust side.

**Recommendation**: Implement a benchmark harness early (Phase 1). Measure time from PTY write to xterm.js render. Target: <5ms for typical output, <50ms for bulk data.

### Event System Bottlenecks
Tauri events are async but single-threaded on the webview side. If we have 10+ terminals all outputting simultaneously, the event listener queue could back up.

**Mitigation**: Batch PTY events per animation frame on the frontend. Use `requestAnimationFrame` coalescing in `useTerminal`.

### Memory Leaks
Top leak risks:
1. **xterm.js instances not disposed**: Each terminal is an xterm.js `Terminal` instance. Must `.dispose()` on pane close.
2. **Event listeners**: Tauri event `unlisten` handles not cleaned up on component unmount.
3. **Scrollback buffers**: xterm.js default is 1000 lines. With many terminals, this adds up. Make configurable.

---

## 6. TDD Architecture

### Testing Infrastructure

#### Rust Tests
```
src-tauri/
├── src/
│   ├── pty/
│   │   ├── manager.rs        # Unit tests inline: spawn, write, resize, kill
│   │   └── osc_parser.rs     # Unit tests inline: parse various OSC sequences
│   ├── workspace/
│   │   ├── state.rs           # Unit tests inline: state transitions, layout ops
│   │   └── persistence.rs     # Unit tests inline: serialize/deserialize, corruption handling
│   └── ipc_server/
│       ├── protocol.rs        # Unit tests inline: message parsing
│       └── handlers.rs        # Integration tests: full command dispatch
└── tests/
    ├── pty_integration.rs     # Spawn real shell, write/read, verify output
    ├── workspace_integration.rs
    └── ipc_integration.rs     # Spin up server, connect client, send commands
```

- Use `#[cfg(test)]` inline modules for unit tests.
- Use `tests/` directory for integration tests that need real OS resources (PTY, sockets).
- Mock PTY for unit tests using a trait: `trait PtyBackend { fn spawn(...); fn write(...); fn read(...); }`.

#### Frontend Tests
```
src/
├── components/
│   ├── terminal/
│   │   └── __tests__/
│   │       ├── TerminalPane.test.tsx    # Render, lifecycle, cleanup
│   │       └── useTerminal.test.ts      # Mock Tauri invoke/events
│   ├── workspace/
│   │   └── __tests__/
│   │       └── PaneSplitter.test.tsx    # Layout rendering, split/close
│   └── ...
├── stores/
│   └── __tests__/
│       ├── workspaceStore.test.ts       # State transitions
│       └── notificationStore.test.ts
└── lib/
    └── __tests__/
        └── tauri-bridge.test.ts         # Mock invoke, verify contracts
```

- **Vitest** for test runner (Vite-native, fast).
- **React Testing Library** for component tests.
- **Mock `@tauri-apps/api`**: Create a `__mocks__/@tauri-apps/api.ts` that simulates `invoke()` and `listen()`.
- This Tauri mock is **critical infrastructure** — it defines the Rust/React contract in test form.

#### E2E Tests
- Use **WebdriverIO** with Tauri's official driver for E2E.
- Alternatively, test the frontend in isolation with Playwright against a mock Tauri backend.
- E2E is expensive to maintain. Focus on critical paths: app launch, terminal I/O, split pane, session restore.

### TDD Workflow per Phase
1. Write failing test for the next feature.
2. Implement minimum code to pass.
3. Refactor.
4. Repeat.

This is especially important for the PTY layer — write integration tests that spawn a real shell and verify I/O before writing the Tauri command wrappers.

---

## 7. Integration Boundaries: Rust <-> React Contract

This is the **most important architectural concern**. The boundary between Rust and React is defined by:

### 1. Tauri Commands (React calls Rust)
```typescript
// tauri-bridge.ts — MUST be the single source of truth
invoke<string>('pty_spawn', { shell?: string, cwd?: string }) → ptyId
invoke<void>('pty_write', { ptyId: string, data: string })
invoke<void>('pty_resize', { ptyId: string, rows: number, cols: number })
invoke<void>('pty_kill', { ptyId: string })
invoke<string>('workspace_create', { name: string }) → workspaceId
invoke<void>('workspace_close', { workspaceId: string })
invoke<PaneId>('pane_split', { paneId: string, direction: 'horizontal' | 'vertical' })
invoke<void>('pane_close', { paneId: string })
```

### 2. Tauri Events (Rust pushes to React)
```typescript
// Event contracts
listen<{ data: string }>(`pty-data-${ptyId}`)        // base64 PTY output
listen<{ code: number }>(`pty-exit-${ptyId}`)         // process exit
listen<Notification>('notification')                    // OSC notification
listen<GitInfo>(`git-info-${paneId}`)                  // git status update
listen<PortInfo>(`port-scan-${paneId}`)                // port scan result
```

### 3. Shared Types
Define a `types.ts` and corresponding Rust structs that MUST stay in sync. Consider using `ts-rs` crate to auto-generate TypeScript types from Rust structs.

**Recommendation**: Use `ts-rs` from day 1. Manual type sync across languages is a bug factory.

---

## 8. Security Considerations

### PTY Spawning
- **Risk**: The app spawns shell processes with the user's full permissions. This is inherent to terminal emulators and cannot be avoided.
- **Mitigation**: Validate shell paths. Don't allow arbitrary binary execution from IPC without authentication.
- **Tauri capabilities**: Lock down the `default.json` capability file. Only expose necessary commands.

### IPC Server
- **Risk**: The Unix socket / named pipe is a local attack surface. Any process on the machine can connect.
- **Mitigation**: Set socket permissions to user-only (0700). Consider a lightweight auth token (random token written to a file readable only by the user, client must present it).
- **No network exposure**: The IPC server must NEVER bind to a TCP port. Unix socket / named pipe only.

### Browser Embedding
- **Iframe**: Standard web security model applies (CSP, same-origin). Limited risk.
- **Multi-webview**: Tauri's webview is a full browser engine. If we navigate to untrusted URLs, we need CSP headers and should sandbox the webview.

### Supply Chain
- Lock Cargo.lock and bun.lockb in version control.
- Run `cargo audit` and `bun audit` in CI.
- Pin major versions of critical dependencies (portable-pty, tauri, xterm.js).

---

## 9. Key Risks Summary

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| Tauri `unstable` multi-webview breaks | High | Medium | Iframe fallback as primary, multi-webview as enhancement |
| PTY throughput bottleneck (base64 + JSON) | High | Medium | Benchmark early, implement coalescing, consider binary channels |
| portable-pty Windows ConPTY quirks | Medium | High | Extensive Windows testing from Phase 1, document known issues |
| xterm.js memory leaks | Medium | High | Strict lifecycle management, dispose on unmount, test with memory profiler |
| Type drift between Rust and TypeScript | Medium | High | Use ts-rs for auto-generation, test contracts |
| IPC named pipe issues on Windows | Medium | Medium | Fallback to localhost TCP on Windows if needed |
| Tauri v2 plugin ecosystem gaps | Low | Medium | Check plugin availability early, be prepared to write custom plugins |

---

## 10. Immediate Recommendations

1. **Add a shared protocol crate** (`obelisk-protocol`) for IPC types used by both `src-tauri` and `cli`.
2. **Use `ts-rs`** to generate TypeScript types from Rust structs.
3. **Use `tracing`** for logging from day 1, not `println!` or `log`.
4. **Benchmark PTY throughput** in Phase 1 before committing to base64 encoding.
5. **Write a Tauri API mock** for frontend testing as the first frontend task.
6. **Set up CI** in Phase 1, not Phase 8. Every PR should pass lint + test + build on all 3 platforms.
7. **Define error types** before implementing features. `thiserror` enum per module.
8. **Use `just` (justfile)** for cross-language task orchestration.
9. **Implement the `PtyBackend` trait** abstraction for testability.
10. **Plan for WebGL fallback** in xterm.js from the start (canvas renderer when WebGL is unavailable).
