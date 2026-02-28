import { Component, type ReactNode } from 'react';

interface PaneErrorBoundaryProps {
  paneId: string;
  onClose: () => void;
  children: ReactNode;
}

interface PaneErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class PaneErrorBoundary extends Component<
  PaneErrorBoundaryProps,
  PaneErrorBoundaryState
> {
  constructor(props: PaneErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): PaneErrorBoundaryState {
    return { hasError: true, error };
  }

  private handleRestart = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div data-testid="pane-error-boundary">
          <p>{this.state.error?.message}</p>
          <button onClick={this.handleRestart}>Restart</button>
          <button onClick={this.props.onClose}>Close</button>
        </div>
      );
    }

    return this.props.children;
  }
}
