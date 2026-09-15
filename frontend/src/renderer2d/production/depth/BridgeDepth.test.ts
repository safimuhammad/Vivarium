import { describe, expect, it, vi } from "vitest";

import type { RegionSnapshot } from "../../../app/schemas";
import { tileCenter, tileIndex } from "../../map/regionMap";
import { createRegionMapIdentity } from "../maps/RegionMapIdentity";
import { createRegionMapRecipe } from "../maps/RegionMapRecipe";
import { createNirvanaRegionMapRecipe } from "../nirvana/NirvanaRegionMapRecipe";
import {
  bridgeDepthScene,
  bridgeElevationAt,
  bridgeRailSlices,
  drawBridgeBase,
  drawBridgeRail,
  projectBridgeFeet,
} from "./BridgeDepth";

const regions: readonly RegionSnapshot[] = [
  region("nirvana", "a once-heavenly landscape, now thinning and picked-over"),
  region("warm_springs", "hot spring lakes"),
];
const recipe = createNirvanaRegionMapRecipe(createRegionMapIdentity(813, regions[0]!, regions));

function region(name: string, description: string): RegionSnapshot {
  return {
    name,
    description,
    connections: [],
    energy_rate: 0.2,
    materials_rate: 0.2,
    current_energy: 40,
    current_materials: 40,
    max_energy: 100,
    max_materials: 100,
  };
}

function drawingContext(): CanvasRenderingContext2D {
  return {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    fill: vi.fn(),
    stroke: vi.fn(),
    fillRect: vi.fn(),
    imageSmoothingEnabled: true,
  } as unknown as CanvasRenderingContext2D;
}

describe("north channel bridge depth", () => {
  it("derives the exact pilot from trusted authored scenery and replaces every native bridge operation", () => {
    const scene = bridgeDepthScene(recipe);

    expect(scene).not.toBeNull();
    expect(bridgeDepthScene(recipe)).toBe(scene);
    expect(scene!.deckBounds).toEqual({ x: 960, y: 128, width: 32, height: 352 });
    expect(scene!.startY).toBe(128);
    expect(scene!.endY).toBe(480);
    expect(scene!.height).toBe(18);
    expect(scene!.bounds.x).toBeLessThanOrEqual(scene!.deckBounds.x);
    expect(scene!.bounds.x + scene!.bounds.width).toBeGreaterThanOrEqual(
      scene!.deckBounds.x + scene!.deckBounds.width,
    );
    expect(scene!.replacedOperationIds).toEqual(expect.objectContaining({
      has: expect.any(Function),
    }));
    expect(scene!.replacedOperationIds.has("scenery:0,0:bridge:north-channel-bridge:30,5")).toBe(true);
    expect(scene!.replacedOperationIds.has("scenery:0,0:post:north-channel-bridge:30,6")).toBe(true);
    expect(scene!.replacedOperationIds.has("scenery:0,0:pier:north-channel-bridge:30,14")).toBe(true);
    expect(scene!.replacedOperationIds.has("grounding:scenery:0,0:bridge:north-channel-bridge:30,5")).toBe(true);

    // A recipe that happens to carry the same public IDs has no trusted semantic sidecar.
    expect(bridgeDepthScene({ ...recipe })).toBeNull();
    const other = createRegionMapRecipe(createRegionMapIdentity(813, regions[1]!, regions));
    expect(bridgeDepthScene(other)).toBeNull();
  });

  it("lifts the actual walkable bridge tiles with a smooth, non-folding entry and exit", () => {
    const scene = bridgeDepthScene(recipe)!;
    for (let row = 4; row <= 14; row += 1) {
      const feet = tileCenter({ column: 30, row });
      expect(recipe.grid.collision[tileIndex(recipe.grid, { column: 30, row })]).toBe(0);
      expect(bridgeElevationAt(scene, feet)).toBeGreaterThan(0);
    }

    expect(bridgeElevationAt(scene, { x: 959.999, y: scene.startY + 64 })).toBe(0);
    expect(bridgeElevationAt(scene, { x: 992, y: scene.startY + 64 })).toBe(0);
    expect(bridgeElevationAt(scene, { x: 976, y: scene.startY })).toBe(0);
    expect(bridgeElevationAt(scene, { x: 976, y: scene.endY })).toBe(0);
    expect(bridgeElevationAt(scene, { x: 976, y: scene.startY + 32 })).toBe(scene.height);
    expect(bridgeElevationAt(scene, { x: 976, y: scene.endY - 32 })).toBe(scene.height);

    const rise = Array.from({ length: 33 }, (_, offset) => bridgeElevationAt(
      scene,
      { x: 976, y: scene.startY + offset },
    ));
    const fall = Array.from({ length: 33 }, (_, offset) => bridgeElevationAt(
      scene,
      { x: 976, y: scene.endY - 32 + offset },
    ));
    for (let index = 1; index < rise.length; index += 1) {
      expect(rise[index]!).toBeGreaterThanOrEqual(rise[index - 1]!);
      expect(fall[index]!).toBeLessThanOrEqual(fall[index - 1]!);
    }

    for (let y = scene.startY; y < scene.endY; y += 0.25) {
      const current = projectBridgeFeet(scene, { x: 976, y }).y;
      const next = projectBridgeFeet(scene, { x: 976, y: y + 0.25 }).y;
      expect(next).toBeGreaterThan(current);
    }
    expect(projectBridgeFeet(null, { x: 400, y: 220 })).toEqual({ x: 400, y: 220 });
  });

  it("smooths only into the real collision-open side entries of the authored ramps", () => {
    const scene = bridgeDepthScene(recipe)!;
    const neighbouringTiles = Array.from({ length: 11 }, (_, index) => index + 4)
      .flatMap((row) => [29, 31].map((column) => ({ column, row })));
    const entries = neighbouringTiles
      .filter(({ column, row }) => recipe.grid.collision[tileIndex(recipe.grid, { column, row })] === 0);
    expect(entries).toEqual([
      { column: 29, row: 4 },
      { column: 31, row: 13 },
      { column: 29, row: 14 },
      { column: 31, row: 14 },
    ]);

    for (const entry of entries) {
      const y = tileCenter(entry).y;
      const outer = entry.column < 30 ? entry.column * 32 : (entry.column + 1) * 32;
      const inner = entry.column < 30 ? (entry.column + 1) * 32 : entry.column * 32;
      const samples = Array.from({ length: 33 }, (_, index) => {
        const progress = index / 32;
        const x = outer + (inner - outer) * progress;
        return bridgeElevationAt(scene, { x, y });
      });
      for (let index = 1; index < samples.length; index += 1) {
        expect(samples[index]!).toBeGreaterThanOrEqual(samples[index - 1]!);
        expect(Math.abs(samples[index]! - samples[index - 1]!)).toBeLessThan(1);
      }
      expect(samples[0]!).toBe(0);
      expect(samples.at(-1)!).toBeCloseTo(bridgeElevationAt(scene, { x: 976, y }), 8);
      expect(scene.bounds.x).toBeLessThanOrEqual(entry.column * 32);
      expect(scene.bounds.x + scene.bounds.width).toBeGreaterThanOrEqual((entry.column + 1) * 32);

      for (const boundary of [entry.row * 32, (entry.row + 1) * 32]) {
        const adjacentRow = boundary === entry.row * 32 ? entry.row - 1 : entry.row + 1;
        if (recipe.grid.collision[tileIndex(recipe.grid, { column: entry.column, row: adjacentRow })] !== 0) continue;
        const x = tileCenter(entry).x;
        expect(Math.abs(
          bridgeElevationAt(scene, { x, y: boundary - 0.001 })
            - bridgeElevationAt(scene, { x, y: boundary + 0.001 }),
        )).toBeLessThan(0.02);
      }
    }
    // The sole blocked neighbor at the north ramp never gets a fictional shoulder.
    expect(bridgeElevationAt(scene, tileCenter({ column: 31, row: 4 }))).toBe(0);

    const context = drawingContext();
    drawBridgeBase(context, scene, scene.bounds);
    const rampStarts = vi.mocked(context.moveTo).mock.calls.map(([x]) => x);
    for (const entry of entries) {
      const outerEdge = entry.column < 30 ? entry.column * 32 : (entry.column + 1) * 32;
      expect(rampStarts).toContain(outerEdge);
    }
  });

  it("offers short unique foreground-rail slices and culls the passive painter before drawing", () => {
    const scene = bridgeDepthScene(recipe)!;
    const slices = bridgeRailSlices(scene);
    expect(slices.map(({ feetY }) => feetY)).toEqual([
      159, 191, 223, 255, 287, 319, 351, 383, 415, 447, 479,
    ]);
    expect(new Set(slices.map(({ feetY }) => feetY)).size).toBe(slices.length);

    const context = drawingContext();
    const distant = { x: 2_000, y: 2_000, width: 80, height: 80 };
    drawBridgeBase(context, scene, distant);
    drawBridgeRail(context, scene, slices[0]!.feetY, distant);
    expect(context.save).not.toHaveBeenCalled();

    drawBridgeBase(context, scene, scene.bounds);
    expect(context.fillRect).toHaveBeenCalled();
    expect(context.save).toHaveBeenCalledTimes(1);
    drawBridgeRail(context, scene, slices[0]!.feetY, scene.bounds);
    expect(context.stroke).toHaveBeenCalled();
    expect(context.save).toHaveBeenCalledTimes(2);

    const before = vi.mocked(context.save).mock.calls.length;
    drawBridgeRail(context, scene, 999_999, scene.bounds);
    expect(context.save).toHaveBeenCalledTimes(before);
  });
});
