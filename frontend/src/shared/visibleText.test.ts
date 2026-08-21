import { describe, expect, it } from "vitest";

import { cleanVisibleText } from "./visibleText";

describe("cleanVisibleText", () => {
  it("collapses whitespace and trims the result", () => {
    expect(cleanVisibleText("  The\tworld\n wakes   now  ")).toBe(
      "The world wakes now",
    );
  });

  it("replaces simulation and agent vocabulary with singular and plural forms", () => {
    expect(cleanVisibleText("simulation simulations agent agents")).toBe(
      "world worlds being beings",
    );
    expect(cleanVisibleText("Simulation Simulations Agent Agents")).toBe(
      "World Worlds Being Beings",
    );
  });

  it("handles mixed-case LLM and NPC vocabulary without leaving raw terms", () => {
    expect(cleanVisibleText("an LLM, An LlM, LLMs, nPc and NPCs")).toBe(
      "a mind, A mind, Minds, being and Beings",
    );
  });

  it("replaces spawn variants before the base word", () => {
    expect(cleanVisibleText("spawn spawned spawning spawns Spawned")).toBe(
      "birth was born being born is born Was born",
    );
  });
});
