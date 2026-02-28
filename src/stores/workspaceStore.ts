import { create } from 'zustand';
import type { WorkspaceInfo, SurfaceInfo, LayoutNode } from '../lib/workspace-types';

interface WorkspaceStoreState {
  workspaces: Record<string, WorkspaceInfo>;
  activeWorkspaceId: string | null;
  browserPaneUrls: Record<string, string>;
  getActiveWorkspace: () => WorkspaceInfo | null;
  getActiveSurface: () => SurfaceInfo | null;
  getActiveLayout: () => LayoutNode | null;
  _syncWorkspace: (workspace: WorkspaceInfo) => void;
  _removeWorkspace: (id: string) => void;
  _setActiveWorkspace: (id: string) => void;
  _setBrowserPaneUrl: (paneId: string, url: string) => void;
}

export const useWorkspaceStore = create<WorkspaceStoreState>((set, get) => ({
  workspaces: {},
  activeWorkspaceId: null,
  browserPaneUrls: {},

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
    set((state) => ({
      workspaces: { ...state.workspaces, [workspace.id]: workspace },
    }));
  },

  _removeWorkspace: (id) => {
    set((state) => {
      const workspaces = Object.fromEntries(
        Object.entries(state.workspaces).filter(([key]) => key !== id),
      );
      return {
        workspaces,
        activeWorkspaceId: state.activeWorkspaceId === id ? null : state.activeWorkspaceId,
      };
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
}));
