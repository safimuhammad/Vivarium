import { describe, expect, it } from "vitest";

import type { StoryMoment } from "../../presentation/BeatDirector";
import { CHOREOGRAPHY_REGISTERED_EVENT_TYPES } from "../../presentation/choreography/registry";
import type { PresentedObserverFrame } from "../../presentation/contracts";
import type { PresentedChronicleWindow } from "../../presentation/selectors";
import {
  formatWorldTime,
  projectArchiveCatalogue,
  projectChronicle,
  projectDialogueNow,
  projectLivingAtlas,
  projectObserverHud,
  projectSelection,
  projectStoryNow,
} from "./publicViewModels";

describe("observer public view-model boundary", () => {
  it("shows a ruin's age from the presented frame instead of a raw epoch timestamp", () => {
    const base = makeFrame();
    const at = 1_789_298_433.351244;
    const frame = makeFrame({
      world: { ...base.world, worldTime: at + 65.14336895942688, ruins: [
        { completeness: "exact", value: { home_id: "ruin_1", status: "ruin", ruined_at: at } },
      ] },
      selection: { kind: "ruin", id: "ruin_1" },
    });
    const card = projectSelection(frame, makeChronicle())!;
    expect(card.facts.find((fact) => fact.label === "Ruin age")?.value).toBe("1m 5s");
    expect(card.facts.some((fact) => fact.label === "Ruined at")).toBe(false);
    const unknown = makeFrame({ ...frame, world: { ...frame.world, ruins: [
      { completeness: "exact", value: { home_id: "ruin_1", status: "ruin", ruined_at: null } },
    ] } });
    expect(projectSelection(unknown, makeChronicle())?.facts.find((fact) => fact.label === "Ruin age")?.value).toBe("Unknown");
  });

  it("projects honest HUD totals and leaves missing partial status unresolved", () => {
    const base = makeFrame();
    const frame = makeFrame({
      world: { ...base.world, worldTime: 1_719_120 },
    });
    const hud = projectObserverHud(frame, "nirvana");

    expect(hud).toMatchObject({
      worldTime: 1_719_120,
      regionDisplayName: "Nirvana",
      humanTimeLabel: "Day 20, 9:32 PM",
      livingAgents: 1,
      deadAgents: 1,
      unresolvedAgentStatuses: 1,
      homes: 1,
      ruins: 0,
      presentedCursor: 7,
      receivedCursor: 9,
      pendingMoments: 2,
    });
    expect(JSON.stringify(hud)).not.toMatch(/run-secret|source-secret|qwen|agent_001/);
  });

  it("formats world seconds deterministically and rejects values outside its domain", () => {
    expect(formatWorldTime(0)).toBe("Day 1, 12:00 AM");
    expect(formatWorldTime(86_400 + (12 * 3_600) + 60)).toBe("Day 2, 12:01 PM");
    expect(() => formatWorldTime(-1)).toThrowError("world seconds");
    expect(() => formatWorldTime(Number.NaN)).toThrowError("world seconds");
  });

  it("shows recorded wall-clock timestamps as UTC dates instead of elapsed world days", () => {
    const worldTime = Date.UTC(2026, 8, 13, 12, 2, 0) / 1_000;
    expect(formatWorldTime(worldTime)).toBe("Sep 13, 2026 · 12:02 PM UTC");
    expect(formatWorldTime(Date.UTC(2026, 8, 14, 0, 0, 0) / 1_000))
      .toBe("Sep 14, 2026 · 12:00 AM UTC");
    const base = makeFrame();
    expect(projectObserverHud(makeFrame({ world: { ...base.world, worldTime } })).humanTimeLabel)
      .toBe("Sep 13, 2026 · 12:02 PM UTC");
  });

  it("keeps atlas edges directed and redacts unknown queued regions", () => {
    const view = projectLivingAtlas(makeFrame(), makeChronicle({
      upcoming: [
        { sequence: 1, regionId: "warm_springs", urgency: "featured" },
        { sequence: 2, regionId: null, urgency: "drama" },
      ],
    }), "nirvana");

    expect(view.activeStoryRegionId).toBe("warm_springs");
    expect(view.regions.map((region) => ({
      name: region.displayName,
      connections: region.connections.map((edge) => edge.displayName),
      observed: region.observed,
    }))).toEqual([
      { name: "Nirvana", connections: [], observed: true },
      { name: "Warm Springs", connections: ["Nirvana"], observed: false },
    ]);
    expect(view.regions[1].queuedImportance).toEqual({ ambient: 0, featured: 1, drama: 0 });
    expect(view.regions[0]).toMatchObject({
      countsComplete: false,
      unresolvedAgentStatuses: 1,
    });
    expect(view.regions[1]).toMatchObject({
      countsComplete: true,
      unresolvedAgentStatuses: 0,
    });
    expect(JSON.stringify(view)).not.toContain("unknown_future");
  });

  it("shows only the visible dialogue slice and authors safe remote copy", () => {
    const now = makeMoment({
      id: "7:7:single",
      type: "speak",
      scope: "targeted",
      target: "agent_002",
      payload: { text: "Meet me beyond the ridge.", provider: "qwen3:8b" },
    });
    const frame = makeFrame({
      scene: {
        momentId: now.id,
        regionId: "warm_springs",
        phase: "hold",
        focus: { kind: "agent", id: "agent_001" },
        dialogue: {
          speakerId: "agent_001",
          speakerName: "Aster",
          text: "Meet me beyond the ridge.",
          visibleCharacters: 7,
          cursor: 7,
          hold: true,
        },
        actorIntents: [], homeIntents: [], effectIntents: [], safeCancelMarkers: [],
        reducedMotion: false,
      },
    });

    expect(projectDialogueNow(frame, makeChronicle({ now }))).toMatchObject({
      speakerName: "Aster",
      targetName: "Bramble",
      visibleText: "Meet me",
      remote: true,
      hold: true,
    });
    expect(JSON.stringify(projectDialogueNow(frame, makeChronicle({ now })))).not.toMatch(
      /qwen|provider/i,
    );
  });

  it("emits neutral upcoming rows with no future-specific fields", () => {
    const view = projectChronicle(makeFrame(), makeChronicle({
      upcoming: [{ sequence: 4, regionId: "warm_springs", urgency: "drama" }],
    }));
    const row = view.upcoming[0];

    expect(Object.keys(row)).toEqual(["sequence", "regionId", "urgency"]);
    expect(row).toEqual({ sequence: 4, regionId: "warm_springs", urgency: "drama" });
  });

  it("uses safe authored summaries and never carries moment evidence into public rows", () => {
    const previous = makeMoment({
      id: "4:4:single",
      type: "agent_died",
      payload: {
        agent_id: "agent_001",
        message: "backend exception /tmp/raw.json prompt token latency",
      },
    });
    const view = projectChronicle(makeFrame(), makeChronicle({ previous: [previous] }));

    expect(view.previous[0].summary).toBe("Aster's journey ended.");
    expect(JSON.stringify(view.previous[0])).not.toMatch(
      /evidence|backend|\/tmp|prompt|token|latency|agent_001/,
    );
  });

  it("projects a silent checkpoint ahead of active and settled story without opaque identifiers", () => {
    const active = makeMoment({ id: "7:7:single", type: "attack" });
    const previous = makeMoment({ id: "6:6:single", type: "self_talk" });
    const frame = makeFrame({
      checkpointFocus: {
        regionId: "warm_springs",
        kind: "home",
        entityId: "home_private_checkpoint",
        segmentIndex: 1,
        segmentCount: 3,
        removed: false,
      },
    });

    const view = projectStoryNow(
      frame,
      projectChronicle(frame, makeChronicle({ now: active, previous: [previous] })),
    );

    expect(view).toEqual({
      kind: "checkpoint",
      state: "checkpoint",
      regionName: "Warm Springs",
      title: "A shelter has changed",
      summary: "Warm Springs now holds a changed shelter.",
      segmentIndex: 1,
      segmentCount: 3,
    });
    expect(JSON.stringify(view)).not.toMatch(
      /home_private_checkpoint|warm_springs|run-secret|source-secret|agent_001|attack/,
    );
  });

  it("projects active Now before the latest settled row", () => {
    const active = makeMoment({ id: "7:7:single", type: "attack" });
    const previous = makeMoment({ id: "6:6:single", type: "self_talk" });
    const frame = makeFrame({ checkpointFocus: null });

    expect(projectStoryNow(
      frame,
      projectChronicle(frame, makeChronicle({ now: active, previous: [previous] })),
    )).toMatchObject({
      kind: "moment",
      state: "active",
      moment: { key: active.id, title: "A struggle" },
    });
  });

  it("keeps the greatest settled cursor visible and ignores future-only rows", () => {
    const older = makeMoment({ id: "2:4:travel", type: "agent_entered_region" });
    const latest = makeMoment({ id: "5:6:single", type: "self_talk" });
    const frame = makeFrame({ checkpointFocus: null, scene: null });

    expect(projectStoryNow(
      frame,
      projectChronicle(frame, makeChronicle({ previous: [latest, older] })),
    )).toMatchObject({
      kind: "moment",
      state: "latest",
      moment: { key: latest.id, lastCursor: 5 },
    });
    expect(projectStoryNow(
      frame,
      projectChronicle(frame, makeChronicle({
        upcoming: [{ sequence: 8, regionId: "future_private_region", urgency: "drama" }],
      })),
    )).toBeNull();
  });

  it("authors non-generic Chronicle copy for every registered choreography event", () => {
    const payload = {
      agent_id: "agent_001",
      child_id: "agent_002",
      child_name: "Bramble",
      victim_id: "agent_002",
      revived_id: "agent_002",
      speaker_id: "agent_001",
      sender_id: "agent_001",
      receiver_id: "agent_002",
      initiator_id: "agent_001",
      target_id: "agent_002",
      rejecter_id: "agent_002",
      attacker_id: "agent_001",
      breacher_id: "agent_001",
      builder_id: "agent_001",
      owner_id: "agent_001",
      new_owner_id: "agent_001",
      from_region: "nirvana",
      to_region: "warm_springs",
      region: "warm_springs",
      resource_type: "materials",
      amount: 5,
      damage: 6,
      energy_gained: 7,
      integrity_damage: 3,
      loot: { materials: 4 },
      remnant_materials: 2,
      agent_count: 2,
    };

    for (const [index, type] of CHOREOGRAPHY_REGISTERED_EVENT_TYPES.entries()) {
      const frame = makeFrame({ checkpointFocus: null });
      const row = projectChronicle(frame, makeChronicle({
        now: makeMoment({ id: `${index + 1}:${index + 1}:single`, type, payload }),
      })).now;
      expect(row?.title, type).not.toBe("Something changed");
      expect(row?.summary, type).not.toBe("The world changed.");
    }
  });

  it("formats the observed fractional hearth gain without changing its event evidence", () => {
    const base = makeFrame();
    const frame = makeFrame({ world: {
      ...base.world,
      agents: base.world.agents.map((record) => record.value.id === "agent_001"
        ? { ...record, value: { ...record.value, name: "Allen" } }
        : record),
    } });
    const energyGained = 14.389616680145265;
    const moment = makeMoment({
      id: "7:7:single",
      type: "hearth_used",
      payload: { agent_id: "agent_001", energy_gained: energyGained },
    });
    const row = projectChronicle(frame, makeChronicle({ now: moment })).now!;

    expect(`${row.title}. ${row.summary}`)
      .toBe("Hearth tended. Allen warmed at a hearth and gained 14.4 energy.");
    expect(moment.representative.event.payload.energy_gained).toBe(energyGained);
  });

  it.each([
    ["resource_changed", { amount: 1.0000000000000002, resource_type: "materials" }, "Aster gathered 1 material."],
    ["resource_changed", { amount: -3.456789, resource_type: "materials" }, "Aster spent 3.5 materials."],
    ["resource_transferred", { amount: 12, resource_type: "energy" }, "Aster shared 12 energy."],
    ["ruins_scavenged", { amount: 0.04 }, "Aster recovered 0 materials from a ruin."],
    ["home_collapsed", { remnant_materials: 8.789123 }, "A shelter fell into ruin, leaving 8.8 materials behind."],
  ])("uses concise quantities in %s narration", (type, payload, expected) => {
    const moment = makeMoment({ id: "7:7:single", type, payload });
    const row = projectChronicle(makeFrame(), makeChronicle({ now: moment })).now!;
    expect(row.summary).toBe(expected);
  });

  it("denies arbitrary frame and payload entity IDs from every rendered public view", () => {
    const frame = makeFrame({
      world: {
        ...makeFrame().world,
        agents: [
          { completeness: "exact", value: {
            id: "mystic_007", name: "mystic_007", persona: "Keeper mystic_007",
            position: "warm_springs", status: "alive",
          } },
          { completeness: "exact", value: {
            id: "raider_12", name: "The raider_12 among us",
            position: "nirvana", status: "alive",
          } },
        ],
        regions: [
          { completeness: "exact", value: {
            name: "warm_springs",
            description: "A refuge watched by mystic_007.",
            connections: ["nirvana"],
          } },
          { completeness: "exact", value: { name: "nirvana", connections: [] } },
        ],
        homes: [{ completeness: "exact", value: {
          home_id: "shelter_9", owner_id: "mystic_007", region: "warm_springs",
          stakeholders: ["mystic_007", "raider_12"], status: "standing",
        } }],
        ruins: [{ completeness: "exact", value: {
          home_id: "remnant_4", owner_id: "raider_12", region: "nirvana",
          breachers: ["mystic_007"], status: "ruin",
        } }],
      },
      backlog: {
        pendingMoments: 1,
        firstPendingCursor: 8,
        lastPendingCursor: 8,
        state: "behind",
        label: "mystic_007 is waiting",
      },
      selection: { kind: "agent", id: "mystic_007" },
    });
    const now = makeMoment({
      id: "7:7:single",
      type: "agent_born",
      target: "raider_12",
      payload: {
        agent_id: "mystic_007",
        child_id: "newcomer_3",
        child_name: "Young newcomer_3",
        witness_ids: ["raider_12"],
      },
    });
    const dialogueFrame = makeFrame({
      ...frame,
      scene: {
        ...frame.scene!,
        dialogue: {
          speakerId: "mystic_007",
          speakerName: "mystic_007",
          text: "raider_12 waits beside warm_springs.",
          visibleCharacters: 44,
          cursor: 44,
          hold: false,
        },
      },
    });
    const chronicle = makeChronicle({ now });

    const hud = projectObserverHud(frame);
    const atlas = projectLivingAtlas(frame, chronicle, "warm_springs");
    const dialogue = projectDialogueNow(dialogueFrame, chronicle)!;
    const chronicleView = projectChronicle(frame, chronicle);
    const story = projectStoryNow(frame, chronicleView)!;
    const agent = projectSelection(frame, chronicle)!;
    const home = projectSelection({ ...frame, selection: { kind: "home", id: "shelter_9" } }, chronicle)!;
    const ruin = projectSelection({ ...frame, selection: { kind: "ruin", id: "remnant_4" } }, chronicle)!;
    const region = projectSelection({ ...frame, selection: { kind: "region", id: "warm_springs" } }, chronicle)!;

    expect(hud.backlogLabel).toBe("The story is catching up.");
    expect(atlas.regions.find((candidate) => candidate.displayName === "Warm Springs")).toMatchObject({
      displayName: "Warm Springs",
      description: "Details awaiting a checkpoint",
    });
    expect(dialogue).toMatchObject({
      speakerName: "Unknown being",
      targetName: "Unknown being",
      visibleText: "…",
      regionName: "Warm Springs",
    });
    expect(chronicleView.now).toMatchObject({
      title: "A new life",
      summary: "Unknown being joined the world.",
      focusLabel: "Unknown being",
      regionName: "Warm Springs",
    });
    expect(story.kind === "moment" ? story.moment.summary : story.summary)
      .toBe("Unknown being joined the world.");
    expect(agent.title).toBe("Unknown being");
    expect(agent.facts.find((fact) => fact.label === "Identity")?.value).toBe("Unknown");
    expect(home.title).toBe("Unknown being's home");
    expect(home.facts.find((fact) => fact.label === "Stakeholders")?.value)
      .toBe("Unknown being, Unknown being");
    expect(ruin.title).toBe("Unknown being's former home");
    expect(ruin.facts.find((fact) => fact.label === "Known breachers")?.value)
      .toBe("Unknown being");
    expect(region.title).toBe("Warm Springs");
    expect(region.facts.find((fact) => fact.label === "Description")?.value).toBe("Unknown");
    expect(JSON.stringify({
      hud,
      atlas: atlas.regions.map(({ key: _key, connections, ...value }) => ({
        ...value,
        connections: connections.map(({ key: _edgeKey, ...edge }) => edge),
      })),
      dialogue: { ...dialogue, speakerKey: "", targetKey: "" },
      chronicle: {
        ...chronicleView,
        now: chronicleView.now === null ? null : { ...chronicleView.now, key: "" },
      },
      story,
      cards: [agent, home, ruin, region].map(({ key: _key, ...card }) => card),
    })).not.toMatch(/mystic_007|raider_12|newcomer_3/);
  });

  it("formats fractional region resource ratios without floating-point noise", () => {
    const base = makeFrame();
    const frame = makeFrame({
      world: {
        ...base.world,
        regions: base.world.regions.map((record) => record.value.name === "warm_springs"
          ? {
            ...record,
            value: {
              ...record.value,
              current_materials: 84.80000000000007,
              max_materials: 130,
            },
          }
          : record),
      },
      selection: { kind: "region", id: "warm_springs" },
    });

    const region = projectSelection(frame, makeChronicle())!;
    expect(region.facts.find((fact) => fact.label === "Materials")?.value)
      .toBe("84.8 / 130");
  });

  it("uses current shelter event names and public quantities for contest consequences", () => {
    const summaries = Object.fromEntries([
      ["home_collapsed", { remnant_materials: 2 }],
      ["home_breached", { integrity_damage: 3 }],
      ["home_thieved", { loot: { materials: 4 } }],
      ["ruins_scavenged", { amount: 5 }],
    ].map(([type, payload], index) => {
      const frame = makeFrame({ checkpointFocus: null });
      const row = projectChronicle(frame, makeChronicle({
        now: makeMoment({
          id: `${index + 20}:${index + 20}:single`,
          type: String(type),
          payload: payload as Record<string, unknown>,
        }),
      })).now!;
      return [type, { title: row.title, summary: row.summary }];
    }));

    expect(summaries).toEqual({
      home_collapsed: {
        title: "Shelter lost",
        summary: "A shelter fell into ruin, leaving 2 materials behind.",
      },
      home_breached: {
        title: "Shelter breached",
        summary: "Aster damaged a shelter by 3 integrity.",
      },
      home_thieved: {
        title: "Shelter raided",
        summary: "Aster took 4 materials from a shelter.",
      },
      ruins_scavenged: {
        title: "Ruins scavenged",
        summary: "Aster recovered 5 materials from a ruin.",
      },
    });
  });

  it("preserves known projected-partial fields and labels every absent field Unknown", () => {
    const view = projectSelection(makeFrame({
      selection: { kind: "agent", id: "future_child" },
    }), makeChronicle());

    expect(view).toMatchObject({
      kind: "agent",
      title: "Moss",
      completeness: "projected-partial",
      qualifier: "Observed; awaiting exact record",
    });
    expect(view?.facts).toContainEqual({ label: "Energy", value: "Unknown" });
    expect(view?.facts).toContainEqual({ label: "Hoarding", value: "Unknown" });
    expect(view?.title).not.toContain("future_child");
    expect(view?.facts.map((fact) => fact.value).join(" ")).not.toContain("future_child");
  });

  it("projects bounded Archive catalogue metadata and neutralizes unsafe reasons", () => {
    const view = projectArchiveCatalogue({
      state: "ready",
      records: [
        { key: "line:17", worldTime: 42, eventCursor: 8, reason: "Quiet interval", selected: true },
        { key: "line:9", worldTime: 20, eventCursor: 3, reason: "backend exception /tmp/raw.json provider qwen", selected: false },
      ],
      hasMore: true,
    });

    expect(view).toEqual({
      state: "ready",
      checkpoints: [
        { key: "line:17", label: "Shown moment 8", worldTime: 42, eventCursor: 8, reason: "Quiet interval", selected: true },
        { key: "line:9", label: "Shown moment 3", worldTime: 20, eventCursor: 3, reason: "World checkpoint", selected: false },
      ],
      hasMore: true,
    });
  });
});

function makeFrame(
  overrides: Partial<PresentedObserverFrame> = {},
): PresentedObserverFrame {
  return {
    runId: "run-secret",
    sourceKey: "source-secret",
    revision: 1,
    firstCursor: 0,
    lastCursor: 7,
    source: "fixture",
    ingestedCursor: 9,
    presentedCursor: 7,
    world: {
      exactBaseCursor: 6,
      projectedThroughCursor: 7,
      worldTime: 42,
      agents: [
        { completeness: "exact", value: {
          id: "agent_001", name: "Aster", persona: "A patient wanderer.",
          position: "warm_springs", energy: 12, materials: 3, status: "alive",
          offspring_count: 0, home_id: "home_001", is_hoarding: false,
        } },
        { completeness: "exact", value: {
          id: "agent_002", name: "Bramble", position: "nirvana", status: "dead",
        } },
        { completeness: "projected-partial", value: {
          id: "future_child", name: "Moss", position: "nirvana",
        } },
      ],
      regions: [
        { completeness: "exact", value: {
          name: "warm_springs", description: "A gentle basin.", connections: ["nirvana"],
        } },
        { completeness: "projected-partial", value: {
          name: "nirvana", connections: [],
        } },
      ],
      homes: [{ completeness: "exact", value: {
        home_id: "home_001", owner_id: "agent_001", region: "warm_springs",
        integrity: 8, max_integrity: 10, status: "standing",
      } }],
      ruins: [],
      pendingProposals: [],
    },
    scene: {
      momentId: "7:7:single",
      regionId: "warm_springs",
      phase: "hold",
      focus: { kind: "agent", id: "agent_001" },
      dialogue: null,
      actorIntents: [], homeIntents: [], effectIntents: [], safeCancelMarkers: [],
      reducedMotion: false,
    },
    selection: null,
    backlog: {
      pendingMoments: 2,
      firstPendingCursor: 8,
      lastPendingCursor: 9,
      state: "behind",
      label: "Two moments waiting",
    },
    transport: { connection: "live", ingestedCursor: 9, retryable: false },
    ...overrides,
  };
}

function makeChronicle(
  overrides: Partial<PresentedChronicleWindow> = {},
): PresentedChronicleWindow {
  return { now: null, previous: [], upcoming: [], gaps: [], ...overrides };
}

function makeMoment(options: {
  id: string;
  type: string;
  scope?: "local" | "global" | "targeted" | "private";
  target?: string | null;
  payload?: Record<string, unknown>;
}): StoryMoment {
  const entry = {
    cursor: Number(options.id.split(":")[0]),
    event: {
      type: options.type,
      source: "agent_001",
      payload: options.payload ?? { agent_id: "agent_001" },
      scope: options.scope ?? "local",
      region: "warm_springs",
      target: options.target ?? null,
      timestamp: 42,
    },
    resolved: { actor_id: "agent_001", target_id: options.target ?? undefined },
    snapshot_after: null,
  };
  return {
    id: options.id,
    firstCursor: entry.cursor,
    lastCursor: entry.cursor,
    evidenceCursors: [entry.cursor],
    evidence: [entry],
    representative: entry,
    chainKind: "single",
    priority: "featured",
    focus: { kind: "agent", id: "agent_001" },
  };
}
