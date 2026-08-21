import type { RegionSnapshot } from "../../../app/schemas";
import type { Direction4 } from "../../contracts";
import type { TileCoord } from "../../map/regionMap";

export interface DirectedRegionEdge {
  readonly from: string;
  readonly to: string;
}

export interface RegionGate {
  readonly edge: DirectedRegionEdge;
  readonly role: "arrival" | "departure";
  readonly tile: TileCoord;
  readonly facing: Direction4;
}

/** Build a canonical directed graph from validated region connections. */
export function buildDirectedRegionEdges(regions: readonly RegionSnapshot[]): readonly DirectedRegionEdge[] {
  const unique = new Map<string, DirectedRegionEdge>();
  for (const region of regions) {
    for (const destination of region.connections) {
      if (destination === region.name) continue;
      const edge = { from: region.name, to: destination };
      unique.set(edgeKey(edge), edge);
    }
  }
  return [...unique.values()].sort(compareEdges);
}

/** Test whether an exact directed journey is declared. */
export function isTravelAuthorized(
  edges: readonly DirectedRegionEdge[],
  from: string,
  to: string,
): boolean {
  return edges.some((edge) => edge.from === from && edge.to === to);
}

/** Create canonical perimeter gates for every edge touching one region. */
export function createRegionGates(
  regionId: string,
  edges: readonly DirectedRegionEdge[],
  columns: number,
  rows: number,
): readonly RegionGate[] {
  if (columns < 8 || rows < 8) throw new Error("region maps need at least 8 columns and rows for gates");
  const touching = edges
    .filter((edge) => edge.from === regionId || edge.to === regionId)
    .flatMap((edge) => {
      const roles: RegionGate["role"][] = [];
      if (edge.to === regionId) roles.push("arrival");
      if (edge.from === regionId) roles.push("departure");
      return roles.map((role) => ({ edge, role }));
    })
    .sort((left, right) => compareEdges(left.edge, right.edge) || compareText(left.role, right.role));
  const slots = perimeterSlots(columns, rows);
  if (touching.length > slots.length) {
    throw new Error(`region ${regionId} has ${touching.length} gate roles but only ${slots.length} perimeter lanes`);
  }
  const used = new Set<number>();
  return touching.map(({ edge, role }) => {
    const start = stableHash(`${edge.from}>${edge.to}:${role}`) % slots.length;
    let slotIndex = start;
    while (used.has(slotIndex)) slotIndex = (slotIndex + 1) % slots.length;
    used.add(slotIndex);
    const slot = slots[slotIndex];
    return {
      edge,
      role,
      tile: slot.tile,
      facing: role === "arrival" ? oppositeDirection(slot.facing) : slot.facing,
    };
  });
}

/** Return the gate that represents arrival from an exact origin region. */
export function findArrivalGate(
  gates: readonly RegionGate[],
  fromRegion: string,
  toRegion: string,
): RegionGate | null {
  return gates.find((gate) => gate.role === "arrival" && gate.edge.from === fromRegion && gate.edge.to === toRegion) ?? null;
}

function perimeterSlots(
  columns: number,
  rows: number,
): readonly Readonly<{ tile: TileCoord; facing: Direction4 }>[] {
  const slots: { tile: TileCoord; facing: Direction4 }[] = [];
  for (let column = 2; column <= columns - 3; column += 1) {
    slots.push({ tile: { column, row: 1 }, facing: "north" });
  }
  for (let row = 2; row <= rows - 3; row += 1) {
    slots.push({ tile: { column: columns - 2, row }, facing: "east" });
  }
  for (let column = columns - 3; column >= 2; column -= 1) {
    slots.push({ tile: { column, row: rows - 2 }, facing: "south" });
  }
  for (let row = rows - 3; row >= 2; row -= 1) {
    slots.push({ tile: { column: 1, row }, facing: "west" });
  }
  return slots;
}

function oppositeDirection(direction: Direction4): Direction4 {
  switch (direction) {
    case "north": return "south";
    case "east": return "west";
    case "south": return "north";
    case "west": return "east";
  }
}

function compareEdges(left: DirectedRegionEdge, right: DirectedRegionEdge): number {
  return compareText(left.from, right.from) || compareText(left.to, right.to);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function edgeKey(edge: DirectedRegionEdge): string {
  return `${edge.from}\u0000${edge.to}`;
}

export function stableHash(value: string): number {
  let hash = 2166136261 >>> 0;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}
