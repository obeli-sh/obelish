import { useCallback, useEffect, useState } from 'react';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useUiStore } from '../stores/uiStore';
import { useSettingsStore, type RustSettings } from '../stores/settingsStore';
import { Sidebar } from './sidebar/Sidebar';
import { SurfaceTabBar } from './layout/SurfaceTabBar';
import { PaneSplitter } from './layout/PaneSplitter';
import { NotificationPanel } from './notifications/NotificationPanel';
import { CommandPalette } from './palette/CommandPalette';
import { SettingsModal } from './settings/SettingsModal';
import { KeybindingEditor } from './settings/KeybindingEditor';
import { useAppShortcuts } from '../hooks/useAppShortcuts';
import { useNotificationListener } from '../hooks/useNotificationListener';
import { tauriBridge } from '../lib/tauri-bridge';
import { getCommands, getCommandById } from '../lib/commands';
import { getAutoSplitDirection } from '../lib/auto-split';
import { listen } from '@tauri-apps/api/event';
import type { WorkspaceChangedEvent, LayoutNode } from '../lib/workspace-types';
import type { KeyBinding } from '../lib/keybinding-utils';

function getFirstLeafPaneId(layout: LayoutNode): string | null {
  if (layout.type === 'leaf') return layout.paneId;
  return getFirstLeafPaneId(layout.children[0]);
}

function paneExistsInLayout(layout: LayoutNode, paneId: string): boolean {
  if (layout.type === 'leaf') return layout.paneId === paneId;
  return layout.children.some((child) => paneExistsInLayout(child, paneId));
}

export function AppLayout() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const orderedIds = useWorkspaceStore((s) => s.orderedIds);
  const activeWorkspace = useWorkspaceStore((s) => s.getActiveWorkspace());
  const activeSurface = useWorkspaceStore((s) => s.getActiveSurface());

  const focusedPaneId = useUiStore((s) => s.focusedPaneId);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
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
        const [list, savedSettings] = await Promise.all([
          tauriBridge.session.restore(),
          tauriBridge.settings.get().catch(() => null),
        ]);
        if (cancelled) return;

        if (savedSettings) {
          useSettingsStore.getState()._syncSettings(savedSettings as unknown as RustSettings);
        }

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
      unlistenChanged = await listen<WorkspaceChangedEvent>('workspace-changed', (event) => {
        if (cancelled) return;
        const { workspace } = event.payload;
        useWorkspaceStore.getState()._syncWorkspace(workspace);
      });
      if (cancelled) { unlistenChanged?.(); return; }

      unlistenRemoved = await listen<{ workspaceId: string }>('workspace-removed', (event) => {
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
      unlistenSettings = await listen<RustSettings>('settings-changed', (event) => {
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

  const handleWorkspaceCreate = async () => {
    try {
      const ws = await tauriBridge.workspace.create();
      useWorkspaceStore.getState()._syncWorkspace(ws);
      useWorkspaceStore.getState()._setActiveWorkspace(ws.id);
    } catch (err) {
      console.error('Failed to create workspace:', err);
    }
  };

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
      const ws = await tauriBridge.pane.openBrowser(paneId, 'about:blank', 'vertical');
      useWorkspaceStore.getState()._syncWorkspace(ws);
    } catch (err) {
      console.error('Failed to open browser:', err);
    }
  }, []);

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
    return <div style={{ padding: 20, color: '#cdd6f4' }}>Loading workspaces...</div>;
  }

  if (error) {
    return <div style={{ padding: 20, color: '#f38ba8' }}>Failed to load workspaces: {error}</div>;
  }

  const workspaceList = orderedIds.map((id) => workspaces[id]).filter(Boolean);

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', overflow: 'hidden', backgroundColor: '#1e1e2e' }}>
      {sidebarOpen && (
        <Sidebar
          workspaces={workspaceList}
          activeWorkspaceId={activeWorkspaceId ?? ''}
          onWorkspaceSelect={handleWorkspaceSelect}
          onWorkspaceCreate={handleWorkspaceCreate}
          onWorkspaceClose={handleWorkspaceClose}
          onWorkspaceReorder={handleWorkspaceReorder}
          onWorkspaceRename={handleWorkspaceRename}
        />
      )}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {activeWorkspace && activeWorkspace.surfaces.length > 1 && (
          <SurfaceTabBar
            surfaces={activeWorkspace.surfaces}
            activeSurfaceId={activeSurface?.id ?? ''}
            onSurfaceSelect={handleSurfaceSelect}
            onSurfaceCreate={handleSurfaceCreate}
            onSurfaceClose={handleSurfaceClose}
          />
        )}
        <div style={{ flex: 1, height: '100%', overflow: 'hidden' }}>
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
            />
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
        <KeybindingEditor
          commands={commands}
          keybindings={keybindings}
          onUpdate={handleKeybindingUpdate}
          onReset={handleKeybindingReset}
        />
      </SettingsModal>
    </div>
  );
}
