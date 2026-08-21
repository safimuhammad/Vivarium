import type { LiveApiClient } from "../app/client";
import type { WorldSnapshot } from "../app/schemas";
import { EVENT_VISUAL_EVENT_TYPES } from "../events/eventVisualCatalog";
import {
  assertValidFrameIdentity,
  type FrameIdentity,
  type PresentedObserverFrame,
  type PresentationGap,
} from "./contracts";
import type { PresentedEventType } from "./eventPayloads";
import { PresentedWorldModel } from "./PresentedWorldModel";
import type { SceneSettlementCoordinatorSnapshot } from "./SceneSettlementCoordinator";

export interface RecoveryDigest {
  readonly skipped: Readonly<{
    readonly firstCursor: number;
    readonly lastCursor: number;
  }>;
  readonly majorMoments: readonly Readonly<{
    readonly type: PresentedEventType;
    readonly count: number;
  }>[];
  readonly compressedAmbientCount: number;
}

export type RecoveryCoordinatorState =
  | { readonly status: "idle" }
  | { readonly status: "waiting-safe-boundary"; readonly digest: RecoveryDigest }
  | {
      readonly status: "fetching-world";
      readonly digest: RecoveryDigest;
      readonly requestCount: number;
    }
  | {
      readonly status: "frozen-retry";
      readonly digest: RecoveryDigest;
      readonly publicMessage: string;
    }
  | {
      readonly status: "complete";
      readonly digest: RecoveryDigest;
      readonly snappedCursor: number;
    };

export interface PreparedRecoveryPlacement {
  readonly runId: string;
  readonly eventCursor: number;
}

export interface PreparedRecoveryPlacementPort {
  prepareFromSnapshot(snapshot: WorldSnapshot): PreparedRecoveryPlacement;
  commitPrepared(prepared: PreparedRecoveryPlacement): void;
  rollbackPrepared(prepared: PreparedRecoveryPlacement): void;
  dispose?(): void;
}

export interface LegacyRecoveryPlacementPort {
  replaceFromSnapshot(snapshot: WorldSnapshot): void;
  dispose?(): void;
}

export type RecoveryPlacementPort =
  | PreparedRecoveryPlacementPort
  | LegacyRecoveryPlacementPort;

export interface RecoverySettlementPort {
  requestSafeCancel(reason: string): void;
  subscribe(listener: () => void): () => void;
  getSnapshot(): SceneSettlementCoordinatorSnapshot;
}

export interface RecoveryPublication {
  readonly frame: PresentedObserverFrame;
  readonly gap: PresentationGap;
  readonly digest: RecoveryDigest;
  readonly publicMessage: "The world moved ahead" | "While you were away";
}

export interface RecoveryPublicationPort {
  currentFrame(): PresentedObserverFrame;
  publishRecovery(publication: RecoveryPublication): RecoveryPublicationReceipt;
}

export type RecoveryPublicationReceipt =
  | Readonly<{
      status: "committed";
      publicationSerial: number;
      identity: FrameIdentity;
    }>
  | Readonly<{
      status: "superseded";
      publicationSerial: number;
    }>
  | Readonly<{
      status: "rejected";
      publicationSerial: number;
    }>;

export type RecoveryReason =
  | "cursor-gap"
  | "queue-overflow"
  | "hidden-tab"
  | "checkpoint-413";

export interface RecoveryInput {
  readonly reason: RecoveryReason;
  readonly digest: RecoveryDigest;
  readonly identity: FrameIdentity;
}

export interface RecoveryCoordinator {
  recover(input: RecoveryInput): Promise<void>;
  retry(): Promise<void>;
  getSnapshot(): RecoveryCoordinatorState;
  dispose(): void;
}

export interface RecoveryCoordinatorOptions {
  readonly client: Pick<LiveApiClient, "getWorld">;
  readonly model: PresentedWorldModel;
  readonly placement: RecoveryPlacementPort;
  readonly settlement: RecoverySettlementPort;
  readonly publication: RecoveryPublicationPort;
  readonly getActiveIdentity: () => FrameIdentity;
  /** Compatibility seam for legacy Task 5 tests only; production sessions require prepared placement. */
  readonly allowLegacyPlacementForTests?: true;
}

const IDLE_STATE: RecoveryCoordinatorState = Object.freeze({ status: "idle" });
const FROZEN_PUBLIC_MESSAGE = "The world paused here. Retry when ready.";
const PRESENTED_EVENT_TYPES = new Set<string>(EVENT_VISUAL_EVENT_TYPES);

interface RecoveryAttempt {
  readonly generation: number;
  readonly reason: RecoveryReason;
  readonly digest: RecoveryDigest;
  readonly identity: FrameIdentity;
  readonly frozenFrame: PresentedObserverFrame;
}

/** Creates the sole explicit, snapshot-based recovery owner for one session. */
export function createRecoveryCoordinator(
  options: RecoveryCoordinatorOptions,
): RecoveryCoordinator {
  return new SessionRecoveryCoordinator(options);
}

class SessionRecoveryCoordinator implements RecoveryCoordinator {
  private readonly client: Pick<LiveApiClient, "getWorld">;
  private readonly model: PresentedWorldModel;
  private readonly placement: RecoveryPlacementPort;
  private readonly settlement: RecoverySettlementPort;
  private readonly publication: RecoveryPublicationPort;
  private readonly getActiveIdentity: () => FrameIdentity;
  private state: RecoveryCoordinatorState = IDLE_STATE;
  private inFlight: Promise<void> | null = null;
  private failedAttempt: RecoveryAttempt | null = null;
  private cancelBoundaryWait: (() => void) | null = null;
  private requestCount = 0;
  private generation = 0;
  private disposed = false;

  constructor(options: RecoveryCoordinatorOptions) {
    if ("replaceFromSnapshot" in options.placement && !options.allowLegacyPlacementForTests) {
      throw new Error("production recovery requires a prepared placement generation port");
    }
    this.client = options.client;
    this.model = options.model;
    this.placement = options.placement;
    this.settlement = options.settlement;
    this.publication = options.publication;
    this.getActiveIdentity = options.getActiveIdentity;
  }

  recover(input: RecoveryInput): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.inFlight !== null) return this.inFlight;
    if (this.state.status === "frozen-retry") return Promise.resolve();

    const attempt = this.prepareAttempt(input);
    return this.startAttempt(attempt);
  }

  retry(): Promise<void> {
    if (this.disposed) return Promise.resolve();
    if (this.inFlight !== null) return this.inFlight;
    const failed = this.failedAttempt;
    if (this.state.status !== "frozen-retry" || failed === null) return Promise.resolve();
    if (!sameIdentity(this.getActiveIdentity(), failed.identity)) {
      this.failedAttempt = null;
      this.state = IDLE_STATE;
      return Promise.resolve();
    }
    const currentFrame = this.publication.currentFrame();
    if (currentFrame !== failed.frozenFrame) {
      this.failedAttempt = null;
      this.state = IDLE_STATE;
      return Promise.resolve();
    }
    return this.startAttempt({ ...failed, generation: this.nextGeneration() });
  }

  getSnapshot(): RecoveryCoordinatorState {
    return this.state;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.generation += 1;
    this.cancelBoundaryWait?.();
    this.cancelBoundaryWait = null;
    this.failedAttempt = null;
    this.state = IDLE_STATE;
  }

  private prepareAttempt(input: RecoveryInput): RecoveryAttempt {
    assertValidFrameIdentity(input.identity);
    validateRecoveryDigest(input.digest, input.identity);
    const activeIdentity = this.getActiveIdentity();
    assertValidFrameIdentity(activeIdentity);
    if (!sameIdentity(activeIdentity, input.identity)) {
      throw new Error("recovery identity is stale for the active session");
    }
    const frozenFrame = this.publication.currentFrame();
    assertValidFrameIdentity(frozenFrame);
    if (!sameIdentity(frozenFrame, input.identity)) {
      throw new Error("recovery identity does not match the selected observer frame");
    }
    return Object.freeze({
      generation: this.nextGeneration(),
      reason: input.reason,
      digest: cloneDigest(input.digest),
      identity: cloneIdentity(input.identity),
      frozenFrame,
    });
  }

  private startAttempt(attempt: RecoveryAttempt): Promise<void> {
    let resolvePublic!: () => void;
    let rejectPublic!: (reason: unknown) => void;
    const publicPromise = new Promise<void>((resolve, reject) => {
      resolvePublic = resolve;
      rejectPublic = reject;
    });
    this.inFlight = publicPromise;

    const execution = this.runAttempt(attempt);
    void execution.then(
      () => {
        if (this.inFlight === publicPromise) this.inFlight = null;
        resolvePublic();
      },
      (error: unknown) => {
        if (this.inFlight === publicPromise) this.inFlight = null;
        rejectPublic(error);
      },
    );
    return publicPromise;
  }

  private async runAttempt(attempt: RecoveryAttempt): Promise<void> {
    let currentAttempt = attempt;
    let rollbackPreparedOwners: (() => void) | null = null;
    try {
      this.state = Object.freeze({
        status: "waiting-safe-boundary",
        digest: attempt.digest,
      });
      const safe = await this.waitForSafeBoundary(attempt);
      if (!safe || !this.isCurrent(attempt)) return;
      const adopted = this.adoptSafeBoundary(attempt);
      if (adopted === null) {
        this.state = IDLE_STATE;
        return;
      }
      currentAttempt = adopted;

      this.requestCount += 1;
      this.state = Object.freeze({
        status: "fetching-world",
        digest: currentAttempt.digest,
        requestCount: this.requestCount,
      });
      const snapshot = structuredClone(await this.client.getWorld()) as WorldSnapshot;

      if (!this.isCurrent(currentAttempt)) return;
      if (!this.isAttemptContextCurrent(currentAttempt)) {
        this.state = IDLE_STATE;
        return;
      }
      validateForwardSnapshot(snapshot, currentAttempt);
      const cursorRange = {
        firstCursor: currentAttempt.digest.skipped.firstCursor,
        lastCursor: snapshot.event_cursor,
      };
      const preparedWorld = this.model.prepareForwardSnapshot(snapshot, cursorRange);

      const preparedPlacement = preparePlacementUpdate(this.placement, snapshot);

      if (!this.isCurrent(currentAttempt)) return;
      if (!this.isAttemptContextCurrent(currentAttempt)) {
        this.state = IDLE_STATE;
        return;
      }
      if (preparedPlacement.kind === "legacy") {
        preparedPlacement.commit();
        if (!this.isCurrent(currentAttempt)) return;
        if (!this.isAttemptContextCurrent(currentAttempt)) {
          this.state = IDLE_STATE;
          return;
        }
        this.model.commitPreparedForwardSnapshot(preparedWorld);
      } else {
        try {
          preparedPlacement.commit();
          if (!this.isCurrent(currentAttempt) || !this.isAttemptContextCurrent(currentAttempt)) {
            preparedPlacement.rollback();
            this.state = IDLE_STATE;
            return;
          }
          this.model.commitPreparedForwardSnapshot(preparedWorld);
          rollbackPreparedOwners = () => {
            this.model.rollbackPreparedForwardSnapshot(preparedWorld);
            preparedPlacement.rollback();
          };
        } catch (error) {
          this.model.rollbackPreparedForwardSnapshot(preparedWorld);
          preparedPlacement.rollback();
          throw error;
        }
      }
      const publication = buildRecoveryPublication(
        currentAttempt,
        snapshot,
        this.model,
      );
      const receipt = this.publication.publishRecovery(publication);
      validatePublicationReceipt(receipt, publication.frame);
      if (receipt.status === "rejected") {
        rollbackPreparedOwners?.();
        rollbackPreparedOwners = null;
        throw new Error("recovery publication was rejected before retention");
      }
      // A committed receipt proves the exact frame was retained. Superseded proves it was
      // retained and then synchronously replaced by a newer coherent publication. Both are final.
      rollbackPreparedOwners = null;
      if (!this.isCurrent(currentAttempt)) return;
      this.failedAttempt = null;
      this.state = Object.freeze({
        status: "complete",
        digest: currentAttempt.digest,
        snappedCursor: snapshot.event_cursor,
      });
    } catch {
      rollbackPreparedOwners?.();
      if (!this.isCurrent(currentAttempt)) return;
      if (!this.isAttemptContextCurrent(currentAttempt)) {
        this.failedAttempt = null;
        this.state = IDLE_STATE;
        return;
      }
      this.failedAttempt = currentAttempt;
      this.state = Object.freeze({
        status: "frozen-retry",
        digest: currentAttempt.digest,
        publicMessage: FROZEN_PUBLIC_MESSAGE,
      });
    }
  }

  private waitForSafeBoundary(attempt: RecoveryAttempt): Promise<boolean> {
    const before = this.settlement.getSnapshot();
    if (isAlreadySafe(before)) return Promise.resolve(true);
    const sceneToken = before.sceneToken;
    if (sceneToken === null) return Promise.resolve(true);

    return new Promise<boolean>((resolve, reject) => {
      let finished = false;
      let cancelGeneration: number | null = null;
      let unsubscribe: (() => void) | null = null;
      const finish = (safe: boolean): void => {
        if (finished) return;
        finished = true;
        unsubscribe?.();
        if (this.cancelBoundaryWait === cancel) this.cancelBoundaryWait = null;
        resolve(safe);
      };
      const cancel = (): void => finish(false);
      const check = (): void => {
        if (!this.isCurrent(attempt)) {
          finish(false);
          return;
        }
        if (cancelGeneration === null) return;
        const snapshot = this.settlement.getSnapshot();
        if (isCurrentSafeBoundary(snapshot, sceneToken, cancelGeneration)) finish(true);
      };

      try {
        unsubscribe = this.settlement.subscribe(check);
        this.cancelBoundaryWait = cancel;
        this.settlement.requestSafeCancel(`recovery:${attempt.reason}`);
        const requested = this.settlement.getSnapshot();
        if (requested.sceneToken !== sceneToken || !requested.cancelRequested) {
          throw new Error("settlement did not retain the current recovery cancellation");
        }
        cancelGeneration = requested.cancelGeneration;
        check();
      } catch (error) {
        if (!finished) {
          finished = true;
          unsubscribe?.();
          if (this.cancelBoundaryWait === cancel) this.cancelBoundaryWait = null;
          reject(error);
        }
      }
    });
  }

  private isCurrent(attempt: RecoveryAttempt): boolean {
    return !this.disposed && attempt.generation === this.generation;
  }

  private adoptSafeBoundary(attempt: RecoveryAttempt): RecoveryAttempt | null {
    const selectedFrame = this.publication.currentFrame();
    assertValidFrameIdentity(selectedFrame);
    const activeIdentity = this.getActiveIdentity();
    assertValidFrameIdentity(activeIdentity);
    if (!sameIdentity(activeIdentity, selectedFrame)) return null;
    if (
      selectedFrame.runId !== attempt.identity.runId
      || selectedFrame.sourceKey !== attempt.identity.sourceKey
      || selectedFrame.source !== attempt.frozenFrame.source
      || !sameSelection(selectedFrame, attempt.frozenFrame)
      || attempt.digest.skipped.firstCursor !== selectedFrame.lastCursor + 1
    ) return null;

    if (!sameIdentity(selectedFrame, attempt.identity)) {
      if (!isAuthorizedConsequenceFrame(
        attempt.frozenFrame,
        selectedFrame,
        this.settlement.getSnapshot(),
      )) return null;
    } else if (
      attempt.frozenFrame.scene !== null
      && (
        selectedFrame !== attempt.frozenFrame
        || !isRetainedSettledConsequenceFrame(
          selectedFrame,
          this.settlement.getSnapshot(),
        )
      )
    ) {
      return null;
    }

    return Object.freeze({
      ...attempt,
      identity: cloneIdentity(selectedFrame),
      frozenFrame: selectedFrame,
    });
  }

  private isAttemptContextCurrent(attempt: RecoveryAttempt): boolean {
    return sameIdentity(this.getActiveIdentity(), attempt.identity)
      && this.publication.currentFrame() === attempt.frozenFrame;
  }

  private acceptsOwnPublication(
    attempt: RecoveryAttempt,
    publishedFrame: PresentedObserverFrame,
  ): boolean {
    const selectedFrame = this.publication.currentFrame();
    if (
      !sameIdentity(selectedFrame, publishedFrame)
      || selectedFrame.source !== publishedFrame.source
      || !sameSelection(selectedFrame, publishedFrame)
    ) return false;
    const activeIdentity = this.getActiveIdentity();
    return sameIdentity(activeIdentity, attempt.identity)
      || sameIdentity(activeIdentity, publishedFrame);
  }

  private nextGeneration(): number {
    this.generation += 1;
    return this.generation;
  }
}

function validatePublicationReceipt(
  receipt: RecoveryPublicationReceipt,
  candidate: PresentedObserverFrame,
): void {
  if (!Number.isSafeInteger(receipt.publicationSerial) || receipt.publicationSerial <= 0) {
    throw new Error("recovery publication receipt must carry a positive serial");
  }
  if (receipt.status !== "committed") return;
  assertValidFrameIdentity(receipt.identity);
  if (!sameIdentity(receipt.identity, candidate)) {
    throw new Error("committed recovery receipt must identify the exact candidate frame");
  }
}

type PreparedPlacementUpdate =
  | Readonly<{ kind: "prepared"; commit(): void; rollback(): void }>
  | Readonly<{ kind: "legacy"; commit(): void }>;

function preparePlacementUpdate(
  placement: RecoveryPlacementPort,
  snapshot: WorldSnapshot,
): PreparedPlacementUpdate {
  const owned = structuredClone(snapshot) as WorldSnapshot;
  if ("prepareFromSnapshot" in placement) {
    const prepared = placement.prepareFromSnapshot(owned);
    if (
      prepared.runId !== snapshot.run_id
      || prepared.eventCursor !== snapshot.event_cursor
    ) throw new Error("prepared placement must retain the recovery snapshot identity");
    return Object.freeze({
      kind: "prepared" as const,
      commit: () => placement.commitPrepared(prepared),
      rollback: () => placement.rollbackPrepared(prepared),
    });
  }
  return Object.freeze({
    kind: "legacy" as const,
    commit: () => placement.replaceFromSnapshot(owned),
  });
}

function validateRecoveryDigest(digest: RecoveryDigest, identity: FrameIdentity): void {
  const { firstCursor, lastCursor } = digest.skipped;
  if (!Number.isSafeInteger(firstCursor) || firstCursor < 0) {
    throw new RangeError("recovery first cursor must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(lastCursor) || lastCursor < firstCursor) {
    throw new RangeError("recovery last cursor must be a safe integer at or after the first");
  }
  if (firstCursor !== identity.lastCursor + 1) {
    throw new RangeError("recovery skipped range must begin after the selected frame");
  }
  if (!Number.isSafeInteger(digest.compressedAmbientCount) || digest.compressedAmbientCount < 0) {
    throw new RangeError("compressed ambient count must be a non-negative safe integer");
  }
  let accountedCount = digest.compressedAmbientCount;
  for (const moment of digest.majorMoments) {
    if (!PRESENTED_EVENT_TYPES.has(moment.type)) {
      throw new Error("recovery major moment type must be canonical");
    }
    if (!Number.isSafeInteger(moment.count) || moment.count <= 0) {
      throw new RangeError("recovery major moment count must be a positive safe integer");
    }
    accountedCount += moment.count;
    if (!Number.isSafeInteger(accountedCount)) {
      throw new RangeError("recovery digest count exceeds the safe integer range");
    }
  }
  const skippedSpan = lastCursor - firstCursor + 1;
  if (!Number.isSafeInteger(skippedSpan)) {
    throw new RangeError("recovery skipped cursor span exceeds the safe integer range");
  }
  if (accountedCount <= 0 || accountedCount > skippedSpan) {
    throw new RangeError("recovery digest must non-emptily account for the skipped range");
  }
}

function validateForwardSnapshot(snapshot: WorldSnapshot, attempt: RecoveryAttempt): void {
  if (snapshot.schema !== 1) throw new Error("recovery snapshot must use schema 1");
  if (snapshot.run_id !== attempt.identity.runId) {
    throw new Error("recovery snapshot run does not match the active session");
  }
  if (!Number.isSafeInteger(snapshot.event_cursor)) {
    throw new RangeError("recovery snapshot cursor must be a safe integer");
  }
  if (
    snapshot.event_cursor <= attempt.identity.lastCursor
    || snapshot.event_cursor < attempt.digest.skipped.lastCursor
  ) {
    throw new RangeError("recovery snapshot must cover the forward skipped range");
  }
  if (
    !Number.isFinite(snapshot.world_time)
    || snapshot.world_time < attempt.frozenFrame.world.worldTime
  ) {
    throw new RangeError("recovery snapshot world time must not regress");
  }
}

function buildRecoveryPublication(
  attempt: RecoveryAttempt,
  snapshot: WorldSnapshot,
  model: PresentedWorldModel,
): RecoveryPublication {
  const revision = attempt.identity.revision + 1;
  if (!Number.isSafeInteger(revision)) {
    throw new RangeError("recovery frame revision exceeds the safe integer range");
  }
  const identity: FrameIdentity = {
    runId: attempt.identity.runId,
    sourceKey: attempt.identity.sourceKey,
    revision,
    firstCursor: snapshot.event_cursor,
    lastCursor: snapshot.event_cursor,
  };
  assertValidFrameIdentity(identity);
  const chapter = attempt.reason === "hidden-tab"
    ? "while-away" as const
    : "world-moved-ahead" as const;
  const publicMessage = chapter === "while-away"
    ? "While you were away" as const
    : "The world moved ahead" as const;
  const gap: PresentationGap = Object.freeze({
    firstCursor: attempt.digest.skipped.firstCursor,
    lastCursor: snapshot.event_cursor,
    chapter,
    archiveAvailable: true,
  });
  const frame: PresentedObserverFrame = Object.freeze({
    ...attempt.frozenFrame,
    ...identity,
    ingestedCursor: snapshot.event_cursor,
    presentedCursor: snapshot.event_cursor,
    world: model.getView(),
    scene: null,
    backlog: Object.freeze({
      pendingMoments: 0,
      firstPendingCursor: null,
      lastPendingCursor: null,
      state: "caught-up" as const,
      label: "Caught up",
    }),
    transport: Object.freeze({
      connection: "live" as const,
      ingestedCursor: snapshot.event_cursor,
      retryable: false,
    }),
  });
  return Object.freeze({ frame, gap, digest: attempt.digest, publicMessage });
}

function isAlreadySafe(snapshot: SceneSettlementCoordinatorSnapshot): boolean {
  return snapshot.sceneToken === null || snapshot.sceneSettled;
}

function isCurrentSafeBoundary(
  snapshot: SceneSettlementCoordinatorSnapshot,
  sceneToken: number,
  cancelGeneration: number,
): boolean {
  return snapshot.sceneToken === sceneToken
    && snapshot.cancelRequested
    && snapshot.cancelGeneration === cancelGeneration
    && snapshot.acknowledgedCancelGeneration === cancelGeneration
    && snapshot.safeBoundaryAcknowledged
    && snapshot.sceneSettled;
}

function sameIdentity(left: FrameIdentity, right: FrameIdentity): boolean {
  return left.runId === right.runId
    && left.sourceKey === right.sourceKey
    && left.revision === right.revision
    && left.firstCursor === right.firstCursor
    && left.lastCursor === right.lastCursor;
}

function sameSelection(
  left: PresentedObserverFrame,
  right: PresentedObserverFrame,
): boolean {
  return stableSerialize(left.selection) === stableSerialize(right.selection);
}

function isAuthorizedConsequenceFrame(
  before: PresentedObserverFrame,
  after: PresentedObserverFrame,
  settlement: SceneSettlementCoordinatorSnapshot,
): boolean {
  const beforeScene = before.scene;
  const afterScene = after.scene;
  return beforeScene !== null
    && afterScene !== null
    && beforeScene.momentId === afterScene.momentId
    && settlement.momentId === beforeScene.momentId
    && settlement.consequenceCommitted
    && settlement.publishedRevision === after.revision
    && settlement.safeBoundaryAcknowledged
    && settlement.sceneSettled
    && after.revision === before.revision + 1
    && after.firstCursor >= before.firstCursor
    && after.lastCursor >= before.lastCursor
    && ["consequence", "recover", "exit"].includes(afterScene.phase);
}

function isRetainedSettledConsequenceFrame(
  frame: PresentedObserverFrame,
  settlement: SceneSettlementCoordinatorSnapshot,
): boolean {
  const scene = frame.scene;
  const publishedRevision = settlement.publishedRevision;
  const exactPublication = publishedRevision === frame.revision;
  const coherentDescendant = publishedRevision !== null
    && publishedRevision < frame.revision
    && scene?.execution !== undefined;
  return scene !== null
    && settlement.momentId === scene.momentId
    && settlement.consequenceCommitted
    && (exactPublication || coherentDescendant)
    && settlement.safeBoundaryAcknowledged
    && settlement.sceneSettled
    && ["consequence", "recover", "exit"].includes(scene.phase);
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableSerialize(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
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

function cloneDigest(digest: RecoveryDigest): RecoveryDigest {
  return Object.freeze({
    skipped: Object.freeze({ ...digest.skipped }),
    majorMoments: Object.freeze(digest.majorMoments.map((moment) => Object.freeze({
      type: moment.type,
      count: moment.count,
    }))),
    compressedAmbientCount: digest.compressedAmbientCount,
  });
}
