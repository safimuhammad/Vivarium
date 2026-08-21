/**
 * The acceptance bar for the approved Nirvana West "Ember Rift" (industrial ruin
 * kit), asserted on the REAL production recipe rather than on a fixture: the
 * geometry these tests measure is the geometry the world is built from.
 *
 * Mirrors `warmSprings/WarmSpringsRegionMapRecipe.test.ts`'s shape and discipline —
 * see that file's header for why each invariant is asserted rather than merely
 * observed once in a report.
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
import { wrapSeamViolations } from "../navigation/wrapSeams";
import { shelterRenderRect } from "../productionGeometry";
import {
  createNirvanaWestRegionMapRecipe,
  nirvanaWestAuthoredSceneSidecar,
  nirvanaWestAnimatedCandidateCensus,
  nirvanaWestProtectionFromRecipe,
  NIRVANA_WEST_ANIMATED_ENVIRONMENT_BUDGET,
  NIRVANA_WEST_REGION_ID,
} from "./NirvanaWestRegionMapRecipe";
import { verifyToroidalSeam } from "./NirvanaWestTerrainField";

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
const NIRVANA_WEST = WORLD[3]!;

function nirvanaWestIdentity(seed: number): ReturnType<typeof createRegionMapIdentity> {
  return createRegionMapIdentity(seed, NIRVANA_WEST, WORLD);
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

/** Component labels of a collision mask (bounded, four-connected). */
function labelComponents(grid: NavigationGrid): Int32Array {
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
}

describe("NirvanaWestRegionMapRecipe", () => {
  it("rejects any identity that is not exact nirvana_west", () => {
    expect(() => createNirvanaWestRegionMapRecipe(createRegionMapIdentity(401, WORLD[0]!, WORLD)))
      .toThrow(/exact region nirvana_west/);
  });

  it("carries the exact presentation profile and its authored-scene sidecar", () => {
    const recipe = createNirvanaWestRegionMapRecipe(nirvanaWestIdentity(401));
    expect(recipe.regionId).toBe(NIRVANA_WEST_REGION_ID);
    expect(recipe.presentationProfile).toEqual({
      kind: "nirvana-west-v1",
      atlasProfileVersion: 2,
      staticSceneHash: expect.stringMatching(/^[0-9a-f]{8}$/) as unknown as string,
    });
    const authored = nirvanaWestAuthoredSceneSidecar(recipe);
    expect(authored).not.toBeNull();
    expect(authored!.sceneHash).toBe(recipe.presentationProfile!.staticSceneHash);
    expect(authored!.scene.columns).toBe(96);
    expect(authored!.scene.rows).toBe(96);
  });

  it("is deterministic in tiles, collision and scene hash", () => {
    const first = createNirvanaWestRegionMapRecipe(nirvanaWestIdentity(401));
    const second = createNirvanaWestRegionMapRecipe(nirvanaWestIdentity(401));
    expect(second.presentationProfile!.staticSceneHash)
      .toBe(first.presentationProfile!.staticSceneHash);
    expect([...second.grid.collision]).toEqual([...first.grid.collision]);
    expect(second.grid.collision).not.toBe(first.grid.collision);
  });

  /**
   * The sidecar is keyed by recipe OBJECT IDENTITY, so a clone that does not carry it
   * forward loses the scene and the provider fails closed. This is the test that
   * keeps `registerRegionMapRecipeCloneTransfer` wired for Nirvana West.
   */
  it("carries its authored scene across a trusted parse clone", () => {
    const identity = nirvanaWestIdentity(401);
    const recipe = createNirvanaWestRegionMapRecipe(identity);
    const parsed = parseRegionMapRecipe(
      serializeRegionMapRecipe(recipe),
      identity,
      () => createProductionRegionMapRecipe(identity),
    );
    expect(parsed).not.toBe(recipe);
    const authored = nirvanaWestAuthoredSceneSidecar(parsed);
    expect(authored).not.toBeNull();
    expect(authored!.sceneHash).toBe(recipe.presentationProfile!.staticSceneHash);
  });

  it("protects every mechanics, route, story and scenery cell the recipe declares", () => {
    const generic = createRegionMapRecipe(nirvanaWestIdentity(401));
    const protection = nirvanaWestProtectionFromRecipe(generic);
    const isProtected = (column: number, row: number): boolean =>
      protection.protected[row * protection.columns + column] === 1;

    for (const plot of generic.shelterPlots) {
      expect(isProtected(plot.tile.column, plot.tile.row), plot.id).toBe(true);
      expect(isProtected(plot.door.column, plot.door.row), `${plot.id} door`).toBe(true);
    }
    for (const gate of generic.gates) {
      expect(isProtected(gate.tile.column, gate.tile.row)).toBe(true);
    }
    // PASSIVE scenery only — a blocking placement is already hard collision.
    for (const placement of generic.staticScenery) {
      if (placement.blocksMovement) continue;
      expect(isProtected(placement.tile.column, placement.tile.row), placement.id).toBe(true);
    }
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
    const identity = nirvanaWestIdentity(seed);
    const generic = createRegionMapRecipe(identity);
    const recipe = createNirvanaWestRegionMapRecipe(identity);

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
     * RELATIVE, not absolute. The generic Nirvana West region is already more than
     * one walkable component (the mechanics guard ring separates the settled core
     * from the outer margin except at the four gates), plus scraps on some seeds.
     * What terrain MUST hold is that every protected tile stays mutually reachable
     * within the component it started in.
     */
    it("keeps every protected tile mutually reachable within its own component (no pre-existing component is split)", () => {
      const protection = nirvanaWestProtectionFromRecipe(generic);
      const before = labelComponents(generic.grid);
      const after = labelComponents(recipe.grid);
      const groups = new Map<number, Set<number>>();
      for (let index = 0; index < protection.protected.length; index += 1) {
        if (protection.protected[index] !== 1) continue;
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

    it("carries the real navigator across both a west-east and a north-south causeway", () => {
      const authored = nirvanaWestAuthoredSceneSidecar(recipe)!;
      const axes = new Set(authored.scene.causeways.map((crossing) => crossing.axis));
      expect(axes.has("east-west"), "no east-west causeway resolved").toBe(true);
      expect(axes.has("north-south"), "no north-south causeway resolved").toBe(true);

      for (const crossing of authored.scene.causeways) {
        const horizontal = crossing.axis === "east-west";
        const first = crossing.deck[0]!;
        const last = crossing.deck[crossing.deck.length - 1]!;
        const start = horizontal
          ? { column: first.column - 1, row: first.row }
          : { column: first.column, row: first.row - 1 };
        const goal = horizontal
          ? { column: last.column + 1, row: last.row }
          : { column: last.column, row: last.row + 1 };
        const route = findNavigationPath(recipe.grid, { start, goal });
        expect(["reached", "nearest"], crossing.id).toContain(route.status);
        const onRoute = new Set((route.tiles ?? []).map((tile) => `${tile.column},${tile.row}`));
        for (const deck of crossing.deck) {
          expect(onRoute.has(`${deck.column},${deck.row}`), `${crossing.id} deck ${deck.column},${deck.row}`)
            .toBe(true);
        }
        expect(
          firstBlockedGroundTile(recipe.grid, (route.tiles ?? []).map(tileCenter)),
          `${crossing.id} seam`,
        ).toBeNull();
      }
    });

    it("displaces and retires nothing the generic recipe authored, except the relocated animated environment", () => {
      expect(recipe.staticScenery).toEqual(generic.staticScenery);
      expect(recipe.scenicClusters).toEqual(generic.scenicClusters);
      expect(recipe.scenicLandmarks).toEqual(generic.scenicLandmarks);
      expect(recipe.storyNeighborhoods).toEqual(generic.storyNeighborhoods);
      expect(recipe.visualPathCompositions).toEqual(generic.visualPathCompositions);
      expect(recipe.terrainPatches).toEqual(generic.terrainPatches);
      expect(recipe.districts).toEqual(generic.districts);
      expect(recipe.gates).toEqual(generic.gates);
      expect(recipe.shelterPlots).toEqual(generic.shelterPlots);
      expect(recipe.pathMask).toEqual(generic.pathMask);
      expect(recipe.soilMask).toEqual(generic.soilMask);
      expect(recipe.waterVoidMask).toEqual(generic.waterVoidMask);
    });

    /**
     * **DELIBERATE RE-BASELINE — the fire is no longer a relocation of the generic 32.**
     *
     * The first production rule kept the generic budget, ids and kinds and moved the
     * tiles. Two measurements on the shipped region retired that:
     *
     *  1. all 32 sat inside the eight rim `LANDSCAPE_SECTORS` (rows < 16 or >= 80), so
     *     the approved pilot's own viewport at tile (0,54) — the frame the fire was
     *     gated on — carried ZERO flames;
     *  2. **not one stood on live crust.** 25 sat on cooled `emberdim` and 7 on `cinder`,
     *     because the rule demanded a collision-OPEN tile and `ember` blocks. Nothing in
     *     `validateRecipe` asks an animated placement to be on open ground.
     *
     * The region now declares its own exact budget of 320 in
     * `RegionMapRecipe.ts`'s `EXACT_ANIMATED_ENVIRONMENT_BUDGETS` — still an EQUALITY,
     * never a range — and mints its own ids. What is asserted instead is what actually
     * matters: the budget is exact, the kinds belong to the kit, tiles are unique, the
     * fire is on the hottest ground in the region, and it is no longer confined to the
     * rim.
     */
    it("carries its own exact fire budget, on live crust, across the whole region", () => {
      expect(recipe.animatedEnvironment).toHaveLength(NIRVANA_WEST_ANIMATED_ENVIRONMENT_BUDGET);
      expect(recipe.animatedEnvironment).toHaveLength(384);
      expect(new Set(recipe.animatedEnvironment.map((p) => p.id)).size).toBe(384);
      expect(new Set(recipe.animatedEnvironment.map((p) => `${p.tile.column},${p.tile.row}`)).size)
        .toBe(384);
      for (const placement of recipe.animatedEnvironment) {
        expect(["ember", "smoke-anchor"]).toContain(placement.kind);
        expect(Number.isSafeInteger(placement.phaseSeed) && placement.phaseSeed >= 0).toBe(true);
      }

      const scene = nirvanaWestAuthoredSceneSidecar(recipe)!.scene;
      const materialOf = (placement: { tile: { column: number; row: number } }): string =>
        scene.tiles[placement.tile.row * recipe.grid.columns + placement.tile.column]!.material;
      const flames = recipe.animatedEnvironment.filter((p) => p.kind === "ember");
      const onLiveCrust = flames.filter((p) => materialOf(p) === "ember");
      // The whole point: the fire stands on ground that is actually molten, or on the
      // welded seam beside it — never on cold slate, which is where the generic rule put
      // every one of the previous 32.
      expect(flames.length).toBe(320);
      expect(onLiveCrust.length).toBe(256);
      expect(flames.filter((p) => materialOf(p) === "emberdim").length).toBe(64);
      for (const placement of flames) {
        expect(["ember", "emberdim"]).toContain(materialOf(placement));
      }
      // Smoke belongs on the cooked-but-unlit scorch ring, not in the fissure.
      for (const placement of recipe.animatedEnvironment.filter((p) => p.kind === "smoke-anchor")) {
        expect(materialOf(placement)).toBe("cinder");
      }

      // ...and it reaches the settled middle of the region, which the rim-sector rule
      // could not: the approved pilot's own viewport is rows 54-86.
      // Measured 129-136 of 320 across the four run seeds. It is not half, and that is
      // correct rather than short: the interior IS the settlement, and every shelter
      // footprint, staging envelope, route envelope and soil cell there is ground the
      // validators forbid a placement on. What matters is that it is no longer zero.
      const interior = recipe.animatedEnvironment.filter((p) => p.tile.row >= 16 && p.tile.row < 80);
      expect(interior.length).toBeGreaterThanOrEqual(120);
      const pilotViewport = recipe.animatedEnvironment.filter((p) => p.tile.row >= 54
        && p.tile.row < 86 && p.tile.column < 48);
      expect(pilotViewport.length, "placements in the approved pilot's own viewport")
        .toBeGreaterThanOrEqual(25);
    });

    /**
     * The budget is a fixed number, so the region has to be able to SUPPLY it — at every
     * seed, not just the one it was chosen on. This asserts the supply directly, which is
     * what makes a future terrain retune fail here (loudly, with the shortfall named)
     * rather than in a parse.
     */
    it("supplies every fire quota it declares, at this seed, with margin", () => {
      const scene = nirvanaWestAuthoredSceneSidecar(recipe)!.scene;
      const census = nirvanaWestAnimatedCandidateCensus(scene, createRegionMapRecipe(identity));
      // Live crust must cover its 256-flame quota; welded seam its 64; scorch ring its 64.
      expect(census.liveCrust, "legal live-crust tiles").toBeGreaterThanOrEqual(256);
      expect(census.weldedSeam, "legal welded-seam tiles").toBeGreaterThanOrEqual(64);
      expect(census.scorchRing, "legal scorch-ring tiles").toBeGreaterThanOrEqual(64);
    });

    it("keeps the fire off every tile the generic validators forbid it", () => {
      const columns = recipe.grid.columns;
      const forbidden = new Set<number>();
      for (const placement of recipe.staticScenery) {
        forbidden.add(placement.tile.row * columns + placement.tile.column);
      }
      for (const tile of [
        ...recipe.arrivalAnchors, ...recipe.spawnAnchors, ...recipe.socialAnchors,
        ...recipe.resourceAnchors.energy, ...recipe.resourceAnchors.materials,
        ...recipe.stagingAnchors, ...recipe.gates.map(({ tile: t }) => t),
        ...recipe.shelterPlots.flatMap((plot) => [plot.tile, plot.door]),
      ]) {
        forbidden.add(tile.row * columns + tile.column);
      }
      for (let index = 0; index < recipe.pathMask.length; index += 1) {
        if (recipe.pathMask[index] === 1 || recipe.soilMask[index] === 1
          || recipe.waterVoidMask[index] === 1) forbidden.add(index);
      }
      for (const placement of recipe.animatedEnvironment) {
        expect(
          forbidden.has(placement.tile.row * columns + placement.tile.column),
          `${placement.id} at ${placement.tile.column},${placement.tile.row}`,
        ).toBe(false);
      }
    });

    it("passes the full generic recipe validation on parse", () => {
      expect(() => parseRegionMapRecipe(
        serializeRegionMapRecipe(recipe),
        identity,
        () => createProductionRegionMapRecipe(identity),
      )).not.toThrow();
    });

    /**
     * The region shipped once with the whole industrial vocabulary AUTHORED and
     * never PLACED — `powerhall`, `tankfarm`, `tailings`, `pipeline`, `fence`
     * and `railspur` drew ZERO times across 9,216 tiles, and the walkable
     * `slab`/`spoil` tiers were declared, published in the atlas and sampled
     * zero times. That was green: nothing in the suite could tell the difference
     * between "the complex is here" and "the complex was never built". These
     * assertions are what make that failure loud.
     */
    it("seats the industrial complex, with its hero and its turbine hall", () => {
      const scene = nirvanaWestAuthoredSceneSidecar(recipe)!.scene;
      expect(scene.industrialAnchors.map((site) => site.id)).toContain("works");
      const ids = new Set(scene.props.map((prop) => prop.id));
      expect(ids.has("works:coolingtower:0"), "the hero cooling tower").toBe(true);
      expect(ids.has("works:powerhall:1"), "the turbine hall").toBe(true);
    });

    it("places every industrial species the owner approved, and its connective tissue", () => {
      const scene = nirvanaWestAuthoredSceneSidecar(recipe)!.scene;
      const census = new Map<string, number>();
      for (const prop of scene.props) {
        census.set(prop.species, (census.get(prop.species) ?? 0) + 1);
      }
      for (const species of ["coolingtower", "powerhall", "tankfarm", "stack"]) {
        expect(census.get(species) ?? 0, `${species} placements`).toBeGreaterThan(0);
      }
      // Runs, not sprinkles: a handful of pipe segments scattered over a region
      // is the clutter this layout exists to avoid, so the floor is a RUN length.
      expect(census.get("pipeline") ?? 0, "pipeline run").toBeGreaterThanOrEqual(20);
      expect(census.get("fence") ?? 0, "fence run").toBeGreaterThanOrEqual(12);
      expect(census.get("railspur") ?? 0, "rail siding").toBeGreaterThanOrEqual(1);
    });

    it("pours walkable ground evidence, and it never blocks", () => {
      const scene = nirvanaWestAuthoredSceneSidecar(recipe)!.scene;
      const slab = scene.tiles.filter((tile) => tile.material === "slab");
      const spoil = scene.tiles.filter((tile) => tile.material === "spoil");
      expect(slab.length, "slab apron tiles").toBeGreaterThanOrEqual(120);
      expect(spoil.length, "spoil tiles").toBeGreaterThanOrEqual(40);
      expect(slab.filter((tile) => tile.blocked)).toEqual([]);
      expect(spoil.filter((tile) => tile.blocked)).toEqual([]);
      // Ruled, not hashed — see `baseFillVariant`. A slab drawn from eight
      // independently-phased variants reads as scaffolding, not as concrete.
      for (const tile of scene.tiles) {
        if (tile.base === "slab") expect(tile.baseVariant, `${tile.column},${tile.row}`).toBe(0);
        for (const overlay of tile.overlays) {
          if (overlay.material === "slab" && overlay.mask === 15) {
            expect(overlay.variant, `${tile.column},${tile.row}`).toBe(0);
          }
        }
      }
    });

    /**
     * The molten ground, guarded by a floor rather than by an eye.
     *
     * `ember` is the one saturated accent in this region and it is also the
     * LOWEST paint priority, so it is always a tile's base and a core tile
     * holding one ember corner shows a quarter of molten rock under three
     * quarters of cold overlay. Shipped at an even core dither the region drew
     * `ember` over 0.72 % of its own surface against `emberdim`'s 8.25 %, and the
     * fire read as coral wire around dark voids instead of the approved plate's
     * broad crazed floor. This asserts the fix at the level the eye judges:
     * DRAWN AREA, in quarter-tiles.
     */
    it("keeps the fissure cores molten rather than drawing a bright outline", () => {
      const scene = nirvanaWestAuthoredSceneSidecar(recipe)!.scene;
      const popcount = (mask: number): number => (mask & 1 ? 1 : 0) + (mask & 2 ? 1 : 0)
        + (mask & 4 ? 1 : 0) + (mask & 8 ? 1 : 0);
      const quarters = new Map<string, number>();
      for (const tile of scene.tiles) {
        let taken = 0;
        for (const overlay of tile.overlays) {
          const covered = popcount(overlay.mask);
          quarters.set(overlay.material, (quarters.get(overlay.material) ?? 0) + covered);
          taken += covered;
        }
        quarters.set(tile.base, (quarters.get(tile.base) ?? 0) + Math.max(0, 4 - taken));
      }
      const ember = quarters.get("ember") ?? 0;
      const emberdim = quarters.get("emberdim") ?? 0;
      expect(ember, "drawn ember quarter-tiles").toBeGreaterThanOrEqual(800);
      expect(ember / emberdim, "live-to-cooled fissure ratio").toBeGreaterThan(0.35);
    });

    /**
     * Nirvana East's third seed-robustness fix, asserted here too: the published
     * grid is `base | terrain` and the union only ever ADDS blocking, so a deck
     * laid on ground the GENERIC recipe already closes is a plank no being can
     * ever stand on and an abutment no navigator can ever reach.
     */
    it("decks and abuts only ground the generic recipe leaves open", () => {
      const authored = nirvanaWestAuthoredSceneSidecar(recipe)!;
      for (const crossing of authored.scene.causeways) {
        for (const deck of crossing.deck) {
          expect(
            generic.grid.collision[deck.row * generic.grid.columns + deck.column],
            `${crossing.id} deck ${deck.column},${deck.row} is base-closed`,
          ).toBe(0);
        }
        for (const abutment of crossing.abutments) {
          expect(
            generic.grid.collision[abutment.row * generic.grid.columns + abutment.column],
            `${crossing.id} abutment ${abutment.column},${abutment.row} is base-closed`,
          ).toBe(0);
        }
      }
    });
  });

  describe("toroidal seams", () => {
    it("re-derives clean wrap seams after the terrain unions in, at every seed", () => {
      for (const seed of SEEDS) {
        const recipe = createNirvanaWestRegionMapRecipe(nirvanaWestIdentity(seed));
        expect(wrapSeamViolations(recipe.grid), `seed ${seed}`).toEqual([]);
      }
    });

    it("keeps the ART field's own corner lattice genuinely periodic (supplementary to wrapSeamViolations)", () => {
      const recipe = createNirvanaWestRegionMapRecipe(nirvanaWestIdentity(401));
      const authored = nirvanaWestAuthoredSceneSidecar(recipe)!;
      const report = verifyToroidalSeam(authored.scene);
      expect(report).toEqual({ eastWest: true, northSouth: true, mismatches: 0 });
    });
  });

  it("builds >= 300 consecutive seeds with zero throws", () => {
    let built = 0;
    for (let seed = 1; seed <= 300; seed += 1) {
      expect(() => createNirvanaWestRegionMapRecipe(nirvanaWestIdentity(seed)), `seed ${seed}`)
        .not.toThrow();
      built += 1;
    }
    expect(built).toBe(300);
  }, 600_000);
});
