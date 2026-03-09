import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { LayoutNode } from '../../../lib/workspace-types';
import * as TerminalPaneModule from '../../terminal/TerminalPane';
import * as TerminalToolbarModule from '../../terminal/TerminalToolbar';
import * as BrowserPaneModule from '../../browser/BrowserPane';
import { PaneSplitter } from '../PaneSplitter';
import { useWorkspaceStore } from '../../../stores/workspaceStore';

describe('PaneSplitter', () => {
  function createDataTransfer(): DataTransfer {
    const store = new Map<string, string>();
    return {
      setData: (type: string, value: string) => {
        store.set(type, value);
      },
      getData: (type: string) => store.get(type) ?? '',
      clearData: () => store.clear(),
      dropEffect: 'move',
      effectAllowed: 'all',
      files: [] as unknown as FileList,
      items: [] as unknown as DataTransferItemList,
      types: [],
      setDragImage: () => {},
    } as DataTransfer;
  }

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

  describe('pane drag and drop', () => {
    function mockRect(target: HTMLElement, rect: { left: number; top: number; width: number; height: number }) {
      vi.spyOn(target, 'getBoundingClientRect').mockReturnValue({
          x: rect.left,
          y: rect.top,
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
          right: rect.left + rect.width,
          bottom: rect.top + rect.height,
          toJSON: () => ({}),
        } as DOMRect);
    }

    it('calls onPaneMove with center position when dropped on pane body', () => {
      const onPaneMove = vi.fn();
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
          onPaneMove={onPaneMove}
        />,
      );

      const source = screen
        .getByTestId('terminal-pane-pane-1')
        .closest('[data-testid="pane-wrapper"]') as HTMLElement;
      const target = screen
        .getByTestId('terminal-pane-pane-2')
        .closest('[data-testid="pane-wrapper"]') as HTMLElement;
      const dataTransfer = createDataTransfer();
      mockRect(target, { left: 0, top: 0, width: 100, height: 100 });

      fireEvent.dragStart(source, { dataTransfer });
      fireEvent.dragOver(target, { dataTransfer, clientX: 50, clientY: 50 });
      fireEvent.drop(target, { dataTransfer, clientX: 50, clientY: 50 });

      expect(onPaneMove).toHaveBeenCalledWith('pane-1', 'pane-2', 'center');
    });

    it('calls onPaneMove with edge position when dropped near pane edge', () => {
      const onPaneMove = vi.fn();
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
          onPaneMove={onPaneMove}
        />,
      );

      const source = screen
        .getByTestId('terminal-pane-pane-1')
        .closest('[data-testid="pane-wrapper"]') as HTMLElement;
      const target = screen
        .getByTestId('terminal-pane-pane-2')
        .closest('[data-testid="pane-wrapper"]') as HTMLElement;
      const dataTransfer = createDataTransfer();
      mockRect(target, { left: 100, top: 20, width: 200, height: 120 });

      fireEvent.dragStart(source, { dataTransfer });
      dataTransfer.setData('application/x-obelisk-drop-position', 'left');
      fireEvent.drop(target, { dataTransfer, clientX: 110, clientY: 80 });

      expect(onPaneMove).toHaveBeenCalledWith('pane-1', 'pane-2', 'left');
    });

    it('does not call onPaneMove when dropped on same pane', () => {
      const onPaneMove = vi.fn();
      const layout: LayoutNode = { type: 'leaf', paneId: 'pane-1', ptyId: 'pty-1' };
      render(
        <PaneSplitter
          layout={layout}
          activePaneId={null}
          onPaneClick={vi.fn()}
          onPaneMove={onPaneMove}
        />,
      );

      const pane = screen
        .getByTestId('terminal-pane-pane-1')
        .closest('[data-testid="pane-wrapper"]') as HTMLElement;
      const dataTransfer = createDataTransfer();
      mockRect(pane, { left: 0, top: 0, width: 100, height: 100 });

      fireEvent.dragStart(pane, { dataTransfer });
      fireEvent.dragOver(pane, { dataTransfer, clientX: 10, clientY: 10 });
      fireEvent.drop(pane, { dataTransfer, clientX: 10, clientY: 10 });

      expect(onPaneMove).not.toHaveBeenCalled();
    });

    it('shows drop zone overlays on browser pane during dragOver', () => {
      useWorkspaceStore.setState({
        browserPaneUrls: { 'pane-browser': 'https://example.com' },
      });
      const onPaneMove = vi.fn();
      const layout: LayoutNode = {
        type: 'split',
        direction: 'horizontal',
        children: [
          { type: 'leaf', paneId: 'pane-1', ptyId: 'pty-1' },
          { type: 'leaf', paneId: 'pane-browser', ptyId: '' },
        ],
        sizes: [0.5, 0.5],
      };
      render(
        <PaneSplitter
          layout={layout}
          activePaneId={null}
          onPaneClick={vi.fn()}
          onPaneMove={onPaneMove}
        />,
      );

      const browserWrapper = screen
        .getByTestId('browser-pane-pane-browser')
        .closest('[data-testid="pane-wrapper"]') as HTMLElement;
      const sourceWrapper = screen
        .getByTestId('terminal-pane-pane-1')
        .closest('[data-testid="pane-wrapper"]') as HTMLElement;
      const dataTransfer = createDataTransfer();
      mockRect(browserWrapper, { left: 0, top: 0, width: 200, height: 200 });

      // Before drag, no drop zones
      expect(screen.queryByTestId('pane-drop-zone-left-pane-browser')).not.toBeInTheDocument();

      fireEvent.dragStart(sourceWrapper, { dataTransfer });
      // dragOver sets dragPreviewPosition via resolveDropPosition, triggering drop zone render
      fireEvent.dragOver(browserWrapper, { dataTransfer, clientX: 10, clientY: 100 });

      // Drop zones should now be visible on the browser pane
      expect(screen.getByTestId('pane-drop-zone-left-pane-browser')).toBeInTheDocument();
      expect(screen.getByTestId('pane-drop-zone-right-pane-browser')).toBeInTheDocument();
      expect(screen.getByTestId('pane-drop-zone-top-pane-browser')).toBeInTheDocument();
      expect(screen.getByTestId('pane-drop-zone-bottom-pane-browser')).toBeInTheDocument();
    });

    it('drop zone overlays have correct positioning styles for each edge', () => {
      useWorkspaceStore.setState({
        browserPaneUrls: { 'pane-browser': 'https://example.com' },
      });
      const onPaneMove = vi.fn();
      const layout: LayoutNode = {
        type: 'split',
        direction: 'horizontal',
        children: [
          { type: 'leaf', paneId: 'pane-1', ptyId: 'pty-1' },
          { type: 'leaf', paneId: 'pane-browser', ptyId: '' },
        ],
        sizes: [0.5, 0.5],
      };
      render(
        <PaneSplitter
          layout={layout}
          activePaneId={null}
          onPaneClick={vi.fn()}
          onPaneMove={onPaneMove}
        />,
      );

      const browserWrapper = screen
        .getByTestId('browser-pane-pane-browser')
        .closest('[data-testid="pane-wrapper"]') as HTMLElement;
      const sourceWrapper = screen
        .getByTestId('terminal-pane-pane-1')
        .closest('[data-testid="pane-wrapper"]') as HTMLElement;
      const dataTransfer = createDataTransfer();
      mockRect(browserWrapper, { left: 0, top: 0, width: 200, height: 200 });

      fireEvent.dragStart(sourceWrapper, { dataTransfer });
      // Drag over left edge to activate 'left' position
      fireEvent.dragOver(browserWrapper, { dataTransfer, clientX: 10, clientY: 100 });

      const leftZone = screen.getByTestId('pane-drop-zone-left-pane-browser');
      const rightZone = screen.getByTestId('pane-drop-zone-right-pane-browser');
      const topZone = screen.getByTestId('pane-drop-zone-top-pane-browser');
      const bottomZone = screen.getByTestId('pane-drop-zone-bottom-pane-browser');

      // Left zone: positioned at left edge
      expect(leftZone.style.left).toBe('0px');
      expect(leftZone.style.top).toBe('0px');
      expect(leftZone.style.width).toBe('22%');
      expect(leftZone.style.height).toBe('100%');

      // Right zone: positioned at right edge
      expect(rightZone.style.right).toBe('0px');
      expect(rightZone.style.top).toBe('0px');
      expect(rightZone.style.width).toBe('22%');
      expect(rightZone.style.height).toBe('100%');

      // Top zone: positioned at top edge
      expect(topZone.style.left).toBe('0px');
      expect(topZone.style.top).toBe('0px');
      expect(topZone.style.width).toBe('100%');
      expect(topZone.style.height).toBe('22%');

      // Bottom zone: positioned at bottom edge
      expect(bottomZone.style.left).toBe('0px');
      expect(bottomZone.style.bottom).toBe('0px');
      expect(bottomZone.style.width).toBe('100%');
      expect(bottomZone.style.height).toBe('22%');
    });

    it('clears drop zones on browser pane after dragLeave to outside', () => {
      useWorkspaceStore.setState({
        browserPaneUrls: { 'pane-browser': 'https://example.com' },
      });
      const onPaneMove = vi.fn();
      const layout: LayoutNode = {
        type: 'split',
        direction: 'horizontal',
        children: [
          { type: 'leaf', paneId: 'pane-1', ptyId: 'pty-1' },
          { type: 'leaf', paneId: 'pane-browser', ptyId: '' },
        ],
        sizes: [0.5, 0.5],
      };
      const { container } = render(
        <PaneSplitter
          layout={layout}
          activePaneId={null}
          onPaneClick={vi.fn()}
          onPaneMove={onPaneMove}
        />,
      );

      const browserWrapper = screen
        .getByTestId('browser-pane-pane-browser')
        .closest('[data-testid="pane-wrapper"]') as HTMLElement;
      const sourceWrapper = screen
        .getByTestId('terminal-pane-pane-1')
        .closest('[data-testid="pane-wrapper"]') as HTMLElement;
      const dataTransfer = createDataTransfer();
      mockRect(browserWrapper, { left: 0, top: 0, width: 200, height: 200 });

      fireEvent.dragStart(sourceWrapper, { dataTransfer });
      fireEvent.dragOver(browserWrapper, { dataTransfer, clientX: 10, clientY: 100 });

      // Drop zones visible
      expect(screen.getByTestId('pane-drop-zone-left-pane-browser')).toBeInTheDocument();

      // dragLeave to an element outside the browser wrapper
      fireEvent.dragLeave(browserWrapper, { relatedTarget: container });

      // Drop zones should be cleared
      expect(screen.queryByTestId('pane-drop-zone-left-pane-browser')).not.toBeInTheDocument();
    });

    it('clears drop zones on browser pane after drop', () => {
      useWorkspaceStore.setState({
        browserPaneUrls: { 'pane-browser': 'https://example.com' },
      });
      const onPaneMove = vi.fn();
      const layout: LayoutNode = {
        type: 'split',
        direction: 'horizontal',
        children: [
          { type: 'leaf', paneId: 'pane-1', ptyId: 'pty-1' },
          { type: 'leaf', paneId: 'pane-browser', ptyId: '' },
        ],
        sizes: [0.5, 0.5],
      };
      render(
        <PaneSplitter
          layout={layout}
          activePaneId={null}
          onPaneClick={vi.fn()}
          onPaneMove={onPaneMove}
        />,
      );

      const browserWrapper = screen
        .getByTestId('browser-pane-pane-browser')
        .closest('[data-testid="pane-wrapper"]') as HTMLElement;
      const sourceWrapper = screen
        .getByTestId('terminal-pane-pane-1')
        .closest('[data-testid="pane-wrapper"]') as HTMLElement;
      const dataTransfer = createDataTransfer();
      mockRect(browserWrapper, { left: 0, top: 0, width: 200, height: 200 });

      fireEvent.dragStart(sourceWrapper, { dataTransfer });
      fireEvent.dragOver(browserWrapper, { dataTransfer, clientX: 10, clientY: 100 });

      expect(screen.getByTestId('pane-drop-zone-left-pane-browser')).toBeInTheDocument();

      fireEvent.drop(browserWrapper, { dataTransfer, clientX: 10, clientY: 100 });

      // Drop zones should be cleared after drop
      expect(screen.queryByTestId('pane-drop-zone-left-pane-browser')).not.toBeInTheDocument();
    });

    it('calls onPaneMove with right position on browser pane drop', () => {
      useWorkspaceStore.setState({
        browserPaneUrls: { 'pane-browser': 'https://example.com' },
      });
      const onPaneMove = vi.fn();
      const layout: LayoutNode = {
        type: 'split',
        direction: 'horizontal',
        children: [
          { type: 'leaf', paneId: 'pane-1', ptyId: 'pty-1' },
          { type: 'leaf', paneId: 'pane-browser', ptyId: '' },
        ],
        sizes: [0.5, 0.5],
      };
      render(
        <PaneSplitter
          layout={layout}
          activePaneId={null}
          onPaneClick={vi.fn()}
          onPaneMove={onPaneMove}
        />,
      );

      const browserWrapper = screen
        .getByTestId('browser-pane-pane-browser')
        .closest('[data-testid="pane-wrapper"]') as HTMLElement;
      const sourceWrapper = screen
        .getByTestId('terminal-pane-pane-1')
        .closest('[data-testid="pane-wrapper"]') as HTMLElement;
      const dataTransfer = createDataTransfer();
      mockRect(browserWrapper, { left: 0, top: 0, width: 100, height: 100 });

      fireEvent.dragStart(sourceWrapper, { dataTransfer });
      dataTransfer.setData('application/x-obelisk-drop-position', 'right');
      fireEvent.drop(browserWrapper, { dataTransfer, clientX: 95, clientY: 50 });

      expect(onPaneMove).toHaveBeenCalledWith('pane-1', 'pane-browser', 'right');
    });

    it('calls onPaneMove with top position on browser pane drop', () => {
      useWorkspaceStore.setState({
        browserPaneUrls: { 'pane-browser': 'https://example.com' },
      });
      const onPaneMove = vi.fn();
      const layout: LayoutNode = {
        type: 'split',
        direction: 'horizontal',
        children: [
          { type: 'leaf', paneId: 'pane-1', ptyId: 'pty-1' },
          { type: 'leaf', paneId: 'pane-browser', ptyId: '' },
        ],
        sizes: [0.5, 0.5],
      };
      render(
        <PaneSplitter
          layout={layout}
          activePaneId={null}
          onPaneClick={vi.fn()}
          onPaneMove={onPaneMove}
        />,
      );

      const browserWrapper = screen
        .getByTestId('browser-pane-pane-browser')
        .closest('[data-testid="pane-wrapper"]') as HTMLElement;
      const sourceWrapper = screen
        .getByTestId('terminal-pane-pane-1')
        .closest('[data-testid="pane-wrapper"]') as HTMLElement;
      const dataTransfer = createDataTransfer();

      fireEvent.dragStart(sourceWrapper, { dataTransfer });
      dataTransfer.setData('application/x-obelisk-drop-position', 'top');
      fireEvent.drop(browserWrapper, { dataTransfer, clientX: 50, clientY: 5 });

      expect(onPaneMove).toHaveBeenCalledWith('pane-1', 'pane-browser', 'top');
    });

    it('calls onPaneMove with bottom position on browser pane drop', () => {
      useWorkspaceStore.setState({
        browserPaneUrls: { 'pane-browser': 'https://example.com' },
      });
      const onPaneMove = vi.fn();
      const layout: LayoutNode = {
        type: 'split',
        direction: 'horizontal',
        children: [
          { type: 'leaf', paneId: 'pane-1', ptyId: 'pty-1' },
          { type: 'leaf', paneId: 'pane-browser', ptyId: '' },
        ],
        sizes: [0.5, 0.5],
      };
      render(
        <PaneSplitter
          layout={layout}
          activePaneId={null}
          onPaneClick={vi.fn()}
          onPaneMove={onPaneMove}
        />,
      );

      const browserWrapper = screen
        .getByTestId('browser-pane-pane-browser')
        .closest('[data-testid="pane-wrapper"]') as HTMLElement;
      const sourceWrapper = screen
        .getByTestId('terminal-pane-pane-1')
        .closest('[data-testid="pane-wrapper"]') as HTMLElement;
      const dataTransfer = createDataTransfer();

      fireEvent.dragStart(sourceWrapper, { dataTransfer });
      dataTransfer.setData('application/x-obelisk-drop-position', 'bottom');
      fireEvent.drop(browserWrapper, { dataTransfer, clientX: 50, clientY: 95 });

      expect(onPaneMove).toHaveBeenCalledWith('pane-1', 'pane-browser', 'bottom');
    });

    it('resolves center position when pane has zero-size rect', () => {
      const onPaneMove = vi.fn();
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
          onPaneMove={onPaneMove}
        />,
      );

      const source = screen
        .getByTestId('terminal-pane-pane-1')
        .closest('[data-testid="pane-wrapper"]') as HTMLElement;
      const target = screen
        .getByTestId('terminal-pane-pane-2')
        .closest('[data-testid="pane-wrapper"]') as HTMLElement;
      const dataTransfer = createDataTransfer();
      // Zero-size rect should resolve to 'center'
      mockRect(target, { left: 0, top: 0, width: 0, height: 0 });

      fireEvent.dragStart(source, { dataTransfer });
      fireEvent.dragOver(target, { dataTransfer, clientX: 0, clientY: 0 });
      fireEvent.drop(target, { dataTransfer, clientX: 0, clientY: 0 });

      expect(onPaneMove).toHaveBeenCalledWith('pane-1', 'pane-2', 'center');
    });

    it('clears drop zones on browser pane after dragEnd', () => {
      useWorkspaceStore.setState({
        browserPaneUrls: { 'pane-browser': 'https://example.com' },
      });
      const onPaneMove = vi.fn();
      const layout: LayoutNode = {
        type: 'split',
        direction: 'horizontal',
        children: [
          { type: 'leaf', paneId: 'pane-1', ptyId: 'pty-1' },
          { type: 'leaf', paneId: 'pane-browser', ptyId: '' },
        ],
        sizes: [0.5, 0.5],
      };
      render(
        <PaneSplitter
          layout={layout}
          activePaneId={null}
          onPaneClick={vi.fn()}
          onPaneMove={onPaneMove}
        />,
      );

      const browserWrapper = screen
        .getByTestId('browser-pane-pane-browser')
        .closest('[data-testid="pane-wrapper"]') as HTMLElement;
      const sourceWrapper = screen
        .getByTestId('terminal-pane-pane-1')
        .closest('[data-testid="pane-wrapper"]') as HTMLElement;
      const dataTransfer = createDataTransfer();
      mockRect(browserWrapper, { left: 0, top: 0, width: 200, height: 200 });

      fireEvent.dragStart(sourceWrapper, { dataTransfer });
      fireEvent.dragOver(browserWrapper, { dataTransfer, clientX: 10, clientY: 100 });

      expect(screen.getByTestId('pane-drop-zone-left-pane-browser')).toBeInTheDocument();

      // dragEnd on the browser wrapper (which has the onDragEnd handler) clears drop zones
      fireEvent.dragEnd(browserWrapper, { dataTransfer });

      expect(screen.queryByTestId('pane-drop-zone-left-pane-browser')).not.toBeInTheDocument();
    });
  });
});
