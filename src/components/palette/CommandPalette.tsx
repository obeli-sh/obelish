import { useState, useEffect, useRef, useCallback } from 'react';
import type { Command } from '../../lib/commands';
import { fuzzySearchCommands } from '../../lib/fuzzy-search';
import { bindingToString } from '../../lib/keybinding-utils';
import { useSettingsStore } from '../../stores/settingsStore';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  commands: Command[];
  onExecute: (commandId: string) => void;
}

export function CommandPalette({ isOpen, onClose, commands, onExecute }: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const keybindings = useSettingsStore((s) => s.keybindings);

  const filtered = fuzzySearchCommands(commands, query);

  useEffect(() => {
    if (isOpen) {
      setQuery('');
      setSelectedIndex(0);
      // Auto-focus on next tick so the input is mounted
      requestAnimationFrame(() => {
        inputRef.current?.focus();
      });
    }
  }, [isOpen]);

  // Reset selected index when query changes
  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setSelectedIndex((prev) => (prev + 1) % (filtered.length || 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setSelectedIndex((prev) => (prev - 1 + (filtered.length || 1)) % (filtered.length || 1));
          break;
        case 'Enter':
          e.preventDefault();
          if (filtered.length > 0 && selectedIndex < filtered.length) {
            onExecute(filtered[selectedIndex].id);
            onClose();
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [filtered, selectedIndex, onExecute, onClose],
  );

  const handleItemClick = useCallback(
    (commandId: string) => {
      onExecute(commandId);
      onClose();
    },
    [onExecute, onClose],
  );

  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  if (!isOpen) return null;

  return (
    <div
      data-testid="palette-backdrop"
      onClick={handleBackdropClick}
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.5)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        paddingTop: '20vh',
        zIndex: 1000,
      }}
    >
      <div
        role="dialog"
        aria-label="Command palette"
        onKeyDown={handleKeyDown}
        style={{
          width: '100%',
          maxWidth: 500,
          backgroundColor: '#181825',
          border: '1px solid #313244',
          borderRadius: 8,
          overflow: 'hidden',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)',
        }}
      >
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #313244' }}>
          <input
            ref={inputRef}
            role="searchbox"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command..."
            autoFocus
            style={{
              width: '100%',
              padding: '8px 12px',
              backgroundColor: '#1e1e2e',
              border: '1px solid #313244',
              borderRadius: 4,
              color: '#cdd6f4',
              fontSize: 14,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
        <ul
          role="listbox"
          style={{
            listStyle: 'none',
            margin: 0,
            padding: 0,
            maxHeight: 300,
            overflowY: 'auto',
          }}
        >
          {filtered.map((cmd, index) => {
            const isSelected = index === selectedIndex;
            const binding = keybindings[cmd.id];
            return (
              <li
                key={cmd.id}
                role="option"
                aria-selected={isSelected}
                onClick={() => handleItemClick(cmd.id)}
                style={{
                  padding: '8px 16px',
                  cursor: 'pointer',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  backgroundColor: isSelected ? '#313244' : 'transparent',
                  color: '#cdd6f4',
                }}
              >
                <div>
                  <div style={{ fontSize: 14 }}>{cmd.label}</div>
                  <div style={{ fontSize: 12, color: '#6c7086' }}>{cmd.description}</div>
                </div>
                {binding && (
                  <span
                    style={{
                      fontSize: 12,
                      padding: '2px 6px',
                      backgroundColor: '#1e1e2e',
                      border: '1px solid #313244',
                      borderRadius: 4,
                      color: '#a6adc8',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {bindingToString(binding)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
