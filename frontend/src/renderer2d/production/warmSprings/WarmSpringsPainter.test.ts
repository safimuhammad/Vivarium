import { accessSync } from "node:fs";
import { resolve } from "node:path";

import sharp from "sharp";
import { describe, expect, it } from "vitest";

import type { RegionMapRecipeV1 } from "../maps/RegionMapRecipe";
import { createWarmSpringsAtlasAssets, type WarmSpringsAtlasAssets } from "./WarmSpringsAtlas";
import { createWarmSpringsPaintPlan } from "./WarmSpringsPainter";
import type { WarmSpringsScene } from "./WarmSpringsTerrainField";

const SCENERY_IMAGE_PATH = findSceneryImagePath();

/** Resolve the committed atlas from either the frontend package or repo root. */
function findSceneryImagePath(): string {
  const relativePath = "src/assets/renderer2d/regions/warm-springs-v1/scenery.png";
  const candidates = [resolve(process.cwd(), relativePath), resolve(process.cwd(), "frontend", relativePath)];
  const path = candidates.find((candidate) => {
    try {
      accessSync(candidate);
      return true;
    } catch {
      return false;
    }
  });
  if (path === undefined) throw new Error(`Warm Springs scenery atlas not found; checked ${candidates.join(", ")}`);
  return path;
}

async function alphaPixelsByRow(source: Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>): Promise<readonly number[]> {
  const { data, info } = await sharp(SCENERY_IMAGE_PATH)
    .extract({
      left: source.x,
      top: source.y,
      width: source.width,
      height: source.height,
    })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const rows: number[] = [];
  for (let row = 0; row < source.height; row += 1) {
    let count = 0;
    for (let column = 0; column < source.width; column += 1) {
      if (data[(row * source.width + column) * info.channels + info.channels - 1] !== 0) {
        count += 1;
      }
    }
    rows.push(count);
  }
  return rows;
}

function dummyAssets(): WarmSpringsAtlasAssets {
  return createWarmSpringsAtlasAssets(
    {} as CanvasImageSource,
    {} as CanvasImageSource,
  );
}

function fixtureScene(deckFrameId = "s.walkh.0"): WarmSpringsScene {
  return {
    columns: 1,
    rows: 1,
    tileSize: 32,
    widthPixels: 32,
    heightPixels: 32,
    tiles: [{
      column: 0,
      row: 0,
      base: "grass",
      baseVariant: 0,
      overlays: [],
      shorelines: [],
      material: "grass",
      blocked: false,
      boardwalkDeck: false,
      deckOver: null,
    }],
    collision: new Uint8Array(1),
    props: [{
      id: "walk:terrace-1:0,0",
      frameId: deckFrameId,
      x: 0,
      y: 0,
      footX: 16,
      footY: 31,
      blocks: false,
      tile: { column: 0, row: 0 },
    }, {
      id: "walkpost:terrace-1:0,0",
      frameId: "s.walkpost.0",
      x: 0,
      y: 0,
      footX: 16,
      footY: 31,
      blocks: false,
      tile: { column: 0, row: 0 },
    }, {
      id: "walkramp:terrace-1:0,0",
      frameId: "s.walkramph.0",
      x: 0,
      y: 0,
      footX: 16,
      footY: 31,
      blocks: false,
      tile: { column: 0, row: 0 },
    }],
    boardwalks: [{
      id: "terrace-1",
      axis: deckFrameId.startsWith("s.walkv.") ? "north-south" : "east-west",
      deck: [{ column: 0, row: 0 }],
      abutments: [],
    }],
    cornerMaterials: [],
  };
}

describe("WarmSpringsPainter", () => {
  it("grounds a boardwalk deck with a four-pixel fascia before the deck image", () => {
    const scene = fixtureScene();
    const collisionBefore = Array.from(scene.collision);
    const propsBefore = scene.props;
    const boardwalksBefore = scene.boardwalks;
    const assets = dummyAssets();
    const plan = createWarmSpringsPaintPlan(
      scene,
      { staticScenery: [] } as unknown as RegionMapRecipeV1,
      assets,
      "warm:depth",
    );
    const accent = plan.operations.find((operation) => (
      operation.stableId === "grounding:prop:walk:terrace-1:0,0"
    ));
    const deckIndex = plan.operations.findIndex((operation) => (
      operation.stableId === "prop:walk:terrace-1:0,0"
    ));
    const deckFrame = assets.frames.get("s.walkh.0")!;
    expect(accent).toMatchObject({ layer: "scenery", pivotY: 31 });
    expect(accent).toBeDefined();
    expect(plan.operations.indexOf(accent!)).toBeLessThan(deckIndex);
    expect(accent!.source).toEqual({
      x: deckFrame.rect.x,
      y: deckFrame.rect.y + deckFrame.rect.height - 4 - 2,
      width: deckFrame.rect.width,
      height: 4,
    });
    expect(accent!.destination).toEqual({
      x: 1,
      y: 30,
      width: deckFrame.rect.width + 4,
      height: 4,
    });
    expect(plan.operations[deckIndex]).toMatchObject({
      stableId: "prop:walk:terrace-1:0,0",
      destination: { x: 0, y: 0, width: deckFrame.rect.width, height: deckFrame.rect.height },
      pivotY: 31,
    });

    const postAccent = plan.operations.find((operation) => (
      operation.stableId === "grounding:prop:walkpost:terrace-1:0,0"
    ));
    const rampAccent = plan.operations.find((operation) => (
      operation.stableId === "grounding:prop:walkramp:terrace-1:0,0"
    ));
    expect(postAccent?.destination.height).toBe(2);
    expect(rampAccent?.destination.height).toBe(2);
    expect(Array.from(scene.collision)).toEqual(collisionBefore);
    expect(scene.props).toBe(propsBefore);
    expect(scene.boardwalks).toBe(boardwalksBefore);
  });

  it("keeps the vertical deck fascia on opaque source rows", () => {
    const scene = fixtureScene("s.walkv.0");
    const assets = dummyAssets();
    const plan = createWarmSpringsPaintPlan(
      scene,
      { staticScenery: [] } as unknown as RegionMapRecipeV1,
      assets,
      "warm:vertical-depth",
    );
    const accent = plan.operations.find((operation) => (
      operation.stableId === "grounding:prop:walk:terrace-1:0,0"
    ));
    const deckFrame = assets.frames.get("s.walkv.0")!;
    expect(accent?.source).toEqual({
      x: deckFrame.rect.x,
      y: deckFrame.rect.y + deckFrame.rect.height - 4,
      width: deckFrame.rect.width,
      height: 4,
    });
    expect(accent?.destination).toMatchObject({ x: 1, y: 30, width: deckFrame.rect.width + 4, height: 4 });
  });

  it("keeps the exposed fascia rows visible in the committed scenery atlas", async () => {
    for (const frameId of ["s.walkh.0", "s.walkv.0"]) {
      const plan = createWarmSpringsPaintPlan(
        fixtureScene(frameId),
        { staticScenery: [] } as unknown as RegionMapRecipeV1,
        dummyAssets(),
        `warm:alpha:${frameId}`,
      );
      const fascia = plan.operations.find((operation) => (
        operation.stableId === "grounding:prop:walk:terrace-1:0,0"
      ));
      expect(fascia).toBeDefined();
      const alphaRows = await alphaPixelsByRow(fascia!.source);
      expect(alphaRows.slice(2).reduce((total, row) => total + row, 0)).toBeGreaterThan(0);
    }
  });
});
