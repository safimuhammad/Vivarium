/**
 * @fileoverview End-to-end proof that the four production regions really walk on a torus.
 *
 * The unit proofs live in `navigation.test.ts` (wrapped A* is admissible and optimal) and
 * `wrapSeams.test.ts` (the rim opens only at reciprocal, non-corner seams). This file
 * closes the loop on the REAL recipes: that every region publishes toroidal walk physics,
 * that its rim survives the reciprocity contract, that the ledger hands routing those
 * physics rather than a bounded copy, and — the headline — that a route which crosses a
 * seam is dramatically shorter than the same route forced the long way round.
 */

import { describe, expect, it } from "vitest";

import type { RegionSnapshot } from "../../../app/schemas";
import { createRegionMapIdentity } from "../maps/RegionMapIdentity";
import { createRegionMapRecipe, type RegionMapRecipeV1 } from "../maps/RegionMapRecipe";
import { createNirvanaRegionMapRecipe } from "../nirvana/NirvanaRegionMapRecipe";
import { PlacementLedger } from "../placement/PlacementLedger";
import { createWarmSpringsRegionMapRecipe } from "../warmSprings/WarmSpringsRegionMapRecipe";
import { findNavigationPath } from "./navigation";
import { wrapSeamViolations } from "./wrapSeams";

const RUN_SEED = 401;

function makeRegion(name: string, description: string, connections: string[]): RegionSnapshot {
  return {
    name,
    description,
    connections,
    energy_rate: name === "nirvana_west" ? 0.05 : 0.2,
    materials_rate: name === "nirvana_west" ? 0 : 0.2,
    current_energy: 40,
    current_materials: 40,
    max_energy: 100,
    max_materials: 100,
  } as RegionSnapshot;
}

const world: readonly RegionSnapshot[] = [
  makeRegion("nirvana", "a once-heavenly landscape, now thinning and picked-over", ["warm_springs", "nirvana_east", "nirvana_west"]),
  makeRegion("nirvana_east", "a struggling, near-barren stretch", ["warm_springs", "nirvana"]),
  makeRegion("nirvana_west", "a nuclear wasteland, all but dead", ["warm_springs", "nirvana"]),
  makeRegion("warm_springs", "hot spring lakes", ["nirvana_west", "nirvana_east", "nirvana"]),
];

function recipeFor(region: RegionSnapshot): RegionMapRecipeV1 {
  const identity = createRegionMapIdentity(RUN_SEED, region, world);
  if (region.name === "nirvana") return createNirvanaRegionMapRecipe(identity);
  if (region.name === "warm_springs") return createWarmSpringsRegionMapRecipe(identity);
  return createRegionMapRecipe(identity);
}

/** Every rim tile the region publishes as walkable, as `"column,row"`. */
function openRimTiles(recipe: RegionMapRecipeV1): readonly string[] {
  const { columns, rows, collision } = recipe.grid;
  const open: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const rim = row === 0 || column === 0 || row === rows - 1 || column === columns - 1;
      if (rim && collision[row * columns + column] === 0) open.push(`${column},${row}`);
    }
  }
  return open;
}

describe("toroidal walk physics across the production world", () => {
  it("publishes toroidal walk physics for all four regions, with a legal rim", () => {
    for (const region of world) {
      const recipe = recipeFor(region);
      expect(recipe.grid.topology, region.name).toBe("toroidal");
      expect(wrapSeamViolations(recipe.grid), `${region.name} rim reciprocity`).toEqual([]);
      // One reciprocal pair per axis: four walkable rim tiles, never a corner.
      expect(openRimTiles(recipe), `${region.name} open rim`).toHaveLength(4);
    }
  });

  it("opens Nirvana at exactly its two PROVED road-port seams and nowhere else", () => {
    // `assertToroidalSeams` proves column 0's west ports equal column N-1's east ports and
    // likewise north/south; `wrapSeamCandidates` publishes those pairs. These four tiles
    // are that published set, and they are also exactly the four road tiles the old
    // blanket rim closure used to block (see NirvanaLandmarkRelocation.test.ts).
    expect([...openRimTiles(recipeFor(world[0]!))].sort())
      .toEqual(["0,14", "84,0", "84,95", "95,14"]);
  });

  it("routes a seam crossing far more cheaply than the long way round, in every region", () => {
    const measured: Record<string, Readonly<{ across: number; around: number }>> = {};
    for (const region of world) {
      const recipe = recipeFor(region);
      const westSeam = openRimTiles(recipe).find((key) => key.startsWith("0,"));
      expect(westSeam, `${region.name} has a west/east seam`).toBeDefined();
      const row = Number(westSeam!.split(",")[1]);
      const start = { column: 1, row };
      const goal = { column: recipe.grid.columns - 2, row };

      const across = findNavigationPath(recipe.grid, { start, goal });
      // The SAME collision bytes with the wrap switched off — an honest control, so the
      // comparison isolates topology rather than also changing the ground.
      const around = findNavigationPath(
        { ...recipe.grid, topology: "bounded" },
        { start, goal },
      );

      expect(across.status, region.name).toBe("reached");
      expect(around.status, region.name).toBe("reached");
      expect(across.tiles.length, `${region.name} crosses the seam`).toBeLessThan(around.tiles.length);
      // (1,r) -> (0,r) -> (N-1,r) -> (N-2,r): four tiles, three steps, whatever the region.
      expect(across.tiles, region.name).toHaveLength(4);
      expect(across.tiles, region.name).toContainEqual({ column: 0, row });
      expect(across.tiles, region.name).toContainEqual({ column: recipe.grid.columns - 1, row });
      measured[region.name] = { across: across.tiles.length, around: around.tiles.length };
    }

    // Recorded rather than merely asserted: these are the numbers the route diagram in
    // `scratchpad/being-sprite-evidence/torus-physics/` is drawn from.
    expect(measured).toEqual({
      nirvana: { across: 4, around: 100 },
      nirvana_east: { across: 4, around: 158 },
      nirvana_west: { across: 4, around: 160 },
      warm_springs: { across: 4, around: 168 },
    });
  });

  it("hands routing the region's real physics through the placement ledger", () => {
    const recipes = world.map(recipeFor);
    const ledger = PlacementLedger.reconstruct(recipes, { homes: [], agents: [] });
    for (const region of world) {
      expect(ledger.navigationGridFor(region.name)?.topology, region.name).toBe("toroidal");
    }
  });

  it("keeps a wrapped route's waypoints continuous so the crossing can be drawn", () => {
    const recipe = recipeFor(world[0]!);
    const route = findNavigationPath(recipe.grid, {
      start: { column: 1, row: 14 },
      goal: { column: 95, row: 14 },
    });
    expect(route.status).toBe("reached");
    for (let index = 1; index < route.waypoints.length; index += 1) {
      const previous = route.waypoints[index - 1]!;
      const current = route.waypoints[index]!;
      expect(Math.abs(current.x - previous.x) + Math.abs(current.y - previous.y)).toBe(32);
    }
    // The being leaves the region rect westward rather than teleporting east.
    expect(route.waypoints.some(({ x }) => x < 0)).toBe(true);
  });
});
