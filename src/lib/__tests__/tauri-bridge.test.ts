// @vitest-environment node
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
        projectId: 'proj-1',
        worktreePath: '/home',
        branchName: null,
        isRootWorktree: false,
        surfaces: [],
        activeSurfaceIndex: 0,
        createdAt: 1000,
      };
      mockInvoke('workspace_create', () => mockWorkspace);

      const result = await tauriBridge.workspace.create({ projectId: 'proj-1', worktreePath: '/home', name: 'My Workspace' });

      expect(invoke).toHaveBeenCalledWith('workspace_create', { projectId: 'proj-1', worktreePath: '/home', name: 'My Workspace' });
      expect(result).toEqual(mockWorkspace);
    });

    it('calls invoke with required args only', async () => {
      const mockWorkspace = {
        id: 'ws-2',
        name: 'default',
        projectId: 'proj-1',
        worktreePath: '/home',
        branchName: null,
        isRootWorktree: false,
        surfaces: [],
        activeSurfaceIndex: 0,
        createdAt: 2000,
      };
      mockInvoke('workspace_create', () => mockWorkspace);

      const result = await tauriBridge.workspace.create({ projectId: 'proj-1', worktreePath: '/home' });

      expect(invoke).toHaveBeenCalledWith('workspace_create', { projectId: 'proj-1', worktreePath: '/home' });
      expect(result).toEqual(mockWorkspace);
    });

    it('propagates errors', async () => {
      mockInvoke('workspace_create', () => Promise.reject(new Error('create failed')));

      await expect(tauriBridge.workspace.create({ projectId: 'proj-1', worktreePath: '/tmp' })).rejects.toThrow('create failed');
    });
  });

  describe('workspace.close', () => {
    it('calls invoke with workspace_close and workspaceId', async () => {
      mockInvoke('workspace_close', () => undefined);

      await tauriBridge.workspace.close('ws-1');

      expect(invoke).toHaveBeenCalledWith('workspace_close', { workspaceId: 'ws-1' });
    });
  });

  describe('workspace.rename', () => {
    it('calls invoke with workspace_rename and args', async () => {
      const mockWorkspace = {
        id: 'ws-1',
        name: 'New Name',
        projectId: '',
        worktreePath: '',
        branchName: null,
        isRootWorktree: false,
        surfaces: [],
        activeSurfaceIndex: 0,
        createdAt: 1000,
      };
      mockInvoke('workspace_rename', () => mockWorkspace);

      const result = await tauriBridge.workspace.rename('ws-1', 'New Name');

      expect(invoke).toHaveBeenCalledWith('workspace_rename', { workspaceId: 'ws-1', newName: 'New Name' });
      expect(result).toEqual(mockWorkspace);
    });

    it('propagates errors', async () => {
      mockInvoke('workspace_rename', () => Promise.reject(new Error('rename failed')));

      await expect(tauriBridge.workspace.rename('ws-1', 'New Name')).rejects.toThrow('rename failed');
    });
  });

  describe('workspace.list', () => {
    it('calls invoke with workspace_list', async () => {
      const mockList = [
        { id: 'ws-1', name: 'Workspace 1', projectId: '', worktreePath: '', branchName: null, isRootWorktree: false, surfaces: [], activeSurfaceIndex: 0, createdAt: 1000 },
      ];
      mockInvoke('workspace_list', () => mockList);

      const result = await tauriBridge.workspace.list();

      expect(invoke).toHaveBeenCalledWith('workspace_list');
      expect(result).toEqual(mockList);
    });
  });

  describe('workspace.reorder', () => {
    it('calls invoke with workspace_reorder and workspaceIds', async () => {
      mockInvoke('workspace_reorder', () => undefined);

      await tauriBridge.workspace.reorder(['ws-2', 'ws-1', 'ws-3']);

      expect(invoke).toHaveBeenCalledWith('workspace_reorder', { workspaceIds: ['ws-2', 'ws-1', 'ws-3'] });
    });

    it('propagates errors', async () => {
      mockInvoke('workspace_reorder', () => Promise.reject(new Error('reorder failed')));

      await expect(tauriBridge.workspace.reorder(['ws-1'])).rejects.toThrow('reorder failed');
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

  describe('pane.openBrowser', () => {
    it('calls invoke with pane_open_browser and args', async () => {
      const mockResult = {
        id: 'ws-1',
        name: 'Workspace',
        projectId: '',
        worktreePath: '',
        branchName: null,
        isRootWorktree: false,
        surfaces: [],
        activeSurfaceIndex: 0,
        createdAt: 1000,
      };
      mockInvoke('pane_open_browser', () => mockResult);

      const result = await tauriBridge.pane.openBrowser('pane-1', 'https://example.com', 'horizontal');

      expect(invoke).toHaveBeenCalledWith('pane_open_browser', {
        paneId: 'pane-1',
        url: 'https://example.com',
        direction: 'horizontal',
      });
      expect(result).toEqual(mockResult);
    });

    it('propagates errors', async () => {
      mockInvoke('pane_open_browser', () => Promise.reject(new Error('open failed')));

      await expect(tauriBridge.pane.openBrowser('pane-1', 'https://example.com', 'horizontal')).rejects.toThrow('open failed');
    });
  });

  describe('pane.swap', () => {
    it('calls invoke with pane_swap and args', async () => {
      const mockResult = {
        id: 'ws-1',
        name: 'Workspace',
        projectId: '',
        worktreePath: '',
        branchName: null,
        isRootWorktree: false,
        surfaces: [],
        activeSurfaceIndex: 0,
        createdAt: 1000,
      };
      mockInvoke('pane_swap', () => mockResult);

      const result = await tauriBridge.pane.swap('pane-1', 'pane-2');

      expect(invoke).toHaveBeenCalledWith('pane_swap', {
        paneId: 'pane-1',
        targetPaneId: 'pane-2',
      });
      expect(result).toEqual(mockResult);
    });

    it('propagates errors', async () => {
      mockInvoke('pane_swap', () => Promise.reject(new Error('swap failed')));

      await expect(tauriBridge.pane.swap('pane-1', 'pane-2')).rejects.toThrow('swap failed');
    });
  });

  describe('pane.move', () => {
    it('calls invoke with pane_move and args', async () => {
      const mockResult = {
        id: 'ws-1',
        name: 'Workspace',
        projectId: '',
        worktreePath: '',
        branchName: null,
        isRootWorktree: false,
        surfaces: [],
        activeSurfaceIndex: 0,
        createdAt: 1000,
      };
      mockInvoke('pane_move', () => mockResult);

      const result = await tauriBridge.pane.move('pane-1', 'pane-2', 'left');

      expect(invoke).toHaveBeenCalledWith('pane_move', {
        paneId: 'pane-1',
        targetPaneId: 'pane-2',
        position: 'left',
      });
      expect(result).toEqual(mockResult);
    });

    it('propagates errors', async () => {
      mockInvoke('pane_move', () => Promise.reject(new Error('move failed')));

      await expect(tauriBridge.pane.move('pane-1', 'pane-2', 'bottom')).rejects.toThrow('move failed');
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
        { id: 'ws-1', name: 'Workspace 1', projectId: '', worktreePath: '', branchName: null, isRootWorktree: false, surfaces: [], activeSurfaceIndex: 0, createdAt: 1000 },
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

  describe('scrollback.save', () => {
    it('calls invoke with scrollback_save, paneId and data', async () => {
      mockInvoke('scrollback_save', () => undefined);

      await tauriBridge.scrollback.save('pane-1', 'base64data');

      expect(invoke).toHaveBeenCalledWith('scrollback_save', { paneId: 'pane-1', data: 'base64data' });
    });

    it('propagates errors', async () => {
      mockInvoke('scrollback_save', () => Promise.reject(new Error('save failed')));

      await expect(tauriBridge.scrollback.save('pane-1', 'data')).rejects.toThrow('save failed');
    });
  });

  describe('scrollback.load', () => {
    it('calls invoke with scrollback_load and returns data', async () => {
      mockInvoke('scrollback_load', () => 'base64data');

      const result = await tauriBridge.scrollback.load('pane-1');

      expect(invoke).toHaveBeenCalledWith('scrollback_load', { paneId: 'pane-1' });
      expect(result).toBe('base64data');
    });

    it('returns null when no scrollback exists', async () => {
      mockInvoke('scrollback_load', () => null);

      const result = await tauriBridge.scrollback.load('pane-1');

      expect(invoke).toHaveBeenCalledWith('scrollback_load', { paneId: 'pane-1' });
      expect(result).toBeNull();
    });

    it('propagates errors', async () => {
      mockInvoke('scrollback_load', () => Promise.reject(new Error('load failed')));

      await expect(tauriBridge.scrollback.load('pane-1')).rejects.toThrow('load failed');
    });
  });

  describe('notification.list', () => {
    it('calls invoke with notification_list and returns notifications', async () => {
      const mockNotifications = [
        {
          id: 'n1',
          paneId: 'pane-1',
          workspaceId: 'ws-1',
          oscType: 9,
          title: 'Build complete',
          body: null,
          timestamp: 1000,
          read: false,
        },
      ];
      mockInvoke('notification_list', () => mockNotifications);

      const result = await tauriBridge.notification.list();

      expect(invoke).toHaveBeenCalledWith('notification_list');
      expect(result).toEqual(mockNotifications);
    });

    it('propagates errors', async () => {
      mockInvoke('notification_list', () => Promise.reject(new Error('list failed')));

      await expect(tauriBridge.notification.list()).rejects.toThrow('list failed');
    });
  });

  describe('notification.markRead', () => {
    it('calls invoke with notification_mark_read and id', async () => {
      mockInvoke('notification_mark_read', () => undefined);

      await tauriBridge.notification.markRead('n1');

      expect(invoke).toHaveBeenCalledWith('notification_mark_read', { id: 'n1' });
    });

    it('propagates errors', async () => {
      mockInvoke('notification_mark_read', () => Promise.reject(new Error('mark failed')));

      await expect(tauriBridge.notification.markRead('n1')).rejects.toThrow('mark failed');
    });
  });

  describe('notification.clear', () => {
    it('calls invoke with notification_clear', async () => {
      mockInvoke('notification_clear', () => undefined);

      await tauriBridge.notification.clear();

      expect(invoke).toHaveBeenCalledWith('notification_clear');
    });

    it('propagates errors', async () => {
      mockInvoke('notification_clear', () => Promise.reject(new Error('clear failed')));

      await expect(tauriBridge.notification.clear()).rejects.toThrow('clear failed');
    });
  });

  describe('settings.get', () => {
    it('calls invoke with settings_get and returns settings', async () => {
      const mockSettings = {
        theme: 'dark',
        terminalFontFamily: 'monospace',
        terminalFontSize: 14,
        scrollbackLines: 5000,
        keybindings: {},
      };
      mockInvoke('settings_get', () => mockSettings);

      const result = await tauriBridge.settings.get();

      expect(invoke).toHaveBeenCalledWith('settings_get');
      expect(result).toEqual(mockSettings);
    });

    it('propagates errors', async () => {
      mockInvoke('settings_get', () => Promise.reject(new Error('get failed')));

      await expect(tauriBridge.settings.get()).rejects.toThrow('get failed');
    });
  });

  describe('settings.update', () => {
    it('calls invoke with settings_update key and value', async () => {
      mockInvoke('settings_update', () => undefined);

      await tauriBridge.settings.update('theme', 'light');

      expect(invoke).toHaveBeenCalledWith('settings_update', { key: 'theme', value: 'light' });
    });

    it('propagates errors', async () => {
      mockInvoke('settings_update', () => Promise.reject(new Error('update failed')));

      await expect(tauriBridge.settings.update('theme', 'dark')).rejects.toThrow('update failed');
    });
  });

  describe('settings.reset', () => {
    it('calls invoke with settings_reset', async () => {
      mockInvoke('settings_reset', () => undefined);

      await tauriBridge.settings.reset();

      expect(invoke).toHaveBeenCalledWith('settings_reset');
    });

    it('propagates errors', async () => {
      mockInvoke('settings_reset', () => Promise.reject(new Error('reset failed')));

      await expect(tauriBridge.settings.reset()).rejects.toThrow('reset failed');
    });
  });

  describe('project', () => {
    it('project.list calls project_list', async () => {
      const result = await tauriBridge.project.list();
      expect(result).toEqual([]);
    });

    it('project.add calls project_add', async () => {
      const result = await tauriBridge.project.add('/home/user/myproject');
      expect(result).toBeDefined();
      expect(result.id).toBeDefined();
    });

    it('project.remove calls project_remove', async () => {
      await expect(tauriBridge.project.remove('proj-1')).resolves.toBeUndefined();
    });
  });

  describe('worktree', () => {
    it('worktree.list calls worktree_list', async () => {
      const result = await tauriBridge.worktree.list('proj-1');
      expect(Array.isArray(result)).toBe(true);
    });

    it('worktree.create calls worktree_create', async () => {
      const result = await tauriBridge.worktree.create('proj-1', 'feature-branch');
      expect(result).toBeDefined();
      expect(result.isMain).toBe(false);
    });
  });
});
