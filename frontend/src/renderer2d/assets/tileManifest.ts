import canonicalTileInventory from "../../../shared/tile-inventory.json";

import type { FrameRect } from "./spriteManifest";

type GroundFrameId = `ground-${"a" | "b" | "c" | "d" | "e" | "f" | "g" | "h"}`;
type ConnectedTileSuffix = "horizontal" | "vertical" | "corner-ne" | "corner-es" | "corner-sw" | "corner-wn" | "cross" | "pool";
type PathFrameId = `path-${Exclude<ConnectedTileSuffix, "pool"> | "plaza"}`;
type WaterFrameId = `water-${ConnectedTileSuffix}`;
type ShoreFrameId = `shore-${ConnectedTileSuffix}`;
type SoilFrameId = `soil-${"a" | "b" | "c" | "d"}`;
type SceneryFrameId =
  | "flowers-white" | "flowers-pink" | "rock-small" | "rock-large"
  | "shrub-a" | "shrub-b" | "tree-a" | "tree-b" | "sapling" | "grass-tuft" | "fallen-log" | "stump"
  | "fence-horizontal" | "fence-vertical" | "fence-corner-ne" | "fence-corner-es"
  | "fence-corner-sw" | "fence-corner-wn" | "gate" | "signpost"
  | "basket" | "wood-pile" | "stone-pile" | "garden-bed" | "reeds" | "lily" | "sparkle" | "empty";

export type TileFrameId = GroundFrameId | PathFrameId | WaterFrameId | ShoreFrameId | SoilFrameId | SceneryFrameId;

export interface TileAtlasFrame {
  readonly id: TileFrameId;
  readonly rect: FrameRect;
}

export interface TileManifest {
  readonly id: string;
  readonly atlasId: "nirvana-tiles";
  readonly cellWidth: 32;
  readonly cellHeight: 32;
  readonly columns: 8;
  readonly rows: 8;
  readonly frames: readonly TileAtlasFrame[];
}

export interface CardinalConnections {
  readonly north: boolean;
  readonly east: boolean;
  readonly south: boolean;
  readonly west: boolean;
}

const CELL_SIZE = 32;
const COLUMNS = 8;
const ROWS = 8;
const EXPECTED_CELL_COUNT = COLUMNS * ROWS;

/** Canonical build/runtime inventory shared with the asset packer. */
export const TILE_FRAME_IDS = canonicalTileInventory as readonly TileFrameId[];

const frames = TILE_FRAME_IDS.map((id, index): TileAtlasFrame => ({
  id,
  rect: {
    x: (index % COLUMNS) * CELL_SIZE,
    y: Math.floor(index / COLUMNS) * CELL_SIZE,
    width: CELL_SIZE,
    height: CELL_SIZE,
  },
}));

export const NIRVANA_TILE_MANIFEST: TileManifest = {
  id: "nirvana-native-tiles-v1",
  atlasId: "nirvana-tiles",
  cellWidth: CELL_SIZE,
  cellHeight: CELL_SIZE,
  columns: COLUMNS,
  rows: ROWS,
  frames,
};

export const NIRVANA_PROP_FRAME_IDS = {
  tree: "tree-a",
  "tree-round": "tree-b",
  shrub: "shrub-a",
  "shrub-round": "shrub-b",
  garden: "garden-bed",
  post: "signpost",
  "flowers-white": "flowers-white",
  "flowers-pink": "flowers-pink",
  "rock-small": "rock-small",
  "rock-large": "rock-large",
  "grass-tuft": "grass-tuft",
  "fallen-log": "fallen-log",
  reeds: "reeds",
  lily: "lily",
  stump: "stump",
  sapling: "sapling",
} as const satisfies Readonly<Record<string, TileFrameId>>;

const finiteInteger = (value: number): boolean => Number.isFinite(value) && Number.isInteger(value);

/** Validates exact native geometry and canonical row-major semantic bindings. */
export function validateTileManifest(manifest: TileManifest): readonly string[] {
  const errors: string[] = [];
  if (!manifest.id) errors.push("tile manifest id must not be empty");
  if (manifest.atlasId !== "nirvana-tiles") errors.push("tile manifest must use the nirvana tile atlas");
  if (manifest.cellWidth !== CELL_SIZE || manifest.cellHeight !== CELL_SIZE) errors.push("tile cells must be native 32x32");
  if (manifest.columns !== COLUMNS || manifest.rows !== ROWS) errors.push("tile atlas must be an exact 8x8 grid");
  if (manifest.frames.length !== EXPECTED_CELL_COUNT) errors.push("tile manifest must declare all 64 native cells");

  const seenIds = new Set<string>();
  const seenRects = new Set<string>();
  manifest.frames.forEach((frame, index) => {
    const { rect } = frame;
    if (seenIds.has(frame.id)) errors.push(`${frame.id}: duplicate tile frame id`);
    seenIds.add(frame.id);
    const rectKey = `${rect.x},${rect.y},${rect.width},${rect.height}`;
    if (seenRects.has(rectKey)) errors.push(`${frame.id}: duplicate tile frame rectangle`);
    seenRects.add(rectKey);
    if (![rect.x, rect.y, rect.width, rect.height].every(finiteInteger)) errors.push(`${frame.id}: frame rectangle must use finite integers`);
    if (rect.width !== CELL_SIZE || rect.height !== CELL_SIZE) errors.push(`${frame.id}: frame must be native 32x32`);
    if (rect.x % CELL_SIZE !== 0 || rect.y % CELL_SIZE !== 0) errors.push(`${frame.id}: frame must align to the native grid`);
    if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > 256 || rect.y + rect.height > 256) errors.push(`${frame.id}: frame outside tile atlas`);
    const expectedId = TILE_FRAME_IDS[index];
    const expectedX = (index % COLUMNS) * CELL_SIZE;
    const expectedY = Math.floor(index / COLUMNS) * CELL_SIZE;
    if (frame.id !== expectedId || rect.x !== expectedX || rect.y !== expectedY) errors.push(`${frame.id}: frame does not match canonical row-major tile inventory`);
  });
  for (const id of TILE_FRAME_IDS) if (!seenIds.has(id)) errors.push(`${id}: required tile frame is missing`);
  return errors;
}

/** Resolves one declared frame or rejects hidden numeric-coordinate fallbacks. */
export function resolveTileFrame(manifest: TileManifest, id: TileFrameId): TileAtlasFrame {
  const frame = manifest.frames.find((candidate) => candidate.id === id);
  if (frame === undefined) throw new Error(`Tile frame ${id} is undeclared.`);
  return frame;
}

/** Selects the authored connected path/water cell for one local neighborhood. */
export function connectedTileFrameId(prefix: "path" | "water", connections: CardinalConnections): PathFrameId | WaterFrameId {
  const { north, east, south, west } = connections;
  const count = Number(north) + Number(east) + Number(south) + Number(west);
  let suffix: ConnectedTileSuffix | "plaza";
  if (count >= 3) suffix = "cross";
  else if (north && south) suffix = "vertical";
  else if (east && west) suffix = "horizontal";
  else if (north && east) suffix = "corner-ne";
  else if (east && south) suffix = "corner-es";
  else if (south && west) suffix = "corner-sw";
  else if (west && north) suffix = "corner-wn";
  else suffix = prefix === "path" ? "plaza" : "pool";
  return `${prefix}-${suffix}` as PathFrameId | WaterFrameId;
}
