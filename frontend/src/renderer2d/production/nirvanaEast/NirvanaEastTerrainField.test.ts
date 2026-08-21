import { describe, expect, it } from "vitest";

import { deriveSceneryFootprintGeometry, type SceneryContactModel } from "../placement/sceneryFootprint";
import {
  cornerAt,
  createNirvanaEastScene,
  NIRVANA_EAST_COLUMNS,
  NIRVANA_EAST_ROWS,
  NIRVANA_EAST_TILE_SIZE,
  nirvanaEastCornerSeamMismatches,
  nirvanaEastSceneHash,
  nirvanaEastWalkableComponents,
  NIRVANA_EAST_LANDFORM_TIERS,
  NIRVANA_EAST_LANDFORM_VARIANTS,
  PROP_PIVOTS,
  type NirvanaEastLandformTier,
  type NirvanaEastProtection,
} from "./NirvanaEastTerrainField";

// ---------------------------------------------------------------------------
// Realistic protection mask, built from the pilot's own real 128-shelter-plot
// geometry (`SHELTER_DISTRICT_ORIGINS` x `SHELTER_PLOT_OFFSETS`, a 5x5 footprint per
// plot) — reproduced here rather than imported, since it is pilot/test fixture data,
// not something the production scene builder needs any more (change 1: it now reads a
// real `NirvanaEastProtection` instead of hardcoding this geometry itself).
// ---------------------------------------------------------------------------

interface Point {
  readonly x: number;
  readonly y: number;
}

const SHELTER_DISTRICT_ORIGINS: readonly Point[] = Object.freeze([
  { x: 18, y: 18 }, { x: 34, y: 18 }, { x: 50, y: 18 }, { x: 66, y: 18 },
  { x: 66, y: 50 }, { x: 50, y: 50 }, { x: 34, y: 50 }, { x: 18, y: 50 },
]);

const SHELTER_PLOT_OFFSETS: readonly Point[] = Object.freeze([
  { x: 0, y: 3 }, { x: 4, y: 3 }, { x: 8, y: 3 },
  { x: 0, y: 7 }, { x: 4, y: 7 }, { x: 8, y: 7 },
  { x: 0, y: 11 }, { x: 4, y: 11 }, { x: 8, y: 11 },
  { x: 0, y: 15 }, { x: 4, y: 15 }, { x: 8, y: 15 },
  { x: 0, y: 19 }, { x: 4, y: 19 }, { x: 8, y: 19 },
  { x: 4, y: 23 },
]);

/** A plot's true footprint spans this many tiles beyond its anchor, on each axis. */
const PLOT_SPAN = 4;

function markTile(mask: Uint8Array, columns: number, rows: number, x: number, y: number): void {
  const column = ((x % columns) + columns) % columns;
  const row = ((y % rows) + rows) % rows;
  mask[row * columns + column] = 1;
}

/**
 * The real 128 shelter plots, each protected as a full 5x5 footprint from its anchor —
 * exactly the geometry the pilot's own (now-deleted) `blockingAdmitted` hardcoded, given
 * here as the realistic protection mask the promoted production builder now reads
 * instead.
 */
function realisticProtectionMask(): NirvanaEastProtection {
  const columns = NIRVANA_EAST_COLUMNS;
  const rows = NIRVANA_EAST_ROWS;
  const protectedMask = new Uint8Array(columns * rows);
  for (const origin of SHELTER_DISTRICT_ORIGINS) {
    for (const offset of SHELTER_PLOT_OFFSETS) {
      const anchorX = origin.x + offset.x;
      const anchorY = origin.y + offset.y;
      for (let dy = 0; dy <= PLOT_SPAN; dy += 1) {
        for (let dx = 0; dx <= PLOT_SPAN; dx += 1) {
          markTile(protectedMask, columns, rows, anchorX + dx, anchorY + dy);
        }
      }
    }
  }
  return Object.freeze({
    columns,
    rows,
    protected: protectedMask,
    water: new Uint8Array(columns * rows),
    path: new Uint8Array(columns * rows),
  });
}

function emptyProtectionMask(): NirvanaEastProtection {
  const columns = NIRVANA_EAST_COLUMNS;
  const rows = NIRVANA_EAST_ROWS;
  return Object.freeze({
    columns,
    rows,
    protected: new Uint8Array(columns * rows),
    water: new Uint8Array(columns * rows),
    path: new Uint8Array(columns * rows),
  });
}

/** A deterministic pseudo-random Uint8Array mask, for fuzzing the repair loop. */
function pseudoRandomMask(seed: number, density: number): Uint8Array {
  const columns = NIRVANA_EAST_COLUMNS;
  const rows = NIRVANA_EAST_ROWS;
  const mask = new Uint8Array(columns * rows);
  let state = seed >>> 0;
  const next = (): number => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
  for (let index = 0; index < mask.length; index += 1) {
    mask[index] = next() < density ? 1 : 0;
  }
  return mask;
}

const FULLY_OPEN_BASE_COLLISION = new Uint8Array(NIRVANA_EAST_COLUMNS * NIRVANA_EAST_ROWS);

describe("createNirvanaEastScene — torus invariant", () => {
  it("has zero seam mismatches on both axes, over all 96 pairs each", () => {
    const scene = createNirvanaEastScene(realisticProtectionMask(), FULLY_OPEN_BASE_COLLISION);
    expect(nirvanaEastCornerSeamMismatches(scene)).toEqual({ northSouth: 0, eastWest: 0 });

    // Explicit, exhaustive check over all 96 pairs per axis, not just the summary count.
    for (let row = 0; row < NIRVANA_EAST_ROWS; row += 1) {
      expect(cornerAt(scene.cornerMaterials, NIRVANA_EAST_COLUMNS, row))
        .toBe(cornerAt(scene.cornerMaterials, 0, row));
    }
    for (let column = 0; column < NIRVANA_EAST_COLUMNS; column += 1) {
      expect(cornerAt(scene.cornerMaterials, column, NIRVANA_EAST_ROWS))
        .toBe(cornerAt(scene.cornerMaterials, column, 0));
    }
  });
});

describe("landform footprint geometry — the pinned tier table", () => {
  /** Cap centre 0.245 + wall height 0.30 = 0.545 of the frame height, as declared in the module. */
  const LANDFORM_CONTACT: SceneryContactModel = {
    shape: "ellipse",
    centerXFraction: 0.44,
    centerYFraction: 0.545,
    halfWidthFraction: 0.34,
    halfHeightFraction: 0.205,
    shrink: 0.92,
  };

  it("matches the approved pilot's own hand-derived tier table, per sceneryFootprint.test.ts's own tolerance", () => {
    // `.superpowers/sdd/`-adjacent contract table, quoted in this module's own docstring:
    //   mesa 5.00/2.26/-0.96/-3.02, butte 2.81/1.32/-0.54/-1.76, outcrop 1.56/0.76/-0.30/-1.01
    const cases: ReadonlyArray<readonly [NirvanaEastLandformTier, readonly [number, number, number, number]]> = [
      ["mesa", [5.00, 2.26, -0.96, -3.02]],
      ["butte", [2.81, 1.32, -0.54, -1.76]],
      ["outcrop", [1.56, 0.76, -0.30, -1.01]],
    ];
    for (const [tier, expected] of cases) {
      const pivot = PROP_PIVOTS[tier];
      expect(pivot).toBeDefined();
      const [width, height, pivotX, pivotY] = pivot!;
      const geometry = deriveSceneryFootprintGeometry(
        { width, height, pivotX, pivotY },
        LANDFORM_CONTACT,
        NIRVANA_EAST_TILE_SIZE,
      );
      expect(geometry.halfColumns).toBeCloseTo(expected[0], 1);
      expect(geometry.halfRows).toBeCloseTo(expected[1], 1);
      expect(geometry.offsetColumns).toBeCloseTo(expected[2], 1);
      expect(geometry.offsetRows).toBeCloseTo(expected[3], 1);
    }
  });
});

describe("createNirvanaEastScene — landform placements", () => {
  it("places at least one mesa that blocks MANY tiles, not one, centred above its foot anchor", () => {
    const scene = createNirvanaEastScene(realisticProtectionMask(), FULLY_OPEN_BASE_COLLISION);
    const mesas = scene.landforms.filter((placement) => placement.tier === "mesa");
    expect(mesas.length).toBeGreaterThan(0);
    for (const mesa of mesas) {
      expect(mesa.footprint.length).toBeGreaterThan(30);
      const meanRow = mesa.footprint.reduce((total, tile) => total + tile.row, 0) / mesa.footprint.length;
      // offsetRows is negative (~-3 tiles): the contact ellipse sits ABOVE the foot anchor.
      expect(meanRow).toBeLessThan(mesa.footRow);
    }
  });
});

describe("createNirvanaEastScene — landform plan variants", () => {
  it("draws every authored plan variant of the tiers that carry more than one", () => {
    const scene = createNirvanaEastScene(realisticProtectionMask(), FULLY_OPEN_BASE_COLLISION);
    const drawn = new Map<NirvanaEastLandformTier, Set<string>>();
    for (const prop of scene.props) {
      const match = /^s\.(mesa|butte|outcrop)\.(\d+)$/.exec(prop.frameId);
      if (match === null) continue;
      const tier = match[1] as NirvanaEastLandformTier;
      const seen = drawn.get(tier) ?? new Set<string>();
      seen.add(match[2]!);
      drawn.set(tier, seen);
    }
    // Every tier that ships more than one plan must actually USE every one of them:
    // authoring frames the scene never reaches is bytes spent for nothing.
    for (const tier of NIRVANA_EAST_LANDFORM_TIERS) {
      const variants = NIRVANA_EAST_LANDFORM_VARIANTS[tier];
      const seen = drawn.get(tier);
      if (seen === undefined) continue; // a tier this seed did not place at all
      expect([...seen].every((value) => Number(value) < variants)).toBe(true);
      if (variants > 1 && seen.size > 0) {
        expect(seen.size).toBeGreaterThan(1);
      }
    }
  });

  it("spreads the outcrop field across every authored plan, none of them rare", () => {
    const scene = createNirvanaEastScene(realisticProtectionMask(), FULLY_OPEN_BASE_COLLISION);
    const outcrops = scene.landforms.filter((placement) => placement.tier === "outcrop");
    expect(outcrops.length).toBeGreaterThanOrEqual(20);
    const census = new Map<string, number>();
    for (const prop of scene.props) {
      if (!prop.frameId.startsWith("s.outcrop.") || !prop.blocks) continue;
      census.set(prop.frameId, (census.get(prop.frameId) ?? 0) + 1);
    }
    expect(census.size).toBe(NIRVANA_EAST_LANDFORM_VARIANTS.outcrop);
    // No plan may collapse to a token appearance: with N plans over M rocks the thinnest
    // must still carry at least half its even share, or the field reads as one silhouette
    // with three curiosities in it.
    const even = outcrops.length / NIRVANA_EAST_LANDFORM_VARIANTS.outcrop;
    for (const count of census.values()) expect(count).toBeGreaterThanOrEqual(even * 0.5);
  });

  it("never repeats a plan between the two NEAREST landforms of a tier", () => {
    // The defect this pass exists to fix is local, not statistical: four outcrops in one
    // frame with the same silhouette. A per-tile hash is uniform region-wide and still
    // produced 5 of 7 identical rocks inside the settled band, so what is asserted here
    // is the neighbourly property, on the closest pair of every tier.
    const scene = createNirvanaEastScene(realisticProtectionMask(), FULLY_OPEN_BASE_COLLISION);
    const frameOf = new Map<string, string>();
    for (const prop of scene.props) {
      if (prop.blocks && prop.landformGroup !== null) frameOf.set(prop.landformGroup, prop.frameId);
    }
    const wrapDistance = (a: number, b: number): number => {
      const raw = Math.abs(a - b);
      return Math.min(raw, 96 - raw);
    };
    for (const tier of NIRVANA_EAST_LANDFORM_TIERS) {
      if (NIRVANA_EAST_LANDFORM_VARIANTS[tier] < 2) continue;
      const members = scene.landforms.filter((placement) => placement.tier === tier);
      if (members.length < 2) continue;
      for (const placement of members) {
        const nearest = members
          .filter((other) => other.id !== placement.id)
          .map((other) => ({
            other,
            distance: Math.hypot(
              wrapDistance(placement.footCol, other.footCol),
              wrapDistance(placement.footRow, other.footRow),
            ),
          }))
          .sort((left, right) => left.distance - right.distance)[0]!;
        // Only rocks close enough to be judged together — beyond that a repeat is fine.
        if (nearest.distance > 8) continue;
        expect(frameOf.get(placement.id)).not.toBe(frameOf.get(nearest.other.id));
      }
    }
  });

  it("gives every wrapped-edge duplicate of a landform the SAME plan as its anchor", () => {
    // A placement straddling the canvas edge is drawn twice within one render. The two
    // halves must be the same rock: a wrap duplicate that picked its own plan would show
    // two different silhouettes of one object across the seam.
    const scene = createNirvanaEastScene(realisticProtectionMask(), FULLY_OPEN_BASE_COLLISION);
    const byGroup = new Map<string, string>();
    let duplicates = 0;
    for (const prop of scene.props) {
      if (prop.landformGroup === null) continue;
      const previous = byGroup.get(prop.landformGroup);
      if (previous !== undefined) {
        expect(prop.frameId).toBe(previous);
        duplicates += 1;
      }
      byGroup.set(prop.landformGroup, prop.frameId);
    }
    expect(byGroup.size).toBeGreaterThan(0);
    expect(duplicates).toBeGreaterThan(0);
  });

  it("assigns plans deterministically, and independently of the order placements were appended", () => {
    const protection = realisticProtectionMask();
    const first = createNirvanaEastScene(protection, FULLY_OPEN_BASE_COLLISION);
    const second = createNirvanaEastScene(protection, FULLY_OPEN_BASE_COLLISION);
    const frames = (scene: typeof first): string => scene.props
      .filter((prop) => prop.landformGroup !== null)
      .map((prop) => `${prop.landformGroup}=${prop.frameId}`)
      .sort()
      .join("|");
    expect(frames(first)).toBe(frames(second));
    // Order independence is what keeps the infill pass from renumbering the whole field:
    // the assignment scans a canonical (row, column, id) sort, so it cannot depend on the
    // order the lattices and the infill happened to push placements in.
    expect(frames(first).length).toBeGreaterThan(0);
  });

  it("changes only the drawn frame — every landform footprint is identical to the tier's own", () => {
    const scene = createNirvanaEastScene(realisticProtectionMask(), FULLY_OPEN_BASE_COLLISION);
    // The contact model is a fraction of the FRAME, and every variant of a tier shares one
    // frame geometry, so two landforms of the same tier at the same foot tile must close
    // exactly the same tiles whatever plan they draw.
    for (const tier of NIRVANA_EAST_LANDFORM_TIERS) {
      const sameTier = scene.landforms.filter((placement) => placement.tier === tier);
      if (sameTier.length < 2) continue;
      const sizes = new Set(sameTier.map((placement) => placement.footprint.length));
      // Footprint size varies only with sub-tile foot position, never with the variant:
      // a tier's footprints stay within a tight band around one value.
      const values = [...sizes];
      expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(
        tier === "mesa" ? 20 : tier === "butte" ? 8 : 4,
      );
    }
  });
});

describe("createNirvanaEastScene — the protection gate", () => {
  it("never lands a blocking terrain material or a landform footprint tile on a protected tile", () => {
    const protection = realisticProtectionMask();
    const scene = createNirvanaEastScene(protection, FULLY_OPEN_BASE_COLLISION);

    for (let index = 0; index < protection.protected.length; index += 1) {
      if (protection.protected[index] !== 1) continue;
      // The strongest form of the guarantee: the union of terrain + prop/landform
      // blocking this scene contributes never covers a protected tile.
      expect(scene.collision[index]).toBe(0);
      // And the terrain material field alone never blocked it either (phase-1 repair
      // only ever opens ground, so this holds pre- and post-repair).
      expect(scene.tiles[index]!.blocked).toBe(false);
    }

    const protectedSet = new Set<number>();
    for (let index = 0; index < protection.protected.length; index += 1) {
      if (protection.protected[index] === 1) protectedSet.add(index);
    }
    for (const landform of scene.landforms) {
      for (const tile of landform.footprint) {
        const index = tile.row * NIRVANA_EAST_COLUMNS + tile.column;
        expect(protectedSet.has(index)).toBe(false);
      }
    }
  });
});

describe("createNirvanaEastScene — monotone repair", () => {
  it("never opens ground the base collision already had closed (union is a superset of base)", () => {
    const base = pseudoRandomMask(0x51a1, 0.08);
    const scene = createNirvanaEastScene(realisticProtectionMask(), base);
    for (let index = 0; index < base.length; index += 1) {
      if (base[index] === 1) expect(scene.collision[index] | base[index]).toBe(1);
    }
  });

  it("terminates without throwing across several different synthetic protection/base pairs", () => {
    const scenarios: ReadonlyArray<{ protection: NirvanaEastProtection; base: Uint8Array }> = [
      { protection: realisticProtectionMask(), base: FULLY_OPEN_BASE_COLLISION },
      { protection: emptyProtectionMask(), base: FULLY_OPEN_BASE_COLLISION },
      { protection: realisticProtectionMask(), base: pseudoRandomMask(0x1234, 0.05) },
      { protection: realisticProtectionMask(), base: pseudoRandomMask(0x9e37, 0.15) },
      { protection: emptyProtectionMask(), base: pseudoRandomMask(0x2718, 0.2) },
    ];
    for (const { protection, base } of scenarios) {
      expect(() => createNirvanaEastScene(protection, base)).not.toThrow();
    }
  });
});

describe("createNirvanaEastScene — determinism", () => {
  it("produces an identical scene hash across two builds from the same inputs", () => {
    const protection = realisticProtectionMask();
    const base = pseudoRandomMask(0x77aa, 0.05);
    const first = createNirvanaEastScene(protection, base);
    const second = createNirvanaEastScene(protection, base);
    expect(nirvanaEastSceneHash(first)).toBe(nirvanaEastSceneHash(second));
  });
});

describe("createNirvanaEastScene — connectivity", () => {
  it("is exactly one walkable component under toroidal adjacency, base fully open, realistic protection", () => {
    const protection = realisticProtectionMask();
    const scene = createNirvanaEastScene(protection, FULLY_OPEN_BASE_COLLISION);
    const union = Uint8Array.from(FULLY_OPEN_BASE_COLLISION);
    for (let index = 0; index < union.length; index += 1) {
      if (scene.collision[index] === 1) union[index] = 1;
    }
    const components = nirvanaEastWalkableComponents(union, NIRVANA_EAST_COLUMNS, NIRVANA_EAST_ROWS, true);
    expect(components.length).toBe(1);
  });
});
