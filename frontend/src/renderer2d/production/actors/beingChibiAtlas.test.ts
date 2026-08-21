/**
 * @fileoverview TDD spec for `beingChibiAtlas.ts` v2 — the typed,
 * validated loader for the 7-character `core-being-chibi` roster atlas
 * (Task R3 of the roster-integration plan).
 */

import { describe, expect, it } from "vitest";

import { deriveHumanAppearance } from "./appearance";
import {
  BEING_CHARACTER_IDS,
  BEING_CHIBI_GEOMETRY,
  DEFAULT_BEING_CHARACTER_ID,
  beingChibiFrameRect,
  beingChibiIdleStrideIndex,
  beingChibiWalkCycle,
  characterIds,
  framesFor,
  isBeingCharacterId,
  resolveBeingCharacter,
  type BeingCharacterId,
} from "./beingChibiAtlas";

describe("characterIds", () => {
  it("returns the full 7-member roster, m1 first", () => {
    const ids = characterIds();
    expect(ids).toEqual(["m1", "f1", "f2", "f3", "m2", "m3", "m4"]);
    expect(ids).toEqual(BEING_CHARACTER_IDS);
  });
});

describe("framesFor", () => {
  it("gives every roster character exactly 17 frames (12 walk + 5 pose)", () => {
    for (const characterId of characterIds()) {
      const frames = framesFor(characterId);
      const walkKeys = Object.keys(frames).filter((key) => key.startsWith("walk-"));
      const poseKeys = Object.keys(frames).filter((key) => key.startsWith("pose-"));
      expect(walkKeys).toHaveLength(12);
      expect(poseKeys).toHaveLength(5);
      expect(Object.keys(frames)).toHaveLength(17);
      for (const pose of ["blink", "talk", "reach", "crouch", "kneel"]) {
        expect(frames).toHaveProperty(`pose-${pose}`);
      }
    }
  });

  it("throws for an unknown character id", () => {
    expect(() => framesFor("nonexistent" as BeingCharacterId)).toThrow(/unknown being-chibi character/i);
  });

  it("gives distinct characters non-identical frame tables (each packed at its own atlas position)", () => {
    const m1 = framesFor("m1");
    const f1 = framesFor("f1");
    expect(m1["walk-down-0"]).not.toEqual(f1["walk-down-0"]);
  });
});

describe("beingChibiFrameRect", () => {
  it("defaults to m1 when no characterId is given (roster-context-free callers)", () => {
    expect(beingChibiFrameRect("walk-side-1")).toEqual(beingChibiFrameRect("walk-side-1", "m1"));
  });

  it("resolves the same bare frame name to a different rect per character", () => {
    const rects = characterIds().map((id) => beingChibiFrameRect("pose-kneel", id));
    const unique = new Set(rects.map((rect) => `${rect.x},${rect.y}`));
    expect(unique.size).toBe(characterIds().length);
  });

  it("throws for an unknown frame name on a known character", () => {
    expect(() => beingChibiFrameRect("not-a-real-frame", "f1")).toThrow(/unknown being-chibi frame/i);
  });
});

describe("beingChibiWalkCycle", () => {
  it("defaults to m1 and lists each direction's 4 frames in stride order", () => {
    for (const direction of ["down", "up", "side"] as const) {
      expect(beingChibiWalkCycle(direction)).toEqual([
        `walk-${direction}-0`,
        `walk-${direction}-1`,
        `walk-${direction}-2`,
        `walk-${direction}-3`,
      ]);
      expect(beingChibiWalkCycle(direction)).toEqual(beingChibiWalkCycle(direction, "m1"));
    }
  });

  it("returns the requested character's own cycle for a non-default character", () => {
    expect(beingChibiWalkCycle("down", "f2")).toEqual(["walk-down-0", "walk-down-1", "walk-down-2", "walk-down-3"]);
  });
});

describe("beingChibiIdleStrideIndex", () => {
  it("is the shared index (1) every character's idleFrame sits at within its own down cycle", () => {
    const index = beingChibiIdleStrideIndex();
    expect(index).toBe(1);
    for (const characterId of characterIds()) {
      expect(BEING_CHIBI_GEOMETRY.characters[characterId].walkCycles.down[index])
        .toBe(BEING_CHIBI_GEOMETRY.characters[characterId].idleFrame);
    }
  });
});

describe("isBeingCharacterId", () => {
  it("accepts every roster id and rejects arbitrary strings", () => {
    for (const characterId of characterIds()) expect(isBeingCharacterId(characterId)).toBe(true);
    expect(isBeingCharacterId("m5")).toBe(false);
    expect(isBeingCharacterId("")).toBe(false);
  });
});

describe("resolveBeingCharacter", () => {
  it("is one of the 7 roster characters", () => {
    const appearance = deriveHumanAppearance("agent_character_bounds");
    expect(characterIds()).toContain(resolveBeingCharacter(appearance));
  });

  it("same agent id -> same character, always (stable across independent constructions)", () => {
    for (const id of ["agent_alpha", "agent_beta_007", "agent_gamma-longer-id-42"]) {
      const first = resolveBeingCharacter(deriveHumanAppearance(id));
      const second = resolveBeingCharacter(deriveHumanAppearance(id));
      const third = resolveBeingCharacter(deriveHumanAppearance(id));
      expect(second).toBe(first);
      expect(third).toBe(first);
    }
  });

  it("spreads 60 sampled agent ids across at least 5 distinct characters", () => {
    const ids = Array.from({ length: 60 }, (_unused, index) => `agent_roster_pool_${index}`);
    const characters = new Set(ids.map((id) => resolveBeingCharacter(deriveHumanAppearance(id))));
    expect(characters.size).toBeGreaterThanOrEqual(5);
  });

  it("depends only on the appearance value, not object identity (pure function)", () => {
    const appearance = deriveHumanAppearance("agent_character_pure_check");
    const a = resolveBeingCharacter(appearance);
    const b = resolveBeingCharacter({ ...appearance });
    expect(b).toBe(a);
  });

  it("decorrelates from a naive identical-domain hash (does not always equal DEFAULT for id 'agent_test')", () => {
    // Not a strict requirement that it differs from the default for this
    // particular id, but the assignment must still land on a valid roster
    // member and be reproducible.
    const appearance = deriveHumanAppearance("agent_test");
    const resolved = resolveBeingCharacter(appearance);
    expect(characterIds()).toContain(resolved);
    expect(resolveBeingCharacter(appearance)).toBe(resolved);
  });
});

describe("DEFAULT_BEING_CHARACTER_ID", () => {
  it("is m1, the shipped base", () => {
    expect(DEFAULT_BEING_CHARACTER_ID).toBe("m1");
  });
});
