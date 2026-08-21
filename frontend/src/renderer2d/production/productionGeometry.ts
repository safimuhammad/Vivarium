/** Shared measured pixel geometry for deterministic production-world placement. */

import type { Rect, Vec2 } from "../contracts";
import { TILE_SIZE, tileCenter, type TileCoord } from "../map/regionMap";
import { BEING_CHIBI_GEOMETRY } from "./actors/beingChibiAtlas";

/** Canvas destination occupied by every standing-home and ruin frame. */
export const SHELTER_RENDER_FOOTPRINT = Object.freeze({ width: 128, height: 128 } as const);

/** Door point bounds relative to the shelter render origin. */
export const SHELTER_DOOR_CLEARANCE = Object.freeze({
  x: 49,
  y: 57,
  width: 30,
  height: 48,
} as const);

export interface FeetRelativeVisualEnvelope {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

interface PersistedFeetRelativeEnvelope {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

function measuredEnvelope(
  value: PersistedFeetRelativeEnvelope,
  label: string,
): FeetRelativeVisualEnvelope {
  const coordinates = [value.left, value.top, value.right, value.bottom];
  if (!coordinates.every(Number.isInteger)
    || value.right <= value.left || value.bottom <= value.top) {
    throw new Error(`Production ${label} visual envelope metadata is invalid.`);
  }
  return Object.freeze({
    ...value,
    width: value.right - value.left,
    height: value.bottom - value.top,
  });
}

/**
 * The `core-being-chibi` sprite's whole-frame footprint, feet-relative.
 *
 * `SpriteSheetHumanActor` blits one entire frame per draw, feet-anchored
 * within it, so the envelope is simply that frame's bounds translated to be
 * relative to the feet anchor: `left = -feet.x`, `top = -feet.y`,
 * `right = frameWidth - feet.x`, `bottom = frameHeight - feet.y`. Derived
 * directly from `beingChibiAtlas.ts`'s `BEING_CHIBI_GEOMETRY` — the packed
 * atlas's own validated source of truth (currently 22x48, feet (11,46)) —
 * rather than a second hand-copied literal, so a future re-pack that moves
 * the frame size or feet anchor can't silently desync this envelope from
 * the atlas it describes. Unlike the retired `LayeredHumanActor`'s
 * alpha-measured, tighter-than-frame composite (which additionally grew
 * wider for held-item overlays), the chibi atlas has no held-item frames,
 * so there is exactly one envelope, reused for both exports below.
 */
const BEING_CHIBI_FEET_RELATIVE_FRAME: PersistedFeetRelativeEnvelope = Object.freeze({
  left: -BEING_CHIBI_GEOMETRY.feet.x,
  top: -BEING_CHIBI_GEOMETRY.feet.y,
  right: BEING_CHIBI_GEOMETRY.frameWidth - BEING_CHIBI_GEOMETRY.feet.x,
  bottom: BEING_CHIBI_GEOMETRY.frameHeight - BEING_CHIBI_GEOMETRY.feet.y,
});

/** Alpha union of every legal idle layer before held-item overlays. */
export const IDLE_HUMAN_VISUAL_ENVELOPE = measuredEnvelope(
  BEING_CHIBI_FEET_RELATIVE_FRAME,
  "idle human",
);

/** Alpha union of every legal idle layer and every held overlay, relative to feet. */
export const STANDING_HUMAN_VISUAL_ENVELOPE = measuredEnvelope(
  BEING_CHIBI_FEET_RELATIVE_FRAME,
  "standing human",
);

/** Project the complete standing-human alpha envelope from a feet point. */
export function feetAnchoredVisualRect(feet: Vec2): Rect {
  return {
    x: feet.x + STANDING_HUMAN_VISUAL_ENVELOPE.left,
    y: feet.y + STANDING_HUMAN_VISUAL_ENVELOPE.top,
    width: STANDING_HUMAN_VISUAL_ENVELOPE.width,
    height: STANDING_HUMAN_VISUAL_ENVELOPE.height,
  };
}

/** Project the full 128px shelter frame from its authored origin tile. */
export function shelterRenderRect(tile: TileCoord): Rect {
  const origin = tileCenter(tile);
  return {
    x: origin.x,
    y: origin.y,
    width: SHELTER_RENDER_FOOTPRINT.width,
    height: SHELTER_RENDER_FOOTPRINT.height,
  };
}

/** Return the exact navigation tile containing an integer-pixel feet point. */
export function navigationTileForFeet(feet: Vec2): TileCoord {
  return {
    column: Math.floor(feet.x / TILE_SIZE),
    row: Math.floor(feet.y / TILE_SIZE),
  };
}

/** True only when two half-open renderer rectangles share visible pixels. */
export function productionRectsOverlap(left: Rect, right: Rect): boolean {
  return left.x < right.x + right.width && left.x + left.width > right.x
    && left.y < right.y + right.height && left.y + left.height > right.y;
}

/**
 * True when a being's complete standing envelope, anchored at `point`, clears
 * every exclusion rect.
 *
 * Lives here (a leaf geometry module with no renderer/canvas dependencies)
 * rather than in `ProductionSceneGraph.ts` so that CHOREOGRAPHY can ask the
 * exact same question the renderer's apply-time gate asks before it authors a
 * route. Two different answers to "may a body stand here" is what silently
 * froze every interaction beat: choreography authored a contact route the
 * renderer then dropped without a diagnostic.
 *
 * **OBJECTS ONLY.** `exclusions` means home footprints and tall scenic
 * landmarks — things a body would visibly overlap. GROUND terrain (water,
 * cliff, thicket, a bridge deck) must NEVER be supplied here: the envelope is
 * anchored 46px above the feet, so a full-tile terrain rect rejects every
 * walkable tile with blocked ground to its north — 18% of the river-valley
 * pilot's walkable tiles, the entire south bank, and every east–west bridge.
 * Ground belongs on `grid.collision`; see `navigation/groundTerrain.ts`.
 */
export function presentationPointIsClear(point: Vec2, exclusions: readonly Rect[]): boolean {
  const envelope = feetAnchoredVisualRect(point);
  return exclusions.every((zone) => !productionRectsOverlap(envelope, zone));
}

/**
 * True when the complete standing-human envelope clears every cardinal route
 * segment.
 *
 * OBJECTS ONLY, for the reason spelled out on
 * {@link presentationPointIsClear}. The scene graph pairs this with a
 * destination-tile collision check for ground terrain.
 */
export function presentationRouteIsClear(
  start: Vec2,
  waypoints: readonly Vec2[],
  exclusions: readonly Rect[],
): boolean {
  if (!presentationPointIsClear(start, exclusions)) return false;
  let prior = start;
  for (const waypoint of waypoints) {
    const from = feetAnchoredVisualRect(prior);
    const to = feetAnchoredVisualRect(waypoint);
    const x = Math.min(from.x, to.x);
    const y = Math.min(from.y, to.y);
    const swept = {
      x,
      y,
      width: Math.max(from.x + from.width, to.x + to.width) - x,
      height: Math.max(from.y + from.height, to.y + to.height) - y,
    };
    if (exclusions.some((zone) => productionRectsOverlap(swept, zone))) return false;
    prior = waypoint;
  }
  return true;
}

/**
 * Decompose `outer` into up to 4 non-overlapping axis-aligned bands (top,
 * bottom, left, right) that together cover exactly `outer` minus `hole`.
 *
 * `hole` must lie fully within `outer` (true for every caller in this
 * module: a home's door clearance is authored well inside its 128x128
 * render rect). A zero-area hole returns `outer` unchanged. This is the
 * shared "cross subtraction" used to carve a walkable door threshold out of
 * an otherwise fully excluded structure footprint -- see
 * {@link homeFootprintExclusionRects}.
 */
export function subtractRect(outer: Rect, hole: Rect): readonly Rect[] {
  if (hole.width <= 0 || hole.height <= 0) return [outer];
  const bands: Rect[] = [];
  const holeTop = hole.y;
  const holeBottom = hole.y + hole.height;
  const holeLeft = hole.x;
  const holeRight = hole.x + hole.width;
  const outerBottom = outer.y + outer.height;
  const outerRight = outer.x + outer.width;
  if (holeTop > outer.y) {
    bands.push({ x: outer.x, y: outer.y, width: outer.width, height: holeTop - outer.y });
  }
  if (holeBottom < outerBottom) {
    bands.push({ x: outer.x, y: holeBottom, width: outer.width, height: outerBottom - holeBottom });
  }
  if (holeLeft > outer.x) {
    bands.push({ x: outer.x, y: holeTop, width: holeLeft - outer.x, height: holeBottom - holeTop });
  }
  if (holeRight < outerRight) {
    bands.push({ x: holeRight, y: holeTop, width: outerRight - holeRight, height: holeBottom - holeTop });
  }
  return bands;
}

/**
 * Small buffer (px) added beyond a home's rendered 128x128 footprint when
 * excluding it from ordinary agent standing/routing -- so a walking being
 * reads as clearly *beside* the structure rather than grazing its wall.
 * Deliberately smaller than half a tile (`TILE_SIZE / 2 = 16`) so it never
 * meaningfully narrows a region's walkable space between two homes.
 */
export const HOME_FOOTPRINT_EXCLUSION_MARGIN_PX = 6;

/**
 * The spatial-truth exclusion geometry for one home: its rendered footprint,
 * expanded by {@link HOME_FOOTPRINT_EXCLUSION_MARGIN_PX}, with its door
 * threshold ({@link SHELTER_DOOR_CLEARANCE}) carved back out.
 *
 * Ordinary agent placement/movement must clear every returned rect (nobody
 * stands on or paths through the walls/roof), but the door threshold stays
 * open -- every home-interaction choreography beat (hearth, build, loot,
 * join/leave, ...) deliberately routes its actor to stand exactly at the
 * door, which is authored well inside the raw footprint. Excluding the door
 * too would make every one of those beats illegal.
 */
export function homeFootprintExclusionRects(
  plot: Vec2,
  marginPx: number = HOME_FOOTPRINT_EXCLUSION_MARGIN_PX,
): readonly Rect[] {
  const outer: Rect = {
    x: plot.x - marginPx,
    y: plot.y - marginPx,
    width: SHELTER_RENDER_FOOTPRINT.width + marginPx * 2,
    height: SHELTER_RENDER_FOOTPRINT.height + marginPx * 2,
  };
  const door: Rect = {
    x: plot.x + SHELTER_DOOR_CLEARANCE.x,
    y: plot.y + SHELTER_DOOR_CLEARANCE.y,
    width: SHELTER_DOOR_CLEARANCE.width,
    height: SHELTER_DOOR_CLEARANCE.height,
  };
  return subtractRect(outer, door);
}
