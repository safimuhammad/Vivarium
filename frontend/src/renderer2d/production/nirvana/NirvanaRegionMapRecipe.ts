/** Exact-region adapter from authored and deterministic growth chunks to mechanics. */

import { tileCenter } from "../../map/regionMap";
import type { NavigationTopology } from "../navigation/navigation";
import { openDeclaredWrapSeams } from "../navigation/wrapSeams";
import type { RegionMapIdentity } from "../maps/RegionMapIdentity";
import {
  createRegionMapRecipe,
  registerRegionMapRecipeCloneTransfer,
  type RegionMapRecipeV1,
} from "../maps/RegionMapRecipe";
import {
  feetAnchoredVisualRect,
  shelterRenderRect,
} from "../productionGeometry";
import {
  createNirvanaInitialRegion,
  type NirvanaGeneratedChunkReceipt,
  type NirvanaInitialRegion,
  type NirvanaMechanicsExclusions,
  type NirvanaRegionGrowthReceipt,
  type NirvanaSeamCandidate,
} from "./NirvanaInitialRegion";
import {
  planNirvanaGrowth,
  type NirvanaGrowthPlan,
  type NirvanaGrowthPressure,
} from "./NirvanaGrowthPolicy";
import {
  NIRVANA_PROCEDURAL_GENERATOR_VERSION,
  createNirvanaProceduralSeamContract,
  generateNirvanaProceduralChunk,
  type NirvanaProceduralChunkResult,
  type NirvanaSeamRequest,
} from "./NirvanaProceduralChunk";
import {
  NIRVANA_CHUNK_COLUMNS,
  NIRVANA_CHUNK_ROWS,
  appendNirvanaChunk,
  nirvanaChunkKey,
  type NirvanaCardinalDirection,
  type NirvanaChunk,
  type NirvanaChunkCoord,
  type NirvanaRegionV2,
} from "./NirvanaRegionV2";

/**
 * Nirvana's walk physics.
 *
 * Declared here rather than inferred from the presentation descriptor because the two are
 * genuinely different questions: the presentation descriptor's `topology` has always said
 * "toroidal" (it drives pointer hit-testing), while the CAMERA deliberately stays bounded.
 * This constant is only ever about how a BEING walks.
 */
const NIRVANA_WALK_TOPOLOGY: NavigationTopology = "toroidal";

const GENESIS_WORLD_COLUMNS = 96;
const GENESIS_WORLD_ROWS = 96;
const GENESIS_CHUNK_COLUMNS = 2;
const GENESIS_CHUNK_ROWS = 3;
const DEFAULT_GROWTH_PRESSURE: NirvanaGrowthPressure = Object.freeze({
  populationHighWater: 0,
  builtFootprintHighWater: 0,
});
const CARDINAL_DIRECTIONS: readonly NirvanaCardinalDirection[] = Object.freeze([
  "north",
  "east",
  "south",
  "west",
]);
const DIRECTION_STEP: Readonly<Record<NirvanaCardinalDirection, Readonly<{
  column: number;
  row: number;
  reciprocal: NirvanaCardinalDirection;
}>>> = Object.freeze({
  north: Object.freeze({ column: 0, row: -1, reciprocal: "south" }),
  east: Object.freeze({ column: 1, row: 0, reciprocal: "west" }),
  south: Object.freeze({ column: 0, row: 1, reciprocal: "north" }),
  west: Object.freeze({ column: -1, row: 0, reciprocal: "east" }),
});

const NIRVANA_INITIAL_REGION_SIDECARS = new WeakMap<
  RegionMapRecipeV1,
  NirvanaInitialRegion
>();

registerRegionMapRecipeCloneTransfer((source, clone) => {
  const initial = NIRVANA_INITIAL_REGION_SIDECARS.get(source);
  if (initial !== undefined) NIRVANA_INITIAL_REGION_SIDECARS.set(clone, initial);
});

/** Resolve the semantic scene retained by a trusted Live or Archive recipe clone. */
export function nirvanaInitialRegionSidecar(
  recipe: RegionMapRecipeV1,
): NirvanaInitialRegion | null {
  return NIRVANA_INITIAL_REGION_SIDECARS.get(recipe) ?? null;
}

/** Detach the generic recipe's immutable placement and interaction obligations. */
export function nirvanaMechanicsExclusionsFromRecipe(
  recipe: RegionMapRecipeV1,
): NirvanaMechanicsExclusions {
  const anchors = uniqueSortedTiles([
    ...recipe.arrivalAnchors,
    ...recipe.spawnAnchors,
    ...recipe.socialAnchors,
    ...recipe.resourceAnchors.energy,
    ...recipe.resourceAnchors.materials,
    ...recipe.stagingAnchors,
  ].map(copyTile));
  const standingTiles = uniqueSortedTiles([
    ...anchors,
    ...recipe.gates.map(({ tile }) => copyTile(tile)),
    ...recipe.shelterPlots.flatMap(({ tile, door }) => [copyTile(tile), copyTile(door)]),
  ]);
  const hardTiles = [...new Set([
    ...anchors,
    ...recipe.gates.map(({ tile }) => tile),
    ...recipe.shelterPlots.flatMap(({ tile, door }) => [tile, door]),
  ].map(({ column, row }) => `${column},${row}`))]
    .sort(compareTileKeys);
  const visualRects = [
    ...standingTiles.map((tile) => feetAnchoredVisualRect(tileCenter(tile))),
    ...recipe.shelterPlots.map(({ tile }) => shelterRenderRect(tile)),
    ...recipe.stagingPoints.map(feetAnchoredVisualRect),
  ].map((rect) => Object.freeze({ ...rect }));
  const uniqueVisualRects = [...new Map(visualRects.map((rect) => [
    `${rect.x},${rect.y},${rect.width},${rect.height}`,
    rect,
  ])).values()]
    .sort((left, right) => left.y - right.y || left.x - right.x
      || left.height - right.height || left.width - right.width);
  const shelterPlots = recipe.shelterPlots.map(({ id, tile, door }) => Object.freeze({
    id,
    tile: Object.freeze(copyTile(tile)),
    door: Object.freeze(copyTile(door)),
  })).sort((left, right) => left.id.localeCompare(right.id));
  const stagingPoints = recipe.stagingPoints.map(({ x, y }) => Object.freeze({ x, y }))
    .sort((left, right) => left.y - right.y || left.x - right.x);
  const gates = recipe.gates.map((gate) => Object.freeze({
    edge: Object.freeze({ from: gate.edge.from, to: gate.edge.to }),
    role: gate.role,
    tile: Object.freeze(copyTile(gate.tile)),
    facing: gate.facing,
  })).sort((left, right) => left.edge.from.localeCompare(right.edge.from)
    || left.edge.to.localeCompare(right.edge.to)
    || left.role.localeCompare(right.role)
    || left.tile.row - right.tile.row
    || left.tile.column - right.tile.column);
  return Object.freeze({
    hardTiles: Object.freeze(hardTiles),
    visualRects: Object.freeze(uniqueVisualRects),
    shelterPlots: Object.freeze(shelterPlots),
    stagingPoints: Object.freeze(stagingPoints),
    anchors: Object.freeze(anchors.map((tile) => Object.freeze(tile))),
    gates: Object.freeze(gates),
  });
}

/** Reconstruct or return the trusted semantic static scene associated with a recipe. */
export function createNirvanaInitialRegionForRecipe(
  recipe: RegionMapRecipeV1,
): NirvanaInitialRegion {
  if (recipe.regionId !== "nirvana") {
    throw new Error("Nirvana initial-region reconstruction requires exact region nirvana");
  }
  const trusted = nirvanaInitialRegionSidecar(recipe);
  if (trusted !== null) return trusted;
  if (recipe.presentationProfile?.kind === "nirvana-v2") {
    throw new Error(
      "Nirvana V2 exact recipes require their trusted semantic-scene sidecar",
    );
  }
  return createNirvanaInitialRegion(nirvanaMechanicsExclusionsFromRecipe(recipe));
}

/** Build Nirvana's complete, capacity-derived production recipe. */
export function createNirvanaRegionMapRecipe(
  identity: RegionMapIdentity,
  pressure: NirvanaGrowthPressure = DEFAULT_GROWTH_PRESSURE,
): RegionMapRecipeV1 {
  if (identity.regionId !== "nirvana") {
    throw new Error("Nirvana V2 recipe builder requires exact region nirvana");
  }
  const generic = createRegionMapRecipe(identity);
  const initial = createNirvanaInitialRegion(
    nirvanaMechanicsExclusionsFromRecipe(generic),
  );
  if (
    initial.region.bounds.minTileColumn !== 0
    || initial.region.bounds.minTileRow !== 0
    || initial.region.bounds.columns !== GENESIS_WORLD_COLUMNS
    || initial.region.bounds.rows !== GENESIS_WORLD_ROWS
  ) {
    throw new Error("Nirvana V2 initial region must preserve exact 96x96 production bounds");
  }

  const genesisChunkCollision = compositeCollision(
    initial.region,
    GENESIS_WORLD_COLUMNS,
    GENESIS_WORLD_ROWS,
  );
  const genesisCollision = Uint8Array.from(genesisChunkCollision);
  closeBoundedOuterEdge(
    genesisCollision,
    GENESIS_WORLD_COLUMNS,
    GENESIS_WORLD_ROWS,
  );
  // Topology activation: the ring closes as it always did, then exactly the PROVED
  // reciprocal road ports re-open. `genesisChunkCollision` is the pre-closure mask, so a
  // port can only be re-opened onto ground the chunks already declared walkable.
  openDeclaredWrapSeams(
    genesisCollision,
    genesisChunkCollision,
    GENESIS_WORLD_COLUMNS,
    GENESIS_WORLD_ROWS,
    initial.wrapSeamCandidates,
  );
  const genesisRecipe: RegionMapRecipeV1 = {
    ...generic,
    presentationProfile: {
      kind: "nirvana-v2",
      atlasProfileVersion: 2,
      staticSceneHash: initial.sceneHash,
    },
    grid: {
      columns: GENESIS_WORLD_COLUMNS,
      rows: GENESIS_WORLD_ROWS,
      collision: genesisCollision,
      topology: NIRVANA_WALK_TOPOLOGY,
    },
    pathMask: compositeRoadMask(
      initial.region,
      genesisCollision,
      GENESIS_WORLD_COLUMNS,
      GENESIS_WORLD_ROWS,
    ),
    waterVoidMask: new Uint8Array(GENESIS_WORLD_COLUMNS * GENESIS_WORLD_ROWS),
    soilMask: new Uint8Array(GENESIS_WORLD_COLUMNS * GENESIS_WORLD_ROWS),
    ...suppressedExactPresentation(),
  };
  const growthPlan = planNirvanaGrowth(genesisRecipe, pressure);
  if (growthPlan.addedChunkCoords.length === 0) {
    NIRVANA_INITIAL_REGION_SIDECARS.set(genesisRecipe, initial);
    return genesisRecipe;
  }

  const expanded = expandNirvanaRegion(
    identity.runSeed,
    initial,
    growthPlan,
    generic.districts.length,
  );
  const columns = expanded.sidecar.region.bounds.columns;
  const rows = expanded.sidecar.region.bounds.rows;
  const chunkCollision = compositeCollision(expanded.sidecar.region, columns, rows);
  const collision = Uint8Array.from(chunkCollision);
  closeBoundedOuterEdge(collision, columns, rows);
  // Growth re-publishes the seams at the NEW extent (`createWrapSeamCandidates` runs on
  // the expanded region), so the wrap period follows the region instead of being captured.
  openDeclaredWrapSeams(
    collision,
    chunkCollision,
    columns,
    rows,
    expanded.sidecar.wrapSeamCandidates,
  );
  const districts = Object.freeze([
    ...generic.districts,
    ...expanded.generated.map(({ district }) => district),
  ]);
  const recipe: RegionMapRecipeV1 = {
    ...generic,
    presentationProfile: {
      kind: "nirvana-v2",
      atlasProfileVersion: 2,
      staticSceneHash: expanded.sidecar.sceneHash,
    },
    grid: { columns, rows, collision, topology: NIRVANA_WALK_TOPOLOGY },
    edgeMask: createEdgeMask(columns, rows),
    pathMask: compositeRoadMask(expanded.sidecar.region, collision, columns, rows),
    waterVoidMask: new Uint8Array(columns * rows),
    soilMask: new Uint8Array(columns * rows),
    socialAnchors: districts.flatMap(({ socialAnchors }) => socialAnchors),
    stagingAnchors: districts.flatMap(({ stagingAnchors }) => stagingAnchors),
    stagingPoints: districts.flatMap(({ stagingPoints }) => stagingPoints),
    shelterPlots: districts.flatMap(({ shelterPlots }) => shelterPlots),
    districts,
    ...suppressedExactPresentation(),
  };
  NIRVANA_INITIAL_REGION_SIDECARS.set(recipe, expanded.sidecar);
  return recipe;
}

function suppressedExactPresentation(): Pick<
  RegionMapRecipeV1,
  | "staticScenery"
  | "scenicClusters"
  | "scenicLandmarks"
  | "storyNeighborhoods"
  | "terrainPatches"
  | "visualPathCompositions"
  | "occupiedHomeObligations"
  | "gateStoryTopology"
  | "storyDistricts"
  | "animatedEnvironment"
> {
  return {
    staticScenery: [],
    scenicClusters: [],
    scenicLandmarks: [],
    storyNeighborhoods: [],
    terrainPatches: [],
    visualPathCompositions: [],
    occupiedHomeObligations: [],
    gateStoryTopology: {
      mode: "presentation-deferred",
      reason: "exact-region-scenery-only",
    },
    storyDistricts: [],
    animatedEnvironment: [],
  };
}

interface ExpandedNirvanaRegion {
  readonly sidecar: NirvanaInitialRegion;
  readonly generated: readonly NirvanaProceduralChunkResult[];
}

function expandNirvanaRegion(
  runSeed: number,
  initial: NirvanaInitialRegion,
  plan: NirvanaGrowthPlan,
  baseDistrictCount: number,
): ExpandedNirvanaRegion {
  let region = initial.region;
  let chunkColumns = GENESIS_CHUNK_COLUMNS;
  let chunkRows = GENESIS_CHUNK_ROWS;
  let cursor = 0;
  const generated: NirvanaProceduralChunkResult[] = [];

  while (cursor < plan.addedChunkCoords.length) {
    const first = plan.addedChunkCoords[cursor]!;
    let nextChunkColumns = chunkColumns;
    let nextChunkRows = chunkRows;
    let stripLength: number;
    if (first.column === 0 && first.row === chunkRows) {
      stripLength = chunkColumns;
      nextChunkRows += 1;
    } else if (first.column === chunkColumns && first.row === 0) {
      stripLength = chunkRows;
      nextChunkColumns += 1;
    } else {
      throw new Error(
        `Nirvana growth plan contains a non-rectangular strip at ${nirvanaChunkKey(first)}`,
      );
    }
    const stripCoords = plan.addedChunkCoords.slice(cursor, cursor + stripLength);
    assertCompleteStrip(
      stripCoords,
      chunkColumns,
      chunkRows,
      nextChunkColumns,
      nextChunkRows,
    );
    const stripKeys = new Set(stripCoords.map(nirvanaChunkKey));
    const generatedPairOffsets = new Map<string, readonly number[]>();
    const regionBeforeStrip = region;
    for (const coord of stripCoords) {
      const requests = CARDINAL_DIRECTIONS.map((edge): NirvanaSeamRequest => {
        const neighbor = topologyNeighbor(
          coord,
          edge,
          nextChunkColumns,
          nextChunkRows,
        );
        const existingNeighbor = regionBeforeStrip.chunks.get(
          nirvanaChunkKey(neighbor.coord),
        );
        if (existingNeighbor !== undefined) {
          return {
            edge,
            source: "authored-reciprocal",
            reciprocalOffsets: connectorOffsets(
              existingNeighbor,
              neighbor.reciprocal,
            ),
          };
        }
        if (!stripKeys.has(nirvanaChunkKey(neighbor.coord))) {
          throw new Error(
            `Nirvana growth strip leaves a missing neighbor at ${nirvanaChunkKey(neighbor.coord)}`,
          );
        }
        if (!neighbor.wrapped) {
          return { edge, source: "generated-shared" };
        }
        const pairKey = seamPairKey(
          coord,
          edge,
          neighbor.coord,
          neighbor.reciprocal,
        );
        let offsets = generatedPairOffsets.get(pairKey);
        if (offsets === undefined) {
          const generatedAgreement = createNirvanaProceduralSeamContract({
            runSeed,
            coord,
            edges: [{ edge, source: "generated-shared" }],
          });
          offsets = generatedAgreement.connectors.map(({ offset }) => offset);
          generatedPairOffsets.set(pairKey, offsets);
        }
        return {
          edge,
          source: "authored-reciprocal",
          reciprocalOffsets: offsets,
        };
      });
      const seamContract = createNirvanaProceduralSeamContract({
        runSeed,
        coord,
        edges: requests,
      });
      const result = generateNirvanaProceduralChunk({
        runSeed,
        coord,
        districtIndex: baseDistrictCount + cursor,
        seamContract,
      });
      region = appendNirvanaChunk(region, result.chunk);
      generated.push(result);
      cursor += 1;
    }
    chunkColumns = nextChunkColumns;
    chunkRows = nextChunkRows;
  }

  if (
    chunkColumns !== plan.targetChunkColumns
    || chunkRows !== plan.targetChunkRows
    || region.chunks.size !== chunkColumns * chunkRows
  ) {
    throw new Error("Nirvana expanded region does not match its growth geometry receipt");
  }
  assertToroidalSeams(region, chunkColumns, chunkRows);
  const receipts = Object.freeze(generated.map(
    ({ chunk, district, seamContract, generationHash }): NirvanaGeneratedChunkReceipt =>
      Object.freeze({
        coord: Object.freeze({ ...chunk.coord }),
        districtIndex: district.index,
        chunkContentHash: chunk.contentHash,
        seamContractHash: seamContract.contractHash,
        generationHash,
      }),
  ));
  const growthReceipt: NirvanaRegionGrowthReceipt = Object.freeze({
    version: 1,
    algorithmVersion: plan.algorithmVersion,
    generatorVersion: NIRVANA_PROCEDURAL_GENERATOR_VERSION,
    growthVersion: plan.growthVersion,
    growthHash: plan.growthHash,
    targetChunkColumns: plan.targetChunkColumns,
    targetChunkRows: plan.targetChunkRows,
    generatedChunks: receipts,
  });
  const sidecar: NirvanaInitialRegion = Object.freeze({
    region,
    sceneHash: stableHash({
      genesisSceneHash: initial.sceneHash,
      growthReceipt,
      bounds: region.bounds,
    }),
    wrapSeamCandidates: createWrapSeamCandidates(region, chunkColumns, chunkRows),
    macroRoles: initial.macroRoles,
    localSemanticDigests: immutableMap([
      ...initial.localSemanticDigests,
      ...generated.map(({ chunk, generationHash }) =>
        [nirvanaChunkKey(chunk.coord), generationHash] as const),
    ]),
    rootAdaptations: initial.rootAdaptations,
    growthReceipt,
  });
  return Object.freeze({ sidecar, generated: Object.freeze(generated) });
}

function assertCompleteStrip(
  coords: readonly NirvanaChunkCoord[],
  oldColumns: number,
  oldRows: number,
  nextColumns: number,
  nextRows: number,
): void {
  const expected = nextRows > oldRows
    ? Array.from({ length: oldColumns }, (_, column) => ({ column, row: oldRows }))
    : Array.from({ length: oldRows }, (_, row) => ({ column: oldColumns, row }));
  if (
    coords.length !== expected.length
    || coords.some((coord, index) =>
      coord.column !== expected[index]!.column || coord.row !== expected[index]!.row)
    || nextColumns * nextRows - oldColumns * oldRows !== coords.length
  ) {
    throw new Error("Nirvana growth must append one complete rectangular strip");
  }
}

function topologyNeighbor(
  coord: NirvanaChunkCoord,
  edge: NirvanaCardinalDirection,
  chunkColumns: number,
  chunkRows: number,
): Readonly<{
  coord: NirvanaChunkCoord;
  reciprocal: NirvanaCardinalDirection;
  wrapped: boolean;
}> {
  const step = DIRECTION_STEP[edge];
  const rawColumn = coord.column + step.column;
  const rawRow = coord.row + step.row;
  return Object.freeze({
    coord: Object.freeze({
      column: positiveModulo(rawColumn, chunkColumns),
      row: positiveModulo(rawRow, chunkRows),
    }),
    reciprocal: step.reciprocal,
    wrapped: rawColumn < 0 || rawColumn >= chunkColumns
      || rawRow < 0 || rawRow >= chunkRows,
  });
}

function seamPairKey(
  coord: NirvanaChunkCoord,
  edge: NirvanaCardinalDirection,
  neighbor: NirvanaChunkCoord,
  reciprocal: NirvanaCardinalDirection,
): string {
  return [
    `${nirvanaChunkKey(coord)}:${edge}`,
    `${nirvanaChunkKey(neighbor)}:${reciprocal}`,
  ].sort().join("|");
}

function connectorOffsets(
  chunk: NirvanaChunk,
  edge: NirvanaCardinalDirection,
): readonly number[] {
  return chunk.connectors
    .filter((connector) => connector.edge === edge)
    .map(({ offset }) => offset)
    .sort((left, right) => left - right);
}

function assertToroidalSeams(
  region: NirvanaRegionV2,
  chunkColumns: number,
  chunkRows: number,
): void {
  for (let row = 0; row < chunkRows; row += 1) {
    assertSameOffsets(
      connectorOffsets(region.chunks.get(`0,${row}`)!, "west"),
      connectorOffsets(region.chunks.get(`${chunkColumns - 1},${row}`)!, "east"),
      `horizontal torus row ${row}`,
    );
  }
  for (let column = 0; column < chunkColumns; column += 1) {
    assertSameOffsets(
      connectorOffsets(region.chunks.get(`${column},0`)!, "north"),
      connectorOffsets(region.chunks.get(`${column},${chunkRows - 1}`)!, "south"),
      `vertical torus column ${column}`,
    );
  }
}

function assertSameOffsets(
  left: readonly number[],
  right: readonly number[],
  label: string,
): void {
  if (
    left.length !== right.length
    || left.some((offset, index) => offset !== right[index])
  ) {
    throw new Error(`Nirvana ${label} must use reciprocal road ports`);
  }
}

function createWrapSeamCandidates(
  region: NirvanaRegionV2,
  chunkColumns: number,
  chunkRows: number,
): readonly NirvanaSeamCandidate[] {
  const candidates: NirvanaSeamCandidate[] = [];
  for (let row = 0; row < chunkRows; row += 1) {
    for (const offset of connectorOffsets(region.chunks.get(`0,${row}`)!, "west")) {
      candidates.push(Object.freeze({
        axis: "x",
        negativeEdgeTile: Object.freeze({
          column: 0,
          row: row * NIRVANA_CHUNK_ROWS + offset,
        }),
        positiveEdgeTile: Object.freeze({
          column: chunkColumns * NIRVANA_CHUNK_COLUMNS - 1,
          row: row * NIRVANA_CHUNK_ROWS + offset,
        }),
      }));
    }
  }
  for (let column = 0; column < chunkColumns; column += 1) {
    for (const offset of connectorOffsets(region.chunks.get(`${column},0`)!, "north")) {
      candidates.push(Object.freeze({
        axis: "y",
        negativeEdgeTile: Object.freeze({
          column: column * NIRVANA_CHUNK_COLUMNS + offset,
          row: 0,
        }),
        positiveEdgeTile: Object.freeze({
          column: column * NIRVANA_CHUNK_COLUMNS + offset,
          row: chunkRows * NIRVANA_CHUNK_ROWS - 1,
        }),
      }));
    }
  }
  return Object.freeze(candidates);
}

function compositeCollision(
  region: NirvanaRegionV2,
  columns: number,
  rows: number,
): Uint8Array {
  const collision = new Uint8Array(columns * rows);
  collision.fill(1);
  for (const chunk of region.chunks.values()) {
    for (let row = 0; row < NIRVANA_CHUNK_ROWS; row += 1) {
      for (let column = 0; column < NIRVANA_CHUNK_COLUMNS; column += 1) {
        const worldColumn = chunk.coord.column * NIRVANA_CHUNK_COLUMNS + column;
        const worldRow = chunk.coord.row * NIRVANA_CHUNK_ROWS + row;
        collision[worldRow * columns + worldColumn] =
          chunk.collision[row * NIRVANA_CHUNK_COLUMNS + column]!;
      }
    }
  }
  return collision;
}

function compositeRoadMask(
  region: NirvanaRegionV2,
  collision: Uint8Array,
  columns: number,
  rows: number,
): Uint8Array {
  const pathMask = new Uint8Array(columns * rows);
  for (const chunk of region.chunks.values()) {
    for (const road of chunk.roadCells) {
      const column = chunk.coord.column * NIRVANA_CHUNK_COLUMNS + road.tile.column;
      const row = chunk.coord.row * NIRVANA_CHUNK_ROWS + road.tile.row;
      const index = row * columns + column;
      if (collision[index] === 0) pathMask[index] = 1;
    }
  }
  return pathMask;
}

function createEdgeMask(columns: number, rows: number): Uint8Array {
  const edgeMask = new Uint8Array(columns * rows);
  for (let column = 0; column < columns; column += 1) {
    edgeMask[column] = 1;
    edgeMask[(rows - 1) * columns + column] = 1;
  }
  for (let row = 0; row < rows; row += 1) {
    edgeMask[row * columns] = 1;
    edgeMask[row * columns + columns - 1] = 1;
  }
  return edgeMask;
}

function closeBoundedOuterEdge(
  collision: Uint8Array,
  columns: number,
  rows: number,
): void {
  for (let column = 0; column < columns; column += 1) {
    collision[column] = 1;
    collision[(rows - 1) * columns + column] = 1;
  }
  for (let row = 0; row < rows; row += 1) {
    collision[row * columns] = 1;
    collision[row * columns + columns - 1] = 1;
  }
}

function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

function copyTile<T extends Readonly<{ column: number; row: number }>>(
  tile: T,
): { column: number; row: number } {
  return { column: tile.column, row: tile.row };
}

function uniqueSortedTiles<T extends { column: number; row: number }>(tiles: T[]): T[] {
  return [...new Map(tiles.map((tile) => [`${tile.column},${tile.row}`, tile])).values()]
    .sort((left, right) => left.row - right.row || left.column - right.column);
}

function compareTileKeys(left: string, right: string): number {
  const [leftColumn, leftRow] = left.split(",").map(Number);
  const [rightColumn, rightRow] = right.split(",").map(Number);
  return leftRow! - rightRow! || leftColumn! - rightColumn!;
}

function immutableMap<K, V>(
  entries: readonly (readonly [K, V])[],
): ReadonlyMap<K, V> {
  const source = new Map(entries);
  let view: ReadonlyMap<K, V>;
  view = Object.freeze({
    get size(): number { return source.size; },
    get(key: K): V | undefined { return source.get(key); },
    has(key: K): boolean { return source.has(key); },
    entries(): MapIterator<[K, V]> { return source.entries(); },
    keys(): MapIterator<K> { return source.keys(); },
    values(): MapIterator<V> { return source.values(); },
    forEach(
      callback: (value: V, key: K, map: ReadonlyMap<K, V>) => void,
      thisArg?: unknown,
    ): void {
      source.forEach((value, key) => callback.call(thisArg, value, key, view));
    },
    [Symbol.iterator](): MapIterator<[K, V]> { return source[Symbol.iterator](); },
    [Symbol.toStringTag]: "Map",
  });
  return view;
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
