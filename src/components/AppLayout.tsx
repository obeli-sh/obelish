import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../stores/workspaceStore';
import { useUiStore } from '../stores/uiStore';
import { Sidebar } from './sidebar/Sidebar';
import { SurfaceTabBar } from './layout/SurfaceTabBar';
import { PaneSplitter } from './layout/PaneSplitter';
import { useAppShortcuts } from '../hooks/useAppShortcuts';
import { tauriBridge } from '../lib/tauri-bridge';
import { listen } from '@tauri-apps/api/event';
import type { WorkspaceChangedEvent } from '../lib/workspace-types';

export function AppLayout() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const activeWorkspace = useWorkspaceStore((s) => s.getActiveWorkspace());
  const activeSurface = useWorkspaceStore((s) => s.getActiveSurface());

  const focusedPaneId = useUiStore((s) => s.focusedPaneId);
  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const setFocusedPane = useUiStore((s) => s.setFocusedPane);

  useAppShortcuts();

  useEffect(() => {
    let cancelled = false;

    const init = async () => {
      try {
        const list = await tauriBridge.workspace.list();
        if (cancelled) return;

        if (list.length === 0) {
          const ws = await tauriBridge.workspace.create({ name: 'Workspace 1' });
          if (cancelled) return;
          useWorkspaceStore.getState()._syncWorkspace(ws);
          useWorkspaceStore.getState()._setActiveWorkspace(ws.id);
          if (ws.surfaces.length > 0 && ws.surfaces[0].layout.type === 'leaf') {
            useUiStore.getState().setFocusedPane(ws.surfaces[0].layout.paneId);
          }
        } else {
          for (const ws of list) {
            useWorkspaceStore.getState()._syncWorkspace(ws);
          }
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
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      unlisten = await listen<WorkspaceChangedEvent>('workspace-changed', (event) => {
        if (cancelled) return;
        const { workspace } = event.payload;
        useWorkspaceStore.getState()._syncWorkspace(workspace);
      });
      if (cancelled && unlisten) {
        unlisten();
      }
    };

    setup();
    return () => {
      cancelled = true;
      if (unlisten) unlisten();
    };
  }, []);

  const handleWorkspaceSelect = (id: string) => {
    useWorkspaceStore.getState()._setActiveWorkspace(id);
  };

  const handleWorkspaceCreate = async () => {
    const ws = await tauriBridge.workspace.create();
    useWorkspaceStore.getState()._syncWorkspace(ws);
    useWorkspaceStore.getState()._setActiveWorkspace(ws.id);
  };

  const handleWorkspaceClose = async (id: string) => {
    await tauriBridge.workspace.close(id);
    useWorkspaceStore.getState()._removeWorkspace(id);
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
    </div>
  );
}
