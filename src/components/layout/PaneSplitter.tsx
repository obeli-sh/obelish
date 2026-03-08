import { useState, type CSSProperties, type DragEvent } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { PaneWrapper } from './PaneWrapper';
import { BrowserPane } from '../browser/BrowserPane';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { LayoutNode, PaneDropPosition } from '../../lib/workspace-types';

const PANE_DRAG_MIME = 'application/x-obelisk-pane-id';
const PANE_DROP_POSITION_MIME = 'application/x-obelisk-drop-position';
const EDGE_ZONE_RATIO = 0.22;

function readDraggedPaneId(dataTransfer: DataTransfer | null): string | null {
  if (!dataTransfer) return null;
  return dataTransfer.getData(PANE_DRAG_MIME) || dataTransfer.getData('text/plain') || null;
}

function readDropPosition(dataTransfer: DataTransfer | null): PaneDropPosition | null {
  if (!dataTransfer) return null;
  const value = dataTransfer.getData(PANE_DROP_POSITION_MIME);
  if (value === 'left' || value === 'right' || value === 'top' || value === 'bottom' || value === 'center') {
    return value;
  }
  return null;
}

function resolveDropPosition(event: DragEvent<HTMLDivElement>): PaneDropPosition {
  // Find the pane-wrapper element via data-pane-id attribute. We cannot rely
  // on event.currentTarget alone because React 18 event delegation may cause
  // it to reference a different element than the one with getBoundingClientRect mocked.
  const el = (event.target as HTMLElement).closest?.('[data-pane-id]') ?? event.currentTarget;
  const rect = (el as HTMLElement).getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return 'center';

  const relativeX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
  const relativeY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
  const xRatio = relativeX / rect.width;
  const yRatio = relativeY / rect.height;

  if (xRatio <= EDGE_ZONE_RATIO) return 'left';
  if (xRatio >= 1 - EDGE_ZONE_RATIO) return 'right';
  if (yRatio <= EDGE_ZONE_RATIO) return 'top';
  if (yRatio >= 1 - EDGE_ZONE_RATIO) return 'bottom';
  return 'center';
}

interface PaneSplitterProps {
  layout: LayoutNode;
  activePaneId: string | null;
  onPaneClick: (paneId: string) => void;
  onPaneResize?: (paneId: string, width: number, height: number) => void;
  onPaneClose?: (paneId: string) => void;
  onPaneSplitHorizontal?: (paneId: string) => void;
  onPaneSplitVertical?: (paneId: string) => void;
  onPaneAutoSplit?: (paneId: string) => void;
  onPaneOpenBrowser?: (paneId: string) => void;
  onPaneMove?: (paneId: string, targetPaneId: string, position: PaneDropPosition) => void;
}

export function PaneSplitter({
  layout,
  activePaneId,
  onPaneClick,
  onPaneResize,
  onPaneClose,
  onPaneSplitHorizontal,
  onPaneSplitVertical,
  onPaneAutoSplit,
  onPaneOpenBrowser,
  onPaneMove,
}: PaneSplitterProps) {
  const browserPaneUrls = useWorkspaceStore((s) => s.browserPaneUrls);
  const [dragPreviewPosition, setDragPreviewPosition] = useState<PaneDropPosition | null>(null);

  const handlePaneDragStart = (paneId: string) => (event: DragEvent<HTMLDivElement>) => {
    if (!onPaneMove) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(PANE_DRAG_MIME, paneId);
    event.dataTransfer.setData('text/plain', paneId);
  };

  const handlePaneDragEnd = () => {
    setDragPreviewPosition(null);
  };

  const handlePaneDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!onPaneMove) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const position = resolveDropPosition(event);
    event.dataTransfer.setData(PANE_DROP_POSITION_MIME, position);
    setDragPreviewPosition(position);
  };

  const handlePaneDragLeave = (event: DragEvent<HTMLDivElement>) => {
    if (!onPaneMove) return;
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && event.currentTarget.contains(nextTarget)) return;
    setDragPreviewPosition(null);
  };

  const handlePaneDrop = (targetPaneId: string) => (event: DragEvent<HTMLDivElement>) => {
    if (!onPaneMove) return;
    event.preventDefault();
    const sourcePaneId = readDraggedPaneId(event.dataTransfer);
    const position = readDropPosition(event.dataTransfer) ?? dragPreviewPosition ?? resolveDropPosition(event);
    setDragPreviewPosition(null);
    if (!sourcePaneId || sourcePaneId === targetPaneId) return;
    onPaneMove(sourcePaneId, targetPaneId, position);
  };

  if (layout.type === 'leaf') {
    const isActive = activePaneId === layout.paneId;
    const isBrowser = layout.paneId in browserPaneUrls;
    const showDropZones = dragPreviewPosition !== null && Boolean(onPaneMove);

    if (isBrowser) {
      const url = browserPaneUrls[layout.paneId] ?? 'about:blank';
      return (
        <div
          data-testid="pane-wrapper"
          data-pane-id={layout.paneId}
          onClick={() => onPaneClick(layout.paneId)}
          draggable={Boolean(onPaneMove)}
          onDragStart={handlePaneDragStart(layout.paneId)}
          onDragEnd={handlePaneDragEnd}
          onDragOver={handlePaneDragOver}
          onDragLeave={handlePaneDragLeave}
          onDrop={handlePaneDrop(layout.paneId)}
          style={{
            width: '100%',
            height: '100%',
            borderStyle: 'solid',
            borderWidth: 1,
            borderColor: isActive ? 'var(--ui-accent)' : 'var(--ui-border)',
            borderRadius: 'var(--ui-radius)',
            boxSizing: 'border-box',
            position: 'relative',
            overflow: 'hidden',
            background: 'var(--ui-panel-bg-alt)',
            transition: 'border-color 160ms ease',
          }}
        >
          <BrowserPane paneId={layout.paneId} url={url} isActive={isActive} />
          {showDropZones && (
            <>
              <div data-testid={`pane-drop-zone-left-${layout.paneId}`} style={getDropZoneStyle('left', dragPreviewPosition)} />
              <div data-testid={`pane-drop-zone-right-${layout.paneId}`} style={getDropZoneStyle('right', dragPreviewPosition)} />
              <div data-testid={`pane-drop-zone-top-${layout.paneId}`} style={getDropZoneStyle('top', dragPreviewPosition)} />
              <div data-testid={`pane-drop-zone-bottom-${layout.paneId}`} style={getDropZoneStyle('bottom', dragPreviewPosition)} />
            </>
          )}
        </div>
      );
    }

    return (
      <PaneWrapper
        paneId={layout.paneId}
        ptyId={layout.ptyId}
        isActive={isActive}
        onClick={() => onPaneClick(layout.paneId)}
        onResize={onPaneResize ? (w, h) => onPaneResize(layout.paneId, w, h) : undefined}
        onClose={onPaneClose ? () => onPaneClose(layout.paneId) : undefined}
        onSplitHorizontal={onPaneSplitHorizontal ? () => onPaneSplitHorizontal(layout.paneId) : undefined}
        onSplitVertical={onPaneSplitVertical ? () => onPaneSplitVertical(layout.paneId) : undefined}
        onAutoSplit={onPaneAutoSplit ? () => onPaneAutoSplit(layout.paneId) : undefined}
        onOpenBrowser={onPaneOpenBrowser ? () => onPaneOpenBrowser(layout.paneId) : undefined}
        draggable={Boolean(onPaneMove)}
        onDragStart={handlePaneDragStart(layout.paneId)}
        onDragEnd={handlePaneDragEnd}
        onDragOver={handlePaneDragOver}
        onDragLeave={handlePaneDragLeave}
        onDrop={handlePaneDrop(layout.paneId)}
        showDropZones={showDropZones}
        activeDropPosition={dragPreviewPosition}
      />
    );
  }

  return (
    <Group orientation={layout.direction}>
      <Panel defaultSize={layout.sizes[0] * 100}>
        <PaneSplitter
          layout={layout.children[0]}
          activePaneId={activePaneId}
          onPaneClick={onPaneClick}
          onPaneResize={onPaneResize}
          onPaneClose={onPaneClose}
          onPaneSplitHorizontal={onPaneSplitHorizontal}
          onPaneSplitVertical={onPaneSplitVertical}
          onPaneAutoSplit={onPaneAutoSplit}
          onPaneOpenBrowser={onPaneOpenBrowser}
          onPaneMove={onPaneMove}
        />
      </Panel>
      <Separator style={separatorStyle} />
      <Panel defaultSize={layout.sizes[1] * 100}>
        <PaneSplitter
          layout={layout.children[1]}
          activePaneId={activePaneId}
          onPaneClick={onPaneClick}
          onPaneResize={onPaneResize}
          onPaneClose={onPaneClose}
          onPaneSplitHorizontal={onPaneSplitHorizontal}
          onPaneSplitVertical={onPaneSplitVertical}
          onPaneAutoSplit={onPaneAutoSplit}
          onPaneOpenBrowser={onPaneOpenBrowser}
          onPaneMove={onPaneMove}
        />
      </Panel>
    </Group>
  );
}

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

const separatorStyle: CSSProperties = {
  background: 'var(--ui-border)',
  flexShrink: 0,
  flexBasis: 4,
  cursor: 'auto',
};
