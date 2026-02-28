import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CommandPalette } from '../CommandPalette';
import type { Command } from '../../../lib/commands';
import type { KeyBinding } from '../../../lib/keybinding-utils';
import { useSettingsStore } from '../../../stores/settingsStore';

function makeCommand(
  id: string,
  label: string,
  category: Command['category'] = 'app',
  defaultBinding: KeyBinding | null = null,
): Command {
  return {
    id,
    label,
    description: `Description for ${label}`,
    category,
    defaultBinding,
    execute: vi.fn(),
  };
}

const testCommands: Command[] = [
  makeCommand('cmd.alpha', 'Alpha Command', 'app', { key: 'a', mod: true, shift: false, alt: false }),
  makeCommand('cmd.beta', 'Beta Command', 'pane'),
  makeCommand('cmd.gamma', 'Gamma Split', 'pane', { key: 'g', mod: true, shift: true, alt: false }),
  makeCommand('cmd.delta', 'Delta Nav', 'navigation'),
];

describe('CommandPalette', () => {
  const onClose = vi.fn();
  const onExecute = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useSettingsStore.getState().resetAllKeybindings();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <CommandPalette isOpen={false} onClose={onClose} commands={testCommands} onExecute={onExecute} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders overlay dialog when open', () => {
    render(
      <CommandPalette isOpen={true} onClose={onClose} commands={testCommands} onExecute={onExecute} />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('palette-backdrop')).toBeInTheDocument();
  });

  it('auto-focuses search input on open', () => {
    render(
      <CommandPalette isOpen={true} onClose={onClose} commands={testCommands} onExecute={onExecute} />,
    );
    const searchbox = screen.getByRole('searchbox');
    expect(searchbox).toHaveFocus();
  });

  it('lists all commands when no query', () => {
    render(
      <CommandPalette isOpen={true} onClose={onClose} commands={testCommands} onExecute={onExecute} />,
    );
    const listbox = screen.getByRole('listbox');
    const options = within(listbox).getAllByRole('option');
    expect(options).toHaveLength(testCommands.length);
    expect(screen.getByText('Alpha Command')).toBeInTheDocument();
    expect(screen.getByText('Beta Command')).toBeInTheDocument();
  });

  it('filters commands based on search query', async () => {
    const user = userEvent.setup();
    render(
      <CommandPalette isOpen={true} onClose={onClose} commands={testCommands} onExecute={onExecute} />,
    );

    await user.type(screen.getByRole('searchbox'), 'Split');

    const options = screen.getAllByRole('option');
    expect(options.length).toBeLessThan(testCommands.length);
    expect(screen.getByText('Gamma Split')).toBeInTheDocument();
  });

  it('highlights the first result by default', () => {
    render(
      <CommandPalette isOpen={true} onClose={onClose} commands={testCommands} onExecute={onExecute} />,
    );
    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('navigates with ArrowDown and ArrowUp', async () => {
    const user = userEvent.setup();
    render(
      <CommandPalette isOpen={true} onClose={onClose} commands={testCommands} onExecute={onExecute} />,
    );

    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{ArrowDown}');
    const updatedOptions = screen.getAllByRole('option');
    expect(updatedOptions[1]).toHaveAttribute('aria-selected', 'true');
    expect(updatedOptions[0]).toHaveAttribute('aria-selected', 'false');

    await user.keyboard('{ArrowUp}');
    const finalOptions = screen.getAllByRole('option');
    expect(finalOptions[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('wraps around when navigating past last item', async () => {
    const user = userEvent.setup();
    render(
      <CommandPalette isOpen={true} onClose={onClose} commands={testCommands} onExecute={onExecute} />,
    );

    // Go past the last item
    for (let i = 0; i < testCommands.length; i++) {
      await user.keyboard('{ArrowDown}');
    }

    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('executes selected command on Enter', async () => {
    const user = userEvent.setup();
    render(
      <CommandPalette isOpen={true} onClose={onClose} commands={testCommands} onExecute={onExecute} />,
    );

    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');

    expect(onExecute).toHaveBeenCalledWith('cmd.beta');
    expect(onClose).toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    render(
      <CommandPalette isOpen={true} onClose={onClose} commands={testCommands} onExecute={onExecute} />,
    );

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
  });

  it('closes on backdrop click', async () => {
    const user = userEvent.setup();
    render(
      <CommandPalette isOpen={true} onClose={onClose} commands={testCommands} onExecute={onExecute} />,
    );

    await user.click(screen.getByTestId('palette-backdrop'));

    expect(onClose).toHaveBeenCalled();
  });

  it('displays keybinding badges for commands with bindings', () => {
    // Set a custom keybinding so we can verify display
    useSettingsStore.setState({
      keybindings: {
        'cmd.alpha': { key: 'a', mod: true, shift: false, alt: false },
        'cmd.gamma': { key: 'g', mod: true, shift: true, alt: false },
      },
    });

    render(
      <CommandPalette isOpen={true} onClose={onClose} commands={testCommands} onExecute={onExecute} />,
    );

    // On non-Mac, binding should show as Ctrl+A and Ctrl+Shift+G
    expect(screen.getByText('Ctrl+A')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+Shift+G')).toBeInTheDocument();
  });

  it('executes command on click', async () => {
    const user = userEvent.setup();
    render(
      <CommandPalette isOpen={true} onClose={onClose} commands={testCommands} onExecute={onExecute} />,
    );

    await user.click(screen.getByText('Beta Command'));

    expect(onExecute).toHaveBeenCalledWith('cmd.beta');
    expect(onClose).toHaveBeenCalled();
  });

  it('resets selected index when query changes', async () => {
    const user = userEvent.setup();
    render(
      <CommandPalette isOpen={true} onClose={onClose} commands={testCommands} onExecute={onExecute} />,
    );

    // Navigate down
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{ArrowDown}');

    // Type a query to filter - selected should reset to 0
    await user.type(screen.getByRole('searchbox'), 'Alpha');

    const options = screen.getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('does not execute when no results match', async () => {
    const user = userEvent.setup();
    render(
      <CommandPalette isOpen={true} onClose={onClose} commands={testCommands} onExecute={onExecute} />,
    );

    await user.type(screen.getByRole('searchbox'), 'zzzznonexistent');
    await user.keyboard('{Enter}');

    expect(onExecute).not.toHaveBeenCalled();
  });
});
