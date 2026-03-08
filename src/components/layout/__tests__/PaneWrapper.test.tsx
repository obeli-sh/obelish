import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import * as TerminalPaneModule from '../../terminal/TerminalPane';
import * as TerminalToolbarModule from '../../terminal/TerminalToolbar';
import { PaneWrapper } from '../PaneWrapper';
import { useWorkspaceStore } from '../../../stores/workspaceStore';

describe('PaneWrapper', () => {
  const defaultProps = {
    paneId: 'pane-1',
    ptyId: 'pty-1',
    isActive: false,
    onClick: vi.fn(),
    onClose: vi.fn(),
    onSplitHorizontal: vi.fn(),
    onSplitVertical: vi.fn(),
    onAutoSplit: vi.fn(),
    onOpenBrowser: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(TerminalPaneModule, 'TerminalPane').mockImplementation(
      ({ paneId, ptyId, isActive }: { paneId: string; ptyId: string; isActive: boolean }) => (
        <div data-testid={`terminal-pane-${paneId}`} data-pty-id={ptyId} data-active={isActive} />
      ),
    );
    vi.spyOn(TerminalToolbarModule, 'TerminalToolbar').mockImplementation(
      ({ name, onClose, onSplitHorizontal, onSplitVertical, onAutoSplit, onOpenBrowser, onRename }: TerminalToolbarModule.TerminalToolbarProps) => (
        <div data-testid="terminal-toolbar" data-name={name}>
          <button aria-label="Close" onClick={onClose} />
          <button aria-label="Split horizontal" onClick={onSplitHorizontal} />
          <button aria-label="Split vertical" onClick={onSplitVertical} />
          <button aria-label="Auto split" onClick={onAutoSplit} />
          <button aria-label="Open browser" onClick={onOpenBrowser} />
          <button aria-label="Rename" onClick={() => onRename('Renamed')} />
        </div>
      ),
    );
    useWorkspaceStore.setState({
      paneNames: {},
      _nextPaneNumber: 1,
    });
  });

  it('renders TerminalPane with correct props', () => {
    render(<PaneWrapper {...defaultProps} />);

    const terminal = screen.getByTestId('terminal-pane-pane-1');
    expect(terminal).toBeInTheDocument();
    expect(terminal).toHaveAttribute('data-pty-id', 'pty-1');
    expect(terminal).toHaveAttribute('data-active', 'false');
  });

  it('shows accent border when isActive is true', () => {
    const { container } = render(<PaneWrapper {...defaultProps} isActive={true} />);

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.borderColor).toBe('var(--ui-accent)');
  });

  it('keeps neutral border when isActive is false', () => {
    const { container } = render(<PaneWrapper {...defaultProps} isActive={false} />);

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.borderColor).toBe('var(--ui-border)');
  });

  it('calls onClick on click', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    const { container } = render(<PaneWrapper {...defaultProps} onClick={onClick} />);

    await user.click(container.firstChild as HTMLElement);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('applies overflow hidden to clip terminal content', () => {
    const { container } = render(<PaneWrapper {...defaultProps} />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.overflow).toBe('hidden');
  });

  it('is memoized (React.memo)', () => {
    expect(PaneWrapper).toHaveProperty('$$typeof', Symbol.for('react.memo'));
  });

  it('shows notification border when hasNotification is true', () => {
    const { container } = render(
      <PaneWrapper {...defaultProps} hasNotification={true} />,
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.borderColor).toBe('color-mix(in srgb, var(--ui-accent) 40%, var(--ui-border))');
  });

  it('shows neutral border when no notification', () => {
    const { container } = render(
      <PaneWrapper {...defaultProps} hasNotification={false} />,
    );

    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.style.borderColor).toBe('var(--ui-border)');
  });

  describe('TerminalToolbar integration', () => {
    it('renders TerminalToolbar with auto-assigned name', async () => {
      render(<PaneWrapper {...defaultProps} />);

      const toolbar = screen.getByTestId('terminal-toolbar');
      expect(toolbar).toBeInTheDocument();
      // Name is assigned via effect, wait for re-render
      await waitFor(() => {
        expect(screen.getByTestId('terminal-toolbar')).toHaveAttribute('data-name', 'Terminal 1');
      });
    });

    it('passes action callbacks to TerminalToolbar', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();
      const onSplitHorizontal = vi.fn();
      const onSplitVertical = vi.fn();
      const onAutoSplit = vi.fn();
      const onOpenBrowser = vi.fn();

      render(
        <PaneWrapper
          {...defaultProps}
          onClose={onClose}
          onSplitHorizontal={onSplitHorizontal}
          onSplitVertical={onSplitVertical}
          onAutoSplit={onAutoSplit}
          onOpenBrowser={onOpenBrowser}
        />,
      );

      await user.click(screen.getByRole('button', { name: /close/i }));
      expect(onClose).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole('button', { name: /split horizontal/i }));
      expect(onSplitHorizontal).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole('button', { name: /split vertical/i }));
      expect(onSplitVertical).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole('button', { name: /auto split/i }));
      expect(onAutoSplit).toHaveBeenCalledTimes(1);

      await user.click(screen.getByRole('button', { name: /open browser/i }));
      expect(onOpenBrowser).toHaveBeenCalledTimes(1);
    });

    it('onRename updates pane name in store', async () => {
      const user = userEvent.setup();
      render(<PaneWrapper {...defaultProps} />);

      await user.click(screen.getByRole('button', { name: /rename/i }));
      expect(useWorkspaceStore.getState().paneNames['pane-1']).toBe('Renamed');
    });

    it('uses flex column layout with toolbar on top', () => {
      const { container } = render(<PaneWrapper {...defaultProps} />);
      const wrapper = container.firstChild as HTMLElement;
      expect(wrapper.style.display).toBe('flex');
      expect(wrapper.style.flexDirection).toBe('column');
    });
  });

  describe('onResize', () => {
    let observeCallback: ResizeObserverCallback | null;
    let mockDisconnect: ReturnType<typeof vi.fn>;
    let mockObserve: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      observeCallback = null;
      mockDisconnect = vi.fn();
      mockObserve = vi.fn();
      vi.stubGlobal('ResizeObserver', vi.fn((cb: ResizeObserverCallback) => {
        observeCallback = cb;
        return {
          observe: mockObserve,
          disconnect: mockDisconnect,
          unobserve: vi.fn(),
        };
      }));
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.stubGlobal('ResizeObserver', vi.fn(() => ({
        observe: vi.fn(),
        disconnect: vi.fn(),
        unobserve: vi.fn(),
      })));
    });

    it('calls onResize with dimensions when isActive and ResizeObserver fires', () => {
      const onResize = vi.fn();
      render(<PaneWrapper {...defaultProps} isActive={true} onResize={onResize} />);

      expect(mockObserve).toHaveBeenCalled();

      observeCallback!(
        [{ contentRect: { width: 800, height: 400 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );

      expect(onResize).toHaveBeenCalledWith(800, 400);
    });

    it('does not set up ResizeObserver when isActive is false', () => {
      const onResize = vi.fn();
      render(<PaneWrapper {...defaultProps} isActive={false} onResize={onResize} />);

      expect(mockObserve).not.toHaveBeenCalled();
      expect(onResize).not.toHaveBeenCalled();
    });

    it('disconnects observer on unmount', () => {
      const onResize = vi.fn();
      const { unmount } = render(
        <PaneWrapper {...defaultProps} isActive={true} onResize={onResize} />,
      );

      unmount();
      expect(mockDisconnect).toHaveBeenCalled();
    });
  });
});
