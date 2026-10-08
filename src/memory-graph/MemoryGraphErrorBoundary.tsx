import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  onBack(): void;
}
interface State {
  failed: boolean;
}

/**
 * Failure containment for the Memory visualization. A bad layout or new graph
 * payload must never unmount navigation, Dictation, or the Gemini assistant.
 */
export class MemoryGraphErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error): void {
    // Never log graph payload, account records, or memory text.
    console.error("Memory visualization failed to render:", error.name);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <section className="memory-graph-recovery" role="alert" aria-label="Memory page recovery">
        <h3>Memory couldn't be displayed</h3>
        <p>The visual graph encountered a problem. Your memories are still saved, and the rest of Personal Voice remains available.</p>
        <div className="memory-graph-recovery-actions">
          <button type="button" className="secondary" onClick={() => this.setState({ failed: false })}>
            Try again
          </button>
          <button type="button" onClick={this.props.onBack}>
            Back to Assistant
          </button>
        </div>
      </section>
    );
  }
}
