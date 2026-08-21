import { describe, expect, it } from "vitest";

import { getEventVisualMetadata } from "../events/eventVisualCatalog";
import { makeRun, makeWorld } from "../test/fixtures";
import {
  selectHistoryForSelection,
  selectLiveChronicleItems,
  selectPresentedArchiveChronicle,
  selectPresentedArchiveChronicleWindow,
  selectPresentedHistory,
  summarizeLiveNowCues,
  summarizeLivePulse,
  summarizeSelectedFocusPulse,
  summarizeHistoryTimeline,
  type ChronicleHistoryEntry,
} from "./historySelectors";
import type { EventEnvelopeEntry, SerializedEvent } from "./schemas";

const world = makeWorld();
const context = {
  agentsById: new Map(world.agents.map((agent) => [agent.id, agent])),
  homesById: new Map(world.homes.map((home) => [home.home_id, home])),
  ruinsById: new Map(world.ruins.map((home) => [home.home_id, home])),
  regionsByName: new Map(world.regions.map((region) => [region.name, region])),
};

describe("historySelectors", () => {
  it("groups adjacent replay archive events and returns them newest-first without live history entries", () => {
    const events = [
      archiveEvent(
        32,
        "speak",
        { speaker_id: "agent_002", message: "The path is clear." },
        { actor_id: "agent_002", region: "grove" },
      ),
      archiveEvent(
        31,
        "home_thieved",
        {
          home_id: "home_001",
          target_home: "home_001",
          breacher_id: "agent_001",
          region: "meadow",
          loot: { materials: 14 },
        },
        { actor_id: "agent_001", home_id: "home_001", region: "meadow", amount: 14 },
      ),
      archiveEvent(
        30,
        "home_breached",
        {
          home_id: "home_001",
          target_home: "home_001",
          breacher_id: "agent_001",
          region: "meadow",
          intent: "thieve",
        },
        { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
      ),
    ];

    const presented = selectPresentedArchiveChronicle(events, context);

    expect(presented.map((item) => item.cursor)).toEqual([32, 31]);
    expect(presented.map((item) => item.type)).toEqual(["speak", "home_thieved"]);
    expect(presented[1]).toMatchObject({
      kind: "event",
      label: "vault stripped",
      cursor: 31,
      chainDetail: {
        kind: "breach-theft",
        text: "after breach",
        count: 2,
        window: "30-31",
      },
    });
  });

  it("attaches archive chain context to breach death and movement representatives", () => {
    const events = [
      archiveEvent(
        10,
        "home_breached",
        {
          home_id: "home_001",
          target_home: "home_001",
          breacher_id: "agent_001",
          region: "meadow",
          intent: "thieve",
        },
        { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
      ),
      archiveEvent(
        11,
        "home_thieved",
        {
          home_id: "home_001",
          target_home: "home_001",
          breacher_id: "agent_001",
          region: "meadow",
          loot: { materials: 14 },
        },
        { actor_id: "agent_001", home_id: "home_001", region: "meadow", amount: 14 },
      ),
      archiveEvent(
        20,
        "attack",
        {
          attacker_id: "agent_001",
          victim_id: "agent_002",
          region: "meadow",
          damage: 28,
        },
        { actor_id: "agent_001", target_id: "agent_002", region: "meadow" },
      ),
      archiveEvent(
        21,
        "agent_died",
        {
          victim_id: "agent_002",
          killer_id: "agent_001",
          region: "meadow",
          looted_energy: 0,
          looted_materials: 3,
        },
        { actor_id: "agent_001", target_id: "agent_002", region: "meadow" },
      ),
      archiveEvent(
        30,
        "agent_left_region",
        {
          agent_id: "agent_001",
          from_region: "meadow",
          to_region: "grove",
        },
        { actor_id: "agent_001", region: "meadow" },
      ),
      archiveEvent(
        31,
        "agent_entered_region",
        {
          agent_id: "agent_001",
          from_region: "meadow",
          to_region: "grove",
        },
        { actor_id: "agent_001", region: "grove" },
      ),
    ];

    const presented = selectPresentedArchiveChronicle(events, context);

    expect(presented.map((item) => [item.cursor, item.type])).toEqual([
      [31, "agent_entered_region"],
      [21, "agent_died"],
      [11, "home_thieved"],
    ]);
    expect(presented.map((item) => item.type)).not.toContain("agent_left_region");
    expect(presented.map((item) => item.type)).not.toContain("attack");
    expect(presented.map((item) => item.type)).not.toContain("home_breached");
    expect(presented[0]).toMatchObject({
      chainDetail: {
        kind: "crossing",
        text: "crossing complete",
        count: 2,
        window: "30-31",
      },
    });
    expect(presented[1]).toMatchObject({
      chainDetail: {
        kind: "strike-death",
        text: "after strike",
        count: 2,
        window: "20-21",
      },
    });
    expect(presented[2]).toMatchObject({
      chainDetail: {
        kind: "breach-theft",
        text: "after breach",
        count: 2,
        window: "10-11",
      },
    });
  });

  it("applies a positive finite limit after archive presentation ordering", () => {
    const events = [
      archiveEvent(
        41,
        "speak",
        { speaker_id: "agent_001", message: "First note." },
        { actor_id: "agent_001", region: "meadow" },
      ),
      archiveEvent(
        42,
        "speak",
        { speaker_id: "agent_001", message: "Second note." },
        { actor_id: "agent_001", region: "meadow" },
      ),
      archiveEvent(
        43,
        "speak",
        { speaker_id: "agent_001", message: "Third note." },
        { actor_id: "agent_001", region: "meadow" },
      ),
    ];

    const presented = selectPresentedArchiveChronicle(events, context, 2);

    expect(presented.map((item) => item.cursor)).toEqual([43, 42]);
  });

  it("windows archive representatives after grouping and only presents the requested row", () => {
    const contextCursors: number[] = [];
    const events = [
      archiveEvent(
        61,
        "home_breached",
        {
          home_id: "home_001",
          target_home: "home_001",
          breacher_id: "agent_001",
          region: "meadow",
          intent: "thieve",
        },
        { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
      ),
      archiveEvent(
        62,
        "home_thieved",
        {
          home_id: "home_001",
          target_home: "home_001",
          breacher_id: "agent_001",
          region: "meadow",
          loot: { materials: 14 },
        },
        { actor_id: "agent_001", home_id: "home_001", region: "meadow", amount: 14 },
      ),
      archiveEvent(
        63,
        "speak",
        { speaker_id: "agent_002", message: "Latest note." },
        { actor_id: "agent_002", region: "grove" },
      ),
      archiveEvent(
        64,
        "speak",
        { speaker_id: "agent_001", message: "Last note." },
        { actor_id: "agent_001", region: "meadow" },
      ),
    ];

    const middleWindow = selectPresentedArchiveChronicleWindow(
      events,
      (entry) => {
        contextCursors.push(entry.cursor);
        return context;
      },
      { windowStart: 1, windowSize: 1 },
    );

    expect(middleWindow).toMatchObject({
      totalVisibleCount: 3,
      windowStart: 1,
      windowEnd: 2,
      windowSize: 1,
      items: [
        {
          cursor: 63,
          detail: "Briar: \"Latest note.\"",
        },
      ],
    });
    expect(contextCursors).toEqual([63]);

    expect(selectPresentedArchiveChronicleWindow(events, context, {
      windowStart: 2,
      windowSize: 1,
    })).toMatchObject({
      totalVisibleCount: 3,
      windowStart: 2,
      windowEnd: 3,
      items: [
        {
          cursor: 62,
          type: "home_thieved",
        },
      ],
    });
    expect(selectPresentedArchiveChronicleWindow(events, context, {
      windowStart: 99,
      windowSize: 1,
    })).toMatchObject({
      totalVisibleCount: 3,
      windowStart: 2,
      windowEnd: 3,
    });
    expect(selectPresentedArchiveChronicleWindow([], context, {
      windowStart: 99,
      windowSize: 1,
    })).toMatchObject({
      totalVisibleCount: 0,
      windowStart: 0,
      windowEnd: 0,
      items: [],
    });
  });

  it("can present archive rows with cursor-specific snapshot contexts", () => {
    const earlyContext = {
      ...context,
      agentsById: new Map([
        ["agent_001", { ...world.agents[0], name: "Early Aster" }],
      ]),
    };
    const lateContext = {
      ...context,
      agentsById: new Map([
        ["agent_001", { ...world.agents[0], name: "Late Aster" }],
      ]),
    };
    const events = [
      archiveEvent(
        51,
        "speak",
        { speaker_id: "agent_001", message: "Before the turn." },
        { actor_id: "agent_001", region: "meadow" },
      ),
      archiveEvent(
        52,
        "speak",
        { speaker_id: "agent_001", message: "After the turn." },
        { actor_id: "agent_001", region: "meadow" },
      ),
    ];

    const presented = selectPresentedArchiveChronicle(
      events,
      (entry) => entry.cursor < 52 ? earlyContext : lateContext,
    );

    expect(presented.map((item) => item.detail)).toEqual([
      "Late Aster: \"After the turn.\"",
      "Early Aster: \"Before the turn.\"",
    ]);
  });

  it("groups chained home breach rows behind the terminal theft event", () => {
    const history = [
      historyEvent(
        10,
        "home_breached",
        {
          home_id: "home_001",
          target_home: "home_001",
          breacher_id: "agent_001",
          region: "meadow",
          intent: "thieve",
        },
        { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
      ),
      historyEvent(
        11,
        "home_thieved",
        {
          home_id: "home_001",
          target_home: "home_001",
          breacher_id: "agent_001",
          region: "meadow",
          loot: { materials: 14 },
        },
        { actor_id: "agent_001", home_id: "home_001", region: "meadow", amount: 14 },
      ),
    ];

    const presented = selectPresentedHistory(history, context);

    expect(presented.map((item) => item.kind === "event" ? item.type : item.kind)).toEqual([
      "home_thieved",
    ]);
    expect(presented[0]).toMatchObject({
      kind: "event",
      label: "vault stripped",
      cursor: 11,
      chainDetail: {
        kind: "breach-theft",
        text: "after breach",
        count: 2,
        window: "10-11",
      },
    });
  });

  it("keeps private thoughts related to the being without inventing a region", () => {
    const history = [
      historyEvent(
        12,
        "self_talk",
        {
          agent_id: "agent_002",
          message: "I should conserve energy.",
        },
        { actor_id: "agent_002" },
        { source: "agent_002", scope: "private", region: null },
      ),
    ];

    const [thought] = selectPresentedHistory(history, context);

    expect(thought).toMatchObject({
      kind: "event",
      type: "self_talk",
      related: {
        agentIds: ["agent_002"],
        regionNames: [],
      },
    });
    expect(selectHistoryForSelection(history, { kind: "agent", id: "agent_002" }, context)).toHaveLength(1);
    expect(selectHistoryForSelection(history, { kind: "region", id: "grove" }, context)).toHaveLength(0);
  });

  it("filters entity history by related being, region, and home ids", () => {
    const history = [
      historyEvent(
        13,
        "home_joined",
        {
          agent_id: "agent_002",
          home_id: "home_001",
          target_home: "home_001",
          owner_id: "agent_001",
          region: "meadow",
          stakeholders: ["agent_001", "agent_002"],
        },
        { actor_id: "agent_002", home_id: "home_001", region: "meadow" },
      ),
      historyEvent(
        14,
        "resource_changed",
        {
          agent_id: "agent_001",
          region: "grove",
          resource_type: "energy",
          amount: 5,
        },
        { actor_id: "agent_001", region: "grove", resource_type: "energy", amount: 5 },
      ),
    ];

    expect(selectHistoryForSelection(history, { kind: "agent", id: "agent_002" }, context)).toHaveLength(1);
    expect(selectHistoryForSelection(history, { kind: "home", id: "home_001" }, context)).toHaveLength(1);
    expect(selectHistoryForSelection(history, { kind: "region", id: "grove" }, context)).toHaveLength(1);
    expect(selectHistoryForSelection(history, { kind: "region", id: "meadow" }, context)).toHaveLength(1);
  });

  it("keeps grouped hoarding beats in the selected sender trail", () => {
    const history = [
      historyEvent(
        15,
        "resource_transferred",
        {
          sender_id: "agent_001",
          receiver_id: "agent_002",
          region: "grove",
          resource_type: "energy",
          amount: 40,
        },
        {
          actor_id: "agent_001",
          target_id: "agent_002",
          region: "grove",
          resource_type: "energy",
          amount: 40,
        },
        { target: "agent_002", timestamp: 30 },
      ),
      historyEvent(
        16,
        "agent_started_hoarding",
        { agent_id: "agent_002", region: "grove", energy: 520, materials: 4 },
        { actor_id: "agent_002", region: "grove" },
        { timestamp: 30.1 },
      ),
    ];

    const selected = selectHistoryForSelection(history, { kind: "agent", id: "agent_001" }, context);

    expect(selected.map((item) => item.kind === "event" ? item.type : item.kind)).toEqual([
      "agent_started_hoarding",
    ]);
    expect(selected[0]).toMatchObject({
      kind: "event",
      cursor: 16,
      label: "great store",
    });
  });

  it("keeps grouped hoarding beats in the selected home trail", () => {
    const history = [
      historyEvent(
        17,
        "hearth_used",
        { agent_id: "agent_001", home_id: "home_001", region: "meadow", energy_gained: 20 },
        { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
        { timestamp: 31 },
      ),
      historyEvent(
        18,
        "agent_started_hoarding",
        { agent_id: "agent_001", region: "meadow", energy: 510, materials: 12 },
        { actor_id: "agent_001", region: "meadow" },
        { timestamp: 31.1 },
      ),
    ];

    const selected = selectHistoryForSelection(history, { kind: "home", id: "home_001" }, context);

    expect(selected.map((item) => item.kind === "event" ? item.type : item.kind)).toEqual([
      "agent_started_hoarding",
    ]);
    expect(selected[0]).toMatchObject({
      kind: "event",
      cursor: 18,
      label: "great store",
    });
  });

  it("keeps grouped representatives when selection only matches the hidden raw beat", () => {
    const scenarios: Array<{
      name: string;
      selection: NonNullable<Parameters<typeof selectHistoryForSelection>[1]>;
      history: ChronicleHistoryEntry[];
      visible: { cursor: number; type: string };
      hiddenCursor: number;
      chainDetail: { kind: string; text: string; window: string };
    }> = [
      {
        name: "participant",
        selection: { kind: "agent", id: "agent_001" },
        visible: { cursor: 61, type: "agent_started_hoarding" },
        hiddenCursor: 60,
        chainDetail: { kind: "shared-hoard", text: "after sharing", window: "60-61" },
        history: [
          historyEvent(
            60,
            "resource_transferred",
            {
              sender_id: "agent_001",
              receiver_id: "agent_002",
              region: "grove",
              resource_type: "energy",
              amount: 40,
            },
            {
              actor_id: "agent_001",
              target_id: "agent_002",
              region: "grove",
              resource_type: "energy",
              amount: 40,
            },
            { source: "agent_001", target: "agent_002", timestamp: 40 },
          ),
          historyEvent(
            61,
            "agent_started_hoarding",
            { agent_id: "agent_002", region: "grove", energy: 520, materials: 4 },
            { actor_id: "agent_002", region: "grove" },
            { source: "agent_002", timestamp: 40.1 },
          ),
        ],
      },
      {
        name: "home",
        selection: { kind: "home", id: "home_001" },
        visible: { cursor: 71, type: "agent_started_hoarding" },
        hiddenCursor: 70,
        chainDetail: { kind: "hearth-hoard", text: "after hearth", window: "70-71" },
        history: [
          historyEvent(
            70,
            "hearth_used",
            { agent_id: "agent_001", home_id: "home_001", region: "meadow", energy_gained: 20 },
            { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
            { source: "agent_001", timestamp: 41 },
          ),
          historyEvent(
            71,
            "agent_started_hoarding",
            { agent_id: "agent_001", region: "meadow", energy: 510, materials: 12 },
            { actor_id: "agent_001", region: "meadow" },
            { source: "agent_001", timestamp: 41.1 },
          ),
        ],
      },
      {
        name: "region",
        selection: { kind: "region", id: "meadow" },
        visible: { cursor: 81, type: "agent_entered_region" },
        hiddenCursor: 80,
        chainDetail: { kind: "crossing", text: "crossing complete", window: "80-81" },
        history: [
          historyEvent(
            80,
            "agent_left_region",
            { agent_id: "agent_001", to_region: "grove" },
            { actor_id: "agent_001", region: "meadow" },
            { source: "agent_001", timestamp: 42 },
          ),
          historyEvent(
            81,
            "agent_entered_region",
            { agent_id: "agent_001", to_region: "grove" },
            { actor_id: "agent_001", region: "grove" },
            { source: "agent_001", timestamp: 42.1 },
          ),
        ],
      },
    ];

    for (const { history, selection, visible, hiddenCursor, chainDetail } of scenarios) {
      const selected = selectHistoryForSelection(history, selection, context);
      const selectedData = selected.map((item) => (
        item.kind === "event"
          ? { cursor: item.cursor, type: item.type }
          : { cursor: item.sortCursor, type: item.kind }
      ));

      expect(selectedData).toEqual([visible]);
      expect(selectedData.map((item) => item.cursor)).not.toContain(hiddenCursor);
      expect(selected[0]).toMatchObject({
        kind: "event",
        chainDetail: expect.objectContaining({
          ...chainDetail,
          count: 2,
        }),
      });
    }
  });

  it("selects scavenged ruin trails by home id", () => {
    const history = [
      historyEvent(
        15,
        "ruins_scavenged",
        {
          agent_id: "agent_001",
          home_id: "home_old",
          target_home: "home_old",
          region: "grove",
          resource_type: "materials",
          amount: 6,
        },
        {
          actor_id: "agent_001",
          home_id: "home_old",
          region: "grove",
          resource_type: "materials",
          amount: 6,
        },
      ),
      historyEvent(
        16,
        "home_joined",
        {
          agent_id: "agent_002",
          home_id: "home_001",
          target_home: "home_001",
          region: "meadow",
        },
        { actor_id: "agent_002", home_id: "home_001", region: "meadow" },
      ),
    ];

    const selected = selectHistoryForSelection(history, { kind: "home", id: "home_old" }, context);

    expect(selected.map((item) => item.kind === "event" ? item.type : item.kind)).toEqual([
      "ruins_scavenged",
    ]);
    expect(selected[0]).toMatchObject({
      kind: "event",
      label: "ruins picked",
      related: {
        homeIds: ["home_old"],
        regionNames: ["grove"],
      },
    });
    expect(selected[0].kind === "event" ? selected[0].chainDetail : undefined).toBeUndefined();
  });

  it("selects region trails newest-first with gaps and grouped breach rows removed", () => {
    const history: ChronicleHistoryEntry[] = [
      historyEvent(
        40,
        "home_breached",
        {
          home_id: "home_001",
          target_home: "home_001",
          breacher_id: "agent_001",
          region: "meadow",
          intent: "thieve",
        },
        { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
      ),
      historyEvent(
        41,
        "home_thieved",
        {
          home_id: "home_001",
          target_home: "home_001",
          breacher_id: "agent_001",
          region: "meadow",
          loot: { materials: 14 },
        },
        { actor_id: "agent_001", home_id: "home_001", region: "meadow", amount: 14 },
      ),
      {
        kind: "gap",
        id: "gap:overflow:41:45:50",
        reason: "overflow",
        afterCursor: 41,
        beforeCursor: 45,
        nextCursor: 50,
        message: "The live trail moved ahead; a fresh world view was requested.",
        timestamp: 24,
      },
      historyEvent(
        50,
        "home_breached",
        {
          home_id: "home_001",
          target_home: "home_001",
          breacher_id: "agent_001",
          region: "meadow",
          intent: "colonize",
        },
        { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
      ),
      historyEvent(
        51,
        "home_colonized",
        {
          home_id: "home_001",
          target_home: "home_001",
          breacher_id: "agent_001",
          new_owner_id: "agent_001",
          new_stakeholders: ["agent_001"],
          region: "meadow",
        },
        { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
      ),
      historyEvent(
        52,
        "resource_changed",
        {
          agent_id: "agent_002",
          region: "grove",
          resource_type: "energy",
          amount: 5,
        },
        { actor_id: "agent_002", region: "grove", resource_type: "energy", amount: 5 },
      ),
      historyEvent(
        53,
        "speak",
        { speaker_id: "agent_001", message: "Rally at the spring." },
        { actor_id: "agent_001", region: "meadow" },
      ),
    ];

    const selected = selectHistoryForSelection(history, { kind: "region", id: "meadow" }, context);

    expect(selected.map((item) => item.kind === "event" ? item.cursor : "gap")).toEqual([
      53,
      51,
      "gap",
      41,
    ]);
    expect(selected.map((item) => item.kind === "event" ? item.type : item.kind)).toEqual([
      "speak",
      "home_colonized",
      "gap",
      "home_thieved",
    ]);
  });

  it("selects bond lifecycle and birth trails for proposer, target, parents, and child", () => {
    const history: ChronicleHistoryEntry[] = [
      historyEvent(
        60,
        "mating_initiated",
        {
          initiator_id: "agent_001",
          target_id: "agent_002",
          resources: { energy: 50, materials: 30 },
        },
        { actor_id: "agent_001", target_id: "agent_002" },
        { target: "agent_002", scope: "targeted" },
      ),
      historyEvent(
        61,
        "mating_rejected",
        {
          rejecter_id: "agent_002",
          initiator_id: "agent_001",
          target_id: "agent_001",
          resources_refunded: { energy: 50, materials: 30 },
        },
        { actor_id: "agent_002", target_id: "agent_001" },
        { source: "agent_002", target: "agent_001", scope: "targeted" },
      ),
      historyEvent(
        62,
        "agent_born",
        {
          child_id: "agent_004",
          child_name: "Dawn",
          parent_ids: ["agent_001", "agent_002"],
          region: "meadow",
        },
        { actor_id: "agent_004", target_id: "agent_001", region: "meadow" },
        { source: "agent_004" },
      ),
    ];

    const proposer = selectHistoryForSelection(history, { kind: "agent", id: "agent_001" }, context);
    const target = selectHistoryForSelection(history, { kind: "agent", id: "agent_002" }, context);
    const child = selectHistoryForSelection(history, { kind: "agent", id: "agent_004" }, context);
    const meadow = selectHistoryForSelection(history, { kind: "region", id: "meadow" }, context);
    const grove = selectHistoryForSelection(history, { kind: "region", id: "grove" }, context);

    expect(proposer.map((item) => item.kind === "event" ? item.type : item.kind)).toEqual([
      "agent_born",
      "mating_rejected",
      "mating_initiated",
    ]);
    expect(target.map((item) => item.kind === "event" ? item.type : item.kind)).toEqual([
      "agent_born",
      "mating_rejected",
      "mating_initiated",
    ]);
    expect(child.map((item) => item.kind === "event" ? item.type : item.kind)).toEqual([
      "agent_born",
    ]);
    expect(meadow.map((item) => item.kind === "event" ? item.type : item.kind)).toEqual([
      "agent_born",
      "mating_rejected",
      "mating_initiated",
    ]);
    expect(grove.map((item) => item.kind === "event" ? item.type : item.kind)).toEqual([
      "mating_rejected",
      "mating_initiated",
    ]);
    expect(proposer[0]).toMatchObject({
      kind: "event",
      label: "born",
      related: { agentIds: ["agent_004", "agent_001", "agent_002"] },
    });
    expect(proposer[1]).toMatchObject({
      kind: "event",
      label: "bond declined",
      group: "bond",
    });
    expect(proposer[2]).toMatchObject({
      kind: "event",
      label: "bond offered",
      group: "bond",
    });
  });

  it("keeps gap rows visible after selection filtering", () => {
    const history: ChronicleHistoryEntry[] = [
      historyGap(),
      historyEvent(
        21,
        "speak",
        { speaker_id: "agent_001", message: "Rally at the spring." },
        { actor_id: "agent_001", region: "meadow" },
      ),
    ];

    const selected = selectHistoryForSelection(history, { kind: "agent", id: "agent_002" }, context);

    expect(selected).toHaveLength(1);
    expect(selected[0]).toMatchObject({
      kind: "gap",
      reason: "overflow",
    });
  });

  it("summarizes selected focus pulse from selection-filtered grouped history", () => {
    const history: ChronicleHistoryEntry[] = [
      historyEvent(
        30,
        "resource_changed",
        {
          agent_id: "agent_002",
          region: "grove",
          resource_type: "energy",
          amount: 4,
        },
        { actor_id: "agent_002", region: "grove", resource_type: "energy", amount: 4 },
        { source: "agent_002" },
      ),
      historyEvent(
        31,
        "home_built",
        {
          home_id: "home_001",
          target_home: "home_001",
          builder_id: "agent_001",
          owner_id: "agent_001",
          region: "meadow",
        },
        { actor_id: "agent_001", region: "meadow", home_id: "home_001" },
      ),
      historyEvent(
        32,
        "speak",
        { speaker_id: "agent_001", message: "The hearth is steady." },
        { actor_id: "agent_001", region: "meadow" },
      ),
      historyEvent(
        33,
        "agent_died",
        {
          victim_id: "agent_003",
          killer_id: "agent_001",
          region: "meadow",
          looted_energy: 0,
          looted_materials: 0,
        },
        { actor_id: "agent_001", target_id: "agent_003", region: "meadow" },
      ),
    ];

    const selected = selectHistoryForSelection(history, { kind: "agent", id: "agent_001" }, context);
    const focus = summarizeSelectedFocusPulse(selected);

    expect(focus).toMatchObject({
      state: "active",
      totalSelectedGroupedEventCount: 3,
      cursorWindow: {
        startCursor: 31,
        endCursor: 33,
        label: "31-33",
      },
      latestEvent: expect.objectContaining({
        type: "agent_died",
        cursor: 33,
        label: "died",
        compactDetail: {
          kind: "death",
          text: "felled by Aster",
        },
      }),
      dominantGroup: expect.objectContaining({
        group: "life",
        count: 1,
      }),
    });
    expect(focus.topGroups.map((group) => group.group)).toEqual(["life", "speech", "home"]);
    expect(focus.topGroups.map((group) => group.group)).not.toContain("resource");
  });

  it("keeps selected focus pulse on terminal grouped representatives when only hidden beats match", () => {
    const history: ChronicleHistoryEntry[] = [
      historyEvent(
        40,
        "home_breached",
        {
          home_id: "home_001",
          target_home: "home_001",
          breacher_id: "agent_001",
          region: "meadow",
          intent: "thieve",
        },
        { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
      ),
      historyEvent(
        41,
        "home_thieved",
        {
          home_id: "home_001",
          target_home: "home_001",
          breacher_id: "agent_003",
          region: "meadow",
          loot: { materials: 14 },
        },
        { actor_id: "agent_003", home_id: "home_001", region: "meadow", amount: 14 },
      ),
      historyEvent(
        42,
        "speak",
        { speaker_id: "agent_002", message: "Far away." },
        { actor_id: "agent_002", region: "grove" },
        { source: "agent_002" },
      ),
    ];

    const selected = selectHistoryForSelection(history, { kind: "agent", id: "agent_001" }, context);
    const focus = summarizeSelectedFocusPulse(selected);

    expect(focus).toMatchObject({
      state: "active",
      totalSelectedGroupedEventCount: 1,
      cursorWindow: {
        startCursor: 40,
        endCursor: 41,
        label: "40-41",
      },
      latestEvent: expect.objectContaining({
        type: "home_thieved",
        cursor: 41,
        label: "vault stripped",
        compactDetail: {
          kind: "theft",
          text: "14 materials taken",
        },
        chainDetail: expect.objectContaining({
          kind: "breach-theft",
          text: "after breach",
          count: 2,
          window: "40-41",
        }),
      }),
      dominantGroup: expect.objectContaining({
        group: "contest",
        count: 1,
      }),
    });
    expect(focus.latestEvent?.type).not.toBe("home_breached");
  });

  it("summarizes selected focus pulse gap, quiet, and bounded states", () => {
    const history: ChronicleHistoryEntry[] = [
      historyGap(),
      historyEvent(
        51,
        "speak",
        { speaker_id: "agent_001", message: "The meadow is awake." },
        { actor_id: "agent_001", region: "meadow" },
      ),
      historyEvent(
        52,
        "home_built",
        {
          home_id: "home_001",
          target_home: "home_001",
          builder_id: "agent_001",
          owner_id: "agent_001",
          region: "meadow",
        },
        { actor_id: "agent_001", region: "meadow", home_id: "home_001" },
      ),
    ];

    expect(summarizeSelectedFocusPulse([])).toMatchObject({
      state: "quiet",
      totalSelectedGroupedEventCount: 0,
      cursorWindow: { label: "none" },
    });
    expect(summarizeSelectedFocusPulse(selectHistoryForSelection([historyGap()], { kind: "agent", id: "agent_999" }, context))).toMatchObject({
      state: "gap",
      totalSelectedGroupedEventCount: 0,
      cursorWindow: { label: "10-20" },
      gaps: {
        state: "recent",
        count: 1,
        reason: "overflow",
      },
    });

    const bounded = summarizeSelectedFocusPulse(selectHistoryForSelection(history, { kind: "agent", id: "agent_001" }, context), {
      recentCount: 1,
    });
    expect(bounded).toMatchObject({
      state: "active",
      totalSelectedGroupedEventCount: 1,
      cursorWindow: { label: "52-52" },
      latestEvent: expect.objectContaining({ type: "home_built" }),
    });
    expect(bounded.latestEvent?.compactDetail).toEqual({
      kind: "home-raised",
      text: "Aster raises shelter",
    });
  });

  it("keeps selected focus compact detail bounded while selected speech retains full trail copy", () => {
    const longSpeech = "Aster keeps the long watch by the spring path while every ember and every footstep stays visible in the selected trail.";
    const history: ChronicleHistoryEntry[] = [
      historyEvent(
        71,
        "speak",
        { speaker_id: "agent_001", message: longSpeech },
        { actor_id: "agent_001", region: "meadow" },
      ),
    ];

    const selected = selectHistoryForSelection(history, { kind: "agent", id: "agent_001" }, context);
    const focus = summarizeSelectedFocusPulse(selected);

    expect(selected[0]).toMatchObject({
      kind: "event",
      detail: expect.stringContaining(longSpeech),
      compactDetail: {
        kind: "open-speech",
        text: "heard in meadow",
      },
    });
    expect(focus.latestEvent?.detail).toContain(longSpeech);
    expect(focus.latestEvent?.compactDetail).toEqual({
      kind: "open-speech",
      text: "heard in meadow",
    });
    expect(focus.latestEvent?.compactDetail?.text).not.toContain(longSpeech);
  });

  it("does not leak global prose into selected focus pulse", () => {
    const history: ChronicleHistoryEntry[] = [
      historyEvent(
        61,
        "speak",
        {
          speaker_id: "agent_002",
          message: "agent_001 saw home_001 after agent_died near the meadow.",
        },
        { actor_id: "agent_002", region: "grove" },
        { source: "agent_002" },
      ),
    ];

    const selected = selectHistoryForSelection(history, { kind: "agent", id: "agent_001" }, context);
    const focus = summarizeSelectedFocusPulse(selected);

    expect(focus).toMatchObject({
      state: "quiet",
      totalSelectedGroupedEventCount: 0,
      latestEvent: null,
    });
  });

  it("keeps gap rows between retained history segments instead of cursor-sorting them into a segment", () => {
    const history: ChronicleHistoryEntry[] = [
      historyEvent(
        4,
        "speak",
        { speaker_id: "agent_001", message: "Before the feed loss." },
        { actor_id: "agent_001", region: "meadow" },
      ),
      {
        kind: "gap",
        id: "gap:overflow:4:8:10",
        reason: "overflow",
        afterCursor: 4,
        beforeCursor: 8,
        nextCursor: 10,
        message: "The live trail moved ahead; a fresh world view was requested.",
        timestamp: 21,
      },
      historyEvent(
        9,
        "speak",
        { speaker_id: "agent_001", message: "After the feed loss." },
        { actor_id: "agent_001", region: "meadow" },
      ),
      historyEvent(
        10,
        "resource_changed",
        {
          agent_id: "agent_001",
          region: "meadow",
          resource_type: "materials",
          amount: 3,
        },
        { actor_id: "agent_001", region: "meadow", resource_type: "materials", amount: 3 },
      ),
    ];

    const presented = selectPresentedHistory(history, context);

    expect(presented.map((item) => item.kind === "event" ? item.cursor : "gap")).toEqual([
      10,
      9,
      "gap",
      4,
    ]);
  });

  it("keeps newest live chronicle rows dominant while retaining older salient rows", () => {
    const history: ChronicleHistoryEntry[] = [
      historyEvent(
        1,
        "agent_died",
        {
          victim_id: "agent_002",
          killer_id: "agent_003",
          region: "meadow",
          looted_energy: 0,
          looted_materials: 0,
        },
        { actor_id: "agent_003", target_id: "agent_002", region: "meadow" },
      ),
      ...routineHistoryEvents(2, 13),
    ];

    const liveItems = selectLiveChronicleItems(history, context);

    expect(liveItems.map(historyItemCursor)).toEqual([13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 1]);
    expect(liveItems.slice(0, 10).map(historyItemCursor)).toEqual([13, 12, 11, 10, 9, 8, 7, 6, 5, 4]);
    expect(liveItems.at(-1)).toMatchObject({ kind: "event", type: "agent_died", cursor: 1 });
  });

  it("does not duplicate retained live chronicle rows with the same cursor", () => {
    const oldDeath = historyEvent(
      1,
      "agent_died",
      {
        victim_id: "agent_002",
        killer_id: "agent_003",
        region: "meadow",
        looted_energy: 0,
        looted_materials: 0,
      },
      { actor_id: "agent_003", target_id: "agent_002", region: "meadow" },
    );
    const history: ChronicleHistoryEntry[] = [
      oldDeath,
      oldDeath,
      ...routineHistoryEvents(2, 13),
    ];

    const liveItems = selectLiveChronicleItems(history, context);
    const cursors = liveItems.map(historyItemCursor);

    expect(cursors.filter((cursor) => cursor === 1)).toHaveLength(1);
    expect(new Set(cursors).size).toBe(cursors.length);
  });

  it("does not reintroduce a hidden grouped event through live chronicle salience retention", () => {
    const history: ChronicleHistoryEntry[] = [
      historyEvent(
        1,
        "home_breached",
        {
          home_id: "home_001",
          target_home: "home_001",
          breacher_id: "agent_003",
          intent: "thieve",
          region: "meadow",
        },
        { actor_id: "agent_003", region: "meadow", home_id: "home_001" },
      ),
      historyEvent(
        2,
        "home_thieved",
        {
          home_id: "home_001",
          target_home: "home_001",
          breacher_id: "agent_003",
          intent: "thieve",
          region: "meadow",
          loot: { materials: 14 },
        },
        { actor_id: "agent_003", region: "meadow", home_id: "home_001", amount: 14 },
      ),
      ...routineHistoryEvents(3, 14),
    ];

    const liveItems = selectLiveChronicleItems(history, context);

    expect(liveItems).toContainEqual(expect.objectContaining({ kind: "event", type: "home_thieved", cursor: 2 }));
    expect(liveItems).not.toContainEqual(expect.objectContaining({ kind: "event", type: "home_breached", cursor: 1 }));
  });

  it("keeps gap rows in the recent live chronicle flow without creating synthetic retained rows", () => {
    const history: ChronicleHistoryEntry[] = [
      historyEvent(
        1,
        "agent_born",
        {
          child_id: "agent_004",
          child_name: "Dawn",
          parent_ids: ["agent_001", "agent_002"],
          region: "meadow",
        },
        { actor_id: "agent_004", target_id: "agent_001", region: "meadow" },
      ),
      {
        kind: "gap",
        id: "gap:overflow:1:8:9",
        reason: "overflow",
        afterCursor: 1,
        beforeCursor: 8,
        nextCursor: 9,
        message: "The live trail moved ahead; a fresh world view was requested.",
        timestamp: 20,
      },
      ...routineHistoryEvents(9, 10),
    ];

    const liveItems = selectLiveChronicleItems(history, context, {
      recentCount: 3,
      retainedCount: 1,
      maxCount: 4,
    });

    expect(liveItems.map(historyItemCursor)).toEqual([10, 9, "gap", 1]);
    expect(liveItems.filter((item) => item.kind === "gap")).toHaveLength(1);
  });

  it("bounds live chronicle retention to the configured maximum count", () => {
    const history: ChronicleHistoryEntry[] = [
      historyEvent(
        1,
        "agent_died",
        {
          victim_id: "agent_002",
          region: "meadow",
          looted_energy: 0,
          looted_materials: 0,
        },
        { actor_id: "agent_002", target_id: "agent_002", region: "meadow" },
      ),
      historyEvent(
        2,
        "agent_born",
        {
          child_id: "agent_004",
          child_name: "Dawn",
          parent_ids: ["agent_001", "agent_002"],
          region: "meadow",
        },
        { actor_id: "agent_004", target_id: "agent_001", region: "meadow" },
      ),
      historyEvent(
        3,
        "home_built",
        {
          home_id: "home_001",
          target_home: "home_001",
          builder_id: "agent_001",
          owner_id: "agent_001",
          region: "meadow",
        },
        { actor_id: "agent_001", region: "meadow", home_id: "home_001" },
      ),
      ...routineHistoryEvents(4, 20),
    ];

    const liveItems = selectLiveChronicleItems(history, context, {
      recentCount: 8,
      retainedCount: 5,
      maxCount: 10,
    });

    expect(liveItems).toHaveLength(10);
    expect(liveItems.slice(0, 8).map(historyItemCursor)).toEqual([20, 19, 18, 17, 16, 15, 14, 13]);
  });

  it("pins an existing current cursor inside the bounded live Chronicle without duplicates", () => {
    const history: ChronicleHistoryEntry[] = [
      historyEvent(
        1,
        "agent_died",
        {
          victim_id: "agent_002",
          region: "meadow",
          looted_energy: 0,
          looted_materials: 0,
        },
        { actor_id: "agent_002", target_id: "agent_002", region: "meadow" },
      ),
      ...routineHistoryEvents(2, 20),
    ];

    const liveItems = selectLiveChronicleItems(history, context, {
      recentCount: 8,
      retainedCount: 0,
      maxCount: 8,
      currentCursor: 1,
    });
    const cursors = liveItems.map(historyItemCursor);

    expect(liveItems).toHaveLength(8);
    expect(cursors).toContain(1);
    expect(cursors.filter((cursor) => cursor === 1)).toHaveLength(1);
    expect(new Set(cursors).size).toBe(cursors.length);
    const pinned = liveItems.find((item) => item.kind === "event" && item.cursor === 1);
    expect(pinned?.kind).toBe("event");
    expect(pinned?.kind === "event" ? pinned.entry : null).toBe(history[0]?.kind === "event"
      ? history[0].entry
      : null);
  });

  it("retains older live chronicle rows only when catalog metadata marks them salient", () => {
    expect(getEventVisualMetadata("mating_proposal_timeout")?.salient).toBe(true);
    expect(getEventVisualMetadata("speak")?.salient).toBe(false);
    expect(getEventVisualMetadata("simulation_started")?.salient).toBe(false);

    const history: ChronicleHistoryEntry[] = [
      historyEvent(
        1,
        "speak",
        { speaker_id: "agent_001", message: "An old ordinary call." },
        { actor_id: "agent_001", region: "meadow" },
      ),
      historyEvent(
        2,
        "simulation_started",
        { agent_count: 2, world_time: 0 },
        {},
        { source: "world", scope: "global", region: null },
      ),
      historyEvent(
        3,
        "mating_proposal_timeout",
        {
          initiator_id: "agent_001",
          target_id: "agent_002",
          reason: "expired",
          resources_refunded: { energy: 50, materials: 30 },
        },
        { actor_id: "agent_001", target_id: "agent_002", region: "meadow" },
        { scope: "targeted", target: "agent_001" },
      ),
      ...routineHistoryEvents(4, 15),
    ];

    const liveItems = selectLiveChronicleItems(history, context, {
      recentCount: 5,
      retainedCount: 2,
      maxCount: 7,
    });

    expect(liveItems.map(historyItemCursor)).toEqual([15, 14, 13, 12, 11, 3]);
    expect(liveItems).not.toContainEqual(expect.objectContaining({ kind: "event", cursor: 1 }));
    expect(liveItems).not.toContainEqual(expect.objectContaining({ kind: "event", cursor: 2 }));
  });

  it("summarizes live pulse groups, dominant group, latest important beat, gaps, and cursor bounds", () => {
    const history: ChronicleHistoryEntry[] = [
      historyEvent(
        1,
        "home_breached",
        {
          home_id: "home_001",
          target_home: "home_001",
          breacher_id: "agent_003",
          intent: "thieve",
          region: "meadow",
        },
        { actor_id: "agent_003", region: "meadow", home_id: "home_001" },
      ),
      historyEvent(
        2,
        "home_thieved",
        {
          home_id: "home_001",
          target_home: "home_001",
          breacher_id: "agent_003",
          intent: "thieve",
          region: "meadow",
          loot: { materials: 14 },
        },
        { actor_id: "agent_003", region: "meadow", home_id: "home_001", amount: 14 },
      ),
      {
        kind: "gap",
        id: "gap:overflow:2:4:5",
        reason: "overflow",
        afterCursor: 2,
        beforeCursor: 4,
        nextCursor: 5,
        message: "The live trail moved ahead; a fresh world view was requested.",
        timestamp: 21,
      },
      historyEvent(
        5,
        "resource_changed",
        {
          agent_id: "agent_001",
          region: "meadow",
          resource_type: "energy",
          amount: 5,
        },
        { actor_id: "agent_001", region: "meadow", resource_type: "energy", amount: 5 },
      ),
      historyEvent(
        6,
        "speak",
        { speaker_id: "agent_001", message: "Hold the line." },
        { actor_id: "agent_001", region: "meadow" },
      ),
      historyEvent(
        7,
        "resource_changed",
        {
          agent_id: "agent_002",
          region: "grove",
          resource_type: "materials",
          amount: 3,
        },
        { actor_id: "agent_002", region: "grove", resource_type: "materials", amount: 3 },
      ),
      historyEvent(
        8,
        "attack",
        {
          attacker_id: "agent_001",
          victim_id: "agent_002",
          target_id: "agent_002",
          region: "meadow",
          damage: 18,
        },
        { actor_id: "agent_001", target_id: "agent_002", region: "meadow" },
      ),
    ];

    const summary = summarizeLivePulse(history, context, { recentCount: 6 });

    expect(summary.totalRecentGroupedEventCount).toBe(5);
    expect(summary.cursorWindow).toEqual({
      startCursor: 1,
      endCursor: 8,
      label: "1-8",
    });
    expect(summary.topGroups).toMatchObject([
      {
        group: "contest",
        label: "Conflict",
        count: 2,
        latestCursor: 8,
        latestEventType: "attack",
        latestEventLabel: "strike",
      },
      {
        group: "resource",
        label: "Resources",
        count: 2,
        latestCursor: 7,
        latestEventType: "resource_changed",
        latestEventLabel: "gathered",
      },
      {
        group: "speech",
        label: "Speech",
        count: 1,
        latestCursor: 6,
        latestEventType: "speak",
        latestEventLabel: "spoke",
      },
    ]);
    expect(summary.dominantGroup).toMatchObject({
      group: "contest",
      label: "Conflict",
      count: 2,
    });
    expect(summary.latestImportantBeat).toMatchObject({
      kind: "event",
      type: "attack",
      cursor: 8,
      group: "contest",
    });
    expect(summary.gaps).toMatchObject({
      state: "recent",
      count: 1,
      reason: "overflow",
      reasons: ["overflow"],
    });
  });

  it("suppresses hidden home breach beats behind theft and colonization in live pulse counts", () => {
    const history: ChronicleHistoryEntry[] = [
      historyEvent(
        10,
        "home_breached",
        {
          home_id: "home_001",
          target_home: "home_001",
          breacher_id: "agent_001",
          region: "meadow",
          intent: "thieve",
        },
        { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
      ),
      historyEvent(
        11,
        "home_thieved",
        {
          home_id: "home_001",
          target_home: "home_001",
          breacher_id: "agent_001",
          region: "meadow",
          loot: { materials: 14 },
        },
        { actor_id: "agent_001", home_id: "home_001", region: "meadow", amount: 14 },
      ),
      historyEvent(
        12,
        "home_breached",
        {
          home_id: "home_001",
          target_home: "home_001",
          breacher_id: "agent_001",
          region: "meadow",
          intent: "colonize",
        },
        { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
      ),
      historyEvent(
        13,
        "home_colonized",
        {
          home_id: "home_001",
          target_home: "home_001",
          breacher_id: "agent_001",
          new_owner_id: "agent_001",
          new_stakeholders: ["agent_001"],
          region: "meadow",
        },
        { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
      ),
    ];

    const summary = summarizeLivePulse(history, context);
    const presented = selectPresentedHistory(history, context);

    expect(summary.totalRecentGroupedEventCount).toBe(2);
    expect(summary.cursorWindow).toEqual({
      startCursor: 10,
      endCursor: 13,
      label: "10-13",
    });
    expect(summary.topGroups).toMatchObject([
      {
        group: "contest",
        label: "Conflict",
        count: 2,
        latestCursor: 13,
        latestEventType: "home_colonized",
        latestEventLabel: "home seized",
      },
    ]);
    expect(summary.latestImportantBeat).toMatchObject({
      kind: "event",
      type: "home_colonized",
      cursor: 13,
    });
    expect(presented).toEqual([
      expect.objectContaining({
        kind: "event",
        type: "home_colonized",
        cursor: 13,
        chainDetail: expect.objectContaining({
          kind: "breach-claim",
          count: 2,
          window: "12-13",
        }),
      }),
      expect.objectContaining({
        kind: "event",
        type: "home_thieved",
        cursor: 11,
        chainDetail: expect.objectContaining({
          kind: "breach-theft",
          count: 2,
          window: "10-11",
        }),
      }),
    ]);
  });

  it("returns an empty live pulse summary when retained history has no events or gaps", () => {
    const summary = summarizeLivePulse([], context);

    expect(summary).toEqual({
      totalRecentGroupedEventCount: 0,
      cursorWindow: {
        startCursor: null,
        endCursor: null,
        label: "none",
      },
      topGroups: [],
      dominantGroup: null,
      latestImportantBeat: null,
      gaps: {
        state: "none",
        count: 0,
        reason: null,
        reasons: [],
        latest: null,
      },
    });
  });

  it("retains the latest generic beat when live pulse history has no high-importance event", () => {
    const history: ChronicleHistoryEntry[] = [
      historyEvent(
        1,
        "agent_entered_region",
        {
          agent_id: "agent_001",
          from_region: "grove",
          to_region: "meadow",
        },
        { actor_id: "agent_001", region: "meadow" },
      ),
      historyEvent(
        2,
        "resource_changed",
        {
          agent_id: "agent_001",
          region: "meadow",
          resource_type: "energy",
          amount: 5,
        },
        { actor_id: "agent_001", region: "meadow", resource_type: "energy", amount: 5 },
      ),
    ];

    const summary = summarizeLivePulse(history, context);

    expect(summary.latestImportantBeat).toMatchObject({
      kind: "event",
      type: "resource_changed",
      cursor: 2,
      group: "resource",
      compactDetail: {
        kind: "harvest",
        text: "5 energy gathered",
      },
    });
  });

  it("bounds live pulse options deterministically", () => {
    const history: ChronicleHistoryEntry[] = [
      historyEvent(
        1,
        "agent_born",
        {
          child_id: "agent_004",
          child_name: "Dawn",
          parent_ids: ["agent_001", "agent_002"],
          region: "meadow",
        },
        { actor_id: "agent_004", target_id: "agent_001", region: "meadow" },
      ),
      historyEvent(
        2,
        "home_built",
        {
          home_id: "home_001",
          target_home: "home_001",
          builder_id: "agent_001",
          owner_id: "agent_001",
          region: "meadow",
        },
        { actor_id: "agent_001", region: "meadow", home_id: "home_001" },
      ),
      historyEvent(
        3,
        "attack",
        {
          attacker_id: "agent_001",
          victim_id: "agent_002",
          target_id: "agent_002",
          region: "meadow",
          damage: 18,
        },
        { actor_id: "agent_001", target_id: "agent_002", region: "meadow" },
      ),
      historyEvent(
        4,
        "resource_changed",
        {
          agent_id: "agent_002",
          region: "grove",
          resource_type: "materials",
          amount: 3,
        },
        { actor_id: "agent_002", region: "grove", resource_type: "materials", amount: 3 },
      ),
      historyEvent(
        5,
        "speak",
        { speaker_id: "agent_001", message: "Latest note." },
        { actor_id: "agent_001", region: "meadow" },
      ),
    ];

    const highBounds = summarizeLivePulse(history, context, {
      recentCount: 99,
      topGroupLimit: 99,
    });
    expect(highBounds.topGroups).toHaveLength(4);
    expect(highBounds.topGroups.map((group) => group.group)).toEqual([
      "speech",
      "resource",
      "contest",
      "home",
    ]);

    const lowBounds = summarizeLivePulse(history, context, {
      recentCount: 2.9,
      topGroupLimit: 1,
    });
    expect(lowBounds.totalRecentGroupedEventCount).toBe(2);
    expect(lowBounds.topGroups).toHaveLength(2);
    expect(lowBounds.cursorWindow).toEqual({
      startCursor: 4,
      endCursor: 5,
      label: "4-5",
    });

    expect(summarizeLivePulse(history, context, {
      recentCount: -1,
    })).toMatchObject({
      totalRecentGroupedEventCount: 0,
      cursorWindow: {
        startCursor: null,
        endCursor: null,
        label: "none",
      },
      topGroups: [],
    });
  });

  it("summarizes latest live now cues by event category in stable slot order", () => {
    const history: ChronicleHistoryEntry[] = [
      historyEvent(
        1,
        "mating_initiated",
        {
          initiator_id: "agent_001",
          target_id: "agent_002",
          resources: { energy: 50, materials: 30 },
        },
        { actor_id: "agent_001", target_id: "agent_002", region: "meadow" },
      ),
      historyEvent(
        2,
        "agent_paralyzed",
        { victim_id: "agent_002", attacker_id: "agent_001", region: "meadow", damage: 40 },
        { actor_id: "agent_001", target_id: "agent_002", region: "meadow" },
      ),
      historyEvent(
        3,
        "home_built",
        {
          home_id: "home_001",
          target_home: "home_001",
          builder_id: "agent_001",
          owner_id: "agent_001",
          region: "meadow",
        },
        { actor_id: "agent_001", region: "meadow", home_id: "home_001" },
      ),
      historyEvent(
        4,
        "attack",
        {
          attacker_id: "agent_001",
          victim_id: "agent_002",
          target_id: "agent_002",
          region: "meadow",
          damage: 18,
        },
        { actor_id: "agent_001", target_id: "agent_002", region: "meadow" },
      ),
      historyEvent(
        5,
        "speak",
        { speaker_id: "agent_001", message: "The meadow is awake." },
        { actor_id: "agent_001", region: "meadow" },
      ),
      historyEvent(
        6,
        "mating_rejected",
        {
          rejecter_id: "agent_002",
          initiator_id: "agent_001",
          target_id: "agent_001",
          resources_refunded: { energy: 50, materials: 30 },
        },
        { actor_id: "agent_002", target_id: "agent_001", region: "meadow" },
      ),
    ];

    const cues = summarizeLiveNowCues(history, context);

    expect(cues.map((cue) => [cue.slot, cue.eventType, cue.cursor])).toEqual([
      ["voice", "speak", 5],
      ["bond", "mating_rejected", 6],
      ["life", "agent_paralyzed", 2],
      ["home", "home_built", 3],
      ["conflict", "attack", 4],
    ]);
    expect(cues[0]).toMatchObject({
      slotLabel: "Voice",
      label: "spoke",
      item: expect.objectContaining({ type: "speak", cursor: 5 }),
    });
    expect(cues.find((cue) => cue.slot === "conflict")).toMatchObject({
      detail: "toward Briar",
      item: expect.objectContaining({
        compactDetail: {
          kind: "strike",
          text: "toward Briar",
        },
      }),
    });
  });

  it("uses terminal grouped theft and colonization representatives for live now conflict cues", () => {
    const history: ChronicleHistoryEntry[] = [
      historyEvent(
        10,
        "home_breached",
        {
          home_id: "home_001",
          target_home: "home_001",
          breacher_id: "agent_001",
          region: "meadow",
          intent: "thieve",
        },
        { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
      ),
      historyEvent(
        11,
        "home_thieved",
        {
          home_id: "home_001",
          target_home: "home_001",
          breacher_id: "agent_001",
          region: "meadow",
          loot: { materials: 14 },
        },
        { actor_id: "agent_001", home_id: "home_001", region: "meadow", amount: 14 },
      ),
      historyEvent(
        12,
        "home_breached",
        {
          home_id: "home_001",
          target_home: "home_001",
          breacher_id: "agent_001",
          region: "meadow",
          intent: "colonize",
        },
        { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
      ),
      historyEvent(
        13,
        "home_colonized",
        {
          home_id: "home_001",
          target_home: "home_001",
          breacher_id: "agent_001",
          new_owner_id: "agent_001",
          new_stakeholders: ["agent_001"],
          region: "meadow",
        },
        { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
      ),
    ];

    const cues = summarizeLiveNowCues(history, context);

    expect(cues).toHaveLength(1);
    expect(cues[0]).toMatchObject({
      slot: "conflict",
      eventType: "home_colonized",
      cursor: 13,
      label: "home seized",
    });
    expect(cues.map((cue) => cue.eventType)).not.toContain("home_breached");
  });

  it("keeps routine speech from hiding newer live now life, home, and conflict cues", () => {
    const history: ChronicleHistoryEntry[] = [
      ...routineHistoryEvents(1, 8),
      historyEvent(
        9,
        "agent_died",
        {
          victim_id: "agent_002",
          killer_id: "agent_001",
          region: "meadow",
          looted_energy: 0,
          looted_materials: 0,
        },
        { actor_id: "agent_001", target_id: "agent_002", region: "meadow" },
      ),
      historyEvent(
        10,
        "hearth_used",
        { agent_id: "agent_001", home_id: "home_001", region: "meadow", energy_gained: 20 },
        { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
      ),
      historyEvent(
        11,
        "home_started_hoarding",
        {
          agent_id: "agent_001",
          home_id: "home_001",
          target_home: "home_001",
          region: "meadow",
          vault_materials: 320,
        },
        { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
      ),
      historyEvent(
        12,
        "attack",
        {
          attacker_id: "agent_001",
          victim_id: "agent_002",
          target_id: "agent_002",
          region: "meadow",
          damage: 18,
        },
        { actor_id: "agent_001", target_id: "agent_002", region: "meadow" },
      ),
    ];

    const cues = summarizeLiveNowCues(history, context);

    expect(cues.map((cue) => [cue.slot, cue.eventType, cue.cursor])).toEqual([
      ["voice", "speak", 8],
      ["life", "agent_died", 9],
      ["home", "home_started_hoarding", 11],
      ["conflict", "attack", 12],
    ]);
    expect(cues.find((cue) => cue.slot === "home")).toMatchObject({
      label: "vault swelled",
    });
    expect(cues.find((cue) => cue.slot === "conflict")).toMatchObject({
      label: "strike",
      detail: "toward Briar",
      item: expect.objectContaining({
        compactDetail: {
          kind: "strike",
          text: "toward Briar",
        },
      }),
    });
  });

  it("retains generic movement and resource beats as neutral live now world cues", () => {
    const history: ChronicleHistoryEntry[] = [
      historyEvent(
        1,
        "agent_entered_region",
        {
          agent_id: "agent_001",
          from_region: "grove",
          to_region: "meadow",
        },
        { actor_id: "agent_001", region: "meadow" },
      ),
      historyEvent(
        2,
        "resource_changed",
        {
          agent_id: "agent_001",
          region: "meadow",
          resource_type: "energy",
          amount: 5,
        },
        { actor_id: "agent_001", region: "meadow", resource_type: "energy", amount: 5 },
      ),
    ];

    const cues = summarizeLiveNowCues(history, context);

    expect(cues.map((cue) => [cue.slot, cue.eventType, cue.cursor])).toEqual([
      ["world", "resource_changed", 2],
    ]);
    expect(cues[0]).toMatchObject({
      slotLabel: "World",
      label: "gathered",
      detail: "5 energy gathered",
      item: expect.objectContaining({
        compactDetail: {
          kind: "harvest",
          text: "5 energy gathered",
        },
      }),
    });
  });

  it("bounds live now cues after stable slot ordering and ignores gap rows", () => {
    const history: ChronicleHistoryEntry[] = [
      historyEvent(
        1,
        "agent_born",
        {
          child_id: "agent_004",
          child_name: "Dawn",
          parent_ids: ["agent_001", "agent_002"],
          region: "meadow",
        },
        { actor_id: "agent_004", target_id: "agent_001", region: "meadow" },
      ),
      historyGap(),
      historyEvent(
        2,
        "agent_died",
        {
          victim_id: "agent_002",
          killer_id: "agent_001",
          region: "meadow",
          looted_energy: 0,
          looted_materials: 0,
        },
        { actor_id: "agent_001", target_id: "agent_002", region: "meadow" },
      ),
      historyEvent(
        3,
        "home_built",
        {
          home_id: "home_001",
          target_home: "home_001",
          builder_id: "agent_001",
          owner_id: "agent_001",
          region: "meadow",
        },
        { actor_id: "agent_001", region: "meadow", home_id: "home_001" },
      ),
      historyEvent(
        4,
        "attack",
        {
          attacker_id: "agent_001",
          victim_id: "agent_002",
          target_id: "agent_002",
          region: "meadow",
          damage: 18,
        },
        { actor_id: "agent_001", target_id: "agent_002", region: "meadow" },
      ),
      historyEvent(
        5,
        "speak",
        { speaker_id: "agent_001", message: "Latest note." },
        { actor_id: "agent_001", region: "meadow" },
      ),
    ];

    const cues = summarizeLiveNowCues(history, context, { maxCues: 3 });

    expect(cues.map((cue) => [cue.slot, cue.eventType])).toEqual([
      ["voice", "speak"],
      ["bond", "agent_born"],
      ["life", "agent_died"],
    ]);
    expect(cues.map((cue) => cue.slot)).not.toContain("gap");
  });

  it("does not derive live now categories from prose and keeps cue text free of raw ids", () => {
    const history: ChronicleHistoryEntry[] = [
      historyEvent(
        20,
        "speak",
        {
          speaker_id: "agent_001",
          message: "agent_002 says agent_died near home_001 after home_built and attack.",
        },
        { actor_id: "agent_001", region: "meadow" },
      ),
    ];

    const cues = summarizeLiveNowCues(history, context);

    expect(cues.map((cue) => cue.slot)).toEqual(["voice"]);
    expect(cues.map((cue) => cue.eventType)).toEqual(["speak"]);
    expect(`${cues[0].label} ${cues[0].detail}`).not.toMatch(/\b(?:agent|home)_/);
    expect(cues[0].detail).toBe("heard in meadow");
    expect(cues[0].detail).not.toContain("being 002");
    expect(cues[0].detail).not.toContain("home 001");
  });

  it("summarizes retained history without claiming timeline seek support", () => {
    const history: ChronicleHistoryEntry[] = [
      historyGap(),
      historyEvent(
        21,
        "speak",
        { speaker_id: "agent_001", message: "Rally at the spring." },
        { actor_id: "agent_001", region: "meadow" },
        { timestamp: 22.5 },
      ),
    ];

    const summary = summarizeHistoryTimeline(history, 24, 25, makeRun().artifacts);

    expect(summary).toMatchObject({
      liveEdgeCursor: 24,
      firstRetainedCursor: 10,
      lastRetainedCursor: 21,
      gapCount: 1,
      canSeek: false,
      cursorWindowLabel: "10-21",
      eventWindowLabel: "20.0s-22.5s",
      snapshotArtifactLabel: "snapshots_7.jsonl",
    });
  });

  it("summarizes nested archive artifacts with only the snapshot basename", () => {
    const artifacts = {
      events: "runs/hostile-events-artifact-dir/hostile-events-artifact-file.jsonl",
      usage: "runs/hostile-usage-artifact-dir/hostile-usage-artifact-file.jsonl",
      snapshots: "runs/hostile-snapshots-artifact-dir/snapshots_7.jsonl",
      memory_root: "runs/hostile-memory-artifact-dir/hostile-memory-root",
    };

    const summary = summarizeHistoryTimeline([], 24, 25, artifacts);

    expect(summary.snapshotArtifactLabel).toBe("snapshots_7.jsonl");
    const serializedSummary = JSON.stringify(summary);
    expect(serializedSummary).not.toContain("runs/");
    expect(serializedSummary).not.toContain("hostile-events-artifact-dir");
    expect(serializedSummary).not.toContain("hostile-events-artifact-file");
    expect(serializedSummary).not.toContain("hostile-usage-artifact-dir");
    expect(serializedSummary).not.toContain("hostile-usage-artifact-file");
    expect(serializedSummary).not.toContain("hostile-snapshots-artifact-dir");
    expect(serializedSummary).not.toContain("hostile-memory-artifact-dir");
    expect(serializedSummary).not.toContain("hostile-memory-root");
  });
});

function historyEvent(
  cursor: number,
  type: string,
  payload: Record<string, unknown>,
  resolved: EventEnvelopeEntry["resolved"],
  overrides: Partial<Omit<SerializedEvent, "type" | "payload">> = {},
): ChronicleHistoryEntry {
  return {
    kind: "event",
    entry: archiveEvent(cursor, type, payload, resolved, overrides),
  };
}

function archiveEvent(
  cursor: number,
  type: string,
  payload: Record<string, unknown>,
  resolved: EventEnvelopeEntry["resolved"],
  overrides: Partial<Omit<SerializedEvent, "type" | "payload">> = {},
): EventEnvelopeEntry {
  return {
    cursor,
    event: {
      type,
      source: overrides.source ?? "agent_001",
      payload,
      scope: overrides.scope ?? "local",
      region: overrides.region === undefined ? resolved.region ?? null : overrides.region,
      target: overrides.target ?? null,
      timestamp: overrides.timestamp ?? 20 + (cursor - 10) / 10,
    },
    resolved,
    snapshot_after: null,
  };
}

function historyGap(): ChronicleHistoryEntry {
  return {
    kind: "gap",
    id: "gap:overflow:10:12:20",
    reason: "overflow",
    afterCursor: 10,
    beforeCursor: 12,
    nextCursor: 20,
    message: "The live trail moved ahead; a fresh world view was requested.",
    timestamp: 20,
  };
}

function routineHistoryEvents(startCursor: number, endCursor: number): ChronicleHistoryEntry[] {
  return Array.from({ length: endCursor - startCursor + 1 }, (_, index) => {
    const cursor = startCursor + index;
    return historyEvent(
      cursor,
      "speak",
      { speaker_id: "agent_001", message: `Routine note ${cursor}.` },
      { actor_id: "agent_001", region: "meadow" },
    );
  });
}

function historyItemCursor(item: ReturnType<typeof selectLiveChronicleItems>[number]): number | "gap" {
  return item.kind === "event" ? item.cursor : "gap";
}
