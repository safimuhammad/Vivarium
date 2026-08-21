/**
 * @fileoverview Frame-id vocabulary and lease binding for the `nirvana-east-v1` atlas.
 *
 * Three id families, exactly as the art authoring script emits them (mirrors
 * `warmSprings/WarmSpringsAtlas.ts`):
 *
 * - `t.<material>.<variant>` — a full-tile base fill (8 variants per field material)
 * - `e.<material>.<mask>.<variant>` — a corner-masked transition laid over the fill
 * - `w.<material>.<mask>.<variant>` — the wet line along a bank that meets brine
 *
 * plus `s.<species>.<variant>` scenery sprites — bones, boulder, bunchgrass, butte,
 * cracks, deadwood, dustdevil, hoodoo, mesa, mesquite, outcrop, pebbles, plank,
 * saltbush, saltrime, thornbush. The transition mask shares its variant with the wet
 * line deliberately, for the same reason Warm Springs' does: the authoring script
 * derives both from one seed, so the wet line follows exactly the contour the bank edge
 * was cut with rather than a second, similar curve.
 *
 * The frame-id BUILDERS themselves (`nirvanaEastBaseFrameId` / `nirvanaEastEdgeFrameId` /
 * `nirvanaEastShoreFrameId`) live in `./NirvanaEastMaterials` — this module re-exports
 * them so callers only need one import surface (`./NirvanaEastAtlas`) for both the frame
 * vocabulary and the lease binding, exactly as `WarmSpringsAtlas.ts` does for its own
 * material module.
 */

import {
  NIRVANA_EAST_ATLAS_PROFILE,
  type NirvanaEastAtlasFrameRecord,
} from "./NirvanaEastAssetProfile";
import {
  nirvanaEastBaseFrameId,
  nirvanaEastEdgeFrameId,
  nirvanaEastShoreFrameId,
} from "./NirvanaEastMaterials";

export { nirvanaEastBaseFrameId, nirvanaEastEdgeFrameId, nirvanaEastShoreFrameId };

export type NirvanaEastAtlasFrame = NirvanaEastAtlasFrameRecord;

export class NirvanaEastAtlasError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NirvanaEastAtlasError";
  }
}

/** The two decoded sheets plus the frame table they are addressed through. */
export interface NirvanaEastAtlasAssets {
  readonly terrain: CanvasImageSource;
  readonly scenery: CanvasImageSource;
  readonly frames: ReadonlyMap<string, NirvanaEastAtlasFrame>;
}

/**
 * Bind two decoded atlas sheets to the published frame table.
 *
 * @param terrainImage - The decoded `terrain.png` lease value.
 * @param sceneryImage - The decoded `scenery.png` lease value.
 * @returns Frozen assets whose `frames` map is the profile's own table.
 */
export function createNirvanaEastAtlasAssets(
  terrainImage: CanvasImageSource,
  sceneryImage: CanvasImageSource,
): NirvanaEastAtlasAssets {
  const frames = new Map<string, NirvanaEastAtlasFrame>(
    Object.entries(NIRVANA_EAST_ATLAS_PROFILE.frames),
  );
  return Object.freeze({ terrain: terrainImage, scenery: sceneryImage, frames });
}

/** Look up one frame, failing loudly rather than drawing nothing. */
export function requireNirvanaEastFrame(
  assets: NirvanaEastAtlasAssets,
  id: string,
): NirvanaEastAtlasFrame {
  const frame = assets.frames.get(id);
  if (frame === undefined) {
    throw new NirvanaEastAtlasError(`Nirvana East atlas frame is missing: ${id}.`);
  }
  return frame;
}
