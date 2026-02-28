import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { emitMockEvent, clearEventMocks } from '@tauri-apps/api/event';
import { act } from '@testing-library/react';
import { Sidebar } from '../Sidebar';
import type { WorkspaceInfo, GitInfo } from '../../../lib/workspace-types';

function makeWorkspace(id: string, name: string): WorkspaceInfo {
  return {
    id,
    name,
    surfaces: [{ id: 's-1', name: 'Surface 1', layout: { type: 'leaf', paneId: 'p-1', ptyId: 'pty-1' } }],
    activeSurfaceIndex: 0,
    createdAt: Date.now(),
  };
}

describe('Sidebar', () => {
  const defaultProps = {
    workspaces: [makeWorkspace('ws-1', 'Workspace 1'), makeWorkspace('ws-2', 'Workspace 2')],
    activeWorkspaceId: 'ws-1',
    onWorkspaceSelect: vi.fn(),
    onWorkspaceCreate: vi.fn(),
    onWorkspaceClose: vi.fn(),
    onWorkspaceReorder: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    clearEventMocks();
  });

  it('renders workspace list', () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByText('Workspace 1')).toBeInTheDocument();
    expect(screen.getByText('Workspace 2')).toBeInTheDocument();
  });

  it('highlights active workspace', () => {
    render(<Sidebar {...defaultProps} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveAttribute('data-active', 'true');
    expect(items[1]).toHaveAttribute('data-active', 'false');
  });

  it('calls onWorkspaceSelect on workspace click', async () => {
    const user = userEvent.setup();
    render(<Sidebar {...defaultProps} />);

    const items = screen.getAllByRole('listitem');
    const nameButton = within(items[1]).getByRole('button', { name: 'Workspace 2' });
    await user.click(nameButton);

    expect(defaultProps.onWorkspaceSelect).toHaveBeenCalledWith('ws-2');
  });

  it('calls onWorkspaceCreate on new button click', async () => {
    const user = userEvent.setup();
    render(<Sidebar {...defaultProps} />);

    const createButton = screen.getByRole('button', { name: /new workspace/i });
    await user.click(createButton);

    expect(defaultProps.onWorkspaceCreate).toHaveBeenCalled();
  });

  it('calls onWorkspaceClose on close button click', async () => {
    const user = userEvent.setup();
    render(<Sidebar {...defaultProps} />);

    const items = screen.getAllByRole('listitem');
    const closeButton = within(items[0]).getByRole('button', { name: /close/i });
    await user.click(closeButton);

    expect(defaultProps.onWorkspaceClose).toHaveBeenCalledWith('ws-1');
  });

  it('navigates with arrow keys', async () => {
    const user = userEvent.setup();
    render(<Sidebar {...defaultProps} />);

    const items = screen.getAllByRole('listitem');

    // Focus the list
    await user.click(within(items[0]).getByRole('button', { name: 'Workspace 1' }));

    // Press ArrowDown to move to next item
    await user.keyboard('{ArrowDown}');
    expect(items[1]).toHaveAttribute('data-focused', 'true');

    // Press ArrowUp to move back
    await user.keyboard('{ArrowUp}');
    expect(items[0]).toHaveAttribute('data-focused', 'true');
  });

  it('selects with Enter key', async () => {
    const user = userEvent.setup();
    render(<Sidebar {...defaultProps} />);

    const items = screen.getAllByRole('listitem');
    await user.click(within(items[0]).getByRole('button', { name: 'Workspace 1' }));

    // Navigate to second item and press Enter
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');

    expect(defaultProps.onWorkspaceSelect).toHaveBeenCalledWith('ws-2');
  });

  it('uses semantic nav element', () => {
    render(<Sidebar {...defaultProps} />);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });

  it('renders empty state when no workspaces', () => {
    render(<Sidebar {...defaultProps} workspaces={[]} />);
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });

  it('workspace items are draggable', () => {
    render(<Sidebar {...defaultProps} />);
    const items = screen.getAllByRole('listitem');
    // useSortable adds tabindex to make items interactive for DnD
    for (const item of items) {
      expect(item).toHaveAttribute('tabindex');
    }
  });

  describe('workspace rename', () => {
    it('double-click workspace name shows input with current name', async () => {
      const user = userEvent.setup();
      render(<Sidebar {...defaultProps} onWorkspaceRename={vi.fn()} />);

      const nameButton = screen.getByRole('button', { name: 'Workspace 1' });
      await user.dblClick(nameButton);

      const input = screen.getByRole('textbox');
      expect(input).toBeInTheDocument();
      expect(input).toHaveValue('Workspace 1');
    });

    it('pressing Enter in input calls onWorkspaceRename', async () => {
      const onRename = vi.fn();
      const user = userEvent.setup();
      render(<Sidebar {...defaultProps} onWorkspaceRename={onRename} />);

      const nameButton = screen.getByRole('button', { name: 'Workspace 1' });
      await user.dblClick(nameButton);

      const input = screen.getByRole('textbox');
      await user.clear(input);
      await user.type(input, 'New Name{Enter}');

      expect(onRename).toHaveBeenCalledWith('ws-1', 'New Name');
      // Input should be gone, button should be back
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('pressing Escape reverts without calling onWorkspaceRename', async () => {
      const onRename = vi.fn();
      const user = userEvent.setup();
      render(<Sidebar {...defaultProps} onWorkspaceRename={onRename} />);

      const nameButton = screen.getByRole('button', { name: 'Workspace 1' });
      await user.dblClick(nameButton);

      const input = screen.getByRole('textbox');
      await user.clear(input);
      await user.type(input, 'New Name{Escape}');

      expect(onRename).not.toHaveBeenCalled();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      // Original name should be shown
      expect(screen.getByRole('button', { name: 'Workspace 1' })).toBeInTheDocument();
    });

    it('blur on input calls onWorkspaceRename', async () => {
      const onRename = vi.fn();
      const user = userEvent.setup();
      render(<Sidebar {...defaultProps} onWorkspaceRename={onRename} />);

      const nameButton = screen.getByRole('button', { name: 'Workspace 1' });
      await user.dblClick(nameButton);

      const input = screen.getByRole('textbox');
      await user.clear(input);
      await user.type(input, 'Blurred Name');
      // Click elsewhere to blur
      await user.click(screen.getByRole('button', { name: /new workspace/i }));

      expect(onRename).toHaveBeenCalledWith('ws-1', 'Blurred Name');
    });

    it('single click still calls onWorkspaceSelect (not rename)', async () => {
      const onRename = vi.fn();
      const user = userEvent.setup();
      render(<Sidebar {...defaultProps} onWorkspaceRename={onRename} />);

      const nameButton = screen.getByRole('button', { name: 'Workspace 1' });
      await user.click(nameButton);

      expect(defaultProps.onWorkspaceSelect).toHaveBeenCalledWith('ws-1');
      expect(onRename).not.toHaveBeenCalled();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });
  });

  it('renders WorkspaceMetadata for each workspace', async () => {
    render(<Sidebar {...defaultProps} />);

    const gitInfo: GitInfo = {
      branch: 'feature-x',
      isDirty: false,
      ahead: 0,
      behind: 0,
    };

    act(() => {
      emitMockEvent('git-info-p-1', gitInfo);
    });

    expect(await screen.findAllByText('feature-x')).toHaveLength(2);
  });
});
