import type { EventEnvelope, EventEnvelopeEntry, WorldSnapshot } from "../app/schemas";
import type {
  AcceptedEvidenceBatch,
  ClassifiedCheckpointRecord,
  PresentationIngressFault,
  PresentationIngressSnapshot,
} from "./contracts";

export interface PresentationIngress {
  onEnvelopeAccepted(envelope: EventEnvelope): void;
  onSnapshotAccepted(snapshot: WorldSnapshot): void;
  onCheckpointAccepted(record: ClassifiedCheckpointRecord): void;
  subscribe(listener: (batch: AcceptedEvidenceBatch) => void): () => void;
  getSnapshot(): PresentationIngressSnapshot;
  reset(identity: { runId: string; sourceKey: string; cursor: number }): void;
  dispose(): void;
}

// A live run can last forever, so diagnostics retain only the newest bounded fault window.
const MAX_RETAINED_INGRESS_FAULTS = 128;

/** Creates a lossless, identity-scoped accepted-evidence ingress. */
export function createPresentationIngress(): PresentationIngress {
  let disposed = false;
  let runId: string | null = null;
  let sourceKey: string | null = null;
  let ingestedCursor = 0;
  let acceptedCount = 0;
  let duplicateCount = 0;
  let gaps: PresentationIngressFault[] = [];
  const listeners = new Set<(batch: AcceptedEvidenceBatch) => void>();

  const retainFault = (
    retained: PresentationIngressFault[],
    fault: PresentationIngressFault,
  ): PresentationIngressFault[] => {
    if (
      retained.some(
        (existing) => existing.kind === fault.kind
          && existing.firstMissingCursor === fault.firstMissingCursor
          && existing.lastMissingCursor === fault.lastMissingCursor,
      )
    ) {
      return retained;
    }
    return [...retained, fault].slice(-MAX_RETAINED_INGRESS_FAULTS);
  };

  const recordFault = (fault: PresentationIngressFault): void => {
    gaps = retainFault(gaps, fault);
  };

  /**
   * Checks exact evidence against the accepted run identity.
   *
   * Returns `true` when the evidence belongs to this run, `false` when it does not (and records
   * the run-mismatch fault). It deliberately does NOT move `ingestedCursor` — see
   * {@link PresentationIngress.onCheckpointAccepted} for why that separation is load-bearing.
   */
  const acceptsExactEvidence = (acceptedRunId: string, cursor: number): boolean => {
    if (runId === null || acceptedRunId !== runId) {
      recordFault({
        kind: "run-mismatch",
        firstMissingCursor: cursor,
        lastMissingCursor: cursor,
      });
      return false;
    }
    return true;
  };

  return {
    onEnvelopeAccepted(envelope): void {
      if (disposed || runId === null || sourceKey === null) return;
      assertStrictlyIncreasingCursors(envelope.events);

      const acceptedEntries: EventEnvelopeEntry[] = [];
      let nextIngestedCursor = ingestedCursor;
      let nextAcceptedCount = acceptedCount;
      let nextDuplicateCount = duplicateCount;
      let nextGaps = gaps;
      for (const entry of envelope.events) {
        if (entry.cursor <= nextIngestedCursor) {
          nextDuplicateCount += 1;
          continue;
        }
        if (entry.cursor > nextIngestedCursor + 1) {
          nextGaps = retainFault(nextGaps, {
            kind: "cursor-gap",
            firstMissingCursor: nextIngestedCursor + 1,
            lastMissingCursor: entry.cursor - 1,
          });
        }
        acceptedEntries.push(entry);
        nextAcceptedCount += 1;
        nextIngestedCursor = entry.cursor;
      }

      if (envelope.next_cursor > nextIngestedCursor) {
        nextGaps = retainFault(nextGaps, {
          kind: "cursor-gap",
          firstMissingCursor: nextIngestedCursor + 1,
          lastMissingCursor: envelope.next_cursor,
        });
        nextIngestedCursor = envelope.next_cursor;
      }

      ingestedCursor = nextIngestedCursor;
      acceptedCount = nextAcceptedCount;
      duplicateCount = nextDuplicateCount;
      gaps = nextGaps;
      if (acceptedEntries.length === 0) return;

      const batch: AcceptedEvidenceBatch = {
        runId,
        sourceKey,
        firstCursor: acceptedEntries[0].cursor,
        lastCursor: acceptedEntries[acceptedEntries.length - 1].cursor,
        entries: acceptedEntries,
      };
      for (const listener of [...listeners]) {
        try {
          listener(batch);
        } catch {
          // Presentation observers are isolated so accepted evidence still reaches peers
          // and the compatibility store can append after this pre-ring callback returns.
        }
      }
    },
    onSnapshotAccepted(snapshot): void {
      // A snapshot IS the presentation's new anchor -- the session installs it and re-`reset`s
      // this ingress around it -- so its cursor really is delivered truth for every consumer.
      if (!disposed && acceptsExactEvidence(snapshot.run_id, snapshot.event_cursor)) {
        ingestedCursor = Math.max(ingestedCursor, snapshot.event_cursor);
      }
    },
    /**
     * Records a checkpoint's identity. **Does not move the delivery watermark.**
     *
     * A checkpoint is exact truth about world STATE at a cursor; it carries none of the EVENTS
     * below that cursor. It used to advance `ingestedCursor`, on the reading that everything up
     * to a checkpoint is "known" — but the only consumer that matters, `StoryDirector`, does not
     * adopt a live checkpoint on arrival: `reconcileCheckpointIfSafe` refuses it until
     * presentation has already caught up past its cursor, which on a live run it has not. So the
     * jump discarded, as duplicates, stream events the director still needed; the next batch it
     * did receive failed `preflightMoments`' `firstCursor === nextCursor + 1` contract, and
     * *every* later batch failed it too. That throw lands in this module's own observer-isolation
     * catch below, so the presentation died in total silence.
     *
     * Measured on two real live runs (2026-08-21): 145 entries accepted, `pendingMoments` 0,
     * `deferredUtteranceEvidence` 0, nothing paused or unpresentable, no fault, transport LIVE —
     * and the chronicle frozen at 6 moments while the world produced 149 events.
     */
    onCheckpointAccepted(record): void {
      if (!disposed) {
        acceptsExactEvidence(
          record.checkpoint.run_id,
          record.checkpoint.event_cursor,
        );
      }
    },
    subscribe(listener): () => void {
      if (disposed) return () => undefined;
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot(): PresentationIngressSnapshot {
      return {
        runId,
        sourceKey,
        ingestedCursor,
        acceptedCount,
        duplicateCount,
        gaps: [...gaps],
      };
    },
    reset(identity): void {
      if (disposed) return;
      runId = identity.runId;
      sourceKey = identity.sourceKey;
      ingestedCursor = identity.cursor;
      acceptedCount = 0;
      duplicateCount = 0;
      gaps = [];
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      listeners.clear();
    },
  };
}

function assertStrictlyIncreasingCursors(
  entries: readonly EventEnvelopeEntry[],
): void {
  for (let index = 1; index < entries.length; index += 1) {
    if (entries[index].cursor <= entries[index - 1].cursor) {
      throw new RangeError("Event envelope cursors must be strictly increasing");
    }
  }
}
