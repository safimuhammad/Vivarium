import { describe, expect, it } from "vitest";
import type { RegionSnapshot } from "../../app/schemas";
import {
  atlasLayoutHash,
  classifyCrossings,
  crossingKind,
  deriveAtlasLayout,
  type AtlasLayout,
} from "./atlasLayout";

function regions(count: number): RegionSnapshot[] {
  return Array.from({ length: count }, (_, index) => ({
    name: `region_${index}`,
    description: index % 2 ? "dry scrub" : "temperate refuge",
    connections: index + 1 < count ? [`region_${index + 1}`] : [],
    energy_rate: 0.1,
    materials_rate: 0.1,
    current_energy: 30,
    current_materials: 20,
    max_energy: 80 + index * 5,
    max_materials: 60,
  }));
}

function completeRegions(count: number): RegionSnapshot[] {
  const input = regions(count);
  return input.map((region) => ({
    ...region,
    connections: input
      .map(({ name }) => name)
      .filter((name) => name !== region.name),
  }));
}

function starRegions(count: number): RegionSnapshot[] {
  const input = regions(count);
  const center = input[0].name;
  return input.map((region, index) => ({
    ...region,
    connections: index === 0
      ? input.slice(1).map(({ name }) => name)
      : [center],
  }));
}

function reverseTopology(input: readonly RegionSnapshot[]): RegionSnapshot[] {
  return [...input]
    .reverse()
    .map((region) => ({ ...region, connections: [...region.connections].reverse() }));
}

function minimumCoastalGap(layout: AtlasLayout): number {
  let minimum = Number.POSITIVE_INFINITY;
  for (const left of layout.regions) for (const right of layout.regions) {
    if (left.id >= right.id) continue;
    minimum = Math.min(
      minimum,
      Math.hypot(left.x - right.x, left.z - right.z) - left.radius - right.radius,
    );
  }
  return minimum;
}

describe("deriveAtlasLayout", () => {
  it.each([1, 4, 8])("lays out %i regions without overlap", (count) => {
    const layout = deriveAtlasLayout(regions(count));
    expect(layout.regions).toHaveLength(count);
    for (const left of layout.regions) for (const right of layout.regions) {
      if (left.id >= right.id) continue;
      expect(Math.hypot(left.x - right.x, left.z - right.z)).toBeGreaterThanOrEqual(
        left.radius + right.radius + 4,
      );
    }
  });

  it("is independent of config array order", () => {
    const input = regions(8);
    expect(atlasLayoutHash(deriveAtlasLayout(input))).toBe(
      atlasLayoutHash(deriveAtlasLayout([...input].reverse())),
    );
  });

  it.each([
    ["12-node reciprocal complete graph", completeRegions(12)],
    ["50-node chain", regions(50)],
    ["24-node reciprocal star", starRegions(24)],
  ] as const)("guarantees the minimum island gap for a %s", (_label, input) => {
    const layout = deriveAtlasLayout(input);

    expect(minimumCoastalGap(layout)).toBeGreaterThanOrEqual(4);
    expect(layout.diagnostics.fallback).toBe(true);
  });

  it.each([
    ["complete", completeRegions(12)],
    ["star", starRegions(24)],
  ] as const)(
    "hashes the %s graph independently of region and connection order",
    (_label, input) => {
      expect(atlasLayoutHash(deriveAtlasLayout(input))).toBe(
        atlasLayoutHash(deriveAtlasLayout(reverseTopology(input))),
      );
    },
  );

  it("keeps finite region geometry and coast-inclusive bounds", () => {
    const layout = deriveAtlasLayout(regions(8));

    expect(layout.regions.every((region) => (
      [region.x, region.z, region.radius, region.relief, region.dome]
        .every(Number.isFinite)
    ))).toBe(true);
    for (const region of layout.regions) {
      expect(layout.bounds.minX).toBeLessThanOrEqual(region.x - region.radius);
      expect(layout.bounds.maxX).toBeGreaterThanOrEqual(region.x + region.radius);
      expect(layout.bounds.minZ).toBeLessThanOrEqual(region.z - region.radius);
      expect(layout.bounds.maxZ).toBeGreaterThanOrEqual(region.z + region.radius);
    }
  });

  it("reports asymmetric and unknown declarations in stable order", () => {
    const input = regions(3);
    input[2].connections.push("missing_region");

    expect(deriveAtlasLayout(input).diagnostics.asymmetricEdges).toEqual([
      "missing_region::region_2",
      "region_0::region_1",
      "region_1::region_2",
    ]);
    expect(deriveAtlasLayout([...input].reverse()).diagnostics.asymmetricEdges).toEqual([
      "missing_region::region_2",
      "region_0::region_1",
      "region_1::region_2",
    ]);
  });

  it("falls back as one deterministic layout when non-finite input contaminates geometry", () => {
    const input = regions(4);
    input[2].max_energy = Number.POSITIVE_INFINITY;

    const layout = deriveAtlasLayout(input);
    expect(layout.diagnostics.fallback).toBe(true);
    expect(layout.regions.every((region) => (
      [region.x, region.z, region.radius, region.relief, region.dome]
        .every(Number.isFinite)
    ))).toBe(true);
    expect(atlasLayoutHash(layout)).toBe(
      atlasLayoutHash(deriveAtlasLayout([...input].reverse())),
    );
  });
});

describe("classifyCrossings", () => {
  it("renders every declared edge exactly once", () => {
    const input = regions(4);
    const crossings = classifyCrossings(deriveAtlasLayout(input), input);
    expect(crossings.map((crossing) => crossing.id)).toEqual([
      "region_0::region_1",
      "region_1::region_2",
      "region_2::region_3",
    ]);
  });

  it("normalizes reciprocal and duplicate declarations independently of input order", () => {
    const input = regions(3);
    input[0].connections.push("region_1");
    input[1].connections.push("region_0");
    input[2].connections.push("region_1");

    const layout = deriveAtlasLayout(input);
    expect(classifyCrossings(layout, input).map((crossing) => crossing.id)).toEqual([
      "region_0::region_1",
      "region_1::region_2",
    ]);
    expect(classifyCrossings(layout, [...input].reverse())).toEqual(
      classifyCrossings(layout, input),
    );
  });

  it.each([
    [8, "stone_bridge"],
    [8.0001, "timber_causeway"],
    [20, "timber_causeway"],
    [20.0001, "sandbar_ford"],
  ] as const)("classifies a %s-unit gap as %s", (gap, kind) => {
    expect(crossingKind(gap)).toBe(kind);
  });
});

describe("atlasLayoutHash", () => {
  it("normalizes region order and rounds geometry to four decimal places", () => {
    const layout: AtlasLayout = {
      regions: [
        { id: "b", x: 10.00004, z: 2, radius: 4, relief: 1, dome: 0.5 },
        { id: "a", x: -10, z: -2, radius: 4, relief: 1, dome: 0.5 },
      ],
      bounds: { minX: -14, maxX: 14.00004, minZ: -6, maxZ: 6 },
      diagnostics: { asymmetricEdges: ["b::c", "a::b"], fallback: false },
    };
    const reordered: AtlasLayout = {
      ...layout,
      regions: [
        layout.regions[1],
        { ...layout.regions[0], x: 10 },
      ],
      bounds: { ...layout.bounds, maxX: 14 },
      diagnostics: { ...layout.diagnostics, asymmetricEdges: ["a::b", "b::c"] },
    };

    expect(atlasLayoutHash(layout)).toBe(atlasLayoutHash(reordered));
  });
});
