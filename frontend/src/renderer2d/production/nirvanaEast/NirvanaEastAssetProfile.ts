/**
 * @fileoverview The exact, validated asset profile for production Nirvana East.
 *
 * Reads the published `nirvana-east-v1` generation — the owner-approved composition B
 * ("Butte Country") republished byte-for-byte from the pilot art
 * (`src/qa/nirvanaEastPilot/`). Schema 2 is a COMPACT manifest, mirroring
 * `warm-springs-v1` exactly: the terrain sheet is a fixed 32 px grid addressed by an id
 * list, and scenery frames are positional tuples. Both are expanded here into one flat
 * frame table.
 *
 * Byte accounting, against the plan's Global Constraints:
 *
 * ```
 * Ceiling A — per-kit region, 196,608 B
 *   terrain.png                     109,910 B   (UNCHANGED by the plan-variant pass)
 *   scenery.png                      48,008 B   (was 29,346 B)
 *   atlas.json                        9,797 B   (was 9,605 B)
 *                                  ----------
 *   total                           167,715 B = 85.30 %   (headroom 28,893 B ~= 28.2 KB)
 *
 * Ceiling B — shared active atlas, 1,310,720 B   (the one this module ENFORCES)
 *   activeCompressedBytes["dry-scrub"] + 157,918 B of art
 * ```
 *
 * **Where the +18,854 B went, and why it was the right place to spend it.** The region
 * ships one hand-authored cap plan per landform tier, and the settled-band infill raised
 * outcrops from 31 to ~40 — so the repetition became more visible than the approved
 * plate's, worst exactly where the small tiers cluster among the shelter plots. The
 * spend buys two extra butte plans and three extra outcrop plans
 * ({@link NIRVANA_EAST_LANDFORM_VARIANTS}); the mesa keeps its single approved plan
 * because there are only ever one to three mesas in the region and a second mesa frame
 * alone would cost ~20 KB, a fifth of the whole budget, on the one tier whose repetition
 * nobody can see. Every pre-existing frame is PIXEL-IDENTICAL — measured, all 50 of them
 * — so the object the owner gated across two rounds still ships unchanged.
 *
 * The remaining ~28 KB of Ceiling-A headroom stays unspent, for the same reason Warm
 * Springs keeps its own margin: Nirvana shipped at 97.93 % and needed a named 70-frame cut
 * to get there, which is exactly why its reed beds later needed rescuing
 * (`.superpowers/sdd/nirvana-live-report.md` §4.3, §D7).
 */

import atlasManifest from "../../../assets/renderer2d/regions/nirvana-east-v1/atlas.json";
import type {
  ProductionAssetManifest,
  ProductionAtlasDescriptor,
} from "../assets/productionManifest";
import {
  NIRVANA_EAST_LANDFORM_TIERS,
  NIRVANA_EAST_LANDFORM_VARIANTS,
  PROP_PIVOTS,
} from "./NirvanaEastTerrainField";

export const NIRVANA_EAST_REGION_ID = "nirvana_east" as const;

const REQUIRED_KIT = "dry-scrub" as const;
const TERRAIN_ATLAS_ID = "nirvana-east-v1-terrain" as const;
const SCENERY_ATLAS_ID = "nirvana-east-v1-scenery" as const;
const TILE_SIZE = 32;

/** The published generation's exact geometry; a drift here must fail loudly. */
const TERRAIN_IMAGE = Object.freeze({ file: "terrain.png", width: 512, height: 928 });
const SCENERY_IMAGE = Object.freeze({ file: "scenery.png", width: 528, height: 1464 });
const EXPECTED_FRAME_COUNT = 509;

/**
 * The corner-mask bit convention the ART was authored against.
 *
 * `eastScene.ts`'s `deriveTile` (and, once it lands, `NirvanaEastTerrainField.ts`'s
 * equivalent) folds its four corner samples in the order NW, NE, SE, SW with
 * `mask |= 1 << cornerIndex`. Get this wrong and every transition frame is mirrored or
 * rotated relative to the material field — materials interlocking along the wrong
 * diagonal, subtle enough to survive a glance and wrong on every plate. The manifest
 * DECLARES its convention and this module asserts the two agree at load, so a silent
 * art-side change is an immediate crash rather than a rendering bug found by eye later.
 */
export const NIRVANA_EAST_CORNER_BITS = Object.freeze({ nw: 1, ne: 2, se: 4, sw: 8 });

type NirvanaEastAtlasImageId = "terrain" | "scenery";

export interface NirvanaEastAtlasImageRecord {
  readonly file: string;
  readonly width: number;
  readonly height: number;
  readonly compressedBytes: number;
  readonly decodedBytes: number;
  readonly sha256: string;
}

export interface NirvanaEastAtlasFrameRecord {
  readonly id: string;
  readonly atlasId: typeof TERRAIN_ATLAS_ID | typeof SCENERY_ATLAS_ID;
  readonly image: NirvanaEastAtlasImageId;
  readonly rect: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly pivot: Readonly<{ x: number; y: number }>;
}

export interface NirvanaEastAtlasProfile {
  readonly regionId: typeof NIRVANA_EAST_REGION_ID;
  readonly requiredKit: typeof REQUIRED_KIT;
  readonly terrainAtlasId: typeof TERRAIN_ATLAS_ID;
  readonly sceneryAtlasId: typeof SCENERY_ATLAS_ID;
  readonly descriptors: readonly ProductionAtlasDescriptor[];
  readonly frames: Readonly<Record<string, NirvanaEastAtlasFrameRecord>>;
  /** Material vocabulary the generation was authored for. */
  readonly materials: readonly string[];
  readonly blockingMaterials: readonly string[];
  readonly shoreMaterials: readonly string[];
  /** Compressed bytes of the two published sheets. */
  readonly compressedBytes: number;
}

export class NirvanaEastAssetProfileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NirvanaEastAssetProfileError";
  }
}

interface ParsedAtlasManifest {
  readonly images: Readonly<Record<NirvanaEastAtlasImageId, NirvanaEastAtlasImageRecord>>;
  readonly frames: Readonly<Record<string, NirvanaEastAtlasFrameRecord>>;
  readonly materials: readonly string[];
  readonly blockingMaterials: readonly string[];
  readonly shoreMaterials: readonly string[];
}

const TERRAIN_URL = new URL(
  "../../../assets/renderer2d/regions/nirvana-east-v1/terrain.png",
  import.meta.url,
);
const SCENERY_URL = new URL(
  "../../../assets/renderer2d/regions/nirvana-east-v1/scenery.png",
  import.meta.url,
);

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === "object" && value !== null && !Array.isArray(value)
);

function requiredInteger(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) {
    throw new NirvanaEastAssetProfileError(`${label} must be a safe integer >= ${minimum}.`);
  }
  return value as number;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new NirvanaEastAssetProfileError(`${label} must be a non-empty string.`);
  }
  return value;
}

function requiredStringList(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new NirvanaEastAssetProfileError(`${label} must be a non-empty array.`);
  }
  return Object.freeze(value.map((entry, index) => requiredString(entry, `${label}[${index}]`)));
}

function parseImageRecord(
  value: unknown,
  imageId: NirvanaEastAtlasImageId,
  expected: Readonly<{ file: string; width: number; height: number }>,
): NirvanaEastAtlasImageRecord {
  if (!isRecord(value)) {
    throw new NirvanaEastAssetProfileError(`Nirvana East ${imageId} image metadata is missing.`);
  }
  const file = requiredString(value.file, `${imageId}.file`);
  const width = requiredInteger(value.width, `${imageId}.width`, 1);
  const height = requiredInteger(value.height, `${imageId}.height`, 1);
  const compressedBytes = requiredInteger(value.compressedBytes, `${imageId}.compressedBytes`, 1);
  const decodedBytes = requiredInteger(value.decodedBytes, `${imageId}.decodedBytes`, 1);
  const sha256 = requiredString(value.sha256, `${imageId}.sha256`);
  if (file !== expected.file || width !== expected.width || height !== expected.height) {
    throw new NirvanaEastAssetProfileError(
      `Nirvana East ${imageId} metadata does not match its approved production geometry.`,
    );
  }
  if (decodedBytes !== width * height * 4) {
    throw new NirvanaEastAssetProfileError(`Nirvana East ${imageId} decoded byte count is invalid.`);
  }
  if (!/^[a-f0-9]{64}$/.test(sha256)) {
    throw new NirvanaEastAssetProfileError(`Nirvana East ${imageId} SHA-256 is invalid.`);
  }
  return Object.freeze({ file, width, height, compressedBytes, decodedBytes, sha256 });
}

/** Expand the compact terrain grid: one 32 px cell per id, in row-major grid order. */
function parseTerrainGrid(
  value: unknown,
  image: NirvanaEastAtlasImageRecord,
): readonly NirvanaEastAtlasFrameRecord[] {
  if (!isRecord(value) || value.image !== "terrain") {
    throw new NirvanaEastAssetProfileError("Nirvana East atlas requires a terrain grid.");
  }
  const columns = requiredInteger(value.columns, "terrainGrid.columns", 1);
  const cell = requiredInteger(value.cell, "terrainGrid.cell", 1);
  if (cell !== TILE_SIZE) {
    throw new NirvanaEastAssetProfileError("Nirvana East terrain grid must use 32px cells.");
  }
  if (!Array.isArray(value.ids) || value.ids.length === 0) {
    throw new NirvanaEastAssetProfileError("Nirvana East terrain grid must list frame ids.");
  }
  return Object.freeze(value.ids.map((candidate, index) => {
    const id = requiredString(candidate, `terrainGrid.ids[${index}]`);
    const x = (index % columns) * cell;
    const y = Math.floor(index / columns) * cell;
    if (x + cell > image.width || y + cell > image.height) {
      throw new NirvanaEastAssetProfileError(`Nirvana East terrain frame ${id} exceeds its atlas.`);
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
  image: NirvanaEastAtlasImageRecord,
): readonly NirvanaEastAtlasFrameRecord[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new NirvanaEastAssetProfileError("Nirvana East atlas must publish scenery frames.");
  }
  return Object.freeze(value.map((candidate, index) => {
    if (!Array.isArray(candidate) || candidate.length !== 7) {
      throw new NirvanaEastAssetProfileError(
        `Nirvana East scenery frame ${index} must be a 7-field tuple.`,
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
      throw new NirvanaEastAssetProfileError(`Nirvana East frame ${id} exceeds its atlas bounds.`);
    }
    if (pivot.x > rect.width || pivot.y > rect.height) {
      throw new NirvanaEastAssetProfileError(`Nirvana East frame ${id} has an out-of-bounds pivot.`);
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
    throw new NirvanaEastAssetProfileError(
      "Nirvana East atlas must declare the corner-bit convention it was authored against.",
    );
  }
  const expected = NIRVANA_EAST_CORNER_BITS;
  if (value.nw !== expected.nw || value.ne !== expected.ne
    || value.se !== expected.se || value.sw !== expected.sw) {
    throw new NirvanaEastAssetProfileError(
      `Nirvana East atlas declares corner bits (nw=${String(value.nw)}, ne=${String(value.ne)}, `
      + `se=${String(value.se)}, sw=${String(value.sw)}) which disagree with the terrain field's `
      + `(nw=${expected.nw}, ne=${expected.ne}, se=${expected.se}, sw=${expected.sw}). Every `
      + "transition frame would be mirrored relative to the material field.",
    );
  }
}

/**
 * Assert that the published landform frames match `NirvanaEastTerrainField.ts`'s
 * `PROP_PIVOTS` exactly — width, height, and pivot — for EVERY authored plan variant the
 * scene may draw, and that no tier publishes a variant the scene can never reach.
 *
 * Promoted from the pilot's `eastPainter.ts`'s `assertLandformPivotsAgree`, run
 * automatically the first time the atlas is parsed rather than trusted silently. A
 * landform placed against the wrong pivot draws floating above or sunk into the ground,
 * because the footprint geometry the scene builder uses to derive collision is computed
 * FROM these numbers — a drift here is a rendering bug AND a collision bug at once.
 *
 * **Every variant is checked, not just variant 0, and that is the point of the widening.**
 * The scene picks a plan variant per placement
 * ({@link NIRVANA_EAST_LANDFORM_VARIANTS}); a tier whose variant 3 was authored at a
 * different size or pivot from its variant 0 would draw correctly most of the time and
 * sink into the ground for one rock in four — precisely the class of defect that survives
 * a glance. The count is asserted in BOTH directions so an art-side variant count that
 * drifts from the scene's own is a crash at load, never a silently unreachable frame
 * (bytes paid for and never drawn) or a missing frame (a rock that draws nothing).
 *
 * @throws {NirvanaEastAssetProfileError} If a landform frame is missing, if its
 *   rect/pivot disagrees with `PROP_PIVOTS`, or if the published variant count for a tier
 *   disagrees with the scene's.
 */
function assertLandformPivotsAgree(
  frames: Readonly<Record<string, NirvanaEastAtlasFrameRecord>>,
): void {
  for (const tier of NIRVANA_EAST_LANDFORM_TIERS) {
    const expected = PROP_PIVOTS[tier];
    if (expected === undefined) {
      throw new NirvanaEastAssetProfileError(
        `NirvanaEastTerrainField.ts's PROP_PIVOTS has no entry for landform tier ${tier}.`,
      );
    }
    const [expectedWidth, expectedHeight, expectedPivotX, expectedPivotY] = expected;
    const expectedVariants = NIRVANA_EAST_LANDFORM_VARIANTS[tier];
    for (let variant = 0; variant < expectedVariants; variant += 1) {
      const frame = frames[`s.${tier}.${variant}`];
      if (frame === undefined) {
        throw new NirvanaEastAssetProfileError(
          `Nirvana East atlas is missing the landform frame s.${tier}.${variant}.`,
        );
      }
      if (
        frame.rect.width !== expectedWidth || frame.rect.height !== expectedHeight
        || frame.pivot.x !== expectedPivotX || frame.pivot.y !== expectedPivotY
      ) {
        throw new NirvanaEastAssetProfileError(
          `Nirvana East atlas frame s.${tier}.${variant} is ${frame.rect.width}x${frame.rect.height} `
          + `pivot(${frame.pivot.x},${frame.pivot.y}), but PROP_PIVOTS expects `
          + `${expectedWidth}x${expectedHeight} pivot(${expectedPivotX},${expectedPivotY}). `
          + "A landform placed against the wrong pivot would draw floating above or sunk into the ground.",
        );
      }
    }
    if (frames[`s.${tier}.${expectedVariants}`] !== undefined) {
      throw new NirvanaEastAssetProfileError(
        `Nirvana East atlas publishes a landform frame s.${tier}.${expectedVariants} the scene `
        + `can never draw: NIRVANA_EAST_LANDFORM_VARIANTS declares ${expectedVariants} plan `
        + `variant(s) for ${tier}. Authored bytes that nothing reaches are bytes spent for nothing.`,
      );
    }
  }
}

function parseAtlasManifest(value: unknown): ParsedAtlasManifest {
  if (!isRecord(value) || value.schema !== 2 || value.tileSize !== TILE_SIZE
    || !isRecord(value.images)) {
    throw new NirvanaEastAssetProfileError(
      "Nirvana East requires atlas schema 2 with 32px tiles and image metadata.",
    );
  }
  assertCornerBits(value.cornerBits);
  const images = Object.freeze({
    terrain: parseImageRecord(value.images.terrain, "terrain", TERRAIN_IMAGE),
    scenery: parseImageRecord(value.images.scenery, "scenery", SCENERY_IMAGE),
  });
  const frames: Record<string, NirvanaEastAtlasFrameRecord> = {};
  for (const frame of [
    ...parseTerrainGrid(value.terrainGrid, images.terrain),
    ...parseSceneryFrames(value.sceneryFrames, images.scenery),
  ]) {
    if (frames[frame.id] !== undefined) {
      throw new NirvanaEastAssetProfileError(
        `Nirvana East atlas contains duplicate frame ${frame.id}.`,
      );
    }
    frames[frame.id] = frame;
  }
  if (Object.keys(frames).length !== EXPECTED_FRAME_COUNT) {
    throw new NirvanaEastAssetProfileError(
      `Nirvana East atlas must publish exactly ${EXPECTED_FRAME_COUNT} frames.`,
    );
  }
  const frozenFrames = Object.freeze(frames);
  assertLandformPivotsAgree(frozenFrames);
  return Object.freeze({
    images,
    frames: frozenFrames,
    materials: requiredStringList(value.materials, "materials"),
    blockingMaterials: requiredStringList(value.blockingMaterials, "blockingMaterials"),
    shoreMaterials: requiredStringList(value.shoreMaterials, "shoreMaterials"),
  });
}

function atlasDescriptor(
  id: typeof TERRAIN_ATLAS_ID | typeof SCENERY_ATLAS_ID,
  url: URL,
  image: NirvanaEastAtlasImageRecord,
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

export const NIRVANA_EAST_ATLAS_PROFILE: NirvanaEastAtlasProfile = Object.freeze({
  regionId: NIRVANA_EAST_REGION_ID,
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
 * Add the exact Nirvana East atlas descriptors without changing biome-pack ownership.
 *
 * Enforces the shared active-atlas ceiling the same way `createWarmSpringsProductionManifest`
 * does: the `dry-scrub` kit's own active bytes plus this profile's two sheets must stay
 * inside `budgets.activeCompressedMax`.
 *
 * @param base - The manifest to extend; not mutated.
 * @returns A new frozen manifest carrying the two exact atlas descriptors.
 * @throws {NirvanaEastAssetProfileError} On budget overrun or an atlas-id collision.
 */
export function createNirvanaEastProductionManifest(
  base: ProductionAssetManifest,
): ProductionAssetManifest {
  const projectedActiveBytes = base.budgets.activeCompressedBytes[REQUIRED_KIT]
    + NIRVANA_EAST_ATLAS_PROFILE.compressedBytes;
  if (!Number.isSafeInteger(projectedActiveBytes)
    || projectedActiveBytes > base.budgets.activeCompressedMax) {
    throw new NirvanaEastAssetProfileError(
      `Nirvana East active compressed budget exceeded: ${projectedActiveBytes} > ${base.budgets.activeCompressedMax}.`,
    );
  }
  const atlases = { ...base.atlases };
  for (const descriptor of NIRVANA_EAST_ATLAS_PROFILE.descriptors) {
    const existing = atlases[descriptor.id];
    if (existing !== undefined && existing !== descriptor) {
      throw new NirvanaEastAssetProfileError(
        `Nirvana East atlas ID ${descriptor.id} is already owned by another descriptor.`,
      );
    }
    atlases[descriptor.id] = descriptor;
  }
  return Object.freeze({
    ...base,
    atlases: Object.freeze(atlases),
  });
}
