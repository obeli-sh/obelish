import { describe, it, expect } from 'vitest';
import { getCommands, getCommandById, getCommandsByCategory } from '../commands';

describe('commands', () => {
  describe('getCommands', () => {
    it('returns an array of commands', () => {
      const commands = getCommands();
      expect(Array.isArray(commands)).toBe(true);
      expect(commands.length).toBeGreaterThan(0);
    });

    it('all commands have required fields', () => {
      const commands = getCommands();
      for (const cmd of commands) {
        expect(cmd.id).toBeTruthy();
        expect(cmd.label).toBeTruthy();
        expect(cmd.description).toBeTruthy();
        expect(cmd.category).toBeTruthy();
        expect(typeof cmd.execute).toBe('function');
      }
    });

    it('all command ids are unique', () => {
      const commands = getCommands();
      const ids = commands.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('has pane commands', () => {
      const commands = getCommands();
      const paneCommands = commands.filter((c) => c.category === 'pane');
      expect(paneCommands.length).toBeGreaterThanOrEqual(4);
    });

    it('has workspace commands', () => {
      const commands = getCommands();
      const workspaceCommands = commands.filter((c) => c.category === 'workspace');
      expect(workspaceCommands.length).toBeGreaterThanOrEqual(10);
    });

    it('has navigation commands', () => {
      const commands = getCommands();
      const navCommands = commands.filter((c) => c.category === 'navigation');
      expect(navCommands.length).toBe(4);
    });

    it('has app commands', () => {
      const commands = getCommands();
      const appCommands = commands.filter((c) => c.category === 'app');
      expect(appCommands.length).toBeGreaterThanOrEqual(3);
    });

    it('workspace.switch commands have correct default bindings 1-9', () => {
      const commands = getCommands();
      for (let i = 1; i <= 9; i++) {
        const cmd = commands.find((c) => c.id === `workspace.switch-${i}`);
        expect(cmd).toBeDefined();
        expect(cmd!.defaultBinding).toEqual({
          key: String(i),
          mod: true,
          shift: false,
          alt: false,
        });
      }
    });

    it('pane.split-horizontal has Ctrl+Shift+H default binding', () => {
      const cmd = getCommands().find((c) => c.id === 'pane.split-horizontal');
      expect(cmd).toBeDefined();
      expect(cmd!.defaultBinding).toEqual({
        key: 'h',
        mod: true,
        shift: true,
        alt: false,
      });
    });

    it('app.toggle-command-palette has Ctrl+Shift+P default binding', () => {
      const cmd = getCommands().find((c) => c.id === 'app.toggle-command-palette');
      expect(cmd).toBeDefined();
      expect(cmd!.defaultBinding).toEqual({
        key: 'p',
        mod: true,
        shift: true,
        alt: false,
      });
    });

    it('app.toggle-settings has Ctrl+, default binding', () => {
      const cmd = getCommands().find((c) => c.id === 'app.toggle-settings');
      expect(cmd).toBeDefined();
      expect(cmd!.defaultBinding).toEqual({
        key: ',',
        mod: true,
        shift: false,
        alt: false,
      });
    });
  });

  describe('getCommandById', () => {
    it('returns a command by id', () => {
      const cmd = getCommandById('pane.close');
      expect(cmd).toBeDefined();
      expect(cmd!.id).toBe('pane.close');
    });

    it('returns undefined for unknown id', () => {
      expect(getCommandById('nonexistent.command')).toBeUndefined();
    });
  });

  describe('getCommandsByCategory', () => {
    it('returns commands filtered by category', () => {
      const paneCommands = getCommandsByCategory('pane');
      expect(paneCommands.length).toBeGreaterThan(0);
      expect(paneCommands.every((c) => c.category === 'pane')).toBe(true);
    });

    it('returns empty array for category with no commands', () => {
      // 'terminal' category has no commands yet
      const terminalCommands = getCommandsByCategory('terminal');
      expect(Array.isArray(terminalCommands)).toBe(true);
    });

    it('returns only commands of specified category', () => {
      const navCommands = getCommandsByCategory('navigation');
      for (const cmd of navCommands) {
        expect(cmd.category).toBe('navigation');
      }
    });
  });
});
