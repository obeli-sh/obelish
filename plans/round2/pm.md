# Round 2: Senior PM Debate Response

After reading all five Round 1 analyses, here is my pushback, agreements, and proposed resolutions.

---

## 1. Pushback on Over-Engineering

### Tech Lead: Shared protocol crate (`obelisk-protocol`) is premature

The tech lead recommends creating a third crate (`obelisk-protocol`) for shared IPC types between `src-tauri` and `cli`. This makes sense *eventually*, but not in MVP (Phases 1-3). The CLI is Phase 7. Building a shared crate now means maintaining a dependency that has zero consumers for months. **Ship it as inline types in `src-tauri` first, extract when the CLI actually needs it.** YAGNI.

### Tech Lead: `ts-rs` from day 1

I agree with the *goal* (keeping Rust and TypeScript types in sync) but disagree with the timing. `ts-rs` is a build-time codegen tool that adds complexity to the build pipeline. In Phase 1, we have maybe 5 shared types (`PtyId`, `PtySpawnArgs`, `PtySpawnResult`, `PtySize`, `PtyData`). Manual sync is trivial at that scale. **Add `ts-rs` when the type surface area grows past ~15 types, likely in Phase 2 or 3.** Early on, a single `types.ts` file with comments referencing Rust structs is sufficient.

### Backend: Ring buffer + 60fps frame batching from day 1

The backend engineer proposes a sophisticated `PtyReadBuffer` with ring buffer, timer-based flushing, and frame batching. This is excellent engineering, but **premature optimization** for Phase 1. Start with the simplest approach:
1. Read from PTY in a loop
2. Base64 encode
3. Emit Tauri event immediately

If benchmarks show this is too slow (which they might), *then* add batching. The benchmark harness should exist in Phase 1 so we have data before optimizing. **Don't build the optimizer before you have evidence it's needed.**

### Frontend: Splitting workspaceStore into 4 stores is over-designed

The frontend engineer proposes splitting into `workspaceStore`, `layoutStore`, `paneStore`, and `focusStore`. This is a reasonable separation of concerns, but for MVP it creates coordination overhead between 4 stores that need to stay in sync. **Start with one `workspaceStore` that handles everything.** If re-render performance becomes a measurable problem (not a theoretical one), extract stores at that point. Zustand selectors already provide fine-grained subscriptions — use those first.

### QA: "Phase 0" for test infrastructure is unnecessary as a separate phase

I understand QA's desire for a formal Phase 0, but this is project management overhead. CI setup, coverage tooling, and mock infrastructure should be the **first tasks within Phase 1**, not a separate phase. Making it a separate phase adds a gate before any real feature work starts, which delays user value delivery. **The first PR in Phase 1 should be: project scaffold + CI pipeline + test infrastructure.** One PR, one phase.

---

## 2. Scope Creep Challenges

### QA: 100% coverage is noble but unrealistic for some code

The QA engineer mandates 100% line coverage across both Rust and React, with `--fail-under 100` in CI. I respect the ambition, and the CLAUDE.md does say "strongly tested." However:

- **100% line coverage does not mean 100% quality.** Tests that exist only to hit coverage thresholds are worse than no tests — they give false confidence and slow down development.
- **Some code is genuinely hard to cover**: entry points (`main.rs`, `main.tsx`), platform-specific branches (can only run on one OS per CI runner), error paths triggered by OS-level failures.
- **Proposal**: Target **95% line coverage** with a mandate that all *business logic* (state management, parsing, persistence, protocol handling) is 100%. UI rendering and platform glue can be lower. This gives us rigor where it matters without chasing coverage for coverage's sake.

### Frontend: Accessibility (a11y) in Round 1 is scope creep

The frontend analysis includes a detailed ARIA and screen reader plan. Accessibility matters, but for an MVP that will initially serve a small technical audience (AI agent operators), full WCAG compliance is not the first priority. **Defer formal a11y to Phase 8 (Polish).** What we should do from Phase 1: use semantic HTML, standard keyboard navigation (Tab/Shift+Tab), and not actively break a11y. But don't invest in `role="treeitem"`, `aria-expanded`, and screen reader testing until after MVP ships.

### Backend: Git info via filesystem watching (`notify` crate) instead of polling

The backend proposes watching `.git/HEAD` and `.git/index` with the `notify` crate for instant git status updates. This is a nice improvement over polling but adds a dependency and complexity. **Polling every 3-5 seconds is good enough for MVP.** Git status display is Phase 3 — and even then, it's a sidebar nicety, not a core feature. Add filesystem watching as an optimization if users complain about stale data.

### Tech Lead: Crash recovery with autosave + clean shutdown markers

This is a good idea that belongs in Phase 3 (persistence), not Phase 1. The tech lead is right that we need it, but the implementation should be:
- Phase 1: No persistence at all
- Phase 3a: Basic layout persistence on explicit close
- Phase 3b: Periodic autosave + crash recovery

Don't front-load crash recovery before basic persistence works.

---

## 3. Defending and Adjusting MVP Definition

### My original MVP was Phases 1-3. I'm adjusting slightly:

After reading the technical analyses, I'm refining the MVP:

**MVP = Phase 1 + Phase 2 + Phase 3a (layout persistence only)**

Phase 3b (scrollback serialization, git info, port scanning) is deferred to a fast-follow. Rationale:
- The backend analysis shows scrollback serialization has hidden complexity (compressed per-pane files, SerializeAddon integration)
- Git/port info is cosmetic at MVP — the terminal works without it
- Layout persistence alone makes the app sticky enough for early adopters

### Keyboard shortcuts: confirmed, must be in Phase 2

Both the tech lead and I agree: basic keybindings (split, close pane, switch workspace, switch pane focus) must ship with Phase 2. Phase 6 is only for the command palette and keybinding customization UI.

### Benchmark harness: confirmed, must be in Phase 1

The tech lead, backend, and I all agree: terminal throughput benchmarking must be a Phase 1 acceptance criterion. The backend's `PtyReadBuffer` optimization can come later, but the *benchmark* exists from day 1.

---

## 4. Addressing QA's Testing Concerns from a Prioritization Lens

### Where I agree with QA:

1. **CI must be operational before any feature code merges.** This is non-negotiable.
2. **TDD commit ordering** (test → impl → refactor) should be visible in git history.
3. **Cross-platform CI matrix** from Phase 1. We cannot defer Windows testing.
4. **Flaky test quarantine protocol** — zero tolerance for flaky tests is correct.
5. **Contract tests for the Rust/React boundary** — this is the highest-risk integration point.

### Where I push back on QA:

1. **Quality gates between phases are too rigid.** "No phase can begin until the previous phase's gate passes" creates waterfall-like sequencing. In practice, some Phase 2 work (e.g., data model design) can begin while Phase 1's final E2E tests are being written. **Proposal: Quality gates apply to *merging to main*, not to *starting work*.** A developer can begin Phase 2 feature branches while Phase 1 is in final testing.
2. **E2E on all 3 platforms for every phase** is expensive and slow. **Proposal**: Full 3-OS E2E runs on merge to main. PR checks run E2E on Linux only (fastest). Mac and Windows E2E run nightly or on release branches.
3. **Performance benchmark regression in CI from Phase 1** is nice but adds CI complexity. **Proposal**: Add performance CI in Phase 3, once the basic pipeline is stable. Manual benchmarks in Phase 1 are sufficient.
4. **Visual regression testing** (Chromatic/Percy) is expensive tooling for an early-stage project. **Defer until after Phase 4** when the UI is stable enough for baselines to be meaningful.

---

## 5. Areas of Agreement Across Roles

These are consensus items where all or most analyses align:

| Topic | Consensus |
|-------|-----------|
| Rust as source of truth for structural state | All agree (PM, Tech Lead, Frontend, Backend) |
| Base64 encoding is OK to start, benchmark early | All agree |
| Cross-platform testing from Phase 1 | All agree (PM, Tech Lead, QA) |
| `PtyBackend` trait for testability | Tech Lead, Backend, QA all propose this |
| xterm.js lifecycle management is critical | Frontend, Tech Lead agree |
| WebGL context limit is a real risk | Frontend raises, Tech Lead acknowledges |
| Error handling strategy needed | Tech Lead and Backend both call this out |
| IPC socket naming collision needs solving | Backend raises, valid concern |

---

## 6. Areas of Disagreement

| Topic | Parties | My Resolution |
|-------|---------|---------------|
| 100% vs 95% coverage target | QA (100%) vs PM (95%) | 95% overall, 100% for business logic modules |
| Shared protocol crate timing | Tech Lead (now) vs PM (Phase 7) | Defer to Phase 7 |
| Store splitting granularity | Frontend (4 stores) vs PM (1 store) | Start with 1, split when perf data justifies |
| Phase 0 for test infra | QA (separate phase) vs PM (within Phase 1) | Within Phase 1, first PR |
| `ts-rs` timing | Tech Lead (day 1) vs PM (Phase 2-3) | When types exceed ~15, likely Phase 2 |
| Ring buffer/batching | Backend (Phase 1) vs PM (when benchmarks justify) | Benchmark first, optimize second |
| a11y timing | Frontend (Phase 1) vs PM (Phase 8) | Semantic HTML from day 1, formal a11y in Phase 8 |
| `notify` crate for git watching | Backend (Phase 3) vs PM (defer) | Polling first, watching if users request it |
| Quality gate rigidity | QA (blocking) vs PM (non-blocking for dev) | Gates apply to merge, not to starting work |

---

## 7. Revised Phase Breakdown Recommendation

Based on all analyses, here is my revised phasing:

### Phase 1: Project Scaffold + Core Terminal + CI
- Project scaffold (Tauri v2 + React + Bun)
- CI pipeline (lint, test, build on 3 OSes)
- Test infrastructure (mocks, fixtures, coverage tooling)
- `PtyBackend` trait + `PtyManager` implementation
- Tauri commands: spawn, write, resize, kill
- `TerminalPane` + `useTerminal` hook
- Bidirectional PTY data flow
- Terminal resize
- **Throughput benchmark harness**
- **Acceptance**: `bun tauri dev` → working terminal on Mac, Linux, Windows

### Phase 2: Workspaces + Split Layout + Keybindings
- `workspaceStore` (single store, selectors for perf)
- Sidebar + workspace list
- `PaneSplitter` recursive layout
- Split/close pane actions
- Surface tabs
- **Basic keyboard shortcuts** (split, close, switch workspace, navigate panes)
- **Acceptance**: Multiple workspaces, split panes, keyboard navigation

### Phase 3a: Layout Persistence (MVP boundary)
- Save layout on close, restore on launch
- Atomic file writes
- Corrupted file recovery (fallback to default)
- **Acceptance**: Close → reopen → layout restored

### Phase 3b: Metadata + Scrollback (fast-follow)
- Scrollback serialization (SerializeAddon)
- Git info (polling every 3-5s)
- Port scanning
- Sidebar metadata display
- Crash recovery (autosave + clean shutdown marker)

### Phases 4-8: As PRD (unchanged)

---

## 8. Key Decisions I Want Resolved in Round 3

1. **Coverage target**: Can QA accept 95% with 100% for core modules?
2. **Store architecture**: Can frontend accept starting with 1 store?
3. **Batching strategy**: Can backend accept "benchmark first, optimize later"?
4. **Quality gate flexibility**: Can QA accept gates on merge, not on starting work?
5. **Error handling**: Tech lead and backend both want this — who writes the error type definitions? This needs an owner.
