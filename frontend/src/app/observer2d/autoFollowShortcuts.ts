/**
 * Chooses the small set of beings offered by the observer dock.
 *
 * The renderer's semantic store is deliberately public without exposing
 * selection ids. This module joins those opaque tokens back to the shell's
 * callback keys, then filters against the live follow roster. Renderer-visible
 * living beings lead the row; a recent meaningful event can fill an empty slot
 * with a reachable being elsewhere in the world.
 *
 * The selector is pure. Its previous-slot input gives the shell a modest
 * replacement hysteresis, while protected keys let the React surface keep a
 * pointer-hovered or keyboard-focused card stable across event and tile
 * publications.
 */

import { identityHue } from "../../renderer2d/production/environment/bubbleGrammar";
import type { StreamEvent } from "./chronicleStream/streamEvent";
import type {
  FollowCandidateView,
  FollowRosterView,
} from "./followSubject";
import type {
  SemanticSubjectView,
  SemanticWorldView,
} from "./semanticWorld";
import { sameFrameIdentity } from "./semanticWorld";
import type { FrameIdentity } from "../../presentation/contracts";

/** Maximum number of compact click-to-follow cards in the observer dock. */
export const MAX_AUTO_FOLLOW_SLOTS = 4;

/** A recent event is useful to the dock for this long. */
export const AUTO_FOLLOW_RECENT_WINDOW_MS = 90_000;

/**
 * Minimum score advantage needed to replace an existing unprotected card.
 *
 * The margin is intentionally small enough for a clearly new action to arrive,
 * but large enough that a feed tick does not reshuffle a viewer's reading.
 */
export const AUTO_FOLLOW_REPLACEMENT_MARGIN = 80;

/** Public data rendered by one automatic-follow shortcut card. */
export interface AutoFollowShortcut {
  /** Opaque callback key. Never put this value into visible copy or DOM text. */
  readonly key: string;
  readonly name: string;
  readonly action: string;
  /** Opaque roster region key. */
  readonly regionKey: string;
  readonly regionLabel: string;
  /** True when the renderer currently carries this being in its semantic view. */
  readonly visible: boolean;
  /** Convenience inverse of {@link visible} for the card's remote treatment. */
  readonly remote: boolean;
  /** True when an event involving this being is within the recent window. */
  readonly recent: boolean;
  /** True when this is the camera's current followed being. */
  readonly active: boolean;
  /** Stable identity hue derived from the opaque callback key. */
  readonly hue: string;
  /** Safe two-character identity fallback used when no portrait exists. */
  readonly initials: string;
}

/** Inputs for the pure automatic-follow slot selector. */
export interface AutoFollowShortcutsInput {
  /**
   * Public semantic rows. Callers may instead provide {@link view}; accepting
   * both keeps the pure boundary convenient for store and unit-test callers.
   */
  readonly subjects?: readonly SemanticSubjectView[];
  readonly view?: SemanticWorldView | null;
  /**
   * Accepted frame identity for semantic rows. When supplied, a stale store
   * view is ignored until its exact frame lineage and revision are accepted.
   */
  readonly frameIdentity?: FrameIdentity | null;
  /** Converts a semantic token to the shell's opaque follow key. */
  readonly resolveAgentKey: (token: string) => string | null;
  /** Live living/reachable roster and its all-being ground truth. */
  readonly roster: FollowRosterView;
  /** Bounded, resolved chronicle events, oldest first. */
  readonly events: readonly StreamEvent[];
  readonly followedKey: string | null;
  readonly observedRegionKey: string | null;
  /** Prior rendered slots, used to avoid needless identity churn. */
  readonly previousSlots?: readonly AutoFollowShortcut[];
  /** Cards currently under pointer or keyboard focus. */
  readonly protectedKeys?: ReadonlySet<string>;
  /** Feed clock in milliseconds; defaults to the newest event's clock. */
  readonly nowMs?: number;
}

interface Candidate {
  readonly key: string;
  readonly name: string;
  readonly action: string;
  readonly regionKey: string;
  readonly regionLabel: string;
  readonly visible: boolean;
  readonly recent: boolean;
  readonly active: boolean;
  readonly initials: string;
  readonly hue: string;
  readonly score: number;
}

interface LatestEvent {
  readonly event: StreamEvent;
  readonly atMs: number;
}

/**
 * Derives up to four stable automatic-follow shortcuts.
 *
 * Visible candidates are admitted only when the roster says they are living
 * and reachable. Remote candidates need a recent meaningful event, unless they
 * are the currently followed being. A previously rendered candidate remains in
 * its slot while eligible unless a challenger clears the replacement margin;
 * protected and followed keys are retained until they become invalid.
 *
 * Side effects: none.
 *
 * @param input Store, roster, event, and stability inputs.
 * @returns Immutable shortcut rows in display order.
 */
export function deriveAutoFollowSlots(
  input: AutoFollowShortcutsInput,
): readonly AutoFollowShortcut[] {
  const subjects = semanticSubjectsForInput(input);
  const semanticByKey = semanticSubjectsByKey(subjects, input.resolveAgentKey);
  const latestByKey = latestMeaningfulEvents(input.events);
  const nowMs = input.nowMs ?? newestEventTime(input.events);
  const candidateByKey = new Map<string, Candidate>();

  for (const rosterCandidate of input.roster.candidates) {
    const fact = input.roster.byKey.get(rosterCandidate.key);
    if (fact === undefined || !fact.living || fact.dead || !fact.reachable
      || fact.regionKey === null || fact.regionKey.trim() === "") continue;
    const regionKey = fact.regionKey;

    const semantic = semanticByKey.get(rosterCandidate.key);
    const visible = semantic !== undefined
      && (input.observedRegionKey === null || regionKey === input.observedRegionKey);
    const latest = latestByKey.get(rosterCandidate.key) ?? null;
    const ageMs = latest === null
      ? Number.POSITIVE_INFINITY
      : Math.max(0, nowMs - latest.atMs);
    const recent = latest !== null && ageMs <= AUTO_FOLLOW_RECENT_WINDOW_MS;
    const active = rosterCandidate.key === input.followedKey;
    if (!visible && !recent && !active) continue;

    const freshness = latest === null
      ? 0
      : Math.max(0, 1 - Math.min(ageMs / AUTO_FOLLOW_RECENT_WINDOW_MS, 1));
    const currentAction = semantic?.currentAction ?? "";
    const hasCurrentAction = meaningfulAction(currentAction);
    const action = hasCurrentAction
      ? currentAction
      : latest === null || !recent
        ? "At rest"
        : latest.event.actorId === rosterCandidate.key
          ? actionLabel(latest.event)
          : "Recently involved";
    const name = semantic?.name.trim() || rosterCandidate.name;
    const regionLabel = rosterCandidate.regionDisplayName.trim() || "Unknown region";
    candidateByKey.set(rosterCandidate.key, {
      key: rosterCandidate.key,
      name,
      action,
      regionKey,
      regionLabel,
      visible,
      recent,
      active,
      initials: initialsFor(name),
      hue: identityHue(rosterCandidate.key),
      score: scoreFor({
        visible,
        active,
        hasCurrentAction,
        recent,
        freshness,
        baseSalience: latest?.event.baseSalience ?? 0,
      }),
    });
  }

  const eligible = [...candidateByKey.values()].sort(compareCandidates);
  const protectedKeys = input.protectedKeys ?? new Set<string>();
  const selected = selectStableCandidates(
    eligible,
    candidateByKey,
    input.previousSlots ?? [],
    input.followedKey,
    protectedKeys,
  );
  return Object.freeze(selected.map(toShortcut));
}

function semanticSubjectsForInput(
  input: AutoFollowShortcutsInput,
): readonly SemanticSubjectView[] {
  if (input.frameIdentity === undefined || input.frameIdentity === null) {
    return input.subjects ?? input.view?.subjects ?? [];
  }
  if (input.view === null || input.view === undefined
    || !sameFrameIdentity(input.view.frameIdentity, input.frameIdentity)) {
    return [];
  }
  return input.view.subjects;
}

function semanticSubjectsByKey(
  subjects: readonly SemanticSubjectView[],
  resolveAgentKey: (token: string) => string | null,
): ReadonlyMap<string, SemanticSubjectView> {
  const byKey = new Map<string, SemanticSubjectView>();
  for (const subject of subjects) {
    if (subject.kind !== "agent" || !subject.canFollow) continue;
    const key = resolveAgentKey(subject.token);
    if (key === null || key.trim() === "" || byKey.has(key)) continue;
    byKey.set(key, subject);
  }
  return byKey;
}

function latestMeaningfulEvents(
  events: readonly StreamEvent[],
): ReadonlyMap<string, LatestEvent> {
  const latestByKey = new Map<string, LatestEvent>();
  for (const event of events) {
    if (!meaningfulEvent(event)) continue;
    const participants = Array.isArray(event.participants) ? event.participants : [];
    for (const key of participants) {
      if (typeof key !== "string" || key.trim() === "") continue;
      const current = latestByKey.get(key);
      if (current !== undefined && !isLater(event, current.event)) continue;
      latestByKey.set(key, { event, atMs: finiteTime(event.atMs) });
    }
  }
  return latestByKey;
}

function meaningfulEvent(event: StreamEvent): boolean {
  const participants = Array.isArray(event.participants) ? event.participants : [];
  const verb = event.narration?.verb;
  return participants.some((key) => typeof key === "string" && key.trim() !== "")
    && typeof verb === "string"
    && verb.trim() !== "";
}

function isLater(left: StreamEvent, right: StreamEvent): boolean {
  const leftTime = finiteTime(left.atMs);
  const rightTime = finiteTime(right.atMs);
  return leftTime > rightTime || (leftTime === rightTime && left.cursor > right.cursor);
}

function newestEventTime(events: readonly StreamEvent[]): number {
  return events.reduce((latest, event) => Math.max(latest, finiteTime(event.atMs)), 0);
}

function finiteTime(value: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function meaningfulAction(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized !== ""
    && normalized !== "no active action"
    && normalized !== "none"
    && normalized !== "idle";
}

function actionLabel(event: StreamEvent): string {
  const verb = event.narration?.verb?.trim();
  if (verb === undefined || verb === "") return "Recently active";
  return verb.split(/\s+/u).map((word) => (
    word.length === 0 ? word : word[0]!.toUpperCase() + word.slice(1)
  )).join(" ");
}

function scoreFor(input: Readonly<{
  visible: boolean;
  active: boolean;
  hasCurrentAction: boolean;
  recent: boolean;
  freshness: number;
  baseSalience: number;
}>): number {
  // Visibility is the dominant channel: remote activity fills spare cards but
  // does not displace a being the current renderer can actually show.
  return (input.visible ? 1_000 : 0)
    + (input.active ? 10_000 : 0)
    + (input.hasCurrentAction ? 140 : 0)
    + (input.recent ? 420 + (input.freshness * 300) + (input.baseSalience * 0.5) : 0);
}

function compareCandidates(left: Candidate, right: Candidate): number {
  return right.score - left.score
    || Number(right.visible) - Number(left.visible)
    || right.regionLabel.localeCompare(left.regionLabel)
    || left.name.localeCompare(right.name)
    || left.key.localeCompare(right.key);
}

function selectStableCandidates(
  ranked: readonly Candidate[],
  byKey: ReadonlyMap<string, Candidate>,
  previousSlots: readonly AutoFollowShortcut[],
  followedKey: string | null,
  protectedKeys: ReadonlySet<string>,
): Candidate[] {
  const selected: Candidate[] = [];
  const selectedKeys = new Set<string>();
  const add = (candidate: Candidate | undefined, atStart = false): void => {
    if (candidate === undefined || selectedKeys.has(candidate.key)) return;
    selectedKeys.add(candidate.key);
    if (atStart) selected.unshift(candidate);
    else selected.push(candidate);
  };

  // Existing slots keep their order. The eligibility check has already removed
  // dead, removed, unreachable, and stale remote entries.
  for (const previous of previousSlots) add(byKey.get(previous.key));

  const followed = followedKey === null ? undefined : byKey.get(followedKey);
  add(followed, true);
  for (const key of protectedKeys) add(byKey.get(key));

  // On the first render, rank the row. On later renders this only fills holes.
  for (const candidate of ranked) {
    if (selected.length >= MAX_AUTO_FOLLOW_SLOTS) break;
    add(candidate);
  }

  while (selected.length > MAX_AUTO_FOLLOW_SLOTS) {
    const removable = weakestIndex(selected, protectedKeys, followedKey);
    if (removable === -1) break;
    selectedKeys.delete(selected[removable]!.key);
    selected.splice(removable, 1);
  }

  // A new candidate can replace an old one only after clearing the modest
  // margin. Protected/followed candidates are never selected as victims.
  for (const challenger of ranked) {
    if (selectedKeys.has(challenger.key)) continue;
    if (selected.length < MAX_AUTO_FOLLOW_SLOTS) {
      add(challenger);
      continue;
    }
    const victim = weakestIndex(selected, protectedKeys, followedKey);
    if (victim === -1) continue;
    const current = selected[victim]!;
    const forced = challenger.key === followedKey || protectedKeys.has(challenger.key);
    if (!forced && challenger.score <= current.score + AUTO_FOLLOW_REPLACEMENT_MARGIN) continue;
    selectedKeys.delete(current.key);
    selected[victim] = challenger;
    selectedKeys.add(challenger.key);
  }
  return selected;
}

function weakestIndex(
  selected: readonly Candidate[],
  protectedKeys: ReadonlySet<string>,
  followedKey: string | null,
): number {
  let weakest = -1;
  for (let index = 0; index < selected.length; index += 1) {
    const candidate = selected[index]!;
    if (candidate.key === followedKey || protectedKeys.has(candidate.key)) continue;
    if (weakest === -1 || candidate.score <= selected[weakest]!.score) weakest = index;
  }
  return weakest;
}

function toShortcut(candidate: Candidate): AutoFollowShortcut {
  return Object.freeze({
    key: candidate.key,
    name: candidate.name,
    action: candidate.action,
    regionKey: candidate.regionKey,
    regionLabel: candidate.regionLabel,
    visible: candidate.visible,
    remote: !candidate.visible,
    recent: candidate.recent,
    active: candidate.active,
    hue: candidate.hue,
    initials: candidate.initials,
  });
}

function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/u).filter((word) => word.length > 0);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return ((words[0]![0] ?? "") + (words.at(-1)![0] ?? "")).toUpperCase();
}
