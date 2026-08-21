import { describe, expect, it, vi } from "vitest";

import type {
  EventStream,
  EventStreamHandlers,
  LiveApiClient,
} from "../app/client";
import type {
  EventEnvelope,
  EventEnvelopeEntry,
  RunMetadata,
  WorldSnapshot,
} from "../app/schemas";
import type { ReplayPresentationWindow } from "../app/replayArtifactClient";
import { makeRun, makeWorld } from "../test/fixtures";
import type { CheckpointFeed } from "./CheckpointFeed";
import type { StoryMoment } from "./BeatDirector";
import type { ClassifiedCheckpointRecord, FrameIdentity, PresentedObserverFrame } from "./contracts";
import { getChronicleManifest } from "./fixtures/chronicleCatalog";
import { createManualPresentationClock } from "./fixtures/ManualPresentationClock";
import type { PresentationClock } from "./storyClock";
import {
  createLegacyArchivePresentationSessionForTests as createArchivePresentationSession,
  createLegacyLivePresentationSessionForTests as createLivePresentationSession,
  createLivePresentationSession as createProductionLivePresentationSession,
  createPresentationSessionBinding,
  createSceneExecutionTokenAllocator,
  isPendingMomentVisible,
  type PresentationSession,
  type PresentationSessionDiagnostics,
} from "./PresentationSession";
import type {
  SceneRuntimePort,
  SceneRuntimeSignal,
  SceneRuntimeStart,
} from "./SceneSettlementCoordinator";
import {
  selectLivingAtlas,
  selectPresentedChronicle,
  selectPresentedDialogue,
  selectPresentedHud,
  selectPresentedSelection,
} from "./selectors";
import { createSceneExecutor } from "./choreography/SceneExecutor";
import { routeDistancePx, WALK_MAX_DISTANCE_PX } from "./choreography/locomotionGate";
import { createRegionMapIdentity } from "../renderer2d/production/maps/RegionMapIdentity";
import { createRegionMapRecipe } from "../renderer2d/production/maps/RegionMapRecipe";
import { PlacementLedger } from "../renderer2d/production/placement/PlacementLedger";
import { createPlacementGenerationOwner } from "../renderer2d/production/placement/PlacementGeneration";
import { createPresentationFrameAcceptanceTracker } from "./PresentationFrameSink";
import type {
  PreparedRecoveryPlacementPort,
  RecoveryDigest,
  RecoveryReason,
} from "./RecoveryCoordinator";
import {
  createCanvasPresentationRenderer,
  type AtlasCommitScheduler,
  type CanvasPresentationRenderer,
} from "../renderer2d/production/CanvasPresentationRenderer";
import {
  createProductionSceneGraph,
  type ProductionSceneGraph,
  type ProductionSceneFactories,
} from "../renderer2d/production/ProductionSceneGraph";
import { LayeredHumanActor } from "../renderer2d/production/actors/LayeredHumanActor";
import {
  PRODUCTION_ASSET_MANIFEST,
  type ProductionAssetLease,
} from "../renderer2d/production/assets/productionManifest";
import type { SharedAtlasPool } from "../renderer2d/production/assets/SharedAtlasPool";
import { EnvironmentSystem } from "../renderer2d/production/environment/EnvironmentSystem";
import { HomeActor } from "../renderer2d/production/homes/HomeActor";
import type { FrameDriver, WakeScheduler } from "../renderer2d/contracts";
import type { ProductionSceneCommandBatch } from "../renderer2d/production/ProductionSceneBridge";

describe("PresentationSession", () => {
  it("allocates distinct session tokens across million-scale locals and repeated recoveries", () => {
    const allocator = createSceneExecutionTokenAllocator();
    expect(allocator.resolve(1, 1_000_001)).toBe(1);
    expect(allocator.resolve(1, 1_000_001)).toBe(1);
    expect(allocator.resolve(2, 1)).toBe(2);
    expect(allocator.resolve(3, 1_000_001)).toBe(3);
    expect(allocator.resolve(4, 1)).toBe(4);
    expect(allocator.resolve(4, null)).toBeNull();
  });
  it("RED: publishes the retained real plan/token through the consequence barrier", async () => {
    const run = makeRun({ run_id: "run-a", seed: 71, event_cursor: 0 });
    const snapshot = makeWorld({ run_id: "run-a", event_cursor: 0 });
    const recipes = new Map(snapshot.regions.map((region) => [
      region.name,
      createRegionMapRecipe(createRegionMapIdentity(run.seed, region, snapshot.regions)),
    ]));
    const placementOwner = createPlacementGenerationOwner([...recipes.values()], snapshot);
    const client = new FakeClient(run, [snapshot]);
    const clock = createManualPresentationClock();
    const feed = new FakeCheckpointFeed();
    const executor = createSceneExecutor();
    const frameAcceptance = createPresentationFrameAcceptanceTracker();
    const trace: string[] = [];
    let session!: ReturnType<typeof createProductionLivePresentationSession>;
    const acknowledge = executor.acknowledgePublishedConsequence.bind(executor);
    vi.spyOn(executor, "acknowledgePublishedConsequence").mockImplementation((...args) => {
      const frame = session.getFrame();
      trace.push(`ack:${args[0]}:${args[1]}:${frame.scene?.phase}:${frame.world.projectedThroughCursor}`);
      acknowledge(...args);
    });
    session = createProductionLivePresentationSession({
      clientFactory: () => client,
      clockFactory: () => clock,
      runtimeFactory: () => executor,
      checkpointFeedFactory: () => feed,
      placementFactory: () => placementOwner,
      choreography: {
        getPlacementOwnerId: () => placementOwner.ownerId,
      },
      frameAcceptance,
    });
    await session.ready;
    expect(session.getPlacementGeneration()).toBe(placementOwner);
    expect(session.getPlacementGeneration()?.current()).toBe(placementOwner.current());
    session.subscribe(() => {
      const frame = session.getFrame();
      frameAcceptance.markAccepted(frame);
      trace.push(`frame:${frame.revision}:${frame.scene?.phase ?? "settled"}:${frame.world.projectedThroughCursor}:${frame.scene?.execution?.sceneToken ?? "none"}`);
    });

    await client.streams[0]!.emit(envelope([staged(1, "Aster speaks once.")], {
      cursor: 0,
      oldest_cursor: 1,
      next_cursor: 1,
    }));
    clock.advanceTo(100_000);

    const consequenceIndex = trace.findIndex((item) => item.includes(":consequence:1:"));
    const acknowledgementIndex = trace.findIndex((item) => item.startsWith("ack:1:"));
    expect(consequenceIndex, JSON.stringify(trace)).toBeGreaterThanOrEqual(0);
    expect(acknowledgementIndex).toBeGreaterThan(consequenceIndex);
    expect(trace[consequenceIndex]).not.toContain(":none");
    expect(session.getFrame()).toMatchObject({
      presentedCursor: 1,
      world: { projectedThroughCursor: 1 },
      scene: null,
    });
    session.dispose();
  });

  it("composes the real session pipeline through Canvas and Graph before consequence acknowledgement", async () => {
    const run = makeRun({ run_id: "run-a", seed: 71, event_cursor: 0 });
    const snapshot = makeWorld({ run_id: "run-a", event_cursor: 0 });
    const recipes = new Map(snapshot.regions.map((region) => [
      region.name,
      createRegionMapRecipe(createRegionMapIdentity(run.seed, region, snapshot.regions)),
    ]));
    const placementOwner = createPlacementGenerationOwner([...recipes.values()], snapshot);
    const client = new FakeClient(run, [snapshot]);
    const clock = createManualPresentationClock();
    const executor = createSceneExecutor();
    const retainedAcceptance = createPresentationFrameAcceptanceTracker();
    const trace: string[] = [];
    const frameAcceptance = {
      markAccepted(frame: Parameters<typeof retainedAcceptance.markAccepted>[0]): void {
        trace.push(`canvas-accepted:${frame.scene?.phase ?? "settled"}:${frame.world.projectedThroughCursor}`);
        retainedAcceptance.markAccepted(frame);
      },
      accepts: retainedAcceptance.accepts,
      clear: retainedAcceptance.clear,
      dispose: retainedAcceptance.dispose,
    };
    let session!: ReturnType<typeof createProductionLivePresentationSession>;
    const acknowledge = executor.acknowledgePublishedConsequence.bind(executor);
    vi.spyOn(executor, "acknowledgePublishedConsequence").mockImplementation((...args) => {
      const current = session.getFrame();
      trace.push(`ack:${current.scene?.phase}:${current.world.projectedThroughCursor}:${frameAcceptance.accepts(current)}`);
      acknowledge(...args);
    });
    session = createProductionLivePresentationSession({
      clientFactory: () => client,
      clockFactory: () => clock,
      runtimeFactory: () => executor,
      checkpointFeedFactory: () => new FakeCheckpointFeed(),
      placementFactory: () => placementOwner,
      choreography: { getPlacementOwnerId: () => placementOwner.ownerId },
      frameAcceptance,
    });
    await session.ready;

    const context = causalCanvasContext();
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(() => context as unknown as CanvasRenderingContext2D);
    const pool = new CausalAtlasPool();
    const canvas = document.createElement("canvas");
    const renderer = await createCanvasPresentationRenderer({
      canvas,
      callbacks: {},
      manifest: PRODUCTION_ASSET_MANIFEST,
      factories: CAUSAL_FACTORIES,
      placement: placementOwner.current(),
      recipes,
      atlasPool: pool,
      frameDriver: new CausalFrameDriver(),
      wakeScheduler: new CausalWakeScheduler(),
      atlasCommitScheduler: new CausalAtlasCommitScheduler(),
      visibilityTarget: new CausalVisibilityTarget(),
      frameAcceptance,
      sceneGraphFactory: (options) => {
        const graph = createProductionSceneGraph(options);
        return {
          ...graph,
          applyFrame(frame, batch, nowMs) {
            trace.push(`graph-update:${frame.scene?.phase ?? "settled"}:${frame.world.projectedThroughCursor}`);
            return graph.applyFrame!(frame, batch, nowMs);
          },
          update(frame, batch) {
            trace.push(`graph-update:${frame.scene?.phase ?? "settled"}:${frame.world.projectedThroughCursor}`);
            return graph.update(frame, batch);
          },
          applySceneCommands(batch, nowMs) {
            trace.push(`graph-commands:${session.getFrame().scene?.phase ?? "settled"}:${batch.sceneToken}`);
            return graph.applySceneCommands(batch, nowMs);
          },
        };
      },
    }) as CanvasPresentationRenderer;
    const publishToCanvas = (): void => {
      const current = session.getFrame();
      trace.push(`session-frame:${current.scene?.phase ?? "settled"}:${current.world.projectedThroughCursor}`);
      renderer.updatePresentation(current);
    };
    const unsubscribe = session.subscribe(publishToCanvas);
    publishToCanvas();
    await causalSettle();

    await client.streams[0]!.emit(envelope([staged(1, "Aster speaks once.")], {
      cursor: 0,
      oldest_cursor: 1,
      next_cursor: 1,
    }));
    clock.advanceTo(100_000);
    await causalSettle();

    const consequenceFrame = trace.findIndex((value) => value === "session-frame:consequence:1");
    const graphUpdate = trace.findIndex((value, index) => index > consequenceFrame
      && value === "graph-update:consequence:1");
    const canvasAccepted = trace.findIndex((value, index) => index > graphUpdate
      && value === "canvas-accepted:consequence:1");
    const acknowledgement = trace.findIndex((value, index) => index > canvasAccepted
      && value === "ack:consequence:1:true");
    expect([consequenceFrame, graphUpdate, canvasAccepted, acknowledgement], JSON.stringify(trace))
      .toEqual(expect.arrayContaining([expect.any(Number)]));
    expect(consequenceFrame).toBeGreaterThanOrEqual(0);
    expect(graphUpdate).toBeGreaterThan(consequenceFrame);
    expect(canvasAccepted).toBeGreaterThan(graphUpdate);
    expect(acknowledgement).toBeGreaterThan(canvasAccepted);
    expect(session.getFrame()).toMatchObject({
      presentedCursor: 1,
      world: { projectedThroughCursor: 1 },
      scene: null,
    });
    expect((renderer.debug()).graph.identity).toMatchObject({
      runId: "run-a",
      sourceKey: "live:run-a",
    });

    unsubscribe();
    renderer.dispose();
    session.dispose();
    pool.dispose();
    getContext.mockRestore();
  });

  it("keeps the live world on screen when the overlay lane projects past the staged moment", async () => {
    // THE FIRST REAL LIVE RUN (2026-08-20, Gemini) rendered nothing but
    // "Some world art could not be shown. Retry the world view." while every atlas PNG
    // returned 200. `StoryDirector.flushDeferredEvidence` applies OVERLAY-lane evidence for
    // beats that took no stage lease, so `world.projectedThroughCursor` legitimately overtakes
    // `frame.lastCursor` (the ACTIVE moment's range). The production graph rejected that frame
    // as `invalid`; inside an atlas commit `commitLiveGraphRegion` turned the rejection into
    // `rejectLoadedRegion()`, and the viewer was told the ART had failed.
    // This is the seam no chronicle covers: a REAL session frame against the REAL graph.
    const run = makeRun({ run_id: "run-overlay", seed: 71, event_cursor: 0 });
    const snapshot = makeWorld({ run_id: "run-overlay", event_cursor: 0 });
    const recipes = new Map(snapshot.regions.map((region) => [
      region.name,
      createRegionMapRecipe(createRegionMapIdentity(run.seed, region, snapshot.regions)),
    ]));
    const placementOwner = createPlacementGenerationOwner([...recipes.values()], snapshot);
    const client = new FakeClient(run, [snapshot]);
    const clock = createManualPresentationClock();
    const executor = createSceneExecutor();
    const frameAcceptance = createPresentationFrameAcceptanceTracker();
    const session = createProductionLivePresentationSession({
      clientFactory: () => client,
      clockFactory: () => clock,
      runtimeFactory: () => executor,
      checkpointFeedFactory: () => new FakeCheckpointFeed(),
      placementFactory: () => placementOwner,
      choreography: { getPlacementOwnerId: () => placementOwner.ownerId },
      frameAcceptance,
    });
    await session.ready;
    session.subscribe(() => frameAcceptance.markAccepted(session.getFrame()));

    // One body-occupying beat takes the stage and commits its evidence at cursor 1.
    await client.streams[0]!.emit(envelope([staged(1, "Aster is helped up.")], {
      cursor: 0,
      oldest_cursor: 1,
      next_cursor: 1,
    }));
    clock.advanceTo(100_000);
    await causalSettle();

    // An utterance behind it clears onto the overlay WITHOUT taking a stage lease, so its
    // evidence reaches the world model while the frame identity still names moment 1.
    await client.streams[0]!.emit(envelope([selfTalk(2, "agent_001", "I am still here.")], {
      cursor: 1,
      oldest_cursor: 2,
      next_cursor: 2,
    }));
    await causalSettle();

    const overlayAhead = session.getFrame();
    expect(overlayAhead.world.projectedThroughCursor).toBeGreaterThan(overlayAhead.lastCursor);
    expect(overlayAhead.ingestedCursor).toBeGreaterThanOrEqual(
      overlayAhead.world.projectedThroughCursor,
    );

    const pool = new CausalAtlasPool();
    const atlasLeases = new Map<string, ProductionAssetLease>();
    for (const atlasId of Object.keys(PRODUCTION_ASSET_MANIFEST.atlases)) {
      atlasLeases.set(atlasId, await pool.acquire(atlasId) as ProductionAssetLease);
    }
    const graph = createProductionSceneGraph({
      manifest: PRODUCTION_ASSET_MANIFEST,
      factories: CAUSAL_FACTORIES,
      placement: placementOwner.current(),
      recipes,
      atlasLeases,
    });
    try {
      expect(graph.applyFrame!(overlayAhead, null, 0).outcome).toBe("accepted");
    } finally {
      graph.dispose();
      pool.dispose();
      session.dispose();
    }
  });

  it("commits the real C01 destination at consequence start and moves only from its exact arrival gate", async () => {
    const manifest = getChronicleManifest("C01");
    const travelerId = manifest.entries[0]!.event.payload.agent_id as string;
    const fromRegion = manifest.entries[0]!.event.payload.from_region as string;
    const toRegion = manifest.entries[0]!.event.payload.to_region as string;
    const run = makeRun({
      run_id: manifest.runId,
      seed: manifest.seed,
      event_cursor: manifest.initialSnapshot.event_cursor,
    });
    const recipes = new Map(manifest.initialSnapshot.regions.map((region) => [
      region.name,
      createRegionMapRecipe(createRegionMapIdentity(
        manifest.seed,
        region,
        manifest.initialSnapshot.regions,
      )),
    ]));
    const placementOwner = createPlacementGenerationOwner(
      [...recipes.values()],
      manifest.initialSnapshot,
    );
    const client = new FakeClient(run, [manifest.initialSnapshot]);
    const clock = createManualPresentationClock();
    const executor = createSceneExecutor();
    const frameAcceptance = createPresentationFrameAcceptanceTracker();
    let runtimeStart: SceneRuntimeStart | null = null;
    const start = executor.start.bind(executor);
    vi.spyOn(executor, "start").mockImplementation((input, identity) => {
      runtimeStart = input;
      return start(input, identity);
    });
    const session = createProductionLivePresentationSession({
      clientFactory: () => client,
      clockFactory: () => clock,
      runtimeFactory: () => executor,
      checkpointFeedFactory: () => new FakeCheckpointFeed(),
      placementFactory: () => placementOwner,
      choreography: { getPlacementOwnerId: () => placementOwner.ownerId },
      frameAcceptance,
    });
    await session.ready;

    const context = causalCanvasContext();
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext")
      .mockImplementation(() => context as unknown as CanvasRenderingContext2D);
    const pool = new CausalAtlasPool();
    const canvas = document.createElement("canvas");
    canvas.width = 1_440;
    canvas.height = 900;
    let graphRef: ProductionSceneGraph | null = null;
    const preConsequence: Array<Readonly<{
      phase: string | null;
      activeRegion: string | null;
      placementRevision: number;
      placementRegion: string | null;
      placementAnchor: string | null;
      transitionCount: number;
      eventType: string | null;
      stageAuthorizationCount: number;
      actorInstance: number | null;
      actorPosition: Readonly<{ x: number; y: number }> | null;
    }>> = [];
    type C01ConsequenceObservation = Readonly<{
      frameRegion: string | null;
      placementRegion: string | null;
      placementAnchor: string | null;
      placementRevision: number;
      actorAtCommit: Readonly<{ x: number; y: number }> | null;
      routeEnd: Readonly<{ x: number; y: number }> | null;
      transitionCount: number;
      transitionPosition: Readonly<{ x: number; y: number }> | null;
      firstDisplacement: Readonly<{ x: number; y: number }> | null;
      actorInstance: number | null;
      batchKinds: readonly string[];
    }>;
    let consequence: C01ConsequenceObservation | null = null;
    /**
     * Every command the traveller is issued, per accepted frame, with the phase
     * and active region it was issued in.
     *
     * Backs the truncate-then-walk assertions at the end of this test: a region
     * transition is allowed exactly ONE reposition (the departure's elided
     * middle) and it has to be in the source region, before the commit, and
     * followed by the walk it exists to shorten.
     */
    const travelerCommandLog: Array<Readonly<{
      phase: string | null;
      activeRegion: string | null;
      kinds: readonly string[];
      repositions: readonly Readonly<{
        reason: string;
        position: Readonly<{ x: number; y: number }>;
      }>[];
      moves: readonly Readonly<{
        first: Readonly<{ x: number; y: number }>;
        last: Readonly<{ x: number; y: number }>;
        distancePx: number;
      }>[];
    }>> = [];
    const renderer = await createCanvasPresentationRenderer({
      canvas,
      callbacks: {},
      manifest: PRODUCTION_ASSET_MANIFEST,
      factories: CAUSAL_FACTORIES,
      placement: placementOwner.current(),
      recipes,
      atlasPool: pool,
      frameDriver: new CausalFrameDriver(),
      wakeScheduler: new CausalWakeScheduler(),
      atlasCommitScheduler: new CausalAtlasCommitScheduler(),
      visibilityTarget: new CausalVisibilityTarget(),
      frameAcceptance,
      sceneGraphFactory: (options) => {
        const graph = createProductionSceneGraph(options);
        graphRef = graph;
        let pendingObservation: Readonly<{
          frame: PresentedObserverFrame;
          batch: ProductionSceneCommandBatch | null;
          nowMs: number;
        }> | null = null;
        const observeAcceptedFrame = (
          frame: PresentedObserverFrame,
          batch: ProductionSceneCommandBatch | null,
          nowMs: number,
        ): void => {
          const debug = graph.debugSnapshot();
          const phase = frame.scene?.phase ?? null;
          const placementSnapshot = placementOwner.current().snapshot();
          const placement = placementSnapshot.agents.get(travelerId) ?? null;
          const travelerCommands = (batch?.commands ?? []).flatMap((command) => (
            command.kind === "actor" && command.actorId === travelerId ? [command.command] : []
          ));
          if (travelerCommands.length > 0) {
            travelerCommandLog.push({
              phase,
              activeRegion: debug.activeRegion?.id ?? null,
              kinds: travelerCommands.map(({ kind }) => kind),
              repositions: travelerCommands.flatMap((command) => (
                command.kind === "reposition"
                  ? [{ reason: command.reason, position: { ...command.position } }]
                  : []
              )),
              moves: travelerCommands.flatMap((command) => (
                command.kind === "move" && command.waypoints.length > 0
                  ? [{
                      first: { ...command.waypoints[0]! },
                      last: { ...command.waypoints.at(-1)! },
                      distancePx: routeDistancePx(command.waypoints),
                    }]
                  : []
              )),
            });
          }
          if (phase !== "consequence" && consequence === null) {
            preConsequence.push({
              phase,
              activeRegion: debug.activeRegion?.id ?? null,
              placementRevision: placementSnapshot.revision,
              placementRegion: placement?.regionId ?? null,
              placementAnchor: placement?.anchorKind ?? null,
              transitionCount: debug.regionTransitions.length,
              eventType: frame.scene?.execution?.eventType ?? null,
              stageAuthorizationCount: batch?.commands.filter(({ kind }) => kind === "stage-arrival").length ?? 0,
              actorInstance: debug.actors.find(({ id }) => id === travelerId)?.instanceId ?? null,
              actorPosition: debug.actors.find(({ id }) => id === travelerId)?.position ?? null,
            });
          } else if (consequence === null) {
            const actorAtCommit = debug.actors.find(({ id }) => id === travelerId)?.position ?? null;
            const routeEnd = batch?.commands.flatMap((command) => (
              command.kind === "actor" && command.actorId === travelerId
                && command.command.kind === "move"
                ? [command.command.waypoints.at(-1) ?? null]
                : []
            )).find((point) => point !== null) ?? null;
            const transition = debug.regionTransitions.find(({ actorId }) => actorId === travelerId) ?? null;
            let firstDisplacement: Readonly<{ x: number; y: number }> | null = null;
            if (actorAtCommit !== null) {
              for (let tick = 1; tick <= 30 && firstDisplacement === null; tick += 1) {
                graph.updateTime(1 / 30, nowMs + tick * 1_000 / 30);
                const position = graph.debugSnapshot().actors.find(({ id }) => id === travelerId)?.position ?? null;
                if (position !== null && (
                  position.x !== actorAtCommit.x || position.y !== actorAtCommit.y
                )) firstDisplacement = position;
              }
            }
            consequence = {
              frameRegion: frame.world.agents.find(({ value }) => value.id === travelerId)?.value.position ?? null,
              placementRegion: placement?.regionId ?? null,
              placementAnchor: placement?.anchorKind ?? null,
              placementRevision: placementSnapshot.revision,
              actorAtCommit,
              routeEnd,
              transitionCount: debug.regionTransitions.length,
              transitionPosition: transition?.position ?? null,
              firstDisplacement,
              actorInstance: debug.actors.find(({ id }) => id === travelerId)?.instanceId ?? null,
              batchKinds: batch?.commands.map((command) => (
                command.kind === "actor" ? `${command.kind}:${command.command.kind}` : command.kind
              )) ?? [],
            };
          }
        };
        return {
          ...graph,
          applyFrame(frame, batch, nowMs, observerViewRegionId, deferArrivalStaging) {
            const result = graph.applyFrame!(
              frame,
              batch,
              nowMs,
              observerViewRegionId,
              deferArrivalStaging,
            );
            if (result.outcome === "accepted" && deferArrivalStaging === true) {
              pendingObservation = { frame, batch, nowMs };
            } else {
              pendingObservation = null;
              if (result.outcome === "accepted") observeAcceptedFrame(frame, batch, nowMs);
            }
            return result;
          },
          commitArrivalStaging(identity) {
            graph.commitArrivalStaging?.(identity);
            const pending = pendingObservation;
            pendingObservation = null;
            if (pending !== null) observeAcceptedFrame(pending.frame, pending.batch, pending.nowMs);
          },
          discardArrivalStaging(identity) {
            graph.discardArrivalStaging?.(identity);
            pendingObservation = null;
          },
        };
      },
    }) as CanvasPresentationRenderer;
    const publishToCanvas = (): void => renderer.updatePresentation(session.getFrame());
    const unsubscribe = session.subscribe(publishToCanvas);
    publishToCanvas();
    await flushPromises(12);

    await client.streams[0]!.emit(envelope(manifest.entries, {
      cursor: manifest.initialSnapshot.event_cursor,
      oldest_cursor: 1,
      next_cursor: manifest.expectedFinalCursor,
    }));
    await flushPromises(12);
    expect(renderer.debug().graph.actors.some(({ id }) => id === travelerId)).toBe(true);
    const startedProgram = (runtimeStart as SceneRuntimeStart | null)?.program ?? null;
    const holdStart = startedProgram?.phaseWindows.find(({ phase }) => phase === "hold")?.startMs;
    if (holdStart === undefined) throw new Error("C01 hold start was not resolved");
    clock.advanceTo(holdStart);
    await flushPromises(12);
    clock.advanceTo(100_000);
    await causalSettle();

    const program = (runtimeStart as SceneRuntimeStart | null)?.program;
    const consequenceStart = program?.phaseWindows.find(({ phase }) => phase === "consequence")?.startMs;
    const consequenceMarker = program?.markers.find(({ role }) => role === "consequence");
    const arrivalGate = recipes.get(toRegion)!.gates.find((gate) => (
      gate.role === "arrival" && gate.edge.from === fromRegion && gate.edge.to === toRegion
    ))!;
    const gatePoint = {
      x: arrivalGate.tile.column * 32 + 16,
      y: arrivalGate.tile.row * 32 + 16,
    };
    expect(consequenceMarker?.atMs).toBe(consequenceStart);
    expect(preConsequence.length).toBeGreaterThan(0);
    expect(preConsequence.every(({ transitionCount }) => transitionCount === 0),
      JSON.stringify(preConsequence)).toBe(true);
    const sourceSamples = preConsequence.filter(({ activeRegion }) => activeRegion === fromRegion);
    const destinationSamples = preConsequence.filter(({ activeRegion }) => activeRegion === toRegion);
    expect(sourceSamples.length, JSON.stringify(preConsequence)).toBeGreaterThan(0);
    expect(destinationSamples.length, JSON.stringify(preConsequence)).toBeGreaterThan(0);
    expect(destinationSamples.every(({ phase, eventType, stageAuthorizationCount }) => (
      phase === "hold"
      && eventType === "agent_entered_region"
      && stageAuthorizationCount === 1
    )), JSON.stringify(destinationSamples)).toBe(true);
    expect(sourceSamples.every(({ placementRegion }) => placementRegion === fromRegion)).toBe(true);
    const sourcePlacementRevision = sourceSamples[0]!.placementRevision;
    const sourcePlacementAnchor = sourceSamples[0]!.placementAnchor;
    expect(preConsequence.every(({ placementRevision }) => (
      placementRevision === sourcePlacementRevision
    ))).toBe(true);
    expect(destinationSamples.every(({ placementRegion, placementAnchor, actorPosition }) => (
      placementRegion === fromRegion
      && placementAnchor === sourcePlacementAnchor
      && actorPosition?.x === gatePoint.x
      && actorPosition.y === gatePoint.y
    )), JSON.stringify(destinationSamples)).toBe(true);
    expect(destinationSamples[0]!.actorPosition).toEqual(gatePoint);
    const sourcePositions = new Set(sourceSamples.flatMap(({ actorPosition }) => (
      actorPosition === null ? [] : [`${actorPosition.x},${actorPosition.y}`]
    )));
    expect(destinationSamples.every(({ actorPosition }) => actorPosition !== null
      && !sourcePositions.has(`${actorPosition.x},${actorPosition.y}`))).toBe(true);
    for (let index = 1; index < destinationSamples.length; index += 1) {
      const previous = destinationSamples[index - 1]!.actorPosition!;
      const current = destinationSamples[index]!.actorPosition!;
      expect(Math.hypot(current.x - previous.x, current.y - previous.y)).toBeLessThanOrEqual(64);
    }
    const travelerInstances = preConsequence.flatMap(({ actorInstance }) => (
      actorInstance === null ? [] : [actorInstance]
    ));
    expect(new Set(travelerInstances).size, JSON.stringify(preConsequence)).toBe(1);
    const committed = consequence as C01ConsequenceObservation | null;
    expect(committed, JSON.stringify({ preConsequence, consequence: committed })).toMatchObject({
      frameRegion: toRegion,
      placementRegion: toRegion,
      placementAnchor: `arrival:${fromRegion}`,
      actorAtCommit: gatePoint,
      transitionCount: 1,
      transitionPosition: gatePoint,
    });
    expect(committed!.placementRevision).toBeGreaterThan(sourcePlacementRevision);
    expect(committed?.actorAtCommit).not.toEqual(committed?.routeEnd);
    expect(committed?.actorInstance, JSON.stringify({ preConsequence, consequence: committed }))
      .toBe(travelerInstances[0]);
    expect(committed?.firstDisplacement).not.toBeNull();
    expect(Math.hypot(
      committed!.firstDisplacement!.x - gatePoint.x,
      committed!.firstDisplacement!.y - gatePoint.y,
    )).toBeLessThanOrEqual(48 / 30 + 0.01);
    const finalGraph = graphRef as ProductionSceneGraph | null;
    expect(finalGraph?.debugSnapshot().regionTransitions).toHaveLength(1);
    // TRUNCATE-THEN-WALK RE-BASELINE (2026-08-01). This line used to read
    //   expect(...recentMarkers.some(({ marker }) => marker === "repositioned")).toBe(false)
    // which was written when NO legitimate reposition existed anywhere in a
    // region transition, so "none at all" and "none that breaks the contract"
    // were the same sentence. They are no longer: the departure's middle is now
    // deliberately elided (`choreography/locomotionGate.ts`'s `boundLocomotion`),
    // and that elision IS one reposition. A blanket ban would ban the feature,
    // so it is replaced by assertions on what the ban was actually protecting.
    // These are strictly stronger: "zero repositions" never said where a
    // reposition would have been illegal, or that a walk had to follow it.
    const allRepositions = travelerCommandLog.flatMap(({ repositions }) => repositions);
    const departureFrames = travelerCommandLog.filter(({ activeRegion }) => activeRegion === fromRegion);
    const arrivalFrames = travelerCommandLog.filter(({ activeRegion }) => activeRegion === toRegion);
    // Exactly one reposition in the entire transition, and it is the departure's.
    expect(allRepositions).toHaveLength(1);
    expect(allRepositions[0]!.reason).toBe("distance-cut");
    expect(departureFrames.flatMap(({ repositions }) => repositions)).toHaveLength(1);
    // THE ARRIVAL CONTRACT, unchanged and now stated positively: the being is
    // never repositioned in the destination region -- it walks in from its gate.
    expect(arrivalFrames.flatMap(({ repositions }) => repositions)).toEqual([]);
    // THE DEPARTURE CONTRACT: the cut is followed, in that order and in the same
    // batch, by the walk it exists to shorten. Order is load-bearing -- the graph
    // applies commands as it validates them, so a reposition emitted after the
    // move would cancel the walk into a teleport.
    const cutFrame = departureFrames.find(({ repositions }) => repositions.length > 0)!;
    expect(cutFrame.kinds).toEqual(["reposition", "move"]);
    expect(cutFrame.phase).toBe("enter");
    // The being walks OUT OF the point it was cut to: the cut origin is the first
    // waypoint of the surviving suffix, never an interpolated or unrelated point.
    expect(cutFrame.moves).toHaveLength(1);
    expect(cutFrame.moves[0]!.first).toEqual(allRepositions[0]!.position);
    // And the walk that survives is bounded by the threshold and non-empty -- the
    // being is still SEEN crossing its last stretch into its own departure gate.
    expect(cutFrame.moves[0]!.distancePx).toBeGreaterThan(0);
    expect(cutFrame.moves[0]!.distancePx).toBeLessThanOrEqual(WALK_MAX_DISTANCE_PX);

    unsubscribe();
    renderer.dispose();
    session.dispose();
    pool.dispose();
    getContext.mockRestore();
  });

  // Measured live on `qa-live-replay.html` against `runs/seed-20260710-*`: one
  // first-publication throw, then 122 consecutive retry-branch throws pinned at the
  // 1000ms collaborator-retry cap, `framePublicationSerial` frozen for 150s, 48 pending
  // moments, recovery latched `waiting-safe-boundary` -- while the chrome read LIVE.
  // The barrier published the consequence frame ONCE and thereafter only re-CHECKED a
  // receipt that only a Canvas commit can produce, while `publishObserverFrame` held
  // every other publication. Circular wait, not a race. The law: no Canvas behaviour
  // may stop the session from publishing, and giving up on a receipt must be loud.
  it("re-offers a consequence frame Canvas will not sign, then gives up loudly instead of freezing", async () => {
    const run = makeRun({ run_id: "run-a", seed: 71, event_cursor: 0 });
    const snapshot = makeWorld({ run_id: "run-a", event_cursor: 0 });
    const recipes = snapshot.regions.map((region) =>
      createRegionMapRecipe(createRegionMapIdentity(run.seed, region, snapshot.regions)));
    const placementOwner = createPlacementGenerationOwner(recipes, snapshot);
    const client = new FakeClient(run, [snapshot]);
    const clock = createManualPresentationClock();
    // A Canvas that never signs: exactly what the stage generation guard
    // (`PresentationWorldStage.tsx:471`) and every `updatePresentation` early-out do.
    const offered: number[] = [];
    const frameAcceptance = {
      markAccepted(frame: PresentedObserverFrame): void { offered.push(frame.revision); },
      accepts: (): boolean => false,
      clear: (): void => undefined,
      dispose: (): void => undefined,
    };
    const session = createProductionLivePresentationSession({
      clientFactory: () => client,
      clockFactory: () => clock,
      runtimeFactory: () => createSceneExecutor(),
      checkpointFeedFactory: () => new FakeCheckpointFeed(),
      placementFactory: () => placementOwner,
      choreography: { getPlacementOwnerId: () => placementOwner.ownerId },
      frameAcceptance,
    });
    await session.ready;
    const publications: number[] = [];
    session.subscribe(() => publications.push(session.getFrame().revision));

    await client.streams[0]!.emit(envelope([staged(1, "Aster speaks once.")], {
      cursor: 0,
      oldest_cursor: 1,
      next_cursor: 1,
    }));

    // Drive the clock the way a browser does: each transient throw lands in its own
    // task, and the session's own retry schedule is what advances.
    const transientErrors: string[] = [];
    for (let step = 0; step < 400 && session.getFrame().scene !== null; step += 1) {
      try {
        clock.advanceBy(250);
      } catch (error) {
        transientErrors.push(error instanceof Error ? error.message : String(error));
      }
    }

    // 1. The stage is not frozen: the moment settled and the world moved on.
    expect(session.getFrame(), JSON.stringify(transientErrors)).toMatchObject({
      presentedCursor: 1,
      world: { projectedThroughCursor: 1 },
      scene: null,
    });
    // 2. Every retry RE-OFFERED the frame rather than only re-reading the receipt.
    expect(new Set(publications).size).toBeGreaterThan(1);
    // 3. The barrier is bounded, so it cannot throw forever.
    expect(transientErrors.length).toBeLessThanOrEqual(12);
    expect(transientErrors.every((message) => (
      message === "consequence frame was not accepted by Canvas at its exact revision"
    ))).toBe(true);
    // 4. Giving up is loud.
    expect(session.getFrame().notices).toEqual([
      expect.objectContaining({ kind: "canvas-receipt", count: 1, lastCursor: 1 }),
    ]);
    session.dispose();
  });

  // Measured: `run_11` and all seven `runs/scenario/*` runs carry a legacy payload
  // schema the typed parse rejects. `StoryDirector.startNextIfIdle` threw at
  // `programResolver.resolve`, `PresentationIngress`'s isolation catch swallowed it,
  // the moment stayed at the head of the queue, every later moment was
  // pressure-dropped, and the frame kept reading "live" — 0 of 544 moments performed
  // with no indication anywhere. An unpresentable moment is now dropped LOUDLY.
  it("drops an unpresentable moment loudly instead of stalling the queue in silence", async () => {
    const run = makeRun({ run_id: "run-a", seed: 71, event_cursor: 0 });
    const snapshot = makeWorld({ run_id: "run-a", event_cursor: 0 });
    const recipes = snapshot.regions.map((region) =>
      createRegionMapRecipe(createRegionMapIdentity(run.seed, region, snapshot.regions)));
    const placementOwner = createPlacementGenerationOwner(recipes, snapshot);
    const client = new FakeClient(run, [snapshot]);
    const clock = createManualPresentationClock();
    const session = createProductionLivePresentationSession({
      clientFactory: () => client,
      clockFactory: () => clock,
      runtimeFactory: () => createSceneExecutor(),
      checkpointFeedFactory: () => new FakeCheckpointFeed(),
      placementFactory: () => placementOwner,
      choreography: { getPlacementOwnerId: () => placementOwner.ownerId },
      frameAcceptance: createPresentationFrameAcceptanceTracker(),
    });
    await session.ready;

    // Exactly the recorded legacy shape: the right type, a payload carrying only
    // `message`, which `presentation/eventPayloads.ts` rejects on its typed parse.
    await client.streams[0]!.emit(envelope([
      legacyPayload(1),
      legacyPayload(2),
    ], { cursor: 0, oldest_cursor: 1, next_cursor: 2 }));
    clock.advanceBy(1_000);

    expect(session.diagnostics().director).toMatchObject({
      pendingMoments: 0,
      unpresentableMoments: 2,
    });
    expect(session.getFrame().notices).toEqual([
      expect.objectContaining({
        kind: "unpresentable-moment",
        count: 2,
        firstCursor: 1,
        lastCursor: 2,
      }),
    ]);
    session.dispose();
  });

  it("rejects production choreography bound to a different placement owner", async () => {
    const run = makeRun({ run_id: "run-a", seed: 71, event_cursor: 0 });
    const snapshot = makeWorld({ run_id: "run-a", event_cursor: 0 });
    const recipes = snapshot.regions.map((region) =>
      createRegionMapRecipe(createRegionMapIdentity(run.seed, region, snapshot.regions)));
    const owner = createPlacementGenerationOwner(recipes, snapshot);
    const session = createProductionLivePresentationSession({
      clientFactory: () => new FakeClient(run, [snapshot]),
      clockFactory: createManualPresentationClock,
      runtimeFactory: () => new ClocklessRuntime(),
      checkpointFeedFactory: () => new FakeCheckpointFeed(),
      placementFactory: () => owner,
      choreography: { getPlacementOwnerId: () => Symbol("foreign-owner") },
      frameAcceptance: createPresentationFrameAcceptanceTracker(),
    });

    await expect(session.ready).rejects.toThrow(/share one placement generation owner/i);
    expect(() => session.getFrame()).toThrow(/not ready/i);
    expect(owner.generation()).toBeGreaterThan(0);
    session.dispose();
  });

  it("starts from the latest exact snapshot cursor and never animates retained history", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 5 }),
      [makeWorld({ run_id: "run-a", event_cursor: 5 })],
    );
    const harness = liveHarness(client);
    await harness.session.ready;

    expect(client.calls).toEqual(["run", "world", "stream:5"]);
    expect(harness.session.getFrame()).toMatchObject({
      runId: "run-a",
      sourceKey: "live:run-a",
      firstCursor: 5,
      lastCursor: 5,
      ingestedCursor: 5,
      presentedCursor: 5,
    });

    await client.streams[0].emit(envelope([
      staged(4, "old-four"),
      staged(5, "old-five"),
      staged(6, "new-six"),
    ], { cursor: 3, next_cursor: 6 }));

    expect(harness.session.getFrame().ingestedCursor).toBe(6);
    expect(harness.session.getChronicle().now?.evidenceCursors).toEqual([6]);
    expect(harness.session.getChronicle().previous).toEqual([]);
  });

  it("keeps Live advancing behind an isolated Archive and reports exactly one honest return gap", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 5 }),
      [makeWorld({ run_id: "run-a", event_cursor: 5 })],
    );
    const live = liveHarness(client);
    await live.session.ready;
    const archive = createArchivePresentationSession({
      window: archiveWindow("run-a", 2, 3),
      clockFactory: createManualPresentationClock,
      runtimeFactory: () => new ClocklessRuntime(),
    });
    const binding = createPresentationSessionBinding(live.session);
    binding.bind(archive);

    await client.streams[0].emit(envelope([staged(6, "live-six"), staged(7, "live-seven")], {
      cursor: 5,
      next_cursor: 7,
    }));
    // Both archived cursors are display-only, so the archive's overlay lane
    // clears them and the watermark reaches the end of the window.
    expect(binding.getFrame()).toMatchObject({ source: "archive", presentedCursor: 3 });
    expect(live.session.getFrame()).toMatchObject({ source: "live", ingestedCursor: 7 });

    binding.bind(live.session);
    expect(binding.getFrame()).toMatchObject({ source: "live", ingestedCursor: 7 });
    expect(live.session.getChronicle().gaps).toEqual([
      {
        firstCursor: 6,
        lastCursor: 7,
        chapter: "while-away",
        archiveAvailable: true,
      },
    ]);

    binding.bind(archive);
    binding.bind(live.session);
    expect(live.session.getChronicle().gaps).toHaveLength(1);
    archive.dispose();
    expect(live.session.getFrame().runId).toBe("run-a");
    expect(client.streams[0].closed).toBe(false);
    binding.dispose();
    live.session.dispose();
  });

  it("rejects late Archive notifications after binding returns to Live", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 5 }),
      [makeWorld({ run_id: "run-a", event_cursor: 5 })],
    );
    const live = liveHarness(client);
    await live.session.ready;
    const archiveClock = createManualPresentationClock();
    const archive = createArchivePresentationSession({
      window: archiveWindow("run-a", 2, 3),
      clockFactory: () => archiveClock,
      runtimeFactory: () => new ClocklessRuntime(),
    });
    const binding = createPresentationSessionBinding(archive);
    const listener = vi.fn();
    binding.subscribe(listener);
    binding.bind(live.session);
    const callsAtLiveBind = listener.mock.calls.length;

    archiveClock.advanceTo(100_000);

    expect(binding.getFrame().source).toBe("live");
    expect(listener).toHaveBeenCalledTimes(callsAtLiveBind);
    binding.dispose();
    archive.dispose();
    live.session.dispose();
  });

  it("invalidates a bound Archive immediately when background Live changes run", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 5 }),
      [makeWorld({ run_id: "run-a", event_cursor: 5 })],
    );
    const live = liveHarness(client);
    await live.session.ready;
    const archive = createArchivePresentationSession({
      window: archiveWindow("run-a", 2, 3),
      clockFactory: createManualPresentationClock,
      runtimeFactory: () => new ClocklessRuntime(),
    });
    const binding = createPresentationSessionBinding(live.session);
    binding.bind(archive);
    expect(binding.getFrame().source).toBe("archive");

    live.session.replaceRun(
      makeRun({ run_id: "run-b", event_cursor: 2 }),
      makeWorld({ run_id: "run-b", event_cursor: 2 }),
    );

    expect(binding.getFrame()).toMatchObject({ source: "live", runId: "run-b" });
    live.session.replaceRun(
      makeRun({ run_id: "run-c", event_cursor: 1 }),
      makeWorld({ run_id: "run-c", event_cursor: 1 }),
    );
    expect(binding.getFrame()).toMatchObject({ source: "live", runId: "run-c" });
    expect(client.streams).toHaveLength(3);
    expect(client.streams[2].closed).toBe(false);
    binding.dispose();
    live.session.dispose();
  });

  it("atomically replaces generations so an older startup completion stays silent", async () => {
    const deferredWorld = deferred<WorldSnapshot>();
    const client = new FakeClient(makeRun({ run_id: "run-a", event_cursor: 5 }), []);
    client.deferWorld(deferredWorld);
    const harness = liveHarness(client);
    await flushPromises();

    harness.session.reset({
      runId: "run-b",
      sourceKey: "live:run-b",
      snapshot: makeWorld({ run_id: "run-b", event_cursor: 2 }),
      revision: 1,
    });
    deferredWorld.resolve(makeWorld({ run_id: "run-a", event_cursor: 5 }));
    await harness.session.ready;

    expect(harness.session.getFrame().revision).toBe(1);
    expect(harness.session.getFrame()).toMatchObject({
      runId: "run-b",
      sourceKey: "live:run-b",
      firstCursor: 2,
      lastCursor: 2,
      ingestedCursor: 2,
    });
    expect(client.streams).toHaveLength(1);
    expect(client.streams[0]).toMatchObject({ cursor: 2, closed: false });
    expect(() => harness.session.reset({
      runId: "run-b",
      sourceKey: "live:run-b",
      snapshot: makeWorld({ run_id: "run-b", event_cursor: 1 }),
      revision: harness.session.getFrame().revision + 1,
    })).toThrow("same-run reset cannot move behind");
    harness.session.dispose();
  });

  it("deduplicates identical observer publications but preserves a real control change", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 0 }),
      [makeWorld({ run_id: "run-a", event_cursor: 0 })],
    );
    const harness = liveHarness(client);
    await harness.session.ready;
    const listener = vi.fn();
    harness.session.subscribe(listener);
    const retainedRevision = harness.session.getFrame().revision;

    harness.session.controls().setSpeed(1);
    harness.session.controls().setSpeed(1);
    harness.session.controls().holdCurrentMoment(false);
    expect(harness.session.getFrame().revision).toBe(retainedRevision);
    expect(listener).not.toHaveBeenCalled();

    harness.session.select({ kind: "agent", id: "agent_001" });
    expect(harness.session.getFrame().revision).toBeGreaterThan(retainedRevision);
    expect(listener).toHaveBeenCalled();
    harness.session.dispose();
  });

  it("validates public reset identity, revision monotonicity, and one replacement stream", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 5 }),
      [makeWorld({ run_id: "run-a", event_cursor: 5 })],
    );
    const harness = liveHarness(client);
    await harness.session.ready;

    expect(() => harness.session.reset({
      runId: "run-b",
      sourceKey: "live:run-b",
      snapshot: makeWorld({ run_id: "run-a", event_cursor: 5 }),
      revision: 2,
    })).toThrow("reset runId must match snapshot run_id");
    expect(() => harness.session.reset({
      runId: "run-a",
      sourceKey: "live:run-a",
      snapshot: makeWorld({ run_id: "run-a", event_cursor: 5 }),
      revision: 1,
    })).toThrow("reset revision must advance");

    harness.session.reset({
      runId: "run-b",
      sourceKey: "live:run-b",
      snapshot: makeWorld({ run_id: "run-b", event_cursor: 2 }),
      revision: 2,
    });
    expect(client.streams).toHaveLength(2);
    expect(client.streams[0].closed).toBe(true);
    expect(client.streams[1]).toMatchObject({ cursor: 2, closed: false });
    harness.session.dispose();
  });

  it("routes overflow through one explicit recovery and never calls event polling", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 4 }),
      [
        makeWorld({ run_id: "run-a", event_cursor: 4 }),
        makeWorld({ run_id: "run-a", event_cursor: 8 }),
      ],
    );
    const harness = liveHarness(client);
    await harness.session.ready;
    const beforeRecoveryRevision = harness.session.getFrame().revision;

    await client.streams[0].emit(envelope([], {
      cursor: 4,
      oldest_cursor: 8,
      next_cursor: 8,
      overflow: true,
      snapshot_required: true,
    }));
    await flushPromises(12);

    expect(client.calls).toEqual(["run", "world", "stream:4", "world", "stream:8"]);
    expect(client.getEventsCalls).toBe(0);
    expect(harness.session.getFrame().revision).toBeGreaterThan(beforeRecoveryRevision);
    expect(harness.session.getFrame()).toMatchObject({
      firstCursor: 8,
      lastCursor: 8,
      ingestedCursor: 8,
      presentedCursor: 8,
    });
    expect(harness.session.getChronicle().gaps).toEqual([
      {
        firstCursor: 5,
        lastCursor: 8,
        chapter: "world-moved-ahead",
        archiveAvailable: true,
      },
    ]);
    harness.session.dispose();
  });

  it("retains one immutable completed-recovery receipt after the active coordinator returns to idle", async () => {
    const recovered = await completedOverflowHarness();
    const active = completedRecoveryDiagnostics(recovered.session);

    expect(active.recovery).toEqual({ status: "idle" });
    expect(active.lastCompletedRecovery).toEqual({
      reason: "queue-overflow",
      digest: {
        skipped: { firstCursor: 4, lastCursor: 4 },
        majorMoments: [],
        compressedAmbientCount: 1,
      },
      snappedCursor: 4,
    });
    expect(recovered.session.getFrame()).toMatchObject({
      ingestedCursor: 4,
      presentedCursor: 4,
      world: { projectedThroughCursor: 4 },
    });
    expect(recovered.client.streams.at(-1)).toMatchObject({ cursor: 4, closed: false });

    const receipt = active.lastCompletedRecovery!;
    expect(completedRecoveryDiagnostics(recovered.session).lastCompletedRecovery).toBe(receipt);
    expect(Object.isFrozen(receipt)).toBe(true);
    expect(Object.isFrozen(receipt.digest)).toBe(true);
    expect(Object.isFrozen(receipt.digest.skipped)).toBe(true);
    expect(Object.isFrozen(receipt.digest.majorMoments)).toBe(true);
    expect(Reflect.set(receipt as unknown as Record<string, unknown>, "snappedCursor", 99))
      .toBe(false);
    expect(completedRecoveryDiagnostics(recovered.session).lastCompletedRecovery)
      .toEqual({
        reason: "queue-overflow",
        digest: {
          skipped: { firstCursor: 4, lastCursor: 4 },
          majorMoments: [],
          compressedAmbientCount: 1,
        },
        snappedCursor: 4,
      });

    const revision = recovered.session.getFrame().revision;
    recovered.session.reset({
      runId: "run-a",
      sourceKey: "live:run-a",
      snapshot: makeWorld({ run_id: "run-a", event_cursor: 4 }),
      revision: revision + 1,
    });
    expect(completedRecoveryDiagnostics(recovered.session).lastCompletedRecovery).toBeNull();
    recovered.session.dispose();
  });

  it("clears completed-recovery receipts on run replacement and disposal", async () => {
    const replaced = await completedOverflowHarness();
    expect(completedRecoveryDiagnostics(replaced.session).lastCompletedRecovery).not.toBeNull();
    replaced.session.replaceRun(
      makeRun({ run_id: "run-b", event_cursor: 0 }),
      makeWorld({ run_id: "run-b", event_cursor: 0 }),
    );
    expect(completedRecoveryDiagnostics(replaced.session).lastCompletedRecovery).toBeNull();
    replaced.session.dispose();

    const disposed = await completedOverflowHarness();
    expect(completedRecoveryDiagnostics(disposed.session).lastCompletedRecovery).not.toBeNull();
    disposed.session.dispose();
    expect(completedRecoveryDiagnostics(disposed.session).lastCompletedRecovery).toBeNull();
  });

  it("freezes after recovery failure and issues one new request only on explicit retry", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 4 }),
      [makeWorld({ run_id: "run-a", event_cursor: 4 })],
    );
    const harness = liveHarness(client);
    await harness.session.ready;
    client.failWorld(new Error("offline"));
    client.queueWorld(makeWorld({ run_id: "run-a", event_cursor: 8 }));

    await client.streams[0].emit(envelope([], {
      cursor: 4,
      oldest_cursor: 8,
      next_cursor: 8,
      overflow: true,
      snapshot_required: true,
    }));
    await flushPromises(12);
    expect(client.calls.filter((call) => call === "world")).toHaveLength(2);
    // LAW CHANGE (spec §5.4): the freeze now lands on an HONEST frame. Measured, a
    // frozen session held whatever transport it last published — "Caught up / live" —
    // for 185s while 265 envelopes went into a void. `recovery-paused` is published
    // once, at the freeze, and THAT frame is the one held from then on.
    const frozen = harness.session.getFrame();
    expect(frozen.transport).toMatchObject({ connection: "recovery-paused", retryable: true });
    harness.session.select({ kind: "agent", id: "agent_001" });
    expect(harness.session.getFrame()).toBe(frozen);
    await flushPromises(12);
    expect(client.calls.filter((call) => call === "world")).toHaveLength(2);

    await harness.session.retryRecovery();
    expect(client.calls.filter((call) => call === "world")).toHaveLength(3);
    expect(harness.session.getFrame().presentedCursor).toBe(8);
    harness.session.dispose();
  });

  it("notifies recovery start and retry failure without changing frozen observer references", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 4 }),
      [makeWorld({ run_id: "run-a", event_cursor: 4 })],
    );
    const harness = liveHarness(client);
    await harness.session.ready;
    client.failWorld(new Error("offline-first"));
    client.failWorld(new Error("offline-retry"));
    const observations: Array<{
      status: string;
      frame: ReturnType<typeof harness.session.getFrame>;
      chronicle: ReturnType<typeof harness.session.getChronicle>;
      publicMessage?: string;
    }> = [];
    harness.session.subscribe(() => {
      const recovery = harness.session.diagnostics().recovery;
      if (recovery.status !== "waiting-safe-boundary" && recovery.status !== "frozen-retry") {
        return;
      }
      observations.push({
        status: recovery.status,
        frame: harness.session.getFrame(),
        chronicle: harness.session.getChronicle(),
        ...(recovery.status === "frozen-retry"
          ? { publicMessage: recovery.publicMessage }
          : {}),
      });
    });

    await client.streams[0].emit(envelope([], {
      cursor: 4,
      oldest_cursor: 8,
      next_cursor: 8,
      overflow: true,
      snapshot_required: true,
    }));
    await flushPromises(12);
    expect(observations.map((item) => item.status)).toEqual([
      "waiting-safe-boundary",
      "frozen-retry",
    ]);
    expect(observations[1].publicMessage).toBe("The world paused here. Retry when ready.");
    // The frozen reference is the `recovery-paused` frame published AT the freeze
    // (spec §5.4), not the "live" frame that preceded it.
    const frozenFrame = observations[0].frame;
    expect(frozenFrame.transport).toMatchObject({ connection: "recovery-paused" });
    expect(observations.every((item) => item.frame === frozenFrame)).toBe(true);
    const frozenChronicle = observations[0].chronicle;
    expect(observations.every((item) => item.chronicle === frozenChronicle)).toBe(true);

    observations.length = 0;
    await harness.session.retryRecovery();
    expect(observations.map((item) => item.status)).toEqual([
      "waiting-safe-boundary",
      "frozen-retry",
    ]);
    expect(observations.every((item) => item.frame === frozenFrame)).toBe(true);
    expect(observations.every((item) => item.chronicle === frozenChronicle)).toBe(true);
    harness.session.dispose();
  });

  // OWNER DECISION (Safi, 2026-07-25) "SELF_TALK RENDERS OPENLY" —
  // .superpowers/sdd/progress.md. Private self-talk (ScopeType.PRIVATE) was
  // previously hidden from `now` unless the source agent was selected. That
  // gate was reversed deliberately: PRIVATE only means other BEINGS never
  // perceive the thought (never routed to another agent's inbox); the viewer
  // is not a being, so self-talk now renders regardless of selection. Do not
  // restore the old gate as a regression fix. Future-event queue redaction
  // (the `upcoming` assertions below) is unrelated and unchanged.
  it("redacts queued future evidence and reveals private self-talk to every observer", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 5 }),
      [makeWorld({ run_id: "run-a", event_cursor: 5 })],
    );
    const harness = liveHarness(client);
    await harness.session.ready;
    const privateThought = selfTalk(6, "agent_001", "I should not be public");
    // Two staged beats follow it: the first takes the stage, the second is the
    // queued future evidence whose redaction this test is about. It used to be
    // enough for the thought itself to hold the stage while one `speak` queued
    // behind it, but neither of those occupies a body any more.
    await client.streams[0].emit(envelope([
      privateThought,
      staged(7, "future outcome"),
      staged(8, "further future outcome"),
    ], { cursor: 5, next_cursor: 8 }));

    // Since the two-lane split a private thought never occupies the stage, so
    // it is never the moment `now`. It is still disclosed in full to every
    // observer — the decision this guards — from the moment it is presented,
    // which for the overlay lane is immediately.
    expect(harness.session.getChronicle().previous.at(-1)?.representative.event.payload.message)
      .toBe("I should not be public");
    expect(harness.session.getChronicle().upcoming).toEqual([
      { sequence: 8, regionId: "meadow", urgency: "featured" },
    ]);
    expect(Object.keys(harness.session.getChronicle().upcoming[0])).toEqual([
      "sequence",
      "regionId",
      "urgency",
    ]);

    harness.session.select({ kind: "agent", id: "agent_001" });
    expect(harness.session.getChronicle().previous.at(-1)?.representative.event.payload.message)
      .toBe("I should not be public");
    harness.session.select({ kind: "agent", id: "agent_002" });
    expect(harness.session.getChronicle().previous.at(-1)?.representative.event.payload.message)
      .toBe("I should not be public");
    harness.session.dispose();
  });

  it("feeds active run constants into threshold projection and leaves absent thresholds unresolved", async () => {
    const event = resourceChanged(6, 600, 2);
    const withConstants = new FakeClient(
      makeRun({
        run_id: "run-a",
        event_cursor: 5,
        constants: {
          hoarding_energy_threshold: 500,
          hoarding_materials_threshold: 300,
        },
      }),
      [makeWorld({ run_id: "run-a", event_cursor: 5 })],
    );
    const known = liveHarness(withConstants);
    await known.session.ready;
    await withConstants.streams[0].emit(envelope([event], { cursor: 5, next_cursor: 6 }));
    known.clock.advanceTo(100_000);
    expect(agentRecord(known.session.getFrame().world, "agent_001")).toMatchObject({
      completeness: "exact",
      value: { is_hoarding: true },
    });

    const withoutConstants = new FakeClient(
      makeRun({ run_id: "run-b", event_cursor: 5, constants: {} }),
      [makeWorld({ run_id: "run-b", event_cursor: 5 })],
    );
    const unresolved = liveHarness(withoutConstants);
    await unresolved.session.ready;
    await withoutConstants.streams[0].emit(envelope([
      { ...event, event: { ...event.event }, cursor: 6 },
    ], { cursor: 5, next_cursor: 6 }));
    unresolved.clock.advanceTo(100_000);
    expect(agentRecord(unresolved.session.getFrame().world, "agent_001")).toMatchObject({
      completeness: "exact",
      value: { energy: 600, materials: 2, is_hoarding: false },
    });
    known.session.dispose();
    unresolved.session.dispose();
  });

  it("starts and resets its injected checkpoint feed, reconciles only safe present truth, and routes 413 once", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 4 }),
      [
        makeWorld({ run_id: "run-a", event_cursor: 4 }),
        makeWorld({ run_id: "run-a", event_cursor: 8 }),
      ],
    );
    const harness = liveHarness(client);
    await harness.session.ready;
    expect(harness.feed.starts).toEqual([{ runId: "run-a", sourceKey: "live:run-a" }]);

    const future = checkpoint(1, makeWorld({
      run_id: "run-a",
      event_cursor: 8,
      agents: makeWorld().agents.map((agent) => ({ ...agent, status: "dead" as const })),
    }));
    harness.feed.emit(future);
    expect(selectPresentedHud(harness.session.getFrame()).deadAgents).toBe(0);

    harness.feed.emitFault({ kind: "oversized-record", line: 2, retryable: false });
    harness.feed.emitFault({ kind: "oversized-record", line: 2, retryable: false });
    await flushPromises(12);
    expect(client.calls.filter((call) => call === "world")).toHaveLength(2);
    expect(harness.session.getChronicle().gaps).toHaveLength(1);
    harness.session.dispose();
    expect(harness.feed.disposed).toBe(true);
  });

  it("forwards the exact active checkpoint hold witness through session diagnostics", async () => {
    const initial = makeWorld({ run_id: "run-a", event_cursor: 4 });
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 4 }),
      [initial],
    );
    const harness = liveHarness(client);
    await harness.session.ready;
    const corrected = makeWorld({
      run_id: "run-a",
      event_cursor: 4,
      world_time: initial.world_time + 1,
      regions: initial.regions.map((region) => region.name === "meadow"
        ? { ...region, current_energy: region.current_energy + 7 }
        : region),
    });

    harness.feed.emit(checkpoint(7, corrected));

    expect(harness.session.diagnostics().director.checkpointHold).toEqual({
      line: 7,
      eventCursor: 4,
      worldTime: corrected.world_time,
      correctionEntityIds: ["meadow"],
      elapsedMs: 0,
      durationMs: 800,
      remainingMs: 800,
      segmentElapsedMs: 0,
      segmentDurationMs: 800,
      segmentRemainingMs: 800,
      focusTarget: {
        regionId: "meadow",
        kind: "region",
        entityId: null,
        segmentIndex: 0,
        segmentCount: 1,
        removed: false,
      },
    });
    expect(harness.session.getFrame().checkpointFocus).toEqual({
      regionId: "meadow",
      kind: "region",
      entityId: null,
      segmentIndex: 0,
      segmentCount: 1,
      removed: false,
    });
    harness.clock.advanceBy(800);
    expect(harness.session.diagnostics().director.checkpointHold).toBeNull();
    harness.session.dispose();
  });

  it("retains a grouped two-cursor lineage when an exact cursor-two checkpoint starts its hold", async () => {
    const manifest = getChronicleManifest("C01");
    const client = new FakeClient(
      makeRun({
        run_id: manifest.runId,
        seed: manifest.seed,
        event_cursor: manifest.initialSnapshot.event_cursor,
      }),
      [manifest.initialSnapshot],
    );
    const harness = liveHarness(client);
    await harness.session.ready;

    await client.streams[0]!.emit(envelope(manifest.entries, {
      cursor: 0,
      oldest_cursor: 1,
      next_cursor: 2,
    }));
    expect(harness.session.getFrame()).toMatchObject({
      firstCursor: 1,
      lastCursor: 2,
      scene: { momentId: expect.any(String) },
    });
    harness.clock.advanceTo(100_000);
    expect(harness.session.getFrame()).toMatchObject({
      firstCursor: 1,
      lastCursor: 2,
      presentedCursor: 2,
      scene: null,
    });

    const before = harness.session.getFrame();
    const beforePublication = harness.session.diagnostics().director.framePublicationSerial;
    const source = manifest.checkpoints[0]!;
    const corrected: ClassifiedCheckpointRecord = {
      ...source,
      line: source.line + 10,
      checkpoint: {
        ...source.checkpoint,
        snapshot: {
          ...source.checkpoint.snapshot,
          regions: source.checkpoint.snapshot.regions.map((region, index) => (
            index === 0
              ? { ...region, current_energy: region.current_energy + 7 }
              : region
          )),
        },
      },
    };

    harness.feed.emit(corrected);

    const held = harness.session.getFrame();
    expect(held).toMatchObject({
      firstCursor: 1,
      lastCursor: 2,
      presentedCursor: 2,
      revision: before.revision + 1,
      scene: null,
      checkpointFocus: expect.objectContaining({ segmentIndex: 0, segmentCount: 1 }),
    });
    expect(held.firstCursor).not.toBe(corrected.checkpoint.event_cursor);
    expect(harness.session.diagnostics().director).toMatchObject({
      framePublicationSerial: beforePublication + 1,
      checkpointHold: expect.objectContaining({ eventCursor: 2 }),
    });

    harness.clock.advanceBy(33);
    expect(harness.session.getFrame()).toBe(held);
    expect(harness.session.diagnostics().director).toMatchObject({
      framePublicationSerial: beforePublication + 1,
      checkpointHold: expect.objectContaining({ elapsedMs: 33 }),
    });
    harness.session.dispose();
  });

  it("publishes exactly once at each checkpoint focus boundary while preview timing stays observer-only", async () => {
    const initial = makeWorld({ run_id: "run-a", event_cursor: 4 });
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 4 }),
      [initial],
    );
    const harness = liveHarness(client);
    await harness.session.ready;
    const before = harness.session.diagnostics().director.framePublicationSerial;
    const corrected = makeWorld({
      run_id: "run-a",
      event_cursor: 4,
      world_time: initial.world_time + 1,
      homes: initial.homes.map((home) => ({
        ...home,
        integrity: home.integrity - 1,
      })),
      ruins: initial.ruins.map((ruin) => ({
        ...ruin,
        remnant_materials: ruin.remnant_materials - 1,
      })),
    });

    harness.feed.emit(checkpoint(7, corrected));
    const started = harness.session.diagnostics();
    expect(started.director.framePublicationSerial).toBe(before + 1);
    expect(started.director.checkpointHold).toMatchObject({
      durationMs: 1_600,
      focusTarget: { kind: "home", entityId: "home_001", segmentIndex: 0 },
    });

    harness.clock.advanceBy(33);
    const preview = harness.session.diagnostics();
    expect(preview.director.framePublicationSerial).toBe(before + 1);
    expect(preview.director.checkpointHold).toMatchObject({
      elapsedMs: 33,
      segmentElapsedMs: 33,
      focusTarget: { entityId: "home_001", segmentIndex: 0 },
    });

    harness.clock.advanceBy(767);
    const second = harness.session.diagnostics();
    expect(second.director.framePublicationSerial).toBe(before + 2);
    expect(second.director.checkpointHold).toMatchObject({
      elapsedMs: 800,
      segmentElapsedMs: 0,
      focusTarget: { kind: "ruin", entityId: "home_old", segmentIndex: 1 },
    });

    harness.clock.advanceBy(800);
    expect(harness.session.diagnostics().director).toMatchObject({
      framePublicationSerial: before + 3,
      checkpointHold: null,
    });
    harness.session.dispose();
  });

  it("routes active checkpoint line 65 through exactly one queue-overflow recovery", async () => {
    const initial = makeWorld({ run_id: "run-a", event_cursor: 5 });
    const recovered = makeWorld({
      run_id: "run-a",
      event_cursor: 9,
      world_time: initial.world_time + 4,
    });
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 5 }),
      [initial, recovered],
    );
    const runtime = new ClocklessRuntime();
    const harness = liveHarness(client, { runtimeFactory: () => runtime });
    await harness.session.ready;
    await client.streams[0].emit(envelope([staged(6, "active checkpoint pressure")], {
      cursor: 5,
      oldest_cursor: 6,
      next_cursor: 6,
    }));
    const safeAtFive = checkpoint(1, initial);
    for (let line = 1; line <= 65; line += 1) {
      expect(() => harness.feed.emit({ ...safeAtFive, line })).not.toThrow();
    }

    expect(runtime.safeCancelRequests).toEqual(["recovery:queue-overflow"]);
    expect(client.calls.filter((call) => call === "world")).toHaveLength(1);
    harness.feed.emit({ ...safeAtFive, line: 66 });
    expect(runtime.safeCancelRequests).toEqual(["recovery:queue-overflow"]);

    harness.clock.advanceTo(100_000);
    await flushPromises(12);
    expect(client.calls.filter((call) => call === "world")).toHaveLength(2);
    expect(harness.session.getFrame().presentedCursor).toBe(9);
    expect(harness.session.diagnostics().recovery.status).toBe("idle");
    harness.session.dispose();
  });

  it("lets RecoveryCoordinator own active-scene cancellation and waits for current settlement before fetch", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 5 }),
      [
        makeWorld({ run_id: "run-a", event_cursor: 5 }),
        makeWorld({ run_id: "run-a", event_cursor: 9 }),
      ],
    );
    const runtime = new ClocklessRuntime();
    const harness = liveHarness(client, { runtimeFactory: () => runtime });
    await harness.session.ready;
    await client.streams[0].emit(envelope([staged(6, "active")], { cursor: 5, next_cursor: 6 }));
    const priorNarrativeToken = harness.session.getFrame().scene?.execution?.sceneToken;
    expect(priorNarrativeToken).toBeTypeOf("number");
    const activeRevision = harness.session.getFrame().revision;
    const overflow = client.streams[0].emit(envelope([], {
      cursor: 6,
      oldest_cursor: 9,
      next_cursor: 9,
      overflow: true,
      snapshot_required: true,
    }));
    await flushPromises();
    expect(runtime.safeCancelRequests).toEqual(["recovery:queue-overflow"]);
    expect(client.calls.filter((call) => call === "world")).toHaveLength(1);

    harness.clock.advanceTo(100_000);
    expect(harness.session.getFrame().revision).toBeGreaterThan(activeRevision);
    expect(harness.session.getFrame()).toMatchObject({
      firstCursor: 6,
      lastCursor: 6,
      scene: { phase: "consequence" },
    });
    await overflow;
    await flushPromises(12);
    expect(client.calls.filter((call) => call === "world")).toHaveLength(2);
    expect(harness.session.getFrame().presentedCursor).toBe(9);
    await client.streams[1].emit(envelope([staged(10, "after recovery")], { cursor: 9, next_cursor: 10 }));
    const recoveredNarrativeToken = harness.session.getFrame().scene?.execution?.sceneToken;
    expect(recoveredNarrativeToken).toBeGreaterThan(priorNarrativeToken!);
    harness.session.dispose();
  });

  it("lets RecoveryCoordinator acquire visible-pressure cancellation before an active scene settles", async () => {
    const initial = makeWorld({ run_id: "run-a", event_cursor: 0 });
    const recovered = makeWorld({
      run_id: "run-a",
      event_cursor: 51,
      world_time: initial.world_time + 51,
    });
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 0 }),
      [initial, recovered],
    );
    const runtime = new ClocklessRuntime();
    const harness = liveHarness(client, { runtimeFactory: () => runtime });
    await harness.session.ready;

    await client.streams[0].emit(envelope([staged(1, "active before pressure")], {
      cursor: 0,
      next_cursor: 1,
    }));
    await client.streams[0].emit(envelope(
      Array.from({ length: 50 }, (_, index) => staged(index + 2, `pressure-${index + 2}`)),
      { cursor: 1, oldest_cursor: 2, next_cursor: 51 },
    ));

    expect(runtime.safeCancelRequests).toEqual(["recovery:queue-overflow"]);
    expect(harness.session.diagnostics()).toMatchObject({
      recovery: { status: "waiting-safe-boundary" },
      director: { pendingMoments: 48, activeSceneCount: 1 },
    });
    harness.clock.advanceTo(100_000);
    await flushPromises(12);

    expect(client.calls.filter((call) => call === "world")).toHaveLength(2);
    expect(harness.session.getFrame()).toMatchObject({
      presentedCursor: 51,
      scene: null,
    });
    expect(harness.session.diagnostics().recovery.status).toBe("idle");
    harness.session.dispose();
  });

  it("uses C13 pressure and hidden visibility as one bounded coordinator-owned recovery request", async () => {
    const manifest = getChronicleManifest("C13");
    const client = new FakeClient(
      makeRun({ run_id: manifest.runId, event_cursor: 0 }),
      [manifest.initialSnapshot, {
        ...structuredClone(manifest.initialSnapshot),
        event_cursor: manifest.expectedFinalCursor,
        world_time: manifest.initialSnapshot.world_time + manifest.expectedFinalCursor,
      }],
    );
    const harness = liveHarness(client);
    await harness.session.ready;
    harness.session.setHidden(true);
    await client.streams[0].emit(envelope(manifest.entries, {
      cursor: 0,
      oldest_cursor: 1,
      next_cursor: manifest.expectedFinalCursor,
    }));
    await flushPromises();
    expect(harness.session.getFrame().backlog.pendingMoments).toBeLessThanOrEqual(48);
    expect(client.calls.filter((call) => call === "world")).toHaveLength(1);

    harness.session.setHidden(false);
    harness.clock.advanceTo(100_000);
    await flushPromises(12);
    expect(client.calls.filter((call) => call === "world")).toHaveLength(2);
    expect(harness.session.getFrame().presentedCursor).toBe(manifest.expectedFinalCursor);
    expect(harness.session.getFrame().backlog.pendingMoments).toBe(0);
    expect(harness.session.getChronicle().gaps.at(-1)?.chapter).toBe("while-away");
    expect(harness.session.getChronicle().gaps.at(-1)).toMatchObject({
      firstCursor: 1,
      lastCursor: manifest.expectedFinalCursor,
    });
    harness.session.dispose();
  });

  it("includes pre-existing pending truth when two hidden arrivals tip total pressure", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 0 }),
      [
        makeWorld({ run_id: "run-a", event_cursor: 0 }),
        makeWorld({ run_id: "run-a", event_cursor: 50, world_time: 70 }),
      ],
    );
    const harness = liveHarness(client);
    await harness.session.ready;
    await client.streams[0].emit(envelope(
      Array.from({ length: 48 }, (_, index) => staged(index + 1, `visible-${index + 1}`)),
      { cursor: 0, oldest_cursor: 1, next_cursor: 48 },
    ));
    expect(harness.session.getFrame().lastCursor).toBe(1);
    harness.session.setHidden(true);
    await client.streams[0].emit(envelope([staged(49, "hidden-49"), staged(50, "hidden-50")], {
      cursor: 48,
      oldest_cursor: 49,
      next_cursor: 50,
    }));

    harness.session.setHidden(false);
    expect(harness.session.diagnostics().recovery).toEqual({
      status: "waiting-safe-boundary",
      digest: {
        skipped: { firstCursor: 2, lastCursor: 50 },
        majorMoments: [{ type: "agent_recovered", count: 49 }],
        compressedAmbientCount: 0,
      },
    });
    harness.clock.advanceTo(100_000);
    await flushPromises(12);
    expect(client.calls.filter((call) => call === "world")).toHaveLength(2);
    expect(harness.session.getFrame()).toMatchObject({
      presentedCursor: 50,
      backlog: { pendingMoments: 0 },
    });
    harness.session.dispose();
  });

  it("seeds hidden pressure after the pause transaction advances presented truth", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 0 }),
      [
        makeWorld({ run_id: "run-a", event_cursor: 0 }),
        makeWorld({ run_id: "run-a", event_cursor: 50, world_time: 70 }),
      ],
    );
    const clock = new LazyWallClock();
    const feed = new FakeCheckpointFeed();
    const session = createLivePresentationSession({
      clientFactory: () => client,
      clockFactory: () => clock,
      runtimeFactory: () => new SettleInOneAdvanceRuntime(),
      checkpointFeedFactory: () => feed,
      placementFactory: () => preparedPlacement(),
    });
    await session.ready;
    await client.streams[0].emit(envelope([staged(1, "visible-1")], {
      cursor: 0,
      oldest_cursor: 1,
      next_cursor: 1,
    }));
    await client.streams[0].emit(envelope(
      Array.from({ length: 48 }, (_, index) => staged(index + 2, `visible-${index + 2}`)),
      { cursor: 1, oldest_cursor: 2, next_cursor: 49 },
    ));
    expect(session.getFrame()).toMatchObject({ lastCursor: 1, backlog: { pendingMoments: 48 } });

    clock.jumpTo(100_000);
    session.setHidden(true);
    expect(session.getFrame()).toMatchObject({ lastCursor: 2, backlog: { pendingMoments: 47 } });
    await client.streams[0].emit(envelope([staged(50, "hidden-50")], {
      cursor: 49,
      oldest_cursor: 50,
      next_cursor: 50,
    }));

    expect(() => session.setHidden(false)).not.toThrow();
    await flushPromises(12);
    expect(client.calls.filter((call) => call === "world")).toHaveLength(1);
    expect(session.diagnostics().recovery.status).toBe("idle");
    session.dispose();
  });

  it("does not combine separate drained sub-threshold hidden intervals into false pressure", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 0 }),
      [makeWorld({ run_id: "run-a", event_cursor: 0 })],
    );
    const harness = liveHarness(client);
    await harness.session.ready;

    harness.session.setHidden(true);
    await client.streams[0].emit(envelope(
      Array.from({ length: 30 }, (_, index) => speak(index + 1, `first-${index + 1}`)),
      { cursor: 0, oldest_cursor: 1, next_cursor: 30 },
    ));
    harness.session.setHidden(false);
    harness.clock.advanceTo(1_000_000);
    expect(harness.session.getFrame().presentedCursor).toBe(30);

    harness.session.setHidden(true);
    await client.streams[0].emit(envelope(
      Array.from({ length: 30 }, (_, index) => speak(index + 31, `second-${index + 31}`)),
      { cursor: 30, oldest_cursor: 31, next_cursor: 60 },
    ));
    harness.session.setHidden(false);
    await flushPromises(12);

    expect(client.calls.filter((call) => call === "world")).toHaveLength(1);
    expect(harness.session.diagnostics().recovery.status).toBe("idle");
    harness.session.dispose();
  });

  it("recovers a visible C13 pressure burst once and clears every skipped pending moment", async () => {
    const manifest = getChronicleManifest("C13");
    const client = new FakeClient(
      makeRun({ run_id: manifest.runId, event_cursor: 0 }),
      [manifest.initialSnapshot, {
        ...structuredClone(manifest.initialSnapshot),
        event_cursor: manifest.expectedFinalCursor,
        world_time: manifest.initialSnapshot.world_time + manifest.expectedFinalCursor,
      }],
    );
    const harness = liveHarness(client);
    await harness.session.ready;

    // C13's 120 consecutive `speak` events are no longer a backlog at all: the
    // utterance lane clears every one of them without a lease. The recovery
    // path is guarded here with the same shape of burst, in the lane that can
    // still overflow.
    await client.streams[0].emit(envelope(
      Array.from({ length: manifest.expectedFinalCursor }, (_, index) => staged(index + 1)),
      { cursor: 0, oldest_cursor: 1, next_cursor: manifest.expectedFinalCursor },
    ));
    await flushPromises(12);

    expect(client.calls.filter((call) => call === "world")).toHaveLength(2);
    expect(harness.session.getFrame()).toMatchObject({
      presentedCursor: manifest.expectedFinalCursor,
      backlog: { pendingMoments: 0 },
    });
    expect(harness.session.getChronicle().gaps.at(-1)).toMatchObject({
      firstCursor: 1,
      lastCursor: manifest.expectedFinalCursor,
      chapter: "world-moved-ahead",
    });
    expect(harness.session.diagnostics()).toMatchObject({
      disposed: false,
      ingress: {
        ingestedCursor: manifest.expectedFinalCursor,
        acceptedCount: 0,
        lifetimeAcceptedCount: manifest.expectedFinalCursor,
        duplicateCount: 0,
        lifetimeDuplicateCount: 0,
        gaps: [],
      },
      director: {
        pendingMoments: 0,
        retainedChapters: 0,
        retainedPressureSummaries: 0,
        activeSceneCount: 0,
      },
      chronicle: { previous: 0, upcoming: 0, gaps: 1 },
      checkpoint: { retainedSafeCheckpoints: 0 },
    });
    harness.session.dispose();
    expect(harness.session.diagnostics()).toMatchObject({ disposed: true });
  });

  it("accounts for preloaded pending moments when a later visible batch tips pressure", async () => {
    const worldResponse = deferred<WorldSnapshot>();
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 0 }),
      [makeWorld({ run_id: "run-a", event_cursor: 0 })],
    );
    const harness = liveHarness(client);
    await harness.session.ready;
    client.deferWorld(worldResponse);
    await client.streams[0].emit(envelope(
      Array.from({ length: 30 }, (_, index) => staged(index + 1, `preloaded-${index + 1}`)),
      { cursor: 0, oldest_cursor: 1, next_cursor: 30 },
    ));

    await client.streams[0].emit(envelope(
      Array.from({ length: 30 }, (_, index) => staged(index + 31, `tipping-${index + 31}`)),
      { cursor: 30, oldest_cursor: 31, next_cursor: 60 },
    ));
    await flushPromises(8);

    expect(harness.session.diagnostics().recovery).toEqual({
      status: "waiting-safe-boundary",
      digest: {
        skipped: { firstCursor: 2, lastCursor: 60 },
        majorMoments: [{ type: "agent_recovered", count: 59 }],
        compressedAmbientCount: 0,
      },
    });
    expect(client.calls.filter((call) => call === "world")).toHaveLength(1);
    harness.session.dispose();
    worldResponse.resolve(makeWorld({ run_id: "run-a", event_cursor: 60 }));
  });

  it("freezes every non-overflow recovery by closing transport and ignores reconnect or late envelopes", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 4 }),
      [makeWorld({ run_id: "run-a", event_cursor: 4 })],
    );
    const harness = liveHarness(client);
    await harness.session.ready;
    const originalStream = client.streams[0];
    client.failWorld(new Error("checkpoint unavailable"));

    harness.feed.emitFault({ kind: "oversized-record", line: 3, retryable: false });
    await flushPromises(12);
    expect(originalStream.closed).toBe(true);
    // LAW CHANGE (spec §5.4): the held frame is the `recovery-paused` one published
    // at the freeze, so the chrome cannot keep saying "live" over a dead transport.
    const frozen = harness.session.getFrame();
    expect(frozen.transport).toMatchObject({ connection: "recovery-paused", retryable: true });
    expect(harness.session.diagnostics().recovery.status).toBe("frozen-retry");

    harness.session.reconnectStream();
    await originalStream.emit(envelope([speak(5, "late")], { cursor: 4, next_cursor: 5 }));
    expect(client.streams).toHaveLength(1);
    expect(harness.session.getFrame()).toEqual(frozen);

    client.queueWorld(makeWorld({ run_id: "run-a", event_cursor: 8, world_time: 20 }));
    await harness.session.retryRecovery();
    expect(client.streams).toHaveLength(2);
    expect(client.streams[1].cursor).toBe(8);
    harness.session.dispose();
  });

  it("freezes frame and Chronicle through placement failure, all observer interactions, and explicit retry", async () => {
    let placementFailures = 1;
    const placement = {
      prepareFromSnapshot: vi.fn((snapshot: WorldSnapshot) => {
        if (placementFailures > 0) {
          placementFailures -= 1;
          throw new Error("placement unavailable");
        }
        return { runId: snapshot.run_id, eventCursor: snapshot.event_cursor };
      }),
      commitPrepared: vi.fn(),
      rollbackPrepared: vi.fn(),
    };
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 4 }),
      [
        makeWorld({ run_id: "run-a", event_cursor: 4 }),
        makeWorld({ run_id: "run-a", event_cursor: 8, world_time: 20 }),
        makeWorld({ run_id: "run-a", event_cursor: 8, world_time: 20 }),
      ],
    );
    const harness = liveHarness(client, { placement });
    await harness.session.ready;
    await client.streams[0].emit(envelope([staged(5, "active")], { cursor: 4, next_cursor: 5 }));
    const beforeConsequence = harness.session.getFrame();
    const recovery = client.streams[0].emit(envelope([], {
      cursor: 5,
      oldest_cursor: 8,
      next_cursor: 8,
      overflow: true,
      snapshot_required: true,
    }));
    harness.clock.advanceTo(100_000);
    await recovery;
    await flushPromises(12);

    const frozenFrame = harness.session.getFrame();
    const frozenChronicle = harness.session.getChronicle();
    expect(frozenFrame).not.toBe(beforeConsequence);
    expect(frozenFrame.scene?.phase).toBe("consequence");
    expect(harness.session.diagnostics().recovery.status).toBe("frozen-retry");
    const controls = harness.session.controls();
    harness.session.select({ kind: "agent", id: "agent_002" });
    controls.pause();
    controls.resume("continue-from-summary");
    controls.setSpeed(2);
    controls.holdCurrentMoment(true);
    controls.viewMoment(frozenChronicle.now?.id ?? frozenChronicle.previous.at(-1)?.id ?? "5:5:single");
    harness.session.reconnectStream();
    harness.feed.emit(checkpoint(9, makeWorld({ run_id: "run-a", event_cursor: 9 })));
    harness.session.setHidden(true);

    expect(harness.session.getFrame()).toBe(frozenFrame);
    expect(harness.session.getChronicle()).toBe(frozenChronicle);
    expect(client.streams).toHaveLength(1);

    await harness.session.retryRecovery();
    expect(client.calls.filter((call) => call === "world")).toHaveLength(3);
    expect(placement.prepareFromSnapshot).toHaveBeenCalledTimes(2);
    expect(harness.session.getFrame()).toMatchObject({ presentedCursor: 8 });
    expect(harness.session.getChronicle()).not.toBe(frozenChronicle);
    expect(harness.session.diagnostics()).toMatchObject({ hidden: true, paused: true });
    harness.session.dispose();
  });

  it("exposes deterministic pause/resume choice, speed, hold, and moment-selection controls", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 5 }),
      [makeWorld({ run_id: "run-a", event_cursor: 5 })],
    );
    const harness = liveHarness(client);
    await harness.session.ready;
    await client.streams[0].emit(envelope([speak(6, "one"), speak(7, "two")], {
      cursor: 5,
      next_cursor: 7,
    }));
    const controls = harness.session.controls();
    controls.pause();
    controls.setSpeed(2);
    controls.holdCurrentMoment(true);
    expect(harness.session.diagnostics()).toMatchObject({ paused: true, speed: 2, held: true });
    const heldCursor = harness.session.getFrame().presentedCursor;
    harness.clock.advanceTo(100_000);
    expect(harness.session.getFrame().presentedCursor).toBe(heldCursor);

    controls.holdCurrentMoment(false);
    controls.resume("continue-from-summary");
    harness.clock.advanceTo(200_000);
    const moment = harness.session.getChronicle().previous[0];
    controls.viewMoment(moment.id);
    expect(harness.session.getFrame().selection).toMatchObject({ kind: "moment", id: moment.id });
    expect(harness.session.diagnostics()).toMatchObject({ paused: false, speed: 2, held: false });
    harness.session.dispose();
  });

  it("honors snap-to-live as an explicit bounded recovery choice instead of replaying queued moments", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 4 }),
      [
        makeWorld({ run_id: "run-a", event_cursor: 4 }),
        makeWorld({ run_id: "run-a", event_cursor: 8, world_time: 20 }),
      ],
    );
    const harness = liveHarness(client);
    await harness.session.ready;
    await client.streams[0].emit(envelope([staged(5, "active"), staged(6, "queued")], {
      cursor: 4,
      next_cursor: 6,
    }));
    harness.session.controls().pause();

    harness.session.controls().resume("snap-to-live");
    expect(client.calls.filter((call) => call === "world")).toHaveLength(1);
    harness.clock.advanceTo(100_000);
    expect(harness.session.getFrame()).toMatchObject({
      firstCursor: 5,
      lastCursor: 5,
      scene: { phase: "consequence" },
    });
    await flushPromises(12);

    expect(client.calls.filter((call) => call === "world")).toHaveLength(2);
    expect(harness.session.getFrame()).toMatchObject({
      presentedCursor: 8,
      backlog: { pendingMoments: 0 },
    });
    expect(harness.session.getChronicle().gaps.at(-1)).toMatchObject({
      firstCursor: 6,
      lastCursor: 8,
      chapter: "while-away",
    });
    harness.session.dispose();
  });

  it("resumes normally without recovery when snap-to-live is already caught up", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 4 }),
      [makeWorld({ run_id: "run-a", event_cursor: 4 })],
    );
    const harness = liveHarness(client);
    await harness.session.ready;
    harness.session.controls().pause();

    harness.session.controls().resume("snap-to-live");
    await flushPromises(12);

    expect(client.calls.filter((call) => call === "world")).toHaveLength(1);
    expect(harness.session.diagnostics()).toMatchObject({
      paused: false,
      recovery: { status: "idle" },
    });
    harness.session.dispose();
  });

  it("clears a held scene for recovery and preserves actual selected speed after the snap", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 4 }),
      [
        makeWorld({ run_id: "run-a", event_cursor: 4 }),
        makeWorld({ run_id: "run-a", event_cursor: 8, world_time: 20 }),
      ],
    );
    const harness = liveHarness(client);
    await harness.session.ready;
    await client.streams[0].emit(envelope([speak(5, "held")], { cursor: 4, next_cursor: 5 }));
    harness.session.controls().setSpeed(2);
    harness.session.controls().holdCurrentMoment(true);
    harness.session.controls().pause();

    const overflow = client.streams[0].emit(envelope([], {
      cursor: 5,
      oldest_cursor: 8,
      next_cursor: 8,
      overflow: true,
      snapshot_required: true,
    }));
    harness.clock.advanceTo(100_000);
    await overflow;
    await flushPromises(12);

    expect(harness.session.diagnostics()).toMatchObject({
      paused: false,
      speed: 2,
      held: false,
    });
    await client.streams[1].emit(envelope([resourceChanged(9, 90, 4)], {
      cursor: 8,
      next_cursor: 9,
    }));
    harness.clock.advanceBy(1_300);
    expect(harness.session.getFrame().presentedCursor).toBe(9);
    harness.session.dispose();
  });

  it("releases a manually paused active scene so checkpoint-413 can reach its safe boundary", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 5 }),
      [
        makeWorld({ run_id: "run-a", event_cursor: 5 }),
        makeWorld({ run_id: "run-a", event_cursor: 9, world_time: 22 }),
      ],
    );
    const harness = liveHarness(client);
    await harness.session.ready;
    await client.streams[0].emit(envelope([staged(6, "paused")], { cursor: 5, next_cursor: 6 }));
    harness.session.controls().pause();

    harness.feed.emitFault({ kind: "oversized-record", line: 4, retryable: false });
    expect(harness.session.diagnostics()).toMatchObject({
      paused: false,
      recovery: { status: "waiting-safe-boundary" },
    });
    harness.clock.advanceTo(100_000);
    await flushPromises(12);

    expect(client.calls.filter((call) => call === "world")).toHaveLength(2);
    expect(harness.session.getFrame().presentedCursor).toBe(9);
    harness.session.dispose();
  });

  it("builds Archive from C15 exact checkpoint truth without sharing model, selection, or disposal", async () => {
    const c15 = getChronicleManifest("C15");
    const liveClient = new FakeClient(
      makeRun({ run_id: c15.runId, event_cursor: 0 }),
      [c15.initialSnapshot],
    );
    const live = liveHarness(liveClient);
    await live.session.ready;
    const record = c15.checkpoints[0];
    const firstCursor = record.checkpoint.event_cursor;
    const entries = c15.entries.filter((entry) => entry.cursor > firstCursor);
    const lastCursor = entries.at(-1)?.cursor ?? firstCursor;
    const archive = createArchivePresentationSession({
      window: {
        sourceKey: `archive:${encodeURIComponent(c15.runId)}:line-${record.line}:window-${firstCursor}-${lastCursor}`,
        checkpointIndex: 0,
        checkpointLineNumber: record.line,
        checkpointReason: record.checkpoint.reason,
        checkpointWorldTime: record.checkpoint.world_time,
        firstCursor,
        lastCursor,
        snapshot: record.checkpoint.snapshot,
        entries,
      },
      clockFactory: createManualPresentationClock,
      runtimeFactory: () => new ClocklessRuntime(),
    });
    archive.select({ kind: "agent", id: c15.initialSnapshot.agents[0].id });
    expect(live.session.getFrame().selection).toBeNull();
    expect(archive.getFrame().world).not.toBe(live.session.getFrame().world);
    archive.dispose();
    expect(live.session.getFrame().runId).toBe(c15.runId);
    live.session.dispose();
  });

  it("survives reentrant binding changes and disposal without a stale clear", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 5 }),
      [makeWorld({ run_id: "run-a", event_cursor: 5 })],
    );
    const live = liveHarness(client);
    await live.session.ready;
    const archive = createArchivePresentationSession({
      window: archiveWindow("run-a", 2, 3),
      clockFactory: createManualPresentationClock,
      runtimeFactory: () => new ClocklessRuntime(),
    });
    const binding = createPresentationSessionBinding(live.session);
    let changed = false;
    binding.subscribe(() => {
      if (changed) return;
      changed = true;
      binding.bind(live.session);
      archive.dispose();
    });
    binding.bind(archive);
    expect(binding.getFrame().source).toBe("live");
    binding.dispose();
    binding.dispose();
    expect(live.session.getFrame().runId).toBe("run-a");
    live.session.dispose();
  });

  it("keeps same-run metadata, but a changed run invalidates stream, feed, fetch, retry, Archive, and thresholds", async () => {
    const recovery = deferred<WorldSnapshot>();
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 4 }),
      [makeWorld({ run_id: "run-a", event_cursor: 4 })],
    );
    const harness = liveHarness(client);
    await harness.session.ready;
    client.deferWorld(recovery);
    const originalRevision = harness.session.getFrame().revision;
    harness.session.acceptRunMetadata(makeRun({ run_id: "run-a", event_cursor: 99 }));
    expect(harness.session.getFrame().revision).toBe(originalRevision);

    const staleFetch = client.streams[0].emit(envelope([], {
      cursor: 4,
      oldest_cursor: 8,
      next_cursor: 8,
      overflow: true,
      snapshot_required: true,
    }));
    await flushPromises();
    harness.session.replaceRun(
      makeRun({ run_id: "run-b", event_cursor: 2, constants: {} }),
      makeWorld({ run_id: "run-b", event_cursor: 2 }),
    );
    expect(client.streams[0].closed).toBe(true);
    expect(harness.feed.resets.at(-1)).toEqual({ runId: "run-b", sourceKey: "live:run-b" });
    await client.streams[0].emit(envelope([speak(9, "stale stream")], { cursor: 8, next_cursor: 9 }));
    recovery.resolve(makeWorld({ run_id: "run-a", event_cursor: 8 }));
    await staleFetch;
    await flushPromises(12);
    await harness.session.retryRecovery();
    expect(harness.session.getFrame()).toMatchObject({ runId: "run-b", presentedCursor: 2 });
    harness.feed.emit(checkpoint(9, makeWorld({ run_id: "run-a", event_cursor: 9 })));
    expect(harness.session.getFrame().runId).toBe("run-b");
    harness.session.dispose();
  });

  it("creates and disposes one distinct placement generation per installed run", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 4 }),
      [makeWorld({ run_id: "run-a", event_cursor: 4 })],
    );
    const generations: Array<{ runId: string; dispose: ReturnType<typeof vi.fn> }> = [];
    const harness = liveHarness(client, {
      placementFactory: (snapshot) => {
        const dispose = vi.fn();
        generations.push({ runId: snapshot.run_id, dispose });
        return { ...preparedPlacement(), dispose };
      },
    });
    await harness.session.ready;
    expect(generations.map(({ runId }) => runId)).toEqual(["run-a"]);

    harness.session.replaceRun(
      makeRun({ run_id: "run-b", event_cursor: 2 }),
      makeWorld({ run_id: "run-b", event_cursor: 2 }),
    );
    expect(generations.map(({ runId }) => runId)).toEqual(["run-a", "run-b"]);
    expect(generations[0].dispose).toHaveBeenCalledOnce();

    harness.session.dispose();
    expect(generations[1].dispose).toHaveBeenCalledOnce();
  });

  it("atomically swaps the one production placement owner used by recovery and choreography", async () => {
    const initial = makeWorld({ run_id: "run-a", event_cursor: 4 });
    const client = new FakeClient(makeRun({ run_id: "run-a", event_cursor: 4 }), [initial]);
    const owners: ReturnType<typeof createPlacementGenerationOwner>[] = [];
    let currentOwner: ReturnType<typeof createPlacementGenerationOwner> | null = null;
    const session = createProductionLivePresentationSession({
      clientFactory: () => client,
      clockFactory: createManualPresentationClock,
      runtimeFactory: () => new ClocklessRuntime(),
      checkpointFeedFactory: () => new FakeCheckpointFeed(),
      placementFactory: (snapshot) => {
        const recipes = snapshot.regions.map((region) =>
          createRegionMapRecipe(createRegionMapIdentity(71, region, snapshot.regions)));
        currentOwner = createPlacementGenerationOwner(recipes, snapshot);
        owners.push(currentOwner);
        return currentOwner;
      },
      choreography: { getPlacementOwnerId: () => currentOwner!.ownerId },
      frameAcceptance: createPresentationFrameAcceptanceTracker(),
    });
    await session.ready;
    expect(session.getPlacementGeneration()).toBe(owners[0]);
    expect(session.getPlacementGeneration()?.snapshot()).toEqual(owners[0].snapshot());

    session.replaceRun(
      makeRun({ run_id: "run-b", event_cursor: 2 }),
      makeWorld({ run_id: "run-b", event_cursor: 2 }),
    );
    expect(owners).toHaveLength(2);
    expect(session.getPlacementGeneration()).toBe(owners[1]);
    expect(owners[0].generation()).toBeGreaterThan(0);
    expect(owners[1].runId).toBe("run-b");
    session.dispose();
  });

  // LAW CHANGE (spec §5.3): a stream error used to close the transport, publish
  // "offline", and stop — `reconnectStream()` had ZERO callers in the production app,
  // so a server restart, a proxy timeout or a laptop sleep ended the live view until
  // someone reloaded the page. It now rejoins on a capped backoff. What has NOT
  // changed: no `getWorld` — a transport fault is not a world fault, and rejoining at
  // the same cursor either resumes or reports overflow, which recovery already owns.
  it("rejoins a dropped stream on a backoff without re-fetching the world", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 5 }),
      [makeWorld({ run_id: "run-a", event_cursor: 5 })],
    );
    const harness = liveHarness(client);
    await harness.session.ready;
    client.streams[0].fail(new Error("stream lost"));
    await flushPromises(12);
    expect(client.calls).toEqual(["run", "world", "stream:5"]);
    expect(harness.session.getFrame().transport).toMatchObject({
      connection: "offline",
      retryable: true,
    });

    harness.clock.advanceBy(1_000);
    expect(client.calls).toEqual(["run", "world", "stream:5", "stream:5"]);
    expect(client.calls.filter((call) => call === "world")).toHaveLength(1);

    // Each failure backs off further, and the cap holds it at one attempt per 15s.
    const delays = [2_000, 4_000, 8_000, 15_000, 15_000];
    for (const delay of delays) {
      const stream = client.streams.at(-1)!;
      stream.fail(new Error("stream lost again"));
      await flushPromises(4);
      harness.clock.advanceBy(delay - 1);
      const before = client.streams.length;
      harness.clock.advanceBy(1);
      expect(client.streams.length, `backoff ${delay}`).toBe(before + 1);
    }
    expect(client.calls.filter((call) => call === "world")).toHaveLength(1);
    harness.session.dispose();
  });

  // The transport used to default to "live" on every publication, so the director's
  // own `subscribe(() => publish())` repainted a dead socket as live within
  // milliseconds — measured in the browser: `activeStreams: 0` while the pill read
  // LIVE. Transport is now owned; only a caller with real evidence changes it.
  it("does not repaint a dead transport as live on the next scene tick", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 5 }),
      [makeWorld({ run_id: "run-a", event_cursor: 5 })],
    );
    const harness = liveHarness(client);
    await harness.session.ready;
    client.streams[0].fail(new Error("stream lost"));
    await flushPromises(12);
    expect(harness.session.getFrame().transport).toMatchObject({ connection: "offline" });

    // Any selection, tick or chronicle change publishes a frame; none of them know
    // anything about the socket.
    harness.session.select({ kind: "agent", id: "agent_001" });
    harness.clock.advanceBy(200);
    expect(harness.session.getFrame().transport).toMatchObject({
      connection: "offline",
      retryable: true,
    });

    harness.clock.advanceBy(1_000);
    expect(harness.session.getFrame().transport).toMatchObject({ connection: "live" });
    harness.session.dispose();
  });

  it("clears the rejoin backoff once the stream speaks again", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 5 }),
      [makeWorld({ run_id: "run-a", event_cursor: 5 })],
    );
    const harness = liveHarness(client);
    await harness.session.ready;
    client.streams[0].fail(new Error("stream lost"));
    harness.clock.advanceBy(1_000);
    client.streams[1].fail(new Error("stream lost"));
    harness.clock.advanceBy(2_000);
    expect(client.streams).toHaveLength(3);

    // A heartbeat alone proves the socket is alive, so the next drop starts over.
    client.streams[2].heartbeat(41);
    expect(harness.session.getFrame().liveness).toMatchObject({
      lastSignalWasHeartbeat: true,
      heartbeatWorldTime: 41,
    });
    client.streams[2].fail(new Error("stream lost"));
    harness.clock.advanceBy(1_000);
    expect(client.streams).toHaveLength(4);
    harness.session.dispose();
  });

  it("stops rejoining when the session is disposed mid-backoff", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 5 }),
      [makeWorld({ run_id: "run-a", event_cursor: 5 })],
    );
    const harness = liveHarness(client);
    await harness.session.ready;
    client.streams[0].fail(new Error("stream lost"));
    harness.session.dispose();
    harness.clock.advanceBy(60_000);
    expect(client.streams).toHaveLength(1);
  });

  it("still reconnects immediately on an explicit request, without getWorld", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 5 }),
      [makeWorld({ run_id: "run-a", event_cursor: 5 })],
    );
    const harness = liveHarness(client);
    await harness.session.ready;
    client.streams[0].fail(new Error("stream lost"));
    await flushPromises(12);

    harness.session.reconnectStream();
    expect(client.calls).toEqual(["run", "world", "stream:5", "stream:5"]);
    // The explicit reconnect superseded the scheduled one rather than racing it.
    harness.clock.advanceBy(60_000);
    expect(client.streams).toHaveLength(2);
    harness.session.dispose();
  });

  // LAW CHANGE (spec §5.4): `frozen-retry` used to be exitable ONLY by the HUD button,
  // and recovery re-fetched `/api/world` alone — so a run that restarted under the
  // observer stayed frozen forever and the button failed identically. Recovery now
  // re-reads `/api/run` first and adopts a new run instead of latching on the old one.
  it("un-latches a frozen recovery on a backoff and adopts a restarted run", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 4 }),
      [makeWorld({ run_id: "run-a", event_cursor: 4 })],
    );
    const harness = liveHarness(client);
    await harness.session.ready;
    client.failWorld(new Error("world lagging the cursor"));

    await client.streams[0].emit(envelope([], {
      cursor: 4,
      oldest_cursor: 8,
      next_cursor: 8,
      overflow: true,
      snapshot_required: true,
    }));
    await flushPromises(12);
    expect(harness.session.diagnostics().recovery.status).toBe("frozen-retry");

    client.replaceRun(makeRun({ run_id: "run-b", event_cursor: 2 }));
    client.queueWorld(makeWorld({ run_id: "run-b", event_cursor: 2 }));
    harness.clock.advanceBy(1_000);
    await flushPromises(24);

    expect(client.calls.filter((call) => call === "run")).toHaveLength(2);
    expect(harness.session.getFrame()).toMatchObject({
      runId: "run-b",
      presentedCursor: 2,
      transport: { connection: "live" },
    });
    harness.session.dispose();
  });

  it("un-latches a frozen recovery on a backoff when the same run recovers", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 4 }),
      [makeWorld({ run_id: "run-a", event_cursor: 4 })],
    );
    const harness = liveHarness(client);
    await harness.session.ready;
    client.failWorld(new Error("world lagging the cursor"));

    await client.streams[0].emit(envelope([], {
      cursor: 4,
      oldest_cursor: 8,
      next_cursor: 8,
      overflow: true,
      snapshot_required: true,
    }));
    await flushPromises(12);
    expect(harness.session.diagnostics().recovery.status).toBe("frozen-retry");

    client.queueWorld(makeWorld({ run_id: "run-a", event_cursor: 8 }));
    harness.clock.advanceBy(1_000);
    await flushPromises(24);

    expect(harness.session.getFrame().presentedCursor).toBe(8);
    expect(harness.session.diagnostics().recovery.status).not.toBe("frozen-retry");
    harness.session.dispose();
  });

  it("permits a lower cursor only when replacing the run", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 5 }),
      [makeWorld({ run_id: "run-a", event_cursor: 5 })],
    );
    const harness = liveHarness(client);
    await harness.session.ready;
    expect(() => harness.session.replaceRun(
      makeRun({ run_id: "run-a", event_cursor: 2 }),
      makeWorld({ run_id: "run-a", event_cursor: 2 }),
    )).toThrow("same-run reset cannot move behind");
    expect(() => harness.session.replaceRun(
      makeRun({ run_id: "run-b", event_cursor: 2 }),
      makeWorld({ run_id: "run-b", event_cursor: 2 }),
    )).not.toThrow();
    expect(harness.session.getFrame().presentedCursor).toBe(2);
    harness.session.dispose();
  });

  it("never leaks a future checkpoint through HUD, atlas, selection, dialogue, or Chronicle", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 5 }),
      [makeWorld({ run_id: "run-a", event_cursor: 5 })],
    );
    const harness = liveHarness(client);
    await harness.session.ready;
    harness.session.select({ kind: "agent", id: "agent_001" });
    const before = harness.session.getFrame();
    harness.feed.emit(checkpoint(1, makeWorld({
      run_id: "run-a",
      event_cursor: 9,
      agents: [],
      regions: [],
      homes: [],
      ruins: [],
    })));
    const frame = harness.session.getFrame();
    const chronicle = harness.session.getChronicle();
    expect(selectPresentedHud(frame)).toEqual(selectPresentedHud(before));
    expect(selectLivingAtlas(frame, chronicle)).toEqual(selectLivingAtlas(before, chronicle));
    expect(selectPresentedSelection(frame, chronicle)).toEqual(
      selectPresentedSelection(before, chronicle),
    );
    expect(selectPresentedDialogue(frame, chronicle)).toBeNull();
    expect(selectPresentedChronicle(frame, chronicle)).toEqual(chronicle);
    harness.session.dispose();
  });

  // OWNER DECISION (Safi, 2026-07-25) "SELF_TALK RENDERS OPENLY" —
  // .superpowers/sdd/progress.md. Private self-talk was previously hidden
  // from `now` and from active dialogue for every non-matching selection
  // surface. That gate was reversed deliberately: PRIVATE only means other
  // BEINGS never perceive the thought; the viewer is not a being, so the
  // moment is shown for every selection surface, including no selection at
  // all. Do not restore the old gate as a regression fix.
  it("shows C17 private self-talk for every absent or nonmatching selection surface", async () => {
    const c17 = getChronicleManifest("C17");
    const privateEntry = c17.entries.find((entry) => entry.event.scope === "private")!;
    const client = new FakeClient(
      makeRun({ run_id: c17.runId, event_cursor: 0 }),
      [c17.initialSnapshot],
    );
    const harness = liveHarness(client);
    await harness.session.ready;
    const privateAtOne = { ...privateEntry, cursor: 1 };
    await client.streams[0].emit(envelope([privateAtOne], { cursor: 0, next_cursor: 1 }));
    for (const selection of [
      null,
      { kind: "agent" as const, id: "not-source" },
      { kind: "region" as const, id: "warm_springs" },
      { kind: "home" as const, id: "home_missing" },
      { kind: "moment" as const, id: "1:1:single", firstCursor: 1, lastCursor: 1 },
    ]) {
      harness.session.select(selection);
      // The overlay lane presents a thought without ever staging it, so it is
      // disclosed through `previous` rather than `now`. What this guards is
      // unchanged: every selection surface sees it, including no selection.
      expect(harness.session.getChronicle().previous.at(-1)?.representative.cursor).toBe(1);
      // Dialogue stays null here because no scene has been driven active in
      // this synchronous harness (unrelated to the privacy gate, which is
      // asserted via `previous` above).
      expect(selectPresentedDialogue(harness.session.getFrame(), harness.session.getChronicle()))
        .toBeNull();
    }
    harness.session.select({ kind: "agent", id: privateEntry.event.source });
    expect(harness.session.getChronicle().previous.at(-1)?.representative.cursor).toBe(1);
    harness.session.dispose();
  });

  // OWNER DECISION (Safi, 2026-07-25) "SELF_TALK RENDERS OPENLY" —
  // .superpowers/sdd/progress.md. `isPendingMomentVisible` (the second,
  // independent gate found alongside `isMomentVisible` in selectors.ts) was
  // reversed deliberately: it previously withheld a pending private
  // self-talk moment from the `upcoming` queue and Atlas queued-importance
  // pips until the source agent was selected. PRIVATE only hides a thought
  // from other BEINGS, never from the viewer, so pending private self-talk
  // now discloses regardless of selection. Do not restore this gate as a
  // regression fix.
  //
  // AND, since the 2026-07-31 two-lane split, a private thought is never
  // *pending* at all: the overlay lane presents it the instant it arrives,
  // without a stage lease. That is strictly stronger than "disclosed while
  // queued", and it is asserted here directly. The queue-disclosure shape the
  // gate governs is asserted alongside it on a moment that can still queue.
  it("discloses private self-talk immediately, and queued truth, regardless of selection", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 0 }),
      [makeWorld({ run_id: "run-a", event_cursor: 0 })],
    );
    const harness = liveHarness(client);
    await harness.session.ready;
    const privateThought = {
      ...selfTalk(2, "agent_002", "private future"),
      event: {
        ...selfTalk(2, "agent_002", "private future").event,
        region: "meadow",
      },
      resolved: { actor_id: "agent_002", region: "meadow" },
    };
    await client.streams[0].emit(envelope([staged(1, "public now"), privateThought, staged(3)], {
      cursor: 0,
      oldest_cursor: 1,
      next_cursor: 3,
    }));

    const expectDisclosed = (): void => {
      const chronicle = harness.session.getChronicle();
      expect(chronicle.previous.some((moment) =>
        moment.representative.event.payload.message === "private future")).toBe(true);
      expect(chronicle.upcoming).toEqual([
        { sequence: 3, regionId: "meadow", urgency: "featured" },
      ]);
      expect(Object.keys(chronicle.upcoming[0])).toEqual(["sequence", "regionId", "urgency"]);
      expect(selectLivingAtlas(harness.session.getFrame(), chronicle).regions
        .find((region) => region.id === "meadow")?.queuedImportance.featured).toBe(1);
    };

    for (const selection of [null, { kind: "agent" as const, id: "agent_001" }]) {
      harness.session.select(selection);
      expectDisclosed();
    }
    harness.session.select({ kind: "agent", id: "agent_002" });
    expectDisclosed();
    harness.session.dispose();
  });

  // OWNER DECISION (Safi, 2026-07-25) "SELF_TALK RENDERS OPENLY" —
  // .superpowers/sdd/progress.md. `isPendingMomentVisible` now unconditionally
  // returns true; the prior selection-matching gate on grouped pending
  // private self-talk placeholders was reversed deliberately and must not be
  // restored as a regression fix.
  it("shows a grouped pending placeholder regardless of private self-talk source or selection", () => {
    const agentOne = selfTalk(1, "agent_001", "one");
    const agentTwo = selfTalk(2, "agent_002", "two");
    const mixedPrivate = pendingMoment([agentOne, agentTwo]);
    expect(isPendingMomentVisible(mixedPrivate, { kind: "agent", id: "agent_001" })).toBe(true);
    expect(isPendingMomentVisible(mixedPrivate, { kind: "agent", id: "agent_002" })).toBe(true);

    const publicAndPrivate = pendingMoment([speak(1, "public"), agentTwo]);
    expect(isPendingMomentVisible(publicAndPrivate, { kind: "agent", id: "agent_001" }))
      .toBe(true);
    expect(isPendingMomentVisible(publicAndPrivate, { kind: "agent", id: "agent_002" }))
      .toBe(true);

    const sameSource = pendingMoment([
      selfTalk(1, "agent_001", "first"),
      selfTalk(2, "agent_001", "second"),
    ]);
    expect(isPendingMomentVisible(sameSource, { kind: "agent", id: "agent_001" })).toBe(true);
  });

  it("validates every Archive checkpoint/window identity field at the exported boundary", () => {
    const valid = archiveWindow("run/a b", 2, 3);
    expect(() => createArchivePresentationSession({
      window: valid,
      clockFactory: createManualPresentationClock,
      runtimeFactory: () => new ClocklessRuntime(),
    })).not.toThrow();

    const malformed: Array<[string, ReplayPresentationWindow]> = [
      ["time", { ...valid, checkpointWorldTime: valid.checkpointWorldTime + 1 }],
      ["first", { ...valid, firstCursor: 1 }],
      ["gap", { ...valid, entries: [{ ...valid.entries[0], cursor: 4 }], lastCursor: 4, sourceKey: archiveSource("run/a b", 2, 4) }],
      ["regression", { ...valid, entries: [{ ...valid.entries[0], cursor: 2 }], lastCursor: 2, sourceKey: archiveSource("run/a b", 2, 2) }],
      ["final", { ...valid, lastCursor: 4, sourceKey: archiveSource("run/a b", 2, 4) }],
      ["source", { ...valid, sourceKey: "archive:forged" }],
      ["index", { ...valid, checkpointIndex: -1 }],
      ["line", { ...valid, checkpointLineNumber: 0 }],
    ];
    for (const [label, window] of malformed) {
      expect(() => createArchivePresentationSession({
        window,
        clockFactory: createManualPresentationClock,
        runtimeFactory: () => new ClocklessRuntime(),
      }), label).toThrow();
    }
  });

  it("buffers reentrant session emission and stops peer notification after terminal disposal", async () => {
    const client = new FakeClient(
      makeRun({ run_id: "run-a", event_cursor: 4 }),
      [makeWorld({ run_id: "run-a", event_cursor: 4 })],
    );
    const harness = liveHarness(client);
    await harness.session.ready;
    const healthy = vi.fn();
    let reentered = false;
    harness.session.subscribe(() => {
      if (reentered) return;
      reentered = true;
      harness.session.select({ kind: "region", id: "meadow" });
    });
    harness.session.subscribe(healthy);
    harness.session.select({ kind: "agent", id: "agent_001" });
    expect(healthy).toHaveBeenCalledTimes(2);
    expect(harness.session.getFrame().selection).toEqual({ kind: "region", id: "meadow" });

    const later = vi.fn();
    harness.session.subscribe(() => harness.session.dispose());
    harness.session.subscribe(later);
    harness.session.select({ kind: "agent", id: "agent_002" });
    expect(later).not.toHaveBeenCalled();
  });

  // ---------------------------------------------------------------------------
  // BUBBLES-FIX 2026-08-21 — the live-transport-only defect. Measured on two real runs:
  // the killfeed and every speech/thought bubble stopped a few seconds in, while
  // `ingress.lifetimeAcceptedCount` climbed to 145, `pendingMoments` stayed 0, nothing was
  // paused, deferred, unpresentable or faulted, and the transport read LIVE throughout.
  // Cause: the checkpoint feed advanced the ingress delivery watermark past events still in
  // flight on SSE; those were then dropped as duplicates, the director's cursor contiguity
  // broke, and its `RangeError` was eaten by the ingress's observer-isolation catch.
  // ---------------------------------------------------------------------------
  it("keeps presenting after a live checkpoint arrives ahead of the delivered stream", async () => {
    const run = makeRun({ run_id: "run-a", seed: 71, event_cursor: 0 });
    const client = new FakeClient(run, [makeWorld({ run_id: "run-a", event_cursor: 0 })]);
    const { session, clock, feed } = liveHarness(client);
    await session.ready;

    await client.streams[0]!.emit(envelope([speak(1, "Aster speaks once.")], {
      cursor: 0, oldest_cursor: 1, next_cursor: 1,
    }));
    clock.advanceTo(20_000);
    expect(session.diagnostics().chronicle.previous).toBe(1);

    // A world-tick checkpoint naming a cursor the stream has NOT delivered yet.
    feed.emit(checkpoint(4, makeWorld({ run_id: "run-a", event_cursor: 5, world_time: 40 })));

    // The stream now delivers exactly those events, contiguously from where it left off.
    await client.streams[0]!.emit(envelope(
      [speak(2, "Two."), speak(3, "Three."), speak(4, "Four."), speak(5, "Five.")],
      { cursor: 1, oldest_cursor: 2, next_cursor: 5 },
    ));
    clock.advanceTo(60_000);

    expect(session.diagnostics().chronicle.previous).toBe(5);
    expect(session.getFrame().presentedCursor).toBe(5);
    expect(session.diagnostics().ingress.refusedBatchCount).toBe(0);
    session.dispose();
  });


});

function liveHarness(
  client: FakeClient,
  options: Readonly<{
    placement?: PreparedRecoveryPlacementPort;
    placementFactory?: (snapshot: WorldSnapshot) => PreparedRecoveryPlacementPort;
    runtimeFactory?: () => SceneRuntimePort;
  }> = {},
) {
  const clock = createManualPresentationClock();
  const feed = new FakeCheckpointFeed();
  const session = createLivePresentationSession({
    clientFactory: () => client,
    clockFactory: () => clock,
    runtimeFactory: options.runtimeFactory ?? (() => new ClocklessRuntime()),
    checkpointFeedFactory: () => feed,
    placementFactory: options.placementFactory
      ?? (() => options.placement ?? preparedPlacement()),
  });
  return { session, clock, feed };
}

interface CompletedRecoveryReceipt {
  readonly reason: RecoveryReason;
  readonly digest: RecoveryDigest;
  readonly snappedCursor: number;
}

type CompletedRecoveryDiagnostics = PresentationSessionDiagnostics & Readonly<{
  lastCompletedRecovery: CompletedRecoveryReceipt | null;
}>;

function completedRecoveryDiagnostics(session: PresentationSession): CompletedRecoveryDiagnostics {
  return session.diagnostics() as CompletedRecoveryDiagnostics;
}

async function completedOverflowHarness(): Promise<Readonly<{
  session: PresentationSession;
  client: FakeClient;
}>> {
  const client = new FakeClient(
    makeRun({ run_id: "run-a", event_cursor: 3 }),
    [
      makeWorld({ run_id: "run-a", event_cursor: 3 }),
      makeWorld({ run_id: "run-a", event_cursor: 4 }),
    ],
  );
  const harness = liveHarness(client);
  await harness.session.ready;
  expect(completedRecoveryDiagnostics(harness.session).lastCompletedRecovery).toBeNull();
  await client.streams[0]!.emit(envelope([], {
    cursor: 3,
    oldest_cursor: 4,
    next_cursor: 4,
    overflow: true,
    snapshot_required: true,
  }));
  await flushPromises(12);
  return { session: harness.session, client };
}

function preparedPlacement(): PreparedRecoveryPlacementPort {
  return {
    prepareFromSnapshot: vi.fn((snapshot: WorldSnapshot) => ({
      runId: snapshot.run_id,
      eventCursor: snapshot.event_cursor,
    })),
    commitPrepared: vi.fn(),
    rollbackPrepared: vi.fn(),
  };
}

class FakeStream implements EventStream {
  closed = false;

  constructor(
    readonly cursor: number,
    readonly handlers: EventStreamHandlers,
    readonly url = `/api/events/stream?cursor=${cursor}`,
  ) {}

  close(): void {
    this.closed = true;
  }

  async emit(value: EventEnvelope): Promise<void> {
    await this.handlers.onEnvelope(value);
  }
  fail(error: unknown): void {
    this.handlers.onError?.(error);
  }
  heartbeat(worldTime: number, cursor = this.cursor): void {
    this.handlers.onHeartbeat?.({ cursor, worldTime, status: "running" });
  }
}

const CAUSAL_FACTORIES: ProductionSceneFactories = {
  createActor(input) {
    return new LayeredHumanActor({
      id: input.record.value.id!,
      name: input.record.value.name!,
      persona: input.record.value.persona,
      position: input.position,
      facing: input.facing,
      manifest: input.manifest,
      atlasLeases: input.atlasLeases,
      reducedMotion: input.reducedMotion,
    });
  },
  createHome(input) {
    return new HomeActor({
      id: input.id,
      manifest: input.manifest,
      atlasLeases: input.atlasLeases,
      initial: input.presented,
    });
  },
  createEnvironment(input) { return new EnvironmentSystem(input); },
};

class CausalAtlasPool implements SharedAtlasPool {
  private readonly ready = new Map<string, ImageBitmap>();

  async acquire(id: string): Promise<ProductionAssetLease<ImageBitmap>> {
    const bitmap = this.ready.get(id) ?? this.bitmap(id);
    this.ready.set(id, bitmap);
    return { value: bitmap, release: () => undefined };
  }

  retain(id: string): ProductionAssetLease<ImageBitmap> {
    const bitmap = this.ready.get(id);
    if (bitmap === undefined) throw new Error(`atlas ${id} is not ready`);
    return { value: bitmap, release: () => undefined };
  }

  diagnostics(): ReturnType<SharedAtlasPool["diagnostics"]> {
    return {
      disposed: false,
      compressedBytes: 0,
      decodedBytes: 0,
      leases: 0,
      expectedActiveCompressedBytes: 0,
      activeCompressedMax: 0,
      currentUiCompressedBytes: 0,
      overBudget: false,
      inFlightCount: 0,
      waiterCount: 0,
      closeCount: 0,
      abortCount: 0,
      failureCount: 0,
      activeAtlasIds: [...this.ready.keys()],
      entries: [],
      lifecycle: { acquireCalls: 0, retainCalls: 0, decodeStarts: 0, leasesCreated: 0, leasesReleased: 0, peakLeases: 0 },
    };
  }

  dispose(): void { this.ready.clear(); }

  private bitmap(id: string): ImageBitmap {
    const descriptor = PRODUCTION_ASSET_MANIFEST.atlases[id]!;
    return {
      width: descriptor.width,
      height: descriptor.height,
      close: () => undefined,
    } as unknown as ImageBitmap;
  }
}

class CausalFrameDriver implements FrameDriver {
  private serial = 0;
  request(_callback: FrameRequestCallback): number { this.serial += 1; return this.serial; }
  cancel(_handle: number): void {}
  now(): number { return 0; }
}

class CausalWakeScheduler implements WakeScheduler {
  private serial = 0;
  schedule(_atMs: number, _callback: () => void): number { this.serial += 1; return this.serial; }
  cancel(_handle: number): void {}
  now(): number { return 0; }
}

class CausalAtlasCommitScheduler implements AtlasCommitScheduler {
  schedule(callback: () => void): number {
    callback();
    return 1;
  }

  cancel(_handle: number): void {}
}

class CausalVisibilityTarget extends EventTarget {
  readonly hidden = false;
}

function causalCanvasContext(): Partial<CanvasRenderingContext2D> {
  return {
    imageSmoothingEnabled: false,
    clearRect: () => undefined,
    fillRect: () => undefined,
    drawImage: () => undefined,
    createPattern: () => ({}) as CanvasPattern,
    save: () => undefined,
    restore: () => undefined,
    setTransform: () => undefined,
  };
}

async function causalSettle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

class FakeClient implements LiveApiClient {
  readonly calls: string[] = [];
  readonly streams: FakeStream[] = [];
  getEventsCalls = 0;
  private readonly worldFailures: unknown[] = [];
  private readonly worldDeferrals: Array<Deferred<WorldSnapshot>> = [];

  constructor(
    private run: RunMetadata,
    private readonly worlds: WorldSnapshot[],
  ) {}

  queueWorld(snapshot: WorldSnapshot): void {
    this.worlds.push(snapshot);
  }

  failWorld(error: unknown): void {
    this.worldFailures.push(error);
  }

  deferWorld(value: Deferred<WorldSnapshot>): void {
    this.worldDeferrals.push(value);
  }

  replaceRun(run: RunMetadata): void {
    this.run = run;
  }

  async getRun(): Promise<RunMetadata> {
    this.calls.push("run");
    return this.run;
  }

  async getWorld(): Promise<WorldSnapshot> {
    this.calls.push("world");
    const deferredValue = this.worldDeferrals.shift();
    if (deferredValue !== undefined) return deferredValue.promise;
    const failure = this.worldFailures.shift();
    if (failure !== undefined) throw failure;
    const snapshot = this.worlds.shift();
    if (snapshot === undefined) throw new Error("no queued world");
    return snapshot;
  }

  async getEvents(): Promise<EventEnvelope> {
    this.getEventsCalls += 1;
    throw new Error("polling is forbidden");
  }

  openEventStream(cursor: number, handlers: EventStreamHandlers): EventStream {
    this.calls.push(`stream:${cursor}`);
    const stream = new FakeStream(cursor, handlers);
    this.streams.push(stream);
    return stream;
  }
}

class FakeCheckpointFeed implements CheckpointFeed {
  disposed = false;
  readonly starts: Array<{ runId: string; sourceKey: string }> = [];
  readonly resets: Array<{ runId: string; sourceKey: string }> = [];
  private readonly listeners = new Set<Parameters<CheckpointFeed["subscribe"]>[0]>();
  private readonly faultListeners = new Set<Parameters<CheckpointFeed["subscribeFault"]>[0]>();

  start(identity: { runId: string; sourceKey: string }): void {
    this.starts.push(identity);
  }
  reset(identity: { runId: string; sourceKey: string }): void {
    this.resets.push(identity);
  }
  subscribe(listener: Parameters<CheckpointFeed["subscribe"]>[0]): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  subscribeFault(listener: Parameters<CheckpointFeed["subscribeFault"]>[0]): () => void {
    this.faultListeners.add(listener);
    return () => this.faultListeners.delete(listener);
  }
  diagnostics(): ReturnType<CheckpointFeed["diagnostics"]> {
    return {
      disposed: this.disposed,
      runId: null,
      lastDeliveredLine: 0,
      polling: false,
      retainedSafeCheckpoints: 0,
      faultCount: 0,
    };
  }
  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
    this.faultListeners.clear();
  }
  emit(record: ClassifiedCheckpointRecord): void {
    for (const listener of [...this.listeners]) listener(record);
  }
  emitFault(fault: Parameters<Parameters<CheckpointFeed["subscribeFault"]>[0]>[0]): void {
    for (const listener of [...this.faultListeners]) listener(fault);
  }
}

class ClocklessRuntime implements SceneRuntimePort {
  readonly safeCancelRequests: string[] = [];
  private token = 0;
  private program: SceneRuntimeStart["program"] | null = null;
  private consequenceSent = false;
  private acknowledged = false;
  private boundarySent = false;
  private settled = false;
  private cancelRequested = false;
  private cancelGeneration = 0;

  start(input: SceneRuntimeStart, _identity: FrameIdentity): number {
    this.token += 1;
    this.program = input.program;
    this.consequenceSent = false;
    this.acknowledged = false;
    this.boundarySent = false;
    this.settled = false;
    this.cancelRequested = false;
    this.cancelGeneration = 0;
    return this.token;
  }
  advance(nowMs: number): readonly SceneRuntimeSignal[] {
    if (this.program === null) return [];
    const result: SceneRuntimeSignal[] = [];
    const consequenceAt = this.program.phaseWindows.find(
      (window) => window.phase === "consequence",
    )?.startMs ?? 0;
    if (!this.consequenceSent && nowMs >= consequenceAt) {
      this.consequenceSent = true;
      result.push({
        kind: "consequence-marker",
        sceneToken: this.token,
        marker: this.program.consequenceMarker,
      });
    }
    if (this.acknowledged && !this.boundarySent) {
      this.boundarySent = true;
      result.push({
        kind: "safe-cancel-ack",
        sceneToken: this.token,
        cancelApplied: this.cancelRequested,
        cancelGeneration: this.cancelGeneration,
      });
    }
    if (this.boundarySent && !this.settled && nowMs >= this.program.durationMs) {
      this.settled = true;
      result.push({ kind: "scene-settled", sceneToken: this.token });
    }
    return result;
  }
  acknowledgePublishedConsequence(
    _sceneToken: number,
    _publishedRevision: number,
    cancelRequested: boolean,
    cancelGeneration: number,
  ): void {
    this.acknowledged = true;
    this.cancelRequested = cancelRequested;
    this.cancelGeneration = cancelGeneration;
  }
  requestSafeCancel(
    _sceneToken: number,
    reason: string,
    cancelGeneration: number,
  ): void {
    this.safeCancelRequests.push(reason);
    this.cancelRequested = true;
    this.cancelGeneration = cancelGeneration;
  }
  nextDeadlineMs(): number | null {
    if (this.program === null || this.settled) return null;
    if (!this.consequenceSent) {
      return this.program.phaseWindows.find(
        (window) => window.phase === "consequence",
      )?.startMs ?? 0;
    }
    if (this.acknowledged && !this.boundarySent) return 0;
    return this.program.durationMs;
  }
  dispose(): void {
    this.program = null;
  }
}

class LazyWallClock implements PresentationClock {
  private current = 0;

  now(): number {
    return this.current;
  }

  schedule(_deadlineMs: number, _callback: () => void): () => void {
    return () => undefined;
  }

  jumpTo(nowMs: number): void {
    if (!Number.isFinite(nowMs) || nowMs < this.current) {
      throw new RangeError("lazy wall clock must move forward to a finite time");
    }
    this.current = nowMs;
  }
}

class SettleInOneAdvanceRuntime implements SceneRuntimePort {
  private token = 0;
  private marker: string | null = null;

  start(input: SceneRuntimeStart, _identity: FrameIdentity): number {
    this.token += 1;
    this.marker = input.program.consequenceMarker;
    return this.token;
  }

  advance(_nowMs: number): readonly SceneRuntimeSignal[] {
    const marker = this.marker;
    if (marker === null) return [];
    this.marker = null;
    return [
      { kind: "consequence-marker", sceneToken: this.token, marker },
      {
        kind: "safe-cancel-ack",
        sceneToken: this.token,
        cancelApplied: false,
        cancelGeneration: 0,
      },
      { kind: "scene-settled", sceneToken: this.token },
    ];
  }

  acknowledgePublishedConsequence(
    _sceneToken: number,
    _publishedRevision: number,
    _cancelRequested: boolean,
    _cancelGeneration: number,
  ): void {}

  requestSafeCancel(
    _sceneToken: number,
    _reason: string,
    _cancelGeneration: number,
  ): void {}

  nextDeadlineMs(): number | null {
    return this.marker === null ? null : 0;
  }

  dispose(): void {
    this.marker = null;
  }
}

function envelope(
  entries: readonly EventEnvelopeEntry[],
  overrides: Partial<EventEnvelope> = {},
): EventEnvelope {
  return {
    schema: 1,
    cursor: entries[0]?.cursor ?? 0,
    oldest_cursor: entries[0]?.cursor ?? 0,
    next_cursor: entries.at(-1)?.cursor ?? 0,
    events: [...entries],
    overflow: false,
    snapshot_required: false,
    ...overrides,
  };
}

function speak(cursor: number, message: string): EventEnvelopeEntry {
  return {
    cursor,
    event: {
      type: "speak",
      source: "agent_001",
      payload: {
        speaker_id: "agent_001",
        target_id: null,
        region: "meadow",
        speak_energy_cost: 1,
        message,
      },
      scope: "local",
      region: "meadow",
      target: null,
      timestamp: cursor,
    },
    resolved: { actor_id: "agent_001", region: "meadow" },
    snapshot_after: null,
  };
}

/**
 * An event that occupies a body, at a chosen cursor.
 *
 * Since the 2026-07-31 two-lane split, `speak` and `self_talk` are display-only:
 * the director clears them onto the utterance overlay without a stage lease, so
 * a `speak` can no longer stand in for "an event that produces a scene". Tests
 * whose subject is the STAGE (the consequence barrier, recovery, pressure,
 * cancellation) use this; tests whose subject is speech still use `speak`.
 */
/** A `run_11`-era entry: the right event type, a payload that is only `message`. */
function legacyPayload(cursor: number): EventEnvelopeEntry {
  return {
    cursor,
    event: {
      type: "agent_recovered",
      source: "agent_001",
      payload: { message: "Aster gathered." },
      scope: "local",
      region: "meadow",
      target: "agent_002",
      timestamp: cursor,
    },
    resolved: { actor_id: "agent_001", target_id: "agent_002", region: "meadow" },
    snapshot_after: null,
  };
}

function staged(cursor: number, message = "gathered"): EventEnvelopeEntry {
  return {
    cursor,
    event: {
      type: "agent_recovered",
      source: "agent_001",
      payload: {
        message,
        giver_id: "agent_001",
        recipient_id: "agent_002",
        revived_id: "agent_002",
        region: "meadow",
        resource_type: "energy",
        amount: 10,
        giver_energy: 40 + cursor,
        revived_energy: 20 + cursor,
      },
      scope: "local",
      region: "meadow",
      target: "agent_002",
      timestamp: cursor,
    },
    resolved: { actor_id: "agent_001", target_id: "agent_002", region: "meadow" },
    snapshot_after: null,
  };
}

function selfTalk(cursor: number, agentId: string, message: string): EventEnvelopeEntry {
  return {
    cursor,
    event: {
      type: "self_talk",
      source: agentId,
      payload: { agent_id: agentId, message },
      scope: "private",
      region: null,
      target: agentId,
      timestamp: cursor,
    },
    resolved: { actor_id: agentId },
    snapshot_after: null,
  };
}

function pendingMoment(evidence: readonly EventEnvelopeEntry[]): StoryMoment {
  return {
    id: `${evidence[0].cursor}:${evidence.at(-1)!.cursor}:single`,
    firstCursor: evidence[0].cursor,
    lastCursor: evidence.at(-1)!.cursor,
    evidenceCursors: evidence.map((entry) => entry.cursor),
    evidence,
    representative: evidence[0],
    chainKind: "single",
    priority: "featured",
    focus: { kind: "agent", id: evidence[0].event.source },
  };
}

function resourceChanged(cursor: number, energy: number, materials: number): EventEnvelopeEntry {
  return {
    cursor,
    event: {
      type: "resource_changed",
      source: "agent_001",
      payload: {
        agent_id: "agent_001",
        region: "meadow",
        resource_type: "energy",
        amount: energy - 84,
        agent_energy: energy,
        agent_materials: materials,
        region_energy: 0,
        region_materials: 0,
        message: "resources changed",
      },
      scope: "local",
      region: "meadow",
      target: null,
      timestamp: cursor,
    },
    resolved: { actor_id: "agent_001", region: "meadow" },
    snapshot_after: null,
  };
}

function archiveWindow(runId: string, cursor: number, lastCursor: number): ReplayPresentationWindow {
  return {
    sourceKey: archiveSource(runId, cursor, lastCursor),
    checkpointIndex: 0,
    checkpointLineNumber: 1,
    checkpointReason: "world_tick",
    checkpointWorldTime: cursor,
    firstCursor: cursor,
    lastCursor,
    snapshot: makeWorld({ run_id: runId, event_cursor: cursor, world_time: cursor }),
    entries: [speak(lastCursor, "archived")],
  };
}

function archiveSource(runId: string, cursor: number, lastCursor: number): string {
  return `archive:${encodeURIComponent(runId)}:line-1:window-${cursor}-${lastCursor}`;
}

function checkpoint(line: number, snapshot: WorldSnapshot): ClassifiedCheckpointRecord {
  return {
    line,
    safety: "safe-world-tick",
    checkpoint: {
      schema: 1,
      type: "world_snapshot_checkpoint",
      run_id: snapshot.run_id,
      world_time: snapshot.world_time,
      event_cursor: snapshot.event_cursor,
      reason: "world_tick",
      snapshot,
    },
  };
}

function agentRecord(
  world: ReturnType<ReturnType<typeof liveHarness>["session"]["getFrame"]>["world"],
  id: string,
) {
  return world.agents.find((record) => record.value.id === id);
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function flushPromises(turns = 4): Promise<void> {
  for (let index = 0; index < turns; index += 1) await Promise.resolve();
}
