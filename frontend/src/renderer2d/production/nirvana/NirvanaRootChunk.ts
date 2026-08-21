/** Production-owned semantic authoring for Nirvana's approved root chunk. */

import {
  NIRVANA_CHUNK_COLUMNS,
  NIRVANA_CHUNK_ROWS,
  NIRVANA_TILE_SIZE,
  createNirvanaChunk,
  type NirvanaCardinalDirection,
  type NirvanaChunk,
  type NirvanaChunkConnector,
  type NirvanaLandmarkCollisionRole,
  type NirvanaLandmarkFeature,
  type NirvanaLandmarkFrameId,
  type NirvanaLandmarkPlacement,
  type NirvanaLandmarkVisualPlacement,
  type NirvanaQuietClearing,
  type NirvanaRoadCell,
  type NirvanaScenerySprite,
  type NirvanaTerrainCell,
  type NirvanaTileCoordinate,
  type NirvanaTileRectangle,
} from "./NirvanaRegionV2";
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

export const NIRVANA_ROOT_CAMERA_START = Object.freeze({ x: 896, y: 270 });

const SCENE_COLUMNS = NIRVANA_CHUNK_COLUMNS;
const SCENE_ROWS = NIRVANA_CHUNK_ROWS;
const ROAD_HUB = Object.freeze({ column: 25, row: 18 });
const FORD_TILE = Object.freeze({ column: 25, row: 25 });
const NIRVANA_V2_REGION_SEED = 0x4e49_5256;
const WOODLAND_SLOT_STEP = 96;
const WOODLAND_FRAME_RADIUS = 64;

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

function tileKey(tile: NirvanaTileCoordinate): string {
  return `${tile.column},${tile.row}`;
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
  const tiles: NirvanaTileCoordinate[] = [];
  for (let row = bounds.row; row < bounds.row + bounds.rows; row += 1) {
    for (let column = bounds.column; column < bounds.column + bounds.columns; column += 1) {
      tiles.push(tile(column, row));
    }
  }
  return Object.freeze(tiles);
}

function gardenWallTiles(bounds: NirvanaTileRectangle): readonly NirvanaTileCoordinate[] {
  return Object.freeze(rectangleTiles(bounds).filter(({ column, row }) => {
    const onEdge = column === bounds.column
      || column === bounds.column + bounds.columns - 1
      || row === bounds.row
      || row === bounds.row + bounds.rows - 1;
    const openSouthGate = row === bounds.row + bounds.rows - 1
      && (column === bounds.column + 3 || column === bounds.column + 4);
    return onEdge && !openSouthGate;
  }));
}

function traceOrthogonalPath(
  points: readonly NirvanaTileCoordinate[],
): ReadonlyMap<string, NirvanaTileCoordinate> {
  const result = new Map<string, NirvanaTileCoordinate>();

  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1];
    const end = points[index];
    if (start.column !== end.column && start.row !== end.row) {
      throw new Error("Nirvana V2 semantic paths must use orthogonal segments");
    }

    const columnStep = Math.sign(end.column - start.column);
    const rowStep = Math.sign(end.row - start.row);
    let column = start.column;
    let row = start.row;
    while (true) {
      const current = tile(column, row);
      result.set(tileKey(current), current);
      if (column === end.column && row === end.row) break;
      column += columnStep;
      row += rowStep;
    }
  }

  if (points.length === 1) {
    result.set(tileKey(points[0]), tile(points[0].column, points[0].row));
  }
  return result;
}

function mergePaths(
  paths: readonly (readonly NirvanaTileCoordinate[])[],
): ReadonlyMap<string, NirvanaTileCoordinate> {
  const merged = new Map<string, NirvanaTileCoordinate>();
  for (const path of paths) {
    for (const [key, coordinate] of traceOrthogonalPath(path)) merged.set(key, coordinate);
  }
  return merged;
}

function createQuietClearings(): readonly NirvanaQuietClearing[] {
  return Object.freeze([
    Object.freeze({ id: "social-meadow", bounds: rectangle(21, 12, 8, 6) }),
    Object.freeze({ id: "western-home", bounds: rectangle(10, 19, 9, 5) }),
    Object.freeze({ id: "eastern-home", bounds: rectangle(30, 19, 9, 5) }),
    Object.freeze({ id: "southern-growth", bounds: rectangle(21, 27, 8, 4) }),
  ]);
}

function createRoadTiles(): ReadonlyMap<string, NirvanaTileCoordinate> {
  return mergePaths([
    [
      tile(25, 18), tile(20, 18), tile(20, 17), tile(15, 17), tile(15, 16),
      tile(10, 16), tile(10, 15), tile(5, 15), tile(5, 14), tile(0, 14),
    ],
    [
      tile(25, 18), tile(25, 17), tile(31, 17), tile(31, 16), tile(37, 16),
      tile(37, 15), tile(43, 15), tile(43, 16), tile(47, 16),
    ],
    [tile(25, 18), tile(25, 31)],
    [tile(31, 16), tile(36, 16), tile(36, 13)],
  ]);
}

function createSwaleTiles(): ReadonlyMap<string, NirvanaTileCoordinate> {
  return traceOrthogonalPath([
    tile(0, 23), tile(11, 23), tile(11, 24), tile(23, 24),
    tile(23, 25), tile(35, 25), tile(35, 26), tile(47, 26),
  ]);
}

function terrainConnections(
  coordinate: NirvanaTileCoordinate,
  connectedTiles: ReadonlyMap<string, NirvanaTileCoordinate>,
): readonly NirvanaCardinalDirection[] {
  return Object.freeze(CARDINAL_STEPS
    .filter(({ direction, columnDelta, rowDelta }) => {
      const neighbor = {
        column: coordinate.column + columnDelta,
        row: coordinate.row + rowDelta,
      };
      if (connectedTiles.has(tileKey(neighbor))) return true;
      return (direction === "west" && coordinate.column === 0)
        || (direction === "east" && coordinate.column === SCENE_COLUMNS - 1)
        || (direction === "north" && coordinate.row === 0)
        || (direction === "south" && coordinate.row === SCENE_ROWS - 1);
    })
    .map(({ direction }) => direction));
}

/**
 * The authored dry channels: the swale line, and the one ford where the road crosses it.
 *
 * These tiles keep their channel identity on top of whatever the terrain field paints
 * underneath, which is what makes the dry riverbed read as a bed cut INTO the sward.
 */
function createChannelCells(
  swaleTiles: ReadonlyMap<string, NirvanaTileCoordinate>,
): ReadonlyMap<string, NirvanaChannelCell> {
  const channels = new Map<string, NirvanaChannelCell>();
  for (const coordinate of swaleTiles.values()) {
    const key = tileKey(coordinate);
    channels.set(key, Object.freeze({
      kind: key === tileKey(FORD_TILE) ? "ford" : "dry-swale",
      connections: terrainConnections(coordinate, swaleTiles),
    }));
  }
  return channels;
}

function createTerrainCells(
  channels: ReadonlyMap<string, NirvanaChannelCell>,
  field: NirvanaTerrainField | null,
): readonly NirvanaTerrainCell[] {
  if (field !== null) {
    return nirvanaTerrainCellsFromField(field, { column: 0, row: 0 }, channels);
  }
  const cells: NirvanaTerrainCell[] = [];
  for (let row = 0; row < SCENE_ROWS; row += 1) {
    for (let column = 0; column < SCENE_COLUMNS; column += 1) {
      const coordinate = tile(column, row);
      cells.push(nirvanaPlaceholderTerrainCell(
        coordinate,
        channels.get(tileKey(coordinate)),
      ));
    }
  }
  return Object.freeze(cells);
}

function createRoadCells(
  roadTiles: ReadonlyMap<string, NirvanaTileCoordinate>,
): readonly NirvanaRoadCell[] {
  const sortedTiles = [...roadTiles.values()].sort((first, second) =>
    first.row - second.row || first.column - second.column);

  return Object.freeze(sortedTiles.map((coordinate) => Object.freeze({
    tile: coordinate,
    connections: Object.freeze(CARDINAL_STEPS
      .filter(({ columnDelta, rowDelta }) => roadTiles.has(tileKey({
        column: coordinate.column + columnDelta,
        row: coordinate.row + rowDelta,
      })))
      .map(({ direction }) => direction)),
    surface: tileKey(coordinate) === tileKey(FORD_TILE) ? "ford" : "dirt",
  })));
}

function landmark(
  id: string,
  feature: NirvanaLandmarkFeature,
  frameId: NirvanaLandmarkFrameId,
  bounds: NirvanaTileRectangle,
  collisionTiles: readonly NirvanaTileCoordinate[] = rectangleTiles(bounds),
  options: Readonly<{
    visuals?: readonly NirvanaLandmarkVisualPlacement[];
    collisionRole?: NirvanaLandmarkCollisionRole;
  }> = {},
): NirvanaLandmarkPlacement {
  const visuals = options.visuals ?? Object.freeze([
    visual(
      `${id}-visual`,
      frameId,
      bounds.column * NIRVANA_TILE_SIZE,
      bounds.row * NIRVANA_TILE_SIZE,
    ),
  ]);
  return Object.freeze({
    id,
    feature,
    frameId,
    tile: tile(bounds.column, bounds.row),
    bounds,
    blocksMovement: collisionTiles.length > 0,
    collisionTiles: Object.freeze([...collisionTiles]),
    collisionRole: options.collisionRole ?? "visual-footprint",
    visuals: Object.freeze([...visuals]),
  });
}

function visual(
  id: string,
  frameId: NirvanaLandmarkFrameId,
  x: number,
  y: number,
  scale: 1 | 2 = 1,
): NirvanaLandmarkVisualPlacement {
  return Object.freeze({
    id,
    frameId,
    at: Object.freeze({ x: Math.round(x), y: Math.round(y) }),
    scale,
  });
}

function coordinateHash(
  edge: NirvanaCardinalDirection,
  slot: number,
  salt: number,
): number {
  const edgeSalt: Readonly<Record<NirvanaCardinalDirection, number>> = {
    north: 0x243f_6a88,
    east: 0x85a3_08d3,
    south: 0x1319_8a2e,
    west: 0x0370_7344,
  };
  let value = (
    NIRVANA_V2_REGION_SEED
    ^ edgeSalt[edge]
    ^ Math.imul(slot, 0x45d9_f3b)
    ^ Math.imul(salt, 0x119d_e1f3)
  ) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb_352d) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x846c_a68b) >>> 0;
  return (value ^ (value >>> 16)) >>> 0;
}

function woodlandSlots(start: number, end: number): readonly number[] {
  const slots: number[] = [];
  for (
    let slot = Math.ceil(start / WOODLAND_SLOT_STEP) * WOODLAND_SLOT_STEP;
    slot < end;
    slot += WOODLAND_SLOT_STEP
  ) {
    slots.push(slot);
  }
  return slots;
}

function woodlandEdgeVisual(
  edge: NirvanaCardinalDirection,
  slot: number,
  depthLayer: number,
): NirvanaLandmarkVisualPlacement {
  const alongJitter = coordinateHash(edge, slot, depthLayer * 3) % 129 - 64;
  const depthJitter = coordinateHash(edge, slot, depthLayer * 3 + 1) % 17;
  const horizontal = edge === "north" || edge === "south";
  const along = slot - WOODLAND_FRAME_RADIUS + alongJitter;
  const depth = (edge === "north" || edge === "west")
    ? -16 + depthJitter + depthLayer * WOODLAND_FRAME_RADIUS
    : (
      horizontal ? SCENE_ROWS * NIRVANA_TILE_SIZE : SCENE_COLUMNS * NIRVANA_TILE_SIZE
    ) - 2 * WOODLAND_FRAME_RADIUS - depthLayer * WOODLAND_FRAME_RADIUS + depthJitter;
  const frameId = `landmark.forest-edge.cluster.${coordinateHash(edge, slot, depthLayer * 3 + 2) % 2}` as
    | "landmark.forest-edge.cluster.0"
    | "landmark.forest-edge.cluster.1";

  return visual(
    `woodland-${edge}-${depthLayer}-${slot}`,
    frameId,
    horizontal ? along : depth,
    horizontal ? depth : along,
  );
}

function woodlandEdgeVisuals(
  edge: NirvanaCardinalDirection,
  start: number,
  end: number,
  collisionDepth: number,
): readonly NirvanaLandmarkVisualPlacement[] {
  const depthLayers = Math.max(
    1,
    Math.ceil((collisionDepth - WOODLAND_FRAME_RADIUS) / WOODLAND_FRAME_RADIUS),
  );
  return Object.freeze(Array.from({ length: depthLayers }, (_, depthLayer) =>
    woodlandSlots(start, end).map((slot) => woodlandEdgeVisual(edge, slot, depthLayer)))
    .flat());
}

/** Create coordinate-seeded native-scale forest visuals for one authored bounds record. */
export function createNirvanaRootWoodlandVisuals(
  bounds: NirvanaTileRectangle,
): readonly NirvanaLandmarkVisualPlacement[] {
  const left = bounds.column * NIRVANA_TILE_SIZE;
  const top = bounds.row * NIRVANA_TILE_SIZE;
  const right = left + bounds.columns * NIRVANA_TILE_SIZE;
  const bottom = top + bounds.rows * NIRVANA_TILE_SIZE;
  const visuals: NirvanaLandmarkVisualPlacement[] = [];

  if (bounds.row === 0) {
    visuals.push(...woodlandEdgeVisuals("north", left, right, bounds.rows * NIRVANA_TILE_SIZE));
  }
  if (bounds.column + bounds.columns === SCENE_COLUMNS) {
    visuals.push(...woodlandEdgeVisuals("east", top, bottom, bounds.columns * NIRVANA_TILE_SIZE));
  }
  if (bounds.row + bounds.rows === SCENE_ROWS) {
    visuals.push(...woodlandEdgeVisuals("south", left, right, bounds.rows * NIRVANA_TILE_SIZE));
  }
  if (bounds.column === 0) {
    visuals.push(...woodlandEdgeVisuals("west", top, bottom, bounds.columns * NIRVANA_TILE_SIZE));
  }
  return Object.freeze(visuals);
}

function woodlandLandmark(
  id: string,
  frameId: "landmark.forest-edge.cluster.0" | "landmark.forest-edge.cluster.1",
  bounds: NirvanaTileRectangle,
): NirvanaLandmarkPlacement {
  return landmark(id, "woodland", frameId, bounds, rectangleTiles(bounds), {
    visuals: createNirvanaRootWoodlandVisuals(bounds),
    collisionRole: "boundary-barrier",
  });
}

/**
 * One authored macro landmark, expressed so it can be rebuilt at different bounds.
 *
 * The rebuild is what makes relocation honest: a landmark that moves is constructed by
 * exactly the same function as its authored self, so it keeps its feature, its frame, its
 * collision rule and its visual derivation — only its bounds change.
 */
interface RootLandmarkSpec {
  readonly id: string;
  readonly bounds: NirvanaTileRectangle;
  readonly build: (id: string, bounds: NirvanaTileRectangle) => NirvanaLandmarkPlacement;
}

function woodlandSpec(
  id: string,
  frameId: "landmark.forest-edge.cluster.0" | "landmark.forest-edge.cluster.1",
  bounds: NirvanaTileRectangle,
): RootLandmarkSpec {
  return Object.freeze({
    id,
    bounds,
    build: (specId: string, specBounds: NirvanaTileRectangle): NirvanaLandmarkPlacement =>
      woodlandLandmark(specId, frameId, specBounds),
  });
}

/** The hero oak's trunk: a 2x2 block three columns in and five rows down from its bounds. */
function heroOakTrunk(bounds: NirvanaTileRectangle): readonly NirvanaTileCoordinate[] {
  return rectangleTiles(rectangle(bounds.column + 3, bounds.row + 5, 2, 2));
}

function heroOakLandmark(id: string, bounds: NirvanaTileRectangle): NirvanaLandmarkPlacement {
  return landmark(id, "hero-oak", "landmark.hero-oak", bounds, heroOakTrunk(bounds), {
    visuals: Object.freeze([
      visual(
        `${id}-visual`,
        "landmark.hero-oak",
        bounds.column * NIRVANA_TILE_SIZE,
        bounds.row * NIRVANA_TILE_SIZE,
        2,
      ),
    ]),
  });
}

function ruinedGardenLandmark(
  id: string,
  bounds: NirvanaTileRectangle,
): NirvanaLandmarkPlacement {
  return landmark(id, "ruined-garden", "landmark.ruined-garden", bounds, gardenWallTiles(bounds), {
    collisionRole: "boundary-barrier",
    visuals: Object.freeze([
      visual(
        `${id}-visual`,
        "landmark.ruined-garden",
        bounds.column * NIRVANA_TILE_SIZE,
        bounds.row * NIRVANA_TILE_SIZE,
        2,
      ),
    ]),
  });
}

function rootLandmarkSpecs(): readonly RootLandmarkSpec[] {
  return Object.freeze([
    woodlandSpec("woodland-top-west-outer", "landmark.forest-edge.cluster.0", rectangle(0, 0, 8, 5)),
    woodlandSpec("woodland-top-west-inner", "landmark.forest-edge.cluster.1", rectangle(8, 0, 7, 4)),
    woodlandSpec("woodland-top-oak", "landmark.forest-edge.cluster.0", rectangle(15, 0, 8, 5)),
    woodlandSpec("woodland-top-center", "landmark.forest-edge.cluster.1", rectangle(23, 0, 9, 4)),
    woodlandSpec("woodland-top-garden", "landmark.forest-edge.cluster.0", rectangle(32, 0, 7, 5)),
    woodlandSpec("woodland-top-east", "landmark.forest-edge.cluster.1", rectangle(39, 0, 9, 4)),
    woodlandSpec("woodland-west-upper", "landmark.forest-edge.cluster.1", rectangle(0, 5, 4, 6)),
    woodlandSpec("woodland-west-gate-cap", "landmark.forest-edge.cluster.0", rectangle(0, 11, 3, 3)),
    woodlandSpec("woodland-west-lower", "landmark.forest-edge.cluster.0", rectangle(0, 16, 4, 7)),
    woodlandSpec("woodland-west-bottom", "landmark.forest-edge.cluster.1", rectangle(0, 23, 6, 9)),
    woodlandSpec("woodland-east-upper", "landmark.forest-edge.cluster.0", rectangle(44, 4, 4, 10)),
    woodlandSpec("woodland-east-lower", "landmark.forest-edge.cluster.1", rectangle(44, 18, 4, 7)),
    woodlandSpec("woodland-east-bottom", "landmark.forest-edge.cluster.0", rectangle(42, 25, 6, 7)),
    woodlandSpec("woodland-bottom-west", "landmark.forest-edge.cluster.0", rectangle(6, 28, 8, 4)),
    woodlandSpec("woodland-bottom-midwest", "landmark.forest-edge.cluster.1", rectangle(14, 29, 7, 3)),
    woodlandSpec("woodland-bottom-mideast", "landmark.forest-edge.cluster.1", rectangle(29, 29, 7, 3)),
    woodlandSpec("woodland-bottom-east", "landmark.forest-edge.cluster.0", rectangle(36, 28, 6, 4)),
    Object.freeze({
      id: "hero-ancient-oak",
      bounds: rectangle(14, 5, 8, 7),
      build: heroOakLandmark,
    }),
    Object.freeze({
      id: "reclaimed-ruined-garden",
      bounds: rectangle(34, 5, 8, 8),
      build: ruinedGardenLandmark,
    }),
  ]);
}

function createLandmarks(): readonly NirvanaLandmarkPlacement[] {
  return Object.freeze(rootLandmarkSpecs().map(({ id, bounds, build }) => build(id, bounds)));
}

/**
 * Rebuild the root chunk's relocatable landmarks at their authored ALTERNATIVE homes.
 *
 * Offered to the terrain field alongside the authored placements so a landmark whose
 * ground the river took is moved rather than dropped. See `NirvanaLandmarkRelocation`
 * for each entry's measurement and its rationale.
 */
function createRelocations(): ReadonlyMap<string, NirvanaLandmarkPlacement> {
  const relocations = new Map<string, NirvanaLandmarkPlacement>();
  for (const { id, build } of rootLandmarkSpecs()) {
    const alternative = nirvanaLandmarkRelocation(ROOT_COORD, id);
    if (alternative === null) continue;
    relocations.set(id, build(id, alternative.bounds));
  }
  return relocations;
}

function createCollision(
  landmarks: readonly NirvanaLandmarkPlacement[],
): readonly (0 | 1)[] {
  const cells = Array.from(
    { length: SCENE_COLUMNS * SCENE_ROWS },
    () => 0 as 0 | 1,
  );
  for (const landmarkPlacement of landmarks) {
    for (const collisionTile of landmarkPlacement.collisionTiles) {
      cells[collisionTile.row * SCENE_COLUMNS + collisionTile.column] = 1;
    }
  }
  return Object.freeze(cells);
}

const ROOT_COORD = Object.freeze({ column: 0, row: 0 });

/**
 * Declare the root chunk's geometry WITHOUT building, validating or hashing a chunk.
 *
 * The terrain field's first pass needs only what the authoring declares — roads, dry
 * channels, connectors, landmarks. Building a whole placeholder chunk to read those back
 * meant validating and content-hashing 1,536 terrain cells that were about to be thrown
 * away, which measurably slowed every recipe build.
 */
export function nirvanaRootChunkGeometry(): NirvanaChunkGeometry {
  const swaleTiles = createSwaleTiles();
  return Object.freeze({
    coord: ROOT_COORD,
    roadTiles: Object.freeze([...createRoadTiles().values()]),
    channelTiles: Object.freeze([...swaleTiles.values()]),
    connectors: ROOT_CONNECTORS,
    landmarks: createLandmarks(),
    relocations: createRelocations(),
  });
}

const ROOT_CONNECTORS: readonly NirvanaChunkConnector[] = Object.freeze([
  Object.freeze({ edge: "west" as const, offset: 14 }),
  Object.freeze({ edge: "east" as const, offset: 16 }),
  Object.freeze({ edge: "south" as const, offset: 25 }),
]);

/**
 * Build the exact approved 48x32 semantic scene as production root chunk (0,0).
 *
 * @param field The region's genesis terrain field, or `null` on the geometry-declaring
 *   first pass (see `NirvanaTerrainChunks`). With a field, the chunk publishes the
 *   approved river valley: the field's tiles, its ground scenery, its walkability, and
 *   the authored macro landmarks at whichever home the field's water verdict cleared —
 *   authored ground first, the authored alternative second, and retirement (rather than
 *   drawing it drowned) only when the river has taken both.
 */
export function createNirvanaRootChunk(
  field: NirvanaTerrainField | null = null,
): NirvanaChunk {
  const roadTiles = createRoadTiles();
  const swaleTiles = createSwaleTiles();
  const channels = createChannelCells(swaleTiles);
  const relocations = createRelocations();
  const landmarks = Object.freeze(createLandmarks()
    .map((placement) => nirvanaLandmarkForTerrain(field, ROOT_COORD, placement, relocations))
    .filter((placement): placement is NirvanaLandmarkPlacement => placement !== null));
  const scenery: readonly NirvanaScenerySprite[] = field === null
    ? Object.freeze([])
    : nirvanaSceneryFromField(field, ROOT_COORD);

  return createNirvanaChunk({
    coord: { column: 0, row: 0 },
    columns: SCENE_COLUMNS,
    rows: SCENE_ROWS,
    terrainCells: createTerrainCells(channels, field),
    roadCells: createRoadCells(roadTiles),
    roadHub: tile(ROAD_HUB.column, ROAD_HUB.row),
    landmarks,
    scenery,
    quietClearings: createQuietClearings(),
    collision: field === null
      ? createCollision(landmarks)
      : nirvanaChunkCollisionFromField(field, ROOT_COORD, landmarks, scenery),
    connectors: ROOT_CONNECTORS,
  });
}
