import type { JSX } from "react";

import type { OverlayGlyph } from "../../presentation/eventLegibilityMap";

/**
 * DOM-scale glyph sheet for the event journey pilot.
 *
 * These are the DOM-scale sibling of the world overlay's 9x9 1-bit glyphs
 * described in `docs/frontend/BUBBLE_UI.md` §3 (five silhouettes) and §9
 * (the 28-event mapping) — same meaning, redrawn as crisp 12x12 stroke
 * marks so they read cleanly as inline SVG in a DOM panel rather than as
 * blitted 1x pixel chrome on canvas. Nothing here is a rendering decision
 * for the world renderer; it is a parallel authoring for a different
 * surface (the pilot's DOM event journey), sharing only the vocabulary.
 *
 * Speed-first design pilot per CLAUDE.md §5 (pilot/mock exception): no
 * tests required, but `npx tsc --noEmit` must stay clean.
 */

/**
 * SVG inner markup for each glyph, authored on a 12x12 viewBox.
 *
 * Each value is *children* markup only (no `<svg>` wrapper) — it is
 * injected via `dangerouslySetInnerHTML` by {@link JourneyGlyph}, so only
 * plain geometry primitives appear here: no ids, no styles, no scripts.
 * Every glyph sits inside the 1..11 safe box and inherits `currentColor`
 * for stroke (and, where an element is deliberately filled, for fill too).
 */
export const JOURNEY_GLYPH_PATHS: Readonly<Record<OverlayGlyph, string>> = Object.freeze({
  // --- exchange family (ochre) ------------------------------------------
  // give: an open hand/arrow handing something rightward.
  give: '<path d="M2 6 h6" /><path d="M6 3 l3 3 -3 3" />',
  // gather: a downward-scooping arc collecting into a small mound.
  gather: '<path d="M3 3 q3 3 0 6" /><path d="M4 9.5 h5" />',
  // hoard: a stacked pile with a cap — a heap that will not move.
  hoard: '<path d="M2.5 9.5 h7" /><path d="M3.5 7 h5" /><path d="M5 4.3 h2" />',

  // --- bond family (clay-rose) -------------------------------------------
  // propose: two arcs reaching toward each other, not touching.
  propose: '<path d="M2 4.5 q2 1.5 2.6 3" /><path d="M10 4.5 q-2 1.5 -2.6 3" />',
  // refuse: the same reach, hard-slashed through.
  refuse: '<path d="M2 4.5 q2 1.5 2.6 3" /><path d="M10 4.5 q-2 1.5 -2.6 3" /><path d="M2.5 9.5 l7 -7" />',
  // lapse: a reach that fades — a dashed/broken arc going nowhere.
  lapse: '<path d="M2 5 q1.4 1 1.9 2.1" stroke-dasharray="1.4 1.3" /><path d="M7.6 8.4 q1.2 -0.4 1.9 -1.6" stroke-dasharray="1.4 1.3" />',
  // birth: a small circle rising out of an open cradle-arc.
  birth: '<path d="M2.5 8 q3.5 3 7 0" /><circle cx="6" cy="3.4" r="1.3" fill="currentColor" stroke="none" />',

  // --- harm family (rust) -------------------------------------------------
  // strike: a sharp angular bolt/impact chevron.
  strike: '<path d="M7 1.5 L3.5 6.3 L6 6.3 L4.6 10.5 L9 5 L6.3 5 Z" fill="currentColor" stroke="none" />',
  // breach: a wall line broken open with a wedge driven through it.
  breach: '<path d="M1.5 4 h3.2" /><path d="M7.3 4 h3.2" /><path d="M1.5 8 h3.2" /><path d="M7.3 8 h3.2" /><path d="M6 1.5 l-1.6 4.5 h3.2 z" fill="currentColor" stroke="none" />',
  // thieve: a hand/hook lifting out of a container.
  thieve: '<path d="M2.5 7 h7 l-1 3 h-5 z" /><path d="M6 7 V3.2 q0 -1.3 1.6 -1.3" />',
  // fell: a figure-stroke fallen to horizontal with a short vertical stub.
  fell: '<path d="M1.8 8 h7.4" /><circle cx="3" cy="8" r="1" /><path d="M4 8 h4" /><path d="M9 8 v-2.2" />',
  // decay: a form dissolving into three descending motes.
  decay: '<circle cx="4" cy="3.2" r="0.75" fill="currentColor" stroke="none" /><circle cx="6.6" cy="5.6" r="0.75" fill="currentColor" stroke="none" /><circle cx="4.6" cy="8.6" r="0.75" fill="currentColor" stroke="none" />',

  // --- dwell family (moss) --------------------------------------------------
  // build: a roof over a rising post.
  build: '<path d="M2 5.5 L6 2 L10 5.5" /><path d="M6 5.5 V10" />',
  // hearth: a flame inside a hollow — a fire under a lintel.
  hearth: '<path d="M2.5 3.5 h7" /><path d="M6 5 q-1.6 1.8 0 3.3 q1.6 -1.5 0 -3.3 Z" fill="currentColor" stroke="none" />',
  // join: a chevron pointing INTO a doorway.
  join: '<path d="M2.5 2 v8" /><path d="M7.5 2 v8" /><path d="M4.5 4 l3 2 -3 2" />',
  // depart: a chevron pointing OUT of a doorway (mirror of join).
  depart: '<path d="M4.5 2 v8" /><path d="M9.5 2 v8" /><path d="M7.5 4 l-3 2 3 2" />',
  // claim: a small banner/pennant planted on a base.
  claim: '<path d="M4 10 V2" /><path d="M4 2.2 l5 1.8 -5 1.8 Z" fill="currentColor" stroke="none" />',
  // scavenge: a hand picking up from a broken low pile.
  scavenge: '<path d="M2 9 h3 l1 -1.4 1 1.4 h3" /><path d="M6 6.3 V3" /><path d="M4.7 4.3 L6 3 l1.3 1.3" />',
  // collapse: a roofline caved inward into rubble (mirror-pair with scavenge).
  collapse: '<path d="M2 4.5 L6 7.3 L10 4.5" /><path d="M2 9 h3 l1 -1.4 1 1.4 h3" />',

  // --- body family (slate) -------------------------------------------------
  // halt: a flat bar under a stopped upright — a barred stop.
  halt: '<path d="M6 2 v5.2" /><path d="M2.5 9.5 h7" />',
  // rise: an upward arrow lifting off a baseline.
  rise: '<path d="M6 9.5 V3" /><path d="M3.4 5.6 L6 3 l2.6 2.6" />',

  // --- world family (bone-grey) ---------------------------------------------
  // outward: a double chevron pointing right (away).
  outward: '<path d="M3 3 l3 3 -3 3" /><path d="M6.8 3 l3 3 -3 3" />',
  // inward: a double chevron pointing left (toward) — mirror of outward.
  inward: '<path d="M9 3 l-3 3 3 3" /><path d="M5.2 3 l-3 3 3 3" />',
  // dawn: a half-sun rising over a horizon line with two short rays.
  dawn: '<path d="M1.5 8 h9" /><path d="M3.5 8 a2.5 2.5 0 0 1 5 0" /><path d="M3 5.3 v-1.3" /><path d="M9 5.3 v-1.3" />',

  // --- utility ---------------------------------------------------------
  // quote: a pair of quotation strokes.
  quote: '<path d="M4 3.5 q0 2.5 -1.4 3.4" /><path d="M8.4 3.5 q0 2.5 -1.4 3.4" />',
  // ellipsis: three dots in a row.
  ellipsis: '<circle cx="3" cy="6" r="0.75" fill="currentColor" stroke="none" /><circle cx="6" cy="6" r="0.75" fill="currentColor" stroke="none" /><circle cx="9" cy="6" r="0.75" fill="currentColor" stroke="none" />',
});

/** Props for {@link JourneyGlyph}. */
export interface JourneyGlyphProps {
  /** Which glyph to render, keyed against {@link JOURNEY_GLYPH_PATHS}. */
  readonly name: OverlayGlyph;
  /** Rendered width/height in px. Defaults to 14. */
  readonly size?: number;
  readonly className?: string;
  /** When present, the SVG becomes an accessible image with this label. */
  readonly title?: string;
}

/**
 * Renders one glyph as an inline SVG that inherits `currentColor` for both
 * stroke and (where a glyph element opts in) fill.
 *
 * Purely presentational — no world state, no events. `dangerouslySetInnerHTML`
 * is safe here because {@link JOURNEY_GLYPH_PATHS} is a static, hand-authored,
 * fully-covered `Record` (never user- or payload-derived content).
 */
export function JourneyGlyph(props: JourneyGlyphProps): JSX.Element {
  const { name, size = 14, className, title } = props;
  const markup = JOURNEY_GLYPH_PATHS[name];
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
      className={className}
      role={title ? "img" : undefined}
      aria-hidden={title ? undefined : true}
      // eslint-disable-next-line react/no-danger -- static, hand-authored glyph markup only; see JOURNEY_GLYPH_PATHS docs.
      dangerouslySetInnerHTML={{ __html: (title ? `<title>${title}</title>` : "") + markup }}
    />
  );
}

/** A dev sheet rendering every glyph with its name — used by the pilot's `?sheet=glyphs` view. */
export function JourneyGlyphSheet(): JSX.Element {
  const names = Object.keys(JOURNEY_GLYPH_PATHS) as OverlayGlyph[];
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: 18,
        padding: 24,
        background: "#12140f",
        color: "#ece2cc",
      }}
    >
      {names.map((name) => (
        <div
          key={name}
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 6,
            width: 64,
          }}
        >
          <JourneyGlyph name={name} size={32} />
          <span style={{ fontFamily: "monospace", fontSize: 10 }}>{name}</span>
        </div>
      ))}
    </div>
  );
}
