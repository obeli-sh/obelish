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

  const toolbarBg = isActive ? '#1e1e2e' : '#181825';

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
        backgroundColor: hoveredButton === id ? '#313244' : 'transparent',
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
        borderTopLeftRadius: isActive ? 6 : 0,
        borderTopRightRadius: isActive ? 6 : 0,
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={leftStyle}>
        <IconTerminal2 size={14} color="#cdd6f4" data-testid="icon-terminal" />
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
        {actionButton('Split horizontal', 'split-h', onSplitHorizontal, <IconLayoutRows size={14} color="#cdd6f4" />)}
        {actionButton('Split vertical', 'split-v', onSplitVertical, <IconLayoutColumns size={14} color="#cdd6f4" />)}
        {actionButton('Auto split', 'auto', onAutoSplit, <IconArrowsSplit size={14} color="#cdd6f4" />)}
        {actionButton('Open browser', 'browser', onOpenBrowser, <IconBrowser size={14} color="#cdd6f4" />)}
        {actionButton('Close', 'close', onClose, <IconX size={14} color="#cdd6f4" />)}
      </div>
    </div>
  );
}

const toolbarStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  height: 32,
  minHeight: 32,
  maxHeight: 32,
  padding: '0 8px',
  borderBottom: '1px solid #313244',
  userSelect: 'none',
};

const leftStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  overflow: 'hidden',
};

const nameStyle: CSSProperties = {
  color: '#cdd6f4',
  fontSize: 12,
  cursor: 'default',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const inputStyle: CSSProperties = {
  background: '#1e1e2e',
  border: '1px solid #313244',
  borderRadius: 3,
  color: '#cdd6f4',
  fontSize: 12,
  padding: '1px 4px',
  outline: 'none',
  width: 120,
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
  border: 'none',
  borderRadius: 3,
  cursor: 'pointer',
  padding: 0,
};
