import { create } from 'zustand';
import type { WorkspaceInfo, SurfaceInfo, LayoutNode } from '../lib/workspace-types';

interface WorkspaceStoreState {
  workspaces: Record<string, WorkspaceInfo>;
  activeWorkspaceId: string | null;
  orderedIds: string[];
  browserPaneUrls: Record<string, string>;
  paneNames: Record<string, string>;
  _nextPaneNumber: number;
  getActiveWorkspace: () => WorkspaceInfo | null;
  getActiveSurface: () => SurfaceInfo | null;
  getActiveLayout: () => LayoutNode | null;
  _syncWorkspace: (workspace: WorkspaceInfo) => void;
  _removeWorkspace: (id: string) => void;
  _setActiveWorkspace: (id: string) => void;
  _setBrowserPaneUrl: (paneId: string, url: string) => void;
  _removeBrowserPaneUrl: (paneId: string) => void;
  _reorderWorkspaces: (ids: string[]) => void;
  _setPaneName: (paneId: string, name: string) => void;
  _getOrAssignPaneName: (paneId: string) => string;
  _removePaneName: (paneId: string) => void;
}

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => ({
  workspaces: {},
  activeWorkspaceId: null,
  orderedIds: [],
  browserPaneUrls: {},
  paneNames: {},
  _nextPaneNumber: 1,

  getActiveWorkspace: () => {
    const { workspaces, activeWorkspaceId } = get();
    if (!activeWorkspaceId) return null;
    return workspaces[activeWorkspaceId] ?? null;
  },

  getActiveSurface: () => {
    const workspace = get().getActiveWorkspace();
    if (!workspace) return null;
    return workspace.surfaces[workspace.activeSurfaceIndex] ?? null;
  },

  getActiveLayout: () => {
    const surface = get().getActiveSurface();
    if (!surface) return null;
    return surface.layout;
  },

  _syncWorkspace: (workspace) => {
    set((state) => {
      const orderedIds = state.orderedIds.includes(workspace.id)
        ? state.orderedIds
        : [...state.orderedIds, workspace.id];
      return {
        workspaces: { ...state.workspaces, [workspace.id]: workspace },
        orderedIds,
      };
    });
  },

  _removeWorkspace: (id) => {
    set((state) => {
      const workspaces = Object.fromEntries(
        Object.entries(state.workspaces).filter(([key]) => key !== id),
      );
      const orderedIds = state.orderedIds.filter((wsId) => wsId !== id);
      let activeWorkspaceId = state.activeWorkspaceId;
      if (activeWorkspaceId === id) {
        activeWorkspaceId = orderedIds[0] ?? null;
      }
      return { workspaces, activeWorkspaceId, orderedIds };
    });
  },

  _setActiveWorkspace: (id) => {
    set({ activeWorkspaceId: id });
  },

  _setBrowserPaneUrl: (paneId, url) => {
    set((state) => ({
      browserPaneUrls: { ...state.browserPaneUrls, [paneId]: url },
    }));
  },

  _removeBrowserPaneUrl: (paneId) => {
    set((state) => {
      const next = { ...state.browserPaneUrls };
      delete next[paneId];
      return { browserPaneUrls: next };
    });
  },

  _reorderWorkspaces: (ids) => {
    set({ orderedIds: ids });
  },

  _setPaneName: (paneId, name) => {
    set((state) => ({
      paneNames: { ...state.paneNames, [paneId]: name },
    }));
  },

  _getOrAssignPaneName: (paneId) => {
    const { paneNames, _nextPaneNumber } = get();
    if (paneNames[paneId]) return paneNames[paneId];
    const name = `Terminal ${_nextPaneNumber}`;
    set({
      paneNames: { ...paneNames, [paneId]: name },
      _nextPaneNumber: _nextPaneNumber + 1,
    });
    return name;
  },

  _removePaneName: (paneId) => {
    set((state) => {
      const next = { ...state.paneNames };
      delete next[paneId];
      return { paneNames: next };
    });
  },
}));
