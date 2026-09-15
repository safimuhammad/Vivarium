import {
  parseAgentSpatialSnapshot,
  parseHomeSpatialSnapshot,
  type AgentSpatialSnapshot,
  type EventEnvelopeEntry,
  type HomeSpatialSnapshot,
  type SpatialPoint,
} from "../app/schemas";
import { EVENT_VISUAL_EVENT_TYPES } from "../events/eventVisualCatalog";

export type PresentedEventType = (typeof EVENT_VISUAL_EVENT_TYPES)[number];

/**
 * Navigation is world authority, not choreography.  These events deliberately
 * live beside (rather than inside) the visual-event vocabulary: accepting one
 * changes a projected being's published feet, but it never schedules a made-up
 * presentation scene.
 */
export const SPATIAL_TRAVEL_EVENT_TYPES = Object.freeze([
  "spatial_travel_started",
  "spatial_travel_cancelled",
  "spatial_travel_arrived",
] as const);

export type SpatialTravelEventType = (typeof SPATIAL_TRAVEL_EVENT_TYPES)[number];

interface MessagePayload { readonly message: string }
interface EnergyMaterialsResources { readonly energy: number; readonly materials: number }
interface MaterialsLoot { readonly materials: number }
interface AgentBornPayload extends MessagePayload { readonly child_id: string; readonly child_name: string; readonly parent_ids: readonly string[]; readonly initiator_id: string; readonly acceptor_id: string; readonly region: string; readonly committed_resources: EnergyMaterialsResources; readonly child_resources: EnergyMaterialsResources; readonly offspring_multiplier: number; readonly spatial?: AgentSpatialSnapshot | null }
interface AgentDiedPayload extends MessagePayload { readonly victim_id: string; readonly victim_name: string; readonly killer_id: string; readonly killer: string; readonly region: string; readonly attack_damage: number; readonly attack_energy_cost: number; readonly victim_was_paralyzed: boolean; readonly looted_energy: number; readonly looted_materials: number }
interface AgentDecayedPayload extends MessagePayload { readonly agent_id: string; readonly agent_name: string; readonly region: string; readonly died_at: number; readonly decayed_at: number }
interface AgentParalyzedBreathPayload extends MessagePayload { readonly agent_id: string; readonly region: string; readonly trigger: "breath"; readonly energy: number }
interface AgentParalyzedAttackPayload extends MessagePayload { readonly agent_id: string; readonly region: string; readonly trigger: "attack"; readonly energy: number; readonly victim_id: string; readonly attacker_id: string }
interface AgentRecoveredPayload extends MessagePayload { readonly giver_id: string; readonly recipient_id: string; readonly revived_id: string; readonly region: string; readonly resource_type: "energy"; readonly amount: number; readonly giver_energy: number; readonly revived_energy: number }
interface MovementPayload extends MessagePayload { readonly agent_id: string; readonly from_region: string; readonly to_region: string; readonly move_energy_cost: number; readonly agent_energy: number; readonly spatial?: AgentSpatialSnapshot | null; readonly authoritative_spatial?: true; readonly source_position?: SpatialPoint }
interface SpeakPayload extends MessagePayload { readonly speaker_id: string; readonly target_id: string | null; readonly region: string; readonly speak_energy_cost: number }
interface SelfTalkPayload extends MessagePayload { readonly agent_id: string }
interface ResourceChangedPayload extends MessagePayload { readonly agent_id: string; readonly region: string; readonly resource_type: "energy" | "materials"; readonly amount: number; readonly agent_energy: number; readonly agent_materials: number; readonly region_energy: number; readonly region_materials: number }
interface ResourceTransferredPayload extends MessagePayload { readonly sender_id: string; readonly receiver_id: string; readonly region: string; readonly resource_type: "energy" | "materials"; readonly amount: number; readonly sender_energy: number; readonly sender_materials: number; readonly receiver_energy: number; readonly receiver_materials: number }
interface AgentStartedHoardingPayload extends MessagePayload { readonly agent_id: string; readonly region: string; readonly energy: number; readonly materials: number }
interface MatingInitiatedPayload extends MessagePayload { readonly initiator_id: string; readonly target_id: string; readonly resources: EnergyMaterialsResources; readonly proposal_timestamp: number; readonly initiator_energy: number; readonly initiator_materials: number }
interface MatingRejectedPayload extends MessagePayload { readonly rejecter_id: string; readonly initiator_id: string; readonly target_id: string; readonly resources_refunded: EnergyMaterialsResources }
interface MatingProposalInvalidatedPayload extends MessagePayload { readonly initiator_id: string; readonly target_id: string; readonly reason: "initiator_ineligible"; readonly resources_refunded: EnergyMaterialsResources }
interface MatingProposalTimeoutPayload extends MessagePayload { readonly initiator_id: string; readonly target_id: string; readonly reason: "timeout"; readonly resources_refunded: EnergyMaterialsResources }
interface AttackPayload extends MessagePayload { readonly attacker_id: string; readonly victim_id: string; readonly region: string; readonly damage: number; readonly attack_energy_cost: number; readonly attacker_energy: number; readonly victim_energy: number }
interface HomeBuiltPayload extends MessagePayload { readonly home_id: string; readonly target_home: string; readonly builder_id: string; readonly owner_id: string; readonly region: string; readonly materials_cost: number; readonly integrity: number; readonly stakeholders: readonly string[]; readonly home_spatial?: HomeSpatialSnapshot | null }
interface HearthUsedPayload extends MessagePayload { readonly agent_id: string; readonly home_id: string; readonly target_home: string; readonly region: string; readonly materials_burned: number; readonly energy_gained: number; readonly agent_energy: number; readonly agent_materials: number }
interface HomeJoinedPayload extends MessagePayload { readonly agent_id: string; readonly home_id: string; readonly target_home: string; readonly owner_id: string; readonly region: string; readonly stakeholders: readonly string[]; readonly integrity: number; readonly max_integrity: number }
interface HomeLeftPayload extends MessagePayload { readonly agent_id: string; readonly home_id: string; readonly target_home: string; readonly previous_owner_id: string; readonly owner_id: string; readonly region: string; readonly previous_stakeholders: readonly string[]; readonly stakeholders: readonly string[]; readonly integrity: number; readonly max_integrity: number }
interface HomeStartedHoardingPayload extends MessagePayload { readonly home_id: string; readonly target_home: string; readonly agent_id: string; readonly region: string; readonly vault_materials: number }
interface HomeCollapsedPayload extends MessagePayload { readonly home_id: string; readonly target_home: string; readonly owner_id: string; readonly region: string; readonly stakeholders: readonly string[]; readonly integrity: number; readonly vault_materials: number; readonly remnant_materials: number; readonly ruined_at: number }
interface HomeBreachedPayload extends MessagePayload { readonly home_id: string; readonly target_home: string; readonly breacher_id: string; readonly intent: "thieve" | "colonize"; readonly region: string; readonly breachers: readonly string[]; readonly energy_cost: number; readonly materials_cost: number; readonly integrity_damage: number; readonly integrity: number }
interface HomeThievedPayload extends MessagePayload { readonly home_id: string; readonly target_home: string; readonly breacher_id: string; readonly intent: "thieve"; readonly region: string; readonly recipients: readonly string[]; readonly loot: MaterialsLoot; readonly loot_shares: Readonly<Record<string, number>>; readonly vault_materials: number; readonly integrity: number }
interface HomeColonizedPayload extends MessagePayload { readonly home_id: string; readonly target_home: string; readonly breacher_id: string; readonly intent: "colonize"; readonly region: string; readonly previous_owner_id: string; readonly previous_stakeholders: readonly string[]; readonly new_owner_id: string; readonly new_stakeholders: readonly string[]; readonly vault_materials: number; readonly integrity: number }
interface RuinsScavengedPayload extends MessagePayload { readonly agent_id: string; readonly home_id: string; readonly target_home: string; readonly region: string; readonly resource_type: "materials"; readonly amount: number; readonly remnant_materials: number; readonly agent_materials: number }
interface SimulationStartedPayload extends MessagePayload { readonly run_id: string; readonly agent_count: number; readonly world_time: number }

export interface SpatialTravelPayload extends MessagePayload {
  readonly agent_id: string;
  readonly region_id: string;
  readonly map_id: string;
  readonly layout_fingerprint: string;
  readonly travel_id: string;
  readonly destination_id: string;
  /** Present when this local route ends at a matched gate in another region. */
  readonly destination_region?: string;
  readonly route: readonly SpatialPoint[];
  readonly started_at: number;
  readonly arrives_at: number;
  readonly position: SpatialPoint;
  readonly spatial: AgentSpatialSnapshot;
}

export interface SpatialTravelCancelledPayload extends SpatialTravelPayload {
  readonly reason: string;
}

export interface PresentedPayloadByType {
  readonly agent_born: AgentBornPayload;
  readonly agent_died: AgentDiedPayload;
  readonly agent_decayed: AgentDecayedPayload;
  readonly agent_paralyzed: AgentParalyzedBreathPayload | AgentParalyzedAttackPayload;
  readonly agent_recovered: AgentRecoveredPayload;
  readonly agent_left_region: MovementPayload;
  readonly agent_entered_region: MovementPayload;
  readonly speak: SpeakPayload;
  readonly self_talk: SelfTalkPayload;
  readonly resource_changed: ResourceChangedPayload;
  readonly resource_transferred: ResourceTransferredPayload;
  readonly agent_started_hoarding: AgentStartedHoardingPayload;
  readonly mating_initiated: MatingInitiatedPayload;
  readonly mating_rejected: MatingRejectedPayload;
  readonly mating_proposal_invalidated: MatingProposalInvalidatedPayload;
  readonly mating_proposal_timeout: MatingProposalTimeoutPayload;
  readonly attack: AttackPayload;
  readonly home_built: HomeBuiltPayload;
  readonly hearth_used: HearthUsedPayload;
  readonly home_joined: HomeJoinedPayload;
  readonly home_left: HomeLeftPayload;
  readonly home_started_hoarding: HomeStartedHoardingPayload;
  readonly home_collapsed: HomeCollapsedPayload;
  readonly home_breached: HomeBreachedPayload;
  readonly home_thieved: HomeThievedPayload;
  readonly home_colonized: HomeColonizedPayload;
  readonly ruins_scavenged: RuinsScavengedPayload;
  readonly simulation_started: SimulationStartedPayload;
}

export type TypedPresentedEvent = {
  [K in PresentedEventType]: {
    readonly type: K;
    readonly entry: EventEnvelopeEntry;
    readonly payload: PresentedPayloadByType[K];
  }
}[PresentedEventType];

export type ParsedPresentedEvent =
  | { readonly known: true; readonly evidence: TypedPresentedEvent }
  | { readonly known: false; readonly entry: EventEnvelopeEntry };

export type TypedSpatialTravelEvent =
  | Readonly<{
    readonly type: "spatial_travel_started" | "spatial_travel_arrived";
    readonly entry: EventEnvelopeEntry;
    readonly payload: SpatialTravelPayload;
  }>
  | Readonly<{
    readonly type: "spatial_travel_cancelled";
    readonly entry: EventEnvelopeEntry;
    readonly payload: SpatialTravelCancelledPayload;
  }>;

type PayloadParserMap = {
  readonly [K in PresentedEventType]: (payload: unknown) => PresentedPayloadByType[K];
};

export const PRESENTED_EVENT_PAYLOAD_PARSERS = {
  agent_born: (value) => {
    const p = payload(value);
    const spatial = p.optionalNullableAgentSpatial("spatial");
    return {
      message: p.message(), child_id: p.string("child_id"), child_name: p.string("child_name"), parent_ids: p.strings("parent_ids", 2), initiator_id: p.string("initiator_id"), acceptor_id: p.string("acceptor_id"), region: p.string("region"), committed_resources: p.energyMaterials("committed_resources"), child_resources: p.energyMaterials("child_resources"), offspring_multiplier: p.number("offspring_multiplier"),
      ...(spatial === undefined ? {} : { spatial }),
    };
  },
  agent_died: (value) => { const p = payload(value); return { message: p.message(), victim_id: p.string("victim_id"), victim_name: p.string("victim_name"), killer_id: p.string("killer_id"), killer: p.string("killer"), region: p.string("region"), attack_damage: p.number("attack_damage"), attack_energy_cost: p.number("attack_energy_cost"), victim_was_paralyzed: p.boolean("victim_was_paralyzed"), looted_energy: p.number("looted_energy"), looted_materials: p.number("looted_materials") }; },
  agent_decayed: (value) => { const p = payload(value); return { message: p.message(), agent_id: p.string("agent_id"), agent_name: p.string("agent_name"), region: p.string("region"), died_at: p.number("died_at"), decayed_at: p.number("decayed_at") }; },
  agent_paralyzed: (value) => parseAgentParalyzed(value),
  agent_recovered: (value) => { const p = payload(value); return { message: p.message(), giver_id: p.string("giver_id"), recipient_id: p.string("recipient_id"), revived_id: p.string("revived_id"), region: p.string("region"), resource_type: p.literal("resource_type", ["energy"]), amount: p.number("amount"), giver_energy: p.number("giver_energy"), revived_energy: p.number("revived_energy") }; },
  agent_left_region: (value) => parseMovement(value, "agent_left_region"),
  agent_entered_region: (value) => parseMovement(value, "agent_entered_region"),
  speak: (value) => { const p = payload(value); return { message: p.message(), speaker_id: p.string("speaker_id"), target_id: p.nullableString("target_id"), region: p.string("region"), speak_energy_cost: p.number("speak_energy_cost") }; },
  self_talk: (value) => { const p = payload(value); return { message: p.message(), agent_id: p.string("agent_id") }; },
  resource_changed: (value) => { const p = payload(value); return { message: p.message(), agent_id: p.string("agent_id"), region: p.string("region"), resource_type: p.literal("resource_type", ["energy", "materials"]), amount: p.number("amount"), agent_energy: p.number("agent_energy"), agent_materials: p.number("agent_materials"), region_energy: p.number("region_energy"), region_materials: p.number("region_materials") }; },
  resource_transferred: (value) => { const p = payload(value); return { message: p.message(), sender_id: p.string("sender_id"), receiver_id: p.string("receiver_id"), region: p.string("region"), resource_type: p.literal("resource_type", ["energy", "materials"]), amount: p.number("amount"), sender_energy: p.number("sender_energy"), sender_materials: p.number("sender_materials"), receiver_energy: p.number("receiver_energy"), receiver_materials: p.number("receiver_materials") }; },
  agent_started_hoarding: (value) => { const p = payload(value); return { message: p.message(), agent_id: p.string("agent_id"), region: p.string("region"), energy: p.number("energy"), materials: p.number("materials") }; },
  mating_initiated: (value) => { const p = payload(value); return { message: p.message(), initiator_id: p.string("initiator_id"), target_id: p.string("target_id"), resources: p.energyMaterials("resources"), proposal_timestamp: p.number("proposal_timestamp"), initiator_energy: p.number("initiator_energy"), initiator_materials: p.number("initiator_materials") }; },
  mating_rejected: (value) => { const p = payload(value); return { message: p.message(), rejecter_id: p.string("rejecter_id"), initiator_id: p.string("initiator_id"), target_id: p.string("target_id"), resources_refunded: p.energyMaterials("resources_refunded") }; },
  mating_proposal_invalidated: (value) => { const p = payload(value); return { message: p.message(), initiator_id: p.string("initiator_id"), target_id: p.string("target_id"), reason: p.literal("reason", ["initiator_ineligible"]), resources_refunded: p.energyMaterials("resources_refunded") }; },
  mating_proposal_timeout: (value) => { const p = payload(value); return { message: p.message(), initiator_id: p.string("initiator_id"), target_id: p.string("target_id"), reason: p.literal("reason", ["timeout"]), resources_refunded: p.energyMaterials("resources_refunded") }; },
  attack: (value) => { const p = payload(value); return { message: p.message(), attacker_id: p.string("attacker_id"), victim_id: p.string("victim_id"), region: p.string("region"), damage: p.number("damage"), attack_energy_cost: p.number("attack_energy_cost"), attacker_energy: p.number("attacker_energy"), victim_energy: p.number("victim_energy") }; },
  home_built: (value) => {
    const p = payload(value);
    const homeSpatial = p.optionalNullableHomeSpatial("home_spatial");
    return {
      message: p.message(), home_id: p.string("home_id"), target_home: p.string("target_home"), builder_id: p.string("builder_id"), owner_id: p.string("owner_id"), region: p.string("region"), materials_cost: p.number("materials_cost"), integrity: p.number("integrity"), stakeholders: p.strings("stakeholders"),
      ...(homeSpatial === undefined ? {} : { home_spatial: homeSpatial }),
    };
  },
  hearth_used: (value) => { const p = payload(value); return { message: p.message(), agent_id: p.string("agent_id"), home_id: p.string("home_id"), target_home: p.string("target_home"), region: p.string("region"), materials_burned: p.number("materials_burned"), energy_gained: p.number("energy_gained"), agent_energy: p.number("agent_energy"), agent_materials: p.number("agent_materials") }; },
  home_joined: (value) => { const p = payload(value); return { message: p.message(), agent_id: p.string("agent_id"), home_id: p.string("home_id"), target_home: p.string("target_home"), owner_id: p.string("owner_id"), region: p.string("region"), stakeholders: p.strings("stakeholders"), integrity: p.number("integrity"), max_integrity: p.number("max_integrity") }; },
  home_left: (value) => { const p = payload(value); return { message: p.message(), agent_id: p.string("agent_id"), home_id: p.string("home_id"), target_home: p.string("target_home"), previous_owner_id: p.string("previous_owner_id"), owner_id: p.string("owner_id"), region: p.string("region"), previous_stakeholders: p.strings("previous_stakeholders"), stakeholders: p.strings("stakeholders"), integrity: p.number("integrity"), max_integrity: p.number("max_integrity") }; },
  home_started_hoarding: (value) => { const p = payload(value); return { message: p.message(), home_id: p.string("home_id"), target_home: p.string("target_home"), agent_id: p.string("agent_id"), region: p.string("region"), vault_materials: p.number("vault_materials") }; },
  home_collapsed: (value) => { const p = payload(value); return { message: p.message(), home_id: p.string("home_id"), target_home: p.string("target_home"), owner_id: p.string("owner_id"), region: p.string("region"), stakeholders: p.strings("stakeholders"), integrity: p.number("integrity"), vault_materials: p.number("vault_materials"), remnant_materials: p.nonNegativeNumber("remnant_materials"), ruined_at: p.number("ruined_at") }; },
  home_breached: (value) => { const p = payload(value); return { message: p.message(), home_id: p.string("home_id"), target_home: p.string("target_home"), breacher_id: p.string("breacher_id"), intent: p.literal("intent", ["thieve", "colonize"]), region: p.string("region"), breachers: p.strings("breachers"), energy_cost: p.number("energy_cost"), materials_cost: p.number("materials_cost"), integrity_damage: p.number("integrity_damage"), integrity: p.number("integrity") }; },
  home_thieved: (value) => { const p = payload(value); return { message: p.message(), home_id: p.string("home_id"), target_home: p.string("target_home"), breacher_id: p.string("breacher_id"), intent: p.literal("intent", ["thieve"]), region: p.string("region"), recipients: p.strings("recipients"), loot: p.materials("loot"), loot_shares: p.nonEmptyNumbers("loot_shares"), vault_materials: p.number("vault_materials"), integrity: p.number("integrity") }; },
  home_colonized: (value) => { const p = payload(value); return { message: p.message(), home_id: p.string("home_id"), target_home: p.string("target_home"), breacher_id: p.string("breacher_id"), intent: p.literal("intent", ["colonize"]), region: p.string("region"), previous_owner_id: p.string("previous_owner_id"), previous_stakeholders: p.strings("previous_stakeholders"), new_owner_id: p.string("new_owner_id"), new_stakeholders: p.strings("new_stakeholders"), vault_materials: p.number("vault_materials"), integrity: p.number("integrity") }; },
  ruins_scavenged: (value) => { const p = payload(value); return { message: p.message(), agent_id: p.string("agent_id"), home_id: p.string("home_id"), target_home: p.string("target_home"), region: p.string("region"), resource_type: p.literal("resource_type", ["materials"]), amount: p.number("amount"), remnant_materials: p.nonNegativeNumber("remnant_materials"), agent_materials: p.number("agent_materials") }; },
  simulation_started: (value) => { const p = payload(value); return { message: p.message(), run_id: p.string("run_id"), agent_count: p.integer("agent_count"), world_time: p.number("world_time") }; },
} satisfies PayloadParserMap;

const knownEventTypes = new Set<string>(EVENT_VISUAL_EVENT_TYPES);

/** Parses a known payload or retains an unknown future envelope as inert evidence. */
export function parsePresentedEvent(entry: EventEnvelopeEntry): ParsedPresentedEvent {
  if (!knownEventTypes.has(entry.event.type)) return { known: false, entry };
  const type = entry.event.type as PresentedEventType;
  const parser = PRESENTED_EVENT_PAYLOAD_PARSERS[type] as (value: unknown) => PresentedPayloadByType[PresentedEventType];
  const evidence = { type, entry, payload: parser(entry.event.payload) } as TypedPresentedEvent;
  return { known: true, evidence };
}

/**
 * Parse one backend-owned navigation event.  A malformed spatial payload is a
 * contract failure, not an inert future event: otherwise the observer could
 * retain a prior route and draw feet the world has explicitly superseded.
 */
export function parseSpatialTravelEvent(
  entry: EventEnvelopeEntry,
): TypedSpatialTravelEvent | null {
  if (!SPATIAL_TRAVEL_EVENT_TYPES.includes(entry.event.type as SpatialTravelEventType)) {
    return null;
  }
  const reader = payload(entry.event.payload);
  const type = entry.event.type as SpatialTravelEventType;
  const destinationRegion = reader.optionalString("destination_region");
  const base = {
    message: reader.message(),
    agent_id: reader.string("agent_id"),
    region_id: reader.string("region_id"),
    map_id: reader.string("map_id"),
    layout_fingerprint: reader.string("layout_fingerprint"),
    travel_id: reader.string("travel_id"),
    destination_id: reader.string("destination_id"),
    ...(destinationRegion === undefined ? {} : { destination_region: destinationRegion }),
    route: reader.spatialPoints("route"),
    started_at: reader.number("started_at"),
    arrives_at: reader.number("arrives_at"),
    position: reader.spatialPoint("position"),
    spatial: parseAgentSpatialSnapshot(reader.object("spatial")),
  } satisfies SpatialTravelPayload;
  if (base.arrives_at < base.started_at) {
    throw new Error("spatial travel arrives_at must not precede started_at");
  }
  if (
    entry.event.scope !== "local"
    || entry.event.source !== base.agent_id
    || entry.event.region !== base.region_id
  ) {
    throw new Error("spatial travel envelope must be local to its authoritative agent and region");
  }
  validateSpatialTravelPayload(type, base);
  if (type === "spatial_travel_cancelled") {
    const cancelled: SpatialTravelCancelledPayload = {
      ...base,
      reason: reader.string("reason"),
    };
    return Object.freeze({ type, entry, payload: Object.freeze(cancelled) });
  }
  return Object.freeze({ type, entry, payload: Object.freeze(base) });
}

/** True when an entry owns feet in the spatial pilot and must skip choreography. */
export function isSpatialTravelEvent(entry: EventEnvelopeEntry): boolean {
  return SPATIAL_TRAVEL_EVENT_TYPES.includes(entry.event.type as SpatialTravelEventType);
}

/**
 * True for an enriched lifecycle event that changes spatial authority before a
 * checkpoint can arrive.  This deliberately looks only for the backend-owned
 * optional fields: legacy logs retain their established choreography.
 */
export function isSpatialAuthorityLifecycleEvent(entry: EventEnvelopeEntry): boolean {
  const event = entry.event;
  const payloadValue = event.payload;
  if (payloadValue === null || typeof payloadValue !== "object" || Array.isArray(payloadValue)) {
    return false;
  }
  const body = payloadValue as Readonly<Record<string, unknown>>;
  if (event.type === "agent_left_region" || event.type === "agent_entered_region") {
    return body.authoritative_spatial === true || Object.hasOwn(body, "spatial");
  }
  if (event.type === "agent_born") {
    return Object.hasOwn(body, "spatial") && body.spatial !== null;
  }
  return event.type === "home_built"
    && Object.hasOwn(body, "home_spatial")
    && body.home_spatial !== null;
}

function validateSpatialTravelPayload(
  type: SpatialTravelEventType,
  payloadValue: SpatialTravelPayload,
): void {
  const spatial = payloadValue.spatial;
  if (
    spatial.region_id !== payloadValue.region_id
    || spatial.map_id !== payloadValue.map_id
    || spatial.layout_fingerprint !== payloadValue.layout_fingerprint
    || spatial.x !== payloadValue.position.x
    || spatial.y !== payloadValue.position.y
  ) {
    throw new Error("spatial travel payload must agree with its atomic spatial position");
  }
  if (type === "spatial_travel_started") {
    const travel = spatial.travel;
    if (travel === null) throw new Error("spatial_travel_started requires spatial.travel");
    if (
      travel.id !== payloadValue.travel_id
      || travel.destination_id !== payloadValue.destination_id
      || (payloadValue.destination_region !== undefined
        && travel.destination_region !== payloadValue.destination_region)
      || travel.started_at !== payloadValue.started_at
      || travel.arrives_at !== payloadValue.arrives_at
      || !sameRoute(travel.route, payloadValue.route)
    ) {
      throw new Error("spatial_travel_started must agree with spatial.travel");
    }
    return;
  }
  if (spatial.travel !== null) {
    throw new Error(`${type} requires a stopped atomic spatial state`);
  }
}

function sameRoute(left: readonly SpatialPoint[], right: readonly SpatialPoint[]): boolean {
  return left.length === right.length && left.every((point, index) => (
    point.x === right[index]?.x && point.y === right[index]?.y
  ));
}

function parseMovement(
  value: unknown,
  type: "agent_left_region" | "agent_entered_region",
): MovementPayload {
  const p = payload(value);
  const spatial = p.optionalNullableAgentSpatial("spatial");
  const authoritativeSpatial = p.optionalBoolean("authoritative_spatial");
  const sourcePosition = p.optionalSpatialPoint("source_position");
  if (authoritativeSpatial !== undefined && authoritativeSpatial !== true) {
    throw new Error("authoritative_spatial must be true when supplied");
  }
  if (authoritativeSpatial === true) {
    if (spatial === undefined) throw new Error(`${type} authoritative_spatial requires spatial`);
    if (type === "agent_left_region") {
      if (spatial !== null) throw new Error("agent_left_region authoritative_spatial requires null spatial");
      if (sourcePosition === undefined) throw new Error("agent_left_region authoritative_spatial requires source_position");
    } else {
      if (spatial === null) throw new Error("agent_entered_region authoritative_spatial requires non-null spatial");
      if (sourcePosition !== undefined) throw new Error("agent_entered_region authoritative_spatial must not include source_position");
    }
  }
  return {
    message: p.message(), agent_id: p.string("agent_id"), from_region: p.string("from_region"), to_region: p.string("to_region"), move_energy_cost: p.number("move_energy_cost"), agent_energy: p.number("agent_energy"),
    ...(spatial === undefined ? {} : { spatial }),
    ...(authoritativeSpatial === undefined ? {} : { authoritative_spatial: true as const }),
    ...(sourcePosition === undefined ? {} : { source_position: sourcePosition }),
  };
}

function parseAgentParalyzed(value: unknown): AgentParalyzedBreathPayload | AgentParalyzedAttackPayload {
  const p = payload(value);
  const common = { message: p.message(), agent_id: p.string("agent_id"), region: p.string("region"), energy: p.number("energy") };
  const trigger = p.literal("trigger", ["breath", "attack"]);
  return trigger === "breath"
    ? { ...common, trigger }
    : { ...common, trigger, victim_id: p.string("victim_id"), attacker_id: p.string("attacker_id") };
}

interface PayloadReader {
  message(): string;
  string(key: string): string;
  optionalString(key: string): string | undefined;
  nullableString(key: string): string | null;
  number(key: string): number;
  nonNegativeNumber(key: string): number;
  integer(key: string): number;
  boolean(key: string): boolean;
  optionalBoolean(key: string): boolean | undefined;
  strings(key: string, exactLength?: number): readonly string[];
  energyMaterials(key: string): EnergyMaterialsResources;
  materials(key: string): MaterialsLoot;
  nonEmptyNumbers(key: string): Readonly<Record<string, number>>;
  object(key: string): Readonly<Record<string, unknown>>;
  spatialPoint(key: string): SpatialPoint;
  optionalSpatialPoint(key: string): SpatialPoint | undefined;
  spatialPoints(key: string): readonly SpatialPoint[];
  optionalNullableAgentSpatial(key: string): AgentSpatialSnapshot | null | undefined;
  optionalNullableHomeSpatial(key: string): HomeSpatialSnapshot | null | undefined;
  literal<const T extends string>(key: string, allowed: readonly T[]): T;
}

function payload(value: unknown): PayloadReader {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("event payload must be an object");
  const input = value as Record<string, unknown>;
  const numberFor = (key: string): number => {
    const candidate = input[key];
    if (typeof candidate !== "number" || !Number.isFinite(candidate)) throw new Error(`${key} must be a finite number`);
    return candidate;
  };
  return {
    message: () => stringFor(input, "message"),
    string: (key) => stringFor(input, key),
    optionalString(key) {
      const candidate = input[key];
      if (candidate === undefined) return undefined;
      if (typeof candidate !== "string") throw new Error(`${key} must be a string`);
      return candidate;
    },
    nullableString(key) { return input[key] === null ? null : stringFor(input, key); },
    number: numberFor,
    nonNegativeNumber(key) {
      const candidate = numberFor(key);
      if (candidate < 0) throw new Error(`${key} must be non-negative`);
      return candidate;
    },
    integer(key) { const candidate = numberFor(key); if (!Number.isSafeInteger(candidate)) throw new Error(`${key} must be a safe integer`); return candidate; },
    boolean(key) { const candidate = input[key]; if (typeof candidate !== "boolean") throw new Error(`${key} must be a boolean`); return candidate; },
    optionalBoolean(key) {
      const candidate = input[key];
      if (candidate === undefined) return undefined;
      if (typeof candidate !== "boolean") throw new Error(`${key} must be a boolean`);
      return candidate;
    },
    strings(key, exactLength) {
      const candidate = input[key];
      if (!Array.isArray(candidate) || candidate.some((item) => typeof item !== "string")) throw new Error(`${key} must be a string array`);
      if (exactLength !== undefined && candidate.length !== exactLength) throw new Error(`${key} must contain exactly ${exactLength} items`);
      return [...candidate] as string[];
    },
    energyMaterials(key) {
      const record = exactNumberRecord(input, key, ["energy", "materials"]);
      return { energy: record.energy, materials: record.materials };
    },
    materials(key) {
      const record = exactNumberRecord(input, key, ["materials"]);
      return { materials: record.materials };
    },
    nonEmptyNumbers(key) {
      const record = numberRecord(input, key);
      const entries = Object.entries(record);
      if (entries.length === 0) throw new Error(`${key} must not be empty`);
      if (entries.some(([name]) => name.trim().length === 0)) throw new Error(`${key} keys must be non-empty agent ids`);
      return Object.fromEntries(entries);
    },
    object(key) {
      const candidate = input[key];
      if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new Error(`${key} must be an object`);
      }
      return candidate as Readonly<Record<string, unknown>>;
    },
    spatialPoint(key) {
      return spatialPoint(input[key], key);
    },
    optionalSpatialPoint(key) {
      const candidate = input[key];
      return candidate === undefined ? undefined : spatialPoint(candidate, key);
    },
    spatialPoints(key) {
      const candidate = input[key];
      if (!Array.isArray(candidate) || candidate.length === 0) {
        throw new Error(`${key} must be a non-empty point array`);
      }
      return Object.freeze(candidate.map((item, index) => spatialPoint(item, `${key}[${index}]`)));
    },
    optionalNullableAgentSpatial(key) {
      const candidate = input[key];
      if (candidate === undefined || candidate === null) return candidate;
      return parseAgentSpatialSnapshot(candidate);
    },
    optionalNullableHomeSpatial(key) {
      const candidate = input[key];
      if (candidate === undefined || candidate === null) return candidate;
      return parseHomeSpatialSnapshot(candidate);
    },
    literal<const T extends string>(key: string, allowed: readonly T[]): T {
      const candidate = input[key];
      if (typeof candidate !== "string" || !(allowed as readonly string[]).includes(candidate)) throw new Error(`${key} must be one of ${allowed.join(", ")}`);
      return candidate as T;
    },
  };
}

function spatialPoint(value: unknown, label: string): SpatialPoint {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a point`);
  }
  const input = value as Record<string, unknown>;
  if (typeof input.x !== "number" || !Number.isFinite(input.x)
    || typeof input.y !== "number" || !Number.isFinite(input.y)) {
    throw new Error(`${label} must contain finite x and y`);
  }
  return Object.freeze({ x: input.x, y: input.y });
}

function exactNumberRecord<const K extends string>(
  input: Readonly<Record<string, unknown>>,
  key: string,
  expectedKeys: readonly K[],
): Readonly<Record<K, number>> {
  const record = numberRecord(input, key);
  const actualKeys = Object.keys(record).sort();
  const requiredKeys = [...expectedKeys].sort();
  if (actualKeys.length !== requiredKeys.length || actualKeys.some((name, index) => name !== requiredKeys[index])) {
    throw new Error(`${key} must contain exactly ${requiredKeys.join(" and ")}`);
  }
  return record as Readonly<Record<K, number>>;
}

function numberRecord(
  input: Readonly<Record<string, unknown>>,
  key: string,
): Readonly<Record<string, number>> {
  const candidate = input[key];
  if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) throw new Error(`${key} must be a number record`);
  return Object.fromEntries(Object.entries(candidate).map(([name, item]) => {
    if (typeof item !== "number" || !Number.isFinite(item)) throw new Error(`${key}.${name} must be a finite number`);
    return [name, item];
  }));
}

function stringFor(input: Readonly<Record<string, unknown>>, key: string): string {
  const candidate = input[key];
  if (typeof candidate !== "string") throw new Error(`${key} must be a string`);
  return candidate;
}
