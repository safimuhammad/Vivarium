import { EVENT_VISUAL_EVENT_TYPES } from "../events/eventVisualCatalog";
import type { PresentedEventType } from "./eventPayloads";

/**
 * The legibility grammar's vocabulary, per `docs/frontend/BUBBLE_UI.md`.
 *
 * This module is the exhaustiveness oracle for the world overlay: every
 * canonical simulation event must appear in {@link EVENT_LEGIBILITY_MAP}, and
 * the map is typed as a total `Record<PresentedEventType, ...>` so a new event
 * type fails to compile until it is mapped. `eventLegibilityMap.test.ts`
 * mirrors `assertCompleteChoreographyRegistry`'s proven runtime check over
 * `EVENT_VISUAL_EVENT_TYPES` so the guarantee also holds against data-driven
 * catalogue drift.
 *
 * Nothing here is a rendering decision the renderer may override: the renderer
 * owns pixels, this module owns *meaning* (which silhouette, which family,
 * which glyph, how loud, what it is anchored to).
 */

/** The five silhouettes. Shape is the primary channel because it survives downscaling. */
export type OverlayKind =
  /** Rounded balloon, solid outline, fat identity-hued tail. Speech aloud. */
  | "speech"
  /** Same balloon, dashed outline, narrower, plus a thread to the addressee. */
  | "whisper"
  /** Scalloped cloud, dashed, detached shrinking puffs, no anchor stud. */
  | "thought"
  /** Tapered banner on a rigid post + foot bar. Every action event. */
  | "mark"
  /** Spiked star with no connector. It sits *on* the thing it happened to. */
  | "burst";

/**
 * The six colour families. Colour is the coarse channel; the bubble body is
 * always vellum and the family colour appears only as a thin accent.
 */
export type OverlayFamily =
  | "exchange"
  | "bond"
  | "harm"
  | "dwell"
  | "body"
  | "world";

/**
 * Significance tiers. A death must not look like a greeting: tier drives
 * lifetime, demotion order under crowding, and (for KNELL) field inversion.
 */
export type OverlayTier = "murmur" | "beat" | "strike" | "knell";

/** The 25 verb glyphs plus the two low-zoom utility studs. All are 9x9 1-bit. */
export type OverlayGlyph =
  // exchange
  | "give" | "gather" | "hoard"
  // bond
  | "propose" | "refuse" | "lapse" | "birth"
  // harm
  | "strike" | "breach" | "thieve" | "fell" | "decay"
  // dwell
  | "build" | "hearth" | "join" | "depart" | "claim" | "scavenge" | "collapse"
  // body
  | "halt" | "rise"
  // world
  | "outward" | "inward" | "dawn"
  // utility (low-zoom studs for the text kinds; never a mark's own glyph)
  | "quote" | "ellipsis";

/**
 * Which world thing an overlay hangs on. Resolved by the renderer's command
 * resolver against the live placement ledger; never invented when absent.
 */
export type OverlayAnchor =
  /** The acting being (the speaker, the giver, the striker, the builder). */
  | "actor"
  /** The being the event happened *to* (the victim, the newborn, the recipient). */
  | "subject"
  /** The structure the event is about (its door point). */
  | "home";

export interface OverlayMappingEntry {
  /** Silhouette drawn for the event's primary mark. */
  readonly kind: OverlayKind;
  /** `null` for the three text kinds, whose meaning is carried by their words. */
  readonly glyph: OverlayGlyph | null;
  readonly family: OverlayFamily;
  readonly tier: OverlayTier;
  /** What the primary mark hangs on. */
  readonly anchor: OverlayAnchor;
  /**
   * A second, simultaneous burst for events that both *are done by* someone and
   * *happen to* someone — an attack marks the attacker and bursts on the victim.
   */
  readonly burst?: Readonly<{
    readonly glyph: OverlayGlyph;
    readonly anchor: OverlayAnchor;
    /** Ink field + bone glyph. Only death and home collapse invert. */
    readonly invert?: true;
    /** Wider, 9-spike star: the one *light* knell. */
    readonly light?: true;
  }>;
  /**
   * Draw a dotted aim-thread from the mark to a receiver cap above the
   * addressed being. `severed` halts the thread at 55% and strikes it through:
   * a refusal is a bond that stops.
   */
  readonly thread?: "aim" | "severed";
  /**
   * True when the event's own payload carries an exact number this mark should
   * print beside its glyph (never invented; the resolver supplies the text).
   */
  readonly micro?: true;
}

const M = (entry: OverlayMappingEntry): OverlayMappingEntry => Object.freeze(entry);

/**
 * The 28-event mapping — `docs/frontend/BUBBLE_UI.md` §9, in code.
 *
 * Typed as a total record so an added `PresentedEventType` is a compile error
 * here before it is a silent hole in the world view.
 */
export const EVENT_LEGIBILITY_MAP: Readonly<Record<PresentedEventType, OverlayMappingEntry>> =
  Object.freeze({
    // --- lifecycle -------------------------------------------------------
    agent_born: M({
      kind: "mark", glyph: "birth", family: "bond", tier: "knell", anchor: "actor",
      burst: { glyph: "birth", anchor: "subject", light: true },
    }),
    agent_died: M({
      kind: "mark", glyph: "fell", family: "harm", tier: "knell", anchor: "actor",
      burst: { glyph: "fell", anchor: "subject", invert: true },
    }),
    agent_decayed: M({
      kind: "mark", glyph: "decay", family: "harm", tier: "murmur", anchor: "subject",
    }),
    agent_paralyzed: M({
      kind: "mark", glyph: "halt", family: "body", tier: "beat", anchor: "subject",
    }),
    agent_recovered: M({
      kind: "mark", glyph: "rise", family: "body", tier: "beat", anchor: "subject",
      thread: "aim",
    }),
    agent_left_region: M({
      kind: "mark", glyph: "outward", family: "world", tier: "murmur", anchor: "actor",
    }),
    agent_entered_region: M({
      kind: "mark", glyph: "inward", family: "world", tier: "murmur", anchor: "actor",
    }),

    // --- voice -----------------------------------------------------------
    // `speak` maps to the *broadcast* silhouette here; a same-region targeted
    // line is promoted to `whisper` (dashed + thread) by the resolver, which is
    // the only layer that knows whether the listener is on screen. The two rows
    // of BUBBLE_UI.md §9 (8 and 9) are one event type with two presentations.
    speak: M({ kind: "speech", glyph: null, family: "world", tier: "murmur", anchor: "actor" }),
    self_talk: M({ kind: "thought", glyph: null, family: "world", tier: "murmur", anchor: "actor" }),

    // --- exchange --------------------------------------------------------
    resource_changed: M({
      kind: "mark", glyph: "gather", family: "exchange", tier: "beat", anchor: "actor", micro: true,
    }),
    resource_transferred: M({
      kind: "mark", glyph: "give", family: "exchange", tier: "beat", anchor: "actor",
      thread: "aim", micro: true,
    }),
    agent_started_hoarding: M({
      kind: "mark", glyph: "hoard", family: "exchange", tier: "beat", anchor: "actor", micro: true,
    }),

    // --- bond ------------------------------------------------------------
    mating_initiated: M({
      kind: "mark", glyph: "propose", family: "bond", tier: "beat", anchor: "actor", thread: "aim",
    }),
    mating_rejected: M({
      kind: "mark", glyph: "refuse", family: "bond", tier: "strike", anchor: "actor",
      thread: "severed",
    }),
    mating_proposal_invalidated: M({
      kind: "mark", glyph: "lapse", family: "bond", tier: "murmur", anchor: "actor",
    }),
    mating_proposal_timeout: M({
      kind: "mark", glyph: "lapse", family: "bond", tier: "murmur", anchor: "actor",
    }),

    // --- harm ------------------------------------------------------------
    attack: M({
      kind: "mark", glyph: "strike", family: "harm", tier: "strike", anchor: "actor",
      burst: { glyph: "strike", anchor: "subject" }, thread: "aim", micro: true,
    }),

    // --- dwell / contest --------------------------------------------------
    home_built: M({
      kind: "mark", glyph: "build", family: "dwell", tier: "beat", anchor: "actor",
    }),
    hearth_used: M({
      kind: "mark", glyph: "hearth", family: "dwell", tier: "beat", anchor: "actor",
    }),
    home_joined: M({
      kind: "mark", glyph: "join", family: "dwell", tier: "beat", anchor: "actor", thread: "aim",
    }),
    home_left: M({
      kind: "mark", glyph: "depart", family: "dwell", tier: "beat", anchor: "actor", thread: "aim",
    }),
    home_started_hoarding: M({
      kind: "mark", glyph: "hoard", family: "dwell", tier: "beat", anchor: "home", micro: true,
    }),
    home_collapsed: M({
      kind: "burst", glyph: "collapse", family: "dwell", tier: "knell", anchor: "home",
      burst: { glyph: "collapse", anchor: "home", invert: true },
    }),
    home_breached: M({
      kind: "mark", glyph: "breach", family: "harm", tier: "strike", anchor: "actor",
      burst: { glyph: "breach", anchor: "home" },
    }),
    home_thieved: M({
      kind: "mark", glyph: "thieve", family: "harm", tier: "strike", anchor: "actor",
      thread: "aim", micro: true,
    }),
    home_colonized: M({
      kind: "mark", glyph: "claim", family: "dwell", tier: "beat", anchor: "home",
    }),
    ruins_scavenged: M({
      kind: "mark", glyph: "scavenge", family: "dwell", tier: "beat", anchor: "actor", micro: true,
    }),

    // --- world -----------------------------------------------------------
    simulation_started: M({
      kind: "mark", glyph: "dawn", family: "world", tier: "beat", anchor: "actor",
    }),
  } satisfies Record<PresentedEventType, OverlayMappingEntry>);

/**
 * Wall-clock lifetime floor per tier, in ms. A knell must outlast a murmur even
 * when both carry the same number of characters. Text kinds extend this by
 * their own visible length (see `overlayLifetimeMs`).
 */
export const OVERLAY_TIER_HOLD_MS: Readonly<Record<OverlayTier, number>> = Object.freeze({
  murmur: 2_600,
  beat: 3_200,
  strike: 4_200,
  knell: 6_000,
});

/**
 * Demotion order under crowding: the least significant mark collapses to a
 * residue pip first, and a KNELL is never demoted. Higher wins a slot.
 */
export const OVERLAY_TIER_RANK: Readonly<Record<OverlayTier, number>> = Object.freeze({
  murmur: 0,
  beat: 1,
  strike: 2,
  knell: 3,
});

/** Look up one event's grammar, or `undefined` for a type outside the canon. */
export function overlayMappingFor(type: string): OverlayMappingEntry | undefined {
  return Object.hasOwn(EVENT_LEGIBILITY_MAP, type)
    ? EVENT_LEGIBILITY_MAP[type as PresentedEventType]
    : undefined;
}

/**
 * Throw unless the map covers exactly the canonical event vocabulary.
 *
 * Mirrors `assertCompleteChoreographyRegistry` (`choreography/registry.ts`):
 * the compile-time `Record` catches a *renamed* event, this catches an *added*
 * one reaching the catalogue without reaching the overlay.
 */
export function assertCompleteEventLegibilityMap(
  map: Readonly<Record<string, OverlayMappingEntry>> = EVENT_LEGIBILITY_MAP,
): void {
  const canonical = new Set<string>(EVENT_VISUAL_EVENT_TYPES);
  const keys = Object.keys(map);
  const missing = EVENT_VISUAL_EVENT_TYPES.filter((type) => map[type] === undefined);
  const unknown = keys.filter((type) => !canonical.has(type));
  if (missing.length > 0 || unknown.length > 0 || keys.length !== EVENT_VISUAL_EVENT_TYPES.length) {
    throw new Error(
      "event legibility map must cover exactly the canonical event types; "
      + `missing=${missing.join(",") || "none"}; unknown=${unknown.join(",") || "none"}`,
    );
  }
}
