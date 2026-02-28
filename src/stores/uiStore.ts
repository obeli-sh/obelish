import { create } from 'zustand';
import type { LayoutNode } from '../lib/workspace-types';
import { useWorkspaceStore } from './workspaceStore';

type Direction = 'up' | 'down' | 'left' | 'right';

interface PaneDimensions {
  width: number;
  height: number;
}

interface UiStoreState {
  focusedPaneId: string | null;
  focusedPaneDimensions: PaneDimensions | null;
  sidebarOpen: boolean;
  notificationPanelOpen: boolean;
  commandPaletteOpen: boolean;
  settingsOpen: boolean;
  setFocusedPane: (id: string | null) => void;
  setFocusedPaneDimensions: (dims: PaneDimensions | null) => void;
  toggleSidebar: () => void;
  toggleNotificationPanel: () => void;
  toggleCommandPalette: () => void;
  toggleSettings: () => void;
  focusAdjacentPane: (direction: Direction) => void;
}

/**
 * Find the path from root to the leaf with the given paneId.
 * Returns an array of indices representing the path, or null if not found.
 */
function findPath(node: LayoutNode, paneId: string): number[] | null {
  if (node.type === 'leaf') {
    return node.paneId === paneId ? [] : null;
  }
  for (let i = 0; i < node.children.length; i++) {
    const sub = findPath(node.children[i], paneId);
    if (sub !== null) return [i, ...sub];
  }
  return null;
}

/**
 * Get the first leaf in a subtree, descending into the "first" child
 * based on the desired direction.
 */
function getFirstLeaf(node: LayoutNode, preferIndex: number): string {
  if (node.type === 'leaf') return node.paneId;
  return getFirstLeaf(node.children[preferIndex], preferIndex);
}

/**
 * Maps a direction to the split direction it moves along
 * and whether we want to move to the next (1) or previous (0) child.
 */
function directionInfo(dir: Direction): { axis: 'horizontal' | 'vertical'; toward: 0 | 1 } {
  switch (dir) {
    case 'left':  return { axis: 'horizontal', toward: 0 };
    case 'right': return { axis: 'horizontal', toward: 1 };
    case 'up':    return { axis: 'vertical',   toward: 0 };
    case 'down':  return { axis: 'vertical',   toward: 1 };
  }
}

function findAdjacentPane(layout: LayoutNode, paneId: string, direction: Direction): string | null {
  const path = findPath(layout, paneId);
  if (!path) return null;

  const { axis, toward } = directionInfo(direction);

  // Walk up the path to find a split node on the right axis where we can move
  // in the desired direction.
  let node = layout;
  const nodes: LayoutNode[] = [node];
  for (const idx of path) {
    if (node.type === 'split') {
      node = node.children[idx];
      nodes.push(node);
    }
  }

  // Walk back up the tree (from leaf toward root) looking for a split on the correct axis
  // where the current position is on the opposite side of where we want to go.
  for (let depth = path.length - 1; depth >= 0; depth--) {
    const parent = nodes[depth];
    if (parent.type === 'split' && parent.direction === axis) {
      const currentChildIndex = path[depth];
      // If we want to go "toward" 1 (right/down) and we're at child 0, move to child 1
      // If we want to go "toward" 0 (left/up) and we're at child 1, move to child 0
      if (currentChildIndex !== toward) {
        // Enter the other child and pick the closest leaf
        const enterPreference = toward === 1 ? 0 : 1;
        return getFirstLeaf(parent.children[toward], enterPreference);
      }
    }
  }

  return null;
}

export const useUiStore = create<UiStoreState>((set, get) => ({
  focusedPaneId: null,
  focusedPaneDimensions: null,
  sidebarOpen: true,
  notificationPanelOpen: false,
  commandPaletteOpen: false,
  settingsOpen: false,

  setFocusedPane: (id) => {
    set({ focusedPaneId: id });
  },

  setFocusedPaneDimensions: (dims) => {
    set({ focusedPaneDimensions: dims });
  },

  toggleSidebar: () => {
    set((state) => ({ sidebarOpen: !state.sidebarOpen }));
  },

  toggleNotificationPanel: () => {
    set((state) => ({ notificationPanelOpen: !state.notificationPanelOpen }));
  },

  toggleCommandPalette: () => {
    set((state) => ({ commandPaletteOpen: !state.commandPaletteOpen }));
  },

  toggleSettings: () => {
    set((state) => ({ settingsOpen: !state.settingsOpen }));
  },

  focusAdjacentPane: (direction) => {
    const { focusedPaneId } = get();
    if (!focusedPaneId) return;

    const layout = useWorkspaceStore.getState().getActiveLayout();
    if (!layout) return;

    const adjacent = findAdjacentPane(layout, focusedPaneId, direction);
    if (adjacent) {
      set({ focusedPaneId: adjacent });
    }
  },
}));
