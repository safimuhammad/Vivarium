/**
 * Card posture, notability, and the standing-condition state machine.
 *
 * Two ideas from the pilot are load-bearing here, and both are implemented as
 * *data* rather than as rules scattered through the view:
 *
 * 1. **Posture is a table.** The owner's one specific praise of the pilot's
 *    carded directions was that they "distinguish between a journey and a
 *    something has failed". {@link CARD_POSTURE} makes that distinction
 *    structural: a *progress* card sits flush, a *rupture* card breaks the
 *    column sideways, and *arrival* (a birth) is the one card that goes to
 *    light. All three are horizontal or chromatic moves, so they cost no height.
 * 2. **Events decay, states persist.** The aviation Master Caution split. A
 *    killfeed structurally cannot hold `agent_paralyzed`,
 *    `agent_started_hoarding` or `home_started_hoarding`, because those are
 *    transitions *into* a condition that outlives any annunciation.
 *    {@link stateChangesFor} is the transition table behind the standing strip,
 *    which is the only non-decaying truth on the surface.
 *
 * Nothing here suppresses or folds an event. The killfeed shows every event it
 * receives regardless of rate (owner decision, 2026-07-30); salience only
 * decides how much *height and weight* a card earns, never whether it appears.
 */

import type { PresentedEventType } from "../../../presentation/eventPayloads";

/**
 * Base salience per event type, 0..100 — what a watcher would be sorry to miss.
 *
 * Used only to decide which minority of cards earns the taller "notable"
 * treatment. It is deliberately not a filter.
 */
export const BASE_SALIENCE: Readonly<Record<PresentedEventType, number>> = Object.freeze({
  agent_died: 100,
  agent_born: 96,
  simulation_started: 92,
  home_collapsed: 88,
  attack: 84,
  home_thieved: 78,
  home_breached: 76,
  home_colonized: 74,
  agent_paralyzed: 70,
  mating_rejected: 62,
  agent_recovered: 60,
  mating_initiated: 54,
  home_built: 52,
  agent_decayed: 46,
  speak: 44,
  self_talk: 36,
  home_started_hoarding: 34,
  agent_started_hoarding: 33,
  ruins_scavenged: 32,
  hearth_used: 31,
  home_joined: 30,
  home_left: 28,
  resource_transferred: 27,
  mating_proposal_timeout: 22,
  mating_proposal_invalidated: 22,
  agent_entered_region: 16,
  agent_left_region: 14,
  resource_changed: 12,
});

/** At or above this base salience a card earns the taller treatment. */
export const NOTABLE_FLOOR = 60;

/** Whether the world advanced, went wrong, or brought something new to light. */
export type CardPosture = "progress" | "rupture" | "arrival";

export const CARD_POSTURE: Readonly<Record<PresentedEventType, CardPosture>> = Object.freeze({
  // the world advancing
  simulation_started: "progress",
  agent_entered_region: "progress",
  agent_left_region: "progress",
  speak: "progress",
  self_talk: "progress",
  resource_changed: "progress",
  resource_transferred: "progress",
  agent_started_hoarding: "progress",
  mating_initiated: "progress",
  home_built: "progress",
  hearth_used: "progress",
  home_joined: "progress",
  home_left: "progress",
  home_started_hoarding: "progress",
  ruins_scavenged: "progress",
  agent_recovered: "progress",
  // the world going wrong: harm taken, a bond stopped, a thing lost or seized
  attack: "rupture",
  agent_paralyzed: "rupture",
  agent_died: "rupture",
  agent_decayed: "rupture",
  mating_rejected: "rupture",
  mating_proposal_timeout: "rupture",
  mating_proposal_invalidated: "rupture",
  home_breached: "rupture",
  home_thieved: "rupture",
  home_colonized: "rupture",
  home_collapsed: "rupture",
  // the one card that goes to light
  agent_born: "arrival",
});

/** The eight standing conditions the 28 canonical transitions can express. */
export type StreamConditionKey =
  | "fallen"
  | "hoarding"
  | "asking"
  | "gone"
  | "vault"
  | "breached"
  | "ruin"
  | "household";

export type StreamSubjectKind = "being" | "home" | "pair";

export interface StreamStateChange {
  readonly op: "set" | "clear";
  readonly key: StreamConditionKey;
  readonly subjectKind: StreamSubjectKind;
  /** Being id, home id, or `${a}~${b}` for a pair. */
  readonly subjectId: string;
  /** Full copy for the chip's accessible name, in the in-world voice. */
  readonly label: string;
  /** Short chip tag: one or two words. */
  readonly tag: string;
  readonly severity: "grave" | "notable" | "quiet";
}

/** Everything {@link stateChangesFor} needs about the event that fired. */
export interface StreamStateContext {
  readonly actorId: string | null;
  readonly targetId: string | null;
  readonly homeId: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly regionLabel: string | null;
  readonly nameOf: (id: string) => string;
}

/** One standing condition currently true of the world. */
export interface StandingCondition {
  readonly key: StreamConditionKey;
  readonly subjectKind: StreamSubjectKind;
  readonly subjectId: string;
  readonly label: string;
  readonly tag: string;
  readonly severity: StreamStateChange["severity"];
  /** Feed-clock milliseconds at which the condition began. */
  readonly sinceMs: number;
  /** The event that opened it, so a chip can jump to its source. */
  readonly sourceEventId: string;
  readonly regionId: string | null;
}

/** The minimum a {@link standingConditions} input row must carry. */
export interface StandingConditionSource {
  readonly id: string;
  readonly regionId: string | null;
  readonly atMs: number;
  readonly stateChange: readonly StreamStateChange[];
}

function payloadId(payload: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function set(
  key: StreamConditionKey,
  subjectKind: StreamSubjectKind,
  subjectId: string,
  tag: string,
  label: string,
  severity: StreamStateChange["severity"],
): StreamStateChange {
  return Object.freeze({ op: "set", key, subjectKind, subjectId, tag, label, severity });
}

function clear(
  key: StreamConditionKey,
  subjectKind: StreamSubjectKind,
  subjectId: string,
): StreamStateChange {
  return Object.freeze({
    op: "clear",
    key,
    subjectKind,
    subjectId,
    tag: "",
    label: "",
    severity: "quiet",
  });
}

const pairKey = (left: string, right: string): string => [left, right].sort().join("~");

/**
 * The state-transition table: which events open or close a standing condition.
 *
 * Pure; mutates nothing. Returns an empty list for every event that is purely an
 * annunciation (a strike, a harvest, an utterance) rather than a transition.
 */
export function stateChangesFor(
  type: PresentedEventType,
  context: StreamStateContext,
): readonly StreamStateChange[] {
  const where = context.regionLabel === null ? "" : ` at ${context.regionLabel}`;
  switch (type) {
    case "agent_paralyzed":
      return context.targetId === null ? [] : [set(
        "fallen", "being", context.targetId, "fallen",
        `${context.nameOf(context.targetId)} lies fallen${where}.`, "grave",
      )];
    case "agent_recovered":
      return context.targetId === null ? [] : [clear("fallen", "being", context.targetId)];
    case "agent_died":
      return context.targetId === null ? [] : [
        clear("fallen", "being", context.targetId),
        set(
          "gone", "being", context.targetId, "gone",
          `${context.nameOf(context.targetId)}'s body lies${where}.`, "grave",
        ),
      ];
    case "agent_decayed":
      return context.actorId === null ? [] : [clear("gone", "being", context.actorId)];
    case "agent_started_hoarding":
      return context.actorId === null ? [] : [set(
        "hoarding", "being", context.actorId, "hoarding",
        `${context.nameOf(context.actorId)} is hoarding${where}.`, "notable",
      )];
    case "mating_initiated":
      return context.actorId === null || context.targetId === null ? [] : [set(
        "asking", "pair", pairKey(context.actorId, context.targetId), "asking",
        `${context.nameOf(context.actorId)} waits on ${context.nameOf(context.targetId)}.`,
        "notable",
      )];
    case "mating_rejected":
    case "mating_proposal_timeout":
    case "mating_proposal_invalidated":
      return context.actorId === null || context.targetId === null
        ? []
        : [clear("asking", "pair", pairKey(context.actorId, context.targetId))];
    case "agent_born": {
      // A birth answers the ask that produced it; the pair is in the payload,
      // because the row's own subject is the newborn.
      const initiator = payloadId(context.payload, "initiator_id");
      const acceptor = payloadId(context.payload, "acceptor_id");
      return initiator === null || acceptor === null
        ? []
        : [clear("asking", "pair", pairKey(initiator, acceptor))];
    }
    case "home_started_hoarding":
      return context.homeId === null ? [] : [set(
        "vault", "home", context.homeId, "vault hoarding", `A vault${where} is hoarding.`, "notable",
      )];
    case "home_breached":
      return context.homeId === null ? [] : [set(
        "breached", "home", context.homeId, "wall open", `A home${where} stands breached.`, "grave",
      )];
    case "home_colonized":
      return context.homeId === null ? [] : [clear("breached", "home", context.homeId)];
    case "home_collapsed":
      return context.homeId === null ? [] : [
        clear("breached", "home", context.homeId),
        clear("vault", "home", context.homeId),
        set("ruin", "home", context.homeId, "ruin", `A ruin lies${where}.`, "notable"),
      ];
    case "home_joined":
      return context.actorId === null ? [] : [set(
        "household", "being", context.actorId, "housed",
        `${context.nameOf(context.actorId)} shares a home${where}.`, "quiet",
      )];
    case "home_left":
      return context.actorId === null ? [] : [clear("household", "being", context.actorId)];
    default:
      return [];
  }
}

const SEVERITY_ORDER: Readonly<Record<StreamStateChange["severity"], number>> = Object.freeze({
  grave: 0,
  notable: 1,
  quiet: 2,
});

/**
 * Replays the transition table over an ordered event run to get the live strip.
 *
 * Caller must pass the events in cursor order. Callers that anchor on a
 * checkpoint should seed the run from the anchor, not from the beginning of the
 * world — see `streamBuffer.ts`.
 */
export function standingConditions(
  events: readonly StandingConditionSource[],
  seed: readonly StandingCondition[] = [],
): readonly StandingCondition[] {
  const live = new Map<string, StandingCondition>();
  for (const condition of seed) live.set(`${condition.key}:${condition.subjectId}`, condition);
  for (const event of events) {
    for (const change of event.stateChange) {
      const key = `${change.key}:${change.subjectId}`;
      if (change.op === "clear") {
        live.delete(key);
        continue;
      }
      live.set(key, Object.freeze({
        key: change.key,
        subjectKind: change.subjectKind,
        subjectId: change.subjectId,
        label: change.label,
        tag: change.tag,
        severity: change.severity,
        sinceMs: event.atMs,
        sourceEventId: event.id,
        regionId: event.regionId,
      }));
    }
  }
  return Object.freeze([...live.values()].sort(
    (left, right) => SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity]
      || left.sinceMs - right.sinceMs,
  ));
}
