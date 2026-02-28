import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useKeyboardShortcuts, type ShortcutDefinition } from '../useKeyboardShortcuts';

function fireKeydown(key: string, opts: Partial<KeyboardEventInit> = {}) {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...opts,
  });
  window.dispatchEvent(event);
  return event;
}

describe('useKeyboardShortcuts', () => {
  let originalPlatform: string;

  beforeEach(() => {
    originalPlatform = navigator.platform;
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'platform', {
      value: originalPlatform,
      configurable: true,
    });
  });

  it('registers keydown handler on window with capture: true', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const action = vi.fn();

    const { unmount } = renderHook(() =>
      useKeyboardShortcuts([{ key: 'a', action }]),
    );

    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);

    unmount();
    addSpy.mockRestore();
  });

  it('removes handler on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const action = vi.fn();

    const { unmount } = renderHook(() =>
      useKeyboardShortcuts([{ key: 'a', action }]),
    );

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    removeSpy.mockRestore();
  });

  it('calls action when Ctrl+key matches (non-Mac)', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    });

    const action = vi.fn();
    const { unmount } = renderHook(() =>
      useKeyboardShortcuts([{ key: 'n', action }]),
    );

    fireKeydown('n', { ctrlKey: true });

    expect(action).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('calls action when Meta+key matches (Mac)', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    });

    const action = vi.fn();
    const { unmount } = renderHook(() =>
      useKeyboardShortcuts([{ key: 'n', action }]),
    );

    fireKeydown('n', { metaKey: true });

    expect(action).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('calls preventDefault and stopPropagation on match', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    });

    const action = vi.fn();
    const { unmount } = renderHook(() =>
      useKeyboardShortcuts([{ key: 'n', action }]),
    );

    const preventDefaultSpy = vi.fn();
    const stopPropagationSpy = vi.fn();

    const handler = vi.fn();
    window.addEventListener('keydown', handler, true);

    // We need to check that the event gets preventDefault/stopPropagation called.
    // Instead of spying on the event itself, we dispatch and check the action was called.
    // Let's use a different approach: add a capturing listener before the hook.
    window.removeEventListener('keydown', handler, true);

    // Use a custom approach: create event, spy on its methods
    const event = new KeyboardEvent('keydown', {
      key: 'n',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    Object.defineProperty(event, 'preventDefault', { value: preventDefaultSpy });
    Object.defineProperty(event, 'stopPropagation', { value: stopPropagationSpy });

    window.dispatchEvent(event);

    expect(preventDefaultSpy).toHaveBeenCalled();
    expect(stopPropagationSpy).toHaveBeenCalled();
    unmount();
  });

  it('handles shift modifier correctly', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    });

    const shiftAction = vi.fn();
    const noShiftAction = vi.fn();
    const { unmount } = renderHook(() =>
      useKeyboardShortcuts([
        { key: 'h', shift: true, action: shiftAction },
        { key: 'h', action: noShiftAction },
      ]),
    );

    // Ctrl+Shift+H should trigger only the shift shortcut
    fireKeydown('h', { ctrlKey: true, shiftKey: true });
    expect(shiftAction).toHaveBeenCalledTimes(1);
    expect(noShiftAction).not.toHaveBeenCalled();

    // Ctrl+H (no shift) should trigger the non-shift shortcut
    fireKeydown('h', { ctrlKey: true, shiftKey: false });
    expect(noShiftAction).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('does NOT capture Ctrl+C (terminal signal)', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    });

    const action = vi.fn();
    const { unmount } = renderHook(() =>
      useKeyboardShortcuts([{ key: 'c', action }]),
    );

    fireKeydown('c', { ctrlKey: true });

    expect(action).not.toHaveBeenCalled();
    unmount();
  });

  it('does NOT capture Ctrl+D (terminal signal)', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    });

    const action = vi.fn();
    const { unmount } = renderHook(() =>
      useKeyboardShortcuts([{ key: 'd', action }]),
    );

    fireKeydown('d', { ctrlKey: true });

    expect(action).not.toHaveBeenCalled();
    unmount();
  });

  it('does NOT capture Ctrl+Z (terminal signal)', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    });

    const action = vi.fn();
    const { unmount } = renderHook(() =>
      useKeyboardShortcuts([{ key: 'z', action }]),
    );

    fireKeydown('z', { ctrlKey: true });

    expect(action).not.toHaveBeenCalled();
    unmount();
  });

  it('does not trigger without Ctrl/Meta modifier', () => {
    const action = vi.fn();
    const { unmount } = renderHook(() =>
      useKeyboardShortcuts([{ key: 'n', action }]),
    );

    fireKeydown('n');

    expect(action).not.toHaveBeenCalled();
    unmount();
  });

  it('handles multiple shortcuts', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    });

    const action1 = vi.fn();
    const action2 = vi.fn();
    const { unmount } = renderHook(() =>
      useKeyboardShortcuts([
        { key: 'n', action: action1 },
        { key: 'w', action: action2 },
      ]),
    );

    fireKeydown('n', { ctrlKey: true });
    expect(action1).toHaveBeenCalledTimes(1);
    expect(action2).not.toHaveBeenCalled();

    fireKeydown('w', { ctrlKey: true });
    expect(action2).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('does not re-register handler when shortcuts ref is stable', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const action = vi.fn();
    const shortcuts: ShortcutDefinition[] = [{ key: 'a', action }];

    const { rerender, unmount } = renderHook(() =>
      useKeyboardShortcuts(shortcuts),
    );

    const initialCallCount = addSpy.mock.calls.filter(
      (call) => call[0] === 'keydown',
    ).length;

    rerender();

    const afterRerenderCallCount = addSpy.mock.calls.filter(
      (call) => call[0] === 'keydown',
    ).length;

    // Should not add another listener on rerender
    expect(afterRerenderCallCount).toBe(initialCallCount);

    unmount();
    addSpy.mockRestore();
  });
});
