import { useState, useEffect } from 'react';
import { safeListen } from '../lib/safe-listen';
import type { GitInfo } from '../lib/workspace-types';

export function useGitInfo(paneId: string): GitInfo | null {
  const [info, setInfo] = useState<GitInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;

    const setup = async () => {
      unlisten = await safeListen<GitInfo>(`git-info-${paneId}`, (event) => {
        if (!cancelled) setInfo(event.payload);
      });
      if (cancelled) unlisten?.();
    };

    setInfo(null);
    setup();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [paneId]);

  return info;
}
