/**
 * PRODUCTION GATEWAY — the landing page's "watch a recording" way in.
 *
 * Mounts the production 2D observer (`Vivarium2DApp`) over a `RecordedRunBridge`
 * (`./recordedRunClient`) instead of a real backend, so a visitor can watch a real
 * recorded run with no server anywhere. The wiring below mirrors
 * `src/qa/liveReplay/liveReplayEntry.tsx` lines ~70-95 — the QA harness that
 * proved this exact composition — rebuilt from `./recordedRunClient` so it can
 * live in `main.tsx`'s runtime closure, which must never contain anything under
 * `src/qa/**`.
 *
 * This component owns exactly one job beyond that wiring: it never shows a blank
 * screen. Before the recording is read it renders an honest loading state; if
 * reading or parsing it fails, it renders an honest failure state (and reports
 * the error via `onFailure`) rather than a fake or partially-built world.
 */

import { useEffect, useState, type ReactElement } from "react";
import "./RecordedRunObserver.css";

import { Vivarium2DApp } from "../Vivarium2DApp";
import {
  createProductionObserverSession,
} from "../observer2d/createProductionObserverSession";
import {
  createObserverShellRuntime,
  type ObserverShellRuntime,
  type ObserverShellRuntimeOptions,
} from "../observer2d/observerShellRuntime";
import {
  createRecordedCheckpointFeedHub,
  createRecordedRunBridge,
  createRecordedRunDriver,
  createRecordedReplayArtifactClient,
  fetchRecordedRun,
  type RecordedRun,
} from "./recordedRunClient";

/**
 * Delay before the driver starts delivering, matching `liveReplayEntry.tsx`'s
 * rationale: the presentation session opens its stream during `ready`, so
 * delivering earlier would just be counted as undelivered.
 */
const DRIVER_START_DELAY_MS = 1_200;

export interface RecordedRunObserverProps {
  /** Base URL the recording is served from, e.g. "/recordings/nirvana-run". */
  readonly base: string;
  /** Arrival-rate multiplier passed to the recording driver. Defaults to 1. */
  readonly rate?: number;
  /** Injected loader, so a test never touches the network. */
  readonly load?: (base: string) => Promise<RecordedRun>;
  /** Rendered while the recording is being read, and on failure. */
  readonly onFailure?: (error: unknown) => void;
  readonly onExit?: () => void;
}

type CreateRuntime = (options?: ObserverShellRuntimeOptions) => ObserverShellRuntime;

type LoadState =
  | Readonly<{ status: "loading" }>
  | Readonly<{ status: "ready"; createRuntime: CreateRuntime }>
  | Readonly<{ status: "failed"; message: string }>;

const LOADING_STATE: LoadState = Object.freeze({ status: "loading" });

/** Full-viewport production observer, sourced from a recorded run instead of a live backend. */
export function RecordedRunObserver({
  base,
  rate,
  load = fetchRecordedRun,
  onFailure,
  onExit,
}: RecordedRunObserverProps): ReactElement {
  const [state, setState] = useState<LoadState>(LOADING_STATE);
  const [finished, setFinished] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let releaseResources: (() => void) | null = null;
    setState(LOADING_STATE);
    setFinished(false);

    void load(base).then(
      (recording) => {
        if (cancelled) return;
        const bridge = createRecordedRunBridge(recording.run, recording.firstSnapshot);
        const checkpointFeeds = createRecordedCheckpointFeedHub(recording);
        const driver = createRecordedRunDriver({
          recording, bridge, checkpointFeed: checkpointFeeds, rate,
          onComplete: (worldTime) => {
            if (cancelled) return;
            bridge.heartbeat(worldTime, "stopped");
            setFinished(true);
          },
        });
        const recordedReplayClient = createRecordedReplayArtifactClient(recording);
        const createRuntime: CreateRuntime = (options) => createObserverShellRuntime({
          ...options,
          createLiveBundle: () => createProductionObserverSession({
            clientFactory: () => bridge.client,
            checkpointFeedFactory: () => checkpointFeeds.createFeed(),
          }),
          ...(recordedReplayClient === null
            ? {}
            : { createReplayArtifactClient: () => recordedReplayClient }),
        });
        const timer = window.setTimeout(() => driver.start(), DRIVER_START_DELAY_MS);
        releaseResources = (): void => {
          window.clearTimeout(timer);
          driver.stop();
          checkpointFeeds.dispose();
          bridge.dispose();
        };
        setState({ status: "ready", createRuntime });
      },
      (error: unknown) => {
        if (cancelled) return;
        onFailure?.(error);
        setState({ status: "failed", message: failureMessage(error) });
      },
    );

    return () => {
      cancelled = true;
      releaseResources?.();
    };
    // Deliberately excludes `load`/`onFailure`: they are caller-supplied callbacks,
    // and the recording should be re-fetched only when `base` or `rate` actually
    // change, not whenever a caller passes a structurally-new inline function.
  }, [base, rate]);

  return (
    <div className="recorded-run-shell">
      {onExit && <nav className="recorded-run-navigation" aria-label="Recording navigation">
        <button type="button" onClick={onExit}>← Saved Runs</button>
        <span role="status">{finished ? "Replay finished" : "Replay"}</span>
      </nav>}
      {state.status === "loading" ? (
        <main className="recorded-run-message" aria-busy="true" aria-label="Loading recorded run">
          Loading the recorded run…
        </main>
      ) : state.status === "failed" ? (
        <main className="recorded-run-message" role="alert" aria-label="Recorded run failed to load">
          The recorded run could not be loaded: {state.message}
        </main>
      ) : <Vivarium2DApp createRuntime={state.createRuntime} />}
    </div>
  );
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
