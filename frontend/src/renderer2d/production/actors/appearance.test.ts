import { describe, expect, it } from "vitest";

import {
  CLOTHING_PALETTES,
  CLOTHING_SILHOUETTES,
  HAIR_RAMPS,
  HAIR_SILHOUETTES,
  PERSONA_ACCENTS,
  RIGS,
  SKIN_RAMPS,
  deriveHumanAppearance,
  type HumanAppearance,
} from "./appearance";

const primaryAppearance = ({ secondaryAccent: _accent, ...primary }: HumanAppearance) => primary;

describe("deriveHumanAppearance", () => {
  it("freezes the exact appearance for one representative complete agent ID", () => {
    expect(deriveHumanAppearance("agent_aster", "quiet observer")).toEqual({
      rig: "human-a",
      skinRamp: "umber",
      hairSilhouette: "short-curls",
      hairRamp: "silver",
      clothingSilhouette: "apron-wrap",
      clothingPalette: "olive",
      secondaryAccent: "thread-clay",
    });
  });

  it("is stable across repeated calls and unrelated derivation order", () => {
    const first = deriveHumanAppearance("agent_aster", "quiet observer");
    deriveHumanAppearance("visitor_vesper", "restless");
    deriveHumanAppearance("mystic_orin");
    expect(deriveHumanAppearance("agent_aster", "quiet observer")).toEqual(first);
  });

  it("uses the complete ID instead of parsing category prefixes or suffixes", () => {
    const original = deriveHumanAppearance("agent_aster");
    const changedPrefix = deriveHumanAppearance("mystic_aster");
    const changedSuffix = deriveHumanAppearance("agent_vesper");

    expect(changedPrefix).not.toEqual(original);
    expect(changedSuffix).not.toEqual(original);
    const inventory = [
      ...RIGS,
      ...SKIN_RAMPS,
      ...HAIR_SILHOUETTES,
      ...HAIR_RAMPS,
      ...CLOTHING_SILHOUETTES,
      ...CLOTHING_PALETTES,
    ];
    expect(inventory.some((value) => /agent|mystic|predator|prey|category/i.test(value))).toBe(false);
  });

  it("keeps every primary channel invariant to persona", () => {
    const blank = deriveHumanAppearance("agent_aster");
    const quiet = deriveHumanAppearance("agent_aster", "quiet observer");
    const fierce = deriveHumanAppearance("agent_aster", "fierce defender");
    expect(primaryAppearance(quiet)).toEqual(primaryAppearance(blank));
    expect(primaryAppearance(fierce)).toEqual(primaryAppearance(blank));
  });

  it("uses persona only for one deterministic non-semantic accent", () => {
    expect(deriveHumanAppearance("agent_aster").secondaryAccent).toBeNull();
    expect(deriveHumanAppearance("agent_aster", "   ").secondaryAccent).toBeNull();
    const accent = deriveHumanAppearance("agent_aster", "quiet observer").secondaryAccent;
    expect(accent).toBe("thread-clay");
    expect(PERSONA_ACCENTS).toContain(accent);
    expect(deriveHumanAppearance("agent_aster", "quiet observer").secondaryAccent).toBe(accent);
  });

  it("publishes the frozen exact 2/6/8/6/8/8 inventories", () => {
    expect(RIGS).toHaveLength(2);
    expect(SKIN_RAMPS).toHaveLength(6);
    expect(HAIR_SILHOUETTES).toHaveLength(8);
    expect(HAIR_RAMPS).toHaveLength(6);
    expect(CLOTHING_SILHOUETTES).toHaveLength(8);
    expect(CLOTHING_PALETTES).toHaveLength(8);
    expect(PERSONA_ACCENTS).toEqual([
      "thread-ochre",
      "thread-teal",
      "thread-plum",
      "thread-clay",
    ]);
    for (const inventory of [
      RIGS,
      SKIN_RAMPS,
      HAIR_SILHOUETTES,
      HAIR_RAMPS,
      CLOTHING_SILHOUETTES,
      CLOTHING_PALETTES,
      PERSONA_ACCENTS,
    ]) expect(Object.isFrozen(inventory)).toBe(true);
  });

  it("rejects empty complete IDs", () => {
    expect(() => deriveHumanAppearance("")).toThrow(/non-empty.*id/i);
    expect(() => deriveHumanAppearance("   ")).toThrow(/non-empty.*id/i);
  });

  it("returns a detached immutable value", () => {
    const first = deriveHumanAppearance("agent_aster", "quiet observer");
    expect(Object.isFrozen(first)).toBe(true);
    expect(() => {
      (first as { skinRamp: string }).skinRamp = "changed";
    }).toThrow();
    expect(deriveHumanAppearance("agent_aster", "quiet observer")).toEqual(first);
  });
});
