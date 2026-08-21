import { EVENT_VISUAL_EVENT_TYPES } from "../../events/eventVisualCatalog";
import type {
  PresentedEventType,
  TypedPresentedEvent,
} from "../eventPayloads";
import { parsePresentedEvent } from "../eventPayloads";
import type { PresentedObserverFrame } from "../contracts";
import type { PlacementLedgerSnapshot } from "../../renderer2d/production/placement/PlacementLedger";
import type { RegionMapRecipeV1 } from "../../renderer2d/production/maps/RegionMapRecipe";
import type { NavigationGrid } from "../../renderer2d/production/navigation/navigation";
import type { StoryMoment } from "../BeatDirector";
import type { StoryProgramResolver } from "../StoryDirector";
import type {
  AnyChoreographyDefinition,
  ChoreographyDefinition,
  ChoreographyPlan,
  ChoreographyRegistry,
  ParticipantRole,
} from "./contracts";
import { BOND_COMBAT_DEFINITIONS } from "./bondCombat";
import { HOME_CONTEST_SYSTEM_CHOREOGRAPHIES } from "./homeContestSystem";
import { LIFECYCLE_MOVEMENT_COMMUNICATION_RESOURCE_DEFINITIONS } from "./lifecycleMovementCommunicationResource";

export const CHOREOGRAPHY_FAMILY_EVENT_TYPES = Object.freeze({
  lifecycle: Object.freeze([
    "agent_born",
    "agent_died",
    "agent_decayed",
    "agent_paralyzed",
    "agent_recovered",
  ] as const),
  movement: Object.freeze([
    "agent_left_region",
    "agent_entered_region",
  ] as const),
  communication: Object.freeze(["speak", "self_talk"] as const),
  resource: Object.freeze([
    "resource_changed",
    "resource_transferred",
    "agent_started_hoarding",
  ] as const),
  bond: Object.freeze([
    "mating_initiated",
    "mating_rejected",
    "mating_proposal_invalidated",
    "mating_proposal_timeout",
  ] as const),
  combat: Object.freeze(["attack"] as const),
  home: Object.freeze([
    "home_built",
    "hearth_used",
    "home_joined",
    "home_left",
    "home_started_hoarding",
    "home_collapsed",
  ] as const),
  contest: Object.freeze([
    "home_breached",
    "home_thieved",
    "home_colonized",
    "ruins_scavenged",
  ] as const),
  system: Object.freeze(["simulation_started"] as const),
});

export type ChoreographyFamily = keyof typeof CHOREOGRAPHY_FAMILY_EVENT_TYPES;

type RegistryInput =
  | AnyChoreographyDefinition
  | readonly [PresentedEventType, AnyChoreographyDefinition];

const CANONICAL_TYPES = new Set<string>(EVENT_VISUAL_EVENT_TYPES);

/**
 * Build a detached immutable registry from independently implemented definitions.
 *
 * A tuple form may name the intended registry key explicitly. It exists for family
 * aggregation and rejects accidental key/definition mismatches before publication.
 */
export function createChoreographyRegistry(
  inputs: readonly RegistryInput[],
): ChoreographyRegistry {
  const registry: Partial<Record<PresentedEventType, AnyChoreographyDefinition>> = {};
  for (const input of inputs) {
    const key = isRegistryTuple(input) ? input[0] : input.eventType;
    const definition = isRegistryTuple(input) ? input[1] : input;
    if (key !== definition.eventType) {
      throw new Error(
        `choreography key ${key} does not match definition event type ${definition.eventType}`,
      );
    }
    if (registry[key] !== undefined) {
      throw new Error(`duplicate choreography definition for ${key}`);
    }
    registry[key] = ownDefinition(definition);
  }
  return Object.freeze(registry) as ChoreographyRegistry;
}

function isRegistryTuple(
  input: RegistryInput,
): input is readonly [PresentedEventType, AnyChoreographyDefinition] {
  return Array.isArray(input);
}

/** Throw unless a registry contains exactly one real definition for all 28 events. */
export function assertCompleteChoreographyRegistry(
  registry: ChoreographyRegistry,
): asserts registry is Readonly<{
  readonly [K in PresentedEventType]: ChoreographyDefinition<K>;
}> {
  const keys = Object.keys(registry);
  const missing = EVENT_VISUAL_EVENT_TYPES.filter((type) => registry[type] === undefined);
  const unknown = keys.filter((type) => !CANONICAL_TYPES.has(type));
  if (missing.length > 0 || unknown.length > 0 || keys.length !== EVENT_VISUAL_EVENT_TYPES.length) {
    throw new Error(
      `choreography registry must contain exactly the canonical 28 event types; missing=${missing.join(",") || "none"}; unknown=${unknown.join(",") || "none"}`,
    );
  }
}

/** Return only an exact event definition; absence never falls through to a generic scene. */
export function getChoreographyDefinition<T extends PresentedEventType>(
  eventType: T,
  registry: ChoreographyRegistry = CHOREOGRAPHY_REGISTRY,
): ChoreographyDefinition<T> | undefined {
  return registry[eventType] as ChoreographyDefinition<T> | undefined;
}

export interface ChoreographyProgramResolverOptions {
  readonly getFrame: () => PresentedObserverFrame;
  readonly getPlacement: () => PlacementLedgerSnapshot;
  readonly getRecipes: () => ReadonlyMap<string, RegionMapRecipeV1>;
  readonly reducedMotion: () => boolean;
  readonly compactResourceRouting?: () => boolean;
  /** See {@link ChoreographyContext.getNavigationGrid}; forwarded through unchanged. */
  readonly getNavigationGrid?: (regionId: string) => NavigationGrid | null;
  readonly registry?: ChoreographyRegistry;
}

/** Story resolver retaining the exact typed choreography plan it produces. */
export interface ChoreographyProgramResolver extends StoryProgramResolver {
  resolve(moment: StoryMoment): ChoreographyPlan;
}

/** Resolve one exact registry plan from current immutable presentation/spatial truth. */
export function createChoreographyProgramResolver(
  options: ChoreographyProgramResolverOptions,
): ChoreographyProgramResolver {
  const registry = options.registry ?? CHOREOGRAPHY_REGISTRY;
  assertCompleteChoreographyRegistry(registry);
  return Object.freeze({
    resolve(moment: StoryMoment) {
      const parsed = parsePresentedEvent(moment.representative);
      if (!parsed.known) {
        throw new Error(`story moment ${moment.id} has no registered typed event`);
      }
      const definition = getChoreographyDefinition(parsed.evidence.type, registry);
      if (definition === undefined) {
        throw new Error(`missing choreography definition for ${parsed.evidence.type}`);
      }
      const plan = definition.resolve({
        moment,
        event: parsed.evidence,
        frame: options.getFrame(),
        placement: options.getPlacement(),
        recipes: options.getRecipes(),
        reducedMotion: options.reducedMotion(),
        compactResourceRouting: options.compactResourceRouting?.() ?? false,
        ...(options.getNavigationGrid === undefined
          ? {}
          : { getNavigationGrid: options.getNavigationGrid }),
      } as never);
      if (plan.momentId !== moment.id || plan.eventType !== parsed.evidence.type) {
        throw new Error("choreography resolver returned a plan for different evidence");
      }
      return plan;
    },
  });
}

/**
 * Resolve one semantic participant role from typed payload truth.
 *
 * This deliberately ignores `entry.resolved` because fixture and live hint resolution
 * differ for death, attack paralysis, and mating rejection. The returned list is
 * detached, unique, and immutable; an empty list means the role is absent and callers
 * must apply the definition's explicit no-invention policy.
 */
export function resolveParticipantIds(
  evidence: TypedPresentedEvent,
  role: ParticipantRole,
): readonly string[] {
  const payload = evidence.payload as unknown as ParticipantPayload;
  let roles: Partial<Record<ParticipantRole, string | readonly string[] | null>>;
  switch (evidence.type) {
    case "agent_born":
      roles = {
        actor: payload.child_id,
        child: payload.child_id,
        initiator: payload.initiator_id,
        acceptor: payload.acceptor_id,
        target: payload.acceptor_id,
      };
      break;
    case "agent_died":
      roles = {
        actor: payload.killer_id,
        killer: payload.killer_id,
        victim: payload.victim_id,
        target: payload.victim_id,
      };
      break;
    case "agent_decayed":
      roles = { actor: payload.agent_id, victim: payload.agent_id };
      break;
    case "agent_paralyzed":
      roles = payload.trigger === "attack"
        ? {
            actor: payload.attacker_id,
            killer: payload.attacker_id,
            victim: payload.agent_id,
            target: payload.agent_id,
          }
        : {
            actor: payload.agent_id,
            victim: payload.agent_id,
            target: payload.agent_id,
          };
      break;
    case "agent_recovered":
      roles = {
        actor: payload.giver_id,
        giver: payload.giver_id,
        recipient: payload.recipient_id,
        target: payload.revived_id,
      };
      break;
    case "agent_left_region":
    case "agent_entered_region":
      roles = { actor: payload.agent_id };
      break;
    case "speak":
      roles = { actor: payload.speaker_id, target: payload.target_id };
      break;
    case "self_talk":
    case "resource_changed":
    case "agent_started_hoarding":
      roles = { actor: payload.agent_id };
      break;
    case "resource_transferred":
      roles = {
        actor: payload.sender_id,
        giver: payload.sender_id,
        recipient: payload.receiver_id,
        target: payload.receiver_id,
      };
      break;
    case "mating_initiated":
      roles = {
        actor: payload.initiator_id,
        initiator: payload.initiator_id,
        target: payload.target_id,
      };
      break;
    case "mating_rejected":
      roles = {
        actor: payload.rejecter_id,
        initiator: payload.initiator_id,
        target: payload.initiator_id,
      };
      break;
    case "mating_proposal_invalidated":
    case "mating_proposal_timeout":
      roles = {
        actor: payload.initiator_id,
        initiator: payload.initiator_id,
        target: payload.target_id,
      };
      break;
    case "attack":
      roles = {
        actor: payload.attacker_id,
        killer: payload.attacker_id,
        victim: payload.victim_id,
        target: payload.victim_id,
      };
      break;
    case "home_built":
      roles = {
        actor: payload.builder_id,
        owner: payload.owner_id,
        stakeholder: payload.stakeholders,
      };
      break;
    case "hearth_used":
    case "home_started_hoarding":
      roles = { actor: payload.agent_id };
      break;
    case "home_joined":
      roles = {
        actor: payload.agent_id,
        owner: payload.owner_id,
        stakeholder: payload.stakeholders,
      };
      break;
    case "home_left":
      roles = {
        actor: payload.agent_id,
        owner: payload.owner_id,
        stakeholder: payload.stakeholders,
      };
      break;
    case "home_collapsed":
      roles = {
        actor: payload.owner_id,
        owner: payload.owner_id,
        stakeholder: payload.stakeholders,
      };
      break;
    case "home_breached":
      roles = {
        actor: payload.breacher_id,
        breacher: payload.breachers,
      };
      break;
    case "home_thieved":
      roles = {
        actor: payload.breacher_id,
        breacher: payload.breacher_id,
        recipient: payload.recipients,
      };
      break;
    case "home_colonized":
      roles = {
        actor: payload.breacher_id,
        breacher: payload.breacher_id,
        owner: payload.new_owner_id,
        stakeholder: payload.new_stakeholders,
      };
      break;
    case "ruins_scavenged":
      roles = { actor: payload.agent_id };
      break;
    case "simulation_started":
      roles = {};
      break;
  }
  const value = roles[role];
  const values = value === null || value === undefined
    ? []
    : typeof value === "string"
      ? [value]
      : [...value];
  return Object.freeze([...new Set(values.filter((id) => id.trim().length > 0))]);
}

function ownDefinition(
  definition: AnyChoreographyDefinition,
): AnyChoreographyDefinition {
  validateDefinition(definition);
  return Object.freeze({
    ...definition,
    participants: Object.freeze([...definition.participants]),
    requiredAnchors: Object.freeze([...definition.requiredAnchors]),
    safeCancelMarkers: Object.freeze([...definition.safeCancelMarkers]),
    duration: Object.freeze({ ...definition.duration }),
    missingParticipant: Object.freeze({ ...definition.missingParticipant }),
  }) as AnyChoreographyDefinition;
}

interface ParticipantPayload {
  readonly child_id?: string;
  readonly initiator_id?: string;
  readonly acceptor_id?: string;
  readonly killer_id?: string;
  readonly victim_id?: string;
  readonly agent_id?: string;
  readonly attacker_id?: string;
  readonly trigger?: "breath" | "attack";
  readonly giver_id?: string;
  readonly recipient_id?: string;
  readonly revived_id?: string;
  readonly speaker_id?: string;
  readonly target_id?: string | null;
  readonly sender_id?: string;
  readonly receiver_id?: string;
  readonly rejecter_id?: string;
  readonly builder_id?: string;
  readonly owner_id?: string;
  readonly stakeholders?: readonly string[];
  readonly breacher_id?: string;
  readonly breachers?: readonly string[];
  readonly recipients?: readonly string[];
  readonly new_owner_id?: string;
  readonly new_stakeholders?: readonly string[];
}

function validateDefinition(definition: AnyChoreographyDefinition): void {
  if (!CANONICAL_TYPES.has(definition.eventType)) {
    throw new Error(`unknown choreography event type ${definition.eventType}`);
  }
  requireUniqueNonEmpty(definition.participants, "participant roles");
  requireUniqueNonEmpty(definition.requiredAnchors, "required anchors");
  requireNonBlank(definition.contactMarker, "contact marker");
  requireNonBlank(definition.consequenceMarker, "consequence marker");
  if (definition.contactMarker === definition.consequenceMarker) {
    throw new Error("contact and consequence markers must be distinct");
  }
  requireUniqueNonEmpty(definition.safeCancelMarkers, "safe cancel markers");
  if (definition.safeCancelMarkers.includes(definition.consequenceMarker)) {
    throw new Error("safe cancel marker must be distinct from the consequence marker");
  }
  const { minMs, maxMs } = definition.duration;
  if (!Number.isFinite(minMs) || !Number.isFinite(maxMs) || minMs <= 0 || maxMs < minMs) {
    throw new RangeError("choreography duration must have finite positive ordered bounds");
  }
  if (
    definition.missingParticipant.required !== "nearest-staging-fade-reposition"
    || definition.missingParticipant.optional !== "omit-flourish"
  ) {
    throw new Error("choreography definition must declare the frozen no-invention fallback");
  }
  requireNonBlank(definition.missingParticipant.diagnostic, "missing participant diagnostic");
  if (typeof definition.resolve !== "function") {
    throw new Error("choreography definition must declare a resolver");
  }
}

function requireUniqueNonEmpty(
  values: readonly string[],
  label: string,
): void {
  if (values.length === 0) throw new Error(`${label} must not be empty`);
  for (const value of values) requireNonBlank(value, label);
  if (new Set(values).size !== values.length) throw new Error(`${label} must be unique`);
}

function requireNonBlank(value: string, label: string): void {
  if (value.trim().length === 0) throw new Error(`${label} must not be blank`);
}

export const CHOREOGRAPHY_REGISTERED_EVENT_TYPES = [
  "agent_born",
  "agent_died",
  "agent_decayed",
  "agent_paralyzed",
  "agent_recovered",
  "agent_left_region",
  "agent_entered_region",
  "speak",
  "self_talk",
  "resource_changed",
  "resource_transferred",
  "agent_started_hoarding",
  "mating_initiated",
  "mating_rejected",
  "mating_proposal_invalidated",
  "mating_proposal_timeout",
  "attack",
  "home_built",
  "hearth_used",
  "home_joined",
  "home_left",
  "home_started_hoarding",
  "home_collapsed",
  "home_breached",
  "home_thieved",
  "home_colonized",
  "ruins_scavenged",
  "simulation_started",
] as const satisfies readonly PresentedEventType[];

export const CHOREOGRAPHY_REGISTRY_DEFINITIONS = Object.freeze([
  ...LIFECYCLE_MOVEMENT_COMMUNICATION_RESOURCE_DEFINITIONS,
  ...BOND_COMBAT_DEFINITIONS,
  ...HOME_CONTEST_SYSTEM_CHOREOGRAPHIES,
]) satisfies readonly RegistryInput[];
export const CHOREOGRAPHY_REGISTRY = createChoreographyRegistry(
  CHOREOGRAPHY_REGISTRY_DEFINITIONS,
);

assertCompleteChoreographyRegistry(CHOREOGRAPHY_REGISTRY);
