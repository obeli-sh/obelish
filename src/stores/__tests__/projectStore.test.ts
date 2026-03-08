import { describe, it, expect, beforeEach } from 'vitest';
import { useProjectStore } from '../projectStore';

function makeProject(overrides: Partial<{ id: string; name: string; rootPath: string }> = {}) {
  return {
    id: overrides.id ?? 'proj-1',
    name: overrides.name ?? 'my-project',
    rootPath: overrides.rootPath ?? '/home/user/my-project',
  };
}

describe('projectStore', () => {
  beforeEach(() => {
    useProjectStore.setState({
      projects: {},
      activeProjectId: null,
      orderedProjectIds: [],
    });
  });

  it('starts empty', () => {
    const state = useProjectStore.getState();
    expect(state.orderedProjectIds).toEqual([]);
    expect(state.activeProjectId).toBeNull();
  });

  it('_addProject adds a project', () => {
    const project = makeProject();
    useProjectStore.getState()._addProject(project);
    const state = useProjectStore.getState();
    expect(state.projects['proj-1']).toEqual(project);
    expect(state.orderedProjectIds).toEqual(['proj-1']);
  });

  it('_addProject is idempotent', () => {
    const project = makeProject();
    useProjectStore.getState()._addProject(project);
    useProjectStore.getState()._addProject(project);
    expect(useProjectStore.getState().orderedProjectIds).toEqual(['proj-1']);
  });

  it('_removeProject removes a project', () => {
    useProjectStore.getState()._addProject(makeProject());
    useProjectStore.getState()._removeProject('proj-1');
    expect(useProjectStore.getState().orderedProjectIds).toEqual([]);
    expect(useProjectStore.getState().projects['proj-1']).toBeUndefined();
  });

  it('_removeProject switches active if removed', () => {
    useProjectStore.getState()._addProject(makeProject({ id: 'p1' }));
    useProjectStore.getState()._addProject(makeProject({ id: 'p2' }));
    useProjectStore.getState()._setActiveProject('p1');
    useProjectStore.getState()._removeProject('p1');
    expect(useProjectStore.getState().activeProjectId).toBe('p2');
  });

  it('_removeProject sets null if last removed', () => {
    useProjectStore.getState()._addProject(makeProject({ id: 'p1' }));
    useProjectStore.getState()._setActiveProject('p1');
    useProjectStore.getState()._removeProject('p1');
    expect(useProjectStore.getState().activeProjectId).toBeNull();
  });

  it('_setActiveProject sets the active project', () => {
    useProjectStore.getState()._addProject(makeProject());
    useProjectStore.getState()._setActiveProject('proj-1');
    expect(useProjectStore.getState().activeProjectId).toBe('proj-1');
  });

  it('getActiveProject returns active project', () => {
    const project = makeProject();
    useProjectStore.getState()._addProject(project);
    useProjectStore.getState()._setActiveProject('proj-1');
    expect(useProjectStore.getState().getActiveProject()).toEqual(project);
  });

  it('getActiveProject returns null when none active', () => {
    expect(useProjectStore.getState().getActiveProject()).toBeNull();
  });

  it('_syncProjects replaces all projects', () => {
    useProjectStore.getState()._addProject(makeProject({ id: 'old' }));
    useProjectStore.getState()._syncProjects([
      makeProject({ id: 'p1', name: 'Project 1' }),
      makeProject({ id: 'p2', name: 'Project 2' }),
    ]);
    const state = useProjectStore.getState();
    expect(state.orderedProjectIds).toEqual(['p1', 'p2']);
    expect(state.projects['old']).toBeUndefined();
    expect(state.projects['p1'].name).toBe('Project 1');
  });

  it('_removeProject nonexistent is no-op', () => {
    useProjectStore.getState()._addProject(makeProject());
    useProjectStore.getState()._removeProject('nonexistent');
    expect(useProjectStore.getState().orderedProjectIds).toEqual(['proj-1']);
  });
});
