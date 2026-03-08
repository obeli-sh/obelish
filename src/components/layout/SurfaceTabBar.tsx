import type { SurfaceInfo } from '../../lib/workspace-types';

interface SurfaceTabBarProps {
  surfaces: SurfaceInfo[];
  activeSurfaceId: string;
  onSurfaceSelect: (id: string) => void;
  onSurfaceCreate: () => void;
  onSurfaceClose: (id: string) => void;
}

export function SurfaceTabBar({
  surfaces,
  activeSurfaceId,
  onSurfaceSelect,
  onSurfaceCreate,
  onSurfaceClose,
}: SurfaceTabBarProps) {
  return (
    <div className="panel" style={containerStyle}>
      <div role="tablist" style={tabListStyle}>
        {surfaces.map((surface) => {
          const isActive = surface.id === activeSurfaceId;
          return (
            <div
              key={surface.id}
              role="tab"
              aria-selected={isActive}
              onClick={() => onSurfaceSelect(surface.id)}
              style={{
                ...tabStyle,
                ...(isActive ? activeTabStyle : {}),
              }}
            >
              <span style={tabLabelStyle}>{surface.name}</span>
              <button
                aria-label="close"
                onClick={(e) => {
                  e.stopPropagation();
                  onSurfaceClose(surface.id);
                }}
                onMouseDown={(e) => {
                  if (e.button !== 1) return;
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onAuxClick={(e) => {
                  if (e.button !== 1) return;
                  e.preventDefault();
                  e.stopPropagation();
                  onSurfaceClose(surface.id);
                }}
                style={closeButtonStyle}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <button aria-label="new surface" onClick={onSurfaceCreate} style={addButtonStyle}>
        +
      </button>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '7px 8px',
  background: 'var(--ui-panel-bg)',
};

const tabListStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flex: 1,
  gap: 6,
  minWidth: 0,
};

const tabStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  cursor: 'pointer',
  gap: 8,
  borderStyle: 'solid',
  borderWidth: 1,
  borderColor: 'transparent',
  borderRadius: 'var(--ui-radius)',
  background: 'rgba(255, 255, 255, 0.01)',
  padding: '5px 8px',
  minWidth: 0,
};

const activeTabStyle: React.CSSProperties = {
  borderColor: 'var(--ui-accent)',
  background: 'color-mix(in srgb, var(--ui-accent) 8%, transparent)',
};

const tabLabelStyle: React.CSSProperties = {
  fontFamily: 'var(--ui-font-mono)',
  letterSpacing: '0.08em',
  fontSize: 11,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const closeButtonStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid transparent',
  color: 'var(--ui-text-primary)',
  cursor: 'pointer',
  width: 18,
  height: 18,
  lineHeight: 1,
  fontSize: 13,
  padding: 0,
  fontFamily: 'var(--ui-font-mono)',
  borderRadius: 'var(--ui-radius)',
};

const addButtonStyle: React.CSSProperties = {
  width: 26,
  height: 24,
  border: '1px solid var(--ui-border)',
  borderRadius: 'var(--ui-radius)',
  background: 'var(--ui-panel-bg)',
  color: 'var(--ui-accent)',
  cursor: 'pointer',
  fontFamily: 'var(--ui-font-mono)',
  fontSize: 14,
  lineHeight: 1,
  padding: 0,
};
