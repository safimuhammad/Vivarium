/**
 * @fileoverview Where a toroidal region's rim is actually allowed to be walked through.
 *
 * Declaring `topology: "toroidal"` is not, by itself, enough to make a being walk off one
 * edge and reappear on the other: every production region closes its whole outer ring to
 * hard collision, so a route cannot even REACH an edge. This module is the other half —
 * it re-opens the rim, but only at **reciprocal seams**, pairs of opposite edge tiles that
 * are BOTH walkable.
 *
 * The reciprocity rule is the safety property. `findNavigationPath` only ever steps onto a
 * collision-open tile, so a one-sided opening could never produce a route "leading
 * nowhere" — but it would produce a walkable dead-end pocket hanging off the rim, and a
 * being who wandered into it would stand on the very edge of the world with nowhere to go.
 * {@link wrapSeamViolations} is the invariant that says that never happened, and it is
 * checkable from the grid alone: no recipe needs to carry a seam list for it to hold.
 *
 * Two ways in:
 *
 *  - {@link openDeclaredWrapSeams} — for a region that already PROVED its seams line up
 *    (Nirvana, whose road ports on column 0 and column N-1 are proved reciprocal by
 *    `assertToroidalSeams`). The declared pairs are honoured, and each is still gated on
 *    both tiles being walkable before the rim closed.
 *  - {@link deriveWrapSeamCandidates} — for a region with no authored seam story. It
 *    reads the finished collision buffer and picks, per axis, the single most central pair
 *    whose inland neighbours are open on both sides. Deterministic, and it can only ever
 *    choose ground that already connects to the region's interior.
 *
 * This module never opens a corner. A corner belongs to both seams at once, and opening it
 * would create a diagonal identification the four-neighbour walk has no vocabulary for.
 */

import type { TileCoord } from "../../map/regionMap";
import { navigationGridIsToroidal, type NavigationGrid } from "./navigation";

/** One reciprocal pair of opposite-edge tiles a being may walk between. */
export interface WrapSeam {
  /** `"x"` joins column 0 to column N-1; `"y"` joins row 0 to row M-1. */
  readonly axis: "x" | "y";
  /** The tile on the low edge (column 0 / row 0). */
  readonly negativeEdgeTile: TileCoord;
  /** The tile on the high edge (column N-1 / row M-1). */
  readonly positiveEdgeTile: TileCoord;
}

/** A rim tile that breaks the reciprocity invariant, with the reason it is illegal. */
export interface WrapSeamViolation {
  readonly tile: TileCoord;
  readonly reason: "corner-open" | "partner-blocked" | "bounded-rim-open";
}

/**
 * Open every declared seam whose two tiles are both walkable in a reference mask.
 *
 * @param collision - The finished, rim-closed collision buffer; MUTATED in place.
 * @param reference - The mask that decides walkability, normally the same buffer before
 *   the rim was closed. A seam tile that was never walkable is never opened, so this can
 *   only re-open ground the region already had.
 * @param columns - Grid width in tiles.
 * @param rows - Grid height in tiles.
 * @param candidates - Declared reciprocal pairs, e.g. a region's `wrapSeamCandidates`.
 * @returns The seams actually opened, in the order given; declared pairs that failed the
 *   reciprocity or corner test are silently skipped and simply absent from the result.
 */
export function openDeclaredWrapSeams(
  collision: Uint8Array,
  reference: Uint8Array,
  columns: number,
  rows: number,
  candidates: readonly WrapSeam[],
): readonly WrapSeam[] {
  const opened: WrapSeam[] = [];
  for (const candidate of candidates) {
    if (!isLegalSeam(candidate, columns, rows)) continue;
    const negative = index(candidate.negativeEdgeTile, columns);
    const positive = index(candidate.positiveEdgeTile, columns);
    if (reference[negative] !== 0 || reference[positive] !== 0) continue;
    collision[negative] = 0;
    collision[positive] = 0;
    opened.push(candidate);
  }
  return Object.freeze(opened);
}

/**
 * Choose up to one seam per axis for a region that has no authored seam story.
 *
 * A pair is eligible when both edge tiles are free of any mask in `forbidden` (water, void
 * — ground a body may not stand on whatever the topology says) and both INLAND neighbours
 * (column 1 / column N-2, row 1 / row M-2) are already walkable. Requiring the inland
 * neighbours is what guarantees an opened tile joins the region's existing walkable
 * component instead of becoming an isolated scrap of rim.
 *
 * The most central eligible offset is chosen — deterministic, independent of run seed, and
 * the least likely place for a region's authored edge story to be built.
 *
 * @param collision - The finished, rim-closed collision buffer; NOT mutated.
 * @param columns - Grid width in tiles.
 * @param rows - Grid height in tiles.
 * @param forbidden - Masks whose set bits veto a tile (e.g. `waterVoidMask`).
 * @returns Zero, one or two seams; an axis with no eligible pair contributes none.
 */
export function deriveWrapSeamCandidates(
  collision: Uint8Array,
  columns: number,
  rows: number,
  forbidden: readonly Uint8Array[] = [],
): readonly WrapSeam[] {
  const seams: WrapSeam[] = [];
  const vetoed = (tile: TileCoord): boolean =>
    forbidden.some((mask) => mask[index(tile, columns)] !== 0);

  const horizontal: WrapSeam[] = [];
  for (let row = 1; row < rows - 1; row += 1) {
    const negativeEdgeTile = { column: 0, row };
    const positiveEdgeTile = { column: columns - 1, row };
    if (vetoed(negativeEdgeTile) || vetoed(positiveEdgeTile)) continue;
    if (collision[index({ column: 1, row }, columns)] !== 0) continue;
    if (collision[index({ column: columns - 2, row }, columns)] !== 0) continue;
    horizontal.push({ axis: "x", negativeEdgeTile, positiveEdgeTile });
  }
  const centralHorizontal = mostCentral(horizontal, (seam) => seam.negativeEdgeTile.row, rows);
  if (centralHorizontal !== null) seams.push(centralHorizontal);

  const vertical: WrapSeam[] = [];
  for (let column = 1; column < columns - 1; column += 1) {
    const negativeEdgeTile = { column, row: 0 };
    const positiveEdgeTile = { column, row: rows - 1 };
    if (vetoed(negativeEdgeTile) || vetoed(positiveEdgeTile)) continue;
    if (collision[index({ column, row: 1 }, columns)] !== 0) continue;
    if (collision[index({ column, row: rows - 2 }, columns)] !== 0) continue;
    vertical.push({ axis: "y", negativeEdgeTile, positiveEdgeTile });
  }
  const centralVertical = mostCentral(vertical, (seam) => seam.negativeEdgeTile.column, columns);
  if (centralVertical !== null) seams.push(centralVertical);

  return Object.freeze(seams);
}

/**
 * Open a set of seams unconditionally on a collision buffer.
 *
 * Intended for seams produced by {@link deriveWrapSeamCandidates}, which already proved
 * their own eligibility against this exact buffer.
 *
 * @param collision - MUTATED in place.
 */
export function applyWrapSeams(
  collision: Uint8Array,
  columns: number,
  rows: number,
  seams: readonly WrapSeam[],
): void {
  for (const seam of seams) {
    if (!isLegalSeam(seam, columns, rows)) continue;
    collision[index(seam.negativeEdgeTile, columns)] = 0;
    collision[index(seam.positiveEdgeTile, columns)] = 0;
  }
}

/**
 * Every rim tile that breaks the walk-topology boundary contract.
 *
 * The contract, in full:
 *  - a BOUNDED grid's rim is entirely hard collision (the historical invariant, unchanged);
 *  - a TOROIDAL grid's corners are hard collision;
 *  - a TOROIDAL grid's non-corner rim tile is open only if its opposite-edge partner is
 *    also open.
 *
 * @returns The offending tiles in row-major order; empty when the contract holds.
 */
export function wrapSeamViolations(grid: NavigationGrid): readonly WrapSeamViolation[] {
  const { columns, rows, collision } = grid;
  const toroidal = navigationGridIsToroidal(grid);
  const violations: WrapSeamViolation[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const onColumnRim = column === 0 || column === columns - 1;
      const onRowRim = row === 0 || row === rows - 1;
      if (!onColumnRim && !onRowRim) continue;
      const tile = { column, row };
      if (collision[index(tile, columns)] !== 0) continue;
      if (!toroidal) {
        violations.push({ tile, reason: "bounded-rim-open" });
        continue;
      }
      if (onColumnRim && onRowRim) {
        violations.push({ tile, reason: "corner-open" });
        continue;
      }
      const partner = onColumnRim
        ? { column: columns - 1 - column, row }
        : { column, row: rows - 1 - row };
      if (collision[index(partner, columns)] !== 0) {
        violations.push({ tile, reason: "partner-blocked" });
      }
    }
  }
  return Object.freeze(violations);
}

/** Reject a pair that is not on opposite rims of the same row/column, or touches a corner. */
function isLegalSeam(seam: WrapSeam, columns: number, rows: number): boolean {
  const { negativeEdgeTile: negative, positiveEdgeTile: positive } = seam;
  if (seam.axis === "x") {
    return negative.column === 0 && positive.column === columns - 1
      && negative.row === positive.row
      && negative.row > 0 && negative.row < rows - 1;
  }
  return negative.row === 0 && positive.row === rows - 1
    && negative.column === positive.column
    && negative.column > 0 && negative.column < columns - 1;
}

/** The candidate whose offset is nearest the axis midpoint; lower offset breaks ties. */
function mostCentral(
  candidates: readonly WrapSeam[],
  offsetOf: (seam: WrapSeam) => number,
  extent: number,
): WrapSeam | null {
  let best: WrapSeam | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of candidates) {
    const distance = Math.abs(offsetOf(candidate) - (extent - 1) / 2);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }
  return best;
}

function index(tile: TileCoord, columns: number): number {
  return tile.row * columns + tile.column;
}
