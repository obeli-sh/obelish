import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { LayoutNode } from '../../../lib/workspace-types';
import * as TerminalPaneModule from '../../terminal/TerminalPane';
import * as TerminalToolbarModule from '../../terminal/TerminalToolbar';
import * as BrowserPaneModule from '../../browser/BrowserPane';
import { PaneSplitter } from '../PaneSplitter';
import { useWorkspaceStore } from '../../../stores/workspaceStore';

describe('PaneSplitter', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(TerminalPaneModule, 'TerminalPane').mockImplementation(
      ({ paneId, ptyId, isActive }: { paneId: string; ptyId: string; isActive: boolean }) => (
        <div data-testid={`terminal-pane-${paneId}`} data-pty-id={ptyId} data-active={isActive} />
      ),
    );
    vi.spyOn(TerminalToolbarModule, 'TerminalToolbar').mockImplementation(
      ({ name, onClose }: TerminalToolbarModule.TerminalToolbarProps) => (
        <div data-testid="terminal-toolbar" data-name={name}>
          <button aria-label="Close" onClick={onClose} />
        </div>
      ),
    );
    vi.spyOn(BrowserPaneModule, 'BrowserPane').mockImplementation(
      ({ paneId, url, isActive }: { paneId: string; url: string; isActive: boolean }) => (
        <div data-testid={`browser-pane-${paneId}`} data-url={url} data-active={isActive} />
      ),
    );
    useWorkspaceStore.setState({ browserPaneUrls: {}, paneNames: {}, _nextPaneNumber: 1 });
  });

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
      <PaneSplitter layout={layout} activePaneId={null} onPaneClick={vi.fn()} />
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
      <PaneSplitter layout={layout} activePaneId={null} onPaneClick={vi.fn()} />
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
      <PaneSplitter layout={layout} activePaneId={null} onPaneClick={vi.fn()} />
    );

    expect(screen.getAllByTestId('panel-group')).toHaveLength(2);
    expect(screen.getAllByTestId('panel')).toHaveLength(4);
    expect(screen.getAllByTestId('panel-resize-handle')).toHaveLength(2);
    expect(screen.getByTestId('terminal-pane-pane-1')).toBeInTheDocument();
    expect(screen.getByTestId('terminal-pane-pane-2')).toBeInTheDocument();
    expect(screen.getByTestId('terminal-pane-pane-3')).toBeInTheDocument();
  });

  it('passes activePaneId to PaneWrapper', () => {
    const layout: LayoutNode = { type: 'leaf', paneId: 'pane-1', ptyId: 'pty-1' };

    render(
      <PaneSplitter layout={layout} activePaneId="pane-1" onPaneClick={vi.fn()} />
    );

    const terminal = screen.getByTestId('terminal-pane-pane-1');
    expect(terminal).toHaveAttribute('data-active', 'true');
  });

  it('passes onPaneClick to PaneWrapper', () => {
    const onPaneClick = vi.fn();
    const layout: LayoutNode = { type: 'leaf', paneId: 'pane-1', ptyId: 'pty-1' };

    const { container } = render(
      <PaneSplitter layout={layout} activePaneId={null} onPaneClick={onPaneClick} />
    );

    const wrapperDiv = container.querySelector('[data-testid="pane-wrapper"]');
    expect(wrapperDiv).toBeInTheDocument();
    wrapperDiv!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onPaneClick).toHaveBeenCalledWith('pane-1');
  });

  it('uses ptyId from leaf layout node directly', () => {
    const layout: LayoutNode = { type: 'leaf', paneId: 'pane-abc', ptyId: 'pty-xyz' };

    render(
      <PaneSplitter layout={layout} activePaneId={null} onPaneClick={vi.fn()} />
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
      <PaneSplitter layout={layout} activePaneId="pane-browser" onPaneClick={vi.fn()} />
    );

    const browser = screen.getByTestId('browser-pane-pane-browser');
    expect(browser).toBeInTheDocument();
    expect(browser).toHaveAttribute('data-url', 'https://example.com');
    expect(browser).toHaveAttribute('data-active', 'true');
    expect(screen.queryByTestId('terminal-pane-pane-browser')).not.toBeInTheDocument();
  });

  it('renders terminal when empty ptyId but not in browserPaneUrls (PTY failure)', () => {
    useWorkspaceStore.setState({ browserPaneUrls: {} });
    const layout: LayoutNode = { type: 'leaf', paneId: 'pane-broken', ptyId: '' };

    render(
      <PaneSplitter layout={layout} activePaneId={null} onPaneClick={vi.fn()} />
    );

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
      <PaneSplitter layout={layout} activePaneId={null} onPaneClick={vi.fn()} />
    );

    expect(screen.getByTestId('terminal-pane-pane-1')).toBeInTheDocument();
    expect(screen.getByTestId('browser-pane-pane-2')).toBeInTheDocument();
  });

  it('renders Separator with style prop for dark theme', () => {
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
      <PaneSplitter layout={layout} activePaneId={null} onPaneClick={vi.fn()} />
    );

    const handle = screen.getByTestId('panel-resize-handle');
    expect(handle).toBeInTheDocument();
  });

  describe('onPaneResize', () => {
    it('threads onPaneResize to leaf PaneWrapper', () => {
      const onPaneResize = vi.fn();
      const layout: LayoutNode = { type: 'leaf', paneId: 'pane-1', ptyId: 'pty-1' };

      render(
        <PaneSplitter layout={layout} activePaneId="pane-1" onPaneClick={vi.fn()} onPaneResize={onPaneResize} />,
      );

      expect(screen.getByTestId('terminal-pane-pane-1')).toBeInTheDocument();
    });

    it('threads onPaneResize through split nodes to leaves', () => {
      const onPaneResize = vi.fn();
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
        <PaneSplitter layout={layout} activePaneId="pane-1" onPaneClick={vi.fn()} onPaneResize={onPaneResize} />,
      );

      expect(screen.getByTestId('terminal-pane-pane-1')).toBeInTheDocument();
      expect(screen.getByTestId('terminal-pane-pane-2')).toBeInTheDocument();
    });
  });

  describe('pane action callbacks', () => {
    it('threads onPaneClose to leaf PaneWrapper', async () => {
      const user = userEvent.setup();
      const onPaneClose = vi.fn();
      const layout: LayoutNode = { type: 'leaf', paneId: 'pane-1', ptyId: 'pty-1' };

      render(
        <PaneSplitter layout={layout} activePaneId="pane-1" onPaneClick={vi.fn()} onPaneClose={onPaneClose} />,
      );

      await user.click(screen.getByRole('button', { name: /close/i }));
      expect(onPaneClose).toHaveBeenCalledWith('pane-1');
    });

    it('threads pane action callbacks through split nodes', async () => {
      const user = userEvent.setup();
      const onPaneClose = vi.fn();
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
        <PaneSplitter layout={layout} activePaneId="pane-1" onPaneClick={vi.fn()} onPaneClose={onPaneClose} />,
      );

      const closeButtons = screen.getAllByRole('button', { name: /close/i });
      expect(closeButtons).toHaveLength(2);

      await user.click(closeButtons[0]);
      expect(onPaneClose).toHaveBeenCalledWith('pane-1');

      await user.click(closeButtons[1]);
      expect(onPaneClose).toHaveBeenCalledWith('pane-2');
    });
  });
});
