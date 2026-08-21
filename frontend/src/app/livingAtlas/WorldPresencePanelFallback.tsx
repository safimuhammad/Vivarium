export function WorldPresencePanelFallback() {
  return (
    <aside
      className="presence-rail world-presence-frame world-presence-loading"
      data-testid="world-presence-loading"
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="world-presence-loading-mark" aria-hidden="true" />
      <span>Reading the living atlas…</span>
    </aside>
  );
}

export function WorldPresencePanelError({ onRetry }: { onRetry(): void }) {
  return (
    <aside
      className="presence-rail world-presence-frame world-presence-error"
      data-testid="world-presence-error"
      role="alert"
    >
      <span className="world-presence-error-mark" aria-hidden="true" />
      <strong>The living atlas could not be read.</strong>
      <button type="button" onClick={onRetry}>
        Try reading the world again
      </button>
    </aside>
  );
}
