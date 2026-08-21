/**
 * Bind Nirvana's region-wide genesis terrain field to its per-chunk authoring.
 *
 * The field (`NirvanaTerrainField`) is a 96x96 world-coordinate computation: a river has
 * to be one continuous body across chunk seams, and connectivity can only be proved on
 * the whole region. Chunks, however, are authored independently and hashed locally. This
 * module is the seam between the two, and it owns three jobs:
 *
 *  1. **What terrain may never touch.** It reads the region's mechanics geometry — the
 *     real `shelterRenderRect` footprints, anchors, gates, staging points, doors — plus
 *     the authored roads, dry swales and chunk connectors, and hands the field a single
 *     protection mask. Everything downstream of that mask is structurally legal.
 *  2. **A terrain verdict on the authored macro landmarks.** A wood cannot stand in a
 *     river, so each authored landmark is offered to the field and either retained or
 *     retired.
 *  3. **Slicing.** Per chunk it emits the terrain cells (base fill + corner-masked
 *     overlays + waterlines), the ground scenery, and the collision mask.
 *
 * The two-pass shape is forced and deliberate: the field needs the roads and landmarks,
 * which only the chunk builders know, so the builders run once WITHOUT a field to declare
 * their geometry, and again WITH it to publish their art and their walkability. Both
 * passes are pure functions of the same mechanics exclusions, so the result is
 * reproducible and the field is memoised across them.
 *
 * Plan: `docs/superpowers/plans/2026-07-26-nirvana-production-terrain.md` §P3.
 */

import { shelterRenderRect } from "../productionGeometry";
import type { NirvanaMechanicsExclusions } from "./NirvanaInitialRegion";
import {
  NIRVANA_CHUNK_COLUMNS,
  NIRVANA_CHUNK_ROWS,
  NIRVANA_TILE_SIZE,
  type NirvanaCardinalDirection,
  type NirvanaChunk,
  type NirvanaChunkConnector,
  type NirvanaLandmarkPlacement,
  type NirvanaScenerySprite,
  type NirvanaTerrainCell,
  type NirvanaTerrainOverlay,
  type NirvanaTileCoordinate,
} from "./NirvanaRegionV2";
import {
  createNirvanaTerrainField,
  deriveNirvanaTerrainTileFromCorners,
  nirvanaGrownCornerMaterial,
  type NirvanaTerrainField,
  type NirvanaTerrainLandmarkCandidate,
  type NirvanaTerrainLandmarkStance,
  type NirvanaTerrainMaterial,
} from "./NirvanaTerrainField";

/** An authored dry channel tile: it keeps its channel kind over the field's own fill. */
export interface NirvanaChannelCell {
  readonly kind: "dry-swale" | "ford";
  readonly connections: readonly NirvanaCardinalDirection[];
}

/**
 * A placeholder cell for the field-free first pass.
 *
 * The first pass exists only to declare roads, channels, connectors and landmarks; its
 * terrain is never painted and never hashed into a published chunk. `grass` is used so
 * the pass still produces a structurally valid chunk.
 */
export function nirvanaPlaceholderTerrainCell(
  tile: NirvanaTileCoordinate,
  channel: NirvanaChannelCell | undefined,
): NirvanaTerrainCell {
  return Object.freeze({
    tile,
    kind: channel === undefined ? "grass" : channel.kind,
    variant: 0,
    base: "grass",
    overlays: EMPTY_OVERLAYS,
    shorelines: EMPTY_OVERLAYS,
    ...(channel === undefined ? {} : { connections: channel.connections }),
  });
}

const EMPTY_OVERLAYS: readonly NirvanaTerrainOverlay[] = Object.freeze([]);

/** One chunk's declared geometry, as read from the field-free first pass. */
export interface NirvanaChunkGeometry {
  readonly coord: Readonly<{ column: number; row: number }>;
  readonly roadTiles: readonly NirvanaTileCoordinate[];
  /** Dry swale and ford tiles: walkable authored channels terrain must not flood. */
  readonly channelTiles: readonly NirvanaTileCoordinate[];
  readonly connectors: readonly NirvanaChunkConnector[];
  readonly landmarks: readonly NirvanaLandmarkPlacement[];
  /**
   * The same landmarks rebuilt at their authored ALTERNATIVE homes, by id.
   *
   * Offered to the field alongside the authored placements so that a landmark whose
   * authored ground the river took is relocated rather than retired. Only landmarks with
   * an entry in `NirvanaLandmarkRelocation` appear here; the rest have no alternative and
   * the field's verdict on their authored ground is final.
   */
  readonly relocations: ReadonlyMap<string, NirvanaLandmarkPlacement>;
}

/** Landmark sprite feet are 4px above the frame's bottom edge, as the painter sorts. */
const LANDMARK_FOOT_INSET = 4;
const LANDMARK_FRAME_SIZE = 128;

/**
 * Read one chunk's geometry out of a built chunk.
 *
 * Only its roads, channels, connectors and landmarks are consulted, never its terrain or
 * collision.
 *
 * `relocations` is REQUIRED rather than defaulted. A built chunk cannot know its own
 * relocation table — it publishes ONE placement per landmark, not two — and silently
 * reading an empty one would hand the field a different landmark verdict from the one the
 * chunk builders declare: the published picture and the proved walkability would drift
 * apart with nothing failing. Callers must say which table applies, or pass
 * `NO_RELOCATIONS` to mean "this chunk genuinely has none".
 */
export function nirvanaChunkGeometry(
  chunk: NirvanaChunk,
  relocations: ReadonlyMap<string, NirvanaLandmarkPlacement>,
): NirvanaChunkGeometry {
  const channelTiles: NirvanaTileCoordinate[] = [];
  for (const cell of chunk.terrainCells) {
    if (cell.kind !== "dry-swale" && cell.kind !== "ford") continue;
    channelTiles.push(cell.tile);
  }
  return Object.freeze({
    coord: Object.freeze({ column: chunk.coord.column, row: chunk.coord.row }),
    roadTiles: Object.freeze(chunk.roadCells.map(({ tile }) => tile)),
    channelTiles: Object.freeze(channelTiles),
    connectors: chunk.connectors,
    landmarks: chunk.landmarks,
    relocations,
  });
}

/** Shared empty relocation table for callers that declare geometry without one. */
export const NO_RELOCATIONS: ReadonlyMap<string, NirvanaLandmarkPlacement> =
  Object.freeze(new Map<string, NirvanaLandmarkPlacement>());

/**
 * Build the genesis terrain field for one 96x96 Nirvana from its mechanics and geometry.
 *
 * Side effects: none; memoised inside `createNirvanaTerrainField` on a digest of exactly
 * these inputs.
 */
export function createNirvanaGenesisTerrainField(
  exclusions: NirvanaMechanicsExclusions,
  geometry: readonly NirvanaChunkGeometry[],
  columns: number,
  rows: number,
): NirvanaTerrainField {
  const protectedTiles = new Uint8Array(columns * rows);
  const roadTiles = new Uint8Array(columns * rows);
  const mark = (mask: Uint8Array, column: number, row: number): void => {
    if (column < 0 || row < 0 || column >= columns || row >= rows) return;
    mask[row * columns + column] = 1;
  };

  // --- mechanics: every tile a home, a door, an anchor, a gate or a staging point needs
  for (const key of exclusions.hardTiles) {
    const [column, row] = key.split(",").map(Number);
    if (column === undefined || row === undefined) continue;
    mark(protectedTiles, column, row);
  }
  for (const anchor of exclusions.anchors) mark(protectedTiles, anchor.column, anchor.row);
  for (const gate of exclusions.gates) mark(protectedTiles, gate.tile.column, gate.tile.row);
  for (const point of exclusions.stagingPoints) {
    mark(
      protectedTiles,
      Math.floor(point.x / NIRVANA_TILE_SIZE),
      Math.floor(point.y / NIRVANA_TILE_SIZE),
    );
  }
  for (const plot of exclusions.shelterPlots) {
    mark(protectedTiles, plot.tile.column, plot.tile.row);
    mark(protectedTiles, plot.door.column, plot.door.row);
    // The REAL rendered footprint, not an assumed 4x4: a home is drawn 128px wide from a
    // rect the renderer owns, and terrain under any of it would show through the walls.
    const rect = shelterRenderRect(plot.tile);
    const firstColumn = Math.floor(rect.x / NIRVANA_TILE_SIZE);
    const lastColumn = Math.floor((rect.x + rect.width - 1) / NIRVANA_TILE_SIZE);
    const firstRow = Math.floor(rect.y / NIRVANA_TILE_SIZE);
    const lastRow = Math.floor((rect.y + rect.height - 1) / NIRVANA_TILE_SIZE);
    for (let row = firstRow; row <= lastRow; row += 1) {
      for (let column = firstColumn; column <= lastColumn; column += 1) {
        mark(protectedTiles, column, row);
      }
    }
  }

  // --- authored geometry: roads, dry channels, and every chunk connector
  for (const chunk of geometry) {
    const originColumn = chunk.coord.column * NIRVANA_CHUNK_COLUMNS;
    const originRow = chunk.coord.row * NIRVANA_CHUNK_ROWS;
    for (const tile of chunk.roadTiles) {
      mark(roadTiles, originColumn + tile.column, originRow + tile.row);
      mark(protectedTiles, originColumn + tile.column, originRow + tile.row);
    }
    for (const tile of chunk.channelTiles) {
      mark(protectedTiles, originColumn + tile.column, originRow + tile.row);
    }
    for (const connector of chunk.connectors) {
      const tile = connectorTile(connector);
      mark(protectedTiles, originColumn + tile.column, originRow + tile.row);
    }
  }

  return createNirvanaTerrainField({
    columns,
    rows,
    protectedTiles,
    roadTiles,
    landmarkCandidates: landmarkCandidates(geometry, columns, rows),
  });
}

/** The world tiles under a chunk's landmark collision and under each of its sprite feet. */
function landmarkCandidates(
  geometry: readonly NirvanaChunkGeometry[],
  columns: number,
  rows: number,
): readonly NirvanaTerrainLandmarkCandidate[] {
  const candidates: NirvanaTerrainLandmarkCandidate[] = [];
  for (const chunk of geometry) {
    for (const landmark of chunk.landmarks) {
      const relocated = chunk.relocations.get(landmark.id);
      candidates.push(Object.freeze({
        id: nirvanaLandmarkCandidateId(chunk.coord, landmark.id),
        ...landmarkStance(chunk.coord, landmark, columns, rows),
        ...(relocated === undefined
          ? {}
          : { relocation: landmarkStance(chunk.coord, relocated, columns, rows) }),
      }));
    }
  }
  return Object.freeze(candidates);
}

/** One placement's world-coordinate collision tiles and sprite-foot tiles. */
function landmarkStance(
  coord: Readonly<{ column: number; row: number }>,
  landmark: NirvanaLandmarkPlacement,
  columns: number,
  rows: number,
): NirvanaTerrainLandmarkStance {
  const originColumn = coord.column * NIRVANA_CHUNK_COLUMNS;
  const originRow = coord.row * NIRVANA_CHUNK_ROWS;
  const footTiles: NirvanaTileCoordinate[] = [];
  for (const visual of landmark.visuals) {
    const size = LANDMARK_FRAME_SIZE * visual.scale;
    const footX = originColumn * NIRVANA_TILE_SIZE + visual.at.x + size / 2;
    const footY = originRow * NIRVANA_TILE_SIZE + visual.at.y + size - LANDMARK_FOOT_INSET;
    const column = Math.floor(footX / NIRVANA_TILE_SIZE);
    const row = Math.floor(footY / NIRVANA_TILE_SIZE);
    if (column < 0 || row < 0 || column >= columns || row >= rows) continue;
    footTiles.push(Object.freeze({ column, row }));
  }
  return Object.freeze({
    collisionTiles: Object.freeze(landmark.collisionTiles.map(({ column, row }) =>
      Object.freeze({ column: originColumn + column, row: originRow + row }))),
    footTiles: Object.freeze(footTiles),
  });
}

/** The field keys landmarks by chunk so two chunks may reuse a landmark ID. */
export function nirvanaLandmarkCandidateId(
  coord: Readonly<{ column: number; row: number }>,
  landmarkId: string,
): string {
  return `${coord.column},${coord.row}:${landmarkId}`;
}

/**
 * True unless the field's water verdict explicitly RETIRED this authored landmark.
 *
 * Stated as "not retired" rather than "retained" on purpose: a landmark the field was
 * never offered — the root's audited boundary removals, for instance — is unjudged, and
 * an unjudged landmark must survive rather than silently disappear.
 */
export function nirvanaLandmarkSurvivesTerrain(
  field: NirvanaTerrainField | null,
  coord: Readonly<{ column: number; row: number }>,
  landmarkId: string,
): boolean {
  if (field === null) return true;
  return !field.retiredLandmarkIds.has(nirvanaLandmarkCandidateId(coord, landmarkId));
}

/**
 * Resolve which placement of one authored landmark a chunk must publish.
 *
 * Three outcomes, and they are the field's to decide, not the chunk's:
 *  - the authored placement, when its ground is dry (or when there is no field yet);
 *  - the RELOCATED placement, when the river took the authored ground and the authored
 *    alternative is dry — the field routed around that footprint, so publishing anything
 *    else would put the picture and the proved walkability out of step;
 *  - `null`, when both are drowned, i.e. the landmark is retired.
 *
 * @param field The genesis terrain field, or `null` on the geometry-declaring first pass.
 * @param coord The chunk that owns the landmark.
 * @param landmark The authored placement.
 * @param relocations The chunk's relocation table.
 * @returns The placement to publish, or `null` to retire it.
 * @throws NirvanaTerrainChunksError if the field relocated a landmark this chunk has no
 *   relocation for — a silent fallback there would publish a landmark on ground the field
 *   never cleared.
 */
export function nirvanaLandmarkForTerrain(
  field: NirvanaTerrainField | null,
  coord: Readonly<{ column: number; row: number }>,
  landmark: NirvanaLandmarkPlacement,
  relocations: ReadonlyMap<string, NirvanaLandmarkPlacement>,
): NirvanaLandmarkPlacement | null {
  if (field === null) return landmark;
  const id = nirvanaLandmarkCandidateId(coord, landmark.id);
  if (field.retiredLandmarkIds.has(id)) return null;
  if (!field.relocatedLandmarkIds.has(id)) return landmark;
  const relocated = relocations.get(landmark.id);
  if (relocated === undefined) {
    throw new NirvanaTerrainChunksError(
      `Nirvana terrain relocated ${id} but the chunk declares no relocation for it.`,
    );
  }
  return relocated;
}

/** Raised when a chunk and its terrain field disagree about an authored landmark. */
export class NirvanaTerrainChunksError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "NirvanaTerrainChunksError";
  }
}

/**
 * Slice one chunk's terrain cells out of the region field.
 *
 * `channelKinds` carries the authored dry-swale / ford verdict for tiles the chunk owns:
 * those tiles keep their channel `kind` and connections and are painted with the swale
 * frame ON TOP of the field's own fill, so the sward reads continuously underneath a dry
 * riverbed instead of the bed punching a hole in the picture.
 */
export function nirvanaTerrainCellsFromField(
  field: NirvanaTerrainField,
  coord: Readonly<{ column: number; row: number }>,
  channelKinds: ReadonlyMap<string, NirvanaChannelCell>,
): readonly NirvanaTerrainCell[] {
  const originColumn = coord.column * NIRVANA_CHUNK_COLUMNS;
  const originRow = coord.row * NIRVANA_CHUNK_ROWS;
  const cells: NirvanaTerrainCell[] = [];
  for (let row = 0; row < NIRVANA_CHUNK_ROWS; row += 1) {
    for (let column = 0; column < NIRVANA_CHUNK_COLUMNS; column += 1) {
      const tile = field.tileAt(originColumn + column, originRow + row);
      const channel = channelKinds.get(`${column},${row}`);
      cells.push(Object.freeze({
        tile: Object.freeze({ column, row }),
        kind: channel === undefined ? tile.material : channel.kind,
        variant: tile.baseVariant,
        base: tile.base,
        overlays: tile.overlays,
        shorelines: tile.shorelines,
        ...(channel === undefined ? {} : { connections: channel.connections }),
      }));
    }
  }
  return Object.freeze(cells);
}

/** Slice one chunk's ground scenery out of the region field, in paint order. */
export function nirvanaSceneryFromField(
  field: NirvanaTerrainField,
  coord: Readonly<{ column: number; row: number }>,
): readonly NirvanaScenerySprite[] {
  const originColumn = coord.column * NIRVANA_CHUNK_COLUMNS;
  const originRow = coord.row * NIRVANA_CHUNK_ROWS;
  const originX = originColumn * NIRVANA_TILE_SIZE;
  const originY = originRow * NIRVANA_TILE_SIZE;
  const sprites: NirvanaScenerySprite[] = [];
  for (const prop of field.props) {
    const column = prop.tile.column - originColumn;
    const row = prop.tile.row - originRow;
    if (column < 0 || row < 0 || column >= NIRVANA_CHUNK_COLUMNS || row >= NIRVANA_CHUNK_ROWS) {
      continue;
    }
    sprites.push(Object.freeze({
      id: prop.id,
      frameId: prop.frameId,
      at: Object.freeze({ x: prop.x - originX, y: prop.y - originY }),
      foot: Object.freeze({ x: prop.footX - originX, y: prop.footY - originY }),
      blocksMovement: prop.blocks,
      tile: Object.freeze({ column, row }),
    }));
  }
  return Object.freeze(sprites);
}

/**
 * Compose one chunk's collision: terrain, its retained landmarks, its blocking scenery.
 *
 * The region's outer rim is deliberately left as the field emits it — open unless
 * something genuinely blocks there — because `NirvanaRegionMapRecipe` closes the rim on
 * the composed region and `createNirvanaChunk` rejects a chunk whose connector tile is
 * closed.
 */
export function nirvanaChunkCollisionFromField(
  field: NirvanaTerrainField,
  coord: Readonly<{ column: number; row: number }>,
  landmarks: readonly NirvanaLandmarkPlacement[],
  scenery: readonly NirvanaScenerySprite[],
): readonly (0 | 1)[] {
  const originColumn = coord.column * NIRVANA_CHUNK_COLUMNS;
  const originRow = coord.row * NIRVANA_CHUNK_ROWS;
  const collision: (0 | 1)[] = [];
  for (let row = 0; row < NIRVANA_CHUNK_ROWS; row += 1) {
    for (let column = 0; column < NIRVANA_CHUNK_COLUMNS; column += 1) {
      const index = (originRow + row) * field.columns + (originColumn + column);
      collision.push(field.collision[index] === 1 ? 1 : 0);
    }
  }
  for (const landmark of landmarks) {
    for (const tile of landmark.collisionTiles) {
      collision[tile.row * NIRVANA_CHUNK_COLUMNS + tile.column] = 1;
    }
  }
  for (const sprite of scenery) {
    if (!sprite.blocksMovement) continue;
    collision[sprite.tile.row * NIRVANA_CHUNK_COLUMNS + sprite.tile.column] = 1;
  }
  return Object.freeze(collision);
}

/**
 * Derive one GROWN chunk's terrain cells from world-continuous, non-blocking materials.
 *
 * The corner field is sampled in WORLD coordinates so a tonal passage or a shingle bed
 * runs across the growth seam instead of stopping at it, and it draws only from
 * `NIRVANA_GROWN_TERRAIN_MATERIALS` — every one of which is walkable. So a grown chunk
 * paints the full new vocabulary while its collision stays exactly what it is today
 * (landmarks only) and growth cannot sever the walkable set.
 */
export function nirvanaGrownTerrainCells(
  coord: Readonly<{ column: number; row: number }>,
  channelKinds: ReadonlyMap<string, NirvanaChannelCell>,
): readonly NirvanaTerrainCell[] {
  const originColumn = coord.column * NIRVANA_CHUNK_COLUMNS;
  const originRow = coord.row * NIRVANA_CHUNK_ROWS;
  const corners: NirvanaTerrainMaterial[] = new Array(
    (NIRVANA_CHUNK_COLUMNS + 1) * (NIRVANA_CHUNK_ROWS + 1),
  );
  for (let row = 0; row <= NIRVANA_CHUNK_ROWS; row += 1) {
    for (let column = 0; column <= NIRVANA_CHUNK_COLUMNS; column += 1) {
      corners[row * (NIRVANA_CHUNK_COLUMNS + 1) + column] = nirvanaGrownCornerMaterial(
        originColumn + column,
        originRow + row,
      );
    }
  }
  const cornerAt = (column: number, row: number): NirvanaTerrainMaterial =>
    corners[row * (NIRVANA_CHUNK_COLUMNS + 1) + column]!;

  const cells: NirvanaTerrainCell[] = [];
  for (let row = 0; row < NIRVANA_CHUNK_ROWS; row += 1) {
    for (let column = 0; column < NIRVANA_CHUNK_COLUMNS; column += 1) {
      const derived = deriveNirvanaTerrainTileFromCorners(column, row, [
        cornerAt(column, row),
        cornerAt(column + 1, row),
        cornerAt(column + 1, row + 1),
        cornerAt(column, row + 1),
      ]);
      const channel = channelKinds.get(`${column},${row}`);
      cells.push(Object.freeze({
        tile: Object.freeze({ column, row }),
        kind: channel === undefined ? derived.material : channel.kind,
        variant: derived.baseVariant,
        base: derived.base,
        overlays: derived.overlays,
        shorelines: derived.shorelines,
        ...(channel === undefined ? {} : { connections: channel.connections }),
      }));
    }
  }
  return Object.freeze(cells);
}

/**
 * Scatter non-blocking ground scenery over one grown chunk.
 *
 * Non-blocking only, and never on a protected tile, so grown collision is untouched: the
 * apron reads as living ground without adding a single obstacle a pathfinder must solve.
 */
export function nirvanaGrownScenery(
  coord: Readonly<{ column: number; row: number }>,
  cells: readonly NirvanaTerrainCell[],
  isProtected: (tile: NirvanaTileCoordinate) => boolean,
): readonly NirvanaScenerySprite[] {
  const originColumn = coord.column * NIRVANA_CHUNK_COLUMNS;
  const originRow = coord.row * NIRVANA_CHUNK_ROWS;
  const sprites: NirvanaScenerySprite[] = [];
  for (const cell of cells) {
    if (cell.kind === "dry-swale" || cell.kind === "ford") continue;
    if (isProtected(cell.tile)) continue;
    const worldColumn = originColumn + cell.tile.column;
    const worldRow = originRow + cell.tile.row;
    const species = grownSpeciesFor(cell.base, worldColumn, worldRow);
    if (species === null) continue;
    const pivot = NIRVANA_GROWN_SCENERY_PIVOTS[species.id]!;
    const footX = cell.tile.column * NIRVANA_TILE_SIZE + NIRVANA_TILE_SIZE / 2
      + Math.round((grownHash(worldColumn, worldRow, 71) - 0.5) * 16);
    const footY = cell.tile.row * NIRVANA_TILE_SIZE + NIRVANA_TILE_SIZE / 2
      + Math.round((grownHash(worldColumn, worldRow, 83) - 0.5) * 12);
    sprites.push(Object.freeze({
      id: `${species.id}:${cell.tile.column},${cell.tile.row}`,
      frameId: `s.${species.id}.${species.variant}`,
      at: Object.freeze({ x: footX - pivot[0], y: footY - pivot[1] }),
      foot: Object.freeze({ x: footX, y: footY }),
      blocksMovement: false,
      tile: cell.tile,
    }));
  }
  sprites.sort((left, right) => left.foot.y - right.foot.y
    || left.foot.x - right.foot.x
    || left.id.localeCompare(right.id));
  return Object.freeze(sprites);
}

/** Pivots for the non-blocking species grown ground may use; must match the generation. */
const NIRVANA_GROWN_SCENERY_PIVOTS: Readonly<Record<string, readonly [number, number]>> =
  Object.freeze({
    tuft: [12, 16],
    flowerdrift: [28, 37],
    cobble: [10, 12],
    shrub: [24, 45],
  });

function grownSpeciesFor(
  base: NirvanaTerrainMaterial,
  column: number,
  row: number,
): Readonly<{ id: string; variant: number }> | null {
  const roll = grownHash(column, row, 29);
  if (base === "gravel" || base === "silt") {
    if (roll > 0.72) return { id: "cobble", variant: Math.floor(grownHash(column, row, 31) * 4) % 4 };
    if (roll > 0.58) return { id: "tuft", variant: Math.floor(grownHash(column, row, 37) * 4) % 4 };
    return null;
  }
  if (base === "meadow") {
    if (roll > 0.76) {
      return { id: "flowerdrift", variant: Math.floor(grownHash(column, row, 41) * 6) % 6 };
    }
    if (roll > 0.60) return { id: "tuft", variant: Math.floor(grownHash(column, row, 43) * 4) % 4 };
    return null;
  }
  if (roll > 0.90) return { id: "shrub", variant: Math.floor(grownHash(column, row, 47) * 6) % 6 };
  if (roll > 0.74) return { id: "tuft", variant: Math.floor(grownHash(column, row, 53) * 4) % 4 };
  return null;
}

function grownHash(column: number, row: number, salt: number): number {
  let hash = (Math.imul(column | 0, 0x27d4_eb2d)
    ^ Math.imul(row | 0, 0x1656_67b1)
    ^ Math.imul(salt | 0, 0x9e37_79b1)) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 15), 0x85eb_ca6b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2_ae35) >>> 0;
  return ((hash ^ (hash >>> 16)) >>> 0) / 0xffff_ffff;
}

function connectorTile(connector: NirvanaChunkConnector): NirvanaTileCoordinate {
  switch (connector.edge) {
    case "north": return Object.freeze({ column: connector.offset, row: 0 });
    case "east": return Object.freeze({
      column: NIRVANA_CHUNK_COLUMNS - 1,
      row: connector.offset,
    });
    case "south": return Object.freeze({
      column: connector.offset,
      row: NIRVANA_CHUNK_ROWS - 1,
    });
    case "west": return Object.freeze({ column: 0, row: connector.offset });
  }
}
