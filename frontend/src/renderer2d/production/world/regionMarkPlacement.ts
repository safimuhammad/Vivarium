/**
 * @fileoverview Deterministic placement + color for the small being marks Task Z3 draws over a
 * non-focused region's cached snapshot (`docs/superpowers/specs/2026-07-24-world-sheet-camera-design.md`
 * S3.3: "beings drawn as small palette-coloured marks so population and movement read at a
 * glance").
 *
 * **Why this is a hash scatter, not "the being's real position":** no layer of this codebase --
 * client or backend -- has a continuous (x, y) for a being. The backend `AgentSnapshot` carries
 * only `position: string`, a region id (`frontend/src/app/schemas.ts`); the *only* concept of a
 * pixel position anywhere in the 2D presentation is `PlacementLedger`'s client-invented,
 * tile-legality-aware placement for the one currently-observed/live region, which does not exist
 * for a region nobody is currently rendering live. So a mark's pixel position within its region
 * is, and can only be, an invented rendering convenience -- exactly like the live region's own
 * placement already is, just far cheaper (a hash, not a legal-tile search), because a decorative
 * "how many/roughly where" dot at world zoom does not need to resolve walkability. What IS real,
 * carried straight from the frame, is which region a being is currently in and which being ids
 * exist there (see Z3's step-1 finding in `.superpowers/sdd/z3-report.md`) -- this module never
 * invents an agent's existence or region assignment, only where its dot sits inside that region's
 * rect.
 *
 * Both functions are pure and imports-free of rendering/canvas/frame types (only
 * `BeingPaletteVariant`, itself a plain string union, is imported for the color table's keys).
 */

import { BEING_PALETTE_VARIANTS, type BeingPaletteVariant } from "../actors/beingPalette";

export interface MarkRect {
  readonly width: number;
  readonly height: number;
}

export interface MarkPoint {
  readonly x: number;
  readonly y: number;
}

/** Half-width of a drawn mark, in pixels -- also the minimum margin kept from a region's edges
 * so a mark is never clipped by its own region's rect (or the gutter beyond it). */
export const MARK_RADIUS_PX = 4;

/** FNV-1a, the same technique `beingPalette.ts`'s private `stableHash` uses, duplicated here
 * (rather than imported) to keep this module's own dependency surface minimal and independent. */
function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/**
 * Deterministically scatters one being's mark to a stable point inside `rect`, keeping at least
 * {@link MARK_RADIUS_PX} clear on every side so the mark never draws outside its region's plot.
 *
 * @param agentId - The being's stable id; the only input to the scatter (same id -> same point,
 *   always, across frames and sessions).
 * @param rect - The region's own local pixel size (its sheet rect's `width`/`height`).
 * @returns A point within `[MARK_RADIUS_PX, width - MARK_RADIUS_PX]` x
 *   `[MARK_RADIUS_PX, height - MARK_RADIUS_PX]`, or the rect's centre if it is too small to hold
 *   that margin on an axis.
 * @throws {RangeError} If `rect.width` or `rect.height` is not finite and positive.
 */
export function markScatterPoint(agentId: string, rect: MarkRect): MarkPoint {
  if (!Number.isFinite(rect.width) || rect.width <= 0
    || !Number.isFinite(rect.height) || rect.height <= 0) {
    throw new RangeError(
      `markScatterPoint: rect must have finite positive width/height, got ${JSON.stringify(rect)}.`,
    );
  }
  const hash = stableHash(agentId);
  // Split the hash into two independent axes via distinct bit windows so x and y don't move in
  // lockstep for ids that happen to share low bits.
  const xUnit = (hash & 0xffff) / 0xffff;
  const yUnit = ((hash >>> 16) & 0xffff) / 0xffff;
  const usableWidth = rect.width - 2 * MARK_RADIUS_PX;
  const usableHeight = rect.height - 2 * MARK_RADIUS_PX;
  if (usableWidth <= 0 || usableHeight <= 0) {
    return { x: rect.width / 2, y: rect.height / 2 };
  }
  return {
    x: MARK_RADIUS_PX + xUnit * usableWidth,
    y: MARK_RADIUS_PX + yUnit * usableHeight,
  };
}

/**
 * Marker colors per {@link BeingPaletteVariant}, chosen to read as the same family the variant's
 * actual garment recolor occupies (see `beingPalette.ts`'s `VARIANT_HUE_SATURATION_TARGETS`) but
 * saturated/lightened for legibility as a tiny 8px dot at world zoom, where a muted garment tone
 * would wash out against terrain. Kept as a small hand-picked table (independent of
 * `beingPalette.ts`'s pixel-remap machinery, which exists to recolor a sprite sheet, not to
 * produce a single solid marker swatch) rather than deriving a fourth representation of the same
 * five colors.
 */
export const BEING_MARK_COLOR_BY_VARIANT: Readonly<Record<BeingPaletteVariant, string>> = Object.freeze({
  "slate-blue": "#5b7fd6",
  "violet-grey": "#9a6bc4",
  moss: "#5f9e52",
  ochre: "#d68a2e",
  bone: "#d9cdb0",
});

/**
 * Resolves the marker color for one {@link BeingPaletteVariant}.
 *
 * @param variant - A being's resolved palette variant (`resolveBeingPaletteVariant`).
 * @returns The variant's marker color as a `#rrggbb` CSS hex string.
 * @throws {Error} If `variant` is not a known {@link BeingPaletteVariant}.
 */
export function beingMarkColor(variant: BeingPaletteVariant): string {
  if (!(BEING_PALETTE_VARIANTS as readonly string[]).includes(variant)) {
    throw new Error(`beingMarkColor: "${variant}" is not a known BeingPaletteVariant.`);
  }
  return BEING_MARK_COLOR_BY_VARIANT[variant];
}
