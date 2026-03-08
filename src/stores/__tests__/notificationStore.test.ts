// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { useNotificationStore } from '../notificationStore';
import type { Notification } from '../../lib/workspace-types';

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'n-1',
    paneId: 'pane-1',
    workspaceId: 'ws-1',
    oscType: 9,
    title: 'Test notification',
    body: null,
    timestamp: 1000,
    read: false,
    ...overrides,
  };
}

describe('notificationStore', () => {
  beforeEach(() => {
    useNotificationStore.setState({ notifications: [] });
  });

  it('starts_empty', () => {
    const state = useNotificationStore.getState();
    expect(state.notifications).toEqual([]);
    expect(state.unreadCount()).toBe(0);
  });

  it('addNotification adds to list', () => {
    const n = makeNotification();
    useNotificationStore.getState().addNotification(n);
    expect(useNotificationStore.getState().notifications).toHaveLength(1);
    expect(useNotificationStore.getState().notifications[0]).toEqual(n);
  });

  it('getByPane filters correctly', () => {
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-1', paneId: 'pane-1' }));
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-2', paneId: 'pane-2' }));
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-3', paneId: 'pane-1' }));

    const pane1 = useNotificationStore.getState().getByPane('pane-1');
    expect(pane1).toHaveLength(2);
    expect(pane1.every((n) => n.paneId === 'pane-1')).toBe(true);

    const pane2 = useNotificationStore.getState().getByPane('pane-2');
    expect(pane2).toHaveLength(1);
    expect(pane2[0].paneId).toBe('pane-2');
  });

  it('markRead updates notification', () => {
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-1' }));
    expect(useNotificationStore.getState().notifications[0].read).toBe(false);

    useNotificationStore.getState().markRead('n-1');
    expect(useNotificationStore.getState().notifications[0].read).toBe(true);
  });

  it('markAllReadForPane marks only that pane notifications', () => {
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-1', paneId: 'pane-1' }));
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-2', paneId: 'pane-2' }));
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-3', paneId: 'pane-1' }));

    useNotificationStore.getState().markAllReadForPane('pane-1');

    const state = useNotificationStore.getState();
    expect(state.notifications.find((n) => n.id === 'n-1')!.read).toBe(true);
    expect(state.notifications.find((n) => n.id === 'n-2')!.read).toBe(false);
    expect(state.notifications.find((n) => n.id === 'n-3')!.read).toBe(true);
  });

  it('clearAll empties list', () => {
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-1' }));
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-2' }));
    expect(useNotificationStore.getState().notifications).toHaveLength(2);

    useNotificationStore.getState().clearAll();
    expect(useNotificationStore.getState().notifications).toHaveLength(0);
  });

  it('unreadCount returns correct count', () => {
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-1' }));
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-2' }));
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-3', read: true }));

    expect(useNotificationStore.getState().unreadCount()).toBe(2);
  });

  it('duplicate_id_ignored', () => {
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-1', title: 'First' }));
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-1', title: 'Duplicate' }));

    expect(useNotificationStore.getState().notifications).toHaveLength(1);
    expect(useNotificationStore.getState().notifications[0].title).toBe('First');
  });

  it('orders_newest_first', () => {
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-1', timestamp: 1000 }));
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-2', timestamp: 3000 }));
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-3', timestamp: 2000 }));

    const notifications = useNotificationStore.getState().notifications;
    expect(notifications[0].id).toBe('n-2');
    expect(notifications[1].id).toBe('n-3');
    expect(notifications[2].id).toBe('n-1');
  });

  it('unreadCountByPane returns count for specific pane', () => {
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-1', paneId: 'pane-1' }));
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-2', paneId: 'pane-2' }));
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-3', paneId: 'pane-1', read: true }));

    expect(useNotificationStore.getState().unreadCountByPane('pane-1')).toBe(1);
    expect(useNotificationStore.getState().unreadCountByPane('pane-2')).toBe(1);
    expect(useNotificationStore.getState().unreadCountByPane('pane-3')).toBe(0);
  });

  it('sort order is descending by timestamp (newest first)', () => {
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-old', timestamp: 100 }));
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-new', timestamp: 200 }));

    const notifications = useNotificationStore.getState().notifications;
    expect(notifications[0].timestamp).toBeGreaterThan(notifications[1].timestamp);
    expect(notifications[0].id).toBe('n-new');
    expect(notifications[1].id).toBe('n-old');
  });

  it('addNotification maintains sort when adding older notification', () => {
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-2', timestamp: 2000 }));
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-1', timestamp: 500 }));

    const notifications = useNotificationStore.getState().notifications;
    expect(notifications[0].id).toBe('n-2');
    expect(notifications[1].id).toBe('n-1');
  });

  it('addNotification with duplicate id returns same state reference', () => {
    const n = makeNotification({ id: 'n-1' });
    useNotificationStore.getState().addNotification(n);
    const stateBefore = useNotificationStore.getState().notifications;
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-1', title: 'Changed' }));
    const stateAfter = useNotificationStore.getState().notifications;
    expect(stateAfter).toBe(stateBefore);
  });

  it('markRead does not affect other notifications', () => {
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-1' }));
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-2' }));
    useNotificationStore.getState().markRead('n-1');

    expect(useNotificationStore.getState().notifications.find((n) => n.id === 'n-2')!.read).toBe(false);
  });

  it('markRead on already-read notification is idempotent', () => {
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-1', read: true }));
    useNotificationStore.getState().markRead('n-1');

    expect(useNotificationStore.getState().notifications[0].read).toBe(true);
  });

  it('markAllReadForPane does not affect other panes', () => {
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-1', paneId: 'pane-1' }));
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-2', paneId: 'pane-2' }));
    useNotificationStore.getState().markAllReadForPane('pane-1');

    expect(useNotificationStore.getState().notifications.find((n) => n.id === 'n-2')!.read).toBe(false);
  });

  it('unreadCount returns 0 after marking all read', () => {
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-1' }));
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-2' }));
    useNotificationStore.getState().markRead('n-1');
    useNotificationStore.getState().markRead('n-2');
    expect(useNotificationStore.getState().unreadCount()).toBe(0);
  });

  it('unreadCountByPane counts only unread for correct pane', () => {
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-1', paneId: 'pane-1', read: false }));
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-2', paneId: 'pane-1', read: false }));
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-3', paneId: 'pane-1', read: true }));
    expect(useNotificationStore.getState().unreadCountByPane('pane-1')).toBe(2);
  });

  it('getByPane returns empty array for unknown pane', () => {
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-1', paneId: 'pane-1' }));
    expect(useNotificationStore.getState().getByPane('unknown')).toEqual([]);
  });

  it('clearAll resets unread counts to zero', () => {
    useNotificationStore.getState().addNotification(makeNotification({ id: 'n-1' }));
    useNotificationStore.getState().clearAll();
    expect(useNotificationStore.getState().unreadCount()).toBe(0);
    expect(useNotificationStore.getState().unreadCountByPane('pane-1')).toBe(0);
  });
});
