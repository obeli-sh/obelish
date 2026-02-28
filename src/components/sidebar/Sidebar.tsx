import { useCallback, useRef, useState } from 'react';
import type { WorkspaceInfo, LayoutNode } from '../../lib/workspace-types';
import { WorkspaceMetadata } from './WorkspaceMetadata';

export interface SidebarProps {
  workspaces: WorkspaceInfo[];
  activeWorkspaceId: string;
  onWorkspaceSelect: (id: string) => void;
  onWorkspaceCreate: () => void;
  onWorkspaceClose: (id: string) => void;
}

function findFirstLeafPaneId(node: LayoutNode): string | null {
  if (node.type === 'leaf') return node.paneId;
  return findFirstLeafPaneId(node.children[0]);
}

function getWorkspacePaneId(ws: WorkspaceInfo): string | null {
  const surface = ws.surfaces[ws.activeSurfaceIndex];
  if (!surface) return null;
  return findFirstLeafPaneId(surface.layout);
}

export function Sidebar({
  workspaces,
  activeWorkspaceId,
  onWorkspaceSelect,
  onWorkspaceCreate,
  onWorkspaceClose,
}: SidebarProps) {
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const listRef = useRef<HTMLUListElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (workspaces.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((prev) => Math.min(prev + 1, workspaces.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) => Math.max(prev - 1, 0));
      } else if (e.key === 'Enter' && focusedIndex >= 0 && focusedIndex < workspaces.length) {
        e.preventDefault();
        onWorkspaceSelect(workspaces[focusedIndex].id);
      }
    },
    [workspaces, focusedIndex, onWorkspaceSelect],
  );

  const handleWorkspaceClick = useCallback(
    (id: string, index: number) => {
      setFocusedIndex(index);
      onWorkspaceSelect(id);
    },
    [onWorkspaceSelect],
  );

  return (
    <nav style={navStyle} onKeyDown={handleKeyDown}>
      <ul ref={listRef} role="list" style={listStyle}>
        {workspaces.map((ws, index) => {
          const paneId = getWorkspacePaneId(ws);
          return (
            <li
              key={ws.id}
              data-active={ws.id === activeWorkspaceId ? 'true' : 'false'}
              data-focused={index === focusedIndex ? 'true' : 'false'}
              style={{
                ...itemStyle,
                ...(ws.id === activeWorkspaceId ? activeItemStyle : {}),
              }}
            >
              <div style={itemContentStyle}>
                <div style={itemHeaderStyle}>
                  <button
                    style={nameButtonStyle}
                    onClick={() => handleWorkspaceClick(ws.id, index)}
                  >
                    {ws.name}
                  </button>
                  <button
                    aria-label={`Close ${ws.name}`}
                    style={closeButtonStyle}
                    onClick={() => onWorkspaceClose(ws.id)}
                  >
                    ×
                  </button>
                </div>
                {paneId && <WorkspaceMetadata paneId={paneId} />}
              </div>
            </li>
          );
        })}
      </ul>
      <button
        aria-label="New Workspace"
        style={createButtonStyle}
        onClick={onWorkspaceCreate}
      >
        + New Workspace
      </button>
    </nav>
  );
}

const navStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  width: '200px',
  backgroundColor: '#1e1e2e',
  color: '#cdd6f4',
};

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  flex: 1,
  overflow: 'auto',
};

const itemStyle: React.CSSProperties = {
  padding: '4px 8px',
  cursor: 'pointer',
};

const itemContentStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

const itemHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
};

const activeItemStyle: React.CSSProperties = {
  backgroundColor: '#313244',
};

const nameButtonStyle: React.CSSProperties = {
  flex: 1,
  background: 'none',
  border: 'none',
  color: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  padding: '4px',
  font: 'inherit',
};

const closeButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'inherit',
  cursor: 'pointer',
  padding: '4px 8px',
  fontSize: '16px',
};

const createButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  borderTop: '1px solid #313244',
  color: '#cdd6f4',
  padding: '12px 8px',
  cursor: 'pointer',
  textAlign: 'left',
  font: 'inherit',
};
