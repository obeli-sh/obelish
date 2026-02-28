import { describe, it, expect, beforeEach } from 'vitest';
import { invoke, mockInvoke, clearInvokeMocks } from '@tauri-apps/api/core';
import { tauriBridge } from '../tauri-bridge';

describe('tauriBridge', () => {
  beforeEach(() => {
    clearInvokeMocks();
  });

  describe('pty.spawn', () => {
    it('calls invoke with pty_spawn and correct args', async () => {
      mockInvoke('pty_spawn', () => ({ ptyId: 'test-id' }));

      const result = await tauriBridge.pty.spawn({ shell: '/bin/bash', cwd: '/home' });

      expect(invoke).toHaveBeenCalledWith('pty_spawn', { shell: '/bin/bash', cwd: '/home' });
      expect(result).toEqual({ ptyId: 'test-id' });
    });

    it('propagates errors', async () => {
      mockInvoke('pty_spawn', () => Promise.reject(new Error('spawn failed')));

      await expect(tauriBridge.pty.spawn({})).rejects.toThrow('spawn failed');
    });
  });

  describe('pty.write', () => {
    it('sends ptyId and data', async () => {
      mockInvoke('pty_write', () => undefined);

      await tauriBridge.pty.write('pty-1', 'aGVsbG8=');

      expect(invoke).toHaveBeenCalledWith('pty_write', { ptyId: 'pty-1', data: 'aGVsbG8=' });
    });
  });

  describe('pty.resize', () => {
    it('sends ptyId, cols, rows', async () => {
      mockInvoke('pty_resize', () => undefined);

      await tauriBridge.pty.resize('pty-1', 120, 40);

      expect(invoke).toHaveBeenCalledWith('pty_resize', { ptyId: 'pty-1', cols: 120, rows: 40 });
    });
  });

  describe('pty.kill', () => {
    it('sends ptyId', async () => {
      mockInvoke('pty_kill', () => undefined);

      await tauriBridge.pty.kill('pty-1');

      expect(invoke).toHaveBeenCalledWith('pty_kill', { ptyId: 'pty-1' });
    });
  });
});
