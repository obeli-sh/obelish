import type React from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { PaneWrapper } from './PaneWrapper';
import { BrowserPane } from '../browser/BrowserPane';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { LayoutNode } from '../../lib/workspace-types';

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
}: PaneSplitterProps) {
  const browserPaneUrls = useWorkspaceStore((s) => s.browserPaneUrls);

  if (layout.type === 'leaf') {
    const isActive = activePaneId === layout.paneId;
    const isBrowser = layout.paneId in browserPaneUrls;

    if (isBrowser) {
      const url = browserPaneUrls[layout.paneId] ?? 'about:blank';
      return (
        <div
          data-testid="pane-wrapper"
          onClick={() => onPaneClick(layout.paneId)}
          style={{
            width: '100%',
            height: '100%',
            border: '2px solid',
            borderColor: isActive ? 'rgb(59, 130, 246)' : 'transparent',
            boxSizing: 'border-box',
          }}
        >
          <BrowserPane paneId={layout.paneId} url={url} isActive={isActive} />
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
        />
      </Panel>
    </Group>
  );
}

const separatorStyle: React.CSSProperties = {
  background: '#313244',
  flexShrink: 0,
  flexBasis: 4,
  cursor: 'auto',
};
