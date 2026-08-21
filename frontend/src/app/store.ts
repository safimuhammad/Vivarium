import type {
  AgentSnapshot,
  EventEnvelope,
  EventEnvelopeEntry,
  HomeSnapshot,
  RegionSnapshot,
  RunMetadata,
  WorldSnapshot,
} from "./schemas";
import {
  classifyRunAcceptance,
  type RunAcceptanceDisposition,
} from "./client";

export type { RunAcceptanceDisposition } from "./client";

export type ConnectionState =
  | "idle"
  | "connecting"
  | "live"
  | "reconnecting"
  | "offline"
  | "error";

export interface WorldStoreState {
  run: RunMetadata | null;
  snapshot: WorldSnapshot | null;
  agentsById: Map<string, AgentSnapshot>;
  regionsByName: Map<string, RegionSnapshot>;
  homesById: Map<string, HomeSnapshot>;
  ruinsById: Map<string, HomeSnapshot>;
  pendingProposalCount: number;
  eventCursor: number;
  eventBeats: EventEnvelopeEntry[];
  chronicleHistory: ChronicleHistoryEntry[];
  needsSnapshot: boolean;
  connection: ConnectionState;
  lastError: string | null;
}

export type ChronicleGapReason = "overflow" | "snapshot_required";

export interface ChronicleHistoryGap {
  kind: "gap";
  id: string;
  reason: ChronicleGapReason;
  afterCursor: number;
  beforeCursor: number;
  nextCursor: number;
  message: string;
  timestamp: number | null;
}

export interface ChronicleHistoryEvent {
  kind: "event";
  entry: EventEnvelopeEntry;
}

export type ChronicleHistoryEntry = ChronicleHistoryEvent | ChronicleHistoryGap;

export interface WorldStore {
  getState(): WorldStoreState;
  subscribe(listener: () => void): () => void;
  applyRun(run: RunMetadata): RunAcceptanceDisposition;
  applySnapshot(snapshot: WorldSnapshot): boolean;
  applyEventEnvelope(envelope: EventEnvelope): void;
  markConnection(connection: ConnectionState, error?: unknown): void;
}

const MAX_EVENT_BEATS = 80;
const MAX_CHRONICLE_HISTORY = 600;

export function createWorldStore(): WorldStore {
  let state = emptyState();
  let replacementAwaitingSnapshot = false;
  const listeners = new Set<() => void>();

  function setState(next: WorldStoreState): void {
    state = next;
    for (const listener of listeners) {
      listener();
    }
  }

  return {
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    applyRun(run: RunMetadata) {
      const disposition = classifyRunAcceptance(state.run?.run_id ?? null, run.run_id);
      if (disposition === "replacement") {
        replacementAwaitingSnapshot = true;
        const reset = emptyState();
        setState({
          ...reset,
          run,
          eventCursor: run.event_cursor,
          connection: state.connection,
          lastError: state.lastError,
        });
        return disposition;
      }
      setState({
        ...state,
        run,
        eventCursor: Math.max(state.eventCursor, run.event_cursor),
      });
      return disposition;
    },
    applySnapshot(snapshot: WorldSnapshot) {
      const expectedRunId = replacementAwaitingSnapshot
        ? state.run?.run_id
        : state.snapshot?.run_id;
      if (expectedRunId !== undefined && snapshot.run_id !== expectedRunId) {
        return false;
      }
      if (snapshot.event_cursor < state.eventCursor) {
        return false;
      }
      setState({
        ...state,
        snapshot,
        agentsById: mapBy(snapshot.agents, (agent) => agent.id),
        regionsByName: mapBy(snapshot.regions, (region) => region.name),
        homesById: mapBy(snapshot.homes, (home) => home.home_id),
        ruinsById: mapBy(snapshot.ruins, (home) => home.home_id),
        pendingProposalCount: snapshot.pending_proposals.length,
        eventCursor: Math.max(state.eventCursor, snapshot.event_cursor),
        needsSnapshot: false,
      });
      replacementAwaitingSnapshot = false;
      return true;
    },
    applyEventEnvelope(envelope: EventEnvelope) {
      const eventBeats = [...state.eventBeats, ...envelope.events].slice(-MAX_EVENT_BEATS);
      const chronicleHistory = appendChronicleHistory(state.chronicleHistory, envelope);
      setState({
        ...state,
        eventCursor: Math.max(state.eventCursor, envelope.next_cursor),
        eventBeats,
        chronicleHistory,
        needsSnapshot: state.needsSnapshot || envelope.snapshot_required || envelope.overflow,
      });
    },
    markConnection(connection: ConnectionState, error?: unknown) {
      const lastError = error ? stringifyError(error) : null;
      if (state.connection === connection && state.lastError === lastError) {
        return;
      }
      setState({
        ...state,
        connection,
        lastError,
      });
    },
  };
}

function emptyState(): WorldStoreState {
  return {
    run: null,
    snapshot: null,
    agentsById: new Map(),
    regionsByName: new Map(),
    homesById: new Map(),
    ruinsById: new Map(),
    pendingProposalCount: 0,
    eventCursor: 0,
    eventBeats: [],
    chronicleHistory: [],
    needsSnapshot: false,
    connection: "idle",
    lastError: null,
  };
}

function appendChronicleHistory(
  history: ChronicleHistoryEntry[],
  envelope: EventEnvelope,
): ChronicleHistoryEntry[] {
  const next = [...history];
  const seen = new Set(next.map(historyKey));
  const gap = makeHistoryGap(envelope);

  if (gap && !seen.has(gap.id)) {
    next.push(gap);
    seen.add(gap.id);
  }

  for (const entry of envelope.events) {
    const item: ChronicleHistoryEvent = { kind: "event", entry };
    const key = historyKey(item);
    if (!seen.has(key)) {
      next.push(item);
      seen.add(key);
    }
  }

  return next.slice(-MAX_CHRONICLE_HISTORY);
}

function makeHistoryGap(envelope: EventEnvelope): ChronicleHistoryGap | null {
  if (!envelope.overflow && !envelope.snapshot_required) {
    return null;
  }
  const reason: ChronicleGapReason = envelope.overflow ? "overflow" : "snapshot_required";
  return {
    kind: "gap",
    id: `gap:${reason}:${envelope.cursor}:${envelope.oldest_cursor}:${envelope.next_cursor}`,
    reason,
    afterCursor: envelope.cursor,
    beforeCursor: envelope.oldest_cursor,
    nextCursor: envelope.next_cursor,
    message: reason === "overflow"
      ? "The live trail moved ahead; a fresh world view was requested."
      : "The live trail paused while a fresh world view was requested.",
    timestamp: envelope.events[0]?.event.timestamp ?? null,
  };
}

function historyKey(item: ChronicleHistoryEntry): string {
  return item.kind === "event" ? `event:${item.entry.cursor}` : item.id;
}

function mapBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T> {
  return new Map(items.map((item) => [keyFn(item), item]));
}

function stringifyError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "Unknown live connection error";
}
