import { Group, Panel, Separator } from 'react-resizable-panels';
import { PaneWrapper } from './PaneWrapper';
import type { LayoutNode } from '../../lib/workspace-types';

interface PaneSplitterProps {
  layout: LayoutNode;
  activePaneId: string | null;
  onPaneClick: (paneId: string) => void;
}

export function PaneSplitter({ layout, activePaneId, onPaneClick }: PaneSplitterProps) {
  if (layout.type === 'leaf') {
    return (
      <PaneWrapper
        paneId={layout.paneId}
        ptyId={layout.ptyId}
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
