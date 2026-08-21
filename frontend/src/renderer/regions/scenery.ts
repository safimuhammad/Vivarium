import * as THREE from "three";

import type {
  AtlasCrossing,
  AtlasRegionLayout,
  CrossingKind,
} from "./atlasLayout";
import type {
  SceneryPlacement,
  SceneryPropKind,
  SceneryQuality,
} from "./sceneryPlacement";
import type { RegionVisualRecipeV1 } from "./visualRecipe";

export interface RegionSceneryLayer {
  root: THREE.Group;
  objectCount: number;
  instanceCount: number;
  landmarkKinds: string[];
  updateClearings(clearings: readonly SceneryDynamicClearance[]): SceneryClearanceState;
  clearanceState(): SceneryClearanceState;
  dispose(): void;
}

export interface SceneryDynamicClearance {
  x: number;
  z: number;
  radius: number;
}

export interface SceneryClearanceState {
  clearanceCount: number;
  maskedInstanceCount: number;
}

interface ClearableInstanceRecord {
  mesh: THREE.InstancedMesh;
  placements: readonly SceneryPlacement[];
  baseMatrices: Float32Array;
  masked: Uint8Array;
}

export interface BuildRegionSceneryOptions {
  recipe: RegionVisualRecipeV1;
  layout: AtlasRegionLayout;
  placements: readonly SceneryPlacement[];
  quality: SceneryQuality;
  terrainHeight(x: number, z: number): number;
}

export interface BuildAtlasCrossingsOptions {
  crossings: readonly AtlasCrossing[];
  regionsById: ReadonlyMap<string, AtlasRegionLayout>;
  quality: SceneryQuality;
  terrainHeight(x: number, z: number): number;
  coastMask(region: AtlasRegionLayout, x: number, z: number): number;
}

const COAST_LANDING_START_RATIO = 0.82;
const COAST_LANDING_MINIMUM_RATIO = 0.5;
const COAST_LANDING_STEP = 0.04;

export const SCENERY_RENDER_BUDGETS: Readonly<
  Record<SceneryQuality, { instancesPerRegion: number; objectsPerRegion: number }>
> = {
  full: { instancesPerRegion: 48, objectsPerRegion: 18 },
  reduced: { instancesPerRegion: 28, objectsPerRegion: 14 },
  tour: { instancesPerRegion: 14, objectsPerRegion: 10 },
};

export const CROSSING_INSTANCE_BUDGETS: Readonly<
  Record<SceneryQuality, { total: number; perCrossing: number }>
> = {
  full: { total: 128, perCrossing: 40 },
  reduced: { total: 72, perCrossing: 24 },
  tour: { total: 36, perCrossing: 12 },
};

/** Build one disposable, instanced biome scenery layer in atlas-world coordinates. */
export function buildRegionScenery(
  options: BuildRegionSceneryOptions,
): RegionSceneryLayer {
  const root = new THREE.Group();
  root.name = `region-scenery:${options.recipe.regionId}`;
  root.userData = {
    archetype: options.recipe.archetype,
    regionId: options.recipe.regionId,
    recipeVersion: options.recipe.version,
  };
  const landmarkKinds: string[] = [];
  const placementsByKind = groupPlacements(options.placements);
  const matrix = new THREE.Object3D();
  const clearableInstances: ClearableInstanceRecord[] = [];

  for (const [kind, placements] of placementsByKind) {
    const mesh = new THREE.InstancedMesh(
      geometryForProp(kind),
      materialForProp(kind),
      placements.length,
    );
    mesh.name = `scenery-instances:${kind}`;
    mesh.userData = { kind };
    mesh.castShadow = options.quality === "full" && placements.length <= 24;
    mesh.receiveShadow = kind === "rock" || kind === "basalt";
    placements.forEach((placement, index) => {
      matrix.position.set(
        options.layout.x + placement.x,
        placement.y + propLift(kind),
        options.layout.z + placement.z,
      );
      matrix.rotation.set(0, placement.rotation, propTilt(kind, placement.id));
      matrix.scale.setScalar(placement.scale);
      matrix.updateMatrix();
      mesh.setMatrixAt(index, matrix.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    root.add(mesh);
    clearableInstances.push({
      mesh,
      placements,
      baseMatrices: new Float32Array(mesh.instanceMatrix.array),
      masked: new Uint8Array(placements.length),
    });
  }

  buildBiomeLandmark(root, options, landmarkKinds);
  return ownedLayer(
    root,
    options.placements.length,
    landmarkKinds,
    clearableInstances,
    options.layout,
  );
}

/** Build all declared atlas crossings once, skipping unresolved endpoints safely. */
export function buildAtlasCrossings(
  options: BuildAtlasCrossingsOptions,
): RegionSceneryLayer {
  const root = new THREE.Group();
  root.name = "atlas-crossings";
  const crossingKinds = new Set<string>();
  let instanceCount = 0;
  const resolvedCrossings = options.crossings.flatMap((crossing) => {
    const from = options.regionsById.get(crossing.from);
    const to = options.regionsById.get(crossing.to);
    if (!from || !to) {
      return [];
    }
    return [{ crossing, from, to }];
  }).sort((left, right) => compareText(left.crossing.id, right.crossing.id));
  let remainingInstanceBudget = CROSSING_INSTANCE_BUDGETS[options.quality].total;
  let remainingTimberCrossings = resolvedCrossings.filter(
    ({ crossing }) => crossing.kind === "timber_causeway",
  ).length;

  for (const { crossing, from, to } of resolvedCrossings) {
    const instanceLimit = crossing.kind === "timber_causeway"
      ? Math.min(
          CROSSING_INSTANCE_BUDGETS[options.quality].perCrossing,
          remainingTimberCrossings > 0
            ? Math.ceil(remainingInstanceBudget / remainingTimberCrossings)
            : 0,
        )
      : 0;
    const kit = crossingKit(
      crossing,
      from,
      to,
      options.terrainHeight,
      options.coastMask,
      instanceLimit,
    );
    root.add(kit.root);
    instanceCount += kit.instanceCount;
    remainingInstanceBudget -= kit.instanceCount;
    if (crossing.kind === "timber_causeway") {
      remainingTimberCrossings -= 1;
    }
    crossingKinds.add(crossing.kind);
  }

  return ownedLayer(root, instanceCount, [...crossingKinds].sort());
}

function groupPlacements(
  placements: readonly SceneryPlacement[],
): Map<SceneryPropKind, SceneryPlacement[]> {
  const grouped = new Map<SceneryPropKind, SceneryPlacement[]>();
  for (const placement of placements) {
    const group = grouped.get(placement.kind) ?? [];
    group.push(placement);
    grouped.set(placement.kind, group);
  }
  return grouped;
}

function geometryForProp(kind: SceneryPropKind): THREE.BufferGeometry {
  switch (kind) {
    case "conifer":
      return new THREE.ConeGeometry(0.72, 3.8, 6);
    case "deciduous":
      return new THREE.DodecahedronGeometry(1.05, 0);
    case "dead_trunk":
      return new THREE.CylinderGeometry(0.15, 0.25, 2.8, 5);
    case "thorn_scrub":
      return new THREE.ConeGeometry(0.75, 0.8, 5);
    case "rock":
      return new THREE.DodecahedronGeometry(0.62, 0);
    case "basalt":
      return new THREE.CylinderGeometry(0.38, 0.58, 1.8, 5);
    case "reed":
      return new THREE.CylinderGeometry(0.045, 0.07, 1.25, 4);
    case "stump":
      return new THREE.CylinderGeometry(0.3, 0.38, 0.58, 7);
    case "timber":
      return new THREE.BoxGeometry(1.8, 0.24, 0.3);
    case "ember_fissure":
      return new THREE.BoxGeometry(1.25, 0.035, 0.12);
  }
}

function materialForProp(kind: SceneryPropKind): THREE.Material {
  const color: Readonly<Record<SceneryPropKind, string>> = {
    conifer: "#294f3d",
    deciduous: "#58734b",
    dead_trunk: "#42342d",
    thorn_scrub: "#77683f",
    rock: "#746f63",
    basalt: "#332f31",
    reed: "#7e9a64",
    stump: "#594535",
    timber: "#66503a",
    ember_fissure: "#e55d2a",
  };
  if (kind === "ember_fissure") {
    return new THREE.MeshBasicMaterial({ color: color[kind] });
  }
  return new THREE.MeshStandardMaterial({
    color: color[kind],
    roughness: 0.92,
    flatShading: true,
  });
}

function propLift(kind: SceneryPropKind): number {
  switch (kind) {
    case "conifer": return 1.9;
    case "deciduous": return 1.2;
    case "dead_trunk": return 1.4;
    case "thorn_scrub": return 0.4;
    case "rock": return 0.38;
    case "basalt": return 0.9;
    case "reed": return 0.62;
    case "stump": return 0.29;
    case "timber": return 0.16;
    case "ember_fissure": return 0.04;
  }
}

function propTilt(kind: SceneryPropKind, id: string): number {
  if (kind !== "dead_trunk" && kind !== "timber") {
    return 0;
  }
  return ((stringHash(id) % 17) - 8) * 0.018;
}

function buildBiomeLandmark(
  root: THREE.Group,
  options: BuildRegionSceneryOptions,
  landmarkKinds: string[],
): void {
  switch (options.recipe.archetype) {
    case "spring_terraces":
      buildSpringTerraces(
        root,
        options.layout,
        options.quality,
        options.terrainHeight,
      );
      landmarkKinds.push("spring_pool", "spring_steam", "spring_light");
      break;
    case "ash_waste":
      landmarkKinds.push("blasted_grove", "basalt_field", "ember_fissures");
      break;
    case "dry_scrub":
      landmarkKinds.push("thorn_scrub", "dry_stones");
      break;
    case "worn_heartland":
      buildGroundFacet(
        root,
        options.layout,
        options.terrainHeight,
        "#77684c",
        "bare-patch",
      );
      landmarkKinds.push("pine_grove", "stump_field", "bare_patch");
      break;
    case "neutral_temperate":
      buildGroundFacet(
        root,
        options.layout,
        options.terrainHeight,
        "#73865a",
        "meadow-facet",
      );
      landmarkKinds.push("meadow_facet", "mixed_woodland");
      break;
  }
}

function buildSpringTerraces(
  root: THREE.Group,
  layout: AtlasRegionLayout,
  quality: SceneryQuality,
  terrainHeight: (x: number, z: number) => number,
): void {
  const poolGeometry = new THREE.CylinderGeometry(1, 1.12, 0.12, 16);
  const poolMaterial = new THREE.MeshStandardMaterial({
    color: "#62b6ad",
    emissive: "#1b4f4b",
    emissiveIntensity: 0.28,
    transparent: true,
    opacity: 0.84,
    roughness: 0.32,
  });
  const pools = quality === "tour" ? 1 : 3;
  for (let index = 0; index < pools; index += 1) {
    const pool = new THREE.Mesh(poolGeometry, poolMaterial);
    pool.name = `spring-pool:${index}`;
    const x = layout.x + (index - 1) * 2.1;
    const z = layout.z + 0.8 - index * 0.65;
    pool.position.set(x, terrainHeight(x, z) + 0.08, z);
    pool.scale.setScalar(1 + index * 0.18);
    pool.receiveShadow = true;
    root.add(pool);
  }

  const steamMaterial = new THREE.MeshBasicMaterial({
    color: "#d7f1eb",
    transparent: true,
    opacity: 0.18,
    depthWrite: false,
  });
  const steamGeometry = new THREE.SphereGeometry(0.42, 6, 4);
  const steamCount = quality === "full" ? 3 : 1;
  for (let index = 0; index < steamCount; index += 1) {
    const steam = new THREE.Mesh(steamGeometry, steamMaterial);
    steam.name = `spring-steam:${index}`;
    const x = layout.x + (index - 1) * 1.4;
    const z = layout.z + 0.3 - index * 0.5;
    steam.position.set(x, terrainHeight(x, z) + 1.25 + index * 0.32, z);
    steam.scale.set(0.7, 1.5, 0.7);
    root.add(steam);
  }

  const light = new THREE.PointLight("#6fc7c2", 3, 11, 2);
  light.name = "spring-terraces-light";
  const owner = {
    ownerKind: "spring" as const,
    ownerId: layout.id,
    intensity: 3,
  };
  light.userData.stateOwnedPointLight = owner;
  light.position.set(
    layout.x,
    terrainHeight(layout.x, layout.z) + 2.6,
    layout.z,
  );
  root.add(light);
  root.userData.stateOwnedPointLightCandidates = [
    {
      ...owner,
      light,
    },
  ];
}

function buildGroundFacet(
  root: THREE.Group,
  layout: AtlasRegionLayout,
  terrainHeight: (x: number, z: number) => number,
  color: string,
  name: string,
): void {
  const facet = new THREE.Mesh(
    new THREE.CircleGeometry(Math.min(3.8, layout.radius * 0.18), 9),
    new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true }),
  );
  facet.name = name;
  facet.rotation.x = -Math.PI / 2;
  const x = layout.x - layout.radius * 0.16;
  const z = layout.z;
  facet.position.set(x, terrainHeight(x, z) + 0.03, z);
  facet.receiveShadow = true;
  root.add(facet);
}

function crossingKit(
  crossing: AtlasCrossing,
  from: AtlasRegionLayout,
  to: AtlasRegionLayout,
  terrainHeight: (x: number, z: number) => number,
  coastMask: (region: AtlasRegionLayout, x: number, z: number) => number,
  instanceLimit: number,
): { root: THREE.Object3D; instanceCount: number } {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const distance = Math.max(0.001, Math.hypot(dx, dz));
  const direction = { x: dx / distance, z: dz / distance };
  const fromLanding = coastLanding(from, direction, 1, coastMask);
  const toLanding = coastLanding(to, direction, -1, coastMask);
  const crossingMetadata = {
    crossingId: crossing.id,
    kind: crossing.kind,
    landing: { from: fromLanding, to: toLanding },
  };
  const length = Math.hypot(
    toLanding.x - fromLanding.x,
    toLanding.z - fromLanding.z,
  );
  const angle = -Math.atan2(toLanding.z - fromLanding.z, toLanding.x - fromLanding.x);
  const midpoint = {
    x: (fromLanding.x + toLanding.x) / 2,
    z: (fromLanding.z + toLanding.z) / 2,
  };
  const y = Math.max(
    terrainHeight(fromLanding.x, fromLanding.z),
    terrainHeight(toLanding.x, toLanding.z),
  ) + 0.16;

  switch (crossing.kind) {
    case "stone_bridge": {
      const deck = crossingDeck(length, 1.5, 0.32, "#81796b", midpoint, y, angle);
      deck.name = `crossing:${crossing.id}`;
      deck.userData = crossingMetadata;
      return { root: deck, instanceCount: 0 };
    }
    case "timber_causeway": {
      const desiredPlankCount = Math.max(2, Math.ceil(length / 1.15));
      const plankCount = Math.min(desiredPlankCount, instanceLimit);
      if (plankCount <= 0) {
        const deck = crossingDeck(
          length,
          1.45,
          0.18,
          "#75543a",
          midpoint,
          y,
          angle,
        );
        deck.name = `crossing:${crossing.id}`;
        deck.userData = crossingMetadata;
        return { root: deck, instanceCount: 0 };
      }
      const planks = new THREE.InstancedMesh(
        new THREE.BoxGeometry(1, 0.18, 1.45),
        new THREE.MeshStandardMaterial({ color: "#75543a", roughness: 0.95 }),
        plankCount,
      );
      const matrix = new THREE.Object3D();
      const segmentLength = length / plankCount;
      for (let index = 0; index < plankCount; index += 1) {
        const t = (index + 0.5) / plankCount;
        matrix.position.set(
          THREE.MathUtils.lerp(fromLanding.x, toLanding.x, t),
          y + (index % 2) * 0.025,
          THREE.MathUtils.lerp(fromLanding.z, toLanding.z, t),
        );
        matrix.rotation.set(0, angle, 0);
        matrix.scale.set(segmentLength * 1.04, 1, 1);
        matrix.updateMatrix();
        planks.setMatrixAt(index, matrix.matrix);
      }
      planks.instanceMatrix.needsUpdate = true;
      planks.castShadow = plankCount <= 24;
      planks.receiveShadow = true;
      planks.name = `crossing:${crossing.id}`;
      planks.userData = crossingMetadata;
      return { root: planks, instanceCount: plankCount };
    }
    case "sandbar_ford": {
      const sandbar = crossingDeck(
        length,
        2.6,
        0.12,
        "#b9a477",
        midpoint,
        y - 0.18,
        angle,
      );
      sandbar.name = `crossing:${crossing.id}`;
      sandbar.userData = crossingMetadata;
      return { root: sandbar, instanceCount: 0 };
    }
  }
}

function coastLanding(
  region: AtlasRegionLayout,
  direction: { x: number; z: number },
  sign: -1 | 1,
  coastMask: (region: AtlasRegionLayout, x: number, z: number) => number,
): { x: number; z: number } {
  for (
    let ratio = COAST_LANDING_START_RATIO;
    ratio >= COAST_LANDING_MINIMUM_RATIO;
    ratio -= COAST_LANDING_STEP
  ) {
    const x = region.x + direction.x * region.radius * ratio * sign;
    const z = region.z + direction.z * region.radius * ratio * sign;
    if (coastMask(region, x, z) > 0.18) {
      return { x, z };
    }
  }
  return { x: region.x, z: region.z };
}

function crossingDeck(
  length: number,
  width: number,
  height: number,
  color: string,
  midpoint: { x: number; z: number },
  y: number,
  angle: number,
): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(length, height, width),
    new THREE.MeshStandardMaterial({ color, roughness: 0.94, flatShading: true }),
  );
  mesh.position.set(midpoint.x, y, midpoint.z);
  mesh.rotation.y = angle;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function ownedLayer(
  root: THREE.Group,
  instanceCount: number,
  landmarkKinds: string[],
  clearableInstances: readonly ClearableInstanceRecord[] = [],
  layout?: AtlasRegionLayout,
): RegionSceneryLayer {
  const objectCount = descendantCount(root);
  let disposed = false;
  let clearanceCount = 0;
  let maskedInstanceCount = 0;
  const updateClearings = (
    clearings: readonly SceneryDynamicClearance[],
  ): SceneryClearanceState => {
    clearanceCount = clearings.length;
    if (disposed || !layout || clearableInstances.length === 0) {
      return { clearanceCount, maskedInstanceCount };
    }
    let nextMaskedInstanceCount = 0;
    for (const record of clearableInstances) {
      const target = record.mesh.instanceMatrix.array as Float32Array;
      let changed = false;
      for (const [index, placement] of record.placements.entries()) {
        const masked = clearings.some((clearing) => (
          Math.hypot(
            layout.x + placement.x - clearing.x,
            layout.z + placement.z - clearing.z,
          ) < placement.radius + clearing.radius
        ));
        nextMaskedInstanceCount += masked ? 1 : 0;
        if (record.masked[index] === Number(masked)) {
          continue;
        }
        record.masked[index] = Number(masked);
        const offset = index * 16;
        target.set(record.baseMatrices.subarray(offset, offset + 16), offset);
        if (masked) {
          for (const component of [0, 1, 2, 4, 5, 6, 8, 9, 10]) {
            target[offset + component] = 0;
          }
        }
        changed = true;
      }
      if (changed) {
        record.mesh.instanceMatrix.needsUpdate = true;
      }
    }
    maskedInstanceCount = nextMaskedInstanceCount;
    return { clearanceCount, maskedInstanceCount };
  };
  return {
    root,
    objectCount,
    instanceCount,
    landmarkKinds,
    updateClearings,
    clearanceState: () => ({ clearanceCount, maskedInstanceCount }),
    dispose: () => {
      if (disposed) {
        return;
      }
      disposed = true;
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      root.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          geometries.add(object.geometry);
          const ownedMaterials = Array.isArray(object.material)
            ? object.material
            : [object.material];
          for (const material of ownedMaterials) {
            materials.add(material);
          }
        }
      });
      for (const geometry of geometries) {
        geometry.dispose();
      }
      for (const material of materials) {
        material.dispose();
      }
      root.clear();
      root.removeFromParent();
    },
  };
}

function descendantCount(root: THREE.Object3D): number {
  let count = -1;
  root.traverse(() => count += 1);
  return Math.max(0, count);
}

function stringHash(value: string): number {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

export type { CrossingKind };
