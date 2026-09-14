/**
 * The one reading that tells a watcher whether to keep watching.
 *
 * A live view of this world has to answer a question static chrome cannot: the
 * beings think for minutes at a time, so **silence is normal**. Before this,
 * "the world is thinking", "we are minutes behind", "the socket died" and "the
 * run finished twenty minutes ago" all rendered as the same green LIVE pill.
 *
 * `RunMetadata.status` was parsed (`app/schemas.ts:145`) and read nowhere, and
 * the sim self-terminates at `duration = 1800s` by default — so a finished run
 * looked exactly like beings deep in thought.
 *
 * Nothing here derives from a wall clock. The backend's 15s SSE `heartbeat`
 * carries the fact directly: if the newest thing the stream said was a heartbeat
 * rather than events, the world is connected and has nothing to report. A
 * backend without heartbeats simply never reports `quiet`, which is the honest
 * degradation — it genuinely cannot tell.
 */

import type { PresentedObserverFrame } from "../../presentation/contracts";

export type ObserverLivenessState =
  /** Events are arriving and the stage is level with them. */
  | "live"
  /** Connected; the world has nothing to say. This is the normal case here. */
  | "quiet"
  /** Connected; the stage has not caught up with what has arrived. */
  | "behind"
  /** The transport is not carrying events right now. */
  | "disconnected"
  /** The run finished. Nothing more is coming. */
  | "ended";

export interface ObserverLivenessView {
  readonly state: ObserverLivenessState;
  /** Short, watcher-facing label for the transport pill. */
  readonly label: string;
  /** One sentence a watcher can act on. */
  readonly detail: string;
  /** Whether a reconnect is worth offering. */
  readonly retryable: boolean;
}

/**
 * The run statuses after which nothing more will arrive.
 *
 * `stopped` is the ordinary end — the duration elapsed, or someone pressed stop
 * and the run's `finally` ran. `failed` is the same fact with a worse cause: the
 * run raised and its watcher marked it. Neither can produce another event, so
 * both must outrank every transport reading. `stopping` is deliberately absent:
 * the stop has been asked for, the last breaths are still landing.
 */
const ENDED_RUN_STATUSES: ReadonlySet<string> = new Set(["stopped", "failed"]);

const DISCONNECTED_CONNECTIONS: ReadonlySet<string> = new Set([
  "connecting",
  "rejoining",
  "recovery-paused",
  "offline",
  "error",
]);

/**
 * Reads one frame as a liveness state.
 *
 * Priority is deliberate and runs from most to least terminal: an ended run is
 * ended whatever the socket is doing; a dead socket outranks a backlog, because
 * a backlog behind a dead socket will never drain; a backlog outranks quiet,
 * because a stage with work queued is not silent.
 *
 * @param frame - The presented frame to read.
 * @param confirmedRunStatus - A run status the shell confirmed for itself, from
 *   `GET /api/run`. Takes precedence over the frame's, because the frame's rides
 *   the SSE heartbeat and a run that is stopping takes the stream down with it:
 *   the last status the stream ever reports can therefore be `running`, and
 *   without this a stopped run would sit at "Offline · Reconnecting" forever.
 *   `null`, the ordinary case, changes nothing.
 */
export function resolveObserverLiveness(
  frame: PresentedObserverFrame,
  confirmedRunStatus: string | null = null,
): ObserverLivenessView {
  const runStatus = confirmedRunStatus ?? frame.liveness?.runStatus;
  if (runStatus !== undefined && ENDED_RUN_STATUSES.has(runStatus)) {
    return Object.freeze({
      state: "ended",
      label: "Ended",
      detail: runStatus === "failed"
        ? "This run ended on its own, before it was stopped. Nothing more will arrive."
        : "This run has finished. Nothing more will arrive.",
      retryable: false,
    });
  }
  const connection = frame.transport.connection;
  if (DISCONNECTED_CONNECTIONS.has(connection)) {
    return Object.freeze({
      state: "disconnected",
      label: connection === "recovery-paused" ? "Paused" : "Offline",
      detail: connection === "recovery-paused"
        ? "The world moved further than the stage could follow; rejoining it."
        : "Not receiving the world right now. Reconnecting.",
      retryable: frame.transport.retryable,
    });
  }
  if (frame.backlog.state === "overflow" || frame.backlog.state === "behind") {
    const finishingCurrentMoment = frame.backlog.state === "behind" && frame.backlog.pendingMoments === 0;
    return Object.freeze({
      state: "behind",
      label: finishingCurrentMoment ? "Playing" : "Behind",
      detail: finishingCurrentMoment ? "Finishing the current moment." : `${frame.backlog.pendingMoments} moment${
        frame.backlog.pendingMoments === 1 ? "" : "s"
      } still to play.`,
      retryable: false,
    });
  }
  if (frame.liveness?.lastSignalWasHeartbeat === true) {
    return Object.freeze({
      state: "quiet",
      label: "Quiet",
      detail: "Connected. The beings are thinking; nothing has happened yet.",
      retryable: false,
    });
  }
  return Object.freeze({
    state: "live",
    label: "Live",
    detail: "Watching the world as it happens.",
    retryable: false,
  });
}
