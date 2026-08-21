import type { ReactNode } from "react";

import type { SelectionView } from "./publicViewModels";

export interface SelectionInspectorProps {
  readonly view: SelectionView | null;
  readonly subjectNavigation?: ReactNode;
  readonly onFocus: (selectionKey: string) => void;
  readonly onClear: () => void;
  readonly onClose: () => void;
}

/** Public, read-only facts for the selection already resolved in the shown frame. */
export function SelectionInspector({
  view,
  subjectNavigation,
  onFocus,
  onClear,
  onClose,
}: SelectionInspectorProps) {
  return (
    <section className="observer-panel observer-drawer selection-inspector"
      aria-labelledby="selection-inspector-heading">
      <header className="observer-drawer__header">
        <h2 id="selection-inspector-heading" tabIndex={-1}>Selection</h2>
        <button type="button" aria-label="Close Selection" onClick={onClose}>Close</button>
      </header>
      <div className="observer-drawer__scroll">
        {subjectNavigation}
        {view === null
          ? <p>No subject selected.</p>
          : <>
          <span className="observer-kicker">{view.subtitle}</span>
          <h3>{view.title}</h3>
          {view.qualifier !== null && <p>{view.qualifier}</p>}
          <dl>{view.facts.map((fact) => <div key={fact.label}><dt>{fact.label}</dt><dd>{fact.value}</dd></div>)}</dl>
          <div className="selection-inspector__observer-actions">
            <button type="button" aria-label={`Focus ${view.title}`}
              onClick={() => onFocus(view.key)}>Focus</button>
            <button type="button" onClick={onClear}>Clear selection</button>
          </div>
          </>}
      </div>
    </section>
  );
}
