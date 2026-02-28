import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockInvoke, clearInvokeMocks } from '@tauri-apps/api/core';
import { clearEventMocks, emitMockEvent } from '@tauri-apps/api/event';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useUiStore } from '../../stores/uiStore';
import type { WorkspaceInfo } from '../../lib/workspace-types';
import * as TerminalPaneModule from '../terminal/TerminalPane';
import { AppLayout } from '../AppLayout';

function makeWorkspace(id: string, name: string, paneId = 'pane-1', ptyId = 'pty-1'): WorkspaceInfo {
  return {
    id,
    name,
    surfaces: [{ id: `${id}-s1`, name: 'Surface 1', layout: { type: 'leaf', paneId, ptyId } }],
    activeSurfaceIndex: 0,
    createdAt: Date.now(),
  };
}

function makeWorkspaceMultiSurface(id: string, name: string): WorkspaceInfo {
  return {
    id,
    name,
    surfaces: [
      { id: `${id}-s1`, name: 'Surface 1', layout: { type: 'leaf', paneId: 'pane-1', ptyId: 'pty-1' } },
      { id: `${id}-s2`, name: 'Surface 2', layout: { type: 'leaf', paneId: 'pane-2', ptyId: 'pty-2' } },
    ],
    activeSurfaceIndex: 0,
    createdAt: Date.now(),
  };
}

describe('AppLayout', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    clearInvokeMocks();
    clearEventMocks();
    // Mock TerminalPane to avoid xterm.js complexity
    vi.spyOn(TerminalPaneModule, 'TerminalPane').mockImplementation(
      ({ paneId, ptyId, isActive }: { paneId: string; ptyId: string; isActive: boolean }) => (
        <div data-testid={`terminal-pane-${paneId}`} data-pty-id={ptyId} data-active={isActive} />
      ),
    );
    // Reset stores
    useWorkspaceStore.setState({ workspaces: {}, activeWorkspaceId: null });
    useUiStore.setState({ focusedPaneId: null, sidebarOpen: true, notificationPanelOpen: false });
    // Default mocks for commands that may be called
    mockInvoke('pty_write', () => undefined);
    mockInvoke('pty_resize', () => undefined);
    mockInvoke('scrollback_load', () => null);
  });

  it('shows loading state initially', () => {
    mockInvoke('session_restore', () => new Promise(() => {})); // never resolves
    render(<AppLayout />);
    expect(screen.getByText('Loading workspaces...')).toBeInTheDocument();
  });

  it('shows error state when session restore fails', async () => {
    mockInvoke('session_restore', () => Promise.reject(new Error('backend down')));
    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByText(/Failed to load workspaces: backend down/)).toBeInTheDocument();
    });
  });

  it('session restore returns workspaces (backend creates default if needed)', async () => {
    const defaultWs = makeWorkspace('ws-1', 'Workspace 1');
    mockInvoke('session_restore', () => Promise.resolve([defaultWs]));

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.queryByText('Loading workspaces...')).not.toBeInTheDocument();
    });

    // Store should have the workspace
    const state = useWorkspaceStore.getState();
    expect(state.workspaces['ws-1']).toBeDefined();
    expect(state.activeWorkspaceId).toBe('ws-1');
  });

  it('renders sidebar with workspaces after load', async () => {
    const ws1 = makeWorkspace('ws-1', 'My Workspace', 'pane-1');
    mockInvoke('session_restore', () => Promise.resolve([ws1]));

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByText('My Workspace')).toBeInTheDocument();
    });

    // Sidebar navigation should be present
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('renders PaneSplitter with active surface layout', async () => {
    const ws = makeWorkspace('ws-1', 'Workspace 1', 'pane-1');
    mockInvoke('session_restore', () => Promise.resolve([ws]));

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByTestId('terminal-pane-pane-1')).toBeInTheDocument();
    });
  });

  it('handles workspace select', async () => {
    const user = userEvent.setup();
    const ws1 = makeWorkspace('ws-1', 'Workspace 1', 'pane-1');
    const ws2 = makeWorkspace('ws-2', 'Workspace 2', 'pane-2');
    mockInvoke('session_restore', () => Promise.resolve([ws1, ws2]));

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByText('Workspace 2')).toBeInTheDocument();
    });

    // Click on second workspace
    await user.click(screen.getByText('Workspace 2'));

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-2');
  });

  it('handles workspace create', async () => {
    const user = userEvent.setup();
    const ws1 = makeWorkspace('ws-1', 'Workspace 1', 'pane-1');
    const newWs = makeWorkspace('ws-new', 'New Workspace', 'pane-new', 'pty-new');
    mockInvoke('session_restore', () => Promise.resolve([ws1]));
    mockInvoke('workspace_create', () => Promise.resolve(newWs));

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /new workspace/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /new workspace/i }));

    await waitFor(() => {
      const state = useWorkspaceStore.getState();
      expect(state.workspaces['ws-new']).toBeDefined();
      expect(state.activeWorkspaceId).toBe('ws-new');
    });
  });

  it('handles workspace close', async () => {
    const user = userEvent.setup();
    const ws1 = makeWorkspace('ws-1', 'Workspace 1', 'pane-1');
    mockInvoke('session_restore', () => Promise.resolve([ws1]));
    mockInvoke('workspace_close', () => Promise.resolve());

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /close workspace 1/i })).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /close workspace 1/i }));

    await waitFor(() => {
      expect(useWorkspaceStore.getState().workspaces['ws-1']).toBeUndefined();
    });
  });

  it('hides sidebar when sidebarOpen is false', async () => {
    const ws1 = makeWorkspace('ws-1', 'Workspace 1', 'pane-1');
    mockInvoke('session_restore', () => Promise.resolve([ws1]));

    // Set sidebar closed before render
    useUiStore.setState({ sidebarOpen: false });

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByTestId('terminal-pane-pane-1')).toBeInTheDocument();
    });

    // Navigation should not be rendered when sidebar is closed
    expect(screen.queryByRole('navigation')).not.toBeInTheDocument();
  });

  it('sets focused pane on initial load', async () => {
    const ws = makeWorkspace('ws-1', 'Workspace 1', 'pane-1');
    mockInvoke('session_restore', () => Promise.resolve([ws]));

    render(<AppLayout />);

    await waitFor(() => {
      expect(useUiStore.getState().focusedPaneId).toBe('pane-1');
    });
  });

  it('subscribes to workspace-changed event', async () => {
    const ws = makeWorkspace('ws-1', 'Workspace 1', 'pane-1');
    mockInvoke('session_restore', () => Promise.resolve([ws]));

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByTestId('terminal-pane-pane-1')).toBeInTheDocument();
    });

    // Simulate workspace-changed event with updated workspace
    const updatedWs = makeWorkspace('ws-1', 'Updated Name', 'pane-1');
    act(() => {
      emitMockEvent('workspace-changed', {
        workspaceId: 'ws-1',
        workspace: updatedWs,
      });
    });

    await waitFor(() => {
      expect(screen.getByText('Updated Name')).toBeInTheDocument();
    });
  });

  it('shows SurfaceTabBar only when multiple surfaces exist', async () => {
    const ws = makeWorkspaceMultiSurface('ws-1', 'Workspace 1');
    mockInvoke('session_restore', () => Promise.resolve([ws]));

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByRole('tablist')).toBeInTheDocument();
    });

    // Both surface names should be visible
    expect(screen.getByText('Surface 1')).toBeInTheDocument();
    expect(screen.getByText('Surface 2')).toBeInTheDocument();
  });

  it('does not show SurfaceTabBar for single surface', async () => {
    const ws = makeWorkspace('ws-1', 'Workspace 1', 'pane-1');
    mockInvoke('session_restore', () => Promise.resolve([ws]));

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByTestId('terminal-pane-pane-1')).toBeInTheDocument();
    });

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('restores multiple workspaces and activates first', async () => {
    const ws1 = makeWorkspace('ws-1', 'Work', 'pane-1');
    const ws2 = makeWorkspace('ws-2', 'Personal', 'pane-2');
    mockInvoke('session_restore', () => Promise.resolve([ws1, ws2]));

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.queryByText('Loading workspaces...')).not.toBeInTheDocument();
    });

    const state = useWorkspaceStore.getState();
    expect(state.workspaces['ws-1']).toBeDefined();
    expect(state.workspaces['ws-2']).toBeDefined();
    expect(state.activeWorkspaceId).toBe('ws-1');
    expect(useUiStore.getState().focusedPaneId).toBe('pane-1');
  });
});
