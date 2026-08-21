/**
 * Nirvana's genesis TERRAIN FIELD — the single source from which both the picture
 * and the walkability mask are derived.
 *
 * This module is the production landing of the approved river-valley design
 * (`docs/superpowers/plans/2026-07-26-nirvana-production-terrain.md` §P2/§P3),
 * routed as **Option A**: the river enters the north-east, S-curves west across
 * the northern band, then turns south down the western margin; a rock scarp frames
 * the eastern margin; the settled interior is sward. The owner approved that
 * composition after `.superpowers/sdd/nirvana-live-report.md` §3 measured that the
 * pilot's centre-of-plate route makes 100 of Nirvana's 128 shelter plots
 * unbuildable, while this route costs **zero** plots.
 *
 * Two facts come out of ONE corner-sampled material field:
 *   - the picture — a base fill plus corner-masked transition overlays and
 *     waterlines, so materials interlock instead of meeting at a tile border, and
 *   - the walkability mask — a tile is blocked when at least half its area (two of
 *     its four corners) is a blocking material.
 *
 * Because both derive from the same corners, the ground a body cannot enter is
 * exactly the ground drawn as water, reed, thicket or rock.
 *
 * ## The protection rule (why no home is ever lost)
 *
 * A corner sample that would be a blocking material is demoted whenever any of the
 * four tiles touching that corner is *protected* — a mechanics tile, a shelter
 * render footprint, a road, or a dry swale. Because a tile is only blocked at two
 * or more blocking corners, a protected tile can then never be blocked: the
 * guarantee is structural, not a post-hoc repair.
 *
 * Water demotes to **gravel** on a road (a shingle causeway, which is what a road
 * crossing a reach actually is) and to the **sward tiers** everywhere else. It
 * deliberately does not demote to `silt`: silt is a wet-bank material, and the
 * first version of this rule turned the settled interior into a mud flat.
 *
 * ## Bridges
 *
 * A bridge does not edit the corner field, so the river still flows — and is still
 * painted — underneath it. What a bridge does is carry a run of otherwise-blocked
 * water tiles; those tiles then report the kind `deck`, which is walkable. The mask
 * still says exactly what the picture says.
 *
 * Nothing here reads a recipe, a camera, or an atlas: the field is a pure function
 * of the region's mechanics geometry, so it is memoised (§`fieldCache`) and a run is
 * reproducible from that geometry alone.
 */

// ---------------------------------------------------------------------------
// material vocabulary
// ---------------------------------------------------------------------------

/**
 * Priority is the paint order: the lowest-priority material among a tile's four
 * corners fills the tile, and every higher material is laid over it as a
 * corner-masked transition frame.
 *
 * `shadegrass` / `grass` / `sungrass` are three TONAL TIERS of one sward, not three
 * species — overlapping windows onto a single tone ramp, so the meadow carries broad
 * lit and shadowed passages while remaining one continuous surface. Every tier is
 * non-blocking, so the tiers change the picture and not one bit of the mask.
 */
export const NIRVANA_TERRAIN_MATERIALS = Object.freeze([
  "deepwater",
  "water",
  "shallow",
  "gravel",
  "silt",
  "shadegrass",
  "grass",
  "sungrass",
  "meadow",
  "thicket",
  "reed",
  "rock",
] as const);

export type NirvanaTerrainMaterial = (typeof NIRVANA_TERRAIN_MATERIALS)[number];

export const NIRVANA_TERRAIN_MATERIAL_PRIORITY: Readonly<
  Record<NirvanaTerrainMaterial, number>
> = Object.freeze(
  Object.fromEntries(
    NIRVANA_TERRAIN_MATERIALS.map((material, index) => [material, index]),
  ) as Record<NirvanaTerrainMaterial, number>,
);

/** Materials a body may not stand on or route through. */
export const NIRVANA_BLOCKING_TERRAIN_MATERIALS: readonly NirvanaTerrainMaterial[] =
  Object.freeze(["deepwater", "water", "shallow", "thicket", "reed", "rock"]);

/** Water as a body: the materials a shoreline set is drawn against. */
export const NIRVANA_WATER_TERRAIN_MATERIALS: readonly NirvanaTerrainMaterial[] =
  Object.freeze(["deepwater", "water", "shallow"]);

/** Bank materials that own a shoreline / wet-line overlay set. */
export const NIRVANA_SHORE_TERRAIN_MATERIALS: readonly NirvanaTerrainMaterial[] =
  Object.freeze(["gravel", "silt", "reed"]);

/** The sward as ecology rather than as tone: a plant on one tier grows on all. */
export const NIRVANA_SWARD_TERRAIN_MATERIALS: readonly NirvanaTerrainMaterial[] =
  Object.freeze(["shadegrass", "grass", "sungrass"]);

/** Base fills authored per material in the `nirvana-v3` generation. */
export const NIRVANA_TERRAIN_BASE_VARIANTS = 8 as const;

/**
 * Shoreline variants authored per bank material.
 *
 * One, not two: the named 70-frame cut that brought the merged generation inside
 * the plan's 196,608-byte per-kit ceiling took `gravel` / `silt` / `reed`
 * shorelines from two variants to one. See `nirvana-live-report.md` §4.3.
 */
export const NIRVANA_TERRAIN_SHORE_VARIANTS = 1 as const;

/** Highest corner mask that owns a transition frame; 15 is total coverage. */
export const NIRVANA_TERRAIN_MAX_EDGE_MASK = 14 as const;

/**
 * Transition variants authored per material — MUST match the published
 * `nirvana-v3` manifest, or a tile would ask the atlas for a frame nobody drew.
 *
 * `water` / `shallow` / `gravel` / `silt` / `reed` keep two variants so a long
 * boundary never repeats one 32px wobble; `thicket` and `rock` were cut to one by
 * the same byte cut as the shorelines, and the four sward tiers were authored at one
 * from the start because a boundary between two tones of the same sward is a single
 * palette step whose shape cannot be seen at 1:1.
 *
 * `deepwater` has no transition set: it is the lowest priority material, so it is
 * always a base fill and never an overlay.
 */
export const NIRVANA_TERRAIN_EDGE_VARIANTS: Readonly<
  Record<NirvanaTerrainMaterial, number>
> = Object.freeze({
  deepwater: 0,
  water: 2,
  shallow: 2,
  gravel: 2,
  silt: 2,
  shadegrass: 1,
  grass: 1,
  sungrass: 1,
  meadow: 1,
  thicket: 1,
  reed: 2,
  rock: 1,
});

/** Atlas frame id for a full-tile fill of one material. */
export function nirvanaTerrainBaseFrameId(
  material: NirvanaTerrainMaterial,
  variant: number,
): string {
  return `t.${material}.${variant}`;
}

/** Atlas frame id for a corner-masked transition; mask 15 uses the base fill. */
export function nirvanaTerrainEdgeFrameId(
  material: NirvanaTerrainMaterial,
  mask: number,
  variant: number,
): string {
  return `e.${material}.${mask}.${variant}`;
}

/**
 * Atlas frame id for a shoreline / wet-line band.
 *
 * It shares the transition's mask deliberately: both frames were cut from one seed,
 * so the wet band follows exactly the contour of the bank edge it belongs to rather
 * than a second, similar curve.
 */
export function nirvanaTerrainShoreFrameId(
  material: NirvanaTerrainMaterial,
  mask: number,
  variant: number,
): string {
  return `w.${material}.${mask}.${variant}`;
}

/** True when a body may not stand on or route through `material`. */
export function isNirvanaBlockingTerrainMaterial(
  material: NirvanaTerrainMaterial,
): boolean {
  return NIRVANA_BLOCKING_TERRAIN_MATERIALS.includes(material);
}

/** True when `material` is one of the three water tiers. */
export function isNirvanaWaterTerrainMaterial(
  material: NirvanaTerrainMaterial,
): boolean {
  return NIRVANA_WATER_TERRAIN_MATERIALS.includes(material);
}

/** True when `material` owns a shoreline set. */
export function nirvanaTerrainHasShoreSet(
  material: NirvanaTerrainMaterial,
): boolean {
  return NIRVANA_SHORE_TERRAIN_MATERIALS.includes(material);
}

// ---------------------------------------------------------------------------
// public shapes
// ---------------------------------------------------------------------------

export interface NirvanaTerrainOverlay {
  readonly material: NirvanaTerrainMaterial;
  /** Corner mask, bit 1 = NW, 2 = NE, 4 = SE, 8 = SW. */
  readonly mask: number;
  readonly variant: number;
}

export interface NirvanaTerrainShoreline {
  readonly material: NirvanaTerrainMaterial;
  readonly mask: number;
  readonly variant: number;
}

export interface NirvanaTerrainTile {
  readonly column: number;
  readonly row: number;
  /** Material filling the whole tile before overlays. */
  readonly base: NirvanaTerrainMaterial;
  readonly baseVariant: number;
  readonly overlays: readonly NirvanaTerrainOverlay[];
  /** Waterlines, painted after every overlay. Empty away from the water. */
  readonly shorelines: readonly NirvanaTerrainShoreline[];
  /** Dominant material; always agrees with `blocked`. */
  readonly material: NirvanaTerrainMaterial;
  readonly blocked: boolean;
  /** True when a bridge deck carries this tile over otherwise blocked ground. */
  readonly bridgeDeck: boolean;
}

/** Which way a body travels over a bridge. */
export type NirvanaTerrainBridgeAxis = "east-west" | "north-south";

export interface NirvanaTerrainBridge {
  readonly id: string;
  readonly axis: NirvanaTerrainBridgeAxis;
  readonly stone: boolean;
  /** Deck tiles, in travel order. Walkable; the water beneath is not. */
  readonly deck: readonly NirvanaTerrainTileRef[];
  /** The two landward tiles the deck lands on, in the same travel order. */
  readonly abutments: readonly NirvanaTerrainTileRef[];
}

export type NirvanaTerrainTileRef = Readonly<{ column: number; row: number }>;

export interface NirvanaTerrainProp {
  readonly id: string;
  readonly species: string;
  readonly frameId: string;
  /** Top-left of the sprite in world pixels. */
  readonly x: number;
  readonly y: number;
  readonly footX: number;
  readonly footY: number;
  readonly blocks: boolean;
  readonly tile: NirvanaTerrainTileRef;
}

/** One position a landmark could stand in: what it blocks and where its feet land. */
export interface NirvanaTerrainLandmarkStance {
  /** World tiles the landmark blocks. */
  readonly collisionTiles: readonly NirvanaTerrainTileRef[];
  /** World tiles under each of the landmark's sprite feet. */
  readonly footTiles: readonly NirvanaTerrainTileRef[];
}

/**
 * One authored macro landmark offered to the field for a terrain verdict.
 *
 * A wood or a walled garden cannot stand in a river, so the field rejects any stance
 * whose collision footprint or whose sprite feet land in water. A candidate may offer a
 * second, authored stance — its relocation — which the field falls back to when the
 * authored one is drowned; **relocate rather than retire** is the owner's rule, so a
 * landmark is only retired once BOTH its stances are under water. The chosen stance is
 * what the field then routes around and proves connectivity against, so a relocated
 * landmark is as load-bearing as an authored one.
 */
export interface NirvanaTerrainLandmarkCandidate extends NirvanaTerrainLandmarkStance {
  readonly id: string;
  /** The authored alternative home, or `undefined` when the landmark has none. */
  readonly relocation?: NirvanaTerrainLandmarkStance;
}

export interface NirvanaTerrainFieldInput {
  readonly columns: number;
  readonly rows: number;
  /** 1 where terrain may never block: mechanics, shelter footprints, swales. */
  readonly protectedTiles: Uint8Array;
  /** 1 on a road tile. Roads are protected AND demote water to a causeway. */
  readonly roadTiles: Uint8Array;
  readonly landmarkCandidates: readonly NirvanaTerrainLandmarkCandidate[];
}

export interface NirvanaTerrainField {
  readonly columns: number;
  readonly rows: number;
  /** Corner material field, `(columns + 1) * (rows + 1)`, row-major. */
  readonly corners: readonly NirvanaTerrainMaterial[];
  /** Row-major, length `columns * rows`. */
  readonly tiles: readonly NirvanaTerrainTile[];
  /** Row-major; 1 where the terrain alone blocks (bridge decks excluded). */
  readonly blocked: Uint8Array;
  /**
   * Row-major; terrain, retained landmarks and blocking props together, as a CHUNK
   * mask — the region's outer rim is NOT closed here.
   *
   * `NirvanaRegionMapRecipe` already calls `closeBoundedOuterEdge` on the composed
   * region grid, and `createNirvanaChunk` rejects a chunk whose connector tile is
   * closed — the root chunk's west connector at (0,14) is exactly such a tile. So the
   * rim closure belongs to the recipe, and the chunk mask must leave it open.
   * Connectivity is nevertheless *analysed* against the rim-closed mask (`reachable`),
   * because that is the grid every consumer will actually navigate.
   */
  readonly collision: Uint8Array;
  /** The mask connectivity was proved on: `collision` with the region rim closed. */
  readonly reachable: Uint8Array;
  readonly props: readonly NirvanaTerrainProp[];
  readonly bridges: readonly NirvanaTerrainBridge[];
  readonly retainedLandmarkIds: ReadonlySet<string>;
  /**
   * Candidates the water verdict RETIRED — the authoritative set.
   *
   * Retirement is stated positively on purpose: a landmark the field was never offered is
   * unjudged, not condemned, so "absent from `retainedLandmarkIds`" must never be read as
   * "remove it". That reading would let a landmark vanish silently the moment a caller
   * forgot to include it.
   */
  readonly retiredLandmarkIds: ReadonlySet<string>;
  /**
   * Candidates whose authored ground drowned but whose authored ALTERNATIVE is dry.
   *
   * These are neither retained-in-place nor retired: the chunk that owns them must publish
   * them at their relocation. Disjoint from `retiredLandmarkIds` by construction, and a
   * member of `retainedLandmarkIds` — the field routed around the relocated footprint, so
   * the chunk MUST use it or the proved walkability and the published art disagree.
   */
  readonly relocatedLandmarkIds: ReadonlySet<string>;
  /** `"column,row"` road tiles the river reaches; a timber walkway carries them. */
  readonly roadCausewayTiles: ReadonlySet<string>;
  cornerAt(column: number, row: number): NirvanaTerrainMaterial;
  tileAt(column: number, row: number): NirvanaTerrainTile;
}

/** Raised when the authored terrain cannot be built as specified. */
export class NirvanaTerrainFieldError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NirvanaTerrainFieldError";
  }
}

// ---------------------------------------------------------------------------
// deterministic noise — identical to the approved pilot instrument
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
// Option A river geometry — the composition the owner approved
// ---------------------------------------------------------------------------

interface Point {
  readonly x: number;
  readonly y: number;
}

/** Catmull-Rom through the control points; the river is a curve, never a staircase. */
function sampleSpline(points: readonly Point[], samplesPerSegment: number): Point[] {
  const result: Point[] = [];
  for (let index = 0; index < points.length - 3; index += 1) {
    const p0 = points[index]!;
    const p1 = points[index + 1]!;
    const p2 = points[index + 2]!;
    const p3 = points[index + 3]!;
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

/**
 * The main channel: in through the north-east, S-curving west across the northern
 * band, then south down the western margin and out through the south-west.
 *
 * These control points ARE the approved composition (panel 3 of
 * `scratchpad/being-sprite-evidence/nirvana-live/legal-route-proposal-captioned.png`).
 * Moving one moves the river, which is the owner's call, not the builder's.
 */
const MAIN_CONTROL: readonly Point[] = Object.freeze([
  { x: 78, y: -12 }, { x: 71, y: -5 }, { x: 64, y: 2 }, { x: 52, y: 6 },
  { x: 40, y: 4 }, { x: 30, y: 8 }, { x: 22, y: 13 }, { x: 13, y: 15 },
  { x: 7, y: 22 }, { x: 4, y: 31 }, { x: 5, y: 42 }, { x: 8, y: 54 },
  { x: 6, y: 66 }, { x: 3, y: 78 }, { x: 6, y: 88 }, { x: 10, y: 99 },
]);

/** The side channel that forms an island in the northern band. */
const SIDE_CONTROL: readonly Point[] = Object.freeze([
  { x: 56, y: 4 }, { x: 50, y: 9 }, { x: 43, y: 11 }, { x: 35, y: 11 },
  { x: 28, y: 13.5 }, { x: 21, y: 15.5 }, { x: 15, y: 17.5 }, { x: 9, y: 21 },
  { x: 6, y: 26 },
]);

interface Channel {
  readonly samples: readonly Point[];
  readonly halfWidth: (u: number) => number;
}

const CHANNEL_CUTOFF_SQUARED = 400;
const CHANNEL_BUCKET_SIZE = 20;

interface ChannelIndex {
  readonly channels: readonly Channel[];
  readonly buckets: ReadonlyMap<string, readonly Readonly<{ point: Point; u: number; channel: number }>[]>;
}

function createChannelIndex(): ChannelIndex {
  const channels: readonly Channel[] = Object.freeze([
    Object.freeze({
      samples: Object.freeze(sampleSpline(MAIN_CONTROL, 26)),
      halfWidth: (u: number): number => 2.30 + Math.sin(u * 7.1 + 0.4) * 0.5 + u * 0.35,
    }),
    Object.freeze({
      samples: Object.freeze(sampleSpline(SIDE_CONTROL, 26)),
      halfWidth: (u: number): number => 1.35 + Math.sin(u * 5.3 + 1.9) * 0.38,
    }),
  ]);
  // A uniform bucket grid over the sample set: the distance query only ever looks
  // 20 tiles out, so one bucket ring is exact and the field builds in a fraction
  // of the time a full sweep over ~500 samples per corner would take.
  const buckets = new Map<string, Array<Readonly<{ point: Point; u: number; channel: number }>>>();
  channels.forEach((channel, channelIndex) => {
    const last = Math.max(1, channel.samples.length - 1);
    channel.samples.forEach((point, index) => {
      const key = bucketKey(point.x, point.y);
      const entry = { point, u: index / last, channel: channelIndex };
      const existing = buckets.get(key);
      if (existing === undefined) buckets.set(key, [entry]);
      else existing.push(entry);
    });
  });
  return { channels, buckets };
}

function bucketKey(x: number, y: number): string {
  return `${Math.floor(x / CHANNEL_BUCKET_SIZE)},${Math.floor(y / CHANNEL_BUCKET_SIZE)}`;
}

/**
 * Distance to the nearest channel centreline, in tiles, normalised by that
 * channel's local half-width. Below 1.0 is inside the wetted channel.
 */
function channelField(index: ChannelIndex, x: number, y: number): number {
  let best = Number.POSITIVE_INFINITY;
  const bucketColumn = Math.floor(x / CHANNEL_BUCKET_SIZE);
  const bucketRow = Math.floor(y / CHANNEL_BUCKET_SIZE);
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      const entries = index.buckets.get(`${bucketColumn + dc},${bucketRow + dr}`);
      if (entries === undefined) continue;
      for (const entry of entries) {
        const dx = x - entry.point.x;
        const dy = y - entry.point.y;
        const distanceSquared = dx * dx + dy * dy;
        if (distanceSquared > CHANNEL_CUTOFF_SQUARED) continue;
        const normalised = Math.sqrt(distanceSquared)
          / index.channels[entry.channel]!.halfWidth(entry.u);
        if (normalised < best) best = normalised;
      }
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// corner material field
// ---------------------------------------------------------------------------

const CORNER_SEED = 0x5f37;

/**
 * The rock scarp framing the EASTERN margin.
 *
 * A grassy upland whose EDGES are rock, not a rock field: a band along the contour
 * gives the region a legible framing barrier and grass where grass belongs. Flat
 * sim — the scarp is decorative relief, never elevation semantics.
 *
 * Its centreline WANDERS, its width BREATHES between roughly one and six tiles, and
 * a low-frequency presence mask opens gaps in it. A constant-width band down a fixed
 * column read as a great wall at 1:1 — the same failure the pilot's first two cliff
 * passes made — and the gaps double as passes, so the ground east of the scarp is
 * reachable without carving anything.
 */
function scarpBand(x: number, y: number): Readonly<{ depth: number; width: number }> {
  const centre = 86
    + Math.sin(y * 0.09) * 1.4
    + Math.sin(y * 0.031 + 1.7) * 3.2
    + (fbm(y * 0.05, 17.5, CORNER_SEED + 401, 3) - 0.5) * 5.5;
  const width = 1.15 + (fbm(11.5, y * 0.043, CORNER_SEED + 402, 3) - 0.5) * 2.4;
  const depth = (x - centre) * 0.34
    + (fbm(x * 0.17, y * 0.17, CORNER_SEED + 400, 4) - 0.5) * 1.1;
  return { depth, width };
}

function isScarp(x: number, y: number): boolean {
  const { depth, width } = scarpBand(x, y);
  if (depth <= 0 || depth >= width) return false;
  return fbm(x * 0.055, y * 0.055, CORNER_SEED + 403, 3) > 0.405;
}

function rawCornerMaterial(
  index: ChannelIndex,
  x: number,
  y: number,
): NirvanaTerrainMaterial {
  // Perturb the channel distance so the banks meander instead of offsetting.
  const wobble = (fbm(x * 0.19, y * 0.19, CORNER_SEED, 4) - 0.5) * 0.46
    + (fbm(x * 0.55, y * 0.55, CORNER_SEED + 90, 3) - 0.5) * 0.17;
  const distance = channelField(index, x, y) + wobble;

  // Inside the wetted channel the river is ONE body of water: depth is a mottled
  // core, not a concentric ribbon, because concentric bands read as a contour map.
  if (distance < 0.97) {
    const core = fbm(x * 0.23, y * 0.23, CORNER_SEED + 610, 4);
    if (distance < 0.74 && core > 0.455) return "deepwater";
    if (distance > 0.78 && fbm(x * 0.34, y * 0.34, CORNER_SEED + 640, 3) > 0.545) {
      return "shallow";
    }
    return "water";
  }
  // Gravel bars are places, not an outline: a low-frequency mask decides where
  // shingle has actually built up, so most of the bank never sees any.
  if (distance < 1.32 && fbm(x * 0.098, y * 0.098, CORNER_SEED + 210, 3) > 0.700) {
    return "gravel";
  }
  // Reed beds crowd the slack water on the inside of bends.
  if (distance < 1.40 && fbm(x * 0.135, y * 0.135, CORNER_SEED + 700, 4) > 0.560) {
    return "reed";
  }
  // A wet silt lip whose width breathes, so the bank is never a drawn outline
  // offset from the water at a constant distance.
  const siltReach = 1.06 + (fbm(x * 0.16, y * 0.16, CORNER_SEED + 830, 3) - 0.5) * 0.42;
  if (distance < siltReach) return "silt";

  if (isScarp(x, y)) return "rock";

  // Dense scrub thickets: the dark tone the meadow needs, and ground a body
  // genuinely cannot push through.
  const scrub = fbm(x * 0.105, y * 0.105, CORNER_SEED + 520, 4);
  if (scrub > 0.632 && distance > 1.45) return "thicket";
  // Sunlit flower drifts in broad, soft-edged sweeps rather than confetti.
  if (fbm(x * 0.082, y * 0.082, CORNER_SEED + 310, 4) > 0.575) return "meadow";
  // Tonal modelling of the sward: the same scrub field that decides where thickets
  // grow also decides where the sward is shaded, just below the thicket threshold,
  // and a separate lower-frequency light field lifts the open swells into the warm
  // tier. Both are non-blocking, so this changes the picture and not the mask.
  if (scrub > 0.565) return "shadegrass";
  const light = fbm(x * 0.074, y * 0.074, CORNER_SEED + 880, 3);
  if (light > 0.552) return "sungrass";
  if (light < 0.448) return "shadegrass";
  return "grass";
}

/**
 * The corner material for GROWN ground, in world coordinates.
 *
 * Grown chunks paint the full `nirvana-v3` vocabulary — the tonal sward tiers, the meadow
 * drifts, dry shingle and silt beds, every corner-masked transition — from the SAME
 * world-coordinate noise fields as the genesis field, so a tonal passage runs straight
 * across a growth seam instead of stopping at it.
 *
 * What grown ground deliberately does NOT carry is blocking terrain. The river is an
 * authored genesis feature whose connectivity was proved once, region-wide, with authored
 * crossings; a procedurally-grown water or thicket mass has no such proof, and a mass that
 * spans a chunk can sever the walkable set — which in a world that must run forever is a
 * stranding bug waiting for a seed. So every blocking outcome is mapped onto its dry
 * counterpart: a channel reads as a shingle bed, a reed bed as silt, scrub as shaded
 * sward, a scarp as shingle. Grown `grid.collision` therefore stays exactly what it is
 * today — landmarks only — and growth cannot disconnect anything, structurally.
 */
export function nirvanaGrownCornerMaterial(x: number, y: number): NirvanaTerrainMaterial {
  const scrub = fbm(x * 0.105, y * 0.105, CORNER_SEED + 520, 4);
  if (scrub > 0.632) return "silt";
  if (fbm(x * 0.098, y * 0.098, CORNER_SEED + 210, 3) > 0.700) return "gravel";
  if (fbm(x * 0.082, y * 0.082, CORNER_SEED + 310, 4) > 0.575) return "meadow";
  if (scrub > 0.565) return "shadegrass";
  return swardTierAt(x, y);
}

/** Every material grown ground may use; all of them are walkable, by construction. */
export const NIRVANA_GROWN_TERRAIN_MATERIALS: readonly NirvanaTerrainMaterial[] =
  Object.freeze(["gravel", "silt", "meadow", "shadegrass", "grass", "sungrass"]);

function swardTierAt(x: number, y: number): NirvanaTerrainMaterial {
  const light = fbm(x * 0.074, y * 0.074, CORNER_SEED + 880, 3);
  if (light > 0.552) return "sungrass";
  if (light < 0.448) return "shadegrass";
  return "grass";
}

// ---------------------------------------------------------------------------
// tile derivation
// ---------------------------------------------------------------------------

function tileVariant(column: number, row: number, salt: number, count: number): number {
  if (count <= 0) return 0;
  return Math.floor(hash2(column, row, 0x1234 + salt) * count) % count;
}

interface CornerGrid {
  readonly columns: number;
  readonly rows: number;
  readonly values: NirvanaTerrainMaterial[];
}

function cornerIndex(grid: CornerGrid, column: number, row: number): number {
  return row * (grid.columns + 1) + column;
}

function deriveTile(
  grid: CornerGrid,
  column: number,
  row: number,
): NirvanaTerrainTile {
  return deriveTileFromCorners(column, row, [
    grid.values[cornerIndex(grid, column, row)]!,
    grid.values[cornerIndex(grid, column + 1, row)]!,
    grid.values[cornerIndex(grid, column + 1, row + 1)]!,
    grid.values[cornerIndex(grid, column, row + 1)]!,
  ]);
}

function deriveTileFromCorners(
  column: number,
  row: number,
  cornerMaterials: readonly NirvanaTerrainMaterial[],
): NirvanaTerrainTile {
  const priorities = cornerMaterials.map(
    (material) => NIRVANA_TERRAIN_MATERIAL_PRIORITY[material],
  );
  const basePriority = Math.min(...priorities);
  const base = cornerMaterials[priorities.indexOf(basePriority)]!;

  const present = [...new Set(cornerMaterials)]
    .filter((material) => NIRVANA_TERRAIN_MATERIAL_PRIORITY[material] > basePriority)
    .sort((left, right) => NIRVANA_TERRAIN_MATERIAL_PRIORITY[left]
      - NIRVANA_TERRAIN_MATERIAL_PRIORITY[right]);

  const overlays: NirvanaTerrainOverlay[] = [];
  const shorelines: NirvanaTerrainShoreline[] = [];
  const baseIsWater = isNirvanaWaterTerrainMaterial(base);
  for (const material of present) {
    const threshold = NIRVANA_TERRAIN_MATERIAL_PRIORITY[material];
    let mask = 0;
    for (let corner = 0; corner < 4; corner += 1) {
      if (priorities[corner]! >= threshold) mask |= 1 << corner;
    }
    if (mask === 0) continue;
    // Total coverage is the material's own fill, so it draws from the 8 base
    // variants; a partial mask draws from that material's transition variants.
    const salt = threshold * 31 + mask;
    const variant = mask === 15
      ? tileVariant(column, row, salt, NIRVANA_TERRAIN_BASE_VARIANTS)
      : tileVariant(column, row, salt, NIRVANA_TERRAIN_EDGE_VARIANTS[material]);
    overlays.push({ material, mask, variant });
    // A waterline belongs wherever a bank material meets the river ON this tile:
    // water always has the lower priority, so it is always the base.
    if (baseIsWater && mask !== 15 && nirvanaTerrainHasShoreSet(material)) {
      shorelines.push({
        material,
        mask,
        variant: tileVariant(column, row, salt, NIRVANA_TERRAIN_SHORE_VARIANTS),
      });
    }
  }

  const blockingCorners = cornerMaterials.filter(isNirvanaBlockingTerrainMaterial).length;
  const blocked = blockingCorners >= 2;

  // The tile's reported material must EXPLAIN its walkability, so it is chosen only
  // from corners that agree with `blocked`: a tile the navigator refuses always
  // names a blocking material, and an open tile never does.
  const agreeing = cornerMaterials.filter(
    (candidate) => isNirvanaBlockingTerrainMaterial(candidate) === blocked,
  );
  const tally = new Map<NirvanaTerrainMaterial, number>();
  for (const candidate of agreeing) {
    tally.set(candidate, (tally.get(candidate) ?? 0) + 1);
  }
  let material = agreeing[0]!;
  let bestCount = -1;
  for (const [candidate, count] of tally) {
    const better = count > bestCount
      || (count === bestCount
        && NIRVANA_TERRAIN_MATERIAL_PRIORITY[candidate]
          < NIRVANA_TERRAIN_MATERIAL_PRIORITY[material]);
    if (better) {
      material = candidate;
      bestCount = count;
    }
  }

  return Object.freeze({
    column,
    row,
    base,
    baseVariant: tileVariant(
      column,
      row,
      NIRVANA_TERRAIN_MATERIAL_PRIORITY[base],
      NIRVANA_TERRAIN_BASE_VARIANTS,
    ),
    overlays: Object.freeze(overlays),
    shorelines: Object.freeze(shorelines),
    material,
    blocked,
    bridgeDeck: false,
  });
}

/**
 * Derive one tile from four corner materials.
 *
 * Exported so the grown-chunk generator paints the same vocabulary from its own
 * corner field without duplicating the derivation rules.
 */
export function deriveNirvanaTerrainTileFromCorners(
  column: number,
  row: number,
  corners: readonly [
    NirvanaTerrainMaterial,
    NirvanaTerrainMaterial,
    NirvanaTerrainMaterial,
    NirvanaTerrainMaterial,
  ],
): NirvanaTerrainTile {
  return deriveTileFromCorners(column, row, corners);
}

// ---------------------------------------------------------------------------
// crossings, bridges, connectivity
// ---------------------------------------------------------------------------

/** A walkable pocket smaller than this is sealed rather than opened. */
const MIN_OPENED_POCKET_TILES = 18;

/** No authored bridge may span more water than this; a longer run is a bug. */
const MAX_BRIDGE_DECK_TILES = 14;

interface BridgePlan {
  readonly id: string;
  readonly axis: NirvanaTerrainBridgeAxis;
  readonly stone: boolean;
  /** Row for an east-west span, column for a north-south span. */
  readonly line: number;
  /** A position along the span axis that is inside the water to be crossed. */
  readonly midstream: number;
}

/**
 * The authored crossings.
 *
 * `north-channel-bridge` sits on the tile the standalone stage's camera opens on
 * (`NIRVANA_ROOT_CAMERA_START` is tile 28,8), so the first thing anyone sees of
 * production Nirvana is a bridge over the river. `island-channel-bridge` crosses
 * the side channel that forms the northern island. `west-arm-stone-bridge` is the
 * stone causeway over the western margin, and it is load-bearing: without it the
 * ground west of the western arm is a separate walkable component.
 */
const BRIDGE_PLANS: readonly BridgePlan[] = Object.freeze([
  { id: "north-channel-bridge", axis: "north-south", stone: false, line: 30, midstream: 8 },
  { id: "island-channel-bridge", axis: "north-south", stone: false, line: 22, midstream: 15 },
  { id: "west-arm-stone-bridge", axis: "east-west", stone: true, line: 50, midstream: 6 },
]);

function tileRefAlong(plan: BridgePlan, position: number): NirvanaTerrainTileRef {
  return plan.axis === "east-west"
    ? Object.freeze({ column: position, row: plan.line })
    : Object.freeze({ column: plan.line, row: position });
}

/**
 * Resolve one bridge plan against the derived tiles.
 *
 * The span is not a hard-coded tile list: the builder walks outward from a point
 * known to be in the water and takes the whole contiguous blocked run as the deck,
 * so a bridge always lands on the banks the river actually has and can never be
 * drawn hanging over dry ground because the field moved.
 *
 * @throws NirvanaTerrainFieldError when the midstream point is not blocked, when the
 *   run is longer than a plausible span, or when either end fails to reach walkable
 *   ground — all authoring errors, and all better loud.
 */
function resolveBridge(
  tiles: readonly NirvanaTerrainTile[],
  columns: number,
  rows: number,
  plan: BridgePlan,
): NirvanaTerrainBridge {
  const limit = plan.axis === "east-west" ? columns : rows;
  const blockedAt = (position: number): boolean => {
    if (position < 0 || position >= limit) return true;
    const ref = tileRefAlong(plan, position);
    return tiles[ref.row * columns + ref.column]!.blocked;
  };
  if (!blockedAt(plan.midstream)) {
    throw new NirvanaTerrainFieldError(
      `Nirvana bridge ${plan.id}: midstream ${plan.midstream} is not over blocked water.`,
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
    throw new NirvanaTerrainFieldError(
      `Nirvana bridge ${plan.id}: the blocked run from ${first} to ${last} does not reach `
      + `walkable ground at both ends within ${MAX_BRIDGE_DECK_TILES} tiles.`,
    );
  }
  const deck: NirvanaTerrainTileRef[] = [];
  for (let position = first; position <= last; position += 1) {
    deck.push(tileRefAlong(plan, position));
  }
  return Object.freeze({
    id: plan.id,
    axis: plan.axis,
    stone: plan.stone,
    deck: Object.freeze(deck),
    abutments: Object.freeze([
      tileRefAlong(plan, first - 1),
      tileRefAlong(plan, last + 1),
    ]),
  });
}

/** Paint a walkable shingle causeway into the corner field. */
function carveCrossing(
  grid: CornerGrid,
  from: Point,
  to: Point,
  halfWidth: number,
  material: NirvanaTerrainMaterial = "gravel",
): void {
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
        if (column < 0 || row < 0 || column > grid.columns || row > grid.rows) continue;
        const jitter = (fbm(column * 0.7, row * 0.7, CORNER_SEED + 950, 2) - 0.5) * 0.55;
        if (Math.hypot(column - cx, row - cy) > halfWidth + jitter) continue;
        grid.values[cornerIndex(grid, column, row)] = material;
      }
    }
  }
}

interface Component {
  readonly tiles: readonly number[];
}

/** Four-connected walkable components over a row-major collision mask. */
export function nirvanaWalkableComponents(
  collision: Uint8Array,
  columns: number,
  rows: number,
): Component[] {
  const seen = new Uint8Array(collision.length);
  const components: Component[] = [];
  for (let start = 0; start < collision.length; start += 1) {
    if (collision[start] === 1 || seen[start] === 1) continue;
    const tiles: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length > 0) {
      const index = stack.pop()!;
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

function centroidOf(component: Component, columns: number): Point {
  let sumX = 0;
  let sumY = 0;
  for (const index of component.tiles) {
    sumX += index % columns;
    sumY += Math.floor(index / columns);
  }
  return { x: sumX / component.tiles.length, y: sumY / component.tiles.length };
}

function nearestPair(
  left: Component,
  right: Component,
  columns: number,
): Readonly<{ from: Point; to: Point }> {
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

/**
 * Seal a pocket too small to deserve a crossing, so nothing can be stranded.
 *
 * Sealing writes blocking corners AFTER the protection rule has run, so it is the one
 * place that could close protected ground behind the guarantee's back. It therefore
 * refuses to touch a corner adjacent to a protected tile — a pocket containing
 * protected ground is a bridge case, never a seal case.
 */
function sealPocket(
  grid: CornerGrid,
  component: Component,
  columns: number,
  rows: number,
  protectedTiles: Uint8Array,
): void {
  const cornerIsFree = (column: number, row: number): boolean => {
    for (const [dc, dr] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
      const tc = column + dc;
      const tr = row + dr;
      if (tc < 0 || tr < 0 || tc >= columns || tr >= rows) continue;
      if (protectedTiles[tr * columns + tc] === 1) return false;
    }
    return true;
  };
  for (const index of component.tiles) {
    const column = index % columns;
    const row = Math.floor(index / columns);
    if (protectedTiles[index] === 1) continue;
    for (const [dc, dr] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
      if (!cornerIsFree(column + dc, row + dr)) continue;
      grid.values[cornerIndex(grid, column + dc, row + dr)] = "reed";
    }
  }
}

// ---------------------------------------------------------------------------
// scenery
// ---------------------------------------------------------------------------

interface SpeciesRule {
  readonly id: string;
  readonly variants: number;
  readonly on: readonly NirvanaTerrainMaterial[];
  /** Normalised channel distance window, or null for anywhere. */
  readonly wetness: readonly [number, number] | null;
  readonly blocks: boolean;
  readonly clusters: number;
  readonly spread: number;
  readonly perCluster: number;
  readonly scatter: number;
  readonly seed: number;
}

const ON_SWARD: readonly NirvanaTerrainMaterial[] = NIRVANA_SWARD_TERRAIN_MATERIALS;
const ON_SWARD_AND_MEADOW: readonly NirvanaTerrainMaterial[] = Object.freeze([
  ...NIRVANA_SWARD_TERRAIN_MATERIALS,
  "meadow",
]);

/**
 * The scenery vocabulary, at production density.
 *
 * Cluster and scatter counts are roughly four times the 48x32 pilot's over six
 * times its area, which is a deliberately lower density: the pilot is a showpiece
 * plate, production Nirvana has a settlement in the middle of it, and every record
 * here is a chunk landmark inside the content hash.
 */
const SPECIES: readonly SpeciesRule[] = Object.freeze([
  {
    // Willows are the signature of the reference plate and they lean over the
    // WATER, so they take the widest near-channel window and the most clusters.
    id: "willow", variants: 6, on: ["silt", ...ON_SWARD, "gravel"], wetness: [1.0, 2.8],
    blocks: true, clusters: 54, spread: 2.6, perCluster: 5, scatter: 0, seed: 101,
  },
  {
    id: "birch", variants: 6, on: ON_SWARD_AND_MEADOW, wetness: [2.0, 9], blocks: true,
    clusters: 30, spread: 3.0, perCluster: 6, scatter: 0, seed: 211,
  },
  {
    id: "broadleaf", variants: 8, on: ON_SWARD_AND_MEADOW, wetness: [1.7, 9], blocks: true,
    clusters: 48, spread: 3.2, perCluster: 5, scatter: 48, seed: 307,
  },
  {
    id: "conifer", variants: 5, on: ON_SWARD, wetness: [2.4, 9], blocks: true,
    clusters: 22, spread: 2.4, perCluster: 4, scatter: 28, seed: 401,
  },
  {
    id: "shrub", variants: 6, on: [...ON_SWARD_AND_MEADOW, "silt", "thicket"], wetness: null,
    blocks: false, clusters: 72, spread: 3.4, perCluster: 7, scatter: 380, seed: 503,
  },
  {
    id: "reedclump", variants: 6, on: ["reed"], wetness: null, blocks: false,
    clusters: 0, spread: 0, perCluster: 0, scatter: 1800, seed: 601,
  },
  {
    id: "boulder", variants: 5, on: [...ON_SWARD, "gravel", "silt", "meadow"], wetness: null,
    blocks: true, clusters: 38, spread: 2.2, perCluster: 3, scatter: 70, seed: 701,
  },
  {
    // Outcrops littering the rock scarp. That ground is already blocked as rock, so
    // these are decoration and are marked as such.
    id: "outcrop", variants: 4, on: ["rock"], wetness: null, blocks: false,
    clusters: 0, spread: 0, perCluster: 0, scatter: 640, seed: 743,
  },
  {
    id: "cobble", variants: 4, on: ["gravel", "silt"], wetness: null, blocks: false,
    clusters: 0, spread: 0, perCluster: 0, scatter: 860, seed: 809,
  },
  {
    // Drifts, not confetti: each sprite is a 56x40 mass of petals, concentrated in
    // the meadow and the sunlit tier because that is where the reference puts them.
    id: "flowerdrift", variants: 6, on: ["meadow", "sungrass", "grass"], wetness: null,
    blocks: false, clusters: 64, spread: 2.6, perCluster: 6, scatter: 170, seed: 907,
  },
  {
    id: "tuft", variants: 4, on: [...ON_SWARD_AND_MEADOW, "silt", "gravel"], wetness: null,
    blocks: false, clusters: 0, spread: 0, perCluster: 0, scatter: 1800, seed: 1009,
  },
  {
    id: "driftwood", variants: 2, on: ["gravel", "silt"], wetness: null, blocks: false,
    clusters: 0, spread: 0, perCluster: 0, scatter: 80, seed: 1103,
  },
]);

/** Sprite feet offsets; kept in step with the published `nirvana-v3` pivots. */
const PROP_PIVOTS: Readonly<Record<string, readonly [number, number]>> = Object.freeze({
  willow: [56, 110],
  birch: [36, 100],
  broadleaf: [44, 88],
  conifer: [30, 92],
  shrub: [24, 45],
  reedclump: [22, 80],
  reedwater: [22, 80],
  boulder: [22, 33],
  outcrop: [20, 27],
  cobble: [10, 12],
  flowerdrift: [28, 37],
  tuft: [12, 16],
  driftwood: [24, 17],
  scarpface: [44, 48],
  scarpcornerout: [24, 41],
  scarpcornerin: [24, 41],
  bridgedeckh: [16, 31],
  bridgedeckv: [16, 31],
  bridgewornh: [16, 31],
  bridgewornv: [16, 31],
  bridgeramph: [16, 31],
  bridgerampv: [16, 31],
  bridgeposth: [16, 31],
  bridgepostv: [16, 31],
  bridgearchh: [16, 31],
  bridgearchv: [16, 31],
  bridgepier: [16, 31],
  bridgearchpier: [16, 31],
});

const TILE_PIXELS = 32;

function makeProp(
  id: string,
  species: string,
  variant: number,
  footX: number,
  footY: number,
  blocks: boolean,
): NirvanaTerrainProp {
  const pivot = PROP_PIVOTS[species];
  if (pivot === undefined) {
    throw new NirvanaTerrainFieldError(`Nirvana scenery species ${species} has no pivot.`);
  }
  return Object.freeze({
    id,
    species,
    frameId: `s.${species}.${variant}`,
    x: Math.round(footX - pivot[0]),
    y: Math.round(footY - pivot[1]),
    footX: Math.round(footX),
    footY: Math.round(footY),
    blocks,
    tile: Object.freeze({
      column: Math.floor(footX / TILE_PIXELS),
      row: Math.floor(footY / TILE_PIXELS),
    }),
  });
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
  index: ChannelIndex,
  columns: number,
  rows: number,
): PropCandidate[] {
  const out: PropCandidate[] = [];
  const push = (x: number, y: number, salt: number): void => {
    const column = Math.floor(x);
    const row = Math.floor(y);
    if (column < 1 || row < 1 || column >= columns - 1 || row >= rows - 1) return;
    if (species.wetness !== null) {
      const distance = channelField(index, x, y);
      if (distance < species.wetness[0] || distance > species.wetness[1]) return;
    }
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
    const cx = hash2(cluster, species.seed, 17) * columns;
    const cy = hash2(cluster, species.seed, 29) * rows;
    for (let member = 0; member < species.perCluster; member += 1) {
      const angle = hash2(cluster, member, species.seed + 41) * Math.PI * 2;
      const radius = Math.sqrt(hash2(cluster, member, species.seed + 53)) * species.spread;
      push(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, member * 3 + cluster);
    }
  }
  for (let scatter = 0; scatter < species.scatter; scatter += 1) {
    push(
      hash2(scatter, species.seed, 61) * columns,
      hash2(scatter, species.seed, 71) * rows,
      scatter + 500,
    );
  }
  return out;
}

// ---------------------------------------------------------------------------
// assembly
// ---------------------------------------------------------------------------

interface FieldContext {
  readonly columns: number;
  readonly rows: number;
  readonly protectedTiles: Uint8Array;
  /** Protected, dilated by one tile behind a noise gate: a RAGGED clearance edge. */
  readonly clearedTiles: Uint8Array;
  readonly roadTiles: Uint8Array;
  readonly index: ChannelIndex;
}

/**
 * Grow a one-tile clearance ring around protected ground, with a ragged edge.
 *
 * Demoting only the corners that touch a protected tile is enough for the legality
 * guarantee, but it cuts thicket and rock masses off along the district lattice, and
 * at 1:1 those straight edges read as an authoring bug rather than as scrub. A
 * one-tile ring gated by a per-tile noise sample gives the same guarantee with an
 * organic boundary: the scrub retreats from the settlement instead of being sliced.
 */
function createClearedTiles(
  protectedTiles: Uint8Array,
  columns: number,
  rows: number,
): Uint8Array {
  const cleared = Uint8Array.from(protectedTiles);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      if (protectedTiles[index] === 1) continue;
      let adjacent = false;
      for (let dr = -1; dr <= 1 && !adjacent; dr += 1) {
        for (let dc = -1; dc <= 1; dc += 1) {
          const tc = column + dc;
          const tr = row + dr;
          if (tc < 0 || tr < 0 || tc >= columns || tr >= rows) continue;
          if (protectedTiles[tr * columns + tc] === 1) {
            adjacent = true;
            break;
          }
        }
      }
      if (!adjacent) continue;
      if (hash2(column, row, 0x2f19) > 0.34) cleared[index] = 1;
    }
  }
  return cleared;
}

function buildCornerGrid(context: FieldContext): CornerGrid {
  const { columns, rows, clearedTiles, roadTiles, index } = context;
  const grid: CornerGrid = { columns, rows, values: new Array((columns + 1) * (rows + 1)) };
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      let material = rawCornerMaterial(index, column, row);
      if (isNirvanaBlockingTerrainMaterial(material)) {
        let touchesCleared = false;
        let touchesRoad = false;
        for (const [dc, dr] of [[-1, -1], [0, -1], [-1, 0], [0, 0]] as const) {
          const tc = column + dc;
          const tr = row + dr;
          if (tc < 0 || tr < 0 || tc >= columns || tr >= rows) continue;
          const tileIndex = tr * columns + tc;
          if (clearedTiles[tileIndex] === 1) touchesCleared = true;
          if (roadTiles[tileIndex] === 1) touchesRoad = true;
        }
        if (touchesCleared || touchesRoad) {
          // A road that meets the river becomes a shingle causeway; anywhere else a
          // cleared corner falls back to the sward tiers, never to `silt`, which is
          // a wet-bank material and turned the settled interior into a mud flat.
          material = touchesRoad && isNirvanaWaterTerrainMaterial(material)
            ? "gravel"
            : swardTierAt(column, row);
        }
      }
      grid.values[cornerIndex(grid, column, row)] = material;
    }
  }
  return grid;
}

function deriveAllTiles(grid: CornerGrid): NirvanaTerrainTile[] {
  const tiles: NirvanaTerrainTile[] = new Array(grid.columns * grid.rows);
  for (let row = 0; row < grid.rows; row += 1) {
    for (let column = 0; column < grid.columns; column += 1) {
      tiles[row * grid.columns + column] = deriveTile(grid, column, row);
    }
  }
  return tiles;
}

function applyBridgeDecks(
  tiles: readonly NirvanaTerrainTile[],
  bridges: readonly NirvanaTerrainBridge[],
  columns: number,
): NirvanaTerrainTile[] {
  const decked = [...tiles];
  for (const bridge of bridges) {
    for (const ref of bridge.deck) {
      const index = ref.row * columns + ref.column;
      decked[index] = Object.freeze({
        ...decked[index]!,
        blocked: false,
        bridgeDeck: true,
      });
    }
  }
  return decked;
}

function collisionFrom(tiles: readonly NirvanaTerrainTile[]): Uint8Array {
  const collision = new Uint8Array(tiles.length);
  for (let index = 0; index < tiles.length; index += 1) {
    collision[index] = tiles[index]!.blocked ? 1 : 0;
  }
  return collision;
}

function closeOuterEdge(mask: Uint8Array, columns: number, rows: number): void {
  for (let column = 0; column < columns; column += 1) {
    mask[column] = 1;
    mask[(rows - 1) * columns + column] = 1;
  }
  for (let row = 0; row < rows; row += 1) {
    mask[row * columns] = 1;
    mask[row * columns + columns - 1] = 1;
  }
}

function placeScarpProps(
  tiles: readonly NirvanaTerrainTile[],
  columns: number,
  rows: number,
  props: NirvanaTerrainProp[],
): void {
  const materialAt = (column: number, row: number): NirvanaTerrainMaterial | null => (
    column < 0 || row < 0 || column >= columns || row >= rows
      ? null
      : tiles[row * columns + column]!.material
  );
  const isRock = (column: number, row: number): boolean => materialAt(column, row) === "rock";
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      if (!isRock(column, row) || isRock(column, row + 1)) continue;
      if (materialAt(column, row + 1) === null) continue;
      // A running FACE only where the margin runs east-west for three tiles: on a
      // diagonal step, wide face pieces cannot merge and read as a stack of
      // separate objects, so a step takes the compact corner piece instead.
      const westEdge = isRock(column - 1, row) && !isRock(column - 1, row + 1);
      const eastEdge = isRock(column + 1, row) && !isRock(column + 1, row + 1);
      const steps = isRock(column - 1, row + 1) || isRock(column + 1, row + 1);
      const species = westEdge && eastEdge
        ? "scarpface"
        : steps ? "scarpcornerin" : "scarpcornerout";
      const variants = species === "scarpface" ? 4 : 2;
      props.push(makeProp(
        `scarp:${column},${row}`,
        species,
        Math.floor(hash2(column, row, 1301) * variants) % variants,
        column * TILE_PIXELS + TILE_PIXELS / 2 + (hash2(column, row, 1303) - 0.5) * 8,
        row * TILE_PIXELS + TILE_PIXELS + 12,
        false,
      ));
    }
  }
}

function placeWaterReeds(
  tiles: readonly NirvanaTerrainTile[],
  columns: number,
  rows: number,
  props: NirvanaTerrainProp[],
): void {
  const tileAt = (column: number, row: number): NirvanaTerrainTile | null => (
    column < 0 || row < 0 || column >= columns || row >= rows
      ? null
      : tiles[row * columns + column]!
  );
  for (let row = 1; row < rows - 1; row += 1) {
    for (let column = 1; column < columns - 1; column += 1) {
      const tile = tileAt(column, row)!;
      if (tile.bridgeDeck) continue;
      if (tile.material !== "water" && tile.material !== "shallow") continue;
      const margin = [
        tileAt(column - 1, row), tileAt(column + 1, row),
        tileAt(column, row - 1), tileAt(column, row + 1),
      ].some((neighbour) => neighbour !== null
        && (neighbour.material === "reed" || neighbour.material === "silt"
          || neighbour.material === "gravel"));
      if (!margin) continue;
      if (hash2(column, row, 1607) < 0.52) continue;
      props.push(makeProp(
        `reedwater:${column},${row}`,
        "reedwater",
        Math.floor(hash2(column, row, 1609) * 4) % 4,
        column * TILE_PIXELS + TILE_PIXELS / 2 + (hash2(column, row, 1613) - 0.5) * 18,
        row * TILE_PIXELS + TILE_PIXELS / 2 + (hash2(column, row, 1619) - 0.5) * 14,
        false,
      ));
    }
  }
}

function placeBridgeProps(
  bridges: readonly NirvanaTerrainBridge[],
  props: NirvanaTerrainProp[],
): void {
  for (const bridge of bridges) {
    const suffix = bridge.axis === "east-west" ? "h" : "v";
    const deckSpecies = bridge.stone ? `bridgearch${suffix}` : `bridgedeck${suffix}`;
    for (const ref of bridge.deck) {
      // Wear states: roughly a third of a timber deck carries a replaced plank, a
      // missing board with the river showing through, and a trodden centre line.
      // A bridge that reads as INHABITED is the difference from a prop.
      const worn = !bridge.stone && hash2(ref.column, ref.row, 1531) > 0.66;
      const species = worn ? `bridgeworn${suffix}` : deckSpecies;
      props.push(makeProp(
        `bridge:${bridge.id}:${ref.column},${ref.row}`,
        species,
        Math.floor(hash2(ref.column, ref.row, 1511) * 2) % 2,
        ref.column * TILE_PIXELS + TILE_PIXELS / 2,
        ref.row * TILE_PIXELS + TILE_PIXELS - 1,
        false,
      ));
    }
    if (!bridge.stone) {
      bridge.deck.forEach((ref, index) => {
        if (index % 3 !== 1) return;
        props.push(makeProp(
          `post:${bridge.id}:${ref.column},${ref.row}`,
          `bridgepost${suffix}`,
          Math.floor(hash2(ref.column, ref.row, 1543) * 2) % 2,
          ref.column * TILE_PIXELS + TILE_PIXELS / 2,
          ref.row * TILE_PIXELS + TILE_PIXELS - 1,
          false,
        ));
      });
    }
    for (const ref of bridge.abutments) {
      props.push(makeProp(
        `bridge:${bridge.id}:${ref.column},${ref.row}`,
        bridge.stone ? deckSpecies : `bridgeramp${suffix}`,
        Math.floor(hash2(ref.column, ref.row, 1549) * 2) % 2,
        ref.column * TILE_PIXELS + TILE_PIXELS / 2,
        ref.row * TILE_PIXELS + TILE_PIXELS - 1,
        false,
      ));
      props.push(makeProp(
        `pier:${bridge.id}:${ref.column},${ref.row}`,
        bridge.stone ? "bridgearchpier" : "bridgepier",
        Math.floor(hash2(ref.column, ref.row, 1523) * 2) % 2,
        ref.column * TILE_PIXELS + TILE_PIXELS / 2,
        ref.row * TILE_PIXELS + TILE_PIXELS - 1,
        false,
      ));
    }
  }
}

/**
 * Where the old road meets the river it becomes a shingle causeway — and that is ALL it
 * becomes. No timber is laid over it, deliberately.
 *
 * The protection rule already demotes the water the road crosses to `gravel`, so the road
 * runs across the reach as an unbroken band of shingle, which is what a road crossing a
 * shallow reach actually is and reads correctly at 1:1. An earlier pass laid the bridge
 * kit's plank deck, handrail posts and stone piers over those tiles to make the crossing
 * read as built infrastructure. Looking at it at 2x killed the idea twice over: the run is
 * only two tiles, so every tile is also an END and took a pier, and a pier is a chunky
 * stone block that covers the planks it is supposed to support — the crossing read as a
 * stone slab dropped on the road. Worse, the tiles qualify by being shingle ADJACENT to
 * water rather than shingle over it, so the timber was infrastructure over dry ground.
 *
 * `roadCausewayTiles` is still reported, because where the river reaches the road is worth
 * knowing; nothing is drawn on it.
 */
function placeProps(
  context: FieldContext,
  tiles: readonly NirvanaTerrainTile[],
  bridges: readonly NirvanaTerrainBridge[],
  landmarkFootprint: Uint8Array,
): NirvanaTerrainProp[] {
  const { columns, rows, protectedTiles, roadTiles, index } = context;
  const props: NirvanaTerrainProp[] = [];
  placeScarpProps(tiles, columns, rows, props);
  placeWaterReeds(tiles, columns, rows, props);

  const claimed = new Set<string>();
  for (const prop of props) claimed.add(`${prop.species}:${prop.tile.column},${prop.tile.row}`);
  // A bridgehead must stay open, or the bridge would land against a tree.
  for (const bridge of bridges) {
    for (const abutment of bridge.abutments) {
      claimed.add(`block:${abutment.column},${abutment.row}`);
    }
  }

  for (const species of SPECIES) {
    for (const candidate of candidatePositions(species, index, columns, rows)) {
      const tileIndex = candidate.row * columns + candidate.column;
      const tile = tiles[tileIndex]!;
      if (!species.on.includes(tile.material)) continue;
      // Roads and mechanics tiles carry no scenery at all; a blocking prop is also
      // kept off every protected tile and off the authored landmark footprints, so
      // it can never be the thing that closes a home, a door or a gate.
      if (roadTiles[tileIndex] === 1) continue;
      if (species.blocks && protectedTiles[tileIndex] === 1) continue;
      if (landmarkFootprint[tileIndex] === 1) continue;
      const key = `${species.id}:${candidate.column},${candidate.row}`;
      if (claimed.has(key)) continue;
      if (species.blocks) {
        const occupancy = `block:${candidate.column},${candidate.row}`;
        if (claimed.has(occupancy) || tile.blocked) continue;
        claimed.add(occupancy);
      }
      claimed.add(key);
      props.push(makeProp(
        key,
        species.id,
        candidate.variant,
        candidate.column * TILE_PIXELS + TILE_PIXELS / 2 + candidate.offsetX,
        candidate.row * TILE_PIXELS + TILE_PIXELS / 2 + candidate.offsetY,
        species.blocks,
      ));
    }
  }
  placeBridgeProps(bridges, props);
  props.sort((left, right) => left.footY - right.footY
    || left.footX - right.footX
    || left.id.localeCompare(right.id));
  return props;
}

/**
 * Build Nirvana's genesis terrain field: the picture, the mask, the crossings, the
 * scenery, and the terrain verdict on every authored macro landmark.
 *
 * Side effects: none. The result is memoised on a digest of the mechanics geometry,
 * because the recipe builder is called many times per run and the field is a pure
 * function of that geometry.
 */
export function createNirvanaTerrainField(
  input: NirvanaTerrainFieldInput,
): NirvanaTerrainField {
  const cacheKey = fieldCacheKey(input);
  const cached = FIELD_CACHE.get(cacheKey);
  if (cached !== undefined) return cached;
  const built = buildNirvanaTerrainField(input);
  if (FIELD_CACHE.size >= FIELD_CACHE_LIMIT) {
    const oldest = FIELD_CACHE.keys().next();
    if (!oldest.done) FIELD_CACHE.delete(oldest.value);
  }
  FIELD_CACHE.set(cacheKey, built);
  return built;
}

function buildNirvanaTerrainField(
  input: NirvanaTerrainFieldInput,
): NirvanaTerrainField {
  const { columns, rows } = input;
  if (!Number.isSafeInteger(columns) || !Number.isSafeInteger(rows)
    || columns <= 2 || rows <= 2) {
    throw new NirvanaTerrainFieldError("Nirvana terrain field needs positive tile bounds.");
  }
  if (input.protectedTiles.length !== columns * rows
    || input.roadTiles.length !== columns * rows) {
    throw new NirvanaTerrainFieldError(
      "Nirvana terrain field masks must match the region's tile bounds.",
    );
  }
  // A road is protected ground as well as a causeway trigger.
  const protectedTiles = Uint8Array.from(input.protectedTiles);
  for (let index = 0; index < protectedTiles.length; index += 1) {
    if (input.roadTiles[index] === 1) protectedTiles[index] = 1;
  }
  const context: FieldContext = {
    columns,
    rows,
    protectedTiles,
    clearedTiles: createClearedTiles(protectedTiles, columns, rows),
    roadTiles: input.roadTiles,
    index: createChannelIndex(),
  };

  const grid = buildCornerGrid(context);

  // Phase 1 — the terrain verdict on the authored macro landmarks, taken against
  // the unrepaired field so it does not depend on where a later crossing lands.
  const waterTile = new Uint8Array(columns * rows);
  {
    const tiles = deriveAllTiles(grid);
    for (let index = 0; index < tiles.length; index += 1) {
      const tile = tiles[index]!;
      const wet = isNirvanaWaterTerrainMaterial(tile.base)
        || tile.overlays.some(({ material }) => isNirvanaWaterTerrainMaterial(material));
      waterTile[index] = wet ? 1 : 0;
    }
  }
  const retainedLandmarkIds = new Set<string>();
  const retiredLandmarkIds = new Set<string>();
  const relocatedLandmarkIds = new Set<string>();
  const landmarkFootprint = new Uint8Array(columns * rows);
  const stanceIsDry = (stance: NirvanaTerrainLandmarkStance): boolean =>
    ![...stance.collisionTiles, ...stance.footTiles].some(({ column, row }) => (
      column >= 0 && row >= 0 && column < columns && row < rows
      && waterTile[row * columns + column] === 1
    ));
  for (const candidate of input.landmarkCandidates) {
    // Authored ground first, its authored alternative second, retirement only if both are
    // under water — relocate rather than retire.
    const stance = stanceIsDry(candidate) ? candidate
      : candidate.relocation !== undefined && stanceIsDry(candidate.relocation)
        ? candidate.relocation
        : null;
    if (stance === null) {
      retiredLandmarkIds.add(candidate.id);
      continue;
    }
    if (stance !== candidate) relocatedLandmarkIds.add(candidate.id);
    retainedLandmarkIds.add(candidate.id);
    for (const { column, row } of stance.collisionTiles) {
      if (column < 0 || row < 0 || column >= columns || row >= rows) continue;
      landmarkFootprint[row * columns + column] = 1;
    }
  }

  // Phase 2 — bridges, then repair to exactly one walkable component: open the
  // pockets worth reaching, seal the ones that are not. A being can never be
  // stranded or spawned into a place it cannot leave.
  let tiles = deriveAllTiles(grid);
  const bridges = BRIDGE_PLANS.map((plan) => resolveBridge(tiles, columns, rows, plan));
  tiles = applyBridgeDecks(tiles, bridges, columns);
  let reachable = compositeMask(collisionFrom(tiles), landmarkFootprint, columns, rows);
  for (let pass = 0; pass < 40; pass += 1) {
    const components = nirvanaWalkableComponents(reachable, columns, rows);
    if (components.length <= 1) break;
    const main = components[0]!;
    const orphan = components[1]!;
    if (orphan.tiles.length >= MIN_OPENED_POCKET_TILES) {
      const { from, to } = nearestPair(main, orphan, columns);
      carveCrossing(
        grid,
        { x: from.x + 0.5, y: from.y + 0.5 },
        { x: to.x + 0.5, y: to.y + 0.5 },
        1.25,
      );
    } else {
      sealPocket(grid, orphan, columns, rows, protectedTiles);
    }
    tiles = applyBridgeDecks(deriveAllTiles(grid), bridges, columns);
    reachable = compositeMask(collisionFrom(tiles), landmarkFootprint, columns, rows);
  }

  // Phase 3 — scenery, then give back any blocking prop that severs the graph.
  const roadCausewayTiles = new Set<string>();
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const index = row * columns + column;
      if (input.roadTiles[index] !== 1) continue;
      if (tiles[index]!.material !== "gravel") continue;
      if (!nearWater(waterTile, columns, rows, column, row)) continue;
      roadCausewayTiles.add(`${column},${row}`);
    }
  }
  const props = placeProps(context, tiles, bridges, landmarkFootprint);
  const collision = compositeMask(collisionFrom(tiles), landmarkFootprint, columns, rows);
  const keptProps: NirvanaTerrainProp[] = [...props];
  for (const prop of keptProps) {
    if (!prop.blocks) continue;
    collision[prop.tile.row * columns + prop.tile.column] = 1;
  }
  const terrainOnly = collisionFrom(tiles);
  for (let pass = 0; pass < 80; pass += 1) {
    const components = nirvanaWalkableComponents(collision, columns, rows);
    if (components.length <= 1) break;
    const orphan = components[components.length - 1]!;
    const orphanTiles = new Set(orphan.tiles);
    let removedIndex = -1;
    for (let index = 0; index < keptProps.length; index += 1) {
      const prop = keptProps[index]!;
      if (!prop.blocks) continue;
      const propIndex = prop.tile.row * columns + prop.tile.column;
      if (terrainOnly[propIndex] === 1 || landmarkFootprint[propIndex] === 1) continue;
      const column = propIndex % columns;
      const row = Math.floor(propIndex / columns);
      const neighbours = [
        column > 0 ? propIndex - 1 : -1,
        column < columns - 1 ? propIndex + 1 : -1,
        row > 0 ? propIndex - columns : -1,
        row < rows - 1 ? propIndex + columns : -1,
      ];
      if (!neighbours.some((neighbour) => neighbour >= 0 && orphanTiles.has(neighbour))) continue;
      removedIndex = index;
      break;
    }
    if (removedIndex < 0) {
      // Nothing to give back: the pocket is terrain-bound, so close it.
      for (const index of orphan.tiles) collision[index] = 1;
      continue;
    }
    const [removed] = keptProps.splice(removedIndex, 1);
    collision[removed!.tile.row * columns + removed!.tile.column] = 0;
  }

  // Phase 4 — split the analysis mask from the mask the chunks emit.
  //
  // Connectivity was proved above against the rim-CLOSED composition, because that is
  // the grid production actually navigates (`NirvanaRegionMapRecipe` closes the rim on
  // the composed region). A chunk, however, must publish the rim open: the root chunk's
  // west connector sits at (0,14) and `createNirvanaChunk` rejects a closed connector.
  // So the emitted mask re-derives the rim from what genuinely blocks there.
  const blockingPropTiles = new Uint8Array(columns * rows);
  for (const prop of keptProps) {
    if (!prop.blocks) continue;
    blockingPropTiles[prop.tile.row * columns + prop.tile.column] = 1;
  }
  //
  // The emitted mask also carries NO landmark footprint. The authored macro landmarks are
  // owned by the chunks that declare them, and the root chunk audibly REMOVES five of
  // them (`NirvanaInitialRegion`'s `ROOT_REMOVALS`); baking their footprints in here
  // would silently keep that ground closed and turn the removal audit into a formality.
  // The field still counts them while proving connectivity, which is the conservative
  // direction: giving a blocker back can only merge walkable components, never split one.
  const emitted = new Uint8Array(columns * rows);
  const onRim = (index: number): boolean => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return column === 0 || row === 0 || column === columns - 1 || row === rows - 1;
  };
  for (let index = 0; index < emitted.length; index += 1) {
    if (terrainOnly[index] === 1 || blockingPropTiles[index] === 1) {
      emitted[index] = 1;
      continue;
    }
    // A tile the repair pass closed because its pocket was terrain-bound stays closed:
    // an unreachable open tile is somewhere a body could be placed and never leave.
    // A tile closed only by the rim sweep is re-opened, per the note above.
    emitted[index] = collision[index] === 1
      && landmarkFootprint[index] !== 1
      && !onRim(index) ? 1 : 0;
  }

  // The legality guarantee, asserted rather than assumed: terrain, scenery and the
  // retained landmarks together may never close a tile the world needs open.
  for (let index = 0; index < emitted.length; index += 1) {
    if (protectedTiles[index] !== 1 || emitted[index] !== 1) continue;
    throw new NirvanaTerrainFieldError(
      `Nirvana terrain closed protected tile ${index % columns},${Math.floor(index / columns)}.`,
    );
  }

  const frozenTiles = Object.freeze(tiles);
  const frozenCorners = Object.freeze([...grid.values]);
  return Object.freeze({
    columns,
    rows,
    corners: frozenCorners,
    tiles: frozenTiles,
    blocked: collisionFrom(tiles),
    collision: emitted,
    reachable: collision,
    props: Object.freeze(keptProps),
    bridges: Object.freeze(bridges),
    retainedLandmarkIds,
    retiredLandmarkIds,
    relocatedLandmarkIds,
    roadCausewayTiles,
    cornerAt(column: number, row: number): NirvanaTerrainMaterial {
      const value = frozenCorners[row * (columns + 1) + column];
      if (value === undefined) {
        throw new NirvanaTerrainFieldError(
          `Nirvana terrain corner ${column},${row} is outside the field.`,
        );
      }
      return value;
    },
    tileAt(column: number, row: number): NirvanaTerrainTile {
      const value = frozenTiles[row * columns + column];
      if (value === undefined) {
        throw new NirvanaTerrainFieldError(
          `Nirvana terrain tile ${column},${row} is outside the field.`,
        );
      }
      return value;
    },
  });
}

function nearWater(
  waterTile: Uint8Array,
  columns: number,
  rows: number,
  column: number,
  row: number,
): boolean {
  for (let dr = -1; dr <= 1; dr += 1) {
    for (let dc = -1; dc <= 1; dc += 1) {
      const tc = column + dc;
      const tr = row + dr;
      if (tc < 0 || tr < 0 || tc >= columns || tr >= rows) continue;
      if (waterTile[tr * columns + tc] === 1) return true;
    }
  }
  return false;
}

function compositeMask(
  terrain: Uint8Array,
  landmarks: Uint8Array,
  columns: number,
  rows: number,
): Uint8Array {
  const mask = Uint8Array.from(terrain);
  for (let index = 0; index < mask.length; index += 1) {
    if (landmarks[index] === 1) mask[index] = 1;
  }
  closeOuterEdge(mask, columns, rows);
  return mask;
}

// ---------------------------------------------------------------------------
// memoisation
// ---------------------------------------------------------------------------

const FIELD_CACHE_LIMIT = 4;
const FIELD_CACHE = new Map<string, NirvanaTerrainField>();

function fieldCacheKey(input: NirvanaTerrainFieldInput): string {
  let hash = 2166136261 >>> 0;
  const mix = (value: number): void => {
    hash ^= value & 0xff;
    hash = Math.imul(hash, 16777619);
  };
  mix(input.columns);
  mix(input.columns >>> 8);
  mix(input.rows);
  mix(input.rows >>> 8);
  for (let index = 0; index < input.protectedTiles.length; index += 1) {
    mix(input.protectedTiles[index]!);
  }
  for (let index = 0; index < input.roadTiles.length; index += 1) {
    mix(input.roadTiles[index]!);
  }
  const mixStance = (stance: NirvanaTerrainLandmarkStance): void => {
    for (const { column, row } of stance.collisionTiles) {
      mix(column);
      mix(row);
    }
    for (const { column, row } of stance.footTiles) {
      mix(column);
      mix(row);
    }
  };
  for (const candidate of input.landmarkCandidates) {
    for (let index = 0; index < candidate.id.length; index += 1) {
      mix(candidate.id.charCodeAt(index));
    }
    mixStance(candidate);
    // The relocation changes the verdict, so it must change the key.
    if (candidate.relocation !== undefined) mixStance(candidate.relocation);
  }
  return `${input.columns}x${input.rows}:${(hash >>> 0).toString(16)}`;
}
