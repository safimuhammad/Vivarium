import { describe, expect, it } from "vitest";

import type { EventEnvelopeEntry } from "../app/schemas";
import { getChronicleManifest } from "./fixtures/chronicleCatalog";
import { BeatDirector } from "./BeatDirector";

describe("production BeatDirector", () => {
  it("groups C12 into contiguous causal moments without deleting evidence", () => {
    const moments = new BeatDirector().group(getChronicleManifest("C12").entries);

    expect(moments.map((moment) => [
      moment.firstCursor,
      moment.lastCursor,
      moment.chainKind,
      moment.representative.cursor,
    ])).toEqual([
      [1, 1, "single", 1],
      [2, 2, "single", 2],
      [3, 3, "single", 3],
      [4, 4, "single", 4],
      [5, 5, "single", 5],
      [6, 6, "single", 6],
      [7, 8, "strike-fall", 8],
      [9, 10, "gift-recovery", 9],
      [11, 12, "travel", 12],
    ]);
    expect(moments.flatMap((moment) => moment.evidenceCursors)).toEqual(
      Array.from({ length: 12 }, (_, index) => index + 1),
    );
    expect(moments[7].representative.cursor).toBeLessThan(moments[7].lastCursor);
    expect(moments[8].representative.cursor).toBe(moments[8].lastCursor);
  });

  it("groups the frozen recovery-before-transfer emission order", () => {
    const evidence = getChronicleManifest("C12").entries.slice(8, 10);
    const [moment] = new BeatDirector().group(evidence);

    expect(evidence.map((entry) => entry.event.type)).toEqual([
      "agent_recovered",
      "resource_transferred",
    ]);
    expect(moment.chainKind).toBe("gift-recovery");
    expect(moment.representative.event.type).toBe("agent_recovered");
    expect(moment.evidence).toEqual(evidence);
  });

  it("refuses to group related evidence when an unrelated cursor interrupts it", () => {
    const [left, entered] = getChronicleManifest("C12").entries.slice(-2);
    const unrelated: EventEnvelopeEntry = {
      ...getChronicleManifest("C12").entries[0],
      cursor: left.cursor + 1,
      event: { ...getChronicleManifest("C12").entries[0].event, timestamp: left.event.timestamp + 0.01 },
    };
    const shiftedArrival: EventEnvelopeEntry = {
      ...entered,
      cursor: entered.cursor + 1,
      event: { ...entered.event, timestamp: entered.event.timestamp + 0.01 },
    };

    const moments = new BeatDirector().group([left, unrelated, shiftedArrival]);

    expect(moments.map((moment) => moment.chainKind)).toEqual(["single", "single", "single"]);
    expect(moments.map((moment) => moment.evidenceCursors)).toEqual([[11], [12], [13]]);
  });

  it("suppresses duplicate cursors and emits strictly monotonic owned moments", () => {
    const entries = getChronicleManifest("C17").entries;
    const moments = new BeatDirector().group([entries[0], entries[0], entries[1], entries[2]]);

    expect(moments.map((moment) => moment.firstCursor)).toEqual([1, 2, 3]);
    expect(moments[2].evidence[0].event.scope).toBe("private");
    expect(moments[2].focus).toEqual({ kind: "agent", id: "wanderer_001" });
  });

  it("rejects a duplicate cursor whose evidence is not byte-equivalent", () => {
    const first = getChronicleManifest("C17").entries[0];
    const conflicting = {
      ...first,
      event: { ...first.event, payload: { ...first.event.payload, message: "conflict" } },
    };

    expect(() => new BeatDirector().group([first, conflicting])).toThrow(
      "conflicting evidence for cursor 1",
    );
  });

  it("keeps an unrelated moment before a grouped after-context", () => {
    const unrelated = getChronicleManifest("C17").entries[0];
    const [breach, theft] = getChronicleManifest("C07").entries.filter((entry) =>
      entry.event.type === "home_breached" || entry.event.type === "home_thieved"
    ).map((entry, index) => ({
      ...entry,
      cursor: index + 2,
      event: { ...entry.event, timestamp: unrelated.event.timestamp + index + 1 },
    }));
    const moments = new BeatDirector().group([unrelated, breach, theft]);

    expect(moments.map((moment) => moment.evidenceCursors)).toEqual([[1], [2, 3]]);
    expect(moments[1].afterContext).toBe("breach-theft");
  });

  it("keeps death standalone even beside combat evidence", () => {
    const [attack, paralyzed] = getChronicleManifest("C12").entries.slice(6, 8);
    const death: EventEnvelopeEntry = {
      ...paralyzed,
      cursor: 9,
      event: {
        ...paralyzed.event,
        type: "agent_died",
        source: "wanderer_004",
        payload: {
          killer_id: "wanderer_003",
          victim_id: "wanderer_004",
          region: "nirvana",
          loot: { energy: 0, materials: 0 },
        },
      },
    };

    const moments = new BeatDirector().group([attack, paralyzed, death]);

    expect(moments.map((moment) => [moment.chainKind, moment.evidenceCursors])).toEqual([
      ["strike-fall", [7, 8]],
      ["single", [9]],
    ]);
    expect(moments[1].priority).toBe("drama");
  });

  it("retains C17 local, targeted, and private attribution without merging privacy scopes", () => {
    const moments = new BeatDirector().group(getChronicleManifest("C17").entries);

    expect(moments.map((moment) => ({
      scope: moment.evidence[0].event.scope,
      source: moment.evidence[0].event.source,
      target: moment.evidence[0].event.target,
      focus: moment.focus,
      message: moment.evidence[0].event.payload.message,
    }))).toEqual([
      {
        scope: "local",
        source: "wanderer_001",
        target: null,
        focus: { kind: "agent", id: "wanderer_001" },
        message: "Mae, the springs are quiet.",
      },
      {
        scope: "targeted",
        source: "wanderer_001",
        target: "wanderer_003",
        focus: { kind: "agent", id: "wanderer_001" },
        message: "Dick, can you hear me?",
      },
      {
        scope: "private",
        source: "wanderer_001",
        target: null,
        focus: { kind: "agent", id: "wanderer_001" },
        message: "I will keep this thought within.",
      },
    ]);
  });
});
