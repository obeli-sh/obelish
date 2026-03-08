import { useState, useEffect, useCallback } from 'react';
import type { Command, CommandCategory } from '../../lib/commands';
import { bindingToString, detectConflicts, isMac, type KeyBinding } from '../../lib/keybinding-utils';

interface KeybindingEditorProps {
  commands: Command[];
  keybindings: Record<string, KeyBinding>;
  onUpdate: (commandId: string, binding: KeyBinding) => void;
  onReset: (commandId: string) => void;
}

const categoryOrder: CommandCategory[] = ['app', 'pane', 'workspace', 'navigation', 'terminal', 'browser'];

export function KeybindingEditor({ commands, keybindings, onUpdate, onReset }: KeybindingEditorProps) {
  const [recordingId, setRecordingId] = useState<string | null>(null);

  const conflicts = detectConflicts(keybindings);
  const conflictMap = new Map<string, string[]>();
  for (const conflict of conflicts) {
    for (const cmdId of conflict.commands) {
      conflictMap.set(cmdId, conflict.commands.filter((c) => c !== cmdId));
    }
  }

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!recordingId) return;

      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setRecordingId(null);
        return;
      }

      // Ignore modifier-only presses
      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return;

      const binding: KeyBinding = {
        key: e.key,
        mod: isMac() ? e.metaKey : e.ctrlKey,
        shift: e.shiftKey,
        alt: e.altKey,
      };

      onUpdate(recordingId, binding);
      setRecordingId(null);
    },
    [recordingId, onUpdate],
  );

  useEffect(() => {
    if (recordingId) {
      window.addEventListener('keydown', handleKeyDown, true);
      return () => window.removeEventListener('keydown', handleKeyDown, true);
    }
  }, [recordingId, handleKeyDown]);

  // Group by category
  const grouped = new Map<CommandCategory, Command[]>();
  for (const cmd of commands) {
    const group = grouped.get(cmd.category) || [];
    group.push(cmd);
    grouped.set(cmd.category, group);
  }

  // Sort categories by defined order
  const sortedCategories = Array.from(grouped.keys()).sort(
    (a, b) => categoryOrder.indexOf(a) - categoryOrder.indexOf(b),
  );

  return (
    <div>
      <h2 style={{ color: 'var(--ui-text-primary)', margin: '0 0 16px', fontSize: 18 }}>Keyboard Shortcuts</h2>
      {sortedCategories.map((category) => {
        const cmds = grouped.get(category)!;
        return (
          <div key={category} style={{ marginBottom: 16 }}>
            <div
              style={{
                color: 'var(--ui-accent)',
                fontSize: 12,
                fontWeight: 600,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
                padding: '4px 0',
                borderBottom: '1px solid var(--ui-border)',
                marginBottom: 8,
              }}
            >
              {category}
            </div>
            {cmds.map((cmd) => {
              const binding = keybindings[cmd.id];
              const isRecording = recordingId === cmd.id;
              const conflictsWith = conflictMap.get(cmd.id);

              return (
                <div
                  key={cmd.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 0',
                    gap: 8,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <span style={{ color: 'var(--ui-text-primary)', fontSize: 14 }}>{cmd.label}</span>
                    {conflictsWith && (
                      <span
                        style={{
                          color: 'var(--ui-danger)',
                          fontSize: 12,
                          marginLeft: 8,
                        }}
                      >
                        Conflict with {conflictsWith.join(', ')}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      onClick={() => setRecordingId(isRecording ? null : cmd.id)}
                      style={{
                        padding: '4px 10px',
                        backgroundColor: isRecording ? 'var(--ui-accent)' : 'var(--ui-panel-bg)',
                        border: `1px solid ${isRecording ? 'var(--ui-accent)' : 'var(--ui-border)'}`,
                        borderRadius: 'var(--ui-radius)',
                        color: isRecording ? 'var(--ui-panel-bg)' : 'var(--ui-text-muted)',
                        fontSize: 12,
                        cursor: 'pointer',
                        minWidth: 120,
                        textAlign: 'center',
                      }}
                    >
                      {isRecording
                        ? 'Press a key...'
                        : binding
                          ? bindingToString(binding)
                          : 'Unbound'}
                    </button>
                    <button
                      onClick={() => onReset(cmd.id)}
                      aria-label={`Reset ${cmd.label}`}
                      style={{
                        padding: '4px 8px',
                        backgroundColor: 'transparent',
                        border: '1px solid var(--ui-border)',
                        borderRadius: 'var(--ui-radius)',
                        color: 'var(--ui-text-muted)',
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      Reset
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
