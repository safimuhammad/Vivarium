import { describe, expect, it, vi } from "vitest";

import { EVENT_VISUAL_EVENT_TYPES } from "../events/eventVisualCatalog";
import { createEventDemoClient, EVENT_DEMO_SOURCE_QUERY_VALUE } from "./eventDemoSource";

describe("eventDemoSource", () => {
  it("serves a schema-compatible demo run, world, and complete event tour", async () => {
    const client = createEventDemoClient({ intervalMs: 25 });

    const run = await client.getRun();
    const world = await client.getWorld();
    const envelope = await client.getEvents(0);

    expect(EVENT_DEMO_SOURCE_QUERY_VALUE).toBe("event-demo");
    expect(run.schema).toBe(1);
    expect(run.provider).toBe("demo");
    expect(world.schema).toBe(1);
    expect(world.agents.length).toBeGreaterThanOrEqual(4);
    expect(world.regions.map((region) => region.name).sort()).toEqual([
      "nirvana",
      "nirvana_east",
      "nirvana_west",
      "warm_springs",
    ]);
    expect(new Set(envelope.events.map((entry) => entry.event.type))).toEqual(
      new Set(EVENT_VISUAL_EVENT_TYPES),
    );
    expect(envelope.next_cursor).toBe(EVENT_VISUAL_EVENT_TYPES.length);
  });

  it("streams demo event envelopes from the requested cursor until closed", async () => {
    vi.useFakeTimers();
    try {
      const client = createEventDemoClient({ intervalMs: 50 });
      const envelopes: string[] = [];
      const stream = client.openEventStream(10, {
        onEnvelope(envelope) {
          envelopes.push(envelope.events[0]?.event.type ?? "empty");
        },
      });

      await vi.advanceTimersByTimeAsync(160);
      stream.close();
      await vi.advanceTimersByTimeAsync(160);

      expect(stream.url).toBe("event-demo://events/stream?cursor=10");
      expect(envelopes).toEqual([
        EVENT_VISUAL_EVENT_TYPES[10],
        EVENT_VISUAL_EVENT_TYPES[11],
        EVENT_VISUAL_EVENT_TYPES[12],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it("waits for the current envelope handler before scheduling the next demo event", async () => {
    vi.useFakeTimers();
    try {
      const client = createEventDemoClient({ intervalMs: 50 });
      const envelopes: number[] = [];
      let releaseFirstEnvelope: (() => void) | undefined;
      const firstEnvelopeHandled = new Promise<void>((resolve) => {
        releaseFirstEnvelope = resolve;
      });
      const stream = client.openEventStream(0, {
        onEnvelope(envelope) {
          envelopes.push(envelope.next_cursor);
          return envelopes.length === 1 ? firstEnvelopeHandled : undefined;
        },
      });

      await vi.advanceTimersByTimeAsync(200);
      expect(envelopes).toEqual([1]);

      releaseFirstEnvelope?.();
      await vi.advanceTimersByTimeAsync(49);
      expect(envelopes).toEqual([1]);

      await vi.advanceTimersByTimeAsync(1);
      expect(envelopes).toEqual([1, 2]);
      stream.close();
    } finally {
      vi.useRealTimers();
    }
  });
});
