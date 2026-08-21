import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  EventStream,
  EventStreamHandlers,
  LiveApiClient,
} from "../client";
import { makeRun, makeWorld } from "../../test/fixtures";
import type { CheckpointFeed } from "../../presentation/CheckpointFeed";
import { createManualPresentationClock } from "../../presentation/fixtures/ManualPresentationClock";
import { createSceneExecutor } from "../../presentation/choreography/SceneExecutor";
import { createRegionMapIdentity } from "../../renderer2d/production/maps/RegionMapIdentity";
import {
  createRegionMapRecipe,
  serializeRegionMapRecipe,
  type RegionMapRecipeV1,
} from "../../renderer2d/production/maps/RegionMapRecipe";
import { createProductionRegionMapRecipe } from "../../renderer2d/production/maps/ProductionRegionMapRecipe";
import { createPlacementGenerationOwner } from "../../renderer2d/production/placement/PlacementGeneration";
import {
  createProductionArchiveObserverSession,
  createProductionObserverSession,
} from "./createProductionObserverSession";

describe("production observer session assembly", () => {
  afterEach(() => vi.restoreAllMocks());

  it("tracks the exact accepted run seed before creating one matching placement owner", async () => {
    const run = makeRun({ run_id: "tracked-run", seed: 777, event_cursor: 4 });
    const world = makeWorld({ run_id: run.run_id, event_cursor: 4 });
    const client = new StaticLiveClient(run, world);
    const bundle = createProductionObserverSession({
      clientFactory: () => client,
      clockFactory: createManualPresentationClock,
      runtimeFactory: createSceneExecutor,
      checkpointFeedFactory: () => new NullCheckpointFeed(),
    });

    await bundle.session.ready;

    const owner = bundle.getPlacementOwner();
    expect(owner).toBe(bundle.session.getPlacementGeneration());
    expect(bundle.getRunSeed(run.run_id)).toBe(777);
    expect(owner?.recipes().get("meadow")?.identityHash).toBe(
      createRegionMapRecipe(
        createRegionMapIdentity(777, world.regions[0]!, world.regions),
      ).identityHash,
    );
    expect(bundle.getResources()).toMatchObject({
      ownerId: owner?.ownerId,
      generation: 0,
    });
    expect(bundle.getResources()).toBe(bundle.getResources());

    const beforeRecovery = bundle.getResources();
    const recovered = makeWorld({ run_id: run.run_id, event_cursor: 8 });
    const prepared = owner!.prepareFromSnapshot(recovered);
    owner!.commitPrepared(prepared);
    expect(bundle.getResources()).not.toBe(beforeRecovery);
    expect(bundle.getResources()?.generation).toBe(1);
    expect(bundle.getResources()?.placement).toBe(beforeRecovery?.placement);
    expect(bundle.getResources()?.recipes).toBe(beforeRecovery?.recipes);
    expect(bundle.getResources()?.placement.snapshot()).toEqual(owner!.snapshot());
    expect(bundle.getResources()).toBe(bundle.getResources());

    bundle.dispose();
    bundle.dispose();
  });

  it("leaves recipes byte-identical to canonical regardless of compactResourceRouting (routing-only flag)", async () => {
    const run = makeRun({ run_id: "compact-routing-run", seed: 777, event_cursor: 0 });
    const world = makeWorld({ run_id: run.run_id, event_cursor: 0 });
    const client = new StaticLiveClient(run, world);
    const bundle = createProductionObserverSession({
      clientFactory: () => client,
      clockFactory: createManualPresentationClock,
      runtimeFactory: createSceneExecutor,
      checkpointFeedFactory: () => new NullCheckpointFeed(),
      compactResourceRouting: () => true,
    });
    await bundle.session.ready;

    // compactResourceRouting is a pure choreography-resolution-time flag (see
    // presentation/choreography/lifecycleMovementCommunicationResource.ts); it
    // must never alter recipe data itself -- Nirvana recipes carry an
    // object-identity-keyed authored-scene sidecar and a content hash computed
    // once at generation time, so any recipe clone/mutation desyncs both and
    // fails closed (this is what c19-staging-report.md's first attempt hit).
    const canonical = createRegionMapRecipe(
      createRegionMapIdentity(777, world.regions[0]!, world.regions),
    );
    expect(bundle.getResources()?.recipes.get(world.regions[0]!.name))
      .toEqual(canonical);

    bundle.dispose();
  });

  it("refreshes Live Nirvana recipes only when durable pressure crosses a geometry tier", async () => {
    const run = makeRun({ run_id: "growing-nirvana", seed: 401, event_cursor: 4 });
    const initial = makeNirvanaWorld(run.run_id, 4, {
      populationHighWater: 200,
      builtFootprintHighWater: 100,
    });
    const bundle = createProductionObserverSession({
      clientFactory: () => new StaticLiveClient(run, initial),
      clockFactory: createManualPresentationClock,
      runtimeFactory: createSceneExecutor,
      checkpointFeedFactory: () => new NullCheckpointFeed(),
    });
    await bundle.session.ready;

    const owner = bundle.getPlacementOwner()!;
    const genesisResources = bundle.getResources()!;
    const genesisRecipe = genesisResources.recipes.get("nirvana")!;
    const genesisPlacement = owner.snapshot();
    expect(genesisRecipe.grid).toMatchObject({ columns: 96, rows: 96 });
    expect(owner.spatialGeneration()).toBe(0);

    const sameTier = owner.prepareFromSnapshot(makeNirvanaWorld(run.run_id, 5, {
      populationHighWater: 224,
      builtFootprintHighWater: 112,
    }));
    owner.commitPrepared(sameTier);
    const retainedResources = bundle.getResources()!;
    expect(retainedResources).not.toBe(genesisResources);
    expect(retainedResources.placement).toBe(genesisResources.placement);
    expect(retainedResources.recipes).toBe(genesisResources.recipes);
    expect(retainedResources.recipes.get("nirvana")).toBe(genesisRecipe);
    expect(owner.spatialGeneration()).toBe(0);

    const growth = owner.prepareFromSnapshot(makeNirvanaWorld(run.run_id, 6, {
      populationHighWater: 225,
      builtFootprintHighWater: 112,
    }));
    owner.commitPrepared(growth);
    const grownResources = bundle.getResources()!;
    const grownRecipe = grownResources.recipes.get("nirvana")!;
    expect(grownResources.placement).toBe(genesisResources.placement);
    expect(grownResources.recipes).not.toBe(genesisResources.recipes);
    expect(grownRecipe).not.toBe(genesisRecipe);
    expect(grownRecipe.grid).toMatchObject({ columns: 96, rows: 128 });
    expect(grownRecipe.stagingPoints.length).toBeGreaterThan(genesisRecipe.stagingPoints.length);
    expect(grownRecipe.shelterPlots.length).toBeGreaterThan(genesisRecipe.shelterPlots.length);
    expect(owner.spatialGeneration()).toBe(1);
    for (const [id, placement] of genesisPlacement.agents) {
      expect(owner.snapshot().agents.get(id)).toEqual(placement);
    }
    for (const [id, placement] of genesisPlacement.homes) {
      expect(owner.snapshot().homes.get(id)).toEqual(placement);
    }

    owner.rollbackPrepared(growth);
    const rolledBackResources = bundle.getResources()!;
    expect(rolledBackResources.placement).toBe(genesisResources.placement);
    expect(rolledBackResources.recipes).not.toBe(grownResources.recipes);
    expect(rolledBackResources.recipes.get("nirvana")?.grid)
      .toMatchObject({ columns: 96, rows: 96 });
    expect(owner.snapshot()).toEqual(genesisPlacement);
    expect(owner.spatialGeneration()).toBe(2);

    bundle.dispose();
  });

  it("records replacement metadata before replacing terrain identity", async () => {
    const firstRun = makeRun({ run_id: "run-one", seed: 101 });
    const firstWorld = makeWorld({ run_id: firstRun.run_id });
    const bundle = createProductionObserverSession({
      clientFactory: () => new StaticLiveClient(firstRun, firstWorld),
      clockFactory: createManualPresentationClock,
      runtimeFactory: createSceneExecutor,
      checkpointFeedFactory: () => new NullCheckpointFeed(),
    });
    await bundle.session.ready;

    const replacementRun = makeRun({ run_id: "run-two", seed: 909, event_cursor: 2 });
    const replacementWorld = makeWorld({ run_id: replacementRun.run_id, event_cursor: 2 });
    bundle.replaceRun(replacementRun, replacementWorld);

    expect(bundle.getRunSeed("run-two")).toBe(909);
    expect(bundle.getPlacementOwner()?.runId).toBe("run-two");
    expect(bundle.getPlacementOwner()?.recipes().get("meadow")?.identityHash).toBe(
      createRegionMapRecipe(
        createRegionMapIdentity(909, replacementWorld.regions[0]!, replacementWorld.regions),
      ).identityHash,
    );
    bundle.dispose();
  });

  it("retains the prior Live authority when a run replacement fails", async () => {
    const firstRun = makeRun({
      run_id: "run-one",
      seed: 101,
      event_cursor: 4,
    });
    const firstWorld = makeWorld({
      run_id: firstRun.run_id,
      event_cursor: 4,
    });
    const bundle = createProductionObserverSession({
      clientFactory: () => new StaticLiveClient(firstRun, firstWorld),
      clockFactory: createManualPresentationClock,
      runtimeFactory: createSceneExecutor,
      checkpointFeedFactory: () => new NullCheckpointFeed(),
    });
    await bundle.session.ready;
    const priorOwner = bundle.getPlacementOwner();
    const priorResources = bundle.getResources();

    expect(() => bundle.replaceRun(
      makeRun({
        run_id: firstRun.run_id,
        seed: 909,
        event_cursor: 2,
      }),
      makeWorld({
        run_id: firstRun.run_id,
        event_cursor: 2,
      }),
    )).toThrow(/same-run reset cannot move behind/i);

    expect(bundle.getRunSeed(firstRun.run_id)).toBe(firstRun.seed);
    expect(bundle.getPlacementOwner()).toBe(priorOwner);
    expect(bundle.getResources()).toBe(priorResources);
    bundle.dispose();
  });

  it("revalidates supplied same-run recipes into isolated Archive owners", async () => {
    const world = makeWorld({ run_id: "archive-run", event_cursor: 7 });
    const trustedRecipes = new Map(world.regions.map((region) => {
      const recipe = createRegionMapRecipe(
        createRegionMapIdentity(313, region, world.regions),
      );
      return [recipe.regionId, recipe] as const;
    }));
    const liveOwner = createPlacementGenerationOwner([...trustedRecipes.values()], world);
    const bundle = createProductionArchiveObserverSession({
      runSeed: 313,
      recipes: trustedRecipes,
      window: {
        sourceKey: "archive:archive-run:line-2:window-7-7",
        checkpointIndex: 0,
        checkpointLineNumber: 2,
        checkpointReason: "periodic",
        checkpointWorldTime: world.world_time,
        firstCursor: 7,
        lastCursor: 7,
        snapshot: world,
        entries: [],
      },
      clockFactory: createManualPresentationClock,
      runtimeFactory: createSceneExecutor,
    });
    await bundle.session.ready;

    expect(bundle.session.source).toBe("archive");
    expect(bundle.session.getFrame().sourceKey).toBe("archive:archive-run:line-2:window-7-7");
    expect(bundle.getPlacementOwner().runId).toBe("archive-run");
    expect(bundle.getPlacementOwner()).not.toBe(liveOwner);
    expect(bundle.getPlacementOwner().ownerId).not.toBe(liveOwner.ownerId);
    expect(bundle.getPlacementOwner().current()).not.toBe(liveOwner.current());
    expect(bundle.getResources().placement).not.toBe(liveOwner.current());
    expect(bundle.getResources().recipes).not.toBe(trustedRecipes);
    expect([...bundle.getResources().recipes]).toEqual([...trustedRecipes]);
    expect(bundle.getResources().recipes.get("meadow")).not.toBe(trustedRecipes.get("meadow"));

    const owner = bundle.getPlacementOwner();
    const sessionDispose = vi.spyOn(bundle.session, "dispose");
    bundle.dispose();
    bundle.dispose();
    expect(sessionDispose).toHaveBeenCalledOnce();
    expect(owner.generation()).toBe(1);
    liveOwner.dispose();
  });

  it("rejects supplied recipes that do not exactly cover the Archive snapshot regions", () => {
    const world = makeWorld({ run_id: "archive-run", event_cursor: 7 });
    const meadow = createRegionMapRecipe(
      createRegionMapIdentity(313, world.regions[0]!, world.regions),
    );

    expect(() => createProductionArchiveObserverSession({
      runSeed: 313,
      recipes: new Map([[meadow.regionId, meadow]]),
      window: {
        sourceKey: "archive:archive-run:line-2:window-7-7",
        checkpointIndex: 0,
        checkpointLineNumber: 2,
        checkpointReason: "periodic",
        checkpointWorldTime: world.world_time,
        firstCursor: 7,
        lastCursor: 7,
        snapshot: world,
        entries: [],
      },
    })).toThrow(/recipes must exactly cover/i);
  });

  it("rejects supplied recipes from another run seed", () => {
    const world = makeWorld({ run_id: "archive-run", event_cursor: 7 });
    const mismatchedRecipes = new Map(world.regions.map((region) => {
      const recipe = createRegionMapRecipe(
        createRegionMapIdentity(911, region, world.regions),
      );
      return [recipe.regionId, recipe] as const;
    }));
    expect(() => createProductionArchiveObserverSession({
      runSeed: 313,
      recipes: mismatchedRecipes,
      window: {
        sourceKey: "archive:archive-run:line-2:window-7-7",
        checkpointIndex: 0,
        checkpointLineNumber: 2,
        checkpointReason: "periodic",
        checkpointWorldTime: world.world_time,
        firstCursor: 7,
        lastCursor: 7,
        snapshot: world,
        entries: [],
      },
    })).toThrow(/same run seed and snapshot/i);
  });

  it("uses one exact Nirvana dispatcher for Live and Archive without sharing recipe state", async () => {
    const run = makeRun({ run_id: "nirvana-run", seed: 401, event_cursor: 7 });
    const world = makeNirvanaWorld(run.run_id, 7);
    const live = createProductionObserverSession({
      clientFactory: () => new StaticLiveClient(run, world),
      clockFactory: createManualPresentationClock,
      runtimeFactory: createSceneExecutor,
      checkpointFeedFactory: () => new NullCheckpointFeed(),
    });
    await live.session.ready;
    const liveRecipe = live.getResources()?.recipes.get("nirvana");
    expect(liveRecipe?.presentationProfile).toMatchObject({
      kind: "nirvana-v2",
      atlasProfileVersion: 2,
    });

    const archive = createProductionArchiveObserverSession({
      runSeed: run.seed,
      recipes: live.getResources()!.recipes,
      window: {
        sourceKey: "archive:nirvana-run:line-2:window-7-7",
        checkpointIndex: 0,
        checkpointLineNumber: 2,
        checkpointReason: "periodic",
        checkpointWorldTime: world.world_time,
        firstCursor: 7,
        lastCursor: 7,
        snapshot: world,
        entries: [],
      },
      clockFactory: createManualPresentationClock,
      runtimeFactory: createSceneExecutor,
    });
    await archive.session.ready;
    const archiveRecipe = archive.getResources().recipes.get("nirvana")!;

    expect(serializeRegionMapRecipe(archiveRecipe)).toBe(serializeRegionMapRecipe(liveRecipe!));
    expect(archiveRecipe).not.toBe(liveRecipe);
    expect(archiveRecipe.grid.collision).not.toBe(liveRecipe?.grid.collision);
    expect(archiveRecipe.presentationProfile).not.toBe(liveRecipe?.presentationProfile);
    archive.dispose();
    live.dispose();
  });

  it("derives each Archive Nirvana tier from that Archive snapshot instead of current Live bytes", async () => {
    const run = makeRun({ run_id: "nirvana-history", seed: 401, event_cursor: 9 });
    const expandedWorld = makeNirvanaWorld(run.run_id, 9, {
      populationHighWater: 225,
      builtFootprintHighWater: 112,
    });
    const suppliedLiveRecipes = new Map(expandedWorld.regions.map((region) => {
      const recipe = createProductionRegionMapRecipe(
        createRegionMapIdentity(run.seed, region, expandedWorld.regions),
        region.name === "nirvana"
          ? { populationHighWater: 225, builtFootprintHighWater: 112 }
          : undefined,
      );
      return [recipe.regionId, recipe] as const;
    }));
    expect(suppliedLiveRecipes.get("nirvana")?.grid.rows).toBe(128);

    const genesisWorld = makeNirvanaWorld(run.run_id, 4, {
      populationHighWater: 224,
      builtFootprintHighWater: 112,
    });
    const genesisArchive = createProductionArchiveObserverSession({
      runSeed: run.seed,
      recipes: suppliedLiveRecipes,
      window: archiveWindowFor(genesisWorld, 4),
      clockFactory: createManualPresentationClock,
      runtimeFactory: createSceneExecutor,
    });
    await genesisArchive.session.ready;
    expect(genesisArchive.getResources().recipes.get("nirvana")?.grid)
      .toMatchObject({ columns: 96, rows: 96 });

    const expandedArchive = createProductionArchiveObserverSession({
      runSeed: run.seed,
      recipes: suppliedLiveRecipes,
      window: archiveWindowFor(expandedWorld, 9),
      clockFactory: createManualPresentationClock,
      runtimeFactory: createSceneExecutor,
    });
    await expandedArchive.session.ready;
    expect(expandedArchive.getResources().recipes.get("nirvana")?.grid)
      .toMatchObject({ columns: 96, rows: 128 });
    expect(serializeRegionMapRecipe(expandedArchive.getResources().recipes.get("nirvana")!))
      .toBe(serializeRegionMapRecipe(suppliedLiveRecipes.get("nirvana")!));

    expandedArchive.dispose();
    genesisArchive.dispose();
  });

  it("rejects a supplied Nirvana Archive recipe whose static-scene hash drifted", () => {
    const run = makeRun({ run_id: "nirvana-run", seed: 401, event_cursor: 7 });
    const world = makeNirvanaWorld(run.run_id, 7);
    const recipes = new Map(world.regions.map((region) => {
      const recipe = createProductionRegionMapRecipe(
        createRegionMapIdentity(run.seed, region, world.regions),
      );
      return [recipe.regionId, recipe] as const;
    }));
    const hostile = structuredClone(recipes.get("nirvana")) as RegionMapRecipeV1;
    const hostileProfile = (hostile as {
      presentationProfile: { staticSceneHash: string };
    }).presentationProfile;
    hostileProfile.staticSceneHash = hostileProfile.staticSceneHash === "00000000"
      ? "00000001"
      : "00000000";
    recipes.set("nirvana", hostile);

    expect(() => createProductionArchiveObserverSession({
      runSeed: run.seed,
      recipes,
      window: {
        sourceKey: "archive:nirvana-run:line-2:window-7-7",
        checkpointIndex: 0,
        checkpointLineNumber: 2,
        checkpointReason: "periodic",
        checkpointWorldTime: world.world_time,
        firstCursor: 7,
        lastCursor: 7,
        snapshot: world,
        entries: [],
      },
    })).toThrow(/same run seed and snapshot/i);
  });

  it("rejects an unsafe Archive run seed before constructing an owner", () => {
    const world = makeWorld({ run_id: "archive-run", event_cursor: 7 });
    const trustedRecipes = new Map(world.regions.map((region) => {
      const recipe = createRegionMapRecipe(
        createRegionMapIdentity(313, region, world.regions),
      );
      return [recipe.regionId, recipe] as const;
    }));

    expect(() => createProductionArchiveObserverSession({
      runSeed: 313.5,
      recipes: trustedRecipes,
      window: {
        sourceKey: "archive:archive-run:line-2:window-7-7",
        checkpointIndex: 0,
        checkpointLineNumber: 2,
        checkpointReason: "periodic",
        checkpointWorldTime: world.world_time,
        firstCursor: 7,
        lastCursor: 7,
        snapshot: world,
        entries: [],
      },
    })).toThrow(/safe integer/i);
  });

  it("rejects same-seed recipes from a different snapshot topology", () => {
    const world = makeWorld({ run_id: "archive-run", event_cursor: 7 });
    const trustedRecipes = new Map(world.regions.map((region) => {
      const recipe = createRegionMapRecipe(
        createRegionMapIdentity(313, region, world.regions),
      );
      return [recipe.regionId, recipe] as const;
    }));
    const changedTopology = {
      ...world,
      regions: world.regions.map((region) => region.name === "meadow"
        ? { ...region, connections: [] }
        : region),
    };

    expect(() => createProductionArchiveObserverSession({
      runSeed: 313,
      recipes: trustedRecipes,
      window: {
        sourceKey: "archive:archive-run:line-2:window-7-7",
        checkpointIndex: 0,
        checkpointLineNumber: 2,
        checkpointReason: "periodic",
        checkpointWorldTime: changedTopology.world_time,
        firstCursor: 7,
        lastCursor: 7,
        snapshot: changedTopology,
        entries: [],
      },
    })).toThrow(/same run seed and snapshot/i);
  });
});

class StaticLiveClient implements LiveApiClient {
  constructor(
    private readonly run: ReturnType<typeof makeRun>,
    private readonly world: ReturnType<typeof makeWorld>,
  ) {}

  getRun(): Promise<ReturnType<typeof makeRun>> {
    return Promise.resolve(this.run);
  }
  getWorld(): Promise<ReturnType<typeof makeWorld>> {
    return Promise.resolve(this.world);
  }
  getEvents(): Promise<never> {
    return Promise.reject(new Error("unused"));
  }
  openEventStream(_cursor: number, _handlers: EventStreamHandlers): EventStream {
    return { close: () => undefined };
  }
}

function makeNirvanaWorld(
  runId: string,
  eventCursor: number,
  pressure: Readonly<{
    populationHighWater: number;
    builtFootprintHighWater: number;
  }> = {
    populationHighWater: 1,
    builtFootprintHighWater: 1,
  },
): ReturnType<typeof makeWorld> {
  const base = makeWorld({ run_id: runId, event_cursor: eventCursor });
  return {
    ...base,
    agents: base.agents.map((agent) => agent.position === "meadow"
      ? { ...agent, position: "nirvana" }
      : agent),
    regions: base.regions.map((region) => region.name === "meadow"
      ? {
          ...region,
          name: "nirvana",
          description: "a once-heavenly landscape, now thinning and picked-over",
          connections: ["grove"],
        }
      : {
          ...region,
          connections: region.connections.map((connection) =>
            connection === "meadow" ? "nirvana" : connection),
        }),
    homes: base.homes.map((home) => home.region === "meadow"
      ? { ...home, region: "nirvana" }
      : home),
    region_pressure: base.region_pressure?.map((record) => record.region === "meadow"
      ? {
          region: "nirvana",
          population_high_water: pressure.populationHighWater,
          built_footprint_high_water: pressure.builtFootprintHighWater,
        }
      : record),
  };
}

function archiveWindowFor(
  world: ReturnType<typeof makeWorld>,
  cursor: number,
) {
  return {
    sourceKey: `archive:${world.run_id}:line-2:window-${cursor}-${cursor}`,
    checkpointIndex: 0,
    checkpointLineNumber: 2,
    checkpointReason: "periodic" as const,
    checkpointWorldTime: world.world_time,
    firstCursor: cursor,
    lastCursor: cursor,
    snapshot: world,
    entries: [],
  };
}

class NullCheckpointFeed implements CheckpointFeed {
  start(): void {}
  subscribe(): () => void { return () => undefined; }
  subscribeFault(): () => void { return () => undefined; }
  reset(): void {}
  diagnostics(): ReturnType<CheckpointFeed["diagnostics"]> {
    return {
      disposed: false,
      runId: null,
      lastDeliveredLine: 0,
      polling: false,
      retainedSafeCheckpoints: 0,
      faultCount: 0,
    };
  }
  dispose(): void {}
}
