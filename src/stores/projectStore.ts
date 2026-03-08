import { create } from 'zustand';
import type { ProjectInfo } from '../lib/workspace-types';

interface ProjectStoreState {
  projects: Record<string, ProjectInfo>;
  activeProjectId: string | null;
  orderedProjectIds: string[];
  getActiveProject: () => ProjectInfo | null;
  _syncProjects: (projects: ProjectInfo[]) => void;
  _addProject: (project: ProjectInfo) => void;
  _removeProject: (id: string) => void;
  _setActiveProject: (id: string | null) => void;
}

export const useProjectStore = create<ProjectStoreState>((set, get) => ({
  projects: {},
  activeProjectId: null,
  orderedProjectIds: [],

  getActiveProject: () => {
    const { projects, activeProjectId } = get();
    if (!activeProjectId) return null;
    return projects[activeProjectId] ?? null;
  },

  _syncProjects: (projects) => {
    const projectMap: Record<string, ProjectInfo> = {};
    const ids: string[] = [];
    for (const p of projects) {
      projectMap[p.id] = p;
      ids.push(p.id);
    }
    set({ projects: projectMap, orderedProjectIds: ids });
  },

  _addProject: (project) => {
    set((state) => {
      const orderedProjectIds = state.orderedProjectIds.includes(project.id)
        ? state.orderedProjectIds
        : [...state.orderedProjectIds, project.id];
      return {
        projects: { ...state.projects, [project.id]: project },
        orderedProjectIds,
      };
    });
  },

  _removeProject: (id) => {
    set((state) => {
      const projects = Object.fromEntries(
        Object.entries(state.projects).filter(([key]) => key !== id),
      );
      const orderedProjectIds = state.orderedProjectIds.filter((pid) => pid !== id);
      let activeProjectId = state.activeProjectId;
      if (activeProjectId === id) {
        activeProjectId = orderedProjectIds[0] ?? null;
      }
      return { projects, orderedProjectIds, activeProjectId };
    });
  },

  _setActiveProject: (id) => {
    set({ activeProjectId: id });
  },
}));
