export interface NotificationBadgeProps {
  count: number;
}

export function NotificationBadge({ count }: NotificationBadgeProps) {
  if (count === 0) return null;

  return (
    <span data-testid="notification-badge" style={badgeStyle}>
      {count > 9 ? '9+' : count}
    </span>
  );
}

const badgeStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  minWidth: '18px',
  height: '18px',
  padding: '0 4px',
  borderRadius: '9px',
  backgroundColor: '#f38ba8',
  color: '#1e1e2e',
  fontSize: '11px',
  fontWeight: 'bold',
};
