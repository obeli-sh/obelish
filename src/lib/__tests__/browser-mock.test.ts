import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { isTauri, mockInvoke, mockListen, resetMockState } from '../browser-mock';

describe('browser-mock', () => {
  beforeEach(() => {
    resetMockState();
  });

  describe('isTauri', () => {
    type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };
    const tauriWindow = window as unknown as TauriWindow;
    const originalTauri = tauriWindow.__TAURI_INTERNALS__;

    afterEach(() => {
      if (originalTauri === undefined) {
        delete tauriWindow.__TAURI_INTERNALS__;
      } else {
        tauriWindow.__TAURI_INTERNALS__ = originalTauri;
      }
    });

    it('returns false when __TAURI_INTERNALS__ is not set', () => {
      delete tauriWindow.__TAURI_INTERNALS__;
      expect(isTauri()).toBe(false);
    });

    it('returns true when __TAURI_INTERNALS__ is set', () => {
      tauriWindow.__TAURI_INTERNALS__ = {};
      expect(isTauri()).toBe(true);
    });
  });

  describe('mockInvoke', () => {
    it('session_restore returns array with valid WorkspaceInfo', async () => {
      const result = await mockInvoke('session_restore');
      expect(Array.isArray(result)).toBe(true);
      const list = result as Array<Record<string, unknown>>;
      expect(list.length).toBeGreaterThan(0);

      const ws = list[0];
      expect(ws).toHaveProperty('id');
      expect(ws).toHaveProperty('name');
      expect(ws).toHaveProperty('surfaces');
      expect(ws).toHaveProperty('activeSurfaceIndex');
      expect(ws).toHaveProperty('createdAt');
    });

    it('settings_get returns valid RustSettings', async () => {
      const result = await mockInvoke('settings_get') as Record<string, unknown>;
      expect(result).toHaveProperty('keybindings');
      expect(result).toHaveProperty('theme');
      expect(result).toHaveProperty('terminalFontFamily');
      expect(result).toHaveProperty('terminalFontSize');
      expect(result).toHaveProperty('scrollbackLines');
    });

    it('shell_list returns ShellInfo array', async () => {
      const result = await mockInvoke('shell_list') as Array<Record<string, unknown>>;
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result[0]).toHaveProperty('path');
      expect(result[0]).toHaveProperty('name');
    });

    it('workspace_create returns a valid WorkspaceInfo', async () => {
      const result = await mockInvoke('workspace_create') as Record<string, unknown>;
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('name');
      expect(result).toHaveProperty('surfaces');
    });

    it('workspace_list returns an array', async () => {
      const result = await mockInvoke('workspace_list');
      expect(Array.isArray(result)).toBe(true);
    });

    it('pty_spawn returns a PtySpawnResult', async () => {
      const result = await mockInvoke('pty_spawn') as Record<string, unknown>;
      expect(result).toHaveProperty('ptyId');
      expect(typeof result.ptyId).toBe('string');
    });

    it('returns undefined for unknown commands without throwing', async () => {
      const result = await mockInvoke('unknown_cmd');
      expect(result).toBeUndefined();
    });

    it('void commands resolve without error', async () => {
      await expect(mockInvoke('pty_write')).resolves.toBeUndefined();
      await expect(mockInvoke('pty_resize')).resolves.toBeUndefined();
      await expect(mockInvoke('pty_kill')).resolves.toBeUndefined();
      await expect(mockInvoke('workspace_close')).resolves.toBeUndefined();
      await expect(mockInvoke('session_save')).resolves.toBeUndefined();
      await expect(mockInvoke('scrollback_save')).resolves.toBeUndefined();
      await expect(mockInvoke('notification_mark_read')).resolves.toBeUndefined();
      await expect(mockInvoke('notification_clear')).resolves.toBeUndefined();
      await expect(mockInvoke('settings_update')).resolves.toBeUndefined();
      await expect(mockInvoke('settings_reset')).resolves.toBeUndefined();
      await expect(mockInvoke('workspace_reorder')).resolves.toBeUndefined();
    });

    it('scrollback_load returns null', async () => {
      const result = await mockInvoke('scrollback_load');
      expect(result).toBeNull();
    });

    it('notification_list returns empty array', async () => {
      const result = await mockInvoke('notification_list');
      expect(Array.isArray(result)).toBe(true);
    });

    it('pane_split returns a valid WorkspaceInfo', async () => {
      const result = await mockInvoke('pane_split') as Record<string, unknown>;
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('surfaces');
    });

    it('pane_split transforms target leaf into a split layout', async () => {
      const restored = await mockInvoke('session_restore') as Array<Record<string, unknown>>;
      const firstWorkspace = restored[0];
      const firstSurface = (firstWorkspace.surfaces as Array<Record<string, unknown>>)[0];
      const firstLayout = firstSurface.layout as Record<string, unknown>;
      const paneId = firstLayout.paneId as string;

      const split = await mockInvoke('pane_split', {
        paneId,
        direction: 'vertical',
      }) as Record<string, unknown>;

      const splitLayout = ((split.surfaces as Array<Record<string, unknown>>)[0].layout) as Record<string, unknown>;
      expect(splitLayout.type).toBe('split');
      expect(splitLayout.direction).toBe('vertical');

      const children = splitLayout.children as Array<Record<string, unknown>>;
      expect(children).toHaveLength(2);
      expect(children[0]?.type).toBe('leaf');
      expect(children[1]?.type).toBe('leaf');
    });

    it('pane_close resolves without error', async () => {
      await expect(mockInvoke('pane_close')).resolves.toBeUndefined();
    });

    it('pane_swap swaps terminal leaves in the same workspace', async () => {
      const restored = await mockInvoke('session_restore') as Array<Record<string, unknown>>;
      const firstWorkspace = restored[0];
      const firstSurface = (firstWorkspace.surfaces as Array<Record<string, unknown>>)[0];
      const firstLayout = firstSurface.layout as Record<string, unknown>;
      const paneId = firstLayout.paneId as string;

      const split = await mockInvoke('pane_split', {
        paneId,
        direction: 'horizontal',
      }) as Record<string, unknown>;
      const splitLayout = ((split.surfaces as Array<Record<string, unknown>>)[0].layout) as Record<string, unknown>;
      const splitChildren = splitLayout.children as Array<Record<string, unknown>>;
      const sourcePaneId = splitChildren[0].paneId as string;
      const targetPaneId = splitChildren[1].paneId as string;

      const swapped = await mockInvoke('pane_swap', {
        paneId: sourcePaneId,
        targetPaneId,
      }) as Record<string, unknown>;
      const swappedLayout = ((swapped.surfaces as Array<Record<string, unknown>>)[0].layout) as Record<string, unknown>;
      const swappedChildren = swappedLayout.children as Array<Record<string, unknown>>;

      expect(swappedChildren[0].paneId).toBe(targetPaneId);
      expect(swappedChildren[1].paneId).toBe(sourcePaneId);
    });

    it('pane_move relayouts panes when dropped on an edge', async () => {
      const restored = await mockInvoke('session_restore') as Array<Record<string, unknown>>;
      const firstWorkspace = restored[0];
      const firstSurface = (firstWorkspace.surfaces as Array<Record<string, unknown>>)[0];
      const firstLayout = firstSurface.layout as Record<string, unknown>;
      const paneId = firstLayout.paneId as string;

      const split = await mockInvoke('pane_split', {
        paneId,
        direction: 'horizontal',
      }) as Record<string, unknown>;
      const splitLayout = ((split.surfaces as Array<Record<string, unknown>>)[0].layout) as Record<string, unknown>;
      const splitChildren = splitLayout.children as Array<Record<string, unknown>>;
      const sourcePaneId = splitChildren[0].paneId as string;
      const targetPaneId = splitChildren[1].paneId as string;

      const moved = await mockInvoke('pane_move', {
        paneId: sourcePaneId,
        targetPaneId,
        position: 'bottom',
      }) as Record<string, unknown>;
      const movedLayout = ((moved.surfaces as Array<Record<string, unknown>>)[0].layout) as Record<string, unknown>;
      const movedChildren = movedLayout.children as Array<Record<string, unknown>>;

      expect(movedLayout.direction).toBe('vertical');
      expect(movedChildren[0].paneId).toBe(targetPaneId);
      expect(movedChildren[1].paneId).toBe(sourcePaneId);
    });

    it('pane_move across workspaces leaves layout unchanged', async () => {
      await mockInvoke('workspace_create', { name: 'Workspace 2' });
      const before = await mockInvoke('workspace_list') as Array<Record<string, unknown>>;
      const firstPaneId = (((before[0].surfaces as Array<Record<string, unknown>>)[0].layout) as Record<string, unknown>).paneId as string;
      const secondPaneId = (((before[1].surfaces as Array<Record<string, unknown>>)[0].layout) as Record<string, unknown>).paneId as string;

      await mockInvoke('pane_move', {
        paneId: firstPaneId,
        targetPaneId: secondPaneId,
        position: 'left',
      });

      const after = await mockInvoke('workspace_list');
      expect(after).toEqual(before);
    });

    it('pane_open_browser returns a valid WorkspaceInfo', async () => {
      const result = await mockInvoke('pane_open_browser') as Record<string, unknown>;
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('surfaces');
    });

    it('pane_open_browser creates a browser leaf with empty ptyId', async () => {
      const restored = await mockInvoke('session_restore') as Array<Record<string, unknown>>;
      const firstWorkspace = restored[0];
      const firstSurface = (firstWorkspace.surfaces as Array<Record<string, unknown>>)[0];
      const firstLayout = firstSurface.layout as Record<string, unknown>;
      const paneId = firstLayout.paneId as string;

      const opened = await mockInvoke('pane_open_browser', {
        paneId,
        url: 'about:blank',
        direction: 'horizontal',
      }) as Record<string, unknown>;

      const layout = ((opened.surfaces as Array<Record<string, unknown>>)[0].layout) as Record<string, unknown>;
      expect(layout.type).toBe('split');
      const children = layout.children as Array<Record<string, unknown>>;
      const browserLeaf = children[1];
      expect(browserLeaf?.type).toBe('leaf');
      expect(browserLeaf?.ptyId).toBe('');
    });

    it('workspace_rename returns a valid WorkspaceInfo', async () => {
      const result = await mockInvoke('workspace_rename', { workspaceId: 'x', newName: 'New' }) as Record<string, unknown>;
      expect(result).toHaveProperty('id');
      expect(result).toHaveProperty('name');
    });
  });

  describe('mockListen', () => {
    it('returns an unlisten function', async () => {
      const handler = () => {};
      const unlisten = await mockListen('test-event', handler);
      expect(typeof unlisten).toBe('function');
    });

    it('unlisten is callable without error', async () => {
      const handler = () => {};
      const unlisten = await mockListen('test-event', handler);
      expect(() => unlisten()).not.toThrow();
    });
  });

  describe('mock workspace structure', () => {
    it('has correct nested layout structure', async () => {
      const result = await mockInvoke('session_restore') as Array<Record<string, unknown>>;
      const ws = result[0];
      const surfaces = ws.surfaces as Array<Record<string, unknown>>;
      expect(surfaces.length).toBeGreaterThan(0);

      const surface = surfaces[0];
      expect(surface).toHaveProperty('id');
      expect(surface).toHaveProperty('name');
      expect(surface).toHaveProperty('layout');

      const layout = surface.layout as Record<string, unknown>;
      expect(layout.type).toBe('leaf');
      expect(layout).toHaveProperty('paneId');
      expect(layout).toHaveProperty('ptyId');
    });
  });
});
