import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { emitMockEvent, clearEventMocks } from '@tauri-apps/api/event';
import { act } from '@testing-library/react';
import type { GitInfo, PortInfo } from '../../../lib/workspace-types';

import { WorkspaceMetadata } from '../WorkspaceMetadata';

describe('WorkspaceMetadata', () => {
  beforeEach(() => {
    clearEventMocks();
  });

  it('shows git branch when available', async () => {
    const { container } = render(<WorkspaceMetadata paneId="pane-1" />);

    const gitInfo: GitInfo = {
      branch: 'main',
      isDirty: false,
      ahead: 0,
      behind: 0,
    };

    act(() => {
      emitMockEvent('git-info-pane-1', gitInfo);
    });

    expect(await screen.findByText('main')).toBeInTheDocument();
  });

  it('shows dirty indicator when dirty', async () => {
    render(<WorkspaceMetadata paneId="pane-1" />);

    const gitInfo: GitInfo = {
      branch: 'main',
      isDirty: true,
      ahead: 0,
      behind: 0,
    };

    act(() => {
      emitMockEvent('git-info-pane-1', gitInfo);
    });

    expect(await screen.findByText('*')).toBeInTheDocument();
  });

  it('hides git section when no git info', () => {
    render(<WorkspaceMetadata paneId="pane-1" />);

    expect(screen.queryByTestId('git-info')).not.toBeInTheDocument();
  });

  it('shows listening ports', async () => {
    render(<WorkspaceMetadata paneId="pane-1" />);

    const ports: PortInfo[] = [
      { port: 3000, protocol: 'tcp', pid: 1234, processName: 'node' },
      { port: 8080, protocol: 'tcp', pid: null, processName: null },
    ];

    act(() => {
      emitMockEvent('ports-changed-pane-1', ports);
    });

    expect(await screen.findByText(':3000')).toBeInTheDocument();
    expect(screen.getByText(':8080')).toBeInTheDocument();
  });

  it('hides ports section when empty', () => {
    render(<WorkspaceMetadata paneId="pane-1" />);

    expect(screen.queryByTestId('port-info')).not.toBeInTheDocument();
  });

  it('shows ahead/behind counts when non-zero', async () => {
    render(<WorkspaceMetadata paneId="pane-1" />);

    const gitInfo: GitInfo = {
      branch: 'main',
      isDirty: false,
      ahead: 2,
      behind: 3,
    };

    act(() => {
      emitMockEvent('git-info-pane-1', gitInfo);
    });

    expect(await screen.findByText(/↑2/)).toBeInTheDocument();
    expect(screen.getByText(/↓3/)).toBeInTheDocument();
  });
});
