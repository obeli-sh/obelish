import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';

vi.mock('../../terminal/TerminalPane', () => ({
  TerminalPane: vi.fn(({ paneId, ptyId, isActive }: { paneId: string; ptyId: string; isActive: boolean }) => (
    <div data-testid={`terminal-pane-${paneId}`} data-pty-id={ptyId} data-active={isActive} />
  )),
}));

import { PaneWrapper } from '../PaneWrapper';

describe('PaneWrapper', () => {
  const defaultProps = {
    paneId: 'pane-1',
    ptyId: 'pty-1',
    isActive: false,
    onClick: vi.fn(),
  };

  it('renders TerminalPane with correct props', () => {
    render(<PaneWrapper {...defaultProps} />);

    const terminal = screen.getByTestId('terminal-pane-pane-1');
    expect(terminal).toBeInTheDocument();
    expect(terminal).toHaveAttribute('data-pty-id', 'pty-1');
    expect(terminal).toHaveAttribute('data-active', 'false');
  });

  it('shows active border when isActive is true', () => {
    const { container } = render(<PaneWrapper {...defaultProps} isActive={true} />);

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.borderColor).toBe('rgb(59, 130, 246)');
  });

  it('shows no border when isActive is false', () => {
    const { container } = render(<PaneWrapper {...defaultProps} isActive={false} />);

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.borderColor).toBe('transparent');
  });

  it('calls onClick on click', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    const { container } = render(<PaneWrapper {...defaultProps} onClick={onClick} />);

    await user.click(container.firstChild as HTMLElement);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is memoized (React.memo)', () => {
    // PaneWrapper should be wrapped in React.memo
    // React.memo components have a $$typeof of Symbol.for('react.memo') or a 'compare' property
    expect(PaneWrapper).toHaveProperty('$$typeof', Symbol.for('react.memo'));
  });

  it('shows_blue_ring_when_notification', () => {
    const { container } = render(
      <PaneWrapper {...defaultProps} hasNotification={true} />,
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.borderColor).toBe('rgb(96, 165, 250)');
  });

  it('no_ring_when_no_notification', () => {
    const { container } = render(
      <PaneWrapper {...defaultProps} hasNotification={false} />,
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.borderColor).toBe('transparent');
  });
});
