import { afterEach, describe, expect, it, vi } from "vitest";

import type { AgentSnapshot, RegionSnapshot } from "../../app/schemas";
import type { PresentedObserverFrame } from "../../presentation/contracts";
import type {
  HumanPrimitiveCommand,
  LayeredHumanActor,
  ProductionActorSignal,
} from "./actors/LayeredHumanActor";
import { PRODUCTION_ASSET_MANIFEST, type ProductionAssetLease } from "./assets/productionManifest";
import type { EnvironmentSystem } from "./environment/EnvironmentSystem";
import type { HomeActor } from "./homes/HomeActor";
import { createRegionMapIdentity } from "./maps/RegionMapIdentity";
import { createRegionMapRecipe } from "./maps/RegionMapRecipe";
import { PlacementLedger } from "./placement/PlacementLedger";
import {
  createProductionSceneGraph,
  type ProductionActorFactoryInput,
  type ProductionEnvironmentFactoryInput,
  type ProductionHomeFactoryInput,
  type ProductionSceneFactories,
} from "./ProductionSceneGraph";
import { createProductionSceneDebugProbe } from "./debug";

describe("production scene debug probe", () => {
  it("exposes one observer-only snapshot method and no command surface", () => {
    const { graph } = makeHarness();
    const probe = createProductionSceneDebugProbe(graph);

    expect(Object.keys(probe)).toEqual(["snapshot"]);
    for (const forbidden of [
      "pause", "resume", "restart", "seek", "advance", "advanceBy", "setScene",
      "update", "updateTime", "draw", "dispose", "dispatch", "apply", "emit",
    ]) {
      expect(forbidden in probe).toBe(false);
    }
  });

  it("returns a complete detached deeply frozen observation of the accepted scene", () => {
    const { graph, actor } = makeHarness();
    graph.update(observerFrame());
    const probe = createProductionSceneDebugProbe(graph);
    const snapshot = probe.snapshot();

    expect(snapshot).toEqual(expect.objectContaining({
      disposed: false,
      generation: 1,
      identity: {
        runId: "run-debug",
        sourceKey: "fixture:debug",
        revision: 4,
        firstCursor: 2,
        lastCursor: 7,
      },
      cursors: {
        exactBase: 5,
        projectedThrough: 7,
        ingested: 9,
        presented: 7,
      },
      activeRegion: expect.objectContaining({
        id: "alpha",
        recipeIdentityHash: expect.any(String),
        staticCacheRebuilds: 1,
        condition: { energyRatio: 0.5, materialsRatio: 0.25 },
      }),
      actors: [expect.objectContaining({
        id: "aster",
        instanceId: actor.instanceId,
        position: expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }),
        facing: "south",
        status: "alive",
        terminal: false,
        selected: true,
      })],
      homes: [],
      environments: [expect.objectContaining({ regionId: "alpha" })],
      // Re-baselined deliberately: the graph's debug contract gained
      // `deferredHomes`, the counter that makes "a home could not be built this
      // frame and was deferred" visible instead of silent. The literal here was
      // exhaustive, so the new field made it stale.
      rejections: {
        invalid: 0,
        stale: 0,
        foreignLineage: 0,
        malformedRecords: 0,
        deferredHomes: 0,
      },
      recentMarkers: [],
    }));
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.identity!)).toBe(true);
    expect(Object.isFrozen(snapshot.actors)).toBe(true);
    expect(Object.isFrozen(snapshot.actors[0]!.position)).toBe(true);
    expect(() => {
      (snapshot.actors as unknown as unknown[]).push({});
    }).toThrow();

    const second = probe.snapshot();
    expect(second).not.toBe(snapshot);
    expect(second.actors).not.toBe(snapshot.actors);
    expect(second.actors[0]).not.toBe(snapshot.actors[0]);
  });

  it("observes rejection counters without changing accepted frame truth", () => {
    const { graph } = makeHarness();
    graph.update(observerFrame());
    const probe = createProductionSceneDebugProbe(graph);

    graph.update(observerFrame({ revision: 3, lastCursor: 8 }));
    graph.update(observerFrame({ runId: "foreign", revision: 99, lastCursor: 99 }));
    const invalid = observerFrame({ revision: 5, lastCursor: 9 });
    graph.update({ ...invalid, firstCursor: 10 });

    expect(probe.snapshot()).toEqual(expect.objectContaining({
      identity: expect.objectContaining({ revision: 4, lastCursor: 7 }),
      rejections: expect.objectContaining({ stale: 1, foreignLineage: 1, invalid: 1 }),
    }));
  });

  it("keeps a bounded immutable marker history while updateTime remains the sole clock input", () => {
    const { graph } = makeHarness();
    graph.update(observerFrame());
    const probe = createProductionSceneDebugProbe(graph);

    for (let index = 1; index <= 80; index += 1) graph.updateTime(0.016, index * 16);
    const markers = probe.snapshot().recentMarkers;

    expect(markers).toHaveLength(64);
    expect(markers[0]).toEqual(expect.objectContaining({ actorId: "aster", atMs: 272 }));
    expect(markers.at(-1)).toEqual(expect.objectContaining({ actorId: "aster", atMs: 1_280 }));
    expect(Object.isFrozen(markers)).toBe(true);
  });

  it("remains readable after disposal while reporting no live entities or deadline", () => {
    const { graph } = makeHarness();
    graph.update(observerFrame());
    const probe = createProductionSceneDebugProbe(graph);
    graph.dispose();

    expect(probe.snapshot()).toEqual(expect.objectContaining({
      disposed: true,
      actors: [],
      homes: [],
      environments: [],
      nextDeadlineMs: null,
    }));
    expect(Object.keys(probe)).toEqual(["snapshot"]);
  });
});

describe("production performance diagnostics global", () => {
  type DiagnosticsWindow = typeof window & {
    __vivariumEnableProductionDiagnosticsForTest?: boolean;
    __vivariumProductionDiagnosticsForTest?: Readonly<{
      snapshot(surface: Element): unknown | null;
    }>;
  };

  const scope = window as DiagnosticsWindow;

  afterEach(() => {
    delete scope.__vivariumEnableProductionDiagnosticsForTest;
    delete scope.__vivariumProductionDiagnosticsForTest;
    vi.resetModules();
  });

  it("does not publish a global accessor without the pre-document test flag", async () => {
    delete scope.__vivariumEnableProductionDiagnosticsForTest;
    delete scope.__vivariumProductionDiagnosticsForTest;
    vi.resetModules();
    const before = document.documentElement.outerHTML;

    await import("./debug");

    expect(scope.__vivariumProductionDiagnosticsForTest).toBeUndefined();
    expect(document.documentElement.outerHTML).toBe(before);
  });

  it("publishes one immutable snapshot-only accessor when the flag precedes module evaluation", async () => {
    scope.__vivariumEnableProductionDiagnosticsForTest = true;
    delete scope.__vivariumProductionDiagnosticsForTest;
    vi.resetModules();
    const before = document.documentElement.outerHTML;
    const api = await import("./debug");
    const surface = document.createElement("section");
    const snapshot = Object.freeze({ frame: 7, nested: Object.freeze({ source: "live" }) });
    const registration = api.installProductionStageDebugProbe(surface, Object.freeze({
      snapshot: () => snapshot,
    }));

    const accessor = Reflect.get(
      scope,
      "__vivariumProductionDiagnosticsForTest",
    ) as DiagnosticsWindow["__vivariumProductionDiagnosticsForTest"];
    expect(accessor).toBeDefined();
    expect(Object.isFrozen(accessor)).toBe(true);
    expect(Object.keys(accessor!)).toEqual(["snapshot"]);
    expect(accessor!.snapshot(surface)).toBe(snapshot);
    expect(accessor!.snapshot(document.createElement("div"))).toBeNull();
    for (const forbidden of ["install", "get", "release", "update", "draw", "dispose", "dispatch"]) {
      expect(forbidden in accessor!).toBe(false);
    }
    expect(document.documentElement.outerHTML).toBe(before);

    registration.release();
    expect(accessor!.snapshot(surface)).toBeNull();
  });
});

function makeHarness() {
  const region = regionSnapshot();
  const recipe = createRegionMapRecipe(createRegionMapIdentity(17, region, [region]));
  const agent = agentSnapshot();
  const placement = PlacementLedger.reconstruct([recipe], { agents: [agent], homes: [] });
  const actor = new MarkerActor(agent.id, placement.snapshot().agents.get(agent.id)!.point);
  const environment = new DebugEnvironment();
  const factories: ProductionSceneFactories = {
    createActor(input: ProductionActorFactoryInput): LayeredHumanActor {
      expect(input.record.value.id).toBe(agent.id);
      return actor as unknown as LayeredHumanActor;
    },
    createHome(_input: ProductionHomeFactoryInput): HomeActor {
      throw new Error("debug fixture has no homes");
    },
    createEnvironment(input: ProductionEnvironmentFactoryInput): EnvironmentSystem {
      environment.regionId = input.regionId;
      return environment as unknown as EnvironmentSystem;
    },
  };
  const graph = createProductionSceneGraph({
    manifest: PRODUCTION_ASSET_MANIFEST,
    factories,
    placement,
    recipes: new Map([[recipe.regionId, recipe]]),
    atlasLeases: new Map<string, ProductionAssetLease>(),
    reducedMotion: false,
  });
  return { graph, actor, environment };
}

class MarkerActor {
  readonly instanceId = 41;
  private nowMs = 0;
  private status: AgentSnapshot["status"] = "alive";
  private selected = false;

  constructor(readonly id: string, readonly position: Readonly<{ x: number; y: number }>) {}

  apply(command: HumanPrimitiveCommand): void {
    if (command.kind === "set-status") this.status = command.status;
    if (command.kind === "set-selected") this.selected = command.selected;
  }

  stageCommands(commands: readonly HumanPrimitiveCommand[], _nowMs: number): () => void {
    const checkpoint = { status: this.status, selected: this.selected };
    let available = true;
    const rollback = (): void => {
      if (!available) return;
      available = false;
      this.status = checkpoint.status;
      this.selected = checkpoint.selected;
    };
    try {
      for (const command of commands) this.apply(command);
    } catch (error) {
      rollback();
      throw error;
    }
    return rollback;
  }

  advance(_deltaSeconds: number, nowMs: number): readonly ProductionActorSignal[] {
    this.nowMs = nowMs;
    return [{
      kind: "marker",
      actorId: this.id,
      marker: "settled",
      action: "idle",
      frameIndex: 0,
    }];
  }

  draw(): void {}
  snapshot() {
    return {
      id: this.id,
      instanceId: this.instanceId,
      position: { ...this.position },
      facing: "south",
      terminal: this.status === "dead",
      selected: this.selected,
    };
  }
  nextDeadlineMs(): number | null { return this.nowMs === 0 ? 100 : this.nowMs + 100; }
  dispose(): void {}
}

class DebugEnvironment {
  regionId = "";
  reconcile(): void {}
  setExclusionZones(): void {}
  setAnchorPositions(): void {}
  advanceTo(): void {}
  draw(): void {}
  nextDeadlineMs(): number | null { return 120; }
  diagnostics() { return { disposed: false, vitality: 0.5 }; }
  dispose(): void {}
}

function observerFrame(overrides: Readonly<{
  runId?: string;
  revision?: number;
  firstCursor?: number;
  lastCursor?: number;
}> = {}): PresentedObserverFrame {
  const agent = agentSnapshot();
  const region = regionSnapshot();
  return {
    runId: overrides.runId ?? "run-debug",
    sourceKey: "fixture:debug",
    revision: overrides.revision ?? 4,
    firstCursor: overrides.firstCursor ?? 2,
    lastCursor: overrides.lastCursor ?? 7,
    source: "fixture",
    ingestedCursor: 9,
    presentedCursor: 7,
    world: {
      exactBaseCursor: 5,
      projectedThroughCursor: 7,
      worldTime: 100,
      agents: [{ completeness: "exact", value: agent }],
      regions: [{ completeness: "exact", value: region }],
      homes: [],
      ruins: [],
      pendingProposals: [],
    },
    scene: {
      momentId: "debug-moment",
      regionId: "alpha",
      phase: "hold",
      focus: { kind: "agent", id: "aster" },
      dialogue: null,
      actorIntents: [],
      homeIntents: [],
      effectIntents: [],
      safeCancelMarkers: [],
      reducedMotion: false,
    },
    selection: { kind: "agent", id: "aster" },
    backlog: {
      pendingMoments: 0,
      firstPendingCursor: null,
      lastPendingCursor: null,
      state: "caught-up",
      label: "Debug",
    },
    transport: { connection: "live", ingestedCursor: 9, retryable: false },
  };
}

function agentSnapshot(): AgentSnapshot {
  return {
    id: "aster",
    name: "Aster",
    persona: "patient",
    position: "alpha",
    energy: 50,
    materials: 4,
    status: "alive",
    last_mated_at: null,
    offspring_count: 0,
    died_at: null,
    home_id: null,
    is_hoarding: false,
  };
}

function regionSnapshot(): RegionSnapshot {
  return {
    name: "alpha",
    description: "a mild worn heartland",
    connections: [],
    energy_rate: 1,
    materials_rate: 1,
    current_energy: 50,
    current_materials: 25,
    max_energy: 100,
    max_materials: 100,
  };
}
