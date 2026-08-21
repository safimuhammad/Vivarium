/**
 * @fileoverview Frame-id vocabulary and lease binding for the `warm-springs-v1` atlas.
 *
 * Three id families, exactly as the art authoring script emits them:
 *
 * - `t.<material>.<variant>` — a full-tile base fill (8 variants per material)
 * - `e.<material>.<mask>.<variant>` — a corner-masked transition laid over the fill
 * - `w.<material>.<mask>.<variant>` — the wet line along a bank that meets a pool
 *
 * plus `s.<species>.<variant>` scenery sprites. The transition mask shares its variant
 * with the wet line deliberately: the authoring script derives both from one seed, so the
 * wet line follows exactly the contour the bank edge was cut with rather than a second,
 * similar curve. That is the single most beautiful detail in the region and it only works
 * because the two ids agree.
 */

import {
  WARM_SPRINGS_ATLAS_PROFILE,
  type WarmSpringsAtlasFrameRecord,
} from "./WarmSpringsAssetProfile";
import type { WarmSpringsMaterial } from "./WarmSpringsMaterials";

export type WarmSpringsAtlasFrame = WarmSpringsAtlasFrameRecord;

export class WarmSpringsAtlasError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WarmSpringsAtlasError";
  }
}

/** The two decoded sheets plus the frame table they are addressed through. */
export interface WarmSpringsAtlasAssets {
  readonly terrain: CanvasImageSource;
  readonly scenery: CanvasImageSource;
  readonly frames: ReadonlyMap<string, WarmSpringsAtlasFrame>;
}

/** Atlas frame id for a full-tile fill of one material. */
export function warmSpringsBaseFrameId(material: WarmSpringsMaterial, variant: number): string {
  return `t.${material}.${variant}`;
}

/**
 * Atlas frame id for a corner-masked transition.
 *
 * Mask 15 is total coverage and is served by the base fill instead — the authoring
 * script draws no `e.*.15.*` cell, so asking for one is a missing-frame crash.
 */
export function warmSpringsEdgeFrameId(
  material: WarmSpringsMaterial,
  mask: number,
  variant: number,
): string {
  return `e.${material}.${mask}.${variant}`;
}

/** Atlas frame id for a shoreline / wet-line band along a bank material. */
export function warmSpringsShoreFrameId(
  material: WarmSpringsMaterial,
  mask: number,
  variant: number,
): string {
  return `w.${material}.${mask}.${variant}`;
}

/**
 * Bind two decoded atlas sheets to the published frame table.
 *
 * @param terrain - The decoded `terrain.png` lease value.
 * @param scenery - The decoded `scenery.png` lease value.
 * @returns Frozen assets whose `frames` map is the profile's own table.
 */
export function createWarmSpringsAtlasAssets(
  terrain: CanvasImageSource,
  scenery: CanvasImageSource,
): WarmSpringsAtlasAssets {
  const frames = new Map<string, WarmSpringsAtlasFrame>(
    Object.entries(WARM_SPRINGS_ATLAS_PROFILE.frames),
  );
  return Object.freeze({ terrain, scenery, frames });
}

/** Look up one frame, failing loudly rather than drawing nothing. */
export function requireWarmSpringsFrame(
  assets: WarmSpringsAtlasAssets,
  id: string,
): WarmSpringsAtlasFrame {
  const frame = assets.frames.get(id);
  if (frame === undefined) {
    throw new WarmSpringsAtlasError(`Warm Springs atlas frame is missing: ${id}.`);
  }
  return frame;
}
