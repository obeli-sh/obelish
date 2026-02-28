import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { mockInvoke, clearInvokeMocks } from '@tauri-apps/api/core';
import { clearEventMocks } from '@tauri-apps/api/event';
import { Terminal } from '@xterm/xterm';
import { TerminalPane } from '../TerminalPane';

// Mock ResizeObserver
vi.stubGlobal('ResizeObserver', vi.fn(() => ({
  observe: vi.fn(),
  disconnect: vi.fn(),
  unobserve: vi.fn(),
})));

describe('TerminalPane', () => {
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

  it('renders terminal container with data-testid', () => {
    render(<TerminalPane paneId="pane-1" ptyId="pty-1" isActive={false} />);
    expect(screen.getByTestId('terminal-container')).toBeInTheDocument();
  });

  it('focuses terminal when isActive becomes true', async () => {
    const { rerender } = render(
      <TerminalPane paneId="pane-1" ptyId="pty-1" isActive={false} />
    );

    // Wait for terminal to initialize
    const mockTerminal = Terminal as unknown as { instances: Terminal[] };
    await vi.waitFor(() => {
      expect(mockTerminal.instances.length).toBeGreaterThan(0);
    });

    const instance = mockTerminal.instances[0];

    // Wait for effects to settle
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });

    // Clear focus call history from initialization
    (instance.focus as ReturnType<typeof vi.fn>).mockClear();

    rerender(<TerminalPane paneId="pane-1" ptyId="pty-1" isActive={true} />);

    await vi.waitFor(() => {
      expect(instance.focus).toHaveBeenCalled();
    });
  });

  it('calls onReady when terminal initializes', async () => {
    const onReady = vi.fn();

    render(
      <TerminalPane paneId="pane-1" ptyId="pty-1" isActive={true} onReady={onReady} />
    );

    await vi.waitFor(() => {
      expect(onReady).toHaveBeenCalled();
    });
  });

  it('calls onReady only once even with rapid re-renders', async () => {
    const onReady = vi.fn();

    const { rerender } = render(
      <TerminalPane paneId="pane-1" ptyId="pty-1" isActive={true} onReady={onReady} />
    );

    await vi.waitFor(() => {
      expect(onReady).toHaveBeenCalledTimes(1);
    });

    // Re-render multiple times to simulate Strict Mode double-firing
    rerender(<TerminalPane paneId="pane-1" ptyId="pty-1" isActive={false} onReady={onReady} />);
    rerender(<TerminalPane paneId="pane-1" ptyId="pty-1" isActive={true} onReady={onReady} />);
    rerender(<TerminalPane paneId="pane-1" ptyId="pty-1" isActive={true} onReady={onReady} />);

    // Allow effects to settle
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });

    // onReady should still only have been called once
    expect(onReady).toHaveBeenCalledTimes(1);
  });

  it('does not crash when terminal.focus throws', async () => {
    const { rerender } = render(
      <TerminalPane paneId="pane-1" ptyId="pty-1" isActive={false} />
    );

    const mockTerminal = Terminal as unknown as { instances: Terminal[] };
    await vi.waitFor(() => {
      expect(mockTerminal.instances.length).toBeGreaterThan(0);
    });

    const instance = mockTerminal.instances[0];

    // Make focus throw (simulates disposed terminal)
    (instance.focus as ReturnType<typeof vi.fn>).mockImplementation(() => {
      throw new Error('Terminal is disposed');
    });

    // This should not throw
    expect(() => {
      rerender(<TerminalPane paneId="pane-1" ptyId="pty-1" isActive={true} />);
    }).not.toThrow();
  });
});
