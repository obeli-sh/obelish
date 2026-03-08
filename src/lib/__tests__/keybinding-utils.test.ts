// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  bindingToString,
  bindingsEqual,
  detectConflicts,
  isMac,
  type KeyBinding,
} from '../keybinding-utils';

function kb(key: string, mod = true, shift = false, alt = false): KeyBinding {
  return { key, mod, shift, alt };
}

describe('keybinding-utils', () => {
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

  describe('isMac', () => {
    it('returns true on MacIntel', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        configurable: true,
      });
      expect(isMac()).toBe(true);
    });

    it('returns false on Win32', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        configurable: true,
      });
      expect(isMac()).toBe(false);
    });

    it('returns false on Linux x86_64', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'Linux x86_64',
        configurable: true,
      });
      expect(isMac()).toBe(false);
    });
  });

  describe('bindingToString', () => {
    it('formats Ctrl+key on non-Mac', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        configurable: true,
      });
      expect(bindingToString(kb('n'))).toBe('Ctrl+N');
    });

    it('formats Cmd+key on Mac', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'MacIntel',
        configurable: true,
      });
      expect(bindingToString(kb('n'))).toBe('Cmd+N');
    });

    it('formats Ctrl+Shift+key', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        configurable: true,
      });
      expect(bindingToString(kb('h', true, true))).toBe('Ctrl+Shift+H');
    });

    it('formats Ctrl+Alt+key', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        configurable: true,
      });
      expect(bindingToString(kb('t', true, false, true))).toBe('Ctrl+Alt+T');
    });

    it('formats Ctrl+Shift+Alt+key', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        configurable: true,
      });
      expect(bindingToString(kb('t', true, true, true))).toBe('Ctrl+Shift+Alt+T');
    });

    it('formats key without mod', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        configurable: true,
      });
      expect(bindingToString(kb('F1', false))).toBe('F1');
    });

    it('formats special keys like ArrowUp', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        configurable: true,
      });
      expect(bindingToString(kb('ArrowUp'))).toBe('Ctrl+ArrowUp');
    });

    it('formats comma key', () => {
      Object.defineProperty(navigator, 'platform', {
        value: 'Win32',
        configurable: true,
      });
      expect(bindingToString(kb(','))).toBe('Ctrl+,');
    });
  });

  describe('bindingsEqual', () => {
    it('returns true for identical bindings', () => {
      expect(bindingsEqual(kb('n'), kb('n'))).toBe(true);
    });

    it('returns false when key differs', () => {
      expect(bindingsEqual(kb('n'), kb('m'))).toBe(false);
    });

    it('returns false when mod differs', () => {
      expect(bindingsEqual(kb('n', true), kb('n', false))).toBe(false);
    });

    it('returns false when shift differs', () => {
      expect(bindingsEqual(kb('n', true, true), kb('n', true, false))).toBe(false);
    });

    it('returns false when alt differs', () => {
      expect(bindingsEqual(kb('n', true, false, true), kb('n', true, false, false))).toBe(false);
    });

    it('returns true for bindings with all modifiers matching', () => {
      expect(bindingsEqual(
        kb('h', true, true, true),
        kb('h', true, true, true),
      )).toBe(true);
    });
  });

  describe('detectConflicts', () => {
    it('returns empty array when no conflicts', () => {
      const bindings: Record<string, KeyBinding> = {
        'cmd.a': kb('a'),
        'cmd.b': kb('b'),
        'cmd.c': kb('c', true, true),
      };
      expect(detectConflicts(bindings)).toEqual([]);
    });

    it('detects two commands with same binding', () => {
      const bindings: Record<string, KeyBinding> = {
        'cmd.a': kb('n'),
        'cmd.b': kb('n'),
      };
      const conflicts = detectConflicts(bindings);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].commands).toContain('cmd.a');
      expect(conflicts[0].commands).toContain('cmd.b');
      expect(conflicts[0].binding).toEqual(kb('n'));
    });

    it('detects three commands with same binding', () => {
      const bindings: Record<string, KeyBinding> = {
        'cmd.a': kb('n'),
        'cmd.b': kb('n'),
        'cmd.c': kb('n'),
      };
      const conflicts = detectConflicts(bindings);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].commands).toHaveLength(3);
    });

    it('detects multiple conflict groups', () => {
      const bindings: Record<string, KeyBinding> = {
        'cmd.a': kb('n'),
        'cmd.b': kb('n'),
        'cmd.c': kb('h', true, true),
        'cmd.d': kb('h', true, true),
      };
      const conflicts = detectConflicts(bindings);
      expect(conflicts).toHaveLength(2);
    });

    it('treats different modifiers as different bindings', () => {
      const bindings: Record<string, KeyBinding> = {
        'cmd.a': kb('n', true, false),
        'cmd.b': kb('n', true, true),
      };
      expect(detectConflicts(bindings)).toEqual([]);
    });

    it('handles empty bindings', () => {
      expect(detectConflicts({})).toEqual([]);
    });
  });
});
