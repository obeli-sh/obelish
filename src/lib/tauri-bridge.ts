import { invoke } from '@tauri-apps/api/core';
import type { WorkspaceInfo, SplitDirection } from './workspace-types';

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
  },
} as const;
