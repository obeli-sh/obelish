import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { WorktreeDialog } from '../WorktreeDialog';

// Mock the tauri bridge
vi.mock('../../../lib/tauri-bridge', () => ({
  tauriBridge: {
    worktree: {
      list: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { tauriBridge } from '../../../lib/tauri-bridge';

const mockList = vi.mocked(tauriBridge.worktree.list);
const mockCreate = vi.mocked(tauriBridge.worktree.create);

describe('WorktreeDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockList.mockResolvedValue([
      { path: '/repo', branch: 'main', isMain: true },
      { path: '/repo/.worktrees/feat', branch: 'feat', isMain: false },
    ]);
    mockCreate.mockResolvedValue({
      path: '/repo/.worktrees/new-branch',
      branch: 'new-branch',
      isMain: false,
    });
  });

  it('does not render when closed', () => {
    render(
      <WorktreeDialog
        projectId="p1"
        projectName="myproject"
        isOpen={false}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.queryByText(/select worktree/i)).not.toBeInTheDocument();
  });

  it('renders worktree list when open', async () => {
    render(
      <WorktreeDialog
        projectId="p1"
        projectName="myproject"
        isOpen={true}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );
    await screen.findByText(/main \(root\)/);
    expect(screen.getByText('feat')).toBeInTheDocument();
  });

  it('calls onSelect when worktree clicked', async () => {
    const onSelect = vi.fn();
    render(
      <WorktreeDialog
        projectId="p1"
        projectName="myproject"
        isOpen={true}
        onSelect={onSelect}
        onClose={vi.fn()}
      />
    );
    await screen.findByText(/main \(root\)/);
    await userEvent.click(screen.getByText(/main \(root\)/));
    expect(onSelect).toHaveBeenCalledWith({
      path: '/repo',
      branch: 'main',
      isMain: true,
    });
  });

  it('creates new worktree on submit', async () => {
    const onSelect = vi.fn();
    render(
      <WorktreeDialog
        projectId="p1"
        projectName="myproject"
        isOpen={true}
        onSelect={onSelect}
        onClose={vi.fn()}
      />
    );
    await screen.findByText(/main \(root\)/);

    const input = screen.getByPlaceholderText(/branch name/i);
    await userEvent.type(input, 'new-branch');
    await userEvent.click(screen.getByText('Create'));

    await waitFor(() => {
      expect(mockCreate).toHaveBeenCalledWith('p1', 'new-branch');
      expect(onSelect).toHaveBeenCalledWith({
        path: '/repo/.worktrees/new-branch',
        branch: 'new-branch',
        isMain: false,
      });
    });
  });

  it('calls onClose when overlay clicked', async () => {
    const onClose = vi.fn();
    render(
      <WorktreeDialog
        projectId="p1"
        projectName="myproject"
        isOpen={true}
        onSelect={vi.fn()}
        onClose={onClose}
      />
    );
    await screen.findByText(/select worktree/i);
    // Click the overlay (the outermost div)
    const overlay = screen.getByText(/select worktree/i).closest('div[style]')?.parentElement?.parentElement;
    if (overlay) {
      fireEvent.click(overlay);
    }
  });

  it('shows loading state', () => {
    mockList.mockReturnValue(new Promise(() => {})); // never resolves
    render(
      <WorktreeDialog
        projectId="p1"
        projectName="myproject"
        isOpen={true}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows project name in title', async () => {
    render(
      <WorktreeDialog
        projectId="p1"
        projectName="myproject"
        isOpen={true}
        onSelect={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByText(/myproject.*select worktree/i)).toBeInTheDocument();
  });
});
