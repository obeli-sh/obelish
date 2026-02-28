import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
// WebglAddon disabled — causes webview GPU process crashes on WSL2
// during terminal dispose. Canvas renderer is used instead.
// import { WebglAddon } from '@xterm/addon-webgl';
import { SerializeAddon } from '@xterm/addon-serialize';
import { listen } from '@tauri-apps/api/event';
import { tauriBridge } from '../../lib/tauri-bridge';

interface Disposables {
  terminal: Terminal;
  serializeAddon: SerializeAddon;
  resizeObserver: ResizeObserver;
  dataDisposable: { dispose: () => void };
  resizeDisposable: { dispose: () => void };
}

export function useTerminal(paneId: string, ptyId: string) {
  const terminalRef = useRef<Terminal | null>(null);
  const unlistenRef = useRef<(() => void) | null>(null);
  const disposedRef = useRef(false);
  const cleanupRef = useRef<Disposables | null>(null);
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const [isReady, setIsReady] = useState(false);

  const refCallback = useCallback((el: HTMLDivElement | null) => {
    setContainer(el);
  }, []);

  // Async setup — creates terminal, starts listening for PTY data
  useEffect(() => {
    if (!container || !ptyId) return;

    disposedRef.current = false;

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

    const serializeAddon = new SerializeAddon();
    terminal.loadAddon(serializeAddon);

    terminal.open(container);
    fitAddon.fit();

    const init = async () => {
      try {
        const data = await tauriBridge.scrollback.load(paneId);
        if (disposedRef.current) return;
        if (data) {
          terminal.write(atob(data));
        }
      } catch { /* scrollback may not exist or backend unavailable */ }

      if (disposedRef.current) return;

      const unlisten = await listen<{ data: string }>(`pty-data-${ptyId}`, (event) => {
        if (disposedRef.current) return;
        try {
          const bytes = atob(event.payload.data);
          const arr = new Uint8Array(bytes.length);
          for (let i = 0; i < bytes.length; i++) {
            arr[i] = bytes.charCodeAt(i);
          }
          terminal.write(arr);
        } catch { /* terminal may be disposed */ }
      });
      if (disposedRef.current) {
        unlisten();
        return;
      }
      unlistenRef.current = unlisten;
    };
    init();

    const dataDisposable = terminal.onData((data: string) => {
      if (disposedRef.current) return;
      tauriBridge.pty.write(ptyId, btoa(data)).catch(() => {});
    });

    const resizeDisposable = terminal.onResize(({ cols, rows }: { cols: number; rows: number }) => {
      if (disposedRef.current) return;
      tauriBridge.pty.resize(ptyId, cols, rows).catch(() => {});
    });

    const resizeObserver = new ResizeObserver(() => {
      if (disposedRef.current) return;
      try { fitAddon.fit(); } catch { /* container may be detached */ }
    });
    resizeObserver.observe(container);

    cleanupRef.current = { terminal, serializeAddon, resizeObserver, dataDisposable, resizeDisposable };
    setIsReady(true);

    // useEffect cleanup: safety net for any async callbacks still in flight
    return () => {
      disposedRef.current = true;
    };
  }, [container, paneId, ptyId]);

  // Synchronous cleanup — runs BEFORE React removes DOM nodes.
  // This is the permanent fix: useLayoutEffect cleanup fires during the commit
  // phase, before DOM mutations, so terminal.dispose() and
  // serializeAddon.serialize() operate on a live DOM container.
  useLayoutEffect(() => {
    if (!container || !ptyId) return;

    return () => {
      console.debug('[useTerminal] cleanup start', paneId);
      disposedRef.current = true;

      // 1. Stop receiving PTY events
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
      console.debug('[useTerminal] unlisten done', paneId);

      const cleanup = cleanupRef.current;
      if (!cleanup) return;

      // 2. Serialize scrollback while terminal and DOM are still alive
      try {
        const serialized = cleanup.serializeAddon.serialize();
        if (serialized) {
          tauriBridge.scrollback.save(paneId, btoa(serialized)).catch(() => {});
        }
      } catch { /* terminal/DOM may already be torn down */ }
      console.debug('[useTerminal] scrollback saved', paneId);

      // 3. Disconnect observers and disposables
      cleanup.resizeObserver.disconnect();
      cleanup.dataDisposable.dispose();
      cleanup.resizeDisposable.dispose();
      console.debug('[useTerminal] observers disconnected', paneId);

      // 4. Dispose terminal while container is still in the DOM
      try { cleanup.terminal.dispose(); } catch { /* already disposed */ }
      console.debug('[useTerminal] terminal disposed', paneId);

      terminalRef.current = null;
      cleanupRef.current = null;
      setIsReady(false);
      console.debug('[useTerminal] cleanup complete', paneId);
    };
  }, [container, paneId, ptyId]);

  return { terminalRef: refCallback, isReady, terminal: terminalRef };
}
