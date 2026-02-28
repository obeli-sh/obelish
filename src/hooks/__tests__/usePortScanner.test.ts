import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { listen, emitMockEvent, clearEventMocks } from '@tauri-apps/api/event';
import type { PortInfo } from '../../lib/workspace-types';

import { usePortScanner } from '../usePortScanner';

describe('usePortScanner', () => {
  beforeEach(() => {
    clearEventMocks();
  });

  it('returns empty array initially', () => {
    const { result } = renderHook(() => usePortScanner('pane-1'));
    expect(result.current).toEqual([]);
  });

  it('returns ports after ports-changed event', async () => {
    const { result } = renderHook(() => usePortScanner('pane-1'));

    const ports: PortInfo[] = [
      { port: 3000, protocol: 'tcp', pid: 1234, processName: 'node' },
      { port: 8080, protocol: 'tcp', pid: null, processName: null },
    ];

    act(() => {
      emitMockEvent('ports-changed-pane-1', ports);
    });

    await waitFor(() => {
      expect(result.current).toEqual(ports);
    });
  });

  it('cleans up listener on unmount', async () => {
    const { unmount } = renderHook(() => usePortScanner('pane-1'));

    await waitFor(() => {
      expect(listen).toHaveBeenCalledWith('ports-changed-pane-1', expect.any(Function));
    });

    unmount();

    const unlisten = await (listen as ReturnType<typeof vi.fn>).mock.results[0].value;
    expect(unlisten).toHaveBeenCalled();
  });

  it('updates when paneId changes', async () => {
    const { result, rerender } = renderHook(
      ({ paneId }) => usePortScanner(paneId),
      { initialProps: { paneId: 'pane-1' } },
    );

    const ports1: PortInfo[] = [
      { port: 3000, protocol: 'tcp', pid: 1234, processName: 'node' },
    ];
    act(() => {
      emitMockEvent('ports-changed-pane-1', ports1);
    });

    await waitFor(() => {
      expect(result.current).toEqual(ports1);
    });

    // Change paneId - state should reset to empty
    rerender({ paneId: 'pane-2' });
    expect(result.current).toEqual([]);

    // New event on new pane
    const ports2: PortInfo[] = [
      { port: 8080, protocol: 'tcp', pid: 5678, processName: 'python' },
    ];
    act(() => {
      emitMockEvent('ports-changed-pane-2', ports2);
    });

    await waitFor(() => {
      expect(result.current).toEqual(ports2);
    });
  });
});
