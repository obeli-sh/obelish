// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore } from '../uiStore';
import { useWorkspaceStore } from '../workspaceStore';
import type { WorkspaceInfo, LayoutNode, SurfaceInfo } from '../../lib/workspace-types';

function makeLeaf(paneId: string): LayoutNode {
  return { type: 'leaf', paneId, ptyId: `pty-${paneId}` };
}

function makeSplit(
  direction: 'horizontal' | 'vertical',
  left: LayoutNode,
  right: LayoutNode,
): LayoutNode {
  return { type: 'split', direction, children: [left, right], sizes: [0.5, 0.5] };
}

function makeSurface(id: string, layout: LayoutNode): SurfaceInfo {
  return { id, name: `Surface ${id}`, layout };
}

function makeWorkspace(id: string, surfaces: SurfaceInfo[]): WorkspaceInfo {
  return {
    id,
    name: `Workspace ${id}`,
    projectId: '',
    worktreePath: '',
    branchName: null,
    isRootWorktree: false,
    surfaces,
    activeSurfaceIndex: 0,
    createdAt: Date.now(),
  };
}

function setupLayout(layout: LayoutNode) {
  const ws = makeWorkspace('ws-1', [makeSurface('s-1', layout)]);
  useWorkspaceStore.getState()._syncWorkspace(ws);
  useWorkspaceStore.getState()._setActiveWorkspace('ws-1');
}

describe('uiStore', () => {
  beforeEach(() => {
    useUiStore.setState({
      focusedPaneId: null,
      focusedPaneDimensions: null,
      sidebarOpen: true,
      notificationPanelOpen: false,
      commandPaletteOpen: false,
      settingsOpen: false,
    });
    useWorkspaceStore.setState({
      workspaces: {},
      activeWorkspaceId: null,
    });
  });

  it('starts with null focusedPaneId and sidebarOpen=true', () => {
    const state = useUiStore.getState();
    expect(state.focusedPaneId).toBeNull();
    expect(state.sidebarOpen).toBe(true);
  });

  describe('setFocusedPane', () => {
    it('updates focusedPaneId', () => {
      useUiStore.getState().setFocusedPane('pane-1');
      expect(useUiStore.getState().focusedPaneId).toBe('pane-1');
    });

    it('sets to null', () => {
      useUiStore.getState().setFocusedPane('pane-1');
      useUiStore.getState().setFocusedPane(null);
      expect(useUiStore.getState().focusedPaneId).toBeNull();
    });
  });

  describe('toggleSidebar', () => {
    it('toggles sidebarOpen state', () => {
      expect(useUiStore.getState().sidebarOpen).toBe(true);
      useUiStore.getState().toggleSidebar();
      expect(useUiStore.getState().sidebarOpen).toBe(false);
      useUiStore.getState().toggleSidebar();
      expect(useUiStore.getState().sidebarOpen).toBe(true);
    });
  });

  describe('toggleNotificationPanel', () => {
    it('toggles notificationPanelOpen state', () => {
      expect(useUiStore.getState().notificationPanelOpen).toBe(false);
      useUiStore.getState().toggleNotificationPanel();
      expect(useUiStore.getState().notificationPanelOpen).toBe(true);
      useUiStore.getState().toggleNotificationPanel();
      expect(useUiStore.getState().notificationPanelOpen).toBe(false);
    });
  });

  describe('toggleCommandPalette', () => {
    it('toggles commandPaletteOpen state', () => {
      expect(useUiStore.getState().commandPaletteOpen).toBe(false);
      useUiStore.getState().toggleCommandPalette();
      expect(useUiStore.getState().commandPaletteOpen).toBe(true);
      useUiStore.getState().toggleCommandPalette();
      expect(useUiStore.getState().commandPaletteOpen).toBe(false);
    });

    it('starts with commandPaletteOpen=false', () => {
      expect(useUiStore.getState().commandPaletteOpen).toBe(false);
    });
  });

  describe('toggleSettings', () => {
    it('toggles settingsOpen state', () => {
      expect(useUiStore.getState().settingsOpen).toBe(false);
      useUiStore.getState().toggleSettings();
      expect(useUiStore.getState().settingsOpen).toBe(true);
      useUiStore.getState().toggleSettings();
      expect(useUiStore.getState().settingsOpen).toBe(false);
    });

    it('starts with settingsOpen=false', () => {
      expect(useUiStore.getState().settingsOpen).toBe(false);
    });
  });

  describe('focusAdjacentPane', () => {
    it('navigates right in a horizontal split', () => {
      // [pane-1 | pane-2] horizontal split
      const layout = makeSplit('horizontal', makeLeaf('pane-1'), makeLeaf('pane-2'));
      setupLayout(layout);
      useUiStore.getState().setFocusedPane('pane-1');

      useUiStore.getState().focusAdjacentPane('right');
      expect(useUiStore.getState().focusedPaneId).toBe('pane-2');
    });

    it('navigates left in a horizontal split', () => {
      const layout = makeSplit('horizontal', makeLeaf('pane-1'), makeLeaf('pane-2'));
      setupLayout(layout);
      useUiStore.getState().setFocusedPane('pane-2');

      useUiStore.getState().focusAdjacentPane('left');
      expect(useUiStore.getState().focusedPaneId).toBe('pane-1');
    });

    it('navigates down in a vertical split', () => {
      // [pane-1] / [pane-2] vertical split
      const layout = makeSplit('vertical', makeLeaf('pane-1'), makeLeaf('pane-2'));
      setupLayout(layout);
      useUiStore.getState().setFocusedPane('pane-1');

      useUiStore.getState().focusAdjacentPane('down');
      expect(useUiStore.getState().focusedPaneId).toBe('pane-2');
    });

    it('navigates up in a vertical split', () => {
      const layout = makeSplit('vertical', makeLeaf('pane-1'), makeLeaf('pane-2'));
      setupLayout(layout);
      useUiStore.getState().setFocusedPane('pane-2');

      useUiStore.getState().focusAdjacentPane('up');
      expect(useUiStore.getState().focusedPaneId).toBe('pane-1');
    });

    it('does nothing when at edge (no neighbor in that direction)', () => {
      const layout = makeSplit('horizontal', makeLeaf('pane-1'), makeLeaf('pane-2'));
      setupLayout(layout);
      useUiStore.getState().setFocusedPane('pane-1');

      useUiStore.getState().focusAdjacentPane('left');
      expect(useUiStore.getState().focusedPaneId).toBe('pane-1');
    });

    it('does nothing when no layout exists', () => {
      useUiStore.getState().setFocusedPane('pane-1');

      useUiStore.getState().focusAdjacentPane('right');
      expect(useUiStore.getState().focusedPaneId).toBe('pane-1');
    });

    it('does nothing when focusedPaneId is null', () => {
      const layout = makeSplit('horizontal', makeLeaf('pane-1'), makeLeaf('pane-2'));
      setupLayout(layout);

      useUiStore.getState().focusAdjacentPane('right');
      expect(useUiStore.getState().focusedPaneId).toBeNull();
    });

    it('does nothing for perpendicular direction (up/down on horizontal split)', () => {
      const layout = makeSplit('horizontal', makeLeaf('pane-1'), makeLeaf('pane-2'));
      setupLayout(layout);
      useUiStore.getState().setFocusedPane('pane-1');

      useUiStore.getState().focusAdjacentPane('up');
      expect(useUiStore.getState().focusedPaneId).toBe('pane-1');
    });

    it('handles nested splits', () => {
      // Horizontal split: left=[pane-1], right=[pane-2 / pane-3 vertical]
      const rightSplit = makeSplit('vertical', makeLeaf('pane-2'), makeLeaf('pane-3'));
      const layout = makeSplit('horizontal', makeLeaf('pane-1'), rightSplit);
      setupLayout(layout);

      // From pane-1, go right -> should land on first leaf of right subtree (pane-2)
      useUiStore.getState().setFocusedPane('pane-1');
      useUiStore.getState().focusAdjacentPane('right');
      expect(useUiStore.getState().focusedPaneId).toBe('pane-2');
    });

    it('navigates between leaves in nested splits (deep)', () => {
      // Vertical split: top=[pane-1 | pane-2 horizontal], bottom=[pane-3]
      const topSplit = makeSplit('horizontal', makeLeaf('pane-1'), makeLeaf('pane-2'));
      const layout = makeSplit('vertical', topSplit, makeLeaf('pane-3'));
      setupLayout(layout);

      // From pane-2, go down -> should go to pane-3
      useUiStore.getState().setFocusedPane('pane-2');
      useUiStore.getState().focusAdjacentPane('down');
      expect(useUiStore.getState().focusedPaneId).toBe('pane-3');
    });

    it('navigates up from deep nested leaf', () => {
      // Vertical split: top=[pane-1], bottom=[pane-2 | pane-3 horizontal]
      const bottomSplit = makeSplit('horizontal', makeLeaf('pane-2'), makeLeaf('pane-3'));
      const layout = makeSplit('vertical', makeLeaf('pane-1'), bottomSplit);
      setupLayout(layout);

      // From pane-3, go up -> should go to pane-1
      useUiStore.getState().setFocusedPane('pane-3');
      useUiStore.getState().focusAdjacentPane('up');
      expect(useUiStore.getState().focusedPaneId).toBe('pane-1');
    });
  });

  describe('focusedPaneDimensions', () => {
    it('starts as null', () => {
      expect(useUiStore.getState().focusedPaneDimensions).toBeNull();
    });

    it('can be set via setFocusedPaneDimensions', () => {
      useUiStore.getState().setFocusedPaneDimensions({ width: 800, height: 400 });
      expect(useUiStore.getState().focusedPaneDimensions).toEqual({ width: 800, height: 400 });
    });

    it('can be cleared by setting null', () => {
      useUiStore.getState().setFocusedPaneDimensions({ width: 800, height: 400 });
      useUiStore.getState().setFocusedPaneDimensions(null);
      expect(useUiStore.getState().focusedPaneDimensions).toBeNull();
    });
  });
});
