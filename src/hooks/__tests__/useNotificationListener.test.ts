import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { emitMockEvent, clearEventMocks } from '@tauri-apps/api/event';
import { useNotificationStore } from '../../stores/notificationStore';

vi.mock('crypto', () => ({
  randomUUID: () => 'mock-uuid',
}));

import { useNotificationListener } from '../useNotificationListener';

describe('useNotificationListener', () => {
  beforeEach(() => {
    useNotificationStore.setState({ notifications: [] });
    clearEventMocks();
  });

  it('listens for notification-raw events and adds to store', async () => {
    const { unmount } = renderHook(() => useNotificationListener());

    // Wait for the listen promise to resolve
    await vi.waitFor(() => {
      expect(useNotificationStore.getState().notifications).toHaveLength(0);
    });

    act(() => {
      emitMockEvent('notification-raw', {
        pane_id: 'pane-1',
        workspace_id: 'ws-1',
        osc_type: 9,
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
        pane_id: 'pane-1',
        workspace_id: 'ws-1',
        osc_type: 9,
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
        pane_id: 'pane-1',
        workspace_id: 'ws-1',
        osc_type: 9,
        title: 'Should not appear',
        body: null,
      });
    });

    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });
});
