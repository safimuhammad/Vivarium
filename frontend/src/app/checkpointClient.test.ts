import { describe, expect, it, vi } from "vitest";

import { HttpResponseError } from "./client";
import {
  createHttpCheckpointApiClient,
  type CheckpointRecord,
} from "./checkpointClient";
import type { SnapshotCheckpoint } from "./replayArtifacts";
import { makeWorld } from "../test/fixtures";

describe("checkpointClient", () => {
  it("parses the manifest, latest record, and same-cursor checkpoint page by line", async () => {
    const requested: string[] = [];
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const path = String(url);
      requested.push(path);
      if (path === "/api/replay/manifest") {
        return Response.json({
          schema: 1,
          run_id: "run-a",
          events: { count: 20, first_cursor: 1, last_cursor: 20 },
          checkpoints: {
            count: 9,
            first_line: 1,
            last_line: 9,
            first_event_cursor: 1,
            last_event_cursor: 20,
          },
          bootstrap: { event_after: 0, event_limit: 512 },
        });
      }
      if (path === "/api/replay/checkpoints/latest") {
        return Response.json(recordPayload(9, checkpoint("world_tick", 20)));
      }
      if (path === "/api/replay/checkpoints?before=9&limit=2") {
        return Response.json(pagePayload(9, [
          record(7, checkpoint("event:speak", 20)),
          record(8, checkpoint("manual", 20)),
        ]));
      }
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;
    const client = createHttpCheckpointApiClient({ fetcher, expectedRunId: "run-a" });

    await expect(client.getReplayManifest()).resolves.toEqual({
      runId: "run-a",
      checkpointCount: 9,
      lastCheckpointLine: 9,
    });
    await expect(client.getLatestCheckpoint()).resolves.toEqual(
      expect.objectContaining({
        line: 9,
        checkpoint: expect.objectContaining({ lineNumber: 9, event_cursor: 20 }),
      }),
    );
    await expect(client.getCheckpointPage(9, 2)).resolves.toEqual({
      runId: "run-a",
      before: 9,
      nextBefore: 7,
      hasMore: true,
      truncated: false,
      records: [
        expect.objectContaining({ line: 7 }),
        expect.objectContaining({ line: 8 }),
      ],
    });
    expect(requested).toEqual([
      "/api/replay/manifest",
      "/api/replay/checkpoints/latest",
      "/api/replay/checkpoints?before=9&limit=2",
    ]);
  });

  it("rejects out-of-order checkpoint pages", async () => {
    const fetcher = vi.fn(async () => Response.json(pagePayload(9, [
      record(8, checkpoint("manual", 20)),
      record(7, checkpoint("event:speak", 20)),
    ]))) as typeof fetch;
    const client = createHttpCheckpointApiClient({ fetcher, expectedRunId: "run-a" });

    await expect(client.getCheckpointPage(9, 64)).rejects.toThrow(
      "/api/replay/checkpoints?before=9&limit=64.records[1].line must be strictly increasing",
    );
  });

  it.each([
    {
      name: "a missing interior line",
      before: 5,
      limit: 4,
      payload: pagePayload(5, [
        record(1, checkpoint("world_tick", 1)),
        record(2, checkpoint("world_tick", 2)),
        record(4, checkpoint("world_tick", 4)),
      ]),
    },
    {
      name: "a next_before that skips the page start",
      before: 5,
      limit: 4,
      payload: pagePayload(5, [
        record(1, checkpoint("world_tick", 1)),
        record(2, checkpoint("world_tick", 2)),
        record(3, checkpoint("world_tick", 3)),
        record(4, checkpoint("world_tick", 4)),
      ], { nextBefore: 2 }),
    },
    {
      name: "false has_more while older lines exist",
      before: 70,
      limit: 4,
      payload: pagePayload(70, [
        record(66, checkpoint("world_tick", 66)),
        record(67, checkpoint("world_tick", 67)),
        record(68, checkpoint("world_tick", 68)),
        record(69, checkpoint("world_tick", 69)),
      ], { hasMore: false }),
    },
  ])("rejects an incoherent checkpoint page with $name", async ({ before, limit, payload }) => {
    const fetcher = vi.fn(async () => Response.json(payload)) as typeof fetch;
    const client = createHttpCheckpointApiClient({ fetcher, expectedRunId: "run-a" });

    await expect(client.getCheckpointPage(before, limit)).rejects.toThrow();
  });

  // The server clamps a page to its own byte budget by dropping records from the
  // OLDEST end and saying `truncated: true` — the page stays contiguous and still
  // ends at `before - 1`. Demanding an EXACT page length turned that designed,
  // recoverable short page into a hard parse error, on top of the 413 it replaced:
  // 64 real checkpoints are ~343 KB against a 327,680-byte cap, so reconciliation
  // used to stop permanently at roughly four minutes of world age.
  it("accepts a byte-clamped short page and reports it as truncated", async () => {
    const fetcher = vi.fn(async () => Response.json(pagePayload(70, [
      record(66, checkpoint("world_tick", 66)),
      record(67, checkpoint("world_tick", 67)),
      record(68, checkpoint("world_tick", 68)),
      record(69, checkpoint("world_tick", 69)),
    ], { truncated: true }))) as typeof fetch;
    const client = createHttpCheckpointApiClient({ fetcher, expectedRunId: "run-a" });

    await expect(client.getCheckpointPage(70, 64)).resolves.toEqual({
      runId: "run-a",
      before: 70,
      nextBefore: 66,
      hasMore: true,
      truncated: true,
      records: [
        expect.objectContaining({ line: 66 }),
        expect.objectContaining({ line: 67 }),
        expect.objectContaining({ line: 68 }),
        expect.objectContaining({ line: 69 }),
      ],
    });
  });

  it("still rejects a short page that does not admit to being truncated", async () => {
    const fetcher = vi.fn(async () => Response.json(pagePayload(70, [
      record(66, checkpoint("world_tick", 66)),
      record(67, checkpoint("world_tick", 67)),
    ]))) as typeof fetch;
    const client = createHttpCheckpointApiClient({ fetcher, expectedRunId: "run-a" });

    await expect(client.getCheckpointPage(70, 64)).rejects.toThrow(/truncated/u);
  });

  it("still rejects a truncated page that does not end at the requested boundary", async () => {
    const fetcher = vi.fn(async () => Response.json(pagePayload(70, [
      record(66, checkpoint("world_tick", 66)),
      record(67, checkpoint("world_tick", 67)),
    ], { truncated: true }))) as typeof fetch;
    const client = createHttpCheckpointApiClient({ fetcher, expectedRunId: "run-a" });

    await expect(client.getCheckpointPage(70, 64)).rejects.toThrow(/through 69/u);
  });

  it("treats 404 latest and page responses as no checkpoint for the request", async () => {
    const fetcher = vi.fn(async () => new Response("missing", { status: 404 })) as typeof fetch;
    const client = createHttpCheckpointApiClient({ fetcher, expectedRunId: "run-a" });

    await expect(client.getLatestCheckpoint()).resolves.toBeNull();
    await expect(client.getCheckpointPage(42, 64)).resolves.toEqual({
      runId: "run-a",
      before: 42,
      nextBefore: null,
      hasMore: false,
      truncated: false,
      records: [],
    });
  });

  it("exposes status and path on a typed 413 without requesting a raw artifact", async () => {
    const requested: string[] = [];
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      requested.push(String(url));
      return new Response("checkpoint exceeds 320 KiB", { status: 413 });
    }) as typeof fetch;
    const client = createHttpCheckpointApiClient({ fetcher, expectedRunId: "run-a" });

    const error = await client.getCheckpointPage(9, 64).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(HttpResponseError);
    expect(error).toMatchObject({
      path: "/api/replay/checkpoints?before=9&limit=64",
      status: 413,
    });
    expect(requested).toEqual(["/api/replay/checkpoints?before=9&limit=64"]);
    expect(requested.every((path) => !path.includes("/artifacts/"))).toBe(true);
  });

  it("passes the injected abort signal to every HTTP request", async () => {
    const controller = new AbortController();
    const fetcher = vi.fn(async () => Response.json(recordPayload(
      9,
      checkpoint("world_tick", 20),
    ))) as typeof fetch;
    const client = createHttpCheckpointApiClient({
      fetcher,
      expectedRunId: "run-a",
      signal: controller.signal,
    });

    await client.getLatestCheckpoint();

    expect(fetcher).toHaveBeenCalledWith(
      "/api/replay/checkpoints/latest",
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});

function checkpoint(reason: string, cursor: number, runId = "run-a"): SnapshotCheckpoint {
  const snapshot = makeWorld({ run_id: runId, event_cursor: cursor, world_time: cursor });
  return {
    schema: 1,
    type: "world_snapshot_checkpoint",
    reason,
    run_id: runId,
    world_time: cursor,
    event_cursor: cursor,
    snapshot,
  };
}

function record(line: number, value: SnapshotCheckpoint): CheckpointRecord {
  return { line, checkpoint: value };
}

function recordPayload(line: number, value: SnapshotCheckpoint): unknown {
  return { schema: 1, run_id: value.run_id, line, checkpoint: value };
}

function pagePayload(
  before: number,
  records: readonly CheckpointRecord[],
  options: {
    hasMore?: boolean;
    nextBefore?: number | null;
    truncated?: boolean;
  } = {},
): unknown {
  return {
    schema: 1,
    run_id: records[0]?.checkpoint.run_id ?? "run-a",
    before,
    next_before: options.nextBefore ?? records[0]?.line ?? null,
    has_more: options.hasMore ?? Boolean(records[0] && records[0].line > 1),
    truncated: options.truncated ?? false,
    checkpoints: records.map(({ line, checkpoint: value }) => ({ line, checkpoint: value })),
  };
}
