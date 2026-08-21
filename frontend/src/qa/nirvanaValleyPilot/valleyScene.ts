/**
 * Authors the Nirvana river-valley PILOT scene.
 *
 * This is a LAB surface. It does not read, write, or re-hash Nirvana's locked
 * authored chunks; it exists so the owner can look at a redesigned Nirvana
 * before anyone proposes re-baselining those hashes.
 *
 * Two facts are produced from ONE source, which is the point of the exercise:
 *   - the picture (a corner-sampled material field, painted with real
 *     transition tiles so materials interlock), and
 *   - the walkability mask (a tile is blocked when at least half of it is a
 *     blocking material), which the real navigation/placement layers consume.
 *
 * Because both derive from the same corner field, the terrain a being cannot
 * enter is exactly the terrain that is drawn as water, reed, cliff, or boulder.
 *
 * BRIDGES are the one deliberate exception, and they are an exception of the
 * same kind rather than a hole in the rule: a bridge does not edit the corner
 * field, so the river still flows - and is still painted - underneath. What a
 * bridge does is carry a run of otherwise-blocked water tiles, and those tiles
 * then REPORT the material `deck`, which is walkable. The mask still says
 * exactly what the picture says: "there is a bridge deck here, you may walk on
 * it", over water that remains blocked everywhere the deck does not reach.
 */

import {
  BLOCKING_VALLEY_MATERIALS,
  GRASS_FAMILY,
  hasShoreSet,
  isWaterMaterial,
  VALLEY_BASE_VARIANTS,
  VALLEY_EDGE_VARIANTS,
  VALLEY_MATERIAL_PRIORITY,
  type ValleyMaterial,
} from "./valleyMaterials";

export const VALLEY_COLUMNS = 48;
export const VALLEY_ROWS = 32;
export const VALLEY_TILE_SIZE = 32;
export const VALLEY_WIDTH_PX = VALLEY_COLUMNS * VALLEY_TILE_SIZE;
export const VALLEY_HEIGHT_PX = VALLEY_ROWS * VALLEY_TILE_SIZE;

/** A walkable pocket smaller than this is sealed rather than bridged. */
const MIN_BRIDGED_POCKET_TILES = 18;

/** No authored bridge may span more water than this; a longer run is a bug. */
const MAX_BRIDGE_DECK_TILES = 14;

/** Raised when the authored scene cannot be built as specified. */
export class ValleySceneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValleySceneError";
  }
}

export interface ValleyTileOverlay {
  readonly material: ValleyMaterial;
  /** Corner mask, bit 1 = NW, 2 = NE, 4 = SE, 8 = SW. */
  readonly mask: number;
  readonly variant: number;
}

/**
 * A waterline on this tile: the darker wet band on the bank plus the broken
 * pale line on the water, drawn over the bank transition it belongs to.
 *
 * It carries the SAME mask and variant as that transition on purpose - the two
 * frames are cut from one seed in the authoring script, so the wet band follows
 * exactly the contour the bank was cut with rather than a second, similar curve.
 */
export interface ValleyTileShoreline {
  readonly material: ValleyMaterial;
  readonly mask: number;
  readonly variant: number;
}

export interface ValleyTile {
  readonly column: number;
  readonly row: number;
  /** Material filling the whole tile before overlays. */
  readonly base: ValleyMaterial;
  readonly baseVariant: number;
  readonly overlays: readonly ValleyTileOverlay[];
  /** Waterlines, painted after every overlay. Empty away from the water. */
  readonly shorelines: readonly ValleyTileShoreline[];
  /** Dominant material, used for walkability and prop eligibility. */
  readonly material: ValleyMaterial;
  readonly blocked: boolean;
  /** True when a bridge deck carries this tile. `material` is then `deck`. */
  readonly bridgeDeck: boolean;
  /**
   * On a deck tile, the material the deck spans - the ground that is still
   * painted underneath and that would block this tile without the bridge.
   * `null` on every other tile.
   */
  readonly deckOver: ValleyMaterial | null;
}

export type ValleyTileRef = Readonly<{ column: number; row: number }>;

/** Which way a body travels over a bridge. */
export type ValleyBridgeAxis = "east-west" | "north-south";

export interface ValleyBridge {
  readonly id: string;
  readonly axis: ValleyBridgeAxis;
  /** Deck tiles, in travel order. Walkable; the water beneath is not. */
  readonly deck: readonly ValleyTileRef[];
  /** The two landward tiles the deck lands on, in the same travel order. */
  readonly abutments: readonly ValleyTileRef[];
}

export interface ValleyProp {
  readonly id: string;
  readonly frameId: string;
  /** Top-left of the sprite in world pixels. */
  readonly x: number;
  readonly y: number;
  /** Sort/anchor point in world pixels (the sprite's foot). */
  readonly footY: number;
  readonly footX: number;
  readonly blocks: boolean;
  readonly tile: Readonly<{ column: number; row: number }>;
}

export interface ValleyCrossing {
  readonly id: string;
  readonly kind: "ford" | "stepping-stones" | "repair" | "bridge";
  readonly tiles: readonly Readonly<{ column: number; row: number }>[];
}

export interface ValleyScene {
  readonly columns: number;
  readonly rows: number;
  readonly tileSize: number;
  readonly widthPixels: number;
  readonly heightPixels: number;
  /** Row-major, length columns*rows. */
  readonly tiles: readonly ValleyTile[];
  /** Row-major, length columns*rows, 1 = blocked. Matches `NavigationGrid`. */
  readonly collision: Uint8Array;
  readonly props: readonly ValleyProp[];
  readonly crossings: readonly ValleyCrossing[];
  readonly bridges: readonly ValleyBridge[];
  /** Corner material field, ((columns+1) * (rows+1)), for diagnostics. */
  readonly cornerMaterials: readonly ValleyMaterial[];
}

// ---------------------------------------------------------------------------
// deterministic noise (mirrors the authoring script so art and field agree)
// ---------------------------------------------------------------------------

function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 0x27d4_eb2d) ^ Math.imul(y | 0, 0x1656_67b1)
    ^ Math.imul(seed | 0, 0x9e37_79b1)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x85eb_ca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2_ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0xffff_ffff;
}

function valueNoise(x: number, y: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const xf = x - xi;
  const yf = y - yi;
  const u = xf * xf * (3 - 2 * xf);
  const v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}

function fbm(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let norm = 0;
  for (let index = 0; index < octaves; index += 1) {
    sum += amplitude * valueNoise(x * frequency, y * frequency, seed + index * 101);
    norm += amplitude;
    frequency *= 2;
    amplitude *= 0.5;
  }
  return sum / norm;
}

// ---------------------------------------------------------------------------
// river geometry
// ---------------------------------------------------------------------------

interface Point {
  readonly x: number;
  readonly y: number;
}

/** Catmull-Rom through the control points; the river is a curve, never a staircase. */
function sampleSpline(points: readonly Point[], samplesPerSegment: number): Point[] {
  const result: Point[] = [];
  for (let index = 0; index < points.length - 3; index += 1) {
    const p0 = points[index];
    const p1 = points[index + 1];
    const p2 = points[index + 2];
    const p3 = points[index + 3];
    for (let step = 0; step < samplesPerSegment; step += 1) {
      const t = step / samplesPerSegment;
      const t2 = t * t;
      const t3 = t2 * t;
      result.push({
        x: 0.5 * ((2 * p1.x)
          + (-p0.x + p2.x) * t
          + (2 * p0.x - 5 * p1.x + 4 * p2.x - p3.x) * t2
          + (-p0.x + 3 * p1.x - 3 * p2.x + p3.x) * t3),
        y: 0.5 * ((2 * p1.y)
          + (-p0.y + p2.y) * t
          + (2 * p0.y - 5 * p1.y + 4 * p2.y - p3.y) * t2
          + (-p0.y + 3 * p1.y - 3 * p2.y + p3.y) * t3),
      });
    }
  }
  return result;
}

interface Channel {
  readonly samples: readonly Point[];
  /** Half-width in tiles at spline parameter u in [0,1]. */
  readonly halfWidth: (u: number) => number;
}

/** Main channel: enters top-left of centre, S-curves, exits bottom-right. */
const MAIN_CONTROL: readonly Point[] = Object.freeze([
  { x: 19, y: -10 }, { x: 17, y: -3 }, { x: 14.5, y: 4 }, { x: 9.5, y: 10.5 },
  { x: 13, y: 17 }, { x: 22, y: 21 }, { x: 31, y: 20.5 }, { x: 37.5, y: 24 },
  { x: 43, y: 31 }, { x: 47, y: 38 }, { x: 50, y: 44 },
]);

/** Side channel: leaves the main at the island's west tip and rejoins east. */
const SIDE_CONTROL: readonly Point[] = Object.freeze([
  { x: 9, y: 13 }, { x: 12.5, y: 16.5 }, { x: 17, y: 12.5 }, { x: 24, y: 10 },
  { x: 31, y: 11.5 }, { x: 35.5, y: 17 }, { x: 38.5, y: 23.5 }, { x: 42, y: 30 },
]);

function createChannels(): readonly Channel[] {
  return Object.freeze([
    Object.freeze({
      samples: Object.freeze(sampleSpline(MAIN_CONTROL, 26)),
      halfWidth: (u: number): number => 2.35 + Math.sin(u * 7.1 + 0.4) * 0.55 + u * 0.5,
    }),
    Object.freeze({
      samples: Object.freeze(sampleSpline(SIDE_CONTROL, 26)),
      halfWidth: (u: number): number => 1.45 + Math.sin(u * 5.3 + 1.9) * 0.42,
    }),
  ]);
}

/**
 * Signed distance to the nearest channel centreline, in tiles, normalised by
 * that channel's local half-width. Below 1.0 is inside the wetted channel.
 */
function channelField(channels: readonly Channel[], x: number, y: number): number {
  let best = Number.POSITIVE_INFINITY;
  for (const channel of channels) {
    const { samples } = channel;
    for (let index = 0; index < samples.length; index += 1) {
      const sample = samples[index];
      const dx = x - sample.x;
      const dy = y - sample.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared > 400) continue;
      const u = index / Math.max(1, samples.length - 1);
      const normalised = Math.sqrt(distanceSquared) / channel.halfWidth(u);
      if (normalised < best) best = normalised;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// corner material field
// ---------------------------------------------------------------------------

const CORNER_SEED = 0x5f37;

function cliffField(x: number, y: number): number {
  // A rock shoulder in the north-east corner and a short terrace on the east
  // margin - a frame for the valley, not a wall across it. The foot is ragged
  // because it is a noise contour, never a drawn boundary.
  const shoulder = (x - 41.5) * 0.30 + (7.5 - y) * 0.26;
  const terrace = (x - 45.5) * 0.34 + Math.sin(y * 0.28) * 0.26 - Math.abs(y - 24) * 0.10;
  const ridge = Math.max(shoulder, terrace);
  return ridge + (fbm(x * 0.17, y * 0.17, CORNER_SEED + 400, 4) - 0.5) * 1.10;
}

function cornerMaterialAt(
  channels: readonly Channel[],
  x: number,
  y: number,
): ValleyMaterial {
  // Perturb the channel distance so the banks meander instead of offsetting.
  const wobble = (fbm(x * 0.19, y * 0.19, CORNER_SEED, 4) - 0.5) * 0.46
    + (fbm(x * 0.55, y * 0.55, CORNER_SEED + 90, 3) - 0.5) * 0.17;
  const distance = channelField(channels, x, y) + wobble;

  // Inside the wetted channel the river is ONE body of water. Depth is a
  // mottled core, not a concentric ribbon - concentric bands read as a contour
  // map, which is the failure the first pass made plain.
  if (distance < 0.97) {
    const core = fbm(x * 0.23, y * 0.23, CORNER_SEED + 610, 4);
    if (distance < 0.74 && core > 0.455) return "deepwater";
    if (distance > 0.78 && fbm(x * 0.34, y * 0.34, CORNER_SEED + 640, 3) > 0.545) {
      return "shallow";
    }
    return "water";
  }

  // Gravel bars are places, not an outline: a low-frequency mask decides where
  // shingle has actually built up, so most of the bank never sees any. The
  // reference's shingle is a NARROW strip a few pixels wide at the waterline,
  // never an apron - the first pass's wider bars read as a concrete forecourt
  // once the palette went pale, so the reach and the threshold both tightened.
  const bar = fbm(x * 0.098, y * 0.098, CORNER_SEED + 210, 3);
  if (distance < 1.32 && bar > 0.700) return "gravel";

  // Reed beds crowd the slack water on the inside of bends.
  const reedNoise = fbm(x * 0.135, y * 0.135, CORNER_SEED + 700, 4);
  if (distance < 1.40 && reedNoise > 0.560) return "reed";

  // A wet silt lip whose width breathes, so the bank is not a drawn outline
  // offset from the water at a constant distance.
  const siltReach = 1.06 + (fbm(x * 0.16, y * 0.16, CORNER_SEED + 830, 3) - 0.5) * 0.42;
  if (distance < siltReach) return "silt";

  // The terrace is a grassy upland whose EDGES are rock, not a rock field.
  //
  // The reference plate is explicit about this: the tops of its terraces are
  // grass with stone showing only along the break, and boulders scattered on
  // top. Making every corner inside the ridge `rock` gave the north-east
  // shoulder a uniform stone texture over ~150 tiles, which at 1:1 read as a
  // cobbled plaza however the texture was drawn - the third time this element
  // has been rebuilt. A BAND of rock along the contour gives the valley the same
  // framing barrier, a legible scarp to hang the authored faces on, and grass
  // where grass belongs.
  const ridge = cliffField(x, y);
  if (ridge > 0 && ridge < 1.05) return "rock";

  // Dense scrub thickets: the dark tone the meadow needs, and ground a body
  // genuinely cannot push through.
  const scrub = fbm(x * 0.105, y * 0.105, CORNER_SEED + 520, 4);
  if (scrub > 0.632 && distance > 1.45) return "thicket";

  // Sunlit flower drifts in broad, soft-edged sweeps rather than confetti - the
  // large tonal shapes are what stop an open meadow reading as flat paint.
  const flowers = fbm(x * 0.082, y * 0.082, CORNER_SEED + 310, 4);
  if (flowers > 0.575) return "meadow";

  // TONAL MODELLING OF THE SWARD - the pilot report's largest remaining gap.
  //
  // A tile atlas cannot carry variation larger than a tile, so the broad lit and
  // shadowed passages the reference plate models in paint have to come from the
  // material field. Two things drive it, and both are deliberate:
  //
  //  - the SAME scrub field that decides where thickets grow also decides where
  //    the sward is shaded, just below the thicket threshold. So the dark grass
  //    hugs the dark masses, exactly as it does in the reference, where the
  //    ground under and beside a stand of trees is a value or two down;
  //  - a separate, even lower-frequency light field lifts the open swells into
  //    the warm ochre tier, which is where the plate gets its warmth.
  //
  // Every tier is non-blocking sward, so this changes the picture and not one
  // bit of the walkability mask.
  if (scrub > 0.565) return "shadegrass";
  const light = fbm(x * 0.074, y * 0.074, CORNER_SEED + 880, 3);
  if (light > 0.552) return "sungrass";
  if (light < 0.448) return "shadegrass";
  return "grass";
}

function cornerIndex(column: number, row: number): number {
  return row * (VALLEY_COLUMNS + 1) + column;
}

function buildCornerField(channels: readonly Channel[]): ValleyMaterial[] {
  const corners: ValleyMaterial[] = new Array((VALLEY_COLUMNS + 1) * (VALLEY_ROWS + 1));
  for (let row = 0; row <= VALLEY_ROWS; row += 1) {
    for (let column = 0; column <= VALLEY_COLUMNS; column += 1) {
      corners[cornerIndex(column, row)] = cornerMaterialAt(channels, column, row);
    }
  }
  return corners;
}

/** Paint a walkable shingle causeway into the corner field. */
function carveCrossing(
  corners: ValleyMaterial[],
  from: Point,
  to: Point,
  halfWidth: number,
  material: ValleyMaterial = "gravel",
): Array<{ column: number; row: number }> {
  const touched: Array<{ column: number; row: number }> = [];
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  const steps = Math.max(2, Math.ceil(length * 4));
  const radius = Math.ceil(halfWidth) + 1;
  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;
    const cx = from.x + dx * t;
    const cy = from.y + dy * t;
    for (let row = Math.floor(cy - radius); row <= Math.ceil(cy + radius); row += 1) {
      for (let column = Math.floor(cx - radius); column <= Math.ceil(cx + radius); column += 1) {
        if (column < 0 || row < 0 || column > VALLEY_COLUMNS || row > VALLEY_ROWS) continue;
        const jitter = (fbm(column * 0.7, row * 0.7, CORNER_SEED + 950, 2) - 0.5) * 0.55;
        if (Math.hypot(column - cx, row - cy) > halfWidth + jitter) continue;
        corners[cornerIndex(column, row)] = material;
        touched.push({ column, row });
      }
    }
  }
  return touched;
}

// ---------------------------------------------------------------------------
// tile derivation
// ---------------------------------------------------------------------------

function isBlockingMaterial(material: ValleyMaterial): boolean {
  return BLOCKING_VALLEY_MATERIALS.includes(material);
}

function tileVariant(column: number, row: number, salt: number, count: number): number {
  return Math.floor(hash2(column, row, 0x1234 + salt) * count) % count;
}

function deriveTile(
  corners: readonly ValleyMaterial[],
  column: number,
  row: number,
): ValleyTile {
  const cornerMaterials: readonly ValleyMaterial[] = [
    corners[cornerIndex(column, row)],
    corners[cornerIndex(column + 1, row)],
    corners[cornerIndex(column + 1, row + 1)],
    corners[cornerIndex(column, row + 1)],
  ];
  const priorities = cornerMaterials.map((material) => VALLEY_MATERIAL_PRIORITY[material]);
  const basePriority = Math.min(...priorities);
  const base = cornerMaterials[priorities.indexOf(basePriority)];

  const present = [...new Set(cornerMaterials)]
    .filter((material) => VALLEY_MATERIAL_PRIORITY[material] > basePriority)
    .sort((left, right) => VALLEY_MATERIAL_PRIORITY[left] - VALLEY_MATERIAL_PRIORITY[right]);

  const overlays: ValleyTileOverlay[] = [];
  const shorelines: ValleyTileShoreline[] = [];
  const baseIsWater = isWaterMaterial(base);
  for (const material of present) {
    const threshold = VALLEY_MATERIAL_PRIORITY[material];
    let mask = 0;
    for (let corner = 0; corner < 4; corner += 1) {
      if (priorities[corner] >= threshold) mask |= 1 << corner;
    }
    if (mask === 0) continue;
    // Mask 15 is total coverage and is served by the material's own base fill,
    // so it draws from the 8 base variants; a partial mask draws from however
    // many transition variants that material was authored with.
    const salt = VALLEY_MATERIAL_PRIORITY[material] * 31 + mask;
    const variant = mask === 15
      ? tileVariant(column, row, salt, VALLEY_BASE_VARIANTS)
      : tileVariant(column, row, salt, VALLEY_EDGE_VARIANTS[material]);
    overlays.push({ material, mask, variant });
    // A waterline belongs wherever a bank material meets the river ON this
    // tile: water always has the lower priority, so it is always the base.
    if (baseIsWater && mask !== 15 && hasShoreSet(material)) {
      shorelines.push({ material, mask, variant });
    }
  }

  // Walkability: blocked when at least half the tile's area is a blocking
  // material. Corner samples are an exact area estimate for a bilinear field.
  const blockingCorners = cornerMaterials.filter(isBlockingMaterial).length;
  const blocked = blockingCorners >= 2;

  // The tile's reported material must EXPLAIN its walkability, so it is chosen
  // only from corners that agree with `blocked`: a tile the navigator refuses
  // always names a blocking material, and an open tile never does. Picking the
  // dominant corner material independently let 25 tiles report, say, "gravel"
  // while being blocked - a mask nobody could audit against the art.
  const agreeing = cornerMaterials.filter(
    (candidate) => isBlockingMaterial(candidate) === blocked,
  );
  const tally = new Map<ValleyMaterial, number>();
  for (const candidate of agreeing) {
    tally.set(candidate, (tally.get(candidate) ?? 0) + 1);
  }
  let material = agreeing[0];
  let bestCount = -1;
  for (const [candidate, count] of tally) {
    const better = count > bestCount
      || (count === bestCount
        && VALLEY_MATERIAL_PRIORITY[candidate] < VALLEY_MATERIAL_PRIORITY[material]);
    if (better) {
      material = candidate;
      bestCount = count;
    }
  }

  return Object.freeze({
    column,
    row,
    base,
    baseVariant: tileVariant(column, row, VALLEY_MATERIAL_PRIORITY[base], VALLEY_BASE_VARIANTS),
    overlays: Object.freeze(overlays),
    shorelines: Object.freeze(shorelines),
    material,
    blocked,
    bridgeDeck: false,
    deckOver: null,
  });
}

function deriveTiles(corners: readonly ValleyMaterial[]): ValleyTile[] {
  const tiles: ValleyTile[] = new Array(VALLEY_COLUMNS * VALLEY_ROWS);
  for (let row = 0; row < VALLEY_ROWS; row += 1) {
    for (let column = 0; column < VALLEY_COLUMNS; column += 1) {
      tiles[row * VALLEY_COLUMNS + column] = deriveTile(corners, column, row);
    }
  }
  return tiles;
}

function collisionFrom(tiles: readonly ValleyTile[]): Uint8Array {
  const collision = new Uint8Array(VALLEY_COLUMNS * VALLEY_ROWS);
  for (let index = 0; index < tiles.length; index += 1) {
    collision[index] = tiles[index].blocked ? 1 : 0;
  }
  return collision;
}

// ---------------------------------------------------------------------------
// bridges
// ---------------------------------------------------------------------------
//
// A ford and a line of stepping stones say "you can probably get across here".
// A bridge says "people cross here" - it is infrastructure, and it is the
// clearest possible demonstration that this terrain is real rather than
// painted: the deck tiles are WALKABLE across water that is blocked on either
// side of them, and the real navigator routes over them.
//
// The span is not a hard-coded tile list. Each plan names a line and one point
// KNOWN to be in the water; the builder then walks outward along that line over
// the derived tiles and takes the whole contiguous blocked run as the deck, and
// the first walkable tile past each end as an abutment. So the bridge is
// derived from the same field the art is derived from: it always lands on the
// banks the river actually has, and it can never be drawn hanging over dry
// ground because the field moved.

interface BridgePlan {
  readonly id: string;
  readonly axis: ValleyBridgeAxis;
  /** Row for an east-west span, column for a north-south span. */
  readonly line: number;
  /** A position along the span axis that is inside the water to be crossed. */
  readonly midstream: number;
}

/**
 * The authored crossings. Each sits where two banks face each other across a
 * reasonably narrow reach, and the three are spread so the valley is not
 * crossed only in one place: the upper main channel in the north-west, the
 * side channel that forms the island, and the lower main river in the centre.
 */
/**
 * Which authored bridges are STONE rather than timber.
 *
 * The world atlas carries a grey stone causeway as well as a plank one; three
 * identical timber bridges read as one asset repeated, so the lower crossing is
 * built in stone - its own deck, parapet and springing piers.
 */
const STONE_ARCH_BRIDGES: ReadonlySet<string> = new Set(["lower-plank-bridge"]);

const BRIDGE_PLANS: readonly BridgePlan[] = Object.freeze([
  { id: "north-plank-bridge", axis: "east-west", line: 3, midstream: 14 },
  // Column 20 rather than 21: after the shingle bars narrowed, column 21's
  // blocked run reached one tile further north into the reed fringe, so the
  // span would have carried a deck over reed rather than over the channel. A
  // bridge crosses the WATER; the reed bed is bank.
  { id: "island-plank-bridge", axis: "north-south", line: 20, midstream: 10 },
  { id: "lower-plank-bridge", axis: "north-south", line: 28, midstream: 20 },
]);

function tileRefAlong(plan: BridgePlan, position: number): ValleyTileRef {
  return plan.axis === "east-west"
    ? { column: position, row: plan.line }
    : { column: plan.line, row: position };
}

/**
 * Resolve one bridge plan against the derived tiles.
 *
 * @throws ValleySceneError when the named midstream point is not blocked, when
 *   the blocked run is longer than a plausible span, or when either end fails
 *   to reach walkable ground - all authoring errors, and all better loud.
 */
function resolveBridge(tiles: readonly ValleyTile[], plan: BridgePlan): ValleyBridge {
  const limit = plan.axis === "east-west" ? VALLEY_COLUMNS : VALLEY_ROWS;
  const blockedAt = (position: number): boolean => {
    if (position < 0 || position >= limit) return true;
    const ref = tileRefAlong(plan, position);
    return tiles[ref.row * VALLEY_COLUMNS + ref.column].blocked;
  };

  if (!blockedAt(plan.midstream)) {
    throw new ValleySceneError(
      `Bridge ${plan.id}: midstream ${plan.midstream} is not over blocked water.`,
    );
  }

  let first = plan.midstream;
  while (
    first > 0
    && blockedAt(first - 1)
    && plan.midstream - first < MAX_BRIDGE_DECK_TILES
  ) first -= 1;
  let last = plan.midstream;
  while (
    last < limit - 1
    && blockedAt(last + 1)
    && last - plan.midstream < MAX_BRIDGE_DECK_TILES
  ) last += 1;

  if (blockedAt(first - 1) || blockedAt(last + 1)) {
    throw new ValleySceneError(
      `Bridge ${plan.id}: the blocked run from ${first} to ${last} does not reach walkable `
      + `ground at both ends within ${MAX_BRIDGE_DECK_TILES} tiles.`,
    );
  }

  const deck: ValleyTileRef[] = [];
  for (let position = first; position <= last; position += 1) {
    deck.push(Object.freeze(tileRefAlong(plan, position)));
  }
  return Object.freeze({
    id: plan.id,
    axis: plan.axis,
    deck: Object.freeze(deck),
    abutments: Object.freeze([
      Object.freeze(tileRefAlong(plan, first - 1)),
      Object.freeze(tileRefAlong(plan, last + 1)),
    ]),
  });
}

function resolveBridges(tiles: readonly ValleyTile[]): ValleyBridge[] {
  return BRIDGE_PLANS.map((plan) => resolveBridge(tiles, plan));
}

/**
 * Worn approach tracks fanning inland from each bridgehead.
 *
 * A bridge drawn in isolation reads as scenery. Two trodden silt tracks
 * converging on the abutment read as infrastructure - somewhere people
 * habitually walk to. They start half a tile inland so the river bank itself is
 * never carved away, and silt is walkable, so a track can only ever open ground.
 */
function carveBridgeApproaches(corners: ValleyMaterial[], bridges: readonly ValleyBridge[]): void {
  for (const bridge of bridges) {
    for (const abutment of bridge.abutments) {
      const nearestDeck = bridge.deck.reduce((best, candidate) => {
        const bestDistance = Math.hypot(best.column - abutment.column, best.row - abutment.row);
        const distance = Math.hypot(
          candidate.column - abutment.column,
          candidate.row - abutment.row,
        );
        return distance < bestDistance ? candidate : best;
      });
      // Inland is simply "away from the deck", normalised.
      const dx = abutment.column - nearestDeck.column;
      const dy = abutment.row - nearestDeck.row;
      const length = Math.max(1e-6, Math.hypot(dx, dy));
      const inlandX = dx / length;
      const inlandY = dy / length;
      const origin = {
        x: abutment.column + 0.5 + inlandX * 0.35,
        y: abutment.row + 0.5 + inlandY * 0.35,
      };
      const branches: readonly Readonly<{ angle: number; reach: number }>[] = [
        { angle: 0.60, reach: 2.6 },
        { angle: -0.52, reach: 3.4 },
      ];
      for (const branch of branches) {
        const cos = Math.cos(branch.angle);
        const sin = Math.sin(branch.angle);
        carveCrossing(
          corners,
          origin,
          {
            x: origin.x + (inlandX * cos - inlandY * sin) * branch.reach,
            y: origin.y + (inlandX * sin + inlandY * cos) * branch.reach,
          },
          0.55,
          "silt",
        );
      }
    }
  }
}

/**
 * Hand every deck tile to its bridge.
 *
 * The tile keeps the base fill and overlays it was derived with - the river is
 * still painted underneath - but it now reports `deck`, is walkable, and
 * remembers the blocking material it spans, so the mask remains auditable
 * against the picture tile by tile.
 */
function applyBridgeDecks(
  tiles: readonly ValleyTile[],
  bridges: readonly ValleyBridge[],
): ValleyTile[] {
  const decked = [...tiles];
  for (const bridge of bridges) {
    for (const ref of bridge.deck) {
      const index = ref.row * VALLEY_COLUMNS + ref.column;
      const tile = decked[index];
      decked[index] = Object.freeze({
        ...tile,
        material: "deck" as ValleyMaterial,
        blocked: false,
        bridgeDeck: true,
        deckOver: tile.material,
      });
    }
  }
  return decked;
}

// ---------------------------------------------------------------------------
// connectivity
// ---------------------------------------------------------------------------

export interface ValleyComponent {
  readonly tiles: readonly number[];
}

/** Four-connected walkable components over a row-major collision mask. */
export function walkableComponents(
  collision: Uint8Array,
  columns: number,
  rows: number,
): ValleyComponent[] {
  const seen = new Uint8Array(collision.length);
  const components: ValleyComponent[] = [];
  for (let start = 0; start < collision.length; start += 1) {
    if (collision[start] === 1 || seen[start] === 1) continue;
    const tiles: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const index = stack.pop() as number;
      tiles.push(index);
      const column = index % columns;
      const row = Math.floor(index / columns);
      const neighbours = [
        column > 0 ? index - 1 : -1,
        column < columns - 1 ? index + 1 : -1,
        row > 0 ? index - columns : -1,
        row < rows - 1 ? index + columns : -1,
      ];
      for (const neighbour of neighbours) {
        if (neighbour < 0 || seen[neighbour] === 1 || collision[neighbour] === 1) continue;
        seen[neighbour] = 1;
        stack.push(neighbour);
      }
    }
    components.push({ tiles });
  }
  components.sort((left, right) => right.tiles.length - left.tiles.length);
  return components;
}

function centroidOf(component: ValleyComponent, columns: number): Point {
  let sumX = 0;
  let sumY = 0;
  for (const index of component.tiles) {
    sumX += index % columns;
    sumY += Math.floor(index / columns);
  }
  return { x: sumX / component.tiles.length, y: sumY / component.tiles.length };
}

/** Nearest pair of tiles between two components, as a crossing to carve. */
function nearestPair(
  left: ValleyComponent,
  right: ValleyComponent,
  columns: number,
): { from: Point; to: Point } {
  let best = Number.POSITIVE_INFINITY;
  let from: Point = centroidOf(left, columns);
  let to: Point = centroidOf(right, columns);
  for (const a of left.tiles) {
    const ax = a % columns;
    const ay = Math.floor(a / columns);
    for (const b of right.tiles) {
      const bx = b % columns;
      const by = Math.floor(b / columns);
      const distance = (ax - bx) ** 2 + (ay - by) ** 2;
      if (distance < best) {
        best = distance;
        from = { x: ax, y: ay };
        to = { x: bx, y: by };
      }
    }
  }
  return { from, to };
}

/** Seal a pocket too small to deserve a bridge, so nothing can be stranded. */
function sealPocket(corners: ValleyMaterial[], component: ValleyComponent, columns: number): void {
  for (const index of component.tiles) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    for (const [dc, dr] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
      corners[cornerIndex(column + dc, row + dr)] = "reed";
    }
  }
}

// ---------------------------------------------------------------------------
// scenery
// ---------------------------------------------------------------------------

interface SpeciesRule {
  readonly id: string;
  readonly variants: number;
  /** Materials the species may stand on. */
  readonly on: readonly ValleyMaterial[];
  /** Normalised channel distance window, or null for anywhere. */
  readonly wetness: readonly [number, number] | null;
  readonly blocks: boolean;
  /** Cluster count and per-cluster spread/population. */
  readonly clusters: number;
  readonly spread: number;
  readonly perCluster: number;
  readonly scatter: number;
  readonly seed: number;
}

/**
 * Sward as habitat. The three tonal tiers are one ground for every plant, so
 * every `on` list that used to say "grass" says all three: adding tonal
 * modelling to the picture must not move a single tree, and this is what makes
 * that true rather than hoped for.
 */
const ON_SWARD: readonly ValleyMaterial[] = GRASS_FAMILY;
const ON_SWARD_AND_MEADOW: readonly ValleyMaterial[] = [...GRASS_FAMILY, "meadow"];

const SPECIES: readonly SpeciesRule[] = Object.freeze([
  {
    // Willows are the reference's signature and they lean over the WATER, so
    // they get the widest near-channel window and the most clusters of any tree.
    id: "willow", variants: 6, on: ["silt", ...ON_SWARD, "gravel"], wetness: [1.0, 2.8],
    blocks: true, clusters: 15, spread: 2.6, perCluster: 5, scatter: 0, seed: 101,
  },
  {
    id: "birch", variants: 6, on: ON_SWARD_AND_MEADOW, wetness: [2.0, 9], blocks: true,
    clusters: 8, spread: 3.0, perCluster: 6, scatter: 0, seed: 211,
  },
  {
    id: "broadleaf", variants: 8, on: ON_SWARD_AND_MEADOW, wetness: [1.7, 9], blocks: true,
    clusters: 13, spread: 3.2, perCluster: 5, scatter: 14, seed: 307,
  },
  {
    id: "conifer", variants: 5, on: ON_SWARD, wetness: [2.4, 9], blocks: true,
    clusters: 6, spread: 2.4, perCluster: 4, scatter: 8, seed: 401,
  },
  {
    id: "shrub", variants: 6, on: [...ON_SWARD_AND_MEADOW, "silt", "thicket"], wetness: null,
    blocks: false, clusters: 20, spread: 3.4, perCluster: 7, scatter: 110, seed: 503,
  },
  {
    id: "reedclump", variants: 6, on: ["reed"], wetness: null, blocks: false,
    clusters: 0, spread: 0, perCluster: 0, scatter: 520, seed: 601,
  },
  {
    id: "boulder", variants: 5, on: [...ON_SWARD, "gravel", "silt", "meadow"], wetness: null,
    blocks: true, clusters: 11, spread: 2.2, perCluster: 3, scatter: 20, seed: 701,
  },
  {
    // Outcrops littering the rock terrace. The ground there is already blocked,
    // so these are decoration and are marked as such.
    id: "outcrop", variants: 4, on: ["rock"], wetness: null, blocks: false,
    clusters: 0, spread: 0, perCluster: 0, scatter: 180, seed: 743,
  },
  {
    id: "cobble", variants: 4, on: ["gravel", "silt"], wetness: null, blocks: false,
    clusters: 0, spread: 0, perCluster: 0, scatter: 240, seed: 809,
  },
  {
    // Drifts, not confetti: each sprite is now a 56x40 MASS of petals, so the
    // count comes down and the coverage goes up. Concentrated in the meadow and
    // the sunlit tier, because that is where the reference puts them.
    id: "flowerdrift", variants: 6, on: ["meadow", "sungrass", "grass"], wetness: null,
    blocks: false, clusters: 18, spread: 2.6, perCluster: 6, scatter: 46, seed: 907,
  },
  {
    id: "tuft", variants: 4, on: [...ON_SWARD_AND_MEADOW, "silt", "gravel"], wetness: null,
    blocks: false, clusters: 0, spread: 0, perCluster: 0, scatter: 520, seed: 1009,
  },
  {
    id: "driftwood", variants: 2, on: ["gravel", "silt"], wetness: null, blocks: false,
    clusters: 0, spread: 0, perCluster: 0, scatter: 22, seed: 1103,
  },
]);

/** Open ground the composition needs, and where beings will actually gather. */
const CLEARINGS: readonly Readonly<{ x: number; y: number; radius: number }>[] = Object.freeze([
  { x: 24.5, y: 15.5, radius: 4.4 },
  { x: 6.5, y: 22.5, radius: 4.0 },
  { x: 31.5, y: 27.0, radius: 4.2 },
  { x: 20.0, y: 5.0, radius: 3.6 },
]);

function insideClearing(x: number, y: number): boolean {
  for (const clearing of CLEARINGS) {
    if (Math.hypot(x - clearing.x, y - clearing.y) < clearing.radius) return true;
  }
  return false;
}

interface PropCandidate {
  readonly species: SpeciesRule;
  readonly column: number;
  readonly row: number;
  readonly variant: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

function candidatePositions(
  species: SpeciesRule,
  channels: readonly Channel[],
): PropCandidate[] {
  const out: PropCandidate[] = [];
  const push = (x: number, y: number, salt: number): void => {
    const column = Math.floor(x);
    const row = Math.floor(y);
    if (column < 1 || row < 1 || column >= VALLEY_COLUMNS - 1 || row >= VALLEY_ROWS - 1) return;
    if (species.wetness !== null) {
      const distance = channelField(channels, x, y);
      if (distance < species.wetness[0] || distance > species.wetness[1]) return;
    }
    if (species.blocks && insideClearing(x, y)) return;
    out.push({
      species,
      column,
      row,
      variant: Math.floor(hash2(column, row, species.seed + salt) * species.variants)
        % species.variants,
      offsetX: (hash2(column, row, species.seed + salt + 7) - 0.5) * 22,
      offsetY: (hash2(column, row, species.seed + salt + 13) - 0.5) * 18,
    });
  };

  for (let cluster = 0; cluster < species.clusters; cluster += 1) {
    const cx = hash2(cluster, species.seed, 17) * VALLEY_COLUMNS;
    const cy = hash2(cluster, species.seed, 29) * VALLEY_ROWS;
    for (let member = 0; member < species.perCluster; member += 1) {
      const angle = hash2(cluster, member, species.seed + 41) * Math.PI * 2;
      const radius = Math.sqrt(hash2(cluster, member, species.seed + 53)) * species.spread;
      push(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, member * 3 + cluster);
    }
  }
  for (let index = 0; index < species.scatter; index += 1) {
    push(
      hash2(index, species.seed, 61) * VALLEY_COLUMNS,
      hash2(index, species.seed, 71) * VALLEY_ROWS,
      index + 500,
    );
  }
  return out;
}

/** Sprite feet offsets, kept in step with the authoring script's pivots. */
const PROP_PIVOTS: Readonly<Record<string, readonly [number, number, number, number]>> =
  Object.freeze({
    // [frameWidth, frameHeight, pivotX, pivotY]
    willow: [112, 118, 56, 110],
    birch: [72, 106, 36, 100],
    broadleaf: [88, 94, 44, 88],
    conifer: [60, 96, 30, 92],
    shrub: [48, 48, 24, 45],
    reedclump: [44, 84, 22, 80],
    reedwater: [44, 84, 22, 80],
    boulder: [44, 36, 22, 33],
    outcrop: [40, 30, 20, 27],
    cobble: [20, 14, 10, 12],
    flowerdrift: [56, 40, 28, 37],
    tuft: [24, 18, 12, 16],
    driftwood: [48, 20, 24, 17],
    // The scarp: a running face plus the two corners, so a terrace can turn.
    scarpface: [88, 54, 44, 48],
    scarpcornerout: [48, 46, 24, 41],
    scarpcornerin: [48, 46, 24, 41],
    steppingstone: [26, 16, 13, 13],
    // Bridge pieces are tile-sized and anchored to the bottom of their own
    // tile, so a deck segment lands exactly on the tile it carries.
    bridgedeckh: [32, 32, 16, 31],
    bridgedeckv: [32, 32, 16, 31],
    bridgewornh: [32, 32, 16, 31],
    bridgewornv: [32, 32, 16, 31],
    bridgedeckdne: [32, 32, 16, 31],
    bridgedeckdnw: [32, 32, 16, 31],
    bridgeramph: [32, 32, 16, 31],
    bridgerampv: [32, 32, 16, 31],
    bridgeposth: [32, 32, 16, 31],
    bridgepostv: [32, 32, 16, 31],
    bridgearchh: [32, 32, 16, 31],
    bridgearchv: [32, 32, 16, 31],
    bridgepier: [32, 32, 16, 31],
    bridgearchpier: [32, 32, 16, 31],
  });

function makeProp(
  id: string,
  frameId: string,
  species: string,
  footX: number,
  footY: number,
  blocks: boolean,
): ValleyProp {
  const [, , pivotX, pivotY] = PROP_PIVOTS[species];
  return Object.freeze({
    id,
    frameId,
    x: Math.round(footX - pivotX),
    y: Math.round(footY - pivotY),
    footX: Math.round(footX),
    footY: Math.round(footY),
    blocks,
    tile: Object.freeze({
      column: Math.floor(footX / VALLEY_TILE_SIZE),
      row: Math.floor(footY / VALLEY_TILE_SIZE),
    }),
  });
}

function placeProps(
  tiles: readonly ValleyTile[],
  channels: readonly Channel[],
  crossings: readonly ValleyCrossing[],
  bridges: readonly ValleyBridge[],
): ValleyProp[] {
  const props: ValleyProp[] = [];
  const claimed = new Set<string>();

  // A bridgehead must stay open: nothing that blocks may be planted on an
  // abutment, or the bridge would land against a tree.
  for (const bridge of bridges) {
    for (const abutment of bridge.abutments) {
      claimed.add(`block:${abutment.column},${abutment.row}`);
    }
  }
  const tileAt = (column: number, row: number): ValleyTile | null => (
    column < 0 || row < 0 || column >= VALLEY_COLUMNS || row >= VALLEY_ROWS
      ? null
      : tiles[row * VALLEY_COLUMNS + column]
  );

  // The SCARP rides the rock margin, drawn as scenery so the terrace reads as
  // relief. It is decoration on ground that is already blocked as rock.
  //
  // The piece is chosen from the shape of the margin, which is the whole point
  // of authoring corners: a terrace that can only run in one direction until it
  // stops reads as a fence, and that was the pilot's weakest element after
  // three iterations. Where the rock mass ENDS the edge turns away from the
  // viewer and takes an outside corner; where the margin steps back it takes an
  // inside corner and the crease goes into shadow; in between it runs.
  const isRock = (column: number, row: number): boolean => (
    tileAt(column, row)?.material === "rock"
  );
  for (let row = 0; row < VALLEY_ROWS; row += 1) {
    for (let column = 0; column < VALLEY_COLUMNS; column += 1) {
      const tile = tileAt(column, row);
      const below = tileAt(column, row + 1);
      if (tile === null || below === null) continue;
      if (tile.material !== "rock" || below.material === "rock") continue;
      // A running FACE is only drawn where the margin actually runs east-west
      // for at least three tiles. On a diagonal step consecutive tiles are
      // offset by a whole tile in BOTH axes, so wide face pieces can never merge
      // there and read as a stack of separate objects - which is what the pilot's
      // cliffs have been criticised for three times. A step gets the compact
      // corner piece instead, and reads as an outcrop on the break.
      const westEdge = isRock(column - 1, row) && !isRock(column - 1, row + 1);
      const eastEdge = isRock(column + 1, row) && !isRock(column + 1, row + 1);
      const westSteps = isRock(column - 1, row + 1);
      const eastSteps = isRock(column + 1, row + 1);
      const species = westEdge && eastEdge
        ? "scarpface"
        : westSteps || eastSteps ? "scarpcornerin" : "scarpcornerout";
      const variants = species === "scarpface" ? 4 : 2;
      claimed.add(`cliff:${column},${row}`);
      const variant = Math.floor(hash2(column, row, 1301) * variants) % variants;
      props.push(makeProp(
        `cliff:${column},${row}`,
        `s.${species}.${variant}`,
        species,
        column * VALLEY_TILE_SIZE + VALLEY_TILE_SIZE / 2
          + (hash2(column, row, 1303) - 0.5) * 8,
        row * VALLEY_TILE_SIZE + VALLEY_TILE_SIZE + 12,
        false,
      ));
    }
  }

  // Reed clumps standing IN the water at the margin. They carry a broken
  // reflection instead of a contact shadow, which is how the reference's reeds
  // sit in the shallows; the water they stand in is already blocked, so they are
  // pure decoration and are marked as such.
  for (let row = 1; row < VALLEY_ROWS - 1; row += 1) {
    for (let column = 1; column < VALLEY_COLUMNS - 1; column += 1) {
      const tile = tileAt(column, row);
      if (tile === null || tile.bridgeDeck) continue;
      if (tile.material !== "water" && tile.material !== "shallow") continue;
      const margin = [
        tileAt(column - 1, row), tileAt(column + 1, row),
        tileAt(column, row - 1), tileAt(column, row + 1),
      ].some((neighbour) => neighbour !== null
        && (neighbour.material === "reed" || neighbour.material === "silt"
          || neighbour.material === "gravel"));
      if (!margin) continue;
      if (hash2(column, row, 1607) < 0.52) continue;
      const variant = Math.floor(hash2(column, row, 1609) * 4) % 4;
      props.push(makeProp(
        `reedwater:${column},${row}`,
        `s.reedwater.${variant}`,
        "reedwater",
        column * VALLEY_TILE_SIZE + VALLEY_TILE_SIZE / 2
          + (hash2(column, row, 1613) - 0.5) * 18,
        row * VALLEY_TILE_SIZE + VALLEY_TILE_SIZE / 2
          + (hash2(column, row, 1619) - 0.5) * 14,
        false,
      ));
    }
  }

  for (const species of SPECIES) {
    for (const candidate of candidatePositions(species, channels)) {
      const tile = tileAt(candidate.column, candidate.row);
      if (tile === null) continue;
      if (!species.on.includes(tile.material)) continue;
      const key = `${species.id}:${candidate.column},${candidate.row}`;
      if (claimed.has(key)) continue;
      // Blocking props may not stack, and may not stand on already blocked ground.
      if (species.blocks) {
        const occupancy = `block:${candidate.column},${candidate.row}`;
        if (claimed.has(occupancy) || tile.blocked) continue;
        claimed.add(occupancy);
      }
      claimed.add(key);
      const footX = candidate.column * VALLEY_TILE_SIZE + VALLEY_TILE_SIZE / 2 + candidate.offsetX;
      const footY = candidate.row * VALLEY_TILE_SIZE + VALLEY_TILE_SIZE / 2 + candidate.offsetY;
      props.push(makeProp(
        `${species.id}:${candidate.column},${candidate.row}`,
        `s.${species.id}.${candidate.variant}`,
        species.id,
        footX,
        footY,
        species.blocks,
      ));
    }
  }

  // Stepping stones mark the shallow crossings so a ford reads as a crossing.
  for (const crossing of crossings) {
    if (crossing.kind !== "stepping-stones") continue;
    crossing.tiles.forEach((tile, index) => {
      if (index % 2 !== 0) return;
      const variant = Math.floor(hash2(tile.column, tile.row, 1409) * 3) % 3;
      props.push(makeProp(
        `stone:${crossing.id}:${index}`,
        `s.steppingstone.${variant}`,
        "steppingstone",
        tile.column * VALLEY_TILE_SIZE + VALLEY_TILE_SIZE / 2,
        tile.row * VALLEY_TILE_SIZE + VALLEY_TILE_SIZE / 2 + 6,
        false,
      ));
    });
  }

  // Bridges. Every piece is anchored to the bottom of its own tile, so the run
  // of deck segments joins seamlessly and the stone abutments land on the bank
  // tiles the deck reaches. Ordering falls out of the global foot sort: pieces
  // are compared by foot, then by x, then by id - and `bridge:` sorts before
  // `pier:`, so on an abutment tile the deck is laid first and the stone block
  // is set on top of it, exactly as it reads on the world atlas.
  for (const bridge of bridges) {
    const horizontal = bridge.axis === "east-west";
    // One of the three is the STONE causeway the world atlas also carries, so
    // the valley does not read as three copies of one timber bridge.
    const stone = STONE_ARCH_BRIDGES.has(bridge.id);
    const suffix = horizontal ? "h" : "v";
    const deckFrame = stone ? `bridgearch${suffix}` : `bridgedeck${suffix}`;
    const wornFrame = `bridgeworn${suffix}`;
    const rampFrame = `bridgeramp${suffix}`;
    for (const ref of bridge.deck) {
      // Wear states: roughly a third of a timber deck's tiles carry a replaced
      // plank, a missing board with the river showing through, moss on the
      // shaded rail, and a trodden centre line. A bridge that reads as INHABITED
      // is the difference between infrastructure and a prop.
      const worn = !stone && hash2(ref.column, ref.row, 1531) > 0.66;
      const species = worn ? wornFrame : deckFrame;
      const variant = Math.floor(hash2(ref.column, ref.row, 1511) * 2) % 2;
      props.push(makeProp(
        `bridge:${bridge.id}:${ref.column},${ref.row}`,
        `s.${species}.${variant}`,
        species,
        ref.column * VALLEY_TILE_SIZE + VALLEY_TILE_SIZE / 2,
        ref.row * VALLEY_TILE_SIZE + VALLEY_TILE_SIZE - 1,
        false,
      ));
    }
    // Handrail uprights every third tile, with the post shadow falling across
    // the planks. The rails on the deck frames are flat boards; these give the
    // bridge a silhouette above its own surface.
    if (!stone) {
      bridge.deck.forEach((ref, index) => {
        if (index % 3 !== 1) return;
        const variant = Math.floor(hash2(ref.column, ref.row, 1543) * 2) % 2;
        props.push(makeProp(
          `post:${bridge.id}:${ref.column},${ref.row}`,
          `s.bridgepost${suffix}.${variant}`,
          `bridgepost${suffix}`,
          ref.column * VALLEY_TILE_SIZE + VALLEY_TILE_SIZE / 2,
          ref.row * VALLEY_TILE_SIZE + VALLEY_TILE_SIZE - 1,
          false,
        ));
      });
    }
    // The bridgehead: a ramp landing on the abutment tile, then the stone block
    // set on top of it. Before this the deck simply stopped under the block.
    for (const ref of bridge.abutments) {
      const variant = Math.floor(hash2(ref.column, ref.row, 1549) * 2) % 2;
      const species = stone ? deckFrame : rampFrame;
      props.push(makeProp(
        `bridge:${bridge.id}:${ref.column},${ref.row}`,
        `s.${species}.${variant}`,
        species,
        ref.column * VALLEY_TILE_SIZE + VALLEY_TILE_SIZE / 2,
        ref.row * VALLEY_TILE_SIZE + VALLEY_TILE_SIZE - 1,
        false,
      ));
    }
    for (const ref of bridge.abutments) {
      const variant = Math.floor(hash2(ref.column, ref.row, 1523) * 2) % 2;
      const species = stone ? "bridgearchpier" : "bridgepier";
      props.push(makeProp(
        `pier:${bridge.id}:${ref.column},${ref.row}`,
        `s.${species}.${variant}`,
        species,
        ref.column * VALLEY_TILE_SIZE + VALLEY_TILE_SIZE / 2,
        ref.row * VALLEY_TILE_SIZE + VALLEY_TILE_SIZE - 1,
        false,
      ));
    }
  }

  // A DIAGONAL plank boardwalk over the east ford.
  //
  // The pilot report named axis-aligned-only spans as the largest remaining
  // bridge gap, and a diagonal deck is the answer - but a fourth BRIDGE would
  // change the scene's crossing topology, which is proven ground. So the
  // diagonal vocabulary is placed where a real crossing already runs at an
  // angle: the east ford's shingle causeway, which is walkable gravel already.
  // The boardwalk changes no collision cell and no bridge; it is a plank surface
  // laid along a diagonal line of tiles, and it is what proves the diagonal
  // frames tile corner to corner in situ rather than only on a contact sheet.
  for (const crossing of crossings) {
    if (crossing.id !== "east-ford") continue;
    // A STRICT 45-degree chain, not the whole causeway. Diagonal deck frames
    // join corner to corner - each band is centred on the line through both tile
    // centres, so the two halves meet exactly at the shared corner - but only if
    // consecutive tiles really are diagonal neighbours. Laying them across the
    // causeway's full width instead produced crossing bands with gaps between
    // them, which is what a broken staircase looks like.
    const open = new Set(
      crossing.tiles
        .filter((tile) => tileAt(tile.column, tile.row)?.blocked === false)
        .map((tile) => `${tile.column},${tile.row}`),
    );
    let line: ValleyTileRef[] = [];
    for (const key of [...open].sort()) {
      const [column, row] = key.split(",").map(Number);
      const chain: ValleyTileRef[] = [];
      for (let step = 0; step < 12; step += 1) {
        const next = { column: column + step, row: row - step };
        if (!open.has(`${next.column},${next.row}`)) break;
        chain.push(Object.freeze(next));
      }
      if (chain.length > line.length) line = chain;
    }
    if (line.length < 3) continue;
    for (const tile of line) {
      // The ford runs up and to the right, so its planks are the rising diagonal.
      const variant = Math.floor(hash2(tile.column, tile.row, 1553) * 2) % 2;
      props.push(makeProp(
        `boardwalk:${tile.column},${tile.row}`,
        `s.bridgedeckdne.${variant}`,
        "bridgedeckdne",
        tile.column * VALLEY_TILE_SIZE + VALLEY_TILE_SIZE / 2,
        tile.row * VALLEY_TILE_SIZE + VALLEY_TILE_SIZE - 1,
        false,
      ));
    }
  }

  props.sort((left, right) => left.footY - right.footY
    || left.footX - right.footX
    || left.id.localeCompare(right.id));
  return props;
}

// ---------------------------------------------------------------------------
// assembly
// ---------------------------------------------------------------------------

/** Author the pilot valley: art field, walkability mask, props, crossings. */
export function createValleyScene(): ValleyScene {
  const channels = createChannels();
  const corners = buildCornerField(channels);
  const crossings: ValleyCrossing[] = [];

  // Authored crossings first: a stone ford onto the island's south shore and a
  // stepping-stone line over the narrow side channel.
  const fordTiles = carveCrossing(corners, { x: 15.5, y: 19.5 }, { x: 19.0, y: 15.5 }, 1.65);
  crossings.push({ id: "south-ford", kind: "ford", tiles: Object.freeze(fordTiles) });
  const stoneTiles = carveCrossing(corners, { x: 27.5, y: 12.5 }, { x: 29.5, y: 8.0 }, 1.05);
  crossings.push({ id: "north-stones", kind: "stepping-stones", tiles: Object.freeze(stoneTiles) });
  const eastTiles = carveCrossing(corners, { x: 34.0, y: 25.5 }, { x: 39.0, y: 22.0 }, 1.5);
  crossings.push({ id: "east-ford", kind: "ford", tiles: Object.freeze(eastTiles) });

  // Bridges. Resolved against the derived tiles so each span is exactly the
  // water run it crosses; the approach tracks are then carved into the corner
  // field and the spans re-resolved, because a track can shift a bank corner.
  let tiles = deriveTiles(corners);
  carveBridgeApproaches(corners, resolveBridges(tiles));
  tiles = deriveTiles(corners);
  const bridges = resolveBridges(tiles);
  for (const bridge of bridges) {
    crossings.push({ id: bridge.id, kind: "bridge", tiles: bridge.deck });
  }

  tiles = applyBridgeDecks(tiles, bridges);
  let collision = collisionFrom(tiles);

  // Repair to exactly one walkable component: bridge pockets worth reaching,
  // seal the ones that are not. A being can never be stranded or spawned into
  // a place it cannot leave.
  for (let pass = 0; pass < 24; pass += 1) {
    const components = walkableComponents(collision, VALLEY_COLUMNS, VALLEY_ROWS);
    if (components.length <= 1) break;
    const main = components[0];
    const orphan = components[1];
    if (orphan.tiles.length >= MIN_BRIDGED_POCKET_TILES) {
      const { from, to } = nearestPair(main, orphan, VALLEY_COLUMNS);
      const touched = carveCrossing(
        corners,
        { x: from.x + 0.5, y: from.y + 0.5 },
        { x: to.x + 0.5, y: to.y + 0.5 },
        1.25,
      );
      crossings.push({
        id: `repair-${pass}`,
        kind: "repair",
        tiles: Object.freeze(touched),
      });
    } else {
      sealPocket(corners, orphan, VALLEY_COLUMNS);
    }
    tiles = applyBridgeDecks(deriveTiles(corners), bridges);
    collision = collisionFrom(tiles);
  }

  const props = placeProps(tiles, channels, crossings, bridges);

  // Blocking props write into the same mask the navigator reads.
  const withProps = Uint8Array.from(collision);
  for (const prop of props) {
    if (!prop.blocks) continue;
    const index = prop.tile.row * VALLEY_COLUMNS + prop.tile.column;
    if (index >= 0 && index < withProps.length) withProps[index] = 1;
  }

  // A tree may not be the thing that strands a being: drop any blocking prop
  // that severs the walkable graph, then re-check.
  const keptProps: ValleyProp[] = [...props];
  for (let pass = 0; pass < 40; pass += 1) {
    const components = walkableComponents(withProps, VALLEY_COLUMNS, VALLEY_ROWS);
    if (components.length <= 1) break;
    const orphan = components[components.length - 1];
    const orphanTiles = new Set(orphan.tiles);
    let removedIndex = -1;
    for (let index = 0; index < keptProps.length; index += 1) {
      const prop = keptProps[index];
      if (!prop.blocks) continue;
      const propIndex = prop.tile.row * VALLEY_COLUMNS + prop.tile.column;
      const column = propIndex % VALLEY_COLUMNS;
      const row = Math.floor(propIndex / VALLEY_COLUMNS);
      const neighbours = [
        column > 0 ? propIndex - 1 : -1,
        column < VALLEY_COLUMNS - 1 ? propIndex + 1 : -1,
        row > 0 ? propIndex - VALLEY_COLUMNS : -1,
        row < VALLEY_ROWS - 1 ? propIndex + VALLEY_COLUMNS : -1,
      ];
      if (!neighbours.some((neighbour) => neighbour >= 0 && orphanTiles.has(neighbour))) continue;
      if (collision[propIndex] === 1) continue;
      removedIndex = index;
      break;
    }
    if (removedIndex < 0) {
      // Nothing to give back: the pocket is terrain-bound, so seal it.
      for (const index of orphan.tiles) withProps[index] = 1;
      continue;
    }
    const [removed] = keptProps.splice(removedIndex, 1);
    withProps[removed.tile.row * VALLEY_COLUMNS + removed.tile.column] = 0;
  }

  return Object.freeze({
    columns: VALLEY_COLUMNS,
    rows: VALLEY_ROWS,
    tileSize: VALLEY_TILE_SIZE,
    widthPixels: VALLEY_WIDTH_PX,
    heightPixels: VALLEY_HEIGHT_PX,
    tiles: Object.freeze(tiles),
    collision: withProps,
    props: Object.freeze(keptProps),
    crossings: Object.freeze(crossings),
    bridges: Object.freeze(bridges),
    cornerMaterials: Object.freeze(corners),
  });
}
