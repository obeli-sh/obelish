import { create } from 'zustand';
import type { KeyBinding } from '../lib/keybinding-utils';
import { getCommands } from '../lib/commands';

function buildDefaultKeybindings(): Record<string, KeyBinding> {
  const bindings: Record<string, KeyBinding> = {};
  for (const cmd of getCommands()) {
    if (cmd.defaultBinding) {
      bindings[cmd.id] = { ...cmd.defaultBinding };
    }
  }
  return bindings;
}

interface SettingsStoreState {
  keybindings: Record<string, KeyBinding>;
  theme: 'dark' | 'light' | 'system';
  terminalFontFamily: string;
  terminalFontSize: number;
  scrollbackLines: number;
  updateKeybinding: (commandId: string, binding: KeyBinding) => void;
  resetKeybinding: (commandId: string) => void;
  resetAllKeybindings: () => void;
  updateTheme: (theme: 'dark' | 'light' | 'system') => void;
  updateFontFamily: (fontFamily: string) => void;
  updateFontSize: (fontSize: number) => void;
  _syncSettings: (settings: Partial<SettingsStoreState>) => void;
}

export const useSettingsStore = create<SettingsStoreState>((set) => ({
  keybindings: buildDefaultKeybindings(),
  theme: 'dark',
  terminalFontFamily: 'monospace',
  terminalFontSize: 14,
  scrollbackLines: 5000,

  updateKeybinding: (commandId, binding) => {
    set((state) => ({
      keybindings: { ...state.keybindings, [commandId]: binding },
    }));
  },

  resetKeybinding: (commandId) => {
    const defaults = buildDefaultKeybindings();
    set((state) => ({
      keybindings: {
        ...state.keybindings,
        [commandId]: defaults[commandId],
      },
    }));
  },

  resetAllKeybindings: () => {
    set({ keybindings: buildDefaultKeybindings() });
  },

  updateTheme: (theme) => {
    set({ theme });
  },

  updateFontFamily: (terminalFontFamily) => {
    set({ terminalFontFamily });
  },

  updateFontSize: (terminalFontSize) => {
    set({ terminalFontSize });
  },

  _syncSettings: (settings) => {
    set(settings);
  },
}));
