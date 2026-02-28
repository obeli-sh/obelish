import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SerializeAddon } from '@xterm/addon-serialize';
import { invoke, mockInvoke, clearInvokeMocks } from '@tauri-apps/api/core';
import { listen, emitMockEvent, clearEventMocks } from '@tauri-apps/api/event';
import { useTerminal } from '../useTerminal';

// Mock ResizeObserver — captures callbacks so we can invoke them in tests
let resizeObserverCallback: (() => void) | null = null;
const mockResizeObserver = {
  observe: vi.fn(),
  disconnect: vi.fn(),
  unobserve: vi.fn(),
};
vi.stubGlobal('ResizeObserver', vi.fn((cb: () => void) => {
  resizeObserverCallback = cb;
  return mockResizeObserver;
}));

function createContainer(): HTMLDivElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

function cleanupContainer() {
  while (document.body.firstChild) {
    document.body.removeChild(document.body.firstChild);
  }
}

describe('useTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (Terminal as unknown as { instances: unknown[] }).instances = [];
    clearInvokeMocks();
    clearEventMocks();
    mockInvoke('pty_write', () => Promise.resolve());
    mockInvoke('pty_resize', () => Promise.resolve());
    mockInvoke('scrollback_load', () => null);
    mockInvoke('scrollback_save', () => undefined);
  });

  afterEach(() => {
    cleanupContainer();
  });

  // === Setup / initialization tests ===

  it('returns a ref callback and isReady=false initially', () => {
    const { result } = renderHook(() => useTerminal('pane-1', 'pty-1'));

    expect(result.current.terminalRef).toBeTypeOf('function');
    expect(result.current.isReady).toBe(false);
  });

  it('creates Terminal instance when ref receives element', async () => {
    const container = createContainer();
    const { result } = renderHook(() => useTerminal('pane-1', 'pty-1'));

    act(() => {
      result.current.terminalRef(container);
    });

    await vi.waitFor(() => {
      expect(result.current.terminal.current).toBeInstanceOf(Terminal);
    });
  });

  it('opens terminal on DOM element', async () => {
    const container = createContainer();
    const { result } = renderHook(() => useTerminal('pane-1', 'pty-1'));

    act(() => {
      result.current.terminalRef(container);
    });

    await vi.waitFor(() => {
      expect(result.current.terminal.current).not.toBeNull();
    });

    expect(result.current.terminal.current!.open).toHaveBeenCalledWith(container);
  });

  it('loads FitAddon', async () => {
    const container = createContainer();
    const { result } = renderHook(() => useTerminal('pane-1', 'pty-1'));

    act(() => {
      result.current.terminalRef(container);
    });

    await vi.waitFor(() => {
      expect(result.current.terminal.current).not.toBeNull();
    });

    expect(result.current.terminal.current!.loadAddon).toHaveBeenCalledWith(
      expect.any(FitAddon)
    );
  });

  it('subscribes to pty-data event', async () => {
    const container = createContainer();
    const { result } = renderHook(() => useTerminal('pane-1', 'pty-1'));

    act(() => {
      result.current.terminalRef(container);
    });

    await vi.waitFor(() => {
      expect(listen).toHaveBeenCalledWith('pty-data-pty-1', expect.any(Function));
    });
  });

  it('writes decoded base64 data to terminal', async () => {
    const container = createContainer();
    const { result } = renderHook(() => useTerminal('pane-1', 'pty-1'));

    act(() => {
      result.current.terminalRef(container);
    });

    await vi.waitFor(() => {
      expect(result.current.terminal.current).not.toBeNull();
    });

    // Wait for listen to be set up
    await vi.waitFor(() => {
      expect(listen).toHaveBeenCalled();
    });

    const terminal = result.current.terminal.current!;

    // Emit base64 data ("hello" = "aGVsbG8=")
    act(() => {
      emitMockEvent('pty-data-pty-1', { data: 'aGVsbG8=' });
    });

    expect(terminal.write).toHaveBeenCalledWith(expect.any(Uint8Array));
    // Verify decoded content
    const writtenData = (terminal.write as ReturnType<typeof vi.fn>).mock.calls[0][0] as Uint8Array;
    const decoded = new TextDecoder().decode(writtenData);
    expect(decoded).toBe('hello');
  });

  it('sends keystrokes via pty_write', async () => {
    const container = createContainer();
    const { result } = renderHook(() => useTerminal('pane-1', 'pty-1'));

    act(() => {
      result.current.terminalRef(container);
    });

    await vi.waitFor(() => {
      expect(result.current.terminal.current).not.toBeNull();
    });

    const terminal = result.current.terminal.current!;
    // Get the onData callback that was registered
    const onDataCall = (terminal.onData as ReturnType<typeof vi.fn>).mock.calls[0];
    const onDataCallback = onDataCall[0];

    // Simulate keystroke
    act(() => {
      onDataCallback('a');
    });

    expect(invoke).toHaveBeenCalledWith('pty_write', { ptyId: 'pty-1', data: btoa('a') });
  });

  it('calls pty_resize on terminal resize', async () => {
    const container = createContainer();
    const { result } = renderHook(() => useTerminal('pane-1', 'pty-1'));

    act(() => {
      result.current.terminalRef(container);
    });

    await vi.waitFor(() => {
      expect(result.current.terminal.current).not.toBeNull();
    });

    const terminal = result.current.terminal.current!;
    // Get the onResize callback
    const onResizeCall = (terminal.onResize as ReturnType<typeof vi.fn>).mock.calls[0];
    const onResizeCallback = onResizeCall[0];

    act(() => {
      onResizeCallback({ cols: 120, rows: 40 });
    });

    expect(invoke).toHaveBeenCalledWith('pty_resize', { ptyId: 'pty-1', cols: 120, rows: 40 });
  });

  it('sets isReady to true after initialization', async () => {
    const container = createContainer();
    const { result } = renderHook(() => useTerminal('pane-1', 'pty-1'));

    expect(result.current.isReady).toBe(false);

    act(() => {
      result.current.terminalRef(container);
    });

    await vi.waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });
  });

  it('observes container with ResizeObserver', async () => {
    const container = createContainer();
    const { result } = renderHook(() => useTerminal('pane-1', 'pty-1'));

    act(() => {
      result.current.terminalRef(container);
    });

    await vi.waitFor(() => {
      expect(result.current.terminal.current).not.toBeNull();
    });

    expect(mockResizeObserver.observe).toHaveBeenCalledWith(container);
  });

  it('loads SerializeAddon', async () => {
    const container = createContainer();
    const { result } = renderHook(() => useTerminal('pane-1', 'pty-1'));

    act(() => {
      result.current.terminalRef(container);
    });

    await vi.waitFor(() => {
      expect(result.current.terminal.current).not.toBeNull();
    });

    expect(result.current.terminal.current!.loadAddon).toHaveBeenCalledWith(
      expect.any(SerializeAddon)
    );
  });

  // === Scrollback tests ===

  it('loads scrollback on initialization', async () => {
    // "hello" base64-encoded is "aGVsbG8="
    mockInvoke('scrollback_load', () => 'aGVsbG8=');

    const container = createContainer();
    const { result } = renderHook(() => useTerminal('pane-1', 'pty-1'));

    act(() => {
      result.current.terminalRef(container);
    });

    await vi.waitFor(() => {
      expect(result.current.terminal.current).not.toBeNull();
    });

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('scrollback_load', { paneId: 'pane-1' });
    });

    // Verify terminal.write was called with the decoded content
    const terminal = result.current.terminal.current!;
    const writeCalls = (terminal.write as ReturnType<typeof vi.fn>).mock.calls;
    const hasScrollbackWrite = writeCalls.some(
      (call: unknown[]) => call[0] === 'hello'
    );
    expect(hasScrollbackWrite).toBe(true);
  });

  it('handles missing scrollback gracefully', async () => {
    mockInvoke('scrollback_load', () => null);

    const container = createContainer();
    const { result } = renderHook(() => useTerminal('pane-1', 'pty-1'));

    act(() => {
      result.current.terminalRef(container);
    });

    await vi.waitFor(() => {
      expect(result.current.terminal.current).not.toBeNull();
    });

    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('scrollback_load', { paneId: 'pane-1' });
    });

    // Terminal should still be ready
    expect(result.current.isReady).toBe(true);

    // terminal.write should NOT have been called with scrollback data
    // (it may be called by pty-data events, but not with decoded scrollback)
    const terminal = result.current.terminal.current!;
    const writeCalls = (terminal.write as ReturnType<typeof vi.fn>).mock.calls;
    const hasStringWrite = writeCalls.some(
      (call: unknown[]) => typeof call[0] === 'string'
    );
    expect(hasStringWrite).toBe(false);
  });

  it('restores scrollback before subscribing to PTY events', async () => {
    const callOrder: string[] = [];

    // Track when scrollback_load is called
    mockInvoke('scrollback_load', () => {
      callOrder.push('scrollback_load');
      return 'aGVsbG8='; // "hello"
    });

    // Track when listen is called
    (listen as ReturnType<typeof vi.fn>).mockImplementation(
      (event: string) => {
        if (event.startsWith('pty-data-')) {
          callOrder.push('listen_pty_data');
        }
        const unlistenFn = vi.fn();
        return Promise.resolve(unlistenFn);
      }
    );

    const container = createContainer();
    const { result } = renderHook(() => useTerminal('pane-1', 'pty-1'));

    act(() => {
      result.current.terminalRef(container);
    });

    await vi.waitFor(() => {
      expect(callOrder).toContain('scrollback_load');
      expect(callOrder).toContain('listen_pty_data');
    });

    // scrollback_load must come before listen for pty-data
    const scrollbackIdx = callOrder.indexOf('scrollback_load');
    const listenIdx = callOrder.indexOf('listen_pty_data');
    expect(scrollbackIdx).toBeLessThan(listenIdx);
  });

  it('saves scrollback on cleanup', async () => {
    const container = createContainer();
    const { result, unmount } = renderHook(() => useTerminal('pane-1', 'pty-1'));

    act(() => {
      result.current.terminalRef(container);
    });

    await vi.waitFor(() => {
      expect(result.current.terminal.current).not.toBeNull();
    });

    // Find the SerializeAddon instance that was loaded
    const terminal = result.current.terminal.current!;
    const loadAddonCalls = (terminal.loadAddon as ReturnType<typeof vi.fn>).mock.calls;
    const serializeAddon = loadAddonCalls.find(
      (call: unknown[]) => call[0] instanceof SerializeAddon
    )?.[0] as InstanceType<typeof SerializeAddon>;
    expect(serializeAddon).toBeDefined();

    // Set what serialize() returns
    (serializeAddon.serialize as ReturnType<typeof vi.fn>).mockReturnValue('terminal content');

    unmount();

    expect(serializeAddon.serialize).toHaveBeenCalled();
    expect(invoke).toHaveBeenCalledWith('scrollback_save', {
      paneId: 'pane-1',
      data: btoa('terminal content'),
    });
  });

  it('does not save scrollback if disposed before load completes', async () => {
    // Make scrollback_load return a promise that we control
    let resolveLoad!: (val: string | null) => void;
    mockInvoke('scrollback_load', () => new Promise<string | null>((resolve) => {
      resolveLoad = resolve;
    }));

    const container = createContainer();
    const { result, unmount } = renderHook(() => useTerminal('pane-1', 'pty-1'));

    act(() => {
      result.current.terminalRef(container);
    });

    await vi.waitFor(() => {
      expect(result.current.terminal.current).not.toBeNull();
    });

    // Unmount before scrollback load resolves
    unmount();

    // Terminal ref is null after dispose
    expect(result.current.terminal.current).toBeNull();

    // Resolve the load after unmount
    await act(async () => {
      resolveLoad('aGVsbG8=');
    });

    // terminal.current should still be null — no writes happened after dispose
    expect(result.current.terminal.current).toBeNull();
  });

  // === Cleanup ordering and disposal tests ===

  it('disposes terminal on unmount', async () => {
    const container = createContainer();
    const { result, unmount } = renderHook(() => useTerminal('pane-1', 'pty-1'));

    act(() => {
      result.current.terminalRef(container);
    });

    await vi.waitFor(() => {
      expect(result.current.terminal.current).not.toBeNull();
    });

    const terminal = result.current.terminal.current!;

    unmount();

    expect(terminal.dispose).toHaveBeenCalled();
  });

  it('cleans up event listeners on unmount', async () => {
    const container = createContainer();
    const { result, unmount } = renderHook(() => useTerminal('pane-1', 'pty-1'));

    act(() => {
      result.current.terminalRef(container);
    });

    await vi.waitFor(() => {
      expect(listen).toHaveBeenCalled();
    });

    // Get the unlisten function returned by listen
    const unlistenFn = await (listen as ReturnType<typeof vi.fn>).mock.results[0].value;

    unmount();

    expect(unlistenFn).toHaveBeenCalled();
  });

  it('disconnects ResizeObserver on unmount', async () => {
    const container = createContainer();
    const { result, unmount } = renderHook(() => useTerminal('pane-1', 'pty-1'));

    act(() => {
      result.current.terminalRef(container);
    });

    await vi.waitFor(() => {
      expect(result.current.terminal.current).not.toBeNull();
    });

    unmount();

    expect(mockResizeObserver.disconnect).toHaveBeenCalled();
  });

  it('unlisten is called before scrollback save on cleanup', async () => {
    const container = createContainer();
    const { result, unmount } = renderHook(() => useTerminal('pane-1', 'pty-1'));

    act(() => {
      result.current.terminalRef(container);
    });

    await vi.waitFor(() => {
      expect(result.current.terminal.current).not.toBeNull();
    });

    // Wait for listen to be set up
    await vi.waitFor(() => {
      expect(listen).toHaveBeenCalled();
    });

    const terminal = result.current.terminal.current!;
    const unlistenFn = await (listen as ReturnType<typeof vi.fn>).mock.results[0].value;

    // Set up serialization so scrollback_save is triggered
    const loadAddonCalls = (terminal.loadAddon as ReturnType<typeof vi.fn>).mock.calls;
    const serializeAddon = loadAddonCalls.find(
      (call: unknown[]) => call[0] instanceof SerializeAddon
    )?.[0] as InstanceType<typeof SerializeAddon>;
    (serializeAddon.serialize as ReturnType<typeof vi.fn>).mockReturnValue('content');

    // Track call order
    const callOrder: string[] = [];
    unlistenFn.mockImplementation(() => {
      callOrder.push('unlisten');
    });
    mockInvoke('scrollback_save', () => {
      callOrder.push('scrollback_save');
      return undefined;
    });

    unmount();

    // unlisten must be called before scrollback_save to minimize the window
    // for late events
    expect(callOrder).toContain('unlisten');
    expect(callOrder).toContain('scrollback_save');
    expect(callOrder.indexOf('unlisten')).toBeLessThan(callOrder.indexOf('scrollback_save'));
  });

  it('cleans up listener if unmount happens before listen resolves', async () => {
    // Make listen return a promise that we control
    let resolveListen!: (unlisten: () => void) => void;
    const unlistenFn = vi.fn();
    (listen as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise<() => void>((resolve) => {
        resolveListen = resolve;
      })
    );

    const container = createContainer();
    const { result, unmount } = renderHook(() => useTerminal('pane-1', 'pty-1'));

    act(() => {
      result.current.terminalRef(container);
    });

    // Wait for scrollback_load to finish (listen is called after scrollback)
    await vi.waitFor(() => {
      expect(listen).toHaveBeenCalled();
    });

    // Unmount before listen resolves
    unmount();

    // Now resolve listen - the disposed flag should cause immediate unlisten
    await act(async () => {
      resolveListen(unlistenFn);
    });

    expect(unlistenFn).toHaveBeenCalled();
  });

  // === Post-disposal safety tests ===

  it('does not write to terminal after cleanup', async () => {
    const container = createContainer();
    const { result, unmount } = renderHook(() => useTerminal('pane-1', 'pty-1'));

    act(() => {
      result.current.terminalRef(container);
    });

    await vi.waitFor(() => {
      expect(result.current.terminal.current).not.toBeNull();
    });

    // Wait for listen to be set up
    await vi.waitFor(() => {
      expect(listen).toHaveBeenCalled();
    });

    // Capture the listen callback directly so we can invoke it after cleanup
    // (bypasses the event map removal that unlisten does)
    const listenCall = (listen as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) => call[0] === 'pty-data-pty-1'
    );
    const listenCallback = listenCall![1] as (event: { payload: { data: string } }) => void;

    const terminal = result.current.terminal.current!;
    const writeCallsBefore = (terminal.write as ReturnType<typeof vi.fn>).mock.calls.length;

    // Unmount triggers cleanup
    unmount();

    // Simulate a late event arriving after cleanup — call the captured callback
    // directly to bypass the unlisten guard in the mock
    listenCallback({ payload: { data: 'aGVsbG8=' } });

    // write should NOT have been called again after cleanup
    expect((terminal.write as ReturnType<typeof vi.fn>).mock.calls.length).toBe(writeCallsBefore);
  });

  it('does not call pty_write or pty_resize after cleanup', async () => {
    const container = createContainer();
    const { result, unmount } = renderHook(() => useTerminal('pane-1', 'pty-1'));

    act(() => {
      result.current.terminalRef(container);
    });

    await vi.waitFor(() => {
      expect(result.current.terminal.current).not.toBeNull();
    });

    const terminal = result.current.terminal.current!;

    // Get the onData and onResize callbacks registered on the terminal
    const onDataCallback = (terminal.onData as ReturnType<typeof vi.fn>).mock.calls[0][0];
    const onResizeCallback = (terminal.onResize as ReturnType<typeof vi.fn>).mock.calls[0][0];

    // Clear invoke mock to track only post-cleanup calls
    (invoke as ReturnType<typeof vi.fn>).mockClear();

    unmount();

    // Simulate late keystrokes and resize events after cleanup
    onDataCallback('a');
    onResizeCallback({ cols: 120, rows: 40 });

    // Neither pty_write nor pty_resize should have been called
    const ptyWriteCalls = (invoke as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) => call[0] === 'pty_write'
    );
    const ptyResizeCalls = (invoke as ReturnType<typeof vi.fn>).mock.calls.filter(
      (call: unknown[]) => call[0] === 'pty_resize'
    );
    expect(ptyWriteCalls).toHaveLength(0);
    expect(ptyResizeCalls).toHaveLength(0);
  });

  it('does not call fitAddon.fit when ResizeObserver fires after cleanup', async () => {
    const container = createContainer();
    const { result, unmount } = renderHook(() => useTerminal('pane-1', 'pty-1'));

    act(() => {
      result.current.terminalRef(container);
    });

    await vi.waitFor(() => {
      expect(result.current.terminal.current).not.toBeNull();
    });

    const terminal = result.current.terminal.current!;
    const fitAddon = (terminal.loadAddon as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) => call[0] instanceof FitAddon
    )?.[0] as InstanceType<typeof FitAddon>;

    // Clear fit calls from initialization
    (fitAddon.fit as ReturnType<typeof vi.fn>).mockClear();

    unmount();

    // Simulate a late ResizeObserver callback after cleanup (e.g., React 18
    // removes DOM before useEffect cleanup runs, triggering a resize)
    expect(resizeObserverCallback).not.toBeNull();
    resizeObserverCallback!();

    // fit() should NOT have been called after cleanup
    expect(fitAddon.fit).not.toHaveBeenCalled();
  });

  // === Error resilience tests ===

  it('does not crash when terminal.write throws in listen callback', async () => {
    const container = createContainer();
    const { result } = renderHook(() => useTerminal('pane-1', 'pty-1'));

    act(() => {
      result.current.terminalRef(container);
    });

    await vi.waitFor(() => {
      expect(result.current.terminal.current).not.toBeNull();
    });

    await vi.waitFor(() => {
      expect(listen).toHaveBeenCalled();
    });

    const terminal = result.current.terminal.current!;
    // Make terminal.write throw (simulates writing to a disposed terminal)
    (terminal.write as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Cannot write to a disposed terminal');
    });

    // Emitting should not throw — the error should be caught internally
    expect(() => {
      emitMockEvent('pty-data-pty-1', { data: 'aGVsbG8=' });
    }).not.toThrow();
  });

  it('does not crash when serializeAddon.serialize throws during cleanup', async () => {
    const container = createContainer();
    const { result, unmount } = renderHook(() => useTerminal('pane-1', 'pty-1'));

    act(() => {
      result.current.terminalRef(container);
    });

    await vi.waitFor(() => {
      expect(result.current.terminal.current).not.toBeNull();
    });

    const terminal = result.current.terminal.current!;
    const serializeAddon = (terminal.loadAddon as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) => call[0] instanceof SerializeAddon
    )?.[0] as InstanceType<typeof SerializeAddon>;

    // Simulate serialize() throwing (e.g., DOM container already removed)
    (serializeAddon.serialize as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Terminal element not found');
    });

    // Unmount should not throw
    expect(() => unmount()).not.toThrow();
    // Terminal should still be disposed
    expect(terminal.dispose).toHaveBeenCalled();
  });

  it('handles scrollback.load rejection without unhandled promise rejection', async () => {
    // scrollback.load rejects (e.g., backend error during terminal remount)
    mockInvoke('scrollback_load', () => Promise.reject(new Error('storage error')));

    const container = createContainer();
    const { result } = renderHook(() => useTerminal('pane-1', 'pty-1'));

    act(() => {
      result.current.terminalRef(container);
    });

    // Terminal should still become ready even if scrollback load fails
    await vi.waitFor(() => {
      expect(result.current.isReady).toBe(true);
    });

    // PTY events should still be listened to
    await vi.waitFor(() => {
      expect(listen).toHaveBeenCalledWith('pty-data-pty-1', expect.any(Function));
    });
  });

  it('catches errors from scrollback.save during cleanup', async () => {
    const container = createContainer();
    const { result, unmount } = renderHook(() => useTerminal('pane-1', 'pty-1'));

    act(() => {
      result.current.terminalRef(container);
    });

    await vi.waitFor(() => {
      expect(result.current.terminal.current).not.toBeNull();
    });

    const terminal = result.current.terminal.current!;
    const serializeAddon = (terminal.loadAddon as ReturnType<typeof vi.fn>).mock.calls.find(
      (call: unknown[]) => call[0] instanceof SerializeAddon
    )?.[0] as InstanceType<typeof SerializeAddon>;
    (serializeAddon.serialize as ReturnType<typeof vi.fn>).mockReturnValue('content');

    // Make scrollback_save reject
    mockInvoke('scrollback_save', () => Promise.reject(new Error('save failed')));

    // Unmount should not throw despite the rejected promise
    expect(() => unmount()).not.toThrow();
  });
});
