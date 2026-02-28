import { invoke } from '@tauri-apps/api/core';

export interface PtySpawnArgs {
  shell?: string;
  cwd?: string;
  env?: Record<string, string>;
  [key: string]: unknown;
}

export interface PtySpawnResult {
  pty_id: string;
}

export const tauriBridge = {
  pty: {
    spawn: (args: PtySpawnArgs) => invoke<PtySpawnResult>('pty_spawn', args),
    write: (ptyId: string, data: string) => invoke<void>('pty_write', { pty_id: ptyId, data }),
    resize: (ptyId: string, cols: number, rows: number) => invoke<void>('pty_resize', { pty_id: ptyId, cols, rows }),
    kill: (ptyId: string) => invoke<void>('pty_kill', { pty_id: ptyId }),
  },
} as const;
