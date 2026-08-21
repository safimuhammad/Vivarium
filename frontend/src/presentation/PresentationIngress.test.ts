import { describe, expect, it, vi } from "vitest";

import type { EventEnvelopeEntry } from "../app/schemas";
import { makeEventEnvelope, makeWorld } from "../test/fixtures";
import { createPresentationIngress } from "./PresentationIngress";

function entries(firstCursor: number, lastCursor: number): EventEnvelopeEntry[] {
  return Array.from(
    { length: lastCursor - firstCursor + 1 },
    (_, index) => ({
      ...makeEventEnvelope().events[0],
      cursor: firstCursor + index,
    }),
  );
}

describe("PresentationIngress", () => {
  it("suppresses duplicate envelopes without republishing accepted evidence", () => {
    const ingress = createPresentationIngress();
    const listener = vi.fn();
    ingress.reset({ runId: "run-a", sourceKey: "live-a", cursor: 4 });
    ingress.subscribe(listener);
    const envelope = makeEventEnvelope({
      cursor: 4,
      next_cursor: 6,
      events: entries(5, 6),
    });

    ingress.onEnvelopeAccepted(envelope);
    ingress.onEnvelopeAccepted(envelope);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({
      runId: "run-a",
      sourceKey: "live-a",
      firstCursor: 5,
      lastCursor: 6,
      entries: envelope.events,
    });
    expect(ingress.getSnapshot()).toEqual({
      runId: "run-a",
      sourceKey: "live-a",
      ingestedCursor: 6,
      acceptedCount: 2,
      duplicateCount: 2,
      gaps: [],
    });
  });

  it("accepts only the monotonic suffix of an overlapping reconnect envelope", () => {
    const ingress = createPresentationIngress();
    const batches: EventEnvelopeEntry[][] = [];
    ingress.reset({ runId: "run-a", sourceKey: "live-a", cursor: 4 });
    ingress.subscribe((batch) => batches.push([...batch.entries]));

    ingress.onEnvelopeAccepted(
      makeEventEnvelope({ cursor: 4, next_cursor: 7, events: entries(5, 7) }),
    );
    ingress.onEnvelopeAccepted(
      makeEventEnvelope({ cursor: 5, next_cursor: 9, events: entries(6, 9) }),
    );

    expect(batches.map((batch) => batch.map((entry) => entry.cursor))).toEqual([
      [5, 6, 7],
      [8, 9],
    ]);
    expect(ingress.getSnapshot()).toMatchObject({
      ingestedCursor: 9,
      acceptedCount: 5,
      duplicateCount: 2,
      gaps: [],
    });
  });

  it("records every missing cursor before accepting later evidence", () => {
    const ingress = createPresentationIngress();
    ingress.reset({ runId: "run-a", sourceKey: "live-a", cursor: 4 });

    ingress.onEnvelopeAccepted(
      makeEventEnvelope({ cursor: 4, next_cursor: 9, events: entries(8, 9) }),
    );

    expect(ingress.getSnapshot()).toMatchObject({
      ingestedCursor: 9,
      acceptedCount: 2,
      gaps: [
        {
          kind: "cursor-gap",
          firstMissingCursor: 5,
          lastMissingCursor: 7,
        },
      ],
    });
  });

  it("bounds sustained distinct cursor-gap retention for a forever-running session", () => {
    const ingress = createPresentationIngress();
    ingress.reset({ runId: "run-a", sourceKey: "live-a", cursor: 0 });

    for (let index = 0; index < 160; index += 1) {
      const entryCursor = (index + 1) * 2;
      ingress.onEnvelopeAccepted(
        makeEventEnvelope({
          cursor: entryCursor - 2,
          next_cursor: entryCursor,
          events: entries(entryCursor, entryCursor),
        }),
      );
    }

    const { gaps } = ingress.getSnapshot();
    expect(gaps).toHaveLength(128);
    expect(gaps[0]).toEqual({
      kind: "cursor-gap",
      firstMissingCursor: 65,
      lastMissingCursor: 65,
    });
    expect(gaps.at(-1)).toEqual({
      kind: "cursor-gap",
      firstMissingCursor: 319,
      lastMissingCursor: 319,
    });
  });

  it("deduplicates exact faults and clears retained faults on reset", () => {
    const ingress = createPresentationIngress();
    ingress.reset({ runId: "run-a", sourceKey: "live-a", cursor: 4 });

    ingress.onSnapshotAccepted(makeWorld({ run_id: "run-b", event_cursor: 9 }));
    ingress.onSnapshotAccepted(makeWorld({ run_id: "run-b", event_cursor: 9 }));

    expect(ingress.getSnapshot().gaps).toEqual([
      {
        kind: "run-mismatch",
        firstMissingCursor: 9,
        lastMissingCursor: 9,
      },
    ]);

    ingress.reset({ runId: "run-c", sourceKey: "live-c", cursor: 1 });
    expect(ingress.getSnapshot().gaps).toEqual([]);
  });

  it("rejects out-of-order entries atomically before mutating ingress state", () => {
    const ingress = createPresentationIngress();
    const listener = vi.fn();
    ingress.reset({ runId: "run-a", sourceKey: "live-a", cursor: 4 });
    ingress.subscribe(listener);
    const before = ingress.getSnapshot();
    const malformed = makeEventEnvelope({
      cursor: 4,
      next_cursor: 6,
      events: [entries(6, 6)[0], entries(5, 5)[0]],
    });

    expect(() => ingress.onEnvelopeAccepted(malformed)).toThrow(
      "Event envelope cursors must be strictly increasing",
    );
    expect(ingress.getSnapshot()).toEqual(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it("isolates subscriber failures while notifying later subscribers", () => {
    const ingress = createPresentationIngress();
    const throwingListener = vi.fn(() => {
      throw new Error("observer failed");
    });
    const healthyListener = vi.fn();
    ingress.reset({ runId: "run-a", sourceKey: "live-a", cursor: 4 });
    ingress.subscribe(throwingListener);
    ingress.subscribe(healthyListener);
    const envelope = makeEventEnvelope({
      cursor: 4,
      next_cursor: 6,
      events: entries(5, 6),
    });

    expect(() => ingress.onEnvelopeAccepted(envelope)).not.toThrow();
    expect(throwingListener).toHaveBeenCalledOnce();
    expect(healthyListener).toHaveBeenCalledOnce();
    expect(ingress.getSnapshot()).toMatchObject({
      ingestedCursor: 6,
      acceptedCount: 2,
      duplicateCount: 0,
    });
  });

  it("delivers all 120 accepted entries in one lossless batch", () => {
    const ingress = createPresentationIngress();
    const listener = vi.fn();
    ingress.reset({ runId: "run-a", sourceKey: "fixture-c13", cursor: 0 });
    ingress.subscribe(listener);
    const allEntries = entries(1, 120);

    ingress.onEnvelopeAccepted(
      makeEventEnvelope({ cursor: 0, next_cursor: 120, events: allEntries }),
    );

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0].entries).toHaveLength(120);
    expect(listener.mock.calls[0][0]).toMatchObject({
      firstCursor: 1,
      lastCursor: 120,
    });
    expect(ingress.getSnapshot()).toMatchObject({
      ingestedCursor: 120,
      acceptedCount: 120,
      duplicateCount: 0,
    });
  });

  it("rejects stale old-run snapshots after an atomic lower-cursor reset", () => {
    const ingress = createPresentationIngress();
    ingress.reset({ runId: "run-a", sourceKey: "live-a", cursor: 80 });
    ingress.reset({ runId: "run-b", sourceKey: "live-b", cursor: 2 });

    ingress.onSnapshotAccepted(makeWorld({ run_id: "run-a", event_cursor: 90 }));
    ingress.onSnapshotAccepted(makeWorld({ run_id: "run-b", event_cursor: 3 }));

    expect(ingress.getSnapshot()).toEqual({
      runId: "run-b",
      sourceKey: "live-b",
      ingestedCursor: 3,
      acceptedCount: 0,
      duplicateCount: 0,
      gaps: [
        {
          kind: "run-mismatch",
          firstMissingCursor: 90,
          lastMissingCursor: 90,
        },
      ],
    });
  });

  // BUBBLES-FIX 2026-08-21 — measured on two real live runs. A checkpoint is exact truth about
  // world STATE at a cursor; it delivers none of the EVENTS below that cursor. Treating it as
  // delivery made the ingress discard stream evidence nobody downstream had seen, which broke
  // `StoryDirector.preflightMoments`' cursor contiguity — and because that throw lands in this
  // module's own observer-isolation catch, the presentation died in total silence while
  // `lifetimeAcceptedCount` kept climbing. Live run 2: 145 entries accepted, `pendingMoments` 0,
  // chronicle frozen at 6, nothing paused, nothing deferred, no fault, transport LIVE.
  it("keeps delivering stream evidence a checkpoint jumped over, so consumers stay contiguous", () => {
    const ingress = createPresentationIngress();
    const listener = vi.fn();
    ingress.reset({ runId: "run-a", sourceKey: "live-a", cursor: 3 });
    ingress.subscribe(listener);

    ingress.onCheckpointAccepted({
      line: 4,
      safety: "safe-world-tick",
      checkpoint: {
        schema: 1,
        type: "world_snapshot_checkpoint",
        reason: "world_tick",
        run_id: "run-a",
        world_time: 30,
        event_cursor: 9,
        snapshot: makeWorld({ run_id: "run-a", event_cursor: 9, world_time: 30 }),
      },
    });
    ingress.onEnvelopeAccepted(makeEventEnvelope({
      cursor: 3,
      next_cursor: 10,
      events: entries(4, 10),
    }));

    expect(listener).toHaveBeenCalledOnce();
    expect(listener.mock.calls[0][0]).toMatchObject({ firstCursor: 4, lastCursor: 10 });
    expect(listener.mock.calls[0][0].entries).toHaveLength(7);
    expect(ingress.getSnapshot()).toMatchObject({
      ingestedCursor: 10,
      duplicateCount: 0,
      gaps: [],
    });
  });

  // Re-baselined 2026-08-21: this used to assert `ingestedCursor: 12`, i.e. that a checkpoint
  // advances the delivery watermark. THAT IS THE DEFECT ABOVE — a checkpoint carries no events,
  // so advancing past undelivered stream cursors silently starves every consumer. What the test
  // was really protecting is kept verbatim: a checkpoint publishes NO event batch, and its
  // identity is still checked (see the run-mismatch test above). Only the watermark clause moved.
  it("accepts same-run checkpoint evidence without publishing event batches or moving the watermark", () => {
    const ingress = createPresentationIngress();
    const listener = vi.fn();
    const world = makeWorld({ run_id: "run-a", event_cursor: 12, world_time: 30 });
    ingress.reset({ runId: "run-a", sourceKey: "archive-a", cursor: 9 });
    ingress.subscribe(listener);

    ingress.onCheckpointAccepted({
      line: 7,
      safety: "archive-manual",
      checkpoint: {
        schema: 1,
        type: "world_snapshot_checkpoint",
        reason: "manual",
        run_id: "run-a",
        world_time: 30,
        event_cursor: 12,
        snapshot: world,
      },
    });

    expect(ingress.getSnapshot()).toMatchObject({
      runId: "run-a",
      sourceKey: "archive-a",
      ingestedCursor: 9,
      acceptedCount: 0,
      gaps: [],
    });
    expect(listener).not.toHaveBeenCalled();
  });

  it("disposes subscriptions idempotently and ignores later evidence", () => {
    const ingress = createPresentationIngress();
    const listener = vi.fn();
    ingress.reset({ runId: "run-a", sourceKey: "live-a", cursor: 4 });
    ingress.subscribe(listener);

    ingress.dispose();
    ingress.dispose();
    ingress.onEnvelopeAccepted(makeEventEnvelope());

    expect(listener).not.toHaveBeenCalled();
    expect(ingress.getSnapshot()).toMatchObject({ ingestedCursor: 4, acceptedCount: 0 });
  });
});
