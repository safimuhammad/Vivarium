import type { EventEnvelope, RunMetadata, WorldSnapshot } from "../app/schemas";
import {
  classifyRunAcceptance,
  type RunAcceptanceDisposition,
} from "../app/client";

export type { RunAcceptanceDisposition } from "../app/client";

export interface CanonicalWorldStoreSnapshot {
  readonly runId: string | null;
  readonly run: RunMetadata | null;
  readonly snapshot: WorldSnapshot | null;
  readonly ingestedCursor: number;
  readonly exactSnapshotCursor: number | null;
  readonly revision: number;
}

/** Owns newest accepted transport and exact checkpoint truth without presenting it. */
export class CanonicalWorldStore {
  private state: CanonicalWorldStoreSnapshot = emptySnapshot();
  private readonly listeners = new Set<() => void>();

  acceptRun(run: RunMetadata): RunAcceptanceDisposition {
    const disposition = classifyRunAcceptance(this.state.runId, run.run_id);
    if (disposition === "initial") {
      this.state = {
        ...this.state,
        runId: run.run_id,
        run,
        ingestedCursor: run.event_cursor,
      };
      this.publish();
      return "initial";
    }
    if (disposition === "replacement") {
      this.resetForRun(run);
      return "replacement";
    }
    this.state = {
      ...this.state,
      run,
      ingestedCursor: Math.max(this.state.ingestedCursor, run.event_cursor),
    };
    this.publish();
    return disposition;
  }

  acceptSnapshot(snapshot: WorldSnapshot): boolean {
    if (this.state.runId !== snapshot.run_id) return false;
    if (
      this.state.exactSnapshotCursor !== null
      && snapshot.event_cursor < this.state.exactSnapshotCursor
    ) {
      return false;
    }
    this.state = {
      ...this.state,
      snapshot,
      exactSnapshotCursor: snapshot.event_cursor,
      ingestedCursor: Math.max(this.state.ingestedCursor, snapshot.event_cursor),
    };
    this.publish();
    return true;
  }

  acceptEnvelope(envelope: EventEnvelope): boolean {
    if (this.state.runId === null) return false;
    const entryCursor = envelope.events.reduce(
      (newest, entry) => Math.max(newest, entry.cursor),
      envelope.next_cursor,
    );
    if (entryCursor <= this.state.ingestedCursor) return false;
    this.state = { ...this.state, ingestedCursor: entryCursor };
    this.publish();
    return true;
  }

  resetForRun(run: RunMetadata): void {
    this.state = {
      runId: run.run_id,
      run,
      snapshot: null,
      ingestedCursor: run.event_cursor,
      exactSnapshotCursor: null,
      revision: this.state.revision + 1,
    };
    this.publish();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): CanonicalWorldStoreSnapshot {
    return this.state;
  }

  private publish(): void {
    for (const listener of this.listeners) listener();
  }
}

export function createCanonicalWorldStore(): CanonicalWorldStore {
  return new CanonicalWorldStore();
}

function emptySnapshot(): CanonicalWorldStoreSnapshot {
  return {
    runId: null,
    run: null,
    snapshot: null,
    ingestedCursor: 0,
    exactSnapshotCursor: null,
    revision: 0,
  };
}
