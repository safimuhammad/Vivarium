import {
  assertValidFrameIdentity,
  type FrameIdentity,
  type PresentedObserverFrame,
} from "./contracts";

export interface PresentationFrameSinkSnapshot {
  readonly publicationSerial: number;
  readonly frame: PresentedObserverFrame | null;
  readonly disposed: boolean;
}

export interface PresentationFrameSink {
  publish(frame: PresentedObserverFrame): number;
  clear(identity: FrameIdentity): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): PresentationFrameSinkSnapshot;
  dispose(): void;
}

export interface PresentationFrameAcceptanceTracker {
  markAccepted(frame: PresentedObserverFrame): void;
  accepts(frame: PresentedObserverFrame): boolean;
  clear(): void;
  dispose(): void;
}

/** Creates one lineage-guarded observer-frame publication owner. */
export function createPresentationFrameSink(): PresentationFrameSink {
  return new SinglePresentationFrameSink();
}

/** Create a synchronous exact-revision receipt shared by a session and Canvas owner. */
export function createPresentationFrameAcceptanceTracker(): PresentationFrameAcceptanceTracker {
  let accepted: PresentedObserverFrame | null = null;
  let disposed = false;
  return {
    markAccepted(frame): void {
      if (disposed) return;
      assertValidFrameIdentity(frame);
      accepted = deepCloneFreeze(frame);
    },
    accepts(frame): boolean {
      if (disposed || accepted === null) return false;
      return sameAcceptedFrame(accepted, frame);
    },
    clear(): void {
      if (!disposed) accepted = null;
    },
    dispose(): void {
      disposed = true;
      accepted = null;
    },
  };
}

class SinglePresentationFrameSink implements PresentationFrameSink {
  private readonly listeners = new Set<() => void>();
  private publicationSerial = 0;
  private frame: PresentedObserverFrame | null = null;
  private lastIdentity: FrameIdentity | null = null;
  private disposed = false;
  private notifying = false;
  private pendingNotifications = 0;
  private snapshot: PresentationFrameSinkSnapshot = freezeSnapshot(0, null, false);

  publish(frame: PresentedObserverFrame): number {
    if (this.disposed) return this.publicationSerial;
    assertValidFrameIdentity(frame);
    if (!this.accepts(frame)) return this.publicationSerial;

    const assignedSerial = this.publicationSerial + 1;
    this.publicationSerial = assignedSerial;
    const ownedFrame = deepCloneFreeze(frame);
    this.frame = ownedFrame;
    this.lastIdentity = cloneIdentity(ownedFrame);
    this.snapshot = freezeSnapshot(this.publicationSerial, this.frame, false);
    this.notify();
    return assignedSerial;
  }


  clear(identity: FrameIdentity): void {
    if (this.disposed) return;
    assertValidFrameIdentity(identity);
    if (this.frame === null || !this.accepts(identity)) return;

    this.publicationSerial += 1;
    this.frame = null;
    this.lastIdentity = cloneIdentity(identity);
    this.snapshot = freezeSnapshot(this.publicationSerial, null, false);
    this.notify();
  }

  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    let subscribed = true;
    return () => {
      if (!subscribed) return;
      subscribed = false;
      this.listeners.delete(listener);
    };
  }

  getSnapshot(): PresentationFrameSinkSnapshot {
    return this.snapshot;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frame !== null) this.publicationSerial += 1;
    this.frame = null;
    this.snapshot = freezeSnapshot(this.publicationSerial, null, true);
    this.pendingNotifications = 0;
    this.listeners.clear();
  }

  private accepts(identity: FrameIdentity): boolean {
    const prior = this.lastIdentity;
    if (prior === null) return true;
    return identity.runId === prior.runId
      && identity.sourceKey === prior.sourceKey
      && identity.revision >= prior.revision
      && identity.firstCursor >= prior.firstCursor
      && identity.lastCursor >= prior.lastCursor;
  }

  private notify(): void {
    this.pendingNotifications += 1;
    if (this.notifying) return;
    this.notifying = true;
    try {
      while (this.pendingNotifications > 0 && !this.disposed) {
        this.pendingNotifications -= 1;
        for (const listener of [...this.listeners]) {
          if (this.disposed) break;
          try {
            listener();
          } catch {
            // One observer cannot prevent peers from seeing the selected frame.
          }
          if (this.disposed) break;
        }
      }
    } finally {
      this.notifying = false;
    }
  }
}

function cloneIdentity(identity: FrameIdentity): FrameIdentity {
  return Object.freeze({
    runId: identity.runId,
    sourceKey: identity.sourceKey,
    revision: identity.revision,
    firstCursor: identity.firstCursor,
    lastCursor: identity.lastCursor,
  });
}

function freezeSnapshot(
  publicationSerial: number,
  frame: PresentedObserverFrame | null,
  disposed: boolean,
): PresentationFrameSinkSnapshot {
  return Object.freeze({ publicationSerial, frame, disposed });
}

function deepCloneFreeze(frame: PresentedObserverFrame): PresentedObserverFrame {
  return deepFreeze(structuredClone(frame) as PresentedObserverFrame);
}

function sameAcceptedFrame(left: PresentedObserverFrame, right: PresentedObserverFrame): boolean {
  const leftExecution = left.scene?.execution;
  const rightExecution = right.scene?.execution;
  return left.runId === right.runId
    && left.sourceKey === right.sourceKey
    && left.revision === right.revision
    && left.firstCursor === right.firstCursor
    && left.lastCursor === right.lastCursor
    && left.scene?.momentId === right.scene?.momentId
    && left.scene?.phase === right.scene?.phase
    && leftExecution?.sceneToken === rightExecution?.sceneToken
    && leftExecution?.programId === rightExecution?.programId
    && leftExecution?.eventType === rightExecution?.eventType;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}
