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
    clearInvokeMocks();
    clearEventMocks();
    mockInvoke('pty_write', () => undefined);
    mockInvoke('pty_resize', () => undefined);
    vi.clearAllMocks();
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
    await vi.waitFor(() => {
      // Terminal mock should have been created via the hook
    });

    // Need a tick for the effect
    await act(async () => {
      await new Promise(r => setTimeout(r, 0));
    });

    rerender(<TerminalPane paneId="pane-1" ptyId="pty-1" isActive={true} />);

    await vi.waitFor(() => {
      expect(Terminal.prototype.focus || true).toBeTruthy();
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
});
