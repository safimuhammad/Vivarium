/** Deterministic macro-first authoring for Nirvana's five expansion chunks. */

import type { Rect } from "../../contracts";
import {
  NIRVANA_CHUNK_COLUMNS,
  NIRVANA_CHUNK_ROWS,
  NIRVANA_TILE_SIZE,
  createNirvanaChunk,
  type NirvanaCardinalDirection,
  type NirvanaChunk,
  type NirvanaChunkConnector,
  type NirvanaChunkCoord,
  type NirvanaLandmarkFeature,
  type NirvanaLandmarkFrameId,
  type NirvanaLandmarkPlacement,
  type NirvanaQuietClearing,
  type NirvanaRoadCell,
  type NirvanaScenerySprite,
  type NirvanaTerrainCell,
  type NirvanaTileCoordinate,
  type NirvanaTileRectangle,
} from "./NirvanaRegionV2";
import type { NirvanaMechanicsExclusions } from "./NirvanaInitialRegion";
import {
  nirvanaChunkCollisionFromField,
  nirvanaLandmarkForTerrain,
  nirvanaPlaceholderTerrainCell,
  nirvanaSceneryFromField,
  nirvanaTerrainCellsFromField,
  type NirvanaChannelCell,
  type NirvanaChunkGeometry,
} from "./NirvanaTerrainChunks";
import { nirvanaLandmarkRelocation } from "./NirvanaLandmarkRelocation";
import type { NirvanaTerrainField } from "./NirvanaTerrainField";

export type NirvanaChunkMacroRole =
  | "woodland-meadow-transition"
  | "old-road-social-clearing"
  | "dry-swale-ford-continuation"
  | "settlement-clearing-grove"
  | "open-southern-land";

export interface NirvanaAuthoredChunk {
  readonly chunk: NirvanaChunk;
  readonly role: NirvanaChunkMacroRole;
  /** Hash of local semantics only; unlike contentHash, it excludes chunk coord. */
  readonly semanticDigest: string;
}

export const NIRVANA_AUTHORED_CHUNK_COORDS: readonly NirvanaChunkCoord[] = Object.freeze([
  Object.freeze({ column: 1, row: 0 }),
  Object.freeze({ column: 0, row: 1 }),
  Object.freeze({ column: 1, row: 1 }),
  Object.freeze({ column: 0, row: 2 }),
  Object.freeze({ column: 1, row: 2 }),
]);

const CARDINAL_STEPS: readonly Readonly<{
  direction: NirvanaCardinalDirection;
  columnDelta: number;
  rowDelta: number;
}>[] = Object.freeze([
  Object.freeze({ direction: "north", columnDelta: 0, rowDelta: -1 }),
  Object.freeze({ direction: "east", columnDelta: 1, rowDelta: 0 }),
  Object.freeze({ direction: "south", columnDelta: 0, rowDelta: 1 }),
  Object.freeze({ direction: "west", columnDelta: -1, rowDelta: 0 }),
]);

/**
 * Declare one authored chunk's geometry WITHOUT building, validating or hashing a chunk.
 *
 * The terrain field's first pass needs only the authoring's declaration — roads, dry
 * channels, connectors, landmarks — and building a placeholder chunk to read those back
 * cost a full validate-and-content-hash of 1,536 terrain cells per chunk, per recipe.
 */
export function nirvanaAuthoredChunkGeometry(coord: NirvanaChunkCoord): NirvanaChunkGeometry {
  const blueprint = blueprintFor(coord);
  const swale = createSwaleTiles(blueprint.role);
  const channelTiles: NirvanaTileCoordinate[] = [];
  for (const key of swale) {
    const [column, row] = key.split(",").map(Number);
    if (column === undefined || row === undefined) continue;
    channelTiles.push(tile(column, row));
  }
  return Object.freeze({
    coord: Object.freeze({ column: coord.column, row: coord.row }),
    roadTiles: Object.freeze([
      ...createRoadTiles(blueprint.roadHub, blueprint.connectors).values(),
    ]),
    channelTiles: Object.freeze(channelTiles),
    connectors: blueprint.connectors,
    landmarks: createLandmarks(blueprint.role),
    relocations: createRelocations(coord, blueprint.role),
  });
}

/**
 * Author one locked semantic chunk and reject any mechanics overlap.
 *
 * @param field The region's genesis terrain field, or `null` on the geometry-declaring
 *   first pass (see `NirvanaTerrainChunks`). With a field the chunk publishes the
 *   approved river valley's tiles, scenery and walkability, and publishes each authored
 *   macro landmark at whichever home the field cleared — authored ground first, its
 *   authored alternative second, retired only when the river has taken both.
 */
export function createNirvanaAuthoredChunk(
  coord: NirvanaChunkCoord,
  exclusions: NirvanaMechanicsExclusions,
  field: NirvanaTerrainField | null = null,
): NirvanaAuthoredChunk {
  const blueprint = blueprintFor(coord);
  const roadTiles = createRoadTiles(blueprint.roadHub, blueprint.connectors);
  const swaleTiles = createSwaleTiles(blueprint.role);
  const channels = createChannelCells(swaleTiles);
  const relocations = createRelocations(coord, blueprint.role);
  const landmarks = Object.freeze(createLandmarks(blueprint.role)
    .map((placement) => nirvanaLandmarkForTerrain(field, coord, placement, relocations))
    .filter((placement): placement is NirvanaLandmarkPlacement => placement !== null));
  assertNirvanaLandmarksClearOfMechanics(coord, landmarks, exclusions);
  const scenery: readonly NirvanaScenerySprite[] = field === null
    ? Object.freeze([])
    : nirvanaSceneryFromField(field, coord);
  const collision = field === null
    ? createCollision(landmarks)
    : nirvanaChunkCollisionFromField(field, coord, landmarks, scenery);
  assertRoadsRemainOpen(roadTiles, collision);
  const chunk = createNirvanaChunk({
    coord,
    columns: NIRVANA_CHUNK_COLUMNS,
    rows: NIRVANA_CHUNK_ROWS,
    terrainCells: createTerrainCells(coord, channels, field),
    roadCells: createRoadCells(roadTiles, swaleTiles),
    roadHub: blueprint.roadHub,
    landmarks,
    scenery,
    quietClearings: createQuietClearings(blueprint.role),
    collision,
    connectors: blueprint.connectors,
  });
  return Object.freeze({
    chunk,
    role: blueprint.role,
    semanticDigest: nirvanaChunkLocalSemanticDigest(chunk),
  });
}

/** Hash one chunk's normalized local semantic payload, excluding its coordinate. */
export function nirvanaChunkLocalSemanticDigest(chunk: NirvanaChunk): string {
  return stableHash({
    columns: chunk.columns,
    rows: chunk.rows,
    terrainCells: chunk.terrainCells,
    roadCells: chunk.roadCells,
    roadHub: chunk.roadHub,
    landmarks: chunk.landmarks,
    scenery: chunk.scenery,
    quietClearings: chunk.quietClearings,
    collision: chunk.collision,
    connectors: chunk.connectors,
  });
}

interface ChunkBlueprint {
  readonly role: NirvanaChunkMacroRole;
  readonly roadHub: NirvanaTileCoordinate;
  readonly connectors: readonly NirvanaChunkConnector[];
}

function blueprintFor(coord: NirvanaChunkCoord): ChunkBlueprint {
  switch (`${coord.column},${coord.row}`) {
    case "1,0":
      return frozenBlueprint("woodland-meadow-transition", tile(24, 16), [
        connector("north", 36), connector("east", 14), connector("south", 20), connector("west", 16),
      ]);
    case "0,1":
      return frozenBlueprint("old-road-social-clearing", tile(25, 18), [
        connector("north", 25), connector("east", 18), connector("south", 24),
      ]);
    case "1,1":
      return frozenBlueprint("dry-swale-ford-continuation", tile(32, 16), [
        connector("north", 20), connector("south", 22), connector("west", 18),
      ]);
    case "0,2":
      return frozenBlueprint("settlement-clearing-grove", tile(24, 17), [
        connector("north", 24), connector("east", 17),
      ]);
    case "1,2":
      return frozenBlueprint("open-southern-land", tile(22, 17), [
        connector("north", 22), connector("south", 36), connector("west", 17),
      ]);
    default:
      throw new Error(`Nirvana authored chunk coordinate is not locked: ${coord.column},${coord.row}`);
  }
}

function frozenBlueprint(
  role: NirvanaChunkMacroRole,
  roadHub: NirvanaTileCoordinate,
  connectors: readonly NirvanaChunkConnector[],
): ChunkBlueprint {
  return Object.freeze({ role, roadHub, connectors: Object.freeze([...connectors]) });
}

function connector(
  edge: NirvanaCardinalDirection,
  offset: number,
): NirvanaChunkConnector {
  return Object.freeze({ edge, offset });
}

function tile(column: number, row: number): NirvanaTileCoordinate {
  return Object.freeze({ column, row });
}

function rectangle(
  column: number,
  row: number,
  columns: number,
  rows: number,
): NirvanaTileRectangle {
  return Object.freeze({ column, row, columns, rows });
}

function rectangleTiles(bounds: NirvanaTileRectangle): readonly NirvanaTileCoordinate[] {
  const result: NirvanaTileCoordinate[] = [];
  for (let row = bounds.row; row < bounds.row + bounds.rows; row += 1) {
    for (let column = bounds.column; column < bounds.column + bounds.columns; column += 1) {
      result.push(tile(column, row));
    }
  }
  return Object.freeze(result);
}

function gardenWallTiles(bounds: NirvanaTileRectangle): readonly NirvanaTileCoordinate[] {
  return Object.freeze(rectangleTiles(bounds).filter(({ column, row }) => {
    const edge = column === bounds.column
      || column === bounds.column + bounds.columns - 1
      || row === bounds.row
      || row === bounds.row + bounds.rows - 1;
    const gate = row === bounds.row + bounds.rows - 1
      && (column === bounds.column + 3 || column === bounds.column + 4);
    return edge && !gate;
  }));
}

function createRoadTiles(
  hub: NirvanaTileCoordinate,
  connectors: readonly NirvanaChunkConnector[],
): ReadonlyMap<string, NirvanaTileCoordinate> {
  const roads = new Map<string, NirvanaTileCoordinate>();
  for (const port of connectors) {
    const edgeTile = connectorTile(port);
    const elbow = port.edge === "north" || port.edge === "south"
      ? tile(edgeTile.column, hub.row)
      : tile(hub.column, edgeTile.row);
    traceOrthogonal([edgeTile, elbow, hub], roads);
  }
  return roads;
}

function connectorTile(value: NirvanaChunkConnector): NirvanaTileCoordinate {
  switch (value.edge) {
    case "north": return tile(value.offset, 0);
    case "east": return tile(NIRVANA_CHUNK_COLUMNS - 1, value.offset);
    case "south": return tile(value.offset, NIRVANA_CHUNK_ROWS - 1);
    case "west": return tile(0, value.offset);
  }
}

function traceOrthogonal(
  points: readonly NirvanaTileCoordinate[],
  destination: Map<string, NirvanaTileCoordinate>,
): void {
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]!;
    const end = points[index]!;
    if (start.column !== end.column && start.row !== end.row) {
      throw new Error("Nirvana authored roads require orthogonal segments");
    }
    const dc = Math.sign(end.column - start.column);
    const dr = Math.sign(end.row - start.row);
    let column = start.column;
    let row = start.row;
    while (true) {
      const current = tile(column, row);
      destination.set(tileKey(current), current);
      if (column === end.column && row === end.row) break;
      column += dc;
      row += dr;
    }
  }
}

function createSwaleTiles(role: NirvanaChunkMacroRole): ReadonlySet<string> {
  if (role !== "dry-swale-ford-continuation") return new Set<string>();
  return new Set(Array.from({ length: NIRVANA_CHUNK_ROWS }, (_, row) => `30,${row}`));
}

function createRoadCells(
  roads: ReadonlyMap<string, NirvanaTileCoordinate>,
  swale: ReadonlySet<string>,
): readonly NirvanaRoadCell[] {
  return Object.freeze([...roads.values()]
    .sort((left, right) => left.row - right.row || left.column - right.column)
    .map((coordinate) => Object.freeze({
      tile: coordinate,
      connections: Object.freeze(CARDINAL_STEPS
        .filter(({ columnDelta, rowDelta }) => roads.has(tileKey({
          column: coordinate.column + columnDelta,
          row: coordinate.row + rowDelta,
        })))
        .map(({ direction }) => direction)),
      surface: swale.has(tileKey(coordinate)) ? "ford" as const : "dirt" as const,
    })));
}

/** The authored dry channel: a swale line, forded where it meets the east-west road. */
function createChannelCells(
  swale: ReadonlySet<string>,
): ReadonlyMap<string, NirvanaChannelCell> {
  const channels = new Map<string, NirvanaChannelCell>();
  for (const key of swale) {
    const [column, row] = key.split(",").map(Number);
    if (column === undefined || row === undefined) continue;
    const coordinate = tile(column, row);
    channels.set(key, Object.freeze({
      kind: row === 16 ? "ford" : "dry-swale",
      connections: swaleConnections(coordinate, swale),
    }));
  }
  return channels;
}

function createTerrainCells(
  coord: NirvanaChunkCoord,
  channels: ReadonlyMap<string, NirvanaChannelCell>,
  field: NirvanaTerrainField | null,
): readonly NirvanaTerrainCell[] {
  if (field !== null) return nirvanaTerrainCellsFromField(field, coord, channels);
  const cells: NirvanaTerrainCell[] = [];
  for (let row = 0; row < NIRVANA_CHUNK_ROWS; row += 1) {
    for (let column = 0; column < NIRVANA_CHUNK_COLUMNS; column += 1) {
      const coordinate = tile(column, row);
      cells.push(nirvanaPlaceholderTerrainCell(
        coordinate,
        channels.get(tileKey(coordinate)),
      ));
    }
  }
  return Object.freeze(cells);
}

function swaleConnections(
  coordinate: NirvanaTileCoordinate,
  swale: ReadonlySet<string>,
): readonly NirvanaCardinalDirection[] {
  return Object.freeze(CARDINAL_STEPS
    .filter(({ direction, columnDelta, rowDelta }) => {
      if (swale.has(tileKey({
        column: coordinate.column + columnDelta,
        row: coordinate.row + rowDelta,
      }))) return true;
      return (direction === "north" && coordinate.row === 0)
        || (direction === "south" && coordinate.row === NIRVANA_CHUNK_ROWS - 1);
    })
    .map(({ direction }) => direction));
}

/**
 * One authored macro landmark, expressed so it can be rebuilt at different bounds.
 *
 * A relocated landmark goes through the SAME constructor as its authored self, so it
 * keeps its feature, its frame, its collision rule and its scale; only its bounds change.
 */
interface AuthoredLandmarkSpec {
  readonly id: string;
  readonly bounds: NirvanaTileRectangle;
  readonly build: (id: string, bounds: NirvanaTileRectangle) => NirvanaLandmarkPlacement;
}

function forestSpec(
  id: string,
  bounds: NirvanaTileRectangle,
  variant: 0 | 1,
): AuthoredLandmarkSpec {
  return Object.freeze({
    id,
    bounds,
    build: (specId: string, specBounds: NirvanaTileRectangle): NirvanaLandmarkPlacement =>
      forest(specId, specBounds, variant),
  });
}

function gardenSpec(id: string, bounds: NirvanaTileRectangle): AuthoredLandmarkSpec {
  return Object.freeze({ id, bounds, build: garden });
}

function landmarkSpecs(role: NirvanaChunkMacroRole): readonly AuthoredLandmarkSpec[] {
  switch (role) {
    case "woodland-meadow-transition":
      return Object.freeze([
        forestSpec("transition-grove-north", rectangle(8, 3, 4, 4), 0),
        forestSpec("transition-grove-east-high", rectangle(38, 5, 4, 4), 1),
        forestSpec("transition-grove-east-low", rectangle(39, 22, 4, 4), 0),
      ]);
    case "old-road-social-clearing":
      return Object.freeze([
        forestSpec("old-road-grove-west-high", rectangle(3, 3, 4, 4), 1),
        forestSpec("old-road-grove-west-mid", rectangle(4, 12, 4, 4), 0),
        forestSpec("old-road-grove-west-low", rectangle(5, 23, 4, 4), 1),
      ]);
    case "dry-swale-ford-continuation":
      return Object.freeze([
        forestSpec("ford-grove-east-high", rectangle(38, 3, 4, 4), 0),
        forestSpec("ford-grove-east-low", rectangle(39, 23, 4, 4), 1),
      ]);
    case "settlement-clearing-grove":
      return Object.freeze([
        forestSpec("settlement-grove-west-high", rectangle(2, 4, 4, 4), 1),
        gardenSpec("settlement-ruined-garden", rectangle(4, 17, 8, 8)),
        forestSpec("settlement-grove-west-low", rectangle(12, 23, 4, 4), 0),
      ]);
    case "open-southern-land":
      return Object.freeze([
        forestSpec("southern-grove-east", rectangle(38, 18, 4, 4), 1),
        forestSpec("southern-grove-low", rectangle(20, 25, 4, 4), 0),
      ]);
  }
}

function createLandmarks(role: NirvanaChunkMacroRole): readonly NirvanaLandmarkPlacement[] {
  return Object.freeze(landmarkSpecs(role).map(({ id, bounds, build }) => build(id, bounds)));
}

/**
 * Rebuild this chunk's relocatable landmarks at their authored ALTERNATIVE homes.
 *
 * Offered to the terrain field alongside the authored placements so a landmark whose
 * ground the river took is moved rather than dropped. See `NirvanaLandmarkRelocation`.
 */
function createRelocations(
  coord: NirvanaChunkCoord,
  role: NirvanaChunkMacroRole,
): ReadonlyMap<string, NirvanaLandmarkPlacement> {
  const relocations = new Map<string, NirvanaLandmarkPlacement>();
  for (const { id, build } of landmarkSpecs(role)) {
    const alternative = nirvanaLandmarkRelocation(coord, id);
    if (alternative === null) continue;
    relocations.set(id, build(id, alternative.bounds));
  }
  return relocations;
}

function forest(
  id: string,
  bounds: NirvanaTileRectangle,
  variant: 0 | 1,
): NirvanaLandmarkPlacement {
  return landmark(
    id,
    "woodland",
    `landmark.forest-edge.cluster.${variant}`,
    bounds,
    rectangleTiles(bounds),
  );
}

function garden(id: string, bounds: NirvanaTileRectangle): NirvanaLandmarkPlacement {
  return landmark(id, "ruined-garden", "landmark.ruined-garden", bounds, gardenWallTiles(bounds), 2);
}

function landmark(
  id: string,
  feature: NirvanaLandmarkFeature,
  frameId: NirvanaLandmarkFrameId,
  bounds: NirvanaTileRectangle,
  collisionTiles: readonly NirvanaTileCoordinate[],
  scale: 1 | 2 = 1,
): NirvanaLandmarkPlacement {
  return Object.freeze({
    id,
    feature,
    frameId,
    tile: tile(bounds.column, bounds.row),
    bounds,
    blocksMovement: collisionTiles.length > 0,
    collisionTiles: Object.freeze([...collisionTiles]),
    collisionRole: "visual-footprint",
    visuals: Object.freeze([Object.freeze({
      id: `${id}-visual`,
      frameId,
      at: Object.freeze({
        x: bounds.column * NIRVANA_TILE_SIZE,
        y: bounds.row * NIRVANA_TILE_SIZE,
      }),
      scale,
    })]),
  });
}

function createQuietClearings(role: NirvanaChunkMacroRole): readonly NirvanaQuietClearing[] {
  switch (role) {
    case "woodland-meadow-transition":
      return Object.freeze([clearing("social-meadow", rectangle(15, 10, 15, 10))]);
    case "old-road-social-clearing":
      return Object.freeze([clearing("social-meadow", rectangle(16, 9, 16, 11))]);
    case "dry-swale-ford-continuation":
      return Object.freeze([clearing("eastern-home", rectangle(12, 20, 12, 7))]);
    case "settlement-clearing-grove":
      return Object.freeze([clearing("western-home", rectangle(16, 18, 15, 9))]);
    case "open-southern-land":
      return Object.freeze([clearing("southern-growth", rectangle(10, 8, 20, 12))]);
  }
}

function clearing(
  id: NirvanaQuietClearing["id"],
  bounds: NirvanaTileRectangle,
): NirvanaQuietClearing {
  return Object.freeze({ id, bounds });
}

function createCollision(
  landmarks: readonly NirvanaLandmarkPlacement[],
): readonly (0 | 1)[] {
  const collision = Array.from(
    { length: NIRVANA_CHUNK_COLUMNS * NIRVANA_CHUNK_ROWS },
    () => 0 as 0 | 1,
  );
  for (const placement of landmarks) {
    for (const coordinate of placement.collisionTiles) {
      collision[coordinate.row * NIRVANA_CHUNK_COLUMNS + coordinate.column] = 1;
    }
  }
  return Object.freeze(collision);
}

function assertRoadsRemainOpen(
  roads: ReadonlyMap<string, NirvanaTileCoordinate>,
  collision: readonly (0 | 1)[],
): void {
  for (const coordinate of roads.values()) {
    if (collision[coordinate.row * NIRVANA_CHUNK_COLUMNS + coordinate.column] === 1) {
      throw new Error(`Nirvana authored road overlaps landmark at ${tileKey(coordinate)}`);
    }
  }
}

/** Reject full visual and collision envelopes that overlap mechanics obligations. */
export function assertNirvanaLandmarksClearOfMechanics(
  coord: NirvanaChunkCoord,
  landmarks: readonly NirvanaLandmarkPlacement[],
  exclusions: NirvanaMechanicsExclusions,
): void {
  const obligations = mechanicsTiles(exclusions);
  const originColumn = coord.column * NIRVANA_CHUNK_COLUMNS;
  const originRow = coord.row * NIRVANA_CHUNK_ROWS;
  const originX = originColumn * NIRVANA_TILE_SIZE;
  const originY = originRow * NIRVANA_TILE_SIZE;

  for (const placement of landmarks) {
    for (const local of placement.collisionTiles) {
      const global = tile(local.column + originColumn, local.row + originRow);
      if (obligations.has(tileKey(global))) {
        throw new Error(`Nirvana landmark ${placement.id} overlaps mechanics exclusion ${tileKey(global)}`);
      }
      const cellRect = tileRect(global);
      if (exclusions.visualRects.some((rect) => rectsOverlap(cellRect, rect))) {
        throw new Error(`Nirvana landmark ${placement.id} collision overlaps mechanics exclusion envelope`);
      }
    }
    for (const visual of placement.visuals) {
      const visualRect = {
        x: originX + visual.at.x,
        y: originY + visual.at.y,
        width: 128 * visual.scale,
        height: 128 * visual.scale,
      };
      if (exclusions.visualRects.some((rect) => rectsOverlap(visualRect, rect))) {
        throw new Error(`Nirvana landmark ${placement.id} visual overlaps mechanics exclusion envelope`);
      }
    }
  }
}

function mechanicsTiles(exclusions: NirvanaMechanicsExclusions): ReadonlySet<string> {
  const result = new Set(exclusions.hardTiles);
  for (const plot of exclusions.shelterPlots) {
    result.add(tileKey(plot.tile));
    result.add(tileKey(plot.door));
  }
  for (const point of exclusions.stagingPoints) {
    result.add(`${Math.floor(point.x / NIRVANA_TILE_SIZE)},${Math.floor(point.y / NIRVANA_TILE_SIZE)}`);
  }
  for (const anchor of exclusions.anchors) result.add(tileKey(anchor));
  for (const gate of exclusions.gates) result.add(tileKey(gate.tile));
  return result;
}

function tileRect(coordinate: NirvanaTileCoordinate): Rect {
  return {
    x: coordinate.column * NIRVANA_TILE_SIZE,
    y: coordinate.row * NIRVANA_TILE_SIZE,
    width: NIRVANA_TILE_SIZE,
    height: NIRVANA_TILE_SIZE,
  };
}

function rectsOverlap(left: Rect, right: Rect): boolean {
  return left.x < right.x + right.width && left.x + left.width > right.x
    && left.y < right.y + right.height && left.y + left.height > right.y;
}

function tileKey(coordinate: NirvanaTileCoordinate): string {
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
