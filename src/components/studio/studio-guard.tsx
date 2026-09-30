import { Component, type ReactNode } from "react";

export class StudioGuard extends Component<{ children: ReactNode }, { err: string | null }> {
  state = { err: null as string | null };

  static getDerivedStateFromError(error: Error) {
    return { err: error.message || "Something broke in the studio." };
  }

  componentDidCatch() {
    /* keep the rest of the app up */
  }

  render() {
    if (this.state.err) {
      return (
        <div className="flex h-full min-h-0 flex-col items-start justify-center gap-3 bg-bg p-6">
          <p className="text-sm text-fg">The studio hit a snag and recovered.</p>
          <p className="max-w-md text-xs text-muted">{this.state.err}</p>
          <button
            type="button"
            className="rounded-lg bg-accent px-3 py-1.5 text-sm text-accent-fg"
            onClick={() => this.setState({ err: null })}
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
