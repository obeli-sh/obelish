// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { useWorkspaceStore } from '../workspaceStore';
import type { WorkspaceInfo, SurfaceInfo, LayoutNode } from '../../lib/workspace-types';

function makeLeaf(paneId: string): LayoutNode {
  return { type: 'leaf', paneId, ptyId: `pty-${paneId}` };
}

function makeSurface(id: string, layout: LayoutNode): SurfaceInfo {
  return { id, name: `Surface ${id}`, layout };
}

function makeWorkspace(id: string, surfaces: SurfaceInfo[], activeSurfaceIndex = 0): WorkspaceInfo {
  return {
    id,
    name: `Workspace ${id}`,
    projectId: '',
    worktreePath: '',
    branchName: null,
    isRootWorktree: false,
    surfaces,
    activeSurfaceIndex,
    createdAt: Date.now(),
  };
}

describe('workspaceStore', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      workspaces: {},
      activeWorkspaceId: null,
      orderedIds: [],
      browserPaneUrls: {},
      paneNames: {},
      _nextPaneNumber: 1,
    });
  });

  it('starts with empty workspaces and null activeWorkspaceId', () => {
    const state = useWorkspaceStore.getState();
    expect(state.workspaces).toEqual({});
    expect(state.activeWorkspaceId).toBeNull();
  });

  describe('_syncWorkspace', () => {
    it('adds a workspace', () => {
      const ws = makeWorkspace('ws-1', [makeSurface('s-1', makeLeaf('p-1'))]);
      useWorkspaceStore.getState()._syncWorkspace(ws);

      const state = useWorkspaceStore.getState();
      expect(state.workspaces['ws-1']).toEqual(ws);
    });

    it('updates an existing workspace', () => {
      const ws1 = makeWorkspace('ws-1', [makeSurface('s-1', makeLeaf('p-1'))]);
      useWorkspaceStore.getState()._syncWorkspace(ws1);

      const ws1Updated = { ...ws1, name: 'Updated Name' };
      useWorkspaceStore.getState()._syncWorkspace(ws1Updated);

      const state = useWorkspaceStore.getState();
      expect(state.workspaces['ws-1'].name).toBe('Updated Name');
      expect(Object.keys(state.workspaces)).toHaveLength(1);
    });
  });

  describe('_removeWorkspace', () => {
    it('removes a workspace', () => {
      const ws = makeWorkspace('ws-1', [makeSurface('s-1', makeLeaf('p-1'))]);
      useWorkspaceStore.getState()._syncWorkspace(ws);
      useWorkspaceStore.getState()._removeWorkspace('ws-1');

      const state = useWorkspaceStore.getState();
      expect(state.workspaces['ws-1']).toBeUndefined();
    });

    it('activates another workspace when the active workspace is removed', () => {
      const ws1 = makeWorkspace('ws-1', [makeSurface('s-1', makeLeaf('p-1'))]);
      const ws2 = makeWorkspace('ws-2', [makeSurface('s-2', makeLeaf('p-2'))]);
      useWorkspaceStore.getState()._syncWorkspace(ws1);
      useWorkspaceStore.getState()._syncWorkspace(ws2);
      useWorkspaceStore.getState()._setActiveWorkspace('ws-1');
      useWorkspaceStore.getState()._removeWorkspace('ws-1');

      const state = useWorkspaceStore.getState();
      expect(state.activeWorkspaceId).toBe('ws-2');
    });

    it('sets activeWorkspaceId to null only when the last workspace is removed', () => {
      const ws = makeWorkspace('ws-1', [makeSurface('s-1', makeLeaf('p-1'))]);
      useWorkspaceStore.getState()._syncWorkspace(ws);
      useWorkspaceStore.getState()._setActiveWorkspace('ws-1');
      useWorkspaceStore.getState()._removeWorkspace('ws-1');

      const state = useWorkspaceStore.getState();
      expect(state.activeWorkspaceId).toBeNull();
    });

    it('does not clear activeWorkspaceId if removed workspace was not active', () => {
      const ws1 = makeWorkspace('ws-1', [makeSurface('s-1', makeLeaf('p-1'))]);
      const ws2 = makeWorkspace('ws-2', [makeSurface('s-2', makeLeaf('p-2'))]);
      useWorkspaceStore.getState()._syncWorkspace(ws1);
      useWorkspaceStore.getState()._syncWorkspace(ws2);
      useWorkspaceStore.getState()._setActiveWorkspace('ws-1');
      useWorkspaceStore.getState()._removeWorkspace('ws-2');

      const state = useWorkspaceStore.getState();
      expect(state.activeWorkspaceId).toBe('ws-1');
    });
  });

  describe('_setActiveWorkspace', () => {
    it('updates activeWorkspaceId', () => {
      const ws = makeWorkspace('ws-1', [makeSurface('s-1', makeLeaf('p-1'))]);
      useWorkspaceStore.getState()._syncWorkspace(ws);
      useWorkspaceStore.getState()._setActiveWorkspace('ws-1');

      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-1');
    });
  });

  describe('getActiveWorkspace', () => {
    it('returns the active workspace', () => {
      const ws = makeWorkspace('ws-1', [makeSurface('s-1', makeLeaf('p-1'))]);
      useWorkspaceStore.getState()._syncWorkspace(ws);
      useWorkspaceStore.getState()._setActiveWorkspace('ws-1');

      expect(useWorkspaceStore.getState().getActiveWorkspace()).toEqual(ws);
    });

    it('returns null when no active workspace', () => {
      expect(useWorkspaceStore.getState().getActiveWorkspace()).toBeNull();
    });
  });

  describe('getActiveSurface', () => {
    it('returns the active surface of the active workspace', () => {
      const surface = makeSurface('s-1', makeLeaf('p-1'));
      const ws = makeWorkspace('ws-1', [surface, makeSurface('s-2', makeLeaf('p-2'))], 0);
      useWorkspaceStore.getState()._syncWorkspace(ws);
      useWorkspaceStore.getState()._setActiveWorkspace('ws-1');

      expect(useWorkspaceStore.getState().getActiveSurface()).toEqual(surface);
    });

    it('returns null when no active workspace', () => {
      expect(useWorkspaceStore.getState().getActiveSurface()).toBeNull();
    });

    it('returns correct surface when activeSurfaceIndex > 0', () => {
      const surface2 = makeSurface('s-2', makeLeaf('p-2'));
      const ws = makeWorkspace('ws-1', [makeSurface('s-1', makeLeaf('p-1')), surface2], 1);
      useWorkspaceStore.getState()._syncWorkspace(ws);
      useWorkspaceStore.getState()._setActiveWorkspace('ws-1');

      expect(useWorkspaceStore.getState().getActiveSurface()).toEqual(surface2);
    });
  });

  describe('browserPaneUrls', () => {
    it('starts with empty browserPaneUrls', () => {
      expect(useWorkspaceStore.getState().browserPaneUrls).toEqual({});
    });

    it('_setBrowserPaneUrl stores url for a pane', () => {
      useWorkspaceStore.getState()._setBrowserPaneUrl('pane-1', 'https://example.com');
      expect(useWorkspaceStore.getState().browserPaneUrls['pane-1']).toBe('https://example.com');
    });

    it('_setBrowserPaneUrl overwrites existing url', () => {
      useWorkspaceStore.getState()._setBrowserPaneUrl('pane-1', 'https://example.com');
      useWorkspaceStore.getState()._setBrowserPaneUrl('pane-1', 'https://other.com');
      expect(useWorkspaceStore.getState().browserPaneUrls['pane-1']).toBe('https://other.com');
    });

    it('_setBrowserPaneUrl stores urls for multiple panes', () => {
      useWorkspaceStore.getState()._setBrowserPaneUrl('pane-1', 'https://example.com');
      useWorkspaceStore.getState()._setBrowserPaneUrl('pane-2', 'https://other.com');
      expect(useWorkspaceStore.getState().browserPaneUrls).toEqual({
        'pane-1': 'https://example.com',
        'pane-2': 'https://other.com',
      });
    });

    it('_removeBrowserPaneUrl removes pane url entry', () => {
      useWorkspaceStore.getState()._setBrowserPaneUrl('pane-1', 'https://example.com');
      useWorkspaceStore.getState()._removeBrowserPaneUrl('pane-1');
      expect(useWorkspaceStore.getState().browserPaneUrls['pane-1']).toBeUndefined();
    });

    it('_removeBrowserPaneUrl is a no-op for unknown pane', () => {
      useWorkspaceStore.getState()._setBrowserPaneUrl('pane-1', 'https://example.com');
      useWorkspaceStore.getState()._removeBrowserPaneUrl('pane-2');
      expect(useWorkspaceStore.getState().browserPaneUrls).toEqual({
        'pane-1': 'https://example.com',
      });
    });
  });

  describe('getActiveLayout', () => {
    it('returns the layout of the active surface', () => {
      const layout = makeLeaf('p-1');
      const ws = makeWorkspace('ws-1', [makeSurface('s-1', layout)]);
      useWorkspaceStore.getState()._syncWorkspace(ws);
      useWorkspaceStore.getState()._setActiveWorkspace('ws-1');

      expect(useWorkspaceStore.getState().getActiveLayout()).toEqual(layout);
    });

    it('returns null when no active workspace', () => {
      expect(useWorkspaceStore.getState().getActiveLayout()).toBeNull();
    });
  });

  describe('paneNames', () => {
    it('starts with empty paneNames and _nextPaneNumber = 1', () => {
      const state = useWorkspaceStore.getState();
      expect(state.paneNames).toEqual({});
      expect(state._nextPaneNumber).toBe(1);
    });

    it('_getOrAssignPaneName assigns "Terminal N" for new pane', () => {
      const name = useWorkspaceStore.getState()._getOrAssignPaneName('pane-1');
      expect(name).toBe('Terminal 1');
      expect(useWorkspaceStore.getState().paneNames['pane-1']).toBe('Terminal 1');
      expect(useWorkspaceStore.getState()._nextPaneNumber).toBe(2);
    });

    it('_getOrAssignPaneName returns existing name for known pane', () => {
      useWorkspaceStore.getState()._getOrAssignPaneName('pane-1');
      const name = useWorkspaceStore.getState()._getOrAssignPaneName('pane-1');
      expect(name).toBe('Terminal 1');
      expect(useWorkspaceStore.getState()._nextPaneNumber).toBe(2);
    });

    it('_getOrAssignPaneName increments counter for each new pane', () => {
      useWorkspaceStore.getState()._getOrAssignPaneName('pane-1');
      useWorkspaceStore.getState()._getOrAssignPaneName('pane-2');
      useWorkspaceStore.getState()._getOrAssignPaneName('pane-3');
      expect(useWorkspaceStore.getState().paneNames['pane-1']).toBe('Terminal 1');
      expect(useWorkspaceStore.getState().paneNames['pane-2']).toBe('Terminal 2');
      expect(useWorkspaceStore.getState().paneNames['pane-3']).toBe('Terminal 3');
      expect(useWorkspaceStore.getState()._nextPaneNumber).toBe(4);
    });

    it('_setPaneName sets name for a pane', () => {
      useWorkspaceStore.getState()._setPaneName('pane-1', 'My Terminal');
      expect(useWorkspaceStore.getState().paneNames['pane-1']).toBe('My Terminal');
    });

    it('_setPaneName overwrites existing name', () => {
      useWorkspaceStore.getState()._getOrAssignPaneName('pane-1');
      useWorkspaceStore.getState()._setPaneName('pane-1', 'Renamed');
      expect(useWorkspaceStore.getState().paneNames['pane-1']).toBe('Renamed');
    });

    it('_removePaneName deletes entry', () => {
      useWorkspaceStore.getState()._getOrAssignPaneName('pane-1');
      useWorkspaceStore.getState()._removePaneName('pane-1');
      expect(useWorkspaceStore.getState().paneNames['pane-1']).toBeUndefined();
    });

    it('_removePaneName is no-op for unknown pane', () => {
      useWorkspaceStore.getState()._removePaneName('unknown');
      expect(useWorkspaceStore.getState().paneNames).toEqual({});
    });
  });

  describe('orderedIds', () => {
    it('starts with empty orderedIds', () => {
      expect(useWorkspaceStore.getState().orderedIds).toEqual([]);
    });

    it('_syncWorkspace appends id to orderedIds', () => {
      const ws = makeWorkspace('ws-1', [makeSurface('s-1', makeLeaf('p-1'))]);
      useWorkspaceStore.getState()._syncWorkspace(ws);
      expect(useWorkspaceStore.getState().orderedIds).toEqual(['ws-1']);
    });

    it('_syncWorkspace does not duplicate id in orderedIds', () => {
      const ws = makeWorkspace('ws-1', [makeSurface('s-1', makeLeaf('p-1'))]);
      useWorkspaceStore.getState()._syncWorkspace(ws);
      const updated = { ...ws, name: 'Updated' };
      useWorkspaceStore.getState()._syncWorkspace(updated);
      expect(useWorkspaceStore.getState().orderedIds).toEqual(['ws-1']);
    });

    it('_removeWorkspace filters id from orderedIds', () => {
      const ws1 = makeWorkspace('ws-1', [makeSurface('s-1', makeLeaf('p-1'))]);
      const ws2 = makeWorkspace('ws-2', [makeSurface('s-2', makeLeaf('p-2'))]);
      useWorkspaceStore.getState()._syncWorkspace(ws1);
      useWorkspaceStore.getState()._syncWorkspace(ws2);
      useWorkspaceStore.getState()._removeWorkspace('ws-1');
      expect(useWorkspaceStore.getState().orderedIds).toEqual(['ws-2']);
    });

    it('_reorderWorkspaces updates orderedIds', () => {
      const ws1 = makeWorkspace('ws-1', [makeSurface('s-1', makeLeaf('p-1'))]);
      const ws2 = makeWorkspace('ws-2', [makeSurface('s-2', makeLeaf('p-2'))]);
      useWorkspaceStore.getState()._syncWorkspace(ws1);
      useWorkspaceStore.getState()._syncWorkspace(ws2);
      useWorkspaceStore.getState()._reorderWorkspaces(['ws-2', 'ws-1']);
      expect(useWorkspaceStore.getState().orderedIds).toEqual(['ws-2', 'ws-1']);
    });

    it('_removeWorkspace uses orderedIds for fallback active', () => {
      const ws1 = makeWorkspace('ws-1', [makeSurface('s-1', makeLeaf('p-1'))]);
      const ws2 = makeWorkspace('ws-2', [makeSurface('s-2', makeLeaf('p-2'))]);
      const ws3 = makeWorkspace('ws-3', [makeSurface('s-3', makeLeaf('p-3'))]);
      useWorkspaceStore.getState()._syncWorkspace(ws1);
      useWorkspaceStore.getState()._syncWorkspace(ws2);
      useWorkspaceStore.getState()._syncWorkspace(ws3);
      useWorkspaceStore.getState()._reorderWorkspaces(['ws-3', 'ws-1', 'ws-2']);
      useWorkspaceStore.getState()._setActiveWorkspace('ws-1');
      useWorkspaceStore.getState()._removeWorkspace('ws-1');
      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-3');
    });
  });

  describe('getActiveWorkspace edge cases', () => {
    it('returns null when activeWorkspaceId points to nonexistent workspace', () => {
      useWorkspaceStore.setState({ activeWorkspaceId: 'nonexistent' });
      expect(useWorkspaceStore.getState().getActiveWorkspace()).toBeNull();
    });
  });

  describe('getActiveSurface edge cases', () => {
    it('returns null when activeSurfaceIndex is out of range', () => {
      const ws = makeWorkspace('ws-1', [makeSurface('s-1', makeLeaf('p-1'))], 5);
      useWorkspaceStore.getState()._syncWorkspace(ws);
      useWorkspaceStore.getState()._setActiveWorkspace('ws-1');
      expect(useWorkspaceStore.getState().getActiveSurface()).toBeNull();
    });
  });

  describe('getActiveLayout edge cases', () => {
    it('returns null when getActiveSurface returns null', () => {
      const ws = makeWorkspace('ws-1', [makeSurface('s-1', makeLeaf('p-1'))], 99);
      useWorkspaceStore.getState()._syncWorkspace(ws);
      useWorkspaceStore.getState()._setActiveWorkspace('ws-1');
      expect(useWorkspaceStore.getState().getActiveLayout()).toBeNull();
    });
  });

  describe('_syncWorkspace orderedIds behavior', () => {
    it('preserves existing orderedIds when re-syncing existing workspace', () => {
      const ws1 = makeWorkspace('ws-1', [makeSurface('s-1', makeLeaf('p-1'))]);
      const ws2 = makeWorkspace('ws-2', [makeSurface('s-2', makeLeaf('p-2'))]);
      useWorkspaceStore.getState()._syncWorkspace(ws1);
      useWorkspaceStore.getState()._syncWorkspace(ws2);

      // Re-sync ws1 should not duplicate or change order
      useWorkspaceStore.getState()._syncWorkspace({ ...ws1, name: 'Updated' });
      expect(useWorkspaceStore.getState().orderedIds).toEqual(['ws-1', 'ws-2']);
    });

    it('appends new workspace id to orderedIds', () => {
      const ws1 = makeWorkspace('ws-1', [makeSurface('s-1', makeLeaf('p-1'))]);
      const ws2 = makeWorkspace('ws-2', [makeSurface('s-2', makeLeaf('p-2'))]);
      const ws3 = makeWorkspace('ws-3', [makeSurface('s-3', makeLeaf('p-3'))]);
      useWorkspaceStore.getState()._syncWorkspace(ws1);
      useWorkspaceStore.getState()._syncWorkspace(ws2);
      useWorkspaceStore.getState()._syncWorkspace(ws3);
      expect(useWorkspaceStore.getState().orderedIds).toEqual(['ws-1', 'ws-2', 'ws-3']);
    });
  });

  describe('_removeWorkspace edge cases', () => {
    it('removing nonexistent workspace does not change state', () => {
      const ws1 = makeWorkspace('ws-1', [makeSurface('s-1', makeLeaf('p-1'))]);
      useWorkspaceStore.getState()._syncWorkspace(ws1);
      useWorkspaceStore.getState()._setActiveWorkspace('ws-1');
      useWorkspaceStore.getState()._removeWorkspace('nonexistent');

      expect(useWorkspaceStore.getState().activeWorkspaceId).toBe('ws-1');
      expect(useWorkspaceStore.getState().orderedIds).toEqual(['ws-1']);
    });
  });

  describe('_reorderWorkspaces', () => {
    it('replaces orderedIds completely', () => {
      const ws1 = makeWorkspace('ws-1', [makeSurface('s-1', makeLeaf('p-1'))]);
      const ws2 = makeWorkspace('ws-2', [makeSurface('s-2', makeLeaf('p-2'))]);
      useWorkspaceStore.getState()._syncWorkspace(ws1);
      useWorkspaceStore.getState()._syncWorkspace(ws2);
      useWorkspaceStore.getState()._reorderWorkspaces(['ws-2', 'ws-1']);
      expect(useWorkspaceStore.getState().orderedIds).toEqual(['ws-2', 'ws-1']);
    });
  });

  describe('_getOrAssignPaneName counter', () => {
    it('counter increments by exactly 1 for each new pane', () => {
      useWorkspaceStore.getState()._getOrAssignPaneName('pane-a');
      expect(useWorkspaceStore.getState()._nextPaneNumber).toBe(2);
      useWorkspaceStore.getState()._getOrAssignPaneName('pane-b');
      expect(useWorkspaceStore.getState()._nextPaneNumber).toBe(3);
    });

    it('counter does not increment when returning existing name', () => {
      useWorkspaceStore.getState()._getOrAssignPaneName('pane-a');
      const counterAfterFirst = useWorkspaceStore.getState()._nextPaneNumber;
      useWorkspaceStore.getState()._getOrAssignPaneName('pane-a');
      expect(useWorkspaceStore.getState()._nextPaneNumber).toBe(counterAfterFirst);
    });
  });
});
