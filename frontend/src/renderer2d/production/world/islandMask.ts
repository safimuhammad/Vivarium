/**
 * @fileoverview Deterministic organic island coastlines for the world-sheet archipelago
 * (design of record: `docs/frontend/ATLAS_VIEW.md` §1, proven in
 * `docs/frontend/mockups/atlas-impl/01-world-four-islands.png`).
 *
 * **The method: a domain-warped multi-lobe signed field, thresholded on a sub-tile lattice.**
 *
 * ```
 *   land(p) = smin_i( ellipseDistance( warp(p), lobe_i ) ) < 0
 *   warp(p) = p + A_big * noise(p / lambda_big) + A_fine * noise(p / lambda_fine)
 * ```
 *
 * - **Multi-lobe + smooth-min union.** Three to six ellipses welded by a smooth minimum express
 *   genuine concavity -- necks, bays, capes. A single-centre `r(theta)` polygon (the shape this
 *   module used to generate) is star-shaped from a point, and that topology *forbids* a bay that
 *   curls back past its angular neighbours, no matter how much wobble is added.
 * - **Domain warp, two octaves.** The warp displaces the SAMPLE POINT, not the radius, so every
 *   isoline wanders and the silhouette cannot average back toward a circle. Amplitudes are a fixed
 *   fraction of the plot half-extent; wavelengths are fixed in TILES ({@link WARP_BIG_TILES} /
 *   {@link WARP_FINE_TILES}), never in plot fractions -- that is what keeps coast grain constant as
 *   a region grows: a bigger island gets MORE coastline, not stretched coastline.
 * - **Threshold on {@link MASK_CELL_PX} sub-tile cells** (a quarter tile), so the coast comes out
 *   as stair-steps on the art's own grid: pixel art, not a vector curve laid over pixels.
 * - **Deterministic cleanup.** Keep the largest 4-connected component, then two morphological
 *   passes (fill cells with >= 3 land neighbours, shave cells with <= 1). One island per region,
 *   guaranteed; no confetti, no pinholes.
 * - **Character is authored per archetype** ({@link islandArchetypeForKit}), plus one cape lobe
 *   aimed at each real neighbour, so an island's arms point at its own bridges. Four islands with
 *   different character, not one shape at four sizes.
 *
 * Every seed is a string built from the region id. No `Math.random`, no `Date.now`, no wall clock:
 * the same world always produces the same coastline.
 *
 * Zero imports: this module does only numeric/geometric math on plain arrays and `{x, y}` points --
 * no canvas, no recipe, no rendering types, no camera. `regionSheetLayout.ts` imports FROM this
 * module (one direction only); this module never imports back, so there is no cycle.
 *
 * **The silhouette is a PORTRAIT, not the walkable footprint.** Masking removes walkable ground at
 * map zoom only; the full rectangle returns when the camera descends. Hit-testing (which region is
 * under this point) therefore routes through the region RECT, never through this mask -- see
 * `regionSheetLayout.ts`'s `regionAtPoint` and `docs/frontend/ATLAS_VIEW.md` §9.
 */

/** A point in the same pixel space as the rect or plot it was generated for. */
export interface IslandPoint {
  readonly x: number;
  readonly y: number;
}

/** The minimal rect shape this module needs -- structurally compatible with
 * `regionSheetLayout.ts`'s `SheetRect` and `CanvasPresentationRenderer`'s `Rect`, without
 * importing either (see the module doc's zero-import/no-cycle note). */
export interface MaskRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** Pixels per mask cell: a quarter of the 32 px art tile, so the coastline steps on the art's own
 * grid rather than reading as a smooth vector curve. */
export const MASK_CELL_PX = 8;

/** Art tile size, in pixels -- used ONLY to express the warp wavelengths in tiles (see the module
 * doc). A literal, so this module keeps its zero-import discipline. */
const TILE_PX = 32;

/** Domain-warp wavelengths, in TILES (not plot fractions) -- constant coast grain under growth. */
const WARP_BIG_TILES = 26;
const WARP_FINE_TILES = 7;

/** Smooth-minimum blend radius used to weld the lobe skeleton into one landmass. */
const SMIN_K = 0.62;

/** The four authored silhouette characters, derived from a region's kit (which is itself derived
 * from the region's own `description` in `config/world.yaml` via `classifyArchetype`). */
export type IslandArchetype =
  | "worn_heartland"
  | "spring_terraces"
  | "dry_scrub"
  | "ash_waste"
  | "neutral_temperate";

/** Everything the coastline generator needs about a region. All of it is real world state: the id,
 * the kit its description resolved to, its current pixel extent, the directions of its real
 * neighbours, and how much of its plot its carrying capacity earns it. */
export interface IslandMaskInput {
  /** The region's stable id; the sole seed for the shape. */
  readonly regionId: string;
  /** The region's art kit (e.g. `"worn-heartland"`), which selects the authored lobe skeleton. */
  readonly kit: string;
  /** The region's current plot width, in world pixels. */
  readonly widthPx: number;
  /** The region's current plot height, in world pixels. */
  readonly heightPx: number;
  /** One angle (radians, plot space) per real neighbour -- each grows a cape reaching that way. */
  readonly capeAngles: readonly number[];
  /** Fraction of the plot the island fills, from the region's real carrying capacity (see
   * {@link islandFillFraction}). */
  readonly fill: number;
}

/** One region's rasterised silhouette plus the signed distance field every shore band reads. */
export interface IslandMask {
  readonly cols: number;
  readonly rows: number;
  /** Pixels per cell ({@link MASK_CELL_PX}); a cell `(c, r)` covers plot-local pixels
   * `[c*cell, (c+1)*cell) x [r*cell, (r+1)*cell)`. */
  readonly cell: number;
  /** `1` for land, `0` for sea, row-major. */
  readonly land: Uint8Array;
  /** Signed distance in CELLS: negative inside land, positive at sea, from one chamfer EDT. */
  readonly dist: Float32Array;
}

/* ------------------------------------------------------------------------------ hashing/noise */

/** FNV-1a over a string -- the deterministic seed source for every shape decision here. */
function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/** A stable `[0, 1)` value for a seed string. */
export function unitHash(value: string): number {
  return stableHash(value) / 4_294_967_296;
}

/** A deterministic, smooth 2D value-noise field seeded by a string. */
export function makeValueNoise(seed: string): (x: number, y: number) => number {
  const base = stableHash(seed);
  const at = (ix: number, iy: number): number => {
    let hash = base ^ Math.imul(ix | 0, 374_761_393) ^ Math.imul(iy | 0, 668_265_263);
    hash = Math.imul(hash ^ (hash >>> 13), 1_274_126_177);
    return ((hash ^ (hash >>> 16)) >>> 0) / 4_294_967_296;
  };
  const fade = (t: number): number => t * t * (3 - 2 * t);
  return (x, y) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = fade(x - x0);
    const fy = fade(y - y0);
    const a = at(x0, y0);
    const b = at(x0 + 1, y0);
    const c = at(x0, y0 + 1);
    const d = at(x0 + 1, y0 + 1);
    return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
  };
}

/* ------------------------------------------------------------------------- shape character */

interface Lobe {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
  readonly rot: number;
}

/** Maps a region's art kit to its authored silhouette character. Unknown kits fall back to the
 * neutral (fractured) skeleton rather than throwing -- a region always gets an island. */
export function islandArchetypeForKit(kit: string): IslandArchetype {
  switch (kit) {
    case "worn-heartland": return "worn_heartland";
    case "spring-terraces": return "spring_terraces";
    case "dry-scrub": return "dry_scrub";
    case "ash-waste": return "ash_waste";
    default: return "neutral_temperate";
  }
}

/**
 * The island's fill fraction: how much of its plot its real carrying capacity earns it. A viewer
 * sees at a glance that the wasteland is a small dying rock and the springs are the broad refuge --
 * both facts from `config/world.yaml`, neither invented.
 *
 * @param capacity - This region's `max_energy + max_materials`.
 * @param maxCapacity - The largest such sum across every region in the world.
 * @returns A fill fraction in `[0.50, 0.96]`.
 */
export function islandFillFraction(capacity: number, maxCapacity: number): number {
  if (!Number.isFinite(capacity) || !Number.isFinite(maxCapacity) || maxCapacity <= 0) return 0.73;
  const ratio = Math.max(0, Math.min(1, capacity / maxCapacity));
  return 0.5 + 0.46 * ratio;
}

/** Builds the authored lobe skeleton for an archetype, deterministically jittered and spun by the
 * region's own seed, plus one cape lobe per real neighbour direction. */
function lobesFor(
  archetype: IslandArchetype,
  seed: string,
  capeAngles: readonly number[],
): readonly Lobe[] {
  const jitter = (key: string, amplitude: number): number =>
    (unitHash(seed + key) * 2 - 1) * amplitude;
  const spin = unitHash(`${seed}:spin`) * Math.PI * 2;
  const cosSpin = Math.cos(spin);
  const sinSpin = Math.sin(spin);
  const lobes: Lobe[] = [];
  const push = (x: number, y: number, rx: number, ry: number, rot = 0): void => {
    lobes.push({
      x: x * cosSpin - y * sinSpin,
      y: x * sinSpin + y * cosSpin,
      rx,
      ry,
      rot: rot + spin,
    });
  };
  switch (archetype) {
    case "worn_heartland": // the hub: a broad, kinked body with reaching arms
      push(-0.06 + jitter("a", 0.05), -0.22 + jitter("b", 0.06), 0.5, 0.42, 0.3);
      push(0.1 + jitter("c", 0.06), 0.2 + jitter("d", 0.05), 0.44, 0.46, -0.4);
      push(-0.34 + jitter("e", 0.05), 0.16, 0.28, 0.24, 0.8);
      push(0.3 + jitter("f", 0.05), -0.34, 0.26, 0.22, -0.6);
      break;
    case "spring_terraces": // the water-rich refuge: plump, with a lagoon bite
      push(0, -0.1, 0.52, 0.44, 0.2);
      push(-0.22, 0.24 + jitter("g", 0.05), 0.34, 0.32, -0.5);
      push(0.3 + jitter("h", 0.05), 0.16, 0.3, 0.26, 0.4);
      break;
    case "dry_scrub": // near-barren: a long, thin, ragged spit
      push(-0.34, -0.2 + jitter("i", 0.06), 0.3, 0.22, 0.5);
      push(0.02, 0.02, 0.34, 0.24, 0.45);
      push(0.34 + jitter("j", 0.05), 0.26, 0.24, 0.18, 0.4);
      push(0.22, -0.32, 0.16, 0.13, 0);
      break;
    default: // ash waste / neutral: fractured, bitten-out
      push(-0.14, -0.16, 0.4, 0.36, -0.3);
      push(0.24 + jitter("k", 0.05), 0.06, 0.32, 0.28, 0.6);
      push(-0.1, 0.34 + jitter("l", 0.05), 0.22, 0.2, 0.2);
      push(0.34, -0.3, 0.18, 0.15, 0);
      break;
  }
  // A cape reaching toward each real neighbour. Placed close enough to the body that the smooth
  // minimum WELDS it into an arm rather than leaving an offshore blob the cleanup pass would
  // then delete as a stray component (which is what a further-out cape does on the thinner
  // archetypes -- measured, not assumed).
  for (const angle of capeAngles) {
    if (!Number.isFinite(angle)) continue;
    lobes.push({
      x: Math.cos(angle) * 0.52,
      y: Math.sin(angle) * 0.52,
      rx: 0.25,
      ry: 0.21,
      rot: angle,
    });
  }
  return lobes;
}

/** Polynomial smooth minimum -- welds two lobes into one landmass instead of a union with a
 * visible crease. */
function smoothMin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/* ------------------------------------------------------------------------------- generation */

/**
 * Rasterises one region's island silhouette and its signed distance field.
 *
 * @param input - The region's id, kit, current plot extent, neighbour directions and fill.
 * @returns The land grid plus its signed distance field, in cells of {@link MASK_CELL_PX} px.
 * @throws {RangeError} If the plot extent is not finite and positive.
 */
export function buildIslandMask(input: IslandMaskInput): IslandMask {
  const { regionId, kit, widthPx, heightPx, capeAngles, fill } = input;
  if (!Number.isFinite(widthPx) || widthPx <= 0 || !Number.isFinite(heightPx) || heightPx <= 0) {
    throw new RangeError(
      `buildIslandMask: plot must have finite positive width/height, got ${widthPx}x${heightPx}.`,
    );
  }
  const cols = Math.max(1, Math.ceil(widthPx / MASK_CELL_PX));
  const rows = Math.max(1, Math.ceil(heightPx / MASK_CELL_PX));
  const archetype = islandArchetypeForKit(kit);
  const lobes = lobesFor(archetype, `${regionId}|${kit}`, capeAngles);
  const noiseBig = makeValueNoise(`${regionId}:warp:big`);
  const noiseFine = makeValueNoise(`${regionId}:warp:fine`);
  const halfX = widthPx / 2;
  const halfY = heightPx / 2;
  const warpBig = archetype === "ash_waste" ? 0.19 : 0.145;
  const warpFine = archetype === "ash_waste" ? 0.07 : 0.052;
  const bigWavelength = WARP_BIG_TILES * TILE_PX;
  const fineWavelength = WARP_FINE_TILES * TILE_PX;
  const amplitudeBase = Math.min(halfX, halfY);
  const clampedFill = Math.max(0.1, Math.min(1.2, fill));

  const land = new Uint8Array(cols * rows);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const px = (col + 0.5) * MASK_CELL_PX;
      const py = (row + 0.5) * MASK_CELL_PX;
      const warpX = px
        + (noiseBig(px / bigWavelength, py / bigWavelength) - 0.5) * warpBig * 2 * amplitudeBase
        + (noiseFine(px / fineWavelength, py / fineWavelength) - 0.5) * warpFine * 2 * amplitudeBase;
      const warpY = py
        + (noiseBig(px / bigWavelength + 31.7, py / bigWavelength - 12.3) - 0.5) * warpBig * 2 * amplitudeBase
        + (noiseFine(px / fineWavelength - 7.1, py / fineWavelength + 19.4) - 0.5) * warpFine * 2 * amplitudeBase;
      const nx = (warpX - halfX) / (halfX * clampedFill);
      const ny = (warpY - halfY) / (halfY * clampedFill);
      let signed = Number.POSITIVE_INFINITY;
      for (const lobe of lobes) {
        const dx = nx - lobe.x;
        const dy = ny - lobe.y;
        const cosR = Math.cos(-lobe.rot);
        const sinR = Math.sin(-lobe.rot);
        const ex = (dx * cosR - dy * sinR) / lobe.rx;
        const ey = (dx * sinR + dy * cosR) / lobe.ry;
        const ellipse = Math.hypot(ex, ey) - 1;
        signed = signed === Number.POSITIVE_INFINITY
          ? ellipse
          : smoothMin(signed, ellipse, SMIN_K);
      }
      land[row * cols + col] = signed < 0 ? 1 : 0;
    }
  }
  cleanupLandGrid(land, cols, rows);
  return Object.freeze({
    cols,
    rows,
    cell: MASK_CELL_PX,
    land,
    dist: signedDistanceField(land, cols, rows),
  });
}

/** Keeps the largest 4-connected landmass, then fills pinholes and shaves 1-cell spurs. Mutates
 * `land` in place. */
function cleanupLandGrid(land: Uint8Array, cols: number, rows: number): void {
  const label = new Int32Array(cols * rows).fill(-1);
  const sizes: number[] = [];
  const stack: number[] = [];
  for (let index = 0; index < land.length; index += 1) {
    if (land[index] !== 1 || label[index] !== -1) continue;
    const id = sizes.length;
    let count = 0;
    stack.push(index);
    label[index] = id;
    while (stack.length > 0) {
      const at = stack.pop() as number;
      count += 1;
      const col = at % cols;
      const row = (at / cols) | 0;
      if (col > 0 && land[at - 1] === 1 && label[at - 1] === -1) { label[at - 1] = id; stack.push(at - 1); }
      if (col < cols - 1 && land[at + 1] === 1 && label[at + 1] === -1) { label[at + 1] = id; stack.push(at + 1); }
      if (row > 0 && land[at - cols] === 1 && label[at - cols] === -1) { label[at - cols] = id; stack.push(at - cols); }
      if (row < rows - 1 && land[at + cols] === 1 && label[at + cols] === -1) { label[at + cols] = id; stack.push(at + cols); }
    }
    sizes.push(count);
  }
  let best = -1;
  let bestCount = -1;
  sizes.forEach((count, id) => {
    if (count > bestCount) { bestCount = count; best = id; }
  });
  for (let index = 0; index < land.length; index += 1) {
    if (land[index] === 1 && label[index] !== best) land[index] = 0;
  }
  for (let pass = 0; pass < 2; pass += 1) {
    const source = land.slice();
    for (let row = 1; row < rows - 1; row += 1) {
      for (let col = 1; col < cols - 1; col += 1) {
        const index = row * cols + col;
        const neighbours = (source[index - 1] as number) + (source[index + 1] as number)
          + (source[index - cols] as number) + (source[index + cols] as number);
        if (source[index] === 0 && neighbours >= 3) land[index] = 1;
        if (source[index] === 1 && neighbours <= 1) land[index] = 0;
      }
    }
  }
}

/**
 * Two-pass chamfer EDT, signed: negative inside land, positive at sea, measured in CELLS. Every
 * shore band (surf, foam, shallows, shelf, beach, relief, rock scatter, coast normals) is a
 * threshold on this ONE field, so they all follow the same wiggles for free.
 */
function signedDistanceField(land: Uint8Array, cols: number, rows: number): Float32Array {
  const INF = 1e9;
  const run = (isSeed: (index: number) => boolean): Float32Array => {
    const distance = new Float32Array(cols * rows);
    for (let index = 0; index < distance.length; index += 1) distance[index] = isSeed(index) ? 0 : INF;
    const D1 = 1;
    const D2 = Math.SQRT2;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const index = row * cols + col;
        let value = distance[index] as number;
        if (row > 0) value = Math.min(value, (distance[index - cols] as number) + D1);
        if (col > 0) value = Math.min(value, (distance[index - 1] as number) + D1);
        if (row > 0 && col > 0) value = Math.min(value, (distance[index - cols - 1] as number) + D2);
        if (row > 0 && col < cols - 1) value = Math.min(value, (distance[index - cols + 1] as number) + D2);
        distance[index] = value;
      }
    }
    for (let row = rows - 1; row >= 0; row -= 1) {
      for (let col = cols - 1; col >= 0; col -= 1) {
        const index = row * cols + col;
        let value = distance[index] as number;
        if (row < rows - 1) value = Math.min(value, (distance[index + cols] as number) + D1);
        if (col < cols - 1) value = Math.min(value, (distance[index + 1] as number) + D1);
        if (row < rows - 1 && col < cols - 1) value = Math.min(value, (distance[index + cols + 1] as number) + D2);
        if (row < rows - 1 && col > 0) value = Math.min(value, (distance[index + cols - 1] as number) + D2);
        distance[index] = value;
      }
    }
    return distance;
  };
  const toLand = run((index) => land[index] === 1);
  const toSea = run((index) => land[index] === 0);
  const signed = new Float32Array(cols * rows);
  for (let index = 0; index < signed.length; index += 1) {
    signed[index] = land[index] === 1 ? -(toSea[index] as number) : (toLand[index] as number);
  }
  return signed;
}

/* ---------------------------------------------------------------------------------- queries */

/** The signed distance (in cells) at a plot-LOCAL pixel position; `+Infinity` outside the plot. */
export function maskDistanceAtLocal(mask: IslandMask, localX: number, localY: number): number {
  const col = Math.floor(localX / mask.cell);
  const row = Math.floor(localY / mask.cell);
  if (col < 0 || row < 0 || col >= mask.cols || row >= mask.rows) return Number.POSITIVE_INFINITY;
  return mask.dist[row * mask.cols + col] as number;
}

/** Whether a plot-LOCAL pixel position is on land. O(1) -- a lookup, not a ray cast. */
export function pointInIslandMask(mask: IslandMask, localX: number, localY: number): boolean {
  const col = Math.floor(localX / mask.cell);
  const row = Math.floor(localY / mask.cell);
  if (col < 0 || row < 0 || col >= mask.cols || row >= mask.rows) return false;
  return mask.land[row * mask.cols + col] === 1;
}

/**
 * The island's coast cells, in plot-LOCAL pixels: land cells within `1.8` cells of the waterline,
 * sampled every other cell. These are what a bridge anchors to (see `islandBridges.ts`) and what
 * the land-gap packing pass measures (see `regionSheetLayout.ts`).
 *
 * @param mask - The region's rasterised silhouette.
 * @param stride - Cell sampling stride; `2` (the default) is plenty for anchoring and keeps the
 *   brute-force nearest-pair search cheap.
 * @returns Coast points in plot-local pixel space, in row-major order (deterministic).
 */
export function islandCoastPoints(mask: IslandMask, stride = 2): readonly IslandPoint[] {
  const points: IslandPoint[] = [];
  const step = Math.max(1, Math.floor(stride));
  for (let row = 0; row < mask.rows; row += step) {
    for (let col = 0; col < mask.cols; col += step) {
      const distance = mask.dist[row * mask.cols + col] as number;
      if (distance < -1.8 || distance > 0) continue;
      points.push({ x: (col + 0.5) * mask.cell, y: (row + 0.5) * mask.cell });
    }
  }
  return points;
}

/**
 * The island's coastline as closed rectilinear loops in plot-LOCAL pixels -- the outer shore plus
 * one loop per enclosed lagoon. Consecutive collinear steps are merged, so a loop is a compact
 * stair-step polyline on the {@link MASK_CELL_PX} lattice.
 *
 * Loops are emitted with no guaranteed winding, so callers must fill/clip them with the
 * **even-odd** rule (which then handles lagoons correctly without any orientation bookkeeping).
 *
 * @param mask - The region's rasterised silhouette.
 * @returns Zero or more closed loops (first point is not repeated at the end).
 */
export function islandContourLoops(mask: IslandMask): ReadonlyArray<readonly IslandPoint[]> {
  const { cols, rows, land, cell } = mask;
  // Undirected boundary segments between a land cell and a non-land neighbour (or the grid edge),
  // in lattice-corner coordinates.
  const segments: Array<readonly [number, number, number, number]> = [];
  const isLand = (col: number, row: number): boolean =>
    col >= 0 && row >= 0 && col < cols && row < rows && land[row * cols + col] === 1;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      if (!isLand(col, row)) continue;
      if (!isLand(col, row - 1)) segments.push([col, row, col + 1, row]);
      if (!isLand(col, row + 1)) segments.push([col, row + 1, col + 1, row + 1]);
      if (!isLand(col - 1, row)) segments.push([col, row, col, row + 1]);
      if (!isLand(col + 1, row)) segments.push([col + 1, row, col + 1, row + 1]);
    }
  }
  if (segments.length === 0) return [];
  const key = (x: number, y: number): number => y * (cols + 2) + x;
  const byVertex = new Map<number, number[]>();
  segments.forEach(([x0, y0, x1, y1], index) => {
    const a = key(x0, y0);
    const b = key(x1, y1);
    const listA = byVertex.get(a);
    if (listA === undefined) byVertex.set(a, [index]); else listA.push(index);
    const listB = byVertex.get(b);
    if (listB === undefined) byVertex.set(b, [index]); else listB.push(index);
  });
  const used = new Uint8Array(segments.length);
  const loops: Array<readonly IslandPoint[]> = [];
  for (let start = 0; start < segments.length; start += 1) {
    if (used[start] === 1) continue;
    const [sx0, sy0, sx1, sy1] = segments[start] as readonly [number, number, number, number];
    used[start] = 1;
    const path: Array<readonly [number, number]> = [[sx0, sy0], [sx1, sy1]];
    let currentX = sx1;
    let currentY = sy1;
    for (;;) {
      const candidates = byVertex.get(key(currentX, currentY)) ?? [];
      let nextIndex = -1;
      for (const candidate of candidates) {
        if (used[candidate] === 0) { nextIndex = candidate; break; }
      }
      if (nextIndex === -1) break;
      used[nextIndex] = 1;
      const [nx0, ny0, nx1, ny1] = segments[nextIndex] as readonly [number, number, number, number];
      if (nx0 === currentX && ny0 === currentY) { currentX = nx1; currentY = ny1; } else { currentX = nx0; currentY = ny0; }
      path.push([currentX, currentY]);
      if (currentX === sx0 && currentY === sy0) break;
    }
    if (path.length < 4) continue;
    // Drop the repeated closing vertex and merge collinear runs.
    if ((path.at(-1) as readonly [number, number])[0] === sx0
      && (path.at(-1) as readonly [number, number])[1] === sy0) path.pop();
    const simplified: IslandPoint[] = [];
    for (let index = 0; index < path.length; index += 1) {
      const previous = path[(index - 1 + path.length) % path.length] as readonly [number, number];
      const current = path[index] as readonly [number, number];
      const next = path[(index + 1) % path.length] as readonly [number, number];
      const collinear = (current[0] - previous[0]) * (next[1] - current[1])
        === (current[1] - previous[1]) * (next[0] - current[0]);
      if (!collinear) simplified.push({ x: current[0] * cell, y: current[1] * cell });
    }
    if (simplified.length >= 3) loops.push(Object.freeze(simplified));
  }
  return loops;
}

/**
 * The island's land centroid and southernmost land row, in plot-LOCAL pixels -- used to drop the
 * region's chart-style name just below its own southern coast.
 *
 * @param mask - The region's rasterised silhouette.
 * @returns The centroid x, the southernmost land y, and the land cell count (`0` for an empty
 *   mask, in which case the coordinates are the plot centre).
 */
export function islandLandAnchor(mask: IslandMask): Readonly<{ centroidX: number; southY: number; cells: number }> {
  let sumCols = 0;
  let maxRow = 0;
  let cells = 0;
  for (let row = 0; row < mask.rows; row += 1) {
    for (let col = 0; col < mask.cols; col += 1) {
      if (mask.land[row * mask.cols + col] !== 1) continue;
      sumCols += col;
      cells += 1;
      if (row > maxRow) maxRow = row;
    }
  }
  if (cells === 0) {
    return Object.freeze({
      centroidX: (mask.cols * mask.cell) / 2,
      southY: (mask.rows * mask.cell) / 2,
      cells: 0,
    });
  }
  return Object.freeze({
    centroidX: (sumCols / cells) * mask.cell,
    southY: maxRow * mask.cell,
    cells,
  });
}

/**
 * The axis-aligned bounding box of the island's LAND, in plot-local pixels.
 *
 * This is the box the world view projects a region's whole rendered content into, so the map shows
 * the region's real river/roads/clearings instead of the middle third the coastline happens to
 * enclose (see `atlasSymbolLayer.ts`). Every land cell lies inside it by construction, so content
 * drawn to fill this box and clipped to the mask covers the island completely with no gap at the
 * coast.
 *
 * @param mask - The region's rasterised silhouette.
 * @returns The land bounding box. An empty mask yields the whole plot, which degrades to the
 *   pre-existing 1:1 projection rather than to a divide-by-zero.
 */
export function islandLandBox(mask: IslandMask): MaskRect {
  let minCol = mask.cols;
  let minRow = mask.rows;
  let maxCol = -1;
  let maxRow = -1;
  for (let row = 0; row < mask.rows; row += 1) {
    for (let col = 0; col < mask.cols; col += 1) {
      if (mask.land[row * mask.cols + col] !== 1) continue;
      if (col < minCol) minCol = col;
      if (col > maxCol) maxCol = col;
      if (row < minRow) minRow = row;
      if (row > maxRow) maxRow = row;
    }
  }
  if (maxCol < minCol || maxRow < minRow) {
    return Object.freeze({ x: 0, y: 0, width: mask.cols * mask.cell, height: mask.rows * mask.cell });
  }
  return Object.freeze({
    x: minCol * mask.cell,
    y: minRow * mask.cell,
    width: (maxCol - minCol + 1) * mask.cell,
    height: (maxRow - minRow + 1) * mask.cell,
  });
}

/**
 * The fraction of the projected plot's shorter side that counts as its MARGIN band.
 *
 * A region's plot is a rectangle; its island is a blob. Fitting the plot to the blob's BOUNDING BOX
 * (what {@link islandLandBox} gives) covers every land cell, but it also lands the plot's own
 * margins exactly where the coastline carved sea -- so whatever the region authored near its edges
 * is clipped away. Nirvana's west river ran down the plot's west margin and was deleted whole. This
 * band is the part of the plot the fit below insists lands on land.
 */
export const MAP_FIT_MARGIN_FRACTION = 0.1;

/** How much of that margin band must fall on the island's own land for a placement to qualify.
 * Not 1.0: a strictly inscribed fit is blocked by the single worst bay and shrinks the map far more
 * than the last few per cent of margin are worth. Measured on Nirvana: at 1.0 the map covers 58 % of
 * the island, at 0.95 it covers 69 %, and both carry the whole river. */
export const MAP_FIT_MARGIN_ON_LAND = 0.95;

/**
 * The least of the island's own span the fitted map may keep before the fit is abandoned.
 *
 * Some silhouettes -- a starfish, an arrowhead -- have no rectangle in them worth calling a map: the
 * largest placement that keeps the plot's margins on land would be a stamp in the middle of a
 * sprawl, and a viewer would read the island's arms as a different place. Past this floor the
 * COVER fit below is the better picture: the whole island carries the region, and what falls outside
 * the coastline is cropped exactly as it was before this fit existed.
 */
export const MAP_FIT_MIN_SPAN = 0.45;

/**
 * Where a region's whole plot is projected on its island: the largest UNIFORMLY scaled placement of
 * the plot whose margin band lands on the island's own land.
 *
 * The projection this replaces stretched the plot into {@link islandLandBox}. That covers the island
 * completely -- and it is exactly why content near the plot's edges vanished, because the bounding
 * box of a blob contains sea at every point the coast is inset from it. Nirvana's river runs across
 * the plot's north AND down its west margin; the west leg projected into open water and was clipped,
 * so half the region's defining feature was simply absent from the map.
 *
 * This fit trades island coverage for that content. The scale is a single number for both axes and
 * the placement is a translation -- **no non-uniform distortion**, so a viewer can trust the shape
 * they see is the region's real shape. The cost is honest and visible: the ring of land outside the
 * fit keeps the island's own dressing (and the region's 1:1 art under it) instead of the map inset.
 *
 * Search: coarse-to-fine over side length (largest first) and integer cell offsets, with an
 * integral image so each candidate costs four array reads. Ties -- and there are many -- are broken
 * by island land covered, then by scan order, so the result is deterministic for a given mask.
 *
 * @param mask - The region's rasterised silhouette.
 * @param plotWidthPx - The region's plot width, in world pixels (the content being projected).
 * @param plotHeightPx - The region's plot height, in world pixels.
 * @returns The projection target, in plot-local pixels, with EXACTLY the plot's aspect ratio. When
 *   no placement qualifies (see {@link MAP_FIT_MIN_SPAN}) it returns the uniform COVER of the land
 *   box -- the whole island carried, its margins cropped by the coast -- so the caller always gets a
 *   usable box and never an anisotropic one.
 */
export function islandMapFit(mask: IslandMask, plotWidthPx: number, plotHeightPx: number): MaskRect {
  const box = islandLandBox(mask);
  if (!(plotWidthPx > 0) || !(plotHeightPx > 0)) return box;
  const aspect = plotWidthPx / plotHeightPx;
  // The plot scaled uniformly until it COVERS the land box, centred on it: full island coverage, no
  // per-axis stretch. What the fit falls back to when the silhouette has no map-sized rect in it.
  const coverScale = Math.max(box.width / plotWidthPx, box.height / plotHeightPx);
  const coverWidth = plotWidthPx * coverScale;
  const coverHeight = plotHeightPx * coverScale;
  const fallback: MaskRect = Object.freeze({
    x: box.x + (box.width - coverWidth) / 2,
    y: box.y + (box.height - coverHeight) / 2,
    width: coverWidth,
    height: coverHeight,
  });
  const { cols, rows, cell } = mask;
  if (cols <= 0 || rows <= 0) return fallback;

  // Integral image over the land, so the land inside any candidate rect is four reads.
  const stride = cols + 1;
  const integral = new Int32Array(stride * (rows + 1));
  for (let row = 0; row < rows; row += 1) {
    let run = 0;
    for (let col = 0; col < cols; col += 1) {
      run += mask.land[row * cols + col] === 1 ? 1 : 0;
      integral[(row + 1) * stride + col + 1] = (integral[row * stride + col + 1] as number) + run;
    }
  }
  const landIn = (x: number, y: number, width: number, height: number): number => {
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(cols, x + width);
    const y1 = Math.min(rows, y + height);
    if (x1 <= x0 || y1 <= y0) return 0;
    return (integral[y1 * stride + x1] as number)
      - (integral[y0 * stride + x1] as number)
      - (integral[y1 * stride + x0] as number)
      + (integral[y0 * stride + x0] as number);
  };
  if (landIn(0, 0, cols, rows) === 0) return fallback;

  const maxHeight = Math.min(rows, Math.floor(cols / aspect));
  // The floor is measured against the ISLAND, not the plot: what matters is how much of the island
  // the map still spans, which is what a viewer sees.
  const minHeight = Math.max(
    4,
    Math.ceil(Math.max(box.height, box.width / aspect) * MAP_FIT_MIN_SPAN / cell),
  );
  if (maxHeight < minHeight) return fallback;

  interface Placement { readonly x: number; readonly y: number; readonly height: number; readonly land: number }
  /** The margin band's land fraction for one placement; `1` when the band degenerates. */
  const marginOnLand = (x: number, y: number, width: number, height: number): number => {
    const band = Math.max(1, Math.round(Math.min(width, height) * MAP_FIT_MARGIN_FRACTION));
    const innerWidth = width - 2 * band;
    const innerHeight = height - 2 * band;
    const bandArea = width * height - Math.max(0, innerWidth) * Math.max(0, innerHeight);
    if (bandArea <= 0) return 1;
    const inner = innerWidth > 0 && innerHeight > 0
      ? landIn(x + band, y + band, innerWidth, innerHeight)
      : 0;
    return (landIn(x, y, width, height) - inner) / bandArea;
  };
  const scan = (height: number, step: number): Placement | null => {
    const width = Math.max(1, Math.round(height * aspect));
    if (width > cols || height > rows) return null;
    let best: Placement | null = null;
    for (let y = 0; y + height <= rows; y += step) {
      for (let x = 0; x + width <= cols; x += step) {
        const land = landIn(x, y, width, height);
        if (best !== null && land <= best.land) continue;
        if (marginOnLand(x, y, width, height) < MAP_FIT_MARGIN_ON_LAND) continue;
        best = { x, y, height, land };
      }
    }
    return best;
  };

  // Coarse pass: the largest side that admits ANY qualifying placement on a coarse lattice...
  const coarse = Math.max(1, Math.round(Math.min(cols, rows) / 64));
  let found: Placement | null = null;
  for (let height = maxHeight; height >= minHeight; height -= coarse) {
    found = scan(height, coarse);
    if (found !== null) break;
  }
  if (found === null) return fallback;
  // ...then a full step-1 scan over the few sides the coarse lattice could have straddled, down to
  // and including the coarse winner (whose own placement was only lattice-accurate).
  for (let height = Math.min(maxHeight, found.height + coarse - 1); height >= found.height; height -= 1) {
    const refined = scan(height, 1);
    if (refined !== null) { found = refined; break; }
  }

  // Back to plot-local pixels, with the plot's EXACT aspect (the search rounds to whole cells; the
  // returned rect must not, or the projection would carry a sliver of anisotropy).
  const heightPx = found.height * cell;
  const widthPx = heightPx * aspect;
  const searchWidthPx = Math.max(1, Math.round(found.height * aspect)) * cell;
  return Object.freeze({
    x: found.x * cell + (searchWidthPx - widthPx) / 2,
    y: found.y * cell,
    width: widthPx,
    height: heightPx,
  });
}

/**
 * A deterministic scatter of points over an island's own land, never into the sea.
 *
 * @param mask - The region's rasterised silhouette.
 * @param seed - Seed string; the same seed always yields the same points for the same mask.
 * @param count - How many points to produce.
 * @param inlandCells - Minimum inland depth, in cells (a point must sit at `dist < -inlandCells`).
 * @returns Up to `count` points in plot-local pixels; fewer only when the island has no cell deep
 *   enough to satisfy `inlandCells`.
 */
export function islandLandPoints(
  mask: IslandMask,
  seed: string,
  count: number,
  inlandCells: number,
): readonly IslandPoint[] {
  const pool: number[] = [];
  for (let row = 0; row < mask.rows; row += 1) {
    for (let col = 0; col < mask.cols; col += 1) {
      if ((mask.dist[row * mask.cols + col] as number) < -inlandCells) pool.push(row * mask.cols + col);
    }
  }
  if (pool.length === 0) return [];
  const points: IslandPoint[] = [];
  for (let index = 0; index < count; index += 1) {
    const at = pool[stableHash(`${seed}:${index}`) % pool.length] as number;
    points.push({
      x: ((at % mask.cols) + 0.5) * mask.cell,
      y: (Math.floor(at / mask.cols) + 0.5) * mask.cell,
    });
  }
  return points;
}

/** The outward coast normal at a cell, from the distance field's own gradient; `null` at the grid
 * edge or where the field is flat. */
export function coastNormalAt(mask: IslandMask, col: number, row: number): readonly [number, number] | null {
  const { cols, rows, dist } = mask;
  if (col < 1 || row < 1 || col >= cols - 1 || row >= rows - 1) return null;
  const gx = (dist[row * cols + col + 1] as number) - (dist[row * cols + col - 1] as number);
  const gy = (dist[(row + 1) * cols + col] as number) - (dist[(row - 1) * cols + col] as number);
  const magnitude = Math.hypot(gx, gy);
  if (magnitude < 1e-4) return null;
  return [gx / magnitude, gy / magnitude];
}
