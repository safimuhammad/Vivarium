/**
 * How long one utterance lasts — the single owner-set curve behind BOTH the
 * bubble that shows the words and the scene the being plays while saying them.
 *
 * **Why this module exists.** These two clocks used to be kept "in numeric
 * lockstep by convention, not by import", and they drifted apart twice: once
 * when the bubble was floored at the scene length, and again when
 * `dfba968` replaced the reading-budget model with the owner's hard 5-7s band
 * and left the scene at its old 3-14s curve. A 385-character line — the
 * measured median — then gave a 14s scene and a 6.9s bubble, so roughly half
 * of a being's own moment was silent pantomime. Safi's decision (2026-08-26)
 * was to bring the SCENE down to the BUBBLE, and to make the lockstep
 * mechanical.
 *
 * **Why it lives in `shared/`.** `shared/` is a leaf: it imports nothing from
 * `renderer2d/` or `presentation/`, so both layers can read the curve without
 * anyone depending upward. In particular the renderer still never reaches into
 * the choreography layer — the constraint the old convention existed to
 * protect — and the choreography layer does not have to reach into the
 * renderer's bubble grammar either.
 *
 * **The curve** (owner decision, Safi 2026-08-26):
 *
 * > *"if another message comes in then the prev should fade away if not then
 * > keep it for 5-7sec based on length on message longer message means max
 * > time."*
 *
 * A flat 5s floor plus 5ms a character, saturating at 7s once a message
 * reaches {@link SPEECH_LIFETIME_FULL_LENGTH_CHARS} — the measured MEDIAN
 * message length, so a typical line already earns close to the ceiling and
 * only genuinely short ones sit at the floor. An utterance is the live pulse
 * of a conversation, not the record of it; the Chronicle feed is where a long
 * line is read.
 */

/** The floor: the shortest an utterance ever lasts, however few words it has. */
export const SPEECH_LIFETIME_MIN_MS = 5_000;
/** The ceiling: the longest an utterance ever lasts, however many words it has. */
export const SPEECH_LIFETIME_MAX_MS = 7_000;
/** The flat base every utterance starts from, before its length is counted. */
export const SPEECH_LIFETIME_BASE_MS = SPEECH_LIFETIME_MIN_MS;
/** Where the 5s→7s ramp saturates: the measured median message (385 chars), rounded. */
export const SPEECH_LIFETIME_FULL_LENGTH_CHARS = 400;
/** 5ms a character — the ramp derived from the band and its saturation length, never guessed. */
export const SPEECH_LIFETIME_PER_CHAR_MS =
  (SPEECH_LIFETIME_MAX_MS - SPEECH_LIFETIME_MIN_MS) / SPEECH_LIFETIME_FULL_LENGTH_CHARS;

/**
 * Characters in an utterance, counted the one way both clocks count them.
 *
 * Whitespace-normalised and trimmed — exactly the normalisation the bubble
 * grammar's `layoutMessage` applies before it wraps, and exactly what it
 * reports as `MessageLayout.total`. Counting the WORDS SAID rather than the
 * wrapped lines they land in is what lets the scene match the bubble without
 * importing the renderer's per-variant column metrics: the same sentence is
 * the same length of time whether it lands in a wide speech bubble or a narrow
 * thought puff.
 *
 * @param text - The raw utterance, as the event payload carries it.
 * @returns The normalised character count, never negative.
 */
export function spokenCharacterCount(text: string): number {
  return text.replace(/\s+/gu, " ").trim().length;
}

/**
 * How long an utterance of `characterCount` characters lasts, in milliseconds.
 *
 * `clamp(5000 + 5 x characterCount, 5000, 7000)`. Wall-clock on the bubble side
 * and presentation-time on the scene side; neither divides by the simulation
 * speed multiplier.
 *
 * Reduced motion is deliberately NOT applied here. It is a renderer-side
 * accessibility carve-out on the reading surface (the bubble), not a property
 * of the utterance, so it is applied by the bubble alone — see
 * `EnvironmentSystem.bubbleTextLifetimeMs`.
 *
 * @param characterCount - Normalised character count, e.g. from
 *   {@link spokenCharacterCount} or `MessageLayout.total`. Non-finite or
 *   negative input is treated as an empty utterance and yields the floor.
 * @returns Whole milliseconds inside the 5s-7s band.
 */
export function speechLifetimeMs(characterCount: number): number {
  const characters = Number.isFinite(characterCount) ? Math.max(0, characterCount) : 0;
  return Math.round(Math.min(
    SPEECH_LIFETIME_MAX_MS,
    Math.max(SPEECH_LIFETIME_MIN_MS, SPEECH_LIFETIME_BASE_MS + characters * SPEECH_LIFETIME_PER_CHAR_MS),
  ));
}
