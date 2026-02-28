import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useUiStore } from '../../stores/uiStore';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { WorkspaceInfo } from '../../lib/workspace-types';

vi.mock('../../lib/tauri-bridge', () => ({
  tauriBridge: {
    workspace: {
      create: vi.fn(() =>
        Promise.resolve({
          id: 'ws-1',
          name: 'Workspace 1',
          surfaces: [],
          activeSurfaceIndex: 0,
          createdAt: 0,
        }),
      ),
      close: vi.fn(() => Promise.resolve()),
      list: vi.fn(() => Promise.resolve([])),
    },
    pane: {
      split: vi.fn(() =>
        Promise.resolve({ paneId: 'new-pane', ptyId: 'new-pty' }),
      ),
      close: vi.fn(() => Promise.resolve()),
      openBrowser: vi.fn(() =>
        Promise.resolve({
          id: 'ws-1',
          name: 'Workspace 1',
          surfaces: [],
          activeSurfaceIndex: 0,
          createdAt: 0,
        }),
      ),
    },
    pty: {
      spawn: vi.fn(() => Promise.resolve({ ptyId: 'pty-1' })),
      write: vi.fn(() => Promise.resolve()),
      resize: vi.fn(() => Promise.resolve()),
      kill: vi.fn(() => Promise.resolve()),
    },
  },
}));

// Import after mock so the mock is in place
import { useAppShortcuts } from '../useAppShortcuts';
import { tauriBridge } from '../../lib/tauri-bridge';

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

    useUiStore.setState({ focusedPaneId: 'pane-1', sidebarOpen: true });
    useWorkspaceStore.setState({
      workspaces: {},
      activeWorkspaceId: null,
    });

    vi.mocked(tauriBridge.pane.split).mockClear();
    vi.mocked(tauriBridge.pane.close).mockClear();
    vi.mocked(tauriBridge.pane.openBrowser).mockClear();
    vi.mocked(tauriBridge.workspace.create).mockClear();
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

    expect(tauriBridge.pane.split).toHaveBeenCalledWith('pane-1', 'horizontal');
    unmount();
  });

  it('Ctrl+Shift+V calls pane.split with vertical', () => {
    const { unmount } = renderHook(() => useAppShortcuts());

    fireKeydown('v', { ctrlKey: true, shiftKey: true });

    expect(tauriBridge.pane.split).toHaveBeenCalledWith('pane-1', 'vertical');
    unmount();
  });

  it('Ctrl+W calls pane.close with focused pane', () => {
    const { unmount } = renderHook(() => useAppShortcuts());

    fireKeydown('w', { ctrlKey: true });

    expect(tauriBridge.pane.close).toHaveBeenCalledWith('pane-1');
    unmount();
  });

  it('Ctrl+N calls workspace.create', () => {
    const { unmount } = renderHook(() => useAppShortcuts());

    fireKeydown('n', { ctrlKey: true });

    expect(tauriBridge.workspace.create).toHaveBeenCalled();
    unmount();
  });

  it('Ctrl+1 switches to first workspace', () => {
    const ws1: WorkspaceInfo = {
      id: 'ws-1',
      name: 'Workspace 1',
      surfaces: [],
      activeSurfaceIndex: 0,
      createdAt: 1,
    };
    const ws2: WorkspaceInfo = {
      id: 'ws-2',
      name: 'Workspace 2',
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

    expect(tauriBridge.pane.openBrowser).toHaveBeenCalledWith('pane-1', 'about:blank', 'horizontal');
    unmount();
  });

  it('Ctrl+Shift+B does nothing when no focused pane', () => {
    useUiStore.setState({ focusedPaneId: null });

    const { unmount } = renderHook(() => useAppShortcuts());

    fireKeydown('b', { ctrlKey: true, shiftKey: true });

    expect(tauriBridge.pane.openBrowser).not.toHaveBeenCalled();
    unmount();
  });

  it('does nothing for split when no focused pane', () => {
    useUiStore.setState({ focusedPaneId: null });

    const { unmount } = renderHook(() => useAppShortcuts());

    fireKeydown('h', { ctrlKey: true, shiftKey: true });

    expect(tauriBridge.pane.split).not.toHaveBeenCalled();
    unmount();
  });

  it('does nothing for close when no focused pane', () => {
    useUiStore.setState({ focusedPaneId: null });

    const { unmount } = renderHook(() => useAppShortcuts());

    fireKeydown('w', { ctrlKey: true });

    expect(tauriBridge.pane.close).not.toHaveBeenCalled();
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
