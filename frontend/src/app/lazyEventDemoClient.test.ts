import { describe, expect, it, vi } from "vitest";

import { makeEventEnvelope, makeRun, makeWorld } from "../test/fixtures";
import type {
  EventStream,
  EventStreamHandlers,
  LiveApiClient,
} from "./client";
import {
  createLazyEventDemoClient,
  isEventDemoSource,
} from "./lazyEventDemoClient";

interface Deferred<T> {
  promise: Promise<T>;
  reject(error: unknown): void;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let reject!: (error: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function fakeClient(overrides: Partial<LiveApiClient> = {}): LiveApiClient {
  return {
    getRun: vi.fn(async () => makeRun()),
    getWorld: vi.fn(async () => makeWorld()),
    getEvents: vi.fn(async () => makeEventEnvelope()),
    openEventStream: vi.fn((): EventStream => ({
      url: "event-demo://delegate",
      close: vi.fn(),
    })),
    ...overrides,
  };
}

describe("lazyEventDemoClient", () => {
  it("recognizes only the explicit event-demo source query", () => {
    expect(isEventDemoSource("?source=event-demo")).toBe(true);
    expect(isEventDemoSource("?source=live-api")).toBe(false);
    expect(isEventDemoSource("")).toBe(false);
  });

  it("loads one delegate lazily and shares it across request methods", async () => {
    const delegate = fakeClient();
    const load = vi.fn(async () => delegate);
    const client = createLazyEventDemoClient(load);

    expect(load).not.toHaveBeenCalled();
    await expect(client.getRun()).resolves.toEqual(makeRun());
    await expect(client.getWorld()).resolves.toEqual(makeWorld());
    await expect(client.getEvents(17)).resolves.toEqual(makeEventEnvelope());

    expect(load).toHaveBeenCalledTimes(1);
    expect(delegate.getRun).toHaveBeenCalledTimes(1);
    expect(delegate.getWorld).toHaveBeenCalledTimes(1);
    expect(delegate.getEvents).toHaveBeenCalledWith(17);
  });

  it("returns a synchronous stream facade and closes its attached delegate", async () => {
    const closeDelegate = vi.fn();
    const openEventStream = vi.fn(
      (_cursor: number, _handlers: EventStreamHandlers): EventStream => ({
        url: "event-demo://delegate",
        close: closeDelegate,
      }),
    );
    const client = createLazyEventDemoClient(async () => fakeClient({ openEventStream }));
    const handlers: EventStreamHandlers = { onEnvelope: vi.fn() };

    const stream = client.openEventStream(12, handlers);
    expect(stream.url).toBe("event-demo://events/stream?cursor=12");
    await vi.waitFor(() => expect(openEventStream).toHaveBeenCalledWith(12, handlers));

    stream.close();
    expect(closeDelegate).toHaveBeenCalledTimes(1);
  });

  it("does not open a late delegate after the facade has closed", async () => {
    const pending = deferred<LiveApiClient>();
    const openEventStream = vi.fn();
    const client = createLazyEventDemoClient(() => pending.promise);

    const stream = client.openEventStream(4, { onEnvelope: vi.fn() });
    stream.close();
    pending.resolve(fakeClient({ openEventStream }));
    await pending.promise;
    await Promise.resolve();

    expect(openEventStream).not.toHaveBeenCalled();
  });

  it("reports a rejected stream loader without an unhandled rejection", async () => {
    const pending = deferred<LiveApiClient>();
    const onError = vi.fn();
    const client = createLazyEventDemoClient(() => pending.promise);

    client.openEventStream(2, { onEnvelope: vi.fn(), onError });
    const error = new Error("demo chunk unavailable");
    pending.reject(error);

    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(error));
  });

  it("reports a synchronous delegate stream-open failure exactly once", async () => {
    const error = new Error("delegate stream failed to open");
    const onError = vi.fn();
    const openEventStream = vi.fn((): EventStream => {
      throw error;
    });
    const client = createLazyEventDemoClient(async () => fakeClient({ openEventStream }));

    client.openEventStream(8, { onEnvelope: vi.fn(), onError });

    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce());
    expect(onError).toHaveBeenCalledWith(error);
    expect(openEventStream).toHaveBeenCalledOnce();
  });

  it("does not open or report a synchronous delegate failure after early close", async () => {
    const pending = deferred<LiveApiClient>();
    const onError = vi.fn();
    const openEventStream = vi.fn((): EventStream => {
      throw new Error("closed facade must never reach this delegate");
    });
    const client = createLazyEventDemoClient(() => pending.promise);

    const stream = client.openEventStream(9, { onEnvelope: vi.fn(), onError });
    stream.close();
    pending.resolve(fakeClient({ openEventStream }));
    await pending.promise;
    await Promise.resolve();

    expect(openEventStream).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
