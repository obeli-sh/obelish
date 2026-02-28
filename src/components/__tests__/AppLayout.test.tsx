import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { mockInvoke, clearInvokeMocks } from '@tauri-apps/api/core';
import { clearEventMocks, emitMockEvent } from '@tauri-apps/api/event';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useUiStore } from '../../stores/uiStore';
import type { WorkspaceInfo } from '../../lib/workspace-types';
import * as TerminalPaneModule from '../terminal/TerminalPane';
import * as TerminalToolbarModule from '../terminal/TerminalToolbar';
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
    vi.spyOn(TerminalToolbarModule, 'TerminalToolbar').mockImplementation(
      ({ paneId, name, onClose, onSplitHorizontal, onSplitVertical, onAutoSplit, onOpenBrowser }: TerminalToolbarModule.TerminalToolbarProps) => (
        <div data-testid={`terminal-toolbar-${paneId}`} data-name={name}>
          <button aria-label={`Close pane ${paneId}`} onClick={onClose} />
          <button aria-label={`Split horizontal ${paneId}`} onClick={onSplitHorizontal} />
          <button aria-label={`Split vertical ${paneId}`} onClick={onSplitVertical} />
          <button aria-label={`Auto split ${paneId}`} onClick={onAutoSplit} />
          <button aria-label={`Open browser ${paneId}`} onClick={onOpenBrowser} />
        </div>
      ),
    );
    // Reset stores
    useWorkspaceStore.setState({ workspaces: {}, activeWorkspaceId: null, orderedIds: [], paneNames: {}, _nextPaneNumber: 1 });
    useUiStore.setState({ focusedPaneId: null, sidebarOpen: true, notificationPanelOpen: false });
    // Default mocks for commands that may be called
    mockInvoke('pty_write', () => undefined);
    mockInvoke('pty_resize', () => undefined);
    mockInvoke('scrollback_load', () => null);
    mockInvoke('settings_get', () => Promise.resolve(null));
    mockInvoke('workspace_reorder', () => Promise.resolve());
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

  it('clears focusedPaneId when active workspace is deleted', async () => {
    const user = userEvent.setup();
    const ws1 = makeWorkspace('ws-1', 'Workspace 1', 'pane-1');
    mockInvoke('session_restore', () => Promise.resolve([ws1]));
    mockInvoke('workspace_close', () => Promise.resolve());

    render(<AppLayout />);

    await waitFor(() => {
      expect(useUiStore.getState().focusedPaneId).toBe('pane-1');
    });

    await user.click(screen.getByRole('button', { name: /close workspace 1/i }));

    await waitFor(() => {
      expect(useUiStore.getState().focusedPaneId).toBeNull();
    });
  });

  it('clears focusedPaneDimensions when active workspace is deleted', async () => {
    const user = userEvent.setup();
    const ws1 = makeWorkspace('ws-1', 'Workspace 1', 'pane-1');
    mockInvoke('session_restore', () => Promise.resolve([ws1]));
    mockInvoke('workspace_close', () => Promise.resolve());

    // Simulate that the focused pane had dimensions tracked
    useUiStore.setState({ focusedPaneDimensions: { width: 800, height: 400 } });

    render(<AppLayout />);

    await waitFor(() => {
      expect(useUiStore.getState().focusedPaneId).toBe('pane-1');
    });

    await user.click(screen.getByRole('button', { name: /close workspace 1/i }));

    await waitFor(() => {
      expect(useUiStore.getState().focusedPaneDimensions).toBeNull();
    });
  });

  it('sets focusedPaneId to first leaf of next workspace when active workspace is deleted', async () => {
    const user = userEvent.setup();
    const ws1 = makeWorkspace('ws-1', 'Workspace 1', 'pane-1');
    const ws2 = makeWorkspace('ws-2', 'Workspace 2', 'pane-2', 'pty-2');
    mockInvoke('session_restore', () => Promise.resolve([ws1, ws2]));
    mockInvoke('workspace_close', () => Promise.resolve());

    render(<AppLayout />);

    await waitFor(() => {
      expect(useUiStore.getState().focusedPaneId).toBe('pane-1');
    });

    await user.click(screen.getByRole('button', { name: /close workspace 1/i }));

    await waitFor(() => {
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-2');
      expect(useUiStore.getState().focusedPaneId).toBe('pane-2');
    });
  });

  it('hides sidebar when sidebarOpen is false', async () => {
    const ws1 = makeWorkspace('ws-1', 'Workspace 1', 'pane-1');
    mockInvoke('session_restore', () => Promise.resolve([ws1]));

    useUiStore.setState({ sidebarOpen: false });

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByTestId('terminal-pane-pane-1')).toBeInTheDocument();
    });

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

  it('subscribes to workspace-removed event and removes workspace from store', async () => {
    const ws1 = makeWorkspace('ws-1', 'Workspace 1', 'pane-1');
    const ws2 = makeWorkspace('ws-2', 'Workspace 2', 'pane-2', 'pty-2');
    mockInvoke('session_restore', () => Promise.resolve([ws1, ws2]));

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByText('Workspace 1')).toBeInTheDocument();
      expect(screen.getByText('Workspace 2')).toBeInTheDocument();
    });

    act(() => {
      emitMockEvent('workspace-removed', { workspaceId: 'ws-1' });
    });

    await waitFor(() => {
      expect(useWorkspaceStore.getState().workspaces['ws-1']).toBeUndefined();
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-2');
    });
  });

  it('pane close that triggers workspace close removes workspace via event', async () => {
    const user = userEvent.setup();
    const ws1 = makeWorkspace('ws-1', 'Workspace 1', 'pane-1');
    const ws2 = makeWorkspace('ws-2', 'Workspace 2', 'pane-2', 'pty-2');
    mockInvoke('session_restore', () => Promise.resolve([ws1, ws2]));
    // Simulate backend: pane_close succeeds and backend emits workspace-removed
    mockInvoke('pane_close', () => {
      // Backend emits workspace-removed event when last pane closes the workspace
      emitMockEvent('workspace-removed', { workspaceId: 'ws-1' });
      return Promise.resolve();
    });

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByTestId('terminal-pane-pane-1')).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /close pane pane-1/i }));

    await waitFor(() => {
      // Workspace should be removed and active switched to ws-2
      expect(useWorkspaceStore.getState().workspaces['ws-1']).toBeUndefined();
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-2');
    });
  });

  it('shows SurfaceTabBar only when multiple surfaces exist', async () => {
    const ws = makeWorkspaceMultiSurface('ws-1', 'Workspace 1');
    mockInvoke('session_restore', () => Promise.resolve([ws]));

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByRole('tablist')).toBeInTheDocument();
    });

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

  it('sets focusedPaneId to first leaf when restoring split layout', async () => {
    const splitWs: WorkspaceInfo = {
      id: 'ws-1',
      name: 'Split Workspace',
      surfaces: [{
        id: 'ws-1-s1',
        name: 'Surface 1',
        layout: {
          type: 'split',
          direction: 'horizontal',
          children: [
            { type: 'leaf', paneId: 'left-pane', ptyId: 'pty-left' },
            { type: 'leaf', paneId: 'right-pane', ptyId: 'pty-right' },
          ],
          sizes: [0.5, 0.5],
        },
      }],
      activeSurfaceIndex: 0,
      createdAt: Date.now(),
    };
    mockInvoke('session_restore', () => Promise.resolve([splitWs]));

    render(<AppLayout />);

    await waitFor(() => {
      expect(useUiStore.getState().focusedPaneId).toBe('left-pane');
    });
  });

  it('sets focusedPaneId to first leaf in nested split layout', async () => {
    const nestedWs: WorkspaceInfo = {
      id: 'ws-1',
      name: 'Nested Workspace',
      surfaces: [{
        id: 'ws-1-s1',
        name: 'Surface 1',
        layout: {
          type: 'split',
          direction: 'vertical',
          children: [
            {
              type: 'split',
              direction: 'horizontal',
              children: [
                { type: 'leaf', paneId: 'top-left', ptyId: 'pty-tl' },
                { type: 'leaf', paneId: 'top-right', ptyId: 'pty-tr' },
              ],
              sizes: [0.5, 0.5],
            },
            { type: 'leaf', paneId: 'bottom', ptyId: 'pty-bot' },
          ],
          sizes: [0.5, 0.5],
        },
      }],
      activeSurfaceIndex: 0,
      createdAt: Date.now(),
    };
    mockInvoke('session_restore', () => Promise.resolve([nestedWs]));

    render(<AppLayout />);

    await waitFor(() => {
      expect(useUiStore.getState().focusedPaneId).toBe('top-left');
    });
  });

  it('handles workspace rename via double-click', async () => {
    const user = userEvent.setup();
    const ws1 = makeWorkspace('ws-1', 'Workspace 1', 'pane-1');
    const renamedWs = makeWorkspace('ws-1', 'Renamed', 'pane-1');
    mockInvoke('session_restore', () => Promise.resolve([ws1]));
    mockInvoke('workspace_rename', () => Promise.resolve(renamedWs));

    render(<AppLayout />);

    await waitFor(() => {
      expect(screen.getByText('Workspace 1')).toBeInTheDocument();
    });

    // Double-click to enter edit mode
    const nameButton = screen.getByRole('button', { name: 'Workspace 1' });
    await user.dblClick(nameButton);

    // Type new name and press Enter
    const input = screen.getByRole('textbox');
    await user.clear(input);
    await user.type(input, 'Renamed{Enter}');

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('workspace_rename', { workspaceId: 'ws-1', newName: 'Renamed' });
    });
  });

  describe('pane action handlers', () => {
    it('handlePaneClose calls pane_close and removes pane name', async () => {
      const user = userEvent.setup();
      const ws = makeWorkspace('ws-1', 'Workspace 1', 'pane-1');
      mockInvoke('session_restore', () => Promise.resolve([ws]));
      mockInvoke('pane_close', () => Promise.resolve());

      render(<AppLayout />);

      await waitFor(() => {
        expect(screen.getByTestId('terminal-pane-pane-1')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /close pane pane-1/i }));

      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith('pane_close', { paneId: 'pane-1' });
      });
    });

    it('handlePaneClose clears focusedPaneId and focusedPaneDimensions for closed pane', async () => {
      const user = userEvent.setup();
      const ws = makeWorkspace('ws-1', 'Workspace 1', 'pane-1');
      mockInvoke('session_restore', () => Promise.resolve([ws]));
      mockInvoke('pane_close', () => Promise.resolve());

      render(<AppLayout />);

      await waitFor(() => {
        expect(useUiStore.getState().focusedPaneId).toBe('pane-1');
      });

      // Set dimensions to verify they get cleared
      useUiStore.getState().setFocusedPaneDimensions({ width: 800, height: 400 });

      await user.click(screen.getByRole('button', { name: /close pane pane-1/i }));

      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith('pane_close', { paneId: 'pane-1' });
      });

      // Focus and dimensions should be cleared since the closed pane was focused
      expect(useUiStore.getState().focusedPaneDimensions).toBeNull();
    });

    it('handlePaneSplitHorizontal calls pane_split with horizontal', async () => {
      const user = userEvent.setup();
      const ws = makeWorkspace('ws-1', 'Workspace 1', 'pane-1');
      const splitResult = makeWorkspace('ws-1', 'Workspace 1', 'pane-1');
      mockInvoke('session_restore', () => Promise.resolve([ws]));
      mockInvoke('pane_split', () => Promise.resolve(splitResult));

      render(<AppLayout />);

      await waitFor(() => {
        expect(screen.getByTestId('terminal-pane-pane-1')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /split horizontal pane-1/i }));

      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith('pane_split', { paneId: 'pane-1', direction: 'horizontal', shell: undefined });
      });
    });

    it('handlePaneSplitVertical calls pane_split with vertical', async () => {
      const user = userEvent.setup();
      const ws = makeWorkspace('ws-1', 'Workspace 1', 'pane-1');
      const splitResult = makeWorkspace('ws-1', 'Workspace 1', 'pane-1');
      mockInvoke('session_restore', () => Promise.resolve([ws]));
      mockInvoke('pane_split', () => Promise.resolve(splitResult));

      render(<AppLayout />);

      await waitFor(() => {
        expect(screen.getByTestId('terminal-pane-pane-1')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /split vertical pane-1/i }));

      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith('pane_split', { paneId: 'pane-1', direction: 'vertical', shell: undefined });
      });
    });

    it('handlePaneOpenBrowser calls pane_open_browser', async () => {
      const user = userEvent.setup();
      const ws = makeWorkspace('ws-1', 'Workspace 1', 'pane-1');
      const result = makeWorkspace('ws-1', 'Workspace 1', 'pane-1');
      mockInvoke('session_restore', () => Promise.resolve([ws]));
      mockInvoke('pane_open_browser', () => Promise.resolve(result));

      render(<AppLayout />);

      await waitFor(() => {
        expect(screen.getByTestId('terminal-pane-pane-1')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /open browser pane-1/i }));

      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith('pane_open_browser', { paneId: 'pane-1', url: 'about:blank', direction: 'vertical' });
      });
    });

    it('handlePaneAutoSplit uses focused pane dimensions to choose direction', async () => {
      const user = userEvent.setup();
      const ws = makeWorkspace('ws-1', 'Workspace 1', 'pane-1');
      const splitResult = makeWorkspace('ws-1', 'Workspace 1', 'pane-1');
      mockInvoke('session_restore', () => Promise.resolve([ws]));
      mockInvoke('pane_split', () => Promise.resolve(splitResult));

      // Set focused pane dimensions: wider than tall -> should split vertical
      useUiStore.setState({
        focusedPaneId: 'pane-1',
        focusedPaneDimensions: { width: 800, height: 400 },
      });

      render(<AppLayout />);

      await waitFor(() => {
        expect(screen.getByTestId('terminal-pane-pane-1')).toBeInTheDocument();
      });

      await user.click(screen.getByRole('button', { name: /auto split pane-1/i }));

      await waitFor(() => {
        expect(invoke).toHaveBeenCalledWith('pane_split', { paneId: 'pane-1', direction: 'vertical', shell: undefined });
      });
    });
  });
});
