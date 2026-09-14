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
import type { RunConfig, RunDefaults } from "./runConfig";
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
  /** Set only on the way back from a run this viewer ended; cleared on the way out. */
  const [endedNote, setEndedNote] = useState<string | null>(null);
  const nowRef = useRef(now);
  nowRef.current = now;

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
    dispatch({ kind: "reset" });
    setDefaultsState({ kind: "idle" });
    setView("landing");
    setEndedNote(RUN_ENDED_NOTE);
  }, []);

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

  if (view === "observing" && launch.kind === "live") {
    return renderObserver !== undefined
      ? <>{renderObserver(launch.runId, returnToGateway)}</>
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
      onConfigure={openConfiguration}
      onWatchRecording={() => {
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
