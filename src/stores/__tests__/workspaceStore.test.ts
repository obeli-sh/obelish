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

    it('sets activeWorkspaceId to null if removed workspace was active', () => {
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
});
