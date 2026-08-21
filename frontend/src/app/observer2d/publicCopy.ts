import type { StoryMoment } from "../../presentation/BeatDirector";
import type { PresentedObserverFrame } from "../../presentation/contracts";

/** Exact opaque entity identifiers that public observer copy must never expose. */
export type EntityIdDenylist = ReadonlySet<string>;

interface CompiledEntityIdState {
  readonly plainIds: readonly string[];
  readonly underscoredLowerIds: readonly string[];
}

const COMPILED_ENTITY_IDS = new WeakMap<EntityIdDenylist, CompiledEntityIdState>();

const SENSITIVE_COPY = /(?:\b(?:provider|model|system[ _-]?prompt|prompt|context[ _-]?window|tokens?|latency|backend exception|source[ _-]?key|run[ _-]?id|raw json)\b|(?:^|[\s"'])(?:\/[^\s]+|[A-Za-z]:\\[^\s]+)|\b(?:ollama|gemini|qwen\d*)\b)/i;
const LEGACY_ENTITY_ID_SHAPE = /\b(?:agent|wanderer|home|ruin)_[a-z0-9_-]+\b/i;
const ENTITY_ID_PAYLOAD_KEY = /_ids?$/;

/** Collects agent, shelter, and ruin identifiers from the exact presented frame. */
export function frameEntityIdDenylist(frame: PresentedObserverFrame): EntityIdDenylist {
  const ids = new Set<string>();
  for (const record of frame.world.agents) addId(ids, record.value.id);
  for (const record of [...frame.world.homes, ...frame.world.ruins]) {
    addId(ids, record.value.home_id);
    addId(ids, record.value.owner_id);
    addIds(ids, record.value.stakeholders);
    addIds(ids, record.value.breachers);
  }
  if (frame.selection !== null && frame.selection.kind !== "region"
    && frame.selection.kind !== "moment") addId(ids, frame.selection.id);
  addId(ids, frame.checkpointFocus?.entityId);
  return compileEntityIdDenylist(ids);
}

/** Extends the frame denylist with opaque IDs carried by one presented moment. */
export function momentEntityIdDenylist(
  frame: PresentedObserverFrame,
  moment: StoryMoment,
): EntityIdDenylist {
  const ids = new Set(frameEntityIdDenylist(frame));
  for (const entry of moment.evidence) collectEntryIds(ids, entry);
  collectEntryIds(ids, moment.representative);
  return compileEntityIdDenylist(ids);
}

function collectEntryIds(ids: Set<string>, entry: StoryMoment["representative"]): void {
  addId(ids, entry.event.source);
  addId(ids, entry.event.target);
  addId(ids, entry.resolved.actor_id);
  addId(ids, entry.resolved.target_id);
  addId(ids, entry.resolved.home_id);
  collectPayloadIds(ids, entry.event.payload);
}

/** Returns authored copy only when it contains no infrastructure detail or denied entity ID. */
export function safePublicCopy(
  value: string,
  fallback: string,
  deniedIds: EntityIdDenylist = EMPTY_ENTITY_IDS,
): string {
  const trimmed = value.trim();
  return isSafePublicCopy(trimmed, deniedIds) ? trimmed : fallback;
}

/** Chooses the first public-safe candidate for an entity's display name. */
export function safePublicEntityName(
  deniedIds: EntityIdDenylist,
  ...candidates: readonly (string | undefined)[]
): string {
  for (const candidate of candidates) {
    if (candidate !== undefined && isSafePublicCopy(candidate.trim(), deniedIds)) {
      return candidate.trim();
    }
  }
  return "Unknown being";
}

function collectPayloadIds(ids: Set<string>, payload: Readonly<Record<string, unknown>>): void {
  for (const [key, value] of Object.entries(payload)) {
    switch (key) {
      case "target_home":
        addId(ids, value);
        break;
      case "stakeholders":
      case "breachers":
      case "recipients":
      case "previous_stakeholders":
      case "new_stakeholders":
        addIds(ids, value as readonly unknown[] | undefined);
        break;
      case "loot_shares":
        addRecordKeys(ids, value);
        break;
      default:
        if (ENTITY_ID_PAYLOAD_KEY.test(key)) {
          if (typeof value === "string") addId(ids, value);
          else if (Array.isArray(value)) addIds(ids, value);
        }
    }
  }
}

function addRecordKeys(ids: Set<string>, value: unknown): void {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return;
  for (const key of Object.keys(value)) addId(ids, key);
}

function addIds(ids: Set<string>, values: readonly unknown[] | undefined): void {
  if (!Array.isArray(values)) return;
  for (const value of values) addId(ids, value);
}

function addId(ids: Set<string>, value: unknown): void {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (trimmed.length > 0) ids.add(trimmed);
}

function isSafePublicCopy(value: string, deniedIds: EntityIdDenylist): boolean {
  return value.length > 0
    && !SENSITIVE_COPY.test(value)
    && !LEGACY_ENTITY_ID_SHAPE.test(value)
    && !containsDeniedEntityId(value, deniedIds);
}

function containsDeniedEntityId(value: string, deniedIds: EntityIdDenylist): boolean {
  const compiled = COMPILED_ENTITY_IDS.get(deniedIds);
  if (compiled !== undefined) return containsCompiledEntityId(value, compiled);
  const lowerValue = value.toLowerCase();
  for (const id of deniedIds) {
    if (value.includes(id) || (id.includes("_") && lowerValue.includes(id.toLowerCase()))) return true;
  }
  return false;
}

function containsCompiledEntityId(value: string, compiled: CompiledEntityIdState): boolean {
  for (const id of compiled.plainIds) {
    if (value.includes(id)) return true;
  }
  if (!value.includes("_")) return false;
  const lowerValue = value.toLowerCase();
  for (const lowerId of compiled.underscoredLowerIds) {
    if (lowerValue.includes(lowerId)) return true;
  }
  return false;
}

function compileEntityIdDenylist(ids: Iterable<string>): EntityIdDenylist {
  const denylist = new Set(ids);
  const plainIds: string[] = [];
  const underscoredLowerIds: string[] = [];
  for (const id of denylist) {
    if (id.includes("_")) underscoredLowerIds.push(id.toLowerCase());
    else plainIds.push(id);
  }
  Object.defineProperties(denylist, {
    add: { configurable: false, enumerable: false, value: rejectCompiledDenylistMutation, writable: false },
    clear: { configurable: false, enumerable: false, value: rejectCompiledDenylistMutation, writable: false },
    delete: { configurable: false, enumerable: false, value: rejectCompiledDenylistMutation, writable: false },
  });
  Object.freeze(denylist);
  COMPILED_ENTITY_IDS.set(denylist, {
    plainIds: Object.freeze(plainIds),
    underscoredLowerIds: Object.freeze(underscoredLowerIds),
  });
  return denylist;
}

function rejectCompiledDenylistMutation(): never {
  throw new TypeError("compiled entity ID denylists are immutable");
}

const EMPTY_ENTITY_IDS: EntityIdDenylist = compileEntityIdDenylist([]);
