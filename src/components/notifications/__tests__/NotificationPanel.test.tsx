import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    timestamp: Date.now(),
    read: false,
    ...overrides,
  };
}

describe('NotificationPanel', () => {
  beforeEach(() => {
    useNotificationStore.setState({ notifications: [] });
  });

  it('renders_when_open', () => {
    render(<NotificationPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByTestId('notification-panel')).toBeInTheDocument();
  });

  it('hidden_when_closed', () => {
    render(<NotificationPanel isOpen={false} onClose={vi.fn()} />);
    expect(screen.queryByTestId('notification-panel')).not.toBeInTheDocument();
  });

  it('shows_notification_list', () => {
    useNotificationStore.setState({
      notifications: [
        makeNotification({ id: 'n-1', title: 'First alert' }),
        makeNotification({ id: 'n-2', title: 'Second alert' }),
      ],
    });

    render(<NotificationPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('First alert')).toBeInTheDocument();
    expect(screen.getByText('Second alert')).toBeInTheDocument();
  });

  it('shows_empty_state', () => {
    render(<NotificationPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('No notifications')).toBeInTheDocument();
  });

  it('close_button_calls_onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<NotificationPanel isOpen={true} onClose={onClose} />);

    const closeButton = screen.getByRole('button', { name: /close/i });
    await user.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('notification_item_shows_title_and_body', () => {
    useNotificationStore.setState({
      notifications: [
        makeNotification({ id: 'n-1', title: 'Build done', body: 'Project compiled successfully' }),
      ],
    });

    render(<NotificationPanel isOpen={true} onClose={vi.fn()} />);
    expect(screen.getByText('Build done')).toBeInTheDocument();
    expect(screen.getByText('Project compiled successfully')).toBeInTheDocument();
  });
});
