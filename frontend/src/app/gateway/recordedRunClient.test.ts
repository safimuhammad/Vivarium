import { describe, expect, it, vi } from "vitest";

import type { EventStreamHandlers, LiveApiClient } from "../client";
import type { RunMetadata, WorldSnapshot } from "../schemas";
import {
  createRecordedRunBridge,
  createRecordedRunDriver,
  fetchRecordedRun,
  inertRecordedCheckpointFeed,
  loadRecordedRun,
  resolveEventHints,
  SSE_POLL_MS,
  type RecordedRun,
  type RecordedRunDriverPlatform,
  type RecordedRunEntry,
} from "./recordedRunClient";

function eventLine(overrides: Partial<{
  type: string;
  source: string;
  payload: Record<string, unknown>;
  scope: string;
  region: string | null;
  target: string | null;
  timestamp: number;
}> = {}): string {
  return JSON.stringify({
    type: overrides.type ?? "speak",
    source: overrides.source ?? "wanderer_001",
    payload: overrides.payload ?? { message: "hi" },
    scope: overrides.scope ?? "local",
    region: overrides.region ?? "warm_springs",
    target: overrides.target ?? null,
    timestamp: overrides.timestamp ?? 100,
  });
}

function snapshotFixture(overrides: Partial<{
  runId: string;
  eventCursor: number;
  worldTime: number;
}> = {}): WorldSnapshot {
  return {
    schema: 1,
    run_id: overrides.runId ?? "seed-abc",
    world_time: overrides.worldTime ?? 1_000,
    event_cursor: overrides.eventCursor ?? 0,
    agents: [],
    regions: [],
    homes: [],
    ruins: [],
    pending_proposals: [],
  };
}

function snapshotLine(overrides: Partial<{
  runId: string;
  eventCursor: number;
  worldTime: number;
}> = {}): string {
  return JSON.stringify({
    type: "world_snapshot_checkpoint",
    reason: "world_tick",
    run_id: overrides.runId ?? "seed-abc",
    event_cursor: overrides.eventCursor ?? 0,
    world_time: overrides.worldTime ?? 1_000,
    schema: 1,
    snapshot: snapshotFixture(overrides),
  });
}

describe("resolveEventHints", () => {
  it("falls back the actor to the event source when no actor key is in the payload", () => {
    const resolved = resolveEventHints({
      type: "speak",
      source: "wanderer_001",
      payload: {},
      scope: "local",
      region: "warm_springs",
      target: null,
      timestamp: 1,
    });
    expect(resolved.actor_id).toBe("wanderer_001");
  });

  it("does not fall back to source for system/world events", () => {
    const resolved = resolveEventHints({
      type: "simulation_started",
      source: "world",
      payload: {},
      scope: "global",
      region: null,
      target: null,
      timestamp: 1,
    });
    expect(resolved.actor_id).toBeUndefined();
  });

  it("prefers a payload actor key over the event source", () => {
    const resolved = resolveEventHints({
      type: "attack",
      source: "wanderer_001",
      payload: { attacker_id: "wanderer_002" },
      scope: "local",
      region: "warm_springs",
      target: null,
      timestamp: 1,
    });
    expect(resolved.actor_id).toBe("wanderer_002");
  });

  it("prefers event.target over a payload target key", () => {
    const resolved = resolveEventHints({
      type: "speak",
      source: "wanderer_001",
      payload: { receiver_id: "wanderer_099" },
      scope: "targeted",
      region: "warm_springs",
      target: "wanderer_003",
      timestamp: 1,
    });
    expect(resolved.target_id).toBe("wanderer_003");
  });

  it("passes through amount, resource_type, and home_id when present", () => {
    const resolved = resolveEventHints({
      type: "gather",
      source: "wanderer_001",
      payload: { amount: 5, resource_type: "energy", home_id: "home_1" },
      scope: "local",
      region: "warm_springs",
      target: null,
      timestamp: 1,
    });
    expect(resolved.amount).toBe(5);
    expect(resolved.resource_type).toBe("energy");
    expect(resolved.home_id).toBe("home_1");
  });
});

describe("loadRecordedRun", () => {
  it("sorts events into cursor order and computes offsets relative to the first event", () => {
    const eventsText = [
      eventLine({ timestamp: 102, type: "second" }),
      eventLine({ timestamp: 100, type: "first" }),
      eventLine({ timestamp: 100.5, type: "middle" }),
    ].join("\n");
    const snapshotsText = snapshotLine();

    const recording = loadRecordedRun({ runId: "label-only", eventsText, snapshotsText });

    expect(recording.entries.map((entry) => entry.event.type)).toEqual([
      "first",
      "middle",
      "second",
    ]);
    expect(recording.entries.map((entry) => entry.cursor)).toEqual([1, 2, 3]);
    expect(recording.entries.map((entry) => entry.offsetMs)).toEqual([0, 500, 2_000]);
    expect(recording.spanMs).toBe(2_000);
  });

  it("ignores blank lines between events", () => {
    const eventsText = `${eventLine({ timestamp: 1 })}\n\n${eventLine({ timestamp: 2 })}\n`;
    const recording = loadRecordedRun({
      runId: "label",
      eventsText,
      snapshotsText: snapshotLine(),
    });
    expect(recording.entries).toHaveLength(2);
  });

  it("derives the run's real identity from the first snapshot, not the caller's label", () => {
    const recording = loadRecordedRun({
      runId: "caller-supplied-label",
      eventsText: eventLine(),
      snapshotsText: snapshotLine({ runId: "seed-real-1783724229023" }),
    });
    expect(recording.runId).toBe("seed-real-1783724229023");
    expect(recording.run.run_id).toBe("seed-real-1783724229023");
    expect(recording.firstSnapshot.run_id).toBe("seed-real-1783724229023");
  });

  it("builds run metadata seeded at 0 with a schema-1 shape", () => {
    const recording = loadRecordedRun({
      runId: "label",
      eventsText: eventLine(),
      snapshotsText: snapshotLine({ worldTime: 5_000, eventCursor: 3 }),
    });
    const run: RunMetadata = recording.run;
    expect(run.schema).toBe(1);
    expect(run.seed).toBe(0);
    expect(run.status).toBe("running");
    expect(run.world_time).toBe(5_000);
    expect(run.event_cursor).toBe(3);
  });

  it("computes resolved hints for every entry", () => {
    const recording = loadRecordedRun({
      runId: "label",
      eventsText: eventLine({ source: "wanderer_004", payload: {} }),
      snapshotsText: snapshotLine(),
    });
    expect(recording.entries[0]?.resolved.actor_id).toBe("wanderer_004");
    expect(recording.entries[0]?.snapshot_after).toBeNull();
  });

  it("throws a clear error for a recording with no events", () => {
    expect(() => loadRecordedRun({
      runId: "empty-run",
      eventsText: "",
      snapshotsText: snapshotLine(),
    })).toThrow(/empty-run/);
  });

  it("throws a clear error for a recording with no snapshots", () => {
    expect(() => loadRecordedRun({
      runId: "no-snapshots",
      eventsText: eventLine(),
      snapshotsText: "",
    })).toThrow(/no-snapshots/);
  });

  describe("snapshotAt", () => {
    it("picks the newest snapshot at or below the requested cursor and restamps it forward", () => {
      const snapshotsText = [
        snapshotLine({ eventCursor: 0, worldTime: 1_000 }),
        snapshotLine({ eventCursor: 5, worldTime: 1_050 }),
        snapshotLine({ eventCursor: 12, worldTime: 1_120 }),
      ].join("\n");
      const recording = loadRecordedRun({
        runId: "label",
        eventsText: eventLine(),
        snapshotsText,
      });

      const at7 = recording.snapshotAt(7, 1_070);
      expect(at7.event_cursor).toBe(7);
      expect(at7.world_time).toBe(1_070);
      // The picked base is the eventCursor:5 record, restamped forward.
      expect(at7.run_id).toBe(recording.runId);

      const at0 = recording.snapshotAt(0, 1_000);
      expect(at0.event_cursor).toBe(0);
    });

    it("returns defensive clones that do not alias the source snapshots", () => {
      const recording = loadRecordedRun({
        runId: "label",
        eventsText: eventLine(),
        snapshotsText: snapshotLine(),
      });
      const first = recording.snapshotAt(0, 1_000);
      first.agents.push({
        id: "intruder",
        name: "intruder",
        persona: "",
        position: "warm_springs",
        energy: 1,
        materials: 1,
        status: "alive",
        last_mated_at: null,
        offspring_count: 0,
        died_at: null,
        home_id: null,
        is_hoarding: false,
      });
      const second = recording.snapshotAt(0, 1_000);
      expect(second.agents).toHaveLength(0);
    });
  });
});

describe("createRecordedRunBridge", () => {
  function fixture(): { run: RunMetadata; snapshot: WorldSnapshot } {
    const snapshot = snapshotFixture();
    const run: RunMetadata = {
      schema: 1,
      run_id: "seed-abc",
      seed: 0,
      started_at: 1_000,
      status: "running",
      event_cursor: 0,
      world_time: 1_000,
      config_hash: "recorded:seed-abc",
      constants: {},
      seed_persona: null,
      provider: "gemini",
      model: "recorded",
      context_window: null,
      timing: {},
      artifacts: { events: "recorded", usage: "recorded", snapshots: "recorded", memory_root: "recorded" },
    };
    return { run, snapshot };
  }

  it("answers getRun/getWorld with defensive clones of the current identity", async () => {
    const { run, snapshot } = fixture();
    const bridge = createRecordedRunBridge(run, snapshot);
    const gotRun = await bridge.client.getRun();
    expect(gotRun).toEqual(run);
    expect(gotRun).not.toBe(run);
    const gotWorld = await bridge.client.getWorld();
    expect(gotWorld).toEqual(snapshot);
    expect(gotWorld).not.toBe(snapshot);
  });

  it("reflects a setSnapshot call in the next getWorld", async () => {
    const { run, snapshot } = fixture();
    const bridge = createRecordedRunBridge(run, snapshot);
    bridge.setSnapshot(snapshotFixture({ eventCursor: 9, worldTime: 1_900 }));
    const gotWorld = await bridge.client.getWorld();
    expect(gotWorld.event_cursor).toBe(9);
    expect(gotWorld.world_time).toBe(1_900);
  });

  it("dispatches an envelope only to the newest active stream", async () => {
    const { run, snapshot } = fixture();
    const bridge = createRecordedRunBridge(run, snapshot);
    const onEnvelopeA = vi.fn();
    const onEnvelopeB = vi.fn();
    bridge.client.openEventStream(0, { onEnvelope: onEnvelopeA });
    bridge.client.openEventStream(0, { onEnvelope: onEnvelopeB });

    const envelope = {
      schema: 1 as const,
      cursor: 0,
      oldest_cursor: 1,
      next_cursor: 1,
      events: [],
      overflow: false,
      snapshot_required: false,
    };
    await bridge.dispatch(envelope);

    expect(onEnvelopeA).not.toHaveBeenCalled();
    expect(onEnvelopeB).toHaveBeenCalledTimes(1);
  });

  it("falls back to an older stream once the newest one has been closed", async () => {
    const { run, snapshot } = fixture();
    const bridge = createRecordedRunBridge(run, snapshot);
    const onEnvelopeA = vi.fn();
    const onEnvelopeB = vi.fn();
    bridge.client.openEventStream(0, { onEnvelope: onEnvelopeA });
    const streamB = bridge.client.openEventStream(0, { onEnvelope: onEnvelopeB });
    streamB.close();

    const envelope = {
      schema: 1 as const,
      cursor: 0,
      oldest_cursor: 1,
      next_cursor: 1,
      events: [],
      overflow: false,
      snapshot_required: false,
    };
    await bridge.dispatch(envelope);

    expect(onEnvelopeA).toHaveBeenCalledTimes(1);
    expect(onEnvelopeB).not.toHaveBeenCalled();
  });

  it("delivers a heartbeat to the newest active stream's handler", () => {
    const { run, snapshot } = fixture();
    const bridge = createRecordedRunBridge(run, snapshot);
    const onHeartbeat = vi.fn();
    bridge.client.openEventStream(0, { onEnvelope: vi.fn(), onHeartbeat });

    bridge.heartbeat(1_234, "running");

    expect(onHeartbeat).toHaveBeenCalledWith({ cursor: -1, worldTime: 1_234, status: "running" });
  });

  it("stops delivering once disposed", async () => {
    const { run, snapshot } = fixture();
    const bridge = createRecordedRunBridge(run, snapshot);
    const onEnvelope = vi.fn();
    bridge.client.openEventStream(0, { onEnvelope });
    bridge.dispose();

    const envelope = {
      schema: 1 as const,
      cursor: 0,
      oldest_cursor: 1,
      next_cursor: 1,
      events: [],
      overflow: false,
      snapshot_required: false,
    };
    await bridge.dispatch(envelope);

    expect(onEnvelope).not.toHaveBeenCalled();
  });
});

describe("createRecordedRunDriver", () => {
  function entry(cursor: number, offsetMs: number): RecordedRunEntry {
    return {
      cursor,
      offsetMs,
      event: {
        type: "speak",
        source: "wanderer_001",
        payload: {},
        scope: "local",
        region: "warm_springs",
        target: null,
        timestamp: offsetMs / 1_000,
      },
      resolved: { actor_id: "wanderer_001" },
      snapshot_after: null,
    };
  }

  function fakePlatform(): {
    platform: RecordedRunDriverPlatform;
    setNow: (ms: number) => void;
    fireScheduled: () => void;
    scheduledCount: () => number;
  } {
    let now = 0;
    let scheduled: { handle: number; callback: () => void } | null = null;
    let nextHandle = 1;
    return {
      platform: {
        now: () => now,
        setTimeout: (callback: () => void): number => {
          const handle = nextHandle;
          nextHandle += 1;
          scheduled = { handle, callback };
          return handle;
        },
        clearTimeout: (handle: number): void => {
          if (scheduled?.handle === handle) scheduled = null;
        },
      },
      setNow: (ms: number): void => {
        now = ms;
      },
      fireScheduled: (): void => {
        const current = scheduled;
        scheduled = null;
        current?.callback();
      },
      scheduledCount: (): number => (scheduled === null ? 0 : 1),
    };
  }

  function fakeRecording(entries: readonly RecordedRunEntry[]): RecordedRun & {
    snapshotAtCalls: Array<{ cursor: number; worldTime: number }>;
  } {
    const snapshotAtCalls: Array<{ cursor: number; worldTime: number }> = [];
    const last = entries[entries.length - 1];
    return {
      runId: "seed-abc",
      entries,
      firstSnapshot: snapshotFixture(),
      run: {
        schema: 1,
        run_id: "seed-abc",
        seed: 0,
        started_at: 0,
        status: "running",
        event_cursor: 0,
        world_time: 0,
        config_hash: "recorded:seed-abc",
        constants: {},
        seed_persona: null,
        provider: "gemini",
        model: "recorded",
        context_window: null,
        timing: {},
        artifacts: { events: "recorded", usage: "recorded", snapshots: "recorded", memory_root: "recorded" },
      },
      spanMs: last === undefined ? 0 : last.offsetMs,
      snapshotAt(cursor: number, worldTime: number): WorldSnapshot {
        snapshotAtCalls.push({ cursor, worldTime });
        return snapshotFixture({ eventCursor: cursor, worldTime });
      },
      snapshotAtCalls,
    };
  }

  function fakeBridge(): {
    bridge: import("./recordedRunClient").RecordedRunBridge;
    setSnapshotCalls: WorldSnapshot[];
    dispatchCalls: unknown[];
  } {
    const setSnapshotCalls: WorldSnapshot[] = [];
    const dispatchCalls: unknown[] = [];
    return {
      bridge: {
        client: {} as LiveApiClient,
        setSnapshot: (snapshot: WorldSnapshot): void => {
          setSnapshotCalls.push(snapshot);
        },
        dispatch: async (envelope: unknown): Promise<void> => {
          dispatchCalls.push(envelope);
        },
        heartbeat: (): void => undefined,
        dispose: (): void => undefined,
      },
      setSnapshotCalls,
      dispatchCalls,
    };
  }

  it("delivers entries in batches as recorded time is reached, using the default SSE cadence", () => {
    const recording = fakeRecording([entry(1, 0), entry(2, 100), entry(3, 400)]);
    const { bridge, dispatchCalls } = fakeBridge();
    const fake = fakePlatform();
    const onProgress = vi.fn();
    const onComplete = vi.fn();
    const driver = createRecordedRunDriver({
      recording,
      bridge,
      scheduler: fake.platform,
      onProgress,
      onComplete,
    });

    driver.start();
    expect(fake.scheduledCount()).toBe(1);

    fake.setNow(150);
    fake.fireScheduled();

    expect(dispatchCalls).toHaveLength(1);
    expect(onProgress).toHaveBeenCalledWith({ atMs: 150, deliveredCursor: 2, remaining: 1 });
    expect(driver.atMs()).toBe(150);
    expect(onComplete).not.toHaveBeenCalled();
    expect(fake.scheduledCount()).toBe(1);
  });

  it("stops rescheduling and calls onComplete once every entry has been delivered and span has elapsed", () => {
    const recording = fakeRecording([entry(1, 0), entry(2, 100)]);
    const { bridge } = fakeBridge();
    const fake = fakePlatform();
    const onComplete = vi.fn();
    const driver = createRecordedRunDriver({
      recording,
      bridge,
      scheduler: fake.platform,
      onComplete,
    });

    driver.start();
    fake.setNow(50);
    fake.fireScheduled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(fake.scheduledCount()).toBe(1);

    fake.setNow(200);
    fake.fireScheduled();

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(fake.scheduledCount()).toBe(0);
  });

  it("uses SSE_POLL_MS/rate as its poll cadence, floored at 16ms", () => {
    const recording = fakeRecording([entry(1, 0)]);
    const { bridge } = fakeBridge();
    let requestedDelay: number | null = null;
    const platform: RecordedRunDriverPlatform = {
      now: () => 0,
      setTimeout: (callback, delayMs) => {
        requestedDelay = delayMs;
        return 1;
      },
      clearTimeout: () => undefined,
    };
    const driver = createRecordedRunDriver({ recording, bridge, rate: 4, scheduler: platform });
    driver.start();
    expect(requestedDelay).toBe(Math.max(16, SSE_POLL_MS / 4));
    driver.stop();
  });

  it("restamps the delivered snapshot to the cursor and timestamp of the last delivered entry", () => {
    const recording = fakeRecording([entry(1, 0), entry(2, 50)]);
    const { bridge, setSnapshotCalls } = fakeBridge();
    const fake = fakePlatform();
    const driver = createRecordedRunDriver({ recording, bridge, scheduler: fake.platform });

    driver.start();
    fake.setNow(60);
    fake.fireScheduled();

    expect(setSnapshotCalls).toHaveLength(1);
    expect(setSnapshotCalls[0]?.event_cursor).toBe(2);
    expect(recording.snapshotAtCalls).toEqual([{ cursor: 2, worldTime: entry(2, 50).event.timestamp }]);
  });

  it("stop() cancels a pending timer and start() is idempotent while running", () => {
    const recording = fakeRecording([entry(1, 0)]);
    const { bridge } = fakeBridge();
    const fake = fakePlatform();
    const driver = createRecordedRunDriver({ recording, bridge, scheduler: fake.platform });

    driver.start();
    driver.start();
    expect(fake.scheduledCount()).toBe(1);
    driver.stop();
    expect(fake.scheduledCount()).toBe(0);
  });
});

describe("inertRecordedCheckpointFeed", () => {
  it("implements CheckpointFeed as a set of safe no-ops", () => {
    const feed = inertRecordedCheckpointFeed();
    expect(() => feed.start({ runId: "r", sourceKey: "k" })).not.toThrow();
    const unsubscribe = feed.subscribe(() => undefined);
    expect(() => unsubscribe()).not.toThrow();
    const unsubscribeFault = feed.subscribeFault(() => undefined);
    expect(() => unsubscribeFault()).not.toThrow();
    expect(() => feed.reset({ runId: "r", sourceKey: "k" })).not.toThrow();
    expect(feed.diagnostics()).toEqual({
      disposed: false,
      runId: null,
      lastDeliveredLine: 0,
      polling: false,
      retainedSafeCheckpoints: 0,
      faultCount: 0,
    });
    expect(() => feed.dispose()).not.toThrow();
  });
});

describe("fetchRecordedRun", () => {
  function response(ok: boolean, text: string, status = 200): Response {
    return {
      ok,
      status,
      text: async () => text,
    } as unknown as Response;
  }

  it("fetches events.jsonl and snapshots.jsonl beneath the base URL and parses them", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/events.jsonl")) return response(true, eventLine());
      if (url.endsWith("/snapshots.jsonl")) return response(true, snapshotLine());
      throw new Error(`unexpected fetch ${url}`);
    });

    const recording = await fetchRecordedRun("https://example.test/recordings/nirvana/", { fetcher });

    expect(calls.sort()).toEqual([
      "https://example.test/recordings/nirvana/events.jsonl",
      "https://example.test/recordings/nirvana/snapshots.jsonl",
    ]);
    expect(recording.entries).toHaveLength(1);
  });

  it("throws with the URL and status when a fetch fails", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/events.jsonl")) return response(false, "", 404);
      return response(true, snapshotLine());
    });

    await expect(fetchRecordedRun("https://example.test/missing", { fetcher }))
      .rejects.toThrow(/events\.jsonl.*404/);
  });
});
