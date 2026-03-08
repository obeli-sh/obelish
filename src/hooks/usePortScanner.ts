import { useState, useEffect } from 'react';
import { safeListen } from '../lib/safe-listen';
import type { PortInfo } from '../lib/workspace-types';

export function usePortScanner(paneId: string): PortInfo[] {
  const [ports, setPorts] = useState<PortInfo[]>([]);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      unlisten = await safeListen<PortInfo[]>(`ports-changed-${paneId}`, (event) => {
        if (!cancelled) setPorts(event.payload);
      });
      if (cancelled) unlisten?.();
    };

    setPorts([]);
    setup();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [paneId]);

  return ports;
}
