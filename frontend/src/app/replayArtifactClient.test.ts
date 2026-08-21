import { describe, expect, it, vi } from "vitest";

import { makeWorld } from "../test/fixtures";
import { HttpResponseError } from "./client";
import {
  REPLAY_CHECKPOINT_WORKING_SET_LIMIT,
  REPLAY_CHECKPOINT_PAGE_LIMIT,
  REPLAY_EVENT_BOOTSTRAP_LIMIT,
  REPLAY_EVENT_WORKING_SET_LIMIT,
  createReplayArtifactClient,
  fetchReplayArtifactEvents,
  fetchReplayArtifactSnapshots,
  fetchReplayArtifacts,
} from "./replayArtifactClient";
import { buildCheckpointIndex, type SnapshotCheckpoint } from "./replayArtifacts";
import type { SerializedEvent, WorldSnapshot } from "./schemas";

describe("replayArtifactClient", () => {
  it("bootstraps from bounded JSON endpoints without reading raw export artifacts", async () => {
    const latest = checkpointRecord(
      makeWorld({ event_cursor: 1_180, world_time: 42 }),
      "world_tick",
    );
    const requestedUrls: string[] = [];
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const requested = String(url);
      requestedUrls.push(requested);
      if (requested === "http://live.test/api/replay/manifest") {
        return Response.json({
          schema: 1,
          run_id: "seed-7-test",
          events: { count: 1_200, first_cursor: 1, last_cursor: 1_200 },
          checkpoints: {
            count: 200,
            first_line: 1,
            last_line: 200,
            first_event_cursor: 1,
            last_event_cursor: 1_180,
          },
          bootstrap: { event_after: 688, event_limit: REPLAY_EVENT_BOOTSTRAP_LIMIT },
        });
      }
      if (requested === "http://live.test/api/replay/checkpoints/latest") {
        return Response.json({
          schema: 1,
          run_id: "seed-7-test",
          line: 200,
          checkpoint: latest,
        });
      }
      if (
        requested ===
        `http://live.test/api/replay/events?after=688&limit=${REPLAY_EVENT_BOOTSTRAP_LIMIT}`
      ) {
        return Response.json({
          schema: 1,
          run_id: "seed-7-test",
          after: 688,
          next_after: 1_200,
          has_more: false,
          events: [eventPageEntry(689), eventPageEntry(1_200)],
        });
      }
      return new Response("unexpected endpoint", { status: 404 });
    }) as typeof fetch;

    const artifacts = await fetchReplayArtifacts({
      baseUrl: "http://live.test",
      fetcher,
    });

    expect(artifacts.events.map((entry) => entry.cursor)).toEqual([689, 1_200]);
    expect(artifacts.checkpoints).toEqual([
      expect.objectContaining({ lineNumber: 200, event_cursor: 1_180 }),
    ]);
    expect(artifacts.checkpointIndex).toEqual([
      expect.objectContaining({ lineNumber: 200, eventCursor: 1_180 }),
    ]);
    expect(artifacts.hasOlderCheckpoints).toBe(true);
    expect(requestedUrls).toEqual([
      "http://live.test/api/replay/manifest",
      "http://live.test/api/replay/checkpoints/latest",
      `http://live.test/api/replay/events?after=688&limit=${REPLAY_EVENT_BOOTSTRAP_LIMIT}`,
    ]);
    expect(requestedUrls).not.toContain("http://live.test/api/replay/artifacts/events");
    expect(requestedUrls).not.toContain("http://live.test/api/replay/artifacts/snapshots");
  });

  it("retries a torn bootstrap when a backend restart mixes response run IDs", async () => {
    let bootstrapAttempt = 0;
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const requested = String(url);
      if (requested === "/api/replay/manifest") {
        bootstrapAttempt += 1;
        return Response.json(manifestPayload("live-run"));
      }
      if (requested === "/api/replay/checkpoints/latest") {
        return Response.json(latestCheckpointPayload(
          bootstrapAttempt === 1 ? "restarted-run" : "live-run",
        ));
      }
      if (requested === `/api/replay/events?after=0&limit=${REPLAY_EVENT_BOOTSTRAP_LIMIT}`) {
        return Response.json(eventPagePayload("live-run"));
      }
      return new Response("unexpected endpoint", { status: 404 });
    }) as typeof fetch;

    const artifacts = await createReplayArtifactClient({ fetcher }).fetchForRun("live-run");

    expect(artifacts.runId).toBe("live-run");
    expect(bootstrapAttempt).toBe(2);
  });

  it("bounds torn-bootstrap retries when response run IDs remain incoherent", async () => {
    let bootstrapAttempt = 0;
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const requested = String(url);
      if (requested === "/api/replay/manifest") {
        bootstrapAttempt += 1;
        return Response.json(manifestPayload("live-run"));
      }
      if (requested === "/api/replay/checkpoints/latest") {
        return Response.json(latestCheckpointPayload("restarted-run"));
      }
      if (requested === `/api/replay/events?after=0&limit=${REPLAY_EVENT_BOOTSTRAP_LIMIT}`) {
        return Response.json(eventPagePayload("live-run"));
      }
      return new Response("unexpected endpoint", { status: 404 });
    }) as typeof fetch;

    await expect(
      createReplayArtifactClient({ fetcher }).fetchForRun("live-run"),
    ).rejects.toThrow(
      "/api/replay/checkpoints/latest.run_id does not match replay manifest",
    );
    expect(bootstrapAttempt).toBe(3);
  });

  it("retries a non-empty manifest when a restarted backend has no latest checkpoint", async () => {
    let bootstrapAttempt = 0;
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const requested = String(url);
      if (requested === "/api/replay/manifest") {
        bootstrapAttempt += 1;
        return Response.json(
          bootstrapAttempt === 1
            ? manifestPayload("old-run")
            : manifestPayload("live-run", 0),
        );
      }
      if (requested === "/api/replay/checkpoints/latest") {
        return new Response("missing", { status: 404 });
      }
      if (requested === `/api/replay/events?after=0&limit=${REPLAY_EVENT_BOOTSTRAP_LIMIT}`) {
        return Response.json(eventPagePayload(
          bootstrapAttempt === 1 ? "old-run" : "live-run",
        ));
      }
      return new Response("unexpected endpoint", { status: 404 });
    }) as typeof fetch;

    const artifacts = await createReplayArtifactClient({ fetcher }).fetchForRun("live-run");

    expect(artifacts.runId).toBe("live-run");
    expect(artifacts.checkpoints).toEqual([]);
    expect(bootstrapAttempt).toBe(2);
  });

  it("bounds retries when a non-empty manifest persistently has no latest checkpoint", async () => {
    let bootstrapAttempt = 0;
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const requested = String(url);
      if (requested === "/api/replay/manifest") {
        bootstrapAttempt += 1;
        return Response.json(manifestPayload("old-run"));
      }
      if (requested === "/api/replay/checkpoints/latest") {
        return new Response("missing", { status: 404 });
      }
      if (requested === `/api/replay/events?after=0&limit=${REPLAY_EVENT_BOOTSTRAP_LIMIT}`) {
        return Response.json(eventPagePayload("old-run"));
      }
      return new Response("unexpected endpoint", { status: 404 });
    }) as typeof fetch;

    await expect(
      createReplayArtifactClient({ fetcher }).fetchForRun("live-run"),
    ).rejects.toThrow("replay manifest has checkpoints but latest checkpoint is missing");
    expect(bootstrapAttempt).toBe(3);
  });

  it("does not retry ordinary replay bootstrap failures", async () => {
    const fetcher = vi.fn(
      async () => new Response("unavailable", { status: 503 }),
    ) as typeof fetch;

    await expect(
      createReplayArtifactClient({ fetcher }).fetchForRun("live-run"),
    ).rejects.toThrow("/api/replay/manifest returned HTTP 503: unavailable");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("merges older checkpoint pages by line identity while retaining bounded working sets", async () => {
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const requested = String(url);
      if (
        requested ===
        `/api/replay/checkpoints?before=130&limit=${REPLAY_CHECKPOINT_PAGE_LIMIT}`
      ) {
        return Response.json({
          schema: 1,
          run_id: "seed-7-test",
          before: 130,
          next_before: 65,
          has_more: true,
          checkpoints: Array.from({ length: 64 }, (_, index) => {
            const line = 65 + index;
            return {
              line,
              checkpoint: checkpointRecord(
                makeWorld({ event_cursor: line, world_time: line }),
                "world_tick",
              ),
            };
          }),
        });
      }
      if (
        requested ===
        `/api/replay/events?after=64&limit=${REPLAY_EVENT_BOOTSTRAP_LIMIT}`
      ) {
        return Response.json({
          schema: 1,
          run_id: "seed-7-test",
          after: 64,
          next_after: 640,
          has_more: false,
          events: Array.from({ length: 512 }, (_, index) => eventPageEntry(65 + index)),
        });
      }
      return new Response("unexpected endpoint", { status: 404 });
    }) as typeof fetch;
    const client = createReplayArtifactClient({ fetcher });
    const latest = {
      ...checkpointRecord(makeWorld({ event_cursor: 130, world_time: 130 })),
      lineNumber: 130,
    };

    const artifacts = await client.fetchOlderArtifacts({
      events: [eventPageEntry(130)],
      checkpoints: [latest],
      checkpointIndex: [],
      hasOlderCheckpoints: true,
    });

    expect(artifacts.checkpoints).toHaveLength(REPLAY_CHECKPOINT_WORKING_SET_LIMIT);
    expect(artifacts.checkpoints[0]?.lineNumber).toBe(65);
    expect(artifacts.checkpoints.at(-1)?.lineNumber).toBe(128);
    expect(new Set(artifacts.checkpoints.map((checkpoint) => checkpoint.lineNumber)).size)
      .toBe(REPLAY_CHECKPOINT_WORKING_SET_LIMIT);
    expect(artifacts.events).toHaveLength(REPLAY_EVENT_WORKING_SET_LIMIT);
    expect(artifacts.events[0]?.cursor).toBe(65);
    expect(artifacts.events.at(-1)?.cursor).toBe(576);
    expect(artifacts.hasOlderCheckpoints).toBe(true);
  });

  it("fetches artifact endpoints as NDJSON and preserves duplicate checkpoint cursors", async () => {
    const eventLines = [
      JSON.stringify(eventRecord({ type: "speak" })),
      JSON.stringify(eventRecord({ type: "home_built" })),
    ].join("\n");
    const snapshotLines = [
      JSON.stringify(
        checkpointRecord(makeWorld({ event_cursor: 2, world_time: 14 }), "manual"),
      ),
      JSON.stringify(
        checkpointRecord(makeWorld({ event_cursor: 2, world_time: 15 }), "world_tick"),
      ),
    ].join("\n");
    const responses = new Map<string, string>([
      ["http://live.test/api/replay/artifacts/events", eventLines],
      ["http://live.test/api/replay/artifacts/snapshots", snapshotLines],
    ]);
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const body = responses.get(String(url));
      return new Response(body ?? "missing", { status: body === undefined ? 404 : 200 });
    }) as typeof fetch;

    const events = await fetchReplayArtifactEvents({ baseUrl: "http://live.test", fetcher });
    const checkpoints = await fetchReplayArtifactSnapshots({
      baseUrl: "http://live.test",
      fetcher,
    });

    expect(events.map((entry) => entry.cursor)).toEqual([1, 2]);
    expect(events.map((entry) => entry.event.type)).toEqual([
      "speak",
      "home_built",
    ]);
    expect(checkpoints.map((checkpoint) => checkpoint.event_cursor)).toEqual([
      2,
      2,
    ]);
    expect(buildCheckpointIndex(checkpoints)).toEqual([
      {
        lineNumber: 1,
        eventCursor: 2,
        worldTime: 14,
        reason: "manual",
        runId: "seed-7-test",
      },
      {
        lineNumber: 2,
        eventCursor: 2,
        worldTime: 15,
        reason: "world_tick",
        runId: "seed-7-test",
      },
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      "http://live.test/api/replay/artifacts/events",
      expect.objectContaining({
        headers: { Accept: "application/x-ndjson" },
      }),
    );
    expect(fetcher).toHaveBeenCalledWith(
      "http://live.test/api/replay/artifacts/snapshots",
      expect.objectContaining({
        headers: { Accept: "application/x-ndjson" },
      }),
    );
  });

  it("skips blank NDJSON lines while preserving raw one-based line numbers", async () => {
    const eventLines = [
      "",
      JSON.stringify(eventRecord({ type: "first_after_blank" })),
      "  ",
      JSON.stringify(eventRecord({ type: "second_after_blank" })),
      "",
    ].join("\n");
    const snapshotLines = [
      JSON.stringify(
        checkpointRecord(makeWorld({ event_cursor: 1, world_time: 14 }), "manual"),
      ),
      "",
      JSON.stringify(
        checkpointRecord(makeWorld({ event_cursor: 3, world_time: 16 }), "world_tick"),
      ),
    ].join("\n");
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url) === "/api/replay/artifacts/events") {
        return new Response(eventLines, { status: 200 });
      }
      return new Response(snapshotLines, { status: 200 });
    }) as typeof fetch;

    const events = await fetchReplayArtifactEvents({ fetcher });
    const checkpoints = await fetchReplayArtifactSnapshots({ fetcher });

    expect(events.map((entry) => entry.cursor)).toEqual([2, 4]);
    expect(events.map((entry) => entry.event.type)).toEqual([
      "first_after_blank",
      "second_after_blank",
    ]);
    expect(checkpoints.map((checkpoint) => checkpoint.lineNumber)).toEqual([1, 3]);
  });

  it("reports HTTP failures with endpoint context", async () => {
    const fetcher = vi.fn(async () => {
      return new Response("backend unavailable", { status: 503 });
    }) as typeof fetch;

    const error = await fetchReplayArtifactEvents({ fetcher }).catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(HttpResponseError);
    expect(error).toMatchObject({
      path: "/api/replay/artifacts/events",
      status: 503,
      message: "/api/replay/artifacts/events returned HTTP 503: backend unavailable",
    });
  });

  it("reports malformed lines with endpoint and line context", async () => {
    const fetcher = vi.fn(async () => {
      return new Response(`${JSON.stringify(eventRecord())}\n{`, { status: 200 });
    }) as typeof fetch;

    await expect(fetchReplayArtifactEvents({ fetcher })).rejects.toThrow(
      /\/api\/replay\/artifacts\/events line 2: replay event JSONL line is malformed JSON/,
    );
  });

  it("reports malformed snapshot lines with endpoint and line context", async () => {
    const snapshotLines = [
      JSON.stringify(
        checkpointRecord(makeWorld({ event_cursor: 2, world_time: 14 }), "manual"),
      ),
      "{",
    ].join("\n");
    const fetcher = vi.fn(async () => {
      return new Response(snapshotLines, { status: 200 });
    }) as typeof fetch;

    await expect(fetchReplayArtifactSnapshots({ fetcher })).rejects.toThrow(
      /\/api\/replay\/artifacts\/snapshots line 2: snapshot checkpoint JSONL line is malformed JSON/,
    );
  });

  it("accepts a short event page the server marked truncated", async () => {
    // The server clamps an over-budget page to the oldest records that fit rather
    // than answering 413, which the client marks non-retryable. A short page is a
    // page, not a fault: it stays contiguous from the requested cursor and
    // `next_after` walks forward over the rest.
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const requested = String(url);
      if (requested.endsWith("/api/replay/manifest")) {
        return Response.json({
          ...manifestPayload("seed-7-test"),
          events: { count: 40, first_cursor: 1, last_cursor: 40 },
          bootstrap: { event_after: 0, event_limit: REPLAY_EVENT_BOOTSTRAP_LIMIT },
        });
      }
      if (requested.includes("/api/replay/checkpoints/latest")) {
        return Response.json(latestCheckpointPayload("seed-7-test"));
      }
      return Response.json({
        schema: 1,
        run_id: "seed-7-test",
        after: 0,
        next_after: 2,
        has_more: true,
        truncated: true,
        events: [eventPageEntry(1), eventPageEntry(2)],
      });
    }) as typeof fetch;

    const artifacts = await fetchReplayArtifacts({ baseUrl: "http://live.test", fetcher });

    expect(artifacts.events.map((entry) => entry.cursor)).toEqual([1, 2]);
    expect(artifacts.eventTotalCount).toBe(40);
  });

  it("refuses an event page that does not begin at the cursor it asked after", async () => {
    // Truncation must cost latency, never coverage. A page starting past `after + 1`
    // is a hole, and a hole in a replay is silent world drift.
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const requested = String(url);
      if (requested.endsWith("/api/replay/manifest")) {
        return Response.json(manifestPayload("seed-7-test"));
      }
      if (requested.includes("/api/replay/checkpoints/latest")) {
        return Response.json(latestCheckpointPayload("seed-7-test"));
      }
      return Response.json({
        schema: 1,
        run_id: "seed-7-test",
        after: 0,
        next_after: 9,
        has_more: false,
        truncated: true,
        events: [eventPageEntry(7), eventPageEntry(9)],
      });
    }) as typeof fetch;

    await expect(fetchReplayArtifacts({ baseUrl: "http://live.test", fetcher }))
      .rejects.toThrow(/must begin at cursor 1/);
  });
});

function checkpointRecord(
  snapshot: WorldSnapshot,
  reason = "world_tick",
): Omit<SnapshotCheckpoint, "lineNumber"> {
  return {
    schema: 1,
    type: "world_snapshot_checkpoint",
    reason,
    run_id: snapshot.run_id,
    world_time: snapshot.world_time,
    event_cursor: snapshot.event_cursor,
    snapshot,
  };
}

function eventRecord(overrides: Partial<SerializedEvent> = {}): SerializedEvent {
  return {
    type: "speak",
    source: "world",
    payload: {},
    scope: "local",
    region: null,
    target: null,
    timestamp: 13,
    ...overrides,
  };
}

function eventPageEntry(cursor: number) {
  return {
    cursor,
    event: eventRecord({ timestamp: cursor }),
    resolved: {},
    snapshot_after: null,
  };
}

function manifestPayload(runId: string, checkpointCount = 1) {
  return {
    schema: 1,
    run_id: runId,
    events: { count: 1, first_cursor: 1, last_cursor: 1 },
    checkpoints: {
      count: checkpointCount,
      first_line: checkpointCount === 0 ? null : 1,
      last_line: checkpointCount === 0 ? null : 1,
      first_event_cursor: checkpointCount === 0 ? null : 1,
      last_event_cursor: checkpointCount === 0 ? null : 1,
    },
    bootstrap: { event_after: 0, event_limit: REPLAY_EVENT_BOOTSTRAP_LIMIT },
  };
}

function latestCheckpointPayload(runId: string) {
  return {
    schema: 1,
    run_id: runId,
    line: 1,
    checkpoint: checkpointRecord(makeWorld({
      run_id: runId,
      event_cursor: 1,
      world_time: 1,
    })),
  };
}

function eventPagePayload(runId: string) {
  return {
    schema: 1,
    run_id: runId,
    after: 0,
    next_after: 1,
    has_more: false,
    events: [eventPageEntry(1)],
  };
}
