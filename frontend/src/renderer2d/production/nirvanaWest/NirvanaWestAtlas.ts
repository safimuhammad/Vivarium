/**
 * @fileoverview Frame-id vocabulary and lease binding for the `nirvana-west-v1` atlas.
 *
 * Four id families, exactly as the art authoring script emits them (mirrors
 * `warmSprings/WarmSpringsAtlas.ts` and `nirvanaEast/NirvanaEastAtlas.ts`):
 *
 * - `t.<material>.<variant>` — a full-tile base fill (8 variants per field material;
 *   `causeway` publishes none and is carried purely as a scenery species instead)
 * - `e.<material>.<mask>.<variant>` — a corner-masked transition laid over the fill
 *   (masks 1..14; mask 15 is total coverage and is served by the base fill instead)
 * - `w.<material>.<mask>.<variant>` — the rim line along a bank material
 *   (`cinder` / `ashpale` / `clinker`) that meets the void family
 *   (`ember` / `emberdim`); shares its mask and variant with the edge transition
 *   deliberately, so the rim line follows exactly the contour the bank edge was cut
 *   with rather than a second, similar curve
 *
 * plus `s.<species>.<variant>` scenery sprites: ashpile, ashripple, bonestone,
 * causeway, clinkerchunk, coolingtower, deadbrush, dunecrest, ejecta, emberwisp,
 * fence, gantry, glassshard, pipeline, powerhall, pylon, railspur, reactorhusk,
 * slabtilt, slagrock, snag, snagfallen, snagtall, stack, stump, tailings, tankfarm —
 * 27 species (`slab`/`apron`/`spill`/`rimecluster` were retired at the composition-B
 * republish; see `NirvanaWestAssetProfile.ts`'s module docstring). Every scenery frame
 * additionally carries a measured ground-contact rect
 * (`NirvanaWestAtlasSceneryFrameRecord.contact`); `nirvanaWestFrameHasFootprint` below
 * is the fail-safe way to read it.
 *
 * This module owns no dependency on a Nirvana West materials module (none exists
 * within this task's scope), so the frame-id builders below take the pinned
 * `NirvanaWestMaterial` union from `./NirvanaWestAssetProfile` directly, exactly as
 * `WarmSpringsAtlas.ts` takes `WarmSpringsMaterial` from its own profile-adjacent
 * source of truth.
 */

import {
  NIRVANA_WEST_ATLAS_PROFILE,
  type NirvanaWestAtlasFrameRecord,
  type NirvanaWestAtlasSceneryFrameRecord,
  type NirvanaWestMaterial,
} from "./NirvanaWestAssetProfile";

export type NirvanaWestAtlasFrame = NirvanaWestAtlasFrameRecord;

/** The published scenery species vocabulary, in authoring order. */
export const NIRVANA_WEST_SCENERY_SPECIES = Object.freeze([
  "snag",
  "snagtall",
  "snagfallen",
  "stump",
  "slagrock",
  "ashpile",
  "bonestone",
  "ejecta",
  "clinkerchunk",
  "deadbrush",
  "ashripple",
  "glassshard",
  "emberwisp",
  "pylon",
  "slabtilt",
  "dunecrest",
  "causeway",
  "coolingtower",
  "reactorhusk",
  "gantry",
  "stack",
  "powerhall",
  "tankfarm",
  "pipeline",
  "fence",
  "railspur",
  "tailings",
] as const);

export type NirvanaWestScenerySpecies = (typeof NIRVANA_WEST_SCENERY_SPECIES)[number];

export class NirvanaWestAtlasError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NirvanaWestAtlasError";
  }
}

/** The two decoded sheets plus the frame table they are addressed through. */
export interface NirvanaWestAtlasAssets {
  readonly terrain: CanvasImageSource;
  readonly scenery: CanvasImageSource;
  readonly frames: ReadonlyMap<string, NirvanaWestAtlasFrame>;
}

/** Atlas frame id for a full-tile fill of one material: `t.<material>.<variant>`. */
export function nirvanaWestBaseFrameId(material: NirvanaWestMaterial, variant: number): string {
  return `t.${material}.${variant}`;
}

/**
 * Atlas frame id for a corner-masked transition: `e.<material>.<mask>.<variant>`.
 *
 * Mask 15 is total coverage and is served by the base fill instead — the authoring
 * script draws no `e.*.15.*` cell, so asking for one is a missing-frame crash.
 */
export function nirvanaWestEdgeFrameId(
  material: NirvanaWestMaterial,
  mask: number,
  variant: number,
): string {
  return `e.${material}.${mask}.${variant}`;
}

/**
 * Atlas frame id for a rim line along a bank material that meets the void family:
 * `w.<material>.<mask>.<variant>`.
 *
 * Shares the transition's mask and variant deliberately: the authoring script derives
 * both from the same seed, so the rim line follows exactly the contour the bank edge
 * was cut with rather than a second, similar curve.
 */
export function nirvanaWestRimFrameId(
  material: NirvanaWestMaterial,
  mask: number,
  variant: number,
): string {
  return `w.${material}.${mask}.${variant}`;
}

/** Atlas frame id for one scenery sprite: `s.<species>.<variant>`. */
export function nirvanaWestSceneryFrameId(
  species: NirvanaWestScenerySpecies,
  variant: number,
): string {
  return `s.${species}.${variant}`;
}

/**
 * True when a resolved frame's measured contact footprint has nonzero area.
 *
 * Terrain frames never have a footprint of their own (a full tile IS the ground) and
 * always report `false`. A scenery frame's zero-area contact rect
 * (`{x:0, y:0, width:0, height:0}`) means the sprite is a flat decal or ground
 * marking with no wall at all — callers MUST treat that as "no footprint" via this
 * function rather than reaching into `.contact` and querying a phantom collision box.
 */
export function nirvanaWestFrameHasFootprint(frame: NirvanaWestAtlasFrame): boolean {
  return frame.image === "scenery" && frame.contact.width > 0 && frame.contact.height > 0;
}

/**
 * Bind two decoded atlas sheets to the published frame table.
 *
 * @param terrain - The decoded `terrain.png` lease value.
 * @param scenery - The decoded `scenery.png` lease value.
 * @returns Frozen assets whose `frames` map is the profile's own table.
 */
export function createNirvanaWestAtlasAssets(
  terrain: CanvasImageSource,
  scenery: CanvasImageSource,
): NirvanaWestAtlasAssets {
  const frames = new Map<string, NirvanaWestAtlasFrame>(
    Object.entries(NIRVANA_WEST_ATLAS_PROFILE.frames),
  );
  return Object.freeze({ terrain, scenery, frames });
}

/** Look up one frame, failing loudly rather than drawing nothing. */
export function requireNirvanaWestFrame(
  assets: NirvanaWestAtlasAssets,
  id: string,
): NirvanaWestAtlasFrame {
  const frame = assets.frames.get(id);
  if (frame === undefined) {
    throw new NirvanaWestAtlasError(`Nirvana West atlas frame is missing: ${id}.`);
  }
  return frame;
}

/** Look up one scenery frame specifically, failing loudly on a missing or wrong-image id. */
export function requireNirvanaWestSceneryFrame(
  assets: NirvanaWestAtlasAssets,
  id: string,
): NirvanaWestAtlasSceneryFrameRecord {
  const frame = requireNirvanaWestFrame(assets, id);
  if (frame.image !== "scenery") {
    throw new NirvanaWestAtlasError(`Nirvana West atlas frame ${id} is not a scenery frame.`);
  }
  return frame;
}
