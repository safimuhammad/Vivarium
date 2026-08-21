import { describe, expect, it, vi } from "vitest";

import type {
  CheckpointApiClient,
  CheckpointRecord,
  CheckpointRecordPage,
  ReplayManifestSummary,
} from "../app/checkpointClient";
import { HttpResponseError } from "../app/client";
import type { SnapshotCheckpoint } from "../app/replayArtifacts";
import { makeWorld } from "../test/fixtures";
import {
  CHECKPOINT_FEED_RETAINED_SAFE_LIMIT,
  createCheckpointFeed,
  type CheckpointFeedScheduler,
} from "./CheckpointFeed";

describe("CheckpointFeed", () => {
  it("delivers same-cursor event, manual, and world-tick cuts strictly by line", async () => {
    const client = scriptedClient({
      latest: [record(9, "world_tick", 20)],
      pages: new Map([[10, page(10, [
        ...range(1, 6),
        record(7, "event:speak", 20),
        record(8, "manual", 20),
        record(9, "world_tick", 20),
      ])]]),
    });
    const scheduler = new FakeScheduler();
    const feed = createCheckpointFeed({ createClient: () => client, scheduler });
    const delivered: unknown[] = [];
    feed.subscribe((value) => delivered.push(value));

    feed.start({ runId: "run-a", sourceKey: "archive-a" });
    await scheduler.runNext();

    expect(delivered.slice(-3)).toEqual([
      expect.objectContaining({ line: 7, safety: "archive-event" }),
      expect.objectContaining({ line: 8, safety: "archive-manual" }),
      expect.objectContaining({ line: 9, safety: "safe-world-tick" }),
    ]);
    expect(delivered.slice(-3).map((value) => (
      value as CheckpointRecord
    ).checkpoint.event_cursor))
      .toEqual([20, 20, 20]);
    expect(feed.diagnostics()).toMatchObject({ lastDeliveredLine: 9, polling: false });
  });

  // LAW CHANGE (spec §5.2): a join no longer walks all history. It used to reset
  // `lastDeliveredLine` to 0 and page forward from line 1 on every join AND every
  // recovery — a day-old world needed ~364 sequential fetches, the only genuinely
  // O(all history) thing in the join path, and every one of those pages was surplus:
  // a checkpoint is a whole world snapshot, so the newest supersedes every older one.
  // The feed now anchors at the newest checkpoint and reads back exactly one page.
  it("anchors a join at the newest checkpoints instead of walking all history", async () => {
    const client = scriptedClient({
      latest: [record(130, "world_tick", 130)],
      pages: new Map([[131, page(131, range(115, 130))]]),
    });
    const scheduler = new FakeScheduler();
    const feed = createCheckpointFeed({ createClient: () => client, scheduler });
    const lines: number[] = [];
    feed.subscribe((value) => lines.push(value.line));

    feed.start({ runId: "run-a", sourceKey: "archive-a" });
    await scheduler.runNext();

    expect(client.getCheckpointPage).toHaveBeenCalledOnce();
    expect(client.getCheckpointPage).toHaveBeenNthCalledWith(1, 131, 16);
    expect(lines).toEqual(rangeNumbers(115, 130));
    expect(feed.diagnostics().lastDeliveredLine).toBe(130);
  });

  it("re-anchors on a recovery reset rather than replaying the whole world again", async () => {
    const client = scriptedClient({
      latest: [record(400, "world_tick", 400)],
      pages: new Map([[401, page(401, range(385, 400))]]),
    });
    const scheduler = new FakeScheduler();
    const feed = createCheckpointFeed({ createClient: () => client, scheduler });
    const lines: number[] = [];
    feed.subscribe((value) => lines.push(value.line));

    feed.start({ runId: "run-a", sourceKey: "live-a" });
    await scheduler.runNext();
    feed.reset({ runId: "run-a", sourceKey: "live-a" });
    // The pre-reset poll left its own follow-up scheduled; `reset` cancelled it, so
    // the first turn is that inert job and the second is the re-anchored poll.
    await scheduler.runNext();
    await scheduler.runNext();

    expect(client.getCheckpointPage).toHaveBeenCalledTimes(2);
    expect(client.getCheckpointPage).toHaveBeenNthCalledWith(2, 401, 16);
    expect(lines).toEqual([...rangeNumbers(385, 400), ...rangeNumbers(385, 400)]);
  });

  // The server clamps a page to its own byte budget by dropping the OLDEST records
  // and saying `truncated`. What survives is still the newest contiguous run ending
  // at `before - 1`, and the dropped lines are strictly older than the delivered
  // ones — superseded by definition. Before this, the client demanded an exact page
  // length and threw, so a designed clamp read as a corrupt page.
  it("accepts a byte-clamped short page and keeps advancing", async () => {
    const client = scriptedClient({
      latest: [record(130, "world_tick", 130)],
      pages: new Map([[131, page(131, range(127, 130), { truncated: true })]]),
    });
    const scheduler = new FakeScheduler();
    const feed = createCheckpointFeed({ createClient: () => client, scheduler });
    const lines: number[] = [];
    const faults = vi.fn();
    feed.subscribe((value) => lines.push(value.line));
    feed.subscribeFault(faults);

    feed.start({ runId: "run-a", sourceKey: "archive-a" });
    await scheduler.runNext();

    expect(lines).toEqual(rangeNumbers(127, 130));
    expect(faults).not.toHaveBeenCalled();
    expect(feed.diagnostics().lastDeliveredLine).toBe(130);
  });

  it("still faults on a short page that does not admit to being truncated", async () => {
    const client = scriptedClient({
      latest: [record(130, "world_tick", 130)],
      pages: new Map([[131, page(131, range(127, 130))]]),
    });
    const scheduler = new FakeScheduler();
    const feed = createCheckpointFeed({ createClient: () => client, scheduler });
    const lines: number[] = [];
    const faults = vi.fn();
    feed.subscribe((value) => lines.push(value.line));
    feed.subscribeFault(faults);

    feed.start({ runId: "run-a", sourceKey: "archive-a" });
    await scheduler.runNext();

    expect(lines).toEqual([]);
    expect(faults).toHaveBeenCalledWith({ kind: "unavailable", line: null, retryable: true });
  });

  it("faults on an empty page without advancing over the unseen range", async () => {
    const client = scriptedClient({
      latest: [record(70, "world_tick", 70)],
      pages: new Map([[71, page(71, [])]]),
    });
    const scheduler = new FakeScheduler();
    const feed = createCheckpointFeed({ createClient: () => client, scheduler });
    const delivered = vi.fn();
    const faults = vi.fn();
    feed.subscribe(delivered);
    feed.subscribeFault(faults);

    feed.start({ runId: "run-a", sourceKey: "archive-a" });
    await scheduler.runNext();

    expect(delivered).not.toHaveBeenCalled();
    expect(faults).toHaveBeenCalledOnce();
    expect(faults).toHaveBeenCalledWith({
      kind: "unavailable",
      line: null,
      retryable: true,
    });
    // The anchor is a policy decision, not a delivery: it moves the read cursor to
    // the newest page's start before the first fetch, and nothing was published.
    expect(feed.diagnostics().lastDeliveredLine).toBe(54);
    expect(scheduler.pendingCount()).toBe(1);
  });

  it("retries an incomplete page from the last contiguous boundary", async () => {
    let attempt = 0;
    const client: CheckpointApiClient = {
      getReplayManifest: vi.fn(),
      getLatestCheckpoint: vi.fn(async () => record(130, "world_tick", 130)),
      getCheckpointPage: vi.fn(async (before: number) => {
        attempt += 1;
        // A hole, NOT a byte clamp: short and silent about it.
        return attempt === 1
          ? page(before, range(119, 130))
          : page(before, range(115, 130));
      }),
    };
    const scheduler = new FakeScheduler();
    const feed = createCheckpointFeed({ createClient: () => client, scheduler });
    const lines: number[] = [];
    const faults = vi.fn();
    feed.subscribe((value) => lines.push(value.line));
    feed.subscribeFault(faults);

    feed.start({ runId: "run-a", sourceKey: "archive-a" });
    await scheduler.runNext();

    expect(lines).toEqual([]);
    expect(feed.diagnostics().lastDeliveredLine).toBe(114);
    expect(faults).toHaveBeenCalledOnce();

    await scheduler.runNext();

    expect(client.getCheckpointPage).toHaveBeenCalledTimes(2);
    expect(client.getCheckpointPage).toHaveBeenNthCalledWith(1, 131, 16);
    expect(client.getCheckpointPage).toHaveBeenNthCalledWith(2, 131, 16);
    expect(lines).toEqual(rangeNumbers(115, 130));
    expect(feed.diagnostics().lastDeliveredLine).toBe(130);
  });

  it.each([
    {
      name: "a missing interior line",
      page: page(147, [...range(131, 139), ...range(141, 146)], { truncated: true }),
    },
    {
      name: "a skipping nextBefore",
      page: page(147, range(131, 146), { nextBefore: 132 }),
    },
    {
      name: "false hasMore",
      page: page(147, range(131, 146), { hasMore: false }),
    },
  ])("does not publish beyond $name in a forward window", async ({ page: badPage }) => {
    // Two polls: the anchored join page is good, the next forward page is not.
    const client = scriptedClient({
      latest: [record(130, "world_tick", 130), record(146, "world_tick", 146)],
      pages: new Map([
        [131, page(131, range(115, 130))],
        [147, badPage],
      ]),
    });
    const scheduler = new FakeScheduler();
    const feed = createCheckpointFeed({ createClient: () => client, scheduler });
    const lines: number[] = [];
    const faults = vi.fn();
    feed.subscribe((value) => lines.push(value.line));
    feed.subscribeFault(faults);

    feed.start({ runId: "run-a", sourceKey: "archive-a" });
    await scheduler.runNext();
    await scheduler.runNext();

    expect(lines).toEqual(rangeNumbers(115, 130));
    expect(feed.diagnostics().lastDeliveredLine).toBe(130);
    expect(faults).toHaveBeenCalledWith({
      kind: "unavailable",
      line: null,
      retryable: true,
    });
  });

  it("emits a run-mismatch fault and rejects the checkpoint", async () => {
    const client = scriptedClient({ latest: [record(7, "world_tick", 7, "run-b")] });
    const scheduler = new FakeScheduler();
    const feed = createCheckpointFeed({ createClient: () => client, scheduler });
    const delivered = vi.fn();
    const faults = vi.fn();
    feed.subscribe(delivered);
    feed.subscribeFault(faults);

    feed.start({ runId: "run-a", sourceKey: "archive-a" });
    await scheduler.runNext();

    expect(delivered).not.toHaveBeenCalled();
    expect(faults).toHaveBeenCalledOnce();
    expect(faults).toHaveBeenCalledWith({
      kind: "run-mismatch",
      line: 7,
      retryable: false,
    });
  });

  it("emits one honest non-retryable page-oversized fault without line inference", async () => {
    const requestedMethods: string[] = [];
    const client = scriptedClient({
      latest: [record(100, "world_tick", 100)],
      pageError: new HttpResponseError(
        "/api/replay/checkpoints?before=65&limit=64",
        413,
        "checkpoint exceeds 320 KiB",
      ),
      onCall: (name) => requestedMethods.push(name),
    });
    const scheduler = new FakeScheduler();
    const feed = createCheckpointFeed({ createClient: () => client, scheduler });
    const faults = vi.fn();
    feed.subscribeFault(faults);

    feed.start({ runId: "run-a", sourceKey: "archive-a" });
    await scheduler.runNext();
    await scheduler.runAll();

    expect(faults).toHaveBeenCalledOnce();
    expect(faults).toHaveBeenCalledWith({
      kind: "oversized-record",
      line: null,
      retryable: false,
    });
    expect(client.getCheckpointPage).toHaveBeenCalledOnce();
    expect(requestedMethods).toEqual(["latest", "page"]);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it("reports latest 413 without line identity and stops the generation", async () => {
    const client = scriptedClient({
      latest: [null],
      latestError: new HttpResponseError(
        "/api/replay/checkpoints/latest",
        413,
        "checkpoint exceeds 320 KiB",
      ),
    });
    const scheduler = new FakeScheduler();
    const feed = createCheckpointFeed({ createClient: () => client, scheduler });
    const faults = vi.fn();
    feed.subscribeFault(faults);

    feed.start({ runId: "run-a", sourceKey: "archive-a" });
    await scheduler.runNext();

    expect(faults).toHaveBeenCalledOnce();
    expect(faults).toHaveBeenCalledWith({
      kind: "oversized-record",
      line: null,
      retryable: false,
    });
    expect(client.getCheckpointPage).not.toHaveBeenCalled();
    expect(scheduler.pendingCount()).toBe(0);
  });

  it("aborts an in-flight poll on reset and silently rejects its stale response", async () => {
    const latest = deferred<CheckpointRecord | null>();
    const signals: AbortSignal[] = [];
    const staleClient = scriptedClient({ latest: [latest.promise] });
    const currentClient = scriptedClient({
      latest: [record(1, "world_tick", 1, "run-b")],
      pages: new Map([[2, page(2, [record(1, "world_tick", 1, "run-b")])]]),
    });
    const scheduler = new FakeScheduler();
    const feed = createCheckpointFeed({
      createClient: (signal) => {
        signals.push(signal);
        return signals.length === 1 ? staleClient : currentClient;
      },
      scheduler,
    });
    const delivered = vi.fn();
    const faults = vi.fn();
    feed.subscribe(delivered);
    feed.subscribeFault(faults);

    feed.start({ runId: "run-a", sourceKey: "archive-a" });
    const stalePoll = scheduler.runNext();
    await vi.waitFor(() => expect(staleClient.getLatestCheckpoint).toHaveBeenCalled());
    feed.reset({ runId: "run-b", sourceKey: "archive-b" });
    expect(signals[0].aborted).toBe(true);
    latest.resolve(record(80, "world_tick", 80, "run-a"));
    await stalePoll;
    await scheduler.runNext();

    expect(delivered).toHaveBeenCalledOnce();
    expect(delivered).toHaveBeenCalledWith(expect.objectContaining({ line: 1 }));
    expect(faults).not.toHaveBeenCalled();
  });

  it("aborts and suppresses an in-flight page when disposed", async () => {
    const blockedPage = deferred<CheckpointRecordPage>();
    const signals: AbortSignal[] = [];
    const client = scriptedClient({
      latest: [record(70, "world_tick", 70)],
      pages: new Map([[65, blockedPage.promise]]),
    });
    const scheduler = new FakeScheduler();
    const feed = createCheckpointFeed({
      createClient: (signal) => {
        signals.push(signal);
        return client;
      },
      scheduler,
    });
    const delivered = vi.fn();
    feed.subscribe(delivered);

    feed.start({ runId: "run-a", sourceKey: "archive-a" });
    const poll = scheduler.runNext();
    await vi.waitFor(() => expect(client.getCheckpointPage).toHaveBeenCalled());
    feed.dispose();
    expect(signals[0].aborted).toBe(true);
    blockedPage.resolve(page(65, range(1, 64)));
    await poll;

    expect(delivered).not.toHaveBeenCalled();
    expect(feed.diagnostics()).toMatchObject({ disposed: true, polling: false });
    expect(scheduler.pendingCount()).toBe(0);
  });

  it("stops stale record fan-out when the first listener synchronously resets", async () => {
    const client = scriptedClient({
      latest: [record(1, "world_tick", 1)],
      pages: new Map([[2, page(2, [record(1, "world_tick", 1)])]]),
    });
    const scheduler = new FakeScheduler();
    const feed = createCheckpointFeed({ createClient: () => client, scheduler });
    let reset = false;
    const first = vi.fn(() => {
      if (!reset) {
        reset = true;
        feed.reset({ runId: "run-a", sourceKey: "archive-b" });
      }
    });
    const staleFollower = vi.fn();
    feed.subscribe(first);
    feed.subscribe(staleFollower);

    feed.start({ runId: "run-a", sourceKey: "archive-a" });
    await scheduler.runNext();

    expect(first).toHaveBeenCalledOnce();
    expect(staleFollower).not.toHaveBeenCalled();
    expect(feed.diagnostics()).toMatchObject({ lastDeliveredLine: 0, runId: "run-a" });
  });

  it("stops stale fault fan-out when the first listener synchronously disposes", async () => {
    const client = scriptedClient({ latest: [record(7, "world_tick", 7, "run-b")] });
    const scheduler = new FakeScheduler();
    const feed = createCheckpointFeed({ createClient: () => client, scheduler });
    const first = vi.fn(() => feed.dispose());
    const staleFollower = vi.fn();
    feed.subscribeFault(first);
    feed.subscribeFault(staleFollower);

    feed.start({ runId: "run-a", sourceKey: "archive-a" });
    await scheduler.runNext();

    expect(first).toHaveBeenCalledOnce();
    expect(staleFollower).not.toHaveBeenCalled();
    expect(feed.diagnostics()).toMatchObject({ disposed: true, polling: false });
  });

  it("keeps subscribe operations inert and unretained after disposal", () => {
    const feed = createCheckpointFeed();
    feed.dispose();

    const unsubscribes = Array.from({ length: 80 }, () => [
      feed.subscribe(vi.fn()),
      feed.subscribeFault(vi.fn()),
    ]).flat();

    expect(feed.diagnostics()).toMatchObject({
      disposed: true,
      retainedSafeCheckpoints: 0,
      faultCount: 0,
    });
    expect(() => unsubscribes.forEach((unsubscribe) => unsubscribe())).not.toThrow();
  });

  // Anchoring bounds a JOIN; this bounds a jump the feed must actually cover — an
  // already-anchored feed whose latest line leaps forward while it was polling.
  it("publishes a sustained large jump one bounded page at a time", async () => {
    const delivered: number[] = [];
    const pageSizes: number[] = [];
    const latestLines = [100, 613];
    let poll = 0;
    const client: CheckpointApiClient = {
      getReplayManifest: vi.fn(),
      getLatestCheckpoint: vi.fn(async () => {
        const line = latestLines[Math.min(poll, latestLines.length - 1)]!;
        poll += 1;
        return record(line, "world_tick", line);
      }),
      getCheckpointPage: vi.fn(async (before: number, limit: number) => {
        const records = range(Math.max(1, before - limit), before - 1);
        pageSizes.push(records.length);
        return page(before, records);
      }),
    };
    const scheduler = new FakeScheduler();
    const feed = createCheckpointFeed({ createClient: () => client, scheduler });
    feed.subscribe((value) => delivered.push(value.line));

    feed.start({ runId: "run-a", sourceKey: "archive-a" });
    await scheduler.runNext();
    expect(delivered).toEqual(rangeNumbers(85, 100));

    await scheduler.runNext();

    expect(pageSizes.every((size) => size <= 16)).toBe(true);
    expect(pageSizes).toHaveLength(34);
    expect(delivered).toEqual(rangeNumbers(85, 613));
    expect(feed.diagnostics().lastDeliveredLine).toBe(613);
  });

  it("bounds retained safe checkpoints during sustained polling", async () => {
    let line = 0;
    const client: CheckpointApiClient = {
      getReplayManifest: vi.fn(),
      getLatestCheckpoint: vi.fn(async () => {
        line += 1;
        return record(line, "world_tick", line);
      }),
      getCheckpointPage: vi.fn(async (before: number) => page(
        before,
        range(Math.max(1, before - 64), before - 1),
      )),
    };
    const scheduler = new FakeScheduler();
    const feed = createCheckpointFeed({ createClient: () => client, scheduler });

    feed.start({ runId: "run-a", sourceKey: "archive-a" });
    for (let index = 0; index < CHECKPOINT_FEED_RETAINED_SAFE_LIMIT + 40; index += 1) {
      await scheduler.runNext();
    }

    expect(feed.diagnostics()).toMatchObject({
      lastDeliveredLine: CHECKPOINT_FEED_RETAINED_SAFE_LIMIT + 40,
      retainedSafeCheckpoints: CHECKPOINT_FEED_RETAINED_SAFE_LIMIT,
      faultCount: 0,
    });
  });

  it("probes the compact manifest before reparsing an unchanged delivered checkpoint", async () => {
    const first = record(1, "world_tick", 1);
    const client = scriptedClient({
      latest: [first],
      pages: new Map([[2, page(2, [first])]]),
    });
    client.getReplayManifest.mockResolvedValue({
      runId: "run-a",
      checkpointCount: 1,
      lastCheckpointLine: 1,
    });
    const scheduler = new FakeScheduler();
    const feed = createCheckpointFeed({
      createClient: () => client,
      scheduler,
      probeManifestBeforeRepeat: true,
    });

    feed.start({ runId: "run-a", sourceKey: "archive-a" });
    await scheduler.runNext();
    await scheduler.runNext();

    expect(client.getLatestCheckpoint).toHaveBeenCalledOnce();
    expect(client.getReplayManifest).toHaveBeenCalledOnce();
    feed.dispose();
  });
});

class FakeScheduler implements CheckpointFeedScheduler {
  private readonly jobs: Array<{
    active: boolean;
    callback: () => void | Promise<void>;
  }> = [];

  schedule(_delayMs: number, callback: () => void | Promise<void>): { cancel(): void } {
    const job = { active: true, callback };
    this.jobs.push(job);
    return { cancel: () => { job.active = false; } };
  }

  async runNext(): Promise<void> {
    const job = this.jobs.shift();
    if (job?.active) await job.callback();
  }

  async runAll(): Promise<void> {
    while (this.jobs.some((job) => job.active)) await this.runNext();
  }

  pendingCount(): number {
    return this.jobs.filter((job) => job.active).length;
  }
}

function scriptedClient(options: {
  latest: Array<CheckpointRecord | null | Promise<CheckpointRecord | null>>;
  pages?: Map<number, CheckpointRecordPage | Promise<CheckpointRecordPage>>;
  pageError?: Error;
  latestError?: Error;
  onCall?: (name: "latest" | "page") => void;
}): CheckpointApiClient & {
  getReplayManifest: ReturnType<typeof vi.fn>;
  getLatestCheckpoint: ReturnType<typeof vi.fn>;
  getCheckpointPage: ReturnType<typeof vi.fn>;
} {
  let latestIndex = 0;
  return {
    getReplayManifest: vi.fn(async (): Promise<ReplayManifestSummary> => ({
      runId: "run-a",
      checkpointCount: 0,
      lastCheckpointLine: null,
    })),
    getLatestCheckpoint: vi.fn(async () => {
      options.onCall?.("latest");
      if (options.latestError) throw options.latestError;
      const value = options.latest[Math.min(latestIndex, options.latest.length - 1)] ?? null;
      latestIndex += 1;
      return value;
    }),
    getCheckpointPage: vi.fn(async (before: number) => {
      options.onCall?.("page");
      if (options.pageError) throw options.pageError;
      return options.pages?.get(before) ?? page(before, []);
    }),
  };
}

function record(
  line: number,
  reason: string,
  cursor: number,
  runId = "run-a",
): CheckpointRecord {
  const snapshot = makeWorld({ run_id: runId, event_cursor: cursor, world_time: cursor });
  const checkpoint: SnapshotCheckpoint = {
    schema: 1,
    type: "world_snapshot_checkpoint",
    reason,
    run_id: runId,
    world_time: cursor,
    event_cursor: cursor,
    snapshot,
    lineNumber: line,
  };
  return { line, checkpoint };
}

function range(first: number, last: number): CheckpointRecord[] {
  return Array.from({ length: last - first + 1 }, (_, index) => {
    const line = first + index;
    return record(line, "world_tick", line);
  });
}

function rangeNumbers(first: number, last: number): number[] {
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

function page(
  before: number,
  records: readonly CheckpointRecord[],
  options: {
    hasMore?: boolean;
    nextBefore?: number | null;
    runId?: string;
    truncated?: boolean;
  } = {},
): CheckpointRecordPage {
  return {
    runId: records[0]?.checkpoint.run_id ?? options.runId ?? "run-a",
    before,
    nextBefore: options.nextBefore ?? records[0]?.line ?? null,
    hasMore: options.hasMore ?? Boolean(records[0] && records[0].line > 1),
    truncated: options.truncated ?? false,
    records,
  };
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve(value: T): void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => { resolve = accept; });
  return { promise, resolve };
}
