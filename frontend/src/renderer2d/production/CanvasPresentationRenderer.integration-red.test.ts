import { beforeEach, describe, expect, it, vi } from "vitest";

import type { AgentSnapshot, HomeSnapshot, RegionSnapshot } from "../../app/schemas";
import type { ObserverRendererCallbacks, ObserverRendererPort } from "../../presentation/rendererPort";
import type { PresentedObserverFrame, PresentedRecord } from "../../presentation/contracts";
import type { FrameDriver, WakeScheduler } from "../contracts";
import { tileCenter } from "../map/regionMap";
import { LayeredHumanActor, type HumanPrimitiveCommand } from "./actors/LayeredHumanActor";
import {
  PRODUCTION_ASSET_MANIFEST,
  type ProductionAssetLease,
} from "./assets/productionManifest";
import type {
  SharedAtlasPool,
  SharedAtlasPoolDiagnostics,
} from "./assets/SharedAtlasPool";
import {
  createCanvasPresentationRenderer,
  type CanvasPresentationRenderer,
  type CanvasPresentationRendererOptions,
} from "./CanvasPresentationRenderer";
import { EnvironmentSystem } from "./environment/EnvironmentSystem";
import { HomeActor } from "./homes/HomeActor";
import { createRegionMapIdentity } from "./maps/RegionMapIdentity";
import { createRegionMapRecipe, type RegionMapRecipeV1 } from "./maps/RegionMapRecipe";
import { PlacementLedger } from "./placement/PlacementLedger";
import { feetAnchoredVisualRect } from "./productionGeometry";
import type {
  ProductionSceneFactories,
  ProductionSceneGraph,
  ProductionSceneGraphOptions,
  SceneGraphDiff,
} from "./ProductionSceneGraph";
import { createProductionSceneGraph } from "./ProductionSceneGraph";
import type { ProductionSceneCommandBatch } from "./ProductionSceneBridge";

const REGIONS: readonly RegionSnapshot[] = [
  region("worn", "a once-heavenly landscape, now thinning and picked-over", ["spring"]),
  region("spring", "hot spring lakes", []),
];
const RECIPES = REGIONS.map((value) =>
  createRegionMapRecipe(createRegionMapIdentity(171, value, REGIONS)));
const RECIPE_MAP = new Map(RECIPES.map((recipe) => [recipe.regionId, recipe]));

let contexts = new Map<HTMLCanvasElement, RecordingContext>();

beforeEach(() => {
  contexts = new Map<HTMLCanvasElement, RecordingContext>();
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

describe("CanvasPresentationRenderer hostile integration REDs", () => {
  it("uses the observed region as the real Graph view when the accepted frame has no active scene", async () => {
    const regionValues = [
      region("ember_reach", "A blasted nuclear wasteland, black stone and all but dead.", []),
      region("mossward", "A thinning, picked-over heartland of moss and old pines.", []),
      region("nirvana", "A once-heavenly landscape, now thinning and picked-over.", []),
      region("nirvana_east", "A struggling, near-barren stretch.", []),
      region("nirvana_west", "A nuclear wasteland, all but dead.", []),
      region("quiet_coast", "An unfamiliar temperate coast with low woodland and meadow.", []),
      region("salt_scrub", "A struggling barren salt flat with thorn scrub and dry gullies.", []),
      region("warm_springs", "Hot spring lakes and green terraces form the least-poor refuge.", []),
    ] as const;
    const recipeValues = regionValues.map((value) =>
      createRegionMapRecipe(createRegionMapIdentity(171, value, regionValues)));
    const aster = agentSnapshot("aster", "nirvana");
    const standing = homeSnapshot("home-a", "aster", "nirvana");
    const ruin = { ...homeSnapshot("ruin-a", "aster", "nirvana"), status: "ruin" as const, ruined_at: 70 };
    const placement = PlacementLedger.reconstruct(recipeValues, {
      agents: [aster],
      homes: [standing, ruin],
    });
    const pool = new ScriptedAtlasPool((id) => Promise.resolve(manifestLease(id)));
    const semantics: Parameters<NonNullable<ObserverRendererCallbacks["onSemanticSnapshot"]>>[0][] = [];
    const renderer = await createCanvasPresentationRenderer({
      canvas: document.createElement("canvas"),
      callbacks: { onSemanticSnapshot: (snapshot) => semantics.push(snapshot) },
      manifest: PRODUCTION_ASSET_MANIFEST,
      factories: REAL_FACTORIES,
      placement,
      recipes: recipeValues,
      atlasPool: pool,
      frameDriver: new FakeFrameDriver(),
      wakeScheduler: new FakeWakeScheduler(),
      visibilityTarget: new FakeVisibilityTarget(),
    }) as CanvasPresentationRenderer;
    renderer.updatePresentation(frame({
      revision: 1,
      regionId: "ember_reach",
      regions: regionValues,
      agents: [aster],
      homes: [standing],
      ruins: [ruin],
      sceneNull: true,
    }));
    await settle();

    renderer.observeRegion("nirvana");
    await settle();

    expect(renderer.debug()).toMatchObject({
      visibleRegionId: "nirvana",
      graph: {
        activeRegion: { id: "nirvana" },
        actors: [expect.objectContaining({ id: "aster" })],
        homes: expect.arrayContaining([
          expect.objectContaining({ id: "home-a", kind: "home" }),
          expect.objectContaining({ id: "ruin-a", kind: "ruin" }),
        ]),
      },
    });
    expect(semantics.at(-1)?.subjects).toEqual([
      expect.objectContaining({ kind: "region", regionId: "nirvana" }),
      expect.objectContaining({ kind: "agent", regionId: "nirvana" }),
      expect.objectContaining({ kind: "home", regionId: "nirvana" }),
      expect.objectContaining({ kind: "ruin", regionId: "nirvana" }),
    ]);
    renderer.dispose();
  });

  it("publishes the real observed-region Graph semantics after an observer-only swap", async () => {
    const aster = agentSnapshot("aster", "spring");
    const standing = homeSnapshot("home-a", "aster", "spring");
    const ruin = { ...homeSnapshot("ruin-a", "aster", "spring"), status: "ruin" as const, ruined_at: 70 };
    const placement = PlacementLedger.reconstruct(RECIPES, {
      agents: [aster],
      homes: [standing, ruin],
    });
    const pool = new ScriptedAtlasPool((id) => Promise.resolve(manifestLease(id)));
    const semantics: Parameters<NonNullable<ObserverRendererCallbacks["onSemanticSnapshot"]>>[0][] = [];
    const renderer = await createCanvasPresentationRenderer({
      canvas: document.createElement("canvas"),
      callbacks: { onSemanticSnapshot: (snapshot) => semantics.push(snapshot) },
      manifest: PRODUCTION_ASSET_MANIFEST,
      factories: REAL_FACTORIES,
      placement,
      recipes: RECIPE_MAP,
      atlasPool: pool,
      frameDriver: new FakeFrameDriver(),
      wakeScheduler: new FakeWakeScheduler(),
      visibilityTarget: new FakeVisibilityTarget(),
    }) as CanvasPresentationRenderer;
    const accepted = frame({
      revision: 1,
      regionId: "worn",
      agents: [aster],
      homes: [standing],
      ruins: [ruin],
    });
    renderer.updatePresentation(accepted);
    await settle();

    renderer.observeRegion("spring");
    await settle();

    expect(renderer.debug()).toMatchObject({
      frameIdentity: {
        runId: accepted.runId,
        sourceKey: accepted.sourceKey,
        revision: accepted.revision,
      },
      visibleRegionId: "spring",
      graph: { activeRegion: { id: "spring" } },
    });
    expect(semantics.at(-1)).toMatchObject({
      frameIdentity: {
        runId: accepted.runId,
        sourceKey: accepted.sourceKey,
        revision: accepted.revision,
      },
      subjects: [
        expect.objectContaining({ kind: "region", selection: { kind: "region", id: "spring" } }),
        expect.objectContaining({ kind: "agent", selection: { kind: "agent", id: "aster" }, regionId: "spring" }),
        expect.objectContaining({ kind: "home", selection: { kind: "home", id: "home-a" }, regionId: "spring" }),
        expect.objectContaining({ kind: "ruin", selection: { kind: "ruin", id: "ruin-a" }, regionId: "spring" }),
      ],
    });
    renderer.dispose();
  });

  it("FINAL RED: real Graph retains one traveller while origin regional pool refs reach zero", async () => {
    const traveler = agentSnapshot("traveler", "worn");
    const placement = PlacementLedger.reconstruct(RECIPES, { agents: [traveler], homes: [] });
    let pool!: ScriptedAtlasPool;
    pool = new ScriptedAtlasPool((id): Promise<ProductionAssetLease<ImageBitmap>> => Promise.resolve(pool.newLease(id)));
    const driver = new FakeFrameDriver();
    const wake = new FakeWakeScheduler();
    const renderer = await createCanvasPresentationRenderer({
      canvas: document.createElement("canvas"),
      callbacks: {},
      manifest: PRODUCTION_ASSET_MANIFEST,
      factories: REAL_FACTORIES,
      placement,
      recipes: RECIPE_MAP,
      atlasPool: pool,
      frameDriver: driver,
      wakeScheduler: wake,
      visibilityTarget: new FakeVisibilityTarget(),
      resolveSceneCommands: (next) => ({
        identity: {
          runId: next.runId, sourceKey: next.sourceKey, revision: next.revision,
          firstCursor: next.firstCursor, lastCursor: next.lastCursor,
        },
        sceneToken: 700,
        commands: next.revision === 1
          ? [{
              kind: "retain-traveler" as const, commandId: "retain:pool", actorId: traveler.id,
              fromRegion: "worn", toRegion: "spring",
            }]
          : [{
              kind: "retain-traveler" as const, commandId: "retain:pool", actorId: traveler.id,
              fromRegion: "worn", toRegion: "spring",
            }, {
              kind: "stage-arrival" as const, commandId: "stage:pool", actorId: traveler.id,
              fromRegion: "worn", toRegion: "spring", eventType: "agent_entered_region" as const,
              phase: "hold" as const, momentId: "pool-arrival",
              programId: "choreography:pool-arrival:agent_entered_region",
            }],
      }),
    }) as CanvasPresentationRenderer;
    renderer.updatePresentation(frame({ revision: 1, regionId: "worn", agents: [traveler] }));
    await settle();
    const instanceId = renderer.debug().graph.actors[0]!.instanceId;
    const originRegional = PRODUCTION_ASSET_MANIFEST.regions[RECIPE_MAP.get("worn")!.kit].atlasIds;

    const destination = frame({ revision: 2, regionId: "spring", agents: [traveler] });
    renderer.updatePresentation({
      ...destination,
      scene: {
        ...destination.scene!,
        momentId: "pool-arrival",
        focus: { kind: "agent", id: traveler.id },
        execution: {
          sceneToken: 700,
          programId: "choreography:pool-arrival:agent_entered_region",
          eventType: "agent_entered_region",
        },
        effectIntents: [{ kind: "atlas-transition", sourceId: "worn", targetId: "spring" }],
      },
    });
    await settle();
    expect(renderer.debug()).toMatchObject({
      visibleRegionId: "spring",
      graph: {
        activeRegion: { id: "spring" },
        actors: [expect.objectContaining({ id: traveler.id, instanceId })],
      },
    });
    expect(originRegional.every((id) => pool.records
      .filter((record) => record.id === id)
      .every(({ lease }) => vi.mocked(lease.release).mock.calls.length === 1))).toBe(true);
    const coreActorRecords = pool.records.filter((record) =>
      PRODUCTION_ASSET_MANIFEST.atlases[record.id]!.group === "core"
      && vi.mocked(record.lease.release).mock.calls.length === 0);
    expect(coreActorRecords.length).toBeGreaterThan(0);

    renderer.dispose();
    expect(pool.records.every(({ lease }) => vi.mocked(lease.release).mock.calls.length === 1)).toBe(true);
  });

  it.each([false, true])(
    "keeps one real entered-region traveller instance hidden through a Free observer detour (reduced=%s)",
    async (reducedMotion) => {
      const traveler = agentSnapshot("traveler", "worn");
      const placement = PlacementLedger.reconstruct(RECIPES, { agents: [traveler], homes: [] });
      const placementBefore = placement.snapshot();
      let pool!: ScriptedAtlasPool;
      pool = new ScriptedAtlasPool((id): Promise<ProductionAssetLease<ImageBitmap>> =>
        Promise.resolve(pool.newLease(id)));
      const momentId = "canvas-observer-detour";
      const programId = `choreography:${momentId}:agent_entered_region`;
      const sceneToken = 702;
      const gate = tileCenter(RECIPE_MAP.get("spring")!.gates.find((candidate) => (
        candidate.role === "arrival"
        && candidate.edge.from === "worn"
        && candidate.edge.to === "spring"
      ))!.tile);
      const renderer = await createCanvasPresentationRenderer({
        canvas: document.createElement("canvas"),
        callbacks: {},
        manifest: PRODUCTION_ASSET_MANIFEST,
        factories: REAL_FACTORIES,
        placement,
        recipes: RECIPES,
        atlasPool: pool,
        reducedMotion,
        frameDriver: new FakeFrameDriver(),
        wakeScheduler: new FakeWakeScheduler(),
        visibilityTarget: new FakeVisibilityTarget(),
        resolveSceneCommands: (next) => ({
          identity: {
            runId: next.runId,
            sourceKey: next.sourceKey,
            revision: next.revision,
            firstCursor: next.firstCursor,
            lastCursor: next.lastCursor,
          },
          sceneToken,
          commands: next.revision === 1
            ? [{
                kind: "retain-traveler" as const,
                commandId: "retain:canvas-observer-detour",
                actorId: traveler.id,
                fromRegion: "worn",
                toRegion: "spring",
              }]
            : [{
                kind: "retain-traveler" as const,
                commandId: "retain:canvas-observer-detour",
                actorId: traveler.id,
                fromRegion: "worn",
                toRegion: "spring",
              }, {
                kind: "stage-arrival" as const,
                commandId: "stage:canvas-observer-detour",
                actorId: traveler.id,
                fromRegion: "worn",
                toRegion: "spring",
                eventType: "agent_entered_region" as const,
                phase: "hold" as const,
                momentId,
                programId,
              }],
        }),
      }) as CanvasPresentationRenderer;

      renderer.updatePresentation(frame({ revision: 1, regionId: "worn", agents: [traveler] }));
      await settle();
      const sourceInstanceId = renderer.debug().graph.actors[0]!.instanceId;
      const destination = frame({ revision: 2, regionId: "spring", agents: [traveler] });
      renderer.updatePresentation({
        ...destination,
        scene: {
          ...destination.scene!,
          momentId,
          focus: { kind: "agent", id: traveler.id },
          execution: { sceneToken, programId, eventType: "agent_entered_region" },
          effectIntents: [{ kind: "atlas-transition", sourceId: "worn", targetId: "spring" }],
        },
      });
      await settle();
      expect(renderer.debug().graph.actors).toContainEqual(expect.objectContaining({
        id: traveler.id,
        instanceId: sourceInstanceId,
        position: gate,
      }));

      renderer.setCameraMode("free");
      renderer.observeRegion("worn");
      await settle();
      expect(renderer.debug()).toMatchObject({
        visibleRegionId: "worn",
        camera: { mode: "free" },
        graph: { activeRegion: { id: "worn" }, actors: [] },
      });

      renderer.setCameraMode("story");
      await settle();
      expect(renderer.debug()).toMatchObject({
        visibleRegionId: "spring",
        camera: { mode: "story" },
        graph: {
          activeRegion: { id: "spring" },
          actors: [expect.objectContaining({
            id: traveler.id,
            instanceId: sourceInstanceId,
            position: gate,
          })],
        },
      });
      expect(placement.snapshot()).toEqual(placementBefore);
      expect(renderer.debug().graph.regionTransitions).toEqual([]);
      expect(renderer.debug().graph.recentMarkers.some(({ marker }) => marker === "repositioned")).toBe(false);
      renderer.dispose();
    },
  );

  it.each([false, true])(
    "RED: commits arrival while Free observes the source and returns the same routed traveller (reduced=%s)",
    async (reducedMotion) => {
      const traveler = agentSnapshot("traveler", "worn");
      const placement = PlacementLedger.reconstruct(RECIPES, { agents: [traveler], homes: [] });
      const contract = arrivalContract(traveler.id, "worn", "spring", RECIPE_MAP, 710);
      let pool!: ScriptedAtlasPool;
      pool = new ScriptedAtlasPool((id) => Promise.resolve(pool.newLease(id)));
      const driver = new FakeFrameDriver();
      const renderer = await createCanvasPresentationRenderer({
        canvas: document.createElement("canvas"),
        callbacks: {},
        manifest: PRODUCTION_ASSET_MANIFEST,
        factories: REAL_FACTORIES,
        placement,
        recipes: RECIPES,
        atlasPool: pool,
        reducedMotion,
        frameDriver: driver,
        wakeScheduler: new FakeWakeScheduler(),
        visibilityTarget: new FakeVisibilityTarget(),
        resolveSceneCommands: (next) => arrivalBatch(next, contract),
      }) as CanvasPresentationRenderer;

      renderer.updatePresentation(arrivalFrame(1, "enter", traveler, contract, REGIONS, reducedMotion));
      await settle();
      const instanceId = renderer.debug().graph.actors[0]!.instanceId;
      const sourcePosition = renderer.debug().graph.actors[0]!.position;
      renderer.updatePresentation(arrivalFrame(2, "hold", traveler, contract, REGIONS, reducedMotion));
      await settle();
      expect(renderer.debug().graph.actors).toContainEqual(expect.objectContaining({
        id: traveler.id,
        instanceId,
        position: contract.gate,
      }));

      renderer.setCameraMode("free");
      renderer.observeRegion("worn");
      await settle();
      expect(renderer.debug()).toMatchObject({
        visibleRegionId: "worn",
        camera: { mode: "free" },
        graph: { activeRegion: { id: "worn" }, actors: [] },
      });

      const arrived = { ...traveler, position: "spring" };
      renderer.updatePresentation(arrivalFrame(3, "consequence", arrived, contract, REGIONS, reducedMotion));
      await settle();
      expect(renderer.debug()).toMatchObject({
        frameIdentity: { revision: 3 },
        visibleRegionId: "worn",
        graph: {
          activeRegion: { id: "worn" },
          actors: [],
          regionTransitions: [expect.objectContaining({
            actorId: traveler.id,
            fromRegion: "worn",
            toRegion: "spring",
            position: contract.gate,
          })],
        },
      });
      expect(placement.snapshot().agents.get(traveler.id)).toMatchObject({
        regionId: "spring",
        anchorKind: "arrival:worn",
        point: contract.routeEnd,
      });

      renderer.setCameraMode("story");
      await settle();
      const returned = renderer.debug();
      expect(returned).toMatchObject({
        visibleRegionId: "spring",
        camera: { mode: "story" },
        graph: {
          activeRegion: { id: "spring" },
          actors: [expect.objectContaining({
            id: traveler.id,
            instanceId,
            activeAction: expect.stringMatching(/^(orienting|moving)$/),
          })],
          regionTransitions: [expect.objectContaining({ actorId: traveler.id })],
        },
      });
      expect(returned.graph.actors[0]!.position).not.toEqual(sourcePosition);
      expect(returned.graph.regionTransitions).toHaveLength(1);
      expect(returned.graph.recentMarkers.some(({ marker }) => marker === "repositioned")).toBe(false);
      renderer.dispose();
    },
  );

  it.each([false, true])(
    "RED: a delayed destination observer load commits the fresher consequence without losing Hold continuity (reduced=%s)",
    async (reducedMotion) => {
      const traveler = agentSnapshot("traveler", "worn");
      const placement = PlacementLedger.reconstruct(RECIPES, { agents: [traveler], homes: [] });
      const contract = arrivalContract(traveler.id, "worn", "spring", RECIPE_MAP, 711);
      const delayedId = activeAtlasIds("spring").find((id) => (
        PRODUCTION_ASSET_MANIFEST.atlases[id]?.regionKit === RECIPE_MAP.get("spring")!.kit
      ))!;
      const delayed = deferred<ProductionAssetLease<ImageBitmap>>();
      let delayDestination = false;
      let pool!: ScriptedAtlasPool;
      pool = new ScriptedAtlasPool((id) => delayDestination && id === delayedId
        ? delayed.promise
        : Promise.resolve(pool.newLease(id)));
      const semantics: Parameters<NonNullable<ObserverRendererCallbacks["onSemanticSnapshot"]>>[0][] = [];
      const resolvedRevisions: number[] = [];
      const renderer = await createCanvasPresentationRenderer({
        canvas: document.createElement("canvas"),
        callbacks: { onSemanticSnapshot: (snapshot) => semantics.push(snapshot) },
        manifest: PRODUCTION_ASSET_MANIFEST,
        factories: REAL_FACTORIES,
        placement,
        recipes: RECIPES,
        atlasPool: pool,
        reducedMotion,
        frameDriver: new FakeFrameDriver(),
        wakeScheduler: new FakeWakeScheduler(),
        visibilityTarget: new FakeVisibilityTarget(),
        resolveSceneCommands: (next) => {
          resolvedRevisions.push(next.revision);
          return arrivalBatch(next, contract);
        },
      }) as CanvasPresentationRenderer;

      renderer.updatePresentation(arrivalFrame(1, "enter", traveler, contract, REGIONS, reducedMotion));
      await settle();
      const instanceId = renderer.debug().graph.actors[0]!.instanceId;
      renderer.setCameraMode("free");
      renderer.updatePresentation(arrivalFrame(2, "hold", traveler, contract, REGIONS, reducedMotion));
      await settle();
      expect(renderer.debug().visibleRegionId).toBe("worn");

      delayDestination = true;
      renderer.setCameraMode("story");
      expect(renderer.debug()).toMatchObject({ visibleRegionId: "worn", loadingRegionId: "spring" });
      const arrived = { ...traveler, position: "spring" };
      renderer.updatePresentation(arrivalFrame(4, "consequence", arrived, contract, REGIONS, reducedMotion));
      renderer.updatePresentation(arrivalFrame(3, "hold", traveler, contract, REGIONS, reducedMotion));
      renderer.updatePresentation(arrivalFrame(5, "recover", arrived, contract, REGIONS, reducedMotion));
      expect(renderer.debug().loadingRegionId).toBe("spring");
      delayed.resolve(pool.newLease(delayedId));
      await settle();

      const debug = renderer.debug();
      expect(debug).toMatchObject({
        frameIdentity: { revision: 5 },
        loadingRegionId: null,
        visibleRegionId: "spring",
        graph: {
          activeRegion: { id: "spring" },
          actors: [expect.objectContaining({
            id: traveler.id,
            instanceId,
            position: contract.gate,
            activeAction: expect.stringMatching(/^(orienting|moving)$/),
          })],
          regionTransitions: [expect.objectContaining({
            actorId: traveler.id,
            position: contract.gate,
            frameIdentity: expect.objectContaining({ revision: 4 }),
          })],
        },
      });
      expect(placement.snapshot().agents.get(traveler.id)).toMatchObject({
        regionId: "spring",
        anchorKind: "arrival:worn",
        point: contract.routeEnd,
      });
      expect(semantics.at(-1)).toMatchObject({
        frameIdentity: { revision: 5 },
        subjects: expect.arrayContaining([
          expect.objectContaining({
            selection: { kind: "agent", id: traveler.id },
            regionId: "spring",
            position: contract.gate,
          }),
        ]),
      });
      expect(resolvedRevisions).toEqual([1, 2, 4, 5]);
      expect(debug.graph.regionTransitions).toHaveLength(1);
      expect(debug.graph.recentMarkers.some(({ marker }) => marker === "repositioned")).toBe(false);
      renderer.dispose();
    },
  );

  it.each([false, true])(
    "RED: real Canvas publishes only moving-to-moving displacement across route boundaries (reduced=%s)",
    async (reducedMotion) => {
      const traveler = agentSnapshot("traveler", "worn");
      const arrived = { ...traveler, position: "spring" };
      const placement = PlacementLedger.reconstruct(RECIPES, { agents: [traveler], homes: [] });
      const contract = arrivalContract(traveler.id, "worn", "spring", RECIPE_MAP, 712);
      const driver = new FakeFrameDriver();
      let route: readonly Readonly<{ x: number; y: number }>[] | null = null;
      let pool!: ScriptedAtlasPool;
      pool = new ScriptedAtlasPool((id) => Promise.resolve(pool.newLease(id)));
      const renderer = await createCanvasPresentationRenderer({
        canvas: document.createElement("canvas"),
        callbacks: {},
        manifest: PRODUCTION_ASSET_MANIFEST,
        factories: REAL_FACTORIES,
        placement,
        recipes: RECIPES,
        atlasPool: pool,
        reducedMotion,
        frameDriver: driver,
        wakeScheduler: new FakeWakeScheduler(),
        visibilityTarget: new FakeVisibilityTarget(),
        resolveSceneCommands: (next) => {
          const batch = arrivalBatch(next, contract);
          if (next.scene?.phase !== "consequence" || route === null) return batch;
          return {
            ...batch,
            commands: batch.commands.map((command) => command.kind === "actor"
              ? {
                  ...command,
                  command: {
                    kind: "move",
                    waypoints: route!,
                    speedPixelsPerSecond: 24,
                    gait: "walk",
                  },
                }
              : command),
          } as ProductionSceneCommandBatch;
        },
      }) as CanvasPresentationRenderer;

      renderer.updatePresentation(arrivalFrame(1, "enter", traveler, contract, REGIONS, reducedMotion));
      await settle();
      renderer.updatePresentation(arrivalFrame(2, "hold", traveler, contract, REGIONS, reducedMotion));
      await settle();
      const staged = renderer.debug().graph.actors[0]!;
      const facingUnit = staged.facing === "east"
        ? { x: 1, y: 0 }
        : staged.facing === "west"
          ? { x: -1, y: 0 }
          : staged.facing === "north"
            ? { x: 0, y: -1 }
            : { x: 0, y: 1 };
      // The route must lie on OPEN GROUND: the scene graph's apply-time gate
      // checks each waypoint's destination tile against `grid.collision`, the
      // same authority the real navigator routes over. `spring`'s arrival gate
      // sits one tile above a solid blocked band, so a fixed 8px leg length
      // would have walked the third waypoint straight into it. The first leg
      // still runs along the staged facing (so the first command frame is
      // "moving", never "orienting"); only the leg length and the turn's sign
      // are chosen to keep every waypoint legal.
      const springGrid = RECIPE_MAP.get("spring")!.grid;
      const onOpenGround = (point: Readonly<{ x: number; y: number }>): boolean => {
        const column = Math.floor(point.x / 32);
        const row = Math.floor(point.y / 32);
        return column >= 0 && row >= 0 && column < springGrid.columns && row < springGrid.rows
          && springGrid.collision[row * springGrid.columns + column] === 0;
      };
      const routeFor = (
        legPixels: number,
        turnSign: number,
      ): readonly Readonly<{ x: number; y: number }>[] => {
        const firstStep = { x: facingUnit.x * legPixels, y: facingUnit.y * legPixels };
        const turnStep = firstStep.x === 0
          ? { x: legPixels * turnSign, y: 0 }
          : { x: 0, y: legPixels * turnSign };
        return [
          { x: contract.gate.x + firstStep.x, y: contract.gate.y + firstStep.y },
          {
            x: contract.gate.x + firstStep.x + turnStep.x,
            y: contract.gate.y + firstStep.y + turnStep.y,
          },
          {
            x: contract.gate.x + firstStep.x * 2 + turnStep.x,
            y: contract.gate.y + firstStep.y * 2 + turnStep.y,
          },
        ];
      };
      const candidates = [8, 4, 2].flatMap((legPixels) =>
        [1, -1].map((turnSign) => routeFor(legPixels, turnSign)));
      route = candidates.find((candidate) => candidate.every(onOpenGround)) ?? null;
      expect(route, "no legal on-ground route from the arrival gate").not.toBeNull();
      const endpoint = route!.at(-1)!;
      driver.fire(1_000);
      const beforeCommand = renderer.debug().graph.actors[0]!;
      renderer.updatePresentation(arrivalFrame(3, "consequence", arrived, contract, REGIONS, reducedMotion));
      await settle();
      driver.fire(1_000 + 1_000 / 30);
      const firstCommandFrame = renderer.debug().graph.actors[0]!;

      expect(beforeCommand).toMatchObject({
        position: contract.gate,
        activeAction: null,
      });
      expect(firstCommandFrame).toMatchObject({
        position: contract.gate,
        activeAction: "moving",
      });

      let reachedEndpointMoving = false;
      for (let step = 2; step <= 400; step += 1) {
        const before = renderer.debug().graph.actors[0]!;
        renderer.setSafeFrame({ top: 0, right: 0, bottom: 0, left: 0 });
        driver.fire(1_000 + step * 1_000 / 30);
        const after = renderer.debug().graph.actors[0]!;
        const dx = after.position.x - before.position.x;
        const dy = after.position.y - before.position.y;
        const moved = Math.hypot(dx, dy) > 1e-9;
        if (moved) {
          expect([before.activeAction, after.activeAction], `step ${step}`).toEqual([
            "moving",
            "moving",
          ]);
          expect(after.facing, `step ${step} facing`).toBe(before.facing);
          if (Math.abs(dx) >= Math.abs(dy)) {
            expect(after.facing).toBe(dx > 0 ? "east" : "west");
          } else expect(after.facing).toBe(dy > 0 ? "south" : "north");
        }
        if (before.activeAction === "orienting" || after.activeAction === "orienting") {
          expect({ dx, dy }, `step ${step} orientation displacement`).toEqual({ dx: 0, dy: 0 });
        }
        if (after.position.x === endpoint.x && after.position.y === endpoint.y
          && after.activeAction === "moving") reachedEndpointMoving = true;
        const arrivals = renderer.debug().graph.recentMarkers.filter(({ marker }) => marker === "arrived");
        if (arrivals.length > 0) {
          expect(before).toMatchObject({ position: endpoint, activeAction: "moving" });
          expect(after).toMatchObject({ position: endpoint, activeAction: null });
          break;
        }
      }

      expect(reachedEndpointMoving).toBe(true);
      expect(renderer.debug().graph.recentMarkers.filter(({ marker }) => marker === "arrived")).toHaveLength(1);
      renderer.setSafeFrame({ top: 0, right: 0, bottom: 0, left: 0 });
      driver.fire(401_000 / 30);
      expect(renderer.debug().graph.recentMarkers.filter(({ marker }) => marker === "arrived")).toHaveLength(1);
      renderer.dispose();
    },
  );

  it("continues a fenced 48 px/s arrival from its own scheduler after a settled-camera draw", async () => {
    const traveler = agentSnapshot("traveler", "worn");
    const arrived = { ...traveler, position: "spring" };
    const placement = PlacementLedger.reconstruct(RECIPES, { agents: [traveler], homes: [] });
    const contract = arrivalContract(traveler.id, "worn", "spring", RECIPE_MAP, 713);
    const driver = new FakeFrameDriver();
    const wake = new FakeWakeScheduler();
    let route: readonly Readonly<{ x: number; y: number }>[] | null = null;
    let pool!: ScriptedAtlasPool;
    pool = new ScriptedAtlasPool((id) => Promise.resolve(pool.newLease(id)));
    const renderer = await createCanvasPresentationRenderer({
      canvas: document.createElement("canvas"),
      callbacks: {},
      manifest: PRODUCTION_ASSET_MANIFEST,
      factories: REAL_FACTORIES,
      placement,
      recipes: RECIPES,
      atlasPool: pool,
      frameDriver: driver,
      wakeScheduler: wake,
      visibilityTarget: new FakeVisibilityTarget(),
      resolveSceneCommands: (next) => {
        const batch = arrivalBatch(next, contract);
        if (next.scene?.phase !== "consequence" || route === null) return batch;
        return {
          ...batch,
          commands: batch.commands.map((command) => command.kind === "actor"
            ? {
                ...command,
                command: {
                  kind: "move",
                  waypoints: route!,
                  speedPixelsPerSecond: 48,
                  gait: "walk",
                },
              }
            : command),
        } as ProductionSceneCommandBatch;
      },
    }) as CanvasPresentationRenderer;

    renderer.updatePresentation(arrivalFrame(1, "enter", traveler, contract, REGIONS, false));
    await settle();
    renderer.updatePresentation(arrivalFrame(2, "hold", traveler, contract, REGIONS, false));
    await settle();
    let nowMs = 0;
    for (let step = 0; step < 300 && driver.pending() > 0; step += 1) {
      nowMs += 1_000 / 60;
      driver.fire(nowMs);
    }
    expect(driver.pending()).toBe(0);
    const staged = renderer.debug().graph.actors[0]!;
    const firstStep = staged.facing === "east"
      ? { x: 96, y: 0 }
      : staged.facing === "west"
        ? { x: -96, y: 0 }
        : staged.facing === "north"
          ? { x: 0, y: -96 }
          : { x: 0, y: 96 };
    route = [{ x: contract.gate.x + firstStep.x, y: contract.gate.y + firstStep.y }];

    renderer.updatePresentation(arrivalFrame(3, "consequence", arrived, contract, REGIONS, false));
    await settle();
    expect(driver.pending()).toBe(1);
    driver.fire(nowMs + 1_000 / 30);
    const held = renderer.debug().graph.actors[0]!;
    expect(held).toMatchObject({ position: contract.gate, activeAction: "moving" });
    expect(driver.pending()).toBe(0);
    expect(wake.pending()).toBe(1);
    expect(wake.scheduledAtMs.at(-1)).toBeGreaterThan(nowMs + 1_000 / 30);
    expect(wake.scheduledAtMs.at(-1)).toBeLessThanOrEqual(nowMs + 1_000 / 30 + 1_000 / 60);

    wake.fireAll();
    expect(driver.pending()).toBe(1);
    driver.fire(nowMs + 2_000 / 30);
    const displaced = renderer.debug().graph.actors[0]!;
    expect([held.activeAction, displaced.activeAction]).toEqual(["moving", "moving"]);
    expect(Math.hypot(
      displaced.position.x - held.position.x,
      displaced.position.y - held.position.y,
    )).toBeCloseTo(1.6, 10);
    renderer.dispose();
  });

  it.each([false, true])(
    "RED: publishes the first destination Hold only after camera and semantics adopt the exact gate (reduced=%s)",
    async (reducedMotion) => {
      const traveler = agentSnapshot("traveler", "worn");
      const placement = PlacementLedger.reconstruct(RECIPES, { agents: [traveler], homes: [] });
      const contract = arrivalContract(traveler.id, "worn", "spring", RECIPE_MAP, 712);
      let pool!: ScriptedAtlasPool;
      pool = new ScriptedAtlasPool((id) => Promise.resolve(pool.newLease(id)));
      const semantics: Parameters<NonNullable<ObserverRendererCallbacks["onSemanticSnapshot"]>>[0][] = [];
      const publications: Array<Readonly<{
        revision: number;
        guidedTarget: Readonly<{ x: number; y: number; width: number; height: number }> | null;
        semantic: Parameters<NonNullable<ObserverRendererCallbacks["onSemanticSnapshot"]>>[0] | null;
      }>> = [];
      let renderer!: CanvasPresentationRenderer;
      renderer = await createCanvasPresentationRenderer({
        canvas: document.createElement("canvas"),
        callbacks: { onSemanticSnapshot: (snapshot) => semantics.push(snapshot) },
        manifest: PRODUCTION_ASSET_MANIFEST,
        factories: REAL_FACTORIES,
        placement,
        recipes: RECIPES,
        atlasPool: pool,
        reducedMotion,
        frameDriver: new FakeFrameDriver(),
        wakeScheduler: new FakeWakeScheduler(),
        visibilityTarget: new FakeVisibilityTarget(),
        resolveSceneCommands: (next) => arrivalBatch(next, contract),
        frameAcceptance: {
          markAccepted(next): void {
            publications.push({
              revision: next.revision,
              guidedTarget: renderer.debug().camera.guidedTarget,
              semantic: semantics.at(-1) ?? null,
            });
          },
        },
      }) as CanvasPresentationRenderer;
      renderer.updatePresentation(arrivalFrame(1, "enter", traveler, contract, REGIONS, reducedMotion));
      await settle();
      renderer.updatePresentation(arrivalFrame(2, "hold", traveler, contract, REGIONS, reducedMotion));
      await settle();

      const destinationPublication = publications.find(({ revision }) => revision === 2);
      expect(destinationPublication?.guidedTarget).toEqual(feetAnchoredVisualRect(contract.gate));
      expect(destinationPublication?.semantic).toMatchObject({
        frameIdentity: { revision: 2 },
        subjects: expect.arrayContaining([
          expect.objectContaining({
            selection: { kind: "agent", id: traveler.id },
            position: contract.gate,
          }),
        ]),
      });
      renderer.dispose();
    },
  );

  it.each([
    { reducedMotion: false, interruption: "failure" as const },
    { reducedMotion: true, interruption: "failure" as const },
    { reducedMotion: false, interruption: "abort" as const },
    { reducedMotion: true, interruption: "abort" as const },
  ])(
    "RED: retains a queued consequence across atlas $interruption and tail retry (reduced=$reducedMotion)",
    async ({ reducedMotion, interruption }) => {
      const traveler = agentSnapshot("traveler", "worn");
      const arrived = { ...traveler, position: "spring" };
      const placement = PlacementLedger.reconstruct(RECIPES, { agents: [traveler], homes: [] });
      const contract = arrivalContract(traveler.id, "worn", "spring", RECIPE_MAP, 715);
      const delayedId = activeAtlasIds("spring").find((id) => (
        PRODUCTION_ASSET_MANIFEST.atlases[id]?.regionKit === RECIPE_MAP.get("spring")!.kit
      ))!;
      const delayed = deferred<ProductionAssetLease<ImageBitmap>>();
      let blockDestination = false;
      let pool!: ScriptedAtlasPool;
      pool = new ScriptedAtlasPool((id) => blockDestination && id === delayedId
        ? delayed.promise
        : Promise.resolve(pool.newLease(id)));
      const renderer = await createCanvasPresentationRenderer({
        canvas: document.createElement("canvas"),
        callbacks: {},
        manifest: PRODUCTION_ASSET_MANIFEST,
        factories: REAL_FACTORIES,
        placement,
        recipes: RECIPES,
        atlasPool: pool,
        reducedMotion,
        frameDriver: new FakeFrameDriver(),
        wakeScheduler: new FakeWakeScheduler(),
        visibilityTarget: new FakeVisibilityTarget(),
        resolveSceneCommands: (next) => arrivalBatch(next, contract),
      }) as CanvasPresentationRenderer;

      renderer.updatePresentation(arrivalFrame(1, "enter", traveler, contract, REGIONS, reducedMotion));
      await settle();
      const instanceId = renderer.debug().graph.actors[0]!.instanceId;
      renderer.setCameraMode("free");
      renderer.updatePresentation(arrivalFrame(2, "hold", traveler, contract, REGIONS, reducedMotion));
      await settle();
      blockDestination = true;
      renderer.setCameraMode("story");
      renderer.updatePresentation(arrivalFrame(4, "consequence", arrived, contract, REGIONS, reducedMotion));
      renderer.updatePresentation(arrivalFrame(5, "recover", arrived, contract, REGIONS, reducedMotion));
      expect(renderer.debug().loadingRegionId).toBe("spring");

      if (interruption === "failure") {
        delayed.reject(new Error("destination decode failed"));
      } else {
        renderer.observeRegion("worn");
        delayed.resolve(pool.newLease(delayedId));
      }
      blockDestination = false;
      await settle();
      expect(renderer.debug()).toMatchObject({
        frameIdentity: { revision: 2 },
        visibleRegionId: "worn",
        loadingRegionId: null,
        graph: { regionTransitions: [] },
      });
      expect(placement.snapshot().agents.get(traveler.id)?.regionId).toBe("worn");

      renderer.updatePresentation(arrivalFrame(3, "hold", traveler, contract, REGIONS, reducedMotion));
      await settle();
      expect(renderer.debug()).toMatchObject({
        frameIdentity: { revision: 2 },
        visibleRegionId: "worn",
        loadingRegionId: null,
        graph: { regionTransitions: [] },
      });

      renderer.setCameraMode("free");
      renderer.observeRegion("worn");
      renderer.updatePresentation(arrivalFrame(5, "recover", arrived, contract, REGIONS, reducedMotion));
      await settle();
      expect(renderer.debug()).toMatchObject({
        frameIdentity: { revision: 5 },
        visibleRegionId: "worn",
        loadingRegionId: null,
        camera: { mode: "free" },
        graph: {
          actors: [],
          regionTransitions: [expect.objectContaining({
            actorId: traveler.id,
            position: contract.gate,
            frameIdentity: expect.objectContaining({ revision: 4 }),
          })],
        },
      });
      expect(renderer.debug().graph.regionTransitions).toHaveLength(1);
      expect(placement.snapshot().agents.get(traveler.id)).toMatchObject({
        regionId: "spring",
        anchorKind: "arrival:worn",
        point: contract.routeEnd,
      });

      renderer.setCameraMode("story");
      await settle();
      expect(renderer.debug()).toMatchObject({
        frameIdentity: { revision: 5 },
        visibleRegionId: "spring",
        loadingRegionId: null,
        graph: {
          actors: [expect.objectContaining({ id: traveler.id, instanceId, position: contract.gate })],
          regionTransitions: [expect.objectContaining({
            actorId: traveler.id,
            position: contract.gate,
            frameIdentity: expect.objectContaining({ revision: 4 }),
          })],
        },
      });
      expect(renderer.debug().graph.regionTransitions).toHaveLength(1);
      expect(placement.snapshot().agents.get(traveler.id)).toMatchObject({
        regionId: "spring",
        anchorKind: "arrival:worn",
        point: contract.routeEnd,
      });
      renderer.dispose();
    },
  );

  it.each([false, true])(
    "RED: drains an interrupted first arrival before a Free tail and second travel (reduced=%s)",
    async (reducedMotion) => {
      const regions = [
        region("worn", "A thinning and picked-over origin.", ["spring"]),
        region("spring", "Hot spring lakes.", ["third"]),
        region("third", "A dry salt basin.", []),
      ] as const;
      const recipes = regions.map((value) => (
        createRegionMapRecipe(createRegionMapIdentity(176, value, regions))
      ));
      const recipeMap = new Map(recipes.map((recipe) => [recipe.regionId, recipe]));
      const traveler = agentSnapshot("traveler", "worn");
      const inSpring = { ...traveler, position: "spring" };
      const inThird = { ...traveler, position: "third" };
      const placement = PlacementLedger.reconstruct(recipes, { agents: [traveler], homes: [] });
      const first = arrivalContract(traveler.id, "worn", "spring", recipeMap, 716);
      const second = arrivalContract(traveler.id, "spring", "third", recipeMap, 718);
      const delayedId = activeAtlasIds("spring").find((id) => (
        PRODUCTION_ASSET_MANIFEST.atlases[id]?.regionKit === recipeMap.get("spring")!.kit
      ))!;
      const delayed = deferred<ProductionAssetLease<ImageBitmap>>();
      let blockSpring = false;
      let pool!: ScriptedAtlasPool;
      pool = new ScriptedAtlasPool((id) => blockSpring && id === delayedId
        ? delayed.promise
        : Promise.resolve(pool.newLease(id)));
      const renderer = await createCanvasPresentationRenderer({
        canvas: document.createElement("canvas"),
        callbacks: {},
        manifest: PRODUCTION_ASSET_MANIFEST,
        factories: REAL_FACTORIES,
        placement,
        recipes,
        atlasPool: pool,
        reducedMotion,
        frameDriver: new FakeFrameDriver(),
        wakeScheduler: new FakeWakeScheduler(),
        visibilityTarget: new FakeVisibilityTarget(),
        resolveSceneCommands: (next) => arrivalBatch(
          next,
          next.scene?.momentId === second.momentId ? second : first,
        ),
      }) as CanvasPresentationRenderer;

      renderer.updatePresentation(arrivalFrame(1, "enter", traveler, first, regions, reducedMotion));
      await settle();
      const instanceId = renderer.debug().graph.actors[0]!.instanceId;
      renderer.setCameraMode("free");
      renderer.updatePresentation(arrivalFrame(2, "hold", traveler, first, regions, reducedMotion));
      await settle();
      blockSpring = true;
      renderer.setCameraMode("story");
      renderer.updatePresentation(arrivalFrame(4, "consequence", inSpring, first, regions, reducedMotion));
      renderer.updatePresentation(arrivalFrame(5, "recover", inSpring, first, regions, reducedMotion));
      renderer.observeRegion("worn");
      delayed.resolve(pool.newLease(delayedId));
      blockSpring = false;
      await settle();

      renderer.setCameraMode("free");
      renderer.observeRegion("worn");
      renderer.updatePresentation(arrivalFrame(5, "recover", inSpring, first, regions, reducedMotion));
      await settle();
      expect(renderer.debug()).toMatchObject({
        frameIdentity: { revision: 5 },
        visibleRegionId: "worn",
        camera: { mode: "free" },
        graph: {
          actors: [],
          regionTransitions: [expect.objectContaining({
            actorId: traveler.id,
            fromRegion: "worn",
            toRegion: "spring",
            position: first.gate,
            frameIdentity: expect.objectContaining({ revision: 4 }),
          })],
        },
      });
      expect(placement.snapshot().agents.get(traveler.id)?.regionId).toBe("spring");

      renderer.updatePresentation(arrivalFrame(6, "enter", inSpring, second, regions, reducedMotion));
      renderer.updatePresentation(arrivalFrame(7, "hold", inSpring, second, regions, reducedMotion));
      renderer.updatePresentation(arrivalFrame(8, "consequence", inThird, second, regions, reducedMotion));
      renderer.updatePresentation(arrivalFrame(9, "recover", inThird, second, regions, reducedMotion));
      await settle();
      expect(renderer.debug()).toMatchObject({
        frameIdentity: { revision: 9 },
        visibleRegionId: "worn",
        camera: { mode: "free" },
        graph: {
          actors: [],
          ownership: { actors: { created: 1, disposed: 0, outstanding: 1 } },
          regionTransitions: [
            expect.objectContaining({
              actorId: traveler.id,
              fromRegion: "worn",
              toRegion: "spring",
              frameIdentity: expect.objectContaining({ revision: 4 }),
            }),
            expect.objectContaining({
              actorId: traveler.id,
              fromRegion: "spring",
              toRegion: "third",
              position: second.gate,
              frameIdentity: expect.objectContaining({ revision: 8 }),
            }),
          ],
        },
      });
      expect(renderer.debug().graph.regionTransitions).toHaveLength(2);
      expect(placement.snapshot().agents.get(traveler.id)).toMatchObject({
        regionId: "third",
        anchorKind: "arrival:spring",
        point: second.gate,
      });

      renderer.observeRegion("third");
      await settle();
      expect(renderer.debug()).toMatchObject({
        visibleRegionId: "third",
        graph: {
          actors: [expect.objectContaining({
            id: traveler.id,
            instanceId,
            position: second.gate,
          })],
          regionTransitions: [
            expect.objectContaining({ frameIdentity: expect.objectContaining({ revision: 4 }) }),
            expect.objectContaining({ frameIdentity: expect.objectContaining({ revision: 8 }) }),
          ],
        },
      });
      renderer.dispose();
    },
  );

  it("RED: keeps Canvas, real Graph, and placement atomic when frame acceptance retries post-commit", async () => {
    const traveler = agentSnapshot("traveler", "worn");
    const placement = PlacementLedger.reconstruct(RECIPES, { agents: [traveler], homes: [] });
    const contract = arrivalContract(traveler.id, "worn", "spring", RECIPE_MAP, 713);
    let pool!: ScriptedAtlasPool;
    pool = new ScriptedAtlasPool((id) => Promise.resolve(pool.newLease(id)));
    const driver = new FakeFrameDriver();
    let rejectLegacyPostApply = true;
    let consequenceAcceptanceCalls = 0;
    const failures: unknown[] = [];
    const caughtErrors: string[] = [];
    const commandOutcomes: string[] = [];
    const frameOutcomes: string[] = [];
    const renderer = await createCanvasPresentationRenderer({
      canvas: document.createElement("canvas"),
      callbacks: { onFailure: (failure) => failures.push(failure) },
      manifest: PRODUCTION_ASSET_MANIFEST,
      factories: REAL_FACTORIES,
      placement,
      recipes: RECIPE_MAP,
      atlasPool: pool,
      frameDriver: driver,
      wakeScheduler: new FakeWakeScheduler(),
      visibilityTarget: new FakeVisibilityTarget(),
      resolveSceneCommands: (next) => arrivalBatch(next, contract),
      sceneGraphFactory: (options) => {
        const live = createProductionSceneGraph(options);
        let lastPhase: string | null = null;
        return {
          ...live,
          applyFrame(frameValue, batch, nowMs, observerViewRegionId, deferArrivalStaging) {
            lastPhase = frameValue.scene?.phase ?? null;
            try {
              const result = live.applyFrame!(frameValue, batch, nowMs, observerViewRegionId, deferArrivalStaging);
              frameOutcomes.push(`${lastPhase}:${result.outcome}`);
              return result;
            } catch (error) {
              caughtErrors.push(String(error));
              throw error;
            }
          },
          applySceneCommands(batch, nowMs) {
            if (lastPhase === "consequence" && rejectLegacyPostApply) {
              return {
                outcome: "invalid",
                appliedCommandIds: [],
                ignoredCommandIds: batch.commands.map(({ commandId }) => commandId),
                rejections: batch.commands.map((command) => ({
                  commandId: command.commandId,
                  commandKind: command.kind,
                  subjectId: null,
                  reason: "stale-batch" as const,
                  detail: "test stub refuses post-apply legacy batches",
                })),
              };
            }
            try {
              const result = live.applySceneCommands(batch, nowMs);
              commandOutcomes.push(`${lastPhase}:${result.outcome}`);
              return result;
            } catch (error) {
              caughtErrors.push(String(error));
              throw error;
            }
          },
        };
      },
      frameAcceptance: {
        markAccepted(next): void {
          if (next.revision !== 3) return;
          consequenceAcceptanceCalls += 1;
          if (consequenceAcceptanceCalls === 1) throw new Error("receipt observer unavailable");
        },
      },
    }) as CanvasPresentationRenderer;

    renderer.updatePresentation(arrivalFrame(1, "enter", traveler, contract, REGIONS, false));
    await settle();
    expect(renderer.debug().frameIdentity, JSON.stringify({ failures, caughtErrors, commandOutcomes, frameOutcomes })).toMatchObject({ revision: 1 });
    renderer.updatePresentation(arrivalFrame(2, "hold", traveler, contract, REGIONS, false));
    await settle();
    expect(renderer.debug().frameIdentity, JSON.stringify(failures)).toMatchObject({ revision: 2 });
    const arrived = { ...traveler, position: "spring" };
    renderer.updatePresentation(arrivalFrame(3, "consequence", arrived, contract, REGIONS, false));
    await settle();

    const committed = renderer.debug();
    expect(committed).toMatchObject({
      frameIdentity: { revision: 3 },
      postCommit: { acceptancePending: true },
      graph: {
        identity: { revision: 3 },
        regionTransitions: [expect.objectContaining({ actorId: traveler.id })],
      },
    });
    expect(placement.snapshot().agents.get(traveler.id)).toMatchObject({
      regionId: "spring",
      anchorKind: "arrival:worn",
    });
    rejectLegacyPostApply = false;
    driver.fire(250);
    expect(renderer.debug().postCommit.acceptancePending).toBe(false);
    expect(consequenceAcceptanceCalls).toBe(2);
    renderer.dispose();
  });

  it("RED: rejects an update-time actor fault without advancing Canvas, Graph, placement, or ownership", async () => {
    const resident = agentSnapshot("resident", "worn");
    const newcomer = agentSnapshot("newcomer", "worn");
    const placement = PlacementLedger.reconstruct(RECIPES, { agents: [resident], homes: [] });
    const actors = new Map<string, FaultingUpdateActor>();
    const factories: ProductionSceneFactories = {
      ...REAL_FACTORIES,
      createActor(input) {
        const value = input.record.value;
        const actor = new FaultingUpdateActor({
          id: value.id!,
          name: value.name!,
          persona: value.persona,
          position: input.position,
          facing: input.facing,
          manifest: input.manifest,
          atlasLeases: input.atlasLeases,
          reducedMotion: input.reducedMotion,
        });
        actors.set(value.id!, actor);
        return actor;
      },
    };
    let pool!: ScriptedAtlasPool;
    pool = new ScriptedAtlasPool((id) => Promise.resolve(pool.newLease(id)));
    const onFailure = vi.fn();
    const renderer = await createCanvasPresentationRenderer({
      canvas: document.createElement("canvas"),
      callbacks: { onFailure },
      manifest: PRODUCTION_ASSET_MANIFEST,
      factories,
      placement,
      recipes: RECIPES,
      atlasPool: pool,
      frameDriver: new FakeFrameDriver(),
      wakeScheduler: new FakeWakeScheduler(),
      visibilityTarget: new FakeVisibilityTarget(),
    }) as CanvasPresentationRenderer;
    renderer.updatePresentation(frame({ revision: 1, regionId: "worn", agents: [resident] }));
    await settle();
    const before = renderer.debug();
    const placementBefore = placement.snapshot();
    actors.get(resident.id)!.throwOnNextApply = true;
    const next = frame({
      revision: 2,
      regionId: "worn",
      agents: [{ ...resident, status: "dead" }, newcomer],
    });

    renderer.updatePresentation(next);
    await settle();
    expect(placement.snapshot()).toEqual(placementBefore);
    expect(renderer.debug()).toMatchObject({
      frameIdentity: before.frameIdentity,
      visibleRegionId: before.visibleRegionId,
      staticLayerRebuilds: before.staticLayerRebuilds,
      graph: {
        identity: before.graph.identity,
        actors: before.graph.actors,
        ownership: before.graph.ownership,
      },
    });
    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ kind: "canvas", retryable: true }));

    renderer.updatePresentation(next);
    await settle();
    expect(renderer.debug()).toMatchObject({
      frameIdentity: { revision: 2 },
      graph: {
        identity: { revision: 2 },
        actors: expect.arrayContaining([
          expect.objectContaining({ id: resident.id, terminal: true }),
          expect.objectContaining({ id: newcomer.id }),
        ]),
        ownership: {
          actors: { created: 2, disposed: 0, outstanding: 2, peak: 2 },
        },
      },
    });
    expect(placement.snapshot().agents.has(newcomer.id)).toBe(true);
    renderer.dispose();
  });

  it.each([false, true])(
    "RED: keeps one hidden traveller through source-third-source-destination Free hops (reduced=%s)",
    async (reducedMotion) => {
      const regions = [
        region("worn", "A thinning and picked-over origin.", ["spring"]),
        region("spring", "Hot spring lakes.", []),
        region("third", "A dry salt basin.", []),
      ] as const;
      const recipes = regions.map((value) => (
        createRegionMapRecipe(createRegionMapIdentity(171, value, regions))
      ));
      const recipeMap = new Map(recipes.map((recipe) => [recipe.regionId, recipe]));
      const traveler = agentSnapshot("traveler", "worn");
      const placement = PlacementLedger.reconstruct(recipes, { agents: [traveler], homes: [] });
      const placementBefore = placement.snapshot();
      const contract = arrivalContract(traveler.id, "worn", "spring", recipeMap, 714);
      let pool!: ScriptedAtlasPool;
      pool = new ScriptedAtlasPool((id) => Promise.resolve(pool.newLease(id)));
      const renderer = await createCanvasPresentationRenderer({
        canvas: document.createElement("canvas"),
        callbacks: {},
        manifest: PRODUCTION_ASSET_MANIFEST,
        factories: REAL_FACTORIES,
        placement,
        recipes,
        atlasPool: pool,
        reducedMotion,
        frameDriver: new FakeFrameDriver(),
        wakeScheduler: new FakeWakeScheduler(),
        visibilityTarget: new FakeVisibilityTarget(),
        resolveSceneCommands: (next) => arrivalBatch(next, contract),
      }) as CanvasPresentationRenderer;

      renderer.updatePresentation(arrivalFrame(1, "enter", traveler, contract, regions, reducedMotion));
      await settle();
      const instanceId = renderer.debug().graph.actors[0]!.instanceId;
      renderer.updatePresentation(arrivalFrame(2, "hold", traveler, contract, regions, reducedMotion));
      await settle();
      renderer.setCameraMode("free");

      for (const regionId of ["worn", "third", "worn"] as const) {
        renderer.observeRegion(regionId);
        await settle();
        expect(renderer.debug()).toMatchObject({
          visibleRegionId: regionId,
          graph: { activeRegion: { id: regionId }, actors: [] },
        });
      }
      renderer.observeRegion("spring");
      await settle();
      expect(renderer.debug()).toMatchObject({
        visibleRegionId: "spring",
        camera: { mode: "free" },
        graph: {
          activeRegion: { id: "spring" },
          actors: [expect.objectContaining({
            id: traveler.id,
            instanceId,
            position: contract.gate,
          })],
          regionTransitions: [],
        },
      });
      expect(placement.snapshot()).toEqual(placementBefore);
      renderer.dispose();
    },
  );

  it.each([false, true])(
    "RED: keeps the committed traveller owned through post-consequence arbitrary Free hops (reduced=%s)",
    async (reducedMotion) => {
      const regions = [
        region("worn", "A thinning and picked-over origin.", ["spring"]),
        region("spring", "Hot spring lakes.", []),
        region("third", "A dry salt basin.", []),
      ] as const;
      const recipes = regions.map((value) => (
        createRegionMapRecipe(createRegionMapIdentity(173, value, regions))
      ));
      const recipeMap = new Map(recipes.map((recipe) => [recipe.regionId, recipe]));
      const traveler = agentSnapshot("traveler", "worn");
      const placement = PlacementLedger.reconstruct(recipes, { agents: [traveler], homes: [] });
      const contract = arrivalContract(traveler.id, "worn", "spring", recipeMap, 716);
      let pool!: ScriptedAtlasPool;
      pool = new ScriptedAtlasPool((id) => Promise.resolve(pool.newLease(id)));
      const renderer = await createCanvasPresentationRenderer({
        canvas: document.createElement("canvas"),
        callbacks: {},
        manifest: PRODUCTION_ASSET_MANIFEST,
        factories: REAL_FACTORIES,
        placement,
        recipes,
        atlasPool: pool,
        reducedMotion,
        frameDriver: new FakeFrameDriver(),
        wakeScheduler: new FakeWakeScheduler(),
        visibilityTarget: new FakeVisibilityTarget(),
        resolveSceneCommands: (next) => arrivalBatch(next, contract),
      }) as CanvasPresentationRenderer;

      renderer.updatePresentation(arrivalFrame(1, "enter", traveler, contract, regions, reducedMotion));
      await settle();
      const instanceId = renderer.debug().graph.actors[0]!.instanceId;
      expect(renderer.debug().graph.ownership.actors).toMatchObject({
        created: 1,
        disposed: 0,
        outstanding: 1,
      });
      renderer.updatePresentation(arrivalFrame(2, "hold", traveler, contract, regions, reducedMotion));
      await settle();
      renderer.setCameraMode("free");
      renderer.observeRegion("worn");
      await settle();

      const arrived = { ...traveler, position: "spring" };
      renderer.updatePresentation(arrivalFrame(3, "consequence", arrived, contract, regions, reducedMotion));
      await settle();
      const committedPlacement = placement.snapshot().agents.get(traveler.id)!;
      expect(committedPlacement).toMatchObject({
        regionId: "spring",
        anchorKind: "arrival:worn",
        point: contract.routeEnd,
      });
      expect(renderer.debug().graph.regionTransitions).toHaveLength(1);

      for (const regionId of ["worn", "third", "worn"] as const) {
        renderer.observeRegion(regionId);
        await settle();
        expect(renderer.debug()).toMatchObject({
          visibleRegionId: regionId,
          graph: {
            activeRegion: { id: regionId },
            actors: [],
            ownership: {
              actors: { created: 1, disposed: 0, outstanding: 1 },
            },
          },
        });
        expect(renderer.debug().graph.regionTransitions).toHaveLength(1);
        expect(placement.snapshot().agents.get(traveler.id)).toEqual(committedPlacement);
      }

      renderer.observeRegion("spring");
      await settle();
      expect(renderer.debug()).toMatchObject({
        visibleRegionId: "spring",
        camera: { mode: "free" },
        graph: {
          activeRegion: { id: "spring" },
          actors: [expect.objectContaining({
            id: traveler.id,
            instanceId,
            position: contract.gate,
          })],
          ownership: {
            actors: { created: 1, disposed: 0, outstanding: 1 },
          },
        },
      });
      expect(renderer.debug().graph.regionTransitions).toHaveLength(1);
      expect(placement.snapshot().agents.get(traveler.id)).toEqual(committedPlacement);
      renderer.dispose();
    },
  );

  it.each([false, true])(
    "RED: authorizes a second causal travel while Free observes an unrelated region (reduced=%s)",
    async (reducedMotion) => {
      const regions = [
        region("worn", "A thinning and picked-over origin.", ["spring"]),
        region("spring", "Hot spring lakes.", ["third"]),
        region("third", "A dry salt basin.", []),
      ] as const;
      const recipes = regions.map((value) => (
        createRegionMapRecipe(createRegionMapIdentity(175, value, regions))
      ));
      const recipeMap = new Map(recipes.map((recipe) => [recipe.regionId, recipe]));
      const traveler = agentSnapshot("traveler", "worn");
      const placement = PlacementLedger.reconstruct(recipes, { agents: [traveler], homes: [] });
      const first = arrivalContract(traveler.id, "worn", "spring", recipeMap, 718);
      const second = arrivalContract(traveler.id, "spring", "third", recipeMap, 720);
      let pool!: ScriptedAtlasPool;
      pool = new ScriptedAtlasPool((id) => Promise.resolve(pool.newLease(id)));
      const renderer = await createCanvasPresentationRenderer({
        canvas: document.createElement("canvas"),
        callbacks: {},
        manifest: PRODUCTION_ASSET_MANIFEST,
        factories: REAL_FACTORIES,
        placement,
        recipes,
        atlasPool: pool,
        reducedMotion,
        frameDriver: new FakeFrameDriver(),
        wakeScheduler: new FakeWakeScheduler(),
        visibilityTarget: new FakeVisibilityTarget(),
        resolveSceneCommands: (next) => arrivalBatch(
          next,
          next.scene?.momentId === second.momentId ? second : first,
        ),
      }) as CanvasPresentationRenderer;

      renderer.updatePresentation(arrivalFrame(1, "enter", traveler, first, regions, reducedMotion));
      await settle();
      const instanceId = renderer.debug().graph.actors[0]!.instanceId;
      renderer.updatePresentation(arrivalFrame(2, "hold", traveler, first, regions, reducedMotion));
      await settle();
      renderer.setCameraMode("free");
      renderer.observeRegion("worn");
      await settle();
      const inSpring = { ...traveler, position: "spring" };
      renderer.updatePresentation(arrivalFrame(3, "consequence", inSpring, first, regions, reducedMotion));
      await settle();
      expect(renderer.debug().graph.regionTransitions).toEqual([
        expect.objectContaining({ actorId: traveler.id, fromRegion: "worn", toRegion: "spring" }),
      ]);

      renderer.updatePresentation(arrivalFrame(4, "enter", inSpring, second, regions, reducedMotion));
      await settle();
      expect(renderer.debug()).toMatchObject({
        visibleRegionId: "worn",
        camera: { mode: "free" },
        graph: {
          activeRegion: { id: "worn" },
          actors: [],
          ownership: { actors: { created: 1, disposed: 0, outstanding: 1 } },
        },
      });

      renderer.observeRegion("third");
      await settle();
      expect(renderer.debug()).toMatchObject({
        visibleRegionId: "third",
        camera: { mode: "free" },
        graph: {
          activeRegion: { id: "third" },
          actors: [],
          ownership: { actors: { created: 1, disposed: 0, outstanding: 1 } },
        },
      });

      renderer.updatePresentation(arrivalFrame(5, "hold", inSpring, second, regions, reducedMotion));
      await settle();
      expect(renderer.debug()).toMatchObject({
        visibleRegionId: "third",
        camera: { mode: "free" },
        graph: {
          activeRegion: { id: "third" },
          actors: [expect.objectContaining({ id: traveler.id, instanceId, position: second.gate })],
          ownership: { actors: { created: 1, disposed: 0, outstanding: 1 } },
        },
      });

      const inThird = { ...traveler, position: "third" };
      renderer.updatePresentation(arrivalFrame(6, "consequence", inThird, second, regions, reducedMotion));
      await settle();
      expect(renderer.debug()).toMatchObject({
        frameIdentity: { revision: 6 },
        visibleRegionId: "third",
        graph: {
          actors: [expect.objectContaining({ id: traveler.id, instanceId })],
          ownership: { actors: { created: 1, disposed: 0, outstanding: 1 } },
        },
      });
      expect(renderer.debug().graph.regionTransitions).toEqual([
        expect.objectContaining({ actorId: traveler.id, fromRegion: "worn", toRegion: "spring" }),
        expect.objectContaining({ actorId: traveler.id, fromRegion: "spring", toRegion: "third" }),
      ]);
      expect(placement.snapshot().agents.get(traveler.id)).toMatchObject({
        regionId: "third",
        anchorKind: "arrival:spring",
        point: second.gate,
      });

      renderer.observeRegion("third");
      await settle();
      expect(renderer.debug()).toMatchObject({
        visibleRegionId: "third",
        graph: {
          actors: [expect.objectContaining({
            id: traveler.id,
            instanceId,
            position: second.gate,
          })],
          ownership: { actors: { created: 1, disposed: 0, outstanding: 1 } },
        },
      });
      expect(renderer.debug().graph.regionTransitions).toHaveLength(2);
      renderer.dispose();
    },
  );

  it.each([false, true])(
    "RED: reacquires one hidden causal traveller after Free disposed the ordinary source actor (reduced=%s)",
    async (reducedMotion) => {
      const regions = [
        region("worn", "A thinning and picked-over origin.", ["spring"]),
        region("spring", "Hot spring lakes.", []),
        region("third", "A dry salt basin.", []),
      ] as const;
      const recipes = regions.map((value) => (
        createRegionMapRecipe(createRegionMapIdentity(177, value, regions))
      ));
      const recipeMap = new Map(recipes.map((recipe) => [recipe.regionId, recipe]));
      const traveler = agentSnapshot("traveler", "worn");
      const placement = PlacementLedger.reconstruct(recipes, { agents: [traveler], homes: [] });
      const contract = arrivalContract(traveler.id, "worn", "spring", recipeMap, 722);
      let pool!: ScriptedAtlasPool;
      pool = new ScriptedAtlasPool((id) => Promise.resolve(pool.newLease(id)));
      const renderer = await createCanvasPresentationRenderer({
        canvas: document.createElement("canvas"),
        callbacks: {},
        manifest: PRODUCTION_ASSET_MANIFEST,
        factories: REAL_FACTORIES,
        placement,
        recipes,
        atlasPool: pool,
        reducedMotion,
        frameDriver: new FakeFrameDriver(),
        wakeScheduler: new FakeWakeScheduler(),
        visibilityTarget: new FakeVisibilityTarget(),
        resolveSceneCommands: (next) => next.scene?.momentId === contract.momentId
          ? arrivalBatch(next, contract)
          : null,
      }) as CanvasPresentationRenderer;

      renderer.updatePresentation(frame({
        revision: 1,
        regionId: "worn",
        agents: [traveler],
        regions,
      }));
      await settle();
      const ordinaryInstanceId = renderer.debug().graph.actors[0]!.instanceId;
      renderer.setCameraMode("free");
      renderer.observeRegion("third");
      await settle();
      expect(renderer.debug()).toMatchObject({
        visibleRegionId: "third",
        graph: {
          actors: [],
          ownership: { actors: { created: 0, disposed: 0, outstanding: 0 } },
        },
      });

      renderer.updatePresentation(arrivalFrame(2, "enter", traveler, contract, regions, reducedMotion));
      await settle();
      expect(renderer.debug()).toMatchObject({
        visibleRegionId: "third",
        graph: {
          actors: [],
          ownership: { actors: { created: 1, disposed: 0, outstanding: 1 } },
        },
      });
      const causalOwnership = renderer.debug().graph.ownership.actors;
      renderer.updatePresentation(arrivalFrame(3, "hold", traveler, contract, regions, reducedMotion));
      await settle();
      const arrived = { ...traveler, position: "spring" };
      renderer.updatePresentation(arrivalFrame(4, "consequence", arrived, contract, regions, reducedMotion));
      await settle();
      expect(renderer.debug()).toMatchObject({
        visibleRegionId: "third",
        graph: { actors: [], ownership: { actors: causalOwnership } },
      });
      expect(renderer.debug().graph.regionTransitions).toEqual([
        expect.objectContaining({ actorId: traveler.id, fromRegion: "worn", toRegion: "spring" }),
      ]);
      expect(placement.snapshot().agents.get(traveler.id)).toMatchObject({
        regionId: "spring",
        anchorKind: "arrival:worn",
        point: contract.routeEnd,
      });

      renderer.observeRegion("spring");
      await settle();
      const causalActor = renderer.debug().graph.actors[0]!;
      expect(causalActor).toMatchObject({
        id: traveler.id,
        position: contract.gate,
      });
      expect(causalActor.instanceId).not.toBe(ordinaryInstanceId);
      expect(renderer.debug().graph.ownership.actors).toEqual(causalOwnership);
      expect(renderer.debug().graph.regionTransitions).toHaveLength(1);
      renderer.dispose();
    },
  );

  it("RED: settles normal-motion scheduling while an owned traveller remains hidden off-destination", async () => {
    const traveler = agentSnapshot("traveler", "worn");
    const placement = PlacementLedger.reconstruct(RECIPES, { agents: [traveler], homes: [] });
    const contract = arrivalContract(traveler.id, "worn", "spring", RECIPE_MAP, 724);
    let pool!: ScriptedAtlasPool;
    pool = new ScriptedAtlasPool((id) => Promise.resolve(pool.newLease(id)));
    const driver = new FakeFrameDriver();
    const wake = new FakeWakeScheduler();
    const renderer = await createCanvasPresentationRenderer({
      canvas: document.createElement("canvas"),
      callbacks: {},
      manifest: PRODUCTION_ASSET_MANIFEST,
      factories: REAL_FACTORIES,
      placement,
      recipes: RECIPES,
      atlasPool: pool,
      reducedMotion: false,
      frameDriver: driver,
      wakeScheduler: wake,
      visibilityTarget: new FakeVisibilityTarget(),
      resolveSceneCommands: (next) => arrivalBatch(next, contract),
    }) as CanvasPresentationRenderer;

    renderer.updatePresentation(arrivalFrame(1, "enter", traveler, contract, REGIONS, false));
    await settle();
    renderer.updatePresentation(arrivalFrame(2, "hold", traveler, contract, REGIONS, false));
    await settle();
    renderer.setCameraMode("free");
    renderer.observeRegion("worn");
    await settle();
    const arrived = { ...traveler, position: "spring" };
    renderer.updatePresentation(arrivalFrame(3, "consequence", arrived, contract, REGIONS, false));
    await settle();
    const witness = structuredClone(renderer.debug().graph.regionTransitions);
    const committedPlacement = placement.snapshot().agents.get(traveler.id)!;

    for (let step = 0; step < 120; step += 1) {
      const callbacks = [...wake.callbacks.values()];
      wake.callbacks.clear();
      callbacks.forEach((callback) => callback());
      driver.fire(step * 50);
    }

    const settled = renderer.debug();
    expect(settled).toMatchObject({
      visibleRegionId: "worn",
      graph: {
        actors: [],
        regionTransitions: witness,
      },
      scheduler: {
        dirty: false,
        rafScheduled: false,
      },
    });
    expect(settled.scheduler.nextDeadlineMs === null
      || settled.scheduler.nextDeadlineMs > driver.now()).toBe(true);
    expect(placement.snapshot().agents.get(traveler.id)).toEqual(committedPlacement);

    renderer.observeRegion("spring");
    await settle();
    expect(renderer.debug().graph.actors).toContainEqual(expect.objectContaining({
      id: traveler.id,
      position: contract.routeEnd,
      activeAction: null,
    }));
    renderer.dispose();
  });

  it.each([false, true])(
    "RED: preserves the causal Enter instance across a Free observer hop before Hold (reduced=%s)",
    async (reducedMotion) => {
      const regions = [
        region("worn", "A thinning and picked-over origin.", ["spring"]),
        region("spring", "Hot spring lakes.", []),
        region("third", "A dry salt basin.", []),
      ] as const;
      const recipes = regions.map((value) => (
        createRegionMapRecipe(createRegionMapIdentity(179, value, regions))
      ));
      const recipeMap = new Map(recipes.map((recipe) => [recipe.regionId, recipe]));
      const traveler = agentSnapshot("traveler", "worn");
      const placement = PlacementLedger.reconstruct(recipes, { agents: [traveler], homes: [] });
      const contract = arrivalContract(traveler.id, "worn", "spring", recipeMap, 726);
      let pool!: ScriptedAtlasPool;
      pool = new ScriptedAtlasPool((id) => Promise.resolve(pool.newLease(id)));
      const renderer = await createCanvasPresentationRenderer({
        canvas: document.createElement("canvas"),
        callbacks: {},
        manifest: PRODUCTION_ASSET_MANIFEST,
        factories: REAL_FACTORIES,
        placement,
        recipes,
        atlasPool: pool,
        reducedMotion,
        frameDriver: new FakeFrameDriver(),
        wakeScheduler: new FakeWakeScheduler(),
        visibilityTarget: new FakeVisibilityTarget(),
        resolveSceneCommands: (next) => arrivalBatch(next, contract),
      }) as CanvasPresentationRenderer;

      renderer.updatePresentation(arrivalFrame(1, "enter", traveler, contract, regions, reducedMotion));
      await settle();
      const causalInstanceId = renderer.debug().graph.actors[0]!.instanceId;
      renderer.setCameraMode("free");
      renderer.observeRegion("third");
      await settle();
      expect(renderer.debug()).toMatchObject({
        visibleRegionId: "third",
        graph: {
          actors: [],
          ownership: { actors: { created: 1, disposed: 0, outstanding: 1 } },
        },
      });

      renderer.updatePresentation(arrivalFrame(2, "hold", traveler, contract, regions, reducedMotion));
      await settle();
      const arrived = { ...traveler, position: "spring" };
      renderer.updatePresentation(arrivalFrame(3, "consequence", arrived, contract, regions, reducedMotion));
      await settle();
      expect(renderer.debug()).toMatchObject({
        visibleRegionId: "third",
        graph: {
          actors: [],
          ownership: { actors: { created: 1, disposed: 0, outstanding: 1 } },
        },
      });
      expect(renderer.debug().graph.regionTransitions).toEqual([
        expect.objectContaining({ actorId: traveler.id, fromRegion: "worn", toRegion: "spring" }),
      ]);
      expect(placement.snapshot().agents.get(traveler.id)).toMatchObject({
        regionId: "spring",
        anchorKind: "arrival:worn",
        point: contract.routeEnd,
      });

      renderer.observeRegion("spring");
      await settle();
      expect(renderer.debug().graph.actors).toContainEqual(expect.objectContaining({
        id: traveler.id,
        instanceId: causalInstanceId,
        position: contract.gate,
      }));
      expect(renderer.debug().graph.regionTransitions).toHaveLength(1);
      renderer.dispose();
    },
  );

  it.each([false, true])(
    "RED: preserves one traveller across left-clear-observer-entered singleton scenes (reduced=%s)",
    async (reducedMotion) => {
      const regions = [
        region("worn", "A thinning and picked-over origin.", ["spring"]),
        region("spring", "Hot spring lakes.", []),
        region("third", "A dry salt basin.", []),
      ] as const;
      const recipes = regions.map((value) => (
        createRegionMapRecipe(createRegionMapIdentity(181, value, regions))
      ));
      const recipeMap = new Map(recipes.map((recipe) => [recipe.regionId, recipe]));
      const traveler = agentSnapshot("traveler", "worn");
      const placement = PlacementLedger.reconstruct(recipes, { agents: [traveler], homes: [] });
      const entered = arrivalContract(traveler.id, "worn", "spring", recipeMap, 731);
      const leftMomentId = "left-730";
      const leftProgramId = `choreography:${leftMomentId}:agent_left_region`;
      const leftFrame = (
        revision: number,
        phase: "enter" | "hold" | "consequence" | "recover" | "exit",
      ): PresentedObserverFrame => {
        const base = arrivalFrame(revision, phase, traveler, entered, regions, reducedMotion);
        return {
          ...base,
          scene: {
            ...base.scene!,
            momentId: leftMomentId,
            regionId: "worn",
            phase,
            execution: {
              sceneToken: 730,
              programId: leftProgramId,
              eventType: "agent_left_region",
            },
          },
        };
      };
      const resolve = (next: PresentedObserverFrame): ProductionSceneCommandBatch | null => {
        const identity = {
          runId: next.runId,
          sourceKey: next.sourceKey,
          revision: next.revision,
          firstCursor: next.firstCursor,
          lastCursor: next.lastCursor,
        };
        if (next.scene === null) {
          return {
            identity,
            sceneToken: next.revision <= 6 ? 730 : 731,
            commands: [{
              kind: "clear-scene",
              commandId: next.revision <= 6
                ? `${leftProgramId}:clear-scene`
                : `${entered.programId}:clear-scene`,
            }],
          };
        }
        if (next.scene.execution?.eventType === "agent_left_region") {
          return {
            identity,
            sceneToken: 730,
            commands: next.scene.phase === "enter" || next.scene.phase === "hold"
              ? [{
                  kind: "retain-traveler",
                  commandId: `${leftProgramId}:retain:${traveler.id}`,
                  actorId: traveler.id,
                  fromRegion: "worn",
                  toRegion: "spring",
                }]
              : [],
          };
        }
        return arrivalBatch(next, entered);
      };
      let pool!: ScriptedAtlasPool;
      pool = new ScriptedAtlasPool((id) => Promise.resolve(pool.newLease(id)));
      const renderer = await createCanvasPresentationRenderer({
        canvas: document.createElement("canvas"),
        callbacks: {},
        manifest: PRODUCTION_ASSET_MANIFEST,
        factories: REAL_FACTORIES,
        placement,
        recipes,
        atlasPool: pool,
        reducedMotion,
        frameDriver: new FakeFrameDriver(),
        wakeScheduler: new FakeWakeScheduler(),
        visibilityTarget: new FakeVisibilityTarget(),
        resolveSceneCommands: resolve,
      }) as CanvasPresentationRenderer;

      renderer.updatePresentation(leftFrame(1, "enter"));
      await settle();
      renderer.updatePresentation(leftFrame(2, "hold"));
      await settle();
      const causalInstanceId = renderer.debug().graph.actors[0]!.instanceId;
      renderer.updatePresentation(leftFrame(3, "consequence"));
      await settle();
      renderer.updatePresentation(leftFrame(4, "recover"));
      await settle();
      renderer.updatePresentation(leftFrame(5, "exit"));
      await settle();
      renderer.updatePresentation(frame({
        revision: 6,
        regionId: "worn",
        agents: [traveler],
        regions,
        sceneNull: true,
      }));
      await settle();
      renderer.setCameraMode("free");
      renderer.observeRegion("third");
      await settle();
      expect(renderer.debug()).toMatchObject({
        visibleRegionId: "third",
        graph: {
          actors: [],
          ownership: { actors: { created: 1, disposed: 0, outstanding: 1 } },
        },
      });

      renderer.updatePresentation(arrivalFrame(7, "enter", traveler, entered, regions, reducedMotion));
      await settle();
      renderer.updatePresentation(arrivalFrame(8, "hold", traveler, entered, regions, reducedMotion));
      await settle();
      const arrived = { ...traveler, position: "spring" };
      renderer.updatePresentation(arrivalFrame(9, "consequence", arrived, entered, regions, reducedMotion));
      await settle();
      renderer.updatePresentation(arrivalFrame(10, "recover", arrived, entered, regions, reducedMotion));
      await settle();
      renderer.updatePresentation(arrivalFrame(11, "exit", arrived, entered, regions, reducedMotion));
      await settle();
      renderer.updatePresentation(frame({
        revision: 12,
        regionId: "spring",
        agents: [arrived],
        regions,
        sceneNull: true,
      }));
      await settle();
      for (const regionId of ["worn", "third", "worn"] as const) {
        renderer.observeRegion(regionId);
        await settle();
        expect(renderer.debug()).toMatchObject({
          visibleRegionId: regionId,
          graph: {
            actors: [],
            ownership: { actors: { created: 1, disposed: 0, outstanding: 1 } },
          },
        });
      }
      renderer.observeRegion("spring");
      await settle();

      expect(renderer.debug().graph.actors).toContainEqual(expect.objectContaining({
        id: traveler.id,
        instanceId: causalInstanceId,
        position: entered.gate,
      }));
      expect(renderer.debug().graph.ownership.actors).toMatchObject({
        created: 1,
        disposed: 0,
        outstanding: 1,
      });
      expect(renderer.debug().graph.regionTransitions).toEqual([
        expect.objectContaining({ actorId: traveler.id, fromRegion: "worn", toRegion: "spring" }),
      ]);
      expect(placement.snapshot().agents.get(traveler.id)).toMatchObject({
        regionId: "spring",
        anchorKind: "arrival:worn",
        point: entered.routeEnd,
      });

      renderer.observeRegion("third");
      await settle();
      expect(renderer.debug().graph.ownership.actors).toMatchObject({
        created: 0,
        disposed: 0,
        outstanding: 0,
      });
      renderer.observeRegion("spring");
      await settle();
      expect(renderer.debug().graph.actors).toContainEqual(expect.objectContaining({
        id: traveler.id,
        position: entered.routeEnd,
      }));
      expect(renderer.debug().graph.actors[0]!.instanceId).not.toBe(causalInstanceId);
      expect(renderer.debug().graph.ownership.actors).toMatchObject({
        created: 1,
        disposed: 0,
        outstanding: 1,
      });
      expect(renderer.debug().graph.regionTransitions).toEqual([]);
      renderer.dispose();
    },
  );

  it("FINAL RED: destination decode failure keeps the real origin graph/actor and releases partial destination refs", async () => {
    const traveler = agentSnapshot("traveler", "worn");
    const placement = PlacementLedger.reconstruct(RECIPES, { agents: [traveler], homes: [] });
    const destinationIds = activeAtlasIds("spring");
    const failId = PRODUCTION_ASSET_MANIFEST.regions[RECIPE_MAP.get("spring")!.kit].atlasIds[0]!;
    let failDestination = false;
    let pool!: ScriptedAtlasPool;
    pool = new ScriptedAtlasPool((id): Promise<ProductionAssetLease<ImageBitmap>> => failDestination && id === failId
      ? Promise.reject(new Error("destination decode failed"))
      : Promise.resolve(pool.newLease(id)));
    const renderer = await createCanvasPresentationRenderer({
      canvas: document.createElement("canvas"), callbacks: {},
      manifest: PRODUCTION_ASSET_MANIFEST, factories: REAL_FACTORIES,
      placement, recipes: RECIPES, atlasPool: pool,
      frameDriver: new FakeFrameDriver(), wakeScheduler: new FakeWakeScheduler(),
      visibilityTarget: new FakeVisibilityTarget(),
      resolveSceneCommands: (next) => ({
        identity: { runId: next.runId, sourceKey: next.sourceKey, revision: next.revision, firstCursor: next.firstCursor, lastCursor: next.lastCursor },
        sceneToken: 701,
        commands: next.revision === 1 ? [{ kind: "retain-traveler", commandId: "retain:decode", actorId: traveler.id, fromRegion: "worn", toRegion: "spring" }] : [],
      }),
    }) as CanvasPresentationRenderer;
    renderer.updatePresentation(frame({ revision: 1, regionId: "worn", agents: [traveler] }));
    await settle();
    const before = renderer.debug();
    const recordsBeforeDestination = pool.records.length;
    failDestination = true;
    renderer.updatePresentation(frame({ revision: 2, regionId: "spring", agents: [traveler] }));
    await settle();
    expect(renderer.debug()).toMatchObject({
      visibleRegionId: "worn",
      frameIdentity: before.frameIdentity,
      graph: { actors: [expect.objectContaining({ instanceId: before.graph.actors[0]!.instanceId })] },
    });
    const partialDestination = pool.records.slice(recordsBeforeDestination)
      .filter(({ id }) => destinationIds.includes(id) && id !== failId);
    expect(partialDestination.length).toBeGreaterThan(0);
    expect(partialDestination.every(({ lease }) => vi.mocked(lease.release).mock.calls.length === 1)).toBe(true);
    renderer.dispose();
  });

  it("returns real Graph home atlas ownership to the exact baseline across lineage replacement", async () => {
    const owner = agentSnapshot("owner", "worn");
    const home = homeSnapshot("home-a", owner.id, "worn");
    const placement = PlacementLedger.reconstruct(RECIPES, {
      agents: [owner],
      homes: [home],
    });
    let pool!: ScriptedAtlasPool;
    pool = new ScriptedAtlasPool((id) => Promise.resolve(pool.newLease(id)));
    const renderer = await createCanvasPresentationRenderer({
      canvas: document.createElement("canvas"),
      callbacks: {},
      manifest: PRODUCTION_ASSET_MANIFEST,
      factories: REAL_FACTORIES,
      placement,
      recipes: RECIPES,
      atlasPool: pool,
      frameDriver: new FakeFrameDriver(),
      wakeScheduler: new FakeWakeScheduler(),
      visibilityTarget: new FakeVisibilityTarget(),
      resolveSceneCommands: () => null,
    }) as CanvasPresentationRenderer;
    const outstandingLeases = (): number => pool.records.filter(({ lease }) => (
      vi.mocked(lease.release).mock.calls.length === 0
    )).length;

    renderer.updatePresentation(frame({
      revision: 1,
      regionId: "worn",
      agents: [owner],
      homes: [home],
    }));
    await settle();
    const liveBaseline = outstandingLeases();
    expect(liveBaseline).toBeGreaterThan(0);

    renderer.updatePresentation(frame({
      sourceKey: "archive:run-a",
      revision: 0,
      firstCursor: 0,
      regionId: "worn",
      agents: [owner],
      homes: [home],
    }));
    await settle();
    expect(outstandingLeases()).toBe(liveBaseline);

    renderer.updatePresentation(frame({
      sourceKey: "live:run-a",
      revision: 2,
      regionId: "worn",
      agents: [owner],
      homes: [home],
    }));
    await settle();
    expect(outstandingLeases()).toBe(liveBaseline);

    renderer.dispose();
    expect(outstandingLeases()).toBe(0);
  });

  it("recovers the latest frame after hiding during the initial atlas generation", async () => {
    const delayedId = activeAtlasIds("worn")[0]!;
    const delayed = deferred<ProductionAssetLease<ImageBitmap>>();
    let delayedOnce = true;
    const pool = new ScriptedAtlasPool((id) => {
      if (id === delayedId && delayedOnce) {
        delayedOnce = false;
        return delayed.promise;
      }
      return Promise.resolve(manifestLease(id));
    });
    const fixture = await harness({ pool });

    fixture.renderer.updatePresentation(frame({ revision: 1, regionId: "worn" }));
    fixture.visibility.setHidden(true);
    delayed.resolve(pool.newLease(delayedId));
    await settle();
    fixture.visibility.setHidden(false);
    fixture.renderer.updatePresentation(frame({ revision: 2, regionId: "worn" }));
    await settle();

    expect(fixture.graphs.flatMap((graph) => graph.frames).at(-1)?.revision).toBe(2);
    expect(fixture.renderer.debug()).toMatchObject({
      loadingRegionId: null,
      frameIdentity: { revision: 2 },
    });
    expect(pool.acquireCalls.filter(({ id }) => id === delayedId)).toHaveLength(1);
    fixture.renderer.dispose();
  });

  it("keeps the freshest pending frame when an older same-region frame arrives before decode", async () => {
    const delayedId = activeAtlasIds("worn")[0]!;
    const delayed = deferred<ProductionAssetLease<ImageBitmap>>();
    const pool = new ScriptedAtlasPool((id) => id === delayedId
      ? delayed.promise
      : Promise.resolve(manifestLease(id)));
    const fixture = await harness({ pool });

    fixture.renderer.updatePresentation(frame({ revision: 3, firstCursor: 1, regionId: "worn" }));
    fixture.renderer.updatePresentation(frame({ revision: 2, firstCursor: 1, regionId: "worn" }));
    delayed.resolve(pool.newLease(delayedId));
    await settle();

    expect(fixture.graphs.flatMap((graph) => graph.frames).at(-1)?.revision).toBe(3);
    expect(fixture.renderer.debug().frameIdentity?.revision).toBe(3);
    fixture.renderer.dispose();
  });

  it("uses the selected entity region when no Story scene owns the initial view", async () => {
    const pool = new ScriptedAtlasPool((id) => Promise.resolve(manifestLease(id)));
    const fixture = await harness({ pool });
    const base = frame({ revision: 1, regionId: "worn" });
    fixture.renderer.updatePresentation({
      ...base,
      scene: null,
      selection: { kind: "region", id: "spring" },
    });
    await settle();

    expect(fixture.renderer.debug().visibleRegionId).toBe("spring");
    const springKit = RECIPE_MAP.get("spring")!.kit;
    expect(pool.acquireCalls.some(({ id }) =>
      PRODUCTION_ASSET_MANIFEST.atlases[id]?.regionKit === springKit)).toBe(true);
    fixture.renderer.dispose();
  });

  it("aborts an abandoned region load when a newer frame returns to the current region", async () => {
    const springDelayedId = activeAtlasIds("spring")
      .find((id) => PRODUCTION_ASSET_MANIFEST.atlases[id]?.regionKit === RECIPE_MAP.get("spring")!.kit)!;
    const springDelayed = deferred<ProductionAssetLease<ImageBitmap>>();
    let springSignal: AbortSignal | undefined;
    const pool = new ScriptedAtlasPool((id, signal) => {
      if (id === springDelayedId) {
        springSignal = signal;
        return springDelayed.promise;
      }
      return Promise.resolve(manifestLease(id));
    });
    const fixture = await harness({ pool });
    fixture.renderer.updatePresentation(frame({ revision: 1, regionId: "worn" }));
    await settle();

    fixture.renderer.updatePresentation(frame({ revision: 2, regionId: "spring" }));
    fixture.renderer.updatePresentation(frame({ revision: 3, regionId: "worn" }));
    expect(springSignal?.aborted).toBe(true);
    springDelayed.resolve(pool.newLease(springDelayedId));
    await settle();

    expect(fixture.renderer.debug()).toMatchObject({
      visibleRegionId: "worn",
      loadingRegionId: null,
      frameIdentity: { revision: 3 },
    });
    expect(fixture.graphs.flatMap((graph) => graph.frames).at(-1)).toMatchObject({
      revision: 3,
      scene: { regionId: "worn" },
    });
    fixture.renderer.dispose();
  });

  it("invalidates a prior-lineage pending load before installing a replacement source", async () => {
    const springDelayedId = activeAtlasIds("spring")
      .find((id) => PRODUCTION_ASSET_MANIFEST.atlases[id]?.regionKit === RECIPE_MAP.get("spring")!.kit)!;
    const springDelayed = deferred<ProductionAssetLease<ImageBitmap>>();
    let springSignal: AbortSignal | undefined;
    const pool = new ScriptedAtlasPool((id, signal) => {
      if (id === springDelayedId) {
        springSignal = signal;
        return springDelayed.promise;
      }
      return Promise.resolve(manifestLease(id));
    });
    const fixture = await harness({ pool });
    fixture.renderer.updatePresentation(frame({ revision: 1, regionId: "worn" }));
    await settle();
    fixture.renderer.updatePresentation(frame({ revision: 2, regionId: "spring" }));

    const replacement = frame({
      runId: "run-b",
      sourceKey: "archive:run-b",
      revision: 1,
      regionId: "worn",
    });
    fixture.renderer.updatePresentation(replacement);
    expect(springSignal?.aborted).toBe(true);
    springDelayed.resolve(pool.newLease(springDelayedId));
    await settle();

    expect(fixture.renderer.debug()).toMatchObject({
      visibleRegionId: "worn",
      loadingRegionId: null,
      frameIdentity: { runId: "run-b", sourceKey: "archive:run-b", revision: 1 },
    });
    expect(fixture.graphs.flatMap((graph) => graph.frames).at(-1)).toMatchObject({
      runId: "run-b",
      sourceKey: "archive:run-b",
    });
    fixture.renderer.dispose();
  });

  it("aborts siblings and releases a late successful lease after an early atlas rejection", async () => {
    const [rejectId, lateId] = activeAtlasIds("worn");
    const late = deferred<ProductionAssetLease<ImageBitmap>>();
    let sharedSignal: AbortSignal | undefined;
    const lateLease = fakeLease(lateId!);
    const pool = new ScriptedAtlasPool((id, signal) => {
      sharedSignal = signal;
      if (id === rejectId) return Promise.reject(new Error("early decode failure"));
      if (id === lateId) return late.promise;
      return Promise.resolve(manifestLease(id));
    });
    const onFailure = vi.fn();
    const fixture = await harness({ pool, callbacks: { onFailure } });

    fixture.renderer.updatePresentation(frame({ revision: 1, regionId: "worn" }));
    await settle();
    expect(sharedSignal?.aborted).toBe(true);
    late.resolve(lateLease);
    await settle();

    expect(lateLease.release).toHaveBeenCalledOnce();
    expect(onFailure).toHaveBeenCalledOnce();
    expect(fixture.renderer.debug()).toMatchObject({ frameIdentity: null, loadingRegionId: null });
    fixture.renderer.dispose();
  });

  it("retries after failure and releases both old-late and retry-late leases on dispose", async () => {
    const [rejectId, lateId] = activeAtlasIds("worn");
    const oldLate = deferred<ProductionAssetLease<ImageBitmap>>();
    const retryLate = deferred<ProductionAssetLease<ImageBitmap>>();
    const oldLease = fakeLease(lateId!);
    const retryLease = fakeLease(lateId!);
    let attempt = 1;
    let firstSignal: AbortSignal | undefined;
    const pool = new ScriptedAtlasPool((id, signal) => {
      if (attempt === 1) firstSignal = signal;
      if (attempt === 1 && id === rejectId) return Promise.reject(new Error("first attempt"));
      if (attempt === 1 && id === lateId) return oldLate.promise;
      if (attempt === 2 && id === lateId) return retryLate.promise;
      return Promise.resolve(manifestLease(id));
    });
    const fixture = await harness({ pool });

    fixture.renderer.updatePresentation(frame({ revision: 1, regionId: "worn" }));
    await settle();
    expect(firstSignal?.aborted).toBe(true);
    oldLate.resolve(oldLease);
    await settle();
    expect(oldLease.release).toHaveBeenCalledOnce();

    attempt = 2;
    fixture.renderer.updatePresentation(frame({ revision: 1, regionId: "worn" }));
    fixture.renderer.dispose();
    retryLate.resolve(retryLease);
    await settle();

    expect(retryLease.release).toHaveBeenCalledOnce();
    expect(fixture.renderer.diagnostics().disposed).toBe(true);
  });

  it("claims exact Canvas ownership and rejects a second renderer on the same surface", async () => {
    const canvas = document.createElement("canvas");
    const firstPool = new ScriptedAtlasPool((id) => Promise.resolve(manifestLease(id)));
    const secondPool = new ScriptedAtlasPool((id) => Promise.resolve(manifestLease(id)));
    const first = await createBareRenderer(canvas, firstPool);
    const secondResult = await createBareRenderer(canvas, secondPool).then(
      (renderer) => ({ renderer, error: null as unknown }),
      (error: unknown) => ({ renderer: null, error }),
    );
    secondResult.renderer?.dispose();
    first.dispose();

    expect(secondResult.error).toMatchObject({ code: "surface-already-owned" });
  });

  it("rejects a pre-aborted construction before graph, listener, or surface ownership", async () => {
    const canvas = document.createElement("canvas");
    const controller = new AbortController();
    controller.abort();
    const pool = new ScriptedAtlasPool((id) => Promise.resolve(manifestLease(id)));
    const graphFactory = vi.fn((_options: ProductionSceneGraphOptions): ProductionSceneGraph =>
      fakeGraph() as unknown as ProductionSceneGraph);
    const visibility = new FakeVisibilityTarget();
    const result = await createCanvasPresentationRenderer(baseOptions({
      canvas,
      pool,
      graphFactory,
      visibility,
      signal: controller.signal,
    })).then(
      (renderer) => ({ renderer, error: null as unknown }),
      (error: unknown) => ({ renderer: null, error }),
    );
    result.renderer?.dispose();

    expect(result.error).toMatchObject({ name: "AbortError" });
    expect(graphFactory).not.toHaveBeenCalled();
    expect(visibility.listenerCount).toBe(0);
  });

  it("rasterizes terrain, scenery, and the active biome continuation from committed recipe atlases", async () => {
    const pool = new ScriptedAtlasPool((id) => Promise.resolve(manifestLease(id)));
    const fixture = await harness({ pool });
    fixture.renderer.updatePresentation(frame({ revision: 1, regionId: "worn" }));
    await settle();
    fixture.driver.fire(16);

    const terrain = [...contexts.entries()].find(([canvas]) => canvas.dataset.cache === "terrain")?.[1];
    const scenery = [...contexts.entries()].find(([canvas]) => canvas.dataset.cache === "scenery")?.[1];
    const wornContinuationEntry = [...contexts.entries()].find(
      ([canvas]) => canvas.dataset.cache === "continuation-matte",
    )!;
    const wornKit = RECIPE_MAP.get("worn")!.kit;
    const wornGround = PRODUCTION_ASSET_MANIFEST.regions[wornKit].terrainFramesByRole.ground;
    const wornGroundRects = new Set(wornGround.map(({ frame }) =>
      `${frame.rect.x},${frame.rect.y},${frame.rect.width},${frame.rect.height}`));
    const wornAtlasId = wornGround[0]!.frame.atlasId;
    expect(terrain?.drawImageCalls.length).toBeGreaterThan(0);
    expect(scenery?.drawImageCalls.length).toBeGreaterThan(0);
    expect(wornContinuationEntry[1].drawImageCalls).toHaveLength(64);
    expect(wornContinuationEntry[1].drawImageCalls.every((call) => call[0] === pool.ready.get(wornAtlasId)))
      .toBe(true);
    expect(wornContinuationEntry[1].drawImageCalls.every((call) =>
      wornGroundRects.has(`${call[1]},${call[2]},${call[3]},${call[4]}`))).toBe(true);

    fixture.renderer.updatePresentation(frame({ revision: 2, regionId: "spring" }));
    await settle();
    fixture.driver.fire(32);
    const springContinuationEntry = [...contexts.entries()].filter(
      ([canvas]) => canvas.dataset.cache === "continuation-matte",
    ).at(-1)!;
    const springKit = RECIPE_MAP.get("spring")!.kit;
    const springGround = PRODUCTION_ASSET_MANIFEST.regions[springKit].terrainFramesByRole.ground;
    const springAtlasId = springGround[0]!.frame.atlasId;
    expect(springContinuationEntry[0]).not.toBe(wornContinuationEntry[0]);
    expect(springContinuationEntry[1].drawImageCalls).toHaveLength(64);
    expect(springContinuationEntry[1].drawImageCalls.every(
      (call) => call[0] === pool.ready.get(springAtlasId),
    )).toBe(true);
    expect(pool.acquireCalls).toHaveLength(activeAtlasIds("worn").length + activeAtlasIds("spring").length);
    fixture.renderer.dispose();
  });

  it("applies the exact camera zoom and integer raster origin to cache and graph pixels", async () => {
    const pool = new ScriptedAtlasPool((id) => Promise.resolve(manifestLease(id)));
    const fixture = await harness({ pool });
    fixture.renderer.resize(512, 288);
    fixture.renderer.updatePresentation(frame({ revision: 1, regionId: "worn" }));
    await settle();
    fixture.renderer.panCamera({ x: 32, y: 16 });
    fixture.renderer.zoomCamera(1.5, { x: 256, y: 144 });
    fixture.driver.fire(16);

    const debug = fixture.renderer.debug();
    const camera = debug.camera;
    const transform = fixture.graphs.at(-1)!.drawTransforms.at(-1);
    const expectedTransform = [
      camera.zoom,
      0,
      0,
      camera.zoom,
      debug.renderRasterOrigin!.x,
      debug.renderRasterOrigin!.y,
    ];
    expect(transform).toEqual(expectedTransform);
    expect(contexts.get(fixture.canvas)?.drawImageTransforms.slice(-2)).toEqual([
      expectedTransform,
      expectedTransform,
    ]);
    expect(Number.isInteger(transform?.[4])).toBe(true);
    expect(Number.isInteger(transform?.[5])).toBe(true);
    fixture.renderer.dispose();
  });

  it("presents a real multi-region Task 8 world without acquiring offscreen regional atlases", async () => {
    const agent = agentSnapshot("aster", "worn");
    const offscreenHome = homeSnapshot("spring-home", "aster", "spring");
    const placement = PlacementLedger.reconstruct(RECIPES, {
      agents: [agent],
      homes: [offscreenHome],
    });
    const pool = new ScriptedAtlasPool((id) => Promise.resolve(manifestLease(id)));
    const failures: Parameters<NonNullable<ObserverRendererCallbacks["onFailure"]>>[0][] = [];
    const canvas = document.createElement("canvas");
    const driver = new FakeFrameDriver();
    const renderer = await createCanvasPresentationRenderer({
      canvas,
      callbacks: { onFailure: (failure) => failures.push(failure) },
      manifest: PRODUCTION_ASSET_MANIFEST,
      factories: REAL_FACTORIES,
      placement,
      recipes: RECIPES,
      atlasPool: pool,
      frameDriver: driver,
      wakeScheduler: new FakeWakeScheduler(),
      visibilityTarget: new FakeVisibilityTarget(),
    });

    renderer.updatePresentation(frame({
      revision: 1,
      regionId: "worn",
      agents: [agent],
      homes: [offscreenHome],
    }));
    await settle();

    expect(failures).toEqual([]);
    expect(renderer.diagnostics()).toMatchObject({
      frameIdentity: { revision: 1 },
      activeActors: 1,
      activeHomes: 0,
    });
    const springKit = RECIPE_MAP.get("spring")!.kit;
    expect(pool.acquireCalls.some(({ id }) =>
      PRODUCTION_ASSET_MANIFEST.atlases[id]?.regionKit === springKit)).toBe(false);
    renderer.dispose();
  });

  it("exposes detached graph, camera, scheduler, and pool detail for a snapshot-only stage probe", async () => {
    const pool = new ScriptedAtlasPool((id) => Promise.resolve(manifestLease(id)));
    const fixture = await harness({ pool });
    fixture.renderer.updatePresentation(frame({ revision: 1, regionId: "worn" }));
    await settle();

    const snapshot = fixture.renderer.debug() as unknown as {
      readonly graph?: Readonly<Record<string, unknown>>;
      readonly camera?: Readonly<Record<string, unknown>>;
      readonly scheduler?: Readonly<Record<string, unknown>>;
      readonly pool?: Readonly<Record<string, unknown>>;
    };
    expect(snapshot).toMatchObject({
      graph: expect.objectContaining({ activeActors: 0, activeHomes: 0 }),
      camera: expect.objectContaining({ mode: "story" }),
      scheduler: expect.objectContaining({
        hidden: false,
        rafScheduled: true,
        wakeScheduled: false,
      }),
      pool: expect.objectContaining({ activeAtlasIds: expect.any(Array) }),
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.graph)).toBe(true);
    expect(Object.isFrozen(snapshot.camera)).toBe(true);
    expect(Object.isFrozen(snapshot.scheduler)).toBe(true);
    expect(Object.isFrozen(snapshot.pool)).toBe(true);
    expect(fixture.renderer.debug()).not.toBe(snapshot);
    fixture.renderer.dispose();
  });

  it("uses integer backing and CSS sizes with centered integer offsets for fractional resize input", async () => {
    const pool = new ScriptedAtlasPool((id) => Promise.resolve(manifestLease(id)));
    const fixture = await harness({ pool });
    const cssWidth = 901.75;
    const cssHeight = 701.25;
    fixture.renderer.resize(cssWidth, cssHeight);

    const styledWidth = Number.parseFloat(fixture.canvas.style.width);
    const styledHeight = Number.parseFloat(fixture.canvas.style.height);
    const left = Number.parseFloat(fixture.canvas.style.left);
    const top = Number.parseFloat(fixture.canvas.style.top);
    expect(Number.isInteger(fixture.canvas.width)).toBe(true);
    expect(Number.isInteger(fixture.canvas.height)).toBe(true);
    expect(Number.isInteger(styledWidth)).toBe(true);
    expect(Number.isInteger(styledHeight)).toBe(true);
    expect(Number.isInteger(left)).toBe(true);
    expect(Number.isInteger(top)).toBe(true);
    expect(left).toBe(Math.floor((cssWidth - styledWidth) / 2));
    expect(top).toBe(Math.floor((cssHeight - styledHeight) / 2));
    fixture.renderer.dispose();
  });
});

const REAL_FACTORIES: ProductionSceneFactories = {
  createActor(input) {
    const value = input.record.value;
    return new LayeredHumanActor({
      id: value.id!,
      name: value.name!,
      persona: value.persona,
      position: input.position,
      facing: input.facing,
      manifest: input.manifest,
      atlasLeases: input.atlasLeases,
      reducedMotion: input.reducedMotion,
    });
  },
  createHome(input) {
    return new HomeActor({
      id: input.id,
      manifest: input.manifest,
      atlasLeases: input.atlasLeases,
      initial: input.presented,
    });
  },
  createEnvironment(input) {
    return new EnvironmentSystem(input);
  },
};

class FaultingUpdateActor extends LayeredHumanActor {
  throwOnNextApply = false;

  override apply(command: HumanPrimitiveCommand, nowMs: number): void {
    if (this.throwOnNextApply) {
      this.throwOnNextApply = false;
      throw new Error("update-time actor reconciliation fault");
    }
    super.apply(command, nowMs);
  }
}

async function harness(options: Readonly<{
  pool: ScriptedAtlasPool;
  callbacks?: ObserverRendererCallbacks;
}>): Promise<{
  renderer: CanvasPresentationRenderer;
  canvas: HTMLCanvasElement;
  driver: FakeFrameDriver;
  wake: FakeWakeScheduler;
  visibility: FakeVisibilityTarget;
  graphs: FakeGraph[];
}> {
  const canvas = document.createElement("canvas");
  const driver = new FakeFrameDriver();
  const wake = new FakeWakeScheduler();
  const visibility = new FakeVisibilityTarget();
  const graphs: FakeGraph[] = [];
  const graphFactory = (_options: ProductionSceneGraphOptions): ProductionSceneGraph => {
    const graph = fakeGraph();
    graphs.push(graph);
    return graph as unknown as ProductionSceneGraph;
  };
  const renderer = await createCanvasPresentationRenderer({
    ...baseOptions({ canvas, pool: options.pool, graphFactory, visibility }),
    callbacks: options.callbacks ?? {},
    frameDriver: driver,
    wakeScheduler: wake,
  }) as CanvasPresentationRenderer;
  return { renderer, canvas, driver, wake, visibility, graphs };
}

async function createBareRenderer(
  canvas: HTMLCanvasElement,
  pool: ScriptedAtlasPool,
): Promise<ObserverRendererPort> {
  return createCanvasPresentationRenderer(baseOptions({
    canvas,
    pool,
    graphFactory: () => fakeGraph() as unknown as ProductionSceneGraph,
    visibility: new FakeVisibilityTarget(),
  }));
}

function baseOptions(input: Readonly<{
  canvas: HTMLCanvasElement;
  pool: ScriptedAtlasPool;
  graphFactory: (options: ProductionSceneGraphOptions) => ProductionSceneGraph;
  visibility: FakeVisibilityTarget;
  signal?: AbortSignal;
}>): CanvasPresentationRendererOptions {
  return {
    canvas: input.canvas,
    callbacks: {},
    manifest: PRODUCTION_ASSET_MANIFEST,
    factories: {} as ProductionSceneFactories,
    placement: {} as PlacementLedger,
    recipes: RECIPES,
    atlasPool: input.pool,
    frameDriver: new FakeFrameDriver(),
    wakeScheduler: new FakeWakeScheduler(),
    sceneGraphFactory: input.graphFactory,
    visibilityTarget: input.visibility,
    signal: input.signal,
  };
}

interface FakeGraph {
  readonly frames: PresentedObserverFrame[];
  readonly drawTransforms: number[][];
  readonly update: ReturnType<typeof vi.fn>;
  readonly updateTime: ReturnType<typeof vi.fn>;
  readonly draw: ReturnType<typeof vi.fn>;
  readonly nextDeadlineMs: ReturnType<typeof vi.fn>;
  readonly hitTargets: ReturnType<typeof vi.fn>;
  readonly focusTarget: ReturnType<typeof vi.fn>;
  readonly semanticSnapshot: ReturnType<typeof vi.fn>;
  readonly debugSnapshot: ReturnType<typeof vi.fn>;
  readonly dispose: ReturnType<typeof vi.fn>;
}

function fakeGraph(): FakeGraph {
  const frames: PresentedObserverFrame[] = [];
  const drawTransforms: number[][] = [];
  return {
    frames,
    drawTransforms,
    update: vi.fn((
      next: PresentedObserverFrame,
      _batch?: unknown,
      observerViewRegionId?: string | null,
    ): SceneGraphDiff => {
      frames.push(structuredClone(next));
      return {
        outcome: "applied",
        added: [],
        updated: [],
        removed: [],
        staticLayersInvalidated: true,
      };
    }),
    updateTime: vi.fn(),
    draw: vi.fn((context: CanvasRenderingContext2D) => {
      drawTransforms.push([...(context as unknown as RecordingContext).transform]);
    }),
    nextDeadlineMs: vi.fn(() => null),
    hitTargets: vi.fn(() => []),
    focusTarget: vi.fn(() => null),
    semanticSnapshot: vi.fn(() => {
      const current = frames.at(-1)!;
      return {
        frameIdentity: {
          runId: current.runId,
          sourceKey: current.sourceKey,
          revision: current.revision,
          firstCursor: current.firstCursor,
          lastCursor: current.lastCursor,
        },
        subjects: [],
      };
    }),
    debugSnapshot: vi.fn(() => ({
      actors: [],
      homes: [],
      environments: [],
      transients: [],
      recentMarkers: [],
      activeActors: 0,
      activeHomes: 0,
      activeEffects: 0,
      pathFallbacks: 0,
      ownership: {
        actors: { created: 0, disposed: 0, outstanding: 0, peak: 0 },
        homes: { created: 0, disposed: 0, outstanding: 0, peak: 0 },
        environments: { created: 0, disposed: 0, outstanding: 0, peak: 0 },
      },
    })),
    dispose: vi.fn(),
  };
}

class ScriptedAtlasPool implements SharedAtlasPool {
  readonly acquireCalls: Array<Readonly<{ id: string; signal: AbortSignal | undefined }>> = [];
  readonly retainCalls: string[] = [];
  readonly leases: ProductionAssetLease<ImageBitmap>[] = [];
  readonly records: Array<{ readonly id: string; readonly lease: ProductionAssetLease<ImageBitmap> }> = [];
  readonly ready = new Map<string, ImageBitmap>();
  readonly dispose = vi.fn();

  constructor(
    readonly script: (
      id: string,
      signal: AbortSignal | undefined,
    ) => Promise<ProductionAssetLease<ImageBitmap>>,
  ) {}

  acquire(id: string, signal?: AbortSignal): Promise<ProductionAssetLease<ImageBitmap>> {
    this.acquireCalls.push({ id, signal });
    return this.script(id, signal).then((lease) => {
      this.ready.set(id, lease.value);
      this.leases.push(lease);
      this.records.push({ id, lease });
      return lease;
    });
  }

  retain(id: string): ProductionAssetLease<ImageBitmap> {
    this.retainCalls.push(id);
    const bitmap = this.ready.get(id);
    if (!bitmap) throw new Error(`Atlas ${id} is not ready.`);
    const lease = fakeLease(id, bitmap);
    this.leases.push(lease);
    this.records.push({ id, lease });
    return lease;
  }

  newLease(id: string): ProductionAssetLease<ImageBitmap> {
    const descriptor = PRODUCTION_ASSET_MANIFEST.atlases[id]!;
    return fakeLease(id, {
      width: descriptor.width,
      height: descriptor.height,
      close: vi.fn(),
    } as unknown as ImageBitmap);
  }

  diagnostics(): SharedAtlasPoolDiagnostics {
    return {
      disposed: false,
      compressedBytes: 0,
      decodedBytes: 0,
      leases: this.leases.length,
      expectedActiveCompressedBytes: 0,
      activeCompressedMax: PRODUCTION_ASSET_MANIFEST.budgets.activeCompressedMax,
      currentUiCompressedBytes: PRODUCTION_ASSET_MANIFEST.budgets.currentUiCompressedBytes,
      overBudget: false,
      inFlightCount: 0,
      waiterCount: 0,
      closeCount: 0,
      abortCount: 0,
      failureCount: 0,
      activeAtlasIds: [...this.ready.keys()],
      entries: [],
      lifecycle: {
        acquireCalls: this.acquireCalls.length,
        retainCalls: this.retainCalls.length,
        decodeStarts: this.ready.size,
        leasesCreated: this.leases.length,
        leasesReleased: this.leases.filter(({ release }) => vi.mocked(release).mock.calls.length > 0).length,
        peakLeases: this.leases.length,
      },
    };
  }
}

function activeAtlasIds(regionId: string): string[] {
  const recipe = RECIPE_MAP.get(regionId)!;
  return [...new Set([
    ...Object.values(PRODUCTION_ASSET_MANIFEST.atlases)
      .filter((atlas) => atlas.group === "core")
      .map((atlas) => atlas.id),
    ...PRODUCTION_ASSET_MANIFEST.regions[recipe.kit].atlasIds,
  ])].sort(compareText);
}

interface ArrivalTestContract {
  readonly actorId: string;
  readonly fromRegion: string;
  readonly toRegion: string;
  readonly momentId: string;
  readonly programId: string;
  readonly sceneToken: number;
  readonly sourcePoint: Readonly<{ x: number; y: number }>;
  readonly gate: Readonly<{ x: number; y: number }>;
  readonly routeEnd: Readonly<{ x: number; y: number }>;
}

function arrivalContract(
  actorId: string,
  fromRegion: string,
  toRegion: string,
  recipes: ReadonlyMap<string, RegionMapRecipeV1>,
  sceneToken: number,
): ArrivalTestContract {
  const destination = recipes.get(toRegion);
  const gate = destination?.gates.find((candidate) => (
    candidate.role === "arrival"
    && candidate.edge.from === fromRegion
    && candidate.edge.to === toRegion
  ));
  if (gate === undefined) throw new Error(`Missing ${fromRegion} -> ${toRegion} arrival gate.`);
  const source = recipes.get(fromRegion)?.stagingAnchors[0];
  if (source === undefined) throw new Error(`Missing ${fromRegion} staging anchor.`);
  const gatePoint = tileCenter(gate.tile);
  return {
    actorId,
    fromRegion,
    toRegion,
    momentId: `arrival-${sceneToken}`,
    programId: `choreography:arrival-${sceneToken}:agent_entered_region`,
    sceneToken,
    sourcePoint: tileCenter(source),
    gate: gatePoint,
    routeEnd: { x: gatePoint.x + 32, y: gatePoint.y },
  };
}

function arrivalFrame(
  revision: number,
  phase: "enter" | "hold" | "consequence" | "recover" | "exit",
  traveler: AgentSnapshot,
  contract: ArrivalTestContract,
  regions: readonly RegionSnapshot[],
  reducedMotion: boolean,
): PresentedObserverFrame {
  const activeRegion = phase === "enter" ? contract.fromRegion : contract.toRegion;
  const base = frame({ revision, regionId: activeRegion, agents: [traveler], regions });
  return {
    ...base,
    scene: {
      ...base.scene!,
      momentId: contract.momentId,
      regionId: activeRegion,
      phase,
      focus: { kind: "agent", id: traveler.id },
      actorIntents: phase === "consequence"
        ? [{
            kind: "move",
            actorId: traveler.id,
            target: contract.routeEnd,
            waypoints: [contract.gate, contract.routeEnd],
            marker: "arrival-inward",
          }]
        : [],
      effectIntents: phase === "hold"
        ? [{
            kind: "atlas-transition",
            sourceId: contract.fromRegion,
            targetId: contract.toRegion,
          }]
        : [],
      reducedMotion,
      execution: {
        sceneToken: contract.sceneToken,
        programId: contract.programId,
        eventType: "agent_entered_region",
      },
    },
  };
}

function arrivalBatch(
  next: PresentedObserverFrame,
  contract: ArrivalTestContract,
): ProductionSceneCommandBatch {
  const identity = {
    runId: next.runId,
    sourceKey: next.sourceKey,
    revision: next.revision,
    firstCursor: next.firstCursor,
    lastCursor: next.lastCursor,
  };
  const phase = next.scene?.phase;
  if (phase === "recover" || phase === "exit") {
    return {
      identity,
      sceneToken: contract.sceneToken,
      commands: [],
    };
  }
  if (phase === "enter") {
    return {
      identity,
      sceneToken: contract.sceneToken,
      commands: [{
        kind: "retain-traveler",
        commandId: `${contract.programId}:retain:${contract.actorId}`,
        actorId: contract.actorId,
        fromRegion: contract.fromRegion,
        toRegion: contract.toRegion,
      }],
    };
  }
  if (phase === "hold") {
    return {
      identity,
      sceneToken: contract.sceneToken,
      commands: [{
        kind: "retain-traveler",
        commandId: `${contract.programId}:retain:${contract.actorId}`,
        actorId: contract.actorId,
        fromRegion: contract.fromRegion,
        toRegion: contract.toRegion,
      }, {
        kind: "stage-arrival",
        commandId: `${contract.programId}:stage:${contract.actorId}`,
        actorId: contract.actorId,
        fromRegion: contract.fromRegion,
        toRegion: contract.toRegion,
        eventType: "agent_entered_region",
        phase: "hold",
        momentId: contract.momentId,
        programId: contract.programId,
      }],
    };
  }
  return {
    identity,
    sceneToken: contract.sceneToken,
    commands: [{
      kind: "placement-hint",
      commandId: `${contract.programId}:placement:arrival:${contract.actorId}`,
      agentId: contract.actorId,
      context: { kind: "arrival", fromRegion: contract.fromRegion },
      arrivalGate: contract.gate,
      requestedFinal: contract.routeEnd,
    }, {
      kind: "actor",
      commandId: `${contract.programId}:actor:arrival:${contract.actorId}`,
      actorId: contract.actorId,
      command: {
        kind: "move",
        waypoints: [contract.gate, contract.routeEnd],
        speedPixelsPerSecond: 48,
        gait: "walk",
      },
    }],
  };
}

function fakeLease(
  id: string,
  bitmap: ImageBitmap = { label: id, width: 32, height: 32, close: vi.fn() } as unknown as ImageBitmap,
): ProductionAssetLease<ImageBitmap> {
  return { value: bitmap, release: vi.fn() };
}

function manifestLease(id: string): ProductionAssetLease<ImageBitmap> {
  const descriptor = PRODUCTION_ASSET_MANIFEST.atlases[id]!;
  return fakeLease(id, {
    width: descriptor.width,
    height: descriptor.height,
    close: vi.fn(),
  } as unknown as ImageBitmap);
}

function frame(options: Readonly<{
  runId?: string;
  sourceKey?: string;
  revision: number;
  firstCursor?: number;
  regionId: string;
  agents?: readonly AgentSnapshot[];
  homes?: readonly HomeSnapshot[];
  ruins?: readonly HomeSnapshot[];
  regions?: readonly RegionSnapshot[];
  sceneNull?: boolean;
}>): PresentedObserverFrame {
  const agents = options.agents ?? [];
  const homes = options.homes ?? [];
  return {
    runId: options.runId ?? "run-a",
    sourceKey: options.sourceKey ?? "live:run-a",
    revision: options.revision,
    firstCursor: options.firstCursor ?? options.revision,
    lastCursor: options.revision,
    source: options.sourceKey?.startsWith("archive") ? "archive" : "live",
    ingestedCursor: options.revision,
    presentedCursor: options.revision,
    world: {
      exactBaseCursor: options.revision,
      projectedThroughCursor: options.revision,
      worldTime: options.revision,
      agents: agents.map(exact),
      regions: (options.regions ?? REGIONS).map(exact),
      homes: homes.map(exact),
      ruins: (options.ruins ?? []).map(exact),
      pendingProposals: [],
    },
    scene: options.sceneNull ? null : {
      momentId: `moment-${options.revision}`,
      regionId: options.regionId,
      phase: "hold",
      focus: { kind: "system", regionId: options.regionId },
      dialogue: null,
      actorIntents: [],
      homeIntents: [],
      effectIntents: [],
      safeCancelMarkers: [],
      reducedMotion: false,
    },
    selection: null,
    backlog: {
      pendingMoments: 0,
      firstPendingCursor: null,
      lastPendingCursor: null,
      state: "caught-up",
      label: "Caught up",
    },
    transport: {
      connection: "live",
      ingestedCursor: options.revision,
      retryable: true,
    },
  };
}

function exact<T>(value: T): PresentedRecord<T> {
  return { completeness: "exact", value };
}

function agentSnapshot(id: string, position: string): AgentSnapshot {
  return {
    id,
    name: id,
    persona: "patient observer",
    position,
    energy: 50,
    materials: 10,
    status: "alive",
    last_mated_at: null,
    offspring_count: 0,
    died_at: null,
    home_id: null,
    is_hoarding: false,
  };
}

function homeSnapshot(homeId: string, ownerId: string, regionId: string): HomeSnapshot {
  return {
    home_id: homeId,
    owner_id: ownerId,
    region: regionId,
    integrity: 100,
    max_integrity: 100,
    built_at: 1,
    last_upkeep_at: 1,
    last_integrity_at: 1,
    stakeholders: [],
    vault_materials: 0,
    status: "standing",
    ruined_at: null,
    remnant_materials: 0,
    breachers: [],
    is_hoarding: false,
  };
}

function region(name: string, description: string, connections: readonly string[]): RegionSnapshot {
  return {
    name,
    description,
    connections: [...connections],
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

  request(callback: FrameRequestCallback): number {
    const handle = this.#next++;
    this.#callbacks.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    this.#callbacks.delete(handle);
  }

  now(): number {
    return this.#now;
  }

  fire(nowMs: number): void {
    this.#now = nowMs;
    const callbacks = [...this.#callbacks.values()];
    this.#callbacks.clear();
    callbacks.forEach((callback) => callback(nowMs));
  }

  pending(): number {
    return this.#callbacks.size;
  }
}

class FakeWakeScheduler implements WakeScheduler {
  #next = 1;
  readonly callbacks = new Map<number, () => void>();
  readonly scheduledAtMs: number[] = [];

  schedule(atMs: number, callback: () => void): number {
    const handle = this.#next++;
    this.scheduledAtMs.push(atMs);
    this.callbacks.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    this.callbacks.delete(handle);
  }

  now(): number {
    return 0;
  }

  pending(): number {
    return this.callbacks.size;
  }

  fireAll(): void {
    const callbacks = [...this.callbacks.values()];
    this.callbacks.clear();
    callbacks.forEach((callback) => callback());
  }
}

class FakeVisibilityTarget extends EventTarget {
  hidden = false;
  listenerCount = 0;

  override addEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: AddEventListenerOptions | boolean,
  ): void {
    if (type === "visibilitychange") this.listenerCount += 1;
    super.addEventListener(type, callback, options);
  }

  override removeEventListener(
    type: string,
    callback: EventListenerOrEventListenerObject | null,
    options?: EventListenerOptions | boolean,
  ): void {
    if (type === "visibilitychange") this.listenerCount -= 1;
    super.removeEventListener(type, callback, options);
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    this.dispatchEvent(new Event("visibilitychange"));
  }
}

class RecordingContext {
  imageSmoothingEnabled = true;
  globalAlpha = 1;
  fillStyle: string | CanvasGradient | CanvasPattern = "#000";
  strokeStyle: string | CanvasGradient | CanvasPattern = "#000";
  lineWidth = 1;
  filter = "none";
  transform = [1, 0, 0, 1, 0, 0];
  readonly drawImageCalls: unknown[][] = [];
  readonly drawImageTransforms: number[][] = [];
  readonly #stack: number[][] = [];

  save(): void { this.#stack.push([...this.transform]); }
  restore(): void { this.transform = this.#stack.pop() ?? [1, 0, 0, 1, 0, 0]; }
  clearRect(): void {}
  fillRect(): void {}
  strokeRect(): void {}
  beginPath(): void {}
  ellipse(): void {}
  stroke(): void {}
  setLineDash(): void {}
  translate(x: number, y: number): void {
    this.transform[4] = this.transform[4]! + x;
    this.transform[5] = this.transform[5]! + y;
  }
  scale(x: number, y: number): void {
    this.transform[0] = this.transform[0]! * x;
    this.transform[3] = this.transform[3]! * y;
  }
  setTransform(a: number, b: number, c: number, d: number, e: number, f: number): void {
    this.transform = [a, b, c, d, e, f];
  }
  drawImage(...args: unknown[]): void {
    this.drawImageCalls.push(args);
    this.drawImageTransforms.push([...this.transform]);
  }
  createPattern(source: CanvasImageSource, _repetition: string | null): CanvasPattern {
    return { source } as unknown as CanvasPattern;
  }
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
  readonly reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function settle(): Promise<void> {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
  for (let phase = 0; phase < 12; phase += 1) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
  }
  for (let index = 0; index < 4; index += 1) await Promise.resolve();
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function _assertRecipe(_recipe: RegionMapRecipeV1): void {}
