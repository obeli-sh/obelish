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
import { IconSettings, IconUserCircle } from '@tabler/icons-react';
import type { WorkspaceInfo, LayoutNode } from '../../lib/workspace-types';
import { WorkspaceMetadata } from './WorkspaceMetadata';
import { NotificationBadge } from '../notifications/NotificationBadge';
import { useNotificationStore } from '../../stores/notificationStore';

export interface SidebarProps {
  workspaces: WorkspaceInfo[];
  activeWorkspaceId: string;
  activeProjectId?: string;
  projects?: Record<string, { name: string; rootPath: string }>;
  onWorkspaceSelect: (id: string) => void;
  onWorkspaceCreate: (projectId: string) => void;
  onWorkspaceClose: (id: string) => void;
  onWorkspaceReorder: (orderedIds: string[]) => void;
  onWorkspaceRename?: (id: string, newName: string) => void;
  onOpenPreferences?: () => void;
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

function findFirstLeafPtyId(node: LayoutNode): string | null {
  if (node.type === 'leaf') return node.ptyId || null;
  return findFirstLeafPtyId(node.children[0]);
}

function getWorkspacePtyId(ws: WorkspaceInfo): string | null {
  const surface = ws.surfaces[ws.activeSurfaceIndex];
  if (!surface) return null;
  return findFirstLeafPtyId(surface.layout);
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { role: _role, ...restAttributes } = attributes;

  const paneId = getWorkspacePaneId(ws);
  const ptyId = getWorkspacePtyId(ws);
  const isEditing = editingWorkspaceId === ws.id;
  const [editValue, setEditValue] = useState(ws.name);
  const [isHovered, setIsHovered] = useState(false);
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

  const handleHeaderMouseDown = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 1) return;
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleHeaderAuxClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (e.button !== 1) return;
    e.preventDefault();
    e.stopPropagation();
    onWorkspaceClose(ws.id);
  }, [onWorkspaceClose, ws.id]);

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
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div style={itemContentStyle}>
        <div
          style={itemHeaderStyle}
          onMouseDown={handleHeaderMouseDown}
          onAuxClick={handleHeaderAuxClick}
        >
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
            style={{
              ...closeButtonStyle,
              opacity: isHovered ? 1 : 0,
              visibility: isHovered ? 'visible' : 'hidden',
              transition: 'opacity 0.15s ease',
            }}
            onClick={() => onWorkspaceClose(ws.id)}
          >
            ×
          </button>
        </div>
        {ws.branchName && (
          <div style={branchStyle}>{ws.branchName}</div>
        )}
        {ws.worktreePath && (
          <div style={worktreePathStyle}>{ws.worktreePath}</div>
        )}
        {paneId && <WorkspaceMetadata paneId={paneId} ptyId={ptyId} />}
      </div>
    </li>
  );
}

export function Sidebar({
  workspaces,
  activeWorkspaceId,
  activeProjectId,
  projects,
  onWorkspaceSelect,
  onWorkspaceCreate,
  onWorkspaceClose,
  onWorkspaceReorder,
  onWorkspaceRename,
  onOpenPreferences,
}: SidebarProps) {
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const [editingWorkspaceId, setEditingWorkspaceId] = useState<string | null>(null);
  const [collapsedProjects, setCollapsedProjects] = useState<Set<string>>(new Set());
  const listRef = useRef<HTMLUListElement>(null);

  // When there are multiple projects, collapse all except the active one
  const collapsedInitializedRef = useRef(false);
  useEffect(() => {
    if (collapsedInitializedRef.current) return;
    const projectKeys = new Set<string>();
    for (const ws of workspaces) {
      if (ws.projectId) projectKeys.add(ws.projectId);
    }
    if (projectKeys.size > 1 && activeProjectId) {
      const collapsed = new Set<string>();
      for (const key of projectKeys) {
        if (key !== activeProjectId) {
          collapsed.add(key);
        }
      }
      setCollapsedProjects(collapsed);
      collapsedInitializedRef.current = true;
    } else if (projectKeys.size > 1) {
      collapsedInitializedRef.current = true;
    }
  }, [workspaces, activeProjectId]);

  const toggleProjectCollapsed = useCallback((projectKey: string) => {
    setCollapsedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectKey)) {
        next.delete(projectKey);
      } else {
        next.add(projectKey);
      }
      return next;
    });
  }, []);

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

  const handleWorkspaceListMouseDown = useCallback((e: React.MouseEvent<HTMLUListElement>) => {
    if (e.button !== 1) return;
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
  }, []);

  const handleWorkspaceListAuxClick = useCallback((e: React.MouseEvent<HTMLUListElement>) => {
    if (e.button !== 1) return;
    if (e.target !== e.currentTarget) return;
    e.preventDefault();
    const firstProjectId = workspaces[0]?.projectId ?? '';
    onWorkspaceCreate(firstProjectId);
  }, [onWorkspaceCreate, workspaces]);

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

  // Group workspaces by project
  const groupedWorkspaces = new Map<string, WorkspaceInfo[]>();
  for (const ws of workspaces) {
    const key = ws.projectId || '__ungrouped__';
    const group = groupedWorkspaces.get(key) ?? [];
    group.push(ws);
    groupedWorkspaces.set(key, group);
  }

  return (
    <nav className="panel" style={navStyle} onKeyDown={handleKeyDown}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={workspaces.map((ws) => ws.id)}
          strategy={verticalListSortingStrategy}
        >
          <ul
            ref={listRef}
            role="list"
            style={listStyle}
            onMouseDown={handleWorkspaceListMouseDown}
            onAuxClick={handleWorkspaceListAuxClick}
          >
            {Array.from(groupedWorkspaces.entries()).map(([projectKey, projectWorkspaces], groupIndex) => {
              const isCollapsed = collapsedProjects.has(projectKey);
              const projectName = projects?.[projectKey]?.name || projectKey.slice(0, 8);
              return (
              <div key={projectKey} style={groupIndex > 0 ? projectGroupSeparatorStyle : undefined}>
                {projectKey !== '__ungrouped__' && (
                  <div
                    style={projectHeaderStyle}
                    role="button"
                    tabIndex={0}
                    aria-expanded={!isCollapsed}
                    onClick={() => toggleProjectCollapsed(projectKey)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleProjectCollapsed(projectKey);
                      }
                    }}
                  >
                    <span style={projectHeaderLeftStyle}>
                      <span style={chevronStyle}>{isCollapsed ? '\u25B8' : '\u25BE'}</span>
                      <span className="label">{projectName}</span>
                    </span>
                    <button
                      aria-label={`New workspace in ${projectName}`}
                      style={projectAddButtonStyle}
                      onClick={(e) => {
                        e.stopPropagation();
                        onWorkspaceCreate(projectKey);
                      }}
                    >
                      +
                    </button>
                  </div>
                )}
                {!isCollapsed && projectWorkspaces.map((ws) => {
                  const globalIndex = workspaces.indexOf(ws);
                  return (
                    <SortableWorkspaceItem
                      key={ws.id}
                      ws={ws}
                      index={globalIndex}
                      activeWorkspaceId={activeWorkspaceId}
                      focusedIndex={focusedIndex}
                      editingWorkspaceId={editingWorkspaceId}
                      onWorkspaceClick={handleWorkspaceClick}
                      onWorkspaceClose={onWorkspaceClose}
                      onStartEditing={setEditingWorkspaceId}
                      onFinishEditing={() => setEditingWorkspaceId(null)}
                      onWorkspaceRename={onWorkspaceRename}
                    />
                  );
                })}
              </div>
              );
            })}
          </ul>
        </SortableContext>
      </DndContext>
      <div style={footerStyle}>
        <div style={quickActionRowStyle}>
          <NotificationBadge count={unreadCount} />
          <button aria-label="My Account" style={secondaryButtonStyle} disabled>
            <IconUserCircle size={16} />
          </button>
          <button aria-label="Preferences" style={secondaryButtonStyle} onClick={onOpenPreferences}>
            <IconSettings size={16} />
          </button>
        </div>
      </div>
    </nav>
  );
}

const navStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  height: '100%',
  backgroundColor: 'var(--ui-panel-bg-alt)',
  color: 'var(--ui-text-primary)',
  overflow: 'hidden',
};

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: '6px 0',
  flex: 1,
  overflow: 'auto',
};

const itemStyle: React.CSSProperties = {
  padding: '6px 8px',
  cursor: 'pointer',
  margin: '0 6px 6px',
  borderStyle: 'solid',
  borderWidth: 1,
  borderColor: 'transparent',
  borderRadius: 'var(--ui-radius)',
  background: 'rgba(255, 255, 255, 0.01)',
};

const itemContentStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
};

const itemHeaderStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const activeItemStyle: React.CSSProperties = {
  borderColor: 'var(--ui-accent)',
  background: 'color-mix(in srgb, var(--ui-accent) 8%, transparent)',
};

const nameButtonStyle: React.CSSProperties = {
  flex: 1,
  background: 'none',
  border: 'none',
  color: 'inherit',
  textAlign: 'left',
  cursor: 'pointer',
  padding: '4px 0',
  fontFamily: 'var(--ui-font-mono)',
  fontSize: 12,
  letterSpacing: '0.05em',
};

const renameInputStyle: React.CSSProperties = {
  flex: 1,
  background: 'var(--ui-panel-bg)',
  border: '1px solid var(--ui-border)',
  color: 'inherit',
  textAlign: 'left',
  padding: '4px 6px',
  fontFamily: 'var(--ui-font-mono)',
  fontSize: 12,
  letterSpacing: '0.05em',
  outline: 'none',
  borderRadius: 'var(--ui-radius)',
};

const closeButtonStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid transparent',
  color: 'inherit',
  cursor: 'pointer',
  padding: '2px 8px',
  fontSize: 20,
  fontFamily: 'var(--ui-font-mono)',
  borderRadius: 'var(--ui-radius)',
};

const projectHeaderStyle: React.CSSProperties = {
  padding: '8px 12px 4px',
  fontSize: 10,
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: '0.1em',
  color: 'var(--ui-text-muted)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  cursor: 'pointer',
  userSelect: 'none',
};

const projectHeaderLeftStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 4,
};

const chevronStyle: React.CSSProperties = {
  fontSize: 10,
  lineHeight: 1,
  width: 10,
  display: 'inline-block',
  textAlign: 'center',
};

const projectGroupSeparatorStyle: React.CSSProperties = {
  borderTop: '1px solid var(--ui-border)',
  marginTop: 4,
  paddingTop: 2,
};

const projectAddButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--ui-text-muted)',
  cursor: 'pointer',
  padding: '0 4px',
  fontSize: 14,
  fontFamily: 'var(--ui-font-mono)',
  fontWeight: 600,
  lineHeight: 1,
  borderRadius: 'var(--ui-radius)',
};

const branchStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--ui-accent)',
  fontFamily: 'var(--ui-font-mono)',
  marginTop: 2,
};

const worktreePathStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--ui-text-muted)',
  fontFamily: 'var(--ui-font-mono)',
  marginTop: 1,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const footerStyle: React.CSSProperties = {
  borderTop: '1px solid var(--ui-border)',
  padding: 10,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
};

const quickActionRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  justifyContent: 'flex-end',
};

const secondaryButtonStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--ui-radius)',
  border: '1px solid var(--ui-border)',
  background: 'var(--ui-panel-bg)',
  color: 'var(--ui-text-primary)',
  cursor: 'pointer',
};
