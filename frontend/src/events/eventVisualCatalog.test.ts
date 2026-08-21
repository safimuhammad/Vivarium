import { describe, expect, it } from "vitest";

import {
  EVENT_VISUAL_CATALOG,
  EVENT_VISUAL_EVENT_TYPES,
  EVENT_VISUAL_ICON_KEYS,
  getEventVisualMetadata,
  isEventVisualEventType,
} from "./eventVisualCatalog";

const WORLD_REFERENCE_EVENT_TYPES = [
  "agent_born",
  "agent_died",
  "agent_decayed",
  "agent_paralyzed",
  "agent_recovered",
  "agent_left_region",
  "agent_entered_region",
  "speak",
  "self_talk",
  "resource_changed",
  "resource_transferred",
  "agent_started_hoarding",
  "mating_initiated",
  "mating_rejected",
  "mating_proposal_invalidated",
  "mating_proposal_timeout",
  "attack",
  "home_built",
  "hearth_used",
  "home_joined",
  "home_left",
  "home_started_hoarding",
  "home_collapsed",
  "home_breached",
  "home_thieved",
  "home_colonized",
  "ruins_scavenged",
  "simulation_started",
] as const;

const LAYER_74_VISUAL_BEHAVIOR = {
  agent_born: { priority: "featured", accent: "#f0c66f", salient: true },
  agent_died: { priority: "drama", accent: "#c74f45", salient: true },
  agent_decayed: { priority: "featured", accent: "#9b8054", salient: true },
  agent_paralyzed: { priority: "drama", accent: "#c74f45", salient: true },
  agent_recovered: { priority: "featured", accent: "#f0c66f", salient: true },
  agent_left_region: { priority: "ambient", accent: "#6fc7bd", salient: false },
  agent_entered_region: { priority: "ambient", accent: "#6fc7bd", salient: false },
  speak: { priority: "featured", accent: "#6fc7bd", salient: false },
  self_talk: { priority: "featured", accent: "#d6b96f", salient: false },
  resource_changed: { priority: "ambient", accent: "#8fac6d", salient: false },
  resource_transferred: { priority: "ambient", accent: "#8fac6d", salient: false },
  agent_started_hoarding: { priority: "ambient", accent: "#d6b96f", salient: false },
  mating_initiated: { priority: "featured", accent: "#d9a8bd", salient: true },
  mating_rejected: { priority: "featured", accent: "#d9a8bd", salient: true },
  mating_proposal_invalidated: { priority: "featured", accent: "#d9a8bd", salient: true },
  mating_proposal_timeout: { priority: "featured", accent: "#d9a8bd", salient: true },
  attack: { priority: "drama", accent: "#c74f45", salient: false },
  home_built: { priority: "featured", accent: "#d6b96f", salient: true },
  hearth_used: { priority: "featured", accent: "#d6b96f", salient: true },
  home_joined: { priority: "ambient", accent: "#d6b96f", salient: false },
  home_left: { priority: "ambient", accent: "#d6b96f", salient: false },
  home_started_hoarding: { priority: "ambient", accent: "#d6b96f", salient: false },
  home_collapsed: { priority: "drama", accent: "#9b8054", salient: true },
  home_breached: { priority: "drama", accent: "#d96e3f", salient: true },
  home_thieved: { priority: "drama", accent: "#d96e3f", salient: true },
  home_colonized: { priority: "drama", accent: "#d96e3f", salient: true },
  ruins_scavenged: { priority: "featured", accent: "#9b8054", salient: true },
  simulation_started: { priority: "featured", accent: "#ede4d2", salient: false },
} as const;

describe("eventVisualCatalog", () => {
  it("covers exactly the 28 world-reference event types", () => {
    expect(EVENT_VISUAL_EVENT_TYPES).toEqual(WORLD_REFERENCE_EVENT_TYPES);
    expect(EVENT_VISUAL_EVENT_TYPES).toHaveLength(28);
    expect(Object.keys(EVENT_VISUAL_CATALOG).sort()).toEqual(
      [...WORLD_REFERENCE_EVENT_TYPES].sort(),
    );
  });

  it("keeps every metadata entry deterministic and renderer-safe", () => {
    for (const type of WORLD_REFERENCE_EVENT_TYPES) {
      const metadata = EVENT_VISUAL_CATALOG[type];

      expect(metadata.glyph, type).toMatch(/^[\x20-\x7e]{1,3}$/);
      expect(EVENT_VISUAL_ICON_KEYS, type).toContain(metadata.iconKey);
      expect(metadata.iconKey, type).toMatch(/^[a-z][a-z-]*[a-z]$/);
      expect(metadata.iconLabel, type).toMatch(/^[\x20-\x7e]{3,40}$/);
      expect(metadata.iconLabel, type).toBe(metadata.iconLabel.trim());
      expect(metadata.medallionLabel, type).toMatch(/^[\x20-\x7e]{3,24}$/);
      expect(metadata.medallionLabel, type).toBe(metadata.medallionLabel.trim());
      expect(["ambient", "featured", "drama"], type).toContain(metadata.priority);
      expect(metadata.accent, type).toMatch(/^#[0-9a-f]{6}$/i);
      expect(typeof metadata.salient, type).toBe("boolean");
      expect(
        Object.values(metadata).every(
          (value) => typeof value === "string" || typeof value === "boolean",
        ),
        type,
      ).toBe(true);
    }
  });

  it("does not use placeholder letter-code metadata for icons or labels", () => {
    const letterCodePattern = /^[a-z]{2}$/i;
    const uppercaseLetterCodePattern = /^[A-Z]{2}$/;

    for (const type of WORLD_REFERENCE_EVENT_TYPES) {
      const metadata = EVENT_VISUAL_CATALOG[type];

      expect(metadata.iconKey, type).not.toMatch(letterCodePattern);
      expect(metadata.iconLabel, type).not.toMatch(uppercaseLetterCodePattern);
      expect(metadata.medallionLabel, type).not.toMatch(uppercaseLetterCodePattern);
      expect(metadata.iconKey.toUpperCase(), type).not.toBe(metadata.glyph);
      expect(metadata.iconLabel, type).not.toBe(metadata.glyph);
      expect(metadata.medallionLabel, type).not.toBe(metadata.glyph);
    }
  });

  it("uses semantic icon keys for representative event families", () => {
    expect(getEventVisualMetadata("agent_died")).toMatchObject({
      iconKey: "skull",
      iconLabel: "Death",
    });
    expect(getEventVisualMetadata("mating_initiated")).toMatchObject({
      iconKey: "bond",
      medallionLabel: "Bond",
    });
    expect(getEventVisualMetadata("home_built")).toMatchObject({
      iconKey: "home",
      medallionLabel: "Home",
    });
    expect(getEventVisualMetadata("home_thieved")).toMatchObject({
      iconKey: "theft",
      iconLabel: "Vault theft",
    });
    expect(getEventVisualMetadata("speak")).toMatchObject({
      iconKey: "speech",
      medallionLabel: "Speech",
    });
    expect(getEventVisualMetadata("simulation_started")).toMatchObject({
      iconKey: "world",
      iconLabel: "World start",
    });
    expect(getEventVisualMetadata("agent_left_region")?.iconKey).toBe("footstep");
    expect(getEventVisualMetadata("agent_entered_region")?.iconKey).toBe("footstep");
    expect(getEventVisualMetadata("resource_transferred")?.iconKey).toBe("gift");
    expect(getEventVisualMetadata("hearth_used")?.iconKey).toBe("hearth");
    expect(getEventVisualMetadata("home_breached")?.iconKey).toBe("breach");
    expect(getEventVisualMetadata("home_colonized")?.iconKey).toBe("crown");
    expect(getEventVisualMetadata("ruins_scavenged")?.iconKey).toBe("ruin");
  });

  it("preserves Layer 74 priority, accent, and salience behavior", () => {
    for (const type of WORLD_REFERENCE_EVENT_TYPES) {
      expect(EVENT_VISUAL_CATALOG[type], type).toMatchObject(
        LAYER_74_VISUAL_BEHAVIOR[type],
      );
    }
  });

  it("does not invent metadata for unknown future event types", () => {
    expect(getEventVisualMetadata("mating_accepted")).toBeUndefined();
    expect(isEventVisualEventType("mating_accepted")).toBe(false);
    expect(isEventVisualEventType("agent_born")).toBe(true);
  });
});
