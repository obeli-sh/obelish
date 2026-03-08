import type { LayoutNode, PaneDropPosition, SplitDirection, WorkspaceInfo } from './workspace-types';

interface MockState {
  workspaces: WorkspaceInfo[];
  activeWorkspaceId: string | null;
}

interface MockCounters {
  workspace: number;
  surface: number;
  pane: number;
  pty: number;
}

function mockSettings() {
  return {
    keybindings: {},
    theme: 'dark',
    terminalFontFamily: 'Menlo, Monaco, "Courier New", monospace',
    terminalFontSize: 14,
    scrollbackLines: 5000,
  };
}

function mockShells() {
  return [
    { path: '', name: 'Auto-detect' },
    { path: '/bin/bash', name: 'Bash' },
  ];
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function collectPaneIds(layout: LayoutNode, target: Set<string>) {
  if (layout.type === 'leaf') {
    target.add(layout.paneId);
    return;
  }
  collectPaneIds(layout.children[0], target);
  collectPaneIds(layout.children[1], target);
}

function layoutContainsPane(layout: LayoutNode, paneId: string): boolean {
  if (layout.type === 'leaf') {
    return layout.paneId === paneId;
  }
  return layoutContainsPane(layout.children[0], paneId) || layoutContainsPane(layout.children[1], paneId);
}

function findLayoutPtyId(layout: LayoutNode, paneId: string): string | null {
  if (layout.type === 'leaf') {
    return layout.paneId === paneId ? layout.ptyId : null;
  }
  return findLayoutPtyId(layout.children[0], paneId) ?? findLayoutPtyId(layout.children[1], paneId);
}

function swapLayoutPanes(
  layout: LayoutNode,
  paneId: string,
  targetPaneId: string,
  sourcePtyId: string,
  targetPtyId: string,
) {
  if (layout.type === 'leaf') {
    if (layout.paneId === paneId) {
      layout.paneId = targetPaneId;
      layout.ptyId = targetPtyId;
      return;
    }
    if (layout.paneId === targetPaneId) {
      layout.paneId = paneId;
      layout.ptyId = sourcePtyId;
    }
    return;
  }
  swapLayoutPanes(layout.children[0], paneId, targetPaneId, sourcePtyId, targetPtyId);
  swapLayoutPanes(layout.children[1], paneId, targetPaneId, sourcePtyId, targetPtyId);
}

function splitLayout(
  layout: LayoutNode,
  paneId: string,
  direction: SplitDirection,
  newLeaf: LayoutNode,
): { layout: LayoutNode; didSplit: boolean } {
  if (layout.type === 'leaf') {
    if (layout.paneId !== paneId) {
      return { layout, didSplit: false };
    }
    return {
      didSplit: true,
      layout: {
        type: 'split',
        direction,
        children: [layout, newLeaf],
        sizes: [0.5, 0.5],
      },
    };
  }

  const left = splitLayout(layout.children[0], paneId, direction, newLeaf);
  if (left.didSplit) {
    return {
      didSplit: true,
      layout: { ...layout, children: [left.layout, layout.children[1]] },
    };
  }

  const right = splitLayout(layout.children[1], paneId, direction, newLeaf);
  if (right.didSplit) {
    return {
      didSplit: true,
      layout: { ...layout, children: [layout.children[0], right.layout] },
    };
  }

  return { layout, didSplit: false };
}

function closePaneFromLayout(
  layout: LayoutNode,
  paneId: string,
): { layout: LayoutNode | null; didClose: boolean } {
  if (layout.type === 'leaf') {
    if (layout.paneId !== paneId) {
      return { layout, didClose: false };
    }
    return { layout: null, didClose: true };
  }

  const left = closePaneFromLayout(layout.children[0], paneId);
  if (left.didClose) {
    if (left.layout === null) {
      return { layout: layout.children[1], didClose: true };
    }
    return {
      didClose: true,
      layout: { ...layout, children: [left.layout, layout.children[1]] },
    };
  }

  const right = closePaneFromLayout(layout.children[1], paneId);
  if (right.didClose) {
    if (right.layout === null) {
      return { layout: layout.children[0], didClose: true };
    }
    return {
      didClose: true,
      layout: { ...layout, children: [layout.children[0], right.layout] },
    };
  }

  return { layout, didClose: false };
}

function insertPaneRelativeToTarget(
  layout: LayoutNode,
  targetPaneId: string,
  sourceLeaf: LayoutNode,
  position: Exclude<PaneDropPosition, 'center'>,
): { layout: LayoutNode; didInsert: boolean } {
  if (layout.type === 'leaf') {
    if (layout.paneId !== targetPaneId) {
      return { layout, didInsert: false };
    }
    switch (position) {
      case 'left':
        return {
          didInsert: true,
          layout: {
            type: 'split',
            direction: 'horizontal',
            children: [sourceLeaf, layout],
            sizes: [0.5, 0.5],
          },
        };
      case 'right':
        return {
          didInsert: true,
          layout: {
            type: 'split',
            direction: 'horizontal',
            children: [layout, sourceLeaf],
            sizes: [0.5, 0.5],
          },
        };
      case 'top':
        return {
          didInsert: true,
          layout: {
            type: 'split',
            direction: 'vertical',
            children: [sourceLeaf, layout],
            sizes: [0.5, 0.5],
          },
        };
      case 'bottom':
        return {
          didInsert: true,
          layout: {
            type: 'split',
            direction: 'vertical',
            children: [layout, sourceLeaf],
            sizes: [0.5, 0.5],
          },
        };
    }
  }

  const left = insertPaneRelativeToTarget(layout.children[0], targetPaneId, sourceLeaf, position);
  if (left.didInsert) {
    return {
      didInsert: true,
      layout: { ...layout, children: [left.layout, layout.children[1]] },
    };
  }

  const right = insertPaneRelativeToTarget(layout.children[1], targetPaneId, sourceLeaf, position);
  if (right.didInsert) {
    return {
      didInsert: true,
      layout: { ...layout, children: [layout.children[0], right.layout] },
    };
  }

  return { layout, didInsert: false };
}

function createStateAndIds() {
  const counters: MockCounters = {
    workspace: 1,
    surface: 1,
    pane: 1,
    pty: 1,
  };

  const nextWorkspaceId = () => `mock-ws-${counters.workspace++}`;
  const nextSurfaceId = () => `mock-surface-${counters.surface++}`;
  const nextPaneId = () => `mock-pane-${counters.pane++}`;
  const nextPtyId = () => `mock-pty-${counters.pty++}`;

  const createTerminalLeaf = (): LayoutNode => ({
    type: 'leaf',
    paneId: nextPaneId(),
    ptyId: nextPtyId(),
  });

  const createBrowserLeaf = (): LayoutNode => ({
    type: 'leaf',
    paneId: nextPaneId(),
    ptyId: '',
  });

  const createWorkspace = (name?: string): WorkspaceInfo => ({
    id: nextWorkspaceId(),
    name: name ?? `Workspace ${counters.workspace - 1}`,
    projectId: '',
    worktreePath: '',
    branchName: null,
    isRootWorktree: false,
    surfaces: [
      {
        id: nextSurfaceId(),
        name: 'Surface 1',
        layout: createTerminalLeaf(),
      },
    ],
    activeSurfaceIndex: 0,
    createdAt: Date.now(),
  });

  const initialWorkspace = createWorkspace();

  const state: MockState = {
    workspaces: [initialWorkspace],
    activeWorkspaceId: initialWorkspace.id,
  };

  const getWorkspaceById = (workspaceId: string) =>
    state.workspaces.find((workspace) => workspace.id === workspaceId) ?? null;

  const getActiveWorkspace = () => {
    if (!state.activeWorkspaceId) return null;
    return getWorkspaceById(state.activeWorkspaceId);
  };

  const getWorkspaceByPaneId = (paneId: string) => {
    const found = state.workspaces.find((workspace) =>
      workspace.surfaces.some((surface) => {
        const paneIds = new Set<string>();
        collectPaneIds(surface.layout, paneIds);
        return paneIds.has(paneId);
      }),
    );
    return found ?? null;
  };

  const ensureWorkspaceExists = () => {
    if (state.workspaces.length > 0) {
      if (!state.activeWorkspaceId) {
        state.activeWorkspaceId = state.workspaces[0].id;
      }
      return;
    }
    const workspace = createWorkspace();
    state.workspaces.push(workspace);
    state.activeWorkspaceId = workspace.id;
  };

  const reorderWorkspaces = (workspaceIds: string[]) => {
    if (workspaceIds.length === 0) return;
    const byId = new Map(state.workspaces.map((workspace) => [workspace.id, workspace]));
    const ordered = workspaceIds
      .map((workspaceId) => byId.get(workspaceId))
      .filter((workspace): workspace is WorkspaceInfo => Boolean(workspace));
    const remaining = state.workspaces.filter((workspace) => !workspaceIds.includes(workspace.id));
    state.workspaces = [...ordered, ...remaining];
  };

  const ensureActiveWorkspaceAfterClose = () => {
    if (state.workspaces.length === 0) {
      state.activeWorkspaceId = null;
      return;
    }
    if (state.activeWorkspaceId && state.workspaces.some((workspace) => workspace.id === state.activeWorkspaceId)) {
      return;
    }
    state.activeWorkspaceId = state.workspaces[0].id;
  };

  return {
    state,
    createWorkspace,
    createTerminalLeaf,
    createBrowserLeaf,
    getActiveWorkspace,
    getWorkspaceById,
    getWorkspaceByPaneId,
    ensureWorkspaceExists,
    reorderWorkspaces,
    ensureActiveWorkspaceAfterClose,
    nextPtyId,
  };
}

let mockRuntime = createStateAndIds();

export function resetMockState() {
  mockRuntime = createStateAndIds();
}

export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

const handlers: Record<string, (args?: Record<string, unknown>) => unknown> = {
  session_restore: () => {
    mockRuntime.ensureWorkspaceExists();
    return deepClone(mockRuntime.state.workspaces);
  },
  session_save: () => undefined,
  settings_get: () => mockSettings(),
  settings_update: () => undefined,
  settings_reset: () => undefined,
  shell_list: () => mockShells(),
  workspace_create: (args) => {
    const name = typeof args?.name === 'string' ? args.name : undefined;
    const workspace = mockRuntime.createWorkspace(name);
    mockRuntime.state.workspaces.push(workspace);
    mockRuntime.state.activeWorkspaceId = workspace.id;
    return deepClone(workspace);
  },
  workspace_close: (args) => {
    const workspaceId = typeof args?.workspaceId === 'string' ? args.workspaceId : null;
    if (!workspaceId) return undefined;
    mockRuntime.state.workspaces = mockRuntime.state.workspaces.filter((workspace) => workspace.id !== workspaceId);
    if (mockRuntime.state.activeWorkspaceId === workspaceId) {
      mockRuntime.state.activeWorkspaceId = null;
    }
    mockRuntime.ensureActiveWorkspaceAfterClose();
    return undefined;
  },
  workspace_rename: (args) => {
    const workspaceId = typeof args?.workspaceId === 'string' ? args.workspaceId : null;
    const newName = typeof args?.newName === 'string' ? args.newName.trim() : '';
    if (!workspaceId || !newName) {
      return deepClone(mockRuntime.getActiveWorkspace() ?? mockRuntime.createWorkspace());
    }
    const workspace = mockRuntime.getWorkspaceById(workspaceId);
    if (!workspace) {
      return deepClone(mockRuntime.getActiveWorkspace() ?? mockRuntime.createWorkspace());
    }
    workspace.name = newName;
    return deepClone(workspace);
  },
  workspace_list: () => {
    mockRuntime.ensureWorkspaceExists();
    return deepClone(mockRuntime.state.workspaces);
  },
  workspace_reorder: (args) => {
    const workspaceIds = Array.isArray(args?.workspaceIds)
      ? args.workspaceIds.filter((id): id is string => typeof id === 'string')
      : [];
    mockRuntime.reorderWorkspaces(workspaceIds);
    return undefined;
  },
  pty_spawn: () => ({ ptyId: mockRuntime.nextPtyId() }),
  pty_write: () => undefined,
  pty_resize: () => undefined,
  pty_kill: () => undefined,
  pane_split: (args) => {
    const paneId = typeof args?.paneId === 'string' ? args.paneId : null;
    const direction = args?.direction === 'horizontal' || args?.direction === 'vertical'
      ? args.direction
      : null;
    if (!paneId || !direction) {
      return deepClone(mockRuntime.getActiveWorkspace() ?? mockRuntime.createWorkspace());
    }
    const workspace = mockRuntime.getWorkspaceByPaneId(paneId);
    if (!workspace) {
      return deepClone(mockRuntime.getActiveWorkspace() ?? mockRuntime.createWorkspace());
    }
    const surface = workspace.surfaces[workspace.activeSurfaceIndex];
    if (!surface) {
      return deepClone(workspace);
    }
    const split = splitLayout(surface.layout, paneId, direction, mockRuntime.createTerminalLeaf());
    if (split.didSplit) {
      surface.layout = split.layout;
    }
    mockRuntime.state.activeWorkspaceId = workspace.id;
    return deepClone(workspace);
  },
  pane_close: (args) => {
    const paneId = typeof args?.paneId === 'string' ? args.paneId : null;
    if (!paneId) return undefined;
    const workspace = mockRuntime.getWorkspaceByPaneId(paneId);
    if (!workspace) return undefined;
    const surface = workspace.surfaces[workspace.activeSurfaceIndex];
    if (!surface) return undefined;
    const closed = closePaneFromLayout(surface.layout, paneId);
    if (closed.didClose) {
      surface.layout = closed.layout ?? mockRuntime.createTerminalLeaf();
    }
    mockRuntime.state.activeWorkspaceId = workspace.id;
    return undefined;
  },
  pane_open_browser: (args) => {
    const paneId = typeof args?.paneId === 'string' ? args.paneId : null;
    const direction = args?.direction === 'horizontal' || args?.direction === 'vertical'
      ? args.direction
      : null;
    if (!paneId || !direction) {
      return deepClone(mockRuntime.getActiveWorkspace() ?? mockRuntime.createWorkspace());
    }
    const workspace = mockRuntime.getWorkspaceByPaneId(paneId);
    if (!workspace) {
      return deepClone(mockRuntime.getActiveWorkspace() ?? mockRuntime.createWorkspace());
    }
    const surface = workspace.surfaces[workspace.activeSurfaceIndex];
    if (!surface) {
      return deepClone(workspace);
    }
    const split = splitLayout(surface.layout, paneId, direction, mockRuntime.createBrowserLeaf());
    if (split.didSplit) {
      surface.layout = split.layout;
    }
    mockRuntime.state.activeWorkspaceId = workspace.id;
    return deepClone(workspace);
  },
  pane_swap: (args) => {
    const paneId = typeof args?.paneId === 'string' ? args.paneId : null;
    const targetPaneId = typeof args?.targetPaneId === 'string' ? args.targetPaneId : null;
    if (!paneId || !targetPaneId || paneId === targetPaneId) {
      return deepClone(mockRuntime.getActiveWorkspace() ?? mockRuntime.createWorkspace());
    }

    const sourceWorkspace = mockRuntime.getWorkspaceByPaneId(paneId);
    const targetWorkspace = mockRuntime.getWorkspaceByPaneId(targetPaneId);
    if (!sourceWorkspace || !targetWorkspace || sourceWorkspace.id !== targetWorkspace.id) {
      return deepClone(mockRuntime.getActiveWorkspace() ?? mockRuntime.createWorkspace());
    }

    const sourcePtyId = sourceWorkspace.surfaces
      .map((surface) => findLayoutPtyId(surface.layout, paneId))
      .find((ptyId): ptyId is string => ptyId !== null);
    const targetPtyId = sourceWorkspace.surfaces
      .map((surface) => findLayoutPtyId(surface.layout, targetPaneId))
      .find((ptyId): ptyId is string => ptyId !== null);

    if (!sourcePtyId || !targetPtyId) {
      return deepClone(sourceWorkspace);
    }

    for (const surface of sourceWorkspace.surfaces) {
      if (layoutContainsPane(surface.layout, paneId) || layoutContainsPane(surface.layout, targetPaneId)) {
        swapLayoutPanes(surface.layout, paneId, targetPaneId, sourcePtyId, targetPtyId);
      }
    }
    mockRuntime.state.activeWorkspaceId = sourceWorkspace.id;
    return deepClone(sourceWorkspace);
  },
  pane_move: (args) => {
    const paneId = typeof args?.paneId === 'string' ? args.paneId : null;
    const targetPaneId = typeof args?.targetPaneId === 'string' ? args.targetPaneId : null;
    const position = args?.position;
    if (
      !paneId
      || !targetPaneId
      || paneId === targetPaneId
      || (position !== 'left' && position !== 'right' && position !== 'top' && position !== 'bottom' && position !== 'center')
    ) {
      return deepClone(mockRuntime.getActiveWorkspace() ?? mockRuntime.createWorkspace());
    }

    if (position === 'center') {
      return handlers.pane_swap({ paneId, targetPaneId });
    }

    const sourceWorkspace = mockRuntime.getWorkspaceByPaneId(paneId);
    const targetWorkspace = mockRuntime.getWorkspaceByPaneId(targetPaneId);
    if (!sourceWorkspace || !targetWorkspace || sourceWorkspace.id !== targetWorkspace.id) {
      return deepClone(mockRuntime.getActiveWorkspace() ?? mockRuntime.createWorkspace());
    }

    const sourceSurfaceIdx = sourceWorkspace.surfaces.findIndex((surface) => layoutContainsPane(surface.layout, paneId));
    const targetSurfaceIdx = sourceWorkspace.surfaces.findIndex((surface) => layoutContainsPane(surface.layout, targetPaneId));
    if (sourceSurfaceIdx < 0 || targetSurfaceIdx < 0 || sourceSurfaceIdx !== targetSurfaceIdx) {
      return deepClone(sourceWorkspace);
    }

    const sourceSurface = sourceWorkspace.surfaces[sourceSurfaceIdx];
    const sourcePtyId = findLayoutPtyId(sourceSurface.layout, paneId);
    if (sourcePtyId === null) {
      return deepClone(sourceWorkspace);
    }

    const removed = closePaneFromLayout(sourceSurface.layout, paneId);
    if (!removed.didClose || removed.layout === null) {
      return deepClone(sourceWorkspace);
    }

    const inserted = insertPaneRelativeToTarget(
      removed.layout,
      targetPaneId,
      { type: 'leaf', paneId, ptyId: sourcePtyId },
      position,
    );
    if (!inserted.didInsert) {
      return deepClone(sourceWorkspace);
    }

    sourceSurface.layout = inserted.layout;
    mockRuntime.state.activeWorkspaceId = sourceWorkspace.id;
    return deepClone(sourceWorkspace);
  },
  scrollback_save: () => undefined,
  scrollback_load: () => null,
  notification_list: () => [],
  notification_mark_read: () => undefined,
  notification_clear: () => undefined,
  project_list: () => [],
  project_add: () => ({ id: 'mock-project-1', name: 'mock-project', rootPath: '/mock/path' }),
  project_remove: () => undefined,
  worktree_list: () => [{ path: '/mock/path', branch: 'main', isMain: true }],
  worktree_create: () => ({ path: '/mock/path/worktree', branch: 'new-branch', isMain: false }),
  list_directories: () => [],
};

export async function mockInvoke(cmd: string, args?: Record<string, unknown>): Promise<unknown> {
  const handler = handlers[cmd];
  if (handler) return handler(args);
  return undefined;
}

export async function mockListen(
  event: string,
  handler: (event: { payload: unknown }) => void,
): Promise<() => void> {
  void event;
  void handler;
  return () => {};
}
