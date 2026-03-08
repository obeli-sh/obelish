// @vitest-environment node
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

    it('returns empty array for terminal category', () => {
      const terminalCommands = getCommandsByCategory('terminal');
      expect(terminalCommands).toHaveLength(0);
    });

    it('returns all pane commands with correct ids', () => {
      const paneCommands = getCommandsByCategory('pane');
      const ids = paneCommands.map((c) => c.id);
      expect(ids).toContain('pane.split-horizontal');
      expect(ids).toContain('pane.split-vertical');
      expect(ids).toContain('pane.close');
      expect(ids).toContain('pane.open-browser');
    });
  });

  describe('specific commands', () => {
    it('pane.split-vertical has Ctrl+Shift+V default binding', () => {
      const cmd = getCommandById('pane.split-vertical');
      expect(cmd).toBeDefined();
      expect(cmd!.defaultBinding).toEqual({
        key: 'v',
        mod: true,
        shift: true,
        alt: false,
      });
    });

    it('pane.close has Ctrl+W default binding', () => {
      const cmd = getCommandById('pane.close');
      expect(cmd).toBeDefined();
      expect(cmd!.defaultBinding).toEqual({
        key: 'w',
        mod: true,
        shift: false,
        alt: false,
      });
    });

    it('pane.open-browser has Ctrl+Shift+B default binding', () => {
      const cmd = getCommandById('pane.open-browser');
      expect(cmd).toBeDefined();
      expect(cmd!.defaultBinding).toEqual({
        key: 'b',
        mod: true,
        shift: true,
        alt: false,
      });
    });

    it('workspace.create has Ctrl+N default binding', () => {
      const cmd = getCommandById('workspace.create');
      expect(cmd).toBeDefined();
      expect(cmd!.defaultBinding).toEqual({
        key: 'n',
        mod: true,
        shift: false,
        alt: false,
      });
    });

    it('app.toggle-notifications has Ctrl+I default binding', () => {
      const cmd = getCommandById('app.toggle-notifications');
      expect(cmd).toBeDefined();
      expect(cmd!.defaultBinding).toEqual({
        key: 'i',
        mod: true,
        shift: false,
        alt: false,
      });
    });

    it('app.open-project has Ctrl+Shift+O default binding', () => {
      const cmd = getCommandById('app.open-project');
      expect(cmd).toBeDefined();
      expect(cmd!.defaultBinding).toEqual({
        key: 'o',
        mod: true,
        shift: true,
        alt: false,
      });
    });

    it('navigation commands have correct default bindings', () => {
      const directions = [
        { id: 'navigation.focus-up', key: 'ArrowUp' },
        { id: 'navigation.focus-down', key: 'ArrowDown' },
        { id: 'navigation.focus-left', key: 'ArrowLeft' },
        { id: 'navigation.focus-right', key: 'ArrowRight' },
      ];
      for (const { id, key } of directions) {
        const cmd = getCommandById(id);
        expect(cmd).toBeDefined();
        expect(cmd!.defaultBinding).toEqual({
          key,
          mod: true,
          shift: false,
          alt: false,
        });
      }
    });

    it('all commands have non-empty description', () => {
      for (const cmd of getCommands()) {
        expect(cmd.description.length).toBeGreaterThan(0);
      }
    });

    it('all commands have non-empty label', () => {
      for (const cmd of getCommands()) {
        expect(cmd.label.length).toBeGreaterThan(0);
      }
    });
  });
});
