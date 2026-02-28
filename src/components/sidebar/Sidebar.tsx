import { useCallback, useEffect, useRef, useState } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { WorkspaceInfo, LayoutNode } from '../../lib/workspace-types';
import { WorkspaceMetadata } from './WorkspaceMetadata';
import { NotificationBadge } from '../notifications/NotificationBadge';
import { useNotificationStore } from '../../stores/notificationStore';

export interface SidebarProps {
  workspaces: WorkspaceInfo[];
  activeWorkspaceId: string;
  onWorkspaceSelect: (id: string) => void;
  onWorkspaceCreate: () => void;
  onWorkspaceClose: (id: string) => void;
  onWorkspaceReorder: (orderedIds: string[]) => void;
  onWorkspaceRename?: (id: string, newName: string) => void;
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

interface SortableWorkspaceItemProps {
  ws: WorkspaceInfo;
  index: number;
  activeWorkspaceId: string;
  focusedIndex: number;
  editingWorkspaceId: string | null;
  onWorkspaceClick: (id: string, index: number) => void;
  onWorkspaceClose: (id: string) => void;
  onStartEditing: (id: string) => void;
  onFinishEditing: () => void;
  onWorkspaceRename?: (id: string, newName: string) => void;
}

function SortableWorkspaceItem({
  ws,
  index,
  activeWorkspaceId,
  focusedIndex,
  editingWorkspaceId,
  onWorkspaceClick,
  onWorkspaceClose,
  onStartEditing,
  onFinishEditing,
  onWorkspaceRename,
}: SortableWorkspaceItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: ws.id });

  // Exclude role from attributes to preserve <li> listitem semantics
  const { role: _role, ...restAttributes } = attributes;

  const paneId = getWorkspacePaneId(ws);
  const isEditing = editingWorkspaceId === ws.id;
  const [editValue, setEditValue] = useState(ws.name);
  const inputRef = useRef<HTMLInputElement>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    if (isEditing) {
      setEditValue(ws.name);
      cancelledRef.current = false;
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [isEditing, ws.name]);

  const handleSubmit = useCallback(() => {
    if (cancelledRef.current) return;
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== ws.name) {
      onWorkspaceRename?.(ws.id, trimmed);
    }
    onFinishEditing();
  }, [editValue, ws.id, ws.name, onWorkspaceRename, onFinishEditing]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelledRef.current = true;
      onFinishEditing();
    }
  }, [handleSubmit, onFinishEditing]);

  const style: React.CSSProperties = {
    ...itemStyle,
    ...(ws.id === activeWorkspaceId ? activeItemStyle : {}),
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  return (
    <li
      ref={setNodeRef}
      {...restAttributes}
      {...listeners}
      data-active={ws.id === activeWorkspaceId ? 'true' : 'false'}
      data-focused={index === focusedIndex ? 'true' : 'false'}
      style={style}
    >
      <div style={itemContentStyle}>
        <div style={itemHeaderStyle}>
          {isEditing ? (
            <input
              ref={inputRef}
              style={renameInputStyle}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onBlur={handleSubmit}
            />
          ) : (
            <button
              style={nameButtonStyle}
              onClick={() => onWorkspaceClick(ws.id, index)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                onStartEditing(ws.id);
              }}
            >
              {ws.name}
            </button>
          )}
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
}

export function Sidebar({
  workspaces,
  activeWorkspaceId,
  onWorkspaceSelect,
  onWorkspaceCreate,
  onWorkspaceClose,
  onWorkspaceReorder,
  onWorkspaceRename,
}: SidebarProps) {
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
  );

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

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const oldIndex = workspaces.findIndex((ws) => ws.id === active.id);
      const newIndex = workspaces.findIndex((ws) => ws.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;

      const newOrder = arrayMove(
        workspaces.map((ws) => ws.id),
        oldIndex,
        newIndex,
      );
      onWorkspaceReorder(newOrder);
    },
    [workspaces, onWorkspaceReorder],
  );

  const unreadCount = useNotificationStore((s) => s.unreadCount());

  return (
    <nav style={navStyle} onKeyDown={handleKeyDown}>
      <div style={sidebarHeaderStyle}>
        <span>Workspaces</span>
        <NotificationBadge count={unreadCount} />
      </div>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={workspaces.map((ws) => ws.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul ref={listRef} role="list" style={listStyle}>
            {workspaces.map((ws, index) => (
              <SortableWorkspaceItem
                key={ws.id}
                ws={ws}
                index={index}
                activeWorkspaceId={activeWorkspaceId}
                focusedIndex={focusedIndex}
                editingWorkspaceId={editingWorkspaceId}
                onWorkspaceClick={handleWorkspaceClick}
                onWorkspaceClose={onWorkspaceClose}
                onStartEditing={setEditingWorkspaceId}
                onFinishEditing={() => setEditingWorkspaceId(null)}
                onWorkspaceRename={onWorkspaceRename}
              />
            ))}
          </ul>
        </SortableContext>
      </DndContext>
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

const sidebarHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '8px 12px',
  fontSize: '12px',
  fontWeight: 'bold',
  color: '#a6adc8',
  borderBottom: '1px solid #313244',
};

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

const renameInputStyle: React.CSSProperties = {
  flex: 1,
  background: '#313244',
  border: '1px solid #585b70',
  color: 'inherit',
  textAlign: 'left',
  padding: '3px',
  font: 'inherit',
  outline: 'none',
  borderRadius: '2px',
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
