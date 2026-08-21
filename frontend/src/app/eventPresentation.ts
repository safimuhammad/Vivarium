import type {
  AgentSnapshot,
  EventEnvelopeEntry,
  HomeSnapshot,
  RegionSnapshot,
  WorldSnapshot,
} from "./schemas";
import { cleanVisibleText } from "../shared/visibleText";

export type EventPresentationLookup<T> =
  | ReadonlyMap<string, T>
  | Readonly<Record<string, T>>;

export interface EventPresentationContext {
  agentsById?: EventPresentationLookup<AgentSnapshot>;
  homesById?: EventPresentationLookup<HomeSnapshot>;
  ruinsById?: EventPresentationLookup<HomeSnapshot>;
  regionsByName?: EventPresentationLookup<RegionSnapshot>;
}

export function eventPresentationContextFromSnapshot(
  snapshot: WorldSnapshot | null | undefined,
): EventPresentationContext {
  return eventPresentationContextFromSnapshots(snapshot);
}

export function eventPresentationContextFromSnapshots(
  primary: WorldSnapshot | null | undefined,
  fallbacks: readonly WorldSnapshot[] = [],
): EventPresentationContext {
  const snapshots = primary ? [primary, ...fallbacks] : [...fallbacks];

  if (!snapshots.length) {
    return {};
  }

  const agentsById = new Map<string, AgentSnapshot>();
  const homesById = new Map<string, HomeSnapshot>();
  const ruinsById = new Map<string, HomeSnapshot>();
  const regionsByName = new Map<string, RegionSnapshot>();

  for (const snapshot of snapshots) {
    addMissingByKey(agentsById, arrayOrEmpty(snapshot.agents), (agent) => agent.id);
    addMissingByKey(homesById, arrayOrEmpty(snapshot.homes), (home) => home.home_id);
    addMissingByKey(ruinsById, arrayOrEmpty(snapshot.ruins), (home) => home.home_id);
    addMissingByKey(regionsByName, arrayOrEmpty(snapshot.regions), (region) => region.name);
  }

  return {
    agentsById,
    homesById,
    ruinsById,
    regionsByName,
  };
}

function arrayOrEmpty<T>(values: readonly T[] | undefined): readonly T[] {
  return Array.isArray(values) ? values : [];
}

function addMissingByKey<T>(
  target: Map<string, T>,
  values: readonly T[],
  keyFor: (value: T) => string,
): void {
  for (const value of values) {
    const key = keyFor(value);
    if (!target.has(key)) {
      target.set(key, value);
    }
  }
}

export type EventPresentationGroup =
  | "movement"
  | "speech"
  | "thought"
  | "resource"
  | "life"
  | "bond"
  | "home"
  | "contest"
  | "system";

export type EventPresentationTone =
  | "neutral"
  | "quiet"
  | "warm"
  | "bright"
  | "tense"
  | "grave"
  | "earth";

export interface RelatedEventIds {
  agentIds: string[];
  homeIds: string[];
  regionNames: string[];
}

export interface EventPresentation {
  label: string;
  title: string;
  detail: string;
  message: string;
  group: EventPresentationGroup;
  tone: EventPresentationTone;
  timestamp: number;
  timestampLabel: string;
  related: RelatedEventIds;
}

export interface EventBubbleDetailPresentation {
  kind: string;
  text: string;
}

export interface EventChainDetailPresentation {
  kind: string;
  text: string;
  count: number;
  startCursor: number;
  endCursor: number;
  window: string;
}

interface PresentationDraft {
  label: string;
  title?: string;
  detail?: string;
  group: EventPresentationGroup;
  tone?: EventPresentationTone;
}

const SOURCELESS_EVENT_SOURCES = new Set(["system", "world"]);

const AGENT_ID_KEYS = [
  "actor_id",
  "attacker_id",
  "sender_id",
  "giver_id",
  "builder_id",
  "breacher_id",
  "speaker_id",
  "initiator_id",
  "rejecter_id",
  "acceptor_id",
  "agent_id",
  "child_id",
  "target_id",
  "target",
  "receiver_id",
  "recipient_id",
  "revived_id",
  "victim_id",
  "killer_id",
  "killer",
  "owner_id",
  "previous_owner_id",
  "new_owner_id",
] as const;

const AGENT_ID_ARRAY_KEYS = [
  "parent_ids",
  "stakeholders",
  "previous_stakeholders",
  "new_stakeholders",
  "breachers",
  "recipients",
] as const;

const HOME_ID_KEYS = ["home_id", "target_home"] as const;
const REGION_KEYS = ["region", "from_region", "to_region"] as const;
const PARTICIPANT_REGION_RELEVANT_EVENT_TYPES = new Set([
  "mating_initiated",
  "mating_rejected",
  "mating_proposal_invalidated",
  "mating_proposal_timeout",
]);

export function presentEvent(
  entry: EventEnvelopeEntry,
  context: EventPresentationContext = {},
): EventPresentation {
  const draft = draftPresentation(entry, context);
  const title = capitalize(cleanVisibleText(draft.title ?? draft.label));
  const label = cleanVisibleText(draft.label);
  const detail = cleanVisibleText(
    draft.detail ?? fallbackDetail(entry, title, context),
  );

  return {
    label,
    title,
    detail,
    message: detail,
    group: draft.group,
    tone: draft.tone ?? toneForGroup(draft.group),
    timestamp: entry.event.timestamp,
    timestampLabel: formatTimestamp(entry.event.timestamp),
    related: collectRelatedIds(entry, context),
  };
}

export function presentEventBubbleDetail(
  entry: EventEnvelopeEntry,
  context: EventPresentationContext = {},
): EventBubbleDetailPresentation | undefined {
  const actor = eventActorId(entry);
  const target = eventTargetId(entry);
  const actorName = bubbleDisplayAgent(actor, context, "a being");
  const targetName = bubbleDisplayAgent(target, context, "another being");
  const regionName = bubbleDisplayRegion(eventRegionName(entry), context);

  switch (entry.event.type) {
    case "agent_left_region": {
      const from = payloadString(entry, "from_region") ?? eventRegionName(entry);
      const to = payloadString(entry, "to_region");
      return {
        kind: "movement-departure",
        text: to
          ? `toward ${bubbleDisplayRegion(to, context) ?? "another region"}`
          : `from ${bubbleDisplayRegion(from, context) ?? "nearby"}`,
      };
    }
    case "agent_entered_region": {
      const from = payloadString(entry, "from_region");
      const to = payloadString(entry, "to_region") ?? eventRegionName(entry);
      return {
        kind: "movement-arrival",
        text: from
          ? `from ${bubbleDisplayRegion(from, context) ?? "nearby"}`
          : `in ${bubbleDisplayRegion(to, context) ?? "the world"}`,
      };
    }
    case "speak":
      return {
        kind: target ? "direct-speech" : "open-speech",
        text: target
          ? `to ${targetName}`
          : regionName
            ? `heard in ${regionName}`
            : "heard nearby",
      };
    case "self_talk":
      return {
        kind: "private-thought",
        text: "private thought",
      };
    case "resource_changed":
      return {
        kind: "harvest",
        text: `${resourcePhrase(eventAmount(entry), eventResourceType(entry))} gathered`,
      };
    case "resource_transferred":
      return {
        kind: "shared-resource",
        text: `${resourcePhrase(eventAmount(entry), eventResourceType(entry))} to ${targetName}`,
      };
    case "mating_initiated":
      return {
        kind: "bond-call",
        text: `to ${targetName}`,
      };
    case "mating_rejected":
      {
        const rejecterName = bubbleDisplayAgent(
          payloadString(entry, "rejecter_id") ?? actor,
          context,
          "a being",
        );
        return {
          kind: "bond-refused",
          text: `${rejecterName} turns away`,
        };
      }
    case "mating_proposal_invalidated":
    case "mating_proposal_timeout":
      return {
        kind: "bond-faded",
        text: "bond thread fades",
      };
    case "agent_born": {
      const childName =
        payloadString(entry, "child_name") ??
        bubbleDisplayAgent(payloadString(entry, "child_id") ?? eventActorId(entry), context, "a child");
      const parentNames = uniqueStrings(
        payloadStringArray(entry, "parent_ids")?.map((id) =>
          bubbleDisplayAgent(id, context, "another being"),
        ) ?? [],
      ).slice(0, 2);
      return {
        kind: "birth",
        text: parentNames.length === 2
          ? `child of ${parentNames[0]} and ${parentNames[1]}`
          : `${cleanVisibleText(childName)} arrives`,
      };
    }
    case "agent_recovered":
      return {
        kind: "life-relit",
        text: `${targetName} relit`,
      };
    case "agent_paralyzed": {
      const affectedName = bubbleDisplayAgent(
        payloadString(entry, "agent_id", "victim_id") ?? target,
        context,
        "another being",
      );
      return {
        kind: "life-fallen",
        text: `${affectedName} falls`,
      };
    }
    case "agent_died": {
      const killer = payloadString(entry, "killer_id", "killer", "attacker_id");
      const attacker = killer ?? (actor && actor !== target ? actor : undefined);
      const victimName = bubbleDisplayAgent(
        payloadString(entry, "victim_id", "agent_id") ?? target,
        context,
        "another being",
      );
      return {
        kind: "death",
        text: attacker
          ? `felled by ${bubbleDisplayAgent(attacker, context, "a being")}`
          : `${victimName} goes dark`,
      };
    }
    case "agent_decayed": {
      const decayedName =
        payloadString(entry, "agent_name") ??
        bubbleDisplayAgent(payloadString(entry, "agent_id") ?? actor ?? target, context, "a being");
      return {
        kind: "decay",
        text: `${cleanVisibleText(decayedName)} returns`,
      };
    }
    case "home_built":
      return {
        kind: "home-raised",
        text: `${actorName} raises shelter`,
      };
    case "agent_started_hoarding":
      return {
        kind: "being-hoard",
        text: `${actorName} holds a great store`,
      };
    case "hearth_used":
      return {
        kind: "shelter-taken",
        text: `${actorName} takes shelter`,
      };
    case "home_joined":
      return {
        kind: "shelter-joined",
        text: `${actorName} joins the hearth`,
      };
    case "home_left":
      return {
        kind: "shelter-left",
        text: `${actorName} leaves the hearth`,
      };
    case "home_started_hoarding":
      return {
        kind: "vault-hoard",
        text: "vault grows heavy",
      };
    case "home_collapsed":
      return {
        kind: "home-crumbled",
        text: "hearth crumbles",
      };
    case "home_breached":
      return {
        kind: "raid-threshold",
        text: `${actorName} breaks the threshold`,
      };
    case "home_thieved":
      return {
        kind: "theft",
        text: `${resourceMapPhrase(payloadRecord(entry, "loot")) ?? resourcePhrase(eventAmount(entry), "materials")} taken`,
      };
    case "home_colonized":
      return {
        kind: "home-seized",
        text: `${actorName} claims the hearth`,
      };
    case "ruins_scavenged":
      return {
        kind: "ruin-scavenge",
        text: `${resourcePhrase(eventAmount(entry), eventResourceType(entry) ?? "materials")} gathered`,
      };
    case "attack":
      return {
        kind: "strike",
        text: `toward ${targetName}`,
      };
    case "simulation_started": {
      const count = payloadNumber(entry, "agent_count");
      return {
        kind: "world-wake",
        text: count === undefined
          ? "world awake"
          : `${formatNumber(count)} being${count === 1 ? "" : "s"} awake`,
      };
    }
    default:
      return undefined;
  }
}

export function presentEventChainDetail(
  representative: EventEnvelopeEntry,
  entries: readonly EventEnvelopeEntry[],
): EventChainDetailPresentation | undefined {
  const chainEntries = sortedUniqueEntries(entries);
  if (chainEntries.length <= 1) {
    return undefined;
  }

  const hiddenTypes = new Set(
    chainEntries
      .filter((entry) => entry.cursor !== representative.cursor)
      .map((entry) => entry.event.type),
  );
  const representativeType = representative.event.type;
  const startCursor = Math.min(...chainEntries.map((entry) => entry.cursor));
  const endCursor = Math.max(...chainEntries.map((entry) => entry.cursor));
  const base = {
    count: chainEntries.length,
    startCursor,
    endCursor,
    window: `${startCursor}-${endCursor}`,
  };

  if (
    hiddenTypes.has("home_breached") &&
    (representativeType === "home_thieved" || representativeType === "home_colonized")
  ) {
    return {
      ...base,
      kind: representativeType === "home_thieved" ? "breach-theft" : "breach-claim",
      text: "after breach",
    };
  }

  if (hiddenTypes.has("attack") && representativeType === "agent_died") {
    return { ...base, kind: "strike-death", text: "after strike" };
  }

  if (hiddenTypes.has("attack") && representativeType === "agent_paralyzed") {
    return { ...base, kind: "strike-fall", text: "after strike" };
  }

  if (hiddenTypes.has("agent_paralyzed") && representativeType === "agent_died") {
    return { ...base, kind: "fall-death", text: "after collapse" };
  }

  if (
    hiddenTypes.has("resource_transferred") &&
    representativeType === "agent_recovered"
  ) {
    return { ...base, kind: "gift-recovery", text: "after gift" };
  }

  if (representativeType === "agent_started_hoarding") {
    if (hiddenTypes.has("hearth_used")) {
      return { ...base, kind: "hearth-hoard", text: "after hearth" };
    }
    if (hiddenTypes.has("resource_transferred")) {
      return { ...base, kind: "shared-hoard", text: "after sharing" };
    }
    if (hiddenTypes.has("resource_changed")) {
      return { ...base, kind: "gathered-hoard", text: "after gathering" };
    }
  }

  if (
    hiddenTypes.has("agent_left_region") &&
    representativeType === "agent_entered_region"
  ) {
    return { ...base, kind: "crossing", text: "crossing complete" };
  }

  return { ...base, kind: "linked-beat", text: "linked beat" };
}

function draftPresentation(
  entry: EventEnvelopeEntry,
  context: EventPresentationContext,
): PresentationDraft {
  const { event } = entry;

  switch (event.type) {
    case "agent_left_region": {
      const actor = eventActorId(entry);
      const from = payloadString(entry, "from_region") ?? eventRegionName(entry);
      const to = payloadString(entry, "to_region");
      return {
        label: "departed",
        title: `${displayAgent(actor, context)} left ${displayRegion(from, context)}`,
        detail: `${displayAgent(actor, context)} left ${displayRegion(from, context)}${
          to ? ` for ${displayRegion(to, context)}` : ""
        }.`,
        group: "movement",
      };
    }
    case "agent_entered_region": {
      const actor = eventActorId(entry);
      const to = payloadString(entry, "to_region") ?? eventRegionName(entry);
      const from = payloadString(entry, "from_region");
      return {
        label: "arrived",
        title: `${displayAgent(actor, context)} arrived in ${displayRegion(to, context)}`,
        detail: `${displayAgent(actor, context)} arrived in ${displayRegion(to, context)}${
          from ? ` from ${displayRegion(from, context)}` : ""
        }.`,
        group: "movement",
      };
    }
    case "speak": {
      const speaker = payloadString(entry, "speaker_id") ?? eventActorId(entry);
      const target = eventTargetId(entry);
      const said = payloadString(entry, "message");
      return {
        label: "spoke",
        title: `${displayAgent(speaker, context)} spoke`,
        detail: said
          ? `${displayAgent(speaker, context)}${
              target ? ` to ${displayAgent(target, context)}` : ""
            }: ${quote(said)}`
          : undefined,
        group: "speech",
      };
    }
    case "self_talk": {
      const actor = payloadString(entry, "agent_id") ?? eventActorId(entry);
      const thought = payloadString(entry, "message");
      return {
        label: "private thought",
        title: `${displayAgent(actor, context)} kept a private thought`,
        detail: thought
          ? `${displayAgent(actor, context)} kept a thought: ${quote(thought)}`
          : undefined,
        group: "thought",
        tone: "quiet",
      };
    }
    case "resource_changed": {
      const actor = payloadString(entry, "agent_id") ?? eventActorId(entry);
      const amount = eventAmount(entry);
      const resource = eventResourceType(entry);
      const region = eventRegionName(entry);
      return {
        label: "gathered",
        title: `${displayAgent(actor, context)} gathered ${resourceName(resource)}`,
        detail: `${displayAgent(actor, context)} gathered ${resourcePhrase(
          amount,
          resource,
        )} in ${displayRegion(region, context)}.`,
        group: "resource",
        tone: "bright",
      };
    }
    case "resource_transferred": {
      const sender = payloadString(entry, "sender_id") ?? eventActorId(entry);
      const receiver =
        payloadString(entry, "receiver_id", "recipient_id") ?? eventTargetId(entry);
      const amount = eventAmount(entry);
      const resource = eventResourceType(entry);
      return {
        label: "shared",
        title: `${displayAgent(sender, context)} shared ${resourceName(resource)}`,
        detail: `${displayAgent(sender, context)} shared ${resourcePhrase(
          amount,
          resource,
        )} with ${displayAgent(receiver, context)}.`,
        group: "resource",
        tone: "warm",
      };
    }
    case "agent_recovered": {
      const giver = payloadString(entry, "giver_id", "sender_id") ?? eventActorId(entry);
      const revived =
        payloadString(entry, "revived_id", "recipient_id", "receiver_id") ??
        eventTargetId(entry);
      const amount = eventAmount(entry);
      const resource = eventResourceType(entry);
      return {
        label: "recovered",
        title: `${displayAgent(revived, context)} recovered`,
        detail: `${displayAgent(revived, context)} recovered after ${displayAgent(
          giver,
          context,
        )} shared ${resourcePhrase(amount, resource)}.`,
        group: "life",
        tone: "warm",
      };
    }
    case "agent_paralyzed": {
      const affected =
        eventTargetId(entry) ??
        payloadString(entry, "agent_id", "victim_id") ??
        eventActorId(entry);
      const actor = eventActorId(entry);
      const attacker =
        payloadString(entry, "attacker_id") ??
        (actor && actor !== affected ? actor : undefined);
      return {
        label: "collapsed",
        title: `${displayAgent(affected, context)} collapsed`,
        detail: attacker
          ? `${displayAgent(affected, context)} collapsed after a strike from ${displayAgent(
              attacker,
              context,
            )}.`
          : `${displayAgent(affected, context)} collapsed in ${displayRegion(
              eventRegionName(entry),
              context,
            )}.`,
        group: "life",
        tone: "grave",
      };
    }
    case "agent_died": {
      const victim =
        eventTargetId(entry) ??
        payloadString(entry, "victim_id") ??
        eventSourceId(entry) ??
        eventActorId(entry);
      const actor = eventActorId(entry);
      const killer =
        payloadString(entry, "killer_id", "killer") ??
        (actor && actor !== victim ? actor : undefined);
      return {
        label: "died",
        title: `${displayAgent(victim, context)} died`,
        detail: killer
          ? `${displayAgent(victim, context)} died after an attack by ${displayAgent(
              killer,
              context,
            )}.`
          : `${displayAgent(victim, context)} died in ${displayRegion(
              eventRegionName(entry),
              context,
            )}.`,
        group: "life",
        tone: "grave",
      };
    }
    case "agent_decayed": {
      const name = payloadString(entry, "agent_name") ?? displayAgent(eventActorId(entry), context);
      return {
        label: "returned to earth",
        title: `${name} returned to earth`,
        detail: `The remains of ${name} returned to earth in ${displayRegion(
          eventRegionName(entry),
          context,
        )}.`,
        group: "life",
        tone: "earth",
      };
    }
    case "agent_born": {
      const child = payloadString(entry, "child_id") ?? eventSourceId(entry) ?? eventActorId(entry);
      const childName = payloadString(entry, "child_name") ?? displayAgent(child, context);
      const parents =
        payloadStringArray(entry, "parent_ids") ??
        compact([
          payloadString(entry, "initiator_id"),
          payloadString(entry, "acceptor_id") ?? eventTargetId(entry),
        ]);
      const parentText = parents.length
        ? ` to ${joinList(parents.map((id) => displayAgent(id, context)))}`
        : "";
      return {
        label: "born",
        title: `${childName} was born`,
        detail: `${childName} was born in ${displayRegion(
          eventRegionName(entry),
          context,
        )}${parentText}.`,
        group: "life",
        tone: "bright",
      };
    }
    case "mating_initiated": {
      const initiator = payloadString(entry, "initiator_id") ?? eventActorId(entry);
      const target = payloadString(entry, "target_id") ?? eventTargetId(entry);
      const resources = resourceMapPhrase(payloadRecord(entry, "resources"));
      return {
        label: "bond offered",
        title: `${displayAgent(initiator, context)} offered a bond`,
        detail: `${displayAgent(initiator, context)} made an offer to ${displayAgent(
          target,
          context,
        )}${resources ? ` with ${resources}` : ""}.`,
        group: "bond",
        tone: "warm",
      };
    }
    case "mating_rejected": {
      const rejecter = payloadString(entry, "rejecter_id") ?? eventActorId(entry);
      const initiator = payloadString(entry, "initiator_id") ?? eventTargetId(entry);
      return {
        label: "bond declined",
        title: `${displayAgent(rejecter, context)} declined an offer`,
        detail: `${displayAgent(rejecter, context)} declined ${possessive(
          displayAgent(initiator, context),
        )} offer.`,
        group: "bond",
        tone: "quiet",
      };
    }
    case "mating_proposal_timeout": {
      const initiator = payloadString(entry, "initiator_id") ?? eventActorId(entry);
      const target = payloadString(entry, "target_id") ?? eventTargetId(entry);
      return {
        label: "offer lapsed",
        title: `${possessive(displayAgent(initiator, context))} offer lapsed`,
        detail: `${possessive(displayAgent(initiator, context))} offer to ${displayAgent(
          target,
          context,
        )} lapsed; committed stores returned.`,
        group: "bond",
        tone: "quiet",
      };
    }
    case "mating_proposal_invalidated": {
      const initiator = payloadString(entry, "initiator_id") ?? eventActorId(entry);
      const target = payloadString(entry, "target_id") ?? eventTargetId(entry);
      return {
        label: "offer fell through",
        title: `${possessive(displayAgent(initiator, context))} offer fell through`,
        detail: `${possessive(displayAgent(initiator, context))} offer to ${displayAgent(
          target,
          context,
        )} fell through; committed stores returned.`,
        group: "bond",
        tone: "quiet",
      };
    }
    case "agent_started_hoarding": {
      const actor = payloadString(entry, "agent_id") ?? eventActorId(entry);
      return {
        label: "great store",
        title: `${displayAgent(actor, context)} holds a great store`,
        detail: `${displayAgent(actor, context)} began holding a great store in ${displayRegion(
          eventRegionName(entry),
          context,
        )}.`,
        group: "resource",
      };
    }
    case "home_built": {
      const actor =
        payloadString(entry, "builder_id", "owner_id") ?? eventActorId(entry);
      const home = eventHomeId(entry);
      return {
        label: "home raised",
        title: `${displayHome(home, context)} was raised`,
        detail: `${displayAgent(actor, context)} raised ${displayHome(
          home,
          context,
        )} in ${displayRegion(eventRegionName(entry), context)}.`,
        group: "home",
        tone: "bright",
      };
    }
    case "hearth_used": {
      const actor = payloadString(entry, "agent_id") ?? eventActorId(entry);
      const home = eventHomeId(entry);
      const gained = payloadNumber(entry, "energy_gained");
      return {
        label: "hearth tended",
        title: `${displayAgent(actor, context)} warmed at the hearth`,
        detail: `${displayAgent(actor, context)} warmed at ${displayHome(
          home,
          context,
        )}${gained === undefined ? "" : ` and gained ${resourcePhrase(gained, "energy")}`}.`,
        group: "home",
        tone: "warm",
      };
    }
    case "home_joined": {
      const actor = payloadString(entry, "agent_id") ?? eventActorId(entry);
      const home = eventHomeId(entry);
      return {
        label: "home joined",
        title: `${displayAgent(actor, context)} joined ${displayHome(home, context)}`,
        detail: `${displayAgent(actor, context)} joined ${displayHome(
          home,
          context,
        )} in ${displayRegion(eventRegionName(entry), context)}.`,
        group: "home",
      };
    }
    case "home_left": {
      const actor = payloadString(entry, "agent_id") ?? eventActorId(entry);
      const home = eventHomeId(entry);
      return {
        label: "home left",
        title: `${displayAgent(actor, context)} left ${displayHome(home, context)}`,
        detail: `${displayAgent(actor, context)} left ${displayHome(home, context)}.`,
        group: "home",
        tone: "quiet",
      };
    }
    case "home_started_hoarding": {
      const home = eventHomeId(entry);
      const vault = payloadNumber(entry, "vault_materials");
      return {
        label: "vault swelled",
        title: `${displayHome(home, context)} holds a great store`,
        detail: `${displayHome(home, context)} became a great store in ${displayRegion(
          eventRegionName(entry),
          context,
        )}${vault === undefined ? "" : ` with ${resourcePhrase(vault, "materials")}`}.`,
        group: "home",
        tone: "bright",
      };
    }
    case "home_breached": {
      const actor = payloadString(entry, "breacher_id") ?? eventActorId(entry);
      const home = eventHomeId(entry);
      return {
        label: "home breached",
        title: `${displayHome(home, context)} was breached`,
        detail: `${displayAgent(actor, context)} broke into ${displayHome(
          home,
          context,
        )} in ${displayRegion(eventRegionName(entry), context)}.`,
        group: "contest",
        tone: "tense",
      };
    }
    case "home_thieved": {
      const actor = payloadString(entry, "breacher_id") ?? eventActorId(entry);
      const home = eventHomeId(entry);
      const loot = resourceMapPhrase(payloadRecord(entry, "loot"));
      const recipients = payloadStringArray(entry, "recipients") ?? [];
      const helpers = Math.max(0, recipients.length - 1);
      return {
        label: "vault stripped",
        title: `${displayHome(home, context)} was stripped`,
        detail: `${displayAgent(actor, context)}${
          helpers ? ` and ${helpers} other${helpers === 1 ? "" : "s"}` : ""
        } stripped ${loot ?? "stored materials"} from ${displayHome(home, context)}.`,
        group: "contest",
        tone: "tense",
      };
    }
    case "home_colonized": {
      const actor =
        payloadString(entry, "new_owner_id", "breacher_id") ?? eventActorId(entry);
      const home = eventHomeId(entry);
      const stakeholders = payloadStringArray(entry, "new_stakeholders") ?? [];
      return {
        label: "home seized",
        title: `${displayHome(home, context)} was seized`,
        detail: `${displayAgent(actor, context)} seized ${displayHome(
          home,
          context,
        )}${stakeholders.length ? ` with ${stakeholders.length} tender${stakeholders.length === 1 ? "" : "s"}` : ""}.`,
        group: "contest",
        tone: "tense",
      };
    }
    case "home_collapsed": {
      const home = eventHomeId(entry);
      return {
        label: "home crumbled",
        title: `${displayHome(home, context)} crumbled`,
        detail: `${displayHome(home, context)} crumbled into ruins in ${displayRegion(
          eventRegionName(entry),
          context,
        )}.`,
        group: "home",
        tone: "earth",
      };
    }
    case "ruins_scavenged": {
      const actor = payloadString(entry, "agent_id") ?? eventActorId(entry);
      const home = eventHomeId(entry);
      const amount = eventAmount(entry);
      return {
        label: "ruins picked",
        title: `${displayAgent(actor, context)} picked over ruins`,
        detail: `${displayAgent(actor, context)} picked ${resourcePhrase(
          amount,
          "materials",
        )} from ${displayHome(home, context)}.`,
        group: "contest",
        tone: "earth",
      };
    }
    case "attack": {
      const attacker = payloadString(entry, "attacker_id") ?? eventActorId(entry);
      const victim = payloadString(entry, "victim_id") ?? eventTargetId(entry);
      return {
        label: "strike",
        title: `${displayAgent(attacker, context)} struck ${displayAgent(victim, context)}`,
        detail: `${displayAgent(attacker, context)} struck ${displayAgent(
          victim,
          context,
        )} in ${displayRegion(eventRegionName(entry), context)}.`,
        group: "contest",
        tone: "tense",
      };
    }
    case "simulation_started": {
      const count = payloadNumber(entry, "agent_count");
      return {
        label: "world wakes",
        title: "World wakes",
        detail: count === undefined
          ? "The world woke."
          : `The world woke with ${formatNumber(count)} being${count === 1 ? "" : "s"}.`,
        group: "system",
        tone: "bright",
      };
    }
    default:
      return {
        label: humanizeEventType(event.type),
        title: capitalize(humanizeEventType(event.type)),
        group: "system",
      };
  }
}

function fallbackDetail(
  entry: EventEnvelopeEntry,
  title: string,
  context: EventPresentationContext,
): string {
  const message = payloadString(entry, "message");
  if (message) {
    return message;
  }
  const region = eventRegionName(entry);
  return region ? `${title} in ${displayRegion(region, context)}.` : `${title}.`;
}

function collectRelatedIds(
  entry: EventEnvelopeEntry,
  context: EventPresentationContext,
): RelatedEventIds {
  const agentIds = new Set<string>();
  const homeIds = new Set<string>();
  const regionNames = new Set<string>();

  addAgentId(agentIds, resolvedString(entry, "actor_id"));
  addAgentId(agentIds, resolvedString(entry, "target_id"));
  addAgentId(agentIds, eventSourceId(entry));
  addAgentId(agentIds, entry.event.target ?? undefined);
  for (const key of AGENT_ID_KEYS) {
    addAgentId(agentIds, payloadString(entry, key));
  }
  for (const key of AGENT_ID_ARRAY_KEYS) {
    for (const id of payloadStringArray(entry, key) ?? []) {
      addAgentId(agentIds, id);
    }
  }

  addString(homeIds, resolvedString(entry, "home_id"));
  for (const key of HOME_ID_KEYS) {
    addString(homeIds, payloadString(entry, key));
  }

  addString(regionNames, resolvedString(entry, "region"));
  addString(regionNames, entry.event.region ?? undefined);
  for (const key of REGION_KEYS) {
    addString(regionNames, payloadString(entry, key));
  }
  addParticipantRegionNames(regionNames, agentIds, entry, context);

  return {
    agentIds: [...agentIds],
    homeIds: [...homeIds],
    regionNames: [...regionNames],
  };
}

function addParticipantRegionNames(
  regionNames: Set<string>,
  agentIds: ReadonlySet<string>,
  entry: EventEnvelopeEntry,
  context: EventPresentationContext,
): void {
  if (!PARTICIPANT_REGION_RELEVANT_EVENT_TYPES.has(entry.event.type)) {
    return;
  }
  for (const agentId of agentIds) {
    const position = lookupValue(context.agentsById, agentId)?.position;
    addString(regionNames, position);
  }
}

function addAgentId(target: Set<string>, value: string | undefined): void {
  if (!value || SOURCELESS_EVENT_SOURCES.has(value) || value.startsWith("home_")) {
    return;
  }
  target.add(value);
}

function addString(target: Set<string>, value: string | undefined): void {
  if (value) {
    target.add(value);
  }
}

function eventActorId(entry: EventEnvelopeEntry): string | undefined {
  return (
    resolvedString(entry, "actor_id") ??
    payloadString(
      entry,
      "actor_id",
      "attacker_id",
      "sender_id",
      "giver_id",
      "builder_id",
      "breacher_id",
      "speaker_id",
      "initiator_id",
      "rejecter_id",
      "acceptor_id",
      "agent_id",
      "killer_id",
    ) ??
    eventSourceId(entry)
  );
}

function eventTargetId(entry: EventEnvelopeEntry): string | undefined {
  return (
    resolvedString(entry, "target_id") ??
    entry.event.target ??
    payloadString(
      entry,
      "target_id",
      "target",
      "receiver_id",
      "recipient_id",
      "revived_id",
      "victim_id",
      "acceptor_id",
    )
  );
}

function eventSourceId(entry: EventEnvelopeEntry): string | undefined {
  const { source } = entry.event;
  return source && !SOURCELESS_EVENT_SOURCES.has(source) ? source : undefined;
}

function eventHomeId(entry: EventEnvelopeEntry): string | undefined {
  return resolvedString(entry, "home_id") ?? payloadString(entry, "home_id", "target_home");
}

function eventRegionName(entry: EventEnvelopeEntry): string | undefined {
  return (
    resolvedString(entry, "region") ??
    entry.event.region ??
    payloadString(entry, "region")
  );
}

function eventResourceType(entry: EventEnvelopeEntry): string | undefined {
  return resolvedString(entry, "resource_type") ?? payloadString(entry, "resource_type");
}

function eventAmount(entry: EventEnvelopeEntry): number | undefined {
  return resolvedNumber(entry, "amount") ?? payloadNumber(entry, "amount");
}

function resolvedString(entry: EventEnvelopeEntry, key: string): string | undefined {
  const value = entry.resolved[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function resolvedNumber(entry: EventEnvelopeEntry, key: string): number | undefined {
  const value = entry.resolved[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function payloadString(entry: EventEnvelopeEntry, ...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = entry.event.payload[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function payloadNumber(entry: EventEnvelopeEntry, key: string): number | undefined {
  const value = entry.event.payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function payloadStringArray(
  entry: EventEnvelopeEntry,
  key: string,
): string[] | undefined {
  const value = entry.event.payload[key];
  if (!Array.isArray(value)) {
    return undefined;
  }
  const strings = value.filter(
    (item): item is string => typeof item === "string" && item.length > 0,
  );
  return strings.length ? strings : undefined;
}

function payloadRecord(
  entry: EventEnvelopeEntry,
  key: string,
): Record<string, unknown> | undefined {
  const value = entry.event.payload[key];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function sortedUniqueEntries(entries: readonly EventEnvelopeEntry[]): EventEnvelopeEntry[] {
  const byCursor = new Map<number, EventEnvelopeEntry>();
  for (const entry of entries) {
    if (!byCursor.has(entry.cursor)) {
      byCursor.set(entry.cursor, entry);
    }
  }
  return [...byCursor.values()].sort((left, right) => left.cursor - right.cursor);
}

function displayAgent(
  id: string | undefined,
  context: EventPresentationContext,
): string {
  if (!id) {
    return "someone";
  }
  return cleanVisibleText(
    lookupValue(context.agentsById, id)?.name ?? humanizeIdentifier(id),
  );
}

function displayHome(
  id: string | undefined,
  context: EventPresentationContext,
): string {
  if (!id) {
    return "a home";
  }
  const home = lookupValue(context.homesById, id) ?? lookupValue(context.ruinsById, id);
  return cleanVisibleText(humanizeIdentifier(home?.home_id ?? id));
}

function displayRegion(
  name: string | undefined,
  context: EventPresentationContext,
): string {
  if (!name) {
    return "the world";
  }
  return cleanVisibleText(
    humanizeIdentifier(lookupValue(context.regionsByName, name)?.name ?? name),
  );
}

function bubbleDisplayAgent(
  id: string | undefined,
  context: EventPresentationContext,
  fallback: string,
): string {
  if (!id) {
    return fallback;
  }
  return cleanVisibleText(lookupValue(context.agentsById, id)?.name ?? fallback);
}

function bubbleDisplayRegion(
  name: string | undefined,
  context: EventPresentationContext,
): string | undefined {
  return name ? displayRegion(name, context) : undefined;
}

function lookupValue<T>(
  lookup: EventPresentationLookup<T> | undefined,
  key: string,
): T | undefined {
  if (!lookup) {
    return undefined;
  }
  const maybeMap = lookup as ReadonlyMap<string, T>;
  if (typeof maybeMap.get === "function") {
    return maybeMap.get(key);
  }
  return (lookup as Readonly<Record<string, T | undefined>>)[key];
}

function resourcePhrase(amount: number | undefined, resourceType: string | undefined): string {
  const resource = resourceName(resourceType);
  return amount === undefined ? resource : `${formatNumber(amount)} ${resource}`;
}

function resourceName(resourceType: string | undefined): string {
  if (!resourceType) {
    return "resources";
  }
  if (resourceType === "energy") {
    return "energy";
  }
  if (resourceType === "materials") {
    return "materials";
  }
  return cleanVisibleText(humanizeIdentifier(resourceType));
}

function resourceMapPhrase(record: Record<string, unknown> | undefined): string | undefined {
  if (!record) {
    return undefined;
  }
  const parts = Object.entries(record)
    .filter((entry): entry is [string, number] => (
      typeof entry[1] === "number" && Number.isFinite(entry[1])
    ))
    .map(([resourceType, amount]) => resourcePhrase(amount, resourceType));
  return parts.length ? joinList(parts) : undefined;
}

function joinList(items: string[]): string {
  if (items.length <= 1) {
    return items[0] ?? "";
  }
  if (items.length === 2) {
    return `${items[0]} and ${items[1]}`;
  }
  return `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
}

function compact(values: Array<string | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value));
}

function uniqueStrings(values: Iterable<string | undefined>): string[] {
  const seen = new Set<string>();
  for (const value of values) {
    if (value) {
      seen.add(value);
    }
  }
  return [...seen];
}

function possessive(value: string): string {
  return value.endsWith("s") ? `${value}'` : `${value}'s`;
}

function quote(value: string): string {
  return `"${value}"`;
}

function toneForGroup(group: EventPresentationGroup): EventPresentationTone {
  switch (group) {
    case "thought":
      return "quiet";
    case "resource":
    case "life":
    case "bond":
    case "home":
      return "warm";
    case "contest":
      return "tense";
    default:
      return "neutral";
  }
}

function humanizeEventType(type: string): string {
  return cleanVisibleText(type.replaceAll("_", " "));
}

function humanizeIdentifier(value: string): string {
  return value.replaceAll("_", " ");
}

function capitalize(value: string): string {
  return value ? `${value[0].toUpperCase()}${value.slice(1)}` : value;
}

function formatTimestamp(value: number): string {
  return Number.isFinite(value) ? value.toFixed(1) : "";
}

function formatNumber(value: number): string {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}
