/**
 * The acceptance bar for the approved Warm Springs "Great Terrace", asserted on the REAL
 * production recipe rather than on a fixture: the geometry these tests measure is the
 * geometry the world is built from.
 *
 * Every number here was measured before it was asserted
 * (`.superpowers/sdd/warm-springs-live-report.md`), and two real defects were found that
 * way — visual-path shoulder cells being closed by terrain, and orphan pockets that exist
 * only in the COMPOSED collision. Both are covered below so they cannot come back.
 */

import { describe, expect, it } from "vitest";

import type { RegionSnapshot } from "../../../app/schemas";
import { tileCenter } from "../../map/regionMap";
import { createRegionMapIdentity } from "../maps/RegionMapIdentity";
import {
  createRegionMapRecipe,
  parseRegionMapRecipe,
  serializeRegionMapRecipe,
  type RegionMapRecipeV1,
} from "../maps/RegionMapRecipe";
import { createProductionRegionMapRecipe } from "../maps/ProductionRegionMapRecipe";
import { firstBlockedGroundTile } from "../navigation/groundTerrain";
import { findNavigationPath, type NavigationGrid } from "../navigation/navigation";
import { shelterRenderRect } from "../productionGeometry";
import {
  createWarmSpringsRegionMapRecipe,
  warmSpringsAuthoredSceneSidecar,
  warmSpringsProtectionFromRecipe,
} from "./WarmSpringsRegionMapRecipe";

const TILE_SIZE = 32;
const SEEDS: readonly number[] = [401, 229, 7, 1337];

function makeRegion(
  name: string,
  description: string,
  connections: readonly string[],
): RegionSnapshot {
  return {
    name,
    description,
    connections: [...connections],
    energy_rate: 0.2,
    materials_rate: 0.2,
    current_energy: 40,
    current_materials: 40,
    max_energy: 100,
    max_materials: 100,
  };
}

/** The real four-region production world (`config/world.yaml`). */
const WORLD: readonly RegionSnapshot[] = [
  makeRegion("nirvana", "a once-heavenly landscape, now thinning and picked-over", ["warm_springs", "nirvana_east", "nirvana_west"]),
  makeRegion("nirvana_east", "a struggling, near-barren stretch", ["warm_springs", "nirvana"]),
  makeRegion("warm_springs", "hot spring lakes — the least-poor refuge, but no longer plentiful", ["nirvana_west", "nirvana_east", "nirvana"]),
  makeRegion("nirvana_west", "a nuclear wasteland, all but dead", ["warm_springs", "nirvana"]),
];
const SPRINGS = WORLD[2]!;

function springsIdentity(seed: number): ReturnType<typeof createRegionMapIdentity> {
  return createRegionMapIdentity(seed, SPRINGS, WORLD);
}

/** Component sizes of a collision mask, largest first. */
function componentSizes(grid: NavigationGrid): number[] {
  const seen = new Uint8Array(grid.collision.length);
  const sizes: number[] = [];
  for (let start = 0; start < grid.collision.length; start += 1) {
    if (grid.collision[start] === 1 || seen[start] === 1) continue;
    const stack = [start];
    seen[start] = 1;
    let size = 0;
    while (stack.length > 0) {
      const index = stack.pop()!;
      size += 1;
      const column = index % grid.columns;
      const row = Math.floor(index / grid.columns);
      for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const c = column + dc;
        const r = row + dr;
        if (c < 0 || r < 0 || c >= grid.columns || r >= grid.rows) continue;
        const next = r * grid.columns + c;
        if (grid.collision[next] === 1 || seen[next] === 1) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }
    sizes.push(size);
  }
  return sizes.sort((left, right) => right - left);
}

function shelterPlotsLost(recipe: RegionMapRecipeV1): string[] {
  const lost: string[] = [];
  for (const plot of recipe.shelterPlots) {
    const rect = shelterRenderRect(plot.tile);
    let clear = true;
    for (
      let row = Math.floor(rect.y / TILE_SIZE);
      row <= Math.floor((rect.y + rect.height - 1) / TILE_SIZE);
      row += 1
    ) {
      for (
        let column = Math.floor(rect.x / TILE_SIZE);
        column <= Math.floor((rect.x + rect.width - 1) / TILE_SIZE);
        column += 1
      ) {
        if (column < 0 || row < 0 || column >= recipe.grid.columns || row >= recipe.grid.rows
          || recipe.grid.collision[row * recipe.grid.columns + column] === 1) clear = false;
      }
    }
    if (!clear) lost.push(plot.id);
  }
  return lost;
}

describe("WarmSpringsRegionMapRecipe", () => {
  it("rejects any identity that is not exact warm_springs", () => {
    expect(() => createWarmSpringsRegionMapRecipe(createRegionMapIdentity(401, WORLD[0]!, WORLD)))
      .toThrow(/exact region warm_springs/);
  });

  it("carries the exact presentation profile and its authored-scene sidecar", () => {
    const recipe = createWarmSpringsRegionMapRecipe(springsIdentity(401));
    expect(recipe.presentationProfile).toEqual({
      kind: "warm-springs-v1",
      atlasProfileVersion: 2,
      staticSceneHash: expect.stringMatching(/^[0-9a-f]{8}$/) as unknown as string,
    });
    const authored = warmSpringsAuthoredSceneSidecar(recipe);
    expect(authored).not.toBeNull();
    expect(authored!.sceneHash).toBe(recipe.presentationProfile!.staticSceneHash);
    expect(authored!.scene.columns).toBe(96);
    expect(authored!.scene.rows).toBe(96);
  });

  it("is deterministic in tiles, collision and scene hash", () => {
    const first = createWarmSpringsRegionMapRecipe(springsIdentity(401));
    const second = createWarmSpringsRegionMapRecipe(springsIdentity(401));
    expect(second.presentationProfile!.staticSceneHash)
      .toBe(first.presentationProfile!.staticSceneHash);
    expect([...second.grid.collision]).toEqual([...first.grid.collision]);
    expect(second.grid.collision).not.toBe(first.grid.collision);
  });

  /**
   * The sidecar is keyed by recipe OBJECT IDENTITY, so a clone that does not carry it
   * forward loses the scene and the provider fails closed — the whole region stops
   * rendering. `registerRegionMapRecipeCloneTransfer` is what prevents that, and this is
   * the test that keeps it wired.
   */
  it("carries its authored scene across a trusted parse clone", () => {
    const identity = springsIdentity(401);
    const recipe = createWarmSpringsRegionMapRecipe(identity);
    const parsed = parseRegionMapRecipe(
      serializeRegionMapRecipe(recipe),
      identity,
      () => createProductionRegionMapRecipe(identity),
    );
    expect(parsed).not.toBe(recipe);
    const authored = warmSpringsAuthoredSceneSidecar(parsed);
    expect(authored).not.toBeNull();
    expect(authored!.sceneHash).toBe(recipe.presentationProfile!.staticSceneHash);
  });

  it("protects every mechanics, route, story and scenery cell the recipe declares", () => {
    const generic = createRegionMapRecipe(springsIdentity(401));
    const protection = warmSpringsProtectionFromRecipe(generic);
    const isProtected = (column: number, row: number): boolean =>
      protection.protected[row * protection.columns + column] === 1;

    for (const plot of generic.shelterPlots) {
      expect(isProtected(plot.tile.column, plot.tile.row), plot.id).toBe(true);
      expect(isProtected(plot.door.column, plot.door.row), `${plot.id} door`).toBe(true);
    }
    for (const gate of generic.gates) {
      expect(isProtected(gate.tile.column, gate.tile.row)).toBe(true);
    }
    // PASSIVE scenery only. A blocking placement is already hard collision in the generic
    // recipe, so terrain closing its tile changes nothing — while protecting it would
    // punch a hole in the channel for no gain.
    for (const placement of generic.staticScenery) {
      if (placement.blocksMovement) continue;
      expect(isProtected(placement.tile.column, placement.tile.row), placement.id).toBe(true);
    }
    // Visual-path shoulders: `collisionBehavior: "visual-only"` but still required to be
    // collision-OPEN. Two of four sampled seeds failed to parse before these were protected.
    for (const path of generic.visualPathCompositions) {
      for (const cell of [...path.centerlineCells, ...path.shoulderCells, ...path.clearingCells]) {
        expect(isProtected(cell.column, cell.row), `${path.id} @ ${cell.column},${cell.row}`)
          .toBe(true);
      }
    }
    for (let index = 0; index < protection.protected.length; index += 1) {
      if (generic.pathMask[index] === 1 || generic.soilMask[index] === 1) {
        expect(protection.protected[index]).toBe(1);
      }
    }
  });

  describe.each(SEEDS)("at run seed %i", (seed) => {
    const identity = springsIdentity(seed);
    const generic = createRegionMapRecipe(identity);
    const recipe = createWarmSpringsRegionMapRecipe(identity);

    it("loses none of the 128 shelter plots", () => {
      expect(recipe.shelterPlots).toHaveLength(128);
      expect(shelterPlotsLost(recipe)).toEqual([]);
    });

    it("closes no mechanics tile, staging point, route, soil or passive scenery cell", () => {
      const closed = (column: number, row: number): boolean =>
        recipe.grid.collision[row * recipe.grid.columns + column] === 1;
      const mechanics = [
        ...recipe.arrivalAnchors, ...recipe.spawnAnchors, ...recipe.socialAnchors,
        ...recipe.resourceAnchors.energy, ...recipe.resourceAnchors.materials,
        ...recipe.stagingAnchors, ...recipe.gates.map((gate) => gate.tile),
        ...recipe.shelterPlots.flatMap((plot) => [plot.tile, plot.door]),
      ];
      expect(mechanics.filter((tile) => closed(tile.column, tile.row))).toEqual([]);
      expect(recipe.stagingPoints.filter((point) =>
        closed(Math.floor(point.x / TILE_SIZE), Math.floor(point.y / TILE_SIZE)))).toEqual([]);
      expect([...recipe.pathMask].filter((value, index) =>
        value === 1 && recipe.grid.collision[index] === 1)).toEqual([]);
      expect([...recipe.soilMask].filter((value, index) =>
        value === 1 && recipe.grid.collision[index] === 1)).toEqual([]);
      expect(recipe.staticScenery.filter((placement) =>
        !placement.blocksMovement && closed(placement.tile.column, placement.tile.row)))
        .toEqual([]);
    });

    /**
     * RELATIVE, not absolute — and stated over the ground the world actually needs.
     *
     * The generic Warm Springs region is already two walkable components (the mechanics
     * guard ring separates the settled core from the outer margin except at the four
     * gates), plus 1-3 tile scraps on some seeds. Demanding one absolute component would
     * demand this terrain fix a region shape it did not create. What terrain MUST hold is
     * that every protected tile stays mutually reachable within the component it started
     * in: no anchor, plot, door, staging point, route or authored placement is ever cut
     * off from any other. Unreachable scraps of plain ground carry nothing and are
     * allowed, exactly as the generic region already has them.
     */
    it("keeps every protected tile mutually reachable within its own component", () => {
      const protection = warmSpringsProtectionFromRecipe(generic);
      const label = (grid: typeof recipe.grid): Int32Array => {
        const labels = new Int32Array(grid.collision.length).fill(-1);
        let next = 0;
        for (let start = 0; start < grid.collision.length; start += 1) {
          if (grid.collision[start] === 1 || labels[start] !== -1) continue;
          const stack = [start];
          labels[start] = next;
          while (stack.length > 0) {
            const index = stack.pop()!;
            const column = index % grid.columns;
            const row = Math.floor(index / grid.columns);
            for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
              const c = column + dc;
              const r = row + dr;
              if (c < 0 || r < 0 || c >= grid.columns || r >= grid.rows) continue;
              const neighbour = r * grid.columns + c;
              if (grid.collision[neighbour] === 1 || labels[neighbour] !== -1) continue;
              labels[neighbour] = next;
              stack.push(neighbour);
            }
          }
          next += 1;
        }
        return labels;
      };
      const before = label(generic.grid);
      const after = label(recipe.grid);
      const groups = new Map<number, Set<number>>();
      for (let index = 0; index < protection.protected.length; index += 1) {
        if (protection.protected[index] !== 1) continue;
        // A protected tile the GENERIC recipe already closed (a story cell coinciding with
        // blocking scenery, say) is not this terrain's business; terrain only ever adds.
        if (generic.grid.collision[index] === 1) continue;
        expect(recipe.grid.collision[index], `protected tile ${index} closed`).toBe(0);
        const key = before[index]!;
        const seen = groups.get(key) ?? new Set<number>();
        seen.add(after[index]!);
        groups.set(key, seen);
      }
      for (const [key, seen] of groups) {
        expect([...seen], `pre-existing component ${key} was split`).toHaveLength(1);
      }
    });

    it("only ever closes ground, never re-opens what the recipe already closed", () => {
      let opened = 0;
      for (let index = 0; index < generic.grid.collision.length; index += 1) {
        if (generic.grid.collision[index] === 1 && recipe.grid.collision[index] === 0) opened += 1;
      }
      expect(opened).toBe(0);
    });

    it("passes the full generic recipe validation on parse", () => {
      expect(() => parseRegionMapRecipe(
        serializeRegionMapRecipe(recipe),
        identity,
        () => createProductionRegionMapRecipe(identity),
      )).not.toThrow();
    });

    /**
     * The collision-seam proof, in BOTH axes. Nirvana's integration witnessed twice that
     * terrain-as-exclusion-rects makes a crossing's usability depend on its ORIENTATION —
     * an east-west deck loses 6 of 7 tiles because the standing envelope sits 46 px above
     * the feet. Terrain reaches collision through `grid.collision` here, so the real
     * navigator walks every deck tile of both crossings and the destination-tile check
     * (`firstBlockedGroundTile`) accepts every waypoint.
     */
    it("lets the real navigator cross both boardwalks, in both axes, on every deck tile", () => {
      const scene = warmSpringsAuthoredSceneSidecar(recipe)!.scene;
      expect(scene.boardwalks.map((walk) => walk.axis).sort())
        .toEqual(["east-west", "north-south"]);
      for (const walk of scene.boardwalks) {
        const horizontal = walk.axis === "east-west";
        const first = walk.deck[0]!;
        const last = walk.deck[walk.deck.length - 1]!;
        const start = horizontal
          ? { column: first.column - 1, row: first.row }
          : { column: first.column, row: first.row - 1 };
        const goal = horizontal
          ? { column: last.column + 1, row: last.row }
          : { column: last.column, row: last.row + 1 };
        const route = findNavigationPath(recipe.grid, { start, goal });
        expect(route.status, walk.id).toBe("reached");
        const onRoute = new Set((route.tiles ?? []).map((tile) => `${tile.column},${tile.row}`));
        for (const deck of walk.deck) {
          expect(onRoute.has(`${deck.column},${deck.row}`), `${walk.id} deck ${deck.column},${deck.row}`)
            .toBe(true);
        }
        expect(
          firstBlockedGroundTile(recipe.grid, (route.tiles ?? []).map(tileCenter)),
          `${walk.id} seam`,
        ).toBeNull();
      }
    });

    it("displaces and retires nothing the generic recipe authored", () => {
      expect(recipe.staticScenery).toEqual(generic.staticScenery);
      expect(recipe.scenicClusters).toEqual(generic.scenicClusters);
      expect(recipe.scenicLandmarks).toEqual(generic.scenicLandmarks);
      expect(recipe.storyNeighborhoods).toEqual(generic.storyNeighborhoods);
      expect(recipe.visualPathCompositions).toEqual(generic.visualPathCompositions);
      expect(recipe.terrainPatches).toEqual(generic.terrainPatches);
      expect(recipe.animatedEnvironment).toEqual(generic.animatedEnvironment);
      expect(recipe.districts).toEqual(generic.districts);
    });
  });
});
