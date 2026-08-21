import { describe, expect, it, vi } from "vitest";

import { NIRVANA_ATLAS_PROFILE } from "../../renderer2d/production/nirvana/NirvanaAssetProfile";
import {
  clampNirvanaV2Camera,
  createNirvanaV2AtlasAssets,
  renderNirvanaV2Scene,
  roadFrameIdFor,
  swaleFrameIdFor,
  type NirvanaV2Camera,
} from "./renderer";
import {
  NIRVANA_V2_DEFAULT_VIEWPORT,
  createNirvanaV2PilotScene,
} from "./scene";

interface RecordedContext {
  readonly canvas: HTMLCanvasElement;
  imageSmoothingEnabled: boolean;
  readonly clearRect: ReturnType<typeof vi.fn>;
  readonly drawImage: ReturnType<typeof vi.fn>;
  readonly save: ReturnType<typeof vi.fn>;
  readonly restore: ReturnType<typeof vi.fn>;
  readonly translate: ReturnType<typeof vi.fn>;
  readonly rotate: ReturnType<typeof vi.fn>;
}

function recordedContext(): RecordedContext {
  const canvas = document.createElement("canvas");
  canvas.width = NIRVANA_V2_DEFAULT_VIEWPORT.width;
  canvas.height = NIRVANA_V2_DEFAULT_VIEWPORT.height;
  return {
    canvas,
    imageSmoothingEnabled: true,
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
  };
}

function productionImage(image: "terrain" | "scenery"): CanvasImageSource {
  const atlasId = image === "terrain"
    ? NIRVANA_ATLAS_PROFILE.terrainAtlasId
    : NIRVANA_ATLAS_PROFILE.sceneryAtlasId;
  const descriptor = NIRVANA_ATLAS_PROFILE.descriptors.find(({ id }) => id === atlasId)!;
  return { width: descriptor.width, height: descriptor.height } as CanvasImageSource;
}

describe("Nirvana V2 atlas renderer", () => {
  it("draws a camera-sized view from atlas frames without a scene-sized source", () => {
    const scene = createNirvanaV2PilotScene();
    const context = recordedContext();
    const terrainImage = productionImage("terrain");
    const sceneryImage = productionImage("scenery");
    const assets = createNirvanaV2AtlasAssets(terrainImage, sceneryImage);
    const camera: NirvanaV2Camera = {
      x: 0,
      y: 0,
      width: NIRVANA_V2_DEFAULT_VIEWPORT.width,
      height: NIRVANA_V2_DEFAULT_VIEWPORT.height,
    };

    renderNirvanaV2Scene(
      context as unknown as CanvasRenderingContext2D,
      scene,
      assets,
      camera,
    );

    expect(context.clearRect).toHaveBeenCalledWith(
      0,
      0,
      NIRVANA_V2_DEFAULT_VIEWPORT.width,
      NIRVANA_V2_DEFAULT_VIEWPORT.height,
    );
    expect(context.imageSmoothingEnabled).toBe(false);
    expect(context.drawImage.mock.calls.length).toBeGreaterThan(100);
    expect(context.drawImage.mock.calls.some(([image]) => image === terrainImage)).toBe(true);
    expect(context.drawImage.mock.calls.some(([image]) => image === sceneryImage)).toBe(true);

    for (const call of context.drawImage.mock.calls) {
      expect(call).toHaveLength(9);
      const [, , , sourceWidth, sourceHeight] = call;
      expect(sourceWidth).toBeLessThan(scene.dimensions.widthPixels);
      expect(sourceHeight).toBeLessThan(scene.dimensions.heightPixels);
    }
  });

  // The pilot no longer carries its own manifest copy to drift (it binds the production
  // profile directly), so the fail-closed guard is asserted on the ART: an atlas image whose
  // geometry is not the production descriptor's must be refused, never silently painted.
  it("fails closed when an atlas image is not the production art", () => {
    const wrongTerrain = { width: 64, height: 64 } as CanvasImageSource;

    expect(() => createNirvanaV2AtlasAssets(wrongTerrain, productionImage("scenery")))
      .toThrow(/terrain.*geometry|geometry.*terrain/i);
    expect(() => createNirvanaV2AtlasAssets(productionImage("terrain"), wrongTerrain))
      .toThrow(/scenery.*geometry|geometry.*scenery/i);
  });

  it("extends boundary roads outward before selecting their atlas frames", () => {
    const scene = createNirvanaV2PilotScene();
    const roadAt = (column: number, row: number) => {
      const road = scene.roadCells.find(({ tile }) => tile.column === column && tile.row === row);
      expect(road).toBeDefined();
      return road!;
    };

    expect(roadFrameIdFor(roadAt(0, 14), scene.routeExits)).toBe("terrain.road.straight.ew");
    expect(roadFrameIdFor(roadAt(47, 16), scene.routeExits)).toBe("terrain.road.straight.ew");
    expect(roadFrameIdFor(roadAt(25, 31), scene.routeExits)).toBe("terrain.road.straight.ns");
    expect(roadFrameIdFor(roadAt(36, 13), scene.routeExits)).toBe("terrain.road.end.s");
  });

  it("clamps camera panning while preserving the fixed backing viewport", () => {
    const scene = createNirvanaV2PilotScene();
    const viewport = NIRVANA_V2_DEFAULT_VIEWPORT;

    expect(clampNirvanaV2Camera(scene, { x: -400, y: -200, ...viewport })).toEqual({
      x: 0,
      y: 0,
      ...viewport,
    });
    expect(clampNirvanaV2Camera(scene, { x: 10_000, y: 10_000, ...viewport })).toEqual({
      x: scene.dimensions.widthPixels - viewport.width,
      y: scene.dimensions.heightPixels - viewport.height,
      ...viewport,
    });
  });

  it("resolves every authored swale turn and ford to a published frame", () => {
    const scene = createNirvanaV2PilotScene();
    const published = new Set(Object.keys(NIRVANA_ATLAS_PROFILE.frames));
    const swale = scene.terrainCells.filter(({ kind }) => kind === "dry-swale" || kind === "ford");

    expect(swale.length).toBeGreaterThan(0);
    for (const cell of swale) {
      expect(published.has(swaleFrameIdFor(cell)), `${cell.tile.column},${cell.tile.row}`).toBe(true);
    }
    expect(new Set(swale.map(swaleFrameIdFor))).toEqual(new Set([
      "terrain.ford.ns",
      "terrain.swale.corner.ne",
      "terrain.swale.corner.sw",
      "terrain.swale.straight.ew",
    ]));
  });
});
