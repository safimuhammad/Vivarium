import {
  createGuardedObserverRendererPort,
  type ObserverRendererCallbacks,
  type ObserverRendererDiagnostics,
  type ObserverRendererFailure,
  type ObserverRendererPort,
  type WorldNavigationState,
} from "../../presentation/rendererPort";
import { claimObserverRendererSurface } from "../../presentation/rendererSurfaceOwnership";
import {
  type CameraMode,
  type FrameIdentity,
  type MomentAnchor,
  type ObserverSelection,
  type PresentedObserverFrame,
  type SafeFrameInsets,
  type Vec2,
  assertValidFrameIdentity,
} from "../../presentation/contracts";
import type { FrameDriver, Rect, WakeScheduler } from "../contracts";
import {
  createCamera,
  deriveSheetZoomBounds,
  STORY_FIT_MAX_ZOOM,
  type CameraCheckpoint,
  type CameraRegionSheet,
  type CameraSnapshot,
} from "../camera/Camera2D";
import { wrapCoordinate } from "../camera/RegionPresentationTopology";
import {
  computeRegionSheet,
  packRegionSheet,
  regionAtPoint,
  type RegionAdjacency,
  type RegionExtent,
  type RegionSheet,
} from "./world/regionSheetLayout";
import {
  createRegionSnapshotCache,
  type RegionSnapshotBitmap,
  type RegionSnapshotCache,
} from "./world/regionSnapshotCache";
import {
  createFocusFollowState,
  resolveFocusFollow,
  type FocusFollowState,
} from "./world/regionFocusFollow";
import { beingMarkColor, markScatterPoint } from "./world/regionMarkPlacement";
import {
  ascentTarget,
  createZoomOutDetentState,
  DETENT_GESTURE_GAP_MS,
  descentTarget,
  pickRegionAtPoint,
  resolveZoomOutDetent,
  type WorldViewScope,
  type ZoomOutDetentState,
} from "./world/worldNavigation";
import {
  buildIslandMask,
  islandCoastPoints,
  islandContourLoops,
  islandFillFraction,
  islandLandAnchor,
  islandMapFit,
  maskDistanceAtLocal,
  type IslandMask,
  type IslandPoint,
  type MaskRect,
} from "./world/islandMask";
import { computeBridgeSpans, type BridgeSpan } from "./world/islandBridges";
import {
  atlasDayFraction,
  resolveAtlasLight,
  tintedHex,
  type AtlasLight,
} from "./world/atlasLight";
import {
  buildIslandLayers,
  coastalBoulders,
  coastPaletteForKit,
  seaWaveTicks,
  type AtlasSurfaceFactory,
  type CoastalBoulder,
  type IslandLayers,
} from "./world/atlasIslandLayers";
import {
  placeAtlasMarks,
  type AtlasBeingInput,
  type AtlasIslandRef,
  type AtlasPulseInput,
} from "./world/atlasMarks";
import {
  buildRegionMapInset,
  type MapSymbolLayer,
  type MapSymbolRect,
} from "./world/atlasSymbolLayer";
import { TEXT_ZOOM_THRESHOLD } from "./environment/bubbleGrammar";
import { deriveHumanAppearance } from "./actors/appearance";
import { resolveBeingCharacter } from "./actors/beingChibiAtlas";
import { resolveBeingPaletteVariant } from "./actors/beingPalette";
import type { AgentSnapshot, HomeSnapshot } from "../../app/schemas";
import {
  createSharedAtlasPool,
  type SharedAtlasPool,
  type SharedAtlasPoolDiagnostics,
} from "./assets/SharedAtlasPool";
import type {
  NativeFrameRef,
  ProductionAssetLease,
  ProductionAssetManifest,
  RegionAssetPackManifest,
  TerrainRole,
} from "./assets/productionManifest";
import { productionAtlasIdsForRegion } from "./assets/ProductionRegionAssets";
import type {
  RegionMapRecipeV1,
  RegionPresentationProfile,
  ScenicLandmarkPlacement,
} from "./maps/RegionMapRecipe";
import type { PlacementLedger } from "./placement/PlacementLedger";
import {
  createProductionSceneGraph,
  isValidProductionSceneCommandBatch,
  type ProductionSceneFactories,
  type ProductionSceneFrameResult,
  type ProductionSceneGraph,
  type ProductionSceneGraphDebugSnapshot,
  type ProductionSceneGraphOptions,
  type ProductionSceneHitTarget,
  type SceneGraphDiff,
} from "./ProductionSceneGraph";
import type {
  ProductionSceneCommand,
  ProductionSceneCommandBatch,
  ProductionSceneSignal,
} from "./ProductionSceneBridge";
import { createProductionSceneCommandResolver } from "./ProductionSceneCommandResolver";
import type { PresentationFrameAcceptanceTracker } from "../../presentation/PresentationFrameSink";
import { createRendererSemanticPublisher } from "./semantics";
import {
  createCacheCanvasOwner,
  type CacheCanvasOwner,
  type CacheCanvasOwnerFactory,
} from "./CacheCanvasOwner";
import type { AtlasCommitScheduler } from "./AtlasCommitScheduler";
import {
  decideAssetFallback,
  decideMarkerFallback,
  publicRendererFailure,
} from "./failurePolicy";
import {
  createProductionStaticSceneDescriptor,
  drawProductionStaticSceneOperation,
  sameProductionStaticSceneDescriptor,
  visiblePeriodicDrawOffsets,
  visibleSeamActorOffsets,
  type ProductionStaticSceneContext,
  type ProductionStaticSceneDescriptor,
  type ProductionStaticScenePreparation,
  type ProductionStaticSceneProvider,
} from "./staticScene/ProductionStaticScene";

export interface CanvasPresentationVisibilityTarget extends EventTarget {
  readonly hidden: boolean;
}

/** Cancellable browser-task boundary used between atlas decode and scene adoption. */
export type { AtlasCommitScheduler } from "./AtlasCommitScheduler";

export interface CanvasPresentationRendererOptions {
  readonly canvas: HTMLCanvasElement;
  readonly callbacks: ObserverRendererCallbacks;
  readonly manifest: ProductionAssetManifest;
  readonly factories: ProductionSceneFactories;
  readonly placement: PlacementLedger;
  readonly recipes: ReadonlyMap<string, RegionMapRecipeV1> | readonly RegionMapRecipeV1[];
  readonly signal?: AbortSignal;
  readonly frameDriver?: FrameDriver;
  readonly wakeScheduler?: WakeScheduler;
  readonly reducedMotion?: boolean;
  readonly atlasPool?: SharedAtlasPool;
  readonly sceneGraphFactory?: (options: ProductionSceneGraphOptions) => ProductionSceneGraph;
  readonly visibilityTarget?: CanvasPresentationVisibilityTarget;
  readonly diagnosticsEnabled?: () => boolean;
  readonly resolveSceneCommands?: (
    frame: PresentedObserverFrame,
  ) => ProductionSceneCommandBatch | null;
  readonly onSceneSignals?: (signals: readonly ProductionSceneSignal[]) => void;
  readonly frameAcceptance?: Pick<PresentationFrameAcceptanceTracker, "markAccepted">;
  readonly cacheCanvasFactory?: CacheCanvasOwnerFactory;
  readonly measurementNow?: () => number;
  readonly atlasCommitScheduler?: AtlasCommitScheduler;
  readonly staticSceneProviders?: ReadonlyMap<string, ProductionStaticSceneProvider>;
  /**
   * Enables Task Z3's world-sheet LOD compositing: the gutter fill, non-focused regions drawn
   * from their cached snapshots, off-region being marks, and camera-focus-follows-into-a-live-
   * switch hysteresis. Defaults to `false` -- with it unset, behaviour is byte-for-byte the
   * pre-existing single-region render (same guarantee Z2's `regionSheet` gave `Camera2D`), which
   * is what every pre-existing unit test that constructs this renderer directly (rather than
   * through `PresentationWorldStage`) still exercises. `PresentationWorldStage` passes `true`.
   */
  readonly worldSheetSnapshots?: boolean;
  /**
   * Owner factory for Z3's background (non-focused-region) snapshot canvases specifically.
   * Deliberately separate from `cacheCanvasFactory` (which observes only the FOCUSED region's own
   * cache lifecycle) -- see `createCachePreparation`'s `ownerFactoryOverride` doc. Defaults to a
   * real `<canvas>` via `canvas.ownerDocument.createElement`, exactly like `cacheCanvasFactory`'s
   * own default; tests that need to inspect background-snapshot draws inject a fake here without
   * disturbing any pre-existing `cacheCanvasFactory`-based assertion.
   */
  readonly backgroundSnapshotCanvasFactory?: CacheCanvasOwnerFactory;
}

export interface CanvasPresentationRendererDebug {
  readonly frameIdentity: FrameIdentity | null;
  readonly visibleRegionId: string | null;
  readonly loadingRegionId: string | null;
  readonly staticCacheRegions: readonly string[];
  /** Detached witness of the static cache that is actually mounted for drawing. */
  readonly mountedStaticCache: Readonly<{
    readonly regionId: string;
    readonly staticCacheIdentity: string;
  }> | null;
  /** Detached witness of the recipe currently selected by the visible region. */
  readonly visibleRecipe: Readonly<{
    readonly regionId: string;
    readonly identityHash: string;
    readonly grid: Readonly<{
      readonly columns: number;
      readonly rows: number;
    }>;
    readonly presentationProfile: Readonly<RegionPresentationProfile> | null;
  }> | null;
  readonly staticLayerRebuilds: number;
  readonly staticArtFallbacks: number;
  readonly camera: CameraSnapshot & { readonly safeFrameInsets: SafeFrameInsets };
  /**
   * World-view navigation: the latched scope, the hovered island, the region floor in force, and
   * whether a descent/ascent is in flight. Published so a harness can PROVE the place latch (a
   * zoom-out inside a region changes the zoom and not the scope) rather than inferring it from
   * pixels.
   */
  readonly worldNavigation: Readonly<{
    scope: "world" | "region" | null;
    focusedRegionId: string | null;
    frameOriginRegionId: string | null;
    hoveredRegionId: string | null;
    minimumZoom: number;
    descendingIntoRegionId: string | null;
    ascending: boolean;
    exitOffered: boolean;
  }>;
  readonly cameraImpulse: Readonly<{ offset: Vec2; untilMs: number }> | null;
  /**
   * The beat the director is currently framing and the overlay deadline its hold is bound to.
   * `holdRemainingMs` is measured against the same draw clock the overlay expires on, so a probe
   * can prove the camera and the chrome are on one clock rather than two.
   */
  readonly beatFraming: Readonly<{
    momentId: string;
    union: Rect;
    primaryKey: string | null;
    holdUntilMs: number | null;
    holdRemainingMs: number | null;
  }> | null;
  /**
   * A journey to a past Chronicle moment that is still waiting for its region to mount, and how
   * long it has left before it is abandoned. `null` whenever nothing is parked.
   */
  readonly momentTravel: Readonly<{
    entityId: string | null;
    regionId: string | null;
    remainingMs: number;
  }> | null;
  /** Exact integer origin used by the most recent Canvas draw transform. */
  readonly renderRasterOrigin: Vec2 | null;
  readonly postCommit: Readonly<{
    acceptancePending: boolean;
    semanticPending: boolean;
  }>;
  readonly lastInternalFailure: Readonly<{
    stage: "lineage-rebind" | "frame-commit";
    name: string;
    message: string;
  }> | null;
  readonly graph: ProductionSceneGraphDebugSnapshot & Readonly<{
    activeActors: number;
    activeHomes: number;
    activeEffects: number;
  }>;
  readonly scheduler: Readonly<{
    hidden: boolean;
    dirty: boolean;
    rafScheduled: boolean;
    wakeScheduled: boolean;
    nextDeadlineMs: number | null;
    reason: "graph-deadline" | "post-commit-retry" | null;
  }>;
  readonly pool: SharedAtlasPoolDiagnostics;
  readonly draw: Readonly<{
    count: number;
    totalCount: number;
    maxMs: number;
    samplesMs: readonly number[];
  }>;
  readonly cache: Readonly<{
    created: number;
    disposed: number;
    outstanding: number;
    peak: number;
    lastRebuildReason: "initial" | "region" | "topology" | "resize" | null;
    /**
     * How many times the browser threw the mounted static cache's backing store away and the
     * renderer re-rasterised it. Non-zero means the artwork was recovered, not that it was lost.
     */
    pixelLossRecoveries: number;
    /** Whether the cache being drawn from right now is known to have lost its pixels. */
    pixelsLost: boolean;
  }>;
}

export interface CanvasPresentationRenderer extends ObserverRendererPort {
  debug(): CanvasPresentationRendererDebug;
}

interface CachePair {
  readonly regionId: string;
  readonly recipe: RegionMapRecipeV1;
  readonly staticCacheIdentity: string;
  readonly descriptor: ProductionStaticSceneDescriptor;
  readonly continuationMatte: CacheCanvasOwner;
  readonly continuationPattern: CanvasPattern;
  readonly terrain: CacheCanvasOwner;
  readonly scenery: CacheCanvasOwner;
}

interface CachePreparation {
  readonly descriptor: ProductionStaticSceneDescriptor;
  advance(maxDrawOperations: number): CachePair | null;
  dispose(): void;
}

interface AtlasGeneration {
  readonly epoch: number;
  readonly controller: AbortController;
  readonly regionId: string;
  readonly staticTarget: StaticSceneLoadTarget;
  readonly observerOnly: boolean;
  readonly observerViewRegionId: string | null;
  frame: PresentedObserverFrame;
  batch: ProductionSceneCommandBatch | null;
  readonly prerequisites: Array<Readonly<{
    frame: PresentedObserverFrame;
    batch: ProductionSceneCommandBatch;
  }>>;
}

interface StaticSceneLoadTarget {
  readonly recipe: RegionMapRecipeV1;
  readonly descriptor: ProductionStaticSceneDescriptor;
  readonly atlasIds: readonly string[];
}

interface PendingAtlasCommit {
  readonly generation: AtlasGeneration;
  readonly leases: ReadonlyMap<string, ProductionAssetLease>;
  phase: "prepare" | "adopt";
  handle: number | null;
  preparation: CachePreparation | null;
  preparedCache: CachePair | null;
}

/**
 * Tracks one non-focused region's in-flight offscreen snapshot build (Task Z3). Mirrors
 * `PendingAtlasCommit`'s prepare/advance shape but is independent of the focused-region `loading`
 * generation -- several of these can be in flight at once (one per non-focused region), and none
 * of them ever touches `visibleRegionId`, `cache`, or `graph`.
 */
interface BackgroundSnapshotBuild {
  readonly regionId: string;
  readonly signature: string;
  readonly controller: AbortController;
  leases: ReadonlyMap<string, ProductionAssetLease> | null;
  preparation: CachePreparation | null;
  handle: number | null;
  disposed: boolean;
}

interface ArrivalContinuity {
  readonly runId: string;
  readonly sourceKey: string;
  readonly sceneToken: number;
  readonly momentId: string;
  readonly programId: string;
  readonly actorId: string;
  readonly fromRegion: string;
  readonly toRegion: string;
  readonly leg: "departure" | "arrival";
  readonly phase: "enter" | "hold" | "consequence" | "recover" | "exit" | "gap";
}

interface PendingArrivalCommit {
  readonly frame: PresentedObserverFrame;
  readonly batch: ProductionSceneCommandBatch;
  readonly continuity: ArrivalContinuity;
}

interface CameraImpulseState {
  readonly offset: Vec2;
  readonly untilMs: number;
}

interface CheckpointCameraOwnership {
  readonly camera: CameraCheckpoint;
  readonly regionId: string | null;
  restoring: boolean;
}

interface InteractiveOwnershipSnapshot {
  readonly selection: ObserverSelection;
  readonly selectionOwnedByInteraction: boolean;
  readonly storyFocusSelection: Exclude<ObserverSelection, null> | null;
  readonly storyFocusOwnedByInteraction: boolean;
}

type HitTarget = ProductionSceneHitTarget;

const EMPTY_SAFE_FRAME: SafeFrameInsets = { top: 0, right: 0, bottom: 0, left: 0 };
const MAX_DELTA_MS = 50;
const TILE_SIZE = 32;
/** How long one atlas event beat's pulse takes to expand and fade: small, bright and brief, so it
 * MEANS something when it fires (see `docs/frontend/ATLAS_VIEW.md` §5). */
const ATLAS_PULSE_MS = 1_200;

/** Maps a scene's own event type onto one of the atlas's pulse hues. Keyword-matched rather than
 * exhaustively enumerated, so a new event type still pulses (in the neutral hue) instead of
 * silently vanishing from the map. */
function pulseKindFor(eventType: string | null): string {
  if (eventType === null) return "speech";
  const type = eventType.toLowerCase();
  if (type.includes("birth") || type.includes("born") || type.includes("mat")) return "birth";
  if (type.includes("build") || type.includes("home") || type.includes("shelter")) return "build";
  if (type.includes("death") || type.includes("died") || type.includes("decay")
    || type.includes("collapse")) return "death";
  if (type.includes("attack") || type.includes("combat") || type.includes("strike")
    || type.includes("theft") || type.includes("thieve")) return "combat";
  if (type.includes("gather") || type.includes("resource")) return "gather";
  if (type.includes("move") || type.includes("travel")) return "move";
  return "speech";
}
const DRAW_SAMPLE_COUNT = 120;
/**
 * How long the journey to a past Chronicle moment takes.
 *
 * The same order as the world-sheet descent, and for the same reason recorded there: a place you
 * FALL toward reads as somewhere you went, while a cut reads as the view breaking. `Camera2D`
 * arrives instantly when this is zero, which is what reduced motion passes.
 */
const MOMENT_TRAVEL_MS = 520;

/**
 * How long a parked journey waits for its region to arrive before giving up.
 *
 * Long enough for a cold atlas load on a slow machine; short enough that a viewer who has moved on
 * is never hijacked by a journey they had forgotten asking for.
 */
const MOMENT_TRAVEL_ARRIVAL_MS = 8_000;

const DIAGNOSTICS_INTERVAL_MS = 500;
const MAX_STATIC_ART_DIAGNOSTICS = 16;
const POST_COMMIT_RETRY_MS = 250;
const CONTINUATION_PATTERN_TILES = 8;
const CACHE_PREPARATION_DRAW_BUDGET = 1_536;
/** Breathing room on every side of a fitted beat frame, so nobody sits on the frame edge. */
export const BEAT_FRAME_PADDING_PX = TILE_SIZE * 2;
/**
 * Extra room above a fitted beat frame. The legibility grammar lifts every bubble, mark and
 * burst above its anchor's head, so a frame fitted to bodies alone clips the exact chrome the
 * framing exists to make readable.
 */
export const BEAT_FRAME_HEADROOM_PX = TILE_SIZE * 3;
/**
 * The zoom a beat frame must still reach after taking every participant in.
 *
 * This IS the legibility grammar's own text threshold, imported rather than restated. Below it
 * every bubble collapses to its glyph stud (`bubbleScale(zoom) = clamp(round(zoom), 1, 4)`, so
 * `TEXT_ZOOM_THRESHOLD` is the 1x->2x step and the first zoom at which the authored 5x8 type is
 * blitted at all), at which point co-framing has bought nothing: both beings are on screen and
 * neither one's mark can be read. Participants are therefore admitted only while the frame stays
 * at or above this, which is what stops one bystander -- or a genuinely distant second party --
 * from collapsing the shot to a world view.
 *
 * **It used to be a hand-written `1`**, with a docstring claiming the grammar dropped to studs
 * "below roughly 1:1". It drops at 1.5. Measured live, the beat frame therefore settled at 1.235
 * -- inside the band where, by the grammar's own rule, nothing it was framing could be read.
 * Two constants that must agree now cannot drift: there is one.
 */
export const BEAT_FRAME_MIN_LEGIBLE_ZOOM = TEXT_ZOOM_THRESHOLD;

/**
 * `selectAt`'s pick tolerance, in WORLD px -- deliberately NOT a CSS-px constant divided by zoom.
 *
 * A CSS-px tolerance converted to world space via `/ zoom` means something different at every
 * zoom: at world/sheet zoom (well below 1) a 44 CSS-px tolerance becomes hundreds of world px,
 * wide enough that a click on open sea can resolve to a being on the far side of the observed
 * region. A constant expressed directly in world units means the same physical distance at every
 * zoom instead. The value reproduces the pre-existing feel at zoom 1 (a typical in-region view),
 * where `44 / 1 === 44` -- the same number the old CSS-px constant produced there.
 */
const SELECTION_PICK_TOLERANCE_WORLD_PX = 44;

/**
 * FOR NOW: automatic framing never carries the viewer out of the region they are watching.
 *
 * Owner direction (Safi, 2026-08-27), watching the story director cut between regions on every
 * beat: *"for the automatic, can we for now establish that it is not allowed to move region but
 * stick within the region"*. Watching a PLACE is what he asked for; a director that jumps across
 * the archipelago once a beat is not framing a story, it is channel-surfing — and it is what
 * made the world feel as though it would not sit still.
 *
 * Two conditions, and the second is not a technicality:
 *
 * 1. The region authority is `visibleRegionId` — the region this renderer has actually MOUNTED.
 *    That is the same region the stage reports out through `onWorldNavigationChange` and the
 *    shell names in its chrome, so this is deliberately NOT a second notion of "current region".
 * 2. It applies only at `worldViewScope === "region"`, i.e. while the viewer is INSIDE a region.
 *    "Stick within the region" says nothing about a viewer standing above the whole archipelago
 *    on the world sheet: up there every region is on screen at once, drawn from its snapshot,
 *    and bringing the story's region up to full detail is serving them rather than dragging
 *    them. A renderer built without the world sheet (`worldSheetSnapshots` off, which is every
 *    unit harness) has no scope at all and is left exactly as it was.
 *
 * This restrains the DIRECTOR only, and only the one decision it makes here — which region to
 * bring up for a beat. Every VIEWER movement between regions runs through `beginObserveRegion`
 * instead and is untouched: the Atlas island click and the World drawer's pick, the `[`/`]`
 * keys, the world-sheet descent, a Chronicle card's `travelToMoment`, Z3's camera-driven
 * focus-follow, and a follow pursuit whose being crosses a border. Archive checkpoint travel is
 * resolved above this rule for the same reason. A beat elsewhere still reaches the viewer: the
 * Chronicle carries every region's events and always has, so nothing new has to be said.
 *
 * Flip to `false` to restore the wandering director. That is the whole lift.
 */
const STORY_FRAMING_HOLDS_THE_OBSERVED_REGION = true;

/** The later of two optional absolute deadlines. */
function maximumOrNull(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.max(left, right);
}

function staticCacheIdentityForRecipe(recipe: RegionMapRecipeV1): string {
  const profile = recipe.presentationProfile;
  return profile === undefined
    ? recipe.identityHash
    : `${profile.kind}:${profile.atlasProfileVersion}:${recipe.identityHash}:${profile.staticSceneHash}`;
}

function cloneSemanticSnapshotForAdoption(
  snapshot: ReturnType<ProductionSceneGraph["semanticSnapshot"]>,
): ReturnType<ProductionSceneGraph["semanticSnapshot"]> {
  const cloned = structuredClone(snapshot);
  if (cloned === null || typeof cloned !== "object"
    || cloned.frameIdentity === null || typeof cloned.frameIdentity !== "object"
    || !Array.isArray(cloned.subjects)
    || typeof JSON.stringify(cloned) !== "string") {
    throw new Error("Candidate semantic snapshot is malformed.");
  }
  return cloned;
}

function exactStaticScenePreparation(
  recipe: RegionMapRecipeV1,
  leases: ReadonlyMap<string, ProductionAssetLease>,
  providers: ReadonlyMap<string, ProductionStaticSceneProvider> | undefined,
  context: ProductionStaticSceneContext,
  describedTarget: ProductionStaticSceneDescriptor | null = null,
): ProductionStaticScenePreparation | null {
  const profile = recipe.presentationProfile;
  if (profile === undefined) return null;
  const provider = providers?.get(profile.kind);
  if (provider === undefined || provider.kind !== profile.kind) {
    throw new Error(`Missing exact static-scene provider for ${profile.kind}.`);
  }
  const descriptor = describedTarget
    ?? createProductionStaticSceneDescriptor(provider.describe(recipe, context));
  const expectedIdentity = staticCacheIdentityForRecipe(recipe);
  if (descriptor.cacheIdentity !== expectedIdentity) {
    throw new Error("Exact static-scene provider returned a mismatched descriptor identity.");
  }
  const preparation = provider.createPreparation(recipe, leases);
  let preparedDescriptor: ProductionStaticSceneDescriptor;
  try {
    preparedDescriptor = createProductionStaticSceneDescriptor(preparation.descriptor);
  } catch (error) {
    try {
      preparation.dispose();
    } catch {
      // Provider cleanup cannot replace the malformed descriptor failure.
    }
    throw error;
  }
  if (preparation.cacheIdentity !== expectedIdentity
    || !sameProductionStaticSceneDescriptor(descriptor, preparedDescriptor)) {
    try {
      preparation.dispose();
    } catch {
      // Provider cleanup cannot replace the descriptor mismatch.
    }
    throw new Error("Exact static-scene provider returned a mismatched preparation descriptor.");
  }
  return Object.freeze({
    cacheIdentity: preparation.cacheIdentity,
    descriptor,
    advance: preparation.advance.bind(preparation),
    dispose: preparation.dispose.bind(preparation),
  });
}

/** Create the production Canvas2D observer renderer. */
export async function createCanvasPresentationRenderer(
  options: CanvasPresentationRendererOptions,
): Promise<ObserverRendererPort> {
  if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  const canvas = options.canvas;
  const surfaceLease = claimObserverRendererSurface(canvas, "canvas-production");
  const context = canvas.getContext("2d");
  if (context === null) {
    surfaceLease.release();
    throw new Error("Canvas2D is unavailable.");
  }
  context.imageSmoothingEnabled = false;

  const callbacks = options.callbacks;
  const semanticPublisher = createRendererSemanticPublisher({
    onSnapshot: (snapshot) => {
      try {
        callbacks.onSemanticSnapshot?.(snapshot);
      } catch {
        // Observer callbacks cannot interrupt graph/camera/frame acceptance commits.
      }
    },
    now: () => {
      try {
        return frameDriver.now();
      } catch {
        return 0;
      }
    },
  });
  const manifest = options.manifest;
  const recipes = normalizeRecipes(options.recipes);
  const initialPlacementSourceIdentity = placementSourceIdentity(options.placement);
  const initialRecipeIdentities = [...recipes.entries()];
  const frameDriver = options.frameDriver ?? browserFrameDriver();
  const wakeScheduler = options.wakeScheduler ?? browserWakeScheduler();
  const atlasCommitScheduler = options.atlasCommitScheduler ?? browserAtlasCommitScheduler();
  const measurementNow = options.measurementNow ?? (() => performance.now());
  const visibilityTarget = options.visibilityTarget ?? document;
  const resolveSceneCommands = options.resolveSceneCommands
    ?? createProductionSceneCommandResolver({
      getPlacement: () => options.placement.snapshot(),
      getNavigationGrid: (regionId) => options.placement.navigationGridFor(regionId),
    });
  const pool = options.atlasPool ?? createSharedAtlasPool({ manifest });
  const ownsPool = options.atlasPool === undefined;
  const worldSheetSnapshotsEnabled = options.worldSheetSnapshots ?? false;
  let atlasLeases = new Map<string, ProductionAssetLease>();
  const graphOptions = (
    leaseSource: ReadonlyMap<string, ProductionAssetLease> = atlasLeases,
  ): ProductionSceneGraphOptions => ({
    manifest,
    factories: options.factories,
    placement: options.placement,
    recipes,
    atlasLeases: leaseSource,
    acquireAtlasLeases: (ids = leaseSource.keys()) => retainLeases(
      pool,
      [...ids].filter((id) => leaseSource.has(id)),
    ),
    reducedMotion: options.reducedMotion ?? false,
    spatialBinding: Object.freeze({
      placementRebound: placementSourceIdentity(options.placement)
        !== initialPlacementSourceIdentity,
      recipesRebound: recipeIdentitiesChanged(recipes, initialRecipeIdentities),
    }),
  });
  const createGraph = (
    leaseSource: ReadonlyMap<string, ProductionAssetLease> = atlasLeases,
  ): ProductionSceneGraph => options.sceneGraphFactory === undefined
    ? createProductionSceneGraph(graphOptions(leaseSource))
    : options.sceneGraphFactory(graphOptions(leaseSource));
  let graph: ProductionSceneGraph;
  try {
    graph = createGraph();
  } catch (error) {
    surfaceLease.release();
    throw error;
  }
  const camera = createCamera({
    width: Math.max(1, canvas.width),
    height: Math.max(1, canvas.height),
    reducedMotion: options.reducedMotion ?? false,
  });

  let disposed = false;
  let hidden = visibilityTarget.hidden;
  let scheduleEpoch = 0;
  let loadEpoch = 0;
  let rafOwner: { handle: number; epoch: number } | null = null;
  let wakeOwner: {
    handle: number;
    epoch: number;
    atMs: number;
    reason: "graph-deadline" | "post-commit-retry";
  } | null = null;
  let dirty = false;
  let lastDrawAt: number | null = null;
  let acceptedIdentity: FrameIdentity | null = null;
  let acceptedFrame: PresentedObserverFrame | null = null;
  let acceptedBatch: ProductionSceneCommandBatch | null = null;
  let arrivalContinuity: ArrivalContinuity | null = null;
  const pendingArrivalCommits: PendingArrivalCommit[] = [];
  let visibleRegionId: string | null = null;
  // Sheet-view focus: which region the observer camera is clamping to at/above the world/region
  // threshold, derived each draw from the camera centre (see `syncRegionSheet`). Persists across
  // frames so a centre that lands in a gutter (or briefly outside every rect) keeps the last
  // resolved focus rather than losing it.
  let focusedRegionId: string | null = null;
  // Z3 world-sheet LOD: which region's rect the camera centre geometrically sits over each draw,
  // in the SAME local frame as `activeSheetLocalRects` below (`null` in the gutter or before a
  // sheet exists). Distinct from `focusedRegionId`, which additionally sticks to the previous
  // focus while the centre is in the gutter -- the hysteresis resolver needs the raw geometric
  // answer (including `null`) so a gutter frame clears an in-progress dwell instead of extending
  // it toward whatever region happened to be focused a moment ago.
  let focusFollowState: FocusFollowState = createFocusFollowState();
  // Every other region's plot rect translated into the observed region's own local coordinate
  // frame (same frame as `worldBounds`/terrain/entities), refreshed each `syncRegionSheet()` call;
  // `null` whenever no sheet is active (single-region fallback, matching `camera.setRegionSheet`).
  let activeSheetLocalRects: Readonly<Record<string, Rect>> | null = null;
  let activeSheetLocalBounds: Readonly<Rect> | null = null;
  // The world/region zoom threshold for the CURRENT sheet (Z2's `deriveSheetZoomBounds`,
  // re-derived every `syncRegionSheet()` call). Used to gate archipelago clipping of the FOCUSED
  // region's own live terrain: below threshold (the world-map view) its terrain is clipped to its
  // island silhouette like every other plot; at/above threshold (in-region play) it draws
  // unclipped exactly as before this task, so normal gameplay at full zoom is never affected by
  // the coastline being inset from the plot's own rect. `null` whenever no sheet is active.
  let activeSheetLodSnapshotZoom: number | null = null;
  /**
   * The sheet clamp installed on the camera this frame, in the observed region's local frame.
   *
   * Kept because the RASTER has to be clamped to the same rect the camera's centre is (see
   * `boundedRasterOrigin`'s `clampRect`), and unlike `activeSheetLocalRects` it is maintained
   * whether or not the Z3 world-sheet LOD is enabled -- the camera's sheet clamp is.
   */
  let activeCameraSheet: CameraRegionSheet | null = null;
  // -------------------------------------------------- world-view navigation (the place latch)
  // Which regime the viewer is in. `null` until the first sheet is installed, then a STATE the
  // viewer owns: no zoom value flips it, which is what stops "zoomed out a notch too far" from
  // ejecting someone who is inspecting a region. See `world/worldNavigation.ts`.
  let worldViewScope: WorldViewScope | null = null;
  // Which region's local coordinate frame the camera centre is currently expressed in. The camera
  // works in the OBSERVED region's frame, so when that changes the same world point acquires new
  // local coordinates -- without re-basing, every region switch silently teleports the view.
  let sheetOriginRegionId: string | null = null;
  /** The island under the pointer at world zoom (`null` at region scope or over open sea). */
  let hoveredRegionId: string | null = null;
  /** An in-flight descent: which region, and when the flight lands (the moment the scope latches). */
  let pendingDescent: Readonly<{ regionId: string; arrivesAtMs: number }> | null = null;
  /**
   * When an in-flight ASCENT lands. The zoom-in latch has to stand down until then: an ascent
   * *starts* at a zoom above the region's cover zoom and eases down through it, so a latch that
   * only looked at the zoom value would re-enter the region on the first frame of the retreat and
   * make "back to world" impossible. Measured live before this guard existed.
   */
  let ascentLandsAtMs: number | null = null;
  /** Zoom-out step-out detent state (see `resolveZoomOutDetent`). */
  let zoomOutDetent: ZoomOutDetentState = createZoomOutDetentState();
  /** Whether the step-out affordance is currently offered. */
  let exitOffered = false;
  /**
   * When the last viewer zoom event arrived, so a continuous gesture can be told from a new one.
   *
   * A trackpad pinch is a stream of dozens of wheel events. The gesture that trips the step-out
   * detent therefore keeps firing for a few hundred ms AFTER the ascent has launched, and since a
   * viewer zoom deliberately cancels a flight, the tail of that same gesture used to abort the
   * retreat it had just requested (measured live: the ascent stopped at 0.29 instead of the sheet
   * fit). One gesture is one intent, so the tail is ignored while a flight is in the air; a
   * genuinely NEW gesture still wins.
   */
  let lastViewerZoomAtMs: number | null = null;
  /** The last published navigation state, for change detection. */
  let publishedNavigation: WorldNavigationState | null = null;
  // ---------------------------------------------------------------- the atlas (world-map view)
  // One region's island: its rasterised silhouette plus everything derived from it that is
  // position-independent, so nothing here is invalidated by the packing pass moving plots around.
  // Keyed by a signature over (extent, kit, fill, cape directions) -- the same inputs the mask is
  // generated from, so a region that grows rebuilds and one that merely moves does not.
  interface AtlasIsland {
    readonly signature: string;
    readonly kit: string;
    readonly mask: IslandMask;
    /** Where the region's own rendered content is projected at map zoom, in plot-local pixels: a
     * uniformly scaled box fitted to the mask's LAND, not to its bounding box, so the plot's own
     * margins land on land instead of in the sea the coastline carved (see `world/islandMask.ts`'s
     * `islandMapFit` and `world/atlasSymbolLayer.ts`). */
    readonly mapFit: MaskRect;
    readonly contour: ReadonlyArray<readonly IslandPoint[]>;
    /** Plot-local coast points, stride 2 -- what a bridge anchors to. */
    readonly coast: readonly IslandPoint[];
    /** Plot-local coast points, stride 6 -- what the layout's land-gap packing pass measures. */
    readonly coarseCoast: readonly IslandPoint[];
    readonly boulders: readonly CoastalBoulder[];
  }
  const atlasIslands = new Map<string, AtlasIsland>();
  /** Per-island raster layers (shadow/water/dressing). Rebuilt only when the mask, the region's
   * vitality bucket, or the time-of-day bucket moves -- never per frame. */
  const atlasLayers = new Map<string, Readonly<{ key: string; layers: IslandLayers }>>();
  /** Where each region's scenery sprites landed in its own scenery canvas, recorded while that
   * canvas was rasterised -- the source rectangles the map-symbol layer copies from. */
  const atlasSymbolRects = new Map<string, MapSymbolRect[]>();
  /** Per-region map insets, built once from the region's own rasterised canvases and keyed by the
   * island signature they were projected into. Bounded by the region count: one entry per region,
   * dropped with its island when the region leaves the world. */
  const atlasSymbolLayers = new Map<
    string,
    Readonly<{ signature: string; layer: MapSymbolLayer | null }>
  >();
  /** The packed archipelago layout, memoized on its own inputs (extents + adjacency + fills). */
  let atlasLayout: Readonly<{ signature: string; sheet: RegionSheet }> | null = null;
  /** The current frame's resolved time-of-day light (see `world/atlasLight.ts`). */
  let atlasLight: AtlasLight = resolveAtlasLight(0.5);
  /** The live event beat, if one is playing: which region, which hue, and when it started. */
  let atlasPulse: Readonly<{ momentId: string; regionId: string; kind: string; startedAtMs: number }> | null = null;
  // Bounded per-region offscreen bitmap cache for non-focused regions' terrain+scenery+homes
  // (Task Z3). Evicted bitmaps' backing canvases are disposed via `disposeSnapshotOwner` so the
  // cache never leaks canvas backing stores across a region hand-off or LRU eviction.
  const snapshotOwners = new Map<string, CacheCanvasOwner>();
  const disposeSnapshotOwner = (regionId: string, _bitmap: RegionSnapshotBitmap): void => {
    const owner = snapshotOwners.get(regionId);
    if (owner === undefined) return;
    snapshotOwners.delete(regionId);
    try {
      owner.dispose();
    } catch {
      // A snapshot-canvas cleanup fault cannot interrupt the live draw loop.
    }
  };
  const snapshotCache: RegionSnapshotCache = createRegionSnapshotCache(
    undefined,
    (regionId, bitmap) => disposeSnapshotOwner(regionId, bitmap),
  );
  const backgroundSnapshotBuilds = new Map<string, BackgroundSnapshotBuild>();
  let loading: AtlasGeneration | null = null;
  let pendingAtlasCommit: PendingAtlasCommit | null = null;
  let cache: CachePair | null = null;
  /** How many times the region's static terrain/scenery cache has been rebuilt this session. */
  let staticLayerRebuilds = 0;
  let cacheOwnersCreated = 0;
  let cacheOwnersDisposed = 0;
  let peakCacheOwners = 0;
  /**
   * Cache canvases whose backing store the browser has thrown away.
   *
   * A static-layer cache is rasterised ONCE and thereafter only blitted, so it is the one surface
   * in this renderer that never repaints itself. When the compositor drops a 2D canvas' backing
   * store -- which Chrome does under canvas-memory pressure, and after a GPU process restart --
   * the canvas comes back the right SIZE and completely EMPTY. `drawImage` of an empty canvas
   * neither throws nor draws, so without this the region's terrain and scenery silently vanish for
   * the rest of the session while the beings, homes and event feed carry on drawing normally.
   * Membership is permanent per canvas: a rebuild allocates fresh canvases, so an entry here can
   * only ever describe a surface we are about to retire.
   */
  const cacheCanvasesWithLostPixels = new WeakSet<HTMLCanvasElement>();
  /** How many times a lost static-cache backing store has been rebuilt this session. */
  let staticCachePixelLossRecoveries = 0;
  let lastCacheRebuildReason: CanvasPresentationRendererDebug["cache"]["lastRebuildReason"] = null;
  const staticArtFallbackKeys = new Set<string>();
  let selection: ObserverSelection = null;
  let selectionOwnedByInteraction = false;
  let storyFocusSelection: Exclude<ObserverSelection, null> | null = null;
  let storyFocusOwnedByInteraction = false;
  let cameraTargetIds = new Set<string>();
  let safeFrameInsets: SafeFrameInsets = { ...EMPTY_SAFE_FRAME };
  const drawDurations = new Float64Array(DRAW_SAMPLE_COUNT);
  let drawDurationCount = 0;
  let drawDurationTotalCount = 0;
  let drawDurationCursor = 0;
  let lastDiagnosticsAtMs = Number.NEGATIVE_INFINITY;
  let lastSceneSignalSerial = 0;
  let cameraImpulse: CameraImpulseState | null = null;
  let checkpointCameraOwnership: CheckpointCameraOwnership | null = null;
  /**
   * THE ARBITER. `true` once the viewer has taken framing authority (pan, zoom, or choosing
   * Follow/Free); every automatic framing path in this renderer is refused while it holds, and
   * only an explicit release (`setCameraMode("story")`, i.e. the S key / Story button / the
   * stage's "Resume story framing" affordance) clears it. Mirrored onto `Camera2D` via
   * `setViewerControl` so the camera's own internal re-framing is gated by the same bit.
   */
  let viewerControlsCamera = false;
  /** Why the beat director last declined to frame -- diagnostics only, never behaviour. */
  let beatFramingSkip: string | null = "no-frame";
  /**
   * A journey to a past moment that is waiting for its region to arrive.
   *
   * Travel cannot frame what is not mounted: the anchor's bounds come from the scene graph, and
   * the graph only holds the region on screen. So a cross-region journey starts the region load
   * and parks here; every draw retries, and the deadline gives up quietly rather than leaving a
   * stale journey armed to hijack the camera minutes later.
   */
  let pendingMomentTravel: Readonly<{ anchor: MomentAnchor; deadlineMs: number }> | null = null;
  /** The beat currently framed by the director, and the overlay clock its hold is bound to. */
  let beatFraming: Readonly<{
    momentId: string;
    /** Union of every participant's bounds so far this beat -- grows, never shrinks. */
    union: Rect;
    primaryKey: string | null;
    /** Absolute time the beat's chrome expires; `null` until an overlay has been emitted. */
    holdUntilMs: number | null;
  }> | null = null;
  let renderRasterOrigin: Vec2 | null = null;
  let renderZoom: number | null = null;
  let activeCanvasSceneToken = -1;
  let pendingFrameAcceptance: PresentedObserverFrame | null = null;
  let pendingCameraAdoption: PresentedObserverFrame | null = null;
  let pendingSceneCommandCommit: Readonly<{
    frame: PresentedObserverFrame;
    batch: ProductionSceneCommandBatch;
    commandResult: ProductionSceneFrameResult["commands"];
    committedAtMs: number;
  }> | null = null;
  let pendingSemanticPublication = false;
  let pendingSemanticSnapshot: ReturnType<ProductionSceneGraph["semanticSnapshot"]> | null = null;
  let lastInternalFailure: CanvasPresentationRendererDebug["lastInternalFailure"] = null;
  const reportedOptionalVisualFailures = new Set<string>();

  const pruneRetiredArrivalCommits = (): void => {
    for (let index = pendingArrivalCommits.length - 1; index >= 0; index -= 1) {
      if (!recipes.has(pendingArrivalCommits[index]!.continuity.toRegion)) {
        pendingArrivalCommits.splice(index, 1);
      }
    }
  };

  const pendingArrivalFor = (
    frame: PresentedObserverFrame,
  ): PendingArrivalCommit | null => {
    pruneRetiredArrivalCommits();
    let candidate: PendingArrivalCommit | null = null;
    for (const pending of pendingArrivalCommits) {
      if (sameLineage(frame, pending.frame)
        && (sameIdentity(frame, pending.frame) || isFresherFrame(frame, pending.frame))) {
        if (candidate === null || isFresherFrame(pending.frame, candidate.frame)) {
          candidate = pending;
        }
      }
    }
    return candidate;
  };

  const pendingArrivalHighWater = (frame: PresentedObserverFrame): PendingArrivalCommit | null => {
    pruneRetiredArrivalCommits();
    let candidate: PendingArrivalCommit | null = null;
    for (const pending of pendingArrivalCommits) {
      if (sameLineage(frame, pending.frame)
        && (candidate === null || isFresherFrame(pending.frame, candidate.frame))) {
        candidate = pending;
      }
    }
    return candidate;
  };

  const restorePendingArrivalContinuity = (frame: PresentedObserverFrame): void => {
    const pending = pendingArrivalFor(frame);
    if (pending === null) return;
    const current = arrivalContinuity;
    const currentIsAtLeastPending = current !== null
      && current.runId === pending.continuity.runId
      && current.sourceKey === pending.continuity.sourceKey
      && (current.sceneToken > pending.continuity.sceneToken
        || (current.sceneToken === pending.continuity.sceneToken
          && current.momentId === pending.continuity.momentId
          && current.programId === pending.continuity.programId
          && current.actorId === pending.continuity.actorId
          && current.fromRegion === pending.continuity.fromRegion
          && current.toRegion === pending.continuity.toRegion
          && current.leg === pending.continuity.leg
          && travelPhaseOrder(current.phase) >= travelPhaseOrder(pending.continuity.phase)));
    if (!currentIsAtLeastPending) arrivalContinuity = { ...pending.continuity };
  };

  const rememberPendingArrivalCommit = (
    frame: PresentedObserverFrame,
    batch: ProductionSceneCommandBatch | null,
  ): void => {
    const continuity = arrivalContinuity;
    if (!isTransactionCriticalArrival(frame, batch) || batch === null
      || continuity === null || continuity.leg !== "arrival"
      || continuity.phase !== "consequence"
      || continuity.runId !== frame.runId || continuity.sourceKey !== frame.sourceKey
      || continuity.sceneToken !== batch.sceneToken
      || !recipes.has(continuity.toRegion)) return;
    const duplicateIndex = pendingArrivalCommits.findIndex(
      ({ frame: pendingFrame }) => sameIdentity(pendingFrame, frame),
    );
    if (duplicateIndex >= 0) pendingArrivalCommits.splice(duplicateIndex, 1);
    pendingArrivalCommits.push({
      frame: structuredClone(frame),
      batch: structuredClone(batch),
      continuity: { ...continuity },
    });
  };

  const forgetPendingArrivalCommit = (frame: PresentedObserverFrame): void => {
    const index = pendingArrivalCommits.findIndex(
      ({ frame: pendingFrame }) => sameIdentity(pendingFrame, frame),
    );
    if (index >= 0) pendingArrivalCommits.splice(index, 1);
  };

  const pendingArrivalPrerequisites = (
    frame: PresentedObserverFrame,
  ): AtlasGeneration["prerequisites"] => {
    pruneRetiredArrivalCommits();
    return pendingArrivalCommits
      .filter((pending) => sameLineage(frame, pending.frame)
        && (sameIdentity(frame, pending.frame) || isFresherFrame(frame, pending.frame)))
      .sort((left, right) => left.frame.revision - right.frame.revision
        || left.frame.firstCursor - right.frame.firstCursor
        || left.frame.lastCursor - right.frame.lastCursor)
      .map(({ frame: pendingFrame, batch }) => ({ frame: pendingFrame, batch }));
  };

  const resolveFrameCommands = (
    frame: PresentedObserverFrame,
  ): ProductionSceneCommandBatch | null => {
    const batch = resolveSceneCommands(frame);
    arrivalContinuity = reconcileArrivalContinuity(arrivalContinuity, frame, batch, recipes);
    return batch;
  };

  const emitFailure = (failure: ObserverRendererFailure): void => {
    if (disposed) return;
    try {
      callbacks.onFailure?.(failure);
    } catch {
      // Observer callbacks cannot mutate renderer ownership or frame acceptance.
    }
  };

  const flushPostCommitPublications = (): void => {
    if (disposed) return;
    if (pendingCameraAdoption !== null) {
      if (!adoptCommittedCamera(pendingCameraAdoption)) return;
      pendingCameraAdoption = null;
    }
    if (pendingSceneCommandCommit !== null) {
      const commandCommit = pendingSceneCommandCommit;
      pendingSceneCommandCommit = null;
      commitResolvedSceneCommands(
        commandCommit.frame,
        commandCommit.batch,
        commandCommit.commandResult,
        commandCommit.committedAtMs,
      );
      if (disposed || acceptedFrame === null
        || !sameIdentity(acceptedFrame, commandCommit.frame)) return;
    }
    if (pendingSemanticPublication) {
      const semanticIdentity = acceptedIdentity;
      let semanticSnapshot = pendingSemanticSnapshot;
      pendingSemanticPublication = false;
      pendingSemanticSnapshot = null;
      try {
        semanticSnapshot ??= graph.semanticSnapshot();
        semanticPublisher.accept(semanticSnapshot);
      } catch {
        if (!disposed && acceptedIdentity !== null && semanticIdentity !== null
          && sameIdentity(acceptedIdentity, semanticIdentity)) {
          pendingSemanticPublication = true;
          pendingSemanticSnapshot = semanticSnapshot;
        }
        emitFailure({
          kind: "canvas",
          retryable: true,
          publicMessage: "The committed semantic view will be retried.",
        });
      }
      if (semanticSnapshot !== null && (
        disposed || acceptedIdentity === null
        || !sameIdentity(acceptedIdentity, semanticSnapshot.frameIdentity)
      )) return;
      if (disposed || semanticIdentity === null || acceptedIdentity === null
        || !sameIdentity(acceptedIdentity, semanticIdentity)) return;
    }
    if (pendingFrameAcceptance !== null && !pendingSemanticPublication) {
      const frameToAccept = pendingFrameAcceptance;
      pendingFrameAcceptance = null;
      try {
        options.frameAcceptance?.markAccepted(frameToAccept);
      } catch {
        if (!disposed && acceptedFrame !== null && sameIdentity(acceptedFrame, frameToAccept)) {
          pendingFrameAcceptance = frameToAccept;
        }
        emitFailure({
          kind: "canvas",
          retryable: true,
          publicMessage: "The committed frame receipt will be retried.",
        });
      }
    }
  };

  const diagnostics = (): ObserverRendererDiagnostics => {
    const graphSnapshot = graph.debugSnapshot();
    const poolSnapshot = pool.diagnostics();
    const sorted = Array.from(drawDurations.subarray(0, drawDurationCount))
      .sort((left, right) => left - right);
    const p95 = sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]!;
    return {
      disposed,
      frameIdentity: acceptedIdentity === null ? null : { ...acceptedIdentity },
      drawP95Ms: p95,
      scheduledFrame: rafOwner !== null,
      activeActors: graphSnapshot.actors.length,
      activeHomes: graphSnapshot.homes.length,
      activeEffects: activeGraphEffects(graphSnapshot),
      staticLayerRebuilds,
      assetBytes: poolSnapshot.compressedBytes,
      decodedAssetBytes: poolSnapshot.decodedBytes,
      pathFallbacks: graphSnapshot.pathFallbacks,
    };
  };

  const emitDiagnostics = (force = false): void => {
    if (disposed || callbacks.onDiagnostics === undefined
      || options.diagnosticsEnabled?.() === false) return;
    const nowMs = frameDriver.now();
    if (!force && nowMs - lastDiagnosticsAtMs < DIAGNOSTICS_INTERVAL_MS) return;
    lastDiagnosticsAtMs = nowMs;
    callbacks.onDiagnostics(diagnostics());
  };

  const cancelSchedules = (): void => {
    scheduleEpoch += 1;
    if (rafOwner !== null) frameDriver.cancel(rafOwner.handle);
    if (wakeOwner !== null) wakeScheduler.cancel(wakeOwner.handle);
    rafOwner = null;
    wakeOwner = null;
  };

  const scheduleFrame = (): void => {
    if (disposed || hidden || rafOwner !== null) return;
    if (wakeOwner !== null) {
      wakeScheduler.cancel(wakeOwner.handle);
      wakeOwner = null;
    }
    const owner = { handle: -1, epoch: scheduleEpoch };
    rafOwner = owner;
    try {
      owner.handle = frameDriver.request((nowMs) => {
        if (rafOwner !== owner) return;
        rafOwner = null;
        if (disposed || hidden || owner.epoch !== scheduleEpoch) return;
        draw(nowMs);
      });
    } catch {
      rafOwner = null;
      emitFailure({
        kind: "canvas",
        retryable: true,
        publicMessage: "The committed world view is waiting to be drawn.",
      });
    }
  };

  const scheduleWake = (
    atMs: number,
    reason: "graph-deadline" | "post-commit-retry",
    allowReducedMotion = false,
  ): void => {
    if (disposed || hidden || (!allowReducedMotion && options.reducedMotion)
      || wakeOwner !== null || rafOwner !== null) return;
    const owner = { handle: -1, epoch: scheduleEpoch, atMs, reason };
    wakeOwner = owner;
    owner.handle = wakeScheduler.schedule(atMs, () => {
      if (wakeOwner !== owner) return;
      wakeOwner = null;
      if (disposed || hidden || owner.epoch !== scheduleEpoch) return;
      dirty = true;
      scheduleFrame();
      emitDiagnostics();
    });
  };

  const describeStaticSceneTarget = (
    regionId: string,
    frame: PresentedObserverFrame,
  ): StaticSceneLoadTarget => {
    const recipe = recipes.get(regionId);
    if (recipe === undefined) throw new Error(`Missing map recipe for ${regionId}.`);
    const profile = recipe.presentationProfile;
    let descriptor: ProductionStaticSceneDescriptor;
    if (profile === undefined) {
      descriptor = createProductionStaticSceneDescriptor({
        cacheIdentity: recipe.identityHash,
        worldBounds: {
          x: 0,
          y: 0,
          width: recipe.grid.columns * TILE_SIZE,
          height: recipe.grid.rows * TILE_SIZE,
        },
        topology: "bounded",
      });
    } else {
      const provider = options.staticSceneProviders?.get(profile.kind);
      if (provider === undefined || provider.kind !== profile.kind) {
        throw new Error(`Missing exact static-scene provider for ${profile.kind}.`);
      }
      descriptor = createProductionStaticSceneDescriptor(provider.describe(recipe, {
        frame,
        priorDescriptor: cache?.descriptor ?? null,
      }));
      if (descriptor.cacheIdentity !== staticCacheIdentityForRecipe(recipe)) {
        throw new Error("Exact static-scene provider returned a mismatched descriptor identity.");
      }
    }
    return Object.freeze({
      recipe,
      descriptor,
      atlasIds: productionAtlasIdsForRegion(manifest, recipe),
    });
  };

  const createCachePreparation = (
    regionId: string,
    leases: ReadonlyMap<string, ProductionAssetLease>,
    frame: PresentedObserverFrame,
    staticTarget: StaticSceneLoadTarget | null = null,
    /**
     * Overrides `options.cacheCanvasFactory` for this preparation only. Used exclusively by Z3's
     * background snapshot builder (`advanceBackgroundSnapshotBuild`) so a caller-supplied
     * `cacheCanvasFactory` -- a DI seam callers use to observe/mock the FOCUSED region's own cache
     * lifecycle -- does not also observe every non-focused region's background builds, which are
     * an independent concern with their own accounting. `undefined` (every other call site,
     * unchanged) preserves the pre-existing `options.cacheCanvasFactory ?? default` behavior
     * exactly.
     */
    ownerFactoryOverride: CacheCanvasOwnerFactory | undefined = undefined,
  ): CachePreparation => {
    const target = staticTarget ?? describeStaticSceneTarget(regionId, frame);
    if (target.recipe.regionId !== regionId) {
      throw new Error(`Static-scene target does not belong to ${regionId}.`);
    }
    const recipe = target.recipe;
    // Atlas map symbols: record where each scenery sprite lands in the region's own scenery
    // canvas, so the world view can copy those sprites back out enlarged (see
    // `world/atlasSymbolLayer.ts`). Pure bookkeeping -- it changes no draw, and reads nothing from
    // the recipe that the draw itself does not already read.
    const symbolRects: MapSymbolRect[] = [];
    atlasSymbolRects.set(regionId, symbolRects);
    atlasSymbolLayers.delete(regionId);
    const exactPreparation = exactStaticScenePreparation(
      recipe,
      leases,
      options.staticSceneProviders,
      {
        frame,
        priorDescriptor: cache?.descriptor ?? null,
      },
      target.descriptor,
    );
    const descriptor = exactPreparation?.descriptor ?? target.descriptor;
    if (!sameProductionStaticSceneDescriptor(descriptor, target.descriptor)) {
      try {
        exactPreparation?.dispose();
      } catch {
        // Provider cleanup cannot replace a load-target descriptor mismatch.
      }
      throw new Error("Static-scene preparation no longer matches its load target.");
    }
    const pack = manifest.regions[recipe.kit];
    const createOwner = ownerFactoryOverride ?? options.cacheCanvasFactory ?? ((input) => createCacheCanvasOwner({
      ...input,
      createCanvas: () => canvas.ownerDocument.createElement("canvas"),
    }));
    const dimensions = {
      width: descriptor.worldBounds.width,
      height: descriptor.worldBounds.height,
    };
    const createTrackedOwner = (
      label: "terrain" | "scenery" | "continuation-matte",
      width: number,
      height: number,
    ): CacheCanvasOwner => {
      const owner = createOwner({ label, width, height });
      cacheOwnersCreated += 1;
      peakCacheOwners = Math.max(peakCacheOwners, cacheOwnersCreated - cacheOwnersDisposed);
      return watchCacheCanvasPixels(owner);
    };
    const createdOwners: CacheCanvasOwner[] = [];
    let terrain: CacheCanvasOwner;
    let scenery: CacheCanvasOwner;
    let continuationMatte: CacheCanvasOwner;
    try {
      terrain = createTrackedOwner("terrain", dimensions.width, dimensions.height);
      createdOwners.push(terrain);
      scenery = createTrackedOwner("scenery", dimensions.width, dimensions.height);
      createdOwners.push(scenery);
      continuationMatte = createTrackedOwner(
        "continuation-matte",
        CONTINUATION_PATTERN_TILES * TILE_SIZE,
        CONTINUATION_PATTERN_TILES * TILE_SIZE,
      );
      createdOwners.push(continuationMatte);
    } catch (error) {
      try {
        exactPreparation?.dispose();
      } catch {
        // Provider cleanup cannot replace the cache-owner allocation failure.
      }
      for (const owner of createdOwners) disposeCacheOwner(owner);
      throw error;
    }
    const ownedScenery = scenery;
    const ownedContinuationMatte = continuationMatte;
    if (exactPreparation !== null) {
      const cacheIdentity = exactPreparation.cacheIdentity;
      let transferred = false;
      let preparationDisposed = false;
      let providerDisposeAttempted = false;
      const disposeProviderOnce = (): void => {
        if (providerDisposeAttempted) return;
        providerDisposeAttempted = true;
        exactPreparation.dispose();
      };
      const disposePreparation = (): void => {
        if (preparationDisposed || transferred) return;
        preparationDisposed = true;
        try {
          disposeProviderOnce();
        } finally {
          disposeCacheOwner(terrain);
          disposeCacheOwner(ownedScenery);
          disposeCacheOwner(ownedContinuationMatte);
        }
      };
      return {
        descriptor,
        advance(maxWorkUnits): CachePair | null {
          if (!Number.isSafeInteger(maxWorkUnits) || maxWorkUnits <= 0) {
            throw new Error("Cache preparation requires a positive safe draw budget.");
          }
          if (preparationDisposed) throw new Error("Cache preparation is disposed.");
          if (transferred) throw new Error("Cache preparation is already complete.");
          try {
            let visited = 0;
            const result = exactPreparation.advance(maxWorkUnits, (operation) => {
              visited += 1;
              if (visited > maxWorkUnits) {
                throw new Error("Exact static-scene provider exceeded its work budget.");
              }
              const lease = leases.get(operation.atlasId);
              if (lease === undefined) {
                throw new Error(`Missing exact static-scene atlas ${operation.atlasId}.`);
              }
              const destination = operation.layer === "terrain"
                ? terrain.context
                : operation.layer === "scenery"
                  ? ownedScenery.context
                  : ownedContinuationMatte.context;
              if (operation.layer === "scenery") {
                symbolRects.push({
                  x: Math.round(operation.destination.x - descriptor.worldBounds.x),
                  y: Math.round(operation.destination.y - descriptor.worldBounds.y),
                  width: operation.destination.width,
                  height: operation.destination.height,
                });
              }
              drawProductionStaticSceneOperation(
                destination,
                lease.value,
                operation,
                {
                  x: descriptor.worldBounds.x,
                  y: descriptor.worldBounds.y,
                },
              );
            });
            if (typeof result.done !== "boolean"
              || !Number.isSafeInteger(result.workUnits)
              || result.workUnits < 0
              || result.workUnits > maxWorkUnits
              || result.workUnits !== visited
              || (!result.done && result.workUnits === 0)) {
              throw new Error("Exact static-scene provider returned an invalid work receipt.");
            }
            if (!result.done) return null;
            const continuationPattern = context.createPattern(
              ownedContinuationMatte.canvas,
              "repeat",
            );
            if (continuationPattern === null) {
              throw new Error("Canvas2D continuation pattern is unavailable.");
            }
            disposeProviderOnce();
            transferred = true;
            return {
              regionId,
              recipe,
              staticCacheIdentity: cacheIdentity,
              descriptor,
              continuationMatte: ownedContinuationMatte,
              continuationPattern,
              terrain,
              scenery: ownedScenery,
            };
          } catch (error) {
            disposePreparation();
            throw error;
          }
        },
        dispose: disposePreparation,
      };
    }
    const replacedClusterIds = new Set(
      recipe.scenicLandmarks.map(({ clusterId }) => clusterId),
    );
    const visibleStaticScenery = recipe.staticScenery.filter(
      ({ clusterId }) => clusterId === null || !replacedClusterIds.has(clusterId),
    );
    let stage: "terrain" | "landmarks" | "scenery" | "continuation" | "done" = "terrain";
    let terrainIndex = 0;
    let landmarkIndex = 0;
    let sceneryIndex = 0;
    let continuationIndex = 0;
    let transferred = false;
    let preparationDisposed = false;
    const recordFallback = (layer: "terrain" | "scenery"): void => {
      const decision = decideAssetFallback({
        failure: "missing-static-art",
        subjectId: layer,
        regionId,
        occurrence: 1,
      });
      if (decision.action !== "continue" || decision.fallback !== "neutral-tile") return;
      const key = `${regionId}:${layer}`;
      if (staticArtFallbackKeys.size < MAX_STATIC_ART_DIAGNOSTICS) staticArtFallbackKeys.add(key);
    };
    const disposePreparation = (): void => {
      if (preparationDisposed || transferred) return;
      preparationDisposed = true;
      disposeCacheOwner(terrain);
      disposeCacheOwner(ownedScenery);
      disposeCacheOwner(ownedContinuationMatte);
    };
    return {
      descriptor,
      advance(maxDrawOperations): CachePair | null {
        if (!Number.isSafeInteger(maxDrawOperations) || maxDrawOperations <= 0) {
          throw new Error("Cache preparation requires a positive safe draw budget.");
        }
        if (preparationDisposed) throw new Error("Cache preparation is disposed.");
        if (transferred || stage === "done") throw new Error("Cache preparation is already complete.");
        let remaining = maxDrawOperations;
        try {
          while (true) {
            if (stage === "terrain") {
              const terrainDraws = recipe.grid.columns * recipe.grid.rows;
              if (terrainIndex >= terrainDraws) {
                ownedScenery.context.clearRect(
                  0,
                  0,
                  ownedScenery.canvas.width,
                  ownedScenery.canvas.height,
                );
                stage = "landmarks";
                continue;
              }
              if (remaining === 0) return null;
              const column = terrainIndex % recipe.grid.columns;
              const row = Math.floor(terrainIndex / recipe.grid.columns);
              drawNativeFrame(
                terrain.context,
                leases,
                resolveTerrainFrame(pack, recipe, column, row),
                column * TILE_SIZE,
                row * TILE_SIZE,
                "terrain",
                recordFallback,
              );
              terrainIndex += 1;
              remaining -= 1;
              continue;
            }
            if (stage === "landmarks") {
              if (landmarkIndex >= recipe.scenicLandmarks.length) {
                stage = "scenery";
                continue;
              }
              if (remaining === 0) return null;
              const landmark = recipe.scenicLandmarks[landmarkIndex]!;
              drawScenicLandmark(
                ownedScenery.context,
                manifest,
                pack,
                recipe,
                landmark,
                leases,
              );
              const landmarkBinding = pack.landmarkFrames[landmark.semanticKind];
              if (landmarkBinding !== undefined) {
                symbolRects.push({
                  x: landmark.contactTile.column * TILE_SIZE + TILE_SIZE / 2 - landmark.contactPivotPx.x,
                  y: landmark.contactTile.row * TILE_SIZE + TILE_SIZE / 2 - landmark.contactPivotPx.y,
                  width: landmarkBinding.renderSizePx.width,
                  height: landmarkBinding.renderSizePx.height,
                });
              }
              landmarkIndex += 1;
              remaining -= 1;
              continue;
            }
            if (stage === "scenery") {
              if (sceneryIndex >= visibleStaticScenery.length) {
                stage = "continuation";
                continue;
              }
              if (remaining === 0) return null;
              const placement = visibleStaticScenery[sceneryIndex]!;
              const primaryFrame = pack.staticSceneryFrames[placement.kind];
              const variants = pack.staticSceneryVariants[placement.kind] ?? [];
              const sceneryFrame = primaryFrame === undefined
                ? undefined
                : variants[sceneryVariantIndex(
                  placement.id,
                  placement.tile.column,
                  placement.tile.row,
                  variants.length,
                )] ?? primaryFrame;
              drawNativeFrame(
                ownedScenery.context,
                leases,
                sceneryFrame,
                placement.tile.column * TILE_SIZE,
                placement.tile.row * TILE_SIZE,
                "scenery",
                recordFallback,
              );
              if (sceneryFrame !== undefined) {
                symbolRects.push({
                  x: placement.tile.column * TILE_SIZE,
                  y: placement.tile.row * TILE_SIZE,
                  width: sceneryFrame.rect.width,
                  height: sceneryFrame.rect.height,
                });
              }
              sceneryIndex += 1;
              remaining -= 1;
              continue;
            }
            if (stage === "continuation") {
              const continuationDraws = CONTINUATION_PATTERN_TILES * CONTINUATION_PATTERN_TILES;
              if (continuationIndex >= continuationDraws) {
                const continuationPattern = context.createPattern(
                  ownedContinuationMatte.canvas,
                  "repeat",
                );
                if (continuationPattern === null) {
                  throw new Error("Canvas2D continuation pattern is unavailable.");
                }
                stage = "done";
                transferred = true;
                return {
                  regionId,
                  recipe,
                  staticCacheIdentity: recipe.identityHash,
                  descriptor,
                  continuationMatte: ownedContinuationMatte,
                  continuationPattern,
                  terrain,
                  scenery: ownedScenery,
                };
              }
              if (remaining === 0) return null;
              const column = continuationIndex % CONTINUATION_PATTERN_TILES;
              const row = Math.floor(continuationIndex / CONTINUATION_PATTERN_TILES);
              const variant = terrainFrameVariantIndex("ground", 0, column, row);
              drawNativeFrame(
                ownedContinuationMatte.context,
                leases,
                pack.terrainFramesByRole.ground[variant]?.frame,
                column * TILE_SIZE,
                row * TILE_SIZE,
                "terrain",
                recordFallback,
              );
              continuationIndex += 1;
              remaining -= 1;
              continue;
            }
            throw new Error("Cache preparation is already complete.");
          }
        } catch (error) {
          disposePreparation();
          throw error;
        }
      },
      dispose: disposePreparation,
    };
  };

  const buildCache = (
    regionId: string,
    leases: ReadonlyMap<string, ProductionAssetLease>,
    frame: PresentedObserverFrame,
  ): CachePair => {
    const recipe = recipes.get(regionId);
    if (recipe === undefined) throw new Error(`Missing map recipe for ${regionId}.`);
    if (recipe.presentationProfile !== undefined) {
      throw new Error(`Exact static cache for ${regionId} requires scheduled preparation.`);
    }
    const preparation = createCachePreparation(regionId, leases, frame);
    const completed = preparation.advance(Number.MAX_SAFE_INTEGER);
    if (completed === null) {
      preparation.dispose();
      throw new Error(`Cache preparation for ${regionId} did not complete synchronously.`);
    }
    return completed;
  };

  const disposeCacheOwner = (owner: CacheCanvasOwner): void => {
    try {
      owner.dispose();
    } catch {
      // A cache-owner cleanup fault cannot unwind an accepted Graph frame.
    } finally {
      cacheOwnersDisposed += 1;
    }
  };

  const disposeOwnedCachePair = (owned: CachePair | null): void => {
    if (owned === null) return;
    disposeCacheOwner(owned.continuationMatte);
    disposeCacheOwner(owned.terrain);
    disposeCacheOwner(owned.scenery);
  };

  const replaceCache = (next: CachePair | null): void => {
    if (cache === next) return;
    const prior = cache;
    accountStaticCacheRecovery(prior, next);
    cache = next;
    disposeOwnedCachePair(prior);
  };

  /**
   * Watch one static-cache canvas for the browser throwing its backing store away.
   *
   * `contextlost` fires when the compositor drops the surface; `contextrestored` fires once a
   * usable -- and blank -- surface is back. Both are recorded, because a canvas that has been
   * through either is no longer carrying the pixels we rasterised into it, and this renderer has
   * no other way to notice: the static layers are painted once and then only read.
   *
   * @param owner - The freshly created cache-canvas owner to watch.
   * @returns An owner that behaves identically and detaches its listeners when disposed.
   * @remarks Side effects: registers DOM listeners on `owner.canvas`; on loss it records the
   *   canvas in {@link cacheCanvasesWithLostPixels} and, when the canvas belongs to the MOUNTED
   *   cache, asks {@link requestLostStaticCacheRebuild} to re-rasterise it.
   */
  const watchCacheCanvasPixels = (owner: CacheCanvasOwner): CacheCanvasOwner => {
    const { canvas } = owner;
    if (typeof canvas.addEventListener !== "function") return owner;
    const onPixelsLost = (): void => {
      cacheCanvasesWithLostPixels.add(canvas);
      requestLostStaticCacheRebuild();
    };
    canvas.addEventListener("contextlost", onPixelsLost);
    canvas.addEventListener("contextrestored", onPixelsLost);
    return {
      canvas,
      context: owner.context,
      dispose(): void {
        if (typeof canvas.removeEventListener === "function") {
          canvas.removeEventListener("contextlost", onPixelsLost);
          canvas.removeEventListener("contextrestored", onPixelsLost);
        }
        owner.dispose();
      },
    };
  };

  /** Whether any of one cache pair's canvases has had its backing store thrown away. */
  const cachePairLostPixels = (pair: CachePair | null): boolean => pair !== null && (
    cacheCanvasesWithLostPixels.has(pair.terrain.canvas)
    || cacheCanvasesWithLostPixels.has(pair.scenery.canvas)
    || cacheCanvasesWithLostPixels.has(pair.continuationMatte.canvas)
  );

  /** Whether the static cache currently being drawn from has lost any of its pixels. */
  const mountedStaticCacheLostPixels = (): boolean => cachePairLostPixels(cache);

  /**
   * Count a cache swap that retires canvases the browser had emptied.
   *
   * Recorded on the swap rather than on the request so the witness says how many times the art was
   * actually put back, never how many times a repair was merely attempted.
   *
   * @param retired - The cache pair being unmounted.
   * @param installed - The cache pair taking its place.
   */
  const accountStaticCacheRecovery = (
    retired: CachePair | null,
    installed: CachePair | null,
  ): void => {
    if (installed === null || retired === installed || !cachePairLostPixels(retired)) return;
    staticCachePixelLossRecoveries += 1;
  };

  /**
   * Re-rasterise the observed region's static layers after the browser discarded them.
   *
   * Deliberately routed through the ordinary `loadRegion` atlas-commit path rather than a bespoke
   * repair: that path already leases the atlases, drives the region's exact static-scene provider
   * within its draw budget, and swaps the cache atomically, and `prepareLoadedRegion` treats a
   * lost mounted cache as requiring preparation (which it otherwise would not, the descriptor
   * being unchanged). Suppressed while a load is already in flight -- that load will build a fresh
   * cache anyway -- so this can never become a per-frame retry loop.
   *
   * No viewer-facing failure is raised on the recoverable path, deliberately. The stage's failure
   * surface is a modal that stays up until the viewer rebuilds the whole renderer, and parking one
   * over art that is about to put itself back would cost more than the fault does; the durable
   * witness is `debug().cache.pixelLossRecoveries`/`pixelsLost`. A loss we cannot rebuild from --
   * no observed region, or no accepted frame to rebuild it at -- is a different thing, and does
   * get reported, because then the blank region really is what the viewer keeps.
   *
   * @remarks Side effects: may start a region load, or emit a retryable canvas failure.
   */
  const requestLostStaticCacheRebuild = (): void => {
    if (disposed || loading !== null || !mountedStaticCacheLostPixels()) return;
    const regionId = visibleRegionId;
    const frame = acceptedFrame;
    if (regionId === null || frame === null) {
      emitFailure({
        kind: "canvas",
        retryable: true,
        publicMessage: "The world view could not be updated.",
      });
      return;
    }
    loadRegion(frame, regionId, true, acceptedBatch, regionId);
  };

  /**
   * A region's own change-signal fingerprint for the Z3 snapshot cache: its recipe identity
   * (changes when e.g. Nirvana's toroidal growth reshapes the recipe) plus its home/ruin set
   * (id/status/integrity). Deliberately excludes agent positions, resource levels, and every
   * other per-tick field -- those are drawn as a separate live layer
   * (`drawOffRegionBeingMarks`) on top of the cached bitmap instead of invalidating it, exactly
   * per the design spec's "invalidated on that region's change signals (terrain/home/ruin
   * mutation)".
   */
  const regionSnapshotSignature = (
    regionId: string,
    recipe: RegionMapRecipeV1,
    frame: PresentedObserverFrame,
  ): string => {
    const fingerprint = (value: Readonly<Partial<HomeSnapshot>>): string | null => {
      if (value.home_id === undefined || value.region !== regionId) return null;
      return `${value.home_id}:${value.status ?? ""}:${value.integrity ?? ""}`;
    };
    const homes = frame.world.homes
      .map(({ value }) => fingerprint(value))
      .filter((entry): entry is string => entry !== null)
      .sort();
    const ruins = frame.world.ruins
      .map(({ value }) => fingerprint(value))
      .filter((entry): entry is string => entry !== null)
      .sort();
    return `${recipe.identityHash}|${homes.join(",")}|${ruins.join(",")}`;
  };

  /** Simple generic markers for a non-focused region's homes/ruins, baked into its snapshot
   * bitmap (see {@link regionSnapshotSignature}'s doc for why homes/ruins live in the bitmap
   * while beings do not). Deliberately not the full `HomeActor` visual system -- disproportionate
   * for a background LOD tier that is never viewed up close while live -- per the design spec's
   * "no new art" non-goal. */
  const drawSnapshotHomeMarkers = (
    context: CanvasRenderingContext2D,
    regionId: string,
    frame: PresentedObserverFrame,
    widthPx: number,
    heightPx: number,
  ): void => {
    const seen = new Set<string>();
    const draw = (value: Readonly<Partial<HomeSnapshot>>, isRuin: boolean): void => {
      if (value.home_id === undefined || value.region !== regionId || seen.has(value.home_id)) return;
      seen.add(value.home_id);
      const point = markScatterPoint(`home:${value.home_id}`, { width: widthPx, height: heightPx });
      context.fillStyle = isRuin ? "#5a5048" : "#c9a24b";
      context.fillRect(point.x - 3, point.y - 3, 6, 6);
      context.strokeStyle = "#20201c";
      context.lineWidth = 1;
      context.strokeRect(point.x - 3.5, point.y - 3.5, 7, 7);
    };
    for (const { value } of frame.world.homes) draw(value, false);
    for (const { value } of frame.world.ruins) draw(value, true);
  };

  /**
   * Dedicated owner factory for Z3's background snapshot builds -- deliberately never
   * `options.cacheCanvasFactory` (see `createCachePreparation`'s `ownerFactoryOverride` doc), so a
   * caller-supplied cache-canvas mock/DI seam for the FOCUSED region's own pipeline never also
   * observes non-focused-region background builds.
   */
  const backgroundOwnerFactory: CacheCanvasOwnerFactory = options.backgroundSnapshotCanvasFactory
    ?? ((input) => createCacheCanvasOwner({
      ...input,
      createCanvas: () => canvas.ownerDocument.createElement("canvas"),
    }));

  const createSnapshotCanvasOwner = (width: number, height: number): CacheCanvasOwner => (
    backgroundOwnerFactory({ label: "terrain", width, height })
  );

  /** Flattens one completed background `CachePair` (terrain + scenery, already rasterized by the
   * same `createCachePreparation` machinery the focused region uses) plus its current homes/ruins
   * into a single offscreen bitmap. Never touches `pair.recipe` -- only its already-rasterized
   * canvases and `pair.descriptor.worldBounds` pixel size -- so this carries no risk toward
   * Nirvana's authored-scene sidecar hazard. */
  const mergeSnapshotBitmap = (
    regionId: string,
    pair: CachePair,
    frame: PresentedObserverFrame,
  ): Readonly<{ bitmap: RegionSnapshotBitmap; owner: CacheCanvasOwner }> => {
    const width = pair.descriptor.worldBounds.width;
    const height = pair.descriptor.worldBounds.height;
    const owner = createSnapshotCanvasOwner(width, height);
    owner.context.imageSmoothingEnabled = false;
    owner.context.drawImage(pair.terrain.canvas, 0, 0);
    owner.context.drawImage(pair.scenery.canvas, 0, 0);
    drawSnapshotHomeMarkers(owner.context, regionId, frame, width, height);
    return { bitmap: { source: owner.canvas, widthPx: width, heightPx: height }, owner };
  };

  const cancelBackgroundSnapshotBuild = (build: BackgroundSnapshotBuild): void => {
    if (build.disposed) return;
    build.disposed = true;
    if (build.handle !== null) {
      try {
        atlasCommitScheduler.cancel(build.handle);
      } catch {
        // The build is already marked disposed; a cancellation fault cannot resurrect it.
      }
    }
    try {
      build.preparation?.dispose();
    } catch {
      // Best-effort cleanup of a mid-flight preparation.
    }
    if (build.leases !== null) releaseLeases(build.leases.values());
    if (!build.controller.signal.aborted) build.controller.abort();
    if (backgroundSnapshotBuilds.get(build.regionId) === build) {
      backgroundSnapshotBuilds.delete(build.regionId);
    }
  };

  const finishBackgroundSnapshotBuild = (
    build: BackgroundSnapshotBuild,
    completed: CachePair,
    frame: PresentedObserverFrame,
  ): void => {
    try {
      // Build this region's map inset while its terrain and scenery canvases are still alive --
      // `disposeOwnedCachePair` below frees them, and the world view has no other source for the
      // region's own rendered content (see `world/atlasSymbolLayer.ts`).
      ensureAtlasSymbolLayer(
        build.regionId,
        [completed.terrain.canvas, completed.scenery.canvas],
        completed.descriptor.worldBounds.width,
        completed.descriptor.worldBounds.height,
      );
      const { bitmap, owner } = mergeSnapshotBitmap(build.regionId, completed, frame);
      // `snapshotCache.set` disposes the PRIOR owner (if any) via the cache's `onEvicted`
      // callback, which reads `snapshotOwners.get(build.regionId)` -- so the map must still hold
      // the OLD owner at this point, and only get pointed at the new one afterward. Reordering
      // this would dispose the new canvas instead of the old one.
      snapshotCache.set(build.regionId, build.signature, bitmap);
      snapshotOwners.set(build.regionId, owner);
    } catch {
      // Leave whatever was previously cached (possibly nothing) in place; never fabricate terrain.
    } finally {
      disposeOwnedCachePair(completed);
      if (build.leases !== null) releaseLeases(build.leases.values());
      if (backgroundSnapshotBuilds.get(build.regionId) === build) {
        backgroundSnapshotBuilds.delete(build.regionId);
      }
      markDirty();
    }
  };

  /** Advances one background region's incremental cache preparation, reusing the exact same
   * `createCachePreparation` + `CACHE_PREPARATION_DRAW_BUDGET` + `atlasCommitScheduler` machinery
   * the focused-region live path (`prepareLoadedRegion`) already uses -- required for Nirvana's
   * `presentationProfile` scheduled/exact path, and equally correct (just synchronous in one
   * `advance` call) for the three generic-kit regions. */
  const advanceBackgroundSnapshotBuild = (
    build: BackgroundSnapshotBuild,
    frame: PresentedObserverFrame,
    staticTarget: StaticSceneLoadTarget,
  ): void => {
    if (build.disposed || backgroundSnapshotBuilds.get(build.regionId) !== build || build.leases === null) return;
    build.handle = null;
    try {
      build.preparation ??= createCachePreparation(
        build.regionId,
        build.leases,
        frame,
        staticTarget,
        backgroundOwnerFactory,
      );
      const completed = build.preparation.advance(CACHE_PREPARATION_DRAW_BUDGET);
      if (completed === null) {
        build.handle = atlasCommitScheduler.schedule(
          () => advanceBackgroundSnapshotBuild(build, frame, staticTarget),
        );
        return;
      }
      build.preparation = null;
      finishBackgroundSnapshotBuild(build, completed, frame);
    } catch {
      cancelBackgroundSnapshotBuild(build);
    }
  };

  /** Starts (or restarts, if `signature` moved on) a background snapshot build for one
   * non-focused region. A no-op if an up-to-date build is already in flight for it. */
  const ensureBackgroundSnapshotBuild = (
    regionId: string,
    frame: PresentedObserverFrame,
    signature: string,
  ): void => {
    const existingBuild = backgroundSnapshotBuilds.get(regionId);
    if (existingBuild !== undefined) {
      if (existingBuild.signature === signature) return;
      cancelBackgroundSnapshotBuild(existingBuild);
    }
    let staticTarget: StaticSceneLoadTarget;
    try {
      staticTarget = describeStaticSceneTarget(regionId, frame);
    } catch {
      // Honest fallback: leave whatever snapshot already exists (possibly none) rather than
      // fabricate terrain for a region whose static scene cannot currently be described.
      return;
    }
    const controller = new AbortController();
    const build: BackgroundSnapshotBuild = {
      regionId,
      signature,
      controller,
      leases: null,
      preparation: null,
      handle: null,
      disposed: false,
    };
    backgroundSnapshotBuilds.set(regionId, build);
    void acquireAtlasBundle(pool, [...staticTarget.atlasIds], controller).then((leases) => {
      if (build.disposed || backgroundSnapshotBuilds.get(regionId) !== build) {
        releaseLeases(leases.values());
        return;
      }
      build.leases = leases;
      advanceBackgroundSnapshotBuild(build, frame, staticTarget);
    }).catch(() => {
      if (backgroundSnapshotBuilds.get(regionId) === build) backgroundSnapshotBuilds.delete(regionId);
    });
  };

  /** Returns a drawable bitmap for `regionId` if one is cached and fresh; otherwise triggers a
   * (re)build and returns the last cached bitmap regardless of freshness (non-destructive: the
   * caller keeps drawing the stale terrain rather than nothing while the fresh one builds), or
   * `null` if nothing has ever been cached for this region yet. */
  const resolveRegionSnapshot = (
    regionId: string,
    frame: PresentedObserverFrame,
  ): RegionSnapshotBitmap | null => {
    const recipe = recipes.get(regionId);
    if (recipe === undefined) return null;
    const signature = regionSnapshotSignature(regionId, recipe, frame);
    const fresh = snapshotCache.get(regionId, signature);
    if (fresh !== null) return fresh;
    ensureBackgroundSnapshotBuild(regionId, frame, signature);
    return snapshotCache.peek(regionId);
  };

  /* ------------------------------------------------------------------ THE ATLAS (world view)
   * The world-map view: the four regions as islands in a sea, drawn from their own real terrain,
   * their real carrying capacity, their real adjacency and their real inhabitants. Design of
   * record: `docs/frontend/ATLAS_VIEW.md`; approved plates: `docs/frontend/mockups/atlas-impl/`.
   *
   * Render order is load-bearing (see ATLAS_VIEW §3 and `.superpowers/sdd/z3-report.md`):
   *   sea over the whole visible frame
   *     -> per island, back to front: shadow -> water bands -> terrain clipped to the mask
   *        -> beach/relief/mottle/rim dressing -> coastal boulders -> time-of-day light
   *     -> the focused region's own live terrain (drawn by `draw()` between the two passes)
   *     -> its dressing/boulders/light -> bridges -> life marks -> glow -> names.
   * The sea is ALWAYS painted before any terrain: painting it afterwards blanks the observed
   * region to a flat rect (the z3 hazard).
   */

  /** Creates the offscreen surfaces the island layers are rasterised into. Returns `null` when
   * the environment has no working 2D canvas (jsdom in unit tests), in which case the atlas
   * degrades to sea + clipped terrain rather than throwing. */
  const atlasSurface: AtlasSurfaceFactory = (widthPx, heightPx) => {
    try {
      const surface = canvas.ownerDocument.createElement("canvas");
      surface.width = Math.max(1, Math.ceil(widthPx));
      surface.height = Math.max(1, Math.ceil(heightPx));
      const surfaceContext = surface.getContext("2d");
      if (surfaceContext === null) return null;
      surfaceContext.imageSmoothingEnabled = false;
      return { canvas: surface, context: surfaceContext };
    } catch {
      return null;
    }
  };

  /** The region's real carrying capacity (`max_energy + max_materials`) per region id. */
  const regionCapacities = (frame: PresentedObserverFrame): ReadonlyMap<string, number> => {
    const capacities = new Map<string, number>();
    for (const { value: region } of frame.world.regions) {
      if (typeof region.name !== "string") continue;
      capacities.set(region.name, (region.max_energy ?? 0) + (region.max_materials ?? 0));
    }
    return capacities;
  };

  /** The region's real `current_energy / max_energy`, which drives the dry-grey vitality wash. */
  const regionVitality = (frame: PresentedObserverFrame, regionId: string): number => {
    for (const { value: region } of frame.world.regions) {
      if (region.name !== regionId) continue;
      const max = region.max_energy ?? 0;
      if (max <= 0) return 1;
      return Math.max(0, Math.min(1, (region.current_energy ?? max) / max));
    }
    return 1;
  };

  /** Builds (or reuses) one region's island. The signature covers exactly the mask's own inputs,
   * so a region that GROWS rebuilds its coastline at the new extent -- more coastline, same
   * character -- while a region that merely moves on the sheet keeps everything. */
  const ensureAtlasIsland = (
    regionId: string,
    kit: string,
    widthPx: number,
    heightPx: number,
    capeAngles: readonly number[],
    fill: number,
  ): AtlasIsland | null => {
    const signature = `${kit}|${Math.round(widthPx)}x${Math.round(heightPx)}|${fill.toFixed(3)}|`
      + capeAngles.map((angle) => angle.toFixed(2)).join(",");
    const existing = atlasIslands.get(regionId);
    if (existing !== undefined && existing.signature === signature) return existing;
    let mask: IslandMask;
    try {
      mask = buildIslandMask({ regionId, kit, widthPx, heightPx, capeAngles, fill });
    } catch {
      return null;
    }
    const island: AtlasIsland = {
      signature,
      kit,
      mask,
      mapFit: islandMapFit(mask, widthPx, heightPx),
      contour: islandContourLoops(mask),
      coast: islandCoastPoints(mask, 2),
      coarseCoast: islandCoastPoints(mask, 6),
      boulders: coastalBoulders(mask, regionId),
    };
    atlasIslands.set(regionId, island);
    atlasLayers.delete(regionId);
    return island;
  };

  /**
   * The archipelago layout of record: the single-ring adjacency-cycle embedding, then the
   * land-gap packing pass measured on the real silhouettes. Memoized on its own inputs (every
   * region's extent and carrying capacity, plus the adjacency graph), so the masks and the
   * 80-step packing solve run once per world shape -- not once per frame -- and a region that
   * GROWS rebuilds while a region that merely moves does not.
   *
   * Falls back to the plain ring embedding when the world sheet is off (the single-region render
   * path), which keeps the non-atlas render exactly as cheap as it was.
   */
  const resolveAtlasSheet = (
    extents: readonly RegionExtent[],
    adjacency: RegionAdjacency,
  ): RegionSheet => {
    const base = computeRegionSheet(extents, adjacency);
    if (!worldSheetSnapshotsEnabled || acceptedFrame === null) return base;
    const capacities = regionCapacities(acceptedFrame);
    let maxCapacity = 0;
    for (const capacity of capacities.values()) maxCapacity = Math.max(maxCapacity, capacity);
    const signature = [
      ...extents
        .map((extent) => `${extent.id}:${Math.round(extent.widthPx)}x${Math.round(extent.heightPx)}`
          + `:${capacities.get(extent.id) ?? 0}:${recipes.get(extent.id)?.kit ?? "?"}`)
        .sort(),
      "#",
      ...adjacency.map(([a, b]) => (a < b ? `${a}~${b}` : `${b}~${a}`)).sort(),
    ].join("|");
    if (atlasLayout !== null && atlasLayout.signature === signature) return atlasLayout.sheet;

    const known = new Set(extents.map((extent) => extent.id));
    const neighbours = new Map<string, string[]>();
    for (const [a, b] of adjacency) {
      if (a === b || !known.has(a) || !known.has(b)) continue;
      const listA = neighbours.get(a);
      if (listA === undefined) neighbours.set(a, [b]); else if (!listA.includes(b)) listA.push(b);
      const listB = neighbours.get(b);
      if (listB === undefined) neighbours.set(b, [a]); else if (!listB.includes(a)) listB.push(a);
    }
    const centerOf = (regionId: string): IslandPoint | null => {
      const rect = base.rects[regionId];
      return rect === undefined ? null : { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
    };
    for (const extent of extents) {
      const self = centerOf(extent.id);
      const capes = self === null ? [] : [...(neighbours.get(extent.id) ?? [])].sort().flatMap((other) => {
        const point = centerOf(other);
        return point === null ? [] : [Math.atan2(point.y - self.y, point.x - self.x)];
      });
      ensureAtlasIsland(
        extent.id,
        recipes.get(extent.id)?.kit ?? "neutral-temperate",
        extent.widthPx,
        extent.heightPx,
        capes,
        islandFillFraction(capacities.get(extent.id) ?? 0, maxCapacity),
      );
    }
    for (const regionId of [...atlasIslands.keys()]) {
      if (known.has(regionId)) continue;
      atlasIslands.delete(regionId);
      releaseAtlasRaster(atlasLayers.get(regionId)?.layers ?? null);
      atlasLayers.delete(regionId);
      releaseAtlasRaster(atlasSymbolLayers.get(regionId)?.layer ?? null);
      atlasSymbolLayers.delete(regionId);
      atlasSymbolRects.delete(regionId);
    }

    const packed = packRegionSheet(
      base,
      adjacency,
      (regionId) => atlasIslands.get(regionId)?.coarseCoast ?? null,
    );
    atlasLayout = { signature, sheet: packed };
    return packed;
  };

  /**
   * Release the backing stores of atlas raster surfaces that nothing will draw again.
   *
   * Only ever called with a surface the owning map has just replaced or dropped, so the zeroing
   * can never blank something still on screen. Anything that is not a canvas (a test double, an
   * `ImageBitmap`) is left alone.
   *
   * @param layers - The superseded island layers, map inset, or `null`.
   */
  const releaseAtlasRaster = (
    layers: IslandLayers | MapSymbolLayer | null,
  ): void => {
    if (layers === null) return;
    const surfaces = "canvas" in layers
      ? [layers.canvas]
      : [layers.shadow, layers.water, layers.dressing];
    for (const surface of surfaces) {
      if (surface === null || !(surface instanceof HTMLCanvasElement)) continue;
      surface.width = 0;
      surface.height = 0;
    }
  };

  /** The island's raster layers, rebuilt only when its mask, its vitality bucket, or the
   * time-of-day bucket moves. Buckets (32 vitality steps, 96 steps of the world day) keep this off
   * the per-frame path while still letting the map visibly dry out and darken over a run. */
  const ensureAtlasLayers = (
    regionId: string,
    island: AtlasIsland,
    vitality: number,
  ): IslandLayers | null => {
    const vitalityBucket = Math.round(Math.max(0, Math.min(1, vitality)) * 32);
    const lightBucket = Math.round(atlasLight.dayFraction * 96);
    const key = `${island.signature}|v${vitalityBucket}|l${lightBucket}`;
    const existing = atlasLayers.get(regionId);
    if (existing !== undefined && existing.key === key) return existing.layers;
    // Freeing the superseded surfaces here rather than leaving them to the collector matters:
    // canvas backing stores are off-heap, the collector prices them as ordinary small objects,
    // and this key moves on every vitality and time-of-day bucket -- so a run accumulates
    // thousands of unreferenced-but-still-resident surfaces beside the region-sized static
    // caches, which is precisely the pressure that makes a browser discard a cache's pixels.
    if (existing !== undefined) releaseAtlasRaster(existing.layers);
    const layers = buildIslandLayers({
      mask: island.mask,
      surface: atlasSurface,
      light: atlasLight,
      regionId,
      kit: island.kit,
      vitality,
    });
    atlasLayers.set(regionId, { key, layers });
    return layers;
  };

  /**
   * The region's map inset -- its own rendered terrain and scenery projected into its island's land
   * box, with its sprites re-drawn enlarged at their real positions (see
   * `world/atlasSymbolLayer.ts`).
   *
   * Built once per region from the canvases that are ALREADY alive for it (the focused region's own
   * cache, or a background snapshot's layers just before they are disposed) -- never from a recipe,
   * so Nirvana's authored-scene sidecar is never touched. Keyed by the island's signature as well
   * as the region id, because the projection is only valid for the fit it was built against: a
   * region that grows or changes shape rebuilds, one that merely moves on the sheet does not.
   *
   * A region with no living canvases -- or an environment with no offscreen canvas -- simply has no
   * inset, and the map falls back to the region's real 1:1 art clipped to the coastline, exactly as
   * it behaved before this layer existed.
   */
  const ensureAtlasSymbolLayer = (
    regionId: string,
    content: readonly CanvasImageSource[],
    plotWidthPx: number,
    plotHeightPx: number,
  ): MapSymbolLayer | null => {
    const island = atlasIslands.get(regionId);
    if (island === undefined) return null;
    const cached = atlasSymbolLayers.get(regionId);
    if (cached !== undefined && cached.signature === island.signature) return cached.layer;
    if (content.length === 0) return null;
    if (cached !== undefined) releaseAtlasRaster(cached.layer);
    const layer = buildRegionMapInset({
      regionId,
      content,
      contentWidthPx: plotWidthPx,
      contentHeightPx: plotHeightPx,
      plotBox: island.mapFit,
      rects: atlasSymbolRects.get(regionId) ?? [],
      shoreDistance: (localX, localY) => maskDistanceAtLocal(island.mask, localX, localY),
      surface: atlasSurface,
    });
    atlasSymbolLayers.set(regionId, { signature: island.signature, layer });
    return layer;
  };

  /**
   * The zoom at which the focused region's own rect COVERS the whole canvas -- the exact moment
   * the sea stops being visible and the atlas has nothing left to say. Above it, clipping the
   * region to its island and painting its map dressing would be both invisible and wrong.
   */
  const atlasCoverZoom = (): number | null => {
    if (activeSheetLocalRects === null || visibleRegionId === null) return null;
    const rect = activeSheetLocalRects[visibleRegionId];
    if (rect === undefined || rect.width <= 0 || rect.height <= 0) return null;
    return Math.max(canvas.width / rect.width, canvas.height / rect.height);
  };

  /**
   * How strongly the atlas reads at the current zoom: full while the world is in frame, easing to
   * nothing over the last stretch before the focused region covers the canvas. This is what makes
   * the descent a fall toward a place rather than a screen swap -- the beach fills the frame, the
   * map dressing dissolves, and you arrive ON the island.
   */
  const atlasStrength = (zoom: number): number => {
    const cover = atlasCoverZoom();
    if (cover === null) return 0;
    if (zoom <= cover * 0.85) return 1;
    if (zoom >= cover) return 0;
    return (cover - zoom) / (cover * 0.15);
  };

  /** How strongly map symbols read at the current zoom: full while the world is in frame, easing
   * to nothing well before the region fills it -- a map symbol becomes a tree. */
  const atlasSymbolOpacity = (zoom: number): number => {
    const cover = atlasCoverZoom();
    if (cover === null) return 0;
    if (zoom <= cover * 0.5) return 1;
    if (zoom >= cover * 0.95) return 0;
    return (cover * 0.95 - zoom) / (cover * 0.45);
  };

  /**
   * Draws a region's map inset over its island: the region's whole rendered content stretched into
   * the box fitted to its island's land, so the world view shows the same river, roads and
   * clearings the region view does. Fades out as the camera descends, uncovering the region's real
   * 1:1 art beneath it.
   *
   * The caller is responsible for clipping to the island mask. The fit lies INSIDE the land, so the
   * ring of land beyond it keeps the island's own dressing (and the 1:1 art under that) -- the
   * inset fades into it rather than ending on a line.
   */
  const drawMapSymbols = (
    context: CanvasRenderingContext2D,
    regionId: string,
    content: readonly CanvasImageSource[],
    rect: Rect,
    zoom: number,
  ): void => {
    const opacity = atlasSymbolOpacity(zoom);
    if (opacity <= 0.01) return;
    const island = atlasIslands.get(regionId);
    if (island === undefined) return;
    const layer = ensureAtlasSymbolLayer(regionId, content, rect.width, rect.height);
    if (layer === null) return;
    // The fit is plot-local; the plot itself may be drawn at any size on the sheet.
    const scaleX = rect.width / Math.max(1, island.mask.cols * island.mask.cell);
    const scaleY = rect.height / Math.max(1, island.mask.rows * island.mask.cell);
    context.globalAlpha = opacity;
    context.drawImage(
      layer.canvas,
      0,
      0,
      layer.sourceWidth,
      layer.sourceHeight,
      rect.x + island.mapFit.x * scaleX,
      rect.y + island.mapFit.y * scaleY,
      island.mapFit.width * scaleX,
      island.mapFit.height * scaleY,
    );
    context.globalAlpha = 1;
  };

  /** Traces an island's stair-step coastline loops as one path, offset to its plot's own origin.
   * Callers fill/clip it with the EVEN-ODD rule so enclosed lagoons come out as water. */
  const traceIsland = (
    context: CanvasRenderingContext2D,
    island: AtlasIsland,
    originX: number,
    originY: number,
  ): void => {
    context.beginPath();
    for (const loop of island.contour) {
      if (loop.length === 0) continue;
      const first = loop[0] as IslandPoint;
      context.moveTo(originX + first.x, originY + first.y);
      for (let index = 1; index < loop.length; index += 1) {
        const point = loop[index] as IslandPoint;
        context.lineTo(originX + point.x, originY + point.y);
      }
      context.closePath();
    }
  };

  const clipToIslandMask = (
    context: CanvasRenderingContext2D,
    island: AtlasIsland,
    originX: number,
    originY: number,
  ): void => {
    traceIsland(context, island, originX, originY);
    context.clip("evenodd");
  };

  /** Draws one mask-resolution layer scaled up onto its plot, with smoothing off (see
   * `atlasIslandLayers.ts` -- every band is a solid cell block, so this is pixel-identical to
   * rasterising at plot resolution). */
  const drawIslandLayer = (
    context: CanvasRenderingContext2D,
    layer: CanvasImageSource | null,
    island: AtlasIsland,
    originX: number,
    originY: number,
    offsetX = 0,
    offsetY = 0,
  ): void => {
    if (layer === null) return;
    context.drawImage(
      layer,
      0,
      0,
      island.mask.cols,
      island.mask.rows,
      originX + offsetX,
      originY + offsetY,
      island.mask.cols * island.mask.cell,
      island.mask.rows * island.mask.cell,
    );
  };

  /** The time-of-day light, applied to one island's land only. */
  const lightIsland = (
    context: CanvasRenderingContext2D,
    island: AtlasIsland,
    rect: Rect,
    strength = 1,
  ): void => {
    if (atlasLight.landTintA * strength <= 0.001) return;
    context.save();
    clipToIslandMask(context, island, rect.x, rect.y);
    context.globalAlpha = atlasLight.landTintA * strength;
    context.fillStyle = atlasLight.landTint;
    context.fillRect(rect.x, rect.y, rect.width, rect.height);
    context.globalAlpha = 1;
    context.restore();
  };

  /** Coastal boulders in the biome's own rock colours -- the detail that sells a waterline. Sized
   * in OUTPUT pixels so they stay legible as the camera zooms. */
  const drawCoastalBoulders = (
    context: CanvasRenderingContext2D,
    island: AtlasIsland,
    rect: Rect,
    unit: number,
  ): void => {
    const palette = coastPaletteForKit(island.kit);
    const rock = tintedHex(palette.rock, atlasLight);
    const rockLit = tintedHex(palette.rockLit, atlasLight);
    for (const boulder of island.boulders) {
      const size = Math.max(2, Math.round(6.5 * unit * boulder.scale));
      const x = Math.round(rect.x + boulder.x - size / 2);
      const y = Math.round(rect.y + boulder.y - size / 2);
      context.fillStyle = rock;
      context.fillRect(x, y, size, size);
      context.fillStyle = rockLit;
      context.fillRect(x, y, size, Math.max(1, Math.round(size / 4)));
    }
  };

  /** The sea: a radial gradient over the whole visible frame plus deterministic wave ticks, so the
   * world is never a floating rectangle and the frame is never dead. */
  const drawSea = (context: CanvasRenderingContext2D, visible: Rect, unit: number): void => {
    let painted = false;
    if (typeof context.createRadialGradient === "function") {
      try {
        const gradient = context.createRadialGradient(
          visible.x + visible.width / 2,
          visible.y + visible.height * 0.44,
          Math.min(visible.width, visible.height) * 0.28,
          visible.x + visible.width / 2,
          visible.y + visible.height / 2,
          Math.max(visible.width, visible.height) * 0.95,
        );
        gradient.addColorStop(0, atlasLight.seaNear);
        gradient.addColorStop(1, atlasLight.seaFar);
        context.fillStyle = gradient;
        painted = true;
      } catch {
        painted = false;
      }
    }
    if (!painted) context.fillStyle = atlasLight.seaFar;
    context.fillRect(visible.x, visible.y, visible.width, visible.height);

    // Wave ticks, skipped near land (the shore bands already carry that water).
    const distanceAt = (x: number, y: number): number => {
      let nearest = Number.POSITIVE_INFINITY;
      for (const [regionId, island] of atlasIslands) {
        const rect = activeSheetLocalRects?.[regionId];
        if (rect === undefined) continue;
        const distance = maskDistanceAtLocal(island.mask, x - rect.x, y - rect.y);
        if (distance < nearest) nearest = distance * island.mask.cell;
      }
      return nearest;
    };
    const ticks = seaWaveTicks(visible, 26 * unit, distanceAt);
    context.fillStyle = atlasLight.wave;
    const thickness = Math.max(1, Math.round(2 * unit));
    for (const tick of ticks) {
      context.globalAlpha = tick.alpha;
      context.fillRect(Math.round(tick.x), Math.round(tick.y), Math.round(tick.lengthPx), thickness);
      if (tick.double) {
        context.fillRect(
          Math.round(tick.x + 4 * unit),
          Math.round(tick.y + 4 * unit),
          Math.round(tick.lengthPx * 0.6),
          thickness,
        );
      }
    }
    context.globalAlpha = 1;
  };

  /** One crossing: plank deck or stone causeway, with piers under a long span, stone footings
   * where it meets land, and -- when a being is on it -- that being, with a warm halo at night. */
  const drawBridgeSpan = (
    context: CanvasRenderingContext2D,
    span: BridgeSpan,
    unit: number,
  ): void => {
    const dx = span.b.x - span.a.x;
    const dy = span.b.y - span.a.y;
    const length = Math.max(1, Math.hypot(dx, dy));
    const ux = dx / length;
    const uy = dy / length;
    const nx = -uy;
    const ny = ux;
    const causeway = span.kind === "causeway";
    const width = Math.max(3, (causeway ? 21 : 13) * unit);
    const half = width / 2;
    const deck = tintedHex(causeway ? "#a09786" : "#966c40", atlasLight);
    const deckLit = tintedHex(causeway ? "#c2baa9" : "#c09059", atlasLight);
    const rail = tintedHex(causeway ? "#6c6459" : "#5a3f28", atlasLight);

    const quad = (offsetX: number, offsetY: number): void => {
      context.beginPath();
      context.moveTo(span.a.x + nx * half + offsetX, span.a.y + ny * half + offsetY);
      context.lineTo(span.b.x + nx * half + offsetX, span.b.y + ny * half + offsetY);
      context.lineTo(span.b.x - nx * half + offsetX, span.b.y - ny * half + offsetY);
      context.lineTo(span.a.x - nx * half + offsetX, span.a.y - ny * half + offsetY);
      context.closePath();
      context.fill();
    };

    context.save();
    // shadow on the water
    context.globalAlpha = 0.4;
    context.fillStyle = "#04202b";
    quad(5 * unit, 7 * unit);
    context.globalAlpha = 1;

    // piers under a long span -- what makes a crossing read as BUILT rather than drawn
    const pierEvery = 190 * unit;
    if (length > pierEvery * 2) {
      const piers = Math.max(1, Math.round(length / pierEvery) - 1);
      for (let index = 1; index <= piers; index += 1) {
        const t = index / (piers + 1);
        const px = span.a.x + dx * t;
        const py = span.a.y + dy * t;
        context.fillStyle = tintedHex("#403c36", atlasLight);
        context.fillRect(
          Math.round(px - width * 0.7),
          Math.round(py - width * 0.3),
          Math.round(width * 1.4),
          Math.round(width * 1.5),
        );
        context.fillStyle = tintedHex("#6a635a", atlasLight);
        context.fillRect(
          Math.round(px - width * 0.7),
          Math.round(py - width * 0.3),
          Math.round(width * 1.4),
          Math.max(1, Math.round(3 * unit)),
        );
      }
    }

    context.fillStyle = deck;
    quad(0, 0);

    // plank ticks across the deck
    context.strokeStyle = rail;
    context.lineWidth = Math.max(1, 1.2 * unit);
    const plankStep = Math.max(3 * unit, (causeway ? 11 : 7) * unit);
    for (let along = 0; along < length; along += plankStep) {
      const px = span.a.x + ux * along;
      const py = span.a.y + uy * along;
      context.beginPath();
      context.moveTo(px + nx * half, py + ny * half);
      context.lineTo(px - nx * half, py - ny * half);
      context.stroke();
    }
    // rails / parapet
    context.lineWidth = Math.max(2, 2.6 * unit);
    for (const side of [1, -1]) {
      context.beginPath();
      context.moveTo(span.a.x + nx * side * half, span.a.y + ny * side * half);
      context.lineTo(span.b.x + nx * side * half, span.b.y + ny * side * half);
      context.stroke();
    }
    context.strokeStyle = deckLit;
    context.lineWidth = Math.max(1, 1.2 * unit);
    context.beginPath();
    context.moveTo(span.a.x + nx * (half - unit), span.a.y + ny * (half - unit));
    context.lineTo(span.b.x + nx * (half - unit), span.b.y + ny * (half - unit));
    context.stroke();

    // stone footings, so a bridge LANDS on the island instead of touching it
    for (const end of [span.a, span.b]) {
      const footing = Math.round(width * 1.6);
      context.fillStyle = tintedHex("#635d53", atlasLight);
      context.fillRect(Math.round(end.x - footing / 2), Math.round(end.y - footing / 2), footing, footing);
      context.fillStyle = tintedHex("#8b8478", atlasLight);
      context.fillRect(
        Math.round(end.x - footing / 2),
        Math.round(end.y - footing / 2),
        footing,
        Math.max(1, Math.round(4 * unit)),
      );
    }
    context.restore();
  };

  /** Traces a circle into the current path, preferring `ellipse` and falling back to a polyline
   * (a Canvas2D surface that lacks both is degraded enough that a missing ring is the least of
   * its problems, so the fallback is deliberately cheap). */
  const traceRing = (
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
  ): void => {
    if (typeof context.ellipse === "function") {
      context.ellipse(x, y, radius, radius, 0, 0, Math.PI * 2);
      return;
    }
    const steps = 24;
    context.moveTo(x + radius, y);
    for (let index = 1; index <= steps; index += 1) {
      const angle = (index / steps) * Math.PI * 2;
      context.lineTo(x + Math.cos(angle) * radius, y + Math.sin(angle) * radius);
    }
  };

  /** A soft radial glow -- hearth light, a being's halo, an event beat. No-op where the
   * environment cannot make gradients. */
  const drawGlow = (
    context: CanvasRenderingContext2D,
    x: number,
    y: number,
    radius: number,
    rgb: string,
    alpha: number,
  ): void => {
    if (alpha <= 0.01 || radius <= 0) return;
    if (typeof context.createRadialGradient !== "function") return;
    try {
      const gradient = context.createRadialGradient(x, y, 0, x, y, radius);
      gradient.addColorStop(0, `rgba(${rgb},${alpha.toFixed(3)})`);
      gradient.addColorStop(1, `rgba(${rgb},0)`);
      context.fillStyle = gradient;
      context.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    } catch {
      // A gradient fault cannot interrupt the live draw loop.
    }
  };

  /** Every adjacency edge named by the frame's own region snapshots (`RegionSnapshot.connections`,
   * `config/world.yaml`'s real per-region connection lists) -- the source of truth for which
   * islands get a bridge (see `islandBridges.ts`'s dedupe/normalize). */
  const regionAdjacencyFromFrame = (frame: PresentedObserverFrame): RegionAdjacency => {
    const pairs: Array<readonly [string, string]> = [];
    for (const { value: region } of frame.world.regions) {
      const regionId = region.name;
      if (typeof regionId !== "string") continue;
      for (const connection of region.connections ?? []) {
        if (typeof connection === "string") pairs.push([regionId, connection]);
      }
    }
    return pairs;
  };

  /** Every living being on the map, in its own resolved palette colour (`deriveHumanAppearance`
   * -> `resolveBeingCharacter` -> `resolveBeingPaletteVariant`, the exact same deterministic chain
   * the live sprite actor uses), so a region's population reads at a glance and is colour-
   * consistent with how that same being renders once you descend into its region. Position within
   * the region is a deterministic scatter over the island's own land, not a real coordinate -- see
   * `regionMarkPlacement.ts`'s module doc for why no real per-being coordinate exists anywhere in
   * this system, focused region included. */
  const atlasBeingsFromFrame = (frame: PresentedObserverFrame): readonly AtlasBeingInput[] => {
    const beings: AtlasBeingInput[] = [];
    const seen = new Set<string>();
    for (const { value: agent } of frame.world.agents) {
      if (agent.id === undefined || seen.has(agent.id)) continue;
      if (agent.status === "dead") continue;
      const regionId = agent.position;
      if (regionId === undefined) continue;
      seen.add(agent.id);
      const appearance = deriveHumanAppearance(agent.id, agent.persona);
      const characterId = resolveBeingCharacter(appearance);
      const variant = resolveBeingPaletteVariant(appearance, characterId);
      beings.push({
        id: agent.id,
        regionId,
        color: beingMarkColor(variant),
        well: agent.status !== "paralyzed",
      });
    }
    return beings;
  };

  /** The live event beat, if one is playing: a small, bright, brief spark where something is
   * happening RIGHT NOW. Driven by the scene's own moment identity, so it fires once per beat. */
  const atlasPulsesFor = (frame: PresentedObserverFrame, nowMs: number): readonly AtlasPulseInput[] => {
    const scene = frame.scene;
    if (scene !== null && scene.regionId !== null && scene.momentId !== atlasPulse?.momentId) {
      atlasPulse = {
        momentId: scene.momentId,
        regionId: scene.regionId,
        kind: pulseKindFor(scene.execution?.eventType ?? null),
        startedAtMs: nowMs,
      };
    }
    if (atlasPulse === null) return [];
    const age = (nowMs - atlasPulse.startedAtMs) / ATLAS_PULSE_MS;
    if (age >= 1) return [];
    return [{ regionId: atlasPulse.regionId, kind: atlasPulse.kind, age }];
  };

  /**
   * The archipelago world-sheet compositing pass: sea, wave ticks, and every island's shadow,
   * water bands, terrain and dressing. The focused region's own terrain is NOT drawn here -- it
   * draws live immediately after this function returns, in `draw()`, clipped to the same island
   * mask; `drawWorldSheetForeground` then finishes its dressing and lays the bridges, life marks
   * and glow over everything. A no-op (draws nothing) whenever no region sheet is active -- the
   * pre-existing single-region render is completely unchanged in that case.
   */
  const drawWorldSheetBackground = (
    context: CanvasRenderingContext2D,
    frame: PresentedObserverFrame,
    visible: Rect,
    zoom: number,
  ): void => {
    if (activeSheetLocalRects === null || activeSheetLocalBounds === null || visibleRegionId === null) return;
    const unit = 1 / Math.max(zoom, 1e-4);
    const strength = atlasStrength(zoom);
    drawSea(context, visible, unit);

    for (const regionId of atlasDrawOrder()) {
      const island = atlasIslands.get(regionId);
      const rect = activeSheetLocalRects[regionId];
      if (island === undefined || rect === undefined) continue;
      const layers = strength > 0.01
        ? ensureAtlasLayers(regionId, island, regionVitality(frame, regionId))
        : null;
      if (layers !== null) {
        context.globalAlpha = strength;
        drawIslandLayer(context, layers.shadow, island, rect.x, rect.y, 12 * unit, 16 * unit);
        drawIslandLayer(context, layers.water, island, rect.x, rect.y);
        context.globalAlpha = 1;
      }
      if (regionId === visibleRegionId) continue;
      const snapshot = resolveRegionSnapshot(regionId, frame);
      context.save();
      clipToIslandMask(context, island, rect.x, rect.y);
      if (snapshot !== null) {
        context.drawImage(
          snapshot.source,
          0,
          0,
          snapshot.widthPx,
          snapshot.heightPx,
          rect.x,
          rect.y,
          rect.width,
          rect.height,
        );
      }
      if (layers !== null) {
        context.globalAlpha = strength;
        drawIslandLayer(context, layers.dressing, island, rect.x, rect.y);
        context.globalAlpha = 1;
      }
      // The snapshot bitmap IS this region's terrain+scenery already flattened at plot resolution,
      // so it doubles as the inset's content source when the inset was not built at snapshot time
      // (e.g. the island did not exist yet on that build). The 1:1 draw above is the safe fallback
      // layer; the inset then covers every land cell on top of it -- and OVER the dressing, whose
      // inland relief and value mottle exist to texture a monotone kit and simply fog real terrain.
      // The inset fades out across the shore band, so the beach and coast rim light still read.
      drawMapSymbols(context, regionId, snapshot === null ? [] : [snapshot.source], rect, zoom);
      context.restore();
      if (strength > 0.01) {
        context.globalAlpha = strength;
        drawCoastalBoulders(context, island, rect, unit);
        context.globalAlpha = 1;
        lightIsland(context, island, rect, strength);
      }
    }
  };

  /**
   * The atlas's foreground: the focused island's own dressing and light (its terrain having just
   * been drawn live by `draw()`), then the bridges, then everything that lives on the map, then
   * the glow layer -- so lit things read as light sources -- then the regions' names in the sea.
   */
  const drawWorldSheetForeground = (
    context: CanvasRenderingContext2D,
    frame: PresentedObserverFrame,
    zoom: number,
    nowMs: number,
  ): void => {
    if (activeSheetLocalRects === null || visibleRegionId === null) return;
    const localRects = activeSheetLocalRects;
    const unit = 1 / Math.max(zoom, 1e-4);
    const strength = atlasStrength(zoom);
    if (strength <= 0.01) return;

    const focusedIsland = atlasIslands.get(visibleRegionId);
    const focusedRect = localRects[visibleRegionId];
    if (focusedIsland !== undefined && focusedRect !== undefined) {
      const layers = ensureAtlasLayers(visibleRegionId, focusedIsland, regionVitality(frame, visibleRegionId));
      context.save();
      clipToIslandMask(context, focusedIsland, focusedRect.x, focusedRect.y);
      if (layers !== null) {
        context.globalAlpha = strength;
        drawIslandLayer(context, layers.dressing, focusedIsland, focusedRect.x, focusedRect.y);
        context.globalAlpha = 1;
      }
      // Then the region's own content over the dressing, fading out across the shore band -- see
      // the same call in `drawWorldSheetBackground`. The dressing keeps the coast; the region keeps
      // its interior, which is the only place the map has anything real to say.
      drawMapSymbols(
        context,
        visibleRegionId,
        cache === null ? [] : [cache.terrain.canvas, cache.scenery.canvas],
        focusedRect,
        zoom,
      );
      context.restore();
      context.globalAlpha = strength;
      drawCoastalBoulders(context, focusedIsland, focusedRect, unit);
      context.globalAlpha = 1;
      // NOTE: the focused island's own light pass is deliberately NOT applied here -- its live
      // actors and animated environment draw after this pass, and a night map whose beings and
      // water are the only brightly-lit things on a dark island reads as a bug. See
      // `drawWorldSheetLight`, called after `graph.draw`.
    }
    context.globalAlpha = strength;

    // bridges -- one per real adjacency edge, anchored at the two islands' nearest coast cells
    const coastFor = (regionId: string): readonly IslandPoint[] | null => {
      const island = atlasIslands.get(regionId);
      const rect = localRects[regionId];
      if (island === undefined || rect === undefined) return null;
      return island.coast.map((point) => ({ x: rect.x + point.x, y: rect.y + point.y }));
    };
    for (const span of computeBridgeSpans(coastFor, regionAdjacencyFromFrame(frame))) {
      drawBridgeSpan(context, span, unit);
    }

    // life marks
    // Marks stand in for the regions the observer is NOT inside. The focused region draws its own
    // beings and shelters live (the scene graph), so marking them again would double every hut and
    // every life on exactly one island.
    const islandRefs = new Map<string, AtlasIslandRef>();
    for (const [regionId, island] of atlasIslands) {
      const rect = localRects[regionId];
      if (rect === undefined || regionId === visibleRegionId) continue;
      islandRefs.set(regionId, { regionId, mask: island.mask, originX: rect.x, originY: rect.y });
    }
    const marks = placeAtlasMarks(islandRefs, {
      homes: frame.world.homes.flatMap(({ value }) => (
        typeof value.home_id === "string" && typeof value.region === "string"
          ? [{
            id: value.home_id,
            regionId: value.region,
            integrity: (value.max_integrity ?? 0) > 0
              ? (value.integrity ?? 0) / (value.max_integrity as number)
              : 1,
          }]
          : []
      )),
      ruins: frame.world.ruins.flatMap(({ value }) => (
        typeof value.home_id === "string" && typeof value.region === "string"
          ? [{ id: value.home_id, regionId: value.region }]
          : []
      )),
      beings: atlasBeingsFromFrame(frame),
      pulses: atlasPulsesFor(frame, nowMs),
    });

    const scale = Math.max(1, Math.round(2.2 * unit));
    const glowStrength = atlasLight.glowStrength;
    for (const mark of marks) {
      if (mark.kind !== "home") continue;
      const width = Math.round(6.5 * scale);
      const height = Math.round(6 * scale);
      const x0 = Math.round(mark.x - width / 2);
      const y0 = Math.round(mark.y - height / 2);
      context.globalAlpha = 0.28 * strength;
      context.fillStyle = "#1b2418";
      context.fillRect(x0 - scale, y0 + height - scale, width + 2 * scale, Math.max(1, Math.round(scale * 1.4)));
      context.globalAlpha = strength;
      context.fillStyle = tintedHex("#cbb994", atlasLight);
      context.fillRect(x0, Math.round(y0 + height * 0.45), width, Math.round(height * 0.55));
      context.fillStyle = tintedHex(mark.intact ? "#a8552e" : "#7b4a30", atlasLight);
      context.beginPath();
      context.moveTo(x0 - scale, Math.round(y0 + height * 0.5));
      context.lineTo(Math.round(mark.x), y0 - scale);
      context.lineTo(x0 + width + scale, Math.round(y0 + height * 0.5));
      context.closePath();
      context.fill();
      context.fillStyle = tintedHex(mark.intact ? "#c9713f" : "#93603c", atlasLight);
      context.beginPath();
      context.moveTo(x0 - scale, Math.round(y0 + height * 0.5));
      context.lineTo(Math.round(mark.x), y0 - scale);
      context.lineTo(Math.round(mark.x), Math.round(y0 + height * 0.5));
      context.closePath();
      context.fill();
    }
    for (const mark of marks) {
      if (mark.kind !== "ruin") continue;
      context.fillStyle = tintedHex("#3a352e", atlasLight);
      context.fillRect(Math.round(mark.x - 3 * scale), Math.round(mark.y - 2 * scale), 6 * scale, 4 * scale);
      context.fillStyle = tintedHex("#6a6357", atlasLight);
      context.fillRect(Math.round(mark.x - 3 * scale), Math.round(mark.y - 2 * scale), 2 * scale, 2 * scale);
      context.fillRect(Math.round(mark.x + scale), Math.round(mark.y), 2 * scale, 2 * scale);
    }
    for (const mark of marks) {
      if (mark.kind !== "being") continue;
      context.fillStyle = "rgba(18,14,10,0.85)";
      context.fillRect(Math.round(mark.x - 2 * scale), Math.round(mark.y - 3 * scale), 4 * scale, 7 * scale);
      context.fillStyle = mark.well ? mark.color : tintedHex("#6d6a64", atlasLight);
      context.fillRect(Math.round(mark.x - scale), Math.round(mark.y - 2 * scale), 2 * scale, 5 * scale);
      context.fillStyle = mark.well ? "#f3ddb8" : "#8e8578";
      context.fillRect(Math.round(mark.x - scale), Math.round(mark.y - 3 * scale), 2 * scale, 2 * scale);
    }

    // the glow layer, last: the things that make their OWN light, on top of the dark
    if (glowStrength > 0.02) {
      for (const mark of marks) {
        if (mark.kind === "home") {
          context.fillStyle = "#ffe6b0";
          context.fillRect(
            Math.round(mark.x - scale * 0.8),
            Math.round(mark.y + scale),
            Math.round(1.8 * scale),
            Math.round(1.8 * scale),
          );
          drawGlow(context, mark.x, mark.y, 26 * scale, "255,190,104", 0.42 * glowStrength);
        } else if (mark.kind === "being" && mark.well) {
          drawGlow(context, mark.x, mark.y, 15 * scale, "255,222,168", 0.3 * glowStrength);
        }
      }
    }
    for (const mark of marks) {
      if (mark.kind !== "pulse") continue;
      const pulseUnit = scale * 1.5;
      for (const ring of [0, 1]) {
        const t = Math.min(1, mark.age + ring * 0.3);
        context.strokeStyle = `rgba(${mark.rgb},${((1 - t) * (ring === 0 ? 0.95 : 0.45)).toFixed(3)})`;
        context.lineWidth = Math.max(1.5, 2.2 * pulseUnit * (1 - t * 0.7));
        context.beginPath();
        traceRing(context, mark.x, mark.y, 2.5 * pulseUnit + t * 11 * pulseUnit);
        context.stroke();
      }
      drawGlow(context, mark.x, mark.y, 8 * pulseUnit, mark.rgb, 0.66 * (1 - mark.age));
    }

    drawHoveredIslandRim(context, unit);
    drawRegionNames(context, unit);
    context.globalAlpha = 1;
  };

  /**
   * The hover affordance: a rim light around the island under the pointer.
   *
   * A rim rather than an outline on purpose — an outline is a UI box drawn over a painting, while a
   * rim light is the island catching the light, which is the language the rest of the atlas already
   * speaks (`atlasLight`, `lightIsland`). Two passes over the island's own stair-step contour: a
   * wide, low-alpha halo bleeding into the sea, then a crisp warm edge on the coast itself.
   */
  const drawHoveredIslandRim = (
    context: CanvasRenderingContext2D,
    unit: number,
  ): void => {
    if (hoveredRegionId === null || activeSheetLocalRects === null) return;
    if (typeof context.stroke !== "function" || typeof context.beginPath !== "function") return;
    const island = atlasIslands.get(hoveredRegionId);
    const rect = activeSheetLocalRects[hoveredRegionId];
    if (island === undefined || rect === undefined || island.contour.length === 0) return;
    const tracePath = (): void => {
      context.beginPath();
      for (const loop of island.contour) {
        if (loop.length < 2) continue;
        const start = loop[0] as IslandPoint;
        context.moveTo(rect.x + start.x, rect.y + start.y);
        for (let index = 1; index < loop.length; index += 1) {
          const point = loop[index] as IslandPoint;
          context.lineTo(rect.x + point.x, rect.y + point.y);
        }
        context.closePath();
      }
    };
    context.save();
    try {
      context.lineJoin = "round";
      // Three passes, widest first: a bloom bleeding into the sea, a warm band on the shore, then a
      // crisp lit edge. At whole-sheet zoom an island is only a couple of hundred pixels wide and
      // its own surf band is already bright, so one thin outline disappears into it -- measured by
      // looking at the capture.
      context.globalAlpha = 0.2;
      context.strokeStyle = "#ffe3a6";
      context.lineWidth = Math.max(6, 20 * unit);
      tracePath();
      context.stroke();
      context.globalAlpha = 0.45;
      context.strokeStyle = "#ffeec4";
      context.lineWidth = Math.max(3, 8 * unit);
      tracePath();
      context.stroke();
      context.globalAlpha = 0.95;
      context.strokeStyle = "#fffaea";
      context.lineWidth = Math.max(1.5, 2.6 * unit);
      tracePath();
      context.stroke();
    } finally {
      context.globalAlpha = 1;
      context.restore();
    }
  };

  /** One small chart-style name in the sea beside each island, dropped below its own southernmost
   * coast. No grid, no borders, no legend, no numbers -- restraint is the rule. */
  const drawRegionNames = (context: CanvasRenderingContext2D, unit: number): void => {
    if (activeSheetLocalRects === null || typeof context.fillText !== "function") return;
    const localRects = activeSheetLocalRects;
    context.save();
    try {
      context.font = `${Math.max(6, Math.round(17 * unit))}px "Iowan Old Style", Georgia, serif`;
      context.textAlign = "center";
    } catch {
      // A font-setting fault cannot interrupt the live draw loop.
    }
    for (const [regionId, island] of atlasIslands) {
      const rect = localRects[regionId];
      if (rect === undefined) continue;
      const anchor = islandLandAnchor(island.mask);
      if (anchor.cells === 0) continue;
      const name = regionId.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
      const x = rect.x + anchor.centroidX;
      const y = rect.y + anchor.southY + 46 * unit;
      const hovered = regionId === hoveredRegionId;
      context.fillStyle = "rgba(3,24,32,0.6)";
      context.fillText(name, x + 2 * unit, y + 2 * unit);
      context.fillStyle = hovered
        ? "rgba(255,244,210,0.98)"
        : atlasLight.glowStrength > 0.5
          ? "rgba(170,202,214,0.66)"
          : "rgba(226,242,238,0.74)";
      context.fillText(name, x, y);
      if (!hovered) continue;
      // The hovered island's one line of live truth: who is alive there and what still stands.
      // Two numbers, in the map's own type -- restraint is the rule, and a hover is not a panel.
      const counts = regionLifeCounts(regionId);
      const readout = `${counts.population} being${counts.population === 1 ? "" : "s"}`
        + ` · ${counts.homes} home${counts.homes === 1 ? "" : "s"}`;
      const readoutY = y + 22 * unit;
      try {
        context.font = `${Math.max(5, Math.round(12 * unit))}px "Iowan Old Style", Georgia, serif`;
      } catch {
        // A font-setting fault cannot interrupt the live draw loop.
      }
      context.fillStyle = "rgba(3,24,32,0.6)";
      context.fillText(readout, x + 1.5 * unit, readoutY + 1.5 * unit);
      context.fillStyle = "rgba(246,232,196,0.92)";
      context.fillText(readout, x, readoutY);
      try {
        context.font = `${Math.max(6, Math.round(17 * unit))}px "Iowan Old Style", Georgia, serif`;
      } catch {
        // Same: restoring the label font is best-effort.
      }
    }
    context.restore();
  };

  /**
   * The focused island's time-of-day light, applied LAST -- after its live scene graph has drawn.
   * Everything that stands on that island (terrain, map dressing, beings, shelters, animated
   * water) is then under one light, which is the whole point of the single light pass.
   */
  const drawWorldSheetLight = (context: CanvasRenderingContext2D, zoom: number): void => {
    if (activeSheetLocalRects === null || visibleRegionId === null) return;
    const strength = atlasStrength(zoom);
    if (strength <= 0.01) return;
    const island = atlasIslands.get(visibleRegionId);
    const rect = activeSheetLocalRects[visibleRegionId];
    if (island === undefined || rect === undefined) return;
    lightIsland(context, island, rect, strength);
  };

  /** Back-to-front island order: an island lower on the sheet is nearer the viewer, so its shore
   * bands and shadow lie over its northern neighbour's. */
  const atlasDrawOrder = (): readonly string[] => {
    const rects = activeSheetLocalRects;
    if (rects === null) return [];
    return [...atlasIslands.keys()].sort((left, right) => {
      const a = rects[left];
      const b = rects[right];
      if (a === undefined || b === undefined) return left < right ? -1 : 1;
      return (a.y + a.height) - (b.y + b.height);
    });
  };

  /**
   * The rect the camera's centre is clamped to right now, or `null` when that is simply the
   * observed region's own `worldBounds` (no sheet installed).
   *
   * A deliberate MIRROR of `Camera2D`'s own `activeSheetRect()`: the focused region's rect while the
   * viewer is inside a region, the whole sheet while they are in the world view, and the camera's
   * zoom-derived "auto" rule when no scope has been latched (which is the case whenever the Z3
   * world-sheet LOD is off). Handed to {@link boundedRasterOrigin} so the drawn origin and the
   * camera centre are constrained by the same rect -- see that function's `clampRect` doc for what
   * went wrong when they were not.
   */
  function activeRasterClampRect(atZoom: number): Rect | null {
    const sheet = activeCameraSheet;
    if (sheet === null) return null;
    if (worldViewScope === "region") return sheet.focusedRect;
    if (worldViewScope === "world") return sheet.bounds;
    return atZoom >= sheet.lodSnapshotZoom ? sheet.focusedRect : sheet.bounds;
  }

  const draw = (nowMs: number): void => {
    if (disposed || hidden || !dirty || acceptedIdentity === null) return;
    const startedAt = measurementNow();
    const deltaMs = lastDrawAt === null ? 0 : Math.max(0, Math.min(MAX_DELTA_MS, nowMs - lastDrawAt));
    lastDrawAt = nowMs;
    graph.updateTime(deltaMs / 1_000, nowMs);
    forwardSceneSignals();
    if (acceptedIdentity !== null) {
      pendingSemanticPublication = true;
      flushPostCommitPublications();
    }
    refreshActiveCameraTarget();
    // Beat framing is re-issued every frame, not only on commit: the beat's participants walk
    // toward each other mid-scene (so the union grows), and the previous beat's hold can expire
    // between two commits -- both cases need the director to act on the draw clock, which is the
    // same clock the overlay chrome expires on.
    if (acceptedFrame !== null && directorMayFrame()
      && !beatFramingIsHeld(acceptedFrame.scene?.momentId ?? null)) frameBeat(acceptedFrame);
    syncRegionSheet(nowMs);
    settlePendingMomentTravel(nowMs);
    camera.update(deltaMs);
    if (cameraImpulse !== null && nowMs >= cameraImpulse.untilMs) cameraImpulse = null;
    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    const cameraSnapshot = camera.snapshot();
    const impulse = cameraImpulse?.offset ?? { x: 0, y: 0 };
    if (cache?.descriptor.topology === "toroidal"
      && cameraSnapshot.topology === "toroidal") {
      const rasterOrigin = {
        x: Math.round(cameraSnapshot.rasterOrigin.x + impulse.x),
        y: Math.round(cameraSnapshot.rasterOrigin.y + impulse.y),
      };
      renderRasterOrigin = { ...rasterOrigin };
      renderZoom = cameraSnapshot.zoom;
      const offsets = visiblePeriodicDrawOffsets(
        cache.descriptor.worldBounds,
        {
          x: -rasterOrigin.x / cameraSnapshot.zoom,
          y: -rasterOrigin.y / cameraSnapshot.zoom,
          width: canvas.width / cameraSnapshot.zoom,
          height: canvas.height / cameraSnapshot.zoom,
        },
      );
      context.save();
      for (const offset of offsets) {
        context.setTransform(
          cameraSnapshot.zoom,
          0,
          0,
          cameraSnapshot.zoom,
          Math.round(rasterOrigin.x + offset.x * cameraSnapshot.zoom),
          Math.round(rasterOrigin.y + offset.y * cameraSnapshot.zoom),
        );
        context.drawImage(
          cache.terrain.canvas,
          cache.descriptor.worldBounds.x,
          cache.descriptor.worldBounds.y,
        );
        context.drawImage(
          cache.scenery.canvas,
          cache.descriptor.worldBounds.x,
          cache.descriptor.worldBounds.y,
        );
        graph.draw(context, {
          zoom: cameraSnapshot.zoom,
          originX: Math.round(rasterOrigin.x + offset.x * cameraSnapshot.zoom),
          originY: Math.round(rasterOrigin.y + offset.y * cameraSnapshot.zoom),
          width: canvas.width,
          height: canvas.height,
          insets: { ...safeFrameInsets },
        });
      }
      context.restore();
    } else {
      const rasterOrigin = boundedRasterOrigin(
        cameraSnapshot,
        impulse,
        canvas.width,
        canvas.height,
        activeRasterClampRect(cameraSnapshot.zoom),
      );
      renderRasterOrigin = { ...rasterOrigin };
      renderZoom = cameraSnapshot.zoom;
      context.save();
      context.setTransform(
        cameraSnapshot.zoom,
        0,
        0,
        cameraSnapshot.zoom,
        rasterOrigin.x,
        rasterOrigin.y,
      );
      // Z3's sheet background (gutter + non-focused snapshots) draws FIRST, underneath
      // everything else -- it covers the WHOLE sheet's bounds, which includes the focused
      // region's own area (there is nothing else to draw there for the OTHER regions' loop, since
      // it skips `visibleRegionId`). The focused region's own continuation-pattern/terrain/scenery
      // draw immediately after, at local (0,0) -- exactly the focused region's own rect in this
      // same local frame -- and so naturally paints over the sheet background within that rect,
      // leaving the gutter and neighbouring snapshots visible only outside it.
      const sheetActive = worldSheetSnapshotsEnabled && activeSheetLocalRects !== null;
      const visibleWorldRect: Rect = {
        x: -rasterOrigin.x / cameraSnapshot.zoom,
        y: -rasterOrigin.y / cameraSnapshot.zoom,
        width: canvas.width / cameraSnapshot.zoom,
        height: canvas.height / cameraSnapshot.zoom,
      };
      if (sheetActive && acceptedFrame !== null) {
        drawWorldSheetBackground(context, acceptedFrame, visibleWorldRect, cameraSnapshot.zoom);
      }
      if (cache !== null) {
        // Once the archipelago sheet background is active, its sea fill ALREADY covers "space
        // beyond the region's true edges" -- the continuation pattern's own purpose -- so painting
        // it too would bleed a repeating terrain texture into what should read as clean sea/sand
        // around the island. Skip it in that case; every pre-existing test constructs the renderer
        // with `worldSheetSnapshots` left at its default (off), so this is unreachable for them.
        if (cameraSnapshot.mode !== "free" && !sheetActive) {
          context.fillStyle = cache.continuationPattern;
          context.fillRect(
            -rasterOrigin.x / cameraSnapshot.zoom,
            -rasterOrigin.y / cameraSnapshot.zoom,
            canvas.width / cameraSnapshot.zoom,
            canvas.height / cameraSnapshot.zoom,
          );
        }
        // In the world/sheet zoom regime (below the focused/region threshold), the focused
        // region's own terrain is clipped to its island silhouette too -- so it reads as one more
        // archipelago island rather than a rectangle poking out of the mosaic. At/above the
        // threshold (normal in-region play, any zoom level) it draws unclipped, exactly as before
        // this task -- gameplay at full zoom is never affected by the coastline being inset from
        // the plot's own rect.
        const focusedRect = sheetActive && visibleRegionId !== null
          ? activeSheetLocalRects?.[visibleRegionId] ?? null
          : null;
        const focusedIsland = visibleRegionId === null ? undefined : atlasIslands.get(visibleRegionId);
        // The focused region is clipped to its own island for exactly as long as the atlas is on
        // screen -- i.e. until its rect COVERS the canvas (`atlasStrength`), not merely until it
        // fits the shorter side. Stopping at the old fit-threshold left a band of zooms where the
        // sea was still visible around a hard, unclipped terrain RECTANGLE.
        const clipToIsland = focusedRect !== null && focusedIsland !== undefined
          && atlasStrength(cameraSnapshot.zoom) > 0.01;
        if (clipToIsland) {
          context.save();
          clipToIslandMask(context, focusedIsland as AtlasIsland, (focusedRect as Rect).x, (focusedRect as Rect).y);
        }
        context.drawImage(cache.terrain.canvas, 0, 0);
        context.drawImage(cache.scenery.canvas, 0, 0);
        if (clipToIsland) context.restore();
      }
      // The atlas's foreground: the focused island's own dressing/light, the crossings, everything
      // that lives on the map, and the glow layer -- all AFTER the focused region's terrain, so a
      // bridge lands ON its island and a lit hearth reads as a light source.
      if (sheetActive && acceptedFrame !== null) {
        drawWorldSheetForeground(context, acceptedFrame, cameraSnapshot.zoom, nowMs);
      }
      // The overlay's own bounds: a bubble now carries a WHOLE message, so it can
      // be large, and it must stay inside the canvas and clear of the HUD chrome
      // rather than running off the edge with the end of a sentence on it.
      graph.draw(context, {
        zoom: cameraSnapshot.zoom,
        originX: rasterOrigin.x,
        originY: rasterOrigin.y,
        width: canvas.width,
        height: canvas.height,
        insets: { ...safeFrameInsets },
      });
      // BEING-ONLY seam continuation. The camera stays bounded (that is the whole point of
      // the observer's retired toroidal wrap), so the terrain does not repeat and the
      // region keeps its sense of place -- but a being who steps off one edge must still
      // be VISIBLE arriving on the other. One extra beings-only pass per seam actually in
      // view does exactly that, and nothing else on the canvas is duplicated.
      if (cache !== null && graph.drawSeamActors !== undefined) {
        for (const offset of visibleSeamActorOffsets(
          cache.descriptor,
          visibleWorldRect,
        )) {
          context.save();
          context.translate(offset.x, offset.y);
          graph.drawSeamActors(context);
          context.restore();
        }
      }
      if (sheetActive) drawWorldSheetLight(context, cameraSnapshot.zoom);
      context.restore();
    }
    dirty = false;
    const finishedAt = measurementNow();
    const duration = Number.isFinite(startedAt) && Number.isFinite(finishedAt)
      ? Math.max(0, finishedAt - startedAt)
      : 0;
    drawDurations[drawDurationCursor] = duration;
    drawDurationCursor = (drawDurationCursor + 1) % DRAW_SAMPLE_COUNT;
    drawDurationCount = Math.min(DRAW_SAMPLE_COUNT, drawDurationCount + 1);
    drawDurationTotalCount += 1;

    const deadline = graph.nextDeadlineMs();
    if (!options.reducedMotion
      && (cameraImpulse !== null
        // Deliberately the BROAD `isSettled()`, not the narrower `cameraFlightInProgress`: this
        // loop must keep drawing while the camera is doing ANYTHING -- a fly-to or an ordinary
        // story/follow ease alike -- not only while a fly-to specifically is in the air.
        || !camera.isSettled()
        // A descent/ascent needs one more frame AFTER its flight has landed, because the landing is
        // what latches the scope (`syncRegionSheet`). Without this the loop stopped on the frame the
        // camera settled and a click-descent arrived in the region while still nominally in the
        // world view -- measured live.
        //
        // The wall-clock test alone is not enough: `syncRegionSheet` runs BEFORE `camera.update` in
        // this same draw, so the frame a flight lands on can never also observe the landing, and a
        // flight can outlive its own duration (the draw delta is clamped -- see
        // `cameraFlightInProgress`). Keeping the loop alive while either flight is UNRESOLVED is
        // what guarantees the observing frame exists. Bounded: it ends on the next sync.
        || navigationFlightInFlight(nowMs)
        || pendingDescent !== null || ascentLandsAtMs !== null
        || (deadline !== null && deadline <= nowMs))) {
      dirty = true;
      scheduleFrame();
    } else if (pendingFrameAcceptance !== null || pendingSemanticPublication) {
      scheduleWake(nowMs + POST_COMMIT_RETRY_MS, "post-commit-retry", true);
    } else if (!options.reducedMotion && deadline !== null) {
      scheduleWake(deadline, "graph-deadline");
    }
    emitDiagnostics();
  };

  const markDirty = (): void => {
    if (disposed) return;
    dirty = true;
    scheduleFrame();
  };

  function forwardSceneSignals(): void {
    if (disposed || options.onSceneSignals === undefined) return;
    let signals: readonly ProductionSceneSignal[];
    try {
      signals = graph.sceneSignals(lastSceneSignalSerial);
    } catch {
      emitFailure({
        kind: "canvas",
        retryable: true,
        publicMessage: "Committed scene details will be retried.",
      });
      return;
    }
    if (signals.length === 0) return;
    lastSceneSignalSerial = signals.at(-1)!.serial;
    try {
      options.onSceneSignals(signals);
    } catch {
      // Observer callbacks cannot interrupt a committed Graph/Canvas transaction.
    }
  }

  const validateResolvedSceneCommands = (
    frame: PresentedObserverFrame,
    batch: ProductionSceneCommandBatch | null,
    minimumSceneToken = activeCanvasSceneToken,
  ): boolean => {
    if (batch === null) return true;
    if (!sameIdentity(batch.identity, frame) || batch.sceneToken < minimumSceneToken) return false;
    const cameraCommands = batch.commands.filter(
      (command): command is Extract<ProductionSceneCommand, { kind: "camera-impulse" }> =>
        command.kind === "camera-impulse",
    );
    return cameraCommands.every((command) => validCameraImpulse(command));
  };

  const commitResolvedSceneCommands = (
    frame: PresentedObserverFrame,
    batch: ProductionSceneCommandBatch | null,
    commandResult: ProductionSceneFrameResult["commands"],
    committedAtMs: number,
  ): void => {
    if (batch === null) return;
    const cameraCommands = batch.commands.filter(
      (command): command is Extract<ProductionSceneCommand, { kind: "camera-impulse" }> =>
        command.kind === "camera-impulse",
    );
    const graphCommands = batch.commands.filter((command) => command.kind !== "camera-impulse");
    const ignoredCommandIds = commandResult?.ignoredCommandIds.filter((commandId) => (
      !cameraCommands.some((command) => command.commandId === commandId)
    )) ?? [];
    if (batch.sceneToken > activeCanvasSceneToken) reportedOptionalVisualFailures.clear();
    activeCanvasSceneToken = Math.max(activeCanvasSceneToken, batch.sceneToken);
    if (!(options.reducedMotion ?? false)) {
      for (const command of cameraCommands) {
        cameraImpulse = {
          offset: { ...command.offset },
          untilMs: committedAtMs + command.durationMs,
        };
      }
    }
    reportOptionalVisualFailures(frame, batch, graphCommands, ignoredCommandIds);
    if (disposed || acceptedFrame === null || !sameIdentity(acceptedFrame, frame)) return;
    forwardSceneSignals();
  };

  const applyCameraTargets = (
    targets: readonly ProductionSceneHitTarget[],
    priorTargetIds: ReadonlySet<string>,
  ): Set<string> => {
    const nextIds = new Set<string>();
    for (const target of targets) {
      nextIds.add(target.selectionKey);
      camera.setEntityBounds(target.selectionKey, target.worldBounds);
    }
    for (const id of priorTargetIds) if (!nextIds.has(id)) camera.setEntityBounds(id, null);
    return nextIds;
  };

  const updateCameraTargets = (): void => {
    cameraTargetIds = applyCameraTargets(graph.hitTargets(), cameraTargetIds);
  };

  /**
   * True when an AUTOMATIC framing request may move the camera.
   *
   * The single gate every director-side path in this file must pass: the per-frame story
   * adoption, region-load re-framing, checkpoint return-story, and Z3's focus-follow region
   * switch. Viewer-initiated paths (`panCamera`, `zoomCamera`, `setCameraMode`, `focusSelection`)
   * never consult it -- they ARE the authority.
   */
  const directorMayFrame = (): boolean => !viewerControlsCamera;

  const publishCameraAuthority = (): void => {
    callbacks.onCameraAuthorityChange?.(viewerControlsCamera);
  };

  /**
   * Hand framing authority to the viewer. Called from every port method that expresses "I am
   * driving now": a drag/wheel/arrow pan, a zoom, and choosing Follow or Free.
   *
   * Deliberately NOT called by `focusSelection`: a focus request is a *jump-to*, not a
   * take-over -- the reviewer (or the QA guided tour, which drives the same public port) is
   * asking the director to point somewhere, not to stop working.
   */
  const takeViewerCameraControl = (): void => {
    if (viewerControlsCamera) return;

    viewerControlsCamera = true;
    camera.setViewerControl(true);
    beatFraming = null;
    publishCameraAuthority();
  };

  /**
   * The explicit release: give the camera back to the director. Reached only from
   * `setCameraMode("story")` -- the S key, the HUD's Story button, and the stage's
   * "Resume story framing" affordance all funnel through it. Never fires implicitly.
   */
  const releaseViewerCameraControl = (): void => {
    if (!viewerControlsCamera) return;
    viewerControlsCamera = false;
    camera.setViewerControl(false);
    beatFraming = null;
    publishCameraAuthority();
  };

  /* ------------------------------------------------- world-view navigation (defects 1-4) */

  /** A region id rendered as a place name, the same transform the atlas's own labels use. */
  const regionDisplayName = (regionId: string | null): string | null => (
    regionId === null
      ? null
      : regionId.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
  );

  /** Living beings and standing shelters in a region — the hover readout's two numbers. */
  const regionLifeCounts = (
    regionId: string,
  ): Readonly<{ population: number; homes: number }> => {
    if (acceptedFrame === null) return { population: 0, homes: 0 };
    let population = 0;
    for (const { value: agent } of acceptedFrame.world.agents) {
      if (agent.position === regionId && agent.status !== "dead") population += 1;
    }
    let homes = 0;
    for (const { value: home } of acceptedFrame.world.homes) {
      if (home.region === regionId) homes += 1;
    }
    return { population, homes };
  };

  /** Publishes {@link WorldNavigationState} when (and only when) something in it changed. */
  const publishNavigationState = (): void => {
    if (worldViewScope === null) return;
    const counts = hoveredRegionId === null ? null : regionLifeCounts(hoveredRegionId);
    // The island the viewer is LOOKING at, not the one that happens to be live: the story director
    // still moves the observed region across the world as the chronicle plays, and a badge that
    // names a place the viewer cannot see is a lie. `focusedRegionId` is derived from the camera's
    // own centre (`regionAtPoint`), which at region scope is clamped inside the island on screen.
    const anchorRegionId = focusedRegionId ?? visibleRegionId;
    const next: WorldNavigationState = {
      scope: worldViewScope,
      regionId: anchorRegionId,
      regionName: regionDisplayName(anchorRegionId),
      hoveredRegionId,
      hoveredRegionName: regionDisplayName(hoveredRegionId),
      hoveredPopulation: counts?.population ?? null,
      hoveredHomes: counts?.homes ?? null,
      exitOffered,
    };
    const previous = publishedNavigation;
    if (previous !== null
      && previous.scope === next.scope
      && previous.regionId === next.regionId
      && previous.hoveredRegionId === next.hoveredRegionId
      && previous.hoveredPopulation === next.hoveredPopulation
      && previous.hoveredHomes === next.hoveredHomes
      && previous.exitOffered === next.exitOffered) return;
    publishedNavigation = next;
    callbacks.onWorldNavigationChange?.(next);
  };

  /** True while a descent or an ascent is still animating. Wall-clock, deliberately: its one job is
   * to recognise the TAIL of the gesture that launched the flight, and a gesture tail is a
   * wall-clock event. Whether the flight itself is over is a different question — see
   * {@link cameraFlightInProgress}. */
  const navigationFlightInFlight = (nowMs: number): boolean => (
    (pendingDescent !== null && nowMs < pendingDescent.arrivesAtMs)
    || (ascentLandsAtMs !== null && nowMs < ascentLandsAtMs)
  );

  /**
   * True while the camera is still executing a `fly-to`.
   *
   * `Camera2D` advances a flight on the DRAW delta, and that delta is clamped to
   * {@link MAX_DELTA_MS}: a flight therefore takes *at least* its stated duration in wall time, and
   * strictly longer whenever frames are further apart than 50 ms — a hitch, a background-tab wake,
   * a slow machine. So "the flight's duration has elapsed on the wall clock" and "the flight has
   * landed" are two different facts, and only the camera knows the second one.
   *
   * Measured before this existed (the renderer-level ascent test): with frames 120 ms apart, the
   * ascent's wall-clock deadline expired while the camera was still gliding at zoom 0.58, the
   * zoom-in latch saw a zoom above the region's cover zoom and re-latched the very region the
   * viewer was retreating from — "back to world" silently failed. Asking the camera closes that.
   *
   * Reads `CameraSnapshot.flying` rather than `!camera.isSettled()`: this predicate's whole job --
   * and its every call site's reason for existing -- is "is a fly-to SPECIFICALLY still in the
   * air", which is narrower than "is the camera unsettled" (also true mid an ordinary story/follow
   * ease that is not a flight). `isSettled()` is still the right call directly where the render
   * loop means the broader question -- "keep drawing while the camera is doing anything at all,
   * flight or plain ease" -- which is exactly what it is asked at its one other call site below.
   */
  const cameraFlightInProgress = (): boolean => camera.snapshot().flying;

  /** Latches the scope on both sides at once: the renderer's state and the camera's clamp. */
  const setWorldViewScope = (scope: WorldViewScope): void => {
    if (worldViewScope === scope) return;
    worldViewScope = scope;
    camera.setSheetScope(scope);
    if (scope === "region") hoveredRegionId = null;
    if (scope === "world") {
      exitOffered = false;
      zoomOutDetent = createZoomOutDetentState();
    }
    publishNavigationState();
    markDirty();
  };

  /**
   * A canvas-space (CSS px) position as a point in the observed region's LOCAL world frame — the
   * same frame `activeSheetLocalRects` is in. Uses the actually-rendered origin/zoom rather than
   * the camera snapshot so a hit lands where the pixels are, mid-flight included.
   */
  const localPointFromCanvas = (anchorCss: Vec2): Vec2 | null => {
    if (!Number.isFinite(anchorCss.x) || !Number.isFinite(anchorCss.y)) return null;
    const rect = canvas.getBoundingClientRect?.() ?? null;
    const scaleX = rect !== null && rect.width > 0 ? canvas.width / rect.width : 1;
    const scaleY = rect !== null && rect.height > 0 ? canvas.height / rect.height : 1;
    const snapshot = camera.snapshot();
    const origin = renderRasterOrigin ?? boundedRasterOrigin(
      snapshot,
      cameraImpulse?.offset ?? { x: 0, y: 0 },
      canvas.width,
      canvas.height,
      activeRasterClampRect(snapshot.zoom),
    );
    const zoom = renderZoom ?? snapshot.zoom;
    if (!Number.isFinite(zoom) || zoom <= 0) return null;
    const point = {
      x: (anchorCss.x * scaleX - origin.x) / zoom,
      y: (anchorCss.y * scaleY - origin.y) / zoom,
    };
    return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
  };

  /**
   * Which island a local-frame point is pointing at.
   *
   * Routed through the plot RECT (the documented rule — the mask is a portrait, not the footprint);
   * the island silhouette only refines between overlapping plots and rejects open sea, so hovering
   * the water between islands highlights nothing.
   */
  const regionAtLocalPoint = (point: Vec2): string | null => {
    if (activeSheetLocalRects === null) return null;
    return pickRegionAtPoint({
      rects: activeSheetLocalRects,
      point,
      landDistance: (regionId, localX, localY) => {
        const island = atlasIslands.get(regionId);
        if (island === undefined) return null;
        return maskDistanceAtLocal(island.mask, localX, localY);
      },
    });
  };

  /**
   * The descent: fly into `regionId` and land inside it.
   *
   * A VIEWER action, so it takes camera authority rather than being treated as automatic framing.
   * The destination region starts loading immediately (it arrives during the fall, not after it),
   * and the scope latches to `"region"` only when the flight lands — flying while already latched
   * would have the region's own zoom floor snap the camera to its arrival zoom on frame one.
   */
  const descendIntoRegion = (regionId: string, nowMs: number): void => {
    if (!worldSheetSnapshotsEnabled || activeSheetLocalRects === null) return;
    if (worldViewScope !== "world" || pendingDescent !== null) return;
    const rect = activeSheetLocalRects[regionId];
    if (rect === undefined || !recipes.has(regionId)) return;
    const flight = descentTarget(
      rect,
      canvas.width,
      canvas.height,
      options.reducedMotion === true ? 0 : undefined,
    );
    if (flight === null) return;
    takeViewerCameraControl();
    hoveredRegionId = null;
    ascentLandsAtMs = null;
    pendingDescent = { regionId, arrivesAtMs: nowMs + flight.durationMs };
    camera.apply({
      type: "fly-to",
      center: flight.center,
      zoom: flight.zoom,
      durationMs: flight.durationMs,
    });
    if (regionId !== visibleRegionId) beginObserveRegion(regionId);
    publishNavigationState();
    markDirty();
  };

  /**
   * The ascent: the ONE definition of "back to world", shared by the Esc key, the stage's control
   * and the zoom-out detent, so all three land in exactly the same view.
   */
  const ascendToWorldView = (nowMs: number): void => {
    if (!worldSheetSnapshotsEnabled || activeSheetLocalBounds === null) return;
    if (worldViewScope !== "region") return;
    takeViewerCameraControl();
    pendingDescent = null;
    // Scope first: the region floor has to be lifted before the camera is allowed to zoom out to
    // the whole sheet.
    setWorldViewScope("world");
    const flight = ascentTarget(
      activeSheetLocalBounds,
      canvas.width,
      canvas.height,
      options.reducedMotion === true ? 0 : undefined,
    );
    if (flight === null) return;
    ascentLandsAtMs = nowMs + flight.durationMs;
    camera.apply({
      type: "fly-to",
      center: flight.center,
      zoom: flight.zoom,
      durationMs: flight.durationMs,
    });
    markDirty();
  };

  /**
   * The step-out detent, evaluated on every viewer zoom while inside a region.
   *
   * Returns `true` when the zoom has been consumed by leaving the region. A zoom-out that merely
   * presses against the floor is NOT consumed — it is still applied (and clamps), which is what
   * makes the floor feel like a detent rather than a dead control.
   */
  const zoomOutDetentConsumesZoom = (factor: number, nowMs: number): boolean => {
    if (worldViewScope !== "region") return false;
    const pressingFloor = factor < 1
      && camera.snapshot().zoom <= camera.minimumZoom() + 1e-6;
    const result = resolveZoomOutDetent(zoomOutDetent, { pressingFloor, nowMs });
    zoomOutDetent = result.next;
    if (exitOffered !== result.showHint) {
      exitOffered = result.showHint;
      publishNavigationState();
    }
    if (!result.leaveRegion) return false;
    ascendToWorldView(nowMs);
    return true;
  };

  /**
   * Union of every rect, or `null` when there were none.
   */
  /**
   * Every participant rect of the live beat, plus which one the story focus names.
   *
   * A scene's `actorIntents` is not purely its cast: collective staging can add bystanders who
   * merely react, and a household's supporting cast is staged alongside the two beings a beat is
   * actually *about*. Framing those too would zoom a two-being exchange out until neither being
   * nor its chrome could be read -- so anything farther than {@link BEAT_FRAME_MAX_SPREAD_PX}
   * from the focused participant is treated as scenery and excluded. Nothing is invented: only
   * ids the scene itself named and the live hit-target ledger can resolve are used.
   */
  /** This canvas's current legible beat extent (see the exported {@link legibleBeatExtent}). */
  const currentLegibleBeatExtent = (): Vec2 => legibleBeatExtent({
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    insets: safeFrameInsets,
  });

  /**
   * Frame the live beat's whole cast and HOLD that frame for as long as the beat's own overlay
   * chrome is on screen.
   *
   * This is the legibility half of viewer authority. Two defects it closes:
   *
   * 1. **Only one participant was ever framed.** `Camera2D`'s story target took a single entity,
   *    so an attack, a gift, a proposal or a revival framed the actor and left the being it
   *    happened *to* off screen -- the impact burst, the flying item and the aim thread all draw
   *    at or between the two, so a one-being frame can never show them. The camera now fits the
   *    UNION of the beat's participants (padded, with headroom for chrome that hangs above
   *    heads) via the `fit` story target.
   * 2. **The overlay and the camera ran on two racing clocks.** Chrome lifetime is wall-clock
   *    inside `EnvironmentSystem`; the camera re-framed on every committed frame. A beat's mark
   *    could therefore expire while its scene continued, or the camera could cut to the next
   *    beat while the mark was still legible. There is now ONE clock: the environment layer
   *    publishes `overlayHoldUntilMs()` and the director refuses to re-frame before it. The
   *    honest direction of the reconciliation is *camera adopts overlay* -- the overlay's
   *    lifetime is a designed reading time (`OVERLAY_TIER_HOLD_MS`, or a bubble's own length),
   *    whereas a scene's phase windows are never published onto an observer frame at all.
   *
   * While a hold is active the union is still refreshed each frame (beings walk toward each other
   * mid-beat) but only ever GROWS, so the framing widens to keep everyone in shot and never
   * jitters tighter.
   */
  const frameBeat = (frame: PresentedObserverFrame): void => {
    const scene = frame.scene;
    if (scene === null || scene === undefined) {
      beatFramingSkip = "no-scene";
      return;
    }
    if (!directorMayFrame()) {
      beatFramingSkip = "viewer-controls-camera";
      return;
    }
    if (camera.snapshot().mode !== "story") {
      beatFramingSkip = `camera-mode:${camera.snapshot().mode}`;
      return;
    }
    // What must be in frame is what the overlay layer is actually DRAWING: the striker's mark,
    // the victim's burst, a thread's far cap, an item in flight. Deriving the cast from the
    // scene's actor intents instead was measured to be wrong in both directions -- at the
    // consequence beat the being an event happened *to* often carries no intent at all, while a
    // bystander standing at a distant home does.
    const chrome = graph.overlayFocusRect?.() ?? null;
    if (chrome === null) {
      beatFramingSkip = "no-live-chrome";
      if (beatFraming?.momentId !== scene.momentId) beatFraming = null;
      return;
    }
    const storySelection = selectionForStoryFocus(frame);
    // A `region` focus resolves to a hit target covering the ENTIRE region, which would swallow
    // the chrome rect and fit the camera to the whole map. Only a being or a structure anchors.
    const primary = storySelection === null || storySelection.kind === "region"
      ? null
      : graph.focusTarget(storySelection);
    const primaryKey = primary?.selectionKey ?? null;
    const extent = currentLegibleBeatExtent();
    const held = beatFrameRect({
      chrome,
      primary: primary?.worldBounds ?? null,
      previous: beatFraming !== null && beatFraming.momentId === scene.momentId
        ? beatFraming.union
        : null,
      extent,
    });
    beatFramingSkip = null;
    // Pad every side, with extra headroom because the legibility grammar lifts its chrome above
    // the anchor point it is given; without it a fitted frame clips the very bubble it exists to
    // show.
    const padded: Rect = {
      x: held.x - BEAT_FRAME_PADDING_PX,
      y: held.y - BEAT_FRAME_PADDING_PX - BEAT_FRAME_HEADROOM_PX,
      width: held.width + BEAT_FRAME_PADDING_PX * 2,
      height: held.height + BEAT_FRAME_PADDING_PX * 2 + BEAT_FRAME_HEADROOM_PX,
    };
    const overlayDeadline = graph.overlayHoldUntilMs?.() ?? null;
    const holdUntilMs = beatFraming !== null && beatFraming.momentId === scene.momentId
      ? maximumOrNull(beatFraming.holdUntilMs, overlayDeadline)
      : overlayDeadline;
    beatFraming = {
      momentId: scene.momentId,
      union: held,
      primaryKey,
      holdUntilMs,
    };
    camera.apply({
      type: "story-target",
      ...(primaryKey === null ? {} : { entityId: primaryKey }),
      target: padded,
      fit: true,
    });
  };

  /**
   * True while the previous beat's chrome is still readable, so the director must not cut away.
   *
   * Read against the SAME clock the overlay expires on (`frameDriver.now()`, which is what
   * drives `graph.updateTime` -> `EnvironmentSystem.advanceTo`), which is the whole point: two
   * clocks is what let a beat outlast its chrome and a camera outrun it.
   */
  const beatFramingIsHeld = (momentId: string | null): boolean => {
    if (beatFraming === null || beatFraming.holdUntilMs === null) return false;
    if (momentId !== null && beatFraming.momentId === momentId) return false;
    return frameDriver.now() < beatFraming.holdUntilMs;
  };

  function adoptCommittedCamera(frame: PresentedObserverFrame): boolean {
    try {
      if (visibleRegionId !== null) {
        if (cache?.regionId !== visibleRegionId) return false;
        // The camera's own clamp topology is always "bounded" -- the observer's toroidal wrap is
        // retired at this layer (Z2). `cache.descriptor.topology` is left untouched everywhere
        // else (hit-testing, the periodic-tile render path): agent placement/hit-testing still
        // wrap via `wrapCoordinate` inside the render descriptor's own toroidal continuation.
        camera.setWorldBounds(
          cache.descriptor.worldBounds,
          "bounded",
        );
      }
      updateCameraTargets();
      const storySelection = selectionForStoryFocus(frame);
      if (storySelection !== null) {
        const storyTarget = graph.focusTarget(storySelection);
        if (storyTarget !== null) {
          storyFocusSelection = storySelection;
          storyFocusOwnedByInteraction = false;
          // Beat hold: the director must not cut to a new beat while the previous beat's chrome
          // is still readable. Viewer authority is NOT re-checked here on purpose -- `Camera2D`
          // parks a story target as *pending* instead of obeying it while the viewer drives, so
          // the target still reaches the camera and an explicit release lands on the current
          // beat rather than on wherever the story was when the viewer took over.
          if (!beatFramingIsHeld(frame.scene?.momentId ?? null)) {
            camera.apply({
              type: "story-target",
              entityId: storyTarget.selectionKey,
              target: storyTarget.worldBounds,
            });
            frameBeat(frame);
          }
        }
      }
      return true;
    } catch {
      emitFailure({
        kind: "canvas",
        retryable: true,
        publicMessage: "The committed camera view will be retried.",
      });
      return false;
    }
  }

  const refreshActiveCameraTarget = (): void => {
    const snapshot = camera.snapshot();
    const activeSelection = snapshot.mode === "story"
      ? storyFocusSelection
      : snapshot.mode === "follow" && selection !== null
        && selection.kind !== "moment" && selection.kind !== "region"
        ? selection
        : null;
    if (activeSelection === null) return;
    const target = graph.focusTarget(activeSelection);
    if (target === null) return;
    camera.setEntityBounds(target.selectionKey, target.worldBounds);
  };

  /**
   * Keeps the observer camera's sheet-aware clamp in sync with the live region set, the
   * currently observed region, and the camera's own centre.
   *
   * Builds the region sheet fresh from every recipe's own `grid` extent -- never the recipe
   * object itself, and never through a presentation-profile provider -- so this never touches
   * Nirvana's authored-scene sidecar. This is the same reduction `describeStaticSceneTarget`
   * already applies for its (unrelated) render-cache sizing: `columns/rows * TILE_SIZE`.
   *
   * The camera always operates in the OBSERVED region's own local coordinate frame (terrain and
   * entities render at that region's local origin, unchanged by this task); the sheet and the
   * focused region's rect are therefore translated into that same local frame -- subtracting the
   * observed region's own placement on the sheet -- before being handed to
   * `camera.setRegionSheet`.
   *
   * Focus -- which region's rect the camera clamps to at/above the threshold -- is derived from
   * the camera's current centre via `regionAtPoint`, falling back to the previously resolved
   * focus (defaulting to the observed region) when the centre lands in a gutter or outside every
   * rect, per the design spec's "ties/gutter -> keep previous focus".
   *
   * Z3 additions (world-sheet LOD): also refreshes every region's local-frame rect
   * (`activeSheetLocalRects`/`activeSheetLocalBounds`, consumed by `drawWorldSheetBackground`)
   * and drives "camera focus follows into a live switch" -- the orchestrator's resolution of the
   * question Z2 deliberately left open. The RAW geometric focus (including `null` in the gutter,
   * unlike `resolvedFocus` above which sticks to the previous focus) feeds
   * `resolveFocusFollow`'s hysteresis; a recommended switch reuses `beginObserveRegion`, the exact
   * same internal path the public `observeRegion` port method calls, so the switch is
   * non-destructive for the same reason a user-initiated region change already is: `loadRegion`
   * never tears down `cache` until the replacement finishes loading, and the just-vacated region
   * immediately starts drawing from its own (already-maintained) snapshot bitmap instead.
   */
  const syncRegionSheet = (nowMs: number): void => {
    if (visibleRegionId === null || cache === null) {
      focusedRegionId = null;
      activeSheetLocalRects = null;
      activeSheetLocalBounds = null;
      activeSheetLodSnapshotZoom = null;
      activeCameraSheet = null;
      sheetOriginRegionId = null;
      hoveredRegionId = null;
      camera.setRegionSheet(null);
      return;
    }
    const extents: RegionExtent[] = [];
    for (const [regionId, recipe] of recipes) {
      extents.push({
        id: regionId,
        widthPx: recipe.grid.columns * TILE_SIZE,
        heightPx: recipe.grid.rows * TILE_SIZE,
      });
    }
    const adjacency = acceptedFrame !== null ? regionAdjacencyFromFrame(acceptedFrame) : [];
    if (acceptedFrame !== null) atlasLight = resolveAtlasLight(atlasDayFraction(acceptedFrame.world.worldTime));
    const sheet = resolveAtlasSheet(extents, adjacency);
    const originRect = sheet.rects[visibleRegionId];
    if (originRect === undefined) {
      focusedRegionId = null;
      activeSheetLocalRects = null;
      activeSheetLocalBounds = null;
      activeSheetLodSnapshotZoom = null;
      activeCameraSheet = null;
      camera.setRegionSheet(null);
      return;
    }
    // Local-frame rebase. The camera works in the OBSERVED region's frame, so the moment that
    // region changes -- a click-descent, a `[`/`]` switch, or Z3's own focus-follow -- the same
    // world point has new local coordinates. Shifting the centre by the two plots' placement
    // difference is what keeps the viewer looking at what they were already looking at; without it
    // every region switch is a silent teleport. Structural, not framing: it preserves the view
    // rather than choosing one, which is why it is not gated on viewer authority.
    if (worldSheetSnapshotsEnabled && sheetOriginRegionId !== null
      && sheetOriginRegionId !== visibleRegionId) {
      const previousOrigin = sheet.rects[sheetOriginRegionId];
      if (previousOrigin !== undefined) {
        camera.rebaseLocalFrame({
          x: previousOrigin.x - originRect.x,
          y: previousOrigin.y - originRect.y,
        });
      }
    }
    sheetOriginRegionId = visibleRegionId;
    const localCenter = camera.snapshot().center;
    const sheetSpaceCenter = {
      x: localCenter.x + originRect.x,
      y: localCenter.y + originRect.y,
    };
    const previousFocus = focusedRegionId ?? visibleRegionId;
    const geometricFocus = regionAtPoint(sheet, sheetSpaceCenter);
    const resolvedFocus = geometricFocus ?? previousFocus;
    focusedRegionId = resolvedFocus;
    const focusedSheetRect = sheet.rects[resolvedFocus] ?? originRect;
    const toLocal = (rect: Rect): Rect => ({
      x: rect.x - originRect.x,
      y: rect.y - originRect.y,
      width: rect.width,
      height: rect.height,
    });
    const { lodSnapshotZoom, minZoom, coverZoom } = deriveSheetZoomBounds(
      sheet.bounds,
      focusedSheetRect,
      canvas.width,
      canvas.height,
    );
    const nextRegionSheet: CameraRegionSheet = {
      bounds: toLocal(sheet.bounds),
      focusedRect: toLocal(focusedSheetRect),
      lodSnapshotZoom,
      minZoom,
      coverZoom,
    };
    camera.setRegionSheet(nextRegionSheet);
    activeCameraSheet = nextRegionSheet;

    if (!worldSheetSnapshotsEnabled) {
      activeSheetLocalRects = null;
      activeSheetLocalBounds = null;
      activeSheetLodSnapshotZoom = null;
      return;
    }

    const localRects: Record<string, Rect> = {};
    for (const [regionId, rect] of Object.entries(sheet.rects)) localRects[regionId] = toLocal(rect);
    activeSheetLocalRects = localRects;
    activeSheetLocalBounds = toLocal(sheet.bounds);
    activeSheetLodSnapshotZoom = lodSnapshotZoom;

    const liveZoom = camera.snapshot().zoom;
    // An ascent is over when its duration has elapsed AND the camera has actually landed. Both
    // halves are required: see `cameraFlightInProgress`.
    if (ascentLandsAtMs !== null && nowMs >= ascentLandsAtMs && !cameraFlightInProgress()) {
      ascentLandsAtMs = null;
    }
    if (worldViewScope === null) {
      // First sheet: adopt whichever regime the camera is already in, so a run that opens inside a
      // region opens LATCHED inside it (and is therefore immune to the ejection defect from the
      // first frame), while one that opens on the archipelago starts in the world view.
      worldViewScope = liveZoom + 1e-6 >= coverZoom ? "region" : "world";
      camera.setSheetScope(worldViewScope);
      publishNavigationState();
    } else if (pendingDescent !== null && nowMs >= pendingDescent.arrivesAtMs
      && !cameraFlightInProgress()) {
      // The descent has landed: latch the place. Doing it any earlier would have the region's own
      // zoom floor snap the camera to the arrival zoom while the flight was still easing -- which
      // is why the camera, not the wall clock, is asked whether the fall is over.
      const landedIn = pendingDescent.regionId;
      pendingDescent = null;
      if (landedIn === visibleRegionId) setWorldViewScope("region");
      publishNavigationState();
    } else if (pendingDescent === null && worldViewScope === "world"
      // An ascent STARTS above the region's cover zoom and eases down through it, so this latch
      // has to stand down for the whole retreat or it re-enters the region on frame one. Both
      // conditions are load-bearing: the deadline is not enough on its own, because the flight can
      // outlive it (`cameraFlightInProgress`), and standing down forever is not an option either.
      && ascentLandsAtMs === null && !cameraFlightInProgress()
      && geometricFocus === visibleRegionId && liveZoom + 1e-6 >= coverZoom) {
      // Zooming in until the region covers the canvas IS the atlas's own descent, so it latches
      // the place too -- and because the region floor is that same cover zoom, the very next
      // zoom-out pins instead of flipping back: the latch is the hysteresis.
      setWorldViewScope("region");
    }

    const followResult = resolveFocusFollow(focusFollowState, {
      // A descent already named its destination and started loading it; the islands its flight
      // path happens to cross are not a focus decision.
      geometricFocusRegionId: pendingDescent === null ? geometricFocus : null,
      zoom: camera.snapshot().zoom,
      lodSnapshotZoom,
      currentVisibleRegionId: visibleRegionId,
      nowMs,
    });
    focusFollowState = followResult.next;
    // Audited against the viewer-authority arbiter and deliberately left UNGATED. Z3's
    // focus-follow is driven entirely by where the VIEWER's own camera centre already sits (its
    // input is `camera.snapshot()`), and it changes only which region renders at full detail --
    // it never points the camera anywhere. Gating it would mean a viewer could pan across the
    // world sheet into a neighbouring region, zoom in, and be shown its low-detail snapshot
    // forever: refusing to serve them, in the name of not overriding them.
    if (followResult.switchToRegionId !== null) beginObserveRegion(followResult.switchToRegionId);
    // Published every frame (it self-suppresses unless a field actually changed) because the
    // observed region can also change WITHOUT any navigation act -- the story director follows the
    // chronicle across regions -- and a badge that names the wrong place is worse than none.
    publishNavigationState();
  };

  const acceptCommittedFrame = (
    frame: PresentedObserverFrame,
    diff: SceneGraphDiff,
    regionChanged: boolean,
    preparedCache: CachePair | null = null,
    batch: ProductionSceneCommandBatch | null = null,
    commandResult: ProductionSceneFrameResult["commands"] = null,
    committedAtMs = 0,
    cameraAlreadyAdopted = false,
    preparedSemanticSnapshot: ReturnType<ProductionSceneGraph["semanticSnapshot"]> | null = null,
    interactiveOwnership: InteractiveOwnershipSnapshot | null = null,
  ): void => {
    let replacementCache = visibleRegionId !== null
      && (cache === null || regionChanged || diff.staticLayersInvalidated)
      ? preparedCache
      : null;
    if ((cache === null || regionChanged || diff.staticLayersInvalidated)
      && visibleRegionId !== null && replacementCache === null) {
      if (graph.applyFrame !== undefined) {
        emitFailure({
          kind: "canvas",
          retryable: true,
          publicMessage: "The committed region art will be refreshed.",
        });
      } else {
        // Compatibility graphs used by unit seams expose no atomic applyFrame API.
        // Their diff is unknowable until after update(), so rasterize only when the
        // returned diff proves that a replacement is required.
        try {
          replacementCache = buildCache(visibleRegionId, atlasLeases, frame);
        } catch {
          emitFailure({
            kind: "canvas",
            retryable: true,
            publicMessage: "The committed region art will be refreshed.",
          });
        }
      }
    }
    acceptedIdentity = identityOf(frame);
    acceptedFrame = frame;
    acceptedBatch = batch;
    selection = interactiveOwnership === null ? frame.selection : interactiveOwnership.selection;
    selectionOwnedByInteraction = interactiveOwnership?.selectionOwnedByInteraction ?? false;
    if (interactiveOwnership !== null) {
      storyFocusSelection = interactiveOwnership.storyFocusSelection;
      storyFocusOwnedByInteraction = interactiveOwnership.storyFocusOwnedByInteraction;
    } else {
      storyFocusOwnedByInteraction = false;
    }
    if (replacementCache !== null) {
      lastCacheRebuildReason = cache === null
        ? "initial"
        : regionChanged ? "region" : "topology";
      replaceCache(replacementCache);
      staticLayerRebuilds += 1;
    }
    pendingCameraAdoption = cameraAlreadyAdopted ? null : frame;
    pendingSceneCommandCommit = batch === null
      ? null
      : { frame, batch, commandResult, committedAtMs };
    pendingFrameAcceptance = frame;
    pendingSemanticSnapshot = preparedSemanticSnapshot;
    pendingSemanticPublication = true;
    if (arrivalContinuity?.leg === "arrival"
      && (arrivalContinuity.phase === "consequence"
        || arrivalContinuity.phase === "recover"
        || arrivalContinuity.phase === "exit"
        || arrivalContinuity.phase === "gap")
      && arrivalContinuity.toRegion === visibleRegionId) arrivalContinuity = null;
    if (
      (frame.checkpointFocus === null || frame.checkpointFocus === undefined)
      && checkpointCameraOwnership?.restoring === true
      && (
        checkpointCameraOwnership.regionId === null
        || checkpointCameraOwnership.regionId === visibleRegionId
      )
    ) checkpointCameraOwnership = null;
    flushPostCommitPublications();
    markDirty();
  };

  /**
   * Which region the GRAPH is drawing, when that is not the one the story is playing in.
   *
   * `null` means "work it out from the frame", and `resolveActiveRegion` then takes the story's
   * own `scene.regionId`. That was always the right answer under automatic framing, because the
   * visible region was RESOLVED FROM the story's region and the two could not come apart.
   * {@link STORY_FRAMING_HOLDS_THE_OBSERVED_REGION} separates them: a viewer watching Warm
   * Springs while the story plays in Nirvana now has a story region that is not the mounted one,
   * and a graph left to work it out would build Nirvana's scene against Warm Springs' terrain
   * cache -- committing a frame whose static layers cannot match, which surfaces as "The
   * committed region art will be refreshed." over a half-drawn map.
   *
   * So the override is withheld only when the graph would land on the mounted region anyway.
   * Every case that existed before this policy answers exactly as it did.
   *
   * Side effects: none.
   */
  const graphObserverRegionOverride = (
    frame: PresentedObserverFrame,
    viewRegionId: string,
  ): string | null => (
    frame.checkpointFocus !== undefined && frame.checkpointFocus !== null
      ? null
      : camera.snapshot().mode === "story"
        && frame.scene?.regionId !== undefined
        && frame.scene.regionId === viewRegionId
      ? null
      : viewRegionId
  );

  const checkpointReturnRegion = (frame: PresentedObserverFrame): string | null => (
    frame.checkpointFocus === null || frame.checkpointFocus === undefined
      ? checkpointCameraOwnership?.regionId ?? null
      : null
  );

  /**
   * The checkpoint-correction director: a frame carrying `checkpointFocus` borrows the camera
   * (forcing story mode) and gives it back by restoring the saved checkpoint.
   *
   * Deliberately NOT gated by the viewer-authority arbiter. This is a bounded, explicitly
   * requested borrow -- a checkpoint hold only exists because the viewer entered an archive
   * checkpoint -- and it saves the viewer's exact camera first and restores it after. Since the
   * checkpoint now carries `viewerControlled`, the viewer's authority survives the borrow
   * intact, which is the property that makes this the opposite of a silent override.
   */
  const adoptCheckpointCameraOwnership = (frame: PresentedObserverFrame): void => {
    const focus = frame.checkpointFocus ?? null;
    if (focus !== null) {
      if (checkpointCameraOwnership === null && camera.snapshot().mode !== "story") {
        checkpointCameraOwnership = {
          camera: camera.checkpoint(),
          regionId: visibleRegionId,
          restoring: false,
        };
      }
      if (checkpointCameraOwnership?.restoring === true) {
        checkpointCameraOwnership.restoring = false;
      }
      if (camera.snapshot().mode !== "story") camera.apply({ type: "return-story" });
      return;
    }
    if (checkpointCameraOwnership === null || checkpointCameraOwnership.restoring) return;
    camera.restore(checkpointCameraOwnership.camera);
    checkpointCameraOwnership.restoring = true;
  };

  const loadingIntentMatches = (
    generation: AtlasGeneration,
    frame: PresentedObserverFrame,
    regionId: string,
    observerOnly: boolean,
    observerViewRegionId: string | null,
    staticTarget: StaticSceneLoadTarget | null = null,
  ): boolean => generation.regionId === regionId
    && generation.observerOnly === observerOnly
    && generation.observerViewRegionId === observerViewRegionId
    && (staticTarget === null || (
      generation.staticTarget.recipe.identityHash === staticTarget.recipe.identityHash
      && sameProductionStaticSceneDescriptor(
        generation.staticTarget.descriptor,
        staticTarget.descriptor,
      )
    ))
    && sameLineage(generation.frame, frame);

  const mountedCacheMatches = (
    regionId: string,
    staticTarget: StaticSceneLoadTarget,
  ): boolean => cache !== null
    && cache.regionId === regionId
    && sameProductionStaticSceneDescriptor(cache.descriptor, staticTarget.descriptor);

  const applyFrame = (
    frame: PresentedObserverFrame,
    regionChanged: boolean,
    viewRegionId: string,
    batch: ProductionSceneCommandBatch | null,
  ): void => {
    if (disposed) return;
    const lineageChanged = acceptedIdentity !== null
      && (frame.runId !== acceptedIdentity.runId || frame.sourceKey !== acceptedIdentity.sourceKey);
    const minimumSceneToken = lineageChanged ? -1 : activeCanvasSceneToken;
    if (!validateResolvedSceneCommands(frame, batch, minimumSceneToken)) {
      emitFailure({ kind: "canvas", retryable: true, publicMessage: "The active scene could not be presented." });
      return;
    }
    if (!validBatchForFrame(frame, batch, lineageChanged ? -1 : activeCanvasSceneToken)) {
      emitFailure({ kind: "canvas", retryable: true, publicMessage: "The active scene could not be presented." });
      return;
    }
    if (!lineageChanged) {
      const commits: Array<Readonly<{
        frame: PresentedObserverFrame;
        batch: ProductionSceneCommandBatch | null;
      }>> = [
        ...pendingArrivalPrerequisites(frame)
          .filter(({ frame: pendingFrame }) => !sameIdentity(pendingFrame, frame)),
        { frame, batch },
      ];
      if (commits.some(({ frame: pendingFrame, batch: pendingBatch }) => (
        !validBatchForFrame(pendingFrame, pendingBatch, activeCanvasSceneToken)
        || !validateResolvedSceneCommands(pendingFrame, pendingBatch)
      ))) {
        emitFailure({ kind: "canvas", retryable: true, publicMessage: "The active scene could not be presented." });
        return;
      }
      let committed: Readonly<{
        frame: PresentedObserverFrame;
        batch: ProductionSceneCommandBatch | null;
        receipt: AppliedGraphFrame;
      }> | null = null;
      let commitThrew = false;
      try {
        for (const pending of commits) {
          const receipt = applyGraphFrame(
            graph,
            pending.frame,
            pending.batch,
            frameDriver.now(),
            graphObserverRegionOverride(pending.frame, viewRegionId),
          );
          if (receipt === null) break;
          forgetPendingArrivalCommit(pending.frame);
          committed = { ...pending, receipt };
        }
      } catch (error) {
        commitThrew = true;
        lastInternalFailure = internalFailureDiagnostic("frame-commit", error);
      }
      if (committed === null) {
        if (commitThrew) {
          emitFailure({ kind: "canvas", retryable: true, publicMessage: "The world view could not be updated." });
        }
        return;
      }
      acceptCommittedFrame(
        committed.frame,
        committed.receipt.diff,
        regionChanged,
        null,
        committed.batch,
        committed.receipt.commands,
        committed.receipt.committedAtMs,
      );
      if (commitThrew || !sameIdentity(committed.frame, frame)) {
        emitFailure({
          kind: "canvas",
          retryable: true,
          publicMessage: "The latest causal frame will be retried.",
        });
      }
      return;
    }

    let candidate: ProductionSceneGraph | null = null;
    let receipt: AppliedGraphFrame | null = null;
    let preparedCache: CachePair | null = null;
    try {
      candidate = createGraph();
      receipt = applyGraphFrame(
        candidate,
        frame,
        batch,
        frameDriver.now(),
        graphObserverRegionOverride(frame, viewRegionId),
      );
      if (receipt === null) throw new Error("Lineage frame was rejected.");
      const visibleRecipe = visibleRegionId === null ? null : recipes.get(visibleRegionId) ?? null;
      const staticLayersInvalidated = visibleRegionId !== null && (
        cache === null
        || regionChanged
        || visibleRecipe === null
        || cache.regionId !== visibleRegionId
        || cache.staticCacheIdentity !== staticCacheIdentityForRecipe(visibleRecipe)
      );
      receipt = {
        ...receipt,
        diff: receipt.diff.staticLayersInvalidated === staticLayersInvalidated
          ? receipt.diff
          : { ...receipt.diff, staticLayersInvalidated },
      };
      preparedCache = visibleRegionId !== null && staticLayersInvalidated
        ? buildCache(visibleRegionId, atlasLeases, frame)
        : null;
    } catch (error) {
      lastInternalFailure = internalFailureDiagnostic("lineage-rebind", error);
      candidate?.dispose();
      disposeOwnedCachePair(preparedCache);
      emitFailure({ kind: "canvas", retryable: true, publicMessage: "The world view could not be updated." });
      return;
    }
    const prior = graph;
    graph = candidate;
    candidate = null;
    lastInternalFailure = null;
    activeCanvasSceneToken = -1;
    lastSceneSignalSerial = 0;
    cameraImpulse = null;
    forgetPendingArrivalCommit(frame);
    // The candidate is now the live Graph. Everything below is adoption, never a
    // reason to restore the old Canvas against the newly active Graph.
    acceptCommittedFrame(
      frame,
      receipt.diff,
      regionChanged,
      preparedCache,
      batch,
      receipt.commands,
      receipt.committedAtMs,
    );
    prior.dispose();
  };

  const restorePriorSchedule = (): void => {
    if (disposed || hidden || acceptedIdentity === null) return;
    if (dirty) {
      scheduleFrame();
      return;
    }
    if (options.reducedMotion) return;
    const deadline = graph.nextDeadlineMs();
    if (deadline !== null) scheduleWake(deadline, "graph-deadline");
  };

  const commitLoadedRegion = (
    generation: AtlasGeneration,
    leases: ReadonlyMap<string, ProductionAssetLease>,
    preparedRegionCache: CachePair | null,
  ): void => {
    if (disposed || loading !== generation || generation.epoch !== loadEpoch) {
      disposeOwnedCachePair(preparedRegionCache);
      releaseLeases(leases.values());
      return;
    }
    let preparedCache = preparedRegionCache;
    const regionChanged = visibleRegionId !== generation.regionId;
    if (regionChanged && preparedCache === null) {
      loading = null;
      releaseLeases(leases.values());
      emitAtlasFailure(generation.regionId);
      restorePriorSchedule();
      return;
    }
    const prior = new Map(atlasLeases);
    let leasesInstalled = false;
    const rejectLoadedRegion = (): void => {
      disposeOwnedCachePair(preparedCache);
      preparedCache = null;
      if (leasesInstalled) {
        atlasLeases.clear();
        for (const [id, lease] of prior) atlasLeases.set(id, lease);
      }
      releaseLeases(leases.values());
      loading = null;
      emitAtlasFailure(generation.regionId);
      restorePriorSchedule();
    };
    if (!regionChanged && preparedCache !== null) {
      const candidateLeases = new Map(leases);
      const priorCamera = camera.checkpoint();
      let candidate: ProductionSceneGraph | null = null;
      let receipt: AppliedGraphFrame | null = null;
      let candidateCamera: CameraCheckpoint | null = null;
      let candidateCameraTargetIds: Set<string> | null = null;
      let candidateSemanticSnapshot: ReturnType<
        ProductionSceneGraph["semanticSnapshot"]
      > | null = null;
      const candidateInteractiveOwnership: InteractiveOwnershipSnapshot = {
        selection: selectionOwnedByInteraction ? selection : generation.frame.selection,
        selectionOwnedByInteraction,
        storyFocusSelection,
        storyFocusOwnedByInteraction,
      };
      let candidateStoryFocusSelection = candidateInteractiveOwnership.storyFocusSelection;
      const commits: Array<Readonly<{
        frame: PresentedObserverFrame;
        batch: ProductionSceneCommandBatch | null;
      }>> = [
        ...generation.prerequisites
          .filter(({ frame }) => !sameIdentity(frame, generation.frame)),
        { frame: generation.frame, batch: generation.batch },
      ];
      try {
        const currentTarget = describeStaticSceneTarget(
          generation.regionId,
          generation.frame,
        );
        if (currentTarget.recipe.identityHash !== generation.staticTarget.recipe.identityHash
          || !sameProductionStaticSceneDescriptor(
            currentTarget.descriptor,
            generation.staticTarget.descriptor,
          )) {
          throw new Error("Prepared exact region was superseded before adoption.");
        }
        if (commits.some(({ frame, batch }) => (
          !validBatchForFrame(frame, batch, activeCanvasSceneToken)
          || !validateResolvedSceneCommands(frame, batch)
        ))) {
          throw new Error("Prepared exact region frame is no longer valid.");
        }
        candidate = createGraph(candidateLeases);
        if (candidate === graph) {
          throw new Error("Same-region exact adoption requires a fresh graph generation.");
        }
        for (const pending of commits) {
          receipt = applyGraphFrame(
            candidate,
            pending.frame,
            pending.batch,
            frameDriver.now(),
            generation.observerViewRegionId,
          );
          if (receipt === null) {
            throw new Error("Prepared exact region frame was rejected.");
          }
        }
        candidateSemanticSnapshot = cloneSemanticSnapshotForAdoption(
          candidate.semanticSnapshot(),
        );
        const storySelection = candidateInteractiveOwnership.storyFocusOwnedByInteraction
          ? candidateInteractiveOwnership.storyFocusSelection
          : selectionForStoryFocus(generation.frame);
        const storyTarget = storySelection === null
          ? null
          : candidate.focusTarget(storySelection);
        // See the sibling `camera.setWorldBounds` call above: the camera's clamp topology is
        // always "bounded" now; `preparedCache.descriptor.topology` still drives rendering and
        // hit-testing untouched.
        camera.setWorldBounds(
          preparedCache.descriptor.worldBounds,
          "bounded",
        );
        candidateCameraTargetIds = applyCameraTargets(
          candidate.hitTargets(),
          cameraTargetIds,
        );
        // Not re-gated on viewer authority: `Camera2D` parks a story target as pending rather than
        // obeying it while the viewer drives, and the candidate checkpoint carries the viewer's
        // own centre/zoom/authority bit, so the region swap is transparent to them.
        if (camera.snapshot().mode === "story" && storyTarget !== null) {
          candidateStoryFocusSelection = storySelection;
          camera.apply({
            type: "story-target",
            entityId: storyTarget.selectionKey,
            target: storyTarget.worldBounds,
          });
        }
        candidateCamera = camera.checkpoint();
        camera.restore(priorCamera);
      } catch {
        camera.restore(priorCamera);
        try {
          candidate?.dispose();
        } catch {
          // Candidate graph cleanup faults cannot strand its prepared cache or leases.
        }
        rejectLoadedRegion();
        return;
      }
      if (candidate === null || receipt === null
        || candidateCamera === null || candidateCameraTargetIds === null
        || candidateSemanticSnapshot === null) {
        camera.restore(priorCamera);
        candidate?.dispose();
        rejectLoadedRegion();
        return;
      }

      const priorGraph = graph;
      graph = candidate;
      candidate = null;
      atlasLeases = candidateLeases;
      visibleRegionId = generation.regionId;
      loading = null;
      activeCanvasSceneToken = -1;
      lastSceneSignalSerial = 0;
      cameraImpulse = null;
      camera.restore(candidateCamera);
      cameraTargetIds = candidateCameraTargetIds;
      storyFocusSelection = candidateStoryFocusSelection;
      for (const pending of commits) forgetPendingArrivalCommit(pending.frame);
      lastInternalFailure = null;
      acceptCommittedFrame(
        generation.frame,
        { ...receipt.diff, staticLayersInvalidated: true },
        false,
        preparedCache,
        generation.batch,
        receipt.commands,
        receipt.committedAtMs,
        true,
        candidateSemanticSnapshot,
        {
          ...candidateInteractiveOwnership,
          storyFocusSelection: candidateStoryFocusSelection,
        },
      );
      preparedCache = null;
      try {
        priorGraph.dispose();
      } catch {
        // Retired graph cleanup cannot interrupt committed cache and lease release.
      }
      releaseLeases(prior.values());
      return;
    }

    atlasLeases.clear();
    for (const [id, lease] of leases) atlasLeases.set(id, lease);
    leasesInstalled = true;
    if (!regionChanged) {
      loading = null;
      applyFrame(generation.frame, false, generation.regionId, generation.batch);
      releaseLeases(prior.values());
      return;
    }

    const commitLoadedLineageRegion = (batch: ProductionSceneCommandBatch | null): void => {
      if (!validBatchForFrame(generation.frame, batch, -1)
        || !validateResolvedSceneCommands(generation.frame, batch, -1)) {
        rejectLoadedRegion();
        return;
      }
      let candidate: ProductionSceneGraph | null = null;
      let receipt: AppliedGraphFrame | null = null;
      try {
        candidate = createGraph();
        receipt = applyGraphFrame(
          candidate,
          generation.frame,
          batch,
          frameDriver.now(),
          generation.observerViewRegionId,
        );
        if (receipt === null) throw new Error("Loaded lineage frame was rejected.");
      } catch (error) {
        lastInternalFailure = internalFailureDiagnostic("lineage-rebind", error);
        candidate?.dispose();
        rejectLoadedRegion();
        return;
      }

      const priorGraph = graph;
      graph = candidate;
      candidate = null;
      visibleRegionId = generation.regionId;
      loading = null;
      activeCanvasSceneToken = -1;
      lastSceneSignalSerial = 0;
      cameraImpulse = null;
      forgetPendingArrivalCommit(generation.frame);
      lastInternalFailure = null;
      acceptCommittedFrame(
        generation.frame,
        receipt.diff,
        true,
        preparedCache,
        batch,
        receipt.commands,
        receipt.committedAtMs,
      );
      preparedCache = null;
      priorGraph.dispose();
      releaseLeases(prior.values());
    };
    const commitLiveGraphRegion = (batch: ProductionSceneCommandBatch | null): void => {
      const commits: Array<Readonly<{
        frame: PresentedObserverFrame;
        batch: ProductionSceneCommandBatch | null;
      }>> = [
        ...generation.prerequisites
          .filter(({ frame }) => !sameIdentity(frame, generation.frame)),
        { frame: generation.frame, batch },
      ];
      if (commits.some(({ frame, batch: pendingBatch }) => (
        !validBatchForFrame(frame, pendingBatch, activeCanvasSceneToken)
        || !validateResolvedSceneCommands(frame, pendingBatch)
      ))) {
        rejectLoadedRegion();
        return;
      }
      let committed: Readonly<{
        frame: PresentedObserverFrame;
        batch: ProductionSceneCommandBatch | null;
        receipt: AppliedGraphFrame;
      }> | null = null;
      try {
        for (const pending of commits) {
          const receipt = applyGraphFrame(
            graph,
            pending.frame,
            pending.batch,
            frameDriver.now(),
            generation.observerViewRegionId,
          );
          if (receipt === null) throw new Error("Loaded causal frame was rejected.");
          forgetPendingArrivalCommit(pending.frame);
          committed = { ...pending, receipt };
        }
      } catch {
        if (committed !== null && preparedCache !== null) {
          visibleRegionId = generation.regionId;
          loading = null;
          acceptCommittedFrame(
            committed.frame,
            committed.receipt.diff,
            true,
            preparedCache,
            committed.batch,
            committed.receipt.commands,
            committed.receipt.committedAtMs,
          );
          preparedCache = null;
          releaseLeases(prior.values());
          emitFailure({
            kind: "canvas",
            retryable: true,
            publicMessage: "The latest causal frame will be retried.",
          });
          return;
        }
        rejectLoadedRegion();
        return;
      }
      if (committed === null) {
        rejectLoadedRegion();
        return;
      }

      // applyGraphFrame is the final live-Graph commit boundary. Canvas, camera,
      // semantics, and acceptance adopt that receipt without any rollback catch.
      visibleRegionId = generation.regionId;
      loading = null;
      acceptCommittedFrame(
        committed.frame,
        committed.receipt.diff,
        true,
        preparedCache,
        committed.batch,
        committed.receipt.commands,
        committed.receipt.committedAtMs,
      );
      preparedCache = null;
      releaseLeases(prior.values());
    };

    if (generation.observerOnly && acceptedIdentity !== null) {
      const observerBatch = generation.batch;
      const arrivalDestination = enteredArrivalDestination(generation.frame, observerBatch)
        ?? retainedArrivalDestination(arrivalContinuity, generation.frame, observerBatch);
      if (arrivalDestination !== null) {
        if (!validBatchForFrame(generation.frame, observerBatch, activeCanvasSceneToken)
          || !validateResolvedSceneCommands(generation.frame, observerBatch)) {
          rejectLoadedRegion();
          return;
        }
        commitLiveGraphRegion(observerBatch);
        return;
      }

      let candidate: ProductionSceneGraph | null = null;
      let semanticSnapshot: ReturnType<ProductionSceneGraph["semanticSnapshot"]>;
      let storySelection: Exclude<ObserverSelection, null> | null;
      let storyTarget: ProductionSceneHitTarget | null;
      let regionDescriptor: ProductionStaticSceneDescriptor;
      let candidateCamera: CameraCheckpoint;
      let candidateCameraTargetIds: Set<string>;
      let candidateStoryFocusSelection = storyFocusSelection;
      const priorCamera = camera.checkpoint();
      try {
        candidate = createGraph();
        const receipt = applyGraphFrame(
          candidate,
          generation.frame,
          null,
          frameDriver.now(),
          generation.observerViewRegionId,
        );
        if (receipt === null) throw new Error("Observed region update was rejected.");
        semanticSnapshot = cloneSemanticSnapshotForAdoption(candidate.semanticSnapshot());
        storySelection = selectionForStoryFocus(generation.frame);
        storyTarget = storySelection === null ? null : candidate.focusTarget(storySelection);
        if (preparedCache === null || preparedCache.regionId !== generation.regionId) {
          throw new Error("Observed region cache descriptor is unavailable.");
        }
        regionDescriptor = preparedCache.descriptor;
        // See the sibling `camera.setWorldBounds` calls above: the camera's clamp topology is
        // always "bounded" now; `regionDescriptor.topology` still drives rendering and
        // hit-testing untouched.
        camera.setWorldBounds(
          regionDescriptor.worldBounds,
          "bounded",
        );
        candidateCameraTargetIds = applyCameraTargets(
          candidate.hitTargets(),
          cameraTargetIds,
        );
        // Not re-gated on viewer authority: `Camera2D` parks a story target as pending rather than
        // obeying it while the viewer drives, and the candidate checkpoint carries the viewer's
        // own centre/zoom/authority bit, so the region swap is transparent to them.
        if (camera.snapshot().mode === "story" && storyTarget !== null) {
          candidateStoryFocusSelection = storySelection;
          camera.apply({
            type: "story-target",
            entityId: storyTarget.selectionKey,
            target: storyTarget.worldBounds,
          });
        }
        candidateCamera = camera.checkpoint();
      } catch {
        camera.restore(priorCamera);
        try {
          candidate?.dispose();
        } catch {
          // Candidate graph cleanup faults cannot strand its cache or atlas leases.
        }
        rejectLoadedRegion();
        return;
      }

      const priorGraph = graph;
      const priorCache = cache;
      graph = candidate;
      candidate = null;
      accountStaticCacheRecovery(priorCache, preparedCache);
      cache = preparedCache;
      preparedCache = null;
      visibleRegionId = generation.regionId;
      lastSceneSignalSerial = 0;
      camera.restore(candidateCamera);
      cameraTargetIds = candidateCameraTargetIds;
      storyFocusSelection = candidateStoryFocusSelection;
      loading = null;
      staticLayerRebuilds += 1;
      semanticPublisher.accept(semanticSnapshot);
      markDirty();
      try {
        priorGraph.dispose();
      } catch {
        // Retired graph cleanup cannot interrupt committed cache and lease release.
      }
      disposeOwnedCachePair(priorCache);
      lastCacheRebuildReason = priorCache === null ? "initial" : "region";
      releaseLeases(prior.values());
      return;
    }

    const batch = generation.batch;
    if (acceptedIdentity !== null && !sameLineage(generation.frame, acceptedIdentity)) {
      commitLoadedLineageRegion(batch);
      return;
    }
    if (!validBatchForFrame(generation.frame, batch, activeCanvasSceneToken)
      || !validateResolvedSceneCommands(generation.frame, batch)) {
      rejectLoadedRegion();
      return;
    }
    commitLiveGraphRegion(batch);
  };

  const disposePendingAtlasPreparation = (owner: PendingAtlasCommit): void => {
    const preparation = owner.preparation;
    owner.preparation = null;
    if (preparation === null) return;
    try {
      preparation.dispose();
    } catch {
      // Provider cleanup faults cannot strand cache owners or decoded atlas leases.
    }
  };

  const cancelPendingAtlasCommit = (generation: AtlasGeneration): void => {
    const owner = pendingAtlasCommit;
    if (owner === null || owner.generation !== generation) return;
    pendingAtlasCommit = null;
    if (owner.handle !== null) atlasCommitScheduler.cancel(owner.handle);
    owner.handle = null;
    disposePendingAtlasPreparation(owner);
    disposeOwnedCachePair(owner.preparedCache);
    owner.preparedCache = null;
    releaseLeases(owner.leases.values());
  };

  const failPendingAtlasCommit = (owner: PendingAtlasCommit): void => {
    if (pendingAtlasCommit !== owner) return;
    pendingAtlasCommit = null;
    owner.handle = null;
    disposePendingAtlasPreparation(owner);
    disposeOwnedCachePair(owner.preparedCache);
    owner.preparedCache = null;
    releaseLeases(owner.leases.values());
    const { generation } = owner;
    if (disposed || loading !== generation || generation.epoch !== loadEpoch) return;
    loading = null;
    emitAtlasFailure(generation.regionId);
    restorePriorSchedule();
  };

  const scheduleAtlasCommitPhase = (
    owner: PendingAtlasCommit,
    phase: PendingAtlasCommit["phase"],
    callback: () => void,
  ): void => {
    if (pendingAtlasCommit !== owner) return;
    owner.phase = phase;
    owner.handle = null;
    try {
      owner.handle = atlasCommitScheduler.schedule(callback);
    } catch {
      failPendingAtlasCommit(owner);
    }
  };

  const prepareLoadedRegion = (owner: PendingAtlasCommit): void => {
    if (pendingAtlasCommit !== owner) return;
    owner.handle = null;
    const { generation, leases } = owner;
    if (disposed || loading !== generation || generation.epoch !== loadEpoch) {
      pendingAtlasCommit = null;
      disposePendingAtlasPreparation(owner);
      disposeOwnedCachePair(owner.preparedCache);
      owner.preparedCache = null;
      releaseLeases(leases.values());
      return;
    }
    // A cache whose canvases the browser emptied still matches its descriptor exactly, so the
    // structural comparison below cannot see it. Without this clause the reload would adopt the
    // blank canvases it already has and the region would stay bare for the rest of the session.
    const cacheRequiresPreparation = visibleRegionId !== generation.regionId
      || cache === null
      || cache.regionId !== generation.regionId
      || mountedStaticCacheLostPixels()
      || !sameProductionStaticSceneDescriptor(
        cache.descriptor,
        generation.staticTarget.descriptor,
      );
    if (cacheRequiresPreparation) {
      try {
        owner.preparation ??= createCachePreparation(
          generation.regionId,
          leases,
          generation.frame,
          generation.staticTarget,
        );
        const preparedCache = owner.preparation.advance(CACHE_PREPARATION_DRAW_BUDGET);
        if (preparedCache === null) {
          scheduleAtlasCommitPhase(owner, "prepare", () => prepareLoadedRegion(owner));
          return;
        }
        owner.preparation = null;
        owner.preparedCache = preparedCache;
      } catch {
        failPendingAtlasCommit(owner);
        return;
      }
    }
    scheduleAtlasCommitPhase(owner, "adopt", () => {
      if (pendingAtlasCommit !== owner) return;
      owner.handle = null;
      pendingAtlasCommit = null;
      const preparedCache = owner.preparedCache;
      owner.preparedCache = null;
      commitLoadedRegion(generation, leases, preparedCache);
    });
  };

  const deferLoadedRegionCommit = (
    generation: AtlasGeneration,
    leases: ReadonlyMap<string, ProductionAssetLease>,
  ): void => {
    if (disposed || loading !== generation || generation.epoch !== loadEpoch) {
      releaseLeases(leases.values());
      return;
    }
    const owner: PendingAtlasCommit = {
      generation,
      leases,
      phase: "prepare",
      handle: null,
      preparation: null,
      preparedCache: null,
    };
    pendingAtlasCommit = owner;
    scheduleAtlasCommitPhase(owner, "prepare", () => prepareLoadedRegion(owner));
  };

  const loadRegion = (
    frame: PresentedObserverFrame,
    regionId: string,
    observerOnly: boolean,
    batch: ProductionSceneCommandBatch | null,
    observerViewRegionId = graphObserverRegionOverride(frame, regionId),
    suppliedStaticTarget: StaticSceneLoadTarget | null = null,
  ): void => {
    let staticTarget: StaticSceneLoadTarget;
    try {
      staticTarget = suppliedStaticTarget ?? describeStaticSceneTarget(regionId, frame);
    } catch {
      emitAtlasFailure(regionId);
      restorePriorSchedule();
      return;
    }
    if (loading !== null) {
      cancelPendingAtlasCommit(loading);
      loading.controller.abort();
    }
    loadEpoch += 1;
    if (visibleRegionId !== regionId || cache === null) cancelSchedules();
    const controller = new AbortController();
    const generation: AtlasGeneration = {
      epoch: loadEpoch,
      controller,
      regionId,
      staticTarget,
      observerOnly,
      observerViewRegionId,
      frame,
      batch,
      prerequisites: pendingArrivalPrerequisites(frame),
    };
    loading = generation;
    const ids = [...staticTarget.atlasIds];
    void acquireAtlasBundle(pool, ids, controller).then((acquired) => {
      deferLoadedRegionCommit(generation, acquired);
    }).catch((error: unknown) => {
      if (disposed || loading !== generation) return;
      loading = null;
      emitAtlasFailure(generation.regionId);
      void error;
      restorePriorSchedule();
    });
  };

  /**
   * Whether automatic framing must hold the region the viewer is watching.
   *
   * See {@link STORY_FRAMING_HOLDS_THE_OBSERVED_REGION}. Read live rather than captured,
   * because the scope changes underneath the director as the viewer descends and ascends.
   *
   * Side effects: none.
   */
  const storyFramingHoldsRegion = (): boolean => (
    STORY_FRAMING_HOLDS_THE_OBSERVED_REGION && worldViewScope === "region"
  );

  /**
   * Shared body for switching which region is live: the public `observeRegion` port method (a
   * user- or UI-driven switch) and Z3's camera-driven `syncRegionSheet` focus-follow hysteresis
   * both call this exact function, so a camera-triggered switch goes through the identical
   * `loadRegion` async cache-swap path a manual one already did -- non-destructive for the same
   * reason: `cache` is never torn down until the replacement finishes loading (see `replaceCache`,
   * only ever called from the atlas-commit adoption path).
   */
  const beginObserveRegion = (regionId: string): void => {
    if (disposed) return;
    if (!recipes.has(regionId)) {
      emitFailure({
        kind: "path",
        retryable: false,
        publicMessage: "The selected region is unavailable.",
      });
      return;
    }
    const frame = loading?.frame ?? acceptedFrame;
    const batch = loading?.batch ?? acceptedBatch;
    if (frame === null) {
      emitFailure({
        kind: "path",
        retryable: true,
        publicMessage: "The selected region is not ready yet.",
      });
      return;
    }
    if (loading !== null && loadingIntentMatches(
      loading,
      frame,
      regionId,
      true,
      regionId,
    )) return;
    if (visibleRegionId === regionId && atlasLeases.size > 0) {
      abortLoading();
      restorePriorSchedule();
      return;
    }
    loadRegion(frame, regionId, true, batch, regionId);
  };

  /**
   * The bounds a moment anchor points the camera at, if the world can show them.
   *
   * Ladder, most specific first: the being or structure the moment was about, then the region it
   * happened in. Both are read from the scene graph, so both are `null` until that region is
   * mounted -- which is why a cross-region journey has to wait (see
   * {@link settlePendingMomentTravel}).
   */
  const momentAnchorTarget = (anchor: MomentAnchor): ProductionSceneHitTarget | null => {
    const entity = anchor.entity;
    const direct = entity === null
      ? null
      : graph.focusTarget({ kind: entity.kind, id: entity.id });
    if (direct !== null) return direct;
    return anchor.regionId === null
      ? null
      : graph.focusTarget({ kind: "region", id: anchor.regionId });
  };

  /**
   * Frames a moment anchor the way the director frames a beat, leaving framing with the director.
   *
   * For the moment that IS the present tense: the camera moves to it, but authority stays where it
   * was, so the next beat is not stranded behind a seizure the viewer never asked for. Viewing
   * "now" must not knock the view off live -- the same rule the Chronicle feed applies to its own
   * playhead when its leading card is clicked.
   *
   * Returns whether a target could be resolved; mutates the story focus and the camera.
   */
  const frameMomentAnchorForDirector = (anchor: MomentAnchor): boolean => {
    const target = momentAnchorTarget(anchor);
    if (target === null) return false;
    storyFocusSelection = target.selection;
    storyFocusOwnedByInteraction = true;
    releaseViewerCameraControl();
    camera.apply({
      type: "story-target",
      entityId: target.selectionKey,
      target: target.worldBounds,
    });
    markDirty();
    return true;
  };

  /**
   * Flies the camera to a moment anchor as a VIEWER movement.
   *
   * `fly-to` is the one camera intent honoured while the viewer holds authority, precisely because
   * it only ever exists because the viewer asked for it -- the same intent the world-sheet descent
   * uses. A being or a shelter is framed at reading distance; a bare region is framed whole.
   *
   * Returns whether a target could be resolved; mutates the story focus and the camera.
   */
  const flyToMomentAnchor = (anchor: MomentAnchor): boolean => {
    const target = momentAnchorTarget(anchor);
    if (target === null) return false;
    storyFocusSelection = target.selection;
    storyFocusOwnedByInteraction = true;
    const bounds = target.worldBounds;
    camera.apply({
      type: "fly-to",
      center: { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
      zoom: target.selection.kind === "region"
        ? camera.minimumZoom()
        : Math.max(camera.minimumZoom(), STORY_FIT_MAX_ZOOM),
      durationMs: options.reducedMotion === true ? 0 : MOMENT_TRAVEL_MS,
    });
    markDirty();
    return true;
  };

  /** Abandons a parked journey. Every newer viewer intent supersedes one. */
  const clearPendingMomentTravel = (): void => {
    pendingMomentTravel = null;
  };

  const parkMomentTravel = (anchor: MomentAnchor): void => {
    pendingMomentTravel = Object.freeze({
      anchor,
      deadlineMs: frameDriver.now() + MOMENT_TRAVEL_ARRIVAL_MS,
    });
    markDirty();
  };

  /**
   * Takes the viewer to a moment that is no longer the one on stage.
   *
   * THE FIX for the dead Chronicle click. A moment focus could previously only be resolved against
   * the scene the renderer happened to be playing, so every card except the leading one published
   * a focus request that resolved to nothing at all: no camera move, no message, no clue.
   *
   * Built from the world-sheet descent's recipe, because it is the same act. Authority first: the
   * story director has to stop re-aiming the camera AND the visible region has to stop following
   * the story, and both of those are gated on story mode, so the journey enters free mode exactly
   * the way `setCameraMode("free")` does. Then the region, then the flight. The way back is the
   * one that already exists on screen -- FRAMING Story, or `S`.
   *
   * Mutates camera authority, camera mode, the visible region and the story focus.
   */
  const travelToMoment = (anchor: MomentAnchor): void => {
    clearPendingMomentTravel();
    if (anchor.atLiveEdge) {
      frameMomentAnchorForDirector(anchor);
      return;
    }
    // Guarded on a frame being available because `beginObserveRegion` reports "not ready yet" as
    // a retryable path failure, and the stage treats that as fatal enough to blank itself.
    const arrivalRegionId = anchor.regionId !== null && anchor.regionId !== visibleRegionId
      && recipes.has(anchor.regionId) && (acceptedFrame !== null || loading !== null)
      ? anchor.regionId
      : null;
    // A moment with nowhere to be -- a world-scale beat, "the world wakes" -- must not move the
    // view at all. The presentation has already told the viewer why it cannot be travelled to,
    // and seizing the camera to show them somewhere arbitrary would be a second wrong answer.
    if (arrivalRegionId === null && momentAnchorTarget(anchor) === null) return;
    takeViewerCameraControl();
    camera.apply({ type: "free-pan", deltaCss: { x: 0, y: 0 } });
    if (arrivalRegionId !== null) {
      parkMomentTravel(anchor);
      beginObserveRegion(arrivalRegionId);
      return;
    }
    flyToMomentAnchor(anchor);
  };

  /**
   * Completes a parked journey once its region is on screen, or abandons it at its deadline.
   *
   * Runs on the draw clock, which is the clock every region commit ends on via `markDirty`.
   */
  const settlePendingMomentTravel = (nowMs: number): void => {
    const parked = pendingMomentTravel;
    if (parked === null) return;
    const regionId = parked.anchor.regionId;
    if ((regionId === null || visibleRegionId === regionId)
      && flyToMomentAnchor(parked.anchor)) {
      pendingMomentTravel = null;
      return;
    }
    if (nowMs >= parked.deadlineMs) pendingMomentTravel = null;
  };

  const reconcileLoadingIntentForCameraMode = (): void => {
    const generation = loading;
    if (generation === null) return;
    const mode = camera.snapshot().mode;
    const projectsPendingStoryOntoVisibleRegion = mode !== "story"
      && generation.observerViewRegionId === null
      && visibleRegionId !== null
      && atlasLeases.size > 0
      && (acceptedFrame === null || !sameIdentity(generation.frame, acceptedFrame));
    if (projectsPendingStoryOntoVisibleRegion && visibleRegionId !== null) {
      const pendingFrame = generation.frame;
      const pendingBatch = generation.batch;
      const currentRegionId = visibleRegionId;
      const staticTarget = generation.staticTarget;
      abortLoading();
      if (generation.regionId === currentRegionId
        && !mountedCacheMatches(currentRegionId, staticTarget)) {
        loadRegion(
          pendingFrame,
          currentRegionId,
          false,
          pendingBatch,
          currentRegionId,
          staticTarget,
        );
        return;
      }
      applyFrame(pendingFrame, false, currentRegionId, pendingBatch);
      return;
    }
    const preservesPendingExactFrame = visibleRegionId === generation.regionId
      && generation.staticTarget.recipe.presentationProfile !== undefined
      && !mountedCacheMatches(generation.regionId, generation.staticTarget);
    const frame = preservesPendingExactFrame
      ? generation.frame
      : acceptedFrame ?? generation.frame;
    const regionId = mode === "story"
      ? resolveRegionId(frame, "story", visibleRegionId, null, storyFramingHoldsRegion())
      : visibleRegionId ?? generation.regionId;
    if (regionId === null) {
      abortLoading();
      return;
    }
    const observerOnly = mode === "story" ? true : generation.observerOnly;
    // Same separation as `graphObserverRegionOverride`: under the region hold a story frame can
    // be playing somewhere other than the region being prepared, and the graph must be told.
    const storyPlaysElsewhere = mode === "story"
      && frame.scene?.regionId !== undefined
      && frame.scene.regionId !== regionId;
    const observerViewRegionId = mode === "story" && !storyPlaysElsewhere ? null : regionId;
    if (loadingIntentMatches(
      generation,
      frame,
      regionId,
      observerOnly,
      observerViewRegionId,
    )) return;
    const pendingFrame = frame;
    const pendingBatch = preservesPendingExactFrame || acceptedFrame === null
      ? generation.batch
      : acceptedBatch;
    const sameTargetRegionNeedsPreparation = visibleRegionId === regionId
      && generation.staticTarget.recipe.regionId === regionId
      && !mountedCacheMatches(regionId, generation.staticTarget);
    abortLoading();
    if (visibleRegionId !== regionId || sameTargetRegionNeedsPreparation) {
      loadRegion(
        pendingFrame,
        regionId,
        observerOnly,
        pendingBatch,
        observerViewRegionId,
        sameTargetRegionNeedsPreparation ? generation.staticTarget : null,
      );
    }
  };

  const abortLoading = (): void => {
    if (loading === null) return;
    const generation = loading;
    loadEpoch += 1;
    cancelPendingAtlasCommit(generation);
    generation.controller.abort();
    loading = null;
  };

  const delegate: ObserverRendererPort = {
    updatePresentation(input): void {
      if (disposed) return;
      assertValidFrameIdentity(input);
      if (acceptedIdentity !== null
        && input.runId === acceptedIdentity.runId
        && input.sourceKey === acceptedIdentity.sourceKey
        && (input.revision <= acceptedIdentity.revision
          || input.firstCursor < acceptedIdentity.firstCursor
          || input.lastCursor < acceptedIdentity.lastCursor)) return;
      if (loading !== null && sameLineage(input, loading.frame)
        && !isFresherFrame(input, loading.frame)) return;
      const frame = structuredClone(input);
      const regionId = resolveRegionId(
        frame,
        camera.snapshot().mode,
        visibleRegionId,
        checkpointReturnRegion(frame),
        storyFramingHoldsRegion(),
      );
      if (regionId === null || !recipes.has(regionId)) {
        emitFailure({ kind: "canvas", retryable: false, publicMessage: "The selected region is unavailable." });
        return;
      }
      const currentRecipe = recipes.get(regionId)!;
      let exactStaticTarget: StaticSceneLoadTarget | null = null;
      if (currentRecipe.presentationProfile !== undefined) {
        try {
          exactStaticTarget = describeStaticSceneTarget(regionId, frame);
        } catch {
          emitAtlasFailure(regionId);
          restorePriorSchedule();
          return;
        }
      }
      const exactStaticCacheDrift = exactStaticTarget !== null && (
        cache === null
        || cache.regionId !== regionId
        || !sameProductionStaticSceneDescriptor(
          cache.descriptor,
          exactStaticTarget.descriptor,
        )
      );
      adoptCheckpointCameraOwnership(frame);
      const pendingHighWater = pendingArrivalHighWater(frame);
      if (pendingHighWater !== null
        && !sameIdentity(frame, pendingHighWater.frame)
        && !isFresherFrame(frame, pendingHighWater.frame)) return;
      for (let index = pendingArrivalCommits.length - 1; index >= 0; index -= 1) {
        if (!sameLineage(frame, pendingArrivalCommits[index]!.frame)) {
          pendingArrivalCommits.splice(index, 1);
        }
      }
      restorePendingArrivalContinuity(frame);
      const batch = resolveFrameCommands(frame);
      rememberPendingArrivalCommit(frame, batch);
      const observerViewRegionId = graphObserverRegionOverride(frame, regionId);
      if (loading !== null) {
        if (loadingIntentMatches(
          loading,
          frame,
          regionId,
          false,
          observerViewRegionId,
          exactStaticTarget,
        )) {
          if (isFresherFrame(frame, loading.frame)) {
            if (isTransactionCriticalArrival(frame, batch) && batch !== null
              && !loading.prerequisites.some(({ frame: pending }) => sameIdentity(pending, frame))) {
              loading.prerequisites.push({ frame, batch });
            }
            loading.frame = frame;
            loading.batch = batch;
          }
          return;
        }
        if (visibleRegionId === regionId && atlasLeases.size > 0) {
          abortLoading();
          if (exactStaticCacheDrift) {
            loadRegion(
              frame,
              regionId,
              false,
              batch,
              observerViewRegionId,
              exactStaticTarget,
            );
            return;
          }
          applyFrame(frame, false, regionId, batch);
          return;
        }
      }
      if (visibleRegionId === regionId && atlasLeases.size > 0) {
        if (exactStaticCacheDrift) {
          loadRegion(
            frame,
            regionId,
            false,
            batch,
            observerViewRegionId,
            exactStaticTarget,
          );
          return;
        }
        applyFrame(frame, false, regionId, batch);
        return;
      }
      loadRegion(
        frame,
        regionId,
        false,
        batch,
        observerViewRegionId,
        exactStaticTarget,
      );
    },
    setSelection(next): void {
      if (disposed) return;
      if (sameSelection(selection, next)) return;
      selection = next;
      selectionOwnedByInteraction = true;
      callbacks.onSelectionChange?.(next);
      if (camera.snapshot().mode === "follow" && next !== null
        && next.kind !== "moment" && next.kind !== "region") {
        const target = graph.focusTarget(next);
        if (target !== null) camera.apply({ type: "follow", entityId: target.selectionKey });
      }
      markDirty();
    },
    focusSelection(next): void {
      if (disposed) return;
      clearPendingMomentTravel();
      const resolved = next.kind === "moment"
        ? selectionForAcceptedMoment(next, acceptedFrame)
        : next;
      if (resolved === null && next.kind === "moment" && next.anchor !== undefined) {
        travelToMoment(next.anchor);
        return;
      }
      const target = resolved === null ? null : graph.focusTarget(resolved);
      if (target !== null) {
        storyFocusSelection = resolved;
        storyFocusOwnedByInteraction = true;
        // A focus request is an EXPLICIT "point the camera here", so it both moves the camera
        // and hands framing back to the director -- unlike a pan or a zoom, which mean "I am
        // driving". Without the release a viewer (or the QA guided tour, which drives this same
        // public port once per beat) would click Focus and watch nothing happen.
        releaseViewerCameraControl();
        camera.apply({
          type: "story-target",
          entityId: target.selectionKey,
          target: target.worldBounds,
        });
      }
      markDirty();
    },
    observeRegion(regionId): void {
      clearPendingMomentTravel();
      beginObserveRegion(regionId);
    },
    setSafeFrame(insets): void {
      if (disposed) return;
      safeFrameInsets = normalizeInsets(insets);
      camera.setSafeFrame(safeFrameInsets);
      markDirty();
    },
    setCameraMode(mode): void {
      if (disposed) return;
      clearPendingMomentTravel();
      // Story and Follow are DIRECTOR modes; choosing either is the explicit request that ends
      // viewer authority. That request must be honoured even when the camera is nominally
      // already in that mode, because a viewer zoom takes authority WITHOUT changing the mode --
      // refusing the release there is exactly what left the camera stranded with no way back.
      const releases = mode !== "free" && viewerControlsCamera;
      if (mode === camera.snapshot().mode && !releases) return;
      if (mode === "story") {
        releaseViewerCameraControl();
        camera.apply({ type: "return-story" });
        if (acceptedFrame !== null) {
          const storyRegionId = resolveRegionId(
            acceptedFrame,
            "story",
            visibleRegionId,
            null,
            storyFramingHoldsRegion(),
          );
          if (storyRegionId !== null && recipes.has(storyRegionId)
            && storyRegionId !== visibleRegionId) {
            loadRegion(acceptedFrame, storyRegionId, true, acceptedBatch, null);
          }
        }
      }
      else if (mode === "follow") {
        if (selection === null || selection.kind === "moment" || selection.kind === "region") {
          emitFailure({
            kind: "path",
            retryable: true,
            publicMessage: "Choose a being or home before following.",
          });
          return;
        }
        const target = graph.focusTarget(selection);
        if (target === null) {
          emitFailure({
            kind: "path",
            retryable: true,
            publicMessage: "Choose a being or home before following.",
          });
          return;
        }
        // Follow is an automatic framing mode the viewer asked for, so selecting it releases
        // authority rather than taking it -- otherwise the mode would be inert on arrival.
        releaseViewerCameraControl();
        camera.apply({ type: "follow", entityId: target.selectionKey });
      } else {
        // Free IS the viewer's mode.
        takeViewerCameraControl();
        camera.apply({ type: "free-pan", deltaCss: { x: 0, y: 0 } });
      }
      reconcileLoadingIntentForCameraMode();
      callbacks.onCameraModeChange?.(mode);
      markDirty();
    },
    panCamera(deltaCss): void {
      if (disposed) return;
      clearPendingMomentTravel();
      const was = camera.snapshot().mode;
      // Viewer intent: a pan is the plainest statement of "I am driving now".
      takeViewerCameraControl();
      camera.apply({ type: "free-pan", deltaCss });
      if (was !== "free") {
        reconcileLoadingIntentForCameraMode();
        callbacks.onCameraModeChange?.("free");
      }
      markDirty();
    },
    zoomCamera(factor, anchorCss): void {
      if (disposed) return;
      clearPendingMomentTravel();
      // Viewer intent. Note a zoom deliberately does NOT change the camera mode, which is why
      // the release affordance has to work while the mode is unchanged (see `setCameraMode`).
      takeViewerCameraControl();
      const nowMs = frameDriver.now();
      const continuingGesture = lastViewerZoomAtMs !== null
        && nowMs - lastViewerZoomAtMs < DETENT_GESTURE_GAP_MS;
      lastViewerZoomAtMs = nowMs;
      if (continuingGesture && navigationFlightInFlight(nowMs)) return;
      // Inside a region the zoom floor is a DETENT, not a wall: a zoom-out that presses against it
      // offers the way out (and is still applied, so the control never feels dead); a second,
      // separate zoom-out gesture takes it. This is what stops "zoomed out one notch too far" from
      // ejecting a viewer who is inspecting a place.
      if (zoomOutDetentConsumesZoom(factor, nowMs)) return;
      camera.apply({ type: "zoom", factor, anchorCss });
      markDirty();
    },
    hoverAt(anchorCss): void {
      if (disposed || !worldSheetSnapshotsEnabled) return;
      const next = anchorCss === null || worldViewScope !== "world"
        ? null
        : (() => {
            const point = localPointFromCanvas(anchorCss);
            return point === null ? null : regionAtLocalPoint(point);
          })();
      if (next === hoveredRegionId) return;
      hoveredRegionId = next;
      publishNavigationState();
      markDirty();
    },
    enterRegionAt(anchorCss): void {
      if (disposed || !worldSheetSnapshotsEnabled) return;
      const point = localPointFromCanvas(anchorCss);
      if (point === null) return;
      const regionId = regionAtLocalPoint(point);
      if (regionId === null) return;
      descendIntoRegion(regionId, frameDriver.now());
    },
    exitToWorldView(): void {
      if (disposed) return;
      ascendToWorldView(frameDriver.now());
    },
    selectAt(anchorCss): void {
      selectAtCanvasPoint(anchorCss);
    },
    resize(cssWidth, cssHeight): void {
      if (disposed || !Number.isFinite(cssWidth) || cssWidth <= 0
        || !Number.isFinite(cssHeight) || cssHeight <= 0) return;
      const width = Math.max(1, Math.floor(cssWidth));
      const height = Math.max(1, Math.floor(cssHeight));
      canvas.width = width;
      canvas.height = height;
      renderRasterOrigin = null;
      renderZoom = null;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      canvas.style.position = "relative";
      canvas.style.left = `${Math.floor((cssWidth - width) / 2)}px`;
      canvas.style.top = `${Math.floor((cssHeight - height) / 2)}px`;
      context.imageSmoothingEnabled = false;
      camera.setViewport(width, height);
      markDirty();
    },
    diagnostics,
    dispose(): void {
      if (disposed) return;
      disposed = true;
      cancelSchedules();
      dirty = false;
      visibilityTarget.removeEventListener("visibilitychange", onVisibilityChange);
      options.signal?.removeEventListener("abort", onAbort);
      abortLoading();
      graph.dispose();
      releaseLeases(atlasLeases.values());
      atlasLeases.clear();
      replaceCache(null);
      for (const build of [...backgroundSnapshotBuilds.values()]) cancelBackgroundSnapshotBuild(build);
      for (const regionId of [...snapshotOwners.keys()]) snapshotCache.delete(regionId);
      activeSheetLocalRects = null;
      activeSheetLocalBounds = null;
      activeSheetLodSnapshotZoom = null;
      activeCameraSheet = null;
      worldViewScope = null;
      sheetOriginRegionId = null;
      hoveredRegionId = null;
      pendingDescent = null;
      ascentLandsAtMs = null;
      lastViewerZoomAtMs = null;
      publishedNavigation = null;
      exitOffered = false;
      zoomOutDetent = createZoomOutDetentState();
      acceptedFrame = null;
      acceptedBatch = null;
      arrivalContinuity = null;
      pendingArrivalCommits.length = 0;
      pendingFrameAcceptance = null;
      pendingCameraAdoption = null;
      pendingSceneCommandCommit = null;
      pendingSemanticPublication = false;
      pendingSemanticSnapshot = null;
      cameraTargetIds.clear();
      cameraImpulse = null;
      checkpointCameraOwnership = null;
      renderRasterOrigin = null;
      renderZoom = null;
      if (ownsPool) pool.dispose();
      surfaceLease.release();
    },
  };

  const guarded = createGuardedObserverRendererPort(delegate);

  /**
   * Selects whatever is drawn at a canvas position. See {@link ObserverRendererPort.selectAt}: this
   * is a *completed click*, delivered by the host, never the renderer's own canvas press. The host
   * owns the drag dead zone, so it owns the only decision that can tell a click from a pan.
   */
  const selectAtCanvasPoint = (anchorCss: Vec2): void => {
    if (disposed) return;
    // A click while a descent is in the air belongs to the NAVIGATION gesture that started it, not
    // to selection. A double-click arrives as two clicks: the first launches the fall, the second is
    // already inert for descending -- but without this it still hit-tested, selected the region it
    // landed on, and popped the Selection drawer over a third of the frame. One gesture, one thing.
    if (pendingDescent !== null) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const targets = hitTargets(graph);
    if (targets.length === 0) return;
    const screen = {
      x: anchorCss.x * canvas.width / rect.width,
      y: anchorCss.y * canvas.height / rect.height,
    };
    const snapshot = camera.snapshot();
    const actualOrigin = renderRasterOrigin ?? boundedRasterOrigin(
      snapshot,
      cameraImpulse?.offset ?? { x: 0, y: 0 },
      canvas.width,
      canvas.height,
      activeRasterClampRect(snapshot.zoom),
    );
    const actualZoom = renderZoom ?? snapshot.zoom;
    const presentedWorld = {
      x: (screen.x - actualOrigin.x) / actualZoom,
      y: (screen.y - actualOrigin.y) / actualZoom,
    };
    const descriptor = cache?.descriptor ?? null;
    const world = descriptor?.topology === "toroidal"
      ? {
          x: wrapCoordinate(
            presentedWorld.x,
            descriptor.worldBounds.x,
            descriptor.worldBounds.width,
          ),
          y: wrapCoordinate(
            presentedWorld.y,
            descriptor.worldBounds.y,
            descriptor.worldBounds.height,
          ),
        }
      : presentedWorld;
    const candidates = targets.filter((target) => (
      descriptor?.topology === "toroidal"
        ? distanceToPeriodicRect(world, target.worldBounds, descriptor.worldBounds)
        : distanceToRect(world, target.worldBounds)
    ) <= SELECTION_PICK_TOLERANCE_WORLD_PX);
    const entityCandidates = candidates.filter(({ selection: targetSelection }) =>
      targetSelection.kind !== "region" && targetSelection.kind !== "moment");
    const selected = (entityCandidates.length > 0 ? entityCandidates : candidates)
      .slice()
      .sort(compareHitTargets)[0];
    if (selected !== undefined) delegate.setSelection(selected.selection);
  };

  const onVisibilityChange = (): void => {
    if (disposed) return;
    hidden = visibilityTarget.hidden;
    cancelSchedules();
    if (!hidden && acceptedIdentity !== null) {
      dirty = true;
      scheduleFrame();
    }
  };

  const onAbort = (): void => guarded.dispose();
  visibilityTarget.addEventListener("visibilitychange", onVisibilityChange);
  options.signal?.addEventListener("abort", onAbort, { once: true });

  return Object.assign(guarded, {
    debug(): CanvasPresentationRendererDebug {
      const graphSnapshot = graph.debugSnapshot();
      const visibleRecipe = cache?.regionId === visibleRegionId
        ? cache.recipe
        : null;
      return deepFreezeDebug({
        frameIdentity: acceptedIdentity === null ? null : { ...acceptedIdentity },
        visibleRegionId,
        loadingRegionId: loading?.regionId ?? null,
        staticCacheRegions: cache === null ? [] : [cache.regionId],
        mountedStaticCache: cache === null
          ? null
          : {
              regionId: cache.regionId,
              staticCacheIdentity: cache.staticCacheIdentity,
            },
        visibleRecipe: visibleRecipe === null
          ? null
          : {
              regionId: visibleRecipe.regionId,
              identityHash: visibleRecipe.identityHash,
              grid: {
                columns: visibleRecipe.grid.columns,
                rows: visibleRecipe.grid.rows,
              },
              presentationProfile: visibleRecipe.presentationProfile === undefined
                ? null
                : { ...visibleRecipe.presentationProfile },
            },
        staticLayerRebuilds,
        staticArtFallbacks: staticArtFallbackKeys.size,
        camera: { ...camera.snapshot(), safeFrameInsets: { ...safeFrameInsets } },
        worldNavigation: {
          scope: worldViewScope,
          focusedRegionId,
          frameOriginRegionId: sheetOriginRegionId,
          hoveredRegionId,
          minimumZoom: camera.minimumZoom(),
          descendingIntoRegionId: pendingDescent?.regionId ?? null,
          // Non-null means "unresolved", which is the honest reading now that landing is the
          // camera's answer and not the clock's (see `cameraFlightInProgress`).
          ascending: ascentLandsAtMs !== null,
          exitOffered,
        },
        cameraImpulse: cameraImpulse === null
          ? null
          : { offset: { ...cameraImpulse.offset }, untilMs: cameraImpulse.untilMs },
        beatFraming: beatFraming === null
          ? null
          : {
              momentId: beatFraming.momentId,
              union: { ...beatFraming.union },
              primaryKey: beatFraming.primaryKey,
              holdUntilMs: beatFraming.holdUntilMs,
              holdRemainingMs: beatFraming.holdUntilMs === null
                ? null
                : Math.max(0, beatFraming.holdUntilMs - frameDriver.now()),
            },
        beatFramingSkip,
        momentTravel: pendingMomentTravel === null
          ? null
          : {
              entityId: pendingMomentTravel.anchor.entity?.id ?? null,
              regionId: pendingMomentTravel.anchor.regionId,
              remainingMs: Math.max(0, pendingMomentTravel.deadlineMs - frameDriver.now()),
            },
        renderRasterOrigin: renderRasterOrigin === null ? null : { ...renderRasterOrigin },
        postCommit: {
          acceptancePending: pendingFrameAcceptance !== null,
          semanticPending: pendingSemanticPublication,
        },
        lastInternalFailure,
        graph: {
          ...graphSnapshot,
          activeActors: graphSnapshot.actors.length,
          activeHomes: graphSnapshot.homes.length,
          activeEffects: activeGraphEffects(graphSnapshot),
        },
        scheduler: {
          hidden,
          dirty,
          rafScheduled: rafOwner !== null,
          wakeScheduled: wakeOwner !== null,
          nextDeadlineMs: wakeOwner?.atMs ?? null,
          reason: wakeOwner?.reason ?? null,
        },
        pool: pool.diagnostics(),
        draw: drawDiagnostics(
          drawDurations,
          drawDurationCount,
          drawDurationTotalCount,
          drawDurationCursor,
        ),
        cache: {
          created: cacheOwnersCreated,
          disposed: cacheOwnersDisposed,
          outstanding: cacheOwnersCreated - cacheOwnersDisposed,
          peak: peakCacheOwners,
          lastRebuildReason: lastCacheRebuildReason,
          pixelLossRecoveries: staticCachePixelLossRecoveries,
          pixelsLost: mountedStaticCacheLostPixels(),
        },
      });
    },
  });

  function emitAtlasFailure(regionId: string): void {
    const projected = publicRendererFailure(decideAssetFallback({
      failure: "atlas-load",
      subjectId: null,
      regionId,
      occurrence: 1,
    }));
    if (projected !== null) emitFailure(projected);
  }

  function reportOptionalVisualFailures(
    frame: PresentedObserverFrame,
    batch: ProductionSceneCommandBatch,
    commands: readonly ProductionSceneCommand[],
    ignoredCommandIds: readonly string[],
  ): void {
    if (ignoredCommandIds.length === 0) return;
    const ignored = new Set(ignoredCommandIds);
    for (const command of commands) {
      if (!ignored.has(command.commandId) || !isOptionalVisualCommand(command)) continue;
      const key = `${batch.sceneToken}:${command.commandId}`;
      if (reportedOptionalVisualFailures.has(key)) continue;
      reportedOptionalVisualFailures.add(key);
      const failure = publicRendererFailure(decideMarkerFallback({
        markerRole: "optional-effect",
        optional: true,
        subjectId: command.commandId,
        regionId: visibleRegionId,
        occurrence: 1,
      }));
      if (failure !== null) emitFailure(failure);
      if (disposed || acceptedFrame === null || !sameIdentity(acceptedFrame, frame)) return;
    }
  }
}

function isOptionalVisualCommand(command: ProductionSceneCommand): boolean {
  return command.kind === "environment"
    || command.kind === "remote-transient"
    || command.kind === "hit-stop";
}

function deepFreezeDebug<T>(value: T): T {
  if (value === null || typeof value !== "object" || ArrayBuffer.isView(value)) return value;
  for (const item of Object.values(value as Record<string, unknown>)) deepFreezeDebug(item);
  return Object.freeze(value);
}

function normalizeRecipes(
  input: ReadonlyMap<string, RegionMapRecipeV1> | readonly RegionMapRecipeV1[],
): ReadonlyMap<string, RegionMapRecipeV1> {
  if (Array.isArray(input)) {
    return new Map(input.map((recipe) => [recipe.regionId, recipe]));
  }
  return input as ReadonlyMap<string, RegionMapRecipeV1>;
}

function placementSourceIdentity(placement: PlacementLedger): symbol | PlacementLedger {
  return typeof placement.sourceIdentity === "function"
    ? placement.sourceIdentity()
    : placement;
}

function recipeIdentitiesChanged(
  current: ReadonlyMap<string, RegionMapRecipeV1>,
  initial: readonly (readonly [string, RegionMapRecipeV1])[],
): boolean {
  if (current.size !== initial.length) return true;
  return initial.some(([regionId, recipe]) => current.get(regionId) !== recipe);
}

function identityOf(frame: PresentedObserverFrame): FrameIdentity {
  return {
    runId: frame.runId,
    sourceKey: frame.sourceKey,
    revision: frame.revision,
    firstCursor: frame.firstCursor,
    lastCursor: frame.lastCursor,
  };
}

function sameLineage(left: FrameIdentity, right: FrameIdentity): boolean {
  return left.runId === right.runId && left.sourceKey === right.sourceKey;
}

function sameIdentity(left: FrameIdentity, right: FrameIdentity): boolean {
  return sameLineage(left, right)
    && left.revision === right.revision
    && left.firstCursor === right.firstCursor
    && left.lastCursor === right.lastCursor;
}

function validCameraImpulse(
  command: Extract<ProductionSceneCommand, { kind: "camera-impulse" }>,
): boolean {
  return Number.isFinite(command.durationMs)
    && command.durationMs >= 60
    && command.durationMs <= 90
    && Number.isInteger(command.offset.x)
    && Number.isInteger(command.offset.y)
    && Math.abs(command.offset.x) + Math.abs(command.offset.y) === 1;
}

function validBatchForFrame(
  frame: PresentedObserverFrame,
  batch: ProductionSceneCommandBatch | null,
  activeSceneToken: number,
): boolean {
  return batch === null || (
    sameIdentity(batch.identity, frame)
    && batch.sceneToken >= activeSceneToken
    && isValidProductionSceneCommandBatch(batch)
  );
}

function enteredArrivalDestination(
  frame: PresentedObserverFrame,
  batch: ProductionSceneCommandBatch | null,
): string | null {
  const scene = frame.scene;
  if (scene === null || batch === null || !isValidProductionSceneCommandBatch(batch)
    || !sameIdentity(batch.identity, frame) || scene.phase !== "hold"
    || scene.execution?.eventType !== "agent_entered_region"
    || scene.execution.sceneToken !== batch.sceneToken) return null;
  const programId = `choreography:${scene.momentId}:agent_entered_region`;
  if (scene.execution.programId !== programId) return null;
  const matches = batch.commands.filter((command) => command.kind === "stage-arrival"
    && command.eventType === "agent_entered_region"
    && command.phase === "hold"
    && command.momentId === scene.momentId
    && command.programId === programId
    && command.fromRegion !== command.toRegion
    && command.toRegion === scene.regionId);
  return matches.length > 0 ? scene.regionId : null;
}

function isTransactionCriticalArrival(
  frame: PresentedObserverFrame,
  batch: ProductionSceneCommandBatch | null,
): boolean {
  const scene = frame.scene;
  return scene?.phase === "consequence"
    && scene.execution?.eventType === "agent_entered_region"
    && batch !== null
    && sameIdentity(batch.identity, frame)
    && batch.sceneToken === scene.execution.sceneToken
    && batch.commands.filter((command) => (
      command.kind === "placement-hint" && command.context.kind === "arrival"
    )).length === 1;
}

function reconcileArrivalContinuity(
  current: ArrivalContinuity | null,
  frame: PresentedObserverFrame,
  batch: ProductionSceneCommandBatch | null,
  recipes: ReadonlyMap<string, RegionMapRecipeV1>,
): ArrivalContinuity | null {
  const scene = frame.scene;
  const execution = scene?.execution;
  if (batch === null || !sameIdentity(batch.identity, frame)) return null;
  const sameLineageContinuity = current !== null
    && current.runId === frame.runId && current.sourceKey === frame.sourceKey
    ? current
    : null;
  if (scene === null) {
    const clearCommands = batch.commands.filter((command) => command.kind === "clear-scene");
    return sameLineageContinuity !== null
      && batch.sceneToken === sameLineageContinuity.sceneToken
      && sameLineageContinuity.phase === "exit"
      && clearCommands.length === 1 && batch.commands.length === 1
      ? { ...sameLineageContinuity, phase: "gap" }
      : null;
  }
  if (execution === undefined || execution.sceneToken !== batch.sceneToken) return null;
  if (execution.eventType === "agent_left_region") {
    const expectedProgramId = `choreography:${scene.momentId}:agent_left_region`;
    if (execution.programId !== expectedProgramId) return null;
    const retained = batch.commands.filter(
      (command): command is Extract<ProductionSceneCommand, { kind: "retain-traveler" }> => (
        command.kind === "retain-traveler"
        && command.fromRegion === scene.regionId
        && command.fromRegion !== command.toRegion
      ),
    );
    if (scene.phase === "enter" || scene.phase === "hold") {
      if (retained.length !== 1) return null;
      const command = retained[0]!;
      if (scene.focus?.kind !== "agent" || scene.focus.id !== command.actorId
        || !hasDirectedArrivalGate(recipes, command.fromRegion, command.toRegion)) return null;
      const continuesDeparture = sameLineageContinuity?.leg === "departure"
        && sameLineageContinuity.sceneToken === batch.sceneToken
        && sameLineageContinuity.momentId === scene.momentId
        && sameLineageContinuity.programId === expectedProgramId
        && sameLineageContinuity.actorId === command.actorId
        && sameLineageContinuity.fromRegion === command.fromRegion
        && sameLineageContinuity.toRegion === command.toRegion
        && travelPhaseOrder(scene.phase) >= travelPhaseOrder(sameLineageContinuity.phase);
      const supersedesArrival = sameLineageContinuity !== null
        && canSupersedeArrival(sameLineageContinuity, command, batch.sceneToken, recipes);
      if (sameLineageContinuity !== null && !continuesDeparture && !supersedesArrival) return null;
      return {
        runId: frame.runId,
        sourceKey: frame.sourceKey,
        sceneToken: batch.sceneToken,
        momentId: scene.momentId,
        programId: expectedProgramId,
        actorId: command.actorId,
        fromRegion: command.fromRegion,
        toRegion: command.toRegion,
        leg: "departure",
        phase: scene.phase,
      };
    }
    if (sameLineageContinuity === null
      || sameLineageContinuity.leg !== "departure"
      || sameLineageContinuity.sceneToken !== batch.sceneToken
      || sameLineageContinuity.momentId !== scene.momentId
      || sameLineageContinuity.programId !== expectedProgramId
      || sameLineageContinuity.fromRegion !== scene.regionId
      || scene.focus?.kind !== "agent" || scene.focus.id !== sameLineageContinuity.actorId
      || travelPhaseOrder(scene.phase) < travelPhaseOrder(sameLineageContinuity.phase)
      || travelCommandsContradict(sameLineageContinuity, batch)) return null;
    return { ...sameLineageContinuity, phase: scene.phase };
  }
  if (execution.eventType !== "agent_entered_region") return null;
  if (scene.phase === "enter") {
    const expectedProgramId = `choreography:${scene.momentId}:agent_entered_region`;
    if (execution.programId !== expectedProgramId) return null;
    const commands = batch.commands.filter(
      (command): command is Extract<ProductionSceneCommand, { kind: "retain-traveler" }> => (
        command.kind === "retain-traveler"
        && command.fromRegion === scene.regionId
        && command.fromRegion !== command.toRegion
      ),
    );
    if (commands.length !== 1) return null;
    const command = commands[0]!;
    if (scene.focus?.kind !== "agent" || scene.focus.id !== command.actorId
      || !hasDirectedArrivalGate(recipes, command.fromRegion, command.toRegion)) return null;
    if (sameLineageContinuity !== null && sameLineageContinuity.leg === "departure"
      && (sameLineageContinuity.phase !== "gap"
        || batch.sceneToken !== sameLineageContinuity.sceneToken + 1
        || command.actorId !== sameLineageContinuity.actorId
        || command.fromRegion !== sameLineageContinuity.fromRegion
        || command.toRegion !== sameLineageContinuity.toRegion)) return null;
    if (sameLineageContinuity !== null && sameLineageContinuity.leg === "arrival") {
      const continuesArrival = sameLineageContinuity.sceneToken === batch.sceneToken
        && sameLineageContinuity.momentId === scene.momentId
        && sameLineageContinuity.programId === expectedProgramId
        && sameLineageContinuity.actorId === command.actorId
        && sameLineageContinuity.fromRegion === command.fromRegion
        && sameLineageContinuity.toRegion === command.toRegion
        && travelPhaseOrder(scene.phase) >= travelPhaseOrder(sameLineageContinuity.phase);
      if (!continuesArrival
        && !canSupersedeArrival(sameLineageContinuity, command, batch.sceneToken, recipes)) return null;
    }
    return {
      runId: frame.runId,
      sourceKey: frame.sourceKey,
      sceneToken: batch.sceneToken,
      momentId: scene.momentId,
      programId: expectedProgramId,
      actorId: command.actorId,
      fromRegion: command.fromRegion,
      toRegion: command.toRegion,
      leg: "arrival",
      phase: "enter",
    };
  }
  if (scene.phase === "hold") {
    const expectedProgramId = `choreography:${scene.momentId}:agent_entered_region`;
    if (execution.programId !== expectedProgramId) return null;
    const commands = batch.commands.filter(
      (command): command is Extract<ProductionSceneCommand, { kind: "stage-arrival" }> => (
      command.kind === "stage-arrival"
      && command.eventType === "agent_entered_region"
      && command.phase === "hold"
      && command.momentId === scene.momentId
      && command.programId === expectedProgramId
      && command.fromRegion !== command.toRegion
      && command.toRegion === scene.regionId
      ),
    );
    if (commands.length !== 1) return null;
    const command = commands[0]!;
    if (scene.focus?.kind !== "agent" || scene.focus.id !== command.actorId) return null;
    if (sameLineageContinuity !== null && (
      sameLineageContinuity.leg !== "arrival"
      || sameLineageContinuity.sceneToken !== batch.sceneToken
      || sameLineageContinuity.momentId !== scene.momentId
      || sameLineageContinuity.programId !== expectedProgramId
      || sameLineageContinuity.actorId !== command.actorId
      || sameLineageContinuity.fromRegion !== command.fromRegion
      || sameLineageContinuity.toRegion !== command.toRegion
      || travelPhaseOrder(scene.phase) < travelPhaseOrder(sameLineageContinuity.phase)
    )) return null;
    return {
      runId: frame.runId,
      sourceKey: frame.sourceKey,
      sceneToken: batch.sceneToken,
      momentId: scene.momentId,
      programId: expectedProgramId,
      actorId: command.actorId,
      fromRegion: command.fromRegion,
      toRegion: command.toRegion,
      leg: "arrival",
      phase: "hold",
    };
  }
  if (current === null || current.runId !== frame.runId || current.sourceKey !== frame.sourceKey
    || current.leg !== "arrival" || current.sceneToken !== batch.sceneToken
    || current.momentId !== scene.momentId || current.programId !== execution.programId
    || current.toRegion !== scene.regionId
    || scene.focus?.kind !== "agent" || scene.focus.id !== current.actorId
    || travelPhaseOrder(scene.phase) < travelPhaseOrder(current.phase)
    || travelCommandsContradict(current, batch)) return null;
  if (scene.phase === "consequence") {
    const arrival = batch.commands.filter((command) => (
      command.kind === "placement-hint"
      && command.context.kind === "arrival"
      && command.agentId === current.actorId
      && command.context.fromRegion === current.fromRegion
    ));
    return arrival.length === 1 ? { ...current, phase: "consequence" } : null;
  }
  if ((scene.phase === "recover" || scene.phase === "exit")
    && (current.phase === "consequence" || current.phase === "recover" || current.phase === "exit")) {
    return { ...current, phase: scene.phase };
  }
  return null;
}

function travelPhaseOrder(phase: ArrivalContinuity["phase"]): number {
  switch (phase) {
    case "enter": return 0;
    case "hold": return 1;
    case "consequence": return 2;
    case "recover": return 3;
    case "exit": return 4;
    case "gap": return 5;
  }
}

function travelCommandsContradict(
  continuity: ArrivalContinuity,
  batch: ProductionSceneCommandBatch,
): boolean {
  return batch.commands.some((command) => {
    if (command.kind === "clear-scene") return true;
    if (command.kind === "retain-traveler") {
      return command.actorId !== continuity.actorId
        || command.fromRegion !== continuity.fromRegion
        || command.toRegion !== continuity.toRegion;
    }
    if (command.kind === "stage-arrival") {
      return continuity.leg !== "arrival"
        || command.actorId !== continuity.actorId
        || command.fromRegion !== continuity.fromRegion
        || command.toRegion !== continuity.toRegion
        || command.momentId !== continuity.momentId
        || command.programId !== continuity.programId;
    }
    return command.kind === "placement-hint" && command.context.kind === "arrival"
      ? command.agentId !== continuity.actorId
        || command.context.fromRegion !== continuity.fromRegion
      : false;
  });
}

function canSupersedeArrival(
  current: ArrivalContinuity,
  command: Readonly<{
    actorId: string;
    fromRegion: string;
    toRegion: string;
  }>,
  sceneToken: number,
  recipes: ReadonlyMap<string, RegionMapRecipeV1>,
): boolean {
  return current.leg === "arrival"
    && (current.phase === "consequence" || current.phase === "recover"
      || current.phase === "exit" || current.phase === "gap")
    && sceneToken > current.sceneToken
    && current.actorId === command.actorId
    && current.toRegion === command.fromRegion
    && hasDirectedArrivalGate(recipes, command.fromRegion, command.toRegion);
}

function hasDirectedArrivalGate(
  recipes: ReadonlyMap<string, RegionMapRecipeV1>,
  fromRegion: string,
  toRegion: string,
): boolean {
  return fromRegion !== toRegion && recipes.get(toRegion)?.gates.some((gate) => (
    gate.role === "arrival" && gate.edge.from === fromRegion && gate.edge.to === toRegion
  )) === true;
}

function retainedArrivalDestination(
  continuity: ArrivalContinuity | null,
  frame: PresentedObserverFrame,
  batch: ProductionSceneCommandBatch | null,
): string | null {
  if (continuity === null || batch === null || !sameIdentity(batch.identity, frame)
    || continuity.runId !== frame.runId || continuity.sourceKey !== frame.sourceKey
    || continuity.sceneToken !== batch.sceneToken) return null;
  if (frame.scene === null) {
    const clearCommands = batch.commands.filter((command) => command.kind === "clear-scene");
    return continuity.phase === "gap" && clearCommands.length === 1 && batch.commands.length === 1
      ? continuity.toRegion
      : null;
  }
  if (continuity.momentId !== frame.scene.momentId
    || continuity.programId !== frame.scene.execution?.programId) return null;
  return continuity.toRegion;
}

interface AppliedGraphFrame {
  readonly diff: SceneGraphDiff;
  readonly commands: ProductionSceneFrameResult["commands"];
  readonly committedAtMs: number;
}

function applyGraphFrame(
  graph: ProductionSceneGraph,
  frame: PresentedObserverFrame,
  batch: ProductionSceneCommandBatch | null,
  nowMs: number,
  observerViewRegionId: string | null = null,
): AppliedGraphFrame | null {
  if (graph.applyFrame !== undefined) {
    const receipt = graph.applyFrame(frame, batch, nowMs, observerViewRegionId, false);
    return receipt.outcome === "accepted" && receipt.diff !== null
      ? { diff: receipt.diff, commands: receipt.commands, committedAtMs: nowMs }
      : null;
  }
  const diff = graph.update(frame, batch, observerViewRegionId);
  if (diff.outcome !== "applied") return null;
  const graphCommands = batch?.commands.filter((command) => command.kind !== "camera-impulse") ?? [];
  const commands = batch === null || graphCommands.length === 0
    ? null
    : graph.applySceneCommands({ ...batch, commands: graphCommands }, nowMs);
  if (commands !== null && (commands.outcome === "invalid"
    || commands.outcome === "stale-identity" || commands.outcome === "stale-scene")) return null;
  return { diff, commands, committedAtMs: nowMs };
}

function isFresherFrame(candidate: FrameIdentity, current: FrameIdentity): boolean {
  return sameLineage(candidate, current)
    && candidate.revision > current.revision
    && candidate.firstCursor >= current.firstCursor
    && candidate.lastCursor >= current.lastCursor;
}

function resolveRegionId(
  frame: PresentedObserverFrame,
  cameraMode: CameraMode,
  visibleRegionId: string | null,
  checkpointReturnRegionId: string | null = null,
  /** See {@link STORY_FRAMING_HOLDS_THE_OBSERVED_REGION}: keep the mounted region under Story. */
  holdsObservedRegion = false,
): string | null {
  const checkpointRegionId = frame.checkpointFocus?.regionId;
  if (checkpointRegionId !== undefined) return checkpointRegionId;
  if (checkpointReturnRegionId !== null) return checkpointReturnRegionId;
  if (visibleRegionId !== null
    && (cameraMode !== "story" || holdsObservedRegion)) return visibleRegionId;
  if (frame.scene?.regionId) return frame.scene.regionId;
  if (frame.selection?.kind === "region") return frame.selection.id;
  if (frame.selection?.kind === "agent") {
    const record = frame.world.agents.find(({ value }) => value.id === frame.selection?.id);
    if (typeof record?.value.position === "string") return record.value.position;
  }
  if (frame.selection?.kind === "home" || frame.selection?.kind === "ruin") {
    const records = frame.selection.kind === "home" ? frame.world.homes : frame.world.ruins;
    const record = records.find(({ value }) => value.home_id === frame.selection?.id);
    if (typeof record?.value.region === "string") return record.value.region;
  }
  if (visibleRegionId !== null) return visibleRegionId;
  const regionIds = frame.world.regions
    .map(({ value }) => value.name)
    .filter((value): value is string => typeof value === "string")
    .sort(compareText);
  return regionIds[0] ?? null;
}

function releaseLeases(leases: Iterable<ProductionAssetLease>): void {
  for (const lease of leases) lease.release();
}

function activeGraphEffects(snapshot: ProductionSceneGraphDebugSnapshot): number {
  return snapshot.transients.length + snapshot.environments.reduce(
    (total, environment) => total + environment.diagnostics.activeEffects,
    0,
  );
}

function drawDiagnostics(
  durations: Float64Array,
  count: number,
  totalCount: number,
  cursor: number,
): Readonly<{ count: number; totalCount: number; maxMs: number; samplesMs: readonly number[] }> {
  const samples = count < durations.length
    ? Array.from(durations.subarray(0, count))
    : [
        ...durations.subarray(cursor),
        ...durations.subarray(0, cursor),
      ];
  return Object.freeze({
    count,
    totalCount,
    maxMs: samples.reduce((maximum, duration) => Math.max(maximum, duration), 0),
    samplesMs: Object.freeze(samples),
  });
}

export function terrainRoleAt(
  recipe: RegionMapRecipeV1,
  column: number,
  row: number,
): TerrainRole | null {
  if (column < 0 || row < 0 || column >= recipe.grid.columns || row >= recipe.grid.rows) return null;
  const index = row * recipe.grid.columns + column;
  if (recipe.waterVoidMask[index] === 1) return "water";
  if (recipe.pathMask[index] === 1) return "path";
  if (recipe.soilMask[index] === 1) return "soil";
  const touchesWater = [[0, -1], [1, 0], [0, 1], [-1, 0]].some(([dx, dy]) => {
    const neighborColumn = column + dx;
    const neighborRow = row + dy;
    if (neighborColumn < 0 || neighborRow < 0
      || neighborColumn >= recipe.grid.columns || neighborRow >= recipe.grid.rows) return false;
    return recipe.waterVoidMask[neighborRow * recipe.grid.columns + neighborColumn] === 1;
  });
  if (touchesWater) return "shore";
  return "ground";
}

const TERRAIN_CONNECTION_VARIANTS = Object.freeze([
  7, 1, 0, 2,
  1, 1, 3, 6,
  0, 5, 0, 6,
  4, 6, 6, 6,
] as const);

/** Resolve a N/E/S/W bit mask to the authored connected-tile suffix. */
export function terrainConnectionVariantIndex(mask: number): number {
  if (!Number.isInteger(mask) || mask < 0 || mask >= TERRAIN_CONNECTION_VARIANTS.length) {
    throw new RangeError(`terrain connection mask must be an integer from 0 to 15; received ${mask}`);
  }
  return TERRAIN_CONNECTION_VARIANTS[mask]!;
}

/** Resolve one semantic terrain role to its authored frame suffix. */
export function terrainFrameVariantIndex(
  role: TerrainRole,
  connections: number,
  column: number,
  row: number,
): number {
  if (role === "ground") return (column * 3 + row * 5) % 8;
  if (role !== "soil") return terrainConnectionVariantIndex(connections);
  if (!Number.isInteger(connections) || connections < 0 || connections > 0b1111) {
    throw new RangeError(`terrain connection mask must be an integer from 0 to 15; received ${connections}`);
  }
  const hasHorizontalConnection = (connections & 0b1010) !== 0;
  const hasVerticalConnection = (connections & 0b0101) !== 0;
  if (hasHorizontalConnection && hasVerticalConnection) return 3;
  if (hasHorizontalConnection) return 1;
  if (hasVerticalConnection) return 2;
  return 0;
}

/** Select one authored scenery cell without introducing mutable RNG state. */
export function sceneryVariantIndex(
  placementId: string,
  column: number,
  row: number,
  variantCount: number,
): number {
  if (!Number.isInteger(variantCount) || variantCount <= 0) {
    throw new RangeError(`scenery variant count must be a positive integer; received ${variantCount}`);
  }
  let hash = 2166136261;
  const identity = `${placementId}\u0000${column},${row}`;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % variantCount;
}

function resolveTerrainFrame(
  pack: RegionAssetPackManifest,
  recipe: RegionMapRecipeV1,
  column: number,
  row: number,
): NativeFrameRef | undefined {
  const role = terrainRoleAt(recipe, column, row);
  if (role === null) return undefined;
  const neighbors = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
  const connections = neighbors.reduce((mask, [deltaColumn, deltaRow], bit) => (
    terrainRoleAt(recipe, column + deltaColumn, row + deltaRow) === role
      ? mask | 1 << bit
      : mask
  ), 0);
  const frames = pack.terrainFramesByRole[role];
  const variant = terrainFrameVariantIndex(role, connections, column, row);
  return frames[variant]?.frame;
}

function drawScenicLandmark(
  context: CanvasRenderingContext2D,
  manifest: ProductionAssetManifest,
  pack: RegionAssetPackManifest,
  recipe: RegionMapRecipeV1,
  placement: ScenicLandmarkPlacement,
  leases: ReadonlyMap<string, ProductionAssetLease>,
): void {
  const binding = pack.landmarkFrames[placement.semanticKind];
  const variant = binding?.variants.find(({ variantId }) => variantId === placement.variantId);
  const expectedAtlasId = `${recipe.kit}-landmarks`;
  const atlas = manifest.atlases[expectedAtlasId];
  const exactFrame = variant !== undefined
    && placement.frame.x === variant.rect.x
    && placement.frame.y === variant.rect.y
    && placement.frame.width === variant.rect.width
    && placement.frame.height === variant.rect.height;
  const exactPivot = variant !== undefined
    && placement.contactPivotPx.x === variant.contactPivotPx.x
    && placement.contactPivotPx.y === variant.contactPivotPx.y;
  if (pack.kit !== recipe.kit
    || binding === undefined
    || binding.kind !== placement.semanticKind
    || binding.drawLayer !== "static-back"
    || binding.renderSizePx.width !== 128
    || binding.renderSizePx.height !== 128
    || variant === undefined
    || variant.kitId !== recipe.kit
    || variant.semanticKind !== placement.semanticKind
    || placement.atlasId !== expectedAtlasId
    || variant.atlasId !== placement.atlasId
    || atlas === undefined
    || variant.atlasPixelSha256 !== atlas.sha256
    || !exactFrame
    || placement.frame.width !== 128
    || placement.frame.height !== 128
    || !exactPivot
    || !Number.isInteger(placement.contactPivotPx.x)
    || !Number.isInteger(placement.contactPivotPx.y)
    || placement.geometryHash !== variant.geometryHash) {
    throw new Error(`Scenic landmark ${placement.id} has a stale or foreign atomic binding.`);
  }
  const lease = leases.get(placement.atlasId);
  if (lease === undefined) {
    throw new Error(`Scenic landmark ${placement.id} is missing atlas lease ${placement.atlasId}.`);
  }
  const x = placement.contactTile.column * TILE_SIZE
    + TILE_SIZE / 2 - placement.contactPivotPx.x;
  const y = placement.contactTile.row * TILE_SIZE
    + TILE_SIZE / 2 - placement.contactPivotPx.y;
  if (![x, y].every(Number.isInteger)) {
    throw new Error(`Scenic landmark ${placement.id} requires integer native placement.`);
  }
  context.drawImage(
    lease.value,
    variant.rect.x,
    variant.rect.y,
    variant.rect.width,
    variant.rect.height,
    x,
    y,
    binding.renderSizePx.width,
    binding.renderSizePx.height,
  );
}

function drawNativeFrame(
  context: CanvasRenderingContext2D,
  leases: ReadonlyMap<string, ProductionAssetLease>,
  frame: NativeFrameRef | undefined,
  x: number,
  y: number,
  layer: "terrain" | "scenery",
  onFallback: (layer: "terrain" | "scenery") => void,
): void {
  if (frame === undefined) {
    drawNeutralStaticPlaceholder(context, x, y);
    onFallback(layer);
    return;
  }
  const lease = leases.get(frame.atlasId);
  if (lease === undefined) {
    drawNeutralStaticPlaceholder(context, x, y);
    onFallback(layer);
    return;
  }
  const { rect } = frame;
  context.drawImage(
    lease.value,
    rect.x,
    rect.y,
    rect.width,
    rect.height,
    x,
    y,
    TILE_SIZE,
    TILE_SIZE,
  );
}

function drawNeutralStaticPlaceholder(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
): void {
  context.fillStyle = "#68706a";
  context.fillRect(x, y, TILE_SIZE, TILE_SIZE);
  context.fillStyle = "#7b837b";
  context.fillRect(x, y, TILE_SIZE / 2, TILE_SIZE / 2);
  context.fillRect(x + TILE_SIZE / 2, y + TILE_SIZE / 2, TILE_SIZE / 2, TILE_SIZE / 2);
  context.strokeStyle = "#3d433f";
  context.lineWidth = 1;
  context.strokeRect(x + 0.5, y + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
}

async function acquireAtlasBundle(
  pool: SharedAtlasPool,
  ids: readonly string[],
  controller: AbortController,
): Promise<ReadonlyMap<string, ProductionAssetLease>> {
  if (ids.length === 0) return new Map();
  return await new Promise<ReadonlyMap<string, ProductionAssetLease>>((resolve, reject) => {
    const acquired = new Map<string, ProductionAssetLease>();
    let pending = ids.length;
    let finished = false;
    const fail = (error: unknown): void => {
      if (finished) return;
      finished = true;
      controller.abort();
      releaseLeases(acquired.values());
      acquired.clear();
      reject(error);
    };
    const onAbort = (): void => fail(new DOMException("Aborted", "AbortError"));
    controller.signal.addEventListener("abort", onAbort, { once: true });
    for (const id of ids) {
      void pool.acquire(id, controller.signal).then((lease) => {
        if (finished || controller.signal.aborted) {
          lease.release();
          return;
        }
        acquired.set(id, lease);
        pending -= 1;
        if (pending === 0) {
          finished = true;
          controller.signal.removeEventListener("abort", onAbort);
          resolve(acquired);
        }
      }, fail);
    }
  });
}

function retainLeases(
  pool: SharedAtlasPool,
  ids: Iterable<string>,
): ReadonlyMap<string, ProductionAssetLease> {
  const retained = new Map<string, ProductionAssetLease>();
  try {
    for (const id of ids) retained.set(id, pool.retain(id));
    return retained;
  } catch (error) {
    releaseLeases(retained.values());
    throw error;
  }
}

function normalizeInsets(insets: SafeFrameInsets): SafeFrameInsets {
  const finite = (value: number): number => Number.isFinite(value) ? Math.max(0, value) : 0;
  return { top: finite(insets.top), right: finite(insets.right), bottom: finite(insets.bottom), left: finite(insets.left) };
}

function internalFailureDiagnostic(
  stage: CanvasPresentationRendererDebug["lastInternalFailure"] extends infer Failure
    ? Failure extends { stage: infer Stage } ? Stage : never
    : never,
  error: unknown,
): NonNullable<CanvasPresentationRendererDebug["lastInternalFailure"]> {
  let name = "UnknownError";
  let message = "An unprintable internal failure occurred.";
  if (error instanceof Error) {
    name = error.name;
    message = error.message;
  } else {
    try {
      message = String(error);
    } catch {
      // Diagnostic coercion must never escape the fail-closed renderer boundary.
    }
  }
  return {
    stage,
    name,
    message,
  };
}

function hitTargets(graph: ProductionSceneGraph): HitTarget[] {
  return [...graph.hitTargets()];
}

function distanceToRect(point: Vec2, rect: HitTarget["worldBounds"]): number {
  const x = Math.max(rect.x, Math.min(point.x, rect.x + rect.width));
  const y = Math.max(rect.y, Math.min(point.y, rect.y + rect.height));
  return Math.hypot(point.x - x, point.y - y);
}

function distanceToPeriodicRect(point: Vec2, rect: Rect, worldBounds: Rect): number {
  return Math.hypot(
    distanceToPeriodicInterval(
      point.x,
      rect.x,
      rect.width,
      worldBounds.x,
      worldBounds.width,
    ),
    distanceToPeriodicInterval(
      point.y,
      rect.y,
      rect.height,
      worldBounds.y,
      worldBounds.height,
    ),
  );
}

function distanceToPeriodicInterval(
  value: number,
  intervalOrigin: number,
  intervalExtent: number,
  worldOrigin: number,
  worldExtent: number,
): number {
  if (![value, intervalOrigin, intervalExtent, worldOrigin, worldExtent].every(Number.isFinite)
    || intervalExtent < 0
    || worldExtent <= 0) return Number.POSITIVE_INFINITY;
  if (intervalExtent >= worldExtent) return 0;
  const canonicalValue = wrapCoordinate(value, worldOrigin, worldExtent);
  const canonicalIntervalOrigin = wrapCoordinate(intervalOrigin, worldOrigin, worldExtent);
  let minimum = Number.POSITIVE_INFINITY;
  for (const offset of [-worldExtent, 0, worldExtent]) {
    const start = canonicalIntervalOrigin + offset;
    const end = start + intervalExtent;
    const nearest = Math.max(start, Math.min(canonicalValue, end));
    minimum = Math.min(minimum, Math.abs(canonicalValue - nearest));
  }
  return minimum;
}

function compareHitTargets(left: HitTarget, right: HitTarget): number {
  return right.feetY - left.feetY
    || compareText(left.selectionKey, right.selectionKey)
    || compareText(left.selection.id, right.selection.id)
    || compareText(left.selection.kind, right.selection.kind);
}

function sameSelection(left: ObserverSelection, right: ObserverSelection): boolean {
  if (left === null || right === null) return left === right;
  return left.kind === right.kind && left.id === right.id
    && (left.kind !== "moment" || right.kind !== "moment"
      || (left.firstCursor === right.firstCursor && left.lastCursor === right.lastCursor));
}

function selectionForStoryFocus(
  frame: PresentedObserverFrame,
): Exclude<ObserverSelection, null> | null {
  const checkpoint = frame.checkpointFocus;
  if (checkpoint !== undefined && checkpoint !== null) {
    if (checkpoint.kind === "region" || checkpoint.entityId === null) {
      return { kind: "region", id: checkpoint.regionId };
    }
    return { kind: checkpoint.kind, id: checkpoint.entityId };
  }
  const focus = frame.scene?.focus;
  if (focus === undefined || focus === null) return null;
  if (focus.kind === "system") {
    return focus.regionId === null ? null : { kind: "region", id: focus.regionId };
  }
  return { kind: focus.kind, id: focus.id };
}

function selectionForAcceptedMoment(
  moment: Extract<Exclude<ObserverSelection, null>, { readonly kind: "moment" }>,
  frame: PresentedObserverFrame | null,
): Exclude<ObserverSelection, null> | null {
  if (frame?.scene?.momentId !== moment.id
    || moment.firstCursor < frame.firstCursor
    || moment.lastCursor > frame.lastCursor) return null;
  return selectionForStoryFocus(frame);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * The largest world-space rect a beat frame may take in and still be READABLE.
 *
 * Sized so that this rect, once padded ({@link BEAT_FRAME_PADDING_PX} on every side plus
 * {@link BEAT_FRAME_HEADROOM_PX} above for chrome that hangs over heads), fits `Camera2D`'s beat
 * frame at exactly {@link BEAT_FRAME_MIN_LEGIBLE_ZOOM} -- which IS the legibility grammar's own
 * `TEXT_ZOOM_THRESHOLD`. Anything larger would be fitted below that zoom, where every bubble in
 * the frame is a glyph stud and the framing has bought nothing.
 *
 * Derived from the live canvas and the measured safe insets rather than a magic tile count, and it
 * mirrors `Camera2D.beatFrame()` exactly: horizontal insets on both sides, the top inset (where
 * chrome hangs), and the full height below.
 */
export function legibleBeatExtent(input: Readonly<{
  canvasWidth: number;
  canvasHeight: number;
  insets: SafeFrameInsets;
}>): Vec2 {
  const { canvasWidth, canvasHeight, insets } = input;
  return {
    x: Math.max(
      TILE_SIZE,
      (canvasWidth - insets.left - insets.right) / BEAT_FRAME_MIN_LEGIBLE_ZOOM
        - BEAT_FRAME_PADDING_PX * 2,
    ),
    y: Math.max(
      TILE_SIZE,
      (canvasHeight - insets.top) / BEAT_FRAME_MIN_LEGIBLE_ZOOM
        - BEAT_FRAME_PADDING_PX * 2 - BEAT_FRAME_HEADROOM_PX,
    ),
  };
}

/** The world rect one beat is framed on, before padding. Pure; no camera, no canvas. */
export function beatFrameRect(input: Readonly<{
  /** Every live overlay anchor in the region (`EnvironmentSystem.overlayFocusRect()`). */
  chrome: Rect;
  /** The being or structure the story focus names, when the beat names one. */
  primary: Rect | null;
  /** The frame already held for THIS moment, so a walking cast widens the shot instead of pumping. */
  previous: Rect | null;
  /** {@link legibleBeatExtent} for the live canvas. */
  extent: Vec2;
}>): Rect {
  const { chrome, primary, previous, extent } = input;
  const reads = (rect: Rect): boolean => rect.width <= extent.x && rect.height <= extent.y;
  const withPrimary = primary === null ? null : unionOfRects([chrome, primary]);
  // Three-way, cheapest-loss-first. The acting being is kept in frame WITH its chrome whenever
  // that still reads. When the two are too far apart, the chrome wins -- an unreadable wide shot
  // of both is worth less than a readable shot of the thing that happened. And when the chrome
  // ALONE cannot read, the being wins, by the same argument one step further: `overlayFocusRect`
  // is every live bubble in the region, so once the world is really talking that rect covers most
  // of the map, and fitting to it pulls the camera below the text threshold -- i.e. the more the
  // world speaks, the less of it can be read. A readable shot of the being the beat is about is
  // strictly better than an unreadable shot of everybody's chrome.
  const observed = withPrimary !== null && reads(withPrimary)
    ? withPrimary
    : primary === null || reads(chrome)
      ? chrome
      : primary;
  // Grow, never shrink, within one beat: anchors move as beings walk and a frame that re-tightened
  // every step would pump. Growth stops at the legible extent so a late separation cannot drag the
  // shot out to a world view.
  const grown = previous === null ? null : unionOfRects([previous, observed]);
  return grown !== null && reads(grown) ? grown : observed;
}

/** The smallest rect containing all of `rects`; `null` only for an empty list. */
function unionOfRects(rects: readonly Rect[]): Rect | null {
  let union: Rect | null = null;
  for (const rect of rects) {
    if (union === null) {
      union = { ...rect };
      continue;
    }
    const minX = Math.min(union.x, rect.x);
    const minY = Math.min(union.y, rect.y);
    const maxX = Math.max(union.x + union.width, rect.x + rect.width);
    const maxY = Math.max(union.y + union.height, rect.y + rect.height);
    union = { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }
  return union;
}

export function boundedRasterOrigin(
  camera: CameraSnapshot,
  impulse: Vec2,
  viewportWidth: number,
  viewportHeight: number,
  /**
   * The rect the camera is actually clamped to right now, when that is NOT the observed region's
   * own `worldBounds` — i.e. whenever a region sheet is installed (`Camera2D.setRegionSheet`). Pass
   * `null`/omit for the single-region case, where `worldBounds` IS the clamp.
   *
   * Load-bearing at world zoom. `Camera2D` clamps its centre to the SHEET there
   * (`constrainFreeCenter` -> `activeSheetRect()`), while this function clamped the drawn origin to
   * the observed region's rect — which at world zoom is SMALLER than the viewport, so the
   * min/max inverted and the origin collapsed to the midpoint: the picture was pinned with the
   * observed region centred, and panning the world view moved the camera without moving a single
   * pixel. The camera and the raster have to be clamped to the same rect or they describe two
   * different views, and the raster is the one you see.
   */
  clampRect: Rect | null = null,
): Vec2 {
  const desired = {
    x: camera.rasterOrigin.x + impulse.x,
    y: camera.rasterOrigin.y + impulse.y,
  };
  const bounds = clampRect ?? camera.worldBounds;
  // Viewer authority applies to the RASTER too. Keeping the director's guided target inside the
  // safe frame is framing, and while the viewer is steering it must yield exactly as the camera's
  // own centre constraint does (`Camera2D.constrainCenter`). Measured live: after a click-descent
  // the camera centre was correctly on the new island while this constraint still dragged the
  // drawn origin back toward the story target left behind in the old region -- the camera and the
  // raster disagreed, and the raster is what you see.
  const viewerDriven = camera.mode === "free" || camera.viewerControlled;
  const protectedFrame = viewerDriven
    ? { x: 0, y: 0, width: viewportWidth, height: viewportHeight }
    : camera.safeFrame;
  const guidedTarget = viewerDriven ? null : camera.guidedTarget;
  const constrain = (
    value: number,
    worldOrigin: number | null,
    worldExtent: number | null,
    targetOrigin: number | null,
    targetExtent: number | null,
    protectedOrigin: number,
    protectedExtent: number,
  ): number => {
    let integerMinimum = Number.NEGATIVE_INFINITY;
    let integerMaximum = Number.POSITIVE_INFINITY;
    let targetMinimum = Number.NEGATIVE_INFINITY;
    let targetMaximum = Number.POSITIVE_INFINITY;
    const hasTarget = targetOrigin !== null && targetExtent !== null;
    if (worldOrigin !== null && worldExtent !== null) {
      integerMinimum = Math.max(integerMinimum, Math.ceil(
        protectedOrigin + protectedExtent - (worldOrigin + worldExtent) * camera.zoom,
      ));
      integerMaximum = Math.min(
        integerMaximum,
        Math.floor(protectedOrigin - worldOrigin * camera.zoom),
      );
    }
    if (hasTarget) {
      targetMinimum = Math.ceil(protectedOrigin - targetOrigin * camera.zoom);
      targetMaximum = Math.floor(
        protectedOrigin + protectedExtent - (targetOrigin + targetExtent) * camera.zoom,
      );
      integerMinimum = Math.max(integerMinimum, targetMinimum);
      integerMaximum = Math.min(integerMaximum, targetMaximum);
    }
    if (!Number.isFinite(integerMinimum) && !Number.isFinite(integerMaximum)) {
      return Math.round(value);
    }
    if (integerMinimum > integerMaximum) {
      // Guided cameras intentionally paint authored biome continuation beyond the
      // finite map. If a complete subject fits in the safe frame, preserve it
      // instead of splitting the conflict and clipping both subject and terrain.
      if (hasTarget && targetMinimum <= targetMaximum) {
        return Math.min(targetMaximum, Math.max(targetMinimum, Math.round(value)));
      }
      return Math.round((integerMinimum + integerMaximum) / 2);
    }
    return Math.min(integerMaximum, Math.max(integerMinimum, Math.round(value)));
  };
  const x = constrain(
    desired.x,
    bounds?.x ?? null,
    bounds?.width ?? null,
    guidedTarget?.x ?? null,
    guidedTarget?.width ?? null,
    protectedFrame.x,
    protectedFrame.width,
  );
  const y = constrain(
    desired.y,
    bounds?.y ?? null,
    bounds?.height ?? null,
    guidedTarget?.y ?? null,
    guidedTarget?.height ?? null,
    protectedFrame.y,
    protectedFrame.height,
  );
  return { x: x === 0 ? 0 : x, y: y === 0 ? 0 : y };
}

function browserFrameDriver(): FrameDriver {
  return {
    request: (callback) => window.requestAnimationFrame(callback),
    cancel: (handle) => window.cancelAnimationFrame(handle),
    now: () => performance.now(),
  };
}

function browserWakeScheduler(): WakeScheduler {
  return {
    schedule: (atMs, callback) => window.setTimeout(callback, Math.max(0, atMs - performance.now())),
    cancel: (handle) => window.clearTimeout(handle),
    now: () => performance.now(),
  };
}

function browserAtlasCommitScheduler(): AtlasCommitScheduler {
  return {
    schedule: (callback) => window.setTimeout(callback, 0),
    cancel: (handle) => window.clearTimeout(handle),
  };
}
