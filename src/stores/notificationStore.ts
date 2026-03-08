import { create } from 'zustand';
import type { Notification } from '../lib/workspace-types';

interface NotificationStoreState {
  notifications: Notification[];
  addNotification: (notification: Notification) => void;
  getByPane: (paneId: string) => Notification[];
  markRead: (id: string) => void;
  markAllReadForPane: (paneId: string) => void;
  clearAll: () => void;
  unreadCount: () => number;
  unreadCountByPane: (paneId: string) => number;
}

export const useNotificationStore = create<NotificationStoreState>((set, get) => ({
  notifications: [],

  addNotification: (notification) => {
    set((state) => {
      if (state.notifications.some((n) => n.id === notification.id)) {
        return state;
      }
      const updated = [notification, ...state.notifications];
      updated.sort((a, b) => b.timestamp - a.timestamp);
      return { notifications: updated };
    });
  },

  getByPane: (paneId) => {
    return get().notifications.filter((n) => n.paneId === paneId);
  },

  markRead: (id) => {
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, read: true } : n,
      ),
    }));
  },

  markAllReadForPane: (paneId) => {
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.paneId === paneId ? { ...n, read: true } : n,
      ),
    }));
  },

  clearAll: () => {
    set({ notifications: [] });
  },

  unreadCount: () => {
    return get().notifications.filter((n) => !n.read).length;
  },

  unreadCountByPane: (paneId) => {
    return get().notifications.filter((n) => n.paneId === paneId && !n.read).length;
  },
}));
