import { afterEach, describe, expect, it, vi } from "vitest";

import { makeRun, makeWorld } from "../../test/fixtures";
import type {
  ReplayArtifactClient,
  ReplayArtifacts,
  ReplayPresentationWindow,
} from "../replayArtifactClient";
import {
  createLegacyArchivePresentationSessionForTests,
  type PresentationControls,
  type PresentationSession,
} from "../../presentation/PresentationSession";
import { createManualPresentationClock } from "../../presentation/fixtures/ManualPresentationClock";
import type { SceneRuntimePort } from "../../presentation/SceneSettlementCoordinator";
import type {
  EventEnvelopeEntry,
  WorldSnapshot,
} from "../schemas";
import { PresentedWorldModel } from "../../presentation/PresentedWorldModel";
import type {
  ObserverSelection,
  PresentedObserverFrame,
} from "../../presentation/contracts";
import { createRegionMapIdentity } from "../../renderer2d/production/maps/RegionMapIdentity";
import { createRegionMapRecipe } from "../../renderer2d/production/maps/RegionMapRecipe";
import {
  createPlacementGenerationOwner,
  type PlacementGenerationOwner,
} from "../../renderer2d/production/placement/PlacementGeneration";
import type { PlacementLedger } from "../../renderer2d/production/placement/PlacementLedger";
import type { RegionMapRecipeV1 } from "../../renderer2d/production/maps/RegionMapRecipe";
import type {
  ProductionArchiveObserverSessionBundle,
  ProductionObserverSessionBundle,
} from "./createProductionObserverSession";
import { anchoredSelection, createObserverShellRuntime } from "./observerShellRuntime";
import {
  createProductionCaptureClockFactoryForTest,
  registerProductionMountedRunReplacementForTest,
} from "./productionCaptureTestSeam";

describe("anchoredSelection", () => {
  const anchor = Object.freeze({
    entity: Object.freeze({ kind: "agent" as const, id: "aster" }),
    regionId: "meadow",
    atLiveEdge: false,
  });

  it("re-attaches the anchor the presentation resolved for the same moment", () => {
    // Without this the renderer receives a moment it can only resolve against the scene it is
    // playing right now, which is what made every past Chronicle card a dead click.
    expect(anchoredSelection(
      { kind: "moment", id: "5:5:single", firstCursor: 5, lastCursor: 5 },
      { kind: "moment", id: "5:5:single", firstCursor: 5, lastCursor: 5, anchor },
    )).toEqual({ kind: "moment", id: "5:5:single", firstCursor: 5, lastCursor: 5, anchor });
  });

  it("never borrows an anchor from a different moment, a non-moment, or nothing at all", () => {
    const request = { kind: "moment", id: "5:5:single", firstCursor: 5, lastCursor: 5 } as const;
    expect(anchoredSelection(request, {
      kind: "moment", id: "9:9:single", firstCursor: 9, lastCursor: 9, anchor,
    })).toBe(request);
    expect(anchoredSelection(request, { kind: "agent", id: "aster" })).toBe(request);
    expect(anchoredSelection(request, null)).toBe(request);
  });

  it("leaves an already-anchored request and every non-moment request untouched", () => {
    const anchored = {
      kind: "moment", id: "5:5:single", firstCursor: 5, lastCursor: 5, anchor,
    } as const;
    expect(anchoredSelection(anchored, {
      kind: "moment", id: "5:5:single", firstCursor: 5, lastCursor: 5,
      anchor: { entity: null, regionId: "grove", atLiveEdge: true },
    })).toBe(anchored);
    const agent = { kind: "agent", id: "aster" } as const;
    expect(anchoredSelection(agent, {
      kind: "moment", id: "5:5:single", firstCursor: 5, lastCursor: 5, anchor,
    })).toBe(agent);
  });
});

describe("ObserverShellRuntime", () => {
  afterEach(() => {
    delete window.__vivariumEnableProductionCaptureClockForTest;
    delete window.__vivariumProductionMountedRunForTest;
  });

  it("registers one flagged mounted replacement through the owned Live bundle and releases it", async () => {
    window.__vivariumEnableProductionCaptureClockForTest = true;
    const capture = createProductionCaptureClockFactoryForTest()!;
    const live = fakeLiveBundle(frame("live", "run-a", 3), Promise.resolve(), 71);
    const runtime = createObserverShellRuntime({
      createLiveBundle: () => live.bundle,
      capture: {
        clockFactory: capture.clockFactory,
        checkpointFeedFactory: capture.checkpointFeedFactory,
        registerMountedRunReplacement: registerProductionMountedRunReplacementForTest,
        dispose: capture.dispose,
      },
    });
    await runtime.ready;
    const run = makeRun({ run_id: "run-b", event_cursor: 0 });
    const world = makeWorld({ run_id: run.run_id, event_cursor: 0 });

    window.__vivariumProductionMountedRunForTest!.replaceMountedRunForTest(run, world);

    expect(live.replaceRun).toHaveBeenCalledWith(run, world);
    expect(runtime.getSnapshot().frame).toMatchObject({
      runId: "run-b",
      sourceKey: "live:run-b:current",
      presentedCursor: 0,
    });
    runtime.dispose();
    expect(window.__vivariumProductionMountedRunForTest).toBeUndefined();
  });

  it("shares one reactive reduced-motion getter across Live and every Archive owner", async () => {
    let reduced = false;
    const reducedMotion = () => reduced;
    const live = fakeLiveBundle(frame("live", "run-a", 4), Promise.resolve(), 71);
    const archive = fakeArchiveBundle(frame("archive", "run-a", 2), Promise.resolve());
    const liveFactory = vi.fn((_options: { reducedMotion: () => boolean }) => live.bundle);
    const archiveFactory = vi.fn((_options: {
      window: ReplayPresentationWindow;
      runSeed: number;
      recipes: ReadonlyMap<string, RegionMapRecipeV1>;
      reducedMotion: () => boolean;
    }) => archive.bundle);
    const runtime = createObserverShellRuntime({
      reducedMotion,
      createLiveBundle: liveFactory,
      createArchiveBundle: archiveFactory,
    });
    await runtime.ready;

    expect(liveFactory).toHaveBeenCalledWith({ reducedMotion });
    reduced = true;
    await runtime.enterArchive(archiveWindow("run-a", 2));
    expect(archiveFactory).toHaveBeenCalledWith(expect.objectContaining({ reducedMotion }));
    const forwarded = archiveFactory.mock.calls[0]![0].reducedMotion;
    expect(forwarded()).toBe(true);
    runtime.dispose();
  });

  it("passes the exact current same-run Live recipes into Archive creation", async () => {
    const live = fakeLiveBundle(frame("live", "run-a", 4), Promise.resolve(), 71);
    const liveResources = live.bundle.getResources()!;
    vi.spyOn(live.bundle, "getResources").mockReturnValue(liveResources);
    const archive = fakeArchiveBundle(frame("archive", "run-a", 2), Promise.resolve());
    const archiveFactory = vi.fn((_options: {
      window: ReplayPresentationWindow;
      runSeed: number;
      recipes: ReadonlyMap<string, RegionMapRecipeV1>;
      reducedMotion: () => boolean;
    }) => archive.bundle);
    const runtime = createObserverShellRuntime({
      createLiveBundle: () => live.bundle,
      createArchiveBundle: archiveFactory,
    });
    await runtime.ready;
    const window = archiveWindow("run-a", 2);

    await runtime.enterArchive(window);

    expect(archiveFactory).toHaveBeenCalledWith({
      window,
      runSeed: 71,
      recipes: liveResources.recipes,
      reducedMotion: expect.any(Function),
    });
    runtime.dispose();
  });

  it("caches one selected snapshot whose frame is the exact Stage binding frame", async () => {
    const ready = deferred<void>();
    const live = fakeLiveBundle(frame("live", "run-a", 4), ready.promise, 71);
    const runtime = createObserverShellRuntime({ createLiveBundle: () => live.bundle });
    const notifications = vi.fn();
    runtime.subscribe(notifications);

    expect(runtime.getSnapshot()).toMatchObject({ status: "loading", frame: null });
    expect(runtime.getSnapshot()).toBe(runtime.getSnapshot());

    ready.resolve();
    await ready.promise;
    await Promise.resolve();

    const selected = runtime.getSnapshot();
    expect(selected.status).toBe("ready");
    expect(selected.frame).toBe(live.session.getFrame());
    expect(runtime.frameSource.getSnapshot()).toBe(selected.frame);
    expect(selected.placement).not.toBe(live.owner.current());
    expect(selected.placement?.snapshot()).toEqual(live.owner.current().snapshot());
    expect(selected.placementOwnerId).toBe(live.owner.ownerId);
    expect(selected.recipes).toBe(runtime.getSnapshot().recipes);
    expect(notifications).toHaveBeenCalled();

    const next = frame("live", "run-a", 5);
    live.session.publish(next);
    expect(runtime.getSnapshot().frame).toBe(next);
    expect(runtime.frameSource.getSnapshot()).toBe(next);
    runtime.dispose();
  });

  it("reads live hold diagnostics without publishing a semantic frame", async () => {
    const ready = deferred<void>();
    const live = fakeLiveBundle(frame("live", "run-a", 4), ready.promise, 71);
    const baseline = live.session.diagnostics();
    let nowMs = 0;
    const clock = Object.freeze({
      advanceBy(deltaMs: number): void { nowMs += deltaMs; },
    });
    vi.spyOn(live.session, "diagnostics").mockImplementation(() => ({
      ...baseline,
      director: {
        ...baseline.director,
        framePublicationSerial: 17,
        checkpointHold: {
          line: 7,
          eventCursor: 4,
          worldTime: 12,
          correctionEntityIds: ["home_001"],
          elapsedMs: nowMs,
          durationMs: 800,
          remainingMs: 800 - nowMs,
          segmentElapsedMs: nowMs,
          segmentDurationMs: 800,
          segmentRemainingMs: 800 - nowMs,
          focusTarget: {
            regionId: "meadow",
            kind: "home",
            entityId: "home_001",
            segmentIndex: 0,
            segmentCount: 1,
            removed: false,
          },
        },
      },
    }));
    const runtime = createObserverShellRuntime({ createLiveBundle: () => live.bundle });
    const notifications = vi.fn();
    runtime.subscribe(notifications);

    expect(runtime.diagnostics()).toBeNull();
    ready.resolve();
    await ready.promise;
    await Promise.resolve();

    const retainedSnapshot = runtime.getSnapshot();
    const retainedFrame = retainedSnapshot.frame;
    const notificationCount = notifications.mock.calls.length;
    expect(retainedSnapshot.diagnostics?.director.checkpointHold?.elapsedMs).toBe(0);

    clock.advanceBy(33);
    const preview = runtime.diagnostics();

    expect(preview?.director.checkpointHold?.elapsedMs).toBe(33);
    expect(preview?.director.framePublicationSerial).toBe(17);
    expect(runtime.getSnapshot()).toBe(retainedSnapshot);
    expect(runtime.getSnapshot().frame).toBe(retainedFrame);
    expect(runtime.getSnapshot().frame?.revision).toBe(retainedFrame?.revision);
    expect(runtime.getSnapshot().diagnostics?.director.checkpointHold?.elapsedMs).toBe(0);
    expect(notifications).toHaveBeenCalledTimes(notificationCount);

    runtime.dispose();
    expect(runtime.diagnostics()).toBeNull();
  });

  it("publishes held controls immediately without a semantic frame publication", async () => {
    const live = fakeLiveBundle(frame("live", "run-a", 4), Promise.resolve(), 71);
    const baseline = live.session.diagnostics();
    let held = false;
    vi.mocked(live.controls.holdCurrentMoment).mockImplementation((hold) => { held = hold; });
    vi.spyOn(live.session, "diagnostics").mockImplementation(() => ({ ...baseline, held }));
    const runtime = createObserverShellRuntime({ createLiveBundle: () => live.bundle });
    await runtime.ready;
    const retainedFrame = runtime.getSnapshot().frame;
    const notifications = vi.fn();
    runtime.subscribe(notifications);

    for (const [index, requestedHold] of [true, false].entries()) {
      runtime.holdCurrentMoment(requestedHold);

      expect(live.session.diagnostics().held).toBe(requestedHold);
      expect(runtime.getSnapshot().diagnostics?.held).toBe(requestedHold);
      expect(runtime.getSnapshot().frame).toBe(retainedFrame);
      expect(runtime.frameSource.getSnapshot()).toBe(retainedFrame);
      expect(notifications).toHaveBeenCalledTimes(index + 1);

      runtime.holdCurrentMoment(requestedHold);
      expect(notifications).toHaveBeenCalledTimes(index + 1);
    }
    runtime.dispose();
  });

  it("routes observer controls and Canvas selection only to the selected session", async () => {
    const live = fakeLiveBundle(frame("live", "run-a", 4), Promise.resolve(), 71);
    const runtime = createObserverShellRuntime({ createLiveBundle: () => live.bundle });
    await runtime.ready;
    const selection = { kind: "agent", id: "agent_001" } as const;

    runtime.select(selection);
    runtime.pause();
    runtime.resume("snap-to-live");
    runtime.setSpeed(1.5);
    runtime.holdCurrentMoment(true);
    runtime.viewMoment("moment-4");
    runtime.retryRecovery();
    runtime.reconnectStream();

    expect(live.session.select).toHaveBeenCalledWith(selection);
    expect(live.controls.pause).toHaveBeenCalledOnce();
    expect(live.controls.resume).toHaveBeenCalledWith("snap-to-live");
    expect(live.controls.setSpeed).toHaveBeenCalledWith(1.5);
    expect(live.controls.holdCurrentMoment).toHaveBeenCalledWith(true);
    expect(live.controls.viewMoment).toHaveBeenCalledWith("moment-4");
    expect(live.session.retryRecovery).toHaveBeenCalledOnce();
    expect(live.session.reconnectStream).toHaveBeenCalledOnce();

    runtime.setCameraMode("free");
    runtime.observeRegion("grove");
    runtime.requestFocus(selection);
    expect(runtime.getSnapshot()).toMatchObject({
      cameraMode: "free",
      observedRegionId: "grove",
      focusRequest: { serial: 1, selection },
    });
    expect(live.session.select).toHaveBeenCalledTimes(1);
    runtime.dispose();
  });

  it("routes frame acceptance by exact selected source key and ignores stale keys", async () => {
    const liveFrame = frame("live", "run-a", 4);
    const live = fakeLiveBundle(liveFrame, Promise.resolve(), 71);
    const archive = fakeArchiveBundle(frame("archive", "run-a", 2), Promise.resolve());
    const runtime = createObserverShellRuntime({
      createLiveBundle: () => live.bundle,
      createArchiveBundle: () => archive.bundle,
    });
    await runtime.ready;

    runtime.frameAcceptance.markAccepted(liveFrame);
    expect(live.markAccepted).toHaveBeenCalledWith(liveFrame);
    await runtime.enterArchive(archiveWindow("run-a", 2));
    runtime.frameAcceptance.markAccepted(archive.session.getFrame());
    expect(archive.markAccepted).toHaveBeenCalledWith(archive.session.getFrame());

    runtime.returnToLive();
    runtime.frameAcceptance.markAccepted(archive.session.getFrame());
    expect(archive.markAccepted).toHaveBeenCalledOnce();
    runtime.dispose();
  });

  it("keeps Live ingesting while an isolated Archive is selected and binds Live before disposal", async () => {
    const trace: string[] = [];
    const live = fakeLiveBundle(frame("live", "run-a", 4), Promise.resolve(), 71, trace);
    const archive = fakeArchiveBundle(frame("archive", "run-a", 2), Promise.resolve(), trace);
    const runtime = createObserverShellRuntime({
      createLiveBundle: () => live.bundle,
      createArchiveBundle: () => archive.bundle,
    });
    await runtime.ready;
    await runtime.enterArchive(archiveWindow("run-a", 2));

    expect(runtime.getSnapshot().frame?.source).toBe("archive");
    expect(live.session.setHidden).toHaveBeenCalledWith(true);
    const advancedLive = frame("live", "run-a", 9);
    live.session.publish(advancedLive);
    expect(runtime.getSnapshot().frame?.source).toBe("archive");

    runtime.returnToLive();
    expect(runtime.getSnapshot().frame).toBe(advancedLive);
    expect(trace.indexOf("live:visible")).toBeLessThan(trace.indexOf("archive:dispose"));
    expect(archive.dispose).toHaveBeenCalledOnce();
    expect(archive.ownerDispose).toHaveBeenCalledOnce();
    runtime.dispose();
  });

  it("atomically returns on Live run replacement and disposes stale Archive resources once", async () => {
    const live = fakeLiveBundle(frame("live", "run-a", 4), Promise.resolve(), 71);
    const archive = fakeArchiveBundle(frame("archive", "run-a", 2), Promise.resolve());
    const runtime = createObserverShellRuntime({
      createLiveBundle: () => live.bundle,
      createArchiveBundle: () => archive.bundle,
    });
    await runtime.ready;
    await runtime.enterArchive(archiveWindow("run-a", 2));

    live.session.publish(frame("live", "run-b", 1));

    expect(runtime.getSnapshot().frame).toBe(live.session.getFrame());
    expect(runtime.getSnapshot().archive.status).toBe("inactive");
    expect(archive.session.dispose).toHaveBeenCalledOnce();
    expect(archive.ownerDispose).toHaveBeenCalledOnce();
    runtime.returnToLive();
    runtime.dispose();
    expect(archive.ownerDispose).toHaveBeenCalledOnce();
  });

  it("clears observer-local requests before publishing the first frame of a replacement run", async () => {
    const live = fakeLiveBundle(frame("live", "run-a", 4), Promise.resolve(), 71);
    const archive = fakeArchiveBundleLite(frame("archive", "run-a", 2));
    const runtime = createObserverShellRuntime({
      createLiveBundle: () => live.bundle,
      createArchiveBundle: () => archive.bundle,
    });
    await runtime.ready;
    await runtime.enterArchive(archiveWindow("run-a", 2));
    const selection = { kind: "agent", id: "agent_001" } as const;
    runtime.setCameraMode("free");
    runtime.observeRegion("grove");
    runtime.requestFocus(selection);
    const replacementSnapshots: ReturnType<typeof runtime.getSnapshot>[] = [];
    runtime.subscribe(() => {
      const snapshot = runtime.getSnapshot();
      if (snapshot.frame?.runId === "run-b") replacementSnapshots.push(snapshot);
    });

    live.session.publish(frame("live", "run-b", 1));

    expect(replacementSnapshots.length).toBeGreaterThan(0);
    expect(replacementSnapshots.every((snapshot) => (
      snapshot.cameraMode === "story"
      && snapshot.observedRegionId === null
      && snapshot.focusRequest === null
      && snapshot.archive.status === "inactive"
    ))).toBe(true);
    expect(archive.dispose).toHaveBeenCalledOnce();
    runtime.dispose();
  });

  it("keeps one Live owner through 25 Archive enter-return cycles and disposes each Archive once", async () => {
    const live = fakeLiveBundle(frame("live", "run-a", 30), Promise.resolve(), 71);
    const archiveFrame = frame("archive", "run-a", 1);
    const window = archiveWindow("run-a", 1);
    const archives = Array.from({ length: 25 }, () => fakeArchiveBundleLite(archiveFrame));
    const pending = [...archives];
    const runtime = createObserverShellRuntime({
      createLiveBundle: () => live.bundle,
      createArchiveBundle: () => pending.shift()!.bundle,
    });
    await runtime.ready;

    for (let index = 0; index < 25; index += 1) {
      await runtime.enterArchive(window);
      expect(runtime.getSnapshot().frame?.source).toBe("archive");
      runtime.returnToLive();
      expect(runtime.getSnapshot().frame).toBe(live.session.getFrame());
    }

    expect(live.dispose).not.toHaveBeenCalled();
    expect(archives.every((archive) => (
      archive.dispose.mock.calls.length === 1
      && archive.ownerDispose.mock.calls.length === 1
    ))).toBe(true);
    runtime.dispose();
    expect(live.dispose).toHaveBeenCalledOnce();
    expect(archives.every((archive) => archive.dispose.mock.calls.length === 1)).toBe(true);
  }, 20_000);

  it("publishes stable spatial bridges already selected for each stable-source Live and Archive frame", async () => {
    const live = fakeLiveBundle(frame("live", "run-a", 4), Promise.resolve(), 71);
    const archive = fakeArchiveBundle(frame("archive", "run-a", 2), Promise.resolve());
    const liveRaw = live.bundle.getResources()!;
    const archiveRaw = archive.bundle.getResources();
    const liveRecipe = [...liveRaw.recipes.values()][0]!;
    const archiveRecipe = [...archiveRaw.recipes.values()][0]!;
    vi.spyOn(live.bundle, "getResources").mockReturnValue({
      ...liveRaw,
      placement: { snapshot: () => ({ marker: "live" }) } as unknown as PlacementLedger,
      recipes: new Map([["live-only", liveRecipe]]),
    });
    vi.spyOn(archive.bundle, "getResources").mockReturnValue({
      ...archiveRaw,
      placement: { snapshot: () => ({ marker: "archive" }) } as unknown as PlacementLedger,
      recipes: new Map([["archive-only", archiveRecipe]]),
    });
    const runtime = createObserverShellRuntime({
      createLiveBundle: () => live.bundle,
      createArchiveBundle: () => archive.bundle,
    });
    await runtime.ready;
    const frameSource = runtime.frameSource;
    const stablePlacement = runtime.getSnapshot().placement;
    const stableRecipes = runtime.getSnapshot().recipes;
    const observations: Array<Readonly<{
      source: PresentedObserverFrame["source"];
      marker: string;
      placementStable: boolean;
      recipesStable: boolean;
      hasLiveRecipe: boolean;
      hasArchiveRecipe: boolean;
    }>> = [];
    runtime.frameSource.subscribe(() => {
      const selected = runtime.getSnapshot();
      observations.push({
        source: runtime.frameSource.getSnapshot().source,
        marker: String((selected.placement?.snapshot() as any)?.marker ?? "missing"),
        placementStable: selected.placement === stablePlacement,
        recipesStable: selected.recipes === stableRecipes,
        hasLiveRecipe: selected.recipes?.has("live-only") === true,
        hasArchiveRecipe: selected.recipes?.has("archive-only") === true,
      });
    });

    await runtime.enterArchive(archiveWindow("run-a", 2));
    runtime.returnToLive();

    expect(runtime.frameSource).toBe(frameSource);
    expect(observations).toEqual(expect.arrayContaining([
      expect.objectContaining({
        source: "archive",
        marker: "archive",
        placementStable: true,
        recipesStable: true,
        hasLiveRecipe: false,
        hasArchiveRecipe: true,
      }),
      expect.objectContaining({
        source: "live",
        marker: "live",
        placementStable: true,
        recipesStable: true,
        hasLiveRecipe: true,
        hasArchiveRecipe: false,
      }),
    ]));
    runtime.dispose();
  });

  it("keeps the selected recipe facade stable while same-source spatial generations replace Nirvana", async () => {
    const live = fakeLiveBundle(frame("live", "run-a", 4), Promise.resolve(), 71);
    const raw = live.bundle.getResources()!;
    const initialRecipe = [...raw.recipes.values()][0]!;
    const replacementRecipe = createRegionMapRecipe(createRegionMapIdentity(
      72,
      makeWorld().regions[0]!,
      makeWorld().regions,
    ));
    let selected = {
      ...raw,
      recipes: new Map([["nirvana", initialRecipe]]),
    };
    vi.spyOn(live.bundle, "getResources").mockImplementation(() => selected);
    const runtime = createObserverShellRuntime({
      createLiveBundle: () => live.bundle,
    });
    await runtime.ready;
    const stableRecipes = runtime.getSnapshot().recipes!;
    expect(stableRecipes.get("nirvana")).toBe(initialRecipe);

    selected = {
      ...selected,
      generation: selected.generation + 1,
      recipes: new Map([["nirvana", replacementRecipe]]),
    };
    live.session.publish(frame("live", "run-a", 5));

    expect(runtime.getSnapshot().recipes).toBe(stableRecipes);
    expect(stableRecipes.get("nirvana")).toBe(replacementRecipe);
    expect(runtime.getSnapshot().placementGeneration).toBe(selected.generation);
    runtime.dispose();
  });

  it("releases selected spatial data while retained bridge props remain safe during unmount inspection", async () => {
    const live = fakeLiveBundle(frame("live", "run-a", 4), Promise.resolve(), 71);
    const runtime = createObserverShellRuntime({ createLiveBundle: () => live.bundle });
    await runtime.ready;
    const retainedPlacement = runtime.getSnapshot().placement!;
    const retainedRecipes = runtime.getSnapshot().recipes!;

    runtime.dispose();

    expect(runtime.getSnapshot()).toMatchObject({
      status: "disposed",
      placement: null,
      recipes: null,
      placementOwnerId: null,
      placementGeneration: null,
    });
    expect(() => retainedPlacement.snapshot()).not.toThrow();
    expect(retainedPlacement.snapshot()).toMatchObject({ revision: 0 });
    expect(retainedRecipes.size).toBe(0);
    expect(() => Object.prototype.toString.call(retainedPlacement)).not.toThrow();
  });

  it("keeps the retained Archive frame visible while a replacement checkpoint becomes ready", async () => {
    const live = fakeLiveBundle(frame("live", "run-a", 30), Promise.resolve(), 71);
    const first = fakeArchiveBundleLite(frame("archive", "run-a", 1));
    const nextReady = deferred<void>();
    const second = fakeArchiveBundle(frame("archive", "run-a", 2), nextReady.promise);
    const pending = [first.bundle, second.bundle];
    const runtime = createObserverShellRuntime({
      createLiveBundle: () => live.bundle,
      createArchiveBundle: () => pending.shift()!,
    });
    await runtime.ready;
    await runtime.enterArchive(archiveWindow("run-a", 1));
    const publishedSources: string[] = [];
    runtime.subscribe(() => {
      const source = runtime.getSnapshot().frame?.source;
      if (source !== undefined) publishedSources.push(source);
    });

    const switching = runtime.enterArchive(archiveWindow("run-a", 2));
    expect(runtime.getSnapshot().frame?.source).toBe("archive");
    expect(runtime.getSnapshot().archive.status).toBe("loading");
    nextReady.resolve();
    await switching;

    expect(runtime.getSnapshot().frame?.source).toBe("archive");
    expect(publishedSources).not.toContain("live");
    expect(first.dispose).toHaveBeenCalledOnce();
    runtime.dispose();
  }, 15_000);

  it("silences stale readiness and disposes every owned resource exactly once", async () => {
    const ready = deferred<void>();
    const live = fakeLiveBundle(frame("live", "run-a", 4), ready.promise, 71);
    const runtime = createObserverShellRuntime({ createLiveBundle: () => live.bundle });

    runtime.dispose();
    runtime.dispose();
    ready.resolve();
    await ready.promise;
    await Promise.resolve();

    expect(live.dispose).toHaveBeenCalledOnce();
    expect(runtime.getSnapshot().status).toBe("disposed");
  });

  it("disposes a stale Archive readiness without replacing the newer selected Archive", async () => {
    const live = fakeLiveBundle(frame("live", "run-a", 4), Promise.resolve(), 71);
    const staleReady = deferred<void>();
    const stale = fakeArchiveBundle(frame("archive", "run-a", 1), staleReady.promise);
    const current = fakeArchiveBundle(frame("archive", "run-a", 2), Promise.resolve());
    const archives = [stale.bundle, current.bundle];
    const runtime = createObserverShellRuntime({
      createLiveBundle: () => live.bundle,
      createArchiveBundle: () => archives.shift()!,
    });
    await runtime.ready;

    const staleEntry = runtime.enterArchive(archiveWindow("run-a", 1));
    await runtime.enterArchive(archiveWindow("run-a", 2));
    staleReady.resolve();
    await staleEntry;

    expect(runtime.getSnapshot().frame).toBe(current.session.getFrame());
    expect(stale.dispose).toHaveBeenCalledOnce();
    expect(current.dispose).not.toHaveBeenCalled();
    runtime.dispose();
    expect(current.dispose).toHaveBeenCalledOnce();
  });

  it("reports a failed Archive readiness without disturbing Live and disposes the candidate", async () => {
    const live = fakeLiveBundle(frame("live", "run-a", 4), Promise.resolve(), 71);
    const archiveReady = deferred<void>();
    const failed = fakeArchiveBundle(frame("archive", "run-a", 2), archiveReady.promise);
    const runtime = createObserverShellRuntime({
      createLiveBundle: () => live.bundle,
      createArchiveBundle: () => failed.bundle,
    });
    await runtime.ready;

    const entering = runtime.enterArchive(archiveWindow("run-a", 2));
    archiveReady.reject(new Error("archive unavailable"));
    await entering;

    expect(runtime.getSnapshot()).toMatchObject({
      status: "ready",
      frame: live.session.getFrame(),
      archive: { status: "error" },
      error: "archive-unavailable",
    });
    expect(failed.dispose).toHaveBeenCalledOnce();
    runtime.dispose();
  });

  it("restores a recorded spatial card in an isolated historical Archive and gates its later stop", async () => {
    // The currently active Live world has no spatial body. The only authoritative
    // route comes from this saved recording, which also carries a later
    // same-cursor checkpoint that must not leak into a rewind at t=10.
    const live = fakeLiveBundle(frame("live", "run-a", 50), Promise.resolve(), 71);
    const start = historicalSpatialEntry("spatial_travel_started", 1, 10);
    const stop = historicalSpatialEntry("spatial_travel_cancelled", 2, 20);
    const base = historicalSpatialSnapshot("run-a", 0, 0, { x: 20, y: 40 });
    const futureSameCursor = historicalSpatialSnapshot("run-a", 1, 25, { x: 777, y: 40 });
    const artifacts: ReplayArtifacts = {
      runId: "run-a",
      events: [start, stop],
      checkpoints: [
        recordedCheckpoint(base, 1),
        recordedCheckpoint(futureSameCursor, 2),
      ],
      checkpointIndex: [],
      hasOlderCheckpoints: false,
      nextCheckpointBefore: null,
    };
    const replay = new FakeReplayArtifactClient(artifacts);
    const clock = createManualPresentationClock();
    const archiveFactory = vi.fn((input: {
      window: ReplayPresentationWindow;
      runSeed: number;
      recipes: ReadonlyMap<string, RegionMapRecipeV1>;
      reducedMotion: () => boolean;
    }): ProductionArchiveObserverSessionBundle => {
      const session = createLegacyArchivePresentationSessionForTests({
        window: input.window,
        clockFactory: () => clock,
        runtimeFactory: historicalNoopRuntime,
      });
      const resources = live.bundle.getResources()!;
      let disposed = false;
      return {
        session,
        frameAcceptance: {
          markAccepted: () => undefined,
          accepts: () => false,
          clear: () => undefined,
          dispose: () => undefined,
        },
        getPlacementOwner: () => ({} as PlacementGenerationOwner),
        getResources: () => resources,
        dispose: ({ sessionAlreadyDisposed } = {}) => {
          if (disposed) return;
          disposed = true;
          if (!sessionAlreadyDisposed) session.dispose();
        },
      };
    });
    const runtime = createObserverShellRuntime({
      createLiveBundle: () => live.bundle,
      createArchiveBundle: archiveFactory,
      createReplayArtifactClient: () => replay,
    });
    await runtime.ready;

    expect(spatialAgent(live.session.getFrame())).toBeUndefined();
    // The UI can dispatch Pause and a speed change before async replay artifact
    // loading resolves. This must pause the new archive, not only the Live
    // session that happened to be selected at click time.
    const replaying = runtime.replayCursor(1);
    runtime.setSpeed(2);
    runtime.pause();
    expect(await replaying).toBe(true);

    expect(archiveFactory).toHaveBeenCalledOnce();
    expect(runtime.getSnapshot().frame).toMatchObject({
      source: "archive",
      presentedCursor: 1,
      spatialPlayback: { sampledAt: 10, speed: 2, paused: true },
    });
    expect(spatialAgent(runtime.getSnapshot().frame!)).toMatchObject({
      x: 20,
      y: 40,
      travel: { id: "journey-east", destination_id: "east-gate" },
    });
    expect(spatialAgent(runtime.getSnapshot().frame!)?.x).not.toBe(777);

    // Paused archive time cannot drain the future recorded stop.
    clock.advanceBy(60_000);
    expect(runtime.getSnapshot().frame?.spatialPlayback).toMatchObject({ sampledAt: 10, paused: true });
    expect(spatialAgent(runtime.getSnapshot().frame!)?.travel).not.toBeNull();

    runtime.resume();
    clock.advanceBy(4_999);
    expect(spatialAgent(runtime.getSnapshot().frame!)?.travel).not.toBeNull();
    clock.advanceBy(1);
    expect(runtime.getSnapshot().frame).toMatchObject({
      source: "archive",
      presentedCursor: 2,
      spatialPlayback: { sampledAt: 20, speed: 2, paused: false },
    });
    expect(spatialAgent(runtime.getSnapshot().frame!)).toMatchObject({
      x: 120,
      y: 40,
      travel: null,
    });

    // Go Live must rebind the selected stage to the real current world rather
    // than merely moving the Chronicle playhead inside the archive.
    runtime.returnToLive();
    expect(runtime.getSnapshot().frame).toBe(live.session.getFrame());
    expect(runtime.getSnapshot().frame?.source).toBe("live");
    runtime.dispose();
  });

  it("honors the latest historical card and ignores a slow card after Return to Live", async () => {
    const start = historicalSpatialEntry("spatial_travel_started", 1, 10);
    const stop = historicalSpatialEntry("spatial_travel_cancelled", 2, 20);
    const base = historicalSpatialSnapshot("run-a", 0, 0, { x: 20, y: 40 });
    const artifacts: ReplayArtifacts = {
      runId: "run-a",
      events: [start, stop],
      checkpoints: [recordedCheckpoint(base, 1)],
      checkpointIndex: [],
      hasOlderCheckpoints: false,
      nextCheckpointBefore: null,
    };
    const live = fakeLiveBundle(frame("live", "run-a", 50), Promise.resolve(), 71);
    const firstFetch = deferred<ReplayArtifacts>();
    const replay = new FakeReplayArtifactClient(artifacts);
    replay.fetchForRun
      .mockReset()
      .mockReturnValueOnce(firstFetch.promise)
      .mockResolvedValueOnce(artifacts);
    const archiveFactory = vi.fn((input: {
      window: ReplayPresentationWindow;
      runSeed: number;
      recipes: ReadonlyMap<string, RegionMapRecipeV1>;
      reducedMotion: () => boolean;
    }) => fakeArchiveBundle({
      ...frame("archive", "run-a", input.window.lastCursor),
      sourceKey: input.window.sourceKey,
    }, Promise.resolve()).bundle);
    const runtime = createObserverShellRuntime({
      createLiveBundle: () => live.bundle,
      createArchiveBundle: archiveFactory,
      createReplayArtifactClient: () => replay,
    });
    await runtime.ready;

    const staleFirstCard = runtime.replayCursor(1);
    const newestCard = runtime.replayCursor(2);
    expect(await newestCard).toBe(true);
    firstFetch.resolve(artifacts);
    // `true` means handled: the stale click must not fall through to focus its
    // old moment after the newer card took ownership of the world.
    expect(await staleFirstCard).toBe(true);
    expect(runtime.getSnapshot().frame).toMatchObject({
      source: "archive",
      sourceKey: "archive:run-a:line-1:replay-0-2",
      presentedCursor: 2,
    });
    expect(archiveFactory).toHaveBeenCalledOnce();
    runtime.dispose();

    const returnLive = fakeLiveBundle(frame("live", "run-a", 50), Promise.resolve(), 71);
    const returnFetch = deferred<ReplayArtifacts>();
    const returnReplay = new FakeReplayArtifactClient(artifacts);
    returnReplay.fetchForRun.mockReset().mockReturnValueOnce(returnFetch.promise);
    const returnArchiveFactory = vi.fn();
    const returnRuntime = createObserverShellRuntime({
      createLiveBundle: () => returnLive.bundle,
      createArchiveBundle: returnArchiveFactory,
      createReplayArtifactClient: () => returnReplay,
    });
    await returnRuntime.ready;

    const staleAfterReturn = returnRuntime.replayCursor(1);
    // There is no archive yet, but this is still a new navigation intent.
    returnRuntime.returnToLive();
    returnFetch.resolve(artifacts);
    expect(await staleAfterReturn).toBe(true);
    expect(returnRuntime.getSnapshot().frame).toBe(returnLive.session.getFrame());
    expect(returnRuntime.getSnapshot().frame?.source).toBe("live");
    expect(returnArchiveFactory).not.toHaveBeenCalled();
    returnRuntime.dispose();
  });

  it("loads a bounded sanitized Archive catalogue without exposing replay artifacts", async () => {
    const live = fakeLiveBundle(frame("live", "run-a", 4), Promise.resolve(), 71);
    const replay = new FakeReplayArtifactClient(replayArtifacts("run-a", 4, true));
    const runtime = createObserverShellRuntime({
      createLiveBundle: () => live.bundle,
      createReplayArtifactClient: () => replay,
    });
    await runtime.ready;

    await runtime.openArchiveCatalogue();

    expect(replay.fetchForRun).toHaveBeenCalledWith("run-a");
    expect(runtime.getSnapshot().archive).toEqual({
      status: "ready",
      checkpoints: [{
        key: { lineNumber: 4 },
        eventCursor: 2,
        worldTime: 12.5,
        reason: "World checkpoint",
      }],
      hasMore: true,
    });
    expect(JSON.stringify(runtime.getSnapshot().archive)).not.toContain("run-a");
    expect(replay.exportEvents).not.toHaveBeenCalled();
    expect(replay.exportSnapshots).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it("returns to Live while retaining the same-run Archive catalogue for immediate re-entry", async () => {
    const live = fakeLiveBundle(frame("live", "run-a", 4), Promise.resolve(), 71);
    const replay = new FakeReplayArtifactClient(replayArtifacts("run-a", 4, false));
    const archive = fakeArchiveBundle(frame("archive", "run-a", 2), Promise.resolve());
    const runtime = createObserverShellRuntime({
      createLiveBundle: () => live.bundle,
      createArchiveBundle: () => archive.bundle,
      createReplayArtifactClient: () => replay,
    });
    await runtime.ready;
    await runtime.openArchiveCatalogue();
    await runtime.enterArchiveCheckpoint({ lineNumber: 4 });

    runtime.returnToLive();

    expect(runtime.getSnapshot().frame).toBe(live.session.getFrame());
    expect(runtime.getSnapshot().archive).toEqual({
      status: "ready",
      checkpoints: [{
        key: { lineNumber: 4 },
        eventCursor: 2,
        worldTime: 12.5,
        reason: "World checkpoint",
      }],
      hasMore: false,
    });
    expect(replay.fetchForRun).toHaveBeenCalledOnce();
    expect(archive.dispose).toHaveBeenCalledOnce();
    runtime.dispose();
  });

  it("pages older bounded checkpoints and enters a stable checkpoint through ReplaySession", async () => {
    const live = fakeLiveBundle(frame("live", "run-a", 4), Promise.resolve(), 71);
    const latest = replayArtifacts("run-a", 8, true);
    const older = replayArtifacts("run-a", 3, false);
    const replay = new FakeReplayArtifactClient(latest, older);
    const archive = fakeArchiveBundle(frame("archive", "run-a", 2), Promise.resolve());
    let capturedWindow: ReplayPresentationWindow | null = null;
    const archiveFactory = vi.fn((input: {
      window: ReplayPresentationWindow;
      runSeed: number;
      recipes: ReadonlyMap<string, RegionMapRecipeV1>;
      reducedMotion: () => boolean;
    }) => {
      capturedWindow = input.window;
      return archive.bundle;
    });
    const runtime = createObserverShellRuntime({
      createLiveBundle: () => live.bundle,
      createArchiveBundle: archiveFactory,
      createReplayArtifactClient: () => replay,
    });
    await runtime.ready;
    await runtime.openArchiveCatalogue();
    await runtime.loadOlderArchive();

    expect(replay.fetchOlderArtifacts).toHaveBeenCalledWith(latest);
    expect(runtime.getSnapshot().archive).toMatchObject({
      status: "ready",
      checkpoints: [{ key: { lineNumber: 3 } }],
      hasMore: false,
    });

    await runtime.enterArchiveCheckpoint({ lineNumber: 3 });
    expect(archiveFactory).toHaveBeenCalledOnce();
    expect(capturedWindow).toMatchObject({
      checkpointLineNumber: 3,
      firstCursor: 2,
      snapshot: { run_id: "run-a" },
    });
    expect(runtime.getSnapshot().frame).toBe(archive.session.getFrame());
    expect(runtime.getSnapshot().archive).toEqual({
      status: "active",
      sourceKey: archive.session.getFrame().sourceKey,
      checkpoints: [{
        key: { lineNumber: 3 },
        eventCursor: 2,
        worldTime: 12.5,
        reason: "World checkpoint",
      }],
      hasMore: false,
      selectedKey: { lineNumber: 3 },
    });
    expect(replay.exportEvents).not.toHaveBeenCalled();
    expect(replay.exportSnapshots).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it("rejects a stale Archive catalogue response after Live changes run", async () => {
    const live = fakeLiveBundle(frame("live", "run-a", 4), Promise.resolve(), 71);
    const pending = deferred<ReplayArtifacts>();
    const replay = new FakeReplayArtifactClient(pending.promise);
    const runtime = createObserverShellRuntime({
      createLiveBundle: () => live.bundle,
      createReplayArtifactClient: () => replay,
    });
    await runtime.ready;

    const loading = runtime.openArchiveCatalogue();
    live.session.publish(frame("live", "run-b", 1));
    pending.resolve(replayArtifacts("run-a", 4, false));
    await loading;

    expect(runtime.getSnapshot().frame?.runId).toBe("run-b");
    expect(runtime.getSnapshot().archive).toEqual({ status: "inactive" });
    runtime.dispose();
  });

  it("disposes an unbound Archive candidate when Live identity changes during readiness", async () => {
    const live = fakeLiveBundle(frame("live", "run-a", 4), Promise.resolve(), 71);
    const archiveReady = deferred<void>();
    const candidate = fakeArchiveBundle(frame("archive", "run-a", 2), archiveReady.promise);
    const runtime = createObserverShellRuntime({
      createLiveBundle: () => live.bundle,
      createArchiveBundle: () => candidate.bundle,
    });
    await runtime.ready;

    const entering = runtime.enterArchive(archiveWindow("run-a", 2));
    const replaced = {
      ...frame("live", "run-b", 1),
      sourceKey: "live:run-b:replacement-source",
    };
    live.session.publish(replaced);
    archiveReady.resolve();
    await entering;

    expect(runtime.getSnapshot().frame).toBe(replaced);
    expect(runtime.getSnapshot().archive).toEqual({ status: "inactive" });
    expect(candidate.dispose).toHaveBeenCalledOnce();
    expect(candidate.session.setHidden).not.toHaveBeenCalled();
    runtime.dispose();
    expect(candidate.dispose).toHaveBeenCalledOnce();
  });

  it("disposes an unbound Archive candidate when same-frame Live spatial authority changes", async () => {
    const retainedLiveFrame = frame("live", "run-a", 4);
    const live = fakeLiveBundle(retainedLiveFrame, Promise.resolve(), 71);
    const initialResources = live.bundle.getResources()!;
    let currentResources = initialResources;
    vi.spyOn(live.bundle, "getResources").mockImplementation(() => currentResources);
    const archiveReady = deferred<void>();
    const candidate = fakeArchiveBundle(frame("archive", "run-a", 2), archiveReady.promise);
    const runtime = createObserverShellRuntime({
      createLiveBundle: () => live.bundle,
      createArchiveBundle: () => candidate.bundle,
    });
    await runtime.ready;

    const entering = runtime.enterArchive(archiveWindow("run-a", 2));
    currentResources = {
      ...initialResources,
      ownerId: Symbol("replacement-live-placement-owner"),
      generation: initialResources.generation + 1,
      recipes: new Map(initialResources.recipes),
    };
    archiveReady.resolve();
    await entering;

    expect(live.session.getFrame()).toBe(retainedLiveFrame);
    expect(runtime.getSnapshot().frame).toBe(retainedLiveFrame);
    expect(runtime.getSnapshot().archive).toEqual({ status: "error" });
    expect(runtime.getSnapshot().error).toBe("archive-unavailable");
    expect(candidate.dispose).toHaveBeenCalledOnce();
    expect(candidate.session.setHidden).not.toHaveBeenCalled();
    runtime.dispose();
    expect(candidate.dispose).toHaveBeenCalledOnce();
  });

  it("restores a retained Archive when same-frame Live authority invalidates its replacement", async () => {
    const live = fakeLiveBundle(frame("live", "run-a", 4), Promise.resolve(), 71);
    const initialResources = live.bundle.getResources()!;
    let currentResources = initialResources;
    vi.spyOn(live.bundle, "getResources").mockImplementation(() => currentResources);
    const retained = fakeArchiveBundle(frame("archive", "run-a", 1), Promise.resolve());
    const replacementReady = deferred<void>();
    const replacement = fakeArchiveBundle(
      frame("archive", "run-a", 2),
      replacementReady.promise,
    );
    const archives = [retained.bundle, replacement.bundle];
    const runtime = createObserverShellRuntime({
      createLiveBundle: () => live.bundle,
      createArchiveBundle: () => archives.shift()!,
    });
    await runtime.ready;
    await runtime.enterArchive(archiveWindow("run-a", 1));
    const retainedFrame = runtime.getSnapshot().frame;
    const retainedArchiveState = runtime.getSnapshot().archive;

    const enteringReplacement = runtime.enterArchive(archiveWindow("run-a", 2));
    currentResources = {
      ...initialResources,
      ownerId: Symbol("replacement-live-placement-owner"),
      generation: initialResources.generation + 1,
      recipes: new Map(initialResources.recipes),
    };
    replacementReady.resolve();
    await enteringReplacement;

    expect(runtime.getSnapshot().frame).toBe(retainedFrame);
    expect(runtime.getSnapshot().archive).toBe(retainedArchiveState);
    expect(runtime.getSnapshot().error).toBe("archive-unavailable");
    expect(retained.dispose).not.toHaveBeenCalled();
    expect(replacement.dispose).toHaveBeenCalledOnce();
    expect(replacement.session.setHidden).not.toHaveBeenCalled();
    runtime.dispose();
    expect(retained.dispose).toHaveBeenCalledOnce();
    expect(replacement.dispose).toHaveBeenCalledOnce();
  });

  it("publishes one retained frame store to Stage and shell under adversarial reentrancy", async () => {
    const live = fakeLiveBundle(frame("live", "run-a", 4), Promise.resolve(), 71);
    const runtime = createObserverShellRuntime({ createLiveBundle: () => live.bundle });
    await runtime.ready;
    const observations: Array<{
      listener: "stage" | "shell";
      stage: PresentedObserverFrame;
      shell: PresentedObserverFrame | null;
    }> = [];
    let reentered = false;
    runtime.frameSource.subscribe(() => {
      const stage = runtime.frameSource.getSnapshot();
      const shell = runtime.getSnapshot().frame;
      observations.push({ listener: "stage", stage, shell });
      if (!reentered && stage.presentedCursor === 5) {
        reentered = true;
        live.session.publish(frame("live", "run-a", 6));
      }
    });
    runtime.subscribe(() => {
      observations.push({
        listener: "shell",
        stage: runtime.frameSource.getSnapshot(),
        shell: runtime.getSnapshot().frame,
      });
    });

    live.session.publish(frame("live", "run-a", 5));

    expect(observations.length).toBeGreaterThanOrEqual(4);
    expect(observations.every((entry) => entry.stage === entry.shell)).toBe(true);
    expect(observations.every((entry) => (
      entry.stage.revision === entry.shell?.revision
      && entry.stage.sourceKey === entry.shell.sourceKey
    ))).toBe(true);
    expect(runtime.frameSource.getSnapshot()).toBe(runtime.getSnapshot().frame);
    expect(runtime.getSnapshot().frame?.presentedCursor).toBe(6);
    runtime.dispose();
  });

  it("pages bounded catalogue metadata while retaining the selected Archive session and key", async () => {
    const live = fakeLiveBundle(frame("live", "run-a", 9), Promise.resolve(), 71);
    const latest = replayArtifacts("run-a", 8, true);
    const older = replayArtifacts("run-a", 3, false);
    const replay = new FakeReplayArtifactClient(latest, older);
    const archive = fakeArchiveBundle(frame("archive", "run-a", 2), Promise.resolve());
    const runtime = createObserverShellRuntime({
      createLiveBundle: () => live.bundle,
      createArchiveBundle: () => archive.bundle,
      createReplayArtifactClient: () => replay,
    });
    await runtime.ready;
    await runtime.openArchiveCatalogue();
    await runtime.enterArchiveCheckpoint({ lineNumber: 8 });
    const boundFrame = runtime.getSnapshot().frame;

    await runtime.loadOlderArchive();

    expect(replay.fetchOlderArtifacts).toHaveBeenCalledWith(latest);
    expect(runtime.getSnapshot().frame).toBe(boundFrame);
    expect(runtime.getSnapshot().archive).toEqual({
      status: "active",
      sourceKey: archive.session.getFrame().sourceKey,
      checkpoints: [{
        key: { lineNumber: 3 },
        eventCursor: 2,
        worldTime: 12.5,
        reason: "World checkpoint",
      }],
      hasMore: false,
      selectedKey: { lineNumber: 8 },
    });
    expect(archive.dispose).not.toHaveBeenCalled();
    runtime.dispose();
  });

  it("remaps a page-local selected index only to the same checkpoint after older-page reorder", async () => {
    const live = fakeLiveBundle(frame("live", "run-a", 9), Promise.resolve(), 71);
    const selectedCheckpoint = checkpointWithoutLine("run-a", 6, "manual");
    const insertedCheckpoint = checkpointWithoutLine("run-a", 2, "world_tick");
    const latest = artifactsFromCheckpoints("run-a", [selectedCheckpoint], true);
    const reordered = artifactsFromCheckpoints(
      "run-a",
      [insertedCheckpoint, selectedCheckpoint],
      true,
    );
    const selectedAbsent = artifactsFromCheckpoints("run-a", [insertedCheckpoint], false);
    const replay = new FakeReplayArtifactClient(latest, reordered);
    replay.fetchOlderArtifacts
      .mockResolvedValueOnce(reordered)
      .mockResolvedValueOnce(selectedAbsent);
    const archive = fakeArchiveBundle(frame("archive", "run-a", 6), Promise.resolve());
    const runtime = createObserverShellRuntime({
      createLiveBundle: () => live.bundle,
      createArchiveBundle: () => archive.bundle,
      createReplayArtifactClient: () => replay,
    });
    await runtime.ready;
    await runtime.openArchiveCatalogue();
    await runtime.enterArchiveCheckpoint({ index: 0 });

    await runtime.loadOlderArchive();

    expect(runtime.getSnapshot().frame).toBe(archive.session.getFrame());
    expect(runtime.getSnapshot().archive).toMatchObject({
      status: "active",
      checkpoints: [
        { key: { index: 0 }, eventCursor: 2 },
        { key: { index: 1 }, eventCursor: 6 },
      ],
      selectedKey: { index: 1 },
    });

    await runtime.loadOlderArchive();
    expect(runtime.getSnapshot().archive).toMatchObject({
      status: "active",
      checkpoints: [{ key: { index: 0 }, eventCursor: 2 }],
      selectedKey: null,
    });
    runtime.dispose();
  });

  it("coalesces rapid older-page requests without dropping active Archive state or success", async () => {
    const live = fakeLiveBundle(frame("live", "run-a", 9), Promise.resolve(), 71);
    const latest = replayArtifacts("run-a", 8, true);
    const older = replayArtifacts("run-a", 3, false);
    const pendingPage = deferred<ReplayArtifacts>();
    const replay = new FakeReplayArtifactClient(latest, older);
    replay.fetchOlderArtifacts.mockReturnValue(pendingPage.promise);
    const archive = fakeArchiveBundle(frame("archive", "run-a", 2), Promise.resolve());
    const runtime = createObserverShellRuntime({
      createLiveBundle: () => live.bundle,
      createArchiveBundle: () => archive.bundle,
      createReplayArtifactClient: () => replay,
    });
    await runtime.ready;
    await runtime.openArchiveCatalogue();
    await runtime.enterArchiveCheckpoint({ lineNumber: 8 });
    const retainedWhileLoading = runtime.getSnapshot().archive;

    const first = runtime.loadOlderArchive();
    const duplicate = runtime.loadOlderArchive();

    expect(replay.fetchOlderArtifacts).toHaveBeenCalledTimes(1);
    expect(runtime.getSnapshot().archive).toBe(retainedWhileLoading);
    pendingPage.resolve(older);
    await Promise.all([first, duplicate]);

    expect(runtime.getSnapshot().archive).toMatchObject({
      status: "active",
      checkpoints: [{ key: { lineNumber: 3 } }],
      hasMore: false,
      selectedKey: { lineNumber: 8 },
    });
    expect(runtime.getSnapshot().frame).toBe(archive.session.getFrame());
    runtime.dispose();
  });
});

class FakeSession implements PresentationSession {
  private paused = false;
  private speed: 0.5 | 1 | 1.5 | 2 = 1;
  private held = false;
  readonly controlsValue: PresentationControls = {
    pause: vi.fn(() => { this.paused = true; }),
    resume: vi.fn(() => { this.paused = false; }),
    setSpeed: vi.fn((speed: 0.5 | 1 | 1.5 | 2) => { this.speed = speed; }),
    holdCurrentMoment: vi.fn((hold: boolean) => { this.held = hold; }),
    viewMoment: vi.fn(),
    viewCursor: vi.fn(),
  };
  readonly select = vi.fn((selection: ObserverSelection) => {
    this.current = { ...this.current, selection };
  });
  readonly retryRecovery = vi.fn(() => Promise.resolve());
  readonly reconnectStream = vi.fn();
  readonly setHidden: ReturnType<typeof vi.fn<(hidden: boolean) => void>>;
  readonly dispose: ReturnType<typeof vi.fn<() => void>>;
  private readonly listeners = new Set<() => void>();
  private disposed = false;

  constructor(
    readonly source: "live" | "archive",
    private current: PresentedObserverFrame,
    readonly ready: Promise<void>,
    trace: string[] = [],
  ) {
    this.setHidden = vi.fn((hidden: boolean): void => {
      trace.push(`${source}:${hidden ? "hidden" : "visible"}`);
    });
    this.dispose = vi.fn(() => {
      if (this.disposed) return;
      this.disposed = true;
      trace.push(`${source}:session-dispose`);
      this.listeners.clear();
    });
  }

  publish(next: PresentedObserverFrame): void {
    this.current = next;
    for (const listener of [...this.listeners]) listener();
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  getFrame(): PresentedObserverFrame { return this.current; }
  getChronicle(): ReturnType<PresentationSession["getChronicle"]> {
    return { now: null, previous: [], upcoming: [], gaps: [] };
  }
  controls(): PresentationControls { return this.controlsValue; }
  reset(): void {}
  diagnostics(): ReturnType<PresentationSession["diagnostics"]> {
    return {
      disposed: false,
      paused: this.paused,
      speed: this.speed,
      held: this.held,
      hidden: false,
      recovery: { status: "idle" },
      lastCompletedRecovery: null,
      settlement: null,
      ingress: { runId: null, sourceKey: null, ingestedCursor: 0, acceptedCount: 0, duplicateCount: 0, gaps: [], lifetimeAcceptedCount: 0, lifetimeDuplicateCount: 0, refusedBatchCount: 0, lastRefusedBatch: null },
      director: { pendingMoments: 0, unpresentableMoments: 0, checkpointHold: null, framePublicationSerial: 0, retainedChapters: 0, retainedPressureSummaries: 0, activeSceneCount: 0, recoveryRequired: false, retryableIngressFaults: 0, lastRetryableIngressFault: null, deferredUtteranceEvidence: 0 },
      chronicle: { previous: 0, upcoming: 0, gaps: 0 },
      checkpoint: { disposed: false, runId: null, lastDeliveredLine: 0, polling: false, retainedSafeCheckpoints: 0, faultCount: 0 },
    };
  }
  acceptRunMetadata(): void {}
  replaceRun(): void {}
  getPlacementGeneration(): null { return null; }
}

function fakeLiveBundle(
  initial: PresentedObserverFrame,
  ready: Promise<void>,
  seed: number,
  trace: string[] = [],
) {
  const world = makeWorld({ run_id: initial.runId, event_cursor: initial.presentedCursor });
  const recipes = world.regions.map((region) =>
    createRegionMapRecipe(createRegionMapIdentity(seed, region, world.regions)));
  const owner = createPlacementGenerationOwner(recipes, world);
  const session = new FakeSession("live", initial, ready, trace);
  const markAccepted = vi.fn();
  const replaceRun = vi.fn((run: ReturnType<typeof makeRun>, snapshot: ReturnType<typeof makeWorld>) => {
    session.publish(frame("live", run.run_id, snapshot.event_cursor));
  });
  const resources = {
    ownerId: owner.ownerId,
    generation: owner.generation(),
    placement: owner.current(),
    recipes: owner.recipes(),
  };
  const dispose = vi.fn(() => {
    session.dispose();
    owner.dispose();
  });
  const bundle: ProductionObserverSessionBundle = {
    session,
    frameAcceptance: { markAccepted, accepts: () => false, clear: () => undefined, dispose: () => undefined },
    getPlacementOwner: () => owner,
    getResources: () => resources,
    getRunSeed: (runId) => runId === initial.runId || runId === session.getFrame().runId ? seed : null,
    replaceRun,
    dispose,
  };
  return { bundle, session, owner, markAccepted, replaceRun, dispose, controls: session.controlsValue };
}

function fakeArchiveBundle(
  initial: PresentedObserverFrame,
  ready: Promise<void>,
  trace: string[] = [],
) {
  const world = makeWorld({ run_id: initial.runId, event_cursor: initial.presentedCursor });
  const recipes = world.regions.map((region) =>
    createRegionMapRecipe(createRegionMapIdentity(71, region, world.regions)));
  const owner = createPlacementGenerationOwner(recipes, world);
  const originalOwnerDispose = owner.dispose.bind(owner);
  const ownerDispose = vi.fn(originalOwnerDispose);
  owner.dispose = ownerDispose;
  const session = new FakeSession("archive", initial, ready, trace);
  const markAccepted = vi.fn();
  let disposed = false;
  const dispose = vi.fn((options?: { sessionAlreadyDisposed?: boolean }) => {
    if (disposed) return;
    disposed = true;
    trace.push("archive:dispose");
    if (!options?.sessionAlreadyDisposed) session.dispose();
    owner.dispose();
  });
  const bundle: ProductionArchiveObserverSessionBundle = {
    session,
    frameAcceptance: { markAccepted, accepts: () => false, clear: () => undefined, dispose: () => undefined },
    getPlacementOwner: () => owner,
    getResources: () => ({
      ownerId: owner.ownerId,
      generation: owner.generation(),
      placement: owner.current(),
      recipes: owner.recipes(),
    }),
    dispose,
  };
  return { bundle, session, owner, markAccepted, dispose, ownerDispose };
}

function fakeArchiveBundleLite(initial: PresentedObserverFrame) {
  const session = new FakeSession("archive", initial, Promise.resolve());
  const ownerDispose = vi.fn();
  const markAccepted = vi.fn();
  let disposed = false;
  const resources = {
    ownerId: Symbol(`archive-owner:${initial.presentedCursor}`),
    generation: 1,
    placement: {} as PlacementLedger,
    recipes: new Map<string, RegionMapRecipeV1>(),
  };
  const dispose = vi.fn((options?: { sessionAlreadyDisposed?: boolean }): void => {
    if (disposed) return;
    disposed = true;
    if (!options?.sessionAlreadyDisposed) session.dispose();
    ownerDispose();
  });
  const bundle: ProductionArchiveObserverSessionBundle = {
    session,
    frameAcceptance: {
      markAccepted,
      accepts: () => false,
      clear: () => undefined,
      dispose: () => undefined,
    },
    getPlacementOwner: () => ({} as PlacementGenerationOwner),
    getResources: () => resources,
    dispose,
  };
  return { bundle, session, markAccepted, dispose, ownerDispose };
}

function frame(
  source: "live" | "archive",
  runId: string,
  cursor: number,
): PresentedObserverFrame {
  const snapshot = makeWorld({ run_id: runId, event_cursor: cursor });
  const identity = {
    runId,
    sourceKey: `${source}:${runId}:${source === "archive" ? `window-${cursor}` : "current"}`,
    revision: cursor + 1,
    firstCursor: cursor,
    lastCursor: cursor,
  };
  return {
    ...identity,
    source,
    ingestedCursor: cursor,
    presentedCursor: cursor,
    world: new PresentedWorldModel(snapshot, identity).getView(),
    scene: null,
    selection: null,
    backlog: {
      pendingMoments: 0,
      firstPendingCursor: null,
      lastPendingCursor: null,
      state: "caught-up",
      label: "Caught up",
    },
    transport: { connection: source === "live" ? "live" : "offline", ingestedCursor: cursor, retryable: false },
  };
}

function archiveWindow(runId: string, cursor: number) {
  return {
    sourceKey: `archive:${runId}:line-1:window-${cursor}-${cursor}`,
    checkpointIndex: 0,
    checkpointLineNumber: 1,
    checkpointReason: "periodic",
    checkpointWorldTime: 12,
    firstCursor: cursor,
    lastCursor: cursor,
    snapshot: makeWorld({ run_id: runId, event_cursor: cursor }),
    entries: [],
  } as const;
}

function historicalSpatialSnapshot(
  runId: string,
  eventCursor: number,
  worldTime: number,
  position: Readonly<{ x: number; y: number }>,
): WorldSnapshot {
  const base = makeWorld({ run_id: runId, event_cursor: eventCursor, world_time: worldTime });
  return {
    ...base,
    agents: [{
      ...base.agents[0]!,
      position: "nirvana",
      spatial: {
        version: 1,
        region_id: "nirvana",
        map_id: "nirvana:test-layout",
        layout_fingerprint: "test-layout",
        ...position,
        observed_at: worldTime,
        at_landmark: null,
        travel: null,
      },
    }],
    regions: [{
      ...base.regions[0]!,
      name: "nirvana",
      connections: [],
      spatial: {
        version: 1,
        region_id: "nirvana",
        map_id: "nirvana:test-layout",
        layout_fingerprint: "test-layout",
        tile_size: 32,
        landmarks: [{ id: "east-gate", name: "East Gate", x: 120, y: 40, affordances: ["travel"] }],
        initial_pressure: { populationHighWater: 1, builtFootprintHighWater: 0 },
      },
    }],
    homes: [],
    ruins: [],
    region_pressure: [{ region: "nirvana", population_high_water: 1, built_footprint_high_water: 0 }],
    pending_proposals: [],
  };
}

function historicalSpatialEntry(
  type: "spatial_travel_started" | "spatial_travel_cancelled",
  cursor: number,
  timestamp: number,
): EventEnvelopeEntry {
  const traveling = type === "spatial_travel_started";
  const position = traveling ? { x: 20, y: 40 } : { x: 120, y: 40 };
  const route = [{ x: 20, y: 40 }, { x: 120, y: 40 }];
  return {
    cursor,
    event: {
      type,
      source: "agent_001",
      scope: "local",
      region: "nirvana",
      target: null,
      timestamp,
      payload: {
        message: "Aster follows the east path.",
        agent_id: "agent_001",
        region_id: "nirvana",
        map_id: "nirvana:test-layout",
        layout_fingerprint: "test-layout",
        travel_id: "journey-east",
        destination_id: "east-gate",
        route,
        started_at: 10,
        arrives_at: 20,
        position,
        spatial: {
          version: 1,
          region_id: "nirvana",
          map_id: "nirvana:test-layout",
          layout_fingerprint: "test-layout",
          ...position,
          observed_at: timestamp,
          at_landmark: traveling ? null : "east-gate",
          travel: traveling ? {
            id: "journey-east",
            destination_id: "east-gate",
            route,
            started_at: 10,
            arrives_at: 20,
          } : null,
        },
        ...(traveling ? {} : { reason: "stopped" }),
      },
    },
    resolved: { actor_id: "agent_001", region: "nirvana" },
    snapshot_after: null,
  };
}

function recordedCheckpoint(
  snapshot: WorldSnapshot,
  lineNumber: number,
): ReplayArtifacts["checkpoints"][number] {
  return {
    schema: 1,
    type: "world_snapshot_checkpoint",
    reason: "recorded snapshot",
    run_id: snapshot.run_id,
    world_time: snapshot.world_time,
    event_cursor: snapshot.event_cursor,
    snapshot,
    lineNumber,
  };
}

function spatialAgent(frame: PresentedObserverFrame) {
  return frame.world.agents.find((agent) => agent.value.id === "agent_001")?.value.spatial;
}

function historicalNoopRuntime(): SceneRuntimePort {
  let token = 0;
  return {
    start: () => {
      token += 1;
      return token;
    },
    advance: () => [],
    acknowledgePublishedConsequence: () => undefined,
    requestSafeCancel: () => undefined,
    nextDeadlineMs: () => null,
    dispose: () => undefined,
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

class FakeReplayArtifactClient implements ReplayArtifactClient {
  readonly fetchForRun = vi.fn<(runId: string) => Promise<ReplayArtifacts>>();
  readonly fetchOlderArtifacts = vi.fn<(artifacts: ReplayArtifacts) => Promise<ReplayArtifacts>>();
  readonly exportEvents = vi.fn<ReplayArtifactClient["exportEvents"]>();
  readonly exportSnapshots = vi.fn<ReplayArtifactClient["exportSnapshots"]>();
  readonly fetchEvents = vi.fn<ReplayArtifactClient["fetchEvents"]>();
  readonly fetchSnapshots = vi.fn<ReplayArtifactClient["fetchSnapshots"]>();
  readonly fetchArtifacts = vi.fn<ReplayArtifactClient["fetchArtifacts"]>();
  readonly reconcileSelector = vi.fn<ReplayArtifactClient["reconcileSelector"]>();

  constructor(
    first: ReplayArtifacts | Promise<ReplayArtifacts>,
    older: ReplayArtifacts = replayArtifacts("run-a", 3, false),
  ) {
    this.fetchForRun.mockImplementation(() => Promise.resolve(first));
    this.fetchOlderArtifacts.mockResolvedValue(older);
  }
}

function replayArtifacts(runId: string, lineNumber: number, hasMore: boolean): ReplayArtifacts {
  const snapshot = makeWorld({ run_id: runId, event_cursor: 2 });
  return {
    runId,
    events: [],
    checkpoints: [{
      schema: 1,
      type: "world_snapshot_checkpoint",
      reason: "world_tick provider=secret raw/run/path",
      run_id: runId,
      world_time: snapshot.world_time,
      event_cursor: snapshot.event_cursor,
      snapshot,
      lineNumber,
    }],
    checkpointIndex: [{
      lineNumber,
      eventCursor: snapshot.event_cursor,
      worldTime: snapshot.world_time,
      reason: "world_tick provider=secret raw/run/path",
      runId,
    }],
    hasOlderCheckpoints: hasMore,
    nextCheckpointBefore: hasMore ? lineNumber : null,
  };
}

function checkpointWithoutLine(
  runId: string,
  eventCursor: number,
  reason: string,
): ReplayArtifacts["checkpoints"][number] {
  const snapshot = makeWorld({
    run_id: runId,
    event_cursor: eventCursor,
    world_time: 10 + eventCursor,
  });
  return {
    schema: 1,
    type: "world_snapshot_checkpoint",
    reason,
    run_id: runId,
    world_time: snapshot.world_time,
    event_cursor: eventCursor,
    snapshot,
  };
}

function artifactsFromCheckpoints(
  runId: string,
  checkpoints: ReplayArtifacts["checkpoints"],
  hasMore: boolean,
): ReplayArtifacts {
  return {
    runId,
    events: [],
    checkpoints: [...checkpoints],
    checkpointIndex: checkpoints.map((checkpoint) => ({
      eventCursor: checkpoint.event_cursor,
      worldTime: checkpoint.world_time,
      reason: checkpoint.reason,
      runId,
    })),
    hasOlderCheckpoints: hasMore,
    nextCheckpointBefore: hasMore ? 1 : null,
  };
}
