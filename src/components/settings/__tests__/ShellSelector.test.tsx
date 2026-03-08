import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { invoke } from '@tauri-apps/api/core';
import { mockInvoke, clearInvokeMocks } from '@tauri-apps/api/core';
import { ShellSelector } from '../ShellSelector';
import { useSettingsStore } from '../../../stores/settingsStore';

describe('ShellSelector', () => {
  const mockShells = [
    { path: '/bin/bash', name: 'Bash' },
    { path: '/usr/bin/zsh', name: 'Zsh' },
    { path: '/usr/bin/fish', name: 'Fish' },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    clearInvokeMocks();
    useSettingsStore.setState({ defaultShell: '' });
    mockInvoke('shell_list', () => Promise.resolve(mockShells));
    mockInvoke('settings_update', () => Promise.resolve());
  });

  it('renders a radiogroup with shell options', async () => {
    render(<ShellSelector />);

    await screen.findByRole('radiogroup');

    // Auto-detect + 3 shells = 4 radio options
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(4);
  });

  it('shows Auto-detect as first option', async () => {
    render(<ShellSelector />);

    await screen.findByRole('radiogroup');

    const radios = screen.getAllByRole('radio');
    expect(radios[0]).toHaveAccessibleName(/auto-detect/i);
  });

  it('lists each discovered shell with name and path', async () => {
    render(<ShellSelector />);

    await screen.findByRole('radiogroup');

    expect(screen.getByText('Bash')).toBeInTheDocument();
    expect(screen.getByText('/bin/bash')).toBeInTheDocument();
    expect(screen.getByText('Zsh')).toBeInTheDocument();
    expect(screen.getByText('/usr/bin/zsh')).toBeInTheDocument();
    expect(screen.getByText('Fish')).toBeInTheDocument();
    expect(screen.getByText('/usr/bin/fish')).toBeInTheDocument();
  });

  it('highlights currently selected shell from store', async () => {
    useSettingsStore.setState({ defaultShell: '/usr/bin/zsh' });
    render(<ShellSelector />);

    await screen.findByRole('radiogroup');

    const zshRadio = screen.getByRole('radio', { name: /zsh/i });
    expect(zshRadio).toBeChecked();
  });

  it('selects Auto-detect when defaultShell is empty', async () => {
    useSettingsStore.setState({ defaultShell: '' });
    render(<ShellSelector />);

    await screen.findByRole('radiogroup');

    const autoRadio = screen.getByRole('radio', { name: /auto-detect/i });
    expect(autoRadio).toBeChecked();
  });

  it('calls updateDefaultShell on selection change', async () => {
    const user = userEvent.setup();
    render(<ShellSelector />);

    await screen.findByRole('radiogroup');

    await user.click(screen.getByText('Fish'));

    expect(useSettingsStore.getState().defaultShell).toBe('/usr/bin/fish');
  });

  it('renders a label for the group', async () => {
    render(<ShellSelector />);

    await screen.findByText('Default Shell');
  });

  it('handles empty shell list gracefully', async () => {
    mockInvoke('shell_list', () => Promise.resolve([]));
    render(<ShellSelector />);

    await screen.findByRole('radiogroup');

    // Only Auto-detect option
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(1);
  });

  it('handles shell list fetch error gracefully', async () => {
    mockInvoke('shell_list', () => Promise.reject(new Error('backend error')));
    render(<ShellSelector />);

    await screen.findByRole('radiogroup');

    // Only Auto-detect option on error
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(1);
  });

  it('can switch from a shell back to Auto-detect', async () => {
    useSettingsStore.setState({ defaultShell: '/bin/bash' });
    const user = userEvent.setup();
    render(<ShellSelector />);

    await screen.findByRole('radiogroup');

    expect(screen.getByRole('radio', { name: /bash/i })).toBeChecked();

    await user.click(screen.getByText('Auto-detect'));

    expect(useSettingsStore.getState().defaultShell).toBe('');
    expect(screen.getByRole('radio', { name: /auto-detect/i })).toBeChecked();
  });

  it('shows a checkmark indicator on the selected option', async () => {
    useSettingsStore.setState({ defaultShell: '/usr/bin/zsh' });
    render(<ShellSelector />);

    await screen.findByRole('radiogroup');

    // The selected option should have a visible checkmark
    const zshOption = screen.getByRole('radio', { name: /zsh/i }).closest('[data-shell-option]');
    expect(zshOption).toHaveAttribute('data-selected', 'true');
  });

  it('falls back to Auto-detect when saved default shell is missing', async () => {
    useSettingsStore.setState({ defaultShell: '/missing/shell' });
    render(<ShellSelector />);

    await screen.findByRole('radiogroup');

    await waitFor(() => {
      expect(screen.getByRole('radio', { name: /auto-detect/i })).toBeChecked();
      expect(useSettingsStore.getState().defaultShell).toBe('');
    });

    expect(invoke).toHaveBeenCalledWith('settings_update', { key: 'defaultShell', value: '' });
  });
});
