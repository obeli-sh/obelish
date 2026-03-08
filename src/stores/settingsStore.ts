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

export interface ThemeColors {
  appBackground: string;
  panelBackground: string;
  panelBackgroundAlt: string;
  textPrimary: string;
  textMuted: string;
  borderColor: string;
  accentColor: string;
  dangerColor: string;
  terminalBackground: string;
  terminalForeground: string;
  terminalCursor: string;
  terminalSelection: string;
}

export const defaultThemeColors: ThemeColors = {
  appBackground: '#181825',
  panelBackground: '#1e1e2e',
  panelBackgroundAlt: '#181825',
  textPrimary: '#cdd6f4',
  textMuted: '#a6adc8',
  borderColor: '#313244',
  accentColor: '#89b4fa',
  dangerColor: '#f38ba8',
  terminalBackground: '#0b0b0b',
  terminalForeground: '#cdd6f4',
  terminalCursor: '#f5e0dc',
  terminalSelection: '#45475a80',
};

export type WorkspaceLayoutPreset = 'single' | 'side-by-side' | 'stacked';

export interface RustSettings {
  keybindings: Record<string, KeyBinding>;
  theme: string;
  terminalFontFamily: string;
  terminalFontSize: number;
  scrollbackLines: number;
  defaultShell?: string;
}

interface SettingsStoreState {
  keybindings: Record<string, KeyBinding>;
  theme: 'dark' | 'light' | 'system';
  terminalFontFamily: string;
  terminalFontSize: number;
  scrollbackLines: number;
  defaultShell: string;
  preferredWorkspaceLayout: WorkspaceLayoutPreset;
  showAllProjects: boolean;
  uiFontFamily: string;
  uiFontSize: number;
  themeColors: ThemeColors;
  updateKeybinding: (commandId: string, binding: KeyBinding) => void;
  resetKeybinding: (commandId: string) => void;
  resetAllKeybindings: () => void;
  updateTheme: (theme: 'dark' | 'light' | 'system') => void;
  updateFontFamily: (fontFamily: string) => void;
  updateFontSize: (fontSize: number) => void;
  updateDefaultShell: (shell: string) => void;
  updatePreferredWorkspaceLayout: (layout: WorkspaceLayoutPreset) => void;
  updateShowAllProjects: (show: boolean) => void;
  updateUiFontFamily: (fontFamily: string) => void;
  updateUiFontSize: (size: number) => void;
  updateThemeColor: (key: keyof ThemeColors, value: string) => void;
  _syncSettings: (settings: RustSettings) => void;
}

export const useSettingsStore = create<SettingsStoreState>((set) => ({
  keybindings: buildDefaultKeybindings(),
  theme: 'dark',
  terminalFontFamily: '"Fira Mono", monospace',
  terminalFontSize: 14,
  scrollbackLines: 5000,
  defaultShell: '',
  preferredWorkspaceLayout: 'single',
  showAllProjects: false,
  uiFontFamily: "'Fira Mono', monospace",
  uiFontSize: 13,
  themeColors: { ...defaultThemeColors },

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

  updateDefaultShell: (defaultShell) => {
    set({ defaultShell });
  },

  updatePreferredWorkspaceLayout: (preferredWorkspaceLayout) => {
    set({ preferredWorkspaceLayout });
  },

  updateShowAllProjects: (showAllProjects) => {
    set({ showAllProjects });
  },

  updateUiFontFamily: (uiFontFamily) => {
    set({ uiFontFamily });
  },

  updateUiFontSize: (uiFontSize) => {
    set({ uiFontSize });
  },

  updateThemeColor: (key, value) => {
    set((state) => ({
      themeColors: { ...state.themeColors, [key]: value },
    }));
  },

  _syncSettings: (settings) => {
    set({
      keybindings: settings.keybindings,
      theme: settings.theme as 'dark' | 'light' | 'system',
      terminalFontFamily: settings.terminalFontFamily,
      terminalFontSize: settings.terminalFontSize,
      scrollbackLines: settings.scrollbackLines,
      defaultShell: settings.defaultShell ?? '',
    });
  },
}));
