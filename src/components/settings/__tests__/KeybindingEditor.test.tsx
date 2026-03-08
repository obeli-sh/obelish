import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { KeybindingEditor } from '../KeybindingEditor';
import type { Command } from '../../../lib/commands';
import type { KeyBinding } from '../../../lib/keybinding-utils';

function makeCommand(
  id: string,
  label: string,
  category: Command['category'],
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
  makeCommand('pane.split', 'Split Pane', 'pane', { key: 'h', mod: true, shift: true, alt: false }),
  makeCommand('pane.close', 'Close Pane', 'pane', { key: 'w', mod: true, shift: false, alt: false }),
  makeCommand('app.settings', 'Settings', 'app', { key: ',', mod: true, shift: false, alt: false }),
  makeCommand('nav.up', 'Focus Up', 'navigation', { key: 'ArrowUp', mod: true, shift: false, alt: false }),
];

const testKeybindings: Record<string, KeyBinding> = {
  'pane.split': { key: 'h', mod: true, shift: true, alt: false },
  'pane.close': { key: 'w', mod: true, shift: false, alt: false },
  'app.settings': { key: ',', mod: true, shift: false, alt: false },
  'nav.up': { key: 'ArrowUp', mod: true, shift: false, alt: false },
};

describe('KeybindingEditor', () => {
  const onUpdate = vi.fn();
  const onReset = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    });
  });

  it('lists all commands with their keybindings', () => {
    render(
      <KeybindingEditor
        commands={testCommands}
        keybindings={testKeybindings}
        onUpdate={onUpdate}
        onReset={onReset}
      />,
    );

    expect(screen.getByText('Split Pane')).toBeInTheDocument();
    expect(screen.getByText('Close Pane')).toBeInTheDocument();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Focus Up')).toBeInTheDocument();
  });

  it('groups commands by category', () => {
    render(
      <KeybindingEditor
        commands={testCommands}
        keybindings={testKeybindings}
        onUpdate={onUpdate}
        onReset={onReset}
      />,
    );

    // Category headers should be rendered
    expect(screen.getByText('pane')).toBeInTheDocument();
    expect(screen.getByText('app')).toBeInTheDocument();
    expect(screen.getByText('navigation')).toBeInTheDocument();
  });

  it('enters recording mode when clicking a keybinding', async () => {
    const user = userEvent.setup();
    render(
      <KeybindingEditor
        commands={testCommands}
        keybindings={testKeybindings}
        onUpdate={onUpdate}
        onReset={onReset}
      />,
    );

    // Click the keybinding display for "Split Pane" (Ctrl+Shift+H)
    await user.click(screen.getByText('Ctrl+Shift+H'));

    expect(screen.getByText(/press a key/i)).toBeInTheDocument();
  });

  it('records a new key combo and calls onUpdate', async () => {
    const user = userEvent.setup();
    render(
      <KeybindingEditor
        commands={testCommands}
        keybindings={testKeybindings}
        onUpdate={onUpdate}
        onReset={onReset}
      />,
    );

    // Click the keybinding to enter recording mode
    await user.click(screen.getByText('Ctrl+Shift+H'));

    // Press a new key combo
    await user.keyboard('{Control>}k{/Control}');

    expect(onUpdate).toHaveBeenCalledWith('pane.split', {
      key: 'k',
      mod: true,
      shift: false,
      alt: false,
    });
  });

  it('shows conflict warning when binding conflicts with another', () => {
    // Both commands have the same binding
    const conflictingBindings: Record<string, KeyBinding> = {
      ...testKeybindings,
      'pane.close': { key: 'h', mod: true, shift: true, alt: false }, // Same as pane.split
    };

    render(
      <KeybindingEditor
        commands={testCommands}
        keybindings={conflictingBindings}
        onUpdate={onUpdate}
        onReset={onReset}
      />,
    );

    const conflictWarnings = screen.getAllByText(/conflict/i);
    expect(conflictWarnings.length).toBeGreaterThanOrEqual(2);
  });

  it('calls onReset when reset button is clicked', async () => {
    const user = userEvent.setup();
    render(
      <KeybindingEditor
        commands={testCommands}
        keybindings={testKeybindings}
        onUpdate={onUpdate}
        onReset={onReset}
      />,
    );

    const resetButtons = screen.getAllByRole('button', { name: /reset/i });
    expect(resetButtons.length).toBeGreaterThan(0);

    await user.click(resetButtons[0]);

    expect(onReset).toHaveBeenCalled();
  });

  it('cancels recording mode on Escape', async () => {
    const user = userEvent.setup();
    render(
      <KeybindingEditor
        commands={testCommands}
        keybindings={testKeybindings}
        onUpdate={onUpdate}
        onReset={onReset}
      />,
    );

    // Enter recording mode
    await user.click(screen.getByText('Ctrl+Shift+H'));
    expect(screen.getByText(/press a key/i)).toBeInTheDocument();

    // Press Escape to cancel
    await user.keyboard('{Escape}');

    expect(screen.queryByText(/press a key/i)).not.toBeInTheDocument();
    expect(onUpdate).not.toHaveBeenCalled();
  });

  it('displays keybinding strings correctly', () => {
    render(
      <KeybindingEditor
        commands={testCommands}
        keybindings={testKeybindings}
        onUpdate={onUpdate}
        onReset={onReset}
      />,
    );

    expect(screen.getByText('Ctrl+Shift+H')).toBeInTheDocument();
    expect(screen.getByText('Ctrl+W')).toBeInTheDocument();
  });
});
