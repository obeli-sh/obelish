import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockInvoke, clearInvokeMocks } from '@tauri-apps/api/core';
import { clearEventMocks } from '@tauri-apps/api/event';
import App from './App';

// Mock ResizeObserver
vi.stubGlobal('ResizeObserver', vi.fn(() => ({
  observe: vi.fn(),
  disconnect: vi.fn(),
  unobserve: vi.fn(),
})));

describe('App', () => {
  beforeEach(() => {
    clearInvokeMocks();
    clearEventMocks();
    mockInvoke('pty_write', () => undefined);
    mockInvoke('pty_resize', () => undefined);
    vi.clearAllMocks();
  });

  it('shows loading state initially', () => {
    mockInvoke('pty_spawn', () => new Promise(() => {})); // never resolves
    render(<App />);
    expect(screen.getByText('Loading terminal...')).toBeInTheDocument();
  });

  it('spawns a PTY on mount and renders TerminalPane', async () => {
    mockInvoke('pty_spawn', () => Promise.resolve({ pty_id: 'test-pty-1' }));

    render(<App />);

    await vi.waitFor(() => {
      expect(screen.getByTestId('terminal-container')).toBeInTheDocument();
    });
  });

  it('shows error message when PTY spawn fails', async () => {
    mockInvoke('pty_spawn', () => Promise.reject(new Error('spawn failed')));

    render(<App />);

    await vi.waitFor(() => {
      expect(screen.getByText(/Failed to spawn terminal/)).toBeInTheDocument();
    });
  });
});
