import type { ReactNode } from "react";

import type { SelectionView } from "./publicViewModels";

export interface SelectionInspectorProps {
  readonly view: SelectionView | null;
  readonly subjectNavigation?: ReactNode;
  readonly onFocus: (selectionKey: string) => void;
  readonly onClear: () => void;
  readonly onClose: () => void;
  readonly controls?: ReactNode;
}

/** Public, read-only facts for the selection already resolved in the shown frame. */
export function SelectionInspector({
  view,
  subjectNavigation,
  onFocus,
  onClear,
  onClose,
  controls,
}: SelectionInspectorProps) {
  const shortFacts = view?.facts.filter((fact) => fact.value.length <= 100) ?? [];
  const proseFacts = view?.facts.filter((fact) => fact.value.length > 100) ?? [];

  return (
    <section className="observer-panel observer-drawer observer-drawer--quiet selection-inspector"
      aria-labelledby="selection-inspector-heading">
      <header className="observer-drawer__header">
        <div className="observer-drawer__title">
          <h2 id="selection-inspector-heading" tabIndex={-1}>Selection</h2>
          <p className="observer-drawer__subtitle">A closer look at the beings and places here.</p>
        </div>
        <button type="button" aria-label="Close Selection" onClick={onClose}>Close</button>
      </header>
      <div className="observer-drawer__scroll">
        {controls === undefined ? null : <details className="observer-drawer__camera observer-drawer__camera--collapsible">
          <summary>Camera &amp; playback</summary>
          {controls}
        </details>}
        {view === null ? (
          <div className="observer-drawer__empty">
            <strong>No subject selected.</strong>
            <p>Choose a being or place below, or select one in the scene.</p>
          </div>
        ) : (
          <article className="selection-inspector__subject">
            <span className="observer-kicker">{view.subtitle}</span>
            <h3>{view.title}</h3>
            {view.qualifier !== null && <p>{view.qualifier}</p>}
            <div className="selection-inspector__observer-actions">
              <button type="button" aria-label={`Focus ${view.title}`}
                onClick={() => onFocus(view.key)}>Focus</button>
              <button type="button" onClick={onClear}>Clear selection</button>
            </div>
            <dl>{[...shortFacts, ...proseFacts].map((fact) => <div key={fact.label}
              className={fact.value.length > 100 ? "selection-inspector__prose" : undefined}>
              <dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>
          </article>
        )}
        <section className="selection-inspector__browse" aria-label="Browse visible subjects">
          {subjectNavigation}
        </section>
      </div>
    </section>
  );
}
