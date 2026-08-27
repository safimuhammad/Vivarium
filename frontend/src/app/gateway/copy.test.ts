import { describe, expect, it } from "vitest";

import {
  BANNED_VIEWER_WORDS,
  LANDING_COPY,
  personaDisclaimer,
  RUN_ENDED_NOTE,
  SEED_NOTE,
} from "./copy";

describe("the persona disclaimer", () => {
  it("says the being appends beneath the written words, never rewrites them", () => {
    const text = personaDisclaimer(12).join(" ");

    expect(text).toContain("Your words stay.");
    expect(text).toContain("appended beneath your words");
    expect(text).toContain("It can contradict you. It cannot delete you.");
  });

  it("never claims the persona will be rewritten — the naive version is false", () => {
    const text = personaDisclaimer(12).join(" ").toLowerCase();

    expect(text).not.toMatch(/rewritten|overwritten|replaced/);
  });

  it("takes the reflection cadence from the run's own setting", () => {
    expect(personaDisclaimer(6).join(" ")).toContain("sixth breath");
    expect(personaDisclaimer(6).join(" ")).toContain("every six breaths");
    expect(personaDisclaimer(12).join(" ")).toContain("twelfth breath");
    expect(personaDisclaimer(24).join(" ")).toContain("twenty-fourth breath");
  });

  it("falls back to digits for a cadence with no written ordinal", () => {
    expect(personaDisclaimer(17).join(" ")).toContain("17th breath");
  });

  it("says *may* write, because whether a being revises is genuinely unknowable", () => {
    const text = personaDisclaimer(12).join(" ");

    expect(text).toContain("may write");
    expect(text).not.toContain("will write");
  });
});

describe("the seed note", () => {
  it("describes land shape, not reproducibility", () => {
    expect(SEED_NOTE).toContain("shapes the land itself");
    expect(SEED_NOTE).toContain("The same seed always draws the same world.");
    expect(SEED_NOTE).toContain("is never the same twice");
  });

  it("does not promise a reproducible run", () => {
    expect(SEED_NOTE.toLowerCase()).not.toMatch(/reproduc|deterministic|replay the same/);
  });
});

describe("landing copy", () => {
  it("says this is a never-ending artwork rather than a game", () => {
    const text = [LANDING_COPY.title, LANDING_COPY.standfirst, ...LANDING_COPY.body].join(" ");

    expect(text).toMatch(/never/i);
    expect(text.toLowerCase()).not.toMatch(/\bplay\b|\bwin\b|\bscore\b|\blevel\b/);
  });

  it("keeps every viewer-facing word inside the world's vocabulary", () => {
    const surfaces = [
      LANDING_COPY.title,
      LANDING_COPY.standfirst,
      ...LANDING_COPY.body,
      ...LANDING_COPY.ways.flatMap((way) => [way.title, way.blurb, way.action]),
      SEED_NOTE,
      RUN_ENDED_NOTE,
      ...personaDisclaimer(12),
    ].join(" ").toLowerCase();

    for (const word of BANNED_VIEWER_WORDS) {
      expect(surfaces).not.toMatch(new RegExp(`\\b${word}\\b`));
    }
  });

  it("acknowledges an ended run without congratulating anyone on it", () => {
    // Shown on the way back from a run the viewer ended. It says what happened
    // and where it went; there is no outcome here to be pleased about.
    expect(RUN_ENDED_NOTE).toContain("has ended");
    expect(RUN_ENDED_NOTE).toContain("chronicle");
    expect(RUN_ENDED_NOTE.toLowerCase()).not.toMatch(/success|complete|finished|well done/);
  });

  it("offers exactly two ways in, the recording first", () => {
    expect(LANDING_COPY.ways.map((way) => way.id)).toEqual(["watch", "configure"]);
  });
});
