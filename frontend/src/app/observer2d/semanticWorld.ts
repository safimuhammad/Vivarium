import type {
  FrameIdentity,
  ObserverSelection,
  PresentedObserverFrame,
  PresentedRecord,
} from "../../presentation/contracts";
import type { HomeSnapshot } from "../schemas";
import type {
  RendererSemanticSnapshot,
  RendererSemanticSubject,
  SemanticSubjectKind,
} from "../../renderer2d/production/semantics";
import { frameEntityIdDenylist, safePublicCopy, safePublicEntityName } from "./publicCopy";
import { formatRuinAge } from "./ruinAge";

const TILE_SIZE = 32;
const KIND_RANK: Readonly<Record<SemanticSubjectKind, number>> = Object.freeze({
  region: 0,
  agent: 1,
  home: 2,
  ruin: 3,
});

export interface SemanticSubjectView {
  readonly token: string;
  readonly kind: SemanticSubjectKind;
  readonly name: string;
  readonly status: string;
  readonly position: string;
  readonly currentAction: string;
  readonly selected: boolean;
  readonly canFollow: boolean;
}

export interface SemanticWorldView {
  readonly frameIdentity: FrameIdentity;
  readonly subjects: readonly SemanticSubjectView[];
}

export interface SemanticWorldStore {
  readonly getCurrent: () => SemanticWorldView | null;
  readonly getSnapshot: () => SemanticWorldView | null;
  readonly subscribe: (listener: () => void) => () => void;
  /** Identity-sensitive consumers can observe accepted frames even when subjects are shared. */
  readonly subscribeCurrent?: (listener: () => void) => () => void;
  readonly publish: (view: SemanticWorldView) => void;
  readonly clear: () => void;
}

interface OwnedSubjectToken {
  readonly token: string;
  selection: Exclude<ObserverSelection, null>;
}

interface SemanticProjectionIndexes {
  readonly agentNames: ReadonlyMap<string, string>;
  /** Backend-owned journey labels for actors whose semantic pose has no action. */
  readonly agentSpatialActions: ReadonlyMap<string, string>;
  readonly agentCompleteness: ReadonlyMap<string, "exact" | "projected-partial">;
  readonly regionCompleteness: ReadonlyMap<string, "exact" | "projected-partial">;
  readonly homeCompleteness: ReadonlyMap<string, "exact" | "projected-partial">;
  readonly ruinCompleteness: ReadonlyMap<string, "exact" | "projected-partial">;
  readonly homeOwnerIds: ReadonlyMap<string, string | null>;
  readonly ruinOwnerIds: ReadonlyMap<string, string | null>;
  readonly ruinedAt: ReadonlyMap<string, number | null>;
  readonly worldTime: number;
  readonly activeRegionId: string | null;
}

/** Owns opaque, monotonic DOM tokens while keeping callback identities outside public views. */
export class SemanticSubjectTokenRegistry {
  readonly #byStableKey = new Map<string, OwnedSubjectToken>();
  readonly #byToken = new Map<string, OwnedSubjectToken>();
  #nextToken = 1;

  get size(): number { return this.#byStableKey.size; }

  tokenFor(subject: RendererSemanticSubject): string {
    const key = registryKey(subject);
    const existing = this.#byStableKey.get(key);
    if (existing !== undefined) {
      existing.selection = copySelection(subject.selection);
      return existing.token;
    }
    const owned: OwnedSubjectToken = {
      token: `subject-${this.#nextToken++}`,
      selection: copySelection(subject.selection),
    };
    this.#byStableKey.set(key, owned);
    this.#byToken.set(owned.token, owned);
    return owned.token;
  }

  selectionFor(token: string): Exclude<ObserverSelection, null> | null {
    const selection = this.#byToken.get(token)?.selection;
    return selection === undefined ? null : copySelection(selection);
  }

  retain(subjects: readonly RendererSemanticSubject[]): void {
    const retained = new Set(subjects.map(registryKey));
    for (const [key, owned] of this.#byStableKey) {
      if (retained.has(key)) continue;
      this.#byStableKey.delete(key);
      this.#byToken.delete(owned.token);
    }
  }

  clear(): void {
    this.#byStableKey.clear();
    this.#byToken.clear();
  }
}

/** Owns semantic render state without coupling renderer publications to the app root. */
export function createSemanticWorldStore(): SemanticWorldStore {
  let current: SemanticWorldView | null = null;
  let rendered: SemanticWorldView | null = null;
  const listeners = new Set<() => void>();
  const currentListeners = new Set<() => void>();
  const getCurrent = (): SemanticWorldView | null => current;
  const getSnapshot = (): SemanticWorldView | null => rendered;
  const notify = (): void => {
    for (const listener of listeners) listener();
  };
  return Object.freeze({
    getCurrent,
    getSnapshot,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    subscribeCurrent(listener: () => void): () => void {
      currentListeners.add(listener);
      return () => currentListeners.delete(listener);
    },
    publish(view: SemanticWorldView): void {
      const priorSubjects = current?.subjects;
      current = view;
      for (const listener of currentListeners) listener();
      if (priorSubjects === view.subjects) return;
      rendered = view;
      notify();
    },
    clear(): void {
      if (current === null) return;
      current = null;
      rendered = null;
      for (const listener of currentListeners) listener();
      notify();
    },
  });
}

/** Resolves renderer-only semantic truth through the exactly matching public frame. */
export function projectSemanticWorld(
  frame: PresentedObserverFrame,
  snapshot: RendererSemanticSnapshot,
  tokens: SemanticSubjectTokenRegistry,
  observedRegionId: string | null,
  prior: SemanticWorldView | null = null,
): SemanticWorldView | null {
  if (!sameFrameIdentity(frame, snapshot.frameIdentity)) return null;
  if (!hasCanonicalSubjectOrder(snapshot.subjects)) return null;
  const indexes = buildProjectionIndexes(frame);
  const canSharePrior = prior !== null
    && sameFrameLineage(prior.frameIdentity, snapshot.frameIdentity);
  const priorByToken = canSharePrior
    ? new Map(prior.subjects.map((subject) => [subject.token, subject]))
    : null;
  const projected = snapshot.subjects.map((subject) => {
    const next = projectSubject(
      frame,
      subject,
      tokens.tokenFor(subject),
      observedRegionId,
      indexes,
    );
    const previous = priorByToken?.get(next.token);
    return previous !== undefined && sameSubjectView(previous, next) ? previous : next;
  });
  const subjects = canSharePrior
    && prior.subjects.length === projected.length
    && projected.every((subject, index) => subject === prior.subjects[index])
    ? prior.subjects
    : Object.freeze(projected);
  tokens.retain(snapshot.subjects);
  return Object.freeze({
    frameIdentity: copyFrameIdentity(snapshot.frameIdentity),
    subjects,
  });
}

export function sameFrameIdentity(
  left: FrameIdentity,
  right: FrameIdentity,
): boolean {
  return left.runId === right.runId
    && left.sourceKey === right.sourceKey
    && left.revision === right.revision
    && left.firstCursor === right.firstCursor
    && left.lastCursor === right.lastCursor;
}

function projectSubject(
  frame: PresentedObserverFrame,
  subject: RendererSemanticSubject,
  token: string,
  observedRegionId: string | null,
  indexes: SemanticProjectionIndexes,
): SemanticSubjectView {
  const completeness = subjectCompleteness(indexes, subject);
  const name = subjectName(subject, indexes);
  return Object.freeze({
    token,
    kind: subject.kind,
    name,
    status: publicStatus(subject, completeness, observedRegionId, indexes),
    position: publicPosition(subject, completeness),
    currentAction: subject.kind === "agent"
      ? indexes.agentSpatialActions.get(subject.selection.id) ?? publicAction(subject.action)
      : publicAction(subject.action),
    selected: sameSelection(frame.selection, subject.selection),
    canFollow: subject.kind === "agent"
      || (subject.kind === "home" && subject.status.toLowerCase() === "standing"),
  });
}

function subjectName(
  subject: RendererSemanticSubject,
  indexes: SemanticProjectionIndexes,
): string {
  switch (subject.kind) {
    case "region": return regionDisplayName(subject.regionId);
    case "agent": return indexes.agentNames.get(subject.selection.id) ?? "Unknown being";
    case "home": return `${ownerName(indexes.homeOwnerIds, subject.selection.id, indexes.agentNames)}'s home`;
    case "ruin": return `${ownerName(indexes.ruinOwnerIds, subject.selection.id, indexes.agentNames)}'s former home`;
  }
}

function ownerName(
  ownerIds: ReadonlyMap<string, string | null>,
  id: string,
  names: ReadonlyMap<string, string>,
): string {
  const ownerId = ownerIds.get(id);
  return ownerId === undefined || ownerId === null
    ? "Unknown being"
    : names.get(ownerId) ?? "Unknown being";
}

function publicStatus(
  subject: RendererSemanticSubject,
  completeness: "exact" | "projected-partial",
  observedRegionId: string | null,
  indexes: SemanticProjectionIndexes,
): string {
  if (subject.kind === "region") {
    const labels = [completeness === "exact" ? "Exact" : "Awaiting exact checkpoint"];
    if (indexes.activeRegionId === subject.regionId) labels.push("active");
    if (observedRegionId === subject.regionId) labels.push("observed");
    return labels.join(", ");
  }
  if (completeness === "projected-partial") return "Status awaiting checkpoint";
  if (subject.kind === "ruin") {
    const ruinedAt = indexes.ruinedAt.get(subject.selection.id) ?? null;
    return ruinedAt === null
      ? "Ruin"
      : `Ruin, ${formatRuinAge(indexes.worldTime, ruinedAt)} old`;
  }
  const normalized = subject.status.trim().toLowerCase();
  if (subject.kind === "agent" && AGENT_STATUSES.has(normalized)) return titleWords(normalized);
  if (subject.kind === "home" && HOME_STATUSES.has(normalized)) return titleWords(normalized);
  return "Status awaiting checkpoint";
}

function publicPosition(
  subject: RendererSemanticSubject,
  completeness: "exact" | "projected-partial",
): string {
  if (subject.kind === "region") return "Current world view";
  if (completeness === "projected-partial" || subject.position === null) {
    return "Position awaiting checkpoint";
  }
  return `${regionDisplayName(subject.regionId)}, column ${Math.floor(subject.position.x / TILE_SIZE)}, row ${Math.floor(subject.position.y / TILE_SIZE)}`;
}

function subjectCompleteness(
  indexes: SemanticProjectionIndexes,
  subject: RendererSemanticSubject,
): "exact" | "projected-partial" {
  switch (subject.kind) {
    case "region": return indexes.regionCompleteness.get(subject.regionId)
      ?? "projected-partial";
    case "agent": return indexes.agentCompleteness.get(subject.selection.id)
      ?? "projected-partial";
    case "home": return indexes.homeCompleteness.get(subject.selection.id)
      ?? "projected-partial";
    case "ruin": return indexes.ruinCompleteness.get(subject.selection.id)
      ?? "projected-partial";
  }
}

function buildProjectionIndexes(frame: PresentedObserverFrame): SemanticProjectionIndexes {
  const deniedIds = frameEntityIdDenylist(frame);
  const regionCompleteness = new Map<string, "exact" | "projected-partial">();
  const landmarkNames = new Map<string, string>();
  for (const record of frame.world.regions) {
    if (typeof record.value.name !== "string") continue;
    retainFirst(regionCompleteness, record.value.name, record.completeness);
    const spatial = record.value.spatial;
    if (spatial === undefined) continue;
    for (const landmark of spatial.landmarks) {
      retainFirst(
        landmarkNames,
        spatialLandmarkKey(spatial.region_id, spatial.map_id, landmark.id),
        safePublicCopy(landmark.name, "the destination", deniedIds),
      );
    }
  }
  const agentNames = new Map<string, string>();
  const agentSpatialActions = new Map<string, string>();
  const agentCompleteness = new Map<string, "exact" | "projected-partial">();
  for (const record of frame.world.agents) {
    if (typeof record.value.id !== "string") continue;
    retainFirst(
      agentNames,
      record.value.id,
      safePublicEntityName(deniedIds, record.value.name),
    );
    retainFirst(agentCompleteness, record.value.id, record.completeness);
    const spatial = record.value.spatial;
    if (spatial?.travel === null || spatial === undefined) continue;
    const destination = landmarkNames.get(
      spatialLandmarkKey(spatial.region_id, spatial.map_id, spatial.travel.destination_id),
    ) ?? spatialDestinationName(spatial.travel.destination_id, deniedIds);
    retainFirst(agentSpatialActions, record.value.id, `Walking to ${destination}`);
  }
  const homeCompleteness = new Map<string, "exact" | "projected-partial">();
  const homeOwnerIds = new Map<string, string | null>();
  indexHomes(frame.world.homes, homeCompleteness, homeOwnerIds);
  const ruinCompleteness = new Map<string, "exact" | "projected-partial">();
  const ruinOwnerIds = new Map<string, string | null>();
  const ruinedAt = new Map<string, number | null>();
  indexHomes(frame.world.ruins, ruinCompleteness, ruinOwnerIds, ruinedAt);
  return {
    agentNames,
    agentSpatialActions,
    agentCompleteness,
    regionCompleteness,
    homeCompleteness,
    ruinCompleteness,
    homeOwnerIds,
    ruinOwnerIds,
    ruinedAt,
    worldTime: frame.world.worldTime,
    activeRegionId: frame.scene?.regionId ?? null,
  };
}

function spatialLandmarkKey(regionId: string, mapId: string, landmarkId: string): string {
  return `${regionId}\u0000${mapId}\u0000${landmarkId}`;
}

function spatialDestinationName(destinationId: string, deniedIds: ReturnType<typeof frameEntityIdDenylist>): string {
  if (!/^[a-z][a-z0-9_-]{0,79}$/iu.test(destinationId)) return "the destination";
  return safePublicCopy(
    titleWords(destinationId.replace(/[_-]+/gu, " ")),
    "the destination",
    deniedIds,
  );
}

function hasCanonicalSubjectOrder(subjects: readonly RendererSemanticSubject[]): boolean {
  let previousKindRank = Number.NEGATIVE_INFINITY;
  let previousStableKey: string | null = null;
  for (const subject of subjects) {
    const kindRank = KIND_RANK[subject.kind];
    if (!Number.isInteger(kindRank) || kindRank < previousKindRank) return false;
    if (kindRank === previousKindRank && previousStableKey !== null
      && previousStableKey.localeCompare(subject.stableSelectionKey) > 0) return false;
    previousKindRank = kindRank;
    previousStableKey = subject.stableSelectionKey;
  }
  return true;
}

function indexHomes(
  records: readonly PresentedRecord<HomeSnapshot>[],
  completeness: Map<string, "exact" | "projected-partial">,
  ownerIds: Map<string, string | null>,
  ruinedAt?: Map<string, number | null>,
): void {
  for (const record of records) {
    const id = record.value.home_id;
    if (typeof id !== "string") continue;
    retainFirst(completeness, id, record.completeness);
    retainFirst(ownerIds, id, typeof record.value.owner_id === "string"
      ? record.value.owner_id
      : null);
    const ageOrigin = finiteNumber(record.value.ruined_at);
    if (ruinedAt !== undefined) retainFirst(ruinedAt, id, ageOrigin);
  }
}

function retainFirst<K, V>(map: Map<K, V>, key: K, value: V): void {
  if (!map.has(key)) map.set(key, value);
}

function sameSubjectView(left: SemanticSubjectView, right: SemanticSubjectView): boolean {
  return left.token === right.token
    && left.kind === right.kind
    && left.name === right.name
    && left.status === right.status
    && left.position === right.position
    && left.currentAction === right.currentAction
    && left.selected === right.selected
    && left.canFollow === right.canFollow;
}

function sameFrameLineage(left: FrameIdentity, right: FrameIdentity): boolean {
  return left.runId === right.runId && left.sourceKey === right.sourceKey;
}

function regionDisplayName(value: string): string {
  if (!/^[a-zA-Z][a-zA-Z0-9 _-]{0,79}$/.test(value)) return "Unknown region";
  return value.trim().replace(/[_-]+/g, " ").split(/\s+/).map(titleWords).join(" ");
}

function publicAction(value: string | null): string {
  if (value === null) return "No active action";
  const normalized = value.trim().replace(/[_-]+/g, " ");
  if (normalized.length === 0 || normalized.toLowerCase() === "idle"
    || !SEMANTIC_ACTIONS.has(normalized.toLowerCase())) return "No active action";
  return titleWords(normalized);
}

function titleWords(value: string): string {
  return value.split(/\s+/).map((word) => (
    word.length === 0 ? word : word[0]!.toUpperCase() + word.slice(1).toLowerCase()
  )).join(" ");
}

function sameSelection(left: ObserverSelection, right: Exclude<ObserverSelection, null>): boolean {
  return left !== null && left.kind === right.kind && left.id === right.id;
}

function registryKey(subject: RendererSemanticSubject): string {
  return `${subject.kind}\u0000${subject.stableSelectionKey}`;
}

function copySelection(
  selection: Exclude<ObserverSelection, null>,
): Exclude<ObserverSelection, null> {
  return { ...selection };
}

function copyFrameIdentity(identity: FrameIdentity): FrameIdentity {
  return Object.freeze({
    runId: identity.runId,
    sourceKey: identity.sourceKey,
    revision: identity.revision,
    firstCursor: identity.firstCursor,
    lastCursor: identity.lastCursor,
  });
}

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

const AGENT_STATUSES = new Set(["alive", "paralyzed", "dead"]);
const HOME_STATUSES = new Set(["standing"]);
const SEMANTIC_ACTIONS = new Set([
  "moving", "orienting", "speaking", "reaching", "working", "kneeling", "gathering",
  "hurt", "prone", "recovering", "dead", "building", "door change", "hearth change",
  "damaged", "looted", "claimed", "collapsing", "scavenged",
]);
