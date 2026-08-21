import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
  placeRegionScenery,
  SCENERY_QUALITY_CAPS,
  type SceneryPlacement,
} from "./sceneryPlacement";
import {
  buildAtlasCrossings,
  buildRegionScenery,
} from "./scenery";
import type { AtlasCrossing, AtlasRegionLayout } from "./atlasLayout";
import type { RegionVisualRecipeV1 } from "./visualRecipe";

const input = {
  regionId: "nirvana_west",
  visualSeed: 12345,
  archetype: "ash_waste" as const,
  radius: 20,
  quality: "full" as const,
  maskAt: (x: number, z: number) => Math.hypot(x, z) < 18 ? 1 : 0,
  heightAt: () => 1,
  exclusions: [{ x: 0, z: 0, radius: 4 }],
};

const EXPECTED_CROSSING_INSTANCE_BUDGETS = {
  full: { total: 128, perCrossing: 40 },
  reduced: { total: 72, perCrossing: 24 },
  tour: { total: 36, perCrossing: 12 },
} as const;

describe("placeRegionScenery", () => {
  it("is deterministic, on land, and outside exclusions", () => {
    const first = placeRegionScenery(input);
    expect(first).toEqual(placeRegionScenery(input));
    expect(first.length).toBeGreaterThan(0);
    for (const [index, point] of first.entries()) {
      expect(input.maskAt(point.x, point.z)).toBeGreaterThan(0.18);
      expect(Math.hypot(point.x, point.z)).toBeGreaterThanOrEqual(
        4 + point.radius,
      );
      for (const other of first.slice(index + 1)) {
        expect(Math.hypot(point.x - other.x, point.z - other.z)).toBeGreaterThanOrEqual(
          point.radius + other.radius,
        );
      }
    }
  });

  it("returns a stable subset when placement space is exhausted", () => {
    const blocked = { ...input, exclusions: [{ x: 0, z: 0, radius: 40 }] };
    expect(placeRegionScenery(blocked)).toEqual([]);
  });

  it("rejects submerged samples and obeys deterministic quality caps", () => {
    expect(placeRegionScenery({ ...input, heightAt: () => 0.05 })).toEqual([]);

    const full = placeRegionScenery(input);
    const reduced = placeRegionScenery({ ...input, quality: "reduced" });
    const tour = placeRegionScenery({ ...input, quality: "tour" });

    expect(full.length).toBeLessThanOrEqual(SCENERY_QUALITY_CAPS.full);
    expect(reduced.length).toBeLessThanOrEqual(SCENERY_QUALITY_CAPS.reduced);
    expect(tour.length).toBeLessThanOrEqual(SCENERY_QUALITY_CAPS.tour);
    expect(full.slice(0, reduced.length)).toEqual(reduced);
    expect(reduced.slice(0, tour.length)).toEqual(tour);
  });
});

const layout: AtlasRegionLayout = {
  id: "warm_springs",
  x: 12,
  z: -8,
  radius: 20,
  relief: 3,
  dome: 1.5,
};

function recipe(
  archetype: RegionVisualRecipeV1["archetype"],
): RegionVisualRecipeV1 {
  return {
    version: 1,
    regionId: layout.id,
    visualSeed: 12345,
    archetype,
    identity: { source: "description-keyword", normalizedDescription: archetype },
    potential: {
      energyRate: 0.1,
      materialsRate: 0.1,
      maxEnergy: 100,
      maxMaterials: 100,
    },
    condition: { energyRatio: 0.5, materialsRatio: 0.5 },
  };
}

const placements: SceneryPlacement[] = [
  {
    id: "warm_springs:conifer:0",
    kind: "conifer",
    x: -2,
    y: 1,
    z: 3,
    rotation: 0.5,
    scale: 1,
    radius: 0.62,
  },
  {
    id: "warm_springs:conifer:1",
    kind: "conifer",
    x: 4,
    y: 1.2,
    z: -1,
    rotation: 1.5,
    scale: 0.8,
    radius: 0.62,
  },
];

describe("buildRegionScenery", () => {
  it("instances repeated props and disposes owned GPU resources", () => {
    const layer = buildRegionScenery({
      recipe: recipe("neutral_temperate"),
      layout,
      placements,
      quality: "full",
      terrainHeight: () => 1,
    });
    const instanced = layer.root.children.find(
      (child) => child instanceof THREE.InstancedMesh,
    );
    expect(instanced).toBeTruthy();
    expect(layer.instanceCount).toBe(2);
    expect(layer.objectCount).toBeGreaterThan(0);

    let geometryDisposals = 0;
    let materialDisposals = 0;
    if (instanced && "geometry" in instanced && "material" in instanced) {
      instanced.geometry.addEventListener("dispose", () => geometryDisposals += 1);
      const material = Array.isArray(instanced.material)
        ? instanced.material[0]
        : instanced.material;
      material.addEventListener("dispose", () => materialDisposals += 1);
    }
    layer.dispose();
    expect(layer.root.children).toEqual([]);
    expect(geometryDisposals).toBe(1);
    expect(materialDisposals).toBe(1);
  });

  it("masks and restores colliding instances without replacing static scenery objects", () => {
    const layer = buildRegionScenery({
      recipe: recipe("neutral_temperate"),
      layout,
      placements,
      quality: "full",
      terrainHeight: () => 1,
    });
    const instanced = layer.root.children.find(
      (child) => child instanceof THREE.InstancedMesh,
    ) as THREE.InstancedMesh;
    const rootIdentity = layer.root;
    const meshIdentity = instanced;
    const baseMatrices = Array.from(instanced.instanceMatrix.array);

    expect(layer.clearanceState()).toEqual({ clearanceCount: 0, maskedInstanceCount: 0 });
    expect(layer.updateClearings([{
      x: layout.x + placements[0].x,
      z: layout.z + placements[0].z,
      radius: 0.2,
    }])).toEqual({ clearanceCount: 1, maskedInstanceCount: 1 });
    expect(layer.root).toBe(rootIdentity);
    expect(layer.root.children.find((child) => child instanceof THREE.InstancedMesh)).toBe(meshIdentity);
    expect(layer.instanceCount).toBe(2);
    expect(layer.objectCount).toBeGreaterThan(0);
    const firstMaskedMatrices = Array.from(instanced.instanceMatrix.array);
    expect(firstMaskedMatrices.slice(0, 12)).toEqual([
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);
    expect(firstMaskedMatrices.slice(16)).toEqual(baseMatrices.slice(16));

    expect(layer.updateClearings([{
      x: layout.x + placements[1].x,
      z: layout.z + placements[1].z,
      radius: 0.2,
    }])).toEqual({ clearanceCount: 1, maskedInstanceCount: 1 });
    const secondMaskedMatrices = Array.from(instanced.instanceMatrix.array);
    expect(secondMaskedMatrices.slice(0, 16)).toEqual(baseMatrices.slice(0, 16));
    expect(secondMaskedMatrices.slice(16, 28)).toEqual([
      0, 0, 0, 0,
      0, 0, 0, 0,
      0, 0, 0, 0,
    ]);

    expect(layer.updateClearings([])).toEqual({ clearanceCount: 0, maskedInstanceCount: 0 });
    expect(Array.from(instanced.instanceMatrix.array)).toEqual(baseMatrices);
    layer.dispose();
  });

  it("owns the spring pools, steam, and spring light in the spring layer", () => {
    const terrainHeight = (x: number, z: number) => 1 + x * 0.01 + z * 0.02;
    const layer = buildRegionScenery({
      recipe: recipe("spring_terraces"),
      layout,
      placements: [],
      quality: "full",
      terrainHeight,
    });
    expect(layer.landmarkKinds).toEqual([
      "spring_pool",
      "spring_steam",
      "spring_light",
    ]);
    const springLight = layer.root.getObjectByName("spring-terraces-light");
    expect(springLight?.type).toBe("PointLight");
    expect(springLight?.userData.stateOwnedPointLight).toEqual({
      ownerKind: "spring",
      ownerId: "warm_springs",
      intensity: 3,
    });
    expect(layer.root.userData.stateOwnedPointLightCandidates).toHaveLength(1);
    expect(layer.root.userData.stateOwnedPointLightCandidates[0]).toMatchObject({
      ownerKind: "spring",
      ownerId: "warm_springs",
      intensity: 3,
      light: springLight,
    });
    const pools = layer.root.children.filter((child) => (
      child.name.startsWith("spring-pool:")
    ));
    expect(pools).toHaveLength(3);
    for (const pool of pools) {
      expect(pool.position.y).toBeCloseTo(
        terrainHeight(pool.position.x, pool.position.z) + 0.08,
        6,
      );
    }
    layer.dispose();
  });
});

describe("buildAtlasCrossings", () => {
  it("builds all crossing kits with landings inset inside both coasts", () => {
    const from: AtlasRegionLayout = { ...layout, id: "from", x: -30, z: 0 };
    const to: AtlasRegionLayout = { ...layout, id: "to", x: 30, z: 0 };
    const crossings: AtlasCrossing[] = [
      { id: "stone", from: "from", to: "to", kind: "stone_bridge", gap: 8 },
      { id: "timber", from: "from", to: "to", kind: "timber_causeway", gap: 14 },
      { id: "sand", from: "from", to: "to", kind: "sandbar_ford", gap: 24 },
    ];
    const layer = buildAtlasCrossings({
      crossings,
      regionsById: new Map([[from.id, from], [to.id, to]]),
      quality: "full",
      terrainHeight: () => 0.4,
      coastMask: (region, x, z) => (
        Math.hypot(x - region.x, z - region.z) <= region.radius * 0.62 ? 1 : 0
      ),
    });

    expect(layer.landmarkKinds).toEqual([
      "sandbar_ford",
      "stone_bridge",
      "timber_causeway",
    ]);
    expect(layer.root.children).toHaveLength(3);
    for (const crossing of layer.root.children) {
      const landing = crossing.userData.landing as {
        from: { x: number; z: number };
        to: { x: number; z: number };
      };
      expect(Math.hypot(landing.from.x - from.x, landing.from.z - from.z))
        .toBeLessThanOrEqual(from.radius * 0.7);
      expect(Math.hypot(landing.to.x - to.x, landing.to.z - to.z))
        .toBeLessThanOrEqual(to.radius * 0.7);
      expect(
        Math.hypot(landing.from.x - from.x, landing.from.z - from.z),
      ).toBeLessThanOrEqual(from.radius * 0.62);
      expect(
        Math.hypot(landing.to.x - to.x, landing.to.z - to.z),
      ).toBeLessThanOrEqual(to.radius * 0.62);
    }
    layer.dispose();
  });

  it.each(["full", "reduced", "tour"] as const)(
    "caps adversarial timber causeways in %s quality while spanning every edge",
    (quality) => {
      const from: AtlasRegionLayout = {
        ...layout,
        id: "giant_from",
        x: 0,
        z: 0,
        radius: 1_000,
      };
      const to: AtlasRegionLayout = {
        ...layout,
        id: "giant_to",
        x: 2_014,
        z: 0,
        radius: 1_000,
      };
      const crossing = (index: number): AtlasCrossing => ({
        id: `giant-timber-${index}`,
        from: from.id,
        to: to.id,
        kind: "timber_causeway",
        gap: 14,
      });
      const options = {
        regionsById: new Map([[from.id, from], [to.id, to]]),
        quality,
        terrainHeight: () => 0.4,
        coastMask: (region: AtlasRegionLayout, x: number, z: number) => (
          Math.hypot(x - region.x, z - region.z) <= region.radius * 0.9 ? 1 : 0
        ),
      };
      const single = buildAtlasCrossings({ ...options, crossings: [crossing(0)] });
      const budget = EXPECTED_CROSSING_INSTANCE_BUDGETS[quality];
      const drawable = single.root.children[0] as THREE.InstancedMesh;
      const landing = drawable.userData.landing as {
        from: { x: number; z: number };
        to: { x: number; z: number };
      };

      expect(single.root.children).toHaveLength(1);
      expect(single.instanceCount).toBe(budget.perCrossing);
      expect(drawable.count).toBe(budget.perCrossing);
      expect(landing.from.x).toBeCloseTo(820, 6);
      expect(landing.to.x).toBeCloseTo(1_194, 6);
      const segmentLength = (landing.to.x - landing.from.x) / drawable.count;
      const firstMatrix = new THREE.Matrix4();
      const lastMatrix = new THREE.Matrix4();
      drawable.getMatrixAt(0, firstMatrix);
      drawable.getMatrixAt(drawable.count - 1, lastMatrix);
      const firstPosition = new THREE.Vector3();
      const firstScale = new THREE.Vector3();
      const lastPosition = new THREE.Vector3();
      firstMatrix.decompose(firstPosition, new THREE.Quaternion(), firstScale);
      lastMatrix.decompose(lastPosition, new THREE.Quaternion(), new THREE.Vector3());
      expect(firstPosition.x - landing.from.x).toBeCloseTo(segmentLength / 2, 3);
      expect(landing.to.x - lastPosition.x).toBeCloseTo(segmentLength / 2, 3);
      expect(firstScale.x).toBeGreaterThanOrEqual(segmentLength);
      single.dispose();

      const repeatedCrossings = Array.from({ length: 12 }, (_, index) => crossing(index));
      const repeated = buildAtlasCrossings({
        ...options,
        crossings: repeatedCrossings,
      });
      expect(repeated.root.children).toHaveLength(repeatedCrossings.length);
      expect(repeated.instanceCount).toBeLessThanOrEqual(budget.total);
      for (const child of repeated.root.children) {
        if (child instanceof THREE.InstancedMesh) {
          expect(child.count).toBeLessThanOrEqual(budget.perCrossing);
        }
      }
      repeated.dispose();
    },
  );
});
