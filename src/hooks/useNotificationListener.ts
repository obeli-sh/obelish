import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useNotificationStore } from '../stores/notificationStore';
import type { Notification } from '../lib/workspace-types';

interface NotificationRawPayload {
  pane_id: string;
  workspace_id: string;
  osc_type: number;
  title: string;
  body: string | null;
}

export function useNotificationListener(): void {
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      unlisten = await listen<NotificationRawPayload>('notification-raw', (event) => {
        if (cancelled) return;

        const payload = event.payload;
        const notification: Notification = {
          id: crypto.randomUUID(),
          paneId: payload.pane_id,
          workspaceId: payload.workspace_id,
          oscType: payload.osc_type,
          title: payload.title,
          body: payload.body,
          timestamp: Date.now(),
          read: false,
        };

        useNotificationStore.getState().addNotification(notification);
      });
      if (cancelled) unlisten?.();
    };

    setup();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, []);
}
