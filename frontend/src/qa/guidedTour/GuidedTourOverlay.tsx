import type { ReactElement } from "react";

import type { GuidedTourSnapshot } from "./guidedTourController";

import "./GuidedTour.css";

export interface GuidedTourOverlayProps {
  readonly snapshot: GuidedTourSnapshot;
}

/** On-canvas caption + progress readout for an active guided tour. Renders nothing when inactive. */
export function GuidedTourOverlay({ snapshot }: GuidedTourOverlayProps): ReactElement | null {
  const beat = snapshot.beat;
  if (!snapshot.active || beat === null) return null;
  return (
    <section className="guided-tour-overlay" aria-label="Guided tour" aria-live="polite">
      <p className="guided-tour-overlay__progress">{beat.caption}</p>
      {beat.participants === "" ? null : (
        <p className="guided-tour-overlay__participants">{beat.participants}</p>
      )}
      <p className="guided-tour-overlay__watch-line">{beat.watchLine}</p>
      {snapshot.framingFits ? null : (
        <p className="guided-tour-overlay__framing-note">
          participants are spread wide — not everyone may read clearly at this zoom
        </p>
      )}
      <p className="guided-tour-overlay__status">
        {statusLabel(snapshot)}
        {" — space to pause/resume, → to step (forward only; cursor delivery can't rewind)."}
        {" To go back: uncheck then recheck “Guided tour” to restart from beat 1, then step forward."}
      </p>
    </section>
  );
}

function statusLabel(snapshot: GuidedTourSnapshot): string {
  if (snapshot.done) return "Tour complete";
  return snapshot.playing ? "Playing" : "Paused";
}
