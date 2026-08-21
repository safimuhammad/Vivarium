import {
  normalizeRegionPressure,
  type EventEnvelopeEntry,
  type HomeSnapshot,
  type WorldSnapshot,
} from "../app/schemas";
import { assertValidFrameIdentity, type ClassifiedCheckpointRecord, type CursorRange, type FrameIdentity, type PresentedRecord, type PresentedWorldView } from "./contracts";
import {
  createPresentedEventProjector,
  createProjectedWorldState,
  type PresentedEventProjector,
  type PresentedHoardThresholds,
  type ProjectedWorldState,
  type ProjectionResult,
} from "./PresentedEventProjector";
import { parsePresentedEvent, type TypedPresentedEvent } from "./eventPayloads";

export interface ProjectionBatchResult extends ProjectionResult {
  readonly firstCursor: number;
  readonly lastCursor: number;
}

export type ReconciliationDisposition =
  | "applied"
  | "retryable-future"
  | "stale"
  | "permanent-invalid"
  | "unsafe";

export interface ReconciliationResult {
  readonly applied: boolean;
  /** Whether this candidate is terminal and may be released by its owner. */
  readonly processed: boolean;
  readonly disposition: ReconciliationDisposition;
  readonly line: number;
  readonly eventCursor: number;
  readonly correctionEntityIds: readonly string[];
}

export interface PreparedWorldReplacement {
  readonly runId: string;
  readonly eventCursor: number;
}

interface OwnedPreparedWorldReplacement extends PreparedWorldReplacement {
  readonly owner: PresentedWorldModel;
  readonly priorState: ProjectedWorldState;
  readonly priorView: PresentedWorldView;
  readonly priorEvidenceSuffix: readonly EventEnvelopeEntry[];
  readonly priorCheckpointLine: number;
  readonly nextState: ProjectedWorldState;
  readonly nextView: PresentedWorldView;
  status: "prepared" | "committed" | "rolled-back";
}

/** Owns exact snapshot truth plus a contiguous, typed event-evidence suffix. */
export class PresentedWorldModel {
  private identity: FrameIdentity;
  private state: ProjectedWorldState;
  private view: PresentedWorldView;
  private evidenceSuffix: readonly EventEnvelopeEntry[] = [];
  private lastProcessedSafeCheckpointLine = 0;
  private disposed = false;
  private readonly projector: PresentedEventProjector;

  constructor(
    snapshot: WorldSnapshot,
    identity: FrameIdentity,
    thresholds?: PresentedHoardThresholds,
  ) {
    const initialized = prepareExactState(snapshot, identity);
    this.projector = createPresentedEventProjector(thresholds);
    this.identity = cloneIdentity(identity);
    this.state = initialized;
    this.view = viewFromState(initialized);
  }

  applyEvidence(entries: readonly EventEnvelopeEntry[]): ProjectionBatchResult {
    if (this.disposed) return inertBatch(this.state);
    validateEvidenceCursors(entries, this.state.projectedThroughCursor);
    const ownedEntries = structuredClone(entries) as EventEnvelopeEntry[];
    const parsed = ownedEntries.map(parsePresentedEvent);
    let draft = this.state;
    const appliedFields: string[] = [];
    const unresolvedFields: string[] = [];

    for (const event of parsed) {
      if (!event.known) {
        draft = { ...draft, projectedThroughCursor: event.entry.cursor };
        continue;
      }
      const result = this.projector.project(draft, event.evidence);
      draft = result.state;
      appendUnique(appliedFields, result.appliedFields);
      appendUnique(unresolvedFields, result.unresolvedFields);
    }

    draft = freezeProjectedState(draft);
    this.state = draft;
    this.evidenceSuffix = deepFreeze([...this.evidenceSuffix, ...ownedEntries]);
    this.view = viewFromState(draft);
    return {
      state: detachProjectedState(draft),
      appliedFields,
      unresolvedFields,
      firstCursor: ownedEntries[0].cursor,
      lastCursor: ownedEntries[ownedEntries.length - 1].cursor,
    };
  }

  reconcile(record: ClassifiedCheckpointRecord): ReconciliationResult {
    if (this.disposed) return reconciliationResult(record, "permanent-invalid");
    if (!Number.isSafeInteger(record.line) || record.line <= 0) {
      return reconciliationResult(record, "permanent-invalid");
    }
    if (record.line <= this.lastProcessedSafeCheckpointLine) {
      return reconciliationResult(record, "stale");
    }

    if (record.safety !== "safe-world-tick") {
      return reconciliationResult(record, "unsafe");
    }

    const checkpoint = record.checkpoint;
    const snapshot = checkpoint.snapshot;
    if (
      checkpoint.run_id !== this.identity.runId
      || snapshot.run_id !== this.identity.runId
      || checkpoint.run_id !== snapshot.run_id
      || checkpoint.event_cursor !== snapshot.event_cursor
      || checkpoint.world_time !== snapshot.world_time
      || checkpoint.event_cursor < this.state.exactBase.event_cursor
      || checkpoint.world_time < this.state.exactBase.world_time
    ) {
      this.lastProcessedSafeCheckpointLine = record.line;
      return reconciliationResult(record, "permanent-invalid");
    }
    if (checkpoint.event_cursor > this.state.projectedThroughCursor) {
      return reconciliationResult(record, "retryable-future");
    }

    const exactIdentity = {
      ...this.identity,
      firstCursor: snapshot.event_cursor,
      lastCursor: snapshot.event_cursor,
    };
    let draft = prepareExactState(snapshot, exactIdentity);
    const retained = this.evidenceSuffix.filter((entry) => entry.cursor > snapshot.event_cursor);
    for (const entry of retained) {
      const parsed = parsePresentedEvent(entry);
      if (!parsed.known) {
        draft = { ...draft, projectedThroughCursor: entry.cursor };
      } else {
        draft = this.projector.project(draft, parsed.evidence).state;
      }
    }
    draft = freezeProjectedState(draft);
    const nextView = viewFromState(draft);
    const corrections = correctionEntityIds(this.view, nextView);

    this.state = draft;
    this.evidenceSuffix = retained;
    this.lastProcessedSafeCheckpointLine = record.line;
    this.view = nextView;
    return reconciliationResult(record, "applied", corrections);
  }

  replaceWithForwardSnapshot(snapshot: WorldSnapshot, cursorRange: CursorRange): void {
    if (this.disposed) return;
    const prepared = this.prepareForwardSnapshot(snapshot, cursorRange);
    this.commitPreparedForwardSnapshot(prepared);
  }

  /** Validate and own a forward snapshot without changing the selected world view. */
  prepareForwardSnapshot(
    snapshot: WorldSnapshot,
    cursorRange: CursorRange,
  ): PreparedWorldReplacement {
    if (this.disposed) throw new Error("presented world model is disposed");
    validateCursorRange(cursorRange);
    if (snapshot.run_id !== this.identity.runId) throw new Error(`snapshot run ${snapshot.run_id} does not match active run ${this.identity.runId}`);
    if (snapshot.event_cursor !== cursorRange.lastCursor) throw new Error("forward snapshot cursor must equal range end");
    if (snapshot.event_cursor < this.state.projectedThroughCursor) throw new RangeError("forward snapshot must not move behind projected evidence");
    const exactIdentity = { ...this.identity, firstCursor: snapshot.event_cursor, lastCursor: snapshot.event_cursor };
    const next = prepareExactState(snapshot, exactIdentity);
    const prepared: OwnedPreparedWorldReplacement = {
      owner: this,
      runId: snapshot.run_id,
      eventCursor: snapshot.event_cursor,
      priorState: this.state,
      priorView: this.view,
      priorEvidenceSuffix: this.evidenceSuffix,
      priorCheckpointLine: this.lastProcessedSafeCheckpointLine,
      nextState: next,
      nextView: viewFromState(next),
      status: "prepared",
    };
    return prepared;
  }

  /** Commit a locally prepared replacement without re-running external validation. */
  commitPreparedForwardSnapshot(value: PreparedWorldReplacement): void {
    const prepared = value as OwnedPreparedWorldReplacement;
    if (this.disposed) throw new Error("presented world model is disposed");
    if (
      prepared.owner !== this
      || prepared.status !== "prepared"
      || this.state !== prepared.priorState
    ) throw new Error("prepared world replacement is stale or belongs to another model");
    this.state = prepared.nextState;
    this.evidenceSuffix = [];
    this.lastProcessedSafeCheckpointLine = 0;
    this.view = prepared.nextView;
    prepared.status = "committed";
  }

  /** Roll back the exact prepared commit when a sibling owner cannot commit atomically. */
  rollbackPreparedForwardSnapshot(value: PreparedWorldReplacement): void {
    const prepared = value as OwnedPreparedWorldReplacement;
    if (
      prepared.owner !== this
      || prepared.status !== "committed"
      || this.state !== prepared.nextState
    ) return;
    this.state = prepared.priorState;
    this.view = prepared.priorView;
    this.evidenceSuffix = prepared.priorEvidenceSuffix;
    this.lastProcessedSafeCheckpointLine = prepared.priorCheckpointLine;
    prepared.status = "rolled-back";
  }

  getView(): PresentedWorldView {
    return this.view;
  }

  reset(snapshot: WorldSnapshot, identity: FrameIdentity): void {
    if (this.disposed) return;
    assertValidFrameIdentity(identity);
    if (
      identity.runId === this.identity.runId
      && identity.sourceKey === this.identity.sourceKey
      && identity.revision <= this.identity.revision
    ) throw new Error("reset identity is stale for the active run and source");
    const next = prepareExactState(snapshot, identity);
    const nextView = viewFromState(next);
    this.identity = cloneIdentity(identity);
    this.state = next;
    this.evidenceSuffix = [];
    this.lastProcessedSafeCheckpointLine = 0;
    this.view = nextView;
  }

  dispose(): void {
    this.disposed = true;
  }
}

function prepareExactState(snapshot: WorldSnapshot, identity: FrameIdentity): ProjectedWorldState {
  assertValidFrameIdentity(identity);
  validateSnapshot(snapshot);
  if (identity.runId !== snapshot.run_id) throw new Error("identity runId must match snapshot run_id");
  if (identity.firstCursor !== snapshot.event_cursor || identity.lastCursor !== snapshot.event_cursor) throw new Error("exact reset identity range must equal snapshot cursor");
  const owned = deepFreeze(structuredClone(snapshot));
  return freezeProjectedState(createProjectedWorldState(owned));
}

function validateSnapshot(snapshot: WorldSnapshot): void {
  if (snapshot.schema !== 1) throw new Error("world snapshot must use schema 1");
  if (snapshot.run_id.trim().length === 0) throw new Error("snapshot run_id must not be empty");
  if (!Number.isSafeInteger(snapshot.event_cursor) || snapshot.event_cursor < 0) throw new RangeError("snapshot event_cursor must be a non-negative safe integer");
  if (!Number.isFinite(snapshot.world_time)) throw new RangeError("snapshot world_time must be finite");
  assertUnique(snapshot.agents.map((agent) => agent.id), "agent id");
  assertUnique(snapshot.regions.map((region) => region.name), "region name");
  assertUnique(snapshot.homes.map((home) => home.home_id), "standing home id");
  assertUnique(snapshot.ruins.map((home) => home.home_id), "ruin id");
  assertUnique([...snapshot.homes, ...snapshot.ruins].map((home) => home.home_id), "home/ruin id");
  assertUnique(snapshot.pending_proposals.map((proposal) => `${proposal.initiator_id}\u0000${proposal.target_id}`), "proposal key");
}

function assertUnique(values: readonly string[], label: string): void {
  if (new Set(values).size !== values.length) throw new Error(`snapshot contains a duplicate ${label}`);
}

function validateEvidenceCursors(entries: readonly EventEnvelopeEntry[], projectedCursor: number): void {
  if (entries.length === 0) throw new RangeError("evidence batch must not be empty");
  let expected = projectedCursor + 1;
  for (const entry of entries) {
    if (!Number.isSafeInteger(entry.cursor) || entry.cursor < 0) throw new RangeError("evidence cursor must be a non-negative safe integer");
    if (entry.cursor !== expected) throw new RangeError(`expected contiguous evidence cursor ${expected}, received ${entry.cursor}`);
    expected += 1;
  }
}

function validateCursorRange(range: CursorRange): void {
  if (!Number.isSafeInteger(range.firstCursor) || range.firstCursor < 0) throw new RangeError("firstCursor must be a non-negative safe integer");
  if (!Number.isSafeInteger(range.lastCursor) || range.lastCursor < 0) throw new RangeError("lastCursor must be a non-negative safe integer");
  if (range.firstCursor > range.lastCursor) throw new RangeError("firstCursor must not exceed lastCursor");
}

function viewFromState(state: ProjectedWorldState): PresentedWorldView {
  const view: PresentedWorldView = {
    exactBaseCursor: state.exactBase.event_cursor,
    projectedThroughCursor: state.projectedThroughCursor,
    worldTime: state.exactBase.world_time,
    exactHomes: state.exactBase.homes,
    exactRuins: state.exactBase.ruins,
    agents: [...state.agents.values()].sort((left, right) => String(left.value.id).localeCompare(String(right.value.id))),
    regions: [...state.regions.values()].sort((left, right) => String(left.value.name).localeCompare(String(right.value.name))),
    homes: [...state.homes.values()].sort((left, right) => String(left.value.home_id).localeCompare(String(right.value.home_id))),
    ruins: [...state.ruins.values()].sort((left, right) => String(left.value.home_id).localeCompare(String(right.value.home_id))),
    pendingProposals: [...state.pendingProposals].sort(compareProposal),
    regionPressure: normalizeRegionPressure(
      state.exactBase.region_pressure,
      state.exactBase,
    ),
  };
  return deepFreeze(view);
}

function freezeProjectedState(state: ProjectedWorldState): ProjectedWorldState {
  for (const record of state.agents.values()) deepFreeze(record);
  for (const record of state.regions.values()) deepFreeze(record);
  for (const record of state.homes.values()) deepFreeze(record);
  for (const record of state.ruins.values()) deepFreeze(record);
  deepFreeze(state.pendingProposals);
  return Object.freeze(state);
}

function correctionEntityIds(before: PresentedWorldView, after: PresentedWorldView): readonly string[] {
  const changed = new Set<string>();
  compareRecords(before.agents, after.agents, "id", changed);
  compareRecords(before.regions, after.regions, "name", changed);
  compareHomePartitions(before, after, changed);
  return [...changed].sort();
}

function compareRecords<T>(
  before: readonly PresentedRecord<T>[],
  after: readonly PresentedRecord<T>[],
  key: keyof T,
  changed: Set<string>,
): void {
  const beforeById = new Map(before.map((record) => [String(record.value[key]), record]));
  const afterById = new Map(after.map((record) => [String(record.value[key]), record]));
  for (const id of new Set([...beforeById.keys(), ...afterById.keys()])) {
    if (!deepEqual(beforeById.get(id), afterById.get(id))) changed.add(id);
  }
}

function compareHomePartitions(before: PresentedWorldView, after: PresentedWorldView, changed: Set<string>): void {
  const beforeById = partitionedHomes(before);
  const afterById = partitionedHomes(after);
  for (const id of new Set([...beforeById.keys(), ...afterById.keys()])) {
    if (!deepEqual(beforeById.get(id), afterById.get(id))) changed.add(id);
  }
}

function partitionedHomes(view: PresentedWorldView): Map<string, { partition: "home" | "ruin"; record: PresentedRecord<HomeSnapshot> }> {
  const values = new Map<string, { partition: "home" | "ruin"; record: PresentedRecord<HomeSnapshot> }>();
  for (const record of view.homes) values.set(String(record.value.home_id), { partition: "home", record });
  for (const record of view.ruins) values.set(String(record.value.home_id), { partition: "ruin", record });
  return values;
}

function deepEqual(left: unknown, right: unknown): boolean {
  return stableSerialize(left) === stableSerialize(right);
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

function reconciliationResult(
  record: ClassifiedCheckpointRecord,
  disposition: ReconciliationDisposition,
  correctionEntityIds: readonly string[] = [],
): ReconciliationResult {
  return {
    applied: disposition === "applied",
    processed: disposition !== "retryable-future",
    disposition,
    line: record.line,
    eventCursor: record.checkpoint.event_cursor,
    correctionEntityIds,
  };
}

function inertBatch(state: ProjectedWorldState): ProjectionBatchResult {
  return { state: detachProjectedState(state), appliedFields: [], unresolvedFields: [], firstCursor: state.projectedThroughCursor, lastCursor: state.projectedThroughCursor };
}

function detachProjectedState(state: ProjectedWorldState): ProjectedWorldState {
  return Object.freeze({
    exactBase: state.exactBase,
    projectedThroughCursor: state.projectedThroughCursor,
    agents: new Map(state.agents),
    regions: new Map(state.regions),
    homes: new Map(state.homes),
    ruins: new Map(state.ruins),
    pendingProposals: state.pendingProposals,
  });
}

function appendUnique(target: string[], values: readonly string[]): void {
  for (const value of values) if (!target.includes(value)) target.push(value);
}

function compareProposal(left: { initiator_id: string; target_id: string }, right: { initiator_id: string; target_id: string }): number {
  return left.initiator_id.localeCompare(right.initiator_id) || left.target_id.localeCompare(right.target_id);
}

function cloneIdentity(identity: FrameIdentity): FrameIdentity {
  return Object.freeze({ ...identity });
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}
