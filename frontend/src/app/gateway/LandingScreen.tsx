/**
 * The first thing anyone sees.
 *
 * It has one job before it has any other: say that this is a never-ending
 * generative artwork and not a game. A viewer who arrives expecting to compete
 * will misread everything that follows — the deliberately thin land, the beings
 * who choose to sit still, the run that ends without a conclusion.
 *
 * Two ways in, recording first. Watching a world that already ran costs nothing,
 * starts nothing, and is the fastest honest answer to "what is this".
 *
 * It is also where a viewer lands when they end a run, so it carries an optional
 * one-line `note` for that homecoming.
 */

import { LANDING_COPY } from "./copy";

export interface LandingScreenProps {
  /** Enters the configuration screen. */
  readonly onConfigure: () => void;
  /** Rejoins the same run after a fresh lifecycle check, when one is running. */
  readonly onReturnToCurrentWorld?: (() => void) | null;
  /** Disables the return action while its click-time lifecycle check is pending. */
  readonly returningToCurrentWorld?: boolean;
  /** Why a discovered world could not be adopted, if a click raced its lifecycle. */
  readonly currentWorldNote?: string | null;
  /** Repeats a failed lifecycle check without changing the run. */
  readonly onRetryCurrentWorld?: (() => void) | null;
  /**
   * Plays a recorded run. `null` when no recording is published, in which case
   * the way in is shown disabled with a reason rather than removed — a viewer
   * should be able to see that this is a thing the piece does.
   */
  readonly onWatchRecording: (() => void) | null;
  /** Why the recording is unavailable, shown when `onWatchRecording` is null. */
  readonly recordingNote?: string;
  /**
   * A line about what just happened, announced on arrival.
   *
   * `null` on a first visit — there is nothing to say. Set when a viewer arrives
   * here from a run they ended, so the world disappearing reads as the thing
   * they asked for rather than as a failure.
   */
  readonly note?: string | null;
}

/** Renders the landing page. */
export function LandingScreen({
  onConfigure,
  onReturnToCurrentWorld = null,
  returningToCurrentWorld = false,
  currentWorldNote = null,
  onRetryCurrentWorld = null,
  onWatchRecording,
  recordingNote,
  note = null,
}: LandingScreenProps) {
  const [watch, configure] = LANDING_COPY.ways;
  return (
    <div className="gateway gateway--landing">
      <main className="landing">
        <section className="landing-plate">
          {note === null ? null : (
            <p className="landing-note" role="status">{note}</p>
          )}
          {currentWorldNote === null ? null : (
            <div className="landing-note" role="status">
              <span>{currentWorldNote}</span>
              {onRetryCurrentWorld === null || onRetryCurrentWorld === undefined ? null : (
                <button type="button" className="landing-note-retry" onClick={onRetryCurrentWorld}>
                  Try again
                </button>
              )}
            </div>
          )}
          <p className="gateway-eyebrow">A world, continuously</p>
          <h1 className="landing-wordmark">{LANDING_COPY.title}</h1>
          <hr className="landing-rule" />
          <p className="landing-standfirst">{LANDING_COPY.standfirst}</p>
          <div className="landing-body">
            {LANDING_COPY.body.map((paragraph) => (
              <p key={paragraph.slice(0, 24)}>{paragraph}</p>
            ))}
          </div>
          <p className="landing-footnote">{LANDING_COPY.footnote}</p>
        </section>

        <section className="landing-ways" aria-label="Ways in">
          {onReturnToCurrentWorld === null || onReturnToCurrentWorld === undefined ? null : (
            <button
              type="button"
              className="landing-way"
              aria-label="Return to current world"
              disabled={returningToCurrentWorld}
              onClick={onReturnToCurrentWorld}
            >
              <p className="gateway-eyebrow">Already running</p>
              <h2 className="landing-way-title">Return to current world</h2>
              <p className="landing-way-blurb">
                A world is already breathing on this machine. Continue watching it.
              </p>
              <span className="landing-way-action">
                {returningToCurrentWorld ? "Checking the world…" : "Return to current world →"}
              </span>
            </button>
          )}
          {watch === undefined ? null : (
            <button
              type="button"
              className="landing-way"
              disabled={onWatchRecording === null}
              onClick={() => onWatchRecording?.()}
            >
              <p className="gateway-eyebrow">Costs nothing</p>
              <h2 className="landing-way-title">{watch.title}</h2>
              <p className="landing-way-blurb">{watch.blurb}</p>
              <span className="landing-way-action">{watch.action} →</span>
              {onWatchRecording === null ? (
                <p className="landing-way-note">
                  {recordingNote ?? "No recording is published on this machine yet."}
                </p>
              ) : null}
            </button>
          )}
          {configure === undefined ? null : (
            <button
              type="button"
              className="landing-way landing-way--primary"
              onClick={onConfigure}
            >
              <p className="gateway-eyebrow">Begins a new world</p>
              <h2 className="landing-way-title">{configure.title}</h2>
              <p className="landing-way-blurb">{configure.blurb}</p>
              <span className="landing-way-action">{configure.action} →</span>
            </button>
          )}
        </section>
      </main>
    </div>
  );
}
