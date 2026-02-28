import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import type { LayoutNode } from '../../../lib/workspace-types';

vi.mock('react-resizable-panels');
vi.mock('../../terminal/TerminalPane', () => ({
  TerminalPane: vi.fn(({ paneId, ptyId, isActive }: { paneId: string; ptyId: string; isActive: boolean }) => (
    <div data-testid={`terminal-pane-${paneId}`} data-pty-id={ptyId} data-active={isActive} />
  )),
}));
vi.mock('../../browser/BrowserPane', () => ({
  BrowserPane: vi.fn(({ paneId, url, isActive }: { paneId: string; url: string; isActive: boolean }) => (
    <div data-testid={`browser-pane-${paneId}`} data-url={url} data-active={isActive} />
  )),
}));

import { PaneSplitter } from '../PaneSplitter';
import { useWorkspaceStore } from '../../../stores/workspaceStore';

describe('PaneSplitter', () => {
  it('renders single leaf as PaneWrapper with correct ptyId', () => {
    const layout: LayoutNode = { type: 'leaf', paneId: 'pane-1', ptyId: 'pty-1' };

    render(
      <PaneSplitter
        layout={layout}
        activePaneId="pane-1"
        onPaneClick={vi.fn()}
      />
    );

    const terminal = screen.getByTestId('terminal-pane-pane-1');
    expect(terminal).toBeInTheDocument();
    expect(terminal).toHaveAttribute('data-pty-id', 'pty-1');
  });

  it('renders horizontal split with two panels and a resize handle', () => {
    const layout: LayoutNode = {
      type: 'split',
      direction: 'horizontal',
      children: [
        { type: 'leaf', paneId: 'pane-1', ptyId: 'pty-1' },
        { type: 'leaf', paneId: 'pane-2', ptyId: 'pty-2' },
      ],
      sizes: [0.5, 0.5],
    };

    render(
      <PaneSplitter
        layout={layout}
        activePaneId={null}
        onPaneClick={vi.fn()}
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
        { type: 'leaf', paneId: 'pane-1', ptyId: 'pty-1' },
        { type: 'leaf', paneId: 'pane-2', ptyId: 'pty-2' },
      ],
      sizes: [0.6, 0.4],
    };

    render(
      <PaneSplitter
        layout={layout}
        activePaneId={null}
        onPaneClick={vi.fn()}
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
            { type: 'leaf', paneId: 'pane-1', ptyId: 'pty-1' },
            { type: 'leaf', paneId: 'pane-2', ptyId: 'pty-2' },
          ],
          sizes: [0.5, 0.5],
        },
        { type: 'leaf', paneId: 'pane-3', ptyId: 'pty-3' },
      ],
      sizes: [0.7, 0.3],
    };

    render(
      <PaneSplitter
        layout={layout}
        activePaneId={null}
        onPaneClick={vi.fn()}
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
    const layout: LayoutNode = { type: 'leaf', paneId: 'pane-1', ptyId: 'pty-1' };

    render(
      <PaneSplitter
        layout={layout}
        activePaneId="pane-1"
        onPaneClick={vi.fn()}
      />
    );

    const terminal = screen.getByTestId('terminal-pane-pane-1');
    expect(terminal).toHaveAttribute('data-active', 'true');
  });

  it('passes onPaneClick to PaneWrapper', async () => {
    const onPaneClick = vi.fn();
    const layout: LayoutNode = { type: 'leaf', paneId: 'pane-1', ptyId: 'pty-1' };

    const { container } = render(
      <PaneSplitter
        layout={layout}
        activePaneId={null}
        onPaneClick={onPaneClick}
      />
    );

    // Click the pane wrapper div
    const wrapperDiv = container.querySelector('[data-testid="pane-wrapper"]');
    expect(wrapperDiv).toBeInTheDocument();
    wrapperDiv!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onPaneClick).toHaveBeenCalledWith('pane-1');
  });

  it('uses ptyId from leaf layout node directly', () => {
    const layout: LayoutNode = { type: 'leaf', paneId: 'pane-abc', ptyId: 'pty-xyz' };

    render(
      <PaneSplitter
        layout={layout}
        activePaneId={null}
        onPaneClick={vi.fn()}
      />
    );

    const terminal = screen.getByTestId('terminal-pane-pane-abc');
    expect(terminal).toHaveAttribute('data-pty-id', 'pty-xyz');
  });

  it('renders BrowserPane when ptyId is empty string', () => {
    useWorkspaceStore.setState({
      browserPaneUrls: { 'pane-browser': 'https://example.com' },
    });
    const layout: LayoutNode = { type: 'leaf', paneId: 'pane-browser', ptyId: '' };

    render(
      <PaneSplitter
        layout={layout}
        activePaneId="pane-browser"
        onPaneClick={vi.fn()}
      />
    );

    const browser = screen.getByTestId('browser-pane-pane-browser');
    expect(browser).toBeInTheDocument();
    expect(browser).toHaveAttribute('data-url', 'https://example.com');
    expect(browser).toHaveAttribute('data-active', 'true');
    expect(screen.queryByTestId('terminal-pane-pane-browser')).not.toBeInTheDocument();
  });

  it('renders terminal when empty ptyId but not in browserPaneUrls (PTY failure)', () => {
    useWorkspaceStore.setState({
      browserPaneUrls: {},
    });
    const layout: LayoutNode = { type: 'leaf', paneId: 'pane-broken', ptyId: '' };

    render(
      <PaneSplitter
        layout={layout}
        activePaneId={null}
        onPaneClick={vi.fn()}
      />
    );

    // Should render as terminal (PTY failure case), not browser
    expect(screen.getByTestId('terminal-pane-pane-broken')).toBeInTheDocument();
    expect(screen.queryByTestId('browser-pane-pane-broken')).not.toBeInTheDocument();
  });

  it('renders mixed terminal and browser panes in a split', () => {
    useWorkspaceStore.setState({
      browserPaneUrls: { 'pane-2': 'https://example.com' },
    });
    const layout: LayoutNode = {
      type: 'split',
      direction: 'horizontal',
      children: [
        { type: 'leaf', paneId: 'pane-1', ptyId: 'pty-1' },
        { type: 'leaf', paneId: 'pane-2', ptyId: '' },
      ],
      sizes: [0.5, 0.5],
    };

    render(
      <PaneSplitter
        layout={layout}
        activePaneId={null}
        onPaneClick={vi.fn()}
      />
    );

    expect(screen.getByTestId('terminal-pane-pane-1')).toBeInTheDocument();
    expect(screen.getByTestId('browser-pane-pane-2')).toBeInTheDocument();
  });
});
