/**
 * QA HARNESS ROUTE — watch a real recorded run in the production observer.
 *
 * `qa-live-replay.html?src=<base>&rate=<n>` fetches a recording's two JSONL
 * files, mounts the production 2D observer over an offline bridge, and delivers
 * the run at its own recorded wall-clock spacing (times `rate`). Everything from
 * `openEventStream` inward is production code; see `recordedLiveBridge.ts` for
 * the exact list of impersonated seams.
 *
 * It is a dev-only route: it is not one of the built HTML inputs in
 * `vite.config.ts`, so it costs the shipped bundle nothing.
 */

import { createRoot } from "react-dom/client";

import { Vivarium2DApp } from "../../app/Vivarium2DApp";
import { createProductionObserverSession } from "../../app/observer2d/createProductionObserverSession";
import {
  createObserverShellRuntime,
  type ObserverShellRuntime,
  type ObserverShellRuntimeOptions,
} from "../../app/observer2d/observerShellRuntime";
import type { RunLifecycleCapability } from "../../app/observer2d/runStopController";
import type { RunLifecycleStatus } from "../../app/gateway/runConfig";
import {
  createRecordedBridge,
  createReplayDriver,
  inertCheckpointFeed,
  loadRecording,
  type LoadedRecording,
} from "./recordedLiveBridge";

/** Everything a probe driving this page from Playwright needs to read back. */
export interface LiveReplayHandle {
  readonly runId: string;
  readonly events: number;
  readonly spanMs: number;
  readonly rate: number;
  atMs(): number;
  diagnostics(): unknown;
  /** QA fault injection — the four chrome states cannot be produced by data alone. */
  heartbeat(worldTime: number, status?: string): void;
  /** What the stand-in run lifecycle has been asked, in order. */
  runLifecycleCalls(): readonly string[];
  /** What the stand-in `GET /api/run` will answer from now on. */
  setRunStatus(status: string): void;
  dropStream(): void;
  activeStreams(): number;
}

declare global {
  interface Window {
    __vivariumLiveReplay?: LiveReplayHandle;
  }
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`live replay could not read ${url}: ${response.status}`);
  return response.text();
}

async function boot(): Promise<void> {
  const root = document.getElementById("root");
  if (root === null) throw new Error("live replay requires #root");
  const query = new URLSearchParams(window.location.search);
  const base = (query.get("src") ?? "http://127.0.0.1:5178").replace(/\/$/u, "");
  const rate = Number(query.get("rate") ?? "1");
  const runId = query.get("run") ?? "seed";
  const realCheckpoints = query.get("checkpoints") === "1";

  const [eventsText, snapshotsText] = await Promise.all([
    fetchText(`${base}/events.jsonl`),
    fetchText(`${base}/snapshots.jsonl`),
  ]);
  const recording: LoadedRecording = loadRecording({ runId, eventsText, snapshotsText });
  const bridge = createRecordedBridge(recording.run, recording.firstSnapshot);

  let runtime: ObserverShellRuntime | null = null;
  const createRuntime = (options?: ObserverShellRuntimeOptions): ObserverShellRuntime => {
    runtime = createObserverShellRuntime({
      ...options,
      createLiveBundle: () => createProductionObserverSession({
        clientFactory: () => bridge.client,
        // `?checkpoints=1` swaps the probe's inert feed for the REAL one, so a join
        // against a world old enough to have thousands of checkpoints can be
        // measured end to end. Default stays inert (the probe's declared deviation
        // #1) so the story queue is isolated from reconciliation.
        ...(realCheckpoints ? {} : { checkpointFeedFactory: inertCheckpointFeed }),
      }),
    });
    return runtime;
  };

  /**
   * A stand-in for the run lifecycle, so the HUD's "End run" control is on
   * screen and drivable on a route that has no server behind it.
   *
   * It is a QA affordance and nothing more: the observer is granted this
   * capability by whoever owns the run (in production, the gateway), so a QA
   * route that wants to exercise the control has to grant one too. It answers
   * `running` until a stop is asked for, then `stopping`, then `stopped` --
   * the same sequence a real wind-down produces -- which is what lets the
   * chrome's honesty about an ended run be checked by eye.
   */
  const lifecycleCalls: string[] = [];
  let runStatus: RunLifecycleStatus = "running";
  let stopsSeen = 0;
  const runLifecycle: RunLifecycleCapability = {
    async stop() {
      lifecycleCalls.push("stop");
      runStatus = "stopping";
      stopsSeen = 0;
      return { run_id: recording.runId, status: "stopping", warnings: [] };
    },
    async getLifecycle() {
      lifecycleCalls.push("getLifecycle");
      if (runStatus === "stopping") {
        stopsSeen += 1;
        if (stopsSeen >= 2) runStatus = "stopped";
      }
      return { status: runStatus };
    },
  };

  createRoot(root).render(
    <Vivarium2DApp createRuntime={createRuntime} runLifecycle={runLifecycle} />,
  );

  const driver = createReplayDriver({ recording, bridge, rate });
  window.__vivariumLiveReplay = {
    runId: recording.runId,
    events: recording.recorded.entries.length,
    spanMs: recording.recorded.spanMs,
    rate,
    atMs: () => driver.atMs(),
    diagnostics: () => runtime?.diagnostics() ?? null,
    heartbeat: (worldTime, status) => bridge.heartbeat(worldTime, status),
    dropStream: () => bridge.dropStream(),
    activeStreams: () => bridge.activeStreams(),
    runLifecycleCalls: () => [...lifecycleCalls],
    setRunStatus: (status: string) => { runStatus = status as RunLifecycleStatus; },
  };
  // The session opens its stream during `ready`; delivering before that would
  // simply be counted as undelivered.
  window.setTimeout(() => driver.start(), 1_200);
}

void boot().catch((error: unknown) => {
  const root = document.getElementById("root");
  if (root !== null) {
    root.textContent = `live replay failed: ${error instanceof Error ? error.message : String(error)}`;
  }
  throw error;
});
