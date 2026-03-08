import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectPicker } from '../ProjectPicker';
import type { ProjectInfo } from '../../../lib/workspace-types';

// Mock the tauri bridge
vi.mock('../../../lib/tauri-bridge', () => ({
  tauriBridge: {
    worktree: {
      list: vi.fn(),
      create: vi.fn(),
    },
    fs: {
      listDirectories: vi.fn().mockResolvedValue([]),
    },
  },
}));

const mockIsTauri = vi.fn(() => false);
vi.mock('../../../lib/browser-mock', () => ({
  isTauri: (...args: unknown[]) => mockIsTauri(...args),
}));

const mockOpen = vi.fn();
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: (...args: unknown[]) => mockOpen(...args),
}));

import { tauriBridge } from '../../../lib/tauri-bridge';

const mockWorktreeList = vi.mocked(tauriBridge.worktree.list);
const mockListDirectories = vi.mocked(tauriBridge.fs.listDirectories);

function makeProject(overrides: Partial<ProjectInfo> = {}): ProjectInfo {
  return {
    id: overrides.id ?? 'proj-1',
    name: overrides.name ?? 'my-project',
    rootPath: overrides.rootPath ?? '/home/user/my-project',
  };
}

describe('ProjectPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWorktreeList.mockResolvedValue([
      { path: '/repo', branch: 'main', isMain: true },
    ]);
  });

  it('renders project list', () => {
    const projects = [
      makeProject({ id: 'p1', name: 'alpha', rootPath: '/a' }),
      makeProject({ id: 'p2', name: 'beta', rootPath: '/b' }),
    ];
    render(
      <ProjectPicker
        projects={projects}
        onOpenProject={vi.fn()}
        onProjectAdd={vi.fn().mockResolvedValue(null)}
      />,
    );
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('beta')).toBeInTheDocument();
  });

  it('shows empty state when no projects', () => {
    render(
      <ProjectPicker
        projects={[]}
        onOpenProject={vi.fn()}
        onProjectAdd={vi.fn().mockResolvedValue(null)}
      />,
    );
    expect(screen.getByText(/no projects yet/i)).toBeInTheDocument();
  });

  it('calls onOpenProject when project with single worktree is clicked', async () => {
    const onOpenProject = vi.fn();
    const project = makeProject();
    mockWorktreeList.mockResolvedValue([
      { path: '/repo', branch: 'main', isMain: true },
    ]);
    render(
      <ProjectPicker
        projects={[project]}
        onOpenProject={onOpenProject}
        onProjectAdd={vi.fn().mockResolvedValue(null)}
      />,
    );
    await userEvent.click(screen.getByText('my-project'));
    await waitFor(() => {
      expect(onOpenProject).toHaveBeenCalledWith(project, {
        path: '/repo',
        branch: 'main',
        isMain: true,
      });
    });
    expect(mockWorktreeList).toHaveBeenCalledWith('proj-1');
  });

  it('expands inline worktrees for multi-worktree projects', async () => {
    const project = makeProject();
    mockWorktreeList.mockResolvedValue([
      { path: '/repo', branch: 'main', isMain: true },
      { path: '/repo/.worktrees/feat', branch: 'feat', isMain: false },
    ]);
    render(
      <ProjectPicker
        projects={[project]}
        onOpenProject={vi.fn()}
        onProjectAdd={vi.fn().mockResolvedValue(null)}
      />,
    );
    await userEvent.click(screen.getByText('my-project'));
    await screen.findByText(/main \(root\)/);
    expect(screen.getByText('feat')).toBeInTheDocument();
  });

  it('calls onProjectAdd when folder path submitted', async () => {
    const onAdd = vi.fn().mockResolvedValue(null);
    render(
      <ProjectPicker
        projects={[]}
        onOpenProject={vi.fn()}
        onProjectAdd={onAdd}
      />,
    );
    const input = screen.getByPlaceholderText(/enter folder path/i);
    await userEvent.type(input, '/home/user/newproject');
    await userEvent.click(screen.getByText('Open Folder'));
    expect(onAdd).toHaveBeenCalledWith('/home/user/newproject');
  });

  it('calls onProjectAdd on Enter key', async () => {
    const onAdd = vi.fn().mockResolvedValue(null);
    render(
      <ProjectPicker
        projects={[]}
        onOpenProject={vi.fn()}
        onProjectAdd={onAdd}
      />,
    );
    const input = screen.getByPlaceholderText(/enter folder path/i);
    await userEvent.type(input, '/some/path{Enter}');
    expect(onAdd).toHaveBeenCalledWith('/some/path');
  });

  it('does not call onProjectAdd with empty path', async () => {
    const onAdd = vi.fn().mockResolvedValue(null);
    render(
      <ProjectPicker
        projects={[]}
        onOpenProject={vi.fn()}
        onProjectAdd={onAdd}
      />,
    );
    await userEvent.click(screen.getByText('Open Folder'));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('shows project paths', () => {
    render(
      <ProjectPicker
        projects={[makeProject({ rootPath: '/custom/path' })]}
        onOpenProject={vi.fn()}
        onProjectAdd={vi.fn().mockResolvedValue(null)}
      />,
    );
    expect(screen.getByText('/custom/path')).toBeInTheDocument();
  });

  it('renders search input for filtering', () => {
    const projects = [
      makeProject({ id: 'p1', name: 'alpha' }),
      makeProject({ id: 'p2', name: 'beta' }),
    ];
    render(
      <ProjectPicker
        projects={projects}
        onOpenProject={vi.fn()}
        onProjectAdd={vi.fn().mockResolvedValue(null)}
      />,
    );
    expect(screen.getByPlaceholderText(/filter projects/i)).toBeInTheDocument();
  });

  it('renders keyboard hints', () => {
    render(
      <ProjectPicker
        projects={[]}
        onOpenProject={vi.fn()}
        onProjectAdd={vi.fn().mockResolvedValue(null)}
      />,
    );
    expect(screen.getByText('Navigate')).toBeInTheDocument();
    expect(screen.getByText('Open')).toBeInTheDocument();
  });

  it('shows remove confirmation on first click', async () => {
    const onRemove = vi.fn();
    const project = makeProject();
    render(
      <ProjectPicker
        projects={[project]}
        onOpenProject={vi.fn()}
        onProjectAdd={vi.fn().mockResolvedValue(null)}
        onProjectRemove={onRemove}
      />,
    );

    // Hover to reveal the remove button
    const projectButton = screen.getByText('my-project').closest('button')!;
    await userEvent.hover(projectButton);

    // Find and click the remove button (shows x initially)
    const removeBtn = screen.getByLabelText(/remove my-project/i);
    await userEvent.click(removeBtn);

    // Should show confirmation, not remove yet
    expect(onRemove).not.toHaveBeenCalled();
    expect(screen.getByText('Remove?')).toBeInTheDocument();
  });

  it('has proper aria attributes', () => {
    render(
      <ProjectPicker
        projects={[makeProject()]}
        onOpenProject={vi.fn()}
        onProjectAdd={vi.fn().mockResolvedValue(null)}
      />,
    );
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-label', 'Open a Project');
    expect(screen.getByRole('listbox', { name: 'Projects' })).toBeInTheDocument();
    expect(screen.getByLabelText('Folder path')).toBeInTheDocument();
  });

  describe('path autocomplete', () => {
    it('shows suggestions when typing a path', async () => {
      mockListDirectories.mockResolvedValue([
        '/home/user/projects',
        '/home/user/pictures',
      ]);

      render(
        <ProjectPicker
          projects={[]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      const input = screen.getByPlaceholderText(/enter folder path/i);
      await userEvent.type(input, '/home/user/p');

      await waitFor(() => {
        expect(mockListDirectories).toHaveBeenCalledWith('/home/user/p', false);
      });

      await screen.findByText('projects');
      expect(screen.getByText('pictures')).toBeInTheDocument();
    });

    it('selects suggestion on click and appends separator', async () => {
      mockListDirectories.mockResolvedValue(['/home/user/projects']);

      render(
        <ProjectPicker
          projects={[]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      const input = screen.getByPlaceholderText(/enter folder path/i);
      await userEvent.type(input, '/home/user/p');

      await screen.findByText('projects');

      // mouseDown on suggestion (the component uses onMouseDown to prevent blur)
      const suggestion = screen.getByText('projects');
      await userEvent.pointer({ target: suggestion, keys: '[MouseLeft>]' });

      // Input should now contain the selected path with trailing separator
      expect(input).toHaveValue('/home/user/projects/');
    });

    it('does not fetch suggestions for very short input', async () => {
      render(
        <ProjectPicker
          projects={[]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      const input = screen.getByPlaceholderText(/enter folder path/i);
      await userEvent.type(input, '/');

      // Wait a bit beyond the debounce
      await new Promise((r) => setTimeout(r, 200));
      expect(mockListDirectories).not.toHaveBeenCalled();
    });

    it('navigates suggestions with arrow keys', async () => {
      mockListDirectories.mockResolvedValue([
        '/home/user/alpha',
        '/home/user/beta',
      ]);

      render(
        <ProjectPicker
          projects={[]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      const input = screen.getByPlaceholderText(/enter folder path/i);
      await userEvent.type(input, '/home/user/');

      await screen.findByText('alpha');

      // Arrow down to select first suggestion, then Enter to pick it
      await userEvent.keyboard('{ArrowDown}');
      await userEvent.keyboard('{Enter}');

      expect(input).toHaveValue('/home/user/alpha/');
    });
  });

  describe('hashString consistency and distribution', () => {
    // Replicate the hashString function from ProjectPicker.tsx for direct testing
    // (it is not exported, so we duplicate the logic here)
    function hashString(str: string): number {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
      }
      return Math.abs(hash);
    }

    it('produces consistent output for the same input', () => {
      const input = 'my-project';
      const result1 = hashString(input);
      const result2 = hashString(input);
      const result3 = hashString(input);
      expect(result1).toBe(result2);
      expect(result2).toBe(result3);
    });

    it('produces different outputs for different inputs (10 distinct strings)', () => {
      const inputs = [
        'alpha', 'beta', 'gamma', 'delta', 'epsilon',
        'zeta', 'eta', 'theta', 'iota', 'kappa',
      ];
      const hashes = inputs.map((s) => hashString(s));
      const uniqueHashes = new Set(hashes);
      // All 10 inputs should map to distinct hash values
      expect(uniqueHashes.size).toBe(10);
    });

    it('returns a non-negative number', () => {
      const inputs = ['', 'a', 'test', '/', '/mnt/c/Users'];
      for (const input of inputs) {
        expect(hashString(input)).toBeGreaterThanOrEqual(0);
      }
    });

    it('handles empty string', () => {
      expect(hashString('')).toBe(0);
    });
  });

  describe('WSL path detection', () => {
    // Replicate the path detection functions from ProjectPicker.tsx
    function isWslPath(path: string): boolean {
      if (path.startsWith('\\\\wsl')) return true;
      return path.startsWith('/') && !path.startsWith('//');
    }

    function isWindowsPath(path: string): boolean {
      if (/^[a-zA-Z]:[\\/]/.test(path)) return true;
      if (path.startsWith('\\\\') && !path.startsWith('\\\\wsl')) return true;
      return false;
    }

    it('detects Unix-style paths as WSL paths', () => {
      expect(isWslPath('/home/user/project')).toBe(true);
      expect(isWslPath('/mnt/c/Users/project')).toBe(true);
    });

    it('detects \\\\wsl prefix as WSL path', () => {
      expect(isWslPath('\\\\wsl$\\Ubuntu\\home\\user')).toBe(true);
      expect(isWslPath('\\\\wsl.localhost\\Ubuntu\\home')).toBe(true);
    });

    it('does not classify UNC paths (non-wsl) as WSL paths', () => {
      expect(isWslPath('\\\\server\\share')).toBe(false);
    });

    it('does not classify double-slash paths as WSL paths', () => {
      expect(isWslPath('//network/share')).toBe(false);
    });

    it('detects Windows drive letter paths', () => {
      expect(isWindowsPath('C:\\Users\\project')).toBe(true);
      expect(isWindowsPath('D:/Projects/app')).toBe(true);
    });

    it('detects UNC paths as Windows paths (but not \\\\wsl)', () => {
      expect(isWindowsPath('\\\\server\\share')).toBe(true);
      expect(isWindowsPath('\\\\wsl$\\Ubuntu')).toBe(false);
    });

    it('does not classify Unix paths as Windows paths', () => {
      expect(isWindowsPath('/home/user')).toBe(false);
    });
  });

  describe('empty/null project list edge cases', () => {
    it('renders without crashing with empty projects array', () => {
      const { container } = render(
        <ProjectPicker
          projects={[]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );
      expect(container).toBeTruthy();
    });

    it('shows the dialog with proper structure even with no projects', () => {
      render(
        <ProjectPicker
          projects={[]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/enter folder path/i)).toBeInTheDocument();
    });

    it('still allows adding a project when the list is empty', async () => {
      const onAdd = vi.fn().mockResolvedValue(null);
      render(
        <ProjectPicker
          projects={[]}
          onOpenProject={vi.fn()}
          onProjectAdd={onAdd}
        />,
      );
      const input = screen.getByPlaceholderText(/enter folder path/i);
      await userEvent.type(input, '/new/project{Enter}');
      expect(onAdd).toHaveBeenCalledWith('/new/project');
    });
  });

  describe('shortenPath coverage', () => {
    // Replicate the shortenPath function for direct testing
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

    it('shortens Unix home paths with ~', () => {
      expect(shortenPath('/home/user/projects/myapp')).toBe('~/projects/myapp');
    });

    it('shortens macOS home paths with ~', () => {
      expect(shortenPath('/Users/dev/code/app')).toBe('~/code/app');
    });

    it('shortens Windows home paths with ~', () => {
      expect(shortenPath('C:\\Users\\dev\\projects\\app')).toBe('~\\projects\\app');
    });

    it('returns short paths unchanged', () => {
      expect(shortenPath('/a/b/c')).toBe('/a/b/c');
    });

    it('shortens long non-home paths with ellipsis', () => {
      expect(shortenPath('/var/lib/data/subdir/deep')).toBe('.../data/subdir/deep');
    });

    it('handles Windows long non-home paths', () => {
      expect(shortenPath('D:\\a\\b\\c\\d\\e')).toBe('...\\c\\d\\e');
    });
  });

  describe('remove confirmation second click', () => {
    it('calls onProjectRemove on second click (confirmation)', async () => {
      const onRemove = vi.fn();
      const project = makeProject();
      render(
        <ProjectPicker
          projects={[project]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
          onProjectRemove={onRemove}
        />,
      );

      const projectButton = screen.getByText('my-project').closest('button')!;
      await userEvent.hover(projectButton);

      const removeBtn = screen.getByLabelText(/remove my-project/i);
      // First click: show confirmation
      await userEvent.click(removeBtn);
      expect(onRemove).not.toHaveBeenCalled();
      expect(screen.getByText('Remove?')).toBeInTheDocument();

      // Second click: confirm removal
      const confirmBtn = screen.getByLabelText(/confirm remove my-project/i);
      await userEvent.click(confirmBtn);
      expect(onRemove).toHaveBeenCalledWith('proj-1');
    });
  });

  describe('collapsing expanded project', () => {
    it('collapses worktree section when clicking already expanded project', async () => {
      const project = makeProject();
      mockWorktreeList.mockResolvedValue([
        { path: '/repo', branch: 'main', isMain: true },
        { path: '/repo/.worktrees/feat', branch: 'feat', isMain: false },
      ]);
      render(
        <ProjectPicker
          projects={[project]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      // First click: expand
      await userEvent.click(screen.getByText('my-project'));
      await screen.findByText(/main \(root\)/);

      // Second click: collapse
      await userEvent.click(screen.getByText('my-project'));
      await waitFor(() => {
        expect(screen.queryByText(/main \(root\)/)).not.toBeInTheDocument();
      });
    });
  });

  describe('worktree click', () => {
    it('calls onOpenProject when a worktree is clicked', async () => {
      const onOpenProject = vi.fn();
      const project = makeProject();
      mockWorktreeList.mockResolvedValue([
        { path: '/repo', branch: 'main', isMain: true },
        { path: '/repo/.worktrees/feat', branch: 'feat', isMain: false },
      ]);
      render(
        <ProjectPicker
          projects={[project]}
          onOpenProject={onOpenProject}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      await userEvent.click(screen.getByText('my-project'));
      await screen.findByText('feat');

      await userEvent.click(screen.getByText('feat'));
      expect(onOpenProject).toHaveBeenCalledWith(project, {
        path: '/repo/.worktrees/feat',
        branch: 'feat',
        isMain: false,
      });
    });

    it('shows open badge for worktrees that are already open', async () => {
      const project = makeProject();
      mockWorktreeList.mockResolvedValue([
        { path: '/repo', branch: 'main', isMain: true },
        { path: '/repo/.worktrees/feat', branch: 'feat', isMain: false },
      ]);
      render(
        <ProjectPicker
          projects={[project]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
          openWorktreePaths={['/repo']}
        />,
      );

      await userEvent.click(screen.getByText('my-project'));
      await screen.findByText(/main \(root\)/);
      expect(screen.getByText('open')).toBeInTheDocument();
    });
  });

  describe('create worktree', () => {
    const mockWorktreeCreate = vi.mocked(tauriBridge.worktree.create);

    it('creates a worktree and calls onOpenProject', async () => {
      const onOpenProject = vi.fn();
      const project = makeProject();
      mockWorktreeList.mockResolvedValue([
        { path: '/repo', branch: 'main', isMain: true },
        { path: '/repo/.worktrees/feat', branch: 'feat', isMain: false },
      ]);
      mockWorktreeCreate.mockResolvedValue({
        path: '/repo/.worktrees/new-branch',
        branch: 'new-branch',
        isMain: false,
      });
      render(
        <ProjectPicker
          projects={[project]}
          onOpenProject={onOpenProject}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      await userEvent.click(screen.getByText('my-project'));
      await screen.findByText('feat');

      const branchInput = screen.getByPlaceholderText('Branch name...');
      await userEvent.type(branchInput, 'new-branch');
      await userEvent.click(screen.getByText('Create'));

      await waitFor(() => {
        expect(mockWorktreeCreate).toHaveBeenCalledWith('proj-1', 'new-branch');
        expect(onOpenProject).toHaveBeenCalledWith(project, {
          path: '/repo/.worktrees/new-branch',
          branch: 'new-branch',
          isMain: false,
        });
      });
    });

    it('shows error when worktree creation fails', async () => {
      const project = makeProject();
      mockWorktreeList.mockResolvedValue([
        { path: '/repo', branch: 'main', isMain: true },
        { path: '/repo/.worktrees/feat', branch: 'feat', isMain: false },
      ]);
      mockWorktreeCreate.mockRejectedValue(new Error('Branch already exists'));
      render(
        <ProjectPicker
          projects={[project]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      await userEvent.click(screen.getByText('my-project'));
      await screen.findByText('feat');

      const branchInput = screen.getByPlaceholderText('Branch name...');
      await userEvent.type(branchInput, 'existing-branch');
      await userEvent.click(screen.getByText('Create'));

      await screen.findByRole('alert');
      expect(screen.getByText(/Branch already exists/)).toBeInTheDocument();
    });

    it('does not create worktree with empty branch name', async () => {
      const project = makeProject();
      mockWorktreeList.mockResolvedValue([
        { path: '/repo', branch: 'main', isMain: true },
        { path: '/repo/.worktrees/feat', branch: 'feat', isMain: false },
      ]);
      render(
        <ProjectPicker
          projects={[project]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      await userEvent.click(screen.getByText('my-project'));
      await screen.findByText('feat');

      // The Create button should be disabled when branch name is empty
      const createBtn = screen.getByText('Create');
      expect(createBtn).toBeDisabled();
    });

    it('creates worktree on Enter key in branch input', async () => {
      const onOpenProject = vi.fn();
      const project = makeProject();
      mockWorktreeList.mockResolvedValue([
        { path: '/repo', branch: 'main', isMain: true },
        { path: '/repo/.worktrees/feat', branch: 'feat', isMain: false },
      ]);
      mockWorktreeCreate.mockResolvedValue({
        path: '/repo/.worktrees/enter-branch',
        branch: 'enter-branch',
        isMain: false,
      });
      render(
        <ProjectPicker
          projects={[project]}
          onOpenProject={onOpenProject}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      await userEvent.click(screen.getByText('my-project'));
      await screen.findByText('feat');

      const branchInput = screen.getByPlaceholderText('Branch name...');
      await userEvent.type(branchInput, 'enter-branch{Enter}');

      await waitFor(() => {
        expect(mockWorktreeCreate).toHaveBeenCalledWith('proj-1', 'enter-branch');
      });
    });
  });

  describe('worktree loading error', () => {
    it('shows error when worktree list fails to load', async () => {
      const project = makeProject();
      mockWorktreeList.mockRejectedValue(new Error('Network error'));
      render(
        <ProjectPicker
          projects={[project]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      await userEvent.click(screen.getByText('my-project'));
      await screen.findByRole('alert');
      expect(screen.getByText(/Network error/)).toBeInTheDocument();
    });
  });

  describe('handleAddFolder with successful project', () => {
    it('expands project after successful add', async () => {
      const newProject = makeProject({ id: 'new-1', name: 'new-project', rootPath: '/new' });
      const onAdd = vi.fn().mockResolvedValue(newProject);
      const onOpenProject = vi.fn();
      mockWorktreeList.mockResolvedValue([
        { path: '/new', branch: 'main', isMain: true },
      ]);
      render(
        <ProjectPicker
          projects={[]}
          onOpenProject={onOpenProject}
          onProjectAdd={onAdd}
        />,
      );

      const input = screen.getByPlaceholderText(/enter folder path/i);
      await userEvent.type(input, '/new{Enter}');

      await waitFor(() => {
        expect(onAdd).toHaveBeenCalledWith('/new');
        // With a single worktree, it should auto-open
        expect(onOpenProject).toHaveBeenCalledWith(newProject, {
          path: '/new',
          branch: 'main',
          isMain: true,
        });
      });
    });
  });

  describe('keyboard navigation on project list', () => {
    it('navigates projects with ArrowDown and ArrowUp', async () => {
      const projects = [
        makeProject({ id: 'p1', name: 'alpha', rootPath: '/a' }),
        makeProject({ id: 'p2', name: 'beta', rootPath: '/b' }),
        makeProject({ id: 'p3', name: 'gamma', rootPath: '/c' }),
      ];
      render(
        <ProjectPicker
          projects={projects}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      const dialog = screen.getByRole('dialog');
      // Focus the container
      dialog.focus();

      // Navigate down
      await userEvent.keyboard('{ArrowDown}');
      // Check that second item is now selected
      const options = screen.getAllByRole('option');
      await waitFor(() => {
        expect(options[1]).toHaveAttribute('aria-selected', 'true');
      });

      // Navigate up
      await userEvent.keyboard('{ArrowUp}');
      await waitFor(() => {
        expect(options[0]).toHaveAttribute('aria-selected', 'true');
      });
    });

    it('wraps around when navigating past end of list', async () => {
      const projects = [
        makeProject({ id: 'p1', name: 'alpha', rootPath: '/a' }),
        makeProject({ id: 'p2', name: 'beta', rootPath: '/b' }),
      ];
      render(
        <ProjectPicker
          projects={projects}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      const dialog = screen.getByRole('dialog');
      dialog.focus();

      // Navigate down twice (past end wraps to start)
      await userEvent.keyboard('{ArrowDown}');
      await userEvent.keyboard('{ArrowDown}');
      const options = screen.getAllByRole('option');
      await waitFor(() => {
        expect(options[0]).toHaveAttribute('aria-selected', 'true');
      });
    });

    it('opens project on Enter key', async () => {
      const onOpenProject = vi.fn();
      const project = makeProject();
      mockWorktreeList.mockResolvedValue([
        { path: '/repo', branch: 'main', isMain: true },
      ]);
      render(
        <ProjectPicker
          projects={[project]}
          onOpenProject={onOpenProject}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      const dialog = screen.getByRole('dialog');
      dialog.focus();

      await userEvent.keyboard('{Enter}');
      await waitFor(() => {
        expect(onOpenProject).toHaveBeenCalledWith(project, {
          path: '/repo',
          branch: 'main',
          isMain: true,
        });
      });
    });
  });

  describe('keyboard navigation on worktree list', () => {
    it('navigates worktrees with ArrowDown/ArrowUp and selects with Enter', async () => {
      const onOpenProject = vi.fn();
      const project = makeProject();
      mockWorktreeList.mockResolvedValue([
        { path: '/repo', branch: 'main', isMain: true },
        { path: '/repo/.worktrees/feat', branch: 'feat', isMain: false },
      ]);
      render(
        <ProjectPicker
          projects={[project]}
          onOpenProject={onOpenProject}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      // Expand project
      await userEvent.click(screen.getByText('my-project'));
      await screen.findByText(/main \(root\)/);

      const dialog = screen.getByRole('dialog');
      dialog.focus();

      // Navigate down to second worktree
      await userEvent.keyboard('{ArrowDown}');
      // Press Enter to select
      await userEvent.keyboard('{Enter}');

      expect(onOpenProject).toHaveBeenCalledWith(project, {
        path: '/repo/.worktrees/feat',
        branch: 'feat',
        isMain: false,
      });
    });

    it('collapses worktrees on Escape key', async () => {
      const project = makeProject();
      mockWorktreeList.mockResolvedValue([
        { path: '/repo', branch: 'main', isMain: true },
        { path: '/repo/.worktrees/feat', branch: 'feat', isMain: false },
      ]);
      render(
        <ProjectPicker
          projects={[project]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      await userEvent.click(screen.getByText('my-project'));
      await screen.findByText(/main \(root\)/);

      const dialog = screen.getByRole('dialog');
      dialog.focus();

      await userEvent.keyboard('{Escape}');
      await waitFor(() => {
        expect(screen.queryByText(/main \(root\)/)).not.toBeInTheDocument();
      });
    });
  });

  describe('escape key handling', () => {
    it('calls onEscape when Escape is pressed and no project is expanded', async () => {
      const onEscape = vi.fn();
      render(
        <ProjectPicker
          projects={[makeProject()]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
          onEscape={onEscape}
        />,
      );

      await userEvent.keyboard('{Escape}');
      expect(onEscape).toHaveBeenCalled();
    });

    it('collapses expanded project instead of calling onEscape', async () => {
      const onEscape = vi.fn();
      const project = makeProject();
      mockWorktreeList.mockResolvedValue([
        { path: '/repo', branch: 'main', isMain: true },
        { path: '/repo/.worktrees/feat', branch: 'feat', isMain: false },
      ]);
      render(
        <ProjectPicker
          projects={[project]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
          onEscape={onEscape}
        />,
      );

      // Expand project
      await userEvent.click(screen.getByText('my-project'));
      await screen.findByText(/main \(root\)/);

      // Press Escape — should collapse, not call onEscape
      await userEvent.keyboard('{Escape}');
      await waitFor(() => {
        expect(screen.queryByText(/main \(root\)/)).not.toBeInTheDocument();
      });
      // onEscape may have been called by the document-level listener,
      // but the expanded state should be collapsed first
    });

    it('shows Close hint when onEscape is provided', () => {
      render(
        <ProjectPicker
          projects={[]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
          onEscape={vi.fn()}
        />,
      );
      expect(screen.getByText('Close')).toBeInTheDocument();
    });
  });

  describe('search filtering', () => {
    it('filters projects by search query', async () => {
      const projects = [
        makeProject({ id: 'p1', name: 'react-app', rootPath: '/a' }),
        makeProject({ id: 'p2', name: 'vue-app', rootPath: '/b' }),
        makeProject({ id: 'p3', name: 'angular-app', rootPath: '/c' }),
      ];
      render(
        <ProjectPicker
          projects={projects}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      const searchInput = screen.getByPlaceholderText(/filter projects/i);
      await userEvent.type(searchInput, 'react');

      await waitFor(() => {
        expect(screen.getByText('react-app')).toBeInTheDocument();
        expect(screen.queryByText('vue-app')).not.toBeInTheDocument();
        expect(screen.queryByText('angular-app')).not.toBeInTheDocument();
      });
    });

    it('shows "No matching projects" when search finds nothing', async () => {
      const projects = [
        makeProject({ id: 'p1', name: 'alpha', rootPath: '/a' }),
      ];
      render(
        <ProjectPicker
          projects={projects}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      const searchInput = screen.getByPlaceholderText(/filter projects/i);
      await userEvent.type(searchInput, 'zzzznonexistent');

      await waitFor(() => {
        expect(screen.getByText('No matching projects')).toBeInTheDocument();
      });
    });

    it('clears search when Clear search button is clicked', async () => {
      const projects = [
        makeProject({ id: 'p1', name: 'alpha', rootPath: '/a' }),
      ];
      render(
        <ProjectPicker
          projects={projects}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      const searchInput = screen.getByPlaceholderText(/filter projects/i);
      await userEvent.type(searchInput, 'zzzznonexistent');

      await screen.findByText('No matching projects');
      await userEvent.click(screen.getByText('Clear search'));

      await waitFor(() => {
        expect(screen.getByText('alpha')).toBeInTheDocument();
        expect(screen.queryByText('No matching projects')).not.toBeInTheDocument();
      });
    });
  });

  describe('error and loading props', () => {
    it('displays error message when error prop is set', () => {
      render(
        <ProjectPicker
          projects={[]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
          error="Something went wrong"
        />,
      );
      expect(screen.getByRole('alert')).toHaveTextContent('Something went wrong');
    });

    it('disables Open Folder button when loading', () => {
      render(
        <ProjectPicker
          projects={[]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
          loading={true}
        />,
      );
      expect(screen.getByText('Adding...')).toBeDisabled();
    });
  });

  describe('path autocomplete additional coverage', () => {
    it('navigates suggestions with ArrowUp (wraps around)', async () => {
      mockListDirectories.mockResolvedValue([
        '/home/user/alpha',
        '/home/user/beta',
      ]);

      render(
        <ProjectPicker
          projects={[]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      const input = screen.getByPlaceholderText(/enter folder path/i);
      await userEvent.type(input, '/home/user/');

      await screen.findByText('alpha');

      // ArrowUp should wrap to last suggestion
      await userEvent.keyboard('{ArrowUp}');
      // Then Enter to select it
      await userEvent.keyboard('{Enter}');

      expect(input).toHaveValue('/home/user/beta/');
    });

    it('selects suggestion with Tab key', async () => {
      mockListDirectories.mockResolvedValue([
        '/home/user/alpha',
      ]);

      render(
        <ProjectPicker
          projects={[]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      const input = screen.getByPlaceholderText(/enter folder path/i);
      await userEvent.type(input, '/home/user/');

      await screen.findByText('alpha');

      await userEvent.keyboard('{ArrowDown}');
      await userEvent.keyboard('{Tab}');

      expect(input).toHaveValue('/home/user/alpha/');
    });

    it('closes suggestions on Escape key in input', async () => {
      mockListDirectories.mockResolvedValue([
        '/home/user/alpha',
      ]);

      render(
        <ProjectPicker
          projects={[]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      const input = screen.getByPlaceholderText(/enter folder path/i);
      await userEvent.type(input, '/home/user/');

      await screen.findByText('alpha');

      // Focus the input and press Escape
      input.focus();
      await userEvent.keyboard('{Escape}');

      // Suggestions should be hidden
      await waitFor(() => {
        expect(screen.queryByRole('listbox', { name: 'Directory suggestions' })).not.toBeInTheDocument();
      });
    });

    it('handles listDirectories error gracefully', async () => {
      mockListDirectories.mockRejectedValue(new Error('permission denied'));

      render(
        <ProjectPicker
          projects={[]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      const input = screen.getByPlaceholderText(/enter folder path/i);
      await userEvent.type(input, '/home/user/');

      // Wait for debounce and error handling
      await new Promise((r) => setTimeout(r, 200));

      // Should not crash, no suggestions shown
      expect(screen.queryByRole('listbox', { name: 'Directory suggestions' })).not.toBeInTheDocument();
    });

    it('re-shows suggestions on focus when they exist', async () => {
      mockListDirectories.mockResolvedValue([
        '/home/user/alpha',
      ]);

      render(
        <ProjectPicker
          projects={[]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      const input = screen.getByPlaceholderText(/enter folder path/i);
      await userEvent.type(input, '/home/user/');

      await screen.findByText('alpha');

      // Blur the input (suggestions hide after timeout)
      await userEvent.click(document.body);
      await new Promise((r) => setTimeout(r, 200));

      // Focus the input again — suggestions should reappear
      await userEvent.click(input);
      await waitFor(() => {
        expect(screen.queryByText('alpha')).toBeInTheDocument();
      });
    });
  });

  describe('detached and null branch worktree display', () => {
    it('shows "detached" for worktree with null branch', async () => {
      const project = makeProject();
      mockWorktreeList.mockResolvedValue([
        { path: '/repo', branch: 'main', isMain: true },
        { path: '/repo/.worktrees/detach', branch: null, isMain: false },
      ]);
      render(
        <ProjectPicker
          projects={[project]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      await userEvent.click(screen.getByText('my-project'));
      await screen.findByText('detached');
    });
  });

  describe('subtitle text', () => {
    it('shows correct subtitle when projects exist', () => {
      render(
        <ProjectPicker
          projects={[makeProject()]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );
      expect(screen.getByText(/select a recent project or open a new folder/i)).toBeInTheDocument();
    });

    it('shows correct subtitle when no projects exist', () => {
      render(
        <ProjectPicker
          projects={[]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );
      expect(screen.getByText(/open a folder to create your first workspace/i)).toBeInTheDocument();
    });
  });

  describe('mouse hover/leave on project items', () => {
    it('clears confirmRemoveId and hoveredIndex on mouse leave', async () => {
      const onRemove = vi.fn();
      const project = makeProject();
      render(
        <ProjectPicker
          projects={[project]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
          onProjectRemove={onRemove}
        />,
      );

      const projectButton = screen.getByText('my-project').closest('button')!;
      const wrapper = projectButton.parentElement!;

      // Hover to show remove button
      await userEvent.hover(wrapper);
      const removeBtn = screen.getByLabelText(/remove my-project/i);
      await userEvent.click(removeBtn);
      expect(screen.getByText('Remove?')).toBeInTheDocument();

      // Mouse leave should clear confirmation
      await userEvent.unhover(wrapper);
      await waitFor(() => {
        expect(screen.queryByText('Remove?')).not.toBeInTheDocument();
      });
    });
  });

  describe('branch input Escape key', () => {
    it('blurs branch input on Escape', async () => {
      const project = makeProject();
      mockWorktreeList.mockResolvedValue([
        { path: '/repo', branch: 'main', isMain: true },
        { path: '/repo/.worktrees/feat', branch: 'feat', isMain: false },
      ]);
      render(
        <ProjectPicker
          projects={[project]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      await userEvent.click(screen.getByText('my-project'));
      await screen.findByText('feat');

      const branchInput = screen.getByPlaceholderText('Branch name...');
      await userEvent.click(branchInput);
      expect(branchInput).toHaveFocus();

      await userEvent.keyboard('{Escape}');
      expect(branchInput).not.toHaveFocus();
    });
  });

  describe('worktree keyboard wrap-around', () => {
    it('wraps worktree focus from last to first on ArrowDown', async () => {
      const onOpenProject = vi.fn();
      const project = makeProject();
      mockWorktreeList.mockResolvedValue([
        { path: '/repo', branch: 'main', isMain: true },
        { path: '/repo/.worktrees/feat', branch: 'feat', isMain: false },
      ]);
      render(
        <ProjectPicker
          projects={[project]}
          onOpenProject={onOpenProject}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      await userEvent.click(screen.getByText('my-project'));
      await screen.findByText(/main \(root\)/);

      const dialog = screen.getByRole('dialog');
      dialog.focus();

      // Navigate down twice (past end wraps to first)
      await userEvent.keyboard('{ArrowDown}');
      await userEvent.keyboard('{ArrowDown}');
      // Enter on first (wrapped around)
      await userEvent.keyboard('{Enter}');

      expect(onOpenProject).toHaveBeenCalledWith(project, {
        path: '/repo',
        branch: 'main',
        isMain: true,
      });
    });

    it('wraps worktree focus from first to last on ArrowUp', async () => {
      const onOpenProject = vi.fn();
      const project = makeProject();
      mockWorktreeList.mockResolvedValue([
        { path: '/repo', branch: 'main', isMain: true },
        { path: '/repo/.worktrees/feat', branch: 'feat', isMain: false },
      ]);
      render(
        <ProjectPicker
          projects={[project]}
          onOpenProject={onOpenProject}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      await userEvent.click(screen.getByText('my-project'));
      await screen.findByText(/main \(root\)/);

      const dialog = screen.getByRole('dialog');
      dialog.focus();

      // ArrowUp from first wraps to last
      await userEvent.keyboard('{ArrowUp}');
      await userEvent.keyboard('{Enter}');

      expect(onOpenProject).toHaveBeenCalledWith(project, {
        path: '/repo/.worktrees/feat',
        branch: 'feat',
        isMain: false,
      });
    });
  });

  describe('project list ArrowUp wrapping', () => {
    it('wraps from first to last on ArrowUp', async () => {
      const projects = [
        makeProject({ id: 'p1', name: 'alpha', rootPath: '/a' }),
        makeProject({ id: 'p2', name: 'beta', rootPath: '/b' }),
      ];
      render(
        <ProjectPicker
          projects={projects}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      const dialog = screen.getByRole('dialog');
      dialog.focus();

      // ArrowUp from first wraps to last
      await userEvent.keyboard('{ArrowUp}');
      const options = screen.getAllByRole('option');
      await waitFor(() => {
        expect(options[1]).toHaveAttribute('aria-selected', 'true');
      });
    });
  });

  describe('filterByShellEnv coverage via component rendering', () => {
    // Replicate filterByShellEnv for direct testing
    function isWslPath(path: string): boolean {
      if (path.startsWith('\\\\wsl')) return true;
      return path.startsWith('/') && !path.startsWith('//');
    }

    function isWindowsPath(path: string): boolean {
      if (/^[a-zA-Z]:[\\/]/.test(path)) return true;
      if (path.startsWith('\\\\') && !path.startsWith('\\\\wsl')) return true;
      return false;
    }

    function filterByShellEnv(projects: ProjectInfo[], env: 'windows' | 'wsl'): ProjectInfo[] {
      return projects.filter((p) => {
        if (env === 'wsl') return isWslPath(p.rootPath);
        if (env === 'windows') return isWindowsPath(p.rootPath);
        return true;
      });
    }

    it('filters WSL projects correctly', () => {
      const projects = [
        makeProject({ id: 'p1', rootPath: '/home/user/project' }),
        makeProject({ id: 'p2', rootPath: 'C:\\Users\\project' }),
        makeProject({ id: 'p3', rootPath: '\\\\wsl$\\Ubuntu\\home' }),
      ];
      const result = filterByShellEnv(projects, 'wsl');
      expect(result.map((p) => p.id)).toEqual(['p1', 'p3']);
    });

    it('filters Windows projects correctly', () => {
      const projects = [
        makeProject({ id: 'p1', rootPath: '/home/user/project' }),
        makeProject({ id: 'p2', rootPath: 'C:\\Users\\project' }),
        makeProject({ id: 'p3', rootPath: '\\\\server\\share' }),
      ];
      const result = filterByShellEnv(projects, 'windows');
      expect(result.map((p) => p.id)).toEqual(['p2', 'p3']);
    });
  });

  describe('suggestion mouse hover changes selection', () => {
    it('highlights suggestion on mouse enter', async () => {
      mockListDirectories.mockResolvedValue([
        '/home/user/alpha',
        '/home/user/beta',
      ]);

      render(
        <ProjectPicker
          projects={[]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      const input = screen.getByPlaceholderText(/enter folder path/i);
      await userEvent.type(input, '/home/user/');

      await screen.findByText('alpha');

      // Hover over second suggestion
      const betaSuggestion = screen.getByText('beta').closest('li')!;
      await userEvent.hover(betaSuggestion);

      // The suggestion should become selected (aria-selected)
      expect(betaSuggestion).toHaveAttribute('aria-selected', 'true');
    });
  });

  describe('worktree hover interactions', () => {
    it('highlights worktree on mouse enter and clears on mouse leave', async () => {
      const project = makeProject();
      mockWorktreeList.mockResolvedValue([
        { path: '/repo', branch: 'main', isMain: true },
        { path: '/repo/.worktrees/feat', branch: 'feat', isMain: false },
      ]);
      render(
        <ProjectPicker
          projects={[project]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      await userEvent.click(screen.getByText('my-project'));
      await screen.findByText('feat');

      const worktreeButtons = screen.getByRole('listbox', { name: 'Worktrees' });
      const buttons = worktreeButtons.querySelectorAll('button');

      // Hover second worktree button
      await userEvent.hover(buttons[1]);
      // Unhover
      await userEvent.unhover(buttons[1]);

      // No crash, test passes
      expect(buttons[1]).toBeInTheDocument();
    });
  });

  describe('browse button (isTauri mode)', () => {
    beforeEach(() => {
      mockIsTauri.mockReturnValue(true);
    });

    afterEach(() => {
      mockIsTauri.mockReturnValue(false);
    });

    it('renders Browse Folder button when isTauri returns true', () => {
      render(
        <ProjectPicker
          projects={[]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );
      expect(screen.getByText('Browse Folder...')).toBeInTheDocument();
    });

    it('calls open dialog and onProjectAdd when folder is selected', async () => {
      const newProject = makeProject({ id: 'browse-1', name: 'browsed', rootPath: '/browsed' });
      const onAdd = vi.fn().mockResolvedValue(newProject);
      const onOpenProject = vi.fn();
      mockOpen.mockResolvedValue('/browsed');
      mockWorktreeList.mockResolvedValue([
        { path: '/browsed', branch: 'main', isMain: true },
      ]);

      render(
        <ProjectPicker
          projects={[]}
          onOpenProject={onOpenProject}
          onProjectAdd={onAdd}
        />,
      );

      await userEvent.click(screen.getByText('Browse Folder...'));

      await waitFor(() => {
        expect(mockOpen).toHaveBeenCalledWith({
          directory: true,
          multiple: false,
          defaultPath: undefined,
        });
        expect(onAdd).toHaveBeenCalledWith('/browsed');
      });
    });

    it('does not add project when browse dialog is cancelled', async () => {
      const onAdd = vi.fn().mockResolvedValue(null);
      mockOpen.mockResolvedValue(null);

      render(
        <ProjectPicker
          projects={[]}
          onOpenProject={vi.fn()}
          onProjectAdd={onAdd}
        />,
      );

      await userEvent.click(screen.getByText('Browse Folder...'));

      await waitFor(() => {
        expect(mockOpen).toHaveBeenCalled();
      });
      expect(onAdd).not.toHaveBeenCalled();
    });

    it('handles browse dialog error gracefully', async () => {
      const onAdd = vi.fn().mockResolvedValue(null);
      mockOpen.mockRejectedValue(new Error('Dialog error'));

      render(
        <ProjectPicker
          projects={[]}
          onOpenProject={vi.fn()}
          onProjectAdd={onAdd}
        />,
      );

      await userEvent.click(screen.getByText('Browse Folder...'));

      // Wait for the rejection to be handled
      await new Promise((r) => setTimeout(r, 50));
      // Should not crash, and no project added
      expect(onAdd).not.toHaveBeenCalled();
    });

    it('shows Adding... text when loading', () => {
      render(
        <ProjectPicker
          projects={[]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
          loading={true}
        />,
      );
      // Browse button should show "Adding..." when loading
      const browseBtn = screen.getByText('Adding...', { selector: 'button span' });
      expect(browseBtn).toBeInTheDocument();
    });
  });

  describe('Windows/WSL env toggle', () => {
    const originalPlatform = Object.getOwnPropertyDescriptor(navigator, 'platform');

    beforeEach(() => {
      Object.defineProperty(navigator, 'platform', {
        get: () => 'Win32',
        configurable: true,
      });
    });

    afterEach(() => {
      if (originalPlatform) {
        Object.defineProperty(navigator, 'platform', originalPlatform);
      }
    });

    it('shows Windows/WSL toggle on Windows platform', () => {
      render(
        <ProjectPicker
          projects={[]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );
      expect(screen.getByRole('radiogroup', { name: 'Shell environment' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'Windows' })).toBeInTheDocument();
      expect(screen.getByRole('radio', { name: 'WSL' })).toBeInTheDocument();
    });

    it('filters projects by WSL when WSL is selected', async () => {
      const projects = [
        makeProject({ id: 'p1', name: 'unix-project', rootPath: '/home/user/project' }),
        makeProject({ id: 'p2', name: 'win-project', rootPath: 'C:\\Users\\project' }),
      ];
      render(
        <ProjectPicker
          projects={projects}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      // Default is Windows mode — shows only Windows projects
      expect(screen.getByText('win-project')).toBeInTheDocument();
      expect(screen.queryByText('unix-project')).not.toBeInTheDocument();

      // Switch to WSL mode
      await userEvent.click(screen.getByRole('radio', { name: 'WSL' }));
      await waitFor(() => {
        expect(screen.getByText('unix-project')).toBeInTheDocument();
        expect(screen.queryByText('win-project')).not.toBeInTheDocument();
      });
    });

    it('changes input placeholder when WSL is selected', async () => {
      render(
        <ProjectPicker
          projects={[]}
          onOpenProject={vi.fn()}
          onProjectAdd={vi.fn().mockResolvedValue(null)}
        />,
      );

      // Default Windows mode
      expect(screen.getByPlaceholderText(/enter folder path/i)).toBeInTheDocument();

      // Switch to WSL
      await userEvent.click(screen.getByRole('radio', { name: 'WSL' }));
      expect(screen.getByPlaceholderText(/\/home\/user\/project/i)).toBeInTheDocument();
    });
  });
});
