import {
  assertValidFrameIdentity,
  type FrameIdentity,
  type PresentedSceneView,
} from "../contracts";
import type {
  SceneRuntimeMarker,
  SceneRuntimePort,
  SceneRuntimeProgram,
  SceneRuntimeSignal,
  SceneRuntimeStart,
} from "../SceneSettlementCoordinator";
import type { SceneExecutionSnapshot } from "./contracts";
import type { ObserverRendererFailure } from "../rendererPort";
import {
  decideMarkerFallback,
  publicRendererFailure,
} from "../../renderer2d/production/failurePolicy";

export interface SceneExecutorSnapshot extends SceneExecutionSnapshot {
  readonly sceneToken: number | null;
  readonly publishedRevision: number | null;
  readonly cancelGeneration: number;
  readonly acknowledgedCancelGeneration: number | null;
  readonly elapsedMs: number;
  readonly disposed: boolean;
}

export interface SceneExecutor extends SceneRuntimePort {
  reportUnavailableMarker(sceneToken: number, markerName: string): void;
  snapshot(): SceneExecutorSnapshot;
}

export interface SceneExecutorOptions {
  readonly onFailure?: (failure: ObserverRendererFailure) => void;
}

interface CancellationRequest {
  readonly reason: string;
  readonly generation: number;
}

interface PublicationAcknowledgement {
  readonly revision: number;
  readonly cancelRequested: boolean;
  readonly cancelGeneration: number;
}

interface ActiveExecution {
  readonly token: number;
  readonly identity: FrameIdentity;
  readonly input: SceneRuntimeStart;
  elapsedMs: number;
  deferredTargetMs: number;
  nextMarkerIndex: number;
  readonly emittedMarkers: string[];
  readonly omittedMarkers: Set<string>;
  consequenceEmitted: boolean;
  publication: PublicationAcknowledgement | null;
  cancellation: CancellationRequest | null;
  acknowledgedCancelGeneration: number | null;
  settled: boolean;
}

const EMPTY_SNAPSHOT: SceneExecutorSnapshot = deepFreeze({
  sceneToken: null,
  planId: null,
  phase: null,
  emittedMarkers: [],
  consequenceCommitCount: 0,
  publishedRevision: null,
  cancelGeneration: 0,
  acknowledgedCancelGeneration: null,
  elapsedMs: 0,
  settled: false,
  disposed: false,
});

/** Create one deterministic, scheduler-free marker runtime. */
export function createSceneExecutor(options: SceneExecutorOptions = {}): SceneExecutor {
  return new MarkerDrivenSceneExecutor(options);
}

/** Executes one immutable marker program at a time from injected scene-local elapsed time. */
export class MarkerDrivenSceneExecutor implements SceneExecutor {
  private active: ActiveExecution | null = null;
  private lastToken = 0;
  private disposed = false;
  private readonly onFailure: ((failure: ObserverRendererFailure) => void) | undefined;

  constructor(options: SceneExecutorOptions = {}) {
    this.onFailure = options.onFailure;
  }

  start(input: SceneRuntimeStart, identity: FrameIdentity): number {
    if (this.disposed) throw new Error("SceneExecutor is disposed.");
    if (this.active !== null && !this.active.settled) {
      throw new Error("Cannot start SceneExecutor while a scene is unsettled.");
    }
    assertValidFrameIdentity(identity);
    validateRuntimeStart(input);
    if (this.lastToken >= Number.MAX_SAFE_INTEGER) {
      throw new RangeError("SceneExecutor token space is exhausted.");
    }

    const ownedInput = deepFreeze(structuredClone(input) as SceneRuntimeStart);
    const ownedIdentity = deepFreeze(structuredClone(identity) as FrameIdentity);
    const token = this.lastToken + 1;
    this.lastToken = token;
    this.active = {
      token,
      identity: ownedIdentity,
      input: ownedInput,
      elapsedMs: 0,
      deferredTargetMs: 0,
      nextMarkerIndex: 0,
      emittedMarkers: [],
      omittedMarkers: new Set(),
      consequenceEmitted: false,
      publication: null,
      cancellation: null,
      acknowledgedCancelGeneration: null,
      settled: false,
    };
    return token;
  }

  advance(elapsedMs: number): readonly SceneRuntimeSignal[] {
    if (this.disposed || this.active === null || this.active.settled) return [];
    if (!Number.isFinite(elapsedMs) || elapsedMs < 0) {
      throw new RangeError("SceneExecutor elapsed time must be finite and non-negative.");
    }
    const active = this.active;
    if (elapsedMs < active.elapsedMs) {
      throw new RangeError("SceneExecutor elapsed time must be monotonic.");
    }
    active.deferredTargetMs = Math.max(active.deferredTargetMs, elapsedMs);
    if (active.consequenceEmitted && active.publication === null) return [];

    const targetMs = active.deferredTargetMs;
    const signals: SceneRuntimeSignal[] = [];
    const markers = active.input.program.markers;
    while (active.nextMarkerIndex < markers.length) {
      const marker = markers[active.nextMarkerIndex]!;
      if (marker.atMs > targetMs) break;
      active.nextMarkerIndex += 1;
      active.elapsedMs = marker.atMs;
      if (active.omittedMarkers.has(marker.name)) continue;
      active.emittedMarkers.push(marker.name);

      if (marker.role === "consequence") {
        if (!active.consequenceEmitted) {
          active.consequenceEmitted = true;
          signals.push(freezeSignal({
            kind: "consequence-marker",
            sceneToken: active.token,
            marker: marker.name,
          }));
        }
        return Object.freeze(signals);
      }

      if (marker.role === "safe-cancel") {
        const cancellation = active.cancellation;
        if (
          cancellation !== null
          && cancellation.generation > (active.acknowledgedCancelGeneration ?? -1)
        ) {
          signals.push(freezeSignal({
            kind: "safe-cancel-ack",
            sceneToken: active.token,
            cancelApplied: true,
            cancelGeneration: cancellation.generation,
          }));
          active.acknowledgedCancelGeneration = cancellation.generation;
          active.settled = true;
          signals.push(freezeSignal({ kind: "scene-settled", sceneToken: active.token }));
          return Object.freeze(signals);
        }
        if (active.acknowledgedCancelGeneration === null) {
          signals.push(freezeSignal({
            kind: "safe-cancel-ack",
            sceneToken: active.token,
            cancelApplied: false,
            cancelGeneration: 0,
          }));
          active.acknowledgedCancelGeneration = 0;
        }
        continue;
      }

      if (marker.role === "settle") {
        if (active.acknowledgedCancelGeneration === null) {
          throw new Error("SceneExecutor reached settle before a safe boundary acknowledgement.");
        }
        active.settled = true;
        signals.push(freezeSignal({ kind: "scene-settled", sceneToken: active.token }));
        return Object.freeze(signals);
      }
    }
    active.elapsedMs = Math.max(active.elapsedMs, targetMs);
    return Object.freeze(signals);
  }

  reportUnavailableMarker(sceneToken: number, markerName: string): void {
    const active = this.currentToken(sceneToken);
    if (active === null || active.settled) return;
    const marker = active.input.program.markers.find(({ name }) => name === markerName);
    if (marker === undefined) throw new Error(`SceneExecutor marker ${markerName} is not declared.`);
    if (active.emittedMarkers.includes(markerName)) {
      throw new Error(`SceneExecutor marker ${markerName} was already emitted.`);
    }
    const decision = decideMarkerFallback({
      markerRole: marker.role,
      optional: marker.optional,
      subjectId: marker.name,
      regionId: active.input.moment.representative.event.region,
      occurrence: 1,
    });
    if (decision.action === "reject") {
      throw new Error(`SceneExecutor required causal marker ${markerName} is unavailable.`);
    }
    if (decision.action !== "continue" || decision.fallback !== "omit-optional-marker") {
      throw new Error(`SceneExecutor marker ${markerName} has no executable fallback.`);
    }
    if (active.omittedMarkers.has(markerName)) return;
    active.omittedMarkers.add(markerName);
    const failure = publicRendererFailure(decision);
    if (failure !== null) this.onFailure?.(failure);
  }

  acknowledgePublishedConsequence(
    sceneToken: number,
    publishedRevision: number,
    cancelRequested: boolean,
    cancelGeneration: number,
  ): void {
    const active = this.currentToken(sceneToken);
    if (active === null || active.settled) return;
    if (!active.consequenceEmitted) {
      throw new Error("Cannot acknowledge a consequence before its marker.");
    }
    if (!Number.isSafeInteger(publishedRevision) || publishedRevision < 0) {
      throw new RangeError("Published consequence revision must be a non-negative safe integer.");
    }
    if (publishedRevision <= active.identity.revision) {
      throw new RangeError("Published consequence revision must be newer than the start identity.");
    }
    const candidate: PublicationAcknowledgement = {
      revision: publishedRevision,
      cancelRequested,
      cancelGeneration,
    };
    if (active.publication !== null) {
      if (!samePublication(active.publication, candidate)) {
        throw new Error("SceneExecutor received a conflicting publication acknowledgement.");
      }
      return;
    }
    validateCancelAcknowledgement(active, cancelRequested, cancelGeneration);
    active.publication = deepFreeze(candidate);
  }

  requestSafeCancel(sceneToken: number, reason: string, cancelGeneration: number): void {
    const active = this.currentToken(sceneToken);
    if (active === null || active.settled) return;
    if (!Number.isSafeInteger(cancelGeneration) || cancelGeneration <= 0) {
      if (active.cancellation !== null && cancelGeneration < active.cancellation.generation) return;
      throw new RangeError("Safe cancellation generation must be a positive safe integer.");
    }
    if (reason.trim().length === 0) throw new Error("Safe cancellation reason must not be empty.");
    const previous = active.cancellation;
    if (previous !== null) {
      if (cancelGeneration < previous.generation) return;
      if (cancelGeneration === previous.generation) {
        if (reason !== previous.reason) {
          throw new Error("SceneExecutor received a conflicting safe cancellation request.");
        }
        return;
      }
    }
    if (active.publication !== null && !active.publication.cancelRequested) {
      // A later generation is valid after the normal generation-zero boundary.
    }
    active.cancellation = deepFreeze({ reason, generation: cancelGeneration });
  }

  nextDeadlineMs(): number | null {
    if (this.disposed || this.active === null || this.active.settled) return null;
    const active = this.active;
    if (active.consequenceEmitted && active.publication === null) return null;
    if (active.publication !== null && active.deferredTargetMs > active.elapsedMs) {
      return active.elapsedMs;
    }
    return active.input.program.markers[active.nextMarkerIndex]?.atMs ?? null;
  }

  snapshot(): SceneExecutorSnapshot {
    if (this.disposed) return deepFreeze({ ...EMPTY_SNAPSHOT, disposed: true });
    const active = this.active;
    if (active === null) return EMPTY_SNAPSHOT;
    return deepFreeze({
      sceneToken: active.token,
      planId: active.input.program.id,
      phase: phaseAt(active.input.program, active.elapsedMs),
      emittedMarkers: [...active.emittedMarkers],
      consequenceCommitCount: active.consequenceEmitted ? 1 : 0,
      publishedRevision: active.publication?.revision ?? null,
      cancelGeneration: active.cancellation?.generation ?? 0,
      acknowledgedCancelGeneration: active.acknowledgedCancelGeneration,
      elapsedMs: active.elapsedMs,
      settled: active.settled,
      disposed: false,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active = null;
  }

  private currentToken(sceneToken: number): ActiveExecution | null {
    if (this.disposed || this.active === null || sceneToken !== this.active.token) return null;
    return this.active;
  }
}

function validateRuntimeStart(input: SceneRuntimeStart): void {
  if (input.moment.id.trim().length === 0) throw new Error("Scene moment id must not be empty.");
  validateProgram(input.program, input.moment.id);
}

function validateProgram(program: SceneRuntimeProgram, momentId: string): void {
  if (program.id.trim().length === 0) throw new Error("Scene program id must not be empty.");
  if (!Number.isFinite(program.durationMs) || program.durationMs <= 0) {
    throw new RangeError("Scene duration must be positive and finite.");
  }
  validateWindows(program, momentId);
  validateMarkers(program);
}

function validateWindows(program: SceneRuntimeProgram, momentId: string): void {
  if (program.phaseWindows.length === 0 || program.phases.length !== program.phaseWindows.length) {
    throw new Error("Scene phases and windows must be non-empty and have equal length.");
  }
  let expectedStart = 0;
  for (const [index, window] of program.phaseWindows.entries()) {
    if (!Number.isFinite(window.startMs) || !Number.isFinite(window.endMs)) {
      throw new RangeError("Scene phase times must be finite.");
    }
    if (window.startMs !== expectedStart || window.endMs <= window.startMs) {
      throw new Error("Scene phase windows must be ordered, contiguous, and non-overlapping.");
    }
    const view = program.phases[index]!;
    if (view.phase !== window.phase) throw new Error("Scene phase view must match its window.");
    if (view.momentId !== momentId) throw new Error("Scene phase view belongs to another moment.");
    expectedStart = window.endMs;
  }
  if (expectedStart !== program.durationMs) {
    throw new Error("Scene phase windows must cover the complete duration.");
  }
}

function validateMarkers(program: SceneRuntimeProgram): void {
  if (program.markers.length === 0) throw new Error("Scene marker timeline must not be empty.");
  const names = new Set<string>();
  let previous: SceneRuntimeMarker | null = null;
  for (const marker of program.markers) {
    if (marker.name.trim().length === 0) throw new Error("Scene marker name must not be empty.");
    if (names.has(marker.name)) throw new Error(`Scene marker ${marker.name} is duplicated.`);
    names.add(marker.name);
    if (!Number.isFinite(marker.atMs) || marker.atMs < 0 || marker.atMs > program.durationMs) {
      throw new RangeError(`Scene marker ${marker.name} time is outside the program duration.`);
    }
    if (!Number.isSafeInteger(marker.order)) {
      throw new RangeError(`Scene marker ${marker.name} order must be a safe integer.`);
    }
    if (previous !== null && compareMarker(previous, marker) >= 0) {
      throw new Error("Scene marker timeline must be in stable causal order.");
    }
    previous = marker;
  }

  const consequences = program.markers.filter((marker) => marker.role === "consequence");
  if (consequences.length !== 1) throw new Error("Scene program must declare exactly one consequence marker.");
  const consequence = consequences[0]!;
  if (consequence.optional) throw new Error("Scene consequence marker cannot be optional.");
  if (consequence.name !== program.consequenceMarker) {
    throw new Error("Scene consequence marker name does not match the program contract.");
  }

  if (program.safeCancelMarkers.length === 0) {
    throw new Error("Scene program must declare at least one safe cancellation marker.");
  }
  if (new Set(program.safeCancelMarkers).size !== program.safeCancelMarkers.length) {
    throw new Error("Scene safe cancellation markers must be unique.");
  }
  for (const name of program.safeCancelMarkers) {
    const marker = program.markers.find((candidate) => candidate.name === name);
    if (marker?.role !== "safe-cancel") {
      throw new Error(`Scene safe cancellation marker ${name} is not declared.`);
    }
    if (compareMarker(marker, consequence) <= 0) {
      throw new Error("Scene safe cancellation markers must follow the consequence marker.");
    }
  }
  const undeclaredSafe = program.markers.find((marker) => (
    marker.role === "safe-cancel" && !program.safeCancelMarkers.includes(marker.name)
  ));
  if (undeclaredSafe !== undefined) {
    throw new Error(`Scene safe cancellation marker ${undeclaredSafe.name} is missing from the program list.`);
  }

  const settleMarkers = program.markers.filter((marker) => marker.role === "settle");
  if (settleMarkers.length !== 1) throw new Error("Scene program must declare exactly one settle marker.");
  const settle = settleMarkers[0]!;
  if (settle.optional || settle.atMs !== program.durationMs) {
    throw new Error("Scene settle marker must be required at the final duration boundary.");
  }
  const lastSafe = lastMarkerWithRole(program.markers, "safe-cancel");
  if (lastSafe === undefined || compareMarker(lastSafe, settle) >= 0) {
    throw new Error("Scene settle marker must follow a final safe cancellation boundary.");
  }
  if (lastSafe.atMs !== program.durationMs) {
    throw new Error("Scene program must retain a safe cancellation boundary at final duration.");
  }
}

function lastMarkerWithRole(
  markers: readonly SceneRuntimeMarker[],
  role: SceneRuntimeMarker["role"],
): SceneRuntimeMarker | undefined {
  for (let index = markers.length - 1; index >= 0; index -= 1) {
    const marker = markers[index]!;
    if (marker.role === role) return marker;
  }
  return undefined;
}

function validateCancelAcknowledgement(
  active: ActiveExecution,
  cancelRequested: boolean,
  cancelGeneration: number,
): void {
  if (!Number.isSafeInteger(cancelGeneration) || cancelGeneration < 0) {
    throw new RangeError("Publication cancellation generation must be a non-negative safe integer.");
  }
  const pending = active.cancellation;
  if (cancelRequested) {
    if (pending === null) throw new Error("Publication acknowledged an unknown cancellation.");
    if (cancelGeneration !== pending.generation) {
      throw new Error("Publication cancellation generation does not match the active generation.");
    }
    return;
  }
  if (cancelGeneration !== 0) {
    throw new Error("Normal publication acknowledgement must use cancellation generation zero.");
  }
  if (pending !== null) {
    throw new Error("Publication acknowledgement omitted the pending cancellation.");
  }
}

function samePublication(
  left: PublicationAcknowledgement,
  right: PublicationAcknowledgement,
): boolean {
  return left.revision === right.revision
    && left.cancelRequested === right.cancelRequested
    && left.cancelGeneration === right.cancelGeneration;
}

function phaseAt(program: SceneRuntimeProgram, elapsedMs: number): PresentedSceneView["phase"] {
  return program.phaseWindows.find((window) => (
    elapsedMs >= window.startMs && elapsedMs < window.endMs
  ))?.phase ?? program.phaseWindows.at(-1)!.phase;
}

function compareMarker(left: SceneRuntimeMarker, right: SceneRuntimeMarker): number {
  return left.atMs - right.atMs || left.order - right.order;
}

function freezeSignal<T extends SceneRuntimeSignal>(signal: T): T {
  return Object.freeze(signal);
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}
