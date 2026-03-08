# AGENTS.md — Obelisk Agent Engineering Protocol

This file defines the default working protocol for coding agents in this repository.
Scope: entire repository.

## 1) Project Snapshot (Read First)

Obelisk is a cross-platform terminal multiplexer desktop app built with Tauri v2 + React.

Core goals:
- stable, low-latency terminal UX across macOS/Linux/Windows
- reliable workspace and pane state synchronization between Rust and React
- deterministic behavior under split/close/restore flows
- safe browser pane and IPC behavior by default

Key subsystems:
- `src-tauri/` — Rust backend (PTY, workspace state, persistence, settings, IPC server)
- `src/` — React frontend (layout, panes, command palette, settings, notification UI)
- `cli/` — command-line client for controlling a running app instance
- `obelisk-protocol/` — shared IPC and workspace type contracts

Primary dev commands:

```bash
just dev        # run app in dev mode
just test       # cargo test --workspace + bun test
just lint       # fmt + clippy + eslint + typecheck
just coverage   # rust tests + vitest coverage
```

## 2) Deep Architecture Observations (Why This Protocol Exists)

1. Rust is source-of-truth for workspace topology
   - `WorkspaceState` in `src-tauri/src/workspace/state.rs` is authoritative.
   - Frontend stores mirror backend state; they do not own canonical layout logic.

2. Frontend/backend contract drift is a real risk
   - Tauri commands in `src-tauri/src/commands.rs` must stay aligned with `src/lib/tauri-bridge.ts` and tests.
   - Shared types come from Rust (`obelisk-protocol`, `ts-rs` bindings). Avoid hand-maintained duplicates when possible.

3. PTY lifecycle mistakes have high blast radius
   - `src-tauri/src/pty/manager.rs` changes can break terminal rendering, resizing, or shutdown behavior.
   - Pane close/split behavior must avoid orphan PTYs and stale pane references.

4. Workspace event ordering matters for UX
   - `workspace-changed`/`workspace-removed` emissions drive frontend synchronization.
   - Reordering or delaying state events can cause visible UI stalls or stale selections.

5. Browser pane paths are security-sensitive
   - URL handling must remain explicit and restrictive.
   - Unsafe schemes (e.g. `javascript:`, `data:`, `file:`) must stay blocked.

## 3) Engineering Principles (Normative)

### 3.1 KISS

Required:
- Prefer simple, explicit control flow in both Rust and TypeScript.
- Keep state transitions obvious, especially around pane split/close and workspace activation.
- Avoid hidden side effects across stores/modules.

### 3.2 YAGNI

Required:
- Do not add feature flags, settings keys, or command variants without a concrete caller.
- Do not widen command payloads “for future use” unless used now and tested.

### 3.3 DRY + Rule of Three

Required:
- Keep small duplication if it improves readability.
- Extract helpers only after repeated, stable patterns.
- Do not force cross-layer abstractions across Rust/TS boundaries.

### 3.4 Fail Fast + Explicit Errors

Required:
- Return explicit errors for invalid pane IDs, invalid URLs, or unsupported operations.
- Avoid silent no-ops in backend command handlers.
- Surface actionable errors in logs/tests.

### 3.5 Determinism + No Flaky Tests

Required:
- Tests should not depend on live network or nondeterministic timing.
- Prefer mocks for Tauri APIs and browser-like dependencies in frontend tests.
- Keep PTY and workspace tests deterministic with explicit fixtures.

### 3.6 Security by Default

Required:
- Never commit secrets, tokens, machine-specific paths, or personal data.
- Keep URL/file/process boundaries narrow.
- Validate untrusted input at command boundaries.

## 4) Repository Map (High-Level)

```
src-tauri/src/
  commands.rs           Tauri command handlers
  workspace/            layout tree + workspace state transitions
  pty/                  PTY spawn/write/resize/kill lifecycle
  persistence/          session save/restore
  settings/             settings model + updates
  notifications/        notification parsing and storage
  ipc_server/           local RPC server for CLI

src/
  components/           UI panes, layout, sidebar, settings, palette
  stores/               Zustand stores (workspace/ui/settings/notifications)
  hooks/                keyboard shortcuts, browser, listeners, metadata
  lib/                  bridge, command registry, utils, generated types

cli/src/
  commands/             workspace/pane/session/notify command handlers

obelisk-protocol/src/
  lib.rs                shared transport/domain types
```

## 5) Risk Tiers by Path (Review Depth Contract)

- Low risk:
  - docs, comments, tests-only changes, minor styling
- Medium risk:
  - most `src/**` UI/state changes
  - non-critical CLI output/argument handling updates
- High risk:
  - `src-tauri/src/commands.rs`
  - `src-tauri/src/workspace/**`
  - `src-tauri/src/pty/**`
  - `src-tauri/src/ipc_server/**`
  - `src-tauri/src/persistence/**`
  - protocol type changes in `obelisk-protocol/**`

When uncertain, classify as higher risk.

## 6) Agent Workflow (Required)

1. Read before write
   - inspect touched module + adjacent tests + bridge contracts first.
2. Define a narrow scope
   - avoid mixed feature/refactor/style patches.
3. Implement minimal patch
   - preserve architecture boundaries.
4. Validate at appropriate depth
   - run targeted tests first, broader suite when risk is medium/high.
5. Document impact
   - summarize behavior change, validation run, and remaining risk.

## 7) Naming and Boundary Contracts

### 7.1 Naming

- Rust:
  - functions/modules/files: `snake_case`
  - types/enums/traits: `PascalCase`
  - constants: `SCREAMING_SNAKE_CASE`
- TypeScript/React:
  - variables/functions: `camelCase`
  - components/types/interfaces: `PascalCase`
  - test names: behavior-oriented (`it('does X when Y')`)

### 7.2 Boundary Rules

- Backend command names and payloads must stay in sync with `src/lib/tauri-bridge.ts`.
- Backend workspace logic lives in Rust; frontend should not duplicate layout mutation rules.
- Keep protocol/schema changes coordinated across:
  - `obelisk-protocol`
  - backend consumers
  - frontend bridge/types/tests
- Do not hand-edit generated bindings:
  - `src-tauri/bindings/**`
  - `obelisk-protocol/bindings/**`
  - `src/lib/generated/**`

## 8) Change Playbooks

### 8.1 Adding or changing a Tauri command

- Update backend handler in `src-tauri/src/commands.rs`.
- Update bridge call in `src/lib/tauri-bridge.ts`.
- Add/adjust tests in:
  - backend command/workspace tests
  - frontend bridge/component/hook tests
- Ensure command errors remain explicit and serializable.

### 8.2 Changing workspace/pane behavior

- Implement mutation in `workspace/state.rs` first.
- Verify event emission and frontend store sync behavior.
- Cover split/close/focus edge cases in tests.

### 8.3 Changing PTY behavior

- Update manager/backend types in `src-tauri/src/pty/**`.
- Validate spawn/write/resize/kill lifecycle and pane close interactions.
- Prefer incremental changes with clear rollback path.

### 8.4 Changing settings/keybindings

- Keep defaults and update paths aligned between Rust settings and frontend usage.
- Verify keybinding conflict/serialization behavior.

### 8.5 Changing browser pane logic

- Preserve URL safety constraints.
- Keep toolbar normalization and backend validation aligned.
- Add tests for both allowed and rejected URL schemes.

## 9) Validation Matrix

Required before commit (code changes):

```bash
just lint
just test
```

Recommended by change type:

- Frontend-only changes:

```bash
bun run typecheck
bun run lint
bun test
```

- Rust/backend-only changes:

```bash
cargo fmt --check
cargo clippy --workspace -- -D warnings
cargo test --workspace
```

- High-risk command/workspace/pty/protocol changes:
  - run targeted tests for touched modules plus `just test`.

If full validation is impractical, explicitly state what ran and what was skipped.

## 10) Privacy and Sensitive Data (Required)

- Never commit real secrets, local tokens, or private endpoints.
- Use neutral placeholders in tests/docs (`example.com`, `test-key`, `ws-1`).
- Review diffs for accidental sensitive strings before commit.

## 11) Anti-Patterns (Do Not)

- Do not change Rust command signatures without updating bridge/tests.
- Do not mutate frontend store shape and backend payload shape independently.
- Do not add silent fallback behavior for invalid pane/workspace IDs.
- Do not bypass URL validation on browser-related code paths.
- Do not edit generated binding files directly.
- Do not include unrelated refactors in behavior patches.

## 12) Handoff Template (Agent → Agent / Maintainer)

Include:

1. What changed
2. What did not change
3. Validation run and results
4. Remaining risks/unknowns
5. Next recommended action

## 13) Rules
- We should always do changes strongly tested using automated tests.
- Always use TDD to ANY change.
