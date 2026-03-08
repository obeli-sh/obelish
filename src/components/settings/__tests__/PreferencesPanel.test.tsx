import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockInvoke, clearInvokeMocks } from '@tauri-apps/api/core';
import { PreferencesPanel } from '../PreferencesPanel';
import { useSettingsStore, defaultThemeColors } from '../../../stores/settingsStore';
import type { Command } from '../../../lib/commands';
import type { KeyBinding } from '../../../lib/keybinding-utils';

const testCommands: Command[] = [
  {
    id: 'pane.split',
    label: 'Split Pane',
    description: 'Split the active pane',
    category: 'pane',
    defaultBinding: { key: 'h', mod: true, shift: true, alt: false },
    execute: vi.fn(),
  },
];

const testBindings: Record<string, KeyBinding> = {
  'pane.split': { key: 'h', mod: true, shift: true, alt: false },
};

describe('PreferencesPanel', () => {
  beforeEach(() => {
    clearInvokeMocks();
    mockInvoke('shell_list', () => Promise.resolve([
      { path: '/bin/bash', name: 'Bash' },
      { path: '/usr/bin/zsh', name: 'Zsh' },
    ]));
    mockInvoke('settings_update', () => Promise.resolve());
    useSettingsStore.setState({
      keybindings: testBindings,
      theme: 'dark',
      terminalFontFamily: '"Fira Mono", monospace',
      terminalFontSize: 14,
      scrollbackLines: 5000,
      preferredWorkspaceLayout: 'single',
      defaultShell: '',
      uiFontFamily: "'Fira Mono', monospace",
      uiFontSize: 13,
      themeColors: { ...defaultThemeColors },
    });
  });

  it('renders categories', () => {
    render(
      <PreferencesPanel
        commands={testCommands}
        keybindings={testBindings}
        onKeybindingUpdate={vi.fn()}
        onKeybindingReset={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: 'General' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hotkeys' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Theme' })).toBeInTheDocument();
  });

  it('updates general preferences', async () => {
    const user = userEvent.setup();
    render(
      <PreferencesPanel
        commands={testCommands}
        keybindings={testBindings}
        onKeybindingUpdate={vi.fn()}
        onKeybindingReset={vi.fn()}
      />,
    );

    await user.selectOptions(screen.getByRole('combobox', { name: /preferred new workspace layout/i }), 'stacked');
    expect(useSettingsStore.getState().preferredWorkspaceLayout).toBe('stacked');

    // ShellSelector shows a card-style shell picker populated from the backend
    await waitFor(() => {
      expect(screen.getByRole('radiogroup', { name: /default shell/i })).toBeInTheDocument();
    });
    await user.click(screen.getByText('Zsh'));
    expect(useSettingsStore.getState().defaultShell).toBe('/usr/bin/zsh');
  });

  it('shows keybinding editor in hotkeys category', async () => {
    const user = userEvent.setup();
    render(
      <PreferencesPanel
        commands={testCommands}
        keybindings={testBindings}
        onKeybindingUpdate={vi.fn()}
        onKeybindingReset={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Hotkeys' }));
    expect(screen.getByText('Keyboard Shortcuts')).toBeInTheDocument();
  });

  it('updates theme preferences', async () => {
    const user = userEvent.setup();
    render(
      <PreferencesPanel
        commands={testCommands}
        keybindings={testBindings}
        onKeybindingUpdate={vi.fn()}
        onKeybindingReset={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Theme' }));
    await user.clear(screen.getByRole('textbox', { name: /ui font family/i }));
    await user.type(screen.getByRole('textbox', { name: /ui font family/i }), 'IBM Plex Sans');

    await user.clear(screen.getByRole('spinbutton', { name: /ui font size/i }));
    await user.type(screen.getByRole('spinbutton', { name: /ui font size/i }), '15');

    await user.clear(screen.getByRole('textbox', { name: /accent hex/i }));
    await user.type(screen.getByRole('textbox', { name: /accent hex/i }), '#ff5500');

    expect(useSettingsStore.getState().uiFontFamily).toBe('IBM Plex Sans');
    expect(useSettingsStore.getState().uiFontSize).toBe(15);
    expect(useSettingsStore.getState().themeColors.accentColor).toBe('#ff5500');
  });
});
