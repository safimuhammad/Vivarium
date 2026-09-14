import type { FrameIdentity, PresentedSceneView } from "./contracts";
import { PresentedWorldModel } from "./PresentedWorldModel";
import type { StoryMoment } from "./BeatDirector";

/** Expected backpressure while an asynchronous renderer commits the exact scene frame. */
export class ScenePublicationPending extends Error {
  constructor() {
    super("The scene is waiting for its renderer receipt.");
    this.name = "ScenePublicationPending";
  }
}

export type StoryPhase = "enter" | "hold" | "consequence" | "recover" | "exit";

export type SceneMarkerRole =
  | "contact"
  | "consequence"
  | "safe-cancel"
  | "optional-effect"
  | "settle";

/** One immutable, scene-local causal marker in a runtime program. */
export interface SceneRuntimeMarker {
  readonly name: string;
  readonly atMs: number;
  readonly order: number;
  readonly role: SceneMarkerRole;
  readonly optional: boolean;
}

export type SceneRuntimeSignal =
  | { readonly kind: "consequence-marker"; readonly sceneToken: number; readonly marker: string }
  | {
      readonly kind: "safe-cancel-ack";
      readonly sceneToken: number;
      readonly cancelApplied: boolean;
      readonly cancelGeneration: number;
    }
  | { readonly kind: "scene-settled"; readonly sceneToken: number };

export interface SceneRuntimeProgram {
  readonly id: string;
  readonly phases: readonly PresentedSceneView[];
  readonly phaseWindows: readonly Readonly<{
    phase: StoryPhase;
    startMs: number;
    endMs: number;
  }>[];
  readonly markers: readonly SceneRuntimeMarker[];
  readonly durationMs: number;
  readonly consequenceMarker: string;
  readonly safeCancelMarkers: readonly string[];
}

export interface SceneRuntimeStart {
  readonly moment: StoryMoment;
  readonly program: SceneRuntimeProgram;
}

export interface SceneRuntimePort {
  start(input: SceneRuntimeStart, identity: FrameIdentity): number;
  advance(nowMs: number): readonly SceneRuntimeSignal[];
  acknowledgePublishedConsequence(
    sceneToken: number,
    publishedRevision: number,
    cancelRequested: boolean,
    cancelGeneration: number,
  ): void;
  requestSafeCancel(sceneToken: number, reason: string, cancelGeneration: number): void;
  nextDeadlineMs(): number | null;
  dispose(): void;
}

export interface SceneSettlementCoordinatorSnapshot {
  readonly sceneToken: number | null;
  readonly momentId: string | null;
  readonly consequenceCommitted: boolean;
  readonly publishedRevision: number | null;
  readonly safeBoundaryAcknowledged: boolean;
  readonly cancelRequested: boolean;
  readonly cancelGeneration: number;
  readonly acknowledgedCancelGeneration: number | null;
  readonly sceneSettled: boolean;
}

export interface SceneSettlementCoordinatorOptions {
  readonly model: PresentedWorldModel;
  readonly runtime: SceneRuntimePort;
  readonly publishConsequenceFrame: (
    moment: StoryMoment,
    consequenceScene: PresentedSceneView,
  ) => number;
  readonly onSettlementComplete: (moment: StoryMoment) => void;
}

const EMPTY_SNAPSHOT: SceneSettlementCoordinatorSnapshot = Object.freeze({
  sceneToken: null,
  momentId: null,
  consequenceCommitted: false,
  publishedRevision: null,
  safeBoundaryAcknowledged: false,
  cancelRequested: false,
  cancelGeneration: 0,
  acknowledgedCancelGeneration: null,
  sceneSettled: false,
});

/** Owns the exact consequence publication and settlement handshake for one scene. */
export class SceneSettlementCoordinator {
  private readonly model: PresentedWorldModel;
  private readonly runtime: SceneRuntimePort;
  private readonly publishConsequenceFrame: (
    moment: StoryMoment,
    consequenceScene: PresentedSceneView,
  ) => number;
  private readonly onSettlementComplete: (moment: StoryMoment) => void;
  private readonly listeners = new Set<() => void>();
  private snapshot = EMPTY_SNAPSHOT;
  private input: SceneRuntimeStart | null = null;
  private completed = false;
  private disposed = false;
  private lastSceneToken = -1;
  private consequenceMarkerAccepted = false;
  private runtimeAcknowledged = false;
  private cancelRequestDeliveredGeneration = 0;
  private cancelReason: string | null = null;
  private advancing = false;
  private readonly queuedAdvanceTimes: number[] = [];
  private readonly pendingSignals: SceneRuntimeSignal[] = [];

  constructor(options: SceneSettlementCoordinatorOptions) {
    this.model = options.model;
    this.runtime = options.runtime;
    this.publishConsequenceFrame = options.publishConsequenceFrame;
    this.onSettlementComplete = options.onSettlementComplete;
  }

  begin(input: SceneRuntimeStart, identity: FrameIdentity): void {
    if (this.disposed) return;
    if (this.input !== null && !this.completed) throw new Error("cannot begin while a scene is unsettled");
    const sceneToken = this.runtime.start(input, identity);
    if (!Number.isSafeInteger(sceneToken) || sceneToken < 0) {
      throw new Error("runtime scene token must be a non-negative safe integer");
    }
    if (sceneToken <= this.lastSceneToken) {
      throw new Error("runtime scene tokens must increase monotonically");
    }

    this.lastSceneToken = sceneToken;
    this.input = input;
    this.completed = false;
    this.consequenceMarkerAccepted = false;
    this.runtimeAcknowledged = false;
    this.cancelRequestDeliveredGeneration = 0;
    this.cancelReason = null;
    this.queuedAdvanceTimes.length = 0;
    this.pendingSignals.length = 0;
    this.snapshot = freezeSnapshot({
      sceneToken,
      momentId: input.moment.id,
      consequenceCommitted: false,
      publishedRevision: null,
      safeBoundaryAcknowledged: false,
      cancelRequested: false,
      cancelGeneration: 0,
      acknowledgedCancelGeneration: null,
      sceneSettled: false,
    });
    this.emit();
  }

  advance(nowMs: number): void {
    if (this.disposed || this.input === null || this.completed) return;
    if (!Number.isFinite(nowMs) || nowMs < 0) {
      throw new RangeError("scene time must be a non-negative finite number");
    }
    this.queuedAdvanceTimes.push(nowMs);
    if (this.advancing) return;

    this.advancing = true;
    try {
      while (this.queuedAdvanceTimes.length > 0 && !this.disposed && !this.completed) {
        const requestedTime = this.queuedAdvanceTimes.shift()!;
        this.driveCollaborators();
        this.drainPendingSignals();
        if (this.completed) break;
        this.pendingSignals.push(...this.runtime.advance(requestedTime));
        this.drainPendingSignals();
      }
    } finally {
      this.advancing = false;
    }
  }

  requestSafeCancel(reason: string): void {
    if (this.disposed || this.input === null || this.completed || this.snapshot.cancelRequested) return;
    if (reason.trim() === "") throw new Error("safe cancellation reason must not be empty");
    const cancelGeneration = this.snapshot.cancelGeneration + 1;
    this.cancelReason = reason;
    this.snapshot = freezeSnapshot({
      ...this.snapshot,
      cancelRequested: true,
      cancelGeneration,
      acknowledgedCancelGeneration: null,
      safeBoundaryAcknowledged: false,
      sceneSettled: false,
    });
    this.emit();
    this.deliverCancelRequest();
  }

  nextDeadlineMs(): number | null {
    if (this.disposed || this.input === null || this.completed) return null;
    const deadline = this.runtime.nextDeadlineMs();
    if (deadline !== null && (!Number.isFinite(deadline) || deadline < 0)) {
      throw new RangeError("runtime deadline must be null or a non-negative finite number");
    }
    return deadline;
  }

  subscribe(listener: () => void): () => void {
    if (this.disposed) return () => undefined;
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSnapshot(): SceneSettlementCoordinatorSnapshot {
    return this.snapshot;
  }

  ownsModel(model: PresentedWorldModel): boolean {
    return model === this.model;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.runtime.dispose();
    this.input = null;
    this.completed = false;
    this.snapshot = EMPTY_SNAPSHOT;
    this.queuedAdvanceTimes.length = 0;
    this.pendingSignals.length = 0;
    this.listeners.clear();
  }

  private drainPendingSignals(): void {
    while (this.pendingSignals.length > 0 && !this.completed) {
      const signal = this.pendingSignals.shift()!;
      this.handleSignal(signal);
      this.driveCollaborators();
    }
  }

  private handleSignal(signal: SceneRuntimeSignal): void {
    if (signal.sceneToken !== this.snapshot.sceneToken || this.input === null || this.completed) return;
    switch (signal.kind) {
      case "consequence-marker":
        if (signal.marker === this.input.program.consequenceMarker) {
          this.consequenceMarkerAccepted = true;
        }
        break;
      case "safe-cancel-ack": {
        if (!this.runtimeAcknowledged || this.snapshot.publishedRevision === null) return;
        if (signal.cancelGeneration !== this.snapshot.cancelGeneration) return;
        if (this.snapshot.cancelRequested && !signal.cancelApplied) return;
        if (this.snapshot.safeBoundaryAcknowledged) return;
        this.snapshot = freezeSnapshot({
          ...this.snapshot,
          safeBoundaryAcknowledged: true,
          acknowledgedCancelGeneration: signal.cancelGeneration,
        });
        this.emit();
        this.completeIfReady();
        break;
      }
      case "scene-settled":
        if (!this.snapshot.safeBoundaryAcknowledged || this.snapshot.sceneSettled) return;
        this.snapshot = freezeSnapshot({ ...this.snapshot, sceneSettled: true });
        this.completeIfReady();
        if (!this.completed) this.emit();
        break;
    }
  }

  private driveCollaborators(): void {
    if (this.input === null || this.completed) return;
    if (
      this.snapshot.cancelRequested
      && this.cancelRequestDeliveredGeneration < this.snapshot.cancelGeneration
    ) this.deliverCancelRequest();
    if (!this.consequenceMarkerAccepted) return;

    if (!this.snapshot.consequenceCommitted) {
      this.model.applyEvidence(this.input.moment.evidence);
      this.snapshot = freezeSnapshot({ ...this.snapshot, consequenceCommitted: true });
      this.emit();
    }
    if (this.snapshot.publishedRevision === null) {
      const publishedRevision = this.publishConsequenceFrame(
        this.input.moment,
        consequenceScene(this.input.program, this.input.moment.id),
      );
      if (!Number.isSafeInteger(publishedRevision) || publishedRevision < 0) {
        throw new Error("published revision must be a non-negative safe integer");
      }
      this.snapshot = freezeSnapshot({ ...this.snapshot, publishedRevision });
      this.emit();
    }
    if (!this.runtimeAcknowledged) {
      const publishedRevision = this.snapshot.publishedRevision;
      if (publishedRevision === null) return;
      this.runtime.acknowledgePublishedConsequence(
        this.snapshot.sceneToken!,
        publishedRevision,
        this.snapshot.cancelRequested,
        this.snapshot.cancelGeneration,
      );
      this.runtimeAcknowledged = true;
    }
  }

  private deliverCancelRequest(): void {
    if (
      this.cancelReason === null
      || this.cancelRequestDeliveredGeneration >= this.snapshot.cancelGeneration
    ) return;
    this.runtime.requestSafeCancel(
      this.snapshot.sceneToken!,
      this.cancelReason,
      this.snapshot.cancelGeneration,
    );
    this.cancelRequestDeliveredGeneration = this.snapshot.cancelGeneration;
  }

  private completeIfReady(): void {
    if (
      this.completed
      || this.input === null
      || !this.snapshot.consequenceCommitted
      || this.snapshot.publishedRevision === null
      || !this.runtimeAcknowledged
      || !this.snapshot.safeBoundaryAcknowledged
      || this.snapshot.acknowledgedCancelGeneration !== this.snapshot.cancelGeneration
      || !this.snapshot.sceneSettled
    ) return;
    this.completed = true;
    try {
      this.onSettlementComplete(this.input.moment);
    } catch {
      // Completion observers are isolated; committed causal truth remains publishable.
    }
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) {
      try {
        listener();
      } catch {
        // One observer cannot prevent peers from seeing settlement progress.
      }
    }
  }
}

function freezeSnapshot(snapshot: SceneSettlementCoordinatorSnapshot): SceneSettlementCoordinatorSnapshot {
  return Object.freeze(snapshot);
}

function consequenceScene(program: SceneRuntimeProgram, momentId: string): PresentedSceneView {
  const scene = program.phases.find((candidate) => (
    candidate.phase === "consequence" && candidate.momentId === momentId
  ));
  if (scene === undefined) {
    throw new Error("runtime program must retain the active moment consequence scene");
  }
  return scene;
}
