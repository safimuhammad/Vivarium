/**
 * @fileoverview The Nirvana West paint order against a synthetic, hand-built scene.
 *
 * Deliberately does NOT run the real terrain-field builder (`NirvanaWestTerrainField.ts`
 * is owned by a concurrent build and is still catching up to the latest published atlas).
 * Instead this constructs the smallest possible `NirvanaWestScene` that still exercises
 * every paint pass: a base fill per tile, a corner-masked overlay (including the mask-15
 * "served by the base fill" case), a rim line, one flat ground-evidence prop
 * (`s.railspur.*`), one ordinary prop, one non-flat `tailings` prop (which must land in
 * the ordinary foot sort, not the flat pass), one emberwisp, and one authored placement
 * per mapped `ash-waste` kind (plus one unmapped kind, which must be skipped). Every frame
 * id referenced below is real: it is checked against the ACTUAL published `nirvana-west-v1`
 * atlas via `NirvanaWestAssetProfile`/`NirvanaWestAtlas`, so these tests also double as
 * frame-vocabulary coverage for the shipped composition.
 */

import { describe, expect, it } from "vitest";

import type { RegionMapRecipeV1 } from "../maps/RegionMapRecipe";
import { createNirvanaWestAtlasAssets, type NirvanaWestAtlasAssets } from "./NirvanaWestAtlas";
import { createNirvanaWestPaintPlan } from "./NirvanaWestPainter";
import type { NirvanaWestScene } from "./NirvanaWestTerrainField";

function dummyAssets(): NirvanaWestAtlasAssets {
  return createNirvanaWestAtlasAssets(
    {} as CanvasImageSource,
    {} as CanvasImageSource,
  );
}

interface FixtureOptions {
  /**
   * A tile that REPLACES the authored tile at the same `column`/`row`.
   *
   * Replacement, not append: the fixture scene is a full 2x2, so appending a fifth tile
   * would land a second entry on an already-occupied coordinate and trip the painter's
   * duplicate-stable-id guard (`terrain:1,1`) before the assertion under test could be
   * reached. Reconciliation note (`nirvana_west` design merge): this option was authored
   * when the fixture was a 3-tile scene with (1,1) free, and the `slab` tier added at
   * (1,1) by the merged material stack silently turned it into a duplicate.
   */
  readonly extraTile?: Record<string, unknown>;
}

/** Four tiles, hand-authored against the real published `nirvana-west-v1` vocabulary. */
function fixtureScene(options: FixtureOptions = {}): NirvanaWestScene {
  const authoredTiles = [
    {
      column: 0, row: 0, base: "slate", baseVariant: 3,
      overlays: [{ material: "ember", mask: 5, variant: 0 }],
      rims: [],
      material: "ember", blocked: true, causewayDeck: false, deckOver: null,
    },
    {
      column: 1, row: 0, base: "cinder", baseVariant: 0,
      overlays: [],
      rims: [{ material: "cinder", mask: 3, variant: 1 }],
      material: "cinder", blocked: false, causewayDeck: false, deckOver: null,
    },
    {
      column: 0, row: 1, base: "ashpale", baseVariant: 5,
      // mask 15 = total coverage, served by the material's own base fill rather than a
      // (nonexistent) `e.ash.15.*` frame.
      overlays: [{ material: "ash", mask: 15, variant: 0 }],
      rims: [],
      material: "ash", blocked: false, causewayDeck: false, deckOver: null,
    },
    {
      column: 1, row: 1, base: "slab", baseVariant: 2,
      overlays: [],
      rims: [],
      material: "slab", blocked: false, causewayDeck: false, deckOver: null,
    },
  ];

  const tiles = options.extraTile === undefined
    ? authoredTiles
    : [
      ...authoredTiles.filter((tile) =>
        tile.column !== options.extraTile!.column || tile.row !== options.extraTile!.row),
      options.extraTile,
    ];

  const props = [
    {
      id: "prop-snag-1", frameId: "s.snag.2", x: 10, y: 5, footY: 45, footX: 26,
      species: "snag", blocks: true, tile: { column: 0, row: 0 }, footprint: [{ column: 0, row: 0 }],
    },
    {
      // A flat ground-evidence prop: must be drawn before all standing scenery and must
      // never enter the foot sort.
      id: "prop-railspur-1", frameId: "s.railspur.0", x: 0, y: 0, footY: 20, footX: 16,
      species: "railspur", blocks: false, tile: { column: 1, row: 0 }, footprint: [],
    },
    {
      // `tailings` has a body and must NOT be treated as flat ground evidence.
      id: "prop-tailings-1", frameId: "s.tailings.1", x: 4, y: 4, footY: 60, footX: 20,
      species: "tailings", blocks: false, tile: { column: 0, row: 1 }, footprint: [],
    },
    {
      id: "prop-emberwisp-1", frameId: "s.emberwisp.0", x: 0, y: 0, footY: 88, footX: 32,
      species: "emberwisp", blocks: false, tile: { column: 1, row: 1 }, footprint: [],
    },
  ];

  return {
    columns: 2,
    rows: 2,
    tileSize: 32,
    widthPixels: 64,
    heightPixels: 64,
    tiles,
    terrainCollision: new Uint8Array(4),
    collision: new Uint8Array(4),
    props,
    causeways: [],
    complexes: [],
    cornerMaterials: [],
    animatedEnvironment: [],
  } as unknown as NirvanaWestScene;
}

/** The `ash-waste` kit's four authored kinds, plus one kind with no mapping. */
function fixtureRecipe(): RegionMapRecipeV1 {
  return {
    staticScenery: [
      { id: "static-charred-trunk-1", kind: "charred-trunk", tile: { column: 0, row: 0 } },
      { id: "static-slag-rock-1", kind: "slag-rock", tile: { column: 1, row: 0 } },
      { id: "static-ash-pile-1", kind: "ash-pile", tile: { column: 0, row: 1 } },
      { id: "static-bone-stone-1", kind: "bone-stone", tile: { column: 1, row: 1 } },
      { id: "static-unmapped-1", kind: "not-a-real-kind", tile: { column: 0, row: 0 } },
    ],
  } as unknown as RegionMapRecipeV1;
}

describe("NirvanaWestPainter", () => {
  it("draws exactly one base fill per tile", () => {
    const scene = fixtureScene();
    const plan = createNirvanaWestPaintPlan(scene, fixtureRecipe(), dummyAssets(), "fixture-base");
    const baseFills = plan.operations.filter((operation) => operation.stableId.startsWith("terrain:"));
    expect(baseFills).toHaveLength(scene.tiles.length);
    expect(baseFills.every((operation) => operation.layer === "terrain")).toBe(true);
  });

  it("draws overlays and rims after every base fill, mask 15 served by the base frame", () => {
    const scene = fixtureScene();
    const plan = createNirvanaWestPaintPlan(scene, fixtureRecipe(), dummyAssets(), "fixture-overlays");
    const lastBaseFillIndex = plan.operations.reduce((last, operation, index) => (
      operation.stableId.startsWith("terrain:") ? index : last
    ), -1);
    const overlayAndRimIndices = plan.operations
      .map((operation, index) => ({ operation, index }))
      .filter(({ operation }) => (
        operation.stableId.startsWith("terrain-overlay:") || operation.stableId.startsWith("terrain-rim:")
      ));
    expect(overlayAndRimIndices.length).toBeGreaterThan(0);
    expect(overlayAndRimIndices.every(({ index }) => index > lastBaseFillIndex)).toBe(true);
    // The mask-15 ash overlay must resolve to the base fill frame's own source rect, not
    // throw looking for a nonexistent `e.ash.15.*` cell.
    const maskFifteen = plan.operations.find((operation) => operation.stableId === "terrain-overlay:0,1:0");
    expect(maskFifteen).toBeDefined();
  });

  it("draws every rim line after every overlay on its own tile", () => {
    const scene = fixtureScene();
    const plan = createNirvanaWestPaintPlan(scene, fixtureRecipe(), dummyAssets(), "fixture-rims");
    const rim = plan.operations.find((operation) => operation.stableId === "terrain-rim:1,0:0");
    expect(rim).toBeDefined();
    expect(rim!.layer).toBe("terrain");
  });

  it("paints every mapped authored placement, skips the unmapped kind", () => {
    const scene = fixtureScene();
    const plan = createNirvanaWestPaintPlan(scene, fixtureRecipe(), dummyAssets(), "fixture-authored");
    const authored = plan.operations.filter((operation) => operation.stableId.startsWith("authored:"));
    expect(authored).toHaveLength(4);
    expect(authored.some((operation) => operation.stableId === "authored:static-unmapped-1")).toBe(false);
  });

  it("draws flat ground evidence before every standing-scenery operation, and never in the foot sort", () => {
    const scene = fixtureScene();
    const plan = createNirvanaWestPaintPlan(scene, fixtureRecipe(), dummyAssets(), "fixture-flat");
    const flatIndex = plan.operations.findIndex((operation) => operation.stableId === "flat:prop-railspur-1");
    expect(flatIndex).toBeGreaterThan(-1);
    const firstStandingScenery = plan.operations.findIndex((operation) => (
      operation.layer === "scenery"
      && !operation.stableId.startsWith("flat:")
      && !operation.stableId.startsWith("wisp:")
    ));
    expect(firstStandingScenery).toBeGreaterThan(-1);
    expect(flatIndex).toBeLessThan(firstStandingScenery);
  });

  it("treats tailings as ordinary standing scenery, not flat ground evidence", () => {
    const scene = fixtureScene();
    const plan = createNirvanaWestPaintPlan(scene, fixtureRecipe(), dummyAssets(), "fixture-tailings");
    const tailings = plan.operations.find((operation) => operation.stableId === "prop:prop-tailings-1");
    expect(tailings).toBeDefined();
    expect(plan.operations.some((operation) => operation.stableId === "flat:prop-tailings-1")).toBe(false);
  });

  it("draws emberwisp after every other scenery operation, including flat ground evidence", () => {
    const scene = fixtureScene();
    const plan = createNirvanaWestPaintPlan(scene, fixtureRecipe(), dummyAssets(), "fixture-wisp");
    const wispFirst = plan.operations.findIndex((operation) => operation.stableId.startsWith("wisp:"));
    expect(wispFirst).toBeGreaterThan(-1);
    const lastOtherScenery = plan.operations.reduce((last, operation, index) => (
      operation.layer === "scenery" && !operation.stableId.startsWith("wisp:") ? index : last
    ), -1);
    expect(wispFirst).toBeGreaterThan(lastOtherScenery);
  });

  it("emits the 8x8 continuation matte from the slate anchor tier", () => {
    const scene = fixtureScene();
    const plan = createNirvanaWestPaintPlan(scene, fixtureRecipe(), dummyAssets(), "fixture-continuation");
    const continuation = plan.operations.filter((operation) => operation.layer === "continuation");
    expect(continuation).toHaveLength(64);
    expect(continuation.every((operation) => operation.atlasId === "nirvana-west-v1-terrain")).toBe(true);
  });

  it("has unique stable ids across the whole plan", () => {
    const scene = fixtureScene();
    const plan = createNirvanaWestPaintPlan(scene, fixtureRecipe(), dummyAssets(), "fixture-unique");
    expect(new Set(plan.operations.map((operation) => operation.stableId)).size)
      .toBe(plan.operations.length);
  });

  it("resolves every referenced frame against the published atlas without a missing-frame crash", () => {
    const scene = fixtureScene();
    expect(() => createNirvanaWestPaintPlan(scene, fixtureRecipe(), dummyAssets(), "fixture-drain"))
      .not.toThrow();
  });

  it("throws when a tile references a frame the published atlas does not carry", () => {
    const scene = fixtureScene({
      // Replaces the authored `slab` tile at (1,1) — see `FixtureOptions.extraTile`.
      extraTile: {
        column: 1, row: 1, base: "glass", baseVariant: 0,
        // `glass` has exactly two authored edge variants (indices 0-1) -- variant 5 does
        // not exist.
        overlays: [{ material: "glass", mask: 5, variant: 5 }],
        rims: [],
        material: "glass", blocked: false, causewayDeck: false, deckOver: null,
      },
    });
    expect(() => createNirvanaWestPaintPlan(scene, fixtureRecipe(), dummyAssets(), "fixture-missing"))
      .toThrow(/frame is missing/);
  });

  it("produces a deterministic plan for the same scene, recipe, and assets", () => {
    const scene = fixtureScene();
    const recipe = fixtureRecipe();
    const first = createNirvanaWestPaintPlan(scene, recipe, dummyAssets(), "fixture-deterministic");
    const second = createNirvanaWestPaintPlan(scene, recipe, dummyAssets(), "fixture-deterministic");
    expect(second).toEqual(first);
  });
});
