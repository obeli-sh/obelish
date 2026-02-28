import { useCallback, useEffect, useState } from 'react';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useUiStore } from '../stores/uiStore';
import { useSettingsStore } from '../stores/settingsStore';
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
import { listen } from '@tauri-apps/api/event';
import type { WorkspaceChangedEvent } from '../lib/workspace-types';
import type { KeyBinding } from '../lib/keybinding-utils';

export function AppLayout() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
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
        const list = await tauriBridge.session.restore();
        if (cancelled) return;

        for (const ws of list) {
          useWorkspaceStore.getState()._syncWorkspace(ws);
        }
        if (list.length > 0) {
          useWorkspaceStore.getState()._setActiveWorkspace(list[0].id);
          const firstWs = list[0];
          if (firstWs.surfaces.length > 0 && firstWs.surfaces[0].layout.type === 'leaf') {
            useUiStore.getState().setFocusedPane(firstWs.surfaces[0].layout.paneId);
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
      unlistenSettings = await listen<Record<string, unknown>>('settings-changed', (event) => {
        if (cancelled) return;
        useSettingsStore.getState()._syncSettings(event.payload as Partial<typeof keybindings>);
      });
      if (cancelled) { unlistenSettings?.(); }
    };

    setup();
    return () => {
      cancelled = true;
      unlistenSettings?.();
    };
  }, []);

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
      await tauriBridge.workspace.close(id);
      useWorkspaceStore.getState()._removeWorkspace(id);
    } catch (err) {
      console.error('Failed to close workspace:', err);
    }
  };

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

  const workspaceList = Object.values(workspaces);

  return (
    <div style={{ display: 'flex', width: '100vw', height: '100vh', overflow: 'hidden', backgroundColor: '#1e1e2e' }}>
      {sidebarOpen && (
        <Sidebar
          workspaces={workspaceList}
          activeWorkspaceId={activeWorkspaceId ?? ''}
          onWorkspaceSelect={handleWorkspaceSelect}
          onWorkspaceCreate={handleWorkspaceCreate}
          onWorkspaceClose={handleWorkspaceClose}
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
        <div style={{ flex: 1, overflow: 'hidden' }}>
          {activeSurface && (
            <PaneSplitter
              layout={activeSurface.layout}
              activePaneId={focusedPaneId}
              onPaneClick={setFocusedPane}
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
