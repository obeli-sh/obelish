import { useEffect, useRef } from 'react';
import { useSettingsStore } from '../stores/settingsStore';
import { getCommands } from '../lib/commands';
import { isMac, type KeyBinding } from '../lib/keybinding-utils';

const TERMINAL_PASSTHROUGH_KEYS = new Set(['c', 'd', 'z', 'l']);

function matchesBinding(e: KeyboardEvent, binding: KeyBinding): boolean {
  const mod = isMac() ? e.metaKey : e.ctrlKey;
  if (binding.mod !== mod) return false;
  if (binding.shift !== e.shiftKey) return false;
  if (binding.alt !== e.altKey) return false;
  return e.key.toLowerCase() === binding.key.toLowerCase();
}

function isTerminalPassthrough(e: KeyboardEvent): boolean {
  const mod = isMac() ? e.metaKey : e.ctrlKey;
  return mod && !e.shiftKey && TERMINAL_PASSTHROUGH_KEYS.has(e.key.toLowerCase());
}

export function useKeyboardShortcuts(): void {
  const keybindingsRef = useRef(useSettingsStore.getState().keybindings);

  useEffect(() => {
    const unsubscribe = useSettingsStore.subscribe((state) => {
      keybindingsRef.current = state.keybindings;
    });

    return unsubscribe;
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (isTerminalPassthrough(e)) return;

      const bindings = keybindingsRef.current;
      const allCommands = getCommands();

      for (const [commandId, binding] of Object.entries(bindings)) {
        if (matchesBinding(e, binding)) {
          const command = allCommands.find((c) => c.id === commandId);
          if (command) {
            e.preventDefault();
            e.stopPropagation();
            command.execute();
            return;
          }
        }
      }
    };

    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, []);
}
