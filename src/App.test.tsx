import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockInvoke, clearInvokeMocks } from '@tauri-apps/api/core';
import { clearEventMocks } from '@tauri-apps/api/event';
import { useWorkspaceStore } from './stores/workspaceStore';
import { useUiStore } from './stores/uiStore';
import App from './App';
import type { WorkspaceInfo } from './lib/workspace-types';

// Mock TerminalPane to avoid xterm.js complexity
vi.mock('./components/terminal/TerminalPane', () => ({
  TerminalPane: vi.fn(({ paneId }: { paneId: string }) => (
    <div data-testid={`terminal-pane-${paneId}`} />
  )),
}));

// Mock ResizeObserver
vi.stubGlobal('ResizeObserver', vi.fn(() => ({
  observe: vi.fn(),
  disconnect: vi.fn(),
  unobserve: vi.fn(),
})));

function makeWorkspace(id: string, name: string): WorkspaceInfo {
  return {
    id,
    name,
    surfaces: [{ id: `${id}-s1`, name: 'Surface 1', layout: { type: 'leaf', paneId: 'pane-1' } }],
    activeSurfaceIndex: 0,
    createdAt: Date.now(),
  };
}

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearInvokeMocks();
    clearEventMocks();
    useWorkspaceStore.setState({ workspaces: {}, activeWorkspaceId: null });
    useUiStore.setState({ focusedPaneId: null, sidebarOpen: true });
    mockInvoke('pty_write', () => undefined);
    mockInvoke('pty_resize', () => undefined);
  });

  it('renders AppLayout with loading state initially', () => {
    mockInvoke('session_restore', () => new Promise(() => {}));
    render(<App />);
    expect(screen.getByText('Loading workspaces...')).toBeInTheDocument();
  });

  it('renders workspace layout after loading', async () => {
    const ws = makeWorkspace('ws-1', 'Test Workspace');
    mockInvoke('session_restore', () => Promise.resolve([ws]));

    render(<App />);

    await vi.waitFor(() => {
      expect(screen.getByText('Test Workspace')).toBeInTheDocument();
    });
  });
});
