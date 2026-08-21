import { describe, expect, it, vi } from "vitest";

import {
  createProductionStaticSceneDescriptor,
  createProductionStaticDrawOperation,
  createProductionStaticScenePlan,
  drawProductionStaticSceneOperation,
  visiblePeriodicDrawOffsets,
  visibleSeamActorOffsets,
  type ProductionStaticDrawOperation,
} from "./ProductionStaticScene";

describe("production static-scene contract", () => {
  it("owns and deeply freezes deterministic draw operations", () => {
    const source = operation("ground:0,0", "terrain");
    const plan = createProductionStaticScenePlan("scene:one", [source]);
    (source.source as { x: number }).x = 99;
    (source.destination as { y: number }).y = 88;

    expect(plan).toEqual({
      cacheIdentity: "scene:one",
      operations: [operation("ground:0,0", "terrain")],
    });
    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.operations)).toBe(true);
    expect(Object.isFrozen(plan.operations[0])).toBe(true);
    expect(Object.isFrozen(plan.operations[0]!.source)).toBe(true);
    expect(Object.isFrozen(plan.operations[0]!.destination)).toBe(true);
  });

  it("validates, detaches, and deeply freezes each streamed draw operation", () => {
    const source = operation("streamed:0,0", "terrain");
    const streamed = createProductionStaticDrawOperation(source, 7);
    (source.source as { x: number }).x = 96;
    (source.destination as { y: number }).y = 64;

    expect(streamed).toEqual(operation("streamed:0,0", "terrain"));
    expect(streamed).not.toBe(source);
    expect(streamed.source).not.toBe(source.source);
    expect(streamed.destination).not.toBe(source.destination);
    expect(Object.isFrozen(streamed)).toBe(true);
    expect(Object.isFrozen(streamed.source)).toBe(true);
    expect(Object.isFrozen(streamed.destination)).toBe(true);
    expect(() => createProductionStaticDrawOperation({
      ...operation("streamed:bad-source", "terrain"),
      source: { x: 0, y: 0, width: 0, height: 32 },
    }, 8)).toThrow(/source/i);
    expect(() => createProductionStaticDrawOperation({
      ...operation("streamed:bad-pivot", "terrain"),
      pivotY: 32,
    }, 9)).toThrow(/pivot.*scenery/i);
  });

  it("rejects ambiguous IDs, malformed rectangles, and invalid pivot ownership", () => {
    expect(() => createProductionStaticScenePlan("scene", [
      operation("same", "terrain"),
      operation("same", "terrain"),
    ])).toThrow(/duplicate.*stable/i);
    expect(() => createProductionStaticScenePlan("scene", [{
      ...operation("bad-source", "terrain"),
      source: { x: 0, y: 0, width: 0, height: 32 },
    }])).toThrow(/source/i);
    expect(() => createProductionStaticScenePlan("scene", [{
      ...operation("terrain-pivot", "terrain"),
      pivotY: 32,
    }])).toThrow(/pivot.*scenery/i);
    const { pivotY: _pivotY, ...missingPivot } = operation("missing-pivot", "scenery");
    expect(() => createProductionStaticScenePlan("scene", [missingPivot]))
      .toThrow(/scenery.*pivot/i);
  });

  it("draws one owned operation with an explicit world offset", () => {
    const context = { drawImage: vi.fn() };
    const image = { width: 256, height: 128 } as CanvasImageSource;
    const operation = createProductionStaticScenePlan("scene", [{
      ...operationFixture("tile", "terrain"),
      source: { x: 32, y: 64, width: 32, height: 32 },
      destination: { x: 320, y: 640, width: 32, height: 32 },
    }]).operations[0]!;

    drawProductionStaticSceneOperation(
      context as unknown as CanvasRenderingContext2D,
      image,
      operation,
      { x: 300, y: 600 },
    );

    expect(context.drawImage).toHaveBeenCalledWith(
      image,
      32, 64, 32, 32,
      20, 40, 32, 32,
    );
  });

  it("validates, detaches, and deeply freezes static-scene descriptors", () => {
    const bounds = { x: -64, y: 32, width: 3_072, height: 2_048 };
    const descriptor = createProductionStaticSceneDescriptor({
      cacheIdentity: "nirvana-v2:scene",
      worldBounds: bounds,
      topology: "toroidal",
    });
    bounds.x = 999;

    expect(descriptor).toEqual({
      cacheIdentity: "nirvana-v2:scene",
      worldBounds: { x: -64, y: 32, width: 3_072, height: 2_048 },
      topology: "toroidal",
    });
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Object.isFrozen(descriptor.worldBounds)).toBe(true);
    expect(() => createProductionStaticSceneDescriptor({
      ...descriptor,
      cacheIdentity: " ",
    })).toThrow(/identity/i);
    expect(() => createProductionStaticSceneDescriptor({
      ...descriptor,
      topology: "cylindrical" as "toroidal",
    })).toThrow(/topology/i);
    expect(() => createProductionStaticSceneDescriptor({
      ...descriptor,
      worldBounds: { ...descriptor.worldBounds, width: 0 },
    })).toThrow(/bounds/i);
    expect(() => createProductionStaticSceneDescriptor({
      ...descriptor,
      worldBounds: { ...descriptor.worldBounds, x: 0.5 },
    })).toThrow(/bounds/i);
  });

  it.each([
    {
      label: "interior",
      viewport: { x: 20, y: 10, width: 40, height: 30 },
      expected: [{ x: 0, y: 0 }],
    },
    {
      label: "one seam",
      viewport: { x: 80, y: 10, width: 30, height: 30 },
      expected: [{ x: 0, y: 0 }, { x: 100, y: 0 }],
    },
    {
      label: "corner",
      viewport: { x: 80, y: 60, width: 30, height: 30 },
      expected: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 80 },
        { x: 100, y: 80 },
      ],
    },
  ])("returns only visible periodic offsets at the $label", ({ viewport, expected }) => {
    expect(visiblePeriodicDrawOffsets(
      { x: 0, y: 0, width: 100, height: 80 },
      viewport,
    )).toEqual(expected);
  });

  it("does not add duplicates or edge-touching offscreen copies", () => {
    const world = { x: 0, y: 0, width: 100, height: 80 };
    const offsets = visiblePeriodicDrawOffsets(
      world,
      { x: 0, y: 0, width: 100, height: 80 },
    );
    expect(offsets).toEqual([{ x: 0, y: 0 }]);
    expect(new Set(offsets.map(({ x, y }) => `${x},${y}`)).size).toBe(offsets.length);
    expect(visiblePeriodicDrawOffsets(
      world,
      { x: -10, y: 20, width: 20, height: 20 },
    )).toEqual([{ x: -100, y: 0 }, { x: 0, y: 0 }]);
  });

  it("covers every periodic copy visible through 1920px and 4K viewports at minimum zoom", () => {
    const world = { x: 0, y: 0, width: 3_072, height: 3_072 };

    expect(visiblePeriodicDrawOffsets(
      world,
      { x: -384, y: 456, width: 1_920 / 0.5, height: 1_080 / 0.5 },
    )).toEqual([
      { x: -3_072, y: 0 },
      { x: 0, y: 0 },
      { x: 3_072, y: 0 },
    ]);

    const fourKOffsets = visiblePeriodicDrawOffsets(
      world,
      { x: -2_304, y: -624, width: 3_840 / 0.5, height: 2_160 / 0.5 },
    );
    expect(fourKOffsets).toEqual([
      { x: -3_072, y: -3_072 },
      { x: 0, y: -3_072 },
      { x: 3_072, y: -3_072 },
      { x: -3_072, y: 0 },
      { x: 0, y: 0 },
      { x: 3_072, y: 0 },
      { x: -3_072, y: 3_072 },
      { x: 0, y: 3_072 },
      { x: 3_072, y: 3_072 },
    ]);
  });

  it("uses nonzero world origins and excludes copies that only touch a viewport edge", () => {
    expect(visiblePeriodicDrawOffsets(
      { x: 128, y: -64, width: 100, height: 80 },
      { x: 28, y: -64, width: 300, height: 80 },
    )).toEqual([
      { x: -100, y: 0 },
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ]);
  });
});

describe("seam actor continuation offsets", () => {
  const world = { x: 0, y: 0, width: 3_072, height: 3_072 };
  const toroidal = { topology: "toroidal" as const, worldBounds: world };

  it("draws nothing for a bounded region, whatever the viewport", () => {
    expect(visibleSeamActorOffsets(
      { topology: "bounded", worldBounds: world },
      { x: -100, y: -100, width: 4_000, height: 4_000 },
    )).toEqual([]);
  });

  it("draws nothing while the viewport is nowhere near a seam", () => {
    expect(visibleSeamActorOffsets(toroidal, { x: 1_000, y: 1_000, width: 800, height: 600 }))
      .toEqual([]);
  });

  it("carries west-edge beings east exactly when the east seam is on screen", () => {
    // Looking at the east edge: a being at x = 3072 - 8 (just crossed east, unrolled) is
    // ALSO drawn at x = -8, and a being at x = 8 is drawn at x = 3080.
    expect(visibleSeamActorOffsets(toroidal, { x: 2_900, y: 1_000, width: 400, height: 400 }))
      .toEqual([{ x: 3_072, y: 0 }]);
  });

  it("carries east-edge beings west exactly when the west seam is on screen", () => {
    expect(visibleSeamActorOffsets(toroidal, { x: -100, y: 1_000, width: 400, height: 400 }))
      .toEqual([{ x: -3_072, y: 0 }]);
  });

  it("handles the north and south seams on their own axis", () => {
    expect(visibleSeamActorOffsets(toroidal, { x: 1_000, y: 2_900, width: 400, height: 400 }))
      .toEqual([{ x: 0, y: 3_072 }]);
    expect(visibleSeamActorOffsets(toroidal, { x: 1_000, y: -100, width: 400, height: 400 }))
      .toEqual([{ x: 0, y: -3_072 }]);
  });

  it("never emits a diagonal copy, because a corner is never a legal wrap seam", () => {
    const whole = visibleSeamActorOffsets(toroidal, { x: -200, y: -200, width: 3_600, height: 3_600 });
    expect(whole).toEqual([
      { x: 3_072, y: 0 },
      { x: -3_072, y: 0 },
      { x: 0, y: 3_072 },
      { x: 0, y: -3_072 },
    ]);
    expect(whole.every(({ x, y }) => x === 0 || y === 0)).toBe(true);
  });

  it("refuses a degenerate world rect rather than dividing by nothing", () => {
    expect(visibleSeamActorOffsets(
      { topology: "toroidal", worldBounds: { x: 0, y: 0, width: 0, height: 0 } },
      { x: 0, y: 0, width: 10, height: 10 },
    )).toEqual([]);
  });
});

function operation(
  stableId: string,
  layer: ProductionStaticDrawOperation["layer"],
): ProductionStaticDrawOperation {
  return operationFixture(stableId, layer);
}

function operationFixture(
  stableId: string,
  layer: ProductionStaticDrawOperation["layer"],
): ProductionStaticDrawOperation {
  return {
    stableId,
    layer,
    atlasId: "nirvana-v2-terrain",
    source: { x: 0, y: 0, width: 32, height: 32 },
    destination: { x: 0, y: 0, width: 32, height: 32 },
    ...(layer === "scenery" ? { pivotY: 32 } : {}),
  };
}
