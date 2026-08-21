import { useEffect, useMemo, useSyncExternalStore } from "react";

import {
  createHttpLiveApiClient,
  type EventStream,
  type LiveApiClient,
} from "./client";
import {
  createWorldStore,
  type WorldStore,
  type WorldStoreState,
} from "./store";
import type { EventEnvelope, RunMetadata, WorldSnapshot } from "./schemas";

export interface LiveRunOptions {
  client?: LiveApiClient;
  store?: WorldStore;
  snapshotRefreshMs?: number;
  reconnectDelayMs?: number;
  debugHandle?: LiveRunDebugHandle;
  readonly onRunAccepted?: StartLiveRunOptions["onRunAccepted"];
  readonly onEnvelopeAccepted?: StartLiveRunOptions["onEnvelopeAccepted"];
  readonly onSnapshotAccepted?: StartLiveRunOptions["onSnapshotAccepted"];
}

export interface LiveRunController {
  ready: Promise<void>;
  diagnostics(): LiveRunDiagnostics;
  stop(): void;
}

export interface StartLiveRunOptions {
  client: LiveApiClient;
  store: WorldStore;
  snapshotRefreshMs?: number;
  reconnectDelayMs?: number;
  debugHandle?: LiveRunDebugHandle;
  readonly onRunAccepted?: (
    run: RunMetadata,
    disposition: "initial" | "same-run" | "replacement",
  ) => void;
  readonly onEnvelopeAccepted?: (envelope: EventEnvelope) => void;
  readonly onSnapshotAccepted?: (snapshot: WorldSnapshot) => void;
}

export type LiveRunDebugHandle = "live" | "none";

export type SnapshotRefreshStatus = "idle" | "started" | "applied" | "rejected" | "failed";
export type SnapshotRefreshInFlight = "none" | "passive" | "recovery";

export interface SnapshotRefreshDiagnostics {
  status: SnapshotRefreshStatus;
  reconnect: boolean;
  cursor: number | null;
  error: string | null;
}

export interface LiveRunDiagnostics {
  stopped: boolean;
  connection: WorldStoreState["connection"];
  eventCursor: number;
  needsSnapshot: boolean;
  stream: {
    active: boolean;
    cursor: number | null;
    url: string | null;
    serial: number | null;
  };
  timers: {
    periodicRefresh: boolean;
    reconnect: boolean;
    recoveryRetry: boolean;
  };
  refreshInFlight: SnapshotRefreshInFlight;
  recoveryRefreshInFlight: boolean;
  lastOpenedStreamCursor: number | null;
  lastEnvelopeCursor: number | null;
  lastAcceptedSnapshotCursor: number | null;
  lastRejectedSnapshotCursor: number | null;
  lastRejectedSnapshotReason: string | null;
  lastSnapshotRefresh: SnapshotRefreshDiagnostics;
  lastStreamError: string | null;
  ignoredStaleStreamCallbackCount: number;
}

interface LiveRunDebugGlobal {
  diagnostics(): LiveRunDiagnostics;
  applyRunMetadataForTest(run: RunMetadata): void;
  refreshSnapshotForTest?: () => Promise<void>;
}

declare global {
  interface Window {
    __vivariumLiveRun?: LiveRunDebugGlobal;
    __vivariumEnableSnapshotRefreshForTest?: boolean;
  }
}

const defaultStore = createWorldStore();
const defaultClient = createHttpLiveApiClient();

export function useLiveRun(options: LiveRunOptions = {}): WorldStoreState {
  const store = options.store ?? defaultStore;
  const client = options.client ?? defaultClient;
  const snapshotRefreshMs = options.snapshotRefreshMs ?? 15_000;
  const reconnectDelayMs = options.reconnectDelayMs ?? 1_000;
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);

  useEffect(() => {
    const controller = startLiveRun({
      client,
      store,
      snapshotRefreshMs,
      reconnectDelayMs,
      debugHandle: options.debugHandle,
      onRunAccepted: options.onRunAccepted,
      onEnvelopeAccepted: options.onEnvelopeAccepted,
      onSnapshotAccepted: options.onSnapshotAccepted,
    });
    return () => {
      controller.stop();
    };
  }, [
    client,
    options.debugHandle,
    options.onEnvelopeAccepted,
    options.onRunAccepted,
    options.onSnapshotAccepted,
    reconnectDelayMs,
    snapshotRefreshMs,
    store,
  ]);

  return state;
}

export function useWorldStore(): WorldStore {
  return useMemo(() => createWorldStore(), []);
}

export function startLiveRun({
  client,
  store,
  snapshotRefreshMs = 15_000,
  reconnectDelayMs = 1_000,
  debugHandle = "live",
  onRunAccepted,
  onEnvelopeAccepted,
  onSnapshotAccepted,
}: StartLiveRunOptions): LiveRunController {
  let stopped = false;
  let stream: EventStream | null = null;
  let refreshTimer: number | undefined;
  let reconnectTimer: number | undefined;
  let recoveryRetryTimer: number | undefined;
  let recoveryRefreshInFlight = false;
  let recoveryRefreshGeneration: number | null = null;
  let refreshInFlight: SnapshotRefreshInFlight = "none";
  let streamSerial = 0;
  let refreshSerial = 0;
  let recoverySerial = 0;
  let activeStreamSerial: number | null = null;
  let activeStreamCursor: number | null = null;
  let activeStreamUrl: string | null = null;
  let lastOpenedStreamCursor: number | null = null;
  let lastEnvelopeCursor: number | null = null;
  let lastAcceptedSnapshotCursor: number | null = null;
  let lastRejectedSnapshotCursor: number | null = null;
  let lastRejectedSnapshotReason: string | null = null;
  let lastStreamError: string | null = null;
  let ignoredStaleStreamCallbackCount = 0;
  let lastSnapshotRefresh: SnapshotRefreshDiagnostics = {
    status: "idle",
    reconnect: false,
    cursor: null,
    error: null,
  };

  const diagnostics = (): LiveRunDiagnostics => {
    const current = store.getState();
    return {
      stopped,
      connection: current.connection,
      eventCursor: current.eventCursor,
      needsSnapshot: current.needsSnapshot,
      stream: {
        active: stream !== null,
        cursor: activeStreamCursor,
        url: activeStreamUrl,
        serial: activeStreamSerial,
      },
      timers: {
        periodicRefresh: refreshTimer !== undefined,
        reconnect: reconnectTimer !== undefined,
        recoveryRetry: recoveryRetryTimer !== undefined,
      },
      refreshInFlight,
      recoveryRefreshInFlight,
      lastOpenedStreamCursor,
      lastEnvelopeCursor,
      lastAcceptedSnapshotCursor,
      lastRejectedSnapshotCursor,
      lastRejectedSnapshotReason,
      lastSnapshotRefresh: { ...lastSnapshotRefresh },
      lastStreamError,
      ignoredStaleStreamCallbackCount,
    };
  };

  const debugGlobal: LiveRunDebugGlobal = {
    diagnostics,
    applyRunMetadataForTest(run: RunMetadata): void {
      const disposition = store.applyRun(run);
      if (disposition === "replacement") {
        recoverySerial += 1;
        clearActiveStream();
      }
      onRunAccepted?.(run, disposition);
    },
  };
  if (window.__vivariumEnableSnapshotRefreshForTest === true) {
    debugGlobal.refreshSnapshotForTest = async (): Promise<void> => {
      await refreshSnapshot({ reconnect: false });
    };
  }

  const publishDebugHandle = () => {
    if (debugHandle === "live") {
      window.__vivariumLiveRun = debugGlobal;
    }
  };

  const clearDebugHandle = () => {
    if (debugHandle === "live" && window.__vivariumLiveRun === debugGlobal) {
      window.__vivariumLiveRun = undefined;
    }
  };

  const clearActiveStream = () => {
    stream?.close();
    stream = null;
    activeStreamSerial = null;
    activeStreamCursor = null;
    activeStreamUrl = null;
  };

  const clearReconnectTimer = () => {
    if (reconnectTimer !== undefined) {
      window.clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
    }
  };

  const clearRecoveryRetryTimer = () => {
    if (recoveryRetryTimer !== undefined) {
      window.clearTimeout(recoveryRetryTimer);
      recoveryRetryTimer = undefined;
    }
  };

  const scheduleRecoveryRetry = () => {
    if (stopped || recoveryRetryTimer !== undefined) {
      return;
    }
    recoveryRetryTimer = window.setTimeout(() => {
      recoveryRetryTimer = undefined;
      void refreshSnapshot({ reconnect: true });
    }, reconnectDelayMs);
  };

  const ensurePeriodicRefresh = () => {
    if (snapshotRefreshMs > 0 && refreshTimer === undefined) {
      refreshTimer = window.setInterval(() => {
        void refreshSnapshot({ reconnect: store.getState().needsSnapshot });
      }, snapshotRefreshMs);
    }
  };

  const applyTransportSnapshot = (snapshot: WorldSnapshot): string | null => {
    const activeRunId = store.getState().run?.run_id;
    if (activeRunId !== undefined && snapshot.run_id !== activeRunId) {
      return "Fresh world view did not match the active run";
    }
    return store.applySnapshot(snapshot)
      ? null
      : "Fresh world view was older than the live trail";
  };

  const connect = (cursor: number) => {
    clearReconnectTimer();
    clearActiveStream();
    const nextStreamSerial = streamSerial + 1;
    streamSerial = nextStreamSerial;
    let openedStream: EventStream | null = null;
    const isCurrentStream = () => openedStream !== null && stream === openedStream;
    openedStream = client.openEventStream(cursor, {
      onEnvelope: async (envelope) => {
        if (stopped) {
          return;
        }
        if (!isCurrentStream()) {
          ignoredStaleStreamCallbackCount += 1;
          return;
        }
        lastEnvelopeCursor = envelope.next_cursor;
        onEnvelopeAccepted?.(envelope);
        store.applyEventEnvelope(envelope);
        if (envelope.snapshot_required || envelope.overflow) {
          await refreshSnapshot({ reconnect: true });
        } else if (!store.getState().needsSnapshot) {
          store.markConnection("live");
        }
      },
      onError: (error) => {
        if (stopped) {
          return;
        }
        if (!isCurrentStream()) {
          ignoredStaleStreamCallbackCount += 1;
          return;
        }
        lastStreamError = stringifyDiagnosticError(error);
        clearActiveStream();
        if (store.getState().needsSnapshot) {
          store.markConnection("error", error);
          scheduleRecoveryRetry();
          return;
        }
        store.markConnection("reconnecting", error);
        if (reconnectTimer === undefined) {
          reconnectTimer = window.setTimeout(() => {
            reconnectTimer = undefined;
            if (!stopped) {
              connect(store.getState().eventCursor);
            }
          }, reconnectDelayMs);
        }
      },
    });
    stream = openedStream;
    activeStreamSerial = nextStreamSerial;
    activeStreamCursor = cursor;
    activeStreamUrl = openedStream.url ?? null;
    lastOpenedStreamCursor = cursor;
  };

  const refreshSnapshot = async ({ reconnect }: { reconnect: boolean }) => {
    if (stopped) {
      return;
    }
    const reconnectAfterSnapshot = reconnect || store.getState().needsSnapshot;
    const refreshKind: "passive" | "recovery" = reconnectAfterSnapshot ? "recovery" : "passive";
    if (!reconnectAfterSnapshot && refreshInFlight === "passive") {
      return;
    }
    if (reconnectAfterSnapshot) {
      if (
        recoveryRefreshInFlight
        && recoveryRefreshGeneration === recoverySerial
      ) {
        return;
      }
      recoveryRefreshInFlight = true;
      recoverySerial += 1;
      recoveryRefreshGeneration = recoverySerial;
      clearRecoveryRetryTimer();
      clearReconnectTimer();
      clearActiveStream();
    }
    const refreshId = refreshSerial + 1;
    refreshSerial = refreshId;
    const recoveryGenerationAtStart = recoverySerial;
    refreshInFlight = refreshKind;
    lastSnapshotRefresh = {
      status: "started",
      reconnect: reconnectAfterSnapshot,
      cursor: null,
      error: null,
    };
    if (reconnectAfterSnapshot) {
      store.markConnection("reconnecting");
    }
    try {
      if (reconnectAfterSnapshot) {
        const run = await client.getRun();
        if (stopped || recoverySerial !== recoveryGenerationAtStart) {
          return;
        }
        const disposition = store.applyRun(run);
        onRunAccepted?.(run, disposition);
      }
      const snapshot = await client.getWorld();
      if (stopped || recoverySerial !== recoveryGenerationAtStart) {
        return;
      }
      const rejectionReason = applyTransportSnapshot(snapshot);
      if (rejectionReason !== null) {
        lastRejectedSnapshotCursor = snapshot.event_cursor;
        lastRejectedSnapshotReason = rejectionReason;
        lastSnapshotRefresh = {
          status: "rejected",
          reconnect: reconnectAfterSnapshot,
          cursor: snapshot.event_cursor,
          error: rejectionReason,
        };
        if (reconnectAfterSnapshot || store.getState().needsSnapshot) {
          store.markConnection(
            "error",
            new Error(rejectionReason),
          );
          scheduleRecoveryRetry();
        } else if (stream !== null) {
          store.markConnection("live");
        }
        return;
      }
      lastAcceptedSnapshotCursor = snapshot.event_cursor;
      onSnapshotAccepted?.(snapshot);
      lastSnapshotRefresh = {
        status: "applied",
        reconnect: reconnectAfterSnapshot,
        cursor: snapshot.event_cursor,
        error: null,
      };
      if (reconnectAfterSnapshot) {
        connect(store.getState().eventCursor);
      }
      ensurePeriodicRefresh();
      if (reconnectAfterSnapshot || stream !== null) {
        store.markConnection("live");
      }
    } catch (error) {
      if (stopped || recoverySerial !== recoveryGenerationAtStart) {
        return;
      }
      lastSnapshotRefresh = {
        status: "failed",
        reconnect: reconnectAfterSnapshot,
        cursor: null,
        error: stringifyDiagnosticError(error),
      };
      if (!stopped) {
        if (!reconnectAfterSnapshot && !store.getState().needsSnapshot) {
          return;
        }
        store.markConnection("error", error);
        if (reconnectAfterSnapshot || store.getState().needsSnapshot) {
          scheduleRecoveryRetry();
        }
      }
    } finally {
      if (
        reconnectAfterSnapshot
        && recoveryRefreshGeneration === recoveryGenerationAtStart
      ) {
        recoveryRefreshInFlight = false;
        recoveryRefreshGeneration = null;
      }
      if (refreshInFlight === refreshKind && refreshSerial === refreshId) {
        refreshInFlight = "none";
      }
    }
  };

  const ready = (async () => {
    const readyGenerationAtStart = recoverySerial;
    store.markConnection("connecting");
    try {
      const run = await client.getRun();
      if (stopped || recoverySerial !== readyGenerationAtStart) {
        return;
      }
      const disposition = store.applyRun(run);
      onRunAccepted?.(run, disposition);
      lastSnapshotRefresh = {
        status: "started",
        reconnect: false,
        cursor: null,
        error: null,
      };
      const snapshot = await client.getWorld();
      if (stopped || recoverySerial !== readyGenerationAtStart) {
        return;
      }
      const rejectionReason = applyTransportSnapshot(snapshot);
      if (rejectionReason !== null) {
        lastRejectedSnapshotCursor = snapshot.event_cursor;
        lastRejectedSnapshotReason = rejectionReason;
        lastSnapshotRefresh = {
          status: "rejected",
          reconnect: false,
          cursor: snapshot.event_cursor,
          error: rejectionReason,
        };
        store.markConnection(
          "error",
          new Error(rejectionReason),
        );
        scheduleRecoveryRetry();
        return;
      }
      lastAcceptedSnapshotCursor = snapshot.event_cursor;
      onSnapshotAccepted?.(snapshot);
      lastSnapshotRefresh = {
        status: "applied",
        reconnect: false,
        cursor: snapshot.event_cursor,
        error: null,
      };
      connect(store.getState().eventCursor);
      store.markConnection("live");
      ensurePeriodicRefresh();
    } catch (error) {
      if (!stopped && recoverySerial === readyGenerationAtStart) {
        if (store.getState().run && !store.getState().snapshot) {
          lastSnapshotRefresh = {
            status: "failed",
            reconnect: false,
            cursor: null,
            error: stringifyDiagnosticError(error),
          };
        }
        store.markConnection("error", error);
        if (store.getState().run && !store.getState().snapshot) {
          scheduleRecoveryRetry();
        }
      }
    }
  })();

  publishDebugHandle();

  return {
    ready,
    diagnostics,
    stop() {
      stopped = true;
      clearReconnectTimer();
      clearRecoveryRetryTimer();
      clearActiveStream();
      recoveryRefreshInFlight = false;
      recoveryRefreshGeneration = null;
      refreshInFlight = "none";
      if (refreshTimer !== undefined) {
        window.clearInterval(refreshTimer);
        refreshTimer = undefined;
      }
      clearDebugHandle();
      store.markConnection("offline");
    },
  };
}

function stringifyDiagnosticError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown live connection error";
}
