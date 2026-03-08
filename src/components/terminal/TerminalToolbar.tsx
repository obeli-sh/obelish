import { useState, useRef, useEffect, type KeyboardEvent, type CSSProperties } from 'react';
import {
  IconTerminal2,
  IconLayoutRows,
  IconLayoutColumns,
  IconArrowsSplit,
  IconBrowser,
  IconX,
} from '@tabler/icons-react';

export interface TerminalToolbarProps {
  paneId: string;
  name: string;
  isActive: boolean;
  onRename: (name: string) => void;
  onClose: () => void;
  onSplitHorizontal: () => void;
  onSplitVertical: () => void;
  onAutoSplit: () => void;
  onOpenBrowser: () => void;
}

export function TerminalToolbar({
  name,
  isActive,
  onRename,
  onClose,
  onSplitHorizontal,
  onSplitVertical,
  onAutoSplit,
  onOpenBrowser,
}: TerminalToolbarProps) {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);
  const [hoveredButton, setHoveredButton] = useState<string | null>(null);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const commitRename = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== name) {
      onRename(trimmed);
    }
    setEditing(false);
    setEditValue(name);
  };

  const cancelRename = () => {
    setEditing(false);
    setEditValue(name);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitRename();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancelRename();
    }
  };

  const handleBlur = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== name) {
      onRename(trimmed);
    }
    setEditing(false);
    setEditValue(name);
  };

  const toolbarBg = isActive
    ? 'var(--ui-panel-bg-alt)'
    : 'var(--ui-panel-bg)';

  const actionButton = (
    label: string,
    id: string,
    onClick: () => void,
    icon: React.ReactNode,
  ) => (
    <button
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseEnter={() => setHoveredButton(id)}
      onMouseLeave={() => setHoveredButton(null)}
      style={{
        ...iconButtonStyle,
        backgroundColor: hoveredButton === id ? 'color-mix(in srgb, var(--ui-accent) 12%, transparent)' : 'transparent',
        borderColor: hoveredButton === id ? 'var(--ui-accent)' : 'transparent',
      }}
    >
      {icon}
    </button>
  );

  return (
    <div
      style={{
        ...toolbarStyle,
        backgroundColor: toolbarBg,
        borderLeft: isActive ? '2px solid var(--ui-accent)' : '2px solid transparent',
      }}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }}
    >
      <div style={leftStyle}>
        <IconTerminal2 size={14} color="var(--ui-text-primary)" data-testid="icon-terminal" />
        {editing ? (
          <input
            ref={inputRef}
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onBlur={handleBlur}
            style={inputStyle}
          />
        ) : (
          <span
            onDoubleClick={() => {
              setEditValue(name);
              setEditing(true);
            }}
            style={nameStyle}
          >
            {name}
          </span>
        )}
      </div>
      <div style={actionsStyle}>
        {actionButton('Split horizontal', 'split-h', onSplitVertical, <IconLayoutRows size={14} color="var(--ui-text-primary)" />)}
        {actionButton('Split vertical', 'split-v', onSplitHorizontal, <IconLayoutColumns size={14} color="var(--ui-text-primary)" />)}
        {actionButton('Auto split', 'auto', onAutoSplit, <IconArrowsSplit size={14} color="var(--ui-text-primary)" />)}
        {actionButton('Open browser', 'browser', onOpenBrowser, <IconBrowser size={14} color="var(--ui-text-primary)" />)}
        {actionButton('Close', 'close', onClose, <IconX size={14} color="var(--ui-text-primary)" />)}
      </div>
    </div>
  );
}

const toolbarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  height: 34,
  minHeight: 34,
  maxHeight: 34,
  padding: '0 10px',
  borderBottom: '1px solid var(--ui-border)',
  userSelect: 'none',
};

const leftStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  overflow: 'hidden',
};

const nameStyle: CSSProperties = {
  color: 'var(--ui-text-primary)',
  fontSize: 11,
  fontFamily: 'var(--ui-font-mono)',
  letterSpacing: '0.08em',
  cursor: 'default',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const inputStyle: CSSProperties = {
  background: 'var(--ui-panel-bg-alt)',
  border: '1px solid var(--ui-border)',
  borderRadius: 'var(--ui-radius)',
  color: 'var(--ui-text-primary)',
  fontFamily: 'var(--ui-font-mono)',
  fontSize: 11,
  letterSpacing: '0.08em',
  padding: '2px 6px',
  outline: 'none',
  width: 140,
};

const actionsStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 2,
};

const iconButtonStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 22,
  height: 22,
  border: '1px solid transparent',
  borderRadius: 'var(--ui-radius)',
  cursor: 'pointer',
  padding: 0,
};
