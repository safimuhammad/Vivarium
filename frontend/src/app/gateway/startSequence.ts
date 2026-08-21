/**
 * Pressing "Let's go live" is not instant, and this module refuses to pretend it is.
 *
 * `POST /api/run/start` answers **202 `starting`** — the process has accepted the
 * conditions, not built the world. Between that answer and the first breath the
 * server has to stand up the regions, the beings, their memory roots and the
 * event stream. The screen therefore waits on `GET /api/run` and enters the
 * observer only when the world itself says `running`.
 *
 * Three honesty rules are encoded here:
 *
 * 1. **`unknown` keeps waiting.** A server whose status vocabulary predates this
 *    contract must not be read as "alive".
 * 2. **A transient poll failure is not a failed launch.** The socket being
 *    unavailable while a world is coming up is expected; only a run of
 *    consecutive failures gives up, and it reports the last real reason.
 * 3. **A long wait is admitted, not hidden.** Past `LAUNCH_PATIENCE_MS` the phase
 *    says so, so the screen can offer a way out instead of spinning forever
 *    behind a confident animation.
 */

import type { RunConfigFieldError, RunLifecycleStatus } from "./runConfig";

/** How long a world may take to come up before the screen says so. */
export const LAUNCH_PATIENCE_MS = 90_000;

/** Consecutive unanswered polls before the launch is called a failure. */
export const LAUNCH_POLL_FAILURE_LIMIT = 6;

const FIRST_POLL_DELAY_MS = 400;
const POLL_BACKOFF = 1.5;
const MAX_POLL_DELAY_MS = 3_000;

/** A launch that has been accepted and is waiting for the world to come up. */
export interface WaitingLaunch {
  readonly kind: "waiting";
  readonly runId: string;
  /** The world's own last word, or `unknown` when it used a vocabulary we lack. */
  readonly status: RunLifecycleStatus;
  /** When the 202 arrived, so elapsed time is measured, never estimated. */
  readonly startedAtMs: number;
  readonly elapsedMs: number;
  readonly polls: number;
  readonly consecutiveFailures: number;
  /** True once the world has taken longer than a world should. */
  readonly patienceExhausted: boolean;
  /** The most recent unanswered poll, kept so a give-up can name its reason. */
  readonly lastFailure: string | null;
  /**
   * The server's non-blocking cautions about the world it just accepted.
   *
   * A bleak configuration is not refused — every being alone, or a land that
   * regenerates below what the roster drains, is a legal world and a viewer's
   * choice to make. The 202 carries the judgement anyway, and this is where a
   * viewer reads it: while the world they chose is being made.
   */
  readonly warnings: readonly string[];
}

/** Where a launch has got to. */
export type LaunchPhase =
  | { readonly kind: "idle" }
  | { readonly kind: "submitting" }
  | WaitingLaunch
  | { readonly kind: "live"; readonly runId: string }
  | {
    readonly kind: "rejected";
    readonly message: string;
    readonly fieldErrors: readonly RunConfigFieldError[];
  }
  | { readonly kind: "failed"; readonly message: string };

/** Something that happened to a launch. */
export type LaunchAction =
  | { readonly kind: "submit" }
  | {
    readonly kind: "accepted";
    readonly runId: string;
    readonly atMs: number;
    readonly warnings: readonly string[];
  }
  | {
    readonly kind: "polled";
    readonly runId: string;
    readonly status: RunLifecycleStatus;
    readonly atMs: number;
  }
  | { readonly kind: "poll-failed"; readonly atMs: number; readonly message: string }
  | {
    readonly kind: "rejected";
    readonly message: string;
    readonly fieldErrors: readonly RunConfigFieldError[];
  }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "reset" };

/** Nothing has been asked for yet. */
export const IDLE_LAUNCH: LaunchPhase = { kind: "idle" };

/**
 * Advances a launch by one thing that happened.
 *
 * Pure: the caller owns the clock and the network and passes in what it saw.
 *
 * @param phase - Where the launch had got to.
 * @param action - What just happened.
 * @returns The new phase; the input is never mutated.
 */
export function reduceLaunch(phase: LaunchPhase, action: LaunchAction): LaunchPhase {
  switch (action.kind) {
    case "reset":
      return IDLE_LAUNCH;
    case "submit":
      return { kind: "submitting" };
    case "rejected":
      return { kind: "rejected", message: action.message, fieldErrors: action.fieldErrors };
    case "failed":
      return { kind: "failed", message: action.message };
    case "accepted":
      return {
        kind: "waiting",
        runId: action.runId,
        status: "starting",
        startedAtMs: action.atMs,
        elapsedMs: 0,
        polls: 0,
        consecutiveFailures: 0,
        patienceExhausted: false,
        lastFailure: null,
        warnings: action.warnings,
      };
    case "polled":
      return reducePolled(phase, action);
    case "poll-failed":
      return reducePollFailed(phase, action);
  }
}

function reducePolled(
  phase: LaunchPhase,
  action: Extract<LaunchAction, { kind: "polled" }>,
): LaunchPhase {
  if (phase.kind !== "waiting") return phase;
  switch (action.status) {
    case "running":
      // The run id is taken from the world, not from the acknowledgement: a
      // start replaces the previous run, and the world is the authority on
      // which one a viewer is about to watch.
      return { kind: "live", runId: action.runId };
    case "failed":
      return { kind: "failed", message: "The world could not be brought up. Nothing is running." };
    case "stopped":
    case "stopping":
      return { kind: "failed", message: "The world ended before it could be watched." };
    case "starting":
    case "unknown":
      return advanceWait(phase, action.atMs, action.status, null);
  }
}

function reducePollFailed(
  phase: LaunchPhase,
  action: Extract<LaunchAction, { kind: "poll-failed" }>,
): LaunchPhase {
  if (phase.kind !== "waiting") return phase;
  if (phase.consecutiveFailures + 1 >= LAUNCH_POLL_FAILURE_LIMIT) {
    return {
      kind: "failed",
      message: `The world stopped answering while it was starting: ${action.message}`,
    };
  }
  return advanceWait(phase, action.atMs, phase.status, action.message);
}

function advanceWait(
  phase: WaitingLaunch,
  atMs: number,
  status: RunLifecycleStatus,
  failure: string | null,
): WaitingLaunch {
  const elapsedMs = Math.max(0, atMs - phase.startedAtMs);
  return {
    ...phase,
    status,
    elapsedMs,
    polls: phase.polls + 1,
    consecutiveFailures: failure === null ? 0 : phase.consecutiveFailures + 1,
    lastFailure: failure,
    patienceExhausted: elapsedMs >= LAUNCH_PATIENCE_MS,
  };
}

/**
 * How long to wait before asking `GET /api/run` again.
 *
 * Fast at first so a world that comes up in a second is entered in a second,
 * then geometric to a ceiling so a slow one is not hammered.
 *
 * @param polls - How many times the run has already been asked.
 */
export function launchPollDelayMs(polls: number): number {
  return Math.min(
    MAX_POLL_DELAY_MS,
    Math.round(FIRST_POLL_DELAY_MS * POLL_BACKOFF ** Math.max(0, polls)),
  );
}
