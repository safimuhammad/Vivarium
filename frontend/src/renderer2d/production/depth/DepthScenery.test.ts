import { describe, expect, it, vi } from "vitest";
import type { RegionSnapshot } from "../../../app/schemas";
import { createRegionMapIdentity } from "../maps/RegionMapIdentity";
import { createProductionRegionMapRecipe } from "../maps/ProductionRegionMapRecipe";
import { depthSceneryOpacity, depthSceneryPlacements, drawDepthSceneryProp, depthSceneryInView, depthScenerySway, type DepthSceneryPlacement } from "./DepthScenery";

const specs = [
  ["nirvana", "a once-heavenly landscape, now thinning and picked-over"],
  ["nirvana_east", "a struggling, near-barren stretch"],
  ["nirvana_west", "a nuclear wasteland, all but dead"],
  ["warm_springs", "hot spring lakes"],
] as const;
const regions: RegionSnapshot[] = specs.map(([name, description]) => ({
  name, description, connections: specs.filter(([id]) => id !== name).map(([id]) => id),
  energy_rate: 0.2, materials_rate: 0.2, current_energy: 40, current_materials: 40,
  max_energy: 100, max_materials: 100,
}));

describe("scenery depth", () => {
  it("gives living canopies repeatable, restrained motion with a fixed root", () => {
    const tree: DepthSceneryPlacement = { id: "willow-test", kind: "willow", feet: { x: 100, y: 200 }, bounds: { x: 20, y: 40, width: 160, height: 165 } };
    const angle = depthScenerySway(tree, 1000);
    expect(angle).toBe(depthScenerySway(tree, 1000));
    expect(Math.abs(angle)).toBeLessThanOrEqual(0.012);
    expect(depthScenerySway(tree, 2250)).not.toBe(angle);
    expect(depthScenerySway({ ...tree, kind: "cedar" }, 1000)).toBe(0);
    const context = {
      save: vi.fn(), restore: vi.fn(), drawImage: vi.fn(), translate: vi.fn(), rotate: vi.fn(), globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;
    drawDepthSceneryProp(context, {} as CanvasImageSource, tree, [], undefined, 1000);
    expect(context.translate).toHaveBeenNthCalledWith(1, 100, 200);
    expect(context.translate).toHaveBeenNthCalledWith(2, -100, -200);
    expect(context.rotate).toHaveBeenCalledWith(angle);
    vi.mocked(context.rotate).mockClear();
    drawDepthSceneryProp(context, {} as CanvasImageSource, tree, []);
    expect(context.rotate).not.toHaveBeenCalled();
  });
  it.each(regions)("adds deterministic grounded scenery to $name without changing navigation", (region) => {
    const recipe = createProductionRegionMapRecipe(createRegionMapIdentity(7, region, regions));
    const before = recipe.grid.collision.slice();
    const props = depthSceneryPlacements(recipe);
    // West's surviving woodland has eight legal roots after route protection.
    expect(props.length).toBeGreaterThanOrEqual(8);
    expect(props.length).toBeLessThanOrEqual(96);
    expect(depthSceneryPlacements(recipe)).toBe(props);
    expect(new Set(props.map(({ id }) => id)).size).toBe(props.length);
    expect(props.every((prop, index) => index === 0 || props[index - 1]!.feet.y <= prop.feet.y)).toBe(true);
    expect(recipe.grid.collision).toEqual(before);
    expect(props.every(({ bounds, feet }) => bounds.y + bounds.height === feet.y + 5)).toBe(true);
  });

  it("reveals only beings behind an overlapping canopy", () => {
    const oak: DepthSceneryPlacement = { id: "oak", kind: "oak", feet: { x: 100, y: 200 }, bounds: { x: 20, y: 40, width: 160, height: 165 } };
    expect(depthSceneryOpacity(oak, [{ x: 100, y: 155 }])).toBeLessThan(0.6);
    expect(depthSceneryOpacity(oak, [{ x: 100, y: 230 }])).toBe(1);
    expect(depthSceneryOpacity(oak, [{ x: 300, y: 155 }])).toBe(1);
    expect(depthSceneryOpacity({ ...oak, kind: "sandstone" }, [{ x: 100, y: 155 }])).toBe(1);
  });

  it("culls distant props while retaining a crown or shadow at the viewport edge", () => {
    const tree: DepthSceneryPlacement = { id: "oak", kind: "oak", feet: { x: 100, y: 200 }, bounds: { x: 20, y: 40, width: 160, height: 165 } };
    expect(depthSceneryInView(tree, { x: 80, y: 20, width: 40, height: 30 })).toBe(true);
    expect(depthSceneryInView(tree, { x: 80, y: 210, width: 40, height: 40 })).toBe(true);
    expect(depthSceneryInView(tree, { x: 185, y: 195, width: 40, height: 40 })).toBe(true);
    const context = { drawImage: vi.fn(), save: vi.fn() } as unknown as CanvasRenderingContext2D;
    drawDepthSceneryProp(context, {} as CanvasImageSource, tree, [], { x: 500, y: 500, width: 200, height: 200 });
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(context.save).not.toHaveBeenCalled();
  });
});
