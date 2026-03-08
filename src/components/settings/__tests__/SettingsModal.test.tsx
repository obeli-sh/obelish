import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SettingsModal } from '../SettingsModal';

describe('SettingsModal', () => {
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <SettingsModal isOpen={false} onClose={onClose}>
        <div>Content</div>
      </SettingsModal>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders dialog with children when open', () => {
    render(
      <SettingsModal isOpen={true} onClose={onClose}>
        <div>Settings Content</div>
      </SettingsModal>,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Settings');
    expect(screen.getByText('Settings Content')).toBeInTheDocument();
  });

  it('closes on Escape key', async () => {
    const user = userEvent.setup();
    render(
      <SettingsModal isOpen={true} onClose={onClose}>
        <div>Content</div>
      </SettingsModal>,
    );

    await user.keyboard('{Escape}');

    expect(onClose).toHaveBeenCalled();
  });

  it('closes on backdrop click', async () => {
    const user = userEvent.setup();
    render(
      <SettingsModal isOpen={true} onClose={onClose}>
        <div>Content</div>
      </SettingsModal>,
    );

    await user.click(screen.getByTestId('settings-backdrop'));

    expect(onClose).toHaveBeenCalled();
  });

  it('does not close when clicking inside modal content', async () => {
    const user = userEvent.setup();
    render(
      <SettingsModal isOpen={true} onClose={onClose}>
        <div>Content</div>
      </SettingsModal>,
    );

    await user.click(screen.getByText('Content'));

    expect(onClose).not.toHaveBeenCalled();
  });
});
