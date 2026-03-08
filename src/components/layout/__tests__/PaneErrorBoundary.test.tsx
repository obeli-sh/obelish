import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import React from 'react';
import { PaneErrorBoundary } from '../PaneErrorBoundary';

function ThrowingChild({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) {
    throw new Error('Test error message');
  }
  return <div data-testid="child-content">Child rendered</div>;
}

describe('PaneErrorBoundary', () => {
  // Suppress console.error for expected error boundary triggers
  const originalError = console.error;
  beforeEach(() => {
    console.error = vi.fn();
  });
  afterEach(() => {
    console.error = originalError;
  });

  it('renders children normally when no error', () => {
    render(
      <PaneErrorBoundary paneId="pane-1" onClose={vi.fn()}>
        <div data-testid="child">Hello</div>
      </PaneErrorBoundary>
    );

    expect(screen.getByTestId('child')).toBeInTheDocument();
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('catches error and shows error message', () => {
    render(
      <PaneErrorBoundary paneId="pane-1" onClose={vi.fn()}>
        <ThrowingChild shouldThrow={true} />
      </PaneErrorBoundary>
    );

    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();
    expect(screen.getByText('Test error message')).toBeInTheDocument();
  });

  it('shows Restart button that resets error state', async () => {
    const user = userEvent.setup();

    // Use a flag to control whether the child throws
    let shouldThrow = true;
    function ConditionalThrower() {
      if (shouldThrow) throw new Error('Boom');
      return <div data-testid="child-content">Recovered</div>;
    }

    render(
      <PaneErrorBoundary paneId="pane-1" onClose={vi.fn()}>
        <ConditionalThrower />
      </PaneErrorBoundary>
    );

    expect(screen.getByText('Boom')).toBeInTheDocument();
    const restartButton = screen.getByRole('button', { name: /restart/i });
    expect(restartButton).toBeInTheDocument();

    // Stop throwing so child will render on re-mount
    shouldThrow = false;

    await user.click(restartButton);

    expect(screen.getByTestId('child-content')).toBeInTheDocument();
    expect(screen.getByText('Recovered')).toBeInTheDocument();
  });

  it('shows Close button that calls onClose', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();

    render(
      <PaneErrorBoundary paneId="pane-1" onClose={onClose}>
        <ThrowingChild shouldThrow={true} />
      </PaneErrorBoundary>
    );

    const closeButton = screen.getByRole('button', { name: /close/i });
    expect(closeButton).toBeInTheDocument();

    await user.click(closeButton);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('recovers after restart (children rendered again)', async () => {
    const user = userEvent.setup();

    let shouldThrow = true;
    function ConditionalThrower() {
      if (shouldThrow) throw new Error('Failure');
      return <div data-testid="child-content">Back alive</div>;
    }

    render(
      <PaneErrorBoundary paneId="pane-1" onClose={vi.fn()}>
        <ConditionalThrower />
      </PaneErrorBoundary>
    );

    // Error state
    expect(screen.getByText('Failure')).toBeInTheDocument();
    expect(screen.queryByTestId('child-content')).not.toBeInTheDocument();

    // Fix the child and restart
    shouldThrow = false;
    await user.click(screen.getByRole('button', { name: /restart/i }));

    // Recovery
    expect(screen.queryByText('Failure')).not.toBeInTheDocument();
    expect(screen.getByTestId('child-content')).toBeInTheDocument();
    expect(screen.getByText('Back alive')).toBeInTheDocument();
  });
});
