import { describe, expect, it } from "vitest";

import {
  parseEventEnvelope,
  parseWorldSnapshot,
} from "../../app/schemas";
import { parseSnapshotCheckpoint } from "../../app/replayArtifacts";
import {
  CHRONICLE_CATALOG,
  CHRONICLE_CATALOG_INDEX,
  CHRONICLE_IDS,
  FIXTURE_PRESENTATION_SOURCE,
  chronicleTerminalAuthority,
  getChronicleManifest,
  parseChronicleManifest,
} from "./chronicleCatalog";

const expectedSlugs = {
  C00: "world-four-regions-topology",
  C01: "movement-local-path",
  C02: "travel-all-regions",
  C03: "resources-harvest-hoard-transfer",
  C04: "mating-proposal-birth",
  C05: "mating-failure-branches",
  C06: "home-build-hearth-stake-vault",
  C07: "home-contest-thieve",
  C08: "home-contest-colonize",
  C09: "home-silent-repair-collapse-ruin",
  C10: "combat-hit-paralyze-recover",
  C11: "combat-lethal-death-decay",
  C12: "cross-region-causal-life-story",
  C13: "presentation-backlog-pause-resume",
  C14: "transport-reconnect-checkpoint-recovery",
  C15: "archive-live-isolation",
  C16: "pressure-4096-envelopes",
  C17: "communication-perception-privacy",
  C18: "grand-tour-all-events",
  C19: "two-beings",
} as const;

describe("chronicleCatalog", () => {
  it("loads the exact frozen C00-C19 catalog as fixture-owned manifests", () => {
    expect(FIXTURE_PRESENTATION_SOURCE).toBe("fixture");
    expect(CHRONICLE_IDS).toEqual(Object.keys(expectedSlugs));
    expect(Object.keys(CHRONICLE_CATALOG)).toEqual(CHRONICLE_IDS);
    expect(CHRONICLE_CATALOG_INDEX).toHaveLength(20);

    for (const id of CHRONICLE_IDS) {
      const manifest = getChronicleManifest(id);
      expect(manifest.id).toBe(id);
      expect(manifest.slug).toBe(expectedSlugs[id]);
      expect(manifest.version).toBe(1);
      expect(manifest.runId).toBe(`mock-${id.toLowerCase()}-v1`);
      expect(manifest.expectedFinalCursor).toBe(manifest.entries.length);
    }
  });

  it("validates every manifest payload through the existing production parsers", () => {
    for (const manifest of Object.values(CHRONICLE_CATALOG)) {
      expect(parseWorldSnapshot(manifest.initialSnapshot)).toEqual(
        manifest.initialSnapshot,
      );
      expect(
        parseEventEnvelope({
          schema: 1,
          cursor: 0,
          oldest_cursor: manifest.entries[0]?.cursor ?? 0,
          next_cursor: manifest.expectedFinalCursor,
          events: manifest.entries,
          overflow: false,
          snapshot_required: false,
        }).events,
      ).toEqual(manifest.entries);
      for (const record of manifest.checkpoints) {
        expect(parseSnapshotCheckpoint(record.checkpoint)).toEqual(
          record.checkpoint,
        );
      }
    }
  });

  it("requires cursor-qualified marker authority for repeated event types", () => {
    const c09 = getChronicleManifest("C09");
    const expectedMarkers = [
      "event:agent_entered_region",
      "event:agent_left_region",
      "event:home_collapsed@cursor:1",
      "event:home_collapsed@cursor:2",
      "event:ruins_scavenged@cursor:5",
      "event:ruins_scavenged@cursor:6",
      "checkpoint:final",
    ];

    expect(parseChronicleManifest({ ...c09, expectedMarkers }).expectedMarkers)
      .toEqual(expectedMarkers);
  });

  it("normalizes ordinary chronicles to mechanic-story terminal authority", () => {
    const c12 = getChronicleManifest("C12");

    expect(c12.expectedTerminal.presentationAuthority).toEqual({
      kind: "mechanic-story",
      terminal: {
        source: "live",
        runId: c12.runId,
        sourceKey: `live:${c12.runId}`,
        cursor: c12.expectedFinalCursor,
      },
    });
  });

  it("authors exact presentation terminal authority for C00, C14, and C15", () => {
    expect(getChronicleManifest("C00").expectedTerminal.presentationAuthority).toEqual({
      kind: "silent-checkpoint",
      terminal: {
        source: "live",
        runId: "mock-c00-v1",
        sourceKey: "live:mock-c00-v1",
        cursor: 0,
      },
    });
    expect(getChronicleManifest("C14").expectedTerminal.presentationAuthority).toEqual({
      kind: "transport-recovery",
      terminal: {
        source: "live",
        runId: "mock-c14-v1-replacement",
        sourceKey: "live:mock-c14-v1-replacement",
        cursor: 0,
      },
    });
    expect(getChronicleManifest("C15").expectedTerminal.presentationAuthority).toEqual({
      kind: "archive-live-isolation",
      terminal: {
        source: "live",
        runId: "mock-c15-v1",
        sourceKey: "live:mock-c15-v1",
        cursor: 4,
      },
    });
  });

  it("keeps mechanic truth separate from the exact presentation terminal snapshot", () => {
    const c14 = getChronicleManifest("C14");
    const c14Authority = chronicleTerminalAuthority(c14);
    expect(c14Authority.mechanic).toEqual({
      runId: "mock-c14-v1",
      finalCursor: 0,
      finalSnapshot: c14.expectedTerminal.finalSnapshot,
    });
    expect(c14Authority.presentation.terminal.snapshot).toMatchObject({
      run_id: "mock-c14-v1-replacement",
      event_cursor: 0,
      world_time: c14.initialSnapshot.world_time,
    });

    const c15 = getChronicleManifest("C15");
    expect(chronicleTerminalAuthority(c15).presentation.terminal.snapshot).toMatchObject({
      run_id: "mock-c15-v1",
      event_cursor: 4,
      world_time: c15.initialSnapshot.world_time + 4,
    });

    const c12 = getChronicleManifest("C12");
    expect(chronicleTerminalAuthority(c12).presentation.terminal.snapshot).toEqual(
      c12.expectedTerminal.finalSnapshot,
    );
  });

  it("returns deeply immutable authority snapshots isolated from catalog truth", () => {
    const c14 = getChronicleManifest("C14");
    const authority = chronicleTerminalAuthority(c14);
    const catalogEnergy = c14.expectedTerminal.finalSnapshot.agents[0]!.energy;

    expect(authority.mechanic.finalSnapshot).not.toBe(c14.expectedTerminal.finalSnapshot);
    expect(Object.isFrozen(authority.mechanic.finalSnapshot.agents)).toBe(true);
    expect(Object.isFrozen(authority.presentation.terminal.snapshot.regions[0])).toBe(true);
    expect(() => {
      authority.mechanic.finalSnapshot.agents[0]!.energy = catalogEnergy + 1;
    }).toThrow();
    expect(c14.expectedTerminal.finalSnapshot.agents[0]!.energy).toBe(catalogEnergy);
  });

  it("rejects eventless authorship, record, and zero-mechanic drift at catalog ingress", () => {
    const c15 = getChronicleManifest("C15");
    const authorship = c15.expectedTerminal.fixtureAuthorship as Record<string, unknown>;
    const records = c15.expectedTerminal.presentationRecords as readonly Record<string, unknown>[];

    expect(() => parseChronicleManifest({
      ...c15,
      expectedTerminal: {
        ...c15.expectedTerminal,
        fixtureAuthorship: { ...authorship, handAuthoredEnvelopeCount: 1 },
      },
    })).toThrow(/handAuthoredEnvelopeCount/);
    expect(() => parseChronicleManifest({
      ...c15,
      expectedTerminal: {
        ...c15.expectedTerminal,
        presentationRecords: [{
          ...records[0],
          payload: { archiveCursor: 2, liveCursor: 5 },
        }],
      },
    })).toThrow(/C15.*Archive 2.*Live 4/);

    const c14 = getChronicleManifest("C14");
    expect(() => parseChronicleManifest({
      ...c14,
      checkpoints: [{
        ...c14.checkpoints[0],
        checkpoint: {
          ...c14.checkpoints[0]!.checkpoint,
          event_cursor: 1,
          snapshot: { ...c14.checkpoints[0]!.checkpoint.snapshot, event_cursor: 1 },
        },
      }],
    })).toThrow(/checkpoint cursor cannot exceed expectedFinalCursor|zero mechanic/);
  });

  it("rejects presentation authority that does not name its exact Live source", () => {
    const c14 = getChronicleManifest("C14");

    expect(() => parseChronicleManifest({
      ...c14,
      expectedTerminal: {
        ...c14.expectedTerminal,
        presentationAuthority: {
          kind: "transport-recovery",
          terminal: {
            source: "live",
            runId: "mock-c14-v1-replacement",
            sourceKey: "live:mock-c14-v1",
            cursor: 0,
          },
        },
      },
    })).toThrow("presentation terminal sourceKey must exactly identify its Live run");
  });

  it("rejects drifted manifest identity before it can enter fixture transport", () => {
    const c12 = getChronicleManifest("C12");

    expect(() => parseChronicleManifest({ ...c12, runId: "wrong-run" })).toThrow(
      "manifest runId must match its frozen Chronicle id",
    );
    expect(() =>
      parseChronicleManifest({ ...c12, expectedFinalCursor: 99 }),
    ).toThrow("manifest expectedFinalCursor must equal its final entry cursor");
    expect(() => parseChronicleManifest({ ...c12, slug: "wrong-slug" })).toThrow(
      "manifest slug must match its frozen Chronicle id",
    );
    expect(() => parseChronicleManifest({ ...c12, seed: c12.seed + 1 })).toThrow(
      "manifest seed must match its frozen Chronicle id",
    );
  });

  it("rejects checkpoint line, cursor, time, and final-checkpoint drift", () => {
    const c12 = getChronicleManifest("C12");
    const checkpoint = c12.checkpoints[0];
    const duplicated = {
      ...c12,
      checkpoints: [checkpoint, checkpoint],
    };
    expect(() => parseChronicleManifest(duplicated)).toThrow(
      "manifest checkpoint lines must be strictly increasing",
    );

    const future = {
      ...c12,
      checkpoints: [{
        ...checkpoint,
        checkpoint: {
          ...checkpoint.checkpoint,
          event_cursor: c12.expectedFinalCursor + 1,
          snapshot: {
            ...checkpoint.checkpoint.snapshot,
            event_cursor: c12.expectedFinalCursor + 1,
          },
        },
      }],
    };
    expect(() => parseChronicleManifest(future)).toThrow(
      "manifest checkpoint cursor cannot exceed expectedFinalCursor",
    );

    const wrongFinal = {
      ...c12,
      checkpoints: [{
        ...checkpoint,
        checkpoint: {
          ...checkpoint.checkpoint,
          event_cursor: Math.max(0, c12.expectedFinalCursor - 1),
          snapshot: {
            ...checkpoint.checkpoint.snapshot,
            event_cursor: Math.max(0, c12.expectedFinalCursor - 1),
          },
        },
      }],
    };
    expect(() => parseChronicleManifest(wrongFinal)).toThrow(
      "manifest final checkpoint must align with expectedFinalCursor",
    );
  });

  it.each([
    ["world_tick", "archive-manual"],
    ["event:speak", "safe-world-tick"],
    ["manual_capture", "archive-event"],
  ] as const)(
    "rejects checkpoint reason %s classified as %s",
    (reason, safety) => {
      const c12 = getChronicleManifest("C12");
      const finalRecord = c12.checkpoints.at(-1)!;

      expect(() => parseChronicleManifest({
        ...c12,
        checkpoints: [{
          ...finalRecord,
          safety,
          checkpoint: { ...finalRecord.checkpoint, reason },
        }],
      })).toThrow("checkpoint safety must match its reason");
    },
  );

  it("rejects semantic and negative oracle drift independently of payload parsing", () => {
    const c12 = getChronicleManifest("C12");
    const terminal = c12.expectedTerminal as unknown as {
      readonly semanticOracle: {
        readonly positive: readonly string[];
        readonly negative: readonly string[];
        readonly terminal: readonly string[];
      };
    };
    expect(() => parseChronicleManifest({
      ...c12,
      expectedTerminal: {
        ...c12.expectedTerminal,
        semanticOracle: {
          ...terminal.semanticOracle,
          positive: terminal.semanticOracle.positive.slice(1),
        },
      },
    })).toThrow("manifest semanticOracle positive contract does not match its Chronicle id");
    expect(() => parseChronicleManifest({
      ...c12,
      negativeAssertions: [...c12.negativeAssertions, "invented"],
    })).toThrow(
      "manifest semanticOracle negative contract must match negativeAssertions",
    );
  });

  it("rejects fabricated mechanics, a nonzero initial cursor, and missing terminal truth", () => {
    const c12 = getChronicleManifest("C12");
    const lastEntry = c12.entries.at(-1)!;
    const finalRecord = c12.checkpoints.at(-1)!;
    const finalSnapshot = c12.expectedTerminal.finalSnapshot as typeof c12.initialSnapshot;
    const fabricatedCursor = c12.expectedFinalCursor + 1;
    expect(() => parseChronicleManifest({
      ...c12,
      entries: [
        ...c12.entries,
        {
          ...lastEntry,
          cursor: fabricatedCursor,
          event: { ...lastEntry.event, type: "fabricated_mechanic" },
        },
      ],
      expectedFinalCursor: fabricatedCursor,
      expectedMarkers: [
        ...[
          ...c12.expectedMarkers.filter((marker) => marker !== "checkpoint:final"),
          "event:fabricated_mechanic",
        ].sort(),
        "checkpoint:final",
      ],
      checkpoints: [{
        ...finalRecord,
        checkpoint: {
          ...finalRecord.checkpoint,
          event_cursor: fabricatedCursor,
          snapshot: { ...finalRecord.checkpoint.snapshot, event_cursor: fabricatedCursor },
        },
      }],
      expectedTerminal: {
        ...c12.expectedTerminal,
        finalSnapshot: { ...finalSnapshot, event_cursor: fabricatedCursor },
      },
    })).toThrow("manifest event type must belong to the canonical 28-event catalog");

    expect(() => parseChronicleManifest({
      ...c12,
      initialSnapshot: { ...c12.initialSnapshot, event_cursor: 5 },
    })).toThrow("manifest initialSnapshot.event_cursor must be zero");

    const { finalSnapshot: _, ...withoutFinalSnapshot } = c12.expectedTerminal;
    expect(() => parseChronicleManifest({
      ...c12,
      expectedTerminal: withoutFinalSnapshot,
    })).toThrow("manifest expectedTerminal.finalSnapshot is required");
  });
});
