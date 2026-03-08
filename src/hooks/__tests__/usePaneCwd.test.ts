import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { listen, emitMockEvent, clearEventMocks } from '@tauri-apps/api/event';

import { usePaneCwd } from '../usePaneCwd';

describe('usePaneCwd', () => {
  beforeEach(() => {
    clearEventMocks();
  });

  it('returns null initially', () => {
    const { result } = renderHook(() => usePaneCwd('pty-1'));
    expect(result.current).toBeNull();
  });

  it('returns null when ptyId is null', () => {
    const { result } = renderHook(() => usePaneCwd(null));
    expect(result.current).toBeNull();
  });

  it('returns cwd after cwd-changed event', async () => {
    const { result } = renderHook(() => usePaneCwd('pty-1'));

    act(() => {
      emitMockEvent('cwd-changed-pty-1', { cwd: '/home/user/projects' });
    });

    await waitFor(() => {
      expect(result.current).toBe('/home/user/projects');
    });
  });

  it('cleans up listener on unmount', async () => {
    const { unmount } = renderHook(() => usePaneCwd('pty-1'));

    await waitFor(() => {
      expect(listen).toHaveBeenCalledWith('cwd-changed-pty-1', expect.any(Function));
    });

    unmount();

    const unlisten = await (listen as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(unlisten).toHaveBeenCalled();
  });

  it('re-subscribes when ptyId changes', async () => {
    const { result, rerender } = renderHook(
      ({ ptyId }) => usePaneCwd(ptyId),
      { initialProps: { ptyId: 'pty-1' as string | null } },
    );

    act(() => {
      emitMockEvent('cwd-changed-pty-1', { cwd: '/first' });
    });

    await waitFor(() => {
      expect(result.current).toBe('/first');
    });

    // Change ptyId — state should reset
    rerender({ ptyId: 'pty-2' });
    expect(result.current).toBeNull();

    act(() => {
      emitMockEvent('cwd-changed-pty-2', { cwd: '/second' });
    });

    await waitFor(() => {
      expect(result.current).toBe('/second');
    });
  });

  it('resets to null when ptyId becomes null', async () => {
    const { result, rerender } = renderHook(
      ({ ptyId }) => usePaneCwd(ptyId),
      { initialProps: { ptyId: 'pty-1' as string | null } },
    );

    act(() => {
      emitMockEvent('cwd-changed-pty-1', { cwd: '/home/user' });
    });

    await waitFor(() => {
      expect(result.current).toBe('/home/user');
    });

    rerender({ ptyId: null });
    expect(result.current).toBeNull();
  });
});
