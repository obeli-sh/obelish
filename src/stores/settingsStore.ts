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

export interface RustSettings {
  keybindings: Record<string, KeyBinding>;
  theme: string;
  terminalFontFamily: string;
  terminalFontSize: number;
  scrollbackLines: number;
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
  _syncSettings: (settings: RustSettings) => void;
}

export const useSettingsStore = create<SettingsStoreState>((set) => ({
  keybindings: buildDefaultKeybindings(),
  theme: 'dark',
  terminalFontFamily: '"Fira Mono", monospace',
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
    set({
      keybindings: settings.keybindings,
      theme: settings.theme as 'dark' | 'light' | 'system',
      terminalFontFamily: settings.terminalFontFamily,
      terminalFontSize: settings.terminalFontSize,
      scrollbackLines: settings.scrollbackLines,
    });
  },
}));
