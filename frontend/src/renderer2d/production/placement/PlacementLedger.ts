import type { AgentSnapshot, HomeSnapshot } from "../../../app/schemas";
import type { Vec2 } from "../../contracts";
import { TILE_SIZE, tileCenter, type TileCoord } from "../../map/regionMap";
import { findArrivalGate, stableHash } from "../maps/directedTopology";
import {
  cloneTrustedRegionMapRecipe,
  type RegionMapRecipeV1,
} from "../maps/RegionMapRecipe";
import { navigationGridIsToroidal, type NavigationGrid } from "../navigation/navigation";
import {
  STANDING_HUMAN_VISUAL_ENVELOPE,
  feetAnchoredVisualRect,
  navigationTileForFeet,
  productionRectsOverlap,
  shelterRenderRect,
} from "../productionGeometry";

const AGENT_READABILITY_GAP = 4;

export interface AgentPlacement {
  readonly regionId: string;
  readonly point: Vec2;
  readonly anchorKind: string;
}

export interface HomePlacement {
  readonly regionId: string;
  readonly plotId: string;
  readonly door: Vec2;
}

/**
 * Free/occupied/total shelter-plot counts for one region, read live from
 * this ledger's own occupancy state.
 *
 * This is a DIFFERENT quantity from `world/pressure.py`'s population/built
 * high-water marks that drive Nirvana's existing sim-side growth trigger
 * (`NirvanaGrowthPolicy.ts`): those are monotone (raise-never-lower)
 * counters recomputed from checkpoint snapshots on the Python side. This is
 * the frontend placement ledger's own live count of literal shelter plots
 * (`RegionMapRecipeV1.shelterPlots`) against how many of them this ledger
 * has actually occupied -- it can only ever grow toward capacity because
 * plots are never freed, but it is not itself a high-water mark and it is
 * not wired to any growth trigger. A later phase that activates region
 * growth is free to consume `atCapacity`; activating that consumption is
 * out of scope for whatever produces this snapshot.
 */
export interface ShelterCapacitySnapshot {
  readonly regionId: string;
  readonly total: number;
  readonly occupied: number;
  readonly free: number;
  readonly atCapacity: boolean;
}

/** Why `placeHome` could not allocate a shelter plot for a home. */
export type HomeUnplacedReason = "region-at-capacity";

/** A home this ledger could not place on any shelter plot, and why. */
export interface UnplacedHome {
  readonly homeId: string;
  readonly regionId: string;
  readonly reason: HomeUnplacedReason;
}

/**
 * The typed, non-throwing outcome of `PlacementLedger.placeHome`.
 *
 * A home either lands on a real plot (`status: "placed"`, carrying the same
 * fields `HomePlacement` always carried), or the region has no legal
 * shelter plot left (`status: "unplaced"`) -- an honest, observable
 * simulation-view STATE, not an exception. See `placeHome`'s docstring for
 * what a viewer sees when a home is unplaced.
 */
export type HomePlacementResult =
  | (Readonly<HomePlacement> & Readonly<{ status: "placed" }>)
  | Readonly<{
      status: "unplaced";
      homeId: string;
      regionId: string;
      reason: HomeUnplacedReason;
      capacity: ShelterCapacitySnapshot;
    }>;

export interface PlacementLedgerSnapshot {
  readonly revision: number;
  readonly agents: ReadonlyMap<string, Readonly<AgentPlacement>>;
  readonly homes: ReadonlyMap<string, Readonly<HomePlacement>>;
  readonly districtsByRegion: ReadonlyMap<string, number>;
}

export interface PlacementCheckpoint {
  readonly agents: readonly AgentSnapshot[];
  readonly homes: readonly HomeSnapshot[];
}

export type AgentPlacementContext =
  | Readonly<{ kind: "arrival"; fromRegion: string; requestedFinal?: Vec2 }>
  | Readonly<{
      kind: "birth";
      acceptorId: string;
      authoritativeColocation: boolean;
      allowProvisionalReanchor?: boolean;
    }>
  | Readonly<{ kind?: "checkpoint" }>;

/** Append-stable allocation ledger for checkpoint reconstruction and live additions. */
export class PlacementLedger {
  private readonly recipes: ReadonlyMap<string, RegionMapRecipeV1>;
  private readonly lineage: symbol;
  private readonly agentPlacements = new Map<string, AgentPlacement>();
  private readonly homePlacements = new Map<string, HomePlacement>();
  private readonly occupiedAgentPoints = new Map<string, Set<string>>();
  private readonly occupiedPlots = new Map<string, Set<string>>();
  private readonly districtCounts = new Map<string, number>();
  private readonly unplacedHomes = new Map<string, UnplacedHome>();
  private readonly provisionalAgentIds = new Set<string>();
  private revision = 0;

  private constructor(recipes: readonly RegionMapRecipeV1[], lineage = Symbol("placement-ledger")) {
    const owned = recipes.map((recipe) => deepFreezeOwned(
      cloneTrustedRegionMapRecipe(recipe),
    ));
    this.recipes = new Map(owned.map((recipe) => [recipe.regionId, recipe]));
    this.lineage = lineage;
    if (this.recipes.size !== recipes.length) throw new Error("placement recipes must have unique region IDs");
  }

  /** Reconstruct a deterministic baseline, then retain append-only live allocations. */
  static reconstruct(recipes: readonly RegionMapRecipeV1[], checkpoint: PlacementCheckpoint): PlacementLedger {
    const ledger = new PlacementLedger(recipes);
    const homes = [...checkpoint.homes].sort((left, right) =>
      left.built_at - right.built_at || compareText(left.home_id, right.home_id));
    const agents = [...checkpoint.agents].sort((left, right) => compareText(left.id, right.id));
    for (const home of homes) ledger.placeHome(home);
    for (const agent of agents) ledger.placeAgent(agent, { kind: "checkpoint" });
    return ledger;
  }

  /** Return the bounded lineage identity shared only by forks of this ledger. */
  sourceIdentity(): symbol {
    return this.lineage;
  }

  /** Compare only placement-relevant checkpoint identity without cloning ledger state. */
  hasEquivalentCheckpointPlacement(checkpoint: PlacementCheckpoint): boolean {
    if (
      checkpoint.agents.length !== this.agentPlacements.size
      || checkpoint.homes.length !== this.homePlacements.size
    ) return false;
    const seenAgents = new Set<string>();
    for (const agent of checkpoint.agents) {
      if (seenAgents.has(agent.id)) return false;
      seenAgents.add(agent.id);
      if (this.agentPlacements.get(agent.id)?.regionId !== agent.position) return false;
    }
    const seenHomes = new Set<string>();
    for (const home of checkpoint.homes) {
      if (seenHomes.has(home.home_id)) return false;
      seenHomes.add(home.home_id);
      if (this.homePlacements.get(home.home_id)?.regionId !== home.region) return false;
    }
    return true;
  }

  /** Create an isolated candidate ledger carrying the exact current allocation state. */
  fork(): PlacementLedger {
    const candidate = new PlacementLedger([...this.recipes.values()], this.lineage);
    candidate.copyStateFrom(this);
    return candidate;
  }

  /** Atomically replace this ledger with a candidate from the same lineage. */
  commit(candidate: PlacementLedger): void {
    if (candidate.lineage !== this.lineage) {
      throw new Error("Cannot commit a placement ledger from another lineage.");
    }
    if (candidate === this) return;
    this.copyStateFrom(candidate);
  }

  /**
   * Allocate a home by stable home ID without moving any prior plot
   * assignment, or report that the region has no legal shelter plot left.
   *
   * Never throws for shelter-plot exhaustion. `RegionMapRecipeV1` fixes
   * shelter-plot capacity per region (128 = 8 districts x 16
   * `SHELTER_PLOT_OFFSETS`) and this ledger never frees an occupied plot,
   * so a full region is an expected, permanent-until-growth STATE rather
   * than a programming error -- it must stay representable, including at
   * checkpoint `reconstruct`, which replays every home through this method
   * and cannot afford to be fatal on a full region. Returns a typed
   * `HomePlacementResult`: `{ status: "placed", ... }` on success, with
   * the exact same fields the old `HomePlacement` return carried and the
   * exact same `chooseByHash` selection among free plots (unchanged); or
   * `{ status: "unplaced", reason: "region-at-capacity", capacity, ... }`
   * once every plot in every district is occupied. An unplaced outcome is
   * remembered in `unplacedHomes` so repeated calls for the same home ID
   * are idempotent and cheap rather than re-scanning districts every time.
   * Mutates `homePlacements`/`occupiedPlots`/`districtCounts` on success;
   * mutates only `unplacedHomes` on exhaustion. Still throws for an
   * *unknown* region via `requireRecipe` -- that remains a genuine
   * infrastructure error (a dangling region reference), not a legitimate
   * capacity limit, and is unrelated to this method's capacity handling.
   *
   * A viewer never sees a fabricated or silently-dropped home for an
   * unplaced outcome: callers (see `ProductionSceneGraph.presentedHomeInput`)
   * create no actor for it, because there is no legal plot to draw one at
   * -- but the home is not swallowed. `unplacedHomeDiagnostics` and
   * `shelterCapacityFor` make the fact and its cause observable (surfaced
   * at `ProductionSceneGraphDebugSnapshot.placement`), and the home stays
   * present in simulation state, ready to be placed once a later phase
   * grows the region.
   */
  placeHome(home: HomeSnapshot): HomePlacementResult {
    const existing = this.homePlacements.get(home.home_id);
    if (existing) return { status: "placed", ...existing };
    const knownUnplaced = this.unplacedHomes.get(home.home_id);
    if (knownUnplaced) {
      return {
        status: "unplaced",
        homeId: knownUnplaced.homeId,
        regionId: knownUnplaced.regionId,
        reason: knownUnplaced.reason,
        // Region capacity is static once recipes are constructed, so the
        // region that produced this record is guaranteed still known.
        capacity: this.shelterCapacityFor(knownUnplaced.regionId)!,
      };
    }
    const recipe = this.requireRecipe(home.region);
    const occupied = this.occupiedPlotsFor(home.region);
    const district = recipe.districts.find((candidate) =>
      candidate.shelterPlots.some((plot) => !occupied.has(plot.id)));
    const plot = district
      ? chooseByHash(district.shelterPlots, home.home_id, (candidate) => occupied.has(candidate.id))
      : null;
    if (!plot) {
      const record: UnplacedHome = Object.freeze({
        homeId: home.home_id,
        regionId: home.region,
        reason: "region-at-capacity",
      });
      this.unplacedHomes.set(home.home_id, record);
      return {
        status: "unplaced",
        homeId: record.homeId,
        regionId: record.regionId,
        reason: record.reason,
        capacity: this.shelterCapacityFor(home.region)!,
      };
    }
    const placement = { regionId: home.region, plotId: plot.id, door: tileCenter(plot.door) };
    this.homePlacements.set(home.home_id, placement);
    occupied.add(plot.id);
    this.markDistrict(home.region, district!.index);
    this.revision += 1;
    return { status: "placed", ...placement };
  }

  /** Allocate or causally reposition an agent according to checkpoint, travel, birth, and status rules. */
  placeAgent(agent: AgentSnapshot, context: AgentPlacementContext = {}): Readonly<AgentPlacement> {
    const existing = this.agentPlacements.get(agent.id);
    if (existing && (agent.status === "dead" || agent.status === "paralyzed")) return existing;
    const eligibleBirthReanchor = existing !== undefined
      && context.kind === "birth"
      && context.authoritativeColocation
      && context.allowProvisionalReanchor === true
      && this.provisionalAgentIds.has(agent.id)
      && (existing.anchorKind === "staging" || existing.anchorKind === "birth-fallback");
    if (existing && context.kind !== "arrival" && !eligibleBirthReanchor) return existing;
    const recipe = this.requireRecipe(agent.position);

    let placement: AgentPlacement;
    if (context.kind === "arrival") {
      const gate = findArrivalGate(recipe.gates, context.fromRegion, agent.position);
      if (!gate) throw new Error(`travel ${context.fromRegion} -> ${agent.position} is not authorized`);
      placement = this.arrivalPlacement(
        agent,
        context.fromRegion,
        gate.tile,
        recipe,
        existing,
        context.requestedFinal,
      );
    } else if (context.kind === "birth") {
      placement = this.birthPlacement(agent, context, recipe);
    } else {
      placement = this.stagingPlacement(agent, recipe, "staging");
    }

    if (existing) this.occupiedAgentPointsFor(existing.regionId).delete(pointKey(existing.point));
    this.agentPlacements.set(agent.id, placement);
    this.occupiedAgentPointsFor(placement.regionId).add(pointKey(placement.point));
    if (context.kind === undefined) this.provisionalAgentIds.add(agent.id);
    else this.provisionalAgentIds.delete(agent.id);
    this.revision += 1;
    return placement;
  }

  /**
   * Refresh a currently-allocated agent's anchor point to its true rendered
   * position once a walk genuinely completes.
   *
   * `placeAgent` only ever allocates a NEW point on arrival/birth/checkpoint
   * -- once staged, `.point` is otherwise a fixed anchor for the agent's
   * entire stay in a region, even while choreography (`presentation/
   * choreography/**`) walks the being all over that region beat after beat.
   * Every one of those choreography files reads `context.placement.agents
   * .get(id)?.point` as "where is this agent right now" to compute contact
   * routes, adjacent approach tiles, and orient-toward facings -- if that
   * point is stale, those computations silently target where the being
   * *used to* stand, not where it actually is, which is the root cause this
   * method exists to close (see the SpatialDirector module for the callers
   * that keep this in sync from confirmed route-arrival signals).
   *
   * No-op for an unknown agent id (defensive; nothing to refresh) or when
   * the point is unchanged (avoids a needless revision bump). Does not
   * change region, anchor provenance, or occupancy validity beyond keeping
   * the occupied-point index accurate for future allocation legality
   * checks.
   */
  updateAgentPoint(agentId: string, point: Vec2): void {
    const existing = this.agentPlacements.get(agentId);
    if (!existing || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
    if (existing.point.x === point.x && existing.point.y === point.y) return;
    this.occupiedAgentPointsFor(existing.regionId).delete(pointKey(existing.point));
    const next: AgentPlacement = { ...existing, point: { x: point.x, y: point.y } };
    this.agentPlacements.set(agentId, next);
    this.occupiedAgentPointsFor(next.regionId).add(pointKey(next.point));
    this.revision += 1;
  }

  /** Return a detached immutable snapshot safe for renderer consumers. */
  snapshot(): PlacementLedgerSnapshot {
    return {
      revision: this.revision,
      agents: new Map([...this.agentPlacements].map(([id, placement]) => [id, cloneAgentPlacement(placement)])),
      homes: new Map([...this.homePlacements].map(([id, placement]) => [id, cloneHomePlacement(placement)])),
      districtsByRegion: new Map(this.districtCounts),
    };
  }

  /**
   * The named region's live navigation grid, or `null` for an unregistered
   * region.
   *
   * Exposes the same collision buffer `isOpenTile`/`isLegalPoint` already
   * use internally, for callers outside the ledger that need to gate a
   * *candidate* point against real ground legality without duplicating this
   * ledger's terrain data or reaching around it via a parallel path -- e.g.
   * `ProductionSceneCommandResolver`'s coincident-target spread
   * (`SpatialDirector.spreadCoincidentTargets`), which must validate a
   * candidate ring point before choosing it rather than discover its
   * illegality after the fact (see `.superpowers/sdd/terrain-seam-report.md`
   * Concerns §1). The returned grid is this ledger's own frozen recipe grid,
   * never copied, so it is safe to read but must not be mutated.
   */
  navigationGridFor(regionId: string): NavigationGrid | null {
    return this.recipes.get(regionId)?.grid ?? null;
  }

  /**
   * Free/occupied/total shelter-plot counts for a known region, or `null`
   * for a region this ledger has no recipe for.
   *
   * O(1) and read-only: `total` reads the recipe's already-flattened
   * `shelterPlots` array length, `occupied` reads a `Set.size`, and unlike
   * the internal `occupiedPlotsFor` allocation helper this never lazily
   * creates a per-region entry as a side effect -- cheap and safe to
   * consult every frame, e.g. as the predicate for "does a legal shelter
   * plot remain in this region."
   */
  shelterCapacityFor(regionId: string): ShelterCapacitySnapshot | null {
    const recipe = this.recipes.get(regionId);
    if (!recipe) return null;
    const total = recipe.shelterPlots.length;
    const occupied = this.occupiedPlots.get(regionId)?.size ?? 0;
    return Object.freeze({
      regionId,
      total,
      occupied,
      free: total - occupied,
      atCapacity: occupied >= total,
    });
  }

  /**
   * Cheap yes/no predicate: does this region currently have at least one
   * legal shelter plot left? `false` for an unregistered region.
   */
  hasFreeShelterPlot(regionId: string): boolean {
    return (this.shelterCapacityFor(regionId)?.free ?? 0) > 0;
  }

  /**
   * Detached snapshot of every home this ledger could not place on a
   * shelter plot, keyed by home ID -- the diagnosable record behind an
   * `{ status: "unplaced" }` `placeHome` outcome.
   */
  unplacedHomeDiagnostics(): ReadonlyMap<string, Readonly<UnplacedHome>> {
    return new Map(this.unplacedHomes);
  }

  private birthPlacement(
    agent: AgentSnapshot,
    context: Extract<AgentPlacementContext, { kind: "birth" }>,
    recipe: RegionMapRecipeV1,
  ): AgentPlacement {
    const acceptor = this.agentPlacements.get(context.acceptorId);
    if (context.authoritativeColocation && acceptor?.regionId === agent.position) {
      const offsets: readonly Vec2[] = [
        { x: STANDING_HUMAN_VISUAL_ENVELOPE.width + AGENT_READABILITY_GAP, y: 0 },
        { x: -(STANDING_HUMAN_VISUAL_ENVELOPE.width + AGENT_READABILITY_GAP), y: 0 },
        { x: 0, y: STANDING_HUMAN_VISUAL_ENVELOPE.height + AGENT_READABILITY_GAP },
        { x: 0, y: -(STANDING_HUMAN_VISUAL_ENVELOPE.height + AGENT_READABILITY_GAP) },
      ];
      const occupied = this.occupiedAgentPointsFor(agent.position);
      const start = stableHash(agent.id) % offsets.length;
      const point = offsets
        .map((_, index) => offsets[(start + index) % offsets.length])
        .map((offset) => ({ x: acceptor.point.x + offset.x, y: acceptor.point.y + offset.y }))
        .find((candidate) => isLegalPoint(recipe, occupied, candidate));
      if (point) return { regionId: agent.position, point, anchorKind: `birth:${context.acceptorId}` };
    }
    return this.stagingPlacement(agent, recipe, "birth-fallback");
  }

  private stagingPlacement(agent: AgentSnapshot, recipe: RegionMapRecipeV1, anchorKind: string): AgentPlacement {
    const occupied = this.occupiedAgentPointsFor(agent.position);
    const district = recipe.districts.find((candidate) =>
      candidate.stagingPoints.some((point) => isLegalPoint(recipe, occupied, point)));
    const point = district
      ? chooseByHash(district.stagingPoints, agent.id, (candidate) =>
        !isLegalPoint(recipe, occupied, candidate))
      : null;
    if (!point) throw new Error(`region ${agent.position} has no free staging anchors`);
    this.markDistrict(agent.position, district!.index);
    return { regionId: agent.position, point: { ...point }, anchorKind };
  }

  private arrivalPlacement(
    agent: AgentSnapshot,
    fromRegion: string,
    gate: TileCoord,
    recipe: RegionMapRecipeV1,
    existing: AgentPlacement | undefined,
    requestedFinal: Vec2 | undefined,
  ): AgentPlacement {
    const occupied = new Set(this.occupiedAgentPointsFor(agent.position));
    if (existing?.regionId === agent.position) occupied.delete(pointKey(existing.point));
    const candidates = reachableTilesNear(recipe, gate, recipe.grid.columns * recipe.grid.rows);
    const requestedTile = requestedFinal === undefined
      ? null
      : candidates.find((candidate) => sameTile(candidate, navigationTileForFeet(requestedFinal))) ?? null;
    const usesRequestedFinal = requestedTile !== null && requestedFinal !== undefined
      && isLegalPoint(recipe, occupied, requestedFinal);
    const tile = usesRequestedFinal
      ? requestedTile
      : candidates.find((candidate) => isLegalPoint(recipe, occupied, tileCenter(candidate))) ?? null;
    if (!tile) throw new Error(`arrival gate ${fromRegion} -> ${agent.position} has no legal staging point`);
    return {
      regionId: agent.position,
      point: usesRequestedFinal ? { ...requestedFinal! } : tileCenter(tile),
      anchorKind: `arrival:${fromRegion}`,
    };
  }

  private requireRecipe(regionId: string): RegionMapRecipeV1 {
    const recipe = this.recipes.get(regionId);
    if (!recipe) throw new Error(`unknown placement region: ${regionId}`);
    return recipe;
  }

  private occupiedAgentPointsFor(regionId: string): Set<string> {
    let points = this.occupiedAgentPoints.get(regionId);
    if (!points) {
      points = new Set();
      this.occupiedAgentPoints.set(regionId, points);
    }
    return points;
  }

  private occupiedPlotsFor(regionId: string): Set<string> {
    let plots = this.occupiedPlots.get(regionId);
    if (!plots) {
      plots = new Set();
      this.occupiedPlots.set(regionId, plots);
    }
    return plots;
  }

  private markDistrict(regionId: string, districtIndex: number): void {
    this.districtCounts.set(regionId, Math.max(this.districtCounts.get(regionId) ?? 0, districtIndex + 1));
  }

  private copyStateFrom(source: PlacementLedger): void {
    this.agentPlacements.clear();
    for (const [id, placement] of source.agentPlacements) {
      this.agentPlacements.set(id, cloneAgentPlacement(placement));
    }
    this.homePlacements.clear();
    for (const [id, placement] of source.homePlacements) {
      this.homePlacements.set(id, cloneHomePlacement(placement));
    }
    this.occupiedAgentPoints.clear();
    for (const [regionId, points] of source.occupiedAgentPoints) {
      this.occupiedAgentPoints.set(regionId, new Set(points));
    }
    this.occupiedPlots.clear();
    for (const [regionId, plots] of source.occupiedPlots) {
      this.occupiedPlots.set(regionId, new Set(plots));
    }
    this.districtCounts.clear();
    for (const [regionId, count] of source.districtCounts) this.districtCounts.set(regionId, count);
    this.unplacedHomes.clear();
    for (const [id, record] of source.unplacedHomes) this.unplacedHomes.set(id, record);
    this.provisionalAgentIds.clear();
    for (const id of source.provisionalAgentIds) this.provisionalAgentIds.add(id);
    this.revision = source.revision;
  }
}

function chooseByHash<T>(
  values: readonly T[],
  id: string,
  isOccupied: (value: T) => boolean,
): T | null {
  if (values.length === 0) return null;
  const start = stableHash(id) % values.length;
  for (let offset = 0; offset < values.length; offset += 1) {
    const candidate = values[(start + offset) % values.length];
    if (!isOccupied(candidate)) return candidate;
  }
  return null;
}

function cloneAgentPlacement(placement: AgentPlacement): AgentPlacement {
  return { ...placement, point: { ...placement.point } };
}

function cloneHomePlacement(placement: HomePlacement): HomePlacement {
  return { ...placement, door: { ...placement.door } };
}

function pointKey(point: Vec2): string {
  return `${point.x},${point.y}`;
}

function samePoint(left: Vec2, right: Vec2): boolean {
  return left.x === right.x && left.y === right.y;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function reachableTilesNear(
  recipe: RegionMapRecipeV1,
  start: TileCoord,
  limit: number,
): TileCoord[] {
  const queue = [start];
  const seen = new Set([tileKey(start)]);
  const result: TileCoord[] = [];
  const deltas = [
    { column: 0, row: -1 }, { column: 1, row: 0 },
    { column: 0, row: 1 }, { column: -1, row: 0 },
  ] as const;
  while (queue.length > 0 && result.length < limit) {
    const current = queue.shift()!;
    if (isOpenTile(recipe, current)) result.push(current);
    for (const delta of deltas) {
      const next = { column: current.column + delta.column, row: current.row + delta.row };
      const key = tileKey(next);
      if (!seen.has(key) && isOpenTile(recipe, next)) {
        seen.add(key);
        queue.push(next);
      }
    }
  }
  return result;
}

function isLegalPoint(
  recipe: RegionMapRecipeV1,
  occupied: ReadonlySet<string>,
  point: Vec2,
): boolean {
  if (!Number.isSafeInteger(point.x) || !Number.isSafeInteger(point.y)) return false;
  const visual = feetAnchoredVisualRect(point);
  if (visual.x < 0 || visual.y < 0
      || visual.x + visual.width > recipe.grid.columns * 32
      || visual.y + visual.height > recipe.grid.rows * 32) return false;
  if (recipe.shelterPlots.some((plot) =>
    productionRectsOverlap(visual, shelterRenderRect(plot.tile)))) return false;
  if (!isOpenTile(recipe, navigationTileForFeet(point))) return false;
  // Separation is measured PERIODICALLY on a toroidal region. Two beings a few pixels
  // either side of a seam are neighbours there, not opposites, and the renderer's seam
  // continuation pass draws them next to each other — so the plain |dx| reading would let
  // two bodies overlap on screen while calling them maximally far apart.
  const width = recipe.grid.columns * TILE_SIZE;
  const height = recipe.grid.rows * TILE_SIZE;
  const toroidal = navigationGridIsToroidal(recipe.grid);
  const separation = (left: number, right: number, extent: number): number => {
    const raw = Math.abs(left - right);
    if (!toroidal) return raw;
    // Reduce into one period FIRST: a caller may legitimately hold a point more than one
    // world away (a parked/checkpoint anchor), and `extent - raw` would then go negative
    // and read as "touching".
    const wrapped = ((raw % extent) + extent) % extent;
    return Math.min(wrapped, extent - wrapped);
  };
  for (const key of occupied) {
    const [x, y] = key.split(",").map(Number);
    const horizontalGap = separation(point.x, x!, width);
    const verticalGap = separation(point.y, y!, height);
    if (
      horizontalGap < STANDING_HUMAN_VISUAL_ENVELOPE.width + AGENT_READABILITY_GAP
      && verticalGap < STANDING_HUMAN_VISUAL_ENVELOPE.height + AGENT_READABILITY_GAP
    ) return false;
  }
  return true;
}

function isOpenTile(recipe: RegionMapRecipeV1, tile: TileCoord): boolean {
  return tile.column >= 0 && tile.column < recipe.grid.columns &&
    tile.row >= 0 && tile.row < recipe.grid.rows &&
    recipe.grid.collision[tile.row * recipe.grid.columns + tile.column] === 0;
}

function sameTile(left: TileCoord, right: TileCoord): boolean {
  return left.column === right.column && left.row === right.row;
}

function tileKey(tile: TileCoord): string {
  return `${tile.column},${tile.row}`;
}

function deepFreezeOwned<T>(value: T): T {
  if (value === null || typeof value !== "object" || ArrayBuffer.isView(value)) return value;
  for (const item of Object.values(value as Record<string, unknown>)) deepFreezeOwned(item);
  return Object.freeze(value);
}
