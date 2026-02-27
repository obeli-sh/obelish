# Round 3 — Senior QA Engineer: Final Recommendations

After two rounds of debate, the team has converged on most testing decisions. This document captures my final position on all contested and resolved items.

---

## 1. Resolved Disagreements — Final Positions

### 1.1 Coverage Target: Accepting 95% with Per-Module 100%

The PM proposed 95% overall with 100% for business logic. The backend independently proposed the same. The frontend proposed 90% for components + 100% for stores/hooks. The tech lead set 95% as the blocking threshold.

**I accept the compromise, with structure:**

| Scope | CI Gate | Target |
|-------|---------|--------|
| Rust business logic (pty, workspace, osc_parser, persistence, ipc_server/protocol) | 100% | 100% |
| Rust glue code (main.rs, lib.rs, Tauri command registration) | Excluded from gate | Best effort |
| React stores and hooks | 100% | 100% |
| React components | 90% | 95% |
| Overall Rust | 95% | 98% |
| Overall React | 95% | 98% |

**Enforcement mechanism:**
- `cargo-llvm-cov` with `--fail-under 95` for overall Rust workspace
- Per-module coverage checked via a custom CI script that parses `cargo-llvm-cov --json` output and verifies 100% on core modules
- Vitest `coverage.thresholds` set to `{ lines: 95, branches: 90, functions: 95 }` globally, with per-file overrides for stores/hooks at 100%

**My condition for accepting this:** Code excluded from the 100% mandate must be justified with a comment in the source: `// Coverage exclusion: Tauri builder glue, tested via integration tests`. No silent exclusions.

### 1.2 Phase 0: Within Phase 1, First PR

The PM argued Phase 0 as a separate phase is unnecessary overhead, and that test infrastructure should be the first PR within Phase 1. The tech lead supports Phase 0 as a concept but agrees it can be the first deliverable of Phase 1.

**I accept this framing.** The first PR is:
1. Cargo workspace with empty lib crates
2. Frontend scaffold with Vitest, Testing Library, coverage
3. CI pipeline (GitHub Actions) with all jobs defined
4. Pre-commit hooks
5. Mock infrastructure (Tauri API mock, xterm.js mock)
6. Test fixture directory structure
7. `justfile` with `dev`, `test`, `lint`, `coverage` targets

**Quality gate for this PR:** CI pipeline runs and reports coverage (even if it's 0% because there's no code yet). All mock files compile. Pre-commit hook runs without error. This PR MUST merge before any feature PR.

### 1.3 Quality Gates: On Merge, Not on Starting Work

The PM correctly argued that blocking developers from starting Phase N+1 work until Phase N's gate passes creates waterfall-like sequencing. The tech lead agrees.

**I accept gates on merge, not on starting work**, with one non-negotiable condition:

**No feature code from Phase N+1 can merge to `main` until Phase N's quality gate passes.** Developers can work on feature branches for the next phase while the current phase is being finalized, but those branches cannot merge until the gate is green.

This allows parallel work while maintaining quality. The gate criteria from my Round 1 analysis remain unchanged — they just apply to merge eligibility, not work start.

### 1.4 E2E Retries: 1 Retry for E2E Only

The frontend engineer proposed allowing E2E tests 1 retry in CI. I initially proposed zero retries.

**I accept 1 retry for E2E tests only**, with monitoring:
- Unit tests: 0 retries
- Integration tests: 0 retries
- E2E tests: 1 retry
- Any E2E test that uses its retry more than 5% of runs gets flagged and investigated
- Monthly review of retry rate — if overall E2E retry rate exceeds 10%, we have a flakiness problem to address

### 1.5 Windows CI Frequency

The backend proposed nightly Windows CI. I originally wanted every PR. The PM wants all 3 OSes on every PR.

**Compromise:**
- **Every PR:** Linux (full suite + coverage) + macOS (tests only, no coverage)
- **Nightly:** Windows (full suite + coverage)
- **On merge to main:** All 3 OSes, full suite
- **Exception:** Any PR that modifies PTY code, IPC code, or persistence code triggers Windows CI in addition to Linux/macOS

This catches platform-specific bugs in critical paths while keeping PR CI fast.

### 1.6 Frontend Store Architecture: 2 Stores

The frontend proposed 4 stores. The backend proposed 2. The tech lead proposed 2 (workspaceStore + uiStore).

**From a testing perspective, 2 stores is better:**
- Fewer cross-store integration tests needed
- `workspaceStore` as a single Rust state mirror is simple to test (receive event, update state, verify)
- `uiStore` for focus/UI state is purely frontend-testable
- 4 stores means 6 pairs of cross-store interactions to test. 2 stores means 1 pair. This is a significant testing cost reduction.

**My test requirements for the 2-store approach:**
- `workspaceStore`: 15+ unit tests covering every event type handler
- `uiStore`: 10+ unit tests covering focus tracking, panel visibility
- Cross-store: 5+ integration tests covering workspace switch (updates both stores), pane close (updates both), etc.

---

## 2. Final Test Strategy Summary

### 2.1 Testing Pyramid

```
                   E2E Tests (Playwright + tauri-driver)
                  /  ~10% of test effort
                 /   Critical user journeys only
                /    Run in CI on merge to main (all 3 OSes)
               /     Run on PR (Linux only)
              ────────────────────────────────
             /   Integration Tests
            /    ~20% of test effort
           /     Real PTY tests, cross-module Rust tests,
          /      component trees with real stores
         /       Run on every PR (all configured OSes)
        ────────────────────────────────────────
       /        Unit Tests
      /         ~70% of test effort
     /          Every function, every branch, every error path
    /           Run on every PR, pre-commit hook
   ──────────────────────────────────────────────
```

### 2.2 Test Framework Decisions (Consensus)

| Layer | Rust | Frontend |
|-------|------|----------|
| Unit | `cargo test`, `mockall`, `proptest` | Vitest, Testing Library, `renderHook()` |
| Integration | `tests/` directory, real PTY, real sockets | Component trees with real Zustand stores, mocked Tauri API |
| E2E | — | Playwright + `tauri-driver` |
| Coverage | `cargo-llvm-cov` | `@vitest/coverage-v8` |
| Benchmarks | `criterion` | Playwright + Performance API |
| Visual Regression | — | Playwright screenshot comparison |

### 2.3 Mock Strategy (Consensus)

| Dependency | Mock Approach | Used In |
|-----------|--------------|---------|
| PTY (`portable-pty`) | `PtyBackend` trait + `MockPtyBackend` via mockall | Rust unit tests |
| Tauri `invoke()` | `__mocks__/@tauri-apps/api/core.ts` with configurable handlers | Frontend unit/integration tests |
| Tauri `listen()` | `__mocks__/@tauri-apps/api/event.ts` with `emitMockEvent()` helper | Frontend unit/integration tests |
| xterm.js `Terminal` | `__mocks__/@xterm/xterm.ts` with vi.fn() methods | Frontend terminal component tests |
| Filesystem | `tempfile` crate for temp dirs | Rust persistence tests |
| Git commands | `CommandRunner` trait + mock | Rust git module tests |
| Time | `tokio::time::pause()` | Rust async timing tests |

---

## 3. TDD Workflow Specification

### 3.1 The Cycle

Every feature follows Red-Green-Refactor, visible in git history:

```
1. Write a failing test       → commit: "test: add pty_spawn success test"
2. Write minimum code to pass → commit: "feat: implement PtyManager::spawn"
3. Refactor (if needed)       → commit: "refactor: extract spawn config builder"
4. Repeat for next test case
```

### 3.2 PR Review Checklist for TDD Compliance

Reviewers MUST verify:
- [ ] Test commits precede implementation commits in git log
- [ ] All new public functions/methods have corresponding tests
- [ ] Error paths are tested (not just happy paths)
- [ ] Resource cleanup is tested (dispose, unlisten, drop)
- [ ] Coverage did not decrease from the base branch
- [ ] No `#[ignore]` or `test.skip` without linked issue
- [ ] Test names describe behavior, not implementation ("spawns_shell_and_returns_id" not "test_spawn")

### 3.3 When TDD is Mandatory vs Optional

**Mandatory TDD (test-first):**
- All Rust modules (PTY, workspace, OSC parser, persistence, IPC, protocol)
- All Zustand stores and custom hooks
- All Tauri bridge functions
- All utility/helper functions

**Behavioral TDD (test alongside):**
- React components — write behavioral tests (Testing Library) before or alongside implementation. The key is that tests must exist before the PR merges, and they must test behavior (what the user sees/does), not implementation details (CSS classes, internal state).

**Not TDD (test after, if at all):**
- CSS/theming — tested via visual regression screenshots
- Configuration files — validated by build success
- Entry points (main.rs, main.tsx) — tested via integration/E2E

---

## 4. CI/CD Quality Gates (Final)

### 4.1 PR Checks (Must Pass to Merge)

```yaml
# Blocking checks for every PR:
- rust-lint:       cargo fmt --check && cargo clippy -- -D warnings
- rust-test:       cargo test --workspace (Linux + macOS)
- rust-coverage:   cargo llvm-cov --workspace --fail-under 95 (Linux only)
- frontend-lint:   bun run lint && bun run typecheck
- frontend-test:   bun test --coverage (thresholds enforced)
- e2e-linux:       playwright + tauri-driver (Linux)

# Non-blocking but reported:
- e2e-macos:       playwright + tauri-driver (macOS)

# Triggered only for PTY/IPC/persistence changes:
- rust-test-win:   cargo test --workspace (Windows)
```

### 4.2 Merge to Main Checks

```yaml
# All blocking:
- All PR checks above
- e2e-all-platforms: Linux + macOS + Windows
- coverage-report:   Upload to CI artifacts
```

### 4.3 Nightly Checks

```yaml
- full-windows:     cargo test + bun test + e2e (Windows)
- performance:      criterion benchmarks, compare to baseline
- dependency-audit: cargo audit + bun audit
- memory-check:     Long-running E2E with memory monitoring
```

### 4.4 Phase Gate Criteria

| Transition | Gate Criteria |
|-----------|---------------|
| Phase 1 first PR → Phase 1 features | CI pipeline green. Mocks available. Coverage reporting active. |
| Phase 1 → Phase 2 | 95% overall Rust coverage. 100% on pty module. PTY integration tests pass on 3 OSes. Throughput benchmark baseline established and recorded. E2E: app launches, terminal works. |
| Phase 2 → Phase 3a | 100% on workspace/layout stores. 100% on Rust workspace module. Split pane E2E passes. Keyboard shortcuts E2E passes. |
| Phase 3a → Phase 3b | Persistence round-trip E2E passes on 3 OSes. Crash recovery test passes. |
| Phase 3b → Phase 4 | Git/port metadata tests pass. Scrollback serialization round-trip verified. |
| Phase 4 → Phase 5 | OSC parser proptest: 100k+ cases, no panics, no missed notifications. Notification E2E passes. |
| Phase 5 → Phase 6 | Browser pane iframe E2E passes. |
| Phase 6 → Phase 7 | Command palette E2E passes. All shortcuts verified. |
| Phase 7 → Phase 8 | CLI E2E passes. IPC stress test passes (100 concurrent clients). |
| Phase 8 → Release | Full E2E on 3 OSes. No P0/P1 bugs. Performance within targets. No flaky tests (retry rate < 5%). |

---

## 5. Cross-Platform Test Matrix (Final)

```
                    | Unit Tests | Integration | E2E  | Coverage | Benchmark |
--------------------|-----------|-------------|------|----------|-----------|
Linux (PR)          |     Y     |      Y      |  Y   |    Y     |     N     |
macOS (PR)          |     Y     |      Y      |  N*  |    N     |     N     |
Windows (Nightly)   |     Y     |      Y      |  Y   |    Y     |     N     |
All (merge to main) |     Y     |      Y      |  Y   |    Y     |     N     |
Nightly             |     Y     |      Y      |  Y   |    Y     |     Y     |
```

*macOS E2E on PR is non-blocking (informational).

### Platform-Specific Test Cases

These tests MUST exist and run on their respective platforms:

**Windows-specific:**
- ConPTY spawn and I/O
- Named pipe IPC bind/connect
- Shell detection (pwsh > powershell > cmd)
- Path separator handling in persistence
- Job Object child process cleanup
- `COMSPEC` environment variable fallback

**macOS-specific:**
- Unix PTY spawn with `/bin/zsh` default
- Unix socket IPC
- `$SHELL` environment variable detection
- Notification Center integration (via tauri-plugin-notification)

**Linux-specific:**
- Unix PTY spawn with `$SHELL` or `/bin/bash`
- Unix socket IPC with permission checks
- `/proc/net/tcp` port scanning
- Various terminal emulator font rendering (FreeType configs)

---

## 6. Performance Testing Strategy (Final)

### 6.1 Benchmarks (criterion)

| Benchmark | Target | Phase |
|-----------|--------|-------|
| PTY read + base64 encode (10MB) | < 200ms | Phase 1 |
| OSC parser throughput (10MB) | < 50ms | Phase 4 |
| Event serialization (16KB payload) | < 10us | Phase 1 |
| Workspace state serialization | < 1ms | Phase 2 |
| Session persistence write (10 workspaces) | < 50ms | Phase 3a |
| JSON-RPC parse + dispatch | < 100us | Phase 7 |

### 6.2 End-to-End Latency

| Measurement | Target | Method |
|-------------|--------|--------|
| Keystroke to PTY write | < 5ms | Playwright performance marks |
| PTY output to screen render | < 16ms | Custom E2E benchmark |
| Pane split response time | < 100ms | E2E timing |
| Workspace switch time | < 50ms | E2E timing |
| Session restore time (10 panes) | < 2s | E2E timing |

### 6.3 Memory Monitoring

| Check | Threshold | Frequency |
|-------|-----------|-----------|
| Create/destroy 100 terminals | Memory growth < 10MB after GC | Nightly |
| 10 terminals idle for 5 minutes | No memory growth | Nightly |
| Large output (10MB to single terminal) | Peak memory < 200MB | Nightly |

---

## 7. Flaky Test Protocol (Final)

### Detection
- CI tracks test pass/fail history per test
- Any test that fails then passes on retry is flagged
- Weekly report of flaky test rate

### Response
1. **Immediate:** Mark test with `@flaky` annotation (Vitest) or `#[flaky]` custom attribute (Rust)
2. **Within 24 hours:** File an issue with reproduction steps
3. **Within 48 hours:** Fix must be merged, or test is moved to a quarantine suite
4. **Quarantine suite:** Runs nightly, not on PR. Tests in quarantine for > 1 week are deleted.
5. **Root cause categories to track:** timing sensitivity, resource contention, platform variance, external dependency, test isolation failure

### Prevention Checklist (Applied During Code Review)
- [ ] No `sleep()` calls in tests (use polling/events)
- [ ] All async operations have explicit timeouts
- [ ] Each test creates its own resources (temp dirs, sockets, PTY instances)
- [ ] Tests clean up after themselves (Drop impls, afterEach hooks)
- [ ] No dependency on test execution order
- [ ] No shared mutable global state between tests
- [ ] Deterministic test data (fixed seeds for proptest, hardcoded fixtures)

---

## 8. Test Data and Fixture Catalog (Final)

### Directory Structure
```
fixtures/
├── pty/
│   ├── simple_prompt.txt          # Basic shell prompt output
│   ├── colored_output.txt         # ANSI color escape sequences
│   ├── unicode_output.txt         # CJK, emoji, RTL text
│   └── large_output_10mb.bin      # Throughput testing data
├── osc/
│   ├── osc9_simple.bin            # ESC]9;Hello\a
│   ├── osc99_notification.bin     # ESC]99;;body\a
│   ├── osc777_notify.bin          # ESC]777;notify;title;body\a
│   ├── mixed_data_and_osc.bin     # Terminal output interleaved with OSC
│   ├── partial_osc.bin            # OSC sequence split across read boundaries
│   └── malformed_osc.bin          # Invalid/truncated sequences
├── workspace/
│   ├── single_pane.json           # Minimal valid workspace
│   ├── multi_workspace.json       # 3 workspaces, various layouts
│   ├── deep_nested_splits.json    # 4-level deep split tree
│   ├── corrupted.json             # Malformed JSON for error handling
│   ├── empty.json                 # Empty workspace list
│   └── large_state.json           # 20 workspaces, 100 panes (stress test)
├── ipc/
│   ├── valid_requests/            # One file per JSON-RPC method
│   │   ├── workspace_create.json
│   │   ├── pane_split.json
│   │   └── ...
│   ├── invalid_requests/
│   │   ├── missing_method.json
│   │   ├── invalid_json.txt
│   │   ├── oversized_payload.json (>1MB)
│   │   └── ...
│   └── responses/                 # Expected responses for contract tests
│       ├── workspace_create_success.json
│       └── ...
└── screenshots/                   # Golden files for visual regression
    ├── linux/
    ├── macos/
    └── windows/
```

### Fixture Generation

Some fixtures should be generated programmatically in test setup, not stored as files:
- PTY output with specific ANSI sequences (use a builder pattern)
- Workspace state with N panes (use a factory function)
- Random but deterministic data (seeded RNG for proptest)

---

## 9. Regression Testing Strategy (Final)

### Golden File Tests
- OSC parser: Input bytes -> Expected (forwarded bytes, extracted notifications). Golden files in `fixtures/osc/`.
- Workspace serialization: Workspace struct -> Expected JSON. Golden files in `fixtures/workspace/`.
- IPC protocol: Request -> Expected response. Golden files in `fixtures/ipc/`.
- Update golden files explicitly via `UPDATE_GOLDEN=1 cargo test` (never auto-update).

### Visual Regression
- Playwright screenshots on merge to main
- Per-platform baselines (font rendering differs)
- Tolerance: < 0.5% pixel difference (more lenient than my Round 1 proposal of 0.1%, per team feedback about font rendering variance)
- Baselines updated manually via PR (never auto-updated)
- Captured screens: default layout, split panes, notification panel, command palette, settings modal, all themes

### Bug Regression
- Every bug fix PR must include a test that fails without the fix and passes with it
- Regression tests are permanent — never deleted unless the feature is removed
- Bug regression tests are tagged: `#[regression("GH-123")]` / `it.regression('GH-123', ...)`

---

## 10. Answering Open Questions from Round 2

### PM's Questions:
1. **Coverage target**: Accepted 95% overall + 100% for core modules. See section 1.1.
2. **Store architecture**: 2 stores is better from a testing perspective. See section 1.6.
3. **Batching strategy**: Benchmark first, optimize when data justifies it. Correct.
4. **Quality gate flexibility**: Gates on merge, not on starting work. See section 1.3.
5. **Error handling owner**: Backend defines Rust error types. Frontend defines error handling UI. Tech lead reviews the contract. QA verifies error paths are tested.

### Tech Lead's Questions:
1. **WebGL context limit**: Accept canvas fallback for non-visible terminals in Phase 1. Context pooling if needed later.
2. **IPC authentication**: Defer to Phase 7. Local-only socket with file permissions is sufficient for MVP.
3. **Scrollback size default**: 5000 lines. Test memory impact with 20 terminals at 5000 lines in nightly memory check.
4. **Process groups/Job Objects**: Phase 1 requirement. Orphaned processes are a real user-facing problem — not something to tolerate even during development.
5. **`workspace-changed` full state**: Acceptable. Workspace state is small (KB). Full state replacement simplifies testing — one event handler to test, not 7.

### Frontend's Questions:
1. **`workspace-changed` event**: Backend agrees. Full state is simpler. Accepted.
2. **`specta` vs `ts-rs`**: Tech lead should evaluate. Both serve the same purpose. Pick one and move on.
3. **90% component coverage + 100% store/hook coverage**: Accepted as part of the tiered coverage model. See section 1.1.
4. **Keyboard shortcuts phase**: Baked into Phase 2 directly. No Phase 1.5.
5. **`SurfaceTabBar`**: Confirmed needed. Add to file tree.

### Backend's Questions:
1. **Coverage threshold**: 95% overall + 100% on core modules. See section 1.1.
2. **Frontend store count**: 2 stores. See section 1.6.
3. **Windows CI frequency**: See section 1.5 — nightly by default, triggered for critical path changes.
4. **IPC multi-instance**: PID-based socket naming is correct. Discovery file listing active instances.
5. **Shared crate scope**: Start with IPC protocol types only. Add workspace/pane structs when CLI needs them (Phase 7).
6. **Error payload format**: `{ kind, message }` is accepted. Frontend agrees it's more useful than opaque strings.

---

## 11. Final Non-Negotiable QA Requirements

These are the absolute minimum quality standards that cannot be negotiated further:

1. **CI must be green before any feature PR merges.** No exceptions, no "we'll fix it in the next PR."
2. **TDD for all Rust modules and all stores/hooks.** Test commits must precede implementation commits.
3. **95% overall coverage, 100% on core modules.** Enforced by CI, not by honor system.
4. **Cross-platform tests from Phase 1.** At minimum Linux + macOS on every PR, Windows nightly.
5. **Contract tests for every Tauri command and event.** Both sides of the bridge must have matching tests.
6. **Cleanup tests for every resource.** PTY processes, xterm.js instances, event listeners, temp files.
7. **Property-based testing for parsers.** OSC parser must survive arbitrary byte sequences without panicking.
8. **Quality gates on merge.** Phase N code merges only when Phase N-1 gate is green.
9. **No flaky tests in the main suite.** Quarantine within 48 hours, delete within 1 week if not fixed.
10. **Performance baselines from Phase 1.** Criterion benchmarks, regression detection in nightly CI.
