import { describe, expect, it } from "vitest";

import { makeWorld } from "../test/fixtures";
import {
  eventPresentationContextFromSnapshot,
  eventPresentationContextFromSnapshots,
  presentEvent,
  presentEventBubbleDetail,
  presentEventChainDetail,
  type EventPresentation,
} from "./eventPresentation";
import type { EventEnvelopeEntry, SerializedEvent } from "./schemas";

const world = makeWorld();
const context = eventPresentationContextFromSnapshot(world);

describe("presentEvent", () => {
  it("builds presentation context from a replay snapshot", () => {
    const snapshot = makeWorld();
    const snapshotContext = eventPresentationContextFromSnapshot(snapshot);
    const presentation = presentEvent(
      entry(
        "home_joined",
        {
          agent_id: "agent_001",
          home_id: "home_001",
          target_home: "home_001",
          region: "meadow",
        },
        {
          actor_id: "agent_001",
          home_id: "home_001",
          region: "meadow",
        },
      ),
      snapshotContext,
    );

    expect(presentation.title).toBe("Aster joined home 001");
    expect(presentation.detail).toBe("Aster joined home 001 in meadow.");
    expect(
      (snapshotContext.agentsById as ReadonlyMap<string, unknown>).get("agent_001"),
    ).toBe(snapshot.agents[0]);
    expect(
      (snapshotContext.homesById as ReadonlyMap<string, unknown>).get("home_001"),
    ).toBe(snapshot.homes[0]);
    expect(
      (snapshotContext.ruinsById as ReadonlyMap<string, unknown>).get("home_old"),
    ).toBe(snapshot.ruins[0]);
    expect(
      (snapshotContext.regionsByName as ReadonlyMap<string, unknown>).get("meadow"),
    ).toBe(snapshot.regions[0]);
  });

  it("returns empty presentation context for nullish snapshots", () => {
    const nullContext = eventPresentationContextFromSnapshots(null);
    const presentation = presentEvent(
      entry(
        "home_joined",
        {
          agent_id: "agent_001",
          home_id: "home_001",
          target_home: "home_001",
          region: "meadow",
        },
        {
          actor_id: "agent_001",
          home_id: "home_001",
          region: "meadow",
        },
      ),
      nullContext,
    );

    expect(nullContext).toEqual({});
    expect(eventPresentationContextFromSnapshots(undefined, [])).toEqual({});
    expect(eventPresentationContextFromSnapshot(null)).toEqual({});
    expect(eventPresentationContextFromSnapshot(undefined)).toEqual({});
    expect(presentation.title).toBe("Being 001 joined home 001");
    expect(presentation.detail).toBe("being 001 joined home 001 in meadow.");
  });

  it("uses primary snapshot names first and fills missing beings from fallback snapshots", () => {
    const primary = makeWorld({
      agents: world.agents
        .filter((agent) => agent.id !== "agent_002")
        .map((agent) =>
          agent.id === "agent_001"
            ? { ...agent, name: "Primary Aster" }
            : agent,
        ),
    });
    const fallback = makeWorld({
      agents: world.agents.map((agent) => {
        if (agent.id === "agent_001") {
          return { ...agent, name: "Fallback Aster" };
        }
        if (agent.id === "agent_002") {
          return { ...agent, name: "Archive Briar" };
        }
        return agent;
      }),
    });
    const lateFallback = makeWorld({
      agents: world.agents.map((agent) =>
        agent.id === "agent_002" ? { ...agent, name: "Late Briar" } : agent,
      ),
    });
    const context = eventPresentationContextFromSnapshots(primary, [
      fallback,
      lateFallback,
    ]);
    const primaryPresentation = presentEvent(
      entry(
        "speak",
        { speaker_id: "agent_001", message: "Still here." },
        { actor_id: "agent_001", region: "meadow" },
      ),
      context,
    );
    const fallbackPresentation = presentEvent(
      entry(
        "speak",
        { speaker_id: "agent_002", message: "Remember me." },
        { actor_id: "agent_002", region: "meadow" },
      ),
      context,
    );
    const nullPrimaryPresentation = presentEvent(
      entry(
        "speak",
        { speaker_id: "agent_002", message: "Fallback only." },
        { actor_id: "agent_002", region: "meadow" },
      ),
      eventPresentationContextFromSnapshots(null, [fallback]),
    );

    expect(primaryPresentation.detail).toBe('Primary Aster: "Still here."');
    expect(fallbackPresentation.detail).toBe('Archive Briar: "Remember me."');
    expect(nullPrimaryPresentation.detail).toBe(
      'Archive Briar: "Fallback only."',
    );
  });

  it("preserves full sanitized speech and thought text with related ids", () => {
    const speech = presentEvent(
      entry(
        "speak",
        {
          speaker_id: "agent_001",
          target_id: "agent_002",
          message:
            "The agent cataloged each ember, every bridge, and an llm rumor before npcs spawn near the grove; no clause should vanish.",
        },
        { actor_id: "agent_001", target_id: "agent_002", region: "meadow" },
        { target: "agent_002", region: "meadow" },
      ),
      context,
    );
    const thought = presentEvent(
      entry(
        "self_talk",
        {
          agent_id: "agent_001",
          message:
            "The agent should remember every llm fragment, every spawned plan, and the npc name carried from dawn until dusk.",
        },
        { actor_id: "agent_001" },
        { source: "agent_001", scope: "private", region: null },
      ),
      context,
    );

    expect(speech.group).toBe("speech");
    expect(speech.detail).toBe(
      'Aster to Briar: "The being cataloged each ember, every bridge, and a mind rumor before beings birth near the grove; no clause should vanish."',
    );
    expect(speech.message).toBe(speech.detail);
    expect(speech.related).toEqual({
      agentIds: ["agent_001", "agent_002"],
      homeIds: [],
      regionNames: ["meadow"],
    });

    expect(thought.group).toBe("thought");
    expect(thought.detail).toBe(
      'Aster kept a thought: "The being should remember every mind fragment, every was born plan, and the being name carried from dawn until dusk."',
    );
    expect(thought.message).toBe(thought.detail);
    expect(thought.related).toEqual({
      agentIds: ["agent_001"],
      homeIds: [],
      regionNames: [],
    });
  });

  it("returns compact sanitized detail for high-value world bubbles", () => {
    const cases: Array<{
      type: string;
      payload: Record<string, unknown>;
      resolved: EventEnvelopeEntry["resolved"];
      overrides?: Partial<Omit<SerializedEvent, "type" | "payload">>;
      detail: { kind: string; text: string };
    }> = [
      {
        type: "agent_left_region",
        payload: { agent_id: "agent_001", from_region: "meadow", to_region: "grove" },
        resolved: { actor_id: "agent_001", region: "meadow" },
        detail: { kind: "movement-departure", text: "toward grove" },
      },
      {
        type: "agent_entered_region",
        payload: { agent_id: "agent_001", from_region: "grove", to_region: "meadow" },
        resolved: { actor_id: "agent_001", region: "meadow" },
        detail: { kind: "movement-arrival", text: "from grove" },
      },
      {
        type: "speak",
        payload: {
          speaker_id: "agent_001",
          target_id: "agent_002",
          message: "Agent Npc rally with an LlM.",
        },
        resolved: { actor_id: "agent_001", target_id: "agent_002", region: "meadow" },
        overrides: { target: "agent_002" },
        detail: { kind: "direct-speech", text: "to Briar" },
      },
      {
        type: "self_talk",
        payload: { agent_id: "agent_001", message: "The simulation may spawn an npc." },
        resolved: { actor_id: "agent_001", region: "meadow" },
        overrides: { scope: "private", region: null },
        detail: { kind: "private-thought", text: "private thought" },
      },
      {
        type: "resource_changed",
        payload: {
          agent_id: "agent_001",
          region: "meadow",
          resource_type: "materials",
          amount: 6,
        },
        resolved: { actor_id: "agent_001", region: "meadow", resource_type: "materials", amount: 6 },
        detail: { kind: "harvest", text: "6 materials gathered" },
      },
      {
        type: "resource_transferred",
        payload: {
          sender_id: "agent_001",
          receiver_id: "agent_002",
          region: "meadow",
          resource_type: "energy",
          amount: 8,
        },
        resolved: { actor_id: "agent_001", target_id: "agent_002", region: "meadow", resource_type: "energy", amount: 8 },
        detail: { kind: "shared-resource", text: "8 energy to Briar" },
      },
      {
        type: "mating_initiated",
        payload: { initiator_id: "agent_001", target_id: "agent_002" },
        resolved: { actor_id: "agent_001", target_id: "agent_002", region: "meadow" },
        overrides: { target: "agent_002" },
        detail: { kind: "bond-call", text: "to Briar" },
      },
      {
        type: "mating_rejected",
        payload: { rejecter_id: "agent_002", initiator_id: "agent_001" },
        resolved: { actor_id: "agent_002", target_id: "agent_001", region: "meadow" },
        detail: { kind: "bond-refused", text: "Briar turns away" },
      },
      {
        type: "mating_proposal_invalidated",
        payload: { initiator_id: "agent_001", target_id: "agent_002" },
        resolved: { actor_id: "agent_001", target_id: "agent_002", region: "meadow" },
        detail: { kind: "bond-faded", text: "bond thread fades" },
      },
      {
        type: "mating_proposal_timeout",
        payload: { initiator_id: "agent_001", target_id: "agent_002" },
        resolved: { actor_id: "agent_001", target_id: "agent_002", region: "meadow" },
        detail: { kind: "bond-faded", text: "bond thread fades" },
      },
      {
        type: "agent_born",
        payload: {
          child_id: "agent_004",
          child_name: "Dawn",
          parent_ids: ["agent_001", "agent_002"],
          region: "meadow",
        },
        resolved: { actor_id: "agent_004", target_id: "agent_001", region: "meadow" },
        detail: { kind: "birth", text: "child of Aster and Briar" },
      },
      {
        type: "agent_recovered",
        payload: { giver_id: "agent_001", revived_id: "agent_002", region: "grove" },
        resolved: { actor_id: "agent_001", target_id: "agent_002", region: "grove" },
        detail: { kind: "life-relit", text: "Briar relit" },
      },
      {
        type: "agent_paralyzed",
        payload: { agent_id: "agent_002", region: "grove", trigger: "starvation" },
        resolved: { actor_id: "agent_001", region: "grove" },
        detail: { kind: "life-fallen", text: "Briar falls" },
      },
      {
        type: "agent_died",
        payload: { victim_id: "agent_002", killer_id: "agent_001", region: "grove" },
        resolved: { actor_id: "agent_001", target_id: "agent_002", region: "grove" },
        detail: { kind: "death", text: "felled by Aster" },
      },
      {
        type: "agent_died",
        payload: { victim_id: "agent_002", killer: "agent_001", region: "grove" },
        resolved: { actor_id: "agent_002", target_id: "agent_002", region: "grove" },
        detail: { kind: "death", text: "felled by Aster" },
      },
      {
        type: "agent_decayed",
        payload: { agent_id: "agent_002", agent_name: "Briar", region: "grove" },
        resolved: { actor_id: "agent_002", region: "grove" },
        detail: { kind: "decay", text: "Briar returns" },
      },
      {
        type: "agent_started_hoarding",
        payload: { agent_id: "agent_001", region: "meadow", energy: 520, materials: 12 },
        resolved: { actor_id: "agent_001", region: "meadow" },
        detail: { kind: "being-hoard", text: "Aster holds a great store" },
      },
      {
        type: "home_built",
        payload: {
          home_id: "home_001",
          target_home: "home_001",
          builder_id: "agent_001",
          region: "meadow",
        },
        resolved: { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
        detail: { kind: "home-raised", text: "Aster raises shelter" },
      },
      {
        type: "hearth_used",
        payload: { agent_id: "agent_001", home_id: "home_001", target_home: "home_001" },
        resolved: { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
        detail: { kind: "shelter-taken", text: "Aster takes shelter" },
      },
      {
        type: "home_joined",
        payload: { agent_id: "agent_002", home_id: "home_001", target_home: "home_001" },
        resolved: { actor_id: "agent_002", home_id: "home_001", region: "meadow" },
        detail: { kind: "shelter-joined", text: "Briar joins the hearth" },
      },
      {
        type: "home_left",
        payload: { agent_id: "agent_002", home_id: "home_001", target_home: "home_001" },
        resolved: { actor_id: "agent_002", home_id: "home_001", region: "meadow" },
        detail: { kind: "shelter-left", text: "Briar leaves the hearth" },
      },
      {
        type: "home_started_hoarding",
        payload: { agent_id: "agent_001", home_id: "home_001", target_home: "home_001" },
        resolved: { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
        detail: { kind: "vault-hoard", text: "vault grows heavy" },
      },
      {
        type: "home_collapsed",
        payload: { home_id: "home_001", target_home: "home_001", owner_id: "agent_001" },
        resolved: { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
        detail: { kind: "home-crumbled", text: "hearth crumbles" },
      },
      {
        type: "home_breached",
        payload: { home_id: "home_001", target_home: "home_001", breacher_id: "agent_001" },
        resolved: { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
        detail: { kind: "raid-threshold", text: "Aster breaks the threshold" },
      },
      {
        type: "home_thieved",
        payload: {
          home_id: "home_001",
          target_home: "home_001",
          breacher_id: "agent_001",
          region: "meadow",
          loot: { materials: 14 },
        },
        resolved: { actor_id: "agent_001", home_id: "home_001", region: "meadow", amount: 14 },
        detail: { kind: "theft", text: "14 materials taken" },
      },
      {
        type: "home_colonized",
        payload: {
          home_id: "home_001",
          target_home: "home_001",
          breacher_id: "agent_001",
          new_owner_id: "agent_001",
          region: "meadow",
        },
        resolved: { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
        detail: { kind: "home-seized", text: "Aster claims the hearth" },
      },
      {
        type: "ruins_scavenged",
        payload: {
          agent_id: "agent_001",
          home_id: "home_old",
          target_home: "home_old",
          region: "grove",
          resource_type: "materials",
          amount: 6,
        },
        resolved: {
          actor_id: "agent_001",
          home_id: "home_old",
          region: "grove",
          resource_type: "materials",
          amount: 6,
        },
        detail: { kind: "ruin-scavenge", text: "6 materials gathered" },
      },
      {
        type: "attack",
        payload: { attacker_id: "agent_001", victim_id: "agent_002", region: "grove" },
        resolved: { actor_id: "agent_001", target_id: "agent_002", region: "grove" },
        detail: { kind: "strike", text: "toward Briar" },
      },
      {
        type: "simulation_started",
        payload: { agent_count: 3 },
        resolved: { region: "meadow" },
        overrides: { source: "world" },
        detail: { kind: "world-wake", text: "3 beings awake" },
      },
    ];

    for (const item of cases) {
      const detail = presentEventBubbleDetail(
        entry(item.type, item.payload, item.resolved, item.overrides),
        context,
      );
      expect(detail, item.type).toEqual(item.detail);
      expect(`${detail?.kind} ${detail?.text}`, item.type).not.toMatch(bannedVisibleWords);
      expect(detail?.text, item.type).not.toMatch(/\b(agent|home)_\d+\b/i);
    }

    expect(
      presentEventBubbleDetail(
        entry(
          "mating_initiated",
          { initiator_id: "agent_missing", target_id: "agent_absent" },
          { actor_id: "agent_missing", target_id: "agent_absent", region: "meadow" },
          { target: "agent_absent" },
        ),
        {},
      ),
    ).toEqual({ kind: "bond-call", text: "to another being" });
  });

  it("uses the rejecter for compact mating rejection detail", () => {
    expect(
      presentEventBubbleDetail(
        entry(
          "mating_rejected",
          {
            rejecter_id: "agent_002",
            initiator_id: "agent_001",
            target_id: "agent_002",
          },
          { target_id: "agent_001" },
          { source: "agent_002", target: "agent_001", scope: "targeted" },
        ),
        context,
      ),
    ).toEqual({ kind: "bond-refused", text: "Briar turns away" });
  });

  it("returns compact chain context for grouped representative beats", () => {
    const breached = entryAt(
      7,
      "home_breached",
      {
        home_id: "home_001",
        target_home: "home_001",
        breacher_id: "agent_003",
        region: "meadow",
      },
      { actor_id: "agent_003", home_id: "home_001", region: "meadow" },
    );
    const thieved = entryAt(
      8,
      "home_thieved",
      {
        home_id: "home_001",
        target_home: "home_001",
        breacher_id: "agent_003",
        region: "meadow",
        loot: { materials: 14 },
      },
      { actor_id: "agent_003", home_id: "home_001", region: "meadow", amount: 14 },
    );
    const strike = entryAt(
      20,
      "attack",
      { attacker_id: "agent_003", victim_id: "agent_002", region: "grove" },
      { actor_id: "agent_003", target_id: "agent_002", region: "grove" },
    );
    const death = entryAt(
      21,
      "agent_died",
      { victim_id: "agent_002", killer_id: "agent_003", region: "grove" },
      { actor_id: "agent_003", target_id: "agent_002", region: "grove" },
    );
    const transfer = entryAt(
      30,
      "resource_transferred",
      {
        sender_id: "agent_001",
        receiver_id: "agent_002",
        region: "meadow",
        resource_type: "energy",
        amount: 8,
      },
      { actor_id: "agent_001", target_id: "agent_002", region: "meadow", resource_type: "energy", amount: 8 },
    );
    const recovery = entryAt(
      31,
      "agent_recovered",
      {
        giver_id: "agent_001",
        revived_id: "agent_002",
        region: "meadow",
        resource_type: "energy",
        amount: 8,
      },
      { actor_id: "agent_001", target_id: "agent_002", region: "meadow", resource_type: "energy", amount: 8 },
    );

    expect(presentEventChainDetail(thieved, [breached, thieved])).toEqual({
      kind: "breach-theft",
      text: "after breach",
      count: 2,
      startCursor: 7,
      endCursor: 8,
      window: "7-8",
    });
    expect(presentEventChainDetail(death, [death, strike])).toEqual({
      kind: "strike-death",
      text: "after strike",
      count: 2,
      startCursor: 20,
      endCursor: 21,
      window: "20-21",
    });
    expect(presentEventChainDetail(recovery, [transfer, recovery])).toEqual({
      kind: "gift-recovery",
      text: "after gift",
      count: 2,
      startCursor: 30,
      endCursor: 31,
      window: "30-31",
    });
    expect(presentEventChainDetail(thieved, [thieved])).toBeUndefined();

    for (const detail of [
      presentEventChainDetail(thieved, [breached, thieved]),
      presentEventChainDetail(death, [death, strike]),
      presentEventChainDetail(recovery, [transfer, recovery]),
    ]) {
      expect(`${detail?.kind} ${detail?.text}`).not.toMatch(bannedVisibleWords);
      expect(detail?.text).not.toMatch(/\b(agent|home)_\d+\b/i);
    }
  });

  it("uses the recovered being as the subject even when the source is the giver", () => {
    const presentation = presentEvent(
      entry(
        "agent_recovered",
        {
          giver_id: "agent_001",
          recipient_id: "agent_002",
          revived_id: "agent_002",
          region: "grove",
          resource_type: "energy",
          amount: 8,
          message: "Agent ID:agent_001 revived Agent ID:agent_002.",
        },
        {
          actor_id: "agent_001",
          target_id: "agent_002",
          region: "grove",
          resource_type: "energy",
          amount: 8,
        },
        { source: "agent_001", target: "agent_002", region: "grove" },
      ),
      context,
    );

    expect(presentation.title).toBe("Briar recovered");
    expect(presentation.detail).toBe("Briar recovered after Aster shared 8 energy.");
    expect(presentation.group).toBe("life");
    expect(presentation.related.agentIds).toEqual(["agent_001", "agent_002"]);
    expect(visibleText(presentation)).not.toMatch(bannedVisibleWords);
  });

  it("uses the collapsed being as the subject even when the source is system", () => {
    const presentation = presentEvent(
      entry(
        "agent_paralyzed",
        {
          agent_id: "agent_002",
          victim_id: "agent_002",
          attacker_id: "agent_001",
          region: "grove",
          energy: 0,
          message: "Agent ID:agent_002 collapsed.",
        },
        {
          actor_id: "agent_001",
          target_id: "agent_002",
          region: "grove",
        },
        { source: "system", region: "grove" },
      ),
      context,
    );

    expect(presentation.title).toBe("Briar collapsed");
    expect(presentation.detail).toBe("Briar collapsed after a strike from Aster.");
    expect(presentation.tone).toBe("grave");
    expect(presentation.related.agentIds).toEqual(["agent_001", "agent_002"]);
    expect(visibleText(presentation)).not.toMatch(bannedVisibleWords);
  });

  it("extracts related ids for home, region, and multi-being events", () => {
    const presentation = presentEvent(
      entry(
        "home_thieved",
        {
          home_id: "home_old",
          target_home: "home_old",
          breacher_id: "agent_001",
          region: "grove",
          recipients: ["agent_001", "agent_002"],
          loot: { materials: 12 },
        },
        {
          actor_id: "agent_001",
          home_id: "home_old",
          region: "grove",
        },
        { source: "agent_001", region: "grove" },
      ),
      context,
    );

    expect(presentation.title).toBe("Home old was stripped");
    expect(presentation.detail).toBe(
      "Aster and 1 other stripped 12 materials from home old.",
    );
    expect(presentation.related).toEqual({
      agentIds: ["agent_001", "agent_002"],
      homeIds: ["home_old"],
      regionNames: ["grove"],
    });
  });

  it("relates bond offers, closed offers, and births to every participant", () => {
    const offered = presentEvent(
      entry(
        "mating_initiated",
        {
          initiator_id: "agent_001",
          target_id: "agent_002",
          resources: { energy: 50, materials: 30 },
        },
        { actor_id: "agent_001", target_id: "agent_002", region: "meadow" },
        { source: "agent_001", target: "agent_002", scope: "targeted" },
      ),
      context,
    );
    const lapsed = presentEvent(
      entry(
        "mating_proposal_timeout",
        {
          initiator_id: "agent_001",
          target_id: "agent_002",
          reason: "expired",
          resources_refunded: { energy: 50, materials: 30 },
        },
        { actor_id: "agent_001", target_id: "agent_002", region: "meadow" },
        { source: "agent_001", target: "agent_001", scope: "targeted" },
      ),
      context,
    );
    const born = presentEvent(
      entry(
        "agent_born",
        {
          child_id: "agent_004",
          child_name: "Dawn",
          parent_ids: ["agent_001", "agent_002"],
          region: "meadow",
        },
        { actor_id: "agent_004", target_id: "agent_001", region: "meadow" },
        { source: "agent_004", region: "meadow" },
      ),
      context,
    );

    expect(offered.group).toBe("bond");
    expect(offered.detail).toBe("Aster made an offer to Briar with 50 energy and 30 materials.");
    expect(offered.related.agentIds).toEqual(["agent_001", "agent_002"]);
    expect(lapsed.group).toBe("bond");
    expect(lapsed.related.agentIds).toEqual(["agent_001", "agent_002"]);
    expect(born.detail).toBe("Dawn was born in meadow to Aster and Briar.");
    expect(born.related.agentIds).toEqual(["agent_004", "agent_001", "agent_002"]);
    expect([offered, lapsed, born].map(visibleText).join(" ")).not.toMatch(bannedVisibleWords);
  });

  it("relates targeted bond events to participant snapshot regions when the event is regionless", () => {
    const cases = [
      entry(
        "mating_initiated",
        { initiator_id: "agent_001", target_id: "agent_002" },
        { actor_id: "agent_001", target_id: "agent_002" },
        { source: "agent_001", target: "agent_002", scope: "targeted" },
      ),
      entry(
        "mating_rejected",
        { rejecter_id: "agent_002", initiator_id: "agent_001", target_id: "agent_001" },
        { actor_id: "agent_002", target_id: "agent_001" },
        { source: "agent_002", target: "agent_001", scope: "targeted" },
      ),
      entry(
        "mating_proposal_invalidated",
        { initiator_id: "agent_001", target_id: "agent_002" },
        { actor_id: "agent_001", target_id: "agent_001" },
        { source: "agent_001", target: "agent_001", scope: "targeted" },
      ),
      entry(
        "mating_proposal_timeout",
        { initiator_id: "agent_001", target_id: "agent_002" },
        { actor_id: "agent_001", target_id: "agent_001" },
        { source: "agent_001", target: "agent_001", scope: "targeted" },
      ),
    ];

    for (const item of cases) {
      const regionNames = presentEvent(item, context).related.regionNames;
      expect(regionNames).toHaveLength(2);
      expect(regionNames).toEqual(expect.arrayContaining(["meadow", "grove"]));
      expect(presentEvent(item, {}).related.regionNames).toEqual([]);
    }
  });

  it("keeps lifecycle copy observer-facing instead of exposing raw fallback prose", () => {
    const presentation = presentEvent(
      entry(
        "simulation_started",
        {
          agent_count: 2,
          message: "Simulation started: 2 agents breathing.",
        },
        {},
        { source: "world", scope: "global" },
      ),
      context,
    );

    expect(presentation.title).toBe("World wakes");
    expect(presentation.detail).toBe("The world woke with 2 beings.");
    expect(visibleText(presentation)).not.toMatch(bannedVisibleWords);
  });

  it("covers every world-reference event type with observer-facing copy", () => {
    const cases: Array<{
      type: string;
      payload: Record<string, unknown>;
      resolved: EventEnvelopeEntry["resolved"];
      overrides?: Partial<Omit<SerializedEvent, "type" | "payload">>;
      label: string;
      group: EventPresentation["group"];
    }> = [
      {
        type: "agent_left_region",
        payload: { agent_id: "agent_001", from_region: "meadow", to_region: "grove" },
        resolved: { actor_id: "agent_001", region: "meadow" },
        label: "departed",
        group: "movement",
      },
      {
        type: "agent_entered_region",
        payload: { agent_id: "agent_001", from_region: "meadow", to_region: "grove" },
        resolved: { actor_id: "agent_001", region: "grove" },
        label: "arrived",
        group: "movement",
      },
      {
        type: "speak",
        payload: { speaker_id: "agent_001", target_id: "agent_002", message: "An Npc found an LlM near the hearth." },
        resolved: { actor_id: "agent_001", target_id: "agent_002", region: "meadow" },
        overrides: { target: "agent_002", region: "meadow" },
        label: "spoke",
        group: "speech",
      },
      {
        type: "self_talk",
        payload: { agent_id: "agent_001", message: "I should gather." },
        resolved: { actor_id: "agent_001" },
        overrides: { scope: "private", region: null },
        label: "private thought",
        group: "thought",
      },
      {
        type: "resource_changed",
        payload: { agent_id: "agent_001", region: "meadow", resource_type: "energy", amount: 8 },
        resolved: { actor_id: "agent_001", region: "meadow", resource_type: "energy", amount: 8 },
        label: "gathered",
        group: "resource",
      },
      {
        type: "resource_transferred",
        payload: { sender_id: "agent_001", receiver_id: "agent_002", region: "meadow", resource_type: "energy", amount: 8 },
        resolved: { actor_id: "agent_001", target_id: "agent_002", region: "meadow", resource_type: "energy", amount: 8 },
        overrides: { target: "agent_002" },
        label: "shared",
        group: "resource",
      },
      {
        type: "agent_recovered",
        payload: { giver_id: "agent_001", recipient_id: "agent_002", revived_id: "agent_002", region: "meadow", resource_type: "energy", amount: 8 },
        resolved: { actor_id: "agent_001", target_id: "agent_002", region: "meadow", resource_type: "energy", amount: 8 },
        overrides: { target: "agent_002" },
        label: "recovered",
        group: "life",
      },
      {
        type: "agent_paralyzed",
        payload: { agent_id: "agent_002", region: "grove", trigger: "aging", energy: 3 },
        resolved: { target_id: "agent_002", region: "grove" },
        overrides: { source: "system", region: "grove" },
        label: "collapsed",
        group: "life",
      },
      {
        type: "agent_died",
        payload: { victim_id: "agent_002", killer_id: "agent_001", region: "grove", looted_energy: 2, looted_materials: 3 },
        resolved: { actor_id: "agent_001", target_id: "agent_002", region: "grove" },
        overrides: { source: "agent_002", target: "agent_001", region: "grove" },
        label: "died",
        group: "life",
      },
      {
        type: "agent_decayed",
        payload: { agent_id: "agent_002", agent_name: "Briar", region: "grove", died_at: 10, decayed_at: 132 },
        resolved: { actor_id: "agent_002", region: "grove" },
        label: "returned to earth",
        group: "life",
      },
      {
        type: "agent_born",
        payload: { child_id: "agent_004", child_name: "Dawn", parent_ids: ["agent_001", "agent_002"], region: "meadow" },
        resolved: { actor_id: "agent_004", target_id: "agent_001", region: "meadow" },
        label: "born",
        group: "life",
      },
      {
        type: "mating_initiated",
        payload: { initiator_id: "agent_001", target_id: "agent_002", resources: { energy: 50, materials: 30 } },
        resolved: { actor_id: "agent_001", target_id: "agent_002", region: "meadow" },
        overrides: { scope: "targeted", target: "agent_002" },
        label: "bond offered",
        group: "bond",
      },
      {
        type: "mating_rejected",
        payload: { rejecter_id: "agent_002", initiator_id: "agent_001", target_id: "agent_001", resources_refunded: { energy: 50, materials: 30 } },
        resolved: { actor_id: "agent_002", target_id: "agent_001", region: "meadow" },
        overrides: { scope: "targeted", target: "agent_001" },
        label: "bond declined",
        group: "bond",
      },
      {
        type: "mating_proposal_invalidated",
        payload: { initiator_id: "agent_001", target_id: "agent_002", reason: "initiator_ineligible" },
        resolved: { actor_id: "agent_001", target_id: "agent_002", region: "meadow" },
        overrides: { scope: "targeted", target: "agent_001" },
        label: "offer fell through",
        group: "bond",
      },
      {
        type: "mating_proposal_timeout",
        payload: { initiator_id: "agent_001", target_id: "agent_002", reason: "expired" },
        resolved: { actor_id: "agent_001", target_id: "agent_002", region: "meadow" },
        overrides: { scope: "targeted", target: "agent_001" },
        label: "offer lapsed",
        group: "bond",
      },
      {
        type: "attack",
        payload: { attacker_id: "agent_001", victim_id: "agent_002", region: "grove", damage: 20 },
        resolved: { actor_id: "agent_001", target_id: "agent_002", region: "grove" },
        overrides: { target: "agent_002" },
        label: "strike",
        group: "contest",
      },
      {
        type: "agent_started_hoarding",
        payload: { agent_id: "agent_001", region: "meadow", energy: 520, materials: 12 },
        resolved: { actor_id: "agent_001", region: "meadow" },
        label: "great store",
        group: "resource",
      },
      {
        type: "home_built",
        payload: { home_id: "home_001", target_home: "home_001", builder_id: "agent_001", owner_id: "agent_001", region: "meadow" },
        resolved: { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
        label: "home raised",
        group: "home",
      },
      {
        type: "hearth_used",
        payload: { agent_id: "agent_001", home_id: "home_001", target_home: "home_001", region: "meadow", energy_gained: 8 },
        resolved: { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
        label: "hearth tended",
        group: "home",
      },
      {
        type: "home_joined",
        payload: { agent_id: "agent_002", home_id: "home_001", target_home: "home_001", owner_id: "agent_001", region: "meadow" },
        resolved: { actor_id: "agent_002", home_id: "home_001", region: "meadow" },
        label: "home joined",
        group: "home",
      },
      {
        type: "home_left",
        payload: { agent_id: "agent_002", home_id: "home_001", target_home: "home_001", previous_owner_id: "agent_001", owner_id: "agent_001", region: "meadow" },
        resolved: { actor_id: "agent_002", home_id: "home_001", region: "meadow" },
        label: "home left",
        group: "home",
      },
      {
        type: "home_started_hoarding",
        payload: { home_id: "home_001", target_home: "home_001", agent_id: "agent_001", region: "meadow", vault_materials: 320 },
        resolved: { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
        label: "vault swelled",
        group: "home",
      },
      {
        type: "home_collapsed",
        payload: { home_id: "home_001", target_home: "home_001", owner_id: "agent_001", region: "meadow", remnant_materials: 49 },
        resolved: { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
        label: "home crumbled",
        group: "home",
      },
      {
        type: "home_breached",
        payload: { home_id: "home_001", target_home: "home_001", breacher_id: "agent_001", intent: "thieve", region: "meadow" },
        resolved: { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
        label: "home breached",
        group: "contest",
      },
      {
        type: "home_thieved",
        payload: { home_id: "home_001", target_home: "home_001", breacher_id: "agent_001", region: "meadow", recipients: ["agent_001"], loot: { materials: 14 } },
        resolved: { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
        label: "vault stripped",
        group: "contest",
      },
      {
        type: "home_colonized",
        payload: { home_id: "home_001", target_home: "home_001", breacher_id: "agent_001", new_owner_id: "agent_001", new_stakeholders: ["agent_001"], region: "meadow" },
        resolved: { actor_id: "agent_001", home_id: "home_001", region: "meadow" },
        label: "home seized",
        group: "contest",
      },
      {
        type: "ruins_scavenged",
        payload: { agent_id: "agent_001", home_id: "home_old", target_home: "home_old", region: "grove", resource_type: "materials", amount: 6 },
        resolved: { actor_id: "agent_001", home_id: "home_old", region: "grove", resource_type: "materials", amount: 6 },
        label: "ruins picked",
        group: "contest",
      },
      {
        type: "simulation_started",
        payload: { run_id: "seed-7", agent_count: 2, world_time: 0 },
        resolved: {},
        overrides: { source: "world", scope: "global", region: null },
        label: "world wakes",
        group: "system",
      },
    ];

    expect(cases).toHaveLength(28);

    for (const item of cases) {
      const presentation = presentEvent(
        entry(item.type, item.payload, item.resolved, item.overrides),
        context,
      );

      expect(presentation.label, item.type).toBe(item.label);
      expect(presentation.group, item.type).toBe(item.group);
      expect(presentation.title, item.type).not.toHaveLength(0);
      expect(presentation.detail, item.type).not.toHaveLength(0);
      expect(visibleText(presentation), item.type).not.toMatch(bannedVisibleWords);
    }
  });
});

const bannedVisibleWords = /\b(simulation|agent|LLM|spawn|NPC)\b/i;

function visibleText(presentation: EventPresentation): string {
  return [
    presentation.label,
    presentation.title,
    presentation.detail,
    presentation.message,
  ].join(" ");
}

function entryAt(
  cursor: number,
  type: string,
  payload: Record<string, unknown>,
  resolved: EventEnvelopeEntry["resolved"],
  overrides: Partial<Omit<SerializedEvent, "type" | "payload">> = {},
): EventEnvelopeEntry {
  return {
    ...entry(type, payload, resolved, overrides),
    cursor,
  };
}

function entry(
  type: string,
  payload: Record<string, unknown>,
  resolved: EventEnvelopeEntry["resolved"],
  overrides: Partial<Omit<SerializedEvent, "type" | "payload">> = {},
): EventEnvelopeEntry {
  return {
    cursor: 1,
    event: {
      type,
      source: overrides.source ?? "world",
      payload,
      scope: overrides.scope ?? "local",
      region: overrides.region ?? null,
      target: overrides.target ?? null,
      timestamp: overrides.timestamp ?? 12.25,
    },
    resolved,
    snapshot_after: null,
  };
}
