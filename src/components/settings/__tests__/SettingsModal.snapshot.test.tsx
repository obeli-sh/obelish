import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsModal } from '../SettingsModal';

describe('SettingsModal snapshots', () => {
  it('matches snapshot when open', () => {
    const { container } = render(
      <SettingsModal isOpen={true} onClose={vi.fn()}>
        <div>Settings Content</div>
      </SettingsModal>,
    );
    expect(container).toMatchSnapshot();
  });

  it('matches snapshot when closed', () => {
    const { container } = render(
      <SettingsModal isOpen={false} onClose={vi.fn()}>
        <div>Settings Content</div>
      </SettingsModal>,
    );
    expect(container).toMatchSnapshot();
  });
});

describe('SettingsModal behavioral', () => {
  it('renders children when open', () => {
    render(
      <SettingsModal isOpen={true} onClose={vi.fn()}>
        <div>Settings Content</div>
      </SettingsModal>,
    );
    expect(screen.getByText('Settings Content')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <SettingsModal isOpen={false} onClose={vi.fn()}>
        <div>Settings Content</div>
      </SettingsModal>,
    );
    expect(container.innerHTML).toBe('');
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(
      <SettingsModal isOpen={true} onClose={onClose}>
        <div>Settings Content</div>
      </SettingsModal>,
    );
    fireEvent.click(screen.getByTestId('settings-backdrop'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
