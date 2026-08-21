import type { Vec2 } from "../contracts";

export const LOGICAL_VIEWPORT = { width: 512, height: 288 } as const;
export const TILE_SIZE = 32;

export interface TileCoord { readonly column: number; readonly row: number }
export type SceneryPropKind =
  | "tree" | "tree-round" | "shrub" | "shrub-round" | "garden" | "post"
  | "flowers-white" | "flowers-pink" | "rock-small" | "rock-large" | "grass-tuft"
  | "fallen-log" | "reeds" | "lily" | "stump" | "sapling";
export interface MapProp { readonly id: string; readonly tile: TileCoord; readonly kind: SceneryPropKind | "pond" }
export interface ShelterPlot { readonly id: string; readonly tile: TileCoord; readonly door: TileCoord }
export interface GroundTile { readonly tile: TileCoord; readonly terrain: "grass" | "pale-path" }
export interface RegionMapRecipeV1 {
  readonly version: 1;
  readonly regionId: "nirvana";
  readonly seed: number;
  readonly columns: 16;
  readonly rows: 9;
  readonly collision: Uint8Array;
  readonly ground: readonly GroundTile[];
  readonly props: readonly MapProp[];
  readonly anchors: Readonly<Record<"spawn" | "social" | "shelterDoor" | "story", TileCoord>>;
  readonly shelterPlots: readonly ShelterPlot[];
}

export function tileIndex(map: { readonly columns: number }, tile: TileCoord): number {
  return tile.row * map.columns + tile.column;
}

export function tileCenter(tile: TileCoord): Vec2 {
  return { x: tile.column * TILE_SIZE + TILE_SIZE / 2, y: tile.row * TILE_SIZE + TILE_SIZE / 2 };
}

const ANCHORS = {
  spawn: { column: 2, row: 7 },
  social: { column: 6, row: 5 },
  shelterDoor: { column: 11, row: 4 },
  story: { column: 8, row: 5 },
} as const;

const PROPS: readonly MapProp[] = [
  { id: "tree-west-north", kind: "tree", tile: { column: 0, row: 1 } },
  { id: "tree-west-mid", kind: "tree", tile: { column: 1, row: 3 } },
  { id: "tree-southwest", kind: "tree", tile: { column: 1, row: 8 } },
  { id: "tree-southeast", kind: "tree", tile: { column: 15, row: 8 } },
  { id: "tree-round-north", kind: "tree-round", tile: { column: 3, row: 0 } },
  { id: "tree-round-south", kind: "tree-round", tile: { column: 5, row: 8 } },
  { id: "shrub-west-north", kind: "shrub", tile: { column: 1, row: 1 } },
  { id: "shrub-west-mid", kind: "shrub", tile: { column: 0, row: 5 } },
  { id: "shrub-south", kind: "shrub", tile: { column: 4, row: 8 } },
  { id: "shrub-east-south", kind: "shrub", tile: { column: 13, row: 8 } },
  { id: "shrub-round-west", kind: "shrub-round", tile: { column: 2, row: 2 } },
  { id: "shrub-round-east", kind: "shrub-round", tile: { column: 14, row: 6 } },
  { id: "flowers-white-north", kind: "flowers-white", tile: { column: 4, row: 0 } },
  { id: "flowers-white-west", kind: "flowers-white", tile: { column: 3, row: 3 } },
  { id: "flowers-white-south", kind: "flowers-white", tile: { column: 8, row: 7 } },
  { id: "flowers-white-east", kind: "flowers-white", tile: { column: 14, row: 7 } },
  { id: "flowers-pink-north", kind: "flowers-pink", tile: { column: 6, row: 0 } },
  { id: "flowers-pink-west", kind: "flowers-pink", tile: { column: 2, row: 4 } },
  { id: "flowers-pink-center", kind: "flowers-pink", tile: { column: 7, row: 4 } },
  { id: "flowers-pink-east", kind: "flowers-pink", tile: { column: 15, row: 6 } },
  { id: "rock-small-north", kind: "rock-small", tile: { column: 2, row: 0 } },
  { id: "rock-small-west", kind: "rock-small", tile: { column: 0, row: 8 } },
  { id: "rock-small-south", kind: "rock-small", tile: { column: 10, row: 8 } },
  { id: "rock-large-north", kind: "rock-large", tile: { column: 8, row: 0 } },
  { id: "rock-large-west", kind: "rock-large", tile: { column: 1, row: 6 } },
  { id: "rock-large-east", kind: "rock-large", tile: { column: 15, row: 4 } },
  { id: "grass-north", kind: "grass-tuft", tile: { column: 10, row: 0 } },
  { id: "grass-west", kind: "grass-tuft", tile: { column: 4, row: 3 } },
  { id: "grass-south", kind: "grass-tuft", tile: { column: 12, row: 7 } },
  { id: "log-north", kind: "fallen-log", tile: { column: 9, row: 1 } },
  { id: "log-south", kind: "fallen-log", tile: { column: 7, row: 8 } },
  { id: "reeds-pond-west", kind: "reeds", tile: { column: 12, row: 1 } },
  { id: "reeds-pond-south", kind: "reeds", tile: { column: 13, row: 3 } },
  { id: "garden-shelter", kind: "garden", tile: { column: 10, row: 7 } },
  { id: "post-shelter", kind: "post", tile: { column: 12, row: 5 } },
  { id: "stump-west", kind: "stump", tile: { column: 1, row: 5 } },
  { id: "sapling-center", kind: "sapling", tile: { column: 5, row: 4 } },
  { id: "pond-1", kind: "pond", tile: { column: 13, row: 0 } },
  { id: "pond-2", kind: "pond", tile: { column: 14, row: 0 } },
  { id: "pond-3", kind: "pond", tile: { column: 15, row: 0 } },
  { id: "pond-4", kind: "pond", tile: { column: 13, row: 1 } },
  { id: "pond-5", kind: "pond", tile: { column: 14, row: 1 } },
  { id: "pond-6", kind: "pond", tile: { column: 15, row: 1 } },
  { id: "pond-7", kind: "pond", tile: { column: 14, row: 2 } },
  { id: "pond-8", kind: "pond", tile: { column: 15, row: 2 } },
];

const BLOCKING_PROP_KINDS = new Set<MapProp["kind"]>([
  "pond", "tree", "tree-round", "shrub", "shrub-round", "post",
  "rock-small", "rock-large", "fallen-log", "stump",
]);

const PALE_PATH = new Set([
  "11,4", "6,5", "7,5", "8,5", "9,5", "10,5", "11,5",
  "2,6", "3,6", "4,6", "5,6", "6,6", "2,7",
]);

/** Derives the single visual and collision recipe for the 2D Nirvana demo. */
export function deriveDemoRegionMap(seed: number): RegionMapRecipeV1 {
  const collision = new Uint8Array(16 * 9);
  for (const prop of PROPS) {
    if (BLOCKING_PROP_KINDS.has(prop.kind)) collision[prop.tile.row * 16 + prop.tile.column] = 1;
  }
  const ground: GroundTile[] = Array.from({ length: 16 * 9 }, (_, index) => {
    const tile = { column: index % 16, row: Math.floor(index / 16) };
    return { tile, terrain: PALE_PATH.has(`${tile.column},${tile.row}`) ? "pale-path" : "grass" };
  });
  return {
    version: 1,
    regionId: "nirvana",
    seed,
    columns: 16,
    rows: 9,
    collision,
    ground,
    props: PROPS.map((prop) => ({ ...prop, tile: { ...prop.tile } })),
    anchors: { spawn: { ...ANCHORS.spawn }, social: { ...ANCHORS.social }, shelterDoor: { ...ANCHORS.shelterDoor }, story: { ...ANCHORS.story } },
    shelterPlots: [{ id: "shelter-east", tile: { column: 11, row: 3 }, door: { ...ANCHORS.shelterDoor } }],
  };
}
