import type {
  ReplayHomeState,
  ReplayMode,
  ReplayState,
  ReplayStatus,
} from "./replayReducer";
import type { ReplayRestoreMetadata } from "./replayRestore";
import type {
  ReplaySessionCheckpointSelector,
  ReplaySessionState,
} from "./replaySession";
import type {
  AgentSnapshot,
  HomeSnapshot,
  PendingProposalSnapshot,
  RegionPressureHighWater,
  RegionSnapshot,
  WorldSnapshot,
} from "./schemas";

export interface ReplayRenderSnapshot {
  snapshot: WorldSnapshot;
  metadata: ReplayRenderSnapshotMetadata;
}

export interface ReplayRenderSnapshotMetadata {
  sourceIdentifier: "replay-session";
  selector: ReplaySessionCheckpointSelector;
  checkpointIndex: number;
  checkpointLineNumber: number | null;
  checkpointCursor: number;
  checkpointWorldTime: number;
  checkpointReason: string;
  checkpointRunId: string;
  renderedCursor: number;
  renderedWorldTime: number;
  replayMode: ReplayMode;
  replayStatus: ReplayStatus;
  checkpointStateExact: boolean;
  finalStateExact: boolean;
  eventOverlayApplied: boolean;
  appliedEventCount: number;
  appliedCursors: number[];
  skippedBeforeCheckpointCount: number;
  stopReason: ReplayRestoreMetadata["stopReason"];
  stoppedBeforeCursor: number | null;
  nextExpectedCursor: number;
  warningCount: number;
  gapCount: number;
  synthesizedHomeIds: string[];
  unrenderedAgentIds: string[];
  unrenderedHomeIds: string[];
}

export function adaptReplaySessionToRenderSnapshot(
  sessionState: ReplaySessionState,
): ReplayRenderSnapshot | null {
  if (sessionState.status !== "ready") {
    return null;
  }

  const checkpoint = sessionState.state.baseSnapshot;
  if (!checkpoint) {
    return null;
  }

  const snapshot = cloneWorldSnapshot(checkpoint);
  const synthesizedHomeIds: string[] = [];
  const unrenderedHomeIds: string[] = [];
  const unrenderedAgentIds = collectUnrenderedAgentIds(sessionState.state);
  const regionNames = new Set(snapshot.regions.map((region) => region.name));
  const overlayWorldTime = maxFiniteOverlayTimestamp(sessionState.state);
  const renderedWorldTime =
    overlayWorldTime === null
      ? checkpoint.world_time
      : Math.max(checkpoint.world_time, overlayWorldTime);
  const renderedCursor = sessionState.state.latestCursor ?? checkpoint.event_cursor;

  snapshot.event_cursor = renderedCursor;
  snapshot.world_time = renderedWorldTime;

  if (sessionState.state.appliedCursors.length > 0) {
    unrenderedAgentIds.push(
      ...applyAgentOverlays(snapshot, sessionState.state, regionNames),
    );
    const homeOverlayResult = applyHomeOverlays(
      snapshot,
      sessionState.state,
      regionNames,
    );
    synthesizedHomeIds.push(...homeOverlayResult.synthesizedHomeIds);
    unrenderedHomeIds.push(...homeOverlayResult.unrenderedHomeIds);
  }

  return {
    snapshot,
    metadata: {
      sourceIdentifier: "replay-session",
      selector: copySelector(sessionState.selector),
      checkpointIndex: sessionState.metadata.checkpointIndex,
      checkpointLineNumber: sessionState.metadata.lineNumber,
      checkpointCursor: sessionState.metadata.eventCursor,
      checkpointWorldTime: sessionState.metadata.worldTime,
      checkpointReason: sessionState.metadata.reason,
      checkpointRunId: sessionState.metadata.runId,
      renderedCursor,
      renderedWorldTime,
      replayMode: sessionState.state.mode,
      replayStatus: sessionState.state.status,
      checkpointStateExact: sessionState.metadata.checkpointStateExact,
      finalStateExact: sessionState.metadata.finalStateExact,
      eventOverlayApplied: sessionState.metadata.eventOverlayApplied,
      appliedEventCount: sessionState.metadata.appliedEventCount,
      appliedCursors: [...sessionState.state.appliedCursors],
      skippedBeforeCheckpointCount:
        sessionState.metadata.skippedBeforeCheckpointCount,
      stopReason: sessionState.metadata.stopReason,
      stoppedBeforeCursor: sessionState.metadata.stoppedBeforeCursor,
      nextExpectedCursor: sessionState.metadata.nextExpectedCursor,
      warningCount: sessionState.state.warnings.length,
      gapCount: sessionState.state.gaps.length,
      synthesizedHomeIds: sortedUnique(synthesizedHomeIds),
      unrenderedAgentIds: sortedUnique(unrenderedAgentIds),
      unrenderedHomeIds: sortedUnique(unrenderedHomeIds),
    },
  };
}

function applyAgentOverlays(
  snapshot: WorldSnapshot,
  state: ReplayState,
  regionNames: ReadonlySet<string>,
): string[] {
  const unrenderedAgentIds: string[] = [];

  for (const agent of snapshot.agents) {
    const position = state.positionsByAgentId.get(agent.id);
    if (position?.region !== null && position?.region !== undefined) {
      if (position.source === "event" && !regionNames.has(position.region)) {
        unrenderedAgentIds.push(agent.id);
      } else {
        agent.position = position.region;
      }
    }

    const home = state.homesByAgentId.get(agent.id);
    if (home) {
      agent.home_id = home.homeId;
    }

    const status = state.statusesByAgentId.get(agent.id);
    if (status) {
      agent.status = status.status;
      if (
        status.status === "dead" &&
        agent.died_at === null &&
        isFiniteNumber(status.timestamp)
      ) {
        agent.died_at = status.timestamp;
      }
    }
  }

  return unrenderedAgentIds;
}

function applyHomeOverlays(
  snapshot: WorldSnapshot,
  state: ReplayState,
  regionNames: ReadonlySet<string>,
): {
  synthesizedHomeIds: string[];
  unrenderedHomeIds: string[];
} {
  const synthesizedHomeIds: string[] = [];
  const unrenderedHomeIds: string[] = [];
  const existingHomeIds = new Set<string>();
  const homes: HomeSnapshot[] = [];
  const ruins: HomeSnapshot[] = [];

  for (const home of [...snapshot.homes, ...snapshot.ruins]) {
    existingHomeIds.add(home.home_id);
    const overlay = state.homesById.get(home.home_id);
    const rendered = applyHomeOverlay(home, overlay, regionNames);
    if (
      overlay?.source === "event" &&
      overlay.region !== null &&
      !regionNames.has(overlay.region)
    ) {
      unrenderedHomeIds.push(home.home_id);
    }
    if (rendered.status === "ruin") {
      ruins.push(rendered);
    } else {
      homes.push(rendered);
    }
  }

  for (const [homeId, overlay] of state.homesById) {
    if (existingHomeIds.has(homeId)) {
      continue;
    }

    const synthesized = synthesizeHomeSnapshot(overlay, regionNames);
    if (synthesized) {
      synthesizedHomeIds.push(homeId);
      if (synthesized.status === "ruin") {
        ruins.push(synthesized);
      } else {
        homes.push(synthesized);
      }
    } else {
      unrenderedHomeIds.push(homeId);
    }
  }

  snapshot.homes = homes;
  snapshot.ruins = ruins;

  return { synthesizedHomeIds, unrenderedHomeIds };
}

function applyHomeOverlay(
  home: HomeSnapshot,
  overlay: ReplayHomeState | undefined,
  regionNames: ReadonlySet<string>,
): HomeSnapshot {
  if (!overlay) {
    return home;
  }

  if (overlay.region !== null && regionNames.has(overlay.region)) {
    home.region = overlay.region;
  }
  if (overlay.status !== "unknown") {
    home.status = overlay.status;
    if (overlay.status === "ruin") {
      if (home.ruined_at === null && isFiniteNumber(overlay.timestamp)) {
        home.ruined_at = overlay.timestamp;
      }
    } else {
      home.ruined_at = null;
    }
  }
  if (overlay.ownerId !== null) {
    home.owner_id = overlay.ownerId;
  }
  home.stakeholders = [...overlay.stakeholderIds];
  if (overlay.isHoarding !== null) {
    home.is_hoarding = overlay.isHoarding;
  }

  return home;
}

function synthesizeHomeSnapshot(
  overlay: ReplayHomeState,
  regionNames: ReadonlySet<string>,
): HomeSnapshot | null {
  if (
    overlay.region === null ||
    !regionNames.has(overlay.region) ||
    overlay.status === "unknown" ||
    overlay.ownerId === null
  ) {
    return null;
  }

  const timestamp = isFiniteNumber(overlay.timestamp) ? overlay.timestamp : 0;
  const stakeholders = addUnique(overlay.stakeholderIds, overlay.ownerId);

  return {
    home_id: overlay.homeId,
    owner_id: overlay.ownerId,
    region: overlay.region,
    integrity: overlay.status === "ruin" ? 0 : 1,
    max_integrity: 1,
    built_at: timestamp,
    last_upkeep_at: timestamp,
    last_integrity_at: timestamp,
    stakeholders,
    vault_materials: 0,
    status: overlay.status,
    ruined_at: overlay.status === "ruin" ? timestamp : null,
    remnant_materials: 0,
    breachers: [],
    is_hoarding: overlay.isHoarding ?? false,
  };
}

function collectUnrenderedAgentIds(state: ReplayState): string[] {
  const existingAgentIds = new Set(state.baseSnapshot?.agents.map((agent) => agent.id));
  const overlayAgentIds = new Set<string>();

  for (const overlay of state.positionsByAgentId.values()) {
    if (overlay.source === "event") {
      overlayAgentIds.add(overlay.agentId);
    }
  }
  for (const overlay of state.homesByAgentId.values()) {
    if (overlay.source === "event") {
      overlayAgentIds.add(overlay.agentId);
    }
  }
  for (const overlay of state.statusesByAgentId.values()) {
    if (overlay.source === "event") {
      overlayAgentIds.add(overlay.agentId);
    }
  }
  for (const overlay of state.homesById.values()) {
    if (overlay.source !== "event") {
      continue;
    }
    if (overlay.ownerId) {
      overlayAgentIds.add(overlay.ownerId);
    }
    for (const stakeholderId of overlay.stakeholderIds) {
      overlayAgentIds.add(stakeholderId);
    }
  }

  return [...overlayAgentIds]
    .filter((agentId) => !existingAgentIds.has(agentId))
    .sort();
}

function maxFiniteOverlayTimestamp(state: ReplayState): number | null {
  let maxTimestamp: number | null = null;

  for (const overlay of [
    ...state.positionsByAgentId.values(),
    ...state.homesByAgentId.values(),
    ...state.statusesByAgentId.values(),
    ...state.homesById.values(),
  ]) {
    if (overlay.source !== "event" || !isFiniteNumber(overlay.timestamp)) {
      continue;
    }
    maxTimestamp =
      maxTimestamp === null
        ? overlay.timestamp
        : Math.max(maxTimestamp, overlay.timestamp);
  }

  return maxTimestamp;
}

/**
 * Copy a checkpoint snapshot so the overlay pass can mutate it in place.
 *
 * Spreads first and then replaces every mutable member, so a snapshot field
 * added later survives the clone by construction rather than by someone
 * remembering to list it here. The enumerated form this replaced silently
 * dropped `region_pressure` and `seed_persona`: losing the former makes the
 * frontend fall back to deriving pressure from live counts, which is not the
 * monotone high-water the run recorded, and so draws a different map than the
 * run originally showed.
 */
function cloneWorldSnapshot(snapshot: WorldSnapshot): WorldSnapshot {
  return {
    ...snapshot,
    agents: snapshot.agents.map(cloneAgentSnapshot),
    regions: snapshot.regions.map(cloneRegionSnapshot),
    homes: snapshot.homes.map(cloneHomeSnapshot),
    ruins: snapshot.ruins.map(cloneHomeSnapshot),
    pending_proposals: snapshot.pending_proposals.map(clonePendingProposal),
    ...(snapshot.region_pressure === undefined
      ? {}
      : { region_pressure: snapshot.region_pressure.map(cloneRegionPressure) }),
  };
}

function cloneRegionPressure(
  pressure: RegionPressureHighWater,
): RegionPressureHighWater {
  return { ...pressure };
}

function cloneAgentSnapshot(agent: AgentSnapshot): AgentSnapshot {
  return { ...agent };
}

function cloneRegionSnapshot(region: RegionSnapshot): RegionSnapshot {
  return {
    ...region,
    connections: [...region.connections],
  };
}

function cloneHomeSnapshot(home: HomeSnapshot): HomeSnapshot {
  return {
    ...home,
    stakeholders: [...home.stakeholders],
    breachers: [...home.breachers],
  };
}

function clonePendingProposal(
  proposal: PendingProposalSnapshot,
): PendingProposalSnapshot {
  return {
    ...proposal,
    resources: { ...proposal.resources },
  };
}

function copySelector(
  selector: ReplaySessionCheckpointSelector,
): ReplaySessionCheckpointSelector {
  return selector.index !== undefined
    ? { index: selector.index }
    : { lineNumber: selector.lineNumber };
}

function addUnique(items: readonly string[], item: string): string[] {
  return items.includes(item) ? [...items] : [...items, item];
}

function sortedUnique(items: readonly string[]): string[] {
  return [...new Set(items)].sort();
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
