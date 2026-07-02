import { Component } from "react";

// Class component: componentDidCatch / getDerivedStateFromError have no hook
// equivalent. Renders fallback(retry) in place of children once a descendant
// throws during render; calling retry clears the error and remounts children.
export default class ErrorBoundary extends Component {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error("CubeBox: a component crashed while rendering.", error, info.componentStack);
  }

  retry = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      return this.props.fallback(this.retry);
    }
    return this.props.children;
  }
}

// Shared calm fallback UI for error boundaries — no stack traces, just a short
// message and a way forward. `compact` fits it inside a smaller slot such as
// a dashboard panel rather than the full page.
export function ErrorFallback({
  title,
  message,
  onRetry,
  retryLabel = "Try again",
  secondaryAction,
  compact = false,
}) {
  return (
    <div role="alert" className={compact ? "section-card error-fallback" : "empty-state error-fallback"}>
      <svg aria-hidden="true" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="9" />
        <line x1="12" y1="8" x2="12" y2="13" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
      <p className="empty-title">{title}</p>
      <p className="empty-sub">{message}</p>
      <div style={{ display: "flex", gap: 8 }}>
        <button className="dash-btn" onClick={onRetry}>{retryLabel}</button>
        {secondaryAction && (
          <button className="dash-btn" onClick={secondaryAction.onClick}>{secondaryAction.label}</button>
        )}
      </div>
    </div>
  );
}
