/**
 * @fileoverview The exact, validated asset profile for production Nirvana West.
 *
 * Reads the published `nirvana-west-v1` generation — schema 2, mirroring
 * `warm-springs-v1` and `nirvana-east-v1` exactly: the terrain sheet is a fixed 32 px
 * grid addressed by an id list, and scenery frames are positional tuples. Both are
 * expanded here into one flat frame table.
 *
 * RE-PINNED after the composition-B design merge (was: 512x896 terrain, a 14-material
 * list carrying `brine`/`rime`, 7-field scenery tuples, 534 frames). Two changes drove
 * it:
 *
 * 1. The material stack was trimmed and extended. `brine` and `rime` belonged to
 *    compositions the owner did not choose and are gone; `slab` and `spoil` are new
 *    TERRAIN tiers (poured concrete apron/foundation, tailings/scorch staining) that
 *    are WALKABLE, letting them run under a shelter plot at zero plot cost. The void
 *    family shrank from 3 to 2 (`brine` is gone; `ember`/`emberdim` remain) and
 *    blocking shrank from 5 to 3 (`brine`/`rime` are gone; `ember`/`clinker`/`scree`
 *    remain). Rim materials are unchanged. Four scenery species were retired in the
 *    same pass: `slab` (now a terrain tier — the name collision is deliberate context,
 *    not an authoring accident), `apron`/`spill` (redundant decals at island scale now
 *    that `slab`/`spoil` are terrain fields), and `rimecluster` (went with `rime`).
 * 2. `sceneryFrames` tuples grew from 7 to 11 fields, carrying a MEASURED ground
 *    contact rect (frame-local pixels: the bounding box of fully opaque pixels in the
 *    band just above the sprite's lowest solid row; cast shadows/contact pools are
 *    quantised-alpha and deliberately excluded — a shadow is picture, not wall). A
 *    zero-area contact means the species has no wall at all; see
 *    `NirvanaWestAtlasSceneryFrameRecord.contact`. Terrain base fills carry no contact
 *    field at all (see the discriminated union below) — a synthesized "full cell"
 *    footprint would not be MEASURED data, and the whole point of this field is that
 *    it is.
 *
 * Byte accounting, against the plan's Global Constraints:
 *
 * ```
 * Ceiling A — per-kit region, 196,608 B
 *   terrain.png                    105,813 B
 *   scenery.png                     26,018 B
 *   atlas.json                      12,082 B
 *   environment.png (kit art)          794 B
 *                                  ----------
 *   total                          144,707 B = 73.60 %   (headroom 51,901 B)
 *
 * Ceiling B — shared active atlas, 1,310,720 B   (the one this module ENFORCES)
 *   activeCompressedBytes["ash-waste"] + 131,831 B of art
 * ```
 *
 * The ~51.9 KB of Ceiling-A headroom is deliberately NOT spent, for the same reason
 * Warm Springs and Nirvana East keep their own margins: Nirvana shipped at 97.93% and
 * needed a named 70-frame cut to get there, which is exactly why its reed beds later
 * needed rescuing (`.superpowers/sdd/nirvana-live-report.md` §4.3, §D7). Nirvana West
 * keeps its margin.
 */

import atlasManifest from "../../../assets/renderer2d/regions/nirvana-west-v1/atlas.json";
import type {
  ProductionAssetManifest,
  ProductionAtlasDescriptor,
} from "../assets/productionManifest";

export const NIRVANA_WEST_REGION_ID = "nirvana_west" as const;

const REQUIRED_KIT = "ash-waste" as const;
const TERRAIN_ATLAS_ID = "nirvana-west-v1-terrain" as const;
const SCENERY_ATLAS_ID = "nirvana-west-v1-scenery" as const;
const TILE_SIZE = 32;
const IMAGE_ENCODING = "indexed8" as const;

/** The published generation's exact geometry; a drift here must fail loudly. */
const TERRAIN_IMAGE = Object.freeze({ file: "terrain.png", width: 512, height: 960 });
const SCENERY_IMAGE = Object.freeze({ file: "scenery.png", width: 640, height: 1600 });
// 468 terrain-grid frames (104 base fills + 280 corner-masked edges + 84 rim lines)
// plus 83 scenery frames -- the exact published Nirvana West vocabulary.
const EXPECTED_FRAME_COUNT = 551;

/**
 * The corner-mask bit convention the ART was authored against.
 *
 * The terrain field this profile feeds folds its four corner samples in the order
 * NW, NE, SE, SW with `mask |= 1 << cornerIndex`. Get this wrong and every transition
 * frame is mirrored or rotated relative to the material field — materials interlocking
 * along the wrong diagonal, subtle enough to survive a glance and wrong on every plate.
 * The manifest DECLARES its convention and this module asserts the two agree at load,
 * so a silent art-side change is an immediate crash rather than a rendering bug found
 * by eye later.
 */
export const NIRVANA_WEST_CORNER_BITS = Object.freeze({ nw: 1, ne: 2, se: 4, sw: 8 });

/**
 * The fourteen-material vocabulary the `nirvana-west-v1` art was authored against, in
 * paint-priority order. Pinned here (rather than trusted from the manifest verbatim)
 * because this module owns no dependency on a materials module of its own — a drift
 * between this list and the published manifest is exactly the kind of silent mismatch
 * that should fail loudly at load rather than surface as a missing-frame crash later.
 */
export const NIRVANA_WEST_MATERIALS = Object.freeze([
  "ember",
  "emberdim",
  "glass",
  "cinder",
  "slatedark",
  "slate",
  "dust",
  "ash",
  "ashpale",
  "slab",
  "spoil",
  "clinker",
  "scree",
  "causeway",
] as const);

export type NirvanaWestMaterial = (typeof NIRVANA_WEST_MATERIALS)[number];

/** Materials a body may not stand on or route through. */
export const NIRVANA_WEST_BLOCKING_MATERIALS: readonly NirvanaWestMaterial[] = Object.freeze([
  "ember",
  "clinker",
  "scree",
]);

/** Bank materials that own a `w.*` rim-line overlay set against the void family. */
export const NIRVANA_WEST_RIM_MATERIALS: readonly NirvanaWestMaterial[] = Object.freeze([
  "cinder",
  "ashpale",
  "clinker",
]);

/** The "nothing" family a rim line is drawn against. */
export const NIRVANA_WEST_VOID_MATERIALS: readonly NirvanaWestMaterial[] = Object.freeze([
  "ember",
  "emberdim",
]);

type NirvanaWestAtlasImageId = "terrain" | "scenery";

export interface NirvanaWestAtlasImageRecord {
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly compressedBytes: number;
  readonly decodedBytes: number;
  readonly sha256: string;
}

/** A measured ground-contact footprint, in frame-local pixels. */
export interface NirvanaWestContactRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface NirvanaWestAtlasTerrainFrameRecord {
  readonly id: string;
  readonly atlasId: typeof TERRAIN_ATLAS_ID;
  readonly image: "terrain";
  readonly rect: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly pivot: Readonly<{ x: number; y: number }>;
}

export interface NirvanaWestAtlasSceneryFrameRecord {
  readonly id: string;
  readonly atlasId: typeof SCENERY_ATLAS_ID;
  readonly image: "scenery";
  readonly rect: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly pivot: Readonly<{ x: number; y: number }>;
  /**
   * The measured ground-contact footprint, in frame-local pixels: the bounding box of
   * fully opaque pixels in the band just above the sprite's lowest solid row. Cast
   * shadows and contact pools are laid at quantised alpha and are deliberately
   * excluded — a shadow is picture, not wall.
   *
   * A zero-area rect (`{x:0, y:0, width:0, height:0}`) means the species has no wall
   * at all — a flat decal or a ground marking. Callers MUST treat that as "no
   * footprint", not as an error; see `nirvanaWestFrameHasFootprint` in `./NirvanaWestAtlas`.
   */
  readonly contact: NirvanaWestContactRect;
}

export type NirvanaWestAtlasFrameRecord =
  | NirvanaWestAtlasTerrainFrameRecord
  | NirvanaWestAtlasSceneryFrameRecord;

export interface NirvanaWestAtlasProfile {
  readonly regionId: typeof NIRVANA_WEST_REGION_ID;
  readonly requiredKit: typeof REQUIRED_KIT;
  readonly terrainAtlasId: typeof TERRAIN_ATLAS_ID;
  readonly sceneryAtlasId: typeof SCENERY_ATLAS_ID;
  readonly descriptors: readonly ProductionAtlasDescriptor[];
  readonly frames: Readonly<Record<string, NirvanaWestAtlasFrameRecord>>;
  /** Material vocabulary the generation was authored for, in paint-priority order. */
  readonly materials: readonly NirvanaWestMaterial[];
  readonly blockingMaterials: readonly NirvanaWestMaterial[];
  readonly rimMaterials: readonly NirvanaWestMaterial[];
  readonly voidMaterials: readonly NirvanaWestMaterial[];
  /** Compressed bytes of the two published sheets. */
  readonly compressedBytes: number;
}

export class NirvanaWestAssetProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NirvanaWestAssetProfileError";
  }
}

interface ParsedAtlasManifest {
  readonly images: Readonly<Record<NirvanaWestAtlasImageId, NirvanaWestAtlasImageRecord>>;
  readonly frames: Readonly<Record<string, NirvanaWestAtlasFrameRecord>>;
}

const TERRAIN_URL = new URL(
  "../../../assets/renderer2d/regions/nirvana-west-v1/terrain.png",
  import.meta.url,
);
const SCENERY_URL = new URL(
  "../../../assets/renderer2d/regions/nirvana-west-v1/scenery.png",
  import.meta.url,
);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

function requiredInteger(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new NirvanaWestAssetProfileError(`${label} must be a safe integer >= ${minimum}.`);
  }
  return value as number;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new NirvanaWestAssetProfileError(`${label} must be a non-empty string.`);
  }
  return value;
}

/**
 * Parse and validate one image record, additionally asserting the `indexed8` encoding
 * the published generation was compressed with — a measured fact of this generation,
 * not an assumption, so a drift (e.g. a republish that switches palette encoding) fails
 * loudly here rather than silently changing the region's byte budget.
 */
function parseImageRecord(
  value: unknown,
  imageId: NirvanaWestAtlasImageId,
  expected: Readonly<{ file: string; width: number; height: number }>,
): NirvanaWestAtlasImageRecord {
  if (!isRecord(value)) {
    throw new NirvanaWestAssetProfileError(`Nirvana West ${imageId} image metadata is missing.`);
  }
  const file = requiredString(value.file, `${imageId}.file`);
  const width = requiredInteger(value.width, `${imageId}.width`, 1);
  const height = requiredInteger(value.height, `${imageId}.height`, 1);
  const compressedBytes = requiredInteger(value.compressedBytes, `${imageId}.compressedBytes`, 1);
  const decodedBytes = requiredInteger(value.decodedBytes, `${imageId}.decodedBytes`, 1);
  const sha256 = requiredString(value.sha256, `${imageId}.sha256`);
  if (file !== expected.file || width !== expected.width || height !== expected.height) {
    throw new NirvanaWestAssetProfileError(
      `Nirvana West ${imageId} metadata does not match its approved production geometry.`,
    );
  }
  if (decodedBytes !== width * height * 4) {
    throw new NirvanaWestAssetProfileError(`Nirvana West ${imageId} decoded byte count is invalid.`);
  }
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new NirvanaWestAssetProfileError(`Nirvana West ${imageId} SHA-256 is invalid.`);
  }
  if (value.encoding !== IMAGE_ENCODING) {
    throw new NirvanaWestAssetProfileError(
      `Nirvana West ${imageId} must be published as ${IMAGE_ENCODING}, got ${String(value.encoding)}.`,
    );
  }
  return Object.freeze({ file, width, height, compressedBytes, decodedBytes, sha256 });
}

/** Expand the compact terrain grid: one 32 px cell per id, in row-major grid order. */
function parseTerrainGrid(
  value: unknown,
  image: NirvanaWestAtlasImageRecord,
): readonly NirvanaWestAtlasTerrainFrameRecord[] {
  if (!isRecord(value) || value.image !== "terrain") {
    throw new NirvanaWestAssetProfileError("Nirvana West atlas requires a terrain grid.");
  }
  const columns = requiredInteger(value.columns, "terrainGrid.columns", 1);
  const cell = requiredInteger(value.cell, "terrainGrid.cell", 1);
  if (cell !== TILE_SIZE) {
    throw new NirvanaWestAssetProfileError("Nirvana West terrain grid must use 32px cells.");
  }
  if (!Array.isArray(value.ids) || value.ids.length === 0) {
    throw new NirvanaWestAssetProfileError("Nirvana West terrain grid must list frame ids.");
  }
  return Object.freeze(value.ids.map((candidate, index) => {
    const id = requiredString(candidate, `terrainGrid.ids[${index}]`);
    const x = (index % columns) * cell;
    const y = Math.floor(index / columns) * cell;
    if (x + cell > image.width || y + cell > image.height) {
      throw new NirvanaWestAssetProfileError(`Nirvana West terrain frame ${id} exceeds its atlas.`);
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

/**
 * Parse one scenery tuple's trailing four fields into its measured contact rect.
 *
 * A tuple of exactly `{0,0,0,0}` is a valid "no footprint" declaration (a flat decal
 * or ground marking) and is passed through as-is. Any OTHER partially-zero
 * combination (e.g. a zero width with a nonzero x) is malformed — it can only have
 * come from a corrupted publish, not a deliberate "no footprint" author choice — and
 * is rejected, as is a nonzero rect that spills outside its own frame.
 */
function parseContactRect(
  candidate: readonly unknown[],
  id: string,
  rect: Readonly<{ width: number; height: number }>,
): NirvanaWestContactRect {
  const x = requiredInteger(candidate[7], `${id}.contact.x`);
  const y = requiredInteger(candidate[8], `${id}.contact.y`);
  const width = requiredInteger(candidate[9], `${id}.contact.width`);
  const height = requiredInteger(candidate[10], `${id}.contact.height`);
  const isZeroFootprint = x === 0 && y === 0 && width === 0 && height === 0;
  if (!isZeroFootprint) {
    if (width < 1 || height < 1) {
      throw new NirvanaWestAssetProfileError(
        `Nirvana West frame ${id} has a malformed contact rect: it must be a real `
        + "footprint (positive width and height) or exactly {0,0,0,0} for no footprint.",
      );
    }
    if (x + width > rect.width || y + height > rect.height) {
      throw new NirvanaWestAssetProfileError(
        `Nirvana West frame ${id} contact rect exceeds its own frame bounds.`,
      );
    }
  }
  return Object.freeze({ x, y, width, height });
}

/** Expand one scenery tuple: `[id, x, y, w, h, pivotX, pivotY, contactX, contactY, contactW, contactH]`. */
function parseSceneryFrames(
  value: unknown,
  image: NirvanaWestAtlasImageRecord,
): readonly NirvanaWestAtlasSceneryFrameRecord[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new NirvanaWestAssetProfileError("Nirvana West atlas must publish scenery frames.");
  }
  return Object.freeze(value.map((candidate, index) => {
    if (!Array.isArray(candidate) || candidate.length !== 11) {
      throw new NirvanaWestAssetProfileError(
        `Nirvana West scenery frame ${index} must be an 11-field tuple `
        + "(id,x,y,w,h,pivotX,pivotY,contactX,contactY,contactW,contactH); the older "
        + "7-field shape has no measured ground contact and cannot be used.",
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
      throw new NirvanaWestAssetProfileError(`Nirvana West frame ${id} exceeds its atlas bounds.`);
    }
    if (pivot.x > rect.width || pivot.y > rect.height) {
      throw new NirvanaWestAssetProfileError(`Nirvana West frame ${id} has an out-of-bounds pivot.`);
    }
    const contact = parseContactRect(candidate, id, rect);
    return Object.freeze({
      id,
      atlasId: SCENERY_ATLAS_ID,
      image: "scenery" as const,
      rect,
      pivot,
      contact,
    });
  }));
}

function assertCornerBits(value: unknown): void {
  if (!isRecord(value)) {
    throw new NirvanaWestAssetProfileError(
      "Nirvana West atlas must declare the corner-bit convention it was authored against.",
    );
  }
  const expected = NIRVANA_WEST_CORNER_BITS;
  if (value.nw !== expected.nw || value.ne !== expected.ne
    || value.se !== expected.se || value.sw !== expected.sw) {
    throw new NirvanaWestAssetProfileError(
      `Nirvana West atlas declares corner bits (nw=${String(value.nw)}, ne=${String(value.ne)}, `
      + `se=${String(value.se)}, sw=${String(value.sw)}) which disagree with the terrain field's `
      + `(nw=${expected.nw}, ne=${expected.ne}, se=${expected.se}, sw=${expected.sw}). Every `
      + "transition frame would be mirrored relative to the material field.",
    );
  }
}

/**
 * Assert that `value`'s ordered material group exactly matches `expected`.
 *
 * @throws {NirvanaWestAssetProfileError} If the published list's length, order, or
 *   membership disagrees with the pinned vocabulary this module was authored against.
 */
function assertMaterialGroup(
  value: unknown,
  label: string,
  expected: readonly NirvanaWestMaterial[],
): void {
  if (!Array.isArray(value) || value.length !== expected.length
    || value.some((entry, index) => entry !== expected[index])) {
    throw new NirvanaWestAssetProfileError(
      `Nirvana West atlas ${label} must publish exactly [${expected.join(", ")}], got `
      + `${Array.isArray(value) ? `[${value.join(", ")}]` : String(value)}.`,
    );
  }
}

/**
 * Assert the manifest publishes no `environment` image.
 *
 * The animated environment sheet is per-KIT art (`ash-waste-environment`, already
 * published via `assets/productionManifest.ts`), never per-region art — a region
 * manifest that starts carrying its own `environment` image has silently forked kit
 * art the shared kit pipeline already owns, which is a bug worth crashing on rather
 * than quietly doubling the animated-frame source of truth.
 */
function assertNoEnvironmentImage(images: unknown): void {
  if (isRecord(images) && "environment" in images) {
    throw new NirvanaWestAssetProfileError(
      "Nirvana West atlas must not publish its own environment image — the animated "
      + "sheet is per-kit art (ash-waste-environment), published separately.",
    );
  }
}

function parseAtlasManifest(value: unknown): ParsedAtlasManifest {
  if (!isRecord(value) || value.schema !== 2 || value.tileSize !== TILE_SIZE
    || !isRecord(value.images)) {
    throw new NirvanaWestAssetProfileError(
      "Nirvana West requires atlas schema 2 with 32px tiles and image metadata.",
    );
  }
  assertCornerBits(value.cornerBits);
  assertNoEnvironmentImage(value.images);
  assertMaterialGroup(value.materials, "materials", NIRVANA_WEST_MATERIALS);
  assertMaterialGroup(value.blockingMaterials, "blockingMaterials", NIRVANA_WEST_BLOCKING_MATERIALS);
  assertMaterialGroup(value.rimMaterials, "rimMaterials", NIRVANA_WEST_RIM_MATERIALS);
  assertMaterialGroup(value.voidMaterials, "voidMaterials", NIRVANA_WEST_VOID_MATERIALS);
  const images = Object.freeze({
    terrain: parseImageRecord(value.images.terrain, "terrain", TERRAIN_IMAGE),
    scenery: parseImageRecord(value.images.scenery, "scenery", SCENERY_IMAGE),
  });
  const frames: Record<string, NirvanaWestAtlasFrameRecord> = {};
  for (const frame of [
    ...parseTerrainGrid(value.terrainGrid, images.terrain),
    ...parseSceneryFrames(value.sceneryFrames, images.scenery),
  ]) {
    if (frames[frame.id] !== undefined) {
      throw new NirvanaWestAssetProfileError(
        `Nirvana West atlas contains duplicate frame ${frame.id}.`,
      );
    }
    frames[frame.id] = frame;
  }
  if (Object.keys(frames).length !== EXPECTED_FRAME_COUNT) {
    throw new NirvanaWestAssetProfileError(
      `Nirvana West atlas must publish exactly ${EXPECTED_FRAME_COUNT} frames.`,
    );
  }
  return Object.freeze({
    images,
    frames: Object.freeze(frames),
  });
}

function atlasDescriptor(
  id: typeof TERRAIN_ATLAS_ID | typeof SCENERY_ATLAS_ID,
  url: URL,
  image: NirvanaWestAtlasImageRecord,
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

export const NIRVANA_WEST_ATLAS_PROFILE: NirvanaWestAtlasProfile = Object.freeze({
  regionId: NIRVANA_WEST_REGION_ID,
  requiredKit: REQUIRED_KIT,
  terrainAtlasId: TERRAIN_ATLAS_ID,
  sceneryAtlasId: SCENERY_ATLAS_ID,
  descriptors: Object.freeze([terrainDescriptor, sceneryDescriptor]),
  frames: parsedManifest.frames,
  materials: NIRVANA_WEST_MATERIALS,
  blockingMaterials: NIRVANA_WEST_BLOCKING_MATERIALS,
  rimMaterials: NIRVANA_WEST_RIM_MATERIALS,
  voidMaterials: NIRVANA_WEST_VOID_MATERIALS,
  compressedBytes: terrainDescriptor.compressedBytes + sceneryDescriptor.compressedBytes,
});

/**
 * Add the exact Nirvana West atlas descriptors without changing biome-pack ownership.
 *
 * Enforces the shared active-atlas ceiling the same way `createWarmSpringsProductionManifest`
 * and `createNirvanaEastProductionManifest` do: the `ash-waste` kit's own active bytes
 * plus this profile's two sheets must stay inside `budgets.activeCompressedMax`.
 *
 * @param base - The manifest to extend; not mutated.
 * @returns A new frozen manifest carrying the two exact atlas descriptors.
 * @throws {NirvanaWestAssetProfileError} On budget overrun or an atlas-id collision.
 */
export function createNirvanaWestProductionManifest(
  base: ProductionAssetManifest,
): ProductionAssetManifest {
  const projectedActiveBytes = base.budgets.activeCompressedBytes[REQUIRED_KIT]
    + NIRVANA_WEST_ATLAS_PROFILE.compressedBytes;
  if (!Number.isSafeInteger(projectedActiveBytes)
    || projectedActiveBytes > base.budgets.activeCompressedMax) {
    throw new NirvanaWestAssetProfileError(
      `Nirvana West active compressed budget exceeded: ${projectedActiveBytes} > ${base.budgets.activeCompressedMax}.`,
    );
  }
  const atlases = { ...base.atlases };
  for (const descriptor of NIRVANA_WEST_ATLAS_PROFILE.descriptors) {
    const existing = atlases[descriptor.id];
    if (existing !== undefined && existing !== descriptor) {
      throw new NirvanaWestAssetProfileError(
        `Nirvana West atlas ID ${descriptor.id} is already owned by another descriptor.`,
      );
    }
    atlases[descriptor.id] = descriptor;
  }
  return Object.freeze({
    ...base,
    atlases: Object.freeze(atlases),
  });
}
