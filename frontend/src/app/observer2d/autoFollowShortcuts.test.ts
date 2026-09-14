import { describe, expect, it } from "vitest";

import type { SemanticSubjectView } from "./semanticWorld";
import type {
  FollowAgentFact,
  FollowCandidateView,
  FollowRosterView,
} from "./followSubject";
import {
  deriveAutoFollowSlots,
  type AutoFollowShortcutsInput,
  type AutoFollowShortcut,
} from "./autoFollowShortcuts";
import type { StreamEvent } from "./chronicleStream/streamEvent";

function subject(
  token: string,
  action = "No active action",
): SemanticSubjectView {
  return {
    token,
    kind: "agent",
    name: token.replace("token-", "").replace(/^./u, (value) => value.toUpperCase()),
    status: "Alive",
    position: "Nirvana, column 2, row 3",
    currentAction: action,
    selected: false,
    canFollow: true,
  };
}

function fact(name: string, regionKey: string, overrides: Partial<FollowAgentFact> = {}): FollowAgentFact {
  return {
    name,
    regionKey,
    living: true,
    dead: false,
    reachable: true,
    ...overrides,
  };
}

function roster(
  keys: readonly string[],
  overrides: Readonly<Record<string, Partial<FollowAgentFact>>> = {},
): FollowRosterView {
  const candidates: FollowCandidateView[] = keys.map((key) => ({
    key,
    name: key.replace(/^./u, (value) => value.toUpperCase()),
    regionKey: overrides[key]?.regionKey ?? "nirvana",
    regionDisplayName: (overrides[key]?.regionKey ?? "nirvana") === "nirvana"
      ? "Nirvana"
      : "Warm Springs",
  }));
  const byKey = new Map(keys.map((key) => [key, fact(
    key.replace(/^./u, (value) => value.toUpperCase()),
    overrides[key]?.regionKey ?? "nirvana",
    overrides[key],
  )] as const));
  return { candidates, byKey };
}

function event(
  key: string,
  atMs: number,
  cursor: number,
  baseSalience = 50,
): StreamEvent {
  return {
    id: "stream:" + cursor,
    cursor,
    type: "speak",
    mapping: {} as StreamEvent["mapping"],
    catalog: {} as StreamEvent["catalog"],
    kind: "speech",
    glyph: "quote",
    family: "world",
    tier: "murmur",
    accent: "#8a8270",
    posture: "progress",
    notable: false,
    actorId: key,
    actorName: key,
    actorHue: "#43607f",
    targetId: null,
    targetName: null,
    targetHue: null,
    regionId: "nirvana",
    regionLabel: "Nirvana",
    homeId: null,
    narration: { verb: "spoke", line: key + " spoke.", detail: null, quote: null },
    participants: [key],
    baseSalience,
    stateChange: [],
    atMs,
    payload: {},
    wallTimestamp: null,
    scope: "global",
    source: "test",
  };
}

function derive(
  keys: readonly string[],
  subjects: readonly SemanticSubjectView[],
  options: TestOptions = {},
): readonly AutoFollowShortcut[] {
  return deriveAutoFollowSlots({
    subjects,
    resolveAgentKey: (token) => token.replace("token-", ""),
    roster: roster(keys, options.rosterOverrides),
    events: options.events ?? [],
    followedKey: options.followedKey ?? null,
    observedRegionKey: options.observedRegionKey ?? "nirvana",
    previousSlots: options.previousSlots,
    protectedKeys: options.protectedKeys,
    nowMs: options.nowMs ?? 10_000,
  });
}

type TestOptions = Partial<AutoFollowShortcutsInput> & {
  readonly rosterOverrides?: Readonly<Record<string, Partial<FollowAgentFact>>>;
};

describe("deriveAutoFollowSlots", () => {
  it("prefers renderer-visible living beings and uses their meaningful action", () => {
    const slots = derive(
      ["aster", "briar", "cinder"],
      [subject("token-aster"), subject("token-briar", "Speaking")],
      { events: [event("cinder", 9_900, 2)] },
    );

    expect(slots.map((slot) => slot.key)).toEqual(["briar", "aster", "cinder"]);
    expect(slots[0]).toMatchObject({ name: "Briar", action: "Speaking", visible: true });
    expect(slots[2]).toMatchObject({ name: "Cinder", action: "Spoke", visible: false, recent: true });
  });

  it("keeps the followed being and caps the shortcut row at four", () => {
    const slots = derive(
      ["aster", "briar", "cinder", "dove", "ember", "fenn"],
      [
        subject("token-aster"), subject("token-briar"), subject("token-cinder"),
        subject("token-dove"),
      ],
      { followedKey: "ember", events: [event("fenn", 9_999, 8)] },
    );

    expect(slots).toHaveLength(4);
    expect(slots.map((slot) => slot.key)).toEqual(["ember", "aster", "briar", "cinder"]);
    expect(slots[0]?.active).toBe(true);
  });

  it("does not replace a modestly weaker slot while it is protected by pointer or focus", () => {
    const first = derive(
      ["aster", "briar", "cinder", "dove", "ember"],
      [subject("token-aster"), subject("token-briar"), subject("token-cinder"), subject("token-dove")],
    );
    const next = derive(
      ["aster", "briar", "cinder", "dove", "ember"],
      [subject("token-aster"), subject("token-briar"), subject("token-cinder"), subject("token-dove")],
      {
        previousSlots: first,
        protectedKeys: new Set(["dove"]),
        events: [event("ember", 10_000, 99, 100)],
      },
    );

    expect(next.map((slot) => slot.key)).toContain("dove");
    expect(next).toHaveLength(4);
  });

  it("replaces a stale slot after a meaningful newcomer clears the hysteresis margin", () => {
    const first = derive(
      ["aster", "briar", "cinder", "dove", "ember"],
      [subject("token-aster"), subject("token-briar"), subject("token-cinder"), subject("token-dove")],
    );
    const next = derive(
      ["aster", "briar", "cinder", "dove", "ember"],
      [
        subject("token-aster"), subject("token-briar"), subject("token-cinder"),
        subject("token-dove"), subject("token-ember", "Speaking"),
      ],
      {
        previousSlots: first,
        events: [event("ember", 10_000, 99, 100)],
      },
    );

    expect(next.map((slot) => slot.key)).toContain("ember");
    expect(next).not.toContainEqual(expect.objectContaining({ key: "dove" }));
  });

  it("drops removed or dead beings before preserving prior slots", () => {
    const prior = derive(
      ["aster", "briar", "cinder", "dove"],
      [subject("token-aster"), subject("token-briar"), subject("token-cinder"), subject("token-dove")],
    );
    const next = derive(
      ["aster", "briar", "cinder"],
      [subject("token-aster"), subject("token-briar"), subject("token-cinder")],
      {
        previousSlots: prior,
        rosterOverrides: { briar: { living: false, dead: true } },
      },
    );

    expect(next.map((slot) => slot.key)).toEqual(["aster", "cinder"]);
  });

  it("labels a recent remote being with its roster region", () => {
    const slots = derive(
      ["aster", "briar"],
      [subject("token-aster")],
      {
        events: [event("briar", 9_500, 4)],
        rosterOverrides: { briar: { regionKey: "warm_springs" } },
      },
    );

    expect(slots.find((slot) => slot.key === "briar")).toMatchObject({
      visible: false,
      remote: true,
      regionKey: "warm_springs",
      regionLabel: "Warm Springs",
    });
  });

  it("does not present an old event as a current action", () => {
    const slots = derive(
      ["aster"],
      [subject("token-aster")],
      { events: [event("aster", 0, 1)], nowMs: 100_000 },
    );

    expect(slots[0]?.action).toBe("At rest");
  });

  it("uses a neutral involved label for a recipient instead of assigning the actor's verb", () => {
    const interaction = {
      ...event("briar", 9_500, 5),
      actorId: "aster",
      participants: ["aster", "briar"],
    };
    const slots = derive(
      ["aster", "briar"],
      [subject("token-aster")],
      { events: [interaction], nowMs: 10_000 },
    );

    expect(slots.find((slot) => slot.key === "briar")).toMatchObject({
      action: "Recently involved",
      recent: true,
    });
  });
});
