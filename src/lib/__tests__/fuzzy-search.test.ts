// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { fuzzySearchCommands } from '../fuzzy-search';
import type { Command } from '../commands';
import type { KeyBinding } from '../keybinding-utils';

function makeCommand(
  id: string,
  label: string,
  description: string,
  category: Command['category'],
  defaultBinding: KeyBinding | null = null,
): Command {
  return { id, label, description, category, defaultBinding, execute: () => {} };
}

const testCommands: Command[] = [
  makeCommand('pane.split-horizontal', 'Split Horizontal', 'Split the current pane horizontally', 'pane'),
  makeCommand('pane.split-vertical', 'Split Vertical', 'Split the current pane vertically', 'pane'),
  makeCommand('pane.close', 'Close Pane', 'Close the current pane', 'pane'),
  makeCommand('workspace.create', 'New Workspace', 'Create a new workspace', 'workspace'),
  makeCommand('app.toggle-settings', 'Settings', 'Open application settings', 'app'),
  makeCommand('navigation.focus-up', 'Focus Up', 'Focus the pane above', 'navigation'),
];

describe('fuzzySearchCommands', () => {
  it('returns all commands for empty query', () => {
    const results = fuzzySearchCommands(testCommands, '');
    expect(results).toHaveLength(testCommands.length);
  });

  it('finds commands by exact label match', () => {
    const results = fuzzySearchCommands(testCommands, 'Close Pane');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe('pane.close');
  });

  it('finds commands by partial label match', () => {
    const results = fuzzySearchCommands(testCommands, 'Split');
    expect(results.length).toBeGreaterThanOrEqual(2);
    const ids = results.map((r) => r.id);
    expect(ids).toContain('pane.split-horizontal');
    expect(ids).toContain('pane.split-vertical');
  });

  it('finds commands by fuzzy match', () => {
    const results = fuzzySearchCommands(testCommands, 'horiz');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe('pane.split-horizontal');
  });

  it('finds commands by description match', () => {
    const results = fuzzySearchCommands(testCommands, 'application settings');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe('app.toggle-settings');
  });

  it('finds commands by category match', () => {
    const results = fuzzySearchCommands(testCommands, 'navigation');
    expect(results.length).toBeGreaterThanOrEqual(1);
    const ids = results.map((r) => r.id);
    expect(ids).toContain('navigation.focus-up');
  });

  it('returns empty array for no match', () => {
    const results = fuzzySearchCommands(testCommands, 'zzzzxyzzy');
    expect(results).toHaveLength(0);
  });

  it('ranks exact matches higher than fuzzy matches', () => {
    const results = fuzzySearchCommands(testCommands, 'Settings');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].id).toBe('app.toggle-settings');
  });

  it('handles single character query', () => {
    // Should not crash and should return some results
    const results = fuzzySearchCommands(testCommands, 'S');
    expect(Array.isArray(results)).toBe(true);
  });

  it('handles empty command list', () => {
    const results = fuzzySearchCommands([], 'test');
    expect(results).toHaveLength(0);
  });

  it('returns all commands for whitespace-only query', () => {
    const results = fuzzySearchCommands(testCommands, '   ');
    expect(results).toHaveLength(testCommands.length);
  });

  it('returns all commands for tab-only query', () => {
    const results = fuzzySearchCommands(testCommands, '\t');
    expect(results).toHaveLength(testCommands.length);
  });

  it('returns the original commands array reference for empty query', () => {
    const results = fuzzySearchCommands(testCommands, '');
    expect(results).toBe(testCommands);
  });

  it('returns new array (not original) for non-empty query with results', () => {
    const results = fuzzySearchCommands(testCommands, 'Split');
    expect(results).not.toBe(testCommands);
  });

  it('maps fuse results to command items (not fuse result wrappers)', () => {
    const results = fuzzySearchCommands(testCommands, 'Close Pane');
    expect(results[0]).toHaveProperty('id');
    expect(results[0]).toHaveProperty('execute');
    expect(results[0]).not.toHaveProperty('score');
    expect(results[0]).not.toHaveProperty('item');
  });

  it('returns empty for query that does not match any field', () => {
    const results = fuzzySearchCommands(testCommands, 'zzzzz99999');
    expect(results).toHaveLength(0);
  });
});
