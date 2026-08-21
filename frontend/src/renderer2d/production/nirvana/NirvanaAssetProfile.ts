/**
 * The exact, validated asset profile for production Nirvana.
 *
 * Reads the published `nirvana-v3` generation — the merged production atlas carrying the
 * approved river-valley vocabulary plus the 24 road/swale/ford cells and 18 landmark
 * sprites that had to survive with their exact ids. Schema 2 is a COMPACT manifest: the
 * terrain sheet is a fixed 32px grid addressed by an id list, and scenery frames are
 * positional tuples. Both are expanded here into the same `NirvanaAtlasFrameRecord` shape
 * the previous 50-frame schema-1 manifest produced, so every downstream validator is
 * unchanged.
 *
 * Byte accounting for the re-baseline is recorded in `.superpowers/sdd/nirvana-live-report.md`
 * §4.3 and §D: 181,121 B of art + 11,414 B of metadata = 97.93 % of the plan's 196,608
 * per-kit ceiling and 55.96 % of the 1,310,720 ceiling this module actually enforces.
 *
 * The reed re-author (§D) re-rendered the eight `t.reed.*` cells and the reed transition
 * and waterline frames derived from the same material function — no new frames, no layout
 * change, no new palette entries (terrain stays at 153 colours, `indexed8`, lossless) —
 * and came in 44 B SMALLER than the corduroy it replaced.
 */

import atlasManifest from "../../../assets/renderer2d/regions/nirvana-v3/atlas.json";
import type {
  ProductionAssetManifest,
  ProductionAtlasDescriptor,
} from "../assets/productionManifest";

export const NIRVANA_REGION_ID = "nirvana" as const;

const REQUIRED_KIT = "worn-heartland" as const;
const TERRAIN_ATLAS_ID = "nirvana-v3-terrain" as const;
const SCENERY_ATLAS_ID = "nirvana-v3-scenery" as const;
const TILE_SIZE = 32;

/** The published generation's exact geometry; a drift here must fail loudly. */
const TERRAIN_IMAGE = Object.freeze({ file: "terrain.png", width: 512, height: 800 });
const SCENERY_IMAGE = Object.freeze({ file: "scenery.png", width: 672, height: 1010 });
const EXPECTED_FRAME_COUNT = 509;

type NirvanaAtlasImageId = "terrain" | "scenery";
type CardinalConnection = "N" | "E" | "S" | "W";

export interface NirvanaAtlasImageRecord {
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly compressedBytes: number;
  readonly decodedBytes: number;
  readonly sha256: string;
}

export interface NirvanaAtlasFrameRecord {
  readonly id: string;
  readonly atlasId: typeof TERRAIN_ATLAS_ID | typeof SCENERY_ATLAS_ID;
  readonly image: NirvanaAtlasImageId;
  readonly rect: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly pivot: Readonly<{ x: number; y: number }>;
  readonly connections?: readonly CardinalConnection[];
}

export interface NirvanaAtlasProfile {
  readonly regionId: typeof NIRVANA_REGION_ID;
  readonly requiredKit: typeof REQUIRED_KIT;
  readonly terrainAtlasId: typeof TERRAIN_ATLAS_ID;
  readonly sceneryAtlasId: typeof SCENERY_ATLAS_ID;
  readonly descriptors: readonly ProductionAtlasDescriptor[];
  readonly frames: Readonly<Record<string, NirvanaAtlasFrameRecord>>;
  /** Material vocabulary the generation was authored for. */
  readonly materials: readonly string[];
  readonly blockingMaterials: readonly string[];
  readonly shoreMaterials: readonly string[];
}

export class NirvanaAssetProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NirvanaAssetProfileError";
  }
}

interface ParsedAtlasManifest {
  readonly images: Readonly<Record<NirvanaAtlasImageId, NirvanaAtlasImageRecord>>;
  readonly frames: Readonly<Record<string, NirvanaAtlasFrameRecord>>;
  readonly materials: readonly string[];
  readonly blockingMaterials: readonly string[];
  readonly shoreMaterials: readonly string[];
}

const TERRAIN_URL = new URL(
  "../../../assets/renderer2d/regions/nirvana-v3/terrain.png",
  import.meta.url,
);
const SCENERY_URL = new URL(
  "../../../assets/renderer2d/regions/nirvana-v3/scenery.png",
  import.meta.url,
);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

function requiredInteger(
  value: unknown,
  label: string,
  minimum = 0,
): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new NirvanaAssetProfileError(`${label} must be a safe integer >= ${minimum}.`);
  }
  return value as number;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new NirvanaAssetProfileError(`${label} must be a non-empty string.`);
  }
  return value;
}

function requiredStringList(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new NirvanaAssetProfileError(`${label} must be a non-empty array.`);
  }
  return Object.freeze(value.map((entry, index) => requiredString(entry, `${label}[${index}]`)));
}

function parseImageRecord(
  value: unknown,
  imageId: NirvanaAtlasImageId,
  expected: Readonly<{ file: string; width: number; height: number }>,
): NirvanaAtlasImageRecord {
  if (!isRecord(value)) {
    throw new NirvanaAssetProfileError(`Nirvana V3 ${imageId} image metadata is missing.`);
  }
  const file = requiredString(value.file, `${imageId}.file`);
  const width = requiredInteger(value.width, `${imageId}.width`, 1);
  const height = requiredInteger(value.height, `${imageId}.height`, 1);
  const compressedBytes = requiredInteger(
    value.compressedBytes,
    `${imageId}.compressedBytes`,
    1,
  );
  const decodedBytes = requiredInteger(value.decodedBytes, `${imageId}.decodedBytes`, 1);
  const sha256 = requiredString(value.sha256, `${imageId}.sha256`);
  if (file !== expected.file || width !== expected.width || height !== expected.height) {
    throw new NirvanaAssetProfileError(
      `Nirvana V3 ${imageId} metadata does not match its approved production geometry.`,
    );
  }
  if (decodedBytes !== width * height * 4) {
    throw new NirvanaAssetProfileError(`Nirvana V3 ${imageId} decoded byte count is invalid.`);
  }
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new NirvanaAssetProfileError(`Nirvana V3 ${imageId} SHA-256 is invalid.`);
  }
  return Object.freeze({ file, width, height, compressedBytes, decodedBytes, sha256 });
}

/** Expand the compact terrain grid: one 32px cell per id, in row-major grid order. */
function parseTerrainGrid(
  value: unknown,
  image: NirvanaAtlasImageRecord,
): readonly NirvanaAtlasFrameRecord[] {
  if (!isRecord(value) || value.image !== "terrain") {
    throw new NirvanaAssetProfileError("Nirvana V3 atlas requires a terrain grid.");
  }
  const columns = requiredInteger(value.columns, "terrainGrid.columns", 1);
  const cell = requiredInteger(value.cell, "terrainGrid.cell", 1);
  if (cell !== TILE_SIZE) {
    throw new NirvanaAssetProfileError("Nirvana V3 terrain grid must use 32px cells.");
  }
  if (!Array.isArray(value.ids) || value.ids.length === 0) {
    throw new NirvanaAssetProfileError("Nirvana V3 terrain grid must list frame ids.");
  }
  return Object.freeze(value.ids.map((candidate, index) => {
    const id = requiredString(candidate, `terrainGrid.ids[${index}]`);
    const x = (index % columns) * cell;
    const y = Math.floor(index / columns) * cell;
    if (x + cell > image.width || y + cell > image.height) {
      throw new NirvanaAssetProfileError(`Nirvana V3 terrain frame ${id} exceeds its atlas.`);
    }
    return Object.freeze({
      id,
      atlasId: TERRAIN_ATLAS_ID,
      image: "terrain" as const,
      rect: Object.freeze({ x, y, width: cell, height: cell }),
      pivot: Object.freeze({ x: 0, y: 0 }),
    });
  }));
}

/** Expand one scenery tuple: `[id, x, y, width, height, pivotX, pivotY]`. */
function parseSceneryFrames(
  value: unknown,
  image: NirvanaAtlasImageRecord,
): readonly NirvanaAtlasFrameRecord[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new NirvanaAssetProfileError("Nirvana V3 atlas must publish scenery frames.");
  }
  return Object.freeze(value.map((candidate, index) => {
    if (!Array.isArray(candidate) || candidate.length !== 7) {
      throw new NirvanaAssetProfileError(
        `Nirvana V3 scenery frame ${index} must be a 7-field tuple.`,
      );
    }
    const id = requiredString(candidate[0], `sceneryFrames[${index}].id`);
    const rect = Object.freeze({
      x: requiredInteger(candidate[1], `${id}.rect.x`),
      y: requiredInteger(candidate[2], `${id}.rect.y`),
      width: requiredInteger(candidate[3], `${id}.rect.width`, 1),
      height: requiredInteger(candidate[4], `${id}.rect.height`, 1),
    });
    const pivot = Object.freeze({
      x: requiredInteger(candidate[5], `${id}.pivot.x`),
      y: requiredInteger(candidate[6], `${id}.pivot.y`),
    });
    if (rect.x + rect.width > image.width || rect.y + rect.height > image.height) {
      throw new NirvanaAssetProfileError(`Nirvana V3 frame ${id} exceeds its atlas bounds.`);
    }
    if (pivot.x > rect.width || pivot.y > rect.height) {
      throw new NirvanaAssetProfileError(`Nirvana V3 frame ${id} has an out-of-bounds pivot.`);
    }
    return Object.freeze({
      id,
      atlasId: SCENERY_ATLAS_ID,
      image: "scenery" as const,
      rect,
      pivot,
    });
  }));
}

function parseAtlasManifest(value: unknown): ParsedAtlasManifest {
  if (!isRecord(value) || value.schema !== 2 || value.tileSize !== TILE_SIZE
    || !isRecord(value.images)) {
    throw new NirvanaAssetProfileError(
      "Nirvana V3 requires atlas schema 2 with 32px tiles and image metadata.",
    );
  }
  const images = Object.freeze({
    terrain: parseImageRecord(value.images.terrain, "terrain", TERRAIN_IMAGE),
    scenery: parseImageRecord(value.images.scenery, "scenery", SCENERY_IMAGE),
  });
  const frames: Record<string, NirvanaAtlasFrameRecord> = {};
  for (const frame of [
    ...parseTerrainGrid(value.terrainGrid, images.terrain),
    ...parseSceneryFrames(value.sceneryFrames, images.scenery),
  ]) {
    if (frames[frame.id] !== undefined) {
      throw new NirvanaAssetProfileError(`Nirvana V3 atlas contains duplicate frame ${frame.id}.`);
    }
    frames[frame.id] = frame;
  }
  if (Object.keys(frames).length !== EXPECTED_FRAME_COUNT) {
    throw new NirvanaAssetProfileError(
      `Nirvana V3 atlas must publish exactly ${EXPECTED_FRAME_COUNT} frames.`,
    );
  }
  return Object.freeze({
    images,
    frames: Object.freeze(frames),
    materials: requiredStringList(value.materials, "materials"),
    blockingMaterials: requiredStringList(value.blockingMaterials, "blockingMaterials"),
    shoreMaterials: requiredStringList(value.shoreMaterials, "shoreMaterials"),
  });
}

function atlasDescriptor(
  id: typeof TERRAIN_ATLAS_ID | typeof SCENERY_ATLAS_ID,
  url: URL,
  image: NirvanaAtlasImageRecord,
): ProductionAtlasDescriptor {
  return Object.freeze({
    id,
    url: Object.freeze({ href: url.href }),
    group: "region",
    regionKit: REQUIRED_KIT,
    width: image.width,
    height: image.height,
    cellWidth: TILE_SIZE,
    cellHeight: TILE_SIZE,
    columns: Math.floor(image.width / TILE_SIZE),
    rows: Math.floor(image.height / TILE_SIZE),
    compressedBytes: image.compressedBytes,
    decodedBytes: image.decodedBytes,
    sha256: image.sha256,
  });
}

const parsedManifest = parseAtlasManifest(atlasManifest);
const terrainDescriptor = atlasDescriptor(
  TERRAIN_ATLAS_ID,
  TERRAIN_URL,
  parsedManifest.images.terrain,
);
const sceneryDescriptor = atlasDescriptor(
  SCENERY_ATLAS_ID,
  SCENERY_URL,
  parsedManifest.images.scenery,
);

export const NIRVANA_ATLAS_PROFILE: NirvanaAtlasProfile = Object.freeze({
  regionId: NIRVANA_REGION_ID,
  requiredKit: REQUIRED_KIT,
  terrainAtlasId: TERRAIN_ATLAS_ID,
  sceneryAtlasId: SCENERY_ATLAS_ID,
  descriptors: Object.freeze([terrainDescriptor, sceneryDescriptor]),
  frames: parsedManifest.frames,
  materials: parsedManifest.materials,
  blockingMaterials: parsedManifest.blockingMaterials,
  shoreMaterials: parsedManifest.shoreMaterials,
});

/** Add the exact Nirvana atlas descriptors without changing biome-pack ownership. */
export function createNirvanaProductionManifest(
  base: ProductionAssetManifest,
): ProductionAssetManifest {
  const profileCompressedBytes = NIRVANA_ATLAS_PROFILE.descriptors.reduce(
    (total, descriptor) => total + descriptor.compressedBytes,
    0,
  );
  const projectedActiveBytes = base.budgets.activeCompressedBytes[REQUIRED_KIT]
    + profileCompressedBytes;
  if (!Number.isSafeInteger(projectedActiveBytes)
    || projectedActiveBytes > base.budgets.activeCompressedMax) {
    throw new NirvanaAssetProfileError(
      `Nirvana V3 active compressed budget exceeded: ${projectedActiveBytes} > ${base.budgets.activeCompressedMax}.`,
    );
  }
  const atlases = { ...base.atlases };
  for (const descriptor of NIRVANA_ATLAS_PROFILE.descriptors) {
    const existing = atlases[descriptor.id];
    if (existing !== undefined && existing !== descriptor) {
      throw new NirvanaAssetProfileError(
        `Nirvana V3 atlas ID ${descriptor.id} is already owned by another descriptor.`,
      );
    }
    atlases[descriptor.id] = descriptor;
  }
  return Object.freeze({
    ...base,
    atlases: Object.freeze(atlases),
  });
}
