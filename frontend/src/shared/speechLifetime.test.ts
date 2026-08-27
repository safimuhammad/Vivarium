import { describe, expect, it } from "vitest";

import {
  SPEECH_LIFETIME_BASE_MS,
  SPEECH_LIFETIME_FULL_LENGTH_CHARS,
  SPEECH_LIFETIME_MAX_MS,
  SPEECH_LIFETIME_MIN_MS,
  SPEECH_LIFETIME_PER_CHAR_MS,
  speechLifetimeMs,
  spokenCharacterCount,
} from "./speechLifetime";

describe("the one utterance curve", () => {
  it("derives the ramp from the band and its saturation length rather than a guessed constant", () => {
    expect(SPEECH_LIFETIME_BASE_MS).toBe(SPEECH_LIFETIME_MIN_MS);
    expect(SPEECH_LIFETIME_PER_CHAR_MS).toBe(
      (SPEECH_LIFETIME_MAX_MS - SPEECH_LIFETIME_MIN_MS) / SPEECH_LIFETIME_FULL_LENGTH_CHARS,
    );
    // The owner's band, pinned as data (Safi, 2026-08-26): 5s floor, 7s ceiling,
    // 5ms a character, saturating at the measured median message.
    expect([SPEECH_LIFETIME_MIN_MS, SPEECH_LIFETIME_MAX_MS]).toEqual([5_000, 7_000]);
    expect(SPEECH_LIFETIME_FULL_LENGTH_CHARS).toBe(400);
    expect(SPEECH_LIFETIME_PER_CHAR_MS).toBe(5);
  });

  it.each([
    { chars: 0, ms: 5_000 },
    { chars: 1, ms: 5_005 },
    { chars: 40, ms: 5_200 },
    { chars: 385, ms: 6_925 },
    { chars: 399, ms: 6_995 },
    { chars: 400, ms: 7_000 },
    { chars: 401, ms: 7_000 },
    { chars: 10_000, ms: 7_000 },
  ])("holds $chars characters for $ms ms", ({ chars, ms }) => {
    expect(speechLifetimeMs(chars)).toBe(ms);
  });

  it("stays inside the band, monotonically, for any input a payload could carry", () => {
    let previous = 0;
    for (let chars = 0; chars <= 1_200; chars += 1) {
      const held = speechLifetimeMs(chars);
      expect(held).toBeGreaterThanOrEqual(SPEECH_LIFETIME_MIN_MS);
      expect(held).toBeLessThanOrEqual(SPEECH_LIFETIME_MAX_MS);
      expect(held).toBeGreaterThanOrEqual(previous);
      expect(Number.isInteger(held)).toBe(true);
      previous = held;
    }
    // Garbage is treated as an empty utterance, never as a NaN deadline that
    // would strand a bubble (or a scene) on screen forever.
    expect(speechLifetimeMs(Number.NaN)).toBe(SPEECH_LIFETIME_MIN_MS);
    expect(speechLifetimeMs(Number.POSITIVE_INFINITY)).toBe(SPEECH_LIFETIME_MIN_MS);
    expect(speechLifetimeMs(-1)).toBe(SPEECH_LIFETIME_MIN_MS);
  });

  it("counts characters the one way both clocks count them", () => {
    // Exactly `layoutMessage`'s own normalisation, which it reports as
    // `MessageLayout.total`: collapse whitespace runs, then trim.
    expect(spokenCharacterCount("  I drift,\n  content.  ")).toBe("I drift, content.".length);
    expect(spokenCharacterCount("")).toBe(0);
    expect(spokenCharacterCount("   \n\t ")).toBe(0);
    expect(spokenCharacterCount("a".repeat(40))).toBe(40);
  });
});
