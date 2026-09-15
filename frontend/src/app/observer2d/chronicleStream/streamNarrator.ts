/**
 * Turns one canonical world event into the in-world sentence the killfeed reads.
 *
 * This is the production home of the narrator the event-journey pilot proved out
 * (see `.superpowers/sdd/event-journey-pilot-report.md`, "Round 2 — STREAM"). The
 * killfeed is an *event*-level surface, not a moment-level one, so it cannot use
 * `publicViewModels`' per-moment title/summary: every one of the 28 canonical
 * event types must resolve to exactly one readable present-tense sentence.
 *
 * Voice rules enforced here (see `docs/frontend/VISION.md` §2.2):
 *   - in-world observer, sentence case, concrete and plain;
 *   - "being" not agent, "home"/"hall" not house, "hearth", "vault", "hoard",
 *     "ruin", "fallen" (not paralyzed), "returns to the earth" (decay),
 *     "was slain by" / "a journey ended" (death);
 *   - names always come from resolved display names, never a raw payload id;
 *   - the only raw payload text ever surfaced is a being's own spoken `message`
 *     (`speak` / `self_talk` / `mating_initiated` / `mating_rejected`), and only
 *     through {@link Narration.quote}.
 *
 * The function never throws and never returns an empty line: an unknown type
 * resolves to a safe fallback rather than a blank row.
 */

import { formatPublicNumber as formatNumber } from "../formatPublicNumber";

/** Everything {@link narrateStreamEvent} needs to describe one canonical event. */
export interface StreamNarrationInput {
  /** A canonical event type (one of the 28 in `events/eventVisualCatalog.ts`). */
  readonly type: string;
  /** The raw `entry.event.payload` object, exactly as the transport delivered it. */
  readonly payload: Readonly<Record<string, unknown>>;
  /** Display name of the acting being, or null when the world itself acted. */
  readonly actorName: string | null;
  /** Display name of the being it was aimed at, or null. */
  readonly targetName: string | null;
  /** Human region label, already title-cased (e.g. "Warm Springs"), or null. */
  readonly regionLabel: string | null;
  /** Being id to display name; must return a safe fallback for unknown ids. */
  readonly nameOf: (id: string) => string;
  /** Exported landmark copy for a validated spatial journey, when its map is known. */
  readonly spatialDestinationName?: string | null;
}

/** The narrated form of one canonical event, ready to render in a card. */
export interface Narration {
  /** One or two lowercase words naming the act ("gathered", "struck", "moved on"). */
  readonly verb: string;
  /** One sentence in the in-world observer voice. Sentence case, ends with a period. */
  readonly line: string;
  /** Exact payload figures, or null when the payload carries no figure worth showing. */
  readonly detail: string | null;
  /** The being's own words, trimmed to 150 chars on a word boundary; null otherwise. */
  readonly quote: string | null;
}

/** Short past-tense verb per event type, independent of payload. */
export const STREAM_VERBS: Readonly<Record<string, string>> = Object.freeze({
  agent_born: "born",
  agent_died: "slain",
  agent_decayed: "decayed",
  agent_paralyzed: "fallen",
  agent_recovered: "revived",
  agent_left_region: "moved on",
  agent_entered_region: "arrived",
  spatial_travel_started: "walking",
  spatial_travel_cancelled: "rested",
  spatial_travel_arrived: "arrived",
  speak: "spoke",
  self_talk: "thought",
  resource_changed: "gathered",
  resource_transferred: "gave",
  agent_started_hoarding: "hoarded",
  mating_initiated: "asked",
  mating_rejected: "refused",
  mating_proposal_invalidated: "lapsed",
  mating_proposal_timeout: "lapsed",
  attack: "struck",
  home_built: "built",
  hearth_used: "warmed",
  home_joined: "joined",
  home_left: "left",
  home_started_hoarding: "vaulted",
  home_collapsed: "ruined",
  home_breached: "breached",
  home_thieved: "robbed",
  home_colonized: "claimed",
  ruins_scavenged: "scavenged",
  simulation_started: "began",
});

const FALLBACK_VERB = "acted";

/**
 * Narrates one canonical event as a viewer-facing sentence.
 *
 * Pure: reads only its input, mutates nothing, emits no events. Never throws and
 * never returns an empty `line`.
 */
export function narrateStreamEvent(input: StreamNarrationInput): Narration {
  const { type, payload, actorName, targetName, regionLabel } = input;
  const actor = actorName ?? "someone";
  const target = targetName ?? "someone";

  switch (type) {
    case "agent_born": {
      const childName = readString(payload, "child_name") ?? "a new being";
      const parentIds = readStringArray(payload, "parent_ids");
      const parentNames = parentIds.length > 0
        ? parentIds.map((id) => input.nameOf(id))
        : [actorName, targetName].filter((name): name is string => name !== null);
      const resources = readRecord(payload, "child_resources");
      const energy = readNumber(resources, "energy");
      const materials = readNumber(resources, "materials");
      const detailParts: string[] = [];
      if (parentNames.length > 0) detailParts.push(`parents ${joinNames(parentNames)}`);
      if (energy !== null && materials !== null) {
        detailParts.push(`${formatNumber(energy)} energy, ${formatNumber(materials)} materials`);
      }
      return narration("agent_born", `A new life — ${childName}.`, detailParts, null);
    }

    case "agent_died": {
      const victimName = targetName ?? readString(payload, "victim_name") ?? "someone";
      const killerName = actorName;
      const line = killerName !== null && killerName !== victimName
        ? `${victimName}'s journey ended, slain by ${killerName}.`
        : `${victimName}'s journey ended.`;
      const damage = readNumber(payload, "attack_damage");
      const lootedEnergy = readNumber(payload, "looted_energy");
      const lootedMaterials = readNumber(payload, "looted_materials");
      const detailParts: string[] = [];
      if (damage !== null) detailParts.push(`${formatNumber(damage)} damage`);
      if ((lootedEnergy !== null && lootedEnergy > 0)
        || (lootedMaterials !== null && lootedMaterials > 0)) {
        detailParts.push(
          `${formatNumber(lootedEnergy ?? 0)} energy and `
          + `${formatNumber(lootedMaterials ?? 0)} materials taken`,
        );
      }
      return narration("agent_died", line, detailParts, null);
    }

    case "agent_decayed": {
      const name = actorName ?? readString(payload, "agent_name") ?? "someone";
      return narration("agent_decayed", `${name} returns to the earth.`, [], null);
    }

    case "agent_paralyzed": {
      const energy = readNumber(payload, "energy");
      // The one who falls is the victim, never the attacker whose blow felled
      // them — the payload names both, and the caller's actor is the striker.
      const victimId = readString(payload, "victim_id") ?? readString(payload, "agent_id");
      const fallen = victimId !== null ? input.nameOf(victimId) : (targetName ?? actor);
      return narration(
        "agent_paralyzed",
        `${fallen} has fallen.`,
        energy === null ? [] : [`${formatNumber(energy)} energy`],
        null,
      );
    }

    case "agent_recovered": {
      const amount = readNumber(payload, "amount");
      const resourceType = readString(payload, "resource_type") ?? "energy";
      return narration(
        "agent_recovered",
        `${actor}'s gift raised ${target}.`,
        amount === null ? [] : [`+${formatNumber(amount)} ${resourceType}`],
        null,
      );
    }

    case "agent_left_region": {
      const fromRegion = readString(payload, "from_region");
      const label = fromRegion !== null ? titleCase(fromRegion) : regionLabel ?? "the region";
      return narration("agent_left_region", `${actor} left ${label}.`, [], null);
    }

    case "agent_entered_region": {
      const toRegion = readString(payload, "to_region");
      const label = toRegion !== null ? titleCase(toRegion) : regionLabel ?? "the region";
      return narration("agent_entered_region", `${actor} reached ${label}.`, [], null);
    }

    case "spatial_travel_started":
      return narration(
        "spatial_travel_started",
        `${actor} began walking to ${spatialDestinationLabel(payload, input.spatialDestinationName)}.`,
        [],
        null,
      );

    case "spatial_travel_cancelled":
      return narration(
        "spatial_travel_cancelled",
        `${actor} came to rest on the way to ${spatialDestinationLabel(payload, input.spatialDestinationName)}.`,
        [],
        null,
      );

    case "spatial_travel_arrived":
      return narration(
        "spatial_travel_arrived",
        `${actor} arrived at ${spatialDestinationLabel(payload, input.spatialDestinationName)}.`,
        [],
        null,
      );

    case "speak": {
      const message = readString(payload, "message");
      const targetId = readString(payload, "target_id");
      const line = targetId !== null
        ? `${actor} spoke low to ${target}.`
        : regionLabel !== null
          ? `${actor} spoke at ${regionLabel}.`
          : `${actor} spoke.`;
      return narration("speak", line, [], message);
    }

    case "self_talk": {
      const message = readString(payload, "message");
      return narration(
        "self_talk",
        `${actor} turned something over alone.`,
        [],
        message,
      );
    }

    case "resource_changed": {
      const resourceType = readString(payload, "resource_type") ?? "resources";
      const amount = readNumber(payload, "amount");
      const holding = resourceType === "materials"
        ? readNumber(payload, "agent_materials")
        : readNumber(payload, "agent_energy");
      const regionSuffix = regionLabel !== null ? ` at ${regionLabel}` : "";
      const verbPhrase = amount !== null && amount < 0 ? "spent" : "gathered";
      const detailParts: string[] = [];
      if (amount !== null) {
        const signed = amount >= 0 ? `+${formatNumber(amount)}` : formatNumber(amount);
        detailParts.push(`${signed} ${resourceType}`);
      }
      if (holding !== null) detailParts.push(`holds ${formatNumber(holding)}`);
      return narration(
        "resource_changed",
        `${actor} ${verbPhrase} ${resourceType}${regionSuffix}.`,
        detailParts,
        null,
      );
    }

    case "resource_transferred": {
      const resourceType = readString(payload, "resource_type") ?? "resources";
      const amount = readNumber(payload, "amount");
      return narration(
        "resource_transferred",
        `${actor} gave ${target} ${resourceType}.`,
        amount === null ? [] : [`${formatNumber(amount)} ${resourceType}`],
        null,
      );
    }

    case "agent_started_hoarding": {
      const energy = readNumber(payload, "energy");
      const materials = readNumber(payload, "materials");
      const detailParts: string[] = [];
      if (energy !== null) detailParts.push(`${formatNumber(energy)} energy`);
      if (materials !== null) detailParts.push(`${formatNumber(materials)} materials`);
      return narration("agent_started_hoarding", `${actor} began to hoard.`, detailParts, null);
    }

    case "mating_initiated":
      return narration(
        "mating_initiated",
        `${actor} asked ${target} to make a life.`,
        [],
        quoteOf(payload),
      );

    case "mating_rejected":
      return narration("mating_rejected", `${actor} refused ${target}.`, [], quoteOf(payload));

    case "mating_proposal_timeout":
      return narration("mating_proposal_timeout", `${actor}'s asking went unanswered.`, [], null);

    case "mating_proposal_invalidated":
      return narration(
        "mating_proposal_invalidated",
        `${actor}'s asking came to nothing.`,
        [],
        null,
      );

    case "attack": {
      const damage = readNumber(payload, "damage");
      const victimEnergy = readNumber(payload, "victim_energy");
      const detailParts: string[] = [];
      if (damage !== null) detailParts.push(`${formatNumber(damage)} damage`);
      if (victimEnergy !== null) detailParts.push(`${target} at ${formatNumber(victimEnergy)} energy`);
      return narration("attack", `${actor} struck ${target}.`, detailParts, null);
    }

    case "home_built": {
      const materialsCost = readNumber(payload, "materials_cost");
      const integrity = readNumber(payload, "integrity");
      const regionSuffix = regionLabel !== null ? ` at ${regionLabel}` : "";
      const detailParts = materialsCost !== null && integrity !== null
        ? [`${formatNumber(materialsCost)} materials · integrity ${formatNumber(integrity)}`]
        : [];
      return narration("home_built", `${actor} raised a home${regionSuffix}.`, detailParts, null);
    }

    case "hearth_used": {
      const burned = readNumber(payload, "materials_burned");
      const gained = readNumber(payload, "energy_gained");
      const detailParts = burned !== null && gained !== null
        ? [`${formatNumber(burned)} materials burned · +${formatNumber(gained)} energy`]
        : [];
      return narration("hearth_used", `${actor} fed the hearth.`, detailParts, null);
    }

    case "home_joined":
      return narration(
        "home_joined",
        targetName !== null ? `${actor} joined ${target}'s home.` : `${actor} joined a home.`,
        [],
        null,
      );

    case "home_left":
      return narration("home_left", `${actor} left the home.`, [], null);

    case "home_started_hoarding": {
      const vaultMaterials = readNumber(payload, "vault_materials");
      return narration(
        "home_started_hoarding",
        regionLabel !== null ? `The vault at ${regionLabel} is hoarding.` : "A vault is hoarding.",
        vaultMaterials === null ? [] : [`${formatNumber(vaultMaterials)} materials`],
        null,
      );
    }

    case "home_collapsed": {
      const remnant = readNumber(payload, "remnant_materials");
      return narration(
        "home_collapsed",
        regionLabel !== null
          ? `A home at ${regionLabel} has fallen to ruin.`
          : "A home has fallen to ruin.",
        remnant === null ? [] : [`${formatNumber(remnant)} materials left in the rubble`],
        null,
      );
    }

    case "home_breached": {
      const intent = readString(payload, "intent");
      const integrity = readNumber(payload, "integrity");
      const base = regionLabel !== null
        ? `${actor} broke into a home at ${regionLabel}`
        : `${actor} broke into a home`;
      return narration(
        "home_breached",
        intent === "colonize" ? `${base}, meaning to take it.` : `${base}.`,
        integrity === null ? [] : [`integrity ${formatNumber(integrity)}`],
        null,
      );
    }

    case "home_thieved": {
      const recipients = readStringArray(payload, "recipients");
      const others = recipients.length > 1 ? recipients.length - 1 : 0;
      const line = others > 0
        ? `${actor} and ${others} other${others > 1 ? "s" : ""} stripped a home's vault.`
        : `${actor} stripped a home's vault.`;
      const lootMaterials = readNumber(readRecord(payload, "loot"), "materials");
      return narration(
        "home_thieved",
        line,
        lootMaterials === null ? [] : [`${formatNumber(lootMaterials)} materials taken`],
        null,
      );
    }

    case "home_colonized":
      return narration(
        "home_colonized",
        actorName !== null ? `${actorName} claimed the home.` : "Someone claimed the home.",
        [],
        null,
      );

    case "ruins_scavenged": {
      const amount = readNumber(payload, "amount");
      return narration(
        "ruins_scavenged",
        `${actor} picked over the ruin.`,
        amount === null ? [] : [`+${formatNumber(amount)} materials`],
        null,
      );
    }

    case "simulation_started": {
      const agentCount = readNumber(payload, "agent_count");
      return narration(
        "simulation_started",
        agentCount !== null
          ? `The world wakes — ${formatNumber(agentCount)} being${agentCount === 1 ? "" : "s"} breathing.`
          : "The world wakes.",
        [],
        null,
      );
    }

    default:
      return Object.freeze({
        verb: FALLBACK_VERB,
        line: actorName !== null ? `${actorName} did something.` : "Something happened.",
        detail: null,
        quote: null,
      });
  }
}

function narration(
  type: string,
  line: string,
  detailParts: readonly string[],
  quote: string | null,
): Narration {
  return Object.freeze({
    verb: STREAM_VERBS[type] ?? FALLBACK_VERB,
    line,
    detail: detailParts.length > 0 ? detailParts.join(" · ") : null,
    quote,
  });
}

/** The mating pair's own words, when the payload carried an utterance. */
function quoteOf(payload: Readonly<Record<string, unknown>>): string | null {
  return readString(payload, "message");
}

/** Reads a string field, returning null when absent or the wrong type. */
function readString(payload: Readonly<Record<string, unknown>>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Reads a finite-number field, returning null when absent or the wrong type. */
function readNumber(payload: Readonly<Record<string, unknown>>, key: string): number | null {
  const value = payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Reads a string-array field, returning an empty array when absent or malformed. */
function readStringArray(
  payload: Readonly<Record<string, unknown>>,
  key: string,
): readonly string[] {
  const value = payload[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/** Reads a nested object field, returning an empty record when absent or malformed. */
function readRecord(
  payload: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, unknown>> {
  const value = payload[key];
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Readonly<Record<string, unknown>>;
}

/** Title-cases a snake_case / kebab-case / spaced region id. */
function titleCase(id: string): string {
  const words = id.split(/[_\-\s]+/u).filter((part) => part.length > 0);
  if (words.length === 0) return id;
  return words
    .map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`)
    .join(" ");
}

/** Turns a backend destination key into readable anchor copy without printing arbitrary payload text. */
function spatialDestinationLabel(
  payload: Readonly<Record<string, unknown>>,
  exportedName: string | null | undefined,
): string {
  if (typeof exportedName === "string" && exportedName.trim().length > 0) return exportedName;
  const destinationId = readString(payload, "destination_id");
  if (destinationId === null || !/^[a-z][a-z0-9_-]{0,79}$/iu.test(destinationId)) {
    return "the destination";
  }
  return titleCase(destinationId);
}

/** Joins names in prose form: "A", "A and B", "A, B and C". */
function joinNames(names: readonly string[]): string {
  const filtered = names.filter((name) => name.length > 0);
  if (filtered.length === 0) return "";
  if (filtered.length === 1) return filtered[0]!;
  if (filtered.length === 2) return `${filtered[0]} and ${filtered[1]}`;
  return `${filtered.slice(0, -1).join(", ")} and ${filtered.at(-1)}`;
}
