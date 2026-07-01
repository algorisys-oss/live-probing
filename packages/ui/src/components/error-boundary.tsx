import { Component, type ReactNode } from "react";

// Keeps one crashing view from unmounting the whole app. Wrap the routes and key it by
// pathname so navigating to another page resets it.
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="empty-hint error-text">
          Something went wrong rendering this view.
          <br />
          <span className="muted">{this.state.error.message}</span>
        </div>
      );
    }
    return this.props.children;
  }
}
