/**
 * Translates a single canonical world event into in-world observer prose.
 *
 * This is a speed-first QA pilot module (see CLAUDE.md §5 pilot exception): it turns
 * the raw, machine-shaped event payloads described in `presentation/eventPayloads.ts`
 * into the plain, present-tense "journey" narration a viewer sees in the event
 * journey pilot. It never surfaces raw ids, never uses simulation-internals
 * vocabulary, and never throws — every one of the 28 canonical event types (plus any
 * future/unknown type) resolves to a safe, readable line.
 *
 * Voice rules enforced here (see `docs/frontend/VISION.md` §2.2):
 *   - in-world observer, sentence case, concrete and plain;
 *   - "being" not agent, "home"/"hall" not house, "hearth", "vault", "hoard",
 *     "ruin", "fallen" (not paralyzed), "returns to the earth" (decay), "was slain
 *     by" / "a journey ended" (death);
 *   - names are always resolved through `actorName` / `targetName` / `nameOf` —
 *     never a raw payload id;
 *   - the only raw payload text ever surfaced to a viewer is a being's own spoken
 *     `message` (`speak` / `self_talk`), and only via `Narration.quote`.
 */

/** Everything `narrateJourneyEvent` needs to describe one canonical event. */
export interface NarrationInput {
  /** A canonical event type (one of the 28 in `frontend/src/events/eventVisualCatalog.ts`). */
  readonly type: string;
  /** The raw `entry.event.payload` object. */
  readonly payload: Readonly<Record<string, unknown>>;
  /** Display name of the acting being, or null. */
  readonly actorName: string | null;
  /** Display name of the being it was aimed at, or null. */
  readonly targetName: string | null;
  /** Human region label, already title-cased, e.g. "Warm Springs", or null. */
  readonly regionLabel: string | null;
  /** id -> display name; returns a safe fallback ("someone") for unknown ids. */
  readonly nameOf: (id: string) => string;
}

/** The narrated form of a single canonical event, ready to render in the journey. */
export interface Narration {
  /** 1-2 lowercase words naming the act, used as the fold label in aggregated rows: "gathered", "spoke", "struck", "moved on". */
  readonly verb: string;
  /** ONE sentence in the in-world observer voice. Sentence case, ends with a period, <= 92 chars. */
  readonly line: string;
  /** Optional second line of exact figures pulled from the payload, e.g. "+12 materials · vault 40". Null when the payload has no figure worth showing. */
  readonly detail: string | null;
  /** For `speak` and `self_talk` only: the being's own words, trimmed on a word boundary to <= 150 chars with a trailing "…" if cut. Null for every other type. */
  readonly quote: string | null;
}

/** Short past-tense verb per event type, independent of payload — for count-folding ("12 gathered"). */
export const JOURNEY_VERBS: Readonly<Record<string, string>> = Object.freeze({
  agent_born: "born",
  agent_died: "slain",
  agent_decayed: "decayed",
  agent_paralyzed: "fallen",
  agent_recovered: "revived",
  agent_left_region: "moved on",
  agent_entered_region: "arrived",
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

/** Narrates one canonical event as a viewer-facing sentence. Never throws, never empty. */
export function narrateJourneyEvent(input: NarrationInput): Narration {
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
      return {
        verb: JOURNEY_VERBS.agent_born,
        line: `A new life — ${childName}.`,
        detail: detailParts.length > 0 ? detailParts.join(" · ") : null,
        quote: null,
      };
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
      if ((lootedEnergy !== null && lootedEnergy > 0) || (lootedMaterials !== null && lootedMaterials > 0)) {
        detailParts.push(`${formatNumber(lootedEnergy ?? 0)} energy and ${formatNumber(lootedMaterials ?? 0)} materials taken`);
      }
      return {
        verb: JOURNEY_VERBS.agent_died,
        line,
        detail: detailParts.length > 0 ? detailParts.join(" · ") : null,
        quote: null,
      };
    }

    case "agent_decayed": {
      const name = actorName ?? readString(payload, "agent_name") ?? "someone";
      return { verb: JOURNEY_VERBS.agent_decayed, line: `${name} returns to the earth.`, detail: null, quote: null };
    }

    case "agent_paralyzed": {
      const energy = readNumber(payload, "energy");
      // The one who falls is the victim, never the attacker whose blow felled
      // them — the payload names both, and the caller's `actor` is the striker.
      const victimId = readString(payload, "victim_id") ?? readString(payload, "agent_id");
      const fallen = victimId !== null ? input.nameOf(victimId) : (targetName ?? actor);
      return {
        verb: JOURNEY_VERBS.agent_paralyzed,
        line: `${fallen} has fallen.`,
        detail: energy !== null ? `${formatNumber(energy)} energy` : null,
        quote: null,
      };
    }

    case "agent_recovered": {
      const amount = readNumber(payload, "amount");
      const resourceType = readString(payload, "resource_type") ?? "energy";
      return {
        verb: JOURNEY_VERBS.agent_recovered,
        line: `${actor}'s gift raised ${target}.`,
        detail: amount !== null ? `+${formatNumber(amount)} ${resourceType}` : null,
        quote: null,
      };
    }

    case "agent_left_region": {
      const fromRegion = readString(payload, "from_region");
      const label = fromRegion !== null ? titleCase(fromRegion) : regionLabel ?? "the region";
      return { verb: JOURNEY_VERBS.agent_left_region, line: `${actor} left ${label}.`, detail: null, quote: null };
    }

    case "agent_entered_region": {
      const toRegion = readString(payload, "to_region");
      const label = toRegion !== null ? titleCase(toRegion) : regionLabel ?? "the region";
      return { verb: JOURNEY_VERBS.agent_entered_region, line: `${actor} reached ${label}.`, detail: null, quote: null };
    }

    case "speak": {
      const message = readString(payload, "message");
      const targetId = readString(payload, "target_id");
      const line = targetId !== null
        ? `${actor} spoke low to ${target}.`
        : regionLabel !== null
          ? `${actor} spoke at ${regionLabel}.`
          : `${actor} spoke.`;
      return {
        verb: JOURNEY_VERBS.speak,
        line,
        detail: null,
        quote: message !== null ? clampQuote(message) : null,
      };
    }

    case "self_talk": {
      const message = readString(payload, "message");
      return {
        verb: JOURNEY_VERBS.self_talk,
        line: `${actor} turned something over alone.`,
        detail: null,
        quote: message !== null ? clampQuote(message) : null,
      };
    }

    case "resource_changed": {
      const resourceType = readString(payload, "resource_type") ?? "resources";
      const amount = readNumber(payload, "amount");
      const holding = resourceType === "materials" ? readNumber(payload, "agent_materials") : readNumber(payload, "agent_energy");
      const regionSuffix = regionLabel !== null ? ` at ${regionLabel}` : "";
      const verbPhrase = amount !== null && amount < 0 ? "spent" : "gathered";
      const detailParts: string[] = [];
      if (amount !== null) {
        const signed = amount >= 0 ? `+${formatNumber(amount)}` : formatNumber(amount);
        detailParts.push(`${signed} ${resourceType}`);
      }
      if (holding !== null) detailParts.push(`holds ${formatNumber(holding)}`);
      return {
        verb: JOURNEY_VERBS.resource_changed,
        line: `${actor} ${verbPhrase} ${resourceType}${regionSuffix}.`,
        detail: detailParts.length > 0 ? detailParts.join(" · ") : null,
        quote: null,
      };
    }

    case "resource_transferred": {
      const resourceType = readString(payload, "resource_type") ?? "resources";
      const amount = readNumber(payload, "amount");
      return {
        verb: JOURNEY_VERBS.resource_transferred,
        line: `${actor} gave ${target} ${resourceType}.`,
        detail: amount !== null ? `${formatNumber(amount)} ${resourceType}` : null,
        quote: null,
      };
    }

    case "agent_started_hoarding": {
      const energy = readNumber(payload, "energy");
      const materials = readNumber(payload, "materials");
      const detailParts: string[] = [];
      if (energy !== null) detailParts.push(`${formatNumber(energy)} energy`);
      if (materials !== null) detailParts.push(`${formatNumber(materials)} materials`);
      return {
        verb: JOURNEY_VERBS.agent_started_hoarding,
        line: `${actor} began to hoard.`,
        detail: detailParts.length > 0 ? detailParts.join(" · ") : null,
        quote: null,
      };
    }

    case "mating_initiated":
      return { verb: JOURNEY_VERBS.mating_initiated, line: `${actor} asked ${target} to make a life.`, detail: null, quote: null };

    case "mating_rejected":
      return { verb: JOURNEY_VERBS.mating_rejected, line: `${actor} refused ${target}.`, detail: null, quote: null };

    case "mating_proposal_timeout":
      return { verb: JOURNEY_VERBS.mating_proposal_timeout, line: `${actor}'s asking went unanswered.`, detail: null, quote: null };

    case "mating_proposal_invalidated":
      return { verb: JOURNEY_VERBS.mating_proposal_invalidated, line: `${actor}'s asking came to nothing.`, detail: null, quote: null };

    case "attack": {
      const damage = readNumber(payload, "damage");
      const victimEnergy = readNumber(payload, "victim_energy");
      const detailParts: string[] = [];
      if (damage !== null) detailParts.push(`${formatNumber(damage)} damage`);
      if (victimEnergy !== null) detailParts.push(`${target} at ${formatNumber(victimEnergy)} energy`);
      return {
        verb: JOURNEY_VERBS.attack,
        line: `${actor} struck ${target}.`,
        detail: detailParts.length > 0 ? detailParts.join(" · ") : null,
        quote: null,
      };
    }

    case "home_built": {
      const materialsCost = readNumber(payload, "materials_cost");
      const integrity = readNumber(payload, "integrity");
      const regionSuffix = regionLabel !== null ? ` at ${regionLabel}` : "";
      return {
        verb: JOURNEY_VERBS.home_built,
        line: `${actor} raised a home${regionSuffix}.`,
        detail: materialsCost !== null && integrity !== null
          ? `${formatNumber(materialsCost)} materials · integrity ${formatNumber(integrity)}`
          : null,
        quote: null,
      };
    }

    case "hearth_used": {
      const burned = readNumber(payload, "materials_burned");
      const gained = readNumber(payload, "energy_gained");
      return {
        verb: JOURNEY_VERBS.hearth_used,
        line: `${actor} fed the hearth.`,
        detail: burned !== null && gained !== null
          ? `${formatNumber(burned)} materials burned · +${formatNumber(gained)} energy`
          : null,
        quote: null,
      };
    }

    case "home_joined":
      return {
        verb: JOURNEY_VERBS.home_joined,
        line: targetName !== null ? `${actor} joined ${target}'s home.` : `${actor} joined a home.`,
        detail: null,
        quote: null,
      };

    case "home_left":
      return { verb: JOURNEY_VERBS.home_left, line: `${actor} left the home.`, detail: null, quote: null };

    case "home_started_hoarding": {
      const vaultMaterials = readNumber(payload, "vault_materials");
      return {
        verb: JOURNEY_VERBS.home_started_hoarding,
        line: regionLabel !== null ? `The vault at ${regionLabel} is hoarding.` : "A vault is hoarding.",
        detail: vaultMaterials !== null ? `${formatNumber(vaultMaterials)} materials` : null,
        quote: null,
      };
    }

    case "home_collapsed": {
      const remnant = readNumber(payload, "remnant_materials");
      return {
        verb: JOURNEY_VERBS.home_collapsed,
        line: regionLabel !== null ? `A home at ${regionLabel} has fallen to ruin.` : "A home has fallen to ruin.",
        detail: remnant !== null ? `${formatNumber(remnant)} materials left in the rubble` : null,
        quote: null,
      };
    }

    case "home_breached": {
      const intent = readString(payload, "intent");
      const integrity = readNumber(payload, "integrity");
      const base = regionLabel !== null ? `${actor} broke into a home at ${regionLabel}` : `${actor} broke into a home`;
      return {
        verb: JOURNEY_VERBS.home_breached,
        line: intent === "colonize" ? `${base}, meaning to take it.` : `${base}.`,
        detail: integrity !== null ? `integrity ${formatNumber(integrity)}` : null,
        quote: null,
      };
    }

    case "home_thieved": {
      const recipients = readStringArray(payload, "recipients");
      const others = recipients.length > 1 ? recipients.length - 1 : 0;
      const line = others > 0
        ? `${actor} and ${others} other${others > 1 ? "s" : ""} stripped a home's vault.`
        : `${actor} stripped a home's vault.`;
      const loot = readRecord(payload, "loot");
      const lootMaterials = readNumber(loot, "materials");
      return {
        verb: JOURNEY_VERBS.home_thieved,
        line,
        detail: lootMaterials !== null ? `${formatNumber(lootMaterials)} materials taken` : null,
        quote: null,
      };
    }

    case "home_colonized":
      return {
        verb: JOURNEY_VERBS.home_colonized,
        line: actorName !== null ? `${actorName} claimed the home for himself.` : "Someone claimed the home.",
        detail: null,
        quote: null,
      };

    case "ruins_scavenged": {
      const amount = readNumber(payload, "amount");
      return {
        verb: JOURNEY_VERBS.ruins_scavenged,
        line: `${actor} picked over the ruin.`,
        detail: amount !== null ? `+${formatNumber(amount)} materials` : null,
        quote: null,
      };
    }

    case "simulation_started": {
      const agentCount = readNumber(payload, "agent_count");
      return {
        verb: JOURNEY_VERBS.simulation_started,
        line: agentCount !== null
          ? `The world wakes — ${formatNumber(agentCount)} being${agentCount === 1 ? "" : "s"} breathing.`
          : "The world wakes.",
        detail: null,
        quote: null,
      };
    }

    default:
      return {
        verb: FALLBACK_VERB,
        line: actorName !== null ? `${actorName} did something.` : "Something happened.",
        detail: null,
        quote: null,
      };
  }
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
function readStringArray(payload: Readonly<Record<string, unknown>>, key: string): readonly string[] {
  const value = payload[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

/** Reads a nested object field, returning an empty record when absent or malformed. */
function readRecord(payload: Readonly<Record<string, unknown>>, key: string): Readonly<Record<string, unknown>> {
  const value = payload[key];
  if (value === null || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Readonly<Record<string, unknown>>;
}

/** Rounds to at most 1 decimal and drops a trailing ".0". */
function formatNumber(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  const normalized = Object.is(rounded, -0) ? 0 : rounded;
  return String(normalized);
}

/** Title-cases a snake_case / kebab-case / spaced region id: "warm_springs" -> "Warm Springs". */
function titleCase(id: string): string {
  const words = id.split(/[_\-\s]+/).filter((part) => part.length > 0);
  if (words.length === 0) return id;
  return words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1).toLowerCase()}`).join(" ");
}

/** Joins names in prose form: "A", "A and B", "A, B and C". */
function joinNames(names: readonly string[]): string {
  const filtered = names.filter((name) => name.length > 0);
  if (filtered.length === 0) return "";
  if (filtered.length === 1) return filtered[0];
  if (filtered.length === 2) return `${filtered[0]} and ${filtered[1]}`;
  return `${filtered.slice(0, -1).join(", ")} and ${filtered[filtered.length - 1]}`;
}

/** Trims a spoken message on a word boundary to at most 150 characters, appending "…" if cut. */
function clampQuote(message: string, maxLength = 150): string {
  const trimmed = message.trim();
  if (trimmed.length <= maxLength) return trimmed;
  const budget = maxLength - 1;
  const sliceTarget = trimmed.slice(0, budget);
  const lastSpace = sliceTarget.lastIndexOf(" ");
  const cut = lastSpace > 0 ? sliceTarget.slice(0, lastSpace) : sliceTarget;
  return `${cut.trimEnd()}…`;
}
