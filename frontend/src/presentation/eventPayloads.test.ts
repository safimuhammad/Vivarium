import { describe, expect, it } from "vitest";

import { EVENT_VISUAL_EVENT_TYPES } from "../events/eventVisualCatalog";
import type { EventEnvelopeEntry } from "../app/schemas";
import {
  PRESENTED_EVENT_PAYLOAD_PARSERS,
  parsePresentedEvent,
  type PresentedEventType,
} from "./eventPayloads";

interface PayloadCase {
  readonly type: PresentedEventType;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly requiredKey: string;
}

const message = "source payload";

export const PRESENTED_EVENT_PAYLOAD_CASES: readonly PayloadCase[] = [
  {
    type: "agent_born",
    payload: {
      message,
      child_id: "agent_003",
      child_name: "Cedar",
      parent_ids: ["agent_001", "agent_002"],
      initiator_id: "agent_001",
      acceptor_id: "agent_002",
      region: "grove",
      committed_resources: { energy: 8, materials: 2 },
      child_resources: { energy: 12.8, materials: 3.2 },
      offspring_multiplier: 1.6,
    },
    requiredKey: "child_id",
  },
  {
    type: "agent_died",
    payload: {
      message,
      victim_id: "agent_002",
      victim_name: "Briar",
      killer_id: "agent_001",
      killer: "agent_001",
      region: "grove",
      attack_damage: 20,
      attack_energy_cost: 15,
      victim_was_paralyzed: true,
      looted_energy: 4,
      looted_materials: 3,
    },
    requiredKey: "victim_id",
  },
  {
    type: "agent_decayed",
    payload: {
      message,
      agent_id: "agent_002",
      agent_name: "Briar",
      region: "grove",
      died_at: 12,
      decayed_at: 132,
    },
    requiredKey: "decayed_at",
  },
  {
    type: "agent_paralyzed",
    payload: {
      message,
      agent_id: "agent_001",
      region: "meadow",
      trigger: "attack",
      energy: 3,
      victim_id: "agent_001",
      attacker_id: "agent_002",
    },
    requiredKey: "trigger",
  },
  {
    type: "agent_recovered",
    payload: {
      message,
      giver_id: "agent_001",
      recipient_id: "agent_002",
      revived_id: "agent_002",
      region: "grove",
      resource_type: "energy",
      amount: 8,
      giver_energy: 70,
      revived_energy: 12,
    },
    requiredKey: "revived_energy",
  },
  {
    type: "agent_left_region",
    payload: {
      message,
      agent_id: "agent_001",
      from_region: "meadow",
      to_region: "grove",
      move_energy_cost: 5,
      agent_energy: 79,
    },
    requiredKey: "from_region",
  },
  {
    type: "agent_entered_region",
    payload: {
      message,
      agent_id: "agent_001",
      from_region: "meadow",
      to_region: "grove",
      move_energy_cost: 5,
      agent_energy: 79,
    },
    requiredKey: "to_region",
  },
  {
    type: "speak",
    payload: {
      message,
      speaker_id: "agent_001",
      target_id: "agent_002",
      region: "meadow",
      speak_energy_cost: 0.5,
    },
    requiredKey: "target_id",
  },
  {
    type: "self_talk",
    payload: { message, agent_id: "agent_001" },
    requiredKey: "agent_id",
  },
  {
    type: "resource_changed",
    payload: {
      message,
      agent_id: "agent_001",
      region: "meadow",
      resource_type: "energy",
      amount: 12,
      agent_energy: 510,
      agent_materials: 40,
      region_energy: 51,
      region_materials: 20,
    },
    requiredKey: "region_energy",
  },
  {
    type: "resource_transferred",
    payload: {
      message,
      sender_id: "agent_001",
      receiver_id: "agent_002",
      region: "grove",
      resource_type: "materials",
      amount: 5,
      sender_energy: 80,
      sender_materials: 17,
      receiver_energy: 4,
      receiver_materials: 8,
    },
    requiredKey: "receiver_materials",
  },
  {
    type: "agent_started_hoarding",
    payload: {
      message,
      agent_id: "agent_001",
      region: "meadow",
      energy: 500,
      materials: 22,
    },
    requiredKey: "materials",
  },
  {
    type: "mating_initiated",
    payload: {
      message,
      initiator_id: "agent_001",
      target_id: "agent_002",
      resources: { energy: 8, materials: 2 },
      proposal_timestamp: 20.25,
      initiator_energy: 76,
      initiator_materials: 20,
    },
    requiredKey: "proposal_timestamp",
  },
  {
    type: "mating_rejected",
    payload: {
      message,
      rejecter_id: "agent_002",
      initiator_id: "agent_001",
      target_id: "agent_002",
      resources_refunded: { energy: 8, materials: 2 },
    },
    requiredKey: "resources_refunded",
  },
  {
    type: "mating_proposal_invalidated",
    payload: {
      message,
      initiator_id: "agent_001",
      target_id: "agent_002",
      reason: "initiator_ineligible",
      resources_refunded: { energy: 8, materials: 2 },
    },
    requiredKey: "reason",
  },
  {
    type: "mating_proposal_timeout",
    payload: {
      message,
      initiator_id: "agent_001",
      target_id: "agent_002",
      reason: "timeout",
      resources_refunded: { energy: 8, materials: 2 },
    },
    requiredKey: "reason",
  },
  {
    type: "attack",
    payload: {
      message,
      attacker_id: "agent_001",
      victim_id: "agent_002",
      region: "grove",
      damage: 20,
      attack_energy_cost: 15,
      attacker_energy: 69,
      victim_energy: 2,
    },
    requiredKey: "victim_energy",
  },
  {
    type: "home_built",
    payload: {
      message,
      home_id: "home_002",
      target_home: "home_002",
      builder_id: "agent_002",
      owner_id: "agent_002",
      region: "grove",
      materials_cost: 80,
      integrity: 120,
      stakeholders: ["agent_002"],
    },
    requiredKey: "integrity",
  },
  {
    type: "hearth_used",
    payload: {
      message,
      agent_id: "agent_001",
      home_id: "home_001",
      target_home: "home_001",
      region: "meadow",
      materials_burned: 5,
      energy_gained: 10,
      agent_energy: 94,
      agent_materials: 17,
    },
    requiredKey: "agent_materials",
  },
  {
    type: "home_joined",
    payload: {
      message,
      agent_id: "agent_002",
      home_id: "home_001",
      target_home: "home_001",
      owner_id: "agent_001",
      region: "meadow",
      stakeholders: ["agent_001", "agent_002"],
      integrity: 120,
      max_integrity: 180,
    },
    requiredKey: "max_integrity",
  },
  {
    type: "home_left",
    payload: {
      message,
      agent_id: "agent_001",
      home_id: "home_001",
      target_home: "home_001",
      previous_owner_id: "agent_001",
      owner_id: "agent_002",
      region: "meadow",
      previous_stakeholders: ["agent_001", "agent_002"],
      stakeholders: ["agent_002"],
      integrity: 100,
      max_integrity: 120,
    },
    requiredKey: "previous_stakeholders",
  },
  {
    type: "home_started_hoarding",
    payload: {
      message,
      home_id: "home_001",
      target_home: "home_001",
      agent_id: "agent_001",
      region: "meadow",
      vault_materials: 300,
    },
    requiredKey: "vault_materials",
  },
  {
    type: "home_collapsed",
    payload: {
      message,
      home_id: "home_001",
      target_home: "home_001",
      owner_id: "agent_001",
      region: "meadow",
      stakeholders: ["agent_001"],
      integrity: 0,
      vault_materials: 14,
      remnant_materials: 21,
      ruined_at: 30,
    },
    requiredKey: "remnant_materials",
  },
  {
    type: "home_breached",
    payload: {
      message,
      home_id: "home_001",
      target_home: "home_001",
      breacher_id: "agent_002",
      intent: "thieve",
      region: "meadow",
      breachers: ["agent_002"],
      energy_cost: 15,
      materials_cost: 10,
      integrity_damage: 25,
      integrity: 0,
    },
    requiredKey: "breachers",
  },
  {
    type: "home_thieved",
    payload: {
      message,
      home_id: "home_001",
      target_home: "home_001",
      breacher_id: "agent_002",
      intent: "thieve",
      region: "meadow",
      recipients: ["agent_002"],
      loot: { materials: 14 },
      loot_shares: { agent_002: 14 },
      vault_materials: 0,
      integrity: 0,
    },
    requiredKey: "loot_shares",
  },
  {
    type: "home_colonized",
    payload: {
      message,
      home_id: "home_001",
      target_home: "home_001",
      breacher_id: "agent_002",
      intent: "colonize",
      region: "meadow",
      previous_owner_id: "agent_001",
      previous_stakeholders: ["agent_001"],
      new_owner_id: "agent_002",
      new_stakeholders: ["agent_002"],
      vault_materials: 0,
      integrity: 0,
    },
    requiredKey: "new_stakeholders",
  },
  {
    type: "ruins_scavenged",
    payload: {
      message,
      agent_id: "agent_001",
      home_id: "home_old",
      target_home: "home_old",
      region: "grove",
      resource_type: "materials",
      amount: 5,
      remnant_materials: 7,
      agent_materials: 27,
    },
    requiredKey: "agent_materials",
  },
  {
    type: "simulation_started",
    payload: { message, run_id: "seed-7-test", agent_count: 2, world_time: 12.5 },
    requiredKey: "run_id",
  },
] as const;

export function eventEntry(
  eventCase: PayloadCase,
  cursor = 5,
): EventEnvelopeEntry {
  return {
    cursor,
    event: {
      type: eventCase.type,
      source: eventCase.type === "simulation_started" ? "world" : "agent_001",
      payload: { ...eventCase.payload },
      scope: "local",
      region: null,
      target: null,
      timestamp: 20,
    },
    resolved: {},
    snapshot_after: null,
  };
}

describe("event payload parsing", () => {
  it("strictly parses the exact source payload keys for all 28 known event types", () => {
    expect(PRESENTED_EVENT_PAYLOAD_CASES.map(({ type }) => type)).toEqual(
      EVENT_VISUAL_EVENT_TYPES,
    );
    expect(Object.keys(PRESENTED_EVENT_PAYLOAD_PARSERS)).toEqual(
      EVENT_VISUAL_EVENT_TYPES,
    );

    for (const eventCase of PRESENTED_EVENT_PAYLOAD_CASES) {
      const entry = eventEntry(eventCase);
      const parsed = parsePresentedEvent(entry);
      expect(parsed.known, eventCase.type).toBe(true);
      if (!parsed.known) throw new Error(`expected ${eventCase.type} to be known`);
      expect(parsed.evidence.type).toBe(eventCase.type);
      expect(parsed.evidence.entry).toBe(entry);
      expect(parsed.evidence.payload).toEqual(eventCase.payload);
      expect(Object.keys(parsed.evidence.payload).sort()).toEqual(
        Object.keys(eventCase.payload).sort(),
      );
    }
  });

  it("rejects malformed payloads for every known event type", () => {
    for (const eventCase of PRESENTED_EVENT_PAYLOAD_CASES) {
      const payload = { ...eventCase.payload };
      delete payload[eventCase.requiredKey];
      expect(
        () => parsePresentedEvent(eventEntry({ ...eventCase, payload })),
        eventCase.type,
      ).toThrow();
    }
  });

  it("retains unknown future envelopes without granting mutation authority", () => {
    const entry = eventEntry(PRESENTED_EVENT_PAYLOAD_CASES[0]);
    entry.event.type = "future_weather_shift";
    entry.event.payload = { message: "A new wind arrives.", intensity: 4 };

    const parsed = parsePresentedEvent(entry);

    expect(parsed).toEqual({ known: false, entry });
    if (parsed.known) throw new Error("future event must remain unknown");
    expect(parsed.entry).toBe(entry);
  });

  it("rejects non-finite numbers and invalid discriminated payload variants", () => {
    const resource = PRESENTED_EVENT_PAYLOAD_CASES.find(
      ({ type }) => type === "resource_changed",
    );
    const paralysis = PRESENTED_EVENT_PAYLOAD_CASES.find(
      ({ type }) => type === "agent_paralyzed",
    );
    if (!resource || !paralysis) throw new Error("missing matrix case");

    expect(() =>
      parsePresentedEvent(
        eventEntry({
          ...resource,
          payload: { ...resource.payload, agent_energy: Number.NaN },
        }),
      ),
    ).toThrow("agent_energy");
    expect(() =>
      parsePresentedEvent(
        eventEntry({
          ...paralysis,
          payload: { ...paralysis.payload, trigger: "weather" },
        }),
      ),
    ).toThrow("trigger");
  });

  it("rejects negative remnant materials at collapse and scavenge event ingress", () => {
    for (const type of ["home_collapsed", "ruins_scavenged"] as const) {
      const eventCase = PRESENTED_EVENT_PAYLOAD_CASES.find(
        (candidate) => candidate.type === type,
      );
      if (!eventCase) throw new Error(`missing payload case ${type}`);

      expect(() => parsePresentedEvent(eventEntry({
        ...eventCase,
        payload: { ...eventCase.payload, remnant_materials: -1 },
      }))).toThrow("remnant_materials must be non-negative");
    }
  });

  it("enforces exact energy and materials schemas for birth and mating resources", () => {
    const resourceFields = [
      ["agent_born", "committed_resources"],
      ["agent_born", "child_resources"],
      ["mating_initiated", "resources"],
      ["mating_rejected", "resources_refunded"],
      ["mating_proposal_invalidated", "resources_refunded"],
      ["mating_proposal_timeout", "resources_refunded"],
    ] as const;

    for (const [type, field] of resourceFields) {
      const eventCase = PRESENTED_EVENT_PAYLOAD_CASES.find(
        (candidate) => candidate.type === type,
      );
      if (!eventCase) throw new Error(`missing payload case ${type}`);

      expect(
        () => parsePresentedEvent(eventEntry({
          ...eventCase,
          payload: { ...eventCase.payload, [field]: { materials: 2 } },
        })),
        `${type}.${field} missing energy`,
      ).toThrow(field);
      expect(
        () => parsePresentedEvent(eventEntry({
          ...eventCase,
          payload: { ...eventCase.payload, [field]: { energy: 8, water: 2 } },
        })),
        `${type}.${field} wrong key`,
      ).toThrow(field);
      expect(
        () => parsePresentedEvent(eventEntry({
          ...eventCase,
          payload: {
            ...eventCase.payload,
            [field]: { energy: 8, materials: 2, water: 1 },
          },
        })),
        `${type}.${field} extra key`,
      ).toThrow(field);
      expect(
        () => parsePresentedEvent(eventEntry({
          ...eventCase,
          payload: {
            ...eventCase.payload,
            [field]: { energy: Number.POSITIVE_INFINITY, materials: 2 },
          },
        })),
        `${type}.${field} non-finite`,
      ).toThrow(`${field}.energy`);

      const parsed = parsePresentedEvent(eventEntry({
        ...eventCase,
        payload: { ...eventCase.payload, [field]: { energy: 8, materials: 2 } },
      }));
      expect(parsed.known, `${type}.${field} valid`).toBe(true);
    }
  });

  it("enforces exact theft loot while retaining non-empty dynamic finite loot shares", () => {
    const eventCase = PRESENTED_EVENT_PAYLOAD_CASES.find(
      (candidate) => candidate.type === "home_thieved",
    );
    if (!eventCase) throw new Error("missing home_thieved payload case");

    for (const loot of [
      {},
      { energy: 14 },
      { materials: 14, energy: 1 },
      { materials: Number.NaN },
    ]) {
      expect(() => parsePresentedEvent(eventEntry({
        ...eventCase,
        payload: { ...eventCase.payload, loot },
      }))).toThrow("loot");
    }

    for (const lootShares of [
      {},
      { "": 14 },
      { agent_002: Number.NEGATIVE_INFINITY },
    ]) {
      expect(() => parsePresentedEvent(eventEntry({
        ...eventCase,
        payload: { ...eventCase.payload, loot_shares: lootShares },
      }))).toThrow("loot_shares");
    }

    const parsed = parsePresentedEvent(eventEntry({
      ...eventCase,
      payload: {
        ...eventCase.payload,
        loot: { materials: 14 },
        loot_shares: { agent_002: 9, agent_009: 5 },
      },
    }));
    expect(parsed.known).toBe(true);
    if (!parsed.known) throw new Error("expected valid theft payload");
    expect(parsed.evidence.payload).toMatchObject({
      loot: { materials: 14 },
      loot_shares: { agent_002: 9, agent_009: 5 },
    });
  });
});
