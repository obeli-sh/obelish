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
  borderRadius: 'var(--ui-radius)',
  border: '1px solid color-mix(in srgb, var(--ui-accent) 55%, transparent)',
  backgroundColor: 'color-mix(in srgb, var(--ui-accent) 15%, transparent)',
  color: 'var(--ui-accent)',
  fontSize: 11,
  fontWeight: 600,
  fontFamily: 'var(--ui-font-mono)',
};
