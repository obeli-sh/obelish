import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useBrowser } from '../useBrowser';

describe('useBrowser', () => {
  it('initializes_with_provided_url', () => {
    const { result } = renderHook(() => useBrowser('pane-1', 'https://example.com'));
    expect(result.current.currentUrl).toBe('https://example.com');
  });

  it('navigate_updates_currentUrl', () => {
    const { result } = renderHook(() => useBrowser('pane-1', 'https://example.com'));

    act(() => {
      result.current.navigate('https://test.com');
    });

    expect(result.current.currentUrl).toBe('https://test.com');
  });

  it('tracks_navigation_history_for_back_forward', () => {
    const { result } = renderHook(() => useBrowser('pane-1', 'https://example.com'));

    act(() => {
      result.current.navigate('https://test.com');
    });
    act(() => {
      result.current.navigate('https://third.com');
    });

    expect(result.current.canGoBack).toBe(true);
    expect(result.current.currentUrl).toBe('https://third.com');
  });

  it('goBack_returns_to_previous_url', () => {
    const { result } = renderHook(() => useBrowser('pane-1', 'https://example.com'));

    act(() => {
      result.current.navigate('https://test.com');
    });
    act(() => {
      result.current.goBack();
    });

    expect(result.current.currentUrl).toBe('https://example.com');
  });

  it('goForward_after_goBack_restores_url', () => {
    const { result } = renderHook(() => useBrowser('pane-1', 'https://example.com'));

    act(() => {
      result.current.navigate('https://test.com');
    });
    act(() => {
      result.current.goBack();
    });
    act(() => {
      result.current.goForward();
    });

    expect(result.current.currentUrl).toBe('https://test.com');
  });

  it('navigate_after_goBack_clears_forward_history', () => {
    const { result } = renderHook(() => useBrowser('pane-1', 'https://example.com'));

    act(() => {
      result.current.navigate('https://test.com');
    });
    act(() => {
      result.current.navigate('https://third.com');
    });
    act(() => {
      result.current.goBack();
    });

    expect(result.current.canGoForward).toBe(true);

    act(() => {
      result.current.navigate('https://new.com');
    });

    expect(result.current.canGoForward).toBe(false);
    expect(result.current.currentUrl).toBe('https://new.com');
  });

  it('canGoBack_is_false_initially', () => {
    const { result } = renderHook(() => useBrowser('pane-1', 'https://example.com'));
    expect(result.current.canGoBack).toBe(false);
  });

  it('canGoForward_is_false_initially', () => {
    const { result } = renderHook(() => useBrowser('pane-1', 'https://example.com'));
    expect(result.current.canGoForward).toBe(false);
  });

  it('refresh_does_not_change_url_or_history', () => {
    const { result } = renderHook(() => useBrowser('pane-1', 'https://example.com'));

    act(() => {
      result.current.navigate('https://test.com');
    });
    act(() => {
      result.current.refresh();
    });

    expect(result.current.currentUrl).toBe('https://test.com');
    expect(result.current.canGoBack).toBe(true);
    expect(result.current.canGoForward).toBe(false);
  });

  it('rapid_sequential_navigations_maintain_consistent_history', () => {
    const { result } = renderHook(() => useBrowser('pane-1', 'https://example.com'));

    // Navigate rapidly in a single act (tests atomic state updates)
    act(() => {
      result.current.navigate('https://first.com');
      result.current.navigate('https://second.com');
      result.current.navigate('https://third.com');
    });

    expect(result.current.currentUrl).toBe('https://third.com');
    expect(result.current.canGoBack).toBe(true);

    // Go back through all entries to verify history is consistent
    act(() => { result.current.goBack(); });
    expect(result.current.currentUrl).toBe('https://second.com');
    act(() => { result.current.goBack(); });
    expect(result.current.currentUrl).toBe('https://first.com');
    act(() => { result.current.goBack(); });
    expect(result.current.currentUrl).toBe('https://example.com');
    expect(result.current.canGoBack).toBe(false);
  });

  it('isLoading_starts_as_true_and_becomes_false', () => {
    const { result } = renderHook(() => useBrowser('pane-1', 'https://example.com'));

    expect(result.current.isLoading).toBe(true);

    // Simulate iframe load by calling the ref callback with a mock iframe
    const mockIframe = document.createElement('iframe');
    act(() => {
      result.current.iframeRef(mockIframe);
    });

    // Simulate load event
    act(() => {
      mockIframe.dispatchEvent(new Event('load'));
    });

    expect(result.current.isLoading).toBe(false);
  });
});
