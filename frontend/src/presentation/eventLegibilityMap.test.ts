import { describe, expect, it } from "vitest";

import { EVENT_VISUAL_EVENT_TYPES } from "../events/eventVisualCatalog";
import { OVERLAY_GLYPH_NAMES } from "../renderer2d/production/environment/bubbleGrammar";
import {
  assertCompleteEventLegibilityMap,
  EVENT_LEGIBILITY_MAP,
  overlayMappingFor,
  OVERLAY_TIER_HOLD_MS,
  OVERLAY_TIER_RANK,
  type OverlayMappingEntry,
} from "./eventLegibilityMap";

/**
 * The loop-ending oracle for the world overlay.
 *
 * The compile-time `Record<PresentedEventType, OverlayMappingEntry>` catches a
 * *renamed* event; these tests catch an *added* one reaching the canonical
 * catalogue without reaching the overlay. Together they mean a new simulation
 * event cannot ship invisible.
 */
describe("event legibility map", () => {
  it("maps every canonical simulation event -- a new event type must fail here until it is given a grammar", () => {
    const missing = EVENT_VISUAL_EVENT_TYPES.filter((type) => EVENT_LEGIBILITY_MAP[type] === undefined);
    expect(missing).toEqual([]);
    expect(Object.keys(EVENT_LEGIBILITY_MAP).sort()).toEqual([...EVENT_VISUAL_EVENT_TYPES].sort());
    expect(EVENT_VISUAL_EVENT_TYPES.length).toBe(28);
  });

  it("rejects a map that has drifted from the canonical vocabulary, in either direction", () => {
    expect(() => assertCompleteEventLegibilityMap()).not.toThrow();

    const { agent_born: _dropped, ...withoutBirth } = EVENT_LEGIBILITY_MAP;
    expect(() => assertCompleteEventLegibilityMap(withoutBirth)).toThrow(/missing=agent_born/);

    expect(() => assertCompleteEventLegibilityMap({
      ...EVENT_LEGIBILITY_MAP,
      agent_transcended: EVENT_LEGIBILITY_MAP.agent_born,
    })).toThrow(/unknown=agent_transcended/);
  });

  it("gives every mapped glyph an authored bitmap, so no event can render as an empty banner", () => {
    const authored = new Set<string>(OVERLAY_GLYPH_NAMES);
    for (const [type, entry] of Object.entries(EVENT_LEGIBILITY_MAP)) {
      if (entry.glyph !== null) {
        expect(authored.has(entry.glyph), `${type} glyph ${entry.glyph}`).toBe(true);
      }
      if (entry.burst !== undefined) {
        expect(authored.has(entry.burst.glyph), `${type} burst ${entry.burst.glyph}`).toBe(true);
      }
    }
  });

  it("wires the ten home/contest events that previously had zero overlay coverage", () => {
    const homeContest = [
      "home_built", "hearth_used", "home_joined", "home_left", "home_started_hoarding",
      "home_collapsed", "home_breached", "home_thieved", "home_colonized", "ruins_scavenged",
    ] as const;
    for (const type of homeContest) {
      const entry = EVENT_LEGIBILITY_MAP[type];
      expect(entry, type).toBeDefined();
      expect(entry.glyph, type).not.toBeNull();
    }
    // `dwell` is the largest glyph family precisely because half this world's
    // drama is about shelter.
    const dwell = Object.values(EVENT_LEGIBILITY_MAP)
      .filter((entry: OverlayMappingEntry) => entry.family === "dwell");
    expect(dwell.length).toBeGreaterThanOrEqual(6);
  });

  it("carries the text kinds without a glyph -- their words are their meaning", () => {
    expect(EVENT_LEGIBILITY_MAP.speak.kind).toBe("speech");
    expect(EVENT_LEGIBILITY_MAP.speak.glyph).toBeNull();
    expect(EVENT_LEGIBILITY_MAP.self_talk.kind).toBe("thought");
    expect(EVENT_LEGIBILITY_MAP.self_talk.glyph).toBeNull();
    // A broadcast is addressed to no one and therefore carries no thread; the
    // whisper promotion happens in the resolver, which is the only layer that
    // knows whether the listener is on screen.
    expect(EVENT_LEGIBILITY_MAP.speak.thread).toBeUndefined();
  });

  it("reserves the inverted field for exactly the two knells that earn it", () => {
    const inverted = Object.entries(EVENT_LEGIBILITY_MAP)
      .filter(([, entry]) => entry.burst?.invert === true)
      .map(([type]) => type)
      .sort();
    expect(inverted).toEqual(["agent_died", "home_collapsed"]);
    // Birth is its mirror in light -- the only other inversion of the field.
    expect(EVENT_LEGIBILITY_MAP.agent_born.burst?.light).toBe(true);
    expect(EVENT_LEGIBILITY_MAP.agent_born.tier).toBe("knell");
  });

  it("tiers death, birth and collapse above every ordinary beat, and ranks demotion order accordingly", () => {
    expect(EVENT_LEGIBILITY_MAP.agent_died.tier).toBe("knell");
    expect(EVENT_LEGIBILITY_MAP.agent_born.tier).toBe("knell");
    expect(EVENT_LEGIBILITY_MAP.home_collapsed.tier).toBe("knell");
    expect(EVENT_LEGIBILITY_MAP.attack.tier).toBe("strike");
    expect(EVENT_LEGIBILITY_MAP.self_talk.tier).toBe("murmur");

    expect(OVERLAY_TIER_RANK.knell).toBeGreaterThan(OVERLAY_TIER_RANK.strike);
    expect(OVERLAY_TIER_RANK.strike).toBeGreaterThan(OVERLAY_TIER_RANK.beat);
    expect(OVERLAY_TIER_RANK.beat).toBeGreaterThan(OVERLAY_TIER_RANK.murmur);
    expect(OVERLAY_TIER_HOLD_MS.knell).toBeGreaterThan(OVERLAY_TIER_HOLD_MS.strike);
    expect(OVERLAY_TIER_HOLD_MS.strike).toBeGreaterThan(OVERLAY_TIER_HOLD_MS.beat);
    expect(OVERLAY_TIER_HOLD_MS.beat).toBeGreaterThan(OVERLAY_TIER_HOLD_MS.murmur);
  });

  it("severs only the refusal, so a gift and a refusal are opposite gestures rather than the same particle", () => {
    const severed = Object.entries(EVENT_LEGIBILITY_MAP)
      .filter(([, entry]) => entry.thread === "severed")
      .map(([type]) => type);
    expect(severed).toEqual(["mating_rejected"]);
    expect(EVENT_LEGIBILITY_MAP.mating_initiated.thread).toBe("aim");
    expect(EVENT_LEGIBILITY_MAP.resource_transferred.thread).toBe("aim");
  });

  it("anchors home-subject events on the structure and harm on whoever it happened to", () => {
    expect(EVENT_LEGIBILITY_MAP.home_started_hoarding.anchor).toBe("home");
    expect(EVENT_LEGIBILITY_MAP.home_colonized.anchor).toBe("home");
    expect(EVENT_LEGIBILITY_MAP.home_collapsed.anchor).toBe("home");
    expect(EVENT_LEGIBILITY_MAP.agent_paralyzed.anchor).toBe("subject");
    expect(EVENT_LEGIBILITY_MAP.agent_decayed.anchor).toBe("subject");
    // A strike marks the attacker and bursts on the victim.
    expect(EVENT_LEGIBILITY_MAP.attack.anchor).toBe("actor");
    expect(EVENT_LEGIBILITY_MAP.attack.burst?.anchor).toBe("subject");
    expect(EVENT_LEGIBILITY_MAP.home_breached.burst?.anchor).toBe("home");
  });

  it("looks up only canonical types and never falls through to a generic mark", () => {
    expect(overlayMappingFor("attack")).toBe(EVENT_LEGIBILITY_MAP.attack);
    expect(overlayMappingFor("not_a_real_event")).toBeUndefined();
    expect(overlayMappingFor("toString")).toBeUndefined();
  });
});
