import { describe, expect, it } from "vitest";

import { makeWorld } from "../test/fixtures";
import {
  presentEvent,
  type EventPresentationContext,
} from "./eventPresentation";
import { createArchivePresentationContextIndex } from "./replayArchiveContext";
import type { SnapshotCheckpoint } from "./replayArtifacts";
import type { EventEnvelopeEntry, SerializedEvent, WorldSnapshot } from "./schemas";

describe("replayArchiveContext", () => {
  it("fills missing ids from older eligible checkpoint snapshots", () => {
    const base = makeWorld();
    const older = makeWorld({
      event_cursor: 2,
      agents: [
        ...base.agents,
        { ...base.agents[0], id: "agent_003", name: "Archive Echo" },
      ],
    });
    const final = makeWorld({
      event_cursor: 4,
      agents: base.agents.filter((agent) => agent.id !== "agent_003"),
    });
    const index = createArchivePresentationContextIndex({
      checkpoints: [
        checkpointRecord(older),
        checkpointRecord(final),
      ],
    });

    expect(speakDetail(index.contextForCursor(4), "agent_003", "Still here.")).toBe(
      "Archive Echo: \"Still here.\"",
    );
    expect(index.provenanceForEvent(4, relatedIds({ agentIds: ["agent_003"] })))
      .toMatchObject({
        primary: {
          sourceKind: "checkpoint",
          checkpointIndex: 1,
          lineNumber: null,
          eventCursor: 4,
        },
        presentationSource: {
          sourceKind: "checkpoint",
          checkpointIndex: 0,
          lineNumber: null,
          eventCursor: 2,
        },
        fallbacks: [
          {
            sourceKind: "checkpoint",
            checkpointIndex: 0,
            eventCursor: 2,
          },
        ],
      });
  });

  it("prefers the later checkpoint when repeated event cursors conflict", () => {
    const first = makeNamedWorld("First Aster", 2);
    const later = makeNamedWorld("Later Aster", 2);
    const index = createArchivePresentationContextIndex({
      checkpoints: [
        checkpointRecord(first, 11),
        checkpointRecord(later, 12),
      ],
    });

    expect(speakDetail(index.contextForCursor(2), "agent_001", "Same line.")).toBe(
      "Later Aster: \"Same line.\"",
    );
    expect(index.provenanceForEvent(2, relatedIds({ agentIds: ["agent_001"] })))
      .toMatchObject({
        primary: {
          sourceKind: "checkpoint",
          checkpointIndex: 1,
          lineNumber: 12,
          eventCursor: 2,
        },
        presentationSource: {
          sourceKind: "checkpoint",
          checkpointIndex: 1,
          lineNumber: 12,
          eventCursor: 2,
        },
        fallbacks: [
          {
            sourceKind: "checkpoint",
            checkpointIndex: 0,
            lineNumber: 11,
            eventCursor: 2,
          },
        ],
      });
  });

  it("does not let a newer preview snapshot name an older archive row", () => {
    const older = makeNamedWorld("Older Aster", 2);
    const preview = makeNamedWorld("Future Aster", 6);
    const index = createArchivePresentationContextIndex({
      checkpoints: [checkpointRecord(older)],
      previewSnapshot: preview,
    });

    expect(speakDetail(index.contextForCursor(2), "agent_001", "Before.")).toBe(
      "Older Aster: \"Before.\"",
    );
    expect(index.provenanceForEvent(2, relatedIds({ agentIds: ["agent_001"] })))
      .toMatchObject({
        primary: {
          sourceKind: "checkpoint",
          eventCursor: 2,
        },
        presentationSource: {
          sourceKind: "checkpoint",
          eventCursor: 2,
        },
      });
  });

  it("does not let an older preview snapshot override a newer eligible checkpoint", () => {
    const preview = makeNamedWorld("Preview Aster", 2);
    const newer = makeNamedWorld("Newer Aster", 4);
    const index = createArchivePresentationContextIndex({
      checkpoints: [checkpointRecord(newer)],
      previewSnapshot: preview,
    });

    expect(speakDetail(index.contextForCursor(4), "agent_001", "After.")).toBe(
      "Newer Aster: \"After.\"",
    );
    expect(index.provenanceForEvent(4, relatedIds({ agentIds: ["agent_001"] })))
      .toMatchObject({
        primary: {
          sourceKind: "checkpoint",
          eventCursor: 4,
        },
        presentationSource: {
          sourceKind: "checkpoint",
          eventCursor: 4,
        },
      });
  });

  it("reports preview snapshot provenance only when it is eligible", () => {
    const preview = makeNamedWorld("Preview Aster", 6);
    const index = createArchivePresentationContextIndex({
      checkpoints: [],
      previewSnapshot: preview,
    });

    expect(index.provenanceForEvent(5, relatedIds({ agentIds: ["agent_001"] })))
      .toMatchObject({
        primary: null,
        presentationSource: null,
        fallbacks: [],
      });
    expect(index.provenanceForEvent(6, relatedIds({ agentIds: ["agent_001"] })))
      .toMatchObject({
        primary: {
          sourceKind: "preview_snapshot",
          checkpointIndex: null,
          lineNumber: null,
          eventCursor: 6,
        },
        presentationSource: {
          sourceKind: "preview_snapshot",
          eventCursor: 6,
        },
        fallbacks: [],
      });
  });

  it("keeps malformed snapshot arrays from throwing during context lookup", () => {
    const malformed = {
      ...makeWorld({ event_cursor: 2 }),
      agents: undefined as unknown as WorldSnapshot["agents"],
    };
    const index = createArchivePresentationContextIndex({
      checkpoints: [checkpointRecord(malformed)],
    });

    expect(speakDetail(index.contextForCursor(2), "agent_001", "Fallback.")).toBe(
      "being 001: \"Fallback.\"",
    );
  });

  it("caches contexts by archive row cursor", () => {
    const index = createArchivePresentationContextIndex({
      checkpoints: [checkpointRecord(makeNamedWorld("Cached Aster", 2))],
    });

    expect(index.contextForCursor(2)).toBe(index.contextForCursor(2));
    expect(index.contextForCursor(3)).not.toBe(index.contextForCursor(2));
  });
});

function relatedIds(
  overrides: Partial<{
    agentIds: string[];
    homeIds: string[];
    regionNames: string[];
  }> = {},
) {
  return {
    agentIds: overrides.agentIds ?? [],
    homeIds: overrides.homeIds ?? [],
    regionNames: overrides.regionNames ?? [],
  };
}

function makeNamedWorld(name: string, eventCursor: number): WorldSnapshot {
  return makeWorld({
    event_cursor: eventCursor,
    agents: makeWorld().agents.map((agent) =>
      agent.id === "agent_001" ? { ...agent, name } : agent,
    ),
  });
}

function speakDetail(
  context: EventPresentationContext,
  speakerId: string,
  message: string,
): string {
  return presentEvent(
    eventEntry({
      source: speakerId,
      payload: { speaker_id: speakerId, message },
    }),
    context,
  ).detail;
}

function checkpointRecord(
  snapshot: WorldSnapshot,
  lineNumber?: number,
): SnapshotCheckpoint {
  const checkpoint: SnapshotCheckpoint = {
    schema: 1,
    type: "world_snapshot_checkpoint",
    reason: "world_tick",
    run_id: snapshot.run_id,
    world_time: snapshot.world_time,
    event_cursor: snapshot.event_cursor,
    snapshot,
  };
  if (lineNumber !== undefined) {
    checkpoint.lineNumber = lineNumber;
  }
  return checkpoint;
}

function eventEntry(overrides: Partial<SerializedEvent>): EventEnvelopeEntry {
  return {
    cursor: 2,
    event: {
      type: "speak",
      source: "agent_001",
      payload: {},
      scope: "local",
      region: "meadow",
      target: null,
      timestamp: 13,
      ...overrides,
    },
    resolved: {},
    snapshot_after: null,
  };
}
