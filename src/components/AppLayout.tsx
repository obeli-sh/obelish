import { useCallback, useEffect, useState } from 'react';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useUiStore } from '../stores/uiStore';
import { useSettingsStore, type RustSettings } from '../stores/settingsStore';
import { useProjectStore } from '../stores/projectStore';
import { Sidebar } from './sidebar/Sidebar';
import { SurfaceTabBar } from './layout/SurfaceTabBar';
import { PaneSplitter } from './layout/PaneSplitter';
import { NotificationPanel } from './notifications/NotificationPanel';
import { CommandPalette } from './palette/CommandPalette';
import { SettingsModal } from './settings/SettingsModal';
import { PreferencesPanel } from './settings/PreferencesPanel';
import { ProjectPicker } from './project/ProjectPicker';
import { useAppShortcuts } from '../hooks/useAppShortcuts';
import { useNotificationListener } from '../hooks/useNotificationListener';
import { useThemeColors } from '../hooks/useThemeColors';
import { tauriBridge } from '../lib/tauri-bridge';
import { getCommands, getCommandById } from '../lib/commands';
import { getAutoSplitDirection } from '../lib/auto-split';
import { safeListen } from '../lib/safe-listen';
import type { WorkspaceChangedEvent, LayoutNode, PaneDropPosition, ProjectInfo, WorktreeInfo } from '../lib/workspace-types';
import { WorktreeDialog } from './project/WorktreeDialog';
import type { KeyBinding } from '../lib/keybinding-utils';

function getFirstLeafPaneId(layout: LayoutNode): string | null {
  if (layout.type === 'leaf') return layout.paneId;
  return getFirstLeafPaneId(layout.children[0]);
}

function paneExistsInLayout(layout: LayoutNode, paneId: string): boolean {
  if (layout.type === 'leaf') return layout.paneId === paneId;
  return layout.children.some((child) => paneExistsInLayout(child, paneId));
}

function collectLeafPaneIds(layout: LayoutNode, target: Set<string>) {
  if (layout.type === 'leaf') {
    target.add(layout.paneId);
    return;
  }
  collectLeafPaneIds(layout.children[0], target);
  collectLeafPaneIds(layout.children[1], target);
}

function findNewPaneId(previousLayout: LayoutNode, nextLayout: LayoutNode): string | null {
  const previousPaneIds = new Set<string>();
  const nextPaneIds = new Set<string>();
  collectLeafPaneIds(previousLayout, previousPaneIds);
  collectLeafPaneIds(nextLayout, nextPaneIds);
  for (const paneId of nextPaneIds) {
    if (!previousPaneIds.has(paneId)) return paneId;
  }
  return null;
}

export function AppLayout() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addProjectError, setAddProjectError] = useState<string | null>(null);
  const [addingProject, setAddingProject] = useState(false);
  const [worktreeDialogProjectId, setWorktreeDialogProjectId] = useState<string | null>(null);

  const projects = useProjectStore((s) => s.projects);
  const orderedProjectIds = useProjectStore((s) => s.orderedProjectIds);

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const orderedIds = useWorkspaceStore((s) => s.orderedIds);
  const activeWorkspace = useWorkspaceStore((s) => s.getActiveWorkspace());
  const activeSurface = useWorkspaceStore((s) => s.getActiveSurface());

  const focusedPaneId = useUiStore((s) => s.focusedPaneId);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const projectPickerOpen = useUiStore((s) => s.projectPickerOpen);
  const setProjectPickerOpen = useUiStore((s) => s.setProjectPickerOpen);
  const notificationPanelOpen = useUiStore((s) => s.notificationPanelOpen);
  const commandPaletteOpen = useUiStore((s) => s.commandPaletteOpen);
  const settingsOpen = useUiStore((s) => s.settingsOpen);
  const setFocusedPane = useUiStore((s) => s.setFocusedPane);
  const toggleNotificationPanel = useUiStore((s) => s.toggleNotificationPanel);
  const toggleCommandPalette = useUiStore((s) => s.toggleCommandPalette);
  const toggleSettings = useUiStore((s) => s.toggleSettings);

  const keybindings = useSettingsStore((s) => s.keybindings);
  const updateKeybinding = useSettingsStore((s) => s.updateKeybinding);
  const resetKeybinding = useSettingsStore((s) => s.resetKeybinding);

  const commands = getCommands();

  useAppShortcuts();
  useNotificationListener();
  useThemeColors();

  // Clear add-project error when the picker opens
  useEffect(() => {
    if (projectPickerOpen) {
      setAddProjectError(null);
    }
  }, [projectPickerOpen]);

  const handlePaneResize = useCallback((paneId: string, width: number, height: number) => {
    if (useUiStore.getState().focusedPaneId === paneId) {
      useUiStore.getState().setFocusedPaneDimensions({ width, height });
    }
  }, []);

  const handleCommandExecute = useCallback((commandId: string) => {
    const cmd = getCommandById(commandId);
    if (cmd) cmd.execute();
  }, []);

  const handleKeybindingUpdate = useCallback((commandId: string, binding: KeyBinding) => {
    updateKeybinding(commandId, binding);
  }, [updateKeybinding]);

  const handleKeybindingReset = useCallback((commandId: string) => {
    resetKeybinding(commandId);
  }, [resetKeybinding]);

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const [list, savedSettings, projectList] = await Promise.all([
          tauriBridge.session.restore(),
          tauriBridge.settings.get().catch(() => null),
          tauriBridge.project.list().catch(() => [] as ProjectInfo[]),
        ]);
        if (cancelled) return;

        if (savedSettings) {
          useSettingsStore.getState()._syncSettings(savedSettings as unknown as RustSettings);
        }

        useProjectStore.getState()._syncProjects(projectList);

        for (const ws of list) {
          useWorkspaceStore.getState()._syncWorkspace(ws);
        }
        if (list.length > 0) {
          useWorkspaceStore.getState()._setActiveWorkspace(list[0].id);
          const firstWs = list[0];
          if (firstWs.surfaces.length > 0) {
            const firstLeaf = getFirstLeafPaneId(firstWs.surfaces[0].layout);
            if (firstLeaf) {
              useUiStore.getState().setFocusedPane(firstLeaf);
            }
          }
        }

        setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err));
          setLoading(false);
        }
      }
    };

    init();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlistenChanged: (() => void) | null = null;
    let unlistenRemoved: (() => void) | null = null;

    const setup = async () => {
      unlistenChanged = await safeListen<WorkspaceChangedEvent>('workspace-changed', (event) => {
        if (cancelled) return;
        const { workspace } = event.payload;
        useWorkspaceStore.getState()._syncWorkspace(workspace);
      });
      if (cancelled) { unlistenChanged?.(); return; }

      unlistenRemoved = await safeListen<{ workspaceId: string }>('workspace-removed', (event) => {
        if (cancelled) return;
        useWorkspaceStore.getState()._removeWorkspace(event.payload.workspaceId);
      });
      if (cancelled) { unlistenRemoved?.(); }
    };

    setup();
    return () => {
      cancelled = true;
      unlistenChanged?.();
      unlistenRemoved?.();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let unlistenSettings: (() => void) | null = null;

    const setup = async () => {
      unlistenSettings = await safeListen<RustSettings>('settings-changed', (event) => {
        if (cancelled) return;
        useSettingsStore.getState()._syncSettings(event.payload);
      });
      if (cancelled) { unlistenSettings?.(); }
    };

    setup();
    return () => {
      cancelled = true;
      unlistenSettings?.();
    };
  }, []);

  // Clear stale focusedPaneId when the active workspace changes
  // (e.g. via backend workspace-removed event)
  useEffect(() => {
    if (!activeWorkspace) {
      useUiStore.getState().setFocusedPane(null);
      useUiStore.getState().setFocusedPaneDimensions(null);
      return;
    }
    // If focusedPaneId doesn't belong to the current workspace, reset it
    const currentFocused = useUiStore.getState().focusedPaneId;
    if (currentFocused) {
      const layout = activeWorkspace.surfaces[activeWorkspace.activeSurfaceIndex]?.layout;
      if (layout && !paneExistsInLayout(layout, currentFocused)) {
        const firstLeaf = getFirstLeafPaneId(layout);
        useUiStore.getState().setFocusedPane(firstLeaf);
        useUiStore.getState().setFocusedPaneDimensions(null);
      }
    }
  }, [activeWorkspace]);

  const handleWorkspaceSelect = (id: string) => {
    useWorkspaceStore.getState()._setActiveWorkspace(id);
  };

  const handleOpenProject = useCallback(async (project: ProjectInfo, worktree: WorktreeInfo) => {
    useProjectStore.getState()._addProject(project);
    useProjectStore.getState()._setActiveProject(project.id);
    setProjectPickerOpen(false);
    try {
      const ws = await tauriBridge.workspace.create({
        projectId: project.id,
        worktreePath: worktree.path,
        name: worktree.branch ?? undefined,
      });
      useWorkspaceStore.getState()._syncWorkspace(ws);
      useWorkspaceStore.getState()._setActiveWorkspace(ws.id);
      const firstSurface = ws.surfaces[ws.activeSurfaceIndex];
      const firstPaneId = firstSurface ? getFirstLeafPaneId(firstSurface.layout) : null;
      if (firstPaneId) {
        useUiStore.getState().setFocusedPane(firstPaneId);
      }
    } catch (err) {
      console.error('Failed to create workspace:', err);
    }
  }, [setProjectPickerOpen]);

  const handleProjectAdd = useCallback(async (rootPath: string): Promise<ProjectInfo | null> => {
    setAddingProject(true);
    setAddProjectError(null);
    try {
      const project = await tauriBridge.project.add(rootPath);
      useProjectStore.getState()._addProject(project);
      return project;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setAddProjectError(message);
      console.error('Failed to add project:', err);
      return null;
    } finally {
      setAddingProject(false);
    }
  }, []);

  const handleProjectRemove = useCallback(async (projectId: string) => {
    try {
      await tauriBridge.project.remove(projectId);
      useProjectStore.getState()._removeProject(projectId);
    } catch (err) {
      console.error('Failed to remove project:', err);
    }
  }, []);

  const handleWorktreeSelect = useCallback(async (worktree: WorktreeInfo) => {
    const projectId = worktreeDialogProjectId ?? '';
    setWorktreeDialogProjectId(null);
    try {
      const ws = await tauriBridge.workspace.create({
        projectId,
        worktreePath: worktree.path,
        name: worktree.branch ?? undefined,
      });
      useWorkspaceStore.getState()._syncWorkspace(ws);
      useWorkspaceStore.getState()._setActiveWorkspace(ws.id);
      const firstSurface = ws.surfaces[ws.activeSurfaceIndex];
      const firstPaneId = firstSurface ? getFirstLeafPaneId(firstSurface.layout) : null;
      if (firstPaneId) {
        useUiStore.getState().setFocusedPane(firstPaneId);
      }
    } catch (err) {
      console.error('Failed to create workspace:', err);
    }
  }, [worktreeDialogProjectId]);

  const handleWorkspaceCreate = useCallback((projectId: string) => {
    if (projectId) {
      setWorktreeDialogProjectId(projectId);
    } else {
      setProjectPickerOpen(true);
    }
  }, [setProjectPickerOpen]);

  const handleWorkspaceClose = async (id: string) => {
    try {
      // Clear focused pane state BEFORE removing the workspace to prevent
      // stale references in ResizeObserver callbacks during unmount
      useUiStore.getState().setFocusedPane(null);
      useUiStore.getState().setFocusedPaneDimensions(null);

      await tauriBridge.workspace.close(id);
      useWorkspaceStore.getState()._removeWorkspace(id);

      // Focus the first pane in the next active workspace (if any)
      const nextWorkspace = useWorkspaceStore.getState().getActiveWorkspace();
      if (nextWorkspace && nextWorkspace.surfaces.length > 0) {
        const firstLeaf = getFirstLeafPaneId(nextWorkspace.surfaces[0].layout);
        if (firstLeaf) {
          useUiStore.getState().setFocusedPane(firstLeaf);
        }
      }
    } catch (err) {
      console.error('Failed to close workspace:', err);
    }
  };

  const handleWorkspaceRename = async (id: string, newName: string) => {
    try {
      const ws = await tauriBridge.workspace.rename(id, newName);
      useWorkspaceStore.getState()._syncWorkspace(ws);
    } catch (err) {
      console.error('Failed to rename workspace:', err);
    }
  };

  const handleWorkspaceReorder = async (newOrderedIds: string[]) => {
    useWorkspaceStore.getState()._reorderWorkspaces(newOrderedIds);
    try {
      await tauriBridge.workspace.reorder(newOrderedIds);
    } catch (err) {
      console.error('Failed to reorder workspaces:', err);
    }
  };

  const handlePaneClose = useCallback(async (paneId: string) => {
    try {
      console.debug('[AppLayout] handlePaneClose start', paneId);
      // Clear focused state BEFORE closing to prevent stale references
      // in ResizeObserver callbacks during the unmount transition
      if (useUiStore.getState().focusedPaneId === paneId) {
        useUiStore.getState().setFocusedPane(null);
        useUiStore.getState().setFocusedPaneDimensions(null);
      }
      console.debug('[AppLayout] calling pane.close', paneId);

      await tauriBridge.pane.close(paneId);
      console.debug('[AppLayout] pane.close returned', paneId);
      useWorkspaceStore.getState()._removePaneName(paneId);
      useWorkspaceStore.getState()._removeBrowserPaneUrl(paneId);

      // Focus the first pane in the updated active workspace (if any)
      const ws = useWorkspaceStore.getState().getActiveWorkspace();
      if (ws && ws.surfaces.length > 0) {
        const firstLeaf = getFirstLeafPaneId(ws.surfaces[0].layout);
        if (firstLeaf) {
          useUiStore.getState().setFocusedPane(firstLeaf);
        }
      }
      console.debug('[AppLayout] handlePaneClose complete', paneId);
    } catch (err) {
      console.error('Failed to close pane:', err);
    }
  }, []);

  const handlePaneSplitHorizontal = useCallback(async (paneId: string) => {
    try {
      const ws = await tauriBridge.pane.split(paneId, 'horizontal');
      useWorkspaceStore.getState()._syncWorkspace(ws);
    } catch (err) {
      console.error('Failed to split pane:', err);
    }
  }, []);

  const handlePaneSplitVertical = useCallback(async (paneId: string) => {
    try {
      const ws = await tauriBridge.pane.split(paneId, 'vertical');
      useWorkspaceStore.getState()._syncWorkspace(ws);
    } catch (err) {
      console.error('Failed to split pane:', err);
    }
  }, []);

  const handlePaneAutoSplit = useCallback(async (paneId: string) => {
    try {
      const dims = useUiStore.getState().focusedPaneDimensions;
      const direction = dims
        ? getAutoSplitDirection(dims.width, dims.height)
        : 'vertical';
      const ws = await tauriBridge.pane.split(paneId, direction);
      useWorkspaceStore.getState()._syncWorkspace(ws);
    } catch (err) {
      console.error('Failed to auto-split pane:', err);
    }
  }, []);

  const handlePaneOpenBrowser = useCallback(async (paneId: string) => {
    try {
      const previousLayout = useWorkspaceStore.getState().getActiveSurface()?.layout;
      const ws = await tauriBridge.pane.openBrowser(paneId, 'about:blank', 'vertical');
      useWorkspaceStore.getState()._syncWorkspace(ws);

      if (!previousLayout) return;
      const nextSurface = ws.surfaces[ws.activeSurfaceIndex];
      if (!nextSurface) return;
      const newPaneId = findNewPaneId(previousLayout, nextSurface.layout);
      if (!newPaneId) return;
      useWorkspaceStore.getState()._setBrowserPaneUrl(newPaneId, 'about:blank');
    } catch (err) {
      console.error('Failed to open browser:', err);
    }
  }, []);

  const handlePaneMove = useCallback(async (
    paneId: string,
    targetPaneId: string,
    position: PaneDropPosition,
  ) => {
    try {
      const ws = await tauriBridge.pane.move(paneId, targetPaneId, position);
      useWorkspaceStore.getState()._syncWorkspace(ws);
    } catch (err) {
      console.error('Failed to move pane:', err);
    }
  }, []);

  const handleOpenPreferences = useCallback(() => {
    if (!settingsOpen) {
      toggleSettings();
    }
  }, [settingsOpen, toggleSettings]);

  const handleSurfaceSelect = (surfaceId: string) => {
    if (!activeWorkspace) return;
    const index = activeWorkspace.surfaces.findIndex(s => s.id === surfaceId);
    if (index >= 0) {
      const updated = { ...activeWorkspace, activeSurfaceIndex: index };
      useWorkspaceStore.getState()._syncWorkspace(updated);
    }
  };

  const handleSurfaceCreate = () => {
    // Surface creation will be implemented when the Rust command exists
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const handleSurfaceClose = (_surfaceId: string) => {
    // Surface close will be implemented when the Rust command exists
  };

  if (loading) {
    return (
      <div
        className="app-shell"
        style={{
          width: '100vw',
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--ui-text-muted)',
          fontFamily: 'var(--ui-font-mono)',
          letterSpacing: '0.08em',
          fontSize: 12,
        }}
      >
        Loading workspaces...
      </div>
    );
  }

  if (error) {
    return (
      <div
        className="app-shell"
        style={{
          width: '100vw',
          height: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--ui-danger)',
          fontFamily: 'var(--ui-font-mono)',
        }}
      >
        Failed to load workspaces: {error}
      </div>
    );
  }

  const showAllProjects = useSettingsStore((s) => s.showAllProjects);

  const workspaceList = orderedIds.map((id) => workspaces[id]).filter(Boolean);
  const activeProjectIdValue = workspaceList.find(ws => ws.id === activeWorkspaceId)?.projectId;

  const sidebarWorkspaceList = showAllProjects
    ? workspaceList
    : workspaceList.filter(ws => !activeProjectIdValue || ws.projectId === activeProjectIdValue);

  const projectList = orderedProjectIds.map(id => projects[id]).filter(Boolean);

  return (
    <div
      className="app-shell"
      style={{
        display: 'flex',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        backgroundColor: 'var(--ui-bg-app)',
        color: 'var(--ui-text-primary)',
      }}
    >
      {sidebarOpen && (
        <div style={{ width: 310, minWidth: 260, maxWidth: 420, flexShrink: 0, padding: 0 }}>
          <Sidebar
            workspaces={sidebarWorkspaceList}
            activeWorkspaceId={activeWorkspaceId ?? ''}
            activeProjectId={activeProjectIdValue}
            projects={projects}
            onWorkspaceSelect={handleWorkspaceSelect}
            onWorkspaceCreate={handleWorkspaceCreate}
            onWorkspaceClose={handleWorkspaceClose}
            onWorkspaceReorder={handleWorkspaceReorder}
            onWorkspaceRename={handleWorkspaceRename}
            onOpenPreferences={handleOpenPreferences}
          />
        </div>
      )}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0, gap: 0 }}>
        {activeWorkspace && activeWorkspace.surfaces.length > 1 && (
          <SurfaceTabBar
            surfaces={activeWorkspace.surfaces}
            activeSurfaceId={activeSurface?.id ?? ''}
            onSurfaceSelect={handleSurfaceSelect}
            onSurfaceCreate={handleSurfaceCreate}
            onSurfaceClose={handleSurfaceClose}
          />
        )}
        <div
          className="panel"
          style={{
            flex: 1,
            height: '100%',
            overflow: 'hidden',
            padding: 0,
          }}
        >
          {activeSurface && (
            <PaneSplitter
              layout={activeSurface.layout}
              activePaneId={focusedPaneId}
              onPaneClick={setFocusedPane}
              onPaneResize={handlePaneResize}
              onPaneClose={handlePaneClose}
              onPaneSplitHorizontal={handlePaneSplitHorizontal}
              onPaneSplitVertical={handlePaneSplitVertical}
              onPaneAutoSplit={handlePaneAutoSplit}
              onPaneOpenBrowser={handlePaneOpenBrowser}
              onPaneMove={handlePaneMove}
            />
          )}
          {!activeSurface && !projectPickerOpen && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--ui-text-muted)', fontFamily: 'var(--ui-font-mono)', fontSize: 12 }}>
              No workspaces open. Press Ctrl+Shift+O to open a project.
            </div>
          )}
        </div>
      </div>
      {notificationPanelOpen && (
        <NotificationPanel isOpen={notificationPanelOpen} onClose={toggleNotificationPanel} />
      )}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={toggleCommandPalette}
        commands={commands}
        onExecute={handleCommandExecute}
      />
      <SettingsModal isOpen={settingsOpen} onClose={toggleSettings}>
        <PreferencesPanel
          commands={commands}
          keybindings={keybindings}
          onKeybindingUpdate={handleKeybindingUpdate}
          onKeybindingReset={handleKeybindingReset}
        />
      </SettingsModal>
      {projectPickerOpen && (
        <div style={{
          position: 'fixed',
          inset: 0,
          zIndex: 1000,
          backgroundColor: 'var(--ui-bg-app)',
        }}>
          <ProjectPicker
            projects={projectList}
            onOpenProject={handleOpenProject}
            onProjectAdd={handleProjectAdd}
            onProjectRemove={handleProjectRemove}
            onEscape={workspaceList.length > 0 ? () => setProjectPickerOpen(false) : undefined}
            error={addProjectError}
            loading={addingProject}
            openWorktreePaths={workspaceList.map(ws => ws.worktreePath).filter(Boolean)}
          />
        </div>
      )}
      {worktreeDialogProjectId && (
        <WorktreeDialog
          projectId={worktreeDialogProjectId}
          projectName={projects[worktreeDialogProjectId]?.name ?? ''}
          isOpen={true}
          onSelect={handleWorktreeSelect}
          onClose={() => {
            setWorktreeDialogProjectId(null);
            if (Object.keys(workspaces).length === 0) {
              useUiStore.getState().setProjectPickerOpen(true);
            }
          }}
          onAutoSelect={handleWorktreeSelect}
          openWorktreePaths={workspaceList.map(ws => ws.worktreePath).filter(Boolean)}
        />
      )}
    </div>
  );
}
