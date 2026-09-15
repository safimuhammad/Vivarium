import type {
  AgentSpatialSnapshot,
  AgentSnapshot,
  HomeSpatialSnapshot,
  HomeSnapshot,
  PendingProposalSnapshot,
  RegionSnapshot,
  WorldSnapshot,
} from "../app/schemas";
import type { PresentedRecord } from "./contracts";
import type {
  PresentedEventType,
  PresentedPayloadByType,
  TypedSpatialTravelEvent,
  TypedPresentedEvent,
} from "./eventPayloads";

export interface PresentedHoardThresholds {
  readonly hoarding_energy_threshold: number;
  readonly hoarding_materials_threshold: number;
}

export interface ProjectedWorldState {
  readonly exactBase: WorldSnapshot;
  readonly projectedThroughCursor: number;
  readonly agents: ReadonlyMap<string, PresentedRecord<AgentSnapshot>>;
  readonly regions: ReadonlyMap<string, PresentedRecord<RegionSnapshot>>;
  readonly homes: ReadonlyMap<string, PresentedRecord<HomeSnapshot>>;
  readonly ruins: ReadonlyMap<string, PresentedRecord<HomeSnapshot>>;
  readonly pendingProposals: readonly PendingProposalSnapshot[];
}

export interface ProjectionResult {
  readonly state: ProjectedWorldState;
  readonly appliedFields: readonly string[];
  readonly unresolvedFields: readonly string[];
}

export interface PresentedEventProjector {
  project(state: ProjectedWorldState, evidence: TypedPresentedEvent): ProjectionResult;
  /** Apply one atomic backend navigation state without inventing a body command. */
  projectSpatial(state: ProjectedWorldState, evidence: TypedSpatialTravelEvent): ProjectionResult;
}

type ProjectorMap = {
  readonly [K in PresentedEventType]: (
    state: ProjectedWorldState,
    payload: PresentedPayloadByType[K],
    cursor: number,
    thresholds: PresentedHoardThresholds | undefined,
  ) => ProjectionResult;
};

export const PRESENTED_EVENT_PROJECTORS: ProjectorMap = {
  agent_born(state, payload, cursor) {
    const draft = new ProjectionDraft(state);
    const spatial = payload.spatial;
    draft.introduceAgent(payload.child_id, {
      id: payload.child_id,
      name: payload.child_name,
      position: payload.region,
      energy: payload.child_resources.energy,
      materials: payload.child_resources.materials,
      status: "alive",
      ...(spatial === undefined || spatial === null ? {} : { spatial }),
    }, ["id", "name", "position", "energy", "materials", "status", ...(spatial === undefined || spatial === null ? [] : ["spatial"])], [
      "persona", "last_mated_at", "offspring_count", "died_at", "home_id", "is_hoarding",
    ]);
    draft.removeProposal(payload.initiator_id, payload.acceptor_id);
    draft.markUnresolved("agents", payload.initiator_id, ["last_mated_at", "offspring_count"]);
    draft.markUnresolved("agents", payload.acceptor_id, ["last_mated_at", "offspring_count", "energy", "materials"]);
    return draft.finish(cursor);
  },
  agent_died(state, payload, cursor) {
    const draft = new ProjectionDraft(state);
    draft.patchAgent(payload.victim_id, { status: "dead", energy: 0, materials: 0, home_id: null, is_hoarding: false }, ["status", "energy", "materials", "home_id", "is_hoarding"]);
    draft.markUnresolved("agents", payload.victim_id, ["died_at"]);
    draft.markUnresolved("agents", payload.killer_id, ["energy", "materials"]);
    draft.markUnresolvedPaths([
      "pendingProposals.*",
      "agents.*.energy",
      "agents.*.materials",
      "homes.*.owner_id",
      "homes.*.stakeholders",
      "homes.*.integrity",
      "homes.*.max_integrity",
    ]);
    return draft.finish(cursor);
  },
  agent_decayed(state, payload, cursor) {
    const draft = new ProjectionDraft(state);
    draft.removeAgent(payload.agent_id);
    return draft.finish(cursor);
  },
  agent_paralyzed(state, payload, cursor) {
    const draft = new ProjectionDraft(state);
    draft.patchAgent(payload.agent_id, { status: "paralyzed", energy: payload.energy }, ["status", "energy"]);
    return draft.finish(cursor);
  },
  agent_recovered(state, payload, cursor) {
    const draft = new ProjectionDraft(state);
    draft.patchAgent(payload.giver_id, { energy: payload.giver_energy }, ["energy"]);
    draft.patchAgent(payload.recipient_id, { energy: payload.revived_energy, status: "alive" }, ["energy", "status"]);
    return draft.finish(cursor);
  },
  agent_left_region(state, payload, cursor) {
    const draft = new ProjectionDraft(state);
    if (payload.authoritative_spatial === true) {
      const sourcePosition = payload.source_position;
      if (sourcePosition === undefined) throw new Error("agent_left_region authoritative_spatial requires source_position");
      draft.patchAgent(payload.agent_id, {
        position: payload.from_region,
        energy: payload.agent_energy,
        spatial: undefined,
        spatial_migration: {
          from_region: payload.from_region,
          to_region: payload.to_region,
          source_position: sourcePosition,
        },
      }, ["position", "energy", "spatial", "spatial_migration"]);
    } else {
      if (payload.spatial === null) draft.patchAgent(payload.agent_id, { spatial: undefined }, ["spatial"]);
      draft.markUnresolved("agents", payload.agent_id, ["position", "energy"]);
    }
    return draft.finish(cursor);
  },
  agent_entered_region(state, payload, cursor) {
    const draft = new ProjectionDraft(state);
    draft.patchAgent(payload.agent_id, {
      position: payload.to_region,
      energy: payload.agent_energy,
      ...(payload.spatial === undefined ? {} : { spatial: payload.spatial ?? undefined }),
      ...(payload.authoritative_spatial === true ? { spatial_migration: undefined } : {}),
    }, [
      "position",
      "energy",
      ...(payload.spatial === undefined ? [] : ["spatial"]),
      ...(payload.authoritative_spatial === true ? ["spatial_migration"] : []),
    ]);
    return draft.finish(cursor);
  },
  speak(state, payload, cursor) {
    const draft = new ProjectionDraft(state);
    draft.markUnresolved("agents", payload.speaker_id, ["energy"]);
    return draft.finish(cursor);
  },
  self_talk(state, payload, cursor) {
    const draft = new ProjectionDraft(state);
    draft.markUnresolved("agents", payload.agent_id, ["energy"]);
    return draft.finish(cursor);
  },
  resource_changed(state, payload, cursor, thresholds) {
    const draft = new ProjectionDraft(state);
    const hoarding = deriveAgentHoarding(thresholds, payload.agent_energy, payload.agent_materials);
    draft.patchAgent(payload.agent_id, {
      energy: payload.agent_energy,
      materials: payload.agent_materials,
      ...(hoarding === undefined ? {} : { is_hoarding: hoarding }),
    }, hoarding === undefined ? ["energy", "materials"] : ["energy", "materials", "is_hoarding"]);
    if (hoarding === undefined) draft.markUnresolved("agents", payload.agent_id, ["is_hoarding"]);
    draft.patchRegion(payload.region, { current_energy: payload.region_energy, current_materials: payload.region_materials }, ["current_energy", "current_materials"]);
    return draft.finish(cursor);
  },
  resource_transferred(state, payload, cursor, thresholds) {
    const draft = new ProjectionDraft(state);
    const senderHoarding = deriveAgentHoarding(thresholds, payload.sender_energy, payload.sender_materials);
    draft.patchAgent(payload.sender_id, {
      energy: payload.sender_energy,
      materials: payload.sender_materials,
      ...(senderHoarding === undefined ? {} : { is_hoarding: senderHoarding }),
    }, senderHoarding === undefined ? ["energy", "materials"] : ["energy", "materials", "is_hoarding"]);
    if (senderHoarding === undefined) draft.markUnresolved("agents", payload.sender_id, ["is_hoarding"]);
    const receiverHoarding = deriveAgentHoarding(thresholds, payload.receiver_energy, payload.receiver_materials);
    draft.patchAgent(payload.receiver_id, {
      energy: payload.receiver_energy,
      materials: payload.receiver_materials,
      ...(receiverHoarding === undefined ? {} : { is_hoarding: receiverHoarding }),
    }, receiverHoarding === undefined ? ["energy", "materials"] : ["energy", "materials", "is_hoarding"]);
    if (receiverHoarding === undefined) draft.markUnresolved("agents", payload.receiver_id, ["is_hoarding"]);
    return draft.finish(cursor);
  },
  agent_started_hoarding(state, payload, cursor) {
    const draft = new ProjectionDraft(state);
    draft.patchAgent(payload.agent_id, { energy: payload.energy, materials: payload.materials, is_hoarding: true }, ["energy", "materials", "is_hoarding"]);
    return draft.finish(cursor);
  },
  mating_initiated(state, payload, cursor) {
    const draft = new ProjectionDraft(state);
    draft.patchAgent(payload.initiator_id, { energy: payload.initiator_energy, materials: payload.initiator_materials }, ["energy", "materials"]);
    draft.upsertProposal({ initiator_id: payload.initiator_id, target_id: payload.target_id, timestamp: null, resources: { ...payload.resources } });
    draft.markProposalTimestampUnresolved(payload.initiator_id, payload.target_id);
    return draft.finish(cursor);
  },
  mating_rejected: removeMatingProposal,
  mating_proposal_invalidated: removeMatingProposal,
  mating_proposal_timeout: removeMatingProposal,
  attack(state, payload, cursor) {
    const draft = new ProjectionDraft(state);
    draft.patchAgent(payload.attacker_id, { energy: payload.attacker_energy }, ["energy"]);
    draft.patchAgent(payload.victim_id, { energy: payload.victim_energy }, ["energy"]);
    return draft.finish(cursor);
  },
  home_built(state, payload, cursor) {
    const draft = new ProjectionDraft(state);
    const homeSpatial = payload.home_spatial;
    draft.introduceHome(payload.home_id, {
      home_id: payload.home_id,
      owner_id: payload.owner_id,
      region: payload.region,
      integrity: payload.integrity,
      stakeholders: [...payload.stakeholders],
      status: "standing",
      ...(homeSpatial === undefined || homeSpatial === null ? {} : { spatial: homeSpatial }),
    }, ["home_id", "owner_id", "region", "integrity", "stakeholders", "status", ...(homeSpatial === undefined || homeSpatial === null ? [] : ["spatial"])], [
      "max_integrity", "built_at", "last_upkeep_at", "last_integrity_at", "vault_materials",
      "ruined_at", "remnant_materials", "breachers", "is_hoarding",
    ]);
    draft.patchAgent(payload.builder_id, { home_id: payload.home_id }, ["home_id"]);
    draft.markUnresolved("agents", payload.builder_id, ["materials"]);
    return draft.finish(cursor);
  },
  hearth_used(state, payload, cursor, thresholds) {
    const draft = new ProjectionDraft(state);
    const hoarding = deriveAgentHoarding(thresholds, payload.agent_energy, payload.agent_materials);
    draft.patchAgent(payload.agent_id, {
      energy: payload.agent_energy,
      materials: payload.agent_materials,
      ...(hoarding === undefined ? {} : { is_hoarding: hoarding }),
    }, hoarding === undefined ? ["energy", "materials"] : ["energy", "materials", "is_hoarding"]);
    if (hoarding === undefined) draft.markUnresolved("agents", payload.agent_id, ["is_hoarding"]);
    return draft.finish(cursor);
  },
  home_joined(state, payload, cursor) {
    const draft = new ProjectionDraft(state);
    draft.patchHome(payload.home_id, { owner_id: payload.owner_id, region: payload.region, stakeholders: [...payload.stakeholders], integrity: payload.integrity, max_integrity: payload.max_integrity }, ["owner_id", "region", "stakeholders", "integrity", "max_integrity"]);
    draft.patchAgent(payload.agent_id, { home_id: payload.home_id }, ["home_id"]);
    return draft.finish(cursor);
  },
  home_left(state, payload, cursor) {
    const draft = new ProjectionDraft(state);
    draft.patchHome(payload.home_id, { owner_id: payload.owner_id, region: payload.region, stakeholders: [...payload.stakeholders], integrity: payload.integrity, max_integrity: payload.max_integrity }, ["owner_id", "region", "stakeholders", "integrity", "max_integrity"]);
    draft.patchAgent(payload.agent_id, { home_id: null }, ["home_id"]);
    return draft.finish(cursor);
  },
  home_started_hoarding(state, payload, cursor) {
    const draft = new ProjectionDraft(state);
    draft.patchHome(payload.home_id, { vault_materials: payload.vault_materials, is_hoarding: true }, ["vault_materials", "is_hoarding"]);
    draft.markUnresolved("agents", payload.agent_id, ["materials"]);
    return draft.finish(cursor);
  },
  home_collapsed(state, payload, cursor) {
    const draft = new ProjectionDraft(state);
    draft.collapseHome(payload.home_id, {
      home_id: payload.home_id,
      owner_id: payload.owner_id,
      region: payload.region,
      integrity: payload.integrity,
      status: "ruin",
      ruined_at: payload.ruined_at,
      remnant_materials: payload.remnant_materials,
      stakeholders: [],
      vault_materials: 0,
      breachers: [],
      is_hoarding: false,
    });
    for (const stakeholder of payload.stakeholders) draft.patchAgent(stakeholder, { home_id: null }, ["home_id"]);
    return draft.finish(cursor);
  },
  home_breached(state, payload, cursor) {
    const draft = new ProjectionDraft(state);
    draft.patchHome(payload.home_id, { integrity: payload.integrity, breachers: [...payload.breachers] }, ["integrity", "breachers"]);
    draft.markUnresolved("agents", payload.breacher_id, ["energy", "materials"]);
    return draft.finish(cursor);
  },
  home_thieved(state, payload, cursor, thresholds) {
    const draft = new ProjectionDraft(state);
    const hoarding = deriveHomeHoarding(thresholds, payload.vault_materials);
    draft.patchHome(payload.home_id, {
      vault_materials: payload.vault_materials,
      integrity: payload.integrity,
      status: "standing",
      ...(hoarding === undefined ? {} : { is_hoarding: hoarding }),
    }, hoarding === undefined ? ["vault_materials", "integrity", "status"] : ["vault_materials", "integrity", "status", "is_hoarding"]);
    if (hoarding === undefined) draft.markUnresolved("homes", payload.home_id, ["is_hoarding"]);
    for (const recipient of payload.recipients) draft.markUnresolved("agents", recipient, ["materials"]);
    return draft.finish(cursor);
  },
  home_colonized(state, payload, cursor, thresholds) {
    const draft = new ProjectionDraft(state);
    const hoarding = deriveHomeHoarding(thresholds, payload.vault_materials);
    draft.patchHome(payload.home_id, {
      owner_id: payload.new_owner_id,
      region: payload.region,
      stakeholders: [...payload.new_stakeholders],
      vault_materials: payload.vault_materials,
      integrity: payload.integrity,
      status: "standing",
      breachers: [],
      ...(hoarding === undefined ? {} : { is_hoarding: hoarding }),
    }, hoarding === undefined
      ? ["owner_id", "region", "stakeholders", "vault_materials", "integrity", "status", "breachers"]
      : ["owner_id", "region", "stakeholders", "vault_materials", "integrity", "status", "breachers", "is_hoarding"]);
    if (hoarding === undefined) draft.markUnresolved("homes", payload.home_id, ["is_hoarding"]);
    for (const stakeholder of payload.previous_stakeholders) draft.patchAgent(stakeholder, { home_id: null }, ["home_id"]);
    for (const stakeholder of payload.new_stakeholders) draft.patchAgent(stakeholder, { home_id: payload.home_id }, ["home_id"]);
    draft.markUnresolvedPaths([
      "homes.*.owner_id",
      "homes.*.stakeholders",
      "homes.*.integrity",
      "homes.*.max_integrity",
    ]);
    return draft.finish(cursor);
  },
  ruins_scavenged(state, payload, cursor, thresholds) {
    const draft = new ProjectionDraft(state);
    draft.patchRuin(payload.home_id, { remnant_materials: payload.remnant_materials }, ["remnant_materials"]);
    const current = state.agents.get(payload.agent_id)?.value;
    const energy = current?.energy;
    const hoarding = typeof energy === "number"
      ? deriveAgentHoarding(thresholds, energy, payload.agent_materials)
      : undefined;
    draft.patchAgent(payload.agent_id, {
      materials: payload.agent_materials,
      ...(hoarding === undefined ? {} : { is_hoarding: hoarding }),
    }, hoarding === undefined ? ["materials"] : ["materials", "is_hoarding"]);
    if (hoarding === undefined) draft.markUnresolved("agents", payload.agent_id, ["is_hoarding"]);
    return draft.finish(cursor);
  },
  simulation_started(state, payload, cursor) {
    if (payload.run_id !== state.exactBase.run_id) throw new Error(`simulation_started run ${payload.run_id} does not match ${state.exactBase.run_id}`);
    return new ProjectionDraft(state).finish(cursor);
  },
};

/** Creates the complete exact projection corresponding to a snapshot. */
export function createProjectedWorldState(snapshot: WorldSnapshot): ProjectedWorldState {
  return {
    exactBase: snapshot,
    projectedThroughCursor: snapshot.event_cursor,
    agents: exactMap(snapshot.agents, (agent) => agent.id),
    regions: exactMap(snapshot.regions, (region) => region.name),
    homes: exactMap(snapshot.homes, (home) => home.home_id),
    ruins: exactMap(snapshot.ruins, (home) => home.home_id),
    pendingProposals: snapshot.pending_proposals,
  };
}

/** Creates the registry-backed durable event projector. */
export function createPresentedEventProjector(
  thresholds?: PresentedHoardThresholds,
): PresentedEventProjector {
  const frozenThresholds = freezeHoardThresholds(thresholds);
  return {
    project(state, evidence) {
      validateLifecycleSpatialAuthority(state, evidence);
      const handler = PRESENTED_EVENT_PROJECTORS[evidence.type] as (
        state: ProjectedWorldState,
        payload: PresentedPayloadByType[PresentedEventType],
        cursor: number,
        thresholds: PresentedHoardThresholds | undefined,
      ) => ProjectionResult;
      return handler(state, evidence.payload, evidence.entry.cursor, frozenThresholds);
    },
    projectSpatial(state, evidence) {
      const payload = evidence.payload;
      const region = state.regions.get(payload.region_id)?.value;
      const regionSpatial = region?.spatial;
      if (
        region === undefined
        || region.name !== payload.region_id
        || regionSpatial === undefined
        || regionSpatial.map_id !== payload.map_id
        || regionSpatial.layout_fingerprint !== payload.layout_fingerprint
      ) {
        throw new Error("spatial travel event does not match the projected regional map");
      }
      const current = state.agents.get(payload.agent_id)?.value;
      if (current === undefined || current.position !== payload.region_id) {
        throw new Error("spatial travel event does not match the projected agent region");
      }
      const landmarks = new Set(regionSpatial.landmarks.map(({ id }) => id));
      if (!landmarks.has(payload.destination_id)) {
        throw new Error("spatial travel event names an unknown map landmark");
      }
      const draft = new ProjectionDraft(state);
      draft.patchAgent(payload.agent_id, { spatial: payload.spatial }, ["spatial"]);
      return draft.finish(evidence.entry.cursor);
    },
  };
}

/**
 * Lifecycle payloads may be emitted before a checkpoint catches up.  Validate
 * their map identity at the projection boundary, so a stale regional state can
 * neither survive a legacy transition nor be attached to the wrong map.
 */
function validateLifecycleSpatialAuthority(
  state: ProjectedWorldState,
  evidence: TypedPresentedEvent,
): void {
  const source = evidence.entry.event.source;
  switch (evidence.type) {
    case "agent_left_region": {
      const { payload } = evidence;
      if (payload.spatial === undefined) return;
      validateEventSource(source, payload.agent_id, "agent_left_region");
      if (payload.spatial !== null) {
        throw new Error("agent_left_region spatial authority must explicitly clear");
      }
      if (payload.authoritative_spatial === true) {
        if (payload.source_position === undefined) {
          throw new Error("agent_left_region authoritative_spatial requires source_position");
        }
        const current = state.agents.get(payload.agent_id)?.value;
        const region = state.regions.get(payload.from_region)?.value;
        if (current === undefined || current.position !== payload.from_region || region?.spatial === undefined) {
          throw new Error("agent_left_region authoritative_spatial does not match the projected source region");
        }
      }
      return;
    }
    case "agent_entered_region": {
      const { payload } = evidence;
      if (payload.spatial === undefined) return;
      validateEventSource(source, payload.agent_id, "agent_entered_region");
      if (payload.authoritative_spatial === true && payload.spatial === null) {
        throw new Error("agent_entered_region authoritative_spatial requires non-null spatial");
      }
      if (payload.spatial !== null) {
        validateAgentSpatialForRegion(state, payload.to_region, payload.spatial, "agent_entered_region");
      }
      return;
    }
    case "agent_born": {
      const { payload } = evidence;
      if (payload.spatial === undefined) return;
      validateEventSource(source, payload.child_id, "agent_born");
      if (payload.spatial !== null) {
        validateAgentSpatialForRegion(state, payload.region, payload.spatial, "agent_born");
      }
      return;
    }
    case "home_built": {
      const { payload } = evidence;
      if (payload.home_spatial === undefined) return;
      validateEventSource(source, payload.builder_id, "home_built");
      if (payload.home_spatial !== null) {
        validateHomeSpatialForRegion(state, payload.region, payload.home_spatial, "home_built");
      }
      return;
    }
    default:
      return;
  }
}

function validateEventSource(source: string, expected: string, label: string): void {
  if (source !== expected) {
    throw new Error(`${label} spatial authority must be emitted by its authoritative being`);
  }
}

function validateAgentSpatialForRegion(
  state: ProjectedWorldState,
  regionId: string,
  spatial: AgentSpatialSnapshot,
  label: string,
): void {
  const region = state.regions.get(regionId)?.value;
  const regionSpatial = region?.spatial;
  if (
    region === undefined
    || region.name !== regionId
    || spatial.region_id !== regionId
    || regionSpatial === undefined
    || regionSpatial.map_id !== spatial.map_id
    || regionSpatial.layout_fingerprint !== spatial.layout_fingerprint
  ) {
    throw new Error(`${label} spatial authority does not match the projected regional map`);
  }
  if (
    spatial.at_landmark !== null
    && !regionSpatial.landmarks.some((landmark) => landmark.id === spatial.at_landmark)
  ) {
    throw new Error(`${label} spatial authority names an unknown map landmark`);
  }
}

function validateHomeSpatialForRegion(
  state: ProjectedWorldState,
  regionId: string,
  spatial: HomeSpatialSnapshot,
  label: string,
): void {
  const region = state.regions.get(regionId)?.value;
  const regionSpatial = region?.spatial;
  if (
    region === undefined
    || region.name !== regionId
    || spatial.region_id !== regionId
    || regionSpatial === undefined
    || regionSpatial.map_id !== spatial.map_id
  ) {
    throw new Error(`${label} home spatial authority does not match the projected regional map`);
  }
}

function removeMatingProposal<K extends "mating_rejected" | "mating_proposal_invalidated" | "mating_proposal_timeout">(
  state: ProjectedWorldState,
  payload: PresentedPayloadByType[K],
  cursor: number,
): ProjectionResult {
  const draft = new ProjectionDraft(state);
  draft.removeProposal(payload.initiator_id, payload.target_id);
  draft.markUnresolved("agents", payload.initiator_id, ["energy", "materials"]);
  return draft.finish(cursor);
}

class ProjectionDraft {
  private agents: ReadonlyMap<string, PresentedRecord<AgentSnapshot>>;
  private regions: ReadonlyMap<string, PresentedRecord<RegionSnapshot>>;
  private homes: ReadonlyMap<string, PresentedRecord<HomeSnapshot>>;
  private ruins: ReadonlyMap<string, PresentedRecord<HomeSnapshot>>;
  private proposals: readonly PendingProposalSnapshot[];
  private readonly applied: string[] = [];
  private readonly unresolved: string[] = [];

  constructor(private readonly source: ProjectedWorldState) {
    this.agents = source.agents;
    this.regions = source.regions;
    this.homes = source.homes;
    this.ruins = source.ruins;
    this.proposals = source.pendingProposals;
  }

  patchAgent(id: string, patch: Partial<AgentSnapshot>, fields: readonly string[]): void {
    this.agents = this.patchMap(this.agents, "agents", id, patch, fields);
  }

  patchRegion(id: string, patch: Partial<RegionSnapshot>, fields: readonly string[]): void {
    this.regions = this.patchMap(this.regions, "regions", id, patch, fields);
  }

  patchHome(id: string, patch: Partial<HomeSnapshot>, fields: readonly string[]): void {
    this.homes = this.patchMap(this.homes, "homes", id, patch, fields);
  }

  patchRuin(id: string, patch: Partial<HomeSnapshot>, fields: readonly string[]): void {
    this.ruins = this.patchMap(this.ruins, "ruins", id, patch, fields);
  }

  introduceAgent(id: string, value: Partial<AgentSnapshot>, fields: readonly string[], unresolved: readonly string[]): void {
    const next = new Map(this.agents);
    next.set(id, partialRecord(value));
    this.agents = next;
    this.applied.push(...fields.map((field) => `agents.${id}.${field}`));
    this.unresolved.push(...unresolved.map((field) => `agents.${id}.${field}`));
  }

  introduceHome(id: string, value: Partial<HomeSnapshot>, fields: readonly string[], unresolved: readonly string[]): void {
    const next = new Map(this.homes);
    next.set(id, partialRecord(value));
    this.homes = next;
    this.applied.push(...fields.map((field) => `homes.${id}.${field}`));
    this.unresolved.push(...unresolved.map((field) => `homes.${id}.${field}`));
  }

  removeAgent(id: string): void {
    if (!this.agents.has(id)) { this.unresolved.push(`agents.${id}`); return; }
    const next = new Map(this.agents); next.delete(id); this.agents = next; this.applied.push(`agents.${id}`);
  }

  collapseHome(id: string, patch: Partial<HomeSnapshot>): void {
    const prior = this.homes.get(id);
    if (prior) {
      const nextHomes = new Map(this.homes); nextHomes.delete(id); this.homes = nextHomes; this.applied.push(`homes.${id}`);
    }
    const value = { ...(prior?.value ?? {}), ...clonePartial(patch) };
    const nextRuins = new Map(this.ruins); nextRuins.set(id, partialRecord(value)); this.ruins = nextRuins;
    const fields = ["owner_id", "region", "integrity", "status", "ruined_at", "remnant_materials", "stakeholders", "vault_materials", "breachers", "is_hoarding"];
    this.applied.push(...fields.map((field) => `ruins.${id}.${field}`));
    this.unresolved.push(`ruins.${id}.max_integrity`);
    if (prior?.completeness !== "exact") {
      for (const field of ["built_at", "last_upkeep_at"] as const) {
        if (!(field in (prior?.value ?? {}))) this.unresolved.push(`ruins.${id}.${field}`);
      }
    }
    this.unresolved.push(`ruins.${id}.last_integrity_at`);
  }

  removeProposal(initiator: string, target: string): void {
    const index = this.proposals.findIndex((proposal) => proposal.initiator_id === initiator && proposal.target_id === target);
    if (index < 0) { this.unresolved.push(`pendingProposals.${initiator}->${target}`); return; }
    this.proposals = this.proposals.filter((_, proposalIndex) => proposalIndex !== index);
    this.applied.push(`pendingProposals.${initiator}->${target}`);
  }

  upsertProposal(proposal: PendingProposalSnapshot): void {
    const key = `${proposal.initiator_id}->${proposal.target_id}`;
    this.proposals = [
      ...this.proposals.filter((current) => current.initiator_id !== proposal.initiator_id || current.target_id !== proposal.target_id),
      { ...proposal, resources: { ...proposal.resources } },
    ].sort(compareProposal);
    this.applied.push(
      `pendingProposals.${key}.initiator_id`,
      `pendingProposals.${key}.target_id`,
      `pendingProposals.${key}.resources`,
    );
  }

  markProposalTimestampUnresolved(initiator: string, target: string): void {
    this.unresolved.push(`pendingProposals.${initiator}->${target}.timestamp`);
  }

  markUnresolved(collection: string, id: string, fields: readonly string[]): void {
    this.unresolved.push(...fields.map((field) => `${collection}.${id}.${field}`));
  }

  markUnresolvedPaths(paths: readonly string[]): void {
    this.unresolved.push(...paths);
  }

  finish(cursor: number): ProjectionResult {
    return {
      state: {
        exactBase: this.source.exactBase,
        projectedThroughCursor: cursor,
        agents: this.agents,
        regions: this.regions,
        homes: this.homes,
        ruins: this.ruins,
        pendingProposals: this.proposals,
      },
      appliedFields: unique(this.applied),
      unresolvedFields: unique(this.unresolved),
    };
  }

  private patchMap<T>(
    map: ReadonlyMap<string, PresentedRecord<T>>,
    collection: string,
    id: string,
    patch: Partial<T>,
    fields: readonly string[],
  ): ReadonlyMap<string, PresentedRecord<T>> {
    const current = map.get(id);
    if (!current) {
      this.unresolved.push(...fields.map((field) => `${collection}.${id}.${field}`));
      return map;
    }
    const next = new Map(map);
    next.set(id, { completeness: current.completeness, value: clonePartial({ ...current.value, ...patch }) });
    this.applied.push(...fields.map((field) => `${collection}.${id}.${field}`));
    return next;
  }
}

function exactMap<T>(values: readonly T[], key: (value: T) => string): ReadonlyMap<string, PresentedRecord<T>> {
  return new Map(values.map((value) => [key(value), { completeness: "exact" as const, value }]));
}

function partialRecord<T>(value: Partial<T>): PresentedRecord<T> {
  return { completeness: "projected-partial", value: clonePartial(value) };
}

function clonePartial<T>(value: Partial<T>): Readonly<Partial<T>> {
  return structuredClone(value);
}

function compareProposal(left: PendingProposalSnapshot, right: PendingProposalSnapshot): number {
  return left.initiator_id.localeCompare(right.initiator_id) || left.target_id.localeCompare(right.target_id);
}

function deriveAgentHoarding(
  thresholds: PresentedHoardThresholds | undefined,
  energy: number,
  materials: number,
): boolean | undefined {
  if (!thresholds) return undefined;
  return energy >= thresholds.hoarding_energy_threshold
    || materials >= thresholds.hoarding_materials_threshold;
}

function deriveHomeHoarding(
  thresholds: PresentedHoardThresholds | undefined,
  vaultMaterials: number,
): boolean | undefined {
  if (!thresholds) return undefined;
  return vaultMaterials >= thresholds.hoarding_materials_threshold;
}

function freezeHoardThresholds(
  thresholds: PresentedHoardThresholds | undefined,
): PresentedHoardThresholds | undefined {
  if (!thresholds) return undefined;
  const energy = thresholds.hoarding_energy_threshold;
  const materials = thresholds.hoarding_materials_threshold;
  if (!Number.isFinite(energy) || energy < 0) throw new RangeError("hoarding_energy_threshold must be finite and non-negative");
  if (!Number.isFinite(materials) || materials < 0) throw new RangeError("hoarding_materials_threshold must be finite and non-negative");
  return Object.freeze({
    hoarding_energy_threshold: energy,
    hoarding_materials_threshold: materials,
  });
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)];
}
