import { describe, expect, it } from "vitest";

import { createGroundingAccentOperation } from "./StaticPainterAccents";

describe("StaticPainterAccents", () => {
  it("projects a small directional contact band from the frame foot", () => {
    const operation = createGroundingAccentOperation(
      "grounding:prop:oak-1",
      {
        atlasId: "region-scenery",
        rect: { x: 12, y: 30, width: 100, height: 80 },
        pivot: { x: 50, y: 70 },
      },
      150,
      240,
    );

    expect(operation).toMatchObject({
      stableId: "grounding:prop:oak-1",
      layer: "scenery",
      atlasId: "region-scenery",
      pivotY: 240,
    });
    expect(operation.source.x).toBeGreaterThanOrEqual(12);
    expect(operation.source.y).toBeGreaterThanOrEqual(30);
    expect(operation.source.x + operation.source.width).toBeLessThanOrEqual(112);
    expect(operation.source.y + operation.source.height).toBeLessThanOrEqual(110);
    expect(operation.destination.x).toBeGreaterThan(150 - operation.destination.width / 2);
    expect(operation.destination.y).toBeGreaterThan(240 - operation.destination.height);
    expect(operation.destination.y).toBeLessThanOrEqual(240);
    for (const value of [
      operation.source.x,
      operation.source.y,
      operation.source.width,
      operation.source.height,
      operation.destination.x,
      operation.destination.y,
      operation.destination.width,
      operation.destination.height,
      operation.pivotY,
    ]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it("is deterministic and does not mutate the source frame", () => {
    const frame = {
      atlasId: "region-scenery",
      rect: { x: 0, y: 0, width: 48, height: 96 },
      pivot: { x: 24, y: 88 },
    } as const;
    const first = createGroundingAccentOperation("grounding:prop:tree-1", frame, 80, 120);
    const second = createGroundingAccentOperation("grounding:prop:tree-1", frame, 80, 120);
    expect(second).toEqual(first);
    expect(frame).toEqual({
      atlasId: "region-scenery",
      rect: { x: 0, y: 0, width: 48, height: 96 },
      pivot: { x: 24, y: 88 },
    });
  });
});
