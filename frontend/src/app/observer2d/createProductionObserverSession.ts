import {
  createHttpLiveApiClient,
  type LiveApiClient,
} from "../client";
import type {
  ReplayPresentationWindow,
} from "../replayArtifactClient";
import type {
  RegionPressureHighWater,
  RunMetadata,
  WorldSnapshot,
} from "../schemas";
import {
  createArchivePresentationSession,
  createLivePresentationSession,
  type PresentationSession,
} from "../../presentation/PresentationSession";
import {
  createCheckpointFeed,
  type CheckpointFeed,
} from "../../presentation/CheckpointFeed";
import {
  createPresentationFrameAcceptanceTracker,
  type PresentationFrameAcceptanceTracker,
} from "../../presentation/PresentationFrameSink";
import type { SceneRuntimePort } from "../../presentation/SceneSettlementCoordinator";
import { createSceneExecutor } from "../../presentation/choreography/SceneExecutor";
import type { PresentationClock } from "../../presentation/storyClock";
import {
  createRegionMapIdentity,
} from "../../renderer2d/production/maps/RegionMapIdentity";
import {
  serializeRegionMapRecipe,
  type RegionMapRecipeV1,
} from "../../renderer2d/production/maps/RegionMapRecipe";
import {
  createProductionRegionMapRecipe,
  parseProductionRegionMapRecipe,
} from "../../renderer2d/production/maps/ProductionRegionMapRecipe";
import type {
  NirvanaGrowthPressure,
} from "../../renderer2d/production/nirvana/NirvanaGrowthPolicy";
import {
  createPlacementGenerationOwner,
  type PlacementGenerationOwner,
} from "../../renderer2d/production/placement/PlacementGeneration";
import type { PlacementLedger } from "../../renderer2d/production/placement/PlacementLedger";
import { createBrowserPresentationClock } from "./browserPresentationClock";

export interface ObserverPlacementResources {
  readonly ownerId: symbol;
  readonly generation: number;
  readonly placement: PlacementLedger;
  readonly recipes: ReadonlyMap<string, RegionMapRecipeV1>;
}

export interface ProductionObserverSessionBundle {
  readonly session: PresentationSession;
  readonly frameAcceptance: PresentationFrameAcceptanceTracker;
  getPlacementOwner(): PlacementGenerationOwner | null;
  getResources(): ObserverPlacementResources | null;
  getRunSeed(runId: string): number | null;
  replaceRun(run: RunMetadata, snapshot: WorldSnapshot): void;
  dispose(): void;
}

export interface ArchiveBundleDisposeOptions {
  readonly sessionAlreadyDisposed?: boolean;
}

export interface ProductionArchiveObserverSessionBundle {
  readonly session: PresentationSession;
  readonly frameAcceptance: PresentationFrameAcceptanceTracker;
  getPlacementOwner(): PlacementGenerationOwner;
  getResources(): ObserverPlacementResources;
  dispose(options?: ArchiveBundleDisposeOptions): void;
}

export interface ProductionObserverSessionOptions {
  readonly clientFactory?: () => LiveApiClient;
  readonly clockFactory?: () => PresentationClock;
  readonly runtimeFactory?: () => SceneRuntimePort;
  readonly checkpointFeedFactory?: () => CheckpointFeed;
  readonly frameAcceptanceFactory?: () => PresentationFrameAcceptanceTracker;
  readonly reducedMotion?: () => boolean;
  /**
   * QA-only resource-route compaction. Defaults to `false` (unset) everywhere --
   * exactly today's production behaviour. When `true`, `resolveResourceRoute`
   * (`presentation/choreography/lifecycleMovementCommunicationResource.ts`)
   * routes an actor to whichever of the region's *existing* resource anchors is
   * nearest that actor's current placement, instead of the canonical
   * `stableHash(actorId:resourceType) % anchors.length` pick, which is not
   * bounded to the actor's own district and can land on the far side of a large
   * region. Threaded the same way as `reducedMotion` (an opaque flag read at
   * scene-resolution time, never touching recipe data), because Nirvana
   * recipes carry an object-identity-keyed authored-scene sidecar and a
   * content hash computed once at generation time -- cloning or otherwise
   * mutating a Nirvana recipe after the fact desyncs both and fails closed
   * (see `.superpowers/sdd/c19-staging-report.md`).
   */
  readonly compactResourceRouting?: () => boolean;
}

export interface ProductionArchiveObserverSessionOptions {
  readonly window: ReplayPresentationWindow;
  readonly runSeed: number;
  readonly recipes: ReadonlyMap<string, RegionMapRecipeV1>;
  readonly clockFactory?: () => PresentationClock;
  readonly runtimeFactory?: () => SceneRuntimePort;
  readonly frameAcceptanceFactory?: () => PresentationFrameAcceptanceTracker;
  readonly reducedMotion?: () => boolean;
  readonly compactResourceRouting?: () => boolean;
}

/** Composes the provider-free production Live presentation owner and its spatial lineage. */
export function createProductionObserverSession(
  options: ProductionObserverSessionOptions = {},
): ProductionObserverSessionBundle {
  const seeds = new Map<string, number>();
  const rawClient = (options.clientFactory ?? createHttpLiveApiClient)();
  const client = trackAcceptedRunSeeds(rawClient, seeds);
  const frameAcceptance = (options.frameAcceptanceFactory
    ?? createPresentationFrameAcceptanceTracker)();
  let currentOwner: PlacementGenerationOwner | null = null;
  let disposed = false;
  const resourceCache = createResourceCache();

  const placementFactory = (snapshot: WorldSnapshot): PlacementGenerationOwner => {
    const seed = seeds.get(snapshot.run_id);
    if (seed === undefined) {
      throw new Error("accepted RunMetadata.seed is required before placement creation");
    }
    const recipes = recipesFor(seed, snapshot);
    currentOwner = createPlacementGenerationOwner(
      recipes,
      snapshot,
      (next) => recipesFor(seed, next),
    );
    return currentOwner;
  };

  const session = createLivePresentationSession({
    clientFactory: () => client,
    clockFactory: options.clockFactory ?? createBrowserPresentationClock,
    runtimeFactory: options.runtimeFactory ?? createSceneExecutor,
    checkpointFeedFactory: options.checkpointFeedFactory ?? createCheckpointFeed,
    placementFactory,
    choreography: {
      getPlacementOwnerId: () => requireOwner(currentOwner).ownerId,
      getPlacement: () => requireOwner(currentOwner).snapshot(),
      getRecipes: () => requireOwner(currentOwner).recipes(),
      reducedMotion: options.reducedMotion,
      compactResourceRouting: options.compactResourceRouting,
    },
    frameAcceptance,
  });

  return {
    session,
    frameAcceptance,
    getPlacementOwner(): PlacementGenerationOwner | null {
      return session.getPlacementGeneration();
    },
    getResources(): ObserverPlacementResources | null {
      const owner = session.getPlacementGeneration();
      return owner === null ? null : resourceCache.resolve(owner);
    },
    getRunSeed(runId): number | null {
      return seeds.get(runId) ?? null;
    },
    replaceRun(run, snapshot): void {
      if (disposed) return;
      assertMatchingRun(run, snapshot);
      const priorSeeds = new Map(seeds);
      const priorOwner = currentOwner;
      try {
        seeds.clear();
        recordSeed(seeds, run);
        session.replaceRun(run, snapshot);
        currentOwner = session.getPlacementGeneration();
      } catch (error) {
        seeds.clear();
        for (const [runId, seed] of priorSeeds) seeds.set(runId, seed);
        currentOwner = priorOwner;
        throw error;
      }
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      seeds.clear();
      resourceCache.clear();
      session.dispose();
      currentOwner = null;
    },
  };
}

/** Creates one isolated Archive presentation owner from an exact replay window. */
export function createProductionArchiveObserverSession(
  options: ProductionArchiveObserverSessionOptions,
): ProductionArchiveObserverSessionBundle {
  if (!Number.isSafeInteger(options.runSeed)) {
    throw new Error("Archive run seed must be a safe integer");
  }
  const owner = createPlacementGenerationOwner(
    exactRecipesFor(options.runSeed, options.recipes, options.window.snapshot),
    options.window.snapshot,
  );
  const frameAcceptance = (options.frameAcceptanceFactory
    ?? createPresentationFrameAcceptanceTracker)();
  const resourceCache = createResourceCache();
  let disposed = false;
  let session: PresentationSession;
  try {
    session = createArchivePresentationSession({
      window: options.window,
      clockFactory: options.clockFactory ?? createBrowserPresentationClock,
      runtimeFactory: options.runtimeFactory ?? createSceneExecutor,
      choreography: {
        getPlacement: () => owner.snapshot(),
        getRecipes: () => owner.recipes(),
        reducedMotion: options.reducedMotion,
        compactResourceRouting: options.compactResourceRouting,
      },
      frameAcceptance,
    });
  } catch (error) {
    frameAcceptance.dispose();
    owner.dispose();
    throw error;
  }

  return {
    session,
    frameAcceptance,
    getPlacementOwner: () => owner,
    getResources: () => resourceCache.resolve(owner),
    dispose(disposeOptions = {}): void {
      if (disposed) return;
      disposed = true;
      resourceCache.clear();
      if (!disposeOptions.sessionAlreadyDisposed) session.dispose();
      owner.dispose();
    },
  };
}

function trackAcceptedRunSeeds(
  client: LiveApiClient,
  seeds: Map<string, number>,
): LiveApiClient {
  return {
    async getRun(): Promise<RunMetadata> {
      const run = await client.getRun();
      recordSeed(seeds, run);
      return run;
    },
    getWorld: () => client.getWorld(),
    getEvents: (cursor) => client.getEvents(cursor),
    openEventStream: (cursor, handlers) => client.openEventStream(cursor, handlers),
  };
}

function recordSeed(seeds: Map<string, number>, run: RunMetadata): void {
  if (!Number.isSafeInteger(run.seed)) throw new Error("run seed must be a safe integer");
  const prior = seeds.get(run.run_id);
  if (prior !== undefined && prior !== run.seed) {
    throw new Error("accepted run seed cannot change within one run identity");
  }
  seeds.set(run.run_id, run.seed);
}

function recipesFor(seed: number, snapshot: WorldSnapshot): readonly RegionMapRecipeV1[] {
  return snapshot.regions.map((region) => createProductionRegionMapRecipe(
    createRegionMapIdentity(seed, region, snapshot.regions),
    exactNirvanaPressure(snapshot, region.name),
  ));
}

function exactRecipesFor(
  runSeed: number,
  recipes: ReadonlyMap<string, RegionMapRecipeV1>,
  snapshot: WorldSnapshot,
): readonly RegionMapRecipeV1[] {
  if (recipes.size !== snapshot.regions.length) {
    throw new Error("Archive recipes must exactly cover snapshot regions");
  }
  return snapshot.regions.map((region) => {
    const recipe = recipes.get(region.name);
    if (recipe === undefined || recipe.regionId !== region.name) {
      throw new Error("Archive recipes must exactly cover snapshot regions");
    }
    const identity = createRegionMapIdentity(runSeed, region, snapshot.regions);
    try {
      if (region.name !== "nirvana") {
        return parseProductionRegionMapRecipe(
          serializeRegionMapRecipe(recipe),
          identity,
        );
      }
      parseProductionRegionMapRecipe(
        serializeRegionMapRecipe(recipe),
        identity,
        inferPersistedNirvanaPressure(recipe),
      );
      return createProductionRegionMapRecipe(
        identity,
        exactNirvanaPressure(snapshot, region.name),
      );
    } catch (error) {
      throw new Error(
        "Archive recipes must belong to the same run seed and snapshot",
        { cause: error },
      );
    }
  });
}

function exactNirvanaPressure(
  snapshot: WorldSnapshot,
  regionId: string,
): NirvanaGrowthPressure | undefined {
  if (regionId !== "nirvana") return undefined;
  const supplied = snapshot.region_pressure;
  if (supplied !== undefined) {
    const matches = supplied.filter(({ region }) => region === regionId);
    if (matches.length !== 1) {
      throw new Error("snapshot region_pressure must exactly cover Nirvana");
    }
    return toNirvanaGrowthPressure(matches[0]!);
  }
  return {
    populationHighWater: snapshot.agents.filter((agent) =>
      agent.position === regionId && agent.status !== "dead").length,
    builtFootprintHighWater: [...snapshot.homes, ...snapshot.ruins]
      .filter((home) => home.region === regionId).length,
  };
}

function toNirvanaGrowthPressure(
  pressure: RegionPressureHighWater,
): NirvanaGrowthPressure {
  return {
    populationHighWater: pressure.population_high_water,
    builtFootprintHighWater: pressure.built_footprint_high_water,
  };
}

function inferPersistedNirvanaPressure(
  recipe: RegionMapRecipeV1,
): NirvanaGrowthPressure {
  if (
    recipe.regionId !== "nirvana"
    || recipe.presentationProfile?.kind !== "nirvana-v2"
    || recipe.districts.length === 0
  ) {
    throw new Error("supplied Nirvana recipe must use the exact presentation profile");
  }
  const populationPerDistrict = recipe.districts[0]!.stagingPoints.length;
  const builtFootprintPerDistrict = recipe.districts[0]!.shelterPlots.length;
  if (populationPerDistrict <= 0 || builtFootprintPerDistrict <= 0) {
    throw new Error("supplied Nirvana recipe must retain positive district capacity");
  }
  return {
    populationHighWater: Math.max(
      0,
      (recipe.districts.length - 1) * populationPerDistrict,
    ),
    builtFootprintHighWater: 0,
  };
}

function requireOwner(owner: PlacementGenerationOwner | null): PlacementGenerationOwner {
  if (owner === null) throw new Error("placement generation is not ready");
  return owner;
}

function assertMatchingRun(run: RunMetadata, snapshot: WorldSnapshot): void {
  if (run.run_id !== snapshot.run_id) {
    throw new Error("replacement run metadata and snapshot must share identity");
  }
}

function createResourceCache(): Readonly<{
  resolve(owner: PlacementGenerationOwner): ObserverPlacementResources;
  clear(): void;
}> {
  let cachedOwner: PlacementGenerationOwner | null = null;
  let cachedGeneration = -1;
  let cachedSpatialGeneration = -1;
  let cached: ObserverPlacementResources | null = null;
  let cachedPlacement: PlacementLedger | null = null;
  let cachedRecipes: ReadonlyMap<string, RegionMapRecipeV1> | null = null;
  return {
    resolve(owner): ObserverPlacementResources {
      const generation = owner.generation();
      const spatialGeneration = owner.spatialGeneration();
      if (owner === cachedOwner && generation === cachedGeneration && cached !== null) {
        return cached;
      }
      if (owner !== cachedOwner || cachedPlacement === null) {
        cachedPlacement = createPlacementFacade(owner);
      }
      if (
        owner !== cachedOwner
        || cachedRecipes === null
        || spatialGeneration !== cachedSpatialGeneration
      ) {
        cachedRecipes = owner.recipes();
      }
      cachedOwner = owner;
      cachedGeneration = generation;
      cachedSpatialGeneration = spatialGeneration;
      cached = Object.freeze({
        ownerId: owner.ownerId,
        generation,
        placement: cachedPlacement,
        recipes: cachedRecipes,
      });
      return cached;
    },
    clear(): void {
      cachedOwner = null;
      cachedGeneration = -1;
      cachedSpatialGeneration = -1;
      cached = null;
      cachedPlacement = null;
      cachedRecipes = null;
    },
  };
}

function createPlacementFacade(owner: PlacementGenerationOwner): PlacementLedger {
  const target = owner.current();
  return new Proxy(target, {
    get(_target, property): unknown {
      const current = owner.current();
      switch (property) {
        case "snapshot": return current.snapshot.bind(current);
        case "fork": return current.fork.bind(current);
        case "commit": return current.commit.bind(current);
        case "placeAgent": return current.placeAgent.bind(current);
        case "placeHome": return current.placeHome.bind(current);
        default: return Reflect.get(current, property, current) as unknown;
      }
    },
  });
}
