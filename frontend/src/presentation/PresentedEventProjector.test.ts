import { describe, expect, it } from "vitest";

import type { AgentSnapshot, EventEnvelopeEntry } from "../app/schemas";
import { makeWorld } from "../test/fixtures";
import { EVENT_VISUAL_EVENT_TYPES } from "../events/eventVisualCatalog";
import { parsePresentedEvent, type TypedPresentedEvent } from "./eventPayloads";
import {
  PRESENTED_EVENT_PROJECTORS,
  createPresentedEventProjector,
  createProjectedWorldState,
  type PresentedHoardThresholds,
  type ProjectionResult,
  type ProjectedWorldState,
} from "./PresentedEventProjector";
import {
  PRESENTED_EVENT_PAYLOAD_CASES,
  eventEntry,
} from "./eventPayloads.test";

interface ProjectionCase {
  readonly type: TypedPresentedEvent["type"];
  readonly appliedFields: readonly string[];
  readonly unresolvedFields?: readonly string[];
  readonly verify: (result: ProjectionResult, before: ProjectedWorldState) => void;
}

const projectionCases: readonly ProjectionCase[] = [
  {
    type: "agent_born",
    appliedFields: [
      "agents.agent_003.id",
      "agents.agent_003.name",
      "agents.agent_003.position",
      "agents.agent_003.energy",
      "agents.agent_003.materials",
      "agents.agent_003.status",
      "pendingProposals.agent_001->agent_002",
    ],
    unresolvedFields: [
      "agents.agent_003.persona",
      "agents.agent_003.last_mated_at",
      "agents.agent_003.offspring_count",
      "agents.agent_003.died_at",
      "agents.agent_003.home_id",
      "agents.agent_003.is_hoarding",
      "agents.agent_001.last_mated_at",
      "agents.agent_001.offspring_count",
      "agents.agent_002.last_mated_at",
      "agents.agent_002.offspring_count",
      "agents.agent_002.energy",
      "agents.agent_002.materials",
    ],
    verify: ({ state }) => {
      expect(state.agents.get("agent_003")).toEqual({
        completeness: "projected-partial",
        value: {
          id: "agent_003",
          name: "Cedar",
          position: "grove",
          energy: 12.8,
          materials: 3.2,
          status: "alive",
        },
      });
      expect(state.pendingProposals).toEqual([]);
    },
  },
  {
    type: "agent_died",
    appliedFields: [
      "agents.agent_002.status",
      "agents.agent_002.energy",
      "agents.agent_002.materials",
      "agents.agent_002.home_id",
      "agents.agent_002.is_hoarding",
    ],
    unresolvedFields: [
      "agents.agent_002.died_at",
      "agents.agent_001.energy",
      "agents.agent_001.materials",
      "pendingProposals.*",
      "agents.*.energy",
      "agents.*.materials",
      "homes.*.owner_id",
      "homes.*.stakeholders",
      "homes.*.integrity",
      "homes.*.max_integrity",
    ],
    verify: ({ state }) => {
      expect(state.agents.get("agent_002")?.value).toMatchObject({
        status: "dead",
        energy: 0,
        materials: 0,
        home_id: null,
        is_hoarding: false,
      });
      expect(state.homes.get("home_001")?.value.owner_id).toBe("agent_001");
    },
  },
  {
    type: "agent_decayed",
    appliedFields: ["agents.agent_002"],
    verify: ({ state }) => expect(state.agents.has("agent_002")).toBe(false),
  },
  {
    type: "agent_paralyzed",
    appliedFields: ["agents.agent_001.status", "agents.agent_001.energy"],
    verify: ({ state }) => expect(state.agents.get("agent_001")?.value).toMatchObject({ status: "paralyzed", energy: 3 }),
  },
  {
    type: "agent_recovered",
    appliedFields: [
      "agents.agent_001.energy",
      "agents.agent_002.energy",
      "agents.agent_002.status",
    ],
    verify: ({ state }) => {
      expect(state.agents.get("agent_001")?.value.energy).toBe(70);
      expect(state.agents.get("agent_002")?.value).toMatchObject({ energy: 12, status: "alive" });
    },
  },
  {
    type: "agent_left_region",
    appliedFields: [],
    unresolvedFields: ["agents.agent_001.position", "agents.agent_001.energy"],
    verify: ({ state }, before) => {
      expect(state.agents).toBe(before.agents);
      expect(state.agents.get("agent_001")?.value).toMatchObject({ position: "meadow", energy: 84 });
    },
  },
  {
    type: "agent_entered_region",
    appliedFields: ["agents.agent_001.position", "agents.agent_001.energy"],
    verify: ({ state }) => expect(state.agents.get("agent_001")?.value).toMatchObject({ position: "grove", energy: 79 }),
  },
  {
    type: "speak",
    appliedFields: [],
    unresolvedFields: ["agents.agent_001.energy"],
    verify: ({ state }, before) => expect(state.agents).toBe(before.agents),
  },
  {
    type: "self_talk",
    appliedFields: [],
    unresolvedFields: ["agents.agent_001.energy"],
    verify: ({ state }, before) => expect(state.agents).toBe(before.agents),
  },
  {
    type: "resource_changed",
    appliedFields: [
      "agents.agent_001.energy",
      "agents.agent_001.materials",
      "regions.meadow.current_energy",
      "regions.meadow.current_materials",
    ],
    unresolvedFields: ["agents.agent_001.is_hoarding"],
    verify: ({ state }) => {
      expect(state.agents.get("agent_001")?.value).toMatchObject({ energy: 510, materials: 40, is_hoarding: false });
      expect(state.regions.get("meadow")?.value).toMatchObject({ current_energy: 51, current_materials: 20 });
    },
  },
  {
    type: "resource_transferred",
    appliedFields: [
      "agents.agent_001.energy",
      "agents.agent_001.materials",
      "agents.agent_002.energy",
      "agents.agent_002.materials",
    ],
    unresolvedFields: [
      "agents.agent_001.is_hoarding",
      "agents.agent_002.is_hoarding",
    ],
    verify: ({ state }) => {
      expect(state.agents.get("agent_001")?.value).toMatchObject({ energy: 80, materials: 17, is_hoarding: false });
      expect(state.agents.get("agent_002")?.value).toMatchObject({ energy: 4, materials: 8, is_hoarding: false });
    },
  },
  {
    type: "agent_started_hoarding",
    appliedFields: ["agents.agent_001.energy", "agents.agent_001.materials", "agents.agent_001.is_hoarding"],
    verify: ({ state }) => expect(state.agents.get("agent_001")?.value).toMatchObject({ energy: 500, materials: 22, is_hoarding: true }),
  },
  {
    type: "mating_initiated",
    appliedFields: [
      "agents.agent_001.energy",
      "agents.agent_001.materials",
      "pendingProposals.agent_001->agent_002.initiator_id",
      "pendingProposals.agent_001->agent_002.target_id",
      "pendingProposals.agent_001->agent_002.resources",
    ],
    unresolvedFields: ["pendingProposals.agent_001->agent_002.timestamp"],
    verify: ({ state }) => {
      expect(state.agents.get("agent_001")?.value).toMatchObject({ energy: 76, materials: 20 });
      expect(state.pendingProposals).toEqual([{ initiator_id: "agent_001", target_id: "agent_002", timestamp: null, resources: { energy: 8, materials: 2 } }]);
    },
  },
  ...(["mating_rejected", "mating_proposal_invalidated", "mating_proposal_timeout"] as const).map((type): ProjectionCase => ({
    type,
    appliedFields: ["pendingProposals.agent_001->agent_002"],
    unresolvedFields: [
      "agents.agent_001.energy",
      "agents.agent_001.materials",
    ],
    verify: ({ state }) => expect(state.pendingProposals).toEqual([]),
  })),
  {
    type: "attack",
    appliedFields: ["agents.agent_001.energy", "agents.agent_002.energy"],
    verify: ({ state }) => {
      expect(state.agents.get("agent_001")?.value.energy).toBe(69);
      expect(state.agents.get("agent_002")?.value).toMatchObject({ energy: 2, status: "paralyzed" });
    },
  },
  {
    type: "home_built",
    appliedFields: [
      "homes.home_002.home_id",
      "homes.home_002.owner_id",
      "homes.home_002.region",
      "homes.home_002.integrity",
      "homes.home_002.stakeholders",
      "homes.home_002.status",
      "agents.agent_002.home_id",
    ],
    unresolvedFields: [
      "homes.home_002.max_integrity",
      "homes.home_002.built_at",
      "homes.home_002.last_upkeep_at",
      "homes.home_002.last_integrity_at",
      "homes.home_002.vault_materials",
      "homes.home_002.ruined_at",
      "homes.home_002.remnant_materials",
      "homes.home_002.breachers",
      "homes.home_002.is_hoarding",
      "agents.agent_002.materials",
    ],
    verify: ({ state }) => {
      expect(state.homes.get("home_002")).toEqual({
        completeness: "projected-partial",
        value: { home_id: "home_002", owner_id: "agent_002", region: "grove", integrity: 120, stakeholders: ["agent_002"], status: "standing" },
      });
      expect(state.agents.get("agent_002")?.value.home_id).toBe("home_002");
    },
  },
  {
    type: "hearth_used",
    appliedFields: ["agents.agent_001.energy", "agents.agent_001.materials"],
    unresolvedFields: ["agents.agent_001.is_hoarding"],
    verify: ({ state }) => expect(state.agents.get("agent_001")?.value).toMatchObject({ energy: 94, materials: 17, is_hoarding: false }),
  },
  {
    type: "home_joined",
    appliedFields: [
      "homes.home_001.owner_id", "homes.home_001.region", "homes.home_001.stakeholders",
      "homes.home_001.integrity", "homes.home_001.max_integrity", "agents.agent_002.home_id",
    ],
    verify: ({ state }) => {
      expect(state.homes.get("home_001")?.value).toMatchObject({ owner_id: "agent_001", region: "meadow", stakeholders: ["agent_001", "agent_002"], integrity: 120, max_integrity: 180 });
      expect(state.agents.get("agent_002")?.value.home_id).toBe("home_001");
    },
  },
  {
    type: "home_left",
    appliedFields: [
      "homes.home_001.owner_id", "homes.home_001.region", "homes.home_001.stakeholders",
      "homes.home_001.integrity", "homes.home_001.max_integrity", "agents.agent_001.home_id",
    ],
    verify: ({ state }) => {
      expect(state.homes.get("home_001")?.value).toMatchObject({ owner_id: "agent_002", stakeholders: ["agent_002"], integrity: 100, max_integrity: 120 });
      expect(state.agents.get("agent_001")?.value.home_id).toBeNull();
    },
  },
  {
    type: "home_started_hoarding",
    appliedFields: ["homes.home_001.vault_materials", "homes.home_001.is_hoarding"],
    unresolvedFields: ["agents.agent_001.materials"],
    verify: ({ state }) => expect(state.homes.get("home_001")?.value).toMatchObject({ vault_materials: 300, is_hoarding: true }),
  },
  {
    type: "home_collapsed",
    appliedFields: [
      "homes.home_001", "ruins.home_001.owner_id", "ruins.home_001.region", "ruins.home_001.integrity",
      "ruins.home_001.status", "ruins.home_001.ruined_at", "ruins.home_001.remnant_materials",
      "ruins.home_001.stakeholders", "ruins.home_001.vault_materials", "ruins.home_001.breachers",
      "ruins.home_001.is_hoarding", "agents.agent_001.home_id",
    ],
    unresolvedFields: [
      "ruins.home_001.max_integrity",
      "ruins.home_001.last_integrity_at",
    ],
    verify: ({ state }) => {
      expect(state.homes.has("home_001")).toBe(false);
      expect(state.ruins.get("home_001")).toMatchObject({ completeness: "projected-partial", value: { owner_id: "agent_001", region: "meadow", integrity: 0, status: "ruin", ruined_at: 30, remnant_materials: 21, stakeholders: [], vault_materials: 0, breachers: [], is_hoarding: false } });
      expect(state.agents.get("agent_001")?.value.home_id).toBeNull();
    },
  },
  {
    type: "home_breached",
    appliedFields: ["homes.home_001.integrity", "homes.home_001.breachers"],
    unresolvedFields: [
      "agents.agent_002.energy",
      "agents.agent_002.materials",
    ],
    verify: ({ state }) => expect(state.homes.get("home_001")?.value).toMatchObject({ integrity: 0, breachers: ["agent_002"] }),
  },
  {
    type: "home_thieved",
    appliedFields: ["homes.home_001.vault_materials", "homes.home_001.integrity", "homes.home_001.status"],
    unresolvedFields: [
      "homes.home_001.is_hoarding",
      "agents.agent_002.materials",
    ],
    verify: ({ state }) => {
      expect(state.homes.get("home_001")?.value).toMatchObject({ vault_materials: 0, integrity: 0, status: "standing", is_hoarding: false });
      expect(state.agents.get("agent_002")?.value.materials).toBe(3);
    },
  },
  {
    type: "home_colonized",
    appliedFields: [
      "homes.home_001.owner_id", "homes.home_001.region", "homes.home_001.stakeholders", "homes.home_001.vault_materials",
      "homes.home_001.integrity", "homes.home_001.status", "homes.home_001.breachers",
      "agents.agent_001.home_id", "agents.agent_002.home_id",
    ],
    unresolvedFields: [
      "homes.home_001.is_hoarding",
      "homes.*.owner_id",
      "homes.*.stakeholders",
      "homes.*.integrity",
      "homes.*.max_integrity",
    ],
    verify: ({ state }) => {
      expect(state.homes.get("home_001")?.value).toMatchObject({ owner_id: "agent_002", stakeholders: ["agent_002"], vault_materials: 0, integrity: 0, status: "standing", breachers: [], is_hoarding: false });
      expect(state.agents.get("agent_001")?.value.home_id).toBeNull();
      expect(state.agents.get("agent_002")?.value.home_id).toBe("home_001");
    },
  },
  {
    type: "ruins_scavenged",
    appliedFields: ["ruins.home_old.remnant_materials", "agents.agent_001.materials"],
    unresolvedFields: ["agents.agent_001.is_hoarding"],
    verify: ({ state }) => {
      expect(state.ruins.get("home_old")?.value.remnant_materials).toBe(7);
      expect(state.agents.get("agent_001")?.value).toMatchObject({ materials: 27, is_hoarding: false });
    },
  },
  {
    type: "simulation_started",
    appliedFields: [],
    verify: ({ state }, before) => {
      expect(state.agents).toBe(before.agents);
      expect(state.regions).toBe(before.regions);
      expect(state.homes).toBe(before.homes);
      expect(state.ruins).toBe(before.ruins);
    },
  },
];

describe("PresentedEventProjector", () => {
  it("projects every durable field represented by all 28 known event payloads", () => {
    expect(projectionCases.map(({ type }) => type)).toEqual(EVENT_VISUAL_EVENT_TYPES);
    expect(Object.keys(PRESENTED_EVENT_PROJECTORS)).toEqual(EVENT_VISUAL_EVENT_TYPES);
    const projector = createPresentedEventProjector();

    for (const projectionCase of projectionCases) {
      const payloadCase = PRESENTED_EVENT_PAYLOAD_CASES.find(({ type }) => type === projectionCase.type);
      if (!payloadCase) throw new Error(`missing payload case for ${projectionCase.type}`);
      const parsed = parsePresentedEvent(eventEntry(payloadCase));
      if (!parsed.known) throw new Error(`expected known event ${projectionCase.type}`);
      const before = stateWithUnrelatedAgent();
      const unrelated = before.agents.get("agent_009");

      const result = projector.project(before, parsed.evidence);

      expect(result.state.projectedThroughCursor, projectionCase.type).toBe(5);
      expect(result.state.exactBase, projectionCase.type).toBe(before.exactBase);
      expect(result.appliedFields, projectionCase.type).toEqual(projectionCase.appliedFields);
      expect(result.unresolvedFields, projectionCase.type).toEqual(projectionCase.unresolvedFields ?? []);
      expect(result.state.agents.get("agent_009"), projectionCase.type).toBe(unrelated);
      projectionCase.verify(result, before);
    }
  });

  it("does not mutate inputs and only copy-on-writes changed records and maps", () => {
    const before = stateWithUnrelatedAgent();
    const originalAgent = before.agents.get("agent_001");
    const untouchedAgent = before.agents.get("agent_002");
    const payloadCase = PRESENTED_EVENT_PAYLOAD_CASES.find(({ type }) => type === "agent_entered_region");
    if (!payloadCase) throw new Error("missing movement case");
    const parsed = parsePresentedEvent(eventEntry(payloadCase));
    if (!parsed.known) throw new Error("expected movement event");

    const result = createPresentedEventProjector().project(before, parsed.evidence);

    expect(before.agents.get("agent_001")).toBe(originalAgent);
    expect(before.agents.get("agent_001")?.value.position).toBe("meadow");
    expect(result.state.agents).not.toBe(before.agents);
    expect(result.state.agents.get("agent_001")).not.toBe(originalAgent);
    expect(result.state.agents.get("agent_002")).toBe(untouchedAgent);
    expect(result.state.regions).toBe(before.regions);
    expect(result.state.homes).toBe(before.homes);
    expect(result.state.ruins).toBe(before.ruins);
    expect(result.state.pendingProposals).toBe(before.pendingProposals);
  });

  it("leaves unknown referenced entities absent instead of fabricating defaults", () => {
    const payloadCase = PRESENTED_EVENT_PAYLOAD_CASES.find(({ type }) => type === "attack");
    if (!payloadCase) throw new Error("missing attack case");
    const entry: EventEnvelopeEntry = eventEntry(payloadCase);
    entry.event.payload = { ...entry.event.payload, attacker_id: "missing", victim_id: "also_missing" };
    const parsed = parsePresentedEvent(entry);
    if (!parsed.known) throw new Error("expected attack event");
    const before = stateWithUnrelatedAgent();

    const result = createPresentedEventProjector().project(before, parsed.evidence);

    expect(result.state.agents.has("missing")).toBe(false);
    expect(result.state.agents.has("also_missing")).toBe(false);
    expect(result.appliedFields).toEqual([]);
    expect(result.unresolvedFields).toEqual([
      "agents.missing.energy",
      "agents.also_missing.energy",
    ]);
  });

  it("reports every absent collapse clock in the ruins partition when the prior home is partial", () => {
    const builtCase = PRESENTED_EVENT_PAYLOAD_CASES.find(({ type }) => type === "home_built");
    const collapsedCase = PRESENTED_EVENT_PAYLOAD_CASES.find(({ type }) => type === "home_collapsed");
    if (!builtCase || !collapsedCase) throw new Error("missing home lifecycle cases");
    const projector = createPresentedEventProjector();
    const built = parsePresentedEvent(eventEntry(builtCase, 5));
    const collapsed = parsePresentedEvent(eventEntry({
      ...collapsedCase,
      payload: {
        ...collapsedCase.payload,
        home_id: "home_002",
        target_home: "home_002",
        owner_id: "agent_002",
        region: "grove",
        stakeholders: ["agent_002"],
      },
    }, 6));
    if (!built.known || !collapsed.known) throw new Error("expected known home events");

    const partial = projector.project(stateWithUnrelatedAgent(), built.evidence).state;
    const result = projector.project(partial, collapsed.evidence);

    expect(result.unresolvedFields).toEqual([
      "ruins.home_002.max_integrity",
      "ruins.home_002.built_at",
      "ruins.home_002.last_upkeep_at",
      "ruins.home_002.last_integrity_at",
    ]);
  });

  it("reports a communal exact home's recomputed ruin ceiling unresolved", () => {
    const collapsedCase = PRESENTED_EVENT_PAYLOAD_CASES.find(
      ({ type }) => type === "home_collapsed",
    );
    if (!collapsedCase) throw new Error("missing collapse case");
    const communal = makeWorld({
      homes: makeWorld().homes.map((home) => home.home_id === "home_001"
        ? {
            ...home,
            stakeholders: ["agent_001", "agent_002"],
            max_integrity: 180,
          }
        : home),
    });
    const parsed = parsePresentedEvent(eventEntry({
      ...collapsedCase,
      payload: {
        ...collapsedCase.payload,
        stakeholders: ["agent_001", "agent_002"],
      },
    }));
    if (!parsed.known) throw new Error("expected known collapse event");

    const result = createPresentedEventProjector().project(
      createProjectedWorldState(communal),
      parsed.evidence,
    );

    expect(result.state.ruins.get("home_001")?.value.max_integrity).toBe(180);
    expect(result.unresolvedFields).toEqual([
      "ruins.home_001.max_integrity",
      "ruins.home_001.last_integrity_at",
    ]);
  });

  it("uses frozen non-default active-run thresholds for derived agent and home hoard truth", () => {
    const thresholds = {
      hoarding_energy_threshold: 1_000,
      hoarding_materials_threshold: 100,
    };
    const projector = createPresentedEventProjector(thresholds);
    thresholds.hoarding_energy_threshold = 1;
    thresholds.hoarding_materials_threshold = 1_000;

    const resourceCase = PRESENTED_EVENT_PAYLOAD_CASES.find(({ type }) => type === "resource_changed");
    const theftCase = PRESENTED_EVENT_PAYLOAD_CASES.find(({ type }) => type === "home_thieved");
    if (!resourceCase || !theftCase) throw new Error("missing threshold cases");
    const resource = parsePresentedEvent(eventEntry(resourceCase, 5));
    const theft = parsePresentedEvent(eventEntry({
      ...theftCase,
      payload: { ...theftCase.payload, vault_materials: 150 },
    }, 6));
    if (!resource.known || !theft.known) throw new Error("expected known threshold events");

    const afterResource = projector.project(stateWithUnrelatedAgent(), resource.evidence);
    expect(afterResource.state.agents.get("agent_001")?.value.is_hoarding).toBe(false);
    expect(afterResource.appliedFields).toContain("agents.agent_001.is_hoarding");
    expect(afterResource.unresolvedFields).not.toContain("agents.agent_001.is_hoarding");

    const afterTheft = projector.project(afterResource.state, theft.evidence);
    expect(afterTheft.state.homes.get("home_001")?.value.is_hoarding).toBe(true);
    expect(afterTheft.appliedFields).toContain("homes.home_001.is_hoarding");
    expect(afterTheft.unresolvedFields).not.toContain("homes.home_001.is_hoarding");
  });

  it("rejects non-finite and negative active-run hoard thresholds", () => {
    for (const thresholds of [
      { hoarding_energy_threshold: Number.NaN, hoarding_materials_threshold: 100 },
      { hoarding_energy_threshold: 100, hoarding_materials_threshold: Number.POSITIVE_INFINITY },
      { hoarding_energy_threshold: -1, hoarding_materials_threshold: 100 },
      { hoarding_energy_threshold: 100, hoarding_materials_threshold: -1 },
    ]) {
      expect(() => createPresentedEventProjector(thresholds)).toThrow("threshold");
    }
  });

  it("rejects supplied threshold objects missing either required active value", () => {
    const incompleteThresholds: readonly unknown[] = [
      {},
      { hoarding_energy_threshold: 500 },
      { hoarding_materials_threshold: 300 },
    ];

    for (const thresholds of incompleteThresholds) {
      expect(() => createPresentedEventProjector(
        thresholds as PresentedHoardThresholds,
      )).toThrow(RangeError);
    }
  });
});

function stateWithUnrelatedAgent(): ProjectedWorldState {
  const unrelated: AgentSnapshot = {
    id: "agent_009",
    name: "Juniper",
    persona: "observer",
    position: "meadow",
    energy: 99,
    materials: 9,
    status: "alive",
    last_mated_at: null,
    offspring_count: 0,
    died_at: null,
    home_id: null,
    is_hoarding: false,
  };
  return createProjectedWorldState(
    makeWorld({ agents: [...makeWorld().agents, unrelated] }),
  );
}
