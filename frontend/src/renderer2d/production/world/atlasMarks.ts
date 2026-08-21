/**
 * @fileoverview What lives on the atlas -- homes, ruins, beings and event pulses -- resolved to
 * placed draw commands (design of record: `docs/frontend/ATLAS_VIEW.md` §5).
 *
 * Every mark on the map comes from real world state: a hut means someone built here, broken stones
 * mean something fell here, a tick in a being's own resolved palette is a life (and whose), a
 * dimmed tick is still alive but not well, and an expanding ring means *this is happening now*.
 *
 * This module is pure placement: it turns "these homes/ruins/beings/pulses are in this region"
 * into "draw these marks at these sheet coordinates", scattering them deterministically over the
 * island's own LAND (never into the sea) via `islandMask.ts`'s `islandLandPoints`. It owns no
 * colours beyond the event-pulse hues and no canvas at all, so `CanvasPresentationRenderer` stays
 * free of mark trivia.
 */

import { islandLandPoints, type IslandMask, type IslandPoint } from "./islandMask";

/** A home standing in a region. */
export interface AtlasHomeInput {
  readonly id: string;
  readonly regionId: string;
  /** `0..1`; below `0.7` the roof reads as weathered. */
  readonly integrity: number;
}

/** A ruin left in a region. */
export interface AtlasRuinInput {
  readonly id: string;
  readonly regionId: string;
}

/** A living (or paralyzed) being, with the colour its own appearance chain resolved to. */
export interface AtlasBeingInput {
  readonly id: string;
  readonly regionId: string;
  readonly color: string;
  /** `false` for a paralyzed being -- still alive, not well. */
  readonly well: boolean;
}

/** An event beat currently playing out in a region. */
export interface AtlasPulseInput {
  readonly regionId: string;
  readonly kind: string;
  /** `0` at the instant the event fired, `1` when the pulse has fully expanded and faded. */
  readonly age: number;
}

/** A placed hut: someone built here. */
export interface AtlasHomeMark extends IslandPoint {
  readonly kind: "home";
  readonly intact: boolean;
}

/** A placed ruin: something fell here. */
export interface AtlasRuinMark extends IslandPoint {
  readonly kind: "ruin";
}

/** A placed life. */
export interface AtlasBeingMark extends IslandPoint {
  readonly kind: "being";
  readonly color: string;
  readonly well: boolean;
}

/** A placed event beat. */
export interface AtlasPulseMark extends IslandPoint {
  readonly kind: "pulse";
  /** `"r,g,b"`, ready to interpolate into an `rgba()` string. */
  readonly rgb: string;
  readonly age: number;
}

export type AtlasMark = AtlasHomeMark | AtlasRuinMark | AtlasBeingMark | AtlasPulseMark;

/** Event-beat hues: gold birth/build, white speech, red combat, cold blue death. */
const PULSE_RGB: Readonly<Record<string, string>> = Object.freeze({
  birth: "255,214,120",
  build: "255,196,110",
  speech: "236,244,238",
  death: "126,178,214",
  combat: "230,110,86",
  gather: "198,222,150",
  move: "196,214,224",
});

/** The hue an unrecognised event kind pulses in. */
const PULSE_RGB_DEFAULT = "236,244,238";

/** How far inland each mark kind is kept, in mask cells, so nothing is ever scattered onto a
 * beach it could not stand on. */
const INLAND_HOME = 5;
const INLAND_RUIN = 5;
const INLAND_BEING = 4;
const INLAND_PULSE = 16;

/** One region's island, positioned on the sheet. */
export interface AtlasIslandRef {
  readonly regionId: string;
  readonly mask: IslandMask;
  /** The plot's top-left corner in shared sheet space. */
  readonly originX: number;
  readonly originY: number;
}

/**
 * Places every mark on its own island.
 *
 * @param islands - The islands currently on the sheet, keyed by region id.
 * @param input - The world's homes, ruins, beings and live event beats.
 * @returns Placed marks in a stable draw order (homes, then ruins, then beings, then pulses), each
 *   in shared sheet coordinates. Marks whose region has no island, or whose island has no cell
 *   deep enough inland, are dropped rather than faked onto the sea.
 */
export function placeAtlasMarks(
  islands: ReadonlyMap<string, AtlasIslandRef>,
  input: Readonly<{
    homes: readonly AtlasHomeInput[];
    ruins: readonly AtlasRuinInput[];
    beings: readonly AtlasBeingInput[];
    pulses: readonly AtlasPulseInput[];
  }>,
): readonly AtlasMark[] {
  const marks: AtlasMark[] = [];
  const place = (
    regionId: string,
    seed: string,
    inland: number,
  ): IslandPoint | null => {
    const island = islands.get(regionId);
    if (island === undefined) return null;
    const [point] = islandLandPoints(island.mask, seed, 1, inland);
    if (point === undefined) return null;
    return { x: island.originX + point.x, y: island.originY + point.y };
  };

  for (const home of input.homes) {
    const point = place(home.regionId, `home:${home.id}`, INLAND_HOME);
    if (point === null) continue;
    marks.push({ kind: "home", x: point.x, y: point.y, intact: home.integrity > 0.7 });
  }
  for (const ruin of input.ruins) {
    const point = place(ruin.regionId, `ruin:${ruin.id}`, INLAND_RUIN);
    if (point === null) continue;
    marks.push({ kind: "ruin", x: point.x, y: point.y });
  }
  for (const being of input.beings) {
    const point = place(being.regionId, `being:${being.id}`, INLAND_BEING);
    if (point === null) continue;
    marks.push({ kind: "being", x: point.x, y: point.y, color: being.color, well: being.well });
  }
  for (const pulse of input.pulses) {
    const point = place(pulse.regionId, `pulse:${pulse.regionId}:${pulse.kind}`, INLAND_PULSE);
    if (point === null) continue;
    marks.push({
      kind: "pulse",
      x: point.x,
      y: point.y,
      rgb: PULSE_RGB[pulse.kind] ?? PULSE_RGB_DEFAULT,
      age: Math.max(0, Math.min(1, pulse.age)),
    });
  }
  return marks;
}
