import { describe, expect, it, vi } from "vitest";

import { DEMO_SHELTER_MANIFEST, resolveShelterFrame, type ShelterRuinTier } from "./assets/shelterManifest";
import { createShelterVisualDrawer } from "./CanvasWorldRenderer";
import { createShelterActor, type ShelterSnapshot2D } from "./homes/ShelterActor";

function recordingContext() {
  return {
    imageSmoothingEnabled: true,
    globalAlpha: 1,
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    rotate: vi.fn(),
    beginPath: vi.fn(),
    rect: vi.fn(),
    clip: vi.fn(),
  } as unknown as CanvasRenderingContext2D;
}

function sourceRectFor(id: Parameters<typeof resolveShelterFrame>[1]) {
  const { rect } = resolveShelterFrame(DEMO_SHELTER_MANIFEST, id);
  return [rect.x, rect.y, rect.width, rect.height];
}

describe("native shelter drawing", () => {
  it("draws standing and falling component frameIds at exact native 128px rectangles without rotation", () => {
    const context = recordingContext();
    const atlas = { label: "shelter" } as unknown as ImageBitmap;
    const drawer = createShelterVisualDrawer(DEMO_SHELTER_MANIFEST);
    const shelter = createShelterActor({ id: "shelter-east", plot: { x: 368, y: 112 } });
    shelter.apply({ type: "settle", phase: "standing" }, 0);

    drawer.draw(context, atlas, shelter.snapshot(), "back", false);
    drawer.draw(context, atlas, shelter.snapshot(), "front", false);
    const standingCalls = vi.mocked(context.drawImage).mock.calls;
    expect(standingCalls.map((args) => args.slice(1, 5))).toEqual([
      sourceRectFor("foundation"),
      sourceRectFor("post"),
      sourceRectFor("wall-intact"),
      sourceRectFor("roof-intact"),
      sourceRectFor("door-closed"),
      sourceRectFor("hearth"),
    ]);
    expect(standingCalls.every((args) => args.slice(5).every(Number.isInteger))).toBe(true);
    expect(standingCalls.every((args) => args[3] === 128 && args[4] === 128 && args[7] === 128 && args[8] === 128)).toBe(true);
    expect(standingCalls[4]![5]).toBe(276);
    expect(standingCalls[5]![5]).toBe(338);
    expect(context.clip).toHaveBeenCalledTimes(3);
    expect(context.rect).toHaveBeenCalledWith(304, 20, 128, 48);
    expect(context.rect).toHaveBeenCalledWith(320, 57, 44, 70);
    expect(context.rect).toHaveBeenCalledWith(388, 72, 24, 24);

    vi.mocked(context.drawImage).mockClear();
    shelter.apply({ type: "collapse", durationMs: 2400 }, 12_000);
    shelter.advanceTo(13_500);
    drawer.draw(context, atlas, shelter.snapshot(), "back", false);
    drawer.draw(context, atlas, shelter.snapshot(), "front", false);
    expect(vi.mocked(context.drawImage).mock.calls.map((args) => args.slice(1, 5))).toEqual([
      sourceRectFor("foundation"),
      sourceRectFor("post"),
      sourceRectFor("wall-falling"),
      sourceRectFor("roof-falling"),
      sourceRectFor("door-falling"),
    ]);
    expect(context.rotate).not.toHaveBeenCalled();
  });

  it("draws explicit dust and persistent ruin compositions while suppressing the former component tree", () => {
    const context = recordingContext();
    const atlas = {} as ImageBitmap;
    const drawer = createShelterVisualDrawer(DEMO_SHELTER_MANIFEST);
    const shelter = createShelterActor({ id: "shelter-east", plot: { x: 368, y: 112 } });
    shelter.apply({ type: "settle", phase: "standing" }, 0);
    shelter.apply({ type: "collapse", durationMs: 2400 }, 12_000);
    shelter.advanceTo(14_000);

    drawer.draw(context, atlas, shelter.snapshot(), "effects", false);
    expect(vi.mocked(context.drawImage).mock.calls.at(-1)!.slice(1, 5)).toEqual(sourceRectFor("dust"));
    expect(context.globalAlpha).toBe(1);

    vi.mocked(context.drawImage).mockClear();
    shelter.advanceTo(14_400);
    for (const layer of ["back", "middle", "front", "effects"] as const) {
      drawer.draw(context, atlas, shelter.snapshot(), layer, false);
    }
    expect(vi.mocked(context.drawImage).mock.calls).toHaveLength(1);
    expect(vi.mocked(context.drawImage).mock.calls[0]!.slice(1, 5)).toEqual(sourceRectFor("rubble-full"));
  });

  it.each([
    ["full", "rubble-full"],
    ["picked-over", "rubble-picked-over"],
    ["nearly-bare", "rubble-nearly-bare"],
  ] as const)("draws the %s ruin tier from its typed composition", (tier, frameId) => {
    const context = recordingContext();
    const drawer = createShelterVisualDrawer(DEMO_SHELTER_MANIFEST);
    const shelter = createShelterActor({ id: "shelter-east", plot: { x: 368, y: 112 } });
    shelter.apply({ type: "settle", phase: "ruin" }, 0);
    const snapshot = shelter.snapshot();
    const synthetic: ShelterSnapshot2D = {
      ...snapshot,
      visual: { ...snapshot.visual, ruin: { tier: tier as ShelterRuinTier, composition: [frameId] } },
    };

    drawer.draw(context, {} as ImageBitmap, synthetic, "middle", false);

    expect(vi.mocked(context.drawImage).mock.calls).toHaveLength(1);
    expect(vi.mocked(context.drawImage).mock.calls[0]!.slice(1, 5)).toEqual(sourceRectFor(frameId));
  });

  it("suppresses dust under reduced motion and rejects undeclared frameIds", () => {
    const context = recordingContext();
    const drawer = createShelterVisualDrawer(DEMO_SHELTER_MANIFEST);
    const shelter = createShelterActor({ id: "shelter-east", plot: { x: 368, y: 112 } });
    shelter.apply({ type: "settle", phase: "standing" }, 0);
    shelter.apply({ type: "collapse", durationMs: 2400 }, 12_000);
    shelter.advanceTo(14_000);
    drawer.draw(context, {} as ImageBitmap, shelter.snapshot(), "effects", true);
    expect(context.drawImage).not.toHaveBeenCalled();

    const snapshot = shelter.snapshot();
    const invalid = {
      ...snapshot,
      components: snapshot.components.map((component, index) => index === 0
        ? { ...component, frameId: "invented" as never }
        : component),
    };
    expect(() => drawer.draw(context, {} as ImageBitmap, invalid, "back", false)).toThrow(/undeclared/i);
  });
});
