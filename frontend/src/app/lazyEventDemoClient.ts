import type {
  EventStream,
  EventStreamHandlers,
  LiveApiClient,
} from "./client";

const EVENT_DEMO_SOURCE_QUERY_VALUE = "event-demo";

export type EventDemoClientLoader = () => Promise<LiveApiClient>;

export function isEventDemoSource(search: string): boolean {
  return new URLSearchParams(search).get("source") === EVENT_DEMO_SOURCE_QUERY_VALUE;
}

export function createLazyEventDemoClient(
  loadClient: EventDemoClientLoader = loadEventDemoClient,
): LiveApiClient {
  let delegatePromise: Promise<LiveApiClient> | null = null;
  const delegate = (): Promise<LiveApiClient> => {
    delegatePromise ??= loadClient();
    return delegatePromise;
  };

  return {
    getRun: async () => (await delegate()).getRun(),
    getWorld: async () => (await delegate()).getWorld(),
    getEvents: async (cursor) => (await delegate()).getEvents(cursor),
    openEventStream(cursor, handlers): EventStream {
      let closed = false;
      let stream: EventStream | null = null;
      void delegate().then(
        (client) => {
          if (!closed) {
            try {
              stream = client.openEventStream(cursor, handlers);
            } catch (error) {
              handlers.onError?.(error);
            }
          }
        },
        (error: unknown) => {
          if (!closed) {
            handlers.onError?.(error);
          }
        },
      );
      return {
        url: `event-demo://events/stream?cursor=${cursor}`,
        close(): void {
          if (closed) {
            return;
          }
          closed = true;
          stream?.close();
        },
      };
    },
  };
}

async function loadEventDemoClient(): Promise<LiveApiClient> {
  const { createEventDemoClient } = await import("./eventDemoSource");
  return createEventDemoClient();
}
