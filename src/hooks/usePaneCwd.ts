import { useState, useEffect } from 'react';
import { safeListen } from '../lib/safe-listen';

interface CwdPayload {
  cwd: string;
}

export function usePaneCwd(ptyId: string | null): string | null {
  const [cwd, setCwd] = useState<string | null>(null);

  useEffect(() => {
    if (!ptyId) {
      setCwd(null);
      return;
    }

    let cancelled = false;
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      unlisten = await safeListen<CwdPayload>(`cwd-changed-${ptyId}`, (event) => {
        if (!cancelled) setCwd(event.payload.cwd);
      });
      if (cancelled) unlisten?.();
    };

    setCwd(null);
    setup();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [ptyId]);

  return cwd;
}
