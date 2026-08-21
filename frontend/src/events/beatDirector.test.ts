import { describe, expect, it } from "vitest";

import type { EventEnvelopeEntry, SerializedEvent } from "../app/schemas";
import { BeatDirector } from "./beatDirector";

function entry(
  cursor: number,
  type: string,
  payload: Record<string, unknown>,
  resolved: EventEnvelopeEntry["resolved"],
  overrides: Partial<SerializedEvent> = {},
): EventEnvelopeEntry {
  return {
    cursor,
    event: {
      type,
      source: overrides.source ?? (typeof resolved.actor_id === "string" ? resolved.actor_id : "system"),
      payload,
      scope: overrides.scope ?? "local",
      region: overrides.region ?? (typeof resolved.region === "string" ? resolved.region : null),
      target: overrides.target ?? (typeof resolved.target_id === "string" ? resolved.target_id : null),
      timestamp: overrides.timestamp ?? cursor / 10,
    },
    resolved,
    snapshot_after: null,
  };
}

describe("BeatDirector", () => {
  it("groups recovery even when the recovery event arrives before the transfer event", () => {
    const director = new BeatDirector({ groupingWindowMs: 500 });
    const recovered = entry(
      10,
      "agent_recovered",
      {
        giver_id: "agent_001",
        recipient_id: "agent_002",
        revived_id: "agent_002",
        region: "warm_springs",
        resource_type: "energy",
        amount: 8,
      },
      { actor_id: "agent_001", target_id: "agent_002", region: "warm_springs" },
      { timestamp: 20 },
    );
    const transfer = entry(
      11,
      "resource_transferred",
      {
        sender_id: "agent_001",
        receiver_id: "agent_002",
        region: "warm_springs",
        resource_type: "energy",
        amount: 8,
      },
      { actor_id: "agent_001", target_id: "agent_002", region: "warm_springs" },
      { timestamp: 20.2, target: "agent_002" },
    );

    director.enqueue([recovered], 1_000);
    expect(director.drain(1_000).visualBeats).toEqual([]);
    director.enqueue([transfer], 1_050);
    const result = director.drain(1_050);

    expect(result.visualBeats.map((beat) => beat.event.type)).toEqual(["agent_recovered"]);
    expect(result.handledCursors).toEqual([11]);
    expect(result.pendingCount).toBe(0);
  });

  it("does not group recovery with a transfer of a different resource", () => {
    const director = new BeatDirector({ groupingWindowMs: 500 });
    const recovered = entry(
      10,
      "agent_recovered",
      {
        giver_id: "agent_001",
        revived_id: "agent_002",
        region: "warm_springs",
        resource_type: "energy",
        amount: 8,
      },
      { actor_id: "agent_001", target_id: "agent_002", region: "warm_springs", resource_type: "energy", amount: 8 },
      { timestamp: 20, target: "agent_002" },
    );
    const transfer = entry(
      11,
      "resource_transferred",
      {
        sender_id: "agent_001",
        receiver_id: "agent_002",
        region: "warm_springs",
        resource_type: "materials",
        amount: 8,
      },
      { actor_id: "agent_001", target_id: "agent_002", region: "warm_springs", resource_type: "materials", amount: 8 },
      { timestamp: 20.1, target: "agent_002" },
    );

    director.enqueue([recovered, transfer], 1_000);
    const result = director.drain(1_600);

    expect(result.visualBeats.map((beat) => beat.event.type)).toEqual([
      "agent_recovered",
      "resource_transferred",
    ]);
    expect(result.handledCursors).toEqual([]);
  });

  it("does not group recovery when resource details are missing", () => {
    const director = new BeatDirector({ groupingWindowMs: 500 });
    const recovered = entry(
      10,
      "agent_recovered",
      { giver_id: "agent_001", revived_id: "agent_002", region: "warm_springs" },
      { actor_id: "agent_001", target_id: "agent_002", region: "warm_springs" },
      { timestamp: 20, target: "agent_002" },
    );
    const transfer = entry(
      11,
      "resource_transferred",
      { sender_id: "agent_001", receiver_id: "agent_002", region: "warm_springs" },
      { actor_id: "agent_001", target_id: "agent_002", region: "warm_springs" },
      { timestamp: 20.1, target: "agent_002" },
    );

    director.enqueue([recovered, transfer], 1_000);
    const result = director.drain(1_600);

    expect(result.visualBeats.map((beat) => beat.event.type)).toEqual([
      "agent_recovered",
      "resource_transferred",
    ]);
    expect(result.handledCursors).toEqual([]);
  });

  it("groups transfer and hearth hoarding with their primary event", () => {
    const director = new BeatDirector({ groupingWindowMs: 500 });
    const transfer = entry(
      20,
      "resource_transferred",
      {
        sender_id: "agent_001",
        receiver_id: "agent_002",
        region: "warm_springs",
        resource_type: "energy",
        amount: 40,
      },
      { actor_id: "agent_001", target_id: "agent_002", region: "warm_springs", resource_type: "energy", amount: 40 },
      { timestamp: 30, target: "agent_002" },
    );
    const transferHoarding = entry(
      21,
      "agent_started_hoarding",
      { agent_id: "agent_002", region: "warm_springs", energy: 520, materials: 4 },
      { actor_id: "agent_002", region: "warm_springs" },
      { timestamp: 30.1 },
    );
    const hearth = entry(
      22,
      "hearth_used",
      { agent_id: "agent_001", home_id: "home_001", region: "warm_springs", energy_gained: 20 },
      { actor_id: "agent_001", home_id: "home_001", region: "warm_springs" },
      { timestamp: 30.2 },
    );
    const hearthHoarding = entry(
      23,
      "agent_started_hoarding",
      { agent_id: "agent_001", region: "warm_springs", energy: 510, materials: 12 },
      { actor_id: "agent_001", region: "warm_springs" },
      { timestamp: 30.3 },
    );

    director.enqueue([transfer, transferHoarding, hearth, hearthHoarding], 1_000);
    const result = director.drain(1_000);

    expect(result.visualBeats.map((beat) => beat.cursor)).toEqual([21, 23]);
    expect(result.visualBeatGroups.map((group) => ({
      visualCursor: group.visual.cursor,
      entryCursors: group.entries.map((groupEntry) => groupEntry.cursor),
      skippedCursors: group.skipped.map((groupEntry) => groupEntry.cursor),
    }))).toEqual([
      { visualCursor: 21, entryCursors: [20, 21], skippedCursors: [20] },
      { visualCursor: 23, entryCursors: [22, 23], skippedCursors: [22] },
    ]);
    expect(result.handledCursors).toEqual([20, 22]);
  });

  it("groups lethal combat and the fallen-state event into the death beat", () => {
    const director = new BeatDirector({ groupingWindowMs: 500 });
    const attack = entry(
      30,
      "attack",
      { attacker_id: "agent_003", victim_id: "agent_002", region: "nirvana_west" },
      { actor_id: "agent_003", target_id: "agent_002", region: "nirvana_west" },
      { timestamp: 40, target: "agent_002" },
    );
    const death = entry(
      31,
      "agent_died",
      { killer_id: "agent_003", victim_id: "agent_002", region: "nirvana_west" },
      { actor_id: "agent_003", target_id: "agent_002", region: "nirvana_west" },
      { timestamp: 40.1, target: "agent_003" },
    );
    const fallen = entry(
      32,
      "agent_paralyzed",
      { attacker_id: "agent_003", agent_id: "agent_002", victim_id: "agent_002", region: "nirvana_west" },
      { actor_id: "agent_003", target_id: "agent_002", region: "nirvana_west" },
      { timestamp: 40.2, source: "system" },
    );

    director.enqueue([attack, death, fallen], 1_000);
    const result = director.drain(1_000);

    expect(result.visualBeats.map((beat) => beat.event.type)).toEqual(["agent_died"]);
    expect(result.visualBeatGroups.map((group) => ({
      visualCursor: group.visual.cursor,
      entryCursors: group.entries.map((groupEntry) => groupEntry.cursor),
      skippedCursors: group.skipped.map((groupEntry) => groupEntry.cursor),
    }))).toEqual([
      { visualCursor: 31, entryCursors: [30, 31, 32], skippedCursors: [30, 32] },
    ]);
    expect(result.handledCursors).toEqual([30, 32]);
  });

  it("groups harvest hoard crossings into the hoard beat", () => {
    const director = new BeatDirector({ groupingWindowMs: 500 });
    const harvest = entry(
      40,
      "resource_changed",
      { agent_id: "agent_001", region: "warm_springs", resource_type: "materials", amount: 20 },
      { actor_id: "agent_001", region: "warm_springs", resource_type: "materials", amount: 20 },
      { timestamp: 50 },
    );
    const hoarding = entry(
      41,
      "agent_started_hoarding",
      { agent_id: "agent_001", region: "warm_springs", energy: 80, materials: 320 },
      { actor_id: "agent_001", region: "warm_springs" },
      { timestamp: 50.1 },
    );

    director.enqueue([harvest, hoarding], 1_000);
    const result = director.drain(1_000);

    expect(result.visualBeats.map((beat) => beat.event.type)).toEqual(["agent_started_hoarding"]);
    expect(result.handledCursors).toEqual([40]);
  });

  it("groups successful colonize breaches into the seized-home beat", () => {
    const director = new BeatDirector({ groupingWindowMs: 500 });
    const breach = entry(
      50,
      "home_breached",
      { home_id: "home_002", target_home: "home_002", breacher_id: "agent_003", intent: "colonize", region: "warm_springs" },
      { actor_id: "agent_003", home_id: "home_002", region: "warm_springs" },
      { timestamp: 60 },
    );
    const colonized = entry(
      51,
      "home_colonized",
      { home_id: "home_002", target_home: "home_002", breacher_id: "agent_003", new_owner_id: "agent_003", region: "warm_springs" },
      { actor_id: "agent_003", home_id: "home_002", region: "warm_springs" },
      { timestamp: 60.1 },
    );

    director.enqueue([breach, colonized], 1_000);
    const result = director.drain(1_000);

    expect(result.visualBeats.map((beat) => beat.event.type)).toEqual(["home_colonized"]);
    expect(result.handledCursors).toEqual([50]);
  });

  it("flushes unmatched groupable events after the grouping window", () => {
    const director = new BeatDirector({ groupingWindowMs: 500 });
    const left = entry(
      5,
      "agent_left_region",
      { agent_id: "agent_001", from_region: "nirvana", to_region: "warm_springs" },
      { actor_id: "agent_001", region: "nirvana" },
      { timestamp: 30 },
    );

    director.enqueue([left], 2_000);

    expect(director.drain(2_300).visualBeats).toEqual([]);
    expect(director.drain(2_501).visualBeats.map((beat) => beat.event.type)).toEqual([
      "agent_left_region",
    ]);
    expect(director.pendingCount()).toBe(0);
  });

  it("does not group related events outside the timestamp window", () => {
    const director = new BeatDirector({ groupingWindowMs: 500 });
    const breach = entry(
      20,
      "home_breached",
      { home_id: "home_001", target_home: "home_001", breacher_id: "agent_003", region: "warm_springs" },
      { actor_id: "agent_003", home_id: "home_001", region: "warm_springs" },
      { timestamp: 40 },
    );
    const thieved = entry(
      21,
      "home_thieved",
      { home_id: "home_001", target_home: "home_001", breacher_id: "agent_003", region: "warm_springs" },
      { actor_id: "agent_003", home_id: "home_001", region: "warm_springs" },
      { timestamp: 41 },
    );

    director.enqueue([breach, thieved], 3_000);
    const result = director.drain(3_600);

    expect(result.visualBeats.map((beat) => beat.event.type)).toEqual([
      "home_breached",
      "home_thieved",
    ]);
    expect(result.handledCursors).toEqual([]);
  });

  it("does not group related events outside the cursor window", () => {
    const director = new BeatDirector({ groupingWindowMs: 500 });
    const hearth = entry(
      30,
      "hearth_used",
      { agent_id: "agent_001", home_id: "home_001", region: "warm_springs" },
      { actor_id: "agent_001", home_id: "home_001", region: "warm_springs" },
      { timestamp: 50 },
    );
    const hoarding = entry(
      34,
      "agent_started_hoarding",
      { agent_id: "agent_001", region: "warm_springs", energy: 510, materials: 12 },
      { actor_id: "agent_001", region: "warm_springs" },
      { timestamp: 50.1 },
    );

    director.enqueue([hearth, hoarding], 1_000);
    const result = director.drain(1_600);

    expect(result.visualBeats.map((beat) => beat.event.type)).toEqual([
      "hearth_used",
      "agent_started_hoarding",
    ]);
    expect(result.handledCursors).toEqual([]);
  });

  it("drops buffered events at or before an authoritative snapshot cursor", () => {
    const director = new BeatDirector({ groupingWindowMs: 500 });
    director.enqueue([
      entry(
        7,
        "resource_transferred",
        { sender_id: "agent_001", receiver_id: "agent_002" },
        { actor_id: "agent_001", target_id: "agent_002" },
      ),
      entry(
        9,
        "speak",
        { speaker_id: "agent_001", message: "still here" },
        { actor_id: "agent_001" },
      ),
    ]);

    director.advanceCursor(8);
    const result = director.drain();

    expect(result.visualBeats.map((beat) => beat.cursor)).toEqual([9]);
  });
});
