import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { emitMockEvent, clearEventMocks } from '@tauri-apps/api/event';
import { useNotificationStore } from '../../stores/notificationStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';

vi.mock('crypto', () => ({
  randomUUID: () => 'mock-uuid',
}));

import { useNotificationListener } from '../useNotificationListener';

describe('useNotificationListener', () => {
  beforeEach(() => {
    useNotificationStore.setState({ notifications: [] });
    useWorkspaceStore.setState({
      workspaces: {
        'ws-1': {
          id: 'ws-1',
          name: 'Workspace 1',
          projectId: '',
          worktreePath: '',
          branchName: null,
          isRootWorktree: false,
          surfaces: [{
            id: 's-1',
            name: 'Surface 1',
            layout: { type: 'leaf', paneId: 'pane-1', ptyId: 'pty-1' },
          }],
          activeSurfaceIndex: 0,
          createdAt: Date.now(),
        },
      },
      activeWorkspaceId: 'ws-1',
    });
    clearEventMocks();
  });

  it('listens for notification-raw events and resolves pane/workspace from ptyId', async () => {
    const { unmount } = renderHook(() => useNotificationListener());

    await vi.waitFor(() => {
      expect(useNotificationStore.getState().notifications).toHaveLength(0);
    });

    act(() => {
      emitMockEvent('notification-raw', {
        ptyId: 'pty-1',
        oscType: 9,
        title: 'Build complete',
        body: 'Success',
      });
    });

    const notifications = useNotificationStore.getState().notifications;
    expect(notifications).toHaveLength(1);
    expect(notifications[0].title).toBe('Build complete');
    expect(notifications[0].body).toBe('Success');
    expect(notifications[0].paneId).toBe('pane-1');
    expect(notifications[0].workspaceId).toBe('ws-1');
    expect(notifications[0].oscType).toBe(9);
    expect(notifications[0].read).toBe(false);
    expect(notifications[0].id).toBeDefined();
    expect(notifications[0].timestamp).toBeDefined();

    unmount();
  });

  it('handles null body', async () => {
    const { unmount } = renderHook(() => useNotificationListener());

    await vi.waitFor(() => {
      expect(useNotificationStore.getState().notifications).toHaveLength(0);
    });

    act(() => {
      emitMockEvent('notification-raw', {
        ptyId: 'pty-1',
        oscType: 9,
        title: 'Alert',
        body: null,
      });
    });

    const notifications = useNotificationStore.getState().notifications;
    expect(notifications).toHaveLength(1);
    expect(notifications[0].body).toBeNull();

    unmount();
  });

  it('cleans up listener on unmount', async () => {
    const { unmount } = renderHook(() => useNotificationListener());

    await vi.waitFor(() => {
      expect(useNotificationStore.getState().notifications).toHaveLength(0);
    });

    unmount();

    act(() => {
      emitMockEvent('notification-raw', {
        ptyId: 'pty-1',
        oscType: 9,
        title: 'Should not appear',
        body: null,
      });
    });

    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });

  it('falls back to ptyId when pane mapping not found', async () => {
    useWorkspaceStore.setState({ workspaces: {} });

    const { unmount } = renderHook(() => useNotificationListener());

    await vi.waitFor(() => {
      expect(useNotificationStore.getState().notifications).toHaveLength(0);
    });

    act(() => {
      emitMockEvent('notification-raw', {
        ptyId: 'unknown-pty',
        oscType: 9,
        title: 'Orphan',
        body: null,
      });
    });

    const notifications = useNotificationStore.getState().notifications;
    expect(notifications).toHaveLength(1);
    expect(notifications[0].paneId).toBe('unknown-pty');
    expect(notifications[0].workspaceId).toBe('');

    unmount();
  });

  it('resolves pane from a split layout by traversing children', async () => {
    // Set up a workspace with a split layout containing nested children
    // This exercises the findPaneInLayout split-node branch (lines 31-36)
    useWorkspaceStore.setState({
      workspaces: {
        'ws-1': {
          id: 'ws-1',
          name: 'Workspace 1',
          projectId: '',
          worktreePath: '',
          branchName: null,
          isRootWorktree: false,
          surfaces: [{
            id: 's-1',
            name: 'Surface 1',
            layout: {
              type: 'split',
              direction: 'horizontal',
              children: [
                { type: 'leaf', paneId: 'pane-left', ptyId: 'pty-left' },
                { type: 'leaf', paneId: 'pane-right', ptyId: 'pty-right' },
              ],
              sizes: [0.5, 0.5],
            },
          }],
          activeSurfaceIndex: 0,
          createdAt: Date.now(),
        },
      },
      activeWorkspaceId: 'ws-1',
    });

    const { unmount } = renderHook(() => useNotificationListener());

    await vi.waitFor(() => {
      expect(useNotificationStore.getState().notifications).toHaveLength(0);
    });

    act(() => {
      emitMockEvent('notification-raw', {
        ptyId: 'pty-right',
        oscType: 9,
        title: 'Split pane notification',
        body: 'from right pane',
      });
    });

    const notifications = useNotificationStore.getState().notifications;
    expect(notifications).toHaveLength(1);
    expect(notifications[0].paneId).toBe('pane-right');
    expect(notifications[0].workspaceId).toBe('ws-1');
    expect(notifications[0].title).toBe('Split pane notification');

    unmount();
  });

  it('ignores events arriving after cancellation during async setup', async () => {
    // This exercises the `if (cancelled) return` guard (line 23/45)
    // by unmounting immediately before the listener has a chance to process events
    const { unmount } = renderHook(() => useNotificationListener());

    // Unmount immediately to set cancelled = true
    unmount();

    // Even though the listener was registered, events after cancel should be ignored
    act(() => {
      emitMockEvent('notification-raw', {
        ptyId: 'pty-1',
        oscType: 9,
        title: 'Should be ignored',
        body: null,
      });
    });

    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });
});
