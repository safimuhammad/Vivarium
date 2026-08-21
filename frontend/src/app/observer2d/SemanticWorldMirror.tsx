import {
  memo,
  useSyncExternalStore,
  type ReactElement,
} from "react";

import type {
  SemanticSubjectView,
  SemanticWorldStore,
} from "./semanticWorld";

export interface SemanticWorldMirrorProps {
  readonly store: SemanticWorldStore;
  readonly visuallyHidden?: boolean;
  readonly onSelect: (token: string) => void;
  readonly onFollow: (token: string) => void;
}

/** Public, keyboard-operable mirror of the exact subjects retained by the Canvas graph. */
export const SemanticWorldMirror = memo(function SemanticWorldMirror({
  store,
  visuallyHidden = true,
  onSelect,
  onFollow,
}: SemanticWorldMirrorProps): ReactElement {
  const view = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  return (
    <section className={visuallyHidden
      ? "semantic-world-mirror observer-visually-hidden"
      : "semantic-world-mirror semantic-world-mirror--selection"}
      aria-labelledby="world-subjects-heading">
      <header>
        <h2 id="world-subjects-heading">
          {visuallyHidden ? "World subjects" : "Visible in this region"}
        </h2>
        <span>{view?.subjects.length ?? 0} visible</span>
      </header>
      <p id="world-keyboard-help" className="semantic-world-mirror__help">
        World keyboard controls: S Story, F Follow, V Free, arrow keys pan,
        plus and minus zoom, brackets or Home and End change region, and M views the shown moment.
      </p>
      {view === null || view.subjects.length === 0
        ? <p>Subjects are coming into view.</p>
        : <ul>{view.subjects.map((subject) => (
          <SemanticSubjectRow key={subject.token} subject={subject}
            onSelect={onSelect} onFollow={onFollow} />
        ))}</ul>}
    </section>
  );
});

interface SemanticSubjectRowProps {
  readonly subject: SemanticSubjectView;
  readonly onSelect: (token: string) => void;
  readonly onFollow: (token: string) => void;
}

const SemanticSubjectRow = memo(function SemanticSubjectRow({
  subject,
  onSelect,
  onFollow,
}: SemanticSubjectRowProps): ReactElement {
  const accessibleName = [
    subject.name,
    `Status: ${subject.status}`,
    `Position: ${subject.position}`,
    `Current action: ${subject.currentAction}`,
    subject.selected ? "Selected" : null,
  ].filter((value): value is string => value !== null).join(" ");
  return (
    <li>
      <button type="button" data-subject-token={subject.token}
        aria-label={accessibleName}
        aria-pressed={subject.selected}
        onClick={() => onSelect(subject.token)}
        onKeyDown={(event) => {
          if (event.key.toLowerCase() !== "f") return;
          event.preventDefault();
          onFollow(subject.token);
        }}>
        <strong>{subject.name}</strong>
        <span className="observer-visually-hidden">Status: </span>{subject.status}
        <span className="observer-visually-hidden">Position: </span>{subject.position}
        <span className="observer-visually-hidden">Current action: </span>{subject.currentAction}
        {subject.selected && <span className="semantic-world-mirror__state">Selected</span>}
      </button>
    </li>
  );
});
