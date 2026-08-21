import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  EventStream,
  EventStreamHandlers,
  LiveApiClient,
} from "./client";
import { makeEventEnvelope, makeRun, makeWorld } from "../test/fixtures";
import type { EventEnvelope, RunMetadata, WorldSnapshot } from "./schemas";
import { createWorldStore } from "./store";
import { startLiveRun } from "./useLiveRun";
import { createPresentationIngress } from "../presentation/PresentationIngress";

class FakeStream implements EventStream {
  closed = false;

  constructor(
    readonly cursor: number,
    readonly handlers: EventStreamHandlers,
    readonly url = `/api/events/stream?cursor=${cursor}`,
  ) {}

  close(): void {
    this.closed = true;
  }

  async emit(envelope: EventEnvelope): Promise<void> {
    await this.handlers.onEnvelope(envelope);
  }

  fail(error: unknown): void {
    this.handlers.onError?.(error);
  }
}

class FakeClient implements LiveApiClient {
  readonly calls: string[] = [];
  readonly streams: FakeStream[] = [];
  private runFailure: unknown = null;
  private readonly queuedRuns: RunMetadata[] = [];
  private readonly worldFailures: unknown[] = [];
  private readonly worldDeferrals: Array<Deferred<WorldSnapshot>> = [];

  constructor(
    private readonly run: RunMetadata = makeRun(),
    private readonly worlds: WorldSnapshot[] = [makeWorld()],
  ) {}

  failRun(error: unknown): void {
    this.runFailure = error;
  }

  queueRun(run: RunMetadata): void {
    this.queuedRuns.push(run);
  }

  failNextWorld(error: unknown): void {
    this.worldFailures.push(error);
  }

  deferNextWorld(): Deferred<WorldSnapshot> {
    const deferred = createDeferred<WorldSnapshot>();
    this.worldDeferrals.push(deferred);
    return deferred;
  }

  async getRun(): Promise<RunMetadata> {
    this.calls.push("run");
    if (this.runFailure) {
      throw this.runFailure;
    }
    return this.queuedRuns.shift() ?? this.run;
  }

  async getWorld(): Promise<WorldSnapshot> {
    this.calls.push("world");
    const deferred = this.worldDeferrals.shift();
    if (deferred) {
      return deferred.promise;
    }
    const failure = this.worldFailures.shift();
    if (failure) {
      throw failure;
    }
    return this.worlds.shift() ?? makeWorld();
  }

  async getEvents(): Promise<EventEnvelope> {
    throw new Error("polling is not used by the live controller");
  }

  openEventStream(cursor: number, handlers: EventStreamHandlers): EventStream {
    this.calls.push(`stream:${cursor}`);
    const stream = new FakeStream(cursor, handlers);
    this.streams.push(stream);
    return stream;
  }
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("startLiveRun", () => {
  afterEach(() => {
    vi.useRealTimers();
    window.__vivariumLiveRun = undefined;
    window.__vivariumEnableSnapshotRefreshForTest = undefined;
  });

  it("publishes accepted evidence before the legacy ring truncates a 120-entry envelope", async () => {
    const store = createWorldStore();
    const client = new FakeClient(makeRun({ event_cursor: 0 }), [
      makeWorld({ event_cursor: 0 }),
    ]);
    const callbackObservations: Array<{ entries: number; retainedBeforeAppend: number }> = [];
    const controller = startLiveRun({
      client,
      store,
      snapshotRefreshMs: 0,
      onEnvelopeAccepted: (envelope) => {
        callbackObservations.push({
          entries: envelope.events.length,
          retainedBeforeAppend: store.getState().eventBeats.length,
        });
      },
    });
    await controller.ready;
    const event = makeEventEnvelope().events[0];
    const envelope = makeEventEnvelope({
      cursor: 0,
      next_cursor: 120,
      events: Array.from({ length: 120 }, (_, index) => ({
        ...event,
        cursor: index + 1,
      })),
    });

    await client.streams[0].emit(envelope);

    expect(callbackObservations).toEqual([{ entries: 120, retainedBeforeAppend: 0 }]);
    expect(store.getState().eventBeats).toHaveLength(80);
    expect(store.getState().eventBeats[0].cursor).toBe(41);
    controller.stop();
  });

  it("rejects a mismatched initial world before publishing or opening a stream", async () => {
    vi.useFakeTimers();
    const store = createWorldStore();
    const client = new FakeClient(makeRun({ run_id: "run-a", event_cursor: 4 }), [
      makeWorld({ run_id: "run-b", event_cursor: 8 }),
    ]);
    const onRunAccepted = vi.fn();
    const onSnapshotAccepted = vi.fn();
    const controller = startLiveRun({
      client,
      store,
      snapshotRefreshMs: 0,
      reconnectDelayMs: 100,
      onRunAccepted,
      onSnapshotAccepted,
    });

    await controller.ready;

    expect(onRunAccepted).toHaveBeenCalledOnce();
    expect(onSnapshotAccepted).not.toHaveBeenCalled();
    expect(client.calls).toEqual(["run", "world"]);
    expect(client.streams).toHaveLength(0);
    expect(store.getState()).toMatchObject({
      run: expect.objectContaining({ run_id: "run-a" }),
      snapshot: null,
      eventCursor: 4,
      connection: "error",
      lastError: "Fresh world view did not match the active run",
    });
    expect(controller.diagnostics()).toMatchObject({
      lastAcceptedSnapshotCursor: null,
      lastRejectedSnapshotCursor: 8,
      lastRejectedSnapshotReason: "Fresh world view did not match the active run",
      timers: { recoveryRetry: true },
    });
    controller.stop();
  });

  it("ignores a superseded initial-world rejection", async () => {
    vi.useFakeTimers();
    const store = createWorldStore();
    const client = new FakeClient(makeRun({ run_id: "run-a", event_cursor: 4 }), []);
    const initialWorld = client.deferNextWorld();
    const onRunAccepted = vi.fn();
    const onSnapshotAccepted = vi.fn();
    const controller = startLiveRun({
      client,
      store,
      snapshotRefreshMs: 0,
      reconnectDelayMs: 100,
      onRunAccepted,
      onSnapshotAccepted,
    });
    await vi.waitFor(() => expect(onRunAccepted).toHaveBeenCalledOnce());

    window.__vivariumLiveRun?.applyRunMetadataForTest(
      makeRun({ run_id: "run-b", event_cursor: 2 }),
    );
    store.markConnection("reconnecting", new Error("replacement generation active"));
    const diagnosticsBeforeRejection = controller.diagnostics().lastSnapshotRefresh;
    initialWorld.reject(new Error("stale initial world failed"));
    await controller.ready;

    expect(onRunAccepted.mock.calls.map(([, disposition]) => disposition)).toEqual([
      "initial",
      "replacement",
    ]);
    expect(onSnapshotAccepted).not.toHaveBeenCalled();
    expect(client.streams).toHaveLength(0);
    expect(store.getState()).toMatchObject({
      run: expect.objectContaining({ run_id: "run-b" }),
      snapshot: null,
      eventCursor: 2,
      connection: "reconnecting",
      lastError: "replacement generation active",
    });
    expect(controller.diagnostics()).toMatchObject({
      lastSnapshotRefresh: diagnosticsBeforeRejection,
      timers: { recoveryRetry: false, reconnect: false },
    });
    controller.stop();
  });

  it("ignores a superseded recovery rejection", async () => {
    vi.useFakeTimers();
    const store = createWorldStore();
    const client = new FakeClient(makeRun({ run_id: "run-a", event_cursor: 4 }), [
      makeWorld({ run_id: "run-a", event_cursor: 4 }),
    ]);
    const onRunAccepted = vi.fn();
    const onSnapshotAccepted = vi.fn();
    const controller = startLiveRun({
      client,
      store,
      snapshotRefreshMs: 0,
      reconnectDelayMs: 100,
      onRunAccepted,
      onSnapshotAccepted,
    });
    await controller.ready;
    const staleRecoveryWorld = client.deferNextWorld();
    const recovery = client.streams[0].emit(
      makeEventEnvelope({
        cursor: 4,
        oldest_cursor: 2,
        next_cursor: 10,
        overflow: true,
        snapshot_required: true,
      }),
    );
    await vi.waitFor(() => expect(client.calls.at(-1)).toBe("world"));

    window.__vivariumLiveRun?.applyRunMetadataForTest(
      makeRun({ run_id: "run-b", event_cursor: 2 }),
    );
    store.markConnection("reconnecting", new Error("new recovery generation active"));
    const diagnosticsBeforeRejection = controller.diagnostics().lastSnapshotRefresh;
    staleRecoveryWorld.reject(new Error("stale recovery failed"));
    await recovery;

    expect(onRunAccepted.mock.calls.map(([, disposition]) => disposition)).toEqual([
      "initial",
      "same-run",
      "replacement",
    ]);
    expect(onSnapshotAccepted).toHaveBeenCalledOnce();
    expect(client.streams).toHaveLength(1);
    expect(client.streams[0].closed).toBe(true);
    expect(store.getState()).toMatchObject({
      run: expect.objectContaining({ run_id: "run-b" }),
      snapshot: null,
      eventCursor: 2,
      connection: "reconnecting",
      lastError: "new recovery generation active",
    });
    expect(controller.diagnostics()).toMatchObject({
      lastSnapshotRefresh: diagnosticsBeforeRejection,
      recoveryRefreshInFlight: false,
      refreshInFlight: "none",
      timers: { recoveryRetry: false, reconnect: false },
      stream: { active: false },
    });
    controller.stop();
  });

  it("keeps compatibility append running when a presentation subscriber throws", async () => {
    const store = createWorldStore();
    const client = new FakeClient(makeRun({ run_id: "run-a", event_cursor: 0 }), [
      makeWorld({ run_id: "run-a", event_cursor: 0 }),
    ]);
    const ingress = createPresentationIngress();
    const healthySubscriber = vi.fn();
    ingress.reset({ runId: "run-a", sourceKey: "live-a", cursor: 0 });
    ingress.subscribe(() => {
      throw new Error("presentation observer failed");
    });
    ingress.subscribe(healthySubscriber);
    const controller = startLiveRun({
      client,
      store,
      snapshotRefreshMs: 0,
      onEnvelopeAccepted: ingress.onEnvelopeAccepted,
    });
    await controller.ready;
    const envelope = makeEventEnvelope({
      cursor: 0,
      next_cursor: 1,
      events: [
        {
          ...makeEventEnvelope().events[0],
          cursor: 1,
        },
      ],
    });

    await expect(client.streams[0].emit(envelope)).resolves.toBeUndefined();

    expect(healthySubscriber).toHaveBeenCalledOnce();
    expect(ingress.getSnapshot()).toMatchObject({
      ingestedCursor: 1,
      acceptedCount: 1,
    });
    expect(store.getState()).toMatchObject({
      eventCursor: 1,
      eventBeats: [expect.objectContaining({ cursor: 1 })],
    });
    controller.stop();
  });

  it("re-accepts same-run metadata before recovery world truth without resetting presentation", async () => {
    const store = createWorldStore();
    const client = new FakeClient(makeRun({ run_id: "run-a", event_cursor: 4 }), [
      makeWorld({ run_id: "run-a", event_cursor: 4 }),
      makeWorld({ run_id: "run-a", event_cursor: 12, world_time: 20 }),
    ]);
    const onRunAccepted = vi.fn();
    const onSnapshotAccepted = vi.fn();
    const controller = startLiveRun({
      client,
      store,
      snapshotRefreshMs: 0,
      onRunAccepted,
      onSnapshotAccepted,
    });
    await controller.ready;
    client.queueRun(makeRun({ run_id: "run-a", event_cursor: 10 }));

    await client.streams[0].emit(
      makeEventEnvelope({
        cursor: 4,
        oldest_cursor: 2,
        next_cursor: 10,
        overflow: true,
        snapshot_required: true,
      }),
    );

    expect(client.calls).toEqual([
      "run",
      "world",
      "stream:4",
      "run",
      "world",
      "stream:12",
    ]);
    expect(onRunAccepted.mock.calls.map(([, disposition]) => disposition)).toEqual([
      "initial",
      "same-run",
    ]);
    expect(onSnapshotAccepted).toHaveBeenCalledTimes(2);
    expect(store.getState()).toMatchObject({
      run: expect.objectContaining({ run_id: "run-a", event_cursor: 10 }),
      snapshot: expect.objectContaining({ run_id: "run-a", event_cursor: 12 }),
      eventCursor: 12,
      eventBeats: [expect.objectContaining({ cursor: 5 })],
      connection: "live",
    });
    controller.stop();
  });

  it("atomically accepts replacement metadata before rejecting a stale old-run world completion", async () => {
    const store = createWorldStore();
    const client = new FakeClient(makeRun({ run_id: "run-a", event_cursor: 4 }), [
      makeWorld({ run_id: "run-a", event_cursor: 4 }),
    ]);
    const onRunAccepted = vi.fn();
    const onSnapshotAccepted = vi.fn();
    const controller = startLiveRun({
      client,
      store,
      snapshotRefreshMs: 0,
      reconnectDelayMs: 100,
      onRunAccepted,
      onSnapshotAccepted,
    });
    await controller.ready;
    client.queueRun(makeRun({ run_id: "run-b", event_cursor: 2 }));
    const staleWorld = client.deferNextWorld();

    const recovery = client.streams[0].emit(
      makeEventEnvelope({
        cursor: 4,
        oldest_cursor: 2,
        next_cursor: 10,
        overflow: true,
        snapshot_required: true,
      }),
    );
    await Promise.resolve();
    const callsBeforeWorldCompletion = [...client.calls];
    staleWorld.resolve(makeWorld({ run_id: "run-a", event_cursor: 12 }));
    await recovery;

    expect(callsBeforeWorldCompletion).toEqual([
      "run",
      "world",
      "stream:4",
      "run",
      "world",
    ]);
    expect(onRunAccepted.mock.calls.map(([, disposition]) => disposition)).toEqual([
      "initial",
      "replacement",
    ]);
    expect(onSnapshotAccepted).toHaveBeenCalledOnce();
    expect(client.streams).toHaveLength(1);
    expect(client.streams[0].closed).toBe(true);
    expect(store.getState()).toMatchObject({
      run: expect.objectContaining({ run_id: "run-b", event_cursor: 2 }),
      snapshot: null,
      eventCursor: 2,
      eventBeats: [],
      connection: "error",
    });
    controller.stop();
  });

  it("reports initial, same-run, and replacement metadata exactly once", async () => {
    const store = createWorldStore();
    const client = new FakeClient(makeRun({ run_id: "run-a", event_cursor: 4 }), [
      makeWorld({ run_id: "run-a", event_cursor: 4 }),
    ]);
    const onRunAccepted = vi.fn();
    const onSnapshotAccepted = vi.fn();
    const controller = startLiveRun({
      client,
      store,
      snapshotRefreshMs: 0,
      onRunAccepted,
      onSnapshotAccepted,
    });
    await controller.ready;

    window.__vivariumLiveRun?.applyRunMetadataForTest(
      makeRun({ run_id: "run-a", event_cursor: 8 }),
    );
    window.__vivariumLiveRun?.applyRunMetadataForTest(
      makeRun({ run_id: "run-b", event_cursor: 1 }),
    );

    expect(onRunAccepted.mock.calls.map(([, disposition]) => disposition)).toEqual([
      "initial",
      "same-run",
      "replacement",
    ]);
    expect(onSnapshotAccepted).toHaveBeenCalledOnce();
    expect(store.getState()).toMatchObject({
      run: expect.objectContaining({ run_id: "run-b" }),
      snapshot: null,
      eventCursor: 1,
      eventBeats: [],
    });
    controller.stop();
  });

  it("rejects an old-run async snapshot after replacement metadata arrives", async () => {
    const store = createWorldStore();
    const client = new FakeClient(makeRun({ run_id: "run-a", event_cursor: 4 }), []);
    const deferredWorld = client.deferNextWorld();
    const onRunAccepted = vi.fn();
    const onSnapshotAccepted = vi.fn();
    const controller = startLiveRun({
      client,
      store,
      snapshotRefreshMs: 0,
      onRunAccepted,
      onSnapshotAccepted,
    });
    await vi.waitFor(() => expect(onRunAccepted).toHaveBeenCalledOnce());

    window.__vivariumLiveRun?.applyRunMetadataForTest(
      makeRun({ run_id: "run-b", event_cursor: 2 }),
    );
    deferredWorld.resolve(makeWorld({ run_id: "run-a", event_cursor: 9 }));
    await controller.ready;

    expect(onRunAccepted.mock.calls.map(([, disposition]) => disposition)).toEqual([
      "initial",
      "replacement",
    ]);
    expect(onSnapshotAccepted).not.toHaveBeenCalled();
    expect(store.getState()).toMatchObject({
      run: expect.objectContaining({ run_id: "run-b" }),
      snapshot: null,
      eventCursor: 2,
    });
    controller.stop();
  });

  it("bootstraps run metadata, world snapshot, and SSE from the snapshot cursor", async () => {
    const store = createWorldStore();
    const client = new FakeClient(makeRun({ event_cursor: 2 }), [
      makeWorld({ event_cursor: 7 }),
    ]);

    const controller = startLiveRun({ client, store, snapshotRefreshMs: 0 });
    await controller.ready;

    expect(client.calls).toEqual(["run", "world", "stream:7"]);
    expect(store.getState().connection).toBe("live");
    expect(store.getState().eventCursor).toBe(7);

    controller.stop();
    expect(client.streams[0].closed).toBe(true);
    expect(store.getState().connection).toBe("offline");
  });

  it("exposes debug-only live diagnostics and clears the global handle on stop", async () => {
    const store = createWorldStore();
    const client = new FakeClient(makeRun({ event_cursor: 2 }), [
      makeWorld({ event_cursor: 7 }),
    ]);

    const controller = startLiveRun({ client, store, snapshotRefreshMs: 0 });
    await controller.ready;

    expect(window.__vivariumLiveRun?.diagnostics()).toMatchObject({
      stopped: false,
      connection: "live",
      eventCursor: 7,
      needsSnapshot: false,
      stream: {
        active: true,
        cursor: 7,
        url: "/api/events/stream?cursor=7",
        serial: 1,
      },
      timers: {
        periodicRefresh: false,
        reconnect: false,
        recoveryRetry: false,
      },
      refreshInFlight: "none",
      recoveryRefreshInFlight: false,
      lastOpenedStreamCursor: 7,
      lastAcceptedSnapshotCursor: 7,
      lastRejectedSnapshotCursor: null,
      lastRejectedSnapshotReason: null,
      lastSnapshotRefresh: {
        status: "applied",
        reconnect: false,
        cursor: 7,
        error: null,
      },
      ignoredStaleStreamCallbackCount: 0,
    });

    controller.stop();

    expect(window.__vivariumLiveRun).toBeUndefined();
    expect(controller.diagnostics()).toMatchObject({
      stopped: true,
      connection: "offline",
      stream: { active: false, cursor: null, url: null, serial: null },
      timers: { periodicRefresh: false, reconnect: false, recoveryRetry: false },
      refreshInFlight: "none",
      recoveryRefreshInFlight: false,
    });
  });

  it("keeps test-only run metadata mutation behind the debug handle boundary", async () => {
    const store = createWorldStore();
    const client = new FakeClient(makeRun({ run_id: "debug-run", event_cursor: 2 }), [
      makeWorld({ run_id: "debug-run", event_cursor: 7 }),
    ]);

    const controller = startLiveRun({ client, store, snapshotRefreshMs: 0 });
    await controller.ready;

    expect(Object.keys(window.__vivariumLiveRun ?? {}).sort()).toEqual([
      "applyRunMetadataForTest",
      "diagnostics",
    ]);

    window.__vivariumLiveRun?.applyRunMetadataForTest(
      makeRun({
        run_id: "debug-run",
        event_cursor: 9,
        artifacts: {
          ...makeRun().artifacts,
          events: "runs/debug-events-b.jsonl",
          snapshots: "runs/debug-snapshots-b.jsonl",
        },
      }),
    );

    expect(store.getState().run).toMatchObject({
      run_id: "debug-run",
      event_cursor: 9,
      artifacts: {
        events: "runs/debug-events-b.jsonl",
        snapshots: "runs/debug-snapshots-b.jsonl",
      },
    });
    expect(store.getState()).toMatchObject({
      connection: "live",
      eventCursor: 9,
      needsSnapshot: false,
    });
    expect(client.calls).toEqual(["run", "world", "stream:7"]);
    expect(client.streams).toHaveLength(1);

    controller.stop();
    expect(window.__vivariumLiveRun).toBeUndefined();
  });

  it("exposes snapshot refresh only when the test flag is enabled", async () => {
    window.__vivariumEnableSnapshotRefreshForTest = true;
    const store = createWorldStore();
    const client = new FakeClient(makeRun({ event_cursor: 2 }), [
      makeWorld({ event_cursor: 7, world_time: 10 }),
      makeWorld({ event_cursor: 12, world_time: 24 }),
    ]);

    const controller = startLiveRun({ client, store, snapshotRefreshMs: 0 });
    await controller.ready;

    expect(Object.keys(window.__vivariumLiveRun ?? {}).sort()).toEqual([
      "applyRunMetadataForTest",
      "diagnostics",
      "refreshSnapshotForTest",
    ]);
    await window.__vivariumLiveRun?.refreshSnapshotForTest?.();

    expect(client.calls).toEqual(["run", "world", "stream:7", "world"]);
    expect(window.__vivariumLiveRun?.diagnostics()).toMatchObject({
      lastAcceptedSnapshotCursor: 12,
      lastSnapshotRefresh: {
        status: "applied",
        reconnect: false,
        cursor: 12,
        error: null,
      },
    });
    expect(store.getState()).toMatchObject({
      connection: "live",
      eventCursor: 12,
      needsSnapshot: false,
    });
    expect(store.getState().snapshot?.world_time).toBe(24);

    controller.stop();
  });

  it("does not publish the live debug handle when disabled", async () => {
    const store = createWorldStore();
    const client = new FakeClient(makeRun({ event_cursor: 2 }), [
      makeWorld({ event_cursor: 7 }),
    ]);

    const controller = startLiveRun({
      client,
      store,
      snapshotRefreshMs: 0,
      debugHandle: "none",
    });
    await controller.ready;

    expect(window.__vivariumLiveRun).toBeUndefined();
    expect(controller.diagnostics()).toMatchObject({
      connection: "live",
      eventCursor: 7,
    });

    controller.stop();
    expect(window.__vivariumLiveRun).toBeUndefined();
  });

  it("keeps a failed first run as a visible live error without opening a stream", async () => {
    const store = createWorldStore();
    const client = new FakeClient();
    client.failRun(new Error("run record missing"));

    const controller = startLiveRun({ client, store, snapshotRefreshMs: 0 });
    await controller.ready;

    expect(client.calls).toEqual(["run"]);
    expect(client.streams).toHaveLength(0);
    expect(store.getState()).toMatchObject({
      run: null,
      snapshot: null,
      connection: "error",
      lastError: "run record missing",
    });

    controller.stop();
  });

  it("retains run metadata when the first world view fails", async () => {
    const store = createWorldStore();
    const client = new FakeClient(makeRun({ event_cursor: 11 }));
    client.failNextWorld(new Error("world view missing"));

    const controller = startLiveRun({ client, store, snapshotRefreshMs: 0 });
    await controller.ready;

    expect(client.calls).toEqual(["run", "world"]);
    expect(client.streams).toHaveLength(0);
    expect(store.getState()).toMatchObject({
      run: expect.objectContaining({ event_cursor: 11 }),
      snapshot: null,
      eventCursor: 11,
      connection: "error",
      lastError: "world view missing",
    });

    controller.stop();
  });

  it("retries the first world view after run metadata is loaded", async () => {
    vi.useFakeTimers();
    const store = createWorldStore();
    const client = new FakeClient(makeRun({ event_cursor: 7 }), [
      makeWorld({ event_cursor: 12, world_time: 20 }),
      makeWorld({ event_cursor: 14, world_time: 24 }),
    ]);
    client.failNextWorld(new Error("world view missing"));

    const controller = startLiveRun({
      client,
      store,
      snapshotRefreshMs: 100,
      reconnectDelayMs: 100,
    });
    await controller.ready;

    expect(client.calls).toEqual(["run", "world"]);
    expect(client.streams).toHaveLength(0);
    expect(store.getState()).toMatchObject({
      run: expect.objectContaining({ event_cursor: 7 }),
      snapshot: null,
      eventCursor: 7,
      connection: "error",
      lastError: "world view missing",
    });

    await vi.advanceTimersByTimeAsync(100);

    expect(client.calls).toEqual(["run", "world", "run", "world", "stream:12"]);
    expect(client.streams).toHaveLength(1);
    expect(client.streams[0].cursor).toBe(12);
    expect(store.getState()).toMatchObject({
      eventCursor: 12,
      needsSnapshot: false,
      connection: "live",
      lastError: null,
    });
    expect(store.getState().snapshot?.world_time).toBe(20);

    await vi.advanceTimersByTimeAsync(100);

    expect(client.calls).toEqual(["run", "world", "run", "world", "stream:12", "world"]);
    expect(client.streams).toHaveLength(1);
    expect(store.getState()).toMatchObject({
      eventCursor: 14,
      needsSnapshot: false,
      connection: "live",
      lastError: null,
    });
    expect(store.getState().snapshot?.world_time).toBe(24);

    controller.stop();
  });

  it("retries stale first world views until one reaches the run cursor", async () => {
    vi.useFakeTimers();
    const store = createWorldStore();
    const client = new FakeClient(makeRun({ event_cursor: 9 }), [
      makeWorld({ event_cursor: 7, world_time: 18 }),
      makeWorld({ event_cursor: 10, world_time: 21 }),
    ]);

    const controller = startLiveRun({
      client,
      store,
      snapshotRefreshMs: 0,
      reconnectDelayMs: 100,
    });
    await controller.ready;

    expect(client.calls).toEqual(["run", "world"]);
    expect(client.streams).toHaveLength(0);
    expect(store.getState()).toMatchObject({
      eventCursor: 9,
      snapshot: null,
      connection: "error",
      lastError: "Fresh world view was older than the live trail",
    });

    await vi.advanceTimersByTimeAsync(100);

    expect(client.calls).toEqual(["run", "world", "run", "world", "stream:10"]);
    expect(client.streams).toHaveLength(1);
    expect(client.streams[0].cursor).toBe(10);
    expect(store.getState()).toMatchObject({
      eventCursor: 10,
      needsSnapshot: false,
      connection: "live",
      lastError: null,
    });
    expect(store.getState().snapshot?.world_time).toBe(21);

    controller.stop();
  });

  it("refreshes the snapshot and reconnects from its cursor after overflow", async () => {
    const store = createWorldStore();
    const client = new FakeClient(makeRun(), [
      makeWorld({ event_cursor: 4 }),
      makeWorld({ event_cursor: 12, world_time: 20 }),
    ]);

    const controller = startLiveRun({ client, store, snapshotRefreshMs: 0 });
    await controller.ready;
    await client.streams[0].emit(
      makeEventEnvelope({
        overflow: true,
        snapshot_required: true,
        next_cursor: 10,
      }),
    );

    expect(client.calls).toEqual(["run", "world", "stream:4", "run", "world", "stream:12"]);
    expect(client.streams[0].closed).toBe(true);
    expect(store.getState().needsSnapshot).toBe(false);
    expect(store.getState().eventCursor).toBe(12);
    expect(store.getState().snapshot?.world_time).toBe(20);

    controller.stop();
  });

  it("lets periodic refresh complete snapshot recovery and reopen the stream", async () => {
    vi.useFakeTimers();
    const store = createWorldStore();
    const client = new FakeClient(makeRun(), [
      makeWorld({ event_cursor: 4 }),
      makeWorld({ event_cursor: 12, world_time: 20 }),
    ]);

    const controller = startLiveRun({
      client,
      store,
      snapshotRefreshMs: 100,
      reconnectDelayMs: 1000,
    });
    await controller.ready;
    client.failNextWorld(new Error("world refresh paused"));
    await client.streams[0].emit(
      makeEventEnvelope({
        cursor: 4,
        oldest_cursor: 2,
        overflow: true,
        snapshot_required: true,
        next_cursor: 10,
      }),
    );

    expect(client.calls).toEqual(["run", "world", "stream:4", "run", "world"]);
    expect(client.streams[0].closed).toBe(true);
    expect(store.getState()).toMatchObject({
      eventCursor: 10,
      needsSnapshot: true,
      connection: "error",
      lastError: "world refresh paused",
    });

    await vi.advanceTimersByTimeAsync(100);

    expect(client.calls).toEqual([
      "run",
      "world",
      "stream:4",
      "run",
      "world",
      "run",
      "world",
      "stream:12",
    ]);
    expect(client.streams).toHaveLength(2);
    expect(client.streams[1].cursor).toBe(12);
    expect(store.getState()).toMatchObject({
      eventCursor: 12,
      needsSnapshot: false,
      connection: "live",
      lastError: null,
    });

    controller.stop();
  });

  it("leaves retained gaps visible when recovery refresh fails", async () => {
    const store = createWorldStore();
    const client = new FakeClient(makeRun(), [makeWorld({ event_cursor: 4 })]);

    const controller = startLiveRun({ client, store, snapshotRefreshMs: 0 });
    await controller.ready;
    client.failNextWorld(new Error("world refresh paused"));
    await client.streams[0].emit(
      makeEventEnvelope({
        cursor: 4,
        oldest_cursor: 2,
        overflow: true,
        snapshot_required: true,
        next_cursor: 10,
      }),
    );

    expect(client.calls).toEqual(["run", "world", "stream:4", "run", "world"]);
    expect(client.streams).toHaveLength(1);
    expect(client.streams[0].closed).toBe(true);
    expect(store.getState()).toMatchObject({
      eventCursor: 10,
      needsSnapshot: true,
      connection: "error",
      lastError: "world refresh paused",
    });
    expect(store.getState().chronicleHistory[0]).toMatchObject({
      kind: "gap",
      reason: "overflow",
      message: "The live trail moved ahead; a fresh world view was requested.",
    });

    await client.streams[0].emit(
      makeEventEnvelope({
        cursor: 10,
        next_cursor: 11,
        events: [
          {
            ...makeEventEnvelope().events[0],
            cursor: 11,
          },
        ],
      }),
    );

    expect(store.getState()).toMatchObject({
      eventCursor: 10,
      needsSnapshot: true,
      connection: "error",
      lastError: "world refresh paused",
    });

    controller.stop();
  });

  it("reports passive and recovery snapshot refreshes while they are in flight", async () => {
    vi.useFakeTimers();
    const store = createWorldStore();
    const client = new FakeClient(makeRun(), [makeWorld({ event_cursor: 4 })]);

    const controller = startLiveRun({
      client,
      store,
      snapshotRefreshMs: 100,
      reconnectDelayMs: 100,
    });
    await controller.ready;

    const passiveRefresh = client.deferNextWorld();
    await vi.advanceTimersByTimeAsync(100);

    expect(controller.diagnostics()).toMatchObject({
      connection: "live",
      refreshInFlight: "passive",
      recoveryRefreshInFlight: false,
      stream: { active: true, cursor: 4 },
      lastSnapshotRefresh: {
        status: "started",
        reconnect: false,
        cursor: null,
        error: null,
      },
    });

    passiveRefresh.resolve(makeWorld({ event_cursor: 5, world_time: 20 }));
    await vi.advanceTimersByTimeAsync(0);

    expect(controller.diagnostics()).toMatchObject({
      refreshInFlight: "none",
      recoveryRefreshInFlight: false,
      eventCursor: 5,
      lastAcceptedSnapshotCursor: 5,
      lastSnapshotRefresh: {
        status: "applied",
        reconnect: false,
        cursor: 5,
        error: null,
      },
    });
    expect(client.streams).toHaveLength(1);

    const recoveryRefresh = client.deferNextWorld();
    const recoveryEnvelope = makeEventEnvelope({
      cursor: 5,
      oldest_cursor: 2,
      overflow: true,
      snapshot_required: true,
      next_cursor: 10,
    });
    const recovery = client.streams[0].emit(recoveryEnvelope);

    expect(controller.diagnostics()).toMatchObject({
      refreshInFlight: "recovery",
      recoveryRefreshInFlight: true,
      eventCursor: 10,
      needsSnapshot: true,
      stream: { active: false, cursor: null, url: null, serial: null },
      lastSnapshotRefresh: {
        status: "started",
        reconnect: true,
        cursor: null,
        error: null,
      },
    });

    recoveryRefresh.resolve(makeWorld({ event_cursor: 12, world_time: 24 }));
    await recovery;

    expect(controller.diagnostics()).toMatchObject({
      refreshInFlight: "none",
      recoveryRefreshInFlight: false,
      eventCursor: 12,
      needsSnapshot: false,
      stream: {
        active: true,
        cursor: 12,
        url: "/api/events/stream?cursor=12",
        serial: 2,
      },
      lastAcceptedSnapshotCursor: 12,
    });

    controller.stop();
  });

  it("keeps a healthy stream live when a passive snapshot refresh fails", async () => {
    vi.useFakeTimers();
    const store = createWorldStore();
    const client = new FakeClient(makeRun(), [makeWorld({ event_cursor: 4 })]);

    const controller = startLiveRun({
      client,
      store,
      snapshotRefreshMs: 100,
    });
    await controller.ready;
    client.failNextWorld(new Error("world unavailable"));
    await vi.advanceTimersByTimeAsync(100);

    expect(controller.diagnostics()).toMatchObject({
      connection: "live",
      eventCursor: 4,
      needsSnapshot: false,
      stream: {
        active: true,
        cursor: 4,
        url: "/api/events/stream?cursor=4",
        serial: 1,
      },
      refreshInFlight: "none",
      lastAcceptedSnapshotCursor: 4,
      lastSnapshotRefresh: {
        status: "failed",
        reconnect: false,
        cursor: null,
        error: "world unavailable",
      },
    });
    expect(store.getState()).toMatchObject({
      connection: "live",
      lastError: null,
    });
    expect(client.streams).toHaveLength(1);

    controller.stop();
  });

  it("ignores an older passive refresh result after recovery has started", async () => {
    vi.useFakeTimers();
    const store = createWorldStore();
    const client = new FakeClient(makeRun(), [makeWorld({ event_cursor: 4 })]);

    const controller = startLiveRun({
      client,
      store,
      snapshotRefreshMs: 100,
      reconnectDelayMs: 100,
    });
    await controller.ready;

    const passiveRefresh = client.deferNextWorld();
    await vi.advanceTimersByTimeAsync(100);
    expect(controller.diagnostics()).toMatchObject({
      refreshInFlight: "passive",
      stream: { active: true, cursor: 4 },
    });

    const recoveryRefresh = client.deferNextWorld();
    const recovery = client.streams[0].emit(
      makeEventEnvelope({
        cursor: 4,
        oldest_cursor: 2,
        overflow: true,
        snapshot_required: true,
        next_cursor: 10,
      }),
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(controller.diagnostics()).toMatchObject({
      refreshInFlight: "recovery",
      recoveryRefreshInFlight: true,
      eventCursor: 10,
      needsSnapshot: true,
      stream: { active: false, cursor: null, url: null },
      lastAcceptedSnapshotCursor: 4,
    });

    passiveRefresh.resolve(makeWorld({ event_cursor: 99, world_time: 50 }));
    await vi.advanceTimersByTimeAsync(0);

    expect(controller.diagnostics()).toMatchObject({
      refreshInFlight: "recovery",
      recoveryRefreshInFlight: true,
      eventCursor: 10,
      needsSnapshot: true,
      stream: { active: false, cursor: null, url: null },
      timers: { recoveryRetry: false },
      lastAcceptedSnapshotCursor: 4,
      lastSnapshotRefresh: {
        status: "started",
        reconnect: true,
        cursor: null,
        error: null,
      },
    });

    recoveryRefresh.resolve(makeWorld({ event_cursor: 12, world_time: 24 }));
    await recovery;

    expect(controller.diagnostics()).toMatchObject({
      refreshInFlight: "none",
      recoveryRefreshInFlight: false,
      eventCursor: 12,
      needsSnapshot: false,
      stream: {
        active: true,
        cursor: 12,
        url: "/api/events/stream?cursor=12",
        serial: 2,
      },
      timers: {
        recoveryRetry: false,
      },
      lastAcceptedSnapshotCursor: 12,
      lastSnapshotRefresh: {
        status: "applied",
        reconnect: true,
        cursor: 12,
        error: null,
      },
    });
    expect(client.calls).toEqual([
      "run",
      "world",
      "stream:4",
      "world",
      "run",
      "world",
      "stream:12",
    ]);

    controller.stop();
  });

  it("keeps reconnecting when a passive refresh resolves after the stream drops", async () => {
    vi.useFakeTimers();
    const store = createWorldStore();
    const client = new FakeClient(makeRun(), [makeWorld({ event_cursor: 4 })]);

    const controller = startLiveRun({
      client,
      store,
      snapshotRefreshMs: 100,
      reconnectDelayMs: 80,
    });
    await controller.ready;

    const passiveRefresh = client.deferNextWorld();
    await vi.advanceTimersByTimeAsync(100);
    client.streams[0].fail(new Error("socket closed"));

    expect(controller.diagnostics()).toMatchObject({
      connection: "reconnecting",
      stream: { active: false, cursor: null, url: null },
      timers: { reconnect: true },
      refreshInFlight: "passive",
    });

    passiveRefresh.resolve(makeWorld({ event_cursor: 9, world_time: 20 }));
    await vi.advanceTimersByTimeAsync(0);

    expect(controller.diagnostics()).toMatchObject({
      connection: "reconnecting",
      eventCursor: 9,
      needsSnapshot: false,
      stream: { active: false, cursor: null, url: null },
      timers: { reconnect: true },
      refreshInFlight: "none",
      lastAcceptedSnapshotCursor: 9,
      lastSnapshotRefresh: {
        status: "applied",
        reconnect: false,
        cursor: 9,
        error: null,
      },
    });

    await vi.advanceTimersByTimeAsync(80);

    expect(client.calls).toEqual(["run", "world", "stream:4", "world", "stream:9"]);
    expect(controller.diagnostics()).toMatchObject({
      connection: "reconnecting",
      stream: {
        active: true,
        cursor: 9,
        url: "/api/events/stream?cursor=9",
        serial: 2,
      },
      timers: { reconnect: false },
    });

    await client.streams[1].emit(makeEventEnvelope({ cursor: 9, next_cursor: 10 }));

    expect(controller.diagnostics()).toMatchObject({
      connection: "live",
      eventCursor: 10,
      stream: {
        active: true,
        cursor: 9,
        serial: 2,
      },
    });

    controller.stop();
  });

  it("keeps reconnecting when a passive refresh fails after the stream drops", async () => {
    vi.useFakeTimers();
    const store = createWorldStore();
    const client = new FakeClient(makeRun(), [makeWorld({ event_cursor: 4 })]);

    const controller = startLiveRun({
      client,
      store,
      snapshotRefreshMs: 100,
      reconnectDelayMs: 80,
    });
    await controller.ready;

    const passiveRefresh = client.deferNextWorld();
    await vi.advanceTimersByTimeAsync(100);
    client.streams[0].fail(new Error("socket closed"));

    passiveRefresh.reject(new Error("world unavailable"));
    await vi.advanceTimersByTimeAsync(0);

    expect(controller.diagnostics()).toMatchObject({
      connection: "reconnecting",
      eventCursor: 4,
      needsSnapshot: false,
      stream: { active: false, cursor: null, url: null },
      timers: { reconnect: true },
      refreshInFlight: "none",
      lastAcceptedSnapshotCursor: 4,
      lastSnapshotRefresh: {
        status: "failed",
        reconnect: false,
        cursor: null,
        error: "world unavailable",
      },
    });

    await vi.advanceTimersByTimeAsync(80);

    expect(client.calls).toEqual(["run", "world", "stream:4", "world", "stream:4"]);
    expect(controller.diagnostics()).toMatchObject({
      connection: "reconnecting",
      stream: {
        active: true,
        cursor: 4,
        url: "/api/events/stream?cursor=4",
        serial: 2,
      },
      timers: { reconnect: false },
    });

    await client.streams[1].emit(makeEventEnvelope({ cursor: 4, next_cursor: 5 }));

    expect(controller.diagnostics()).toMatchObject({
      connection: "live",
      eventCursor: 5,
      stream: {
        active: true,
        cursor: 4,
        serial: 2,
      },
    });

    controller.stop();
  });

  it("retries failed snapshot recovery and resumes from the accepted snapshot cursor", async () => {
    vi.useFakeTimers();
    const store = createWorldStore();
    const client = new FakeClient(makeRun(), [
      makeWorld({ event_cursor: 4 }),
      makeWorld({ event_cursor: 12, world_time: 20 }),
    ]);

    const controller = startLiveRun({
      client,
      store,
      snapshotRefreshMs: 0,
      reconnectDelayMs: 100,
    });
    await controller.ready;
    client.failNextWorld(new Error("world refresh paused"));
    await client.streams[0].emit(
      makeEventEnvelope({
        cursor: 4,
        oldest_cursor: 2,
        overflow: true,
        snapshot_required: true,
        next_cursor: 10,
      }),
    );

    expect(client.calls).toEqual(["run", "world", "stream:4", "run", "world"]);
    expect(client.streams[0].closed).toBe(true);
    expect(store.getState()).toMatchObject({
      eventCursor: 10,
      needsSnapshot: true,
      connection: "error",
      lastError: "world refresh paused",
    });

    await vi.advanceTimersByTimeAsync(100);

    expect(client.calls).toEqual([
      "run",
      "world",
      "stream:4",
      "run",
      "world",
      "run",
      "world",
      "stream:12",
    ]);
    expect(client.streams).toHaveLength(2);
    expect(client.streams[1].cursor).toBe(12);
    expect(store.getState()).toMatchObject({
      eventCursor: 12,
      needsSnapshot: false,
      connection: "live",
      lastError: null,
    });
    expect(store.getState().snapshot?.world_time).toBe(20);

    client.streams[0].fail(new Error("closed stream late error"));
    await client.streams[0].emit(
      makeEventEnvelope({
        cursor: 12,
        next_cursor: 20,
        snapshot_required: true,
      }),
    );

    expect(client.calls).toEqual([
      "run",
      "world",
      "stream:4",
      "run",
      "world",
      "run",
      "world",
      "stream:12",
    ]);
    expect(client.streams).toHaveLength(2);
    expect(client.streams[1].closed).toBe(false);
    expect(store.getState()).toMatchObject({
      eventCursor: 12,
      needsSnapshot: false,
      connection: "live",
      lastError: null,
    });

    controller.stop();
  });

  it("does not reconnect from a stale recovery snapshot", async () => {
    const store = createWorldStore();
    const client = new FakeClient(makeRun(), [
      makeWorld({ event_cursor: 4 }),
      makeWorld({ event_cursor: 8, world_time: 19 }),
    ]);

    const controller = startLiveRun({ client, store, snapshotRefreshMs: 0 });
    await controller.ready;
    await client.streams[0].emit(
      makeEventEnvelope({
        cursor: 4,
        oldest_cursor: 2,
        overflow: true,
        snapshot_required: true,
        next_cursor: 10,
      }),
    );

    expect(client.calls).toEqual(["run", "world", "stream:4", "run", "world"]);
    expect(client.streams).toHaveLength(1);
    expect(client.streams[0].closed).toBe(true);
    expect(store.getState()).toMatchObject({
      eventCursor: 10,
      needsSnapshot: true,
      connection: "error",
      lastError: "Fresh world view was older than the live trail",
    });

    controller.stop();
  });

  it("retries stale recovery snapshots until a fresh world view arrives", async () => {
    vi.useFakeTimers();
    const store = createWorldStore();
    const client = new FakeClient(makeRun(), [
      makeWorld({ event_cursor: 4 }),
      makeWorld({ event_cursor: 8, world_time: 19 }),
      makeWorld({ event_cursor: 13, world_time: 21 }),
    ]);

    const controller = startLiveRun({
      client,
      store,
      snapshotRefreshMs: 0,
      reconnectDelayMs: 100,
    });
    await controller.ready;
    await client.streams[0].emit(
      makeEventEnvelope({
        cursor: 4,
        oldest_cursor: 2,
        overflow: true,
        snapshot_required: true,
        next_cursor: 10,
      }),
    );

    expect(store.getState()).toMatchObject({
      eventCursor: 10,
      needsSnapshot: true,
      connection: "error",
      lastError: "Fresh world view was older than the live trail",
    });
    expect(client.streams[0].closed).toBe(true);

    await vi.advanceTimersByTimeAsync(100);

    expect(client.calls).toEqual([
      "run",
      "world",
      "stream:4",
      "run",
      "world",
      "run",
      "world",
      "stream:13",
    ]);
    expect(client.streams).toHaveLength(2);
    expect(client.streams[1].cursor).toBe(13);
    expect(store.getState()).toMatchObject({
      eventCursor: 13,
      needsSnapshot: false,
      connection: "live",
      lastError: null,
    });
    expect(store.getState().snapshot?.world_time).toBe(21);

    controller.stop();
  });

  it("exposes debug-only diagnostics across repeated recovery cycles", async () => {
    vi.useFakeTimers();
    const store = createWorldStore();
    const client = new FakeClient(makeRun(), [
      makeWorld({ event_cursor: 4 }),
      makeWorld({ event_cursor: 12, world_time: 20 }),
      makeWorld({ event_cursor: 18, world_time: 24 }),
      makeWorld({ event_cursor: 22, world_time: 28 }),
    ]);

    const controller = startLiveRun({
      client,
      store,
      snapshotRefreshMs: 0,
      reconnectDelayMs: 100,
    });
    await controller.ready;

    expect(window.__vivariumLiveRun?.diagnostics()).toMatchObject({
      stream: {
        active: true,
        cursor: 4,
        url: "/api/events/stream?cursor=4",
        serial: 1,
      },
      timers: {
        periodicRefresh: false,
        reconnect: false,
        recoveryRetry: false,
      },
      refreshInFlight: "none",
      lastAcceptedSnapshotCursor: 4,
      lastRejectedSnapshotCursor: null,
      lastRejectedSnapshotReason: null,
      ignoredStaleStreamCallbackCount: 0,
    });

    client.failNextWorld(new Error("world refresh paused"));
    await client.streams[0].emit(
      makeEventEnvelope({
        cursor: 4,
        oldest_cursor: 2,
        overflow: true,
        snapshot_required: true,
        next_cursor: 10,
      }),
    );

    expect(controller.diagnostics()).toMatchObject({
      eventCursor: 10,
      needsSnapshot: true,
      stream: {
        active: false,
        cursor: null,
        url: null,
      },
      timers: {
        recoveryRetry: true,
      },
      refreshInFlight: "none",
      recoveryRefreshInFlight: false,
      lastAcceptedSnapshotCursor: 4,
      lastRejectedSnapshotCursor: null,
      lastRejectedSnapshotReason: null,
      lastSnapshotRefresh: {
        status: "failed",
        reconnect: true,
        cursor: null,
        error: "world refresh paused",
      },
    });

    await vi.advanceTimersByTimeAsync(100);

    expect(controller.diagnostics()).toMatchObject({
      eventCursor: 12,
      needsSnapshot: false,
      stream: {
        active: true,
        cursor: 12,
        url: "/api/events/stream?cursor=12",
        serial: 2,
      },
      timers: {
        recoveryRetry: false,
      },
      lastAcceptedSnapshotCursor: 12,
      lastRejectedSnapshotCursor: null,
      lastSnapshotRefresh: {
        status: "applied",
        reconnect: true,
        cursor: 12,
        error: null,
      },
    });

    await client.streams[1].emit(
      makeEventEnvelope({
        cursor: 12,
        oldest_cursor: 8,
        overflow: true,
        snapshot_required: true,
        next_cursor: 20,
      }),
    );

    expect(controller.diagnostics()).toMatchObject({
      eventCursor: 20,
      needsSnapshot: true,
      stream: {
        active: false,
        cursor: null,
        url: null,
      },
      timers: {
        recoveryRetry: true,
      },
      lastAcceptedSnapshotCursor: 12,
      lastRejectedSnapshotCursor: 18,
      lastRejectedSnapshotReason: "Fresh world view was older than the live trail",
      lastSnapshotRefresh: {
        status: "rejected",
        reconnect: true,
        cursor: 18,
        error: "Fresh world view was older than the live trail",
      },
    });

    await vi.advanceTimersByTimeAsync(100);

    expect(controller.diagnostics()).toMatchObject({
      eventCursor: 22,
      needsSnapshot: false,
      stream: {
        active: true,
        cursor: 22,
        url: "/api/events/stream?cursor=22",
        serial: 3,
      },
      lastAcceptedSnapshotCursor: 22,
      lastRejectedSnapshotCursor: 18,
      lastRejectedSnapshotReason: "Fresh world view was older than the live trail",
      lastSnapshotRefresh: {
        status: "applied",
        reconnect: true,
        cursor: 22,
        error: null,
      },
    });

    const ignoredBefore = controller.diagnostics().ignoredStaleStreamCallbackCount;
    client.streams[0].fail(new Error("late old stream error"));
    await client.streams[0].emit(makeEventEnvelope({ cursor: 22, next_cursor: 30, snapshot_required: true }));
    client.streams[1].fail(new Error("late middle stream error"));
    await client.streams[1].emit(makeEventEnvelope({ cursor: 22, next_cursor: 31, snapshot_required: true }));

    expect(controller.diagnostics()).toMatchObject({
      eventCursor: 22,
      needsSnapshot: false,
      connection: "live",
      stream: {
        active: true,
        cursor: 22,
        serial: 3,
      },
      ignoredStaleStreamCallbackCount: ignoredBefore + 4,
    });
    expect(client.calls).toEqual([
      "run",
      "world",
      "stream:4",
      "run",
      "world",
      "run",
      "world",
      "stream:12",
      "run",
      "world",
      "run",
      "world",
      "stream:22",
    ]);

    controller.stop();

    expect(controller.diagnostics()).toMatchObject({
      stopped: true,
      connection: "offline",
      stream: {
        active: false,
        cursor: null,
        url: null,
      },
      timers: {
        periodicRefresh: false,
        reconnect: false,
        recoveryRetry: false,
      },
    });
    expect(window.__vivariumLiveRun).toBeUndefined();
  });

  it("keeps recovery paused when the old stream fails after refresh rejection", async () => {
    vi.useFakeTimers();
    const store = createWorldStore();
    const client = new FakeClient(makeRun(), [
      makeWorld({ event_cursor: 4 }),
      makeWorld({ event_cursor: 8, world_time: 19 }),
    ]);

    const controller = startLiveRun({
      client,
      store,
      snapshotRefreshMs: 0,
      reconnectDelayMs: 100,
    });
    await controller.ready;
    await client.streams[0].emit(
      makeEventEnvelope({
        cursor: 4,
        oldest_cursor: 2,
        overflow: true,
        snapshot_required: true,
        next_cursor: 10,
      }),
    );

    client.streams[0].fail(new Error("old stream closed"));
    await vi.advanceTimersByTimeAsync(100);

    expect(client.calls).toEqual([
      "run",
      "world",
      "stream:4",
      "run",
      "world",
      "run",
      "world",
    ]);
    expect(client.streams).toHaveLength(1);
    expect(store.getState()).toMatchObject({
      eventCursor: 10,
      needsSnapshot: true,
      connection: "error",
      lastError: "Fresh world view was older than the live trail",
    });

    controller.stop();
  });

  it("cancels pending recovery retries when stopped", async () => {
    vi.useFakeTimers();
    const store = createWorldStore();
    const client = new FakeClient(makeRun(), [makeWorld({ event_cursor: 4 })]);

    const controller = startLiveRun({
      client,
      store,
      snapshotRefreshMs: 0,
      reconnectDelayMs: 100,
    });
    await controller.ready;
    client.failNextWorld(new Error("world refresh paused"));
    await client.streams[0].emit(
      makeEventEnvelope({
        cursor: 4,
        oldest_cursor: 2,
        overflow: true,
        snapshot_required: true,
        next_cursor: 10,
      }),
    );

    controller.stop();
    await vi.advanceTimersByTimeAsync(100);

    expect(client.calls).toEqual(["run", "world", "stream:4", "run", "world"]);
    expect(store.getState().connection).toBe("offline");
  });


  it("marks EventSource errors as reconnecting before explicit retry", async () => {
    const store = createWorldStore();
    const client = new FakeClient();

    const controller = startLiveRun({ client, store, snapshotRefreshMs: 0 });
    await controller.ready;
    client.streams[0].fail(new Error("network gap"));

    expect(store.getState().connection).toBe("reconnecting");
    expect(store.getState().lastError).toBe("network gap");

    controller.stop();
  });

  it("reopens dropped SSE streams from the latest accepted cursor", async () => {
    vi.useFakeTimers();
    const store = createWorldStore();
    const client = new FakeClient(makeRun(), [makeWorld({ event_cursor: 4 })]);

    const controller = startLiveRun({
      client,
      store,
      snapshotRefreshMs: 0,
      reconnectDelayMs: 100,
    });
    await controller.ready;
    await client.streams[0].emit(makeEventEnvelope({ cursor: 4, next_cursor: 8 }));
    client.streams[0].fail(new Error("socket closed"));

    expect(client.streams[0].closed).toBe(true);
    expect(store.getState().eventCursor).toBe(8);
    expect(store.getState().connection).toBe("reconnecting");

    await vi.advanceTimersByTimeAsync(100);

    expect(client.calls).toEqual(["run", "world", "stream:4", "stream:8"]);
    expect(client.streams).toHaveLength(2);

    await client.streams[1].emit(makeEventEnvelope({ cursor: 8, next_cursor: 9 }));
    expect(store.getState()).toMatchObject({
      connection: "live",
      lastError: null,
      eventCursor: 9,
    });

    controller.stop();
  });

  it("refreshes snapshots periodically without reopening a healthy stream", async () => {
    vi.useFakeTimers();
    const store = createWorldStore();
    const client = new FakeClient(makeRun(), [
      makeWorld({ event_cursor: 4 }),
      makeWorld({ event_cursor: 9 }),
    ]);

    const controller = startLiveRun({ client, store, snapshotRefreshMs: 100 });
    await controller.ready;
    await vi.advanceTimersByTimeAsync(100);

    expect(client.calls).toEqual(["run", "world", "stream:4", "world"]);
    expect(store.getState().eventCursor).toBe(9);
    expect(client.streams).toHaveLength(1);

    controller.stop();
  });

  it("keeps a healthy stream live when a periodic snapshot is stale", async () => {
    vi.useFakeTimers();
    const store = createWorldStore();
    const client = new FakeClient(makeRun(), [
      makeWorld({ event_cursor: 4 }),
      makeWorld({ event_cursor: 5, world_time: 20 }),
      makeWorld({ event_cursor: 4, world_time: 21 }),
    ]);

    const controller = startLiveRun({ client, store, snapshotRefreshMs: 100 });
    await controller.ready;
    await client.streams[0].emit(makeEventEnvelope({ cursor: 4, next_cursor: 5 }));
    await vi.advanceTimersByTimeAsync(100);

    expect(store.getState()).toMatchObject({
      eventCursor: 5,
      needsSnapshot: false,
      connection: "live",
      lastError: null,
    });
    expect(store.getState().snapshot?.world_time).toBe(20);
    expect(client.streams).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(100);

    expect(store.getState()).toMatchObject({
      eventCursor: 5,
      needsSnapshot: false,
      connection: "live",
      lastError: null,
    });
    expect(store.getState().snapshot?.world_time).toBe(20);
    expect(client.streams).toHaveLength(1);

    controller.stop();
  });
});
