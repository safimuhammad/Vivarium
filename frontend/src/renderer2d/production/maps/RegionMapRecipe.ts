import { TILE_SIZE, tileCenter, type TileCoord, type ShelterPlot } from "../../map/regionMap";
import type { Vec2 } from "../../contracts";
import {
  SHELTER_DOOR_CLEARANCE,
  SHELTER_RENDER_FOOTPRINT,
  STANDING_HUMAN_VISUAL_ENVELOPE,
  feetAnchoredVisualRect,
  navigationTileForFeet,
  productionRectsOverlap,
  shelterRenderRect as productionShelterRenderRect,
} from "../productionGeometry";
import { findNavigationPath, type NavigationGrid, type NavigationTopology } from "../navigation/navigation";
import {
  applyWrapSeams,
  deriveWrapSeamCandidates,
  wrapSeamViolations,
} from "../navigation/wrapSeams";
import {
  getBiomeKit,
  selectBiomeKit,
  type AnimatedEnvironmentKind,
  type BiomeKit,
  type OccupiedHomeContextRole,
  type PlannedLandmarkPlan,
  type RegionKitId,
  type ScenicGrammarRole,
  type TerrainPatchRole,
  type VisualPathRole,
} from "./biomeKits";
import { createRegionGates, stableHash, type RegionGate } from "./directedTopology";
import { regionMapIdentityHash, type RegionMapIdentity } from "./RegionMapIdentity";
import {
  AUTHORED_LANDMARK_VARIANTS_BY_KIT,
  LANDMARK_KINDS_BY_KIT,
  type AuthoredLandmarkVariantGeometry,
  type LandmarkHeightPolicy,
  type ScenicLandmarkKind,
  type TileVisualFootprint,
} from "./scenicLandmarks";

export interface OverflowDistrict {
  readonly index: number;
  readonly origin: TileCoord;
  readonly socialAnchors: readonly TileCoord[];
  readonly stagingAnchors: readonly TileCoord[];
  readonly stagingPoints: readonly Vec2[];
  readonly shelterPlots: readonly ShelterPlot[];
}

export interface StaticSceneryPlacement {
  readonly id: string;
  readonly kind: string;
  readonly tile: TileCoord;
  readonly blocksMovement: boolean;
  readonly clusterId: string | null;
  readonly role: ScenicGrammarRole;
  readonly visualFootprint: SceneryVisualFootprint;
  readonly hardCollisionFootprint: readonly TileCoord[];
}

export interface SceneryVisualFootprint {
  readonly widthTiles: number;
  readonly heightTiles: number;
}

export interface ScenicCluster {
  readonly id: string;
  readonly districtIndex: number;
  readonly role: ScenicGrammarRole;
  readonly signature: boolean;
  readonly anchor: TileCoord;
  readonly memberIds: readonly string[];
  readonly plannedLandmark: PlannedLandmarkPlan;
}

/** One exact native landmark realized against an authored scenic cluster. */
export interface ScenicLandmarkPlacement {
  readonly recordType: "scenic-landmark-placement";
  readonly id: string;
  readonly clusterId: string;
  readonly districtIndex: number;
  readonly role: ScenicGrammarRole;
  readonly contactTile: TileCoord;
  readonly semanticKind: ScenicLandmarkKind;
  readonly variantId: string;
  readonly atlasId: string;
  readonly frame: Readonly<{ x: number; y: number; width: 128; height: 128 }>;
  readonly contactPivotPx: Vec2;
  readonly visualFootprint: TileVisualFootprint;
  readonly hardOffsets: readonly Vec2[];
  readonly interactionExclusionOffsets: readonly Vec2[];
  readonly heightPolicy: LandmarkHeightPolicy;
  readonly topologyKey: string;
  readonly geometryHash: string;
  readonly collisionBehavior: "presentation-only";
  readonly affectsMechanics: false;
}

export interface StoryNeighborhood {
  readonly id: string;
  readonly districtIndex: number;
  readonly anchorKind: "authoritative-gate" | "social" | "energy" | "materials";
  readonly anchor: TileCoord;
  readonly authoritativeGate: RegionGate | null;
  readonly terrainPatchId: string;
  readonly pathContext: StoryPathContext;
  readonly minimumNativeZoom: 1;
}

export type StoryPathContext =
  | Readonly<{
      mode: "local-authoritative-path";
      contextAnchor: TileCoord;
      visualPathCompositionId: string;
      navigationDistance: number;
    }>
  | Readonly<{
      mode: "detached-no-crop-local-path";
      reason: "no-admissible-crop-local-authoritative-path-composition";
      constraint: "no-legal-visual-clearing" | "no-legal-visual-shoulder" | "native-mobile-crop-overflow";
      nearestAuthoritativeContext: TileCoord;
      navigationDistance: number;
      visualPathCompositionId: null;
    }>;

export interface TerrainPatch {
  readonly recordType: "terrain-patch";
  readonly id: string;
  readonly districtIndex: number;
  readonly role: TerrainPatchRole;
  readonly cells: readonly TileCoord[];
  readonly footprint: Readonly<{
    origin: TileCoord;
    widthTiles: number;
    heightTiles: number;
  }>;
  readonly storyOwnerIds: readonly string[];
  readonly collisionBehavior: "visual-only";
  readonly affectsMechanics: false;
}

export interface VisualPathComposition {
  readonly recordType: "visual-path-composition";
  readonly id: string;
  readonly districtIndex: number;
  readonly role: VisualPathRole;
  readonly centerlineCells: readonly TileCoord[];
  readonly shoulderCells: readonly TileCoord[];
  readonly clearingCells: readonly TileCoord[];
  readonly footprint: Readonly<{
    origin: TileCoord;
    widthTiles: number;
    heightTiles: number;
  }>;
  readonly storyOwnerIds: readonly string[];
  readonly collisionBehavior: "visual-only";
  readonly affectsMechanics: false;
}

export interface OccupiedHomeObligation {
  readonly recordType: "dynamic-occupied-home";
  readonly id: string;
  readonly districtIndex: number;
  readonly activation: "occupied-home-only";
  readonly contextRole: OccupiedHomeContextRole;
  readonly approachBindings: readonly OccupiedHomeApproachBinding[];
  readonly requiredContextAccents: 2;
  readonly collisionBehavior: "visual-only";
  readonly affectsMechanics: false;
}

export interface OccupiedHomeApproachBinding {
  readonly recordType: "occupied-home-approach-binding";
  readonly shelterPlotId: string;
  readonly doorAnchor: TileCoord;
  readonly apronCells: readonly TileCoord[];
  readonly nearestAuthoritativeContext: TileCoord;
  readonly navigationDistance: number;
  readonly activation: "when-plot-occupied";
  readonly collisionBehavior: "visual-only";
  readonly affectsMechanics: false;
}

export type GateStoryTopology =
  | Readonly<{
      mode: "directed-gates";
      authoritativeGateStoryIds: readonly string[];
    }>
  | Readonly<{
      mode: "isolated";
      reason: "no-authoritative-directed-gates";
    }>
  | Readonly<{
      mode: "presentation-deferred";
      reason: "exact-region-scenery-only";
    }>;

export interface StoryDistrictContract {
  readonly districtIndex: number;
  readonly staticStoryIds: Readonly<{
    primaryGate?: string;
    social: string;
    energy: string;
    materials: string;
  }>;
  readonly dynamicOccupiedHomeObligationId: string;
}

export interface AnimatedEnvironmentPlacement {
  readonly id: string;
  readonly kind: AnimatedEnvironmentKind;
  readonly tile: TileCoord;
  readonly phaseSeed: number;
}

/**
 * Exact-region presentation metadata. Absence preserves the bounded generic recipe contract.
 *
 * Exact regions take one of two approaches, on purpose:
 *
 * - `nirvana-v2` REPLACES the generic recipe with an authored, growable chunk world, and
 *   suppresses the generic story presentation because the authored scene owns all of it.
 * - `warm-springs-v1`, `nirvana-east-v1` and `nirvana-west-v1` are ADDITIVE: they keep
 *   every generic field
 *   and only union their approved terrain's blocking ground into `grid.collision`. Nothing
 *   is suppressed, so the whole generic validation below still runs against the new
 *   collision — which is what makes the plot/path/scenery/connectivity invariants
 *   machine-checked on parse rather than asserted once in a report.
 *
 * To add a region, add one row to {@link EXACT_PRESENTATION_PROFILES} and one member to
 * this union. Nothing else in this file needs to change.
 */
export interface RegionPresentationProfile {
  readonly kind: "nirvana-v2" | "warm-springs-v1" | "nirvana-east-v1" | "nirvana-west-v1";
  readonly atlasProfileVersion: 2;
  readonly staticSceneHash: string;
}

export interface RegionMapRecipeV1 {
  readonly version: 1;
  readonly regionId: string;
  readonly identityHash: string;
  readonly kit: RegionKitId;
  readonly presentationProfile?: RegionPresentationProfile;
  readonly grid: NavigationGrid;
  readonly edgeMask: Uint8Array;
  readonly waterVoidMask: Uint8Array;
  readonly pathMask: Uint8Array;
  readonly soilMask: Uint8Array;
  readonly gates: readonly RegionGate[];
  readonly arrivalAnchors: readonly TileCoord[];
  readonly spawnAnchors: readonly TileCoord[];
  readonly socialAnchors: readonly TileCoord[];
  readonly resourceAnchors: Readonly<{
    energy: readonly TileCoord[];
    materials: readonly TileCoord[];
  }>;
  readonly stagingAnchors: readonly TileCoord[];
  readonly stagingPoints: readonly Vec2[];
  readonly shelterPlots: readonly ShelterPlot[];
  readonly staticScenery: readonly StaticSceneryPlacement[];
  readonly scenicClusters: readonly ScenicCluster[];
  readonly scenicLandmarks: readonly ScenicLandmarkPlacement[];
  readonly storyNeighborhoods: readonly StoryNeighborhood[];
  readonly terrainPatches: readonly TerrainPatch[];
  readonly visualPathCompositions: readonly VisualPathComposition[];
  readonly occupiedHomeObligations: readonly OccupiedHomeObligation[];
  readonly gateStoryTopology: GateStoryTopology;
  readonly storyDistricts: readonly StoryDistrictContract[];
  readonly animatedEnvironment: readonly AnimatedEnvironmentPlacement[];
  readonly districts: readonly OverflowDistrict[];
}

export type RegionMapRecipeCloneTransfer = (
  source: RegionMapRecipeV1,
  clone: RegionMapRecipeV1,
) => void;

const REGION_RECIPE_CLONE_TRANSFERS = new Set<RegionMapRecipeCloneTransfer>();

/** Register opaque, recipe-owned metadata that must follow trusted canonical clones. */
export function registerRegionMapRecipeCloneTransfer(
  transfer: RegionMapRecipeCloneTransfer,
): () => void {
  REGION_RECIPE_CLONE_TRANSFERS.add(transfer);
  return () => REGION_RECIPE_CLONE_TRANSFERS.delete(transfer);
}

interface SerializedRecipe extends Omit<RegionMapRecipeV1, "grid" | "edgeMask" | "waterVoidMask" | "pathMask" | "soilMask"> {
  readonly grid: Omit<NavigationGrid, "collision"> & { readonly collision: readonly number[] };
  readonly edgeMask: readonly number[];
  readonly waterVoidMask: readonly number[];
  readonly pathMask: readonly number[];
  readonly soilMask: readonly number[];
}

/**
 * Walk physics every region in this world uses.
 *
 * A single constant rather than per-region configuration: the owner's decision is that all
 * four regions wrap, and a world where some regions wrap and others do not would be a
 * rule a viewer has to learn per place. Strictly about BEINGS — the observer camera stays
 * bounded (see `Camera2D`'s region-sheet clamp).
 */
const REGION_WALK_TOPOLOGY: NavigationTopology = "toroidal";

const COLUMNS = 96;
const ROWS = 96;
const MECHANICS_CORE_ORIGIN = 16;
const MECHANICS_CORE_SIZE = 64;
const DISTRICT_COLUMNS = 12;
const LANDSCAPE_SECTOR_COLUMNS = 24;
const LANDSCAPE_SECTOR_ROWS = 16;
const LANDSCAPE_SECTORS: readonly TileCoord[] = [
  { column: 0, row: 0 }, { column: 24, row: 0 },
  { column: 48, row: 0 }, { column: 72, row: 0 },
  { column: 72, row: 80 }, { column: 48, row: 80 },
  { column: 24, row: 80 }, { column: 0, row: 80 },
];
const STATIC_SCENERY_PER_DISTRICT = 24;
const CLUSTERED_SCENERY_PER_DISTRICT = 21;
const ANIMATED_ENVIRONMENT_PER_DISTRICT = 4;
const SOIL_TILES_PER_PATCH = 5;
const SOIL_PATCHES_PER_DISTRICT = 3;
const SOIL_TILES_PER_DISTRICT = SOIL_TILES_PER_PATCH * SOIL_PATCHES_PER_DISTRICT;
const WATER_BODY_SIZES: Readonly<Partial<Record<RegionKitId, readonly number[]>>> = {
  "spring-terraces": [14, 14],
  "neutral-temperate": [10],
};
const WATER_SHAPES: Readonly<Record<number, readonly TileCoord[]>> = {
  10: [
    { column: 1, row: 0 }, { column: 2, row: 0 },
    { column: 0, row: 1 }, { column: 1, row: 1 }, { column: 2, row: 1 }, { column: 3, row: 1 },
    { column: 0, row: 2 }, { column: 1, row: 2 }, { column: 2, row: 2 },
    { column: 1, row: 3 },
  ],
  14: [
    { column: 1, row: 0 }, { column: 2, row: 0 }, { column: 3, row: 0 },
    { column: 0, row: 1 }, { column: 1, row: 1 }, { column: 2, row: 1 }, { column: 3, row: 1 }, { column: 4, row: 1 },
    { column: 0, row: 2 }, { column: 1, row: 2 }, { column: 2, row: 2 }, { column: 3, row: 2 },
    { column: 1, row: 3 }, { column: 2, row: 3 },
  ],
};
const SOIL_SHAPE_VARIANTS = generateConnectedShapes(SOIL_TILES_PER_PATCH)
  .filter(isIrregularTileComponent);
const MIN_PATH_TILES = 80;
const MAX_PATH_TILES = 1_440;
const DISTRICT_ORIGINS: readonly TileCoord[] = [
  { column: 18, row: 18 },
  { column: 34, row: 18 },
  { column: 50, row: 18 },
  { column: 66, row: 18 },
  { column: 66, row: 50 },
  { column: 50, row: 50 },
  { column: 34, row: 50 },
  { column: 18, row: 50 },
];
const STAGING_POINT_START = Object.freeze({ x: 560, y: 590 } as const);
const STAGING_POINT_STEP = Object.freeze({ x: 71, y: 76 } as const);
const STAGING_POINTS_PER_DISTRICT = 32;
// Both published static variants and animated region frames currently occupy one
// native 32px tile; keeping this conservative authored footprint in map geometry
// avoids importing the asset manifest (and all atlas metadata) into recipe creation.
const ENVIRONMENT_RENDER_FOOTPRINT = Object.freeze({ width: TILE_SIZE, height: TILE_SIZE } as const);
const SHELTER_PLOT_OFFSETS: readonly TileCoord[] = [
  { column: 0, row: 3 }, { column: 4, row: 3 }, { column: 8, row: 3 },
  { column: 0, row: 7 }, { column: 4, row: 7 }, { column: 8, row: 7 },
  { column: 0, row: 11 }, { column: 4, row: 11 }, { column: 8, row: 11 },
  { column: 0, row: 15 }, { column: 4, row: 15 }, { column: 8, row: 15 },
  { column: 0, row: 19 }, { column: 4, row: 19 }, { column: 8, row: 19 },
  { column: 4, row: 23 },
];
const SHELTER_DOOR_OFFSET = { column: 2, row: 3 } as const;
const UNIT_VISUAL_FOOTPRINT = Object.freeze({ widthTiles: 1, heightTiles: 1 } as const);
const UNIT_HARD_COLLISION_FOOTPRINT = Object.freeze([
  Object.freeze({ column: 0, row: 0 } as const),
] as const);
const MOBILE_STORY_SAFE_FRAME = Object.freeze({
  viewportWidth: 390,
  viewportHeight: 844,
  chromeTop: 120,
  chromeRight: 52,
  chromeBottom: 276,
  chromeLeft: 8,
  padding: 16,
} as const);
const SCENIC_CLUSTER_SHAPES: Readonly<Record<number, readonly TileCoord[]>> = {
  5: [
    { column: 0, row: 0 }, { column: 1, row: 0 }, { column: 2, row: 0 },
    { column: 1, row: 1 }, { column: 1, row: 2 },
  ],
  6: [
    { column: 0, row: 0 }, { column: 1, row: 0 }, { column: 2, row: 0 },
    { column: 1, row: 1 }, { column: 2, row: 1 }, { column: 1, row: 2 },
  ],
  7: [
    { column: 0, row: 0 }, { column: 1, row: 0 }, { column: 2, row: 0 },
    { column: 0, row: 1 }, { column: 1, row: 1 }, { column: 2, row: 1 },
    { column: 1, row: 2 },
  ],
};

interface ScenicClusterSeed {
  readonly districtIndex: number;
  readonly anchor: TileCoord;
  readonly contextAnchor: TileCoord;
}

interface StaticSceneGrammarResult {
  readonly placements: readonly StaticSceneryPlacement[];
  readonly clusters: readonly ScenicCluster[];
}

interface StoryCompositionResult {
  readonly neighborhoods: readonly StoryNeighborhood[];
  readonly terrainPatches: readonly TerrainPatch[];
  readonly visualPaths: readonly VisualPathComposition[];
  readonly occupiedHomes: readonly OccupiedHomeObligation[];
  readonly gateTopology: GateStoryTopology;
  readonly districts: readonly StoryDistrictContract[];
}

type StoryNeighborhoodSeed = Omit<StoryNeighborhood, "pathContext">;

/** Generate a deterministic static map recipe from immutable region identity. */
export function createRegionMapRecipe(identity: RegionMapIdentity): RegionMapRecipeV1 {
  const kit = getBiomeKit(selectBiomeKit(identity.archetype));
  const gates = createCanonicalRegionGates(identity);
  const districts = createCanonicalDistricts(identity.regionId);
  const stagingAnchors = districts.flatMap((district) => district.stagingAnchors);
  const stagingPoints = districts.flatMap((district) => district.stagingPoints);
  const shelterPlots = districts.flatMap((district) => district.shelterPlots);
  const socialAnchors = districts.flatMap((district) => district.socialAnchors);
  const spawnAnchors = socialAnchors.slice(0, 4);
  const resourceAnchors = {
    energy: districts.map((district) => offset(district.origin, 10, 3)),
    materials: districts.map((district) => offset(district.origin, 10, 27)),
  };
  const scenicClusterSeeds = createScenicClusterSeeds(districts, resourceAnchors);
  const arrivalAnchors = gates.filter((gate) => gate.role === "arrival").map((gate) => gate.tile);
  const reserved = new Set(
    [
      ...gates.map((gate) => gate.tile), ...spawnAnchors, ...socialAnchors,
      ...resourceAnchors.energy, ...resourceAnchors.materials, ...stagingAnchors,
      ...shelterPlots.flatMap((plot) => [plot.tile, plot.door]),
    ].map(tileKey),
  );
  const collision = new Uint8Array(COLUMNS * ROWS);
  const edgeMask = createEdgeMask();
  const waterVoidMask = new Uint8Array(COLUMNS * ROWS);
  const pathMask = createPathMask(identity, gates, districts);
  markBoundaryCollision(collision);
  for (const [index, value] of edgeMask.entries()) {
    if (value === 1) reserved.add(indexKey(index));
  }
  markMechanicsGuardCollision(collision, reserved);
  for (const gate of gates) collision[indexOf(gate.tile)] = 0;
  for (const [index, value] of pathMask.entries()) {
    if (value !== 1) continue;
    collision[index] = 0;
    reserved.add(indexKey(index));
  }
  const soilMask = createSoilMask(identity, districts, reserved);
  for (const [index, value] of soilMask.entries()) {
    if (value !== 1) continue;
    collision[index] = 0;
    reserved.add(indexKey(index));
  }

  const waterTiles = createWaterBodies(
    identity,
    WATER_BODY_SIZES[kit.id] ?? [],
    reserved,
    scenicClusterSeeds[0]?.contextAnchor,
  );
  for (const tile of waterTiles) {
    waterVoidMask[indexOf(tile)] = 1;
    collision[indexOf(tile)] = 1;
    reserved.add(tileKey(tile));
  }

  const environmentReserved = reserveAuthoredEnvironmentClearance(
    reserved,
    stagingPoints,
    shelterPlots,
    pathMask,
  );
  const staticScene = createStaticScenery(
    identity,
    districts,
    kit,
    environmentReserved,
    scenicClusterSeeds,
    waterTiles,
  );
  const staticScenery = staticScene.placements;
  for (const scenery of staticScenery) {
    collision[indexOf(scenery.tile)] = scenery.blocksMovement ? 1 : 0;
    reserved.add(tileKey(scenery.tile));
    environmentReserved.add(tileKey(scenery.tile));
  }
  const animatedEnvironment = createAnimatedEnvironment(identity, districts, kit.animatedKinds, environmentReserved);
  const storyComposition = createStoryComposition(
    identity,
    gates,
    districts,
    resourceAnchors,
    { columns: COLUMNS, rows: ROWS, collision },
    pathMask,
    waterVoidMask,
    soilMask,
    staticScenery,
    kit,
  );
  const scenicLandmarks = realizeScenicLandmarks(
    identity,
    kit,
    staticScene.clusters,
    staticScenery,
    pathMask,
    shelterPlots,
    stagingPoints,
    gates,
  );

  // Topology activation, deliberately LAST. Everything above — story routing, landmark
  // realisation, water bodies, the whole 250-seed authored invariant set — was proved
  // against a hard rim and still runs against a hard rim. Only the PUBLISHED grid wraps,
  // and only at reciprocal pairs whose inland neighbours are already walkable, so an
  // opened tile can never be an isolated scrap of rim.
  applyWrapSeams(
    collision,
    COLUMNS,
    ROWS,
    deriveWrapSeamCandidates(collision, COLUMNS, ROWS, [waterVoidMask]),
  );

  return {
    version: 1,
    regionId: identity.regionId,
    identityHash: regionMapIdentityHash(identity),
    kit: kit.id,
    grid: { columns: COLUMNS, rows: ROWS, collision, topology: REGION_WALK_TOPOLOGY },
    edgeMask,
    waterVoidMask,
    pathMask,
    soilMask,
    gates,
    arrivalAnchors,
    spawnAnchors,
    socialAnchors,
    resourceAnchors,
    stagingAnchors,
    stagingPoints,
    shelterPlots,
    staticScenery,
    scenicClusters: staticScene.clusters,
    scenicLandmarks,
    storyNeighborhoods: storyComposition.neighborhoods,
    terrainPatches: storyComposition.terrainPatches,
    visualPathCompositions: storyComposition.visualPaths,
    occupiedHomeObligations: storyComposition.occupiedHomes,
    gateStoryTopology: storyComposition.gateTopology,
    storyDistricts: storyComposition.districts,
    animatedEnvironment,
    districts,
  };
}

/** Serialize a map recipe canonically, preserving typed masks as byte arrays. */
export function serializeRegionMapRecipe(recipe: RegionMapRecipeV1): string {
  return JSON.stringify(toSerialized(recipe));
}

/** Parse and validate a serialized recipe, restoring typed masks. */
export function parseRegionMapRecipe(
  value: string,
  expectedIdentity: RegionMapIdentity,
  expectedRecipeFactory: (identity: RegionMapIdentity) => RegionMapRecipeV1 = createRegionMapRecipe,
): RegionMapRecipeV1 {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error("region map recipe must be valid JSON", { cause: error });
  }
  const record = requireRecord(parsed, "recipe");
  if (record.version !== 1) throw new Error("region map recipe must use version 1");
  const gridRecord = requireRecord(record.grid, "recipe.grid");
  const columns = requirePositiveInteger(gridRecord.columns, "recipe.grid.columns");
  const rows = requirePositiveInteger(gridRecord.rows, "recipe.grid.rows");
  const expectedLength = columns * rows;
  const collision = requireByteArray(gridRecord.collision, expectedLength, "recipe.grid.collision");
  const topology = requireOptionalNavigationTopology(gridRecord.topology);
  const edgeMask = requireByteArray(record.edgeMask, expectedLength, "recipe.edgeMask");
  const waterVoidMask = requireByteArray(record.waterVoidMask, expectedLength, "recipe.waterVoidMask");
  const pathMask = requireByteArray(record.pathMask, expectedLength, "recipe.pathMask");
  const soilMask = requireByteArray(record.soilMask, expectedLength, "recipe.soilMask");
  const restored = {
    ...record,
    version: 1 as const,
    grid: { columns, rows, collision, ...(topology === undefined ? {} : { topology }) },
    edgeMask,
    waterVoidMask,
    pathMask,
    soilMask,
  } as unknown as RegionMapRecipeV1;
  validateRecipe(restored);
  const expectedRecipe = validateExpectedIdentity(
    restored,
    expectedIdentity,
    expectedRecipeFactory,
  );
  const canonical = canonicalRecipe(restored);
  transferRegionRecipeCloneMetadata(expectedRecipe, canonical);
  return canonical;
}

/** Deep-clone a recipe already produced and trusted in memory; never use for persisted input. */
export function cloneTrustedRegionMapRecipe(recipe: RegionMapRecipeV1): RegionMapRecipeV1 {
  return canonicalRecipe(recipe);
}

/**
 * Validate an untrusted serialized walk topology.
 *
 * Absent is legal and means bounded; anything that is neither absent nor one of the two
 * known values is a malformed recipe, not a value to guess at.
 *
 * @throws If the field is present and is not `"bounded"` or `"toroidal"`.
 */
function requireOptionalNavigationTopology(value: unknown): NavigationTopology | undefined {
  if (value === undefined) return undefined;
  if (value !== "bounded" && value !== "toroidal") {
    throw new Error("recipe.grid.topology must be \"bounded\" or \"toroidal\" when present");
  }
  return value;
}

/** Return the canonical serialized form used as a byte-level recipe hash. */
export function regionMapRecipeHash(recipe: RegionMapRecipeV1): string {
  return stableHash(serializeRegionMapRecipe(recipe)).toString(16).padStart(8, "0");
}

function createShelterDistrict(regionId: string, index: number, origin: TileCoord): OverflowDistrict {
  const socialAnchors = [offset(origin, 0, 0)];
  const shelterPlots = SHELTER_PLOT_OFFSETS.map((plot, plotIndex) => ({
    id: `${regionId}:district-${index}:plot-${plotIndex}`,
    tile: offset(origin, plot.column, plot.row),
    door: offset(
      origin,
      plot.column + SHELTER_DOOR_OFFSET.column,
      plot.row + SHELTER_DOOR_OFFSET.row,
    ),
  }));
  return { index, origin, socialAnchors, stagingAnchors: [], stagingPoints: [], shelterPlots };
}

function createCanonicalRegionGates(identity: RegionMapIdentity): readonly RegionGate[] {
  return createRegionGates(
    identity.regionId,
    identity.directedTopology,
    MECHANICS_CORE_SIZE,
    MECHANICS_CORE_SIZE,
  ).map((gate) => ({
    ...gate,
    tile: offset(gate.tile, MECHANICS_CORE_ORIGIN, MECHANICS_CORE_ORIGIN),
  }));
}

function createCanonicalDistricts(regionId: string): readonly OverflowDistrict[] {
  const shelters = DISTRICT_ORIGINS.map((origin, index) =>
    createShelterDistrict(regionId, index, origin));
  const shelterRects = shelters.flatMap((district) =>
    district.shelterPlots.map((plot) => productionShelterRenderRect(plot.tile)));
  const candidates: Vec2[] = [];
  const mechanicsMin = MECHANICS_CORE_ORIGIN * TILE_SIZE;
  const mechanicsMax = (MECHANICS_CORE_ORIGIN + MECHANICS_CORE_SIZE) * TILE_SIZE;
  for (
    let y = STAGING_POINT_START.y;
    y + STANDING_HUMAN_VISUAL_ENVELOPE.bottom <= mechanicsMax;
    y += STAGING_POINT_STEP.y
  ) {
    for (
      let x = STAGING_POINT_START.x;
      x + STANDING_HUMAN_VISUAL_ENVELOPE.right <= mechanicsMax;
      x += STAGING_POINT_STEP.x
    ) {
      const point = { x, y };
      const navigationTile = navigationTileForFeet(point);
      if (navigationTile.column <= MECHANICS_CORE_ORIGIN
        || navigationTile.row <= MECHANICS_CORE_ORIGIN
        || navigationTile.column >= MECHANICS_CORE_ORIGIN + MECHANICS_CORE_SIZE - 1
        || navigationTile.row >= MECHANICS_CORE_ORIGIN + MECHANICS_CORE_SIZE - 1) continue;
      const envelope = feetAnchoredVisualRect(point);
      if (envelope.x < mechanicsMin || envelope.y < mechanicsMin) continue;
      if (shelterRects.some((shelter) => productionRectsOverlap(envelope, shelter))) continue;
      candidates.push(point);
    }
  }
  const required = DISTRICT_ORIGINS.length * STAGING_POINTS_PER_DISTRICT;
  if (candidates.length < required) {
    throw new Error(`canonical staging grid provides ${candidates.length}/${required} legal points`);
  }
  const available = new Map(candidates.map((point) => [pointKey(point), point]));
  return shelters.map((district) => {
    const origin = tileCenter(district.origin);
    const selected = [...available.values()]
      .sort((left, right) => squaredDistance(left, origin) - squaredDistance(right, origin)
        || left.y - right.y || left.x - right.x)
      .slice(0, STAGING_POINTS_PER_DISTRICT);
    for (const point of selected) available.delete(pointKey(point));
    return {
      ...district,
      stagingAnchors: selected.map(navigationTileForFeet),
      stagingPoints: selected,
    };
  });
}

function createPathMask(
  identity: RegionMapIdentity,
  gates: readonly RegionGate[],
  districts: readonly OverflowDistrict[],
): Uint8Array {
  const mask = new Uint8Array(COLUMNS * ROWS);
  const hubs = districts.map((district) => district.socialAnchors[0]);
  for (const hub of hubs) markMaskTile(mask, hub);
  for (let index = 0; index < hubs.length - 1; index += 1) {
    carveBentRoute(mask, hubs[index], hubs[index + 1], identity, `district-spine:${index}`);
  }
  for (const [index, gate] of gates.entries()) {
    const hub = hubs.reduce((nearest, candidate) =>
      manhattan(gate.tile, candidate) < manhattan(gate.tile, nearest) ? candidate : nearest,
    hubs[0]);
    const waypoint = gateWaypoint(gate.tile, identity, index);
    carveOrganicSegment(mask, gate.tile, waypoint, identity, `gate:${index}:inward`);
    carveBentRoute(mask, waypoint, hub, identity, `gate:${index}:hub`);
  }
  return mask;
}

function carveBentRoute(
  mask: Uint8Array,
  start: TileCoord,
  end: TileCoord,
  identity: RegionMapIdentity,
  namespace: string,
): void {
  const hash = stableHash(`${identity.runSeed}:${identity.regionId}:path:${namespace}`);
  const horizontal = Math.abs(end.column - start.column) >= Math.abs(end.row - start.row);
  const bend = 3 + (hash % 4);
  const direction = (Math.floor(hash / 7) % 2 === 0 ? 1 : -1);
  const midpoint = horizontal
    ? {
        column: Math.round((start.column + end.column) / 2),
        row: clampInterior(Math.round((start.row + end.row) / 2) + bend * direction),
      }
    : {
        column: clampInterior(Math.round((start.column + end.column) / 2) + bend * direction),
        row: Math.round((start.row + end.row) / 2),
      };
  carveOrganicSegment(mask, start, midpoint, identity, `${namespace}:a`);
  carveOrganicSegment(mask, midpoint, end, identity, `${namespace}:b`);
}

function carveOrganicSegment(
  mask: Uint8Array,
  start: TileCoord,
  end: TileCoord,
  identity: RegionMapIdentity,
  namespace: string,
): void {
  let tile = { ...start };
  markMaskTile(mask, tile);
  for (let step = 0; !sameTile(tile, end); step += 1) {
    const columnDistance = Math.abs(end.column - tile.column);
    const rowDistance = Math.abs(end.row - tile.row);
    const chooseColumn = rowDistance === 0 || (columnDistance > 0 &&
      stableHash(`${identity.runSeed}:${identity.regionId}:path:${namespace}:${step}`) %
        (columnDistance + rowDistance) < columnDistance);
    tile = chooseColumn
      ? { column: tile.column + Math.sign(end.column - tile.column), row: tile.row }
      : { column: tile.column, row: tile.row + Math.sign(end.row - tile.row) };
    markMaskTile(mask, tile);
  }
}

function gateWaypoint(tile: TileCoord, identity: RegionMapIdentity, index: number): TileCoord {
  const hash = stableHash(`${identity.runSeed}:${identity.regionId}:gate-waypoint:${index}`);
  const depth = 5 + (hash % 4);
  const lateral = (Math.floor(hash / 11) % 7) - 3;
  const near = MECHANICS_CORE_ORIGIN + 1;
  const far = MECHANICS_CORE_ORIGIN + MECHANICS_CORE_SIZE - 2;
  if (tile.row === near) return { column: clampInterior(tile.column + lateral), row: tile.row + depth };
  if (tile.column === far) return { column: tile.column - depth, row: clampInterior(tile.row + lateral) };
  if (tile.row === far) return { column: clampInterior(tile.column + lateral), row: tile.row - depth };
  return { column: tile.column + depth, row: clampInterior(tile.row + lateral) };
}

function createSoilMask(
  identity: RegionMapIdentity,
  districts: readonly OverflowDistrict[],
  reserved: ReadonlySet<string>,
): Uint8Array {
  const mask = new Uint8Array(COLUMNS * ROWS);
  const claimed = new Set(reserved);
  const patches = [
    { column: 0, row: 1, width: 6, height: 13 },
    { column: 7, row: 1, width: 5, height: 13 },
    { column: 7, row: 16, width: 5, height: 13 },
  ] as const;
  for (const district of districts) {
    for (const [patchIndex, patch] of patches.entries()) {
      const selected = selectConnectedSoilPatch(identity, district, patchIndex, patch, claimed);
      if (selected === undefined) {
        throw new Error(`could not allocate soil district-${district.index}:patch-${patchIndex}`);
      }
      for (const tile of selected) {
        markMaskTile(mask, tile);
        claimed.add(tileKey(tile));
      }
    }
  }
  return mask;
}

function selectConnectedSoilPatch(
  identity: RegionMapIdentity,
  district: OverflowDistrict,
  patchIndex: number,
  patch: Readonly<{ column: number; row: number; width: number; height: number }>,
  claimed: ReadonlySet<string>,
): TileCoord[] | undefined {
  const free = new Set<string>();
  for (let row = 0; row < patch.height; row += 1) {
    for (let column = 0; column < patch.width; column += 1) {
      const tile = offset(district.origin, patch.column + column, patch.row + row);
      if (!claimed.has(tileKey(tile))) free.add(tileKey(tile));
    }
  }
  const placementsPerShape = patch.width * patch.height;
  const capacity = SOIL_SHAPE_VARIANTS.length * placementsPerShape;
  const namespace = `${identity.runSeed}:${identity.regionId}:soil:${district.index}:${patchIndex}`;
  let cursor = stableHash(namespace) % capacity;
  const stride = coprimeStride(capacity, stableHash(`${namespace}:stride`));
  for (let attempt = 0; attempt < capacity; attempt += 1) {
    const shape = SOIL_SHAPE_VARIANTS[Math.floor(cursor / placementsPerShape)];
    const placement = cursor % placementsPerShape;
    const column = placement % patch.width;
    const row = Math.floor(placement / patch.width);
    const bounds = shapeBounds(shape);
    if (column <= patch.width - bounds.width && row <= patch.height - bounds.height) {
      const tiles = shape.map((tile) => offset(
        district.origin,
        patch.column + column + tile.column,
        patch.row + row + tile.row,
      ));
      if (tiles.every((tile) => free.has(tileKey(tile)))) return tiles;
    }
    cursor = (cursor + stride) % capacity;
  }
  return undefined;
}

function generateConnectedShapes(size: number): TileCoord[][] {
  let shapes = new Map<string, TileCoord[]>([["0,0", [{ column: 0, row: 0 }]]]);
  for (let count = 1; count < size; count += 1) {
    const expanded = new Map<string, TileCoord[]>();
    for (const shape of shapes.values()) {
      const claimed = new Set(shape.map(tileKey));
      for (const tile of shape) {
        for (const neighbor of cardinalTiles(tile)) {
          if (claimed.has(tileKey(neighbor))) continue;
          const next = normalizeShape([...shape, neighbor]);
          expanded.set(next.map(tileKey).join(";"), next);
        }
      }
    }
    shapes = expanded;
  }
  return [...shapes.values()];
}

function normalizeShape(shape: readonly TileCoord[]): TileCoord[] {
  const minColumn = Math.min(...shape.map((tile) => tile.column));
  const minRow = Math.min(...shape.map((tile) => tile.row));
  return shape
    .map((tile) => ({ column: tile.column - minColumn, row: tile.row - minRow }))
    .sort((left, right) => left.row - right.row || left.column - right.column);
}

function coprimeStride(capacity: number, seed: number): number {
  if (capacity <= 1) return 1;
  let stride = 1 + (seed % (capacity - 1));
  while (greatestCommonDivisor(stride, capacity) !== 1) stride = stride === capacity - 1 ? 1 : stride + 1;
  return stride;
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left;
  let b = right;
  while (b !== 0) [a, b] = [b, a % b];
  return a;
}

function createWaterBodies(
  identity: RegionMapIdentity,
  bodySizes: readonly number[],
  reserved: ReadonlySet<string>,
  primaryStoryContext?: TileCoord,
): TileCoord[] {
  const selected: TileCoord[] = [];
  const water = new Set<string>();
  const claimed = new Set(reserved);
  for (const [bodyIndex, size] of bodySizes.entries()) {
    const shape = WATER_SHAPES[size];
    if (shape === undefined) throw new Error(`unsupported authored water body size ${size}`);
    const variants = uniqueShapeVariants([shape]);
    const placementColumns = COLUMNS - 4;
    const placementRows = ROWS - 4;
    const placementsPerVariant = placementColumns * placementRows;
    const capacity = variants.length * placementsPerVariant;
    let cursor = stableHash(`${identity.runSeed}:${identity.regionId}:water-body:${bodyIndex}`) % capacity;
    const stride = coprimeStride(capacity, stableHash(`${identity.runSeed}:${identity.regionId}:water-body:${bodyIndex}:stride`));
    let body: TileCoord[] | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let attempt = 0; attempt < capacity; attempt += 1) {
      const variant = variants[Math.floor(cursor / placementsPerVariant)];
      const placement = cursor % placementsPerVariant;
      const column = 2 + (placement % placementColumns);
      const row = 2 + Math.floor(placement / placementColumns);
      const bounds = shapeBounds(variant);
      if (column <= COLUMNS - bounds.width - 2 && row <= ROWS - bounds.height - 2) {
        const tiles = variant.map((tile) => ({ column: column + tile.column, row: row + tile.row }));
        const local = new Set(tiles.map(tileKey));
        const fits = tiles.every((tile) => !claimed.has(tileKey(tile))) &&
          tiles.every((tile) => cardinalTiles(tile).every((neighbor) => !water.has(tileKey(neighbor)))) &&
          tiles.some((tile) => cardinalTiles(tile).some((neighbor) =>
            neighbor.column > 0 && neighbor.column < COLUMNS - 1 &&
            neighbor.row > 0 && neighbor.row < ROWS - 1 &&
            !local.has(tileKey(neighbor)) && !claimed.has(tileKey(neighbor))));
        if (fits) {
          if (bodyIndex !== 0 || primaryStoryContext === undefined) {
            body = tiles;
            break;
          }
          const distance = Math.min(...tiles.map((tile) => manhattan(tile, primaryStoryContext)));
          if (distance < bestDistance) {
            body = tiles;
            bestDistance = distance;
            if (distance <= 1) break;
          }
        }
      }
      cursor = (cursor + stride) % capacity;
    }
    if (body === undefined) throw new Error(`could not allocate water body ${bodyIndex}`);
    for (const tile of body) {
      selected.push(tile);
      water.add(tileKey(tile));
      claimed.add(tileKey(tile));
    }
  }
  return selected;
}

function createScenicClusterSeeds(
  districts: readonly OverflowDistrict[],
  resourceAnchors: RegionMapRecipeV1["resourceAnchors"],
): readonly ScenicClusterSeed[] {
  return districts.map((district) => {
    const candidates: readonly Readonly<{
      tile: TileCoord;
    }>[] = [
      { tile: district.socialAnchors[0]! },
      { tile: resourceAnchors.energy[district.index]! },
      { tile: resourceAnchors.materials[district.index]! },
    ];
    const sector = LANDSCAPE_SECTORS[district.index]!;
    const ranked = candidates
      .map((candidate) => ({
        ...candidate,
        contextAnchor: clampToLandscapeSector(candidate.tile, sector),
      }))
      .sort((left, right) => manhattan(left.tile, left.contextAnchor) - manhattan(right.tile, right.contextAnchor)
        || left.tile.row - right.tile.row || left.tile.column - right.tile.column);
    const selected = ranked[0]!;
    return {
      districtIndex: district.index,
      anchor: selected.tile,
      contextAnchor: selected.contextAnchor,
    };
  });
}

function createStoryComposition(
  identity: RegionMapIdentity,
  gates: readonly RegionGate[],
  districts: readonly OverflowDistrict[],
  resourceAnchors: RegionMapRecipeV1["resourceAnchors"],
  grid: NavigationGrid,
  pathMask: Uint8Array,
  waterVoidMask: Uint8Array,
  soilMask: Uint8Array,
  staticScenery: readonly StaticSceneryPlacement[],
  kit: BiomeKit,
): StoryCompositionResult {
  const storySeeds: StoryNeighborhoodSeed[] = [];
  const gateStories = gates.map((gate, gateIndex) => {
    const district = [...districts].sort((left, right) =>
      manhattan(left.socialAnchors[0]!, gate.tile) - manhattan(right.socialAnchors[0]!, gate.tile)
      || left.index - right.index)[0]!;
    const story = createStoryNeighborhoodSeed(
      identity.regionId,
      `gate-${gateIndex}`,
      district.index,
      "authoritative-gate",
      gate.tile,
      gate,
    );
    storySeeds.push(story);
    return story;
  });

  const perDistrict = districts.map((district) => {
    const social = createStoryNeighborhoodSeed(
      identity.regionId,
      `district-${district.index}:social`,
      district.index,
      "social",
      district.socialAnchors[0]!,
      null,
    );
    const energy = createStoryNeighborhoodSeed(
      identity.regionId,
      `district-${district.index}:energy`,
      district.index,
      "energy",
      resourceAnchors.energy[district.index]!,
      null,
    );
    const materials = createStoryNeighborhoodSeed(
      identity.regionId,
      `district-${district.index}:materials`,
      district.index,
      "materials",
      resourceAnchors.materials[district.index]!,
      null,
    );
    storySeeds.push(social, energy, materials);
    const primaryGate = [...gateStories].sort((left, right) =>
      manhattan(left.anchor, district.socialAnchors[0]!)
        - manhattan(right.anchor, district.socialAnchors[0]!)
      || left.id.localeCompare(right.id))[0];
    return { district, social, energy, materials, primaryGate };
  });

  const occupiedHomes = perDistrict.map(({ district }) => ({
    recordType: "dynamic-occupied-home" as const,
    id: `${identity.regionId}:occupied-home-${district.index}`,
    districtIndex: district.index,
    activation: "occupied-home-only" as const,
    contextRole: kit.sceneGrammar.occupiedHomeContextRole,
    approachBindings: district.shelterPlots.map((plot) => createOccupiedHomeApproachBinding(
      plot,
      district,
      grid,
      pathMask,
      waterVoidMask,
      staticScenery,
      districts.flatMap((candidate) => candidate.shelterPlots),
    )),
    requiredContextAccents: 2 as const,
    collisionBehavior: "visual-only" as const,
    affectsMechanics: false as const,
  }));
  const storyDistricts = perDistrict.map(({ district, social, energy, materials, primaryGate }) => ({
    districtIndex: district.index,
    staticStoryIds: primaryGate === undefined
      ? { social: social.id, energy: energy.id, materials: materials.id }
      : { primaryGate: primaryGate.id, social: social.id, energy: energy.id, materials: materials.id },
    dynamicOccupiedHomeObligationId: occupiedHomes[district.index]!.id,
  }));
  const terrainPatches = storySeeds.map((story, index) =>
    createTerrainPatch(story, kit.sceneGrammar.terrainPatchRoles[
      index % kit.sceneGrammar.terrainPatchRoles.length
    ]!));
  const pathChoices = storySeeds.map((story, index) => createStoryPathChoice(
    story,
    terrainPatches[index]!,
    districts[story.districtIndex]!,
    grid,
    pathMask,
    waterVoidMask,
    soilMask,
    staticScenery,
    districts.flatMap((district) => district.shelterPlots),
    storySeeds,
    kit.sceneGrammar.visualPathRole,
  ));
  const neighborhoods = storySeeds.map((story, index): StoryNeighborhood => ({
    ...story,
    pathContext: pathChoices[index]!.pathContext,
  }));
  const visualPaths = pathChoices.flatMap((choice) => (
    choice.visualPath === null ? [] : [choice.visualPath]
  ));
  const gateTopology: GateStoryTopology = gates.length === 0
    ? { mode: "isolated", reason: "no-authoritative-directed-gates" }
    : {
        mode: "directed-gates",
        authoritativeGateStoryIds: gateStories.map((story) => story.id),
      };
  return {
    neighborhoods,
    terrainPatches,
    visualPaths,
    occupiedHomes,
    gateTopology,
    districts: storyDistricts,
  };
}

function createStoryNeighborhoodSeed(
  regionId: string,
  suffix: string,
  districtIndex: number,
  anchorKind: StoryNeighborhood["anchorKind"],
  anchor: TileCoord,
  authoritativeGate: RegionGate | null,
): StoryNeighborhoodSeed {
  const id = `${regionId}:story:${suffix}`;
  return {
    id,
    districtIndex,
    anchorKind,
    anchor,
    authoritativeGate,
    terrainPatchId: `${id}:terrain`,
    minimumNativeZoom: 1,
  };
}

function createTerrainPatch(story: StoryNeighborhoodSeed, role: TerrainPatchRole): TerrainPatch {
  const cells = rectangularPatch(story.anchor, 5, 3);
  return {
    recordType: "terrain-patch",
    id: story.terrainPatchId,
    districtIndex: story.districtIndex,
    role,
    cells,
    footprint: tileFootprint(cells),
    storyOwnerIds: [story.id],
    collisionBehavior: "visual-only",
    affectsMechanics: false,
  };
}

function createStoryPathChoice(
  story: StoryNeighborhoodSeed,
  terrainPatch: TerrainPatch,
  district: OverflowDistrict,
  grid: NavigationGrid,
  pathMask: Uint8Array,
  waterVoidMask: Uint8Array,
  soilMask: Uint8Array,
  staticScenery: readonly StaticSceneryPlacement[],
  shelterPlots: readonly ShelterPlot[],
  storySeeds: readonly StoryNeighborhoodSeed[],
  role: VisualPathRole,
): Readonly<{ pathContext: StoryPathContext; visualPath: VisualPathComposition | null }> {
  const nearest = nearestAuthoritativePathContext(
    story.anchor,
    district.socialAnchors[0]!,
    grid,
    pathMask,
  );
  const visualPath = createLocalVisualPathComposition(
    story,
    nearest.tile,
    grid,
    pathMask,
    waterVoidMask,
    soilMask,
    staticScenery,
    shelterPlots,
    storySeeds,
    role,
  );
  if (visualPath.clearingCells.length > 0 && visualPath.shoulderCells.length > 0
      && fitsNativeMobileStoryFrame(story.anchor, terrainPatch.footprint, visualPath.footprint)) {
    return {
      pathContext: {
        mode: "local-authoritative-path",
        contextAnchor: nearest.tile,
        visualPathCompositionId: visualPath.id,
        navigationDistance: nearest.distance,
      },
      visualPath,
    };
  }
  return {
    pathContext: {
      mode: "detached-no-crop-local-path",
      reason: "no-admissible-crop-local-authoritative-path-composition",
      constraint: visualPath.clearingCells.length === 0
        ? "no-legal-visual-clearing"
        : visualPath.shoulderCells.length === 0
          ? "no-legal-visual-shoulder"
          : "native-mobile-crop-overflow",
      nearestAuthoritativeContext: nearest.tile,
      navigationDistance: nearest.distance,
      visualPathCompositionId: null,
    },
    visualPath: null,
  };
}

function createLocalVisualPathComposition(
  story: StoryNeighborhoodSeed,
  contextAnchor: TileCoord,
  grid: NavigationGrid,
  pathMask: Uint8Array,
  waterVoidMask: Uint8Array,
  soilMask: Uint8Array,
  staticScenery: readonly StaticSceneryPlacement[],
  shelterPlots: readonly ShelterPlot[],
  storySeeds: readonly StoryNeighborhoodSeed[],
  role: VisualPathRole,
): VisualPathComposition {
  const legalCell = (tile: TileCoord): boolean => visualContextCellIsOpen(
    tile,
    story,
    grid,
    waterVoidMask,
    soilMask,
    staticScenery,
    shelterPlots,
    storySeeds,
  );
  const centerlineCells = localPathWindow(contextAnchor, pathMask, 2, legalCell);
  const pathKeys = new Set(maskTiles(pathMask, grid.columns).map(tileKey));
  const shoulderCells = uniqueTiles(centerlineCells.flatMap(cardinalTiles))
    .filter((tile) => !pathKeys.has(tileKey(tile)) && visualContextCellIsOpen(
      tile,
      story,
      grid,
      waterVoidMask,
      soilMask,
      staticScenery,
      shelterPlots,
      storySeeds,
    ))
    .sort(compareTiles);
  const clearingCells = legalCell(contextAnchor) ? [{ ...contextAnchor }] : [];
  const allCells = uniqueTiles([...centerlineCells, ...shoulderCells, ...clearingCells]);
  return {
    recordType: "visual-path-composition",
    id: `${story.id}:path-context`,
    districtIndex: story.districtIndex,
    role,
    centerlineCells,
    shoulderCells,
    clearingCells,
    footprint: tileFootprint(allCells),
    storyOwnerIds: [story.id],
    collisionBehavior: "visual-only",
    affectsMechanics: false,
  };
}

function nearestAuthoritativePathContext(
  start: TileCoord,
  goal: TileCoord,
  grid: NavigationGrid,
  pathMask: Uint8Array,
): Readonly<{ tile: TileCoord; distance: number }> {
  const route = findNavigationPath(grid, { start, goal });
  if (route.status !== "reached") {
    throw new Error(`story navigation route ${tileKey(start)} -> ${tileKey(goal)} must be reachable`);
  }
  const distance = route.tiles.findIndex((tile) => pathMask[indexOf(tile)] === 1);
  const tile = route.tiles[distance];
  if (distance < 0 || tile === undefined) {
    throw new Error(`story navigation route ${tileKey(start)} -> ${tileKey(goal)} must meet authoritative path`);
  }
  return { tile, distance };
}

function localPathWindow(
  contextAnchor: TileCoord,
  pathMask: Uint8Array,
  radius: number,
  isPresentationLegal: (tile: TileCoord) => boolean,
): TileCoord[] {
  const selected: TileCoord[] = [];
  const pending: Array<Readonly<{ tile: TileCoord; distance: number }>> = [
    { tile: contextAnchor, distance: 0 },
  ];
  const seen = new Set([tileKey(contextAnchor)]);
  while (pending.length > 0) {
    const current = pending.shift();
    if (current === undefined) break;
    selected.push(current.tile);
    if (current.distance >= radius) continue;
    for (const neighbor of [...cardinalTiles(current.tile)].sort(compareTiles)) {
      const key = tileKey(neighbor);
      if (seen.has(key) || neighbor.column < 0 || neighbor.column >= COLUMNS
          || neighbor.row < 0 || neighbor.row >= ROWS || pathMask[indexOf(neighbor)] !== 1
          || !isPresentationLegal(neighbor)) continue;
      seen.add(key);
      pending.push({ tile: neighbor, distance: current.distance + 1 });
    }
  }
  return selected.sort(compareTiles);
}

function visualContextCellIsOpen(
  tile: TileCoord,
  owner: StoryNeighborhoodSeed,
  grid: NavigationGrid,
  waterVoidMask: Uint8Array,
  soilMask: Uint8Array,
  staticScenery: readonly StaticSceneryPlacement[],
  shelterPlots: readonly ShelterPlot[],
  storySeeds: readonly StoryNeighborhoodSeed[],
): boolean {
  if (tile.column <= 0 || tile.column >= grid.columns - 1
      || tile.row <= 0 || tile.row >= grid.rows - 1
      || grid.collision[indexOf(tile)] !== 0 || waterVoidMask[indexOf(tile)] !== 0
      || soilMask[indexOf(tile)] !== 0) return false;
  const rect = tilePixelRect(tile);
  if (staticScenery.some((placement) => productionRectsOverlap(rect, {
    x: placement.tile.column * TILE_SIZE,
    y: placement.tile.row * TILE_SIZE,
    width: placement.visualFootprint.widthTiles * TILE_SIZE,
    height: placement.visualFootprint.heightTiles * TILE_SIZE,
  }))) return false;
  if (shelterPlots.some((plot) => productionRectsOverlap(rect, productionShelterRenderRect(plot.tile)))) {
    return false;
  }
  return !storySeeds.some((candidate) => candidate.id !== owner.id
    && !sameTile(candidate.anchor, owner.anchor)
    && productionRectsOverlap(rect, feetAnchoredVisualRect(tileCenter(candidate.anchor))));
}

function fitsNativeMobileStoryFrame(
  anchor: TileCoord,
  terrainFootprint: TerrainPatch["footprint"],
  pathFootprint: VisualPathComposition["footprint"],
): boolean {
  const actor = feetAnchoredVisualRect(tileCenter(anchor));
  const terrain = tileFootprintPixelRect(terrainFootprint);
  const path = tileFootprintPixelRect(pathFootprint);
  const left = Math.min(actor.x, terrain.x, path.x);
  const top = Math.min(actor.y, terrain.y, path.y);
  const right = Math.max(actor.x + actor.width, terrain.x + terrain.width, path.x + path.width);
  const bottom = Math.max(actor.y + actor.height, terrain.y + terrain.height, path.y + path.height);
  const safeWidth = MOBILE_STORY_SAFE_FRAME.viewportWidth
    - MOBILE_STORY_SAFE_FRAME.chromeLeft - MOBILE_STORY_SAFE_FRAME.chromeRight;
  const safeHeight = MOBILE_STORY_SAFE_FRAME.viewportHeight
    - MOBILE_STORY_SAFE_FRAME.chromeTop - MOBILE_STORY_SAFE_FRAME.chromeBottom;
  return right - left + MOBILE_STORY_SAFE_FRAME.padding * 2 <= safeWidth
    && bottom - top + MOBILE_STORY_SAFE_FRAME.padding * 2 <= safeHeight;
}

function tilePixelRect(tile: TileCoord): Readonly<{ x: number; y: number; width: number; height: number }> {
  return { x: tile.column * TILE_SIZE, y: tile.row * TILE_SIZE, width: TILE_SIZE, height: TILE_SIZE };
}

function tileFootprintPixelRect(
  footprint: TerrainPatch["footprint"],
): Readonly<{ x: number; y: number; width: number; height: number }> {
  return {
    x: footprint.origin.column * TILE_SIZE,
    y: footprint.origin.row * TILE_SIZE,
    width: footprint.widthTiles * TILE_SIZE,
    height: footprint.heightTiles * TILE_SIZE,
  };
}

function createOccupiedHomeApproachBinding(
  plot: ShelterPlot,
  district: OverflowDistrict,
  grid: NavigationGrid,
  pathMask: Uint8Array,
  waterVoidMask: Uint8Array,
  staticScenery: readonly StaticSceneryPlacement[],
  shelterPlots: readonly ShelterPlot[],
): OccupiedHomeApproachBinding {
  const doorAnchor = { column: plot.door.column, row: plot.door.row };
  const nearest = nearestAuthoritativePathContext(
    doorAnchor,
    district.socialAnchors[0]!,
    grid,
    pathMask,
  );
  const apronCells = uniqueTiles([
    doorAnchor,
    ...cardinalTiles(doorAnchor).filter((tile) => {
      if (tile.column <= 0 || tile.column >= grid.columns - 1
          || tile.row <= 0 || tile.row >= grid.rows - 1
          || grid.collision[indexOf(tile)] !== 0 || waterVoidMask[indexOf(tile)] !== 0) return false;
      const rect = tilePixelRect(tile);
      if (staticScenery.some((placement) => productionRectsOverlap(rect, {
        x: placement.tile.column * TILE_SIZE,
        y: placement.tile.row * TILE_SIZE,
        width: placement.visualFootprint.widthTiles * TILE_SIZE,
        height: placement.visualFootprint.heightTiles * TILE_SIZE,
      }))) return false;
      return !shelterPlots.some((candidate) => candidate.id !== plot.id
        && productionRectsOverlap(rect, productionShelterRenderRect(candidate.tile)));
    }),
  ]).sort(compareTiles);
  return {
    recordType: "occupied-home-approach-binding",
    shelterPlotId: plot.id,
    doorAnchor,
    apronCells,
    nearestAuthoritativeContext: nearest.tile,
    navigationDistance: nearest.distance,
    activation: "when-plot-occupied",
    collisionBehavior: "visual-only",
    affectsMechanics: false,
  };
}

function compareTiles(left: TileCoord, right: TileCoord): number {
  return left.row - right.row || left.column - right.column;
}

function rectangularPatch(center: TileCoord, width: number, height: number): readonly TileCoord[] {
  const firstColumn = Math.max(1, Math.min(COLUMNS - width - 1, center.column - Math.floor(width / 2)));
  const firstRow = Math.max(1, Math.min(ROWS - height - 1, center.row - Math.floor(height / 2)));
  return Array.from({ length: width * height }, (_, index) => ({
    column: firstColumn + (index % width),
    row: firstRow + Math.floor(index / width),
  }));
}

function tileFootprint(tiles: readonly TileCoord[]): TerrainPatch["footprint"] {
  const columns = tiles.map((tile) => tile.column);
  const rows = tiles.map((tile) => tile.row);
  const minimumColumn = Math.min(...columns);
  const minimumRow = Math.min(...rows);
  return {
    origin: { column: minimumColumn, row: minimumRow },
    widthTiles: Math.max(...columns) - minimumColumn + 1,
    heightTiles: Math.max(...rows) - minimumRow + 1,
  };
}

function uniqueTiles(tiles: readonly TileCoord[]): TileCoord[] {
  return [...new Map(tiles.map((tile) => [tileKey(tile), tile])).values()];
}

function clampToLandscapeSector(tile: TileCoord, sector: TileCoord): TileCoord {
  return {
    column: Math.max(sector.column + 2, Math.min(sector.column + LANDSCAPE_SECTOR_COLUMNS - 3, tile.column)),
    row: Math.max(sector.row + 2, Math.min(sector.row + LANDSCAPE_SECTOR_ROWS - 3, tile.row)),
  };
}

function uniqueShapeVariants(shapes: readonly (readonly TileCoord[])[]): TileCoord[][] {
  const variants = new Map<string, TileCoord[]>();
  for (const source of shapes) {
    for (const reflected of [false, true]) {
      for (let rotation = 0; rotation < 4; rotation += 1) {
        const transformed = source.map((tile) => {
          let column = reflected ? -tile.column : tile.column;
          let row = tile.row;
          for (let turn = 0; turn < rotation; turn += 1) [column, row] = [-row, column];
          return { column, row };
        });
        const normalized = normalizeShape(transformed);
        variants.set(normalized.map(tileKey).join(";"), normalized);
      }
    }
  }
  return [...variants.values()];
}

function shapeBounds(shape: readonly TileCoord[]): { width: number; height: number } {
  return {
    width: Math.max(...shape.map((tile) => tile.column)) + 1,
    height: Math.max(...shape.map((tile) => tile.row)) + 1,
  };
}

function cardinalTiles(tile: TileCoord): readonly TileCoord[] {
  return [
    { column: tile.column - 1, row: tile.row },
    { column: tile.column + 1, row: tile.row },
    { column: tile.column, row: tile.row - 1 },
    { column: tile.column, row: tile.row + 1 },
  ];
}

function markMaskTile(mask: Uint8Array, tile: TileCoord): void {
  mask[indexOf(tile)] = 1;
}

function clampInterior(value: number): number {
  return Math.max(
    MECHANICS_CORE_ORIGIN + 1,
    Math.min(MECHANICS_CORE_ORIGIN + MECHANICS_CORE_SIZE - 2, value),
  );
}

function manhattan(left: TileCoord, right: TileCoord): number {
  return Math.abs(left.column - right.column) + Math.abs(left.row - right.row);
}

function countMask(mask: Uint8Array): number {
  return mask.reduce((count, value) => count + value, 0);
}

function maskTiles(mask: Uint8Array, columns: number): TileCoord[] {
  return Array.from(mask.entries())
    .filter(([, value]) => value === 1)
    .map(([index]) => ({ column: index % columns, row: Math.floor(index / columns) }));
}

function connectedMaskSize(mask: Uint8Array, columns: number, rows: number): number {
  const start = mask.findIndex((value) => value === 1);
  if (start < 0) return 0;
  const seen = new Set([start]);
  const pending = [start];
  while (pending.length > 0) {
    const index = pending.pop();
    if (index === undefined) break;
    const column = index % columns;
    const row = Math.floor(index / columns);
    for (const [nextColumn, nextRow] of [
      [column - 1, row], [column + 1, row], [column, row - 1], [column, row + 1],
    ]) {
      if (nextColumn < 0 || nextColumn >= columns || nextRow < 0 || nextRow >= rows) continue;
      const next = nextRow * columns + nextColumn;
      if (mask[next] !== 1 || seen.has(next)) continue;
      seen.add(next);
      pending.push(next);
    }
  }
  return seen.size;
}

function connectedTileComponents(tiles: readonly TileCoord[]): TileCoord[][] {
  const remaining = new Map(tiles.map((tile) => [tileKey(tile), tile]));
  const components: TileCoord[][] = [];
  while (remaining.size > 0) {
    const start = remaining.values().next().value as TileCoord;
    const pending = [start];
    const component: TileCoord[] = [];
    remaining.delete(tileKey(start));
    while (pending.length > 0) {
      const tile = pending.pop();
      if (tile === undefined) break;
      component.push(tile);
      for (const neighbor of cardinalTiles(tile)) {
        const claimed = remaining.get(tileKey(neighbor));
        if (claimed === undefined) continue;
        remaining.delete(tileKey(neighbor));
        pending.push(claimed);
      }
    }
    components.push(component);
  }
  return components;
}

function isIrregularTileComponent(component: readonly TileCoord[]): boolean {
  if (component.length === 0) return false;
  const columns = component.map((tile) => tile.column);
  const rows = component.map((tile) => tile.row);
  const width = Math.max(...columns) - Math.min(...columns) + 1;
  const height = Math.max(...rows) - Math.min(...rows) + 1;
  return width > 1 && height > 1 && width * height > component.length;
}

function reserveAuthoredEnvironmentClearance(
  reserved: ReadonlySet<string>,
  stagingPoints: readonly Vec2[],
  shelterPlots: readonly ShelterPlot[],
  pathMask: Uint8Array,
): Set<string> {
  const result = new Set(reserved);
  const protectedFootprints = [
    ...stagingPoints.map(feetAnchoredVisualRect),
    ...shelterPlots.map((plot) => productionShelterRenderRect(plot.tile)),
    ...shelterPlots.map((plot) => feetAnchoredVisualRect(tileCenter(plot.door))),
    ...maskTiles(pathMask, COLUMNS).map((tile) => feetAnchoredVisualRect(tileCenter(tile))),
  ];
  for (const protectedFootprint of protectedFootprints) {
    const firstColumn = Math.max(0, Math.floor(protectedFootprint.x / TILE_SIZE));
    const lastColumn = Math.min(
      COLUMNS - 1,
      Math.ceil((protectedFootprint.x + protectedFootprint.width) / TILE_SIZE) - 1,
    );
    const firstRow = Math.max(0, Math.floor(protectedFootprint.y / TILE_SIZE));
    const lastRow = Math.min(
      ROWS - 1,
      Math.ceil((protectedFootprint.y + protectedFootprint.height) / TILE_SIZE) - 1,
    );
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        const tile = { column, row };
        if (productionRectsOverlap(protectedFootprint, environmentRenderRect(tile))) {
          result.add(tileKey(tile));
        }
      }
    }
  }
  return result;
}

function createStaticScenery(
  identity: RegionMapIdentity,
  districts: readonly OverflowDistrict[],
  kit: BiomeKit,
  reserved: ReadonlySet<string>,
  storySeeds: readonly ScenicClusterSeed[],
  waterTiles: readonly TileCoord[],
): StaticSceneGrammarResult {
  const kinds = [...kit.blockingScenery, ...kit.passiveScenery];
  const blocking = new Set(kit.blockingScenery);
  const kindOffset = stableHash(`${identity.runSeed}:${identity.regionId}:static-kinds`) % kinds.length;
  const claimed = new Set(reserved);
  const placements: StaticSceneryPlacement[] = [];
  const clusters: ScenicCluster[] = [];
  let ordinal = 0;
  for (const district of districts) {
    const storySeed = storySeeds[district.index];
    if (storySeed === undefined) throw new Error(`missing story neighborhood seed ${district.index}`);
    const roles = scenicRolesForDistrict(kit, district.index);
    const minimumClusterSize = Math.floor(CLUSTERED_SCENERY_PER_DISTRICT / roles.length);
    let remainingBonus = CLUSTERED_SCENERY_PER_DISTRICT % roles.length;
    const districtClusters: ScenicCluster[] = [];
    let signatureMembers: readonly TileCoord[] = [];
    for (const [clusterIndex, role] of roles.entries()) {
      const size = minimumClusterSize + (remainingBonus > 0 ? 1 : 0);
      remainingBonus = Math.max(0, remainingBonus - 1);
      const waterTarget = district.index === 0 && kit.id === "spring-terraces"
        ? waterComponentNearest(waterTiles, storySeed.contextAnchor)
        : [];
      const preferred = clusterIndex === 0
        ? (waterTarget.length > 0 ? waterTarget : [storySeed.contextAnchor])
        : signatureMembers;
      const memberTiles = selectConnectedLandscapeCluster(
        identity,
        district.index,
        clusterIndex,
        size,
        claimed,
        preferred,
        waterTarget.length > 0 && clusterIndex === 0,
      );
      for (const tile of memberTiles) claimed.add(tileKey(tile));
      if (clusterIndex === 0) signatureMembers = memberTiles;
      const clusterId = `${identity.regionId}:district-${district.index}:cluster-${clusterIndex}`;
      const memberIds: string[] = [];
      for (const tile of memberTiles) {
        const index = ordinal;
        ordinal += 1;
        const kind = kinds[(index + kindOffset) % kinds.length]!;
        const id = `${identity.regionId}:static-${index}`;
        memberIds.push(id);
        placements.push({
          id,
          kind,
          tile,
          blocksMovement: blocking.has(kind),
          clusterId,
          role,
          visualFootprint: UNIT_VISUAL_FOOTPRINT,
          hardCollisionFootprint: blocking.has(kind) ? UNIT_HARD_COLLISION_FOOTPRINT : [],
        });
      }
      const anchor = [...memberTiles].sort((left, right) =>
        manhattan(left, storySeed.anchor) - manhattan(right, storySeed.anchor)
        || left.row - right.row || left.column - right.column)[0]!;
      const cluster: ScenicCluster = {
        id: clusterId,
        districtIndex: district.index,
        role,
        signature: clusterIndex === 0,
        anchor,
        memberIds,
        plannedLandmark: plannedLandmarkForRole(kit, role),
      };
      clusters.push(cluster);
      districtClusters.push(cluster);
    }
    const satelliteCount = STATIC_SCENERY_PER_DISTRICT - CLUSTERED_SCENERY_PER_DISTRICT;
    const clusterMemberTiles = placements
      .filter((placement) => placement.clusterId !== null
        && districtClusters.some((cluster) => cluster.id === placement.clusterId))
      .map((placement) => placement.tile);
    for (const tile of selectClusterBoundSatellites(
      identity,
      district.index,
      satelliteCount,
      claimed,
      clusterMemberTiles,
    )) {
      const index = ordinal;
      ordinal += 1;
      const kind = kinds[(index + kindOffset) % kinds.length]!;
      placements.push({
        id: `${identity.regionId}:static-${index}`,
        kind,
        tile,
        blocksMovement: blocking.has(kind),
        clusterId: null,
        role: "satellite-accent",
        visualFootprint: UNIT_VISUAL_FOOTPRINT,
        hardCollisionFootprint: blocking.has(kind) ? UNIT_HARD_COLLISION_FOOTPRINT : [],
      });
    }
  }
  return { placements, clusters };
}

function scenicRolesForDistrict(kit: BiomeKit, districtIndex: number): readonly ScenicGrammarRole[] {
  const signature = districtIndex === 0 || kit.sceneGrammar.detachedSignatureRole === undefined
    ? kit.sceneGrammar.signatureRole
    : kit.sceneGrammar.detachedSignatureRole;
  return [signature, ...kit.sceneGrammar.supportRoles];
}

function plannedLandmarkForRole(kit: BiomeKit, role: ScenicGrammarRole): PlannedLandmarkPlan {
  const planned = kit.sceneGrammar.plannedLandmarksByRole[role];
  if (planned === undefined || planned.semanticRole !== role || planned.runtimeAtlasLookup !== false) {
    throw new Error(`biome kit ${kit.id} is missing a role-bound planned landmark for ${role}`);
  }
  return planned;
}

function realizeScenicLandmarks(
  identity: RegionMapIdentity,
  kit: BiomeKit,
  clusters: readonly ScenicCluster[],
  staticScenery: readonly StaticSceneryPlacement[],
  pathMask: Uint8Array,
  shelterPlots: readonly ShelterPlot[],
  stagingPoints: readonly Vec2[],
  gates: readonly RegionGate[],
): readonly ScenicLandmarkPlacement[] {
  // The authored-landmark rollout is intentionally a worn-heartland/Nirvana pilot.
  // Other biome kits keep their already-tested presentation until Safi accepts C00;
  // Task 9 then generalizes this same contract without pre-emptive cross-kit drift.
  if (kit.id !== "worn-heartland") return [];
  const protectedTiles = reserveAuthoredEnvironmentClearance(
    new Set(gates.map(({ tile }) => tileKey(tile))),
    stagingPoints,
    shelterPlots,
    new Uint8Array(COLUMNS * ROWS),
  );
  const placementsByCluster = new Map<string, StaticSceneryPlacement[]>();
  for (const placement of staticScenery) {
    if (placement.clusterId === null) continue;
    const members = placementsByCluster.get(placement.clusterId) ?? [];
    members.push(placement);
    placementsByCluster.set(placement.clusterId, members);
  }
  const allBlockingTiles = new Set(staticScenery
    .filter(({ blocksMovement }) => blocksMovement)
    .map(({ tile }) => tileKey(tile)));

  return clusters.map((cluster) => {
    const semanticKind = semanticLandmarkKind(kit, cluster.plannedLandmark);
    const variants = AUTHORED_LANDMARK_VARIANTS_BY_KIT[kit.id]
      .filter((variant) => variant.semanticKind === semanticKind);
    const members = placementsByCluster.get(cluster.id) ?? [];
    if (variants.length === 0 || members.length !== cluster.memberIds.length) {
      throw new Error(`cannot realize scenic landmark for ${cluster.id}`);
    }
    const orientation = nearestPathOrientation(cluster.anchor, pathMask);
    const eligible = variants.flatMap((variant) =>
      landmarkContactCandidates(cluster.anchor, members, staticScenery, variant).filter((contactTile) =>
        landmarkGeometryFits(
          contactTile,
          variant,
          allBlockingTiles,
          protectedTiles,
          pathMask,
          cluster.role,
          members,
        )).map((contactTile) => ({
          variant,
          contactTile,
          topologyRank: landmarkTopologyRank(variant.topologyKey, orientation),
          clusterDistance: Math.min(...members.map(({ tile }) => manhattan(tile, contactTile))),
          tie: stableHash(
            `${identity.runSeed}:${identity.regionId}:${cluster.id}:${variant.variantId}:${tileKey(contactTile)}`,
          ),
        })),
    ).sort((left, right) => left.topologyRank - right.topologyRank
      || left.clusterDistance - right.clusterDistance
      || left.tie - right.tie
      || left.variant.cellIndex - right.variant.cellIndex
      || left.contactTile.row - right.contactTile.row
      || left.contactTile.column - right.contactTile.column);
    const selected = eligible[0];
    if (selected === undefined) {
      throw new Error(
        `scenic landmark ${cluster.id} (${cluster.role} at ${tileKey(cluster.anchor)})`
        + " has no legal frame and contact geometry",
      );
    }
    const { variant, contactTile } = selected;
    return {
      recordType: "scenic-landmark-placement",
      id: `${cluster.id}:landmark`,
      clusterId: cluster.id,
      districtIndex: cluster.districtIndex,
      role: cluster.role,
      contactTile,
      semanticKind,
      variantId: variant.variantId,
      atlasId: `${kit.id}-landmarks`,
      frame: {
        x: (variant.cellIndex % 4) * 128,
        y: Math.floor(variant.cellIndex / 4) * 128,
        width: 128,
        height: 128,
      },
      contactPivotPx: { ...variant.contactPivotPx },
      visualFootprint: {
        originOffsetTiles: { ...variant.visualFootprint.originOffsetTiles },
        widthTiles: variant.visualFootprint.widthTiles,
        heightTiles: variant.visualFootprint.heightTiles,
      },
      hardOffsets: variant.hardOffsets.map((value) => ({ ...value })),
      interactionExclusionOffsets: variant.interactionExclusionOffsets.map((value) => ({ ...value })),
      heightPolicy: variant.heightPolicy,
      topologyKey: variant.topologyKey,
      geometryHash: variant.geometryHash,
      collisionBehavior: "presentation-only",
      affectsMechanics: false,
    };
  });
}

function semanticLandmarkKind(kit: BiomeKit, plan: PlannedLandmarkPlan): ScenicLandmarkKind {
  const prefix = "planned:";
  const value = String(plan.plannedId);
  const semanticKind = value.startsWith(prefix) ? value.slice(prefix.length) : "";
  if (!LANDMARK_KINDS_BY_KIT[kit.id].includes(semanticKind as ScenicLandmarkKind)) {
    throw new Error(`planned landmark ${value} is not owned by biome kit ${kit.id}`);
  }
  return semanticKind as ScenicLandmarkKind;
}

function landmarkContactCandidates(
  anchor: TileCoord,
  members: readonly StaticSceneryPlacement[],
  allScenery: readonly StaticSceneryPlacement[],
  variant: AuthoredLandmarkVariantGeometry,
): readonly TileCoord[] {
  const candidates = new Map<string, TileCoord>([[tileKey(anchor), anchor]]);
  for (const member of members) candidates.set(tileKey(member.tile), member.tile);
  const nearbyBlocking = allScenery.filter(({ blocksMovement, tile }) =>
    blocksMovement && manhattan(tile, anchor) <= 12);
  for (const member of nearbyBlocking) {
    for (const hardOffset of variant.hardOffsets) {
      const candidate = {
        column: member.tile.column - hardOffset.x,
        row: member.tile.row - hardOffset.y,
      };
      candidates.set(tileKey(candidate), candidate);
    }
  }
  return [...candidates.values()];
}

function landmarkGeometryFits(
  contactTile: TileCoord,
  variant: AuthoredLandmarkVariantGeometry,
  blockingTiles: ReadonlySet<string>,
  protectedTiles: ReadonlySet<string>,
  pathMask: Uint8Array,
  role: ScenicGrammarRole,
  clusterMembers: readonly StaticSceneryPlacement[],
): boolean {
  const footprint = landmarkFootprintTiles(contactTile, variant.visualFootprint);
  if (footprint.some((tile) => !insideCanonicalMap(tile) || protectedTiles.has(tileKey(tile)))) {
    return false;
  }
  if (variant.hardOffsets.some((value) => !blockingTiles.has(tileKey({
    column: contactTile.column + value.x,
    row: contactTile.row + value.y,
  })))) return false;
  const exclusions = variant.interactionExclusionOffsets.map((value) => ({
    column: contactTile.column + value.x,
    row: contactTile.row + value.y,
  }));
  if (exclusions.some((tile) => !insideCanonicalMap(tile)
    || protectedTiles.has(tileKey(tile))
    || pathMask[indexOf(tile)] === 1)) return false;
  if (role !== "reclaimed-path-shoulder"
    && footprint.filter((tile) => pathMask[indexOf(tile)] === 1).length > 1) return false;
  const nearestClusterDistance = Math.min(
    ...clusterMembers.map(({ tile }) => manhattan(contactTile, tile)),
  );
  if (!Number.isFinite(nearestClusterDistance) || nearestClusterDistance > 4) return false;
  return true;
}

function landmarkFootprintTiles(
  contactTile: TileCoord,
  footprint: TileVisualFootprint,
): readonly TileCoord[] {
  const origin = {
    column: contactTile.column + footprint.originOffsetTiles.x,
    row: contactTile.row + footprint.originOffsetTiles.y,
  };
  return Array.from({ length: footprint.heightTiles }, (_unused, row) =>
    Array.from({ length: footprint.widthTiles }, (_other, column) => ({
      column: origin.column + column,
      row: origin.row + row,
    }))).flat();
}

function insideCanonicalMap(tile: TileCoord): boolean {
  return tile.column >= 0 && tile.row >= 0 && tile.column < COLUMNS && tile.row < ROWS;
}

function nearestPathOrientation(anchor: TileCoord, pathMask: Uint8Array): "east-west" | "north-south" {
  const nearest = maskTiles(pathMask, COLUMNS).sort((left, right) =>
    manhattan(left, anchor) - manhattan(right, anchor)
    || left.row - right.row || left.column - right.column)[0];
  if (nearest === undefined) return "east-west";
  const horizontal = [
    { column: nearest.column - 1, row: nearest.row },
    { column: nearest.column + 1, row: nearest.row },
  ].filter((tile) => insideCanonicalMap(tile) && pathMask[indexOf(tile)] === 1).length;
  const vertical = [
    { column: nearest.column, row: nearest.row - 1 },
    { column: nearest.column, row: nearest.row + 1 },
  ].filter((tile) => insideCanonicalMap(tile) && pathMask[indexOf(tile)] === 1).length;
  return vertical > horizontal ? "north-south" : "east-west";
}

function landmarkTopologyRank(topologyKey: string, orientation: "east-west" | "north-south"): number {
  if (topologyKey.endsWith(`:${orientation}`)) return 0;
  if (topologyKey.endsWith(":none")) return 1;
  return 2;
}

function selectClusterBoundSatellites(
  identity: RegionMapIdentity,
  districtIndex: number,
  count: number,
  claimed: Set<string>,
  clusterMemberTiles: readonly TileCoord[],
): readonly TileCoord[] {
  const sector = LANDSCAPE_SECTORS[districtIndex];
  if (sector === undefined) throw new Error(`missing landscape sector for district ${districtIndex}`);
  const candidates: Array<Readonly<{ tile: TileCoord; distance: number; tie: number }>> = [];
  for (let row = sector.row; row < sector.row + LANDSCAPE_SECTOR_ROWS; row += 1) {
    for (let column = sector.column; column < sector.column + LANDSCAPE_SECTOR_COLUMNS; column += 1) {
      const tile = { column, row };
      if (claimed.has(tileKey(tile))) continue;
      const distance = Math.min(...clusterMemberTiles.map((member) => manhattan(tile, member)));
      if (distance > 3) continue;
      candidates.push({
        tile,
        distance,
        tie: stableHash(
          `${identity.runSeed}:${identity.regionId}:satellite:${districtIndex}:${column}:${row}`,
        ),
      });
    }
  }
  const selected = candidates
    .sort((left, right) => left.distance - right.distance || left.tie - right.tie
      || left.tile.row - right.tile.row || left.tile.column - right.tile.column)
    .slice(0, count)
    .map((candidate) => candidate.tile);
  if (selected.length !== count) {
    throw new Error(`could not allocate cluster-bound satellites ${districtIndex} (${selected.length}/${count})`);
  }
  for (const tile of selected) claimed.add(tileKey(tile));
  return selected;
}

function selectConnectedLandscapeCluster(
  identity: RegionMapIdentity,
  districtIndex: number,
  clusterIndex: number,
  size: number,
  claimed: ReadonlySet<string>,
  preferredTiles: readonly TileCoord[],
  requirePreferredAdjacency: boolean,
): readonly TileCoord[] {
  const sourceShape = SCENIC_CLUSTER_SHAPES[size];
  if (sourceShape === undefined) throw new Error(`unsupported scenic cluster size ${size}`);
  const sector = LANDSCAPE_SECTORS[districtIndex];
  if (sector === undefined) throw new Error(`missing landscape sector for district ${districtIndex}`);
  let selected: Readonly<{ tiles: readonly TileCoord[]; distance: number; tie: number }> | undefined;
  for (const [variantIndex, shape] of uniqueShapeVariants([sourceShape]).entries()) {
    const bounds = shapeBounds(shape);
    for (let row = sector.row + 1; row <= sector.row + LANDSCAPE_SECTOR_ROWS - bounds.height - 1; row += 1) {
      for (let column = sector.column + 1; column <= sector.column + LANDSCAPE_SECTOR_COLUMNS - bounds.width - 1; column += 1) {
        const tiles = shape.map((tile) => ({ column: column + tile.column, row: row + tile.row }));
        if (tiles.some((tile) => claimed.has(tileKey(tile)))) continue;
        const distance = preferredTiles.length === 0
          ? 0
          : Math.min(...tiles.flatMap((tile) => preferredTiles.map((preferred) => manhattan(tile, preferred))));
        if (requirePreferredAdjacency && distance !== 1) continue;
        const candidate = {
          tiles,
          distance,
          tie: stableHash(
            `${identity.runSeed}:${identity.regionId}:cluster:${districtIndex}:${clusterIndex}:${variantIndex}:${column}:${row}`,
          ),
        };
        if (selected === undefined || candidate.distance < selected.distance
            || (candidate.distance === selected.distance && candidate.tie < selected.tie)) {
          selected = candidate;
        }
      }
    }
  }
  if (selected === undefined) {
    throw new Error(`could not allocate connected scenic cluster ${districtIndex}:${clusterIndex}`);
  }
  return [...selected.tiles].sort((left, right) => left.row - right.row || left.column - right.column);
}

function waterComponentNearest(
  waterTiles: readonly TileCoord[],
  target: TileCoord,
): readonly TileCoord[] {
  return connectedTileComponents(waterTiles)
    .sort((left, right) => Math.min(...left.map((tile) => manhattan(tile, target)))
      - Math.min(...right.map((tile) => manhattan(tile, target))))[0] ?? [];
}

function createAnimatedEnvironment(
  identity: RegionMapIdentity,
  districts: readonly OverflowDistrict[],
  kinds: readonly AnimatedEnvironmentKind[],
  reserved: ReadonlySet<string>,
): readonly AnimatedEnvironmentPlacement[] {
  const kindOffset = stableHash(`${identity.runSeed}:${identity.regionId}:animated-kinds`) % kinds.length;
  const claimed = new Set(reserved);
  let ordinal = 0;
  return districts.flatMap((district) =>
    selectLandscapeSectorTiles(
      identity,
      `animated:district-${district.index}`,
      district.index,
      ANIMATED_ENVIRONMENT_PER_DISTRICT,
      claimed,
    ).map((tile) => {
      const index = ordinal;
      ordinal += 1;
      return {
        id: `${identity.regionId}:animated-${index}`,
        kind: kinds[(index + kindOffset) % kinds.length],
        tile,
        phaseSeed: stableHash(`${identity.runSeed}:${identity.regionId}:phase:${index}`),
      };
    }));
}

function environmentRenderRect(
  tile: TileCoord,
  footprint: SceneryVisualFootprint = UNIT_VISUAL_FOOTPRINT,
): Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}> {
  return {
    x: tile.column * TILE_SIZE,
    y: tile.row * TILE_SIZE,
    width: footprint.widthTiles * ENVIRONMENT_RENDER_FOOTPRINT.width,
    height: footprint.heightTiles * ENVIRONMENT_RENDER_FOOTPRINT.height,
  };
}

function selectLandscapeSectorTiles(
  identity: RegionMapIdentity,
  namespace: string,
  districtIndex: number,
  count: number,
  claimed: Set<string>,
): TileCoord[] {
  const selected: TileCoord[] = [];
  const sector = LANDSCAPE_SECTORS[districtIndex];
  if (sector === undefined) throw new Error(`missing landscape sector for district ${districtIndex}`);
  const capacity = LANDSCAPE_SECTOR_COLUMNS * LANDSCAPE_SECTOR_ROWS;
  let cursor = stableHash(`${identity.runSeed}:${identity.regionId}:${namespace}`) % capacity;
  const stride = 35;
  for (let attempts = 0; selected.length < count && attempts < capacity; attempts += 1) {
    const tile = {
      column: sector.column + (cursor % LANDSCAPE_SECTOR_COLUMNS),
      row: sector.row + Math.floor(cursor / LANDSCAPE_SECTOR_COLUMNS),
    };
    if (!claimed.has(tileKey(tile))) {
      selected.push(tile);
      claimed.add(tileKey(tile));
    }
    cursor = (cursor + stride) % capacity;
  }
  if (selected.length !== count) {
    throw new Error(`could not allocate ${namespace} placements (${selected.length}/${count})`);
  }
  return selected;
}

function createEdgeMask(): Uint8Array {
  const mask = new Uint8Array(COLUMNS * ROWS);
  for (let column = 0; column < COLUMNS; column += 1) {
    mask[column] = 1;
    mask[(ROWS - 1) * COLUMNS + column] = 1;
  }
  for (let row = 0; row < ROWS; row += 1) {
    mask[row * COLUMNS] = 1;
    mask[row * COLUMNS + COLUMNS - 1] = 1;
  }
  return mask;
}

function markBoundaryCollision(collision: Uint8Array): void {
  const edge = createEdgeMask();
  collision.set(edge);
}

function markMechanicsGuardCollision(collision: Uint8Array, reserved: Set<string>): void {
  const near = MECHANICS_CORE_ORIGIN;
  const far = MECHANICS_CORE_ORIGIN + MECHANICS_CORE_SIZE - 1;
  for (let coordinate = near; coordinate <= far; coordinate += 1) {
    for (const tile of [
      { column: coordinate, row: near },
      { column: far, row: coordinate },
      { column: coordinate, row: far },
      { column: near, row: coordinate },
    ]) {
      collision[indexOf(tile)] = 1;
      reserved.add(tileKey(tile));
    }
  }
}

/**
 * Which exact identity each presentation profile belongs to.
 *
 * A table rather than a chain of `if`s because this is the one place every exact region
 * has to touch, and regions are productionised concurrently: adding one is a single row,
 * so two agents landing two regions cannot silently overwrite each other's branch.
 */
const EXACT_PRESENTATION_PROFILES: Readonly<Record<
  RegionPresentationProfile["kind"],
  Readonly<{ regionId: string; kit: RegionKitId }>
>> = Object.freeze({
  "nirvana-v2": Object.freeze({ regionId: "nirvana", kit: "worn-heartland" }),
  "warm-springs-v1": Object.freeze({ regionId: "warm_springs", kit: "spring-terraces" }),
  "nirvana-east-v1": Object.freeze({ regionId: "nirvana_east", kit: "dry-scrub" }),
  "nirvana-west-v1": Object.freeze({ regionId: "nirvana_west", kit: "ash-waste" }),
});

/**
 * Exact regions whose animated environment is placed from their own TERRAIN rather than
 * from the eight rim `LANDSCAPE_SECTORS` — an exemption from WHERE, never from HOW MANY.
 *
 * The generic rule is 4 placements per district anchor, 32 per region, every one confined
 * to a rim sector. For most regions that is right: ambient grass and smoke belong in the
 * margins. For `nirvana_west` it is not merely thin, it is WRONG — that region's identity
 * IS its fire (`ash-waste` is the only kit whose animated kinds are `ember` and
 * `smoke-anchor`), and the rim sectors are nowhere near the fissures the fire has to
 * belong to, so the generic rule burns flames on cold bare slate. Its exact builder
 * therefore RELOCATES those same 32 placements onto the hottest fissure ground within
 * each placement's own sector, keeping every `id` and `kind`.
 *
 * **Scoped to the sector check.** An earlier attempt widened this into a `1..160` RANGE,
 * which was rightly retired: a ceiling is not a count, and a range stops the invariant
 * catching a region that emits 1 — the failure it exists for. What replaces it below is a
 * per-region EXACT budget, so every region including this one is still checked against a
 * single number.
 *
 * A region in this set still has every other animated-environment invariant enforced
 * unchanged: kind must belong to its biome kit, ids and tiles must be unique, and no
 * placement may overlap a shelter render footprint, a staging envelope or a critical-route
 * standing envelope.
 */
const TERRAIN_PLACED_ANIMATED_ENVIRONMENT: ReadonlySet<RegionPresentationProfile["kind"]> =
  Object.freeze(new Set<RegionPresentationProfile["kind"]>(["nirvana-west-v1"]));

/** True when a recipe places its animated environment from terrain, not the rim sectors. */
function placesAnimatedEnvironmentFromTerrain(recipe: RegionMapRecipeV1): boolean {
  const kind = recipe.presentationProfile?.kind;
  return kind !== undefined && TERRAIN_PLACED_ANIMATED_ENVIRONMENT.has(kind);
}

/**
 * Exact regions whose animated-environment budget is not the generic 32 — a different
 * NUMBER, never a range and never a licence to emit any number at all.
 *
 * **Why per-region rather than one raised global cap.** The generic budget is
 * `ANIMATED_ENVIRONMENT_PER_DISTRICT` (4) x 8 district anchors, and for most kits it is
 * the right number: `worn-heartland` and `spring-terraces` animate grass, reeds and
 * water, which are texture, not subject. `ash-waste` is the only kit whose animated kinds
 * are `ember` and `smoke-anchor` — its animated layer IS the region's subject, and 32
 * flames across 9,216 tiles is not thin, it is absent: measured on the shipped region,
 * the pilot's own approved viewport (tile 0,54) contained **zero** of them.
 *
 * Raising the number globally instead would put hundreds of ambient sprites into every
 * other region, blow the `water`/`wind` pools (32 slots each) that those kits' kinds route
 * to, and re-baseline every region's recipe digest — three costs paid by three regions
 * that did not ask for them. A one-row table costs nothing to anyone else.
 *
 * **The renderer must be able to seat what a row here declares.** `ash-waste` is the one
 * kit whose EVERY animated kind routes to `EnvironmentSystem`'s single `smoke` pool, so a
 * budget above `ENVIRONMENT_POOL_CAPACITIES.smoke` would be silently truncated by
 * `insertFirstEmpty` and would then starve every runtime particle behind it — the exact
 * defect that hid 16 of this region's first 32 flames. That coupling is asserted by
 * `EnvironmentSystem.test.ts`, which reads this table directly, so the two numbers cannot
 * drift apart.
 */
const EXACT_ANIMATED_ENVIRONMENT_BUDGETS: Readonly<
  Partial<Record<RegionPresentationProfile["kind"], number>>
> = Object.freeze({
  "nirvana-west-v1": 384,
});

/**
 * The exact number of animated-environment placements a recipe must carry.
 *
 * @param recipe - The recipe being validated.
 * @returns Its per-region budget if it declares one, otherwise the generic
 *   `4 x 8 districts` = 32.
 */
export function exactAnimatedEnvironmentBudget(recipe: RegionMapRecipeV1): number {
  const kind = recipe.presentationProfile?.kind;
  const exact = kind === undefined ? undefined : EXACT_ANIMATED_ENVIRONMENT_BUDGETS[kind];
  return exact ?? DISTRICT_ORIGINS.length * ANIMATED_ENVIRONMENT_PER_DISTRICT;
}

/**
 * The largest animated-environment budget any region declares.
 *
 * Published so the renderer's ambient pool can be sized against it and asserted, rather
 * than against a number someone remembered to update twice.
 */
export const MAX_EXACT_ANIMATED_ENVIRONMENT_BUDGET: number = Math.max(
  DISTRICT_ORIGINS.length * ANIMATED_ENVIRONMENT_PER_DISTRICT,
  ...Object.values(EXACT_ANIMATED_ENVIRONMENT_BUDGETS),
);

function validatePresentationProfile(recipe: RegionMapRecipeV1): void {
  if (recipe.presentationProfile === undefined) return;
  const profile = requireRecord(recipe.presentationProfile, "recipe.presentationProfile");
  if (!sameSerialized(Object.keys(profile).sort(), [
    "atlasProfileVersion",
    "kind",
    "staticSceneHash",
  ])) {
    throw new Error("recipe presentation profile must contain only canonical exact-region fields");
  }
  const owner = typeof profile.kind === "string"
    ? EXACT_PRESENTATION_PROFILES[profile.kind as RegionPresentationProfile["kind"]]
    : undefined;
  if (owner === undefined || profile.atlasProfileVersion !== 2) {
    throw new Error("recipe presentation profile must use a known exact-region atlas profile version 2");
  }
  if (typeof profile.staticSceneHash !== "string"
      || !/^[0-9a-f]{8}$/.test(profile.staticSceneHash)) {
    throw new Error("recipe presentation profile static scene hash must be eight lowercase hexadecimal characters");
  }
  if (recipe.regionId !== owner.regionId || recipe.kit !== owner.kit) {
    throw new Error(
      `recipe ${String(profile.kind)} presentation profile belongs only to exact region ${owner.regionId}`,
    );
  }
}

/**
 * Hold a recipe's rim to its declared walk topology.
 *
 * Replaces the two former "the boundary must remain hard collision" assertions. Those
 * were correct while toroidal walking was unactivated; the honest contract now is
 * RECIPROCITY, and it is strictly stronger where it matters — it still forbids every open
 * rim tile on a bounded region, and on a toroidal region it forbids exactly the openings
 * that would strand a being: an unmatched edge tile, or a corner.
 *
 * @throws If any rim tile breaks the contract, naming the first offender and its reason.
 */
function assertWalkTopologyBoundary(recipe: RegionMapRecipeV1, label: string): void {
  const violations = wrapSeamViolations(recipe.grid);
  const first = violations[0];
  if (first === undefined) return;
  throw new Error(
    `${label} boundary tile ${first.tile.column},${first.tile.row} breaks the `
    + `${recipe.grid.topology ?? "bounded"} walk topology (${first.reason})`,
  );
}

function validateNirvanaPresentationRecipe(recipe: RegionMapRecipeV1): void {
  const cellCount = recipe.grid.columns * recipe.grid.rows;
  for (const [label, mask] of [
    ["collision", recipe.grid.collision],
    ["edge", recipe.edgeMask],
    ["water/void", recipe.waterVoidMask],
    ["path", recipe.pathMask],
    ["soil", recipe.soilMask],
  ] as const) {
    if (!(mask instanceof Uint8Array) || mask.length !== cellCount) {
      throw new Error(
        `Nirvana V2 recipe ${label} mask must cover the exact ${recipe.grid.columns}x${recipe.grid.rows} world`,
      );
    }
  }

  const gates = requireArray(recipe.gates, "recipe.gates");
  const arrivalAnchors = requireArray(recipe.arrivalAnchors, "recipe.arrivalAnchors");
  const spawnAnchors = requireArray(recipe.spawnAnchors, "recipe.spawnAnchors");
  const socialAnchors = requireArray(recipe.socialAnchors, "recipe.socialAnchors");
  const stagingAnchors = requireArray(recipe.stagingAnchors, "recipe.stagingAnchors");
  const stagingPoints = requireArray(recipe.stagingPoints, "recipe.stagingPoints");
  const shelterPlots = requireArray(recipe.shelterPlots, "recipe.shelterPlots");
  const resourceAnchors = requireRecord(recipe.resourceAnchors, "recipe.resourceAnchors");
  const energyAnchors = requireArray(resourceAnchors.energy, "recipe.resourceAnchors.energy");
  const materialsAnchors = requireArray(resourceAnchors.materials, "recipe.resourceAnchors.materials");
  const suppressedPresentation = [
    ["staticScenery", requireArray(recipe.staticScenery, "recipe.staticScenery")],
    ["scenicClusters", requireArray(recipe.scenicClusters, "recipe.scenicClusters")],
    ["scenicLandmarks", requireArray(recipe.scenicLandmarks, "recipe.scenicLandmarks")],
    ["storyNeighborhoods", requireArray(recipe.storyNeighborhoods, "recipe.storyNeighborhoods")],
    ["terrainPatches", requireArray(recipe.terrainPatches, "recipe.terrainPatches")],
    ["visualPathCompositions", requireArray(
      recipe.visualPathCompositions,
      "recipe.visualPathCompositions",
    )],
    ["occupiedHomeObligations", requireArray(
      recipe.occupiedHomeObligations,
      "recipe.occupiedHomeObligations",
    )],
    ["storyDistricts", requireArray(recipe.storyDistricts, "recipe.storyDistricts")],
    ["animatedEnvironment", requireArray(
      recipe.animatedEnvironment,
      "recipe.animatedEnvironment",
    )],
  ] as const;
  if (suppressedPresentation.some(([, values]) => values.length !== 0)) {
    throw new Error("Nirvana V2 scenery-only story presentation must remain empty");
  }
  const gateStoryTopology = requireRecord(
    recipe.gateStoryTopology,
    "recipe.gateStoryTopology",
  );
  if (!sameSerialized(Object.keys(gateStoryTopology).sort(), ["mode", "reason"])
      || gateStoryTopology.mode !== "presentation-deferred"
      || gateStoryTopology.reason !== "exact-region-scenery-only") {
    throw new Error("Nirvana V2 must use the canonical scenery-only gate story topology");
  }
  const districts = requireArray(recipe.districts, "recipe.districts");
  const parsedDistricts = validateNirvanaDistricts(recipe, districts);
  const requiredShelterPlots = parsedDistricts.length * 16;
  const requiredStaging = parsedDistricts.length * STAGING_POINTS_PER_DISTRICT;
  if (
    shelterPlots.length !== requiredShelterPlots
    || stagingAnchors.length !== requiredStaging
    || stagingPoints.length !== requiredStaging
  ) {
    throw new Error(
      `Nirvana V2 recipe must provide exactly ${requiredShelterPlots} shelter plots and ${requiredStaging} staging envelopes for ${parsedDistricts.length} districts`,
    );
  }
  const plotIds = new Set<string>();
  const plotTiles = new Set<string>();
  const parsedShelterPlots = shelterPlots.map((value) => validateShelterPlot(
    value,
    recipe.grid,
    plotIds,
    plotTiles,
    "Nirvana V2 recipe.shelterPlots",
  ));
  validateStagingGeometry(
    recipe,
    stagingAnchors,
    stagingPoints,
    parsedShelterPlots,
    [],
    requiredStaging,
  );
  if (
    !sameSerialized(
      socialAnchors,
      parsedDistricts.flatMap(({ socialAnchors: values }) => values),
    )
    || !sameSerialized(
      stagingAnchors,
      parsedDistricts.flatMap(({ stagingAnchors: values }) => values),
    )
    || !sameSerialized(
      stagingPoints,
      parsedDistricts.flatMap(({ stagingPoints: values }) => values),
    )
    || !sameSerialized(
      shelterPlots,
      parsedDistricts.flatMap(({ shelterPlots: values }) => values),
    )
  ) {
    throw new Error(
      "Nirvana V2 global social, staging, and shelter mechanics must exactly concatenate its districts",
    );
  }

  for (let row = 0; row < recipe.grid.rows; row += 1) {
    for (let column = 0; column < recipe.grid.columns; column += 1) {
      const index = row * recipe.grid.columns + column;
      const edge = row === 0 || column === 0
        || row === recipe.grid.rows - 1 || column === recipe.grid.columns - 1;
      if (recipe.edgeMask[index] !== (edge ? 1 : 0)) {
        throw new Error(
          `Nirvana V2 recipe edge mask must mark exactly the ${recipe.grid.columns}x${recipe.grid.rows} boundary`,
        );
      }
      // The rim is no longer unconditionally hard. Topology IS activated: the boundary
      // contract is now reciprocity, checked once for the whole rim below by
      // `assertWalkTopologyBoundary`.

      if (recipe.waterVoidMask[index] === 1 && recipe.grid.collision[index] !== 1) {
        throw new Error("Nirvana V2 water/void cells must be hard collision cells");
      }
      if (recipe.pathMask[index] === 1 && recipe.grid.collision[index] !== 0) {
        throw new Error("Nirvana V2 authored road cells must remain collision-open");
      }
    }
  }
  assertWalkTopologyBoundary(recipe, "Nirvana V2 recipe");

  const parsedGates = gates.map((value) => {
    const gate = requireRecord(value, "recipe.gates entry");
    const edge = requireRecord(gate.edge, "recipe.gates edge");
    if (gate.role !== "arrival" && gate.role !== "departure") {
      throw new Error("Nirvana V2 gate role must be arrival or departure");
    }
    if (gate.facing !== "north" && gate.facing !== "east"
        && gate.facing !== "south" && gate.facing !== "west") {
      throw new Error("Nirvana V2 gate facing must be cardinal");
    }
    return {
      edge: {
        from: requireNonEmptyString(edge.from, "recipe.gates edge.from"),
        to: requireNonEmptyString(edge.to, "recipe.gates edge.to"),
      },
      role: gate.role,
      facing: gate.facing,
      tile: requireTile(gate.tile, recipe.grid, "recipe.gates tile"),
    } satisfies RegionGate;
  });
  const expectedArrivals = parsedGates
    .filter(({ role }) => role === "arrival")
    .map(({ tile }) => tile);
  if (!sameSerialized(arrivalAnchors, expectedArrivals)) {
    throw new Error("Nirvana V2 arrival anchors must exactly match arrival gates");
  }

  const anchors = [
    ...parsedGates.map(({ tile }) => tile),
    ...arrivalAnchors,
    ...spawnAnchors,
    ...socialAnchors,
    ...energyAnchors,
    ...materialsAnchors,
    ...stagingAnchors,
    ...shelterPlots.flatMap((value) => {
      const plot = requireRecord(value, "recipe.shelterPlots entry");
      return [plot.tile, plot.door];
    }),
  ].map((value) => requireTile(value, recipe.grid, "Nirvana V2 mechanical anchor"));
  for (const anchor of anchors) {
    if (recipe.grid.collision[gridIndex(recipe.grid, anchor)] !== 0) {
      throw new Error(`Nirvana V2 mechanical anchor ${tileKey(anchor)} must remain collision-open`);
    }
  }
  for (const pointValue of stagingPoints) {
    const point = requirePoint(pointValue, "recipe.stagingPoints entry");
    const tile = navigationTileForFeet(point);
    requireTile(tile, recipe.grid, "recipe staging point navigation tile");
    if (recipe.grid.collision[gridIndex(recipe.grid, tile)] !== 0) {
      throw new Error("Nirvana V2 staging envelope must remain collision-open");
    }
  }
  validateAnchorConnectivity(recipe, anchors);
}

function validateNirvanaDistricts(
  recipe: RegionMapRecipeV1,
  values: readonly unknown[],
): readonly OverflowDistrict[] {
  const canonicalDistricts = createCanonicalDistricts(recipe.regionId);
  if (values.length < canonicalDistricts.length) {
    throw new Error("Nirvana V2 recipe must preserve all eight Genesis districts");
  }
  const normalized = values.map((value, districtIndex): OverflowDistrict => {
    const district = requireRecord(value, "recipe.districts entry");
    if (!sameSerialized(Object.keys(district).sort(), [
      "index",
      "origin",
      "shelterPlots",
      "socialAnchors",
      "stagingAnchors",
      "stagingPoints",
    ])) {
      throw new Error("Nirvana V2 district must contain only canonical mechanics fields");
    }
    const index = requireNonNegativeInteger(
      district.index,
      "recipe.districts index",
    );
    if (index !== districtIndex) {
      throw new Error("Nirvana V2 districts must use contiguous canonical indices");
    }
    const origin = requireTile(
      district.origin,
      recipe.grid,
      "recipe.districts origin",
    );
    const socialAnchors = requireArray(
      district.socialAnchors,
      "recipe.districts socialAnchors",
    ).map((anchor) => requireTile(
      anchor,
      recipe.grid,
      "recipe.districts social anchor",
    ));
    const stagingAnchors = requireArray(
      district.stagingAnchors,
      "recipe.districts stagingAnchors",
    ).map((anchor) => requireTile(
      anchor,
      recipe.grid,
      "recipe.districts staging anchor",
    ));
    const stagingPoints = requireArray(
      district.stagingPoints,
      "recipe.districts stagingPoints",
    ).map((point) => requirePoint(point, "recipe.districts staging point"));
    const localPlotIds = new Set<string>();
    const localPlotTiles = new Set<string>();
    const shelterPlots = requireArray(
      district.shelterPlots,
      "recipe.districts shelterPlots",
    ).map((plot) => validateShelterPlot(
      plot,
      recipe.grid,
      localPlotIds,
      localPlotTiles,
      "recipe.districts shelter plot",
    ));
    if (
      districtIndex >= canonicalDistricts.length
      && (
        socialAnchors.length !== 1
        || stagingAnchors.length !== STAGING_POINTS_PER_DISTRICT
        || stagingPoints.length !== STAGING_POINTS_PER_DISTRICT
        || shelterPlots.length !== 16
      )
    ) {
      throw new Error(
        "Nirvana V2 generated districts require one social anchor, 32 staging anchors and points, and 16 shelter plots",
      );
    }
    return {
      index,
      origin,
      socialAnchors,
      stagingAnchors,
      stagingPoints,
      shelterPlots,
    };
  });
  if (!sameSerialized(
    normalized.slice(0, canonicalDistricts.length),
    canonicalDistricts,
  )) {
    throw new Error(
      "Nirvana V2 recipe must preserve exact canonical Genesis district mechanics",
    );
  }
  return normalized;
}

function validateRecipe(recipe: RegionMapRecipeV1): void {
  requireNonEmptyString(recipe.regionId, "recipe.regionId");
  if (typeof recipe.identityHash !== "string" || !/^[0-9a-f]{8}$/.test(recipe.identityHash)) {
    throw new Error("recipe.identityHash must be an eight-character lowercase hexadecimal hash");
  }
  const kitIds: readonly RegionKitId[] = ["worn-heartland", "spring-terraces", "dry-scrub", "ash-waste", "neutral-temperate"];
  if (!kitIds.includes(recipe.kit)) throw new Error("recipe.kit must be a known production biome kit");
  validatePresentationProfile(recipe);
  if (recipe.presentationProfile?.kind === "nirvana-v2") {
    if (
      recipe.grid.columns < COLUMNS
      || recipe.grid.rows < ROWS
      || recipe.grid.columns % 48 !== 0
      || recipe.grid.rows % 32 !== 0
    ) {
      throw new Error(
        "Nirvana V2 recipe grid must use complete 48x32 chunks from the 96x96 Genesis boundary",
      );
    }
    validateNirvanaPresentationRecipe(recipe);
    return;
  }
  if (recipe.grid.columns !== COLUMNS || recipe.grid.rows !== ROWS) {
    throw new Error(`recipe grid must preserve the exact canonical ${COLUMNS}x${ROWS} boundary`);
  }
  const gates = requireArray(recipe.gates, "recipe.gates");
  const arrivalAnchors = requireArray(recipe.arrivalAnchors, "recipe.arrivalAnchors");
  const spawnAnchors = requireArray(recipe.spawnAnchors, "recipe.spawnAnchors");
  const socialAnchors = requireArray(recipe.socialAnchors, "recipe.socialAnchors");
  const stagingAnchors = requireArray(recipe.stagingAnchors, "recipe.stagingAnchors");
  const stagingPoints = requireArray(recipe.stagingPoints, "recipe.stagingPoints");
  const shelterPlots = requireArray(recipe.shelterPlots, "recipe.shelterPlots");
  const staticScenery = requireArray(recipe.staticScenery, "recipe.staticScenery");
  const scenicClusters = requireArray(recipe.scenicClusters, "recipe.scenicClusters");
  const scenicLandmarks = requireArray(recipe.scenicLandmarks, "recipe.scenicLandmarks");
  const storyNeighborhoods = requireArray(recipe.storyNeighborhoods, "recipe.storyNeighborhoods");
  const terrainPatches = requireArray(recipe.terrainPatches, "recipe.terrainPatches");
  const visualPathCompositions = requireArray(
    recipe.visualPathCompositions,
    "recipe.visualPathCompositions",
  );
  const occupiedHomeObligations = requireArray(
    recipe.occupiedHomeObligations,
    "recipe.occupiedHomeObligations",
  );
  const storyDistricts = requireArray(recipe.storyDistricts, "recipe.storyDistricts");
  requireRecord(recipe.gateStoryTopology, "recipe.gateStoryTopology");
  const animatedEnvironment = requireArray(recipe.animatedEnvironment, "recipe.animatedEnvironment");
  const districts = requireArray(recipe.districts, "recipe.districts");
  const resourceAnchors = requireRecord(recipe.resourceAnchors, "recipe.resourceAnchors");
  const energyAnchors = requireArray(resourceAnchors.energy, "recipe.resourceAnchors.energy");
  const materialsAnchors = requireArray(resourceAnchors.materials, "recipe.resourceAnchors.materials");
  for (let index = 0; index < recipe.waterVoidMask.length; index += 1) {
    if (recipe.waterVoidMask[index] === 1 && recipe.grid.collision[index] !== 1) {
      throw new Error("water/void cells must be hard collision cells");
    }
  }
  for (let row = 0; row < recipe.grid.rows; row += 1) {
    for (let column = 0; column < recipe.grid.columns; column += 1) {
      const index = row * recipe.grid.columns + column;
      const expectedEdge = row === 0 || column === 0 || row === recipe.grid.rows - 1 || column === recipe.grid.columns - 1;
      if (recipe.edgeMask[index] !== (expectedEdge ? 1 : 0)) {
        throw new Error("recipe edge mask must mark exactly the map boundary");
      }
      // See `assertWalkTopologyBoundary`: a bounded rim is still entirely hard collision,
      // a toroidal rim may open only at reciprocal, non-corner seams.
    }
  }
  assertWalkTopologyBoundary(recipe, "recipe");
  const staticIds = new Set<string>();
  const staticTiles = new Set<string>();
  const environmentPlacements: Array<Readonly<{
    id: string;
    tile: TileCoord;
    visualFootprint: SceneryVisualFootprint;
  }>> = [];
  const kit = getBiomeKit(recipe.kit);
  const kitStaticKinds = new Set([...kit.blockingScenery, ...kit.passiveScenery]);
  const kitBlockingKinds = new Set(kit.blockingScenery);
  const kitRoles = new Set<ScenicGrammarRole>([
    kit.sceneGrammar.signatureRole,
    ...(kit.sceneGrammar.detachedSignatureRole === undefined
      ? [] : [kit.sceneGrammar.detachedSignatureRole]),
    ...kit.sceneGrammar.supportRoles,
    "satellite-accent",
  ]);
  for (const value of staticScenery) {
    const scenery = requireRecord(value, "recipe.staticScenery entry");
    const id = requireNonEmptyString(scenery.id, "recipe.staticScenery id");
    const kind = requireNonEmptyString(scenery.kind, "recipe.staticScenery kind");
    if (!kitStaticKinds.has(kind)) throw new Error("recipe static scenery kind must belong to its biome kit");
    if (typeof scenery.blocksMovement !== "boolean") throw new Error("recipe.staticScenery blocksMovement must be boolean");
    if (scenery.blocksMovement !== kitBlockingKinds.has(kind)) {
      throw new Error("recipe static scenery movement flag must match its biome kind");
    }
    const clusterId = scenery.clusterId === null
      ? null
      : requireNonEmptyString(scenery.clusterId, "recipe.staticScenery clusterId");
    if (typeof scenery.role !== "string" || !kitRoles.has(scenery.role as ScenicGrammarRole)) {
      throw new Error("recipe static scenery role must belong to its biome scene grammar");
    }
    if ((clusterId === null) !== (scenery.role === "satellite-accent")) {
      throw new Error("recipe static scenery satellites alone may omit a cluster ID");
    }
    const visualFootprint = requireVisualFootprint(
      scenery.visualFootprint,
      "recipe.staticScenery visual footprint",
    );
    const hardCollisionFootprint = requireCollisionFootprint(
      scenery.hardCollisionFootprint,
      visualFootprint,
      "recipe.staticScenery hard collision footprint",
    );
    if (scenery.blocksMovement &&
        hardCollisionFootprint.length < visualFootprint.widthTiles * visualFootprint.heightTiles) {
      throw new Error("recipe static scenery visual footprint exceeds its hard collision footprint");
    }
    if (!scenery.blocksMovement && hardCollisionFootprint.length !== 0) {
      throw new Error("recipe passive static scenery hard collision footprint must be empty");
    }
    const tile = requireTile(scenery.tile, recipe.grid, "recipe.staticScenery tile");
    rejectDuplicate(staticIds, id, "duplicate static scenery ID");
    rejectDuplicate(staticTiles, tileKey(tile), "duplicate static scenery tile");
    const hardCells = hardCollisionFootprint.map((offset) => ({
      column: tile.column + offset.column,
      row: tile.row + offset.row,
    }));
    if (hardCells.some((cell) => cell.column >= recipe.grid.columns || cell.row >= recipe.grid.rows)) {
      throw new Error("recipe static scenery collision footprint must remain inside the map");
    }
    const expectedCollision = scenery.blocksMovement ? 1 : 0;
    if (recipe.grid.collision[tile.row * recipe.grid.columns + tile.column] !== expectedCollision ||
        hardCells.some((cell) => recipe.grid.collision[cell.row * recipe.grid.columns + cell.column] !== 1)) {
      throw new Error("static scenery movement flag must agree with collision");
    }
    environmentPlacements.push({ id, tile, visualFootprint });
  }
  const animatedIds = new Set<string>();
  const animatedTiles = new Set<string>();
  const animatedKinds: readonly AnimatedEnvironmentKind[] = ["water", "reed", "grass", "shrub", "tree", "ember", "smoke-anchor"];
  for (const value of animatedEnvironment) {
    const placement = requireRecord(value, "recipe.animatedEnvironment entry");
    const id = requireNonEmptyString(placement.id, "recipe.animatedEnvironment id");
    if (typeof placement.kind !== "string" || !animatedKinds.includes(placement.kind as AnimatedEnvironmentKind)) {
      throw new Error("recipe.animatedEnvironment kind must be supported");
    }
    if (!kit.animatedKinds.includes(placement.kind as AnimatedEnvironmentKind)) {
      throw new Error("recipe.animatedEnvironment kind must belong to its biome kit");
    }
    if (!Number.isSafeInteger(placement.phaseSeed) || (placement.phaseSeed as number) < 0) {
      throw new Error("recipe.animatedEnvironment phaseSeed must be a non-negative safe integer");
    }
    const tile = requireTile(placement.tile, recipe.grid, "recipe.animatedEnvironment tile");
    rejectDuplicate(animatedIds, id, "duplicate animated environment ID");
    rejectDuplicate(animatedTiles, tileKey(tile), "duplicate animated environment tile");
    environmentPlacements.push({ id, tile, visualFootprint: UNIT_VISUAL_FOOTPRINT });
  }
  const plotIds = new Set<string>();
  const plotTiles = new Set<string>();
  const parsedShelterPlots = shelterPlots.map((value) =>
    validateShelterPlot(value, recipe.grid, plotIds, plotTiles, "recipe.shelterPlots"));
  validateShelterFootprints(parsedShelterPlots, recipe.grid);
  const districtIndexes = new Set<number>();
  const districtOrigins = new Set<string>();
  const districtSocialAnchors: unknown[] = [];
  const districtStagingAnchors: unknown[] = [];
  const districtStagingPoints: unknown[] = [];
  const districtShelterPlots: unknown[] = [];
  const normalizedDistricts: OverflowDistrict[] = [];
  for (const [ordinal, value] of districts.entries()) {
    const district = requireRecord(value, "recipe.districts entry");
    if (!Number.isSafeInteger(district.index) || (district.index as number) < 0) throw new Error("recipe.districts index must be non-negative");
    if (district.index !== ordinal) throw new Error("recipe.districts indexes must be contiguous and ordered");
    if (districtIndexes.has(district.index as number)) throw new Error("recipe.districts contains duplicate index");
    districtIndexes.add(district.index as number);
    const origin = requireTile(district.origin, recipe.grid, "recipe.districts origin");
    rejectDuplicate(districtOrigins, tileKey(origin), "recipe.districts contains duplicate origin");
    const localSocial = requireArray(district.socialAnchors, "recipe.districts socialAnchors");
    const localStaging = requireArray(district.stagingAnchors, "recipe.districts stagingAnchors");
    const localStagingPoints = requireArray(district.stagingPoints, "recipe.districts stagingPoints");
    const localPlots = requireArray(district.shelterPlots, "recipe.districts shelterPlots");
    const parsedSocial = localSocial.map((tile) =>
      requireTile(tile, recipe.grid, "recipe.districts social anchor"));
    const parsedStaging = localStaging.map((tile) =>
      requireTile(tile, recipe.grid, "recipe.districts staging anchor"));
    const parsedStagingPoints = localStagingPoints.map((point) =>
      requirePoint(point, "recipe.districts staging point"));
    const parsedLocalPlots = localPlots.map((plot) => {
      const localIds = new Set<string>();
      const localTiles = new Set<string>();
      return validateShelterPlot(plot, recipe.grid, localIds, localTiles, "recipe.districts shelter plot");
    });
    normalizedDistricts.push({
      index: district.index as number,
      origin,
      socialAnchors: parsedSocial,
      stagingAnchors: parsedStaging,
      stagingPoints: parsedStagingPoints,
      shelterPlots: parsedLocalPlots,
    });
    districtSocialAnchors.push(...localSocial);
    districtStagingAnchors.push(...localStaging);
    districtStagingPoints.push(...localStagingPoints);
    districtShelterPlots.push(...localPlots);
  }
  if (!sameSerialized(districtSocialAnchors, socialAnchors)) throw new Error("recipe district social anchors must match global social anchors");
  if (!sameSerialized(districtStagingAnchors, stagingAnchors)) throw new Error("recipe district staging anchors must match global staging anchors");
  if (!sameSerialized(districtStagingPoints, stagingPoints)) throw new Error("recipe district staging points must match global staging points");
  if (!sameSerialized(districtShelterPlots, shelterPlots)) throw new Error("recipe district shelter plots must match global shelter plots");
  const canonicalDistricts = createCanonicalDistricts(recipe.regionId);
  if (!sameSerialized(normalizedDistricts, canonicalDistricts)) {
    throw new Error("recipe districts must preserve exact canonical district identities, origins, points, plots, IDs, and order");
  }
  const parsedGates: RegionGate[] = [];
  const gateTiles = new Set<string>();
  const gateRoles = new Set<string>();
  for (const value of gates) {
    const gate = requireRecord(value, "recipe.gates entry");
    const edge = requireRecord(gate.edge, "recipe.gates edge");
    const from = requireNonEmptyString(edge.from, "recipe.gates edge.from");
    const to = requireNonEmptyString(edge.to, "recipe.gates edge.to");
    if (gate.role !== "arrival" && gate.role !== "departure") throw new Error("recipe.gates role must be arrival or departure");
    if (gate.facing !== "north" && gate.facing !== "east" && gate.facing !== "south" && gate.facing !== "west") {
      throw new Error("recipe.gates facing must be a cardinal direction");
    }
    if ((gate.role === "departure" && from !== recipe.regionId) ||
        (gate.role === "arrival" && to !== recipe.regionId)) {
      throw new Error("recipe gate role must belong to the recipe region");
    }
    rejectDuplicate(gateRoles, `${from}>${to}:${gate.role}`, "duplicate gate role for directed edge");
    const tile = requireTile(gate.tile, recipe.grid, "recipe.gates tile");
    rejectDuplicate(gateTiles, tileKey(tile), "duplicate gate tile");
    parsedGates.push({ edge: { from, to }, role: gate.role, facing: gate.facing, tile });
  }
  const parsedArrivalAnchors = arrivalAnchors.map((tile) => requireTile(tile, recipe.grid, "recipe.arrivalAnchors tile"));
  const expectedArrivals = parsedGates.filter((gate) => gate.role === "arrival").map((gate) => gate.tile);
  if (parsedArrivalAnchors.length !== expectedArrivals.length ||
      parsedArrivalAnchors.some((anchor, index) => !sameTile(anchor, expectedArrivals[index]))) {
    throw new Error("recipe arrival anchors must exactly match ordered arrival gates");
  }
  const anchors = [
    ...parsedGates.map((gate) => gate.tile), ...parsedArrivalAnchors,
    ...spawnAnchors, ...socialAnchors, ...energyAnchors,
    ...materialsAnchors, ...stagingAnchors,
    ...shelterPlots.flatMap((value) => {
      const plot = requireRecord(value, "recipe.shelterPlots entry");
      return [plot.tile, plot.door];
    }),
  ];
  for (const anchor of anchors) {
    const tile = requireTile(anchor, recipe.grid, "anchor");
    if (recipe.grid.collision[tile.row * recipe.grid.columns + tile.column] !== 0) {
      throw new Error(`recipe anchor ${tileKey(tile)} must occupy an open collision tile`);
    }
  }
  for (const gate of parsedGates) {
    const tile = requireTile(gate.tile, recipe.grid, "gate");
    const side = perimeterSide(tile);
    const correctlyOriented = side !== null && gate.facing === (gate.role === "arrival" ? oppositeDirection(side) : side);
    if (!correctlyOriented) throw new Error("recipe gate orientation must match its perimeter tile");
  }
  validateAnchorConnectivity(recipe, anchors);
  validatePresentationMasks(recipe, parsedGates, socialAnchors);
  validateCategoryDisjointness(recipe, parsedGates, parsedArrivalAnchors, spawnAnchors,
    socialAnchors, energyAnchors, materialsAnchors, stagingAnchors, shelterPlots,
    staticScenery, animatedEnvironment);
  validateShelterEnvironmentClearance(parsedShelterPlots, environmentPlacements);
  validateStagingGeometry(
    recipe,
    stagingAnchors,
    stagingPoints,
    parsedShelterPlots,
    environmentPlacements,
  );
  validateCriticalRouteEnvironmentClearance(recipe, parsedShelterPlots, environmentPlacements);
  validateScenicLandmarkPlacements(recipe, scenicLandmarks, scenicClusters, staticScenery);
  validateCompositionDensity(
    recipe,
    staticScenery,
    scenicClusters,
    storyNeighborhoods,
    terrainPatches,
    visualPathCompositions,
    occupiedHomeObligations,
    storyDistricts,
    animatedEnvironment,
  );
}

function validateScenicLandmarkPlacements(
  recipe: RegionMapRecipeV1,
  values: readonly unknown[],
  clusterValues: readonly unknown[],
  sceneryValues: readonly unknown[],
): void {
  const expectedLandmarkCount = recipe.kit === "worn-heartland" ? clusterValues.length : 0;
  if (values.length !== expectedLandmarkCount) {
    throw new Error("recipe scenic landmarks must realize every scenic cluster exactly once");
  }
  const ids = new Set<string>();
  const clusterIds = new Set<string>();
  const visibleBlockingTiles = new Set<string>();
  for (const value of sceneryValues) {
    const scenery = requireRecord(value, "recipe.staticScenery entry");
    if (scenery.blocksMovement !== true) continue;
    const tile = requireTile(scenery.tile, recipe.grid, "recipe.staticScenery tile");
    visibleBlockingTiles.add(tileKey(tile));
  }
  for (const [index, value] of values.entries()) {
    const placement = requireRecord(value, "recipe.scenicLandmarks entry");
    const cluster = requireRecord(clusterValues[index], "recipe.scenicClusters entry");
    if (placement.recordType !== "scenic-landmark-placement") {
      throw new Error("recipe scenic landmark record type is invalid");
    }
    const id = requireNonEmptyString(placement.id, "recipe.scenicLandmarks id");
    const clusterId = requireNonEmptyString(placement.clusterId, "recipe.scenicLandmarks clusterId");
    rejectDuplicate(ids, id, "duplicate scenic landmark ID");
    rejectDuplicate(clusterIds, clusterId, "duplicate scenic landmark cluster ownership");
    if (clusterId !== cluster.id || placement.districtIndex !== cluster.districtIndex
      || placement.role !== cluster.role || id !== `${clusterId}:landmark`) {
      throw new Error("recipe scenic landmark must preserve ordered cluster ownership");
    }
    const semanticKind = requireNonEmptyString(
      placement.semanticKind,
      "recipe.scenicLandmarks semanticKind",
    ) as ScenicLandmarkKind;
    if (!LANDMARK_KINDS_BY_KIT[recipe.kit].includes(semanticKind)) {
      throw new Error("recipe scenic landmark semantic kind is foreign to its biome kit");
    }
    const variantId = requireNonEmptyString(placement.variantId, "recipe.scenicLandmarks variantId");
    const variant = AUTHORED_LANDMARK_VARIANTS_BY_KIT[recipe.kit]
      .find((candidate) => candidate.variantId === variantId);
    if (variant === undefined || variant.semanticKind !== semanticKind) {
      throw new Error("recipe scenic landmark variant is missing, stale, or semantically foreign");
    }
    if (placement.atlasId !== `${recipe.kit}-landmarks`) {
      throw new Error("recipe scenic landmark atlas ownership is foreign");
    }
    const frame = requireRecord(placement.frame, "recipe.scenicLandmarks frame");
    const expectedFrame = {
      x: (variant.cellIndex % 4) * 128,
      y: Math.floor(variant.cellIndex / 4) * 128,
      width: 128,
      height: 128,
    };
    if (canonicalSemanticJson(frame) !== canonicalSemanticJson(expectedFrame)) {
      throw new Error("recipe scenic landmark frame is stale for its atomic geometry");
    }
    const contactTile = requireTile(placement.contactTile, recipe.grid, "recipe.scenicLandmarks contactTile");
    const contactPivotPx = requirePoint(
      placement.contactPivotPx,
      "recipe.scenicLandmarks contactPivotPx",
    );
    const visualFootprint = requireRecord(
      placement.visualFootprint,
      "recipe.scenicLandmarks visualFootprint",
    );
    const originOffsetTiles = requirePoint(
      visualFootprint.originOffsetTiles,
      "recipe.scenicLandmarks visualFootprint originOffsetTiles",
    );
    const parsedFootprint = {
      originOffsetTiles,
      widthTiles: requirePositiveInteger(
        visualFootprint.widthTiles,
        "recipe.scenicLandmarks visualFootprint widthTiles",
      ),
      heightTiles: requirePositiveInteger(
        visualFootprint.heightTiles,
        "recipe.scenicLandmarks visualFootprint heightTiles",
      ),
    };
    const hardOffsets = requireArray(
      placement.hardOffsets,
      "recipe.scenicLandmarks hardOffsets",
    ).map((offset) => requirePoint(offset, "recipe.scenicLandmarks hard offset"));
    const interactionExclusionOffsets = requireArray(
      placement.interactionExclusionOffsets,
      "recipe.scenicLandmarks interactionExclusionOffsets",
    ).map((offset) => requirePoint(offset, "recipe.scenicLandmarks interaction exclusion"));
    const exactGeometry = {
      contactPivotPx,
      visualFootprint: parsedFootprint,
      hardOffsets,
      interactionExclusionOffsets,
      heightPolicy: placement.heightPolicy,
      topologyKey: placement.topologyKey,
      geometryHash: placement.geometryHash,
    };
    const expectedGeometry = {
      contactPivotPx: variant.contactPivotPx,
      visualFootprint: variant.visualFootprint,
      hardOffsets: variant.hardOffsets,
      interactionExclusionOffsets: variant.interactionExclusionOffsets,
      heightPolicy: variant.heightPolicy,
      topologyKey: variant.topologyKey,
      geometryHash: variant.geometryHash,
    };
    if (canonicalSemanticJson(exactGeometry) !== canonicalSemanticJson(expectedGeometry)) {
      throw new Error("recipe scenic landmark atomic geometry is stale");
    }
    if (placement.collisionBehavior !== "presentation-only" || placement.affectsMechanics !== false) {
      throw new Error("recipe scenic landmark must remain presentation-only");
    }
    if (hardOffsets.some((offset) => !visibleBlockingTiles.has(tileKey({
      column: contactTile.column + offset.x,
      row: contactTile.row + offset.y,
    })))) {
      throw new Error("recipe scenic landmark hard offsets must reuse visible cluster collision");
    }
    if (interactionExclusionOffsets.some((offset) => {
      const tile = { column: contactTile.column + offset.x, row: contactTile.row + offset.y };
      return !insideCanonicalMap(tile) || recipe.pathMask[indexOf(tile)] === 1;
    })) {
      throw new Error("recipe scenic landmark exclusion must remain inside and clear of routes");
    }
  }
}

function validatePresentationMasks(
  recipe: RegionMapRecipeV1,
  gates: readonly RegionGate[],
  socialAnchors: readonly unknown[],
): void {
  const expectedWaterBodies = WATER_BODY_SIZES[recipe.kit] ?? [];
  const waterTiles = maskTiles(recipe.waterVoidMask, recipe.grid.columns);
  const expectedWaterCount = expectedWaterBodies.reduce((sum, size) => sum + size, 0);
  if (waterTiles.length !== expectedWaterCount) {
    throw new Error(`recipe water mask must keep its exact biome budget of ${expectedWaterCount} cells`);
  }
  const waterComponents = connectedTileComponents(waterTiles);
  const actualWaterSizes = waterComponents.map((component) => component.length).sort((left, right) => left - right);
  const expectedWaterSizes = [...expectedWaterBodies].sort((left, right) => left - right);
  if (!sameSerialized(actualWaterSizes, expectedWaterSizes)) {
    throw new Error("recipe water mask must keep exact authored connected components");
  }
  for (const component of waterComponents) {
    if (!isIrregularTileComponent(component)) {
      throw new Error("recipe water mask components must have irregular non-rectangular perimeters");
    }
    const componentKeys = new Set(component.map(tileKey));
    const hasEligibleShore = component.some((tile) => cardinalTiles(tile).some((neighbor) => {
      if (neighbor.column <= 0 || neighbor.column >= recipe.grid.columns - 1 ||
          neighbor.row <= 0 || neighbor.row >= recipe.grid.rows - 1 ||
          componentKeys.has(tileKey(neighbor))) return false;
      return recipe.grid.collision[neighbor.row * recipe.grid.columns + neighbor.column] === 0;
    }));
    if (!hasEligibleShore) {
      throw new Error("recipe water mask component must retain an eligible cardinal shoreline neighbor");
    }
  }

  const pathCount = countMask(recipe.pathMask);
  if (pathCount < MIN_PATH_TILES || pathCount > MAX_PATH_TILES) {
    throw new Error(`recipe path mask must contain ${MIN_PATH_TILES}-${MAX_PATH_TILES} authored cells`);
  }
  let hasOrganicCell = false;
  for (const [index, value] of recipe.pathMask.entries()) {
    if (value !== 1) continue;
    if (recipe.grid.collision[index] !== 0) {
      throw new Error("recipe path mask must remain collision-open");
    }
    const column = index % recipe.grid.columns;
    const row = Math.floor(index / recipe.grid.columns);
    if (row % 4 !== 0 && column % 4 !== 0) hasOrganicCell = true;
  }
  if (!hasOrganicCell) throw new Error("recipe path mask must not be a straight periodic grid");
  for (const value of [...gates.map((gate) => gate.tile), ...socialAnchors]) {
    const tile = requireTile(value, recipe.grid, "path anchor");
    if (recipe.pathMask[tile.row * recipe.grid.columns + tile.column] !== 1) {
      throw new Error("recipe path mask must include every gate and district social anchor");
    }
  }
  if (connectedMaskSize(recipe.pathMask, recipe.grid.columns, recipe.grid.rows) !== pathCount) {
    throw new Error("recipe path mask must remain four-way connected");
  }

  for (let index = 0; index < recipe.soilMask.length; index += 1) {
    if (recipe.soilMask[index] === 1 && recipe.pathMask[index] === 1) {
      throw new Error("recipe category overlap between soil and path");
    }
  }

  const soilCount = countMask(recipe.soilMask);
  if (soilCount !== DISTRICT_ORIGINS.length * SOIL_TILES_PER_DISTRICT) {
    throw new Error("recipe soil mask must keep the exact non-vacuous district budget");
  }
  for (const [index, value] of recipe.soilMask.entries()) {
    if (value === 1 && recipe.grid.collision[index] !== 0) {
      throw new Error("recipe soil mask must remain collision-open");
    }
  }
  for (const [districtIndex, origin] of DISTRICT_ORIGINS.entries()) {
    const localSoil = maskTiles(recipe.soilMask, recipe.grid.columns).filter((tile) => inDistrict(tile, origin));
    if (localSoil.length !== SOIL_TILES_PER_DISTRICT) {
      throw new Error(`recipe soil mask must keep district ${districtIndex} bounded and non-vacuous`);
    }
    const district = recipe.districts[districtIndex];
    const authoredSpaces = [
      ...district.socialAnchors,
      ...district.shelterPlots.flatMap((plot) => [plot.tile, plot.door]),
      recipe.resourceAnchors.energy[districtIndex],
      recipe.resourceAnchors.materials[districtIndex],
    ];
    if (localSoil.some((tile) => !authoredSpaces.some((anchor) => manhattan(tile, anchor) <= 7))) {
      throw new Error(`recipe soil mask must stay near district ${districtIndex} authored interaction spaces`);
    }
    const soilComponents = connectedTileComponents(localSoil);
    if (soilComponents.length !== SOIL_PATCHES_PER_DISTRICT ||
        soilComponents.some((component) => component.length !== SOIL_TILES_PER_PATCH)) {
      throw new Error(`recipe soil mask must keep district ${districtIndex} as three connected five-cell components`);
    }
    if (soilComponents.some((component) => !isIrregularTileComponent(component))) {
      throw new Error(`recipe soil mask must keep district ${districtIndex} components irregular and non-rectangular`);
    }
  }
}

function validateCompositionDensity(
  recipe: RegionMapRecipeV1,
  staticScenery: readonly unknown[],
  scenicClusters: readonly unknown[],
  storyNeighborhoods: readonly unknown[],
  terrainPatches: readonly unknown[],
  visualPathCompositions: readonly unknown[],
  occupiedHomeObligations: readonly unknown[],
  storyDistricts: readonly unknown[],
  animatedEnvironment: readonly unknown[],
): void {
  if (staticScenery.length !== DISTRICT_ORIGINS.length * STATIC_SCENERY_PER_DISTRICT) {
    throw new Error("recipe static scenery composition must keep the exact district budget");
  }
  if (animatedEnvironment.length !== exactAnimatedEnvironmentBudget(recipe)) {
    throw new Error("recipe animated environment composition must keep the exact district budget");
  }
  const kit = getBiomeKit(recipe.kit);
  const clusterRoles = new Set([
    kit.sceneGrammar.signatureRole,
    ...(kit.sceneGrammar.detachedSignatureRole === undefined
      ? [] : [kit.sceneGrammar.detachedSignatureRole]),
    ...kit.sceneGrammar.supportRoles,
  ]);
  const expectedClusterCount = DISTRICT_ORIGINS.reduce((count, _, districtIndex) =>
    count + scenicRolesForDistrict(kit, districtIndex).length, 0);
  if (scenicClusters.length !== expectedClusterCount) {
    throw new Error(`recipe connected scenic composition must contain exactly ${expectedClusterCount} clusters`);
  }
  const staticRecords = staticScenery.map((value) => requireRecord(value, "static scenery"));
  const clusterIds = new Set<string>();
  const parsedClusters: ScenicCluster[] = [];
  for (const value of scenicClusters) {
    const cluster = requireRecord(value, "recipe.scenicClusters entry");
    const id = requireNonEmptyString(cluster.id, "recipe.scenicClusters id");
    rejectDuplicate(clusterIds, id, "duplicate scenic cluster ID");
    if (!Number.isSafeInteger(cluster.districtIndex)
        || (cluster.districtIndex as number) < 0
        || (cluster.districtIndex as number) >= DISTRICT_ORIGINS.length) {
      throw new Error("recipe.scenicClusters districtIndex must name a canonical district");
    }
    if (typeof cluster.role !== "string" || !clusterRoles.has(cluster.role as ScenicGrammarRole)) {
      throw new Error("recipe scenic cluster role must belong to its biome grammar");
    }
    if (typeof cluster.signature !== "boolean") {
      throw new Error("recipe scenic cluster signature must be boolean");
    }
    const anchor = requireTile(cluster.anchor, recipe.grid, "recipe.scenicClusters anchor");
    const memberIds = requireArray(cluster.memberIds, "recipe.scenicClusters memberIds")
      .map((member) => requireNonEmptyString(member, "recipe.scenicClusters member ID"));
    if (memberIds.length < 3 || new Set(memberIds).size !== memberIds.length) {
      throw new Error("recipe connected scenic cluster must contain at least three unique members");
    }
    const plannedLandmark = requirePlannedLandmark(
      cluster.plannedLandmark,
      cluster.role as ScenicGrammarRole,
      kit,
    );
    const members = staticRecords.filter((placement) => placement.clusterId === id);
    const actualIds = members.map((placement) =>
      requireNonEmptyString(placement.id, "cluster member ID"));
    if (!sameSerialized(actualIds, memberIds)) {
      throw new Error("recipe canonical static scenery cluster member IDs must preserve exact order");
    }
    if (members.some((placement) => placement.role !== cluster.role)) {
      throw new Error("recipe scenic cluster members must share the cluster role");
    }
    const memberTiles = members.map((placement) =>
      requireTile(placement.tile, recipe.grid, "cluster member tile"));
    if (connectedTileComponents(memberTiles).length !== 1) {
      throw new Error("recipe connected scenic cluster members must remain cardinally adjacent");
    }
    if (!memberTiles.some((tile) => sameTile(tile, anchor))) {
      throw new Error("recipe scenic cluster anchor must belong to its member footprint");
    }
    parsedClusters.push({
      id,
      districtIndex: cluster.districtIndex as number,
      role: cluster.role as ScenicGrammarRole,
      signature: cluster.signature,
      anchor,
      memberIds,
      plannedLandmark,
    });
  }
  const clusteredPlacements = staticRecords.filter((placement) => placement.clusterId !== null);
  if (clusteredPlacements.length / staticRecords.length < 0.7) {
    throw new Error("recipe must keep at least seventy percent of static scenery in a connected scenic composition");
  }
  if (clusteredPlacements.some((placement) =>
    typeof placement.clusterId !== "string" || !clusterIds.has(placement.clusterId))) {
    throw new Error("recipe clustered static scenery must reference a declared scenic cluster");
  }
  validateStoryCompositionRecords(
    recipe,
    kit,
    storyNeighborhoods,
    terrainPatches,
    visualPathCompositions,
    occupiedHomeObligations,
    storyDistricts,
  );
  for (const [districtIndex, origin] of DISTRICT_ORIGINS.entries()) {
    const localStatic = staticScenery.filter((value) => inLandscapeSector(
      requireTile(requireRecord(value, "static scenery").tile, recipe.grid, "static scenery tile"),
      origin,
    ));
    const localAnimated = animatedEnvironment.filter((value) => inLandscapeSector(
      requireTile(requireRecord(value, "animated environment").tile, recipe.grid, "animated environment tile"),
      origin,
    ));
    if (localStatic.length !== STATIC_SCENERY_PER_DISTRICT) {
      throw new Error(`recipe static scenery composition must keep district ${districtIndex} dense`);
    }
    if (!placesAnimatedEnvironmentFromTerrain(recipe)
      && localAnimated.length !== ANIMATED_ENVIRONMENT_PER_DISTRICT) {
      throw new Error(`recipe animated environment composition must keep district ${districtIndex} bounded`);
    }
    const localClusters = parsedClusters.filter((cluster) => cluster.districtIndex === districtIndex);
    const localRoles = scenicRolesForDistrict(kit, districtIndex);
    if (localClusters.length !== localRoles.length
        || localClusters.filter((cluster) => cluster.signature).length !== 1
        || !sameSerialized(localClusters.map((cluster) => cluster.role), localRoles)) {
      throw new Error(`recipe district ${districtIndex} must preserve its full biome cluster grammar`);
    }
  }
  if (recipe.kit === "spring-terraces") {
    const waterTiles = maskTiles(recipe.waterVoidMask, recipe.grid.columns);
    const connectedSpringClusters = parsedClusters.filter((cluster) =>
      cluster.role === "connected-spring-terrace");
    if (connectedSpringClusters.length !== 1) {
      throw new Error("recipe must name exactly one water-connected spring terrace");
    }
    for (const cluster of connectedSpringClusters) {
      const memberTiles = staticRecords
        .filter((placement) => placement.clusterId === cluster.id)
        .map((placement) => requireTile(placement.tile, recipe.grid, "spring signature member"));
      if (!memberTiles.some((member) => waterTiles.some((water) => manhattan(member, water) === 1))) {
        throw new Error("every connected spring terrace must remain cardinally joined to real water");
      }
    }
  }

  const authoredFrontier = [
    ...staticRecords.filter((placement) => placement.clusterId !== null)
      .map((placement) => requireTile(placement.tile, recipe.grid, "cluster frontier tile")),
    ...maskTiles(recipe.pathMask, recipe.grid.columns),
    ...recipe.socialAnchors,
    ...recipe.resourceAnchors.energy,
    ...recipe.resourceAnchors.materials,
    ...recipe.shelterPlots.flatMap((plot) => [plot.tile, plot.door]),
  ];
  for (const satellite of staticRecords.filter((placement) => placement.clusterId === null)) {
    const tile = requireTile(satellite.tile, recipe.grid, "satellite tile");
    if (Math.min(...authoredFrontier.map((frontier) => manhattan(tile, frontier))) > 3) {
      throw new Error("recipe satellite accent must remain within three tiles of an authored frontier");
    }
  }
}

function requirePlannedLandmark(
  value: unknown,
  role: ScenicGrammarRole,
  kit: BiomeKit,
): PlannedLandmarkPlan {
  const record = requireRecord(value, "recipe.scenicClusters planned landmark");
  if (record.recordType !== "planned-landmark" || record.runtimeAtlasLookup !== false) {
    throw new Error("recipe planned landmark must be a non-loadable discriminated planning record");
  }
  const plannedId = requireNonEmptyString(
    record.plannedId,
    "recipe.scenicClusters planned landmark ID",
  );
  if (!plannedId.startsWith("planned:") || record.semanticRole !== role) {
    throw new Error("recipe planned landmark must be role-bound planned vocabulary");
  }
  const expected = plannedLandmarkForRole(kit, role);
  if (!sameSerialized(Object.keys(record).sort(), [
    "plannedId",
    "recordType",
    "runtimeAtlasLookup",
    "semanticRole",
  ]) || record.recordType !== expected.recordType
      || record.plannedId !== expected.plannedId
      || record.semanticRole !== expected.semanticRole
      || record.runtimeAtlasLookup !== expected.runtimeAtlasLookup) {
    throw new Error("recipe planned landmark must match its exact biome semantic role mapping");
  }
  return expected;
}

function validateStoryCompositionRecords(
  recipe: RegionMapRecipeV1,
  kit: BiomeKit,
  storyNeighborhoods: readonly unknown[],
  terrainPatches: readonly unknown[],
  visualPathCompositions: readonly unknown[],
  occupiedHomeObligations: readonly unknown[],
  storyDistricts: readonly unknown[],
): void {
  const expectedStoryCount = recipe.gates.length + DISTRICT_ORIGINS.length * 3;
  if (storyNeighborhoods.length !== expectedStoryCount) {
    throw new Error("recipe must provide every authoritative gate and district social/resource story obligation");
  }
  const storyIds = new Set<string>();
  const parsedStories: StoryNeighborhood[] = [];
  const gateStoryIds: string[] = [];
  const coveredGateKeys = new Set<string>();
  const anchorKinds = new Set(["authoritative-gate", "social", "energy", "materials"]);
  for (const value of storyNeighborhoods) {
    const story = requireRecord(value, "recipe.storyNeighborhoods entry");
    const id = requireNonEmptyString(story.id, "recipe.storyNeighborhoods id");
    rejectDuplicate(storyIds, id, "duplicate story neighborhood ID");
    if (!Number.isSafeInteger(story.districtIndex)
        || (story.districtIndex as number) < 0
        || (story.districtIndex as number) >= DISTRICT_ORIGINS.length) {
      throw new Error("recipe story neighborhood district must be canonical");
    }
    if (typeof story.anchorKind !== "string" || !anchorKinds.has(story.anchorKind)) {
      throw new Error("recipe story neighborhood anchor kind must be statically authored");
    }
    const anchor = requireTile(story.anchor, recipe.grid, "recipe.storyNeighborhoods anchor");
    const pathContextRecord = requireRecord(
      story.pathContext,
      "recipe.storyNeighborhoods path context",
    );
    let pathContext: StoryPathContext;
    if (pathContextRecord.mode === "local-authoritative-path") {
      if (!sameSerialized(Object.keys(pathContextRecord).sort(), [
        "contextAnchor", "mode", "navigationDistance", "visualPathCompositionId",
      ])) {
        throw new Error("recipe local story path context must use its exact discriminated fields");
      }
      const contextAnchor = requireTile(
        pathContextRecord.contextAnchor,
        recipe.grid,
        "recipe.storyNeighborhoods local path context anchor",
      );
      if (recipe.pathMask[indexOf(contextAnchor)] !== 1) {
        throw new Error("recipe local story path context must anchor to authoritative pathMask");
      }
      pathContext = {
        mode: "local-authoritative-path",
        contextAnchor,
        visualPathCompositionId: requireNonEmptyString(
          pathContextRecord.visualPathCompositionId,
          "recipe.storyNeighborhoods local visual path ID",
        ),
        navigationDistance: requireNonNegativeInteger(
          pathContextRecord.navigationDistance,
          "recipe.storyNeighborhoods local navigation distance",
        ),
      };
    } else if (pathContextRecord.mode === "detached-no-crop-local-path") {
      if (!sameSerialized(Object.keys(pathContextRecord).sort(), [
        "constraint", "mode", "navigationDistance", "nearestAuthoritativeContext", "reason",
        "visualPathCompositionId",
      ]) || pathContextRecord.reason !== "no-admissible-crop-local-authoritative-path-composition"
          || (pathContextRecord.constraint !== "no-legal-visual-clearing"
            && pathContextRecord.constraint !== "no-legal-visual-shoulder"
            && pathContextRecord.constraint !== "native-mobile-crop-overflow")
          || pathContextRecord.visualPathCompositionId !== null) {
        throw new Error("recipe detached story path context must use its exact fail-closed discriminant");
      }
      const nearestAuthoritativeContext = requireTile(
        pathContextRecord.nearestAuthoritativeContext,
        recipe.grid,
        "recipe.storyNeighborhoods nearest authoritative path context",
      );
      if (recipe.pathMask[indexOf(nearestAuthoritativeContext)] !== 1) {
        throw new Error("recipe detached story diagnostic context must anchor to authoritative pathMask");
      }
      pathContext = {
        mode: "detached-no-crop-local-path",
        reason: "no-admissible-crop-local-authoritative-path-composition",
        constraint: pathContextRecord.constraint,
        nearestAuthoritativeContext,
        navigationDistance: requireNonNegativeInteger(
          pathContextRecord.navigationDistance,
          "recipe.storyNeighborhoods detached navigation distance",
        ),
        visualPathCompositionId: null,
      };
    } else {
      throw new Error("recipe story neighborhood path context must discriminate local or detached truth");
    }
    let authoritativeGate: RegionGate | null = null;
    if (story.anchorKind === "authoritative-gate") {
      const gateRecord = requireRecord(
        story.authoritativeGate,
        "recipe.storyNeighborhoods authoritative gate",
      );
      const edge = requireRecord(gateRecord.edge, "recipe.storyNeighborhoods gate edge");
      const gate: RegionGate = {
        edge: {
          from: requireNonEmptyString(edge.from, "recipe.storyNeighborhoods gate from"),
          to: requireNonEmptyString(edge.to, "recipe.storyNeighborhoods gate to"),
        },
        role: gateRecord.role === "arrival" ? "arrival"
          : gateRecord.role === "departure" ? "departure"
            : (() => { throw new Error("recipe story neighborhood gate role must be authoritative"); })(),
        facing: gateRecord.facing === "north" || gateRecord.facing === "east"
          || gateRecord.facing === "south" || gateRecord.facing === "west"
          ? gateRecord.facing
          : (() => { throw new Error("recipe story neighborhood gate facing must be cardinal"); })(),
        tile: requireTile(gateRecord.tile, recipe.grid, "recipe.storyNeighborhoods gate tile"),
      };
      if (!sameTile(anchor, gate.tile) || !recipe.gates.some((candidate) => sameGate(candidate, gate))) {
        throw new Error("recipe gate story must reference one exact authoritative directed gate");
      }
      const key = gateKey(gate);
      rejectDuplicate(coveredGateKeys, key, "duplicate authoritative gate story");
      gateStoryIds.push(id);
      authoritativeGate = gate;
    } else if (story.authoritativeGate !== null) {
      throw new Error("recipe non-gate story must not invent an authoritative gate");
    }
    if (story.minimumNativeZoom !== 1) {
      throw new Error("recipe story neighborhood must preserve native zoom one or greater");
    }
    parsedStories.push({
      id,
      districtIndex: story.districtIndex as number,
      anchorKind: story.anchorKind as StoryNeighborhood["anchorKind"],
      anchor,
      authoritativeGate,
      terrainPatchId: requireNonEmptyString(
        story.terrainPatchId,
        "recipe.storyNeighborhoods terrain patch ID",
      ),
      pathContext,
      minimumNativeZoom: 1,
    });
  }
  if (coveredGateKeys.size !== recipe.gates.length
      || recipe.gates.some((gate) => !coveredGateKeys.has(gateKey(gate)))) {
    throw new Error("recipe must provide exactly one static story obligation for every authoritative gate");
  }

  const topology = requireRecord(recipe.gateStoryTopology, "recipe.gateStoryTopology");
  if (recipe.gates.length === 0) {
    if (topology.mode !== "isolated" || topology.reason !== "no-authoritative-directed-gates"
        || gateStoryIds.length !== 0) {
      throw new Error("recipe isolated gate story topology must fail closed with its explicit reason");
    }
  } else {
    if (topology.mode !== "directed-gates" || topology.reason !== undefined
        || !sameSerialized(
          requireArray(topology.authoritativeGateStoryIds, "recipe authoritative gate story IDs"),
          gateStoryIds,
        )) {
      throw new Error("recipe directed gate story topology must enumerate every gate story in order");
    }
  }

  if (terrainPatches.length !== parsedStories.length) {
    throw new Error("recipe terrain patches must cover every static story exactly once");
  }
  const patchIds = new Set<string>();
  const parsedPatches = new Map<string, TerrainPatch>();
  for (const value of terrainPatches) {
    const patch = requireRecord(value, "recipe.terrainPatches entry");
    if (patch.recordType !== "terrain-patch" || patch.collisionBehavior !== "visual-only"
        || patch.affectsMechanics !== false) {
      throw new Error("recipe terrain patch must be explicitly non-mechanical visual data");
    }
    const id = requireNonEmptyString(patch.id, "recipe.terrainPatches id");
    rejectDuplicate(patchIds, id, "duplicate terrain patch ID");
    if (!Number.isSafeInteger(patch.districtIndex)
        || (patch.districtIndex as number) < 0
        || (patch.districtIndex as number) >= DISTRICT_ORIGINS.length) {
      throw new Error("recipe terrain patch district must be canonical");
    }
    if (typeof patch.role !== "string"
        || !kit.sceneGrammar.terrainPatchRoles.includes(patch.role as TerrainPatchRole)) {
      throw new Error("recipe terrain patch role must belong to its biome grammar");
    }
    const cells = requireArray(patch.cells, "recipe.terrainPatches cells")
      .map((cell) => requireTile(cell, recipe.grid, "recipe.terrainPatches cell"));
    if (cells.length < 9 || new Set(cells.map(tileKey)).size !== cells.length
        || connectedTileComponents(cells).length !== 1) {
      throw new Error("recipe terrain patch must be broad, unique, and cardinally connected");
    }
    const footprint = requireTileFootprint(
      patch.footprint,
      recipe.grid,
      "recipe.terrainPatches footprint",
    );
    if (!sameSerialized([footprint], [tileFootprint(cells)])) {
      throw new Error("recipe terrain patch footprint must exactly bound its authored cells");
    }
    const storyOwnerIds = requireArray(patch.storyOwnerIds, "recipe.terrainPatches story owners")
      .map((owner) => requireNonEmptyString(owner, "recipe.terrainPatches story owner"));
    if (storyOwnerIds.length === 0 || new Set(storyOwnerIds).size !== storyOwnerIds.length
        || storyOwnerIds.some((owner) => !storyIds.has(owner))) {
      throw new Error("recipe terrain patch must have valid unique story ownership");
    }
    parsedPatches.set(id, {
      recordType: "terrain-patch",
      id,
      districtIndex: patch.districtIndex as number,
      role: patch.role as TerrainPatchRole,
      cells,
      footprint,
      storyOwnerIds,
      collisionBehavior: "visual-only",
      affectsMechanics: false,
    });
  }

  if (visualPathCompositions.length === 0) {
    throw new Error("recipe must provide at least one truthful local visual path composition");
  }
  const visualPathIds = new Set<string>();
  const visualPathOwners = new Map<string, Readonly<{
    districtIndex: number;
    owners: readonly string[];
    path: VisualPathComposition;
  }>>();
  for (const value of visualPathCompositions) {
    const path = requireRecord(value, "recipe.visualPathCompositions entry");
    const districtIndex = requireNonNegativeInteger(
      path.districtIndex,
      "recipe visual path district index",
    );
    if (path.recordType !== "visual-path-composition" || path.collisionBehavior !== "visual-only"
        || path.affectsMechanics !== false || districtIndex >= DISTRICT_ORIGINS.length
        || path.role !== kit.sceneGrammar.visualPathRole) {
      throw new Error("recipe visual path composition must preserve canonical non-mechanical story grammar");
    }
    const id = requireNonEmptyString(path.id, "recipe.visualPathCompositions id");
    rejectDuplicate(visualPathIds, id, "duplicate visual path composition ID");
    const centerline = requireArray(path.centerlineCells, "recipe visual path centerline")
      .map((cell) => requireTile(cell, recipe.grid, "recipe visual path centerline cell"));
    const shoulders = requireArray(path.shoulderCells, "recipe visual path shoulders")
      .map((cell) => requireTile(cell, recipe.grid, "recipe visual path shoulder cell"));
    const clearings = requireArray(path.clearingCells, "recipe visual path clearings")
      .map((cell) => requireTile(cell, recipe.grid, "recipe visual path clearing cell"));
    if (centerline.length === 0 || shoulders.length === 0 || clearings.length === 0
        || centerline.some((cell) => recipe.pathMask[indexOf(cell)] !== 1)) {
      throw new Error("recipe visual path must carry real centerline, shoulder, and clearing hierarchy");
    }
    if (new Set(centerline.map(tileKey)).size !== centerline.length
        || connectedTileComponents(centerline).length !== 1) {
      throw new Error("recipe visual path centerline must be unique and cardinally connected");
    }
    if (new Set(shoulders.map(tileKey)).size !== shoulders.length
        || shoulders.some((shoulder) => !centerline.some((cell) => manhattan(cell, shoulder) === 1))) {
      throw new Error("recipe visual path shoulders must be unique cardinal neighbors of real centerline");
    }
    if (new Set(clearings.map(tileKey)).size !== clearings.length
        || clearings.some((clearing) => !centerline.some((cell) => manhattan(cell, clearing) <= 1))) {
      throw new Error("recipe visual path clearings must remain local to real centerline context");
    }
    const allCells = uniqueTiles([...centerline, ...shoulders, ...clearings]);
    if (connectedTileComponents(allCells).length !== 1) {
      throw new Error("recipe visual path full hierarchy must be cardinally connected");
    }
    const footprint = requireTileFootprint(path.footprint, recipe.grid, "recipe visual path footprint");
    if (!sameSerialized([footprint], [tileFootprint(allCells)])) {
      throw new Error("recipe visual path footprint must exactly bound its authored hierarchy");
    }
    if (footprint.widthTiles > 7 || footprint.heightTiles > 7) {
      throw new Error("recipe visual path footprint must remain a bounded local composition");
    }
    const owners = requireArray(path.storyOwnerIds, "recipe visual path story owners")
      .map((owner) => requireNonEmptyString(owner, "recipe visual path story owner"));
    if (owners.length !== 1 || new Set(owners).size !== owners.length
        || owners.some((owner) => !storyIds.has(owner))) {
      throw new Error("recipe visual path must have one valid reciprocal story owner");
    }
    const owner = parsedStories.find((story) => story.id === owners[0]);
    if (owner === undefined || owner.districtIndex !== districtIndex) {
      throw new Error("recipe visual path owner must belong to its authored district");
    }
    if (shoulders.some((cell) => !visualContextCellIsOpen(
      cell,
      owner,
      recipe.grid,
      recipe.waterVoidMask,
      recipe.soilMask,
      recipe.staticScenery,
      recipe.shelterPlots,
      parsedStories,
    ))) {
      throw new Error("recipe visual path shoulder must avoid water, collision, soil, scenery, shelters, and foreign story envelopes");
    }
    if (centerline.some((cell) => !visualContextCellIsOpen(
      cell,
      owner,
      recipe.grid,
      recipe.waterVoidMask,
      recipe.soilMask,
      recipe.staticScenery,
      recipe.shelterPlots,
      parsedStories,
    ))) {
      throw new Error("recipe visual path centerline must remain a presentation-legal authoritative path context");
    }
    if (clearings.some((cell) => !visualContextCellIsOpen(
      cell,
      owner,
      recipe.grid,
      recipe.waterVoidMask,
      recipe.soilMask,
      recipe.staticScenery,
      recipe.shelterPlots,
      parsedStories,
    ))) {
      throw new Error("recipe visual path clearing must avoid water, collision, soil, scenery, shelters, and foreign story envelopes");
    }
    const parsedPath: VisualPathComposition = {
      recordType: "visual-path-composition",
      id,
      districtIndex,
      role: path.role as VisualPathRole,
      centerlineCells: centerline,
      shoulderCells: shoulders,
      clearingCells: clearings,
      footprint,
      storyOwnerIds: owners,
      collisionBehavior: "visual-only",
      affectsMechanics: false,
    };
    visualPathOwners.set(id, { districtIndex, owners, path: parsedPath });
  }

  if (occupiedHomeObligations.length !== DISTRICT_ORIGINS.length) {
    throw new Error("recipe must provide one dynamic occupied-home obligation per district");
  }
  const homeIds = new Set<string>();
  for (const [index, value] of occupiedHomeObligations.entries()) {
    const home = requireRecord(value, "recipe.occupiedHomeObligations entry");
    const id = requireNonEmptyString(home.id, "recipe.occupiedHomeObligations id");
    rejectDuplicate(homeIds, id, "duplicate occupied-home obligation ID");
    if (home.recordType !== "dynamic-occupied-home" || home.activation !== "occupied-home-only"
        || home.collisionBehavior !== "visual-only" || home.affectsMechanics !== false
        || home.requiredContextAccents !== 2 || home.districtIndex !== index
        || home.contextRole !== kit.sceneGrammar.occupiedHomeContextRole) {
      throw new Error("recipe occupied-home obligation must preserve exact dynamic visual-only grammar");
    }
    const bindings = requireArray(
      home.approachBindings,
      "recipe occupied-home approach bindings",
    );
    const plots = recipe.districts[index]!.shelterPlots;
    if (bindings.length !== plots.length) {
      throw new Error("recipe occupied-home obligation must bind every exact district shelter plot");
    }
    for (const [plotIndex, value] of bindings.entries()) {
      const binding = requireRecord(value, "recipe occupied-home approach binding");
      const plot = plots[plotIndex]!;
      if (!sameSerialized(Object.keys(binding).sort(), [
        "activation", "affectsMechanics", "apronCells", "collisionBehavior", "doorAnchor",
        "navigationDistance", "nearestAuthoritativeContext", "recordType", "shelterPlotId",
      ]) || binding.recordType !== "occupied-home-approach-binding"
          || binding.shelterPlotId !== plot.id || binding.activation !== "when-plot-occupied"
          || binding.collisionBehavior !== "visual-only" || binding.affectsMechanics !== false) {
        throw new Error("recipe occupied-home approach must preserve exact plot-bound visual-only grammar");
      }
      const doorAnchor = requireTile(binding.doorAnchor, recipe.grid, "recipe occupied-home door anchor");
      if (!sameTile(doorAnchor, plot.door)) {
        throw new Error("recipe occupied-home approach must bind its exact shelter door");
      }
      const apronCells = requireArray(binding.apronCells, "recipe occupied-home apron cells")
        .map((cell) => requireTile(cell, recipe.grid, "recipe occupied-home apron cell"));
      if (apronCells.length === 0 || !apronCells.some((cell) => sameTile(cell, plot.door))
          || new Set(apronCells.map(tileKey)).size !== apronCells.length
          || connectedTileComponents(apronCells).length !== 1
          || apronCells.some((cell) => manhattan(cell, plot.door) > 1
            || recipe.grid.collision[indexOf(cell)] !== 0
            || recipe.waterVoidMask[indexOf(cell)] !== 0)) {
        throw new Error("recipe occupied-home apron must be a bounded collision-open local door approach");
      }
      const nearestContext = requireTile(
        binding.nearestAuthoritativeContext,
        recipe.grid,
        "recipe occupied-home nearest authoritative context",
      );
      const navigationDistance = requireNonNegativeInteger(
        binding.navigationDistance,
        "recipe occupied-home navigation distance",
      );
      const expected = createOccupiedHomeApproachBinding(
        plot,
        recipe.districts[index]!,
        recipe.grid,
        recipe.pathMask,
        recipe.waterVoidMask,
        recipe.staticScenery,
        recipe.shelterPlots,
      );
      if (!sameTile(nearestContext, expected.nearestAuthoritativeContext)
          || navigationDistance !== expected.navigationDistance
          || !sameSerialized(apronCells, expected.apronCells)) {
        throw new Error("recipe occupied-home approach must preserve its exact local apron and navigation diagnostic");
      }
    }
  }

  if (storyDistricts.length !== DISTRICT_ORIGINS.length) {
    throw new Error("recipe must provide one complete story contract per district");
  }
  for (const [index, value] of storyDistricts.entries()) {
    const district = requireRecord(value, "recipe.storyDistricts entry");
    if (district.districtIndex !== index) {
      throw new Error("recipe story district contracts must remain in canonical order");
    }
    const staticIds = requireRecord(district.staticStoryIds, "recipe story district static IDs");
    const expectedKeys = recipe.gates.length === 0
      ? ["energy", "materials", "social"]
      : ["energy", "materials", "primaryGate", "social"];
    if (!sameSerialized(Object.keys(staticIds).sort(), expectedKeys)) {
      throw new Error("recipe story district must enumerate gate/social/energy/materials obligations exactly");
    }
    for (const key of expectedKeys) {
      const storyId = requireNonEmptyString(staticIds[key], `recipe story district ${key} ID`);
      const story = parsedStories.find((candidate) => candidate.id === storyId);
      if (story === undefined || (key !== "primaryGate" && story.districtIndex !== index)
          || (key === "primaryGate" && story.anchorKind !== "authoritative-gate")
          || (key !== "primaryGate" && story.anchorKind !== key)) {
        throw new Error("recipe story district static obligation must reference the exact authored story kind");
      }
    }
    if (!homeIds.has(requireNonEmptyString(
      district.dynamicOccupiedHomeObligationId,
      "recipe story district occupied-home obligation ID",
    ))) {
      throw new Error("recipe story district must reference its dynamic occupied-home obligation");
    }
  }

  const safeWidth = MOBILE_STORY_SAFE_FRAME.viewportWidth
    - MOBILE_STORY_SAFE_FRAME.chromeLeft - MOBILE_STORY_SAFE_FRAME.chromeRight;
  const safeHeight = MOBILE_STORY_SAFE_FRAME.viewportHeight
    - MOBILE_STORY_SAFE_FRAME.chromeTop - MOBILE_STORY_SAFE_FRAME.chromeBottom;
  for (const story of parsedStories) {
    const patch = parsedPatches.get(story.terrainPatchId);
    if (patch === undefined || patch.districtIndex !== story.districtIndex
        || !patch.storyOwnerIds.includes(story.id)) {
      throw new Error("recipe story neighborhood must own one exact district terrain patch");
    }
    const district = recipe.districts[story.districtIndex]!;
    const nearest = nearestAuthoritativePathContext(
      story.anchor,
      district.socialAnchors[0]!,
      recipe.grid,
      recipe.pathMask,
    );
    const candidate = createLocalVisualPathComposition(
      story,
      nearest.tile,
      recipe.grid,
      recipe.pathMask,
      recipe.waterVoidMask,
      recipe.soilMask,
      recipe.staticScenery,
      recipe.shelterPlots,
      parsedStories,
      kit.sceneGrammar.visualPathRole,
    );
    const localFits = candidate.clearingCells.length > 0 && candidate.shoulderCells.length > 0
      && fitsNativeMobileStoryFrame(story.anchor, patch.footprint, candidate.footprint);
    if (story.pathContext.mode === "local-authoritative-path") {
      if (!localFits) {
        throw new Error("recipe story path context is falsely local for its native mobile crop");
      }
      const visualPath = visualPathOwners.get(story.pathContext.visualPathCompositionId);
      if (visualPath === undefined || visualPath.districtIndex !== story.districtIndex
          || !sameSerialized(visualPath.owners, [story.id])
          || !sameTile(story.pathContext.contextAnchor, nearest.tile)
          || story.pathContext.navigationDistance !== nearest.distance
          || !sameSerialized([visualPath.path], [candidate])) {
        throw new Error("recipe local story path context must preserve exact reciprocal authoritative composition");
      }
    } else {
      if (localFits) {
        throw new Error("recipe story path context is falsely detached despite a valid native mobile crop");
      }
      if (!sameTile(story.pathContext.nearestAuthoritativeContext, nearest.tile)
          || story.pathContext.navigationDistance !== nearest.distance
          || story.pathContext.constraint !== (candidate.clearingCells.length === 0
            ? "no-legal-visual-clearing"
            : candidate.shoulderCells.length === 0
              ? "no-legal-visual-shoulder"
              : "native-mobile-crop-overflow")) {
        throw new Error("recipe detached story path context must preserve exact nearest navigation diagnostic");
      }
      const actor = feetAnchoredVisualRect(tileCenter(story.anchor));
      const patchRect = tileFootprintPixelRect(patch.footprint);
      const left = Math.min(actor.x, patchRect.x);
      const top = Math.min(actor.y, patchRect.y);
      const right = Math.max(actor.x + actor.width, patchRect.x + patchRect.width);
      const bottom = Math.max(actor.y + actor.height, patchRect.y + patchRect.height);
      if (right - left + MOBILE_STORY_SAFE_FRAME.padding * 2 > safeWidth
          || bottom - top + MOBILE_STORY_SAFE_FRAME.padding * 2 > safeHeight) {
        throw new Error("recipe detached story actor and signature pixels must fit the native mobile safe frame");
      }
    }
  }
  for (const path of visualPathOwners.values()) {
    const owner = parsedStories.find((story) => story.id === path.owners[0]);
    if (owner?.pathContext.mode !== "local-authoritative-path"
        || owner.pathContext.visualPathCompositionId !== path.path.id) {
      throw new Error("recipe visual path composition must have exact reciprocal local story ownership");
    }
  }
}

function requireTileFootprint(
  value: unknown,
  grid: NavigationGrid,
  label: string,
): TerrainPatch["footprint"] {
  const record = requireRecord(value, label);
  const origin = requireTile(record.origin, grid, `${label} origin`);
  const widthTiles = requirePositiveInteger(record.widthTiles, `${label} widthTiles`);
  const heightTiles = requirePositiveInteger(record.heightTiles, `${label} heightTiles`);
  if (origin.column + widthTiles > grid.columns || origin.row + heightTiles > grid.rows) {
    throw new Error(`${label} must remain inside the map`);
  }
  return { origin, widthTiles, heightTiles };
}

function toSerialized(recipe: RegionMapRecipeV1): SerializedRecipe {
  const canonical = canonicalRecipe(recipe);
  return {
    version: 1,
    regionId: canonical.regionId,
    identityHash: canonical.identityHash,
    kit: canonical.kit,
    ...(canonical.presentationProfile === undefined
      ? {}
      : { presentationProfile: canonical.presentationProfile }),
    grid: {
      columns: canonical.grid.columns,
      rows: canonical.grid.rows,
      collision: [...canonical.grid.collision],
      // Walk topology is part of a recipe's identity: the same collision bytes with a
      // wrapping rim are a different world to walk in. Omitted (not written as
      // "bounded") when absent, so every pre-topology recipe serializes byte-identically.
      ...(canonical.grid.topology === undefined ? {} : { topology: canonical.grid.topology }),
    },
    edgeMask: [...canonical.edgeMask],
    waterVoidMask: [...canonical.waterVoidMask],
    pathMask: [...canonical.pathMask],
    soilMask: [...canonical.soilMask],
    gates: canonical.gates,
    arrivalAnchors: canonical.arrivalAnchors,
    spawnAnchors: canonical.spawnAnchors,
    socialAnchors: canonical.socialAnchors,
    resourceAnchors: canonical.resourceAnchors,
    stagingAnchors: canonical.stagingAnchors,
    stagingPoints: canonical.stagingPoints,
    shelterPlots: canonical.shelterPlots,
    staticScenery: canonical.staticScenery,
    scenicClusters: canonical.scenicClusters,
    scenicLandmarks: canonical.scenicLandmarks,
    storyNeighborhoods: canonical.storyNeighborhoods,
    terrainPatches: canonical.terrainPatches,
    visualPathCompositions: canonical.visualPathCompositions,
    occupiedHomeObligations: canonical.occupiedHomeObligations,
    gateStoryTopology: canonical.gateStoryTopology,
    storyDistricts: canonical.storyDistricts,
    animatedEnvironment: canonical.animatedEnvironment,
    districts: canonical.districts,
  };
}

function canonicalRecipe(recipe: RegionMapRecipeV1): RegionMapRecipeV1 {
  const tile = (value: TileCoord): TileCoord => ({ column: value.column, row: value.row });
  const point = (value: Vec2): Vec2 => ({ x: value.x, y: value.y });
  const plot = (value: ShelterPlot): ShelterPlot => ({ id: value.id, tile: tile(value.tile), door: tile(value.door) });
  const gate = (value: RegionGate): RegionGate => ({
    edge: { from: value.edge.from, to: value.edge.to },
    role: value.role,
    tile: tile(value.tile),
    facing: value.facing,
  });
  const canonical: RegionMapRecipeV1 = {
    version: 1,
    regionId: recipe.regionId,
    identityHash: recipe.identityHash,
    kit: recipe.kit,
    ...(recipe.presentationProfile === undefined
      ? {}
      : {
          presentationProfile: {
            kind: recipe.presentationProfile.kind,
            atlasProfileVersion: recipe.presentationProfile.atlasProfileVersion,
            staticSceneHash: recipe.presentationProfile.staticSceneHash,
          },
        }),
    grid: {
      columns: recipe.grid.columns,
      rows: recipe.grid.rows,
      collision: Uint8Array.from(recipe.grid.collision),
      ...(recipe.grid.topology === undefined ? {} : { topology: recipe.grid.topology }),
    },
    edgeMask: Uint8Array.from(recipe.edgeMask),
    waterVoidMask: Uint8Array.from(recipe.waterVoidMask),
    pathMask: Uint8Array.from(recipe.pathMask),
    soilMask: Uint8Array.from(recipe.soilMask),
    gates: recipe.gates.map(gate),
    arrivalAnchors: recipe.arrivalAnchors.map(tile),
    spawnAnchors: recipe.spawnAnchors.map(tile),
    socialAnchors: recipe.socialAnchors.map(tile),
    resourceAnchors: {
      energy: recipe.resourceAnchors.energy.map(tile),
      materials: recipe.resourceAnchors.materials.map(tile),
    },
    stagingAnchors: recipe.stagingAnchors.map(tile),
    stagingPoints: recipe.stagingPoints.map(point),
    shelterPlots: recipe.shelterPlots.map(plot),
    staticScenery: recipe.staticScenery.map((value) => ({
      id: value.id,
      kind: value.kind,
      tile: tile(value.tile),
      blocksMovement: value.blocksMovement,
      clusterId: value.clusterId,
      role: value.role,
      visualFootprint: {
        widthTiles: value.visualFootprint.widthTiles,
        heightTiles: value.visualFootprint.heightTiles,
      },
      hardCollisionFootprint: value.hardCollisionFootprint.map(tile),
    })),
    scenicClusters: recipe.scenicClusters.map((value) => ({
      id: value.id,
      districtIndex: value.districtIndex,
      role: value.role,
      signature: value.signature,
      anchor: tile(value.anchor),
      memberIds: [...value.memberIds],
      plannedLandmark: {
        recordType: value.plannedLandmark.recordType,
        plannedId: value.plannedLandmark.plannedId,
        semanticRole: value.plannedLandmark.semanticRole,
        runtimeAtlasLookup: false,
      },
    })),
    scenicLandmarks: recipe.scenicLandmarks.map((value) => ({
      recordType: "scenic-landmark-placement",
      id: value.id,
      clusterId: value.clusterId,
      districtIndex: value.districtIndex,
      role: value.role,
      contactTile: tile(value.contactTile),
      semanticKind: value.semanticKind,
      variantId: value.variantId,
      atlasId: value.atlasId,
      frame: {
        x: value.frame.x,
        y: value.frame.y,
        width: 128,
        height: 128,
      },
      contactPivotPx: point(value.contactPivotPx),
      visualFootprint: {
        originOffsetTiles: point(value.visualFootprint.originOffsetTiles),
        widthTiles: value.visualFootprint.widthTiles,
        heightTiles: value.visualFootprint.heightTiles,
      },
      hardOffsets: value.hardOffsets.map(point),
      interactionExclusionOffsets: value.interactionExclusionOffsets.map(point),
      heightPolicy: value.heightPolicy,
      topologyKey: value.topologyKey,
      geometryHash: value.geometryHash,
      collisionBehavior: "presentation-only",
      affectsMechanics: false,
    })),
    storyNeighborhoods: recipe.storyNeighborhoods.map((value) => ({
      id: value.id,
      districtIndex: value.districtIndex,
      anchorKind: value.anchorKind,
      anchor: tile(value.anchor),
      authoritativeGate: value.authoritativeGate === null ? null : gate(value.authoritativeGate),
      terrainPatchId: value.terrainPatchId,
      pathContext: value.pathContext.mode === "local-authoritative-path"
        ? {
            mode: "local-authoritative-path" as const,
            contextAnchor: tile(value.pathContext.contextAnchor),
            visualPathCompositionId: value.pathContext.visualPathCompositionId,
            navigationDistance: value.pathContext.navigationDistance,
          }
        : {
            mode: "detached-no-crop-local-path" as const,
            reason: "no-admissible-crop-local-authoritative-path-composition" as const,
            constraint: value.pathContext.constraint,
            nearestAuthoritativeContext: tile(value.pathContext.nearestAuthoritativeContext),
            navigationDistance: value.pathContext.navigationDistance,
            visualPathCompositionId: null,
          },
      minimumNativeZoom: 1,
    })),
    terrainPatches: recipe.terrainPatches.map((value) => ({
      recordType: "terrain-patch",
      id: value.id,
      districtIndex: value.districtIndex,
      role: value.role,
      cells: value.cells.map(tile),
      footprint: {
        origin: tile(value.footprint.origin),
        widthTiles: value.footprint.widthTiles,
        heightTiles: value.footprint.heightTiles,
      },
      storyOwnerIds: [...value.storyOwnerIds],
      collisionBehavior: "visual-only",
      affectsMechanics: false,
    })),
    visualPathCompositions: recipe.visualPathCompositions.map((value) => ({
      recordType: "visual-path-composition",
      id: value.id,
      districtIndex: value.districtIndex,
      role: value.role,
      centerlineCells: value.centerlineCells.map(tile),
      shoulderCells: value.shoulderCells.map(tile),
      clearingCells: value.clearingCells.map(tile),
      footprint: {
        origin: tile(value.footprint.origin),
        widthTiles: value.footprint.widthTiles,
        heightTiles: value.footprint.heightTiles,
      },
      storyOwnerIds: [...value.storyOwnerIds],
      collisionBehavior: "visual-only",
      affectsMechanics: false,
    })),
    occupiedHomeObligations: recipe.occupiedHomeObligations.map((value) => ({
      recordType: "dynamic-occupied-home",
      id: value.id,
      districtIndex: value.districtIndex,
      activation: "occupied-home-only",
      contextRole: value.contextRole,
      approachBindings: value.approachBindings.map((binding) => ({
        recordType: "occupied-home-approach-binding" as const,
        shelterPlotId: binding.shelterPlotId,
        doorAnchor: tile(binding.doorAnchor),
        apronCells: binding.apronCells.map(tile),
        nearestAuthoritativeContext: tile(binding.nearestAuthoritativeContext),
        navigationDistance: binding.navigationDistance,
        activation: "when-plot-occupied" as const,
        collisionBehavior: "visual-only" as const,
        affectsMechanics: false as const,
      })),
      requiredContextAccents: 2,
      collisionBehavior: "visual-only",
      affectsMechanics: false,
    })),
    gateStoryTopology: recipe.gateStoryTopology.mode === "isolated"
      ? { mode: "isolated", reason: "no-authoritative-directed-gates" }
      : recipe.gateStoryTopology.mode === "presentation-deferred"
        ? { mode: "presentation-deferred", reason: "exact-region-scenery-only" }
        : {
            mode: "directed-gates",
            authoritativeGateStoryIds: [...recipe.gateStoryTopology.authoritativeGateStoryIds],
          },
    storyDistricts: recipe.storyDistricts.map((value) => ({
      districtIndex: value.districtIndex,
      staticStoryIds: value.staticStoryIds.primaryGate === undefined
        ? {
            social: value.staticStoryIds.social,
            energy: value.staticStoryIds.energy,
            materials: value.staticStoryIds.materials,
          }
        : {
            primaryGate: value.staticStoryIds.primaryGate,
            social: value.staticStoryIds.social,
            energy: value.staticStoryIds.energy,
            materials: value.staticStoryIds.materials,
          },
      dynamicOccupiedHomeObligationId: value.dynamicOccupiedHomeObligationId,
    })),
    animatedEnvironment: recipe.animatedEnvironment.map((value) => ({
      id: value.id,
      kind: value.kind,
      tile: tile(value.tile),
      phaseSeed: value.phaseSeed,
    })),
    districts: recipe.districts.map((value) => ({
      index: value.index,
      origin: tile(value.origin),
      socialAnchors: value.socialAnchors.map(tile),
      stagingAnchors: value.stagingAnchors.map(tile),
      stagingPoints: value.stagingPoints.map(point),
      shelterPlots: value.shelterPlots.map(plot),
    })),
  };
  transferRegionRecipeCloneMetadata(recipe, canonical);
  return canonical;
}

function transferRegionRecipeCloneMetadata(
  source: RegionMapRecipeV1,
  clone: RegionMapRecipeV1,
): void {
  for (const transfer of REGION_RECIPE_CLONE_TRANSFERS) transfer(source, clone);
}

function validateExpectedIdentity(
  recipe: RegionMapRecipeV1,
  expected: RegionMapIdentity,
  expectedRecipeFactory: (identity: RegionMapIdentity) => RegionMapRecipeV1,
): RegionMapRecipeV1 {
  if (recipe.regionId !== expected.regionId) {
    throw new Error("recipe regionId does not match the expected identity");
  }
  if (recipe.identityHash !== regionMapIdentityHash(expected)) {
    throw new Error("recipe identityHash does not match the expected identity");
  }
  if (recipe.kit !== selectBiomeKit(expected.archetype)) {
    throw new Error("recipe kit does not match the expected identity");
  }
  const expectedGates = createCanonicalRegionGates(expected);
  if (recipe.gates.length !== expectedGates.length ||
      recipe.gates.some((gate, index) => !sameGate(gate, expectedGates[index]))) {
    throw new Error("recipe gates do not match the exact expected identity topology");
  }
  const expectedRecipe = expectedRecipeFactory(expected);
  if (canonicalSemanticJson(recipe) !== canonicalSemanticJson(toSerialized(expectedRecipe))) {
    throw new Error(
      "recipe canonical deterministic fields must exactly match identity-derived masks, collision, anchors, staging, plots, districts, terrain, paths, stories, and placements",
    );
  }
  return expectedRecipe;
}

function canonicalSemanticJson(value: unknown): string {
  const normalize = (candidate: unknown): unknown => {
    if (candidate instanceof Uint8Array) return [...candidate];
    if (Array.isArray(candidate)) return candidate.map(normalize);
    if (candidate === null || typeof candidate !== "object") return candidate;
    return Object.fromEntries(Object.entries(candidate as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, normalize(nested)]));
  };
  return JSON.stringify(normalize(value));
}

function sameGate(left: RegionGate, right: RegionGate): boolean {
  return left.edge.from === right.edge.from && left.edge.to === right.edge.to &&
    left.role === right.role && left.facing === right.facing && sameTile(left.tile, right.tile);
}

function gateKey(gate: RegionGate): string {
  return [
    gate.edge.from,
    gate.edge.to,
    gate.role,
    gate.facing,
    gate.tile.column,
    gate.tile.row,
  ].join("|");
}

function validateCategoryDisjointness(
  recipe: RegionMapRecipeV1,
  gates: readonly RegionGate[],
  arrivals: readonly TileCoord[],
  spawn: readonly unknown[],
  social: readonly unknown[],
  energy: readonly unknown[],
  materials: readonly unknown[],
  staging: readonly unknown[],
  plots: readonly unknown[],
  staticScenery: readonly unknown[],
  animatedEnvironment: readonly unknown[],
): void {
  const categories = new Map<string, string>();
  const add = (category: string, value: unknown, label: string): void => {
    const key = tileKey(requireTile(value, recipe.grid, label));
    const existing = categories.get(key);
    if (existing !== undefined && existing !== category) {
      throw new Error(`recipe category overlap between ${existing} and ${category}`);
    }
    categories.set(key, category);
  };
  for (let index = 0; index < recipe.waterVoidMask.length; index += 1) {
    if (recipe.waterVoidMask[index] === 1) add("water", {
      column: index % recipe.grid.columns,
      row: Math.floor(index / recipe.grid.columns),
    }, "water tile");
  }
  for (const gate of gates) add("anchor", gate.tile, "gate anchor");
  for (const value of arrivals) add("anchor", value, "arrival anchor");
  for (const value of [...spawn, ...social, ...energy, ...materials, ...staging]) add("anchor", value, "canonical anchor");
  for (const value of plots) {
    const record = requireRecord(value, "shelter plot");
    add("anchor", record.tile, "shelter tile");
    add("anchor", record.door, "shelter door");
  }
  for (const tile of maskTiles(recipe.soilMask, recipe.grid.columns)) add("soil", tile, "soil tile");
  for (const value of staticScenery) add("static scenery", requireRecord(value, "static scenery").tile, "static scenery tile");
  for (const value of animatedEnvironment) add("animated environment", requireRecord(value, "animated environment").tile, "animated environment tile");
  for (const tile of maskTiles(recipe.pathMask, recipe.grid.columns)) {
    const existing = categories.get(tileKey(tile));
    if (existing !== undefined && existing !== "anchor") {
      throw new Error(`recipe category overlap between ${existing} and path`);
    }
  }
}

/**
 * Every declared anchor must be reachable on foot from the canonical spawn anchor.
 *
 * Proved with ONE flood fill from the spawn anchor rather than one `findNavigationPath`
 * per anchor. The two are exactly equivalent: `findNavigationPath` walks the four cardinal
 * neighbours over `grid.collision`, treats a tile as open iff it is in bounds with
 * collision 0, and its default visit budget is the whole grid — so `status === "reached"`
 * holds iff the start is open and the goal lies in the start's four-connected open
 * component, which is precisely what the fill computes.
 *
 * The reason it matters: A* re-sorts its whole open set on every expansion, so its cost
 * grows sharply with path length. On an open plain the per-anchor searches were short; once
 * a region carries real terrain — a river, thickets, a scarp — routes get long and the
 * ~500 searches a grown region needs went from ~0.4s to ~5.7s, measured. The fill is
 * O(tiles + anchors) and independent of how convoluted the terrain is.
 *
 * `findNavigationPath` itself is deliberately NOT touched: it is a movement algorithm.
 */
function validateAnchorConnectivity(recipe: RegionMapRecipeV1, values: readonly unknown[]): void {
  if (recipe.spawnAnchors.length === 0) throw new Error("recipe must provide a canonical spawn anchor");
  const origin = recipe.spawnAnchors[0];
  const unique = new Map<string, TileCoord>();
  for (const value of values) {
    const anchor = requireTile(value, recipe.grid, "connectivity anchor");
    unique.set(tileKey(anchor), anchor);
  }
  const { columns, rows, collision } = recipe.grid;
  const reachable = new Uint8Array(columns * rows);
  const originIndex = origin.row * columns + origin.column;
  const originOpen = origin.column >= 0 && origin.column < columns
    && origin.row >= 0 && origin.row < rows
    && collision[originIndex] === 0;
  if (originOpen) {
    const stack = [originIndex];
    reachable[originIndex] = 1;
    while (stack.length > 0) {
      const index = stack.pop()!;
      const column = index % columns;
      const row = (index - column) / columns;
      const neighbours = [
        row > 0 ? index - columns : -1,
        column < columns - 1 ? index + 1 : -1,
        row < rows - 1 ? index + columns : -1,
        column > 0 ? index - 1 : -1,
      ];
      for (const neighbour of neighbours) {
        if (neighbour < 0 || reachable[neighbour] === 1 || collision[neighbour] !== 0) continue;
        reachable[neighbour] = 1;
        stack.push(neighbour);
      }
    }
  }
  for (const anchor of unique.values()) {
    if (!originOpen || reachable[anchor.row * columns + anchor.column] !== 1) {
      throw new Error(`recipe anchor ${tileKey(anchor)} must be reachable from the canonical spawn anchor`);
    }
  }
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error(`${label} must be an object`);
  return value as Record<string, unknown>;
}

function requirePositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) throw new Error(`${label} must be a positive safe integer`);
  return value as number;
}

function requireNonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${label} must be a non-negative safe integer`);
  }
  return value as number;
}

function requireByteArray(value: unknown, length: number, label: string): Uint8Array {
  if (!Array.isArray(value) || value.length !== length || value.some((item) => item !== 0 && item !== 1)) {
    throw new Error(`${label} must contain exactly ${length} binary bytes`);
  }
  return Uint8Array.from(value as number[]);
}

function requireArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} must be an array`);
  return value;
}

function requireNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label} must be a non-empty string`);
  return value;
}

function requireVisualFootprint(value: unknown, label: string): SceneryVisualFootprint {
  const record = requireRecord(value, label);
  const widthTiles = requirePositiveInteger(record.widthTiles, `${label}.widthTiles`);
  const heightTiles = requirePositiveInteger(record.heightTiles, `${label}.heightTiles`);
  if (widthTiles > 4 || heightTiles > 4) throw new Error(`${label} must remain within four tiles`);
  return { widthTiles, heightTiles };
}

function requireCollisionFootprint(
  value: unknown,
  visual: SceneryVisualFootprint,
  label: string,
): TileCoord[] {
  const values = requireArray(value, label);
  const seen = new Set<string>();
  return values.map((item) => {
    const record = requireRecord(item, `${label} entry`);
    if (!Number.isSafeInteger(record.column) || !Number.isSafeInteger(record.row)
        || (record.column as number) < 0 || (record.row as number) < 0
        || (record.column as number) >= visual.widthTiles
        || (record.row as number) >= visual.heightTiles) {
      throw new Error(`${label} entry must fit inside the visual footprint`);
    }
    const tile = { column: record.column as number, row: record.row as number };
    rejectDuplicate(seen, tileKey(tile), `${label} must not contain duplicate cells`);
    return tile;
  });
}

function rejectDuplicate<T>(seen: Set<T>, value: T, message: string): void {
  if (seen.has(value)) throw new Error(message);
  seen.add(value);
}

function validateShelterPlot(
  value: unknown,
  grid: NavigationGrid,
  ids: Set<string>,
  tiles: Set<string>,
  label: string,
): ShelterPlot {
  const plot = requireRecord(value, label);
  const id = requireNonEmptyString(plot.id, `${label} id`);
  rejectDuplicate(ids, id, "duplicate shelter plot ID");
  const tile = requireTile(plot.tile, grid, `${label} tile`);
  const door = requireTile(plot.door, grid, `${label} door`);
  rejectDuplicate(tiles, tileKey(tile), "duplicate shelter plot tile");
  rejectDuplicate(tiles, tileKey(door), "duplicate shelter plot tile");
  const plotOrigin = tileCenter(tile);
  const doorPoint = tileCenter(door);
  if (!pointInRect(
    { x: doorPoint.x - plotOrigin.x, y: doorPoint.y - plotOrigin.y },
    SHELTER_DOOR_CLEARANCE,
  )) {
    throw new Error(`${label} shelter plot door must remain inside the shelter door-clearance contract`);
  }
  return { id, tile, door };
}

function validateShelterFootprints(plots: readonly ShelterPlot[], grid: NavigationGrid): void {
  const rectangles = plots.map((plot) => ({ id: plot.id, ...shelterRenderRect(plot.tile) }));
  for (let leftIndex = 0; leftIndex < rectangles.length; leftIndex += 1) {
    const left = rectangles[leftIndex]!;
    if (left.left < 0 || left.top < 0 ||
        left.right > grid.columns * TILE_SIZE || left.bottom > grid.rows * TILE_SIZE) {
      throw new Error(`shelter plot render footprint must remain inside the map: ${left.id}`);
    }
    for (let rightIndex = leftIndex + 1; rightIndex < rectangles.length; rightIndex += 1) {
      const right = rectangles[rightIndex]!;
      if (rectanglesOverlap(left, right)) {
        throw new Error(`shelter plot render footprint overlap: ${left.id} and ${right.id}`);
      }
    }
  }
}

function validateShelterEnvironmentClearance(
  shelters: readonly ShelterPlot[],
  environment: readonly Readonly<{
    id: string;
    tile: TileCoord;
    visualFootprint: SceneryVisualFootprint;
  }>[],
): void {
  const environmentRects = environment.map((placement) => ({
    id: placement.id,
    rect: environmentRenderRect(placement.tile, placement.visualFootprint),
  }));
  for (const shelter of shelters) {
    const shelterRect = productionShelterRenderRect(shelter.tile);
    const intrusion = environmentRects.find((placement) =>
      productionRectsOverlap(shelterRect, placement.rect));
    if (intrusion !== undefined) {
      throw new Error(
        `recipe shelter render footprint ${shelter.id} must not overlap environment footprint ${intrusion.id}`,
      );
    }
  }
}

function validateStagingGeometry(
  recipe: RegionMapRecipeV1,
  anchors: readonly unknown[],
  points: readonly unknown[],
  shelters: readonly ShelterPlot[],
  environment: readonly Readonly<{
    id: string;
    tile: TileCoord;
    visualFootprint: SceneryVisualFootprint;
  }>[],
  expectedCount: number = DISTRICT_ORIGINS.length * STAGING_POINTS_PER_DISTRICT,
): void {
  if (anchors.length !== expectedCount || points.length !== expectedCount) {
    throw new Error(
      `recipe canonical staging capacity must contain exactly ${expectedCount} anchors and points`,
    );
  }
  const parsedPoints = points.map((value) => requirePoint(value, "recipe.stagingPoints entry"));
  const parsedAnchors = anchors.map((value) => requireTile(value, recipe.grid, "recipe.stagingAnchors entry"));
  const seenPoints = new Set<string>();
  const shelterRects = shelters.map((plot) => productionShelterRenderRect(plot.tile));
  const environmentRects = environment.map((placement) => ({
    id: placement.id,
    rect: environmentRenderRect(placement.tile, placement.visualFootprint),
  }));
  for (const [index, point] of parsedPoints.entries()) {
    rejectDuplicate(seenPoints, pointKey(point), "recipe canonical staging points must be unique");
    if (!sameTile(navigationTileForFeet(point), parsedAnchors[index]!)) {
      throw new Error("recipe canonical staging point must map to its exact navigation anchor");
    }
    const envelope = feetAnchoredVisualRect(point);
    if (envelope.x < 0 || envelope.y < 0
      || envelope.x + envelope.width > recipe.grid.columns * TILE_SIZE
      || envelope.y + envelope.height > recipe.grid.rows * TILE_SIZE) {
      throw new Error("recipe canonical staging visual envelope must remain inside the map");
    }
    if (shelterRects.some((shelter) => productionRectsOverlap(envelope, shelter))) {
      throw new Error("recipe canonical staging visual envelope must not overlap a shelter footprint");
    }
    const environmentIntrusion = environmentRects.find((placement) =>
      productionRectsOverlap(envelope, placement.rect));
    if (environmentIntrusion !== undefined) {
      throw new Error(
        `recipe canonical staging visual envelope must not overlap environment footprint ${environmentIntrusion.id}`,
      );
    }
    for (let prior = 0; prior < index; prior += 1) {
      const other = parsedPoints[prior]!;
      if (Math.abs(point.x - other.x) < STANDING_HUMAN_VISUAL_ENVELOPE.width + 4
        && Math.abs(point.y - other.y) < STANDING_HUMAN_VISUAL_ENVELOPE.height + 4) {
        throw new Error("recipe canonical staging visual envelopes must keep the four-pixel actor gap");
      }
    }
  }
}

function validateCriticalRouteEnvironmentClearance(
  recipe: RegionMapRecipeV1,
  shelters: readonly ShelterPlot[],
  environment: readonly Readonly<{
    id: string;
    tile: TileCoord;
    visualFootprint: SceneryVisualFootprint;
  }>[],
): void {
  const environmentRects = environment.map((placement) => ({
    id: placement.id,
    rect: environmentRenderRect(placement.tile, placement.visualFootprint),
  }));
  const criticalFeet = [
    ...maskTiles(recipe.pathMask, recipe.grid.columns).map(tileCenter),
    ...shelters.map((plot) => tileCenter(plot.door)),
  ];
  for (const feet of criticalFeet) {
    const envelope = feetAnchoredVisualRect(feet);
    const intrusion = environmentRects.find((placement) =>
      productionRectsOverlap(envelope, placement.rect));
    if (intrusion !== undefined) {
      throw new Error(
        `recipe critical path standing-human envelope must not overlap environment footprint ${intrusion.id}`,
      );
    }
  }
}

function shelterRenderRect(tile: TileCoord): Readonly<{
  left: number;
  top: number;
  right: number;
  bottom: number;
}> {
  const origin = tileCenter(tile);
  return {
    left: origin.x,
    top: origin.y,
    right: origin.x + SHELTER_RENDER_FOOTPRINT.width,
    bottom: origin.y + SHELTER_RENDER_FOOTPRINT.height,
  };
}

function rectanglesOverlap(
  left: Readonly<{ left: number; top: number; right: number; bottom: number }>,
  right: Readonly<{ left: number; top: number; right: number; bottom: number }>,
): boolean {
  return left.left < right.right && left.right > right.left &&
    left.top < right.bottom && left.bottom > right.top;
}

function pointInRect(
  point: Readonly<{ x: number; y: number }>,
  rect: Readonly<{ x: number; y: number; width: number; height: number }>,
): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width &&
    point.y >= rect.y && point.y <= rect.y + rect.height;
}

function perimeterSide(tile: TileCoord): RegionGate["facing"] | null {
  const near = MECHANICS_CORE_ORIGIN + 1;
  const far = MECHANICS_CORE_ORIGIN + MECHANICS_CORE_SIZE - 2;
  if (tile.row === near) return "north";
  if (tile.column === far) return "east";
  if (tile.row === far) return "south";
  if (tile.column === near) return "west";
  return null;
}

function oppositeDirection(direction: RegionGate["facing"]): RegionGate["facing"] {
  switch (direction) {
    case "north": return "south";
    case "east": return "west";
    case "south": return "north";
    case "west": return "east";
  }
}

function requireTile(value: unknown, grid: NavigationGrid, label: string): TileCoord {
  const record = requireRecord(value, label);
  const column = record.column;
  const row = record.row;
  if (!Number.isSafeInteger(column) || !Number.isSafeInteger(row) ||
      (column as number) < 0 || (column as number) >= grid.columns ||
      (row as number) < 0 || (row as number) >= grid.rows) {
    throw new Error(`${label} must be an in-bounds integer tile`);
  }
  return { column: column as number, row: row as number };
}

function requirePoint(value: unknown, label: string): Vec2 {
  const record = requireRecord(value, label);
  if (!Number.isSafeInteger(record.x) || !Number.isSafeInteger(record.y)) {
    throw new Error(`${label} must be an integer-pixel point`);
  }
  return { x: record.x as number, y: record.y as number };
}

function sameTile(left: TileCoord, right: TileCoord): boolean {
  return left.column === right.column && left.row === right.row;
}

function sameSerialized(left: readonly unknown[], right: readonly unknown[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function inDistrict(tile: TileCoord, origin: TileCoord): boolean {
  return tile.column >= origin.column && tile.column < origin.column + DISTRICT_COLUMNS &&
    tile.row >= origin.row && tile.row < origin.row + 30;
}

function inLandscapeSector(tile: TileCoord, origin: TileCoord): boolean {
  const districtIndex = DISTRICT_ORIGINS.findIndex((candidate) => sameTile(candidate, origin));
  const sector = LANDSCAPE_SECTORS[districtIndex];
  return sector !== undefined
    && tile.column >= sector.column && tile.column < sector.column + LANDSCAPE_SECTOR_COLUMNS
    && tile.row >= sector.row && tile.row < sector.row + LANDSCAPE_SECTOR_ROWS;
}

function offset(origin: TileCoord, column: number, row: number): TileCoord {
  return { column: origin.column + column, row: origin.row + row };
}

function indexOf(tile: TileCoord): number {
  return tile.row * COLUMNS + tile.column;
}

function gridIndex(grid: NavigationGrid, tile: TileCoord): number {
  return tile.row * grid.columns + tile.column;
}

function indexKey(index: number): string {
  return `${index % COLUMNS},${Math.floor(index / COLUMNS)}`;
}

function tileKey(tile: TileCoord): string {
  return `${tile.column},${tile.row}`;
}

function pointKey(point: Vec2): string {
  return `${point.x},${point.y}`;
}

function squaredDistance(left: Vec2, right: Vec2): number {
  return (left.x - right.x) ** 2 + (left.y - right.y) ** 2;
}
