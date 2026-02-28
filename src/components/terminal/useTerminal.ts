import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { listen } from '@tauri-apps/api/event';
import { tauriBridge } from '../../lib/tauri-bridge';

export function useTerminal(_paneId: string, ptyId: string) {
  const terminalRef = useRef<Terminal | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [isReady, setIsReady] = useState(false);

  const refCallback = useCallback((el: HTMLDivElement | null) => {
    setContainer(el);
  }, []);

  useEffect(() => {
    if (!container || !ptyId) return;

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
      },
    });
    terminalRef.current = terminal;

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    try {
      const webglAddon = new WebglAddon();
      terminal.loadAddon(webglAddon);
    } catch {
      // Canvas renderer is the default fallback
    }

    terminal.open(container);
    fitAddon.fit();

    let cancelled = false;
    let unlisten: (() => void) | null = null;
    const setupListener = async () => {
      unlisten = await listen<{ data: string }>(`pty-data-${ptyId}`, (event) => {
        const bytes = atob(event.payload.data);
        const arr = new Uint8Array(bytes.length);
        for (let i = 0; i < bytes.length; i++) {
          arr[i] = bytes.charCodeAt(i);
        }
        terminal.write(arr);
      });
      if (cancelled) {
        unlisten();
        return;
      }
      unlistenRef.current = unlisten;
    };
    setupListener();

    const dataDisposable = terminal.onData((data: string) => {
      tauriBridge.pty.write(ptyId, btoa(data));
    });

    const resizeDisposable = terminal.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      tauriBridge.pty.resize(ptyId, cols, rows);
    });

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
    });
    resizeObserver.observe(container);

    setIsReady(true);

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      dataDisposable.dispose();
      resizeDisposable.dispose();
      if (unlistenRef.current) {
        unlistenRef.current();
      }
      terminal.dispose();
      terminalRef.current = null;
      setIsReady(false);
    };
  }, [container, ptyId]);

  return { terminalRef: refCallback, isReady, terminal: terminalRef };
}
