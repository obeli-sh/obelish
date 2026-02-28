import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { invoke, mockInvoke, clearInvokeMocks } from '@tauri-apps/api/core';
import { listen, emitMockEvent, clearEventMocks } from '@tauri-apps/api/event';
import { useTerminal } from '../useTerminal';

// Mock ResizeObserver
const mockResizeObserver = {
  observe: vi.fn(),
  disconnect: vi.fn(),
  unobserve: vi.fn(),
};
vi.stubGlobal('ResizeObserver', vi.fn(() => mockResizeObserver));

function createContainer(): HTMLDivElement {
  const el = document.createElement('div');
  document.body.appendChild(el);
  return el;
}

describe('useTerminal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearInvokeMocks();
    clearEventMocks();
    mockInvoke('pty_write', () => undefined);
    mockInvoke('pty_resize', () => undefined);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

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

    // Wait for the effect to run
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

  it('falls back to canvas when WebGL addon throws', async () => {
    // Make the WebglAddon constructor throw
    (WebglAddon as unknown as { shouldThrow: boolean }).shouldThrow = true;

    const container = createContainer();
    const { result } = renderHook(() => useTerminal('pane-1', 'pty-1'));

    act(() => {
      result.current.terminalRef(container);
    });

    await vi.waitFor(() => {
      expect(result.current.terminal.current).not.toBeNull();
    });

    // Terminal should still initialize despite WebGL failure
    expect(result.current.isReady).toBe(true);
    expect(result.current.terminal.current!.open).toHaveBeenCalled();
    // FitAddon should still be loaded
    expect(result.current.terminal.current!.loadAddon).toHaveBeenCalledWith(
      expect.any(FitAddon)
    );

    // Restore
    (WebglAddon as unknown as { shouldThrow: boolean }).shouldThrow = false;
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

    // Unmount before listen resolves
    unmount();

    // Now resolve listen - the cancelled flag should cause immediate unlisten
    await act(async () => {
      resolveListen(unlistenFn);
    });

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
});
