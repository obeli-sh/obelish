import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
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
