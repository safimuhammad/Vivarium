import type { Page } from "@playwright/test";

import type { ProductionChronicleFixture } from "./production-chronicle-fixture";

const EPOCHS = Object.freeze([
  Object.freeze({ firstCursor: 1, lastCursor: 1_024 }),
  Object.freeze({ firstCursor: 1_026, lastCursor: 2_048 }),
  Object.freeze({ firstCursor: 2_049, lastCursor: 3_072 }),
  Object.freeze({ firstCursor: 3_073, lastCursor: 4_096 }),
]);

export type C16ManualCapturePhase =
  | "waiting-recovery"
  | "ready-hold"
  | "waiting-active-seed"
  | "paused-before-pressure"
  | "paused-pressure"
  | "complete";

export interface C16ManualCaptureScenarioSnapshot {
  readonly phase: C16ManualCapturePhase;
  readonly authoritativeCursor: number;
  readonly completed: boolean;
  readonly dispatchedEpochs: number;
  readonly pausedWitnesses: number;
  readonly pausedReadyFrames: number;
  readonly pausedLagFrames: number;
  readonly epochReadyCursors: readonly number[];
  readonly epochReadyFrames: readonly Readonly<{
    cursor: number;
    frameIndex: number;
    activeSceneCount: number;
    pendingMoments: number;
  }>[];
}

export interface C16ManualCaptureScenario {
  readonly targetCursor: 4_096;
  start(): Promise<void>;
  step(frameIndex: number): Promise<void>;
  snapshot(): C16ManualCaptureScenarioSnapshot;
  epochReady(frameIndex: number): boolean;
}

interface VisibleRecoveryState {
  readonly presentedCursor: number;
  readonly ingestedCursor: number;
  readonly recoveryStatus: string;
  readonly paused: boolean;
  readonly activeStreams: number;
  readonly canvasLastCursor: number;
  readonly identitiesMatch: boolean;
  readonly acceptedCount: number;
  readonly inFlightCount: number;
  readonly waiterCount: number;
  readonly activeSceneCount: number;
  readonly pendingMoments: number;
  readonly settlementSceneTokenPresent: boolean;
}

/** Creates the milestone-gated four-epoch C16 ManualPresentationClock scenario. */
export function createC16ManualCaptureScenario(
  page: Page,
  fixture: ProductionChronicleFixture,
): C16ManualCaptureScenario {
  if (fixture.manifest.id !== "C16" || fixture.manifest.expectedFinalCursor !== 4_096) {
    throw new Error("C16 ManualClock scenario requires the exact C16 terminal cursor 4096");
  }
  let phase: C16ManualCapturePhase = "waiting-recovery";
  let authoritativeCursor = 0;
  let nextEpochIndex = 0;
  let dispatchedEpochs = 0;
  let pausedWitnesses = 0;
  let pausedReadyFrames = 0;
  let pausedLagFrames = 0;
  let phaseStartedFrame: number | null = null;
  const epochReadyCursors: number[] = [];
  const epochReadyFrames: Array<Readonly<{
    cursor: number;
    frameIndex: number;
    activeSceneCount: number;
    pendingMoments: number;
  }>> = [];
  let readyHoldFrame: number | null = null;
  let lastFrameIndex = -1;
  let started = false;

  const snapshot = (): C16ManualCaptureScenarioSnapshot => Object.freeze({
    phase,
    authoritativeCursor,
    completed: phase === "complete",
    dispatchedEpochs,
    pausedWitnesses,
    pausedReadyFrames,
    pausedLagFrames,
    epochReadyCursors: Object.freeze([...epochReadyCursors]),
    epochReadyFrames: Object.freeze(epochReadyFrames.map((value) => Object.freeze({ ...value }))),
  });

  const dispatchNextEpoch = async (): Promise<void> => {
    const epoch = EPOCHS[nextEpochIndex];
    if (epoch === undefined) throw new Error("C16 ManualClock scenario has no remaining epoch");
    await fixture.dispatchRange(epoch.firstCursor, epoch.lastCursor, {
      completion: "bounded-prefix",
    });
    authoritativeCursor = epoch.lastCursor;
    nextEpochIndex += 1;
    dispatchedEpochs += 1;
  };

  return Object.freeze({
    targetCursor: 4_096 as const,
    async start(): Promise<void> {
      if (started) throw new Error("C16 ManualClock scenario may start only once");
      started = true;
      await dispatchNextEpoch();
    },
    async step(frameIndex: number): Promise<void> {
      if (!started) throw new Error("C16 ManualClock scenario must start before stepping");
      if (!Number.isSafeInteger(frameIndex) || frameIndex < 0 || frameIndex <= lastFrameIndex) {
        throw new Error("C16 ManualClock scenario frames must increase monotonically");
      }
      lastFrameIndex = frameIndex;
      if (phase === "complete") return;

      const visible = await visibleRecoveryState(page);
      const ledger = await fixture.virtualSseLedger();
      const latestOpenCursor = ledger.filter(({ kind }) => kind === "open").at(-1)?.cursor ?? -1;
      if (phase === "ready-hold") {
        if (readyHoldFrame === null || frameIndex <= readyHoldFrame) return;
        if (!isRecoveredMilestone(visible, latestOpenCursor, authoritativeCursor)) {
          throw new Error("C16 epoch-ready hold lost its exact recovered milestone");
        }
        if (nextEpochIndex >= EPOCHS.length) {
          phase = "complete";
          return;
        }
        if (nextEpochIndex === 1) {
          await fixture.dispatchRange(1_025, 1_025, { completion: "bounded-prefix" });
          authoritativeCursor = 1_025;
          phaseStartedFrame = frameIndex;
          phase = "waiting-active-seed";
          return;
        }
        await dispatchNextEpoch();
        phase = "waiting-recovery";
        return;
      }
      if (phase === "waiting-active-seed") {
        const activeSeedReady = (
          visible.ingestedCursor !== 1_025
          || visible.presentedCursor !== 1_024
          || visible.activeSceneCount !== 1
          || visible.activeStreams !== 1
          || visible.canvasLastCursor !== 1_025
          || !visible.identitiesMatch
          || !visible.settlementSceneTokenPresent
        ) === false;
        if (!activeSeedReady) {
          if (phaseStartedFrame !== null && frameIndex - phaseStartedFrame >= 5) {
            throw new Error(`C16 active seed did not reach an accepted settlement: ${JSON.stringify(visible)}`);
          }
          return;
        }
        await page.getByRole("button", { name: "Pause story" }).click();
        phaseStartedFrame = frameIndex;
        phase = "paused-before-pressure";
        return;
      }
      if (phase === "paused-before-pressure") {
        if (phaseStartedFrame === null) throw new Error("C16 paused-ready frame is unavailable");
        if (
          !visible.paused
          || visible.presentedCursor !== 1_024
          || visible.activeStreams !== 1
        ) {
          throw new Error("C16 pre-pressure hold must remain paused on ready cursor 1024");
        }
        pausedReadyFrames = frameIndex - phaseStartedFrame;
        if (pausedReadyFrames < 2) return;
        await dispatchNextEpoch();
        phaseStartedFrame = frameIndex;
        phase = "paused-pressure";
        return;
      }
      if (phase === "paused-pressure") {
        if (phaseStartedFrame === null) throw new Error("C16 paused-pressure frame is unavailable");
        if (
          visible.paused
          || visible.presentedCursor >= 1_025
          || visible.ingestedCursor <= visible.presentedCursor
          || visible.activeStreams !== 0
          || visible.recoveryStatus !== "waiting-safe-boundary"
          || !visible.identitiesMatch
        ) {
          throw new Error(`C16 recovery pressure witness must remain visibly lagged with a closed stream: ${JSON.stringify(visible)}`);
        }
        pausedLagFrames = frameIndex - phaseStartedFrame;
        if (pausedLagFrames < 2) return;
        pausedWitnesses = 1;
        // Recovery auto-unpauses its active scene so subsequent ManualClock ticks
        // can reach the safe boundary without a second public control action.
        phase = "waiting-recovery";
        return;
      }

      if (!isRecoveredMilestone(visible, latestOpenCursor, authoritativeCursor)) return;
      epochReadyCursors.push(authoritativeCursor);
      epochReadyFrames.push(Object.freeze({
        cursor: authoritativeCursor,
        frameIndex,
        activeSceneCount: visible.activeSceneCount,
        pendingMoments: visible.pendingMoments,
      }));
      readyHoldFrame = frameIndex;
      phase = "ready-hold";
    },
    snapshot,
    epochReady(frameIndex: number): boolean {
      return epochReadyFrames.some((value) => value.frameIndex === frameIndex);
    },
  });
}

function isRecoveredMilestone(
  state: VisibleRecoveryState,
  latestOpenCursor: number,
  cursor: number,
): boolean {
  return state.presentedCursor === cursor
    && state.ingestedCursor === cursor
    && state.canvasLastCursor === cursor
    && state.identitiesMatch
    && ["idle", "complete"].includes(state.recoveryStatus)
    && state.activeStreams === 1
    && latestOpenCursor === cursor
    && state.acceptedCount === 0
    && state.inFlightCount === 0
    && state.waiterCount === 0
    && state.activeSceneCount === 0
    && state.pendingMoments === 0;
}

async function visibleRecoveryState(page: Page): Promise<VisibleRecoveryState> {
  return page.evaluate(() => {
    const app = document.querySelector(".vivarium-2d-app");
    const stage = document.querySelector(".presentation-world-stage");
    const accessor = window.__vivariumProductionDiagnosticsForTest;
    const observer = app === null ? null : accessor?.snapshot(app) as any;
    const renderer = stage === null ? null : accessor?.snapshot(stage) as any;
    if (app === null || observer === null || observer === undefined || renderer === null || renderer === undefined) {
      throw new Error("C16 ManualClock scenario requires mounted production diagnostics");
    }
    const identityKey = (identity: any): string => JSON.stringify([
      identity?.runId ?? null,
      identity?.sourceKey ?? null,
      identity?.revision ?? null,
      identity?.firstCursor ?? null,
      identity?.lastCursor ?? null,
    ]);
    return {
      presentedCursor: Number(app.getAttribute("data-presented-cursor")),
      ingestedCursor: Number(observer.session?.ingress?.ingestedCursor ?? -1),
      recoveryStatus: String(observer.session?.recovery?.status ?? "missing"),
      paused: observer.session?.paused === true,
      activeStreams: window.__vivariumChronicleActiveStreams?.() ?? -1,
      canvasLastCursor: Number(renderer.frameIdentity?.lastCursor ?? -1),
      identitiesMatch: identityKey(observer.frameIdentity) === identityKey(renderer.frameIdentity),
      acceptedCount: Number(observer.session?.ingress?.acceptedCount ?? -1),
      inFlightCount: Number(renderer.pool?.inFlightCount ?? -1),
      waiterCount: Number(renderer.pool?.waiterCount ?? -1),
      activeSceneCount: Number(observer.session?.director?.activeSceneCount ?? -1),
      pendingMoments: Number(observer.session?.director?.pendingMoments ?? -1),
      settlementSceneTokenPresent: observer.session?.settlement?.sceneToken !== null
        && observer.session?.settlement?.sceneToken !== undefined,
    };
  });
}
