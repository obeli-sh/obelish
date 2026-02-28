import { Group, Panel, Separator } from 'react-resizable-panels';
import { PaneWrapper } from './PaneWrapper';
import type { LayoutNode, PaneInfo } from '../../lib/workspace-types';

interface PaneSplitterProps {
  layout: LayoutNode;
  activePaneId: string | null;
  onPaneClick: (paneId: string) => void;
  panes?: Record<string, PaneInfo>;
}

export function PaneSplitter({ layout, activePaneId, onPaneClick, panes }: PaneSplitterProps) {
  if (layout.type === 'leaf') {
    const ptyId = panes?.[layout.paneId]?.ptyId ?? layout.paneId;
    return (
      <PaneWrapper
        paneId={layout.paneId}
        ptyId={ptyId}
        isActive={activePaneId === layout.paneId}
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
          panes={panes}
        />
      </Panel>
      <Separator />
      <Panel defaultSize={layout.sizes[1] * 100}>
        <PaneSplitter
          layout={layout.children[1]}
          activePaneId={activePaneId}
          onPaneClick={onPaneClick}
          panes={panes}
        />
      </Panel>
    </Group>
  );
}
