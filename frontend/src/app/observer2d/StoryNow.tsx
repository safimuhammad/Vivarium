import type { ReactElement } from "react";

import type { StoryNowView } from "./publicViewModels";

export interface StoryNowProps {
  readonly view: StoryNowView | null;
  readonly dialogueActive: boolean;
  readonly onViewMoment: (momentKey: string) => void;
}

/** Compact persistent narrative surface for the active or latest presented story beat. */
export function StoryNow({
  view,
  dialogueActive,
  onViewMoment,
}: StoryNowProps): ReactElement | null {
  if (view === null || dialogueActive) return null;
  const headingId = "observer-story-now-heading";
  const checkpoint = view.kind === "checkpoint";
  const title = checkpoint ? view.title : view.moment.title;
  const summary = checkpoint ? view.summary : view.moment.summary;
  const regionName = checkpoint ? view.regionName : view.moment.regionName;
  return (
    <section className="observer-panel story-now" data-story-now
      data-story-kind={view.kind} data-story-state={view.state}
      aria-labelledby={headingId}
      aria-current={view.kind === "moment" && view.state === "active" ? "true" : undefined}>
      <span className="observer-kicker">
        {checkpoint ? "Between moments" : view.state === "active" ? "Now" : "Latest"}
      </span>
      <div className="story-now__copy">
        <h2 id={headingId}>{title}</h2>
        <p className="observer-copy--selectable">{summary}</p>
        {regionName !== null && <span className="story-now__region">{regionName}</span>}
        {checkpoint && view.segmentCount > 1 && <span className="story-now__segment">
          Change {view.segmentIndex + 1} of {view.segmentCount}
        </span>}
      </div>
      {!checkpoint && <button type="button" aria-label={`View shown moment ${title}`}
        onClick={() => onViewMoment(view.moment.key)}>View moment</button>}
    </section>
  );
}
