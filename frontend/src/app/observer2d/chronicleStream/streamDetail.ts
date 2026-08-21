/**
 * "What exactly happened" — the killfeed's progressive-disclosure detail model.
 *
 * The rule this module exists to enforce: **every line comes from a key that is
 * actually present on the event's own payload.** Nothing is invented, nothing is
 * inferred without being labelled as inference, and no key is rendered that the
 * simulation did not emit. The panel walks the payload it was handed rather than
 * a hand-written script per type, so an event that gains a field later surfaces
 * it without anyone editing this file, and an event that never had one shows
 * nothing rather than a plausible-looking zero.
 *
 * What the simulation genuinely emits, surveyed across all 28 canonical types
 * (`.superpowers/sdd/event-journey-pilot-report.md`, Round 2 §5):
 *
 * - **After-values, never before-values.** Economic payloads carry the delta
 *   *and* the post-event absolute (`attack.damage` + `attack.victim_energy`),
 *   but there is no `*_before` field anywhere. Where the arithmetic is exact and
 *   total we reconstruct it and mark the row `derived`, so it can never be
 *   mistaken for something the world said.
 * - **Rosters on six types** — `parent_ids`, `breachers`, `recipients`,
 *   `stakeholders` (with a before/after pair on `home_left` and
 *   `home_colonized`), and `loot_shares`, the only per-being breakdown in the
 *   whole schema.
 * - **No coordinates, anywhere.** `position` is a region *name*. The finest
 *   location the world knows is a region plus, sometimes, a home id. That is a
 *   ceiling on navigation, not a shortcoming of this panel.
 * - **No causal links.** There is no `caused_by` on any event. "Around it" is
 *   inferred from shared beings and adjacency, and the panel says so.
 */

import type { StreamEvent } from "./streamEvent";

/** One fact, ready to render. */
export interface DetailRow {
  readonly label: string;
  readonly value: string;
  /** True when this line is arithmetic of ours, not a figure the world emitted. */
  readonly derived?: boolean;
  /** A being this row is about, so the row can offer "follow them". */
  readonly beingId?: string;
  /** Emphasised: the field that carries the event's meaning. */
  readonly weighty?: boolean;
}

export interface DetailGroup {
  readonly title: string;
  readonly rows: readonly DetailRow[];
}

export interface EventDetail {
  readonly groups: readonly DetailGroup[];
  /** Verbatim, untruncated, exactly as the being said it. */
  readonly message: string | null;
  /** Payload keys present but rendered nowhere above — the honesty check. */
  readonly unshown: readonly string[];
}

/** Payload keys that are ids of beings; rendered as names, never as raw ids. */
const BEING_ID_KEYS: ReadonlySet<string> = new Set([
  "agent_id", "child_id", "victim_id", "killer_id", "attacker_id", "giver_id",
  "recipient_id", "revived_id", "speaker_id", "target_id", "sender_id",
  "receiver_id", "initiator_id", "acceptor_id", "rejecter_id", "builder_id",
  "owner_id", "previous_owner_id", "new_owner_id", "breacher_id",
  // `agent_died` carries the killer twice, and BOTH are ids: `killer_id` and a
  // bare `killer`. Neither is a name, whatever the key suggests.
  "killer",
]);

const BEING_LIST_KEYS: ReadonlySet<string> = new Set([
  "parent_ids", "stakeholders", "previous_stakeholders", "new_stakeholders",
  "breachers", "recipients",
]);

/** Keys carried purely for plumbing; the panel has better places for them. */
const PLUMBING_KEYS: ReadonlySet<string> = new Set([
  "message", "region", "target_home", "run_id", "world_time",
]);

/** Human label per payload key. Only keys the world actually emits appear here. */
const LABEL: Readonly<Record<string, string>> = Object.freeze({
  agent_id: "being", child_id: "the child", child_name: "named",
  victim_id: "victim", victim_name: "victim", killer_id: "killer", killer: "killer",
  attacker_id: "attacker", giver_id: "giver", recipient_id: "recipient",
  revived_id: "revived", speaker_id: "speaker", target_id: "spoken to",
  sender_id: "sender", receiver_id: "receiver", initiator_id: "asked",
  acceptor_id: "accepted", rejecter_id: "refused by", builder_id: "builder",
  owner_id: "owner", previous_owner_id: "owner before", new_owner_id: "owner now",
  breacher_id: "broke in", parent_ids: "parents", stakeholders: "household",
  previous_stakeholders: "household before", new_stakeholders: "household now",
  breachers: "the party", recipients: "shared among", agent_count: "beings breathing",
  amount: "amount", damage: "damage dealt",
  attack_damage: "damage dealt", attack_energy_cost: "cost the striker",
  attacker_energy: "striker's energy after", victim_energy: "victim's energy after",
  energy: "energy", materials: "materials",
  agent_energy: "energy after", agent_materials: "materials after",
  giver_energy: "giver's energy after", revived_energy: "revived to",
  sender_energy: "sender's energy after", sender_materials: "sender's materials after",
  receiver_energy: "receiver's energy after", receiver_materials: "receiver's materials after",
  initiator_energy: "asker's energy after", initiator_materials: "asker's materials after",
  region_energy: "the place's energy left", region_materials: "the place's materials left",
  move_energy_cost: "cost to travel", speak_energy_cost: "cost to speak",
  energy_cost: "energy spent", materials_cost: "materials spent",
  materials_burned: "materials burned", energy_gained: "energy gained",
  looted_energy: "energy taken from the body", looted_materials: "materials taken from the body",
  committed_resources: "the parents paid", child_resources: "the child arrived with",
  offspring_multiplier: "offspring multiplier",
  resources: "held in escrow", resources_refunded: "refunded",
  loot: "taken", loot_shares: "split",
  home_id: "home", integrity: "integrity after", max_integrity: "integrity at full",
  integrity_damage: "damage to the wall", vault_materials: "in the vault",
  remnant_materials: "left in the rubble", from_region: "left", to_region: "reached",
  trigger: "brought down by", intent: "intent", reason: "reason",
  victim_was_paralyzed: "victim was already fallen",
  resource_type: "resource", died_at: "died at", decayed_at: "returned to the earth at",
  ruined_at: "fell at", built_at: "built at", proposal_timestamp: "proposal stamped",
  last_mated_at: "last mated at",
});

/** The one or two fields that carry each type's meaning, emphasised in the panel. */
const WEIGHTY: Readonly<Record<string, readonly string[]>> = Object.freeze({
  agent_paralyzed: ["trigger"],
  agent_died: ["victim_was_paralyzed", "attack_damage"],
  home_thieved: ["loot_shares"],
  home_colonized: ["previous_owner_id", "new_owner_id"],
  home_left: ["previous_stakeholders", "stakeholders"],
  agent_born: ["committed_resources", "child_resources"],
  home_breached: ["integrity_damage"],
  agent_recovered: ["giver_energy", "revived_energy"],
  agent_decayed: ["died_at", "decayed_at"],
});

type DetailGroupKey = "who" | "ledger" | "place" | "circumstance";

function groupOf(key: string): DetailGroupKey {
  if (BEING_ID_KEYS.has(key) || BEING_LIST_KEYS.has(key) || key.endsWith("_name")) return "who";
  if (["home_id", "integrity", "max_integrity", "vault_materials", "remnant_materials",
    "integrity_damage", "from_region", "to_region", "region_energy", "region_materials",
  ].includes(key)) return "place";
  if (key === "trigger" || key === "intent" || key === "reason"
    || key === "victim_was_paralyzed" || key === "resource_type"
    || key.endsWith("_at") || key === "proposal_timestamp" || key === "agent_count") {
    return "circumstance";
  }
  return "ledger";
}

function labelFor(key: string): string {
  return LABEL[key] ?? key.replace(/_/gu, " ");
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** `80` not `80.0`; `1.6` kept. Simulation figures are usually whole floats. */
function figure(value: number): string {
  return Number.isInteger(value)
    ? String(value)
    : value.toFixed(2).replace(/0+$/u, "").replace(/\.$/u, "");
}

/** Epoch seconds to a relative in-world stamp; the sim's clock has no calendar. */
function stamp(value: number, base: number | null): string {
  if (base === null) return `t+${figure(value)}`;
  const delta = value - base;
  if (Math.abs(delta) < 0.5) return "this same moment";
  const sign = delta < 0 ? "-" : "+";
  const seconds = Math.abs(delta);
  return seconds >= 60
    ? `${sign}${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
    : `${sign}${figure(Math.round(seconds))}s`;
}

function renderValue(
  key: string,
  value: unknown,
  nameOf: (id: string) => string,
  wallTimestamp: number | null,
): string | null {
  if (value === null || value === undefined) return null;
  if (BEING_ID_KEYS.has(key) && typeof value === "string") {
    return value === "system" || value === "world" ? "the world" : nameOf(value);
  }
  if (BEING_LIST_KEYS.has(key) && Array.isArray(value)) {
    const names = value.filter((item): item is string => typeof item === "string").map(nameOf);
    return names.length === 0 ? "no one" : names.join(", ");
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") {
    return key.endsWith("_at") || key === "proposal_timestamp"
      ? stamp(value, wallTimestamp)
      : figure(value);
  }
  if (typeof value === "string") return key === "home_id" ? value : value.replace(/_/gu, " ");
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (typeof value === "object") {
    // `{energy: 50, materials: 30}` and `{wanderer_002: 20, wanderer_004: 20}`.
    const record = value as Readonly<Record<string, unknown>>;
    const parts: string[] = [];
    for (const [inner, innerValue] of Object.entries(record)) {
      const asNumber = num(innerValue);
      if (asNumber === null) continue;
      if (asNumber === 0 && (inner === "energy" || inner === "materials")) continue;
      const who = inner === "energy" || inner === "materials" ? inner : nameOf(inner);
      parts.push(`${figure(asNumber)} ${who}`);
    }
    return parts.length === 0 ? "nothing" : parts.join(" · ");
  }
  return null;
}

/**
 * The before-values the world does not emit, reconstructed only where the
 * arithmetic is exact and complete. Always flagged `derived`.
 */
function derivedRows(event: StreamEvent): readonly DetailRow[] {
  const payload = event.payload;
  const rows: DetailRow[] = [];
  const push = (label: string, value: string): void => {
    rows.push({ label, value, derived: true });
  };
  switch (event.type) {
    case "attack": {
      const after = num(payload["victim_energy"]);
      const damage = num(payload["damage"]);
      if (after !== null && damage !== null) push("victim's energy before", figure(after + damage));
      const striker = num(payload["attacker_energy"]);
      const spent = num(payload["attack_energy_cost"]);
      if (striker !== null && spent !== null) {
        push("striker's energy before", figure(striker + spent));
      }
      break;
    }
    case "hearth_used": {
      const after = num(payload["agent_energy"]);
      const gained = num(payload["energy_gained"]);
      if (after !== null && gained !== null) push("energy before", figure(after - gained));
      break;
    }
    case "resource_changed": {
      const kind = payload["resource_type"];
      const amount = num(payload["amount"]);
      const after = num(kind === "energy" ? payload["agent_energy"] : payload["agent_materials"]);
      if (amount !== null && after !== null) push(`${String(kind)} before`, figure(after - amount));
      break;
    }
    case "agent_decayed": {
      const died = num(payload["died_at"]);
      const decayed = num(payload["decayed_at"]);
      if (died !== null && decayed !== null) {
        const seconds = decayed - died;
        push("lay unclaimed for", seconds >= 60
          ? `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`
          : `${figure(seconds)}s`);
      }
      break;
    }
    case "agent_born": {
      const paid = payload["committed_resources"];
      const got = payload["child_resources"];
      if (typeof paid === "object" && paid !== null && typeof got === "object" && got !== null) {
        const paidRecord = paid as Record<string, unknown>;
        const gotRecord = got as Record<string, unknown>;
        const paidTotal = (num(paidRecord["energy"]) ?? 0) + (num(paidRecord["materials"]) ?? 0);
        const gotTotal = (num(gotRecord["energy"]) ?? 0) + (num(gotRecord["materials"]) ?? 0);
        if (paidTotal > 0) {
          push("the world added", `${figure(gotTotal - paidTotal)} beyond what was paid`);
        }
      }
      break;
    }
    default:
      break;
  }
  return rows;
}

/**
 * A run of related events, **inferred** — because the schema has no causal link.
 *
 * Three back-references are genuine (`agent_paralyzed.trigger` + `attacker_id`,
 * `agent_decayed.died_at`, and `mating_initiated.proposal_timestamp` echoed
 * forward); everything else is shared-identity adjacency, and the panel says so.
 */
export function chainAround(
  event: StreamEvent,
  delivered: readonly StreamEvent[],
  limit = 5,
): readonly StreamEvent[] {
  const windowMs = 6_000;
  const ids = new Set(event.participants);
  const related = delivered.filter((candidate) => {
    if (candidate.id === event.id) return false;
    if (Math.abs(candidate.atMs - event.atMs) > windowMs) return false;
    if (candidate.homeId !== null && candidate.homeId === event.homeId) return true;
    return candidate.participants.some((id) => ids.has(id));
  });
  // Nearest in time, then back into order: a panel that lists twenty related
  // rows has stopped being progressive disclosure and become a second feed.
  return Object.freeze([...related]
    .sort((left, right) => Math.abs(left.atMs - event.atMs) - Math.abs(right.atMs - event.atMs))
    .slice(0, limit)
    .sort((left, right) => left.cursor - right.cursor));
}

/**
 * The four types whose `message` is a being *speaking*.
 *
 * Every one of the 28 types carries a `message`, but for 24 of them it is
 * machine prose written for a log and it leaks internal ids. Only these four are
 * safe to show a viewer verbatim.
 */
const UTTERANCE_TYPES: ReadonlySet<string> = new Set([
  "speak", "self_talk", "mating_initiated", "mating_rejected",
]);

/** Builds the detail model for one event, from that event's own payload only. */
export function detailFor(
  event: StreamEvent,
  nameOf: (id: string) => string,
): EventDetail {
  const buckets: Record<DetailGroupKey, DetailRow[]> = {
    who: [], ledger: [], place: [], circumstance: [],
  };
  const unshown: string[] = [];
  const weighty = new Set(WEIGHTY[event.type] ?? []);

  for (const [key, value] of Object.entries(event.payload)) {
    if (PLUMBING_KEYS.has(key)) continue;
    const rendered = renderValue(key, value, nameOf, event.wallTimestamp);
    if (rendered === null) {
      unshown.push(key);
      continue;
    }
    buckets[groupOf(key)].push({
      label: labelFor(key),
      value: rendered,
      ...(weighty.has(key) ? { weighty: true } : {}),
      ...(BEING_ID_KEYS.has(key)
        && typeof value === "string"
        && value !== "system"
        && value !== "world"
        ? { beingId: value }
        : {}),
    });
  }

  for (const row of derivedRows(event)) buckets.ledger.push(row);

  const groups: DetailGroup[] = [];
  const add = (title: string, rows: readonly DetailRow[]): void => {
    // Several payloads name one being under two keys (`victim_id` AND
    // `victim_name`; `killer` AND `killer_id`). That is one fact, so it is one
    // line — showing it twice reads as two people.
    const seen = new Set<string>();
    const unique = rows.filter((row) => {
      const key = `${row.label} ${row.value}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (unique.length > 0) groups.push({ title, rows: Object.freeze(unique) });
  };
  add("who", buckets.who);
  add("the ledger", buckets.ledger);
  add("the place", buckets.place);
  add("circumstance", buckets.circumstance);

  const message = event.payload["message"];
  const spoken = UTTERANCE_TYPES.has(event.type)
    && typeof message === "string"
    && message.length > 0;
  return Object.freeze({
    groups: Object.freeze(groups),
    message: spoken ? message as string : null,
    unshown: Object.freeze(unshown),
  });
}
