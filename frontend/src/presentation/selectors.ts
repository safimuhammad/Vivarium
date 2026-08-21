import type {
  AgentSnapshot,
  HomeSnapshot,
  RegionSnapshot,
} from "../app/schemas";
import type { StoryMoment } from "./BeatDirector";
import type {
  DialogueState,
  PresentationBacklog,
  PresentationGap,
  PresentedObserverFrame,
  PresentedRecord,
  ObserverTransportState,
} from "./contracts";

export interface RedactedUpcomingMoment {
  readonly sequence: number;
  readonly regionId: string | null;
  readonly urgency: "ambient" | "featured" | "drama";
}

/** Chronicle truth already separated from any canonical future snapshot. */
export interface SanitizedChronicleData {
  readonly now: StoryMoment | null;
  readonly previous: readonly StoryMoment[];
  readonly upcoming: readonly RedactedUpcomingMoment[];
  readonly gaps: readonly PresentationGap[];
}

export interface PresentedChronicleWindow extends SanitizedChronicleData {}

export interface PresentedHudTotals {
  readonly presentedCursor: number;
  readonly ingestedCursor: number;
  readonly livingAgents: number;
  readonly paralyzedAgents: number;
  readonly deadAgents: number;
  readonly unresolvedAgentStatuses: number;
  readonly homes: number;
  readonly ruins: number;
  readonly pendingProposals: number;
  readonly vaultMaterials: number;
  readonly backlog: PresentationBacklog;
  readonly transport: ObserverTransportState;
}

export interface AtlasQueuedImportance {
  readonly ambient: number;
  readonly featured: number;
  readonly drama: number;
}

export interface PresentedAtlasRegion {
  readonly id: string;
  readonly description: string | null;
  readonly connections: readonly string[];
  readonly livingAgents: number;
  readonly homes: number;
  readonly ruins: number;
  readonly queuedImportance: AtlasQueuedImportance;
}

export interface PresentedLivingAtlas {
  readonly regions: readonly PresentedAtlasRegion[];
}

export type PresentedSelection =
  | {
      readonly kind: "agent";
      readonly id: string;
      readonly record: PresentedRecord<AgentSnapshot>;
    }
  | {
      readonly kind: "home";
      readonly id: string;
      readonly record: PresentedRecord<HomeSnapshot>;
    }
  | {
      readonly kind: "ruin";
      readonly id: string;
      readonly record: PresentedRecord<HomeSnapshot>;
    }
  | {
      readonly kind: "region";
      readonly id: string;
      readonly record: PresentedRecord<RegionSnapshot>;
    }
  | {
      readonly kind: "moment";
      readonly id: string;
      readonly moment: StoryMoment;
    };

/** Derives HUD totals solely from truth in the selected observer frame. */
export function selectPresentedHud(
  frame: PresentedObserverFrame,
): PresentedHudTotals {
  let livingAgents = 0;
  let paralyzedAgents = 0;
  let deadAgents = 0;
  let unresolvedAgentStatuses = 0;
  for (const record of frame.world.agents) {
    switch (record.value.status) {
      case "alive":
        livingAgents += 1;
        break;
      case "paralyzed":
        livingAgents += 1;
        paralyzedAgents += 1;
        break;
      case "dead":
        deadAgents += 1;
        break;
      default:
        unresolvedAgentStatuses += 1;
    }
  }

  const vaultMaterials = [...frame.world.homes, ...frame.world.ruins].reduce(
    (total, record) => total + finiteNumber(record.value.vault_materials),
    0,
  );
  return Object.freeze({
    presentedCursor: frame.presentedCursor,
    ingestedCursor: frame.ingestedCursor,
    livingAgents,
    paralyzedAgents,
    deadAgents,
    unresolvedAgentStatuses,
    homes: frame.world.homes.length,
    ruins: frame.world.ruins.length,
    pendingProposals: frame.world.pendingProposals.length,
    vaultMaterials,
    backlog: frame.backlog,
    transport: frame.transport,
  });
}

/** Builds the directed living-atlas view from presented entities and redacted queue data. */
export function selectLivingAtlas(
  frame: PresentedObserverFrame,
  chronicle: SanitizedChronicleData,
): PresentedLivingAtlas {
  const knownRegions = knownRegionIds(frame);
  const regions = frame.world.regions.flatMap((record) => {
    const id = record.value.name;
    if (typeof id !== "string") return [];
    const queuedImportance = emptyQueuedImportance();
    for (const upcoming of chronicle.upcoming) {
      if (upcoming.regionId === id) queuedImportance[upcoming.urgency] += 1;
    }
    const region: PresentedAtlasRegion = Object.freeze({
      id,
      description: typeof record.value.description === "string"
        ? record.value.description
        : null,
      connections: Object.freeze(
        Array.isArray(record.value.connections)
          ? record.value.connections.filter(
            (connection): connection is string => (
              typeof connection === "string" && knownRegions.has(connection)
            ),
          )
          : [],
      ),
      livingAgents: countLivingAgentsInRegion(frame, id),
      homes: countHomesInRegion(frame.world.homes, id),
      ruins: countHomesInRegion(frame.world.ruins, id),
      queuedImportance: Object.freeze(queuedImportance),
    });
    return [region];
  }).sort((left, right) => left.id.localeCompare(right.id));
  return Object.freeze({ regions: Object.freeze(regions) });
}

/** Applies observer-specific privacy and future redaction to sanitized Chronicle data. */
export function selectPresentedChronicle(
  frame: PresentedObserverFrame,
  chronicle: SanitizedChronicleData,
): PresentedChronicleWindow {
  const knownRegions = knownRegionIds(frame);
  const now = chronicle.now !== null && isMomentVisible(chronicle.now, frame)
    ? ownMoment(chronicle.now)
    : null;
  const previous = chronicle.previous
    .filter((moment) => isMomentVisible(moment, frame))
    .map(ownMoment);
  const upcoming = chronicle.upcoming.map((moment): RedactedUpcomingMoment => Object.freeze({
    sequence: moment.sequence,
    regionId: moment.regionId !== null && knownRegions.has(moment.regionId)
      ? moment.regionId
      : null,
    urgency: moment.urgency,
  }));
  return Object.freeze({
    now,
    previous: Object.freeze(previous),
    upcoming: Object.freeze(upcoming),
    gaps: Object.freeze(chronicle.gaps.map((gap) => deepOwned(gap))),
  });
}

/** Resolves selection against the same observer frame and privacy-filtered Chronicle. */
export function selectPresentedSelection(
  frame: PresentedObserverFrame,
  chronicle: SanitizedChronicleData,
): PresentedSelection | null {
  const selection = frame.selection;
  if (selection === null) return null;
  switch (selection.kind) {
    case "agent": {
      const record = findRecord(frame.world.agents, "id", selection.id);
      return record === null
        ? null
        : Object.freeze({ kind: "agent" as const, id: selection.id, record });
    }
    case "home": {
      const record = findRecord(frame.world.homes, "home_id", selection.id);
      return record === null
        ? null
        : Object.freeze({ kind: "home" as const, id: selection.id, record });
    }
    case "ruin": {
      const record = findRecord(frame.world.ruins, "home_id", selection.id);
      return record === null
        ? null
        : Object.freeze({ kind: "ruin" as const, id: selection.id, record });
    }
    case "region": {
      const record = findRecord(frame.world.regions, "name", selection.id);
      return record === null
        ? null
        : Object.freeze({ kind: "region" as const, id: selection.id, record });
    }
    case "moment": {
      const moment = [chronicle.now, ...chronicle.previous].find(
        (candidate) => candidate?.id === selection.id,
      ) ?? null;
      if (moment === null || !isMomentVisible(moment, frame)) return null;
      return Object.freeze({
        kind: "moment" as const,
        id: selection.id,
        moment: ownMoment(moment),
      });
    }
  }
}

/** Returns only dialogue already activated in the presented scene. */
export function selectPresentedDialogue(
  frame: PresentedObserverFrame,
  chronicle: SanitizedChronicleData,
): DialogueState | null {
  const dialogue = frame.scene?.dialogue;
  const activeMoment = chronicle.now;
  return dialogue === null
    || dialogue === undefined
    || activeMoment === null
    || frame.scene?.momentId !== activeMoment.id
    || !isMomentVisible(activeMoment, frame)
    ? null
    : Object.freeze({ ...dialogue });
}

function knownRegionIds(frame: PresentedObserverFrame): ReadonlySet<string> {
  return new Set(frame.world.regions.flatMap((record) => (
    typeof record.value.name === "string" ? [record.value.name] : []
  )));
}

function countLivingAgentsInRegion(
  frame: PresentedObserverFrame,
  regionId: string,
): number {
  return frame.world.agents.filter((record) => (
    record.value.position === regionId
    && (record.value.status === "alive" || record.value.status === "paralyzed")
  )).length;
}

function countHomesInRegion(
  records: readonly PresentedRecord<HomeSnapshot>[],
  regionId: string,
): number {
  return records.filter((record) => record.value.region === regionId).length;
}

function emptyQueuedImportance(): {
  ambient: number;
  featured: number;
  drama: number;
} {
  return { ambient: 0, featured: 0, drama: 0 };
}

/**
 * Whether a story moment is shown to the viewer.
 *
 * OWNER DECISION (Safi, 2026-07-25) -- "SELF_TALK RENDERS OPENLY", recorded in
 * `.superpowers/sdd/progress.md` and `docs/frontend/BUBBLE_UI.md` §11.1.
 *
 * `ScopeType.PRIVATE` means other **beings** do not perceive a thought:
 * `self_talk` is never routed to another agent's inbox (`agents/runtime.py`),
 * and no agent's prompt can ever contain it. The **viewer is not a being**, so
 * viewer visibility is granted; simulation privacy is untouched.
 *
 * This is applied consistently across every surface, deliberately: the world
 * overlay draws the thought silhouette for all beings, and the Chronicle
 * drawer / history feed / dialogue panel show the moment and its full text. The
 * bubble carries an *excerpt* with a fullness bar reporting how much was left
 * unsaid -- a partially-shown thought whose remainder is unreachable in the
 * panel would be incoherent, so gating one surface but not the other is not an
 * option. Quietness, not concealment, is what marks a thought as private: the
 * dashed cloud, 88% opacity and narrowest line budget do that work.
 *
 * The previous selection gate is retained in history here rather than deleted
 * silently, so a later reader does not "restore" it as a regression fix.
 */
/**
 * Whether a story moment is shown to the viewer.
 *
 * OWNER DECISION (Safi, 2026-07-25) -- "SELF_TALK RENDERS OPENLY", recorded in
 * `.superpowers/sdd/progress.md` and `docs/frontend/BUBBLE_UI.md` §11.1.
 *
 * `ScopeType.PRIVATE` means other **beings** do not perceive a thought:
 * `self_talk` is never routed to another agent's inbox (`agents/runtime.py`
 * emits it with no recipients), so no agent's prompt can ever contain it. The
 * **viewer is not a being** -- viewer visibility is therefore granted, and
 * simulation privacy is untouched.
 *
 * Applied consistently across every viewer surface, deliberately: the world
 * overlay draws the thought silhouette for all beings, and the Chronicle
 * drawer / history feed / dialogue panel carry the moment and its full text.
 * The bubble shows only an *excerpt* with a fullness bar reporting how much was
 * left unsaid (`docs/frontend/BUBBLE_UI.md` §2); a partially-shown thought whose
 * remainder was unreachable in the panel would be incoherent, so gating one
 * surface but not the other is not an option. Quietness, not concealment, is
 * what marks a thought as private -- the dashed cloud, 88% opacity and narrowest
 * line budget do that work.
 *
 * The prior selection gate is described here rather than deleted silently, so a
 * later reader does not "restore" it as a regression fix. The gating
 * *mechanism* (evaluate live against the current frame, never freeze a decision
 * into a one-shot plan) stays correct and available for any future scope that
 * genuinely must stay hidden; it is the POLICY that was reversed.
 */
function isMomentVisible(
  _moment: StoryMoment,
  _frame: PresentedObserverFrame,
): boolean {
  return true;
}

function findRecord<T>(
  records: readonly PresentedRecord<T>[],
  key: keyof T,
  id: string,
): PresentedRecord<T> | null {
  return records.find((record) => record.value[key] === id) ?? null;
}

function finiteNumber(value: number | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function ownMoment(moment: StoryMoment): StoryMoment {
  return deepOwned(moment);
}

function deepOwned<T>(value: T): T {
  return deepFreeze(structuredClone(value));
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    deepFreeze(child);
  }
  return Object.freeze(value);
}
