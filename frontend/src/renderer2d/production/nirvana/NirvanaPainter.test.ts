import { describe, expect, it, vi } from "vitest";

import { NIRVANA_ATLAS_PROFILE } from "./NirvanaAssetProfile";
import { createNirvanaAtlasAssets } from "./NirvanaAtlas";
import {
  appendNirvanaChunk,
  createNirvanaChunk,
  createNirvanaRegion,
  type NirvanaChunk,
  type NirvanaChunkConnector,
  type NirvanaChunkCoord,
  type NirvanaLandmarkFrameId,
} from "./NirvanaRegionV2";
import {
  clampNirvanaCamera,
  createNirvanaPaintPreparation,
  createNirvanaPaintPlan,
  renderNirvanaRegion,
  type NirvanaCamera,
} from "./NirvanaPainter";

const terrainImage = { width: 512, height: 800 } as CanvasImageSource;
const sceneryImage = { width: 672, height: 1010 } as CanvasImageSource;
const assets = createNirvanaAtlasAssets(
  terrainImage,
  sceneryImage,
  NIRVANA_ATLAS_PROFILE,
);

interface RecordedContext {
  readonly canvas: HTMLCanvasElement;
  imageSmoothingEnabled: boolean;
  readonly clearRect: ReturnType<typeof vi.fn>;
  readonly drawImage: ReturnType<typeof vi.fn>;
}

describe("production Nirvana painter", () => {
  it("clamps cameras against signed active-chunk bounds", () => {
    const root = chunk({ column: 0, row: 0 }, [{ edge: "west", offset: 4 }]);
    const west = chunk({ column: -1, row: 0 }, [{ edge: "east", offset: 4 }]);
    const region = appendNirvanaChunk(createNirvanaRegion(root), west);
    const viewport = { width: 100, height: 80 };

    expect(clampNirvanaCamera(region, { x: -99_999, y: -99_999, ...viewport }))
      .toEqual({ x: -1536, y: 0, ...viewport });
    expect(clampNirvanaCamera(region, { x: 99_999, y: 99_999, ...viewport }))
      .toEqual({ x: 1436, y: 944, ...viewport });
  });

  it("extracts one frozen terrain-road-landmark-continuation paint plan", () => {
    const root = chunk(
      { column: 0, row: 0 },
      [{ edge: "east", offset: 4 }],
      { id: "root-late", at: { x: 1500, y: 120 }, frameId: "landmark.hero-oak" },
    );
    const east = chunk(
      { column: 1, row: 0 },
      [{ edge: "west", offset: 4 }],
      { id: "east-early", at: { x: -40, y: 40 }, frameId: "landmark.ruined-garden" },
    );
    const region = appendNirvanaChunk(createNirvanaRegion(root), east);
    const plan = createNirvanaPaintPlan(region, assets, "nirvana:test");
    const terrain = plan.operations.filter(({ stableId }) => stableId.startsWith("terrain:"));
    const landmarks = plan.operations.filter(({ layer }) => layer === "scenery");
    const continuation = plan.operations.filter(({ layer }) => layer === "continuation");

    expect(plan.cacheIdentity).toBe("nirvana:test");
    expect(terrain).toHaveLength(2 * 48 * 32);
    expect(landmarks.map(({ stableId }) => stableId)).toEqual([
      "landmark:1,0:east-early",
      "landmark:0,0:root-late",
    ]);
    expect(landmarks.every(({ pivotY }) => pivotY !== undefined)).toBe(true);
    expect(continuation).toHaveLength(64);
    expect(Object.isFrozen(plan.operations)).toBe(true);
  });

  it("defers paint traversal until the first positive-budget advance", () => {
    const region = createNirvanaRegion(
      chunk({ column: 0, row: 0 }, [{ edge: "east", offset: 4 }]),
    );
    const values = vi.fn(() => region.chunks.values());
    const observedRegion = {
      ...region,
      chunks: { values },
    } as unknown as typeof region;

    const preparation = createNirvanaPaintPreparation(
      observedRegion,
      assets,
      "nirvana:lazy",
    );

    expect(values).not.toHaveBeenCalled();
    const streamed: unknown[] = [];
    expect(preparation.advance(1, (operation) => streamed.push(operation)))
      .toEqual({ done: false, workUnits: 1 });
    expect(values).toHaveBeenCalledTimes(1);
    expect(streamed).toHaveLength(1);
    preparation.dispose();
  });

  it("honors every positive budget while preserving the exact eager-plan operation stream", () => {
    const root = chunk(
      { column: 0, row: 0 },
      [{ edge: "east", offset: 4 }],
      { id: "root-late", at: { x: 1500, y: 120 }, frameId: "landmark.hero-oak" },
    );
    const east = chunk(
      { column: 1, row: 0 },
      [{ edge: "west", offset: 4 }],
      { id: "east-early", at: { x: -40, y: 40 }, frameId: "landmark.ruined-garden" },
    );
    const region = appendNirvanaChunk(createNirvanaRegion(root), east);
    const expected = createNirvanaPaintPlan(region, assets, "nirvana:stream-equivalence");
    const preparation = createNirvanaPaintPreparation(
      region,
      assets,
      "nirvana:stream-equivalence",
    );
    const streamed: typeof expected.operations[number][] = [];
    const budgets = [1, 7, 127] as const;
    let advanceIndex = 0;
    let done = false;

    while (!done) {
      const budget = budgets[advanceIndex % budgets.length]!;
      const before = streamed.length;
      const result = preparation.advance(budget, (operation) => streamed.push(operation));
      const emitted = streamed.length - before;
      expect(emitted).toBe(result.workUnits);
      expect(emitted).toBeLessThanOrEqual(budget);
      done = result.done;
      advanceIndex += 1;
    }
    preparation.dispose();

    expect(streamed).toEqual(expected.operations);
  });

  it("culls offscreen chunks and tiles while keeping native integer atlas draws", () => {
    const root = chunk({ column: 0, row: 0 }, [{ edge: "east", offset: 4 }]);
    const east = chunk({ column: 1, row: 0 }, [{ edge: "west", offset: 4 }]);
    const region = appendNirvanaChunk(createNirvanaRegion(root), east);
    const context = recordedContext(64, 64);

    renderNirvanaRegion(
      context as unknown as CanvasRenderingContext2D,
      region,
      assets,
      { x: 0, y: 0, width: 64, height: 64 },
    );

    expect(context.imageSmoothingEnabled).toBe(false);
    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 64, 64);
    expect(context.drawImage).toHaveBeenCalledTimes(4);
    for (const call of context.drawImage.mock.calls) {
      expect(call).toHaveLength(9);
      expect(call[0]).toBe(terrainImage);
      for (const value of call.slice(1)) expect(Number.isInteger(value)).toBe(true);
      expect(call[3]).toBeLessThan(1536);
      expect(call[4]).toBeLessThan(1024);
    }
  });

  it("draws an overhanging visual whose owning terrain chunk is offscreen", () => {
    const root = chunk({ column: 0, row: 0 }, [{ edge: "east", offset: 4 }]);
    const east = chunk(
      { column: 1, row: 0 },
      [{ edge: "west", offset: 4 }],
      {
        id: "east-overhang",
        at: { x: -64, y: 32 },
        frameId: "landmark.ruined-garden",
      },
    );
    const region = appendNirvanaChunk(createNirvanaRegion(root), east);
    const context = recordedContext(100, 240);

    renderNirvanaRegion(
      context as unknown as CanvasRenderingContext2D,
      region,
      assets,
      { x: 1400, y: 0, width: 100, height: 240 },
    );

    const landmarkCalls = context.drawImage.mock.calls.filter(([image]) => image === sceneryImage);
    // owner-authorised Option A re-baseline, plan §P3: "landmark.ruined-garden" moved to
    // (480, 754) in the nirvana-v3 scenery sheet.
    expect(landmarkCalls).toEqual([
      [sceneryImage, 480, 754, 128, 128, 72, 32, 128, 128],
    ]);
  });

  it("depth-sorts visible landmark visuals globally across chunk seams", () => {
    const root = chunk(
      { column: 0, row: 0 },
      [{ edge: "east", offset: 4 }],
      { id: "root-late", at: { x: 1500, y: 120 }, frameId: "landmark.hero-oak" },
    );
    const east = chunk(
      { column: 1, row: 0 },
      [{ edge: "west", offset: 4 }],
      { id: "east-early", at: { x: -40, y: 40 }, frameId: "landmark.ruined-garden" },
    );
    const region = appendNirvanaChunk(createNirvanaRegion(root), east);
    const context = recordedContext(256, 320);
    const camera: NirvanaCamera = { x: 1400, y: 0, width: 256, height: 320 };

    renderNirvanaRegion(
      context as unknown as CanvasRenderingContext2D,
      region,
      assets,
      camera,
    );

    const landmarkCalls = context.drawImage.mock.calls.filter(([image]) => image === sceneryImage);
    expect(landmarkCalls).toHaveLength(2);
    // owner-authorised Option A re-baseline, plan §P3: "landmark.ruined-garden" and
    // "landmark.hero-oak" moved to (480, 754) and (192, 626) in the nirvana-v3 scenery
    // sheet; the paint ORDER asserted here (east-early before root-late) is unchanged.
    expect(landmarkCalls.map((call) => [call[1], call[2]])).toEqual([
      [480, 754],
      [192, 626],
    ]);
    for (const call of landmarkCalls) {
      expect(Number.isInteger(call[5])).toBe(true);
      expect(Number.isInteger(call[6])).toBe(true);
      expect(Number.isInteger(call[7])).toBe(true);
      expect(Number.isInteger(call[8])).toBe(true);
    }
  });

  it("grounds an authored bridge sprite before its foot-sorted deck image", () => {
    const region = createNirvanaRegion(
      chunk(
        { column: 0, row: 0 },
        [],
        undefined,
        [{
          id: "bridge-north-1",
          frameId: "s.bridgedeckh.0",
          tile: { column: 2, row: 2 },
          at: { x: 48, y: 64 },
          foot: { x: 64, y: 95 },
          blocksMovement: false,
        }],
      ),
    );
    const plan = createNirvanaPaintPlan(region, assets, "nirvana:bridge-depth");
    const accent = plan.operations.find((operation) => (
      operation.stableId === "grounding:scenery:0,0:bridge-north-1"
    ));
    const deckIndex = plan.operations.findIndex((operation) => (
      operation.stableId === "scenery:0,0:bridge-north-1"
    ));
    expect(accent).toMatchObject({ layer: "scenery", pivotY: 95 });
    expect(accent).toBeDefined();
    expect(plan.operations.indexOf(accent!)).toBeLessThan(deckIndex);
    expect(accent!.destination.x).toBeGreaterThan(48);
    expect(accent!.destination.y).toBeGreaterThan(64);
  });
});

function recordedContext(width: number, height: number): RecordedContext {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return {
    canvas,
    imageSmoothingEnabled: true,
    clearRect: vi.fn(),
    drawImage: vi.fn(),
  };
}

function chunk(
  coord: NirvanaChunkCoord,
  connectors: readonly NirvanaChunkConnector[] = [],
  visual?: Readonly<{
    id: string;
    at: Readonly<{ x: number; y: number }>;
    frameId: NirvanaLandmarkFrameId;
  }>,
  scenery: readonly Readonly<{
    id: string;
    frameId: string;
    tile: Readonly<{ column: number; row: number }>;
    at: Readonly<{ x: number; y: number }>;
    foot: Readonly<{ x: number; y: number }>;
    blocksMovement: boolean;
  }>[] = [],
): NirvanaChunk {
  const landmarks = visual === undefined ? [] : [{
    id: `${visual.id}-landmark`,
    feature: visual.frameId === "landmark.hero-oak" ? "hero-oak" as const : "ruined-garden" as const,
    frameId: visual.frameId,
    tile: { column: 1, row: 1 },
    bounds: { column: 1, row: 1, columns: 1, rows: 1 },
    blocksMovement: false,
    collisionTiles: [],
    collisionRole: "visual-footprint" as const,
    visuals: [{ id: visual.id, frameId: visual.frameId, at: visual.at, scale: 1 as const }],
  }];
  return createNirvanaChunk({
    coord,
    columns: 48,
    rows: 32,
    // "olive-grass" is retired; a uniform "grass" fill with no overlays or shorelines
    // keeps this fixture's terrain as flat and paint-cheap as the old flat kind was.
    terrainCells: Array.from({ length: 48 * 32 }, (_, index) => ({
      tile: { column: index % 48, row: Math.floor(index / 48) },
      kind: "grass" as const,
      variant: 0 as const,
      base: "grass" as const,
      overlays: [],
      shorelines: [],
    })),
    roadCells: [],
    roadHub: { column: 0, row: 0 },
    landmarks,
    scenery,
    quietClearings: [],
    collision: Array.from({ length: 48 * 32 }, () => 0 as const),
    connectors,
  });
}
