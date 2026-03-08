import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { CommandPalette } from '../CommandPalette';
import type { Command } from '../../../lib/commands';
import { useSettingsStore } from '../../../stores/settingsStore';

function makeCommand(id: string, label: string, category: Command['category'] = 'app'): Command {
  return {
    id,
    label,
    description: `Description for ${label}`,
    category,
    defaultBinding: null,
    execute: vi.fn(),
  };
}

const testCommands: Command[] = [
  makeCommand('cmd.alpha', 'Alpha Command', 'app'),
  makeCommand('cmd.beta', 'Beta Command', 'pane'),
];

describe('CommandPalette snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.getState().resetAllKeybindings();
  });

  it('matches snapshot when open with commands', () => {
    const { container } = render(
      <CommandPalette isOpen={true} onClose={vi.fn()} commands={testCommands} onExecute={vi.fn()} />,
    );
    expect(container).toMatchSnapshot();
  });

  it('matches snapshot when closed', () => {
    const { container } = render(
      <CommandPalette isOpen={false} onClose={vi.fn()} commands={testCommands} onExecute={vi.fn()} />,
    );
    expect(container).toMatchSnapshot();
  });
});
