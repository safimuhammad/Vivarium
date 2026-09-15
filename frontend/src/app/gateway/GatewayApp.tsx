/**
 * The way in, end to end: landing → conditions → a world.
 *
 * This owns the whole pre-observer journey and the one transition that is easy
 * to get wrong. `POST /api/run/start` answers `202 starting`; the world is not
 * up yet. The gateway therefore holds a **waiting** screen that names what is
 * happening, counts the seconds it has actually waited, and enters the observer
 * only once `GET /api/run` reports `running`. It never animates over the gap.
 *
 * The observer it enters is the **chronicle-validated 2D observer**
 * (`Vivarium2DApp`) — the same stack the recorded chronicles are validated
 * against. Before this screen existed, the default route mounted the older
 * Living Atlas, so anyone who pressed live got the unvalidated one.
 *
 * The API client is a seam. `?api=mock` swaps the HTTP client for an in-memory
 * stand-in so the screen is demonstrable and testable before the run-lifecycle
 * endpoints exist.
 *
 * Note what the observer is, here: **a view of this component, not a route**.
 * Nothing navigates when a world opens — the URL is the bare `/` it always was
 * and `view` becomes `observing`. So when the viewer ends that run there is no
 * navigation to undo: coming back to the way in is the same state transition
 * run backwards (owner direction, Safi, during a live test: "end run should
 * bring back to the home selection screen"). It is deliberately a full reset —
 * an idle launch, freshly-read dials — because what follows is a NEW world, not
 * a resumption of the one that just ended.
 */

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { LandingScreen } from "./LandingScreen";
import { RUN_ENDED_NOTE } from "./copy";
import { RunConfigScreen } from "./RunConfigScreen";
import { createHttpRunLifecycleClient, RunStartRejectedError } from "./runLifecycleClient";
import type { RunLifecycleClient } from "./runLifecycleClient";
import { createMockRunLifecycleClient } from "./mockRunLifecycleClient";
import {
  IDLE_LAUNCH,
  launchPollDelayMs,
  reduceLaunch,
  type LaunchPhase,
} from "./startSequence";
import type { RunConfig, RunDefaults, RunLifecycle } from "./runConfig";
import { SavedRunsScreen } from "./SavedRunsScreen";
import { fetchSavedRuns, type SavedRunSummary } from "./savedRunsClient";
import "./gateway.css";

const LazyVivarium2DApp = lazy(async () => {
  const module = await import("../Vivarium2DApp");
  return { default: module.Vivarium2DApp };
});

const LazyRecordedRunObserver = lazy(async () => {
  const module = await import("./RecordedRunObserver");
  return { default: module.RecordedRunObserver };
});

/** Which screen the viewer is on. */
type GatewayView = "landing" | "configuring" | "saved" | "watching" | "observing";

/** How the defaults payload is doing. */
type DefaultsState =
  | { readonly kind: "idle" }
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly defaults: RunDefaults; readonly config: RunConfig }
  | { readonly kind: "error"; readonly message: string };

export interface GatewayAppProps {
  /** The run-lifecycle client; defaults to HTTP, or the mock under `?api=mock`. */
  readonly client?: RunLifecycleClient;
  /** Lists durable recordings from this machine; injected for isolated tests. */
  readonly listRecordings?: () => Promise<readonly SavedRunSummary[]>;
  /** Injected clock, so the waiting screen's elapsed count is testable. */
  readonly now?: () => number;
  /** Injected dice, so the land a test draws is pinned. */
  readonly random?: () => number;
  /**
   * Renders the live observer; injected so a test needs no renderer.
   *
   * The second argument is what the observer calls once the run it is watching
   * is confirmed over — the same callback production hands to `Vivarium2DApp`.
   */
  readonly renderObserver?: (runId: string, onRunEnded: () => void) => ReactNode;
  /** Renders the recorded observer; injected so a test needs no renderer. */
  readonly renderRecording?: (base: string, onExit: () => void) => ReactNode;
}

/** Renders the landing page, the configuration screen, and the way between them. */
export function GatewayApp({
  client,
  listRecordings = fetchSavedRuns,
  now = () => Date.now(),
  random,
  renderObserver,
  renderRecording,
}: GatewayAppProps = {}) {
  const resolvedClient = useMemo(
    () => client ?? defaultClient(),
    [client],
  );
  const [view, setView] = useState<GatewayView>("landing");
  const [defaultsState, setDefaultsState] = useState<DefaultsState>({ kind: "idle" });
  const [launch, dispatch] = useReducer(reduceLaunch, IDLE_LAUNCH);
  const [savedRuns, setSavedRuns] = useState<readonly SavedRunSummary[]>([]);
  const [savedLoading, setSavedLoading] = useState(false);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [savedRevision, setSavedRevision] = useState(0);
  const [chosenRecording, setChosenRecording] = useState<SavedRunSummary | null>(null);
  /** A run adopted from the landing page after a reload, rather than started here. */
  const [adoptedRunId, setAdoptedRunId] = useState<string | null>(null);
  /** The run discovered by the read-only landing probe, when it is still current. */
  const [currentWorldRunId, setCurrentWorldRunId] = useState<string | null>(null);
  /** A truthful explanation when a discovered run changes before it can be reopened. */
  const [currentWorldMessage, setCurrentWorldMessage] = useState<string | null>(null);
  const [rejoiningCurrentWorld, setRejoiningCurrentWorld] = useState(false);
  const [landingProbeRevision, setLandingProbeRevision] = useState(0);
  /** Set only on the way back from a run this viewer ended; cleared on the way out. */
  const [endedNote, setEndedNote] = useState<string | null>(null);
  const nowRef = useRef(now);
  nowRef.current = now;
  const viewRef = useRef<GatewayView>(view);
  viewRef.current = view;
  /** Invalidates a probe or click that belongs to a previous landing state. */
  const lifecycleProbeRef = useRef(0);
  const rejoinAttemptRef = useRef(0);

  /** A pending read must never write into a component that has gone away. */
  useEffect(() => () => {
    lifecycleProbeRef.current += 1;
    rejoinAttemptRef.current += 1;
  }, []);

  /**
   * Discovers an already-running world without changing its lifecycle.
   *
   * This is one read each time the landing page is entered. The landing page
   * never starts polling a world the viewer has not asked to watch; each visit
   * gets one fresh answer, and the button performs a second read before it
   * adopts it.
   */
  useEffect(() => {
    if (view !== "landing") return undefined;
    const probe = ++lifecycleProbeRef.current;
    let live = true;
    void resolvedClient.getLifecycle()
      .then((lifecycle) => {
        if (!live || lifecycleProbeRef.current !== probe || viewRef.current !== "landing") return;
        setCurrentWorldRunId(readableRunningRunId(lifecycle));
        setCurrentWorldMessage(null);
      })
      .catch(() => {
        if (!live || lifecycleProbeRef.current !== probe || viewRef.current !== "landing") return;
        // A socket that is offline is not evidence that a world can be resumed.
        setCurrentWorldRunId(null);
        setCurrentWorldMessage(null);
      });
    return () => {
      live = false;
      rejoinAttemptRef.current += 1;
    };
  }, [landingProbeRevision, resolvedClient, view]);

  useEffect(() => {
    if (view !== "saved") return;
    let live = true;
    setSavedLoading(true);
    setSavedError(null);
    void listRecordings()
      .then((runs) => { if (live) setSavedRuns(runs); })
      .catch((error: unknown) => { if (live) setSavedError(describe(error)); })
      .finally(() => { if (live) setSavedLoading(false); });
    return () => { live = false; };
  }, [listRecordings, savedRevision, view]);

  const openConfiguration = useCallback(() => {
    lifecycleProbeRef.current += 1;
    rejoinAttemptRef.current += 1;
    setCurrentWorldRunId(null);
    setCurrentWorldMessage(null);
    setRejoiningCurrentWorld(false);
    setAdoptedRunId(null);
    setEndedNote(null);
    setView("configuring");
    setDefaultsState((current) => (current.kind === "ready" ? current : { kind: "loading" }));
  }, []);

  /**
   * Comes back from an ended world to the way in.
   *
   * Called by the observer once `GET /api/run` has itself reported the run
   * terminal — never on the local fact that a stop was asked for, so a stop that
   * failed or a world still winding down leaves the viewer with their world.
   *
   * Everything the ended run left behind goes with it: the launch returns to
   * idle (so the waiting screen's poll is not still running, and the dead run's
   * id is not still the one being observed) and the dials go back to unread, so
   * the next world is configured from what the server says now rather than from
   * the sheet the last one was started with.
   */
  const returnToGateway = useCallback((): void => {
    lifecycleProbeRef.current += 1;
    rejoinAttemptRef.current += 1;
    setCurrentWorldRunId(null);
    setCurrentWorldMessage(null);
    setRejoiningCurrentWorld(false);
    setAdoptedRunId(null);
    dispatch({ kind: "reset" });
    setDefaultsState({ kind: "idle" });
    setView("landing");
    setEndedNote(RUN_ENDED_NOTE);
  }, []);

  /**
   * Re-checks the exact run found on mount before entering the observer.
   *
   * The second read is the race boundary: a run may have ended or been replaced
   * while this page sat open. Only the same non-empty run id still reporting
   * `running` is adopted; every other answer leaves the gateway in place.
   */
  const returnToCurrentWorld = useCallback((): void => {
    const expectedRunId = currentWorldRunId;
    if (expectedRunId === null || rejoiningCurrentWorld) return;
    const attempt = ++rejoinAttemptRef.current;
    lifecycleProbeRef.current += 1;
    setRejoiningCurrentWorld(true);
    setCurrentWorldMessage(null);
    void resolvedClient.getLifecycle()
      .then((lifecycle) => {
        if (attempt !== rejoinAttemptRef.current || viewRef.current !== "landing") return;
        if (lifecycle.status === "running" && lifecycle.run_id === expectedRunId) {
          setCurrentWorldRunId(null);
          setCurrentWorldMessage(null);
          setRejoiningCurrentWorld(false);
          setAdoptedRunId(expectedRunId);
          setView("observing");
          return;
        }
        setCurrentWorldRunId(null);
        setRejoiningCurrentWorld(false);
        setCurrentWorldMessage(rejoinFailureMessage(expectedRunId, lifecycle));
      })
      .catch(() => {
        if (attempt !== rejoinAttemptRef.current || viewRef.current !== "landing") return;
        setCurrentWorldRunId(null);
        setRejoiningCurrentWorld(false);
        setCurrentWorldMessage("The current world could not be checked. Try again in a moment.");
      });
  }, [currentWorldRunId, rejoiningCurrentWorld, resolvedClient]);

  /** Retries a failed or raced landing check without starting or stopping a run. */
  const retryCurrentWorld = useCallback((): void => {
    if (viewRef.current !== "landing" || rejoiningCurrentWorld) return;
    lifecycleProbeRef.current += 1;
    rejoinAttemptRef.current += 1;
    setCurrentWorldRunId(null);
    setCurrentWorldMessage(null);
    setLandingProbeRevision((revision) => revision + 1);
  }, [rejoiningCurrentWorld]);

  useEffect(() => {
    if (defaultsState.kind !== "loading") return;
    let live = true;
    void resolvedClient.getDefaults()
      .then((defaults) => {
        if (!live) return;
        setDefaultsState({ kind: "ready", defaults, config: defaults.config });
      })
      .catch((error: unknown) => {
        if (!live) return;
        setDefaultsState({ kind: "error", message: describe(error) });
      });
    return () => { live = false; };
  }, [defaultsState.kind, resolvedClient]);

  const goLive = useCallback(() => {
    if (defaultsState.kind !== "ready") return;
    setAdoptedRunId(null);
    const config = defaultsState.config;
    dispatch({ kind: "submit" });
    void resolvedClient.start(config)
      .then((acknowledgement) => {
        dispatch({
          kind: "accepted",
          runId: acknowledgement.run_id,
          atMs: nowRef.current(),
          warnings: acknowledgement.warnings,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof RunStartRejectedError) {
          dispatch({
            kind: "rejected",
            message: "The world would not start with these conditions.",
            fieldErrors: error.fieldErrors,
          });
          return;
        }
        dispatch({ kind: "failed", message: describe(error) });
      });
  }, [defaultsState, resolvedClient]);

  // Wait honestly: ask the world whether it is up, backing off, until it says so.
  useEffect(() => {
    if (launch.kind !== "waiting") return;
    let live = true;
    const timer = window.setTimeout(() => {
      void resolvedClient.getLifecycle()
        .then((lifecycle) => {
          if (!live) return;
          dispatch({
            kind: "polled",
            runId: lifecycle.run_id,
            status: lifecycle.status,
            atMs: nowRef.current(),
          });
        })
        .catch((error: unknown) => {
          if (!live) return;
          dispatch({ kind: "poll-failed", atMs: nowRef.current(), message: describe(error) });
        });
    }, launchPollDelayMs(launch.polls));
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [launch, resolvedClient]);

  useEffect(() => {
    if (launch.kind === "live") setView("observing");
  }, [launch.kind]);

  if (view === "saved") {
    return <SavedRunsScreen runs={savedRuns} loading={savedLoading} error={savedError}
      onBack={() => setView("landing")} onRefresh={() => setSavedRevision((value) => value + 1)}
      onWatch={(run) => { setChosenRecording(run); setView("watching"); }} />;
  }

  if (view === "watching" && chosenRecording !== null) {
    const returnToSaves = (): void => setView("saved");
    return renderRecording !== undefined
      ? <>{renderRecording(chosenRecording.base_url, returnToSaves)}</>
      : (
        <Suspense fallback={<GatewayLoading label="Reading the recording" />}>
          <LazyRecordedRunObserver base={chosenRecording.base_url} onExit={returnToSaves} />
        </Suspense>
      );
  }

  const observedRunId = launch.kind === "live" ? launch.runId : adoptedRunId;
  if (view === "observing" && observedRunId !== null) {
    return renderObserver !== undefined
      ? <>{renderObserver(observedRunId, returnToGateway)}</>
      : (
        <Suspense fallback={<GatewayLoading label="Opening the world" />}>
          {/*
            The gateway starts a run, so the gateway is what grants the observer
            permission to END one. The observer cannot reach the server by
            itself -- its import closure is proved free of every request verb and
            endpoint -- so without this hand-down the only way to stop a world
            was to kill the process.
          */}
          <LazyVivarium2DApp runLifecycle={resolvedClient} onRunEnded={returnToGateway} />
        </Suspense>
      );
  }

  if (launch.kind === "waiting" || launch.kind === "submitting") {
    return (
      <WaitingScreen
        launch={launch}
        onGiveUp={() => dispatch({ kind: "reset" })}
      />
    );
  }

  if (launch.kind === "failed") {
    return (
      <FailureScreen
        message={launch.message}
        onBack={() => dispatch({ kind: "reset" })}
      />
    );
  }

  if (view === "configuring") {
    if (defaultsState.kind === "ready") {
      return (
        <RunConfigScreen
          defaults={defaultsState.defaults}
          config={defaultsState.config}
          onChange={(config) => setDefaultsState({ ...defaultsState, config })}
          onBack={() => setView("landing")}
          onGoLive={goLive}
          submitting={false}
          fieldErrors={launch.kind === "rejected" ? launch.fieldErrors : []}
          random={random}
        />
      );
    }
    if (defaultsState.kind === "error") {
      return (
        <FailureScreen
          message={
            `The world's own dials could not be read, so this screen will not `
            + `guess at them. ${defaultsState.message}`
          }
          onBack={() => setView("landing")}
          retry={() => setDefaultsState({ kind: "loading" })}
        />
      );
    }
    return <GatewayLoading label="Reading the world's dials" />;
  }

  return (
    <LandingScreen
      note={endedNote}
      currentWorldNote={currentWorldMessage}
      onRetryCurrentWorld={currentWorldMessage === null ? null : retryCurrentWorld}
      onReturnToCurrentWorld={currentWorldRunId === null ? null : returnToCurrentWorld}
      returningToCurrentWorld={rejoiningCurrentWorld}
      onConfigure={openConfiguration}
      onWatchRecording={() => {
        lifecycleProbeRef.current += 1;
        rejoinAttemptRef.current += 1;
        setCurrentWorldRunId(null);
        setCurrentWorldMessage(null);
        setRejoiningCurrentWorld(false);
        setAdoptedRunId(null);
        setEndedNote(null);
        setView("saved");
      }}
    />
  );
}

function WaitingScreen({
  launch,
  onGiveUp,
}: {
  readonly launch: Extract<LaunchPhase, { kind: "waiting" | "submitting" }>;
  readonly onGiveUp: () => void;
}) {
  const waiting = launch.kind === "waiting" ? launch : null;
  const seconds = waiting === null ? 0 : Math.floor(waiting.elapsedMs / 1000);
  return (
    <div className="gateway">
      <main className="waiting">
        <p className="gateway-eyebrow">Not yet</p>
        <h1 className="waiting-title">The world is being made</h1>
        <p className="waiting-note">
          The land is being drawn, the beings are being given their memories, and
          none of them has taken a breath yet. This takes a moment, and it is not
          instant on purpose.
        </p>
        <div className="waiting-pulse" aria-hidden="true">
          <span /><span /><span />
        </div>
        <p className="waiting-clock" aria-live="polite">
          {waiting === null
            ? "Sending the conditions…"
            : `Waiting ${seconds}s · the world says ${waiting.status}`}
        </p>
        {waiting?.lastFailure === null || waiting === null ? null : (
          <p className="waiting-note">
            It stopped answering for a moment: {waiting.lastFailure}. Still waiting.
          </p>
        )}
        {waiting === null || waiting.warnings.length === 0 ? null : (
          // Cautions, not refusals. The world was accepted and is being made;
          // these say what kind of world it is going to be.
          <div className="waiting-warnings">
            <p className="gateway-eyebrow">What this world will be like</p>
            <ul>
              {waiting.warnings.map((warning) => <li key={warning}>{warning}</li>)}
            </ul>
          </div>
        )}
        {waiting?.patienceExhausted === true ? (
          <>
            <p className="waiting-note">
              This is longer than a world usually takes. Nothing has failed —
              it simply has not reported itself running yet.
            </p>
            <div className="waiting-actions">
              <button type="button" className="waiting-action" onClick={onGiveUp}>
                Back to the conditions
              </button>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}

function FailureScreen({
  message,
  onBack,
  retry,
}: {
  readonly message: string;
  readonly onBack: () => void;
  readonly retry?: () => void;
}) {
  return (
    <div className="gateway">
      <main className="waiting">
        <p className="gateway-eyebrow">Nothing is running</p>
        <h1 className="waiting-title">The world did not begin</h1>
        <p className="waiting-failure">{message}</p>
        <div className="waiting-actions">
          <button type="button" className="waiting-action" onClick={onBack}>
            Back
          </button>
          {retry === undefined ? null : (
            <button type="button" className="waiting-action" onClick={retry}>
              Try again
            </button>
          )}
        </div>
      </main>
    </div>
  );
}

function GatewayLoading({ label }: { readonly label: string }) {
  return (
    <div className="gateway">
      <main className="gateway-loading">{label}</main>
    </div>
  );
}

/**
 * Chooses the client from the route.
 *
 * `?api=mock` is the seam that makes this screen demonstrable before the
 * run-lifecycle endpoints exist. It is opt-in and never the default, so a real
 * deployment can only ever talk to a real server.
 */
function defaultClient(): RunLifecycleClient {
  const search = typeof window === "undefined" ? "" : window.location.search;
  return new URLSearchParams(search).get("api") === "mock"
    ? createMockRunLifecycleClient()
    : createHttpRunLifecycleClient();
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readableRunningRunId(lifecycle: RunLifecycle): string | null {
  return lifecycle.status === "running" && lifecycle.run_id.trim().length > 0
    ? lifecycle.run_id
    : null;
}

function rejoinFailureMessage(expectedRunId: string, lifecycle: RunLifecycle): string {
  if (lifecycle.status === "running" && lifecycle.run_id !== expectedRunId) {
    return "The current world changed before it could be reopened.";
  }
  if (lifecycle.status === "starting") {
    return "The current world is still coming to life. Try again in a moment.";
  }
  if (lifecycle.status === "stopping" || lifecycle.status === "stopped" || lifecycle.status === "failed") {
    return "The current world is no longer running.";
  }
  return "The current world could not be confirmed. Try again in a moment.";
}
