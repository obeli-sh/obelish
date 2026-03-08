import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NotificationPanel } from '../NotificationPanel';
import { useNotificationStore } from '../../../stores/notificationStore';
import type { Notification } from '../../../lib/workspace-types';

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: 'n-1',
    paneId: 'pane-1',
    workspaceId: 'ws-1',
    oscType: 9,
    title: 'Test notification',
    body: null,
    timestamp: 1700000000000,
    read: false,
    ...overrides,
  };
}

describe('NotificationPanel snapshots', () => {
  beforeEach(() => {
    useNotificationStore.setState({ notifications: [] });
  });

  it('matches snapshot with notifications', () => {
    useNotificationStore.setState({
      notifications: [
        makeNotification({ id: 'n-1', title: 'Build complete' }),
        makeNotification({ id: 'n-2', title: 'Tests passed', body: 'All 100 tests passed' }),
      ],
    });
    const { container } = render(<NotificationPanel isOpen={true} onClose={vi.fn()} />);
    expect(container).toMatchSnapshot();
  });

  it('matches snapshot with empty state', () => {
    const { container } = render(<NotificationPanel isOpen={true} onClose={vi.fn()} />);
    expect(container).toMatchSnapshot();
  });
});

describe('NotificationPanel behavioral', () => {
  beforeEach(() => {
    useNotificationStore.setState({ notifications: [] });
  });

  it('renders notification titles in the DOM', () => {
    useNotificationStore.setState({
      notifications: [
        makeNotification({ id: 'n-1', title: 'Build complete' }),
        makeNotification({ id: 'n-2', title: 'Tests passed' }),
      ],
    });
    render(<NotificationPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Build complete')).toBeInTheDocument();
    expect(screen.getByText('Tests passed')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<NotificationPanel isOpen={true} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('shows empty state message when there are no notifications', () => {
    render(<NotificationPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('No notifications')).toBeInTheDocument();
  });
});
