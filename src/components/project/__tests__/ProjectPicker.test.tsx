import { describe, it, expect, vi, beforeEach } from 'vitest';
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

vi.mock('../../../lib/browser-mock', () => ({
  isTauri: () => false,
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
    await waitFor(() => {
      expect(screen.getByText(/main \(root\)/)).toBeInTheDocument();
      expect(screen.getByText('feat')).toBeInTheDocument();
    });
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

      await waitFor(() => {
        expect(screen.getByText('projects')).toBeInTheDocument();
        expect(screen.getByText('pictures')).toBeInTheDocument();
      });
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

      await waitFor(() => {
        expect(screen.getByText('projects')).toBeInTheDocument();
      });

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

      await waitFor(() => {
        expect(screen.getByText('alpha')).toBeInTheDocument();
      });

      // Arrow down to select first suggestion, then Enter to pick it
      await userEvent.keyboard('{ArrowDown}');
      await userEvent.keyboard('{Enter}');

      expect(input).toHaveValue('/home/user/alpha/');
    });
  });
});
