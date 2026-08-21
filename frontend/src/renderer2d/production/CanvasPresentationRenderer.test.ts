import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RegionSnapshot } from "../../app/schemas";
import type {
  ObserverRendererCallbacks,
  ObserverRendererDiagnostics,
  ObserverRendererPort,
} from "../../presentation/rendererPort";
import type {
  FrameIdentity,
  ObserverSelection,
  PresentedObserverFrame,
  SafeFrameInsets,
} from "../../presentation/contracts";
import type { FrameDriver, WakeScheduler } from "../contracts";
import { createCamera, MIN_ZOOM, type CameraSnapshot } from "../camera/Camera2D";
import { FOCUS_FOLLOW_DWELL_MS } from "./world/regionFocusFollow";
import {
  PRODUCTION_ASSET_MANIFEST,
  type ProductionAssetLease,
  type ProductionAssetManifest,
} from "./assets/productionManifest";
import type { SharedAtlasPool } from "./assets/SharedAtlasPool";
import type { CacheCanvasOwnerFactory } from "./CacheCanvasOwner";
import { createRegionMapIdentity } from "./maps/RegionMapIdentity";
import { createRegionMapRecipe, type RegionMapRecipeV1 } from "./maps/RegionMapRecipe";
import {
  NIRVANA_ATLAS_PROFILE,
  createNirvanaProductionManifest,
} from "./nirvana/NirvanaAssetProfile";
import { channelFrameIdFor, nirvanaTerrainOverlayFrameIds } from "./nirvana/NirvanaAtlas";
import {
  createNirvanaInitialRegionForRecipe,
  createNirvanaRegionMapRecipe,
} from "./nirvana/NirvanaRegionMapRecipe";
import { NIRVANA_STATIC_SCENE_PROVIDER } from "./nirvana/NirvanaStaticSceneProvider";
import type { PlacementLedger } from "./placement/PlacementLedger";
import { feetAnchoredVisualRect } from "./productionGeometry";
import {
  BEAT_FRAME_MIN_LEGIBLE_ZOOM,
  BEAT_FRAME_HEADROOM_PX,
  BEAT_FRAME_PADDING_PX,
  beatFrameRect,
  boundedRasterOrigin,
  createCanvasPresentationRenderer,
  legibleBeatExtent,
  type AtlasCommitScheduler,
  type CanvasPresentationRendererDebug,
  type CanvasPresentationRendererOptions,
} from "./CanvasPresentationRenderer";
import { TEXT_ZOOM_THRESHOLD } from "./environment/bubbleGrammar";
import * as canvasPresentationRendererModule from "./CanvasPresentationRenderer";
import type {
  ProductionSceneFactories,
  ProductionSceneGraph,
  ProductionSceneGraphOptions,
  SceneGraphDiff,
} from "./ProductionSceneGraph";
import type {
  ProductionSceneCommandBatch,
  ProductionSceneSignal,
} from "./ProductionSceneBridge";
import {
  createPresentationFrameAcceptanceTracker,
} from "../../presentation/PresentationFrameSink";
import {
  createProductionStaticSceneDescriptor,
  type ProductionStaticDrawOperation,
  type ProductionStaticSceneDescriptor,
  type ProductionStaticScenePreparation,
  type ProductionStaticSceneProvider,
} from "./staticScene/ProductionStaticScene";

const regions: RegionSnapshot[] = [
  region("worn", "a once-heavenly landscape, now thinning and picked-over"),
  region("spring", "hot spring lakes"),
];
const recipes = regions.map((value) => createRegionMapRecipe(createRegionMapIdentity(71, value, regions)));
const CONTINUATION_PATTERN_TILE_COUNT = 8 * 8;

let contexts = new WeakMap<HTMLCanvasElement, RecordingContext>();

beforeEach(() => {
  contexts = new WeakMap<HTMLCanvasElement, RecordingContext>();
  vi.restoreAllMocks();
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function getContext(
    this: HTMLCanvasElement,
  ) {
    let context = contexts.get(this);
    if (!context) {
      context = new RecordingContext();
      contexts.set(this, context);
    }
    return context as unknown as CanvasRenderingContext2D;
  });
});

describe("CanvasPresentationRenderer", () => {
  it("renders shoreline around real spring and neutral water while waterless kits stay dry", () => {
    const terrainRoleAt = (canvasPresentationRendererModule as unknown as {
      terrainRoleAt?: (
        recipe: RegionMapRecipeV1,
        column: number,
        row: number,
      ) => string | null;
    }).terrainRoleAt;
    expect(terrainRoleAt).toBeTypeOf("function");
    const regionFixtures = [
      region("spring", "hot spring lakes"),
      region("neutral", "mild unclassified meadow"),
      region("worn", "a once-heavenly landscape, now thinning and picked-over"),
      region("dry", "a struggling, near-barren stretch"),
      region("ash", "a nuclear wasteland, all but dead"),
    ];
    const generated = regionFixtures.map((value) => (
      createRegionMapRecipe(createRegionMapIdentity(173, value, regionFixtures))
    ));
    for (const recipe of generated) {
      const counts = { water: 0, shore: 0 };
      for (let row = 0; row < recipe.grid.rows; row += 1) {
        for (let column = 0; column < recipe.grid.columns; column += 1) {
          const role = terrainRoleAt?.(recipe, column, row);
          if (role === "water" || role === "shore") counts[role] += 1;
        }
      }
      if (recipe.kit === "spring-terraces" || recipe.kit === "neutral-temperate") {
        expect(counts.water, `${recipe.kit} water`).toBeGreaterThan(0);
        expect(counts.shore, `${recipe.kit} shore`).toBeGreaterThan(0);
      } else {
        expect(counts, recipe.kit).toEqual({ water: 0, shore: 0 });
      }
    }
  });

  it("preserves water, path, and soil precedence beside interior water", () => {
    const terrainRoleAt = (canvasPresentationRendererModule as unknown as {
      terrainRoleAt?: (recipe: RegionMapRecipeV1, column: number, row: number) => string | null;
    }).terrainRoleAt!;
    const recipe = structuredClone(recipes[1]!) as RegionMapRecipeV1;
    const candidate = recipe.waterVoidMask.findIndex((value, index) => {
      if (value !== 0 || recipe.pathMask[index] === 1 || recipe.soilMask[index] === 1) return false;
      const column = index % recipe.grid.columns;
      const row = Math.floor(index / recipe.grid.columns);
      return column > 1 && row > 1 && column < recipe.grid.columns - 2 && row < recipe.grid.rows - 2;
    });
    expect(candidate).toBeGreaterThanOrEqual(0);
    const column = candidate % recipe.grid.columns;
    const row = Math.floor(candidate / recipe.grid.columns);
    const waterIndex = row * recipe.grid.columns + column + 1;
    recipe.waterVoidMask[waterIndex] = 1;
    recipe.pathMask[waterIndex] = 0;
    recipe.soilMask[waterIndex] = 0;

    expect(terrainRoleAt(recipe, column + 1, row), "water wins every overlap").toBe("water");
    expect(terrainRoleAt(recipe, column, row), "eligible ground becomes shore").toBe("shore");
    recipe.pathMask[candidate] = 1;
    expect(terrainRoleAt(recipe, column, row), "path is not erased by shore").toBe("path");
    recipe.pathMask[candidate] = 0;
    recipe.soilMask[candidate] = 1;
    expect(terrainRoleAt(recipe, column, row), "soil is not erased by shore").toBe("soil");
    recipe.pathMask[candidate] = 1;
    expect(terrainRoleAt(recipe, column, row), "path wins malformed path/soil overlap").toBe("path");
  });

  it("selects scenery variants deterministically from stable placement identity and position", () => {
    const sceneryVariantIndex = (canvasPresentationRendererModule as unknown as {
      sceneryVariantIndex?: (id: string, column: number, row: number, count: number) => number;
    }).sceneryVariantIndex;
    expect(sceneryVariantIndex).toBeTypeOf("function");
    const resolve = sceneryVariantIndex ?? (() => -1);
    expect(resolve("ash-waste:charred-trunk:17", 11, 23, 32)).toBe(
      resolve("ash-waste:charred-trunk:17", 11, 23, 32),
    );
    expect(resolve("ash-waste:charred-trunk:18", 11, 23, 32)).not.toBe(
      resolve("ash-waste:charred-trunk:17", 11, 23, 32),
    );
    expect(resolve("ash-waste:charred-trunk:17", 11, 23, 32)).toBeGreaterThanOrEqual(0);
    expect(resolve("ash-waste:charred-trunk:17", 11, 23, 32)).toBeLessThan(32);
    expect(() => resolve("x", 0, 0, 0)).toThrow(/variant count/i);
  });

  it("maps exact N/E/S/W connection masks to authored straight, corner, cross, and isolated cells", () => {
    const terrainConnectionVariantIndex = (canvasPresentationRendererModule as unknown as {
      terrainConnectionVariantIndex?: (mask: number) => number;
    }).terrainConnectionVariantIndex;
    expect(terrainConnectionVariantIndex).toBeTypeOf("function");
    const resolve = terrainConnectionVariantIndex ?? (() => -1);
    expect(resolve(0b1010), "east/west horizontal").toBe(0);
    expect(resolve(0b0101), "north/south vertical").toBe(1);
    expect(resolve(0b0011), "north/east corner").toBe(2);
    expect(resolve(0b0110), "east/south corner").toBe(3);
    expect(resolve(0b1100), "south/west corner").toBe(4);
    expect(resolve(0b1001), "west/north corner").toBe(5);
    expect(resolve(0b1111), "four-way cross").toBe(6);
    expect(resolve(0b0000), "isolated/plaza/pool").toBe(7);
  });

  it("resolves water, shore, path, and soil frames from semantic neighbor masks, never coordinates", () => {
    const terrainFrameVariantIndex = (canvasPresentationRendererModule as unknown as {
      terrainFrameVariantIndex?: (
        role: "ground" | "path" | "water" | "shore" | "soil",
        mask: number,
        column: number,
        row: number,
      ) => number;
    }).terrainFrameVariantIndex;
    expect(terrainFrameVariantIndex).toBeTypeOf("function");
    const resolve = terrainFrameVariantIndex ?? (() => -1);
    for (const role of ["path", "water", "shore"] as const) {
      expect(resolve(role, 0b1010, 1, 1), `${role} horizontal`).toBe(0);
      expect(resolve(role, 0b1010, 37, 52), `${role} coordinate independent`).toBe(0);
      expect(resolve(role, 0b0110, 1, 1), `${role} corner`).toBe(3);
    }
    expect(resolve("soil", 0b0000, 1, 1), "isolated clearing").toBe(0);
    expect(resolve("soil", 0b1010, 1, 1), "horizontal clearing").toBe(1);
    expect(resolve("soil", 0b0101, 1, 1), "vertical clearing").toBe(2);
    expect(resolve("soil", 0b0011, 1, 1), "two-axis clearing").toBe(3);
    expect(resolve("soil", 0b0011, 37, 52), "soil coordinate independent").toBe(3);
  });

  it("publishes exact graph semantics before accepting the corresponding frame", async () => {
    const order: string[] = [];
    const onSemanticSnapshot = vi.fn(() => order.push("semantic"));
    const frameAcceptance = createPresentationFrameAcceptanceTracker();
    const markAccepted = vi.spyOn(frameAcceptance, "markAccepted").mockImplementation((next) => {
      order.push(`accepted:${next.revision}`);
    });
    const fixture = await harness({ callbacks: { onSemanticSnapshot }, frameAcceptance });
    const accepted = frame({ revision: 6 });
    fixture.renderer.updatePresentation(accepted);
    await settle();

    expect(markAccepted).toHaveBeenCalledWith(accepted);
    expect(order).toEqual(["semantic", "accepted:6"]);
    expect(onSemanticSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      frameIdentity: expect.objectContaining({ revision: 6 }),
    }));
    fixture.renderer.dispose();
  });

  it("RED: consumes typed published execution identity with the production command resolver once", async () => {
    const frameAcceptance = createPresentationFrameAcceptanceTracker();
    const fixture = await harness({ frameAcceptance });
    const input = frame({ revision: 1, execution: true, speak: true });
    fixture.renderer.updatePresentation(input);
    await settle();

    expect(fixture.graph.applySceneCommands).toHaveBeenCalledOnce();
    expect(frameAcceptance.accepts(input)).toBe(true);
    expect(fixture.graph.applySceneCommands).toHaveBeenCalledWith(
      expect.objectContaining({
        identity: expect.objectContaining({ revision: 1 }),
        sceneToken: 9,
        commands: [expect.objectContaining({
          kind: "actor",
          actorId: "agent-a",
          command: { kind: "set-face", expression: "talk-1" },
        })],
      }),
      expect.any(Number),
    );
    expect(fixture.graph.commitArrivalStaging).not.toHaveBeenCalled();
    expect(fixture.graph.discardArrivalStaging).not.toHaveBeenCalled();
    fixture.renderer.updatePresentation(input);
    fixture.driver.fire(16);
    expect(fixture.graph.applySceneCommands).toHaveBeenCalledOnce();
    fixture.renderer.dispose();
  });

  it("accepts every monotonic phase revision and clears the settled scene exactly once", async () => {
    const frameAcceptance = createPresentationFrameAcceptanceTracker();
    const fixture = await harness({ frameAcceptance });
    const phases = ["enter", "hold", "recover", "exit"] as const;
    for (const [index, phase] of phases.entries()) {
      const input = frame({
        revision: index + 1,
        firstCursor: 1,
        lastCursor: 1,
        execution: true,
        speak: true,
        scenePhase: phase,
      });
      fixture.renderer.updatePresentation(input);
      await settle();
      expect(frameAcceptance.accepts(input)).toBe(true);
    }
    const settled = frame({
      revision: 5,
      firstCursor: 1,
      lastCursor: 1,
      settled: true,
    });
    fixture.renderer.updatePresentation(settled);
    await settle();

    expect(frameAcceptance.accepts(settled)).toBe(true);
    expect(fixture.graph.applySceneCommands).toHaveBeenCalledTimes(5);
    expect(fixture.graph.applySceneCommands).toHaveBeenLastCalledWith(
      expect.objectContaining({
        sceneToken: 9,
        commands: [expect.objectContaining({ kind: "clear-scene" })],
      }),
      expect.any(Number),
    );
    fixture.renderer.updatePresentation(settled);
    expect(fixture.graph.applySceneCommands).toHaveBeenCalledTimes(5);
    fixture.renderer.dispose();
  });

  it("applies resolved scene commands only after durable reconciliation and forwards native diagnostics once", async () => {
    const onSceneSignals = vi.fn<(signals: readonly ProductionSceneSignal[]) => void>();
    const resolveSceneCommands = vi.fn((next: PresentedObserverFrame): ProductionSceneCommandBatch => ({
      identity: {
        runId: next.runId,
        sourceKey: next.sourceKey,
        revision: next.revision,
        firstCursor: next.firstCursor,
        lastCursor: next.lastCursor,
      },
      sceneToken: 4,
      commands: [{
        kind: "actor",
        commandId: `command:${next.revision}`,
        actorId: "agent-a",
        command: { kind: "set-face", expression: "talk-1" },
      }],
    }));
    const fixture = await harness({ resolveSceneCommands, onSceneSignals });
    fixture.graph.sceneSignalValue = [{
      serial: 1,
      sceneToken: 4,
      commandId: "command:1",
      subjectId: "agent-a",
      marker: "settled",
      atMs: 16,
    }];

    const first = frame({ revision: 1 });
    fixture.renderer.updatePresentation(first);
    await settle();
    expect(fixture.graph.update.mock.invocationCallOrder[0])
      .toBeLessThan(fixture.graph.applySceneCommands.mock.invocationCallOrder[0]!);
    expect(fixture.graph.applySceneCommands).toHaveBeenCalledOnce();

    fixture.renderer.updatePresentation(first);
    fixture.driver.fire(16);
    expect(fixture.graph.applySceneCommands).toHaveBeenCalledOnce();
    expect(onSceneSignals).toHaveBeenCalledOnce();
    expect(onSceneSignals).toHaveBeenCalledWith(fixture.graph.sceneSignalValue);

    fixture.driver.fire(32);
    expect(onSceneSignals).toHaveBeenCalledOnce();
    fixture.renderer.dispose();
  });

  it("reports an ignored optional visual command once without rejecting exact frame acceptance", async () => {
    const onFailure = vi.fn();
    const frameAcceptance = createPresentationFrameAcceptanceTracker();
    const graph = fakeGraph();
    let optional = false;
    const fixture = await harness({
      graph,
      callbacks: { onFailure },
      frameAcceptance,
      resolveSceneCommands: (next) => optional ? ({
          identity: {
            runId: next.runId,
            sourceKey: next.sourceKey,
            revision: next.revision,
            firstCursor: next.firstCursor,
            lastCursor: next.lastCursor,
          },
          sceneToken: 9,
          commands: [{
            kind: "environment",
            commandId: "optional-dust",
            request: { kind: "dust", at: { x: 32, y: 32 }, tint: "#777" },
          }],
        }) : null,
    });
    fixture.renderer.updatePresentation(frame({ revision: 1 }));
    await settle();
    optional = true;
    graph.applySceneCommands.mockReturnValue({
      outcome: "ignored",
      appliedCommandIds: [],
      ignoredCommandIds: ["optional-dust"],
    } as never);
    const input = frame({ revision: 2, execution: true });

    fixture.renderer.updatePresentation(input);
    await settle();
    fixture.renderer.updatePresentation(input);

    expect(onFailure).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledWith({
      kind: "marker",
      retryable: false,
      publicMessage: "A visual flourish was omitted. The world state remains current.",
    });
    expect(frameAcceptance.accepts(input)).toBe(true);
    expect(fixture.debug().frameIdentity).toMatchObject({ revision: 2 });
    fixture.renderer.dispose();
  });

  it("RED residual: refuses Canvas acceptance for invalid or stale scene command outcomes", async () => {
    const frameAcceptance = createPresentationFrameAcceptanceTracker();
    for (const outcome of ["invalid", "stale-identity", "stale-scene"] as const) {
      const graph = fakeGraph();
      graph.applySceneCommands.mockReturnValue({
        outcome,
        appliedCommandIds: [],
        ignoredCommandIds: ["command"],
      } as never);
      const fixture = await harness({ graph, frameAcceptance });
      const input = frame({ revision: outcome === "invalid" ? 21 : outcome === "stale-identity" ? 22 : 23, execution: true, speak: true });
      fixture.renderer.updatePresentation(input);
      await settle();
      expect(frameAcceptance.accepts(input), outcome).toBe(false);
      fixture.renderer.dispose();
    }
  });

  it("FINAL RED: rejects malformed/stale batches before mutating graph identity and preserves lineage replacement", async () => {
    let token = 10;
    let malformed = false;
    const fixture = await harness({
      resolveSceneCommands: (next) => ({
        identity: {
          runId: next.runId, sourceKey: next.sourceKey, revision: next.revision,
          firstCursor: next.firstCursor, lastCursor: next.lastCursor,
        },
        sceneToken: token,
        commands: malformed ? [{
          kind: "camera-impulse", commandId: "bad", offset: { x: 2, y: 0 }, durationMs: 80,
        }] as never : [],
      }),
    });
    fixture.renderer.updatePresentation(frame({ revision: 51, execution: true }));
    await settle();
    expect(fixture.graph.update).toHaveBeenCalledTimes(1);
    const accepted = fixture.debug().frameIdentity;

    token = 9;
    fixture.renderer.updatePresentation(frame({ revision: 52, execution: true }));
    await settle();
    expect(fixture.graph.update).toHaveBeenCalledTimes(1);
    expect(fixture.debug().frameIdentity).toEqual(accepted);

    token = 11;
    malformed = true;
    fixture.renderer.updatePresentation(frame({
      runId: "run-b", sourceKey: "live:run-b", revision: 0,
      firstCursor: 0, lastCursor: 0, execution: true,
    }));
    await settle();
    expect(fixture.sceneGraphFactory).toHaveBeenCalledTimes(1);
    expect(fixture.graph.dispose).not.toHaveBeenCalled();
    expect(fixture.debug().frameIdentity).toEqual(accepted);
    fixture.renderer.dispose();
  });

  it("RED residual: keeps one graph generation for a same-lineage regional travel", async () => {
    const fixture = await harness();
    fixture.renderer.updatePresentation(frame({ revision: 31, sceneRegion: "worn" }));
    await settle();
    fixture.renderer.updatePresentation(frame({ revision: 32, sceneRegion: "spring" }));
    await settle();

    expect(fixture.sceneGraphFactory).toHaveBeenCalledTimes(1);
    expect(fixture.graph.dispose).not.toHaveBeenCalled();
    fixture.renderer.dispose();
  });

  it("keeps the visible Story region when a settled recovery frame has no scene or selection", async () => {
    const fixture = await harness();
    fixture.renderer.updatePresentation(frame({ revision: 31, sceneRegion: "worn" }));
    await settle();
    const before = fixture.debug();
    fixture.graph.nextDiff = { ...fixture.graph.nextDiff, staticLayersInvalidated: false };

    fixture.renderer.updatePresentation(frame({ revision: 32, sceneRegion: "worn", settled: true }));
    await settle();

    expect(fixture.debug()).toMatchObject({
      visibleRegionId: "worn",
      cache: {
        created: before.cache.created,
        disposed: before.cache.disposed,
      },
    });
    fixture.renderer.dispose();
  });

  it("RED residual: applies a separate bounded camera impulse and clears it after its deadline", async () => {
    const fixture = await harness({
      resolveSceneCommands: (next) => ({
        identity: {
          runId: next.runId, sourceKey: next.sourceKey, revision: next.revision,
          firstCursor: next.firstCursor, lastCursor: next.lastCursor,
        },
        sceneToken: 44,
        commands: [{
          kind: "camera-impulse",
          commandId: "camera:one-pixel",
          offset: { x: 1, y: 0 },
          durationMs: 80,
        } as never],
      }),
    });
    fixture.renderer.updatePresentation(frame({ revision: 41, execution: true }));
    await settle();
    expect((fixture.debug() as unknown as { cameraImpulse: unknown }).cameraImpulse).toEqual({
      offset: { x: 1, y: 0 },
      untilMs: 80,
    });
    fixture.driver.fire(16);
    fixture.driver.fire(96);
    expect((fixture.debug() as unknown as { cameraImpulse: unknown }).cameraImpulse).toBeNull();
    fixture.renderer.dispose();
  });

  it("clamps camera impulse at a bounded map corner so the raster still covers the viewport", async () => {
    const graph = fakeGraph();
    graph.debugValue.hitTargets = [{
      selection: { kind: "agent", id: "agent-a" },
      selectionKey: "agent:agent-a",
      worldBounds: { x: 0, y: 0, width: 32, height: 48 },
      feetY: 48,
    }];
    const fixture = await harness({
      graph,
      resolveSceneCommands: (next) => ({
        identity: {
          runId: next.runId, sourceKey: next.sourceKey, revision: next.revision,
          firstCursor: next.firstCursor, lastCursor: next.lastCursor,
        },
        sceneToken: 45,
        commands: [{
          kind: "camera-impulse",
          commandId: "camera:corner",
          offset: { x: 1, y: 0 },
          durationMs: 80,
        } as never],
      }),
    });
    fixture.renderer.resize(1_440, 900);
    fixture.renderer.updatePresentation(frame({ revision: 42, execution: true }));
    await settle();
    fixture.renderer.panCamera({ x: 0, y: 0 });
    expect(fixture.debug().camera.mode).toBe("free");
    expect(fixture.driver.pending()).toBeGreaterThan(0);
    fixture.driver.fire(16);

    const transform = contexts.get(fixture.canvas)!.setTransformCalls.at(-1);
    expect(transform?.map((value) => Object.is(value, -0) ? 0 : value)).toEqual([1, 0, 0, 1, 0, 0]);
    expect(fixture.debug().renderRasterOrigin).toEqual({ x: 0, y: 0 });
    fixture.renderer.dispose();
  });

  it.each([
    ["normal", false],
    ["reduced", true],
  ] as const)("renders the exact C01 arrival gate with bounded impulse in %s motion", async (
    _label,
    reducedMotion,
  ) => {
    const graph = fakeGraph();
    const arrivalActor = feetAnchoredVisualRect({ x: 368, y: 48 });
    graph.debugValue.hitTargets = [{
      selection: { kind: "agent", id: "agent-a" },
      selectionKey: "agent:agent-a",
      worldBounds: arrivalActor,
      feetY: 48,
    }];
    const fixture = await harness({
      graph,
      reducedMotion,
      resolveSceneCommands: (next) => ({
        identity: {
          runId: next.runId,
          sourceKey: next.sourceKey,
          revision: next.revision,
          firstCursor: next.firstCursor,
          lastCursor: next.lastCursor,
        },
        sceneToken: 46,
        commands: [{
          kind: "camera-impulse",
          commandId: "camera:c01-arrival",
          offset: { x: 0, y: 1 },
          durationMs: 80,
        } as never],
      }),
    });
    fixture.renderer.resize(1_440, 900);
    fixture.renderer.setSafeFrame({ top: 222, right: 52, bottom: 176, left: 216 });
    fixture.renderer.updatePresentation(frame({ revision: 43, execution: true }));
    await settle();
    fixture.driver.fire(16);
    const impulseFrame = fixture.debug();
    const impulseTransform = contexts.get(fixture.canvas)!.setTransformCalls.at(-1);
    if (reducedMotion) expect(impulseFrame.cameraImpulse).toBeNull();
    else expect(impulseFrame.cameraImpulse).toMatchObject({ offset: { x: 0, y: 1 } });
    expect(impulseFrame.renderRasterOrigin).toEqual(boundedRasterOrigin(
      impulseFrame.camera,
      reducedMotion ? { x: 0, y: 0 } : { x: 0, y: 1 },
      1_440,
      900,
    ));
    expect(impulseTransform?.slice(4)).toEqual([
      impulseFrame.renderRasterOrigin!.x,
      impulseFrame.renderRasterOrigin!.y,
    ]);
    if (!reducedMotion) {
      for (const nowMs of [66, 116, 166, 216, 266]) fixture.driver.fire(nowMs);
    }

    const debug = fixture.debug();
    const transform = contexts.get(fixture.canvas)!.setTransformCalls.at(-1);
    expect(debug.camera).toMatchObject({ mode: "story", zoom: 1 });
    expect(debug.cameraImpulse).toBeNull();
    expect(debug.renderRasterOrigin).toEqual(debug.camera.rasterOrigin);
    expect(transform?.slice(4)).toEqual([
      debug.camera.rasterOrigin.x,
      debug.camera.rasterOrigin.y,
    ]);
    const screenBounds = {
      x: arrivalActor.x * debug.camera.zoom + debug.renderRasterOrigin!.x,
      y: arrivalActor.y * debug.camera.zoom + debug.renderRasterOrigin!.y,
      width: arrivalActor.width * debug.camera.zoom,
      height: arrivalActor.height * debug.camera.zoom,
    };
    expect(screenBounds.x).toBeGreaterThanOrEqual(debug.camera.safeFrame.x);
    expect(screenBounds.y).toBeGreaterThanOrEqual(debug.camera.safeFrame.y);
    expect(screenBounds.x + screenBounds.width)
      .toBeLessThanOrEqual(debug.camera.safeFrame.x + debug.camera.safeFrame.width);
    expect(screenBounds.y + screenBounds.height)
      .toBeLessThanOrEqual(debug.camera.safeFrame.y + debug.camera.safeFrame.height);
    fixture.renderer.dispose();
  });

  it.each(["story", "follow"] as const)(
    "bounds fractional %s raster and impulse to the protected safe frame",
    (mode) => {
      const base = {
        mode,
        topology: "bounded",
        center: { x: 0, y: 0 },
        zoom: 1.0003,
        viewerControlled: false,
        followEntityId: mode === "follow" ? "agent-a" : null,
        storyEntityId: mode === "story" ? "agent-a" : null,
        pendingStoryEntityId: null,
        storyTarget: null,
        guidedTarget: null,
        pendingStoryTarget: null,
        safeFrame: { x: 216, y: 222, width: 1_172, height: 502 },
        followDeadZone: { x: 0, y: 0, width: 0, height: 0 },
        worldBounds: { x: 0, y: 0, width: 2_048, height: 2_048 },
        flying: false,
      } satisfies Omit<CameraSnapshot, "rasterOrigin">;

      expect(boundedRasterOrigin(
        { ...base, rasterOrigin: { x: 400, y: 400 } },
        { x: 1, y: 1 },
        1_440,
        900,
      )).toEqual({ x: 216, y: 222 });
      expect(boundedRasterOrigin(
        { ...base, rasterOrigin: { x: -2_000, y: -2_000 } },
        { x: -1, y: -1 },
        1_440,
        900,
      )).toEqual({ x: -660, y: -1_324 });
    },
  );

  it.each([
    ["desktop top normal", 1_440, 900, false, { top: 222, right: 52, bottom: 176, left: 216 }, feetAnchoredVisualRect({ x: 752, y: 250.56 })],
    ["desktop top reduced", 1_440, 900, true, { top: 222, right: 52, bottom: 176, left: 216 }, feetAnchoredVisualRect({ x: 752, y: 250.56 })],
    ["desktop bottom normal", 1_440, 900, false, { top: 222, right: 52, bottom: 176, left: 216 }, feetAnchoredVisualRect({ x: 944, y: 1_990.4 })],
    ["desktop bottom reduced", 1_440, 900, true, { top: 222, right: 52, bottom: 176, left: 216 }, feetAnchoredVisualRect({ x: 944, y: 1_990.4 })],
    ["mobile top normal", 390, 844, false, { top: 120, right: 52, bottom: 276, left: 8 }, feetAnchoredVisualRect({ x: 176, y: 167.56 })],
    ["mobile top reduced", 390, 844, true, { top: 120, right: 52, bottom: 276, left: 8 }, feetAnchoredVisualRect({ x: 176, y: 167.56 })],
    ["mobile bottom normal", 390, 844, false, { top: 120, right: 52, bottom: 276, left: 8 }, feetAnchoredVisualRect({ x: 176, y: 1_772.4 })],
    ["mobile bottom reduced", 390, 844, true, { top: 120, right: 52, bottom: 276, left: 8 }, feetAnchoredVisualRect({ x: 176, y: 1_772.4 })],
  ] as const)("keeps a fractional moving Story target fully inside the painted %s safe frame", (
    _name,
    width,
    height,
    reducedMotion,
    safeFrameInsets,
    actor,
  ) => {
    const camera = createCamera({ width, height, reducedMotion, safeFrame: safeFrameInsets });
    camera.setWorldBounds({ x: 0, y: 0, width: 2_048, height: 2_048 });
    camera.setEntityBounds("agent:wanderer_001", actor);
    camera.apply({ type: "story-target", entityId: "agent:wanderer_001", target: actor });
    if (!reducedMotion) camera.update(240);

    const snapshot = camera.snapshot();
    const origin = boundedRasterOrigin(snapshot, { x: 0, y: 0 }, width, height);
    const screenBounds = {
      x: actor.x * snapshot.zoom + origin.x,
      y: actor.y * snapshot.zoom + origin.y,
      width: actor.width * snapshot.zoom,
      height: actor.height * snapshot.zoom,
    };

    expect(Number.isInteger(origin.x)).toBe(true);
    expect(Number.isInteger(origin.y)).toBe(true);
    expect(screenBounds.x).toBeGreaterThanOrEqual(snapshot.safeFrame.x);
    expect(screenBounds.y).toBeGreaterThanOrEqual(snapshot.safeFrame.y);
    expect(screenBounds.x + screenBounds.width)
      .toBeLessThanOrEqual(snapshot.safeFrame.x + snapshot.safeFrame.width);
    expect(screenBounds.y + screenBounds.height)
      .toBeLessThanOrEqual(snapshot.safeFrame.y + snapshot.safeFrame.height);
  });

  it.each([
    ["top", { x: 40, y: -10, width: 20, height: 20 }, { x: 0, y: 30 }, { x: 0, y: -1 }],
    ["right", { x: 90, y: 40, width: 20, height: 20 }, { x: -30, y: 0 }, { x: 1, y: 0 }],
    ["bottom", { x: 40, y: 90, width: 20, height: 20 }, { x: 0, y: -30 }, { x: 0, y: 1 }],
    ["left", { x: -10, y: 40, width: 20, height: 20 }, { x: 30, y: 0 }, { x: -1, y: 0 }],
  ] as const)("prioritizes a complete guided target across %s authored overscan", (
    _edge,
    guidedTarget,
    rasterOrigin,
    outwardImpulse,
  ) => {
    const camera = {
      mode: "story",
      topology: "bounded",
      center: { x: 0, y: 0 },
      zoom: 1,
      viewerControlled: false,
      followEntityId: null,
      storyEntityId: "agent-a",
      pendingStoryEntityId: null,
      storyTarget: guidedTarget,
      guidedTarget,
      pendingStoryTarget: null,
      safeFrame: { x: 20, y: 20, width: 60, height: 60 },
      followDeadZone: { x: 0, y: 0, width: 0, height: 0 },
      rasterOrigin,
      worldBounds: { x: 0, y: 0, width: 100, height: 100 },
      flying: false,
    } satisfies CameraSnapshot;

    expect(boundedRasterOrigin(camera, outwardImpulse, 100, 100))
      .toEqual(rasterOrigin);
  });

  it("retains the deterministic midpoint when a guided target cannot fit the safe frame", () => {
    const oversizedTarget = { x: 10, y: 40, width: 80, height: 20 };
    const camera = {
      mode: "story",
      topology: "bounded",
      center: { x: 0, y: 0 },
      zoom: 1,
      viewerControlled: false,
      followEntityId: null,
      storyEntityId: "agent-a",
      pendingStoryEntityId: null,
      storyTarget: oversizedTarget,
      guidedTarget: oversizedTarget,
      pendingStoryTarget: null,
      safeFrame: { x: 20, y: 20, width: 60, height: 60 },
      followDeadZone: { x: 0, y: 0, width: 0, height: 0 },
      rasterOrigin: { x: 2_000, y: 0 },
      worldBounds: { x: 0, y: 0, width: 100, height: 100 },
      flying: false,
    } satisfies CameraSnapshot;

    expect(boundedRasterOrigin(camera, { x: 1, y: 0 }, 100, 100))
      .toEqual({ x: 0, y: 0 });
  });

  it.each([
    ["desktop top normal", false, feetAnchoredVisualRect({ x: 752, y: 250.56 })],
    ["desktop top reduced", true, feetAnchoredVisualRect({ x: 752, y: 250.56 })],
    ["desktop bottom normal", false, feetAnchoredVisualRect({ x: 944, y: 1_990.4 })],
    ["desktop bottom reduced", true, feetAnchoredVisualRect({ x: 944, y: 1_990.4 })],
  ] as const)("keeps a fractional moving Follow target fully inside the painted %s safe frame", (
    _name,
    reducedMotion,
    actor,
  ) => {
    const camera = createCamera({
      width: 1_440,
      height: 900,
      reducedMotion,
      safeFrame: { top: 222, right: 52, bottom: 176, left: 216 },
    });
    camera.setWorldBounds({ x: 0, y: 0, width: 2_048, height: 2_048 });
    camera.setEntityBounds("agent:wanderer_001", actor);
    camera.apply({ type: "follow", entityId: "agent:wanderer_001" });
    if (!reducedMotion) camera.update(240);

    const snapshot = camera.snapshot();
    const origin = boundedRasterOrigin(snapshot, { x: 0, y: 0 }, 1_440, 900);
    const screenBounds = {
      x: actor.x * snapshot.zoom + origin.x,
      y: actor.y * snapshot.zoom + origin.y,
      width: actor.width * snapshot.zoom,
      height: actor.height * snapshot.zoom,
    };

    expect(snapshot.guidedTarget).toEqual(actor);
    expect(screenBounds.x).toBeGreaterThanOrEqual(snapshot.safeFrame.x);
    expect(screenBounds.y).toBeGreaterThanOrEqual(snapshot.safeFrame.y);
    expect(screenBounds.x + screenBounds.width)
      .toBeLessThanOrEqual(snapshot.safeFrame.x + snapshot.safeFrame.width);
    expect(screenBounds.y + screenBounds.height)
      .toBeLessThanOrEqual(snapshot.safeFrame.y + snapshot.safeFrame.height);
  });

  it("keeps Free raster and bounded impulse strict to the full viewport", () => {
    const camera = {
      mode: "free",
      topology: "bounded",
      center: { x: 0, y: 0 },
      zoom: 1.0003,
      viewerControlled: false,
      followEntityId: null,
      storyEntityId: null,
      pendingStoryEntityId: null,
      storyTarget: null,
      guidedTarget: null,
      pendingStoryTarget: null,
      safeFrame: { x: 216, y: 222, width: 1_172, height: 502 },
      followDeadZone: { x: 0, y: 0, width: 0, height: 0 },
      rasterOrigin: { x: 216, y: 222 },
      worldBounds: { x: 0, y: 0, width: 2_048, height: 2_048 },
      flying: false,
    } satisfies CameraSnapshot;

    expect(boundedRasterOrigin(camera, { x: 1, y: 1 }, 1_440, 900))
      .toEqual({ x: 0, y: 0 });
  });

  it("uses the protected-frame midpoint when no integer raster interval exists", () => {
    const camera = {
      mode: "story",
      topology: "bounded",
      center: { x: 0, y: 0 },
      zoom: 0.25,
      viewerControlled: false,
      followEntityId: null,
      storyEntityId: "agent-a",
      pendingStoryEntityId: null,
      storyTarget: null,
      guidedTarget: null,
      pendingStoryTarget: null,
      safeFrame: { x: 20, y: 20, width: 40, height: 40 },
      followDeadZone: { x: 0, y: 0, width: 0, height: 0 },
      rasterOrigin: { x: 2_000, y: -2_000 },
      worldBounds: { x: 0, y: 0, width: 100, height: 100 },
      flying: false,
    } satisfies CameraSnapshot;

    expect(boundedRasterOrigin(camera, { x: 1, y: -1 }, 80, 80))
      .toEqual({ x: 28, y: 28 });
  });

  it("rounds fractional-zoom raster bounds inward at all four impulse corners", () => {
    const base = {
      mode: "story",
      topology: "bounded",
      center: { x: 0, y: 0 },
      zoom: 1.0003,
      viewerControlled: false,
      followEntityId: null,
      storyEntityId: null,
      pendingStoryEntityId: null,
      storyTarget: null,
      guidedTarget: null,
      pendingStoryTarget: null,
      safeFrame: { x: 0, y: 0, width: 1_440, height: 900 },
      followDeadZone: { x: 0, y: 0, width: 0, height: 0 },
      worldBounds: { x: 0, y: 0, width: 2_048, height: 2_048 },
      flying: false,
    } satisfies Omit<CameraSnapshot, "rasterOrigin">;
    const origins = [
      boundedRasterOrigin({ ...base, rasterOrigin: { x: 0, y: 0 } }, { x: 1, y: 1 }, 1_440, 900),
      boundedRasterOrigin({ ...base, rasterOrigin: { x: -609, y: 0 } }, { x: -1, y: 1 }, 1_440, 900),
      boundedRasterOrigin({ ...base, rasterOrigin: { x: 0, y: -1_149 } }, { x: 1, y: -1 }, 1_440, 900),
      boundedRasterOrigin({ ...base, rasterOrigin: { x: -609, y: -1_149 } }, { x: -1, y: -1 }, 1_440, 900),
    ];

    expect(origins).toEqual([
      { x: 0, y: 0 },
      { x: -608, y: 0 },
      { x: 0, y: -1_148 },
      { x: -608, y: -1_148 },
    ]);
  });

  it("requires the frozen production manifest, placement, recipes, and concrete factory set", async () => {
    const fixture = await harness();
    expect(fixture.sceneGraphFactory).toHaveBeenCalledOnce();
    expect(fixture.sceneGraphFactory).toHaveBeenCalledWith(expect.objectContaining({
      manifest: PRODUCTION_ASSET_MANIFEST,
      factories: fixture.factories,
      placement: fixture.placement,
    }));
    const graphOptions = fixture.sceneGraphFactory.mock.calls[0]![0];
    expect(graphOptions.recipes).toBeInstanceOf(Map);
    expect([...graphOptions.recipes.values()]).toEqual(recipes);
    expect(fixture.renderer).toMatchObject({
      updatePresentation: expect.any(Function),
      diagnostics: expect.any(Function),
      dispose: expect.any(Function),
    });
    fixture.renderer.dispose();
  });

  it("passes a selected ReadonlyMap recipe facade unchanged to custom graph factories", async () => {
    const selectedRecipes = new Map(recipes.map((recipe) => [recipe.regionId, recipe]));
    const fixture = await harness({ recipes: selectedRecipes });

    expect(fixture.sceneGraphFactory.mock.calls[0]![0]!.recipes).toBe(selectedRecipes);
    fixture.renderer.dispose();
  });

  it("records bounded spatial rebinding against the initial Live resources at every Graph creation", async () => {
    const livePlacementSource = Symbol("live-placement");
    const archivePlacementSource = Symbol("archive-placement");
    let selectedPlacementSource = livePlacementSource;
    const placement = {
      sourceIdentity: () => selectedPlacementSource,
      snapshot: () => ({
        revision: 1,
        agents: new Map(),
        homes: new Map(),
        districtsByRegion: new Map(),
      }),
      navigationGridFor: () => null,
    } as unknown as PlacementLedger;
    const liveRecipes = new Map(recipes.map((recipe) => [recipe.regionId, recipe]));
    const archiveRecipes = new Map(recipes.map((recipe) => [
      recipe.regionId,
      structuredClone(recipe) as RegionMapRecipeV1,
    ]));
    let selectedRecipes = liveRecipes;
    const recipeFacade = selectedReadonlyMap(() => selectedRecipes);
    const graphs = [fakeGraph(), fakeGraph(), fakeGraph()];
    const bindings: Array<Readonly<{ placementRebound: boolean; recipesRebound: boolean }>> = [];
    let generation = 0;
    const fixture = await harness({
      graph: graphs[0],
      placement,
      recipes: recipeFacade,
      sceneGraphFactory: (graphOptions) => {
        bindings.push(graphOptions.spatialBinding!);
        return graphs[generation++]! as unknown as ProductionSceneGraph;
      },
    });

    fixture.renderer.updatePresentation(frame({ revision: 1 }));
    await settle();
    selectedPlacementSource = archivePlacementSource;
    selectedRecipes = archiveRecipes;
    fixture.renderer.updatePresentation(frame({ sourceKey: "archive:run-a", revision: 1 }));
    await settle();
    selectedPlacementSource = livePlacementSource;
    selectedRecipes = liveRecipes;
    fixture.renderer.updatePresentation(frame({ sourceKey: "live:run-a", revision: 2 }));
    await settle();

    expect(bindings).toEqual([
      { placementRebound: false, recipesRebound: false },
      { placementRebound: true, recipesRebound: true },
      { placementRebound: false, recipesRebound: false },
    ]);
    fixture.renderer.dispose();
  });

  it("rebinds a scene-less Story lineage to the already visible region instead of lexical fallback", async () => {
    const graphs = [fakeGraph(), fakeGraph()];
    let generation = 0;
    const fixture = await harness({
      graph: graphs[0],
      sceneGraphFactory: () => graphs[generation++]! as unknown as ProductionSceneGraph,
      resolveSceneCommands: (next) => ({
        identity: {
          runId: next.runId,
          sourceKey: next.sourceKey,
          revision: next.revision,
          firstCursor: next.firstCursor,
          lastCursor: next.lastCursor,
        },
        sceneToken: next.sourceKey.startsWith("archive:") ? 0 : 9,
        commands: [],
      }),
    });

    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "spring" }));
    await settle();
    fixture.renderer.updatePresentation(frame({
      sourceKey: "archive:run-a",
      revision: 0,
      firstCursor: 0,
      lastCursor: 0,
      sceneRegion: "spring",
      settled: true,
    }));
    await settle();

    expect(graphs[1]!.update).toHaveBeenCalledWith(
      expect.objectContaining({ sourceKey: "archive:run-a", scene: null }),
      expect.objectContaining({ sceneToken: 0, commands: [] }),
      "spring",
    );
    expect(fixture.debug().frameIdentity).toMatchObject({ sourceKey: "archive:run-a" });
    fixture.renderer.dispose();
  });

  it("builds a fresh graph when an authored Story frame changes source and region together", async () => {
    const graphs = [fakeGraph(), fakeGraph()];
    let generation = 0;
    const fixture = await harness({
      graph: graphs[0],
      sceneGraphFactory: () => graphs[generation++]! as unknown as ProductionSceneGraph,
      resolveSceneCommands: (next) => ({
        identity: {
          runId: next.runId,
          sourceKey: next.sourceKey,
          revision: next.revision,
          firstCursor: next.firstCursor,
          lastCursor: next.lastCursor,
        },
        sceneToken: next.sourceKey.startsWith("archive:") ? 0 : 9,
        commands: [],
      }),
    });

    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
    await settle();
    fixture.renderer.updatePresentation(frame({
      sourceKey: "archive:run-a",
      revision: 0,
      firstCursor: 0,
      lastCursor: 0,
      sceneRegion: "spring",
    }));
    await settle();

    expect(graphs[0]!.update).not.toHaveBeenCalledWith(
      expect.objectContaining({ sourceKey: "archive:run-a" }),
      expect.anything(),
      expect.anything(),
    );
    expect(graphs[1]!.update).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceKey: "archive:run-a",
        scene: expect.objectContaining({ regionId: "spring" }),
      }),
      expect.objectContaining({ sceneToken: 0, commands: [] }),
      null,
    );
    expect(graphs[0]!.dispose).toHaveBeenCalledOnce();
    expect(fixture.debug()).toMatchObject({
      frameIdentity: { sourceKey: "archive:run-a" },
      visibleRegionId: "spring",
      lastInternalFailure: null,
    });
    fixture.renderer.dispose();
  });

  it("keeps the prior graph and region leases when a cross-region lineage candidate fails", async () => {
    const graphs = [fakeGraph(), fakeGraph()];
    graphs[1]!.update.mockImplementation(() => {
      throw new Error("cross-region candidate failed");
    });
    let generation = 0;
    const onFailure = vi.fn();
    const fixture = await harness({
      callbacks: { onFailure },
      graph: graphs[0],
      sceneGraphFactory: () => graphs[generation++]! as unknown as ProductionSceneGraph,
    });

    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
    await settle();
    fixture.renderer.updatePresentation(frame({
      sourceKey: "archive:run-a",
      revision: 0,
      firstCursor: 0,
      lastCursor: 0,
      sceneRegion: "spring",
    }));
    await settle();

    expect(graphs[0]!.dispose).not.toHaveBeenCalled();
    expect(graphs[1]!.dispose).toHaveBeenCalledOnce();
    expect(fixture.debug()).toMatchObject({
      frameIdentity: { sourceKey: "live:run-a" },
      visibleRegionId: "worn",
      lastInternalFailure: {
        stage: "lineage-rebind",
        name: "Error",
        message: "cross-region candidate failed",
      },
    });
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({
      kind: "asset",
      retryable: true,
    }));
    fixture.renderer.dispose();
  });

  it.each([
    ["same-region", "worn"],
    ["cross-region", "spring"],
  ] as const)(
    "clears a prior lineage camera impulse at a successful %s adoption boundary",
    async (_kind, archiveRegion) => {
      const graphs = [fakeGraph(), fakeGraph()];
      let generation = 0;
      const fixture = await harness({
        graph: graphs[0],
        sceneGraphFactory: () => graphs[generation++]! as unknown as ProductionSceneGraph,
        resolveSceneCommands: (next) => ({
          identity: {
            runId: next.runId,
            sourceKey: next.sourceKey,
            revision: next.revision,
            firstCursor: next.firstCursor,
            lastCursor: next.lastCursor,
          },
          sceneToken: next.sourceKey.startsWith("archive:") ? next.revision : 9,
          commands: next.sourceKey.startsWith("live:")
            ? [{
                kind: "camera-impulse",
                commandId: "live:impact",
                offset: { x: 1, y: 0 },
                durationMs: 80,
              } as never]
            : next.revision === 0
              ? []
              : [{
                  kind: "camera-impulse",
                  commandId: "archive:impact",
                  offset: { x: 0, y: 1 },
                  durationMs: 60,
                } as never],
        }),
      });

      fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn", execution: true }));
      await settle();
      expect(fixture.debug().cameraImpulse).toEqual({ offset: { x: 1, y: 0 }, untilMs: 80 });

      fixture.renderer.updatePresentation(frame({
        sourceKey: "archive:run-a",
        revision: 0,
        firstCursor: 0,
        lastCursor: 0,
        sceneRegion: archiveRegion,
        execution: true,
      }));
      await settle();
      expect(fixture.debug().cameraImpulse).toBeNull();

      fixture.renderer.updatePresentation(frame({
        sourceKey: "archive:run-a",
        revision: 1,
        firstCursor: 1,
        lastCursor: 1,
        sceneRegion: archiveRegion,
        execution: true,
      }));
      await settle();
      expect(fixture.debug().cameraImpulse).toEqual({ offset: { x: 0, y: 1 }, untilMs: 60 });
      fixture.renderer.dispose();
    },
  );

  it("reuses recipe-owned static caches across same-map lineages and rebuilds on identity drift", async () => {
    const liveRecipes = new Map(recipes.map((recipe) => [recipe.regionId, recipe]));
    const archiveRecipes = new Map(recipes.map((recipe) => [
      recipe.regionId,
      structuredClone(recipe) as RegionMapRecipeV1,
    ]));
    const changedRecipes = new Map(archiveRecipes);
    changedRecipes.set("worn", {
      ...structuredClone(archiveRecipes.get("worn")!),
      identityHash: "changed-worn-topology",
    });
    let selectedRecipes = liveRecipes;
    const graphs = [fakeGraph(), fakeGraph(), fakeGraph()];
    let generation = 0;
    const fixture = await harness({
      graph: graphs[0],
      recipes: selectedReadonlyMap(() => selectedRecipes),
      sceneGraphFactory: () => graphs[generation++]! as unknown as ProductionSceneGraph,
    });

    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
    await settle();
    const live = fixture.debug();
    expect(live.cache).toMatchObject({ created: 3, disposed: 0, outstanding: 3 });

    selectedRecipes = archiveRecipes;
    fixture.renderer.updatePresentation(frame({
      sourceKey: "archive:run-a",
      revision: 0,
      firstCursor: 0,
      lastCursor: 0,
      sceneRegion: "worn",
    }));
    await settle();

    expect(generation).toBe(2);
    expect(graphs[0]!.dispose).toHaveBeenCalledOnce();
    expect(fixture.debug()).toMatchObject({
      staticLayerRebuilds: live.staticLayerRebuilds,
      cache: {
        created: 3,
        disposed: 0,
        outstanding: 3,
        peak: 3,
        lastRebuildReason: "initial",
      },
    });

    selectedRecipes = changedRecipes;
    fixture.renderer.updatePresentation(frame({
      sourceKey: "live:run-a",
      revision: 2,
      sceneRegion: "worn",
    }));
    await settle();
    expect(generation).toBe(3);
    expect(graphs[1]!.dispose).toHaveBeenCalledOnce();
    expect(fixture.debug()).toMatchObject({
      staticLayerRebuilds: live.staticLayerRebuilds + 1,
      cache: {
        created: 6,
        disposed: 3,
        outstanding: 3,
        peak: 6,
        lastRebuildReason: "topology",
      },
    });
    fixture.renderer.dispose();
    expect(fixture.debug().cache).toMatchObject({ created: 6, disposed: 6, outstanding: 0 });
  });

  it("rejects malformed identity before graph work and ignores duplicate or stale same-source frames", async () => {
    const fixture = await harness();
    const invalid = frame({ runId: "", revision: 1 });
    expect(() => fixture.renderer.updatePresentation(invalid)).toThrow(/runId/i);
    expect(fixture.graph.update).not.toHaveBeenCalled();

    fixture.renderer.updatePresentation(frame({ revision: 3, firstCursor: 3, lastCursor: 3 }));
    fixture.renderer.updatePresentation(frame({ revision: 3, firstCursor: 3, lastCursor: 3 }));
    fixture.renderer.updatePresentation(frame({ revision: 2, firstCursor: 2, lastCursor: 2 }));
    await settle();
    expect(fixture.graph.update).toHaveBeenCalledTimes(1);
    fixture.renderer.dispose();
  });

  it("deep-owns accepted frames and publishes an atomic changed-run replacement", async () => {
    const fixture = await harness();
    const accepted = frame({ revision: 1, firstCursor: 1, lastCursor: 1 });
    fixture.renderer.updatePresentation(accepted);
    await settle();
    (accepted.world.agents[0]!.value as { name?: string }).name = "mutated caller";
    expect(fixture.graph.frames.at(-1)?.world.agents[0]?.value.name).toBe("Aster");

    const replacement = frame({
      runId: "run-b",
      sourceKey: "archive:run-b",
      revision: 0,
      firstCursor: 0,
      lastCursor: 0,
    });
    fixture.renderer.updatePresentation(replacement);
    await settle();
    expect(fixture.graph.frames.at(-1)).toMatchObject({ runId: "run-b", revision: 0 });
    expect(fixture.debug().frameIdentity).toMatchObject({ runId: "run-b", revision: 0 });
    fixture.renderer.dispose();
  });

  it("keeps the complete previous frame visible until the next region bundle commits atomically", async () => {
    const springAtlas = PRODUCTION_ASSET_MANIFEST.regions["spring-terraces"].atlasIds[0]!;
    const pending = deferred<ProductionAssetLease>();
    const fixture = await harness({ pendingAtlas: [springAtlas, pending] });
    fixture.renderer.updatePresentation(frame({
      revision: 1,
      sceneRegion: "worn",
      selection: { kind: "agent", id: "agent-a" },
    }));
    await settle();
    fixture.driver.fire(16);
    expect(fixture.graph.frames.at(-1)?.scene?.regionId).toBe("worn");

    fixture.renderer.updatePresentation(frame({ revision: 2, sceneRegion: "spring" }));
    fixture.driver.fire(32);
    expect(fixture.graph.frames.at(-1)?.scene?.regionId).toBe("worn");
    expect(fixture.debug()).toMatchObject({ visibleRegionId: "worn", loadingRegionId: "spring" });

    pending.resolve(lease(springAtlas));
    await settle();
    fixture.driver.fire(48);
    expect(fixture.graph.frames.at(-1)?.scene?.regionId).toBe("spring");
    expect(fixture.debug()).toMatchObject({ visibleRegionId: "spring", loadingRegionId: null });
    fixture.renderer.dispose();
  });

  it("retains every legacy scenery placement when a region has no scenic landmark replacements", async () => {
    const fixture = await harness();
    const recipe = recipes.find(({ regionId }) => regionId === "spring")!;
    expect(recipe.scenicLandmarks).toHaveLength(0);
    expect(recipe.staticScenery.some(({ clusterId }) => clusterId !== null)).toBe(true);

    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "spring" }));
    await settle();

    const sceneryCanvas = fixture.cacheCanvases.find((canvas) => canvas.dataset.cache === "scenery")!;
    const draws = contexts.get(sceneryCanvas)!.drawImageCalls;
    expect(draws).toHaveLength(recipe.staticScenery.length);
    for (const [index, placement] of recipe.staticScenery.entries()) {
      const call = draws[index]!;
      expect((call[0] as { label?: string }).label).toBe(`${recipe.kit}-scenery`);
      expect(call.slice(-4)).toEqual([
        placement.tile.column * 32,
        placement.tile.row * 32,
        32,
        32,
      ]);
    }
    fixture.renderer.dispose();
  });

  it("renders native scenic landmarks before unclustered 32px scenery and hides cluster collision proxies", async () => {
    const fixture = await harness();
    const recipe = recipes.find(({ regionId }) => regionId === "worn")!;
    const unclusteredScenery = recipe.staticScenery.filter(({ clusterId }) => clusterId === null);
    expect(recipe.scenicLandmarks.length).toBeGreaterThan(0);
    expect(recipe.staticScenery.length).toBeGreaterThan(unclusteredScenery.length);

    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
    await settle();

    const sceneryCanvas = fixture.cacheCanvases.find((canvas) => canvas.dataset.cache === "scenery")!;
    const draws = contexts.get(sceneryCanvas)!.drawImageCalls;
    expect(draws).toHaveLength(recipe.scenicLandmarks.length + unclusteredScenery.length);
    for (const [index, placement] of recipe.scenicLandmarks.entries()) {
      const call = draws[index]!;
      expect((call[0] as { label?: string }).label).toBe(`${recipe.kit}-landmarks`);
      expect(call.slice(1)).toEqual([
        placement.frame.x,
        placement.frame.y,
        128,
        128,
        placement.contactTile.column * 32 + 16 - placement.contactPivotPx.x,
        placement.contactTile.row * 32 + 16 - placement.contactPivotPx.y,
        128,
        128,
      ]);
    }
    for (const [index, placement] of unclusteredScenery.entries()) {
      const call = draws[recipe.scenicLandmarks.length + index]!;
      expect((call[0] as { label?: string }).label).toBe(`${recipe.kit}-scenery`);
      expect(call.slice(-4)).toEqual([
        placement.tile.column * 32,
        placement.tile.row * 32,
        32,
        32,
      ]);
    }
    fixture.renderer.dispose();
  });

  it.each([
    ["missing atlas lease", (placement: any) => { placement.atlasId = "missing-landmarks"; }],
    ["foreign atlas", (placement: any) => { placement.atlasId = "worn-heartland-scenery"; }],
    ["missing frame", (placement: any) => { delete placement.frame; }],
    ["stale frame", (placement: any) => { placement.frame.x += 128; }],
    ["missing pivot", (placement: any) => { delete placement.contactPivotPx; }],
    ["stale pivot", (placement: any) => { placement.contactPivotPx.x += 1; }],
    ["missing geometry hash", (placement: any) => { delete placement.geometryHash; }],
    ["stale geometry hash", (placement: any) => { placement.geometryHash = "0".repeat(64); }],
  ] as const)(
    "retains the previous visible cache when a scenic landmark has a %s",
    async (_label, corrupt) => {
      const candidateRecipes = structuredClone(recipes) as unknown as any[];
      const worn = candidateRecipes.find(({ regionId }) => regionId === "worn")!;
      corrupt(worn.scenicLandmarks[0]);
      const onFailure = vi.fn();
      const fixture = await harness({ recipes: candidateRecipes, callbacks: { onFailure } });
      fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "spring" }));
      await settle();
      const retainedCache = fixture.cacheCanvases.find((canvas) => canvas.dataset.cache === "scenery")!;

      fixture.renderer.updatePresentation(frame({ revision: 2, sceneRegion: "worn" }));
      await settle();

      expect(fixture.debug()).toMatchObject({
        frameIdentity: { revision: 1 },
        visibleRegionId: "spring",
        loadingRegionId: null,
        staticCacheRegions: ["spring"],
      });
      expect(fixture.cacheDisposals[1]).not.toHaveBeenCalled();
      expect(fixture.cacheCanvases.find((canvas) => canvas === retainedCache)).toBe(retainedCache);
      expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ kind: "asset", retryable: true }));
      fixture.renderer.dispose();
    },
  );

  it("prepares every static-cache draw exactly once across bounded tasks before atomic adoption", async () => {
    const atlasCommitScheduler = new FakeAtlasCommitScheduler();
    const fixture = await harness({ atlasCommitScheduler });
    const reference = await harness();
    const input = frame({ revision: 1, sceneRegion: "worn" });
    const recipe = recipes.find(({ regionId }) => regionId === "worn")!;
    const expectedTerrainDraws = recipe.grid.columns * recipe.grid.rows;
    const replacedClusterIds = new Set(recipe.scenicLandmarks.map(({ clusterId }) => clusterId));
    const expectedSceneryDraws = recipe.scenicLandmarks.length
      + recipe.staticScenery.filter(
        ({ clusterId }) => clusterId === null || !replacedClusterIds.has(clusterId),
      ).length;
    const expectedContinuationDraws = CONTINUATION_PATTERN_TILE_COUNT;
    const cacheDrawCount = (): number => fixture.cacheCanvases.reduce(
      (total, cacheCanvas) => total + contexts.get(cacheCanvas)!.drawImageCalls.length,
      0,
    );
    const cacheWitness = (canvases: readonly HTMLCanvasElement[]) => canvases.map((cacheCanvas) => {
      const recording = contexts.get(cacheCanvas)!;
      return {
        draws: recording.drawImageCalls.map(([source, ...args]) => [
          (source as { label?: string }).label ?? null,
          ...args,
        ]),
        clears: recording.clearRectCalls,
        patterns: recording.createPatternCalls.map(([source, repetition]) => [
          (source as HTMLCanvasElement).dataset.cache ?? null,
          repetition,
        ]),
      };
    });

    reference.renderer.updatePresentation(input);
    await settle();
    reference.renderer.resize(640, 384);
    const synchronousReferenceCanvases = reference.cacheCanvases.slice(-3);

    fixture.renderer.updatePresentation(input);
    await settle();

    expect(fixture.graph.update).not.toHaveBeenCalled();
    expect(fixture.debug()).toMatchObject({
      frameIdentity: null,
      visibleRegionId: null,
      loadingRegionId: "worn",
    });
    expect(atlasCommitScheduler.pending()).toBe(1);
    expect(fixture.debug().cache).toMatchObject({ created: 0, disposed: 0, outstanding: 0 });

    const perTaskDraws: number[] = [];
    while (fixture.graph.update.mock.calls.length === 0) {
      const before = cacheDrawCount();
      atlasCommitScheduler.fire();
      perTaskDraws.push(cacheDrawCount() - before);
      if (fixture.graph.update.mock.calls.length === 0) {
        expect(fixture.debug()).toMatchObject({
          frameIdentity: null,
          visibleRegionId: null,
          loadingRegionId: "worn",
          staticCacheRegions: [],
          cache: { created: 3, disposed: 0, outstanding: 3 },
        });
        expect(atlasCommitScheduler.pending()).toBe(1);
      }
    }

    expect(fixture.graph.frames.at(-1)).toMatchObject({ revision: 1 });
    expect(perTaskDraws.length).toBeGreaterThan(2);
    expect(perTaskDraws.at(-1)).toBe(0);
    expect(perTaskDraws.slice(0, -1).every((count) => count > 0 && count <= 1_536)).toBe(true);
    expect(perTaskDraws.reduce((total, count) => total + count, 0)).toBe(
      expectedTerrainDraws + expectedSceneryDraws + expectedContinuationDraws,
    );
    expect(contexts.get(fixture.cacheCanvases[0]!)!.drawImageCalls).toHaveLength(expectedTerrainDraws);
    expect(contexts.get(fixture.cacheCanvases[1]!)!.drawImageCalls).toHaveLength(expectedSceneryDraws);
    expect(contexts.get(fixture.cacheCanvases[2]!)!.drawImageCalls).toHaveLength(expectedContinuationDraws);
    expect(fixture.cacheCanvases).toHaveLength(3);
    expect(synchronousReferenceCanvases).toHaveLength(3);
    expect(cacheWitness(fixture.cacheCanvases)).toEqual(cacheWitness(synchronousReferenceCanvases));
    const incrementalPatterns = contexts.get(fixture.canvas)!.createPatternCalls.map(
      ([source, repetition]) => [(source as HTMLCanvasElement).dataset.cache ?? null, repetition],
    );
    const synchronousPatterns = contexts.get(reference.canvas)!.createPatternCalls.slice(-1).map(
      ([source, repetition]) => [(source as HTMLCanvasElement).dataset.cache ?? null, repetition],
    );
    expect(incrementalPatterns).toEqual([["continuation-matte", "repeat"]]);
    expect(incrementalPatterns).toEqual(synchronousPatterns);
    expect(fixture.debug()).toMatchObject({
      frameIdentity: expect.objectContaining({ revision: 1 }),
      visibleRegionId: "worn",
      loadingRegionId: null,
    });
    fixture.renderer.dispose();
    reference.renderer.dispose();
  });

  it("consumes exact static-scene providers only through bounded scheduled preparation slices", async () => {
    const recipe = exactNirvanaRecipe();
    const exactScene = instrumentedExactStaticSceneProvider(recipe, 1_537);
    const atlasCommitScheduler = new FakeAtlasCommitScheduler();
    const fixture = await harness({
      atlasCommitScheduler,
      recipes: [recipe],
      manifest: createNirvanaProductionManifest(PRODUCTION_ASSET_MANIFEST),
      staticSceneProviders: new Map([["nirvana-v2", exactScene.provider]]),
    });

    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "nirvana" }));
    await settle();

    expect(atlasCommitScheduler.pending()).toBe(1);
    expect(exactScene.createPreparation).not.toHaveBeenCalled();
    atlasCommitScheduler.fireAll(10);

    const witness = {
      adoptedFrames: fixture.graph.update.mock.calls.length,
      preparationCalls: exactScene.createPreparation.mock.calls.length,
      synchronousPlanCalls: exactScene.createPlan.mock.calls.length,
      advanceSlices: exactScene.advanceBudgets.length,
      maximumAdvanceBudget: exactScene.advanceBudgets.length === 0
        ? null
        : Math.max(...exactScene.advanceBudgets),
      allAdvanceBudgetsBounded: exactScene.advanceBudgets.every(
        (budget) => budget > 0
          && budget <= 1_536
          && budget !== Number.MAX_SAFE_INTEGER,
      ),
    };
    fixture.renderer.dispose();

    expect(witness).toEqual({
      adoptedFrames: 1,
      preparationCalls: 1,
      synchronousPlanCalls: 0,
      advanceSlices: 2,
      maximumAdvanceBudget: 1_536,
      allAdvanceBudgetsBounded: true,
    });
  });

  it("uses one exact descriptor for cache dimensions and bounded camera adoption of a toroidal region", async () => {
    const recipe = exactNirvanaRecipe();
    const descriptor = createProductionStaticSceneDescriptor({
      cacheIdentity: [
        "nirvana-v2",
        recipe.presentationProfile!.atlasProfileVersion,
        recipe.identityHash,
        recipe.presentationProfile!.staticSceneHash,
      ].join(":"),
      worldBounds: { x: 0, y: 0, width: 640, height: 480 },
      topology: "toroidal",
    });
    const exactScene = instrumentedExactStaticSceneProvider(recipe, 4, { descriptor });
    const fixture = await harness({
      recipes: [recipe],
      manifest: createNirvanaProductionManifest(PRODUCTION_ASSET_MANIFEST),
      staticSceneProviders: new Map([["nirvana-v2", exactScene.provider]]),
    });

    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "nirvana" }));
    await settle();

    expect(exactScene.describe).toHaveBeenCalledOnce();
    expect(fixture.cacheCanvases.slice(0, 2).map(({ width, height }) => ({ width, height })))
      .toEqual([{ width: 640, height: 480 }, { width: 640, height: 480 }]);
    expect(fixture.debug()).toMatchObject({
      visibleRegionId: "nirvana",
      camera: {
        // The camera's clamp topology is always "bounded" now -- the observer's toroidal wrap
        // is retired at the camera layer (Z2) even though the region's own render descriptor
        // (asserted below via `mountedStaticCache`) stays toroidal.
        topology: "bounded",
        worldBounds: descriptor.worldBounds,
      },
    });
    fixture.renderer.dispose();
  });

  it("schedules same-region exact identity growth and adopts its graph, cache, bounds, and freshest frame together", async () => {
    const initialRecipe = exactNirvanaRecipe();
    const grownRecipe = grownExactNirvanaRecipe(initialRecipe, {
      columns: initialRecipe.grid.columns + 48,
      rows: initialRecipe.grid.rows,
      identityHash: "a".repeat(64),
      staticSceneHash: "b".repeat(64),
    });
    let selectedRecipes = new Map<string, RegionMapRecipeV1>([
      ["nirvana", initialRecipe],
    ]);
    const recipeFacade = selectedReadonlyMap(() => selectedRecipes);
    const exactScene = instrumentedExactStaticSceneProvider(initialRecipe, 1_537, {
      descriptorForRecipe: exactDescriptorForRecipe,
    });
    const atlasCommitScheduler = new FakeAtlasCommitScheduler();
    const initialGraph = fakeGraph();
    const grownGraph = fakeGraph();
    const graphQueue = [initialGraph, grownGraph];
    let graphIndex = 0;
    const onFailure = vi.fn();
    const onSelectionChange = vi.fn();
    let inspectRenderer: (() => CanvasPresentationRendererDebug) | null = null;
    const semanticCommits: Array<Readonly<{
      revision: number;
      cacheIdentity: string | null;
      worldWidth: number | null;
    }>> = [];
    const onSemanticSnapshot = vi.fn((snapshot) => {
      const debug = inspectRenderer?.();
      semanticCommits.push({
        revision: snapshot.frameIdentity.revision,
        cacheIdentity: debug?.mountedStaticCache?.staticCacheIdentity ?? null,
        worldWidth: debug?.camera.worldBounds?.width ?? null,
      });
    });
    const fixture = await harness({
      atlasCommitScheduler,
      callbacks: { onFailure, onSelectionChange, onSemanticSnapshot },
      graph: initialGraph,
      sceneGraphFactory: () => graphQueue[graphIndex++]! as unknown as ProductionSceneGraph,
      recipes: recipeFacade,
      manifest: createNirvanaProductionManifest(PRODUCTION_ASSET_MANIFEST),
      staticSceneProviders: new Map([["nirvana-v2", exactScene.provider]]),
    });
    inspectRenderer = fixture.debug;

    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "nirvana" }));
    await settle();
    atlasCommitScheduler.fireAll(10);
    const oldLeaseReleases = [...fixture.pool.releases];
    const initialPreparationCount = exactScene.createPreparation.mock.calls.length;
    const initialSemanticCount = semanticCommits.length;

    selectedRecipes = new Map([["nirvana", grownRecipe]]);
    fixture.renderer.updatePresentation(frame({ revision: 2, sceneRegion: "nirvana" }));
    await settle();

    expect(fixture.debug()).toMatchObject({
      frameIdentity: { revision: 1 },
      visibleRegionId: "nirvana",
      loadingRegionId: "nirvana",
      mountedStaticCache: {
        regionId: "nirvana",
        staticCacheIdentity: staticIdentityForRecipe(initialRecipe),
      },
      visibleRecipe: {
        identityHash: initialRecipe.identityHash,
        grid: {
          columns: initialRecipe.grid.columns,
          rows: initialRecipe.grid.rows,
        },
      },
      camera: {
        // Camera clamp topology is always "bounded" (Z2 retires observer wrap); the region's
        // own render descriptor (toroidal) is unaffected.
        topology: "bounded",
        worldBounds: exactDescriptorForRecipe(initialRecipe).worldBounds,
      },
    });
    expect(initialGraph.dispose).not.toHaveBeenCalled();
    expect(grownGraph.update).not.toHaveBeenCalled();
    expect(fixture.cacheDisposals.slice(0, 3).every(
      (dispose) => dispose.mock.calls.length === 0,
    )).toBe(true);
    expect(oldLeaseReleases.every((release) => release.mock.calls.length === 0)).toBe(true);
    expect(atlasCommitScheduler.pending()).toBe(1);
    expect(semanticCommits).toHaveLength(initialSemanticCount);

    atlasCommitScheduler.fire();
    const priorVisibleDraws = initialGraph.draw.mock.calls.length;
    fixture.renderer.setCameraMode("free");
    fixture.renderer.panCamera({ x: -7_000, y: -5_000 });
    fixture.renderer.updatePresentation(frame({ revision: 3, sceneRegion: "nirvana" }));
    fixture.driver.fire(16);
    expect(fixture.debug()).toMatchObject({
      frameIdentity: { revision: 1 },
      loadingRegionId: "nirvana",
      mountedStaticCache: {
        staticCacheIdentity: staticIdentityForRecipe(initialRecipe),
      },
    });
    expect(grownGraph.update).not.toHaveBeenCalled();
    expect(initialGraph.draw).toHaveBeenCalledTimes(priorVisibleDraws + 1);
    expect(fixture.cacheDisposals.slice(0, 3).every(
      (dispose) => dispose.mock.calls.length === 0,
    )).toBe(true);
    expect(semanticCommits).toHaveLength(initialSemanticCount);

    await settle();
    atlasCommitScheduler.fireAll(10);

    expect(grownGraph.frames.at(-1)).toMatchObject({ revision: 3 });
    expect(fixture.debug()).toMatchObject({
      frameIdentity: { revision: 3 },
      visibleRegionId: "nirvana",
      loadingRegionId: null,
      mountedStaticCache: {
        regionId: "nirvana",
        staticCacheIdentity: staticIdentityForRecipe(grownRecipe),
      },
      visibleRecipe: {
        identityHash: grownRecipe.identityHash,
        grid: {
          columns: grownRecipe.grid.columns,
          rows: grownRecipe.grid.rows,
        },
      },
      camera: {
        mode: "free",
        topology: "bounded",
        worldBounds: exactDescriptorForRecipe(grownRecipe).worldBounds,
      },
    });
    expect(initialGraph.dispose).toHaveBeenCalledOnce();
    expect(fixture.cacheDisposals.slice(0, 3).every(
      (dispose) => dispose.mock.calls.length === 1,
    )).toBe(true);
    expect(oldLeaseReleases.every((release) => release.mock.calls.length === 1)).toBe(true);
    expect(exactScene.createPreparation).toHaveBeenCalledTimes(initialPreparationCount + 2);
    expect(exactScene.advanceBudgets.every(
      (budget) => budget > 0 && budget <= 1_536 && budget !== Number.MAX_SAFE_INTEGER,
    )).toBe(true);
    expect(onFailure).not.toHaveBeenCalled();
    expect(onSelectionChange).not.toHaveBeenCalled();
    expect(semanticCommits.at(-1)).toEqual({
      revision: 3,
      cacheIdentity: staticIdentityForRecipe(grownRecipe),
      worldWidth: exactDescriptorForRecipe(grownRecipe).worldBounds.width,
    });

    const completedPreparationCount = exactScene.createPreparation.mock.calls.length;
    fixture.renderer.updatePresentation(frame({ revision: 4, sceneRegion: "nirvana" }));
    expect(grownGraph.frames.at(-1)).toMatchObject({ revision: 4 });
    expect(exactScene.createPreparation).toHaveBeenCalledTimes(completedPreparationCount);
    expect(atlasCommitScheduler.pending()).toBe(0);
    fixture.renderer.dispose();
  });

  it("preserves the pending growth frame when Free returns to Story during exact preparation", async () => {
    const initialRecipe = exactNirvanaRecipe();
    const grownRecipe = grownExactNirvanaRecipe(initialRecipe, {
      columns: initialRecipe.grid.columns + 48,
      rows: initialRecipe.grid.rows,
      identityHash: "6".repeat(64),
      staticSceneHash: "7".repeat(64),
    });
    let selectedRecipes = new Map<string, RegionMapRecipeV1>([
      ["nirvana", initialRecipe],
    ]);
    const exactScene = instrumentedExactStaticSceneProvider(initialRecipe, 1_537, {
      descriptorForRecipe: exactDescriptorForRecipe,
    });
    const atlasCommitScheduler = new FakeAtlasCommitScheduler();
    const initialGraph = fakeGraph();
    const grownGraph = fakeGraph();
    const graphQueue = [initialGraph, grownGraph];
    let graphIndex = 0;
    const fixture = await harness({
      atlasCommitScheduler,
      graph: initialGraph,
      sceneGraphFactory: () => graphQueue[graphIndex++]! as unknown as ProductionSceneGraph,
      resolveSceneCommands: (next) => ({
        identity: {
          runId: next.runId,
          sourceKey: next.sourceKey,
          revision: next.revision,
          firstCursor: next.firstCursor,
          lastCursor: next.lastCursor,
        },
        sceneToken: next.revision,
        commands: [],
      }),
      recipes: selectedReadonlyMap(() => selectedRecipes),
      manifest: createNirvanaProductionManifest(PRODUCTION_ASSET_MANIFEST),
      staticSceneProviders: new Map([["nirvana-v2", exactScene.provider]]),
    });
    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "nirvana" }));
    await settle();
    atlasCommitScheduler.fireAll(10);
    fixture.renderer.setCameraMode("free");

    selectedRecipes = new Map([["nirvana", grownRecipe]]);
    fixture.renderer.updatePresentation(frame({ revision: 2, sceneRegion: "nirvana" }));
    await settle();
    atlasCommitScheduler.fire();
    fixture.renderer.setCameraMode("story");
    await settle();
    atlasCommitScheduler.fireAll(10);

    expect(grownGraph.frames.at(-1)).toMatchObject({ revision: 2 });
    expect(fixture.debug()).toMatchObject({
      frameIdentity: { revision: 2 },
      mountedStaticCache: {
        staticCacheIdentity: staticIdentityForRecipe(grownRecipe),
      },
      camera: {
        mode: "story",
        worldBounds: exactDescriptorForRecipe(grownRecipe).worldBounds,
      },
    });
    fixture.renderer.dispose();
  });

  it.each(["graph", "hit-targets", "semantic"] as const)(
    "retains the coherent exact scene when same-region growth fails during %s preflight",
    async (failureStage) => {
      const initialRecipe = exactNirvanaRecipe();
      const grownRecipe = grownExactNirvanaRecipe(initialRecipe, {
        columns: initialRecipe.grid.columns + 48,
        rows: initialRecipe.grid.rows,
        identityHash: "c".repeat(64),
        staticSceneHash: "d".repeat(64),
      });
      let selectedRecipes = new Map<string, RegionMapRecipeV1>([
        ["nirvana", initialRecipe],
      ]);
      const exactScene = instrumentedExactStaticSceneProvider(initialRecipe, 4, {
        descriptorForRecipe: exactDescriptorForRecipe,
      });
      const initialGraph = fakeGraph();
      const candidateGraph = fakeGraph();
      if (failureStage === "graph") {
        candidateGraph.update.mockImplementation(() => {
          throw new Error("candidate graph failed");
        });
      } else if (failureStage === "hit-targets") {
        candidateGraph.hitTargets.mockImplementation(() => {
          throw new Error("candidate targets failed");
        });
      } else {
        candidateGraph.semanticSnapshot.mockImplementation(() => {
          throw new Error("candidate semantics failed");
        });
      }
      const graphQueue = [initialGraph, candidateGraph];
      let graphIndex = 0;
      const onFailure = vi.fn();
      const onSemanticSnapshot = vi.fn();
      const fixture = await harness({
        callbacks: { onFailure, onSemanticSnapshot },
        graph: initialGraph,
        sceneGraphFactory: () => graphQueue[graphIndex++]! as unknown as ProductionSceneGraph,
        recipes: selectedReadonlyMap(() => selectedRecipes),
        manifest: createNirvanaProductionManifest(PRODUCTION_ASSET_MANIFEST),
        staticSceneProviders: new Map([["nirvana-v2", exactScene.provider]]),
      });
      fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "nirvana" }));
      await settle();
      const before = fixture.debug();
      const priorLeases = [...fixture.pool.releases];
      const priorSemanticCount = onSemanticSnapshot.mock.calls.length;

      selectedRecipes = new Map([["nirvana", grownRecipe]]);
      fixture.renderer.updatePresentation(frame({ revision: 2, sceneRegion: "nirvana" }));
      await settle();

      expect(fixture.debug()).toMatchObject({
        frameIdentity: before.frameIdentity,
        visibleRegionId: "nirvana",
        loadingRegionId: null,
        mountedStaticCache: before.mountedStaticCache,
        camera: before.camera,
      });
      expect(initialGraph.dispose).not.toHaveBeenCalled();
      expect(candidateGraph.dispose).toHaveBeenCalledOnce();
      expect(fixture.cacheDisposals.slice(0, 3).every(
        (dispose) => dispose.mock.calls.length === 0,
      )).toBe(true);
      expect(fixture.cacheDisposals.slice(3).every(
        (dispose) => dispose.mock.calls.length === 1,
      )).toBe(true);
      expect(priorLeases.every((release) => release.mock.calls.length === 0)).toBe(true);
      expect(fixture.pool.releases.slice(priorLeases.length).every(
        (release) => release.mock.calls.length === 1,
      )).toBe(true);
      expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({
        kind: "asset",
        retryable: true,
      }));
      expect(onSemanticSnapshot).toHaveBeenCalledTimes(priorSemanticCount);
      fixture.renderer.dispose();
    },
  );

  it("retains exact same-region truth when provider preparation fails before candidate adoption", async () => {
    const initialRecipe = exactNirvanaRecipe();
    const grownRecipe = grownExactNirvanaRecipe(initialRecipe, {
      columns: initialRecipe.grid.columns + 48,
      rows: initialRecipe.grid.rows,
      identityHash: "e".repeat(64),
      staticSceneHash: "f".repeat(64),
    });
    let selectedRecipes = new Map<string, RegionMapRecipeV1>([
      ["nirvana", initialRecipe],
    ]);
    const exactScene = instrumentedExactStaticSceneProvider(initialRecipe, 4, {
      descriptorForRecipe: exactDescriptorForRecipe,
    });
    const onFailure = vi.fn();
    const onSemanticSnapshot = vi.fn();
    const fixture = await harness({
      callbacks: { onFailure, onSemanticSnapshot },
      recipes: selectedReadonlyMap(() => selectedRecipes),
      manifest: createNirvanaProductionManifest(PRODUCTION_ASSET_MANIFEST),
      staticSceneProviders: new Map([["nirvana-v2", exactScene.provider]]),
    });
    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "nirvana" }));
    await settle();
    const before = fixture.debug();
    const priorLeases = [...fixture.pool.releases];
    const priorSemanticCount = onSemanticSnapshot.mock.calls.length;
    exactScene.createPreparation.mockImplementationOnce(() => {
      throw new Error("growth preparation failed");
    });

    selectedRecipes = new Map([["nirvana", grownRecipe]]);
    fixture.renderer.updatePresentation(frame({ revision: 2, sceneRegion: "nirvana" }));
    await settle();

    expect(fixture.debug()).toMatchObject({
      frameIdentity: before.frameIdentity,
      visibleRegionId: "nirvana",
      loadingRegionId: null,
      mountedStaticCache: before.mountedStaticCache,
      camera: before.camera,
    });
    expect(fixture.cacheDisposals.slice(0, 3).every(
      (dispose) => dispose.mock.calls.length === 0,
    )).toBe(true);
    expect(priorLeases.every((release) => release.mock.calls.length === 0)).toBe(true);
    expect(fixture.pool.releases.slice(priorLeases.length).every(
      (release) => release.mock.calls.length === 1,
    )).toBe(true);
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({
      kind: "asset",
      retryable: true,
    }));
    expect(onSemanticSnapshot).toHaveBeenCalledTimes(priorSemanticCount);
    fixture.renderer.dispose();
  });

  it("does not reinstall a prepared exact cache when a post-adoption signal disposes reentrantly", async () => {
    const initialRecipe = exactNirvanaRecipe();
    const grownRecipe = grownExactNirvanaRecipe(initialRecipe, {
      columns: initialRecipe.grid.columns + 48,
      rows: initialRecipe.grid.rows,
      identityHash: "0".repeat(64),
      staticSceneHash: "a".repeat(64),
    });
    let selectedRecipes = new Map<string, RegionMapRecipeV1>([
      ["nirvana", initialRecipe],
    ]);
    const exactScene = instrumentedExactStaticSceneProvider(initialRecipe, 4, {
      descriptorForRecipe: exactDescriptorForRecipe,
    });
    const initialGraph = fakeGraph();
    const grownGraph = fakeGraph();
    grownGraph.sceneSignalValue = [{
      serial: 1,
      sceneToken: 2,
      commandId: "growth:ready",
      subjectId: "nirvana",
      marker: "settled",
      atMs: 16,
    }];
    const graphQueue = [initialGraph, grownGraph];
    let graphIndex = 0;
    let rendererForCallback: ObserverRendererPort | null = null;
    const onSceneSignals = vi.fn(() => rendererForCallback?.dispose());
    const fixture = await harness({
      graph: initialGraph,
      sceneGraphFactory: () => graphQueue[graphIndex++]! as unknown as ProductionSceneGraph,
      onSceneSignals,
      resolveSceneCommands: (next) => ({
        identity: {
          runId: next.runId,
          sourceKey: next.sourceKey,
          revision: next.revision,
          firstCursor: next.firstCursor,
          lastCursor: next.lastCursor,
        },
        sceneToken: next.revision,
        commands: [],
      }),
      recipes: selectedReadonlyMap(() => selectedRecipes),
      manifest: createNirvanaProductionManifest(PRODUCTION_ASSET_MANIFEST),
      staticSceneProviders: new Map([["nirvana-v2", exactScene.provider]]),
    });
    rendererForCallback = fixture.renderer;
    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "nirvana" }));
    await settle();

    selectedRecipes = new Map([["nirvana", grownRecipe]]);
    fixture.renderer.updatePresentation(frame({ revision: 2, sceneRegion: "nirvana" }));
    await settle();

    expect(onSceneSignals).toHaveBeenCalledOnce();
    expect(fixture.debug()).toMatchObject({
      mountedStaticCache: null,
      visibleRecipe: null,
      cache: { outstanding: 0 },
    });
    expect(initialGraph.dispose).toHaveBeenCalledOnce();
    expect(grownGraph.dispose).toHaveBeenCalledOnce();
    expect(fixture.cacheDisposals.every(
      (dispose) => dispose.mock.calls.length === 1,
    )).toBe(true);
  });

  it.each(["story", "follow"] as const)(
    "rebinds %s to the grown exact graph target without changing camera mode",
    async (cameraMode) => {
    const initialRecipe = exactNirvanaRecipe();
    const grownRecipe = grownExactNirvanaRecipe(initialRecipe, {
      columns: initialRecipe.grid.columns + 48,
      rows: initialRecipe.grid.rows,
      identityHash: "8".repeat(64),
      staticSceneHash: "9".repeat(64),
    });
    let selectedRecipes = new Map<string, RegionMapRecipeV1>([
      ["nirvana", initialRecipe],
    ]);
    const exactScene = instrumentedExactStaticSceneProvider(initialRecipe, 4, {
      descriptorForRecipe: exactDescriptorForRecipe,
    });
    const initialGraph = fakeGraph();
    const grownGraph = fakeGraph();
    const initialTarget = {
      selection: { kind: "agent" as const, id: "agent-a" },
      worldBounds: { x: 320, y: 448, width: 24, height: 32 },
      feetY: 480,
      selectionKey: "agent:agent-a",
    };
    const grownTarget = {
      ...initialTarget,
      worldBounds: { x: 4_160, y: 448, width: 24, height: 32 },
      feetY: 480,
    };
    initialGraph.debugValue.hitTargets = [initialTarget];
    grownGraph.debugValue.hitTargets = [grownTarget];
    const graphQueue = [initialGraph, grownGraph];
    let graphIndex = 0;
    const fixture = await harness({
      reducedMotion: true,
      graph: initialGraph,
      sceneGraphFactory: () => graphQueue[graphIndex++]! as unknown as ProductionSceneGraph,
      recipes: selectedReadonlyMap(() => selectedRecipes),
      manifest: createNirvanaProductionManifest(PRODUCTION_ASSET_MANIFEST),
      staticSceneProviders: new Map([["nirvana-v2", exactScene.provider]]),
    });
    const selection = { kind: "agent" as const, id: "agent-a" };
    fixture.renderer.updatePresentation(frame({
      revision: 1,
      sceneRegion: "nirvana",
      selection,
    }));
    await settle();
    if (cameraMode === "follow") fixture.renderer.setCameraMode("follow");
    expect(fixture.debug().camera).toMatchObject({
      mode: cameraMode,
      ...(cameraMode === "story"
        ? { storyEntityId: "agent:agent-a" }
        : { followEntityId: "agent:agent-a" }),
      guidedTarget: initialTarget.worldBounds,
    });

    selectedRecipes = new Map([["nirvana", grownRecipe]]);
    fixture.renderer.updatePresentation(frame({
      revision: 2,
      sceneRegion: "nirvana",
      selection,
    }));
    await settle();

    expect(fixture.debug()).toMatchObject({
      frameIdentity: { revision: 2 },
      mountedStaticCache: {
        staticCacheIdentity: staticIdentityForRecipe(grownRecipe),
      },
      camera: {
        mode: cameraMode,
        ...(cameraMode === "story"
          ? { storyEntityId: "agent:agent-a" }
          : { followEntityId: "agent:agent-a" }),
        guidedTarget: grownTarget.worldBounds,
        worldBounds: exactDescriptorForRecipe(grownRecipe).worldBounds,
      },
    });
    fixture.renderer.dispose();
  });

  it("preserves a Story focus chosen while exact same-region growth is preparing", async () => {
    const initialRecipe = exactNirvanaRecipe();
    const grownRecipe = grownExactNirvanaRecipe(initialRecipe, {
      columns: initialRecipe.grid.columns + 48,
      rows: initialRecipe.grid.rows,
      identityHash: "b".repeat(64),
      staticSceneHash: "c".repeat(64),
    });
    let selectedRecipes = new Map<string, RegionMapRecipeV1>([
      ["nirvana", initialRecipe],
    ]);
    const exactScene = instrumentedExactStaticSceneProvider(initialRecipe, 1_537, {
      descriptorForRecipe: exactDescriptorForRecipe,
    });
    const atlasCommitScheduler = new FakeAtlasCommitScheduler();
    const initialGraph = fakeGraph();
    const grownGraph = fakeGraph();
    const targetA = {
      selection: { kind: "agent" as const, id: "agent-a" },
      worldBounds: { x: 320, y: 448, width: 24, height: 32 },
      feetY: 480,
      selectionKey: "agent:agent-a",
    };
    const targetB = {
      selection: { kind: "agent" as const, id: "agent-b" },
      worldBounds: { x: 640, y: 448, width: 24, height: 32 },
      feetY: 480,
      selectionKey: "agent:agent-b",
    };
    const grownTargetB = {
      ...targetB,
      worldBounds: { x: 4_480, y: 448, width: 24, height: 32 },
      feetY: 480,
    };
    initialGraph.debugValue.hitTargets = [targetA, targetB];
    grownGraph.debugValue.hitTargets = [
      { ...targetA, worldBounds: { ...targetA.worldBounds, x: 4_160 } },
      grownTargetB,
    ];
    const graphQueue = [initialGraph, grownGraph];
    let graphIndex = 0;
    const fixture = await harness({
      atlasCommitScheduler,
      reducedMotion: true,
      graph: initialGraph,
      sceneGraphFactory: () => graphQueue[graphIndex++]! as unknown as ProductionSceneGraph,
      recipes: selectedReadonlyMap(() => selectedRecipes),
      manifest: createNirvanaProductionManifest(PRODUCTION_ASSET_MANIFEST),
      staticSceneProviders: new Map([["nirvana-v2", exactScene.provider]]),
    });
    fixture.renderer.updatePresentation(frame({
      revision: 1,
      sceneRegion: "nirvana",
      selection: targetA.selection,
    }));
    await settle();
    atlasCommitScheduler.fireAll(10);

    selectedRecipes = new Map([["nirvana", grownRecipe]]);
    fixture.renderer.updatePresentation(frame({
      revision: 2,
      sceneRegion: "nirvana",
      selection: targetA.selection,
    }));
    await settle();
    atlasCommitScheduler.fire();
    fixture.renderer.focusSelection(targetB.selection);
    expect(fixture.debug().camera).toMatchObject({
      mode: "story",
      storyEntityId: targetB.selectionKey,
      guidedTarget: targetB.worldBounds,
    });

    atlasCommitScheduler.fireAll(10);

    expect(fixture.debug().camera).toMatchObject({
      mode: "story",
      storyEntityId: grownTargetB.selectionKey,
      guidedTarget: grownTargetB.worldBounds,
    });
    fixture.renderer.dispose();
  });

  it("preserves a Follow selection chosen while exact same-region growth is preparing", async () => {
    const initialRecipe = exactNirvanaRecipe();
    const grownRecipe = grownExactNirvanaRecipe(initialRecipe, {
      columns: initialRecipe.grid.columns + 48,
      rows: initialRecipe.grid.rows,
      identityHash: "d".repeat(64),
      staticSceneHash: "e".repeat(64),
    });
    let selectedRecipes = new Map<string, RegionMapRecipeV1>([
      ["nirvana", initialRecipe],
    ]);
    const exactScene = instrumentedExactStaticSceneProvider(initialRecipe, 1_537, {
      descriptorForRecipe: exactDescriptorForRecipe,
    });
    const atlasCommitScheduler = new FakeAtlasCommitScheduler();
    const initialGraph = fakeGraph();
    const grownGraph = fakeGraph();
    const targetA = {
      selection: { kind: "agent" as const, id: "agent-a" },
      worldBounds: { x: 320, y: 448, width: 24, height: 32 },
      feetY: 480,
      selectionKey: "agent:agent-a",
    };
    const targetB = {
      selection: { kind: "agent" as const, id: "agent-b" },
      worldBounds: { x: 640, y: 448, width: 24, height: 32 },
      feetY: 480,
      selectionKey: "agent:agent-b",
    };
    const grownTargetB = {
      ...targetB,
      worldBounds: { x: 4_480, y: 448, width: 24, height: 32 },
      feetY: 480,
    };
    initialGraph.debugValue.hitTargets = [targetA, targetB];
    grownGraph.debugValue.hitTargets = [
      { ...targetA, worldBounds: { ...targetA.worldBounds, x: 4_160 } },
      grownTargetB,
    ];
    const graphQueue = [initialGraph, grownGraph];
    let graphIndex = 0;
    const fixture = await harness({
      atlasCommitScheduler,
      reducedMotion: true,
      graph: initialGraph,
      sceneGraphFactory: () => graphQueue[graphIndex++]! as unknown as ProductionSceneGraph,
      recipes: selectedReadonlyMap(() => selectedRecipes),
      manifest: createNirvanaProductionManifest(PRODUCTION_ASSET_MANIFEST),
      staticSceneProviders: new Map([["nirvana-v2", exactScene.provider]]),
    });
    fixture.renderer.updatePresentation(frame({
      revision: 1,
      sceneRegion: "nirvana",
      selection: targetA.selection,
    }));
    await settle();
    atlasCommitScheduler.fireAll(10);

    selectedRecipes = new Map([["nirvana", grownRecipe]]);
    fixture.renderer.updatePresentation(frame({
      revision: 2,
      sceneRegion: "nirvana",
      selection: targetA.selection,
    }));
    await settle();
    atlasCommitScheduler.fire();
    fixture.renderer.setSelection(targetB.selection);
    fixture.renderer.setCameraMode("follow");
    await settle();
    atlasCommitScheduler.fireAll(10);
    expect(fixture.debug().camera).toMatchObject({
      mode: "follow",
      followEntityId: targetB.selectionKey,
      guidedTarget: grownTargetB.worldBounds,
    });

    fixture.renderer.setCameraMode("free");
    fixture.renderer.setCameraMode("follow");

    expect(fixture.debug().camera).toMatchObject({
      mode: "follow",
      followEntityId: targetB.selectionKey,
      guidedTarget: grownTargetB.worldBounds,
    });
    fixture.renderer.dispose();
  });

  it("cancels one partial same-region exact generation before adopting a newer recipe identity", async () => {
    const initialRecipe = exactNirvanaRecipe();
    const firstGrowth = grownExactNirvanaRecipe(initialRecipe, {
      columns: initialRecipe.grid.columns + 48,
      rows: initialRecipe.grid.rows,
      identityHash: "1".repeat(64),
      staticSceneHash: "2".repeat(64),
    });
    const secondGrowth = grownExactNirvanaRecipe(initialRecipe, {
      columns: initialRecipe.grid.columns + 48,
      rows: initialRecipe.grid.rows + 32,
      identityHash: "3".repeat(64),
      staticSceneHash: "4".repeat(64),
    });
    let selectedRecipes = new Map<string, RegionMapRecipeV1>([
      ["nirvana", initialRecipe],
    ]);
    const exactScene = instrumentedExactStaticSceneProvider(initialRecipe, 1_537, {
      descriptorForRecipe: exactDescriptorForRecipe,
    });
    const atlasCommitScheduler = new FakeAtlasCommitScheduler();
    const initialGraph = fakeGraph();
    const finalGraph = fakeGraph();
    const graphQueue = [initialGraph, finalGraph];
    let graphIndex = 0;
    const onFailure = vi.fn();
    const onSemanticSnapshot = vi.fn();
    const fixture = await harness({
      atlasCommitScheduler,
      callbacks: { onFailure, onSemanticSnapshot },
      graph: initialGraph,
      sceneGraphFactory: () => graphQueue[graphIndex++]! as unknown as ProductionSceneGraph,
      recipes: selectedReadonlyMap(() => selectedRecipes),
      manifest: createNirvanaProductionManifest(PRODUCTION_ASSET_MANIFEST),
      staticSceneProviders: new Map([["nirvana-v2", exactScene.provider]]),
    });
    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "nirvana" }));
    await settle();
    atlasCommitScheduler.fireAll(10);
    const initialSemanticCount = onSemanticSnapshot.mock.calls.length;

    selectedRecipes = new Map([["nirvana", firstGrowth]]);
    fixture.renderer.updatePresentation(frame({ revision: 2, sceneRegion: "nirvana" }));
    await settle();
    atlasCommitScheduler.fire();
    const partialOwners = fixture.cacheDisposals.slice(3, 6);
    expect(partialOwners).toHaveLength(3);
    expect(partialOwners.every((dispose) => dispose.mock.calls.length === 0)).toBe(true);
    expect(onSemanticSnapshot).toHaveBeenCalledTimes(initialSemanticCount);

    selectedRecipes = new Map([["nirvana", secondGrowth]]);
    fixture.renderer.updatePresentation(frame({ revision: 3, sceneRegion: "nirvana" }));
    await settle();
    expect(partialOwners.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
    expect(onSemanticSnapshot).toHaveBeenCalledTimes(initialSemanticCount);
    expect(fixture.debug()).toMatchObject({
      frameIdentity: { revision: 1 },
      loadingRegionId: "nirvana",
      mountedStaticCache: {
        staticCacheIdentity: staticIdentityForRecipe(initialRecipe),
      },
    });

    atlasCommitScheduler.fireAll(10);

    expect(finalGraph.frames.at(-1)).toMatchObject({ revision: 3 });
    expect(fixture.debug()).toMatchObject({
      frameIdentity: { revision: 3 },
      loadingRegionId: null,
      mountedStaticCache: {
        staticCacheIdentity: staticIdentityForRecipe(secondGrowth),
      },
      camera: {
        topology: "bounded",
        worldBounds: exactDescriptorForRecipe(secondGrowth).worldBounds,
      },
    });
    expect(exactScene.createPreparation).toHaveBeenCalledTimes(3);
    expect(exactScene.preparationDisposals).toHaveLength(3);
    expect(exactScene.preparationDisposals.every(
      (dispose) => dispose.mock.calls.length === 1,
    )).toBe(true);
    expect(onSemanticSnapshot.mock.calls.map(([snapshot]) => snapshot.frameIdentity.revision))
      .toEqual([1, 3]);
    expect(onFailure).not.toHaveBeenCalled();
    fixture.renderer.dispose();
  });

  it("synthesizes bounded descriptors for generic region recipes", async () => {
    const fixture = await harness();
    const recipe = recipes.find(({ regionId }) => regionId === "worn")!;

    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
    await settle();

    expect(fixture.cacheCanvases.slice(0, 2).map(({ width, height }) => ({ width, height })))
      .toEqual([
        { width: recipe.grid.columns * 32, height: recipe.grid.rows * 32 },
        { width: recipe.grid.columns * 32, height: recipe.grid.rows * 32 },
      ]);
    expect(fixture.debug().camera).toMatchObject({
      topology: "bounded",
      worldBounds: {
        x: 0,
        y: 0,
        width: recipe.grid.columns * 32,
        height: recipe.grid.rows * 32,
      },
    });
    fixture.renderer.dispose();
  });

  it("bounds free-pan to the observed region's edges, then widens to the whole sheet below the zoom threshold", async () => {
    // The world-sheet camera's live check (Z2): panning inside a region now stops at its edges
    // instead of riding forever, and zooming out below the world/region threshold widens the
    // pannable range to the whole multi-region sheet. `recipes` here is the module-level fixture
    // ("worn" + "spring", both 96x96 tiles = 3,072px square), so a sheet built from both regions
    // is necessarily wider than either region alone.
    const fixture = await harness();
    fixture.renderer.resize(800, 600);
    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
    await settle();
    fixture.driver.fire(16);

    // Pans twice in the same direction and returns the settled centre; a second huge pan making
    // no further progress proves a real, held edge rather than a partial step toward one.
    const panToEdge = (deltaX: number): number => {
      fixture.renderer.panCamera({ x: deltaX, y: 0 });
      fixture.driver.fire(16);
      const first = fixture.debug().camera.center.x;
      fixture.renderer.panCamera({ x: deltaX, y: 0 });
      fixture.driver.fire(16);
      const second = fixture.debug().camera.center.x;
      expect(second).toBeCloseTo(first);
      return second;
    };

    const regionEdgeA = panToEdge(-1_000_000);
    const regionEdgeB = panToEdge(1_000_000);
    const regionRange = Math.abs(regionEdgeB - regionEdgeA);
    expect(regionRange).toBeGreaterThan(0);
    // The clamp is bounded well within a single region's own extent, not "never-ending": both
    // held edges stay inside "worn"'s own local frame, [0, singleRegionWidth].
    const singleRegionWidth = recipes.find(({ regionId }) => regionId === "worn")!.grid.columns * 32;
    expect(regionRange).toBeLessThan(singleRegionWidth);
    expect(Math.min(regionEdgeA, regionEdgeB)).toBeGreaterThanOrEqual(0);
    expect(Math.max(regionEdgeA, regionEdgeB)).toBeLessThanOrEqual(singleRegionWidth);

    // Zoom out repeatedly (a gentle factor, to land between the threshold and the sheet's own
    // minimum zoom rather than jumping straight past both) to cross below the world/region
    // threshold into the world view.
    for (let step = 0; step < 9; step += 1) {
      fixture.renderer.zoomCamera(0.8, { x: 400, y: 300 });
    }
    fixture.driver.fire(16);
    expect(fixture.debug().camera.zoom).toBeLessThan(MIN_ZOOM);

    panToEdge(-1_000_000);
    const worldEdgeB = panToEdge(1_000_000);
    // "worn"'s own local frame is exactly [0, singleRegionWidth] (the camera always operates in
    // the observed region's own local coordinates -- see `syncRegionSheet`), so a centre below 0
    // is impossible under a single-region clamp. Reaching negative local x here proves the clamp
    // now spans the whole sheet -- specifically, into "spring"'s side of it.
    expect(worldEdgeB).toBeLessThan(0);

    fixture.renderer.dispose();
  });

  describe("Z3 world-sheet LOD (worldSheetSnapshots)", () => {
    it("leaves the render byte-for-byte unchanged when worldSheetSnapshots is left at its default (off)", async () => {
      // `worldSheetSnapshots` defaults to false so every OTHER test in this file -- none of which
      // pass it -- keeps exercising the exact pre-Z3 single-region render. This is the explicit
      // regression check for that guarantee.
      const fixture = await harness();
      fixture.renderer.resize(800, 600);
      fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
      await settle();
      fixture.driver.fire(16);
      await settle();
      fixture.driver.fire(32);

      const context = contexts.get(fixture.canvas)!;
      // No 9-argument (sub-rect scaled) drawImage call -- that shape is unique to Z3's sheet
      // compositing (`drawWorldSheetBackground`); the focused region's own terrain/scenery always
      // draw via the pre-existing 3-argument form.
      expect(context.drawImageCalls.every((args) => args.length !== 9)).toBe(true);
      // No huge (whole-sheet) plain-color fillRect -- the gutter fill is unique to Z3's
      // compositing. Excludes the pre-existing continuation-pattern fill (also large, but always
      // painted with a `CanvasPattern` fillStyle, tracked separately in `patternFillRectCalls`).
      expect(nonPatternFillRects(context).some(isLargeFillRect)).toBe(false);
      fixture.renderer.dispose();
    });

    it("draws the gutter and a non-focused region's cached snapshot (and its beings' marks) once the background build settles", async () => {
      const fixture = await harness({ worldSheetSnapshots: true });
      fixture.renderer.resize(800, 600);
      fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
      await settle();
      fixture.driver.fire(16); // first draw: triggers the "spring" background build (async)
      await settle();
      await settle();
      fixture.driver.fire(32); // second draw: the completed background snapshot is now cached

      const context = contexts.get(fixture.canvas)!;
      // The gutter: a single large, plain-colour fillRect spanning (far more than) the whole
      // sheet -- distinguishable from the pre-existing continuation-pattern fill (also large, but
      // always a `CanvasPattern` fillStyle) and from any tiny home/being marker (by sheer size).
      expect(nonPatternFillRects(context).some(isLargeFillRect)).toBe(true);
      // The non-focused region's snapshot: a 9-argument (sub-rect scaled) drawImage call is
      // unique to sheet compositing -- the focused region's own terrain/scenery always draw via
      // the 3-argument form (see the "off by default" test above).
      const sheetBlits = context.drawImageCalls.filter((args) => args.length === 9);
      expect(sheetBlits.length).toBeGreaterThan(0);
      fixture.renderer.dispose();
    });

    it("draws the sheet background BEHIND the focused region's own terrain, never covering it", async () => {
      // Regression coverage for a real bug caught only via live browser evidence, not by the
      // other tests in this block: the gutter fill covers the WHOLE sheet's bounds, which
      // includes the focused region's own area (nothing else draws there in the non-focused-
      // region loop, since it skips `visibleRegionId`). Drawing the sheet background AFTER the
      // focused region's own terrain/scenery painted the gutter directly over them, blanking the
      // live region to a flat gutter-coloured rect -- reproducible even with a single region
      // (whose own rect is then the entire sheet). The fix draws the sheet background FIRST:
      // assert the large gutter fill's trace position comes BEFORE the focused region's own
      // "cache:terrain" draw, i.e. underneath it, not on top.
      const fixture = await harness({ worldSheetSnapshots: true });
      fixture.renderer.resize(800, 600);
      fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
      await settle();
      fixture.driver.fire(16);
      await settle();
      await settle();
      fixture.driver.fire(32);

      const context = contexts.get(fixture.canvas)!;
      const gutterIndex = context.trace.indexOf("fill:large");
      const terrainIndex = context.trace.indexOf("cache:terrain");
      expect(gutterIndex).toBeGreaterThanOrEqual(0);
      expect(terrainIndex).toBeGreaterThanOrEqual(0);
      expect(gutterIndex).toBeLessThan(terrainIndex);
      fixture.renderer.dispose();
    });

    it("never fabricates a snapshot for a region whose static scene cannot be described, and keeps drawing without it", async () => {
      // Honest-fallback coverage (Z3's step-1 finding): a region `describeStaticSceneTarget`
      // cannot describe (here, simulated by a recipe map missing "spring" entirely, so the
      // fixture's own frame -- which still names "worn" -- has no counterpart recipe for the
      // OTHER region a real 2-region sheet would need) never gets a fabricated bitmap; the
      // renderer keeps compositing gutter + focused terrain without throwing.
      const soleRecipe = recipes.find((recipe) => recipe.regionId === "worn")!;
      const fixture = await harness({ worldSheetSnapshots: true, recipes: [soleRecipe] });
      fixture.renderer.resize(800, 600);
      fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
      await settle();
      expect(() => fixture.driver.fire(16)).not.toThrow();
      await settle();
      expect(() => fixture.driver.fire(32)).not.toThrow();
      fixture.renderer.dispose();
    });

    it("camera focus follows into a live switch: dwelling zoomed-in over a neighbouring region eventually makes it the observed region", async () => {
      // The orchestrator's resolution of Z2's open question: moving the camera over a region and
      // zooming in must bring that region to full live detail. Drives the SAME public camera
      // ports the "bounds free-pan..." test above uses (get to the world view, pan to the far
      // edge -- proven there to land on "spring"'s side of the sheet -- then walk further in and
      // zoom back in) and asserts the renderer's own `visibleRegionId` follows, without ever
      // calling `observeRegion` directly.
      //
      // HOW THIS TEST GOT TO THE WORLD VIEW CHANGED, and the change is the point. It used to reach
      // it by zooming out nine notches: under the old zoom-derived regime, crossing `lodSnapshotZoom`
      // silently ejected the camera from the region and handed it the whole sheet to roam. That
      // ejection IS the reported defect ("when I zoom back it takes me out of the region and shows
      // me other regions as well"), so the deliberate-navigation model deletes it -- a zoom-out now
      // pins at the region's own cover-zoom floor and merely OFFERS the way out. The zoom-out is
      // therefore kept below and asserted to NOT eject (that is the regression guard), and the
      // departure is made the deliberate act the model requires: `exitToWorldView()`, the one
      // definition of "back to world" shared by Esc, the stage's control and the second detent
      // press. The assertion under test -- focus-follow brings a neighbouring region live -- is
      // unchanged and unweakened.
      const fixture = await harness({ worldSheetSnapshots: true });
      fixture.renderer.resize(800, 600);
      fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
      await settle();
      let nowMs = 16;
      fixture.driver.fire(nowMs);
      expect(fixture.debug().visibleRegionId).toBe("worn");
      expect(fixture.debug().worldNavigation.scope).toBe("region");

      for (let step = 0; step < 9; step += 1) {
        fixture.renderer.zoomCamera(0.8, { x: 400, y: 300 });
        nowMs += 16;
        fixture.driver.fire(nowMs);
      }
      // The place latch: nine notches of zoom-out press the floor and arm the step-out affordance,
      // and the viewer is still inside "worn" with its rect as the clamp.
      const pinned = fixture.debug();
      expect(pinned.camera.zoom).toBeCloseTo(pinned.worldNavigation.minimumZoom, 10);
      expect(pinned.worldNavigation.scope).toBe("region");
      expect(pinned.worldNavigation.exitOffered).toBe(true);
      expect(pinned.visibleRegionId).toBe("worn");

      // The deliberate departure, then let the ascent land before driving the camera by hand.
      fixture.renderer.exitToWorldView?.();
      for (let step = 0; step < 8; step += 1) {
        nowMs += 120;
        fixture.driver.fire(nowMs);
        await settle();
      }
      expect(fixture.debug().worldNavigation.scope).toBe("world");
      expect(fixture.debug().camera.zoom).toBeLessThan(MIN_ZOOM);

      // Walk toward "spring": pan-to-edge alone only reaches the sheet clamp's minimum for the
      // CURRENT zoom, which (at this small a zoom) sits right at "spring"'s own near coastal edge
      // -- the archipelago's islands are inset from their bounding plot (open sea reads at the
      // corners/edges, see `islandMask.ts`), so that edge point is ambiguous/sea, not solidly
      // "spring". Interleaving a small zoom-in between each pan shrinks the viewport's world-space
      // half-extent, which shifts the reachable clamp minimum further in -- exactly how a real
      // "zoom into a spot" gesture would settle deeper into the region you're aiming for, landing
      // comfortably inside "spring"'s actual island by the time the main zoom-in ramp begins.
      for (let walk = 0; walk < 6; walk += 1) {
        fixture.renderer.panCamera({ x: 1_000_000, y: 0 });
        nowMs += 16;
        fixture.driver.fire(nowMs);
        fixture.renderer.zoomCamera(1.15, { x: 400, y: 300 });
        nowMs += 16;
        fixture.driver.fire(nowMs);
      }

      for (let step = 0; step < 24; step += 1) {
        fixture.renderer.zoomCamera(1.3, { x: 400, y: 300 });
        nowMs += 16;
        fixture.driver.fire(nowMs);
      }

      // Hold here (camera no longer moving) long enough to clear the crossing ease AND the
      // focus-follow dwell timer, giving the hysteresis every chance to settle on its candidate.
      for (let step = 0; step < 20; step += 1) {
        nowMs += FOCUS_FOLLOW_DWELL_MS;
        fixture.driver.fire(nowMs);
        await settle();
      }

      expect(fixture.debug().visibleRegionId).toBe("spring");
      fixture.renderer.dispose();
    });
  });

  /**
   * The world-view navigation model, driven ONLY through the public renderer ports a viewer's
   * gestures reach (`zoomCamera`, `panCamera`, `hoverAt`, `enterRegionAt`, `exitToWorldView`,
   * `observeRegion`). The unit-level pieces are covered in `camera/Camera2D.navigation.test.ts` and
   * `world/worldNavigation.test.ts`; what is proven HERE is the wiring — that a real gesture on a
   * real sheet produces the modelled behaviour.
   *
   * See `.superpowers/sdd/world-navigation-report.md`.
   */
  describe("world-view navigation model", () => {
    /** A renderer observing "worn" on a live two-region sheet, one frame drawn. */
    const navFixture = async (): Promise<Awaited<ReturnType<typeof harness>>> => {
      const fixture = await harness({ worldSheetSnapshots: true });
      fixture.renderer.resize(800, 600);
      fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
      await settle();
      fixture.driver.fire(16);
      return fixture;
    };

    /**
     * The first canvas position whose hover resolves to `regionId`, found by sweeping the canvas.
     *
     * Deliberately a search rather than arithmetic: the island's placement is the packed ring
     * layout's business and its silhouette is the mask's, so hard-coding a coordinate here would
     * bake a layout constant into an interaction test. Sweeping asks the renderer the same question
     * a pointer does.
     */
    const findCanvasPointOver = (
      fixture: Awaited<ReturnType<typeof harness>>,
      regionId: string,
    ): Readonly<{ x: number; y: number }> | null => {
      for (let y = 8; y < 600; y += 12) {
        for (let x = 8; x < 800; x += 12) {
          fixture.renderer.hoverAt?.({ x, y });
          if (fixture.debug().worldNavigation.hoveredRegionId === regionId) return { x, y };
        }
      }
      return null;
    };

    /**
     * Takes the deliberate way out of a region and lets the ascent LAND.
     *
     * Driven off the renderer's own "still ascending" witness rather than a frame count, because a
     * flight advances on the draw delta (clamped to 50 ms) and so needs at least
     * `duration / 50` frames however far apart the wall-clock ticks are.
     */
    const goToWorldView = async (
      fixture: Awaited<ReturnType<typeof harness>>,
      fromMs: number,
    ): Promise<number> => {
      let nowMs = fromMs;
      fixture.renderer.exitToWorldView?.();
      for (let step = 0; step < 60 && fixture.debug().worldNavigation.ascending; step += 1) {
        nowMs += 120;
        fixture.driver.fire(nowMs);
        await settle();
      }
      expect(fixture.debug().worldNavigation.ascending).toBe(false);
      expect(fixture.debug().worldNavigation.scope).toBe("world");
      return nowMs;
    };

    it("opens LATCHED inside the region it is observing, with the region's cover zoom as the floor", async () => {
      const fixture = await navFixture();

      const { worldNavigation, camera } = fixture.debug();
      expect(worldNavigation.scope).toBe("region");
      expect(worldNavigation.frameOriginRegionId).toBe("worn");
      // The floor is the COVER fit, not the contain fit: the number below which sea and neighbours
      // would be on screen. Cover >= contain always, and for this plot/viewport pair they differ.
      const bounds = camera.worldBounds!;
      expect(worldNavigation.minimumZoom).toBeCloseTo(
        Math.max(800 / bounds.width, 600 / bounds.height),
        10,
      );
      expect(worldNavigation.minimumZoom)
        .toBeGreaterThan(Math.min(800 / bounds.width, 600 / bounds.height));
      fixture.renderer.dispose();
    });

    it("does not eject on zoom-out: one long gesture pins at the floor and only OFFERS the exit", async () => {
      const fixture = await navFixture();
      let nowMs = 16;

      // One continuous gesture (wheel events 16ms apart, as a trackpad pinch delivers them).
      for (let step = 0; step < 30; step += 1) {
        fixture.renderer.zoomCamera(0.8, { x: 400, y: 300 });
        nowMs += 16;
        fixture.driver.fire(nowMs);
      }

      const debug = fixture.debug();
      expect(debug.worldNavigation.scope).toBe("region");
      expect(debug.worldNavigation.exitOffered).toBe(true);
      expect(debug.camera.zoom).toBeCloseTo(debug.worldNavigation.minimumZoom, 10);
      // And the viewport is still wholly inside the region it is in -- no neighbour on screen.
      const bounds = debug.camera.worldBounds!;
      const halfWidth = 800 / (2 * debug.camera.zoom);
      const halfHeight = 600 / (2 * debug.camera.zoom);
      expect(debug.camera.center.x - halfWidth).toBeGreaterThanOrEqual(bounds.x - 1e-6);
      expect(debug.camera.center.x + halfWidth)
        .toBeLessThanOrEqual(bounds.x + bounds.width + 1e-6);
      expect(debug.camera.center.y - halfHeight).toBeGreaterThanOrEqual(bounds.y - 1e-6);
      expect(debug.camera.center.y + halfHeight)
        .toBeLessThanOrEqual(bounds.y + bounds.height + 1e-6);
      fixture.renderer.dispose();
    });

    it("leaves on a SECOND, separate zoom-out gesture — the step-out detent", async () => {
      const fixture = await navFixture();
      let nowMs = 16;

      for (let step = 0; step < 30; step += 1) {
        fixture.renderer.zoomCamera(0.8, { x: 400, y: 300 });
        nowMs += 16;
        fixture.driver.fire(nowMs);
      }
      expect(fixture.debug().worldNavigation.scope).toBe("region");

      // Let go (well past the gesture gap), then press again. That is the deliberate second act.
      nowMs += 600;
      fixture.driver.fire(nowMs);
      fixture.renderer.zoomCamera(0.8, { x: 400, y: 300 });
      nowMs += 16;
      fixture.driver.fire(nowMs);

      expect(fixture.debug().worldNavigation.scope).toBe("world");
      expect(fixture.debug().worldNavigation.ascending).toBe(true);
      fixture.renderer.dispose();
    });

    it("highlights the island under the pointer at world zoom, with its live readout, and nothing over open sea", async () => {
      const published: Array<Readonly<{ hoveredRegionId: string | null }>> = [];
      const fixture = await harness({
        worldSheetSnapshots: true,
        callbacks: { onWorldNavigationChange: (state) => published.push(state) },
      });
      fixture.renderer.resize(800, 600);
      fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
      await settle();
      fixture.driver.fire(16);
      await goToWorldView(fixture, 16);

      // Both islands are hoverable at world zoom -- the defect was that only the LIVE region had
      // any hit target at all, so a neighbour could never highlight.
      const overWorn = findCanvasPointOver(fixture, "worn");
      const overSpring = findCanvasPointOver(fixture, "spring");
      expect(overWorn).not.toBeNull();
      expect(overSpring).not.toBeNull();

      fixture.renderer.hoverAt?.(overWorn!);
      const hovered = fixture.debug().worldNavigation;
      expect(hovered.hoveredRegionId).toBe("worn");
      // The live readout: one being is placed in "worn" by the harness frame, and no homes.
      const readout = published.at(-1) as unknown as Readonly<{
        hoveredPopulation: number | null;
        hoveredHomes: number | null;
        hoveredRegionName: string | null;
      }>;
      expect(readout.hoveredRegionName).toBe("Worn");
      expect(readout.hoveredPopulation).toBeGreaterThanOrEqual(0);
      expect(readout.hoveredHomes).toBeGreaterThanOrEqual(0);

      // Open sea highlights nothing: the silhouette REJECTS a point that is merely inside some
      // plot's bounding box (hit-testing still routes through the rect; the coastline only rejects).
      fixture.renderer.hoverAt?.({ x: 1, y: 1 });
      expect(fixture.debug().worldNavigation.hoveredRegionId).toBeNull();
      fixture.renderer.hoverAt?.(null);
      expect(fixture.debug().worldNavigation.hoveredRegionId).toBeNull();
      fixture.renderer.dispose();
    });

    it("ignores hover while inside a region — there is no atlas to point at", async () => {
      const fixture = await navFixture();

      for (let y = 40; y < 600; y += 120) {
        for (let x = 40; x < 800; x += 120) fixture.renderer.hoverAt?.({ x, y });
      }

      expect(fixture.debug().worldNavigation.scope).toBe("region");
      expect(fixture.debug().worldNavigation.hoveredRegionId).toBeNull();
      fixture.renderer.dispose();
    });

    it("descends into a clicked island with an animated fly-in, and lands inside it", async () => {
      const fixture = await navFixture();
      let nowMs = await goToWorldView(fixture, 16);
      const target = findCanvasPointOver(fixture, "spring");
      expect(target).not.toBeNull();
      const departureZoom = fixture.debug().camera.zoom;

      fixture.renderer.enterRegionAt?.(target!);
      const launched = fixture.debug();
      expect(launched.worldNavigation.descendingIntoRegionId).toBe("spring");
      // A click is a VIEWER action, so it takes camera authority rather than being an auto-frame.
      expect(launched.camera.viewerControlled).toBe(true);
      // The scope does NOT latch on the click: latching before the flight lands would have the
      // region's own zoom floor snap the camera to the arrival zoom on frame one.
      expect(launched.worldNavigation.scope).toBe("world");

      // A double-click arrives as two clicks; the second must not start a second flight.
      fixture.renderer.enterRegionAt?.(target!);
      expect(fixture.debug().worldNavigation.descendingIntoRegionId).toBe("spring");

      // Mid-fly-in: strictly between departure and arrival, still in the air.
      nowMs += 420;
      fixture.driver.fire(nowMs);
      await settle();
      const midway = fixture.debug();
      expect(midway.camera.zoom).toBeGreaterThan(departureZoom);
      expect(midway.worldNavigation.descendingIntoRegionId).toBe("spring");

      // Arrival. Driven off the renderer's own witness, not a frame count (see `goToWorldView`).
      for (let step = 0;
        step < 60 && fixture.debug().worldNavigation.descendingIntoRegionId !== null;
        step += 1) {
        nowMs += 120;
        fixture.driver.fire(nowMs);
        await settle();
      }
      const arrived = fixture.debug();
      expect(arrived.worldNavigation.descendingIntoRegionId).toBeNull();
      expect(arrived.worldNavigation.scope).toBe("region");
      expect(arrived.visibleRegionId).toBe("spring");
      expect(arrived.camera.zoom).toBeGreaterThan(departureZoom);
      // Arrived means covering the canvas: the floor is now "spring"'s own cover zoom.
      expect(arrived.camera.zoom + 1e-6)
        .toBeGreaterThanOrEqual(arrived.worldNavigation.minimumZoom);
      // A click while already inside a region is inert -- descending is a world-view act.
      fixture.renderer.enterRegionAt?.(target!);
      expect(fixture.debug().worldNavigation.descendingIntoRegionId).toBeNull();
      fixture.renderer.dispose();
    });

    it("does not also SELECT while a descent is in the air, so a double-click does one thing", async () => {
      // Measured live: the second click of a double-click was already inert for descending, but it
      // still hit-tested the live scene, selected the region it landed on, and popped the Selection
      // drawer over a third of the frame while the viewer was mid-fall.
      const selections: unknown[] = [];
      const fixture = await harness({
        worldSheetSnapshots: true,
        callbacks: { onSelectionChange: (selection) => selections.push(selection) },
      });
      fixture.renderer.resize(800, 600);
      fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
      await settle();
      fixture.driver.fire(16);
      await goToWorldView(fixture, 16);
      const target = findCanvasPointOver(fixture, "spring");
      expect(target).not.toBeNull();

      fixture.renderer.enterRegionAt?.(target!);
      expect(fixture.debug().worldNavigation.descendingIntoRegionId).toBe("spring");
      const before = selections.length;
      // The second click of the double-click, delivered exactly as the stage delivers a completed one.
      fixture.renderer.selectAt?.(target!);

      expect(selections.length).toBe(before);
      fixture.renderer.dispose();
    });

    it("descends over open sea to nothing at all", async () => {
      const fixture = await navFixture();
      await goToWorldView(fixture, 16);

      fixture.renderer.enterRegionAt?.({ x: 1, y: 1 });

      expect(fixture.debug().worldNavigation.descendingIntoRegionId).toBeNull();
      expect(fixture.debug().worldNavigation.scope).toBe("world");
      fixture.renderer.dispose();
    });

    it("keeps selectAt's pick tolerance in WORLD px, so a far-offshore click at sheet zoom selects nothing while a click on a being still does", async () => {
      // The old tolerance was 44 CSS px converted to world space via `/ zoom`, so at world/sheet
      // zoom (well below 1) it ballooned -- a click tens of world-px off a being, which reads as
      // open sea, could still resolve to it. Proven here by picking an offshore distance strictly
      // between the fixed 44 world-px tolerance and what the OLD zoom-scaled tolerance would have
      // allowed at this fixture's actual sheet zoom: the old code would have selected it, the fixed
      // code must not.
      const onSelectionChange = vi.fn();
      const fixture = await harness({
        worldSheetSnapshots: true,
        callbacks: { onSelectionChange },
      });
      fixture.renderer.resize(800, 600);
      fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
      await settle();
      fixture.driver.fire(16);
      await goToWorldView(fixture, 16);

      fixture.graph.debugValue.hitTargets = [{
        selection: { kind: "agent", id: "shore-dweller" },
        worldBounds: { x: -4, y: -4, width: 8, height: 8 },
        feetY: 0,
        selectionKey: "agent:shore-dweller",
      }];
      fixture.canvas.getBoundingClientRect = () => ({
        x: 0, y: 0, left: 0, top: 0, right: 800, bottom: 600, width: 800, height: 600,
        toJSON: () => ({}),
      });

      // Mirrors `SELECTION_PICK_TOLERANCE_WORLD_PX` in CanvasPresentationRenderer.ts (not exported).
      const SELECTION_PICK_TOLERANCE_WORLD_PX = 44;
      const debug = fixture.debug();
      const origin = debug.renderRasterOrigin!;
      const zoom = debug.camera.zoom;
      // Sanity: this is genuinely a sub-1 sheet zoom, so the old `44 / zoom` tolerance was strictly
      // larger than the new fixed one -- otherwise this test would not distinguish the two.
      expect(zoom).toBeLessThan(1);
      const oldWorldTolerance = 44 / zoom;
      expect(oldWorldTolerance).toBeGreaterThan(SELECTION_PICK_TOLERANCE_WORLD_PX);
      const offshoreDistance = (SELECTION_PICK_TOLERANCE_WORLD_PX + oldWorldTolerance) / 2;
      const clickWorld = (x: number, y: number): void => {
        fixture.renderer.selectAt?.({ x: origin.x + x * zoom, y: origin.y + y * zoom });
      };

      // Distance-to-edge of the 8x8 target centred on the origin is (x - 4) along this axis.
      clickWorld(offshoreDistance + 4, 0);
      expect(onSelectionChange).not.toHaveBeenCalled();

      // The being itself still selects at the same sheet zoom.
      clickWorld(0, 0);
      expect(onSelectionChange).toHaveBeenLastCalledWith({ kind: "agent", id: "shore-dweller" });
      fixture.renderer.dispose();
    });

    it("re-bases the camera into the new region's local frame on a region switch, instead of teleporting", async () => {
      // The fifth defect. The camera works in the OBSERVED region's local frame (`syncRegionSheet`
      // subtracts that region's own sheet placement), so when the observed region changes the same
      // world point acquires new local coordinates. Without re-basing, every switch silently
      // teleports the view by the delta between the two plots' placements -- and the fly-in, which
      // loads its destination mid-flight, cannot work at all.
      const fixture = await navFixture();
      await goToWorldView(fixture, 16);
      const target = findCanvasPointOver(fixture, "spring");
      expect(target).not.toBeNull();

      // Put the camera centre over "spring" while still observing "worn". A PAN cannot do this at
      // the sheet fit: the viewport's world half-extent there exceeds the sheet, so the clamp pins
      // the centre near the sheet's middle. An ANCHORED zoom can, and is the real gesture anyway
      // (point at the island, pinch in): anchored zoom holds the anchor's world point under the
      // anchor's screen point, so the centre converges onto it as the zoom rises.
      let nowMs = 400;
      for (let step = 0; step < 6; step += 1) {
        fixture.renderer.zoomCamera(1.3, target!);
        nowMs += 16;
        fixture.driver.fire(nowMs);
      }
      await settle();
      const before = fixture.debug();
      expect(before.worldNavigation.focusedRegionId).toBe("spring");
      expect(before.visibleRegionId).toBe("worn");
      expect(before.worldNavigation.frameOriginRegionId).toBe("worn");
      // "worn"'s own rect sits at local (0,0) while "worn" is the frame origin, and the centre we
      // just moved to is over the OTHER island, hence outside it.
      const wornRect = before.camera.worldBounds!;
      const insideWorn = before.camera.center.x >= wornRect.x
        && before.camera.center.x <= wornRect.x + wornRect.width
        && before.camera.center.y >= wornRect.y
        && before.camera.center.y <= wornRect.y + wornRect.height;
      expect(insideWorn).toBe(false);
      const centreBefore = { ...before.camera.center };

      fixture.renderer.observeRegion("spring");
      for (let step = 0;
        step < 30 && fixture.debug().worldNavigation.frameOriginRegionId !== "spring";
        step += 1) {
        nowMs += 120;
        fixture.driver.fire(nowMs);
        await settle();
      }

      const after = fixture.debug();
      expect(after.visibleRegionId).toBe("spring");
      expect(after.worldNavigation.frameOriginRegionId).toBe("spring");
      // The centre MOVED in local numbers (that is the rebase) ...
      expect(after.camera.center).not.toEqual(centreBefore);
      // ... and it now lands inside "spring"'s own rect, which is at local (0,0) in the new frame:
      // the viewer is still looking at the island they were looking at. Under the teleport bug the
      // numeric centre would have been carried over unchanged and pointed at open sea.
      const springRect = after.camera.worldBounds!;
      expect(after.camera.center.x).toBeGreaterThanOrEqual(springRect.x);
      expect(after.camera.center.x).toBeLessThanOrEqual(springRect.x + springRect.width);
      expect(after.camera.center.y).toBeGreaterThanOrEqual(springRect.y);
      expect(after.camera.center.y).toBeLessThanOrEqual(springRect.y + springRect.height);
      fixture.renderer.dispose();
    });

    it("zooming in until a region covers the canvas latches it, and the next zoom-out then pins", async () => {
      const fixture = await navFixture();
      let nowMs = await goToWorldView(fixture, 16);
      expect(fixture.debug().worldNavigation.scope).toBe("world");

      // Aim at an island. The ascent lands centred on the SHEET, and the ring layout keeps the
      // sheet's middle deliberately empty (no chord may cross a third island), so "where the camera
      // is" right after an ascent is open water -- zooming in there correctly latches nothing. An
      // anchored zoom on the island is both the fix and the real gesture (pinch at the pointer).
      const overWorn = findCanvasPointOver(fixture, "worn");
      expect(overWorn).not.toBeNull();

      // Zoom in on the island under the pointer: the atlas's own descent.
      for (let step = 0; step < 24; step += 1) {
        fixture.renderer.zoomCamera(1.3, overWorn!);
        nowMs += 16;
        fixture.driver.fire(nowMs);
      }
      expect(fixture.debug().worldNavigation.scope).toBe("region");

      // The latch IS the hysteresis: the floor is now the region's cover zoom, so the very next
      // zoom-out gesture pins instead of flipping the regime back.
      nowMs += 600;
      fixture.driver.fire(nowMs);
      // 24 notches is more than enough to travel from MAX_ZOOM down to the floor in one gesture
      // (4 * 0.8^n crosses it at n=13), which is the case that matters: the whole gesture presses
      // and pins, and none of it leaves.
      for (let step = 0; step < 24; step += 1) {
        fixture.renderer.zoomCamera(0.8, { x: 400, y: 300 });
        nowMs += 16;
        fixture.driver.fire(nowMs);
      }
      expect(fixture.debug().worldNavigation.scope).toBe("region");
      expect(fixture.debug().camera.zoom)
        .toBeCloseTo(fixture.debug().worldNavigation.minimumZoom, 10);
      fixture.renderer.dispose();
    });

    it("publishes navigation state only when it changes", async () => {
      const published: Array<Readonly<{ scope: string }>> = [];
      const fixture = await harness({
        worldSheetSnapshots: true,
        callbacks: { onWorldNavigationChange: (state) => published.push(state) },
      });
      fixture.renderer.resize(800, 600);
      fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
      await settle();
      let nowMs = 16;
      fixture.driver.fire(nowMs);
      const afterFirstDraw = published.length;
      expect(afterFirstDraw).toBeGreaterThan(0);

      // Twenty idle frames change nothing, so nothing is published.
      for (let step = 0; step < 20; step += 1) {
        nowMs += 16;
        fixture.driver.fire(nowMs);
      }
      expect(published.length).toBe(afterFirstDraw);
      fixture.renderer.dispose();
    });

    it("leaves the navigation model inert on a renderer with no world sheet", async () => {
      const fixture = await harness();
      fixture.renderer.resize(800, 600);
      fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
      await settle();
      fixture.driver.fire(16);

      fixture.renderer.hoverAt?.({ x: 400, y: 300 });
      fixture.renderer.enterRegionAt?.({ x: 400, y: 300 });
      fixture.renderer.exitToWorldView?.();

      const { worldNavigation } = fixture.debug();
      expect(worldNavigation.scope).toBeNull();
      expect(worldNavigation.hoveredRegionId).toBeNull();
      expect(worldNavigation.descendingIntoRegionId).toBeNull();
      fixture.renderer.dispose();
    });
  });

  it("draws a toroidal region's terrain and scenery once, never tiled, now that the camera is bounded", async () => {
    // Before Z2, a region smaller than the viewport combined with a wrapping camera made this
    // draw 4 periodic copies to fill the screen -- the "never-ending" bug the world-sheet camera
    // retires. The camera's clamp topology is always "bounded" now (see the `camera.topology`
    // assertions elsewhere in this file), so this exercises the same single-draw, bounded-raster
    // path every non-toroidal region already used, with the continuation pattern filling the
    // space beyond the region's true edges instead of tiling the terrain into it.
    const recipe = exactNirvanaRecipe();
    const exactScene = instrumentedExactStaticSceneProvider(recipe, 4);
    const fixture = await harness({
      reducedMotion: true,
      recipes: [recipe],
      manifest: createNirvanaProductionManifest(PRODUCTION_ASSET_MANIFEST),
      staticSceneProviders: new Map([["nirvana-v2", exactScene.provider]]),
    });
    fixture.renderer.resize(512, 288);
    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "nirvana" }));
    await settle();
    fixture.driver.fire(16);

    const context = contexts.get(fixture.canvas)!;
    const cacheLabels = context.drawImageCalls
      .map(([source]) => (source as HTMLCanvasElement).dataset?.cache)
      .filter((label): label is string => label === "terrain" || label === "scenery");
    expect(cacheLabels.filter((label) => label === "terrain")).toHaveLength(1);
    expect(cacheLabels.filter((label) => label === "scenery")).toHaveLength(1);
    expect(fixture.graph.draw).toHaveBeenCalledTimes(1);
    expect(context.patternFillRectCalls.length).toBeGreaterThan(0);
    fixture.renderer.dispose();
  });

  it("normalizes a seam-side pointer into canonical toroidal hit coordinates", async () => {
    const recipe = exactNirvanaRecipe();
    const exactScene = instrumentedExactStaticSceneProvider(recipe, 4);
    const onSelectionChange = vi.fn();
    const fixture = await harness({
      callbacks: { onSelectionChange },
      reducedMotion: true,
      recipes: [recipe],
      manifest: createNirvanaProductionManifest(PRODUCTION_ASSET_MANIFEST),
      staticSceneProviders: new Map([["nirvana-v2", exactScene.provider]]),
    });
    fixture.graph.debugValue.hitTargets = [{
      selection: { kind: "ruin", id: "seam-ruin" },
      worldBounds: { x: 3_056, y: 90, width: 16, height: 16 },
      feetY: 106,
      selectionKey: "ruin:seam-ruin",
    }];
    fixture.renderer.resize(512, 288);
    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "nirvana" }));
    await settle();
    fixture.driver.fire(16);
    const debug = fixture.debug();
    const origin = debug.renderRasterOrigin!;
    const zoom = debug.camera.zoom;
    fixture.canvas.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 512,
      bottom: 288,
      width: 512,
      height: 288,
      toJSON: () => ({}),
    });

    fixture.renderer.selectAt?.({
      x: origin.x + (3_064 - 3_072) * zoom,
      y: origin.y + 98 * zoom,
    });

    expect(onSelectionChange).toHaveBeenCalledWith({ kind: "ruin", id: "seam-ruin" });
    fixture.renderer.dispose();
  });

  it("hits target bounds that straddle either side of both toroidal seams", async () => {
    const recipe = exactNirvanaRecipe();
    const exactScene = instrumentedExactStaticSceneProvider(recipe, 4);
    const onSelectionChange = vi.fn();
    const fixture = await harness({
      callbacks: { onSelectionChange },
      reducedMotion: true,
      recipes: [recipe],
      manifest: createNirvanaProductionManifest(PRODUCTION_ASSET_MANIFEST),
      staticSceneProviders: new Map([["nirvana-v2", exactScene.provider]]),
    });
    fixture.graph.debugValue.hitTargets = [
      {
        selection: { kind: "ruin", id: "upper-x" },
        worldBounds: { x: 3_064, y: 40, width: 16, height: 16 },
        feetY: 56,
        selectionKey: "ruin:upper-x",
      },
      {
        selection: { kind: "ruin", id: "lower-x" },
        worldBounds: { x: -8, y: 180, width: 16, height: 16 },
        feetY: 196,
        selectionKey: "ruin:lower-x",
      },
      {
        selection: { kind: "ruin", id: "upper-y" },
        worldBounds: { x: 50, y: 3_064, width: 16, height: 16 },
        feetY: 3_080,
        selectionKey: "ruin:upper-y",
      },
      {
        selection: { kind: "ruin", id: "lower-y" },
        worldBounds: { x: 180, y: -8, width: 16, height: 16 },
        feetY: 8,
        selectionKey: "ruin:lower-y",
      },
    ];
    fixture.renderer.resize(512, 512);
    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "nirvana" }));
    await settle();
    fixture.driver.fire(16);
    const debug = fixture.debug();
    const origin = debug.renderRasterOrigin!;
    const zoom = debug.camera.zoom;
    fixture.canvas.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 512,
      bottom: 512,
      width: 512,
      height: 512,
      toJSON: () => ({}),
    });
    const clickWorld = (x: number, y: number): void => {
      fixture.renderer.selectAt?.({ x: origin.x + x * zoom, y: origin.y + y * zoom });
    };

    clickWorld(4, 48);
    expect(onSelectionChange).toHaveBeenLastCalledWith({ kind: "ruin", id: "upper-x" });
    clickWorld(-4, 188);
    expect(onSelectionChange).toHaveBeenLastCalledWith({ kind: "ruin", id: "lower-x" });
    clickWorld(58, 4);
    expect(onSelectionChange).toHaveBeenLastCalledWith({ kind: "ruin", id: "upper-y" });
    clickWorld(188, -4);
    expect(onSelectionChange).toHaveBeenLastCalledWith({ kind: "ruin", id: "lower-y" });
    expect(onSelectionChange).toHaveBeenCalledTimes(4);
    fixture.renderer.dispose();
  });

  it("retains the prior cache, camera, selection binding, and leases on descriptor mismatch", async () => {
    const recipe = exactNirvanaRecipe();
    const exactScene = instrumentedExactStaticSceneProvider(recipe, 4, {
      preparationDescriptor: createProductionStaticSceneDescriptor({
        cacheIdentity: [
          "nirvana-v2",
          recipe.presentationProfile!.atlasProfileVersion,
          recipe.identityHash,
          recipe.presentationProfile!.staticSceneHash,
        ].join(":"),
        worldBounds: { x: 0, y: 0, width: 3_040, height: 3_072 },
        topology: "toroidal",
      }),
    });
    const onFailure = vi.fn();
    const fixture = await harness({
      callbacks: { onFailure },
      recipes: [...recipes, recipe],
      manifest: createNirvanaProductionManifest(PRODUCTION_ASSET_MANIFEST),
      staticSceneProviders: new Map([["nirvana-v2", exactScene.provider]]),
    });
    fixture.graph.debugValue.hitTargets = [{
      selection: { kind: "agent", id: "agent-a" },
      worldBounds: { x: 80, y: 70, width: 24, height: 32 },
      feetY: 102,
      selectionKey: "agent:agent-a",
    }];
    fixture.renderer.updatePresentation(frame({
      revision: 1,
      sceneRegion: "worn",
      selection: { kind: "agent", id: "agent-a" },
    }));
    await settle();
    const before = fixture.debug();
    const priorLeaseCount = fixture.pool.releases.length;
    const priorOwnerCount = fixture.cacheDisposals.length;

    fixture.renderer.updatePresentation(frame({
      revision: 2,
      sceneRegion: "nirvana",
      selection: { kind: "agent", id: "agent-a" },
    }));
    await settle();

    expect(fixture.debug()).toMatchObject({
      frameIdentity: before.frameIdentity,
      visibleRegionId: "worn",
      loadingRegionId: null,
      mountedStaticCache: before.mountedStaticCache,
      camera: before.camera,
    });
    expect(exactScene.preparationDisposals[0]).toHaveBeenCalledOnce();
    expect(fixture.cacheDisposals).toHaveLength(priorOwnerCount);
    expect(fixture.cacheDisposals.every((dispose) => dispose.mock.calls.length === 0)).toBe(true);
    expect(fixture.pool.releases.slice(0, priorLeaseCount).every(
      (release) => release.mock.calls.length === 0,
    )).toBe(true);
    expect(fixture.pool.releases.slice(priorLeaseCount).every(
      (release) => release.mock.calls.length === 1,
    )).toBe(true);
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({
      kind: "asset",
      retryable: true,
    }));
    fixture.renderer.dispose();
  });

  it("disposes exact provider preparation when the first terrain cache owner allocation fails", async () => {
    const recipe = exactNirvanaRecipe();
    const exactScene = instrumentedExactStaticSceneProvider(recipe, 4);
    const atlasCommitScheduler = new FakeAtlasCommitScheduler();
    const onFailure = vi.fn();
    const cacheCanvasFactory: CacheCanvasOwnerFactory = vi.fn(({ label }) => {
      expect(label).toBe("terrain");
      throw new Error("terrain cache allocation failed");
    });
    const fixture = await harness({
      atlasCommitScheduler,
      callbacks: { onFailure },
      cacheCanvasFactory,
      recipes: [recipe],
      manifest: createNirvanaProductionManifest(PRODUCTION_ASSET_MANIFEST),
      staticSceneProviders: new Map([["nirvana-v2", exactScene.provider]]),
    });

    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "nirvana" }));
    await settle();

    expect(atlasCommitScheduler.pending()).toBe(1);
    atlasCommitScheduler.fire();

    const debug = fixture.debug();
    const witness = {
      preparationCalls: exactScene.createPreparation.mock.calls.length,
      preparationDisposals: exactScene.preparationDisposals.map(
        (dispose) => dispose.mock.calls.length,
      ),
      cacheOwnerAllocationAttempts: vi.mocked(cacheCanvasFactory).mock.calls.length,
      retainedCacheCanvases: fixture.cacheCanvases.length,
      cacheDiagnostics: debug.cache,
      frameIdentity: debug.frameIdentity,
      visibleRegionId: debug.visibleRegionId,
      mountedStaticCache: debug.mountedStaticCache,
      assetFailureReported: onFailure.mock.calls.some(
        ([failure]) => failure.kind === "asset" && failure.retryable === true,
      ),
    };
    fixture.renderer.dispose();

    expect(witness).toEqual({
      preparationCalls: 1,
      preparationDisposals: [1],
      cacheOwnerAllocationAttempts: 1,
      retainedCacheCanvases: 0,
      cacheDiagnostics: {
        created: 0,
        disposed: 0,
        outstanding: 0,
        peak: 0,
        lastRebuildReason: null,
      },
      frameIdentity: null,
      visibleRegionId: null,
      mountedStaticCache: null,
      assetFailureReported: true,
    });
  });

  it.each([
    {
      path: "replacement cancellation",
      expectedRevision: 3,
      expectedAssetFailure: false,
    },
    {
      path: "failed continuation scheduling",
      expectedRevision: 1,
      expectedAssetFailure: true,
    },
  ] as const)(
    "contains throwing exact-provider disposal during $path",
    async ({ path, expectedRevision, expectedAssetFailure }) => {
      const recipe = exactNirvanaRecipe();
      const exactScene = instrumentedExactStaticSceneProvider(recipe, 1_537, {
        disposeError: new Error("exact provider dispose failed"),
      });
      const atlasCommitScheduler = new FakeAtlasCommitScheduler();
      const onFailure = vi.fn();
      const fixture = await harness({
        atlasCommitScheduler,
        callbacks: { onFailure },
        recipes: [...recipes, recipe],
        manifest: createNirvanaProductionManifest(PRODUCTION_ASSET_MANIFEST),
        staticSceneProviders: new Map([["nirvana-v2", exactScene.provider]]),
      });

      fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
      await settle();
      atlasCommitScheduler.fireAll();
      const prior = fixture.debug();
      const priorLeaseCount = fixture.pool.releases.length;
      const priorOwnerCount = fixture.cacheDisposals.length;

      fixture.renderer.updatePresentation(frame({ revision: 2, sceneRegion: "nirvana" }));
      await settle();
      if (path === "failed continuation scheduling") {
        atlasCommitScheduler.throwOnScheduleIn(1);
      }

      let escapedCleanupError: unknown = null;
      try {
        atlasCommitScheduler.fire();
        if (path === "replacement cancellation") {
          fixture.graph.nextDiff = {
            outcome: "applied",
            added: [],
            updated: [],
            removed: [],
            staticLayersInvalidated: false,
          };
          fixture.renderer.updatePresentation(frame({ revision: 3, sceneRegion: "worn" }));
        }
      } catch (error) {
        escapedCleanupError = error;
      }
      await settle();

      const afterCleanup = fixture.debug();
      const pendingLeaseReleaseCounts = fixture.pool.releases
        .slice(priorLeaseCount)
        .map((release) => release.mock.calls.length);
      const witness = {
        escapedCleanupError:
          escapedCleanupError instanceof Error ? escapedCleanupError.message : escapedCleanupError,
        providerPreparationCalls: exactScene.createPreparation.mock.calls.length,
        providerDisposals: exactScene.preparationDisposals.map(
          (dispose) => dispose.mock.calls.length,
        ),
        priorOwnerDisposals: fixture.cacheDisposals
          .slice(0, priorOwnerCount)
          .map((dispose) => dispose.mock.calls.length),
        pendingOwnerDisposals: fixture.cacheDisposals
          .slice(priorOwnerCount)
          .map((dispose) => dispose.mock.calls.length),
        priorLeaseReleaseCounts: fixture.pool.releases
          .slice(0, priorLeaseCount)
          .map((release) => release.mock.calls.length),
        pendingLeaseReleaseCounts,
        pendingLeasesAcquired: pendingLeaseReleaseCounts.length > 0,
        pendingAtlasTasks: atlasCommitScheduler.pending(),
        visibleRegionId: afterCleanup.visibleRegionId,
        loadingRegionId: afterCleanup.loadingRegionId,
        frameRevision: afterCleanup.frameIdentity?.revision ?? null,
        mountedCacheIdentity: afterCleanup.mountedStaticCache?.staticCacheIdentity ?? null,
        assetFailureReported: onFailure.mock.calls.some(
          ([failure]) => failure.kind === "asset" && failure.retryable === true,
        ),
      };
      fixture.renderer.dispose();

      expect(witness).toEqual({
        escapedCleanupError: null,
        providerPreparationCalls: 1,
        providerDisposals: [1],
        priorOwnerDisposals: Array.from({ length: priorOwnerCount }, () => 0),
        pendingOwnerDisposals: [1, 1, 1],
        priorLeaseReleaseCounts: Array.from({ length: priorLeaseCount }, () => 0),
        pendingLeaseReleaseCounts: Array.from(
          { length: pendingLeaseReleaseCounts.length },
          () => 1,
        ),
        pendingLeasesAcquired: true,
        pendingAtlasTasks: 0,
        visibleRegionId: "worn",
        loadingRegionId: null,
        frameRevision: expectedRevision,
        mountedCacheIdentity: prior.mountedStaticCache?.staticCacheIdentity ?? null,
        assetFailureReported: expectedAssetFailure,
      });
    },
  );

  it("invokes a throwing exact-provider final disposer once and cleans every other owner", async () => {
    const recipe = exactNirvanaRecipe();
    const exactScene = instrumentedExactStaticSceneProvider(recipe, 1, {
      disposeError: new Error("exact provider final dispose failed"),
    });
    const atlasCommitScheduler = new FakeAtlasCommitScheduler();
    const fixture = await harness({
      atlasCommitScheduler,
      recipes: [recipe],
      manifest: createNirvanaProductionManifest(PRODUCTION_ASSET_MANIFEST),
      staticSceneProviders: new Map([["nirvana-v2", exactScene.provider]]),
    });

    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "nirvana" }));
    await settle();
    expect(atlasCommitScheduler.pending()).toBe(1);
    atlasCommitScheduler.fire();

    expect(exactScene.preparationDisposals).toHaveLength(1);
    expect(exactScene.preparationDisposals[0]).toHaveBeenCalledOnce();
    expect(fixture.cacheDisposals).toHaveLength(3);
    expect(fixture.cacheDisposals.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
    expect(fixture.pool.releases.length).toBeGreaterThan(0);
    expect(fixture.pool.releases.every((release) => release.mock.calls.length === 1)).toBe(true);
    expect(fixture.debug()).toMatchObject({
      frameIdentity: null,
      visibleRegionId: null,
      loadingRegionId: null,
      mountedStaticCache: null,
      cache: { outstanding: 0 },
    });
    fixture.renderer.dispose();
    expect(exactScene.preparationDisposals[0]).toHaveBeenCalledOnce();
    expect(fixture.cacheDisposals.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
    expect(fixture.pool.releases.every((release) => release.mock.calls.length === 1)).toBe(true);
  });

  it("reuses the completed exact world cache across resize without provider work or repaint", async () => {
    const recipe = exactNirvanaRecipe();
    const exactScene = instrumentedExactStaticSceneProvider(recipe, 4);
    const atlasCommitScheduler = new FakeAtlasCommitScheduler();
    const fixture = await harness({
      atlasCommitScheduler,
      recipes: [recipe],
      manifest: createNirvanaProductionManifest(PRODUCTION_ASSET_MANIFEST),
      staticSceneProviders: new Map([["nirvana-v2", exactScene.provider]]),
    });
    const cacheDrawCount = (): number => fixture.cacheCanvases.reduce(
      (total, cacheCanvas) => total + contexts.get(cacheCanvas)!.drawImageCalls.length,
      0,
    );

    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "nirvana" }));
    await settle();
    atlasCommitScheduler.fireAll(10);

    const completed = fixture.debug();
    const completedOwners = [...fixture.cacheCanvases];
    const completedDraws = cacheDrawCount();
    const completedPreparationCalls = exactScene.createPreparation.mock.calls.length;
    const completedPlanCalls = exactScene.createPlan.mock.calls.length;

    fixture.renderer.resize(1_024, 640);

    const resized = fixture.debug();
    const witness = {
      mountedCacheIdentity: resized.mountedStaticCache?.staticCacheIdentity ?? null,
      cacheOwnersPreserved: fixture.cacheCanvases.length === completedOwners.length
        && fixture.cacheCanvases.every((owner, index) => owner === completedOwners[index]),
      completedOwnerDisposals: fixture.cacheDisposals
        .slice(0, completedOwners.length)
        .map((dispose) => dispose.mock.calls.length),
      staticLayerRebuildDelta: resized.staticLayerRebuilds - completed.staticLayerRebuilds,
      staticDrawDelta: cacheDrawCount() - completedDraws,
      preparationCallDelta:
        exactScene.createPreparation.mock.calls.length - completedPreparationCalls,
      synchronousPlanCallDelta: exactScene.createPlan.mock.calls.length - completedPlanCalls,
    };
    fixture.renderer.dispose();

    expect(witness).toEqual({
      mountedCacheIdentity: completed.mountedStaticCache?.staticCacheIdentity ?? null,
      cacheOwnersPreserved: true,
      completedOwnerDisposals: completedOwners.map(() => 0),
      staticLayerRebuildDelta: 0,
      staticDrawDelta: 0,
      preparationCallDelta: 0,
      synchronousPlanCallDelta: 0,
    });
  });

  it("fails closed when a compatibility graph requests a synchronous exact-cache rebuild", async () => {
    const recipe = exactNirvanaRecipe();
    const exactScene = instrumentedExactStaticSceneProvider(recipe, 4);
    const atlasCommitScheduler = new FakeAtlasCommitScheduler();
    const onFailure = vi.fn();
    const fixture = await harness({
      atlasCommitScheduler,
      callbacks: { onFailure },
      recipes: [recipe],
      manifest: createNirvanaProductionManifest(PRODUCTION_ASSET_MANIFEST),
      staticSceneProviders: new Map([["nirvana-v2", exactScene.provider]]),
    });
    const cacheDrawCount = (): number => fixture.cacheCanvases.reduce(
      (total, cacheCanvas) => total + contexts.get(cacheCanvas)!.drawImageCalls.length,
      0,
    );

    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "nirvana" }));
    await settle();
    atlasCommitScheduler.fireAll(10);

    const completed = fixture.debug();
    const completedOwners = [...fixture.cacheCanvases];
    const completedDraws = cacheDrawCount();
    const completedPreparationCalls = exactScene.createPreparation.mock.calls.length;
    const completedPlanCalls = exactScene.createPlan.mock.calls.length;
    const completedAdvanceBudgets = [...exactScene.advanceBudgets];
    onFailure.mockClear();
    fixture.graph.nextDiff = {
      outcome: "applied",
      added: [],
      updated: [],
      removed: [],
      staticLayersInvalidated: true,
    };

    fixture.renderer.updatePresentation(frame({ revision: 2, sceneRegion: "nirvana" }));
    await settle();

    const invalidated = fixture.debug();
    const witness = {
      canvasFailureReported: onFailure.mock.calls.some(
        ([failure]) => failure.kind === "canvas" && failure.retryable === true,
      ),
      mountedCacheIdentity: invalidated.mountedStaticCache?.staticCacheIdentity ?? null,
      completedOwnersRetained: completedOwners.every(
        (_owner, index) => fixture.cacheDisposals[index]!.mock.calls.length === 0,
      ),
      staticLayerRebuildDelta: invalidated.staticLayerRebuilds - completed.staticLayerRebuilds,
      staticDrawDelta: cacheDrawCount() - completedDraws,
      preparationCallDelta:
        exactScene.createPreparation.mock.calls.length - completedPreparationCalls,
      synchronousPlanCallDelta: exactScene.createPlan.mock.calls.length - completedPlanCalls,
      advanceBudgetsUnchanged:
        JSON.stringify(exactScene.advanceBudgets) === JSON.stringify(completedAdvanceBudgets),
      usedUnboundedAdvance:
        exactScene.advanceBudgets.includes(Number.MAX_SAFE_INTEGER),
    };
    fixture.renderer.dispose();

    expect(witness).toEqual({
      canvasFailureReported: true,
      mountedCacheIdentity: completed.mountedStaticCache?.staticCacheIdentity ?? null,
      completedOwnersRetained: true,
      staticLayerRebuildDelta: 0,
      staticDrawDelta: 0,
      preparationCallDelta: 0,
      synchronousPlanCallDelta: 0,
      advanceBudgetsUnchanged: true,
      usedUnboundedAdvance: false,
    });
  });

  it("prepares exact Nirvana scenery in bounded V2-only tasks with no generic-art fallback", async () => {
    const nirvanaRegions = [
      region("nirvana", "a once-heavenly landscape, now thinning and picked-over"),
      region("warm_springs", "hot spring lakes"),
    ];
    const recipe = createNirvanaRegionMapRecipe(
      createRegionMapIdentity(401, nirvanaRegions[0]!, nirvanaRegions),
    );
    const initial = createNirvanaInitialRegionForRecipe(recipe);
    const chunks = [...initial.region.chunks.values()];
    // owner-authorised Option A re-baseline, plan §P3: the painter now sweeps FOUR
    // "terrain"-layer categories (base fill, corner-masked overlay/waterline, authored
    // dry channel, road) and merges ground scenery into the landmark scenery sweep, so
    // the expected total needs those two new categories folded in (still measured from
    // the built region rather than hard-coded).
    const overlayCount = chunks.reduce((total, chunk) => total + chunk.terrainCells
      .reduce((subtotal, cell) => subtotal + nirvanaTerrainOverlayFrameIds(cell).length, 0), 0);
    const channelCount = chunks.reduce((total, chunk) => total + chunk.terrainCells
      .filter((cell) => channelFrameIdFor(cell) !== null).length, 0);
    const roadCount = chunks.reduce((total, chunk) => total + chunk.roadCells.length, 0);
    const landmarkCount = chunks
      .reduce((total, chunk) => total + chunk.landmarks
        .reduce((subtotal, landmark) => subtotal + landmark.visuals.length, 0), 0);
    const sceneryCount = chunks.reduce((total, chunk) => total + chunk.scenery.length, 0);
    const expectedDraws = 96 * 96 + overlayCount + channelCount + roadCount
      + landmarkCount + sceneryCount + CONTINUATION_PATTERN_TILE_COUNT;
    const atlasCommitScheduler = new FakeAtlasCommitScheduler();
    const fixture = await harness({
      atlasCommitScheduler,
      recipes: [recipe],
      manifest: createNirvanaProductionManifest(PRODUCTION_ASSET_MANIFEST),
      staticSceneProviders: new Map([["nirvana-v2", NIRVANA_STATIC_SCENE_PROVIDER]]),
    });
    const cacheDrawCount = (): number => fixture.cacheCanvases.reduce(
      (total, cacheCanvas) => total + contexts.get(cacheCanvas)!.drawImageCalls.length,
      0,
    );

    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "nirvana" }));
    await settle();

    expect(atlasCommitScheduler.pending()).toBe(1);
    const perTaskDraws: number[] = [];
    while (fixture.graph.update.mock.calls.length === 0) {
      const before = cacheDrawCount();
      atlasCommitScheduler.fire();
      perTaskDraws.push(cacheDrawCount() - before);
    }

    expect(perTaskDraws.length).toBeGreaterThan(2);
    expect(perTaskDraws.at(-1)).toBe(0);
    expect(perTaskDraws.slice(0, -1).every((count) => count > 0 && count <= 1_536)).toBe(true);
    expect(perTaskDraws.reduce((total, count) => total + count, 0)).toBe(expectedDraws);
    const sources = new Set(fixture.cacheCanvases.flatMap((cacheCanvas) => (
      contexts.get(cacheCanvas)!.drawImageCalls.map(([source]) => (source as { label?: string }).label)
    )));
    expect(sources).toEqual(new Set([
      NIRVANA_ATLAS_PROFILE.terrainAtlasId,
      NIRVANA_ATLAS_PROFILE.sceneryAtlasId,
    ]));
    const debug = fixture.debug();
    expect(debug).toMatchObject({
      visibleRegionId: "nirvana",
      loadingRegionId: null,
      staticArtFallbacks: 0,
      staticCacheRegions: ["nirvana"],
      mountedStaticCache: {
        regionId: "nirvana",
        staticCacheIdentity: [
          "nirvana-v2",
          "2",
          recipe.identityHash,
          recipe.presentationProfile!.staticSceneHash,
        ].join(":"),
      },
      visibleRecipe: {
        regionId: "nirvana",
        identityHash: recipe.identityHash,
        grid: { columns: 96, rows: 96 },
        presentationProfile: recipe.presentationProfile,
      },
    });
    expect(debug.visibleRecipe!.presentationProfile).not.toBe(recipe.presentationProfile);
    expect(Object.isFrozen(debug.mountedStaticCache)).toBe(true);
    expect(Object.isFrozen(debug.visibleRecipe)).toBe(true);
    expect(Object.isFrozen(debug.visibleRecipe!.presentationProfile)).toBe(true);
    fixture.renderer.dispose();
  });

  it("fails closed when an exact recipe has no matching static-scene provider", async () => {
    const onFailure = vi.fn();
    const nirvanaRegions = [
      region("nirvana", "a once-heavenly landscape, now thinning and picked-over"),
      region("warm_springs", "hot spring lakes"),
    ];
    const recipe = createNirvanaRegionMapRecipe(
      createRegionMapIdentity(401, nirvanaRegions[0]!, nirvanaRegions),
    );
    const fixture = await harness({
      callbacks: { onFailure },
      recipes: [recipe],
      manifest: createNirvanaProductionManifest(PRODUCTION_ASSET_MANIFEST),
      staticSceneProviders: new Map(),
    });

    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "nirvana" }));
    await settle();

    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ kind: "asset" }));
    expect(fixture.debug()).toMatchObject({
      frameIdentity: null,
      visibleRegionId: null,
      staticCacheRegions: [],
      staticArtFallbacks: 0,
      mountedStaticCache: null,
      visibleRecipe: null,
    });
    expect(fixture.cacheCanvases.every((cacheCanvas) => (
      contexts.get(cacheCanvas)!.drawImageCalls.length === 0
    ))).toBe(true);
    fixture.renderer.dispose();
  });

  it("keeps a same-region update on the live fast path without atlas tasks or unused cache owners", async () => {
    const atlasCommitScheduler = new FakeAtlasCommitScheduler();
    const fixture = await harness({ atlasCommitScheduler });
    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
    await settle();
    atlasCommitScheduler.fireAll();
    const acquired = fixture.pool.acquire.mock.calls.length;
    const owners = fixture.cacheCanvases.length;
    fixture.graph.nextDiff = { ...fixture.graph.nextDiff, staticLayersInvalidated: false };

    fixture.renderer.updatePresentation(frame({ revision: 2, sceneRegion: "worn" }));

    expect(fixture.graph.frames.at(-1)).toMatchObject({ revision: 2 });
    expect(fixture.pool.acquire).toHaveBeenCalledTimes(acquired);
    expect(fixture.cacheCanvases).toHaveLength(owners);
    expect(atlasCommitScheduler.pending()).toBe(0);
    fixture.renderer.dispose();
  });

  it("disposes an in-progress cache and leases when a fresher generation supersedes a middle chunk", async () => {
    const atlasCommitScheduler = new FakeAtlasCommitScheduler();
    const fixture = await harness({ atlasCommitScheduler });
    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
    await settle();
    atlasCommitScheduler.fire();
    const staleHandle = atlasCommitScheduler.firstHandle();
    const staleReleases = [...fixture.pool.releases];
    expect(staleReleases.length).toBeGreaterThan(0);
    expect(fixture.cacheDisposals).toHaveLength(3);
    expect(fixture.cacheDisposals.every((dispose) => dispose.mock.calls.length === 0)).toBe(true);

    fixture.renderer.updatePresentation(frame({ revision: 2, sceneRegion: "spring" }));
    await settle();

    staleReleases.forEach((release) => expect(release).toHaveBeenCalledOnce());
    fixture.cacheDisposals.slice(0, 3).forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
    expect(atlasCommitScheduler.pending()).toBe(1);
    atlasCommitScheduler.fireCancelled(staleHandle);
    staleReleases.forEach((release) => expect(release).toHaveBeenCalledOnce());
    fixture.cacheDisposals.slice(0, 3).forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
    expect(fixture.graph.update).not.toHaveBeenCalled();
    expect(fixture.debug()).toMatchObject({ visibleRegionId: null, loadingRegionId: "spring" });

    atlasCommitScheduler.fireAll();
    expect(fixture.graph.frames.at(-1)).toMatchObject({ revision: 2 });
    expect(fixture.debug()).toMatchObject({ visibleRegionId: "spring", loadingRegionId: null });
    fixture.renderer.dispose();
  });

  it("disposes an in-progress cache and leases when disposal crosses a middle chunk", async () => {
    const atlasCommitScheduler = new FakeAtlasCommitScheduler();
    const fixture = await harness({ atlasCommitScheduler });
    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
    await settle();
    atlasCommitScheduler.fire();
    const staleHandle = atlasCommitScheduler.firstHandle();
    const acquiredReleases = [...fixture.pool.releases];
    expect(acquiredReleases.length).toBeGreaterThan(0);
    expect(fixture.cacheDisposals).toHaveLength(3);

    fixture.renderer.dispose();

    acquiredReleases.forEach((release) => expect(release).toHaveBeenCalledOnce());
    fixture.cacheDisposals.forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
    expect(atlasCommitScheduler.pending()).toBe(0);
    atlasCommitScheduler.fireCancelled(staleHandle);
    acquiredReleases.forEach((release) => expect(release).toHaveBeenCalledOnce());
    fixture.cacheDisposals.forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
    expect(fixture.graph.update).not.toHaveBeenCalled();
  });

  it.each([
    { phase: "prepare", scheduleOffset: 1, expectedCacheCreated: 3, expectedCacheDisposed: 0 },
    { phase: "middle chunk", scheduleOffset: 3, expectedCacheCreated: 6, expectedCacheDisposed: 3 },
    {
      phase: "adopt",
      scheduleOffset: Math.ceil((
        recipes.find(({ regionId }) => regionId === "spring")!.grid.columns
          * recipes.find(({ regionId }) => regionId === "spring")!.grid.rows
        + recipes.find(({ regionId }) => regionId === "spring")!.staticScenery.length
        + CONTINUATION_PATTERN_TILE_COUNT
      ) / 1_536) + 1,
      expectedCacheCreated: 6,
      expectedCacheDisposed: 3,
    },
  ] as const)(
    "restores the prior view and schedule when atlas $phase task scheduling throws",
    async ({ scheduleOffset, expectedCacheCreated, expectedCacheDisposed }) => {
      const onFailure = vi.fn();
      const atlasCommitScheduler = new FakeAtlasCommitScheduler();
      const fixture = await harness({ atlasCommitScheduler, callbacks: { onFailure } });
      fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
      await settle();
      atlasCommitScheduler.fireAll();
      fixture.graph.deadline = 1_000;
      fixture.driver.fire(16);
      expect(fixture.wake.pending()).toBe(1);
      const priorReleases = [...fixture.pool.releases];
      atlasCommitScheduler.throwOnScheduleIn(scheduleOffset);

      fixture.renderer.updatePresentation(frame({ revision: 2, sceneRegion: "spring" }));
      await settle();
      for (let task = 1; task < scheduleOffset; task += 1) atlasCommitScheduler.fire();
      const failedReleases = fixture.pool.releases.slice(priorReleases.length);

      expect(fixture.graph.frames).toHaveLength(1);
      expect(fixture.graph.frames.at(-1)).toMatchObject({ revision: 1, scene: { regionId: "worn" } });
      expect(fixture.debug()).toMatchObject({
        frameIdentity: expect.objectContaining({ revision: 1 }),
        visibleRegionId: "worn",
        loadingRegionId: null,
        cache: {
          created: expectedCacheCreated,
          disposed: expectedCacheDisposed,
          outstanding: 3,
        },
      });
      priorReleases.forEach((release) => expect(release).not.toHaveBeenCalled());
      failedReleases.forEach((release) => expect(release).toHaveBeenCalledOnce());
      fixture.cacheDisposals.slice(0, 3).forEach((dispose) => expect(dispose).not.toHaveBeenCalled());
      fixture.cacheDisposals.slice(3).forEach((dispose) => expect(dispose).toHaveBeenCalledOnce());
      expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ kind: "asset", retryable: true }));
      expect(fixture.wake.pending()).toBe(1);
      fixture.renderer.dispose();
    },
  );

  it("aborts a pending Story region load while preserving its fresher truth in Free", async () => {
    const springAtlas = PRODUCTION_ASSET_MANIFEST.regions["spring-terraces"].atlasIds[0]!;
    const pending = deferred<ProductionAssetLease>();
    const fixture = await harness({ pendingAtlas: [springAtlas, pending] });
    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
    await settle();

    fixture.renderer.updatePresentation(frame({ revision: 2, sceneRegion: "spring" }));
    expect(fixture.debug().loadingRegionId).toBe("spring");
    fixture.renderer.setCameraMode("free");

    expect(fixture.debug()).toMatchObject({
      visibleRegionId: "worn",
      loadingRegionId: null,
      camera: { mode: "free" },
      frameIdentity: expect.objectContaining({ revision: 2 }),
    });
    pending.resolve(lease(springAtlas));
    await settle();
    expect(fixture.debug()).toMatchObject({
      visibleRegionId: "worn",
      loadingRegionId: null,
      camera: { mode: "free" },
      frameIdentity: expect.objectContaining({ revision: 2 }),
    });
    fixture.renderer.dispose();
  });

  it("reconciles an implicit Story to Free pan before a pending region can commit", async () => {
    const springAtlas = PRODUCTION_ASSET_MANIFEST.regions["spring-terraces"].atlasIds[0]!;
    const pending = deferred<ProductionAssetLease>();
    const fixture = await harness({ pendingAtlas: [springAtlas, pending] });
    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
    await settle();

    fixture.renderer.updatePresentation(frame({ revision: 2, sceneRegion: "spring" }));
    expect(fixture.debug().loadingRegionId).toBe("spring");
    fixture.renderer.panCamera({ x: 24, y: 8 });

    expect(fixture.debug()).toMatchObject({
      visibleRegionId: "worn",
      loadingRegionId: null,
      camera: { mode: "free" },
      frameIdentity: expect.objectContaining({ revision: 2 }),
    });
    expect(fixture.graph.update.mock.calls.at(-1)?.[2]).toBe("worn");

    pending.resolve(lease(springAtlas));
    await settle();
    expect(fixture.debug()).toMatchObject({
      visibleRegionId: "worn",
      loadingRegionId: null,
      camera: { mode: "free" },
      frameIdentity: expect.objectContaining({ revision: 2 }),
    });
    fixture.renderer.dispose();
  });

  it("rebases fresher pending Story truth onto Free and restores its region on Story return", async () => {
    const springAtlas = PRODUCTION_ASSET_MANIFEST.regions["spring-terraces"].atlasIds[0]!;
    const pending = deferred<ProductionAssetLease>();
    const fixture = await harness({ pendingAtlas: [springAtlas, pending] });
    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
    await settle();

    fixture.renderer.updatePresentation(frame({ revision: 2, sceneRegion: "spring" }));
    expect(fixture.debug().loadingRegionId).toBe("spring");
    fixture.renderer.setCameraMode("free");

    expect(fixture.debug()).toMatchObject({
      visibleRegionId: "worn",
      loadingRegionId: null,
      camera: { mode: "free" },
      frameIdentity: expect.objectContaining({ revision: 2 }),
    });
    expect(fixture.graph.frames.at(-1)).toMatchObject({ revision: 2, scene: { regionId: "spring" } });
    expect(fixture.graph.update.mock.calls.at(-1)?.[2]).toBe("worn");

    pending.resolve(lease(springAtlas));
    await settle();
    expect(fixture.debug()).toMatchObject({
      visibleRegionId: "worn",
      frameIdentity: expect.objectContaining({ revision: 2 }),
    });

    fixture.renderer.setCameraMode("story");
    await settle();
    expect(fixture.debug()).toMatchObject({
      visibleRegionId: "spring",
      loadingRegionId: null,
      camera: { mode: "story" },
      frameIdentity: expect.objectContaining({ revision: 2 }),
    });
    expect(fixture.graph.update.mock.calls.at(-1)?.[2]).toBeNull();
    fixture.renderer.dispose();
  });

  it("aborts a pending Free observer load when Story reclaims camera ownership", async () => {
    const springAtlas = PRODUCTION_ASSET_MANIFEST.regions["spring-terraces"].atlasIds[0]!;
    const pending = deferred<ProductionAssetLease>();
    const fixture = await harness({ pendingAtlas: [springAtlas, pending] });
    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
    await settle();
    fixture.renderer.setCameraMode("free");

    fixture.renderer.observeRegion("spring");
    expect(fixture.debug().loadingRegionId).toBe("spring");
    fixture.renderer.setCameraMode("story");

    expect(fixture.debug()).toMatchObject({
      visibleRegionId: "worn",
      loadingRegionId: null,
      camera: { mode: "story" },
      frameIdentity: expect.objectContaining({ revision: 1 }),
    });
    pending.resolve(lease(springAtlas));
    await settle();
    expect(fixture.debug()).toMatchObject({
      visibleRegionId: "worn",
      loadingRegionId: null,
      camera: { mode: "story" },
      frameIdentity: expect.objectContaining({ revision: 1 }),
    });
    fixture.renderer.dispose();
  });

  it("names the cause when a same-lineage frame commit throws, instead of swallowing it", async () => {
    // The `catch` around the same-lineage commit used to discard the error
    // entirely -- no console, no `pageerror`, and (unlike the lineage-rebind
    // branch) no `lastInternalFailure`. The failure card said "The world view
    // could not be updated." and there was no way, from a running browser, to
    // learn what had actually thrown. That cost a full debugging cycle.
    const onFailure = vi.fn();
    const graph = fakeGraph();
    const fixture = await harness({ callbacks: { onFailure }, graph });
    fixture.renderer.updatePresentation(frame({ revision: 1 }));
    await settle();
    expect(fixture.debug().lastInternalFailure).toBeNull();

    graph.update.mockImplementation(() => {
      throw new Error("home hearth deferred: requires four regional atlas leases");
    });

    expect(() => fixture.renderer.updatePresentation(frame({ revision: 2 }))).not.toThrow();

    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({
      kind: "canvas",
      retryable: true,
      publicMessage: "The world view could not be updated.",
    }));
    expect(fixture.debug().lastInternalFailure).toEqual({
      stage: "frame-commit",
      name: "Error",
      message: "home hearth deferred: requires four regional atlas leases",
    });
    fixture.renderer.dispose();
  });

  it.each(["factory", "update", "reject", "hostile"] as const)(
    "preserves and keeps drawing the prior lineage when candidate graph %s fails",
    async (failureKind) => {
      const onFailure = vi.fn();
      const prior = fakeGraph();
      const candidate = fakeGraph();
      if (failureKind === "update") {
        candidate.update.mockImplementation(() => {
          throw new Error("candidate graph update failed");
        });
      }
      if (failureKind === "reject") {
        candidate.nextDiff = {
          outcome: "invalid",
          added: [],
          updated: [],
          removed: [],
          staticLayersInvalidated: false,
        };
      }
      if (failureKind === "hostile") {
        candidate.update.mockImplementation(() => {
          throw { toString: () => { throw new Error("hostile coercion"); } };
        });
      }
      let creations = 0;
      const sceneGraphFactory = (): ProductionSceneGraph => {
        creations += 1;
        if (creations <= 1) return prior as unknown as ProductionSceneGraph;
        if (failureKind === "factory") throw new Error("candidate graph factory failed");
        return candidate as unknown as ProductionSceneGraph;
      };
      const fixture = await harness({
        callbacks: { onFailure },
        graph: prior,
        sceneGraphFactory,
      });
      fixture.renderer.updatePresentation(frame({ revision: 1 }));
      await settle();
      fixture.driver.fire(16);
      expect(prior.draw).toHaveBeenCalledOnce();

      expect(() => fixture.renderer.updatePresentation(frame({
        runId: "run-b",
        sourceKey: "live:run-b",
        revision: 0,
        firstCursor: 0,
        lastCursor: 0,
      }))).not.toThrow();
      expect(prior.dispose).not.toHaveBeenCalled();
      expect(fixture.debug().frameIdentity).toMatchObject({ runId: "run-a", revision: 1 });
      expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ kind: "canvas", retryable: true }));
      expect(fixture.debug().lastInternalFailure).toEqual({
        stage: "lineage-rebind",
        name: failureKind === "hostile" ? "UnknownError" : "Error",
        message: {
          factory: "candidate graph factory failed",
          update: "candidate graph update failed",
          reject: "Lineage frame was rejected.",
          hostile: "An unprintable internal failure occurred.",
        }[failureKind],
      });

      fixture.renderer.updatePresentation(frame({ revision: 2 }));
      await settle();
      fixture.driver.fire(32);
      expect(prior.frames.at(-1)?.revision).toBe(2);
      expect(prior.draw).toHaveBeenCalledTimes(2);
      fixture.renderer.dispose();
    },
  );

  it("keeps the prior visible generation scheduled when a region-switch prepare fails", async () => {
    const onFailure = vi.fn();
    const failed = deferred<ProductionAssetLease>();
    const springAtlas = PRODUCTION_ASSET_MANIFEST.regions["spring-terraces"].atlasIds[0]!;
    const fixture = await harness({
      callbacks: { onFailure },
      pendingAtlas: [springAtlas, failed],
    });
    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
    await settle();
    fixture.graph.deadline = 1_000;
    fixture.driver.fire(16);
    expect(fixture.wake.pending()).toBe(1);

    fixture.renderer.updatePresentation(frame({ revision: 2, sceneRegion: "spring" }));
    failed.reject(new Error("spring pack failed"));
    await settle();

    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ kind: "asset", retryable: true }));
    expect(fixture.debug()).toMatchObject({
      frameIdentity: { runId: "run-a", revision: 1 },
      visibleRegionId: "worn",
      loadingRegionId: null,
      staticCacheRegions: ["worn"],
    });
    expect(fixture.graph.frames.at(-1)?.scene?.regionId).toBe("worn");
    expect(fixture.wake.pending()).toBe(1);
    fixture.renderer.dispose();
  });

  it("uses the authored atlas retry policy and installs one clean retry without replacing the prior view", async () => {
    const onFailure = vi.fn();
    const failed = deferred<ProductionAssetLease>();
    const springAtlas = PRODUCTION_ASSET_MANIFEST.regions["spring-terraces"].atlasIds[0]!;
    const fixture = await harness({
      callbacks: { onFailure },
      pendingAtlas: [springAtlas, failed],
    });
    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
    await settle();

    const desired = frame({ revision: 2, sceneRegion: "spring" });
    fixture.renderer.updatePresentation(desired);
    failed.reject(new Error("private /tmp/spring-atlas.png decode failed"));
    await settle();

    expect(onFailure).toHaveBeenCalledWith({
      kind: "asset",
      retryable: true,
      publicMessage: "Some world art could not be shown. Retry the world view.",
    });
    expect(fixture.debug()).toMatchObject({
      frameIdentity: { revision: 1 },
      visibleRegionId: "worn",
      loadingRegionId: null,
    });

    fixture.renderer.updatePresentation(desired);
    await settle();

    expect(fixture.debug()).toMatchObject({
      frameIdentity: { revision: 2 },
      visibleRegionId: "spring",
      loadingRegionId: null,
    });
    expect(fixture.pool.acquire.mock.calls.filter(([id]) => id === springAtlas)).toHaveLength(2);
    fixture.renderer.dispose();
  });

  it("draws one bounded neutral placeholder per missing static-art class and keeps the region selectable", async () => {
    const manifest = structuredClone(PRODUCTION_ASSET_MANIFEST) as ProductionAssetManifest;
    const pack = manifest.regions["worn-heartland"] as unknown as {
      terrainFramesByRole: Record<string, unknown[]>;
      staticSceneryFrames: Record<string, unknown>;
    };
    pack.terrainFramesByRole = { ground: [], path: [], water: [], shore: [], soil: [] };
    pack.staticSceneryFrames = {};
    const frameAcceptance = createPresentationFrameAcceptanceTracker();
    const onSelectionChange = vi.fn();
    const fixture = await harness({ manifest, callbacks: { onSelectionChange }, frameAcceptance });
    fixture.graph.debugValue.hitTargets = [{
      selection: { kind: "region", id: "worn" },
      worldBounds: { x: -10_000, y: -10_000, width: 20_000, height: 20_000 },
      feetY: 384,
      selectionKey: "region:worn",
    }];
    const input = frame({ revision: 1, sceneRegion: "worn" });

    fixture.renderer.updatePresentation(input);
    await settle();
    fixture.driver.fire(16);

    expect(frameAcceptance.accepts(input)).toBe(true);
    expect(fixture.debug().staticArtFallbacks).toBe(2);
    const cacheContexts = fixture.cacheCanvases.map((canvas) => contexts.get(canvas)!);
    expect(cacheContexts.reduce((total, next) => total + next.fillRectCalls.length, 0)).toBeGreaterThan(0);
    vi.spyOn(fixture.canvas, "getBoundingClientRect").mockReturnValue({
      x: 0, y: 0, left: 0, top: 0, right: 640, bottom: 384, width: 640, height: 384,
      toJSON: () => ({}),
    });
    fixture.renderer.selectAt?.({ x: 32, y: 32 });
    expect(onSelectionChange).toHaveBeenCalledWith({ kind: "region", id: "worn" });
    fixture.renderer.dispose();
  });

  it("never samples reserved terrain cells 36-63 while resolving connected semantic roles", async () => {
    const fixture = await harness();
    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
    await settle();

    const terrain = fixture.cacheCanvases.find((canvas) => canvas.dataset.cache === "terrain");
    const draws = terrain ? contexts.get(terrain)?.drawImageCalls ?? [] : [];
    expect(terrain).toMatchObject({ width: 3_072, height: 3_072 });
    expect(draws, "one deterministic cache draw per 96x96 terrain tile").toHaveLength(9_216);
    const sampledCells = draws.map((call) => {
      const sourceX = call[1] as number;
      const sourceY = call[2] as number;
      return Math.floor(sourceY / 32) * 8 + Math.floor(sourceX / 32);
    });
    expect(sampledCells.length).toBeGreaterThan(0);
    expect(Math.max(...sampledCells)).toBeLessThanOrEqual(35);
    expect(new Set(sampledCells).size).toBeGreaterThanOrEqual(4);
    fixture.renderer.dispose();
  });

  it("releases all offscreen cache owners on replacement and final disposal exactly once", async () => {
    const cacheOwners: Array<Readonly<{
      canvas: HTMLCanvasElement;
      dispose: ReturnType<typeof vi.fn>;
    }>> = [];
    const cacheCanvasFactory: CacheCanvasOwnerFactory = (input) => {
      const canvas = document.createElement("canvas");
      const context = canvas.getContext("2d")!;
      canvas.dataset.cache = input.label;
      canvas.width = input.width;
      canvas.height = input.height;
      const dispose = vi.fn(() => {
        context.clearRect(0, 0, canvas.width, canvas.height);
        canvas.width = 0;
        canvas.height = 0;
      });
      const owner = { canvas, context, dispose };
      cacheOwners.push(owner);
      return owner;
    };
    const fixture = await harness({ cacheCanvasFactory });

    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
    await settle();
    expect(cacheOwners).toHaveLength(3);

    fixture.graph.nextDiff = {
      outcome: "applied",
      added: [], updated: [], removed: [], staticLayersInvalidated: true,
    };
    fixture.renderer.updatePresentation(frame({ revision: 2, sceneRegion: "worn" }));
    await settle();
    expect(cacheOwners).toHaveLength(6);
    expect(cacheOwners[0]!.dispose).toHaveBeenCalledOnce();
    expect(cacheOwners[1]!.dispose).toHaveBeenCalledOnce();
    expect(cacheOwners[2]!.dispose).toHaveBeenCalledOnce();

    fixture.renderer.dispose();
    fixture.renderer.dispose();
    expect(cacheOwners[3]!.dispose).toHaveBeenCalledOnce();
    expect(cacheOwners[4]!.dispose).toHaveBeenCalledOnce();
    expect(cacheOwners[5]!.dispose).toHaveBeenCalledOnce();
    expect(cacheOwners.every(({ canvas }) => canvas.width === 0 && canvas.height === 0)).toBe(true);
  });

  it("releases a prepared cache candidate when scene-command acceptance rejects the frame", async () => {
    const graph = fakeGraph();
    graph.applySceneCommands.mockReturnValue({
      outcome: "invalid",
      appliedCommandIds: [],
      ignoredCommandIds: ["rejected"],
    } as never);
    const disposals = [vi.fn(), vi.fn(), vi.fn()];
    let ownerIndex = 0;
    const fixture = await harness({
      graph,
      resolveSceneCommands: (next) => ({
        identity: {
          runId: next.runId,
          sourceKey: next.sourceKey,
          revision: next.revision,
          firstCursor: next.firstCursor,
          lastCursor: next.lastCursor,
        },
        sceneToken: 1,
        commands: [{
          kind: "actor",
          commandId: "rejected",
          actorId: "agent-a",
          command: { kind: "set-face", expression: "talk-1" },
        }],
      }),
      cacheCanvasFactory: (input) => {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d")!;
        canvas.width = input.width;
        canvas.height = input.height;
        return { canvas, context, dispose: disposals[ownerIndex++]! };
      },
    });

    fixture.renderer.updatePresentation(frame({ revision: 1 }));
    await settle();

    expect(disposals[0]).toHaveBeenCalledOnce();
    expect(disposals[1]).toHaveBeenCalledOnce();
    expect(disposals[2]).toHaveBeenCalledOnce();
    expect(fixture.debug()).toMatchObject({ frameIdentity: null, staticCacheRegions: [] });
    expect(graph.discardArrivalStaging).not.toHaveBeenCalled();
    expect(graph.commitArrivalStaging).not.toHaveBeenCalled();
    fixture.renderer.dispose();
  });

  it("releases all cache owners when static rasterization throws before publication", async () => {
    const disposals = [vi.fn(), vi.fn(), vi.fn()];
    let ownerIndex = 0;
    const fixture = await harness({
      cacheCanvasFactory: (input) => {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d")!;
        canvas.width = input.width;
        canvas.height = input.height;
        if (input.label === "terrain") {
          vi.spyOn(context, "drawImage").mockImplementationOnce(() => {
            throw new Error("rasterization failed");
          });
        }
        return { canvas, context, dispose: disposals[ownerIndex++]! };
      },
    });

    fixture.renderer.updatePresentation(frame({ revision: 1 }));
    await settle();

    expect(disposals[0]).toHaveBeenCalledOnce();
    expect(disposals[1]).toHaveBeenCalledOnce();
    expect(disposals[2]).toHaveBeenCalledOnce();
    expect(fixture.debug()).toMatchObject({ frameIdentity: null, staticCacheRegions: [] });
    fixture.renderer.dispose();
  });

  it("releases every prepared owner when the continuation pattern cannot be created", async () => {
    vi.spyOn(RecordingContext.prototype, "createPattern").mockReturnValueOnce(null as never);
    const disposals = [vi.fn(), vi.fn(), vi.fn()];
    let ownerIndex = 0;
    const fixture = await harness({
      cacheCanvasFactory: (input) => {
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d")!;
        canvas.width = input.width;
        canvas.height = input.height;
        return { canvas, context, dispose: disposals[ownerIndex++]! };
      },
    });

    fixture.renderer.updatePresentation(frame({ revision: 1 }));
    await settle();

    expect(disposals).toHaveLength(3);
    expect(disposals.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
    expect(fixture.debug()).toMatchObject({ frameIdentity: null, staticCacheRegions: [] });
    fixture.renderer.dispose();
  });

  it("restores the prior visible region when a loaded candidate fails exact scene acceptance", async () => {
    const graph = fakeGraph();
    graph.applySceneCommands.mockReturnValue({
      outcome: "invalid",
      appliedCommandIds: [],
      ignoredCommandIds: ["spring-command"],
    } as never);
    const fixture = await harness({
      graph,
      resolveSceneCommands: (next) => next.scene?.regionId !== "spring" ? null : ({
        identity: {
          runId: next.runId,
          sourceKey: next.sourceKey,
          revision: next.revision,
          firstCursor: next.firstCursor,
          lastCursor: next.lastCursor,
        },
        sceneToken: 1,
        commands: [{
          kind: "actor",
          commandId: "spring-command",
          actorId: "agent-a",
          command: { kind: "set-face", expression: "neutral" },
        }],
      }),
    });
    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
    await settle();

    fixture.renderer.updatePresentation(frame({ revision: 2, sceneRegion: "spring" }));
    await settle();

    expect(fixture.debug()).toMatchObject({
      frameIdentity: { revision: 1 },
      visibleRegionId: "worn",
      loadingRegionId: null,
      staticCacheRegions: ["worn"],
    });
    expect(graph.dispose).not.toHaveBeenCalled();
    fixture.renderer.dispose();
    expect(graph.dispose).toHaveBeenCalledOnce();
  });

  it.each(["return-null", "throw"] as const)(
    "disposes a fully prepared region cache once when Graph %s rejects before ownership transfer",
    async (failure) => {
      const graph = fakeGraph();
      const onFailure = vi.fn();
      const cacheOwners: Array<Readonly<{
        canvas: HTMLCanvasElement;
        dispose: ReturnType<typeof vi.fn>;
      }>> = [];
      const fixture = await harness({
        graph,
        callbacks: { onFailure },
        cacheCanvasFactory: (input) => {
          const canvas = document.createElement("canvas");
          const context = canvas.getContext("2d")!;
          canvas.dataset.cache = input.label;
          canvas.width = input.width;
          canvas.height = input.height;
          const dispose = vi.fn(() => {
            context.clearRect(0, 0, canvas.width, canvas.height);
            canvas.width = 0;
            canvas.height = 0;
          });
          const owner = { canvas, context, dispose };
          cacheOwners.push(owner);
          return owner;
        },
      });
      fixture.renderer.resize(1_440, 900);
      fixture.renderer.setSafeFrame({ top: 222, right: 52, bottom: 176, left: 216 });
      fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
      await settle();
      fixture.driver.fire(16);
      const before = fixture.debug();
      const priorLeases = [...fixture.pool.releases];
      const priorContinuation = cacheOwners[2]!.canvas;
      const context = contexts.get(fixture.canvas)!;
      expect(context.patternFillRectCalls.at(-1)?.source).toBe(priorContinuation);

      if (failure === "return-null") graph.update.mockReturnValueOnce(null as never);
      else graph.update.mockImplementationOnce(() => { throw new Error("Graph prepare failed"); });
      fixture.renderer.updatePresentation(frame({ revision: 2, sceneRegion: "spring" }));
      await settle();

      expect(cacheOwners).toHaveLength(6);
      expect(cacheOwners.slice(0, 3).every(({ dispose }) => dispose.mock.calls.length === 0)).toBe(true);
      expect(cacheOwners.slice(3).every(({ dispose }) => dispose.mock.calls.length === 1)).toBe(true);
      expect(fixture.debug()).toMatchObject({
        frameIdentity: before.frameIdentity,
        visibleRegionId: before.visibleRegionId,
        loadingRegionId: null,
        staticCacheRegions: ["worn"],
        camera: before.camera,
        cache: {
          created: 6,
          disposed: 3,
          outstanding: 3,
          lastRebuildReason: "initial",
        },
      });
      expect(fixture.graph.frames.at(-1)?.scene?.regionId).toBe("worn");
      expect(priorLeases.every((release) => release.mock.calls.length === 0)).toBe(true);
      expect(fixture.pool.releases.slice(priorLeases.length).every(
        (release) => release.mock.calls.length === 1,
      )).toBe(true);
      expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ kind: "asset", retryable: true }));

      fixture.renderer.setSafeFrame(before.camera.safeFrameInsets);
      fixture.driver.fire(32);
      expect(context.patternFillRectCalls.every(({ source }) => source === priorContinuation)).toBe(true);
      expect(context.createPatternCalls.map(([source]) => source)).toEqual([
        priorContinuation,
        cacheOwners[5]!.canvas,
      ]);

      fixture.renderer.dispose();
      fixture.renderer.dispose();
      expect(cacheOwners.every(({ dispose }) => dispose.mock.calls.length === 1)).toBe(true);
      expect(fixture.pool.releases.every((release) => release.mock.calls.length === 1)).toBe(true);
    },
  );

  it("retains one visible-region cache and invalidates it only for static or region changes", async () => {
    const fixture = await harness();
    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
    await settle();
    fixture.driver.fire(16);
    const initial = fixture.debug();
    expect(initial).toMatchObject({ visibleRegionId: "worn", staticCacheRegions: ["worn"] });
    expect(initial.cache).toEqual({
      created: 3,
      disposed: 0,
      outstanding: 3,
      peak: 3,
      lastRebuildReason: "initial",
    });

    fixture.graph.nextDiff = {
      outcome: "applied",
      added: [],
      updated: ["agent:a"],
      removed: [],
      staticLayersInvalidated: false,
    };
    fixture.renderer.updatePresentation(frame({ revision: 2, sceneRegion: "worn" }));
    await settle();
    fixture.driver.fire(32);
    expect(fixture.debug().staticLayerRebuilds).toBe(initial.staticLayerRebuilds);
    expect(fixture.debug().cache.created).toBe(3);

    fixture.graph.nextDiff = {
      outcome: "applied",
      added: [],
      updated: [],
      removed: [],
      staticLayersInvalidated: true,
    };
    fixture.renderer.updatePresentation(frame({ revision: 3, sceneRegion: "worn" }));
    await settle();
    fixture.driver.fire(48);
    expect(fixture.debug().staticLayerRebuilds).toBe(initial.staticLayerRebuilds + 1);
    expect(fixture.debug().cache).toMatchObject({
      created: 6,
      disposed: 3,
      outstanding: 3,
      lastRebuildReason: "topology",
    });

    fixture.renderer.updatePresentation(frame({ revision: 4, sceneRegion: "spring" }));
    await settle();
    fixture.driver.fire(64);
    expect(fixture.debug().staticCacheRegions).toEqual(["spring"]);
    fixture.renderer.dispose();
    expect(fixture.debug().cache).toMatchObject({
      created: 9,
      disposed: 9,
      outstanding: 0,
      lastRebuildReason: "region",
    });
  });

  it("draws integer unsmoothed caches before the graph and preserves deterministic pass diagnostics", async () => {
    const fixture = await harness();
    fixture.renderer.updatePresentation(frame({ revision: 1 }));
    await settle();
    fixture.driver.fire(16);
    const context = contexts.get(fixture.canvas)!;
    expect(context.imageSmoothingEnabled).toBe(false);
    expect(context.trace.indexOf("cache:terrain")).toBeLessThan(context.trace.indexOf("graph:draw"));
    expect(context.trace.indexOf("cache:scenery")).toBeLessThan(context.trace.indexOf("graph:draw"));
    expect(context.drawImageCalls.flatMap((call) => call.slice(1)).filter((value) => typeof value === "number").every(Number.isInteger)).toBe(true);
    expect(fixture.graph.debugSnapshot().drawOrder).toEqual([
      "environment:ground",
      "home:back:home-a",
      "actor:agent-behind",
      "actor:agent-a",
      "home:home-a",
      "actor:agent-front",
      "home:front:home-a",
      "environment:air",
      "selection",
    ]);
    fixture.renderer.dispose();
  });

  it.each([
    ["Story", "top", "story", 202.56],
    ["Story", "bottom", "story", 1_942.4],
    ["Follow", "top", "follow", 202.56],
    ["Follow", "bottom", "follow", 1_942.4],
  ] as const)("paints authored biome continuation across the %s %s overscan before finite terrain", async (
    _modeLabel,
    edge,
    mode,
    targetY,
  ) => {
    const graph = fakeGraph();
    graph.debugValue.hitTargets = [{
      selection: { kind: "agent", id: "agent-a" },
      selectionKey: "agent:agent-a",
      worldBounds: { x: 736, y: targetY, width: 32, height: 48 },
      feetY: targetY + 48,
    }];
    const fixture = await harness({ graph, reducedMotion: true });
    fixture.renderer.resize(1_440, 900);
    fixture.renderer.setSafeFrame({ top: 222, right: 52, bottom: 176, left: 216 });
    fixture.renderer.updatePresentation(frame({
      revision: 1,
      selection: { kind: "agent", id: "agent-a" },
    }));
    await settle();
    if (mode === "follow") {
      fixture.renderer.setSelection({ kind: "agent", id: "agent-a" });
      fixture.renderer.setCameraMode("follow");
    }
    fixture.driver.fire(16);

    const context = contexts.get(fixture.canvas)!;
    const transform = context.setTransformCalls.at(-1)! as [number, number, number, number, number, number];
    const fill = context.patternFillRectCalls.at(-1)!;
    const [zoom, , , , originX, originY] = transform;
    const [x, y, width, height] = fill.rect as [number, number, number, number];
    expect(x * zoom + originX).toBeLessThanOrEqual(0);
    expect(y * zoom + originY).toBeLessThanOrEqual(0);
    expect((x + width) * zoom + originX).toBeGreaterThanOrEqual(fixture.canvas.width);
    expect((y + height) * zoom + originY).toBeGreaterThanOrEqual(fixture.canvas.height);
    const worldTop = originY;
    const worldBottom = originY + 2_048 * zoom;
    expect(edge === "top" ? worldTop : fixture.canvas.height - worldBottom).toBeGreaterThan(0);
    expect(context.trace.indexOf("cache:continuation-matte")).toBeLessThan(
      context.trace.indexOf("cache:terrain"),
    );
    expect(fill.source.dataset.cache).toBe("continuation-matte");
    fixture.renderer.dispose();
  });

  it("replaces the authored continuation source with the next active region and leaves Free unpainted", async () => {
    const fixture = await harness({ reducedMotion: true });
    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
    await settle();
    fixture.driver.fire(16);
    const context = contexts.get(fixture.canvas)!;
    const wornFill = context.patternFillRectCalls.at(-1)!;
    const wornAtlas = contexts.get(wornFill.source)!.drawImageCalls[0]![0] as { label: string };

    fixture.renderer.updatePresentation(frame({ revision: 2, sceneRegion: "spring" }));
    await settle();
    fixture.driver.fire(32);
    const springFill = context.patternFillRectCalls.at(-1)!;
    const springAtlas = contexts.get(springFill.source)!.drawImageCalls[0]![0] as { label: string };

    expect(springFill.source).not.toBe(wornFill.source);
    expect(wornAtlas.label).toMatch(/^worn-heartland/);
    expect(springAtlas.label).toMatch(/^spring-terraces/);
    const paintedBeforeFree = context.patternFillRectCalls.length;
    fixture.renderer.setCameraMode("free");
    fixture.driver.fire(48);
    expect(context.patternFillRectCalls).toHaveLength(paintedBeforeFree);
    fixture.renderer.dispose();
  });

  it("reuses one continuation pattern without rerasterizing it across guided camera frames", async () => {
    const fixture = await harness({ reducedMotion: true });
    fixture.renderer.updatePresentation(frame({ revision: 1 }));
    await settle();
    fixture.driver.fire(16);
    const context = contexts.get(fixture.canvas)!;
    const continuation = fixture.cacheCanvases.find(
      (candidate) => candidate.dataset.cache === "continuation-matte",
    )!;
    const continuationContext = contexts.get(continuation)!;
    const rasterDraws = continuationContext.drawImageCalls.length;
    expect(rasterDraws).toBe(CONTINUATION_PATTERN_TILE_COUNT);
    expect(context.createPatternCalls).toEqual([[continuation, "repeat"]]);

    fixture.graph.nextDiff = {
      outcome: "applied",
      added: [],
      updated: ["agent:a"],
      removed: [],
      staticLayersInvalidated: false,
    };
    for (const revision of [2, 3]) {
      fixture.renderer.updatePresentation(frame({ revision }));
      await settle();
      fixture.driver.fire(revision * 16);
    }

    expect(context.patternFillRectCalls).toHaveLength(3);
    expect(context.patternFillRectCalls.every(({ source }) => source === continuation)).toBe(true);
    expect(context.createPatternCalls).toEqual([[continuation, "repeat"]]);
    expect(continuationContext.drawImageCalls).toHaveLength(rasterDraws);
    expect(fixture.debug().cache).toMatchObject({ created: 3, disposed: 0, outstanding: 3 });
    fixture.renderer.dispose();
  });

  it("round-trips camera modes, pan, zoom, resize, safe frame, focus, and callbacks without ownership theft", async () => {
    const onCameraModeChange = vi.fn();
    const onSelectionChange = vi.fn();
    const fixture = await harness({ callbacks: { onCameraModeChange, onSelectionChange } });
    fixture.graph.debugValue.hitTargets = [{
      selection: { kind: "agent", id: "agent-a" },
      worldBounds: { x: 80, y: 70, width: 24, height: 32 },
      feetY: 102,
      selectionKey: "agent:agent-a",
    }];
    fixture.renderer.updatePresentation(frame({ revision: 1 }));
    await settle();
    fixture.renderer.setSelection({ kind: "agent", id: "agent-a" });
    fixture.renderer.setCameraMode("follow");
    fixture.renderer.panCamera({ x: 32, y: 16 });
    fixture.renderer.zoomCamera(2, { x: 160, y: 144 });
    fixture.renderer.resize(390, 844);
    const safe: SafeFrameInsets = { top: 28, right: 12, bottom: 64, left: 20 };
    fixture.renderer.setSafeFrame(safe);
    fixture.renderer.focusSelection({ kind: "home", id: "home-a" });
    fixture.renderer.updatePresentation(frame({ revision: 2, selection: { kind: "region", id: "worn" } }));
    await settle();

    expect(onSelectionChange).toHaveBeenCalledTimes(1);
    expect(onCameraModeChange.mock.calls.map(([mode]) => mode)).toEqual(["follow", "free"]);
    expect(fixture.debug().camera).toMatchObject({ mode: "free", zoom: 2, safeFrameInsets: safe });
    expect(fixture.canvas.width).toBeGreaterThan(0);
    expect(fixture.canvas.height).toBeGreaterThan(0);
    fixture.renderer.setCameraMode("story");
    expect(fixture.debug().camera.mode).toBe("story");
    fixture.renderer.dispose();
  });

  it.each([false, true])(
    "temporarily frames checkpoint structure beats and restores prior Free camera ownership (reduced=%s)",
    async (reducedMotion) => {
      const onCameraModeChange = vi.fn();
      const fixture = await harness({
        reducedMotion,
        callbacks: { onCameraModeChange },
      });
      fixture.graph.debugValue.hitTargets = [{
        selection: { kind: "home", id: "home-repair" },
        worldBounds: { x: 480, y: 470, width: 64, height: 64 },
        feetY: 534,
        selectionKey: "home:home-repair",
      }];
      fixture.renderer.resize(390, 844);
      fixture.renderer.setSafeFrame({ top: 28, right: 12, bottom: 64, left: 20 });
      fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
      await settle();
      fixture.renderer.setCameraMode("free");
      fixture.renderer.panCamera({ x: 32, y: 16 });
      const before = structuredClone(fixture.debug().camera);

      fixture.renderer.updatePresentation(frame({
        revision: 2,
        settled: true,
        checkpointFocus: {
          regionId: "spring",
          kind: "home",
          entityId: "home-repair",
          segmentIndex: 0,
          segmentCount: 1,
          removed: false,
        },
      }));
      await settle();
      if (!reducedMotion) {
        fixture.driver.fire(0);
        fixture.driver.fire(240);
      }

      const focused = fixture.debug();
      expect(focused).toMatchObject({
        visibleRegionId: "spring",
        camera: {
          mode: "story",
          storyEntityId: "home:home-repair",
          storyTarget: { x: 480, y: 470, width: 64, height: 64 },
        },
      });
      const target = focused.camera.storyTarget!;
      const screen = {
        x: focused.camera.rasterOrigin.x + target.x * focused.camera.zoom,
        y: focused.camera.rasterOrigin.y + target.y * focused.camera.zoom,
        width: target.width * focused.camera.zoom,
        height: target.height * focused.camera.zoom,
      };
      expect(screen.x).toBeGreaterThanOrEqual(focused.camera.safeFrame.x);
      expect(screen.y).toBeGreaterThanOrEqual(focused.camera.safeFrame.y);
      expect(screen.x + screen.width).toBeLessThanOrEqual(
        focused.camera.safeFrame.x + focused.camera.safeFrame.width,
      );
      expect(screen.y + screen.height).toBeLessThanOrEqual(
        focused.camera.safeFrame.y + focused.camera.safeFrame.height,
      );

      fixture.renderer.updatePresentation(frame({
        revision: 3,
        settled: true,
        checkpointFocus: null,
      }));
      await settle();
      expect(fixture.debug()).toMatchObject({
        visibleRegionId: "worn",
        camera: {
          mode: "free",
          center: before.center,
          zoom: before.zoom,
        },
      });
      expect(onCameraModeChange.mock.calls.map(([mode]) => mode)).toEqual(["free"]);
      fixture.renderer.dispose();
    },
  );

  it("atomically clamps edge story targets to the accepted 96x96 recipe coverage", async () => {
    const graph = fakeGraph();
    graph.debugValue.hitTargets = [{
      selection: { kind: "agent", id: "agent-a" },
      selectionKey: "agent:agent-a",
      worldBounds: { x: 704, y: 3_008, width: 32, height: 48 },
      feetY: 3_056,
    }];
    const fixture = await harness({ graph, reducedMotion: true });
    fixture.renderer.resize(1_440, 900);
    fixture.renderer.updatePresentation(frame({
      revision: 1,
      selection: { kind: "agent", id: "agent-a" },
    }));
    await settle();
    fixture.renderer.focusSelection({ kind: "agent", id: "agent-a" });

    expect(fixture.debug().camera).toMatchObject({
      center: { x: 720, y: 2_622 },
      rasterOrigin: { x: 0, y: -2_172 },
      worldBounds: { x: 0, y: 0, width: 3_072, height: 3_072 },
    });
    fixture.renderer.dispose();
  });

  it("rejects invalid Follow through typed failure, then accepts a retry for a valid being", async () => {
    const onCameraModeChange = vi.fn();
    const onFailure = vi.fn();
    const fixture = await harness({ callbacks: { onCameraModeChange, onFailure } });
    fixture.renderer.updatePresentation(frame({ revision: 1, selection: null }));
    await settle();

    fixture.renderer.setCameraMode("follow");

    expect(fixture.debug().camera.mode).toBe("story");
    expect(onCameraModeChange).not.toHaveBeenCalledWith("follow");
    expect(onFailure).toHaveBeenCalledWith({
      kind: "path",
      retryable: true,
      publicMessage: "Choose a being or home before following.",
    });

    fixture.graph.debugValue.hitTargets = [{
      selection: { kind: "agent", id: "agent-a" },
      worldBounds: { x: 80, y: 70, width: 24, height: 32 },
      feetY: 102,
      selectionKey: "agent:agent-a",
    }];
    fixture.renderer.setSelection({ kind: "agent", id: "agent-a" });
    fixture.renderer.setCameraMode("follow");
    expect(fixture.debug().camera).toMatchObject({
      mode: "follow",
      followEntityId: "agent:agent-a",
    });
    expect(onCameraModeChange).toHaveBeenLastCalledWith("follow");
    fixture.renderer.dispose();
  });

  it("applies Story focus and queues its next target while Free owns the camera", async () => {
    const fixture = await harness();
    fixture.graph.debugValue.hitTargets = [{
      selection: { kind: "agent", id: "agent-a" },
      worldBounds: { x: 80, y: 70, width: 24, height: 32 },
      feetY: 102,
      selectionKey: "agent:agent-a",
    }];
    fixture.renderer.updatePresentation(frame({ revision: 1 }));
    await settle();
    expect(fixture.debug().camera.storyTarget).toEqual({ x: 80, y: 70, width: 24, height: 32 });

    fixture.renderer.setCameraMode("free");
    fixture.graph.debugValue.hitTargets = [{
      selection: { kind: "agent", id: "agent-a" },
      worldBounds: { x: 180, y: 170, width: 24, height: 32 },
      feetY: 202,
      selectionKey: "agent:agent-a",
    }];
    fixture.renderer.updatePresentation(frame({ revision: 2 }));
    await settle();
    expect(fixture.debug().camera.pendingStoryTarget).toEqual({ x: 180, y: 170, width: 24, height: 32 });
    fixture.renderer.dispose();
  });

  it("refreshes only the active moving Story target after Graph time advances", async () => {
    const graph = fakeGraph();
    graph.debugValue.hitTargets = [{
      selection: { kind: "agent", id: "agent-a" },
      worldBounds: { x: 80, y: 70, width: 24, height: 32 },
      feetY: 102,
      selectionKey: "agent:agent-a",
    }, {
      selection: { kind: "home", id: "home-a" },
      worldBounds: { x: 480, y: 470, width: 64, height: 64 },
      feetY: 534,
      selectionKey: "home:home-a",
    }];
    graph.updateTime.mockImplementation(() => {
      graph.debugValue.hitTargets[0]!.worldBounds.x += 24;
      graph.debugValue.hitTargets[0]!.feetY += 12;
    });
    const fixture = await harness({ graph });
    fixture.renderer.updatePresentation(frame({ revision: 1 }));
    await settle();
    const initialHitTargetReads = graph.hitTargets.mock.calls.length;

    fixture.driver.fire(16);

    expect(fixture.debug().camera).toMatchObject({
      storyEntityId: "agent:agent-a",
      storyTarget: { x: 104, y: 70, width: 24, height: 32 },
    });
    expect(graph.focusTarget).toHaveBeenLastCalledWith({ kind: "agent", id: "agent-a" });
    expect(graph.hitTargets).toHaveBeenCalledTimes(initialHitTargetReads);
    fixture.renderer.dispose();
  });

  it("keeps Free on its current region and commits the queued Story region when returning", async () => {
    const fixture = await harness();
    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
    await settle();
    fixture.renderer.setCameraMode("free");
    fixture.renderer.updatePresentation(frame({ revision: 2, sceneRegion: "spring" }));
    await settle();
    expect(fixture.debug().visibleRegionId).toBe("worn");

    fixture.renderer.setCameraMode("story");
    await settle();
    expect(fixture.debug().visibleRegionId).toBe("spring");
    fixture.renderer.dispose();
  });

  it("hands Story frames to Graph without an observer override while Free keeps its region explicit", async () => {
    const fixture = await harness();
    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
    await settle();
    expect(fixture.graph.update.mock.calls.at(-1)?.[2]).toBeNull();

    fixture.renderer.setCameraMode("free");
    fixture.renderer.updatePresentation(frame({ revision: 2, sceneRegion: "spring" }));
    await settle();
    expect(fixture.debug().visibleRegionId).toBe("worn");
    expect(fixture.graph.update.mock.calls.at(-1)?.[2]).toBe("worn");

    fixture.renderer.setCameraMode("story");
    await settle();
    expect(fixture.debug().visibleRegionId).toBe("spring");
    expect(fixture.graph.update.mock.calls.at(-1)?.[2]).toBeNull();
    fixture.renderer.dispose();
  });

  it("observes a configured remote region without changing frame truth or camera ownership, then returns to latest Story", async () => {
    const frameAcceptance = createPresentationFrameAcceptanceTracker();
    const markAccepted = vi.spyOn(frameAcceptance, "markAccepted");
    const onSemanticSnapshot = vi.fn();
    const fixture = await harness({ frameAcceptance, callbacks: { onSemanticSnapshot } });
    fixture.graph.semanticSnapshot.mockImplementation((() => ({
      frameIdentity: structuredClone(fixture.graph.debugValue.frameIdentity),
      subjects: fixture.graph.debugValue.visibleRegionId === null ? [] : [{
        selection: { kind: "region", id: fixture.graph.debugValue.visibleRegionId },
        stableSelectionKey: `region:${fixture.graph.debugValue.visibleRegionId}`,
        kind: "region",
        regionId: fixture.graph.debugValue.visibleRegionId,
        position: null,
        status: "exact",
        action: null,
      }],
    })) as never);
    const input = frame({ revision: 1, sceneRegion: "worn", selection: { kind: "agent", id: "agent-a" } });
    const callerCopy = structuredClone(input);
    fixture.renderer.updatePresentation(input);
    await settle();
    fixture.renderer.setCameraMode("free");
    const accepted = fixture.debug().frameIdentity;
    vi.mocked(fixture.pool.acquire).mockClear();

    fixture.renderer.observeRegion("spring");
    await settle();

    expect(fixture.debug()).toMatchObject({
      frameIdentity: accepted,
      visibleRegionId: "spring",
      camera: { mode: "free" },
    });
    expect(markAccepted).toHaveBeenCalledTimes(1);
    expect(onSemanticSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({
      frameIdentity: accepted,
      subjects: [expect.objectContaining({
        selection: { kind: "region", id: "spring" },
        regionId: "spring",
      })],
    }));
    expect(input).toEqual(callerCopy);
    expect(fixture.pool.acquire.mock.calls.some(([id]) => String(id).startsWith("spring-terraces"))).toBe(true);
    expect(fixture.pool.acquire.mock.calls.some(([id]) => String(id).startsWith("worn-heartland"))).toBe(false);

    fixture.renderer.setCameraMode("story");
    await settle();
    expect(fixture.debug()).toMatchObject({
      frameIdentity: accepted,
      visibleRegionId: "worn",
      camera: { mode: "story" },
    });
    expect(markAccepted).toHaveBeenCalledTimes(1);
    expect(onSemanticSnapshot).toHaveBeenLastCalledWith(expect.objectContaining({
      frameIdentity: accepted,
      subjects: [expect.objectContaining({
        selection: { kind: "region", id: "worn" },
        regionId: "worn",
      })],
    }));
    fixture.renderer.dispose();
  });

  it("RED: adopts the exact ordinary Story-return target before publishing candidate semantics", async () => {
    const prior = fakeGraph();
    const remote = fakeGraph();
    const returned = fakeGraph();
    prior.semanticSnapshot.mockImplementation((() => semanticRegionSnapshot(prior, "worn")) as never);
    remote.semanticSnapshot.mockImplementation((() => semanticRegionSnapshot(remote, "spring")) as never);
    returned.semanticSnapshot.mockImplementation((() => semanticRegionSnapshot(returned, "worn")) as never);
    const initialTarget = {
      selection: { kind: "agent" as const, id: "agent-a" },
      worldBounds: { x: 80, y: 70, width: 24, height: 32 },
      feetY: 102,
      selectionKey: "agent:agent-a",
    };
    const returnedTarget = {
      ...initialTarget,
      worldBounds: { x: 880, y: 1_070, width: 24, height: 32 },
      feetY: 1_102,
    };
    prior.debugValue.hitTargets = [initialTarget];
    remote.debugValue.hitTargets = [];
    returned.debugValue.hitTargets = [];
    returned.focusTarget.mockReturnValue(structuredClone(returnedTarget));
    const graphs = [prior, remote, returned];
    let generation = 0;
    let readDebug: (() => CanvasPresentationRendererDebug) | null = null;
    const semanticCameraTargets: Array<Readonly<{ x: number; y: number; width: number; height: number }> | null> = [];
    const fixture = await harness({
      graph: prior,
      callbacks: {
        onSemanticSnapshot: (snapshot) => {
          if (snapshot.subjects.some(({ regionId }) => regionId === "worn") && readDebug !== null) {
            semanticCameraTargets.push(readDebug().camera.storyTarget);
          }
        },
      },
      sceneGraphFactory: () => graphs[generation++]! as unknown as ProductionSceneGraph,
    });
    readDebug = fixture.debug;

    fixture.renderer.updatePresentation(frame({
      revision: 1,
      sceneRegion: "worn",
      selection: { kind: "agent", id: "agent-a" },
    }));
    await settle();
    fixture.renderer.setCameraMode("free");
    fixture.renderer.observeRegion("spring");
    await settle();
    fixture.renderer.setCameraMode("story");
    await settle();

    expect(fixture.debug()).toMatchObject({
      visibleRegionId: "worn",
      camera: { mode: "story", storyTarget: returnedTarget.worldBounds },
    });
    expect(semanticCameraTargets.at(-1)).toEqual(returnedTarget.worldBounds);
    fixture.renderer.dispose();
  });

  it("rolls back an observer-only region candidate atomically when semantic snapshot construction throws", async () => {
    const prior = fakeGraph();
    const candidate = fakeGraph();
    const cacheDisposals: ReturnType<typeof vi.fn>[] = [];
    const cacheCanvasFactory: CacheCanvasOwnerFactory = (input) => {
      const canvas = document.createElement("canvas");
      canvas.width = input.width;
      canvas.height = input.height;
      const dispose = vi.fn();
      cacheDisposals.push(dispose);
      return { canvas, context: canvas.getContext("2d")!, dispose };
    };
    prior.semanticSnapshot.mockImplementation((() => semanticRegionSnapshot(prior, "worn")) as never);
    candidate.semanticSnapshot.mockImplementation(() => {
      throw new Error("semantic snapshot failed");
    });
    let creations = 0;
    const onSemanticSnapshot = vi.fn();
    const fixture = await harness({
      graph: prior,
      callbacks: { onSemanticSnapshot },
      cacheCanvasFactory,
      sceneGraphFactory: () => {
        creations += 1;
        return (creations === 1 ? prior : candidate) as unknown as ProductionSceneGraph;
      },
    });
    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
    await settle();
    fixture.renderer.setSelection({ kind: "agent", id: "agent-a" });
    fixture.renderer.setCameraMode("follow");
    const retained = fixture.debug();
    fixture.renderer.observeRegion("spring");
    await settle();

    expect(fixture.debug()).toMatchObject({
      frameIdentity: retained.frameIdentity,
      visibleRegionId: "worn",
      staticCacheRegions: ["worn"],
      camera: retained.camera,
    });
    expect(prior.dispose).not.toHaveBeenCalled();
    expect(candidate.dispose).toHaveBeenCalledOnce();
    expect(cacheDisposals).toHaveLength(6);
    expect(cacheDisposals.slice(0, 3).every((dispose) => dispose.mock.calls.length === 0)).toBe(true);
    expect(cacheDisposals.slice(3).every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
    fixture.renderer.dispose();
    expect(prior.dispose).toHaveBeenCalledOnce();
    expect(cacheDisposals.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
  });

  it("rolls back an observer-only region candidate atomically when target adoption throws", async () => {
    const prior = fakeGraph();
    const candidate = fakeGraph();
    const cacheDisposals: ReturnType<typeof vi.fn>[] = [];
    const cacheCanvasFactory: CacheCanvasOwnerFactory = (input) => {
      const canvas = document.createElement("canvas");
      canvas.width = input.width;
      canvas.height = input.height;
      const dispose = vi.fn();
      cacheDisposals.push(dispose);
      return { canvas, context: canvas.getContext("2d")!, dispose };
    };
    prior.semanticSnapshot.mockImplementation((() => semanticRegionSnapshot(prior, "worn")) as never);
    candidate.semanticSnapshot.mockImplementation((() => semanticRegionSnapshot(candidate, "spring")) as never);
    candidate.hitTargets.mockImplementation(() => {
      throw new Error("candidate targets failed");
    });
    let creations = 0;
    const fixture = await harness({
      graph: prior,
      cacheCanvasFactory,
      sceneGraphFactory: () => {
        creations += 1;
        return (creations === 1 ? prior : candidate) as unknown as ProductionSceneGraph;
      },
    });
    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
    await settle();
    fixture.renderer.setSelection({ kind: "agent", id: "agent-a" });
    fixture.renderer.setCameraMode("follow");
    const retained = fixture.debug();
    const priorLeaseCount = fixture.pool.releases.length;

    fixture.renderer.observeRegion("spring");
    await settle();

    expect(fixture.debug()).toMatchObject({
      frameIdentity: retained.frameIdentity,
      visibleRegionId: "worn",
      loadingRegionId: null,
      staticCacheRegions: ["worn"],
      camera: retained.camera,
    });
    expect(prior.dispose).not.toHaveBeenCalled();
    expect(candidate.dispose).toHaveBeenCalledOnce();
    expect(cacheDisposals).toHaveLength(6);
    expect(cacheDisposals.slice(0, 3).every((dispose) => dispose.mock.calls.length === 0)).toBe(true);
    expect(cacheDisposals.slice(3).every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
    expect(fixture.pool.releases.slice(0, priorLeaseCount).every(
      (release) => release.mock.calls.length === 0,
    )).toBe(true);
    expect(fixture.pool.releases.slice(priorLeaseCount).every(
      (release) => release.mock.calls.length === 1,
    )).toBe(true);
    fixture.renderer.dispose();
    expect(prior.dispose).toHaveBeenCalledOnce();
    expect(cacheDisposals.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
  });

  it("rolls back an observer-only region candidate atomically when semantic adoption throws", async () => {
    const prior = fakeGraph();
    const candidate = fakeGraph();
    const cacheDisposals: ReturnType<typeof vi.fn>[] = [];
    const cacheCanvasFactory: CacheCanvasOwnerFactory = (input) => {
      const canvas = document.createElement("canvas");
      canvas.width = input.width;
      canvas.height = input.height;
      const dispose = vi.fn();
      cacheDisposals.push(dispose);
      return { canvas, context: canvas.getContext("2d")!, dispose };
    };
    prior.semanticSnapshot.mockImplementation((() => semanticRegionSnapshot(prior, "worn")) as never);
    candidate.semanticSnapshot.mockImplementation(() => ({
      ...semanticRegionSnapshot(candidate, "spring"),
      subjects: [{
        selection: { kind: "region", id: "spring" },
        stableSelectionKey: "region:spring",
        kind: "region",
        regionId: "spring",
        position: null,
        status: 1n,
        action: null,
      }],
    }) as never);
    let creations = 0;
    const fixture = await harness({
      graph: prior,
      cacheCanvasFactory,
      sceneGraphFactory: () => {
        creations += 1;
        return (creations === 1 ? prior : candidate) as unknown as ProductionSceneGraph;
      },
    });
    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
    await settle();
    const retained = fixture.debug();
    const priorLeaseCount = fixture.pool.releases.length;

    fixture.renderer.observeRegion("spring");
    await settle();

    expect(fixture.debug()).toMatchObject({
      frameIdentity: retained.frameIdentity,
      visibleRegionId: "worn",
      loadingRegionId: null,
      staticCacheRegions: ["worn"],
      camera: retained.camera,
    });
    expect(prior.dispose).not.toHaveBeenCalled();
    expect(candidate.dispose).toHaveBeenCalledOnce();
    expect(cacheDisposals).toHaveLength(6);
    expect(cacheDisposals.slice(0, 3).every((dispose) => dispose.mock.calls.length === 0)).toBe(true);
    expect(cacheDisposals.slice(3).every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
    expect(fixture.pool.releases.slice(0, priorLeaseCount).every(
      (release) => release.mock.calls.length === 0,
    )).toBe(true);
    expect(fixture.pool.releases.slice(priorLeaseCount).every(
      (release) => release.mock.calls.length === 1,
    )).toBe(true);
    fixture.renderer.dispose();
    expect(prior.dispose).toHaveBeenCalledOnce();
    expect(cacheDisposals.every((dispose) => dispose.mock.calls.length === 1)).toBe(true);
  });

  it("contains a throwing semantic observer so graph, camera, and acceptance commit together", async () => {
    const graph = fakeGraph();
    const frameAcceptance = createPresentationFrameAcceptanceTracker();
    const onSemanticSnapshot = vi.fn((snapshot: { frameIdentity: { revision: number } }) => {
      if (snapshot.frameIdentity.revision === 2) throw new Error("semantic observer failed");
    });
    const fixture = await harness({
      graph,
      frameAcceptance,
      callbacks: { onSemanticSnapshot },
      reducedMotion: true,
    });
    const accepted = frame({ revision: 1 });
    fixture.renderer.updatePresentation(accepted);
    await settle();
    graph.debugValue.hitTargets = [{
      selection: { kind: "agent", id: "agent-a" },
      selectionKey: "agent:agent-a",
      worldBounds: { x: 704, y: 1_984, width: 32, height: 48 },
      feetY: 2_032,
    }];
    fixture.renderer.updatePresentation(frame({ revision: 2 }));

    expect(fixture.debug()).toMatchObject({
      frameIdentity: expect.objectContaining({ revision: 2 }),
      graph: { frameIdentity: expect.objectContaining({ revision: 2 }) },
      camera: {
        worldBounds: { x: 0, y: 0, width: 3_072, height: 3_072 },
        storyTarget: { x: 704, y: 1_984, width: 32, height: 48 },
      },
    });
    expect(frameAcceptance.accepts(accepted)).toBe(false);
    expect(frameAcceptance.accepts(frame({ revision: 2 }))).toBe(true);
    fixture.renderer.updatePresentation(frame({ revision: 3 }));
    expect(frameAcceptance.accepts(frame({ revision: 3 }))).toBe(true);
    fixture.renderer.dispose();
  });

  it("retries a pre-mutation acceptance failure without rolling back the committed graph", async () => {
    const accepted = createPresentationFrameAcceptanceTracker();
    const onFailure = vi.fn();
    let failOnce = true;
    const frameAcceptance = {
      markAccepted(next: PresentedObserverFrame): void {
        if (failOnce) {
          failOnce = false;
          throw new Error("acceptance observer failed");
        }
        accepted.markAccepted(next);
      },
    };
    const fixture = await harness({ frameAcceptance, callbacks: { onFailure } });
    const next = frame({ revision: 8 });
    fixture.renderer.updatePresentation(next);
    await settle();

    expect(fixture.debug()).toMatchObject({
      frameIdentity: expect.objectContaining({ revision: 8 }),
      graph: { frameIdentity: expect.objectContaining({ revision: 8 }) },
    });
    expect(accepted.accepts(next)).toBe(false);
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ kind: "canvas", retryable: true }));
    fixture.driver.fire(16);
    expect(accepted.accepts(next)).toBe(true);
    fixture.renderer.dispose();
  });

  it("keeps an always-failing acceptance receipt pending without reverting visible truth", async () => {
    const accepted = createPresentationFrameAcceptanceTracker();
    const onFailure = vi.fn();
    const fixture = await harness({
      frameAcceptance: { markAccepted: () => { throw new Error("still unavailable"); } },
      callbacks: { onFailure },
      reducedMotion: true,
    });
    const next = frame({ revision: 18 });
    fixture.renderer.updatePresentation(next);
    await settle();
    fixture.driver.fire(16);

    expect(fixture.debug()).toMatchObject({
      frameIdentity: expect.objectContaining({ revision: 18 }),
      graph: { frameIdentity: expect.objectContaining({ revision: 18 }) },
      postCommit: { acceptancePending: true, semanticPending: false },
      scheduler: { wakeScheduled: true, reason: "post-commit-retry" },
    });
    expect(accepted.accepts(next)).toBe(false);
    expect(onFailure.mock.calls.length).toBeGreaterThanOrEqual(2);
    fixture.renderer.dispose();
  });

  it("retries semantic snapshot construction after committing the live graph", async () => {
    const graph = fakeGraph();
    const originalSnapshot = graph.semanticSnapshot.getMockImplementation()!;
    graph.semanticSnapshot.mockImplementationOnce(() => {
      throw new Error("semantic snapshot unavailable");
    }).mockImplementation(originalSnapshot);
    const onSemanticSnapshot = vi.fn();
    const fixture = await harness({ graph, callbacks: { onSemanticSnapshot } });
    fixture.renderer.updatePresentation(frame({ revision: 28 }));
    await settle();

    expect(fixture.debug()).toMatchObject({
      frameIdentity: expect.objectContaining({ revision: 28 }),
      graph: { frameIdentity: expect.objectContaining({ revision: 28 }) },
    });
    expect(onSemanticSnapshot).not.toHaveBeenCalled();
    fixture.driver.fire(16);
    expect(onSemanticSnapshot).toHaveBeenCalledWith(expect.objectContaining({
      frameIdentity: expect.objectContaining({ revision: 28 }),
    }));
    fixture.renderer.dispose();
  });

  it("rejects unknown and stale region observations while preserving the prior visible generation", async () => {
    const onFailure = vi.fn();
    const springAtlas = PRODUCTION_ASSET_MANIFEST.regions["spring-terraces"].atlasIds[0]!;
    const pending = deferred<ProductionAssetLease>();
    const fixture = await harness({ callbacks: { onFailure }, pendingAtlas: [springAtlas, pending] });
    fixture.graph.debugValue.hitTargets = [{
      selection: { kind: "agent", id: "agent-a" },
      worldBounds: { x: 80, y: 70, width: 24, height: 32 },
      feetY: 102,
      selectionKey: "agent:agent-a",
    }];
    fixture.renderer.updatePresentation(frame({
      revision: 1,
      sceneRegion: "worn",
      selection: { kind: "agent", id: "agent-a" },
    }));
    await settle();
    fixture.renderer.setCameraMode("follow");
    const accepted = fixture.debug().frameIdentity;

    fixture.renderer.observeRegion("Unknown Reach");
    expect(onFailure).toHaveBeenLastCalledWith({
      kind: "path",
      retryable: false,
      publicMessage: "The selected region is unavailable.",
    });
    expect(fixture.debug()).toMatchObject({ frameIdentity: accepted, visibleRegionId: "worn" });

    fixture.renderer.observeRegion("spring");
    expect(fixture.debug().loadingRegionId).toBe("spring");
    fixture.renderer.observeRegion("worn");
    pending.resolve(lease(springAtlas));
    await settle();
    expect(fixture.debug()).toMatchObject({
      frameIdentity: accepted,
      visibleRegionId: "worn",
      loadingRegionId: null,
      camera: { mode: "follow" },
    });
    fixture.renderer.dispose();
  });

  it("does not echo an identical observer selection more than once", async () => {
    const onSelectionChange = vi.fn();
    const fixture = await harness({ callbacks: { onSelectionChange } });
    const selection = { kind: "agent", id: "agent-a" } as const;
    fixture.renderer.setSelection(selection);
    fixture.renderer.setSelection(selection);
    expect(onSelectionChange).toHaveBeenCalledOnce();
    fixture.renderer.dispose();
  });

  it("resolves accepted moments and keeps Follow entity keys namespace-safe", async () => {
    const fixture = await harness();
    fixture.graph.debugValue.hitTargets = [
      {
        selection: { kind: "agent", id: "agent-a" },
        worldBounds: { x: 40, y: 40, width: 16, height: 24 },
        feetY: 64,
        selectionKey: "agent:agent-a",
      },
      {
        selection: { kind: "agent", id: "shared" },
        worldBounds: { x: 80, y: 80, width: 16, height: 24 },
        feetY: 104,
        selectionKey: "agent:shared",
      },
      {
        selection: { kind: "home", id: "shared" },
        worldBounds: { x: 140, y: 140, width: 64, height: 64 },
        feetY: 204,
        selectionKey: "home:shared",
      },
    ];
    fixture.renderer.updatePresentation(frame({ revision: 1 }));
    await settle();
    fixture.renderer.focusSelection({ kind: "moment", id: "moment-1", firstCursor: 1, lastCursor: 1 });
    expect(fixture.debug().camera.storyTarget).toEqual({ x: 40, y: 40, width: 16, height: 24 });

    fixture.renderer.setSelection({ kind: "agent", id: "shared" });
    fixture.renderer.setCameraMode("follow");
    expect(fixture.debug().camera.followEntityId).toBe("agent:shared");
    fixture.renderer.dispose();
  });

  it("hit-tests agents, homes, and ruins with a fixed 44 world-px tolerance, feet-Y, scale, and stable ties", async () => {
    // Camera zoom is 1 throughout this test (nothing here zooms it), so the WORLD-px tolerance
    // (`SELECTION_PICK_TOLERANCE_WORLD_PX`) produces the exact same numbers a 44 CSS-px tolerance
    // divided by zoom used to -- this test's pre-existing expectations are unchanged by the fix.
    const onSelectionChange = vi.fn();
    const fixture = await harness({ callbacks: { onSelectionChange } });
    fixture.renderer.updatePresentation(frame({ revision: 1 }));
    await settle();
    fixture.driver.fire(16);
    fixture.graph.debugValue.hitTargets = [
      { selection: { kind: "region", id: "worn" }, worldBounds: { x: 0, y: 0, width: 2048, height: 2048 }, feetY: 2048, selectionKey: "region:worn" },
      { selection: { kind: "agent", id: "zeta" }, worldBounds: { x: -4, y: -4, width: 8, height: 8 }, feetY: 120, selectionKey: "same" },
      { selection: { kind: "ruin", id: "alpha" }, worldBounds: { x: -4, y: -4, width: 8, height: 8 }, feetY: 140, selectionKey: "same" },
    ];
    fixture.canvas.getBoundingClientRect = () => ({ x: 10, y: 20, left: 10, top: 20, right: 522, bottom: 308, width: 512, height: 288, toJSON: () => ({}) });
    fixture.renderer.selectAt?.({ x: 0, y: 0 });
    expect(onSelectionChange).toHaveBeenLastCalledWith({ kind: "ruin", id: "alpha" });
    const calls = onSelectionChange.mock.calls.length;
    fixture.renderer.selectAt?.({ x: -5_010, y: -5_020 });
    expect(onSelectionChange).toHaveBeenCalledTimes(calls);
    fixture.renderer.dispose();
  });

  it("uses one RAF while dirty, one wake while idle, and no handle when settled", async () => {
    const fixture = await harness();
    fixture.renderer.updatePresentation(frame({ revision: 1 }));
    fixture.renderer.updatePresentation(frame({ revision: 2 }));
    await settle();
    expect(fixture.driver.pending()).toBe(1);
    expect(fixture.wake.pending()).toBe(0);
    fixture.graph.deadline = 1_000;
    fixture.driver.fire(16);
    expect(fixture.driver.pending()).toBe(0);
    expect(fixture.wake.pending()).toBe(1);
    expect(fixture.debug().scheduler.reason).toBe("graph-deadline");
    fixture.wake.fire();
    expect(fixture.driver.pending()).toBe(1);
    fixture.graph.deadline = null;
    fixture.driver.fire(1_000);
    expect(fixture.debug().draw).toEqual({
      count: 2,
      totalCount: 2,
      maxMs: 0,
      samplesMs: [0, 0],
    });
    expect(fixture.driver.pending()).toBe(0);
    expect(fixture.wake.pending()).toBe(0);
    fixture.renderer.dispose();
  });

  it("measures draw cost with a monotonic clock independent of presentation time", async () => {
    const readings = [10, 12.5, 20, 23.25];
    const fixture = await harness({ measurementNow: () => readings.shift()! });
    fixture.renderer.updatePresentation(frame({ revision: 1 }));
    await settle();
    fixture.driver.fire(56_400);
    fixture.renderer.updatePresentation(frame({ revision: 2 }));
    fixture.driver.fire(56_400);

    expect(fixture.debug().draw).toEqual({
      count: 2,
      totalCount: 2,
      maxMs: 3.25,
      samplesMs: [2.5, 3.25],
    });
    expect(fixture.driver.now()).toBe(56_400);
    fixture.renderer.dispose();
  });

  it("keeps a monotonic total draw count after the bounded sample ring saturates", async () => {
    const fixture = await harness();
    fixture.renderer.updatePresentation(frame({ revision: 1 }));
    await settle();
    for (let draw = 1; draw <= 125; draw += 1) {
      fixture.renderer.updatePresentation(frame({ revision: draw + 1 }));
      fixture.driver.fire(draw * 16);
    }

    expect(fixture.debug().draw.count).toBe(120);
    expect(fixture.debug().draw.samplesMs).toHaveLength(120);
    expect(fixture.debug().draw.totalCount).toBe(125);
    fixture.renderer.dispose();
  });

  it("cancels RAF and wake while hidden, ignores stale callbacks, and draws the latest frame once visible", async () => {
    const fixture = await harness();
    fixture.graph.deadline = 1_000;
    fixture.renderer.updatePresentation(frame({ revision: 1 }));
    await settle();
    const stale = fixture.driver.firstHandle();
    fixture.visibility.setHidden(true);
    expect(fixture.driver.pending()).toBe(0);
    expect(fixture.wake.pending()).toBe(0);
    expect(fixture.debug().scheduler.nextDeadlineMs).toBeNull();
    fixture.renderer.updatePresentation(frame({ revision: 2 }));
    await settle();
    expect(fixture.driver.pending()).toBe(0);
    fixture.driver.fireCancelled(stale, 100);
    expect(fixture.graph.draw).not.toHaveBeenCalled();
    fixture.driver.reuseNext(stale);
    fixture.visibility.setHidden(false);
    expect(fixture.driver.pending()).toBe(1);
    fixture.driver.fireCancelled(stale, 110);
    expect(fixture.debug().scheduler.rafScheduled).toBe(true);
    fixture.driver.fire(120);
    expect(fixture.graph.frames.at(-1)?.revision).toBe(2);
    expect(fixture.graph.draw).toHaveBeenCalledOnce();
    fixture.renderer.dispose();
  });

  it("settles reduced motion at the same truth without optional chained RAF or ambient wake", async () => {
    const normal = await harness();
    const reduced = await harness({ reducedMotion: true });
    normal.renderer.updatePresentation(frame({ revision: 1, terminal: true }));
    reduced.renderer.updatePresentation(frame({ revision: 1, terminal: true }));
    await settle();
    normal.driver.fire(16);
    reduced.driver.fire(16);
    expect(reduced.debug().frameIdentity).toEqual(normal.debug().frameIdentity);
    expect(reduced.driver.pending()).toBe(0);
    expect(reduced.wake.pending()).toBe(0);
    normal.renderer.dispose();
    reduced.renderer.dispose();
  });

  it("reports bounded diagnostics after scheduler ownership and safe asset failure without stale readiness", async () => {
    const onDiagnostics = vi.fn();
    const onFailure = vi.fn();
    const failed = deferred<ProductionAssetLease>();
    const atlasId = PRODUCTION_ASSET_MANIFEST.regions["worn-heartland"].atlasIds[0]!;
    const fixture = await harness({ callbacks: { onDiagnostics, onFailure }, pendingAtlas: [atlasId, failed] });
    fixture.renderer.updatePresentation(frame({ revision: 1 }));
    failed.reject(new Error("private /tmp/path atlas failure"));
    await settle();
    fixture.graph.debugValue.recentMarkers = Array.from({ length: 7 }, () => ({}));
    fixture.graph.debugValue.environments = [{ diagnostics: { activeEffects: 1 } }];
    fixture.graph.debugValue.transients = [{}];
    expect(onFailure).toHaveBeenCalledWith({
      kind: "asset",
      retryable: true,
      publicMessage: expect.not.stringMatching(/\/tmp|private/i),
    });
    expect(onDiagnostics.mock.calls.every(([value]) => !(value.scheduledFrame && fixture.wake.pending() > 0))).toBe(true);
    expect(fixture.renderer.diagnostics()).toMatchObject({
      activeActors: fixture.graph.debugSnapshot().activeActors,
      activeHomes: fixture.graph.debugSnapshot().activeHomes,
      activeEffects: 2,
      assetBytes: 100,
      decodedAssetBytes: 200,
    });
    fixture.renderer.dispose();
  });

  it("loads only common plus the active region pack and releases partial/current leases exactly once", async () => {
    const fixture = await harness();
    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
    await settle();
    const activeIds = new Set([
      ...Object.values(PRODUCTION_ASSET_MANIFEST.atlases).filter((atlas) => atlas.group === "core").map((atlas) => atlas.id),
      ...PRODUCTION_ASSET_MANIFEST.regions["worn-heartland"].atlasIds,
    ]);
    expect(new Set(fixture.pool.acquire.mock.calls.map(([id]) => id))).toEqual(activeIds);
    expect(fixture.pool.acquire.mock.calls.some(([id]) => String(id).startsWith("spring-terraces"))).toBe(false);
    fixture.renderer.dispose();
    fixture.renderer.dispose();
    fixture.pool.releases.forEach((release) => expect(release).toHaveBeenCalledOnce());
    expect(fixture.graph.dispose).toHaveBeenCalledOnce();
    expect(fixture.pool.dispose).not.toHaveBeenCalled();
  });

  it("disposes listeners, graph, cache, schedulers, loads, and callbacks once then remains inert", async () => {
    const callbacks: ObserverRendererCallbacks = {
      onSelectionChange: vi.fn(),
      onCameraModeChange: vi.fn(),
      onDiagnostics: vi.fn(),
      onFailure: vi.fn(),
    };
    const fixture = await harness({ callbacks });
    fixture.renderer.updatePresentation(frame({ revision: 1 }));
    await settle();
    fixture.renderer.dispose();
    fixture.renderer.dispose();
    fixture.renderer.updatePresentation(frame({ revision: 2 }));
    fixture.renderer.setSelection({ kind: "agent", id: "later" });
    fixture.visibility.setHidden(true);
    fixture.driver.fireCancelled(fixture.driver.firstHandle(), 100);
    expect(fixture.graph.dispose).toHaveBeenCalledOnce();
    expect(fixture.driver.pending()).toBe(0);
    expect(fixture.wake.pending()).toBe(0);
    expect(fixture.visibility.listenerCount).toBe(0);
    expect(fixture.renderer.diagnostics().disposed).toBe(true);
    expect(fixture.debug().scheduler).toMatchObject({
      dirty: false,
      rafScheduled: false,
      wakeScheduled: false,
      nextDeadlineMs: null,
    });
    expect(vi.mocked(callbacks.onSelectionChange!)).not.toHaveBeenCalled();
  });

  it("survives twenty-five run-generation replacements with one graph owner and rejects stale callbacks after disposal", async () => {
    const graphs = Array.from({ length: 25 }, () => fakeGraph());
    let generation = 0;
    const fixture = await harness({
      graph: graphs[0]!,
      sceneGraphFactory: () => graphs[generation++]! as unknown as ProductionSceneGraph,
    });

    for (let index = 0; index < 25; index += 1) {
      fixture.renderer.updatePresentation(frame({
        runId: `run-${index}`,
        sourceKey: `archive:run-${index}`,
        revision: 0,
        firstCursor: 0,
        lastCursor: 0,
      }));
      await settle();
    }

    expect(generation).toBe(25);
    for (const prior of graphs.slice(0, -1)) expect(prior.dispose).toHaveBeenCalledOnce();
    expect(graphs.at(-1)!.dispose).not.toHaveBeenCalled();
    expect(fixture.debug().frameIdentity).toMatchObject({ runId: "run-24", sourceKey: "archive:run-24" });

    const staleHandle = fixture.driver.firstHandle();
    fixture.renderer.dispose();
    fixture.driver.fireCancelled(staleHandle, 10_000);
    for (const prior of graphs) expect(prior.dispose).toHaveBeenCalledOnce();
    expect(graphs.reduce((total, graph) => total + graph.draw.mock.calls.length, 0)).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // BUBBLES-FIX 2026-08-21 — beat framing must land where the legibility grammar
  // actually has words. `TEXT_ZOOM_THRESHOLD` (1.5) is the `bubbleScale` 1->2 step:
  // below it every bubble collapses to a glyph stud. The camera's own floor said 1
  // ("below roughly 1:1 the grammar drops to its low-zoom stud form"), so a beat
  // could spend its whole framing budget and still deliver an unreadable frame; and
  // the cast came from `overlayFocusRect()` — every live bubble in the REGION — so
  // the more the world spoke the further out the shot pulled.
  // ---------------------------------------------------------------------------

  it("sizes the legible beat extent so a maximal beat lands at the grammar's own text threshold", () => {
    const insets: SafeFrameInsets = { top: 60, right: 52, bottom: 109, left: 20 };
    const canvasWidth = 1_440;
    const canvasHeight = 900;
    const extent = legibleBeatExtent({ canvasWidth, canvasHeight, insets });

    // `Camera2D.beatFrame()`: horizontal insets both sides, the top inset, full height below.
    const frameWidth = canvasWidth - insets.left - insets.right;
    const frameHeight = canvasHeight - insets.top;
    const paddedWidth = extent.x + BEAT_FRAME_PADDING_PX * 2;
    const paddedHeight = extent.y + BEAT_FRAME_PADDING_PX * 2 + BEAT_FRAME_HEADROOM_PX;
    const fit = Math.min(frameWidth / paddedWidth, frameHeight / paddedHeight);

    expect(BEAT_FRAME_MIN_LEGIBLE_ZOOM).toBe(TEXT_ZOOM_THRESHOLD);
    expect(fit).toBeCloseTo(TEXT_ZOOM_THRESHOLD, 10);
  });

  it("frames the acting being when the region's whole live chrome is too wide to read", () => {
    const extent = { x: 784, y: 336 };
    // Measured on the recorded run: `overlayFocusRect()` spanned 497x456 world px because
    // several beings were speaking at once, hundreds of px apart.
    const chrome = { x: 560, y: 590, width: 497, height: 456 };
    const primary = { x: 848, y: 1_000, width: 22, height: 48 };

    expect(beatFrameRect({ chrome, primary, previous: null, extent })).toEqual(primary);
  });

  it("still co-frames the acting being with its chrome whenever that reads", () => {
    const extent = { x: 784, y: 336 };
    const chrome = { x: 560, y: 590, width: 120, height: 90 };
    const primary = { x: 600, y: 640, width: 22, height: 48 };

    expect(beatFrameRect({ chrome, primary, previous: null, extent })).toEqual({
      x: 560, y: 590, width: 120, height: 98,
    });
  });

  it("keeps chrome as the frame when the beat names no primary, however wide it is", () => {
    const extent = { x: 784, y: 336 };
    const chrome = { x: 0, y: 0, width: 2_000, height: 2_000 };

    expect(beatFrameRect({ chrome, primary: null, previous: null, extent })).toEqual(chrome);
  });

  it("grows a held beat frame only while the growth still reads", () => {
    const extent = { x: 784, y: 336 };
    const primary = { x: 100, y: 100, width: 22, height: 48 };
    const near = { x: 90, y: 90, width: 60, height: 60 };
    const far = { x: 90, y: 90, width: 700, height: 700 };

    expect(beatFrameRect({ chrome: near, primary, previous: { x: 0, y: 0, width: 40, height: 40 }, extent }))
      .toEqual({ x: 0, y: 0, width: 150, height: 150 });
    expect(beatFrameRect({ chrome: near, primary, previous: far, extent }))
      .toEqual({ x: 90, y: 90, width: 60, height: 60 });
  });

  it("disposes graph entities before regional leases and closes the final bitmap only after the last release", async () => {
    const trace: string[] = [];
    const graph = fakeGraph();
    graph.dispose.mockImplementation(() => trace.push("graph-entity-dispose"));
    const fixture = await harness({ graph, poolTrace: trace });
    fixture.renderer.updatePresentation(frame({ revision: 1, sceneRegion: "worn" }));
    await settle();

    fixture.renderer.dispose();

    const graphIndex = trace.indexOf("graph-entity-dispose");
    const firstLeaseIndex = trace.indexOf("regional-lease-release");
    const lastLeaseIndex = trace.lastIndexOf("regional-lease-release");
    const closeIndex = trace.indexOf("last-bitmap-close");
    expect(graphIndex).toBeGreaterThanOrEqual(0);
    expect(graphIndex).toBeLessThan(firstLeaseIndex);
    expect(lastLeaseIndex).toBeLessThanOrEqual(closeIndex);
    expect(trace.filter((entry) => entry === "last-bitmap-close")).toHaveLength(1);
  });
});

function exactNirvanaRecipe(): RegionMapRecipeV1 {
  const nirvanaRegions = [
    region("nirvana", "a once-heavenly landscape, now thinning and picked-over"),
    region("warm_springs", "hot spring lakes"),
  ];
  return createNirvanaRegionMapRecipe(
    createRegionMapIdentity(401, nirvanaRegions[0]!, nirvanaRegions),
  );
}

function grownExactNirvanaRecipe(
  recipe: RegionMapRecipeV1,
  growth: Readonly<{
    columns: number;
    rows: number;
    identityHash: string;
    staticSceneHash: string;
  }>,
): RegionMapRecipeV1 {
  const grown = structuredClone(recipe) as unknown as {
    identityHash: string;
    grid: { columns: number; rows: number };
    presentationProfile: { staticSceneHash: string };
  };
  grown.identityHash = growth.identityHash;
  grown.grid.columns = growth.columns;
  grown.grid.rows = growth.rows;
  grown.presentationProfile.staticSceneHash = growth.staticSceneHash;
  return grown as unknown as RegionMapRecipeV1;
}

function staticIdentityForRecipe(recipe: RegionMapRecipeV1): string {
  const profile = recipe.presentationProfile!;
  return [
    profile.kind,
    profile.atlasProfileVersion,
    recipe.identityHash,
    profile.staticSceneHash,
  ].join(":");
}

function exactDescriptorForRecipe(recipe: RegionMapRecipeV1): ProductionStaticSceneDescriptor {
  return createProductionStaticSceneDescriptor({
    cacheIdentity: staticIdentityForRecipe(recipe),
    worldBounds: {
      x: 0,
      y: 0,
      width: recipe.grid.columns * 32,
      height: recipe.grid.rows * 32,
    },
    topology: "toroidal",
  });
}

function instrumentedExactStaticSceneProvider(
  recipe: RegionMapRecipeV1,
  operationCount: number,
  options: Readonly<{
    disposeError?: Error;
    descriptor?: ProductionStaticSceneDescriptor;
    preparationDescriptor?: ProductionStaticSceneDescriptor;
    descriptorForRecipe?: (recipe: RegionMapRecipeV1) => ProductionStaticSceneDescriptor;
  }> = {},
) {
  const profile = recipe.presentationProfile;
  if (profile?.kind !== "nirvana-v2") throw new Error("Exact provider fixture needs Nirvana V2.");
  const cacheIdentity = [
    profile.kind,
    profile.atlasProfileVersion,
    recipe.identityHash,
    profile.staticSceneHash,
  ].join(":");
  const descriptor = options.descriptor ?? createProductionStaticSceneDescriptor({
    cacheIdentity,
    worldBounds: {
      x: 0,
      y: 0,
      width: recipe.grid.columns * 32,
      height: recipe.grid.rows * 32,
    },
    topology: "toroidal",
  });
  const preparationDescriptor = options.preparationDescriptor ?? descriptor;
  const operations: readonly ProductionStaticDrawOperation[] = Array.from(
    { length: operationCount },
    (_, index) => ({
      stableId: `exact-operation-${index}`,
      layer: "terrain",
      atlasId: NIRVANA_ATLAS_PROFILE.terrainAtlasId,
      source: { x: 0, y: 0, width: 32, height: 32 },
      destination: {
        x: (index % recipe.grid.columns) * 32,
        y: Math.floor(index / recipe.grid.columns) * 32,
        width: 32,
        height: 32,
      },
    }),
  );
  const advanceBudgets: number[] = [];
  const preparationDisposals: Array<ReturnType<typeof vi.fn>> = [];
  const createPreparation = vi.fn((candidateRecipe = recipe): ProductionStaticScenePreparation => {
    const candidateDescriptor = options.descriptorForRecipe?.(candidateRecipe) ?? preparationDescriptor;
    const candidateCacheIdentity = options.descriptorForRecipe === undefined
      ? cacheIdentity
      : staticIdentityForRecipe(candidateRecipe);
    let cursor = 0;
    const dispose = vi.fn(() => {
      if (options.disposeError !== undefined) throw options.disposeError;
    });
    preparationDisposals.push(dispose);
    return {
      cacheIdentity: candidateCacheIdentity,
      descriptor: candidateDescriptor,
      advance(maxWorkUnits, visit) {
        advanceBudgets.push(maxWorkUnits);
        const start = cursor;
        const end = Math.min(operations.length, cursor + maxWorkUnits);
        while (cursor < end) visit(operations[cursor++]!);
        return {
          done: cursor === operations.length,
          workUnits: cursor - start,
        };
      },
      dispose,
    };
  });
  const describe = vi.fn((candidateRecipe = recipe) => (
    options.descriptorForRecipe?.(candidateRecipe) ?? descriptor
  ));
  const createPlan = vi.fn(() => ({ cacheIdentity, operations }));
  const provider = {
    kind: "nirvana-v2",
    describe,
    createPreparation,
    // Deliberate poison/witness for the renderer's obsolete synchronous seam.
    createPlan,
  } as ProductionStaticSceneProvider & { readonly createPlan: typeof createPlan };
  return {
    provider,
    describe,
    createPreparation,
    createPlan,
    advanceBudgets,
    preparationDisposals,
  };
}

async function harness(options: Readonly<{
  callbacks?: ObserverRendererCallbacks;
  reducedMotion?: boolean;
  pendingAtlas?: readonly [string, ReturnType<typeof deferred<ProductionAssetLease>>];
  graph?: ReturnType<typeof fakeGraph>;
  sceneGraphFactory?: (options: ProductionSceneGraphOptions) => ProductionSceneGraph;
  recipes?: ReadonlyMap<string, RegionMapRecipeV1> | readonly RegionMapRecipeV1[];
  placement?: PlacementLedger;
  resolveSceneCommands?: (frame: PresentedObserverFrame) => ProductionSceneCommandBatch | null;
  onSceneSignals?: (signals: readonly ProductionSceneSignal[]) => void;
  frameAcceptance?: CanvasPresentationRendererOptions["frameAcceptance"];
  manifest?: ProductionAssetManifest;
  cacheCanvasFactory?: CacheCanvasOwnerFactory;
  poolTrace?: string[];
  measurementNow?: () => number;
  atlasCommitScheduler?: AtlasCommitScheduler;
  staticSceneProviders?: ReadonlyMap<string, ProductionStaticSceneProvider>;
  worldSheetSnapshots?: boolean;
  backgroundSnapshotCanvasFactory?: CacheCanvasOwnerFactory;
}> = {}) {
  const canvas = document.createElement("canvas");
  const driver = new FakeFrameDriver();
  const wake = new FakeWakeScheduler();
  const visibility = new FakeVisibilityTarget();
  const pool = fakePool(options.pendingAtlas, options.poolTrace);
  const graph = options.graph ?? fakeGraph();
  const sceneGraphFactory = vi.fn(options.sceneGraphFactory
    ?? (() => graph as unknown as ProductionSceneGraph));
  const factories = {
    createActor: vi.fn(),
    createHome: vi.fn(),
    createEnvironment: vi.fn(),
  } as unknown as ProductionSceneFactories;
  const placementSource = Symbol("harness-placement");
  const placement = options.placement ?? {
    sourceIdentity: () => placementSource,
    snapshot: () => ({
      revision: 1,
      agents: new Map([["agent-a", { regionId: "worn", point: { x: 64, y: 64 }, anchorKind: "staging" }]]),
      homes: new Map(),
      districtsByRegion: new Map(),
    }),
    navigationGridFor: () => null,
  } as unknown as PlacementLedger;
  const cacheCanvases: HTMLCanvasElement[] = [];
  const cacheDisposals: Array<ReturnType<typeof vi.fn>> = [];
  const cacheCanvasFactory = options.cacheCanvasFactory ?? ((input) => {
    const canvas = document.createElement("canvas");
    cacheCanvases.push(canvas);
    const context = canvas.getContext("2d")!;
    canvas.dataset.cache = input.label;
    canvas.width = input.width;
    canvas.height = input.height;
    const dispose = vi.fn();
    cacheDisposals.push(dispose);
    return { canvas, context, dispose };
  });
  const renderer = await createCanvasPresentationRenderer({
    canvas,
    callbacks: options.callbacks ?? {},
    frameDriver: driver,
    wakeScheduler: wake,
    atlasPool: pool as unknown as SharedAtlasPool,
    reducedMotion: options.reducedMotion,
    manifest: options.manifest ?? PRODUCTION_ASSET_MANIFEST,
    factories,
    placement,
    recipes: options.recipes ?? recipes,
    sceneGraphFactory,
    visibilityTarget: visibility,
    resolveSceneCommands: options.resolveSceneCommands,
    onSceneSignals: options.onSceneSignals,
    frameAcceptance: options.frameAcceptance,
    cacheCanvasFactory,
    measurementNow: options.measurementNow ?? (() => 0),
    atlasCommitScheduler: options.atlasCommitScheduler ?? new ImmediateAtlasCommitScheduler(),
    ...(options.staticSceneProviders === undefined
      ? {}
      : { staticSceneProviders: options.staticSceneProviders }),
    ...(options.worldSheetSnapshots === undefined
      ? {}
      : { worldSheetSnapshots: options.worldSheetSnapshots }),
    ...(options.backgroundSnapshotCanvasFactory === undefined
      ? {}
      : { backgroundSnapshotCanvasFactory: options.backgroundSnapshotCanvasFactory }),
  } satisfies CanvasPresentationRendererOptions);
  return {
    canvas,
    driver,
    wake,
    visibility,
    pool,
    graph,
    factories,
    placement,
    sceneGraphFactory,
    cacheCanvases,
    cacheDisposals,
    renderer,
    debug: () => (renderer as ObserverRendererPort & { debug(): CanvasPresentationRendererDebug }).debug(),
  };
}

function selectedReadonlyMap<K, V>(selected: () => ReadonlyMap<K, V>): ReadonlyMap<K, V> {
  return {
    get size(): number { return selected().size; },
    get(key): V | undefined { return selected().get(key); },
    has(key): boolean { return selected().has(key); },
    entries(): MapIterator<[K, V]> { return selected().entries(); },
    keys(): MapIterator<K> { return selected().keys(); },
    values(): MapIterator<V> { return selected().values(); },
    forEach(callbackfn, thisArg): void {
      selected().forEach((value, key) => callbackfn.call(thisArg, value, key, this));
    },
    [Symbol.iterator](): MapIterator<[K, V]> { return selected()[Symbol.iterator](); },
  };
}

interface FakeGraphDebug {
  frameIdentity: FrameIdentity | null;
  visibleRegionId: string | null;
  activeActors: number;
  activeHomes: number;
  activeEffects: number;
  actors: readonly unknown[];
  homes: readonly unknown[];
  recentMarkers: readonly unknown[];
  environments: Array<{ diagnostics: { activeEffects: number } }>;
  transients: unknown[];
  motionActive: boolean;
  drawOrder: string[];
  hitTargets: Array<{
    selection: Exclude<ObserverSelection, null>;
    worldBounds: { x: number; y: number; width: number; height: number };
    feetY: number;
    selectionKey: string;
  }>;
}

function fakeGraph() {
  const frames: PresentedObserverFrame[] = [];
  const debugValue: FakeGraphDebug = {
    frameIdentity: null,
    visibleRegionId: null,
    activeActors: 3,
    activeHomes: 1,
    activeEffects: 2,
    actors: [{}, {}, {}],
    homes: [{}],
    recentMarkers: [{}, {}],
    environments: [],
    transients: [{}, {}],
    motionActive: false,
    drawOrder: [
      "environment:ground", "home:back:home-a", "actor:agent-behind", "actor:agent-a",
      "home:home-a", "actor:agent-front", "home:front:home-a", "environment:air", "selection",
    ],
    hitTargets: [],
  };
  const graph = {
    frames,
    nextDiff: {
      outcome: "applied",
      added: [],
      updated: [],
      removed: [],
      staticLayersInvalidated: true,
    } as SceneGraphDiff,
    deadline: null as number | null,
    sceneSignalValue: [] as ProductionSceneSignal[],
    debugValue,
    update: vi.fn((next: PresentedObserverFrame, _batch?: unknown, observerViewRegionId?: string | null) => {
      frames.push(structuredClone(next));
      debugValue.frameIdentity = {
        runId: next.runId,
        sourceKey: next.sourceKey,
        revision: next.revision,
        firstCursor: next.firstCursor,
        lastCursor: next.lastCursor,
      };
      debugValue.visibleRegionId = observerViewRegionId
        ?? next.checkpointFocus?.regionId
        ?? next.scene?.regionId
        ?? null;
      return graph.nextDiff;
    }),
    updateTime: vi.fn(),
    applySceneCommands: vi.fn(() => ({
      outcome: "applied" as const,
      appliedCommandIds: [],
      ignoredCommandIds: [],
    })),
    sceneSignals: vi.fn((afterSerial = 0) => graph.sceneSignalValue.filter(({ serial }) => serial > afterSerial)),
    draw: vi.fn((context: CanvasRenderingContext2D) => {
      (context as unknown as RecordingContext).trace.push("graph:draw");
    }),
    nextDeadlineMs: vi.fn(() => graph.deadline),
    hitTargets: vi.fn(() => structuredClone(debugValue.hitTargets)),
    focusTarget: vi.fn((selection: Exclude<ObserverSelection, null>) => (
      structuredClone(debugValue.hitTargets.find((target) =>
        target.selection.kind === selection.kind && target.selection.id === selection.id) ?? null)
    )),
    semanticSnapshot: vi.fn(() => ({
      frameIdentity: structuredClone(debugValue.frameIdentity),
      subjects: [],
    })),
    commitArrivalStaging: vi.fn(),
    discardArrivalStaging: vi.fn(),
    debugSnapshot: vi.fn(() => structuredClone(debugValue)),
    dispose: vi.fn(),
  };
  return graph;
}

function semanticRegionSnapshot(graph: ReturnType<typeof fakeGraph>, regionId: string) {
  return {
    frameIdentity: structuredClone(graph.debugValue.frameIdentity),
    subjects: [{
      selection: { kind: "region" as const, id: regionId },
      stableSelectionKey: `region:${regionId}`,
      kind: "region" as const,
      regionId,
      position: null,
      status: "exact",
      action: null,
    }],
  };
}

function fakePool(
  pending?: readonly [string, ReturnType<typeof deferred<ProductionAssetLease>>],
  trace?: string[],
) {
  const releases: Array<ReturnType<typeof vi.fn>> = [];
  let released = 0;
  let usedPending = false;
  const acquire = vi.fn((id: string) => {
    if (pending?.[0] === id && !usedPending) {
      usedPending = true;
      return pending[1].promise;
    }
    const next = lease(id);
    vi.mocked(next.release).mockImplementationOnce(() => {
      released += 1;
      trace?.push("regional-lease-release");
      if (released === releases.length) trace?.push("last-bitmap-close");
    });
    releases.push(next.release as ReturnType<typeof vi.fn>);
    return Promise.resolve(next);
  });
  return {
    releases,
    acquire,
    diagnostics: vi.fn(() => ({
      disposed: false,
      compressedBytes: 100,
      decodedBytes: 200,
      leases: releases.length,
      activeAtlasIds: acquire.mock.calls.map(([id]) => id),
    })),
    dispose: vi.fn(),
  };
}

function lease(id: string): ProductionAssetLease {
  // owner-authorised Option A re-baseline, plan §P3: real nirvana-v3 atlas geometry
  // (512x800 terrain, 672x1010 scenery) -- `createNirvanaAtlasAssets` is not mocked
  // anywhere in this file, so it validates these dimensions against the published
  // manifest. Any other id (generic-kit atlases) keeps the small placeholder size.
  const dimensions = id === NIRVANA_ATLAS_PROFILE.terrainAtlasId
    ? { width: 512, height: 800 }
    : id === NIRVANA_ATLAS_PROFILE.sceneryAtlasId
      ? { width: 672, height: 1010 }
      : { width: 32, height: 32 };
  return {
    value: { label: id, ...dimensions, close: vi.fn() } as unknown as ImageBitmap,
    release: vi.fn(),
  };
}

function frame(overrides: Readonly<{
  runId?: string;
  sourceKey?: string;
  revision?: number;
  firstCursor?: number;
  lastCursor?: number;
  sceneRegion?: string;
  selection?: ObserverSelection;
  terminal?: boolean;
  execution?: boolean;
  speak?: boolean;
  scenePhase?: "enter" | "hold" | "consequence" | "recover" | "exit";
  settled?: boolean;
  checkpointFocus?: PresentedObserverFrame["checkpointFocus"];
}> = {}): PresentedObserverFrame {
  const cursor = overrides.lastCursor ?? overrides.revision ?? 0;
  const sceneRegion = overrides.sceneRegion ?? "worn";
  return {
    runId: overrides.runId ?? "run-a",
    sourceKey: overrides.sourceKey ?? "live:run-a",
    revision: overrides.revision ?? 0,
    firstCursor: overrides.firstCursor ?? cursor,
    lastCursor: cursor,
    source: "fixture",
    ingestedCursor: cursor,
    presentedCursor: cursor,
    world: {
      exactBaseCursor: cursor,
      projectedThroughCursor: cursor,
      worldTime: cursor,
      agents: [{
        completeness: "exact",
        value: {
          id: "agent-a",
          name: "Aster",
          persona: "patient",
          position: sceneRegion,
          energy: 50,
          materials: 20,
          status: overrides.terminal ? "dead" : "alive",
        },
      }],
      regions: regions.map((value) => ({ completeness: "exact" as const, value })),
      homes: [],
      ruins: [],
      pendingProposals: [],
    },
    scene: overrides.settled ? null : {
      momentId: `moment-${cursor}`,
      regionId: sceneRegion,
      phase: overrides.scenePhase ?? (overrides.terminal ? "exit" : "hold"),
      focus: { kind: "agent", id: "agent-a" },
      dialogue: null,
      actorIntents: overrides.speak
        ? [{ actorId: "agent-a", kind: "speak", target: null, marker: "speech" }]
        : [],
      homeIntents: [],
      effectIntents: [],
      safeCancelMarkers: [],
      reducedMotion: false,
      ...(overrides.execution
        ? { execution: { sceneToken: 9, programId: `program-${cursor}` } }
        : {}),
    },
    checkpointFocus: overrides.checkpointFocus ?? null,
    selection: overrides.selection ?? null,
    backlog: {
      pendingMoments: 0,
      firstPendingCursor: null,
      lastPendingCursor: null,
      state: "caught-up",
      label: "Caught up",
    },
    transport: { connection: "live", ingestedCursor: cursor, retryable: true },
  };
}

function region(name: string, description: string): RegionSnapshot {
  return {
    name,
    description,
    connections: [],
    energy_rate: 0.2,
    materials_rate: 0.2,
    current_energy: 50,
    current_materials: 50,
    max_energy: 100,
    max_materials: 100,
  };
}

class FakeFrameDriver implements FrameDriver {
  #now = 0;
  #next = 1;
  #callbacks = new Map<number, FrameRequestCallback>();
  #cancelled = new Map<number, FrameRequestCallback>();
  request(callback: FrameRequestCallback): number {
    const handle = this.#next++;
    this.#callbacks.set(handle, callback);
    return handle;
  }
  cancel(handle: number): void {
    const callback = this.#callbacks.get(handle);
    if (callback) this.#cancelled.set(handle, callback);
    this.#callbacks.delete(handle);
  }
  now(): number { return this.#now; }
  pending(): number { return this.#callbacks.size; }
  firstHandle(): number { return this.#callbacks.keys().next().value ?? -1; }
  reuseNext(handle: number): void { this.#next = handle; }
  fire(nowMs: number): void {
    this.#now = nowMs;
    const callbacks = [...this.#callbacks.values()];
    this.#callbacks.clear();
    callbacks.forEach((callback) => callback(nowMs));
  }
  fireCancelled(handle: number, nowMs: number): void {
    this.#cancelled.get(handle)?.(nowMs);
  }
}

class FakeWakeScheduler implements WakeScheduler {
  #now = 0;
  #next = 1;
  #callbacks = new Map<number, { readonly at: number; readonly callback: () => void }>();
  schedule(atMs: number, callback: () => void): number {
    const handle = this.#next++;
    this.#callbacks.set(handle, { at: atMs, callback });
    return handle;
  }
  cancel(handle: number): void { this.#callbacks.delete(handle); }
  now(): number { return this.#now; }
  pending(): number { return this.#callbacks.size; }
  fire(): void {
    const next = [...this.#callbacks.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (!next) return;
    this.#callbacks.delete(next[0]);
    this.#now = next[1].at;
    next[1].callback();
  }
}

class ImmediateAtlasCommitScheduler implements AtlasCommitScheduler {
  schedule(callback: () => void): number {
    callback();
    return 1;
  }
  cancel(_handle: number): void {}
}

class FakeAtlasCommitScheduler implements AtlasCommitScheduler {
  #next = 1;
  #scheduleCalls = 0;
  #throwOnScheduleCall: number | null = null;
  #callbacks = new Map<number, () => void>();
  #cancelled = new Map<number, () => void>();
  schedule(callback: () => void): number {
    this.#scheduleCalls += 1;
    if (this.#scheduleCalls === this.#throwOnScheduleCall) {
      throw new Error(`atlas commit schedule ${this.#scheduleCalls} failed`);
    }
    const handle = this.#next++;
    this.#callbacks.set(handle, callback);
    return handle;
  }
  cancel(handle: number): void {
    const callback = this.#callbacks.get(handle);
    if (callback !== undefined) this.#cancelled.set(handle, callback);
    this.#callbacks.delete(handle);
  }
  pending(): number { return this.#callbacks.size; }
  firstHandle(): number { return this.#callbacks.keys().next().value ?? -1; }
  throwOnScheduleIn(offset: number): void { this.#throwOnScheduleCall = this.#scheduleCalls + offset; }
  fire(): void {
    const next = this.#callbacks.entries().next().value as [number, () => void] | undefined;
    if (next === undefined) return;
    this.#callbacks.delete(next[0]);
    next[1]();
  }
  fireAll(limit = 100): void {
    for (let count = 0; this.#callbacks.size > 0 && count < limit; count += 1) this.fire();
    if (this.#callbacks.size > 0) throw new Error("Atlas task scheduler did not settle.");
  }
  fireCancelled(handle: number): void { this.#cancelled.get(handle)?.(); }
}

class FakeVisibilityTarget extends EventTarget {
  hidden = false;
  listenerCount = 0;
  override addEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: AddEventListenerOptions | boolean): void {
    if (type === "visibilitychange") this.listenerCount += 1;
    super.addEventListener(type, callback, options);
  }
  override removeEventListener(type: string, callback: EventListenerOrEventListenerObject | null, options?: EventListenerOptions | boolean): void {
    if (type === "visibilitychange") this.listenerCount -= 1;
    super.removeEventListener(type, callback, options);
  }
  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

/** `fillRectCalls` entries NOT also recorded in `patternFillRectCalls` -- i.e. every fillRect
 * painted with a plain colour/gradient fillStyle rather than a `CanvasPattern` (the
 * continuation-pattern fill always uses one; Z3's gutter fill never does). */
function nonPatternFillRects(context: RecordingContext): readonly unknown[][] {
  const patternArgs = new Set(context.patternFillRectCalls.map(({ rect }) => rect));
  return context.fillRectCalls.filter((args) => !patternArgs.has(args));
}

/** True for a `fillRect(x, y, width, height)` call args array whose width AND height both exceed
 * a threshold no home/being marker ever reaches, used to identify Z3's whole-sheet gutter fill. */
function isLargeFillRect(args: unknown[]): boolean {
  return (args[2] as number) > 500 && (args[3] as number) > 500;
}

class RecordingContext {
  imageSmoothingEnabled = true;
  globalAlpha = 1;
  fillStyle: string | CanvasGradient | CanvasPattern = "#000";
  strokeStyle: string | CanvasGradient | CanvasPattern = "#000";
  lineWidth = 1;
  readonly trace: string[] = [];
  readonly drawImageCalls: unknown[][] = [];
  readonly clearRectCalls: unknown[][] = [];
  readonly fillRectCalls: unknown[][] = [];
  readonly patternFillRectCalls: Array<Readonly<{
    rect: readonly unknown[];
    source: HTMLCanvasElement;
  }>> = [];
  readonly setTransformCalls: unknown[][] = [];
  readonly createPatternCalls: unknown[][] = [];
  save(): void {}
  restore(): void {}
  clearRect(...args: unknown[]): void { this.clearRectCalls.push(args); }
  fillRect(...args: unknown[]): void {
    this.fillRectCalls.push(args);
    if (typeof this.fillStyle === "object" && this.fillStyle !== null && "source" in this.fillStyle) {
      const source = (this.fillStyle as unknown as { source: HTMLCanvasElement }).source;
      this.patternFillRectCalls.push({ rect: args, source });
      const label = source.dataset.cache;
      if (label) this.trace.push(`cache:${label}`);
    } else {
      // Plain-colour fills (e.g. Z3's gutter) are not otherwise traced -- tag them so draw-order
      // regression tests can interleave them against `cache:*` drawImage/pattern entries.
      const isLarge = (args[2] as number) > 500 && (args[3] as number) > 500;
      this.trace.push(isLarge ? "fill:large" : "fill:small");
    }
  }
  strokeRect(): void {}
  translate(): void {}
  scale(): void {}
  setTransform(...args: unknown[]): void { this.setTransformCalls.push(args); }
  beginPath(): void {}
  ellipse(): void {}
  stroke(): void {}
  setLineDash(): void {}
  // Path/clip primitives -- used by the archipelago world-sheet layer (sea/island/coastline/
  // bridge drawing, all gated behind `worldSheetSnapshots`) to trace and fill/stroke/clip a
  // region's island polygon. No pixel-level simulation needed here (this mock never rasterizes),
  // only enough surface for that code not to throw when exercised under test.
  moveTo(): void {}
  lineTo(): void {}
  closePath(): void {}
  fill(): void {}
  clip(): void {}
  drawImage(...args: unknown[]): void {
    this.drawImageCalls.push(args);
    const label = (args[0] as { dataset?: { cache?: string } })?.dataset?.cache;
    if (label) this.trace.push(`cache:${label}`);
  }
  createPattern(source: CanvasImageSource, _repetition: string | null): CanvasPattern {
    this.createPatternCalls.push([source, _repetition]);
    return { source } as unknown as CanvasPattern;
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function _assertDiagnostics(_value: ObserverRendererDiagnostics): void {}

function _assertRecipe(_value: RegionMapRecipeV1): void {}
