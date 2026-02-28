import { useMemo } from 'react';
import { useKeyboardShortcuts, type ShortcutDefinition } from './useKeyboardShortcuts';
import { tauriBridge } from '../lib/tauri-bridge';
import { useUiStore } from '../stores/uiStore';
import { useWorkspaceStore } from '../stores/workspaceStore';

export function useAppShortcuts(): void {
  const shortcuts = useMemo<ShortcutDefinition[]>(
    () => [
      {
        key: 'h',
        shift: true,
        action: () => {
          const paneId = useUiStore.getState().focusedPaneId;
          if (paneId) tauriBridge.pane.split(paneId, 'horizontal');
        },
      },
      {
        key: 'v',
        shift: true,
        action: () => {
          const paneId = useUiStore.getState().focusedPaneId;
          if (paneId) tauriBridge.pane.split(paneId, 'vertical');
        },
      },
      {
        key: 'b',
        shift: true,
        action: () => {
          const paneId = useUiStore.getState().focusedPaneId;
          if (paneId) tauriBridge.pane.openBrowser(paneId, 'about:blank', 'horizontal');
        },
      },
      {
        key: 'w',
        action: () => {
          const paneId = useUiStore.getState().focusedPaneId;
          if (paneId) tauriBridge.pane.close(paneId);
        },
      },
      {
        key: 'n',
        action: () => {
          tauriBridge.workspace.create();
        },
      },
      ...Array.from<unknown, ShortcutDefinition>({ length: 9 }, (_, i) => ({
        key: String(i + 1),
        action: () => {
          const workspaces = Object.values(
            useWorkspaceStore.getState().workspaces,
          );
          if (i < workspaces.length) {
            useWorkspaceStore.getState()._setActiveWorkspace(workspaces[i].id);
          }
        },
      })),
      {
        key: 'i',
        action: () => useUiStore.getState().toggleNotificationPanel(),
      },
      {
        key: 'ArrowUp',
        action: () => useUiStore.getState().focusAdjacentPane('up'),
      },
      {
        key: 'ArrowDown',
        action: () => useUiStore.getState().focusAdjacentPane('down'),
      },
      {
        key: 'ArrowLeft',
        action: () => useUiStore.getState().focusAdjacentPane('left'),
      },
      {
        key: 'ArrowRight',
        action: () => useUiStore.getState().focusAdjacentPane('right'),
      },
    ],
    [],
  );

  useKeyboardShortcuts(shortcuts);
}
