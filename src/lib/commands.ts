import type { KeyBinding } from './keybinding-utils';
import { tauriBridge } from './tauri-bridge';
import { useUiStore } from '../stores/uiStore';
import { useWorkspaceStore } from '../stores/workspaceStore';

export type CommandCategory = 'workspace' | 'pane' | 'terminal' | 'browser' | 'navigation' | 'app';

export interface Command {
  id: string;
  label: string;
  description: string;
  category: CommandCategory;
  defaultBinding: KeyBinding | null;
  execute: () => void;
}

function kb(key: string, mod = true, shift = false, alt = false): KeyBinding {
  return { key, mod, shift, alt };
}

const commands: Command[] = [
  // Pane commands
  {
    id: 'pane.split-horizontal',
    label: 'Split Horizontal',
    description: 'Split the current pane horizontally',
    category: 'pane',
    defaultBinding: kb('h', true, true),
    execute: () => {
      const paneId = useUiStore.getState().focusedPaneId;
      if (paneId) tauriBridge.pane.split(paneId, 'horizontal');
    },
  },
  {
    id: 'pane.split-vertical',
    label: 'Split Vertical',
    description: 'Split the current pane vertically',
    category: 'pane',
    defaultBinding: kb('v', true, true),
    execute: () => {
      const paneId = useUiStore.getState().focusedPaneId;
      if (paneId) tauriBridge.pane.split(paneId, 'vertical');
    },
  },
  {
    id: 'pane.close',
    label: 'Close Pane',
    description: 'Close the current pane',
    category: 'pane',
    defaultBinding: kb('w'),
    execute: () => {
      const paneId = useUiStore.getState().focusedPaneId;
      if (paneId) tauriBridge.pane.close(paneId);
    },
  },
  {
    id: 'pane.open-browser',
    label: 'Open Browser',
    description: 'Open a browser pane',
    category: 'pane',
    defaultBinding: kb('b', true, true),
    execute: () => {
      const paneId = useUiStore.getState().focusedPaneId;
      if (paneId) tauriBridge.pane.openBrowser(paneId, 'about:blank', 'horizontal');
    },
  },
  // Workspace commands
  {
    id: 'workspace.create',
    label: 'New Workspace',
    description: 'Create a new workspace',
    category: 'workspace',
    defaultBinding: kb('n'),
    execute: () => {
      tauriBridge.workspace.create();
    },
  },
  // Workspace switch 1-9
  ...Array.from<unknown, Command>({ length: 9 }, (_, i) => ({
    id: `workspace.switch-${i + 1}`,
    label: `Switch to Workspace ${i + 1}`,
    description: `Switch to workspace ${i + 1}`,
    category: 'workspace' as CommandCategory,
    defaultBinding: kb(String(i + 1)),
    execute: () => {
      const workspaces = Object.values(useWorkspaceStore.getState().workspaces);
      if (i < workspaces.length) {
        useWorkspaceStore.getState()._setActiveWorkspace(workspaces[i].id);
      }
    },
  })),
  // App commands
  {
    id: 'app.toggle-notifications',
    label: 'Toggle Notifications',
    description: 'Toggle the notification panel',
    category: 'app',
    defaultBinding: kb('i'),
    execute: () => {
      useUiStore.getState().toggleNotificationPanel();
    },
  },
  {
    id: 'app.toggle-command-palette',
    label: 'Command Palette',
    description: 'Toggle the command palette',
    category: 'app',
    defaultBinding: kb('p', true, true),
    execute: () => {
      useUiStore.getState().toggleCommandPalette();
    },
  },
  {
    id: 'app.toggle-settings',
    label: 'Settings',
    description: 'Open application settings',
    category: 'app',
    defaultBinding: kb(','),
    execute: () => {
      useUiStore.getState().toggleSettings();
    },
  },
  // Navigation commands
  {
    id: 'navigation.focus-up',
    label: 'Focus Up',
    description: 'Focus the pane above',
    category: 'navigation',
    defaultBinding: kb('ArrowUp'),
    execute: () => {
      useUiStore.getState().focusAdjacentPane('up');
    },
  },
  {
    id: 'navigation.focus-down',
    label: 'Focus Down',
    description: 'Focus the pane below',
    category: 'navigation',
    defaultBinding: kb('ArrowDown'),
    execute: () => {
      useUiStore.getState().focusAdjacentPane('down');
    },
  },
  {
    id: 'navigation.focus-left',
    label: 'Focus Left',
    description: 'Focus the pane to the left',
    category: 'navigation',
    defaultBinding: kb('ArrowLeft'),
    execute: () => {
      useUiStore.getState().focusAdjacentPane('left');
    },
  },
  {
    id: 'navigation.focus-right',
    label: 'Focus Right',
    description: 'Focus the pane to the right',
    category: 'navigation',
    defaultBinding: kb('ArrowRight'),
    execute: () => {
      useUiStore.getState().focusAdjacentPane('right');
    },
  },
];

export function getCommands(): Command[] {
  return commands;
}

export function getCommandById(id: string): Command | undefined {
  return commands.find((c) => c.id === id);
}

export function getCommandsByCategory(category: CommandCategory): Command[] {
  return commands.filter((c) => c.category === category);
}
