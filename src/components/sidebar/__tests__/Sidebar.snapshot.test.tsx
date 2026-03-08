import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { clearEventMocks } from '@tauri-apps/api/event';
import { Sidebar } from '../Sidebar';
import type { WorkspaceInfo } from '../../../lib/workspace-types';

function makeWorkspace(id: string, name: string): WorkspaceInfo {
  return {
    id,
    name,
    projectId: '',
    worktreePath: '',
    branchName: null,
    isRootWorktree: false,
    surfaces: [{ id: 's-1', name: 'Surface 1', layout: { type: 'leaf', paneId: 'p-1', ptyId: 'pty-1' } }],
    activeSurfaceIndex: 0,
    createdAt: Date.now(),
  };
}

describe('Sidebar snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearEventMocks();
  });

  it('matches snapshot with workspaces', () => {
    const { container } = render(
      <Sidebar
        workspaces={[makeWorkspace('ws-1', 'Main'), makeWorkspace('ws-2', 'Dev')]}
        activeWorkspaceId="ws-1"
        onWorkspaceSelect={vi.fn()}
        onWorkspaceCreate={vi.fn()}
        onWorkspaceClose={vi.fn()}
        onWorkspaceReorder={vi.fn()}
        onOpenPreferences={vi.fn()}
      />,
    );
    expect(container).toMatchSnapshot();
  });

  it('matches snapshot with no workspaces', () => {
    const { container } = render(
      <Sidebar
        workspaces={[]}
        activeWorkspaceId={null}
        onWorkspaceSelect={vi.fn()}
        onWorkspaceCreate={vi.fn()}
        onWorkspaceClose={vi.fn()}
        onWorkspaceReorder={vi.fn()}
        onOpenPreferences={vi.fn()}
      />,
    );
    expect(container).toMatchSnapshot();
  });
});
