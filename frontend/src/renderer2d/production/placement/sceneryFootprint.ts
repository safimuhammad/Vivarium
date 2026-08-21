/**
 * @fileoverview The SHARED, region-agnostic ground-contact footprint for illustrated
 * scenery objects — one implementation, consumed by every region.
 *
 * ## The defect this exists to remove
 *
 * Two region pilots independently recorded the same fault, in the same words:
 *
 * > *"A landform blocks a footprint but is drawn much larger than it. The mesa's cast
 * > shadow, talus and cap overhang all extend past the blocking ellipse, so a being will
 * > walk through the skirt of a cliff."* — `nirvana-east-pilot-report.md` §P2.8
 *
 * The Nirvana West pilot found the identical thing for its ruins and cooling towers. The
 * general shape of the bug: a prop's collision is **one tile** (the tile its foot pivot
 * lands in) while the sprite is drawn **two to five tiles wide**, so beings walk through
 * the parts of the object that are not directly under the pivot. Both reports concluded
 * that productionisation needs a per-species footprint rect *once, not twice*. This module
 * is that once.
 *
 * ## What it actually computes
 *
 * A drawn sprite is a picture of a solid thing standing on the ground. Only part of that
 * picture is **ground contact**: a mesa's cliff wall rises above its cap plan, its cast
 * shadow and talus apron spill past the rock, and its pivot sits at the sprite's foot, not
 * at the centre of the mass. So the contact region is declared as a {@link
 * SceneryContactModel} — a shape, a centre and half-extents, all as FRACTIONS OF THE
 * DRAWN FRAME — and this module converts that plus the frame's own geometry into tiles.
 *
 * Fractions rather than absolute pixels is the load-bearing choice: an object's size is
 * retuned during authoring (Nirvana East's mesa went from 256x208 to 512x384 mid-pilot, a
 * 3.7x change in pixels), and a fraction-declared contact model follows the art
 * automatically instead of silently decoupling from it. The same reason
 * `landformFootprintGeometry` was written that way in the pilot, generalised.
 *
 * ## The wrapping rule, and the pilot bug it encodes
 *
 * Coordinates are wrapped in **TILE** units, never pixels. The Nirvana East pilot shipped
 * a round-1 defect where `wrapCoord(footX)` was applied to a PIXEL value using the
 * 96-**tile** period, silently decoupling every blocking prop's collision tile from its
 * drawn position (`nirvana-east-pilot-report.md` §P2.6). This module takes tile
 * coordinates and a {@link SceneryFootprintExtent}, so a caller cannot express that bug
 * without a type error.
 *
 * ## Consuming this
 *
 * Declare the contact model once per species, next to the art it describes:
 *
 * ```ts
 * const MESA_CONTACT: SceneryContactModel = {
 *   shape: "ellipse",
 *   centerXFraction: 0.44,
 *   centerYFraction: 0.545,     // cap centre 0.245 + wall height 0.30
 *   halfWidthFraction: 0.34,
 *   halfHeightFraction: 0.205,
 *   shrink: 0.92,               // shadow/talus overhang walkable ground
 * };
 * const tiles = sceneryFootprintTilesForFoot(
 *   { footColumn, footRow },
 *   { width: 512, height: 384, pivotX: 256, pivotY: 306 },
 *   MESA_CONTACT,
 *   { columns: 96, rows: 96, topology: "toroidal", tileSize: 32 },
 * );
 * ```
 *
 * Every returned tile is canonical (inside `[0, columns) x [0, rows)`) and de-duplicated,
 * so the list can be unioned straight into a `GroundTerrainMask` or a collision buffer.
 */

import type { TileCoord } from "../../map/regionMap";
import type { NavigationTopology } from "../navigation/navigation";

/** A drawn sprite frame's geometry, in sprite pixels. */
export interface SceneryFrameGeometry {
  readonly width: number;
  readonly height: number;
  /** Foot-anchor X within the frame. */
  readonly pivotX: number;
  /** Foot-anchor Y within the frame. */
  readonly pivotY: number;
}

/**
 * Where a drawn species actually touches the ground, as fractions of its frame.
 *
 * `centerXFraction` / `centerYFraction` locate the contact region's centre within the
 * frame; `halfWidthFraction` / `halfHeightFraction` are its half-extents. `shrink` is a
 * uniform multiplier on both half-extents, for the honest gap between the solid core and
 * the drawn silhouette — a shadow, a talus apron or a cap overhang is picture, not wall,
 * and a being may stand on it.
 */
export interface SceneryContactModel {
  readonly shape: "ellipse" | "rect";
  readonly centerXFraction: number;
  readonly centerYFraction: number;
  readonly halfWidthFraction: number;
  readonly halfHeightFraction: number;
  /** Uniform half-extent multiplier; defaults to `1` (no shrink). */
  readonly shrink?: number;
}

/** The grid a footprint is resolved against. */
export interface SceneryFootprintExtent {
  readonly columns: number;
  readonly rows: number;
  readonly tileSize: number;
  /** An omitted topology means `"bounded"`, matching `NavigationGrid`. */
  readonly topology?: NavigationTopology;
}

/** A contact region expressed in TILE units, relative to the sprite's foot anchor. */
export interface SceneryFootprintGeometry {
  readonly halfColumns: number;
  readonly halfRows: number;
  /** Contact centre offset from the foot anchor, in tiles. */
  readonly offsetColumns: number;
  readonly offsetRows: number;
}

export class SceneryFootprintError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SceneryFootprintError";
  }
}

function requirePositive(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new SceneryFootprintError(`${label} must be a finite positive number.`);
  }
  return value;
}

function requireFinite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new SceneryFootprintError(`${label} must be a finite number.`);
  }
  return value;
}

/**
 * Convert one species' frame geometry and contact model into tile-space extents.
 *
 * @param frame - The authored sprite frame, in pixels.
 * @param contact - Where that frame touches the ground, as fractions of the frame.
 * @param tileSize - World pixels per tile.
 * @returns Half-extents and the contact centre's offset from the foot anchor, in tiles.
 * @throws {SceneryFootprintError} If any input is non-finite, or the frame, tile size or
 *   half-extents are not positive.
 */
export function deriveSceneryFootprintGeometry(
  frame: SceneryFrameGeometry,
  contact: SceneryContactModel,
  tileSize: number,
): SceneryFootprintGeometry {
  const width = requirePositive(frame.width, "frame width");
  const height = requirePositive(frame.height, "frame height");
  const pivotX = requireFinite(frame.pivotX, "frame pivotX");
  const pivotY = requireFinite(frame.pivotY, "frame pivotY");
  const size = requirePositive(tileSize, "tile size");
  const shrink = requirePositive(contact.shrink ?? 1, "contact shrink");
  const halfWidth = requirePositive(contact.halfWidthFraction, "contact halfWidthFraction");
  const halfHeight = requirePositive(contact.halfHeightFraction, "contact halfHeightFraction");
  const centerX = requireFinite(contact.centerXFraction, "contact centerXFraction") * width;
  const centerY = requireFinite(contact.centerYFraction, "contact centerYFraction") * height;
  return Object.freeze({
    halfColumns: (halfWidth * width * shrink) / size,
    halfRows: (halfHeight * height * shrink) / size,
    offsetColumns: (centerX - pivotX) / size,
    offsetRows: (centerY - pivotY) / size,
  });
}

function wrapIndex(value: number, extent: number): number {
  const wrapped = value % extent;
  return wrapped < 0 ? wrapped + extent : wrapped;
}

/**
 * Every tile whose CENTRE lies inside a contact region centred at a raw tile coordinate.
 *
 * The centre is given in RAW tile coordinates — it may legitimately sit outside
 * `[0, columns)` for an object straddling a seam — and each covered tile is canonicalised
 * at the very end. On a toroidal grid that wraps; on a bounded grid tiles outside the
 * region are dropped, so a bounded object near an edge simply has a smaller footprint
 * rather than blocking the far side of the world.
 *
 * Tile centres rather than tile overlap is deliberate and matches every other ground rule
 * in this codebase: `groundTerrain.ts` judges a body by *the tile its feet land in*, so a
 * tile whose centre is outside the rock is ground a being may stand on.
 *
 * @returns Canonical, de-duplicated tiles in row-major order; possibly empty.
 */
export function sceneryFootprintTiles(
  centerColumn: number,
  centerRow: number,
  geometry: SceneryFootprintGeometry,
  extent: SceneryFootprintExtent,
  shape: SceneryContactModel["shape"] = "ellipse",
): readonly TileCoord[] {
  const columns = requirePositive(extent.columns, "extent columns");
  const rows = requirePositive(extent.rows, "extent rows");
  const halfColumns = requirePositive(geometry.halfColumns, "footprint halfColumns");
  const halfRows = requirePositive(geometry.halfRows, "footprint halfRows");
  const centreColumn = requireFinite(centerColumn, "centerColumn");
  const centreRow = requireFinite(centerRow, "centerRow");
  const toroidal = extent.topology === "toroidal";

  const tiles: TileCoord[] = [];
  const seen = new Set<number>();
  const minColumn = Math.floor(centreColumn - halfColumns - 1);
  const maxColumn = Math.ceil(centreColumn + halfColumns + 1);
  const minRow = Math.floor(centreRow - halfRows - 1);
  const maxRow = Math.ceil(centreRow + halfRows + 1);
  for (let row = minRow; row <= maxRow; row += 1) {
    for (let column = minColumn; column <= maxColumn; column += 1) {
      const dx = (column + 0.5 - centreColumn) / halfColumns;
      const dy = (row + 0.5 - centreRow) / halfRows;
      const inside = shape === "rect"
        ? Math.abs(dx) <= 1 && Math.abs(dy) <= 1
        : dx * dx + dy * dy <= 1;
      if (!inside) continue;
      let canonicalColumn = column;
      let canonicalRow = row;
      if (toroidal) {
        canonicalColumn = wrapIndex(column, columns);
        canonicalRow = wrapIndex(row, rows);
      } else if (column < 0 || row < 0 || column >= columns || row >= rows) {
        continue;
      }
      const key = canonicalRow * columns + canonicalColumn;
      if (seen.has(key)) continue;
      seen.add(key);
      tiles.push(Object.freeze({ column: canonicalColumn, row: canonicalRow }));
    }
  }
  return Object.freeze(tiles);
}

/** A sprite's foot anchor, in RAW (possibly out-of-region) tile coordinates. */
export interface SceneryFootAnchor {
  readonly footColumn: number;
  readonly footRow: number;
}

/**
 * The complete ground footprint of one drawn scenery object, from its foot anchor.
 *
 * This is the entry point a region normally wants: give it where the sprite stands, what
 * frame it draws, and how that frame touches the ground, and it returns exactly the tiles
 * the object may not be walked through.
 *
 * @param anchor - The sprite's foot anchor in RAW tile coordinates.
 * @param frame - The authored frame geometry, in sprite pixels.
 * @param contact - The species' ground-contact model.
 * @param extent - The grid to resolve against.
 * @returns Canonical, de-duplicated tiles in row-major order.
 * @throws {SceneryFootprintError} On invalid geometry — see {@link
 *   deriveSceneryFootprintGeometry}.
 */
export function sceneryFootprintTilesForFoot(
  anchor: SceneryFootAnchor,
  frame: SceneryFrameGeometry,
  contact: SceneryContactModel,
  extent: SceneryFootprintExtent,
): readonly TileCoord[] {
  const geometry = deriveSceneryFootprintGeometry(frame, contact, extent.tileSize);
  return sceneryFootprintTiles(
    requireFinite(anchor.footColumn, "footColumn") + geometry.offsetColumns,
    requireFinite(anchor.footRow, "footRow") + geometry.offsetRows,
    geometry,
    extent,
    contact.shape,
  );
}

/**
 * The one-tile footprint of a prop with no declared contact model.
 *
 * Ordinary small props (a bunchgrass, a boulder, a plank) are drawn at roughly one tile
 * and their old single-tile behaviour is correct. Exposed so a caller can treat every
 * species uniformly — declared model or not — rather than branching at each call site.
 */
export function singleTileFootprint(
  anchor: SceneryFootAnchor,
  extent: SceneryFootprintExtent,
): readonly TileCoord[] {
  const columns = requirePositive(extent.columns, "extent columns");
  const rows = requirePositive(extent.rows, "extent rows");
  const rawColumn = Math.floor(requireFinite(anchor.footColumn, "footColumn"));
  const rawRow = Math.floor(requireFinite(anchor.footRow, "footRow"));
  if (extent.topology === "toroidal") {
    return Object.freeze([Object.freeze({
      column: wrapIndex(rawColumn, columns),
      row: wrapIndex(rawRow, rows),
    })]);
  }
  if (rawColumn < 0 || rawRow < 0 || rawColumn >= columns || rawRow >= rows) {
    return Object.freeze([]);
  }
  return Object.freeze([Object.freeze({ column: rawColumn, row: rawRow })]);
}
