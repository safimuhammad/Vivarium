import { describe, expect, it } from "vitest";

import { EVENT_VISUAL_CATALOG } from "../../../events/eventVisualCatalog";
import { narrateStreamEvent, STREAM_VERBS } from "./streamNarrator";

const nameOf = (id: string): string => ({
  wanderer_001: "Joe",
  wanderer_002: "Mae",
  wanderer_003: "Dick",
  wanderer_004: "Allen",
  child_007: "Martha",
}[id] ?? "someone");

function narrate(
  type: string,
  payload: Readonly<Record<string, unknown>> = {},
  overrides: Partial<Parameters<typeof narrateStreamEvent>[0]> = {},
): ReturnType<typeof narrateStreamEvent> {
  return narrateStreamEvent({
    type,
    payload,
    actorName: "Joe",
    targetName: "Mae",
    regionLabel: "Warm Springs",
    nameOf,
    ...overrides,
  });
}

describe("narrateStreamEvent", () => {
  it("gives every canonical event type a non-empty sentence and a known verb", () => {
    for (const type of Object.keys(EVENT_VISUAL_CATALOG)) {
      const result = narrate(type);
      expect(result.line.length, `${type} produced an empty line`).toBeGreaterThan(0);
      expect(result.line.endsWith("."), `${type} line must end with a period`).toBe(true);
      expect(result.verb, `${type} must have a verb`).toBe(STREAM_VERBS[type]);
    }
  });

  it("falls back safely for an unknown type without throwing", () => {
    expect(narrate("not_a_real_event")).toMatchObject({
      verb: "acted",
      line: "Joe did something.",
      detail: null,
      quote: null,
    });
    expect(narrate("not_a_real_event", {}, { actorName: null }).line).toBe("Something happened.");
  });

  it("never surfaces a raw payload id in the sentence", () => {
    const result = narrate("agent_paralyzed", {
      victim_id: "wanderer_003",
      attacker_id: "wanderer_001",
      energy: 0,
    });
    expect(result.line).toBe("Dick has fallen.");
    expect(result.line).not.toMatch(/wanderer_/u);
    expect(result.detail).toBe("0 energy");
  });

  it("names the killer only when the killer is not the victim", () => {
    expect(narrate("agent_died", { attack_damage: 30, looted_energy: 12, looted_materials: 0 }).line)
      .toBe("Mae's journey ended, slain by Joe.");
    expect(narrate("agent_died", {}, { actorName: "Mae" }).line).toBe("Mae's journey ended.");
    expect(narrate("agent_died", { attack_damage: 30, looted_energy: 12 }).detail)
      .toBe("30 damage · 12 energy and 0 materials taken");
  });

  it("quotes only the four utterance types and preserves their supplied words exactly", () => {
    const long = `${"word ".repeat(60)}end`;
    expect(narrate("speak", { message: "Hold the line." }).quote).toBe("Hold the line.");
    expect(narrate("self_talk", { message: "I will keep this within." }).quote)
      .toBe("I will keep this within.");
    expect(narrate("mating_initiated", { message: "Will you?" }).quote).toBe("Will you?");
    expect(narrate("mating_rejected", { message: "Not this season." }).quote)
      .toBe("Not this season.");
    expect(narrate("attack", { message: "machine prose leaking ids" }).quote).toBeNull();
    expect(narrate("speak", { message: long }).quote).toBe(long);
  });

  it("distinguishes a whisper from a broadcast", () => {
    expect(narrate("speak", { target_id: "wanderer_002" }).line).toBe("Joe spoke low to Mae.");
    expect(narrate("speak", {}).line).toBe("Joe spoke at Warm Springs.");
    expect(narrate("speak", {}, { regionLabel: null }).line).toBe("Joe spoke.");
  });

  it("reads travel endpoints from the payload, not the resolved region", () => {
    expect(narrate("agent_entered_region", { to_region: "nirvana_east" }).line)
      .toBe("Joe reached Nirvana East.");
    expect(narrate("agent_left_region", { from_region: "warm_springs" }).line)
      .toBe("Joe left Warm Springs.");
  });

  it("names authoritative spatial journeys without surfacing their internal route", () => {
    expect(narrate("spatial_travel_started", { destination_id: "foraging_grove" }).line)
      .toBe("Joe began walking to Foraging Grove.");
    expect(narrate("spatial_travel_cancelled", { destination_id: "foraging_grove" }).line)
      .toBe("Joe came to rest on the way to Foraging Grove.");
    expect(narrate("spatial_travel_arrived", { destination_id: "foraging_grove" }).line)
      .toBe("Joe arrived at Foraging Grove.");
    expect(narrate("spatial_travel_started", {}, {
      spatialDestinationName: "Grove of Returns",
    }).line).toBe("Joe began walking to Grove of Returns.");
  });

  it("signs a spend and reports the holding for a resource change", () => {
    expect(narrate("resource_changed", {
      resource_type: "energy",
      amount: 2,
      agent_energy: 14,
    })).toMatchObject({
      line: "Joe gathered energy at Warm Springs.",
      detail: "+2 energy · holds 14",
    });
    expect(narrate("resource_changed", {
      resource_type: "materials",
      amount: -3,
      agent_materials: 7,
    })).toMatchObject({
      line: "Joe spent materials at Warm Springs.",
      detail: "-3 materials · holds 7",
    });
  });

  it("names the newborn and its parents from the payload", () => {
    expect(narrate("agent_born", {
      child_name: "Martha",
      parent_ids: ["wanderer_001", "wanderer_002"],
      child_resources: { energy: 80, materials: 48 },
    })).toMatchObject({
      line: "A new life — Martha.",
      detail: "parents Joe and Mae · 80 energy, 48 materials",
    });
  });

  it("counts the raiding party without naming ids", () => {
    expect(narrate("home_thieved", {
      recipients: ["wanderer_002", "wanderer_004"],
      loot: { materials: 40 },
    })).toMatchObject({
      line: "Joe and 1 other stripped a home's vault.",
      detail: "40 materials taken",
    });
  });

  it("marks a breach that means to take the home", () => {
    expect(narrate("home_breached", { intent: "colonize", integrity: 12 }).line)
      .toBe("Joe broke into a home at Warm Springs, meaning to take it.");
    expect(narrate("home_breached", { intent: "loot" }).line)
      .toBe("Joe broke into a home at Warm Springs.");
  });

  it("keeps the world's own acts free of a false actor", () => {
    expect(narrate("simulation_started", { agent_count: 5 }, { actorName: null }).line)
      .toBe("The world wakes — 5 beings breathing.");
    expect(narrate("simulation_started", { agent_count: 1 }, { actorName: null }).line)
      .toBe("The world wakes — 1 being breathing.");
    expect(narrate("home_collapsed", { remnant_materials: 40 }, { actorName: null }))
      .toMatchObject({
        line: "A home at Warm Springs has fallen to ruin.",
        detail: "40 materials left in the rubble",
      });
  });
});
