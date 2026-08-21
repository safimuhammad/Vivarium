import { describe, expect, it } from "vitest";

import type { EventEnvelopeEntry } from "../../app/schemas";
import { EVENT_VISUAL_EVENT_TYPES } from "../../events/eventVisualCatalog";
import { parsePresentedEvent, type PresentedEventType, type TypedPresentedEvent } from "../eventPayloads";
import {
  CHRONICLE_CATALOG,
  CHRONICLE_IDS,
} from "../fixtures/chronicleCatalog";
import type { ChoreographyDefinition } from "./contracts";
import {
  CHOREOGRAPHY_FAMILY_EVENT_TYPES,
  CHOREOGRAPHY_REGISTRY,
  assertCompleteChoreographyRegistry,
  createChoreographyRegistry,
  getChoreographyDefinition,
  resolveParticipantIds,
} from "./registry";

const EXPECTED_FAMILY_COUNTS = Object.freeze({
  lifecycle: 5,
  movement: 2,
  communication: 2,
  resource: 3,
  bond: 4,
  combat: 1,
  home: 6,
  contest: 4,
  system: 1,
});

describe("Task 9 choreography registry foundation", () => {
  it("RED: closes the registry over exactly the canonical 28 types with no fallback", () => {
    expect(Object.keys(CHOREOGRAPHY_REGISTRY)).toEqual(EVENT_VISUAL_EVENT_TYPES);
    expect(() => assertCompleteChoreographyRegistry(CHOREOGRAPHY_REGISTRY)).not.toThrow();
  });

  it("partitions the canonical catalog into disjoint exact family counts", () => {
    expect(Object.keys(CHOREOGRAPHY_FAMILY_EVENT_TYPES)).toEqual(
      Object.keys(EXPECTED_FAMILY_COUNTS),
    );

    const flattened = Object.entries(CHOREOGRAPHY_FAMILY_EVENT_TYPES).flatMap(
      ([family, eventTypes]) => {
        expect(eventTypes, family).toHaveLength(
          EXPECTED_FAMILY_COUNTS[family as keyof typeof EXPECTED_FAMILY_COUNTS],
        );
        return eventTypes;
      },
    );
    expect(new Set(flattened).size).toBe(flattened.length);
    expect([...flattened].sort()).toEqual([...EVENT_VISUAL_EVENT_TYPES].sort());
  });

  it("covers all 28 canonical types across the Chronicle catalog, including C18's grand tour", () => {
    const fixtureTypes = new Set(
      CHRONICLE_IDS.flatMap((id) =>
        CHRONICLE_CATALOG[id].entries.map((entry) => entry.event.type),
      ),
    );
    expect(fixtureTypes.size).toBe(28);
    expect(
      EVENT_VISUAL_EVENT_TYPES.filter((type) => !fixtureTypes.has(type)),
    ).toEqual([]);

    for (const entry of [agentHoardingEntry(), simulationStartedEntry()]) {
      const parsed = parsePresentedEvent(entry);
      expect(parsed.known, entry.event.type).toBe(true);
    }
  });

  it("resolves participant roles from typed payload and route truth, not misleading hints", () => {
    const death = fixtureEvent("C11", "agent_died");
    expect(death.entry.resolved.actor_id).toBe(death.evidence.payload.victim_id);
    expect(resolveParticipantIds(death.evidence, "killer")).toEqual([
      death.evidence.payload.killer_id,
    ]);
    expect(resolveParticipantIds(death.evidence, "victim")).toEqual([
      death.evidence.payload.victim_id,
    ]);

    const paralysis = fixtureEvent("C12", "agent_paralyzed");
    expect(paralysis.entry.resolved.actor_id).toBe("system");
    expect(resolveParticipantIds(paralysis.evidence, "killer")).toEqual([
      paralysis.evidence.payload.trigger === "attack"
        ? paralysis.evidence.payload.attacker_id
        : "unreachable",
    ]);
    expect(resolveParticipantIds(paralysis.evidence, "victim")).toEqual([
      paralysis.evidence.payload.agent_id,
    ]);

    const rejection = fixtureEvent("C04", "mating_rejected");
    expect(rejection.entry.resolved.target_id).toBe(rejection.evidence.payload.target_id);
    expect(resolveParticipantIds(rejection.evidence, "initiator")).toEqual([
      rejection.evidence.payload.initiator_id,
    ]);
    expect(resolveParticipantIds(rejection.evidence, "actor")).toEqual([
      rejection.evidence.payload.rejecter_id,
    ]);
    expect(rejection.entry.event.target).toBe(rejection.evidence.payload.initiator_id);
  });

  it("validates keys, rejects duplicates, deep-owns declarations, and exposes no generic fallback", () => {
    const original = definition("attack");
    const registry = createChoreographyRegistry([original]);

    expect(Object.isFrozen(registry)).toBe(true);
    expect(Object.isFrozen(registry.attack)).toBe(true);
    expect(Object.isFrozen(registry.attack?.participants)).toBe(true);
    expect(Object.isFrozen(registry.attack?.requiredAnchors)).toBe(true);
    expect(Object.isFrozen(registry.attack?.duration)).toBe(true);
    expect(Object.isFrozen(registry.attack?.missingParticipant)).toBe(true);
    expect(registry.attack?.participants).not.toBe(original.participants);
    expect(registry.attack?.duration).not.toBe(original.duration);

    expect(() => createChoreographyRegistry([original, original])).toThrow(
      "duplicate choreography definition for attack",
    );
    expect(() => createChoreographyRegistry([
      ["attack", definition("speak")],
    ])).toThrow("choreography key attack does not match definition event type speak");
    expect(() => createChoreographyRegistry([definition("attack", { contactMarker: "same", consequenceMarker: "same" })])).toThrow(
      "contact and consequence markers must be distinct",
    );
    expect(getChoreographyDefinition("speak", registry)).toBeUndefined();
  });
});

function definition<T extends PresentedEventType>(
  eventType: T,
  overrides: Partial<ChoreographyDefinition<T>> = {},
): ChoreographyDefinition<T> {
  return {
    eventType,
    participants: ["actor", "target"],
    requiredAnchors: ["current-position", "social"],
    contactMarker: `${eventType}:contact`,
    consequenceMarker: `${eventType}:consequence`,
    safeCancelMarkers: [`${eventType}:safe-cancel`],
    duration: { minMs: 400, maxMs: 1_200 },
    missingParticipant: {
      required: "nearest-staging-fade-reposition",
      optional: "omit-flourish",
      diagnostic: "missing-participant",
    },
    resolve: () => {
      throw new Error("test definition is declaration-only");
    },
    ...overrides,
  };
}

function fixtureEvent<T extends PresentedEventType>(
  chronicleId: "C04" | "C11" | "C12",
  type: T,
): {
  readonly entry: EventEnvelopeEntry;
  readonly evidence: Extract<TypedPresentedEvent, { readonly type: T }>;
} {
  const entry = CHRONICLE_CATALOG[chronicleId].entries.find(
    (candidate) => candidate.event.type === type,
  );
  if (entry === undefined) throw new Error(`missing ${type} in ${chronicleId}`);
  const parsed = parsePresentedEvent(entry);
  if (!parsed.known || parsed.evidence.type !== type) {
    throw new Error(`expected typed ${type} evidence`);
  }
  return { entry, evidence: parsed.evidence } as {
    readonly entry: EventEnvelopeEntry;
    readonly evidence: Extract<TypedPresentedEvent, { readonly type: T }>;
  };
}

function agentHoardingEntry(): EventEnvelopeEntry {
  return entry("agent_started_hoarding", "wanderer_001", {
    message: "Joe now holds a hoard.",
    agent_id: "wanderer_001",
    region: "warm_springs",
    energy: 500,
    materials: 45,
  }, "local", "warm_springs", null);
}

function simulationStartedEntry(): EventEnvelopeEntry {
  return entry("simulation_started", "world", {
    message: "Simulation started: 4 agents breathing.",
    run_id: "seed-9-test",
    agent_count: 4,
    world_time: 100,
  }, "global", null, null);
}

function entry(
  type: PresentedEventType,
  source: string,
  payload: Record<string, unknown>,
  scope: EventEnvelopeEntry["event"]["scope"],
  region: string | null,
  target: string | null,
): EventEnvelopeEntry {
  return {
    cursor: 1,
    event: { type, source, payload, scope, region, target, timestamp: 100 },
    resolved: {},
    snapshot_after: null,
  };
}
