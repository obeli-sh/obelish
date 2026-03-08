import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Fuse from 'fuse.js';
import { open } from '@tauri-apps/plugin-dialog';
import { isTauri } from '../../lib/browser-mock';
import { tauriBridge } from '../../lib/tauri-bridge';
import type { ProjectInfo, WorktreeInfo } from '../../lib/workspace-types';

export interface ProjectPickerProps {
  projects: ProjectInfo[];
  onProjectAdd: (rootPath: string) => Promise<ProjectInfo | null>;
  onProjectRemove?: (projectId: string) => void;
  onOpenProject: (project: ProjectInfo, worktree: WorktreeInfo) => void;
  onEscape?: () => void;
  error?: string | null;
  loading?: boolean;
  openWorktreePaths?: string[];
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const AVATAR_COLORS = [
  '#f38ba8', '#fab387', '#f9e2af', '#a6e3a1',
  '#89dceb', '#89b4fa', '#cba6f7', '#f5c2e7',
];

function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function getAvatarColor(name: string): string {
  return AVATAR_COLORS[hashString(name) % AVATAR_COLORS.length];
}

function shortenPath(path: string): string {
  const homeMatch = path.match(/^(\/home\/[^/]+|\/Users\/[^/]+|C:\\Users\\[^\\]+)/);
  if (homeMatch) {
    return '~' + path.slice(homeMatch[0].length);
  }
  const sep = path.includes('\\') ? '\\' : '/';
  const parts = path.split(sep).filter(Boolean);
  if (parts.length <= 3) return path;
  return '...' + sep + parts.slice(-3).join(sep);
}

type ShellEnv = 'windows' | 'wsl';

function isWindows(): boolean {
  return typeof navigator !== 'undefined' && navigator.platform.startsWith('Win');
}

function isWslPath(path: string): boolean {
  // WSL paths are Unix-style (start with /) and don't start with Windows UNC WSL prefix
  if (path.startsWith('\\\\wsl')) return true;
  return path.startsWith('/') && !path.startsWith('//');
}

function isWindowsPath(path: string): boolean {
  // Drive letter (C:\...) or UNC (\\server\...) but not \\wsl
  if (/^[a-zA-Z]:[\\/]/.test(path)) return true;
  if (path.startsWith('\\\\') && !path.startsWith('\\\\wsl')) return true;
  return false;
}

function filterByShellEnv(projects: ProjectInfo[], env: ShellEnv): ProjectInfo[] {
  return projects.filter((p) => {
    if (env === 'wsl') return isWslPath(p.rootPath);
    if (env === 'windows') return isWindowsPath(p.rootPath);
    return true;
  });
}

// ─── Icons ───────────────────────────────────────────────────────────────────

function FolderPlusIcon({ size = 48 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  );
}

function FolderIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ChevronIcon({ open: isOpen }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{
        transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
        transition: 'transform 150ms ease',
        flexShrink: 0,
      }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function GitBranchIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

// ─── Component ───────────────────────────────────────────────────────────────

export function ProjectPicker({
  projects,
  onProjectAdd,
  onProjectRemove,
  onOpenProject,
  onEscape,
  error,
  loading,
  openWorktreePaths = [],
}: ProjectPickerProps) {
  const [folderPath, setFolderPath] = useState('');
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const [hoveredIndex, setHoveredIndex] = useState(-1);
  const [searchQuery, setSearchQuery] = useState('');
  const [shellEnv, setShellEnv] = useState<ShellEnv>('windows');
  const showEnvToggle = isWindows();

  // Path autocomplete
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(-1);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);


  // Inline worktree expansion
  const [expandedProjectId, setExpandedProjectId] = useState<string | null>(null);
  const [worktrees, setWorktrees] = useState<WorktreeInfo[]>([]);
  const [worktreeLoading, setWorktreeLoading] = useState(false);
  const [worktreeError, setWorktreeError] = useState<string | null>(null);
  const [focusedWorktreeIndex, setFocusedWorktreeIndex] = useState(0);
  const [hoveredWorktreeIndex, setHoveredWorktreeIndex] = useState(-1);
  const [newBranchName, setNewBranchName] = useState('');
  const [creatingWorktree, setCreatingWorktree] = useState(false);

  // Remove confirmation
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const confirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Browse button hover
  const [browseHovered, setBrowseHovered] = useState(false);
  const [openFolderHovered, setOpenFolderHovered] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const pathRowRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const branchInputRef = useRef<HTMLInputElement>(null);
  const [suggestionsPos, setSuggestionsPos] = useState<{ top: number; left: number; width: number } | null>(null);

  // Filter by shell environment (Windows only), then fuzzy search
  const envProjects = useMemo(
    () => (showEnvToggle ? filterByShellEnv(projects, shellEnv) : projects),
    [projects, shellEnv, showEnvToggle],
  );

  const fuse = useMemo(
    () =>
      new Fuse(envProjects, {
        keys: [
          { name: 'name', weight: 2 },
          { name: 'rootPath', weight: 1 },
        ],
        threshold: 0.4,
        includeScore: true,
      }),
    [envProjects],
  );

  const filteredProjects = useMemo(() => {
    if (!searchQuery.trim()) return envProjects;
    return fuse.search(searchQuery).map((r) => r.item);
  }, [fuse, searchQuery, envProjects]);

  // Compute the fixed position for the suggestions dropdown
  const updateSuggestionsPos = useCallback(() => {
    const el = pathRowRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    setSuggestionsPos({ top: rect.bottom + 4, left: rect.left, width: rect.width });
  }, []);

  // Fetch directory suggestions as user types
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = folderPath.trim();
    if (!trimmed || trimmed.length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const isWsl = shellEnv === 'wsl';
        const dirs = await tauriBridge.fs.listDirectories(trimmed, isWsl);

        setSuggestions(dirs);
        setSelectedSuggestion(-1);
        if (dirs.length > 0) {
          updateSuggestionsPos();
          setShowSuggestions(true);
        } else {
          setShowSuggestions(false);
        }
      } catch {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    }, 150);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [folderPath, shellEnv, updateSuggestionsPos]);

  // Autofocus
  useEffect(() => {
    if (projects.length > 0) {
      setFocusedIndex(0);
      containerRef.current?.focus();
    } else {
      inputRef.current?.focus();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Escape key listener
  useEffect(() => {
    if (!onEscape) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (expandedProjectId) {
          setExpandedProjectId(null);
          setWorktrees([]);
          setWorktreeError(null);
        } else {
          onEscape();
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onEscape, expandedProjectId]);

  // Clear confirm-remove after timeout
  useEffect(() => {
    if (!confirmRemoveId) return;
    confirmTimerRef.current = setTimeout(() => setConfirmRemoveId(null), 3000);
    return () => {
      if (confirmTimerRef.current) clearTimeout(confirmTimerRef.current);
    };
  }, [confirmRemoveId]);

  // Reset focused index when filtered list changes
  useEffect(() => {
    if (filteredProjects.length > 0) {
      setFocusedIndex((prev) =>
        prev >= filteredProjects.length ? 0 : prev < 0 ? 0 : prev,
      );
    } else {
      setFocusedIndex(-1);
    }
  }, [filteredProjects.length]);

  const handleSelectSuggestion = useCallback((path: string) => {
    const sep = path.includes('\\') ? '\\' : '/';
    const withSep = path.endsWith(sep) ? path : path + sep;
    setFolderPath(withSep);
    setShowSuggestions(false);
    inputRef.current?.focus();
  }, []);

  // ─── Worktree expansion ──────────────────────────────────────────────────

  const expandAndSelectProject = useCallback(
    async (project: ProjectInfo) => {
      setExpandedProjectId(project.id);
      setWorktreeLoading(true);
      setWorktreeError(null);
      setNewBranchName('');

      try {
        const wts = await tauriBridge.worktree.list(project.id);
        setWorktrees(wts);
        setFocusedWorktreeIndex(0);
        setWorktreeLoading(false);

        if (wts.length === 1) {
          onOpenProject(project, wts[0]);
          return;
        }

        // Focus the worktree section
        setTimeout(() => containerRef.current?.focus(), 0);
      } catch (err) {
        setWorktreeError(String(err));
        setWorktreeLoading(false);
      }
    },
    [onOpenProject],
  );

  const handleProjectClick = useCallback(
    async (project: ProjectInfo) => {
      if (expandedProjectId === project.id) {
        setExpandedProjectId(null);
        setWorktrees([]);
        setWorktreeError(null);
        return;
      }
      await expandAndSelectProject(project);
    },
    [expandedProjectId, expandAndSelectProject],
  );

  const handleWorktreeClick = useCallback(
    (worktree: WorktreeInfo) => {
      if (!expandedProjectId) return;
      const project = projects.find((p) => p.id === expandedProjectId);
      if (project) {
        onOpenProject(project, worktree);
      }
    },
    [expandedProjectId, projects, onOpenProject],
  );

  const handleCreateWorktree = useCallback(async () => {
    const trimmed = newBranchName.trim();
    if (!trimmed || !expandedProjectId) return;
    setCreatingWorktree(true);
    setWorktreeError(null);
    try {
      const wt = await tauriBridge.worktree.create(expandedProjectId, trimmed);
      const project = projects.find((p) => p.id === expandedProjectId);
      if (project) {
        onOpenProject(project, wt);
      }
    } catch (err) {
      setWorktreeError(String(err));
    } finally {
      setCreatingWorktree(false);
    }
  }, [expandedProjectId, newBranchName, projects, onOpenProject]);

  // ─── Add / Browse ────────────────────────────────────────────────────────

  const handleAddFolder = useCallback(async () => {
    const trimmed = folderPath.trim();
    if (!trimmed) return;
    const project = await onProjectAdd(trimmed);
    if (project) {
      setFolderPath('');
      await expandAndSelectProject(project);
    }
  }, [folderPath, onProjectAdd, expandAndSelectProject]);

  const handleBrowse = useCallback(async () => {
    try {
      const defaultPath = shellEnv === 'wsl' ? '\\\\wsl$\\' : undefined;
      const selected = await open({ directory: true, multiple: false, defaultPath });
      if (typeof selected === 'string') {
        const project = await onProjectAdd(selected);
        if (project) {
          await expandAndSelectProject(project);
        }
      }
    } catch {
      // User cancelled or dialog error
    }
  }, [onProjectAdd, shellEnv, expandAndSelectProject]);

  // ─── Remove confirmation ─────────────────────────────────────────────────

  const handleRemoveClick = useCallback(
    (e: React.MouseEvent, projectId: string) => {
      e.stopPropagation();
      if (confirmRemoveId === projectId) {
        onProjectRemove?.(projectId);
        setConfirmRemoveId(null);
      } else {
        setConfirmRemoveId(projectId);
      }
    },
    [confirmRemoveId, onProjectRemove],
  );

  // ─── Keyboard navigation ─────────────────────────────────────────────────

  const handleInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (showSuggestions && suggestions.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setSelectedSuggestion((prev) =>
            prev < suggestions.length - 1 ? prev + 1 : 0,
          );
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setSelectedSuggestion((prev) =>
            prev > 0 ? prev - 1 : suggestions.length - 1,
          );
          return;
        }
        if ((e.key === 'Tab' || e.key === 'Enter') && selectedSuggestion >= 0) {
          e.preventDefault();
          handleSelectSuggestion(suggestions[selectedSuggestion]);
          return;
        }
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        handleAddFolder();
      }
      if (e.key === 'Escape' && showSuggestions) {
        e.stopPropagation();
        setShowSuggestions(false);
      }
    },
    [handleAddFolder, showSuggestions, suggestions, selectedSuggestion, handleSelectSuggestion],
  );

  const handleContainerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // If expanded and navigating worktrees
      if (expandedProjectId && worktrees.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          setFocusedWorktreeIndex((prev) =>
            prev < worktrees.length - 1 ? prev + 1 : 0,
          );
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          setFocusedWorktreeIndex((prev) =>
            prev > 0 ? prev - 1 : worktrees.length - 1,
          );
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          if (focusedWorktreeIndex >= 0 && focusedWorktreeIndex < worktrees.length) {
            handleWorktreeClick(worktrees[focusedWorktreeIndex]);
          }
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setExpandedProjectId(null);
          setWorktrees([]);
          setWorktreeError(null);
          return;
        }
      }

      // Project list navigation
      if (filteredProjects.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedIndex((prev) =>
          prev < filteredProjects.length - 1 ? prev + 1 : 0,
        );
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredProjects.length - 1,
        );
      } else if (e.key === 'Enter' && focusedIndex >= 0 && focusedIndex < filteredProjects.length) {
        e.preventDefault();
        handleProjectClick(filteredProjects[focusedIndex]);
      }
    },
    [
      filteredProjects, focusedIndex, expandedProjectId,
      worktrees, focusedWorktreeIndex, handleProjectClick, handleWorktreeClick,
    ],
  );

  const handleBranchKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        handleCreateWorktree();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        branchInputRef.current?.blur();
      }
    },
    [handleCreateWorktree],
  );

  const isAddDisabled = !folderPath.trim() || !!loading;

  return (
    <div style={containerStyle} className="picker-enter">
      <div
        ref={containerRef}
        style={pickerStyle}
        onKeyDown={handleContainerKeyDown}
        tabIndex={-1}
        role="dialog"
        aria-label="Open a Project"
      >
        {/* ── Header ────────────────────────────────────────────────── */}
        <div style={headerStyle}>
          <h2 style={titleStyle}>Open a Project</h2>
          <p style={subtitleStyle}>
            {envProjects.length > 0
              ? 'Select a recent project or open a new folder'
              : 'Open a folder to create your first workspace'}
          </p>
        </div>

        {/* ── Windows / WSL toggle ──────────────────────────────────── */}
        {showEnvToggle && (
          <div style={envToggleContainerStyle} role="radiogroup" aria-label="Shell environment">
            <button
              role="radio"
              aria-checked={shellEnv === 'windows'}
              style={{
                ...envToggleButtonStyle,
                ...(shellEnv === 'windows' ? envToggleActiveStyle : {}),
              }}
              onClick={() => setShellEnv('windows')}
            >
              Windows
            </button>
            <button
              role="radio"
              aria-checked={shellEnv === 'wsl'}
              style={{
                ...envToggleButtonStyle,
                ...(shellEnv === 'wsl' ? envToggleActiveStyle : {}),
              }}
              onClick={() => setShellEnv('wsl')}
            >
              WSL
            </button>
          </div>
        )}

        {/* ── Browse button (hero CTA) ─────────────────────────────── */}
        {isTauri() && shellEnv !== 'wsl' && (
          <button
            style={{
              ...browseButtonStyle,
              ...(browseHovered && !loading ? browseHoverStyle : {}),
              ...(loading ? disabledStyle : {}),
            }}
            onClick={handleBrowse}
            onMouseEnter={() => setBrowseHovered(true)}
            onMouseLeave={() => setBrowseHovered(false)}
            disabled={!!loading}
          >
            <FolderIcon />
            <span>{loading ? 'Adding...' : 'Browse Folder...'}</span>
          </button>
        )}

        {/* ── Empty state ──────────────────────────────────────────── */}
        {envProjects.length === 0 && (
          <div style={emptyStateStyle}>
            <div style={emptyIconStyle}>
              <FolderPlusIcon size={48} />
            </div>
            <p style={emptyTitleStyle}>No projects yet</p>
            <p style={emptySubtitleStyle}>
              Browse for a folder above or paste a path below
            </p>
          </div>
        )}

        {/* ── Project list ─────────────────────────────────────────── */}
        {envProjects.length > 0 && (
          <div style={listSectionStyle}>
            <label htmlFor="project-search" style={sectionLabelStyle}>
              Recent Projects
            </label>
            <input
              id="project-search"
              ref={searchRef}
              type="text"
              placeholder="Filter projects..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={searchInputStyle}
              aria-label="Filter projects"
            />

            {filteredProjects.length > 0 ? (
              <ul style={listStyle} role="listbox" aria-label="Projects">
                {filteredProjects.map((project, index) => {
                  const isFocused = index === focusedIndex && !expandedProjectId;
                  const isHovered = index === hoveredIndex;
                  const isExpanded = expandedProjectId === project.id;
                  const avatarColor = getAvatarColor(project.name);

                  return (
                    <li key={project.id} style={itemStyle} role="option" aria-selected={isFocused}>
                      <div
                        style={{
                          ...projectButtonWrapperStyle,
                          ...(isHovered || isExpanded ? projectHoverStyle : {}),
                          ...(isFocused ? projectFocusStyle : {}),
                          ...(isExpanded ? projectExpandedStyle : {}),
                        }}
                        onMouseEnter={() => {
                          setHoveredIndex(index);
                          if (!expandedProjectId) setFocusedIndex(index);
                        }}
                        onMouseLeave={() => {
                          setHoveredIndex(-1);
                          setConfirmRemoveId(null);
                        }}
                      >
                        <button
                          style={projectButtonStyle}
                          onClick={() => handleProjectClick(project)}
                          aria-expanded={isExpanded}
                        >
                          {/* Avatar */}
                          <div style={{ ...avatarStyle, backgroundColor: avatarColor }}>
                            {project.name.charAt(0).toUpperCase()}
                          </div>

                          {/* Name + Path */}
                          <div style={projectInfoStyle}>
                            <span style={projectNameStyle}>{project.name}</span>
                            <span style={projectPathStyle} title={project.rootPath}>
                              {shortenPath(project.rootPath)}
                            </span>
                          </div>
                        </button>

                        {/* Remove button (sibling, not nested) */}
                        {onProjectRemove && (isHovered || confirmRemoveId === project.id) && (
                          <button
                            style={{
                              ...removeButtonStyle,
                              ...(confirmRemoveId === project.id ? removeConfirmStyle : {}),
                            }}
                            onClick={(e) => handleRemoveClick(e, project.id)}
                            aria-label={
                              confirmRemoveId === project.id
                                ? `Confirm remove ${project.name}`
                                : `Remove ${project.name}`
                            }
                          >
                            {confirmRemoveId === project.id ? 'Remove?' : '\u00d7'}
                          </button>
                        )}

                        {/* Chevron */}
                        <button
                          style={chevronButtonStyle}
                          onClick={() => handleProjectClick(project)}
                          tabIndex={-1}
                          aria-hidden="true"
                        >
                          <ChevronIcon open={isExpanded} />
                        </button>
                      </div>

                      {/* ── Inline worktree expansion ──────────────── */}
                      {isExpanded && (
                        <div style={worktreeContainerStyle}>
                          {worktreeLoading && (
                            <p style={worktreeStatusStyle}>Loading worktrees...</p>
                          )}
                          {worktreeError && (
                            <p style={worktreeErrorStyle} role="alert">{worktreeError}</p>
                          )}

                          {!worktreeLoading && worktrees.length > 0 && (
                            <ul style={worktreeListStyle} role="listbox" aria-label="Worktrees">
                              {worktrees.map((wt, wtIndex) => {
                                const isWtFocused = wtIndex === focusedWorktreeIndex;
                                const isWtHovered = wtIndex === hoveredWorktreeIndex;
                                const isWtOpen = openWorktreePaths.includes(wt.path);

                                return (
                                  <li key={wt.path} style={worktreeItemStyle} role="option" aria-selected={isWtFocused}>
                                    <button
                                      style={{
                                        ...worktreeButtonStyle,
                                        ...(isWtHovered ? worktreeHoverStyle : {}),
                                        ...(isWtFocused ? worktreeFocusStyle : {}),
                                        ...(isWtOpen ? worktreeOpenStyle : {}),
                                      }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleWorktreeClick(wt);
                                      }}
                                      onMouseEnter={() => setHoveredWorktreeIndex(wtIndex)}
                                      onMouseLeave={() => setHoveredWorktreeIndex(-1)}
                                    >
                                      <span style={worktreeBranchRow}>
                                        <GitBranchIcon />
                                        <span style={worktreeBranchName}>
                                          {wt.branch ?? 'detached'}
                                          {wt.isMain && ' (root)'}
                                        </span>
                                        {isWtOpen && <span style={openBadgeStyle}>open</span>}
                                      </span>
                                      <span style={worktreePathStyle}>{wt.path}</span>
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          )}

                          {/* Create new worktree */}
                          {!worktreeLoading && (
                            <div style={createWorktreeStyle}>
                              <div style={worktreeDividerStyle} />
                              <label style={createLabelStyle} htmlFor="new-branch-input">
                                Create new worktree
                              </label>
                              <div style={createRowStyle}>
                                <input
                                  id="new-branch-input"
                                  ref={branchInputRef}
                                  type="text"
                                  placeholder="Branch name..."
                                  value={newBranchName}
                                  onChange={(e) => setNewBranchName(e.target.value)}
                                  onKeyDown={handleBranchKeyDown}
                                  onClick={(e) => e.stopPropagation()}
                                  style={createInputStyle}
                                  disabled={creatingWorktree}
                                />
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleCreateWorktree();
                                  }}
                                  style={{
                                    ...createButtonStyle,
                                    ...(creatingWorktree || !newBranchName.trim() ? disabledStyle : {}),
                                  }}
                                  disabled={creatingWorktree || !newBranchName.trim()}
                                >
                                  {creatingWorktree ? 'Creating...' : 'Create'}
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              searchQuery.trim() && (
                <div style={noResultsStyle}>
                  <p>No matching projects</p>
                  <button
                    style={clearSearchStyle}
                    onClick={() => setSearchQuery('')}
                  >
                    Clear search
                  </button>
                </div>
              )
            )}
          </div>
        )}

        {/* ── Separator ────────────────────────────────────────────── */}
        <div style={separatorStyle}>
          <div style={separatorLineStyle} />
          <span style={separatorTextStyle}>or enter a path</span>
          <div style={separatorLineStyle} />
        </div>

        {/* ── Path input ───────────────────────────────────────────── */}
        <div ref={pathRowRef} style={addFolderStyle}>
          <input
            ref={inputRef}
            type="text"
            placeholder={
              shellEnv === 'wsl' ? '/home/user/project...' : 'Enter folder path...'
            }
            value={folderPath}
            onChange={(e) => setFolderPath(e.target.value)}
            onKeyDown={handleInputKeyDown}
            onBlur={() => {
              setTimeout(() => setShowSuggestions(false), 150);
            }}
            onFocus={() => {
              if (suggestions.length > 0) {
                updateSuggestionsPos();
                setShowSuggestions(true);
              }
            }}
            style={pathInputStyle}
            autoComplete="off"
            aria-label="Folder path"
          />
          <button
            onClick={handleAddFolder}
            disabled={isAddDisabled}
            style={{
              ...openFolderButtonStyle,
              ...(isAddDisabled ? disabledStyle : {}),
              ...(openFolderHovered && !isAddDisabled ? openFolderHoverStyle : {}),
            }}
            onMouseEnter={() => setOpenFolderHovered(true)}
            onMouseLeave={() => setOpenFolderHovered(false)}
          >
            {loading ? 'Adding...' : 'Open Folder'}
          </button>
        </div>

        {/* ── Error ────────────────────────────────────────────────── */}
        {error && (
          <p style={errorStyle} role="alert" aria-live="polite">
            {error}
          </p>
        )}

        {/* ── Keyboard hints ───────────────────────────────────────── */}
        <div style={hintsStyle} aria-hidden="true">
          <span style={hintItemStyle}>
            <kbd style={kbdStyle}>&uarr;&darr;</kbd> Navigate
          </span>
          <span style={hintItemStyle}>
            <kbd style={kbdStyle}>&crarr;</kbd> Open
          </span>
          {onEscape && (
            <span style={hintItemStyle}>
              <kbd style={kbdStyle}>Esc</kbd> Close
            </span>
          )}
        </div>
      </div>

      {/* Suggestions portal — rendered outside the picker to avoid overflow clipping */}
      {showSuggestions && suggestions.length > 0 && suggestionsPos &&
        createPortal(
          <ul
            style={{
              ...suggestionsListStyle,
              top: suggestionsPos.top,
              left: suggestionsPos.left,
              width: suggestionsPos.width,
            }}
            role="listbox"
            aria-label="Directory suggestions"
          >
            {suggestions.map((s, i) => {
              const displayName = s.split(/[\\/]/).filter(Boolean).pop() ?? s;
              return (
                <li
                  key={s}
                  role="option"
                  aria-selected={i === selectedSuggestion}
                  style={{
                    ...suggestionItemStyle,
                    ...(i === selectedSuggestion ? suggestionActiveStyle : {}),
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    handleSelectSuggestion(s);
                  }}
                  onMouseEnter={() => setSelectedSuggestion(i)}
                >
                  <span style={suggestionNameStyle}>{displayName}</span>
                  <span style={suggestionPathStyle}>{s}</span>
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </div>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const containerStyle: React.CSSProperties = {
  width: '100vw',
  height: '100vh',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  backgroundColor: 'var(--ui-bg-app)',
  color: 'var(--ui-text-primary)',
};

const pickerStyle: React.CSSProperties = {
  width: 520,
  maxHeight: '85vh',
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  padding: 28,
  border: '1px solid var(--ui-border)',
  borderRadius: '8px',
  backgroundColor: 'var(--ui-panel-bg)',
  outline: 'none',
  overflowY: 'auto',
};

const headerStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
  textAlign: 'center',
};

const titleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 20,
  fontFamily: 'var(--ui-font-mono)',
  fontWeight: 700,
  letterSpacing: '0.04em',
  color: 'var(--ui-text-primary)',
};

const subtitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: 'var(--ui-text-muted)',
  fontFamily: 'var(--ui-font-mono)',
  letterSpacing: '0.02em',
};

const browseButtonStyle: React.CSSProperties = {
  width: '100%',
  padding: '12px 16px',
  background: 'var(--ui-accent)',
  border: 'none',
  borderRadius: '6px',
  color: '#1e1e2e',
  fontFamily: 'var(--ui-font-mono)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  letterSpacing: '0.02em',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 8,
  transition: 'background 150ms ease, opacity 150ms ease',
};

const browseHoverStyle: React.CSSProperties = {
  background: 'rgba(137, 180, 250, 0.85)',
};

const disabledStyle: React.CSSProperties = {
  opacity: 0.4,
  cursor: 'not-allowed',
};

// ─── Empty state ─────────────────────────────────────────────────────────────

const emptyStateStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  padding: '24px 0 8px',
};

const emptyIconStyle: React.CSSProperties = {
  color: 'var(--ui-text-muted)',
  opacity: 0.5,
};

const emptyTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 14,
  fontWeight: 600,
  color: 'var(--ui-text-primary)',
  fontFamily: 'var(--ui-font-mono)',
};

const emptySubtitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: 'var(--ui-text-muted)',
  fontFamily: 'var(--ui-font-mono)',
  textAlign: 'center',
};

// ─── Project list ────────────────────────────────────────────────────────────

const listSectionStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontFamily: 'var(--ui-font-mono)',
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--ui-text-muted)',
};

const searchInputStyle: React.CSSProperties = {
  padding: '8px 12px',
  background: 'var(--ui-panel-bg-alt)',
  border: '1px solid var(--ui-border)',
  borderRadius: 'var(--ui-radius)',
  color: 'var(--ui-text-primary)',
  fontFamily: 'var(--ui-font-mono)',
  fontSize: 12,
  outline: 'none',
  transition: 'border-color 150ms ease',
};

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  maxHeight: 300,
  overflow: 'auto',
};

const itemStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
};

const projectButtonWrapperStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 0,
  border: '1px solid var(--ui-border)',
  borderRadius: 'var(--ui-radius)',
  transition: 'background 150ms ease, border-color 150ms ease',
};

const projectButtonStyle: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: '10px 12px',
  background: 'none',
  border: 'none',
  color: 'var(--ui-text-primary)',
  cursor: 'pointer',
  textAlign: 'left',
  fontFamily: 'var(--ui-font-mono)',
  outline: 'none',
  minWidth: 0,
};

const chevronButtonStyle: React.CSSProperties = {
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  padding: '0 10px 0 0',
  display: 'flex',
  alignItems: 'center',
  color: 'var(--ui-text-muted)',
};

const projectHoverStyle: React.CSSProperties = {
  background: 'rgba(137, 180, 250, 0.08)',
};

const projectFocusStyle: React.CSSProperties = {
  outline: '2px solid var(--ui-accent)',
  outlineOffset: '-2px',
};

const projectExpandedStyle: React.CSSProperties = {
  borderColor: 'var(--ui-accent)',
  borderBottomLeftRadius: 0,
  borderBottomRightRadius: 0,
  background: 'rgba(137, 180, 250, 0.06)',
};

const avatarStyle: React.CSSProperties = {
  width: 32,
  height: 32,
  borderRadius: '50%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontSize: 14,
  fontWeight: 700,
  color: '#1e1e2e',
  flexShrink: 0,
  fontFamily: 'var(--ui-font-mono)',
};

const projectInfoStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  flex: 1,
  minWidth: 0,
};

const projectNameStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const projectPathStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--ui-text-muted)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

const removeButtonStyle: React.CSSProperties = {
  padding: '2px 6px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--ui-radius)',
  background: 'none',
  border: '1px solid transparent',
  color: 'var(--ui-text-muted)',
  cursor: 'pointer',
  fontSize: 14,
  fontFamily: 'var(--ui-font-mono)',
  flexShrink: 0,
  lineHeight: 1,
  transition: 'all 150ms ease',
};

const removeConfirmStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--ui-danger)',
  border: '1px solid var(--ui-danger)',
  background: 'rgba(243, 139, 168, 0.1)',
  padding: '2px 8px',
  letterSpacing: '0.04em',
};

// ─── Inline worktree ─────────────────────────────────────────────────────────

const worktreeContainerStyle: React.CSSProperties = {
  border: '1px solid var(--ui-accent)',
  borderTop: 'none',
  borderBottomLeftRadius: 'var(--ui-radius)',
  borderBottomRightRadius: 'var(--ui-radius)',
  padding: '8px',
  background: 'rgba(137, 180, 250, 0.03)',
};

const worktreeStatusStyle: React.CSSProperties = {
  margin: 0,
  padding: '8px 4px',
  fontSize: 11,
  color: 'var(--ui-text-muted)',
  fontFamily: 'var(--ui-font-mono)',
};

const worktreeErrorStyle: React.CSSProperties = {
  margin: 0,
  padding: '4px',
  fontSize: 11,
  color: 'var(--ui-danger)',
  fontFamily: 'var(--ui-font-mono)',
};

const worktreeListStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  maxHeight: 180,
  overflow: 'auto',
};

const worktreeItemStyle: React.CSSProperties = {
  margin: 0,
  padding: 0,
};

const worktreeButtonStyle: React.CSSProperties = {
  width: '100%',
  display: 'flex',
  flexDirection: 'column',
  gap: 2,
  padding: '6px 10px',
  background: 'none',
  border: '1px solid transparent',
  borderRadius: 'var(--ui-radius)',
  color: 'var(--ui-text-primary)',
  cursor: 'pointer',
  textAlign: 'left',
  fontFamily: 'var(--ui-font-mono)',
  transition: 'background 150ms ease',
};

const worktreeHoverStyle: React.CSSProperties = {
  background: 'rgba(137, 180, 250, 0.1)',
};

const worktreeFocusStyle: React.CSSProperties = {
  outline: '1px solid var(--ui-accent)',
  outlineOffset: '-1px',
};

const worktreeOpenStyle: React.CSSProperties = {
  opacity: 0.6,
};

const worktreeBranchRow: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
};

const worktreeBranchName: React.CSSProperties = {
  fontSize: 12,
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
  padding: '0 4px',
  lineHeight: '14px',
};

const worktreePathStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--ui-text-muted)',
  paddingLeft: 18,
};

const createWorktreeStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const worktreeDividerStyle: React.CSSProperties = {
  height: 1,
  backgroundColor: 'var(--ui-border)',
  margin: '4px 0',
};

const createLabelStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--ui-text-muted)',
  fontFamily: 'var(--ui-font-mono)',
  letterSpacing: '0.04em',
};

const createRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 6,
};

const createInputStyle: React.CSSProperties = {
  flex: 1,
  padding: '6px 10px',
  background: 'var(--ui-panel-bg-alt)',
  border: '1px solid var(--ui-border)',
  borderRadius: 'var(--ui-radius)',
  color: 'var(--ui-text-primary)',
  fontFamily: 'var(--ui-font-mono)',
  fontSize: 11,
  outline: 'none',
};

const createButtonStyle: React.CSSProperties = {
  padding: '6px 12px',
  background: 'none',
  border: '1px solid var(--ui-border)',
  borderRadius: 'var(--ui-radius)',
  color: 'var(--ui-text-primary)',
  fontFamily: 'var(--ui-font-mono)',
  fontSize: 11,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  transition: 'opacity 150ms ease',
};

// ─── No results ──────────────────────────────────────────────────────────────

const noResultsStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 8,
  padding: '16px 0',
  color: 'var(--ui-text-muted)',
  fontFamily: 'var(--ui-font-mono)',
  fontSize: 12,
};

const clearSearchStyle: React.CSSProperties = {
  background: 'none',
  border: '1px solid var(--ui-border)',
  borderRadius: 'var(--ui-radius)',
  color: 'var(--ui-text-muted)',
  fontFamily: 'var(--ui-font-mono)',
  fontSize: 11,
  padding: '4px 12px',
  cursor: 'pointer',
};

// ─── Separator ───────────────────────────────────────────────────────────────

const separatorStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
};

const separatorLineStyle: React.CSSProperties = {
  flex: 1,
  height: 1,
  backgroundColor: 'var(--ui-border)',
};

const separatorTextStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--ui-text-muted)',
  fontFamily: 'var(--ui-font-mono)',
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
  whiteSpace: 'nowrap',
};

// ─── Path input ──────────────────────────────────────────────────────────────

const addFolderStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
};

const pathInputStyle: React.CSSProperties = {
  flex: 1,
  padding: '8px 12px',
  background: 'var(--ui-panel-bg-alt)',
  border: '1px solid var(--ui-border)',
  borderRadius: 'var(--ui-radius)',
  color: 'var(--ui-text-primary)',
  fontFamily: 'var(--ui-font-mono)',
  fontSize: 12,
  outline: 'none',
  transition: 'border-color 150ms ease',
};

const openFolderButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  background: 'none',
  border: '1px solid var(--ui-border)',
  borderRadius: 'var(--ui-radius)',
  color: 'var(--ui-text-primary)',
  fontFamily: 'var(--ui-font-mono)',
  fontSize: 12,
  cursor: 'pointer',
  whiteSpace: 'nowrap',
  transition: 'background 150ms ease',
};

const openFolderHoverStyle: React.CSSProperties = {
  background: 'rgba(137, 180, 250, 0.1)',
};

// ─── Suggestions ─────────────────────────────────────────────────────────────

const suggestionsListStyle: React.CSSProperties = {
  position: 'fixed',
  margin: 0,
  listStyle: 'none',
  padding: '4px 0',
  background: 'var(--ui-panel-bg)',
  border: '1px solid var(--ui-border)',
  borderRadius: 'var(--ui-radius)',
  maxHeight: 200,
  overflow: 'auto',
  zIndex: 9999,
  boxShadow: '0 4px 16px rgba(0, 0, 0, 0.3)',
};

const suggestionItemStyle: React.CSSProperties = {
  padding: '6px 12px',
  cursor: 'pointer',
  display: 'flex',
  flexDirection: 'column',
  gap: 1,
  fontFamily: 'var(--ui-font-mono)',
  transition: 'background 100ms ease',
};

const suggestionActiveStyle: React.CSSProperties = {
  background: 'rgba(137, 180, 250, 0.12)',
};

const suggestionNameStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--ui-text-primary)',
};

const suggestionPathStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--ui-text-muted)',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

// ─── Environment toggle ─────────────────────────────────────────────────────

const envToggleContainerStyle: React.CSSProperties = {
  display: 'flex',
  gap: 0,
  border: '1px solid var(--ui-border)',
  borderRadius: 'var(--ui-radius)',
  overflow: 'hidden',
};

const envToggleButtonStyle: React.CSSProperties = {
  flex: 1,
  padding: '6px 12px',
  background: 'none',
  border: 'none',
  color: 'var(--ui-text-muted)',
  fontFamily: 'var(--ui-font-mono)',
  fontSize: 12,
  cursor: 'pointer',
  letterSpacing: '0.04em',
  transition: 'background 150ms ease, color 150ms ease',
};

const envToggleActiveStyle: React.CSSProperties = {
  background: 'rgba(137, 180, 250, 0.15)',
  color: 'var(--ui-accent)',
  fontWeight: 600,
};

// ─── Error ───────────────────────────────────────────────────────────────────

const errorStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: 'var(--ui-danger)',
  fontFamily: 'var(--ui-font-mono)',
  padding: '4px 0 0 0',
};

// ─── Keyboard hints ──────────────────────────────────────────────────────────

const hintsStyle: React.CSSProperties = {
  display: 'flex',
  justifyContent: 'center',
  gap: 16,
  paddingTop: 4,
};

const hintItemStyle: React.CSSProperties = {
  fontSize: 10,
  color: 'var(--ui-text-muted)',
  fontFamily: 'var(--ui-font-mono)',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  opacity: 0.7,
};

const kbdStyle: React.CSSProperties = {
  padding: '1px 5px',
  border: '1px solid var(--ui-border)',
  borderRadius: 3,
  fontSize: 10,
  lineHeight: '14px',
  fontFamily: 'var(--ui-font-mono)',
  background: 'var(--ui-panel-bg-alt)',
};
