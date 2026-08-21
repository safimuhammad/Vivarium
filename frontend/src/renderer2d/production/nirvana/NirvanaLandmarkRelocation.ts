/**
 * Where each authored macro landmark stands when the river takes its authored ground.
 *
 * Option A's river wraps the settlement, and in doing so it flows over ground that 13 of
 * Nirvana's 27 authored macro landmarks were authored to occupy. The first integration
 * RETIRED all 13 (`NirvanaTerrainField`'s water verdict), which is safe but costs the
 * region half of its hand-placed character. The owner's instruction is **relocate rather
 * than retire**: each landmark gets one authored alternative home, chosen to preserve the
 * INTENT it was placed with, and the field decides between the two.
 *
 * This module is DATA ONLY. It names, per chunk, the alternative bounds a landmark takes
 * when its authored bounds are under water. The placement itself is still constructed by
 * the chunk that owns the landmark, with that chunk's own constructors, so a relocated
 * landmark is byte-for-byte the same KIND of object as its authored self — same feature,
 * same frame, same collision rule, same visual derivation. Only its bounds differ.
 *
 * Every entry below was measured, not guessed. The search enumerated every position in
 * the owning chunk and rejected any that touched water, a mechanics obligation, the
 * `visualRects` envelope, a shelter render footprint, a road, a dry channel, a chunk
 * connector, or a surviving landmark's collision — then ranked the survivors by distance
 * from the authored home and by how much clear ground the sprite would stand on.
 *
 * Plan: `docs/superpowers/plans/2026-07-26-nirvana-production-terrain.md` §P3.
 * Report: `.superpowers/sdd/nirvana-live-report.md` §D.
 */

import type { NirvanaTileRectangle } from "./NirvanaRegionV2";

/** One landmark's authored alternative home, with the reason it is that one. */
export interface NirvanaLandmarkRelocation {
  /** Chunk-local bounds the landmark takes when its authored bounds are drowned. */
  readonly bounds: NirvanaTileRectangle;
  /** Why this position preserves the landmark's authored intent. */
  readonly rationale: string;
}

function relocation(
  column: number,
  row: number,
  columns: number,
  rows: number,
  rationale: string,
): NirvanaLandmarkRelocation {
  return Object.freeze({
    bounds: Object.freeze({ column, row, columns, rows }),
    rationale,
  });
}

/**
 * Chunk-keyed relocation tables: `"column,row"` → landmark id → alternative home.
 *
 * A landmark absent from this table has no authored alternative, so the field's verdict
 * stands and it is retired. That is deliberate for four of the root chunk's woodland
 * boundary bands — see `NIRVANA_UNRELOCATABLE_LANDMARKS`.
 */
const NIRVANA_LANDMARK_RELOCATIONS:
Readonly<Record<string, Readonly<Record<string, NirvanaLandmarkRelocation>>>> = Object.freeze({
  "0,0": Object.freeze({
    // Authored (14,5) 8x7: a solitary hero tree standing alone on open meadow. The river
    // now runs through that meadow. (9,20) is the one remaining pocket in the root chunk
    // big enough to hold the whole 8x8 canopy with room on every side: the pool lies to
    // its north-west, the first district to its east, the south-seam wood below it. The
    // canopy's top-left corner reaches over the pool, which is open water, not clutter —
    // the tree still stands alone.
    "hero-ancient-oak": relocation(9, 20, 8, 7,
      "solitary on the open field between the pool and the settlement's western edge"),

    // Authored (34,5) 8x8: a walled garden a settlement once tended, in the north-east.
    // The north-east is now the river's mouth. Of 1,025 positions in the root chunk
    // exactly TWO leave the whole 8x8 wall ring on legal ground, and both are the same
    // north-west meadow. It sits immediately north of the old road's west leg, inside the
    // west gate — where travellers enter, which is precisely where a settlement tends a
    // garden. Its whole footprint is clear ground.
    "reclaimed-ruined-garden": relocation(4, 6, 8, 8,
      "north of the old road's west leg, just inside the west gate"),

    // Authored (6,28) 8x4: a forest fringe along the chunk's south seam. The river's west
    // margin clips its first two columns. One tile east is the nearest legal position, on
    // the SAME edge at the SAME size — the cheapest possible recovery.
    "woodland-bottom-west": relocation(7, 28, 8, 4,
      "the same south-seam fringe, one tile east of the river's west margin"),
  }),

  "1,0": Object.freeze({
    // Authored (8,3) local — world (56,3) — a grove in the northern transition, now mid
    // river. Six rows south, same column, puts it on the river's own south bank, still in
    // the northern transition, on entirely clear ground: the same grove, now a waterside one.
    "transition-grove-north": relocation(8, 9, 4, 4,
      "the same northern transition, now standing on the river's south bank"),
  }),

  "0,1": Object.freeze({
    // The three old-road groves were authored in a north-south rhythm down the chunk's
    // west side, all west of the old road. The river now runs exactly there. Each moves
    // the shortest distance EAST that clears the water — still west of the old road, and
    // now standing on its east bank. The authored rhythm (rows 35 / 44 / 55) is kept as
    // 35 / 43 / 56 so they stay spread rather than clumping.
    "old-road-grove-west-high": relocation(7, 3, 4, 4,
      "west of the old road still, four tiles east onto the river's east bank"),
    "old-road-grove-west-mid": relocation(9, 11, 4, 4,
      "west of the old road still, on the river's east bank, keeping the authored rhythm"),
    "old-road-grove-west-low": relocation(11, 24, 4, 4,
      "west of the old road still, on the river's east bank, keeping the authored rhythm"),
  }),

  "0,2": Object.freeze({
    // Authored (2,4) local — world (2,68) — a grove west of the settlement, now in the
    // channel. Seven tiles east, on the same row, keeps it west of the settlement and
    // puts it on the bank.
    "settlement-grove-west-high": relocation(9, 4, 4, 4,
      "west of the settlement still, on the river's east bank, same row"),

    // Authored (4,17) local — world (4,81) — the southern settlement's walled garden,
    // now in the channel. Four tiles east and four north keeps it immediately south-west
    // of the settlement's last district, beside the southern road, on wholly clear ground.
    //
    // The row matters as much as the column. A walled garden is only a place worth walking
    // to if you can walk IN, and its single gate is the two tiles at the middle of its
    // south wall. At (9,15) the gate opened straight into `settlement-grove-west-low`,
    // which stands at local (12,23); the court became an unreachable 36-tile pocket and
    // the field's connectivity repair sealed it — measured, not guessed. (8,13) puts the
    // gate two rows clear of the grove, so the court stays part of the one walkable
    // component. `NirvanaLandmarkRelocation.test.ts` asserts that, so it cannot regress.
    "settlement-ruined-garden": relocation(8, 13, 8, 8,
      "south-west of the settlement's last district, its gate opening clear of the grove"),
  }),
});

/**
 * The four landmarks with no legal home that preserves their intent — stated, not hidden.
 *
 * All four are root-chunk woodland BANDS: edge-pinned fringes whose sprites are derived
 * from which chunk edge their bounds touch (`createNirvanaRootWoodlandVisuals`), so a
 * band can only ever move ALONG a chunk edge. Measured exhaustively — every position, at
 * every length from the authored one down to three tiles, on all four edges:
 *
 *  - `woodland-top-garden` (32,0) and `woodland-top-east` (39,0) framed the north rim east
 *    of column 32. A north-edge band's sprite feet land in row 3, and row 3 is open water
 *    from column 32 to column 67 — the river's mouth is exactly where these woods stood.
 *    The north rim west of column 32 is held by the four bands that survived.
 *  - `woodland-east-upper` (44,4) framed the chunk's east seam. That seam is water from
 *    row 2 to row 13, the trunk road occupies row 16, and rows 17 and below sit inside the
 *    districts' visual envelope — leaving a two-row gap, shorter than the shortest band.
 *  - `woodland-west-bottom` (0,23) framed the south-west corner. Its west rim is now the
 *    river's channel, and its only legal alternative is the same short stretch of south
 *    seam already given to `woodland-bottom-west`, whose authored home that is.
 *
 * Every legal alternative for all four is the one 8x6 patch at columns 7-14, rows 26-31.
 * Stacking four boundary fringes there would be a landmark junkyard AND would swallow the
 * only open ground left for the hero oak, so they stay retired.
 */
export const NIRVANA_UNRELOCATABLE_LANDMARKS: ReadonlySet<string> = Object.freeze(new Set([
  "0,0:woodland-top-garden",
  "0,0:woodland-top-east",
  "0,0:woodland-east-upper",
  "0,0:woodland-west-bottom",
]));

/**
 * Look up one landmark's authored alternative home.
 *
 * @param coord The chunk that owns the landmark.
 * @param landmarkId The landmark's chunk-local id.
 * @returns Its relocation, or `null` when it has no authored alternative.
 */
export function nirvanaLandmarkRelocation(
  coord: Readonly<{ column: number; row: number }>,
  landmarkId: string,
): NirvanaLandmarkRelocation | null {
  return NIRVANA_LANDMARK_RELOCATIONS[`${coord.column},${coord.row}`]?.[landmarkId] ?? null;
}
