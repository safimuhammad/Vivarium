/**
 * @fileoverview The exact, validated asset profile for production Warm Springs.
 *
 * Reads the published `warm-springs-v1` generation — the owner-approved "Great Terrace"
 * vocabulary, republished byte-for-byte from the pilot art that was approved by eye
 * (`scripts/build-warm-springs-v1-atlas.mjs`). Schema 2 is a COMPACT manifest: the terrain
 * sheet is a fixed 32 px grid addressed by an id list, and scenery frames are positional
 * tuples. Both are expanded here into one flat frame table.
 *
 * Byte accounting, against the plan's Global Constraints:
 *
 * ```
 * Ceiling A — per-kit region, 196,608 B
 *   terrain.png                     106,431 B
 *   scenery.png                      26,762 B
 *   atlas.json                        9,919 B
 *                                  ----------
 *   total                           143,112 B = 72.79 %   (headroom 53,496 B)
 *
 * Ceiling B — shared active atlas, 1,310,720 B   (the one this module ENFORCES)
 *   activeCompressedBytes["spring-terraces"] + 133,193 B of art
 * ```
 *
 * The ~52 KB of Ceiling-A headroom is deliberately NOT spent. Nirvana shipped at 97.93 %
 * and needed a named 70-frame cut to get there, which is exactly why its reed beds later
 * needed rescuing (`.superpowers/sdd/nirvana-live-report.md` §4.3, §D7). Warm Springs
 * keeps its margin.
 */

import atlasManifest from "../../../assets/renderer2d/regions/warm-springs-v1/atlas.json";
import type {
  ProductionAssetManifest,
  ProductionAtlasDescriptor,
} from "../assets/productionManifest";

export const WARM_SPRINGS_REGION_ID = "warm_springs" as const;

const REQUIRED_KIT = "spring-terraces" as const;
const TERRAIN_ATLAS_ID = "warm-springs-v1-terrain" as const;
const SCENERY_ATLAS_ID = "warm-springs-v1-scenery" as const;
const TILE_SIZE = 32;

/** The published generation's exact geometry; a drift here must fail loudly. */
const TERRAIN_IMAGE = Object.freeze({ file: "terrain.png", width: 512, height: 864 });
const SCENERY_IMAGE = Object.freeze({ file: "scenery.png", width: 480, height: 640 });
const EXPECTED_FRAME_COUNT = 489;

/**
 * The corner-mask bit convention the ART was authored against.
 *
 * `WarmSpringsTerrainField.deriveTile` folds its four corner samples in the order
 * NW, NE, SE, SW with `mask |= 1 << cornerIndex`. Get this wrong and every transition
 * frame is mirrored or rotated relative to the material field — materials interlocking
 * along the wrong diagonal, subtle enough to survive a glance and wrong on every plate.
 * The manifest DECLARES its convention and this module asserts the two agree at load,
 * so a silent art-side change is an immediate crash rather than a rendering bug found
 * by eye later.
 */
export const WARM_SPRINGS_CORNER_BITS = Object.freeze({ nw: 1, ne: 2, se: 4, sw: 8 });

type WarmSpringsAtlasImageId = "terrain" | "scenery";

export interface WarmSpringsAtlasImageRecord {
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly compressedBytes: number;
  readonly decodedBytes: number;
  readonly sha256: string;
}

export interface WarmSpringsAtlasFrameRecord {
  readonly id: string;
  readonly atlasId: typeof TERRAIN_ATLAS_ID | typeof SCENERY_ATLAS_ID;
  readonly image: WarmSpringsAtlasImageId;
  readonly rect: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly pivot: Readonly<{ x: number; y: number }>;
}

export interface WarmSpringsAtlasProfile {
  readonly regionId: typeof WARM_SPRINGS_REGION_ID;
  readonly requiredKit: typeof REQUIRED_KIT;
  readonly terrainAtlasId: typeof TERRAIN_ATLAS_ID;
  readonly sceneryAtlasId: typeof SCENERY_ATLAS_ID;
  readonly descriptors: readonly ProductionAtlasDescriptor[];
  readonly frames: Readonly<Record<string, WarmSpringsAtlasFrameRecord>>;
  /** Material vocabulary the generation was authored for. */
  readonly materials: readonly string[];
  readonly blockingMaterials: readonly string[];
  readonly shoreMaterials: readonly string[];
  /** Compressed bytes of the two published sheets. */
  readonly compressedBytes: number;
}

export class WarmSpringsAssetProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WarmSpringsAssetProfileError";
  }
}

interface ParsedAtlasManifest {
  readonly images: Readonly<Record<WarmSpringsAtlasImageId, WarmSpringsAtlasImageRecord>>;
  readonly frames: Readonly<Record<string, WarmSpringsAtlasFrameRecord>>;
  readonly materials: readonly string[];
  readonly blockingMaterials: readonly string[];
  readonly shoreMaterials: readonly string[];
}

const TERRAIN_URL = new URL(
  "../../../assets/renderer2d/regions/warm-springs-v1/terrain.png",
  import.meta.url,
);
const SCENERY_URL = new URL(
  "../../../assets/renderer2d/regions/warm-springs-v1/scenery.png",
  import.meta.url,
);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

function requiredInteger(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new WarmSpringsAssetProfileError(`${label} must be a safe integer >= ${minimum}.`);
  }
  return value as number;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new WarmSpringsAssetProfileError(`${label} must be a non-empty string.`);
  }
  return value;
}

function requiredStringList(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new WarmSpringsAssetProfileError(`${label} must be a non-empty array.`);
  }
  return Object.freeze(value.map((entry, index) => requiredString(entry, `${label}[${index}]`)));
}

function parseImageRecord(
  value: unknown,
  imageId: WarmSpringsAtlasImageId,
  expected: Readonly<{ file: string; width: number; height: number }>,
): WarmSpringsAtlasImageRecord {
  if (!isRecord(value)) {
    throw new WarmSpringsAssetProfileError(`Warm Springs ${imageId} image metadata is missing.`);
  }
  const file = requiredString(value.file, `${imageId}.file`);
  const width = requiredInteger(value.width, `${imageId}.width`, 1);
  const height = requiredInteger(value.height, `${imageId}.height`, 1);
  const compressedBytes = requiredInteger(value.compressedBytes, `${imageId}.compressedBytes`, 1);
  const decodedBytes = requiredInteger(value.decodedBytes, `${imageId}.decodedBytes`, 1);
  const sha256 = requiredString(value.sha256, `${imageId}.sha256`);
  if (file !== expected.file || width !== expected.width || height !== expected.height) {
    throw new WarmSpringsAssetProfileError(
      `Warm Springs ${imageId} metadata does not match its approved production geometry.`,
    );
  }
  if (decodedBytes !== width * height * 4) {
    throw new WarmSpringsAssetProfileError(`Warm Springs ${imageId} decoded byte count is invalid.`);
  }
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new WarmSpringsAssetProfileError(`Warm Springs ${imageId} SHA-256 is invalid.`);
  }
  return Object.freeze({ file, width, height, compressedBytes, decodedBytes, sha256 });
}

/** Expand the compact terrain grid: one 32 px cell per id, in row-major grid order. */
function parseTerrainGrid(
  value: unknown,
  image: WarmSpringsAtlasImageRecord,
): readonly WarmSpringsAtlasFrameRecord[] {
  if (!isRecord(value) || value.image !== "terrain") {
    throw new WarmSpringsAssetProfileError("Warm Springs atlas requires a terrain grid.");
  }
  const columns = requiredInteger(value.columns, "terrainGrid.columns", 1);
  const cell = requiredInteger(value.cell, "terrainGrid.cell", 1);
  if (cell !== TILE_SIZE) {
    throw new WarmSpringsAssetProfileError("Warm Springs terrain grid must use 32px cells.");
  }
  if (!Array.isArray(value.ids) || value.ids.length === 0) {
    throw new WarmSpringsAssetProfileError("Warm Springs terrain grid must list frame ids.");
  }
  return Object.freeze(value.ids.map((candidate, index) => {
    const id = requiredString(candidate, `terrainGrid.ids[${index}]`);
    const x = (index % columns) * cell;
    const y = Math.floor(index / columns) * cell;
    if (x + cell > image.width || y + cell > image.height) {
      throw new WarmSpringsAssetProfileError(`Warm Springs terrain frame ${id} exceeds its atlas.`);
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
  image: WarmSpringsAtlasImageRecord,
): readonly WarmSpringsAtlasFrameRecord[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new WarmSpringsAssetProfileError("Warm Springs atlas must publish scenery frames.");
  }
  return Object.freeze(value.map((candidate, index) => {
    if (!Array.isArray(candidate) || candidate.length !== 7) {
      throw new WarmSpringsAssetProfileError(
        `Warm Springs scenery frame ${index} must be a 7-field tuple.`,
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
      throw new WarmSpringsAssetProfileError(`Warm Springs frame ${id} exceeds its atlas bounds.`);
    }
    if (pivot.x > rect.width || pivot.y > rect.height) {
      throw new WarmSpringsAssetProfileError(`Warm Springs frame ${id} has an out-of-bounds pivot.`);
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

function assertCornerBits(value: unknown): void {
  if (!isRecord(value)) {
    throw new WarmSpringsAssetProfileError(
      "Warm Springs atlas must declare the corner-bit convention it was authored against.",
    );
  }
  const expected = WARM_SPRINGS_CORNER_BITS;
  if (value.nw !== expected.nw || value.ne !== expected.ne
    || value.se !== expected.se || value.sw !== expected.sw) {
    throw new WarmSpringsAssetProfileError(
      `Warm Springs atlas declares corner bits (nw=${String(value.nw)}, ne=${String(value.ne)}, `
      + `se=${String(value.se)}, sw=${String(value.sw)}) which disagree with the terrain field's `
      + `(nw=${expected.nw}, ne=${expected.ne}, se=${expected.se}, sw=${expected.sw}). Every `
      + "transition frame would be mirrored relative to the material field.",
    );
  }
}

function parseAtlasManifest(value: unknown): ParsedAtlasManifest {
  if (!isRecord(value) || value.schema !== 2 || value.tileSize !== TILE_SIZE
    || !isRecord(value.images)) {
    throw new WarmSpringsAssetProfileError(
      "Warm Springs requires atlas schema 2 with 32px tiles and image metadata.",
    );
  }
  assertCornerBits(value.cornerBits);
  const images = Object.freeze({
    terrain: parseImageRecord(value.images.terrain, "terrain", TERRAIN_IMAGE),
    scenery: parseImageRecord(value.images.scenery, "scenery", SCENERY_IMAGE),
  });
  const frames: Record<string, WarmSpringsAtlasFrameRecord> = {};
  for (const frame of [
    ...parseTerrainGrid(value.terrainGrid, images.terrain),
    ...parseSceneryFrames(value.sceneryFrames, images.scenery),
  ]) {
    if (frames[frame.id] !== undefined) {
      throw new WarmSpringsAssetProfileError(
        `Warm Springs atlas contains duplicate frame ${frame.id}.`,
      );
    }
    frames[frame.id] = frame;
  }
  if (Object.keys(frames).length !== EXPECTED_FRAME_COUNT) {
    throw new WarmSpringsAssetProfileError(
      `Warm Springs atlas must publish exactly ${EXPECTED_FRAME_COUNT} frames.`,
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
  image: WarmSpringsAtlasImageRecord,
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

export const WARM_SPRINGS_ATLAS_PROFILE: WarmSpringsAtlasProfile = Object.freeze({
  regionId: WARM_SPRINGS_REGION_ID,
  requiredKit: REQUIRED_KIT,
  terrainAtlasId: TERRAIN_ATLAS_ID,
  sceneryAtlasId: SCENERY_ATLAS_ID,
  descriptors: Object.freeze([terrainDescriptor, sceneryDescriptor]),
  frames: parsedManifest.frames,
  materials: parsedManifest.materials,
  blockingMaterials: parsedManifest.blockingMaterials,
  shoreMaterials: parsedManifest.shoreMaterials,
  compressedBytes: terrainDescriptor.compressedBytes + sceneryDescriptor.compressedBytes,
});

/**
 * Add the exact Warm Springs atlas descriptors without changing biome-pack ownership.
 *
 * Enforces the shared active-atlas ceiling the same way `createNirvanaProductionManifest`
 * does: the `spring-terraces` kit's own active bytes plus this profile's two sheets must
 * stay inside `budgets.activeCompressedMax`.
 *
 * @param base - The manifest to extend; not mutated.
 * @returns A new frozen manifest carrying the two exact atlas descriptors.
 * @throws {WarmSpringsAssetProfileError} On budget overrun or an atlas-id collision.
 */
export function createWarmSpringsProductionManifest(
  base: ProductionAssetManifest,
): ProductionAssetManifest {
  const projectedActiveBytes = base.budgets.activeCompressedBytes[REQUIRED_KIT]
    + WARM_SPRINGS_ATLAS_PROFILE.compressedBytes;
  if (!Number.isSafeInteger(projectedActiveBytes)
    || projectedActiveBytes > base.budgets.activeCompressedMax) {
    throw new WarmSpringsAssetProfileError(
      `Warm Springs active compressed budget exceeded: ${projectedActiveBytes} > ${base.budgets.activeCompressedMax}.`,
    );
  }
  const atlases = { ...base.atlases };
  for (const descriptor of WARM_SPRINGS_ATLAS_PROFILE.descriptors) {
    const existing = atlases[descriptor.id];
    if (existing !== undefined && existing !== descriptor) {
      throw new WarmSpringsAssetProfileError(
        `Warm Springs atlas ID ${descriptor.id} is already owned by another descriptor.`,
      );
    }
    atlases[descriptor.id] = descriptor;
  }
  return Object.freeze({
    ...base,
    atlases: Object.freeze(atlases),
  });
}
