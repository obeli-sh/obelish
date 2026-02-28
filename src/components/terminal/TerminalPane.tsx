import { useEffect, useRef } from 'react';
import { useTerminal } from './useTerminal';

interface TerminalPaneProps {
  paneId: string;
  ptyId: string;
  isActive: boolean;
  onReady?: () => void;
}

export function TerminalPane({ paneId, ptyId, isActive, onReady }: TerminalPaneProps) {
  const { terminalRef, isReady, terminal } = useTerminal(paneId, ptyId);
  const onReadyFiredRef = useRef(false);

  useEffect(() => {
    if (isActive && isReady && terminal.current) {
      terminal.current.focus();
    }
  }, [isActive, isReady, terminal]);

  useEffect(() => {
    if (isReady && onReady && !onReadyFiredRef.current) {
      onReadyFiredRef.current = true;
      onReady();
    }
  }, [isReady, onReady]);

  return (
    <div
      ref={terminalRef}
      data-testid="terminal-container"
      style={{ width: '100%', height: '100%' }}
    />
  );
}
