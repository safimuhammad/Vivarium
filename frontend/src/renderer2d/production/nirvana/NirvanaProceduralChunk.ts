/** Deterministic macro-first chunk and district generation for expanded Nirvana. */

import type { Rect, Vec2 } from "../../contracts";
import { TILE_SIZE, tileCenter, type ShelterPlot, type TileCoord } from "../../map/regionMap";
import {
  feetAnchoredVisualRect,
  productionRectsOverlap,
  shelterRenderRect,
} from "../productionGeometry";
import type { OverflowDistrict } from "../maps/RegionMapRecipe";
import {
  NIRVANA_CHUNK_COLUMNS,
  NIRVANA_CHUNK_ROWS,
  NIRVANA_TILE_SIZE,
  createNirvanaChunk,
  nirvanaChunkKey,
  type NirvanaCardinalDirection,
  type NirvanaChunk,
  type NirvanaChunkConnector,
  type NirvanaChunkCoord,
  type NirvanaLandmarkFeature,
  type NirvanaLandmarkFrameId,
  type NirvanaLandmarkPlacement,
  type NirvanaRoadCell,
  type NirvanaTerrainCell,
  type NirvanaTileCoordinate,
  type NirvanaTileRectangle,
} from "./NirvanaRegionV2";
import {
  nirvanaGrownScenery,
  nirvanaGrownTerrainCells,
  type NirvanaChannelCell,
} from "./NirvanaTerrainChunks";

const SEAM_CONTRACT_VERSION = 1 as const;
/** Content algorithm version; expansion capacity tiers must never alter this value. */
export const NIRVANA_PROCEDURAL_GENERATOR_VERSION = 1 as const;
const CARDINAL_DIRECTIONS: readonly NirvanaCardinalDirection[] = Object.freeze([
  "north",
  "east",
  "south",
  "west",
]);
const DIRECTION_ORDER: Readonly<Record<NirvanaCardinalDirection, number>> =
  Object.freeze({ north: 0, east: 1, south: 2, west: 3 });
const NEIGHBOR_DELTA: Readonly<Record<NirvanaCardinalDirection, NirvanaChunkCoord>> =
  Object.freeze({
    north: Object.freeze({ column: 0, row: -1 }),
    east: Object.freeze({ column: 1, row: 0 }),
    south: Object.freeze({ column: 0, row: 1 }),
    west: Object.freeze({ column: -1, row: 0 }),
  });
const ROAD_HUB: NirvanaTileCoordinate = Object.freeze({ column: 24, row: 15 });
const SHELTER_COLUMNS = Object.freeze([10, 14, 30, 34] as const);
const SHELTER_ROWS = Object.freeze([5, 11, 17, 23] as const);
const MAX_ABSOLUTE_CHUNK_COORDINATE = Math.floor(
  Number.MAX_SAFE_INTEGER
    / (Math.max(NIRVANA_CHUNK_COLUMNS, NIRVANA_CHUNK_ROWS) * NIRVANA_TILE_SIZE),
);

export type NirvanaSeamRequest =
  | Readonly<{
      edge: NirvanaCardinalDirection;
      source: "authored-reciprocal";
      reciprocalOffsets: readonly number[];
    }>
  | Readonly<{
      edge: NirvanaCardinalDirection;
      source: "generated-shared";
    }>;

export interface NirvanaSeamAgreement {
  readonly edge: NirvanaCardinalDirection;
  readonly source: NirvanaSeamRequest["source"];
  readonly seamKey: string;
  readonly offsets: readonly number[];
}

/** Auditable connector receipt; both sides of a generated seam derive the same offset. */
export interface NirvanaProceduralSeamContract {
  readonly version: 1;
  readonly generatorVersion: 1;
  readonly regionId: "nirvana";
  readonly runSeed: number;
  readonly coord: NirvanaChunkCoord;
  readonly agreements: readonly NirvanaSeamAgreement[];
  readonly connectors: readonly NirvanaChunkConnector[];
  readonly contractHash: string;
}

export interface CreateNirvanaProceduralSeamContractInput {
  readonly runSeed: number;
  readonly coord: NirvanaChunkCoord;
  readonly edges: readonly NirvanaSeamRequest[];
}

export interface GenerateNirvanaProceduralChunkInput {
  readonly runSeed: number;
  readonly coord: NirvanaChunkCoord;
  readonly districtIndex: number;
  readonly seamContract: NirvanaProceduralSeamContract;
}

export interface NirvanaProceduralChunkResult {
  readonly generatorVersion: 1;
  readonly chunk: NirvanaChunk;
  readonly district: OverflowDistrict;
  readonly seamContract: NirvanaProceduralSeamContract;
  readonly generationHash: string;
}

/**
 * Own a deterministic seam contract, copying authored reciprocal offsets exactly.
 *
 * Generated offsets hash the undirected seam key, so neighboring chunks agree
 * without depending on which side was generated first.
 */
export function createNirvanaProceduralSeamContract(
  input: CreateNirvanaProceduralSeamContractInput,
): NirvanaProceduralSeamContract {
  validateGenerationIdentity(input.runSeed, input.coord);
  if (!Array.isArray(input.edges)) {
    throw new Error("Nirvana seam requests must be an actual array");
  }
  const seenEdges = new Set<NirvanaCardinalDirection>();
  const agreements: NirvanaSeamAgreement[] = [];
  for (const request of input.edges) {
    if (!CARDINAL_DIRECTIONS.includes(request.edge)) {
      throw new Error("Nirvana seam request edge must be cardinal");
    }
    if (seenEdges.has(request.edge)) {
      throw new Error(`Nirvana seam contract contains duplicate edge ${request.edge}`);
    }
    seenEdges.add(request.edge);
    const seamKey = undirectedSeamKey(input.coord, request.edge);
    const offsets = request.source === "authored-reciprocal"
      ? ownOffsets(request.reciprocalOffsets, request.edge)
      : Object.freeze([generatedSeamOffset(
          input.runSeed,
          seamKey,
          request.edge,
        )]);
    agreements.push(Object.freeze({
      edge: request.edge,
      source: request.source,
      seamKey,
      offsets,
    }));
  }
  agreements.sort((left, right) => DIRECTION_ORDER[left.edge] - DIRECTION_ORDER[right.edge]);
  const connectors = Object.freeze(agreements.flatMap((agreement) =>
    agreement.offsets.map((offset) => Object.freeze({
      edge: agreement.edge,
      offset,
    }))));
  const ownedCoord = Object.freeze({
    column: input.coord.column,
    row: input.coord.row,
  });
  const payload = {
    version: SEAM_CONTRACT_VERSION,
    generatorVersion: NIRVANA_PROCEDURAL_GENERATOR_VERSION,
    regionId: "nirvana" as const,
    runSeed: input.runSeed,
    coord: ownedCoord,
    agreements: Object.freeze(agreements),
    connectors,
  };
  return Object.freeze({
    ...payload,
    contractHash: stableHash(payload),
  });
}

/**
 * Generate one deeply-owned semantic chunk and one exact-capacity district.
 *
 * Layout order is deliberate: connected road macro, protected settlement pocket,
 * then a small number of coherent edge landmarks. No individual prop scatter is
 * emitted by this generator.
 */
export function generateNirvanaProceduralChunk(
  input: GenerateNirvanaProceduralChunkInput,
): NirvanaProceduralChunkResult {
  validateGenerationIdentity(input.runSeed, input.coord);
  assertNonNegativeSafeInteger(input.districtIndex, "district index");
  const seamContract = validateAndOwnSeamContract(input);
  if (seamContract.connectors.length === 0) {
    throw new Error("Nirvana procedural chunks require at least one seam connector");
  }

  // Generation is a pure function of these four things and returns a deeply frozen value,
  // so sharing a build is indistinguishable from repeating it. Growth planning regenerates
  // the same chunk set on every recipe build, and a grown chunk now carries corner-masked
  // overlays and ground scenery — enough extra work that repeating it dominated the
  // growth-tier suites.
  const cacheKey = `${input.runSeed}:${input.coord.column},${input.coord.row}`
    + `:${input.districtIndex}:${seamContract.contractHash}`;
  const cached = GENERATION_CACHE.get(cacheKey);
  if (cached !== undefined) return cached;

  const entropy = createEntropy(
    input.runSeed,
    input.coord,
  );
  const roadTiles = createRoadTiles(seamContract.connectors);
  const localPlots = createLocalShelterPlots(input.runSeed, input.coord);
  const localStagingPoints = createLocalStagingPoints(localPlots);
  const protectedRects = mechanicsProtectionRects(
    roadTiles,
    localPlots,
    localStagingPoints,
  );
  const swaleColumn = entropy("dry-swale-enabled") % 3 === 0
    ? (entropy("dry-swale-bank") % 2 === 0 ? 7 : 40)
    : null;
  const landmarks = createLandmarks(
    entropy,
    protectedRects,
    swaleColumn,
    `nirvana:seed-${input.runSeed}:generator-v${NIRVANA_PROCEDURAL_GENERATOR_VERSION}:chunk-${input.coord.column},${input.coord.row}`,
  );
  const collision = createCollision(landmarks);
  assertProtectedGeometryOpen(
    roadTiles,
    localPlots,
    localStagingPoints,
    collision,
  );
  const roadCells = createRoadCells(roadTiles, swaleColumn);
  const terrainCells = createTerrainCells(input.coord, swaleColumn, roadTiles);
  const protectedTileKeys = grownProtectedTileKeys(
    roadTiles,
    localPlots,
    localStagingPoints,
    landmarks,
  );
  const chunk = createNirvanaChunk({
    coord: input.coord,
    columns: NIRVANA_CHUNK_COLUMNS,
    rows: NIRVANA_CHUNK_ROWS,
    terrainCells,
    roadCells,
    roadHub: ROAD_HUB,
    landmarks,
    scenery: nirvanaGrownScenery(
      input.coord,
      terrainCells,
      (candidate) => protectedTileKeys.has(tileKey(candidate)),
    ),
    quietClearings: Object.freeze([Object.freeze({
      id: "southern-growth" as const,
      bounds: rectangle(8, 3, 32, 26),
    })]),
    collision,
    connectors: seamContract.connectors,
  });
  const district = createDistrict(
    input.coord,
    input.districtIndex,
    localPlots,
    localStagingPoints,
  );
  const generationHash = stableHash({
    regionId: "nirvana",
    generatorVersion: NIRVANA_PROCEDURAL_GENERATOR_VERSION,
    runSeed: input.runSeed,
    coord: input.coord,
    seamContractHash: seamContract.contractHash,
    chunkContentHash: chunk.contentHash,
    district: {
      origin: district.origin,
      socialAnchors: district.socialAnchors,
      stagingAnchors: district.stagingAnchors,
      stagingPoints: district.stagingPoints,
      shelterPlots: district.shelterPlots,
    },
  });
  const result = Object.freeze({
    generatorVersion: NIRVANA_PROCEDURAL_GENERATOR_VERSION,
    chunk,
    district,
    seamContract,
    generationHash,
  });
  if (GENERATION_CACHE.size >= GENERATION_CACHE_LIMIT) {
    const oldest = GENERATION_CACHE.keys().next();
    if (!oldest.done) GENERATION_CACHE.delete(oldest.value);
  }
  GENERATION_CACHE.set(cacheKey, result);
  return result;
}

/** Bounded memo for grown chunks; see the note in `generateNirvanaProceduralChunk`. */
const GENERATION_CACHE_LIMIT = 64;
const GENERATION_CACHE = new Map<string, NirvanaProceduralChunkResult>();

function validateAndOwnSeamContract(
  input: GenerateNirvanaProceduralChunkInput,
): NirvanaProceduralSeamContract {
  const contract = input.seamContract;
  if (contract.runSeed !== input.runSeed) {
    throw new Error("Nirvana seam contract seed does not match chunk generation");
  }
  if (
    contract.coord.column !== input.coord.column
    || contract.coord.row !== input.coord.row
  ) {
    throw new Error("Nirvana seam contract coordinate does not match chunk generation");
  }
  if (contract.generatorVersion !== NIRVANA_PROCEDURAL_GENERATOR_VERSION) {
    throw new Error("Nirvana seam contract generator version is invalid");
  }
  if (contract.version !== SEAM_CONTRACT_VERSION || contract.regionId !== "nirvana") {
    throw new Error("Nirvana seam contract identity is invalid");
  }
  const rebuilt = createNirvanaProceduralSeamContract({
    runSeed: contract.runSeed,
    coord: contract.coord,
    edges: contract.agreements.map((agreement): NirvanaSeamRequest =>
      agreement.source === "authored-reciprocal"
        ? {
            edge: agreement.edge,
            source: "authored-reciprocal",
            reciprocalOffsets: agreement.offsets,
          }
        : { edge: agreement.edge, source: "generated-shared" }),
  });
  if (
    rebuilt.contractHash !== contract.contractHash
    || JSON.stringify(rebuilt.connectors) !== JSON.stringify(contract.connectors)
    || JSON.stringify(rebuilt.agreements) !== JSON.stringify(contract.agreements)
  ) {
    throw new Error("Nirvana seam contract content or hash is invalid");
  }
  return rebuilt;
}

function createLocalShelterPlots(
  runSeed: number,
  coord: NirvanaChunkCoord,
): readonly ShelterPlot[] {
  const plots: ShelterPlot[] = [];
  for (const row of SHELTER_ROWS) {
    for (const column of SHELTER_COLUMNS) {
      const plotIndex = plots.length;
      plots.push(Object.freeze({
        id: `nirvana:seed-${runSeed}:generator-v${NIRVANA_PROCEDURAL_GENERATOR_VERSION}:chunk-${coord.column},${coord.row}:plot-${plotIndex}`,
        tile: tile(column, row),
        door: tile(column + 2, row + 3),
      }));
    }
  }
  return Object.freeze(plots);
}

function createLocalStagingPoints(
  plots: readonly ShelterPlot[],
): readonly Vec2[] {
  const shelterRects = plots.map(({ tile: plotTile }) => shelterRenderRect(plotTile));
  const candidates: Vec2[] = [];
  for (let row = 3; row <= 27; row += 3) {
    for (let column = 12; column <= 36; column += 3) {
      const point = tileCenter(tile(column, row));
      const visual = feetAnchoredVisualRect(point);
      if (shelterRects.some((rect) => productionRectsOverlap(rect, visual))) continue;
      candidates.push(Object.freeze({ x: point.x, y: point.y }));
    }
  }
  const selected = candidates
    .sort((left, right) =>
      squaredDistance(left, tileCenter(ROAD_HUB))
      - squaredDistance(right, tileCenter(ROAD_HUB))
      || left.y - right.y
      || left.x - right.x)
    .slice(0, 32);
  if (selected.length !== 32) {
    throw new Error(`Nirvana procedural district has ${selected.length}/32 staging points`);
  }
  return Object.freeze(selected);
}

function createDistrict(
  coord: NirvanaChunkCoord,
  districtIndex: number,
  localPlots: readonly ShelterPlot[],
  localStagingPoints: readonly Vec2[],
): OverflowDistrict {
  const tileOffset = {
    column: coord.column * NIRVANA_CHUNK_COLUMNS,
    row: coord.row * NIRVANA_CHUNK_ROWS,
  };
  const pixelOffset = {
    x: tileOffset.column * TILE_SIZE,
    y: tileOffset.row * TILE_SIZE,
  };
  const globalTile = (value: TileCoord): TileCoord => Object.freeze({
    column: value.column + tileOffset.column,
    row: value.row + tileOffset.row,
  });
  const stagingPoints = Object.freeze(localStagingPoints.map((point) => Object.freeze({
    x: point.x + pixelOffset.x,
    y: point.y + pixelOffset.y,
  })));
  const shelterPlots = Object.freeze(localPlots.map((plot) => Object.freeze({
    id: plot.id,
    tile: globalTile(plot.tile),
    door: globalTile(plot.door),
  })));
  return deepFreezeOwned({
    index: districtIndex,
    origin: globalTile(ROAD_HUB),
    socialAnchors: [globalTile(ROAD_HUB)],
    stagingAnchors: stagingPoints.map((point) => Object.freeze({
      column: Math.floor(point.x / TILE_SIZE),
      row: Math.floor(point.y / TILE_SIZE),
    })),
    stagingPoints,
    shelterPlots,
  });
}

function createRoadTiles(
  connectors: readonly NirvanaChunkConnector[],
): ReadonlyMap<string, NirvanaTileCoordinate> {
  const roads = new Map<string, NirvanaTileCoordinate>();
  traceOrthogonal([tile(24, 1), tile(24, 30)], roads);
  traceOrthogonal([tile(1, 15), tile(46, 15)], roads);
  for (const connector of connectors) {
    const edgeTile = connectorTile(connector);
    switch (connector.edge) {
      case "north":
        traceOrthogonal([edgeTile, tile(connector.offset, 1), tile(24, 1), ROAD_HUB], roads);
        break;
      case "east":
        traceOrthogonal([edgeTile, tile(46, connector.offset), tile(46, 15), ROAD_HUB], roads);
        break;
      case "south":
        traceOrthogonal([edgeTile, tile(connector.offset, 30), tile(24, 30), ROAD_HUB], roads);
        break;
      case "west":
        traceOrthogonal([edgeTile, tile(1, connector.offset), tile(1, 15), ROAD_HUB], roads);
        break;
    }
  }
  return roads;
}

function traceOrthogonal(
  points: readonly NirvanaTileCoordinate[],
  destination: Map<string, NirvanaTileCoordinate>,
): void {
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]!;
    const end = points[index]!;
    if (start.column !== end.column && start.row !== end.row) {
      throw new Error("Nirvana procedural roads require orthogonal segments");
    }
    const columnStep = Math.sign(end.column - start.column);
    const rowStep = Math.sign(end.row - start.row);
    let column = start.column;
    let row = start.row;
    while (true) {
      const current = tile(column, row);
      destination.set(tileKey(current), current);
      if (column === end.column && row === end.row) break;
      column += columnStep;
      row += rowStep;
    }
  }
}

function createRoadCells(
  roads: ReadonlyMap<string, NirvanaTileCoordinate>,
  swaleColumn: number | null,
): readonly NirvanaRoadCell[] {
  return Object.freeze([...roads.values()]
    .sort(compareTiles)
    .map((coordinate) => Object.freeze({
      tile: coordinate,
      connections: Object.freeze(CARDINAL_DIRECTIONS.filter((direction) => {
        const delta = NEIGHBOR_DELTA[direction];
        return roads.has(`${coordinate.column + delta.column},${coordinate.row + delta.row}`);
      })),
      surface: coordinate.column === swaleColumn ? "ford" as const : "dirt" as const,
    })));
}

/** Tiles grown scenery must stay off: roads, plot footprints, staging, landmark feet. */
function grownProtectedTileKeys(
  roads: ReadonlyMap<string, NirvanaTileCoordinate>,
  plots: readonly ShelterPlot[],
  stagingPoints: readonly Vec2[],
  landmarks: readonly NirvanaLandmarkPlacement[],
): ReadonlySet<string> {
  const keys = new Set<string>(roads.keys());
  for (const plot of plots) {
    for (let row = plot.tile.row - 1; row <= plot.tile.row + 4; row += 1) {
      for (let column = plot.tile.column - 1; column <= plot.tile.column + 4; column += 1) {
        keys.add(`${column},${row}`);
      }
    }
    keys.add(tileKey(plot.door));
  }
  for (const point of stagingPoints) {
    keys.add(`${Math.floor(point.x / NIRVANA_TILE_SIZE) % NIRVANA_CHUNK_COLUMNS},${
      Math.floor(point.y / NIRVANA_TILE_SIZE) % NIRVANA_CHUNK_ROWS}`);
  }
  for (const landmark of landmarks) {
    for (const coordinate of landmark.collisionTiles) keys.add(tileKey(coordinate));
  }
  return keys;
}

/**
 * Derive one grown chunk's terrain in the `nirvana-v3` vocabulary.
 *
 * The ground comes from `nirvanaGrownTerrainCells`, which samples world-continuous noise
 * so a tonal passage crosses the growth seam, and draws only from walkable materials — so
 * this chunk's collision is still landmarks-only and growth can never sever the walkable
 * set. The dry swale column keeps its authored channel identity on top.
 */
function createTerrainCells(
  coord: NirvanaChunkCoord,
  swaleColumn: number | null,
  roads: ReadonlyMap<string, NirvanaTileCoordinate>,
): readonly NirvanaTerrainCell[] {
  const channels = new Map<string, NirvanaChannelCell>();
  if (swaleColumn !== null) {
    for (let row = 0; row < NIRVANA_CHUNK_ROWS; row += 1) {
      const coordinate = tile(swaleColumn, row);
      channels.set(tileKey(coordinate), Object.freeze({
        kind: roads.has(tileKey(coordinate)) ? "ford" : "dry-swale",
        // The swale column always spans the chunk's full height. At the chunk's own
        // north/south edge the line is understood to continue into the neighboring
        // chunk (same boundary convention as the root chunk's terrainConnections and
        // the authored dry-swale-ford-continuation chunk's swaleConnections), so both
        // directions stay connected instead of producing a dead-end mask the swale
        // atlas vocabulary never authored (SWALE_FRAMES has no isolated/end frames).
        connections: Object.freeze(["north" as const, "south" as const]),
      }));
    }
  }
  return nirvanaGrownTerrainCells(coord, channels);
}

interface LandmarkCandidate {
  readonly id: string;
  readonly feature: NirvanaLandmarkFeature;
  readonly frameId: NirvanaLandmarkFrameId;
  readonly bounds: NirvanaTileRectangle;
  readonly collision: "rectangle" | "garden-wall" | "none";
  readonly scale: 1 | 2;
}

function createLandmarks(
  entropy: (label: string) => number,
  protectedRects: readonly Rect[],
  swaleColumn: number | null,
  idPrefix: string,
): readonly NirvanaLandmarkPlacement[] {
  const candidates: readonly LandmarkCandidate[] = Object.freeze([
    candidate("northwest-grove", "woodland", "landmark.forest-edge.cluster.0", 2, 2, 4, 4),
    candidate("northeast-grove", "woodland", "landmark.forest-edge.cluster.1", 42, 2, 4, 4),
    candidate("southwest-grove", "woodland", "landmark.forest-edge.cluster.1", 2, 26, 4, 4),
    candidate("southeast-grove", "woodland", "landmark.forest-edge.cluster.0", 42, 26, 4, 4),
    candidate("western-ruined-garden", "ruined-garden", "landmark.ruined-garden", 2, 11, 8, 8, "garden-wall", 2),
    candidate("eastern-ruined-garden", "ruined-garden", "landmark.ruined-garden", 38, 11, 8, 8, "garden-wall", 2),
    candidate("western-meadow-edge", "meadow-edge", "landmark.meadow-edge.east", 2, 21, 4, 4, "none"),
    candidate("eastern-meadow-edge", "meadow-edge", "landmark.meadow-edge.west", 42, 21, 4, 4, "none"),
  ]);
  const viable = candidates.filter(({ bounds }) => {
    const visualRect = tileRectangleAsPixels(bounds);
    if (protectedRects.some((rect) => productionRectsOverlap(rect, visualRect))) return false;
    return swaleColumn === null
      || swaleColumn < bounds.column
      || swaleColumn >= bounds.column + bounds.columns;
  });
  const desiredCount = 2 + entropy("landmark-count") % 4;
  const selected = [...viable]
    .sort((left, right) =>
      entropy(`landmark-order:${left.id}`) - entropy(`landmark-order:${right.id}`)
      || left.id.localeCompare(right.id))
    .slice(0, Math.min(desiredCount, viable.length));
  if (selected.length < 2) {
    throw new Error("Nirvana procedural layout cannot place two coherent scenic clusters");
  }
  return Object.freeze(selected.map((value, index) =>
    createLandmark(value, index, entropy, idPrefix)));
}

function candidate(
  id: string,
  feature: NirvanaLandmarkFeature,
  frameId: NirvanaLandmarkFrameId,
  column: number,
  row: number,
  columns: number,
  rows: number,
  collision: LandmarkCandidate["collision"] = "rectangle",
  scale: 1 | 2 = 1,
): LandmarkCandidate {
  return Object.freeze({
    id,
    feature,
    frameId,
    bounds: rectangle(column, row, columns, rows),
    collision,
    scale,
  });
}

function createLandmark(
  candidateValue: LandmarkCandidate,
  selectionIndex: number,
  entropy: (label: string) => number,
  idPrefix: string,
): NirvanaLandmarkPlacement {
  const frameId = candidateValue.feature === "woodland"
    ? `landmark.forest-edge.cluster.${entropy(`forest-variant:${candidateValue.id}`) % 2}` as
      | "landmark.forest-edge.cluster.0"
      | "landmark.forest-edge.cluster.1"
    : candidateValue.frameId;
  const collisionTiles = candidateValue.collision === "rectangle"
    ? rectangleTiles(candidateValue.bounds)
    : candidateValue.collision === "garden-wall"
      ? gardenWallTiles(candidateValue.bounds)
      : Object.freeze([]);
  const id = `${idPrefix}:scenery-${selectionIndex}:${candidateValue.id}`;
  return Object.freeze({
    id,
    feature: candidateValue.feature,
    frameId,
    tile: tile(candidateValue.bounds.column, candidateValue.bounds.row),
    bounds: candidateValue.bounds,
    blocksMovement: collisionTiles.length > 0,
    collisionTiles,
    collisionRole: "visual-footprint",
    visuals: Object.freeze([Object.freeze({
      id: `${id}-visual`,
      frameId,
      at: Object.freeze({
        x: candidateValue.bounds.column * NIRVANA_TILE_SIZE,
        y: candidateValue.bounds.row * NIRVANA_TILE_SIZE,
      }),
      scale: candidateValue.scale,
    })]),
  });
}

function mechanicsProtectionRects(
  roadTiles: ReadonlyMap<string, NirvanaTileCoordinate>,
  plots: readonly ShelterPlot[],
  stagingPoints: readonly Vec2[],
): readonly Rect[] {
  return Object.freeze([
    ...[...roadTiles.values()].map(({ column, row }) => Object.freeze({
      x: column * TILE_SIZE,
      y: row * TILE_SIZE,
      width: TILE_SIZE,
      height: TILE_SIZE,
    })),
    ...plots.map(({ tile: plotTile }) => Object.freeze(shelterRenderRect(plotTile))),
    ...stagingPoints.map((point) => Object.freeze(feetAnchoredVisualRect(point))),
  ]);
}

function createCollision(
  landmarks: readonly NirvanaLandmarkPlacement[],
): readonly (0 | 1)[] {
  const collision = Array.from(
    { length: NIRVANA_CHUNK_COLUMNS * NIRVANA_CHUNK_ROWS },
    () => 0 as 0 | 1,
  );
  for (const landmark of landmarks) {
    for (const coordinate of landmark.collisionTiles) {
      collision[coordinate.row * NIRVANA_CHUNK_COLUMNS + coordinate.column] = 1;
    }
  }
  const openCount = collision.filter((value) => value === 0).length;
  if (openCount / collision.length < 0.6) {
    throw new Error("Nirvana procedural chunk must remain at least 60% collision-open");
  }
  return Object.freeze(collision);
}

function assertProtectedGeometryOpen(
  roads: ReadonlyMap<string, NirvanaTileCoordinate>,
  plots: readonly ShelterPlot[],
  stagingPoints: readonly Vec2[],
  collision: readonly (0 | 1)[],
): void {
  const requiredTiles = [
    ...roads.values(),
    ...plots.flatMap(({ tile: plotTile, door }) => [plotTile, door]),
    ...stagingPoints.map(({ x, y }) => ({
      column: Math.floor(x / TILE_SIZE),
      row: Math.floor(y / TILE_SIZE),
    })),
  ];
  for (const required of requiredTiles) {
    if (collision[required.row * NIRVANA_CHUNK_COLUMNS + required.column] !== 0) {
      throw new Error(`Nirvana procedural mechanics overlap collision at ${tileKey(required)}`);
    }
  }
}

function ownOffsets(
  input: readonly number[],
  edge: NirvanaCardinalDirection,
): readonly number[] {
  if (!Array.isArray(input)) {
    throw new Error("Nirvana authored reciprocal offsets must be an actual array");
  }
  const extent = edge === "north" || edge === "south"
    ? NIRVANA_CHUNK_COLUMNS
    : NIRVANA_CHUNK_ROWS;
  const seen = new Set<number>();
  const owned: number[] = [];
  for (const offset of input) {
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= extent) {
      throw new Error(`Nirvana seam offset must be within 0..${extent - 1}`);
    }
    if (seen.has(offset)) {
      throw new Error(`Nirvana seam offsets contain duplicate ${offset}`);
    }
    seen.add(offset);
    owned.push(offset);
  }
  return Object.freeze(owned.sort((left, right) => left - right));
}

function generatedSeamOffset(
  runSeed: number,
  seamKey: string,
  edge: NirvanaCardinalDirection,
): number {
  const horizontalEdge = edge === "north" || edge === "south";
  const margin = horizontalEdge ? 8 : 6;
  const extent = horizontalEdge ? NIRVANA_CHUNK_COLUMNS : NIRVANA_CHUNK_ROWS;
  const available = extent - margin * 2;
  return margin + stableInteger(
    `nirvana|${runSeed}|generator-v${NIRVANA_PROCEDURAL_GENERATOR_VERSION}|seam|${seamKey}`,
  ) % available;
}

function undirectedSeamKey(
  coord: NirvanaChunkCoord,
  edge: NirvanaCardinalDirection,
): string {
  const delta = NEIGHBOR_DELTA[edge];
  const neighbor = {
    column: coord.column + delta.column,
    row: coord.row + delta.row,
  };
  const [first, second] = [coord, neighbor].sort(compareChunkCoords);
  const axis = edge === "north" || edge === "south" ? "horizontal" : "vertical";
  return `${axis}:${first!.column},${first!.row}|${second!.column},${second!.row}`;
}

function createEntropy(
  runSeed: number,
  coord: NirvanaChunkCoord,
): (label: string) => number {
  const prefix = `nirvana|${runSeed}|generator-v${NIRVANA_PROCEDURAL_GENERATOR_VERSION}|chunk|${coord.column},${coord.row}`;
  return (label: string): number => stableInteger(`${prefix}|${label}`);
}

function connectorTile(connector: NirvanaChunkConnector): NirvanaTileCoordinate {
  switch (connector.edge) {
    case "north": return tile(connector.offset, 0);
    case "east": return tile(NIRVANA_CHUNK_COLUMNS - 1, connector.offset);
    case "south": return tile(connector.offset, NIRVANA_CHUNK_ROWS - 1);
    case "west": return tile(0, connector.offset);
  }
}

function rectangle(
  column: number,
  row: number,
  columns: number,
  rows: number,
): NirvanaTileRectangle {
  return Object.freeze({ column, row, columns, rows });
}

function rectangleTiles(
  bounds: NirvanaTileRectangle,
): readonly NirvanaTileCoordinate[] {
  const result: NirvanaTileCoordinate[] = [];
  for (let row = bounds.row; row < bounds.row + bounds.rows; row += 1) {
    for (let column = bounds.column; column < bounds.column + bounds.columns; column += 1) {
      result.push(tile(column, row));
    }
  }
  return Object.freeze(result);
}

function gardenWallTiles(
  bounds: NirvanaTileRectangle,
): readonly NirvanaTileCoordinate[] {
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

function tileRectangleAsPixels(bounds: NirvanaTileRectangle): Rect {
  return Object.freeze({
    x: bounds.column * TILE_SIZE,
    y: bounds.row * TILE_SIZE,
    width: bounds.columns * TILE_SIZE,
    height: bounds.rows * TILE_SIZE,
  });
}

function tile(column: number, row: number): NirvanaTileCoordinate {
  return Object.freeze({ column, row });
}

function tileKey(value: Readonly<{ column: number; row: number }>): string {
  return `${value.column},${value.row}`;
}

function compareTiles(left: NirvanaTileCoordinate, right: NirvanaTileCoordinate): number {
  return left.row - right.row || left.column - right.column;
}

function compareChunkCoords(left: NirvanaChunkCoord, right: NirvanaChunkCoord): number {
  return left.row - right.row || left.column - right.column;
}

function squaredDistance(left: Vec2, right: Vec2): number {
  const dx = left.x - right.x;
  const dy = left.y - right.y;
  return dx * dx + dy * dy;
}

function validateGenerationIdentity(
  runSeed: number,
  coord: NirvanaChunkCoord,
): void {
  if (!Number.isSafeInteger(runSeed)) {
    throw new Error("Nirvana procedural run seed must be a safe integer");
  }
  nirvanaChunkKey(coord);
  if (
    Math.abs(coord.column) > MAX_ABSOLUTE_CHUNK_COORDINATE
    || Math.abs(coord.row) > MAX_ABSOLUTE_CHUNK_COORDINATE
  ) {
    throw new Error("Nirvana procedural chunk coordinate is unreasonably large");
  }
}

function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Nirvana procedural ${label} must be a non-negative safe integer`);
  }
}

function stableHash(value: unknown): string {
  return stableInteger(JSON.stringify(canonicalJson(value)))
    .toString(16)
    .padStart(8, "0");
}

function stableInteger(source: string): number {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
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
