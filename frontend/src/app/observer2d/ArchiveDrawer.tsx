import type { ReactNode } from "react";
import { History } from "lucide-react";
import { formatWorldTime, type ArchiveCatalogueView } from "./publicViewModels";

export interface ArchiveDrawerProps {
  readonly view: ArchiveCatalogueView;
  readonly archiveBound: boolean;
  readonly onEnterCheckpoint: (checkpointKey: string) => void;
  readonly onLoadOlder: () => void;
  readonly onReturnLive: () => void;
  readonly onClose: () => void;
  readonly controls?: ReactNode;
}

/** Bounded checkpoint chooser; historical world rendering stays in the one bound Stage. */
export function ArchiveDrawer({
  view,
  archiveBound,
  onEnterCheckpoint,
  onLoadOlder,
  onReturnLive,
  onClose,
  controls,
}: ArchiveDrawerProps) {
  return (
    <section className="observer-panel observer-drawer observer-drawer--quiet archive-drawer"
      aria-labelledby="archive-drawer-heading">
      <header className="observer-drawer__header">
        <div className="observer-drawer__title">
          <h2 id="archive-drawer-heading" tabIndex={-1}>Archive</h2>
          <p className="observer-drawer__subtitle">Revisit preserved moments from the world.</p>
        </div>
        <button type="button" aria-label="Close Archive" onClick={onClose}>Close</button>
      </header>
      <div className="observer-drawer__scroll">
        {controls === undefined ? null : <details className="observer-drawer__camera observer-drawer__camera--collapsible">
          <summary>Camera &amp; playback</summary>
          {controls}
        </details>}
        {archiveBound && <button type="button" className="archive-drawer__return"
          onClick={onReturnLive}>Return to Live</button>}
        {view.state === "loading" && (
          <div className="observer-drawer__empty archive-drawer__state">
            <p aria-busy="true">Reading the archive…</p>
          </div>
        )}
        {view.state === "empty" && (
          <div className="observer-drawer__empty archive-drawer__state">
            <strong>No shown moments are available.</strong>
            <p>The archive will keep any moments the observer can return to.</p>
          </div>
        )}
        {view.state === "error" && (
          <div className="observer-drawer__empty archive-drawer__state">
            <p role="alert">{view.message}</p>
          </div>
        )}
        {view.state === "ready" && <>
          <div className="archive-drawer__intro">
            <p>Choose a preserved moment to revisit what the world was showing.</p>
            <span className="archive-drawer__count">
              {view.checkpoints.length} {view.checkpoints.length === 1 ? "moment" : "moments"} shown
            </span>
          </div>
          <ol className="archive-drawer__checkpoints">
            {view.checkpoints.map((checkpoint) => <li key={checkpoint.key}>
              <button type="button"
                className={`archive-drawer__checkpoint${checkpoint.selected ? " is-selected" : ""}`}
                aria-label={`Enter ${checkpoint.label}`}
                aria-pressed={checkpoint.selected}
                onClick={() => onEnterCheckpoint(checkpoint.key)}>
                <span className="archive-drawer__checkpoint-icon" aria-hidden="true">
                  <History size={18} strokeWidth={1.8} aria-hidden="true" focusable="false" />
                </span>
                <span className="archive-drawer__checkpoint-title">
                  <strong>{checkpoint.label}</strong>
                  {checkpoint.selected && <span className="archive-drawer__badge">Viewing</span>}
                </span>
                <span className="archive-drawer__time">{formatWorldTime(checkpoint.worldTime)}</span>
                <span className="archive-drawer__reason">{checkpoint.reason}</span>
                <span className="archive-drawer__cursor">Through event {checkpoint.eventCursor}</span>
              </button>
            </li>)}
          </ol>
          {view.hasMore && <button type="button" className="archive-drawer__more"
            onClick={onLoadOlder}>Load older moments</button>}
        </>}
      </div>
    </section>
  );
}
