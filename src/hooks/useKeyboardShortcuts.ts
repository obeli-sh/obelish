import { useEffect, useRef } from 'react';

export interface ShortcutDefinition {
  key: string;
  shift?: boolean;
  action: () => void;
}

const TERMINAL_SIGNAL_KEYS = new Set(['c', 'd', 'z']);

function isMac(): boolean {
  return navigator.platform.includes('Mac');
}

export function useKeyboardShortcuts(shortcuts: ShortcutDefinition[]): void {
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = isMac() ? e.metaKey : e.ctrlKey;
      if (!mod) return;

      for (const shortcut of shortcutsRef.current) {
        // Skip terminal signals (Ctrl+C/D/Z without shift)
        if (
          TERMINAL_SIGNAL_KEYS.has(shortcut.key) &&
          !shortcut.shift &&
          e.key.toLowerCase() === shortcut.key
        ) {
          return;
        }

        const shiftRequired = shortcut.shift ?? false;
        if (
          e.key.toLowerCase() === shortcut.key.toLowerCase() &&
          e.shiftKey === shiftRequired
        ) {
          e.preventDefault();
          e.stopPropagation();
          shortcut.action();
          return;
        }
      }
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);
}
