/** Compose the exact 96x96 production Nirvana landscape around immutable mechanics. */

import type { Rect, Vec2 } from "../../contracts";
import type { ShelterPlot, TileCoord } from "../../map/regionMap";
import type { RegionGate } from "../maps/directedTopology";
import {
  NIRVANA_AUTHORED_CHUNK_COORDS,
  assertNirvanaLandmarksClearOfMechanics,
  createNirvanaAuthoredChunk,
  nirvanaAuthoredChunkGeometry,
  nirvanaChunkLocalSemanticDigest,
  type NirvanaChunkMacroRole,
} from "./NirvanaChunkAuthoring";
import {
  NIRVANA_CHUNK_COLUMNS,
  NIRVANA_CHUNK_ROWS,
  NIRVANA_TILE_SIZE,
  appendNirvanaChunk,
  createNirvanaChunk,
  createNirvanaRegion,
  nirvanaChunkKey,
  type NirvanaChunk,
  type NirvanaLandmarkPlacement,
  type NirvanaRegionV2,
  type NirvanaScenerySprite,
  type NirvanaTileCoordinate,
} from "./NirvanaRegionV2";
import { createNirvanaRootChunk, nirvanaRootChunkGeometry } from "./NirvanaRootChunk";
import {
  createNirvanaGenesisTerrainField,
  type NirvanaChunkGeometry,
} from "./NirvanaTerrainChunks";
import type { NirvanaTerrainField } from "./NirvanaTerrainField";

/** Narrow, recipe-independent mechanics contract consumed by Nirvana authoring. */
export interface NirvanaMechanicsExclusions {
  readonly hardTiles: readonly string[];
  readonly visualRects: readonly Rect[];
  readonly shelterPlots: readonly ShelterPlot[];
  readonly stagingPoints: readonly Vec2[];
  readonly anchors: readonly TileCoord[];
  readonly gates: readonly RegionGate[];
}

export type NirvanaRootAdaptationReason =
  | "mechanics-exclusion"
  | "internal-east-seam"
  | "internal-south-seam";

export type NirvanaMechanicsConflictKind =
  | "hard-tile"
  | "shelter-plot"
  | "shelter-door"
  | "staging-point"
  | "anchor"
  | "directed-gate"
  | "visual-envelope";

export interface NirvanaMechanicsConflict {
  readonly tile: NirvanaTileCoordinate;
  readonly kinds: readonly NirvanaMechanicsConflictKind[];
}

/** Auditable source-to-derived change; no collision can disappear anonymously. */
export interface NirvanaRootAdaptation {
  readonly id: string;
  readonly kind: "boundary-landmark-removal";
  readonly reasons: readonly NirvanaRootAdaptationReason[];
  readonly sourceLandmark: NirvanaLandmarkPlacement;
  readonly derivedLandmark: null;
  readonly conflicts: readonly NirvanaMechanicsConflict[];
  readonly removedCollisionTiles: readonly NirvanaTileCoordinate[];
  readonly addedCollisionTiles: readonly NirvanaTileCoordinate[];
  readonly removedRoadTiles: readonly NirvanaTileCoordinate[];
  readonly addedRoadTiles: readonly NirvanaTileCoordinate[];
}

export interface NirvanaSeamCandidate {
  readonly axis: "x" | "y";
  readonly negativeEdgeTile: NirvanaTileCoordinate;
  readonly positiveEdgeTile: NirvanaTileCoordinate;
}

export interface NirvanaInitialRegion {
  readonly region: NirvanaRegionV2;
  readonly sceneHash: string;
  readonly wrapSeamCandidates: readonly NirvanaSeamCandidate[];
  readonly macroRoles: ReadonlyMap<string, NirvanaChunkMacroRole>;
  readonly localSemanticDigests: ReadonlyMap<string, string>;
  readonly rootAdaptations: readonly NirvanaRootAdaptation[];
  /** Geometry-only expansion receipt; absent for the byte-locked Genesis scene. */
  readonly growthReceipt?: NirvanaRegionGrowthReceipt;
}

export interface NirvanaGeneratedChunkReceipt {
  readonly coord: Readonly<{ column: number; row: number }>;
  readonly districtIndex: number;
  readonly chunkContentHash: string;
  readonly seamContractHash: string;
  readonly generationHash: string;
}

/** Auditable, pressure-independent receipt for one published Nirvana geometry tier. */
export interface NirvanaRegionGrowthReceipt {
  readonly version: 1;
  readonly algorithmVersion: 1;
  readonly generatorVersion: 1;
  readonly growthVersion: number;
  readonly growthHash: string;
  readonly targetChunkColumns: number;
  readonly targetChunkRows: number;
  readonly generatedChunks: readonly NirvanaGeneratedChunkReceipt[];
}

const ROOT_REMOVALS = Object.freeze([
  "woodland-east-lower",
  "woodland-east-bottom",
  "woodland-bottom-midwest",
  "woodland-bottom-mideast",
  "woodland-bottom-east",
] as const);

const WRAP_SEAM_CANDIDATES: readonly NirvanaSeamCandidate[] = Object.freeze([
  Object.freeze({
    axis: "x",
    negativeEdgeTile: Object.freeze({ column: 0, row: 14 }),
    positiveEdgeTile: Object.freeze({ column: 95, row: 14 }),
  }),
  Object.freeze({
    axis: "y",
    negativeEdgeTile: Object.freeze({ column: 84, row: 0 }),
    positiveEdgeTile: Object.freeze({ column: 84, row: 95 }),
  }),
]);

const GENESIS_COLUMNS = 2 * NIRVANA_CHUNK_COLUMNS;
const GENESIS_ROWS = 3 * NIRVANA_CHUNK_ROWS;

/**
 * Build the deterministic six-chunk production region and its audit metadata.
 *
 * Two passes, and the order is forced. The approved river valley is one continuous body
 * across chunk seams whose walkability can only be proved region-wide, so the terrain
 * field must see the whole 96x96 — but the field also has to know where the roads, the
 * dry channels, the connectors and the macro landmarks are, and only the chunk builders
 * know that. So the builders run once with no field to DECLARE their geometry, the field
 * is built from that declaration plus the mechanics exclusions, and the builders run
 * again to PUBLISH their art and their collision. Both passes are pure functions of the
 * same exclusions and the field is memoised, so this costs one extra chunk build.
 */
export function createNirvanaInitialRegion(
  inputExclusions: NirvanaMechanicsExclusions,
): NirvanaInitialRegion {
  const exclusions = canonicalizeExclusions(inputExclusions);
  const cacheKey = stableHash(exclusions);
  const cached = REGION_CACHE.get(cacheKey);
  if (cached !== undefined) return cached;
  const built = buildNirvanaInitialRegion(exclusions);
  if (REGION_CACHE.size >= REGION_CACHE_LIMIT) {
    const oldest = REGION_CACHE.keys().next();
    if (!oldest.done) REGION_CACHE.delete(oldest.value);
  }
  REGION_CACHE.set(cacheKey, built);
  return built;
}

/**
 * Memoise the whole region build on its only input.
 *
 * `createNirvanaInitialRegion` is a pure function of the canonicalised mechanics
 * exclusions and returns a deeply frozen value, so sharing one build between callers is
 * indistinguishable from rebuilding it. Growth planning and the recipe sweeps build the
 * same Genesis region many times over, and the region is now materially more expensive
 * than it was — the terrain field, plus overlays and scenery inside every chunk's content
 * hash — so rebuilding it each time is what pushed the heavy recipe suites past their
 * timeout.
 */
const REGION_CACHE_LIMIT = 4;
const REGION_CACHE = new Map<string, NirvanaInitialRegion>();

function buildNirvanaInitialRegion(
  exclusions: NirvanaMechanicsExclusions,
): NirvanaInitialRegion {
  // Pass 1 — declare the authored geometry the terrain must respect. The root's audited
  // boundary removals are applied FIRST, so the field only ever judges, and only ever
  // routes around, landmarks that will actually exist in the published region.
  const removalSet = new Set<string>(ROOT_REMOVALS);
  const rootGeometry = nirvanaRootChunkGeometry();
  const geometry: NirvanaChunkGeometry[] = [Object.freeze({
    ...rootGeometry,
    landmarks: Object.freeze(rootGeometry.landmarks.filter(({ id }) => !removalSet.has(id))),
  })];
  for (const coord of NIRVANA_AUTHORED_CHUNK_COORDS) {
    geometry.push(nirvanaAuthoredChunkGeometry(coord));
  }
  const field = createNirvanaGenesisTerrainField(
    exclusions,
    geometry,
    GENESIS_COLUMNS,
    GENESIS_ROWS,
  );

  // Pass 2 — publish the valley.
  const sourceRoot = createNirvanaRootChunk(field);
  const { root: derivedRoot, receipts } = createDerivedRoot(sourceRoot, exclusions, field);
  assertNirvanaLandmarksClearOfMechanics(
    derivedRoot.coord,
    derivedRoot.landmarks,
    exclusions,
  );

  let region = createNirvanaRegion(derivedRoot);
  const macroRoleEntries: [string, NirvanaChunkMacroRole][] = [];
  const semanticDigestEntries: [string, string][] = [[
    "0,0",
    nirvanaChunkLocalSemanticDigest(derivedRoot),
  ]];
  for (const coord of NIRVANA_AUTHORED_CHUNK_COORDS) {
    const authored = createNirvanaAuthoredChunk(coord, exclusions, field);
    region = appendNirvanaChunk(region, authored.chunk);
    const key = nirvanaChunkKey(coord);
    macroRoleEntries.push([key, authored.role]);
    semanticDigestEntries.push([key, authored.semanticDigest]);
  }

  const macroRoles = immutableMap(macroRoleEntries);
  const localSemanticDigests = immutableMap(semanticDigestEntries);
  const sceneHash = stableHash({
    chunks: [...region.chunks].map(([key, chunk]) => ({
      key,
      contentHash: chunk.contentHash,
      localSemanticDigest: localSemanticDigests.get(key),
    })),
    exclusions,
    rootAdaptations: receipts.map(receiptHashPayload),
    wrapSeamCandidates: WRAP_SEAM_CANDIDATES,
  });

  return Object.freeze({
    region,
    sceneHash,
    wrapSeamCandidates: WRAP_SEAM_CANDIDATES,
    macroRoles,
    localSemanticDigests,
    rootAdaptations: receipts,
  });
}

interface DerivedRootResult {
  readonly root: NirvanaChunk;
  readonly receipts: readonly NirvanaRootAdaptation[];
}

function createDerivedRoot(
  source: NirvanaChunk,
  exclusions: NirvanaMechanicsExclusions,
  field: NirvanaTerrainField | null,
): DerivedRootResult {
  const removalSet = new Set<string>(ROOT_REMOVALS);
  const removedLandmarks = ROOT_REMOVALS.flatMap((id) => {
    const landmark = source.landmarks.find((candidate) => candidate.id === id);
    if (landmark === undefined) {
      // A barrier the terrain verdict already retired never entered the source root, so
      // no collision of its ever existed to audit away. Absent WITHOUT a terrain field
      // still means the approved authoring changed, which must stay loud.
      if (field !== null) return [];
      throw new Error(`Nirvana approved root is missing audited boundary barrier ${id}`);
    }
    if (landmark.collisionRole !== "boundary-barrier") {
      throw new Error(`Nirvana approved root is missing audited boundary barrier ${id}`);
    }
    return [landmark];
  });
  const retainedLandmarks = source.landmarks.filter(({ id }) => !removalSet.has(id));
  const collision = collisionFor(retainedLandmarks, source.scenery, field, source.coord);
  const root = createNirvanaChunk({
    coord: source.coord,
    columns: source.columns,
    rows: source.rows,
    terrainCells: source.terrainCells,
    roadCells: source.roadCells,
    roadHub: source.roadHub,
    landmarks: retainedLandmarks,
    scenery: source.scenery,
    quietClearings: source.quietClearings,
    collision,
    connectors: source.connectors,
  });
  if (root.contentHash === source.contentHash) {
    throw new Error("Nirvana derived production root must have a distinct content hash");
  }

  const receipts = Object.freeze(removedLandmarks.map((landmark) => {
    const conflicts = directConflicts(landmark, exclusions);
    if (conflicts.length === 0) {
      throw new Error(`Nirvana audited root adaptation ${landmark.id} has no mechanics conflict`);
    }
    return Object.freeze({
      id: `root:${landmark.id}`,
      kind: "boundary-landmark-removal" as const,
      reasons: adaptationReasons(landmark),
      sourceLandmark: landmark,
      derivedLandmark: null,
      conflicts,
      removedCollisionTiles: Object.freeze(landmark.collisionTiles
        .filter((coordinate) => source.collision[collisionIndex(coordinate)] === 1
          && root.collision[collisionIndex(coordinate)] === 0)
        .map(cloneTile)
        .sort(compareTiles)),
      addedCollisionTiles: Object.freeze([]),
      removedRoadTiles: Object.freeze([]),
      addedRoadTiles: Object.freeze([]),
    });
  }));
  assertAdaptationCoverage(source, root, receipts);
  return Object.freeze({ root, receipts });
}

function adaptationReasons(
  landmark: NirvanaLandmarkPlacement,
): readonly NirvanaRootAdaptationReason[] {
  const reasons: NirvanaRootAdaptationReason[] = ["mechanics-exclusion"];
  if (landmark.bounds.column + landmark.bounds.columns === NIRVANA_CHUNK_COLUMNS) {
    reasons.push("internal-east-seam");
  }
  if (landmark.bounds.row + landmark.bounds.rows === NIRVANA_CHUNK_ROWS) {
    reasons.push("internal-south-seam");
  }
  return Object.freeze(reasons);
}

function directConflicts(
  landmark: NirvanaLandmarkPlacement,
  exclusions: NirvanaMechanicsExclusions,
): readonly NirvanaMechanicsConflict[] {
  const hardTiles = new Set(exclusions.hardTiles);
  const plotTiles = new Set(exclusions.shelterPlots.map(({ tile }) => tileKey(tile)));
  const doorTiles = new Set(exclusions.shelterPlots.map(({ door }) => tileKey(door)));
  const stagingTiles = new Set(exclusions.stagingPoints.map(({ x, y }) =>
    `${Math.floor(x / NIRVANA_TILE_SIZE)},${Math.floor(y / NIRVANA_TILE_SIZE)}`));
  const anchorTiles = new Set(exclusions.anchors.map(tileKey));
  const gateTiles = new Set(exclusions.gates.map(({ tile }) => tileKey(tile)));
  const result: NirvanaMechanicsConflict[] = [];
  for (const coordinate of landmark.collisionTiles) {
    const key = tileKey(coordinate);
    const kinds: NirvanaMechanicsConflictKind[] = [];
    if (plotTiles.has(key)) kinds.push("shelter-plot");
    if (doorTiles.has(key)) kinds.push("shelter-door");
    if (stagingTiles.has(key)) kinds.push("staging-point");
    if (anchorTiles.has(key)) kinds.push("anchor");
    if (gateTiles.has(key)) kinds.push("directed-gate");
    if (kinds.length === 0 && hardTiles.has(key)) kinds.push("hard-tile");
    if (kinds.length === 0) continue;
    result.push(Object.freeze({
      tile: cloneTile(coordinate),
      kinds: Object.freeze(kinds),
    }));
  }
  return Object.freeze(result.sort((left, right) => compareTiles(left.tile, right.tile)));
}

function assertAdaptationCoverage(
  source: NirvanaChunk,
  derived: NirvanaChunk,
  receipts: readonly NirvanaRootAdaptation[],
): void {
  const receiptedCollision = new Set(receipts.flatMap(({ removedCollisionTiles, addedCollisionTiles }) =>
    [...removedCollisionTiles, ...addedCollisionTiles].map(tileKey)));
  for (let index = 0; index < source.collision.length; index += 1) {
    if (source.collision[index] === derived.collision[index]) continue;
    const key = `${index % NIRVANA_CHUNK_COLUMNS},${Math.floor(index / NIRVANA_CHUNK_COLUMNS)}`;
    if (!receiptedCollision.has(key)) {
      throw new Error(`Nirvana derived root collision changed without adaptation receipt at ${key}`);
    }
  }
}

/**
 * Recompose the derived root's collision from what actually blocks there.
 *
 * With a terrain field this is terrain ∪ retained landmarks ∪ blocking scenery, so
 * removing an audited boundary barrier gives back only the tiles nothing else closes —
 * which is what makes `assertAdaptationCoverage` a real audit rather than a formality.
 */
function collisionFor(
  landmarks: readonly NirvanaLandmarkPlacement[],
  scenery: readonly NirvanaScenerySprite[],
  field: NirvanaTerrainField | null,
  coord: Readonly<{ column: number; row: number }>,
): readonly (0 | 1)[] {
  const collision = Array.from(
    { length: NIRVANA_CHUNK_COLUMNS * NIRVANA_CHUNK_ROWS },
    () => 0 as 0 | 1,
  );
  if (field !== null) {
    const originColumn = coord.column * NIRVANA_CHUNK_COLUMNS;
    const originRow = coord.row * NIRVANA_CHUNK_ROWS;
    for (let row = 0; row < NIRVANA_CHUNK_ROWS; row += 1) {
      for (let column = 0; column < NIRVANA_CHUNK_COLUMNS; column += 1) {
        const index = (originRow + row) * field.columns + (originColumn + column);
        if (field.collision[index] === 1) collision[row * NIRVANA_CHUNK_COLUMNS + column] = 1;
      }
    }
  }
  for (const landmark of landmarks) {
    for (const coordinate of landmark.collisionTiles) {
      collision[collisionIndex(coordinate)] = 1;
    }
  }
  for (const sprite of scenery) {
    if (!sprite.blocksMovement) continue;
    collision[collisionIndex(sprite.tile)] = 1;
  }
  return Object.freeze(collision);
}

function collisionIndex(coordinate: NirvanaTileCoordinate): number {
  return coordinate.row * NIRVANA_CHUNK_COLUMNS + coordinate.column;
}

function receiptHashPayload(receipt: NirvanaRootAdaptation): unknown {
  return {
    id: receipt.id,
    kind: receipt.kind,
    reasons: receipt.reasons,
    sourceLandmarkId: receipt.sourceLandmark.id,
    conflicts: receipt.conflicts,
    removedCollisionTiles: receipt.removedCollisionTiles,
  };
}

function canonicalizeExclusions(
  input: NirvanaMechanicsExclusions,
): NirvanaMechanicsExclusions {
  const hardTiles = Object.freeze([...new Set(input.hardTiles.map((value) => {
    assertTileKey(value);
    return value;
  }))].sort(compareText));
  const visualRects = Object.freeze(input.visualRects.map(cloneRect).sort(compareRects));
  const shelterPlots = Object.freeze(input.shelterPlots.map((plot) => Object.freeze({
    id: plot.id,
    tile: cloneTile(plot.tile),
    door: cloneTile(plot.door),
  })).sort((left, right) => compareText(left.id, right.id)
    || compareTiles(left.tile, right.tile)
    || compareTiles(left.door, right.door)));
  const stagingPoints = Object.freeze(input.stagingPoints.map((point) => {
    assertFinite(point.x, "staging x");
    assertFinite(point.y, "staging y");
    return Object.freeze({ x: point.x, y: point.y });
  }).sort((left, right) => left.y - right.y || left.x - right.x));
  const anchors = Object.freeze(input.anchors.map(cloneTile).sort(compareTiles));
  const gates = Object.freeze(input.gates.map((gate) => Object.freeze({
    edge: Object.freeze({ from: gate.edge.from, to: gate.edge.to }),
    role: gate.role,
    tile: cloneTile(gate.tile),
    facing: gate.facing,
  })).sort(compareGates));
  return Object.freeze({ hardTiles, visualRects, shelterPlots, stagingPoints, anchors, gates });
}

function cloneRect(rect: Rect): Rect {
  assertFinite(rect.x, "visual rectangle x");
  assertFinite(rect.y, "visual rectangle y");
  assertFinite(rect.width, "visual rectangle width");
  assertFinite(rect.height, "visual rectangle height");
  if (rect.width <= 0 || rect.height <= 0) {
    throw new Error("Nirvana mechanics visual rectangles require positive dimensions");
  }
  return Object.freeze({ x: rect.x, y: rect.y, width: rect.width, height: rect.height });
}

function cloneTile(coordinate: TileCoord): NirvanaTileCoordinate {
  if (!Number.isSafeInteger(coordinate.column) || !Number.isSafeInteger(coordinate.row)) {
    throw new Error("Nirvana mechanics tile coordinates must be safe integers");
  }
  return Object.freeze({ column: coordinate.column, row: coordinate.row });
}

function assertTileKey(value: string): void {
  if (!/^-?\d+,-?\d+$/.test(value)) {
    throw new Error(`Nirvana mechanics hard tile is not canonical: ${value}`);
  }
}

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new Error(`Nirvana mechanics ${label} must be finite`);
}

function compareTiles(left: TileCoord, right: TileCoord): number {
  return left.row - right.row || left.column - right.column;
}

function compareRects(left: Rect, right: Rect): number {
  return left.y - right.y || left.x - right.x
    || left.height - right.height || left.width - right.width;
}

function compareGates(left: RegionGate, right: RegionGate): number {
  return compareText(left.edge.from, right.edge.from)
    || compareText(left.edge.to, right.edge.to)
    || compareText(left.role, right.role)
    || compareTiles(left.tile, right.tile)
    || compareText(left.facing, right.facing);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function tileKey(coordinate: TileCoord): string {
  return `${coordinate.column},${coordinate.row}`;
}

function stableHash(value: unknown): string {
  const source = JSON.stringify(canonicalJson(value));
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function canonicalJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Readonly<Record<string, unknown>>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalJson(nested)]),
  );
}

function immutableMap<K, V>(entries: readonly (readonly [K, V])[]): ReadonlyMap<K, V> {
  const source = new Map(entries);
  let view: ReadonlyMap<K, V>;
  view = Object.freeze({
    get size(): number { return source.size; },
    get(key: K): V | undefined { return source.get(key); },
    has(key: K): boolean { return source.has(key); },
    entries(): MapIterator<[K, V]> { return source.entries(); },
    keys(): MapIterator<K> { return source.keys(); },
    values(): MapIterator<V> { return source.values(); },
    forEach(callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void, thisArg?: unknown): void {
      source.forEach((value, key) => callback.call(thisArg, value, key, view));
    },
    [Symbol.iterator](): MapIterator<[K, V]> { return source[Symbol.iterator](); },
    [Symbol.toStringTag]: "Map",
  });
  return view;
}
