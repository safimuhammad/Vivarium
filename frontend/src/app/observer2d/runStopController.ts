/**
 * STOPPING THE RUN — the observer's half of the run lifecycle.
 *
 * The server has answered `POST /api/run/stop` since the gateway was built and
 * nothing in the live view ever called it, so the only way to end a run was to
 * kill the process by hand. This is the seam that fixes that, and its whole
 * design is one rule:
 *
 * **The UI never asserts a state the server has not reported.**
 *
 * A stop is a request, not an outcome — the breathing loops unwind through the
 * runner's shutdown path and a final checkpoint is written, which takes as long
 * as it takes. So this module tracks two separate things and never conflates
 * them: whether a stop has been *asked for* (local, immediate) and what the run
 * *is* (`GET /api/run`, polled). The button may say "Ending…" on the first; only
 * the second is ever allowed to say the run has ended.
 *
 * Polling starts when a stop is asked for and stops the moment a terminal status
 * is confirmed. The SSE heartbeat already carries the run status into the frame
 * for the ordinary case; this exists for the case the heartbeat cannot cover —
 * a stream that closes as the run winds down, leaving the last status it ever
 * reported as "running".
 */

import { useCallback, useEffect, useState } from "react";

import type { RunLifecycleStatus } from "../gateway/runConfig";

/**
 * The only two things the observer may ever do to a run's lifecycle.
 *
 * Deliberately narrower than the gateway's `RunLifecycleClient`, and
 * deliberately **injected**: the observer's own import closure must stay free of
 * every request verb and every endpoint (`Vivarium2DApp.closure.test.ts` proves
 * it recursively), because a view that can reach the server by itself is a view
 * that can change the world it claims only to watch. The composition root that
 * owns the run — the gateway, which already starts it — is what hands this down,
 * and this shape means what it hands down cannot start a run, rewrite a config,
 * or read anything but a status. The gateway's client satisfies it structurally.
 */
export interface RunLifecycleCapability {
  /** Asks the current run to wind down. Resolves when the ask is accepted. */
  stop(): Promise<unknown>;
  /** Reads what the run currently is. */
  getLifecycle(): Promise<{ readonly status: RunLifecycleStatus }>;
}

/** How often the run is asked what it is, once a stop has been requested. */
export const RUN_STOP_POLL_MS = 1_200;

/** Statuses after which nothing more will happen and polling is pointless. */
const TERMINAL: ReadonlySet<RunLifecycleStatus> = new Set(["stopped", "failed"]);

/** Everything the HUD's run control needs, and nothing it does not. */
export interface RunStopController {
  /**
   * The status `GET /api/run` last confirmed, or `null` while nothing has been
   * asked. Never inferred from the fact that a stop was requested.
   */
  readonly confirmedStatus: RunLifecycleStatus | null;
  /** True from the moment a stop is sent until a terminal status is confirmed. */
  readonly requested: boolean;
  /** True only while the `POST` itself is in flight. */
  readonly sending: boolean;
  /** Why the stop could not be sent, in words a watcher can act on. */
  readonly error: string | null;
  /** Sends `POST /api/run/stop` and begins confirming the outcome. */
  readonly requestStop: () => void;
}

export interface RunStopControllerOptions {
  /** False on every seam with no run to stop: recordings, fixtures, capture. */
  readonly enabled: boolean;
  /**
   * The granted capability. Absent means the observer was not given one, which
   * is the ordinary state of every seam that is not watching a live run.
   */
  readonly client?: RunLifecycleCapability;
  /** Poll interval override, for tests. */
  readonly pollMs?: number;
}

/**
 * Owns the stop request and the confirmation that follows it.
 *
 * Side effects: sends one `POST /api/run/stop` per `requestStop()`, then polls
 * `GET /api/run` every `pollMs` until a terminal status is confirmed or the
 * component unmounts. Nothing is sent, and no timer is held, while `enabled` is
 * false or before a stop has been asked for.
 */
export function useRunStopController(options: RunStopControllerOptions): RunStopController {
  const { enabled, client, pollMs = RUN_STOP_POLL_MS } = options;
  const [confirmedStatus, setConfirmedStatus] = useState<RunLifecycleStatus | null>(null);
  const [requested, setRequested] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Poll attempts, counted only so the next one is scheduled.
   *
   * Without it the loop is silently one-shot whenever the answer repeats: the
   * polling effect is keyed on the confirmed status, and `stopping` twice in a
   * row is not a state change, so React never re-runs the effect and the run is
   * never asked again. A run that takes three polls to wind down would have sat
   * at "Ending…" forever.
   */
  const [polls, setPolls] = useState(0);
  const active = enabled && client !== undefined;

  const requestStop = useCallback((): void => {
    if (!active || client === undefined) return;
    setError(null);
    setRequested(true);
    setSending(true);
    void client.stop()
      .then(() => setSending(false))
      .catch((reason: unknown) => {
        setSending(false);
        // A failed stop must NOT leave the control saying "Ending…": the run is
        // still breathing and the viewer has to be able to try again.
        setRequested(false);
        setError(describe(reason));
      });
  }, [active, client]);

  useEffect(() => {
    if (!active || client === undefined || !requested) return undefined;
    if (confirmedStatus !== null && TERMINAL.has(confirmedStatus)) return undefined;
    let live = true;
    const timer = setTimeout(() => {
      void client.getLifecycle()
        .then((lifecycle) => {
          if (live) setConfirmedStatus(lifecycle.status);
        })
        .catch(() => {
          // A poll that cannot be answered says nothing. It is not evidence the
          // run ended, and it is not worth shouting about mid-shutdown -- the
          // server is expected to go quiet here.
        })
        .finally(() => {
          if (live) setPolls((count) => count + 1);
        });
    }, pollMs);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [active, client, confirmedStatus, polls, pollMs, requested]);

  return {
    confirmedStatus,
    requested,
    sending,
    error,
    requestStop,
  };
}

/**
 * The single honest reading of what this run is.
 *
 * Two sources, and the more terminal one wins: the frame's own status (carried
 * by the SSE heartbeat, fresh while the stream is alive) and the status this
 * controller confirmed directly (the only source left once the stream closes).
 * Neither is ever overridden by the local fact that a stop was requested.
 */
export function resolveRunStatus(
  frameStatus: string | null,
  confirmedStatus: RunLifecycleStatus | null,
): RunLifecycleStatus | null {
  const rank = (status: string | null): number => {
    switch (status) {
      case "stopped":
      case "failed": return 3;
      case "stopping": return 2;
      case "running":
      case "starting": return 1;
      default: return 0;
    }
  };
  const winner = rank(confirmedStatus) >= rank(frameStatus) ? confirmedStatus : frameStatus;
  return winner === null || rank(winner) === 0 ? null : (winner as RunLifecycleStatus);
}

function describe(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason);
}
