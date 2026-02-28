import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { TerminalToolbar, type TerminalToolbarProps } from '../TerminalToolbar';

function makeProps(overrides: Partial<TerminalToolbarProps> = {}): TerminalToolbarProps {
  return {
    paneId: 'pane-1',
    name: 'Terminal 1',
    isActive: true,
    onRename: vi.fn(),
    onClose: vi.fn(),
    onSplitHorizontal: vi.fn(),
    onSplitVertical: vi.fn(),
    onAutoSplit: vi.fn(),
    onOpenBrowser: vi.fn(),
    ...overrides,
  };
}

describe('TerminalToolbar', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the terminal name', () => {
    render(<TerminalToolbar {...makeProps()} />);
    expect(screen.getByText('Terminal 1')).toBeInTheDocument();
  });

  it('renders the terminal icon', () => {
    render(<TerminalToolbar {...makeProps()} />);
    expect(screen.getByTestId('icon-terminal')).toBeInTheDocument();
  });

  it('renders all action buttons', () => {
    render(<TerminalToolbar {...makeProps()} />);
    expect(screen.getByRole('button', { name: /split horizontal/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /split vertical/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /auto split/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /open browser/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });

  it('calls onSplitHorizontal when split-h button is clicked', async () => {
    const user = userEvent.setup();
    const onSplitHorizontal = vi.fn();
    render(<TerminalToolbar {...makeProps({ onSplitHorizontal })} />);

    await user.click(screen.getByRole('button', { name: /split horizontal/i }));
    expect(onSplitHorizontal).toHaveBeenCalledTimes(1);
  });

  it('calls onSplitVertical when split-v button is clicked', async () => {
    const user = userEvent.setup();
    const onSplitVertical = vi.fn();
    render(<TerminalToolbar {...makeProps({ onSplitVertical })} />);

    await user.click(screen.getByRole('button', { name: /split vertical/i }));
    expect(onSplitVertical).toHaveBeenCalledTimes(1);
  });

  it('calls onAutoSplit when auto-split button is clicked', async () => {
    const user = userEvent.setup();
    const onAutoSplit = vi.fn();
    render(<TerminalToolbar {...makeProps({ onAutoSplit })} />);

    await user.click(screen.getByRole('button', { name: /auto split/i }));
    expect(onAutoSplit).toHaveBeenCalledTimes(1);
  });

  it('calls onOpenBrowser when browser button is clicked', async () => {
    const user = userEvent.setup();
    const onOpenBrowser = vi.fn();
    render(<TerminalToolbar {...makeProps({ onOpenBrowser })} />);

    await user.click(screen.getByRole('button', { name: /open browser/i }));
    expect(onOpenBrowser).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when close button is clicked', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<TerminalToolbar {...makeProps({ onClose })} />);

    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('rename flow', () => {
    it('enters edit mode on double-click of name', async () => {
      const user = userEvent.setup();
      render(<TerminalToolbar {...makeProps()} />);

      await user.dblClick(screen.getByText('Terminal 1'));
      expect(screen.getByRole('textbox')).toBeInTheDocument();
      expect(screen.getByRole('textbox')).toHaveValue('Terminal 1');
    });

    it('commits rename on Enter', async () => {
      const user = userEvent.setup();
      const onRename = vi.fn();
      render(<TerminalToolbar {...makeProps({ onRename })} />);

      await user.dblClick(screen.getByText('Terminal 1'));
      const input = screen.getByRole('textbox');
      await user.clear(input);
      await user.type(input, 'My Shell{Enter}');

      expect(onRename).toHaveBeenCalledWith('My Shell');
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    });

    it('cancels rename on Escape', async () => {
      const user = userEvent.setup();
      const onRename = vi.fn();
      render(<TerminalToolbar {...makeProps({ onRename })} />);

      await user.dblClick(screen.getByText('Terminal 1'));
      const input = screen.getByRole('textbox');
      await user.clear(input);
      await user.type(input, 'New Name{Escape}');

      expect(onRename).not.toHaveBeenCalled();
      expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
      expect(screen.getByText('Terminal 1')).toBeInTheDocument();
    });

    it('commits rename on blur', async () => {
      const user = userEvent.setup();
      const onRename = vi.fn();
      render(<TerminalToolbar {...makeProps({ onRename })} />);

      await user.dblClick(screen.getByText('Terminal 1'));
      const input = screen.getByRole('textbox');
      await user.clear(input);
      await user.type(input, 'Blurred Name');
      await user.tab(); // triggers blur

      expect(onRename).toHaveBeenCalledWith('Blurred Name');
    });

    it('rejects empty name on Enter (keeps original)', async () => {
      const user = userEvent.setup();
      const onRename = vi.fn();
      render(<TerminalToolbar {...makeProps({ onRename })} />);

      await user.dblClick(screen.getByText('Terminal 1'));
      const input = screen.getByRole('textbox');
      await user.clear(input);
      await user.keyboard('{Enter}');

      expect(onRename).not.toHaveBeenCalled();
      expect(screen.getByText('Terminal 1')).toBeInTheDocument();
    });

    it('rejects whitespace-only name on Enter', async () => {
      const user = userEvent.setup();
      const onRename = vi.fn();
      render(<TerminalToolbar {...makeProps({ onRename })} />);

      await user.dblClick(screen.getByText('Terminal 1'));
      const input = screen.getByRole('textbox');
      await user.clear(input);
      await user.type(input, '   {Enter}');

      expect(onRename).not.toHaveBeenCalled();
    });
  });

  it('stops event propagation on toolbar click', async () => {
    const user = userEvent.setup();
    const parentHandler = vi.fn();
    render(
      <div onClick={parentHandler}>
        <TerminalToolbar {...makeProps()} />
      </div>,
    );

    await user.click(screen.getByRole('button', { name: /close/i }));
    expect(parentHandler).not.toHaveBeenCalled();
  });

  it('applies active tab styling when isActive', () => {
    const { container } = render(<TerminalToolbar {...makeProps({ isActive: true })} />);
    const toolbar = container.firstChild as HTMLElement;
    expect(toolbar.style.backgroundColor).toBe('rgb(30, 30, 46)');
  });

  it('applies inactive tab styling when not active', () => {
    const { container } = render(<TerminalToolbar {...makeProps({ isActive: false })} />);
    const toolbar = container.firstChild as HTMLElement;
    expect(toolbar.style.backgroundColor).toBe('rgb(24, 24, 37)');
  });
});
