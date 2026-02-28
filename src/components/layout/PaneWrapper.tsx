import { memo, useEffect, useRef } from 'react';
import { TerminalPane } from '../terminal/TerminalPane';
import { TerminalToolbar } from '../terminal/TerminalToolbar';
import { useWorkspaceStore } from '../../stores/workspaceStore';

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
}

function getBorderColor(isActive: boolean, hasNotification: boolean): string {
  if (isActive) return 'rgb(59, 130, 246)';
  if (hasNotification) return 'rgb(96, 165, 250)';
  return 'transparent';
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
      onClick={onClick}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        border: '2px solid',
        borderColor: getBorderColor(isActive, hasNotification),
        boxSizing: 'border-box',
        overflow: 'hidden',
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
      <div style={{ flex: 1, minHeight: 0, overflow: 'hidden', background: '#1e1e1e' }}>
        <TerminalPane paneId={paneId} ptyId={ptyId} isActive={isActive} />
      </div>
    </div>
  );
});
