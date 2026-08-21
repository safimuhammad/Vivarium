import type { RegionArchetype } from "./visualRecipe";

export type SceneryPropKind =
  | "conifer"
  | "deciduous"
  | "dead_trunk"
  | "thorn_scrub"
  | "rock"
  | "basalt"
  | "reed"
  | "stump"
  | "timber"
  | "ember_fissure";

export interface SceneryPlacement {
  id: string;
  kind: SceneryPropKind;
  x: number;
  y: number;
  z: number;
  rotation: number;
  scale: number;
  radius: number;
}

export interface PlaceRegionSceneryInput {
  regionId: string;
  visualSeed: number;
  archetype: RegionArchetype;
  radius: number;
  quality: SceneryQuality;
  maskAt(x: number, z: number): number;
  heightAt(x: number, z: number): number;
  exclusions: readonly { x: number; z: number; radius: number }[];
}

export type SceneryQuality = "full" | "reduced" | "tour";

export const SCENERY_QUALITY_CAPS: Readonly<Record<SceneryQuality, number>> = {
  full: 48,
  reduced: 28,
  tour: 14,
};

const MAX_ATTEMPTS_PER_PROP = 32;
const TAU = Math.PI * 2;

const ARCHETYPE_PROP_COUNTS: Readonly<
  Record<RegionArchetype, readonly (readonly [SceneryPropKind, number])[]>
> = {
  ash_waste: [
    ["dead_trunk", 12],
    ["basalt", 16],
    ["ember_fissure", 8],
    ["rock", 10],
  ],
  spring_terraces: [
    ["conifer", 10],
    ["deciduous", 10],
    ["reed", 18],
    ["rock", 8],
  ],
  dry_scrub: [
    ["thorn_scrub", 24],
    ["rock", 16],
    ["timber", 4],
  ],
  worn_heartland: [
    ["conifer", 20],
    ["stump", 12],
    ["rock", 10],
    ["timber", 4],
  ],
  neutral_temperate: [
    ["conifer", 12],
    ["deciduous", 12],
    ["rock", 10],
    ["reed", 6],
    ["timber", 2],
  ],
};

const PROP_RADIUS: Readonly<Record<SceneryPropKind, number>> = {
  conifer: 0.62,
  deciduous: 0.72,
  dead_trunk: 0.46,
  thorn_scrub: 0.5,
  rock: 0.42,
  basalt: 0.5,
  reed: 0.24,
  stump: 0.38,
  timber: 0.7,
  ember_fissure: 0.54,
};

/** Place a deterministic, bounded subset of biome props in region-local space. */
export function placeRegionScenery(
  input: PlaceRegionSceneryInput,
): SceneryPlacement[] {
  const random = mulberry32(input.visualSeed);
  const placements: SceneryPlacement[] = [];
  const kinds = requestedKinds(input.archetype);
  const cap = SCENERY_QUALITY_CAPS[input.quality];
  const samplingRadius = Math.max(0, input.radius * 0.92);

  for (const [requestIndex, kind] of kinds.entries()) {
    if (placements.length >= cap) {
      break;
    }
    const radius = PROP_RADIUS[kind];
    for (let attempt = 0; attempt < MAX_ATTEMPTS_PER_PROP; attempt += 1) {
      const distance = Math.sqrt(random()) * samplingRadius;
      const angle = random() * TAU;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;
      const y = input.heightAt(x, z);
      if (
        input.maskAt(x, z) <= 0.18 ||
        y <= 0.05 ||
        overlapsCircle(x, z, radius, input.exclusions) ||
        overlapsCircle(x, z, radius, placements)
      ) {
        continue;
      }
      placements.push({
        id: `${input.regionId}:${kind}:${requestIndex}`,
        kind,
        x,
        y,
        z,
        rotation: random() * TAU,
        scale: 0.76 + random() * 0.52,
        radius,
      });
      break;
    }
  }
  return placements;
}

function requestedKinds(archetype: RegionArchetype): SceneryPropKind[] {
  const remaining = ARCHETYPE_PROP_COUNTS[archetype].map(([kind, count]) => ({
    kind,
    count,
  }));
  const result: SceneryPropKind[] = [];
  while (remaining.some(({ count }) => count > 0)) {
    for (const entry of remaining) {
      if (entry.count > 0) {
        result.push(entry.kind);
        entry.count -= 1;
      }
    }
  }
  return result;
}

function overlapsCircle(
  x: number,
  z: number,
  radius: number,
  circles: readonly { x: number; z: number; radius: number }[],
): boolean {
  return circles.some((circle) => (
    Math.hypot(x - circle.x, z - circle.z) < radius + circle.radius
  ));
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}
