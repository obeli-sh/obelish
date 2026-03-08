import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import { IconTerminal2, IconCheck } from '@tabler/icons-react';
import { tauriBridge, type ShellInfo } from '../../lib/tauri-bridge';
import { useSettingsStore } from '../../stores/settingsStore';

interface ShellOption {
  value: string;
  name: string;
  path: string;
}

export function ShellSelector() {
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [shellListLoaded, setShellListLoaded] = useState(false);
  const defaultShell = useSettingsStore((s) => s.defaultShell);
  const updateDefaultShell = useSettingsStore((s) => s.updateDefaultShell);

  useEffect(() => {
    tauriBridge.shell.list().then(setShells).catch(() => {
      setShells([]);
    }).finally(() => {
      setShellListLoaded(true);
    });
  }, []);

  const handleSelect = (value: string) => {
    updateDefaultShell(value);
    tauriBridge.settings.update('defaultShell', value).catch((err) => {
      console.error('Failed to persist default shell:', err);
    });
  };

  const shellIsAvailable = defaultShell === ''
    || shells.some((shell) => shell.path === defaultShell);
  const selectedShell = shellIsAvailable ? defaultShell : '';

  useEffect(() => {
    if (!shellListLoaded) return;
    if (defaultShell === '') return;
    if (shells.some((shell) => shell.path === defaultShell)) return;
    updateDefaultShell('');
    tauriBridge.settings.update('defaultShell', '').catch((err) => {
      console.error('Failed to persist default shell:', err);
    });
  }, [defaultShell, shellListLoaded, shells, updateDefaultShell]);

  const options: ShellOption[] = [
    { value: '', name: 'Auto-detect', path: 'Uses system default shell' },
    ...shells.map((s) => ({ value: s.path, name: s.name, path: s.path })),
  ];

  return (
    <div>
      <div style={labelStyle}>Default Shell</div>
      <div role="radiogroup" aria-label="Default Shell" style={listStyle}>
        {options.map((option) => {
          const selected = selectedShell === option.value;
          return (
            <label
              key={option.value || '__auto__'}
              data-shell-option=""
              data-selected={selected ? 'true' : 'false'}
              style={{
                ...optionStyle,
                borderColor: selected
                  ? 'var(--ui-accent)'
                  : 'var(--ui-border)',
                backgroundColor: selected
                  ? 'color-mix(in srgb, var(--ui-accent) 8%, transparent)'
                  : 'var(--ui-panel-bg)',
              }}
            >
              <input
                type="radio"
                name="default-shell"
                value={option.value}
                checked={selected}
                onChange={() => handleSelect(option.value)}
                aria-label={option.name}
                style={hiddenRadioStyle}
              />
              <div style={iconWrapperStyle}>
                <IconTerminal2
                  size={18}
                  color={
                    selected
                      ? 'var(--ui-accent)'
                      : 'var(--ui-text-muted)'
                  }
                />
              </div>
              <div style={textWrapperStyle}>
                <span style={nameTextStyle}>{option.name}</span>
                <span style={pathTextStyle}>{option.path}</span>
              </div>
              {selected && (
                <div style={checkWrapperStyle}>
                  <IconCheck size={16} color="var(--ui-accent)" />
                </div>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}

const labelStyle: CSSProperties = {
  color: 'var(--ui-text-muted)',
  fontSize: 13,
  marginBottom: 8,
};

const listStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const optionStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '8px 12px',
  borderRadius: 'var(--ui-radius)',
  border: '1px solid',
  cursor: 'pointer',
  transition: 'border-color 120ms ease, background-color 120ms ease',
};

const hiddenRadioStyle: CSSProperties = {
  position: 'absolute',
  opacity: 0,
  width: 0,
  height: 0,
  pointerEvents: 'none',
};

const iconWrapperStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 28,
  height: 28,
  borderRadius: 'var(--ui-radius)',
  backgroundColor: 'var(--ui-panel-bg-alt)',
  flexShrink: 0,
};

const textWrapperStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  flex: 1,
  minWidth: 0,
};

const nameTextStyle: CSSProperties = {
  color: 'var(--ui-text-primary)',
  fontSize: 13,
  fontWeight: 500,
};

const pathTextStyle: CSSProperties = {
  color: 'var(--ui-text-muted)',
  fontSize: 11,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const checkWrapperStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  flexShrink: 0,
};
