import { memo, useEffect, useRef, type CSSProperties, type DragEventHandler } from 'react';
import { TerminalPane } from '../terminal/TerminalPane';
import { TerminalToolbar } from '../terminal/TerminalToolbar';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { PaneDropPosition } from '../../lib/workspace-types';

interface PaneWrapperProps {
  paneId: string;
  ptyId: string;
  isActive: boolean;
  hasNotification?: boolean;
  onClick: () => void;
  onResize?: (width: number, height: number) => void;
  onClose?: () => void;
  onSplitHorizontal?: () => void;
  onSplitVertical?: () => void;
  onAutoSplit?: () => void;
  onOpenBrowser?: () => void;
  draggable?: boolean;
  onDragStart?: DragEventHandler<HTMLDivElement>;
  onDragEnd?: DragEventHandler<HTMLDivElement>;
  onDragOver?: DragEventHandler<HTMLDivElement>;
  onDragLeave?: DragEventHandler<HTMLDivElement>;
  onDrop?: DragEventHandler<HTMLDivElement>;
  showDropZones?: boolean;
  activeDropPosition?: PaneDropPosition | null;
}

function getPaneBorderColor(isActive: boolean, hasNotification: boolean): string {
  if (isActive) return 'var(--ui-accent)';
  if (hasNotification) return 'color-mix(in srgb, var(--ui-accent) 40%, var(--ui-border))';
  return 'var(--ui-border)';
}

export const PaneWrapper = memo(function PaneWrapper({
  paneId,
  ptyId,
  isActive,
  hasNotification = false,
  onClick,
  onResize,
  onClose,
  onSplitHorizontal,
  onSplitVertical,
  onAutoSplit,
  onOpenBrowser,
  draggable,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
  showDropZones = false,
  activeDropPosition = null,
}: PaneWrapperProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const paneName = useWorkspaceStore((s) => s.paneNames[paneId]);
  const setPaneName = useWorkspaceStore((s) => s._setPaneName);

  useEffect(() => {
    if (!paneName) {
      useWorkspaceStore.getState()._getOrAssignPaneName(paneId);
    }
  }, [paneId, paneName]);

  useEffect(() => {
    if (!isActive || !onResize || !wrapperRef.current) return;

    const observer = new ResizeObserver((entries) => {
      try {
        const entry = entries[0];
        if (entry) {
          onResize(entry.contentRect.width, entry.contentRect.height);
        }
      } catch { /* component may be unmounting */ }
    });

    observer.observe(wrapperRef.current);
    return () => observer.disconnect();
  }, [isActive, onResize]);

  const noop = () => {};

  return (
    <div
      ref={wrapperRef}
      data-testid="pane-wrapper"
      data-pane-id={paneId}
      onClick={onClick}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderStyle: 'solid',
        borderWidth: 1,
        borderColor: getPaneBorderColor(isActive, hasNotification),
        borderRadius: 'var(--ui-radius)',
        boxSizing: 'border-box',
        overflow: 'hidden',
        position: 'relative',
        background: 'var(--ui-panel-bg-alt)',
        transition: 'border-color 160ms ease',
      }}
    >
      <TerminalToolbar
        paneId={paneId}
        name={paneName ?? paneId}
        isActive={isActive}
        onRename={(name) => setPaneName(paneId, name)}
        onClose={onClose ?? noop}
        onSplitHorizontal={onSplitHorizontal ?? noop}
        onSplitVertical={onSplitVertical ?? noop}
        onAutoSplit={onAutoSplit ?? noop}
        onOpenBrowser={onOpenBrowser ?? noop}
      />
      <div
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          background: 'var(--ui-panel-bg-alt)',
        }}
      >
        <TerminalPane paneId={paneId} ptyId={ptyId} isActive={isActive} />
      </div>
      {showDropZones && (
        <>
          <div data-testid={`pane-drop-zone-left-${paneId}`} style={getDropZoneStyle('left', activeDropPosition)} />
          <div data-testid={`pane-drop-zone-right-${paneId}`} style={getDropZoneStyle('right', activeDropPosition)} />
          <div data-testid={`pane-drop-zone-top-${paneId}`} style={getDropZoneStyle('top', activeDropPosition)} />
          <div data-testid={`pane-drop-zone-bottom-${paneId}`} style={getDropZoneStyle('bottom', activeDropPosition)} />
        </>
      )}
    </div>
  );
});

function getDropZoneStyle(
  position: Exclude<PaneDropPosition, 'center'>,
  activePosition: PaneDropPosition | null,
): CSSProperties {
  const base: CSSProperties = {
    position: 'absolute',
    pointerEvents: 'none',
    zIndex: 5,
    background: activePosition === position
      ? 'color-mix(in srgb, var(--ui-accent) 28%, transparent)'
      : 'color-mix(in srgb, var(--ui-accent) 12%, transparent)',
    transition: 'background 120ms ease',
  };

  switch (position) {
    case 'left':
      return { ...base, left: 0, top: 0, width: '22%', height: '100%' };
    case 'right':
      return { ...base, right: 0, top: 0, width: '22%', height: '100%' };
    case 'top':
      return { ...base, left: 0, top: 0, width: '100%', height: '22%' };
    case 'bottom':
      return { ...base, left: 0, bottom: 0, width: '100%', height: '22%' };
  }
}
