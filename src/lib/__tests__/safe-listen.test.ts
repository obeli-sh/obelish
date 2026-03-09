import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { listen, clearEventMocks } from '@tauri-apps/api/event';
import { safeListen } from '../safe-listen';

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };

describe('safeListen', () => {
  const tauriWindow = window as unknown as TauriWindow;
  const originalTauri = tauriWindow.__TAURI_INTERNALS__;

  beforeEach(() => {
    clearEventMocks();
    delete tauriWindow.__TAURI_INTERNALS__;
  });

  afterEach(() => {
    if (originalTauri === undefined) {
      delete tauriWindow.__TAURI_INTERNALS__;
    } else {
      tauriWindow.__TAURI_INTERNALS__ = originalTauri;
    }
    vi.restoreAllMocks();
  });

  it('uses mock listener when running outside Tauri', async () => {
    const handler = vi.fn();

    const unlisten = await safeListen('workspace-changed', handler);

    expect(typeof unlisten).toBe('function');
    expect(listen).not.toHaveBeenCalled();
  });

  it('falls back to mock listener when listen() throws', async () => {
    // Simulate being in a Tauri environment so safeListen tries the real listen
    tauriWindow.__TAURI_INTERNALS__ = {};

    // Make listen throw an error to trigger the catch branch (lines 14-15)
    vi.mocked(listen).mockImplementationOnce(() => {
      throw new Error('Tauri listen failed');
    });

    const handler = vi.fn();
    const unlisten = await safeListen('workspace-changed', handler);

    expect(typeof unlisten).toBe('function');
    // Should not throw, should gracefully fall back to mock
    expect(() => unlisten()).not.toThrow();
  });

  it('uses real listen when running inside Tauri and listen succeeds', async () => {
    tauriWindow.__TAURI_INTERNALS__ = {};

    const handler = vi.fn();
    const unlisten = await safeListen('workspace-changed', handler);

    expect(listen).toHaveBeenCalledWith('workspace-changed', handler);
    expect(typeof unlisten).toBe('function');
  });
});
