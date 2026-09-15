import { describe, expect, it } from "vitest";

import type { SnapshotCheckpoint } from "../app/replayArtifacts";
import type {
  AgentSnapshot,
  EventEnvelopeEntry,
  HomeSnapshot,
  RegionSnapshot,
  WorldSnapshot,
} from "../app/schemas";
import { makeWorld } from "../test/fixtures";
import type { ClassifiedCheckpointRecord, FrameIdentity } from "./contracts";
import { PresentedWorldModel } from "./PresentedWorldModel";
import type { PresentedHoardThresholds } from "./PresentedEventProjector";
import {
  PRESENTED_EVENT_PAYLOAD_CASES,
  eventEntry,
  spatialTravelEntry,
} from "./eventPayloads.test";

describe("PresentedWorldModel", () => {
  it("retains immutable exact region pressure across projection and every snapshot replacement", () => {
    const initialPressure = [
      {
        region: "grove",
        population_high_water: 4,
        built_footprint_high_water: 2,
      },
      {
        region: "meadow",
        population_high_water: 8,
        built_footprint_high_water: 3,
      },
    ];
    const expectedInitialPressure = structuredClone(initialPressure);
    const input = makeWorld({ region_pressure: initialPressure });
    const model = new PresentedWorldModel(input, identity(input));
    const initialView = model.getView();

    input.region_pressure?.splice(0);
    const retainedPressure = initialView.regionPressure;
    expect(retainedPressure).toEqual(expectedInitialPressure);
    expect(retainedPressure).toBeDefined();
    if (retainedPressure === undefined) throw new Error("expected exact region pressure");
    expect(Object.isFrozen(retainedPressure)).toBe(true);
    expect(Object.isFrozen(retainedPressure[0])).toBe(true);

    model.applyEvidence([entryOf("agent_born", 5)]);
    expect(model.getView().regionPressure).toEqual(expectedInitialPressure);

    const reconciledPressure = expectedInitialPressure.map((pressure) => (
      pressure.region === "meadow"
        ? { ...pressure, population_high_water: 9 }
        : pressure
    ));
    const exactAtFive = makeWorld({
      event_cursor: 5,
      world_time: 13,
      region_pressure: reconciledPressure,
    });
    expect(model.reconcile(checkpoint(exactAtFive, 1)).applied).toBe(true);
    expect(model.getView().regionPressure).toEqual(reconciledPressure);

    const forwardPressure = reconciledPressure.map((pressure) => (
      pressure.region === "meadow"
        ? { ...pressure, built_footprint_high_water: 4 }
        : pressure
    ));
    model.replaceWithForwardSnapshot(
      makeWorld({
        event_cursor: 6,
        world_time: 14,
        region_pressure: forwardPressure,
      }),
      { firstCursor: 6, lastCursor: 6 },
    );
    expect(model.getView().regionPressure).toEqual(forwardPressure);

    const reset = makeWorld({
      run_id: "run-reset",
      event_cursor: 1,
      world_time: 1,
      region_pressure: [
        {
          region: "grove",
          population_high_water: 0,
          built_footprint_high_water: 0,
        },
        {
          region: "meadow",
          population_high_water: 1,
          built_footprint_high_water: 0,
        },
      ],
    });
    model.reset(reset, identity(reset, { sourceKey: "reset", revision: 1 }));
    expect(model.getView().regionPressure).toEqual(reset.region_pressure);
  });

  it("keeps reset exception-atomic when supplied pressure is malformed", () => {
    const initial = makeWorld();
    const model = new PresentedWorldModel(initial, identity(initial));
    model.applyEvidence([entryOf("self_talk", 5)]);
    const before = model.getView();

    const malformed = makeWorld({
      event_cursor: 1,
      world_time: 1,
      region_pressure: [{
        region: "meadow",
        population_high_water: 1,
        built_footprint_high_water: 1,
      }],
    });
    const replacementIdentity = identity(malformed, { revision: 2 });

    expect(() => model.reset(malformed, replacementIdentity)).toThrow(/region_pressure/);
    expect(model.getView()).toBe(before);
    expect(() => model.applyEvidence([entryOf("self_talk", 6)])).not.toThrow();

    const validRetry = makeWorld({
      event_cursor: 6,
      world_time: 14,
      region_pressure: [
        {
          region: "grove",
          population_high_water: 2,
          built_footprint_high_water: 1,
        },
        {
          region: "meadow",
          population_high_water: 3,
          built_footprint_high_water: 2,
        },
      ],
    });
    expect(() => model.reset(
      validRetry,
      identity(validRetry, { revision: 2 }),
    )).not.toThrow();
    expect(model.getView().regionPressure).toEqual(validRetry.region_pressure);
  });

  it("initializes every snapshot record as exact and validates reset identity", () => {
    const input = makeWorld();
    const model = new PresentedWorldModel(input, identity(input));
    const view = model.getView();

    expect(view).toMatchObject({ exactBaseCursor: 4, projectedThroughCursor: 4, worldTime: 12.5 });
    expect(view.agents.every(({ completeness }) => completeness === "exact")).toBe(true);
    expect(view.regions.every(({ completeness }) => completeness === "exact")).toBe(true);
    expect(view.homes.every(({ completeness }) => completeness === "exact")).toBe(true);
    expect(view.ruins.every(({ completeness }) => completeness === "exact")).toBe(true);
    expect(view.exactHomes).toEqual(input.homes);
    expect(view.exactRuins).toEqual(input.ruins);
    input.agents[0].energy = 999;
    input.regions[0].connections.push("forged");
    input.homes[0].stakeholders.push("forged");
    input.pending_proposals[0].resources.energy = 999;
    expect(model.getView()).toBe(view);
    expect(model.getView().agents[0].value.energy).toBe(84);
    expect(regionValue(model.getView(), "meadow").connections).toEqual(["grove"]);
    expect(model.getView().pendingProposals[0].resources.energy).toBe(8);

    expect(() => new PresentedWorldModel(makeWorld(), { ...identity(makeWorld()), runId: "wrong" })).toThrow();
    expect(() => new PresentedWorldModel(makeWorld(), { ...identity(makeWorld()), firstCursor: 3 })).toThrow();
  });

  it("atomically accepts a lower cursor only for a new run or source identity", () => {
    const model = new PresentedWorldModel(makeWorld(), identity(makeWorld(), { revision: 3 }));
    const before = model.getView();
    expect(() => model.reset(makeWorld(), identity(makeWorld(), { revision: 3 }))).toThrow();
    expect(model.getView()).toBe(before);

    const lower = makeWorld({ run_id: "run-b", event_cursor: 1, world_time: 2 });
    model.reset(lower, identity(lower, { sourceKey: "archive-b", revision: 0 }));
    expect(model.getView()).toMatchObject({ exactBaseCursor: 1, projectedThroughCursor: 1, worldTime: 2 });

    const higherRevision = makeWorld({ run_id: "run-b", event_cursor: 0, world_time: 1 });
    model.reset(higherRevision, identity(higherRevision, { sourceKey: "archive-b", revision: 1 }));
    expect(model.getView().exactBaseCursor).toBe(0);
  });

  it("rejects empty duplicate stale reordered and gapped evidence without mutation", () => {
    const invalidBatches: readonly EventEnvelopeEntry[][] = [
      [],
      [entryOf("speak", 4)],
      [entryOf("speak", 6)],
      [entryOf("speak", 5), entryOf("self_talk", 5)],
      [entryOf("speak", 5), entryOf("self_talk", 7)],
      [entryOf("speak", 6), entryOf("self_talk", 5)],
    ];

    for (const batch of invalidBatches) {
      const model = new PresentedWorldModel(makeWorld(), identity(makeWorld()));
      const before = model.getView();
      expect(() => model.applyEvidence(batch)).toThrow();
      expect(model.getView()).toBe(before);
    }
  });

  it("applies one contiguous evidence batch atomically and retains later rebase evidence", () => {
    const model = new PresentedWorldModel(makeWorld(), identity(makeWorld()));
    const result = model.applyEvidence([
      entryOf("agent_entered_region", 5),
      entryOf("resource_changed", 6),
    ]);
    expect(result).toMatchObject({ firstCursor: 5, lastCursor: 6 });
    expect(model.getView().projectedThroughCursor).toBe(6);
    expect(agentValue(model.getView(), "agent_001")).toMatchObject({ position: "grove", energy: 510 });

    const atFive = makeWorld({
      event_cursor: 5,
      world_time: 13,
      agents: makeWorld().agents.map((agent) => agent.id === "agent_001" ? { ...agent, position: "grove", energy: 79 } : agent),
    });
    expect(model.reconcile(checkpoint(atFive, 7)).applied).toBe(true);
    expect(model.getView().exactBaseCursor).toBe(5);
    expect(model.getView().projectedThroughCursor).toBe(6);
    expect(agentValue(model.getView(), "agent_001")).toMatchObject({ position: "grove", energy: 510, materials: 40 });

    const beforeMalformed = model.getView();
    const malformed = entryOf("resource_changed", 8);
    delete malformed.event.payload.agent_energy;
    expect(() => model.applyEvidence([entryOf("self_talk", 7), malformed])).toThrow();
    expect(model.getView()).toBe(beforeMalformed);
  });

  it("projects only atomic Nirvana travel samples and rejects an unknown destination without mutation", () => {
    const input = spatialNirvanaWorld();
    const model = new PresentedWorldModel(input, identity(input));

    model.applyEvidence([spatialTravelEntry("spatial_travel_started", 5)]);
    expect(agentValue(model.getView(), "agent_001").spatial).toMatchObject({
      x: 20,
      y: 40,
      travel: { id: "journey-east", destination_id: "east-gate" },
    });

    const beforeMalformed = model.getView();
    const malformed = spatialTravelEntry("spatial_travel_cancelled", 6);
    (malformed.event.payload as Record<string, unknown>).destination_id = "invented-landmark";
    expect(() => model.applyEvidence([malformed])).toThrow(/unknown map landmark/);
    expect(model.getView()).toBe(beforeMalformed);

    model.applyEvidence([spatialTravelEntry("spatial_travel_cancelled", 6)]);
    expect(agentValue(model.getView(), "agent_001").spatial).toMatchObject({
      x: 60,
      y: 40,
      travel: null,
    });
  });

  it("clears and restores lifecycle spatial authority before a checkpoint", () => {
    const input = spatialTransitionWorld();
    const model = new PresentedWorldModel(input, identity(input));

    const left = entryOf("agent_left_region", 5);
    left.event.payload = {
      ...left.event.payload,
      from_region: "nirvana",
      to_region: "warm_springs",
      spatial: null,
    };
    model.applyEvidence([left]);
    expect(agentValue(model.getView(), "agent_001")).toMatchObject({ position: "nirvana", spatial: undefined });

    const enteredLegacy = entryOf("agent_entered_region", 6);
    enteredLegacy.event.payload = {
      ...enteredLegacy.event.payload,
      from_region: "nirvana",
      to_region: "warm_springs",
      spatial: null,
    };
    model.applyEvidence([enteredLegacy]);
    expect(agentValue(model.getView(), "agent_001")).toMatchObject({ position: "warm_springs", spatial: undefined });

    const enteredNirvana = entryOf("agent_entered_region", 7);
    enteredNirvana.event.payload = {
      ...enteredNirvana.event.payload,
      from_region: "warm_springs",
      to_region: "nirvana",
      spatial: spatialLifecycleState(80, 40, 20),
    };
    model.applyEvidence([enteredNirvana]);
    expect(agentValue(model.getView(), "agent_001")).toMatchObject({
      position: "nirvana",
      spatial: { x: 80, y: 40, travel: null },
    });

    const born = entryOf("agent_born", 8);
    born.event.source = "agent_003";
    born.event.payload = {
      ...born.event.payload,
      region: "nirvana",
      spatial: spatialLifecycleState(96, 48, 21),
    };
    model.applyEvidence([born]);
    expect(agentValue(model.getView(), "agent_003")).toMatchObject({
      position: "nirvana",
      spatial: { x: 96, y: 48 },
    });

    const built = entryOf("home_built", 9);
    built.event.payload = {
      ...built.event.payload,
      builder_id: "agent_001",
      owner_id: "agent_001",
      region: "nirvana",
      stakeholders: ["agent_001"],
      home_spatial: {
        version: 1,
        region_id: "nirvana",
        map_id: "nirvana:test-layout",
        plot_id: "plot-before-checkpoint",
        x: 32,
        y: 64,
        door: { x: 32, y: 96 },
      },
    };
    model.applyEvidence([built]);
    expect(homeValue(model.getView(), "home_002")).toMatchObject({
      region: "nirvana",
      spatial: { plot_id: "plot-before-checkpoint", x: 32, y: 64 },
    });

    const beforeWrongMap = model.getView();
    const wrongMap = entryOf("agent_entered_region", 10);
    wrongMap.event.payload = {
      ...wrongMap.event.payload,
      from_region: "nirvana",
      to_region: "nirvana",
      spatial: { ...spatialLifecycleState(100, 40, 22), map_id: "nirvana:wrong" },
    };
    expect(() => model.applyEvidence([wrongMap])).toThrow(/projected regional map/);
    expect(model.getView()).toBe(beforeWrongMap);
  });

  it("records an authoritative cross-region gate handoff without inventing a route", () => {
    const input = spatialAllRegionWorld();
    const model = new PresentedWorldModel(input, identity(input));
    const left = entryOf("agent_left_region", 5);
    left.event.payload = {
      ...left.event.payload,
      from_region: "nirvana",
      to_region: "warm_springs",
      authoritative_spatial: true,
      spatial: null,
      source_position: { x: 120, y: 40 },
    };

    model.applyEvidence([left]);
    expect(agentValue(model.getView(), "agent_001")).toMatchObject({
      position: "nirvana",
      spatial: undefined,
      spatial_migration: {
        from_region: "nirvana",
        to_region: "warm_springs",
        source_position: { x: 120, y: 40 },
      },
    });

    const entered = entryOf("agent_entered_region", 6);
    entered.event.payload = {
      ...entered.event.payload,
      from_region: "nirvana",
      to_region: "warm_springs",
      authoritative_spatial: true,
      spatial: {
        version: 1,
        region_id: "warm_springs",
        map_id: "warm_springs:test-layout",
        layout_fingerprint: "test-layout",
        x: 32,
        y: 96,
        observed_at: 20,
        at_landmark: "west-arrival",
        travel: null,
      },
    };

    model.applyEvidence([entered]);
    expect(agentValue(model.getView(), "agent_001")).toMatchObject({
      position: "warm_springs",
      spatial: { region_id: "warm_springs", map_id: "warm_springs:test-layout", x: 32, y: 96 },
      spatial_migration: undefined,
    });
  });

  it("retains exact home partitions beside later rebased visible evidence", () => {
    const model = new PresentedWorldModel(makeWorld(), identity(makeWorld()));
    model.applyEvidence([
      entryOf("self_talk", 5),
      entryOf("ruins_scavenged", 6),
    ]);
    const exactAtFive = makeWorld({
      event_cursor: 5,
      world_time: 13,
      ruins: mutateHome(makeWorld().ruins, "home_old", { remnant_materials: 40 }),
    });

    expect(model.reconcile(checkpoint(exactAtFive, 7)).applied).toBe(true);
    const view = model.getView();
    expect(view.exactRuins?.find(({ home_id }) => home_id === "home_old")?.remnant_materials).toBe(40);
    expect(record(view.ruins, "home_id", "home_old")?.value.remnant_materials).toBe(7);
    expect(view.exactBaseCursor).toBe(5);
    expect(view.projectedThroughCursor).toBe(6);
  });

  it("atomically rejects a malformed birth resource map without publishing undefined child truth", () => {
    const model = new PresentedWorldModel(makeWorld(), identity(makeWorld()));
    const before = model.getView();
    const malformedBirth = entryOf("agent_born", 6);
    malformedBirth.event.payload = {
      ...malformedBirth.event.payload,
      child_resources: { materials: 3.2 },
    };

    expect(() => model.applyEvidence([
      entryOf("self_talk", 5),
      malformedBirth,
    ])).toThrow("child_resources");
    expect(model.getView()).toBe(before);
    expect(record(model.getView().agents, "id", "agent_003")).toBeUndefined();

    const accepted = model.applyEvidence([
      entryOf("self_talk", 5),
      entryOf("agent_born", 6),
    ]);
    expect(accepted.state.agents.get("agent_003")?.value.energy).toBe(12.8);
  });

  it("rejects archive-event and archive-manual checkpoints as live cuts", () => {
    const model = new PresentedWorldModel(makeWorld(), identity(makeWorld()));
    const changed = makeWorld({ world_time: 20, regions: mutateRegion(makeWorld(), "meadow", { current_energy: 99 }) });
    const before = model.getView();
    expect(model.reconcile(checkpoint(changed, 7, "archive-event"))).toEqual({
      applied: false,
      processed: true,
      disposition: "unsafe",
      line: 7,
      eventCursor: 4,
      correctionEntityIds: [],
    });
    expect(model.reconcile(checkpoint(changed, 8, "archive-manual"))).toEqual({
      applied: false,
      processed: true,
      disposition: "unsafe",
      line: 8,
      eventCursor: 4,
      correctionEntityIds: [],
    });
    expect(model.getView()).toBe(before);
    expect(model.reconcile(checkpoint(changed, 7))).toMatchObject({
      applied: true,
      processed: true,
      disposition: "applied",
    });
  });

  it("applies multiple same-cursor world-tick lines in line and nondecreasing-world-time order", () => {
    const model = new PresentedWorldModel(makeWorld(), identity(makeWorld()));
    const first = makeWorld({ world_time: 13, regions: mutateRegion(makeWorld(), "meadow", { current_energy: 70 }) });
    const second = makeWorld({ world_time: 14, regions: mutateRegion(makeWorld(), "meadow", { current_energy: 71 }) });
    expect(model.reconcile(checkpoint(first, 7)).applied).toBe(true);
    expect(model.reconcile(checkpoint(first, 7)).applied).toBe(false);
    expect(model.reconcile(checkpoint({ ...first, world_time: 12, }, 8)).applied).toBe(false);
    expect(model.reconcile(checkpoint(second, 9)).applied).toBe(true);
    expect(regionValue(model.getView(), "meadow").current_energy).toBe(71);
    expect(model.getView().worldTime).toBe(14);
  });

  it("classifies a future checkpoint as retryable without revealing future state", () => {
    const model = new PresentedWorldModel(makeWorld(), identity(makeWorld()));
    const future = makeWorld({ event_cursor: 5, world_time: 13, regions: mutateRegion(makeWorld(), "meadow", { current_energy: 99 }) });
    const before = model.getView();
    expect(model.reconcile(checkpoint(future, 7))).toEqual({
      applied: false,
      processed: false,
      disposition: "retryable-future",
      line: 7,
      eventCursor: 5,
      correctionEntityIds: [],
    });
    expect(model.getView()).toBe(before);
    model.applyEvidence([entryOf("self_talk", 5)]);
    expect(model.reconcile(checkpoint(future, 7))).toMatchObject({
      applied: true,
      processed: true,
      disposition: "applied",
    });
    expect(regionValue(model.getView(), "meadow").current_energy).toBe(99);
  });

  it("reports applied stale permanent-invalid and unsafe reconciliation dispositions", () => {
    const model = new PresentedWorldModel(makeWorld(), identity(makeWorld()));
    const current = makeWorld({ world_time: 13 });

    expect(model.reconcile(checkpoint(current, 2))).toMatchObject({
      applied: true,
      processed: true,
      disposition: "applied",
    });
    expect(model.reconcile(checkpoint(current, 2))).toMatchObject({
      applied: false,
      processed: true,
      disposition: "stale",
    });
    expect(model.reconcile(checkpoint(makeWorld({ run_id: "wrong-run" }), 3))).toMatchObject({
      applied: false,
      processed: true,
      disposition: "permanent-invalid",
    });
    expect(model.reconcile(checkpoint(current, 4, "archive-event"))).toMatchObject({
      applied: false,
      processed: true,
      disposition: "unsafe",
    });
  });

  it("replaces all agents regions homes ruins proposals time pools counters and silent removals", () => {
    const model = new PresentedWorldModel(makeWorld(), identity(makeWorld()));
    model.applyEvidence([entryOf("self_talk", 5)]);
    const exact = fullyDifferentWorld();
    const result = model.reconcile(checkpoint(exact, 12));
    const view = model.getView();

    expect(result.applied).toBe(true);
    expect(view).toMatchObject({ exactBaseCursor: 5, projectedThroughCursor: 5, worldTime: 99 });
    expect(view.agents).toEqual([{ completeness: "exact", value: exact.agents[0] }]);
    expect(view.regions).toEqual([{ completeness: "exact", value: exact.regions[0] }]);
    expect(view.homes).toEqual([{ completeness: "exact", value: exact.homes[0] }]);
    expect(view.ruins).toEqual([{ completeness: "exact", value: exact.ruins[0] }]);
    expect(view.pendingProposals).toEqual(exact.pending_proposals);
    expect(view.agents.some(({ value }) => value.id === "agent_002")).toBe(false);
    expect(view.ruins.some(({ value }) => value.home_id === "home_old")).toBe(false);
  });

  it("reconciles silent region regeneration", () => {
    const model = new PresentedWorldModel(makeWorld(), identity(makeWorld()));
    const changed = makeWorld({ world_time: 13, regions: mutateRegion(makeWorld(), "meadow", { current_energy: 65, current_materials: 22 }) });
    const before = model.getView();
    expect(model.reconcile(checkpoint(changed, 1))).toMatchObject({ applied: true, correctionEntityIds: ["meadow"] });
    expect(regionValue(model.getView(), "meadow")).toMatchObject({ current_energy: 65, current_materials: 22 });
    expect(before).toMatchObject({ worldTime: 12.5 });
  });

  it("reconciles silent vault withdrawal and ignores rejected withdrawal", () => {
    const model = new PresentedWorldModel(makeWorld(), identity(makeWorld()));
    const noChange = makeWorld({ world_time: 13 });
    expect(model.reconcile(checkpoint(noChange, 1))).toMatchObject({ applied: true, correctionEntityIds: [] });
    const withdrawn = makeWorld({
      world_time: 14,
      agents: mutateAgent(makeWorld(), "agent_001", { materials: 27 }),
      homes: mutateHome(makeWorld().homes, "home_001", { vault_materials: 9 }),
    });
    expect(model.reconcile(checkpoint(withdrawn, 2))).toMatchObject({ correctionEntityIds: ["agent_001", "home_001"] });
  });

  it("reconciles non-breaching batter damage costs and breachers", () => {
    const model = new PresentedWorldModel(makeWorld(), identity(makeWorld()));
    const changed = makeWorld({
      world_time: 13,
      agents: mutateAgent(makeWorld(), "agent_002", { energy: 1, materials: 0 }),
      homes: mutateHome(makeWorld().homes, "home_001", { integrity: 95, breachers: ["agent_002"] }),
    });
    expect(model.reconcile(checkpoint(changed, 1)).correctionEntityIds).toEqual(["agent_002", "home_001"]);
    expect(homeValue(model.getView(), "home_001")).toMatchObject({ integrity: 95, breachers: ["agent_002"] });
  });

  it("reconciles upkeep repair decay clocks and breacher clearing", () => {
    const world = makeWorld({ homes: mutateHome(makeWorld().homes, "home_001", { integrity: 95, breachers: ["agent_002"] }) });
    const model = new PresentedWorldModel(world, identity(world));
    const partialRepair = makeWorld({
      world_time: 13,
      homes: mutateHome(world.homes, "home_001", { integrity: 105, last_upkeep_at: 12, last_integrity_at: 12, breachers: ["agent_002"] }),
    });
    expect(model.reconcile(checkpoint(partialRepair, 1)).applied).toBe(true);
    expect(homeValue(model.getView(), "home_001").breachers).toEqual(["agent_002"]);
    const fullRepair = makeWorld({
      world_time: 14,
      homes: mutateHome(world.homes, "home_001", { integrity: 120, last_upkeep_at: 13, last_integrity_at: 13, breachers: [] }),
    });
    expect(model.reconcile(checkpoint(fullRepair, 2)).applied).toBe(true);
    expect(homeValue(model.getView(), "home_001")).toMatchObject({ integrity: 120, last_upkeep_at: 13, last_integrity_at: 13, breachers: [] });
  });

  it("reconciles owner death promotion proposal cleanup and integrity clamp", () => {
    const initial = makeWorld({
      homes: mutateHome(makeWorld().homes, "home_001", { stakeholders: ["agent_001", "agent_002"] }),
      agents: mutateAgent(makeWorld(), "agent_002", { home_id: "home_001" }),
    });
    const model = new PresentedWorldModel(initial, identity(initial));
    const ownerDeath = entryOf("agent_died", 5);
    ownerDeath.event.payload = {
      ...ownerDeath.event.payload,
      victim_id: "agent_001",
      victim_name: "Aster",
      killer_id: "agent_002",
      killer: "agent_002",
    };
    model.applyEvidence([ownerDeath]);
    const checkpointWorld = makeWorld({
      event_cursor: 5,
      world_time: 13,
      agents: mutateAgent(initial, "agent_001", { status: "dead", energy: 0, materials: 0, home_id: null, is_hoarding: false }),
      homes: mutateHome(initial.homes, "home_001", { owner_id: "agent_002", stakeholders: ["agent_002"], integrity: 100, max_integrity: 100 }),
      pending_proposals: [],
    });
    const result = model.reconcile(checkpoint(checkpointWorld, 1));
    expect(result.correctionEntityIds).toEqual(["home_001"]);
    expect(homeValue(model.getView(), "home_001")).toMatchObject({ owner_id: "agent_002", stakeholders: ["agent_002"], integrity: 100, max_integrity: 100 });
    expect(model.getView().pendingProposals).toEqual([]);
  });

  it("silently sweeps an expired ruin", () => {
    const model = new PresentedWorldModel(makeWorld(), identity(makeWorld()));
    const swept = makeWorld({ world_time: 140, ruins: [] });
    expect(model.reconcile(checkpoint(swept, 1))).toMatchObject({ applied: true, correctionEntityIds: ["home_old"] });
    expect(model.getView().ruins).toEqual([]);
  });

  it("reports sorted deduplicated final-view correction entity ids", () => {
    const model = new PresentedWorldModel(makeWorld(), identity(makeWorld()));
    const changed = makeWorld({
      world_time: 13,
      agents: mutateAgent(makeWorld(), "agent_002", { energy: 2 }),
      regions: mutateRegion(makeWorld(), "meadow", { current_energy: 64 }),
      homes: [],
      ruins: [...makeWorld().ruins, { ...makeWorld().homes[0], status: "ruin", ruined_at: 13 }],
      pending_proposals: [{ initiator_id: "agent_002", target_id: "agent_001", timestamp: 13, resources: { energy: 1 } }],
    });
    expect(model.reconcile(checkpoint(changed, 1)).correctionEntityIds).toEqual(["agent_002", "home_001", "meadow"]);
  });

  it("promotes newborn home collapse and proposal records from projected-partial to exact", () => {
    const model = new PresentedWorldModel(makeWorld(), identity(makeWorld()));
    const born = entryOf("agent_born", 5);
    const built = entryOf("home_built", 6);
    built.event.payload = { ...built.event.payload, builder_id: "agent_003", owner_id: "agent_003" };
    const collapsed = entryOf("home_collapsed", 7);
    collapsed.event.payload = { ...collapsed.event.payload, home_id: "home_002", target_home: "home_002", owner_id: "agent_003", region: "grove", stakeholders: ["agent_003"] };
    model.applyEvidence([born, built, collapsed]);
    expect(record(model.getView().agents, "id", "agent_003")?.completeness).toBe("projected-partial");
    expect(record(model.getView().ruins, "home_id", "home_002")?.completeness).toBe("projected-partial");

    const child: AgentSnapshot = { ...makeWorld().agents[0], id: "agent_003", name: "Cedar", persona: "new", position: "grove", energy: 12.8, materials: 3.2, home_id: null };
    const ruin: HomeSnapshot = { ...makeWorld().ruins[0], home_id: "home_002", owner_id: "agent_003", region: "grove", ruined_at: 30, remnant_materials: 21, stakeholders: [], breachers: [] };
    const exact = makeWorld({ event_cursor: 7, world_time: 31, agents: [...makeWorld().agents, child], ruins: [...makeWorld().ruins, ruin] });
    const correction = model.reconcile(checkpoint(exact, 1));
    expect(correction.correctionEntityIds).toEqual(["agent_003", "home_002"]);
    expect(record(model.getView().agents, "id", "agent_003")?.completeness).toBe("exact");
    expect(record(model.getView().ruins, "home_id", "home_002")?.completeness).toBe("exact");

    const proposalModel = new PresentedWorldModel(makeWorld({ pending_proposals: [] }), identity(makeWorld({ pending_proposals: [] })));
    proposalModel.applyEvidence([entryOf("mating_initiated", 5)]);
    expect(proposalModel.getView().pendingProposals[0].timestamp).toBeNull();
    const proposalExact = makeWorld({ event_cursor: 5, world_time: 21, pending_proposals: [{ initiator_id: "agent_001", target_id: "agent_002", timestamp: 19.75, resources: { energy: 8, materials: 2 } }] });
    proposalModel.reconcile(checkpoint(proposalExact, 1));
    expect(proposalModel.getView().pendingProposals[0].timestamp).toBe(19.75);
  });

  it("reconciles a communal exact-home collapse to the snapshot-derived ruin ceiling", () => {
    const initial = makeWorld({
      homes: makeWorld().homes.map((home) => home.home_id === "home_001"
        ? {
            ...home,
            stakeholders: ["agent_001", "agent_002"],
            max_integrity: 180,
          }
        : home),
      agents: mutateAgent(makeWorld(), "agent_002", { home_id: "home_001" }),
    });
    const model = new PresentedWorldModel(initial, identity(initial));
    const collapse = entryOf("home_collapsed", 5);
    collapse.event.payload = {
      ...collapse.event.payload,
      stakeholders: ["agent_001", "agent_002"],
    };

    const projected = model.applyEvidence([collapse]);
    expect(projected.unresolvedFields).toContain("ruins.home_001.max_integrity");
    expect(record(model.getView().ruins, "home_id", "home_001")).toMatchObject({
      completeness: "projected-partial",
      value: { max_integrity: 180 },
    });

    const exactRuin: HomeSnapshot = {
      ...initial.homes[0],
      max_integrity: 120,
      integrity: 0,
      stakeholders: [],
      vault_materials: 0,
      status: "ruin",
      ruined_at: 30,
      remnant_materials: 21,
      breachers: [],
      is_hoarding: false,
    };
    const exact = makeWorld({
      event_cursor: 5,
      world_time: 31,
      homes: [],
      ruins: [...initial.ruins, exactRuin],
      agents: initial.agents.map((agent) => ({ ...agent, home_id: null })),
    });

    model.reconcile(checkpoint(exact, 1));

    expect(record(model.getView().ruins, "home_id", "home_001")).toMatchObject({
      completeness: "exact",
      value: { max_integrity: 120, stakeholders: [] },
    });
  });

  it("hard-snaps forward and discards overlays only when snapshot reaches range end", () => {
    const model = new PresentedWorldModel(makeWorld(), identity(makeWorld()));
    model.applyEvidence([entryOf("agent_entered_region", 5)]);
    const before = model.getView();
    expect(() => model.replaceWithForwardSnapshot(makeWorld({ event_cursor: 6 }), { firstCursor: 7, lastCursor: 6 })).toThrow();
    expect(() => model.replaceWithForwardSnapshot(makeWorld({ event_cursor: 4 }), { firstCursor: 4, lastCursor: 4 })).toThrow();
    expect(() => model.replaceWithForwardSnapshot(makeWorld({ event_cursor: 6 }), { firstCursor: 6, lastCursor: 7 })).toThrow();
    expect(model.getView()).toBe(before);

    const forward = makeWorld({ event_cursor: 7, world_time: 20, agents: mutateAgent(makeWorld(), "agent_001", { position: "meadow", energy: 60 }) });
    model.replaceWithForwardSnapshot(forward, { firstCursor: 6, lastCursor: 7 });
    expect(model.getView()).toMatchObject({ exactBaseCursor: 7, projectedThroughCursor: 7, worldTime: 20 });
    expect(agentValue(model.getView(), "agent_001")).toMatchObject({ position: "meadow", energy: 60 });
    forward.agents[0].energy = 999;
    expect(agentValue(model.getView(), "agent_001").energy).toBe(60);
  });

  it("prepares, commits, and rolls back one forward replacement without exposing a draft", () => {
    const model = new PresentedWorldModel(makeWorld(), identity(makeWorld()));
    const retained = model.getView();
    const prepared = model.prepareForwardSnapshot(
      makeWorld({ event_cursor: 7, world_time: 20 }),
      { firstCursor: 5, lastCursor: 7 },
    );

    expect(model.getView()).toBe(retained);
    model.commitPreparedForwardSnapshot(prepared);
    expect(model.getView()).toMatchObject({ exactBaseCursor: 7, worldTime: 20 });
    model.rollbackPreparedForwardSnapshot(prepared);
    expect(model.getView()).toBe(retained);
    expect(() => model.commitPreparedForwardSnapshot(prepared)).toThrow(/stale/i);
  });

  it("disposes idempotently and rejects stale run work", () => {
    const model = new PresentedWorldModel(makeWorld(), identity(makeWorld()));
    const before = model.getView();
    expect(model.reconcile(checkpoint(makeWorld({ run_id: "wrong" }), 1)).applied).toBe(false);
    expect(model.getView()).toBe(before);
    model.dispose();
    model.dispose();
    expect(model.applyEvidence([entryOf("self_talk", 5)])).toMatchObject({ firstCursor: 4, lastCursor: 4 });
    expect(model.reconcile(checkpoint(makeWorld({ world_time: 13 }), 1)).applied).toBe(false);
    model.replaceWithForwardSnapshot(makeWorld({ event_cursor: 8 }), { firstCursor: 5, lastCursor: 8 });
    model.reset(makeWorld({ event_cursor: 0 }), identity(makeWorld({ event_cursor: 0 }), { revision: 2 }));
    expect(model.getView()).toBe(before);
  });

  it("detaches every returned batch-state map from current and future model state", () => {
    const model = new PresentedWorldModel(makeWorld(), identity(makeWorld()));
    const before = model.getView();
    const result = model.applyEvidence([entryOf("agent_entered_region", 5)]);

    mutateReturnedStateMaps(result.state);

    expect(model.getView().agents).toHaveLength(2);
    expect(model.getView().regions).toHaveLength(2);
    expect(model.getView().homes).toHaveLength(1);
    expect(model.getView().ruins).toHaveLength(1);
    expect(before.agents).toHaveLength(2);
    expect(before.regions).toHaveLength(2);
    expect(before.homes).toHaveLength(1);
    expect(before.ruins).toHaveLength(1);

    model.applyEvidence([entryOf("self_talk", 6)]);
    expect(agentValue(model.getView(), "agent_001").position).toBe("grove");
    expect(regionValue(model.getView(), "meadow").name).toBe("meadow");
    expect(homeValue(model.getView(), "home_001").home_id).toBe("home_001");
    expect(record(model.getView().ruins, "home_id", "home_old")).toBeDefined();
  });

  it("detaches every inert post-disposal batch-state map", () => {
    const model = new PresentedWorldModel(makeWorld(), identity(makeWorld()));
    const before = model.getView();
    model.dispose();

    const result = model.applyEvidence([entryOf("self_talk", 5)]);
    mutateReturnedStateMaps(result.state);

    const second = model.applyEvidence([entryOf("self_talk", 5)]);

    expect(model.getView()).toBe(before);
    expect(model.getView().agents).toHaveLength(2);
    expect(model.getView().regions).toHaveLength(2);
    expect(model.getView().homes).toHaveLength(1);
    expect(model.getView().ruins).toHaveLength(1);
    expect(second.state.agents.size).toBe(2);
    expect(second.state.regions.size).toBe(2);
    expect(second.state.homes.size).toBe(1);
    expect(second.state.ruins.size).toBe(1);
  });

  it("freezes validated active-run hoard thresholds per model instance", () => {
    const thresholds = {
      hoarding_energy_threshold: 1_000,
      hoarding_materials_threshold: 100,
    };
    const model = new PresentedWorldModel(makeWorld(), identity(makeWorld()), thresholds);
    thresholds.hoarding_energy_threshold = 1;
    thresholds.hoarding_materials_threshold = 1_000;

    const theft = entryOf("home_thieved", 5);
    theft.event.payload = { ...theft.event.payload, vault_materials: 150 };
    const result = model.applyEvidence([theft]);

    expect(result.state.homes.get("home_001")?.value.is_hoarding).toBe(true);
    expect(() => new PresentedWorldModel(
      makeWorld(),
      identity(makeWorld()),
      { hoarding_energy_threshold: 500, hoarding_materials_threshold: -1 },
    )).toThrow("threshold");
  });

  it("rejects model construction with either active hoard threshold missing", () => {
    const incompleteThresholds: readonly unknown[] = [
      {},
      { hoarding_energy_threshold: 500 },
      { hoarding_materials_threshold: 300 },
    ];

    for (const thresholds of incompleteThresholds) {
      expect(() => new PresentedWorldModel(
        makeWorld(),
        identity(makeWorld()),
        thresholds as PresentedHoardThresholds,
      )).toThrow(RangeError);
    }
  });

  it("preserves old views and unchanged records under copy-on-write", () => {
    const model = new PresentedWorldModel(makeWorld(), identity(makeWorld()));
    const before = model.getView();
    const beforeJson = JSON.stringify(before);
    const untouched = record(before.agents, "id", "agent_002");
    const result = model.applyEvidence([entryOf("agent_entered_region", 5)]);
    const after = model.getView();
    expect(after).not.toBe(before);
    expect(JSON.stringify(before)).toBe(beforeJson);
    expect(record(after.agents, "id", "agent_002")).toBe(untouched);
    expect(result.state.agents.get("agent_002")).toBe(untouched);

    expect(() => {
      (regionValue(after, "meadow").connections as string[]).push("forged");
    }).toThrow();
    expect(regionValue(model.getView(), "meadow").connections).toEqual(["grove"]);
  });
});

function identity(snapshot: WorldSnapshot, overrides: Partial<FrameIdentity> = {}): FrameIdentity {
  return {
    runId: snapshot.run_id,
    sourceKey: "live-a",
    revision: 1,
    firstCursor: snapshot.event_cursor,
    lastCursor: snapshot.event_cursor,
    ...overrides,
  };
}

function spatialNirvanaWorld(): WorldSnapshot {
  const base = makeWorld();
  return {
    ...base,
    agents: [{
      ...base.agents[0]!,
      position: "nirvana",
      spatial: {
        version: 1,
        region_id: "nirvana",
        map_id: "nirvana:test-layout",
        layout_fingerprint: "test-layout",
        x: 20,
        y: 40,
        observed_at: 10,
        at_landmark: null,
        travel: null,
      },
    }],
    regions: [{
      ...base.regions[0]!,
      name: "nirvana",
      connections: [],
      spatial: {
        version: 1,
        region_id: "nirvana",
        map_id: "nirvana:test-layout",
        layout_fingerprint: "test-layout",
        tile_size: 32,
        landmarks: [{ id: "east-gate", name: "East Gate", x: 120, y: 40, affordances: ["travel"] }],
        initial_pressure: { populationHighWater: 1, builtFootprintHighWater: 0 },
      },
    }],
    homes: [],
    ruins: [],
    region_pressure: [{ region: "nirvana", population_high_water: 1, built_footprint_high_water: 0 }],
    pending_proposals: [],
  };
}

function spatialTransitionWorld(): WorldSnapshot {
  const base = spatialNirvanaWorld();
  const nirvana = base.regions[0]!;
  const { spatial: _spatial, ...legacy } = nirvana;
  return {
    ...base,
    regions: [nirvana, { ...legacy, name: "warm_springs", connections: [] }],
    region_pressure: [
      ...base.region_pressure ?? [],
      { region: "warm_springs", population_high_water: 0, built_footprint_high_water: 0 },
    ],
  };
}

function spatialAllRegionWorld(): WorldSnapshot {
  const base = spatialNirvanaWorld();
  const source = base.regions[0]!;
  const sourceSpatial = source.spatial;
  if (sourceSpatial === undefined) throw new Error("missing source spatial map");
  const warmSprings: RegionSnapshot = {
    ...source,
    name: "warm_springs",
    description: "Hot springs with a west arrival gate.",
    connections: [],
    spatial: {
      ...sourceSpatial,
      region_id: "warm_springs",
      map_id: "warm_springs:test-layout",
      landmarks: [{
        id: "west-arrival",
        name: "West Arrival",
        x: 32,
        y: 96,
        affordances: ["travel"],
      }],
    },
  };
  return {
    ...base,
    regions: [source, warmSprings],
    region_pressure: [
      ...(base.region_pressure ?? []),
      { region: "warm_springs", population_high_water: 0, built_footprint_high_water: 0 },
    ],
  };
}

function spatialLifecycleState(x: number, y: number, observedAt: number) {
  return {
    version: 1,
    region_id: "nirvana",
    map_id: "nirvana:test-layout",
    layout_fingerprint: "test-layout",
    x,
    y,
    observed_at: observedAt,
    at_landmark: null,
    travel: null,
  } as const;
}

function checkpoint(
  snapshot: WorldSnapshot,
  line: number,
  safety: ClassifiedCheckpointRecord["safety"] = "safe-world-tick",
): ClassifiedCheckpointRecord {
  const checkpointValue: SnapshotCheckpoint = {
    schema: 1,
    type: "world_snapshot_checkpoint",
    reason: safety === "safe-world-tick" ? "world_tick" : safety === "archive-manual" ? "manual" : "event:speak",
    run_id: snapshot.run_id,
    world_time: snapshot.world_time,
    event_cursor: snapshot.event_cursor,
    snapshot,
  };
  return { line, checkpoint: checkpointValue, safety };
}

function entryOf(type: string, cursor: number): EventEnvelopeEntry {
  const eventCase = PRESENTED_EVENT_PAYLOAD_CASES.find((candidate) => candidate.type === type);
  if (!eventCase) throw new Error(`missing payload case ${type}`);
  return eventEntry(eventCase, cursor);
}

function mutateAgent(world: WorldSnapshot, id: string, patch: Partial<AgentSnapshot>): AgentSnapshot[] {
  return world.agents.map((agent) => agent.id === id ? { ...agent, ...patch } : agent);
}

function mutateRegion(world: WorldSnapshot, name: string, patch: Partial<RegionSnapshot>): RegionSnapshot[] {
  return world.regions.map((region) => region.name === name ? { ...region, ...patch } : region);
}

function mutateHome(homes: readonly HomeSnapshot[], id: string, patch: Partial<HomeSnapshot>): HomeSnapshot[] {
  return homes.map((home) => home.home_id === id ? { ...home, ...patch } : home);
}

function record<T>(
  records: readonly {
    readonly completeness: "exact" | "projected-partial";
    readonly value: Readonly<Partial<T>>;
  }[],
  key: keyof T,
  id: string,
) {
  return records.find((candidate) => candidate.value[key] === id);
}

function agentValue(view: ReturnType<PresentedWorldModel["getView"]>, id: string): Readonly<Partial<AgentSnapshot>> {
  const found = record(view.agents, "id", id);
  if (!found) throw new Error(`missing agent ${id}`);
  return found.value;
}

function regionValue(view: ReturnType<PresentedWorldModel["getView"]>, name: string): Readonly<Partial<RegionSnapshot>> {
  const found = record(view.regions, "name", name);
  if (!found) throw new Error(`missing region ${name}`);
  return found.value;
}

function homeValue(view: ReturnType<PresentedWorldModel["getView"]>, id: string): Readonly<Partial<HomeSnapshot>> {
  const found = record(view.homes, "home_id", id);
  if (!found) throw new Error(`missing home ${id}`);
  return found.value;
}

function fullyDifferentWorld(): WorldSnapshot {
  return {
    schema: 1,
    run_id: "seed-7-test",
    world_time: 99,
    event_cursor: 5,
    agents: [{
      id: "agent_new", name: "Nova", persona: "keeper", position: "delta", energy: 321,
      materials: 123, status: "dead", last_mated_at: 88, offspring_count: 9, died_at: 98,
      home_id: "home_new", is_hoarding: true,
    }],
    regions: [{
      name: "delta", description: "changed", connections: ["delta"], energy_rate: 9,
      materials_rate: 8, current_energy: 7, current_materials: 6, max_energy: 5, max_materials: 4,
    }],
    homes: [{
      home_id: "home_new", owner_id: "agent_new", region: "delta", integrity: 3, max_integrity: 4,
      built_at: 5, last_upkeep_at: 6, last_integrity_at: 7, stakeholders: ["agent_new"],
      vault_materials: 8, status: "standing", ruined_at: null, remnant_materials: 9,
      breachers: ["agent_other"], is_hoarding: true,
    }],
    ruins: [{
      home_id: "ruin_new", owner_id: "agent_other", region: "delta", integrity: 0, max_integrity: 10,
      built_at: 1, last_upkeep_at: 2, last_integrity_at: 3, stakeholders: [], vault_materials: 0,
      status: "ruin", ruined_at: 90, remnant_materials: 11, breachers: [], is_hoarding: false,
    }],
    pending_proposals: [{ initiator_id: "agent_new", target_id: "agent_other", timestamp: 97, resources: { energy: 2, materials: 3 } }],
  };
}

function mutateReturnedStateMaps(state: {
  readonly agents: ReadonlyMap<string, unknown>;
  readonly regions: ReadonlyMap<string, unknown>;
  readonly homes: ReadonlyMap<string, unknown>;
  readonly ruins: ReadonlyMap<string, unknown>;
}): void {
  for (const map of [state.agents, state.regions, state.homes, state.ruins]) {
    const mutable = map as Map<string, unknown>;
    const first = mutable.entries().next().value as [string, unknown] | undefined;
    mutable.set("forged", first?.[1]);
    if (first) mutable.delete(first[0]);
    mutable.clear();
  }
}
