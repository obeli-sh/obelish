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
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <div role="tablist" style={{ display: 'flex' }}>
        {surfaces.map((surface) => (
          <div
            key={surface.id}
            role="tab"
            aria-selected={surface.id === activeSurfaceId}
            onClick={() => onSurfaceSelect(surface.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              cursor: 'pointer',
            }}
          >
            <span>{surface.name}</span>
            <button
              aria-label="close"
              onClick={(e) => {
                e.stopPropagation();
                onSurfaceClose(surface.id);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      <button aria-label="new surface" onClick={onSurfaceCreate}>
        +
      </button>
    </div>
  );
}
