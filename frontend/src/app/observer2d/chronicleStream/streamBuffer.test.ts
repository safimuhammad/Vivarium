import { describe, expect, it } from "vitest";

import type { EventEnvelopeEntry } from "../../schemas";
import type { PresentedRecord, PresentedWorldView } from "../../../presentation/contracts";
import type { AgentSnapshot, HomeSnapshot } from "../../schemas";
import { frameEntityIdDenylist } from "../publicCopy";
import { createChronicleStreamBuffer, DEFAULT_STREAM_BUFFER_MS } from "./streamBuffer";

/** No frame in these unit tests, so nothing is denied beyond the id-shape rule. */
const NO_DENIED_IDS = frameEntityIdDenylist({
  world: { agents: [], homes: [], ruins: [] },
  selection: null,
} as never);

function entry(
  cursor: number,
  type: string,
  payload: Readonly<Record<string, unknown>> = {},
  resolved: EventEnvelopeEntry["resolved"] = {},
): EventEnvelopeEntry {
  return {
    cursor,
    event: {
      type,
      source: "test",
      payload: { ...payload },
      scope: "global",
      region: (resolved.region as string | undefined) ?? null,
      target: null,
      timestamp: 1_000 + cursor,
    },
    resolved,
    snapshot_after: null,
  };
}

function agent(overrides: Partial<AgentSnapshot>): PresentedRecord<AgentSnapshot> {
  return {
    completeness: "exact",
    value: {
      id: "wanderer_001",
      name: "Joe",
      position: "nirvana",
      status: "alive",
      energy: 50,
      materials: 10,
      offspring_count: 0,
      home_id: null,
      is_hoarding: false,
      ...overrides,
    },
  };
}

function home(overrides: Partial<HomeSnapshot>): HomeSnapshot {
  return {
    home_id: "home_001",
    owner_id: "wanderer_001",
    region: "nirvana",
    integrity: 100,
    max_integrity: 100,
    built_at: 0,
    last_upkeep_at: 0,
    last_integrity_at: 0,
    stakeholders: [],
    vault_materials: 0,
    status: "standing",
    ruined_at: null,
    remnant_materials: 0,
    breachers: [],
    is_hoarding: false,
    ...overrides,
  };
}

function world(
  exactBaseCursor: number,
  projectedThroughCursor: number,
  overrides: Partial<PresentedWorldView> = {},
): PresentedWorldView {
  return {
    exactBaseCursor,
    projectedThroughCursor,
    worldTime: exactBaseCursor,
    agents: [agent({})],
    regions: [],
    homes: [],
    ruins: [],
    pendingProposals: [],
    ...overrides,
  };
}

describe("createChronicleStreamBuffer", () => {
  it("stamps events on the feed clock and keeps them in cursor order", () => {
    let now = 0;
    const buffer = createChronicleStreamBuffer({ now: () => now });
    buffer.ingest({ sourceKey: "s1", world: world(0, 1), entries: [entry(1, "speak")], deniedIds: NO_DENIED_IDS });
    now = 400;
    buffer.ingest({ sourceKey: "s1", world: world(0, 2), entries: [entry(2, "attack")], deniedIds: NO_DENIED_IDS });

    const events = buffer.getEvents();
    expect(events.map((event) => event.cursor)).toEqual([1, 2]);
    expect(events.map((event) => event.atMs)).toEqual([0, 400]);
    expect(buffer.getLiveMs()).toBe(400);
  });

  it("ignores a cursor it has already taken and re-sorts out-of-order arrivals", () => {
    let now = 0;
    const buffer = createChronicleStreamBuffer({ now: () => now });
    buffer.ingest({ sourceKey: "s1", world: world(0, 2), entries: [entry(2, "speak")], deniedIds: NO_DENIED_IDS });
    now = 100;
    buffer.ingest({
      sourceKey: "s1",
      world: world(0, 2),
      deniedIds: NO_DENIED_IDS,
      entries: [entry(2, "speak"), entry(1, "self_talk")],
    });
    expect(buffer.getEvents().map((event) => event.cursor)).toEqual([1, 2]);
    expect(buffer.diagnostics().eventCount).toBe(2);
  });

  it("resets everything when the run's source key changes", () => {
    const buffer = createChronicleStreamBuffer({ now: () => 0 });
    buffer.ingest({ sourceKey: "s1", world: world(0, 1), entries: [entry(1, "speak")], deniedIds: NO_DENIED_IDS });
    buffer.ingest({ sourceKey: "s2", world: world(0, 1), entries: [entry(1, "attack")], deniedIds: NO_DENIED_IDS });
    const events = buffer.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.id).toBe("s2:1");
    expect(buffer.diagnostics().anchorCount).toBe(1);
  });

  it("retains one world anchor per checkpoint and evicts past the window", () => {
    let now = 0;
    const buffer = createChronicleStreamBuffer({ now: () => now, bufferMs: 1_000 });
    buffer.ingest({ sourceKey: "s1", world: world(0, 1), entries: [entry(1, "speak")], deniedIds: NO_DENIED_IDS });
    now = 500;
    buffer.ingest({ sourceKey: "s1", world: world(5, 6), entries: [entry(6, "speak")], deniedIds: NO_DENIED_IDS });
    expect(buffer.diagnostics().anchorCount).toBe(2);

    now = 2_000;
    buffer.ingest({ sourceKey: "s1", world: world(9, 10), entries: [entry(10, "speak")], deniedIds: NO_DENIED_IDS });
    // Everything older than liveMs - bufferMs has left the feed...
    expect(buffer.getEvents().map((event) => event.cursor)).toEqual([10]);
    expect(buffer.diagnostics().evictedCount).toBe(2);
    // ...but one anchor at or below the oldest retained event must survive, or
    // a viewer scrubbing to the floor could not re-derive the world there.
    const anchors = buffer.diagnostics().anchorCursors;
    expect(anchors.length).toBeGreaterThanOrEqual(1);
    expect(Math.min(...anchors)).toBeLessThanOrEqual(10);
  });

  it("never re-admits an event that has already aged out of the window", () => {
    let now = 0;
    const buffer = createChronicleStreamBuffer({ now: () => now, bufferMs: 1_000 });
    buffer.ingest({
      sourceKey: "s1",
      world: world(0, 2),
      deniedIds: NO_DENIED_IDS,
      entries: [entry(1, "speak"), entry(2, "speak")],
    });
    now = 5_000;
    buffer.ingest({
      sourceKey: "s1",
      world: world(0, 3),
      deniedIds: NO_DENIED_IDS,
      entries: [entry(3, "speak")],
    });
    expect(buffer.getEvents().map((event) => event.cursor)).toEqual([3]);
    expect(buffer.getEvictedCount()).toBe(2);

    // The chronicle window still carries those older moments, and re-offers them
    // on the very next frame. Taking them back would stamp a cursor-1 event with
    // a cursor-3 arrival time -- which is how a burst heading came to read
    // "17 IN -65.8S" in the browser.
    now = 5_100;
    buffer.ingest({
      sourceKey: "s1",
      world: world(0, 3),
      deniedIds: NO_DENIED_IDS,
      entries: [entry(1, "speak"), entry(2, "speak"), entry(3, "speak")],
    });
    expect(buffer.getEvents().map((event) => event.cursor)).toEqual([3]);
    expect(buffer.getEvictedCount()).toBe(2);

    const stamps = buffer.getEvents().map((event) => event.atMs);
    expect([...stamps].sort((left, right) => left - right)).toEqual(stamps);
  });

  it("derives presence from the nearest preceding anchor, not from cursor 0", () => {
    let now = 0;
    const buffer = createChronicleStreamBuffer({ now: () => now });
    // Anchor at cursor 10 already knows Dick is in Nirvana and the home stands.
    buffer.ingest({
      sourceKey: "s1",
      world: world(10, 10, {
        agents: [
          agent({ id: "wanderer_003", name: "Dick", position: "nirvana" }),
          agent({ id: "wanderer_002", name: "Mae", position: "nirvana" }),
        ],
        homes: [{ completeness: "exact", value: home({}) }],
        exactHomes: [home({})],
      }),
      deniedIds: NO_DENIED_IDS,
      entries: [entry(10, "speak", {}, { actor_id: "wanderer_003", region: "nirvana" })],
    });
    now = 100;
    buffer.ingest({
      sourceKey: "s1",
      world: world(10, 12),
      deniedIds: NO_DENIED_IDS,
      entries: [
        entry(11, "agent_died", { victim_id: "wanderer_003", killer_id: "wanderer_002" }),
        entry(12, "home_collapsed", { home_id: "home_001", remnant_materials: 40 }, {
          home_id: "home_001",
          region: "nirvana",
        }),
      ],
    });

    const atAnchor = buffer.derivePresence(10);
    expect(atAnchor.gone.has("wanderer_003")).toBe(false);
    expect(atAnchor.built.has("home_001")).toBe(true);
    expect(atAnchor.ruined.has("home_001")).toBe(false);
    expect(atAnchor.replayedEventCount).toBe(0);

    const atLive = buffer.derivePresence(12);
    expect(atLive.gone.has("wanderer_003")).toBe(true);
    expect(atLive.ruined.has("home_001")).toBe(true);
    expect(atLive.built.has("home_001")).toBe(false);
    // The whole point: two events replayed, not twelve.
    expect(atLive.replayedEventCount).toBe(2);
  });

  it("bounds replay work by the checkpoint interval, not by run length", () => {
    let now = 0;
    const buffer = createChronicleStreamBuffer({ now: () => now, bufferMs: 10 ** 7 });
    for (let cursor = 1; cursor <= 400; cursor += 1) {
      now = cursor * 10;
      const exactBase = Math.floor((cursor - 1) / 50) * 50;
      buffer.ingest({
        sourceKey: "s1",
        world: world(exactBase, cursor),
        deniedIds: NO_DENIED_IDS,
      entries: [entry(cursor, "speak", {}, { actor_id: "wanderer_001", region: "nirvana" })],
      });
    }
    expect(buffer.getEvents()).toHaveLength(400);
    // 400 events held, but a derivation never walks more than one checkpoint's
    // worth of them.
    expect(buffer.derivePresence(400).replayedEventCount).toBeLessThanOrEqual(50);
    expect(buffer.derivePresence(120).replayedEventCount).toBeLessThanOrEqual(50);
  });

  it("seeds the standing strip from the anchor's exact world, then replays", () => {
    let now = 0;
    const buffer = createChronicleStreamBuffer({ now: () => now });
    buffer.ingest({
      sourceKey: "s1",
      world: world(4, 4, {
        agents: [agent({ id: "wanderer_003", name: "Dick", status: "paralyzed" })],
        homes: [{ completeness: "exact", value: home({ breachers: ["wanderer_002"] }) }],
        exactHomes: [home({ breachers: ["wanderer_002"] })],
      }),
      deniedIds: NO_DENIED_IDS,
      entries: [entry(4, "speak", {}, { actor_id: "wanderer_003" })],
    });
    const seeded = buffer.deriveStanding(4);
    expect(seeded.map((condition) => condition.key).sort()).toEqual(["breached", "fallen"]);

    now = 50;
    buffer.ingest({
      sourceKey: "s1",
      world: world(4, 5),
      deniedIds: NO_DENIED_IDS,
      entries: [entry(5, "agent_recovered", {
        revived_id: "wanderer_003",
      }, { actor_id: "wanderer_002", target_id: "wanderer_003" })],
    });
    expect(buffer.deriveStanding(5).map((condition) => condition.key)).toEqual(["breached"]);
  });

  it("reports a measurable memory bill", () => {
    const buffer = createChronicleStreamBuffer({ now: () => 0 });
    buffer.ingest({
      sourceKey: "s1",
      world: world(0, 1, {
        agents: [agent({}), agent({ id: "wanderer_002", name: "Mae" })],
      }),
      deniedIds: NO_DENIED_IDS,
      entries: [entry(1, "speak", { message: "Hold the line." })],
    });
    const diagnostics = buffer.diagnostics();
    expect(diagnostics.eventBytes).toBeGreaterThan(0);
    expect(diagnostics.anchorBytes).toBeGreaterThan(0);
    expect(diagnostics.approxBytes).toBe(diagnostics.eventBytes + diagnostics.anchorBytes);
  });

  it("defaults to a ninety-second retention window", () => {
    expect(DEFAULT_STREAM_BUFFER_MS).toBe(90_000);
  });
});
