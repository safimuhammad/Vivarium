import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeEventEnvelope, makeRun, makeWorld } from "../test/fixtures";
import {
  assertHttpResponseOk,
  classifyRunAcceptance,
  createHttpLiveApiClient,
  type EventStreamSource,
  HttpResponseError,
} from "./client";
import { parseRunMetadata } from "./schemas";

class FakeEventSource implements EventStreamSource {
  static instances: FakeEventSource[] = [];

  readonly listeners = new Map<string, Array<(event: { data: string }) => void>>();
  closed = false;
  onerror: ((event: unknown) => void) | null = null;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: { data: string }) => void): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, data: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) });
    }
  }
}

describe("HttpLiveApiClient", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
  });

  it("classifies accepted run metadata with the exact reset disposition", () => {
    expect(classifyRunAcceptance(null, "run-a")).toBe("initial");
    expect(classifyRunAcceptance("run-a", "run-a")).toBe("same-run");
    expect(classifyRunAcceptance("run-a", "run-b")).toBe("replacement");
  });

  it("fetches and parses the live run, world, and event endpoints", async () => {
    const responses = new Map<string, unknown>([
      ["http://live.test/api/run", makeRun()],
      ["http://live.test/api/world", makeWorld()],
      ["http://live.test/api/events?cursor=4", makeEventEnvelope()],
    ]);
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      const body = responses.get(String(url));
      return new Response(JSON.stringify(body), { status: body ? 200 : 404 });
    }) as typeof fetch;
    const client = createHttpLiveApiClient({
      baseUrl: "http://live.test",
      fetcher,
      eventSourceFactory: FakeEventSource,
    });

    await expect(client.getRun()).resolves.toMatchObject({ run_id: "seed-7-test" });
    await expect(client.getWorld()).resolves.toMatchObject({ event_cursor: 4 });
    await expect(client.getEvents(4)).resolves.toMatchObject({ next_cursor: 5 });

    expect(fetcher).toHaveBeenNthCalledWith(
      1,
      "http://live.test/api/run",
      expect.objectContaining({ headers: { Accept: "application/json" } }),
    );
    expect(fetcher).toHaveBeenNthCalledWith(
      3,
      "http://live.test/api/events?cursor=4",
      expect.any(Object),
    );
  });

  it("reports failed HTTP responses", async () => {
    const fetcher = vi.fn(async () => new Response("missing", { status: 503 })) as typeof fetch;
    const client = createHttpLiveApiClient({ fetcher, eventSourceFactory: FakeEventSource });

    await expect(client.getRun()).rejects.toThrow("/api/run returned HTTP 503");
  });

  it("bounds and cancels streaming HTTP error bodies", async () => {
    const chunk = new TextEncoder().encode("x".repeat(64));
    const cancel = vi.fn();
    let pulls = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls <= 100) controller.enqueue(chunk);
        else controller.close();
      },
      cancel,
    });
    const response = new Response(body, { status: 503 });

    const error = await assertHttpResponseOk(response, "/api/run").catch(
      (caught: unknown) => caught,
    );

    expect(error).toBeInstanceOf(HttpResponseError);
    expect(error).toMatchObject({ path: "/api/run", status: 503 });
    expect((error as Error).message).toMatch(/^\/api\/run returned HTTP 503: x+\.\.\.$/);
    expect((error as Error).message.length).toBeLessThanOrEqual(235);
    expect(pulls).toBeLessThan(12);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("reports HTTP failures safely when the response body is unavailable", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error("body unavailable"));
      },
    });

    await expect(
      assertHttpResponseOk(new Response(body, { status: 503 }), "/api/run"),
    ).rejects.toMatchObject({
      path: "/api/run",
      status: 503,
      message: "/api/run returned HTTP 503",
    });
  });

  it("keeps run metadata usable when optional constants are missing or malformed", async () => {
    const withoutConstants = { ...makeRun() } as Record<string, unknown>;
    delete withoutConstants.constants;

    expect(parseRunMetadata(withoutConstants).constants).toEqual({});
    expect(
      parseRunMetadata({
        ...makeRun(),
        constants: {
          mating_cooldown_seconds: 45,
          ruins_persist_seconds: "bad",
          hoarding_energy_threshold: Number.NaN,
        },
      }).constants,
    ).toEqual({
      mating_cooldown_seconds: 45,
    });
  });

  it("opens an SSE stream at the requested cursor and parses event envelopes", () => {
    const envelope = makeEventEnvelope({
      events: [
        makeEventEnvelope().events[0],
        {
          ...makeEventEnvelope().events[0],
          cursor: 6,
          event: {
            ...makeEventEnvelope().events[0].event,
            type: "home_built",
          },
        },
      ],
      next_cursor: 6,
    });
    const onEnvelope = vi.fn();
    const client = createHttpLiveApiClient({
      baseUrl: "http://live.test",
      fetcher: vi.fn() as unknown as typeof fetch,
      eventSourceFactory: FakeEventSource,
    });

    const stream = client.openEventStream(4, { onEnvelope });
    const source = FakeEventSource.instances[0];
    source.emit("events", envelope);
    stream.close();

    expect(source.url).toBe("http://live.test/api/events/stream?cursor=4");
    expect(onEnvelope).toHaveBeenCalledWith(expect.objectContaining({ next_cursor: 6 }));
    expect(source.closed).toBe(true);
  });

  it("routes malformed SSE payloads to the error handler", () => {
    const onError = vi.fn();
    const client = createHttpLiveApiClient({
      fetcher: vi.fn() as unknown as typeof fetch,
      eventSourceFactory: FakeEventSource,
    });

    client.openEventStream(0, { onEnvelope: vi.fn(), onError });
    const source = FakeEventSource.instances[0];
    for (const listener of source.listeners.get("events") ?? []) {
      listener({ data: "not-json" });
    }

    expect(onError).toHaveBeenCalled();
  });
});
