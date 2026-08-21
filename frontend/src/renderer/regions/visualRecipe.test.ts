import { describe, expect, it } from "vitest";
import type { RegionSnapshot } from "../../app/schemas";
import {
  deriveRegionVisualRecipe,
  regionVisualRecipeHash,
} from "./visualRecipe";

const region = (description: string, currentEnergy = 15): RegionSnapshot => ({
  name: "nirvana_west",
  description,
  connections: ["nirvana", "warm_springs"],
  energy_rate: 0.05,
  materials_rate: 0,
  current_energy: currentEnergy,
  current_materials: 0,
  max_energy: 50,
  max_materials: 10,
});

describe("deriveRegionVisualRecipe", () => {
  it.each([
    ["a nuclear wasteland, all but dead", "ash_waste"],
    ["hot spring lakes and green terraces", "spring_terraces"],
    ["a struggling, near-barren stretch", "dry_scrub"],
    ["once-heavenly, now thinning and picked-over", "worn_heartland"],
    ["an unfamiliar coast", "neutral_temperate"],
  ] as const)("maps %s to %s", (description, archetype) => {
    expect(deriveRegionVisualRecipe(region(description)).archetype).toBe(archetype);
  });

  it.each([
    ["an all—but—dead plain", "ash_waste"],
    ["HOT\u00a0SPRING lakes", "spring_terraces"],
    ["a near‑barren stretch", "dry_scrub"],
    ["once…heavenly and picked/over", "worn_heartland"],
  ] as const)("normalizes punctuation in %s", (description, archetype) => {
    expect(deriveRegionVisualRecipe(region(description)).archetype).toBe(archetype);
  });

  it("applies archetype rules in their canonical precedence", () => {
    const overlapping = region(
      "a nuclear wasteland beside hot springs, barren and picked-over",
    );
    expect(deriveRegionVisualRecipe(overlapping).archetype).toBe("ash_waste");
  });

  it("keeps wasteland identity when its energy pool is full", () => {
    const scarce = deriveRegionVisualRecipe(region("nuclear wasteland", 5));
    const full = deriveRegionVisualRecipe(region("nuclear wasteland", 50));
    expect(full.archetype).toBe("ash_waste");
    expect(full.identity).toEqual(scarce.identity);
    expect(full.condition.energyRatio).toBe(1);
  });

  it("clamps condition ratios and handles zero capacity", () => {
    const recipe = deriveRegionVisualRecipe({
      ...region("an unfamiliar coast", 75),
      current_materials: -5,
      max_materials: 0,
    });
    expect(recipe.condition).toEqual({ energyRatio: 1, materialsRatio: 0 });
  });

  it("hashes recipes independently of input ordering", () => {
    const left = deriveRegionVisualRecipe(region("nuclear wasteland"));
    const right = deriveRegionVisualRecipe({
      ...region("hot spring lakes"),
      name: "warm_springs",
    });
    expect(regionVisualRecipeHash([left, right])).toBe(
      regionVisualRecipeHash([right, left]),
    );
  });

  it("hashes duplicate region IDs independently of input ordering", () => {
    const scarce = deriveRegionVisualRecipe(region("nuclear wasteland", 5));
    const full = deriveRegionVisualRecipe(region("nuclear wasteland", 50));
    expect(regionVisualRecipeHash([scarce, full])).toBe(
      regionVisualRecipeHash([full, scarce]),
    );
  });
});
