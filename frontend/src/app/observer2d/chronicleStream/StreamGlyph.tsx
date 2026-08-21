/**
 * The DOM-scale glyph sheet the killfeed cards share with the world overlay.
 *
 * These are the DOM-scale sibling of the world overlay's 9x9 1-bit glyphs
 * described in `docs/frontend/BUBBLE_UI.md` §3 (five silhouettes) and §9 (the
 * 28-event mapping) — the same meaning, redrawn as crisp 12x12 stroke marks so
 * they read cleanly as inline SVG in a DOM card rather than as blitted 1x pixel
 * chrome on canvas. Nothing here is a rendering decision for the world renderer;
 * it is a parallel authoring for a different surface that shares the vocabulary,
 * so a card and its mark on the world carry the same glyph in the same accent.
 *
 * Glyphs are declared as typed primitive descriptors rather than raw markup, so
 * nothing on this surface ever reaches for `dangerouslySetInnerHTML`.
 */

import type { JSX } from "react";

import type { OverlayGlyph } from "../../../presentation/eventLegibilityMap";

/** One primitive inside a glyph, authored on a 12x12 viewBox. */
export type GlyphShape =
  | Readonly<{ kind: "path"; d: string; filled?: true; dash?: string }>
  | Readonly<{ kind: "circle"; cx: number; cy: number; r: number; filled?: true }>;

const path = (d: string): GlyphShape => Object.freeze({ kind: "path", d });
const solid = (d: string): GlyphShape => Object.freeze({ kind: "path", d, filled: true });
const dashed = (d: string): GlyphShape =>
  Object.freeze({ kind: "path", d, dash: "1.4 1.3" });
const dot = (cx: number, cy: number, r: number): GlyphShape =>
  Object.freeze({ kind: "circle", cx, cy, r, filled: true });
const ring = (cx: number, cy: number, r: number): GlyphShape =>
  Object.freeze({ kind: "circle", cx, cy, r });

/** Every glyph in the overlay vocabulary, as drawable primitives. */
export const STREAM_GLYPH_SHAPES: Readonly<Record<OverlayGlyph, readonly GlyphShape[]>> =
  Object.freeze({
    // --- exchange family (ochre) -------------------------------------------
    /** give: an open hand/arrow handing something rightward. */
    give: Object.freeze([path("M2 6 h6"), path("M6 3 l3 3 -3 3")]),
    /** gather: a downward-scooping arc collecting into a small mound. */
    gather: Object.freeze([path("M3 3 q3 3 0 6"), path("M4 9.5 h5")]),
    /** hoard: a stacked pile with a cap — a heap that will not move. */
    hoard: Object.freeze([path("M2.5 9.5 h7"), path("M3.5 7 h5"), path("M5 4.3 h2")]),

    // --- bond family (clay-rose) --------------------------------------------
    /** propose: two arcs reaching toward each other, not touching. */
    propose: Object.freeze([path("M2 4.5 q2 1.5 2.6 3"), path("M10 4.5 q-2 1.5 -2.6 3")]),
    /** refuse: the same reach, hard-slashed through. */
    refuse: Object.freeze([
      path("M2 4.5 q2 1.5 2.6 3"),
      path("M10 4.5 q-2 1.5 -2.6 3"),
      path("M2.5 9.5 l7 -7"),
    ]),
    /** lapse: a reach that fades — a broken arc going nowhere. */
    lapse: Object.freeze([dashed("M2 5 q1.4 1 1.9 2.1"), dashed("M7.6 8.4 q1.2 -0.4 1.9 -1.6")]),
    /** birth: a small circle rising out of an open cradle-arc. */
    birth: Object.freeze([path("M2.5 8 q3.5 3 7 0"), dot(6, 3.4, 1.3)]),

    // --- harm family (rust) --------------------------------------------------
    /** strike: a sharp angular bolt/impact chevron. */
    strike: Object.freeze([solid("M7 1.5 L3.5 6.3 L6 6.3 L4.6 10.5 L9 5 L6.3 5 Z")]),
    /** breach: a wall line broken open with a wedge driven through it. */
    breach: Object.freeze([
      path("M1.5 4 h3.2"), path("M7.3 4 h3.2"), path("M1.5 8 h3.2"), path("M7.3 8 h3.2"),
      solid("M6 1.5 l-1.6 4.5 h3.2 z"),
    ]),
    /** thieve: a hand/hook lifting out of a container. */
    thieve: Object.freeze([path("M2.5 7 h7 l-1 3 h-5 z"), path("M6 7 V3.2 q0 -1.3 1.6 -1.3")]),
    /** fell: a figure-stroke fallen to horizontal with a short vertical stub. */
    fell: Object.freeze([
      path("M1.8 8 h7.4"), ring(3, 8, 1), path("M4 8 h4"), path("M9 8 v-2.2"),
    ]),
    /** decay: a form dissolving into three descending motes. */
    decay: Object.freeze([dot(4, 3.2, 0.75), dot(6.6, 5.6, 0.75), dot(4.6, 8.6, 0.75)]),

    // --- dwell family (moss) --------------------------------------------------
    /** build: a roof over a rising post. */
    build: Object.freeze([path("M2 5.5 L6 2 L10 5.5"), path("M6 5.5 V10")]),
    /** hearth: a flame inside a hollow — a fire under a lintel. */
    hearth: Object.freeze([path("M2.5 3.5 h7"), solid("M6 5 q-1.6 1.8 0 3.3 q1.6 -1.5 0 -3.3 Z")]),
    /** join: a chevron pointing INTO a doorway. */
    join: Object.freeze([path("M2.5 2 v8"), path("M7.5 2 v8"), path("M4.5 4 l3 2 -3 2")]),
    /** depart: a chevron pointing OUT of a doorway (mirror of join). */
    depart: Object.freeze([path("M4.5 2 v8"), path("M9.5 2 v8"), path("M7.5 4 l-3 2 3 2")]),
    /** claim: a small banner/pennant planted on a base. */
    claim: Object.freeze([path("M4 10 V2"), solid("M4 2.2 l5 1.8 -5 1.8 Z")]),
    /** scavenge: a hand picking up from a broken low pile. */
    scavenge: Object.freeze([
      path("M2 9 h3 l1 -1.4 1 1.4 h3"), path("M6 6.3 V3"), path("M4.7 4.3 L6 3 l1.3 1.3"),
    ]),
    /** collapse: a roofline caved inward into rubble. */
    collapse: Object.freeze([path("M2 4.5 L6 7.3 L10 4.5"), path("M2 9 h3 l1 -1.4 1 1.4 h3")]),

    // --- body family (slate) --------------------------------------------------
    /** halt: a flat bar under a stopped upright — a barred stop. */
    halt: Object.freeze([path("M6 2 v5.2"), path("M2.5 9.5 h7")]),
    /** rise: an upward arrow lifting off a baseline. */
    rise: Object.freeze([path("M6 9.5 V3"), path("M3.4 5.6 L6 3 l2.6 2.6")]),

    // --- world family (bone-grey) ---------------------------------------------
    /** outward: a double chevron pointing right (away). */
    outward: Object.freeze([path("M3 3 l3 3 -3 3"), path("M6.8 3 l3 3 -3 3")]),
    /** inward: a double chevron pointing left (toward). */
    inward: Object.freeze([path("M9 3 l-3 3 3 3"), path("M5.2 3 l-3 3 3 3")]),
    /** dawn: a half-sun rising over a horizon with two short rays. */
    dawn: Object.freeze([
      path("M1.5 8 h9"), path("M3.5 8 a2.5 2.5 0 0 1 5 0"),
      path("M3 5.3 v-1.3"), path("M9 5.3 v-1.3"),
    ]),

    // --- utility ---------------------------------------------------------
    /** quote: a pair of quotation strokes. */
    quote: Object.freeze([path("M4 3.5 q0 2.5 -1.4 3.4"), path("M8.4 3.5 q0 2.5 -1.4 3.4")]),
    /** ellipsis: three dots in a row. */
    ellipsis: Object.freeze([dot(3, 6, 0.75), dot(6, 6, 0.75), dot(9, 6, 0.75)]),
  });

export interface StreamGlyphProps {
  readonly name: OverlayGlyph;
  /** Rendered width/height in CSS px. Defaults to 12. */
  readonly size?: number;
  /** When present the SVG becomes an accessible image with this label. */
  readonly title?: string;
}

/**
 * Renders one glyph as inline SVG that inherits `currentColor` for stroke and,
 * where a primitive opts in, for fill. Purely presentational.
 */
export function StreamGlyph({ name, size = 12, title }: StreamGlyphProps): JSX.Element {
  const shapes = STREAM_GLYPH_SHAPES[name];
  return (
    <svg
      viewBox="0 0 12 12"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="chronicle-killfeed__glyph"
      role={title === undefined ? undefined : "img"}
      aria-hidden={title === undefined ? true : undefined}
    >
      {title === undefined ? null : <title>{title}</title>}
      {shapes.map((shape, index) => (shape.kind === "path"
        ? <path
            key={index}
            d={shape.d}
            {...(shape.filled === true ? { fill: "currentColor", stroke: "none" } : {})}
            {...(shape.dash === undefined ? {} : { strokeDasharray: shape.dash })}
          />
        : <circle
            key={index}
            cx={shape.cx}
            cy={shape.cy}
            r={shape.r}
            {...(shape.filled === true ? { fill: "currentColor", stroke: "none" } : {})}
          />))}
    </svg>
  );
}
