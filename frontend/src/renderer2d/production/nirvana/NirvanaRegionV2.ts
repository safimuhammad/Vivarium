/** Immutable chunk-local spatial model for the production Nirvana region. */

import type { NirvanaTerrainMaterial } from "./NirvanaTerrainField";

export const NIRVANA_CHUNK_COLUMNS = 48 as const;
export const NIRVANA_CHUNK_ROWS = 32 as const;
export const NIRVANA_TILE_SIZE = 32 as const;

export type NirvanaCardinalDirection = "north" | "east" | "south" | "west";

/**
 * What a tile's surface IS.
 *
 * The three flat ground kinds Nirvana shipped with (`olive-grass`, `worn-grass`,
 * `garden-floor`) are retired: the approved river valley re-expresses the whole region
 * in the `nirvana-v3` material vocabulary, and the old frames no longer exist in the
 * published generation. `dry-swale` and `ford` survive unchanged, because the authored
 * road/swale macro and its ford crossings are referenced by every chunk and by the
 * grown-chunk generator.
 */
export type NirvanaTerrainKind =
  | NirvanaTerrainMaterial
  | "dry-swale"
  | "ford";
export type NirvanaLandmarkFeature =
  | "woodland"
  | "hero-oak"
  | "ruined-garden"
  | "meadow-edge";
export type NirvanaLandmarkFrameId =
  | "landmark.hero-oak"
  | "landmark.forest-edge.cluster.0"
  | "landmark.forest-edge.cluster.1"
  | "landmark.ruined-garden"
  | "landmark.meadow-edge.north"
  | "landmark.meadow-edge.south"
  | "landmark.meadow-edge.west"
  | "landmark.meadow-edge.east"
  | "landmark.garden.wall"
  | "landmark.garden.corner"
  | "landmark.garden.broken-wall"
  | "landmark.garden.gate";
export type NirvanaLandmarkCollisionRole = "visual-footprint" | "boundary-barrier";

export interface NirvanaChunkCoord {
  readonly column: number;
  readonly row: number;
}

export interface NirvanaTileCoordinate {
  readonly column: number;
  readonly row: number;
}

export interface NirvanaTileRectangle extends NirvanaTileCoordinate {
  readonly columns: number;
  readonly rows: number;
}

/**
 * One corner-masked transition (or waterline) laid over a tile's base fill.
 *
 * `mask` names which of the tile's four corners the material covers — bit 1 = NW,
 * 2 = NE, 4 = SE, 8 = SW — so two materials interlock along a drawn contour instead of
 * meeting at a tile border. Mask 15 is total coverage and draws the material's own fill.
 */
export interface NirvanaTerrainOverlay {
  readonly material: NirvanaTerrainMaterial;
  readonly mask: number;
  readonly variant: number;
}

export interface NirvanaTerrainCell {
  readonly tile: NirvanaTileCoordinate;
  /** The tile's semantic surface; always agrees with its collision. */
  readonly kind: NirvanaTerrainKind;
  /** Variant index of the base fill. */
  readonly variant: number;
  /** Material filling the whole tile before any overlay. */
  readonly base: NirvanaTerrainMaterial;
  /** Corner-masked transitions, painted over the base in priority order. */
  readonly overlays: readonly NirvanaTerrainOverlay[];
  /** Waterlines, painted after every overlay. Empty away from the water. */
  readonly shorelines: readonly NirvanaTerrainOverlay[];
  readonly connections?: readonly NirvanaCardinalDirection[];
}

/**
 * One ground-scenery sprite: a tree, a boulder, a reed clump, a bridge plank.
 *
 * Scenery is deliberately NOT a landmark. Macro landmarks carry the mechanics-clearance
 * assertion and the root chunk's collision-adaptation audit, both of which exist to stop
 * a *building-sized* object from closing a home; a non-blocking tuft legitimately sits
 * inside a home's visual envelope. Keeping the two layers apart preserves both
 * invariants instead of weakening them.
 */
export interface NirvanaScenerySprite {
  readonly id: string;
  /** `s.<species>.<variant>` in the region generation. */
  readonly frameId: string;
  /** Sprite top-left, in chunk-local pixels. */
  readonly at: Readonly<{ x: number; y: number }>;
  /** Sprite feet, in chunk-local pixels; the foot-sort key. */
  readonly foot: Readonly<{ x: number; y: number }>;
  readonly blocksMovement: boolean;
  readonly tile: NirvanaTileCoordinate;
}

export interface NirvanaRoadCell {
  readonly tile: NirvanaTileCoordinate;
  readonly connections: readonly NirvanaCardinalDirection[];
  readonly surface: "dirt" | "ford";
}

export interface NirvanaLandmarkVisualPlacement {
  readonly id: string;
  readonly frameId: NirvanaLandmarkFrameId;
  readonly at: Readonly<{ x: number; y: number }>;
  readonly scale: 1 | 2;
}

export interface NirvanaLandmarkPlacement {
  readonly id: string;
  readonly feature: NirvanaLandmarkFeature;
  readonly frameId: NirvanaLandmarkFrameId;
  readonly tile: NirvanaTileCoordinate;
  readonly bounds: NirvanaTileRectangle;
  readonly blocksMovement: boolean;
  readonly collisionTiles: readonly NirvanaTileCoordinate[];
  readonly collisionRole: NirvanaLandmarkCollisionRole;
  readonly visuals: readonly NirvanaLandmarkVisualPlacement[];
}

export interface NirvanaQuietClearing {
  readonly id: "social-meadow" | "western-home" | "eastern-home" | "southern-growth";
  readonly bounds: NirvanaTileRectangle;
}

export interface NirvanaChunkConnector {
  readonly edge: NirvanaCardinalDirection;
  /** Row for east/west edges; column for north/south edges. */
  readonly offset: number;
}

export interface NirvanaChunk {
  readonly coord: NirvanaChunkCoord;
  readonly columns: 48;
  readonly rows: 32;
  readonly terrainCells: readonly NirvanaTerrainCell[];
  readonly roadCells: readonly NirvanaRoadCell[];
  readonly roadHub: NirvanaTileCoordinate;
  readonly landmarks: readonly NirvanaLandmarkPlacement[];
  readonly scenery: readonly NirvanaScenerySprite[];
  readonly quietClearings: readonly NirvanaQuietClearing[];
  readonly collision: readonly (0 | 1)[];
  readonly connectors: readonly NirvanaChunkConnector[];
  readonly contentHash: string;
}

export interface NirvanaChunkInput extends Omit<NirvanaChunk, "contentHash"> {
  readonly contentHash?: string;
}

export interface NirvanaWorldBounds {
  readonly minTileColumn: number;
  readonly minTileRow: number;
  readonly columns: number;
  readonly rows: number;
}

export interface NirvanaRegionV2 {
  readonly version: 2;
  readonly regionId: "nirvana";
  readonly chunks: ReadonlyMap<string, NirvanaChunk>;
  readonly bounds: NirvanaWorldBounds;
}

const CARDINAL_DIRECTIONS: readonly NirvanaCardinalDirection[] = Object.freeze([
  "north",
  "east",
  "south",
  "west",
]);

const NEIGHBORS: Readonly<Record<NirvanaCardinalDirection, Readonly<{
  column: number;
  row: number;
  reciprocal: NirvanaCardinalDirection;
}>>> = Object.freeze({
  north: Object.freeze({ column: 0, row: -1, reciprocal: "south" }),
  east: Object.freeze({ column: 1, row: 0, reciprocal: "west" }),
  south: Object.freeze({ column: 0, row: 1, reciprocal: "north" }),
  west: Object.freeze({ column: -1, row: 0, reciprocal: "east" }),
});

/** Return the canonical lookup key for one signed chunk coordinate. */
export function nirvanaChunkKey(coord: NirvanaChunkCoord): string {
  assertSafeInteger(coord.column, "chunk column");
  assertSafeInteger(coord.row, "chunk row");
  return `${coord.column},${coord.row}`;
}

/** Own, validate, and canonically hash one chunk without retaining caller data. */
export function createNirvanaChunk(input: NirvanaChunkInput): NirvanaChunk {
  const ownedCollision = validateChunkInput(input);
  const semantic = deepFreezeOwned({
    coord: { column: input.coord.column, row: input.coord.row },
    columns: NIRVANA_CHUNK_COLUMNS,
    rows: NIRVANA_CHUNK_ROWS,
    terrainCells: input.terrainCells,
    roadCells: input.roadCells,
    roadHub: input.roadHub,
    landmarks: input.landmarks,
    scenery: input.scenery,
    quietClearings: input.quietClearings,
    collision: ownedCollision,
    connectors: input.connectors,
  });
  const contentHash = stableContentHash(semantic);
  if (input.contentHash !== undefined && input.contentHash !== contentHash) {
    throw new Error("Nirvana chunk content hash does not match its canonical semantic content");
  }
  return Object.freeze({ ...semantic, contentHash });
}

/** Create one immutable production region whose first chunk is the root coordinate. */
export function createNirvanaRegion(root: NirvanaChunk): NirvanaRegionV2 {
  if (nirvanaChunkKey(root.coord) !== "0,0") {
    throw new Error("Nirvana region root chunk must use coordinate 0,0");
  }
  const ownedRoot = createNirvanaChunk(root);
  return createRegionValue([["0,0", ownedRoot]]);
}

/** Append one validated chunk while preserving all previously owned chunk objects. */
export function appendNirvanaChunk(
  region: NirvanaRegionV2,
  chunk: NirvanaChunk,
): NirvanaRegionV2 {
  const key = nirvanaChunkKey(chunk.coord);
  if (region.chunks.has(key)) {
    throw new Error(`Nirvana chunk coordinate is a duplicate: ${key}`);
  }
  const ownedChunk = createNirvanaChunk(chunk);
  let adjacent = false;
  for (const edge of CARDINAL_DIRECTIONS) {
    const neighbor = NEIGHBORS[edge];
    const neighborKey = nirvanaChunkKey({
      column: ownedChunk.coord.column + neighbor.column,
      row: ownedChunk.coord.row + neighbor.row,
    });
    const occupiedNeighbor = region.chunks.get(neighborKey);
    if (occupiedNeighbor === undefined) continue;
    adjacent = true;
    validateReciprocalSeam(
      ownedChunk,
      edge,
      occupiedNeighbor,
      neighbor.reciprocal,
    );
  }
  if (!adjacent) {
    throw new Error("Nirvana chunks must append at a cardinally adjacent coordinate");
  }
  return createRegionValue([...region.chunks, [key, ownedChunk]]);
}

function createRegionValue(
  entries: readonly (readonly [string, NirvanaChunk])[],
): NirvanaRegionV2 {
  const chunks = immutableMap(entries);
  return Object.freeze({
    version: 2,
    regionId: "nirvana",
    chunks,
    bounds: deriveBounds(chunks),
  });
}

function validateChunkInput(input: NirvanaChunkInput): readonly (0 | 1)[] {
  nirvanaChunkKey(input.coord);
  if (input.columns !== NIRVANA_CHUNK_COLUMNS || input.rows !== NIRVANA_CHUNK_ROWS) {
    throw new Error("Nirvana chunks must preserve exact 48x32 local dimensions");
  }
  if (!Array.isArray(input.collision)) {
    throw new Error("Nirvana chunk collision must be an actual array");
  }
  if (input.collision.length !== NIRVANA_CHUNK_COLUMNS * NIRVANA_CHUNK_ROWS) {
    throw new Error("Nirvana chunk collision must contain exactly 1536 bytes");
  }
  const ownedCollision: (0 | 1)[] = [];
  for (let index = 0; index < input.collision.length; index += 1) {
    if (!Object.hasOwn(input.collision, index)) {
      throw new Error(`Nirvana chunk collision index ${index} must contain 0 or 1`);
    }
    const value = input.collision[index];
    if (value !== 0 && value !== 1) {
      throw new Error(`Nirvana chunk collision index ${index} must contain 0 or 1`);
    }
    ownedCollision.push(value);
  }
  if (input.terrainCells.length !== NIRVANA_CHUNK_COLUMNS * NIRVANA_CHUNK_ROWS) {
    throw new Error("Nirvana chunk terrain must contain exactly 1536 local cells");
  }
  const terrainTiles = new Set<string>();
  for (const cell of input.terrainCells) {
    const key = validateLocalTile(cell.tile, "terrain");
    if (terrainTiles.has(key)) throw new Error(`Nirvana terrain contains duplicate tile ${key}`);
    terrainTiles.add(key);
    validateDirections(cell.connections ?? [], "terrain");
    assertNonNegativeInteger(cell.variant, "terrain variant");
    if (typeof cell.base !== "string" || cell.base.length === 0) {
      throw new Error(`Nirvana terrain cell ${key} must name a base material`);
    }
    if (!Array.isArray(cell.overlays) || !Array.isArray(cell.shorelines)) {
      throw new Error(`Nirvana terrain cell ${key} must own overlay and shoreline arrays`);
    }
    for (const overlay of [...cell.overlays, ...cell.shorelines]) {
      if (typeof overlay.material !== "string" || overlay.material.length === 0) {
        throw new Error(`Nirvana terrain overlay at ${key} must name a material`);
      }
      assertNonNegativeInteger(overlay.variant, "terrain overlay variant");
      if (!Number.isSafeInteger(overlay.mask) || overlay.mask < 1 || overlay.mask > 15) {
        throw new Error(`Nirvana terrain overlay at ${key} must carry a 1..15 corner mask`);
      }
    }
  }

  const sceneryIds = new Set<string>();
  for (const sprite of input.scenery) {
    if (typeof sprite.id !== "string" || sprite.id.length === 0) {
      throw new Error("Nirvana scenery sprite must carry a non-empty ID");
    }
    if (sceneryIds.has(sprite.id)) {
      throw new Error(`Nirvana scenery contains duplicate ID ${sprite.id}`);
    }
    sceneryIds.add(sprite.id);
    if (typeof sprite.frameId !== "string" || sprite.frameId.length === 0) {
      throw new Error(`Nirvana scenery sprite ${sprite.id} must name a frame`);
    }
    validateLocalTile(sprite.tile, "scenery");
    assertFiniteInteger(sprite.at.x, "scenery x");
    assertFiniteInteger(sprite.at.y, "scenery y");
    assertFiniteInteger(sprite.foot.x, "scenery foot x");
    assertFiniteInteger(sprite.foot.y, "scenery foot y");
    if (typeof sprite.blocksMovement !== "boolean") {
      throw new Error(`Nirvana scenery sprite ${sprite.id} must declare blocksMovement`);
    }
    if (sprite.blocksMovement
      && ownedCollision[sprite.tile.row * NIRVANA_CHUNK_COLUMNS + sprite.tile.column] !== 1) {
      throw new Error(
        `Nirvana blocking scenery ${sprite.id} must occupy closed collision at its own tile`,
      );
    }
  }
  for (const road of input.roadCells) {
    validateLocalTile(road.tile, "road");
    validateDirections(road.connections, "road");
  }
  validateLocalTile(input.roadHub, "road hub");

  const landmarkIds = new Set<string>();
  const visualIds = new Set<string>();
  for (const landmark of input.landmarks) {
    if (landmarkIds.has(landmark.id)) {
      throw new Error(`Nirvana landmarks contain duplicate ID ${landmark.id}`);
    }
    landmarkIds.add(landmark.id);
    validateLocalTile(landmark.tile, "landmark");
    validateLocalRectangle(landmark.bounds, "landmark bounds");
    for (const tile of landmark.collisionTiles) validateLocalTile(tile, "landmark collision");
    for (const visual of landmark.visuals) {
      if (visualIds.has(visual.id)) {
        throw new Error(`Nirvana landmark visuals contain duplicate ID ${visual.id}`);
      }
      visualIds.add(visual.id);
      assertFiniteInteger(visual.at.x, "landmark visual x");
      assertFiniteInteger(visual.at.y, "landmark visual y");
    }
  }
  const clearingIds = new Set<string>();
  for (const clearing of input.quietClearings) {
    if (clearingIds.has(clearing.id)) {
      throw new Error(`Nirvana clearings contain duplicate ID ${clearing.id}`);
    }
    clearingIds.add(clearing.id);
    validateLocalRectangle(clearing.bounds, "quiet clearing");
  }

  const connectorKeys = new Set<string>();
  for (const connector of input.connectors) {
    if (!CARDINAL_DIRECTIONS.includes(connector.edge)) {
      throw new Error("Nirvana chunk connector edge must be cardinal");
    }
    assertSafeInteger(connector.offset, "connector offset");
    const extent = connector.edge === "north" || connector.edge === "south"
      ? NIRVANA_CHUNK_COLUMNS
      : NIRVANA_CHUNK_ROWS;
    if (connector.offset < 0 || connector.offset >= extent) {
      throw new Error(`Nirvana chunk connector offset must be within 0..${extent - 1}`);
    }
    const key = `${connector.edge}:${connector.offset}`;
    if (connectorKeys.has(key)) throw new Error(`Nirvana chunk has duplicate connector ${key}`);
    connectorKeys.add(key);
    const tile = connectorTile(connector);
    const collisionIndex = tile.row * NIRVANA_CHUNK_COLUMNS + tile.column;
    if (ownedCollision[collisionIndex] !== 0) {
      throw new Error(`Nirvana chunk connector ${key} must occupy open collision`);
    }
  }
  return ownedCollision;
}

function validateLocalTile(tile: NirvanaTileCoordinate, label: string): string {
  assertSafeInteger(tile.column, `${label} tile column`);
  assertSafeInteger(tile.row, `${label} tile row`);
  if (
    tile.column < 0
    || tile.column >= NIRVANA_CHUNK_COLUMNS
    || tile.row < 0
    || tile.row >= NIRVANA_CHUNK_ROWS
  ) {
    throw new Error(`Nirvana ${label} tile is outside local bounds`);
  }
  return `${tile.column},${tile.row}`;
}

function validateLocalRectangle(bounds: NirvanaTileRectangle, label: string): void {
  validateLocalTile(bounds, label);
  assertSafeInteger(bounds.columns, `${label} columns`);
  assertSafeInteger(bounds.rows, `${label} rows`);
  if (
    bounds.columns <= 0
    || bounds.rows <= 0
    || bounds.column + bounds.columns > NIRVANA_CHUNK_COLUMNS
    || bounds.row + bounds.rows > NIRVANA_CHUNK_ROWS
  ) {
    throw new Error(`Nirvana ${label} is outside local bounds`);
  }
}

function validateDirections(
  directions: readonly NirvanaCardinalDirection[],
  label: string,
): void {
  const unique = new Set<NirvanaCardinalDirection>();
  for (const direction of directions) {
    if (!CARDINAL_DIRECTIONS.includes(direction)) {
      throw new Error(`Nirvana ${label} connection must be cardinal`);
    }
    if (unique.has(direction)) {
      throw new Error(`Nirvana ${label} contains duplicate ${direction} connection`);
    }
    unique.add(direction);
  }
}

function connectorTile(connector: NirvanaChunkConnector): NirvanaTileCoordinate {
  switch (connector.edge) {
    case "north": return { column: connector.offset, row: 0 };
    case "east": return { column: NIRVANA_CHUNK_COLUMNS - 1, row: connector.offset };
    case "south": return { column: connector.offset, row: NIRVANA_CHUNK_ROWS - 1 };
    case "west": return { column: 0, row: connector.offset };
  }
}

function validateReciprocalSeam(
  chunk: NirvanaChunk,
  edge: NirvanaCardinalDirection,
  neighbor: NirvanaChunk,
  reciprocal: NirvanaCardinalDirection,
): void {
  const offsets = chunk.connectors
    .filter((connector) => connector.edge === edge)
    .map((connector) => connector.offset);
  const reciprocalOffsets = neighbor.connectors
    .filter((connector) => connector.edge === reciprocal)
    .map((connector) => connector.offset);
  if (
    offsets.length !== reciprocalOffsets.length
    || offsets.some((offset) => !reciprocalOffsets.includes(offset))
  ) {
    throw new Error(
      `Nirvana occupied seam requires exactly reciprocal connectors between ${nirvanaChunkKey(chunk.coord)} and ${nirvanaChunkKey(neighbor.coord)}`,
    );
  }
}

function deriveBounds(chunks: ReadonlyMap<string, NirvanaChunk>): NirvanaWorldBounds {
  const values = [...chunks.values()];
  const minimumChunkColumn = Math.min(...values.map(({ coord }) => coord.column));
  const minimumChunkRow = Math.min(...values.map(({ coord }) => coord.row));
  const maximumChunkColumn = Math.max(...values.map(({ coord }) => coord.column));
  const maximumChunkRow = Math.max(...values.map(({ coord }) => coord.row));
  return Object.freeze({
    minTileColumn: minimumChunkColumn * NIRVANA_CHUNK_COLUMNS,
    minTileRow: minimumChunkRow * NIRVANA_CHUNK_ROWS,
    columns: (maximumChunkColumn - minimumChunkColumn + 1) * NIRVANA_CHUNK_COLUMNS,
    rows: (maximumChunkRow - minimumChunkRow + 1) * NIRVANA_CHUNK_ROWS,
  });
}

function stableContentHash(value: unknown): string {
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

function deepFreezeOwned<T>(value: T): T {
  if (Array.isArray(value)) {
    return Object.freeze(value.map((item) => deepFreezeOwned(item))) as T;
  }
  if (value !== null && typeof value === "object") {
    return Object.freeze(Object.fromEntries(
      Object.entries(value as Readonly<Record<string, unknown>>)
        .map(([key, nested]) => [key, deepFreezeOwned(nested)]),
    )) as T;
  }
  return value;
}

function immutableMap<K, V>(
  entries: readonly (readonly [K, V])[],
): ReadonlyMap<K, V> {
  const source = new Map(entries);
  let view: ReadonlyMap<K, V>;
  view = Object.freeze({
    get size(): number {
      return source.size;
    },
    get(key: K): V | undefined {
      return source.get(key);
    },
    has(key: K): boolean {
      return source.has(key);
    },
    entries(): MapIterator<[K, V]> {
      return source.entries();
    },
    keys(): MapIterator<K> {
      return source.keys();
    },
    values(): MapIterator<V> {
      return source.values();
    },
    forEach(
      callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
      thisArg?: unknown,
    ): void {
      source.forEach((value, key) => callback.call(thisArg, value, key, view));
    },
    [Symbol.iterator](): MapIterator<[K, V]> {
      return source[Symbol.iterator]();
    },
    [Symbol.toStringTag]: "Map",
  });
  return view;
}

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) throw new Error(`Nirvana ${label} must be a safe integer`);
}

function assertFiniteInteger(value: number, label: string): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new Error(`Nirvana ${label} must be a finite integer`);
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Nirvana ${label} must be a non-negative safe integer`);
  }
}
