import { Group, Panel, Separator } from 'react-resizable-panels';
import { PaneWrapper } from './PaneWrapper';
import { BrowserPane } from '../browser/BrowserPane';
import { useWorkspaceStore } from '../../stores/workspaceStore';
import type { LayoutNode } from '../../lib/workspace-types';

interface PaneSplitterProps {
  layout: LayoutNode;
  activePaneId: string | null;
  onPaneClick: (paneId: string) => void;
}

export function PaneSplitter({ layout, activePaneId, onPaneClick }: PaneSplitterProps) {
  const browserPaneUrls = useWorkspaceStore((s) => s.browserPaneUrls);

  if (layout.type === 'leaf') {
    const isActive = activePaneId === layout.paneId;
    const isBrowser = layout.ptyId === '';

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
        />
      </Panel>
      <Separator />
      <Panel defaultSize={layout.sizes[1] * 100}>
        <PaneSplitter
          layout={layout.children[1]}
          activePaneId={activePaneId}
          onPaneClick={onPaneClick}
        />
      </Panel>
    </Group>
  );
}
