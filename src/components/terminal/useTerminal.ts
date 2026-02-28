import { useCallback, useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { SerializeAddon } from '@xterm/addon-serialize';
import { listen } from '@tauri-apps/api/event';
import { tauriBridge } from '../../lib/tauri-bridge';

export function useTerminal(paneId: string, ptyId: string) {
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

    const serializeAddon = new SerializeAddon();
    terminal.loadAddon(serializeAddon);

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

    const loadScrollback = async () => {
      const data = await tauriBridge.scrollback.load(paneId);
      if (cancelled || !data) return;
      terminal.write(atob(data));
    };
    loadScrollback();

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
      const serialized = serializeAddon.serialize();
      if (serialized) {
        tauriBridge.scrollback.save(paneId, btoa(serialized));
      }
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
  }, [container, paneId, ptyId]);

  return { terminalRef: refCallback, isReady, terminal: terminalRef };
}
