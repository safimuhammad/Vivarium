import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

import type { RegionSnapshot } from "../../../app/schemas";
import { TILE_SIZE, tileCenter, tileIndex } from "../../map/regionMap";
import { findNavigationPath } from "../navigation/navigation";
import {
  applyWrapSeams,
  deriveWrapSeamCandidates,
  wrapSeamViolations,
} from "../navigation/wrapSeams";
import {
  SHELTER_DOOR_CLEARANCE,
  SHELTER_RENDER_FOOTPRINT,
  STANDING_HUMAN_VISUAL_ENVELOPE,
  feetAnchoredVisualRect,
} from "../productionGeometry";
import { getBiomeKit } from "./biomeKits";
import { stableHash } from "./directedTopology";
import { createRegionMapIdentity } from "./RegionMapIdentity";
import {
  cloneTrustedRegionMapRecipe,
  createRegionMapRecipe,
  parseRegionMapRecipe,
  regionMapRecipeHash,
  serializeRegionMapRecipe,
} from "./RegionMapRecipe";
import type { RegionMapRecipeV1 } from "./RegionMapRecipe";

const world: RegionSnapshot[] = [
  makeRegion("nirvana", "a once-heavenly landscape, now thinning and picked-over", ["warm_springs", "nirvana_east", "nirvana_west"]),
  makeRegion("nirvana_east", "a struggling, near-barren stretch", ["warm_springs", "nirvana"]),
  makeRegion("nirvana_west", "a nuclear wasteland, all but dead", ["warm_springs", "nirvana"]),
  makeRegion("warm_springs", "hot spring lakes", ["nirvana_west", "nirvana_east", "nirvana"]),
];
const DISTRICT_ORIGINS = [
  { column: 18, row: 18 }, { column: 34, row: 18 },
  { column: 50, row: 18 }, { column: 66, row: 18 },
  { column: 66, row: 50 }, { column: 50, row: 50 },
  { column: 34, row: 50 }, { column: 18, row: 50 },
] as const;
const LANDSCAPE_SECTORS = [
  { column: 0, row: 0 }, { column: 24, row: 0 },
  { column: 48, row: 0 }, { column: 72, row: 0 },
  { column: 72, row: 80 }, { column: 48, row: 80 },
  { column: 24, row: 80 }, { column: 0, row: 80 },
] as const;
const TEST_MODULE_URL = new URL(import.meta.url);
const CHRONICLE_FIXTURE_DIRECTORY = new URL(
  "../../../../../tests/frontend-app/fixtures/chronicles/data/",
  TEST_MODULE_URL,
);

describe("RegionMapRecipe", () => {
  it("produces byte-identical maps for order-equivalent configuration", () => {
    const left = createRegionMapRecipe(createRegionMapIdentity(19, world[0], world));
    const right = createRegionMapRecipe(createRegionMapIdentity(19, { ...world[0], connections: [...world[0].connections].reverse() }, [...world].reverse()));
    expect(regionMapRecipeHash(right)).toBe(regionMapRecipeHash(left));
    expect(serializeRegionMapRecipe(right)).toBe(serializeRegionMapRecipe(left));
  });

  it("freezes Nirvana mechanics while requiring realized scenic landmarks", () => {
    const recipe = createRegionMapRecipe(createRegionMapIdentity(401, world[0], world));
    const digestBytes = (value: Uint8Array): string => createHash("sha256")
      .update(value)
      .digest("hex");
    const digestJson = (value: unknown): string => createHash("sha256")
      .update(JSON.stringify(value))
      .digest("hex");

    expect({
      collision: digestBytes(recipe.grid.collision),
      path: digestBytes(recipe.pathMask),
      water: digestBytes(recipe.waterVoidMask),
      soil: digestBytes(recipe.soilMask),
      gates: digestJson(recipe.gates),
      staging: digestJson({ anchors: recipe.stagingAnchors, points: recipe.stagingPoints }),
      shelterPlots: digestJson(recipe.shelterPlots),
    // Owner-authorised re-baseline — TORUS PHYSICS PHASE 2 (topology activation).
    // `collision` is the ONLY digest that moves: the published rim now re-opens at one
    // reciprocal seam per axis (4 bytes of 9,216). `path`, `water`, `soil`, `gates`,
    // `staging` and `shelterPlots` below are byte-identical to their pre-activation
    // values, which is the evidence that nothing but the rim changed. Re-measured on the
    // built recipe.
    }).toEqual({
      collision: "14133e708296ff5ff6c0dd6a3ed03bc32fec6689245f47e3fb1ec14ad8a7e107",
      path: "059685b0437cf7a21c23454b4040f20f17893248d897fa8b925ddf7a271f6676",
      water: "2d07a41ae992770085117e9815300bfd0730745883e60b24aaad5e69dfc087ae",
      soil: "8876db44c0aae52ef863fa5fc4b45b0441db7e510613dd0c4e80f4812d954426",
      gates: "01babf450589181a619b9c5519523d0d9d757e3c7a873474d1b1b0985cc76068",
      staging: "85abc9a56ba369efcc111676673ed41807d0562784e39282abdf26d8717fe41c",
      shelterPlots: "34cf69df0da2290af3d27f4dc8b94abc4558ca4b04be848023f0cc1108055cc4",
    });

    expect(recipe.scenicLandmarks).toHaveLength(recipe.scenicClusters.length);
    expect(recipe.scenicLandmarks.every(({ collisionBehavior, affectsMechanics }) =>
      collisionBehavior === "presentation-only" && affectsMechanics === false)).toBe(true);
  });

  it("keeps atomic scenic realization confined to the approved worn-heartland pilot", () => {
    const recipes = world.map((region) =>
      createRegionMapRecipe(createRegionMapIdentity(401, region, world)));
    const pilot = recipes.find(({ regionId }) => regionId === "nirvana")!;

    expect(pilot.kit).toBe("worn-heartland");
    expect(pilot.scenicLandmarks).toHaveLength(pilot.scenicClusters.length);
    expect(recipes.filter(({ regionId }) => regionId !== "nirvana")
      .every(({ scenicLandmarks }) => scenicLandmarks.length === 0)).toBe(true);
  });

  it("realizes the worn-heartland pilot for exact seed 106 without weakening geometry", () => {
    expect(() => createRegionMapRecipe(createRegionMapIdentity(106, world[0], world)))
      .not.toThrow();
  });

  it("round-trips typed masks and every authored placement without drift", () => {
    const identity = createRegionMapIdentity(101, world[3], world);
    const recipe = createRegionMapRecipe(identity);
    const reloaded = parseRegionMapRecipe(serializeRegionMapRecipe(recipe), identity);
    expect(reloaded.edgeMask).toBeInstanceOf(Uint8Array);
    expect(reloaded.waterVoidMask).toBeInstanceOf(Uint8Array);
    expect(reloaded.pathMask).toBeInstanceOf(Uint8Array);
    expect(reloaded.soilMask).toBeInstanceOf(Uint8Array);
    expect(regionMapRecipeHash(reloaded)).toBe(regionMapRecipeHash(recipe));
    expect([...reloaded.grid.collision]).toEqual([...recipe.grid.collision]);
    expect([...reloaded.edgeMask]).toEqual([...recipe.edgeMask]);
    expect([...reloaded.waterVoidMask]).toEqual([...recipe.waterVoidMask]);
    expect([...reloaded.pathMask]).toEqual([...recipe.pathMask]);
    expect([...reloaded.soilMask]).toEqual([...recipe.soilMask]);
    expect(reloaded.gates).toEqual(recipe.gates);
    expect(reloaded.arrivalAnchors).toEqual(recipe.arrivalAnchors);
    expect(reloaded.spawnAnchors).toEqual(recipe.spawnAnchors);
    expect(reloaded.socialAnchors).toEqual(recipe.socialAnchors);
    expect(reloaded.resourceAnchors).toEqual(recipe.resourceAnchors);
    expect(reloaded.stagingAnchors).toEqual(recipe.stagingAnchors);
    expect(reloaded.stagingPoints).toEqual(recipe.stagingPoints);
    expect(reloaded.shelterPlots).toEqual(recipe.shelterPlots);
    expect(reloaded.staticScenery).toEqual(recipe.staticScenery);
    expect(reloaded.scenicClusters).toEqual(recipe.scenicClusters);
    expect(reloaded.scenicLandmarks).toEqual(recipe.scenicLandmarks);
    expect(reloaded.storyNeighborhoods).toEqual(recipe.storyNeighborhoods);
    expect(reloaded.terrainPatches).toEqual(recipe.terrainPatches);
    expect(reloaded.visualPathCompositions).toEqual(recipe.visualPathCompositions);
    expect(reloaded.occupiedHomeObligations).toEqual(recipe.occupiedHomeObligations);
    expect(reloaded.gateStoryTopology).toEqual(recipe.gateStoryTopology);
    expect(reloaded.storyDistricts).toEqual(recipe.storyDistricts);
    expect(reloaded.animatedEnvironment).toEqual(recipe.animatedEnvironment);
    expect(reloaded.districts).toEqual(recipe.districts);
  });

  it("omits an absent presentation profile while canonically cloning a present one", () => {
    const identity = createRegionMapIdentity(101, world[3], world);
    const generic = createRegionMapRecipe(identity);
    const genericSerialized = serializeRegionMapRecipe(generic);
    expect(Object.hasOwn(JSON.parse(genericSerialized), "presentationProfile")).toBe(false);

    const profiled = {
      ...generic,
      presentationProfile: {
        kind: "nirvana-v2",
        atlasProfileVersion: 2,
        staticSceneHash: "0123abcd",
      } as const,
    };
    const cloned = cloneTrustedRegionMapRecipe(profiled);
    expect(cloned.presentationProfile).toEqual(profiled.presentationProfile);
    expect(cloned.presentationProfile).not.toBe(profiled.presentationProfile);
    expect(JSON.parse(serializeRegionMapRecipe(cloned)).presentationProfile)
      .toEqual(profiled.presentationProfile);
    expect(() => parseRegionMapRecipe(serializeRegionMapRecipe(cloned), identity))
      .toThrow(/presentation profile belongs only to exact region nirvana/i);
  });

  it("canonicalizes hostile root and nested JSON key order after reload", () => {
    const identity = createRegionMapIdentity(101, world[3], world);
    const recipe = createRegionMapRecipe(identity);
    const canonical = serializeRegionMapRecipe(recipe);
    const reordered = JSON.stringify(reverseObjectKeys(JSON.parse(canonical)));
    const parsed = parseRegionMapRecipe(reordered, identity);
    expect(serializeRegionMapRecipe(parsed)).toBe(canonical);
    expect(regionMapRecipeHash(parsed)).toBe(regionMapRecipeHash(recipe));
  });

  it("rejects malformed reloads that separate masks, scenery, or anchors from collision truth", () => {
    const identity = createRegionMapIdentity(101, world[3], world);
    const recipe = createRegionMapRecipe(identity);
    const base = JSON.parse(serializeRegionMapRecipe(recipe)) as Record<string, any>;
    expect(() => parseRegionMapRecipe("not-json", identity)).toThrow(/valid JSON/);
    expect(() => parseRegionMapRecipe(JSON.stringify({ ...base, version: 2 }), identity)).toThrow(/version 1/);

    const brokenEdge = structuredClone(base);
    brokenEdge.edgeMask[0] = 0;
    expect(() => parseRegionMapRecipe(JSON.stringify(brokenEdge), identity)).toThrow(/edge mask/);

    const brokenScenery = structuredClone(base);
    const blocking = brokenScenery.staticScenery.find((item: any) => item.blocksMovement);
    brokenScenery.grid.collision[blocking.tile.row * brokenScenery.grid.columns + blocking.tile.column] = 0;
    expect(() => parseRegionMapRecipe(JSON.stringify(brokenScenery), identity)).toThrow(/static scenery/);

    const brokenAnchor = structuredClone(base);
    const anchor = brokenAnchor.socialAnchors[0];
    brokenAnchor.grid.collision[anchor.row * brokenAnchor.grid.columns + anchor.column] = 1;
    expect(() => parseRegionMapRecipe(JSON.stringify(brokenAnchor), identity)).toThrow(/anchor/);
  });

  it("rejects persisted 64x64 recipes instead of misrendering legacy geometry", () => {
    const identity = createRegionMapIdentity(101, world[0], world);
    const legacy = JSON.parse(serializeRegionMapRecipe(createRegionMapRecipe(identity))) as Record<string, any>;
    legacy.grid.columns = 64;
    legacy.grid.rows = 64;
    legacy.grid.collision = legacy.grid.collision.slice(0, 64 * 64);
    for (const mask of ["edgeMask", "waterVoidMask", "pathMask", "soilMask"]) {
      legacy[mask] = legacy[mask].slice(0, 64 * 64);
    }

    expect(() => parseRegionMapRecipe(JSON.stringify(legacy), identity))
      .toThrow(/exact canonical 96x96 boundary/i);
  });

  it("keeps collision, water, edge, static scenery, and anchors mutually legal", () => {
    for (const region of world) {
      const recipe = createRegionMapRecipe(createRegionMapIdentity(77, region, world));
      expect(recipe.grid.collision).toHaveLength(recipe.grid.columns * recipe.grid.rows);
      for (let index = 0; index < recipe.grid.collision.length; index += 1) {
        if (recipe.waterVoidMask[index] === 1) expect(recipe.grid.collision[index]).toBe(1);
      }
      for (const scenery of recipe.staticScenery) {
        expect(recipe.grid.collision[tileIndex(recipe.grid, scenery.tile)]).toBe(scenery.blocksMovement ? 1 : 0);
      }
      const anchors = [
        ...recipe.arrivalAnchors, ...recipe.spawnAnchors, ...recipe.socialAnchors,
        ...recipe.resourceAnchors.energy, ...recipe.resourceAnchors.materials,
        ...recipe.stagingAnchors, ...recipe.shelterPlots.flatMap((plot) => [plot.tile, plot.door]),
      ];
      for (const anchor of anchors) expect(recipe.grid.collision[tileIndex(recipe.grid, anchor)]).toBe(0);
      for (const anchor of anchors) {
        expect(findNavigationPath(recipe.grid, { start: recipe.spawnAnchors[0], goal: anchor }).status).toBe("reached");
      }
      for (const gate of recipe.gates) {
        expect(recipe.grid.collision[tileIndex(recipe.grid, gate.tile)]).toBe(0);
        expect(findNavigationPath(recipe.grid, { start: recipe.spawnAnchors[0], goal: gate.tile }).status).toBe("reached");
        const side = gate.tile.row === 17 ? "north" : gate.tile.column === 78 ? "east" : gate.tile.row === 78 ? "south" : "west";
        const inward = { north: "south", east: "west", south: "north", west: "east" }[side] as typeof side;
        expect(gate.facing).toBe(gate.role === "departure" ? side : inward);
      }
      for (let column = 0; column < recipe.grid.columns; column += 1) {
        expect(recipe.edgeMask[column]).toBe(1);
        expect(recipe.edgeMask[(recipe.grid.rows - 1) * recipe.grid.columns + column]).toBe(1);
      }
    }
  });

  it("represents every directed edge with reachable gates and matching anchors", () => {
    const recipes = world.map((region) => createRegionMapRecipe(createRegionMapIdentity(80, region, world)));
    const gates = recipes.flatMap((recipe) => recipe.gates);
    expect(gates.filter((gate) => gate.role === "departure")).toHaveLength(10);
    expect(gates.filter((gate) => gate.role === "arrival")).toHaveLength(10);
    for (const departure of gates.filter((gate) => gate.role === "departure")) {
      expect(gates).toContainEqual(expect.objectContaining({ edge: departure.edge, role: "arrival" }));
    }
  });

  it("provides eight stable overflow districts with capacity for 256 beings and 128 homes", () => {
    const recipe = createRegionMapRecipe(createRegionMapIdentity(2, world[0], world));
    expect(recipe.grid).toMatchObject({ columns: 96, rows: 96 });
    expect({
      width: recipe.grid.columns * TILE_SIZE,
      height: recipe.grid.rows * TILE_SIZE,
      tileArea: recipe.grid.columns * recipe.grid.rows,
    }).toEqual({ width: 3_072, height: 3_072, tileArea: 9_216 });
    expect(recipe.districts).toHaveLength(8);
    expect(recipe.districts.flatMap((district) => district.stagingAnchors)).toHaveLength(256);
    expect(recipe.districts.flatMap((district) => district.shelterPlots)).toHaveLength(128);
    expect(recipe.districts.flatMap((district) => district.shelterPlots.map((plot) => plot.id))).toEqual(
      recipe.districts.flatMap((district) => Array.from(
        { length: 16 },
        (_unused, plotIndex) => `${recipe.regionId}:district-${district.index}:plot-${plotIndex}`,
      )),
    );
    expect(recipe.districts.map((district) => district.origin)).toEqual(DISTRICT_ORIGINS);
  });

  it("keeps every shelter's 128px render footprint disjoint and fully inside the map", () => {
    expect(SHELTER_RENDER_FOOTPRINT).toEqual({ width: 128, height: 128 });
    const recipe = createRegionMapRecipe(createRegionMapIdentity(2, world[0], world));
    const rectangles = recipe.shelterPlots.map((plot) => ({
      id: plot.id,
      ...shelterRenderRect(plot.tile),
    }));
    const overlaps: string[] = [];
    for (let leftIndex = 0; leftIndex < rectangles.length; leftIndex += 1) {
      const left = rectangles[leftIndex]!;
      expect(left.left, `${left.id} left`).toBeGreaterThanOrEqual(0);
      expect(left.top, `${left.id} top`).toBeGreaterThanOrEqual(0);
      expect(left.right, `${left.id} right`).toBeLessThanOrEqual(recipe.grid.columns * TILE_SIZE);
      expect(left.bottom, `${left.id} bottom`).toBeLessThanOrEqual(recipe.grid.rows * TILE_SIZE);
      for (let rightIndex = leftIndex + 1; rightIndex < rectangles.length; rightIndex += 1) {
        const right = rectangles[rightIndex]!;
        if (rectanglesOverlap(left, right)) overlaps.push(`${left.id} <> ${right.id}`);
      }
    }
    expect(overlaps).toEqual([]);
  });

  it("places every shelter door inside the production door-clearance contract", () => {
    expect(SHELTER_DOOR_CLEARANCE).toEqual({ x: 49, y: 57, width: 30, height: 48 });
    const recipe = createRegionMapRecipe(createRegionMapIdentity(2, world[0], world));
    const invalid = recipe.shelterPlots.flatMap((plot) => {
      const plotOrigin = tileCenter(plot.tile);
      const door = tileCenter(plot.door);
      const relative = { x: door.x - plotOrigin.x, y: door.y - plotOrigin.y };
      return pointInRect(relative, SHELTER_DOOR_CLEARANCE)
        ? []
        : [`${plot.id}@${relative.x},${relative.y}`];
    });
    expect(invalid).toEqual([]);
  });

  it("keeps every canonical actor and shelter footprint clear of authored environment", () => {
    expect(STANDING_HUMAN_VISUAL_ENVELOPE).toEqual({
      left: -11, top: -46, right: 11, bottom: 2, width: 22, height: 48,
    });
    const violations: string[] = [];
    for (const seed of [2, 77, 509]) {
      for (const region of world) {
        const recipe = createRegionMapRecipe(createRegionMapIdentity(seed, region, world));
        const shelters = recipe.shelterPlots.map((plot) => shelterRenderRect(plot.tile));
        const environment = [
          ...recipe.staticScenery.map((placement) => ({
            label: `${placement.id}/${placement.kind}/${placement.blocksMovement ? "blocking" : "passive"}`,
            rect: environmentRenderRect(placement.tile),
          })),
          ...recipe.animatedEnvironment.map((placement) => ({
            label: `${placement.id}/${placement.kind}/animated`,
            rect: environmentRenderRect(placement.tile),
          })),
        ];
        const scope = `${seed}/${region.name}`;
        if (recipe.stagingAnchors.length !== 256) {
          violations.push(`${scope} staging anchor count ${recipe.stagingAnchors.length}`);
        }
        if (recipe.stagingPoints.length !== 256) {
          violations.push(`${scope} staging point count ${recipe.stagingPoints.length}`);
        }
        const uniqueAnchors = new Set(recipe.stagingAnchors.map(tileKey)).size;
        if (uniqueAnchors !== 256) violations.push(`${scope} unique staging anchors ${uniqueAnchors}`);
        const uniquePoints = new Set(
          recipe.stagingPoints.map((point) => `${point.x},${point.y}`),
        ).size;
        if (uniquePoints !== 256) violations.push(`${scope} unique staging points ${uniquePoints}`);
        for (const [districtIndex, district] of recipe.districts.entries()) {
          if (district.stagingAnchors.length !== 32) {
            violations.push(
              `${scope} district ${districtIndex} staging anchors ${district.stagingAnchors.length}`,
            );
          }
        }
        for (const actorPoint of recipe.stagingPoints) {
          const actor = rectToTestRect(feetAnchoredVisualRect(actorPoint));
          const actorScope = `${scope}/${actorPoint.x},${actorPoint.y}`;
          if (shelters.some((shelter) => rectanglesOverlap(actor, shelter))) {
            violations.push(`${actorScope} complete actor envelope intersects shelter`);
          }
          const environmentIntrusions = environment
            .filter((placement) => rectanglesOverlap(actor, placement.rect))
            .map((placement) => placement.label);
          if (environmentIntrusions.length > 0) {
            violations.push(`${actorScope} environment clearance: ${environmentIntrusions.join(",")}`);
          }
        }
        for (let leftIndex = 0; leftIndex < recipe.stagingPoints.length; leftIndex += 1) {
          for (let rightIndex = leftIndex + 1; rightIndex < recipe.stagingPoints.length; rightIndex += 1) {
            const left = recipe.stagingPoints[leftIndex]!;
            const right = recipe.stagingPoints[rightIndex]!;
            if (Math.abs(left.x - right.x) < STANDING_HUMAN_VISUAL_ENVELOPE.width + 4
              && Math.abs(left.y - right.y) < STANDING_HUMAN_VISUAL_ENVELOPE.height + 4) {
              violations.push(`${scope} staging points ${leftIndex}/${rightIndex} overlap`);
            }
          }
        }
        for (const plot of recipe.shelterPlots) {
          const intrusions = environment
            .filter((placement) => rectanglesOverlap(shelterRenderRect(plot.tile), placement.rect))
            .map((placement) => placement.label);
          if (intrusions.length > 0) {
            violations.push(`${scope}/${plot.id} shelter clearance: ${intrusions.join(",")}`);
          }
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("rejects persisted environment placed beside an anchor but inside its complete standing envelope", () => {
    const identity = createRegionMapIdentity(2, world[0], world);
    const base = JSON.parse(serializeRegionMapRecipe(createRegionMapRecipe(identity))) as Record<string, any>;
    const intrusion = findStagingEnvironmentIntrusion(base);
    base.animatedEnvironment[intrusion.placementIndex].tile = intrusion.tile;

    expect(() => parseRegionMapRecipe(JSON.stringify(base), identity))
      .toThrow(/staging visual envelope.*environment footprint/i);
  });

  it("rejects persisted static or animated environment inside a shelter's full render footprint", () => {
    const identity = createRegionMapIdentity(2, world[0], world);
    const base = JSON.parse(serializeRegionMapRecipe(createRegionMapRecipe(identity))) as Record<string, any>;
    for (const category of ["static", "animated"] as const) {
      const copy = structuredClone(base);
      const intrusion = findShelterEnvironmentIntrusion(copy, category);
      const placements = category === "static" ? copy.staticScenery : copy.animatedEnvironment;
      placements[intrusion.placementIndex].tile = intrusion.tile;

      expect(() => parseRegionMapRecipe(JSON.stringify(copy), identity), category)
        .toThrow(/shelter render footprint.*environment footprint/i);
    }
  });

  it("rejects hostile persisted district deletion, insertion, rename, and reorder", () => {
    const identity = createRegionMapIdentity(2, world[0], world);
    const base = JSON.parse(serializeRegionMapRecipe(createRegionMapRecipe(identity))) as Record<string, any>;
    const mutations: readonly [string, (copy: Record<string, any>) => void][] = [
      ["deletion", (copy) => { copy.districts[0].stagingAnchors.pop(); copy.stagingAnchors.splice(31, 1); }],
      ["insertion", (copy) => {
        copy.districts[0].stagingAnchors.push(structuredClone(copy.districts[1].stagingAnchors[0]));
        copy.stagingAnchors.splice(32, 0, structuredClone(copy.districts[1].stagingAnchors[0]));
      }],
      ["rename", (copy) => {
        copy.districts[0].shelterPlots[0].id = `${copy.regionId}:district-0:plot-renamed`;
        copy.shelterPlots[0].id = `${copy.regionId}:district-0:plot-renamed`;
      }],
      ["reorder", (copy) => {
        copy.districts[0].shelterPlots.reverse();
        copy.shelterPlots.splice(0, 16, ...structuredClone(copy.districts[0].shelterPlots));
      }],
    ];
    for (const [label, mutate] of mutations) {
      const copy = structuredClone(base);
      mutate(copy);
      expect(() => parseRegionMapRecipe(JSON.stringify(copy), identity), label)
        .toThrow(/canonical district/i);
    }
  });

  it("rejects coherent persisted scenery renames and reorders that preserve structural legality", () => {
    const identity = createRegionMapIdentity(2, world[0], world);
    const base = JSON.parse(serializeRegionMapRecipe(createRegionMapRecipe(identity))) as Record<string, any>;
    const mutations: readonly [string, (copy: Record<string, any>) => void][] = [
      ["static rename", (copy) => {
        copy.staticScenery.forEach((placement: any, index: number) => {
          placement.id = `${copy.regionId}:renamed-static-${index}`;
        });
      }],
      ["animated rename", (copy) => {
        copy.animatedEnvironment.forEach((placement: any, index: number) => {
          placement.id = `${copy.regionId}:renamed-animated-${index}`;
        });
      }],
      ["static reorder", (copy) => {
        copy.staticScenery.reverse();
        copy.staticScenery.forEach((placement: any, index: number) => {
          placement.id = `${copy.regionId}:static-${index}`;
        });
      }],
      ["animated reorder", (copy) => {
        copy.animatedEnvironment.reverse();
        copy.animatedEnvironment.forEach((placement: any, index: number) => {
          placement.id = `${copy.regionId}:animated-${index}`;
        });
      }],
    ];
    for (const [label, mutate] of mutations) {
      const copy = structuredClone(base);
      mutate(copy);
      expect(() => parseRegionMapRecipe(JSON.stringify(copy), identity), label)
        .toThrow(/canonical (static scenery cluster|deterministic fields)/i);
    }
  });

  it("rejects persisted shelter plots whose unique tiles still produce intersecting render footprints", () => {
    const identity = createRegionMapIdentity(2, world[0], world);
    const base = JSON.parse(serializeRegionMapRecipe(createRegionMapRecipe(identity))) as Record<string, any>;
    const target = base.shelterPlots[0];
    const moved = base.shelterPlots.at(-1);
    const placement = findIntrudingShelterPlacement(base, target, moved);
    replaceShelterPlot(base, moved.id, placement);
    expect(() => parseRegionMapRecipe(JSON.stringify(base), identity)).toThrow(/shelter plot render footprint overlap/i);
  });

  it("rejects persisted shelter doors outside the production door-clearance contract", () => {
    const identity = createRegionMapIdentity(2, world[0], world);
    const base = JSON.parse(serializeRegionMapRecipe(createRegionMapRecipe(identity))) as Record<string, any>;
    const moved = base.shelterPlots[0];
    const doorIndex = findOpenMutationIndex(base, (index) => {
      const door = { column: index % base.grid.columns, row: Math.floor(index / base.grid.columns) };
      const plotOrigin = tileCenter(moved.tile);
      const doorPoint = tileCenter(door);
      return !pointInRect(
        { x: doorPoint.x - plotOrigin.x, y: doorPoint.y - plotOrigin.y },
        SHELTER_DOOR_CLEARANCE,
      );
    });
    replaceShelterPlot(base, moved.id, {
      tile: moved.tile,
      door: { column: doorIndex % base.grid.columns, row: Math.floor(doorIndex / base.grid.columns) },
    });
    expect(() => parseRegionMapRecipe(JSON.stringify(base), identity)).toThrow(/shelter plot door.*clearance/i);
  });

  it("authors a dense bounded composition in every district landscape sector", () => {
    const unknown = makeRegion("new_place", "mysterious shoreline", []);
    const regions = [...world, unknown];
    for (const region of regions) {
      const recipe = createRegionMapRecipe(createRegionMapIdentity(211, region, regions));
      expect(recipe.staticScenery, `${region.name} static budget`).toHaveLength(8 * 24);
      expect(recipe.animatedEnvironment, `${region.name} animated budget`).toHaveLength(8 * 4);
      for (const district of recipe.districts) {
        const districtStatic = recipe.staticScenery.filter((placement) =>
          inLandscapeSector(placement.tile, district.origin));
        const districtAnimated = recipe.animatedEnvironment.filter((placement) =>
          inLandscapeSector(placement.tile, district.origin));
        expect(districtStatic, `${region.name} district ${district.index} static`).toHaveLength(24);
        expect(districtAnimated, `${region.name} district ${district.index} animated`).toHaveLength(4);
      }
    }
  });

  it("authors connected scenic clusters for at least seventy percent of static scenery", () => {
    const unknown = makeRegion("new_place", "mysterious shoreline", []);
    const regions = [...world, unknown];
    for (const region of regions) {
      const recipe = createRegionMapRecipe(createRegionMapIdentity(223, region, regions));
      const clustered = recipe.staticScenery.filter((placement) => placement.clusterId !== null);
      expect(clustered.length / recipe.staticScenery.length, region.name).toBeGreaterThanOrEqual(0.7);
      for (const cluster of recipe.scenicClusters) {
        const members = recipe.staticScenery.filter((placement) => placement.clusterId === cluster.id);
        expect(members.map((member) => member.id), cluster.id).toEqual(cluster.memberIds);
        expect(members.length, cluster.id).toBeGreaterThanOrEqual(3);
        expect(connectedComponents(members.map((member) => member.tile)), cluster.id).toHaveLength(1);
      }
    }
  });

  it("declares exact visual and hard footprints plus semantic roles for every scenic member", () => {
    const recipe = createRegionMapRecipe(createRegionMapIdentity(227, world[0], world));
    const kit = getBiomeKit(recipe.kit);
    const roles = new Set([
      kit.sceneGrammar.signatureRole,
      ...kit.sceneGrammar.supportRoles,
      "satellite-accent",
    ]);
    for (const placement of recipe.staticScenery) {
      expect(roles.has(placement.role)).toBe(true);
      expect(placement.visualFootprint).toEqual({ widthTiles: 1, heightTiles: 1 });
      expect(placement.hardCollisionFootprint).toEqual(
        placement.blocksMovement ? [{ column: 0, row: 0 }] : [],
      );
    }
  });

  it("places a kit-distinct terrain signature beside every static story obligation", () => {
    const unknown = makeRegion("new_place", "mysterious shoreline", []);
    const regions = [...world, unknown];
    const signatures = new Set<string>();
    for (const region of regions) {
      const recipe = createRegionMapRecipe(createRegionMapIdentity(229, region, regions));
      const kit = getBiomeKit(recipe.kit);
      signatures.add(JSON.stringify(kit.sceneGrammar.terrainPatchRoles));
      expect(recipe.storyNeighborhoods).toHaveLength(recipe.gates.length + recipe.districts.length * 3);
      for (const neighborhood of recipe.storyNeighborhoods) {
        const patch = recipe.terrainPatches.find((candidate) =>
          candidate.id === neighborhood.terrainPatchId);
        expect(patch, neighborhood.id).toMatchObject({
          districtIndex: neighborhood.districtIndex,
          recordType: "terrain-patch",
          collisionBehavior: "visual-only",
          affectsMechanics: false,
        });
        expect(patch!.cells.some((cell) => manhattan(neighborhood.anchor, cell) <= 2), neighborhood.id)
          .toBe(true);
      }
    }
    expect(signatures).toHaveLength(regions.length);
  });

  it("anchors the Warm Springs signature composition to a real connected pool", () => {
    const recipe = createRegionMapRecipe(createRegionMapIdentity(233, world[3], world));
    const signature = recipe.scenicClusters.find((cluster) =>
      cluster.districtIndex === 0 && cluster.signature)!;
    const members = recipe.staticScenery
      .filter((placement) => placement.clusterId === signature.id)
      .map((placement) => placement.tile);
    const water = maskTiles(recipe.waterVoidMask, recipe.grid.columns);
    const waterComponents = connectedComponents(water);

    expect(signature.role).toBe("connected-spring-terrace");
    expect(waterComponents.map((component) => component.length).sort((left, right) => left - right))
      .toEqual([14, 14]);
    expect(members.some((member) => water.some((tile) => manhattan(member, tile) === 1))).toBe(true);
  });

  it("names every Warm Springs cluster truthfully against every authoritative water cell", () => {
    const recipe = createRegionMapRecipe(createRegionMapIdentity(233, world[3], world));
    const water = maskTiles(recipe.waterVoidMask, recipe.grid.columns);
    const observations = recipe.scenicClusters.map((cluster) => {
      const members = recipe.staticScenery
        .filter((placement) => placement.clusterId === cluster.id)
        .map((placement) => placement.tile);
      return {
        role: cluster.role,
        signature: cluster.signature,
        waterAdjacent: members.some((member) =>
          water.some((tile) => manhattan(member, tile) === 1)),
      };
    });

    expect(observations.filter((entry) => entry.role === "connected-spring-terrace"))
      .toHaveLength(1);
    expect(observations.filter((entry) => entry.signature && entry.role === "spring-hillside-terrace"))
      .toHaveLength(7);
    expect(observations.every((entry) =>
      entry.role !== "connected-spring-terrace" || entry.waterAdjacent)).toBe(true);
  });

  it("enumerates every static and dynamic story obligation with exact native mobile geometry", () => {
    const safeFrame = {
      width: 390 - 8 - 52,
      height: 844 - 120 - 276,
      padding: 16,
    } as const;
    for (const [regionIndex, region] of [...world, makeRegion("new_place", "mysterious shoreline", [])].entries()) {
      const regions = regionIndex < world.length ? world : [...world, region];
      const recipe = createRegionMapRecipe(createRegionMapIdentity(229, region, regions));
      const contract = recipe as any;
      expect(contract.occupiedHomeObligations).toHaveLength(recipe.districts.length);
      expect(contract.storyDistricts).toHaveLength(recipe.districts.length);

      const storyIds = new Set(contract.storyNeighborhoods.map((story: any) => story.id));
      const patchById = new Map(contract.terrainPatches.map((patch: any) => [patch.id, patch]));
      const pathById = new Map(contract.visualPathCompositions.map((path: any) => [path.id, path]));
      const gateStoryIds = new Set(
        contract.storyNeighborhoods
          .filter((story: any) => story.anchorKind === "authoritative-gate")
          .map((story: any) => story.id),
      );
      if (recipe.gates.length === 0) {
        expect(contract.gateStoryTopology).toEqual({
          mode: "isolated",
          reason: "no-authoritative-directed-gates",
        });
        expect(gateStoryIds).toHaveLength(0);
      } else {
        expect(contract.gateStoryTopology.mode).toBe("directed-gates");
        expect(gateStoryIds).toHaveLength(recipe.gates.length);
      }

      for (const district of recipe.districts) {
        const districtContract = contract.storyDistricts[district.index];
        expect(districtContract.districtIndex).toBe(district.index);
        expect(Object.keys(districtContract.staticStoryIds).sort()).toEqual(
          recipe.gates.length > 0
            ? ["energy", "materials", "primaryGate", "social"]
            : ["energy", "materials", "social"],
        );
        expect(Object.values(districtContract.staticStoryIds)
          .every((id) => storyIds.has(id as string))).toBe(true);
        expect(districtContract.dynamicOccupiedHomeObligationId)
          .toBe(contract.occupiedHomeObligations[district.index].id);
        expect(contract.occupiedHomeObligations[district.index]).toMatchObject({
          recordType: "dynamic-occupied-home",
          districtIndex: district.index,
          activation: "occupied-home-only",
          collisionBehavior: "visual-only",
          affectsMechanics: false,
        });
      }

      for (const story of contract.storyNeighborhoods) {
        const patch = patchById.get(story.terrainPatchId) as any;
        expect(patch, story.id).toBeDefined();
        const actor = rectToTestRect(feetAnchoredVisualRect(tileCenter(story.anchor)));
        const patchBounds = tileBounds(patch.cells);
        const focus = story.pathContext.mode === "local-authoritative-path"
          ? unionRects(unionRects(actor, patchBounds), tileBounds(
              (pathById.get(story.pathContext.visualPathCompositionId) as any).centerlineCells
                .concat((pathById.get(story.pathContext.visualPathCompositionId) as any).shoulderCells)
                .concat((pathById.get(story.pathContext.visualPathCompositionId) as any).clearingCells),
            ))
          : unionRects(actor, patchBounds);
        expect(focus.right - focus.left + 2 * safeFrame.padding, `${story.id}:width`)
          .toBeLessThanOrEqual(safeFrame.width);
        expect(focus.bottom - focus.top + 2 * safeFrame.padding, `${story.id}:height`)
          .toBeLessThanOrEqual(safeFrame.height);
        expect(story.minimumNativeZoom).toBe(1);
      }

      const coveredGateKeys = new Set(
        contract.storyNeighborhoods
          .filter((story: any) => story.anchorKind === "authoritative-gate")
          .map((story: any) => JSON.stringify(story.authoritativeGate)),
      );
      expect(coveredGateKeys).toEqual(new Set(recipe.gates.map((gate) => JSON.stringify(gate))));
    }
  });

  it("discriminates truthful local road context from detached stories and binds every home approach", () => {
    const regions = [...world, makeRegion("new_place", "mysterious shoreline", [])];
    let localStories = 0;
    let detachedStories = 0;
    for (const region of regions) {
      const recipe = createRegionMapRecipe(createRegionMapIdentity(84, region, regions));
      const pathsById = new Map(recipe.visualPathCompositions.map((path) => [path.id, path]));
      for (const story of recipe.storyNeighborhoods as readonly any[]) {
        const context = story.pathContext;
        expect(context, `${story.id}:path-context`).toBeDefined();
        expect(story.contextAnchor, `${story.id}:legacy-context`).toBeUndefined();
        expect(story.visualPathCompositionId, `${story.id}:legacy-path`).toBeUndefined();
        if (context.mode === "local-authoritative-path") {
          localStories += 1;
          const path = pathsById.get(context.visualPathCompositionId)!;
          expect(path, `${story.id}:local-path`).toBeDefined();
          expect(path.storyOwnerIds).toEqual([story.id]);
          expect(path.centerlineCells).toContainEqual(context.contextAnchor);
          expect(recipe.pathMask[tileIndex(recipe.grid, context.contextAnchor)]).toBe(1);
          expect(context.navigationDistance).toBeGreaterThanOrEqual(0);
        } else {
          detachedStories += 1;
          expect(context).toMatchObject({
            mode: "detached-no-crop-local-path",
            reason: "no-admissible-crop-local-authoritative-path-composition",
            visualPathCompositionId: null,
          });
          expect(recipe.pathMask[tileIndex(recipe.grid, context.nearestAuthoritativeContext)])
            .toBe(1);
          expect(context.navigationDistance).toBeGreaterThanOrEqual(0);
        }
      }
      for (const [districtIndex, obligation] of (recipe.occupiedHomeObligations as readonly any[]).entries()) {
        const plots = recipe.districts[districtIndex]!.shelterPlots;
        expect(obligation.shelterPlotIds).toBeUndefined();
        expect(obligation.visualPathCompositionId).toBeUndefined();
        expect(obligation.approachBindings).toHaveLength(plots.length);
        for (const [plotIndex, binding] of obligation.approachBindings.entries()) {
          const plot = plots[plotIndex]!;
          expect(binding).toMatchObject({
            recordType: "occupied-home-approach-binding",
            shelterPlotId: plot.id,
            doorAnchor: plot.door,
            activation: "when-plot-occupied",
            collisionBehavior: "visual-only",
            affectsMechanics: false,
          });
          expect(binding.apronCells).toContainEqual(plot.door);
          expect(connectedComponents(binding.apronCells)).toHaveLength(1);
          expect(binding.apronCells.every((tile: any) =>
            recipe.grid.collision[tileIndex(recipe.grid, tile)] === 0
            && recipe.waterVoidMask[tileIndex(recipe.grid, tile)] === 0)).toBe(true);
          expect(binding.apronCells.every((tile: any) => {
            const rect = environmentRenderRect(tile);
            return recipe.staticScenery.every((placement) =>
              !rectanglesOverlap(rect, environmentRenderRect(placement.tile)))
              && recipe.shelterPlots.every((candidate) => candidate.id === plot.id
                || !rectanglesOverlap(rect, shelterRenderRect(candidate.tile)));
          })).toBe(true);
          expect(recipe.pathMask[tileIndex(recipe.grid, binding.nearestAuthoritativeContext)])
            .toBe(1);
          expect(binding.navigationDistance).toBeGreaterThanOrEqual(0);
        }
      }
    }
    const zeroDistanceRecipe = createRegionMapRecipe(createRegionMapIdentity(263, world[0], world));
    const zeroDistance = (zeroDistanceRecipe.storyNeighborhoods as readonly any[]).find((story) =>
      story.pathContext.mode === "detached-no-crop-local-path"
      && story.pathContext.navigationDistance === 0);
    expect(zeroDistance, "zero-distance detached story must remain explicit").toBeDefined();
    expect(zeroDistance.pathContext).toMatchObject({
      reason: "no-admissible-crop-local-authoritative-path-composition",
      constraint: "no-legal-visual-clearing",
      navigationDistance: 0,
    });
    expect(zeroDistanceRecipe.pathMask[tileIndex(
      zeroDistanceRecipe.grid,
      zeroDistance.pathContext.nearestAuthoritativeContext,
    )]).toBe(1);
    expect(localStories).toBeGreaterThan(0);
    expect(detachedStories).toBeGreaterThan(0);
  });

  it("rejects false local/detached discriminants, broken reciprocity, and drifted home approaches", () => {
    const identity = createRegionMapIdentity(84, world[3], world);
    const base = JSON.parse(serializeRegionMapRecipe(createRegionMapRecipe(identity))) as Record<string, any>;
    const local = base.storyNeighborhoods.find((story: any) =>
      story.pathContext.mode === "local-authoritative-path");
    const detached = base.storyNeighborhoods.find((story: any) =>
      story.pathContext.mode === "detached-no-crop-local-path");
    expect(local).toBeDefined();
    expect(detached).toBeDefined();

    const falseDetached = structuredClone(base);
    const falseDetachedStory = falseDetached.storyNeighborhoods.find((story: any) => story.id === local.id);
    falseDetachedStory.pathContext = {
      mode: "detached-no-crop-local-path",
      reason: "no-admissible-crop-local-authoritative-path-composition",
      constraint: "native-mobile-crop-overflow",
      nearestAuthoritativeContext: local.pathContext.contextAnchor,
      navigationDistance: local.pathContext.navigationDistance,
      visualPathCompositionId: null,
    };
    expect(() => parseRegionMapRecipe(JSON.stringify(falseDetached), identity))
      .toThrow(/falsely detached/i);

    const falseLocal = structuredClone(base);
    const falseLocalStory = falseLocal.storyNeighborhoods.find((story: any) => story.id === detached.id);
    falseLocalStory.pathContext = {
      mode: "local-authoritative-path",
      contextAnchor: detached.pathContext.nearestAuthoritativeContext,
      navigationDistance: detached.pathContext.navigationDistance,
      visualPathCompositionId: base.visualPathCompositions[0].id,
    };
    expect(() => parseRegionMapRecipe(JSON.stringify(falseLocal), identity))
      .toThrow(/falsely local/i);

    const wrongOwner = structuredClone(base);
    const wrongOwnerStory = wrongOwner.storyNeighborhoods.find((story: any) => story.id === local.id);
    wrongOwnerStory.pathContext.visualPathCompositionId = base.visualPathCompositions
      .find((path: any) => path.id !== local.pathContext.visualPathCompositionId).id;
    expect(() => parseRegionMapRecipe(JSON.stringify(wrongOwner), identity))
      .toThrow(/reciprocal authoritative composition/i);

    const wrongConstraint = structuredClone(base);
    const wrongConstraintStory = wrongConstraint.storyNeighborhoods.find((story: any) =>
      story.id === detached.id);
    wrongConstraintStory.pathContext.constraint =
      wrongConstraintStory.pathContext.constraint === "no-legal-visual-shoulder"
        ? "native-mobile-crop-overflow"
        : "no-legal-visual-shoulder";
    expect(() => parseRegionMapRecipe(JSON.stringify(wrongConstraint), identity))
      .toThrow(/nearest navigation diagnostic/i);

    const driftedHome = structuredClone(base);
    driftedHome.occupiedHomeObligations[0].approachBindings[0].doorAnchor =
      driftedHome.occupiedHomeObligations[0].approachBindings[1].doorAnchor;
    expect(() => parseRegionMapRecipe(JSON.stringify(driftedHome), identity))
      .toThrow(/exact shelter door/i);
  });

  it("keeps seed-84 Warm Springs local visuals out of the reviewed water crossing", () => {
    const recipe = createRegionMapRecipe(createRegionMapIdentity(84, world[3], world));
    const forbidden = new Set(["28,58", "28,59"]);
    const visualCells = recipe.visualPathCompositions.flatMap((path) => [
      ...path.centerlineCells,
      ...path.shoulderCells,
      ...path.clearingCells,
    ]);
    expect(visualCells.filter((cell) => forbidden.has(tileKey(cell)))).toEqual([]);
    expect(visualCells.filter((cell) => {
      const index = tileIndex(recipe.grid, cell);
      return recipe.grid.collision[index] !== 0 || recipe.waterVoidMask[index] !== 0;
    })).toEqual([]);
  });

  it("preserves exact seed-229 mechanics masks while repairing visual composition", () => {
    const regions = [...world, makeRegion("new_place", "mysterious shoreline", [])];
    const expected = {
      nirvana: [
        "f630875d77c58d62f8583169c31419212a626a779a8a17ae68b1fa34d84a2fbe",
        "2d07a41ae992770085117e9815300bfd0730745883e60b24aaad5e69dfc087ae",
        "b5ddf6c46a8ce52a62f2629ad88df0c1cb9bb49382994623c4939cfaa95da516",
        "acd66381abd18c9f1dd336f15d5b18d54798f82624a4652c2d24c650f6fb7739",
      ],
      nirvana_east: [
        "8690ada15798afc7c538516115069bbbdd5de01a2def619fe76282fd808df2bd",
        "2d07a41ae992770085117e9815300bfd0730745883e60b24aaad5e69dfc087ae",
        "ac583ff7bc57bf6b28f8f952b8d0131376112b4e81f6f6b4b2ec67c1a78f3fa6",
        "4b39fa8682557c34a11f34f528d334677f5404683bb8d12d1fc6f0d90b08664d",
      ],
      nirvana_west: [
        "428df0276285ebb9950a9ce38d89010218023b49cc4ec303aefc9d93cc5f8dae",
        "2d07a41ae992770085117e9815300bfd0730745883e60b24aaad5e69dfc087ae",
        "c3c2a84df979e772fb012ec1d187546af9a8c01b55ab3b7ca96d2378b23361d7",
        "e9735c58eb227a63e2762648ccfa8d2e6c4385a3cbe33ec7687fe078496a9679",
      ],
      warm_springs: [
        "4243c0a58d59e7fc7bf4b9edc3b0dd1ed0b488a801b85bcbf66834d8ded6b7c4",
        "a9270b56720dbce28aad9da9c0fb0523d71961d8cb927ca9aef39c3f2bf5bdf2",
        "d1a446c3d361cfd113d3089c2f59f30db3ead0db317aaefec57b7a445c1a9baa",
        "5c1ae71b0393ae1f274337dfb4eea1515546c04ad1aa58620fdeffc3b45b6873",
      ],
      new_place: [
        "20f2dfce349e6bca3c016b3123687987e89af33dc8c82215cd613458a711d2a8",
        "d97967fe22cdd8cd03fa5e8363ab8c5cf0f1c2e8087ddba23eae9b83d05e176d",
        "ad295106a8256f1259e7e7b2ed6aa100a8f085bd0d1930c464a380e2e2210aa7",
        "7fc6758def9907341c18245ebca121fc4059d47d036c7229bf781ef8355f5e30",
      ],
    } as const;
    const recipeHashes: Record<string, string> = {};
    for (const region of regions) {
      const recipe = createRegionMapRecipe(createRegionMapIdentity(229, region, regions));
      recipeHashes[region.name] = regionMapRecipeHash(recipe);
      const observed = [recipe.grid.collision, recipe.waterVoidMask, recipe.pathMask, recipe.soilMask]
        .map((mask) => createHash("sha256").update(mask).digest("hex"));
      expect(observed, region.name).toEqual(expected[region.name as keyof typeof expected]);
    }
    // Same authorised re-baseline. Only the FIRST digest of each region moved (collision);
    // water/path/soil are byte-identical above. The recipe hashes move for two reasons at
    // once: those 4 collision bytes, and `grid.topology` now being serialized.
    expect(recipeHashes).toEqual({
      nirvana: "8c3ef65b",
      nirvana_east: "eca03ecd",
      nirvana_west: "88ea5f43",
      warm_springs: "07bf276b",
      new_place: "b1e86289",
    });
  });

  it("keeps every satellite within three tiles of authored scenery, path, or settlement frontier", () => {
    const regions = [...world, makeRegion("new_place", "mysterious shoreline", [])];
    for (const region of regions) {
      const recipe = createRegionMapRecipe(createRegionMapIdentity(2, region, regions));
      const clusterMembers = recipe.staticScenery
        .filter((placement) => placement.clusterId !== null)
        .map((placement) => placement.tile);
      const frontier = [
        ...clusterMembers,
        ...maskTiles(recipe.pathMask, recipe.grid.columns),
        ...recipe.socialAnchors,
        ...recipe.resourceAnchors.energy,
        ...recipe.resourceAnchors.materials,
        ...recipe.shelterPlots.flatMap((plot) => [plot.tile, plot.door]),
      ];
      for (const satellite of recipe.staticScenery.filter((placement) => placement.clusterId === null)) {
        expect(Math.min(...frontier.map((tile) => manhattan(tile, satellite.tile))), satellite.id)
          .toBeLessThanOrEqual(3);
      }
    }
  });

  it("serializes broad terrain patches and visual path hierarchy as non-mechanical authored records", () => {
    const regions = [...world, makeRegion("new_place", "mysterious shoreline", [])];
    for (const region of regions) {
      const recipe = createRegionMapRecipe(createRegionMapIdentity(263, region, regions));
      const contract = recipe as any;
      const kit = getBiomeKit(recipe.kit) as any;
      const storyIds = new Set(contract.storyNeighborhoods.map((story: any) => story.id));
      expect(contract.terrainPatches.length, `${region.name}:patches`).toBeGreaterThanOrEqual(24);
      expect(contract.visualPathCompositions.length, `${region.name}:paths`).toBeGreaterThan(0);
      for (const patch of contract.terrainPatches) {
        expect(patch).toMatchObject({
          recordType: "terrain-patch",
          collisionBehavior: "visual-only",
          affectsMechanics: false,
        });
        expect(kit.sceneGrammar.terrainPatchRoles).toContain(patch.role);
        expect(patch.cells.length, patch.id).toBeGreaterThanOrEqual(9);
        expect(connectedComponents(patch.cells), patch.id).toHaveLength(1);
        expect(patch.footprint.widthTiles, patch.id).toBeGreaterThanOrEqual(3);
        expect(patch.footprint.heightTiles, patch.id).toBeGreaterThanOrEqual(3);
        expect(patch.storyOwnerIds.every((id: string) => storyIds.has(id)), patch.id).toBe(true);
      }
      for (const path of contract.visualPathCompositions) {
        expect(path).toMatchObject({
          recordType: "visual-path-composition",
          role: kit.sceneGrammar.visualPathRole,
          collisionBehavior: "visual-only",
          affectsMechanics: false,
        });
        expect(path.centerlineCells.length, path.id).toBeGreaterThan(0);
        expect(path.shoulderCells.length, path.id).toBeGreaterThan(0);
        expect(path.clearingCells.length, path.id).toBeGreaterThan(0);
        expect(path.centerlineCells.every((tile: any) =>
          recipe.pathMask[tile.row * recipe.grid.columns + tile.column] === 1), path.id).toBe(true);
        expect(connectedComponents(path.centerlineCells), `${path.id}:centerline`).toHaveLength(1);
        const hierarchy = [
          ...path.centerlineCells,
          ...path.shoulderCells,
          ...path.clearingCells,
        ];
        expect(connectedComponents(hierarchy), `${path.id}:hierarchy`).toHaveLength(1);
        const storiesById = new Map(contract.storyNeighborhoods.map((story: any) => [story.id, story]));
        expect(path.storyOwnerIds).toHaveLength(1);
        const owner = storiesById.get(path.storyOwnerIds[0]) as any;
        expect(owner.pathContext).toMatchObject({
          mode: "local-authoritative-path",
          visualPathCompositionId: path.id,
        });
        expect(path.centerlineCells).toContainEqual(owner.pathContext.contextAnchor);
        expect(path.footprint.widthTiles, `${path.id}:width`).toBeLessThanOrEqual(7);
        expect(path.footprint.heightTiles, `${path.id}:height`).toBeLessThanOrEqual(7);
        expect(path.shoulderCells.every((shoulder: any) => path.centerlineCells.some((cell: any) =>
          manhattan(cell, shoulder) === 1)), `${path.id}:shoulders`).toBe(true);
        expect(path.storyOwnerIds.every((id: string) => storyIds.has(id)), path.id).toBe(true);
      }
    }
  });

  it("keeps the exact seed-263 visual-path component table fully connected", () => {
    const regions = [...world, makeRegion("new_place", "mysterious shoreline", [])];
    const observed = Object.fromEntries(regions.map((region) => {
      const recipe = createRegionMapRecipe(createRegionMapIdentity(263, region, regions));
      return [region.name, {
        centerline: recipe.visualPathCompositions.map((path) => (
          connectedComponents(path.centerlineCells).length
        )),
        hierarchy: recipe.visualPathCompositions.map((path) => connectedComponents([
          ...path.centerlineCells,
          ...path.shoulderCells,
          ...path.clearingCells,
        ]).length),
      }];
    }));
    for (const [regionName, entry] of Object.entries(observed)) {
      expect(entry.centerline.length, `${regionName}:paths`).toBeGreaterThan(0);
      expect(entry.centerline.every((count) => count === 1), `${regionName}:centerline`).toBe(true);
      expect(entry.hierarchy.every((count) => count === 1), `${regionName}:hierarchy`).toBe(true);
    }
  });

  it("rejects a disconnected authoritative centerline island before canonical identity", () => {
    const identity = createRegionMapIdentity(263, world[0], world);
    const hostile = JSON.parse(
      serializeRegionMapRecipe(createRegionMapRecipe(identity)),
    ) as Record<string, any>;
    const path = hostile.visualPathCompositions[3];
    const hierarchyKeys = new Set([
      ...path.centerlineCells,
      ...path.shoulderCells,
      ...path.clearingCells,
    ].map(tileKey));
    const island = maskTiles(Uint8Array.from(hostile.pathMask), hostile.grid.columns)
      .find((tile) => !hierarchyKeys.has(tileKey(tile))
        && cardinalNeighbors(tile).every((neighbor) => !hierarchyKeys.has(tileKey(neighbor))));
    expect(island).toBeDefined();
    path.centerlineCells.push(island);
    const hierarchy = [...path.centerlineCells, ...path.shoulderCells, ...path.clearingCells];
    const columns = hierarchy.map((tile: any) => tile.column);
    const rows = hierarchy.map((tile: any) => tile.row);
    const minimumColumn = Math.min(...columns);
    const minimumRow = Math.min(...rows);
    path.footprint = {
      origin: { column: minimumColumn, row: minimumRow },
      widthTiles: Math.max(...columns) - minimumColumn + 1,
      heightTiles: Math.max(...rows) - minimumRow + 1,
    };

    expect(() => parseRegionMapRecipe(JSON.stringify(hostile), identity))
      .toThrow(/visual path centerline.*cardinally connected/i);
  });

  it("sweeps exact seeds 0-249 across all kits for bounded truthful local path composition", () => {
    const regions = [...world, makeRegion("new_place", "mysterious shoreline", [])];
    let maximumCenterlineComponents = 0;
    let maximumHierarchyComponents = 0;
    let maximumShoulderDistance = 0;
    let maximumFootprint = 0;
    let invalidVisualCells = 0;
    let localStories = 0;
    let detachedStories = 0;
    let inspectedPaths = 0;
    let inspectedRecipes = 0;
    for (let seed = 0; seed < 250; seed += 1) {
      for (const region of regions) {
        let recipe: RegionMapRecipeV1;
        try {
          recipe = createRegionMapRecipe(createRegionMapIdentity(seed, region, regions));
        } catch (error) {
          throw new Error(
            `exact-seed sweep failed for seed ${seed}, region ${region.name}`,
            { cause: error },
          );
        }
        inspectedRecipes += 1;
        localStories += recipe.storyNeighborhoods.filter((story) =>
          story.pathContext.mode === "local-authoritative-path").length;
        detachedStories += recipe.storyNeighborhoods.filter((story) =>
          story.pathContext.mode === "detached-no-crop-local-path").length;
        for (const path of recipe.visualPathCompositions) {
          maximumCenterlineComponents = Math.max(
            maximumCenterlineComponents,
            connectedComponents(path.centerlineCells).length,
          );
          maximumHierarchyComponents = Math.max(
            maximumHierarchyComponents,
            connectedComponents([
              ...path.centerlineCells,
              ...path.shoulderCells,
              ...path.clearingCells,
            ]).length,
          );
          maximumShoulderDistance = Math.max(maximumShoulderDistance, ...path.shoulderCells.map((shoulder) =>
            Math.min(...path.centerlineCells.map((centerline) => manhattan(centerline, shoulder)))));
          maximumFootprint = Math.max(maximumFootprint, path.footprint.widthTiles, path.footprint.heightTiles);
          invalidVisualCells += [
            ...path.centerlineCells,
            ...path.shoulderCells,
            ...path.clearingCells,
          ].filter((cell) => {
            const index = tileIndex(recipe.grid, cell);
            const rect = environmentRenderRect(cell);
            return recipe.grid.collision[index] !== 0 || recipe.waterVoidMask[index] !== 0
              || recipe.soilMask[index] !== 0
              || recipe.staticScenery.some((placement) => rectanglesOverlap(
                rect,
                environmentRenderRect(placement.tile),
              ))
              || recipe.shelterPlots.some((plot) => rectanglesOverlap(rect, shelterRenderRect(plot.tile)));
          }).length;
          inspectedPaths += 1;
        }
      }
    }
    expect({
      inspectedRecipes,
      inspectedPaths,
      stories: localStories + detachedStories,
      maximumCenterlineComponents,
      maximumHierarchyComponents,
      maximumShoulderDistance,
      maximumFootprint,
      invalidVisualCells,
      localStories,
      detachedStories,
    }).toEqual({
      inspectedRecipes: 1_250,
      inspectedPaths: localStories,
      stories: 35_000,
      maximumCenterlineComponents: 1,
      maximumHierarchyComponents: 1,
      maximumShoulderDistance: 1,
      maximumFootprint: 7,
      invalidVisualCells: 0,
      localStories: 17_467,
      detachedStories: 17_533,
    });
    expect(localStories).toBeGreaterThan(0);
    expect(detachedStories).toBeGreaterThan(0);
    // 1,250 generic recipes. Measured at 74.3 s ALONE on the reference machine, but this
    // runs inside a 9-worker suite that now also builds Nirvana West's own 300-seed sweep
    // concurrently, and under that contention it was measured at 98.6 s — i.e. the old
    // 90 s ceiling was inside the noise band, and the test began failing on scheduling
    // rather than on anything it asserts. Raised to 240 s: no assertion is weakened, and a
    // real regression in recipe cost would have to be >3x to hide here.
  }, 240_000);

  it("uses role-bound discriminated planned landmarks rather than ambiguous atlas-like strings", () => {
    const regions = [...world, makeRegion("new_place", "mysterious shoreline", [])];
    for (const region of regions) {
      const recipe = createRegionMapRecipe(createRegionMapIdentity(281, region, regions));
      const kit = getBiomeKit(recipe.kit) as any;
      for (const cluster of recipe.scenicClusters as any) {
        expect(cluster.plannedLandmarkKind).toBeUndefined();
        expect(cluster.plannedLandmark).toEqual(
          kit.sceneGrammar.plannedLandmarksByRole[cluster.role],
        );
        expect(cluster.plannedLandmark).toMatchObject({
          recordType: "planned-landmark",
          semanticRole: cluster.role,
          runtimeAtlasLookup: false,
        });
        expect(cluster.plannedLandmark.plannedId).toMatch(/^planned:/);
        expect(recipe.staticScenery.map((placement) => placement.kind))
          .not.toContain(cluster.plannedLandmark.plannedId);
      }
    }
  });

  it("fails closed for every canonical deterministic field and hostile array order", () => {
    const identity = createRegionMapIdentity(229, world[0], world);
    const base = JSON.parse(serializeRegionMapRecipe(createRegionMapRecipe(identity))) as Record<string, any>;
    const mutations: Array<readonly [string, (recipe: Record<string, any>) => void]> = [
      ["connected path", (recipe) => {
        const index = findOpenMutationIndex(recipe, (candidate) =>
          cardinalIndexes(candidate, recipe.grid.columns, recipe.grid.rows)
            .some((neighbor) => recipe.pathMask[neighbor] === 1));
        recipe.pathMask[index] = 1;
      }],
      ["invisible collision", (recipe) => {
        recipe.grid.collision[findOpenMutationIndex(recipe, () => true)] = 1;
      }],
      ["spawn anchor order", (recipe) => { recipe.spawnAnchors.reverse(); }],
      ["resource anchor order", (recipe) => { recipe.resourceAnchors.energy.reverse(); }],
      ["staging point order", (recipe) => { recipe.stagingPoints.reverse(); }],
      ["shelter plot order", (recipe) => { recipe.shelterPlots.reverse(); }],
      ["terrain patch order", (recipe) => { recipe.terrainPatches.reverse(); }],
      ["visual path mutation", (recipe) => { recipe.visualPathCompositions[0].role = "hostile-path"; }],
      ["story district order", (recipe) => { recipe.storyDistricts.reverse(); }],
      ["occupied-home obligation order", (recipe) => { recipe.occupiedHomeObligations.reverse(); }],
      ["gate-story reference mutation", (recipe) => {
        const story = recipe.storyNeighborhoods.find((candidate: any) =>
          candidate.anchorKind === "authoritative-gate");
        story.authoritativeGate.facing = story.authoritativeGate.facing === "north" ? "south" : "north";
      }],
      ["unknown root field", (recipe) => { recipe.inventedDeterministicField = true; }],
      ["unknown story field", (recipe) => { recipe.storyNeighborhoods[0].invented = true; }],
      ["unknown terrain field", (recipe) => { recipe.terrainPatches[0].invented = true; }],
      ["unknown visual path field", (recipe) => { recipe.visualPathCompositions[0].invented = true; }],
      ["unknown occupied-home field", (recipe) => { recipe.occupiedHomeObligations[0].invented = true; }],
    ];
    for (const [label, mutate] of mutations) {
      const hostile = structuredClone(base);
      mutate(hostile);
      expect(() => parseRegionMapRecipe(JSON.stringify(hostile), identity), label).toThrow();
    }

    const isolated = makeRegion("quiet_island", "mysterious shoreline", []);
    const isolatedIdentity = createRegionMapIdentity(229, isolated, [isolated]);
    const isolatedRecipe = JSON.parse(
      serializeRegionMapRecipe(createRegionMapRecipe(isolatedIdentity)),
    ) as Record<string, any>;
    isolatedRecipe.gateStoryTopology = { mode: "isolated", reason: "silently-empty" };
    expect(() => parseRegionMapRecipe(JSON.stringify(isolatedRecipe), isolatedIdentity)).toThrow();
  });

  it("rejects structurally legal alternate water and soil components under the same identity", () => {
    const waterIdentity = createRegionMapIdentity(233, world[3], world);
    const waterBase = JSON.parse(
      serializeRegionMapRecipe(createRegionMapRecipe(waterIdentity)),
    ) as Record<string, any>;
    const alternateWater = findCanonicalOnlyComponentTranslation(
      waterBase,
      waterIdentity,
      "waterVoidMask",
      true,
    );
    expect(() => parseRegionMapRecipe(JSON.stringify(alternateWater), waterIdentity))
      .toThrow(/canonical deterministic fields/i);

    const soilIdentity = createRegionMapIdentity(229, world[0], world);
    const soilBase = JSON.parse(
      serializeRegionMapRecipe(createRegionMapRecipe(soilIdentity)),
    ) as Record<string, any>;
    const alternateSoil = findCanonicalOnlyComponentTranslation(
      soilBase,
      soilIdentity,
      "soilMask",
      false,
    );
    expect(() => parseRegionMapRecipe(JSON.stringify(alternateSoil), soilIdentity))
      .toThrow(/canonical deterministic fields/i);
  });

  it("keeps every critical path and shelter approach clear for the full standing-human envelope", () => {
    for (const region of world) {
      const recipe = createRegionMapRecipe(createRegionMapIdentity(239, region, world));
      const sceneryRects = recipe.staticScenery.map((placement) => ({
        placement,
        rect: sceneryVisualRect(placement),
      }));
      const criticalFeet = [
        ...maskTiles(recipe.pathMask, recipe.grid.columns).map(tileCenter),
        ...recipe.shelterPlots.map((plot) => tileCenter(plot.door)),
      ];
      for (const feet of criticalFeet) {
        const actor = rectToTestRect(feetAnchoredVisualRect(feet));
        expect(sceneryRects.filter(({ rect }) => rectanglesOverlap(actor, rect)),
          `${region.name}@${feet.x},${feet.y}`).toEqual([]);
      }
    }
  });

  it("derives every collision byte from visible hard footprints and canonical mechanics sources", () => {
    const regions = [...world, makeRegion("new_place", "mysterious shoreline", [])];
    for (const region of regions) {
      const recipe = createRegionMapRecipe(createRegionMapIdentity(239, region, regions));
      const derived = Uint8Array.from(recipe.edgeMask);
      const near = 16;
      const far = 79;
      for (let coordinate = near; coordinate <= far; coordinate += 1) {
        for (const tile of [
          { column: coordinate, row: near },
          { column: far, row: coordinate },
          { column: coordinate, row: far },
          { column: near, row: coordinate },
        ]) derived[tile.row * recipe.grid.columns + tile.column] = 1;
      }
      for (const gate of recipe.gates) derived[tileIndex(recipe.grid, gate.tile)] = 0;
      for (const [index, value] of recipe.pathMask.entries()) if (value === 1) derived[index] = 0;
      for (const [index, value] of recipe.soilMask.entries()) if (value === 1) derived[index] = 0;
      for (const [index, value] of recipe.waterVoidMask.entries()) if (value === 1) derived[index] = 1;
      for (const placement of recipe.staticScenery) {
        derived[tileIndex(recipe.grid, placement.tile)] = placement.blocksMovement ? 1 : 0;
        for (const offset of placement.hardCollisionFootprint) {
          derived[(placement.tile.row + offset.row) * recipe.grid.columns
            + placement.tile.column + offset.column] = 1;
        }
      }
      // Topology activation is the build's LAST collision step: the published rim re-opens
      // at up to one reciprocal seam per axis (see `deriveWrapSeamCandidates`). Mirrored
      // here rather than pinned, so this stays an independent derivation of every byte.
      applyWrapSeams(
        derived,
        recipe.grid.columns,
        recipe.grid.rows,
        deriveWrapSeamCandidates(
          derived,
          recipe.grid.columns,
          recipe.grid.rows,
          [recipe.waterVoidMask],
        ),
      );
      expect([...recipe.grid.collision], `${region.name}:collision derivation`).toEqual([...derived]);
      expect(recipe.grid.topology, `${region.name}:walk topology`).toBe("toroidal");
      expect(wrapSeamViolations(recipe.grid), `${region.name}:seam reciprocity`).toEqual([]);

      const blockingSatellites = recipe.staticScenery.filter((placement) =>
        placement.clusterId === null && placement.blocksMovement);
      expect(recipe.staticScenery.filter((placement) => placement.clusterId === null),
        `${region.name}:satellite collision diagnostics`).toHaveLength(24);
      expect(blockingSatellites.length, `${region.name}:blocking satellite diagnostics`)
        .toBeGreaterThan(0);
      expect(blockingSatellites.every((placement) =>
        placement.hardCollisionFootprint.length === 1)).toBe(true);
    }
  });

  it("limits legacy-scatter collision deltas to moved visible blocking satellite footprints", () => {
    const regions = [...world, makeRegion("new_place", "mysterious shoreline", [])];
    const diagnostics: Array<Readonly<{
      region: string;
      movedBlockingFootprints: number;
      addedCollisionCells: number;
      removedCollisionCells: number;
    }>> = [];
    for (const region of regions) {
      const identity = createRegionMapIdentity(239, region, regions);
      const recipe = createRegionMapRecipe(identity);
      const legacySatellites = reconstructLegacySatellitePlacements(recipe, identity.runSeed);
      const currentSatellites = recipe.staticScenery.filter((placement) => placement.clusterId === null);
      expect(legacySatellites).toHaveLength(currentSatellites.length);

      const legacyCollision = Uint8Array.from(recipe.grid.collision);
      let movedBlockingFootprints = 0;
      for (const [index, current] of currentSatellites.entries()) {
        if (!current.blocksMovement) continue;
        const legacy = legacySatellites[index]!;
        if (tileKey(current.tile) !== tileKey(legacy)) movedBlockingFootprints += 1;
        legacyCollision[tileIndex(recipe.grid, current.tile)] = 0;
        legacyCollision[tileIndex(recipe.grid, legacy)] = 1;
      }
      const added = recipe.grid.collision.reduce((count, value, index) =>
        count + (value === 1 && legacyCollision[index] === 0 ? 1 : 0), 0);
      const removed = recipe.grid.collision.reduce((count, value, index) =>
        count + (value === 0 && legacyCollision[index] === 1 ? 1 : 0), 0);
      expect({ added, removed }).toEqual({
        added: movedBlockingFootprints,
        removed: movedBlockingFootprints,
      });
      diagnostics.push({
        region: region.name,
        movedBlockingFootprints,
        addedCollisionCells: added,
        removedCollisionCells: removed,
      });
    }
    expect(diagnostics).toEqual([
      { region: "nirvana", movedBlockingFootprints: 8, addedCollisionCells: 8, removedCollisionCells: 8 },
      { region: "nirvana_east", movedBlockingFootprints: 8, addedCollisionCells: 8, removedCollisionCells: 8 },
      { region: "nirvana_west", movedBlockingFootprints: 16, addedCollisionCells: 16, removedCollisionCells: 16 },
      { region: "warm_springs", movedBlockingFootprints: 8, addedCollisionCells: 8, removedCollisionCells: 8 },
      { region: "new_place", movedBlockingFootprints: 8, addedCollisionCells: 8, removedCollisionCells: 8 },
    ]);
  });

  it("rejects singleton scatter and visual footprints wider than their hard collision declaration", () => {
    const identity = createRegionMapIdentity(241, world[0], world);
    const base = JSON.parse(serializeRegionMapRecipe(createRegionMapRecipe(identity))) as Record<string, any>;

    const singletonScatter = structuredClone(base);
    singletonScatter.staticScenery.forEach((placement: any) => {
      placement.clusterId = null;
      placement.role = "satellite-accent";
    });
    singletonScatter.scenicClusters = [];
    expect(() => parseRegionMapRecipe(JSON.stringify(singletonScatter), identity))
      .toThrow(/seventy percent|connected scenic composition|scenic landmarks/i);

    const underspecifiedHardFootprint = structuredClone(base);
    const blocking = underspecifiedHardFootprint.staticScenery.find((placement: any) =>
      placement.blocksMovement);
    blocking.visualFootprint = { widthTiles: 2, heightTiles: 1 };
    expect(() => parseRegionMapRecipe(JSON.stringify(underspecifiedHardFootprint), identity))
      .toThrow(/visual footprint.*hard collision footprint/i);
  });

  it("authors connected organic paths and bounded soil clearings without occupying mechanics", () => {
    const unknown = makeRegion("new_place", "mysterious shoreline", []);
    const regions = [...world, unknown];
    for (const region of regions) {
      const recipe = createRegionMapRecipe(createRegionMapIdentity(263, region, regions));
      const pathTiles = maskTiles(recipe.pathMask, recipe.grid.columns);
      const soilTiles = maskTiles(recipe.soilMask, recipe.grid.columns);
      expect(pathTiles.length, `${region.name} path density`).toBeGreaterThanOrEqual(80);
      expect(pathTiles.length, `${region.name} path bound`).toBeLessThanOrEqual(1_440);
      expect(soilTiles, `${region.name} soil density`).toHaveLength(8 * 15);

      for (const gate of recipe.gates) expect(recipe.pathMask[tileIndex(recipe.grid, gate.tile)]).toBe(1);
      for (const anchor of recipe.socialAnchors) expect(recipe.pathMask[tileIndex(recipe.grid, anchor)]).toBe(1);
      expect(connectedMaskSize(recipe.pathMask, recipe.grid.columns, recipe.grid.rows)).toBe(pathTiles.length);

      const pathKeys = new Set(pathTiles.map(tileKey));
      const soilKeys = new Set(soilTiles.map(tileKey));
      const waterKeys = new Set(maskTiles(recipe.waterVoidMask, recipe.grid.columns).map(tileKey));
      const sceneryKeys = new Set([
        ...recipe.staticScenery.map((placement) => tileKey(placement.tile)),
        ...recipe.animatedEnvironment.map((placement) => tileKey(placement.tile)),
      ]);
      const anchors = [
        ...recipe.gates.map((gate) => gate.tile), ...recipe.arrivalAnchors,
        ...recipe.spawnAnchors, ...recipe.socialAnchors,
        ...recipe.resourceAnchors.energy, ...recipe.resourceAnchors.materials,
        ...recipe.stagingAnchors,
        ...recipe.shelterPlots.flatMap((plot) => [plot.tile, plot.door]),
      ];
      const anchorKeys = new Set(anchors.map(tileKey));
      for (const tile of pathTiles) {
        expect(recipe.grid.collision[tileIndex(recipe.grid, tile)]).toBe(0);
        expect(waterKeys.has(tileKey(tile))).toBe(false);
        expect(sceneryKeys.has(tileKey(tile))).toBe(false);
      }
      for (const tile of soilTiles) {
        expect(recipe.grid.collision[tileIndex(recipe.grid, tile)]).toBe(0);
        expect(pathKeys.has(tileKey(tile))).toBe(false);
        expect(waterKeys.has(tileKey(tile))).toBe(false);
        expect(anchorKeys.has(tileKey(tile))).toBe(false);
        expect(sceneryKeys.has(tileKey(tile))).toBe(false);
      }
      for (const district of recipe.districts) {
        const localSoil = soilTiles.filter((tile) => inDistrict(tile, district.origin));
        expect(localSoil, `${region.name} district ${district.index} soil`).toHaveLength(15);
        const soilComponents = connectedComponents(localSoil);
        expect(soilComponents, `${region.name} district ${district.index} soil patches`).toHaveLength(3);
        expect(soilComponents.map((component) => component.length).sort((left, right) => left - right),
          `${region.name} district ${district.index} soil patch sizes`).toEqual([5, 5, 5]);
        expect(soilComponents.every(isIrregularComponent),
          `${region.name} district ${district.index} soil patch shape`).toBe(true);
        const authoredSpaces = [
          ...district.socialAnchors,
          ...district.shelterPlots.flatMap((plot) => [plot.tile, plot.door]),
          recipe.resourceAnchors.energy[district.index],
          recipe.resourceAnchors.materials[district.index],
        ];
        expect(localSoil.every((tile) => authoredSpaces.some((anchor) => manhattan(tile, anchor) <= 7))).toBe(true);
      }

      const occupiedRows = new Set(pathTiles.map((tile) => tile.row));
      const occupiedColumns = new Set(pathTiles.map((tile) => tile.column));
      expect(occupiedRows.size).toBeGreaterThanOrEqual(12);
      expect(occupiedColumns.size).toBeGreaterThanOrEqual(12);
      expect(pathTiles.some((tile) => tile.row % 4 !== 0 && tile.column % 4 !== 0)).toBe(true);
    }
  });

  it("authors exact connected irregular pond bodies with usable cardinal shoreline", () => {
    const unknown = makeRegion("new_place", "mysterious shoreline", []);
    const regions = [...world, unknown];
    for (const region of regions) {
      const identity = createRegionMapIdentity(331, region, regions);
      const recipe = createRegionMapRecipe(identity);
      const reloaded = parseRegionMapRecipe(serializeRegionMapRecipe(recipe), identity);
      expect(regionMapRecipeHash(reloaded), `${region.name} pond roundtrip`).toBe(regionMapRecipeHash(recipe));
      const waterTiles = maskTiles(recipe.waterVoidMask, recipe.grid.columns);
      const bodies = connectedComponents(waterTiles);
      const expectedSizes = recipe.kit === "spring-terraces"
        ? [14, 14]
        : recipe.kit === "neutral-temperate" ? [10] : [];
      expect(waterTiles, `${region.name} water budget`).toHaveLength(expectedSizes.reduce((sum, size) => sum + size, 0));
      expect(bodies.map((body) => body.length).sort((left, right) => left - right),
        `${region.name} pond body sizes`).toEqual(expectedSizes);
      expect(bodies.every(isIrregularComponent), `${region.name} pond perimeter`).toBe(true);
      for (const body of bodies) {
        expect(hasEligibleShoreNeighbor(body, recipe.grid.collision, recipe.grid.columns, recipe.grid.rows),
          `${region.name} pond shoreline`).toBe(true);
      }
    }
  });

  it("uses only its biome kinds while keeping all placements unique and canonical spaces clear", () => {
    const unknown = makeRegion("new_place", "mysterious shoreline", []);
    const regions = [...world, unknown];
    for (const region of regions) {
      const recipe = createRegionMapRecipe(createRegionMapIdentity(307, region, regions));
      const kit = getBiomeKit(recipe.kit);
      const blockingKinds = new Set(kit.blockingScenery);
      const staticKinds = new Set(recipe.staticScenery.map((placement) => placement.kind));
      const animatedKinds = new Set(recipe.animatedEnvironment.map((placement) => placement.kind));
      expect(staticKinds).toEqual(new Set([...kit.blockingScenery, ...kit.passiveScenery]));
      expect(animatedKinds).toEqual(new Set(kit.animatedKinds));
      for (const placement of recipe.staticScenery) {
        expect(placement.blocksMovement).toBe(blockingKinds.has(placement.kind));
      }

      const reserved = new Set([
        ...recipe.gates.map((gate) => gate.tile), ...recipe.arrivalAnchors,
        ...recipe.spawnAnchors, ...recipe.socialAnchors,
        ...recipe.resourceAnchors.energy, ...recipe.resourceAnchors.materials,
        ...recipe.stagingAnchors,
        ...recipe.shelterPlots.flatMap((plot) => [plot.tile, plot.door]),
      ].map(tileKey));
      const sceneryTiles = [
        ...recipe.staticScenery.map((placement) => placement.tile),
        ...recipe.animatedEnvironment.map((placement) => placement.tile),
      ];
      expect(sceneryTiles.every((tile) => !reserved.has(tileKey(tile)))).toBe(true);

      const waterTiles = Array.from(recipe.waterVoidMask.entries())
        .filter(([, value]) => value === 1)
        .map(([index]) => ({ column: index % recipe.grid.columns, row: Math.floor(index / recipe.grid.columns) }));
      const claimed = [...waterTiles, ...sceneryTiles].map(tileKey);
      expect(new Set(claimed).size).toBe(claimed.length);
    }
  });

  it("keeps dense composition byte-stable through recreation and serialization", () => {
    const identity = createRegionMapIdentity(509, world[2], world);
    const first = createRegionMapRecipe(identity);
    const second = createRegionMapRecipe(identity);
    const reloaded = parseRegionMapRecipe(serializeRegionMapRecipe(first), identity);
    expect(second.staticScenery).toEqual(first.staticScenery);
    expect(second.scenicClusters).toEqual(first.scenicClusters);
    expect(second.storyNeighborhoods).toEqual(first.storyNeighborhoods);
    expect(second.animatedEnvironment).toEqual(first.animatedEnvironment);
    expect(regionMapRecipeHash(second)).toBe(regionMapRecipeHash(first));
    expect(serializeRegionMapRecipe(reloaded)).toBe(serializeRegionMapRecipe(first));
    expect(regionMapRecipeHash(reloaded)).toBe(regionMapRecipeHash(first));

    const otherSeed = createRegionMapRecipe(createRegionMapIdentity(510, world[2], world));
    expect(otherSeed.staticScenery).not.toEqual(first.staticScenery);
    expect(otherSeed.scenicClusters).not.toEqual(first.scenicClusters);
    expect(otherSeed.animatedEnvironment).not.toEqual(first.animatedEnvironment);
  });

  it("rejects persisted recipes that weaken the dense biome composition contract", () => {
    const identity = createRegionMapIdentity(613, world[0], world);
    const recipe = createRegionMapRecipe(identity);
    const base = JSON.parse(serializeRegionMapRecipe(recipe)) as Record<string, any>;

    const sparseStatic = structuredClone(base);
    const removedStatic = sparseStatic.staticScenery.pop();
    sparseStatic.grid.collision[removedStatic.tile.row * sparseStatic.grid.columns + removedStatic.tile.column] = 0;
    expect(() => parseRegionMapRecipe(JSON.stringify(sparseStatic), identity)).toThrow(/static scenery composition/i);

    const sparseAnimated = structuredClone(base);
    sparseAnimated.animatedEnvironment.pop();
    expect(() => parseRegionMapRecipe(JSON.stringify(sparseAnimated), identity)).toThrow(/animated environment composition/i);

    const foreignKind = structuredClone(base);
    foreignKind.staticScenery[0].kind = "dragon-statue";
    expect(() => parseRegionMapRecipe(JSON.stringify(foreignKind), identity)).toThrow(/static scenery kind.*biome/i);

    const falseCollision = structuredClone(base);
    const passive = falseCollision.staticScenery.find((placement: any) => !placement.blocksMovement);
    passive.blocksMovement = true;
    falseCollision.grid.collision[passive.tile.row * falseCollision.grid.columns + passive.tile.column] = 1;
    expect(() => parseRegionMapRecipe(JSON.stringify(falseCollision), identity)).toThrow(/movement flag.*biome/i);
  });

  it("rejects vacuous, periodic, disconnected, colliding, or malformed presentation masks", () => {
    const identity = createRegionMapIdentity(719, world[0], world);
    const recipe = createRegionMapRecipe(identity);
    const base = JSON.parse(serializeRegionMapRecipe(recipe)) as Record<string, any>;

    const emptyPath = structuredClone(base);
    emptyPath.pathMask.fill(0);
    expect(() => parseRegionMapRecipe(JSON.stringify(emptyPath), identity)).toThrow(/path mask/i);

    const gateOnly = structuredClone(base);
    gateOnly.pathMask.fill(0);
    for (const gate of gateOnly.gates) gateOnly.pathMask[gate.tile.row * gateOnly.grid.columns + gate.tile.column] = 1;
    expect(() => parseRegionMapRecipe(JSON.stringify(gateOnly), identity)).toThrow(/path mask/i);

    const periodicGrid = structuredClone(base);
    periodicGrid.pathMask.fill(0);
    for (let row = 8; row < periodicGrid.grid.rows - 1; row += 16) {
      for (let column = 1; column < periodicGrid.grid.columns - 1; column += 1) {
        const index = row * periodicGrid.grid.columns + column;
        if (periodicGrid.grid.collision[index] === 0) periodicGrid.pathMask[index] = 1;
      }
    }
    for (let column = 8; column < periodicGrid.grid.columns - 1; column += 16) {
      for (let row = 1; row < periodicGrid.grid.rows - 1; row += 1) {
        const index = row * periodicGrid.grid.columns + column;
        if (periodicGrid.grid.collision[index] === 0) periodicGrid.pathMask[index] = 1;
      }
    }
    expect(() => parseRegionMapRecipe(JSON.stringify(periodicGrid), identity)).toThrow(/path mask.*straight periodic grid/i);

    const disconnected = structuredClone(base);
    const firstGate = disconnected.gates[0].tile;
    for (const tile of cardinalNeighbors(firstGate)) {
      disconnected.pathMask[tile.row * disconnected.grid.columns + tile.column] = 0;
    }
    expect(() => parseRegionMapRecipe(JSON.stringify(disconnected), identity)).toThrow(/path mask.*connected/i);

    const colliding = structuredClone(base);
    const canonicalAnchorIndexes = new Set([
      ...colliding.gates.map((gate: any) => gate.tile), ...colliding.arrivalAnchors,
      ...colliding.spawnAnchors, ...colliding.socialAnchors,
      ...colliding.resourceAnchors.energy, ...colliding.resourceAnchors.materials,
      ...colliding.stagingAnchors,
      ...colliding.shelterPlots.flatMap((plot: any) => [plot.tile, plot.door]),
    ].map((tile: any) => tile.row * colliding.grid.columns + tile.column));
    const firstDistrictOrigin = colliding.districts[0].origin;
    const collisionIndex = colliding.pathMask.findIndex((value: number, index: number) =>
      value === 1 && !canonicalAnchorIndexes.has(index) && inDistrict({
        column: index % colliding.grid.columns,
        row: Math.floor(index / colliding.grid.columns),
      }, firstDistrictOrigin));
    colliding.grid.collision[collisionIndex] = 1;
    expect(() => parseRegionMapRecipe(JSON.stringify(colliding), identity)).toThrow(/path mask.*collision/i);

    const vacuousSoil = structuredClone(base);
    vacuousSoil.soilMask.fill(0);
    expect(() => parseRegionMapRecipe(JSON.stringify(vacuousSoil), identity)).toThrow(/soil mask/i);

    const overlappingSoil = structuredClone(base);
    const formerSoil = overlappingSoil.soilMask.findIndex((value: number) => value === 1);
    overlappingSoil.soilMask[formerSoil] = 0;
    overlappingSoil.soilMask[collisionIndex] = 1;
    expect(() => parseRegionMapRecipe(JSON.stringify(overlappingSoil), identity)).toThrow(/category overlap.*soil.*path|category overlap.*path.*soil/i);

    const shortPath = structuredClone(base);
    shortPath.pathMask.pop();
    expect(() => parseRegionMapRecipe(JSON.stringify(shortPath), identity)).toThrow(/pathMask/);

    const missingSoil = structuredClone(base);
    delete missingSoil.soilMask;
    expect(() => parseRegionMapRecipe(JSON.stringify(missingSoil), identity)).toThrow(/soilMask/);
  });

  it("rejects scattered ponds, invented dry-biome water, and disconnected soil patches", () => {
    const wetIdentity = createRegionMapIdentity(811, world[3], world);
    const wetBase = JSON.parse(serializeRegionMapRecipe(createRegionMapRecipe(wetIdentity))) as Record<string, any>;
    const scatteredWater = structuredClone(wetBase);
    const movedWaterIndex = scatteredWater.waterVoidMask.findIndex((value: number) => value === 1);
    const isolatedWaterIndex = findOpenMutationIndex(scatteredWater, (index) =>
      cardinalIndexes(index, scatteredWater.grid.columns, scatteredWater.grid.rows)
        .every((neighbor) => scatteredWater.waterVoidMask[neighbor] === 0));
    scatteredWater.waterVoidMask[movedWaterIndex] = 0;
    scatteredWater.grid.collision[movedWaterIndex] = 0;
    scatteredWater.waterVoidMask[isolatedWaterIndex] = 1;
    scatteredWater.grid.collision[isolatedWaterIndex] = 1;
    expect(() => parseRegionMapRecipe(JSON.stringify(scatteredWater), wetIdentity)).toThrow(/water.*connected|water.*component/i);

    const dryIdentity = createRegionMapIdentity(812, world[2], world);
    const dryBase = JSON.parse(serializeRegionMapRecipe(createRegionMapRecipe(dryIdentity))) as Record<string, any>;
    const inventedWater = structuredClone(dryBase);
    const inventedWaterIndex = findOpenMutationIndex(inventedWater, () => true);
    inventedWater.waterVoidMask[inventedWaterIndex] = 1;
    inventedWater.grid.collision[inventedWaterIndex] = 1;
    expect(() => parseRegionMapRecipe(JSON.stringify(inventedWater), dryIdentity)).toThrow(/water.*exact|water.*zero|water.*budget/i);

    const disconnectedSoil = structuredClone(wetBase);
    const soilIndexes = disconnectedSoil.soilMask
      .map((value: number, index: number) => value === 1 ? index : -1)
      .filter((index: number) => index >= 0);
    const movedSoilIndex = soilIndexes[0];
    const movedSoilTile = {
      column: movedSoilIndex % disconnectedSoil.grid.columns,
      row: Math.floor(movedSoilIndex / disconnectedSoil.grid.columns),
    };
    const district = disconnectedSoil.districts.find((value: any) => inDistrict(movedSoilTile, value.origin));
    const isolatedSoilIndex = findOpenMutationIndex(disconnectedSoil, (index) => {
      const tile = { column: index % disconnectedSoil.grid.columns, row: Math.floor(index / disconnectedSoil.grid.columns) };
      if (!inDistrict(tile, district.origin)) return false;
      if (cardinalIndexes(index, disconnectedSoil.grid.columns, disconnectedSoil.grid.rows)
        .some((neighbor) => disconnectedSoil.soilMask[neighbor] === 1)) return false;
      const authoredSpaces = [
        ...district.socialAnchors,
        ...district.shelterPlots.flatMap((plot: any) => [plot.tile, plot.door]),
        disconnectedSoil.resourceAnchors.energy[district.index],
        disconnectedSoil.resourceAnchors.materials[district.index],
      ];
      return authoredSpaces.some((anchor: any) => manhattan(tile, anchor) <= 7);
    });
    disconnectedSoil.soilMask[movedSoilIndex] = 0;
    disconnectedSoil.soilMask[isolatedSoilIndex] = 1;
    expect(() => parseRegionMapRecipe(JSON.stringify(disconnectedSoil), wetIdentity)).toThrow(/soil.*connected|soil.*component/i);
  });

  it("uses frozen C00 identity and topology truth", () => {
    const fixture = loadFixture("C00-world-four-regions-topology.json");
    const fixtureRegions = fixture.initialSnapshot.regions as RegionSnapshot[];
    const recipes = fixtureRegions.map((region) => createRegionMapRecipe(createRegionMapIdentity(fixture.seed, region, fixtureRegions)));
    expect(fixture.id).toBe("C00");
    expect(recipes.map((recipe) => recipe.kit).sort()).toEqual(["ash-waste", "dry-scrub", "spring-terraces", "worn-heartland"]);
    expect(recipes.flatMap((recipe) => recipe.gates).filter((gate) => gate.role === "departure")).toHaveLength(10);
    expect(recipes.find((recipe) => recipe.regionId === "nirvana_east")!.gates.some((gate) => gate.role === "departure" && gate.edge.to === "nirvana_west")).toBe(false);
  });

  it("rejects malformed nested recipe records with stable boundary errors", () => {
    const identity = createRegionMapIdentity(101, world[0], world);
    const recipe = createRegionMapRecipe(identity);
    const base = JSON.parse(serializeRegionMapRecipe(recipe)) as Record<string, any>;
    const cases: readonly [string, (copy: Record<string, any>) => void, RegExp][] = [
      ["kit", (copy) => { delete copy.kit; }, /recipe\.kit/],
      ["identity", (copy) => { copy.identityHash = "not-a-hash"; }, /identityHash/],
      ["resources", (copy) => { delete copy.resourceAnchors.materials; }, /resourceAnchors\.materials/],
      ["static", (copy) => { delete copy.staticScenery[0].blocksMovement; }, /staticScenery/],
      ["static ID", (copy) => { copy.staticScenery[1].id = copy.staticScenery[0].id; }, /duplicate static scenery ID/],
      ["static tile", (copy) => { copy.staticScenery[1].tile = copy.staticScenery[0].tile; }, /duplicate static scenery tile/],
      ["animated", (copy) => { copy.animatedEnvironment[0].kind = "dragon"; }, /animatedEnvironment/],
      ["animated ID", (copy) => { copy.animatedEnvironment[1].id = copy.animatedEnvironment[0].id; }, /duplicate animated environment ID/],
      ["animated tile", (copy) => { copy.animatedEnvironment[1].tile = copy.animatedEnvironment[0].tile; }, /duplicate animated environment tile/],
      ["district", (copy) => { delete copy.districts[0].shelterPlots; }, /districts/],
      ["district plot drift", (copy) => { copy.districts[0].shelterPlots[0].id = "drifted"; }, /district shelter plots/],
      ["district staging drift", (copy) => { copy.districts[0].stagingAnchors[0] = { column: 40, row: 40 }; }, /district staging anchors/],
      ["plot", (copy) => { copy.shelterPlots[1].id = copy.shelterPlots[0].id; }, /duplicate shelter plot/],
      ["gate", (copy) => { copy.gates[0].role = "reverse"; }, /gates/],
      ["gate tile", (copy) => { copy.gates[1].tile = copy.gates[0].tile; }, /duplicate gate tile/],
      ["terrain patch", (copy) => { delete copy.terrainPatches[0].cells; }, /terrainPatches/],
      ["visual path", (copy) => { copy.visualPathCompositions[0].centerlineCells = []; }, /visual path/],
      ["occupied home", (copy) => { copy.occupiedHomeObligations[0].activation = "always"; }, /occupied-home/],
      ["gate topology", (copy) => { copy.gateStoryTopology.mode = "isolated"; }, /gate story topology/],
      ["planned landmark", (copy) => { copy.scenicClusters[0].plannedLandmark.runtimeAtlasLookup = true; }, /planned landmark/],
      ["arrival exactness", (copy) => { copy.arrivalAnchors.pop(); }, /arrival anchors/],
    ];
    for (const [label, mutate, message] of cases) {
      const copy = structuredClone(base);
      mutate(copy);
      expect(() => parseRegionMapRecipe(JSON.stringify(copy), identity), label).toThrow(message);
    }
  });

  it("rejects unrelated or duplicated gate roles and category overlap", () => {
    const identity = createRegionMapIdentity(401, world[0], world);
    const recipe = createRegionMapRecipe(identity);
    const base = JSON.parse(serializeRegionMapRecipe(recipe)) as Record<string, any>;

    const unrelated = structuredClone(base);
    const firstGate = unrelated.gates[0];
    if (firstGate.role === "departure") firstGate.edge.from = "unrelated";
    else firstGate.edge.to = "unrelated";
    expect(() => parseRegionMapRecipe(JSON.stringify(unrelated), identity)).toThrow(/gate role.*region/i);

    const duplicateRole = structuredClone(base);
    const departure = duplicateRole.gates.find((gate: any) => gate.role === "departure");
    const used = new Set(duplicateRole.gates.map((gate: any) => `${gate.tile.column},${gate.tile.row}`));
    const column = Array.from({ length: duplicateRole.grid.columns - 4 }, (_, index) => index + 2)
      .find((candidate) => !used.has(`${candidate},1`))!;
    duplicateRole.gates.push({ ...structuredClone(departure), tile: { column, row: 1 }, facing: "north" });
    expect(() => parseRegionMapRecipe(JSON.stringify(duplicateRole), identity)).toThrow(/duplicate gate role/i);

    const staticOverlap = structuredClone(base);
    const passive = staticOverlap.staticScenery.find((item: any) => !item.blocksMovement);
    passive.tile = structuredClone(staticOverlap.spawnAnchors[0]);
    expect(() => parseRegionMapRecipe(JSON.stringify(staticOverlap), identity)).toThrow(/category overlap/i);

    const animatedOverlap = structuredClone(base);
    animatedOverlap.animatedEnvironment[0].tile = structuredClone(animatedOverlap.staticScenery[0].tile);
    expect(() => parseRegionMapRecipe(JSON.stringify(animatedOverlap), identity)).toThrow(/category overlap/i);
  });

  it("rejects invented, substituted, or deleted gates against the expected identity", () => {
    const graph = [makeRegion("alpha", "unknown coast", ["beta"]), makeRegion("beta", "unknown coast", [])];
    const alphaIdentity = createRegionMapIdentity(451, graph[0], graph);
    const betaIdentity = createRegionMapIdentity(451, graph[1], graph);
    const alphaRecipe = createRegionMapRecipe(alphaIdentity);
    const betaRecipe = createRegionMapRecipe(betaIdentity);

    expect(parseRegionMapRecipe(serializeRegionMapRecipe(alphaRecipe), alphaIdentity)).toEqual(alphaRecipe);

    const inventedDestination = JSON.parse(serializeRegionMapRecipe(alphaRecipe)) as Record<string, any>;
    inventedDestination.gates[0].edge.to = "invented";
    expect(() => parseRegionMapRecipe(JSON.stringify(inventedDestination), alphaIdentity))
      .toThrow(/expected identity topology|exact authoritative directed gate/i);

    const inventedOrigin = JSON.parse(serializeRegionMapRecipe(betaRecipe)) as Record<string, any>;
    inventedOrigin.gates[0].edge.from = "invented";
    expect(() => parseRegionMapRecipe(JSON.stringify(inventedOrigin), betaIdentity))
      .toThrow(/expected identity topology|exact authoritative directed gate/i);

    const deleted = JSON.parse(serializeRegionMapRecipe(alphaRecipe)) as Record<string, any>;
    deleted.gates = [];
    expect(() => parseRegionMapRecipe(JSON.stringify(deleted), alphaIdentity))
      .toThrow(/expected identity topology|every authoritative gate/i);
  });

  it("rejects a gate isolated from canonical anchors", () => {
    let fixture: Readonly<{
      identity: ReturnType<typeof createRegionMapIdentity>;
      recipe: ReturnType<typeof createRegionMapRecipe>;
    }> | null = null;
    for (let index = 0; index < 32 && fixture === null; index += 1) {
      const from = `alpha-${index}`;
      const to = `beta-${index}`;
      const oneWay = [makeRegion(from, "unknown coast", [to]), makeRegion(to, "unknown coast", [])];
      const identity = createRegionMapIdentity(402, oneWay[1], oneWay);
      const recipe = createRegionMapRecipe(identity);
      const gate = recipe.gates[0]!.tile;
      const anchors = new Set([
        ...recipe.gates.map((item) => item.tile), ...recipe.arrivalAnchors,
        ...recipe.spawnAnchors, ...recipe.socialAnchors,
        ...recipe.resourceAnchors.energy, ...recipe.resourceAnchors.materials,
        ...recipe.stagingAnchors,
        ...recipe.shelterPlots.flatMap((plot) => [plot.tile, plot.door]),
      ].map(tileKey));
      if (cardinalNeighbors(gate).every((tile) => !anchors.has(tileKey(tile)))) {
        fixture = { identity, recipe };
      }
    }
    expect(fixture, "a canonical gate with a clear four-tile isolation ring").not.toBeNull();
    const { identity, recipe } = fixture!;
    const hostile = JSON.parse(serializeRegionMapRecipe(recipe)) as Record<string, any>;
    const gate = hostile.gates[0].tile;
    const neighbors = cardinalNeighbors(gate);
    hostile.staticScenery = hostile.staticScenery.filter((item: any) =>
      !neighbors.some((tile) => tileKey(tile) === tileKey(item.tile)));
    hostile.animatedEnvironment = hostile.animatedEnvironment.filter((item: any) =>
      !neighbors.some((tile) => tileKey(tile) === tileKey(item.tile)));
    for (const tile of neighbors) {
      hostile.grid.collision[tile.row * hostile.grid.columns + tile.column] = 1;
    }
    expect(() => parseRegionMapRecipe(JSON.stringify(hostile), identity)).toThrow(/reachable/i);
  });

  it("maps frozen C01/C02 journeys to literal origin and destination gates", () => {
    const fixture = loadFixture("C02-travel-all-regions.json");
    const fixtureRegions = fixture.initialSnapshot.regions as RegionSnapshot[];
    const recipes = new Map(fixtureRegions.map((region) => [
      region.name,
      createRegionMapRecipe(createRegionMapIdentity(fixture.seed, region, fixtureRegions)),
    ]));
    const journeys = fixture.entries
      .filter((entry: any) => entry.event.type === "agent_left_region")
      .map((entry: any) => ({ from: entry.event.payload.from_region as string, to: entry.event.payload.to_region as string }));
    expect(journeys).toHaveLength(10);
    expect(new Set(journeys.map((edge: any) => `${edge.from}>${edge.to}`))).toHaveLength(10);
    for (const edge of journeys) {
      expect(recipes.get(edge.from)!.gates).toContainEqual(expect.objectContaining({ role: "departure", edge }));
      expect(recipes.get(edge.to)!.gates).toContainEqual(expect.objectContaining({ role: "arrival", edge }));
    }

    const local = loadFixture("C01-movement-local-path.json");
    expect(local.expectedMarkers).toContain("event:agent_left_region");
    expect(local.negativeAssertions).toContain("no-teleport");
    const localRegions = local.initialSnapshot.regions as RegionSnapshot[];
    const localRecipes = new Map(localRegions.map((region) => [
      region.name,
      createRegionMapRecipe(createRegionMapIdentity(local.seed, region, localRegions)),
    ]));
    const entered = local.entries.find((entry: any) =>
      entry.event.type === "agent_entered_region");
    const arrivalEdge = {
      from: entered.event.payload.from_region as string,
      to: entered.event.payload.to_region as string,
    };
    const arrival = localRecipes.get(arrivalEdge.to)!.gates.find((gate) =>
      gate.role === "arrival"
      && gate.edge.from === arrivalEdge.from
      && gate.edge.to === arrivalEdge.to);
    expect(arrival?.tile).toEqual({ column: 27, row: 17 });
    expect(tileCenter(arrival!.tile)).toEqual({ x: 880, y: 560 });
  });

  it("keeps all approved kits data-distinct and unknown regions neutral", () => {
    const known = world.map((region) => createRegionMapRecipe(createRegionMapIdentity(2, region, world)));
    expect(new Set(known.map((recipe) => recipe.kit))).toHaveLength(4);
    const unknown = makeRegion("new_place", "mysterious shoreline", []);
    expect(createRegionMapRecipe(createRegionMapIdentity(2, unknown, [...world, unknown])).kit).toBe("neutral-temperate");
  });

  it("pins generic serialized bytes and recipe hashes across every production biome", () => {
    const regions = [
      makeRegion("old_hearth", "a once-heavenly landscape, now thinning and picked-over", []),
      makeRegion("spring_basin", "hot spring lakes", []),
      makeRegion("dry_march", "a struggling, near-barren stretch", []),
      makeRegion("ash_field", "a nuclear wasteland, all but dead", []),
      makeRegion("quiet_field", "mysterious shoreline", []),
    ];
    const observed = Object.fromEntries(regions.map((region) => {
      const recipe = createRegionMapRecipe(createRegionMapIdentity(229, region, [region]));
      const serialized = serializeRegionMapRecipe(recipe);
      return [region.name, {
        kit: recipe.kit,
        bytes: Buffer.byteLength(serialized),
        sha256: createHash("sha256").update(serialized).digest("hex"),
        recipeHash: regionMapRecipeHash(recipe),
      }];
    }));

    // Owner-authorised re-baseline — TORUS PHYSICS PHASE 2. Every region's serialized
    // length grows by EXACTLY 22 bytes, the length of `,"topology":"toroidal"`, in every
    // kit. The collision array itself is the same length with 4 flipped bytes, so the
    // byte counts corroborate that topology activation is the whole delta.
    expect(observed).toEqual({
      old_hearth: {
        kit: "worn-heartland",
        bytes: 320399,
        sha256: "23dddb4ffe8d367bd94967645ea8f03a2b7bae4147ec7d5cc225543e4b705a98",
        recipeHash: "ad1319e4",
      },
      spring_basin: {
        kit: "spring-terraces",
        bytes: 302186,
        sha256: "91db8787488298616b39bbdf85ae3ecc7b427516385c6a783888d8fe5294cf7d",
        recipeHash: "3a56c0b0",
      },
      dry_march: {
        kit: "dry-scrub",
        bytes: 295975,
        sha256: "bb33183c49b56ee0fbc15cff637b1701688f0cea66dba9e5979bcfc30ba49829",
        recipeHash: "69528015",
      },
      ash_field: {
        kit: "ash-waste",
        bytes: 299829,
        sha256: "96fdfc6af10813a85f3a915c7ad60611c64ab79fb8dcbd04a382762b3a02c11a",
        recipeHash: "1af3c18c",
      },
      quiet_field: {
        kit: "neutral-temperate",
        bytes: 299190,
        sha256: "c927efa7ac62e80e3df4e0ea20c897b9ec26e420db1183273d1e6e0f4c5b88c7",
        recipeHash: "b4dd99cd",
      },
    });
  });
});

function makeRegion(name: string, description: string, connections: string[]): RegionSnapshot {
  return {
    name, description, connections, energy_rate: name === "nirvana_west" ? 0.05 : 0.2,
    materials_rate: name === "nirvana_west" ? 0 : 0.2, current_energy: 40,
    current_materials: 40, max_energy: 100, max_materials: 100,
  };
}

function loadFixture(file: string): any {
  return JSON.parse(readFileSync(new URL(file, CHRONICLE_FIXTURE_DIRECTORY), "utf8"));
}

function reverseObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reverseObjectKeys);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).reverse().map(([key, item]) => [key, reverseObjectKeys(item)]));
  }
  return value;
}

function inDistrict(tile: { readonly column: number; readonly row: number }, origin: { readonly column: number; readonly row: number }): boolean {
  return tile.column >= origin.column && tile.column < origin.column + 12 &&
    tile.row >= origin.row && tile.row < origin.row + 30;
}

function inLandscapeSector(
  tile: { readonly column: number; readonly row: number },
  origin: { readonly column: number; readonly row: number },
): boolean {
  const sector = landscapeSectorForOrigin(origin);
  return tile.column >= sector.column && tile.column < sector.column + 24
    && tile.row >= sector.row && tile.row < sector.row + 16;
}

function landscapeSectorForOrigin(
  origin: { readonly column: number; readonly row: number },
): Readonly<{ column: number; row: number }> {
  const index = DISTRICT_ORIGINS.findIndex((candidate) => tileKey(candidate) === tileKey(origin));
  const sector = LANDSCAPE_SECTORS[index];
  if (sector === undefined) throw new Error(`test has no landscape sector for ${tileKey(origin)}`);
  return sector;
}

function tileKey(tile: { readonly column: number; readonly row: number }): string {
  return `${tile.column},${tile.row}`;
}

function maskTiles(mask: Uint8Array, columns: number): { column: number; row: number }[] {
  return Array.from(mask.entries())
    .filter(([, value]) => value === 1)
    .map(([index]) => ({ column: index % columns, row: Math.floor(index / columns) }));
}

function connectedMaskSize(mask: Uint8Array, columns: number, rows: number): number {
  const start = mask.findIndex((value) => value === 1);
  if (start < 0) return 0;
  const seen = new Set([start]);
  const pending = [start];
  while (pending.length > 0) {
    const index = pending.pop()!;
    const column = index % columns;
    const row = Math.floor(index / columns);
    for (const [nextColumn, nextRow] of [[column - 1, row], [column + 1, row], [column, row - 1], [column, row + 1]]) {
      if (nextColumn < 0 || nextColumn >= columns || nextRow < 0 || nextRow >= rows) continue;
      const next = nextRow * columns + nextColumn;
      if (mask[next] !== 1 || seen.has(next)) continue;
      seen.add(next);
      pending.push(next);
    }
  }
  return seen.size;
}

function manhattan(
  left: { readonly column: number; readonly row: number },
  right: { readonly column: number; readonly row: number },
): number {
  return Math.abs(left.column - right.column) + Math.abs(left.row - right.row);
}

function cardinalNeighbors(tile: { readonly column: number; readonly row: number }): { column: number; row: number }[] {
  return [
    { column: tile.column - 1, row: tile.row },
    { column: tile.column + 1, row: tile.row },
    { column: tile.column, row: tile.row - 1 },
    { column: tile.column, row: tile.row + 1 },
  ];
}

function connectedComponents(
  tiles: readonly { readonly column: number; readonly row: number }[],
): { column: number; row: number }[][] {
  const remaining = new Map(tiles.map((tile) => [tileKey(tile), { ...tile }]));
  const components: { column: number; row: number }[][] = [];
  while (remaining.size > 0) {
    const start = remaining.values().next().value as { column: number; row: number };
    const component: { column: number; row: number }[] = [];
    const pending = [start];
    remaining.delete(tileKey(start));
    while (pending.length > 0) {
      const tile = pending.pop()!;
      component.push(tile);
      for (const neighbor of cardinalNeighbors(tile)) {
        const claimed = remaining.get(tileKey(neighbor));
        if (claimed === undefined) continue;
        remaining.delete(tileKey(claimed));
        pending.push(claimed);
      }
    }
    components.push(component);
  }
  return components;
}

function findCanonicalOnlyComponentTranslation(
  base: Record<string, any>,
  identity: ReturnType<typeof createRegionMapIdentity>,
  maskName: "waterVoidMask" | "soilMask",
  movesCollision: boolean,
): Record<string, any> {
  const sourceMask = Uint8Array.from(base[maskName]);
  const components = connectedComponents(maskTiles(sourceMask, base.grid.columns));
  const allSourceKeys = new Set(maskTiles(sourceMask, base.grid.columns).map(tileKey));
  for (const component of components) {
    const componentKeys = new Set(component.map(tileKey));
    for (let rowOffset = -4; rowOffset <= 4; rowOffset += 1) {
      for (let columnOffset = -4; columnOffset <= 4; columnOffset += 1) {
        if (rowOffset === 0 && columnOffset === 0) continue;
        const translated = component.map((tile) => ({
          column: tile.column + columnOffset,
          row: tile.row + rowOffset,
        }));
        if (translated.some((tile) => tile.column <= 0 || tile.column >= base.grid.columns - 1
          || tile.row <= 0 || tile.row >= base.grid.rows - 1)) continue;
        if (translated.some((tile) => {
          const key = tileKey(tile);
          if (componentKeys.has(key)) return false;
          const index = tile.row * base.grid.columns + tile.column;
          return allSourceKeys.has(key) || base.pathMask[index] === 1
            || base.waterVoidMask[index] === (maskName === "soilMask" ? 1 : 2)
            || base.soilMask[index] === (maskName === "waterVoidMask" ? 1 : 2)
            || base.staticScenery.some((placement: any) => tileKey(placement.tile) === key)
            || base.animatedEnvironment.some((placement: any) => tileKey(placement.tile) === key);
        })) continue;
        const candidate = structuredClone(base);
        for (const tile of component) {
          const index = tile.row * candidate.grid.columns + tile.column;
          candidate[maskName][index] = 0;
          if (movesCollision && !translated.some((next) => tileKey(next) === tileKey(tile))) {
            candidate.grid.collision[index] = 0;
          }
        }
        for (const tile of translated) {
          const index = tile.row * candidate.grid.columns + tile.column;
          candidate[maskName][index] = 1;
          if (movesCollision) candidate.grid.collision[index] = 1;
        }
        try {
          parseRegionMapRecipe(JSON.stringify(candidate), identity);
        } catch (error) {
          if (error instanceof Error && /canonical deterministic fields/i.test(error.message)) {
            return candidate;
          }
        }
      }
    }
  }
  throw new Error(`test could not find a structurally legal alternate ${maskName} component`);
}

function reconstructLegacySatellitePlacements(
  recipe: ReturnType<typeof createRegionMapRecipe>,
  runSeed: number,
): { column: number; row: number }[] {
  const claimed = new Set<string>([
    ...recipe.gates.map((gate) => gate.tile),
    ...recipe.spawnAnchors,
    ...recipe.socialAnchors,
    ...recipe.resourceAnchors.energy,
    ...recipe.resourceAnchors.materials,
    ...recipe.stagingAnchors,
    ...recipe.shelterPlots.flatMap((plot) => [plot.tile, plot.door]),
    ...maskTiles(recipe.edgeMask, recipe.grid.columns),
    ...maskTiles(recipe.pathMask, recipe.grid.columns),
    ...maskTiles(recipe.soilMask, recipe.grid.columns),
    ...maskTiles(recipe.waterVoidMask, recipe.grid.columns),
    ...recipe.staticScenery
      .filter((placement) => placement.clusterId !== null)
      .map((placement) => placement.tile),
  ].map(tileKey));
  for (let coordinate = 16; coordinate <= 79; coordinate += 1) {
    for (const tile of [
      { column: coordinate, row: 16 },
      { column: 79, row: coordinate },
      { column: coordinate, row: 79 },
      { column: 16, row: coordinate },
    ]) claimed.add(tileKey(tile));
  }
  const protectedRects = [
    ...recipe.stagingPoints.map((point) => rectToTestRect(feetAnchoredVisualRect(point))),
    ...recipe.shelterPlots.map((plot) => shelterRenderRect(plot.tile)),
    ...recipe.shelterPlots.map((plot) =>
      rectToTestRect(feetAnchoredVisualRect(tileCenter(plot.door)))),
    ...maskTiles(recipe.pathMask, recipe.grid.columns).map((tile) =>
      rectToTestRect(feetAnchoredVisualRect(tileCenter(tile)))),
  ];
  for (let row = 0; row < recipe.grid.rows; row += 1) {
    for (let column = 0; column < recipe.grid.columns; column += 1) {
      const tile = { column, row };
      if (protectedRects.some((rect) => rectanglesOverlap(rect, environmentRenderRect(tile)))) {
        claimed.add(tileKey(tile));
      }
    }
  }

  const selected: { column: number; row: number }[] = [];
  for (const district of recipe.districts) {
    const sector = LANDSCAPE_SECTORS[district.index]!;
    const capacity = 24 * 16;
    let cursor = stableHash(
      `${runSeed}:${recipe.regionId}:static-satellites:district-${district.index}`,
    ) % capacity;
    for (let attempts = 0, count = 0; count < 3 && attempts < capacity; attempts += 1) {
      const tile = {
        column: sector.column + (cursor % 24),
        row: sector.row + Math.floor(cursor / 24),
      };
      if (!claimed.has(tileKey(tile))) {
        selected.push(tile);
        claimed.add(tileKey(tile));
        count += 1;
      }
      cursor = (cursor + 35) % capacity;
    }
  }
  return selected;
}

function isIrregularComponent(component: readonly { readonly column: number; readonly row: number }[]): boolean {
  if (component.length === 0) return false;
  const columns = component.map((tile) => tile.column);
  const rows = component.map((tile) => tile.row);
  const width = Math.max(...columns) - Math.min(...columns) + 1;
  const height = Math.max(...rows) - Math.min(...rows) + 1;
  return width > 1 && height > 1 && width * height > component.length;
}

function hasEligibleShoreNeighbor(
  component: readonly { readonly column: number; readonly row: number }[],
  collision: ArrayLike<number>,
  columns: number,
  rows: number,
): boolean {
  const water = new Set(component.map(tileKey));
  return component.some((tile) => cardinalNeighbors(tile).some((neighbor) =>
    neighbor.column > 0 && neighbor.column < columns - 1 && neighbor.row > 0 && neighbor.row < rows - 1 &&
    !water.has(tileKey(neighbor)) && collision[neighbor.row * columns + neighbor.column] === 0));
}

function cardinalIndexes(index: number, columns: number, rows: number): number[] {
  const column = index % columns;
  const row = Math.floor(index / columns);
  return cardinalNeighbors({ column, row })
    .filter((tile) => tile.column >= 0 && tile.column < columns && tile.row >= 0 && tile.row < rows)
    .map((tile) => tile.row * columns + tile.column);
}

function findOpenMutationIndex(recipe: Record<string, any>, predicate: (index: number) => boolean): number {
  const occupied = new Set([
    ...recipe.gates.map((gate: any) => gate.tile), ...recipe.arrivalAnchors,
    ...recipe.spawnAnchors, ...recipe.socialAnchors,
    ...recipe.resourceAnchors.energy, ...recipe.resourceAnchors.materials,
    ...recipe.stagingAnchors,
    ...recipe.shelterPlots.flatMap((plot: any) => [plot.tile, plot.door]),
    ...recipe.staticScenery.map((placement: any) => placement.tile),
    ...recipe.animatedEnvironment.map((placement: any) => placement.tile),
  ].map((tile: any) => tile.row * recipe.grid.columns + tile.column));
  const found = recipe.grid.collision.findIndex((value: number, index: number) => {
    const row = Math.floor(index / recipe.grid.columns);
    const column = index % recipe.grid.columns;
    return value === 0 && row > 1 && row < recipe.grid.rows - 2 && column > 1 && column < recipe.grid.columns - 2 &&
      recipe.pathMask[index] === 0 && recipe.soilMask[index] === 0 && recipe.waterVoidMask[index] === 0 &&
      !occupied.has(index) && predicate(index);
  });
  if (found < 0) throw new Error("test could not locate an open hostile-mutation tile");
  return found;
}

interface TestRect {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

function tileBounds(
  tiles: readonly { readonly column: number; readonly row: number }[],
): TestRect {
  return {
    left: Math.min(...tiles.map((tile) => tile.column)) * TILE_SIZE,
    top: Math.min(...tiles.map((tile) => tile.row)) * TILE_SIZE,
    right: (Math.max(...tiles.map((tile) => tile.column)) + 1) * TILE_SIZE,
    bottom: (Math.max(...tiles.map((tile) => tile.row)) + 1) * TILE_SIZE,
  };
}

function unionRects(left: TestRect, right: TestRect): TestRect {
  return {
    left: Math.min(left.left, right.left),
    top: Math.min(left.top, right.top),
    right: Math.max(left.right, right.right),
    bottom: Math.max(left.bottom, right.bottom),
  };
}

function shelterRenderRect(tile: { readonly column: number; readonly row: number }): TestRect {
  const origin = tileCenter(tile);
  return {
    left: origin.x,
    top: origin.y,
    right: origin.x + SHELTER_RENDER_FOOTPRINT.width,
    bottom: origin.y + SHELTER_RENDER_FOOTPRINT.height,
  };
}

function environmentRenderRect(tile: { readonly column: number; readonly row: number }): TestRect {
  return {
    left: tile.column * TILE_SIZE,
    top: tile.row * TILE_SIZE,
    right: (tile.column + 1) * TILE_SIZE,
    bottom: (tile.row + 1) * TILE_SIZE,
  };
}

function sceneryVisualRect(placement: Readonly<{
  tile: { readonly column: number; readonly row: number };
  visualFootprint: { readonly widthTiles: number; readonly heightTiles: number };
}>): TestRect {
  return {
    left: placement.tile.column * TILE_SIZE,
    top: placement.tile.row * TILE_SIZE,
    right: (placement.tile.column + placement.visualFootprint.widthTiles) * TILE_SIZE,
    bottom: (placement.tile.row + placement.visualFootprint.heightTiles) * TILE_SIZE,
  };
}

function centeredRect(
  center: { readonly x: number; readonly y: number },
  footprint: Readonly<{ width: number; height: number }>,
): TestRect {
  return {
    left: center.x - footprint.width / 2,
    top: center.y - footprint.height / 2,
    right: center.x + footprint.width / 2,
    bottom: center.y + footprint.height / 2,
  };
}

function rectanglesOverlap(left: TestRect, right: TestRect): boolean {
  return left.left < right.right && left.right > right.left &&
    left.top < right.bottom && left.bottom > right.top;
}

function rectToTestRect(rect: Readonly<{ x: number; y: number; width: number; height: number }>): TestRect {
  return {
    left: rect.x,
    top: rect.y,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
  };
}

function pointInRect(
  point: Readonly<{ x: number; y: number }>,
  rect: Readonly<{ x: number; y: number; width: number; height: number }>,
): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width &&
    point.y >= rect.y && point.y <= rect.y + rect.height;
}

function findIntrudingShelterPlacement(
  recipe: Record<string, any>,
  target: Record<string, any>,
  moved: Record<string, any>,
): Readonly<{ tile: { column: number; row: number }; door: { column: number; row: number } }> {
  const occupied = new Set([
    ...recipe.gates.map((gate: any) => gate.tile), ...recipe.arrivalAnchors,
    ...recipe.spawnAnchors, ...recipe.socialAnchors,
    ...recipe.resourceAnchors.energy, ...recipe.resourceAnchors.materials,
    ...recipe.stagingAnchors,
    ...recipe.shelterPlots.flatMap((plot: any) => [plot.tile, plot.door]),
    ...recipe.staticScenery.map((placement: any) => placement.tile),
    ...recipe.animatedEnvironment.map((placement: any) => placement.tile),
  ].map((tile: any) => tile.row * recipe.grid.columns + tile.column));
  occupied.delete(moved.tile.row * recipe.grid.columns + moved.tile.column);
  occupied.delete(moved.door.row * recipe.grid.columns + moved.door.column);
  for (let row = 1; row < recipe.grid.rows - 4; row += 1) {
    for (let column = 1; column < recipe.grid.columns - 3; column += 1) {
      const tile = { column, row };
      const door = { column: column + 2, row: row + 3 };
      const candidateIndex = tile.row * recipe.grid.columns + tile.column;
      const doorIndex = door.row * recipe.grid.columns + door.column;
      if (occupied.has(candidateIndex) || occupied.has(doorIndex)) continue;
      if (recipe.grid.collision[candidateIndex] !== 0 || recipe.grid.collision[doorIndex] !== 0) continue;
      if (recipe.waterVoidMask[candidateIndex] !== 0 || recipe.waterVoidMask[doorIndex] !== 0) continue;
      if (recipe.soilMask[candidateIndex] !== 0 || recipe.soilMask[doorIndex] !== 0) continue;
      if (recipe.pathMask[candidateIndex] !== 0 || recipe.pathMask[doorIndex] !== 0) continue;
      if (!rectanglesOverlap(shelterRenderRect(tile), shelterRenderRect(target.tile))) continue;
      return { tile, door };
    }
  }
  throw new Error("test could not locate an open shelter footprint intrusion");
}

function findStagingEnvironmentIntrusion(
  recipe: Record<string, any>,
): Readonly<{ placementIndex: number; tile: { column: number; row: number } }> {
  const categoryTiles = new Set([
    ...recipe.gates.map((gate: any) => gate.tile), ...recipe.arrivalAnchors,
    ...recipe.spawnAnchors, ...recipe.socialAnchors,
    ...recipe.resourceAnchors.energy, ...recipe.resourceAnchors.materials,
    ...recipe.stagingAnchors,
    ...recipe.shelterPlots.flatMap((plot: any) => [plot.tile, plot.door]),
    ...recipe.staticScenery.map((placement: any) => placement.tile),
    ...recipe.animatedEnvironment.map((placement: any) => placement.tile),
    ...maskTiles(Uint8Array.from(recipe.waterVoidMask), recipe.grid.columns),
    ...maskTiles(Uint8Array.from(recipe.soilMask), recipe.grid.columns),
    ...maskTiles(Uint8Array.from(recipe.pathMask), recipe.grid.columns),
  ].map((tile: any) => tileKey(tile)));
  const actorRects = recipe.stagingPoints.map((point: any) =>
    rectToTestRect(feetAnchoredVisualRect(point)));
  const shelterRects = recipe.shelterPlots.map((plot: any) => shelterRenderRect(plot.tile));

  for (const [placementIndex, placement] of recipe.animatedEnvironment.entries()) {
    categoryTiles.delete(tileKey(placement.tile));
    for (let row = 1; row < recipe.grid.rows - 1; row += 1) {
      for (let column = 1; column < recipe.grid.columns - 1; column += 1) {
        const tile = { column, row };
        const tileRect = environmentRenderRect(tile);
        if (categoryTiles.has(tileKey(tile))) continue;
        if (!actorRects.some((actor: TestRect) => rectanglesOverlap(actor, tileRect))) continue;
        if (shelterRects.some((shelter: TestRect) => rectanglesOverlap(shelter, tileRect))) continue;
        return { placementIndex, tile };
      }
    }
    categoryTiles.add(tileKey(placement.tile));
  }
  throw new Error("test could not locate an environment intrusion");
}

function findShelterEnvironmentIntrusion(
  recipe: Record<string, any>,
  category: "static" | "animated",
): Readonly<{ placementIndex: number; tile: { column: number; row: number } }> {
  const placements = category === "static" ? recipe.staticScenery : recipe.animatedEnvironment;
  const categoryTiles = new Set([
    ...recipe.gates.map((gate: any) => gate.tile), ...recipe.arrivalAnchors,
    ...recipe.spawnAnchors, ...recipe.socialAnchors,
    ...recipe.resourceAnchors.energy, ...recipe.resourceAnchors.materials,
    ...recipe.stagingAnchors,
    ...recipe.shelterPlots.flatMap((plot: any) => [plot.tile, plot.door]),
    ...recipe.staticScenery.map((placement: any) => placement.tile),
    ...recipe.animatedEnvironment.map((placement: any) => placement.tile),
    ...maskTiles(Uint8Array.from(recipe.waterVoidMask), recipe.grid.columns),
    ...maskTiles(Uint8Array.from(recipe.soilMask), recipe.grid.columns),
    ...maskTiles(Uint8Array.from(recipe.pathMask), recipe.grid.columns),
  ].map((tile: any) => tileKey(tile)));
  const actorRects = recipe.stagingPoints.map((point: any) =>
    rectToTestRect(feetAnchoredVisualRect(point)));
  const shelterRects = recipe.shelterPlots.map((plot: any) => shelterRenderRect(plot.tile));

  for (const [placementIndex, placement] of placements.entries()) {
    if (category === "static" && placement.blocksMovement) continue;
    categoryTiles.delete(tileKey(placement.tile));
    for (let row = 1; row < recipe.grid.rows - 1; row += 1) {
      for (let column = 1; column < recipe.grid.columns - 1; column += 1) {
        const tile = { column, row };
        const tileRect = environmentRenderRect(tile);
        if (categoryTiles.has(tileKey(tile))) continue;
        if (category === "static"
          && recipe.grid.collision[row * recipe.grid.columns + column] !== 0) continue;
        if (actorRects.some((actor: TestRect) => rectanglesOverlap(actor, tileRect))) continue;
        if (!shelterRects.some((shelter: TestRect) => rectanglesOverlap(shelter, tileRect))) continue;
        return { placementIndex, tile };
      }
    }
    categoryTiles.add(tileKey(placement.tile));
  }
  throw new Error(`test could not locate a ${category} shelter intrusion`);
}

function replaceShelterPlot(
  recipe: Record<string, any>,
  plotId: string,
  placement: Readonly<{ tile: { column: number; row: number }; door: { column: number; row: number } }>,
): void {
  const replace = (plot: Record<string, any>): Record<string, any> => plot.id === plotId
    ? { ...plot, tile: { ...placement.tile }, door: { ...placement.door } }
    : plot;
  recipe.shelterPlots = recipe.shelterPlots.map(replace);
  for (const district of recipe.districts) district.shelterPlots = district.shelterPlots.map(replace);
}
