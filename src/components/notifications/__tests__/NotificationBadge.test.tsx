import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NotificationBadge } from '../NotificationBadge';

describe('NotificationBadge', () => {
  it('shows_unread_count', () => {
    render(<NotificationBadge count={5} />);
    expect(screen.getByText('5')).toBeInTheDocument();
  });

  it('hidden_when_zero', () => {
    const { container } = render(<NotificationBadge count={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('shows_9_plus_for_large_counts', () => {
    render(<NotificationBadge count={15} />);
    expect(screen.getByText('9+')).toBeInTheDocument();
  });
});
