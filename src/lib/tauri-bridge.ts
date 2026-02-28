import { invoke } from '@tauri-apps/api/core';

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
} as const;
