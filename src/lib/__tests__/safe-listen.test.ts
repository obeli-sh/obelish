import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listen, clearEventMocks } from '@tauri-apps/api/event';
import { safeListen } from '../safe-listen';

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };

describe('safeListen', () => {
  beforeEach(() => {
    clearEventMocks();
    const tauriWindow = window as unknown as TauriWindow;
    delete tauriWindow.__TAURI_INTERNALS__;
  });

  it('uses mock listener when running outside Tauri', async () => {
    const handler = vi.fn();

    const unlisten = await safeListen('workspace-changed', handler);

    expect(typeof unlisten).toBe('function');
    expect(listen).not.toHaveBeenCalled();
  });
});
