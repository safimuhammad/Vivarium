/**
 * Salience, aggregation, inhibition, and the standing-condition machine.
 *
 * Three ideas from the prior art are load-bearing here and are implemented as
 * *data*, not as rules scattered through the views:
 *
 * 1. **Salience is a table.** Hacker News runs time-decay and per-category
 *    penalty multipliers at once; a 28-type world is exactly a table of
 *    per-category multipliers. {@link BASE_SALIENCE} is that table.
 * 2. **Inhibition is not grouping.** Alertmanager's `inhibit_rules` suppress B
 *    *entirely* while A is firing. {@link chainParentOf} is our version: a
 *    paralysis that follows its own attack is not a second row, it is the
 *    attack's consequence, and VISION.md §2.2 already says chained events must
 *    render as ONE beat.
 * 3. **Events decay, states persist.** The aviation Master Caution split. A
 *    decaying feed structurally cannot hold `agent_paralyzed`,
 *    `agent_started_hoarding`, or `home_started_hoarding`, because those are
 *    transitions into a condition that outlives any annunciation.
 *    {@link stateChangesFor} is the transition table that feeds the state rail.
 */

import type { PresentedEventType } from "../../presentation/eventPayloads";
import type { JourneyEvent, JourneyStateChange } from "./journeyTypes";

/**
 * Base salience per event type, 0..100. A death must not rank like a harvest.
 *
 * Ordered by what a watcher would be sorry to have missed, which is not the
 * same as what the simulation spends most of its time doing.
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

/** At or below this base score an event folds into a count instead of a row. */
export const ROUTINE_CEILING = 31;

/**
 * The posture of a card: is this the world advancing, or the world going wrong?
 *
 * The owner's one specific praise of the curated direction was that it could
 * "distinguish between a journey and a something has failed". That distinction
 * is made structural rather than chromatic: a *progress* card sits flush in the
 * lane's column, a *rupture* card breaks that column — it is offset, its left
 * edge is torn, and its medallion inverts. You can see a rupture without
 * reading a word, from across the room, because the straight edge of the stack
 * stops being straight.
 *
 * `arrival` is the one card that goes to light: a birth. Death is a rupture
 * *and* a knell, and gets both treatments.
 */
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

/** Curated shows a row only above this live (decayed) score. */
export const CURATED_FLOOR = 22;

/**
 * Time decay in journey-milliseconds.
 *
 * `live = base / (1 + age/tau)^gravity`. Gravity below 1 keeps a knell on the
 * board far longer than a murmur without pinning it forever — a death stays
 * legible for about a minute of journey time, a harvest for about six seconds.
 */
export function decayedSalience(base: number, ageMs: number): number {
  const tau = 16_000;
  const gravity = 1;
  return base / Math.pow(1 + Math.max(0, ageMs) / tau, gravity);
}

/**
 * Whether `event` is a continuation of something already on the board.
 *
 * Returns the id of the parent event, or null. Chains are matched on subject
 * identity plus a short journey window, never on wording.
 */
export function chainParentOf(
  event: JourneyEvent,
  earlier: readonly JourneyEvent[],
): string | null {
  // A knell is never folded into anything. BUBBLE_UI.md §7: KNELL is never
  // demoted. A birth buried as a chip under the proposal that caused it is the
  // single worst thing this surface could do.
  if (event.tier === "knell") return null;
  const windowMs = 6_000;
  const within = (candidate: JourneyEvent): boolean =>
    event.atMs - candidate.atMs <= windowMs && candidate.atMs <= event.atMs;

  const findLast = (predicate: (candidate: JourneyEvent) => boolean): JourneyEvent | null => {
    for (let index = earlier.length - 1; index >= 0; index -= 1) {
      const candidate = earlier[index];
      if (candidate !== undefined && within(candidate) && predicate(candidate)) return candidate;
    }
    return null;
  };

  switch (event.type) {
    // A body falling is the back half of the blow that felled it.
    case "agent_paralyzed":
      return findLast((c) => c.type === "attack" && c.targetId === event.targetId)?.id ?? null;
    // The earth taking a body is the tail of the death.
    case "agent_decayed":
      return findLast((c) => c.type === "agent_died" && c.targetId === event.actorId)?.id ?? null;
    // A vault emptied through a wall the same being just opened.
    case "home_thieved":
    case "home_colonized":
      return findLast((c) => c.type === "home_breached" && c.homeId === event.homeId)?.id ?? null;
    // The gift that answers a fall.
    case "resource_transferred":
      return findLast(
        (c) => c.type === "agent_recovered" && c.targetId === event.targetId,
      )?.id ?? null;
    default:
      return null;
  }
}

/**
 * Inhibition: while this condition stands, that event is not worth a row.
 *
 * Distinct from folding — the row is not collapsed into a count, it is
 * suppressed, because the standing rail is already saying the same thing.
 */
export const INHIBITED_WHILE: Readonly<Partial<Record<PresentedEventType, JourneyStateChange["key"]>>> =
  Object.freeze({
    // The rail already shows the open ask; its expiry is bookkeeping.
    mating_proposal_timeout: "asking",
    mating_proposal_invalidated: "asking",
  });

interface StateContext {
  readonly actorId: string | null;
  readonly targetId: string | null;
  readonly homeId: string | null;
  readonly payload: Readonly<Record<string, unknown>>;
  readonly regionLabel: string | null;
  readonly nameOf: (id: string) => string;
}

function payloadId(payload: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

const set = (
  key: JourneyStateChange["key"],
  subjectKind: JourneyStateChange["subjectKind"],
  subjectId: string,
  tag: string,
  label: string,
  severity: JourneyStateChange["severity"],
): JourneyStateChange => ({ op: "set", key, subjectKind, subjectId, tag, label, severity });

const clear = (
  key: JourneyStateChange["key"],
  subjectKind: JourneyStateChange["subjectKind"],
  subjectId: string,
): JourneyStateChange => ({
  op: "clear",
  key,
  subjectKind,
  subjectId,
  tag: "",
  label: "",
  severity: "quiet",
});

const pairKey = (a: string, b: string): string => [a, b].sort().join("~");

/**
 * The state-transition table: which events set or clear a standing condition.
 *
 * This is the half of the world a purely decaying feed loses. Eight conditions
 * cover every canonical transition the 28 events express.
 */
export function stateChangesFor(
  type: PresentedEventType,
  ctx: StateContext,
): readonly JourneyStateChange[] {
  const where = ctx.regionLabel === null ? "" : ` at ${ctx.regionLabel}`;
  switch (type) {
    case "agent_paralyzed":
      return ctx.targetId === null
        ? []
        : [set("fallen", "being", ctx.targetId, "fallen", `${ctx.nameOf(ctx.targetId)} lies fallen${where}.`, "grave")];
    case "agent_recovered":
      return ctx.targetId === null ? [] : [clear("fallen", "being", ctx.targetId)];
    case "agent_died":
      return ctx.targetId === null
        ? []
        : [
            clear("fallen", "being", ctx.targetId),
            set("gone", "being", ctx.targetId, "gone", `${ctx.nameOf(ctx.targetId)}'s body lies${where}.`, "grave"),
          ];
    case "agent_decayed":
      return ctx.actorId === null ? [] : [clear("gone", "being", ctx.actorId)];
    case "agent_started_hoarding":
      return ctx.actorId === null
        ? []
        : [set("hoarding", "being", ctx.actorId, "hoarding", `${ctx.nameOf(ctx.actorId)} is hoarding${where}.`, "notable")];
    case "mating_initiated":
      return ctx.actorId === null || ctx.targetId === null
        ? []
        : [
            set(
              "asking",
              "pair",
              pairKey(ctx.actorId, ctx.targetId),
              "asking",
              `${ctx.nameOf(ctx.actorId)} waits on ${ctx.nameOf(ctx.targetId)}.`,
              "notable",
            ),
          ];
    case "mating_rejected":
    case "mating_proposal_timeout":
    case "mating_proposal_invalidated":
      return ctx.actorId === null || ctx.targetId === null
        ? []
        : [clear("asking", "pair", pairKey(ctx.actorId, ctx.targetId))];
    // A birth answers the ask that produced it; the pair is in the payload,
    // because the row's own subject is the newborn.
    case "agent_born": {
      const initiator = payloadId(ctx.payload, "initiator_id");
      const acceptor = payloadId(ctx.payload, "acceptor_id");
      return initiator === null || acceptor === null
        ? []
        : [clear("asking", "pair", pairKey(initiator, acceptor))];
    }
    case "home_started_hoarding":
      return ctx.homeId === null
        ? []
        : [set("vault", "home", ctx.homeId, "vault hoarding", `A vault${where} is hoarding.`, "notable")];
    case "home_breached":
      return ctx.homeId === null
        ? []
        : [set("breached", "home", ctx.homeId, "wall open", `A home${where} stands breached.`, "grave")];
    case "home_colonized":
      return ctx.homeId === null ? [] : [clear("breached", "home", ctx.homeId)];
    case "home_collapsed":
      return ctx.homeId === null
        ? []
        : [
            clear("breached", "home", ctx.homeId),
            clear("vault", "home", ctx.homeId),
            set("ruin", "home", ctx.homeId, "ruin", `A ruin lies${where}.`, "notable"),
          ];
    case "home_joined":
      return ctx.actorId === null
        ? []
        : [set("household", "being", ctx.actorId, "housed", `${ctx.nameOf(ctx.actorId)} shares a home${where}.`, "quiet")];
    case "home_left":
      return ctx.actorId === null ? [] : [clear("household", "being", ctx.actorId)];
    default:
      return [];
  }
}

/** A standing condition currently true of the world. */
export interface StandingCondition {
  readonly key: JourneyStateChange["key"];
  readonly subjectKind: JourneyStateChange["subjectKind"];
  readonly subjectId: string;
  readonly label: string;
  readonly tag: string;
  readonly severity: JourneyStateChange["severity"];
  /** Journey ms at which the condition began. */
  readonly sinceMs: number;
  /** The event that opened it, for jump-to-source. */
  readonly sourceEventId: string;
  readonly regionId: string | null;
}

/** Replay the transition table over delivered events to get the live rail. */
export function standingConditions(
  delivered: readonly JourneyEvent[],
): readonly StandingCondition[] {
  const live = new Map<string, StandingCondition>();
  for (const event of delivered) {
    for (const change of event.stateChange) {
      const key = `${change.key}:${change.subjectId}`;
      if (change.op === "clear") {
        live.delete(key);
        continue;
      }
      live.set(key, {
        key: change.key,
        subjectKind: change.subjectKind,
        subjectId: change.subjectId,
        label: change.label,
        tag: change.tag,
        severity: change.severity,
        sinceMs: event.atMs,
        sourceEventId: event.id,
        regionId: event.regionId,
      });
    }
  }
  const order: Readonly<Record<JourneyStateChange["severity"], number>> = {
    grave: 0,
    notable: 1,
    quiet: 2,
  };
  return [...live.values()].sort(
    (a, b) => order[a.severity] - order[b.severity] || a.sinceMs - b.sinceMs,
  );
}
