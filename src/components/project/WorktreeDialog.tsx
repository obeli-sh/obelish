import { useCallback, useEffect, useRef, useState } from 'react';
import type { WorktreeInfo } from '../../lib/workspace-types';
import { tauriBridge } from '../../lib/tauri-bridge';

export interface WorktreeDialogProps {
  projectId: string;
  projectName: string;
  isOpen: boolean;
  onSelect: (worktree: WorktreeInfo) => void;
  onClose: () => void;
  onAutoSelect?: (worktree: WorktreeInfo) => void;
  openWorktreePaths?: string[];
}

export function WorktreeDialog({
  projectId,
  projectName,
  isOpen,
  onSelect,
  onClose,
  onAutoSelect,
  openWorktreePaths = [],
}: WorktreeDialogProps) {
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [newBranchName, setNewBranchName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const onAutoSelectRef = useRef(onAutoSelect);
  onAutoSelectRef.current = onAutoSelect;

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    setError(null);
    setFocusedIndex(0);
    setHoveredIndex(null);
    tauriBridge.worktree
      .list(projectId)
      .then((result) => {
        setWorktrees(result);
        setLoading(false);

        // Auto-select if exactly one worktree
        if (result.length === 1 && onAutoSelectRef.current) {
          onAutoSelectRef.current(result[0]);
          return;
        }

        // Focus first worktree or fall back to input
        if (result.length === 0) {
          setTimeout(() => inputRef.current?.focus(), 0);
        } else {
          setFocusedIndex(0);
          setTimeout(() => dialogRef.current?.focus(), 0);
        }
      })
      .catch((err) => {
        setError(String(err));
        setLoading(false);
      });
  }, [isOpen, projectId]);

  const handleCreateWorktree = useCallback(async () => {
    const trimmed = newBranchName.trim();
    if (!trimmed) return;
    setCreating(true);
    setError(null);
    try {
      const wt = await tauriBridge.worktree.create(projectId, trimmed);
      setNewBranchName('');
      onSelect(wt);
    } catch (err) {
      setError(String(err));
    } finally {
      setCreating(false);
    }
  }, [projectId, newBranchName, onSelect]);

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        handleCreateWorktree();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    },
    [handleCreateWorktree, onClose],
  );

  const handleDialogKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (worktrees.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((prev) =>
          prev < worktrees.length - 1 ? prev + 1 : 0,
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) =>
          prev > 0 ? prev - 1 : worktrees.length - 1,
        );
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (focusedIndex >= 0 && focusedIndex < worktrees.length) {
          onSelect(worktrees[focusedIndex]);
        }
      }
    },
    [worktrees, focusedIndex, onClose, onSelect],
  );

  const isWorktreeOpen = useCallback(
    (path: string) => openWorktreePaths.includes(path),
    [openWorktreePaths],
  );

  if (!isOpen) return null;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div
        ref={dialogRef}
        style={dialogStyle}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleDialogKeyDown}
        tabIndex={-1}
      >
        <div style={headerStyle}>
          <h3 style={titleStyle}>{projectName} — Select Worktree</h3>
          <button style={closeButtonStyle} onClick={onClose}>
            ×
          </button>
        </div>

        {loading && <p style={statusStyle}>Loading worktrees...</p>}
        {error && <p style={errorStyle}>{error}</p>}

        {!loading && worktrees.length > 0 && (
          <ul style={listStyle}>
            {worktrees.map((wt, index) => {
              const isFocused = index === focusedIndex;
              const isHovered = index === hoveredIndex;
              const isOpen = isWorktreeOpen(wt.path);

              const buttonStyle: React.CSSProperties = {
                ...worktreeButtonStyle,
                ...(isHovered ? hoverStyle : {}),
                ...(isFocused ? focusedStyle : {}),
                ...(isOpen ? openWorktreeStyle : {}),
              };

              return (
                <li key={wt.path} style={itemStyle}>
                  <button
                    style={buttonStyle}
                    onClick={() => onSelect(wt)}
                    onMouseEnter={() => setHoveredIndex(index)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  >
                    <span style={branchRowStyle}>
                      <span style={branchNameStyle}>
                        {wt.branch ?? 'detached'}
                        {wt.isMain && ' (root)'}
                      </span>
                      {isOpen && <span style={openBadgeStyle}>open</span>}
                    </span>
                    <span style={pathStyle}>{wt.path}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <div style={createSectionStyle}>
          <div style={dividerStyle} />
          <label style={labelStyle}>Create new worktree</label>
          <div style={createRowStyle}>
            <input
              ref={inputRef}
              type="text"
              placeholder="Branch name..."
              value={newBranchName}
              onChange={(e) => setNewBranchName(e.target.value)}
              onKeyDown={handleInputKeyDown}
              style={inputStyle}
              disabled={creating}
            />
            <button
              onClick={handleCreateWorktree}
              style={createButtonStyle}
              disabled={creating || !newBranchName.trim()}
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  backgroundColor: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const dialogStyle: React.CSSProperties = {
  width: 500,
  maxHeight: '80vh',
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
  padding: 20,
  border: '1px solid var(--ui-border)',
  borderRadius: 'var(--ui-radius)',
  backgroundColor: 'var(--ui-panel-bg)',
  color: 'var(--ui-text-primary)',
  outline: 'none',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 14,
  fontFamily: 'var(--ui-font-mono)',
  letterSpacing: '0.04em',
};

const closeButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  color: 'var(--ui-text-muted)',
  fontSize: 18,
  cursor: 'pointer',
  padding: '4px 8px',
};

const statusStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: 'var(--ui-text-muted)',
  fontFamily: 'var(--ui-font-mono)',
};

const errorStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: 'var(--ui-danger, #ff5555)',
  fontFamily: 'var(--ui-font-mono)',
};

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  maxHeight: 250,
  overflow: 'auto',
};

const itemStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
};

const worktreeButtonStyle: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: '8px 12px',
  background: 'none',
  border: '1px solid var(--ui-border)',
  borderRadius: 'var(--ui-radius)',
  color: 'var(--ui-text-primary)',
  cursor: 'pointer',
  textAlign: 'left',
  fontFamily: 'var(--ui-font-mono)',
};

const hoverStyle: React.CSSProperties = {
  background: 'rgba(137, 180, 250, 0.1)',
};

const focusedStyle: React.CSSProperties = {
  outline: '2px solid var(--ui-accent)',
  outlineOffset: '-2px',
};

const openWorktreeStyle: React.CSSProperties = {
  opacity: 0.7,
};

const branchRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const branchNameStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
};

const openBadgeStyle: React.CSSProperties = {
  fontSize: 9,
  fontFamily: 'var(--ui-font-mono)',
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  color: 'var(--ui-accent)',
  border: '1px solid var(--ui-accent)',
  borderRadius: 'var(--ui-radius)',
  padding: '1px 5px',
  lineHeight: '14px',
};

const pathStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--ui-text-muted)',
};

const createSectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const dividerStyle: React.CSSProperties = {
  height: 1,
  backgroundColor: 'var(--ui-border)',
  margin: '4px 0',
};

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--ui-text-muted)',
  fontFamily: 'var(--ui-font-mono)',
  letterSpacing: '0.04em',
};

const createRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
};

const inputStyle: React.CSSProperties = {
  flex: 1,
  padding: '8px 12px',
  background: 'var(--ui-panel-bg-alt)',
  border: '1px solid var(--ui-border)',
  borderRadius: 'var(--ui-radius)',
  color: 'var(--ui-text-primary)',
  fontFamily: 'var(--ui-font-mono)',
  fontSize: 12,
  outline: 'none',
};

const createButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  background: 'none',
  border: '1px solid var(--ui-border)',
  borderRadius: 'var(--ui-radius)',
  color: 'var(--ui-text-primary)',
  fontFamily: 'var(--ui-font-mono)',
  fontSize: 12,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
};
