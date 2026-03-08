import { invoke } from '@tauri-apps/api/core';
import { isTauri, mockInvoke } from './browser-mock';
import type { WorkspaceInfo, SplitDirection, PaneDropPosition, Notification, ProjectInfo, WorktreeInfo } from './workspace-types';

function safeInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  // In non-Tauri browsers (manual validation, docs preview), skip runtime invoke.
  if (typeof window !== 'undefined' && !isTauri()) {
    return mockInvoke(cmd, args) as Promise<T>;
  }
  try {
    return args !== undefined ? invoke<T>(cmd, args) : invoke<T>(cmd);
  } catch {
    return mockInvoke(cmd, args) as Promise<T>;
  }
}

export interface PtySpawnArgs {
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
}

export interface ShellInfo {
  path: string;
  name: string;
}

export interface PtySpawnResult {
  ptyId: string;
}

export const tauriBridge = {
  pty: {
    spawn: (args: PtySpawnArgs) => safeInvoke<PtySpawnResult>('pty_spawn', args as Record<string, unknown>),
    write: (ptyId: string, data: string) => safeInvoke<void>('pty_write', { ptyId, data }),
    resize: (ptyId: string, cols: number, rows: number) => safeInvoke<void>('pty_resize', { ptyId, cols, rows }),
    kill: (ptyId: string) => safeInvoke<void>('pty_kill', { ptyId }),
  },
  workspace: {
    create: (args: { projectId: string; worktreePath: string; name?: string }) =>
      safeInvoke<WorkspaceInfo>('workspace_create', args),
    close: (workspaceId: string) =>
      safeInvoke<void>('workspace_close', { workspaceId }),
    rename: (workspaceId: string, newName: string) =>
      safeInvoke<WorkspaceInfo>('workspace_rename', { workspaceId, newName }),
    list: () => safeInvoke<WorkspaceInfo[]>('workspace_list'),
    reorder: (workspaceIds: string[]) => safeInvoke<void>('workspace_reorder', { workspaceIds }),
  },
  pane: {
    split: (paneId: string, direction: SplitDirection, shell?: string) =>
      safeInvoke<WorkspaceInfo>('pane_split', { paneId, direction, shell }),
    close: (paneId: string) => safeInvoke<void>('pane_close', { paneId }),
    openBrowser: (paneId: string, url: string, direction: SplitDirection) =>
      safeInvoke<WorkspaceInfo>('pane_open_browser', { paneId, url, direction }),
    swap: (paneId: string, targetPaneId: string) =>
      safeInvoke<WorkspaceInfo>('pane_swap', { paneId, targetPaneId }),
    move: (paneId: string, targetPaneId: string, position: PaneDropPosition) =>
      safeInvoke<WorkspaceInfo>('pane_move', { paneId, targetPaneId, position }),
  },
  session: {
    save: () => safeInvoke<void>('session_save'),
    restore: () => safeInvoke<WorkspaceInfo[]>('session_restore'),
  },
  scrollback: {
    save: (paneId: string, data: string) => safeInvoke<void>('scrollback_save', { paneId, data }),
    load: (paneId: string) => safeInvoke<string | null>('scrollback_load', { paneId }),
  },
  notification: {
    list: () => safeInvoke<Notification[]>('notification_list'),
    markRead: (id: string) => safeInvoke<void>('notification_mark_read', { id }),
    clear: () => safeInvoke<void>('notification_clear'),
  },
  settings: {
    get: () => safeInvoke<Record<string, unknown>>('settings_get'),
    update: (key: string, value: unknown) => safeInvoke<void>('settings_update', { key, value }),
    reset: () => safeInvoke<void>('settings_reset'),
  },
  shell: {
    list: () => safeInvoke<ShellInfo[]>('shell_list'),
  },
  project: {
    list: () => safeInvoke<ProjectInfo[]>('project_list'),
    add: (rootPath: string) => safeInvoke<ProjectInfo>('project_add', { rootPath }),
    remove: (projectId: string) => safeInvoke<void>('project_remove', { projectId }),
  },
  worktree: {
    list: (projectId: string) => safeInvoke<WorktreeInfo[]>('worktree_list', { projectId }),
    create: (projectId: string, branchName: string) =>
      safeInvoke<WorktreeInfo>('worktree_create', { projectId, branchName }),
  },
  fs: {
    listDirectories: (partialPath: string, wsl?: boolean) =>
      safeInvoke<string[]>('list_directories', { partialPath, wsl: wsl ?? false }),
  },
} as const;
