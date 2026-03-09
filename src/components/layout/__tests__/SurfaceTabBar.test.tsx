import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import type { SurfaceInfo } from '../../../lib/workspace-types';
import { SurfaceTabBar } from '../SurfaceTabBar';

const surfaces: SurfaceInfo[] = [
  {
    id: 'surface-1',
    name: 'Surface 1',
    layout: { type: 'leaf', paneId: 'pane-1', ptyId: 'pty-1' },
  },
  {
    id: 'surface-2',
    name: 'Surface 2',
    layout: { type: 'leaf', paneId: 'pane-2', ptyId: 'pty-2' },
  },
  {
    id: 'surface-3',
    name: 'Surface 3',
    layout: { type: 'leaf', paneId: 'pane-3', ptyId: 'pty-3' },
  },
];

describe('SurfaceTabBar', () => {
  const defaultProps = {
    surfaces,
    activeSurfaceId: 'surface-1',
    onSurfaceSelect: vi.fn(),
    onSurfaceCreate: vi.fn(),
    onSurfaceClose: vi.fn(),
  };

  it('renders tabs for each surface', () => {
    render(<SurfaceTabBar {...defaultProps} />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
  });

  it('highlights active tab with aria-selected', () => {
    render(<SurfaceTabBar {...defaultProps} activeSurfaceId="surface-2" />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[2]).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onSurfaceSelect on tab click', async () => {
    const user = userEvent.setup();
    const onSurfaceSelect = vi.fn();

    render(<SurfaceTabBar {...defaultProps} onSurfaceSelect={onSurfaceSelect} />);

    const tabs = screen.getAllByRole('tab');
    await user.click(tabs[1]);
    expect(onSurfaceSelect).toHaveBeenCalledWith('surface-2');
  });

  it('calls onSurfaceCreate on + button click', async () => {
    const user = userEvent.setup();
    const onSurfaceCreate = vi.fn();

    render(<SurfaceTabBar {...defaultProps} onSurfaceCreate={onSurfaceCreate} />);

    const addButton = screen.getByRole('button', { name: /new surface/i });
    await user.click(addButton);
    expect(onSurfaceCreate).toHaveBeenCalledTimes(1);
  });

  it('calls onSurfaceClose on close button click', async () => {
    const user = userEvent.setup();
    const onSurfaceClose = vi.fn();

    render(<SurfaceTabBar {...defaultProps} onSurfaceClose={onSurfaceClose} />);

    const closeButtons = screen.getAllByRole('button', { name: /close/i });
    await user.click(closeButtons[1]);
    expect(onSurfaceClose).toHaveBeenCalledWith('surface-2');
  });

  it('has correct tablist ARIA role', () => {
    render(<SurfaceTabBar {...defaultProps} />);

    expect(screen.getByRole('tablist')).toBeInTheDocument();
  });

  it('has correct tab ARIA roles', () => {
    render(<SurfaceTabBar {...defaultProps} />);

    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    tabs.forEach(tab => {
      expect(tab).toHaveAttribute('role', 'tab');
    });
  });

  it('renders tab names', () => {
    render(<SurfaceTabBar {...defaultProps} />);

    expect(screen.getByText('Surface 1')).toBeInTheDocument();
    expect(screen.getByText('Surface 2')).toBeInTheDocument();
    expect(screen.getByText('Surface 3')).toBeInTheDocument();
  });

  it('prevents default on middle mouse button mouseDown on close button', () => {
    render(<SurfaceTabBar {...defaultProps} />);

    const closeButtons = screen.getAllByRole('button', { name: /close/i });
    const event = new MouseEvent('mousedown', { bubbles: true, button: 1 });
    const preventDefault = vi.spyOn(event, 'preventDefault');
    const stopPropagation = vi.spyOn(event, 'stopPropagation');

    closeButtons[0].dispatchEvent(event);

    expect(preventDefault).toHaveBeenCalled();
    expect(stopPropagation).toHaveBeenCalled();
  });

  it('does not prevent default on non-middle mouseDown on close button', () => {
    render(<SurfaceTabBar {...defaultProps} />);

    const closeButtons = screen.getAllByRole('button', { name: /close/i });
    const event = new MouseEvent('mousedown', { bubbles: true, button: 0 });
    const preventDefault = vi.spyOn(event, 'preventDefault');

    closeButtons[0].dispatchEvent(event);

    expect(preventDefault).not.toHaveBeenCalled();
  });

  it('calls onSurfaceClose on middle-click (auxclick) on close button', () => {
    const onSurfaceClose = vi.fn();
    render(<SurfaceTabBar {...defaultProps} onSurfaceClose={onSurfaceClose} />);

    const closeButtons = screen.getAllByRole('button', { name: /close/i });

    // auxclick with button=1 (middle click)
    const event = new MouseEvent('auxclick', { bubbles: true, button: 1 });
    vi.spyOn(event, 'preventDefault');
    vi.spyOn(event, 'stopPropagation');

    closeButtons[1].dispatchEvent(event);

    expect(onSurfaceClose).toHaveBeenCalledWith('surface-2');
  });

  it('does not close on non-middle auxclick on close button', () => {
    const onSurfaceClose = vi.fn();
    render(<SurfaceTabBar {...defaultProps} onSurfaceClose={onSurfaceClose} />);

    const closeButtons = screen.getAllByRole('button', { name: /close/i });

    // auxclick with button=2 (right click) - should early return
    const event = new MouseEvent('auxclick', { bubbles: true, button: 2 });
    closeButtons[0].dispatchEvent(event);

    expect(onSurfaceClose).not.toHaveBeenCalled();
  });
});
