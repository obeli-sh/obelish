import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { listen, emitMockEvent, clearEventMocks } from '@tauri-apps/api/event';
import type { GitInfo } from '../../lib/workspace-types';

import { useGitInfo } from '../useGitInfo';

describe('useGitInfo', () => {
  beforeEach(() => {
    clearEventMocks();
  });

  it('returns null initially', () => {
    const { result } = renderHook(() => useGitInfo('pane-1'));
    expect(result.current).toBeNull();
  });

  it('returns info after git-info event', async () => {
    const { result } = renderHook(() => useGitInfo('pane-1'));

    const gitInfo: GitInfo = {
      branch: 'main',
      isDirty: true,
      ahead: 2,
      behind: 1,
    };

    act(() => {
      emitMockEvent('git-info-pane-1', gitInfo);
    });

    await waitFor(() => {
      expect(result.current).toEqual(gitInfo);
    });
  });

  it('cleans up listener on unmount', async () => {
    const { unmount } = renderHook(() => useGitInfo('pane-1'));

    // Wait for the listener to be set up
    await waitFor(() => {
      expect(listen).toHaveBeenCalledWith('git-info-pane-1', expect.any(Function));
    });

    unmount();

    // The unlisten function returned by listen should have been called
    const unlisten = await (listen as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(unlisten).toHaveBeenCalled();
  });

  it('updates when paneId changes', async () => {
    const { result, rerender } = renderHook(
      ({ paneId }) => useGitInfo(paneId),
      { initialProps: { paneId: 'pane-1' } },
    );

    const gitInfo1: GitInfo = { branch: 'main', isDirty: false, ahead: 0, behind: 0 };
    act(() => {
      emitMockEvent('git-info-pane-1', gitInfo1);
    });

    await waitFor(() => {
      expect(result.current).toEqual(gitInfo1);
    });

    // Change paneId - state should reset
    rerender({ paneId: 'pane-2' });

    // After rerender with new paneId, state resets to null
    expect(result.current).toBeNull();

    // New event on new pane should be received
    const gitInfo2: GitInfo = { branch: 'feature', isDirty: true, ahead: 1, behind: 0 };
    act(() => {
      emitMockEvent('git-info-pane-2', gitInfo2);
    });

    await waitFor(() => {
      expect(result.current).toEqual(gitInfo2);
    });
  });
});
