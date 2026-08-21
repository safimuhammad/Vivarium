import { describe, expect, it } from "vitest";

import { deriveActorAppearance } from "./actorAppearance";

describe("deriveActorAppearance", () => {
  it("maps agent_aster to the approved human identity exactly", () => {
    expect(deriveActorAppearance("agent_aster")).toEqual({
      skin: "warm-light",
      face: "soft-round",
      hair: "tousled-brown",
      clothing: "cream-shirt-green-trousers",
      palette: "nirvana-field",
    });
  });

  it("is stable for the full agent ID", () => {
    expect(deriveActorAppearance("agent_river-42")).toEqual(
      deriveActorAppearance("agent_river-42"),
    );
  });

  it("does not treat the category prefix as a semantic class", () => {
    const first = deriveActorAppearance("scholar_same-suffix");
    const second = deriveActorAppearance("fighter_same-suffix");

    expect(first).not.toEqual(second);
    expect(Object.keys(first)).toEqual(["skin", "face", "hair", "clothing", "palette"]);
    expect(Object.values(first).some((value) => value.includes("scholar"))).toBe(false);
    expect(Object.values(second).some((value) => value.includes("fighter"))).toBe(false);
  });

  it("uses the complete ID rather than only its prefix or suffix", () => {
    expect(deriveActorAppearance("agent_aster-1")).not.toEqual(
      deriveActorAppearance("agent_aster-2"),
    );
    expect(deriveActorAppearance("agent_one")).not.toEqual(
      deriveActorAppearance("being_one"),
    );
  });
});
