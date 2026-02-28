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

  describe('workspace.create', () => {
    it('calls invoke with workspace_create and args', async () => {
      const mockWorkspace = {
        id: 'ws-1',
        name: 'My Workspace',
        surfaces: [],
        activeSurfaceIndex: 0,
        createdAt: 1000,
      };
      mockInvoke('workspace_create', () => mockWorkspace);

      const result = await tauriBridge.workspace.create({ name: 'My Workspace', cwd: '/home' });

      expect(invoke).toHaveBeenCalledWith('workspace_create', { name: 'My Workspace', cwd: '/home' });
      expect(result).toEqual(mockWorkspace);
    });

    it('calls invoke with empty object when no args', async () => {
      const mockWorkspace = {
        id: 'ws-2',
        name: 'default',
        surfaces: [],
        activeSurfaceIndex: 0,
        createdAt: 2000,
      };
      mockInvoke('workspace_create', () => mockWorkspace);

      const result = await tauriBridge.workspace.create();

      expect(invoke).toHaveBeenCalledWith('workspace_create', {});
      expect(result).toEqual(mockWorkspace);
    });

    it('propagates errors', async () => {
      mockInvoke('workspace_create', () => Promise.reject(new Error('create failed')));

      await expect(tauriBridge.workspace.create()).rejects.toThrow('create failed');
    });
  });

  describe('workspace.close', () => {
    it('calls invoke with workspace_close and workspaceId', async () => {
      mockInvoke('workspace_close', () => undefined);

      await tauriBridge.workspace.close('ws-1');

      expect(invoke).toHaveBeenCalledWith('workspace_close', { workspaceId: 'ws-1' });
    });
  });

  describe('workspace.list', () => {
    it('calls invoke with workspace_list', async () => {
      const mockList = [
        { id: 'ws-1', name: 'Workspace 1', surfaces: [], activeSurfaceIndex: 0, createdAt: 1000 },
      ];
      mockInvoke('workspace_list', () => mockList);

      const result = await tauriBridge.workspace.list();

      expect(invoke).toHaveBeenCalledWith('workspace_list');
      expect(result).toEqual(mockList);
    });
  });

  describe('pane.split', () => {
    it('calls invoke with pane_split and args', async () => {
      const mockResult = { paneId: 'pane-2', ptyId: 'pty-2' };
      mockInvoke('pane_split', () => mockResult);

      const result = await tauriBridge.pane.split('pane-1', 'horizontal', '/bin/zsh');

      expect(invoke).toHaveBeenCalledWith('pane_split', {
        paneId: 'pane-1',
        direction: 'horizontal',
        shell: '/bin/zsh',
      });
      expect(result).toEqual(mockResult);
    });

    it('calls invoke without shell when not provided', async () => {
      const mockResult = { paneId: 'pane-2', ptyId: 'pty-2' };
      mockInvoke('pane_split', () => mockResult);

      const result = await tauriBridge.pane.split('pane-1', 'vertical');

      expect(invoke).toHaveBeenCalledWith('pane_split', {
        paneId: 'pane-1',
        direction: 'vertical',
        shell: undefined,
      });
      expect(result).toEqual(mockResult);
    });
  });

  describe('pane.close', () => {
    it('calls invoke with pane_close and paneId', async () => {
      mockInvoke('pane_close', () => undefined);

      await tauriBridge.pane.close('pane-1');

      expect(invoke).toHaveBeenCalledWith('pane_close', { paneId: 'pane-1' });
    });
  });

  describe('session.save', () => {
    it('calls invoke with session_save', async () => {
      mockInvoke('session_save', () => undefined);

      await tauriBridge.session.save();

      expect(invoke).toHaveBeenCalledWith('session_save');
    });

    it('propagates errors', async () => {
      mockInvoke('session_save', () => Promise.reject(new Error('save failed')));

      await expect(tauriBridge.session.save()).rejects.toThrow('save failed');
    });
  });

  describe('session.restore', () => {
    it('calls invoke with session_restore and returns workspaces', async () => {
      const mockList = [
        { id: 'ws-1', name: 'Workspace 1', surfaces: [], activeSurfaceIndex: 0, createdAt: 1000 },
      ];
      mockInvoke('session_restore', () => mockList);

      const result = await tauriBridge.session.restore();

      expect(invoke).toHaveBeenCalledWith('session_restore');
      expect(result).toEqual(mockList);
    });

    it('propagates errors', async () => {
      mockInvoke('session_restore', () => Promise.reject(new Error('restore failed')));

      await expect(tauriBridge.session.restore()).rejects.toThrow('restore failed');
    });
  });
});
