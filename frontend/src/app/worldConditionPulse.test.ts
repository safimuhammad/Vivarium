import { describe, expect, it } from "vitest";

import { makeWorld } from "../test/fixtures";
import type {
  AgentSnapshot,
  HomeSnapshot,
  RegionSnapshot,
} from "./schemas";
import { summarizeWorldCondition } from "./worldConditionPulse";

describe("worldConditionPulse", () => {
  it("returns a waiting condition without snapshot state", () => {
    const summary = summarizeWorldCondition(null);

    expect(summary).toMatchObject({
      state: "waiting",
      headline: "Waiting for world",
      worldTime: null,
      eventCursor: null,
      totalBeingCount: 0,
      livingCount: 0,
      fallenCount: 0,
      returnedCount: 0,
      hoardingBeingCount: 0,
      care: {
        state: "none",
        fallenNearLivingCount: 0,
        fallenAloneCount: 0,
        label: "no fallen",
      },
      land: null,
      homes: {
        state: "none",
        keptHomeCount: 0,
        standingCount: 0,
        contestedCount: 0,
        wornCount: 0,
        ruinCount: 0,
        hoardingVaultCount: 0,
        livingWithStandingHomeCount: 0,
        livingWithoutStandingHomeCount: 0,
      },
      bonds: {
        state: "none",
        livingPairCount: 0,
        heldByFallenCount: 0,
        heldByReturnedCount: 0,
        missingParticipantCount: 0,
        pendingCount: 0,
        oldestAgeSeconds: null,
        oldestAgeLabel: "none",
      },
      metrics: [],
    });
    expect(summary.detail).toContain("Current condition");
  });

  it("summarizes durable life, land, home, ruin, and bond pressure from snapshot state", () => {
    const world = makeWorld({
      world_time: 92,
      agents: [
        agent({ id: "agent_001", status: "alive", is_hoarding: true }),
        agent({ id: "agent_002", status: "paralyzed" }),
        agent({ id: "agent_003", status: "dead" }),
      ],
      regions: [
        region({
          name: "warm_springs",
          current_energy: 90,
          current_materials: 80,
          max_energy: 130,
          max_materials: 130,
        }),
        region({
          name: "nirvana_west",
          current_energy: 15,
          current_materials: 0,
          max_energy: 50,
          max_materials: 10,
        }),
      ],
      homes: [
        home({ home_id: "home_001", integrity: 95, max_integrity: 120, breachers: ["agent_003"] }),
        home({ home_id: "home_002", integrity: 36, max_integrity: 187.5, is_hoarding: true }),
      ],
      ruins: [home({ home_id: "home_old", status: "ruin", integrity: 0, remnant_materials: 64 })],
      pending_proposals: [
        {
          initiator_id: "agent_001",
          target_id: "agent_002",
          timestamp: 12,
          resources: { energy: 8, materials: 2 },
        },
      ],
    });

    const summary = summarizeWorldCondition(world);

    expect(summary.state).toBe("strained");
    expect(summary.headline).toBe("Land under strain");
    expect(summary.worldTime).toBe(92);
    expect(summary.eventCursor).toBe(4);
    expect(summary.totalBeingCount).toBe(3);
    expect(summary.livingCount).toBe(1);
    expect(summary.fallenCount).toBe(1);
    expect(summary.returnedCount).toBe(1);
    expect(summary.hoardingBeingCount).toBe(1);
    expect(summary.care).toEqual({
      state: "near_life",
      fallenNearLivingCount: 1,
      fallenAloneCount: 0,
      label: "1 fallen near life",
    });
    expect(summary.land).toMatchObject({
      regionName: "nirvana_west",
      regionLabel: "nirvana west",
      percent: 25,
      state: "depleted",
      label: "nirvana west 25%",
      detail: "depleted pools",
    });
    expect(summary.land?.ratio).toBeCloseTo(15 / 60, 4);
    expect(summary.land?.energyRatio).toBeCloseTo(15 / 50, 4);
    expect(summary.land?.materialsRatio).toBe(0);
    expect(summary.homes).toEqual({
      state: "contested",
      keptHomeCount: 0,
      standingCount: 2,
      contestedCount: 1,
      wornCount: 1,
      ruinCount: 1,
      hoardingVaultCount: 1,
      livingWithStandingHomeCount: 1,
      livingWithoutStandingHomeCount: 0,
    });
    expect(summary.bonds).toEqual({
      state: "fallen",
      livingPairCount: 0,
      heldByFallenCount: 1,
      heldByReturnedCount: 0,
      missingParticipantCount: 0,
      pendingCount: 1,
      oldestAgeSeconds: 80,
      oldestAgeLabel: "1m 20s",
    });
    expect(summary.metrics).toEqual([
      {
        key: "life",
        label: "Life",
        value: "1 returned",
        detail: "1/3 living · 1 fallen near life · 1 hoarding",
        tone: "danger",
      },
      {
        key: "land",
        label: "Land",
        value: "nirvana west 25%",
        detail: "depleted pools",
        tone: "danger",
      },
      {
        key: "homes",
        label: "Homes",
        value: "1 contested",
        detail: "1 ruin · 1 heavy vault",
        tone: "danger",
      },
      {
        key: "bonds",
        label: "Bonds",
        value: "1 fallen offer",
        detail: "1 offer waits on fallen · oldest 1m 20s",
        tone: "gold",
      },
    ]);
  });

  it("selects depleted land deterministically and avoids raw underscore copy in labels", () => {
    const world = makeWorld({
      agents: [agent()],
      regions: [
        region({ name: "warm_springs", current_energy: 5, current_materials: 5, max_energy: 20, max_materials: 20 }),
        region({ name: "ash_field", current_energy: 10, current_materials: 0, max_energy: 20, max_materials: 20 }),
        region({ name: "bramble_grove", current_energy: 10, current_materials: 0, max_energy: 20, max_materials: 20 }),
      ],
      homes: [],
      ruins: [],
      pending_proposals: [],
    });

    const summary = summarizeWorldCondition(world);

    expect(summary.land).toMatchObject({
      regionName: "ash_field",
      regionLabel: "ash field",
      label: "ash field 25%",
    });
    expect(summary.land?.label).not.toContain("_");
    expect(summary.metrics.find((metric) => metric.key === "land")?.value).toBe("ash field 25%");
  });

  it("distinguishes fallen beings near life from fallen beings alone", () => {
    const world = makeWorld({
      agents: [
        agent({ id: "agent_001", status: "alive", position: "grove" }),
        agent({ id: "agent_002", status: "paralyzed", position: "grove" }),
        agent({ id: "agent_003", status: "paralyzed", position: "ridge" }),
        agent({ id: "agent_004", status: "dead", position: "ridge" }),
      ],
      regions: [region({ name: "grove" })],
      homes: [],
      ruins: [],
      pending_proposals: [],
    });

    const summary = summarizeWorldCondition(world);
    const lifeMetric = summary.metrics.find((metric) => metric.key === "life");

    expect(summary.care).toEqual({
      state: "mixed",
      fallenNearLivingCount: 1,
      fallenAloneCount: 1,
      label: "1 near life · 1 alone",
    });
    expect(summary.fallenCount).toBe(2);
    expect(summary.returnedCount).toBe(1);
    expect(lifeMetric).toMatchObject({
      value: "1 returned",
      detail: "1/4 living · 1 near life · 1 alone",
      tone: "danger",
    });
    expect(summary.detail).not.toMatch(/agent_/);
  });

  it("uses care copy as the Life value when fallen beings are the visible pressure", () => {
    const world = makeWorld({
      agents: [
        agent({ id: "agent_001", status: "alive", position: "meadow" }),
        agent({ id: "agent_002", status: "paralyzed", position: "meadow" }),
      ],
      regions: [region()],
      homes: [],
      ruins: [],
      pending_proposals: [],
    });

    const summary = summarizeWorldCondition(world);

    expect(summary.care).toEqual({
      state: "near_life",
      fallenNearLivingCount: 1,
      fallenAloneCount: 0,
      label: "1 fallen near life",
    });
    expect(summary.metrics.find((metric) => metric.key === "life")?.value).toBe("1 fallen near life");
    expect(summary.detail).toContain("Life: 1 fallen near life");
  });

  it("counts fallen beings with empty positions as alone without matching empty living positions", () => {
    const world = makeWorld({
      agents: [
        agent({ id: "agent_001", status: "alive", position: "   " }),
        agent({ id: "agent_002", status: "paralyzed", position: "" }),
      ],
      regions: [region()],
      homes: [],
      ruins: [],
      pending_proposals: [],
    });

    const summary = summarizeWorldCondition(world);

    expect(summary.care).toEqual({
      state: "alone",
      fallenNearLivingCount: 0,
      fallenAloneCount: 1,
      label: "1 fallen alone",
    });
    expect(summary.metrics.find((metric) => metric.key === "life")?.value).toBe("1 fallen alone");
  });

  it("sanitizes backend vocabulary from visible condition labels", () => {
    const world = makeWorld({
      agents: [agent()],
      regions: [
        region({
          name: "simulation_spawn",
          current_energy: 10,
          current_materials: 8,
          max_energy: 40,
          max_materials: 40,
        }),
      ],
      homes: [],
      ruins: [],
      pending_proposals: [],
    });

    const summary = summarizeWorldCondition(world);

    expect(summary.land).toMatchObject({
      regionName: "simulation_spawn",
      regionLabel: "world birth",
      label: "world birth 23%",
    });
    expect(summary.detail).toContain("Land: world birth 23%");
    expect(summary.detail).not.toMatch(/\b(simulation|spawn|agent|llm|npc)\b/i);
  });

  it("handles zero-cap regions and invalid timestamps without NaN condition copy", () => {
    const world = makeWorld({
      world_time: 30,
      agents: [agent()],
      regions: [
        region({
          name: "empty_basin",
          current_energy: 1,
          current_materials: 1,
          max_energy: 0,
          max_materials: 0,
        }),
      ],
      homes: [home({ integrity: Number.NaN, max_integrity: 0 })],
      ruins: [],
      pending_proposals: [
        {
          initiator_id: "agent_001",
          target_id: "agent_002",
          timestamp: null,
          resources: {},
        },
      ],
    });

    const summary = summarizeWorldCondition(world);

    expect(summary.land).toMatchObject({
      regionName: "empty_basin",
      regionLabel: "empty basin",
      ratio: null,
      percent: null,
      energyRatio: null,
      materialsRatio: null,
      state: "unknown",
      label: "empty basin",
      detail: "unknown pools",
    });
    expect(summary.homes.wornCount).toBe(0);
    expect(summary.bonds).toEqual({
      state: "missing",
      livingPairCount: 0,
      heldByFallenCount: 0,
      heldByReturnedCount: 0,
      missingParticipantCount: 1,
      pendingCount: 1,
      oldestAgeSeconds: null,
      oldestAgeLabel: "new",
    });
    expect(summary.detail).not.toMatch(/NaN|Infinity|_/);
  });

  it("reports no bond readiness when there are no pending offers", () => {
    const world = makeWorld({
      agents: [agent(), agent({ id: "agent_002", status: "alive" })],
      pending_proposals: [],
    });

    const summary = summarizeWorldCondition(world);

    expect(summary.bonds).toEqual({
      state: "none",
      livingPairCount: 0,
      heldByFallenCount: 0,
      heldByReturnedCount: 0,
      missingParticipantCount: 0,
      pendingCount: 0,
      oldestAgeSeconds: null,
      oldestAgeLabel: "new",
    });
    expect(summary.metrics.find((metric) => metric.key === "bonds")).toMatchObject({
      value: "quiet",
      detail: "no open offers",
    });
  });

  it("marks bond readiness when both proposal participants are living", () => {
    const world = makeWorld({
      world_time: 40,
      agents: [agent(), agent({ id: "agent_002", status: "alive" })],
      pending_proposals: [
        {
          initiator_id: "agent_001",
          target_id: "agent_002",
          timestamp: 10,
          resources: {},
        },
      ],
    });

    const summary = summarizeWorldCondition(world);

    expect(summary.bonds).toMatchObject({
      state: "ready",
      livingPairCount: 1,
      heldByFallenCount: 0,
      heldByReturnedCount: 0,
      missingParticipantCount: 0,
      pendingCount: 1,
      oldestAgeSeconds: 30,
      oldestAgeLabel: "30s",
    });
    expect(summary.metrics.find((metric) => metric.key === "bonds")).toMatchObject({
      value: "1 living offer",
      detail: "1 offer between living beings · oldest 30s",
    });
  });

  it("marks bond offers held by fallen participants", () => {
    const world = makeWorld({
      world_time: 70,
      agents: [agent(), agent({ id: "agent_002", status: "paralyzed" })],
      pending_proposals: [
        {
          initiator_id: "agent_001",
          target_id: "agent_002",
          timestamp: 10,
          resources: {},
        },
      ],
    });

    const summary = summarizeWorldCondition(world);

    expect(summary.bonds).toMatchObject({
      state: "fallen",
      livingPairCount: 0,
      heldByFallenCount: 1,
      heldByReturnedCount: 0,
      missingParticipantCount: 0,
      oldestAgeSeconds: 60,
      oldestAgeLabel: "1m",
    });
    expect(summary.metrics.find((metric) => metric.key === "bonds")?.value).toBe("1 fallen offer");
  });

  it("marks bond offers held by returned participants", () => {
    const world = makeWorld({
      world_time: 75,
      agents: [agent(), agent({ id: "agent_002", status: "dead" })],
      pending_proposals: [
        {
          initiator_id: "agent_001",
          target_id: "agent_002",
          timestamp: 12,
          resources: {},
        },
      ],
    });

    const summary = summarizeWorldCondition(world);

    expect(summary.bonds).toMatchObject({
      state: "returned",
      livingPairCount: 0,
      heldByFallenCount: 0,
      heldByReturnedCount: 1,
      missingParticipantCount: 0,
      oldestAgeSeconds: 63,
      oldestAgeLabel: "1m 3s",
    });
    expect(summary.metrics.find((metric) => metric.key === "bonds")?.value).toBe("1 returned offer");
  });

  it("marks bond offers with missing participants without exposing raw ids", () => {
    const world = makeWorld({
      world_time: 50,
      agents: [agent()],
      pending_proposals: [
        {
          initiator_id: "agent_001",
          target_id: "agent_404",
          timestamp: 20,
          resources: {},
        },
      ],
    });

    const summary = summarizeWorldCondition(world);
    const bondsMetric = summary.metrics.find((metric) => metric.key === "bonds");

    expect(summary.bonds).toMatchObject({
      state: "missing",
      livingPairCount: 0,
      heldByFallenCount: 0,
      heldByReturnedCount: 0,
      missingParticipantCount: 1,
      oldestAgeSeconds: 30,
      oldestAgeLabel: "30s",
    });
    expect(bondsMetric).toMatchObject({
      value: "1 missing offer",
      detail: "1 offer missing participant · oldest 30s",
    });
    expect(`${bondsMetric?.value} ${bondsMetric?.detail} ${summary.detail}`).not.toMatch(/agent_/);
  });

  it("reports mixed bond readiness categories while preserving oldest age", () => {
    const world = makeWorld({
      world_time: 200,
      agents: [
        agent({ id: "agent_001", status: "alive" }),
        agent({ id: "agent_002", status: "alive" }),
        agent({ id: "agent_003", status: "paralyzed" }),
        agent({ id: "agent_004", status: "dead" }),
      ],
      pending_proposals: [
        {
          initiator_id: "agent_001",
          target_id: "agent_002",
          timestamp: 150,
          resources: {},
        },
        {
          initiator_id: "agent_001",
          target_id: "agent_003",
          timestamp: 120,
          resources: {},
        },
        {
          initiator_id: "agent_001",
          target_id: "agent_004",
          timestamp: 60,
          resources: {},
        },
        {
          initiator_id: "agent_001",
          target_id: "agent_missing",
          timestamp: 199,
          resources: {},
        },
      ],
    });

    const summary = summarizeWorldCondition(world);

    expect(summary.bonds).toEqual({
      state: "mixed",
      livingPairCount: 1,
      heldByFallenCount: 1,
      heldByReturnedCount: 1,
      missingParticipantCount: 1,
      pendingCount: 4,
      oldestAgeSeconds: 140,
      oldestAgeLabel: "2m 20s",
    });
    expect(summary.metrics.find((metric) => metric.key === "bonds")).toMatchObject({
      value: "4 offers mixed",
      detail: "1 offer between living beings · 1 offer waits on fallen · 1 offer waits on returned · 1 offer missing participant · oldest 2m 20s",
    });
  });

  it("reports a steady world when snapshot pressure is quiet", () => {
    const world = makeWorld({
      agents: [agent({ status: "alive" }), agent({ id: "agent_002", status: "alive" })],
      regions: [region({ current_energy: 90, current_materials: 90, max_energy: 100, max_materials: 100 })],
      homes: [home({ integrity: 120, max_integrity: 120, breachers: [], is_hoarding: false })],
      ruins: [],
      pending_proposals: [],
    });

    const summary = summarizeWorldCondition(world);

    expect(summary.state).toBe("steady");
    expect(summary.headline).toBe("World steady");
    expect(summary.metrics.map((metric) => [metric.key, metric.value, metric.tone])).toEqual([
      ["life", "all standing", "steady"],
      ["land", "meadow 90%", "steady"],
      ["homes", "1 kept home", "steady"],
      ["bonds", "quiet", "steady"],
    ]);
  });

  it("reports empty home readiness while waiting for snapshot state", () => {
    const summary = summarizeWorldCondition(undefined);

    expect(summary.homes).toEqual({
      state: "none",
      keptHomeCount: 0,
      standingCount: 0,
      contestedCount: 0,
      wornCount: 0,
      ruinCount: 0,
      hoardingVaultCount: 0,
      livingWithStandingHomeCount: 0,
      livingWithoutStandingHomeCount: 0,
    });
    expect(summary.metrics).toEqual([]);
  });

  it("counts a living being with a standing home_id as having hearth readiness", () => {
    const world = makeWorld({
      agents: [agent({ id: "agent_001", status: "alive", home_id: "home_001" })],
      homes: [home({ home_id: "home_001", stakeholders: [] })],
      ruins: [],
      pending_proposals: [],
    });

    const summary = summarizeWorldCondition(world);

    expect(summary.homes).toMatchObject({
      state: "kept",
      keptHomeCount: 1,
      standingCount: 1,
      livingWithStandingHomeCount: 1,
      livingWithoutStandingHomeCount: 0,
    });
    expect(summary.metrics.find((metric) => metric.key === "homes")).toMatchObject({
      value: "1 kept home",
      detail: "1 with hearth",
      tone: "steady",
    });
  });

  it("counts a living stakeholder in a standing home as having hearth readiness", () => {
    const world = makeWorld({
      agents: [agent({ id: "agent_002", status: "alive", home_id: null })],
      homes: [home({ home_id: "home_001", stakeholders: ["agent_002"] })],
      ruins: [],
      pending_proposals: [],
    });

    const summary = summarizeWorldCondition(world);

    expect(summary.homes).toMatchObject({
      state: "kept",
      livingWithStandingHomeCount: 1,
      livingWithoutStandingHomeCount: 0,
    });
    expect(summary.metrics.find((metric) => metric.key === "homes")?.value).toBe("1 kept home");
  });

  it("counts living beings without a current standing home relationship as without hearth", () => {
    const world = makeWorld({
      agents: [
        agent({ id: "agent_no_home", status: "alive", home_id: null }),
        agent({ id: "agent_missing_home", status: "alive", home_id: "home_missing" }),
        agent({ id: "agent_ruined_home", status: "alive", home_id: "home_ruin" }),
        agent({ id: "agent_non_standing_home", status: "alive", home_id: "home_non_standing" }),
        agent({ id: "agent_fallen", status: "paralyzed", home_id: null }),
        agent({ id: "agent_returned", status: "dead", home_id: null }),
      ],
      homes: [home({ home_id: "home_non_standing", status: "ruin", stakeholders: [] })],
      ruins: [home({ home_id: "home_ruin", status: "ruin", stakeholders: [] })],
      pending_proposals: [],
    });

    const summary = summarizeWorldCondition(world);
    const homesMetric = summary.metrics.find((metric) => metric.key === "homes");

    expect(summary.homes).toMatchObject({
      state: "without_hearth",
      standingCount: 0,
      livingWithStandingHomeCount: 0,
      livingWithoutStandingHomeCount: 4,
      ruinCount: 1,
    });
    expect(homesMetric).toMatchObject({
      value: "4 without hearth",
      detail: "4 without hearth · 1 ruin",
      tone: "warn",
    });
  });

  it("preserves contested, worn, heavy vault, and ruin counts with home priority order", () => {
    const world = makeWorld({
      agents: [agent({ id: "agent_001", home_id: null })],
      homes: [
        home({ home_id: "home_contested", breachers: ["agent_intruder"], stakeholders: [] }),
        home({ home_id: "home_worn", integrity: 45, max_integrity: 100, stakeholders: [] }),
        home({ home_id: "home_vault", is_hoarding: true, stakeholders: [] }),
      ],
      ruins: [home({ home_id: "home_ruin", status: "ruin" })],
      pending_proposals: [],
    });

    const summary = summarizeWorldCondition(world);
    const homesMetric = summary.metrics.find((metric) => metric.key === "homes");

    expect(summary.homes).toEqual({
      state: "contested",
      keptHomeCount: 0,
      standingCount: 3,
      contestedCount: 1,
      wornCount: 1,
      ruinCount: 1,
      hoardingVaultCount: 1,
      livingWithStandingHomeCount: 0,
      livingWithoutStandingHomeCount: 1,
    });
    expect(homesMetric).toMatchObject({
      value: "1 contested",
      detail: "1 without hearth · 1 ruin · 1 heavy vault",
      tone: "danger",
    });
  });

  it("uses without-hearth, worn, heavy-vault, kept, and none home values in priority order", () => {
    expect(homeMetricValue({
      agents: [agent({ home_id: null })],
      homes: [home({ stakeholders: [] })],
    })).toBe("1 without hearth");
    expect(homeMetricValue({
      agents: [agent()],
      homes: [home({ integrity: 20, max_integrity: 100 })],
    })).toBe("1 worn");
    expect(homeMetricValue({
      agents: [agent()],
      homes: [home({ is_hoarding: true })],
    })).toBe("1 heavy vault");
    expect(homeMetricValue({
      agents: [agent()],
      homes: [home()],
    })).toBe("1 kept home");
    expect(homeMetricValue({
      agents: [],
      homes: [],
    })).toBe("0 standing");
  });

  it("keeps visible home readiness copy free of raw ids and shelter vocabulary", () => {
    const world = makeWorld({
      agents: [
        agent({ id: "agent_001", home_id: null }),
        agent({ id: "agent_002", home_id: "home_002" }),
      ],
      homes: [
        home({ home_id: "home_002", stakeholders: ["agent_002"] }),
        home({ home_id: "home_003", breachers: ["agent_404"], is_hoarding: true, stakeholders: [] }),
      ],
      ruins: [home({ home_id: "home_old", status: "ruin" })],
      pending_proposals: [],
    });

    const summary = summarizeWorldCondition(world);
    const homesMetric = summary.metrics.find((metric) => metric.key === "homes");
    const visibleCopy = `${homesMetric?.value} ${homesMetric?.detail} ${summary.detail}`;

    expect(visibleCopy).not.toMatch(/agent_|home_/);
    expect(visibleCopy).not.toMatch(/\b(inside|shelter|sheltered|occupancy)\b/i);
    expect(visibleCopy).toContain("without hearth");
  });
});

function homeMetricValue(overrides: {
  agents: AgentSnapshot[];
  homes: HomeSnapshot[];
}): string {
  const summary = summarizeWorldCondition(makeWorld({
    agents: overrides.agents,
    homes: overrides.homes,
    ruins: [],
    pending_proposals: [],
  }));
  return summary.metrics.find((metric) => metric.key === "homes")?.value ?? "";
}

function agent(overrides: Partial<AgentSnapshot> = {}): AgentSnapshot {
  return {
    id: "agent_001",
    name: "Aster",
    persona: "builder",
    position: "meadow",
    energy: 84,
    materials: 22,
    status: "alive",
    last_mated_at: null,
    offspring_count: 0,
    died_at: null,
    home_id: "home_001",
    is_hoarding: false,
    ...overrides,
  };
}

function region(overrides: Partial<RegionSnapshot> = {}): RegionSnapshot {
  return {
    name: "meadow",
    description: "Open grass and bright seed heads.",
    connections: ["grove"],
    energy_rate: 2,
    materials_rate: 1,
    current_energy: 63,
    current_materials: 21,
    max_energy: 100,
    max_materials: 80,
    ...overrides,
  };
}

function home(overrides: Partial<HomeSnapshot> = {}): HomeSnapshot {
  return {
    home_id: "home_001",
    owner_id: "agent_001",
    region: "meadow",
    integrity: 120,
    max_integrity: 120,
    built_at: 8,
    last_upkeep_at: 11,
    last_integrity_at: 11,
    stakeholders: ["agent_001"],
    vault_materials: 14,
    status: "standing",
    ruined_at: null,
    remnant_materials: 0,
    breachers: [],
    is_hoarding: false,
    ...overrides,
  };
}
