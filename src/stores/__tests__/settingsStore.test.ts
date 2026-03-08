// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore, type RustSettings } from '../settingsStore';
import { getCommands } from '../../lib/commands';
import type { KeyBinding } from '../../lib/keybinding-utils';

function kb(key: string, mod = true, shift = false, alt = false): KeyBinding {
  return { key, mod, shift, alt };
}

function buildDefaultKeybindings(): Record<string, KeyBinding> {
  const bindings: Record<string, KeyBinding> = {};
  for (const cmd of getCommands()) {
    if (cmd.defaultBinding) {
      bindings[cmd.id] = { ...cmd.defaultBinding };
    }
  }
  return bindings;
}

describe('settingsStore', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      keybindings: buildDefaultKeybindings(),
      theme: 'dark',
      terminalFontFamily: '"Fira Mono", monospace',
      terminalFontSize: 14,
      scrollbackLines: 5000,
    });
  });

  describe('initial state', () => {
    it('has default keybindings populated from command registry', () => {
      const { keybindings } = useSettingsStore.getState();
      const commands = getCommands();

      for (const cmd of commands) {
        if (cmd.defaultBinding) {
          expect(keybindings[cmd.id]).toEqual(cmd.defaultBinding);
        }
      }
    });

    it('has default theme as dark', () => {
      expect(useSettingsStore.getState().theme).toBe('dark');
    });

    it('has default terminal font family', () => {
      expect(useSettingsStore.getState().terminalFontFamily).toBe('"Fira Mono", monospace');
    });

    it('has default terminal font size', () => {
      expect(useSettingsStore.getState().terminalFontSize).toBe(14);
    });

    it('has default scrollback lines', () => {
      expect(useSettingsStore.getState().scrollbackLines).toBe(5000);
    });
  });

  describe('updateKeybinding', () => {
    it('updates a keybinding for a command', () => {
      const newBinding = kb('j', true, true);
      useSettingsStore.getState().updateKeybinding('pane.close', newBinding);

      expect(useSettingsStore.getState().keybindings['pane.close']).toEqual(newBinding);
    });

    it('does not affect other keybindings', () => {
      const before = { ...useSettingsStore.getState().keybindings };
      const newBinding = kb('j', true, true);
      useSettingsStore.getState().updateKeybinding('pane.close', newBinding);

      const after = useSettingsStore.getState().keybindings;
      for (const [id, binding] of Object.entries(before)) {
        if (id !== 'pane.close') {
          expect(after[id]).toEqual(binding);
        }
      }
    });
  });

  describe('resetKeybinding', () => {
    it('resets a keybinding to its default', () => {
      const newBinding = kb('j', true, true);
      useSettingsStore.getState().updateKeybinding('pane.close', newBinding);
      useSettingsStore.getState().resetKeybinding('pane.close');

      const defaultBinding = getCommands().find((c) => c.id === 'pane.close')?.defaultBinding;
      expect(useSettingsStore.getState().keybindings['pane.close']).toEqual(defaultBinding);
    });
  });

  describe('resetAllKeybindings', () => {
    it('resets all keybindings to defaults', () => {
      useSettingsStore.getState().updateKeybinding('pane.close', kb('j', true, true));
      useSettingsStore.getState().updateKeybinding('workspace.create', kb('m', true, true));
      useSettingsStore.getState().resetAllKeybindings();

      const { keybindings } = useSettingsStore.getState();
      const commands = getCommands();
      for (const cmd of commands) {
        if (cmd.defaultBinding) {
          expect(keybindings[cmd.id]).toEqual(cmd.defaultBinding);
        }
      }
    });
  });

  describe('updateTheme', () => {
    it('updates theme to light', () => {
      useSettingsStore.getState().updateTheme('light');
      expect(useSettingsStore.getState().theme).toBe('light');
    });

    it('updates theme to system', () => {
      useSettingsStore.getState().updateTheme('system');
      expect(useSettingsStore.getState().theme).toBe('system');
    });
  });

  describe('updateFontFamily', () => {
    it('updates terminal font family', () => {
      useSettingsStore.getState().updateFontFamily('Fira Code');
      expect(useSettingsStore.getState().terminalFontFamily).toBe('Fira Code');
    });
  });

  describe('updateFontSize', () => {
    it('updates terminal font size', () => {
      useSettingsStore.getState().updateFontSize(16);
      expect(useSettingsStore.getState().terminalFontSize).toBe(16);
    });
  });

  describe('defaultShell', () => {
    it('has initial defaultShell as empty string', () => {
      expect(useSettingsStore.getState().defaultShell).toBe('');
    });

    it('updateDefaultShell sets the value', () => {
      useSettingsStore.getState().updateDefaultShell('/usr/bin/zsh');
      expect(useSettingsStore.getState().defaultShell).toBe('/usr/bin/zsh');
    });

    it('updateDefaultShell can reset to empty string for auto-detect', () => {
      useSettingsStore.getState().updateDefaultShell('/usr/bin/fish');
      useSettingsStore.getState().updateDefaultShell('');
      expect(useSettingsStore.getState().defaultShell).toBe('');
    });
  });

  describe('_syncSettings', () => {
    it('syncs all data fields from Rust payload', () => {
      const rustPayload: RustSettings = {
        keybindings: { 'pane.close': kb('x', true, true) },
        theme: 'light',
        terminalFontFamily: 'JetBrains Mono',
        terminalFontSize: 18,
        scrollbackLines: 2000,
        defaultShell: '/usr/bin/fish',
      };
      useSettingsStore.getState()._syncSettings(rustPayload);

      const state = useSettingsStore.getState();
      expect(state.keybindings).toEqual({ 'pane.close': kb('x', true, true) });
      expect(state.theme).toBe('light');
      expect(state.terminalFontFamily).toBe('JetBrains Mono');
      expect(state.terminalFontSize).toBe(18);
      expect(state.scrollbackLines).toBe(2000);
      expect(state.defaultShell).toBe('/usr/bin/fish');
    });

    it('syncs defaultShell from Rust payload', () => {
      const rustPayload: RustSettings = {
        keybindings: {},
        theme: 'dark',
        terminalFontFamily: 'monospace',
        terminalFontSize: 14,
        scrollbackLines: 5000,
        defaultShell: 'wsl.exe -d Ubuntu-24.04',
      };
      useSettingsStore.getState()._syncSettings(rustPayload);
      expect(useSettingsStore.getState().defaultShell).toBe('wsl.exe -d Ubuntu-24.04');
    });

    it('does not remove store action functions', () => {
      const rustPayload: RustSettings = {
        keybindings: {},
        theme: 'dark',
        terminalFontFamily: 'monospace',
        terminalFontSize: 14,
        scrollbackLines: 5000,
      };
      useSettingsStore.getState()._syncSettings(rustPayload);

      const state = useSettingsStore.getState();
      expect(typeof state.updateKeybinding).toBe('function');
      expect(typeof state.resetKeybinding).toBe('function');
      expect(typeof state.resetAllKeybindings).toBe('function');
      expect(typeof state._syncSettings).toBe('function');
    });
  });
});
