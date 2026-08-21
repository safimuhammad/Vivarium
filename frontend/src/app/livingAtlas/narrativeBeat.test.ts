import { describe, expect, it } from "vitest";

import { makeEventEnvelope } from "../../test/fixtures";
import {
  selectPresentedHistory,
  type ChronicleHistoryEntry,
  type PresentedHistoryEvent,
  type PresentedHistoryItem,
} from "../historySelectors";
import type {
  EventEnvelopeEntry,
  ResolvedEventHints,
} from "../schemas";
import {
  focusTargetForBeat,
  selectStoryRibbonBeats,
} from "./narrativeBeat";

function fixturePresentedBeats(
  types: readonly string[],
  resolved: ResolvedEventHints = {
    actor_id: "agent_001",
    region: "meadow",
  },
): PresentedHistoryEvent[] {
  const base = makeEventEnvelope().events[0];
  if (!base) {
    throw new Error("The event fixture must include one event.");
  }
  const history: ChronicleHistoryEntry[] = types.map((type, index) => {
    const entry: EventEnvelopeEntry = {
      ...base,
      cursor: index + 1,
      event: {
        ...base.event,
        type,
        source: type === "simulation_started" ? "system" : base.event.source,
        timestamp: index + 1,
      },
      resolved: { ...resolved },
    };
    return { kind: "event", entry };
  });
  return selectPresentedHistory(history).filter(
    (item): item is PresentedHistoryEvent => item.kind === "event",
  );
}

function fixturePresentedBeat(
  type: string,
  resolved: ResolvedEventHints,
): PresentedHistoryEvent {
  const beat = fixturePresentedBeats([type], resolved)[0];
  if (!beat) {
    throw new Error(`Missing fixture beat for ${type}.`);
  }
  return beat;
}

describe("selectStoryRibbonBeats", () => {
  it("caps desktop at three and lets drama preempt older ambience", () => {
    const presented = fixturePresentedBeats([
      "resource_changed",
      "speak",
      "agent_born",
      "agent_died",
    ]);

    const beats = selectStoryRibbonBeats(presented, "desktop");

    expect(beats.map((beat) => [beat.cursor, beat.type, beat.priority])).toEqual([
      [2, "speak", "featured"],
      [3, "agent_born", "featured"],
      [4, "agent_died", "drama"],
    ]);
  });

  it("caps mobile at one highest-attention beat", () => {
    const presented = fixturePresentedBeats([
      "resource_changed",
      "agent_died",
      "speak",
    ]);

    expect(selectStoryRibbonBeats(presented, "mobile").map((beat) => beat.type)).toEqual([
      "agent_died",
    ]);
  });

  it("ranks within a recent attention window so ancient drama cannot monopolize mobile", () => {
    const presented = fixturePresentedBeats([
      "agent_died",
      ...Array.from({ length: 24 }, () => "resource_changed"),
    ]);

    expect(selectStoryRibbonBeats(presented, "mobile")).toMatchObject([
      { cursor: 25, type: "resource_changed", priority: "ambient" },
    ]);
  });

  it("excludes gaps and private thought from the world ribbon", () => {
    const [thought, speech] = fixturePresentedBeats(["self_talk", "speak"]);
    if (!thought || !speech) {
      throw new Error("Expected private-thought and speech fixtures.");
    }
    const items: PresentedHistoryItem[] = [
      thought,
      {
        kind: "gap",
        id: "gap-1",
        reason: "overflow",
        message: "Earlier events are no longer retained.",
        afterCursor: 0,
        beforeCursor: 1,
        nextCursor: 1,
        timestamp: null,
        sortCursor: 0,
      },
      speech,
    ];

    expect(selectStoryRibbonBeats(items, "desktop").map((beat) => beat.type)).toEqual([
      "speak",
    ]);
  });

  it("projects presented copy and chain windows without reading raw payload prose", () => {
    const presented = fixturePresentedBeat("speak", {
      actor_id: "agent_001",
      region: "meadow",
    });
    const chained: PresentedHistoryEvent = {
      ...presented,
      compactDetail: { kind: "open-speech", text: "heard in Meadow" },
      chainDetail: {
        kind: "crossing",
        text: "crossing complete",
        count: 2,
        startCursor: 7,
        endCursor: 8,
        window: "7-8",
      },
    };

    expect(selectStoryRibbonBeats([chained], "desktop")[0]).toMatchObject({
      cursorWindow: "7-8",
      label: chained.label,
      detail: "heard in Meadow",
      presented: chained,
    });
  });
});

describe("focusTargetForBeat", () => {
  it("prefers home, then agent, then region structured hints", () => {
    expect(focusTargetForBeat(fixturePresentedBeat("home_thieved", {
      home_id: "home_1",
      actor_id: "wanderer_1",
      region: "nirvana",
    }))).toEqual({ kind: "home", id: "home_1" });

    expect(focusTargetForBeat(fixturePresentedBeat("speak", {
      actor_id: "wanderer_1",
      region: "nirvana",
    }))).toEqual({ kind: "agent", id: "wanderer_1" });

    expect(focusTargetForBeat(fixturePresentedBeat("simulation_started", {
      region: "nirvana",
    }))).toEqual({ kind: "region", id: "nirvana" });
  });

  it("returns no focus when presentation has no structured relationship", () => {
    const presented = fixturePresentedBeat("simulation_started", {});
    const unrelated: PresentedHistoryEvent = {
      ...presented,
      related: { agentIds: [], homeIds: [], regionNames: [] },
    };

    expect(focusTargetForBeat(unrelated)).toBeNull();
  });
});
