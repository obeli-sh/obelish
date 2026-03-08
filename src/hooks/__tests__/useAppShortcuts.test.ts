import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import { useSettingsStore } from '../../stores/settingsStore';
import { invoke, mockInvoke, clearInvokeMocks } from '@tauri-apps/api/core';
import type { WorkspaceInfo } from '../../lib/workspace-types';

import { useAppShortcuts } from '../useAppShortcuts';

function fireKeydown(key: string, opts: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...opts,
  });
  window.dispatchEvent(event);
}

describe('useAppShortcuts', () => {
  let originalPlatform: string;

  beforeEach(() => {
    originalPlatform = navigator.platform;
    Object.defineProperty(navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    });

    clearInvokeMocks();

    useUiStore.setState({
      focusedPaneId: 'pane-1',
      sidebarOpen: true,
      commandPaletteOpen: false,
      settingsOpen: false,
      notificationPanelOpen: false,
      projectPickerOpen: false,
    });
    useWorkspaceStore.setState({
      workspaces: {},
      activeWorkspaceId: null,
    });

    // Reset settings store to defaults so keybindings match real commands
    useSettingsStore.getState().resetAllKeybindings();

    // Set up invoke handlers for commands that will be triggered
    mockInvoke('pane_split', () => ({
      id: 'ws-1',
      name: 'Workspace 1',
      projectId: '',
      worktreePath: '',
      branchName: null,
      isRootWorktree: false,
      surfaces: [],
      activeSurfaceIndex: 0,
      createdAt: 0,
    }));
    mockInvoke('pane_close', () => undefined);
    mockInvoke('pane_open_browser', () => ({
      id: 'ws-1',
      name: 'Workspace 1',
      projectId: '',
      worktreePath: '',
      branchName: null,
      isRootWorktree: false,
      surfaces: [],
      activeSurfaceIndex: 0,
      createdAt: 0,
    }));
    mockInvoke('workspace_create', () => ({
      id: 'ws-new',
      name: 'New Workspace',
      projectId: '',
      worktreePath: '',
      branchName: null,
      isRootWorktree: false,
      surfaces: [],
      activeSurfaceIndex: 0,
      createdAt: 0,
    }));
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'platform', {
      value: originalPlatform,
      configurable: true,
    });
  });

  it('Ctrl+Shift+H calls pane.split with horizontal', () => {
    const { unmount } = renderHook(() => useAppShortcuts());

    fireKeydown('h', { ctrlKey: true, shiftKey: true });

    expect(invoke).toHaveBeenCalledWith('pane_split', { paneId: 'pane-1', direction: 'horizontal' });
    unmount();
  });

  it('Ctrl+Shift+V calls pane.split with vertical', () => {
    const { unmount } = renderHook(() => useAppShortcuts());

    fireKeydown('v', { ctrlKey: true, shiftKey: true });

    expect(invoke).toHaveBeenCalledWith('pane_split', { paneId: 'pane-1', direction: 'vertical' });
    unmount();
  });

  it('Ctrl+W calls pane.close with focused pane', () => {
    const { unmount } = renderHook(() => useAppShortcuts());

    fireKeydown('w', { ctrlKey: true });

    expect(invoke).toHaveBeenCalledWith('pane_close', { paneId: 'pane-1' });
    unmount();
  });

  it('Ctrl+N opens the project picker', () => {
    const { unmount } = renderHook(() => useAppShortcuts());

    fireKeydown('n', { ctrlKey: true });

    expect(useUiStore.getState().projectPickerOpen).toBe(true);
    unmount();
  });

  it('Ctrl+1 switches to first workspace', () => {
    const ws1: WorkspaceInfo = {
      id: 'ws-1',
      name: 'Workspace 1',
      projectId: '',
      worktreePath: '',
      branchName: null,
      isRootWorktree: false,
      surfaces: [],
      activeSurfaceIndex: 0,
      createdAt: 1,
    };
    const ws2: WorkspaceInfo = {
      id: 'ws-2',
      name: 'Workspace 2',
      projectId: '',
      worktreePath: '',
      branchName: null,
      isRootWorktree: false,
      surfaces: [],
      activeSurfaceIndex: 0,
      createdAt: 2,
    };
    useWorkspaceStore.setState({
      workspaces: { 'ws-1': ws1, 'ws-2': ws2 },
      activeWorkspaceId: 'ws-2',
    });

    const { unmount } = renderHook(() => useAppShortcuts());

    fireKeydown('1', { ctrlKey: true });

    expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-1');
    unmount();
  });

  it('Ctrl+ArrowUp calls focusAdjacentPane with up', () => {
    const spy = vi.spyOn(useUiStore.getState(), 'focusAdjacentPane');

    const { unmount } = renderHook(() => useAppShortcuts());

    fireKeydown('ArrowUp', { ctrlKey: true });

    expect(spy).toHaveBeenCalledWith('up');
    spy.mockRestore();
    unmount();
  });

  it('Ctrl+ArrowRight calls focusAdjacentPane with right', () => {
    const spy = vi.spyOn(useUiStore.getState(), 'focusAdjacentPane');

    const { unmount } = renderHook(() => useAppShortcuts());

    fireKeydown('ArrowRight', { ctrlKey: true });

    expect(spy).toHaveBeenCalledWith('right');
    spy.mockRestore();
    unmount();
  });

  it('Ctrl+Shift+B calls pane.openBrowser with about:blank', () => {
    const { unmount } = renderHook(() => useAppShortcuts());

    fireKeydown('b', { ctrlKey: true, shiftKey: true });

    expect(invoke).toHaveBeenCalledWith('pane_open_browser', {
      paneId: 'pane-1',
      url: 'about:blank',
      direction: 'horizontal',
    });
    unmount();
  });

  it('Ctrl+Shift+B does nothing when no focused pane', () => {
    useUiStore.setState({ focusedPaneId: null });

    const { unmount } = renderHook(() => useAppShortcuts());

    fireKeydown('b', { ctrlKey: true, shiftKey: true });

    expect(invoke).not.toHaveBeenCalledWith(
      'pane_open_browser',
      expect.anything(),
    );
    unmount();
  });

  it('does nothing for split when no focused pane', () => {
    useUiStore.setState({ focusedPaneId: null });

    const { unmount } = renderHook(() => useAppShortcuts());

    fireKeydown('h', { ctrlKey: true, shiftKey: true });

    expect(invoke).not.toHaveBeenCalledWith('pane_split', expect.anything());
    unmount();
  });

  it('does nothing for close when no focused pane', () => {
    useUiStore.setState({ focusedPaneId: null });

    const { unmount } = renderHook(() => useAppShortcuts());

    fireKeydown('w', { ctrlKey: true });

    expect(invoke).not.toHaveBeenCalledWith('pane_close', expect.anything());
    unmount();
  });

  it('Ctrl+I toggles notification panel', () => {
    expect(useUiStore.getState().notificationPanelOpen).toBe(false);

    const { unmount } = renderHook(() => useAppShortcuts());

    fireKeydown('i', { ctrlKey: true });

    expect(useUiStore.getState().notificationPanelOpen).toBe(true);

    fireKeydown('i', { ctrlKey: true });

    expect(useUiStore.getState().notificationPanelOpen).toBe(false);
    unmount();
  });
});
