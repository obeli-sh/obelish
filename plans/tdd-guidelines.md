# Obelisk — TDD Methodology Guide

This document defines the TDD workflow that every team member must follow. It provides concrete patterns for both Rust and TypeScript, with examples specific to Obelisk's architecture.

---

## 1. The TDD Cycle: Red-Green-Refactor

Every feature follows this cycle:

```
1. RED:      Write a failing test that describes the desired behavior
2. GREEN:    Write the minimum code to make the test pass
3. REFACTOR: Clean up the code while keeping tests green
4. REPEAT:   Write the next failing test
```

### Git Commit Pattern

TDD must be visible in the git history:

```
commit: test: add PtyManager spawn success test
commit: feat: implement PtyManager::spawn
commit: test: add PtyManager spawn with invalid shell error test
commit: feat: handle invalid shell error in PtyManager::spawn
commit: refactor: extract shell validation into separate function
```

Test commits MUST precede implementation commits. Reviewers verify this during code review.

### Commit Message Convention

```
test:     Add or modify tests
feat:     Add or modify production code to pass tests
fix:      Fix a failing test or a bug (with regression test)
refactor: Change code structure without changing behavior (tests stay green)
chore:    Build, CI, dependency changes
docs:     Documentation only
```

---

## 2. Rust TDD Patterns

### 2.1 Inline Test Modules

Every Rust module contains a `#[cfg(test)]` submodule with tests:

```rust
// src-tauri/src/pty/manager.rs

pub struct PtyManager {
    backend: Box<dyn PtyBackend>,
    sessions: HashMap<String, PtySession>,
}

impl PtyManager {
    pub fn new(backend: Box<dyn PtyBackend>) -> Self {
        Self {
            backend,
            sessions: HashMap::new(),
        }
    }

    pub async fn spawn(&mut self, config: PtyConfig) -> Result<String, PtyError> {
        // Implementation
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockall::predicate::*;

    fn test_config() -> PtyConfig {
        PtyConfig {
            shell: "/bin/sh".into(),
            cwd: std::env::temp_dir(),
            env: HashMap::new(),
            size: PtySize { rows: 24, cols: 80 },
        }
    }

    #[tokio::test]
    async fn spawn_returns_valid_id() {
        let mut mock_backend = MockPtyBackend::new();
        mock_backend
            .expect_spawn()
            .returning(|_| Ok(PtyHandle::new("test-handle")));

        let mut manager = PtyManager::new(Box::new(mock_backend));
        let id = manager.spawn(test_config()).await.unwrap();

        assert!(!id.is_empty());
    }

    #[tokio::test]
    async fn spawn_with_invalid_shell_returns_error() {
        let mut mock_backend = MockPtyBackend::new();
        mock_backend
            .expect_spawn()
            .returning(|_| Err(PtyError::SpawnFailed(
                std::io::Error::new(std::io::ErrorKind::NotFound, "shell not found")
            )));

        let mut manager = PtyManager::new(Box::new(mock_backend));
        let result = manager.spawn(PtyConfig {
            shell: "/nonexistent".into(),
            ..test_config()
        }).await;

        assert!(matches!(result, Err(PtyError::SpawnFailed(_))));
    }

    #[tokio::test]
    async fn kill_unknown_id_returns_error() {
        let mock_backend = MockPtyBackend::new();
        let mut manager = PtyManager::new(Box::new(mock_backend));

        let result = manager.kill("nonexistent").await;

        assert!(matches!(result, Err(PtyError::NotFound { .. })));
    }

    #[tokio::test]
    async fn write_after_kill_returns_error() {
        let mut mock_backend = MockPtyBackend::new();
        mock_backend
            .expect_spawn()
            .returning(|_| Ok(PtyHandle::new("h1")));
        mock_backend
            .expect_kill()
            .returning(|_| Ok(()));

        let mut manager = PtyManager::new(Box::new(mock_backend));
        let id = manager.spawn(test_config()).await.unwrap();
        manager.kill(&id).await.unwrap();

        let result = manager.write(&id, b"hello").await;
        assert!(matches!(result, Err(PtyError::AlreadyKilled { .. })));
    }
}
```

### 2.2 Trait-Based Mocking with mockall

Define traits for all external interfaces:

```rust
// src-tauri/src/pty/backend.rs

#[cfg_attr(test, mockall::automock)]
pub trait PtyBackend: Send + Sync {
    fn spawn(&self, config: PtyConfig) -> Result<PtyHandle, PtyError>;
    fn write(&self, handle: &PtyHandle, data: &[u8]) -> Result<(), PtyError>;
    fn resize(&self, handle: &PtyHandle, size: PtySize) -> Result<(), PtyError>;
    fn kill(&self, handle: &PtyHandle) -> Result<(), PtyError>;
}

// Production implementation
pub struct RealPtyBackend;

impl PtyBackend for RealPtyBackend {
    fn spawn(&self, config: PtyConfig) -> Result<PtyHandle, PtyError> {
        let pty_system = portable_pty::native_pty_system();
        let pair = pty_system.openpty(config.size.into())?;
        // ...
    }
    // ...
}
```

### 2.3 Property-Based Testing with proptest

For parsers, serialization, and state machines:

```rust
// src-tauri/src/pty/osc_parser.rs

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    // The parser must never panic, regardless of input
    proptest! {
        #[test]
        fn never_panics(data in prop::collection::vec(any::<u8>(), 0..10000)) {
            let mut parser = OscParser::new();
            let _ = parser.feed(&data);
        }
    }

    // The parser forwards all input bytes (does not consume/drop data)
    proptest! {
        #[test]
        fn forwards_all_bytes(data in prop::collection::vec(any::<u8>(), 0..10000)) {
            let mut parser = OscParser::new();
            let (forwarded, _) = parser.feed(&data);
            assert_eq!(forwarded.len(), data.len());
        }
    }

    // Known OSC 9 sequences are always detected
    proptest! {
        #[test]
        fn extracts_osc9(payload in "[a-zA-Z0-9 ]{1,100}") {
            let mut parser = OscParser::new();
            let input = format!("\x1b]9;{}\x07", payload);
            let (_, notifications) = parser.feed(input.as_bytes());
            assert_eq!(notifications.len(), 1);
            assert_eq!(notifications[0].body, payload);
        }
    }

    // Serialization round-trips are identity
    proptest! {
        #[test]
        fn workspace_roundtrip(ws in arb_workspace()) {
            let json = serde_json::to_string(&ws).unwrap();
            let restored: Workspace = serde_json::from_str(&json).unwrap();
            assert_eq!(ws, restored);
        }
    }
}
```

### 2.4 Integration Tests with Real Resources

Place integration tests in `tests/` directory:

```rust
// src-tauri/tests/pty_integration.rs

use obelisk::pty::{PtyConfig, PtyManager, RealPtyBackend, PtySize};
use tokio::time::{timeout, Duration};

#[tokio::test]
async fn spawn_and_read_prompt() {
    let backend = RealPtyBackend::new();
    let mut manager = PtyManager::new(Box::new(backend));

    let id = manager.spawn(PtyConfig {
        shell: default_shell(),
        cwd: std::env::temp_dir(),
        env: Default::default(),
        size: PtySize { rows: 24, cols: 80 },
    }).await.unwrap();

    // Wait for prompt (poll, don't sleep)
    let output = timeout(Duration::from_secs(5), async {
        let mut accumulated = Vec::new();
        loop {
            if let Some(data) = manager.try_read(&id).await {
                accumulated.extend_from_slice(&data);
                // Shell prompts typically end with $ or # or %
                let text = String::from_utf8_lossy(&accumulated);
                if text.contains('$') || text.contains('#') || text.contains('%') {
                    return accumulated;
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }).await.expect("Timed out waiting for prompt");

    assert!(!output.is_empty());
    manager.kill(&id).await.unwrap();
}

#[tokio::test]
async fn write_echo_read() {
    let backend = RealPtyBackend::new();
    let mut manager = PtyManager::new(Box::new(backend));
    let id = manager.spawn(default_config()).await.unwrap();

    // Wait for shell to be ready
    wait_for_prompt(&mut manager, &id).await;

    // Write command
    manager.write(&id, b"echo test_output_12345\n").await.unwrap();

    // Wait for output containing our marker
    let output = timeout(Duration::from_secs(5), async {
        let mut accumulated = String::new();
        loop {
            if let Some(data) = manager.try_read(&id).await {
                accumulated.push_str(&String::from_utf8_lossy(&data));
                if accumulated.contains("test_output_12345") {
                    return accumulated;
                }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }).await.expect("Timed out waiting for echo output");

    assert!(output.contains("test_output_12345"));
    manager.kill(&id).await.unwrap();
}
```

### 2.5 Benchmark Tests with criterion

```rust
// src-tauri/benches/pty_throughput.rs

use criterion::{criterion_group, criterion_main, Criterion, Throughput};
use base64::Engine;

fn bench_base64_encode(c: &mut Criterion) {
    let data = vec![0u8; 16 * 1024]; // 16KB chunk (typical PTY read)

    let mut group = c.benchmark_group("pty-encode");
    group.throughput(Throughput::Bytes(data.len() as u64));

    group.bench_function("base64-encode-16kb", |b| {
        b.iter(|| {
            base64::engine::general_purpose::STANDARD.encode(&data)
        });
    });

    group.finish();
}

fn bench_osc_parse(c: &mut Criterion) {
    // 10MB of mixed terminal data with occasional OSC sequences
    let data = generate_mixed_terminal_data(10 * 1024 * 1024);

    let mut group = c.benchmark_group("osc-parser");
    group.throughput(Throughput::Bytes(data.len() as u64));

    group.bench_function("parse-10mb", |b| {
        b.iter(|| {
            let mut parser = OscParser::new();
            parser.feed(&data)
        });
    });

    group.finish();
}

criterion_group!(benches, bench_base64_encode, bench_osc_parse);
criterion_main!(benches);
```

---

## 3. React TDD Patterns

### 3.1 Store Testing (100% Coverage Required)

Zustand stores are pure logic — test them without rendering:

```typescript
// src/stores/__tests__/workspaceStore.test.ts

import { useWorkspaceStore } from '../workspaceStore';

describe('workspaceStore', () => {
  beforeEach(() => {
    // Reset store to initial state before each test
    useWorkspaceStore.setState({
      workspaces: {},
      activeWorkspaceId: null,
    });
  });

  // RED: Write this test first. It will fail because the store doesn't exist yet.
  it('starts with no workspaces', () => {
    const state = useWorkspaceStore.getState();
    expect(state.workspaces).toEqual({});
    expect(state.activeWorkspaceId).toBeNull();
  });

  // RED: Write this test. Implement _syncWorkspace to make it GREEN.
  it('syncs workspace on workspace-changed event', () => {
    const ws = mockWorkspaceInfo({ id: 'ws1', name: 'Test' });

    useWorkspaceStore.getState()._syncWorkspace('ws1', ws);

    const state = useWorkspaceStore.getState();
    expect(state.workspaces['ws1']).toEqual(ws);
  });

  // RED: Write this test. Implement _removeWorkspace to make it GREEN.
  it('removes workspace on close', () => {
    const ws = mockWorkspaceInfo({ id: 'ws1' });
    useWorkspaceStore.getState()._syncWorkspace('ws1', ws);

    useWorkspaceStore.getState()._removeWorkspace('ws1');

    expect(useWorkspaceStore.getState().workspaces['ws1']).toBeUndefined();
  });

  // Test error paths
  it('removing nonexistent workspace is a no-op', () => {
    useWorkspaceStore.getState()._removeWorkspace('nonexistent');
    expect(useWorkspaceStore.getState().workspaces).toEqual({});
  });

  // Test selector behavior
  it('getActiveWorkspace returns null when no active workspace', () => {
    expect(useWorkspaceStore.getState().getActiveWorkspace()).toBeNull();
  });

  it('getActiveWorkspace returns the active workspace', () => {
    const ws = mockWorkspaceInfo({ id: 'ws1' });
    useWorkspaceStore.setState({
      workspaces: { ws1: ws },
      activeWorkspaceId: 'ws1',
    });
    expect(useWorkspaceStore.getState().getActiveWorkspace()).toEqual(ws);
  });
});
```

### 3.2 Hook Testing (100% Coverage Required)

Test hooks with `renderHook()`:

```typescript
// src/components/terminal/__tests__/useTerminal.test.ts

import { renderHook, act, waitFor } from '@testing-library/react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { Terminal } from '@xterm/xterm';
import { useTerminal } from '../useTerminal';

vi.mock('@tauri-apps/api/event');
vi.mock('@tauri-apps/api/core');
vi.mock('@xterm/xterm');

describe('useTerminal', () => {
  let mockUnlisten: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockUnlisten = vi.fn();
    (listen as Mock).mockResolvedValue(mockUnlisten);
  });

  // RED: Hook doesn't exist yet. This test fails.
  it('returns a ref callback and isReady=false initially', () => {
    const { result } = renderHook(() => useTerminal('p1', 'pty1'));
    expect(result.current.terminalRef).toBeDefined();
    expect(result.current.isReady).toBe(false);
  });

  // RED: Terminal creation not implemented. This test fails.
  it('creates Terminal when ref callback receives an element', () => {
    const { result } = renderHook(() => useTerminal('p1', 'pty1'));

    const container = document.createElement('div');
    act(() => {
      result.current.terminalRef(container);
    });

    expect(Terminal).toHaveBeenCalled();
    const mockTerminal = (Terminal as Mock).mock.instances[0];
    expect(mockTerminal.open).toHaveBeenCalledWith(container);
  });

  // RED: Event subscription not implemented.
  it('subscribes to pty-data event', async () => {
    renderHook(() => useTerminal('p1', 'pty1'));

    await waitFor(() => {
      expect(listen).toHaveBeenCalledWith('pty-data-pty1', expect.any(Function));
    });
  });

  // RED: Data decoding not implemented.
  it('writes decoded base64 data to terminal', async () => {
    const { result } = renderHook(() => useTerminal('p1', 'pty1'));

    // Attach terminal
    const container = document.createElement('div');
    act(() => result.current.terminalRef(container));

    // Simulate receiving PTY data
    await waitFor(() => {
      const handler = (listen as Mock).mock.calls
        .find((c: any[]) => c[0] === 'pty-data-pty1')?.[1];
      expect(handler).toBeDefined();
      handler({ payload: { data: btoa('hello') } });
    });

    const mockTerminal = (Terminal as Mock).mock.instances[0];
    expect(mockTerminal.write).toHaveBeenCalled();
  });

  // RED: Cleanup not implemented.
  it('disposes terminal and unlistens on unmount', async () => {
    const { result, unmount } = renderHook(() => useTerminal('p1', 'pty1'));

    // Attach terminal
    const container = document.createElement('div');
    act(() => result.current.terminalRef(container));

    unmount();

    const mockTerminal = (Terminal as Mock).mock.instances[0];
    expect(mockTerminal.dispose).toHaveBeenCalled();
    expect(mockUnlisten).toHaveBeenCalled();
  });

  // RED: Resize not implemented.
  it('calls pty_resize on terminal resize', async () => {
    const { result } = renderHook(() => useTerminal('p1', 'pty1'));

    // Attach terminal
    const container = document.createElement('div');
    act(() => result.current.terminalRef(container));

    // Simulate resize event from xterm.js
    const mockTerminal = (Terminal as Mock).mock.instances[0];
    const onResizeCallback = mockTerminal.onResize.mock.calls[0]?.[0];
    if (onResizeCallback) {
      act(() => onResizeCallback({ cols: 120, rows: 40 }));
    }

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('pty_resize', {
        ptyId: 'pty1',
        cols: 120,
        rows: 40,
      });
    });
  });
});
```

### 3.3 Component Testing (95%+ Coverage, Behavioral)

Test what the component does, not how it renders:

```typescript
// src/components/layout/__tests__/Sidebar.test.tsx

import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar } from '../Sidebar';

describe('Sidebar', () => {
  const mockWs1 = mockWorkspaceInfo({ id: 'ws1', name: 'Project A' });
  const mockWs2 = mockWorkspaceInfo({ id: 'ws2', name: 'Project B' });
  const defaultHandlers = {
    onWorkspaceSelect: vi.fn(),
    onWorkspaceCreate: vi.fn(),
    onWorkspaceClose: vi.fn(),
  };

  // RED: Component doesn't exist. Fails.
  it('renders workspace names', () => {
    render(
      <Sidebar
        workspaces={[mockWs1, mockWs2]}
        activeWorkspaceId={mockWs1.id}
        {...defaultHandlers}
      />
    );

    expect(screen.getByText('Project A')).toBeInTheDocument();
    expect(screen.getByText('Project B')).toBeInTheDocument();
  });

  // RED: Active highlighting not implemented. Fails.
  it('highlights the active workspace', () => {
    render(
      <Sidebar
        workspaces={[mockWs1, mockWs2]}
        activeWorkspaceId={mockWs1.id}
        {...defaultHandlers}
      />
    );

    const activeItem = screen.getByText('Project A').closest('[data-active]');
    expect(activeItem).toHaveAttribute('data-active', 'true');
  });

  // RED: Click handler not wired. Fails.
  it('calls onWorkspaceSelect when workspace clicked', async () => {
    const onSelect = vi.fn();
    render(
      <Sidebar
        workspaces={[mockWs1]}
        activeWorkspaceId=""
        onWorkspaceSelect={onSelect}
        onWorkspaceCreate={vi.fn()}
        onWorkspaceClose={vi.fn()}
      />
    );

    await userEvent.click(screen.getByText('Project A'));
    expect(onSelect).toHaveBeenCalledWith('ws1');
  });

  // Test create button
  it('calls onWorkspaceCreate when create button clicked', async () => {
    const onCreate = vi.fn();
    render(
      <Sidebar
        workspaces={[]}
        activeWorkspaceId=""
        onWorkspaceSelect={vi.fn()}
        onWorkspaceCreate={onCreate}
        onWorkspaceClose={vi.fn()}
      />
    );

    await userEvent.click(screen.getByRole('button', { name: /new workspace/i }));
    expect(onCreate).toHaveBeenCalled();
  });

  // Test empty state
  it('renders empty state message when no workspaces', () => {
    render(
      <Sidebar
        workspaces={[]}
        activeWorkspaceId=""
        {...defaultHandlers}
      />
    );

    expect(screen.getByText(/no workspaces/i)).toBeInTheDocument();
  });
});
```

### 3.4 Tauri Bridge Testing (100% Coverage Required)

Every bridge function must verify it calls `invoke()` with the exact command name and arguments:

```typescript
// src/lib/__tests__/tauri-bridge.test.ts

import { invoke } from '@tauri-apps/api/core';
import { tauriBridge } from '../tauri-bridge';

vi.mock('@tauri-apps/api/core');

describe('tauriBridge.pty', () => {
  beforeEach(() => vi.clearAllMocks());

  it('spawn calls invoke with correct command and args', async () => {
    (invoke as Mock).mockResolvedValue({ ptyId: 'pty-abc' });

    const result = await tauriBridge.pty.spawn({ cwd: '/home/user' });

    expect(invoke).toHaveBeenCalledWith('pty_spawn', { cwd: '/home/user' });
    expect(result.ptyId).toBe('pty-abc');
  });

  it('write calls invoke with ptyId and base64 data', async () => {
    (invoke as Mock).mockResolvedValue(undefined);

    await tauriBridge.pty.write('pty-abc', btoa('hello'));

    expect(invoke).toHaveBeenCalledWith('pty_write', {
      ptyId: 'pty-abc',
      data: btoa('hello'),
    });
  });

  it('resize sends cols and rows as numbers', async () => {
    (invoke as Mock).mockResolvedValue(undefined);

    await tauriBridge.pty.resize('pty-abc', 120, 40);

    expect(invoke).toHaveBeenCalledWith('pty_resize', {
      ptyId: 'pty-abc',
      cols: 120,
      rows: 40,
    });
  });

  it('kill calls invoke with ptyId', async () => {
    (invoke as Mock).mockResolvedValue(undefined);

    await tauriBridge.pty.kill('pty-abc');

    expect(invoke).toHaveBeenCalledWith('pty_kill', { ptyId: 'pty-abc' });
  });

  it('spawn propagates backend errors', async () => {
    (invoke as Mock).mockRejectedValue({ kind: 'SpawnFailed', message: 'shell not found' });

    await expect(tauriBridge.pty.spawn({ shell: '/nonexistent' }))
      .rejects.toEqual({ kind: 'SpawnFailed', message: 'shell not found' });
  });
});
```

---

## 4. Integration TDD: Testing the Rust-React Boundary

### 4.1 Contract Tests for Tauri Commands

For each Tauri command, both sides of the bridge must have matching tests:

**Rust side** (unit test):
```rust
#[tokio::test]
async fn pty_spawn_returns_pty_id() {
    let mut mock = MockPtyBackend::new();
    mock.expect_spawn().returning(|_| Ok(PtyHandle::new("h1")));
    let state = AppState::new(mock);
    let result = pty_spawn(state.into(), None, None, None).await;
    assert!(result.is_ok());
    assert!(!result.unwrap().pty_id.is_empty());
}
```

**TypeScript side** (unit test):
```typescript
it('spawn calls invoke with correct command', async () => {
    (invoke as Mock).mockResolvedValue({ ptyId: 'pty1' });
    const result = await tauriBridge.pty.spawn({});
    expect(invoke).toHaveBeenCalledWith('pty_spawn', {});
    expect(result.ptyId).toBe('pty1');
});
```

**Type contract** (ts-rs):
```rust
#[derive(Serialize, TS)]
#[ts(export)]
pub struct PtySpawnResult {
    pub pty_id: String,
}
```

The generated TypeScript type is imported by the frontend, ensuring the type contract cannot drift.

### 4.2 Contract Tests for Tauri Events

**Rust side** (verifies correct event emission):
```rust
#[tokio::test]
async fn pty_read_emits_data_event() {
    let (tx, mut rx) = tokio::sync::mpsc::channel(10);
    let mock_emitter = MockEventEmitter::new(tx);
    // ... setup PTY with mock emitter ...

    let event = rx.recv().await.unwrap();
    assert_eq!(event.name, "pty-data-test-id");
    assert!(!event.payload.data.is_empty());
}
```

**TypeScript side** (verifies correct event handling):
```typescript
it('writes received PTY data to terminal', async () => {
    renderHook(() => useTerminal('p1', 'pty1'));

    // Simulate Tauri event
    emitMockEvent('pty-data-pty1', { data: btoa('hello world') });

    const mockTerminal = (Terminal as Mock).mock.instances[0];
    expect(mockTerminal.write).toHaveBeenCalled();
});
```

---

## 5. E2E TDD: Writing E2E Tests Before Features

For each phase's verification scenario, write the E2E test FIRST:

### Phase 1 Example:

```typescript
// e2e/terminal.spec.ts

import { test, expect } from '@playwright/test';

// RED: This test is written BEFORE the terminal feature is implemented.
// It defines the acceptance criteria.

test('app launches with a terminal', async ({ page }) => {
  // Navigate to the Tauri app
  await page.goto('/');

  // Terminal container should exist
  const terminal = page.locator('[data-testid="terminal-container"]');
  await expect(terminal).toBeVisible();
});

test('terminal accepts keyboard input', async ({ page }) => {
  await page.goto('/');

  // Focus the terminal
  const terminal = page.locator('[data-testid="terminal-container"]');
  await terminal.click();

  // Type a command
  await page.keyboard.type('echo hello_e2e_test');
  await page.keyboard.press('Enter');

  // Verify output appears (poll with timeout, not sleep)
  await expect(page.locator('text=hello_e2e_test')).toBeVisible({ timeout: 5000 });
});

test('terminal handles resize', async ({ page }) => {
  await page.goto('/');

  // Get initial terminal size
  const terminal = page.locator('[data-testid="terminal-container"]');
  const initialBox = await terminal.boundingBox();

  // Resize the window
  await page.setViewportSize({ width: 1200, height: 800 });

  // Terminal should have resized
  const newBox = await terminal.boundingBox();
  expect(newBox!.width).toBeGreaterThan(initialBox!.width);
});
```

### Phase 2 Example:

```typescript
// e2e/workspace.spec.ts

// RED: Written BEFORE workspace feature is implemented.

test('can create a new workspace', async ({ page }) => {
  await page.goto('/');

  // Use keyboard shortcut to create workspace
  await page.keyboard.press('Control+n');

  // Verify workspace appears in sidebar
  const sidebar = page.locator('[data-testid="sidebar"]');
  const workspaceItems = sidebar.locator('[data-testid="workspace-item"]');
  await expect(workspaceItems).toHaveCount(2); // default + new
});

test('can split pane horizontally', async ({ page }) => {
  await page.goto('/');

  await page.keyboard.press('Control+Shift+h');

  // Verify two terminal panes are visible
  const terminals = page.locator('[data-testid^="terminal-container"]');
  await expect(terminals).toHaveCount(2);
});
```

---

## 6. Common Pitfalls: Anti-Patterns to Avoid

### 6.1 Testing Implementation Details

```typescript
// BAD: Tests internal state structure
it('sets _internal_flag to true', () => {
  const store = useWorkspaceStore.getState();
  store.createWorkspace();
  expect(store._internal_flag).toBe(true); // Fragile!
});

// GOOD: Tests observable behavior
it('creates a workspace with a default name', () => {
  const store = useWorkspaceStore.getState();
  store.createWorkspace();
  const workspaces = Object.values(store.workspaces);
  expect(workspaces).toHaveLength(1);
  expect(workspaces[0].name).toBeDefined();
});
```

### 6.2 Using sleep() in Tests

```rust
// BAD: Timing-dependent, will be flaky
#[tokio::test]
async fn reads_pty_output() {
    let id = manager.spawn(config).await.unwrap();
    tokio::time::sleep(Duration::from_secs(1)).await;
    let data = manager.read(&id).await;
    assert!(!data.is_empty());
}

// GOOD: Poll with timeout
#[tokio::test]
async fn reads_pty_output() {
    let id = manager.spawn(config).await.unwrap();
    let data = timeout(Duration::from_secs(5), async {
        loop {
            if let Some(data) = manager.try_read(&id).await {
                if !data.is_empty() { return data; }
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
    }).await.expect("Timed out");
    assert!(!data.is_empty());
}
```

### 6.3 Snapshot Tests for Components

```typescript
// BAD: Snapshot tests are brittle and tell you nothing about correctness
it('matches snapshot', () => {
  const { container } = render(<Sidebar {...props} />);
  expect(container).toMatchSnapshot();
});

// GOOD: Behavioral tests describe what the user sees
it('renders workspace names in the sidebar', () => {
  render(<Sidebar workspaces={[ws1, ws2]} {...props} />);
  expect(screen.getByText(ws1.name)).toBeInTheDocument();
  expect(screen.getByText(ws2.name)).toBeInTheDocument();
});
```

### 6.4 Not Testing Error Paths

```rust
// BAD: Only tests the happy path
#[test]
fn spawn_works() {
    let result = manager.spawn(valid_config()).await;
    assert!(result.is_ok());
}

// GOOD: Tests both success and failure
#[test]
fn spawn_succeeds_with_valid_shell() { ... }

#[test]
fn spawn_fails_with_invalid_shell() { ... }

#[test]
fn spawn_fails_when_cwd_not_found() { ... }

#[test]
fn spawn_fails_when_max_ptys_reached() { ... }
```

### 6.5 Not Testing Cleanup

```typescript
// BAD: Tests mount but not unmount
it('creates terminal on mount', () => {
  render(<TerminalPane paneId="p1" ptyId="pty1" />);
  expect(Terminal).toHaveBeenCalled();
});

// GOOD: Tests both mount and unmount
it('creates terminal on mount', () => {
  render(<TerminalPane paneId="p1" ptyId="pty1" />);
  expect(Terminal).toHaveBeenCalled();
});

it('disposes terminal on unmount', () => {
  const { unmount } = render(<TerminalPane paneId="p1" ptyId="pty1" />);
  unmount();
  expect(mockTerminal.dispose).toHaveBeenCalled();
});

it('cleans up event listeners on unmount', () => {
  const { unmount } = render(<TerminalPane paneId="p1" ptyId="pty1" />);
  unmount();
  expect(mockUnlisten).toHaveBeenCalled();
});
```

### 6.6 Shared Mutable State Between Tests

```typescript
// BAD: Tests share state and break when run in different order
let store: WorkspaceStore;
beforeAll(() => { store = createStore(); });

it('creates workspace', () => {
  store.createWorkspace(); // Mutates shared store
  expect(Object.keys(store.workspaces)).toHaveLength(1);
});

it('starts empty', () => {
  expect(Object.keys(store.workspaces)).toHaveLength(0); // FAILS! Previous test left state.
});

// GOOD: Each test gets a fresh store
beforeEach(() => {
  useWorkspaceStore.setState(initialState);
});
```

---

## 7. Code Review Checklist for Testing

Every PR reviewer must verify:

### TDD Compliance
- [ ] Test commits precede implementation commits in git log
- [ ] Tests fail without the implementation (reviewer can check by reverting the feat commit locally)

### Test Quality
- [ ] Tests describe behavior, not implementation
- [ ] Test names are descriptive: `spawn_returns_valid_id` not `test_spawn`
- [ ] Error paths are tested (invalid input, resource not found, permission denied)
- [ ] Edge cases are tested (empty input, maximum values, concurrent access)

### Resource Management
- [ ] Every component that calls `listen()` has a cleanup test verifying `unlisten()` is called
- [ ] Every component that creates a `Terminal` has a test verifying `.dispose()` on unmount
- [ ] Every Rust test that spawns a PTY kills it in cleanup (or uses a Drop impl)
- [ ] Every test that creates temp files/dirs cleans up (or uses `tempfile::TempDir` which auto-cleans)

### Coverage
- [ ] Coverage did not decrease from the base branch
- [ ] Core modules maintain 100% coverage
- [ ] Any coverage exclusion has a justification comment

### Cross-Platform
- [ ] No hardcoded paths (`/bin/bash`, `C:\Windows\...`)
- [ ] Platform-specific code uses `#[cfg(unix)]` / `#[cfg(windows)]`
- [ ] Platform-specific behavior differences are documented in test comments

### No Anti-Patterns
- [ ] No `sleep()` in tests
- [ ] No snapshot tests for React components
- [ ] No `#[ignore]` or `test.skip` without a linked issue
- [ ] No `.unwrap()` in production code (`.expect("context")` or `?` propagation)
- [ ] No `any` types in TypeScript test code
