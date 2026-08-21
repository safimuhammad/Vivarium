/**
 * @fileoverview Pure geometry for the world-sheet camera's region layout.
 *
 * **The layout: a single-ring adjacency-cycle embedding** (design of record:
 * `docs/frontend/ATLAS_VIEW.md` §2). Every region sits on ONE ring, in a cyclic order taken from a
 * walk of the adjacency graph, so every adjacency edge is either a short ring-neighbour arc or a
 * chord through the **empty centre**. No bridge chord can pass through a third island *by
 * construction* -- all islands are on the ring, the interior holds nothing. That closes the known
 * hazard of the previous hub-and-satellite layout (with three satellites at 0/120/240 degrees, a
 * satellite-to-satellite chord passes within R/2 of the hub, i.e. straight through the hub island)
 * structurally rather than by testing around it.
 *
 * For the real world (`K4` minus the `nirvana_east <-> nirvana_west` edge) the walk gives
 * `nirvana -> nirvana_east -> warm_springs -> nirvana_west`: a diamond whose one MISSING edge lands
 * on the diagonal, so the two unconnected regions sit opposite each other across a visibly wide
 * gulf. A viewer learns the topology by looking, with no legend.
 *
 * The ring is an **ellipse** (x * {@link RING_ASPECT_X} / y * {@link RING_ASPECT_Y}) so the
 * composition fills a landscape frame instead of leaving two columns of dead sea, and each region
 * gets deterministic angular/radial jitter so the result reads as an archipelago, not a compass
 * rose. {@link packRegionSheet} then contracts the ring about the centroid until the shortest real
 * LAND-to-LAND gap between two bridged islands reaches a short, purposeful crossing length --
 * measured on the actual silhouettes, not on bounding boxes.
 *
 * **Growth stability:** the ring order is a pure function of the id set and the adjacency graph;
 * extents only change radii. Grow Nirvana and it swells in place, the ring widens, the neighbours
 * slide outward, the bridges re-anchor. No island swaps identity or character.
 *
 * This module still knows nothing about rendering, the camera, canvases, React, or region
 * *content*: it never imports from `renderer2d/camera`, `renderer2d/production/nirvana`, or any
 * rendering module. Callers pass plain pixel extents (`{id, widthPx, heightPx}`) and an optional
 * adjacency edge list and get back plain rectangles; there is no dependency in either direction on
 * a region recipe object.
 *
 * That last point is load-bearing, not incidental: Nirvana's map recipes carry an
 * object-identity-keyed authored-scene sidecar plus a content hash re-verified at render time (see
 * `NirvanaRegionMapRecipe.ts`, `NirvanaChunkAuthoring.ts`) -- cloning or mutating a recipe object
 * fails closed and breaks Nirvana's rendering entirely. This module never sees a recipe. Callers
 * are responsible for reducing a recipe to its current pixel extent
 * (`recipe.grid.columns * TILE_SIZE`, `recipe.grid.rows * TILE_SIZE`, exactly as
 * `CanvasPresentationRenderer.describeStaticSceneTarget` already does) before calling
 * {@link computeRegionSheet}. The functions below read only the three declared fields of
 * {@link RegionExtent} -- nothing else, ever.
 *
 * The one import this module DOES have is `./islandMask` (a sibling, equally pure geometry module,
 * itself zero-import) -- for its `IslandPoint` type and its deterministic string hash. The
 * dependency is one-directional; there is no cycle.
 */

import { unitHash, type IslandPoint } from "./islandMask";

/** A region's current pixel footprint -- everything this module needs to know about it. */
export interface RegionExtent {
  /** The region's stable identifier (e.g. `"nirvana"`). */
  readonly id: string;
  /** The region's current width, in world pixels. */
  readonly widthPx: number;
  /** The region's current height, in world pixels. */
  readonly heightPx: number;
}

/** An axis-aligned rectangle in shared world-sheet pixel space. */
export interface SheetRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** A point in shared world-sheet pixel space. */
export interface SheetPoint {
  readonly x: number;
  readonly y: number;
}

/** An undirected adjacency edge between two region ids. Order within the pair does not matter --
 * `["a", "b"]` and `["b", "a"]` are the same edge. */
export type RegionAdjacency = ReadonlyArray<readonly [string, string]>;

/** The deterministic layout produced by {@link computeRegionSheet}. */
export interface RegionSheet {
  /** Each region's bounding plot rect, keyed by region id. The island silhouette drawn inside a
   * plot (see `islandMask.ts`) is inset from this rect -- the rect itself is a bounding box, not
   * the island's own outline. */
  readonly rects: Readonly<Record<string, SheetRect>>;
  /**
   * The union bounding box of every plot. Always anchored at the origin (`x: 0, y: 0`);
   * `width`/`height` are the exact extent needed to contain every plot.
   */
  readonly bounds: SheetRect;
  /** The minimum sea gap the ring solve guarantees between two ring-adjacent regions' bounding
   * circles (see {@link GUTTER_PX}). {@link packRegionSheet} may contract below this for
   * *bounding* circles -- it never lets two real coastlines come closer than its own floor. */
  readonly gutterPx: number;
  /** The most-connected region (ties break toward the ascending-first id). The ring embedding has
   * no hub -- this is reported for diagnostics and for callers that want a canonical "centre of
   * the world" region. `null` only for an empty region set. */
  readonly hubId: string | null;
  /** The ring order the embedding used, ascending-seeded and adjacency-walked. */
  readonly ringOrder: readonly string[];
}

/**
 * Minimum pixel gap the ring solve guarantees between two ring-adjacent regions' bounding circles
 * -- reads as open sea between islands, large enough for a bridge span to be legible rather than a
 * seam. A literal, not derived from any renderer tile-size constant, so this module carries zero
 * rendering imports.
 */
export const GUTTER_PX = 120;

/** The island fills roughly this fraction of its plot's larger half-extent, so the ring packs
 * against the ISLAND's radius rather than the plot's half-diagonal -- otherwise a square region
 * reserves 41 % dead sea. */
const ISLAND_RADIUS_FRACTION = 0.86;

/** The ring is an ellipse, not a circle: the composition fills a landscape frame. */
const RING_ASPECT_X = 1.34;
const RING_ASPECT_Y = 0.92;

/** Deterministic per-region jitter so the archipelago is not a compass rose. */
const ANGLE_JITTER_FRACTION = 0.24;
const RADIUS_JITTER_FRACTION = 0.07;

/** Sea margin kept around the outermost plot when the layout is normalized to the origin. */
const SHEET_MARGIN_PX = 150;

/**
 * Lays out a region set as islands on one shared sea plane, using the single-ring adjacency-cycle
 * embedding described in this module's doc.
 *
 * Regions are sorted ascending by id, and adjacency edges are normalized/deduped, before any
 * placement decision -- the resulting layout is therefore a pure function of the *set* of
 * `(id, widthPx, heightPx)` triples and the *set* of adjacency edges, independent of the order the
 * caller happens to pass either in. This is what keeps plots from shuffling between runs or
 * restarts even if an upstream collection (e.g. a `Map` or object) changes its iteration order.
 *
 * @param regions - The current pixel extent of every region to place. Ids must be unique and
 *   non-empty; `widthPx`/`heightPx` must be finite and positive.
 * @param adjacency - Optional adjacency edges (e.g. `config/world.yaml`'s per-region `connections`
 *   lists, flattened to pairs). Edges naming an id not present in `regions`, self-pairs, and
 *   duplicate/reversed pairs are ignored. Defaults to no edges (the ring order is then simply the
 *   ascending id order).
 * @returns The plot rect per region id, the union bounds, the guaranteed minimum sea gap, the
 *   most-connected region id, and the ring order used.
 * @throws {Error} If any id is empty or duplicated, or any extent is not a finite positive number.
 */
export function computeRegionSheet(
  regions: ReadonlyArray<RegionExtent>,
  adjacency: RegionAdjacency = [],
): RegionSheet {
  assertValidRegions(regions);

  if (regions.length === 0) {
    return Object.freeze({
      rects: Object.freeze({}),
      bounds: Object.freeze({ x: 0, y: 0, width: 0, height: 0 }),
      gutterPx: GUTTER_PX,
      hubId: null,
      ringOrder: Object.freeze([]),
    });
  }

  const ordered = [...regions].sort((left, right) => compareRegionId(left.id, right.id));
  const ids = ordered.map((region) => region.id);
  const idSet = new Set(ids);
  const extentById = new Map(ordered.map((region) => [region.id, region]));

  const edges = normalizeAdjacency(adjacency, idSet);
  const hubId = chooseHub(ids, edges);
  const order = ringOrderFor(ids, edges);
  const count = order.length;

  const radiusOf = (id: string): number => {
    const extent = extentById.get(id) as RegionExtent;
    return (Math.max(extent.widthPx, extent.heightPx) / 2) * ISLAND_RADIUS_FRACTION;
  };

  // Closed-form ring radius: every ring-adjacent pair's bounding circles clear GUTTER_PX. The
  // clearance solve conservatively uses the SHORT ellipse axis.
  const shortAxis = Math.min(RING_ASPECT_X, RING_ASPECT_Y);
  let ringRadius = 0;
  if (count === 1) {
    ringRadius = 0;
  } else {
    const step = (2 * Math.PI) / count;
    for (let index = 0; index < count; index += 1) {
      const a = order[index] as string;
      const b = order[(index + 1) % count] as string;
      ringRadius = Math.max(
        ringRadius,
        (radiusOf(a) + radiusOf(b) + GUTTER_PX) / (2 * Math.sin(step / 2) * shortAxis),
      );
    }
    const largest = Math.max(...order.map(radiusOf));
    ringRadius = Math.max(ringRadius, (largest + GUTTER_PX) / shortAxis);
  }

  const placeAt = (scale: number): PlacedPlot[] => order.map((id, index) => {
    const extent = extentById.get(id) as RegionExtent;
    // Anchor the first ring position due WEST: a layout convention, chosen so a two-region sheet
    // spreads horizontally with the ascending-first id on the left (which is where the camera's
    // own pan/zoom tests expect it). For four regions this only rotates which region sits where --
    // the ring positions themselves are the same {0, 90, 180, 270} either way.
    const base = Math.PI + (index / count) * Math.PI * 2;
    const angle = base
      + (unitHash(`${id}:angle`) * 2 - 1) * (Math.PI / count) * ANGLE_JITTER_FRACTION;
    const radius = ringRadius * scale
      * (1 + (unitHash(`${id}:radius`) * 2 - 1) * RADIUS_JITTER_FRACTION);
    return {
      id,
      x: Math.cos(angle) * radius * RING_ASPECT_X - extent.widthPx / 2,
      y: Math.sin(angle) * radius * RING_ASPECT_Y - extent.heightPx / 2,
      width: extent.widthPx,
      height: extent.heightPx,
    };
  });

  // The ring is solved against each island's own radius, not its plot's half-diagonal (otherwise a
  // square region reserves 41 % dead sea) -- so a tall neighbour's PLOT corner can still reach into
  // the next plot even though the two coastlines are comfortably apart. Plot rects must stay
  // disjoint regardless, because that is what makes `regionAtPoint` unambiguous, so widen the ring
  // by a fixed step until they are. Deterministic: a fixed multiplier and a fixed cap.
  let placed = placeAt(1);
  for (let attempt = 0; attempt < 120 && anyPlotsOverlap(placed); attempt += 1) {
    placed = placeAt(1 + (attempt + 1) * 0.02);
  }

  return normalizeSheet(placed, hubId, order);
}

/** Resolves a region id to its island's coast points in PLOT-LOCAL pixels (see `islandMask.ts`'s
 * `islandCoastPoints`), or `null` when no mask is available for it yet. */
export type CoastPointsForRegion = (regionId: string) => readonly IslandPoint[] | null;

/** Target land-to-land crossing length, as a fraction of the mean island width. */
const CROSSING_TARGET_FRACTION = 0.16;
/** Hard floor: no two coastlines may ever come closer than this fraction of the mean island width. */
const CROSSING_FLOOR_FRACTION = 0.075;
/** Deterministic contraction schedule. */
const PACK_STEP = 0.985;
const PACK_MAX_STEPS = 80;

/**
 * Contracts the ring about the archipelago's centroid until the shortest real LAND-to-LAND gap
 * between two BRIDGED islands reaches a short, purposeful crossing length. Measured on the actual
 * silhouettes, not on bounding boxes -- this is what makes the crossings read as short and
 * purposeful instead of as ferry routes.
 *
 * Deterministic: a fixed multiplicative step, a fixed iteration cap, and a hard floor that stops
 * the contraction before ANY two coastlines (bridged or not) can touch.
 *
 * @param sheet - A layout produced by {@link computeRegionSheet}.
 * @param adjacency - The same adjacency edges the layout was built from; only bridged pairs drive
 *   the target, but every pair is checked against the floor.
 * @param coastPointsFor - Resolves each region's plot-local coast points. A region whose points
 *   are unavailable is left in place and ignored by the gap measurements.
 * @returns A contracted layout, re-normalized to the origin. Returns `sheet` unchanged when fewer
 *   than two regions have coast points, or when no bridged pair is resolvable.
 */
export function packRegionSheet(
  sheet: RegionSheet,
  adjacency: RegionAdjacency,
  coastPointsFor: CoastPointsForRegion,
): RegionSheet {
  const entries = Object.entries(sheet.rects);
  if (entries.length < 2) return sheet;
  const coasts = new Map<string, readonly IslandPoint[]>();
  for (const [id] of entries) {
    const points = coastPointsFor(id);
    if (points !== null && points.length > 0) coasts.set(id, points);
  }
  if (coasts.size < 2) return sheet;

  const plots = entries.map(([id, rect]) => ({ id, x: rect.x, y: rect.y, width: rect.width, height: rect.height }));
  const plotById = new Map(plots.map((plot) => [plot.id, plot]));
  const idSet = new Set(plots.map((plot) => plot.id));
  const edges = normalizeAdjacency(adjacency, idSet).filter(([a, b]) => coasts.has(a) && coasts.has(b));
  if (edges.length === 0) return sheet;

  const measurable = plots.filter((plot) => coasts.has(plot.id));
  const allPairs: Array<readonly [string, string]> = [];
  for (let i = 0; i < measurable.length; i += 1) {
    for (let j = i + 1; j < measurable.length; j += 1) {
      allPairs.push([(measurable[i] as { id: string }).id, (measurable[j] as { id: string }).id]);
    }
  }

  const gapBetween = (a: string, b: string): number => {
    const plotA = plotById.get(a) as { x: number; y: number };
    const plotB = plotById.get(b) as { x: number; y: number };
    const coastA = coasts.get(a) as readonly IslandPoint[];
    const coastB = coasts.get(b) as readonly IslandPoint[];
    let best = Number.POSITIVE_INFINITY;
    for (const p of coastA) {
      const px = plotA.x + p.x;
      const py = plotA.y + p.y;
      for (const q of coastB) {
        const dx = px - plotB.x - q.x;
        const dy = py - plotB.y - q.y;
        const squared = dx * dx + dy * dy;
        if (squared < best) best = squared;
      }
    }
    return Math.sqrt(best);
  };

  const meanWidth = measurable.reduce((sum, plot) => sum + plot.width, 0) / measurable.length;
  const target = meanWidth * CROSSING_TARGET_FRACTION;
  const floor = meanWidth * CROSSING_FLOOR_FRACTION;
  const centerX = measurable.reduce((sum, plot) => sum + plot.x + plot.width / 2, 0) / measurable.length;
  const centerY = measurable.reduce((sum, plot) => sum + plot.y + plot.height / 2, 0) / measurable.length;

  for (let step = 0; step < PACK_MAX_STEPS; step += 1) {
    let bridgedGap = Number.POSITIVE_INFINITY;
    for (const [a, b] of edges) bridgedGap = Math.min(bridgedGap, gapBetween(a, b));
    let nearestGap = Number.POSITIVE_INFINITY;
    for (const [a, b] of allPairs) nearestGap = Math.min(nearestGap, gapBetween(a, b));
    if (bridgedGap <= target || nearestGap <= floor) break;
    // Only the real COASTLINES bound this contraction. Plot rects may end up overlapping in the
    // open sea between two islands -- deliberately: a plot is a bounding box around a silhouette
    // that fills maybe 70 % of it, and refusing to let those boxes touch would leave every
    // crossing a ferry route. Two consequences, both handled: `regionAtPoint` breaks a containment
    // tie by nearest plot centre (below), and a neighbouring island can only be OVERDRAWN by the
    // focused region's unclipped rect above `lodSnapshotZoom` -- where, by that contain-fit's own
    // definition, the viewport sits inside the focused rect and no neighbour is on screen.
    for (const plot of plots) {
      plot.x = centerX + (plot.x + plot.width / 2 - centerX) * PACK_STEP - plot.width / 2;
      plot.y = centerY + (plot.y + plot.height / 2 - centerY) * PACK_STEP - plot.height / 2;
    }
  }

  return normalizeSheet(plots, sheet.hubId, sheet.ringOrder);
}

/**
 * Finds which region's PLOT RECT contains a point on the sheet.
 *
 * Deliberately the bounding rect, not the island silhouette: the silhouette is a *portrait* of the
 * region at map zoom, and the full rectangle is what the region actually is (see `islandMask.ts`'s
 * module doc and `docs/frontend/ATLAS_VIEW.md` §9 -- "the fix is to route hit-testing through the
 * rect, not the mask"). A camera centre drifting into a bay must still resolve to the region it is
 * plainly over.
 *
 * {@link computeRegionSheet}'s own placement keeps plots disjoint, but {@link packRegionSheet} may
 * let two bounding boxes overlap in the open sea between their coastlines. A point inside more
 * than one plot therefore resolves to the plot whose CENTRE is nearest -- the region it is most
 * plainly over -- with ties broken toward the ascending-first id, so the answer never depends on
 * object iteration order.
 *
 * @param sheet - A layout produced by {@link computeRegionSheet}.
 * @param point - The point to test, in the same pixel space as `sheet`.
 * @returns The containing region's id, or `null` if `point` falls on the open sea between plots or
 *   outside the sheet entirely.
 */
export function regionAtPoint(sheet: RegionSheet, point: SheetPoint): string | null {
  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const [id, rect] of Object.entries(sheet.rects)) {
    if (point.x < rect.x || point.x >= rect.x + rect.width
      || point.y < rect.y || point.y >= rect.y + rect.height) continue;
    const distance = Math.hypot(
      point.x - (rect.x + rect.width / 2),
      point.y - (rect.y + rect.height / 2),
    );
    if (distance < bestDistance || (distance === bestDistance && (best === null || id < best))) {
      best = id;
      bestDistance = distance;
    }
  }
  return best;
}

/* ------------------------------------------------------------------------------- internals */

interface PlacedPlot {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Whether any two plot rects in a placement intersect. */
function anyPlotsOverlap(plots: readonly PlacedPlot[]): boolean {
  for (let i = 0; i < plots.length; i += 1) {
    for (let j = i + 1; j < plots.length; j += 1) {
      const a = plots[i] as PlacedPlot;
      const b = plots[j] as PlacedPlot;
      if (a.x < b.x + b.width && b.x < a.x + a.width
        && a.y < b.y + b.height && b.y < a.y + a.height) return true;
    }
  }
  return false;
}

/** Translates a placement into positive space with a sea margin and freezes it into a sheet. */
function normalizeSheet(
  plots: readonly PlacedPlot[],
  hubId: string | null,
  ringOrder: readonly string[],
): RegionSheet {
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const plot of plots) {
    minX = Math.min(minX, plot.x - SHEET_MARGIN_PX);
    minY = Math.min(minY, plot.y - SHEET_MARGIN_PX);
    maxX = Math.max(maxX, plot.x + plot.width + SHEET_MARGIN_PX);
    maxY = Math.max(maxY, plot.y + plot.height + SHEET_MARGIN_PX);
  }
  const rects: Record<string, SheetRect> = {};
  for (const plot of plots) {
    rects[plot.id] = Object.freeze({
      x: plot.x - minX,
      y: plot.y - minY,
      width: plot.width,
      height: plot.height,
    });
  }
  return Object.freeze({
    rects: Object.freeze(rects),
    bounds: Object.freeze({ x: 0, y: 0, width: maxX - minX, height: maxY - minY }),
    gutterPx: GUTTER_PX,
    hubId,
    ringOrder: Object.freeze([...ringOrder]),
  });
}

function compareRegionId(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Normalizes an adjacency edge list: drops self-pairs and edges naming an unknown id, orders
 * each pair's two ids ascending, and dedupes symmetric duplicates -- independent of input order. */
function normalizeAdjacency(
  adjacency: RegionAdjacency,
  idSet: ReadonlySet<string>,
): ReadonlyArray<readonly [string, string]> {
  const seenKeys = new Set<string>();
  const edges: Array<readonly [string, string]> = [];
  for (const [rawA, rawB] of adjacency) {
    if (rawA === rawB || !idSet.has(rawA) || !idSet.has(rawB)) continue;
    const [a, b] = rawA < rawB ? [rawA, rawB] : [rawB, rawA];
    const key = `${a}|${b}`;
    if (seenKeys.has(key)) continue;
    seenKeys.add(key);
    edges.push([a, b]);
  }
  return edges;
}

/** The most-connected region; ties break toward the ascending-first id. */
function chooseHub(ids: readonly string[], edges: ReadonlyArray<readonly [string, string]>): string {
  const degree = new Map<string, number>(ids.map((id) => [id, 0]));
  for (const [a, b] of edges) {
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
  }
  let hubId = ids[0] as string;
  for (const id of ids) {
    if ((degree.get(id) ?? 0) > (degree.get(hubId) ?? 0)) hubId = id;
  }
  return hubId;
}

/**
 * The cyclic ring order: a deterministic greedy walk of the adjacency graph from the
 * ascending-first id, stepping to the smallest-id unvisited neighbour when one exists and jumping
 * to the smallest-id unvisited region otherwise. For the real world this yields
 * `nirvana -> nirvana_east -> warm_springs -> nirvana_west`, which puts the one MISSING edge on
 * the diamond's diagonal.
 */
function ringOrderFor(
  ids: readonly string[],
  edges: ReadonlyArray<readonly [string, string]>,
): readonly string[] {
  const neighbours = new Map<string, string[]>(ids.map((id) => [id, []]));
  for (const [a, b] of edges) {
    neighbours.get(a)?.push(b);
    neighbours.get(b)?.push(a);
  }
  for (const list of neighbours.values()) list.sort(compareRegionId);
  const visited = new Set<string>();
  const order: string[] = [];
  let current: string | undefined = ids[0];
  while (order.length < ids.length && current !== undefined) {
    order.push(current);
    visited.add(current);
    const next: string | undefined = (neighbours.get(current) ?? []).find((id) => !visited.has(id));
    current = next ?? ids.find((id) => !visited.has(id));
  }
  return order;
}

function assertValidRegions(regions: ReadonlyArray<RegionExtent>): void {
  const seenIds = new Set<string>();
  for (const region of regions) {
    if (region.id.length === 0) {
      throw new Error("computeRegionSheet: region id must be a non-empty string.");
    }
    if (seenIds.has(region.id)) {
      throw new Error(`computeRegionSheet: duplicate region id "${region.id}".`);
    }
    seenIds.add(region.id);
    if (!Number.isFinite(region.widthPx) || region.widthPx <= 0) {
      throw new Error(
        `computeRegionSheet: region "${region.id}" widthPx must be a finite positive number, got ${region.widthPx}.`,
      );
    }
    if (!Number.isFinite(region.heightPx) || region.heightPx <= 0) {
      throw new Error(
        `computeRegionSheet: region "${region.id}" heightPx must be a finite positive number, got ${region.heightPx}.`,
      );
    }
  }
}
