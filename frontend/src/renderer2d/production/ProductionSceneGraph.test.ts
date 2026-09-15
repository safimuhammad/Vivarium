import { describe, expect, it, vi } from "vitest";

import type { AgentSnapshot, HomeSnapshot, RegionSnapshot } from "../../app/schemas";
import type {
  ObserverSelection,
  PresentedObserverFrame,
  PresentedRecord,
  PresentedSceneView,
} from "../../presentation/contracts";
import { PresentedWorldModel } from "../../presentation/PresentedWorldModel";
import { CHRONICLE_CATALOG } from "../../presentation/fixtures/chronicleCatalog";
import type { Vec2 } from "../contracts";
import { tileCenter } from "../map/regionMap";
import {
  LayeredHumanActor,
  type HumanPrimitiveCommand,
  type LayeredHumanSnapshot,
  type ProductionActorSignal,
} from "./actors/LayeredHumanActor";
import { BEING_CHIBI_ATLAS_ID } from "./actors/beingChibiAtlas";
import {
  PRODUCTION_ASSET_MANIFEST,
  type ProductionAssetLease,
} from "./assets/productionManifest";
import type {
  EnvironmentDiagnostics,
  EnvironmentSystem,
} from "./environment/EnvironmentSystem";
import {
  HomeActor,
  type HomeActorSnapshot,
  type PresentedHomeInput,
  type ProductionHomeSignal,
} from "./homes/HomeActor";
import { createRegionMapIdentity, type RegionCondition } from "./maps/RegionMapIdentity";
import { createRegionMapRecipe } from "./maps/RegionMapRecipe";
import { PlacementLedger, type HomePlacementResult } from "./placement/PlacementLedger";
import {
  STANDING_HUMAN_VISUAL_ENVELOPE,
  feetAnchoredVisualRect,
  presentationPointIsClear,
  productionRectsOverlap,
} from "./productionGeometry";
import { createProductionSceneCommandResolver } from "./ProductionSceneCommandResolver";
import {
  createProductionSceneGraph,
  type ProductionActorFactoryInput,
  type ProductionEnvironmentFactoryInput,
  type ProductionHomeFactoryInput,
  type ProductionSceneGraph,
  type ProductionSceneFactories,
} from "./ProductionSceneGraph";
import * as productionSceneGraphModule from "./ProductionSceneGraph";
import { DEPTH_SCENERY_ATLAS_ID, withDepthSceneryManifest } from "./depth/DepthSceneryAssets";
import { createNirvanaRegionMapRecipe } from "./nirvana/NirvanaRegionMapRecipe";
import { navigationLayoutFingerprint } from "./navigation/SpatialNavigationExport";

interface ExpectedSceneTarget {
  readonly selection: Exclude<ObserverSelection, null>;
  readonly worldBounds: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly feetY: number;
  readonly selectionKey: string;
}

interface ExpectedSceneTargetQuery {
  hitTargets(): readonly ExpectedSceneTarget[];
  focusTarget(selection: Exclude<ObserverSelection, null>): ExpectedSceneTarget | null;
}

function expectBirthPlacementToBeNearbyAndReadable(acceptor: Vec2, child: Vec2): void {
  const deltaX = Math.abs(child.x - acceptor.x);
  const deltaY = Math.abs(child.y - acceptor.y);
  expect(deltaX >= STANDING_HUMAN_VISUAL_ENVELOPE.width + 4
    || deltaY >= STANDING_HUMAN_VISUAL_ENVELOPE.height + 4).toBe(true);
  expect(Math.hypot(deltaX, deltaY)).toBeLessThanOrEqual(76);
}

describe("ProductionSceneGraph", () => {
  it("omits region bodies, homes and bubbles while the Atlas owns their map representation", () => {
    const resident = agent("walker", "alpha");
    const harness = makeHarness({ checkpointAgents: [resident] });
    harness.graph.update(frame({ agents: [resident], homes: [home("cottage", "walker", "alpha")], regions: harness.regions }));
    const before = harness.graph.semanticSnapshot();
    const context = new Proxy({}, { get: () => () => undefined }) as unknown as CanvasRenderingContext2D;
    harness.graph.draw(context, { zoom: 1, originX: 0, originY: 0 });
    expect(harness.factories.drawTrace.length).toBeGreaterThan(0);
    harness.factories.drawTrace.length = 0;
    harness.graph.draw(context, { zoom: 0.1, originX: 0, originY: 0, regionContentVisible: false });
    expect(harness.factories.drawTrace).toEqual([]);
    expect(harness.graph.semanticSnapshot()).toEqual(before);
    harness.graph.draw(context, { zoom: 1, originX: 0, originY: 0 });
    expect(harness.factories.drawTrace.length).toBeGreaterThan(0);
    harness.graph.dispose();
  });

  it("projects bridge bodies, follow targets and bubble anchors without moving navigation feet", () => {
    const nirvana = region("nirvana", []);
    const resident = agent("walker", "nirvana");
    const recipe = createNirvanaRegionMapRecipe(createRegionMapIdentity(7, nirvana, [nirvana]));
    const factories = new FakeFactories();
    factories.actorPositionOverrides.set(resident.id, { x: 976, y: 304 });
    const placement = PlacementLedger.reconstruct([recipe], { agents: [resident], homes: [] });
    const graph = createProductionSceneGraph({
      manifest: PRODUCTION_ASSET_MANIFEST, factories, placement,
      recipes: new Map([[recipe.regionId, recipe]]), atlasLeases: new Map(),
    });
    graph.update(frame({ agents: [resident], regions: [nirvana], scene: scene("nirvana") }));
    const logical = { x: 976, y: 304 };
    const projected = { x: 976, y: 286 };
    const hit = graph.hitTargets().find((target) => target.selection.id === resident.id)!;
    expect(hit.worldBounds).toEqual(feetAnchoredVisualRect(projected));
    expect(hit.feetY).toBe(logical.y);
    expect(graph.focusTarget({ kind: "agent", id: resident.id })?.worldBounds).toEqual(hit.worldBounds);
    expect(factories.environments.get("nirvana")!.anchorPositions.at(-1)!.get(resident.id)).toEqual(projected);
    expect(graph.semanticSnapshot().subjects.find((subject) => subject.selection.id === resident.id)?.position).toEqual(logical);
    expect(factories.actors.get(resident.id)!.snapshot().position).toEqual(logical);
    const offsets: number[] = [];
    let translationY = 0;
    const stack: number[] = [];
    const context = new Proxy({
      globalAlpha: 1,
      save: () => { stack.push(translationY); },
      restore: () => { translationY = stack.pop()!; },
      translate: (_x: number, y: number) => { translationY += y; },
    }, { get: (target, key) => key in target ? Reflect.get(target, key) : () => undefined }) as unknown as CanvasRenderingContext2D;
    vi.spyOn(factories.actors.get(resident.id)!, "draw").mockImplementation(() => { offsets.push(translationY); });
    graph.draw(context, { zoom: 1, originX: 0, originY: 0 });
    graph.drawSeamActors!(context);
    expect(offsets).toEqual([-18, -18]);
    expect(translationY).toBe(0);
    graph.dispose();
  });

  it("samples bounded Nirvana route feet from playback time and refuses choreography relocation", () => {
    const nirvana = region("nirvana", []);
    const walker: AgentSnapshot = {
      ...agent("walker", "nirvana"),
      spatial: {
        version: 1,
        region_id: "nirvana",
        map_id: "nirvana:test-layout",
        layout_fingerprint: "test-layout",
        x: 20,
        y: 40,
        observed_at: 100,
        at_landmark: null,
        travel: {
          id: "journey-east",
          destination_id: "east-gate",
          route: [{ x: 20, y: 40 }, { x: 120, y: 40 }],
          started_at: 100,
          arrives_at: 120,
        },
      },
    };
    const harness = makeHarness({ checkpointAgents: [walker], regions: [nirvana] });
    const initial = frame({
      agents: [walker],
      regions: [nirvana],
      scene: scene("nirvana"),
      spatialPlayback: { sampledAt: 100, speed: 1, paused: false },
    });
    harness.graph.update(initial);
    expect(harness.factories.actorInputs[0]?.position).toEqual({ x: 20, y: 40 });

    // `worldTime` deliberately stays an unrelated checkpoint value; 5 seconds
    // of playback moves 25% of the 20-second recorded route.
    harness.graph.updateTime(0, 5_000);
    expect(harness.factories.actors.get("walker")?.position).toEqual({ x: 45, y: 40 });
    expect(harness.placement.snapshot().agents.get("walker")?.point).toEqual({ x: 45, y: 40 });

    harness.graph.update({ ...initial, spatialPlayback: { sampledAt: 105, speed: 1, paused: true } });
    harness.graph.updateTime(3, 8_000);
    expect(harness.factories.actors.get("walker")?.position).toEqual({ x: 45, y: 40 });

    const command = harness.graph.applySceneCommands({
      identity: identityOf(initial),
      sceneToken: 1,
      commands: [{
        kind: "actor",
        commandId: "fake-walk",
        actorId: "walker",
        command: { kind: "move", waypoints: [{ x: 300, y: 40 }], speedPixelsPerSecond: 48, gait: "walk" },
      }],
    }, 8_000);
    expect(command.rejections).toEqual([expect.objectContaining({
      reason: "authoritative-spatial-motion",
    })]);
    expect(harness.factories.actors.get("walker")?.position).toEqual({ x: 45, y: 40 });

    harness.factories.drawTrace.length = 0;
    harness.graph.drawSeamActors!({} as CanvasRenderingContext2D);
    expect(harness.factories.drawTrace).toEqual([]);
  });

  it("clears old route sampling across a legacy transfer and accepts a re-entry and birth before checkpoint", () => {
    const nirvana = region("nirvana", []);
    const warmSprings = region("warm_springs", []);
    const traveler: AgentSnapshot = {
      ...agent("walker", "nirvana"),
      spatial: {
        version: 1,
        region_id: "nirvana",
        map_id: "nirvana:test-layout",
        layout_fingerprint: "test-layout",
        x: 20,
        y: 40,
        observed_at: 100,
        at_landmark: null,
        travel: {
          id: "journey-east",
          destination_id: "east-gate",
          route: [{ x: 20, y: 40 }, { x: 120, y: 40 }],
          started_at: 100,
          arrives_at: 120,
        },
      },
    };
    const harness = makeHarness({ checkpointAgents: [traveler], regions: [nirvana, warmSprings] });
    harness.graph.update(frame({
      agents: [traveler], regions: [nirvana, warmSprings], scene: scene("nirvana"),
      spatialPlayback: { sampledAt: 100, speed: 1, paused: false },
    }));
    harness.graph.updateTime(0, 5_000);
    expect(harness.factories.actors.get("walker")?.position).toEqual({ x: 45, y: 40 });

    const exited = { ...traveler, position: "warm_springs", spatial: undefined };
    harness.graph.update(frame({
      revision: 2,
      lastCursor: 2,
      agents: [exited],
      regions: [nirvana, warmSprings],
      scene: scene("warm_springs"),
      spatialPlayback: { sampledAt: 110, speed: 1, paused: false },
    }));
    harness.graph.updateTime(0, 10_000);
    expect(harness.factories.actors.get("walker")?.position).toEqual({ x: 45, y: 40 });

    const reentered: AgentSnapshot = {
      ...exited,
      position: "nirvana",
      spatial: {
        version: 1,
        region_id: "nirvana",
        map_id: "nirvana:test-layout",
        layout_fingerprint: "test-layout",
        x: 84,
        y: 40,
        observed_at: 200,
        at_landmark: null,
        travel: null,
      },
    };
    harness.graph.update(frame({
      revision: 3,
      lastCursor: 3,
      agents: [reentered],
      regions: [nirvana, warmSprings],
      scene: scene("nirvana"),
      spatialPlayback: { sampledAt: 200, speed: 1, paused: false },
    }));
    harness.graph.updateTime(0, 15_000);
    expect(harness.factories.actors.get("walker")?.position).toEqual({ x: 84, y: 40 });
    expect(harness.placement.snapshot().agents.get("walker")?.point).toEqual({ x: 84, y: 40 });

    const newborn: AgentSnapshot = {
      ...agent("newborn", "nirvana"),
      spatial: {
        version: 1,
        region_id: "nirvana",
        map_id: "nirvana:test-layout",
        layout_fingerprint: "test-layout",
        x: 96,
        y: 48,
        observed_at: 201,
        at_landmark: null,
        travel: null,
      },
    };
    harness.graph.update(frame({
      revision: 4,
      lastCursor: 4,
      agents: [reentered, newborn],
      regions: [nirvana, warmSprings],
      scene: scene("nirvana"),
      spatialPlayback: { sampledAt: 201, speed: 1, paused: false },
    }));
    expect(harness.factories.actorInputs.find(({ record }) => record.value.id === "newborn")?.position)
      .toEqual({ x: 96, y: 48 });
    expect(harness.placement.snapshot().agents.get("newborn")?.point).toEqual({ x: 96, y: 48 });
  });

  it("keeps an authoritative cross-region departure at its supplied gate and rejects legacy transit", () => {
    const nirvana = region("nirvana", []);
    const warmSprings = region("warm_springs", []);
    const traveler: AgentSnapshot = {
      ...agent("walker", "nirvana"),
      spatial: {
        version: 1,
        region_id: "nirvana",
        map_id: "nirvana:pilot-layout",
        layout_fingerprint: "pilot-layout",
        x: 20,
        y: 40,
        observed_at: 10,
        at_landmark: null,
        travel: null,
      },
    };
    const harness = makeHarness({ checkpointAgents: [traveler], regions: [nirvana, warmSprings] });
    const source = frame({
      agents: [traveler],
      regions: [nirvana, warmSprings],
      scene: scene("nirvana"),
      spatialPlayback: { sampledAt: 10, speed: 1, paused: true },
    });
    harness.graph.update(source);
    const actor = harness.factories.actors.get("walker")!;

    const departed: AgentSnapshot = {
      ...traveler,
      spatial: undefined,
      spatial_migration: {
        from_region: "nirvana",
        to_region: "warm_springs",
        source_position: { x: 120, y: 40 },
      },
    };
    const departure = frame({
      revision: 2,
      lastCursor: 2,
      agents: [departed],
      regions: [nirvana, warmSprings],
      scene: scene("nirvana"),
      spatialPlayback: { sampledAt: 20, speed: 1, paused: true },
    });
    harness.graph.update(departure);

    expect(harness.factories.actors.get("walker")).toBe(actor);
    expect(actor.position).toEqual({ x: 120, y: 40 });
    expect(harness.placement.snapshot().agents.get("walker")?.point).toEqual({ x: 120, y: 40 });
    const rejected = harness.graph.applySceneCommands({
      identity: identityOf(departure),
      sceneToken: 2,
      commands: [
        {
          kind: "retain-traveler",
          commandId: "invented-transit",
          actorId: "walker",
          fromRegion: "nirvana",
          toRegion: "warm_springs",
        },
        {
          kind: "actor",
          commandId: "invented-path",
          actorId: "walker",
          command: { kind: "reposition", position: { x: 400, y: 40 }, reason: "fallback" },
        },
      ],
    }, 20);
    expect(rejected.rejections.map(({ reason }) => reason)).toEqual([
      "authoritative-spatial-motion",
      "authoritative-spatial-motion",
    ]);
    expect(actor.position).toEqual({ x: 120, y: 40 });

    const entered: AgentSnapshot = {
      ...departed,
      position: "warm_springs",
      spatial_migration: undefined,
      spatial: {
        version: 1,
        region_id: "warm_springs",
        map_id: "warm_springs:pilot-layout",
        layout_fingerprint: "pilot-layout",
        x: 32,
        y: 96,
        observed_at: 30,
        at_landmark: null,
        travel: null,
      },
    };
    const arrival = frame({
      revision: 3,
      lastCursor: 3,
      agents: [entered],
      regions: [nirvana, warmSprings],
      scene: scene("warm_springs"),
      spatialPlayback: { sampledAt: 30, speed: 1, paused: true },
    });
    harness.graph.update(arrival);
    harness.graph.updateTime(0, 30);

    expect(harness.factories.actors.get("walker")).toBe(actor);
    expect(actor.position).toEqual({ x: 32, y: 96 });
    expect(harness.placement.snapshot().agents.get("walker")?.point).toEqual({ x: 32, y: 96 });
  });

  it("places an enriched Nirvana home on its backend-owned plot before its checkpoint", () => {
    const nirvana = region("nirvana", []);
    const recipe = createNirvanaRegionMapRecipe(createRegionMapIdentity(7, nirvana, [nirvana]));
    const plot = recipe.shelterPlots[0]!;
    const origin = tileCenter(plot.tile);
    const door = tileCenter(plot.door);
    const factories = new FakeFactories();
    const placement = PlacementLedger.reconstruct([recipe], { agents: [], homes: [] });
    const graph = createProductionSceneGraph({
      manifest: PRODUCTION_ASSET_MANIFEST,
      factories,
      placement,
      recipes: new Map([[recipe.regionId, recipe]]),
      atlasLeases: new Map(),
    });
    graph.update(frame({
      agents: [],
      regions: [nirvana],
      homeRecords: [projected<HomeSnapshot>({
        home_id: "home-before-checkpoint",
        owner_id: "walker",
        region: "nirvana",
        integrity: 120,
        stakeholders: ["walker"],
        status: "standing",
        spatial: {
          version: 1,
          region_id: "nirvana",
          map_id: `nirvana:${navigationLayoutFingerprint(recipe)}`,
          plot_id: plot.id,
          x: origin.x,
          y: origin.y,
          door,
        },
      })],
      scene: scene("nirvana"),
    }));

    expect(factories.homeInputs).toHaveLength(1);
    expect(factories.homeInputs[0]?.presented).toMatchObject({ plot: origin, door });
    expect(placement.snapshot().homes.get("home-before-checkpoint"))
      .toMatchObject({ plotId: plot.id, origin, door });
  });

  it.each([false, true])("bounds canopy wakeups to visible region detail (reduced motion: %s)", (reducedMotion) => {
    const nirvana = region("nirvana", []);
    const recipe = createNirvanaRegionMapRecipe(createRegionMapIdentity(7, nirvana, [nirvana]));
    const source = {} as ImageBitmap;
    const factories = new FakeFactories();
    const graph = createProductionSceneGraph({
      manifest: withDepthSceneryManifest(PRODUCTION_ASSET_MANIFEST),
      factories,
      placement: PlacementLedger.reconstruct([recipe], { agents: [], homes: [] }),
      recipes: new Map([[recipe.regionId, recipe]]),
      atlasLeases: new Map([[DEPTH_SCENERY_ATLAS_ID, { value: source, release: vi.fn() }]]),
      reducedMotion,
    });
    graph.update(frame({ agents: [], regions: [nirvana], scene: scene("nirvana") }));
    const context = {
      save: vi.fn(), restore: vi.fn(), drawImage: vi.fn(), beginPath: vi.fn(),
      ellipse: vi.fn(), fill: vi.fn(), translate: vi.fn(), rotate: vi.fn(), globalAlpha: 1,
      fillRect: vi.fn(), closePath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    graph.draw(context, { zoom: 1, originX: 0, originY: 0 });
    expect(context.drawImage).toHaveBeenCalled();
    expect(graph.nextDeadlineMs()).toBe(reducedMotion ? null : 125);
    expect(vi.mocked(context.rotate).mock.calls.length > 0).toBe(!reducedMotion);
    graph.updateTime(0.13, 130);
    expect(graph.nextDeadlineMs()).toBe(reducedMotion ? null : 250);
    // A wrapped copy with no visible trees must retain an earlier copy's wake.
    graph.draw(context, { zoom: 1, originX: -100000, originY: -100000, width: 100, height: 100 },
      { continueFrame: true });
    expect(graph.nextDeadlineMs()).toBe(reducedMotion ? null : 250);
    vi.mocked(context.drawImage).mockClear();
    vi.mocked(context.ellipse).mockClear();
    factories.drawTrace.length = 0;
    graph.draw(context, { zoom: 0.1, originX: 0, originY: 0, depthSceneryVisible: false });
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(context.ellipse).not.toHaveBeenCalled();
    expect(graph.nextDeadlineMs()).toBeNull();
    expect(factories.drawTrace).toHaveLength(2);
    graph.draw(context, { zoom: 1, originX: -100000, originY: -100000, width: 100, height: 100 });
    expect(context.drawImage).not.toHaveBeenCalled();
    expect(graph.nextDeadlineMs()).toBeNull();
    graph.dispose();
    expect(graph.nextDeadlineMs()).toBeNull();
  });

  it("publishes immutable spatial-binding diagnostics owned at Graph construction", () => {
    const harness = makeHarness({
      spatialBinding: { placementRebound: true, recipesRebound: false },
    });

    const binding = harness.graph.debugSnapshot().spatialBinding;
    expect(binding).toEqual({ placementRebound: true, recipesRebound: false });
    expect(Object.isFrozen(binding)).toBe(true);
  });

  it("publishes the selected ledger's full sorted immutable placement snapshot", () => {
    const agents = [agent("zeta", "alpha"), agent("alpha", "beta")];
    const homes = [home("zeta-home", "zeta", "alpha"), home("alpha-home", "alpha", "beta")];
    const harness = makeHarness({ checkpointAgents: agents, checkpointHomes: homes });
    const ledger = harness.placement.snapshot();

    const placement = harness.graph.debugSnapshot().placement;
    expect(placement.revision).toBe(ledger.revision);
    expect(placement.agents.map(({ id }) => id)).toEqual(["alpha", "zeta"]);
    expect(placement.homes.map(({ id }) => id)).toEqual(["alpha-home", "zeta-home"]);
    expect(placement.agents).toEqual([...ledger.agents]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, value]) => ({ id, ...value })));
    expect(placement.homes).toEqual([...ledger.homes]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([id, value]) => ({ id, ...value })));
    expect(Object.isFrozen(placement)).toBe(true);
    expect(Object.isFrozen(placement.agents)).toBe(true);
    expect(Object.isFrozen(placement.agents[0]!.point)).toBe(true);
    expect(Object.isFrozen(placement.homes[0]!.door)).toBe(true);
  });

  it("fills a region's 128 shelter plots, then survives and diagnoses a 129th home with no throw and no actor", () => {
    const packedHomes = Array.from({ length: 128 }, (_, index) =>
      home(`packed-${index.toString().padStart(3, "0")}`, `owner-${index}`, "alpha"));
    const overflow = home("overflow-home", "overflow-owner", "alpha");

    let harness!: ReturnType<typeof makeHarness>;
    expect(() => {
      harness = makeHarness({ checkpointHomes: packedHomes });
    }).not.toThrow();

    let diff!: ReturnType<ReturnType<typeof makeHarness>["graph"]["update"]>;
    expect(() => {
      diff = harness.graph.update(frame({
        homes: [...packedHomes, overflow],
        regions: harness.regions,
      }));
    }).not.toThrow();
    expect(diff).toEqual(expect.objectContaining({ outcome: "applied" }));

    // Every packed home got an actor; the overflow home did not -- there is
    // no legal plot to draw it at, and it is not silently swallowed either.
    expect(harness.factories.homeInputs).toHaveLength(128);
    expect(harness.factories.homeInputs.some((input) => input.id === "overflow-home")).toBe(false);
    const snapshot = harness.graph.debugSnapshot();
    expect(snapshot.homes).toHaveLength(128);
    expect(snapshot.homes.some((entry) => entry.id === "overflow-home")).toBe(false);

    // The fact and its cause are diagnosable at the existing debug surface.
    expect(snapshot.placement.shelterCapacity).toContainEqual({
      regionId: "alpha", total: 128, occupied: 128, free: 0, atCapacity: true,
    });
    expect(snapshot.placement.unplacedHomes).toContainEqual({
      homeId: "overflow-home", regionId: "alpha", reason: "region-at-capacity",
    });
  });

  it("RED: rolls back the entire update when existing-actor reconciliation throws", () => {
    const resident = agent("resident", "alpha");
    const newcomer = agent("newcomer", "alpha");
    const harness = makeHarness({ checkpointAgents: [resident] });
    const initial = frame({ agents: [resident], regions: harness.regions });
    harness.graph.update(initial);
    const residentActor = harness.factories.actors.get(resident.id)!;
    const placementBefore = harness.placement.snapshot();
    const graphBefore = harness.graph.debugSnapshot();
    residentActor.throwOnNextApply = true;
    const next = frame({
      revision: 2,
      lastCursor: 2,
      agents: [{ ...resident, status: "dead" }, newcomer],
      regions: harness.regions,
    });

    expect(() => harness.graph.applyFrame!(next, null, 100)).toThrow(/actor command resident/);
    expect(harness.placement.snapshot()).toEqual(placementBefore);
    expect(harness.graph.debugSnapshot()).toEqual(graphBefore);
    expect(harness.factories.actors.get(newcomer.id)?.disposeCalls).toBe(1);

    expect(harness.graph.applyFrame!(next, null, 100)).toMatchObject({
      outcome: "accepted",
      diff: { outcome: "applied" },
    });
    expect(harness.graph.debugSnapshot()).toMatchObject({
      identity: { revision: 2 },
      actors: expect.arrayContaining([
        expect.objectContaining({ id: resident.id, terminal: true }),
        expect.objectContaining({ id: newcomer.id }),
      ]),
      ownership: {
        actors: { created: 2, disposed: 0, outstanding: 2, peak: 2 },
      },
    });
    expect(harness.placement.snapshot().agents.has(newcomer.id)).toBe(true);
  });

  it("RED: cannot reject or throw a scene command after the real frame update commits", () => {
    const resident = agent("resident", "alpha");
    const newcomer = agent("newcomer", "alpha");
    const harness = makeHarness({ checkpointAgents: [resident] });
    const initial = frame({ agents: [resident], regions: harness.regions });
    harness.graph.update(initial);
    const residentActor = harness.factories.actors.get(resident.id)!;
    residentActor.throwOnNextApply = true;
    const next = frame({
      revision: 2,
      lastCursor: 2,
      agents: [resident, newcomer],
      regions: harness.regions,
    });
    const batch = {
      identity: identityOf(next),
      sceneToken: 90,
      commands: [{
        kind: "actor",
        commandId: "actor:post-update-fault",
        actorId: resident.id,
        command: { kind: "set-face", expression: "talk-1" },
      }],
    } as const;

    let result: ReturnType<NonNullable<ProductionSceneGraph["applyFrame"]>> | null = null;
    expect(() => {
      result = harness.graph.applyFrame!(next, batch, 100);
    }).not.toThrow();
    expect(result).toMatchObject({
      outcome: "accepted",
      diff: { outcome: "applied" },
    });
    expect(harness.graph.debugSnapshot()).toMatchObject({
      identity: { revision: 2 },
      actors: expect.arrayContaining([
        expect.objectContaining({ id: resident.id }),
        expect.objectContaining({ id: newcomer.id }),
      ]),
    });
    expect(harness.placement.snapshot().agents.has(newcomer.id)).toBe(true);
  });

  it("creates one transient same-ID home and adopts durable consequence truth in place", () => {
    const durable = home("new-home", "owner", "alpha");
    const harness = makeHarness();
    const accepted = frame({ regions: harness.regions });
    harness.graph.update(accepted);
    const candidate = harness.placement.fork();
    const allocated = candidate.placeHome(durable);
    const recipe = harness.recipes.get("alpha")!;
    const plot = recipe.shelterPlots.find(({ id }) => id === placedPlotId(allocated))!;
    const batch = {
      identity: identityOf(accepted),
      sceneToken: 70,
      commands: [{
        kind: "create-provisional-home",
        commandId: "build:new-home",
        homeId: durable.home_id,
        regionId: durable.region,
        plotId: plot.id,
        plot: tileCenter(plot.tile),
        door: tileCenter(plot.door),
        kit: recipe.kit,
      }],
    };

    expect(harness.graph.applySceneCommands(batch as never, 100).outcome).toBe("applied");
    const provisional = harness.graph.debugSnapshot().homes[0] as unknown as {
      id: string;
      instanceId: number;
      provisional?: boolean;
    };
    expect(provisional).toMatchObject({ id: "new-home", provisional: true });
    expect(accepted.world.homes).toEqual([]);
    expect(harness.factories.homeInputs).toHaveLength(1);
    const provisionalActor = harness.factories.homes.get("new-home")!;
    expect(provisionalActor.commands).toEqual([]);
    const buildBatch = {
      identity: identityOf(accepted),
      sceneToken: 70,
      commands: [{
        kind: "home",
        commandId: "build:new-home:work-contact",
        homeId: "new-home",
        command: { kind: "build", durationMs: 900 },
      }],
    };
    expect(harness.graph.applySceneCommands(buildBatch as never, 200).outcome).toBe("applied");
    expect(harness.graph.applySceneCommands(buildBatch as never, 250).outcome).toBe("duplicate");
    expect(provisionalActor.commands).toEqual([{ kind: "build", durationMs: 900 }]);

    harness.graph.update(frame({
      revision: 2,
      lastCursor: 2,
      homes: [durable],
      regions: harness.regions,
    }));
    expect(harness.graph.debugSnapshot().homes).toContainEqual(expect.objectContaining({
      id: "new-home",
      instanceId: provisional.instanceId,
      provisional: false,
      status: "standing",
    }));
    expect(harness.factories.homeInputs).toHaveLength(1);
  });

  it("adopts the real projected-partial home_built consequence before settled clear or a new scene", () => {
    const manifest = CHRONICLE_CATALOG.C06;
    const snapshot = manifest.initialSnapshot;
    const build = manifest.entries.find(({ event }) => event.type === "home_built")!;
    const payload = build.event.payload as Readonly<{
      home_id: string;
      owner_id: string;
      region: string;
    }>;
    const model = new PresentedWorldModel(snapshot, {
      runId: manifest.runId,
      sourceKey: `fixture:${manifest.runId}`,
      revision: 1,
      firstCursor: snapshot.event_cursor,
      lastCursor: snapshot.event_cursor,
    });
    const harness = makeHarness({
      checkpointAgents: snapshot.agents,
      checkpointHomes: [...snapshot.homes, ...snapshot.ruins],
      regions: snapshot.regions,
    });
    const initialView = model.getView();
    const accepted = frame({
      runId: manifest.runId,
      sourceKey: `fixture:${manifest.runId}`,
      firstCursor: snapshot.event_cursor,
      lastCursor: snapshot.event_cursor,
      agentRecords: initialView.agents,
      regionRecords: initialView.regions,
      homeRecords: initialView.homes,
      ruinRecords: initialView.ruins,
      scene: scene(payload.region),
    });
    harness.graph.update(accepted);
    const candidate = harness.placement.fork();
    const allocated = candidate.placeHome(home(payload.home_id, payload.owner_id, payload.region));
    const recipe = harness.recipes.get(payload.region)!;
    const plot = recipe.shelterPlots.find(({ id }) => id === placedPlotId(allocated))!;
    harness.graph.applySceneCommands({
      identity: identityOf(accepted),
      sceneToken: 72,
      commands: [{
        kind: "create-provisional-home",
        commandId: `build:${payload.home_id}`,
        homeId: payload.home_id,
        regionId: payload.region,
        plotId: plot.id,
        plot: tileCenter(plot.tile),
        door: tileCenter(plot.door),
        kit: recipe.kit,
      }],
    }, 100);
    const provisional = harness.graph.debugSnapshot().homes[0]!;
    const actor = harness.factories.homes.get(payload.home_id)!;

    model.applyEvidence([build]);
    const consequenceView = model.getView();
    expect(consequenceView.homes).toContainEqual(expect.objectContaining({
      completeness: "projected-partial",
      value: expect.objectContaining({ home_id: payload.home_id, status: "standing" }),
    }));
    const consequence = frame({
      runId: manifest.runId,
      sourceKey: `fixture:${manifest.runId}`,
      revision: 2,
      firstCursor: build.cursor,
      lastCursor: build.cursor,
      agentRecords: consequenceView.agents,
      regionRecords: consequenceView.regions,
      homeRecords: consequenceView.homes,
      ruinRecords: consequenceView.ruins,
      scene: scene(payload.region),
    });
    harness.graph.update(consequence);
    expect(harness.graph.debugSnapshot().homes).toContainEqual(expect.objectContaining({
      id: payload.home_id,
      instanceId: provisional.instanceId,
      provisional: false,
      status: "standing",
    }));

    expect(harness.graph.applySceneCommands({
      identity: identityOf(consequence),
      sceneToken: 72,
      commands: [{ kind: "clear-scene", commandId: `settled:${payload.home_id}` }],
    }, 1_100).outcome).toBe("applied");
    expect(harness.graph.applySceneCommands({
      identity: identityOf(consequence),
      sceneToken: 73,
      commands: [{ kind: "clear-scene", commandId: `new-scene:${payload.home_id}` }],
    }, 1_200).outcome).toBe("applied");
    expect(harness.graph.debugSnapshot().homes).toContainEqual(expect.objectContaining({
      id: payload.home_id,
      instanceId: provisional.instanceId,
      provisional: false,
    }));
    expect(actor.disposeCalls).toBe(0);
    expect(harness.factories.homeInputs).toHaveLength(1);
  });

  it("keeps scavenged ruin materials projected until an exact-base checkpoint advances", () => {
    const manifest = CHRONICLE_CATALOG.C09;
    const checkpointAtTwo = manifest.checkpoints[0]!;
    const model = new PresentedWorldModel(manifest.initialSnapshot, {
      runId: manifest.runId,
      sourceKey: `fixture:${manifest.runId}`,
      revision: 1,
      firstCursor: manifest.initialSnapshot.event_cursor,
      lastCursor: manifest.initialSnapshot.event_cursor,
    });
    model.applyEvidence(manifest.entries.filter(({ cursor }) => cursor <= 2));
    expect(model.reconcile(checkpointAtTwo).applied).toBe(true);
    const exactView = model.getView();
    const factories = new RealHomeFactories();
    const harness = makeHarness({
      checkpointAgents: checkpointAtTwo.checkpoint.snapshot.agents,
      checkpointHomes: [
        ...checkpointAtTwo.checkpoint.snapshot.homes,
        ...checkpointAtTwo.checkpoint.snapshot.ruins,
      ],
      regions: checkpointAtTwo.checkpoint.snapshot.regions,
      factories,
      atlasLeases: allAtlasLeases(),
    });
    const initial = frame({
      runId: manifest.runId,
      sourceKey: `fixture:${manifest.runId}`,
      revision: 1,
      firstCursor: 0,
      lastCursor: 2,
      exactBaseCursor: exactView.exactBaseCursor,
      projectedThroughCursor: exactView.projectedThroughCursor,
      exactHomes: exactView.exactHomes,
      exactRuins: exactView.exactRuins,
      agentRecords: exactView.agents,
      regionRecords: exactView.regions,
      homeRecords: exactView.homes,
      ruinRecords: exactView.ruins,
      scene: scene("nirvana"),
    });
    expect(harness.graph.applyFrame!(initial, null, 0).outcome).toBe("accepted");
    expect(factories.realHomes.get("home_zero")!.snapshot().durable.remnantMaterials).toBe(40);

    model.applyEvidence(manifest.entries.filter(({ cursor }) => cursor >= 3 && cursor <= 6));
    const projectedView = model.getView();
    const projected = frame({
      runId: manifest.runId,
      sourceKey: `fixture:${manifest.runId}`,
      revision: 2,
      firstCursor: 0,
      lastCursor: 6,
      exactBaseCursor: projectedView.exactBaseCursor,
      projectedThroughCursor: projectedView.projectedThroughCursor,
      exactHomes: projectedView.exactHomes,
      exactRuins: projectedView.exactRuins,
      agentRecords: projectedView.agents,
      regionRecords: projectedView.regions,
      homeRecords: projectedView.homes,
      ruinRecords: projectedView.ruins,
      scene: scene("nirvana"),
    });
    const scavengeBatch = {
      identity: identityOf(projected),
      sceneToken: 90,
      commands: [{
        kind: "home",
        commandId: "scavenge:home-zero",
        homeId: "home_zero",
        command: { kind: "scavenge", durationMs: 100, remnantMaterialsAfter: 0 },
      }],
    } as const;
    expect(harness.graph.applyFrame!(projected, scavengeBatch, 10).outcome).toBe("accepted");
    const projectedRuin = factories.realHomes.get("home_zero")!;
    expect(projectedRuin.snapshot().durable.remnantMaterials).toBe(40);
    expect(projectedRuin.snapshot().visual.ruinFrameId).toBe("rubble-bare-scavenge");
    harness.graph.updateTime(0.1, 110);
    expect(projectedRuin.snapshot().visual.ruinFrameId).toBe("rubble-bare");

    const base = checkpointAtTwo.checkpoint.snapshot;
    const exactSnapshot = {
      ...base,
      event_cursor: 6,
      world_time: base.world_time + 120,
      ruins: base.ruins.map((ruin) => ruin.home_id === "home_zero"
        ? { ...ruin, remnant_materials: 0 }
        : ruin),
    };
    expect(model.reconcile({
      line: 99,
      safety: "safe-world-tick",
      checkpoint: {
        ...checkpointAtTwo.checkpoint,
        event_cursor: 6,
        world_time: exactSnapshot.world_time,
        snapshot: exactSnapshot,
      },
    }).applied).toBe(true);
    const reconciledView = model.getView();
    const reconciled = frame({
      runId: manifest.runId,
      sourceKey: `fixture:${manifest.runId}`,
      revision: 3,
      firstCursor: 0,
      lastCursor: 6,
      exactBaseCursor: reconciledView.exactBaseCursor,
      projectedThroughCursor: reconciledView.projectedThroughCursor,
      exactHomes: reconciledView.exactHomes,
      exactRuins: reconciledView.exactRuins,
      agentRecords: reconciledView.agents,
      regionRecords: reconciledView.regions,
      homeRecords: reconciledView.homes,
      ruinRecords: reconciledView.ruins,
      scene: scene("nirvana"),
    });
    expect(harness.graph.applyFrame!(reconciled, null, 120).outcome).toBe("accepted");
    expect(projectedRuin.snapshot().durable.remnantMaterials).toBe(0);
    expect(projectedRuin.snapshot().visual.ruinFrameId).toBe("rubble-bare");
  });

  it("disposes a pre-consequence provisional home and its four leases on clear-scene", () => {
    const durable = home("cancel-home", "owner", "alpha");
    const factories = new RealHomeFactories();
    const harness = makeHarness({ factories, atlasLeases: allAtlasLeases() });
    const accepted = frame({ regions: harness.regions });
    harness.graph.update(accepted);
    const candidate = harness.placement.fork();
    const allocated = candidate.placeHome(durable);
    const recipe = harness.recipes.get("alpha")!;
    const plot = recipe.shelterPlots.find(({ id }) => id === placedPlotId(allocated))!;

    harness.graph.applySceneCommands({
      identity: identityOf(accepted),
      sceneToken: 71,
      commands: [{
        kind: "create-provisional-home",
        commandId: "build:cancel-home",
        homeId: durable.home_id,
        regionId: durable.region,
        plotId: plot.id,
        plot: tileCenter(plot.tile),
        door: tileCenter(plot.door),
        kit: recipe.kit,
      }],
    } as never, 100);
    const acquired = factories.homeInputs[0]!.atlasLeases;
    const homeManifest = PRODUCTION_ASSET_MANIFEST.regions[recipe.kit].homeManifest;
    expect([...acquired.keys()]).toEqual([
      homeManifest.atlasId,
      homeManifest.detailAtlasId,
      homeManifest.ruinAtlasId,
      homeManifest.yard.atlasId,
    ]);

    expect(harness.graph.applySceneCommands({
      identity: identityOf(accepted),
      sceneToken: 71,
      commands: [{ kind: "clear-scene", commandId: "clear:cancel-home" }],
    }, 200).outcome).toBe("applied");
    expect(harness.graph.debugSnapshot().homes).toEqual([]);
    expect([...acquired.values()].every(({ release }) =>
      vi.mocked(release).mock.calls.length === 1)).toBe(true);
    expect(accepted.world.homes).toEqual([]);
    expect(harness.placement.snapshot().homes.has("cancel-home")).toBe(false);
  });

  it("defers a provisional home whose regional atlases are not mounted instead of failing the frame", () => {
    // `prepareProvisionalHomeCommands` runs inside `applyFrame`, ahead of the
    // command application that checks the active environment -- so it will
    // happily try to build a `home-raise` for a region whose atlas pack is not
    // mounted. Before this guard the constructor threw straight out of
    // `applyFrame`, which the renderer catches as a whole-frame commit failure:
    // the observed live wedge, where the scene graph stopped at the cursor of
    // the first shelter raised in a second region and never advanced again.
    const factories = new RealHomeFactories();
    const harness = makeHarness({ factories, atlasLeases: coreAtlasLeases() });
    const accepted = frame({ regions: harness.regions });
    harness.graph.update(accepted);
    const candidate = harness.placement.fork();
    const allocated = candidate.placeHome(home("far-home", "owner", "alpha"));
    const recipe = harness.recipes.get("alpha")!;
    const plot = recipe.shelterPlots.find(({ id }) => id === placedPlotId(allocated))!;
    const next = frame({ revision: 2, lastCursor: 2, regions: harness.regions });
    const batch = {
      identity: identityOf(next),
      sceneToken: 71,
      commands: [{
        kind: "create-provisional-home",
        commandId: "build:far-home",
        homeId: "far-home",
        regionId: "alpha",
        plotId: plot.id,
        plot: tileCenter(plot.tile),
        door: tileCenter(plot.door),
        kit: recipe.kit,
      }],
    } as never;

    const receipt = harness.graph.applyFrame!(next, batch, 100, null, false);

    expect(receipt.outcome).toBe("accepted");
    expect(harness.graph.debugSnapshot().homes).toEqual([]);
    // Two deferrals, both real and both wanted: the pre-pass skips the
    // preparation, then the applied path -- which the active environment does let
    // through, since the region matches -- also fails to build and refuses the
    // command by name. Neither one throws, which is the whole point.
    expect(harness.graph.debugSnapshot().rejections.deferredHomes).toBe(2);
    expect(harness.graph.debugSnapshot().lastDeferredHomeReason)
      .toMatch(/home far-home deferred: .*four regional atlas leases/);
  });

  it("applies lineage-bound scene commands once and emits typed native diagnostics", () => {
    const aster = agent("aster", "alpha");
    const hearth = home("hearth", "aster", "alpha");
    const harness = makeHarness({ checkpointAgents: [aster], checkpointHomes: [hearth] });
    const accepted = frame({ agents: [aster], homes: [hearth], regions: harness.regions });
    harness.graph.update(accepted);
    const bridge = harness.graph as ProductionSceneGraph & {
      applySceneCommands(batch: unknown, nowMs: number): Readonly<{
        outcome: string;
        appliedCommandIds: readonly string[];
        ignoredCommandIds: readonly string[];
      }>;
      sceneSignals(afterSerial?: number): readonly Readonly<{
        serial: number;
        sceneToken: number;
        commandId: string;
        subjectId: string | null;
        marker: string;
      }>[];
    };
    const batch = {
      identity: {
        runId: accepted.runId,
        sourceKey: accepted.sourceKey,
        revision: accepted.revision,
        firstCursor: accepted.firstCursor,
        lastCursor: accepted.lastCursor,
      },
      sceneToken: 7,
      commands: [
        { kind: "actor", commandId: "talk", actorId: "aster", command: { kind: "set-face", expression: "talk-1" } },
        { kind: "home", commandId: "open", homeId: "hearth", command: { kind: "door", state: "open" } },
        { kind: "environment", commandId: "smoke", request: { kind: "smoke", at: { x: 16, y: 16 }, tint: "#fff" } },
      ],
    };

    expect(bridge.applySceneCommands(batch, 10)).toEqual({
      outcome: "applied",
      appliedCommandIds: ["talk", "open", "smoke"],
      ignoredCommandIds: [],
      rejections: [],
    });
    // Every refusal names itself: `ignoredCommandIds` and `rejections` are
    // index-aligned, so nothing is ever dropped silently.
    expect(bridge.applySceneCommands(batch, 10)).toEqual({
      outcome: "duplicate",
      appliedCommandIds: [],
      ignoredCommandIds: ["talk", "open", "smoke"],
      rejections: [
        expect.objectContaining({ commandId: "talk", reason: "duplicate", subjectId: "aster" }),
        expect.objectContaining({ commandId: "open", reason: "duplicate", subjectId: "hearth" }),
        expect.objectContaining({ commandId: "smoke", reason: "duplicate", subjectId: null }),
      ],
    });
    expect(harness.factories.actors.get("aster")!.commands).toContainEqual({ kind: "set-face", expression: "talk-1" });
    expect(harness.factories.homes.get("hearth")!.commands).toEqual([{ kind: "door", state: "open" }]);
    expect(harness.factories.environments.get("alpha")!.effects).toEqual([{ kind: "smoke", at: { x: 16, y: 16 }, tint: "#fff" }]);

    harness.graph.updateTime(0.016, 16);
    expect(bridge.sceneSignals()).toContainEqual(expect.objectContaining({
      serial: 1,
      sceneToken: 7,
      commandId: "talk",
      subjectId: "aster",
      marker: "settled",
    }));
    expect(bridge.sceneSignals(1)).toEqual([]);
  });

  it("rejects foreign revisions and stale scene tokens while durable terminal state wins", () => {
    const alive = agent("aster", "alpha");
    const harness = makeHarness({ checkpointAgents: [alive] });
    const accepted = frame({ agents: [alive], regions: harness.regions });
    harness.graph.update(accepted);
    const bridge = harness.graph as ProductionSceneGraph & {
      applySceneCommands(batch: unknown, nowMs: number): Readonly<{ outcome: string }>;
    };
    const identity = {
      runId: accepted.runId,
      sourceKey: accepted.sourceKey,
      revision: accepted.revision,
      firstCursor: accepted.firstCursor,
      lastCursor: accepted.lastCursor,
    };
    const command = (sceneToken: number, commandId: string, nextIdentity = identity) => ({
      identity: nextIdentity,
      sceneToken,
      commands: [{
        kind: "actor",
        commandId,
        actorId: "aster",
        command: { kind: "move", waypoints: [{ x: 500, y: 500 }], speedPixelsPerSecond: 30, gait: "walk" },
      }],
    });

    expect(bridge.applySceneCommands(command(3, "current"), 10).outcome).toBe("applied");
    expect(bridge.applySceneCommands(command(2, "old"), 10).outcome).toBe("stale-scene");
    expect(bridge.applySceneCommands(command(4, "future-revision", { ...identity, revision: 99 }), 10).outcome)
      .toBe("stale-identity");

    harness.graph.update(frame({
      revision: 2,
      lastCursor: 2,
      agents: [{ ...alive, status: "dead", died_at: 100 }],
      regions: harness.regions,
    }));
    const terminalIdentity = { ...identity, revision: 2, lastCursor: 2 };
    const result = bridge.applySceneCommands(command(4, "terminal-move", terminalIdentity), 20) as Readonly<{
      outcome: string;
      ignoredCommandIds: readonly string[];
    }>;
    expect(result).toMatchObject({ outcome: "ignored", ignoredCommandIds: ["terminal-move"] });
    expect(harness.graph.debugSnapshot().actors[0]).toMatchObject({ status: "dead", terminal: true });
  });

  it("bounds hit-stop to 60-90ms and clear-scene removes transient actor offsets", () => {
    const aster = agent("aster", "alpha");
    const harness = makeHarness({ checkpointAgents: [aster] });
    const accepted = frame({ agents: [aster], regions: harness.regions });
    harness.graph.update(accepted);
    const bridge = harness.graph as ProductionSceneGraph & {
      applySceneCommands(batch: unknown, nowMs: number): Readonly<{ outcome: string }>;
    };
    const identity = {
      runId: accepted.runId,
      sourceKey: accepted.sourceKey,
      revision: accepted.revision,
      firstCursor: accepted.firstCursor,
      lastCursor: accepted.lastCursor,
    };
    expect(bridge.applySceneCommands({
      identity,
      sceneToken: 9,
      commands: [{
        kind: "hit-stop",
        commandId: "freeze",
        actorIds: ["aster"],
        durationMs: 75,
      }],
    }, 10).outcome).toBe("applied");
    harness.graph.updateTime(0.04, 50);
    expect(harness.factories.actors.get("aster")!.advances).toEqual([]);
    harness.graph.updateTime(0.035, 85);
    expect(harness.factories.actors.get("aster")!.advances).toEqual([[0.035, 85]]);

    bridge.applySceneCommands({
      identity,
      sceneToken: 9,
      commands: [{ kind: "clear-scene", commandId: "clear" }],
    }, 85);
    expect(harness.factories.actors.get("aster")!.commands.at(-1)).toEqual({
      kind: "set-offset",
      offset: { x: 0, y: 0 },
    });

    expect(bridge.applySceneCommands({
      identity,
      sceneToken: 10,
      commands: [{ kind: "hit-stop", commandId: "too-long", actorIds: ["aster"], durationMs: 91 }],
    }, 85).outcome).toBe("invalid");
  });

  it("updates live feet-Y draw order at the transparent fallback midpoint", () => {
    const factories = new RealFadeFactories();
    const agents = [agent("north", "alpha"), agent("south", "alpha")];
    const harness = makeHarness({ checkpointAgents: agents, factories });
    const accepted = frame({ agents, regions: harness.regions });
    harness.graph.update(accepted);
    const positioned = harness.graph.debugSnapshot().actors
      .slice().sort((left, right) => left.position.y - right.position.y);
    const upper = positioned[0]!.id;
    const lower = positioned[1]!.id;
    const depthTarget = tileCenter(harness.recipes.get("alpha")!.stagingAnchors
      .slice().sort((left, right) => right.row - left.row)[0]!);
    harness.factories.drawTrace.length = 0;
    harness.graph.draw({} as CanvasRenderingContext2D);
    expect(harness.factories.drawTrace.filter((entry) => entry.startsWith("actor:")))
      .toEqual([`actor:${upper}`, `actor:${lower}`]);

    (harness.graph as ProductionSceneGraph & {
      applySceneCommands(batch: unknown, nowMs: number): unknown;
    }).applySceneCommands({
      identity: {
        runId: accepted.runId,
        sourceKey: accepted.sourceKey,
        revision: accepted.revision,
        firstCursor: accepted.firstCursor,
        lastCursor: accepted.lastCursor,
      },
      sceneToken: 1,
      commands: [{
        kind: "actor",
        commandId: "move-depth",
        actorId: upper,
        command: { kind: "reposition", position: depthTarget, reason: "fallback" },
      }],
    }, 0);
    harness.factories.drawTrace.length = 0;
    harness.graph.draw({} as CanvasRenderingContext2D);
    expect(harness.factories.drawTrace.filter((entry) => entry.startsWith("actor:")))
      .toEqual([`actor:${upper}`, `actor:${lower}`]);
    expect(harness.graph.debugSnapshot().actors.find(({ id }) => id === upper)).toMatchObject({
      position: positioned[0]!.position,
      opacity: 1,
      reposition: { phase: "fade-out", reason: "fallback", target: depthTarget },
    });
    expect(harness.graph.nextDeadlineMs()).not.toBeNull();

    harness.graph.updateTime(0.2, 200);
    expect(harness.graph.debugSnapshot().actors.find(({ id }) => id === upper)).toMatchObject({
      position: depthTarget,
      opacity: 0,
      reposition: { phase: "fade-in", reason: "fallback", target: depthTarget },
    });
    expect(harness.graph.hitTargets().some(({ selection }) => (
      selection.kind === "agent" && selection.id === upper
    ))).toBe(false);
    expect(harness.graph.nextDeadlineMs()).not.toBeNull();
    harness.factories.drawTrace.length = 0;
    harness.graph.draw({} as CanvasRenderingContext2D);
    expect(harness.factories.drawTrace.filter((entry) => entry.startsWith("actor:")))
      .toEqual([`actor:${lower}`, `actor:${upper}`]);

    harness.graph.updateTime(0.2, 400);
    expect(harness.graph.debugSnapshot().actors.find(({ id }) => id === upper)).toMatchObject({
      position: depthTarget,
      opacity: 1,
      reposition: null,
    });
    expect(harness.graph.hitTargets().some(({ selection }) => (
      selection.kind === "agent" && selection.id === upper
    ))).toBe(true);
  });

  it.each(["new-scene-token", "clear-scene"] as const)(
    "cancels an in-flight fallback on %s without a late swap or marker",
    (boundary) => {
      const aster = agent("aster", "alpha");
      const factories = new RealFadeFactories();
      const harness = makeHarness({ checkpointAgents: [aster], factories });
      const accepted = frame({ agents: [aster], regions: harness.regions });
      harness.graph.update(accepted);
      const actor = factories.realActors.get(aster.id)!;
      const origin = actor.snapshot().position;
      const target = tileCenter(harness.recipes.get("alpha")!.stagingAnchors[0]!);
      const identity = identityOf(accepted);

      expect(harness.graph.applySceneCommands({
        identity,
        sceneToken: 7,
        commands: [{
          kind: "actor",
          commandId: `fade:${boundary}`,
          actorId: aster.id,
          command: { kind: "reposition", position: target, reason: "fallback" },
        }],
      }, 0)).toMatchObject({ outcome: "applied" });
      harness.graph.updateTime(0.09, 90);
      expect(actor.snapshot()).toMatchObject({
        position: origin,
        reposition: { phase: "fade-out", target },
      });
      expect(actor.snapshot().opacity).toBeGreaterThan(0);
      expect(actor.snapshot().opacity).toBeLessThan(1);

      harness.graph.applySceneCommands({
        identity,
        sceneToken: boundary === "new-scene-token" ? 8 : 7,
        commands: boundary === "clear-scene" ? [{
          kind: "clear-scene",
          commandId: "clear:fade",
        }] : [],
      }, 90);
      expect(actor.snapshot()).toMatchObject({
        position: origin,
        opacity: 1,
        reposition: null,
      });

      harness.graph.updateTime(0.5, 590);
      expect(actor.snapshot()).toMatchObject({
        position: origin,
        opacity: 1,
        reposition: null,
      });
      expect(harness.graph.debugSnapshot().recentMarkers
        .filter(({ marker }) => marker === "repositioned")).toEqual([]);
      expect(harness.graph.sceneSignals().filter(({ marker }) => marker === "repositioned"))
        .toEqual([]);
    },
  );

  it("records the nearest-path receipt and applies exactly one fallback reposition only when the endpoint differs", () => {
    const aster = agent("aster", "alpha");
    const harness = makeHarness({ checkpointAgents: [aster] });
    const accepted = frame({ agents: [aster], regions: harness.regions });
    harness.graph.update(accepted);
    const actorValue = harness.factories.actors.get("aster")!;
    const start = { ...actorValue.position };
    const authoredTargets = harness.recipes.get("alpha")!.stagingAnchors
      .slice(0, 2).map(tileCenter);
    const fallbackTarget = authoredTargets[0]!;
    const duplicateTarget = authoredTargets[1]!;
    const identity = identityOf(accepted);

    const receipt = harness.graph.applySceneCommands({
      identity,
      sceneToken: 14,
      commands: [
        {
          kind: "actor",
          commandId: "nearest-route",
          actorId: "aster",
          command: {
            kind: "move",
            waypoints: [{ x: start.x + 32, y: start.y }],
            speedPixelsPerSecond: 48,
            gait: "walk",
          },
        },
        {
          kind: "actor",
          commandId: "fallback-once",
          actorId: "aster",
          command: { kind: "reposition", position: fallbackTarget, reason: "fallback" },
        },
        {
          kind: "actor",
          commandId: "fallback-duplicate",
          actorId: "aster",
          command: { kind: "reposition", position: duplicateTarget, reason: "fallback" },
        },
      ],
    }, 0);

    expect(receipt).toMatchObject({
      outcome: "applied",
      appliedCommandIds: ["nearest-route", "fallback-once"],
      ignoredCommandIds: ["fallback-duplicate"],
    });
    expect(actorValue.commands.filter((command) => command.kind === "reposition")).toEqual([
      { kind: "reposition", position: fallbackTarget, reason: "fallback" },
    ]);
    expect(harness.graph.debugSnapshot().pathFallbacks).toBe(1);

    const equalEndpoint = harness.graph.applySceneCommands({
      identity,
      sceneToken: 15,
      commands: [{
        kind: "actor",
        commandId: "already-authoritative",
        actorId: "aster",
        command: { kind: "reposition", position: fallbackTarget, reason: "fallback" },
      }],
    }, 1);
    expect(equalEndpoint).toMatchObject({ outcome: "ignored", ignoredCommandIds: ["already-authoritative"] });
    expect(harness.graph.debugSnapshot().pathFallbacks).toBe(1);
  });

  it("rejects arbitrary or collision-blocked fallback reposition endpoints outside authored recipe anchors", () => {
    const aster = agent("aster", "alpha");
    const harness = makeHarness({ checkpointAgents: [aster] });
    const accepted = frame({ agents: [aster], regions: harness.regions });
    harness.graph.update(accepted);
    const actorValue = harness.factories.actors.get("aster")!;
    const recipe = harness.recipes.get("alpha")!;
    const valid = tileCenter(recipe.stagingAnchors[0]!);
    const arbitrary = { x: valid.x + 7, y: valid.y + 11 };
    const blockedTileIndex = recipe.grid.collision.findIndex((value) => value === 1);
    const blocked = tileCenter({
      column: blockedTileIndex % recipe.grid.columns,
      row: Math.floor(blockedTileIndex / recipe.grid.columns),
    });

    const receipt = harness.graph.applySceneCommands({
      identity: identityOf(accepted),
      sceneToken: 20,
      commands: [
        { kind: "actor", commandId: "arbitrary", actorId: "aster", command: { kind: "reposition", position: arbitrary, reason: "fallback" } },
        { kind: "actor", commandId: "blocked", actorId: "aster", command: { kind: "reposition", position: blocked, reason: "fallback" } },
        { kind: "actor", commandId: "authored-open", actorId: "aster", command: { kind: "reposition", position: valid, reason: "fallback" } },
      ],
    }, 0);

    expect(receipt).toMatchObject({
      appliedCommandIds: ["authored-open"],
      ignoredCommandIds: ["arbitrary", "blocked"],
    });
    expect(actorValue.snapshot().position).toEqual(valid);
    expect(harness.graph.debugSnapshot().pathFallbacks).toBe(1);
  });

  it("rejects direct region-transition commands that are not backed by a consumed arrival hint", () => {
    const traveler = agent("traveler", "alpha");
    const harness = makeHarness({ checkpointAgents: [traveler] });
    const accepted = frame({ agents: [traveler], regions: harness.regions });
    harness.graph.update(accepted);
    const before = harness.graph.debugSnapshot().actors[0]!.position;

    const result = harness.graph.applySceneCommands({
      identity: identityOf(accepted),
      sceneToken: 1,
      commands: [{
        kind: "actor",
        commandId: "forged-region-transition",
        actorId: traveler.id,
        command: {
          kind: "reposition",
          position: { x: before.x + 32, y: before.y },
          reason: "region-transition",
        },
      }],
    }, 0);

    expect(result.ignoredCommandIds).toContain("forged-region-transition");
    expect(harness.graph.debugSnapshot().actors[0]!.position).toEqual(before);
  });

  it("keeps a missing-body person marker selectable and exposes the same semantic subject identity", () => {
    const aster = agent("aster", "alpha");
    const factories = new RealPersonMarkerFactories();
    const harness = makeHarness({ checkpointAgents: [aster], factories });
    const accepted = frame({ agents: [aster], regions: harness.regions });

    expect(harness.graph.update(accepted).outcome).toBe("applied");
    expect(harness.graph.hitTargets()).toContainEqual(expect.objectContaining({
      selection: { kind: "agent", id: "aster" },
      selectionKey: "agent:aster",
    }));
    expect(harness.graph.semanticSnapshot().subjects).toContainEqual(expect.objectContaining({
      selection: { kind: "agent", id: "aster" },
      stableSelectionKey: "agent:aster",
      kind: "agent",
      status: "alive",
    }));
    expect(factories.realActors.get("aster")!.snapshot()).toMatchObject({
      id: "aster",
      artFallback: "person-marker",
    });
  });

  it("passes complete frozen Task 8 inputs to every concrete factory", () => {
    const atlasLeases = new Map(Object.values(PRODUCTION_ASSET_MANIFEST.atlases).map(({ id }) => [
      id,
      {
        value: { label: id } as unknown as ImageBitmap,
        release: vi.fn(),
      } satisfies ProductionAssetLease,
    ]));
    const harness = makeHarness({
      checkpointAgents: [agent("aster", "alpha")],
      checkpointHomes: [home("hearth", "aster", "alpha")],
      atlasLeases,
    });

    const diff = harness.graph.update(frame({
      agents: [agent("aster", "alpha")],
      homes: [home("hearth", "aster", "alpha")],
      regions: harness.regions,
    }));

    expect(diff).toEqual(expect.objectContaining({
      outcome: "applied",
      added: expect.arrayContaining(["agent:aster", "home:hearth", "region:alpha"]),
    }));
    const placement = harness.placement.snapshot();
    expect(harness.factories.actorInputs).toHaveLength(1);
    expect(harness.factories.actorInputs[0]).toEqual(expect.objectContaining({
      record: exact(agent("aster", "alpha")),
      position: placement.agents.get("aster")!.point,
      facing: "south",
      manifest: PRODUCTION_ASSET_MANIFEST,
      atlasLeases: harness.acquiredAtlasLeases[0],
      reducedMotion: false,
    }));
    expect(harness.factories.homeInputs[0]).toEqual(expect.objectContaining({
      id: "hearth",
      manifest: PRODUCTION_ASSET_MANIFEST,
      atlasLeases: harness.acquiredAtlasLeases[1],
      presented: expect.objectContaining({
        record: exact(home("hearth", "aster", "alpha")),
        worldTime: 100,
        door: placement.homes.get("hearth")!.door,
        kit: harness.recipes.get("alpha")!.kit,
      }),
    }));
    const homeManifest = PRODUCTION_ASSET_MANIFEST.regions[
      harness.recipes.get("alpha")!.kit
    ].homeManifest;
    expect([...harness.factories.homeInputs[0]!.atlasLeases.keys()]).toEqual([
      homeManifest.atlasId,
      homeManifest.detailAtlasId,
      homeManifest.ruinAtlasId,
      homeManifest.yard.atlasId,
    ]);
    expect(harness.factories.environmentInputs[0]).toEqual(expect.objectContaining({
      regionId: "alpha",
      recipe: harness.recipes.get("alpha"),
      condition: { energyRatio: 0.5, materialsRatio: 0.25 },
      manifest: PRODUCTION_ASSET_MANIFEST,
      atlasLeases: harness.acquiredAtlasLeases[2],
      reducedMotion: false,
    }));
    expect([...harness.factories.environmentInputs[0]!.atlasLeases.keys()]).toEqual(
      PRODUCTION_ASSET_MANIFEST.regions[harness.recipes.get("alpha")!.kit].atlasIds
        .filter((id) => PRODUCTION_ASSET_MANIFEST.atlases[id]!.group === "region"),
    );
  });

  it("defers a home whose regional atlases are not mounted instead of destroying the whole frame", () => {
    // A home lives in a region whose atlas pack has not been mounted yet -- the
    // ordinary shape of a region switch, and of any region the observer has not
    // looked at. `acquireAtlasLeases` filters the request down to what the
    // mounted region already holds, so it hands back nothing. Constructing a
    // `HomeActor` from that throws, and before this guard the throw escaped the
    // staging loop and failed the ENTIRE frame commit -- permanently, because
    // every later frame still carried the same home.
    const factories = new RealHomeFactories();
    const harness = makeHarness({
      checkpointAgents: [agent("aster", "alpha")],
      checkpointHomes: [home("hearth", "aster", "alpha")],
      factories,
      atlasLeases: coreAtlasLeases(),
    });

    const diff = harness.graph.update(frame({
      agents: [agent("aster", "alpha")],
      homes: [home("hearth", "aster", "alpha")],
      regions: harness.regions,
    }));

    expect(diff.outcome).toBe("applied");
    expect(diff.added).toContain("agent:aster");
    expect(diff.added).not.toContain("home:hearth");
    expect(harness.graph.debugSnapshot().homes).toHaveLength(0);
    expect(harness.graph.debugSnapshot().rejections.deferredHomes).toBe(1);
    expect(harness.graph.debugSnapshot().lastDeferredHomeReason)
      .toMatch(/home hearth deferred: .*four regional atlas leases/);
  });

  it("stages a deferred home on a later frame once its regional atlases are mounted", () => {
    const factories = new RealHomeFactories();
    const leases = coreAtlasLeases();
    const harness = makeHarness({
      checkpointAgents: [agent("aster", "alpha")],
      checkpointHomes: [home("hearth", "aster", "alpha")],
      factories,
      atlasLeases: leases,
    });
    harness.graph.update(frame({
      agents: [agent("aster", "alpha")],
      homes: [home("hearth", "aster", "alpha")],
      regions: harness.regions,
    }));
    expect(harness.graph.debugSnapshot().homes).toHaveLength(0);

    for (const [id, lease] of allAtlasLeases()) if (!leases.has(id)) leases.set(id, lease);

    const diff = harness.graph.update(frame({
      revision: 2,
      lastCursor: 2,
      agents: [agent("aster", "alpha")],
      homes: [home("hearth", "aster", "alpha")],
      regions: harness.regions,
    }));

    expect(diff.outcome).toBe("applied");
    expect(diff.added).toContain("home:hearth");
    expect(harness.graph.debugSnapshot().homes).toHaveLength(1);
    expect(factories.realHomes.get("hearth")).toBeDefined();
  });

  it("adds, reconciles, and removes durable entities without recreating harmless identities or positions", () => {
    const original = agent("aster", "alpha");
    const originalHome = home("hearth", "aster", "alpha");
    const harness = makeHarness({ checkpointAgents: [original], checkpointHomes: [originalHome] });
    harness.graph.update(frame({ agents: [original], homes: [originalHome], regions: harness.regions }));
    const first = harness.graph.debugSnapshot();

    const changed = { ...original, energy: 19, materials: 8, is_hoarding: true };
    const changedHome = { ...originalHome, integrity: 72, vault_materials: 14 };
    const update = harness.graph.update(frame({
      revision: 2,
      firstCursor: 1,
      lastCursor: 2,
      agents: [changed],
      homes: [changedHome],
      regions: harness.regions,
    }));
    const second = harness.graph.debugSnapshot();

    expect(update.outcome).toBe("applied");
    expect(update.added).toEqual([]);
    expect(update.updated).toEqual(expect.arrayContaining(["agent:aster", "home:hearth", "region:alpha"]));
    expect(harness.factories.actorInputs).toHaveLength(1);
    expect(harness.factories.homeInputs).toHaveLength(1);
    expect(second.actors[0]!.instanceId).toBe(first.actors[0]!.instanceId);
    expect(second.actors[0]!.position).toEqual(first.actors[0]!.position);
    expect(second.homes[0]!.instanceId).toBe(first.homes[0]!.instanceId);
    expect(harness.factories.homes.get("hearth")!.reconciliations.at(-1)?.record).toEqual(exact(changedHome));

    const removed = harness.graph.update(frame({
      revision: 3,
      firstCursor: 1,
      lastCursor: 3,
      agents: [],
      homes: [],
      regions: harness.regions,
    }));
    expect(removed.removed).toEqual(expect.arrayContaining(["agent:aster", "home:hearth"]));
    expect(harness.factories.actors.get("aster")!.disposeCalls).toBe(1);
    expect(harness.factories.homes.get("hearth")!.disposeCalls).toBe(1);
  });

  it("keeps shared atlas ownership alive when one of two visible actors is removed", () => {
    const agents = [agent("aster", "alpha"), agent("birch", "alpha")];
    const release = vi.fn();
    // The production actor factory (Task 5) leases only `core-being-chibi`
    // for a `SpriteSheetHumanActor`, not the whole "core" atlas group.
    const coreId = BEING_CHIBI_ATLAS_ID;
    const atlasLeases = new Map<string, ProductionAssetLease>([[
      coreId,
      { value: { label: coreId } as unknown as ImageBitmap, release },
    ]]);
    const factories = new LeaseReleasingFactories();
    const harness = makeHarness({
      checkpointAgents: agents,
      factories,
      atlasLeases,
    });
    harness.graph.update(frame({ agents, regions: harness.regions }));

    harness.graph.update(frame({
      revision: 2,
      lastCursor: 2,
      agents: [agents[0]!],
      regions: harness.regions,
    }));

    expect(release).not.toHaveBeenCalled();
    expect(harness.acquiredAtlasLeases).toHaveLength(3);
    expect(harness.acquiredAtlasLeases[0]).not.toBe(harness.acquiredAtlasLeases[1]);
    expect(harness.acquiredAtlasLeases[0]!.get(coreId)!.release).not.toHaveBeenCalled();
    expect(harness.acquiredAtlasLeases[1]!.get(coreId)!.release).toHaveBeenCalledOnce();
    harness.graph.draw({} as CanvasRenderingContext2D);
    expect(factories.drawTrace).toContain("actor:aster");
    expect(harness.graph.debugSnapshot().actors.map(({ id }) => id)).toEqual(["aster"]);
  });

  it("FINAL RED: keeps a retained traveller on core leases while atomically replacing the regional pack", () => {
    const traveler = agent("traveler", "alpha");
    const atlasLeases = new Map(Object.values(PRODUCTION_ASSET_MANIFEST.atlases).map(({ id }) => [
      id,
      { value: { label: id } as unknown as ImageBitmap, release: vi.fn() } satisfies ProductionAssetLease,
    ]));
    const factories = new LeaseReleasingFactories();
    const harness = makeHarness({ checkpointAgents: [traveler], atlasLeases, factories });
    const initial = frame({ agents: [traveler], regions: harness.regions });
    harness.graph.update(initial);
    const instanceId = harness.graph.debugSnapshot().actors[0]!.instanceId;
    const actorLeaseIds = [...harness.factories.actorInputs[0]!.atlasLeases.keys()];
    expect(actorLeaseIds.every((id) => PRODUCTION_ASSET_MANIFEST.atlases[id]!.group === "core")).toBe(true);
    // The `SpriteSheetHumanActor` factory (Task 5) leases only the single
    // `core-being-chibi` atlas, not the entire "core" group.
    expect(actorLeaseIds).toEqual([BEING_CHIBI_ATLAS_ID]);
    harness.graph.applySceneCommands({
      identity: identityOf(initial), sceneToken: 95, commands: [{
        kind: "retain-traveler", commandId: "retain:leases", actorId: traveler.id,
        fromRegion: "alpha", toRegion: "beta",
      }],
    } as never, 0);

    const momentId = "lease-travel";
    const programId = `choreography:${momentId}:agent_entered_region`;
    const destination = frame({
      revision: 2, lastCursor: 2, agents: [traveler], regions: harness.regions,
      scene: scene("beta", {
        momentId,
        phase: "hold",
        execution: { sceneToken: 95, programId, eventType: "agent_entered_region" },
        effectIntents: [{ kind: "atlas-transition", sourceId: "alpha", targetId: "beta" }],
      }),
    });
    harness.graph.applyFrame!(destination, {
      identity: identityOf(destination),
      sceneToken: 95,
      commands: [
        { kind: "retain-traveler", commandId: "retain:leases", actorId: traveler.id, fromRegion: "alpha", toRegion: "beta" },
        {
          kind: "stage-arrival", commandId: "stage:leases", actorId: traveler.id,
          fromRegion: "alpha", toRegion: "beta", eventType: "agent_entered_region",
          phase: "hold", momentId, programId,
        },
      ],
    }, 100);
    expect(harness.graph.debugSnapshot().actors[0]).toMatchObject({ id: traveler.id, instanceId });
    expect(harness.factories.actorInputs).toHaveLength(1);
    const alphaEnvironment = PRODUCTION_ASSET_MANIFEST.regions[harness.recipes.get("alpha")!.kit]
      .atlasIds.filter((id) => PRODUCTION_ASSET_MANIFEST.atlases[id]!.group === "region");
    const betaEnvironment = PRODUCTION_ASSET_MANIFEST.regions[harness.recipes.get("beta")!.kit]
      .atlasIds.filter((id) => PRODUCTION_ASSET_MANIFEST.atlases[id]!.group === "region");
    expect([...harness.acquiredAtlasLeases[1]!.keys()]).toEqual(alphaEnvironment);
    expect(alphaEnvironment.every((id) => (
      vi.mocked(harness.acquiredAtlasLeases[1]!.get(id)!.release).mock.calls.length === 1
    ))).toBe(true);
    expect([...harness.acquiredAtlasLeases[2]!.keys()]).toEqual(betaEnvironment);
    expect(betaEnvironment.every((id) => (
      vi.mocked(harness.acquiredAtlasLeases[2]!.get(id)!.release).mock.calls.length === 0
    ))).toBe(true);
  });

  it("FINAL RED: applyFrame leaves graph and placement bit-identical for invalid identity/token/schema then accepts retry once", () => {
    const aster = agent("aster", "alpha");
    const harness = makeHarness({ checkpointAgents: [aster] });
    const initial = frame({ agents: [aster], regions: harness.regions });
    harness.graph.update(initial);
    harness.graph.applySceneCommands({
      identity: identityOf(initial), sceneToken: 10,
      commands: [{ kind: "clear-scene", commandId: "seed-token" }],
    }, 0);
    const before = harness.graph.debugSnapshot();
    const placementBefore = harness.placement.snapshot();
    const next = frame({
      revision: 2, lastCursor: 2,
      agents: [{ ...aster, position: "beta", status: "paralyzed" }], regions: harness.regions,
      scene: scene("beta"),
    });
    for (const batch of [
      { identity: identityOf(next), sceneToken: 11, commands: [{ kind: "camera-impulse", commandId: "bad-shape", offset: { x: 2, y: 0 }, durationMs: 80 }] },
      { identity: identityOf(initial), sceneToken: 11, commands: [] },
      { identity: identityOf(next), sceneToken: 9, commands: [] },
    ] as const) {
      expect(harness.graph.applyFrame!(next, batch as never, 10).outcome).not.toBe("accepted");
      expect(harness.graph.debugSnapshot()).toEqual(before);
      expect(harness.placement.snapshot()).toEqual(placementBefore);
    }
    const accepted = harness.graph.applyFrame!(next, {
      identity: identityOf(next), sceneToken: 11, commands: [],
    }, 10);
    expect(accepted.outcome).toBe("accepted");
    expect(harness.graph.debugSnapshot().identity?.revision).toBe(2);
    expect(harness.graph.debugSnapshot().actors[0]?.instanceId).toBe(before.actors[0]?.instanceId);
  });

  it("FINAL RED: exhaustively rejects malformed top-level and nested primitives before any graph/resource mutation", () => {
    const aster = agent("aster", "alpha");
    const hearth = home("hearth", "aster", "alpha");
    const harness = makeHarness({ checkpointAgents: [aster], checkpointHomes: [hearth] });
    const initial = frame({ agents: [aster], homes: [hearth], regions: harness.regions });
    harness.graph.update(initial);
    const before = harness.graph.debugSnapshot();
    const placementBefore = harness.placement.snapshot();
    const leaseGenerations = harness.acquiredAtlasLeases.length;
    const next = frame({
      revision: 2, lastCursor: 2,
      agents: [{ ...aster, status: "paralyzed" }], homes: [hearth], regions: harness.regions,
    });
    const invalidCommands: readonly unknown[] = [
      { kind: "unknown-top", commandId: "bad-top" },
      { kind: "actor", commandId: "bad-actor-id", actorId: "", command: { kind: "recover" } },
      { kind: "actor", commandId: "bad-move-speed", actorId: "aster", command: { kind: "move", waypoints: [{ x: 1, y: 1 }], speedPixelsPerSecond: -1, gait: "walk" } },
      { kind: "actor", commandId: "bad-move-point", actorId: "aster", command: { kind: "move", waypoints: [{ x: Number.NaN, y: 1 }], speedPixelsPerSecond: 48, gait: "walk" } },
      { kind: "actor", commandId: "bad-orient", actorId: "aster", command: { kind: "orient", facing: "diagonal" } },
      { kind: "actor", commandId: "bad-body", actorId: "aster", command: { kind: "play-body", action: "explode" } },
      { kind: "actor", commandId: "bad-face", actorId: "aster", command: { kind: "set-face", expression: "missing" } },
      { kind: "actor", commandId: "bad-held", actorId: "aster", command: { kind: "set-held", heldId: 3 } },
      { kind: "actor", commandId: "bad-status", actorId: "aster", command: { kind: "set-status", status: "ghost" } },
      { kind: "actor", commandId: "bad-reposition", actorId: "aster", command: { kind: "reposition", position: { x: Number.POSITIVE_INFINITY, y: 1 }, reason: "fallback" } },
      { kind: "actor", commandId: "bad-offset", actorId: "aster", command: { kind: "set-offset", offset: { x: 9, y: 0 } } },
      { kind: "actor", commandId: "bad-selected", actorId: "aster", command: { kind: "set-selected", selected: "yes" } },
      { kind: "actor", commandId: "bad-nested", actorId: "aster", command: { kind: "unknown" } },
      { kind: "home", commandId: "bad-home-duration", homeId: "hearth", command: { kind: "build", durationMs: 0 } },
      { kind: "home", commandId: "bad-home-state", homeId: "hearth", command: { kind: "door", state: "ajar" } },
      { kind: "home", commandId: "bad-home-nested", homeId: "hearth", command: { kind: "unknown" } },
      { kind: "environment", commandId: "bad-environment-point", request: { kind: "dust", at: { x: Number.NaN, y: 0 }, tint: "#fff" } },
      { kind: "environment", commandId: "bad-environment-label", request: { kind: "ember", at: { x: 1, y: 1 }, tint: "", label: { recipientId: "", value: 3 } } },
      { kind: "environment", commandId: "bad-environment-kind", request: { kind: "rain", at: { x: 1, y: 1 }, tint: "#fff" } },
      { kind: "remote-transient", commandId: "bad-motif", motif: "teleport", sourceId: null, targetId: null, at: null },
      { kind: "placement-hint", commandId: "bad-context", agentId: "aster", context: { kind: "unknown" } },
      { kind: "stage-arrival", commandId: "bad-stage-event", actorId: "aster", fromRegion: "alpha", toRegion: "beta", eventType: "speak", phase: "hold", momentId: "m", programId: "p" },
      { kind: "stage-arrival", commandId: "bad-stage-phase", actorId: "aster", fromRegion: "alpha", toRegion: "beta", eventType: "agent_entered_region", phase: "enter", momentId: "m", programId: "p" },
      { kind: "stage-arrival", commandId: "bad-stage-edge", actorId: "aster", fromRegion: "alpha", toRegion: "alpha", eventType: "agent_entered_region", phase: "hold", momentId: "m", programId: "p" },
      { kind: "stage-arrival", commandId: "bad-stage-program", actorId: "aster", fromRegion: "alpha", toRegion: "beta", eventType: "agent_entered_region", phase: "hold", momentId: "m", programId: "" },
    ];
    for (const [index, command] of invalidCommands.entries()) {
      const receipt = harness.graph.applyFrame!(next, {
        identity: identityOf(next), sceneToken: 20 + index, commands: [command],
      } as never, 10);
      expect(receipt.outcome, JSON.stringify(command)).toBe("invalid");
      expect(harness.graph.debugSnapshot()).toEqual(before);
      expect(harness.placement.snapshot()).toEqual(placementBefore);
      expect(harness.acquiredAtlasLeases).toHaveLength(leaseGenerations);
    }
  });

  it.each(["kneel", "gather"] as const)(
    // RealPersonMarkerFactories wraps the legacy LayeredHumanActor (see its
    // class definition below), which has no `pose-kneel`/`pose-crouch`
    // frames in its packed rig atlas and degrades to the nearest authored
    // clip (`legacyBodyAction` in LayeredHumanActor.ts) — "reaching" for
    // kneel, "working" for gather. SpriteSheetHumanActor.test.ts covers the
    // real distinct "kneeling"/"gathering" poses production actually renders.
    "accepts a %s play-body command as valid and degrades it on the legacy actor",
    (action) => {
      const aster = agent("aster", "alpha");
      const factories = new RealPersonMarkerFactories();
      const harness = makeHarness({ checkpointAgents: [aster], factories });
      const accepted = frame({ agents: [aster], regions: harness.regions });
      harness.graph.update(accepted);
      const actor = factories.realActors.get(aster.id)!;

      expect(harness.graph.applySceneCommands({
        identity: identityOf(accepted),
        sceneToken: 1,
        commands: [{
          kind: "actor",
          commandId: `${action}:valid`,
          actorId: aster.id,
          command: { kind: "play-body", action },
        }],
      }, 0).outcome).toBe("applied");
      expect(actor.snapshot()).toMatchObject({
        activeAction: action === "kneel" ? "reaching" : "working",
      });
    },
  );

  it("instantiates only active-region actors and homes from a multi-region world frame", () => {
    const agents = [agent("alpha-agent", "alpha"), agent("beta-agent", "beta")];
    const homes = [
      home("alpha-home", "alpha-agent", "alpha"),
      home("beta-home", "beta-agent", "beta"),
    ];
    const harness = makeHarness({ checkpointAgents: agents, checkpointHomes: homes });

    harness.graph.update(frame({
      agents,
      homes,
      regions: harness.regions,
      scene: scene("alpha"),
    }));

    expect(harness.factories.actorInputs.map(({ record }) => record.value.id)).toEqual(["alpha-agent"]);
    expect(harness.factories.homeInputs.map(({ presented }) => presented.record.value.home_id)).toEqual(["alpha-home"]);
    expect(harness.graph.debugSnapshot().actors.map(({ id }) => id)).toEqual(["alpha-agent"]);
    expect(harness.graph.debugSnapshot().homes.map(({ id }) => id)).toEqual(["alpha-home"]);
    expect(harness.factories.environmentInputs[0]?.recipe.kit).toBe(harness.recipes.get("alpha")!.kit);
  });

  it("accepts only monotonic lineage-local identities and treats exact duplicates as no-ops", () => {
    const harness = makeHarness();
    const initial = frame({ revision: 2, firstCursor: 3, lastCursor: 8, regions: harness.regions });
    expect(harness.graph.update(initial).outcome).toBe("applied");
    expect(harness.graph.update(initial).outcome).toBe("duplicate");

    expect(harness.graph.update(frame({
      revision: 1, firstCursor: 3, lastCursor: 9, regions: harness.regions,
    })).outcome).toBe("stale");
    expect(harness.graph.update(frame({
      revision: 3, firstCursor: 2, lastCursor: 9, regions: harness.regions,
    })).outcome).toBe("stale");
    expect(harness.graph.update(frame({
      revision: 3, firstCursor: 3, lastCursor: 7, regions: harness.regions,
    })).outcome).toBe("stale");
    expect(harness.graph.update(frame({
      revision: 2, firstCursor: 3, lastCursor: 9, regions: harness.regions,
    })).outcome).toBe("applied");
    expect(harness.graph.update(frame({
      runId: "other-run", revision: 99, firstCursor: 3, lastCursor: 99, regions: harness.regions,
    })).outcome).toBe("foreign-lineage");
    expect(harness.graph.update(frame({
      sourceKey: "archive:other", revision: 99, firstCursor: 3, lastCursor: 99, regions: harness.regions,
    })).outcome).toBe("foreign-lineage");

    expect(harness.graph.debugSnapshot()).toEqual(expect.objectContaining({
      identity: expect.objectContaining({ revision: 2, firstCursor: 3, lastCursor: 9 }),
      rejections: expect.objectContaining({ stale: 3, foreignLineage: 2 }),
    }));
    expect(harness.factories.environments.size).toBe(1);
  });

  it("rejects invalid or externally regressed world provenance cursors", () => {
    const standing = home("hearth", "aster", "alpha");
    const harness = makeHarness({ checkpointHomes: [standing] });
    const accepted = frame({
      revision: 1,
      firstCursor: 0,
      lastCursor: 5,
      exactBaseCursor: 4,
      projectedThroughCursor: 5,
      homes: [standing],
      exactHomes: [standing],
      regions: harness.regions,
    });
    expect(harness.graph.update(accepted).outcome).toBe("applied");
    const before = harness.graph.debugSnapshot();

    expect(harness.graph.update(frame({
      revision: 2,
      firstCursor: 0,
      lastCursor: 6,
      exactBaseCursor: 3,
      projectedThroughCursor: 6,
      homes: [standing],
      regions: harness.regions,
    })).outcome).toBe("stale");
    expect(harness.graph.update(frame({
      revision: 2,
      firstCursor: 0,
      lastCursor: 6,
      exactBaseCursor: 4,
      projectedThroughCursor: 4,
      homes: [standing],
      regions: harness.regions,
    })).outcome).toBe("stale");
    expect(harness.graph.update(frame({
      revision: 2,
      firstCursor: 0,
      lastCursor: 6,
      exactBaseCursor: 7,
      projectedThroughCursor: 6,
      homes: [standing],
      regions: harness.regions,
    })).outcome).toBe("invalid");
    expect(harness.graph.update(frame({
      revision: 2,
      firstCursor: 0,
      lastCursor: 6,
      exactBaseCursor: 5,
      projectedThroughCursor: 7,
      homes: [standing],
      regions: harness.regions,
    })).outcome).toBe("invalid");

    expect(harness.graph.debugSnapshot()).toEqual(expect.objectContaining({
      identity: before.identity,
      homes: before.homes,
      cursors: before.cursors,
      rejections: expect.objectContaining({ stale: 2, invalid: 2 }),
    }));
  });

  it("accepts a two-lane live frame whose world is projected past the staged moment", () => {
    // Measured against a real Gemini run on 2026-08-20: the observer rendered nothing but
    // "Some world art could not be shown" because every such frame was rejected here.
    // `StoryDirector.flushDeferredEvidence` applies OVERLAY-lane evidence for beats that sit
    // after the scene still holding the stage, so `world.projectedThroughCursor` legitimately
    // runs ahead of `frame.lastCursor` (the ACTIVE moment's range). The world may never be
    // projected past what was INGESTED -- that is the guard that still has to hold.
    const standing = home("hearth", "aster", "alpha");
    const harness = makeHarness({ checkpointHomes: [standing] });
    const overlayLaneAhead = {
      ...frame({
        revision: 1,
        firstCursor: 341,
        lastCursor: 341,
        exactBaseCursor: 341,
        projectedThroughCursor: 342,
        homes: [standing],
        exactHomes: [standing],
        regions: harness.regions,
      }),
      ingestedCursor: 343,
      presentedCursor: 341,
    };
    expect(harness.graph.update(overlayLaneAhead).outcome).toBe("applied");

    const atTheIngestionBoundary = {
      ...frame({
        revision: 2,
        firstCursor: 341,
        lastCursor: 341,
        exactBaseCursor: 341,
        projectedThroughCursor: 343,
        homes: [standing],
        exactHomes: [standing],
        regions: harness.regions,
      }),
      ingestedCursor: 343,
      presentedCursor: 341,
    };
    expect(harness.graph.update(atTheIngestionBoundary).outcome).toBe("applied");
  });

  it("still rejects a world projected beyond what was ingested", () => {
    const standing = home("hearth", "aster", "alpha");
    const harness = makeHarness({ checkpointHomes: [standing] });
    const fabricatedFuture = {
      ...frame({
        revision: 1,
        firstCursor: 341,
        lastCursor: 341,
        exactBaseCursor: 341,
        projectedThroughCursor: 344,
        homes: [standing],
        exactHomes: [standing],
        regions: harness.regions,
      }),
      ingestedCursor: 343,
      presentedCursor: 341,
    };
    expect(harness.graph.update(fabricatedFuture).outcome).toBe("invalid");
    expect(harness.graph.debugSnapshot()).toEqual(expect.objectContaining({
      rejections: expect.objectContaining({ invalid: 1 }),
    }));
  });

  it("accepts an archive frame whose ingested cursor is the director's alone", () => {
    // Replay has no ingress to take a max against, so `ingestedCursor` is
    // `directorState.ingestedCursor` on its own. The relaxed bound must not regress it.
    const standing = home("hearth", "aster", "alpha");
    const harness = makeHarness({ checkpointHomes: [standing] });
    const archived = {
      ...frame({
        revision: 1,
        firstCursor: 12,
        lastCursor: 12,
        exactBaseCursor: 10,
        projectedThroughCursor: 12,
        homes: [standing],
        exactHomes: [standing],
        regions: harness.regions,
      }),
      sourceKey: "archive:run-one",
      source: "archive" as const,
      ingestedCursor: 12,
      presentedCursor: 12,
    };
    expect(harness.graph.update(archived).outcome).toBe("applied");
  });

  it("rejects invalid or conflicting durable keys atomically", () => {
    const standing = home("hearth", "aster", "alpha");
    const harness = makeHarness({ checkpointHomes: [standing] });
    harness.graph.update(frame({ homes: [standing], regions: harness.regions }));
    const before = harness.graph.debugSnapshot();

    const conflicting = harness.graph.update(frame({
      revision: 2,
      lastCursor: 2,
      homes: [standing],
      ruins: [{ ...standing, status: "ruin", ruined_at: 99 }],
      regions: harness.regions,
    }));
    expect(conflicting.outcome).toBe("invalid");
    expect(harness.graph.debugSnapshot().identity).toEqual(before.identity);
    expect(harness.factories.homeInputs).toHaveLength(1);

    const duplicateAgents = harness.graph.update(frame({
      revision: 3,
      lastCursor: 3,
      agents: [agent("same", "alpha"), agent("same", "alpha")],
      homes: [standing],
      regions: harness.regions,
    }));
    expect(duplicateAgents.outcome).toBe("invalid");
    expect(harness.graph.debugSnapshot().rejections.invalid).toBe(2);
  });

  it("rolls back every prepared addition when a later factory throws", () => {
    const stable = agent("stable", "alpha");
    const harness = makeHarness({ checkpointAgents: [stable] });
    harness.graph.update(frame({ agents: [stable], regions: harness.regions }));
    const before = harness.graph.debugSnapshot();
    const placementBefore = harness.placement.snapshot();
    harness.factories.throwActorId = "zeta";

    expect(() => harness.graph.update(frame({
      revision: 2,
      lastCursor: 2,
      agents: [stable, agent("beta", "alpha"), agent("zeta", "alpha")],
      regions: harness.regions,
    }))).toThrow(/factory zeta/);

    const after = harness.graph.debugSnapshot();
    expect(after).toEqual(before);
    expect(harness.placement.snapshot()).toEqual(placementBefore);
    expect(harness.factories.actors.get("beta")!.disposeCalls).toBe(1);
    expect(harness.factories.actors.get("stable")!.disposeCalls).toBe(0);
  });

  it("releases all four regional home leases when home construction rejects, and defers the home", () => {
    // Re-baselined deliberately. This test used to pin `.toThrow(/home factory
    // hearth/)` -- i.e. that a failed home construction propagates out of
    // `update`. That propagation IS the defect being fixed: the renderer can only
    // read a throw from `applyGraphFrame` as a whole-frame commit failure, so one
    // unbuildable home stopped the entire world advancing (observed live: the
    // scene graph wedged at the cursor of the first shelter raised in a region
    // whose atlas pack was not mounted, for the rest of the run). The assertion
    // that made this test valuable -- all four leases released, no home staged --
    // is kept verbatim below; only the propagation clause is replaced, by the
    // deferral counter and reason that now carry the same information without
    // destroying the frame.
    const atlasLeases = allAtlasLeases();
    const factories = new FakeFactories();
    factories.throwHomeId = "hearth";
    const harness = makeHarness({ factories, atlasLeases });

    const diff = harness.graph.update(frame({
      homes: [home("hearth", "aster", "alpha")],
      regions: harness.regions,
    }));

    expect(diff.outcome).toBe("applied");
    expect(diff.added).not.toContain("home:hearth");
    expect(harness.graph.debugSnapshot().rejections.deferredHomes).toBe(1);
    expect(harness.graph.debugSnapshot().lastDeferredHomeReason)
      .toMatch(/home hearth deferred: .*home factory hearth/);

    const kit = harness.recipes.get("alpha")!.kit;
    const homeManifest = PRODUCTION_ASSET_MANIFEST.regions[kit].homeManifest;
    const acquired = harness.acquiredAtlasLeases[0]!;
    expect([...acquired.keys()]).toEqual([
      homeManifest.atlasId,
      homeManifest.detailAtlasId,
      homeManifest.ruinAtlasId,
      homeManifest.yard.atlasId,
    ]);
    expect([...acquired.values()].every(({ release }) =>
      vi.mocked(release).mock.calls.length === 1)).toBe(true);
    expect(harness.graph.debugSnapshot().homes).toEqual([]);
  });

  it("rolls back earlier in-place home reconciliation when a later reconcile throws", () => {
    const first = home("a-home", "aster", "alpha");
    const second = home("z-home", "aster", "alpha");
    const harness = makeHarness({ checkpointHomes: [first, second] });
    harness.graph.update(frame({ homes: [first, second], regions: harness.regions }));
    const aHome = harness.factories.homes.get("a-home")!;
    const zHome = harness.factories.homes.get("z-home")!;
    const before = harness.graph.debugSnapshot();
    const placementBefore = harness.placement.snapshot();
    const newcomer = agent("newcomer", "alpha");
    zHome.throwOnEveryReconcile = true;

    expect(() => harness.graph.update(frame({
      revision: 2,
      lastCursor: 2,
      agents: [newcomer],
      homes: [{ ...first, integrity: 40 }, { ...second, integrity: 30 }],
      regions: harness.regions,
    }))).toThrow(/reconcile z-home/);

    const after = harness.graph.debugSnapshot();
    expect(after).toEqual(before);
    expect(harness.placement.snapshot()).toEqual(placementBefore);
    expect(aHome.current.record).toEqual(exact(first));
    expect(zHome.current.record).toEqual(exact(second));
    expect(harness.factories.actors.get("newcomer")!.disposeCalls).toBe(1);
  });

  it("restores same-base ruin projection when a later environment reconcile rejects the frame", () => {
    const exactRuin = {
      ...home("hearth", "aster", "alpha"),
      status: "ruin" as const,
      integrity: 0,
      ruined_at: 101,
      remnant_materials: 55,
    };
    const factories = new RealHomeFactories();
    const harness = makeHarness({
      checkpointHomes: [exactRuin],
      factories,
      atlasLeases: allAtlasLeases(),
    });
    const initial = frame({
      firstCursor: 0,
      lastCursor: 0,
      exactBaseCursor: 0,
      projectedThroughCursor: 0,
      exactHomes: [],
      exactRuins: [exactRuin],
      ruins: [exactRuin],
      regions: harness.regions,
    });
    expect(harness.graph.update(initial).outcome).toBe("applied");
    const graphBefore = harness.graph.debugSnapshot();
    const actor = factories.realHomes.get("hearth")!;
    expect(actor.snapshot().visual.ruinFrameId).toBe("rubble-full");

    const alpha = factories.environments.get("alpha")!;
    alpha.throwOnNextReconcile = true;
    const richer = harness.regions.map((value) => value.name === "alpha"
      ? { ...value, current_energy: 90 }
      : value);
    const projected = { ...exactRuin, remnant_materials: 0 };
    const rejected = frame({
      revision: 2,
      firstCursor: 1,
      lastCursor: 1,
      exactBaseCursor: 0,
      projectedThroughCursor: 1,
      exactHomes: [],
      exactRuins: [exactRuin],
      ruins: [projected],
      regions: richer,
    });

    expect(() => harness.graph.update(rejected)).toThrow("environment reconcile alpha");
    expect(harness.graph.debugSnapshot()).toEqual(graphBefore);
    expect(actor.snapshot().durable.remnantMaterials).toBe(55);
    expect(actor.snapshot().visual.ruinFrameId).toBe("rubble-full");
  });

  it("retains known identity and placement across projected-partial records and diagnoses unusable new records", () => {
    const aster = agent("aster", "alpha");
    const harness = makeHarness({ checkpointAgents: [aster] });
    harness.graph.update(frame({ agents: [aster], regions: harness.regions }));
    const before = harness.graph.debugSnapshot().actors[0]!;

    const partial = harness.graph.update(frame({
      revision: 2,
      lastCursor: 2,
      agentRecords: [projected<AgentSnapshot>({ id: "aster", status: "paralyzed" })],
      regionRecords: [projected<RegionSnapshot>({ name: "alpha", current_energy: 1 })],
    }));
    expect(partial.outcome).toBe("applied");
    expect(harness.graph.debugSnapshot().actors[0]).toEqual(expect.objectContaining({
      id: "aster",
      instanceId: before.instanceId,
      position: before.position,
      terminal: false,
      status: "paralyzed",
    }));
    expect(harness.factories.environments.get("alpha")!.conditions.at(-1)).toEqual({
      energyRatio: 0.5,
      materialsRatio: 0.25,
    });

    const unusable = harness.graph.update(frame({
      revision: 3,
      lastCursor: 3,
      agentRecords: [
        projected<AgentSnapshot>({ id: "aster", status: "paralyzed" }),
        projected<AgentSnapshot>({ status: "alive" }),
        projected<AgentSnapshot>({ id: "identity-only" }),
      ],
      regionRecords: [projected<RegionSnapshot>({ name: "alpha" })],
    }));
    expect(unusable.outcome).toBe("applied");
    expect(harness.factories.actorInputs).toHaveLength(1);
    expect(harness.graph.debugSnapshot().rejections.malformedRecords).toBe(2);
  });

  it("reconciles a standing home into one persistent ruin identity, including zero remnant", () => {
    const standing = home("hearth", "aster", "alpha");
    const harness = makeHarness({ checkpointHomes: [standing] });
    harness.graph.update(frame({ homes: [standing], regions: harness.regions }));
    const first = harness.graph.debugSnapshot().homes[0]!;

    const ruin = { ...standing, status: "ruin" as const, ruined_at: 101, remnant_materials: 0 };
    harness.graph.update(frame({
      revision: 2,
      lastCursor: 2,
      homes: [],
      ruins: [ruin],
      regions: harness.regions,
    }));
    const next = harness.graph.debugSnapshot().homes[0]!;

    expect(harness.factories.homeInputs).toHaveLength(1);
    expect(next).toEqual(expect.objectContaining({
      id: "hearth",
      kind: "ruin",
      instanceId: first.instanceId,
      remnantMaterials: 0,
    }));
    expect(harness.factories.homes.get("hearth")!.disposeCalls).toBe(0);
  });

  it("keeps projected collapse rubble separate from exact standing remnant truth", () => {
    const standing = home("hearth", "aster", "alpha");
    const factories = new RealHomeFactories();
    const harness = makeHarness({
      checkpointHomes: [standing],
      factories,
      atlasLeases: allAtlasLeases(),
    });
    const initial = frame({
      firstCursor: 0,
      lastCursor: 0,
      homes: [standing],
      exactHomes: [standing],
      exactRuins: [],
      regions: harness.regions,
    });
    expect(harness.graph.applyFrame!(initial, null, 0).outcome).toBe("accepted");

    const collapsed = {
      ...standing,
      status: "ruin" as const,
      integrity: 0,
      ruined_at: 101,
      remnant_materials: 55,
    };
    const projected = frame({
      revision: 2,
      firstCursor: 0,
      lastCursor: 1,
      exactBaseCursor: 0,
      projectedThroughCursor: 1,
      exactHomes: [standing],
      exactRuins: [],
      homes: [],
      ruinRecords: [exact(collapsed)],
      regions: harness.regions,
    });
    expect(harness.graph.applyFrame!(projected, null, 100).outcome).toBe("accepted");

    const ruin = factories.realHomes.get("hearth")!.snapshot();
    expect(ruin.durable.remnantMaterials).toBe(0);
    expect(ruin.visual.ruinFrameId).toBe("rubble-full");
  });

  it("mounts and partially rebases a projected ruin from explicit exact partitions", () => {
    const eventRuin = {
      ...home("hearth", "aster", "alpha"),
      status: "ruin" as const,
      integrity: 0,
      ruined_at: 101,
      remnant_materials: 55,
    };
    const factories = new RealHomeFactories();
    const harness = makeHarness({ factories, atlasLeases: allAtlasLeases() });
    const projected = frame({
      firstCursor: 0,
      lastCursor: 1,
      exactBaseCursor: 0,
      projectedThroughCursor: 1,
      exactHomes: [],
      exactRuins: [],
      ruinRecords: [exact(eventRuin)],
      regions: harness.regions,
    });
    expect(harness.graph.applyFrame!(projected, null, 0).outcome).toBe("accepted");
    const actor = factories.realHomes.get("hearth")!;
    expect(actor.snapshot().durable.remnantMaterials).toBeNull();
    expect(actor.snapshot().visual.ruinFrameId).toBe("rubble-full");

    const exactRuin = { ...eventRuin, remnant_materials: 40 };
    const projectedRuin = { ...eventRuin, remnant_materials: 0 };
    const partiallyRebased = frame({
      revision: 2,
      firstCursor: 0,
      lastCursor: 2,
      exactBaseCursor: 1,
      projectedThroughCursor: 2,
      exactHomes: [],
      exactRuins: [exactRuin],
      ruinRecords: [exact(projectedRuin)],
      regions: harness.regions,
    });
    expect(harness.graph.applyFrame!(partiallyRebased, null, 100).outcome).toBe("accepted");
    expect(actor.snapshot().durable.remnantMaterials).toBe(40);
    expect(actor.snapshot().visual.ruinFrameId).toBe("rubble-bare");
  });

  it("does not invent exact ruin truth when supplied exact partitions are empty", () => {
    const orphanedRuin = {
      ...home("hearth", "aster", "alpha"),
      status: "ruin" as const,
      integrity: 0,
      ruined_at: 101,
      remnant_materials: 55,
    };
    const factories = new RealHomeFactories();
    const harness = makeHarness({ factories, atlasLeases: allAtlasLeases() });
    const contradictory = frame({
      firstCursor: 1,
      lastCursor: 1,
      exactBaseCursor: 1,
      projectedThroughCursor: 1,
      exactHomes: [],
      exactRuins: [],
      ruinRecords: [exact(orphanedRuin)],
      regions: harness.regions,
    });

    expect(harness.graph.applyFrame!(contradictory, null, 0).outcome).toBe("accepted");
    const actor = factories.realHomes.get("hearth")!.snapshot();
    expect(actor.durable.remnantMaterials).toBeNull();
    expect(actor.cues).toContainEqual({
      kind: "unknown-hatch",
      shape: "hatch",
      colorIndependent: true,
    });
  });

  it("does not project a scavenge command beyond the frame world evidence cursor", () => {
    const exactRuin = {
      ...home("hearth", "aster", "alpha"),
      status: "ruin" as const,
      integrity: 0,
      ruined_at: 101,
      remnant_materials: 55,
    };
    const factories = new RealHomeFactories();
    const harness = makeHarness({
      checkpointHomes: [exactRuin],
      factories,
      atlasLeases: allAtlasLeases(),
    });
    const initial = frame({
      firstCursor: 0,
      lastCursor: 0,
      exactBaseCursor: 0,
      projectedThroughCursor: 0,
      exactHomes: [],
      exactRuins: [exactRuin],
      ruins: [exactRuin],
      regions: harness.regions,
    });
    expect(harness.graph.applyFrame!(initial, null, 0).outcome).toBe("accepted");

    const ahead = frame({
      revision: 2,
      firstCursor: 1,
      lastCursor: 1,
      exactBaseCursor: 0,
      projectedThroughCursor: 0,
      exactHomes: [],
      exactRuins: [exactRuin],
      ruins: [exactRuin],
      regions: harness.regions,
    });
    const batch = {
      identity: identityOf(ahead),
      sceneToken: 91,
      commands: [{
        kind: "home",
        commandId: "scavenge:ahead",
        homeId: "hearth",
        command: { kind: "scavenge", durationMs: 100, remnantMaterialsAfter: 0 },
      }],
    } as const;
    expect(harness.graph.applyFrame!(ahead, batch, 10).outcome).toBe("accepted");
    expect(factories.realHomes.get("hearth")!.snapshot().visual.ruinFrameId)
      .toBe("rubble-full-scavenge");

    const projectedRuin = { ...exactRuin, remnant_materials: 0 };
    const caughtUp = frame({
      revision: 3,
      firstCursor: 1,
      lastCursor: 1,
      exactBaseCursor: 0,
      projectedThroughCursor: 1,
      exactHomes: [],
      exactRuins: [exactRuin],
      ruins: [projectedRuin],
      regions: harness.regions,
    });
    expect(harness.graph.applyFrame!(caughtUp, null, 20).outcome).toBe("accepted");
    expect(factories.realHomes.get("hearth")!.snapshot().visual.ruinFrameId)
      .toBe("rubble-bare-scavenge");
  });

  it("gives durable dead/paralyzed truth priority, ignores Task 9 intents, and removes only on absence", () => {
    const alive = agent("aster", "alpha");
    const hearth = home("hearth", "aster", "alpha");
    const harness = makeHarness({ checkpointAgents: [alive], checkpointHomes: [hearth] });
    harness.graph.update(frame({ agents: [alive], homes: [hearth], regions: harness.regions }));
    const actor = harness.factories.actors.get("aster")!;
    const environment = harness.factories.environments.get("alpha")!;

    const dead = { ...alive, status: "dead" as const, died_at: 101 };
    harness.graph.update(frame({
      revision: 2,
      lastCursor: 2,
      agents: [dead],
      homes: [hearth],
      regions: harness.regions,
      scene: scene("alpha", {
        actorIntents: [{ actorId: "aster", kind: "move", target: { x: 999, y: 999 }, marker: "never" }],
        homeIntents: [{ homeId: "hearth", kind: "build", marker: "never" }],
        effectIntents: [{ kind: "particle", sourceId: "aster", targetId: null }],
      }),
    }));
    expect(actor.commands).toEqual([{ kind: "set-status", status: "dead" }]);
    expect(harness.factories.homes.get("hearth")!.commands).toEqual([]);
    expect(environment.effects).toEqual([]);
    expect(harness.graph.debugSnapshot().actors[0]).toEqual(expect.objectContaining({ terminal: true, status: "dead" }));

    expect(harness.graph.update(frame({
      revision: 1,
      lastCursor: 1,
      agents: [alive],
      homes: [hearth],
      regions: harness.regions,
    })).outcome).toBe("stale");
    expect(harness.graph.debugSnapshot().actors[0]!.status).toBe("dead");
    expect(actor.disposeCalls).toBe(0);

    harness.graph.update(frame({ revision: 3, lastCursor: 3, agents: [], homes: [hearth], regions: harness.regions }));
    expect(actor.disposeCalls).toBe(1);
    expect(harness.graph.debugSnapshot().actors).toEqual([]);
  });

  it("recovers paralyzed durable state on a newer accepted frame without replacing the actor", () => {
    const paralyzed = { ...agent("aster", "alpha"), status: "paralyzed" as const };
    const harness = makeHarness({ checkpointAgents: [paralyzed] });
    harness.graph.update(frame({ agents: [paralyzed], regions: harness.regions }));
    const actor = harness.factories.actors.get("aster")!;
    const instanceId = harness.graph.debugSnapshot().actors[0]!.instanceId;

    harness.graph.update(frame({
      revision: 2,
      lastCursor: 2,
      agents: [{ ...paralyzed, status: "alive" }],
      regions: harness.regions,
    }));
    expect(actor.commands).toEqual([
      { kind: "set-status", status: "paralyzed" },
      { kind: "set-status", status: "alive" },
    ]);
    expect(harness.graph.debugSnapshot().actors[0]).toEqual(expect.objectContaining({
      instanceId,
      status: "alive",
      terminal: false,
    }));
  });

  it.each(["alive", "paralyzed"] as const)(
    "latches a projected %s contradiction after an exact terminal agent frame",
    (projectedStatus) => {
    const alive = agent("aster", "alpha");
    const factories = new TerminalStickyFactories();
    const harness = makeHarness({ checkpointAgents: [alive], factories });
    harness.graph.update(frame({ agents: [alive], regions: harness.regions }));
    const first = factories.actors.get("aster")!;
    const firstInstance = harness.graph.debugSnapshot().actors[0]!.instanceId;

    harness.graph.update(frame({
      revision: 2,
      lastCursor: 2,
      agents: [{ ...alive, status: "dead", died_at: 101 }],
      regions: harness.regions,
    }));
    expect(harness.graph.debugSnapshot().actors[0]).toEqual(expect.objectContaining({
      instanceId: firstInstance,
      status: "dead",
      terminal: true,
    }));

    harness.graph.update(frame({
      revision: 3,
      lastCursor: 3,
      agentRecords: [projected<AgentSnapshot>({ id: "aster", status: projectedStatus, died_at: null })],
      regions: harness.regions,
    }));
    expect(harness.graph.debugSnapshot().actors[0]).toEqual(expect.objectContaining({
      instanceId: firstInstance,
      status: "dead",
      terminal: true,
    }));

    expect(first.disposeCalls).toBe(0);
    },
  );

  it("latches a projected standing contradiction for an exact ruin", () => {
    const standing = home("hearth", "owner", "alpha");
    const harness = makeHarness({ checkpointHomes: [standing] });
    harness.graph.update(frame({ homes: [standing], regions: harness.regions }));
    harness.graph.update(frame({
      revision: 2,
      lastCursor: 2,
      homes: [],
      ruins: [{ ...standing, status: "ruin", integrity: 0, ruined_at: 100 }],
      regions: harness.regions,
    }));
    harness.graph.update(frame({
      revision: 3,
      lastCursor: 3,
      homeRecords: [projected<HomeSnapshot>({
        home_id: "hearth",
        status: "standing",
        integrity: 100,
        ruined_at: null,
      })],
      ruins: [],
      regions: harness.regions,
    }));

    expect(harness.graph.debugSnapshot().homes[0]).toEqual(expect.objectContaining({
      id: "hearth",
      kind: "ruin",
      status: "ruin",
    }));
  });

  it("exposes the exact durable home pixels and geometry through the capture debug seam", () => {
    const damaged = { ...home("hearth", "owner", "alpha"), integrity: 25 };
    const harness = makeHarness({ checkpointHomes: [damaged] });

    harness.graph.update(frame({ homes: [damaged], regions: harness.regions }));

    expect(harness.graph.debugSnapshot().homes[0]).toMatchObject({
      id: "hearth",
      kind: "home",
      durable: { status: "standing", integrityRatio: 0.25 },
      diagnostics: { rawIntegrity: 25, rawMaxIntegrity: 100, integrityClamped: false },
      geometry: { logicalBounds: { width: 128, height: 128 } },
    });
  });

  it("replaces a terminal actor for a newer authoritative exact alive correction", () => {
    const alive = agent("aster", "alpha");
    const factories = new TerminalStickyFactories();
    const harness = makeHarness({ checkpointAgents: [alive], factories });
    harness.graph.update(frame({ agents: [alive], regions: harness.regions }));
    const first = factories.actors.get("aster")!;
    const firstInstance = harness.graph.debugSnapshot().actors[0]!.instanceId;

    harness.graph.update(frame({
      revision: 2,
      lastCursor: 2,
      agents: [{ ...alive, status: "dead", died_at: 101 }],
      regions: harness.regions,
    }));
    harness.graph.update(frame({
      revision: 3,
      lastCursor: 3,
      agents: [alive],
      regions: harness.regions,
    }));

    const corrected = harness.graph.debugSnapshot().actors[0]!;
    expect(corrected).toEqual(expect.objectContaining({ status: "alive", terminal: false }));
    expect(corrected.instanceId).not.toBe(firstInstance);
    expect(first.disposeCalls).toBe(1);
  });

  it("keeps one environment, reconciles exact condition in place, and retains condition for partial denominators", () => {
    const harness = makeHarness();
    const first = harness.graph.update(frame({ regions: harness.regions }));
    const alpha = harness.factories.environments.get("alpha")!;
    expect(first.staticLayersInvalidated).toBe(true);

    const richer = harness.regions.map((value) => value.name === "alpha"
      ? { ...value, current_energy: 90, current_materials: 15 }
      : value);
    const second = harness.graph.update(frame({ revision: 2, lastCursor: 2, regions: richer }));
    expect(second.staticLayersInvalidated).toBe(false);
    expect(harness.factories.environmentInputs).toHaveLength(1);
    expect(alpha.conditions.at(-1)).toEqual({ energyRatio: 0.9, materialsRatio: 0.15 });

    harness.graph.update(frame({
      revision: 3,
      lastCursor: 3,
      regionRecords: [projected<RegionSnapshot>({ name: "alpha", current_energy: 0 })],
    }));
    expect(alpha.conditions.at(-1)).toEqual({ energyRatio: 0.9, materialsRatio: 0.15 });
    expect(harness.graph.debugSnapshot().activeRegion?.condition).toEqual({ energyRatio: 0.9, materialsRatio: 0.15 });
    expect(harness.graph.debugSnapshot().environments).toHaveLength(1);
  });

  it("rolls back prepared entities and placement when environment reconciliation throws", () => {
    const resident = agent("resident", "alpha");
    const newcomer = agent("newcomer", "alpha");
    const harness = makeHarness({ checkpointAgents: [resident] });
    harness.graph.update(frame({ agents: [resident], regions: harness.regions }));
    const alpha = harness.factories.environments.get("alpha")!;
    const placementBefore = harness.placement.snapshot();
    const graphBefore = harness.graph.debugSnapshot();
    alpha.throwOnNextReconcile = true;
    const richer = harness.regions.map((value) => value.name === "alpha"
      ? { ...value, current_energy: 90, current_materials: 15 }
      : value);
    const next = frame({
      revision: 2,
      lastCursor: 2,
      agents: [resident, newcomer],
      regions: richer,
    });

    expect(() => harness.graph.update(next)).toThrow(/environment reconcile alpha/);
    expect(harness.placement.snapshot()).toEqual(placementBefore);
    expect(harness.graph.debugSnapshot()).toEqual(graphBefore);
    expect(harness.factories.actors.get(newcomer.id)?.disposeCalls).toBe(1);

    expect(harness.graph.update(next).outcome).toBe("applied");
    expect(harness.graph.debugSnapshot()).toMatchObject({
      identity: { revision: 2 },
      ownership: { actors: { created: 2, disposed: 0, outstanding: 2 } },
      activeRegion: { condition: { energyRatio: 0.9, materialsRatio: 0.15 } },
    });
  });

  it("atomically replaces the sole visible environment and invalidates static layers on a Story region change", () => {
    const harness = makeHarness();
    harness.graph.update(frame({ regions: harness.regions }));
    const alpha = harness.factories.environments.get("alpha")!;

    const switched = harness.graph.update(frame({
      revision: 2,
      lastCursor: 2,
      regions: harness.regions,
      scene: scene("beta"),
    }));
    expect(switched.staticLayersInvalidated).toBe(true);
    expect(alpha.disposeCalls).toBe(1);
    expect(harness.graph.debugSnapshot().activeRegion?.id).toBe("beta");
    expect(harness.graph.debugSnapshot().environments).toHaveLength(1);
    expect(harness.factories.environments.get("beta")!.disposeCalls).toBe(0);
  });

  it("C05 keeps durable actor identities dormant across Story A to B to A while homes stay region-owned", () => {
    const alphaActors = [agent("alpha-one", "alpha"), agent("alpha-two", "alpha")];
    const betaActors = [agent("beta-one", "beta"), agent("beta-two", "beta")];
    const actors = [...alphaActors, ...betaActors];
    const alphaHome = home("alpha-hearth", "alpha-one", "alpha");
    const betaHome = home("beta-hearth", "beta-one", "beta");
    const homes = [alphaHome, betaHome];
    const harness = makeHarness({ checkpointAgents: actors, checkpointHomes: homes });

    expect(harness.graph.update(frame({
      agents: actors,
      homes,
      regions: harness.regions,
      scene: null,
    })).outcome).toBe("applied");
    const firstAlpha = alphaActors.map(({ id }) => harness.factories.actors.get(id)!);
    const firstAlphaInstanceIds = harness.graph.debugSnapshot().actors
      .map(({ id, instanceId }) => [id, instanceId] as const);
    const firstAlphaHome = harness.factories.homes.get(alphaHome.home_id)!;
    firstAlpha[0]!.deadline = 10;
    firstAlpha[1]!.deadline = 20;

    expect(harness.graph.update(frame({
      revision: 2,
      lastCursor: 2,
      agents: actors,
      homes,
      regions: harness.regions,
      scene: scene("beta"),
    })).outcome).toBe("applied");
    const betaActorValues = betaActors.map(({ id }) => harness.factories.actors.get(id)!);
    const betaHomeValue = harness.factories.homes.get(betaHome.home_id)!;
    betaActorValues[0]!.deadline = 100;
    betaActorValues[1]!.deadline = 120;
    betaHomeValue.deadline = 110;

    expect(harness.graph.debugSnapshot()).toMatchObject({
      activeRegion: { id: "beta" },
      actors: [
        expect.objectContaining({ id: "beta-one" }),
        expect.objectContaining({ id: "beta-two" }),
      ],
      homes: [expect.objectContaining({ id: "beta-hearth" })],
      ownership: {
        actors: { created: 4, disposed: 0, outstanding: 4, peak: 4 },
        homes: { created: 2, disposed: 1, outstanding: 1, peak: 2 },
      },
    });
    expect(firstAlpha.every(({ disposeCalls }) => disposeCalls === 0)).toBe(true);
    expect(firstAlphaHome.disposeCalls).toBe(1);
    expect(harness.graph.nextDeadlineMs()).toBe(100);
    harness.graph.updateTime(1, 50);
    expect(firstAlpha.every(({ advances }) => advances.length === 0)).toBe(true);
    expect(betaActorValues.every(({ advances }) => advances.length === 1)).toBe(true);

    harness.factories.drawTrace.length = 0;
    harness.graph.draw({} as CanvasRenderingContext2D);
    expect(harness.factories.drawTrace).toEqual(expect.arrayContaining([
      "environment:beta:ground",
      "home:beta-hearth:back",
      "actor:beta-one",
      "actor:beta-two",
      "home:beta-hearth:front",
      "environment:beta:air",
    ]));
    expect(harness.factories.drawTrace.some((entry) => entry.includes("alpha"))).toBe(false);
    expect(harness.graph.hitTargets().map(({ selectionKey }) => selectionKey).sort()).toEqual([
      "agent:beta-one", "agent:beta-two", "home:beta-hearth", "region:beta",
    ]);
    expect(harness.graph.semanticSnapshot().subjects.map(({ stableSelectionKey }) => stableSelectionKey).sort()).toEqual([
      "agent:beta-one", "agent:beta-two", "home:beta-hearth", "region:beta",
    ]);
    expect(harness.graph.focusTarget({ kind: "agent", id: "alpha-one" })).toBeNull();
    expect(harness.graph.focusTarget({ kind: "home", id: "alpha-hearth" })).toBeNull();

    expect(harness.graph.update(frame({
      revision: 3,
      lastCursor: 3,
      agents: actors,
      homes,
      regions: harness.regions,
      scene: null,
    })).outcome).toBe("applied");
    expect(harness.graph.debugSnapshot()).toMatchObject({
      activeRegion: { id: "beta" },
      actors: [
        expect.objectContaining({ id: "beta-one" }),
        expect.objectContaining({ id: "beta-two" }),
      ],
    });
    expect(harness.factories.actorInputs).toHaveLength(4);

    expect(harness.graph.update(frame({
      revision: 4,
      lastCursor: 4,
      agents: actors,
      homes,
      regions: harness.regions,
      scene: scene("alpha"),
    })).outcome).toBe("applied");
    expect(harness.graph.debugSnapshot().actors.map(({ id, instanceId }) => [id, instanceId] as const))
      .toEqual(firstAlphaInstanceIds);
    expect(harness.factories.actorInputs).toHaveLength(4);
    expect(harness.factories.homeInputs).toHaveLength(3);
    expect(harness.factories.homes.get(alphaHome.home_id)!.instanceId).not.toBe(firstAlphaHome.instanceId);
    expect(betaActorValues.every(({ disposeCalls }) => disposeCalls === 0)).toBe(true);
    expect(betaHomeValue.disposeCalls).toBe(1);

    harness.graph.dispose();
    expect([...firstAlpha, ...betaActorValues].every(({ disposeCalls }) => disposeCalls === 1)).toBe(true);
    expect(harness.graph.debugSnapshot().ownership).toEqual({
      actors: { created: 4, disposed: 4, outstanding: 0, peak: 4 },
      homes: { created: 3, disposed: 3, outstanding: 0, peak: 2 },
      environments: { created: 3, disposed: 3, outstanding: 0, peak: 2 },
    });
  });

  it.each([
    ["durable absence", "absence"],
    ["an exact malformed durable record", "malformed"],
    ["an explicit observer-region override", "observer"],
  ] as const)("bounds a dormant Story actor on %s", (_label, cause) => {
    const alphaActor = agent("alpha-one", "alpha");
    const betaActor = agent("beta-one", "beta");
    const harness = makeHarness({ checkpointAgents: [alphaActor, betaActor] });
    harness.graph.update(frame({
      agents: [alphaActor, betaActor],
      regions: harness.regions,
      scene: null,
    }));
    const actorValue = harness.factories.actors.get(alphaActor.id)!;

    harness.graph.update(frame({
      revision: 2,
      lastCursor: 2,
      agents: cause === "malformed" ? undefined : cause === "absence"
        ? [betaActor]
        : [alphaActor, betaActor],
      agentRecords: cause === "malformed"
        ? [exact({ id: alphaActor.id } as AgentSnapshot), exact(betaActor)]
        : undefined,
      regions: harness.regions,
      scene: scene("beta"),
    }), null, cause === "observer" ? "beta" : null);

    expect(actorValue.disposeCalls).toBe(1);
    expect(harness.graph.debugSnapshot()).toMatchObject({
      actors: [expect.objectContaining({ id: betaActor.id })],
      ownership: { actors: { created: 2, disposed: 1, outstanding: 1, peak: 2 } },
    });
  });

  it("prefers the active checkpoint focus region over retained Story scene ownership", () => {
    const harness = makeHarness();
    const focused = {
      ...frame({ regions: harness.regions, scene: scene("alpha") }),
      checkpointFocus: {
        regionId: "beta",
        kind: "region" as const,
        entityId: null,
        segmentIndex: 0,
        segmentCount: 1,
        removed: true,
      },
    } satisfies PresentedObserverFrame;

    expect(harness.graph.update(focused).outcome).toBe("applied");
    expect(harness.graph.debugSnapshot().activeRegion?.id).toBe("beta");
  });

  it("advances a hidden mover only while a validated retained-traveler contract owns it", () => {
    const runCase = (retained: boolean): Readonly<{
      actor: FakeActor;
      deadline: number | null;
      activationAdvances: readonly (readonly [number, number])[];
    }> => {
      const alphaActor = agent(retained ? "retained" : "ordinary", "alpha");
      const betaActor = agent("beta-one", "beta");
      const harness = makeHarness({ checkpointAgents: [alphaActor, betaActor] });
      const accepted = frame({ agents: [alphaActor, betaActor], regions: harness.regions });
      harness.graph.update(accepted);
      const actorValue = harness.factories.actors.get(alphaActor.id)!;
      actorValue.deadline = 25;
      const commands = [
        ...(retained ? [{
          kind: "retain-traveler" as const,
          commandId: "retain:hidden-time",
          actorId: alphaActor.id,
          fromRegion: "alpha",
          toRegion: "beta",
        }] : []),
        {
          kind: "actor" as const,
          commandId: "move:hidden-time",
          actorId: alphaActor.id,
          command: {
            kind: "move" as const,
            waypoints: [{ x: 500, y: 500 }],
            speedPixelsPerSecond: 30,
            gait: "walk" as const,
          },
        },
      ];
      expect(harness.graph.applySceneCommands({
        identity: identityOf(accepted),
        sceneToken: 91,
        commands,
      }, 0).outcome).toBe("applied");
      harness.graph.update(frame({
        revision: 2,
        lastCursor: 2,
        agents: [alphaActor, betaActor],
        regions: harness.regions,
        scene: scene("beta"),
      }));
      expect(harness.graph.debugSnapshot().actors.map(({ id }) => id)).toEqual([betaActor.id]);
      const deadline = harness.graph.nextDeadlineMs();
      harness.graph.updateTime(0.5, 10);
      const activationAdvances = [...actorValue.advances];
      harness.graph.updateTime(0.5, 20);
      return { actor: actorValue, deadline, activationAdvances };
    };

    const ordinary = runCase(false);
    expect(ordinary.deadline).toBeNull();
    expect(ordinary.activationAdvances).toEqual([]);
    expect(ordinary.actor.advances).toEqual([]);

    const retained = runCase(true);
    expect(retained.deadline).toBeCloseTo(1_000 / 60, 10);
    expect(retained.activationAdvances).toEqual([]);
    expect(retained.actor.advances).toEqual([[0.5, 20]]);
  });

  it("keeps the idle-to-move observation fence across a scene reset before the first draw", () => {
    const traveler = agent("traveler", "alpha");
    const factories = new RealPersonMarkerFactories();
    const harness = makeHarness({ checkpointAgents: [traveler], factories });
    const accepted = frame({ agents: [traveler], regions: harness.regions });
    harness.graph.update(accepted);
    const actor = factories.realActors.get(traveler.id)!;
    const start = actor.snapshot().position;

    expect(harness.graph.applySceneCommands({
      identity: identityOf(accepted),
      sceneToken: 1,
      commands: [{
        kind: "actor",
        commandId: "move:before-reset",
        actorId: traveler.id,
        command: {
          kind: "move",
          waypoints: [{ x: start.x, y: start.y + 96 }],
          speedPixelsPerSecond: 48,
          gait: "walk",
        },
      }],
    }, 0).outcome).toBe("applied");
    expect(harness.graph.applySceneCommands({
      identity: identityOf(accepted),
      sceneToken: 2,
      commands: [{ kind: "clear-scene", commandId: "reset:before-draw" }],
    }, 0).outcome).toBe("applied");

    harness.graph.updateTime(1 / 30, 1_000 / 30);
    expect(actor.snapshot()).toMatchObject({ position: start, activeAction: "moving" });
    harness.graph.updateTime(1 / 30, 2_000 / 30);
    expect(actor.snapshot().position.y - start.y).toBeCloseTo(1.6, 10);
  });

  it("stops retained hidden timing when a later actor command cancels the route", () => {
    const traveler = agent("traveler", "alpha");
    const resident = agent("resident", "beta");
    const factories = new RealPersonMarkerFactories();
    const harness = makeHarness({ checkpointAgents: [traveler, resident], factories });
    const accepted = frame({ agents: [traveler, resident], regions: harness.regions });
    harness.graph.update(accepted);
    const actor = factories.realActors.get(traveler.id)!;
    const start = actor.snapshot().position;

    expect(harness.graph.applySceneCommands({
      identity: identityOf(accepted),
      sceneToken: 3,
      commands: [{
        kind: "retain-traveler",
        commandId: "retain:cancelled",
        actorId: traveler.id,
        fromRegion: "alpha",
        toRegion: "beta",
      }, {
        kind: "actor",
        commandId: "move:cancelled",
        actorId: traveler.id,
        command: {
          kind: "move",
          waypoints: [{ x: start.x, y: start.y + 96 }],
          speedPixelsPerSecond: 48,
          gait: "walk",
        },
      }, {
        kind: "actor",
        commandId: "work:cancels-route",
        actorId: traveler.id,
        command: { kind: "play-body", action: "work" },
      }],
    }, 0).outcome).toBe("applied");
    expect(actor.snapshot()).toMatchObject({ activeAction: "working" });

    harness.graph.update(frame({
      revision: 2,
      lastCursor: 2,
      agents: [traveler, resident],
      regions: harness.regions,
      scene: scene("beta"),
    }));
    expect(harness.graph.debugSnapshot().actors.map(({ id }) => id)).toEqual([resident.id]);
    harness.graph.updateTime(1, 1_000);
    harness.graph.updateTime(2, 3_000);
    expect(actor.snapshot()).toMatchObject({ position: start, activeAction: "working" });
  });

  it("ignores paralyzed locomotion/body commands without stealing recovery signal ownership", () => {
    const paralyzed = { ...agent("paralyzed", "alpha"), status: "paralyzed" as const };
    const factories = new RealPersonMarkerFactories();
    const harness = makeHarness({ checkpointAgents: [paralyzed], factories });
    const accepted = frame({ agents: [paralyzed], regions: harness.regions });
    harness.graph.update(accepted);
    const actor = factories.realActors.get(paralyzed.id)!;
    const start = actor.snapshot().position;

    expect(harness.graph.applySceneCommands({
      identity: identityOf(accepted),
      sceneToken: 4,
      commands: [
        {
          kind: "actor",
          commandId: "move:ignored-paralyzed",
          actorId: paralyzed.id,
          command: {
            kind: "move",
            waypoints: [{ x: start.x, y: start.y + 96 }],
            speedPixelsPerSecond: 48,
            gait: "walk",
          },
        },
        {
          kind: "actor",
          commandId: "orient:ignored-paralyzed",
          actorId: paralyzed.id,
          command: { kind: "orient", facing: "north" },
        },
        {
          kind: "actor",
          commandId: "body:ignored-paralyzed",
          actorId: paralyzed.id,
          command: { kind: "play-body", action: "work" },
        },
      ],
    }, 0)).toEqual({
      outcome: "ignored",
      appliedCommandIds: [],
      ignoredCommandIds: [
        "move:ignored-paralyzed",
        "orient:ignored-paralyzed",
        "body:ignored-paralyzed",
      ],
      rejections: [
        expect.objectContaining({ commandId: "move:ignored-paralyzed", reason: "paralyzed" }),
        expect.objectContaining({ commandId: "orient:ignored-paralyzed", reason: "paralyzed" }),
        expect.objectContaining({ commandId: "body:ignored-paralyzed", reason: "paralyzed" }),
      ],
    });

    expect(actor.snapshot()).toMatchObject({ position: start, activeAction: "prone" });
    expect(harness.graph.sceneSignals()).toEqual([]);

    expect(harness.graph.applySceneCommands({
      identity: identityOf(accepted),
      sceneToken: 4,
      commands: [{
        kind: "actor",
        commandId: "recover:allowed-paralyzed",
        actorId: paralyzed.id,
        command: { kind: "recover" },
      }],
    }, 0)).toMatchObject({
      outcome: "applied",
      appliedCommandIds: ["recover:allowed-paralyzed"],
      ignoredCommandIds: [],
    });
    for (const nowMs of [121, 241, 361, 481, 601, 721]) {
      harness.graph.updateTime(0.12, nowMs);
    }
    expect(actor.snapshot()).toMatchObject({ position: start, activeAction: null });
    expect(harness.graph.sceneSignals()).toEqual([
      expect.objectContaining({
        sceneToken: 4,
        commandId: "recover:allowed-paralyzed",
        subjectId: paralyzed.id,
        marker: "recovery-contact",
      }),
    ]);
  });

  it("preserves one initial fence across a repeated move replacement and no extra fence in flight", () => {
    const traveler = agent("traveler", "alpha");
    const factories = new RealPersonMarkerFactories();
    const harness = makeHarness({ checkpointAgents: [traveler], factories });
    const accepted = frame({ agents: [traveler], regions: harness.regions });
    harness.graph.update(accepted);
    const actor = factories.realActors.get(traveler.id)!;
    const start = actor.snapshot().position;
    const move = (commandId: string, targetY: number) => ({
      identity: identityOf(accepted),
      sceneToken: 5,
      commands: [{
        kind: "actor" as const,
        commandId,
        actorId: traveler.id,
        command: {
          kind: "move" as const,
          waypoints: [{ x: start.x, y: targetY }],
          speedPixelsPerSecond: 48,
          gait: "walk" as const,
        },
      }],
    });

    harness.graph.applySceneCommands(move("move:first", start.y + 96), 0);
    harness.graph.applySceneCommands(move("move:replacement-before-draw", start.y + 64), 0);
    harness.graph.updateTime(1 / 30, 1_000 / 30);
    expect(actor.snapshot().position).toEqual(start);
    harness.graph.updateTime(1 / 30, 2_000 / 30);
    expect(actor.snapshot().position.y - start.y).toBeCloseTo(1.6, 10);

    const beforeInFlightReplacement = actor.snapshot().position;
    harness.graph.applySceneCommands(move("move:replacement-in-flight", start.y + 128), 2_000 / 30);
    harness.graph.updateTime(1 / 30, 3_000 / 30);
    expect(actor.snapshot().position.y - beforeInFlightReplacement.y).toBeCloseTo(1.6, 10);
  });

  it("clears pending mover scheduling when durable truth becomes terminal", () => {
    const traveler = agent("traveler", "alpha");
    const factories = new RealPersonMarkerFactories();
    const harness = makeHarness({ checkpointAgents: [traveler], factories });
    const accepted = frame({ agents: [traveler], regions: harness.regions });
    harness.graph.update(accepted);
    const actor = factories.realActors.get(traveler.id)!;
    const start = actor.snapshot().position;
    harness.graph.applySceneCommands({
      identity: identityOf(accepted),
      sceneToken: 6,
      commands: [{
        kind: "actor",
        commandId: "move:before-death",
        actorId: traveler.id,
        command: {
          kind: "move",
          waypoints: [{ x: start.x, y: start.y + 96 }],
          speedPixelsPerSecond: 48,
          gait: "walk",
        },
      }],
    }, 0);

    harness.graph.update(frame({
      revision: 2,
      lastCursor: 2,
      agents: [{ ...traveler, status: "dead", died_at: 1 }],
      regions: harness.regions,
    }));

    expect(actor.snapshot()).toMatchObject({ position: start, activeAction: "dead", routeActive: false });
    expect(harness.graph.nextDeadlineMs()).toBeNull();
  });

  it("clears per-actor command, hit-stop, and fallback state before same-scene reappearance", () => {
    const aster = agent("aster", "alpha");
    const harness = makeHarness({ checkpointAgents: [aster] });
    const accepted = frame({ agents: [aster], regions: harness.regions });
    harness.graph.update(accepted);
    const first = harness.factories.actors.get(aster.id)!;
    const fallbackTarget = tileCenter(harness.recipes.get("alpha")!.stagingAnchors[0]!);

    expect(harness.graph.applySceneCommands({
      identity: identityOf(accepted),
      sceneToken: 7,
      commands: [
        {
          kind: "actor",
          commandId: "old:fallback-binding",
          actorId: aster.id,
          command: { kind: "reposition", position: fallbackTarget, reason: "fallback" },
        },
        {
          kind: "hit-stop",
          commandId: "old:hit-stop",
          actorIds: [aster.id],
          durationMs: 80,
        },
      ],
    }, 0)).toMatchObject({ outcome: "applied" });

    harness.graph.update(frame({
      revision: 2,
      lastCursor: 2,
      agents: [],
      regions: harness.regions,
    }));
    expect(first.disposeCalls).toBe(1);
    expect(harness.graph.debugSnapshot().actors).toEqual([]);

    const reappearedFrame = frame({
      revision: 3,
      lastCursor: 3,
      agents: [aster],
      regions: harness.regions,
    });
    harness.graph.update(reappearedFrame);
    const reappeared = harness.factories.actors.get(aster.id)!;
    expect(reappeared).not.toBe(first);

    harness.graph.updateTime(0.01, 10);
    expect(reappeared.advances).toEqual([[0.01, 10]]);
    expect(harness.graph.sceneSignals()).toEqual([]);

    expect(harness.graph.applySceneCommands({
      identity: identityOf(reappearedFrame),
      sceneToken: 7,
      commands: [{
        kind: "actor",
        commandId: "new:fallback",
        actorId: aster.id,
        command: { kind: "reposition", position: fallbackTarget, reason: "fallback" },
      }],
    }, 10)).toMatchObject({
      outcome: "applied",
      appliedCommandIds: ["new:fallback"],
      ignoredCommandIds: [],
    });
  });

  it("accepts a same-identity Story region change as a new visible projection", () => {
    const alphaActor = agent("alpha-one", "alpha");
    const betaActor = agent("beta-one", "beta");
    const harness = makeHarness({ checkpointAgents: [alphaActor, betaActor] });
    const accepted = frame({
      agents: [alphaActor, betaActor],
      regions: harness.regions,
      scene: scene("alpha"),
    });
    expect(harness.graph.update(accepted).outcome).toBe("applied");

    const switched = harness.graph.update({ ...accepted, scene: scene("beta") });
    expect(switched.outcome).toBe("applied");
    expect(harness.graph.debugSnapshot()).toMatchObject({
      identity: identityOf(accepted),
      activeRegion: { id: "beta" },
      actors: [expect.objectContaining({ id: betaActor.id })],
    });
  });

  it("RED residual: owns remote portrait and atlas transients until clear then disposes them once", () => {
    const aster = agent("aster", "alpha");
    const harness = makeHarness({ checkpointAgents: [aster] });
    const accepted = frame({ agents: [aster], regions: harness.regions });
    harness.graph.update(accepted);
    harness.graph.applySceneCommands({
      identity: identityOf(accepted),
      sceneToken: 80,
      commands: [
        { kind: "remote-transient", commandId: "portrait", motif: "portrait", sourceId: "aster", targetId: "remote", at: harness.placement.snapshot().agents.get("aster")!.point },
        { kind: "remote-transient", commandId: "atlas", motif: "atlas", sourceId: "alpha", targetId: "beta", at: null },
        { kind: "remote-transient", commandId: "vignette", motif: "vignette", sourceId: "aster", targetId: null, at: harness.placement.snapshot().agents.get("aster")!.point },
      ],
    } as never, 10);

    expect((harness.graph.debugSnapshot() as unknown as { transients: readonly unknown[] }).transients).toHaveLength(3);
    const pixels: Array<readonly [number, number, number, number]> = [];
    const context = {
      save: vi.fn(),
      restore: vi.fn(),
      fillRect: vi.fn((x: number, y: number, width: number, height: number) => {
        pixels.push([x, y, width, height]);
      }),
      strokeRect: vi.fn(),
      set fillStyle(_value: string) {},
      set strokeStyle(_value: string) {},
      set globalAlpha(_value: number) {},
      set lineWidth(_value: number) {},
    } as unknown as CanvasRenderingContext2D;
    harness.graph.draw(context);
    expect(pixels.length).toBeGreaterThanOrEqual(6);
    expect(pixels.every(([, , width, height]) => width > 0 && height > 0 && width <= 32 && height <= 32)).toBe(true);
    harness.graph.applySceneCommands({
      identity: identityOf(accepted),
      sceneToken: 80,
      commands: [{ kind: "clear-scene", commandId: "clear" }],
    }, 20);
    expect((harness.graph.debugSnapshot() as unknown as { transients: readonly unknown[] }).transients).toEqual([]);
    const drawnBeforeClear = pixels.length;
    harness.graph.draw(context);
    expect(pixels).toHaveLength(drawnBeforeClear);
  });

  it("RED residual: consumes a matching birth hint once beside acceptor and uses staging fallback remotely", () => {
    const acceptor = agent("acceptor", "alpha");
    const child = agent("child", "alpha");
    const remote = agent("remote-child", "beta");
    const harness = makeHarness({ checkpointAgents: [acceptor] });
    const initial = frame({ agents: [acceptor], regions: harness.regions });
    harness.graph.update(initial);
    const acceptorPoint = harness.placement.snapshot().agents.get(acceptor.id)!.point;
    const birth = frame({
      revision: 2,
      lastCursor: 2,
      agents: [acceptor, child],
      regions: harness.regions,
    });
    const birthHint = {
      identity: identityOf(birth),
      sceneToken: 81,
      commands: [{
        kind: "placement-hint",
        commandId: "birth-hint",
        agentId: child.id,
        context: { kind: "birth", acceptorId: acceptor.id, authoritativeColocation: true },
      }],
    };
    harness.graph.update(birth, birthHint as never);
    const childPlacement = harness.placement.snapshot().agents.get(child.id)!;
    expect(childPlacement.anchorKind).toBe(`birth:${acceptor.id}`);
    expectBirthPlacementToBeNearbyAndReadable(acceptorPoint, childPlacement.point);

    const duplicate = harness.graph.update(frame({
      revision: 3,
      lastCursor: 3,
      agents: [acceptor, child],
      regions: harness.regions,
    }), birthHint as never);
    expect(duplicate.outcome).toBe("applied");
    expect(harness.placement.snapshot().agents.get(child.id)).toEqual(childPlacement);

    const remoteFrame = frame({
      revision: 4,
      lastCursor: 4,
      agents: [remote],
      regions: harness.regions,
      scene: scene("beta"),
    });
    harness.graph.update(remoteFrame, {
      identity: identityOf(remoteFrame), sceneToken: 82, commands: [{
        kind: "placement-hint", commandId: "remote-birth", agentId: remote.id,
        context: { kind: "birth", acceptorId: acceptor.id, authoritativeColocation: false },
      }],
    } as never);
    expect(harness.placement.snapshot().agents.get(remote.id)?.anchorKind).toBe("birth-fallback");
  });

  it("reanchors a projected newborn once beside its acceptor and rolls actor plus ledger back atomically", () => {
    const acceptor = agent("acceptor", "alpha");
    const alternate = agent("alternate", "alpha");
    const sentinel = agent("sentinel", "alpha");
    const child = agent("child", "alpha");
    const harness = makeHarness({ checkpointAgents: [acceptor, alternate, sentinel] });
    harness.graph.update(frame({
      agents: [acceptor, alternate, sentinel],
      regions: harness.regions,
    }));
    const prebirth = frame({
      revision: 2,
      lastCursor: 2,
      agentRecords: [exact(acceptor), exact(alternate), exact(sentinel), projected(child)],
      regions: harness.regions,
    });
    harness.graph.update(prebirth);
    const childActor = harness.factories.actors.get(child.id)!;
    const instanceId = childActor.instanceId;
    const staging = harness.placement.snapshot().agents.get(child.id)!;
    expect(staging.anchorKind).toBe("staging");
    expect(childActor.snapshot().position).toEqual(staging.point);

    const consequence = frame({
      revision: 3,
      lastCursor: 3,
      agentRecords: [
        exact(acceptor),
        exact(alternate),
        exact({ ...sentinel, status: "dead" }),
        projected(child),
      ],
      regions: harness.regions,
    });
    const birthHint = {
      identity: identityOf(consequence),
      sceneToken: 82,
      commands: [{
        kind: "placement-hint",
        commandId: "delayed-birth-hint",
        agentId: child.id,
        context: { kind: "birth", acceptorId: acceptor.id, authoritativeColocation: true },
      }],
    } as const;
    harness.factories.actors.get(sentinel.id)!.throwOnNextApply = true;
    expect(() => harness.graph.applyFrame!(consequence, birthHint as never, 100))
      .toThrow(/actor command sentinel/);
    expect(harness.placement.snapshot().agents.get(child.id)).toEqual(staging);
    expect(childActor.snapshot()).toMatchObject({ instanceId, position: staging.point });

    expect(harness.graph.applyFrame!(consequence, birthHint as never, 100)).toMatchObject({
      outcome: "accepted",
      commands: {
        outcome: "applied",
        appliedCommandIds: ["delayed-birth-hint"],
      },
    });
    const acceptorPoint = harness.placement.snapshot().agents.get(acceptor.id)!.point;
    const born = harness.placement.snapshot().agents.get(child.id)!;
    expect(born.anchorKind).toBe(`birth:${acceptor.id}`);
    expectBirthPlacementToBeNearbyAndReadable(acceptorPoint, born.point);
    expect(harness.factories.actors.get(child.id)).toBe(childActor);
    expect(childActor.snapshot()).toMatchObject({ instanceId, position: born.point });

    const replay = frame({
      revision: 4,
      lastCursor: 4,
      agentRecords: [exact(acceptor), exact(alternate), exact(sentinel), projected(child)],
      regions: harness.regions,
    });
    harness.graph.update(replay, {
      identity: identityOf(replay),
      sceneToken: 83,
      commands: [{
        kind: "placement-hint",
        commandId: "second-birth-hint",
        agentId: child.id,
        context: { kind: "birth", acceptorId: alternate.id, authoritativeColocation: true },
      }],
    } as never);
    expect(harness.placement.snapshot().agents.get(child.id)).toEqual(born);
    expect(childActor.snapshot()).toMatchObject({ instanceId, position: born.point });
  });

  it("reanchors an exact newborn that was live-staged before its exact birth consequence", () => {
    const acceptor = agent("acceptor", "alpha");
    const child = agent("exact-child", "alpha");
    const harness = makeHarness({ checkpointAgents: [acceptor] });
    harness.graph.update(frame({ agents: [acceptor], regions: harness.regions }));

    harness.graph.update(frame({
      revision: 2,
      lastCursor: 2,
      agents: [acceptor, child],
      regions: harness.regions,
    }));
    const actor = harness.factories.actors.get(child.id)!;
    const instanceId = actor.instanceId;
    const staging = harness.placement.snapshot().agents.get(child.id)!;
    expect(staging.anchorKind).toBe("staging");

    const consequence = frame({
      revision: 3,
      lastCursor: 3,
      agents: [acceptor, child],
      regions: harness.regions,
    });
    expect(harness.graph.applyFrame!(consequence, {
      identity: identityOf(consequence),
      sceneToken: 86,
      commands: [{
        kind: "placement-hint",
        commandId: "exact-birth-hint",
        agentId: child.id,
        context: { kind: "birth", acceptorId: acceptor.id, authoritativeColocation: true },
      }],
    } as never, 100)).toMatchObject({ outcome: "accepted" });

    const acceptorPoint = harness.placement.snapshot().agents.get(acceptor.id)!.point;
    const born = harness.placement.snapshot().agents.get(child.id)!;
    expect(born.anchorKind).toBe(`birth:${acceptor.id}`);
    expectBirthPlacementToBeNearbyAndReadable(acceptorPoint, born.point);
    expect(harness.factories.actors.get(child.id)).toBe(actor);
    expect(actor.snapshot()).toMatchObject({ instanceId, position: born.point });
  });

  it("never reanchors an exact established actor for a birth hint and ignores a mismatched hint", () => {
    const acceptor = agent("acceptor", "alpha");
    const established = agent("established", "alpha");
    const harness = makeHarness({ checkpointAgents: [acceptor, established] });
    const initial = frame({ agents: [acceptor, established], regions: harness.regions });
    harness.graph.update(initial);
    const actor = harness.factories.actors.get(established.id)!;
    const instanceId = actor.instanceId;
    const before = harness.placement.snapshot().agents.get(established.id)!;

    const hinted = frame({
      revision: 2,
      lastCursor: 2,
      agents: [acceptor, established],
      regions: harness.regions,
    });
    harness.graph.update(hinted, {
      identity: identityOf(hinted),
      sceneToken: 84,
      commands: [{
        kind: "placement-hint",
        commandId: "established-birth-hint",
        agentId: established.id,
        context: { kind: "birth", acceptorId: acceptor.id, authoritativeColocation: true },
      }],
    } as never);
    expect(harness.placement.snapshot().agents.get(established.id)).toEqual(before);
    expect(actor.snapshot()).toMatchObject({ instanceId, position: before.point });

    const mismatched = frame({
      revision: 3,
      lastCursor: 3,
      agents: [acceptor, established],
      regions: harness.regions,
    });
    harness.graph.update(mismatched, {
      identity: identityOf(mismatched),
      sceneToken: 85,
      commands: [{
        kind: "placement-hint",
        commandId: "mismatched-birth-hint",
        agentId: established.id,
        context: { kind: "birth", acceptorId: established.id, authoritativeColocation: true },
      }],
    } as never);
    expect(harness.placement.snapshot().agents.get(established.id)).toEqual(before);
    expect(actor.snapshot()).toMatchObject({ instanceId, position: before.point });
  });

  it("RED residual: retains one traveller instance across atlas and adopts exact directed arrival placement", () => {
    const traveler = agent("traveler", "alpha");
    const harness = makeHarness({ checkpointAgents: [traveler] });
    const initial = frame({ agents: [traveler], regions: harness.regions });
    harness.graph.update(initial);
    const instanceId = harness.graph.debugSnapshot().actors[0]!.instanceId;
    harness.graph.applySceneCommands({
      identity: identityOf(initial),
      sceneToken: 90,
      commands: [{
        kind: "retain-traveler", commandId: "retain", actorId: traveler.id,
        fromRegion: "alpha", toRegion: "beta",
      }],
    } as never, 0);

    const atlas = frame({
      revision: 2,
      lastCursor: 2,
      agents: [traveler],
      regions: harness.regions,
      scene: scene("beta", {
        momentId: "atlas-arrival",
        phase: "hold",
        execution: {
          sceneToken: 90,
          programId: "choreography:atlas-arrival:agent_entered_region",
          eventType: "agent_entered_region",
        },
        effectIntents: [{ kind: "atlas-transition", sourceId: "alpha", targetId: "beta" }],
      }),
    });
    harness.graph.applyFrame!(atlas, {
      identity: identityOf(atlas), sceneToken: 90, commands: [
        { kind: "retain-traveler", commandId: "retain", actorId: traveler.id, fromRegion: "alpha", toRegion: "beta" },
        {
          kind: "stage-arrival", commandId: "stage:atlas-arrival", actorId: traveler.id,
          fromRegion: "alpha", toRegion: "beta", eventType: "agent_entered_region",
          phase: "hold", momentId: "atlas-arrival",
          programId: "choreography:atlas-arrival:agent_entered_region",
        },
      ],
    }, 100);
    expect(harness.graph.debugSnapshot().actors).toContainEqual(expect.objectContaining({
      id: traveler.id, instanceId,
    }));
    expect(harness.graph.debugSnapshot().environments).toHaveLength(1);

    const arrivedAgent = { ...traveler, position: "beta" };
    const consequence = frame({
      revision: 3,
      lastCursor: 3,
      agents: [arrivedAgent],
      regions: harness.regions,
      scene: scene("beta", {
        momentId: "atlas-arrival",
        phase: "consequence",
        execution: {
          sceneToken: 90,
          programId: "choreography:atlas-arrival:agent_entered_region",
          eventType: "agent_entered_region",
        },
      }),
    });
    const arrivalGate = harness.recipes.get("beta")!.gates.find((gate) => (
      gate.role === "arrival" && gate.edge.from === "alpha" && gate.edge.to === "beta"
    ))!;
    harness.graph.update(consequence, {
      identity: identityOf(consequence), sceneToken: 90, commands: [{
        kind: "placement-hint", commandId: "arrival", agentId: traveler.id,
        context: { kind: "arrival", fromRegion: "alpha" },
        arrivalGate: tileCenter(arrivalGate.tile), requestedFinal: { x: 999, y: 999 },
      }],
    } as never);
    const finalPlacement = harness.placement.snapshot().agents.get(traveler.id)!;
    expect(finalPlacement.anchorKind).toBe("arrival:alpha");
    expect(harness.graph.debugSnapshot().actors[0]).toMatchObject({
      id: traveler.id,
      instanceId,
    });
  });

  it("retains but does not show or stage a traveler in a destination enter frame without hold authorization", () => {
    const traveler = agent("traveler", "alpha");
    const harness = makeHarness({ checkpointAgents: [traveler] });
    const initial = frame({ agents: [traveler], regions: harness.regions });
    harness.graph.update(initial);
    const actor = harness.factories.actors.get(traveler.id)!;
    const sourcePosition = actor.snapshot().position;
    const destinationScene = frame({
      revision: 2,
      lastCursor: 2,
      agents: [traveler],
      regions: harness.regions,
      scene: scene("beta", {
        phase: "enter",
        execution: {
          sceneToken: 91,
          programId: "choreography:travel:agent_entered_region",
          eventType: "agent_entered_region",
        },
      }),
    });
    const result = harness.graph.applyFrame!(destinationScene, {
      identity: identityOf(destinationScene),
      sceneToken: 91,
      commands: [{
        kind: "retain-traveler",
        commandId: "retain:before-switch",
        actorId: traveler.id,
        fromRegion: "alpha",
        toRegion: "beta",
      }],
    }, 100);

    expect(result.outcome).toBe("accepted");
    expect(result.commands?.appliedCommandIds).toContain("retain:before-switch");
    expect(result.commands?.ignoredCommandIds).not.toContain("retain:before-switch");
    expect(harness.graph.debugSnapshot()).toMatchObject({
      activeRegion: { id: "beta" },
      actors: [],
    });
    expect(actor.snapshot().position).toEqual(sourcePosition);
  });

  it.each([false, true])(
    "keeps the same traveler at the destination gate then commits the authored final origin (reduced=%s)",
    (reducedMotion) => {
    const traveler = agent("traveler", "alpha");
    const factories = new RealPersonMarkerFactories();
    const harness = makeHarness({ checkpointAgents: [traveler], factories, reducedMotion });
    const resolver = createProductionSceneCommandResolver({
      getPlacement: () => harness.placement.snapshot(),
    });
    const initial = frame({ revision: 1, lastCursor: 1, agents: [traveler], regions: harness.regions });
    harness.graph.update(initial);
    const actor = factories.realActors.get(traveler.id)!;
    const instanceId = actor.snapshot().instanceId;
    const sourcePoint = actor.snapshot().position;
    const sourcePlacement = harness.placement.snapshot().agents.get(traveler.id)!;
    const sourcePlacementRevision = harness.placement.snapshot().revision;
    const arrivalGate = harness.recipes.get("beta")!.gates.find((gate) => (
      gate.role === "arrival" && gate.edge.from === "alpha" && gate.edge.to === "beta"
    ))!;
    const gatePoint = tileCenter(arrivalGate.tile);
    const destinationSamples: Vec2[] = [];
    const leftProgram = "choreography:1:1:single:agent_left_region";
    const leftEnter = frame({
      revision: 2,
      lastCursor: 2,
      agents: [traveler],
      regions: harness.regions,
      scene: scene("alpha", {
        phase: "enter",
        focus: { kind: "agent", id: traveler.id },
        execution: { sceneToken: 100, programId: leftProgram },
        actorIntents: [{
          actorId: traveler.id,
          kind: "move",
          target: { x: 160, y: 64 },
          waypoints: [{ x: 128, y: 64 }, { x: 160, y: 64 }],
          marker: "departure-gate-reached",
        }],
      }),
    });
    harness.graph.applyFrame!(leftEnter, resolver(leftEnter), 0);
    const leftHold = frame({
      revision: 3,
      lastCursor: 3,
      agents: [traveler],
      regions: harness.regions,
      scene: scene("alpha", {
        phase: "hold",
        focus: { kind: "agent", id: traveler.id },
        execution: { sceneToken: 100, programId: leftProgram },
        effectIntents: [{ kind: "atlas-transition", sourceId: "alpha", targetId: "beta" }],
      }),
    });
    harness.graph.applyFrame!(leftHold, resolver(leftHold), 100);
    const cleared = frame({
      revision: 4,
      lastCursor: 4,
      agents: [traveler],
      regions: harness.regions,
      scene: null,
    });
    harness.graph.applyFrame!(cleared, resolver(cleared), 200);

    const enteredMoment = "2:2:single";
    const enteredProgram = `choreography:${enteredMoment}:agent_entered_region`;
    const entered = frame({
      revision: 5,
      lastCursor: 5,
      agents: [traveler],
      regions: harness.regions,
      scene: scene("alpha", {
        momentId: enteredMoment,
        phase: "enter",
        focus: { kind: "agent", id: traveler.id },
        execution: {
          sceneToken: 101,
          programId: enteredProgram,
          eventType: "agent_entered_region",
        },
      }),
    });
    harness.graph.applyFrame!(entered, resolver(entered), 300);
    expect(harness.graph.debugSnapshot().actors).toContainEqual(expect.objectContaining({
      id: traveler.id,
      instanceId,
      position: sourcePoint,
    }));
    expect(harness.graph.debugSnapshot().activeRegion?.id).toBe("alpha");
    expect(actor.snapshot().position).toEqual(sourcePoint);
    expect(harness.placement.snapshot()).toMatchObject({
      revision: sourcePlacementRevision,
      agents: expect.any(Map),
    });
    expect(harness.placement.snapshot().agents.get(traveler.id)).toEqual(sourcePlacement);
    expect(harness.graph.debugSnapshot().regionTransitions).toEqual([]);
    expect(harness.graph.debugSnapshot().recentMarkers.some(
      ({ marker }) => marker === "repositioned",
    )).toBe(false);
    harness.graph.applyFrame!(entered, resolver(entered), 320);
    expect(actor.snapshot().position).toEqual(sourcePoint);
    expect(harness.placement.snapshot().revision).toBe(sourcePlacementRevision);
    expect(harness.graph.debugSnapshot().regionTransitions).toEqual([]);

    const enteredHold = frame({
      revision: 6,
      lastCursor: 6,
      agents: [traveler],
      regions: harness.regions,
      scene: scene("beta", {
        momentId: enteredMoment,
        phase: "hold",
        focus: { kind: "agent", id: traveler.id },
        execution: {
          sceneToken: 101,
          programId: enteredProgram,
          eventType: "agent_entered_region",
        },
        effectIntents: [{ kind: "atlas-transition", sourceId: "alpha", targetId: "beta" }],
      }),
    });
    harness.graph.applyFrame!(enteredHold, resolver(enteredHold), 400);
    expect(harness.graph.debugSnapshot().actors).toContainEqual(expect.objectContaining({
      instanceId,
      position: gatePoint,
    }));
    expect(harness.graph.debugSnapshot().regionTransitions).toEqual([]);
    expect(harness.placement.snapshot().revision).toBe(sourcePlacementRevision);
    expect(harness.placement.snapshot().agents.get(traveler.id)).toEqual(sourcePlacement);
    destinationSamples.push(actor.snapshot().position);
    const arrived = { ...traveler, position: "beta" };
    const arrivalTarget = harness.recipes.get("beta")!.stagingPoints.reduce((nearest, point) => (
      Math.hypot(point.x - gatePoint.x, point.y - gatePoint.y)
        < Math.hypot(nearest.x - gatePoint.x, nearest.y - gatePoint.y)
        ? point
        : nearest
    ));
    const consequence = frame({
      revision: 7,
      lastCursor: 7,
      agents: [arrived],
      regions: harness.regions,
      scene: scene("beta", {
        momentId: enteredMoment,
        phase: "consequence",
        focus: { kind: "agent", id: traveler.id },
        execution: {
          sceneToken: 101,
          programId: enteredProgram,
          eventType: "agent_entered_region",
        },
        actorIntents: [{
          actorId: traveler.id,
          kind: "move",
          target: arrivalTarget,
          waypoints: [gatePoint, arrivalTarget],
          marker: "arrival-commit",
        }],
      }),
    });
    harness.graph.applyFrame!(consequence, resolver(consequence), 500);

    expect(factories.realActors.get(traveler.id)).toBe(actor);
    expect(harness.graph.debugSnapshot().actors).toContainEqual(expect.objectContaining({
      id: traveler.id,
      instanceId,
    }));
    destinationSamples.push(actor.snapshot().position);
    expect(harness.placement.snapshot().agents.get(traveler.id)).toMatchObject({
      regionId: "beta",
      anchorKind: "arrival:alpha",
      point: arrivalTarget,
    });
    expect(harness.graph.debugSnapshot().regionTransitions).toContainEqual(expect.objectContaining({
      actorId: traveler.id,
      reason: "region-transition",
      position: gatePoint,
      actorPosition: gatePoint,
      gate: expect.objectContaining({ role: "arrival", point: gatePoint }),
      fromRegion: "alpha",
      toRegion: "beta",
      commandId: `${enteredProgram}:placement:arrival:${traveler.id}`,
      sceneToken: 101,
      atMs: 500,
    }));

    let firstMoved: Readonly<{ x: number; y: number }> | null = sameTestPoint(
      actor.snapshot().position,
      gatePoint,
    ) ? null : actor.snapshot().position;
    for (let tick = 1; tick <= 30 && firstMoved === null; tick += 1) {
      harness.graph.updateTime(1 / 30, 500 + tick * 1_000 / 30);
      const position = actor.snapshot().position;
      destinationSamples.push(position);
      if (position.x !== gatePoint.x || position.y !== gatePoint.y) firstMoved = position;
    }
    expect(destinationSamples[0]).toEqual(gatePoint);
    expect(destinationSamples.every((position) => !sameTestPoint(position, sourcePoint))).toBe(true);
    for (let index = 1; index < destinationSamples.length; index += 1) {
      expect(Math.hypot(
        destinationSamples[index]!.x - destinationSamples[index - 1]!.x,
        destinationSamples[index]!.y - destinationSamples[index - 1]!.y,
      )).toBeLessThanOrEqual(64);
    }
    expect(firstMoved).not.toBeNull();
    expect(Math.hypot(firstMoved!.x - gatePoint.x, firstMoved!.y - gatePoint.y))
      .toBeLessThanOrEqual(48 / 30 + 0.01);
    const arrivalDelta = {
      x: arrivalTarget.x - gatePoint.x,
      y: arrivalTarget.y - gatePoint.y,
    };
    const firstDelta = {
      x: firstMoved!.x - gatePoint.x,
      y: firstMoved!.y - gatePoint.y,
    };
    const firstProgress = (
      firstDelta.x * arrivalDelta.x + firstDelta.y * arrivalDelta.y
    ) / (arrivalDelta.x ** 2 + arrivalDelta.y ** 2);
    expect(firstProgress).toBeGreaterThan(0);
    expect(firstProgress).toBeLessThanOrEqual(1);
    expect(firstMoved!.x).toBeCloseTo(gatePoint.x + arrivalDelta.x * firstProgress, 5);
    expect(firstMoved!.y).toBeCloseTo(gatePoint.y + arrivalDelta.y * firstProgress, 5);
    expect(firstMoved).not.toEqual(sourcePoint);
    expect(harness.graph.debugSnapshot().regionTransitions.filter(
      ({ actorId }) => actorId === traveler.id,
    )).toHaveLength(1);
    expect(harness.graph.debugSnapshot().recentMarkers.some(
      ({ marker }) => marker === "repositioned",
    )).toBe(false);
    for (let tick = 2; tick <= 30; tick += 1) {
      harness.graph.updateTime(1 / 30, 500 + tick * 1_000 / 30);
    }
    expect(actor.snapshot().position).toEqual(arrivalTarget);
    expect(harness.placement.snapshot().agents.get(traveler.id)?.point).toEqual(actor.snapshot().position);
    },
  );

  it.each([false, true])(
    "keeps one staged traveler instance hidden across an observer-region detour (reduced=%s)",
    (reducedMotion) => {
      const traveler = agent("traveler", "alpha");
      const factories = new RealPersonMarkerFactories();
      const harness = makeHarness({ checkpointAgents: [traveler], factories, reducedMotion });
      const initial = frame({ agents: [traveler], regions: harness.regions });
      harness.graph.update(initial);
      const actor = factories.realActors.get(traveler.id)!;
      const instanceId = actor.snapshot().instanceId;
      const placementBefore = harness.placement.snapshot();
      const momentId = "observer-detour";
      const programId = `choreography:${momentId}:agent_entered_region`;
      const arrivalGate = harness.recipes.get("beta")!.gates.find((gate) => (
        gate.role === "arrival" && gate.edge.from === "alpha" && gate.edge.to === "beta"
      ))!;
      const gatePoint = tileCenter(arrivalGate.tile);
      const holdFrame = (revision: number): PresentedObserverFrame => frame({
        revision,
        lastCursor: revision,
        agents: [traveler],
        regions: harness.regions,
        scene: scene("beta", {
          momentId,
          phase: "hold",
          focus: { kind: "agent", id: traveler.id },
          execution: { sceneToken: 140, programId, eventType: "agent_entered_region" },
          effectIntents: [{ kind: "atlas-transition", sourceId: "alpha", targetId: "beta" }],
        }),
      });
      const batchFor = (value: PresentedObserverFrame) => ({
        identity: identityOf(value),
        sceneToken: 140,
        commands: [
          {
            kind: "retain-traveler",
            commandId: "observer-detour:retain",
            actorId: traveler.id,
            fromRegion: "alpha",
            toRegion: "beta",
          },
          {
            kind: "stage-arrival",
            commandId: "observer-detour:stage",
            actorId: traveler.id,
            fromRegion: "alpha",
            toRegion: "beta",
            eventType: "agent_entered_region",
            phase: "hold",
            momentId,
            programId,
          },
        ],
      } as const);

      const destination = holdFrame(2);
      expect(harness.graph.applyFrame!(destination, batchFor(destination), 100).outcome).toBe("accepted");
      expect(harness.graph.debugSnapshot().actors).toContainEqual(expect.objectContaining({
        id: traveler.id,
        instanceId,
        position: gatePoint,
      }));

      const observedSource = holdFrame(3);
      expect(harness.graph.applyFrame!(observedSource, batchFor(observedSource), 200, "alpha").outcome).toBe("accepted");
      expect(harness.graph.debugSnapshot().activeRegion?.id).toBe("alpha");
      expect(harness.graph.debugSnapshot().actors).toEqual([]);
      expect(harness.graph.hitTargets().some(({ selection }) => selection.id === traveler.id)).toBe(false);
      expect(actor.snapshot()).toMatchObject({ instanceId, position: gatePoint });

      const returned = holdFrame(4);
      expect(harness.graph.applyFrame!(returned, batchFor(returned), 300).outcome).toBe("accepted");
      expect(factories.realActors.get(traveler.id)).toBe(actor);
      expect(harness.graph.debugSnapshot().actors).toContainEqual(expect.objectContaining({
        id: traveler.id,
        instanceId,
        position: gatePoint,
      }));
      expect(harness.placement.snapshot()).toEqual(placementBefore);
      expect(harness.graph.debugSnapshot().regionTransitions).toEqual([]);
    },
  );

  it("keeps a renderer-rejected destination frame presentation-silent before a clean retry", () => {
    const traveler = agent("traveler", "alpha");
    const factories = new RealPersonMarkerFactories();
    const harness = makeHarness({ checkpointAgents: [traveler], factories });
    const initial = frame({ agents: [traveler], regions: harness.regions });
    harness.graph.update(initial);
    const actor = factories.realActors.get(traveler.id)!;
    const instanceId = actor.snapshot().instanceId;
    const sourcePoint = actor.snapshot().position;
    const placementBefore = harness.placement.snapshot();
    const momentId = "renderer-retry";
    const programId = `choreography:${momentId}:agent_entered_region`;
    const gate = tileCenter(harness.recipes.get("beta")!.gates.find((candidate) => (
      candidate.role === "arrival" && candidate.edge.from === "alpha" && candidate.edge.to === "beta"
    ))!.tile);
    const hold = (revision: number): PresentedObserverFrame => frame({
      revision,
      lastCursor: revision,
      agents: [traveler],
      regions: harness.regions,
      scene: scene("beta", {
        momentId,
        phase: "hold",
        focus: { kind: "agent", id: traveler.id },
        execution: { sceneToken: 150, programId, eventType: "agent_entered_region" },
        effectIntents: [{ kind: "atlas-transition", sourceId: "alpha", targetId: "beta" }],
      }),
    });
    const commands = (value: PresentedObserverFrame) => ({
      identity: identityOf(value),
      sceneToken: 150,
      commands: [
        { kind: "retain-traveler", commandId: "renderer-retry:retain", actorId: traveler.id, fromRegion: "alpha", toRegion: "beta" },
        {
          kind: "stage-arrival", commandId: "renderer-retry:stage", actorId: traveler.id,
          fromRegion: "alpha", toRegion: "beta", eventType: "agent_entered_region",
          phase: "hold", momentId, programId,
        },
      ],
    } as const);

    const rejected = hold(2);
    expect(harness.graph.applyFrame!(rejected, commands(rejected), 100, null, true).outcome).toBe("accepted");
    expect(actor.snapshot()).toMatchObject({ instanceId, position: sourcePoint });
    harness.graph.discardArrivalStaging!(identityOf(rejected));
    expect(harness.graph.debugSnapshot().actors).toEqual([]);
    expect(actor.snapshot()).toMatchObject({ instanceId, position: sourcePoint });
    expect(harness.placement.snapshot()).toEqual(placementBefore);

    const retry = hold(3);
    expect(harness.graph.applyFrame!(retry, commands(retry), 200, null, true).outcome).toBe("accepted");
    harness.graph.commitArrivalStaging!(identityOf(retry));
    expect(factories.realActors.get(traveler.id)).toBe(actor);
    expect(harness.graph.debugSnapshot().actors).toContainEqual(expect.objectContaining({
      id: traveler.id,
      instanceId,
      position: gate,
    }));
    expect(harness.placement.snapshot()).toEqual(placementBefore);
    expect(harness.graph.debugSnapshot().regionTransitions).toEqual([]);
  });

  it.each([
    ["unrelated location", { position: "gamma", status: "alive" as const }],
    ["death", { position: "alpha", status: "dead" as const }],
  ])("clears a retained traveler on authoritative %s", (_label, contradiction) => {
    const traveler = agent("traveler", "alpha");
    const regions = [region("alpha", ["beta"]), region("beta", []), region("gamma", [])];
    const harness = makeHarness({ checkpointAgents: [traveler], regions });
    const initial = frame({ agents: [traveler], regions });
    harness.graph.update(initial);
    const actor = harness.factories.actors.get(traveler.id)!;
    harness.graph.applySceneCommands({
      identity: identityOf(initial),
      sceneToken: 110,
      commands: [{
        kind: "retain-traveler",
        commandId: "retain:bounded",
        actorId: traveler.id,
        fromRegion: "alpha",
        toRegion: "beta",
      }],
    }, 0);

    harness.graph.update(frame({
      revision: 2,
      lastCursor: 2,
      agents: [{ ...traveler, ...contradiction }],
      regions,
      scene: scene("beta"),
    }));

    expect(harness.graph.debugSnapshot().actors).toEqual([]);
    expect(actor.disposeCalls).toBe(1);
  });

  it.each([
    ["wrong event", { eventType: "speak", programId: "choreography:arrival-hold:speak" }],
    ["foreign program", { eventType: "agent_entered_region", programId: "choreography:other:agent_entered_region" }],
    ["reversed edge", { eventType: "agent_entered_region", programId: "choreography:arrival-hold:agent_entered_region", reverse: true }],
    ["dead actor", { eventType: "agent_entered_region", programId: "choreography:arrival-hold:agent_entered_region", status: "dead" }],
    ["paralyzed actor", { eventType: "agent_entered_region", programId: "choreography:arrival-hold:agent_entered_region", status: "paralyzed" }],
    ["contradictory region", { eventType: "agent_entered_region", programId: "choreography:arrival-hold:agent_entered_region", position: "gamma" }],
  ] as const)("rejects %s arrival staging without showing a destination traveler", (_label, variant) => {
    const options = variant as Readonly<{
      eventType: "speak" | "agent_entered_region";
      programId: string;
      reverse?: boolean;
      status?: AgentSnapshot["status"];
      position?: string;
    }>;
    const traveler = agent("traveler", "alpha");
    const regions = [region("alpha", ["beta"]), region("beta", []), region("gamma", [])];
    const harness = makeHarness({ checkpointAgents: [traveler], regions });
    const initial = frame({ agents: [traveler], regions });
    harness.graph.update(initial);
    const actor = harness.factories.actors.get(traveler.id)!;
    const sourcePosition = actor.snapshot().position;
    const placementBefore = harness.placement.snapshot();
    const momentId = "arrival-hold";
    const fromRegion = options.reverse === true ? "beta" : "alpha";
    const toRegion = options.reverse === true ? "alpha" : "beta";
    const destination = frame({
      revision: 2,
      lastCursor: 2,
      agents: [{
        ...traveler,
        position: options.position ?? "alpha",
        status: options.status ?? "alive",
      }],
      regions,
      scene: scene("beta", {
        momentId,
        phase: "hold",
        focus: { kind: "agent", id: traveler.id },
        execution: {
          sceneToken: 130,
          programId: options.programId,
          eventType: options.eventType,
        } as never,
        effectIntents: [{ kind: "atlas-transition", sourceId: "alpha", targetId: "beta" }],
      }),
    });
    const batch = {
      identity: identityOf(destination),
      sceneToken: 130,
      commands: [
        {
          kind: "retain-traveler",
          commandId: `retain:${_label}`,
          actorId: traveler.id,
          fromRegion,
          toRegion,
        },
        {
          kind: "stage-arrival",
          commandId: `stage:${_label}`,
          actorId: traveler.id,
          fromRegion,
          toRegion,
          eventType: "agent_entered_region",
          phase: "hold",
          momentId,
          programId: options.programId,
        },
      ],
    } as const;

    expect(harness.graph.applyFrame!(destination, batch as never, 100).outcome).toBe("accepted");
    expect(harness.graph.debugSnapshot().activeRegion?.id).toBe("beta");
    expect(harness.graph.debugSnapshot().actors).toEqual([]);
    expect(actor.snapshot().position).toEqual(sourcePosition);
    expect(harness.placement.snapshot()).toEqual(placementBefore);
    expect(harness.graph.debugSnapshot().regionTransitions).toEqual([]);
    expect(harness.graph.debugSnapshot().recentMarkers.some(({ marker }) => marker === "repositioned")).toBe(false);
  });

  it("rejects foreign, reverse, and terminal placement hints without moving durable placement", () => {
    const live = agent("live", "alpha");
    const dead = { ...agent("dead", "alpha"), status: "dead" as const };
    const paralyzed = { ...agent("paralyzed", "alpha"), status: "paralyzed" as const };
    const harness = makeHarness({ checkpointAgents: [live, dead, paralyzed] });
    const initial = frame({ agents: [live, dead, paralyzed], regions: harness.regions });
    harness.graph.update(initial);
    const destinationAgents = [live, dead, paralyzed].map((value) => ({ ...value, position: "beta" }));
    const destination = frame({
      revision: 2,
      lastCursor: 2,
      agents: destinationAgents,
      regions: harness.regions,
      scene: scene("beta"),
    });
    harness.graph.update(destination, {
      identity: { ...identityOf(destination), sourceKey: "foreign:run-a" },
      sceneToken: 91,
      commands: [{
        kind: "placement-hint", commandId: "foreign", agentId: live.id,
        context: { kind: "arrival", fromRegion: "alpha" },
      }],
    } as never);
    expect(harness.placement.snapshot().agents.get(live.id)?.regionId).toBe("alpha");

    const next = frame({
      revision: 3,
      lastCursor: 3,
      agents: destinationAgents,
      regions: harness.regions,
      scene: scene("beta"),
    });
    harness.graph.update(next, {
      identity: identityOf(next), sceneToken: 91, commands: [
        { kind: "placement-hint", commandId: "reverse", agentId: live.id, context: { kind: "arrival", fromRegion: "beta" } },
        { kind: "placement-hint", commandId: "dead", agentId: dead.id, context: { kind: "arrival", fromRegion: "alpha" } },
        { kind: "placement-hint", commandId: "paralyzed", agentId: paralyzed.id, context: { kind: "arrival", fromRegion: "alpha" } },
      ],
    } as never);
    const placements = harness.placement.snapshot().agents;
    expect(placements.get(live.id)?.regionId).toBe("alpha");
    expect(placements.get(dead.id)?.regionId).toBe("alpha");
    expect(placements.get(paralyzed.id)?.regionId).toBe("alpha");
    expect(harness.graph.debugSnapshot().regionTransitions).toEqual([]);
  });

  it("rolls a failed destination environment preparation back without replacing the traveller", () => {
    const traveler = agent("traveler", "alpha");
    const factories = new FakeFactories();
    const harness = makeHarness({ checkpointAgents: [traveler], factories });
    const initial = frame({ agents: [traveler], regions: harness.regions });
    harness.graph.update(initial);
    const instanceId = harness.graph.debugSnapshot().actors[0]!.instanceId;
    const alpha = factories.environments.get("alpha")!;
    harness.graph.applySceneCommands({
      identity: identityOf(initial), sceneToken: 92, commands: [{
        kind: "retain-traveler", commandId: "retain:rollback", actorId: traveler.id,
        fromRegion: "alpha", toRegion: "beta",
      }],
    } as never, 0);
    factories.throwEnvironmentId = "beta";
    const arrivalGate = harness.recipes.get("beta")!.gates.find((gate) => (
      gate.role === "arrival" && gate.edge.from === "alpha" && gate.edge.to === "beta"
    ))!;
    const gatePoint = tileCenter(arrivalGate.tile);
    const destination = frame({
      revision: 2,
      lastCursor: 2,
      agents: [{ ...traveler, position: "beta" }],
      regions: harness.regions,
      scene: scene("beta"),
    });
    const arrivalBatch = {
      identity: identityOf(destination),
      sceneToken: 93,
      commands: [{
        kind: "placement-hint",
        commandId: "arrival:rollback",
        agentId: traveler.id,
        context: { kind: "arrival", fromRegion: "alpha" },
        arrivalGate: gatePoint,
      }],
    } as const;
    const sourcePoint = harness.graph.debugSnapshot().actors[0]!.position;

    expect(() => harness.graph.update(destination, arrivalBatch)).toThrow(/environment beta/);
    expect(harness.graph.debugSnapshot()).toMatchObject({
      activeRegion: { id: "alpha" },
      actors: [expect.objectContaining({ id: traveler.id, instanceId, position: sourcePoint })],
      regionTransitions: [],
    });
    expect(harness.placement.snapshot().agents.get(traveler.id)?.regionId).toBe("alpha");
    expect(alpha.disposeCalls).toBe(0);

    factories.throwEnvironmentId = null;
    expect(harness.graph.applyFrame!(destination, arrivalBatch, 100).outcome).toBe("accepted");
    expect(harness.graph.debugSnapshot()).toMatchObject({
      activeRegion: { id: "beta" },
      actors: [expect.objectContaining({ id: traveler.id, instanceId, position: gatePoint })],
      regionTransitions: [expect.objectContaining({
        actorId: traveler.id,
        position: gatePoint,
        commandId: "arrival:rollback",
      })],
    });
  });

  it("restores a moving actor's full transient state when a post-stage transaction rejects", () => {
    const traveler = agent("traveler", "alpha");
    const factories = new RealPersonMarkerFactories();
    const harness = makeHarness({ checkpointAgents: [traveler], factories });
    const initial = frame({ agents: [traveler], regions: harness.regions });
    harness.graph.update(initial);
    const actor = factories.realActors.get(traveler.id)!;
    const sourcePoint = actor.snapshot().position;
    const sourcePlacement = harness.placement.snapshot();
    const routeEnd = { x: sourcePoint.x + 96, y: sourcePoint.y };
    actor.apply({
      kind: "move",
      waypoints: [routeEnd],
      speedPixelsPerSecond: 48,
      gait: "walk",
    }, 0);
    const sourceAction = actor.snapshot().activeAction;
    expect(sourceAction).toBe("orienting");
    const arrivalGate = harness.recipes.get("beta")!.gates.find((gate) => (
      gate.role === "arrival" && gate.edge.from === "alpha" && gate.edge.to === "beta"
    ))!;
    const momentId = "commit-rollback";
    const programId = `choreography:${momentId}:agent_entered_region`;
    const destination = frame({
      revision: 2,
      lastCursor: 2,
      agents: [traveler],
      regions: harness.regions,
      scene: scene("beta", {
        momentId,
        phase: "hold",
        focus: { kind: "agent", id: traveler.id },
        execution: { sceneToken: 121, programId, eventType: "agent_entered_region" },
        effectIntents: [{ kind: "atlas-transition", sourceId: "alpha", targetId: "beta" }],
      }),
    });
    const candidateBatch = {
      identity: identityOf(destination),
      sceneToken: 121,
      commands: [
        {
          kind: "retain-traveler",
          commandId: "retain:commit-rollback",
          actorId: traveler.id,
          fromRegion: "alpha",
          toRegion: "beta",
        },
        {
          kind: "stage-arrival",
          commandId: "stage:commit-rollback",
          actorId: traveler.id,
          fromRegion: "alpha",
          toRegion: "beta",
          eventType: "agent_entered_region",
          phase: "hold",
          momentId,
          programId,
        },
        {
          kind: "placement-hint",
          commandId: "invalid-before-consequence",
          agentId: traveler.id,
          context: { kind: "arrival", fromRegion: "alpha" },
          arrivalGate: tileCenter(arrivalGate.tile),
        },
      ],
    } as const;
    vi.spyOn(harness.placement, "commit").mockImplementationOnce(() => {
      throw new Error("candidate placement rejected");
    });

    expect(() => harness.graph.applyFrame!(destination, candidateBatch, 100)).toThrow(/candidate placement rejected/);
    expect(actor.snapshot().position).toEqual(sourcePoint);
    expect(actor.snapshot().activeAction).toBe(sourceAction);
    expect(harness.placement.snapshot()).toEqual(sourcePlacement);
    expect(harness.graph.debugSnapshot()).toMatchObject({
      activeRegion: { id: "alpha" },
      regionTransitions: [],
    });
    expect(harness.factories.environments.get("beta")?.disposeCalls).toBe(1);

    harness.graph.updateTime(0.25, 250);
    harness.graph.updateTime(0.5, 750);
    expect(actor.snapshot().position.x).toBeGreaterThan(sourcePoint.x);
    expect(actor.snapshot().position.x).toBeLessThanOrEqual(sourcePoint.x + 25);
    expect(actor.snapshot().position.y).toBe(sourcePoint.y);

    expect(harness.graph.applyFrame!(destination, candidateBatch, 600).outcome).toBe("accepted");
    expect(actor.snapshot().position).toEqual(tileCenter(arrivalGate.tile));
    expect(harness.placement.snapshot()).toEqual(sourcePlacement);
    expect(harness.graph.debugSnapshot().regionTransitions).toEqual([]);
  });

  it.each([30, 60, 120])("RED residual: refreshes live feet-Y order through a crossing at %s Hz", (hz) => {
    const low = agent("low", "alpha");
    const high = agent("high", "alpha");
    const factories = new RealMovingFactories();
    const harness = makeHarness({
      checkpointAgents: [low, high],
      factories,
      atlasLeases: coreAtlasLeases(),
    });
    const accepted = frame({ agents: [low, high], regions: harness.regions });
    harness.graph.update(accepted);
    const snapshots = harness.graph.debugSnapshot().actors;
    const lowStart = snapshots.find(({ id }) => id === "low")!.position;
    const highStart = snapshots.find(({ id }) => id === "high")!.position;
    const lower = lowStart.y < highStart.y ? "low" : "high";
    const upper = lower === "low" ? "high" : "low";
    const lowerStart = snapshots.find(({ id }) => id === lower)!.position;
    const upperStart = snapshots.find(({ id }) => id === upper)!.position;
    harness.graph.applySceneCommands({
      identity: identityOf(accepted), sceneToken: 100, commands: [
        { kind: "actor", commandId: "lower-move", actorId: lower, command: { kind: "move", waypoints: [{ x: lowerStart.x, y: upperStart.y + 64 }], speedPixelsPerSecond: 80, gait: "walk" } },
        { kind: "actor", commandId: "upper-move", actorId: upper, command: { kind: "move", waypoints: [{ x: upperStart.x, y: lowerStart.y - 32 }], speedPixelsPerSecond: 80, gait: "walk" } },
      ],
    }, 0);
    const stepMs = 1_000 / hz;
    let crossed = false;
    for (let step = 1; step < hz * 8; step += 1) {
      harness.graph.updateTime(stepMs / 1_000, step * stepMs);
      const current = harness.graph.debugSnapshot().actors;
      const lowerY = current.find(({ id }) => id === lower)!.position.y;
      const upperY = current.find(({ id }) => id === upper)!.position.y;
      factories.drawTrace.length = 0;
      harness.graph.draw({} as CanvasRenderingContext2D);
      const order = factories.drawTrace.filter((entry) => entry.startsWith("actor:"));
      const expected = [
        { id: lower, y: lowerY },
        { id: upper, y: upperY },
      ].sort((left, right) => left.y - right.y
        || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0))
        .map(({ id }) => `actor:${id}`);
      expect(order).toEqual(expected);
      expect(harness.graph.hitTargets().find(({ selection }) => selection.id === lower)?.feetY).toBe(lowerY);
      if (lowerY > upperY) crossed = true;
      if (crossed && distancePoint(current.find(({ id }) => id === lower)!.position, { x: lowerStart.x, y: upperStart.y + 64 }) <= 0.5) break;
    }
    expect(crossed).toBe(true);
  });

  it("applies a presence-fade command to a real actor: vanish fades to and holds opacity 0, reveal fades back to 1", () => {
    // End-to-end proof of the door-anchored home-interaction motion contract
    // (Bug 3): the resolver-emitted "presence-fade" scene command actually
    // reaches a real actor's beginPresenceVanish/beginPresenceReveal and
    // changes what draws, not just an isolated actor-level unit contract.
    let captured: LayeredHumanActor | null = null;
    class CapturingFactories extends RealMovingFactories {
      override createActor(input: ProductionActorFactoryInput): LayeredHumanActor {
        const actor = super.createActor(input);
        captured = actor;
        return actor;
      }
    }
    const aster = agent("aster", "alpha");
    const harness = makeHarness({
      checkpointAgents: [aster],
      factories: new CapturingFactories(),
      atlasLeases: coreAtlasLeases(),
    });
    const accepted = frame({ agents: [aster], regions: harness.regions });
    harness.graph.update(accepted);
    const actor = captured!;
    expect(actor.snapshot().opacity).toBe(1);

    expect(harness.graph.applySceneCommands({
      identity: identityOf(accepted),
      sceneToken: 1,
      commands: [{ kind: "presence-fade", commandId: "vanish", actorId: "aster", mode: "vanish" }],
    }, 0).outcome).toBe("applied");
    harness.graph.updateTime(0.2, 200);
    expect(actor.snapshot().opacity).toBe(0);
    // Holds invisible for however long the interaction lasts, unlike an
    // ordinary fallback reposition's fixed ~360ms auto-reveal.
    harness.graph.updateTime(5, 5_200);
    expect(actor.snapshot().opacity).toBe(0);

    expect(harness.graph.applySceneCommands({
      identity: identityOf(accepted),
      sceneToken: 1,
      commands: [{ kind: "presence-fade", commandId: "reveal", actorId: "aster", mode: "reveal" }],
    }, 5_200).outcome).toBe("applied");
    harness.graph.updateTime(0.2, 5_400);
    expect(actor.snapshot().opacity).toBe(1);
  });

  it("draws every home back before actors and every home front after actors for stable occlusion", () => {
    const agents = [agent("z-agent", "alpha"), agent("a-agent", "alpha")];
    const homes = [home("hearth", "a-agent", "alpha")];
    const harness = makeHarness({
      checkpointAgents: agents,
      checkpointHomes: homes,
    });
    const doorY = harness.placement.snapshot().homes.get("hearth")!.door.y;
    harness.factories.actorPositionOverrides.set("a-agent", { x: 1, y: doorY - 10 });
    harness.factories.actorPositionOverrides.set("z-agent", { x: 2, y: doorY + 10 });
    harness.graph.update(frame({
      agents,
      homes,
      regions: harness.regions,
    }));

    harness.graph.draw({} as CanvasRenderingContext2D);
    expect(harness.factories.drawTrace).toEqual([
      "environment:alpha:ground",
      "home:hearth:back",
      "actor:a-agent",
      "actor:z-agent",
      "home:hearth:front",
      "environment:alpha:air",
    ]);
  });

  it("reuses accepted structural order without sorting entries or rereading snapshots on draw and advance", () => {
    const agents = [agent("birch", "alpha"), agent("aster", "alpha")];
    const hearth = home("hearth", "aster", "alpha");
    const harness = makeHarness({ checkpointAgents: agents, checkpointHomes: [hearth] });
    harness.graph.update(frame({ agents, homes: [hearth], regions: harness.regions }));
    const builtActors = agents.map(({ id }) => harness.factories.actors.get(id)!);
    const builtHome = harness.factories.homes.get("hearth")!;
    const actorPass = [...builtActors]
      .sort((left, right) => left.position.y - right.position.y || left.id.localeCompare(right.id))
      .map(({ id }) => `actor:${id}`);
    const actorReads = builtActors.map((actor) => actor.snapshotReads);
    const homeReads = builtHome.snapshotReads;
    harness.factories.drawTrace.length = 0;

    const sort = vi.spyOn(Array.prototype, "sort");
    let hotPathSorts = -1;
    try {
      harness.graph.draw({} as CanvasRenderingContext2D);
      harness.graph.updateTime(0.016, 16);
      harness.graph.draw({} as CanvasRenderingContext2D);
      harness.graph.updateTime(0.016, 32);
      hotPathSorts = sort.mock.calls.length;
    } finally {
      sort.mockRestore();
    }

    expect(hotPathSorts).toBe(0);
    expect(builtActors.map((actor) => actor.snapshotReads)).toEqual(actorReads);
    expect(builtHome.snapshotReads).toBe(homeReads);
    const completePass = [
      "environment:alpha:ground",
      "home:hearth:back",
      ...actorPass,
      "home:hearth:front",
      "environment:alpha:air",
    ];
    expect(harness.factories.drawTrace).toEqual([...completePass, ...completePass]);
  });

  it("derives immutable presentation-only landmark exclusions without changing navigation truth", () => {
    const derive = (productionSceneGraphModule as unknown as {
      landmarkInteractionExclusionRects?: (
        recipe: ReturnType<typeof createRegionMapRecipe>,
      ) => readonly Readonly<{ x: number; y: number; width: number; height: number }>[];
    }).landmarkInteractionExclusionRects;
    expect(derive).toBeTypeOf("function");
    const wornRegions = [{
      ...region("alpha", ["beta"]),
      description: "a once-heavenly landscape, now thinning and picked-over",
    }, region("beta", [])];
    const harness = makeHarness({ regions: wornRegions });
    const recipe = harness.recipes.get("alpha")!;
    const beforeCollision = [...recipe.grid.collision];
    const beforePath = [...recipe.pathMask];
    const expected = expectedLandmarkExclusionRects(recipe);

    const exclusions = derive?.(recipe) ?? [];

    expect(exclusions.length).toBeGreaterThan(0);
    expect(exclusions).toEqual(expected);
    expect(Object.isFrozen(exclusions)).toBe(true);
    expect(exclusions.every(Object.isFrozen)).toBe(true);
    expect(new Set(exclusions.map(({ x, y }) => `${x},${y}`)).size).toBe(exclusions.length);
    expect([...recipe.grid.collision]).toEqual(beforeCollision);
    expect([...recipe.pathMask]).toEqual(beforePath);
    expect((derive?.(harness.recipes.get("beta")!) ?? [])).toEqual([]);
  });

  it("keeps OBJECT exclusions on the envelope-rect instrument and GROUND terrain on destination-tile collision", () => {
    const routeIsClear = (productionSceneGraphModule as unknown as {
      presentationRouteIsClear?: (
        start: Vec2,
        waypoints: readonly Vec2[],
        exclusions: readonly Readonly<{ x: number; y: number; width: number; height: number }>[],
      ) => boolean;
    }).presentationRouteIsClear;
    expect(routeIsClear).toBeTypeOf("function");
    const exclusion = { x: 256, y: 256, width: 32, height: 32 };
    const horizontalY = exclusion.y + 16;
    const verticalX = exclusion.x + 16;
    const crossings = [
      [{ x: 160, y: horizontalY }, { x: 384, y: horizontalY }],
      [{ x: 384, y: horizontalY }, { x: 160, y: horizontalY }],
      [{ x: verticalX, y: 160 }, { x: verticalX, y: 384 }],
      [{ x: verticalX, y: 384 }, { x: verticalX, y: 160 }],
    ] as const;
    for (const [start, destination] of crossings) {
      expect(routeIsClear?.(start, [destination], [exclusion])).toBe(false);
      for (const hz of [30, 60, 120]) {
        const distance = Math.hypot(destination.x - start.x, destination.y - start.y);
        const duration = distance / 48;
        const samples = Math.ceil(duration * hz);
        expect(Array.from({ length: samples + 1 }, (_unused, index) => {
          const progress = Math.min(1, index / hz / duration);
          const feet = {
            x: start.x + (destination.x - start.x) * progress,
            y: start.y + (destination.y - start.y) * progress,
          };
          return productionRectsOverlap(feetAnchoredVisualRect(feet), exclusion);
        }).some(Boolean), `${hz}Hz ${JSON.stringify([start, destination])}`).toBe(true);
      }
    }
    expect(routeIsClear?.(
      { x: 160, y: 160 },
      [{ x: 192, y: 160 }],
      [exclusion],
    )).toBe(true);

    const aster = agent("aster", "alpha");
    const factories = new RealPersonMarkerFactories();
    const wornRegions = [{
      ...region("alpha", ["beta"]),
      description: "a once-heavenly landscape, now thinning and picked-over",
    }, region("beta", [])];
    const harness = makeHarness({ checkpointAgents: [aster], factories, regions: wornRegions });
    const recipe = harness.recipes.get("alpha")!;
    const landmarkZones = expectedLandmarkExclusionRects(recipe);
    expect(landmarkZones.length).toBeGreaterThan(0);
    const zone = landmarkZones[0]!;
    const start = {
      x: zone.x - STANDING_HUMAN_VISUAL_ENVELOPE.right - 2,
      y: zone.y + 16,
    };
    const destination = {
      x: zone.x + zone.width - STANDING_HUMAN_VISUAL_ENVELOPE.left + 2,
      y: zone.y + 16,
    };
    factories.actorPositionOverrides.set(aster.id, start);
    const accepted = frame({ agents: [aster], regions: harness.regions });
    const beforeCollision = [...recipe.grid.collision];
    const beforePath = [...recipe.pathMask];
    harness.graph.update(accepted);
    expect(factories.environments.get("alpha")!.exclusionZones.at(-1)?.slice(
      0,
      landmarkZones.length,
    )).toEqual(landmarkZones);

    const result = harness.graph.applySceneCommands({
      identity: identityOf(accepted),
      sceneToken: 318,
      commands: [{
        kind: "actor",
        commandId: "landmark-exclusion:crossing",
        actorId: aster.id,
        command: {
          kind: "move",
          waypoints: [destination],
          speedPixelsPerSecond: 48,
          gait: "walk",
        },
      }],
    }, 0);

    // Landmarks are OBJECTS, so they keep the rendered-envelope rect
    // instrument -- and the rejection now says so by name.
    expect(result).toEqual({
      outcome: "ignored",
      appliedCommandIds: [],
      ignoredCommandIds: ["landmark-exclusion:crossing"],
      rejections: [
        expect.objectContaining({
          commandId: "landmark-exclusion:crossing",
          commandKind: "actor",
          subjectId: aster.id,
          reason: "object-exclusion",
        }),
      ],
    });
    expect(factories.realActors.get(aster.id)!.snapshot().routeActive).toBe(false);
    const safeDestination = { x: start.x - 16, y: start.y };
    expect(routeIsClear?.(start, [safeDestination], landmarkZones)).toBe(true);
    expect(harness.graph.applySceneCommands({
      identity: identityOf(accepted),
      sceneToken: 318,
      commands: [{
        kind: "actor",
        commandId: "landmark-exclusion:safe-route",
        actorId: aster.id,
        command: {
          kind: "move",
          waypoints: [safeDestination],
          speedPixelsPerSecond: 48,
          gait: "walk",
        },
      }],
    }, 0)).toEqual({
      outcome: "applied",
      appliedCommandIds: ["landmark-exclusion:safe-route"],
      ignoredCommandIds: [],
      rejections: [],
    });

    // ---------------------------------------------------------------------
    // GROUND terrain: the destination tile's `grid.collision`, nothing else.
    // ---------------------------------------------------------------------
    const columns = recipe.grid.columns;
    const groundBlocked = (column: number, row: number): boolean =>
      recipe.grid.collision[row * columns + column] === 1;
    let blockedTile: Readonly<{ column: number; row: number }> | null = null;
    let southBankTile: Readonly<{ column: number; row: number }> | null = null;
    for (let row = 1; row < recipe.grid.rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        if (blockedTile === null && groundBlocked(column, row)) blockedTile = { column, row };
        if (southBankTile === null && !groundBlocked(column, row) && groundBlocked(column, row - 1)
          && presentationPointIsClear(tileCenter({ column, row }), landmarkZones)) {
          southBankTile = { column, row };
        }
      }
    }
    expect(blockedTile, "the region has blocked ground to walk into").not.toBeNull();
    expect(southBankTile, "the region has open ground with blocked ground to its north").not.toBeNull();

    // A move whose destination tile is blocked ground is refused, and the
    // refusal names the tile rather than vanishing into `ignored`.
    const intoWater = harness.graph.applySceneCommands({
      identity: identityOf(accepted),
      sceneToken: 318,
      commands: [{
        kind: "actor",
        commandId: "ground:into-blocked",
        actorId: aster.id,
        command: {
          kind: "move",
          waypoints: [tileCenter(blockedTile!)],
          speedPixelsPerSecond: 48,
          gait: "walk",
        },
      }],
    }, 0);
    expect(intoWater).toMatchObject({
      outcome: "ignored",
      ignoredCommandIds: ["ground:into-blocked"],
      rejections: [expect.objectContaining({
        commandId: "ground:into-blocked",
        subjectId: aster.id,
        reason: "blocked-ground",
        detail: expect.stringContaining(`(${blockedTile!.column}, ${blockedTile!.row})`),
      })],
    });

    // THE SOUTH-BANK CASE. Terrain-as-exclusion-rects would forbid this tile
    // outright -- the standing envelope hangs 46px above the feet, so the
    // blocked tile to the NORTH swallows it. The shipped seam judges the
    // destination tile itself, so the move is legal.
    const northRect = {
      x: southBankTile!.column * 32,
      y: (southBankTile!.row - 1) * 32,
      width: 32,
      height: 32,
    };
    expect(presentationPointIsClear(tileCenter(southBankTile!), [northRect])).toBe(false);
    expect(harness.graph.applySceneCommands({
      identity: identityOf(accepted),
      sceneToken: 318,
      commands: [{
        kind: "actor",
        commandId: "ground:south-bank",
        actorId: aster.id,
        command: {
          kind: "move",
          waypoints: [tileCenter(southBankTile!)],
          speedPixelsPerSecond: 48,
          gait: "walk",
        },
      }],
    }, 0)).toEqual({
      outcome: "applied",
      appliedCommandIds: ["ground:south-bank"],
      ignoredCommandIds: [],
      rejections: [],
    });

    expect([...recipe.grid.collision]).toEqual(beforeCollision);
    expect([...recipe.pathMask]).toEqual(beforePath);
  });

  it("rejects an initial actor envelope under tall landmark art before graph publication", () => {
    const aster = agent("aster", "alpha");
    const factories = new RealPersonMarkerFactories();
    const wornRegions = [{
      ...region("alpha", ["beta"]),
      description: "a once-heavenly landscape, now thinning and picked-over",
    }, region("beta", [])];
    const harness = makeHarness({ checkpointAgents: [aster], factories, regions: wornRegions });
    const recipe = harness.recipes.get("alpha")!;
    const zone = expectedLandmarkExclusionRects(recipe)[0]!;
    factories.actorPositionOverrides.set(aster.id, {
      x: zone.x + zone.width / 2,
      y: zone.y + zone.height,
    });
    const beforeCollision = [...recipe.grid.collision];

    expect(() => harness.graph.update(frame({ agents: [aster], regions: wornRegions })))
      .toThrow(/intersects tall scenic landmark presentation/i);

    expect(harness.graph.debugSnapshot()).toMatchObject({
      identity: null,
      actors: [],
      environments: [],
    });
    expect([...recipe.grid.collision]).toEqual(beforeCollision);
    expect(factories.environments.get("alpha")!.disposeCalls).toBe(1);
  });

  it("exposes typed detached hit and focus targets for active agents, homes, ruins, and regions", () => {
    const aster = agent("aster", "alpha");
    const hearth = home("hearth", "aster", "alpha");
    const harness = makeHarness({ checkpointAgents: [aster], checkpointHomes: [hearth] });
    harness.graph.update(frame({ agents: [aster], homes: [hearth], regions: harness.regions }));

    const targetGraph = harness.graph as ProductionSceneGraph & ExpectedSceneTargetQuery;
    const targets = targetGraph.hitTargets();
    const byKey = new Map(targets.map((target) => [target.selectionKey, target]));
    expect([...byKey.keys()].sort()).toEqual(["agent:aster", "home:hearth", "region:alpha"]);
    for (const target of targets) {
      expect(Object.values(target.worldBounds).every(Number.isFinite)).toBe(true);
      expect(target.worldBounds.width).toBeGreaterThan(0);
      expect(target.worldBounds.height).toBeGreaterThan(0);
      expect(Number.isFinite(target.feetY)).toBe(true);
    }
    expect(targetGraph.focusTarget({ kind: "agent", id: "aster" })).toEqual(byKey.get("agent:aster"));
    expect(targetGraph.focusTarget({ kind: "home", id: "hearth" })).toEqual(byKey.get("home:hearth"));
    const renderedHome = harness.factories.homes.get("hearth")!.snapshot();
    const logicalHome = PRODUCTION_ASSET_MANIFEST.regions[renderedHome.kit].homeManifest.logicalBounds;
    expect(targetGraph.focusTarget({ kind: "home", id: "hearth" })?.worldBounds).toEqual({
      x: renderedHome.plot.x,
      y: renderedHome.plot.y,
      width: logicalHome.width,
      height: logicalHome.height,
    });
    const actorBounds = feetAnchoredVisualRect(
      harness.factories.actors.get("aster")!.snapshot().position,
    );
    expect(harness.factories.environments.get("alpha")!.exclusionZones.at(-1)).toEqual([
      actorBounds,
      {
        x: renderedHome.plot.x,
        y: renderedHome.plot.y,
        width: 128,
        height: 128,
      },
    ]);

    const exclusionRefreshes = harness.factories.environments.get("alpha")!.exclusionZones.length;
    const ruin = { ...hearth, status: "ruin" as const, integrity: 0, ruined_at: 101 };
    harness.graph.update(frame({
      revision: 2,
      lastCursor: 2,
      agents: [aster],
      homes: [],
      ruins: [ruin],
      regions: harness.regions,
    }));
    const ruinTargets = targetGraph.hitTargets();
    expect(ruinTargets.map(({ selectionKey }) => selectionKey)).toContain("ruin:hearth");
    expect(ruinTargets.map(({ selectionKey }) => selectionKey)).not.toContain("home:hearth");
    expect(targetGraph.focusTarget({ kind: "home", id: "hearth" })).toBeNull();
    expect(targetGraph.focusTarget({ kind: "ruin", id: "hearth" })).toEqual(
      ruinTargets.find(({ selectionKey }) => selectionKey === "ruin:hearth"),
    );
    expect(harness.factories.environments.get("alpha")!.exclusionZones.length)
      .toBeGreaterThan(exclusionRefreshes);
    expect(harness.factories.environments.get("alpha")!.exclusionZones.at(-1)).toEqual([
      actorBounds,
      {
        x: renderedHome.plot.x,
        y: renderedHome.plot.y,
        width: 128,
        height: 128,
      },
    ]);
    expect(Object.isFrozen(ruinTargets)).toBe(true);
  });

  it("exposes actor action and exact world bounds for detached motion evidence", () => {
    const aster = agent("aster", "alpha");
    const harness = makeHarness({ checkpointAgents: [aster] });
    const accepted = frame({ agents: [aster], regions: harness.regions });
    harness.graph.update(accepted);
    harness.graph.applySceneCommands({
      identity: identityOf(accepted),
      sceneToken: 120,
      commands: [{
        kind: "actor",
        commandId: "motion:evidence",
        actorId: aster.id,
        command: {
          kind: "move",
          waypoints: [{ x: 336, y: 112 }],
          speedPixelsPerSecond: 48,
          gait: "walk",
        },
      }],
    }, 0);

    const debugActor = harness.graph.debugSnapshot().actors[0]!;
    expect(debugActor).toMatchObject({
      id: aster.id,
      activeAction: "moving",
      worldBounds: feetAnchoredVisualRect(debugActor.position),
    });
  });

  it("keeps every visible actor excluded across alive, paralyzed, and dead lifecycle states until removal", () => {
    const aster = agent("aster", "alpha");
    const harness = makeHarness({ checkpointAgents: [aster] });
    const initial = frame({ agents: [aster], regions: harness.regions });
    harness.graph.update(initial);
    const environment = harness.factories.environments.get("alpha")!;
    const origin = harness.factories.actors.get(aster.id)!.snapshot().position;
    expect(environment.exclusionZones.at(-1)).toEqual([feetAnchoredVisualRect(origin)]);

    harness.graph.update(frame({
      revision: 2,
      lastCursor: 2,
      agents: [{ ...aster, status: "paralyzed" }],
      regions: harness.regions,
    }));
    expect(environment.exclusionZones.at(-1)).toEqual([feetAnchoredVisualRect(origin)]);

    const revived = frame({
      revision: 3,
      lastCursor: 3,
      agents: [aster],
      regions: harness.regions,
    });
    harness.graph.update(revived);
    expect(environment.exclusionZones.at(-1)).toEqual([feetAnchoredVisualRect(origin)]);

    const target = harness.recipes.get("alpha")!.stagingPoints.find((point) => (
      point.x !== origin.x || point.y !== origin.y
    ))!;
    expect(harness.graph.applySceneCommands({
      identity: identityOf(revived),
      sceneToken: 201,
      commands: [{
        kind: "actor",
        commandId: "actor-exclusion:reposition",
        actorId: aster.id,
        command: { kind: "reposition", position: target, reason: "fallback" },
      }],
    }, 0).outcome).toBe("applied");
    expect(environment.exclusionZones.at(-1)).toEqual([feetAnchoredVisualRect(target)]);

    harness.graph.update(frame({
      revision: 4,
      lastCursor: 4,
      agents: [{ ...aster, status: "dead" }],
      regions: harness.regions,
    }));
    expect(environment.exclusionZones.at(-1)).toEqual([feetAnchoredVisualRect(target)]);

    harness.graph.update(frame({
      revision: 5,
      lastCursor: 5,
      agents: [],
      regions: harness.regions,
    }));
    expect(environment.exclusionZones.at(-1)).toEqual([]);
  });

  it("tracks the measured exclusion rectangle throughout live actor movement", () => {
    const aster = agent("aster", "alpha");
    const factories = new RealPersonMarkerFactories();
    const harness = makeHarness({ checkpointAgents: [aster], factories });
    const accepted = frame({ agents: [aster], regions: harness.regions });
    harness.graph.update(accepted);
    const actor = factories.realActors.get(aster.id)!;
    const environment = factories.environments.get("alpha")!;
    const origin = actor.snapshot().position;
    const target = { x: origin.x + 32, y: origin.y };

    expect(harness.graph.applySceneCommands({
      identity: identityOf(accepted),
      sceneToken: 202,
      commands: [{
        kind: "actor",
        commandId: "actor-exclusion:move",
        actorId: aster.id,
        command: {
          kind: "move",
          waypoints: [target],
          speedPixelsPerSecond: 48,
          gait: "walk",
        },
      }],
    }, 0).outcome).toBe("applied");
    for (let tick = 1; tick <= 20 && actor.snapshot().position.x === origin.x; tick += 1) {
      harness.graph.updateTime(1 / 30, tick * 1_000 / 30);
    }
    const moved = actor.snapshot().position;
    expect(moved.x).toBeGreaterThan(origin.x);
    expect(environment.exclusionZones.at(-1)).toEqual([feetAnchoredVisualRect(moved)]);
    expect(environment.exclusionZones.at(-1)).not.toEqual([feetAnchoredVisualRect(origin)]);
  });

  it("derives an exact accepted semantic snapshot from graph-visible live primitives", () => {
    const aster = agent("aster", "alpha");
    const hearth = home("hearth", "aster", "alpha");
    const harness = makeHarness({ checkpointAgents: [aster], checkpointHomes: [hearth] });
    const accepted = frame({ agents: [aster], homes: [hearth], regions: harness.regions });
    harness.graph.update(accepted);

    harness.factories.actors.get("aster")!.apply({ kind: "play-body", action: "work" });
    harness.factories.homes.get("hearth")!.apply({ kind: "loot", durationMs: 800 });
    const semantic = harness.graph.semanticSnapshot();

    expect(semantic.frameIdentity).toEqual(identityOf(accepted));
    expect(semantic.subjects.map(({ kind, stableSelectionKey, action }) => (
      [kind, stableSelectionKey, action]
    ))).toEqual([
      ["region", "region:alpha", "hold"],
      ["agent", "agent:aster", "working"],
      ["home", "home:hearth", "loot"],
    ]);
    expect(semantic.subjects[1]).toMatchObject({
      selection: { kind: "agent", id: "aster" },
      regionId: "alpha",
      status: "alive",
    });
  });

  it("advances every persistent entity monotonically and aggregates only the earliest deadline", () => {
    const aster = agent("aster", "alpha");
    const hearth = home("hearth", "aster", "alpha");
    const harness = makeHarness({ checkpointAgents: [aster], checkpointHomes: [hearth] });
    harness.graph.update(frame({ agents: [aster], homes: [hearth], regions: harness.regions }));
    const actor = harness.factories.actors.get("aster")!;
    const builtHome = harness.factories.homes.get("hearth")!;
    const environment = harness.factories.environments.get("alpha")!;
    expect(harness.graph.debugSnapshot().ownership).toEqual({
      actors: { created: 1, disposed: 0, outstanding: 1, peak: 1 },
      homes: { created: 1, disposed: 0, outstanding: 1, peak: 1 },
      environments: { created: 1, disposed: 0, outstanding: 1, peak: 1 },
    });
    actor.deadline = 130;
    builtHome.deadline = 120;
    environment.deadline = 140;

    harness.graph.updateTime(0.016, 100);
    harness.graph.updateTime(0.016, 90);
    expect(actor.advances).toEqual([[0.016, 100], [0.016, 100]]);
    expect(builtHome.advances).toEqual([100, 100]);
    expect(environment.advances).toEqual([100, 100]);
    expect(harness.graph.nextDeadlineMs()).toBe(120);
  });

  // home-cleanup item 2 (owner decision): home status-mark badges show only
  // on selection (this renderer has no independent hover concept). Mirrors
  // how actors already derive `selected` from `frame.selection` (see the
  // `reconciledActors` loop) -- `HomeActor#setSelected` is the equivalent
  // hook for homes, driving `HomeActor.draw()`'s mark-visibility gate.
  it("drives HomeActor#setSelected from the observer's current home/ruin selection", () => {
    const aster = agent("aster", "alpha");
    const hearth = home("hearth", "aster", "alpha");
    const other = home("other", "aster", "alpha");
    const harness = makeHarness({ checkpointAgents: [aster], checkpointHomes: [hearth, other] });

    harness.graph.update(frame({
      agents: [aster],
      homes: [hearth, other],
      regions: harness.regions,
      selection: { kind: "home", id: "hearth" },
    }));
    const selectedHome = harness.factories.homes.get("hearth")!;
    const otherHome = harness.factories.homes.get("other")!;
    expect(selectedHome.selected).toBe(true);
    expect(selectedHome.selectedCalls).toEqual([true]);
    expect(otherHome.selected).toBe(false);

    harness.graph.update(frame({
      revision: 2, lastCursor: 2,
      agents: [aster],
      homes: [hearth, other],
      regions: harness.regions,
      selection: { kind: "home", id: "other" },
    }));
    expect(selectedHome.selected).toBe(false);
    expect(selectedHome.selectedCalls).toEqual([true, false]);
    expect(otherHome.selected).toBe(true);

    harness.graph.update(frame({
      revision: 3, lastCursor: 3,
      agents: [aster],
      homes: [hearth, other],
      regions: harness.regions,
      selection: null,
    }));
    expect(selectedHome.selected).toBe(false);
    expect(otherHome.selected).toBe(false);
  });

  it("does not select a home whose entry kind no longer matches a stale selection", () => {
    const aster = agent("aster", "alpha");
    const ruin = { ...home("ruin-a", "aster", "alpha"), status: "ruin" as const, ruined_at: 90 };
    const harness = makeHarness({ checkpointAgents: [aster], checkpointHomes: [ruin] });

    // Selection still says "home" for an id that is now a ruin entry.
    harness.graph.update(frame({
      agents: [aster],
      ruins: [ruin],
      regions: harness.regions,
      selection: { kind: "home", id: "ruin-a" },
    }));
    const ruinEntry = harness.factories.homes.get("ruin-a")!;
    expect(ruinEntry.selected).toBe(false);

    harness.graph.update(frame({
      revision: 2, lastCursor: 2,
      agents: [aster],
      ruins: [ruin],
      regions: harness.regions,
      selection: { kind: "ruin", id: "ruin-a" },
    }));
    expect(ruinEntry.selected).toBe(true);
  });

  it("disposes every owned entity exactly once and makes the terminal graph inert", () => {
    const aster = agent("aster", "alpha");
    const hearth = home("hearth", "aster", "alpha");
    const harness = makeHarness({ checkpointAgents: [aster], checkpointHomes: [hearth] });
    harness.graph.update(frame({ agents: [aster], homes: [hearth], regions: harness.regions }));
    const actor = harness.factories.actors.get("aster")!;
    const builtHome = harness.factories.homes.get("hearth")!;
    const environment = harness.factories.environments.get("alpha")!;

    harness.graph.dispose();
    harness.graph.dispose();
    expect(actor.disposeCalls).toBe(1);
    expect(builtHome.disposeCalls).toBe(1);
    expect(environment.disposeCalls).toBe(1);
    expect(harness.graph.debugSnapshot().ownership).toEqual({
      actors: { created: 1, disposed: 1, outstanding: 0, peak: 1 },
      homes: { created: 1, disposed: 1, outstanding: 0, peak: 1 },
      environments: { created: 1, disposed: 1, outstanding: 0, peak: 1 },
    });
    expect(harness.graph.nextDeadlineMs()).toBeNull();
    expect(() => harness.graph.update(frame({ revision: 2, lastCursor: 2, regions: harness.regions }))).toThrow(/disposed/i);
    harness.graph.updateTime(1, 1_000);
    harness.graph.draw({} as CanvasRenderingContext2D);
    expect(actor.advances).toHaveLength(0);
    expect(harness.factories.drawTrace).toEqual([]);
  });

  it("aggregates active beings, provisional home, ruin, transients, and environment into one terminal disposal", () => {
    const aster = agent("aster", "alpha");
    const ruin = { ...home("ruin-a", "aster", "alpha"), status: "ruin" as const, ruined_at: 90 };
    const harness = makeHarness({ checkpointAgents: [aster], checkpointHomes: [ruin] });
    const accepted = frame({ agents: [aster], ruins: [ruin], regions: harness.regions });
    harness.graph.update(accepted);
    const recipe = harness.recipes.get("alpha")!;
    const candidate = harness.placement.fork();
    const proposed = home("provisional-a", "aster", "alpha");
    const allocation = candidate.placeHome(proposed);
    const plot = recipe.shelterPlots.find(({ id }) => id === placedPlotId(allocation))!;
    harness.graph.applySceneCommands({
      identity: identityOf(accepted),
      sceneToken: 88,
      commands: [
        {
          kind: "create-provisional-home",
          commandId: "provisional",
          homeId: proposed.home_id,
          regionId: proposed.region,
          plotId: plot.id,
          plot: tileCenter(plot.tile),
          door: tileCenter(plot.door),
          kit: recipe.kit,
        },
        {
          kind: "remote-transient",
          commandId: "portrait",
          motif: "portrait",
          sourceId: "aster",
          targetId: null,
          at: harness.placement.snapshot().agents.get("aster")!.point,
        },
        {
          kind: "environment",
          commandId: "dust",
          request: { kind: "dust", at: { x: 32, y: 32 }, tint: "#777" },
        },
      ],
    }, 100);
    const actorValue = harness.factories.actors.get("aster")!;
    const ruinValue = harness.factories.homes.get("ruin-a")!;
    const provisionalValue = harness.factories.homes.get("provisional-a")!;
    const environmentValue = harness.factories.environments.get("alpha")!;
    expect(harness.graph.debugSnapshot()).toMatchObject({
      actors: [expect.objectContaining({ id: "aster" })],
      homes: expect.arrayContaining([
        expect.objectContaining({ id: "ruin-a", kind: "ruin" }),
        expect.objectContaining({ id: "provisional-a", provisional: true }),
      ]),
      transients: [expect.objectContaining({ commandId: "portrait" })],
    });

    harness.graph.dispose();
    harness.graph.dispose();

    expect(actorValue.disposeCalls).toBe(1);
    expect(ruinValue.disposeCalls).toBe(1);
    expect(provisionalValue.disposeCalls).toBe(1);
    expect(environmentValue.disposeCalls).toBe(1);
    expect(harness.graph.debugSnapshot()).toMatchObject({
      disposed: true,
      actors: [],
      homes: [],
      environments: [],
      transients: [],
      recentMarkers: [],
    });
    harness.graph.updateTime(1, 2_000);
    harness.graph.draw({} as CanvasRenderingContext2D);
    expect(harness.factories.drawTrace).toEqual([]);
  });
});

interface HarnessOptions {
  readonly checkpointAgents?: readonly AgentSnapshot[];
  readonly checkpointHomes?: readonly HomeSnapshot[];
  readonly placement?: PlacementLedger;
  readonly factories?: FakeFactories;
  readonly atlasLeases?: Map<string, ProductionAssetLease>;
  readonly regions?: readonly RegionSnapshot[];
  readonly reducedMotion?: boolean;
  readonly spatialBinding?: Readonly<{
    placementRebound: boolean;
    recipesRebound: boolean;
  }>;
}

function makeHarness(options: HarnessOptions = {}) {
  const regions = options.regions ?? [region("alpha", ["beta"]), region("beta", [])];
  const recipes = new Map(regions.map((value) => {
    const recipe = createRegionMapRecipe(createRegionMapIdentity(72, value, regions));
    return [recipe.regionId, recipe] as const;
  }));
  const placement = options.placement ?? PlacementLedger.reconstruct([...recipes.values()], {
    agents: [...(options.checkpointAgents ?? [])],
    homes: [...(options.checkpointHomes ?? [])],
  });
  const atlasLeases = options.atlasLeases ?? new Map<string, ProductionAssetLease>();
  const acquiredAtlasLeases: Array<ReadonlyMap<string, ProductionAssetLease>> = [];
  const acquireAtlasLeases = vi.fn((ids: Iterable<string> = atlasLeases.keys()): ReadonlyMap<string, ProductionAssetLease> => {
    const retained = new Map([...ids].filter((id) => atlasLeases.has(id)).map((id) => {
      const source = atlasLeases.get(id)!;
      return [id, {
      value: source.value,
      release: vi.fn(),
      } satisfies ProductionAssetLease] as const;
    }));
    acquiredAtlasLeases.push(retained);
    return retained;
  });
  const factories = options.factories ?? new FakeFactories();
  const graph = createProductionSceneGraph({
    manifest: PRODUCTION_ASSET_MANIFEST,
    factories,
    placement,
    recipes,
    atlasLeases,
    acquireAtlasLeases,
    reducedMotion: options.reducedMotion ?? false,
    spatialBinding: options.spatialBinding,
  });
  return {
    graph,
    factories,
    placement,
    recipes,
    regions,
    atlasLeases,
    acquiredAtlasLeases,
    acquireAtlasLeases,
  };
}

class FakeFactories implements ProductionSceneFactories {
  readonly actorInputs: ProductionActorFactoryInput[] = [];
  readonly homeInputs: ProductionHomeFactoryInput[] = [];
  readonly environmentInputs: ProductionEnvironmentFactoryInput[] = [];
  readonly actors = new Map<string, FakeActor>();
  readonly homes = new Map<string, FakeHome>();
  readonly environments = new Map<string, FakeEnvironment>();
  readonly drawTrace: string[] = [];
  readonly actorPositionOverrides = new Map<string, Vec2>();
  throwActorId: string | null = null;
  throwHomeId: string | null = null;
  throwEnvironmentId: string | null = null;

  createActor(input: ProductionActorFactoryInput): LayeredHumanActor {
    const id = input.record.value.id!;
    if (id === this.throwActorId) throw new Error(`factory ${id}`);
    this.actorInputs.push(input);
    const actor = new FakeActor(id, this.actorPositionOverrides.get(id) ?? input.position, this.drawTrace);
    this.actors.set(id, actor);
    return actor as unknown as LayeredHumanActor;
  }

  createHome(input: ProductionHomeFactoryInput): HomeActor {
    if (input.id === this.throwHomeId) throw new Error(`home factory ${input.id}`);
    this.homeInputs.push(input);
    const builtHome = new FakeHome(input.id, input.presented, this.drawTrace);
    this.homes.set(input.id, builtHome);
    return builtHome as unknown as HomeActor;
  }

  createEnvironment(input: ProductionEnvironmentFactoryInput): EnvironmentSystem {
    if (input.regionId === this.throwEnvironmentId) throw new Error(`environment ${input.regionId}`);
    this.environmentInputs.push(input);
    const environment = new FakeEnvironment(input.regionId, input.condition, this.drawTrace, input.atlasLeases);
    this.environments.set(input.regionId, environment);
    return environment as unknown as EnvironmentSystem;
  }
}

class LeaseReleasingFactories extends FakeFactories {
  override createActor(input: ProductionActorFactoryInput): LayeredHumanActor {
    const id = input.record.value.id!;
    this.actorInputs.push(input);
    const actor = new FakeActor(
      id,
      this.actorPositionOverrides.get(id) ?? input.position,
      this.drawTrace,
      input.atlasLeases,
    );
    this.actors.set(id, actor);
    return actor as unknown as LayeredHumanActor;
  }
}

class RealMovingFactories extends FakeFactories {
  override createActor(input: ProductionActorFactoryInput): LayeredHumanActor {
    const id = input.record.value.id!;
    this.actorInputs.push(input);
    const position = id === "low" ? { x: 96, y: 64 } : { x: 128, y: 160 };
    const actor = new LayeredHumanActor({
      id,
      name: input.record.value.name!,
      persona: input.record.value.persona,
      position,
      facing: input.facing,
      manifest: input.manifest,
      atlasLeases: input.atlasLeases,
      reducedMotion: input.reducedMotion,
    });
    const draw = actor.draw.bind(actor);
    actor.draw = ((context: CanvasRenderingContext2D): void => {
      this.drawTrace.push(`actor:${id}`);
      void context;
      void draw;
    }) as typeof actor.draw;
    this.actors.set(id, actor as unknown as FakeActor);
    return actor;
  }
}

class RealHomeFactories extends FakeFactories {
  readonly realHomes = new Map<string, HomeActor>();

  override createHome(input: ProductionHomeFactoryInput): HomeActor {
    this.homeInputs.push(input);
    const home = new HomeActor({
      id: input.id,
      manifest: input.manifest,
      atlasLeases: input.atlasLeases,
      initial: input.presented,
    });
    this.realHomes.set(input.id, home);
    this.homes.set(input.id, home as unknown as FakeHome);
    return home;
  }
}

class RealFadeFactories extends FakeFactories {
  readonly realActors = new Map<string, LayeredHumanActor>();

  override createActor(input: ProductionActorFactoryInput): LayeredHumanActor {
    const id = input.record.value.id!;
    this.actorInputs.push(input);
    const actor = new LayeredHumanActor({
      id,
      name: input.record.value.name!,
      persona: input.record.value.persona,
      position: input.position,
      facing: input.facing,
      manifest: input.manifest,
      atlasLeases: input.atlasLeases,
      reducedMotion: input.reducedMotion,
    });
    actor.draw = ((_context: CanvasRenderingContext2D): void => {
      this.drawTrace.push(`actor:${id}`);
    }) as typeof actor.draw;
    this.realActors.set(id, actor);
    this.actors.set(id, actor as unknown as FakeActor);
    return actor;
  }
}

class RealPersonMarkerFactories extends FakeFactories {
  readonly realActors = new Map<string, LayeredHumanActor>();

  override createActor(input: ProductionActorFactoryInput): LayeredHumanActor {
    const id = input.record.value.id!;
    const actor = new LayeredHumanActor({
      id,
      name: input.record.value.name!,
      persona: input.record.value.persona,
      position: this.actorPositionOverrides.get(id) ?? input.position,
      facing: input.facing,
      manifest: input.manifest,
      atlasLeases: new Map(),
      reducedMotion: input.reducedMotion,
    });
    this.realActors.set(id, actor);
    return actor;
  }
}

class TerminalStickyFactories extends FakeFactories {
  override createActor(input: ProductionActorFactoryInput): LayeredHumanActor {
    const id = input.record.value.id!;
    this.actorInputs.push(input);
    const actor = new TerminalStickyActor(
      id,
      this.actorPositionOverrides.get(id) ?? input.position,
      this.drawTrace,
    );
    this.actors.set(id, actor);
    return actor as unknown as LayeredHumanActor;
  }
}

let nextFakeInstanceId = 1;

class FakeActor {
  readonly instanceId = nextFakeInstanceId++;
  readonly commands: HumanPrimitiveCommand[] = [];
  readonly advances: [number, number][] = [];
  readonly authoritativeSamples: Array<Readonly<{ position: Vec2; traveling: boolean; nowMs: number }>> = [];
  disposeCalls = 0;
  deadline: number | null = null;
  status: AgentSnapshot["status"] = "alive";
  terminal = false;
  routeActive = false;
  snapshotReads = 0;
  throwOnNextApply = false;

  constructor(
    readonly id: string,
    position: Vec2,
    private readonly trace: string[],
    private readonly atlasLeases: ReadonlyMap<string, ProductionAssetLease> | null = null,
  ) {
    this.position = { ...position };
  }

  position: Vec2;

  sampleAuthoritativeMotion(
    sample: Readonly<{ position: Vec2; traveling: boolean }>,
    nowMs: number,
  ): void {
    this.position = { ...sample.position };
    this.routeActive = sample.traveling;
    this.authoritativeSamples.push({ position: { ...sample.position }, traveling: sample.traveling, nowMs });
  }

  stagePosition(position: Vec2): (() => void) | null {
    if (this.terminal || this.status !== "alive") return null;
    const previous = { ...this.position };
    const previousRouteActive = this.routeActive;
    this.position = { ...position };
    this.routeActive = false;
    let available = true;
    return () => {
      if (!available) return;
      available = false;
      this.position = previous;
      this.routeActive = previousRouteActive;
    };
  }

  stageCommands(commands: readonly HumanPrimitiveCommand[]): () => void {
    const checkpoint = {
      position: { ...this.position },
      status: this.status,
      terminal: this.terminal,
      routeActive: this.routeActive,
      commandCount: this.commands.length,
    };
    let available = true;
    const rollback = (): void => {
      if (!available) return;
      available = false;
      this.position = checkpoint.position;
      this.status = checkpoint.status;
      this.terminal = checkpoint.terminal;
      this.routeActive = checkpoint.routeActive;
      this.commands.splice(checkpoint.commandCount);
    };
    try {
      for (const command of commands) this.apply(command);
    } catch (error) {
      rollback();
      throw error;
    }
    return rollback;
  }

  cancelFallbackReposition(): void {}

  apply(command: HumanPrimitiveCommand): void {
    if (this.throwOnNextApply) {
      this.throwOnNextApply = false;
      throw new Error(`actor command ${this.id}`);
    }
    this.commands.push(command);
    if (command.kind === "move") this.routeActive = this.status === "alive" && !this.terminal;
    if (command.kind === "reposition") {
      this.position = { ...command.position };
      this.routeActive = false;
    }
    if (command.kind === "orient" || command.kind === "play-body" || command.kind === "recover") {
      this.routeActive = false;
    }
    if (command.kind === "set-status") {
      this.status = command.status;
      this.terminal = command.status === "dead";
      this.routeActive = false;
    }
  }

  advance(deltaSeconds: number, nowMs: number): readonly ProductionActorSignal[] {
    this.advances.push([deltaSeconds, nowMs]);
    return [{ kind: "marker", actorId: this.id, marker: "settled", action: "idle", frameIndex: 0 }];
  }

  draw(): void { this.trace.push(`actor:${this.id}`); }

  snapshot(): LayeredHumanSnapshot {
    this.snapshotReads += 1;
    const last = this.commands.at(-1);
    const activeAction = last?.kind === "play-body" && last.action === "work"
      ? "working"
      : last?.kind === "move" ? "moving" : null;
    return {
      id: this.id,
      instanceId: this.instanceId,
      position: { ...this.position },
      facing: "south",
      terminal: this.terminal,
      routeActive: this.routeActive,
      activeAction,
    } as unknown as LayeredHumanSnapshot;
  }

  nextDeadlineMs(): number | null { return this.deadline; }
  dispose(): void {
    this.disposeCalls += 1;
    if (this.disposeCalls === 1) {
      for (const lease of new Set(this.atlasLeases?.values() ?? [])) lease.release();
    }
  }
}

class TerminalStickyActor extends FakeActor {
  override apply(command: HumanPrimitiveCommand): void {
    if (this.terminal) return;
    super.apply(command);
  }
}

class FakeHome {
  readonly instanceId = nextFakeInstanceId++;
  readonly reconciliations: PresentedHomeInput[] = [];
  readonly commands: unknown[] = [];
  readonly advances: number[] = [];
  readonly selectedCalls: boolean[] = [];
  disposeCalls = 0;
  deadline: number | null = null;
  throwOnNextReconcile = false;
  throwOnEveryReconcile = false;
  snapshotReads = 0;
  current: PresentedHomeInput;
  selected = false;

  constructor(readonly id: string, initial: PresentedHomeInput, private readonly trace: string[]) {
    this.current = initial;
  }

  reconcile(input: PresentedHomeInput): void {
    if (this.throwOnEveryReconcile || this.throwOnNextReconcile) {
      this.throwOnNextReconcile = false;
      throw new Error(`reconcile ${this.id}`);
    }
    this.current = input;
    this.reconciliations.push(input);
  }

  apply(command: unknown): void { this.commands.push(command); }
  setSelected(selected: boolean): void { this.selected = selected; this.selectedCalls.push(selected); }
  advanceTo(nowMs: number): readonly ProductionHomeSignal[] { this.advances.push(nowMs); return []; }
  draw(_context: CanvasRenderingContext2D, pass: "back" | "front"): void { this.trace.push(`home:${this.id}:${pass}`); }
  snapshot(): HomeActorSnapshot {
    this.snapshotReads += 1;
    const value = this.current.record.value;
    return {
      id: this.id,
      instanceId: this.instanceId,
      kit: this.current.kit,
      plot: { ...this.current.plot },
      door: { ...this.current.door },
      durable: {
        status: value.status === "ruin" ? "ruin" : value.status === "standing" ? "standing" : "unknown",
        integrityRatio: typeof value.integrity === "number" && typeof value.max_integrity === "number"
          && value.max_integrity > 0
          ? Math.max(0, Math.min(1, value.integrity / value.max_integrity))
          : null,
        ownerId: value.owner_id ?? null,
        stakeholderIds: value.stakeholders ?? null,
        vaultMaterials: value.vault_materials ?? null,
        hoarding: value.is_hoarding ?? null,
        breacherIds: value.breachers ?? null,
        remnantMaterials: value.remnant_materials ?? null,
        ruinSweepAge: null,
      },
      diagnostics: {
        rawIntegrity: value.integrity ?? null,
        rawMaxIntegrity: value.max_integrity ?? null,
        integrityClamped: false,
      },
      geometry: {
        logicalBounds: { width: 128, height: 128 },
        doorClearance: { x: this.current.door.x - 16, y: this.current.door.y - 16, width: 32, height: 32 },
      },
      visual: {
        backComponents: ["foundation"],
        frontComponents: ["shell"],
        ruinFrameId: value.status === "ruin" ? "ruin" : null,
      },
      transient: {
        provisional: false,
        activeKind: (this.commands.at(-1) as { kind?: HomeActorSnapshot["transient"]["activeKind"] } | undefined)?.kind ?? null,
        doorState: "closed",
        hearthState: "quiet",
        progress: 0,
        emittedMarkers: [],
      },
      selected: this.selected,
    } as unknown as HomeActorSnapshot;
  }
  nextDeadlineMs(): number | null { return this.deadline; }
  dispose(): void { this.disposeCalls += 1; }
}

class FakeEnvironment {
  readonly conditions: RegionCondition[];
  readonly advances: number[] = [];
  readonly effects: unknown[] = [];
  readonly exclusionZones: Array<readonly Readonly<{ x: number; y: number; width: number; height: number }>[]> = [];
  readonly anchorPositions: Array<Map<string, Readonly<{ x: number; y: number }>>> = [];
  disposeCalls = 0;
  deadline: number | null = null;
  throwOnNextReconcile = false;

  constructor(
    readonly regionId: string,
    initial: RegionCondition,
    private readonly trace: string[],
    private readonly atlasLeases: ReadonlyMap<string, ProductionAssetLease> | null = null,
  ) {
    this.conditions = [initial];
  }

  reconcile(condition: RegionCondition): void {
    if (this.throwOnNextReconcile) {
      this.throwOnNextReconcile = false;
      throw new Error(`environment reconcile ${this.regionId}`);
    }
    this.conditions.push(condition);
  }
  emit(effect: unknown): void { this.effects.push(effect); }
  setExclusionZones(zones: readonly Readonly<{ x: number; y: number; width: number; height: number }>[]): void {
    this.exclusionZones.push(zones.map((zone) => ({ ...zone })));
  }
  /** Live overlay anchors, refreshed alongside exclusion zones every tick. */
  setAnchorPositions(positions: ReadonlyMap<string, Readonly<{ x: number; y: number }>>): void {
    this.anchorPositions.push(new Map([...positions].map(([id, at]) => [id, { ...at }])));
  }
  advanceTo(nowMs: number): void { this.advances.push(nowMs); }
  draw(_context: CanvasRenderingContext2D, pass: "ground" | "air"): void {
    this.trace.push(`environment:${this.regionId}:${pass}`);
  }
  nextDeadlineMs(): number | null { return this.deadline; }
  diagnostics(): EnvironmentDiagnostics {
    return {
      disposed: this.disposeCalls > 0,
      vitality: this.conditions.at(-1)!.energyRatio,
    } as EnvironmentDiagnostics;
  }
  dispose(): void {
    this.disposeCalls += 1;
    if (this.disposeCalls === 1) {
      for (const lease of new Set(this.atlasLeases?.values() ?? [])) lease.release();
    }
  }
}

function coreAtlasLeases(): Map<string, ProductionAssetLease> {
  return new Map(Object.values(PRODUCTION_ASSET_MANIFEST.atlases)
    .filter(({ group }) => group === "core")
    .map(({ id }) => [id, {
      value: {} as ImageBitmap,
      release: vi.fn(),
    } satisfies ProductionAssetLease]));
}

function allAtlasLeases(): Map<string, ProductionAssetLease> {
  return new Map(Object.values(PRODUCTION_ASSET_MANIFEST.atlases).map(({ id }) => [id, {
    value: {} as ImageBitmap,
    release: vi.fn(),
  } satisfies ProductionAssetLease]));
}

function expectedLandmarkExclusionRects(
  recipe: ReturnType<typeof createRegionMapRecipe>,
): readonly Readonly<{ x: number; y: number; width: number; height: number }>[] {
  const byTile = new Map<string, Readonly<{ x: number; y: number; width: number; height: number }>>();
  for (const landmark of recipe.scenicLandmarks) {
    for (const offset of landmark.interactionExclusionOffsets) {
      const column = landmark.contactTile.column + offset.x;
      const row = landmark.contactTile.row + offset.y;
      byTile.set(`${column},${row}`, { x: column * 32, y: row * 32, width: 32, height: 32 });
    }
  }
  return [...byTile.values()].sort((left, right) => left.y - right.y || left.x - right.x);
}

function distancePoint(left: Vec2, right: Vec2): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function identityOf(value: PresentedObserverFrame) {
  return {
    runId: value.runId,
    sourceKey: value.sourceKey,
    revision: value.revision,
    firstCursor: value.firstCursor,
    lastCursor: value.lastCursor,
  };
}

function frame(options: Readonly<{
  runId?: string;
  sourceKey?: string;
  revision?: number;
  firstCursor?: number;
  lastCursor?: number;
  exactBaseCursor?: number;
  projectedThroughCursor?: number;
  exactHomes?: readonly HomeSnapshot[];
  exactRuins?: readonly HomeSnapshot[];
  agents?: readonly AgentSnapshot[];
  agentRecords?: readonly PresentedRecord<AgentSnapshot>[];
  regions?: readonly RegionSnapshot[];
  regionRecords?: readonly PresentedRecord<RegionSnapshot>[];
  homes?: readonly HomeSnapshot[];
  homeRecords?: readonly PresentedRecord<HomeSnapshot>[];
  ruins?: readonly HomeSnapshot[];
  ruinRecords?: readonly PresentedRecord<HomeSnapshot>[];
  scene?: PresentedSceneView | null;
  selection?: ObserverSelection;
  spatialPlayback?: PresentedObserverFrame["spatialPlayback"];
}> = {}): PresentedObserverFrame {
  const lastCursor = options.lastCursor ?? 1;
  return {
    runId: options.runId ?? "run-one",
    sourceKey: options.sourceKey ?? "live:run-one",
    revision: options.revision ?? 1,
    firstCursor: options.firstCursor ?? 1,
    lastCursor,
    source: "live",
    ingestedCursor: lastCursor,
    presentedCursor: lastCursor,
    ...(options.spatialPlayback === undefined ? {} : { spatialPlayback: options.spatialPlayback }),
    world: {
      exactBaseCursor: options.exactBaseCursor ?? lastCursor,
      projectedThroughCursor: options.projectedThroughCursor ?? lastCursor,
      ...(options.exactHomes === undefined ? {} : { exactHomes: options.exactHomes }),
      ...(options.exactRuins === undefined ? {} : { exactRuins: options.exactRuins }),
      worldTime: 100,
      agents: options.agentRecords ?? (options.agents ?? []).map(exact),
      regions: options.regionRecords ?? (options.regions ?? [region("alpha", [])]).map(exact),
      homes: options.homeRecords ?? (options.homes ?? []).map(exact),
      ruins: options.ruinRecords ?? (options.ruins ?? []).map(exact),
      pendingProposals: [],
    },
    scene: options.scene === undefined ? scene("alpha") : options.scene,
    selection: options.selection ?? null,
    backlog: {
      pendingMoments: 0,
      firstPendingCursor: null,
      lastPendingCursor: null,
      state: "caught-up",
      label: "Live",
    },
    transport: {
      connection: "live",
      ingestedCursor: lastCursor,
      retryable: false,
    },
  };
}

function scene(
  regionId: string,
  overrides: Partial<PresentedSceneView> = {},
): PresentedSceneView {
  return {
    momentId: `moment:${regionId}`,
    regionId,
    phase: "hold",
    focus: { kind: "system", regionId },
    dialogue: null,
    actorIntents: [],
    homeIntents: [],
    effectIntents: [],
    safeCancelMarkers: [],
    reducedMotion: false,
    ...overrides,
  };
}

function exact<T>(value: T): PresentedRecord<T> {
  return { completeness: "exact", value };
}

function sameTestPoint(left: Vec2, right: Vec2): boolean {
  return left.x === right.x && left.y === right.y;
}

function projected<T>(value: Partial<T>): PresentedRecord<T> {
  return { completeness: "projected-partial", value };
}

function agent(id: string, position: string): AgentSnapshot {
  return {
    id,
    name: id[0]!.toUpperCase() + id.slice(1),
    persona: `persona:${id}`,
    position,
    energy: 50,
    materials: 5,
    status: "alive",
    last_mated_at: null,
    offspring_count: 0,
    died_at: null,
    home_id: null,
    is_hoarding: false,
  };
}

function home(id: string, owner: string, regionId: string): HomeSnapshot {
  return {
    home_id: id,
    owner_id: owner,
    region: regionId,
    integrity: 100,
    max_integrity: 100,
    built_at: 1,
    last_upkeep_at: 1,
    last_integrity_at: 1,
    stakeholders: [owner],
    vault_materials: 0,
    status: "standing",
    ruined_at: null,
    remnant_materials: 0,
    breachers: [],
    is_hoarding: false,
  };
}

function placedPlotId(result: HomePlacementResult): string {
  if (result.status !== "placed") throw new Error(`expected a placed home, got ${result.status}`);
  return result.plotId;
}

function region(name: string, connections: readonly string[]): RegionSnapshot {
  return {
    name,
    description: name === "alpha" ? "a mild worn heartland" : "a dry scrubland",
    connections: [...connections],
    energy_rate: 1,
    materials_rate: 1,
    current_energy: 50,
    current_materials: 25,
    max_energy: 100,
    max_materials: 100,
  };
}
