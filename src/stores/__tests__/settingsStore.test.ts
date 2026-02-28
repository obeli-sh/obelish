import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore } from '../settingsStore';
import { getCommands } from '../../lib/commands';
import type { KeyBinding } from '../../lib/keybinding-utils';

function kb(key: string, mod = true, shift = false, alt = false): KeyBinding {
  return { key, mod, shift, alt };
}

describe('settingsStore', () => {
  beforeEach(() => {
    useSettingsStore.getState().resetAllKeybindings();
    useSettingsStore.setState({
      theme: 'dark',
      terminalFontFamily: 'monospace',
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
      expect(useSettingsStore.getState().terminalFontFamily).toBe('monospace');
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
});
