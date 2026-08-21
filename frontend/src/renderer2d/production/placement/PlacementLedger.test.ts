import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { AgentSnapshot, HomeSnapshot, RegionSnapshot } from "../../../app/schemas";
import { createRegionMapIdentity } from "../maps/RegionMapIdentity";
import { createRegionMapRecipe } from "../maps/RegionMapRecipe";
import {
  STANDING_HUMAN_VISUAL_ENVELOPE,
  feetAnchoredVisualRect,
  shelterRenderRect,
} from "../productionGeometry";
import { PlacementLedger, type HomePlacementResult } from "./PlacementLedger";

const regions = [makeRegion("alpha", ["beta"]), makeRegion("beta", [])];
const recipes = regions.map((region) => createRegionMapRecipe(createRegionMapIdentity(11, region, regions)));

describe("PlacementLedger", () => {
  it("forks candidate allocations without mutating the source and commits atomically", () => {
    const ledger = PlacementLedger.reconstruct(recipes, {
      homes: [home(0, "alpha")],
      agents: [agent(0, "alpha")],
    });
    const before = ledger.snapshot();
    const candidate = ledger.fork();
    expect(candidate.sourceIdentity()).toBe(ledger.sourceIdentity());
    candidate.placeAgent(agent(1, "alpha"));
    candidate.placeHome(home(1, "alpha"));

    expect(ledger.snapshot()).toEqual(before);
    expect(candidate.snapshot().revision).toBe(before.revision + 2);
    ledger.commit(candidate);
    expect(ledger.snapshot()).toEqual(candidate.snapshot());

    const unrelated = PlacementLedger.reconstruct(recipes, { homes: [], agents: [] });
    expect(unrelated.sourceIdentity()).not.toBe(ledger.sourceIdentity());
    expect(() => ledger.commit(unrelated)).toThrow(/lineage/i);
  });

  it("checks checkpoint placement equivalence by membership and region only", () => {
    const sourceAgent = agent(0, "alpha");
    const sourceHome = home(0, "alpha");
    const ledger = PlacementLedger.reconstruct(recipes, {
      homes: [sourceHome],
      agents: [sourceAgent],
    });

    expect(ledger.hasEquivalentCheckpointPlacement({
      homes: [{ ...sourceHome, integrity: 12, vault_materials: 99 }],
      agents: [{ ...sourceAgent, energy: 1, materials: 999 }],
    })).toBe(true);
    expect(ledger.hasEquivalentCheckpointPlacement({
      homes: [sourceHome],
      agents: [sourceAgent, agent(1, "alpha")],
    })).toBe(false);
    expect(ledger.hasEquivalentCheckpointPlacement({
      homes: [{ ...sourceHome, region: "beta" }],
      agents: [sourceAgent],
    })).toBe(false);
    expect(ledger.hasEquivalentCheckpointPlacement({
      homes: [sourceHome],
      agents: [{ ...sourceAgent, position: "beta" }],
    })).toBe(false);
  });

  it("reconstructs checkpoint homes and agents deterministically regardless of array order", () => {
    const homes = Array.from({ length: 24 }, (_, index) => home(index, index % 2 ? "alpha" : "beta"));
    const agents = Array.from({ length: 48 }, (_, index) => agent(index, index % 2 ? "alpha" : "beta"));
    const left = PlacementLedger.reconstruct(recipes, { homes, agents }).snapshot();
    const right = PlacementLedger.reconstruct(recipes, { homes: [...homes].reverse(), agents: [...agents].reverse() }).snapshot();
    expect([...right.homes]).toEqual([...left.homes]);
    expect([...right.agents]).toEqual([...left.agents]);
    expect([...left.homes.keys()].slice(0, 5)).toEqual(["home_000", "home_007", "home_014", "home_021", "home_001"]);
  });

  it("allocates 256 agents and 128 homes through multiple districts without overlap", () => {
    const homes = Array.from({ length: 128 }, (_, index) => home(index, "alpha"));
    const agents = Array.from({ length: 256 }, (_, index) => agent(index, "alpha"));
    const snapshot = PlacementLedger.reconstruct(recipes, { homes, agents }).snapshot();
    expect(snapshot.homes.size).toBe(128);
    expect(snapshot.agents.size).toBe(256);
    expect(snapshot.districtsByRegion.get("alpha")).toBeGreaterThan(1);
    expect(new Set([...snapshot.homes.values()].map((placement) => placement.plotId))).toHaveLength(128);
    expect(new Set([...snapshot.agents.values()].map((placement) => `${placement.point.x},${placement.point.y}`))).toHaveLength(256);
    expectReadableAgentSpacing([...snapshot.agents.values()].map(({ point }) => point));
    const alpha = recipes.find((recipe) => recipe.regionId === "alpha")!;
    const plotById = new Map(alpha.shelterPlots.map((plot) => [plot.id, plot]));
    const standingShelters = [...snapshot.homes.values()].map(({ plotId }) =>
      shelterRenderRect(plotById.get(plotId)!.tile));
    for (const placement of snapshot.agents.values()) {
      const envelope = feetAnchoredVisualRect(placement.point);
      expect(standingShelters.some((shelter) => rectanglesOverlap(envelope, shelter))).toBe(false);
    }
  });

  it("reconstructs C07 idle actors without overlapping their visible human footprints", () => {
    const fixture = JSON.parse(readFileSync(resolve(
      process.cwd(),
      "../tests/frontend-app/fixtures/chronicles/data/C07-home-contest-thieve.json",
    ), "utf8"));
    const fixtureRegions = fixture.initialSnapshot.regions as RegionSnapshot[];
    const fixtureRecipes = fixtureRegions.map((region) => createRegionMapRecipe(
      createRegionMapIdentity(fixture.seed, region, fixtureRegions),
    ));
    const snapshot = PlacementLedger.reconstruct(fixtureRecipes, {
      agents: fixture.initialSnapshot.agents,
      homes: fixture.initialSnapshot.homes,
    }).snapshot();

    expect(fixture.id).toBe("C07");
    expectReadableAgentSpacing([...snapshot.agents.values()].map(({ point }) => point));
  });

  it("reconstructs the frozen C16 population and home pressure snapshot", () => {
    const fixture = JSON.parse(readFileSync(resolve(process.cwd(), "../tests/frontend-app/fixtures/chronicles/data/C16-pressure-4096-envelopes.json"), "utf8"));
    const fixtureRegions = fixture.initialSnapshot.regions as RegionSnapshot[];
    const fixtureRecipes = fixtureRegions.map((region) => createRegionMapRecipe(createRegionMapIdentity(fixture.seed, region, fixtureRegions)));
    const snapshot = PlacementLedger.reconstruct(fixtureRecipes, {
      agents: fixture.initialSnapshot.agents,
      homes: fixture.initialSnapshot.homes,
    }).snapshot();
    expect(fixture.id).toBe("C16");
    expect(snapshot.agents.size).toBe(256);
    expect(snapshot.homes.size).toBe(128);
    expect(Object.fromEntries(snapshot.districtsByRegion)).toEqual({
      nirvana: 3,
      nirvana_east: 2,
      nirvana_west: 2,
      warm_springs: 3,
    });
  });

  it("never moves old allocations when later homes, agents, and districts appear", () => {
    const ledger = PlacementLedger.reconstruct(recipes, {
      homes: Array.from({ length: 16 }, (_, index) => home(index, "alpha")),
      agents: Array.from({ length: 32 }, (_, index) => agent(index, "alpha")),
    });
    const before = ledger.snapshot();
    for (let index = 16; index < 128; index += 1) ledger.placeHome(home(index, "alpha"));
    for (let index = 32; index < 256; index += 1) ledger.placeAgent(agent(index, "alpha"));
    const after = ledger.snapshot();
    for (const [id, placement] of before.homes) expect(after.homes.get(id)).toEqual(placement);
    for (const [id, placement] of before.agents) expect(after.agents.get(id)).toEqual(placement);
  });

  it("expands homes and agents through districts in exact sequential order", () => {
    const ledger = PlacementLedger.reconstruct(recipes, { homes: [], agents: [] });
    const alpha = recipes.find((recipe) => recipe.regionId === "alpha")!;
    const districtZeroPlots = new Set(alpha.districts[0].shelterPlots.map((plot) => plot.id));
    const districtZeroPoints = new Set(alpha.districts[0].stagingPoints.map((point) => `${point.x},${point.y}`));
    for (let index = 0; index < 16; index += 1) {
      expect(districtZeroPlots.has(placedPlotId(ledger.placeHome(home(index, "alpha"))))).toBe(true);
      expect(ledger.snapshot().districtsByRegion.get("alpha")).toBe(1);
    }
    expect(placedPlotId(ledger.placeHome(home(16, "alpha")))).toContain("district-1");
    for (let index = 0; index < 32; index += 1) {
      const placement = ledger.placeAgent(agent(index, "alpha"));
      expect(districtZeroPoints.has(`${placement.point.x},${placement.point.y}`)).toBe(true);
    }
    expect(ledger.placeAgent(agent(32, "alpha")).point).toEqual(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }));
    expect(ledger.snapshot().districtsByRegion.get("alpha")).toBe(2);
  });

  it("places travel at the matching incoming gate and does not authorize an invented reverse trip", () => {
    const ledger = PlacementLedger.reconstruct(recipes, { homes: [], agents: [agent(0, "alpha")] });
    const moved = { ...agent(0, "beta"), id: "agent_000" };
    const placement = ledger.placeAgent(moved, { kind: "arrival", fromRegion: "alpha" });
    expect(placement.anchorKind).toBe("arrival:alpha");
    expect(() => ledger.placeAgent({ ...agent(1, "alpha"), id: "new_reverse" }, { kind: "arrival", fromRegion: "beta" }))
      .toThrow(/not authorized/);
  });

  it("commits a legal authored arrival endpoint as the next scene's durable origin", () => {
    const ledger = PlacementLedger.reconstruct(recipes, { homes: [], agents: [agent(0, "alpha")] });
    const beta = recipes.find((recipe) => recipe.regionId === "beta")!;
    const requestedFinal = beta.stagingPoints[0]!;
    const moved = { ...agent(0, "beta"), id: "agent_000" };

    const placement = ledger.placeAgent(moved, {
      kind: "arrival",
      fromRegion: "alpha",
      requestedFinal,
    });

    expect(placement).toEqual({
      regionId: "beta",
      point: requestedFinal,
      anchorKind: "arrival:alpha",
    });
    expect(ledger.snapshot().agents.get(moved.id)?.point).toEqual(requestedFinal);
    expect(requestedFinal.x % 32 === 16 && requestedFinal.y % 32 === 16).toBe(false);
  });

  it("stages repeated same-edge arrivals at distinct legal points around the matching gate", () => {
    const travelers = Array.from({ length: 12 }, (_, index) => agent(index, "alpha"));
    const ledger = PlacementLedger.reconstruct(recipes, { homes: [], agents: travelers });
    const beta = recipes.find((recipe) => recipe.regionId === "beta")!;
    const arrivals = travelers.map((traveler) => ledger.placeAgent({ ...traveler, position: "beta" }, { kind: "arrival", fromRegion: "alpha" }));
    expect(new Set(arrivals.map((placement) => `${placement.point.x},${placement.point.y}`))).toHaveLength(arrivals.length);
    for (const placement of arrivals) {
      const tile = { column: Math.floor(placement.point.x / 32), row: Math.floor(placement.point.y / 32) };
      expect(tile.column).toBeGreaterThanOrEqual(0);
      expect(tile.row).toBeGreaterThanOrEqual(0);
      expect(tile.column).toBeLessThan(beta.grid.columns);
      expect(tile.row).toBeLessThan(beta.grid.rows);
      expect(beta.grid.collision[tile.row * beta.grid.columns + tile.column]).toBe(0);
      expect(placement.anchorKind).toBe("arrival:alpha");
    }
  });

  it("places an authoritative co-located birth beside the acceptor and preserves fallen positions", () => {
    const acceptor = agent(4, "alpha");
    const fallen = { ...agent(5, "alpha"), status: "paralyzed" as const };
    const ledger = PlacementLedger.reconstruct(recipes, { homes: [], agents: [acceptor, fallen] });
    const acceptorPlacement = ledger.snapshot().agents.get(acceptor.id)!;
    const child = ledger.placeAgent({ ...agent(99, "alpha"), id: "child" }, {
      kind: "birth", acceptorId: acceptor.id, authoritativeColocation: true,
    });
    expect(child.anchorKind).toBe(`birth:${acceptor.id}`);
    expectReadableAgentSpacing([acceptorPlacement.point, child.point]);
    expect(Math.hypot(child.point.x - acceptorPlacement.point.x, child.point.y - acceptorPlacement.point.y))
      .toBe(26);

    const before = ledger.snapshot().agents.get(fallen.id)!;
    ledger.placeAgent({ ...fallen, position: "beta", status: "dead" });
    expect(ledger.snapshot().agents.get(fallen.id)).toEqual(before);
  });

  it("reanchors a provisional live staging placement only with explicit birth eligibility", () => {
    const acceptor = agent(4, "alpha");
    const established = agent(5, "alpha");
    const child = { ...agent(99, "alpha"), id: "child" };
    const ledger = PlacementLedger.reconstruct(recipes, {
      homes: [],
      agents: [acceptor, established],
    });
    const establishedBefore = ledger.snapshot().agents.get(established.id)!;
    const staging = ledger.placeAgent(child);

    expect(ledger.placeAgent(child, {
      kind: "birth",
      acceptorId: acceptor.id,
      authoritativeColocation: true,
    })).toEqual(staging);
    const born = ledger.placeAgent(child, {
      kind: "birth",
      acceptorId: acceptor.id,
      authoritativeColocation: true,
      allowProvisionalReanchor: true,
    });
    expect(born.anchorKind).toBe(`birth:${acceptor.id}`);
    expect(born).not.toEqual(staging);
    expect(ledger.placeAgent(child, {
      kind: "birth",
      acceptorId: established.id,
      authoritativeColocation: true,
      allowProvisionalReanchor: true,
    })).toEqual(born);
    expect(ledger.placeAgent(established, {
      kind: "birth",
      acceptorId: acceptor.id,
      authoritativeColocation: true,
      allowProvisionalReanchor: true,
    })).toEqual(establishedBefore);
  });

  it("falls back safely for a birth without authoritative co-location and diagnoses unknown regions", () => {
    const acceptor = agent(4, "alpha");
    const ledger = PlacementLedger.reconstruct(recipes, { homes: [], agents: [acceptor] });
    const child = ledger.placeAgent({ ...agent(99, "beta"), id: "remote_child" }, {
      kind: "birth", acceptorId: acceptor.id, authoritativeColocation: true,
    });
    expect(child.anchorKind).toBe("birth-fallback");
    expect(() => ledger.placeAgent({ ...agent(100, "missing"), id: "lost" })).toThrow(/unknown placement region/);
    expect(() => ledger.placeHome({ ...home(100, "missing"), home_id: "lost_home" })).toThrow(/unknown placement region/);
  });

  it("hashes isolated homes by home ID independently of build time", () => {
    const early = PlacementLedger.reconstruct(recipes, { homes: [home(3, "alpha")], agents: [] }).snapshot().homes.get("home_003");
    const late = PlacementLedger.reconstruct(recipes, { homes: [{ ...home(3, "alpha"), built_at: 9999 }], agents: [] }).snapshot().homes.get("home_003");
    expect(late).toEqual(early);
  });

  it("uses legal deterministic staging when all four birth-adjacent points are occupied", () => {
    const acceptor = agent(4, "alpha");
    const ledger = PlacementLedger.reconstruct(recipes, { homes: [], agents: [acceptor] });
    for (let index = 0; index < 4; index += 1) {
      ledger.placeAgent({ ...agent(200 + index, "alpha"), id: `child_${index}` }, {
        kind: "birth", acceptorId: acceptor.id, authoritativeColocation: true,
      });
    }
    const overflow = ledger.placeAgent({ ...agent(205, "alpha"), id: "child_overflow" }, {
      kind: "birth", acceptorId: acceptor.id, authoritativeColocation: true,
    });
    expect(overflow.anchorKind).toBe("birth-fallback");
    const points = [...ledger.snapshot().agents.values()].map((placement) => `${placement.point.x},${placement.point.y}`);
    expect(new Set(points)).toHaveLength(points.length);
  });

  it("keeps deep-lineage births unique, in bounds, and off hard collision", () => {
    const founder = agent(700, "alpha");
    const ledger = PlacementLedger.reconstruct(recipes, { homes: [], agents: [founder] });
    const alpha = recipes.find((recipe) => recipe.regionId === "alpha")!;
    let acceptorId = founder.id;
    for (let index = 0; index < 120; index += 1) {
      const child = { ...agent(800 + index, "alpha"), id: `lineage_${index}` };
      ledger.placeAgent(child, { kind: "birth", acceptorId, authoritativeColocation: true });
      acceptorId = child.id;
    }
    const lineage = [...ledger.snapshot().agents].filter(([id]) => id.startsWith("lineage_")).map(([, placement]) => placement);
    expect(new Set(lineage.map((placement) => `${placement.point.x},${placement.point.y}`))).toHaveLength(lineage.length);
    expectReadableAgentSpacing([...ledger.snapshot().agents.values()].map(({ point }) => point));
    for (const placement of lineage) {
      const tile = { column: Math.floor(placement.point.x / 32), row: Math.floor(placement.point.y / 32) };
      expect(tile.column).toBeGreaterThanOrEqual(0);
      expect(tile.row).toBeGreaterThanOrEqual(0);
      expect(tile.column).toBeLessThan(alpha.grid.columns);
      expect(tile.row).toBeLessThan(alpha.grid.rows);
      expect(alpha.grid.collision[tile.row * alpha.grid.columns + tile.column]).toBe(0);
    }
  });

  it("returns detached snapshot maps and values immune to source or consumer mutation", () => {
    const sourceAgent = agent(9, "alpha");
    const sourceHome = home(9, "alpha");
    const ledger = PlacementLedger.reconstruct(recipes, { homes: [sourceHome], agents: [sourceAgent] });
    const expected = ledger.snapshot();
    sourceAgent.position = "beta";
    sourceHome.region = "beta";
    const tampered = ledger.snapshot();
    (tampered.agents as Map<string, any>).get(sourceAgent.id).point.x = -999;
    (tampered.agents as Map<string, any>).clear();
    (tampered.homes as Map<string, any>).get(sourceHome.home_id).door.y = -999;
    expect(ledger.snapshot()).toEqual(expected);
  });

  it("deep-owns recipe topology, masks, anchors, and plots at the ledger boundary", () => {
    const localRegions = [makeRegion("origin", ["destination"]), makeRegion("destination", [])];
    const makeRecipes = () => localRegions.map((region) => createRegionMapRecipe(createRegionMapIdentity(812, region, localRegions)));
    const sourceRecipes = makeRecipes();
    const ledger = PlacementLedger.reconstruct(sourceRecipes, { homes: [], agents: [agent(999, "origin")] });
    const control = PlacementLedger.reconstruct(makeRecipes(), { homes: [], agents: [agent(999, "origin")] });

    for (const recipe of sourceRecipes as any[]) {
      recipe.grid.collision.fill(1);
      for (const anchor of recipe.stagingAnchors) { anchor.column = 63; anchor.row = 63; }
      for (const plot of recipe.shelterPlots) { plot.id = `poison:${plot.id}`; plot.door.column = 63; plot.door.row = 63; }
      for (const gate of recipe.gates) { gate.edge.from = "poison"; gate.edge.to = "poison"; gate.tile.column = 63; gate.tile.row = 63; }
    }

    expect(ledger.placeHome(home(999, "origin"))).toEqual(control.placeHome(home(999, "origin")));
    const moved = { ...agent(999, "destination"), id: "agent_999" };
    expect(ledger.placeAgent(moved, { kind: "arrival", fromRegion: "origin" }))
      .toEqual(control.placeAgent(moved, { kind: "arrival", fromRegion: "origin" }));
  });

  it("navigationGridFor exposes the named region's own live collision grid, and null for an unregistered region", () => {
    const ledger = PlacementLedger.reconstruct(recipes, { homes: [], agents: [] });
    const alphaRecipe = recipes.find((recipe) => recipe.regionId === "alpha")!;
    const grid = ledger.navigationGridFor("alpha");
    expect(grid).not.toBeNull();
    expect(grid).toEqual({
      columns: alphaRecipe.grid.columns,
      rows: alphaRecipe.grid.rows,
      collision: alphaRecipe.grid.collision,
      topology: alphaRecipe.grid.topology,
    });
    expect(ledger.navigationGridFor("nowhere")).toBeNull();
  });

  it("updateAgentPoint refreshes a live agent's anchor without disturbing region or provenance", () => {
    const ledger = PlacementLedger.reconstruct(recipes, { homes: [], agents: [agent(0, "alpha")] });
    const before = ledger.snapshot().agents.get("agent_000")!;
    const moved = { x: before.point.x + 40, y: before.point.y };
    ledger.updateAgentPoint("agent_000", moved);
    const after = ledger.snapshot();
    expect(after.agents.get("agent_000")).toEqual({ ...before, point: moved });
    expect(after.revision).toBeGreaterThan(ledger.snapshot().revision - 1);
  });

  it("updateAgentPoint is a no-op for an unknown agent id and for an unchanged point", () => {
    const ledger = PlacementLedger.reconstruct(recipes, { homes: [], agents: [agent(0, "alpha")] });
    const before = ledger.snapshot();
    ledger.updateAgentPoint("agent_missing", { x: 0, y: 0 });
    ledger.updateAgentPoint("agent_000", { ...before.agents.get("agent_000")!.point });
    expect(ledger.snapshot()).toEqual(before);
  });

  it("updateAgentPoint frees its old occupied slot for a later placement to legally reuse", () => {
    const alpha = recipes.find((recipe) => recipe.regionId === "alpha")!;
    const capacity = alpha.districts[0]!.stagingPoints.length;
    const agents = Array.from({ length: capacity }, (_, index) => agent(index, "alpha"));
    const ledger = PlacementLedger.reconstruct(recipes, { homes: [], agents });
    // Fully packed district 0: every staging slot is occupied.
    expect(ledger.snapshot().districtsByRegion.get("alpha")).toBe(1);
    const vacated = ledger.snapshot().agents.get("agent_000")!.point;
    ledger.updateAgentPoint("agent_000", { x: vacated.x + 10_000, y: vacated.y });
    // With exactly one slot now free in district 0, a new placement must land
    // precisely on the vacated slot -- proof updateAgentPoint released the
    // old occupancy entry instead of leaving a stale phantom reservation
    // that would have forced overflow into a second district.
    const placement = ledger.placeAgent(agent(capacity, "alpha"), { kind: "checkpoint" });
    expect(placement.point).toEqual(vacated);
    expect(ledger.snapshot().districtsByRegion.get("alpha")).toBe(1);
  });

  it("reports live shelter-plot capacity per region as a cheap, read-only predicate", () => {
    const ledger = PlacementLedger.reconstruct(recipes, {
      homes: Array.from({ length: 5 }, (_, index) => home(index, "alpha")),
      agents: [],
    });
    const alpha = recipes.find((recipe) => recipe.regionId === "alpha")!;
    expect(alpha.shelterPlots).toHaveLength(128);
    expect(ledger.shelterCapacityFor("alpha")).toEqual({
      regionId: "alpha", total: 128, occupied: 5, free: 123, atCapacity: false,
    });
    expect(ledger.hasFreeShelterPlot("alpha")).toBe(true);
    expect(ledger.shelterCapacityFor("beta")).toEqual({
      regionId: "beta", total: 128, occupied: 0, free: 128, atCapacity: false,
    });
    expect(ledger.shelterCapacityFor("nowhere")).toBeNull();
    expect(ledger.hasFreeShelterPlot("nowhere")).toBe(false);
    // Read-only: consulting an unpopulated region must not fabricate an entry.
    expect(ledger.snapshot().homes.size).toBe(5);
  });

  it("fills a region's 128 shelter plots and reports exhaustion as a typed state, never a throw", () => {
    const homes = Array.from({ length: 128 }, (_, index) => home(index, "alpha"));
    const ledger = PlacementLedger.reconstruct(recipes, { homes, agents: [] });
    expect(ledger.shelterCapacityFor("alpha")).toEqual({
      regionId: "alpha", total: 128, occupied: 128, free: 0, atCapacity: true,
    });
    expect(ledger.hasFreeShelterPlot("alpha")).toBe(false);

    const overflow = home(128, "alpha");
    let outcome: HomePlacementResult | null = null;
    expect(() => {
      outcome = ledger.placeHome(overflow);
    }).not.toThrow();
    expect(outcome).toEqual({
      status: "unplaced",
      homeId: "home_128",
      regionId: "alpha",
      reason: "region-at-capacity",
      capacity: { regionId: "alpha", total: 128, occupied: 128, free: 0, atCapacity: true },
    });
    // Idempotent: asking again returns the identical outcome from the
    // remembered record instead of re-scanning every district.
    expect(ledger.placeHome(overflow)).toEqual(outcome);
    expect(ledger.unplacedHomeDiagnostics().get("home_128")).toEqual({
      homeId: "home_128", regionId: "alpha", reason: "region-at-capacity",
    });
    // The overflow home never occupies a plot and never appears as placed.
    expect(ledger.snapshot().homes.has("home_128")).toBe(false);
    expect(ledger.snapshot().homes.size).toBe(128);
  });

  it("reconstruct survives a checkpoint with more homes than a region has shelter plots", () => {
    // Every home shares built_at so reconstruct's sort key collapses to
    // plain home-ID text order (index order, since IDs are zero-padded) --
    // that makes which two homes overflow, and thus the "byte-identical"
    // comparison below, deterministic and easy to state.
    const overflowHomes = Array.from({ length: 130 }, (_, index) => ({
      ...home(index, "alpha"), built_at: 0,
    }));
    let ledger: PlacementLedger | null = null;
    expect(() => {
      ledger = PlacementLedger.reconstruct(recipes, { homes: overflowHomes, agents: [] });
    }).not.toThrow();
    const snapshot = ledger!.snapshot();
    expect(snapshot.homes.size).toBe(128);
    const unplaced = ledger!.unplacedHomeDiagnostics();
    expect(unplaced.size).toBe(2);
    expect(new Set(unplaced.keys())).toEqual(new Set(["home_128", "home_129"]));
    for (const record of unplaced.values()) {
      expect(record.regionId).toBe("alpha");
      expect(record.reason).toBe("region-at-capacity");
    }

    // Byte-identical proof: the 128 homes that DO fit land on exactly the
    // same plots, chosen by the same untouched chooseByHash, as an
    // unstressed 128-home reconstruction -- overflow beyond capacity never
    // perturbs the earlier, legal choices.
    const unstressed = PlacementLedger.reconstruct(
      recipes,
      { homes: overflowHomes.slice(0, 128), agents: [] },
    ).snapshot();
    expect(unstressed.homes.size).toBe(128);
    for (const [id, placement] of unstressed.homes) {
      expect(snapshot.homes.get(id)).toEqual(placement);
    }
  });

  it("fork and commit carry unplaced-home diagnostics across the same lineage", () => {
    const homes = Array.from({ length: 128 }, (_, index) => home(index, "alpha"));
    const ledger = PlacementLedger.reconstruct(recipes, { homes, agents: [] });
    const candidate = ledger.fork();
    const overflow = home(128, "alpha");
    candidate.placeHome(overflow);
    expect(candidate.unplacedHomeDiagnostics().has("home_128")).toBe(true);
    expect(ledger.unplacedHomeDiagnostics().has("home_128")).toBe(false);
    ledger.commit(candidate);
    expect(ledger.unplacedHomeDiagnostics().has("home_128")).toBe(true);
  });
});

function makeRegion(name: string, connections: string[]): RegionSnapshot {
  return {
    name, connections, description: name === "alpha" ? "hot spring lakes" : "unknown coast",
    energy_rate: 1, materials_rate: 1, current_energy: 50, current_materials: 50,
    max_energy: 100, max_materials: 100,
  };
}

function agent(index: number, position: string): AgentSnapshot {
  return {
    id: `agent_${index.toString().padStart(3, "0")}`, name: `Agent ${index}`, persona: "",
    position, energy: 20, materials: 10, status: "alive", last_mated_at: null,
    offspring_count: 0, died_at: null, home_id: null, is_hoarding: false,
  };
}

function home(index: number, region: string): HomeSnapshot {
  return {
    home_id: `home_${index.toString().padStart(3, "0")}`, owner_id: `agent_${index.toString().padStart(3, "0")}`,
    region, integrity: 100, max_integrity: 100, built_at: index % 7, last_upkeep_at: 0,
    last_integrity_at: 0, stakeholders: [], vault_materials: 0, status: "standing",
    ruined_at: null, remnant_materials: 0, breachers: [], is_hoarding: false,
  };
}

function placedPlotId(result: HomePlacementResult): string {
  if (result.status !== "placed") throw new Error(`expected a placed home, got ${result.status}`);
  return result.plotId;
}

function expectReadableAgentSpacing(
  points: readonly Readonly<{ x: number; y: number }>[],
): void {
  for (let leftIndex = 0; leftIndex < points.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < points.length; rightIndex += 1) {
      const left = points[leftIndex]!;
      const right = points[rightIndex]!;
      const horizontalGap = Math.abs(left.x - right.x);
      const verticalGap = Math.abs(left.y - right.y);
      expect(
        horizontalGap >= STANDING_HUMAN_VISUAL_ENVELOPE.width + 4
          || verticalGap >= STANDING_HUMAN_VISUAL_ENVELOPE.height + 4,
        `human footprints overlap at ${left.x},${left.y} and ${right.x},${right.y}`,
      ).toBe(true);
    }
  }
}

function rectanglesOverlap(
  left: Readonly<{ x: number; y: number; width: number; height: number }>,
  right: Readonly<{ x: number; y: number; width: number; height: number }>,
): boolean {
  expect(STANDING_HUMAN_VISUAL_ENVELOPE.width).toBe(22);
  return left.x < right.x + right.width && left.x + left.width > right.x
    && left.y < right.y + right.height && left.y + left.height > right.y;
}
