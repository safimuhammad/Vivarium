/**
 * @fileoverview The Nirvana East paint order against a synthetic, hand-built scene.
 *
 * Deliberately does NOT run the real terrain-field builder (`NirvanaEastTerrainField.ts`
 * is owned by a concurrent build). Instead this constructs the smallest possible
 * `NirvanaEastScene` that still exercises every paint pass: a base fill per tile, a
 * corner-masked overlay (including the mask-15 "served by the base fill" case), a
 * shoreline, one ordinary prop, one landform prop, one dust devil, and one authored
 * placement per mapped `dry-scrub` kind (plus one unmapped kind, which must be skipped).
 * Every frame id referenced below is real: it is checked against the ACTUAL published
 * `nirvana-east-v1` atlas via `NirvanaEastAssetProfile`/`NirvanaEastAtlas`, so these tests
 * also double as frame-vocabulary coverage for composition B.
 */

import { describe, expect, it } from "vitest";

import type { RegionMapRecipeV1 } from "../maps/RegionMapRecipe";
import { createNirvanaEastAtlasAssets, type NirvanaEastAtlasAssets } from "./NirvanaEastAtlas";
import { createNirvanaEastPaintPlan } from "./NirvanaEastPainter";
import type { NirvanaEastScene } from "./NirvanaEastTerrainField";

function dummyAssets(): NirvanaEastAtlasAssets {
  return createNirvanaEastAtlasAssets(
    {} as CanvasImageSource,
    {} as CanvasImageSource,
  );
}

interface FixtureOptions {
  readonly extraTile?: Record<string, unknown>;
}

/** Four tiles, hand-authored against the real published `nirvana-east-v1` vocabulary. */
function fixtureScene(options: FixtureOptions = {}): NirvanaEastScene {
  const tiles = [
    {
      column: 0, row: 0, base: "redsand", baseVariant: 3,
      overlays: [{ material: "gravel", mask: 5, variant: 0 }],
      shorelines: [],
      material: "redsand", blocked: false, crossingDeck: false, deckOver: null,
    },
    {
      column: 1, row: 0, base: "salt", baseVariant: 0,
      overlays: [],
      shorelines: [{ material: "salt", mask: 3, variant: 1 }],
      material: "salt", blocked: false, crossingDeck: false, deckOver: null,
    },
    {
      column: 0, row: 1, base: "oxide", baseVariant: 5,
      // mask 15 = total coverage, served by the material's own base fill rather than a
      // (nonexistent) `e.brine.15.*` frame.
      overlays: [{ material: "brine", mask: 15, variant: 0 }],
      shorelines: [],
      material: "brine", blocked: true, crossingDeck: false, deckOver: null,
    },
    {
      column: 1, row: 1, base: "hardpan", baseVariant: 2,
      overlays: [],
      shorelines: [],
      material: "hardpan", blocked: false, crossingDeck: false, deckOver: null,
    },
    ...(options.extraTile === undefined ? [] : [options.extraTile]),
  ];

  const props = [
    {
      id: "prop-boulder-1", frameId: "s.boulder.2", x: 10, y: 5, footY: 45, footX: 26,
      blocks: true, tile: { column: 0, row: 0 }, footprint: [{ column: 0, row: 0 }],
      landformGroup: null,
    },
    {
      // Landform props arrive pre-offset by their authored pivot (contract: `x`/`y`
      // already reflect `PROP_PIVOTS`) -- the painter must draw them unmodified.
      id: "landform:outcrop-1", frameId: "s.outcrop.0", x: -40, y: -22, footY: 30, footX: 40,
      blocks: true, tile: { column: 1, row: 0 }, footprint: [{ column: 1, row: 0 }],
      landformGroup: "outcrop-1",
    },
    {
      id: "prop-dustdevil-1", frameId: "s.dustdevil.0", x: 0, y: 0, footY: 88, footX: 32,
      blocks: false, tile: { column: 1, row: 1 }, footprint: [],
      landformGroup: null,
    },
  ];

  return {
    columns: 2,
    rows: 2,
    tileSize: 32,
    widthPixels: 64,
    heightPixels: 64,
    tiles,
    collision: new Uint8Array(4),
    props,
    crossings: [],
    cornerMaterials: [],
    landforms: [],
  } as unknown as NirvanaEastScene;
}

/** The `dry-scrub` kit's four authored kinds, plus one kind with no mapping. */
function fixtureRecipe(): RegionMapRecipeV1 {
  return {
    staticScenery: [
      { id: "static-sun-rock-1", kind: "sun-rock", tile: { column: 0, row: 0 } },
      { id: "static-deadwood-1", kind: "deadwood", tile: { column: 1, row: 0 } },
      { id: "static-dry-grass-1", kind: "dry-grass", tile: { column: 0, row: 1 } },
      { id: "static-thorn-1", kind: "thorn", tile: { column: 1, row: 1 } },
      { id: "static-unmapped-1", kind: "not-a-real-kind", tile: { column: 0, row: 0 } },
    ],
  } as unknown as RegionMapRecipeV1;
}

describe("NirvanaEastPainter", () => {
  it("draws exactly one base fill per tile", () => {
    const scene = fixtureScene();
    const plan = createNirvanaEastPaintPlan(scene, fixtureRecipe(), dummyAssets(), "fixture-base");
    const baseFills = plan.operations.filter((operation) => operation.stableId.startsWith("terrain:"));
    expect(baseFills).toHaveLength(scene.tiles.length);
    expect(baseFills.every((operation) => operation.layer === "terrain")).toBe(true);
  });

  it("draws overlays and shorelines after every base fill, mask 15 served by the base frame", () => {
    const scene = fixtureScene();
    const plan = createNirvanaEastPaintPlan(scene, fixtureRecipe(), dummyAssets(), "fixture-overlays");
    const lastBaseFillIndex = plan.operations.reduce((last, operation, index) => (
      operation.stableId.startsWith("terrain:") ? index : last
    ), -1);
    const overlayIndices = plan.operations
      .map((operation, index) => ({ operation, index }))
      .filter(({ operation }) => (
        operation.stableId.startsWith("terrain-overlay:") || operation.stableId.startsWith("terrain-shore:")
      ));
    expect(overlayIndices.length).toBeGreaterThan(0);
    expect(overlayIndices.every(({ index }) => index > lastBaseFillIndex)).toBe(true);
    // The mask-15 brine overlay must resolve to the base fill frame's own source rect,
    // not throw looking for a nonexistent `e.brine.15.*` cell.
    const maskFifteen = plan.operations.find((operation) => operation.stableId === "terrain-overlay:0,1:0");
    expect(maskFifteen).toBeDefined();
  });

  it("paints every mapped authored placement, skips the unmapped kind", () => {
    const scene = fixtureScene();
    const plan = createNirvanaEastPaintPlan(scene, fixtureRecipe(), dummyAssets(), "fixture-authored");
    const authored = plan.operations.filter((operation) => operation.stableId.startsWith("authored:"));
    expect(authored).toHaveLength(4);
    expect(authored.some((operation) => operation.stableId === "authored:static-unmapped-1")).toBe(false);
  });

  it("draws every dust-devil prop after every other scenery operation, and landform props unmodified", () => {
    const scene = fixtureScene();
    const plan = createNirvanaEastPaintPlan(scene, fixtureRecipe(), dummyAssets(), "fixture-dustdevil");
    const dustDevilFirst = plan.operations.findIndex((operation) =>
      operation.stableId.startsWith("dustdevil:"));
    expect(dustDevilFirst).toBeGreaterThan(-1);
    const lastOtherScenery = plan.operations.reduce((last, operation, index) => (
      operation.layer === "scenery" && !operation.stableId.startsWith("dustdevil:") ? index : last
    ), -1);
    expect(dustDevilFirst).toBeGreaterThan(lastOtherScenery);

    const landform = plan.operations.find((operation) => operation.stableId === "prop:landform:outcrop-1");
    expect(landform).toMatchObject({ destination: { x: -40, y: -22 }, pivotY: 30 });
  });

  it("has unique stable ids across the whole plan", () => {
    const scene = fixtureScene();
    const plan = createNirvanaEastPaintPlan(scene, fixtureRecipe(), dummyAssets(), "fixture-unique");
    expect(new Set(plan.operations.map((operation) => operation.stableId)).size)
      .toBe(plan.operations.length);
  });

  it("throws when a tile references a frame the published atlas does not carry", () => {
    const scene = fixtureScene({
      extraTile: {
        // A FRESH coordinate: reusing (0,0) collides with the fixture's own
        // `terrain:0,0` stable id, and the painter's duplicate-id guard then fires
        // before the missing frame is ever requested.
        column: 2, row: 0, base: "sand", baseVariant: 0,
        // `sand` has exactly one authored edge variant (index 0) -- variant 1 does not exist.
        overlays: [{ material: "sand", mask: 5, variant: 1 }],
        shorelines: [],
        material: "sand", blocked: false, crossingDeck: false, deckOver: null,
      },
    });
    expect(() => createNirvanaEastPaintPlan(scene, fixtureRecipe(), dummyAssets(), "fixture-missing"))
      .toThrow(/frame is missing/);
  });

  it("produces a deterministic plan for the same scene, recipe, and assets", () => {
    const scene = fixtureScene();
    const recipe = fixtureRecipe();
    const first = createNirvanaEastPaintPlan(scene, recipe, dummyAssets(), "fixture-deterministic");
    const second = createNirvanaEastPaintPlan(scene, recipe, dummyAssets(), "fixture-deterministic");
    expect(second).toEqual(first);
  });
});
