import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";

import { makeWorld } from "../test/fixtures";
import {
  allocateStateOwnedPointLightOwners,
  atmosphereStateAt,
  ATLAS_OBSERVER_CYCLE_PERIOD_SECONDS,
  biomeGroundBaseColors,
  observerCyclePhase,
  REDUCED_MOTION_OBSERVER_PHASE,
  sceneryDynamicClearings,
  STATE_OWNED_POINT_LIGHT_BUDGETS,
  visibleRenderedMeshBounds,
  WorldFrameScheduler,
  worldSceneryRecipeHash,
  worldTopologySignature,
  type AnimationFrameDriver,
  type StateOwnedPointLightCandidate,
} from "./WorldRenderer";
import {
  buildAtlasCrossings,
  buildRegionScenery,
  SCENERY_RENDER_BUDGETS,
} from "./regions/scenery";
import { placeRegionScenery } from "./regions/sceneryPlacement";
import { classifyCrossings, deriveAtlasLayout } from "./regions/atlasLayout";
import { deriveRegionVisualRecipe } from "./regions/visualRecipe";

describe("WorldRenderer performance lifecycle", () => {
  it("measures visual bounds without invisible selection geometry", () => {
    const root = new THREE.Group();
    root.position.set(3, 4, 5);
    root.scale.set(1, 2, 1);
    const visibleHome = new THREE.Mesh(
      new THREE.BoxGeometry(2, 2, 2),
      new THREE.MeshBasicMaterial(),
    );
    visibleHome.position.y = 1;
    const oversizedHitTarget = new THREE.Mesh(
      new THREE.BoxGeometry(20, 40, 20),
      new THREE.MeshBasicMaterial({ visible: false }),
    );
    oversizedHitTarget.position.y = 20;
    root.add(visibleHome, oversizedHitTarget);

    const bounds = visibleRenderedMeshBounds(root);

    expect(bounds.min.y).toBeCloseTo(4);
    expect(bounds.max.y).toBeCloseTo(8);
    expect(bounds.max.y - bounds.min.y).toBeCloseTo(4);
  });

  it.each(["full", "reduced", "tour"] as const)(
    "allocates %s state-owned lights deterministically with selected-owner reservation",
    (quality) => {
      const budget = STATE_OWNED_POINT_LIGHT_BUDGETS[quality];
      const candidates: StateOwnedPointLightCandidate[] = Array.from(
        { length: budget + 5 },
        (_, index) => ({
          ownerKind: index % 2 === 0 ? "agent" : "spring",
          ownerId: `owner_${String(index).padStart(2, "0")}`,
          intensity: index === budget + 4 ? 0.01 : 2,
          distanceSquared: index * 10,
        }),
      );
      const selectedOwner = `agent:owner_${String(budget + 4).padStart(2, "0")}`;
      const allocated = allocateStateOwnedPointLightOwners(
        candidates,
        quality,
        selectedOwner,
      );
      const reversed = allocateStateOwnedPointLightOwners(
        [...candidates].reverse(),
        quality,
        selectedOwner,
      );

      expect(allocated).toHaveLength(budget);
      expect(allocated).toContain(selectedOwner);
      expect(reversed).toEqual(allocated);
      expect(new Set(allocated).size).toBe(allocated.length);
    },
  );

  it("breaks adversarial equal-score state-light ties by stable owner key", () => {
    const agents: StateOwnedPointLightCandidate[] = Array.from({ length: 20 }, (_, index) => ({
      ownerKind: "agent",
      ownerId: `z_${String(19 - index).padStart(2, "0")}`,
      intensity: 1,
      distanceSquared: 25,
    }));
    const springs: StateOwnedPointLightCandidate[] = Array.from({ length: 20 }, (_, index) => ({
      ownerKind: "spring",
      ownerId: `a_${String(19 - index).padStart(2, "0")}`,
      intensity: 1,
      distanceSquared: 25,
    }));

    expect(allocateStateOwnedPointLightOwners([...agents, ...springs], "tour")).toEqual([
      "agent:z_00",
      "agent:z_01",
      "agent:z_02",
      "agent:z_03",
    ]);
  });

  it("derives a deterministic observer cycle and readable named atmosphere keys", () => {
    const snapshot = { run_id: "seeded-run", world_time: 123.5 };
    const phase = observerCyclePhase(snapshot);

    expect(ATLAS_OBSERVER_CYCLE_PERIOD_SECONDS).toBe(600);
    expect(REDUCED_MOTION_OBSERVER_PHASE).toBe(0.14);
    expect(observerCyclePhase(snapshot)).toBe(phase);
    expect(observerCyclePhase({ ...snapshot, world_time: snapshot.world_time + 600 })).toBeCloseTo(phase, 10);
    const day = atmosphereStateAt(0.4);
    const golden = atmosphereStateAt(REDUCED_MOTION_OBSERVER_PHASE);
    expect(day.key).toBe("day");
    expect(golden.key).toBe("golden-hour");
    const night = atmosphereStateAt(0.92);
    expect(night.key).toBe("night");
    expect(night.hemisphereIntensity).toBeGreaterThanOrEqual(0.26);
    expect(night.directionalIntensity).toBeGreaterThanOrEqual(0.85);
    expect(night.exposure).toBeGreaterThanOrEqual(0.9);
    expect(night.exposure).toBeLessThanOrEqual(1.12);
    expect(night.fogColor).toBe(night.skyHorizonColor);
    expect(day.waterTint).not.toBe(golden.waterTint);
    expect(golden.waterTint).not.toBe(night.waterTint);
    expect(night.waterTint).toBe("#3f6770");
  });

  it("invalidates static layers only when topology or static region metadata changes", () => {
    const world = makeWorld();
    const baseline = worldTopologySignature(world.regions);
    const dynamicOnly = makeWorld({
      regions: world.regions.map((region) => ({
        ...region,
        current_energy: region.current_energy / 2,
        current_materials: region.current_materials + 7,
      })),
      agents: world.agents.map((agent) => ({ ...agent, energy: agent.energy - 5 })),
      homes: [],
      ruins: [],
      pending_proposals: [{
        initiator_id: "agent_001",
        target_id: "agent_002",
        timestamp: 10,
        resources: { energy: 5 },
      }],
    });

    expect(worldTopologySignature(dynamicOnly.regions)).toBe(baseline);
    expect(worldTopologySignature([...world.regions].reverse())).toBe(baseline);
    expect(worldTopologySignature(world.regions.map((region) => ({
      ...region,
      connections: [...region.connections].reverse(),
    })))).toBe(baseline);
    expect(worldTopologySignature(world.regions.map((region, index) =>
      index === 0 ? { ...region, max_energy: region.max_energy + 1 } : region
    ))).not.toBe(baseline);
    expect(worldTopologySignature(world.regions.map((region, index) =>
      index === 0 ? { ...region, connections: [...region.connections, "new_land"] } : region
    ))).not.toBe(baseline);
  });

  it("derives deterministic agent, home, and ruin scenery clearings without entering the static recipe hash", () => {
    const world = makeWorld();
    const layout = deriveAtlasLayout(world.regions);
    const clearings = sceneryDynamicClearings(world, layout.regions);
    const reordered = sceneryDynamicClearings({
      ...world,
      agents: [...world.agents].reverse(),
      homes: [...world.homes].reverse(),
      ruins: [...world.ruins].reverse(),
    }, [...layout.regions].reverse());

    expect(clearings).toEqual(reordered);
    expect(clearings.map(({ kind, id, regionName }) => `${kind}:${id}:${regionName}`)).toEqual([
      "agent:agent_001:meadow",
      "agent:agent_002:grove",
      "home:home_001:meadow",
      "ruin:home_old:grove",
    ]);
    expect(clearings.every(({ x, z, radius }) => (
      Number.isFinite(x) && Number.isFinite(z) && radius >= 3
    ))).toBe(true);
    const movedWorld = {
      ...world,
      agents: world.agents.map((agent) => (
        agent.id === "agent_001" ? { ...agent, position: "grove" } : agent
      )),
    };
    const moved = sceneryDynamicClearings(movedWorld, layout.regions);
    expect(moved.find(({ id }) => id === "agent_001")?.regionName).toBe("grove");
    expect(moved.find(({ id }) => id === "agent_001")).not.toEqual(
      clearings.find(({ id }) => id === "agent_001"),
    );
    expect(worldSceneryRecipeHash(world.regions)).toBe(
      worldSceneryRecipeHash(movedWorld.regions),
    );
  });

  it("keeps scenery identity and biome palette stable across resource-only changes", () => {
    const world = makeWorld();
    const fullWasteland = {
      ...world.regions[0],
      description: "A nuclear wasteland, all but dead.",
      current_energy: world.regions[0].max_energy,
      current_materials: world.regions[0].max_materials,
    };
    const depletedWasteland = {
      ...fullWasteland,
      current_energy: 0,
      current_materials: 0,
    };

    expect(worldSceneryRecipeHash([fullWasteland])).toBe(
      worldSceneryRecipeHash([depletedWasteland]),
    );
    expect(worldSceneryRecipeHash([fullWasteland], "full")).not.toBe(
      worldSceneryRecipeHash([fullWasteland], "reduced"),
    );
    expect(deriveRegionVisualRecipe(fullWasteland).archetype).toBe("ash_waste");
    expect(biomeGroundBaseColors("ash_waste")).toEqual(["#57504a", "#48413c"]);
    expect(biomeGroundBaseColors("ash_waste")).not.toEqual(
      biomeGroundBaseColors("neutral_temperate"),
    );
  });

  it.each(["full", "reduced", "tour"] as const)(
    "keeps an eight-region %s scenery fixture within explicit budgets",
    (quality) => {
      const base = makeWorld().regions[0];
      const descriptions = [
        "nuclear wasteland",
        "hot spring lakes",
        "struggling near-barren stretch",
        "once heavenly and picked over",
        "temperate coast",
        "hot spring lake refuge",
        "barren dry scrub",
        "temperate meadow",
      ];
      const regions = descriptions.map((description, index) => ({
        ...base,
        name: `region_${index}`,
        description,
        connections: descriptions
          .map((_, neighbor) => neighbor)
          .filter((neighbor) => neighbor !== index)
          .map((neighbor) => `region_${neighbor}`),
        max_energy: 80 + index,
      }));
      const layout = deriveAtlasLayout(regions);
      const layoutsById = new Map(layout.regions.map((region) => [region.id, region]));
      const totals = regions.reduce((result, region) => {
        const recipe = deriveRegionVisualRecipe(region);
        const regionLayout = layoutsById.get(region.name);
        if (!regionLayout) {
          throw new Error(`Missing layout for ${region.name}`);
        }
        const placements = placeRegionScenery({
          regionId: region.name,
          visualSeed: recipe.visualSeed,
          archetype: recipe.archetype,
          radius: regionLayout.radius,
          quality,
          maskAt: (x, z) => Math.hypot(x, z) < regionLayout.radius * 0.9 ? 1 : 0,
          heightAt: () => 1,
          exclusions: [{ x: 0, z: 0, radius: 3 }],
        });
        const layer = buildRegionScenery({
          recipe,
          layout: regionLayout,
          placements,
          quality,
          terrainHeight: () => 1,
        });
        result.instances += layer.instanceCount;
        result.objects += layer.objectCount;
        layer.dispose();
        return result;
      }, { instances: 0, objects: 0 });
      const crossingLayer = buildAtlasCrossings({
        crossings: classifyCrossings(layout, regions),
        regionsById: layoutsById,
        quality,
        terrainHeight: () => 0.4,
        coastMask: (region, x, z) => (
          Math.hypot(x - region.x, z - region.z) < region.radius ? 1 : 0
        ),
      });
      totals.instances += crossingLayer.instanceCount;
      totals.objects += crossingLayer.objectCount;
      crossingLayer.dispose();
      const budget = SCENERY_RENDER_BUDGETS[quality];

      expect(totals.instances).toBeLessThanOrEqual(budget.instancesPerRegion * 8);
      expect(totals.objects).toBeLessThanOrEqual(budget.objectsPerRegion * 8);
    },
  );

  it("caps live frame work at 60 Hz even when animation frames arrive at 120 Hz", () => {
    const driver = new FakeAnimationFrameDriver();
    const render = vi.fn();
    const scheduler = new WorldFrameScheduler("live", render, {
      driver,
      maximumFramesPerSecond: 60,
    });

    scheduler.start();
    for (let timestamp = 0; timestamp <= 1_000; timestamp += 1000 / 120) {
      driver.flushNext(timestamp);
    }

    expect(render.mock.calls.length).toBeGreaterThanOrEqual(59);
    expect(render.mock.calls.length).toBeLessThanOrEqual(61);
    expect(driver.pendingCount()).toBe(1);
    scheduler.dispose();
    expect(driver.pendingCount()).toBe(0);
  });

  it("renders a demand frame once and stays idle until another explicit request", () => {
    const driver = new FakeAnimationFrameDriver();
    const render = vi.fn();
    const scheduler = new WorldFrameScheduler("demand", render, { driver });

    scheduler.start();
    expect(driver.pendingCount()).toBe(1);
    driver.flushNext(10);
    expect(render).toHaveBeenCalledTimes(1);
    expect(driver.pendingCount()).toBe(0);
    expect(scheduler.isFrameScheduled()).toBe(false);

    scheduler.requestRender();
    scheduler.requestRender();
    expect(driver.pendingCount()).toBe(1);
    driver.flushNext(20);
    expect(render).toHaveBeenCalledTimes(2);
    expect(driver.pendingCount()).toBe(0);
  });

  it("deduplicates and cancels a scheduled animation frame whose handle is zero", () => {
    const driver = new ZeroHandleAnimationFrameDriver();
    const scheduler = new WorldFrameScheduler("demand", vi.fn(), { driver });

    scheduler.start();
    scheduler.requestRender();

    expect(driver.requestCount).toBe(1);
    expect(scheduler.isFrameScheduled()).toBe(true);
    scheduler.dispose();
    expect(driver.cancelledHandles).toEqual([0]);
  });
});

class ZeroHandleAnimationFrameDriver implements AnimationFrameDriver {
  requestCount = 0;
  readonly cancelledHandles: number[] = [];

  request(_callback: FrameRequestCallback): number {
    this.requestCount += 1;
    return 0;
  }

  cancel(handle: number): void {
    this.cancelledHandles.push(handle);
  }
}

class FakeAnimationFrameDriver implements AnimationFrameDriver {
  private nextHandle = 1;
  private readonly callbacks = new Map<number, FrameRequestCallback>();

  request(callback: FrameRequestCallback): number {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.callbacks.set(handle, callback);
    return handle;
  }

  cancel(handle: number): void {
    this.callbacks.delete(handle);
  }

  flushNext(timestamp: number): void {
    const entry = this.callbacks.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined;
    if (!entry) {
      throw new Error("No animation frame is pending.");
    }
    const [handle, callback] = entry;
    this.callbacks.delete(handle);
    callback(timestamp);
  }

  pendingCount(): number {
    return this.callbacks.size;
  }
}
