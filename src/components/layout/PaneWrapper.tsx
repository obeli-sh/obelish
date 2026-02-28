import { memo } from 'react';
import { TerminalPane } from '../terminal/TerminalPane';

interface PaneWrapperProps {
  paneId: string;
  ptyId: string;
  isActive: boolean;
  onClick: () => void;
}

export const PaneWrapper = memo(function PaneWrapper({
  paneId,
  ptyId,
  isActive,
  onClick,
}: PaneWrapperProps) {
  return (
    <div
      data-testid="pane-wrapper"
      onClick={onClick}
      style={{
        width: '100%',
        height: '100%',
        border: '2px solid',
        borderColor: isActive ? 'rgb(59, 130, 246)' : 'transparent',
        boxSizing: 'border-box',
      }}
    >
      <TerminalPane paneId={paneId} ptyId={ptyId} isActive={isActive} />
    </div>
  );
});
