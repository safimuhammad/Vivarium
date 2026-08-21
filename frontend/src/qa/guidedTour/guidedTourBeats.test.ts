import { describe, expect, it } from "vitest";

import { getChronicleManifest } from "../../presentation/fixtures/chronicleCatalog";
import { deriveGuidedTourBeats, type GuidedTourBeat } from "./guidedTourBeats";

const manifest = getChronicleManifest("C18");
const beats = deriveGuidedTourBeats(manifest);

function beatAt(cursor: number): GuidedTourBeat {
  const beat = beats.find((candidate) => candidate.cursor === cursor);
  if (beat === undefined) throw new Error(`no guided tour beat for cursor ${cursor}`);
  return beat;
}

describe("deriveGuidedTourBeats", () => {
  it("produces exactly one beat per C18 fixture entry, in cursor order", () => {
    expect(beats).toHaveLength(38);
    expect(beats.map((beat) => beat.cursor)).toEqual(
      Array.from({ length: 38 }, (_, index) => index + 1),
    );
    expect(beats.every((beat) => beat.total === 38)).toBe(true);
    expect(beats.map((beat) => beat.index)).toEqual(
      Array.from({ length: 38 }, (_, index) => index + 1),
    );
  });

  it("gives every one of the 38 entries its own beat even when the type repeats", () => {
    const matingInitiated = beats.filter((beat) => beat.type === "mating_initiated");
    expect(matingInitiated.map((beat) => beat.cursor)).toEqual([7, 9, 11, 13]);
    const homeBreached = beats.filter((beat) => beat.type === "home_breached");
    expect(homeBreached.map((beat) => beat.cursor)).toEqual([22, 24]);
    const homeCollapsed = beats.filter((beat) => beat.type === "home_collapsed");
    expect(homeCollapsed.map((beat) => beat.cursor)).toEqual([33, 34]);
    const homeBuilt = beats.filter((beat) => beat.type === "home_built");
    expect(homeBuilt.map((beat) => beat.cursor)).toEqual([15, 31]);
    // Distinct watch lines even for the identical event type.
    expect(new Set(matingInitiated.map((beat) => beat.watchLine)).size).toBe(4);
  });

  it("never leaves a beat pointed at an unresolved region", () => {
    for (const beat of beats) {
      expect(beat.region, `cursor ${beat.cursor} (${beat.type})`).not.toBe("");
    }
  });

  it("resolves simulation_started's region-less opening beat via lookahead", () => {
    expect(beatAt(1).region).toBe("warm_springs");
    expect(beatAt(1).focus).toBeNull();
  });

  it("resolves the direct-region beats verbatim", () => {
    expect(beatAt(2).region).toBe("warm_springs");
    expect(beatAt(14).region).toBe("warm_springs");
    expect(beatAt(21).region).toBe("nirvana");
    expect(beatAt(38).region).toBe("nirvana_east");
  });

  it("resolves the region-less courtship chain (cursors 7-13) to the acting being's live region", () => {
    for (const cursor of [7, 8, 9, 10, 11, 12, 13]) {
      expect(beatAt(cursor).region, `cursor ${cursor}`).toBe("nirvana");
    }
  });

  it("resolves self_talk's region-less beat to the speaker's last known region", () => {
    expect(beatAt(36).region).toBe("warm_springs");
  });

  it("focuses the acting being by default", () => {
    expect(beatAt(2).focus).toEqual({ kind: "agent", id: "wanderer_001" });
    expect(beatAt(26).focus).toEqual({ kind: "agent", id: "wanderer_003" });
  });

  it("focuses the victim, not 'system', for a breath/system-sourced agent_paralyzed", () => {
    expect(beatAt(27).focus).toEqual({ kind: "agent", id: "wanderer_004" });
  });

  it("focuses the accepting parent for agent_born, not the not-yet-rendered newborn", () => {
    expect(beatAt(14).focus).toEqual({ kind: "agent", id: "wanderer_002" });
  });

  it("focuses the ruin/home site, not the (possibly already-removed) former owner, for home_collapsed", () => {
    expect(beatAt(33).focus).toEqual({ kind: "ruin", id: "home_c18_thieve" });
    expect(beatAt(34).focus).toEqual({ kind: "ruin", id: "home_8551244f" });
  });

  it("has no focus for the actor-less simulation_started beat", () => {
    expect(beatAt(1).focus).toBeNull();
  });

  it("marks pure-travel beats as dead-travel with a short hold, and holds everything else the default", () => {
    for (const cursor of [20, 21, 37, 38]) {
      const beat = beatAt(cursor);
      expect(beat.isDeadTravel, `cursor ${cursor}`).toBe(true);
      expect(beat.holdMs).toBeLessThan(2_000);
    }
    for (const cursor of [1, 14, 26, 30]) {
      const beat = beatAt(cursor);
      expect(beat.isDeadTravel, `cursor ${cursor}`).toBe(false);
      expect(beat.holdMs).toBeGreaterThanOrEqual(3_000);
    }
  });

  it("composes a caption with the beat progress, event type, and region", () => {
    expect(beatAt(12).caption).toBe("beat 12/38 — mating_proposal_invalidated · nirvana");
    expect(beatAt(2).caption).toBe("beat 2/38 — resource_changed · warm_springs");
  });

  it("names participants using display names, not raw agent IDs", () => {
    expect(beatAt(2).participants).toBe("Joe");
    expect(beatAt(29).participants).toBe("Mae → Allen");
    expect(beatAt(14).participants).toContain("Martha");
  });

  it("exposes the same names on participantNames for camera-fit consumers", () => {
    expect(beatAt(26).participantNames).toEqual(["Dick", "Allen"]);
    expect(beatAt(29).participantNames).toEqual(["Mae", "Allen"]);
    expect(beatAt(14).participantNames).toEqual(["Allen", "Mae", "Martha"]);
  });

  it("resolves every named participant from the event payload, not just the hand-authored list", () => {
    // Regression: home_breached's `breachers` array names a co-breacher the
    // hand-authored C18 content had missed for both of C18's home_breached beats.
    expect(beatAt(22).participantNames).toContain("Mae");
    expect(beatAt(22).participantNames).toContain("Allen"); // co-breacher from `breachers`
    expect(beatAt(24).participantNames).toContain("Allen");
    expect(beatAt(24).participantNames).toContain("Mae"); // co-breacher from `breachers`
  });

  it("stages home_colonized's new owner + new stakeholders, not the dispossessed former owner", () => {
    // Mirrors homeContestSystem.ts's own home_colonized staging: `new_owner_id` +
    // `new_stakeholders` are participants; `previous_owner_id`/
    // `previous_stakeholders` back a text diagnostic only and are not staged as
    // present, so this resolver must not pull Dick (the former owner) in either.
    expect(beatAt(25).participantNames).toEqual(["Allen", "Mae"]);
    expect(beatAt(25).participantNames).not.toContain("Dick");
  });

  it("resolves killer_id for agent_died even though it isn't resolved.actor_id/target_id", () => {
    expect(beatAt(30).participantNames).toContain("Allen");
    expect(beatAt(30).participantNames).toContain("Dick");
  });

  it("gives every beat a non-empty watch line", () => {
    for (const beat of beats) {
      expect(beat.watchLine.length, `cursor ${beat.cursor}`).toBeGreaterThan(0);
    }
  });
});

describe("deriveGuidedTourBeats (C19)", () => {
  const c19Manifest = getChronicleManifest("C19");
  const c19Beats = deriveGuidedTourBeats(c19Manifest);

  function c19BeatAt(cursor: number): GuidedTourBeat {
    const beat = c19Beats.find((candidate) => candidate.cursor === cursor);
    if (beat === undefined) throw new Error(`no C19 guided tour beat for cursor ${cursor}`);
    return beat;
  }

  it("produces exactly one beat per C19 fixture entry, in cursor order", () => {
    expect(c19Beats).toHaveLength(28);
    expect(c19Beats.map((beat) => beat.cursor)).toEqual(
      Array.from({ length: 28 }, (_, index) => index + 1),
    );
    expect(c19Beats.every((beat) => beat.total === 28)).toBe(true);
  });

  it("stays in the single nirvana region for every beat — no cross-region travel", () => {
    for (const beat of c19Beats) {
      expect(beat.region, `cursor ${beat.cursor} (${beat.type})`).toBe("nirvana");
      expect(beat.isDeadTravel, `cursor ${beat.cursor}`).toBe(false);
    }
  });

  it("uses C19's own authored content, not C18's, and not the generic fallback", () => {
    expect(c19BeatAt(6).watchLine).toBe(
      "Dick raises a home — watch him work at the frame until the walls stand",
    );
    expect(c19BeatAt(21).watchLine).toBe("Allen strikes Dick — watch the recoil and the red flash");
    expect(c19BeatAt(27).watchLine).toBe(
      "Allen's home falls: with no living stakeholder the world lets it go — watch the vignette wash and the walls swap to ruin",
    );
    // None of these are the generic "event type at region" fallback shape (e.g.
    // "attack at nirvana") — every C19 cursor has authored content, so the fallback
    // (`genericWatchLine`) must never actually fire for this chronicle.
    for (const beat of c19Beats) {
      const generic = `${beat.type.replaceAll("_", " ")} at ${beat.region}`;
      expect(beat.watchLine, `cursor ${beat.cursor}`).not.toBe(generic);
    }
  });

  it("gives distinct watch lines to same-typed repeats (two mating_initiated, two home_breached)", () => {
    const matingInitiated = c19Beats.filter((beat) => beat.type === "mating_initiated");
    expect(matingInitiated.map((beat) => beat.cursor)).toEqual([13, 15]);
    expect(new Set(matingInitiated.map((beat) => beat.watchLine)).size).toBe(2);
    const homeBreached = c19Beats.filter((beat) => beat.type === "home_breached");
    expect(homeBreached.map((beat) => beat.cursor)).toEqual([17, 19]);
    expect(new Set(homeBreached.map((beat) => beat.watchLine)).size).toBe(2);
  });

  it("names Dick and Allen using display names at the act-boundary review cues", () => {
    expect(c19BeatAt(10).participantNames).toContain("Allen");
    expect(c19BeatAt(16).participantNames).toEqual(
      expect.arrayContaining(["Dick", "Allen", "Angela"]),
    );
    expect(c19BeatAt(20).participantNames).toEqual(["Allen"]);
    expect(c19BeatAt(24).participantNames).toEqual(
      expect.arrayContaining(["Allen", "Dick"]),
    );
    expect(c19BeatAt(28).participantNames).toEqual(["Dick"]);
  });

  it("resolves every named participant from the payload, not just the authored list (co-context for attack/paralysis)", () => {
    // attacker_id is threaded through even though C19's C18-style authoring already
    // lists it — this is the same algorithmic guarantee C18 relies on, exercised
    // here against a different fixture's payload shapes.
    expect(c19BeatAt(21).participantNames).toEqual(["Allen", "Dick"]);
    expect(c19BeatAt(22).participantNames).toEqual(
      expect.arrayContaining(["Dick", "Allen"]),
    );
  });

  it("stages home_colonized's new owner only, not the dispossessed former owner", () => {
    expect(c19BeatAt(20).participantNames).toEqual(["Allen"]);
    expect(c19BeatAt(20).participantNames).not.toContain("Dick");
  });

  it("focuses the ruin/home site, not the dead former owner, for home_collapsed", () => {
    expect(c19BeatAt(27).focus).toEqual({ kind: "ruin", id: "home_cc756819" });
  });

  it("focuses the accepting parent for agent_born, not the not-yet-rendered newborn", () => {
    expect(c19BeatAt(16).focus).toEqual({ kind: "agent", id: "wanderer_003" });
  });

  it("gives every beat a non-empty watch line", () => {
    for (const beat of c19Beats) {
      expect(beat.watchLine.length, `cursor ${beat.cursor}`).toBeGreaterThan(0);
    }
  });
});
