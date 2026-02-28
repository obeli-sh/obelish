import { invoke } from '@tauri-apps/api/core';
import type { WorkspaceInfo, SplitDirection, Notification } from './workspace-types';

export interface PtySpawnArgs {
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
}

export interface PtySpawnResult {
  ptyId: string;
}

export const tauriBridge = {
  pty: {
    spawn: (args: PtySpawnArgs) => invoke<PtySpawnResult>('pty_spawn', args as Record<string, unknown>),
    write: (ptyId: string, data: string) => invoke<void>('pty_write', { ptyId, data }),
    resize: (ptyId: string, cols: number, rows: number) => invoke<void>('pty_resize', { ptyId, cols, rows }),
    kill: (ptyId: string) => invoke<void>('pty_kill', { ptyId }),
  },
  workspace: {
    create: (args?: { name?: string; cwd?: string }) =>
      invoke<WorkspaceInfo>('workspace_create', args ?? {}),
    close: (workspaceId: string) =>
      invoke<void>('workspace_close', { workspaceId }),
    list: () => invoke<WorkspaceInfo[]>('workspace_list'),
  },
  pane: {
    split: (paneId: string, direction: SplitDirection, shell?: string) =>
      invoke<WorkspaceInfo>('pane_split', { paneId, direction, shell }),
    close: (paneId: string) => invoke<void>('pane_close', { paneId }),
    openBrowser: (paneId: string, url: string, direction: SplitDirection) =>
      invoke<WorkspaceInfo>('pane_open_browser', { paneId, url, direction }),
  },
  session: {
    save: () => invoke<void>('session_save'),
    restore: () => invoke<WorkspaceInfo[]>('session_restore'),
  },
  scrollback: {
    save: (paneId: string, data: string) => invoke<void>('scrollback_save', { paneId, data }),
    load: (paneId: string) => invoke<string | null>('scrollback_load', { paneId }),
  },
  notification: {
    list: () => invoke<Notification[]>('notification_list'),
    markRead: (id: string) => invoke<void>('notification_mark_read', { id }),
    clear: () => invoke<void>('notification_clear'),
  },
  settings: {
    get: () => invoke<Record<string, unknown>>('settings_get'),
    update: (settings: Record<string, unknown>) => invoke<void>('settings_update', { settings }),
    reset: () => invoke<void>('settings_reset'),
  },
} as const;
