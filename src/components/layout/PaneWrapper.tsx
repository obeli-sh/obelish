import { memo } from 'react';
import { TerminalPane } from '../terminal/TerminalPane';

interface PaneWrapperProps {
  paneId: string;
  ptyId: string;
  isActive: boolean;
  hasNotification?: boolean;
  onClick: () => void;
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
}: PaneWrapperProps) {
  return (
    <div
      data-testid="pane-wrapper"
      onClick={onClick}
      style={{
        width: '100%',
        height: '100%',
        border: '2px solid',
        borderColor: getBorderColor(isActive, hasNotification),
        boxSizing: 'border-box',
      }}
    >
      <TerminalPane paneId={paneId} ptyId={ptyId} isActive={isActive} />
    </div>
  );
});
