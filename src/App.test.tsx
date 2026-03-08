import { render, screen } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mockInvoke, clearInvokeMocks } from '@tauri-apps/api/core';
import { clearEventMocks } from '@tauri-apps/api/event';
import { useWorkspaceStore } from './stores/workspaceStore';
import { useUiStore } from './stores/uiStore';
import * as TerminalPaneModule from './components/terminal/TerminalPane';
import App from './App';
import type { WorkspaceInfo } from './lib/workspace-types';

function makeWorkspace(id: string, name: string): WorkspaceInfo {
  return {
    id,
    name,
    projectId: '',
    worktreePath: '',
    branchName: null,
    isRootWorktree: false,
    surfaces: [{ id: `${id}-s1`, name: 'Surface 1', layout: { type: 'leaf', paneId: 'pane-1', ptyId: 'pty-1' } }],
    activeSurfaceIndex: 0,
    createdAt: Date.now(),
  };
}

describe('App', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearInvokeMocks();
    clearEventMocks();
    // Mock TerminalPane to avoid xterm.js complexity
    vi.spyOn(TerminalPaneModule, 'TerminalPane').mockImplementation(
      ({ paneId }: { paneId: string }) => (
        <div data-testid={`terminal-pane-${paneId}`} />
      ),
    );
    useWorkspaceStore.setState({ workspaces: {}, activeWorkspaceId: null });
    useUiStore.setState({ focusedPaneId: null, sidebarOpen: true });
    mockInvoke('pty_write', () => undefined);
    mockInvoke('pty_resize', () => undefined);
    mockInvoke('scrollback_load', () => null);
    mockInvoke('settings_get', () => Promise.resolve(null));
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
