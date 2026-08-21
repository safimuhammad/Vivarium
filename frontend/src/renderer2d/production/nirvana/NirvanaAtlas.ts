/** Validated atlas vocabulary and semantic frame selection for production Nirvana. */

import {
  NIRVANA_ATLAS_PROFILE,
  NIRVANA_REGION_ID,
  type NirvanaAtlasFrameRecord,
  type NirvanaAtlasProfile,
} from "./NirvanaAssetProfile";
import {
  NIRVANA_CHUNK_COLUMNS,
  NIRVANA_CHUNK_ROWS,
  NIRVANA_TILE_SIZE,
  type NirvanaCardinalDirection,
  type NirvanaChunkConnector,
  type NirvanaRoadCell,
  type NirvanaTerrainCell,
  type NirvanaTerrainOverlay,
} from "./NirvanaRegionV2";
import {
  NIRVANA_TERRAIN_BASE_VARIANTS,
  NIRVANA_TERRAIN_EDGE_VARIANTS,
  NIRVANA_TERRAIN_MATERIALS,
  NIRVANA_TERRAIN_SHORE_VARIANTS,
  nirvanaTerrainBaseFrameId,
  nirvanaTerrainEdgeFrameId,
  nirvanaTerrainHasShoreSet,
  nirvanaTerrainShoreFrameId,
} from "./NirvanaTerrainField";

export interface NirvanaAtlasFrame {
  readonly id: string;
  readonly atlasId: NirvanaAtlasFrameRecord["atlasId"];
  readonly image: NirvanaAtlasFrameRecord["image"];
  readonly rect: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly pivot: Readonly<{ x: number; y: number }>;
  readonly connections?: NirvanaAtlasFrameRecord["connections"];
}

export interface NirvanaAtlasAssets {
  readonly terrain: CanvasImageSource;
  readonly scenery: CanvasImageSource;
  readonly frames: ReadonlyMap<string, NirvanaAtlasFrame>;
}

export class NirvanaAtlasError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NirvanaAtlasError";
  }
}

const DIRECTION_ORDER: readonly NirvanaCardinalDirection[] = Object.freeze([
  "north",
  "east",
  "south",
  "west",
]);

const ROAD_FRAMES: Readonly<Record<string, string>> = Object.freeze({
  "": "terrain.road.isolated",
  n: "terrain.road.end.n",
  e: "terrain.road.end.e",
  s: "terrain.road.end.s",
  w: "terrain.road.end.w",
  ns: "terrain.road.straight.ns",
  ew: "terrain.road.straight.ew",
  ne: "terrain.road.corner.ne",
  es: "terrain.road.corner.se",
  sw: "terrain.road.corner.sw",
  nw: "terrain.road.corner.nw",
  new: "terrain.road.tee.n",
  nes: "terrain.road.tee.e",
  esw: "terrain.road.tee.s",
  nsw: "terrain.road.tee.w",
  nesw: "terrain.road.cross",
});

const SWALE_FRAMES: Readonly<Record<string, string>> = Object.freeze({
  ns: "terrain.swale.straight.ns",
  ew: "terrain.swale.straight.ew",
  ne: "terrain.swale.corner.ne",
  es: "terrain.swale.corner.se",
  sw: "terrain.swale.corner.sw",
  nw: "terrain.swale.corner.nw",
});

const REQUIRED_FRAME_IDS = Object.freeze(
  Object.keys(NIRVANA_ATLAS_PROFILE.frames).sort((left, right) => left.localeCompare(right)),
);

/** Validate the exact Nirvana profile and bind its two decoded atlas sources. */
export function createNirvanaAtlasAssets(
  terrain: CanvasImageSource,
  scenery: CanvasImageSource,
  profile: NirvanaAtlasProfile,
): NirvanaAtlasAssets {
  validateProfileIdentity(profile);
  const descriptorById = validateDescriptors(profile);
  validateCanvasSource(
    terrain,
    descriptorById.get(profile.terrainAtlasId)!,
    "terrain",
  );
  validateCanvasSource(
    scenery,
    descriptorById.get(profile.sceneryAtlasId)!,
    "scenery",
  );

  const frameBuilder = new Map<string, NirvanaAtlasFrame>();
  const recordIds = new Set<string>();
  for (const [key, candidate] of Object.entries(profile.frames)) {
    const id = stringField(candidate.id, "frame id");
    if (recordIds.has(id)) {
      throw new NirvanaAtlasError(`Nirvana atlas contains duplicate frame ${id}.`);
    }
    recordIds.add(id);
    if (key !== id) {
      throw new NirvanaAtlasError(`Nirvana atlas frame key ${key} does not match ${id}.`);
    }
    if (!REQUIRED_FRAME_IDS.includes(id)) {
      throw new NirvanaAtlasError(`Nirvana atlas contains unknown frame ${id}.`);
    }
    frameBuilder.set(id, validateFrame(candidate, descriptorById));
  }

  for (const id of REQUIRED_FRAME_IDS) {
    if (!frameBuilder.has(id)) {
      throw new NirvanaAtlasError(`Nirvana atlas is missing required frame ${id}.`);
    }
  }
  validateSemanticVocabulary(frameBuilder);

  return Object.freeze({
    terrain,
    scenery,
    frames: immutableMap(frameBuilder),
  });
}

/** Map one road cell plus its outward chunk connectors to an exact atlas frame. */
export function roadFrameIdFor(
  road: NirvanaRoadCell,
  connectors: readonly NirvanaChunkConnector[],
): string {
  const directions = connectionsWithConnectors(road, connectors);
  if (road.surface === "ford") return roadFordFrameId(directions);
  const mask = directionMask(directions);
  const frame = ROAD_FRAMES[mask];
  if (frame === undefined) {
    throw new NirvanaAtlasError(`Unsupported Nirvana road connection mask: ${mask}.`);
  }
  return frame;
}

/** Map one dry-swale or ford cell to its exact atlas frame. */
export function swaleFrameIdFor(cell: NirvanaTerrainCell): string {
  if (cell.kind === "ford") return crossingFordFrameId(cell.connections ?? []);
  if (cell.kind !== "dry-swale") {
    throw new NirvanaAtlasError(
      `Cannot select a Nirvana swale frame for terrain kind ${cell.kind}.`,
    );
  }
  const mask = directionMask(cell.connections ?? []);
  const frame = SWALE_FRAMES[mask];
  if (frame === undefined) {
    throw new NirvanaAtlasError(`Unsupported Nirvana swale connection mask: ${mask}.`);
  }
  return frame;
}

/**
 * Map one terrain cell to the atlas frame that fills its whole 32px tile.
 *
 * This is only the BASE fill. A tile whose four corners are not one material also carries
 * corner-masked transition overlays and, at the water's edge, waterlines — those are
 * `nirvanaTerrainOverlayFrameIds`, and the painter draws them over this frame in order.
 */
export function terrainFrameIdFor(cell: NirvanaTerrainCell): string {
  return nirvanaTerrainBaseFrameId(cell.base, cell.variant);
}

/**
 * The ordered overlay frames for one terrain cell: transitions, then waterlines.
 *
 * A total-coverage mask (15) is a material's own fill, so it draws from the base set;
 * every partial mask draws from that material's transition set. Waterlines come last so a
 * wet band always sits on top of the bank it belongs to.
 */
export function nirvanaTerrainOverlayFrameIds(cell: NirvanaTerrainCell): readonly string[] {
  const ids: string[] = [];
  for (const overlay of cell.overlays) {
    ids.push(overlay.mask === 15
      ? nirvanaTerrainBaseFrameId(overlay.material, overlay.variant)
      : nirvanaTerrainEdgeFrameId(overlay.material, overlay.mask, overlay.variant));
  }
  for (const shoreline of cell.shorelines) {
    ids.push(nirvanaTerrainShoreFrameId(
      shoreline.material,
      shoreline.mask,
      shoreline.variant,
    ));
  }
  return ids;
}

/** The authored dry-channel frame drawn OVER a cell's terrain, or null when it is not one. */
export function channelFrameIdFor(cell: NirvanaTerrainCell): string | null {
  if (cell.kind !== "dry-swale" && cell.kind !== "ford") return null;
  return swaleFrameIdFor(cell);
}

function validateProfileIdentity(profile: NirvanaAtlasProfile): void {
  if (profile.regionId !== NIRVANA_REGION_ID
    || profile.requiredKit !== "worn-heartland"
    || profile.terrainAtlasId !== "nirvana-v3-terrain"
    || profile.sceneryAtlasId !== "nirvana-v3-scenery") {
    throw new NirvanaAtlasError("Nirvana atlas profile has an invalid exact-region identity.");
  }
}

function validateDescriptors(
  profile: NirvanaAtlasProfile,
): ReadonlyMap<string, NirvanaAtlasProfile["descriptors"][number]> {
  const descriptors = new Map<string, NirvanaAtlasProfile["descriptors"][number]>();
  for (const descriptor of profile.descriptors) {
    if (descriptors.has(descriptor.id)) {
      throw new NirvanaAtlasError(`Nirvana atlas contains duplicate descriptor ${descriptor.id}.`);
    }
    descriptors.set(descriptor.id, descriptor);
  }
  if (descriptors.size !== 2
    || !descriptors.has(profile.terrainAtlasId)
    || !descriptors.has(profile.sceneryAtlasId)) {
    throw new NirvanaAtlasError("Nirvana atlas profile must own exactly two descriptors.");
  }
  for (const descriptor of descriptors.values()) {
    if (descriptor.group !== "region" || descriptor.regionKit !== profile.requiredKit) {
      throw new NirvanaAtlasError(
        `Nirvana atlas descriptor ${descriptor.id} has invalid region ownership.`,
      );
    }
    if (!positiveInteger(descriptor.width) || !positiveInteger(descriptor.height)
      || descriptor.decodedBytes !== descriptor.width * descriptor.height * 4) {
      throw new NirvanaAtlasError(
        `Nirvana atlas descriptor ${descriptor.id} has invalid geometry.`,
      );
    }
    const approved = NIRVANA_ATLAS_PROFILE.descriptors.find(({ id }) => id === descriptor.id);
    if (approved === undefined || !sameDescriptor(descriptor, approved)) {
      throw new NirvanaAtlasError(
        `Nirvana atlas descriptor ${descriptor.id} does not match the approved manifest.`,
      );
    }
  }
  return descriptors;
}

function validateCanvasSource(
  source: CanvasImageSource,
  descriptor: NirvanaAtlasProfile["descriptors"][number],
  label: string,
): void {
  const dimensions = canvasSourceDimensions(source);
  if (dimensions === null) return;
  if (dimensions.width !== descriptor.width || dimensions.height !== descriptor.height) {
    throw new NirvanaAtlasError(
      `Nirvana ${label} atlas source geometry ${dimensions.width}x${dimensions.height} does not match ${descriptor.width}x${descriptor.height}.`,
    );
  }
}

function canvasSourceDimensions(
  source: CanvasImageSource,
): Readonly<{ width: number; height: number }> | null {
  const candidate = source as unknown as Readonly<Record<string, unknown>>;
  const pairs = [
    [candidate.naturalWidth, candidate.naturalHeight],
    [candidate.videoWidth, candidate.videoHeight],
    [candidate.width, candidate.height],
    [candidate.displayWidth, candidate.displayHeight],
  ] as const;
  for (const [width, height] of pairs) {
    if (positiveInteger(width) && positiveInteger(height)) return { width, height };
  }
  return null;
}

function validateFrame(
  candidate: NirvanaAtlasFrameRecord,
  descriptors: ReadonlyMap<string, NirvanaAtlasProfile["descriptors"][number]>,
): NirvanaAtlasFrame {
  const id = candidate.id;
  if (candidate.image !== "terrain" && candidate.image !== "scenery") {
    throw new NirvanaAtlasError(`Nirvana frame ${id} has an unknown image owner.`);
  }
  const expectedAtlasId = candidate.image === "terrain"
    ? "nirvana-v3-terrain"
    : "nirvana-v3-scenery";
  if (candidate.atlasId !== expectedAtlasId) {
    throw new NirvanaAtlasError(`Nirvana frame ${id} has an invalid atlas owner.`);
  }
  const descriptor = descriptors.get(expectedAtlasId);
  if (descriptor === undefined) {
    throw new NirvanaAtlasError(`Nirvana frame ${id} references a missing atlas.`);
  }
  const { rect, pivot } = candidate;
  if (!nonNegativeInteger(rect.x) || !nonNegativeInteger(rect.y)
    || !positiveInteger(rect.width) || !positiveInteger(rect.height)) {
    throw new NirvanaAtlasError(`Nirvana frame ${id} has invalid frame geometry.`);
  }
  if (rect.x + rect.width > descriptor.width || rect.y + rect.height > descriptor.height) {
    throw new NirvanaAtlasError(`Nirvana frame ${id} exceeds its atlas bounds.`);
  }
  if (!nonNegativeInteger(pivot.x) || !nonNegativeInteger(pivot.y)
    || pivot.x > rect.width || pivot.y > rect.height) {
    throw new NirvanaAtlasError(`Nirvana frame ${id} has invalid pivot geometry.`);
  }
  if (candidate.image === "terrain" && (
    rect.width !== NIRVANA_TILE_SIZE
    || rect.height !== NIRVANA_TILE_SIZE
    || rect.x % NIRVANA_TILE_SIZE !== 0
    || rect.y % NIRVANA_TILE_SIZE !== 0
  )) {
    throw new NirvanaAtlasError(`Nirvana terrain frame ${id} is not a 32px atlas cell.`);
  }
  const connections = candidate.connections === undefined
    ? undefined
    : validateFrameConnections(id, candidate.connections);
  const frame: NirvanaAtlasFrame = Object.freeze({
    id,
    atlasId: candidate.atlasId,
    image: candidate.image,
    rect: Object.freeze({ ...rect }),
    pivot: Object.freeze({ ...pivot }),
    ...(connections === undefined ? {} : { connections }),
  });
  const approved = NIRVANA_ATLAS_PROFILE.frames[id];
  if (approved === undefined || !sameFrame(frame, approved)) {
    throw new NirvanaAtlasError(
      `Nirvana frame ${id} does not match the approved exact-region manifest.`,
    );
  }
  return frame;
}

function validateFrameConnections(
  id: string,
  connections: readonly string[],
): NirvanaAtlasFrameRecord["connections"] {
  const allowed = new Set(["N", "E", "S", "W"]);
  const unique = new Set<string>();
  for (const connection of connections) {
    if (!allowed.has(connection) || unique.has(connection)) {
      throw new NirvanaAtlasError(`Nirvana frame ${id} has invalid connections.`);
    }
    unique.add(connection);
  }
  return Object.freeze([...connections]) as NirvanaAtlasFrameRecord["connections"];
}

/**
 * Prove the generation carries every frame the semantic vocabulary can ask for.
 *
 * This is what makes a bad or truncated art build fail closed instead of throwing a
 * missing-frame error mid-paint: the authored roads, swales and fords, plus every base
 * fill, every corner-masked transition mask and every waterline the terrain field can
 * select, are all resolved here once.
 */
function validateSemanticVocabulary(frames: ReadonlyMap<string, NirvanaAtlasFrame>): void {
  const selected = new Set<string>([
    ...Object.values(ROAD_FRAMES),
    ...Object.values(SWALE_FRAMES),
    "terrain.ford.ns",
    "terrain.ford.ew",
  ]);
  for (const material of NIRVANA_TERRAIN_MATERIALS) {
    for (let variant = 0; variant < NIRVANA_TERRAIN_BASE_VARIANTS; variant += 1) {
      selected.add(nirvanaTerrainBaseFrameId(material, variant));
    }
    const edgeVariants = NIRVANA_TERRAIN_EDGE_VARIANTS[material];
    for (let mask = 1; mask <= 14; mask += 1) {
      for (let variant = 0; variant < edgeVariants; variant += 1) {
        selected.add(nirvanaTerrainEdgeFrameId(material, mask, variant));
      }
      if (!nirvanaTerrainHasShoreSet(material)) continue;
      for (let variant = 0; variant < NIRVANA_TERRAIN_SHORE_VARIANTS; variant += 1) {
        selected.add(nirvanaTerrainShoreFrameId(material, mask, variant));
      }
    }
  }
  for (const id of selected) {
    if (!frames.has(id)) {
      throw new NirvanaAtlasError(`Nirvana atlas is missing semantic frame ${id}.`);
    }
  }
}

/** True when every frame one terrain cell selects exists in the bound generation. */
export function nirvanaTerrainCellIsPaintable(
  assets: NirvanaAtlasAssets,
  cell: NirvanaTerrainCell,
): boolean {
  if (!assets.frames.has(terrainFrameIdFor(cell))) return false;
  for (const id of nirvanaTerrainOverlayFrameIds(cell)) {
    if (!assets.frames.has(id)) return false;
  }
  const channel = channelFrameIdFor(cell);
  return channel === null || assets.frames.has(channel);
}

/** Re-exported so callers need not reach into the field module for the overlay shape. */
export type { NirvanaTerrainOverlay };

function sameDescriptor(
  candidate: NirvanaAtlasProfile["descriptors"][number],
  approved: NirvanaAtlasProfile["descriptors"][number],
): boolean {
  return candidate.id === approved.id
    && candidate.url.href === approved.url.href
    && candidate.group === approved.group
    && candidate.regionKit === approved.regionKit
    && candidate.width === approved.width
    && candidate.height === approved.height
    && candidate.cellWidth === approved.cellWidth
    && candidate.cellHeight === approved.cellHeight
    && candidate.columns === approved.columns
    && candidate.rows === approved.rows
    && candidate.compressedBytes === approved.compressedBytes
    && candidate.decodedBytes === approved.decodedBytes
    && candidate.sha256 === approved.sha256;
}

function sameFrame(
  candidate: NirvanaAtlasFrame,
  approved: NirvanaAtlasFrameRecord,
): boolean {
  const candidateConnections = candidate.connections ?? [];
  const approvedConnections = approved.connections ?? [];
  return candidate.id === approved.id
    && candidate.atlasId === approved.atlasId
    && candidate.image === approved.image
    && candidate.rect.x === approved.rect.x
    && candidate.rect.y === approved.rect.y
    && candidate.rect.width === approved.rect.width
    && candidate.rect.height === approved.rect.height
    && candidate.pivot.x === approved.pivot.x
    && candidate.pivot.y === approved.pivot.y
    && candidateConnections.length === approvedConnections.length
    && candidateConnections.every((connection, index) => (
      connection === approvedConnections[index]
    ));
}

function connectionsWithConnectors(
  road: NirvanaRoadCell,
  connectors: readonly NirvanaChunkConnector[],
): readonly NirvanaCardinalDirection[] {
  const connections = new Set<NirvanaCardinalDirection>(road.connections);
  for (const connector of connectors) {
    const matches = connector.edge === "north"
      ? road.tile.row === 0 && road.tile.column === connector.offset
      : connector.edge === "east"
        ? road.tile.column === NIRVANA_CHUNK_COLUMNS - 1 && road.tile.row === connector.offset
        : connector.edge === "south"
          ? road.tile.row === NIRVANA_CHUNK_ROWS - 1 && road.tile.column === connector.offset
          : road.tile.column === 0 && road.tile.row === connector.offset;
    if (matches) connections.add(connector.edge);
  }
  return DIRECTION_ORDER.filter((direction) => connections.has(direction));
}

function directionMask(directions: readonly NirvanaCardinalDirection[]): string {
  const selected = new Set(directions);
  return DIRECTION_ORDER
    .filter((direction) => selected.has(direction))
    .map((direction) => direction[0])
    .join("");
}

function roadFordFrameId(directions: readonly NirvanaCardinalDirection[]): string {
  const selected = new Set(directions);
  const horizontal = selected.has("east") || selected.has("west");
  const vertical = selected.has("north") || selected.has("south");
  if (horizontal === vertical) {
    throw new NirvanaAtlasError(
      `Unsupported Nirvana ford road connection mask: ${directionMask(directions)}.`,
    );
  }
  return horizontal ? "terrain.ford.ew" : "terrain.ford.ns";
}

function crossingFordFrameId(directions: readonly NirvanaCardinalDirection[]): string {
  const selected = new Set(directions);
  const horizontalSwale = (selected.has("east") || selected.has("west"))
    && !selected.has("north")
    && !selected.has("south");
  if (horizontalSwale) return "terrain.ford.ns";
  const verticalSwale = (selected.has("north") || selected.has("south"))
    && !selected.has("east")
    && !selected.has("west");
  if (verticalSwale) return "terrain.ford.ew";
  throw new NirvanaAtlasError(
    `Unsupported Nirvana ford swale mask: ${directionMask(directions)}.`,
  );
}

function positiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function nonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function stringField(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new NirvanaAtlasError(`Nirvana ${label} must be a non-empty string.`);
  }
  return value;
}

function immutableMap<K, V>(source: ReadonlyMap<K, V>): ReadonlyMap<K, V> {
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
