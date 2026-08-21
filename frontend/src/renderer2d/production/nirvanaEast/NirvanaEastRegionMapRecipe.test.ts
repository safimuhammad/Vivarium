/**
 * The acceptance bar for the approved Nirvana East "Butte Country", asserted on the REAL
 * production recipe rather than on a fixture: the geometry these tests measure is the
 * geometry the world is built from.
 *
 * Every number here was measured before it was asserted
 * (`.superpowers/sdd/nirvana-east-live-report.md`). Two invariants are stated more
 * carefully than the brief asked, because the before-shot measured the region and found
 * the naive form false:
 *
 * 1. **"Exactly one walkable component" is not the honest bar here.** The GENERIC Nirvana
 *    East region is already two — 4,648 and 3,844 tiles — on both bounded and toroidal
 *    adjacency, before this work exists, because the mechanics guard ring separates the
 *    settled core from the outer margin except at the four gates. So the invariant is
 *    stated where it means something: every protected tile stays mutually reachable
 *    within the component it started in, and no pre-existing component is split.
 * 2. **The region is TOROIDAL.** Its walk seams are re-derived after the terrain unions
 *    in, so `wrapSeamViolations` and a real wrapped route are both asserted.
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
import { firstBlockedGroundTile } from "../navigation/groundTerrain";
import { findNavigationPath, type NavigationGrid } from "../navigation/navigation";
import { wrapSeamViolations } from "../navigation/wrapSeams";
import { shelterRenderRect } from "../productionGeometry";
import {
  createNirvanaEastRegionMapRecipe,
  nirvanaEastAuthoredSceneSidecar,
  nirvanaEastProtectionFromRecipe,
} from "./NirvanaEastRegionMapRecipe";
import {
  nirvanaEastCornerSeamMismatches,
  NIRVANA_EAST_LANDFORM_TIERS,
  NIRVANA_EAST_LANDFORM_VARIANTS,
} from "./NirvanaEastTerrainField";

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
const EAST = WORLD[1]!;

function eastIdentity(seed: number): ReturnType<typeof createRegionMapIdentity> {
  return createRegionMapIdentity(seed, EAST, WORLD);
}

/** Connected-component labels of a collision mask under the grid's own walk topology. */
function labelComponents(grid: NavigationGrid): { labels: Int32Array; sizes: number[] } {
  const toroidal = grid.topology === "toroidal";
  const labels = new Int32Array(grid.collision.length).fill(-1);
  const sizes: number[] = [];
  let label = 0;
  for (let start = 0; start < grid.collision.length; start += 1) {
    if (grid.collision[start] === 1 || labels[start] !== -1) continue;
    const stack = [start];
    labels[start] = label;
    let size = 0;
    while (stack.length > 0) {
      const index = stack.pop()!;
      size += 1;
      const column = index % grid.columns;
      const row = Math.floor(index / grid.columns);
      for (const [dc, dr] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        let c = column + dc;
        let r = row + dr;
        if (toroidal) {
          c = ((c % grid.columns) + grid.columns) % grid.columns;
          r = ((r % grid.rows) + grid.rows) % grid.rows;
        } else if (c < 0 || r < 0 || c >= grid.columns || r >= grid.rows) continue;
        const next = r * grid.columns + c;
        if (grid.collision[next] === 1 || labels[next] !== -1) continue;
        labels[next] = label;
        stack.push(next);
      }
    }
    sizes.push(size);
    label += 1;
  }
  return { labels, sizes };
}

/** Every tile the recipe's own mechanics, routes, story and passive scenery need open. */
function protectedIndices(recipe: RegionMapRecipeV1): number[] {
  const protection = nirvanaEastProtectionFromRecipe(recipe);
  const indices: number[] = [];
  for (let index = 0; index < protection.protected.length; index += 1) {
    if (protection.protected[index] === 1) indices.push(index);
  }
  return indices;
}

describe("createNirvanaEastRegionMapRecipe", () => {
  it("rejects any identity that is not exact nirvana_east", () => {
    expect(() => createNirvanaEastRegionMapRecipe(createRegionMapIdentity(401, WORLD[0]!, WORLD)))
      .toThrow(/exact region nirvana_east/i);
  });

  it("carries the exact presentation profile and its authored-scene sidecar", () => {
    const recipe = createNirvanaEastRegionMapRecipe(eastIdentity(401));
    expect(recipe.presentationProfile).toMatchObject({
      kind: "nirvana-east-v1",
      atlasProfileVersion: 2,
    });
    expect(recipe.presentationProfile?.staticSceneHash).toMatch(/^[0-9a-f]{8}$/);
    const authored = nirvanaEastAuthoredSceneSidecar(recipe);
    expect(authored).not.toBeNull();
    expect(authored!.sceneHash).toBe(recipe.presentationProfile?.staticSceneHash);
    expect(recipe.kit).toBe("dry-scrub");
  });

  it("is deterministic in tiles, collision and scene hash", () => {
    const first = createNirvanaEastRegionMapRecipe(eastIdentity(401));
    const second = createNirvanaEastRegionMapRecipe(eastIdentity(401));
    expect(serializeRegionMapRecipe(second)).toBe(serializeRegionMapRecipe(first));
    // Isolated mutable identity: consumers rely on not sharing a collision buffer.
    expect(second.grid.collision).not.toBe(first.grid.collision);
  });

  it("carries its authored scene across a trusted parse clone", () => {
    const identity = eastIdentity(401);
    const recipe = createNirvanaEastRegionMapRecipe(identity);
    const parsed = parseRegionMapRecipe(
      serializeRegionMapRecipe(recipe),
      identity,
      () => createNirvanaEastRegionMapRecipe(identity),
    );
    // An identity-keyed sidecar fails CLOSED: a clone that loses it stops the region
    // rendering entirely, so this is the test that must never be deleted.
    expect(nirvanaEastAuthoredSceneSidecar(parsed)).not.toBeNull();
    expect(nirvanaEastAuthoredSceneSidecar(parsed)!.sceneHash)
      .toBe(recipe.presentationProfile?.staticSceneHash);
  });

  it("protects every mechanics, route, story and scenery cell the recipe declares", () => {
    const generic = createRegionMapRecipe(eastIdentity(401));
    const protection = nirvanaEastProtectionFromRecipe(generic);
    const isProtected = (column: number, row: number): boolean => (
      protection.protected[row * generic.grid.columns + column] === 1
    );
    for (const plot of generic.shelterPlots) {
      const rect = shelterRenderRect(plot.tile);
      for (let row = Math.floor(rect.y / TILE_SIZE);
        row <= Math.floor((rect.y + rect.height - 1) / TILE_SIZE); row += 1) {
        for (let column = Math.floor(rect.x / TILE_SIZE);
          column <= Math.floor((rect.x + rect.width - 1) / TILE_SIZE); column += 1) {
          expect(isProtected(column, row), `plot ${plot.id} at ${column},${row}`).toBe(true);
        }
      }
      expect(isProtected(plot.door.column, plot.door.row)).toBe(true);
    }
    for (const gate of generic.gates) expect(isProtected(gate.tile.column, gate.tile.row)).toBe(true);
    for (const placement of generic.staticScenery) {
      if (placement.blocksMovement) continue;
      expect(isProtected(placement.tile.column, placement.tile.row)).toBe(true);
    }
    for (const path of generic.visualPathCompositions) {
      for (const cell of [...path.centerlineCells, ...path.shoulderCells, ...path.clearingCells]) {
        expect(isProtected(cell.column, cell.row)).toBe(true);
      }
    }
    for (let index = 0; index < generic.pathMask.length; index += 1) {
      if (generic.pathMask[index] === 1 || generic.soilMask[index] === 1) {
        expect(protection.protected[index]).toBe(1);
      }
    }
  });

  describe.each(SEEDS)("at run seed %i", (seed) => {
    const identity = eastIdentity(seed);
    const generic = createRegionMapRecipe(identity);
    const recipe = createNirvanaEastRegionMapRecipe(identity);
    const grid = recipe.grid;

    it("loses none of the 128 shelter plots", () => {
      const lost = recipe.shelterPlots.filter((plot) => {
        const rect = shelterRenderRect(plot.tile);
        for (let row = Math.floor(rect.y / TILE_SIZE);
          row <= Math.floor((rect.y + rect.height - 1) / TILE_SIZE); row += 1) {
          for (let column = Math.floor(rect.x / TILE_SIZE);
            column <= Math.floor((rect.x + rect.width - 1) / TILE_SIZE); column += 1) {
            if (column < 0 || row < 0 || column >= grid.columns || row >= grid.rows) return true;
            if (grid.collision[row * grid.columns + column] === 1) return true;
          }
        }
        return false;
      });
      expect(recipe.shelterPlots).toHaveLength(128);
      expect(lost.map((plot) => plot.id)).toEqual([]);
    });

    it("closes no mechanics tile, staging point, route, soil or passive scenery cell", () => {
      const closed = (column: number, row: number): boolean => (
        grid.collision[row * grid.columns + column] === 1
      );
      for (const tile of [
        ...recipe.arrivalAnchors, ...recipe.spawnAnchors, ...recipe.socialAnchors,
        ...recipe.resourceAnchors.energy, ...recipe.resourceAnchors.materials,
        ...recipe.stagingAnchors, ...recipe.gates.map(({ tile: t }) => t),
        ...recipe.shelterPlots.flatMap((plot) => [plot.tile, plot.door]),
      ]) {
        expect(closed(tile.column, tile.row), `${tile.column},${tile.row}`).toBe(false);
      }
      for (const point of recipe.stagingPoints) {
        expect(closed(Math.floor(point.x / TILE_SIZE), Math.floor(point.y / TILE_SIZE))).toBe(false);
      }
      for (let index = 0; index < recipe.pathMask.length; index += 1) {
        if (recipe.pathMask[index] === 1) expect(grid.collision[index]).toBe(0);
        if (recipe.soilMask[index] === 1) expect(grid.collision[index]).toBe(0);
      }
      for (const placement of recipe.staticScenery) {
        if (placement.blocksMovement) continue;
        expect(closed(placement.tile.column, placement.tile.row), placement.id).toBe(false);
      }
    });

    it("only ever closes ground, never re-opens what the recipe already closed", () => {
      let opened = 0;
      let closed = 0;
      for (let index = 0; index < generic.grid.collision.length; index += 1) {
        if (generic.grid.collision[index] === 1 && grid.collision[index] === 0) opened += 1;
        if (generic.grid.collision[index] === 0 && grid.collision[index] === 1) closed += 1;
      }
      // The one legitimate exception is the walk seam: the terrain re-derives it AFTER the
      // union, and a seam pair is at most 4 rim tiles across both axes.
      expect(opened).toBeLessThanOrEqual(4);
      expect(closed).toBeGreaterThan(0);
    });

    it("keeps every protected tile mutually reachable within its own component", () => {
      const mine = labelComponents(grid);
      const base = labelComponents(generic.grid);
      const guarded = protectedIndices(generic);
      const byBase = new Map<number, Set<number>>();
      for (const index of guarded) {
        const baseLabel = base.labels[index]!;
        if (baseLabel === -1) continue;
        expect(mine.labels[index], `protected tile ${index} was closed by terrain`)
          .not.toBe(-1);
        const set = byBase.get(baseLabel) ?? new Set<number>();
        set.add(mine.labels[index]!);
        byBase.set(baseLabel, set);
      }
      for (const [baseLabel, set] of byBase) {
        expect([...set], `base component ${baseLabel} was split`).toHaveLength(1);
      }
    });

    it("splits no pre-existing walkable component", () => {
      const mine = labelComponents(grid);
      const base = labelComponents(generic.grid);
      const spread = new Map<number, Set<number>>();
      for (let index = 0; index < grid.collision.length; index += 1) {
        if (base.labels[index] === -1 || mine.labels[index] === -1) continue;
        const set = spread.get(base.labels[index]!) ?? new Set<number>();
        set.add(mine.labels[index]!);
        spread.set(base.labels[index]!, set);
      }
      for (const [label, set] of spread) {
        expect(set.size, `pre-existing component ${label} now spreads over ${set.size}`).toBe(1);
      }
    });

    it("passes the full generic recipe validation on parse", () => {
      expect(() => parseRegionMapRecipe(
        serializeRegionMapRecipe(recipe),
        identity,
        () => createNirvanaEastRegionMapRecipe(identity),
      )).not.toThrow();
    });

    it("holds the torus: zero corner seam mismatches on both axes", () => {
      const authored = nirvanaEastAuthoredSceneSidecar(recipe)!;
      expect(nirvanaEastCornerSeamMismatches(authored.scene))
        .toEqual({ northSouth: 0, eastWest: 0 });
    });

    it("holds a legal toroidal rim after the terrain unions in", () => {
      expect(grid.topology).toBe("toroidal");
      expect(wrapSeamViolations(grid)).toEqual([]);
      let openRim = 0;
      for (let row = 0; row < grid.rows; row += 1) {
        if (grid.collision[row * grid.columns] === 0) openRim += 1;
        if (grid.collision[row * grid.columns + grid.columns - 1] === 0) openRim += 1;
      }
      for (let column = 0; column < grid.columns; column += 1) {
        if (grid.collision[column] === 0) openRim += 1;
        if (grid.collision[(grid.rows - 1) * grid.columns + column] === 0) openRim += 1;
      }
      // One reciprocal pair per axis: exactly four open rim tiles, never a corner.
      expect(openRim).toBe(4);
    });

    /**
     * **Composition B carries no plank causeway, and this is the assertion that says
     * so on purpose.** It replaces the previous `crossings.length > 0` bar, which was
     * measuring the wrong thing: every deck tile in the region, at every seed, lay
     * inside a landform footprint, so the crossings passed the navigator gate while
     * drawing planks through solid rock. A bridge needs impassable GROUND to span and
     * this composition has none — its floor is walkable everywhere and the only
     * blocked tiles are objects — so the honest contract is "no crossings, and no
     * plank drawn anywhere". See `NirvanaEastTerrainField.ts`'s `crossingPlans`.
     */
    it("carries no plank causeway, because there is no impassable ground to span", () => {
      const authored = nirvanaEastAuthoredSceneSidecar(recipe)!;
      expect(authored.scene.crossings).toEqual([]);
      expect(authored.scene.props.filter((prop) => prop.frameId.startsWith("s.plank."))).toEqual([]);
      expect(authored.scene.tiles.filter((tile) => tile.crossingDeck)).toEqual([]);
    });

    it("lets the real navigator cross every authored crossing, in both axes, on every deck tile", () => {
      const authored = nirvanaEastAuthoredSceneSidecar(recipe)!;
      // Composition B declares none (above). The machinery is kept and this gate is
      // kept with it, so a composition that DOES grow blocking terrain inherits the
      // contract rather than re-discovering it.
      for (const crossing of authored.scene.crossings) {
        const horizontal = crossing.axis === "east-west";
        const first = crossing.deck[0]!;
        const last = crossing.deck[crossing.deck.length - 1]!;
        const before = horizontal
          ? { column: first.column - 1, row: first.row }
          : { column: first.column, row: first.row - 1 };
        const after = horizontal
          ? { column: last.column + 1, row: last.row }
          : { column: last.column, row: last.row + 1 };
        const deckKeys = new Set(crossing.deck.map((tile) => `${tile.column},${tile.row}`));
        for (const [from, to] of [[before, after], [after, before]] as const) {
          const route = findNavigationPath(grid, { start: from, goal: to });
          expect(route.status, `${crossing.id}`).toBe("reached");
          const tiles = route.tiles ?? [];
          const onRoute = tiles.filter((tile) => deckKeys.has(`${tile.column},${tile.row}`));
          expect(onRoute.length, `${crossing.id} deck tiles on route`)
            .toBe(crossing.deck.length);
          expect(firstBlockedGroundTile(grid, tiles.map(tileCenter))).toBeNull();
        }
      }
    });

    it("displaces and retires nothing the generic recipe authored", () => {
      expect(recipe.staticScenery).toEqual(generic.staticScenery);
      expect(recipe.scenicClusters).toEqual(generic.scenicClusters);
      expect(recipe.animatedEnvironment).toEqual(generic.animatedEnvironment);
      expect(recipe.storyNeighborhoods).toEqual(generic.storyNeighborhoods);
      expect(recipe.visualPathCompositions).toEqual(generic.visualPathCompositions);
      expect(recipe.terrainPatches).toEqual(generic.terrainPatches);
      expect(recipe.shelterPlots).toEqual(generic.shelterPlots);
      expect(recipe.districts).toEqual(generic.districts);
      expect(recipe.pathMask).toEqual(generic.pathMask);
      expect(recipe.soilMask).toEqual(generic.soilMask);
      expect(recipe.waterVoidMask).toEqual(generic.waterVoidMask);
    });

    it("places every landform on a multi-tile footprint, not one tile", () => {
      const authored = nirvanaEastAuthoredSceneSidecar(recipe)!;
      expect(authored.scene.landforms.length).toBeGreaterThan(20);
      const mesas = authored.scene.landforms.filter(({ tier }) => tier === "mesa");
      expect(mesas.length).toBeGreaterThan(0);
      for (const placement of mesas) {
        // The pilot measured a mesa's ground contact at roughly 11 x 5 tiles. Anything
        // near 1 means the drawn object and its collision have decoupled again.
        expect(placement.footprint.length, placement.id).toBeGreaterThan(30);
      }
      for (const placement of authored.scene.landforms) {
        expect(placement.footprint.length, placement.id).toBeGreaterThan(1);
      }
    });

    /**
     * **Butte country has to be where the beings are, and this is the number that
     * says whether it is.** The shipped region built 43-45 landforms against the
     * approved plate's 54, and — measured by footprint centre against the bounding
     * box of the 128 shelter plots — exactly ONE of them, a single butte, stood
     * inside the settled band at every run seed. The identity lived around the edge
     * of where beings actually are. The fix is tier variety, never a weaker gate:
     * an outcrop's ground contact is roughly a twelfth of a mesa's, so ground that
     * can never legally hold a mesa can often hold an outcrop.
     */
    it("carries real landform presence into the settled band, at every tier the ground admits", () => {
      const authored = nirvanaEastAuthoredSceneSidecar(recipe)!;
      let minColumn = recipe.grid.columns;
      let maxColumn = -1;
      let minRow = recipe.grid.rows;
      let maxRow = -1;
      for (const plot of recipe.shelterPlots) {
        minColumn = Math.min(minColumn, plot.tile.column);
        maxColumn = Math.max(maxColumn, plot.tile.column);
        minRow = Math.min(minRow, plot.tile.row);
        maxRow = Math.max(maxRow, plot.tile.row);
      }
      const interior = authored.scene.landforms.filter((placement) => {
        let column = 0;
        let row = 0;
        for (const tile of placement.footprint) {
          column += tile.column;
          row += tile.row;
        }
        column = Math.round(column / placement.footprint.length);
        row = Math.round(row / placement.footprint.length);
        return column >= minColumn && column <= maxColumn && row >= minRow && row <= maxRow;
      });
      expect(authored.scene.landforms.length, "total landforms").toBeGreaterThanOrEqual(50);
      expect(interior.length, "landforms inside the settled band").toBeGreaterThanOrEqual(6);
      // Tier variety is the mechanism, so assert the mechanism and not just the count:
      // the settled band must be carrying SMALL tiers, which is why it can carry any.
      expect(
        interior.filter((placement) => placement.tier === "outcrop").length,
        "outcrops inside the settled band",
      ).toBeGreaterThanOrEqual(4);
      // And the big objects must still be out on the open playa where they belong.
      const margin = authored.scene.landforms.length - interior.length;
      expect(margin, "landforms in the open margin").toBeGreaterThanOrEqual(30);
    });

    /**
     * The settled band is the frame the plates show and the frame beings live in, so it
     * is the frame where a repeated silhouette reads as a stamp. Before this pass every
     * landform in the region drew `s.<tier>.0` — one hand-authored cap plan per tier —
     * and the infill that raised outcrops 31 -> ~40 put seven to ten of them in this
     * band, which made the repetition MORE visible than the approved plate's, not less.
     *
     * Asserted through the REAL recipe protection, not the unit test's synthetic mask,
     * because the band's population only exists under the real one.
     */
    it("shows the settled band more than one landform silhouette, and the region every one it publishes", () => {
      const authored = nirvanaEastAuthoredSceneSidecar(recipe)!;
      const frameOf = new Map<string, string>();
      for (const prop of authored.scene.props) {
        if (prop.blocks && prop.landformGroup !== null) frameOf.set(prop.landformGroup, prop.frameId);
      }
      let minColumn = recipe.grid.columns;
      let maxColumn = -1;
      let minRow = recipe.grid.rows;
      let maxRow = -1;
      for (const plot of recipe.shelterPlots) {
        minColumn = Math.min(minColumn, plot.tile.column);
        maxColumn = Math.max(maxColumn, plot.tile.column);
        minRow = Math.min(minRow, plot.tile.row);
        maxRow = Math.max(maxRow, plot.tile.row);
      }
      const band = authored.scene.landforms.filter((placement) => placement.footCol >= minColumn
        && placement.footCol <= maxColumn
        && placement.footRow >= minRow && placement.footRow <= maxRow);
      const bandFrames = new Set(band.map((placement) => frameOf.get(placement.id)));
      expect(band.length, "landforms in the settled band").toBeGreaterThanOrEqual(6);
      expect(bandFrames.size, "distinct silhouettes in the settled band").toBeGreaterThanOrEqual(3);

      // And every published plan must be reached somewhere in the region: an authored
      // frame nothing draws is bytes charged against the per-kit ceiling for nothing.
      const drawn = new Set([...frameOf.values()]);
      for (const tier of NIRVANA_EAST_LANDFORM_TIERS) {
        const placedTier = authored.scene.landforms.filter((placement) => placement.tier === tier);
        if (placedTier.length < NIRVANA_EAST_LANDFORM_VARIANTS[tier]) continue;
        for (let variant = 0; variant < NIRVANA_EAST_LANDFORM_VARIANTS[tier]; variant += 1) {
          expect(drawn.has(`s.${tier}.${variant}`), `s.${tier}.${variant} is drawn somewhere`).toBe(true);
        }
      }
    });
  });
});
