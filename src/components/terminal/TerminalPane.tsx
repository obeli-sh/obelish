import { useEffect, useRef } from 'react';
import '@xterm/xterm/css/xterm.css';
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
      try { terminal.current.focus(); } catch { /* terminal may be disposed */ }
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
