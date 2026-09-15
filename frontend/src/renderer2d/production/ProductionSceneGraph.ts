import { bridgeDepthScene, bridgeRailSlices, drawBridgeBase, drawBridgeRail, projectBridgeFeet } from "./depth/BridgeDepth";
import type { AgentSnapshot, HomeSnapshot, RegionSnapshot } from "../../app/schemas";
import { sampleAuthoritativeSpatialMotion } from "../../presentation/spatialMotion";
import {
  assertValidFrameIdentity,
  type FrameIdentity,
  type ObserverSelection,
  type PresentedObserverFrame,
  type PresentedRecord,
  type PresentedSpatialPlayback,
} from "../../presentation/contracts";
import type { Direction4, Rect, Vec2 } from "../contracts";
import { TILE_SIZE, tileCenter } from "../map/regionMap";
import type {
  HumanPrimitiveCommand,
  LayeredHumanSnapshot,
  ProductionActorSignal,
} from "./actors/LayeredHumanActor";
import { BEING_CHIBI_ATLAS_ID } from "./actors/beingChibiAtlas";
import { DEPTH_SCENERY_ATLAS_ID } from "./depth/DepthSceneryAssets";
import { depthSceneryPlacements, depthSceneryInView, DEPTH_SCENERY_FRAME_INTERVAL_MS, drawDepthSceneryProp, drawDepthSceneryShadows, type DepthSceneryPlacement } from "./depth/DepthScenery";
import type { ProductionHumanActor } from "./actors/ProductionHumanActor";
import {
  HUMAN_EXPRESSIONS,
  PRODUCTION_ASSET_MANIFEST,
  PRODUCTION_FACINGS,
  type ProductionAssetLease,
  type ProductionAssetManifest,
} from "./assets/productionManifest";
import type {
  EnvironmentEffectRequest,
  EnvironmentDiagnostics,
  EnvironmentSystem,
  OverlayViewport,
} from "./environment/EnvironmentSystem";
import type {
  HomeActor,
  HomeActorSnapshot,
  HomePrimitiveCommand,
  PresentedHomeInput,
  ProductionHomeSignal,
} from "./homes/HomeActor";
import type { RegionCondition } from "./maps/RegionMapIdentity";
import type { RegionMapRecipeV1 } from "./maps/RegionMapRecipe";
import type {
  AgentPlacement,
  HomePlacement,
  HomePlacementResult,
  PlaceableHome,
  PlacementLedger,
  PlacementLedgerSnapshot,
  ShelterCapacitySnapshot,
  UnplacedHome,
} from "./placement/PlacementLedger";
import { homeRouteExclusionRects, syncArrivalPoint } from "./placement/SpatialDirector";
import {
  findNavigationPath,
  navigationTileIndex,
  wrapNavigationPoint,
} from "./navigation/navigation";
import {
  firstBlockedGroundTile,
  groundTerrainPointIsOpen,
  groundTerrainTileForPoint,
} from "./navigation/groundTerrain";
import type {
  ProductionSceneCommand,
  ProductionSceneCommandBatch,
  ProductionSceneCommandRejection,
  ProductionSceneCommandRejectionReason,
  ProductionSceneCommandResult,
  ProductionSceneSignal,
} from "./ProductionSceneBridge";
import {
  createRendererSemanticSnapshot,
  type RendererSemanticSnapshot,
  type RendererSemanticSubject,
} from "./semantics";
import { decidePathFallback } from "./failurePolicy";
import {
  SHELTER_RENDER_FOOTPRINT,
  feetAnchoredVisualRect,
  presentationPointIsClear,
  presentationRouteIsClear,
  productionRectsOverlap,
} from "./productionGeometry";

export type SceneGraphUpdateOutcome =
  | "applied"
  | "duplicate"
  | "stale"
  | "foreign-lineage"
  | "invalid";

export interface SceneGraphDiff {
  readonly outcome: SceneGraphUpdateOutcome;
  readonly added: readonly string[];
  readonly updated: readonly string[];
  readonly removed: readonly string[];
  readonly staticLayersInvalidated: boolean;
}

export interface ProductionActorFactoryInput {
  readonly record: PresentedRecord<AgentSnapshot>;
  readonly position: Vec2;
  readonly facing: Direction4;
  readonly manifest: ProductionAssetManifest;
  readonly atlasLeases: ReadonlyMap<string, ProductionAssetLease>;
  readonly reducedMotion: boolean;
}

export interface ProductionHomeFactoryInput {
  readonly id: string;
  readonly presented: PresentedHomeInput;
  readonly manifest: ProductionAssetManifest;
  readonly atlasLeases: ReadonlyMap<string, ProductionAssetLease>;
}

export interface ProductionEnvironmentFactoryInput {
  readonly regionId: string;
  readonly recipe: RegionMapRecipeV1;
  readonly condition: RegionCondition;
  readonly manifest: ProductionAssetManifest;
  readonly atlasLeases: ReadonlyMap<string, ProductionAssetLease>;
  readonly reducedMotion: boolean;
}

export interface ProductionSceneFactories {
  createActor(input: ProductionActorFactoryInput): ProductionHumanActor;
  createHome(input: ProductionHomeFactoryInput): HomeActor;
  createEnvironment(input: ProductionEnvironmentFactoryInput): EnvironmentSystem;
}

export interface ProductionSpatialBindingDiagnostics {
  readonly placementRebound: boolean;
  readonly recipesRebound: boolean;
}

export interface ProductionPlacementDebugSnapshot {
  readonly revision: number;
  readonly agents: readonly Readonly<AgentPlacement & { id: string }>[];
  readonly homes: readonly Readonly<HomePlacement & { id: string }>[];
  /** Live free/occupied/total shelter-plot counts for every known region. */
  readonly shelterCapacity: readonly Readonly<ShelterCapacitySnapshot>[];
  /** Every home this ledger could not place on a shelter plot, and why. */
  readonly unplacedHomes: readonly Readonly<UnplacedHome>[];
}

export interface ProductionSceneGraphDebugSnapshot {
  readonly disposed: boolean;
  readonly generation: number;
  readonly spatialBinding: ProductionSpatialBindingDiagnostics;
  readonly placement: ProductionPlacementDebugSnapshot;
  readonly identity: FrameIdentity | null;
  readonly cursors: Readonly<{
    exactBase: number | null;
    projectedThrough: number | null;
    ingested: number | null;
    presented: number | null;
  }>;
  readonly activeRegion: Readonly<{
    id: string;
    recipeIdentityHash: string;
    staticCacheRebuilds: number;
    condition: RegionCondition;
  }> | null;
  readonly actors: readonly Readonly<{
    id: string;
    instanceId: number;
    position: Vec2;
    facing: string;
    activeAction: string | null;
    opacity: number;
    reposition: LayeredHumanSnapshot["reposition"];
    worldBounds: Rect;
    status: AgentSnapshot["status"];
    terminal: boolean;
    selected: boolean;
  }>[];
  readonly homes: readonly Readonly<{
    id: string;
    instanceId: number;
    kind: "home" | "ruin";
    status: "standing" | "ruin" | "unknown";
    plot: Vec2;
    door: Vec2;
    kit: string;
    remnantMaterials: number | null;
    provisional: boolean;
    durable: HomeActorSnapshot["durable"];
    diagnostics: HomeActorSnapshot["diagnostics"];
    geometry: HomeActorSnapshot["geometry"];
    visual: HomeActorSnapshot["visual"];
  }>[];
  readonly environments: readonly Readonly<{
    regionId: string;
    diagnostics: EnvironmentDiagnostics;
  }>[];
  readonly transients: readonly Readonly<{
    commandId: string;
    sceneToken: number;
    motif: "portrait" | "atlas" | "vignette";
    sourceId: string | null;
    targetId: string | null;
    at: Vec2 | null;
  }>[];
  readonly rejections: Readonly<{
    invalid: number;
    stale: number;
    foreignLineage: number;
    malformedRecords: number;
    /**
     * Homes this frame could not build an actor for, and deferred to a later one.
     *
     * Overwhelmingly this is "the region's atlas pack is not mounted yet" -- a
     * region switch in flight, or a shelter standing somewhere the observer has
     * not looked. It is neither a malformed record nor a permanent drop: the home
     * is staged as soon as a frame arrives with the leases in hand. Counted so the
     * deferral can never be silent -- a value that grows without ever settling
     * means a region pack that is never arriving.
     */
    deferredHomes: number;
  }>;
  /**
   * Why the most recent home deferral happened, verbatim.
   *
   * `deferredHomes` alone would be a mute number; this names the actor and the
   * reason so a deferral that never resolves can be diagnosed from the snapshot.
   */
  readonly lastDeferredHomeReason: string | null;
  readonly recentMarkers: readonly Readonly<{
    kind: "actor" | "home";
    actorId?: string;
    homeId?: string;
    marker: string;
    atMs: number;
  }>[];
  readonly regionTransitions: readonly ProductionRegionTransitionWitness[];
  readonly nextDeadlineMs: number | null;
  readonly pathFallbacks: number;
  readonly ownership: Readonly<{
    actors: OwnershipCounterSnapshot;
    homes: OwnershipCounterSnapshot;
    environments: OwnershipCounterSnapshot;
  }>;
}

export interface ProductionRegionTransitionWitness {
  readonly actorId: string;
  readonly reason: "region-transition";
  readonly position: Vec2;
  readonly actorPosition: Vec2;
  readonly gate: Readonly<{
    role: "arrival";
    tile: Readonly<{ column: number; row: number }>;
    tileSize: 32;
    point: Vec2;
  }>;
  readonly fromRegion: string;
  readonly toRegion: string;
  readonly sceneToken: number;
  readonly commandId: string;
  readonly atMs: number;
  readonly frameIdentity: FrameIdentity;
}

export interface OwnershipCounterSnapshot {
  readonly created: number;
  readonly disposed: number;
  readonly outstanding: number;
  readonly peak: number;
}

export interface ProductionSceneHitTarget {
  readonly selection: Exclude<ObserverSelection, null>;
  readonly worldBounds: Rect;
  readonly feetY: number;
  readonly selectionKey: string;
}

export interface ProductionSceneGraph {
  update(
    frame: PresentedObserverFrame,
    batch?: ProductionSceneCommandBatch | null,
    observerViewRegionId?: string | null,
    deferArrivalStaging?: boolean,
  ): SceneGraphDiff;
  applyFrame?(
    frame: PresentedObserverFrame,
    batch: ProductionSceneCommandBatch | null,
    nowMs: number,
    observerViewRegionId?: string | null,
    deferArrivalStaging?: boolean,
  ): ProductionSceneFrameResult;
  commitArrivalStaging?(identity: FrameIdentity): void;
  discardArrivalStaging?(identity: FrameIdentity): void;
  applySceneCommands(batch: ProductionSceneCommandBatch, nowMs: number): ProductionSceneCommandResult;
  sceneSignals(afterSerial?: number): readonly ProductionSceneSignal[];
  updateTime(deltaSeconds: number, nowMs: number): void;
  /** Later wrapped copies of one renderer frame retain earlier copies' visibility. */
  draw(context: CanvasRenderingContext2D, view?: OverlayViewport, pass?: Readonly<{ continueFrame?: boolean }>): void;
  /**
   * Draw ONLY the moving-being pass, with no terrain, scenery, homes or overlay chrome.
   *
   * This is the seam-continuation pass for a toroidal region: the caller translates the
   * canvas by exactly one region extent and calls this, so a being mid-crossing appears
   * on BOTH sides of the seam at once instead of popping out of existence at one edge.
   * Deliberately beings-only — repeating the terrain is the observer-camera wrap that was
   * retired, and repeating homes would invent buildings that are not there.
   *
   * Optional so hand-written graph doubles at unit seams keep satisfying this interface.
   */
  drawSeamActors?(context: CanvasRenderingContext2D): void;
  hitTargets(): readonly ProductionSceneHitTarget[];
  semanticSnapshot(): RendererSemanticSnapshot;
  focusTarget(selection: Exclude<ObserverSelection, null>): ProductionSceneHitTarget | null;
  nextDeadlineMs(): number | null;
  /**
   * Forwards the environment layer's `overlayHoldUntilMs()` -- when the last live piece of
   * legibility chrome expires -- so the camera can hold a beat's framing on the OVERLAY's own
   * clock instead of a second, racing one.
   *
   * Optional for the same reason `applyFrame` is: the compatibility graphs used by unit seams
   * implement this interface by hand and predate the accessor. Callers must treat a missing
   * method as "no overlay clock available" and fall back to their own floor.
   */
  overlayHoldUntilMs?(): number | null;
  /**
   * Forwards the environment layer's `overlayFocusRect()` -- the world rect covering every anchor
   * the live legibility chrome is drawn at -- so the camera can frame exactly what must be read.
   * Optional for the same reason {@link ProductionSceneGraph.overlayHoldUntilMs} is.
   */
  overlayFocusRect?(): Rect | null;
  debugSnapshot(): ProductionSceneGraphDebugSnapshot;
  dispose(): void;
}

export interface ProductionSceneFrameResult {
  readonly outcome: "accepted" | SceneGraphUpdateOutcome | ProductionSceneCommandResult["outcome"];
  readonly diff: SceneGraphDiff | null;
  readonly commands: ProductionSceneCommandResult | null;
}

export interface ProductionSceneGraphOptions {
  readonly manifest: ProductionAssetManifest;
  readonly factories: ProductionSceneFactories;
  readonly placement: PlacementLedger;
  readonly recipes: ReadonlyMap<string, RegionMapRecipeV1>;
  readonly atlasLeases: ReadonlyMap<string, ProductionAssetLease>;
  readonly acquireAtlasLeases?: (ids?: Iterable<string>) => ReadonlyMap<string, ProductionAssetLease>;
  readonly reducedMotion?: boolean;
  readonly spatialBinding?: ProductionSpatialBindingDiagnostics;
}

interface ActorEntry {
  readonly actor: ProductionHumanActor;
  readonly position: Vec2;
  record: PresentedRecord<AgentSnapshot>;
  known: Partial<AgentSnapshot>;
  status: AgentSnapshot["status"];
  selected: boolean;
}

interface RetainedTraveler {
  readonly sceneToken: number;
  readonly runId: string;
  readonly sourceKey: string;
  readonly fromRegion: string;
  readonly toRegion: string;
  readonly arrivalGate: Vec2;
  readonly arrivalCommitted: boolean;
}

interface RetainedTravelerRollback {
  readonly actorId: string;
  readonly previous: RetainedTraveler | undefined;
}

interface PendingRegionTransition {
  readonly actorId: string;
  readonly position: Vec2;
  readonly fromRegion: string;
  readonly toRegion: string;
  readonly sceneToken: number;
  readonly commandId: string;
  readonly frameIdentity: FrameIdentity;
}

interface DestinationArrivalAuthorization {
  readonly commandId: string;
  readonly actorId: string;
  readonly fromRegion: string;
  readonly toRegion: string;
  readonly gate: Vec2;
}

interface HomeEntry {
  readonly actor: HomeActor;
  input: PresentedHomeInput;
  kind: "home" | "ruin";
  provisionalSceneToken: number | null;
}

interface EnvironmentEntry {
  readonly system: EnvironmentSystem;
  readonly regionId: string;
  readonly recipe: RegionMapRecipeV1;
  readonly landmarkInteractionExclusions: readonly Rect[];
  condition: RegionCondition;
  readonly depth: Readonly<{ source: CanvasImageSource; props: readonly DepthSceneryPlacement[] }> | null;
}

interface PreparedActor {
  readonly id: string;
  readonly entry: ActorEntry;
  readonly prior: ActorEntry | null;
}

interface PreparedHome {
  readonly id: string;
  readonly entry: HomeEntry;
}

interface PendingBirthReanchor {
  readonly actorId: string;
  readonly point: Vec2;
}

interface OrderedActorEntry {
  readonly id: string;
  readonly actor: ProductionHumanActor;
  readonly position: Vec2;
}

interface OrderedHomeEntry {
  readonly id: string;
  readonly actor: HomeActor;
  readonly door: Vec2;
  readonly plot: Vec2;
}

interface CandidateRecords {
  readonly actors: Map<string, PresentedRecord<AgentSnapshot>>;
  readonly homes: Map<string, Readonly<{
    record: PresentedRecord<HomeSnapshot>;
    kind: "home" | "ruin";
  }>>;
  readonly regions: Map<string, PresentedRecord<RegionSnapshot>>;
  readonly malformedRecords: number;
}

/** The graph-local wall-clock anchor for one session playback sample. */
interface SpatialPlaybackAnchor extends PresentedSpatialPlayback {
  readonly wallAnchorMs: number;
}

const EMPTY_CURSORS = Object.freeze({
  exactBase: null,
  projectedThrough: null,
  ingested: null,
  presented: null,
});
const MAX_MARKERS = 64;
const MAX_SCENE_SIGNALS = 256;
const MOVEMENT_FRAME_INTERVAL_MS = 1_000 / 60;

/** Create a persistent durable scene projection for one selected frame lineage. */
export function createProductionSceneGraph(options: ProductionSceneGraphOptions): ProductionSceneGraph {
  const manifest = options.manifest;
  const factories = options.factories;
  const placement = options.placement;
  const recipes = options.recipes;
  const acquireAtlasLeases = options.acquireAtlasLeases
    ?? (() => borrowedAtlasLeases(options.atlasLeases));
  const reducedMotion = options.reducedMotion ?? false;
  const spatialBinding = Object.freeze({
    placementRebound: options.spatialBinding?.placementRebound ?? false,
    recipesRebound: options.spatialBinding?.recipesRebound ?? false,
  });
  const actors = new Map<string, ActorEntry>();
  const homes = new Map<string, HomeEntry>();
  let visibleActorIds = new Set<string>();
  const ownership = {
    actors: ownershipCounter(),
    homes: ownershipCounter(),
    environments: ownershipCounter(),
  };
  const disposeActor = (actor: ProductionHumanActor): void => {
    actor.dispose();
    recordDisposed(ownership.actors);
  };
  const disposeHome = (home: HomeActor): void => {
    home.dispose();
    recordDisposed(ownership.homes);
  };
  const disposeEnvironment = (system: EnvironmentSystem): void => {
    system.dispose();
    recordDisposed(ownership.environments);
  };
  let orderedActors: readonly OrderedActorEntry[] = [];
  let orderedBeingFeet: readonly Vec2[] = [];
  let depthMotionVisible = false;
  let orderedHomes: readonly OrderedHomeEntry[] = [];
  /**
   * Every currently-standing home's spatial-truth exclusion geometry (see
   * `SpatialDirector.homeRouteExclusionRects`) -- kept in sync with
   * `orderedHomes` by `refreshEnvironmentExclusions()`, so the actor-move
   * legality gate in `applySceneCommands()` never needs to recompute it per
   * command. Home footprints are excluded from ordinary movement/reposition
   * the same way scenic-landmark interaction zones already are; only the
   * door threshold stays open.
   */
  let homeRouteExclusions: readonly Rect[] = [];
  let environment: EnvironmentEntry | null = null;
  let identity: FrameIdentity | null = null;
  let semanticRegionAction: string | null = null;
  let semanticRegionStatus = "projected-partial";
  let cursors: ProductionSceneGraphDebugSnapshot["cursors"] = EMPTY_CURSORS;
  let generation = 0;
  let staticCacheRebuilds = 0;
  let disposed = false;
  let lastNowMs = 0;
  // `worldTime` remains checkpoint truth only. This anchor is advanced from
  // the presentation session's explicit replay/pause/speed clock instead.
  let spatialPlayback: SpatialPlaybackAnchor | null = null;
  let worldTime = 0;
  const recentMarkers: Array<ProductionSceneGraphDebugSnapshot["recentMarkers"][number]> = [];
  const regionTransitions: ProductionRegionTransitionWitness[] = [];
  const sceneSignalHistory: ProductionSceneSignal[] = [];
  const actorCommandBindings = new Map<string, Readonly<{ sceneToken: number; commandId: string }>>();
  const homeCommandBindings = new Map<string, Readonly<{ sceneToken: number; commandId: string }>>();
  const seenSceneCommandIds = new Set<string>();
  const actorHitStopUntilMs = new Map<string, number>();
  const movingActorIds = new Set<string>();
  const pendingMovementStartIds = new Set<string>();
  const fallbackRepositionActors = new Set<string>();
  let pathFallbacks = 0;
  const remoteTransients = new Map<string, Readonly<{
    commandId: string;
    sceneToken: number;
    motif: "portrait" | "atlas" | "vignette";
    sourceId: string | null;
    targetId: string | null;
    at: Vec2 | null;
  }>>();
  const retainedTravelers = new Map<string, RetainedTraveler>();
  const pendingRegionTransitions = new Map<string, PendingRegionTransition>();
  const consumedPlacementHintIds = new Set<string>();
  const consumedArrivalStagingIds = new Set<string>();
  const preparedProvisionalHomes = new Map<string, HomeEntry>();
  let activeSceneToken = -1;
  let nextSceneSignalSerial = 1;
  let pendingArrivalStaging: Readonly<{
    identity: FrameIdentity;
    arrivals: readonly DestinationArrivalAuthorization[];
  }> | null = null;
  const rejections = {
    invalid: 0,
    stale: 0,
    foreignLineage: 0,
    malformedRecords: 0,
    deferredHomes: 0,
  };
  /** Why the most recent home deferral happened, so the counter is never mute. */
  let lastDeferredHomeReason: string | null = null;
  /**
   * Records one home the graph could not build an actor for this frame.
   *
   * Side effects: increments `rejections.deferredHomes` and replaces
   * `lastDeferredHomeReason`.
   *
   * @returns The recorded reason, for callers that must also name it in a
   *   command rejection.
   */
  const noteDeferredHome = (homeId: string, error: unknown): string => {
    rejections.deferredHomes += 1;
    lastDeferredHomeReason = describeDeferral(homeId, error);
    return lastDeferredHomeReason;
  };

  function update(
    frame: PresentedObserverFrame,
    batch: ProductionSceneCommandBatch | null = null,
    observerViewRegionId: string | null = null,
    deferArrivalStaging = false,
  ): SceneGraphDiff {
    assertNotDisposed();
    try {
      assertValidFrameIdentity(frame);
    } catch {
      rejections.invalid += 1;
      return emptyDiff("invalid");
    }
    if (!validPresentedWorldCursors(frame)) {
      rejections.invalid += 1;
      return emptyDiff("invalid");
    }

    if (identity !== null) {
      if (frame.runId !== identity.runId || frame.sourceKey !== identity.sourceKey) {
        rejections.foreignLineage += 1;
        return emptyDiff("foreign-lineage");
      }
      const changesObserverRegion = observerViewRegionId !== null
        && observerViewRegionId !== (environment?.regionId ?? null);
      const changesStoryRegion = observerViewRegionId === null
        && frame.scene?.regionId !== undefined
        && frame.scene.regionId !== (environment?.regionId ?? null);
      const changesCheckpointRegion = observerViewRegionId === null
        && frame.checkpointFocus !== undefined
        && frame.checkpointFocus !== null
        && frame.checkpointFocus.regionId !== (environment?.regionId ?? null);
      if (sameIdentity(frame, identity)
        && !changesObserverRegion
        && !changesStoryRegion
        && !changesCheckpointRegion) {
        adoptSpatialPlayback(frame.spatialPlayback);
        return emptyDiff("duplicate");
      }
      if (frame.revision < identity.revision
        || frame.firstCursor < identity.firstCursor
        || frame.lastCursor < identity.lastCursor
        || (cursors.exactBase !== null && frame.world.exactBaseCursor < cursors.exactBase)
        || (cursors.projectedThrough !== null
          && frame.world.projectedThroughCursor < cursors.projectedThrough)) {
        rejections.stale += 1;
        return emptyDiff("stale");
      }
    }

    adoptSpatialPlayback(frame.spatialPlayback);

    const candidate = collectCandidateRecords(frame);
    if (candidate === null) {
      rejections.invalid += 1;
      return emptyDiff("invalid");
    }

    const activeRegionId = resolveActiveRegion(
      frame,
      candidate.regions,
      environment?.regionId ?? null,
      observerViewRegionId,
    );
    const nextRecipe = activeRegionId === null ? null : recipes.get(activeRegionId) ?? null;
    if (activeRegionId !== null && nextRecipe === null) {
      rejections.invalid += 1;
      return emptyDiff("invalid");
    }
    const nextLandmarkInteractionExclusions = nextRecipe === null
      ? Object.freeze([] as Rect[])
      : landmarkInteractionExclusionRects(nextRecipe);
    const retainedForFrame = applicableRetainedTravelers(
      retainedTravelers,
      actors,
      candidate.actors,
      recipes,
      frame,
      batch?.sceneToken ?? null,
    );
    const placementSnapshot = placement.snapshot();
    const destinationArrivals = matchingDestinationArrivalAuthorizations(
      frame,
      batch,
      retainedForFrame.valid,
      actors,
      candidate.actors,
      placementSnapshot,
      recipes,
    );
    const activeActors = activeActorRecords(
      candidate.actors,
      activeRegionId,
      actors,
      destinationArrivals,
      retainedForFrame.valid,
    );
    const nextVisibleActorIds = new Set([...activeActors.keys()].filter((actorId) => {
      const arrival = destinationArrivals.get(actorId);
      if (arrival !== undefined) return arrival.toRegion === activeRegionId;
      const record = activeActors.get(actorId)!;
      const explicitRegion = record.value.position;
      const knownRegion = actors.get(actorId)?.known.position;
      const presentedRegion = typeof explicitRegion === "string"
        ? explicitRegion
        : typeof knownRegion === "string" ? knownRegion : null;
      return presentedRegion === activeRegionId;
    }));
    const activeHomes = activeHomeRecords(
      candidate.homes,
      activeRegionId,
      homes,
      environment?.regionId ?? null,
    );
    const unresolvedVisibleRecords = countUnlocatedActors(candidate.actors, actors)
      + countUnlocatedHomes(candidate.homes, homes);
    const placementHints = matchingPlacementHints(frame, batch, consumedPlacementHintIds);
    const needsCandidatePlacement = placementHints.length > 0
      || [...activeActors.keys()].some((id) => !placementSnapshot.agents.has(id))
      || [...activeHomes.keys()].some((id) => !placementSnapshot.homes.has(id))
      || [...activeActors].some(([id, record]) => (
        authoritativeReanchorPoint(actors.get(id)?.known ?? {}, record.value) !== null
      ));
    const candidatePlacement = needsCandidatePlacement ? placement.fork() : placement;
    const consumedPlacementHints: string[] = [];
    const completedArrivals: PendingRegionTransition[] = [];
    const pendingBirthReanchors = new Map<string, PendingBirthReanchor>();

    for (const hint of placementHints) {
      const record = activeActors.get(hint.agentId);
      if (record === undefined || !isCreatableAgent(record.value)) continue;
      // A spatial actor already has explicit world feet. A legacy birth/arrival
      // hint must never replace them with a staging anchor.
      if (record.value.spatial !== undefined) continue;
      const before = candidatePlacement.snapshot();
      if (!validPlacementHint(hint, record.value, before, recipes)) continue;
      const actorEntry = actors.get(hint.agentId);
      const allowProvisionalReanchor = eligibleBirthReanchorRequest(
        hint,
        actorEntry,
        before,
      );
      try {
        const nextPlacement = candidatePlacement.placeAgent(
          record.value,
          hint.context.kind === "birth"
            ? { ...hint.context, allowProvisionalReanchor }
            : { ...hint.context, requestedFinal: hint.requestedFinal },
        );
        if (allowProvisionalReanchor && actorEntry !== undefined) {
          const priorPlacement = before.agents.get(hint.agentId);
          if (priorPlacement !== undefined && !samePoint(priorPlacement.point, nextPlacement.point)) {
            pendingBirthReanchors.set(hint.agentId, {
              actorId: hint.agentId,
              point: { ...nextPlacement.point },
            });
          }
        }
      } catch {
        continue;
      }
      consumedPlacementHints.push(hint.commandId);
      if (hint.context.kind === "arrival" && batch !== null) {
        const traveler = retainedForFrame.valid.get(hint.agentId);
        const destination = record.value.position;
        if (traveler !== undefined
          && destination === traveler.toRegion
          && hint.context.fromRegion === traveler.fromRegion
          && hint.arrivalGate !== undefined
          && samePoint(hint.arrivalGate, traveler.arrivalGate)) {
          completedArrivals.push({
            actorId: hint.agentId,
            position: { ...traveler.arrivalGate },
            fromRegion: traveler.fromRegion,
            toRegion: traveler.toRegion,
            sceneToken: batch.sceneToken,
            commandId: hint.commandId,
            frameIdentity: { ...batch.identity },
          });
        }
      }
    }

    const added: string[] = [];
    const updated: string[] = [];
    const removed: string[] = [];
    const preparedActors: PreparedActor[] = [];
    const preparedHomes: PreparedHome[] = [];
    let preparedEnvironment: EnvironmentEntry | null = null;
    let stagedMalformedRecords = 0;
    const priorEnvironment = environment;
    const switchingRegion = activeRegionId !== (environment?.regionId ?? null);

    try {
      for (const id of [...activeActors.keys()].sort(compareText)) {
        const record = activeActors.get(id)!;
        const existing = actors.get(id) ?? null;
        const replacesTerminal = existing !== null
          && existing.actor.snapshot().terminal
          && record.completeness === "exact"
          && record.value.status === "alive";
        if (existing !== null && !replacesTerminal) continue;
        if (!isCreatableAgent(record.value)) {
          stagedMalformedRecords += 1;
          continue;
        }
        let localPlacement = candidatePlacement.snapshot().agents.get(id)
          ?? candidatePlacement.placeAgent(record.value);
        const authoritativePlacement = record.value.spatial
          ?? record.value.spatial_migration?.source_position;
        if (authoritativePlacement !== undefined) {
          // First render uses backend feet immediately. The ledger is updated in
          // the candidate transaction too, so effect contacts, follow targets,
          // hit testing, and depth ordering all share the same point.
          candidatePlacement.updateAgentPoint(id, authoritativePlacement);
          localPlacement = candidatePlacement.snapshot().agents.get(id)!;
        }
        const atlasLeases = acquireAtlasLeases(coreActorAtlasIds(manifest));
        let actor: ProductionHumanActor;
        try {
          actor = factories.createActor({
            record,
            position: localPlacement.point,
            facing: "south",
            manifest,
            atlasLeases,
            reducedMotion,
          });
        } catch (error) {
          releaseAtlasLeases(atlasLeases);
          throw error;
        }
        preparedActors.push({
          id,
          prior: existing,
          entry: {
            actor,
            position: { ...actor.snapshot().position },
            record,
            known: { ...record.value },
            // Frozen Task 8 actors begin alive; durable terminal/paralyzed truth is
            // applied in the common reconciliation pass after atomic preparation.
            status: "alive",
            selected: false,
          },
        });
      }

      for (const id of [...activeHomes.keys()].sort(compareText)) {
        if (homes.has(id)) continue;
        const candidateHome = activeHomes.get(id)!;
        if (!isCreatableHome(candidateHome.record.value)) {
          stagedMalformedRecords += 1;
          continue;
        }
        const presented = presentedHomeInput(
          candidateHome.record,
          frame.world,
          candidatePlacement,
          recipes,
        );
        // No legal shelter plot remains in this home's region. This is not a
        // malformed record and not swallowed: `candidatePlacement` already
        // recorded WHY (see `PlacementLedger.placeHome`'s docstring), and
        // that stays diagnosable via `debugSnapshot().placement`. We simply
        // create no actor this frame -- there is no legal plot to draw one
        // at, and inventing one is exactly the growth/topology work this
        // phase must not do.
        if (presented === null) continue;
        const atlasLeases = acquireAtlasLeases(homeActorAtlasIds(manifest, presented.kit));
        let actor: HomeActor;
        try {
          actor = factories.createHome({ id, presented, manifest, atlasLeases });
        } catch (error) {
          releaseAtlasLeases(atlasLeases);
          // This home cannot be built from what the renderer can currently lease
          // -- in practice its region's atlas pack is not mounted, because a
          // region switch is in flight or the shelter stands somewhere the
          // observer has not looked. That is transient and it is emphatically NOT
          // a reason to fail the frame: rethrowing here aborted the ENTIRE commit,
          // and since every later frame carried the same home the graph could
          // never reach the state in which the pack would be mounted. The world
          // wedged at that cursor for the rest of the run. Defer the one home
          // instead -- exactly as the no-legal-plot case above does -- and stage
          // it on the first frame whose leases can build it.
          noteDeferredHome(id, error);
          continue;
        }
        preparedHomes.push({
          id,
          entry: { actor, input: presented, kind: candidateHome.kind, provisionalSceneToken: null },
        });
      }

      if (switchingRegion && activeRegionId !== null && nextRecipe !== null) {
        const condition = deriveCandidateCondition(
          candidate.regions.get(activeRegionId),
          null,
        ) ?? { energyRatio: 0, materialsRatio: 0 };
        const atlasLeases = acquireAtlasLeases(environmentAtlasIds(manifest, nextRecipe.kit));
        let system: EnvironmentSystem;
        try {
          system = factories.createEnvironment({
            regionId: activeRegionId,
            recipe: nextRecipe,
            condition,
            manifest,
            atlasLeases,
            reducedMotion,
          });
        } catch (error) {
          releaseAtlasLeases(atlasLeases);
          throw error;
        }
        preparedEnvironment = {
          system,
          regionId: activeRegionId,
          recipe: nextRecipe,
          landmarkInteractionExclusions: nextLandmarkInteractionExclusions,
          condition,
          depth: atlasLeases.has(DEPTH_SCENERY_ATLAS_ID) ? {
            source: atlasLeases.get(DEPTH_SCENERY_ATLAS_ID)!.value,
            props: depthSceneryPlacements(nextRecipe),
          } : null,
        };
      }
    } catch (error) {
      disposePrepared(
        preparedActors,
        preparedHomes,
        preparedEnvironment,
      );
      throw error;
    }

    const reconciledHomes: Array<Readonly<{
      entry: HomeEntry;
      previous: PresentedHomeInput;
      kind: "home" | "ruin";
      provisionalSceneToken: number | null;
    }>> = [];
    const rollbackReconciledHomes = (): void => {
      for (const rollback of [...reconciledHomes].reverse()) {
        rollback.entry.actor.reconcile(rollback.previous, "transaction-rollback");
        rollback.entry.input = rollback.previous;
        rollback.entry.kind = rollback.kind;
        rollback.entry.provisionalSceneToken = rollback.provisionalSceneToken;
      }
    };
    try {
      for (const id of [...activeHomes.keys()].sort(compareText)) {
        const entry = homes.get(id);
        if (!entry) continue;
        const candidateHome = activeHomes.get(id)!;
        const reconciledRecord = protectProjectedTerminalHome(entry, candidateHome.record);
        const adoptsProvisional = candidateHome.record.completeness === "exact"
          || isProjectedBuildConsequence(entry, candidateHome.record, candidateHome.kind);
        const reconciledInput = reconcileHomeInput(
          entry,
          reconciledRecord,
          frame.world,
          candidatePlacement,
          recipes,
        );
        const nextInput = adoptsProvisional
          ? { ...reconciledInput, provisional: false }
          : reconciledInput;
        const previous = entry.input;
        const previousKind = entry.kind;
        const nextKind = entry.kind === "ruin"
          && candidateHome.record.completeness === "projected-partial"
          ? "ruin"
          : candidateHome.kind;
        entry.actor.reconcile(nextInput);
        reconciledHomes.push({
          entry,
          previous,
          kind: previousKind,
          provisionalSceneToken: entry.provisionalSceneToken,
        });
        entry.input = nextInput;
        entry.kind = nextKind;
        if (adoptsProvisional) entry.provisionalSceneToken = null;
      }
    } catch (error) {
      rollbackReconciledHomes();
      disposePrepared(
        preparedActors,
        preparedHomes,
        preparedEnvironment,
      );
      throw error;
    }

    const stagedActorRollbacks: Array<Readonly<{
      entry: ActorEntry;
      rollback: () => void;
    }>> = [];
    const reconciledActors: Array<Readonly<{
      id: string;
      entry: ActorEntry;
      record: PresentedRecord<AgentSnapshot>;
      nextKnown: Partial<AgentSnapshot>;
      nextStatus: AgentSnapshot["status"];
      selected: boolean;
      movementWasActive: boolean;
      movementIsActive: boolean;
    }>> = [];
    let reconciledEnvironment: Readonly<{
      entry: EnvironmentEntry;
      previous: RegionCondition;
    }> | null = null;
    const rollbackEnvironment = (): void => {
      if (reconciledEnvironment === null) return;
      reconciledEnvironment.entry.system.reconcile(reconciledEnvironment.previous);
      reconciledEnvironment.entry.condition = reconciledEnvironment.previous;
    };
    try {
      for (const reanchor of pendingBirthReanchors.values()) {
        const entry = actors.get(reanchor.actorId);
        if (entry === undefined) throw new Error(`Missing projected newborn actor ${reanchor.actorId}.`);
        if (hasAuthoritativeSpatialOwnership(entry)) continue;
        const rollback = entry.actor.stagePosition(reanchor.point);
        if (rollback === null) throw new Error(`Projected newborn actor ${reanchor.actorId} rejected birth staging.`);
        stagedActorRollbacks.push({ entry, rollback });
        if (!samePoint(entry.actor.snapshot().position, reanchor.point)) {
          throw new Error(`Projected newborn actor ${reanchor.actorId} did not adopt its birth placement.`);
        }
      }
      const arrivalsToStage = [
        ...(deferArrivalStaging ? [] : destinationArrivals.values()),
        ...completedArrivals.map((arrival) => ({
          actorId: arrival.actorId,
          gate: arrival.position,
        })),
      ];
      for (const arrival of arrivalsToStage) {
        const entry = actors.get(arrival.actorId);
        if (entry === undefined) throw new Error(`Missing retained destination actor ${arrival.actorId}.`);
        if (hasAuthoritativeSpatialOwnership(entry)) continue;
        const rollback = entry.actor.stagePosition(arrival.gate);
        if (rollback === null) throw new Error(`Retained destination actor ${arrival.actorId} rejected staging.`);
        stagedActorRollbacks.push({ entry, rollback });
        if (!samePoint(entry.actor.snapshot().position, arrival.gate)) {
          throw new Error(`Retained destination actor ${arrival.actorId} did not adopt its arrival gate.`);
        }
      }

      if (!switchingRegion && environment !== null) {
        const condition = deriveCandidateCondition(
          candidate.regions.get(environment.regionId),
          environment.condition,
        );
        if (condition !== null) {
          reconciledEnvironment = { entry: environment, previous: environment.condition };
          environment.system.reconcile(condition);
          environment.condition = condition;
        }
      }

      const preparedActorEntries = new Map(preparedActors.map(({ id, entry }) => [id, entry] as const));
      for (const id of [...activeActors.keys()].sort(compareText)) {
        const entry = preparedActorEntries.get(id) ?? actors.get(id);
        if (!entry) continue;
        const record = activeActors.get(id)!;
        const beforeActor = entry.actor.snapshot();
        const terminalProjectedContradiction = beforeActor.terminal
          && record.completeness === "projected-partial"
          && validAgentStatus(record.value.status)
          && record.value.status !== entry.status;
        const nextKnown = mergeKnown(entry.known, terminalProjectedContradiction
          ? { ...record.value, status: entry.status }
          : record.value);
        const authoritativeReanchor = authoritativeReanchorPoint(entry.known, record.value);
        if (authoritativeReanchor !== null) {
          candidatePlacement.updateAgentPoint(id, authoritativeReanchor);
          const rollback = entry.actor.stagePosition(authoritativeReanchor);
          if (rollback === null) {
            throw new Error(`Authoritative spatial actor ${id} rejected its supplied position.`);
          }
          stagedActorRollbacks.push({ entry, rollback });
        }
        const candidateStatus = validAgentStatus(record.value.status) ? record.value.status : entry.status;
        const nextStatus = terminalProjectedContradiction ? entry.status : candidateStatus;
        const selected = frame.selection?.kind === "agent" && frame.selection.id === id;
        const commands: HumanPrimitiveCommand[] = [];
        if (nextStatus !== entry.status) commands.push({ kind: "set-status", status: nextStatus });
        if (selected !== entry.selected) commands.push({ kind: "set-selected", selected });
        const rollback = entry.actor.stageCommands(commands, lastNowMs);
        stagedActorRollbacks.push({ entry, rollback });
        reconciledActors.push({
          id,
          entry,
          record,
          nextKnown,
          nextStatus,
          selected,
          movementWasActive: beforeActor.routeActive,
          movementIsActive: entry.actor.snapshot().routeActive,
        });
      }
      for (const { id, entry } of reconciledActors) {
        if (!nextVisibleActorIds.has(id)) continue;
        if (!presentationPointIsClear(
          entry.actor.snapshot().position,
          nextLandmarkInteractionExclusions,
        )) {
          throw new Error(`Actor ${id} intersects tall scenic landmark presentation.`);
        }
      }
      if (candidatePlacement !== placement) placement.commit(candidatePlacement);
    } catch (error) {
      for (const rollback of [...stagedActorRollbacks].reverse()) {
        rollback.rollback();
      }
      rollbackEnvironment();
      rollbackReconciledHomes();
      disposePrepared(
        preparedActors,
        preparedHomes,
        preparedEnvironment,
      );
      throw error;
    }
    for (const arrival of destinationArrivals.values()) {
      movingActorIds.delete(arrival.actorId);
      pendingMovementStartIds.delete(arrival.actorId);
      consumedArrivalStagingIds.add(arrival.commandId);
    }
    pendingArrivalStaging = deferArrivalStaging && destinationArrivals.size > 0
      ? {
          identity: copyIdentity(frame),
          arrivals: [...destinationArrivals.values()].map((arrival) => ({
            ...arrival,
            gate: { ...arrival.gate },
          })),
        }
      : null;
    for (const actorId of retainedForFrame.invalidActorIds) retainedTravelers.delete(actorId);
    for (const commandId of consumedPlacementHints) consumedPlacementHintIds.add(commandId);
    for (const [commandId, transition] of pendingRegionTransitions) {
      if (!sameIdentity(transition.frameIdentity, frame)) pendingRegionTransitions.delete(commandId);
    }
    for (const transition of completedArrivals) {
      pendingRegionTransitions.set(transition.commandId, transition);
    }

    for (const { id, entry, prior } of preparedActors) {
      recordCreated(ownership.actors);
      actors.set(id, entry);
      if (prior === null) added.push(entityKey("agent", id));
    }
    for (const { id, entry } of preparedHomes) {
      recordCreated(ownership.homes);
      homes.set(id, entry);
      added.push(entityKey(entry.kind, id));
    }
    if (preparedEnvironment !== null) recordCreated(ownership.environments);

    for (const {
      id,
      entry,
      record,
      nextKnown,
      nextStatus,
      selected,
      movementWasActive,
      movementIsActive,
    } of reconciledActors) {
      if (!added.includes(entityKey("agent", id))) updated.push(entityKey("agent", id));
      entry.record = record;
      entry.known = nextKnown;
      entry.status = nextStatus;
      entry.selected = selected;
      synchronizeActorMovement(id, movementWasActive, movementIsActive);
    }

    for (const id of [...activeHomes.keys()].sort(compareText)) {
      const entry = homes.get(id);
      if (!entry) continue;
      const currentKey = entityKey(entry.kind, id);
      if (!added.includes(currentKey)) updated.push(currentKey);
      // Owner decision: home status-mark badges show only on selection (this
      // renderer has no independent hover concept). Mirrors how actors
      // already derive `selected` from `frame.selection` above; kind must
      // match too so a stale "home" selection doesn't re-select an entry
      // that has since collapsed into a "ruin" (or vice versa).
      const selected = (frame.selection?.kind === "home" && entry.kind === "home" && frame.selection.id === id)
        || (frame.selection?.kind === "ruin" && entry.kind === "ruin" && frame.selection.id === id);
      entry.actor.setSelected(selected);
    }

    const actorVisibilityChanged = !sameStringSet(visibleActorIds, nextVisibleActorIds);
    let structuralEntitiesChanged = preparedActors.length > 0
      || preparedHomes.length > 0
      || destinationArrivals.size > 0
      || pendingBirthReanchors.size > 0
      || actorVisibilityChanged;
    for (const [id, entry] of [...actors]) {
      if (activeActors.has(id)) continue;
      const durableRecord = candidate.actors.get(id);
      const durableValue = durableRecord?.completeness === "exact"
        ? durableRecord.value
        : durableRecord === undefined ? null : mergeKnown(entry.known, durableRecord.value);
      if (observerViewRegionId === null
        && !retainedForFrame.invalidActorIds.includes(id)
        && durableValue !== null
        && isCreatableAgent(durableValue)) continue;
      disposeActor(entry.actor);
      actors.delete(id);
      movingActorIds.delete(id);
      pendingMovementStartIds.delete(id);
      retainedTravelers.delete(id);
      actorCommandBindings.delete(id);
      actorHitStopUntilMs.delete(id);
      fallbackRepositionActors.delete(id);
      structuralEntitiesChanged = true;
      removed.push(entityKey("agent", id));
    }
    for (const [id, entry] of [...homes]) {
      if (activeHomes.has(id)) continue;
      if (entry.provisionalSceneToken === activeSceneToken
        && entry.input.record.value.region === activeRegionId) continue;
      disposeHome(entry.actor);
      homes.delete(id);
      structuralEntitiesChanged = true;
      removed.push(entityKey(entry.kind, id));
    }

    if (switchingRegion) {
      if (priorEnvironment !== null) {
        disposeEnvironment(priorEnvironment.system);
        removed.push(entityKey("region", priorEnvironment.regionId));
      }
      environment = preparedEnvironment;
      depthMotionVisible = false;
      if (environment !== null) added.push(entityKey("region", environment.regionId));
      staticCacheRebuilds += 1;
    } else if (environment !== null) {
      updated.push(entityKey("region", environment.regionId));
    }

    visibleActorIds = nextVisibleActorIds;
    for (const [actorId, traveler] of retainedForFrame.valid) {
      if (traveler.arrivalCommitted
        && traveler.toRegion === activeRegionId
        && visibleActorIds.has(actorId)) retainedTravelers.delete(actorId);
    }
    if (structuralEntitiesChanged) rebuildStructuralOrder();
    else refreshEnvironmentExclusions();
    for (const prepared of preparedActors) {
      if (prepared.prior !== null) disposeActor(prepared.prior.actor);
    }

    rejections.malformedRecords += candidate.malformedRecords + unresolvedVisibleRecords + stagedMalformedRecords;
    identity = copyIdentity(frame);
    semanticRegionAction = frame.scene?.regionId === activeRegionId ? frame.scene.phase : null;
    semanticRegionStatus = activeRegionId === null
      ? "projected-partial"
      : candidate.regions.get(activeRegionId)?.completeness ?? "projected-partial";
    worldTime = frame.world.worldTime;
    cursors = {
      exactBase: frame.world.exactBaseCursor,
      projectedThrough: frame.world.projectedThroughCursor,
      ingested: frame.ingestedCursor,
      presented: frame.presentedCursor,
    };
    generation += 1;
    return freezeDiff({
      outcome: "applied",
      added,
      updated,
      removed,
      staticLayersInvalidated: switchingRegion,
    });
  }

  function updateTime(deltaSeconds: number, nowMs: number): void {
    if (disposed) return;
    const safeNow = Number.isFinite(nowMs) ? Math.max(lastNowMs, nowMs) : lastNowMs;
    const safeDelta = Number.isFinite(deltaSeconds) && deltaSeconds >= 0 ? deltaSeconds : 0;
    lastNowMs = safeNow;
    const spatialAt = sampledSpatialPlaybackAt(safeNow);
    const advancedMovers = new Set([...movingActorIds]
      .filter((actorId) => isActorTimeActive(actorId) && !pendingMovementStartIds.has(actorId)));
    const repositionedActors = new Set<string>();
    const authoritativeMovers = new Set<string>();
    for (const [actorId, entry] of actors) {
      if (!isActorTimeActive(actorId)) continue;
      if (spatialAt !== null && entry.known.spatial !== undefined) {
        const motion = sampleAuthoritativeSpatialMotion(entry.known.spatial, spatialAt);
        entry.actor.sampleAuthoritativeMotion(motion, safeNow);
        // The placement ledger is the shared feet authority for bubbles,
        // effects, follow framing, hit targets, and sort order. Do not wait for
        // a renderer arrival signal: a spatial route has no such invented beat.
        syncArrivalPoint(placement, actorId, motion.position);
        if (motion.traveling) authoritativeMovers.add(actorId);
      }
      if (pendingMovementStartIds.delete(actorId)) continue;
      if ((actorHitStopUntilMs.get(actorId) ?? Number.NEGATIVE_INFINITY) > safeNow) continue;
      actorHitStopUntilMs.delete(actorId);
      const signals = entry.actor.advance(safeDelta, safeNow);
      if (signals.some(({ kind }) => kind === "repositioned")) repositionedActors.add(actorId);
      if (signals.some(({ kind }) => kind === "arrived")) {
        movingActorIds.delete(actorId);
        pendingMovementStartIds.delete(actorId);
        // Spatial-truth freshness (see SpatialDirector.syncArrivalPoint): a
        // completed walk is the one moment this being's true position is
        // authoritatively settled, so refresh the placement ledger's anchor
        // now -- every choreography beat resolved after this reads
        // `context.placement.agents.get(id)?.point` as "where this agent
        // currently stands", and without this it would keep reading the
        // stale region-entry anchor for the being's entire stay.
        // Toroidal regions route with UNROLLED waypoints, so a being that has just
        // walked off an edge settles at a position outside the region's own rect (e.g.
        // x = -16). Canonicalise it here, at the single moment the walk is over: the
        // seam continuation copy has been drawing the being at exactly this canonical
        // point throughout the crossing, so the primary sprite lands where the viewer
        // has already been watching it and nothing jumps. Leaving it unrolled would
        // strand the being outside the world and teleport it on its next route.
        const settled = entry.actor.snapshot().position;
        // `entry.record.value.position` is the being's REGION id (an agent snapshot's
        // "position" is where in the world it is, not its pixel point) and is already in
        // hand -- deliberately not `placement.snapshot()`, which deep-clones every agent
        // and home record and would run on every arrival.
        const settledRegionId = entry.record.value.position;
        const grid = settledRegionId === undefined
          ? null
          : options.recipes.get(settledRegionId)?.grid ?? null;
        const canonical = grid === null ? settled : wrapNavigationPoint(grid, settled);
        if (!hasAuthoritativeSpatialOwnership(entry) && (canonical.x !== settled.x || canonical.y !== settled.y)) {
          entry.actor.stagePosition(canonical);
        }
        if (!hasAuthoritativeSpatialOwnership(entry)) syncArrivalPoint(placement, actorId, canonical);
      }
      recordActorSignals(signals, actorId, safeNow);
    }
    refreshMovingActorOrder(new Set([...advancedMovers, ...repositionedActors, ...authoritativeMovers]));
    refreshEnvironmentExclusions();
    for (const entry of orderedHomes) {
      recordHomeSignals(entry.actor.advanceTo(safeNow), entry.id, safeNow);
    }
    environment?.system.advanceTo(safeNow);
  }

  function applySceneCommands(
    batch: ProductionSceneCommandBatch,
    nowMs: number,
  ): ProductionSceneCommandResult {
    assertNotDisposed();
    if (!isValidProductionSceneCommandBatch(batch) || !Number.isFinite(nowMs) || nowMs < 0) {
      return sceneCommandResult("invalid", [], []);
    }
    if (identity === null || !sameIdentity(batch.identity, identity)) {
      return sceneCommandResult(
        "stale-identity",
        [],
        batch.commands.map(({ commandId }) => commandId),
        batchRejections(batch.commands, "stale-batch", "the batch belongs to another frame lineage"),
      );
    }
    if (batch.sceneToken < activeSceneToken) {
      return sceneCommandResult(
        "stale-scene",
        [],
        batch.commands.map(({ commandId }) => commandId),
        batchRejections(batch.commands, "stale-batch", "the batch's scene token has been superseded"),
      );
    }
    if (batch.sceneToken > activeSceneToken) {
      disposeProvisionalHomes();
      for (const entry of actors.values()) {
        if (!hasAuthoritativeSpatialOwnership(entry)) entry.actor.cancelFallbackReposition();
      }
      rebuildStructuralOrder();
      activeSceneToken = batch.sceneToken;
      seenSceneCommandIds.clear();
      actorCommandBindings.clear();
      homeCommandBindings.clear();
      actorHitStopUntilMs.clear();
      fallbackRepositionActors.clear();
      for (const [actorId, traveler] of retainedTravelers) {
        if (batch.sceneToken > traveler.sceneToken + (traveler.arrivalCommitted ? 0 : 1)) {
          retainedTravelers.delete(actorId);
        }
      }
      remoteTransients.clear();
    }

    const safeNow = Math.max(lastNowMs, nowMs);
    lastNowMs = safeNow;
    const applied: string[] = [];
    const ignored: string[] = [];
    const rejections: ProductionSceneCommandRejection[] = [];
    /**
     * Refuse one command WITH a reason.
     *
     * Every refusal in this loop goes through here, so `ignoredCommandIds` and
     * `rejections` stay index-aligned and no command can ever be dropped
     * silently again.
     */
    const reject = (
      command: ProductionSceneCommand,
      reason: ProductionSceneCommandRejectionReason,
      detail: string,
    ): void => {
      ignored.push(command.commandId);
      rejections.push({
        commandId: command.commandId,
        commandKind: command.kind,
        subjectId: sceneCommandSubjectId(command),
        reason,
        detail,
      });
    };
    let duplicateCount = 0;
    for (const command of batch.commands) {
      if (command.kind !== "placement-hint" || command.context.kind !== "arrival") continue;
      const transition = pendingRegionTransitions.get(command.commandId);
      if (transition === undefined) continue;
      const entry = actors.get(command.agentId);
      if (hasAuthoritativeSpatialOwnership(entry)) continue;
      const currentPlacement = placement.snapshot().agents.get(command.agentId);
      const recipe = recipes.get(transition.toRegion);
      const directedGate = recipe?.gates.find((gate) => (
        gate.role === "arrival"
        && gate.edge.from === transition.fromRegion
        && gate.edge.to === transition.toRegion
      ));
      const gatePoint = directedGate === undefined ? null : tileCenter(directedGate.tile);
      const retained = retainedTravelers.get(command.agentId);
      const valid = entry !== undefined
        && entry.status === "alive"
        && !entry.actor.snapshot().terminal
        && transition.actorId === command.agentId
        && transition.sceneToken === batch.sceneToken
        && sameIdentity(transition.frameIdentity, batch.identity)
        && command.context.fromRegion === transition.fromRegion
        && command.arrivalGate !== undefined
        && gatePoint !== null
        && samePoint(command.arrivalGate, gatePoint)
        && samePoint(transition.position, gatePoint)
        && currentPlacement?.regionId === transition.toRegion
        && retained?.fromRegion === transition.fromRegion
        && retained.toRegion === transition.toRegion
        && samePoint(retained.arrivalGate, gatePoint);
      pendingRegionTransitions.delete(command.commandId);
      if (!valid || entry === undefined || directedGate === undefined || gatePoint === null) continue;
      if (!samePoint(entry.actor.snapshot().position, gatePoint)) {
        entry.actor.apply({
          kind: "reposition",
          position: gatePoint,
          reason: "region-transition",
        }, safeNow);
      }
      const actorPosition = entry.actor.snapshot().position;
      if (!samePoint(actorPosition, gatePoint)) continue;
      movingActorIds.delete(command.agentId);
      pendingMovementStartIds.delete(command.agentId);
      rebuildStructuralOrder();
      actorCommandBindings.set(command.agentId, {
        sceneToken: batch.sceneToken,
        commandId: command.commandId,
      });
      regionTransitions.push({
        actorId: command.agentId,
        reason: "region-transition",
        position: { ...gatePoint },
        actorPosition: { ...actorPosition },
        gate: {
          role: "arrival",
          tile: { ...directedGate.tile },
          tileSize: 32,
          point: { ...gatePoint },
        },
        fromRegion: transition.fromRegion,
        toRegion: transition.toRegion,
        sceneToken: batch.sceneToken,
        commandId: command.commandId,
        atMs: safeNow,
        frameIdentity: { ...batch.identity },
      });
      if (regionTransitions.length > 32) regionTransitions.splice(0, regionTransitions.length - 32);
      if (environment?.regionId === transition.toRegion && visibleActorIds.has(command.agentId)) {
        retainedTravelers.delete(command.agentId);
      } else {
        retainedTravelers.set(command.agentId, { ...retained, arrivalCommitted: true });
      }
    }
    for (const command of batch.commands) {
      if (seenSceneCommandIds.has(command.commandId)) {
        reject(command, "duplicate", "this command id was already applied in an earlier batch");
        duplicateCount += 1;
        continue;
      }
      seenSceneCommandIds.add(command.commandId);
      if (command.kind === "hit-stop") {
        for (const actorId of command.actorIds) {
          const entry = actors.get(actorId);
          if (!entry || entry.status === "dead" || entry.actor.snapshot().terminal) continue;
          actorHitStopUntilMs.set(actorId, Math.max(
            actorHitStopUntilMs.get(actorId) ?? Number.NEGATIVE_INFINITY,
            safeNow + command.durationMs,
          ));
        }
        applied.push(command.commandId);
        continue;
      }
      if (command.kind === "clear-scene") {
        for (const entry of actors.values()) {
          if (hasAuthoritativeSpatialOwnership(entry)) continue;
          entry.actor.cancelFallbackReposition();
          entry.actor.apply({ kind: "set-offset", offset: { x: 0, y: 0 } }, safeNow);
        }
        rebuildStructuralOrder();
        actorCommandBindings.clear();
        homeCommandBindings.clear();
        actorHitStopUntilMs.clear();
        fallbackRepositionActors.clear();
        remoteTransients.clear();
        disposeProvisionalHomes();
        applied.push(command.commandId);
        continue;
      }
      if (command.kind === "create-provisional-home") {
        if (homes.has(command.homeId) || environment?.regionId !== command.regionId) {
          reject(
            command,
            "invalid-provisional-home",
            homes.has(command.homeId)
              ? `home ${command.homeId} already exists`
              : `region ${command.regionId} is not the active environment`,
          );
          continue;
        }
        const recipe = recipes.get(command.regionId);
        const plot = recipe?.shelterPlots.find(({ id }) => id === command.plotId);
        const expectedPlot = plot ? tileCenter(plot.tile) : null;
        const expectedDoor = plot ? tileCenter(plot.door) : null;
        const plotOccupied = [...placement.snapshot().homes.values()]
          .some((candidate) => candidate.regionId === command.regionId && candidate.plotId === command.plotId);
        if (!recipe || !plot || recipe.kit !== command.kit || plotOccupied
          || !samePoint(command.plot, expectedPlot) || !samePoint(command.door, expectedDoor)) {
          reject(
            command,
            "invalid-provisional-home",
            `plot ${command.plotId} in ${command.regionId} is unknown, occupied, or its `
            + "plot/door/kit disagrees with the region recipe",
          );
          continue;
        }
        const presented: PresentedHomeInput = {
          record: {
            completeness: "projected-partial",
            value: { home_id: command.homeId, region: command.regionId },
          },
          exactBaseCursor: cursors.exactBase ?? 0,
          projectedThroughCursor: cursors.projectedThrough ?? cursors.exactBase ?? 0,
          exactRemnantMaterials: null,
          worldTime,
          plot: { ...command.plot },
          door: { ...command.door },
          kit: command.kit,
          provisional: true,
        };
        const prepared = preparedProvisionalHomes.get(command.commandId);
        preparedProvisionalHomes.delete(command.commandId);
        let entry: HomeEntry;
        if (prepared !== undefined) {
          entry = { ...prepared, provisionalSceneToken: batch.sceneToken };
        } else {
          const atlasLeases = acquireAtlasLeases(homeActorAtlasIds(manifest, command.kit));
          let actor: HomeActor | null = null;
          try {
            actor = factories.createHome({
              id: command.homeId,
              presented,
              manifest,
              atlasLeases,
            });
            recordCreated(ownership.homes);
          } catch (error) {
            if (actor === null) releaseAtlasLeases(atlasLeases);
            else disposeHome(actor);
            // The active-environment check above makes this rare, but a raise can
            // still land between an environment swap and the atlas pack backing
            // it. Refuse this one command and name the refusal; never throw,
            // because a throw here fails the whole frame commit rather than this
            // single home.
            reject(
              command,
              "invalid-provisional-home",
              noteDeferredHome(command.homeId, error),
            );
            continue;
          }
          entry = { actor, input: presented, kind: "home", provisionalSceneToken: batch.sceneToken };
        }
        homes.set(command.homeId, entry);
        homeCommandBindings.set(command.homeId, {
          sceneToken: batch.sceneToken,
          commandId: command.commandId,
        });
        rebuildStructuralOrder();
        applied.push(command.commandId);
        continue;
      }
      if (command.kind === "remote-transient") {
        remoteTransients.set(command.commandId, deepFreeze({
          commandId: command.commandId,
          sceneToken: batch.sceneToken,
          motif: command.motif,
          sourceId: command.sourceId,
          targetId: command.targetId,
          at: command.at === null ? null : { ...command.at },
        }));
        applied.push(command.commandId);
        continue;
      }
      if (command.kind === "retain-traveler") {
        const staged = retainedTravelers.get(command.actorId);
        if (staged !== undefined
          && staged.sceneToken === batch.sceneToken
          && staged.runId === batch.identity.runId
          && staged.sourceKey === batch.identity.sourceKey
          && staged.fromRegion === command.fromRegion
          && staged.toRegion === command.toRegion) {
          applied.push(command.commandId);
          continue;
        }
        const current = placement.snapshot().agents.get(command.actorId);
        const entry = actors.get(command.actorId);
        if (hasAuthoritativeSpatialOwnership(entry)) {
          reject(
            command,
            "authoritative-spatial-motion",
            `${command.actorId}'s backend-owned Nirvana route cannot enter a legacy region-transition lane`,
          );
          continue;
        }
        const knownRegion = entry?.known.position;
        const destination = recipes.get(command.toRegion);
        const arrivalGate = destination?.gates.find((gate) =>
          gate.role === "arrival"
          && gate.edge.from === command.fromRegion
          && gate.edge.to === command.toRegion);
        if (entry === undefined || entry.status !== "alive" || entry.actor.snapshot().terminal
          || current?.regionId !== command.fromRegion
          || knownRegion !== command.fromRegion || arrivalGate === undefined) {
          reject(
            command,
            "traveler-not-retainable",
            `${command.actorId} is not a live ${command.fromRegion} resident with an authorized `
            + `arrival gate into ${command.toRegion}`,
          );
          continue;
        }
        retainedTravelers.set(command.actorId, {
          sceneToken: batch.sceneToken,
          runId: batch.identity.runId,
          sourceKey: batch.identity.sourceKey,
          fromRegion: command.fromRegion,
          toRegion: command.toRegion,
          arrivalGate: tileCenter(arrivalGate.tile),
          arrivalCommitted: false,
        });
        applied.push(command.commandId);
        continue;
      }
      if (command.kind === "presence-fade") {
        const entry = actors.get(command.actorId);
        if (entry === undefined || entry.status !== "alive" || entry.actor.snapshot().terminal) {
          reject(
            command,
            entry === undefined ? "unknown-actor" : "terminal-actor",
            `${command.actorId} is not a live non-terminal actor`,
          );
          continue;
        }
        if (hasAuthoritativeSpatialOwnership(entry)) {
          reject(
            command,
            "authoritative-spatial-motion",
            `${command.actorId}'s backend-owned body may not be hidden by choreography`,
          );
          continue;
        }
        if (command.mode === "vanish") entry.actor.beginPresenceVanish();
        else entry.actor.beginPresenceReveal();
        applied.push(command.commandId);
        continue;
      }
      if (command.kind === "stage-arrival") {
        if (hasAuthoritativeSpatialOwnership(actors.get(command.actorId))) {
          reject(
            command,
            "authoritative-spatial-motion",
            `${command.actorId}'s backend-owned feet do not accept arrival staging`,
          );
        } else if (consumedArrivalStagingIds.has(command.commandId)) applied.push(command.commandId);
        else {
          reject(
            command,
            "unconsumed-out-of-band",
            "no destination arrival was authorized for this staging command in this frame",
          );
        }
        continue;
      }
      if (command.kind === "placement-hint") {
        if (hasAuthoritativeSpatialOwnership(actors.get(command.agentId))) {
          reject(
            command,
            "authoritative-spatial-motion",
            `${command.agentId}'s backend-owned feet do not accept placement hints`,
          );
        } else if (consumedPlacementHintIds.has(command.commandId)) applied.push(command.commandId);
        else {
          reject(
            command,
            "unconsumed-out-of-band",
            "this placement hint was not consumed by the frame's placement pass",
          );
        }
        continue;
      }
      if (command.kind === "camera-impulse") {
        reject(command, "no-environment", "camera impulses are owned by the camera, not the scene graph");
        continue;
      }
      if (command.kind === "actor") {
        const entry = actors.get(command.actorId);
        if (!entry || entry.actor.snapshot().terminal || entry.status === "dead") {
          reject(
            command,
            entry === undefined ? "unknown-actor" : "terminal-actor",
            `${command.actorId} is dead or terminal`,
          );
          continue;
        }
        if (hasAuthoritativeSpatialOwnership(entry) && isSpatialRelocationCommand(command.command)) {
          reject(
            command,
            "authoritative-spatial-motion",
            `${command.actorId}'s backend-owned feet may not be changed by ${command.command.kind}`,
          );
          continue;
        }
        if (entry.status === "paralyzed"
          && (command.command.kind === "move"
            || command.command.kind === "orient"
            || command.command.kind === "play-body")) {
          reject(
            command,
            "paralyzed",
            `${command.actorId} is paralyzed and may not ${command.command.kind}`,
          );
          continue;
        }
        if (command.command.kind === "reposition"
          && command.command.reason === "region-transition") {
          reject(
            command,
            "reserved-reposition-reason",
            "region-transition repositions are applied by the arrival pass, not by command",
          );
          continue;
        }
        /**
         * OBJECT exclusions only -- home footprints and tall scenic landmarks.
         * These are things a body would visibly overlap, so the whole rendered
         * standing envelope is the right instrument for them.
         *
         * GROUND terrain is deliberately NOT in this list: see the
         * destination-tile check below and `navigation/groundTerrain.ts`.
         */
        const interactionExclusions = [
          ...(environment?.landmarkInteractionExclusions ?? []),
          ...homeRouteExclusions,
        ];
        const actorPosition = entry.actor.snapshot().position;
        if ((command.command.kind === "move" && !presentationRouteIsClear(
          actorPosition,
          command.command.waypoints,
          interactionExclusions,
        )) || (command.command.kind === "reposition" && !presentationPointIsClear(
          command.command.position,
          interactionExclusions,
        ))) {
          reject(
            command,
            "object-exclusion",
            `${command.actorId}'s standing envelope would overlap a home footprint or a tall `
            + `scenic landmark (${interactionExclusions.length} exclusion rects active)`,
          );
          continue;
        }
        /**
         * GROUND terrain, judged on the DESTINATION TILE's collision.
         *
         * The one and only question terrain may ask is "may this body put its
         * feet in that tile" -- never "does this body's rendered envelope
         * overlap that ground", which would forbid every tile with blocked
         * ground to its north (the sprite hangs 46px above its feet) and would
         * make an east-west bridge impassable while leaving a north-south one
         * alone. Both failures were measured on the river-valley pilot; see
         * `navigation/groundTerrain.ts` for the evidence and the seam.
         */
        const groundGrid = environment === null ? null : environment.recipe.grid;
        if (groundGrid !== null) {
          const blockedTile = command.command.kind === "move"
            ? firstBlockedGroundTile(groundGrid, command.command.waypoints)
            : command.command.kind === "reposition"
                && !groundTerrainPointIsOpen(groundGrid, command.command.position)
              ? groundTerrainTileForPoint(command.command.position)
              : null;
          if (blockedTile !== null) {
            reject(
              command,
              "blocked-ground",
              `${command.actorId} cannot stand on blocked ground at tile `
              + `(${blockedTile.column}, ${blockedTile.row}) in ${environment!.regionId}`,
            );
            continue;
          }
        }
        if (command.command.kind === "reposition" && command.command.reason === "fallback") {
          const current = actorPosition;
          const endpointDiffers = !samePoint(command.command.position, current);
          const recipe = environment === null ? null : recipes.get(environment.regionId) ?? null;
          const verifiedEndpoint = recipe !== null && verifyFallbackEndpoint(
            recipe,
            current,
            command.command.position,
          );
          const decision = decidePathFallback({
            failure: "unreachable-target",
            nearestReachable: verifiedEndpoint,
            authoritativeEndpointDiffers: endpointDiffers,
            subjectId: command.actorId,
            regionId: environment?.regionId ?? null,
            occurrence: 1,
          });
          if (decision.action !== "continue" || decision.fallback !== "nearest-path"
            || !endpointDiffers || fallbackRepositionActors.has(command.actorId)) {
            reject(
              command,
              "fallback-not-authorized",
              !endpointDiffers
                ? `${command.actorId} is already standing at the fallback endpoint`
                : fallbackRepositionActors.has(command.actorId)
                  ? `${command.actorId} already took a fallback reposition this scene`
                  : `failure policy refused the fallback (action ${decision.action})`,
            );
            continue;
          }
          fallbackRepositionActors.add(command.actorId);
          pathFallbacks = Math.min(Number.MAX_SAFE_INTEGER, pathFallbacks + 1);
        }
        const movementWasActive = entry.actor.snapshot().routeActive;
        entry.actor.apply(command.command, safeNow);
        // Spatial-truth freshness for the conversational staging lane
        // (`presentation/conversationStaging.ts`). A completed WALK settles the
        // ledger's anchor below, on its `arrived` signal; a flash step has no
        // walk to arrive from, so without this the addressee's anchor would stay
        // at the point it was spoken to from and every later beat would plan its
        // route from a place the being is not. Only this one reason syncs here:
        // the others are concessions applied mid-scene, whose own beat already
        // owns where the being ends up.
        if (command.command.kind === "reposition"
          && command.command.reason === "conversation-flash") {
          syncArrivalPoint(placement, command.actorId, command.command.position);
        }
        synchronizeActorMovement(
          command.actorId,
          movementWasActive,
          entry.actor.snapshot().routeActive,
        );
        if (command.command.kind === "reposition" || command.command.kind === "set-offset") {
          rebuildStructuralOrder();
        }
        actorCommandBindings.set(command.actorId, {
          sceneToken: batch.sceneToken,
          commandId: command.commandId,
        });
        applied.push(command.commandId);
        continue;
      }
      if (command.kind === "home") {
        const entry = homes.get(command.homeId);
        const evidenceCursor = cursors.projectedThrough;
        if (!entry || evidenceCursor === null
          || (entry.kind === "ruin" && command.command.kind !== "scavenge")) {
          reject(
            command,
            entry === undefined
              ? "unknown-home"
              : evidenceCursor === null ? "missing-evidence-cursor" : "ruin-command",
            entry === undefined
              ? `home ${command.homeId} is not in the scene`
              : evidenceCursor === null
                ? "no projected evidence cursor is available yet"
                : `home ${command.homeId} is a ruin and may only be scavenged`,
          );
          continue;
        }
        entry.actor.apply(command.command, safeNow, evidenceCursor);
        homeCommandBindings.set(command.homeId, {
          sceneToken: batch.sceneToken,
          commandId: command.commandId,
        });
        applied.push(command.commandId);
        continue;
      }
      if (environment === null) {
        reject(command, "no-environment", "no region environment is mounted to receive the effect");
        continue;
      }
      environment.system.emit(command.request, safeNow);
      applied.push(command.commandId);
    }
    return sceneCommandResult(
      applied.length > 0
        ? "applied"
        : batch.commands.length > 0 && duplicateCount === batch.commands.length
          ? "duplicate"
          : "ignored",
      applied,
      ignored,
      rejections,
    );
  }

function verifyFallbackEndpoint(
  recipe: RegionMapRecipeV1,
  current: Vec2,
  endpoint: Vec2,
): boolean {
  const tile = pointTile(endpoint);
  const exactStagingPoint = recipe.stagingPoints.some((point) => samePoint(point, endpoint));
  if ((!samePoint(tileCenter(tile), endpoint) && !exactStagingPoint)
    || recipe.grid.collision[navigationTileIndex(recipe.grid, tile)] !== 0) return false;
  const authored = new Set([
    ...recipe.gates.map(({ tile: value }) => tileKey(value)),
    ...recipe.arrivalAnchors.map(tileKey),
    ...recipe.spawnAnchors.map(tileKey),
    ...recipe.socialAnchors.map(tileKey),
    ...recipe.resourceAnchors.energy.map(tileKey),
    ...recipe.resourceAnchors.materials.map(tileKey),
    ...recipe.stagingAnchors.map(tileKey),
    ...recipe.shelterPlots.flatMap(({ tile: value, door }) => [tileKey(value), tileKey(door)]),
  ]);
  if (!authored.has(tileKey(tile))) return false;
  const route = findNavigationPath(recipe.grid, { start: pointTile(current), goal: tile });
  return route.status === "reached" && (
    exactStagingPoint || samePoint(route.waypoints.at(-1) ?? current, endpoint)
  );
}

function pointTile(point: Vec2): Readonly<{ column: number; row: number }> {
  return { column: Math.floor(point.x / 32), row: Math.floor(point.y / 32) };
}

function tileKey(tile: Readonly<{ column: number; row: number }>): string {
  return `${tile.column},${tile.row}`;
}

  function sceneSignals(afterSerial = 0): readonly ProductionSceneSignal[] {
    if (!Number.isSafeInteger(afterSerial) || afterSerial < 0) {
      throw new RangeError("Scene signal serial must be a non-negative safe integer.");
    }
    return deepFreeze(sceneSignalHistory
      .filter(({ serial }) => serial > afterSerial)
      .map((signal) => ({ ...signal })));
  }

  /** Render-only elevation; navigation, animation routes and semantic feet stay on the ground plane. */
  function visualFeet(point: Vec2): Vec2 {
    return projectBridgeFeet(environment === null ? null : bridgeDepthScene(environment.recipe), point);
  }

  function drawBeing(context: CanvasRenderingContext2D, entry: OrderedActorEntry): void {
    const projected = visualFeet(entry.position);
    const offset = projected.y - entry.position.y;
    if (offset === 0) { entry.actor.draw(context); return; }
    context.save();
    context.translate(0, offset);
    // Contact shadow belongs on the deck beneath the raised feet, not down in the water.
    context.save();
    context.globalAlpha *= entry.actor.snapshot().opacity ?? 1;
    context.fillStyle = "rgba(18,26,23,0.24)";
    context.beginPath();
    context.ellipse(entry.position.x + 2, entry.position.y + 1, 8, 3, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();
    entry.actor.draw(context);
    context.restore();
  }

  /** Beings only — the periodic seam copy; see `ProductionSceneGraph.drawSeamActors`. */
  function drawSeamActors(context: CanvasRenderingContext2D): void {
    if (disposed) return;
    for (const entry of orderedActors) {
      // Nirvana routes are bounded absolute coordinates. A toroidal seam copy
      // would manufacture a second body at a location the backend never gave.
      if (hasAuthoritativeSpatialOwnership(actors.get(entry.id))) continue;
      drawBeing(context, entry);
    }
  }

  function draw(context: CanvasRenderingContext2D, view?: OverlayViewport, pass?: Readonly<{ continueFrame?: boolean }>): void {
    if (disposed) return;
    if (pass?.continueFrame !== true) depthMotionVisible = false;
    if (view?.regionContentVisible === false) return;
    environment?.system.draw(context, "ground", view);
    const depth = environment?.depth;
    const bridge = environment === null || view?.depthSceneryVisible === false
      ? null : bridgeDepthScene(environment.recipe);
    const visibleBounds = view?.width !== undefined && view.height !== undefined && view.zoom > 0
      ? { x: -view.originX / view.zoom, y: -view.originY / view.zoom, width: view.width / view.zoom, height: view.height / view.zoom }
      : undefined;
    if (depth != null && view?.depthSceneryVisible !== false) {
      drawDepthSceneryShadows(context, depth.props, visibleBounds);
    }
    if (bridge !== null) drawBridgeBase(context, bridge, visibleBounds);
    for (const entry of orderedHomes) entry.actor.draw(context, "back");
    if (depth == null && bridge === null) {
      for (const entry of orderedActors) drawBeing(context, entry);
      for (const entry of orderedHomes) entry.actor.draw(context, "front");
    } else {
      // Merge logical-depth streams; height changes projection, never front/back ordering.
      const props = depth?.props ?? [];
      const rails = bridge === null ? [] : bridgeRailSlices(bridge);
      let railIndex = 0;
      let actorIndex = 0;
      // Callers can separately omit props when a cache already owns their representation.
      let propIndex = view?.depthSceneryVisible === false ? props.length : 0;
      let homeIndex = 0;
      while (actorIndex < orderedActors.length || propIndex < props.length || homeIndex < orderedHomes.length || railIndex < rails.length) {
        const being = orderedActors[actorIndex];
        const prop = props[propIndex];
        const home = orderedHomes[homeIndex];
        const beingY = being?.position.y ?? Infinity;
        const propY = prop?.feet.y ?? Infinity;
        const homeY = home?.door.y ?? Infinity;
        const rail = rails[railIndex];
        const railY = rail?.feetY ?? Infinity;
        if (bridge !== null && rail !== undefined && railY <= beingY && railY <= propY && railY <= homeY) {
          drawBridgeRail(context, bridge, rail.feetY, visibleBounds);
          railIndex += 1;
        } else if (depth != null && prop !== undefined && propY <= beingY && propY <= homeY) {
          if (!reducedMotion && (prop.kind === "oak" || prop.kind === "willow")
            && depthSceneryInView(prop, visibleBounds)) depthMotionVisible = true;
          drawDepthSceneryProp(context, depth.source, prop, orderedBeingFeet, visibleBounds,
            reducedMotion ? undefined : lastNowMs);
          propIndex += 1;
        } else if (home !== undefined && homeY <= beingY) {
          home.actor.draw(context, "front");
          homeIndex += 1;
        } else if (being !== undefined) {
          drawBeing(context, being);
          actorIndex += 1;
        }
      }
    }
    // The legibility overlay is the last thing in the air pass and the only
    // screen-space drawing in this renderer: it needs the caller's own
    // bounds-clamped raster origin, not the camera's unclamped one, so the view
    // is threaded down rather than read back from the canvas transform.
    environment?.system.draw(context, "air", view);
    drawRemoteTransients(context, remoteTransients.values(), environment?.recipe ?? null);
  }

  function nextDeadlineMs(): number | null {
    if (disposed) return null;
    let deadline: number | null = null;
    if (!reducedMotion && depthMotionVisible) {
      deadline = (Math.floor(lastNowMs / DEPTH_SCENERY_FRAME_INTERVAL_MS) + 1) * DEPTH_SCENERY_FRAME_INTERVAL_MS;
    }
    if (!reducedMotion) {
      for (const actorId of movingActorIds) {
        if (!isActorTimeActive(actorId)) continue;
        deadline = minimumFuture(deadline, lastNowMs + MOVEMENT_FRAME_INTERVAL_MS, lastNowMs);
        break;
      }
    }
    for (const [id, entry] of actors) {
      if (!isActorTimeActive(id)) continue;
      deadline = minimumFuture(deadline, entry.actor.nextDeadlineMs(), lastNowMs);
    }
    for (const entry of homes.values()) {
      deadline = minimumFuture(deadline, entry.actor.nextDeadlineMs(), lastNowMs);
    }
    return minimumFuture(deadline, environment?.system.nextDeadlineMs() ?? null, lastNowMs);
  }

  function hitTargets(): readonly ProductionSceneHitTarget[] {
    if (disposed) return Object.freeze([]);
    const targets: ProductionSceneHitTarget[] = [];
    for (const [id, entry] of actors) {
      if (!visibleActorIds.has(id)) continue;
      const snapshot = entry.actor.snapshot();
      if ((snapshot.opacity ?? 1) <= 0) continue;
      targets.push({
        selection: { kind: "agent", id },
        worldBounds: feetAnchoredVisualRect(visualFeet(snapshot.position)),
        feetY: snapshot.position.y,
        selectionKey: entityKey("agent", id),
      });
    }
    for (const [id, entry] of homes) {
      const snapshot = entry.actor.snapshot();
      const logical = manifest.regions[snapshot.kit]?.homeManifest.logicalBounds
        ?? { width: 64, height: 64 };
      targets.push({
        selection: { kind: entry.kind, id },
        worldBounds: {
          x: snapshot.plot.x,
          y: snapshot.plot.y,
          width: logical.width,
          height: logical.height,
        },
        feetY: snapshot.door.y,
        selectionKey: entityKey(entry.kind, id),
      });
    }
    if (environment !== null) {
      const grid = environment.recipe.grid;
      targets.push({
        selection: { kind: "region", id: environment.regionId },
        worldBounds: { x: 0, y: 0, width: grid.columns * 32, height: grid.rows * 32 },
        feetY: grid.rows * 32,
        selectionKey: entityKey("region", environment.regionId),
      });
    }
    targets.sort((left, right) => compareText(left.selectionKey, right.selectionKey));
    return deepFreeze(targets.map((target) => ({
      ...target,
      selection: { ...target.selection },
      worldBounds: { ...target.worldBounds },
    })));
  }

  function semanticSnapshot(): RendererSemanticSnapshot {
    if (disposed || identity === null) {
      throw new Error("Semantic truth is unavailable before an accepted scene frame.");
    }
    const subjects: RendererSemanticSubject[] = [];
    if (environment !== null) {
      subjects.push({
        selection: { kind: "region", id: environment.regionId },
        stableSelectionKey: entityKey("region", environment.regionId),
        kind: "region",
        regionId: environment.regionId,
        position: null,
        status: semanticRegionStatus,
        action: semanticRegionAction,
      });
    }
    for (const [id, entry] of actors) {
      if (!visibleActorIds.has(id)) continue;
      const snapshot = entry.actor.snapshot();
      subjects.push({
        selection: { kind: "agent", id },
        stableSelectionKey: entityKey("agent", id),
        kind: "agent",
        regionId: environment?.regionId ?? "",
        position: { ...snapshot.position },
        status: entry.status,
        action: snapshot.activeAction,
      });
    }
    for (const [id, entry] of homes) {
      const snapshot = entry.actor.snapshot();
      subjects.push({
        selection: { kind: entry.kind, id },
        stableSelectionKey: entityKey(entry.kind, id),
        kind: entry.kind,
        regionId: entry.input.record.value.region ?? environment?.regionId ?? "",
        position: { ...snapshot.plot },
        status: snapshot.durable.status,
        action: snapshot.transient.activeKind,
      });
    }
    return createRendererSemanticSnapshot(identity, subjects);
  }

  function focusTarget(
    selection: Exclude<ObserverSelection, null>,
  ): ProductionSceneHitTarget | null {
    if (selection.kind === "agent") {
      const entry = actors.get(selection.id);
      if (entry === undefined || !visibleActorIds.has(selection.id)) return null;
      const snapshot = entry.actor.snapshot();
      return deepFreeze({
        selection: { kind: "agent", id: selection.id },
        worldBounds: feetAnchoredVisualRect(visualFeet(snapshot.position)),
        feetY: snapshot.position.y,
        selectionKey: entityKey("agent", selection.id),
      });
    }
    if (selection.kind === "home" || selection.kind === "ruin") {
      const entry = homes.get(selection.id);
      if (entry === undefined || entry.kind !== selection.kind) return null;
      const snapshot = entry.actor.snapshot();
      const logical = manifest.regions[snapshot.kit]?.homeManifest.logicalBounds
        ?? { width: 64, height: 64 };
      return deepFreeze({
        selection: { kind: selection.kind, id: selection.id },
        worldBounds: {
          x: snapshot.plot.x,
          y: snapshot.plot.y,
          width: logical.width,
          height: logical.height,
        },
        feetY: snapshot.door.y,
        selectionKey: entityKey(selection.kind, selection.id),
      });
    }
    if (selection.kind === "region" && environment?.regionId === selection.id) {
      const grid = environment.recipe.grid;
      return deepFreeze({
        selection: { kind: "region", id: selection.id },
        worldBounds: { x: 0, y: 0, width: grid.columns * 32, height: grid.rows * 32 },
        feetY: grid.rows * 32,
        selectionKey: entityKey("region", selection.id),
      });
    }
    return null;
  }

  function debugSnapshot(): ProductionSceneGraphDebugSnapshot {
    const selectedPlacement = placement.snapshot();
    const placementDiagnostic: ProductionPlacementDebugSnapshot = {
      revision: selectedPlacement.revision,
      agents: [...selectedPlacement.agents]
        .sort(([left], [right]) => compareText(left, right))
        .map(([id, value]) => ({
          id,
          regionId: value.regionId,
          point: { ...value.point },
          anchorKind: value.anchorKind,
        })),
      homes: [...selectedPlacement.homes]
        .sort(([left], [right]) => compareText(left, right))
        .map(([id, value]) => ({
          id,
          regionId: value.regionId,
          plotId: value.plotId,
          door: { ...value.door },
        })),
      shelterCapacity: [...recipes.keys()]
        .sort(compareText)
        .map((regionId) => placement.shelterCapacityFor(regionId))
        .filter((capacity): capacity is ShelterCapacitySnapshot => capacity !== null),
      unplacedHomes: [...placement.unplacedHomeDiagnostics().values()]
        .sort((left, right) => compareText(left.homeId, right.homeId))
        .map((record) => ({ ...record })),
    };
    const actorSnapshots = [...actors.entries()]
      .filter(([id]) => visibleActorIds.has(id))
      .sort(([left], [right]) => compareText(left, right))
      .map(([id, entry]) => {
        const snapshot = entry.actor.snapshot();
        return {
          id,
          instanceId: snapshot.instanceId,
          position: { ...snapshot.position },
          facing: snapshot.facing,
          activeAction: snapshot.activeAction,
          opacity: snapshot.opacity ?? 1,
          reposition: snapshot.reposition === undefined || snapshot.reposition === null
            ? null
            : {
                phase: snapshot.reposition.phase,
                reason: snapshot.reposition.reason,
                target: { ...snapshot.reposition.target },
              },
          worldBounds: {
            ...feetAnchoredVisualRect(snapshot.position),
          },
          status: entry.status,
          terminal: snapshot.terminal,
          selected: entry.selected,
        };
      });
    const homeSnapshots = [...homes.entries()]
      .sort(([left], [right]) => compareText(left, right))
      .map(([id, entry]) => {
        const snapshot = entry.actor.snapshot();
        return {
          id,
          instanceId: snapshot.instanceId,
          kind: entry.kind,
          status: snapshot.durable.status,
          plot: { ...snapshot.plot },
          door: { ...snapshot.door },
          kit: snapshot.kit,
          remnantMaterials: snapshot.durable.remnantMaterials,
          provisional: entry.provisionalSceneToken !== null,
          durable: {
            ...snapshot.durable,
            stakeholderIds: snapshot.durable.stakeholderIds === null
              ? null
              : [...snapshot.durable.stakeholderIds],
            breacherIds: snapshot.durable.breacherIds === null
              ? null
              : [...snapshot.durable.breacherIds],
          },
          diagnostics: { ...snapshot.diagnostics },
          geometry: {
            logicalBounds: { ...snapshot.geometry.logicalBounds },
            doorClearance: { ...snapshot.geometry.doorClearance },
          },
          visual: {
            backComponents: [...snapshot.visual.backComponents],
            frontComponents: [...snapshot.visual.frontComponents],
            ruinFrameId: snapshot.visual.ruinFrameId,
          },
        };
      });
    const environmentSnapshots = environment === null ? [] : [{
      regionId: environment.regionId,
      diagnostics: environment.system.diagnostics(),
    }];
    const snapshot: ProductionSceneGraphDebugSnapshot = {
      disposed,
      generation,
      spatialBinding,
      placement: placementDiagnostic,
      identity: identity === null ? null : { ...identity },
      cursors: { ...cursors },
      activeRegion: environment === null ? null : {
        id: environment.regionId,
        recipeIdentityHash: environment.recipe.identityHash,
        staticCacheRebuilds,
        condition: { ...environment.condition },
      },
      actors: actorSnapshots,
      homes: homeSnapshots,
      environments: environmentSnapshots,
      transients: [...remoteTransients.values()]
        .sort((left, right) => compareText(left.commandId, right.commandId))
        .map((transient) => ({
          ...transient,
          at: transient.at === null ? null : { ...transient.at },
        })),
      rejections: { ...rejections },
    lastDeferredHomeReason,
      recentMarkers: recentMarkers.map((marker) => ({ ...marker })),
      regionTransitions: regionTransitions.map((transition) => ({
        ...transition,
        position: { ...transition.position },
        actorPosition: { ...transition.actorPosition },
        gate: {
          ...transition.gate,
          tile: { ...transition.gate.tile },
          point: { ...transition.gate.point },
        },
        frameIdentity: { ...transition.frameIdentity },
      })),
      nextDeadlineMs: nextDeadlineMs(),
      pathFallbacks,
      ownership: {
        actors: snapshotOwnership(ownership.actors),
        homes: snapshotOwnership(ownership.homes),
        environments: snapshotOwnership(ownership.environments),
      },
    };
    return deepFreeze(snapshot);
  }

  function dispose(): void {
    if (disposed) return;
    disposed = true;
    for (const entry of actors.values()) disposeActor(entry.actor);
    for (const entry of homes.values()) disposeHome(entry.actor);
    if (environment !== null) disposeEnvironment(environment.system);
    actors.clear();
    visibleActorIds.clear();
    homes.clear();
    orderedActors = [];
    orderedBeingFeet = [];
    orderedHomes = [];
    environment = null;
    depthMotionVisible = false;
    recentMarkers.length = 0;
    regionTransitions.length = 0;
    sceneSignalHistory.length = 0;
    actorCommandBindings.clear();
    homeCommandBindings.clear();
    seenSceneCommandIds.clear();
    actorHitStopUntilMs.clear();
    movingActorIds.clear();
    pendingMovementStartIds.clear();
    fallbackRepositionActors.clear();
    retainedTravelers.clear();
    pendingRegionTransitions.clear();
    pendingArrivalStaging = null;
    remoteTransients.clear();
    consumedPlacementHintIds.clear();
    consumedArrivalStagingIds.clear();
    disposePreparedProvisionalHomes();
  }

  function recordActorSignals(signals: readonly ProductionActorSignal[], actorId: string, atMs: number): void {
    for (const signal of signals) {
      const marker = signal.kind === "marker" ? signal.marker : signal.kind;
      appendMarker({
        kind: "actor",
        actorId,
        marker,
        atMs,
      });
      const binding = actorCommandBindings.get(actorId);
      if (binding) appendSceneSignal(binding, actorId, marker, atMs);
    }
  }

  function recordHomeSignals(signals: readonly ProductionHomeSignal[], homeId: string, atMs: number): void {
    for (const signal of signals) {
      appendMarker({ kind: "home", homeId, marker: signal.name, atMs: signal.atMs ?? atMs });
      const binding = homeCommandBindings.get(homeId);
      if (binding) appendSceneSignal(binding, homeId, signal.name, signal.atMs ?? atMs);
    }
  }

  function appendSceneSignal(
    binding: Readonly<{ sceneToken: number; commandId: string }>,
    subjectId: string | null,
    marker: string,
    atMs: number,
  ): void {
    sceneSignalHistory.push(deepFreeze({
      serial: nextSceneSignalSerial,
      sceneToken: binding.sceneToken,
      commandId: binding.commandId,
      subjectId,
      marker,
      atMs,
    }));
    nextSceneSignalSerial += 1;
    if (sceneSignalHistory.length > MAX_SCENE_SIGNALS) {
      sceneSignalHistory.splice(0, sceneSignalHistory.length - MAX_SCENE_SIGNALS);
    }
  }

  function appendMarker(marker: ProductionSceneGraphDebugSnapshot["recentMarkers"][number]): void {
    recentMarkers.push(marker);
    if (recentMarkers.length > MAX_MARKERS) recentMarkers.splice(0, recentMarkers.length - MAX_MARKERS);
  }

  function assertNotDisposed(): void {
    if (disposed) throw new Error("ProductionSceneGraph is disposed.");
  }

  /** Re-anchor only from the session's explicit playback sample, never `world.worldTime`. */
  function adoptSpatialPlayback(next: PresentedObserverFrame["spatialPlayback"]): void {
    if (next === undefined) {
      spatialPlayback = null;
      return;
    }
    spatialPlayback = {
      sampledAt: next.sampledAt,
      speed: next.speed,
      paused: next.paused,
      wallAnchorMs: lastNowMs,
    };
  }

  function sampledSpatialPlaybackAt(nowMs: number): number | null {
    const anchor = spatialPlayback;
    if (anchor === null) return null;
    if (anchor.paused) return anchor.sampledAt;
    return anchor.sampledAt + Math.max(0, nowMs - anchor.wallAnchorMs) * anchor.speed / 1_000;
  }

  function hasAuthoritativeSpatialMotion(entry: ActorEntry | undefined): boolean {
    return entry?.known.spatial !== undefined;
  }

  /** A gate handoff owns feet even while its departure has explicitly cleared `spatial`. */
  function hasAuthoritativeSpatialOwnership(entry: ActorEntry | undefined): boolean {
    return hasAuthoritativeSpatialMotion(entry) || entry?.known.spatial_migration !== undefined;
  }

  function authoritativeReanchorPoint(
    known: Readonly<Partial<AgentSnapshot>>,
    incoming: Readonly<Partial<AgentSnapshot>>,
  ): Vec2 | null {
    const migration = incoming.spatial_migration;
    if (migration !== undefined && !sameSpatialMigration(known.spatial_migration, migration)) {
      return migration.source_position;
    }
    const spatial = incoming.spatial;
    if (
      spatial !== undefined
      && (known.spatial === undefined
        || known.position !== incoming.position
        || known.spatial.region_id !== spatial.region_id
        || known.spatial.map_id !== spatial.map_id)
    ) return spatial;
    return null;
  }

  function isSpatialRelocationCommand(command: HumanPrimitiveCommand): boolean {
    return command.kind === "move" || command.kind === "reposition" || command.kind === "set-offset";
  }

  function isActorTimeActive(actorId: string): boolean {
    return visibleActorIds.has(actorId)
      || (movingActorIds.has(actorId) && retainedTravelers.has(actorId));
  }

  function synchronizeActorMovement(
    actorId: string,
    wasActive: boolean,
    isActive: boolean,
  ): void {
    if (!isActive) {
      movingActorIds.delete(actorId);
      pendingMovementStartIds.delete(actorId);
      return;
    }
    movingActorIds.add(actorId);
    if (!wasActive) pendingMovementStartIds.add(actorId);
  }

  function rebuildStructuralOrder(): void {
    const nextActors = [...actors.entries()].filter(([id]) => visibleActorIds.has(id)).map(([id, entry]) => {
      const position = entry.actor.snapshot().position;
      return { id, actor: entry.actor, position: { ...position } };
    });
    nextActors.sort((left, right) =>
      left.position.y - right.position.y || compareText(left.id, right.id));
    orderedActors = nextActors;
    orderedBeingFeet = nextActors.map(({ position }) => position);

    const nextHomes = [...homes.entries()].map(([id, entry]) => {
      const plot = entry.actor.snapshot().plot;
      return {
        id,
        actor: entry.actor,
        door: entry.input.door,
        plot: { ...plot },
      };
    });
    nextHomes.sort((left, right) => left.door.y - right.door.y || compareText(left.id, right.id));
    orderedHomes = nextHomes;
    refreshEnvironmentExclusions();
  }

  function refreshEnvironmentExclusions(): void {
    const actorZones = orderedActors.map((entry) => feetAnchoredVisualRect(visualFeet(entry.position)));
    const homeZones = orderedHomes.map(({ plot }) => ({
      x: plot.x,
      y: plot.y,
      width: SHELTER_RENDER_FOOTPRINT.width,
      height: SHELTER_RENDER_FOOTPRINT.height,
    }));
    environment?.system.setExclusionZones([
      ...(environment?.landmarkInteractionExclusions ?? []),
      ...actorZones,
      ...homeZones,
    ]);
    // The legibility overlay hangs chrome on beings and structures by id. A
    // speaker now physically approaches the being it addresses, so an anchor
    // frozen at emit time visibly detaches from the head it belongs to; publish
    // the same live positions this pass already has.
    environment?.system.setAnchorPositions(new Map([
      ...orderedActors.map(({ id, position }) => [id, visualFeet(position)] as const),
      ...orderedHomes.map(({ id, door }) => [id, door] as const),
    ]));
    homeRouteExclusions = homeRouteExclusionRects(orderedHomes);
  }

  function refreshMovingActorOrder(movers: ReadonlySet<string>): void {
    if (movers.size === 0) return;
    let changed = false;
    const nextActors = orderedActors.map((entry) => {
      if (!movers.has(entry.id)) return entry;
      const position = entry.actor.snapshot().position;
      if (samePoint(position, entry.position)) return entry;
      changed = true;
      return { ...entry, position: { ...position } };
    });
    if (!changed) return;
    if (nextActors.length >= 2) {
      nextActors.sort((left, right) =>
        left.position.y - right.position.y || compareText(left.id, right.id));
    }
    orderedActors = nextActors;
    orderedBeingFeet = nextActors.map(({ position }) => position);
  }

  function disposeProvisionalHomes(): void {
    let changed = false;
    for (const [id, entry] of [...homes]) {
      if (entry.provisionalSceneToken === null) continue;
      disposeHome(entry.actor);
      homes.delete(id);
      homeCommandBindings.delete(id);
      changed = true;
    }
    if (changed) rebuildStructuralOrder();
  }

  function disposePreparedProvisionalHomes(): void {
    for (const entry of preparedProvisionalHomes.values()) disposeHome(entry.actor);
    preparedProvisionalHomes.clear();
  }

  function applyFrame(
    frame: PresentedObserverFrame,
    batch: ProductionSceneCommandBatch | null,
    nowMs: number,
    observerViewRegionId: string | null = null,
    deferArrivalStaging = false,
  ): ProductionSceneFrameResult {
    assertNotDisposed();
    if (!Number.isFinite(nowMs) || nowMs < 0
      || (batch !== null && (!sameIdentity(batch.identity, frame)
        || batch.sceneToken < activeSceneToken
        || !isValidProductionSceneCommandBatch(batch)))) {
      return deepFreeze({ outcome: "invalid", diff: null, commands: null });
    }
    disposePreparedProvisionalHomes();
    let retainedRollback: readonly RetainedTravelerRollback[] = [];
    let updateCommitted = false;
    try {
      if (batch !== null) prepareProvisionalHomeCommands(frame, batch);
      if (batch !== null) retainedRollback = stageRetainedTravelerCommands(frame, batch);
      const diff = update(frame, batch, observerViewRegionId, deferArrivalStaging);
      if (diff.outcome !== "applied") {
        rollbackStagedRetainedTravelers(retainedRollback);
        disposePreparedProvisionalHomes();
        return deepFreeze({ outcome: diff.outcome, diff, commands: null });
      }
      updateCommitted = true;
      let commands: ProductionSceneCommandResult | null = null;
      try {
        commands = batch === null ? null : applySceneCommands(batch, nowMs);
      } catch {
        disposePreparedProvisionalHomes();
        return deepFreeze({
          outcome: "accepted",
          diff,
          commands: batch === null ? null : sceneCommandResult(
            "ignored",
            [],
            batch.commands.map(({ commandId }) => commandId),
            batchRejections(
              batch.commands,
              "frame-rejected",
              "the frame this batch accompanied did not commit",
            ),
          ),
        });
      }
      disposePreparedProvisionalHomes();
      if (commands !== null && (commands.outcome === "invalid"
        || commands.outcome === "stale-identity" || commands.outcome === "stale-scene")) {
        commands = sceneCommandResult(
          "ignored",
          [],
          batch?.commands.map(({ commandId }) => commandId) ?? [],
          batchRejections(
            batch?.commands ?? [],
            "stale-batch",
            `the batch was refused as ${commands.outcome}`,
          ),
        );
      }
      return deepFreeze({ outcome: "accepted", diff, commands });
    } catch (error) {
      if (!updateCommitted) rollbackStagedRetainedTravelers(retainedRollback);
      disposePreparedProvisionalHomes();
      throw error;
    }
  }

  function commitArrivalStaging(frameIdentity: FrameIdentity): void {
    const pending = pendingArrivalStaging;
    if (pending === null || !sameIdentity(pending.identity, frameIdentity)) return;
    pendingArrivalStaging = null;
    for (const arrival of pending.arrivals) {
      const entry = actors.get(arrival.actorId);
      if (entry === undefined || entry.status !== "alive" || entry.actor.snapshot().terminal) continue;
      if (hasAuthoritativeSpatialOwnership(entry)) continue;
      entry.actor.stagePosition(arrival.gate);
    }
    rebuildStructuralOrder();
  }

  function discardArrivalStaging(frameIdentity: FrameIdentity): void {
    const pending = pendingArrivalStaging;
    if (pending === null || !sameIdentity(pending.identity, frameIdentity)) return;
    pendingArrivalStaging = null;
    for (const arrival of pending.arrivals) visibleActorIds.delete(arrival.actorId);
    rebuildStructuralOrder();
  }

  function stageRetainedTravelerCommands(
    frame: PresentedObserverFrame,
    batch: ProductionSceneCommandBatch,
  ): readonly RetainedTravelerRollback[] {
    const rollback: RetainedTravelerRollback[] = [];
    for (const command of batch.commands) {
      if (command.kind !== "retain-traveler") continue;
      const current = placement.snapshot().agents.get(command.actorId);
      const entry = actors.get(command.actorId);
      const presented = frame.world.agents.find(({ value }) => value.id === command.actorId);
      if (hasAuthoritativeSpatialOwnership(entry)
        || presented?.value.spatial !== undefined
        || presented?.value.spatial_migration !== undefined) continue;
      const presentedRegion = presented?.value.position;
      const destination = recipes.get(command.toRegion);
      const arrivalGate = destination?.gates.find((gate) => (
        gate.role === "arrival"
        && gate.edge.from === command.fromRegion
        && gate.edge.to === command.toRegion
      ));
      if ((entry !== undefined && (entry.status !== "alive" || entry.actor.snapshot().terminal))
        || presented === undefined || presented.value.status !== "alive"
        || presentedRegion !== command.fromRegion
        || current?.regionId !== command.fromRegion || arrivalGate === undefined) continue;
      rollback.push({ actorId: command.actorId, previous: retainedTravelers.get(command.actorId) });
      retainedTravelers.set(command.actorId, {
        sceneToken: batch.sceneToken,
        runId: batch.identity.runId,
        sourceKey: batch.identity.sourceKey,
        fromRegion: command.fromRegion,
        toRegion: command.toRegion,
        arrivalGate: tileCenter(arrivalGate.tile),
        arrivalCommitted: false,
      });
    }
    return rollback;
  }

  function rollbackStagedRetainedTravelers(
    rollback: readonly RetainedTravelerRollback[],
  ): void {
    for (const { actorId, previous } of [...rollback].reverse()) {
      if (previous === undefined) retainedTravelers.delete(actorId);
      else retainedTravelers.set(actorId, previous);
    }
  }

  function prepareProvisionalHomeCommands(
    frame: PresentedObserverFrame,
    batch: ProductionSceneCommandBatch,
  ): void {
    const durableIds = new Set([...frame.world.homes, ...frame.world.ruins]
      .map(({ value }) => value.home_id)
      .filter((id): id is string => typeof id === "string"));
    for (const command of batch.commands) {
      if (command.kind !== "create-provisional-home" || durableIds.has(command.homeId)
        || homes.has(command.homeId)) continue;
      const recipe = recipes.get(command.regionId);
      const plot = recipe?.shelterPlots.find(({ id }) => id === command.plotId);
      if (!recipe || !plot || recipe.kit !== command.kit
        || !samePoint(command.plot, tileCenter(plot.tile))
        || !samePoint(command.door, tileCenter(plot.door))) continue;
      const presented: PresentedHomeInput = {
        record: { completeness: "projected-partial", value: { home_id: command.homeId, region: command.regionId } },
        exactBaseCursor: frame.world.exactBaseCursor,
        projectedThroughCursor: frame.world.projectedThroughCursor,
        exactRemnantMaterials: null,
        worldTime: frame.world.worldTime,
        plot: { ...command.plot },
        door: { ...command.door },
        kit: command.kit,
        provisional: true,
      };
      const atlasLeases = acquireAtlasLeases(homeActorAtlasIds(manifest, command.kit));
      let actor: HomeActor | null = null;
      try {
        actor = factories.createHome({ id: command.homeId, presented, manifest, atlasLeases });
        recordCreated(ownership.homes);
      } catch (error) {
        if (actor === null) releaseAtlasLeases(atlasLeases);
        else disposeHome(actor);
        // This runs ahead of command application, so unlike the applied path it
        // has no active-environment check to lean on: it is handed raises for
        // regions whose atlas pack is not mounted. Rethrowing threw straight out
        // of `applyFrame`, which the renderer can only read as a whole-frame
        // commit failure -- and because the same command is re-offered on every
        // frame, the scene graph never advanced again. This was the observed live
        // wedge. Skip the preparation; the applied path builds the home once the
        // pack is mounted.
        noteDeferredHome(command.homeId, error);
        continue;
      }
      preparedProvisionalHomes.set(command.commandId, {
        actor,
        input: presented,
        kind: "home",
        provisionalSceneToken: batch.sceneToken,
      });
    }
  }

  return {
    update,
    applyFrame,
    commitArrivalStaging,
    discardArrivalStaging,
    applySceneCommands,
    sceneSignals,
    updateTime,
    draw,
    drawSeamActors,
    hitTargets,
    semanticSnapshot,
    focusTarget,
    nextDeadlineMs,
    overlayHoldUntilMs: () => (disposed ? null : environment?.system.overlayHoldUntilMs() ?? null),
    overlayFocusRect: () => (disposed ? null : environment?.system.overlayFocusRect() ?? null),
    debugSnapshot,
    dispose,
  };
}

/** Derive detached, deterministic world rectangles from authored landmark offsets. */
export function landmarkInteractionExclusionRects(
  recipe: RegionMapRecipeV1,
): readonly Rect[] {
  const byTile = new Map<string, Rect>();
  for (const landmark of recipe.scenicLandmarks) {
    for (const offset of landmark.interactionExclusionOffsets) {
      const column = landmark.contactTile.column + offset.x;
      const row = landmark.contactTile.row + offset.y;
      const key = `${column},${row}`;
      if (byTile.has(key)) continue;
      byTile.set(key, Object.freeze({
        x: column * TILE_SIZE,
        y: row * TILE_SIZE,
        width: TILE_SIZE,
        height: TILE_SIZE,
      }));
    }
  }
  return Object.freeze([...byTile.values()].sort((left, right) =>
    left.y - right.y || left.x - right.x));
}

export { presentationPointIsClear, presentationRouteIsClear } from "./productionGeometry";

export function isValidProductionSceneCommandBatch(batch: ProductionSceneCommandBatch): boolean {
  if (!isRecord(batch) || !Number.isSafeInteger(batch.sceneToken) || batch.sceneToken < 0
    || !Array.isArray(batch.commands)) {
    return false;
  }
  try {
    assertValidFrameIdentity(batch.identity);
  } catch {
    return false;
  }
  const ids = new Set<string>();
  for (const candidate of batch.commands as readonly unknown[]) {
    if (!isRecord(candidate)) return false;
    const command = candidate as ProductionSceneCommand;
    if (!validString(command.commandId)
      || ids.has(command.commandId)) return false;
    ids.add(command.commandId);
    if (!validSceneCommand(command)) return false;
  }
  return true;
}

function validSceneCommand(command: ProductionSceneCommand): boolean {
  switch (command.kind) {
    case "actor":
      return validString(command.actorId) && validHumanCommand(command.command);
    case "home":
      return validString(command.homeId) && validHomeCommand(command.command);
    case "create-provisional-home":
      return validString(command.homeId) && validString(command.regionId) && validString(command.plotId)
        && validIntegerPoint(command.plot) && validIntegerPoint(command.door)
        && Object.prototype.hasOwnProperty.call(PRODUCTION_ASSET_MANIFEST.regions, command.kit);
    case "environment":
      return validEnvironmentRequest(command.request);
    case "hit-stop":
      return finiteRange(command.durationMs, 60, 90) && Array.isArray(command.actorIds)
        && command.actorIds.length > 0 && command.actorIds.every(validString);
    case "camera-impulse":
      return finiteRange(command.durationMs, 60, 90) && validIntegerPoint(command.offset)
        && Math.abs(command.offset.x) + Math.abs(command.offset.y) === 1;
    case "remote-transient":
      return ["portrait", "atlas", "vignette"].includes(command.motif)
        && validNullableString(command.sourceId) && validNullableString(command.targetId)
        && (command.at === null || validIntegerPoint(command.at));
    case "placement-hint":
      return validString(command.agentId) && validPlacementContext(command.context)
        && (command.arrivalGate === undefined || validIntegerPoint(command.arrivalGate))
        && (command.requestedFinal === undefined || validIntegerPoint(command.requestedFinal));
    case "retain-traveler":
      return validString(command.actorId) && validString(command.fromRegion)
        && validString(command.toRegion) && command.fromRegion !== command.toRegion;
    case "presence-fade":
      return validString(command.actorId) && (command.mode === "vanish" || command.mode === "reveal");
    case "stage-arrival":
      return validString(command.actorId) && validString(command.fromRegion)
        && validString(command.toRegion) && command.fromRegion !== command.toRegion
        && command.eventType === "agent_entered_region" && command.phase === "hold"
        && validString(command.momentId) && validString(command.programId);
    case "clear-scene":
      return true;
    default:
      return invalidNever(command);
  }
}

function validHumanCommand(candidate: HumanPrimitiveCommand): boolean {
  if (!isRecord(candidate)) return false;
  const command = candidate as HumanPrimitiveCommand;
  switch (command.kind) {
    case "move":
      return Array.isArray(command.waypoints) && command.waypoints.length > 0
        && command.waypoints.every(validFinitePoint)
        && typeof command.speedPixelsPerSecond === "number" && Number.isFinite(command.speedPixelsPerSecond)
        && command.speedPixelsPerSecond > 0 && (command.gait === "walk" || command.gait === "run");
    case "orient":
      return PRODUCTION_FACINGS.includes(command.facing as (typeof PRODUCTION_FACINGS)[number]);
    case "play-body":
      return ["reach-give", "work", "hurt-fall", "prone", "dead", "kneel", "gather"].includes(command.action);
    case "set-face":
      return HUMAN_EXPRESSIONS.includes(command.expression as (typeof HUMAN_EXPRESSIONS)[number]);
    case "set-held":
      return command.heldId === null || validString(command.heldId);
    case "set-status":
      return command.status === "alive" || command.status === "paralyzed" || command.status === "dead";
    case "recover":
    case "clear-body":
      return true;
    case "reposition":
      return validFinitePoint(command.position)
        && ["reduced-motion", "fallback", "region-transition", "distance-cut", "conversation-flash"]
          .includes(command.reason);
    case "set-offset":
      return validFinitePoint(command.offset) && Math.hypot(command.offset.x, command.offset.y) <= 8;
    case "set-selected":
      return typeof command.selected === "boolean";
    default:
      return invalidNever(command);
  }
}

function validHomeCommand(candidate: HomePrimitiveCommand): boolean {
  if (!isRecord(candidate)) return false;
  const command = candidate as HomePrimitiveCommand;
  switch (command.kind) {
    case "build":
    case "damage":
    case "collapse":
    case "loot":
    case "claim":
      return typeof command.durationMs === "number" && Number.isFinite(command.durationMs)
        && command.durationMs > 0;
    case "scavenge":
      return typeof command.durationMs === "number" && Number.isFinite(command.durationMs)
        && command.durationMs > 0
        && typeof command.remnantMaterialsAfter === "number"
        && Number.isFinite(command.remnantMaterialsAfter)
        && command.remnantMaterialsAfter >= 0;
    case "door":
      return command.state === "open" || command.state === "closed";
    case "hearth":
      return command.state === "warm" || command.state === "quiet";
    default:
      return invalidNever(command);
  }
}

function validEnvironmentRequest(candidate: EnvironmentEffectRequest): boolean {
  if (!isRecord(candidate)) return false;
  const request = candidate as EnvironmentEffectRequest;
  switch (request.kind) {
    case "footstep":
    case "smoke":
    case "ember":
    case "dust":
      return validFinitePoint(request.at) && validString(request.tint)
        && (request.label === undefined || (isRecord(request.label)
          && validString(request.label.recipientId) && validString(request.label.value)));
    case "speech-bubble":
      return validFinitePoint(request.at)
        && validString(request.speakerId)
        && validString(request.text)
        && (request.variant === "speech" || request.variant === "thought" || request.variant === "whisper")
        && Number.isFinite(request.tailLean)
        && validString(request.hue)
        && validString(request.accent)
        && validOverlayTier(request.tier)
        && (request.thread === undefined || validOverlayThread(request.thread));
    case "event-mark":
      return validFinitePoint(request.at)
        && validString(request.ownerId)
        && validOverlayOwnerKind(request.ownerKind)
        && validString(request.glyph)
        && validOverlayFamily(request.family)
        && validOverlayTier(request.tier)
        && (request.micro === undefined || validString(request.micro))
        && (request.threads === undefined
          || (Array.isArray(request.threads) && request.threads.every(validOverlayThread)));
    case "event-burst":
      return validFinitePoint(request.at)
        && validString(request.glyph)
        && validOverlayFamily(request.family)
        && (request.invert === undefined || typeof request.invert === "boolean")
        && (request.light === undefined || typeof request.light === "boolean");
    case "event-gather":
      return validFinitePoint(request.at) && validString(request.ownerId);
    case "flying-item":
      return validFinitePoint(request.from) && validFinitePoint(request.to)
        && (request.icon === "energy" || request.icon === "materials" || request.icon === "loot" || request.icon === "gift")
        && (request.label === undefined || validString(request.label));
    default:
      return invalidNever(request);
  }
}

function validOverlayTier(value: unknown): boolean {
  return value === "murmur" || value === "beat" || value === "strike" || value === "knell";
}

function validOverlayFamily(value: unknown): boolean {
  return value === "exchange" || value === "bond" || value === "harm"
    || value === "dwell" || value === "body" || value === "world";
}

function validOverlayThread(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return validFinitePoint(value.to)
    && (value.mode === "aim" || value.mode === "severed")
    && validString(value.accent)
    && validString(value.hue)
    && validOverlayOwnerKind(value.toKind);
}

/** Optional everywhere it appears; omitted means the overlay hangs on a being. */
function validOverlayOwnerKind(value: unknown): boolean {
  return value === undefined || value === "being" || value === "structure";
}

function validPlacementContext(candidate: ProductionSceneCommand extends infer _Command ? unknown : never): boolean {
  if (!isRecord(candidate)) return false;
  if (candidate.kind === "birth") {
    return validString(candidate.acceptorId) && typeof candidate.authoritativeColocation === "boolean";
  }
  if (candidate.kind === "arrival") return validString(candidate.fromRegion);
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function validNullableString(value: unknown): value is string | null {
  return value === null || validString(value);
}

function validFinitePoint(value: unknown): value is Vec2 {
  return isRecord(value) && typeof value.x === "number" && Number.isFinite(value.x)
    && typeof value.y === "number" && Number.isFinite(value.y);
}

function finiteRange(value: unknown, minimum: number, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum && value <= maximum;
}

function invalidNever(_value: never): false {
  return false;
}

function drawRemoteTransients(
  context: CanvasRenderingContext2D,
  transients: Iterable<Readonly<{
    motif: "portrait" | "atlas" | "vignette";
    at: Vec2 | null;
  }>>,
  recipe: RegionMapRecipeV1 | null,
): void {
  for (const transient of transients) {
    const anchor = transient.at ?? {
      x: Math.min(48, Math.max(16, (recipe?.grid.columns ?? 2) * 8)),
      y: Math.min(40, Math.max(16, (recipe?.grid.rows ?? 2) * 6)),
    };
    context.save();
    context.globalAlpha = 0.92;
    if (transient.motif === "portrait") {
      context.fillStyle = "#263238";
      context.fillRect(anchor.x - 12, anchor.y - 22, 24, 24);
      context.fillStyle = "#d7b184";
      context.fillRect(anchor.x - 7, anchor.y - 18, 14, 14);
      context.fillStyle = "#3b2b26";
      context.fillRect(anchor.x - 5, anchor.y - 14, 3, 3);
      context.fillRect(anchor.x + 2, anchor.y - 14, 3, 3);
    } else if (transient.motif === "atlas") {
      context.fillStyle = "#18272b";
      context.fillRect(anchor.x - 16, anchor.y - 12, 32, 24);
      context.fillStyle = "#6f9f68";
      context.fillRect(anchor.x - 13, anchor.y - 9, 12, 18);
      context.fillStyle = "#b99b62";
      context.fillRect(anchor.x + 1, anchor.y - 9, 12, 18);
      context.fillStyle = "#d8c47a";
      context.fillRect(anchor.x - 2, anchor.y - 1, 4, 3);
    } else {
      context.fillStyle = "#7d572c";
      context.fillRect(anchor.x - 18, anchor.y - 18, 32, 4);
      context.fillRect(anchor.x - 18, anchor.y + 14, 32, 4);
      context.fillRect(anchor.x - 18, anchor.y - 14, 4, 28);
      context.fillRect(anchor.x + 14, anchor.y - 14, 4, 28);
    }
    context.restore();
  }
}

function sceneCommandResult(
  outcome: ProductionSceneCommandResult["outcome"],
  appliedCommandIds: readonly string[],
  ignoredCommandIds: readonly string[],
  rejections: readonly ProductionSceneCommandRejection[] = [],
): ProductionSceneCommandResult {
  return deepFreeze({
    outcome,
    appliedCommandIds: [...appliedCommandIds],
    ignoredCommandIds: [...ignoredCommandIds],
    rejections: rejections.map((rejection) => ({ ...rejection })),
  });
}

/** One rejection per command, for the whole-batch refusals. */
function batchRejections(
  commands: readonly ProductionSceneCommand[],
  reason: ProductionSceneCommandRejectionReason,
  detail: string,
): readonly ProductionSceneCommandRejection[] {
  return commands.map((command) => ({
    commandId: command.commandId,
    commandKind: command.kind,
    subjectId: sceneCommandSubjectId(command),
    reason,
    detail,
  }));
}

/** The actor or home a scene command addresses, for rejection diagnostics. */
function sceneCommandSubjectId(command: ProductionSceneCommand): string | null {
  switch (command.kind) {
    case "actor":
    case "retain-traveler":
    case "presence-fade":
    case "stage-arrival":
      return command.actorId;
    case "home":
    case "create-provisional-home":
      return command.homeId;
    case "placement-hint":
      return command.agentId;
    default:
      return null;
  }
}

function collectCandidateRecords(frame: PresentedObserverFrame): CandidateRecords | null {
  const actors = uniqueRecords(frame.world.agents, "id");
  const regions = uniqueRecords(frame.world.regions, "name");
  const standing = uniqueRecords(frame.world.homes, "home_id");
  const ruins = uniqueRecords(frame.world.ruins, "home_id");
  if (actors === null || regions === null || standing === null || ruins === null) return null;
  for (const id of standing.records.keys()) if (ruins.records.has(id)) return null;
  const homes = new Map<string, Readonly<{
    record: PresentedRecord<HomeSnapshot>;
    kind: "home" | "ruin";
  }>>();
  for (const [id, record] of standing.records) homes.set(id, { record, kind: "home" });
  for (const [id, record] of ruins.records) homes.set(id, { record, kind: "ruin" });
  return {
    actors: actors.records,
    homes,
    regions: regions.records,
    malformedRecords: actors.malformed + regions.malformed + standing.malformed + ruins.malformed,
  };
}

function activeActorRecords(
  records: ReadonlyMap<string, PresentedRecord<AgentSnapshot>>,
  activeRegionId: string | null,
  current: ReadonlyMap<string, ActorEntry>,
  authorizedArrivals: ReadonlyMap<string, DestinationArrivalAuthorization>,
  retained: ReadonlyMap<string, RetainedTraveler>,
): Map<string, PresentedRecord<AgentSnapshot>> {
  const owned = new Map<string, PresentedRecord<AgentSnapshot>>();
  for (const [id, record] of records) {
    const explicitRegion = record.value.position;
    const knownRegion = current.get(id)?.known.position;
    const regionId = typeof explicitRegion === "string"
      ? explicitRegion
      : typeof knownRegion === "string" ? knownRegion : null;
    const arrival = authorizedArrivals.get(id);
    if (regionId === activeRegionId
      || (arrival !== undefined && current.has(id))
      || retained.has(id)) owned.set(id, record);
  }
  return owned;
}

function matchingDestinationArrivalAuthorizations(
  frame: PresentedObserverFrame,
  batch: ProductionSceneCommandBatch | null,
  retained: ReadonlyMap<string, RetainedTraveler>,
  current: ReadonlyMap<string, ActorEntry>,
  records: ReadonlyMap<string, PresentedRecord<AgentSnapshot>>,
  placement: PlacementLedgerSnapshot,
  recipes: ReadonlyMap<string, RegionMapRecipeV1>,
): ReadonlyMap<string, DestinationArrivalAuthorization> {
  const authorized = new Map<string, DestinationArrivalAuthorization>();
  const scene = frame.scene;
  if (scene === null || batch === null || !isValidProductionSceneCommandBatch(batch)
    || !sameIdentity(batch.identity, frame) || scene.phase !== "hold"
    || scene.execution?.eventType !== "agent_entered_region"
    || scene.execution.sceneToken !== batch.sceneToken) return authorized;
  const expectedProgramId = `choreography:${scene.momentId}:agent_entered_region`;
  if (scene.execution.programId !== expectedProgramId) return authorized;
  for (const command of batch.commands) {
    if (command.kind !== "stage-arrival"
      || command.eventType !== "agent_entered_region" || command.phase !== "hold"
      || command.momentId !== scene.momentId || command.programId !== expectedProgramId
      || command.fromRegion === command.toRegion || scene.regionId !== command.toRegion) continue;
    const traveler = retained.get(command.actorId);
    const entry = current.get(command.actorId);
    const record = records.get(command.actorId);
    const durablePlacement = placement.agents.get(command.actorId);
    const explicitRegion = record?.value.position;
    const recipe = recipes.get(command.toRegion);
    const directedGate = recipe?.gates.find((gate) => (
      gate.role === "arrival"
      && gate.edge.from === command.fromRegion
      && gate.edge.to === command.toRegion
    ));
    const gate = directedGate === undefined ? null : tileCenter(directedGate.tile);
    const valid = traveler !== undefined
      && traveler.sceneToken === batch.sceneToken
      && traveler.runId === frame.runId && traveler.sourceKey === frame.sourceKey
      && traveler.fromRegion === command.fromRegion && traveler.toRegion === command.toRegion
      && gate !== null && samePoint(traveler.arrivalGate, gate)
      && entry !== undefined && entry.status === "alive" && !entry.actor.snapshot().terminal
      && record !== undefined && record.value.status === "alive"
      && (typeof explicitRegion !== "string" || explicitRegion === command.fromRegion)
      && durablePlacement?.regionId === command.fromRegion;
    if (!valid || gate === null) continue;
    authorized.set(command.actorId, {
      commandId: command.commandId,
      actorId: command.actorId,
      fromRegion: command.fromRegion,
      toRegion: command.toRegion,
      gate: { ...gate },
    });
  }
  return authorized;
}

function applicableRetainedTravelers(
  retained: ReadonlyMap<string, RetainedTraveler>,
  current: ReadonlyMap<string, ActorEntry>,
  records: ReadonlyMap<string, PresentedRecord<AgentSnapshot>>,
  recipes: ReadonlyMap<string, RegionMapRecipeV1>,
  frame: PresentedObserverFrame,
  sceneToken: number | null,
): Readonly<{
  valid: ReadonlyMap<string, RetainedTraveler>;
  invalidActorIds: readonly string[];
}> {
  const valid = new Map<string, RetainedTraveler>();
  const invalidActorIds: string[] = [];
  for (const [actorId, traveler] of retained) {
    const record = records.get(actorId);
    const destination = recipes.get(traveler.toRegion);
    const gate = destination?.gates.find((candidate) => (
      candidate.role === "arrival"
      && candidate.edge.from === traveler.fromRegion
      && candidate.edge.to === traveler.toRegion
    ));
    const explicitRegion = record?.value.position;
    const contradictsRegion = typeof explicitRegion === "string"
      && explicitRegion !== traveler.fromRegion
      && explicitRegion !== traveler.toRegion;
    const invalid = traveler.runId !== frame.runId
      || traveler.sourceKey !== frame.sourceKey
      || record === undefined
      || record.value.status === "dead"
      || current.get(actorId)?.actor.snapshot().terminal === true
      || gate === undefined
      || !samePoint(traveler.arrivalGate, tileCenter(gate.tile))
      || contradictsRegion
      || (sceneToken !== null
        && sceneToken > traveler.sceneToken + (traveler.arrivalCommitted ? 0 : 1));
    if (invalid) invalidActorIds.push(actorId);
    else valid.set(actorId, traveler);
  }
  return { valid, invalidActorIds };
}

type PlacementHintCommand = Extract<ProductionSceneCommand, { kind: "placement-hint" }>;

function matchingPlacementHints(
  frame: PresentedObserverFrame,
  batch: ProductionSceneCommandBatch | null,
  consumed: ReadonlySet<string>,
): readonly PlacementHintCommand[] {
  if (batch === null || !sameIdentity(batch.identity, frame) || !isValidProductionSceneCommandBatch(batch)) return [];
  return batch.commands.filter((command): command is PlacementHintCommand =>
    command.kind === "placement-hint" && !consumed.has(command.commandId));
}

function validPlacementHint(
  hint: PlacementHintCommand,
  agent: AgentSnapshot,
  placement: PlacementLedgerSnapshot,
  recipes: ReadonlyMap<string, RegionMapRecipeV1>,
): boolean {
  if (hint.agentId !== agent.id || agent.status !== "alive") return false;
  if (hint.context.kind === "birth") {
    if (hint.context.acceptorId.trim().length === 0 || hint.context.acceptorId === agent.id) return false;
    if (!hint.context.authoritativeColocation) return true;
    return placement.agents.get(hint.context.acceptorId)?.regionId === agent.position;
  }
  const fromRegion = hint.context.fromRegion;
  const existing = placement.agents.get(agent.id);
  if (existing?.regionId !== fromRegion || agent.position === fromRegion) return false;
  const recipe = recipes.get(agent.position);
  const gate = recipe?.gates.find((candidate) =>
    candidate.role === "arrival"
    && candidate.edge.from === fromRegion
    && candidate.edge.to === agent.position);
  if (gate === undefined) return false;
  const gatePoint = tileCenter(gate.tile);
  if (hint.arrivalGate !== undefined && !samePoint(hint.arrivalGate, gatePoint)) return false;
  return hint.requestedFinal === undefined
    || (Number.isFinite(hint.requestedFinal.x) && Number.isFinite(hint.requestedFinal.y));
}

function eligibleBirthReanchorRequest(
  hint: PlacementHintCommand,
  current: ActorEntry | undefined,
  placement: PlacementLedgerSnapshot,
): boolean {
  if (hint.context.kind !== "birth" || !hint.context.authoritativeColocation) return false;
  if (current === undefined) return false;
  const anchorKind = placement.agents.get(hint.agentId)?.anchorKind;
  return anchorKind === "staging" || anchorKind === "birth-fallback";
}

function activeHomeRecords(
  records: CandidateRecords["homes"],
  activeRegionId: string | null,
  current: ReadonlyMap<string, HomeEntry>,
  currentRegionId: string | null,
): Map<string, CandidateRecords["homes"] extends ReadonlyMap<string, infer Value> ? Value : never> {
  type CandidateHome = CandidateRecords["homes"] extends ReadonlyMap<string, infer Value> ? Value : never;
  const visible = new Map<string, CandidateHome>();
  if (activeRegionId === null) return visible;
  for (const [id, candidate] of records) {
    const explicitRegion = candidate.record.value.region;
    const retainedInCurrentRegion = current.has(id) && currentRegionId === activeRegionId;
    if (explicitRegion === activeRegionId
      || (typeof explicitRegion !== "string" && retainedInCurrentRegion)) {
      visible.set(id, candidate);
    }
  }
  return visible;
}

function countUnlocatedActors(
  records: ReadonlyMap<string, PresentedRecord<AgentSnapshot>>,
  current: ReadonlyMap<string, ActorEntry>,
): number {
  let count = 0;
  for (const [id, record] of records) {
    if (typeof record.value.position !== "string" && !current.has(id)) count += 1;
  }
  return count;
}

function countUnlocatedHomes(
  records: CandidateRecords["homes"],
  current: ReadonlyMap<string, HomeEntry>,
): number {
  let count = 0;
  for (const [id, candidate] of records) {
    if (typeof candidate.record.value.region !== "string" && !current.has(id)) count += 1;
  }
  return count;
}

function releaseAtlasLeases(leases: ReadonlyMap<string, ProductionAssetLease>): void {
  for (const lease of new Set(leases.values())) lease.release();
}

/**
 * Atlas ids the active human actor factory needs leased for one new actor
 * instance.
 *
 * The production factory (`ProductionCanvasSceneFactory.ts`) constructs a
 * `SpriteSheetHumanActor`, which draws from the single `core-being-chibi`
 * sheet — unlike the retired `LayeredHumanActor`, it never touches the
 * `core-human-*` body/face/hair/held/status/clothing atlases, so leasing
 * the whole `"core"` manifest group per actor (as the layered actor's
 * runtime layer composition required) would hold references to atlases the
 * actor never reads. Scoped this way so shared-atlas refcounting
 * (`acquireAtlasLeases`/`releaseAtlasLeases`) only tracks what's actually
 * drawn. `core-human-*` atlases stay registered in the manifest (retired,
 * not removed) for a later cleanup pass.
 */
function coreActorAtlasIds(manifest: ProductionAssetManifest): readonly string[] {
  return manifest.atlases[BEING_CHIBI_ATLAS_ID] ? [BEING_CHIBI_ATLAS_ID] : [];
}

function homeActorAtlasIds(
  manifest: ProductionAssetManifest,
  kit: RegionMapRecipeV1["kit"],
): readonly string[] {
  const home = manifest.regions[kit].homeManifest;
  return [...new Set([
    home.atlasId,
    home.detailAtlasId,
    home.ruinAtlasId,
    home.yard.atlasId,
    ...(manifest.atlases[DEPTH_SCENERY_ATLAS_ID] ? [DEPTH_SCENERY_ATLAS_ID] : []),
  ])];
}

function environmentAtlasIds(
  manifest: ProductionAssetManifest,
  kit: RegionMapRecipeV1["kit"],
): readonly string[] {
  return [...manifest.regions[kit].atlasIds.filter((id) => manifest.atlases[id]?.group === "region"),
    ...(manifest.atlases[DEPTH_SCENERY_ATLAS_ID] ? [DEPTH_SCENERY_ATLAS_ID] : [])];
}

/** One line naming a deferred home and why its actor could not be built. */
function describeDeferral(homeId: string, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `home ${homeId} deferred: ${detail}`;
}

function borrowedAtlasLeases(
  leases: ReadonlyMap<string, ProductionAssetLease>,
): ReadonlyMap<string, ProductionAssetLease> {
  return new Map([...leases].map(([id, lease]) => [id, {
    value: lease.value,
    release(): void {},
  }]));
}

function uniqueRecords<T>(
  values: readonly PresentedRecord<T>[],
  key: keyof T,
): Readonly<{ records: Map<string, PresentedRecord<T>>; malformed: number }> | null {
  const records = new Map<string, PresentedRecord<T>>();
  let malformed = 0;
  for (const record of values) {
    const value = record.value[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      malformed += 1;
      continue;
    }
    if (records.has(value)) return null;
    records.set(value, record);
  }
  return { records, malformed };
}

/**
 * Whether a frame's world provenance cursors are internally coherent.
 *
 * The projection may never sit behind the exact checkpoint it was built on, and it may
 * never claim evidence that was never **ingested** -- a world projected past the stream is
 * fabrication, and that is the guard.
 *
 * It is deliberately NOT bounded by `frame.lastCursor`. Since the two-lane split
 * (design spec 2026-07-31 §3.1) `lastCursor` names the ACTIVE MOMENT's cursor range, not
 * the world's extent: `StoryDirector.flushDeferredEvidence` commits OVERLAY-lane evidence
 * for display-only beats that took no stage lease, so `projectedThroughCursor` legitimately
 * runs ahead of the moment currently on stage. Requiring `projected <= lastCursor` was the
 * single-lane invariant, and it survived the split unnoticed because it is unreachable from
 * a fixture: every chronicle and every unit factory builds a frame with
 * `projectedThroughCursor === lastCursor`. The first real live run (2026-08-20, Gemini)
 * hit it on the first breath -- the graph answered `invalid`, and inside an atlas commit
 * `commitLiveGraphRegion` reported that as "Some world art could not be shown".
 *
 * Args:
 *   frame: The presented frame whose `world` cursors are being checked.
 *
 * Returns:
 *   True when every cursor is a non-negative safe integer and
 *   `exactBaseCursor <= projectedThroughCursor <= ingestedCursor`.
 */
function validPresentedWorldCursors(frame: PresentedObserverFrame): boolean {
  const exact = frame.world.exactBaseCursor;
  const projected = frame.world.projectedThroughCursor;
  return Number.isSafeInteger(exact) && exact >= 0
    && Number.isSafeInteger(projected) && projected >= exact
    && Number.isSafeInteger(frame.presentedCursor) && frame.presentedCursor >= 0
    && Number.isSafeInteger(frame.ingestedCursor) && frame.ingestedCursor >= 0
    && projected <= frame.ingestedCursor;
}

function resolveActiveRegion(
  frame: PresentedObserverFrame,
  regions: ReadonlyMap<string, PresentedRecord<RegionSnapshot>>,
  current: string | null,
  observerViewRegionId: string | null,
): string | null {
  if (observerViewRegionId !== null && regions.has(observerViewRegionId)) return observerViewRegionId;
  const checkpointRegion = frame.checkpointFocus?.regionId;
  if (checkpointRegion !== undefined && regions.has(checkpointRegion)) return checkpointRegion;
  const storyRegion = frame.scene?.regionId;
  if (storyRegion !== null && storyRegion !== undefined && regions.has(storyRegion)) return storyRegion;
  if (current !== null && regions.has(current)) return current;
  if (frame.selection?.kind === "region" && regions.has(frame.selection.id)) return frame.selection.id;
  if (frame.selection?.kind === "agent") {
    const record = frame.world.agents.find((candidate) => candidate.value.id === frame.selection?.id);
    if (typeof record?.value.position === "string" && regions.has(record.value.position)) return record.value.position;
  }
  if (frame.selection?.kind === "home" || frame.selection?.kind === "ruin") {
    const values = frame.selection.kind === "home" ? frame.world.homes : frame.world.ruins;
    const record = values.find((candidate) => candidate.value.home_id === frame.selection?.id);
    if (typeof record?.value.region === "string" && regions.has(record.value.region)) return record.value.region;
  }
  return [...regions.keys()].sort(compareText)[0] ?? null;
}

/**
 * Turn a placed home into the actor factory's presentation input, or
 * `null` when the region has no legal shelter plot left for it.
 *
 * A `null` result is not a failure to report upward -- it is the expected
 * shape of an "unplaced" `PlacementLedger.placeHome` outcome (see its
 * docstring). Callers must skip creating an actor rather than inventing a
 * plot; the home stays diagnosable via `placement.shelterCapacityFor` /
 * `placement.unplacedHomeDiagnostics`, surfaced at
 * `ProductionSceneGraphDebugSnapshot.placement`.
 */
function presentedHomeInput(
  record: PresentedRecord<HomeSnapshot>,
  world: PresentedObserverFrame["world"],
  placement: PlacementLedger,
  recipes: ReadonlyMap<string, RegionMapRecipeV1>,
): PresentedHomeInput | null {
  if (!isCreatableHome(record.value)) throw new Error("Home record is not creatable.");
  const cached = placement.snapshot().homes.get(record.value.home_id);
  const outcome: HomePlacementResult = cached !== undefined
    ? { status: "placed", ...cached }
    : placement.placeHome(record.value);
  if (outcome.status === "unplaced") return null;
  const recipe = recipes.get(outcome.regionId);
  if (!recipe) throw new Error(`Missing recipe for home region ${outcome.regionId}.`);
  const plot = recipe.shelterPlots.find((candidate) => candidate.id === outcome.plotId);
  if (!plot) throw new Error(`Missing home plot ${outcome.plotId}.`);
  const provenance = remnantProvenance(record, world);
  return {
    record,
    exactBaseCursor: world.exactBaseCursor,
    projectedThroughCursor: world.projectedThroughCursor,
    exactRemnantMaterials: provenance.exact,
    ...(provenance.projected === undefined
      ? {}
      : { projectedRemnantMaterials: provenance.projected }),
    worldTime: world.worldTime,
    // A spatial home comes with the exporter-verified shelter origin. Never
    // recompute a different visual placement from its ID; legacy homes retain
    // the deterministic recipe origin they have always used.
    plot: outcome.origin === undefined ? tileCenter(plot.tile) : { ...outcome.origin },
    door: outcome.door,
    kit: recipe.kit,
  };
}

function remnantProvenance(
  record: PresentedRecord<HomeSnapshot>,
  world: PresentedObserverFrame["world"],
): Readonly<{
  exact: number | null;
  projected: Readonly<{ value: number; evidenceCursor: number }> | undefined;
}> {
  const id = record.value.home_id;
  const hasExactPartitions = world.exactHomes !== undefined || world.exactRuins !== undefined;
  const exactPartitions = [...(world.exactHomes ?? []), ...(world.exactRuins ?? [])];
  const exactRecord = typeof id === "string"
    ? exactPartitions.find((candidate) => candidate.home_id === id)
    : undefined;
  const fallbackExact = exactRecord === undefined
    && !hasExactPartitions
    && world.exactBaseCursor === world.projectedThroughCursor
    && record.completeness === "exact"
    ? record.value
    : undefined;
  const exactValue = exactRecord ?? fallbackExact;
  const exact = usableRemnantMaterials(exactValue?.remnant_materials);
  const visible = usableRemnantMaterials(record.value.remnant_materials);
  const projectionDiffers = visible !== null
    && record.value.status === "ruin"
    && world.projectedThroughCursor > world.exactBaseCursor
    && (exactValue?.status !== "ruin" || exact !== visible);
  return {
    exact,
    projected: projectionDiffers
      ? { value: visible, evidenceCursor: world.projectedThroughCursor }
      : undefined,
  };
}

function usableRemnantMaterials(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function protectProjectedTerminalHome(
  entry: HomeEntry,
  record: PresentedRecord<HomeSnapshot>,
): PresentedRecord<HomeSnapshot> {
  if (record.completeness !== "projected-partial") return record;
  const value = { ...entry.input.record.value, ...record.value };
  if (entry.kind === "ruin" && value.status !== "ruin") {
    value.status = "ruin";
    value.ruined_at = entry.input.record.value.ruined_at ?? value.ruined_at;
  }
  return { completeness: "projected-partial", value };
}

function isProjectedBuildConsequence(
  entry: HomeEntry,
  record: PresentedRecord<HomeSnapshot>,
  kind: "home" | "ruin",
): boolean {
  if (entry.provisionalSceneToken === null || record.completeness !== "projected-partial" || kind !== "home") {
    return false;
  }
  const value = record.value;
  return value.home_id === entry.input.record.value.home_id
    && value.region === entry.input.record.value.region
    && value.status === "standing"
    && typeof value.owner_id === "string"
    && value.owner_id.trim().length > 0
    && typeof value.integrity === "number"
    && Number.isFinite(value.integrity)
    && Array.isArray(value.stakeholders)
    && value.stakeholders.every((stakeholder) => typeof stakeholder === "string");
}

function reconcileHomeInput(
  entry: HomeEntry,
  record: PresentedRecord<HomeSnapshot>,
  world: PresentedObserverFrame["world"],
  placement: PlacementLedger,
  recipes: ReadonlyMap<string, RegionMapRecipeV1>,
): PresentedHomeInput {
  const id = record.value.home_id;
  const regionId = record.value.region;
  if (typeof id === "string" && typeof regionId === "string" && isCreatableHome(record.value)) {
    // `entry` only exists for a home already reconciled into `homes` by a
    // prior, successful `presentedHomeInput` call, and placement is
    // append-stable, so this is expected to always resolve "placed." The
    // null branch is defensive, not a real path: keep the last known input
    // (with refreshed cursors) rather than crash on an invariant surprise.
    const presented = presentedHomeInput(record, world, placement, recipes);
    if (presented !== null) return presented;
  }
  const provenance = remnantProvenance(record, world);
  return {
    ...entry.input,
    record,
    exactBaseCursor: world.exactBaseCursor,
    projectedThroughCursor: world.projectedThroughCursor,
    exactRemnantMaterials: provenance.exact,
    projectedRemnantMaterials: provenance.projected,
    worldTime: world.worldTime,
  };
}

function deriveCandidateCondition(
  record: PresentedRecord<RegionSnapshot> | undefined,
  fallback: RegionCondition | null,
): RegionCondition | null {
  if (record === undefined) return fallback;
  const value = record.value;
  if (![value.current_energy, value.current_materials, value.max_energy, value.max_materials]
    .every((part) => typeof part === "number" && Number.isFinite(part))) return fallback;
  return {
    energyRatio: ratio(value.current_energy!, value.max_energy!),
    materialsRatio: ratio(value.current_materials!, value.max_materials!),
  };
}

function ratio(current: number, maximum: number): number {
  return maximum > 0 ? Math.max(0, Math.min(1, current / maximum)) : 0;
}

function samePoint(left: Vec2, right: Vec2 | null): boolean {
  return right !== null && left.x === right.x && left.y === right.y;
}

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>): boolean {
  if (left.size !== right.size) return false;
  for (const value of left) if (!right.has(value)) return false;
  return true;
}

function validIntegerPoint(point: Vec2): boolean {
  return Number.isInteger(point.x) && Number.isInteger(point.y);
}

function isCreatableAgent(value: Readonly<Partial<AgentSnapshot>>): value is AgentSnapshot {
  return typeof value.id === "string" && value.id.trim().length > 0
    && typeof value.name === "string" && value.name.trim().length > 0
    && typeof value.position === "string" && value.position.trim().length > 0
    && validAgentStatus(value.status)
    && typeof value.energy === "number"
    && typeof value.materials === "number";
}

function isCreatableHome(value: Readonly<Partial<HomeSnapshot>>): value is PlaceableHome {
  const identified = typeof value.home_id === "string" && value.home_id.trim().length > 0
    && typeof value.region === "string" && value.region.trim().length > 0
    && (value.status === "standing" || value.status === "ruin")
    && typeof value.owner_id === "string"
    && typeof value.integrity === "number";
  if (!identified) return false;
  // A legacy projected build still waits for the fields its actor has always
  // required. An enriched Nirvana build owns a verified shelter plot and may
  // render before its checkpoint supplies the remaining snapshot fields.
  return value.spatial !== undefined
    || (typeof value.max_integrity === "number" && typeof value.built_at === "number");
}

function validAgentStatus(value: unknown): value is AgentSnapshot["status"] {
  return value === "alive" || value === "paralyzed" || value === "dead";
}

function mergeKnown<T extends object>(current: Partial<T>, next: Readonly<Partial<T>>): Partial<T> {
  const merged = { ...current };
  for (const [key, value] of Object.entries(next)) {
    if ((key === "spatial" || key === "spatial_migration") && value === undefined) {
      // Lifecycle clears must not retain the prior route or the transient gate
      // handoff after the backend has superseded either one.
      delete (merged as Record<string, unknown>)[key];
    } else if (value !== undefined) {
      (merged as Record<string, unknown>)[key] = value;
    }
  }
  return merged;
}

function sameSpatialMigration(
  left: AgentSnapshot["spatial_migration"] | undefined,
  right: NonNullable<AgentSnapshot["spatial_migration"]>,
): boolean {
  return left !== undefined
    && left.from_region === right.from_region
    && left.to_region === right.to_region
    && samePoint(left.source_position, right.source_position);
}

function disposePrepared(
  actors: readonly PreparedActor[],
  homes: readonly PreparedHome[],
  environment: EnvironmentEntry | null,
): void {
  for (const entry of actors) entry.entry.actor.dispose();
  for (const entry of homes) entry.entry.actor.dispose();
  environment?.system.dispose();
}

interface OwnershipCounter {
  created: number;
  disposed: number;
  peak: number;
}

function ownershipCounter(): OwnershipCounter {
  return { created: 0, disposed: 0, peak: 0 };
}

function recordCreated(counter: OwnershipCounter): void {
  counter.created += 1;
  counter.peak = Math.max(counter.peak, counter.created - counter.disposed);
}

function recordDisposed(counter: OwnershipCounter): void {
  counter.disposed += 1;
}

function snapshotOwnership(counter: OwnershipCounter): OwnershipCounterSnapshot {
  return {
    created: counter.created,
    disposed: counter.disposed,
    outstanding: counter.created - counter.disposed,
    peak: counter.peak,
  };
}

function minimumFuture(current: number | null, candidate: number | null, floor: number): number | null {
  if (candidate === null || !Number.isFinite(candidate) || candidate <= floor) return current;
  return current === null || candidate < current ? candidate : current;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function entityKey(kind: "agent" | "home" | "ruin" | "region", id: string): string {
  return `${kind}:${id}`;
}

function sameIdentity(left: FrameIdentity, right: FrameIdentity): boolean {
  return left.runId === right.runId
    && left.sourceKey === right.sourceKey
    && left.revision === right.revision
    && left.firstCursor === right.firstCursor
    && left.lastCursor === right.lastCursor;
}

function copyIdentity(value: FrameIdentity): FrameIdentity {
  return {
    runId: value.runId,
    sourceKey: value.sourceKey,
    revision: value.revision,
    firstCursor: value.firstCursor,
    lastCursor: value.lastCursor,
  };
}

function emptyDiff(outcome: Exclude<SceneGraphUpdateOutcome, "applied">): SceneGraphDiff {
  return freezeDiff({ outcome, added: [], updated: [], removed: [], staticLayersInvalidated: false });
}

function freezeDiff(diff: SceneGraphDiff): SceneGraphDiff {
  return Object.freeze({
    ...diff,
    added: Object.freeze([...diff.added].sort(compareText)),
    updated: Object.freeze([...diff.updated].sort(compareText)),
    removed: Object.freeze([...diff.removed].sort(compareText)),
  });
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value as Record<string, unknown>)) deepFreeze(nested);
  return Object.freeze(value);
}
