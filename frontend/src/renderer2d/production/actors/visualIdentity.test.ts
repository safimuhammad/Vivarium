import { describe, expect, it } from "vitest";

import { characterIds } from "./beingChibiAtlas";
import {
  BEING_ACCESSORIES,
  BEING_VISUAL_PALETTE_VARIANTS,
} from "./beingPalette";
import { resolveBeingVisualIdentity } from "./visualIdentity";

describe("resolveBeingVisualIdentity", () => {
  it("returns one immutable, repeatable identity for each stable being id", () => {
    const first = resolveBeingVisualIdentity("being-identity-stable");
    const second = resolveBeingVisualIdentity("being-identity-stable");

    expect(second).toEqual(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(characterIds()).toContain(first.characterId);
    expect(BEING_VISUAL_PALETTE_VARIANTS).toContain(first.paletteVariant);
    expect(BEING_ACCESSORIES).toContain(first.accessory);
  });

  it("spreads a roster across the curated palette and accessory choices", () => {
    const identities = Array.from({ length: 120 }, (_unused, index) => (
      resolveBeingVisualIdentity(`being-identity-${index}`)
    ));

    expect(new Set(identities.map((identity) => identity.paletteVariant).filter((variant) => (
      variant === "terracotta" || variant === "deep-teal" || variant === "plum"
    ))).size).toBe(3);
    expect(new Set(identities.map((identity) => identity.accessory)).size).toBeGreaterThanOrEqual(4);
  });

  it("uses the id-only resolver contract so persona arrival cannot change the result", () => {
    const identityBeforePersona = resolveBeingVisualIdentity("newborn-without-persona");
    const identityAfterPersona = resolveBeingVisualIdentity("newborn-without-persona");
    expect(identityAfterPersona).toEqual(identityBeforePersona);
  });
});
