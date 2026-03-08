# Round 1: Senior PM Analysis

## 1. Scope Assessment

### Is this realistic?

The PRD describes a **full-featured terminal multiplexer** built from scratch with Tauri v2 + React. This is ambitious but achievable — the tech stack choices are sound (portable-pty is battle-tested, xterm.js is the industry standard). The 8-phase breakdown is reasonable in ordering.

However, the PRD reads like a **feature-complete spec**, not an MVP spec. There is no prioritization within phases — everything is treated as equally important. This is dangerous because it invites gold-plating.

### What is the real MVP?

The **real MVP** is: a user can open Obelisk, get a working terminal, split panes, create workspaces, and have sessions persist across restarts. That is **Phases 1-3** only. Everything else (notifications, browser panels, command palette, CLI) is differentiation, not MVP.

Within that MVP scope:
- Phase 1 is the non-negotiable foundation. Without a working terminal, nothing else matters.
- Phase 2 (workspaces + splits) is what makes Obelisk a *multiplexer* rather than just another terminal window.
- Phase 3 (persistence) is what makes it *useful* — nobody will adopt a multiplexer that forgets your layout on restart.

### What can wait?

- **Notifications (Phase 4)**: Nice-to-have for AI agent workflows, but not blocking basic usability.
- **Browser panels (Phase 5)**: Very niche. Most users will use a real browser. Defer aggressively.
- **Command palette (Phase 6)**: Can ship with keyboard shortcuts hardcoded. Palette + customization is polish.
- **CLI (Phase 7)**: Important for power users and scripting, but not needed at launch.
- **Polish/packaging (Phase 8)**: Needs to happen before public release, but dev builds suffice for early users.

---

## 2. Risk Register

### Technical Risks

| Risk | Severity | Likelihood | Mitigation |
|------|----------|------------|------------|
| `portable-pty` on Windows (ConPTY) has subtle behavioral differences | High | Medium | Start cross-platform testing from Phase 1, not Phase 8 |
| xterm.js ↔ Tauri event bridge: latency/throughput for fast terminal output | High | Medium | Benchmark early with stress tests (e.g., `cat /dev/urandom`) |
| Tauri v2 multi-webview is behind `unstable` flag | Medium | High | Defer browser pane to last; use iframe-only initially |
| Base64 encoding overhead for PTY data | Medium | Low | Profile early; switch to SharedArrayBuffer if needed |
| `react-resizable-panels` doesn't handle deeply nested recursive splits well | Medium | Medium | Prototype the split layout in Phase 2 before committing |

### Timeline Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Cross-platform PTY differences eat up Phase 1 time | High | Timebox Windows PTY work; ship Mac/Linux first if needed |
| Session persistence (Phase 3) is deceptively complex | Medium | Start with layout-only persistence; defer scrollback serialization |
| Scope creep in "polish" phase turns into infinite work | High | Define a hard feature freeze before Phase 8 |

### Dependency Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| `portable-pty` 0.8 is from wezterm which is now archived/stale | High | Evaluate forks; have a plan B (raw `winpty`/ConPTY bindings) |
| Tauri v2 is still evolving; breaking changes possible | Medium | Pin versions aggressively; don't depend on unstable features for MVP |
| xterm.js v5.5 WebGL addon GPU compatibility | Low | Fallback to canvas renderer |

---

## 3. User Value Priorities

Ordered by user impact:

1. **Fast, responsive terminal** — if the terminal is slow or buggy, nothing else matters. This is the "table stakes" feature.
2. **Reliable split panes** — the core multiplexer value proposition. Must feel as fluid as tmux/iTerm2.
3. **Session persistence** — users will rage-quit if they lose their layout. Non-negotiable for retention.
4. **Workspace organization** — being able to group terminals by project. This is the "organizer" value.
5. **Keyboard-driven workflow** — power users live on the keyboard. Good keybindings are critical.
6. **Notifications** — important for the AI agent use case specifically (the original cmux audience).
7. **CLI automation** — enables scripting and integration with other tools.
8. **Browser panels** — least important; most users alt-tab to a browser.

---

## 4. Phase Ordering Critique

### What the PRD gets right:
- Phase 1 (terminal) before Phase 2 (layout) is correct — you need a working terminal before you can split it.
- Phase 3 (persistence) before Phase 4 (notifications) is correct — persistence is more fundamental.

### What I would change:

1. **Move keyboard shortcuts into Phase 2, not Phase 6.** You cannot ship a multiplexer without `Ctrl+Shift+H/V` for splits, `Ctrl+1-9` for workspace switching, etc. These are not "polish" — they are core navigation. Phase 6 should only be the *command palette* and *customization*, not the shortcuts themselves.

2. **Split Phase 3 into 3a (layout persistence) and 3b (scrollback + metadata).** Layout persistence is critical and relatively simple. Scrollback serialization and git/port metadata are separate concerns and can come later. Lumping them together makes Phase 3 artificially large.

3. **Consider moving Phase 7 (CLI/IPC) earlier — or at least the IPC server.** The IPC server is an architectural component that other features (like future plugin support) may want to build on. Starting it in Phase 7 means retrofitting. Counter-argument: YAGNI. I lean toward deferring unless the team sees a strong reason.

4. **Phase 8 is too vague.** "Polish" and "packaging" are completely different activities. Theming is UI work. Packaging is DevOps/CI work. These should be separated.

---

## 5. TDD Concerns

The CLAUDE.md mandates TDD for ALL changes. This is a strong stance and I support it, but we need to be realistic about where TDD delivers the highest ROI vs. where it adds friction.

### Highest TDD ROI (test-first is critical):

- **PTY Manager (Rust)**: spawn, write, resize, kill. This is the core engine. Bugs here are catastrophic. TDD forces clean interfaces.
- **OSC parser**: Pure function, well-defined input/output. Perfect for TDD.
- **Workspace state model**: Data model operations (add pane, split, close, reorder). TDD ensures the tree/graph operations are correct.
- **Session persistence**: Serialize → deserialize round-trip must be tested exhaustively.
- **IPC protocol**: Request/response parsing. Pure functions, easy to test.
- **Keybinding resolution**: Given a keypress, which command fires? Must be tested with platform-specific modifiers.

### TDD adds friction (still test, but integration tests may be more valuable):

- **React components** (TerminalPane, Sidebar, etc.): TDD on UI components often leads to brittle tests that test implementation details. Prefer integration tests and E2E tests. Unit test the *hooks* and *stores*, not the JSX.
- **Tauri command wrappers**: Thin wrappers around Rust functions. Test the underlying functions, not the Tauri glue.
- **CSS/theming**: Not meaningfully testable with unit tests. Visual regression testing is more appropriate.

### TDD is irrelevant:

- **Project scaffolding**: No tests needed for `bun create tauri-app`.
- **Static configuration files**: `tauri.conf.json`, `Cargo.toml`, `vite.config.ts`.

---

## 6. Cross-Platform Product Concerns

### Keyboard shortcuts
- Mac uses `Cmd`, Windows/Linux use `Ctrl`. Every shortcut must have a platform-aware mapping.
- Some shortcuts conflict with OS defaults (e.g., `Ctrl+W` closes tabs in browsers, `Cmd+Q` quits on Mac). Need a conflict audit.

### Shell defaults
- Mac: zsh. Linux: bash (usually). Windows: PowerShell or cmd.exe.
- Must detect and use the user's default shell, not hardcode.

### Font rendering
- xterm.js WebGL rendering may behave differently across platforms/GPUs. Need canvas fallback.

### File paths
- Session persistence must handle path separators correctly (`/` vs `\`).
- App data directory varies by OS. Tauri handles this, but tests need to account for it.

### Packaging expectations
- Mac users expect `.dmg` with drag-to-Applications.
- Windows users expect `.msi` or `.exe` installer.
- Linux users expect AppImage, `.deb`, and possibly Flatpak.
- Auto-update mechanism should be planned early (Tauri has built-in updater).

---

## 7. Summary Recommendations

1. **Lock the MVP to Phases 1-3.** Ship those first. Everything else is a fast-follow.
2. **Start cross-platform testing from day 1.** Do not defer Windows testing to Phase 8.
3. **Move basic keybindings into Phase 2.** A multiplexer without keyboard navigation is broken.
4. **Invest TDD effort heavily in the Rust core** (PTY, parser, state model, persistence). Lighter TDD on React UI — prefer integration tests there.
5. **Benchmark terminal throughput early.** If the xterm.js ↔ Tauri bridge is slow, it undermines the entire product. This should be a Phase 1 acceptance criterion.
6. **Evaluate `portable-pty` health.** If it's unmaintained, identify a fork or alternative now, not when we hit a Windows bug later.
7. **Keep scope discipline.** This PRD has 37 numbered items. For MVP, we need roughly items 1-16. That is still a lot of work.
