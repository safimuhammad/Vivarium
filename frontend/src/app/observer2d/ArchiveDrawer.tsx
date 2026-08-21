import type { ArchiveCatalogueView } from "./publicViewModels";

export interface ArchiveDrawerProps {
  readonly view: ArchiveCatalogueView;
  readonly archiveBound: boolean;
  readonly onEnterCheckpoint: (checkpointKey: string) => void;
  readonly onLoadOlder: () => void;
  readonly onReturnLive: () => void;
  readonly onClose: () => void;
}

/** Bounded checkpoint chooser; historical world rendering stays in the one bound Stage. */
export function ArchiveDrawer({
  view,
  archiveBound,
  onEnterCheckpoint,
  onLoadOlder,
  onReturnLive,
  onClose,
}: ArchiveDrawerProps) {
  return (
    <section className="observer-panel observer-drawer archive-drawer"
      aria-labelledby="archive-drawer-heading">
      <header className="observer-drawer__header">
        <h2 id="archive-drawer-heading" tabIndex={-1}>Archive</h2>
        <button type="button" aria-label="Close Archive" onClick={onClose}>Close</button>
      </header>
      {archiveBound && <button type="button" className="archive-drawer__return"
        onClick={onReturnLive}>Return to Live</button>}
      <div className="observer-drawer__scroll">
        {view.state === "loading" && <p aria-busy="true">Reading the archive…</p>}
        {view.state === "empty" && <p>No shown moments are available.</p>}
        {view.state === "error" && <p role="alert">{view.message}</p>}
        {view.state === "ready" && <>
          <ol className="archive-drawer__checkpoints">
            {view.checkpoints.map((checkpoint) => <li key={checkpoint.key}>
              <button type="button" aria-label={`Enter ${checkpoint.label}`}
                aria-pressed={checkpoint.selected}
                onClick={() => onEnterCheckpoint(checkpoint.key)}>
                <strong>{checkpoint.label}</strong>
                <span>World Time {checkpoint.worldTime}</span>
                <span>Shown {checkpoint.eventCursor}</span>
                <span>{checkpoint.reason}</span>
              </button>
            </li>)}
          </ol>
          {view.hasMore && <button type="button" onClick={onLoadOlder}>Load older moments</button>}
        </>}
      </div>
    </section>
  );
}
