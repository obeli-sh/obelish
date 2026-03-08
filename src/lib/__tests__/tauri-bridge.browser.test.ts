import { beforeEach, describe, expect, it } from 'vitest';
import { invoke, clearInvokeMocks } from '@tauri-apps/api/core';
import { tauriBridge } from '../tauri-bridge';
import { resetMockState } from '../browser-mock';

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown };

describe('tauriBridge browser fallback', () => {
  beforeEach(() => {
    clearInvokeMocks();
    resetMockState();
    const tauriWindow = window as unknown as TauriWindow;
    delete tauriWindow.__TAURI_INTERNALS__;
  });

  it('uses browser mocks when running outside Tauri', async () => {
    const workspaces = await tauriBridge.session.restore();

    expect(Array.isArray(workspaces)).toBe(true);
    expect(workspaces.length).toBeGreaterThan(0);
    expect(invoke).not.toHaveBeenCalled();
  });
});
