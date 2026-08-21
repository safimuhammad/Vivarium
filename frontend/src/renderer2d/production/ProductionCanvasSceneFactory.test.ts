import { describe, expect, it, vi } from "vitest";

import type { ObserverRendererPort } from "../../presentation/rendererPort";
import type { ProductionAssetLease } from "./assets/productionManifest";
import { PRODUCTION_ASSET_MANIFEST } from "./assets/productionManifest";
import { NIRVANA_ATLAS_PROFILE } from "./nirvana/NirvanaAssetProfile";
import { deriveHumanAppearance } from "./actors/appearance";
import { BEING_CHIBI_ATLAS_ID, beingChibiFrameRect, resolveBeingCharacter } from "./actors/beingChibiAtlas";
import { LayeredHumanActor } from "./actors/LayeredHumanActor";
import { SpriteSheetHumanActor } from "./actors/SpriteSheetHumanActor";
import {
  createCanvasPresentationRenderer,
  type CanvasPresentationRendererOptions,
} from "./CanvasPresentationRenderer";
import {
  createProductionCanvasSceneRenderer,
  PRODUCTION_SCENE_FACTORIES,
  type ProductionCanvasSceneRendererOptions,
} from "./ProductionCanvasSceneFactory";

vi.mock("./CanvasPresentationRenderer", () => ({
  createCanvasPresentationRenderer: vi.fn(),
}));

describe("ProductionCanvasSceneFactory", () => {
  it("reuses one frozen concrete factory identity across renderer generations", async () => {
    const renderer = {} as ObserverRendererPort;
    const createRenderer = vi.mocked(createCanvasPresentationRenderer);
    createRenderer.mockResolvedValue(renderer);
    const options = {
      canvas: document.createElement("canvas"),
      callbacks: {},
      placement: { snapshot: vi.fn() },
      recipes: new Map(),
    } as unknown as ProductionCanvasSceneRendererOptions;

    await createProductionCanvasSceneRenderer(options);
    await createProductionCanvasSceneRenderer(options);

    expect(createRenderer).toHaveBeenCalledTimes(2);
    const first = createRenderer.mock.calls[0]![0] as CanvasPresentationRendererOptions;
    const second = createRenderer.mock.calls[1]![0] as CanvasPresentationRendererOptions;
    expect(first.factories).toBe(second.factories);
    expect(Object.isFrozen(first.factories)).toBe(true);
    expect(Object.keys(first.factories).sort()).toEqual([
      "createActor",
      "createEnvironment",
      "createHome",
    ]);
    expect(first.manifest).toBe(second.manifest);
    expect(first.manifest).not.toBe(PRODUCTION_ASSET_MANIFEST);
    expect(first.manifest.atlases).toHaveProperty(NIRVANA_ATLAS_PROFILE.terrainAtlasId);
    expect(first.manifest.atlases).toHaveProperty(NIRVANA_ATLAS_PROFILE.sceneryAtlasId);
    expect(first.manifest.regions["worn-heartland"])
      .toBe(PRODUCTION_ASSET_MANIFEST.regions["worn-heartland"]);
    expect(first.resolveSceneCommands).toEqual(expect.any(Function));
    expect(second.resolveSceneCommands).toEqual(expect.any(Function));
    expect(first.staticSceneProviders).toBe(second.staticSceneProviders);
    expect(Object.isFrozen(first.staticSceneProviders)).toBe(true);
    expect(first.staticSceneProviders?.get("nirvana-v2")).toMatchObject({
      kind: "nirvana-v2",
      createPreparation: expect.any(Function),
    });
  });

  it("constructs a SpriteSheetHumanActor (not the rejected LayeredHumanActor) and disposes its lease", () => {
    const chibiLease: ProductionAssetLease = { value: {} as ImageBitmap, release: vi.fn() };
    const atlasLeases = new Map<string, ProductionAssetLease>([[BEING_CHIBI_ATLAS_ID, chibiLease]]);

    const actor = PRODUCTION_SCENE_FACTORIES.createActor({
      record: { completeness: "exact", value: { id: "aster", name: "Aster", persona: "a wanderer" } },
      position: { x: 10, y: 20 },
      facing: "south",
      manifest: PRODUCTION_ASSET_MANIFEST,
      atlasLeases,
      reducedMotion: false,
    });

    expect(actor).toBeInstanceOf(SpriteSheetHumanActor);
    expect(actor).not.toBeInstanceOf(LayeredHumanActor);
    actor.dispose();
    expect(chibiLease.release).toHaveBeenCalledOnce();
  });

  it("falls back to the actor id when name is blank", () => {
    const actor = PRODUCTION_SCENE_FACTORIES.createActor({
      record: { completeness: "exact", value: { id: "birch", name: "" } },
      position: { x: 0, y: 0 },
      facing: "north",
      manifest: PRODUCTION_ASSET_MANIFEST,
      atlasLeases: new Map(),
      reducedMotion: false,
    });
    expect(actor.snapshot().id).toBe("birch");
    actor.dispose();
  });

  it("throws when the actor id is unavailable", () => {
    expect(() =>
      PRODUCTION_SCENE_FACTORIES.createActor({
        record: { completeness: "exact", value: { id: undefined, name: "Nameless" } },
        position: { x: 0, y: 0 },
        facing: "north",
        manifest: PRODUCTION_ASSET_MANIFEST,
        atlasLeases: new Map(),
        reducedMotion: false,
      }),
    ).toThrow("Actor id is unavailable.");
  });

  it("draws the being from its deterministically resolved roster character, not the m1 default", () => {
    // A minimal recording 2D context, following SpriteSheetHumanActor.test.ts's own pattern.
    let sourceX = 0;
    let sourceY = 0;
    const context = {
      imageSmoothingEnabled: true,
      globalCompositeOperation: "source-over" as GlobalCompositeOperation,
      globalAlpha: 1,
      save: (): void => undefined,
      restore: (): void => undefined,
      translate: (): void => undefined,
      scale: (): void => undefined,
      rotate: (): void => undefined,
      drawImage: (_image: CanvasImageSource, ...values: number[]): void => {
        sourceX = values[0]!;
        sourceY = values[1]!;
      },
      fillRect: (): void => undefined,
    } as unknown as CanvasRenderingContext2D;

    const chibiLease: ProductionAssetLease = { value: {} as ImageBitmap, release: vi.fn() };
    const atlasLeases = new Map<string, ProductionAssetLease>([[BEING_CHIBI_ATLAS_ID, chibiLease]]);
    const id = "aster_factory_roster";

    const actor = PRODUCTION_SCENE_FACTORIES.createActor({
      record: { completeness: "exact", value: { id, name: "Aster" } },
      position: { x: 10, y: 20 },
      facing: "east",
      manifest: PRODUCTION_ASSET_MANIFEST,
      atlasLeases,
      reducedMotion: false,
    });
    actor.draw(context);

    const expectedCharacter = resolveBeingCharacter(deriveHumanAppearance(id));
    const expectedRect = beingChibiFrameRect("walk-side-1", expectedCharacter);
    expect(sourceX).toBe(expectedRect.x);
    expect(sourceY).toBe(expectedRect.y);
    actor.dispose();
  });
});
