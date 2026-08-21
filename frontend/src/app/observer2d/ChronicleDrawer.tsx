import type { ChronicleMomentRowView, ChronicleView } from "./publicViewModels";

export interface ChronicleDrawerProps {
  readonly view: ChronicleView;
  readonly onViewMoment: (momentKey: string) => void;
  readonly onOpenArchive: (gap: { readonly firstCursor: number; readonly lastCursor: number }) => void;
  readonly onClose: () => void;
}

/** Single-sheet Chronicle with active, settled, future-neutral, and gap rows. */
export function ChronicleDrawer({ view, onViewMoment, onOpenArchive, onClose }: ChronicleDrawerProps) {
  return (
    <section className="observer-panel observer-drawer chronicle-drawer"
      aria-labelledby="chronicle-drawer-heading">
      <header className="observer-drawer__header">
        <h2 id="chronicle-drawer-heading" tabIndex={-1}>Chronicle</h2>
        <button type="button" aria-label="Close Chronicle" onClick={onClose}>Close</button>
      </header>
      <div className="observer-drawer__scroll">
        {view.now !== null && <article data-chronicle-now className="chronicle-drawer__now">
          <span className="observer-kicker">Now</span>
          <MomentContent row={view.now} />
          {view.now.details !== undefined && <FactList facts={view.now.details} />}
          <button type="button" aria-label={`View shown moment ${view.now.title}`}
            onClick={() => onViewMoment(view.now!.key)}>View moment</button>
        </article>}
        <section aria-labelledby="chronicle-previous-heading">
          <h3 id="chronicle-previous-heading">Previous</h3>
          {[...view.previous].sort((left, right) => left.firstCursor - right.firstCursor).map((row) => (
            <button key={row.key} type="button" data-chronicle-previous
              aria-label={`View shown moment ${row.title}`} onClick={() => onViewMoment(row.key)}>
              <MomentContent row={row} />
            </button>
          ))}
        </section>
        {view.gaps.map((gap) => <section key={`${gap.firstCursor}:${gap.lastCursor}`}
          className="chronicle-drawer__gap" aria-label={gap.chapter === "while-away"
            ? "While you were away" : "The world moved ahead"}>
          <strong>{gap.chapter === "while-away" ? "While you were away" : "The world moved ahead"}</strong>
          <span>Shown range {cursorRange(gap.firstCursor, gap.lastCursor)}</span>
          {gap.archiveAvailable && <button type="button" onClick={() => onOpenArchive(gap)}>
            Open Archive
          </button>}
        </section>)}
        <section aria-labelledby="chronicle-upcoming-heading">
          <h3 id="chronicle-upcoming-heading">Gathering</h3>
          {view.upcoming.map((row) => <article key={row.sequence} data-chronicle-upcoming
            data-urgency={row.urgency}>
            <span aria-hidden="true">◆</span>
            <span>A moment is gathering.</span>
            <span>{row.regionId === null ? "Somewhere unknown" : "A known region"}</span>
          </article>)}
        </section>
      </div>
    </section>
  );
}

function MomentContent({ row }: { readonly row: ChronicleMomentRowView }) {
  return <>
    <span>{cursorRange(row.firstCursor, row.lastCursor)}</span>
    <strong>{row.title}</strong>
    <span>{row.summary}</span>
    {row.regionName !== null && <span>{row.regionName}</span>}
  </>;
}

function FactList({ facts }: { readonly facts: readonly { readonly label: string; readonly value: string }[] }) {
  return <dl>{facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>;
}

function cursorRange(first: number, last: number): string { return first === last ? String(first) : `${first}–${last}`; }
