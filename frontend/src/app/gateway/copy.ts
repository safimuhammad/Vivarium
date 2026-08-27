/**
 * Viewer-facing prose for the way in — the two labels that must tell the truth.
 *
 * Spec `docs/superpowers/specs/2026-07-31-landing-and-config-design.md` §4 fixes
 * the wording of the persona disclaimer and the seed note, because both of the
 * naive versions are *false*:
 *
 * - "Your persona will be rewritten" is false. `seed.md` is written once and no
 *   code path anywhere rewrites or deletes it; `revise_self` writes only
 *   `identity.md`; and `load_identity()` always prepends the seed. The being
 *   **appends beneath** the written words.
 * - "The seed makes the run reproducible" is false. Only three RNG call sites
 *   exist in the whole backend and neither decider passes a seed. What the seed
 *   genuinely is, is the shape of the land: it is mixed into roughly fifteen
 *   terrain hash namespaces.
 *
 * The one number in the disclaimer — the reflection cadence — is a tuning
 * constant, so it is templated from the run's own `reflect_every_n_breaths`
 * rather than written into the sentence. The prose is spec-owned; the number is
 * server-owned.
 *
 * Vocabulary is also a rule here. `docs/frontend/VISION.md` bans a short list of
 * words from every viewer-visible surface; `BANNED_VIEWER_WORDS` is that list,
 * and a test walks every string in this module against it.
 */

/**
 * Words that must never appear on a surface a viewer reads.
 *
 * From `docs/frontend/VISION.md`: the piece is a world, and naming its
 * machinery breaks it. Say *being*, *hall*, *hearth*, *the land*.
 */
export const BANNED_VIEWER_WORDS: readonly string[] = [
  "simulation",
  "simulations",
  "agent",
  "agents",
  "llm",
  "llms",
  "spawn",
  "spawns",
  "spawned",
  "npc",
  "npcs",
];

/**
 * What the way-in says to a viewer who has just ended a run.
 *
 * A world vanishing and the landing page appearing is, on its own,
 * indistinguishable from something having broken. One line fixes that: it
 * confirms the ending was the thing they asked for, and says where what happened
 * went. It is shown only on the way back from an ended run and is gone the
 * moment they move on.
 */
export const RUN_ENDED_NOTE
  = "That world has ended. What happened in it stays in the chronicle.";

/** Ordinals for the cadences the server actually offers; anything else falls back to digits. */
const WRITTEN_ORDINALS: Readonly<Record<number, string>> = {
  6: "sixth",
  12: "twelfth",
  18: "eighteenth",
  24: "twenty-fourth",
  36: "thirty-sixth",
};

/** Cardinals for the same set, for the "every N breaths after" clause. */
const WRITTEN_CARDINALS: Readonly<Record<number, string>> = {
  6: "six",
  12: "twelve",
  18: "eighteen",
  24: "twenty-four",
  36: "thirty-six",
};

/**
 * The persona disclaimer, in the run's own reflection cadence.
 *
 * Every clause is checkable against the code. Note the deliberate *may*: whether
 * a being revises at any given reflection is genuinely unknowable, because
 * `revise_self` is optional and emits no event.
 *
 * @param reflectEveryNBreaths - The run's reflection cadence.
 * @returns The disclaimer as paragraphs, first sentence emphasised by the caller.
 */
export function personaDisclaimer(reflectEveryNBreaths: number): readonly string[] {
  const ordinal = WRITTEN_ORDINALS[reflectEveryNBreaths] ?? `${reflectEveryNBreaths}th`;
  const cardinal = WRITTEN_CARDINALS[reflectEveryNBreaths] ?? String(reflectEveryNBreaths);
  return [
    "Your words stay. What the being adds to them is its own.",
    "The text you write is this being's birth nature and remains at the top of its mind "
    + "for the entire run, unchanged.",
    `From its ${ordinal} breath onward, and every ${cardinal} breaths after, the being `
    + "pauses and may write a second passage about who it has become — appended beneath "
    + "your words. Over a long run that self-written passage is what drives its behaviour.",
    "It can contradict you. It cannot delete you.",
  ];
}

/** The seed note: land shape, not reproducibility. */
export const SEED_NOTE: string =
  "The seed shapes the land itself — where the paths run, where the water gathers, "
  + "where things grow. The same seed always draws the same world. What the beings then "
  + "choose to do in it is never the same twice.";

/** One of the two ways in, as the landing offers them. */
export interface LandingWay {
  readonly id: "watch" | "configure";
  readonly title: string;
  readonly blurb: string;
  readonly action: string;
}

/** Everything the landing page says. */
export interface LandingCopy {
  readonly title: string;
  readonly standfirst: string;
  readonly body: readonly string[];
  readonly ways: readonly LandingWay[];
  readonly footnote: string;
}

/**
 * The landing's own words.
 *
 * The first job of this page is to set an expectation: this is a never-ending
 * generative artwork, not a game. A viewer who arrives expecting to compete will
 * misread everything that follows — the thin land, the beings that sit still,
 * the run that ends without a conclusion.
 *
 * The recording is offered first, deliberately. It is the cheapest possible look
 * at what the piece actually is, it costs nothing, and it starts nothing.
 */
export const LANDING_COPY: LandingCopy = {
  title: "Vivarium",
  standfirst: "A world that never ends. There is nothing here to be won.",
  body: [
    "Four regions, thinning. A handful of beings wake in them with a little energy, "
    + "a little material, and no instructions at all. They look around, remember, speak, "
    + "gather, build, fight, and sometimes have children.",
    "Nothing scripts them and nothing is steering toward an outcome. The land holds less "
    + "than the beings already carry and regrows slowly, so it cannot feed everyone — that "
    + "is the whole of the pressure, and everything that happens comes out of it.",
    "What you set below are starting conditions, the way you would set the rules of a "
    + "cellular automaton. Then you watch. What unfolds is the piece.",
  ],
  ways: [
    {
      id: "watch",
      title: "Watch a world that already ran",
      blurb:
        "A recorded run, replayed at the pace it happened. Nothing starts, nothing costs "
        + "anything, and it is the fastest way to see what this is.",
      action: "Watch a recording",
    },
    {
      id: "configure",
      title: "Set the conditions and let a new world begin",
      blurb:
        "Choose how many beings wake, what they carry, how much the land gives them, and "
        + "what shape the land takes. Then let it go and see.",
      action: "Set the conditions",
    },
  ],
  footnote:
    "The beings do not know they are being watched, and are not told any of this. "
    + "That is deliberate.",
};
