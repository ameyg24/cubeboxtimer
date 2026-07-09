import { Component } from "react";
import { logger } from "../logger.js";

// Class component: componentDidCatch / getDerivedStateFromError have no hook
// equivalent. Renders fallback(retry, info) in place of children once a
// descendant throws during render; calling retry clears the error and
// remounts children. The caught error and component stack are kept on state
// and passed to fallback (not rendered by CubeBox's own fallback UI - no
// stack traces in the UI - but available for a future diagnostics hook).
export default class ErrorBoundary extends Component {
  state = { hasError: false, error: null, componentStack: null };

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    logger.error("A component crashed while rendering.", {
      boundary: this.props.name || "unnamed",
      error,
      componentStack: info.componentStack,
    });
    this.setState({ componentStack: info.componentStack });
  }

  retry = () => {
    logger.info("Error boundary retry triggered.", { boundary: this.props.name || "unnamed" });
    this.setState({ hasError: false, error: null, componentStack: null });
  };

  render() {
    if (this.state.hasError) {
      return this.props.fallback(this.retry, { error: this.state.error, componentStack: this.state.componentStack });
    }
    return this.props.children;
  }
}

// Shared calm fallback UI for error boundaries - no stack traces, just a short
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
