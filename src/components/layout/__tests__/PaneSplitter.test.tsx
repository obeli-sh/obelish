import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import type { LayoutNode, PaneInfo } from '../../../lib/workspace-types';

vi.mock('react-resizable-panels');
vi.mock('../../terminal/TerminalPane', () => ({
  TerminalPane: vi.fn(({ paneId, ptyId, isActive }: { paneId: string; ptyId: string; isActive: boolean }) => (
    <div data-testid={`terminal-pane-${paneId}`} data-pty-id={ptyId} data-active={isActive} />
  )),
}));

import { PaneSplitter } from '../PaneSplitter';

describe('PaneSplitter', () => {
  const defaultPanes: Record<string, PaneInfo> = {
    'pane-1': { id: 'pane-1', ptyId: 'pty-1', paneType: 'terminal', cwd: null },
    'pane-2': { id: 'pane-2', ptyId: 'pty-2', paneType: 'terminal', cwd: null },
    'pane-3': { id: 'pane-3', ptyId: 'pty-3', paneType: 'terminal', cwd: null },
  };

  it('renders single leaf as PaneWrapper', () => {
    const layout: LayoutNode = { type: 'leaf', paneId: 'pane-1' };

    render(
      <PaneSplitter
        layout={layout}
        activePaneId="pane-1"
        onPaneClick={vi.fn()}
        panes={defaultPanes}
      />
    );

    expect(screen.getByTestId('terminal-pane-pane-1')).toBeInTheDocument();
  });

  it('renders horizontal split with two panels and a resize handle', () => {
    const layout: LayoutNode = {
      type: 'split',
      direction: 'horizontal',
      children: [
        { type: 'leaf', paneId: 'pane-1' },
        { type: 'leaf', paneId: 'pane-2' },
      ],
      sizes: [0.5, 0.5],
    };

    render(
      <PaneSplitter
        layout={layout}
        activePaneId={null}
        onPaneClick={vi.fn()}
        panes={defaultPanes}
      />
    );

    const panelGroup = screen.getByTestId('panel-group');
    expect(panelGroup).toHaveAttribute('data-orientation', 'horizontal');
    expect(screen.getAllByTestId('panel')).toHaveLength(2);
    expect(screen.getByTestId('panel-resize-handle')).toBeInTheDocument();
  });

  it('renders vertical split with two panels', () => {
    const layout: LayoutNode = {
      type: 'split',
      direction: 'vertical',
      children: [
        { type: 'leaf', paneId: 'pane-1' },
        { type: 'leaf', paneId: 'pane-2' },
      ],
      sizes: [0.6, 0.4],
    };

    render(
      <PaneSplitter
        layout={layout}
        activePaneId={null}
        onPaneClick={vi.fn()}
        panes={defaultPanes}
      />
    );

    const panelGroup = screen.getByTestId('panel-group');
    expect(panelGroup).toHaveAttribute('data-orientation', 'vertical');

    const panels = screen.getAllByTestId('panel');
    expect(panels[0]).toHaveAttribute('data-default-size', '60');
    expect(panels[1]).toHaveAttribute('data-default-size', '40');
  });

  it('renders nested splits (3 levels deep)', () => {
    const layout: LayoutNode = {
      type: 'split',
      direction: 'horizontal',
      children: [
        {
          type: 'split',
          direction: 'vertical',
          children: [
            { type: 'leaf', paneId: 'pane-1' },
            { type: 'leaf', paneId: 'pane-2' },
          ],
          sizes: [0.5, 0.5],
        },
        { type: 'leaf', paneId: 'pane-3' },
      ],
      sizes: [0.7, 0.3],
    };

    render(
      <PaneSplitter
        layout={layout}
        activePaneId={null}
        onPaneClick={vi.fn()}
        panes={defaultPanes}
      />
    );

    // Outer split + inner split = 2 panel groups
    expect(screen.getAllByTestId('panel-group')).toHaveLength(2);
    // Outer 2 panels + inner 2 panels = 4 panels
    expect(screen.getAllByTestId('panel')).toHaveLength(4);
    // 2 resize handles (one per split)
    expect(screen.getAllByTestId('panel-resize-handle')).toHaveLength(2);
    // 3 terminal panes
    expect(screen.getByTestId('terminal-pane-pane-1')).toBeInTheDocument();
    expect(screen.getByTestId('terminal-pane-pane-2')).toBeInTheDocument();
    expect(screen.getByTestId('terminal-pane-pane-3')).toBeInTheDocument();
  });

  it('passes activePaneId to PaneWrapper', () => {
    const layout: LayoutNode = { type: 'leaf', paneId: 'pane-1' };

    render(
      <PaneSplitter
        layout={layout}
        activePaneId="pane-1"
        onPaneClick={vi.fn()}
        panes={defaultPanes}
      />
    );

    const terminal = screen.getByTestId('terminal-pane-pane-1');
    expect(terminal).toHaveAttribute('data-active', 'true');
  });

  it('passes onPaneClick to PaneWrapper', async () => {
    const onPaneClick = vi.fn();
    const layout: LayoutNode = { type: 'leaf', paneId: 'pane-1' };

    const { container } = render(
      <PaneSplitter
        layout={layout}
        activePaneId={null}
        onPaneClick={onPaneClick}
        panes={defaultPanes}
      />
    );

    // Click the pane wrapper div
    const wrapperDiv = container.querySelector('[data-testid="pane-wrapper"]');
    expect(wrapperDiv).toBeInTheDocument();
    wrapperDiv!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onPaneClick).toHaveBeenCalledWith('pane-1');
  });

  it('falls back to paneId as ptyId when pane not found in panes record', () => {
    const layout: LayoutNode = { type: 'leaf', paneId: 'unknown-pane' };

    render(
      <PaneSplitter
        layout={layout}
        activePaneId={null}
        onPaneClick={vi.fn()}
        panes={defaultPanes}
      />
    );

    const terminal = screen.getByTestId('terminal-pane-unknown-pane');
    expect(terminal).toHaveAttribute('data-pty-id', 'unknown-pane');
  });
});
