import { useNotificationStore } from '../../stores/notificationStore';

export interface NotificationPanelProps {
  isOpen: boolean;
  onClose: () => void;
}

function formatRelativeTime(timestamp: number): string {
  const now = Date.now();
  const diff = Math.max(0, now - timestamp);
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function NotificationPanel({ isOpen, onClose }: NotificationPanelProps) {
  const notifications = useNotificationStore((s) => s.notifications);

  if (!isOpen) return null;

  return (
    <div data-testid="notification-panel" style={panelStyle}>
      <div style={headerStyle}>
        <span style={headerTitleStyle}>Notifications</span>
        <button aria-label="Close" style={closeButtonStyle} onClick={onClose}>
          ×
        </button>
      </div>
      <div style={listStyle}>
        {notifications.length === 0 ? (
          <div style={emptyStyle}>No notifications</div>
        ) : (
          notifications.map((n) => (
            <div key={n.id} style={itemStyle} data-read={n.read ? 'true' : 'false'}>
              <div style={itemTitleStyle}>{n.title}</div>
              {n.body && <div style={itemBodyStyle}>{n.body}</div>}
              <div style={itemMetaStyle}>
                <span>{formatRelativeTime(n.timestamp)}</span>
                <span>pane: {n.paneId}</span>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const panelStyle: React.CSSProperties = {
  width: '300px',
  height: '100%',
  backgroundColor: '#181825',
  borderLeft: '1px solid #313244',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '12px',
  borderBottom: '1px solid #313244',
};

const headerTitleStyle: React.CSSProperties = {
  color: '#cdd6f4',
  fontWeight: 'bold',
  fontSize: '14px',
};

const closeButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: '#a6adc8',
  cursor: 'pointer',
  fontSize: '18px',
  padding: '4px 8px',
};

const listStyle: React.CSSProperties = {
  flex: 1,
  overflow: 'auto',
};

const emptyStyle: React.CSSProperties = {
  padding: '24px',
  textAlign: 'center',
  color: '#6c7086',
  fontSize: '13px',
};

const itemStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderBottom: '1px solid #313244',
};

const itemTitleStyle: React.CSSProperties = {
  color: '#cdd6f4',
  fontSize: '13px',
  fontWeight: 500,
};

const itemBodyStyle: React.CSSProperties = {
  color: '#a6adc8',
  fontSize: '12px',
  marginTop: '4px',
};

const itemMetaStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  color: '#6c7086',
  fontSize: '11px',
  marginTop: '4px',
};
