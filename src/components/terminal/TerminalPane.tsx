import { useEffect } from 'react';
import { useTerminal } from './useTerminal';

interface TerminalPaneProps {
  paneId: string;
  ptyId: string;
  isActive: boolean;
  onReady?: () => void;
}

export function TerminalPane({ paneId, ptyId, isActive, onReady }: TerminalPaneProps) {
  const { terminalRef, isReady, terminal } = useTerminal(paneId, ptyId);

  useEffect(() => {
    if (isActive && terminal.current) {
      terminal.current.focus();
    }
  }, [isActive, terminal]);

  useEffect(() => {
    if (isReady && onReady) {
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
