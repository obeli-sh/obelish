import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

describe('TerminalToolbar snapshots', () => {
  it('matches snapshot when active', () => {
    const { container } = render(<TerminalToolbar {...makeProps({ isActive: true })} />);
    expect(container).toMatchSnapshot();
  });

  it('matches snapshot when inactive', () => {
    const { container } = render(<TerminalToolbar {...makeProps({ isActive: false })} />);
    expect(container).toMatchSnapshot();
  });
});

describe('TerminalToolbar behavioral', () => {
  it('displays the pane name', () => {
    render(<TerminalToolbar {...makeProps({ name: 'My Terminal' })} />);
    expect(screen.getByText('My Terminal')).toBeInTheDocument();
  });

  it('calls onSplitVertical when split horizontal button is clicked', () => {
    const onSplitVertical = vi.fn();
    render(<TerminalToolbar {...makeProps({ onSplitVertical })} />);
    fireEvent.click(screen.getByLabelText('Split horizontal'));
    expect(onSplitVertical).toHaveBeenCalledOnce();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<TerminalToolbar {...makeProps({ onClose })} />);
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
