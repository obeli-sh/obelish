import { useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { useNotificationStore } from '../stores/notificationStore';
import { useWorkspaceStore } from '../stores/workspaceStore';
import type { Notification, LayoutNode } from '../lib/workspace-types';

interface NotificationRawPayload {
  ptyId: string;
  oscType: number;
  title: string;
  body: string | null;
}

function findPaneAndWorkspace(
  workspaces: Record<string, { id: string; surfaces: { layout: LayoutNode }[] }>,
  ptyId: string,
): { paneId: string; workspaceId: string } | null {
  for (const ws of Object.values(workspaces)) {
    for (const surface of ws.surfaces) {
      const paneId = findPaneInLayout(surface.layout, ptyId);
      if (paneId) return { paneId, workspaceId: ws.id };
    }
  }
  return null;
}

function findPaneInLayout(layout: LayoutNode, ptyId: string): string | null {
  if (layout.type === 'leaf') {
    return layout.ptyId === ptyId ? layout.paneId : null;
  }
  for (const child of layout.children) {
    const found = findPaneInLayout(child, ptyId);
    if (found) return found;
  }
  return null;
}

export function useNotificationListener(): void {
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      unlisten = await listen<NotificationRawPayload>('notification-raw', (event) => {
        if (cancelled) return;

        const payload = event.payload;
        const workspaces = useWorkspaceStore.getState().workspaces;
        const mapping = findPaneAndWorkspace(workspaces, payload.ptyId);

        const notification: Notification = {
          id: crypto.randomUUID(),
          paneId: mapping?.paneId ?? payload.ptyId,
          workspaceId: mapping?.workspaceId ?? '',
          oscType: payload.oscType,
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
