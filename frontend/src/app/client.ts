import {
  type EventEnvelope,
  parseEventEnvelope,
  parseRunMetadata,
  parseWorldSnapshot,
  type RunMetadata,
  type WorldSnapshot,
} from "./schemas";

export type RunAcceptanceDisposition = "initial" | "same-run" | "replacement";

/** Classifies accepted metadata without treating same-run reconnects as resets. */
export function classifyRunAcceptance(
  currentRunId: string | null,
  acceptedRunId: string,
): RunAcceptanceDisposition {
  if (currentRunId === null) return "initial";
  return currentRunId === acceptedRunId ? "same-run" : "replacement";
}

export interface EventStream {
  readonly url?: string;
  close(): void;
}

/**
 * The backend's idle keepalive, emitted every `sse_heartbeat_interval` (15s).
 *
 * It carries no `id:` line, so it never rewrites `lastEventId` and never moves a
 * cursor — subscribing costs nothing and a client that ignores it is unaffected.
 * Without it, a world thinking in silence and a dead socket are the same picture.
 */
export interface EventStreamHeartbeat {
  readonly cursor: number;
  readonly worldTime: number;
  readonly status: string;
}

export interface EventStreamHandlers {
  onEnvelope(envelope: EventEnvelope): void | Promise<void>;
  onHeartbeat?(heartbeat: EventStreamHeartbeat): void;
  onError?(error: unknown): void;
}

export interface LiveApiClient {
  getRun(): Promise<RunMetadata>;
  getWorld(): Promise<WorldSnapshot>;
  getEvents(cursor: number): Promise<EventEnvelope>;
  openEventStream(cursor: number, handlers: EventStreamHandlers): EventStream;
}

export interface EventStreamSource {
  addEventListener(type: string, listener: (event: { data: string }) => void): void;
  close(): void;
  onerror: ((event: unknown) => void) | null;
}

export type EventStreamFactory = new (url: string) => EventStreamSource;

export interface HttpLiveApiClientOptions {
  baseUrl?: string;
  fetcher?: typeof globalThis.fetch;
  eventSourceFactory?: EventStreamFactory;
}

/** Structured HTTP failure shared by typed frontend API clients. */
export class HttpResponseError extends Error {
  readonly path: string;
  readonly status: number;

  constructor(path: string, status: number, message: string) {
    super(message);
    this.name = "HttpResponseError";
    this.path = path;
    this.status = status;
  }
}

const HTTP_ERROR_DIAGNOSTIC_BYTE_LIMIT = 512;

/** Throws a structured failure while preserving bounded response context. */
export async function assertHttpResponseOk(
  response: Response,
  path: string,
): Promise<void> {
  if (response.ok) return;
  const detail = await readBoundedHttpErrorDetail(response);
  const suffix = detail.trim() ? `: ${trimHttpErrorDetail(detail)}` : "";
  throw new HttpResponseError(
    path,
    response.status,
    `${path} returned HTTP ${response.status}${suffix}`,
  );
}

async function readBoundedHttpErrorDetail(response: Response): Promise<string> {
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytesRead = 0;

  try {
    while (bytesRead < HTTP_ERROR_DIAGNOSTIC_BYTE_LIMIT) {
      const result = await reader.read();
      if (result.done) {
        chunks.push(decoder.decode());
        return chunks.join("");
      }
      const remaining = HTTP_ERROR_DIAGNOSTIC_BYTE_LIMIT - bytesRead;
      const bounded = result.value.subarray(0, remaining);
      chunks.push(decoder.decode(bounded, { stream: true }));
      bytesRead += bounded.byteLength;
    }
    await reader.cancel().catch(() => undefined);
    chunks.push(decoder.decode());
    return chunks.join("");
  } catch {
    await reader.cancel().catch(() => undefined);
    return "";
  } finally {
    reader.releaseLock();
  }
}

export function createHttpLiveApiClient(
  options: HttpLiveApiClientOptions = {},
): LiveApiClient {
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis);
  const eventSourceFactory =
    options.eventSourceFactory ??
    ((globalThis.EventSource as unknown as EventStreamFactory | undefined) ??
      missingEventSourceFactory);
  return new HttpLiveApiClient(options.baseUrl ?? "", fetcher, eventSourceFactory);
}

class HttpLiveApiClient implements LiveApiClient {
  constructor(
    private readonly baseUrl: string,
    private readonly fetcher: typeof globalThis.fetch,
    private readonly eventSourceFactory: EventStreamFactory,
  ) {}

  async getRun(): Promise<RunMetadata> {
    return parseRunMetadata(await this.fetchJson("/api/run"));
  }

  async getWorld(): Promise<WorldSnapshot> {
    return parseWorldSnapshot(await this.fetchJson("/api/world"));
  }

  async getEvents(cursor: number): Promise<EventEnvelope> {
    return parseEventEnvelope(await this.fetchJson(`/api/events?cursor=${cursor}`));
  }

  openEventStream(cursor: number, handlers: EventStreamHandlers): EventStream {
    const url = this.url(`/api/events/stream?cursor=${cursor}`);
    const source = new this.eventSourceFactory(url);
    const handleMessage = (event: { data: string }) => {
      try {
        const envelope = parseEventEnvelope(JSON.parse(event.data));
        void Promise.resolve(handlers.onEnvelope(envelope)).catch((error: unknown) => {
          handlers.onError?.(error);
        });
      } catch (error) {
        handlers.onError?.(error);
      }
    };
    source.addEventListener("events", handleMessage);
    source.addEventListener("message", handleMessage);
    source.addEventListener("heartbeat", (event: { data: string }) => {
      if (handlers.onHeartbeat === undefined) return;
      // A malformed keepalive is not a stream failure — it proves the socket is
      // alive, which is the only thing a heartbeat is for.
      try {
        const parsed: unknown = JSON.parse(event.data);
        const record = parsed !== null && typeof parsed === "object"
          ? parsed as Record<string, unknown>
          : {};
        handlers.onHeartbeat({
          cursor: typeof record.cursor === "number" ? record.cursor : -1,
          worldTime: typeof record.world_time === "number" ? record.world_time : -1,
          status: typeof record.status === "string" ? record.status : "unknown",
        });
      } catch {
        handlers.onHeartbeat({ cursor: -1, worldTime: -1, status: "unknown" });
      }
    });
    source.onerror = (event: unknown) => {
      handlers.onError?.(event);
    };
    return {
      url,
      close: () => {
        source.close();
      },
    };
  }

  private async fetchJson(path: string): Promise<unknown> {
    const response = await this.fetcher(this.url(path), {
      headers: {
        Accept: "application/json",
      },
    });
    await assertHttpResponseOk(response, path);
    return response.json();
  }

  private url(path: string): string {
    return `${this.baseUrl}${path}`;
  }
}

class MissingEventSource {
  constructor() {
    throw new Error("EventSource is not available in this environment");
  }
}

const missingEventSourceFactory = MissingEventSource as unknown as EventStreamFactory;

function trimHttpErrorDetail(detail: string): string {
  const compact = detail.trim().replace(/\s+/g, " ");
  return compact.length > 200 ? `${compact.slice(0, 197)}...` : compact;
}
