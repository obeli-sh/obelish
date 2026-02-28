import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSettingsStore } from '../../stores/settingsStore';
import type { KeyBinding } from '../../lib/keybinding-utils';
import * as commandsModule from '../../lib/commands';
import type { Command } from '../../lib/commands';

import { useKeyboardShortcuts } from '../useKeyboardShortcuts';

function kb(key: string, mod = true, shift = false, alt = false): KeyBinding {
  return { key, mod, shift, alt };
}

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
  let getCommandsSpy: ReturnType<typeof vi.spyOn>;

  const mockExecuteA = vi.fn();
  const mockExecuteN = vi.fn();
  const mockExecuteH = vi.fn();
  const mockExecuteW = vi.fn();
  const mockExecuteC = vi.fn();
  const mockExecuteD = vi.fn();
  const mockExecuteZ = vi.fn();
  const mockExecuteL = vi.fn();

  const testCommands: Command[] = [
    {
      id: 'test.action-a',
      label: 'Action A',
      description: 'Test action A',
      category: 'app',
      defaultBinding: kb('a'),
      execute: mockExecuteA,
    },
    {
      id: 'test.action-n',
      label: 'Action N',
      description: 'Test action N',
      category: 'app',
      defaultBinding: kb('n'),
      execute: mockExecuteN,
    },
    {
      id: 'test.action-h',
      label: 'Action H',
      description: 'Test action H',
      category: 'pane',
      defaultBinding: kb('h', true, true),
      execute: mockExecuteH,
    },
    {
      id: 'test.action-w',
      label: 'Action W',
      description: 'Test action W',
      category: 'pane',
      defaultBinding: kb('w'),
      execute: mockExecuteW,
    },
    {
      id: 'test.action-c',
      label: 'Action C',
      description: 'Test action C',
      category: 'app',
      defaultBinding: kb('c'),
      execute: mockExecuteC,
    },
    {
      id: 'test.action-d',
      label: 'Action D',
      description: 'Test action D',
      category: 'app',
      defaultBinding: kb('d'),
      execute: mockExecuteD,
    },
    {
      id: 'test.action-z',
      label: 'Action Z',
      description: 'Test action Z',
      category: 'app',
      defaultBinding: kb('z'),
      execute: mockExecuteZ,
    },
    {
      id: 'test.action-l',
      label: 'Action L',
      description: 'Test action L',
      category: 'app',
      defaultBinding: kb('l'),
      execute: mockExecuteL,
    },
  ];

  beforeEach(() => {
    originalPlatform = navigator.platform;
    mockExecuteA.mockClear();
    mockExecuteN.mockClear();
    mockExecuteH.mockClear();
    mockExecuteW.mockClear();
    mockExecuteC.mockClear();
    mockExecuteD.mockClear();
    mockExecuteZ.mockClear();
    mockExecuteL.mockClear();

    getCommandsSpy = vi.spyOn(commandsModule, 'getCommands').mockReturnValue(testCommands);

    // Set up settingsStore with keybindings matching our test commands
    useSettingsStore.setState({
      keybindings: {
        'test.action-a': kb('a'),
        'test.action-n': kb('n'),
        'test.action-h': kb('h', true, true),
        'test.action-w': kb('w'),
        'test.action-c': kb('c'),
        'test.action-d': kb('d'),
        'test.action-z': kb('z'),
        'test.action-l': kb('l'),
      },
    });
  });

  afterEach(() => {
    Object.defineProperty(navigator, 'platform', {
      value: originalPlatform,
      configurable: true,
    });
    getCommandsSpy.mockRestore();
  });

  it('registers keydown handler on window with capture: true', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');

    const { unmount } = renderHook(() => useKeyboardShortcuts());

    expect(addSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);

    unmount();
    addSpy.mockRestore();
  });

  it('removes handler on unmount', () => {
    const removeSpy = vi.spyOn(window, 'removeEventListener');

    const { unmount } = renderHook(() => useKeyboardShortcuts());

    unmount();

    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function), true);
    removeSpy.mockRestore();
  });

  it('calls action when Ctrl+key matches (non-Mac)', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    });

    const { unmount } = renderHook(() => useKeyboardShortcuts());

    fireKeydown('n', { ctrlKey: true });

    expect(mockExecuteN).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('calls action when Meta+key matches (Mac)', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'MacIntel',
      configurable: true,
    });

    const { unmount } = renderHook(() => useKeyboardShortcuts());

    fireKeydown('n', { metaKey: true });

    expect(mockExecuteN).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('calls preventDefault and stopPropagation on match', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    });

    const { unmount } = renderHook(() => useKeyboardShortcuts());

    const preventDefaultSpy = vi.fn();
    const stopPropagationSpy = vi.fn();

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

    const { unmount } = renderHook(() => useKeyboardShortcuts());

    // Ctrl+Shift+H should trigger the shift shortcut
    fireKeydown('h', { ctrlKey: true, shiftKey: true });
    expect(mockExecuteH).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('does NOT capture Ctrl+C (terminal signal)', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    });

    const { unmount } = renderHook(() => useKeyboardShortcuts());

    fireKeydown('c', { ctrlKey: true });

    expect(mockExecuteC).not.toHaveBeenCalled();
    unmount();
  });

  it('does NOT capture Ctrl+D (terminal signal)', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    });

    const { unmount } = renderHook(() => useKeyboardShortcuts());

    fireKeydown('d', { ctrlKey: true });

    expect(mockExecuteD).not.toHaveBeenCalled();
    unmount();
  });

  it('does NOT capture Ctrl+Z (terminal signal)', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    });

    const { unmount } = renderHook(() => useKeyboardShortcuts());

    fireKeydown('z', { ctrlKey: true });

    expect(mockExecuteZ).not.toHaveBeenCalled();
    unmount();
  });

  it('does NOT capture Ctrl+L (terminal signal)', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    });

    const { unmount } = renderHook(() => useKeyboardShortcuts());

    fireKeydown('l', { ctrlKey: true });

    expect(mockExecuteL).not.toHaveBeenCalled();
    unmount();
  });

  it('does not trigger without Ctrl/Meta modifier', () => {
    const { unmount } = renderHook(() => useKeyboardShortcuts());

    fireKeydown('n');

    expect(mockExecuteN).not.toHaveBeenCalled();
    unmount();
  });

  it('handles multiple shortcuts', () => {
    Object.defineProperty(navigator, 'platform', {
      value: 'Win32',
      configurable: true,
    });

    const { unmount } = renderHook(() => useKeyboardShortcuts());

    fireKeydown('n', { ctrlKey: true });
    expect(mockExecuteN).toHaveBeenCalledTimes(1);
    expect(mockExecuteW).not.toHaveBeenCalled();

    fireKeydown('w', { ctrlKey: true });
    expect(mockExecuteW).toHaveBeenCalledTimes(1);

    unmount();
  });

  it('does not re-register handler when store changes', () => {
    const addSpy = vi.spyOn(window, 'addEventListener');

    const { rerender, unmount } = renderHook(() => useKeyboardShortcuts());

    const initialCallCount = addSpy.mock.calls.filter(
      (call) => call[0] === 'keydown',
    ).length;

    rerender();

    const afterRerenderCallCount = addSpy.mock.calls.filter(
      (call) => call[0] === 'keydown',
    ).length;

    expect(afterRerenderCallCount).toBe(initialCallCount);

    unmount();
    addSpy.mockRestore();
  });
});
