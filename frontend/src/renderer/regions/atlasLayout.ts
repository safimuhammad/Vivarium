import type { RegionSnapshot } from "../../app/schemas";
import { deriveRegionVisualRecipe } from "./visualRecipe";

export type CrossingKind =
  | "stone_bridge"
  | "timber_causeway"
  | "sandbar_ford";

export interface AtlasRegionLayout {
  id: string;
  x: number;
  z: number;
  radius: number;
  relief: number;
  dome: number;
}

export interface AtlasLayout {
  regions: AtlasRegionLayout[];
  bounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  diagnostics: { asymmetricEdges: string[]; fallback: boolean };
}

export interface AtlasCrossing {
  id: string;
  from: string;
  to: string;
  kind: CrossingKind;
  gap: number;
}

interface LayoutNode extends AtlasRegionLayout {
  visualSeed: number;
}

interface Point {
  x: number;
  z: number;
}

interface NormalizedTopology {
  edges: readonly [string, string][];
  asymmetricEdges: string[];
}

const ITERATIONS = 180;
const MIN_ISLAND_GAP = 4;
const CONNECTED_TARGET_GAP = 12;
const POSITION_PRECISION = 4;

/** Derive deterministic, order-independent island geometry for a region graph. */
export function deriveAtlasLayout(
  regions: readonly RegionSnapshot[],
): AtlasLayout {
  const nodes = [...regions]
    .sort((left, right) => compareText(left.name, right.name))
    .map(toLayoutNode);
  const topology = normalizeTopology(regions, new Set(nodes.map(({ id }) => id)));
  const initial = initializeOnDeterministicCircle(nodes);
  const positions = runForceLayout(nodes, initial, topology.edges);
  const hasNonFiniteGeometry = nodes.some((node, index) => (
    !isFiniteRegion(node) || !isFinitePoint(positions[index])
  ));
  const hasResidualOverlap = !hasNonFiniteGeometry &&
    violatesMinimumIslandGap(nodes, positions);
  const fallback = hasNonFiniteGeometry || hasResidualOverlap;
  const finiteNodes = fallback ? nodes.map(sanitizeNode) : nodes;
  const finitePositions = fallback
    ? deterministicCircleFallback(finiteNodes)
    : positions;
  const laidOut = normalizeAndRound(finiteNodes, finitePositions);

  return {
    regions: laidOut,
    bounds: layoutBounds(laidOut),
    diagnostics: {
      asymmetricEdges: topology.asymmetricEdges,
      fallback,
    },
  };
}

/** Classify every known declared connection once from its final coastal gap. */
export function classifyCrossings(
  layout: AtlasLayout,
  regions: readonly RegionSnapshot[],
): AtlasCrossing[] {
  const byId = new Map(layout.regions.map((region) => [region.id, region]));
  const topology = normalizeTopology(regions, new Set(byId.keys()));

  return topology.edges.flatMap(([from, to]) => {
    const fromRegion = byId.get(from);
    const toRegion = byId.get(to);
    if (!fromRegion || !toRegion) {
      return [];
    }
    const gap = round(
      Math.hypot(fromRegion.x - toRegion.x, fromRegion.z - toRegion.z) -
        fromRegion.radius -
        toRegion.radius,
    );
    return [{
      id: edgeId(from, to),
      from,
      to,
      kind: crossingKind(gap),
      gap,
    }];
  });
}

/** Select the visible crossing grammar for a coast-to-coast gap. */
export function crossingKind(gap: number): CrossingKind {
  if (gap <= 8) return "stone_bridge";
  if (gap <= 20) return "timber_causeway";
  return "sandbar_ford";
}

/** Serialize layout geometry and diagnostics into a canonical drift-check hash. */
export function atlasLayoutHash(layout: AtlasLayout): string {
  return JSON.stringify({
    regions: [...layout.regions]
      .sort((left, right) => compareText(left.id, right.id))
      .map((region) => ({
        ...region,
        x: round(region.x),
        z: round(region.z),
        radius: round(region.radius),
        relief: round(region.relief),
        dome: round(region.dome),
      })),
    bounds: {
      minX: round(layout.bounds.minX),
      maxX: round(layout.bounds.maxX),
      minZ: round(layout.bounds.minZ),
      maxZ: round(layout.bounds.maxZ),
    },
    diagnostics: {
      asymmetricEdges: [...layout.diagnostics.asymmetricEdges].sort(compareText),
      fallback: layout.diagnostics.fallback,
    },
  });
}

function toLayoutNode(region: RegionSnapshot): LayoutNode {
  const recipe = deriveRegionVisualRecipe(region);
  const potential = Math.max(0, recipe.potential.maxEnergy) +
    Math.max(0, recipe.potential.maxMaterials);
  const radius = 12 + Math.sqrt(potential) * 0.4 + unitInterval(recipe.visualSeed) * 1.5;
  return {
    id: region.name,
    x: 0,
    z: 0,
    radius,
    relief: 2.3 + unitInterval(recipe.visualSeed >>> 8) * 1.8,
    dome: 0.9 + unitInterval(recipe.visualSeed >>> 16) * 1.5,
    visualSeed: recipe.visualSeed,
  };
}

function initializeOnDeterministicCircle(nodes: readonly LayoutNode[]): Point[] {
  if (nodes.length === 0) {
    return [];
  }
  const maximumRadius = Math.max(...nodes.map(({ radius }) => radius));
  const orbit = Math.max(
    maximumRadius * 1.6,
    (nodes.length * (maximumRadius * 2 + CONNECTED_TARGET_GAP)) / (Math.PI * 2),
  );
  return nodes.map(({ visualSeed }) => {
    const angle = unitInterval(visualSeed) * Math.PI * 2;
    return { x: Math.cos(angle) * orbit, z: Math.sin(angle) * orbit };
  });
}

function runForceLayout(
  nodes: readonly LayoutNode[],
  initial: readonly Point[],
  edges: readonly (readonly [string, string])[],
): Point[] {
  let positions = initial.map((point) => ({ ...point }));
  const indexById = new Map(nodes.map((node, index) => [node.id, index]));

  for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
    const updates = positions.map(() => ({ x: 0, z: 0 }));

    for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
        const vector = separationVector(
          positions[leftIndex],
          positions[rightIndex],
          nodes[leftIndex].visualSeed,
          nodes[rightIndex].visualSeed,
        );
        const minimumDistance =
          nodes[leftIndex].radius + nodes[rightIndex].radius + MIN_ISLAND_GAP;
        const overlap = minimumDistance - vector.distance;
        const repulsion = overlap > 0
          ? Math.min(6, overlap * 0.52 + 0.12)
          : Math.min(0.18, (minimumDistance * minimumDistance) /
              Math.max(1, vector.distance * vector.distance) * 0.055);
        applyPairForce(updates, leftIndex, rightIndex, vector, repulsion, -1);
      }
    }

    for (const [from, to] of edges) {
      const leftIndex = indexById.get(from);
      const rightIndex = indexById.get(to);
      if (leftIndex === undefined || rightIndex === undefined || leftIndex === rightIndex) {
        continue;
      }
      const vector = separationVector(
        positions[leftIndex],
        positions[rightIndex],
        nodes[leftIndex].visualSeed,
        nodes[rightIndex].visualSeed,
      );
      const target = nodes[leftIndex].radius +
        nodes[rightIndex].radius +
        CONNECTED_TARGET_GAP;
      const attraction = clamp((vector.distance - target) * 0.018, -0.9, 0.9);
      applyPairForce(updates, leftIndex, rightIndex, vector, attraction, 1);
    }

    positions = positions.map((point, index) => ({
      x: point.x + clamp(updates[index].x - point.x * 0.0025, -4.5, 4.5),
      z: point.z + clamp(updates[index].z - point.z * 0.0025, -4.5, 4.5),
    }));
  }

  return positions;
}

function separationVector(
  left: Point,
  right: Point,
  leftSeed: number,
  rightSeed: number,
): { x: number; z: number; distance: number } {
  const dx = right.x - left.x;
  const dz = right.z - left.z;
  const distance = Math.hypot(dx, dz);
  if (distance > 1e-8) {
    return { x: dx / distance, z: dz / distance, distance };
  }
  const angle = unitInterval((leftSeed ^ rightSeed ^ 0x9e3779b9) >>> 0) * Math.PI * 2;
  return { x: Math.cos(angle), z: Math.sin(angle), distance: 0 };
}

function applyPairForce(
  updates: Point[],
  leftIndex: number,
  rightIndex: number,
  direction: Point,
  magnitude: number,
  sign: -1 | 1,
): void {
  const x = direction.x * magnitude * sign;
  const z = direction.z * magnitude * sign;
  updates[leftIndex].x += x;
  updates[leftIndex].z += z;
  updates[rightIndex].x -= x;
  updates[rightIndex].z -= z;
}

function deterministicCircleFallback(nodes: readonly LayoutNode[]): Point[] {
  if (nodes.length === 0) {
    return [];
  }
  if (nodes.length === 1) {
    return [{ x: 0, z: 0 }];
  }
  const maximumRadius = Math.max(...nodes.map(({ radius }) => radius));
  const minimumChord = maximumRadius * 2 + MIN_ISLAND_GAP + 1;
  const orbit = minimumChord / (2 * Math.sin(Math.PI / nodes.length));
  const offset = unitInterval(nodes.reduce(
    (hash, node) => Math.imul(hash ^ node.visualSeed, 16777619) >>> 0,
    2166136261,
  )) * Math.PI * 2;
  return nodes.map((_, index) => {
    const angle = offset + (index / nodes.length) * Math.PI * 2;
    return { x: Math.cos(angle) * orbit, z: Math.sin(angle) * orbit };
  });
}

function normalizeAndRound(
  nodes: readonly LayoutNode[],
  positions: readonly Point[],
): AtlasRegionLayout[] {
  if (nodes.length === 0) {
    return [];
  }
  const minX = Math.min(...nodes.map((node, index) => positions[index].x - node.radius));
  const maxX = Math.max(...nodes.map((node, index) => positions[index].x + node.radius));
  const minZ = Math.min(...nodes.map((node, index) => positions[index].z - node.radius));
  const maxZ = Math.max(...nodes.map((node, index) => positions[index].z + node.radius));
  const offsetX = (minX + maxX) / 2;
  const offsetZ = (minZ + maxZ) / 2;

  return nodes.map((node, index) => ({
    id: node.id,
    x: round(positions[index].x - offsetX),
    z: round(positions[index].z - offsetZ),
    radius: round(node.radius),
    relief: round(node.relief),
    dome: round(node.dome),
  }));
}

function layoutBounds(regions: readonly AtlasRegionLayout[]): AtlasLayout["bounds"] {
  if (regions.length === 0) {
    return { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  }
  return {
    minX: round(Math.min(...regions.map((region) => region.x - region.radius))),
    maxX: round(Math.max(...regions.map((region) => region.x + region.radius))),
    minZ: round(Math.min(...regions.map((region) => region.z - region.radius))),
    maxZ: round(Math.max(...regions.map((region) => region.z + region.radius))),
  };
}

function normalizeTopology(
  regions: readonly RegionSnapshot[],
  knownRegionIds: ReadonlySet<string>,
): NormalizedTopology {
  const declarations = new Set<string>();
  for (const region of regions) {
    for (const connection of region.connections) {
      declarations.add(directedEdgeId(region.name, connection));
    }
  }

  const edgeById = new Map<string, [string, string]>();
  const asymmetricEdges = new Set<string>();
  for (const declaration of [...declarations].sort(compareText)) {
    const [from, to] = declaration.split("\u0000") as [string, string];
    const id = edgeId(from, to);
    const isKnownPair = knownRegionIds.has(from) && knownRegionIds.has(to) && from !== to;
    if (isKnownPair) {
      const [left, right] = normalizeEdge(from, to);
      edgeById.set(id, [left, right]);
    }
    if (from === to || !declarations.has(directedEdgeId(to, from))) {
      asymmetricEdges.add(id);
    }
  }

  return {
    edges: [...edgeById]
      .sort(([left], [right]) => compareText(left, right))
      .map(([, edge]) => edge),
    asymmetricEdges: [...asymmetricEdges].sort(compareText),
  };
}

function sanitizeNode(node: LayoutNode): LayoutNode {
  return {
    ...node,
    x: 0,
    z: 0,
    radius: finiteOr(node.radius, 16),
    relief: finiteOr(node.relief, 3),
    dome: finiteOr(node.dome, 1.4),
  };
}

function isFiniteRegion(region: AtlasRegionLayout): boolean {
  return [region.x, region.z, region.radius, region.relief, region.dome]
    .every(Number.isFinite);
}

function isFinitePoint(point: Point | undefined): point is Point {
  return point !== undefined && Number.isFinite(point.x) && Number.isFinite(point.z);
}

function violatesMinimumIslandGap(
  nodes: readonly LayoutNode[],
  positions: readonly Point[],
): boolean {
  for (let leftIndex = 0; leftIndex < nodes.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < nodes.length; rightIndex += 1) {
      const distance = Math.hypot(
        positions[leftIndex].x - positions[rightIndex].x,
        positions[leftIndex].z - positions[rightIndex].z,
      );
      const minimumDistance =
        nodes[leftIndex].radius + nodes[rightIndex].radius + MIN_ISLAND_GAP;
      if (distance < minimumDistance) {
        return true;
      }
    }
  }
  return false;
}

function directedEdgeId(from: string, to: string): string {
  return `${from}\u0000${to}`;
}

function edgeId(from: string, to: string): string {
  const [left, right] = normalizeEdge(from, to);
  return `${left}::${right}`;
}

function normalizeEdge(from: string, to: string): [string, string] {
  return compareText(from, to) <= 0 ? [from, to] : [to, from];
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function unitInterval(seed: number): number {
  return (seed >>> 0) / 0x1_0000_0000;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function round(value: number): number {
  return Number(value.toFixed(POSITION_PRECISION));
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}
