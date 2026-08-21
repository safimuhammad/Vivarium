import type {
  AgentStatus,
  EventEnvelopeEntry,
  HomeStatus,
  WorldSnapshot,
} from "./schemas";

export type ReplayMode = "empty" | "checkpoint" | "event-overlay";
export type ReplayStatus = "empty" | "exact" | "approximate" | "gap";
export type ReplayValueSource = "snapshot" | "event";

export type ReplayWarningCode =
  | "event_overlay_approximate"
  | "events_without_checkpoint"
  | "cursor_gap"
  | "duplicate_cursor"
  | "stale_cursor"
  | "snapshot_after_unloaded"
  | "missing_agent_id"
  | "missing_home_id"
  | "missing_region";

export interface ReplayWarning {
  code: ReplayWarningCode;
  message: string;
  cursor?: number;
  eventType?: string;
}

export interface ReplayGap {
  afterCursor: number;
  beforeCursor: number;
  missingCount: number;
}

export interface ReplayAgentPosition {
  agentId: string;
  region: string | null;
  fromRegion: string | null;
  toRegion: string | null;
  inTransit: boolean;
  cursor: number;
  timestamp: number | null;
  source: ReplayValueSource;
  exact: boolean;
}

export interface ReplayAgentHome {
  agentId: string;
  homeId: string | null;
  cursor: number;
  timestamp: number | null;
  source: ReplayValueSource;
  exact: boolean;
}

export interface ReplayAgentStatus {
  agentId: string;
  status: AgentStatus;
  cursor: number;
  timestamp: number | null;
  source: ReplayValueSource;
  exact: boolean;
}

export interface ReplayHomeState {
  homeId: string;
  region: string | null;
  status: HomeStatus | "unknown";
  ownerId: string | null;
  stakeholderIds: string[];
  cursor: number;
  timestamp: number | null;
  source: ReplayValueSource;
  exact: boolean;
  isHoarding: boolean | null;
}

export interface ReplayState {
  mode: ReplayMode;
  status: ReplayStatus;
  baseSnapshot: WorldSnapshot | null;
  latestSnapshot: WorldSnapshot | null;
  baseCursor: number | null;
  latestCursor: number | null;
  appliedCursors: number[];
  positionsByAgentId: ReadonlyMap<string, ReplayAgentPosition>;
  homesByAgentId: ReadonlyMap<string, ReplayAgentHome>;
  statusesByAgentId: ReadonlyMap<string, ReplayAgentStatus>;
  homesById: ReadonlyMap<string, ReplayHomeState>;
  gaps: ReplayGap[];
  warnings: ReplayWarning[];
}

interface ReplayDraft {
  positionsByAgentId: Map<string, ReplayAgentPosition>;
  homesByAgentId: Map<string, ReplayAgentHome>;
  statusesByAgentId: Map<string, ReplayAgentStatus>;
  homesById: Map<string, ReplayHomeState>;
  warnings: ReplayWarning[];
}

const SOURCELESS_EVENT_SOURCES = new Set(["system", "world"]);

export function createReplayState(
  checkpoint: WorldSnapshot | null = null,
): ReplayState {
  const state: ReplayState = {
    mode: "empty",
    status: "empty",
    baseSnapshot: null,
    latestSnapshot: null,
    baseCursor: null,
    latestCursor: null,
    appliedCursors: [],
    positionsByAgentId: new Map(),
    homesByAgentId: new Map(),
    statusesByAgentId: new Map(),
    homesById: new Map(),
    gaps: [],
    warnings: [],
  };

  return checkpoint ? applySnapshotCheckpoint(state, checkpoint) : state;
}

export function applySnapshotCheckpoint(
  state: ReplayState,
  snapshot: WorldSnapshot,
): ReplayState {
  const positionsByAgentId = new Map<string, ReplayAgentPosition>();
  const homesByAgentId = new Map<string, ReplayAgentHome>();
  const statusesByAgentId = new Map<string, ReplayAgentStatus>();
  const homesById = new Map<string, ReplayHomeState>();

  for (const agent of snapshot.agents) {
    positionsByAgentId.set(agent.id, {
      agentId: agent.id,
      region: agent.position,
      fromRegion: null,
      toRegion: null,
      inTransit: false,
      cursor: snapshot.event_cursor,
      timestamp: snapshot.world_time,
      source: "snapshot",
      exact: true,
    });
    homesByAgentId.set(agent.id, {
      agentId: agent.id,
      homeId: agent.home_id,
      cursor: snapshot.event_cursor,
      timestamp: snapshot.world_time,
      source: "snapshot",
      exact: true,
    });
    statusesByAgentId.set(agent.id, {
      agentId: agent.id,
      status: agent.status,
      cursor: snapshot.event_cursor,
      timestamp: snapshot.world_time,
      source: "snapshot",
      exact: true,
    });
  }

  for (const home of [...snapshot.homes, ...snapshot.ruins]) {
    homesById.set(home.home_id, {
      homeId: home.home_id,
      region: home.region,
      status: home.status,
      ownerId: home.owner_id,
      stakeholderIds: [...home.stakeholders],
      cursor: snapshot.event_cursor,
      timestamp: snapshot.world_time,
      source: "snapshot",
      exact: true,
      isHoarding: home.is_hoarding,
    });
  }

  return {
    ...state,
    mode: "checkpoint",
    status: "exact",
    baseSnapshot: snapshot,
    latestSnapshot: snapshot,
    baseCursor: snapshot.event_cursor,
    latestCursor: snapshot.event_cursor,
    appliedCursors: [],
    positionsByAgentId,
    homesByAgentId,
    statusesByAgentId,
    homesById,
    gaps: [],
    warnings: [],
  };
}

export function applyReplayEntries(
  state: ReplayState,
  entries: readonly EventEnvelopeEntry[],
): ReplayState {
  return entries.reduce(applyEventEntry, state);
}

export function applyEventEntry(
  state: ReplayState,
  entry: EventEnvelopeEntry,
): ReplayState {
  if (state.appliedCursors.includes(entry.cursor)) {
    return appendStateWarning(state, {
      code: "duplicate_cursor",
      cursor: entry.cursor,
      eventType: entry.event.type,
      message: `Replay event cursor ${entry.cursor} was already applied.`,
    });
  }

  if (state.latestCursor !== null && entry.cursor <= state.latestCursor) {
    return appendStateWarning(state, {
      code: "stale_cursor",
      cursor: entry.cursor,
      eventType: entry.event.type,
      message: `Replay event cursor ${entry.cursor} is not newer than cursor ${state.latestCursor}.`,
    });
  }

  const gaps = [...state.gaps];
  const warnings = [...state.warnings];

  if (state.latestCursor !== null && entry.cursor > state.latestCursor + 1) {
    const gap = {
      afterCursor: state.latestCursor,
      beforeCursor: entry.cursor,
      missingCount: entry.cursor - state.latestCursor - 1,
    };
    gaps.push(gap);
    warnings.push({
      code: "cursor_gap",
      cursor: entry.cursor,
      eventType: entry.event.type,
      message: `Replay skipped ${gap.missingCount} event cursor(s) between ${gap.afterCursor} and ${gap.beforeCursor}.`,
    });
  }

  if (entry.snapshot_after) {
    warnings.push({
      code: "snapshot_after_unloaded",
      cursor: entry.cursor,
      eventType: entry.event.type,
      message:
        "This event references a snapshot checkpoint; apply the checkpoint for exact state.",
    });
  }

  if (state.baseSnapshot) {
    pushSegmentWarning(warnings, {
      code: "event_overlay_approximate",
      cursor: entry.cursor,
      eventType: entry.event.type,
      message:
        "Event replay after a checkpoint is approximate; exact world state comes from snapshots.",
    });
  } else {
    pushSegmentWarning(warnings, {
      code: "events_without_checkpoint",
      cursor: entry.cursor,
      eventType: entry.event.type,
      message:
        "Events are being replayed without a snapshot checkpoint; only approximate hints are available.",
    });
  }

  const draft: ReplayDraft = {
    positionsByAgentId: new Map(state.positionsByAgentId),
    homesByAgentId: new Map(state.homesByAgentId),
    statusesByAgentId: new Map(state.statusesByAgentId),
    homesById: new Map(state.homesById),
    warnings,
  };

  applyEventOverlay(draft, entry);

  return {
    ...state,
    mode: "event-overlay",
    status: gaps.length > 0 ? "gap" : "approximate",
    latestCursor: entry.cursor,
    appliedCursors: [...state.appliedCursors, entry.cursor],
    positionsByAgentId: draft.positionsByAgentId,
    homesByAgentId: draft.homesByAgentId,
    statusesByAgentId: draft.statusesByAgentId,
    homesById: draft.homesById,
    gaps,
    warnings: draft.warnings,
  };
}

export function replayHasExactWorldState(state: ReplayState): boolean {
  return (
    state.status === "exact" &&
    state.latestSnapshot !== null &&
    state.latestCursor === state.latestSnapshot.event_cursor &&
    state.appliedCursors.length === 0
  );
}

function applyEventOverlay(draft: ReplayDraft, entry: EventEnvelopeEntry): void {
  switch (entry.event.type) {
    case "agent_left_region":
      applyAgentLeftRegion(draft, entry);
      return;
    case "agent_entered_region":
      applyAgentEnteredRegion(draft, entry);
      return;
    case "agent_paralyzed":
      setAgentStatus(draft, entry, agentParalyzedSubject(entry), "paralyzed");
      return;
    case "agent_recovered":
      setAgentStatus(draft, entry, agentRecoveredSubject(entry), "alive");
      return;
    case "agent_died":
      setAgentStatus(draft, entry, agentDiedSubject(entry), "dead");
      return;
    case "agent_born":
      applyAgentBorn(draft, entry);
      return;
    case "home_built":
      applyHomeBuilt(draft, entry);
      return;
    case "home_joined":
      applyHomeJoined(draft, entry);
      return;
    case "home_left":
      applyHomeLeft(draft, entry);
      return;
    case "home_started_hoarding":
      applyHomeStartedHoarding(draft, entry);
      return;
    case "home_collapsed":
      applyHomeCollapsed(draft, entry);
      return;
    case "home_colonized":
      applyHomeColonized(draft, entry);
      return;
    default:
      return;
  }
}

function applyAgentLeftRegion(
  draft: ReplayDraft,
  entry: EventEnvelopeEntry,
): void {
  const agentId = eventActorId(entry);
  if (!agentId) {
    pushMissingAgentWarning(draft, entry);
    return;
  }

  const previous = draft.positionsByAgentId.get(agentId);
  const fromRegion =
    payloadString(entry, "from_region") ?? entry.event.region ?? previous?.region ?? null;
  const toRegion = payloadString(entry, "to_region") ?? null;

  draft.positionsByAgentId.set(agentId, {
    agentId,
    region: toRegion ?? previous?.region ?? fromRegion,
    fromRegion,
    toRegion,
    inTransit: true,
    cursor: entry.cursor,
    timestamp: entry.event.timestamp,
    source: "event",
    exact: false,
  });
}

function applyAgentEnteredRegion(
  draft: ReplayDraft,
  entry: EventEnvelopeEntry,
): void {
  const agentId = eventActorId(entry);
  if (!agentId) {
    pushMissingAgentWarning(draft, entry);
    return;
  }

  const previous = draft.positionsByAgentId.get(agentId);
  const toRegion =
    payloadString(entry, "to_region") ??
    eventRegion(entry) ??
    previous?.toRegion ??
    null;
  if (!toRegion) {
    pushMissingRegionWarning(draft, entry);
  }

  draft.positionsByAgentId.set(agentId, {
    agentId,
    region: toRegion ?? previous?.region ?? null,
    fromRegion: payloadString(entry, "from_region") ?? previous?.fromRegion ?? null,
    toRegion,
    inTransit: false,
    cursor: entry.cursor,
    timestamp: entry.event.timestamp,
    source: "event",
    exact: false,
  });
}

function applyAgentBorn(draft: ReplayDraft, entry: EventEnvelopeEntry): void {
  const agentId =
    payloadString(entry, "child_id", "agent_id") ??
    eventSourceAgent(entry) ??
    resolvedString(entry, "actor_id");
  if (!agentId) {
    pushMissingAgentWarning(draft, entry);
    return;
  }

  setAgentStatus(draft, entry, agentId, "alive");

  const region = eventRegion(entry);
  if (region) {
    draft.positionsByAgentId.set(agentId, {
      agentId,
      region,
      fromRegion: null,
      toRegion: region,
      inTransit: false,
      cursor: entry.cursor,
      timestamp: entry.event.timestamp,
      source: "event",
      exact: false,
    });
  }
}

function applyHomeBuilt(draft: ReplayDraft, entry: EventEnvelopeEntry): void {
  const homeId = eventHomeId(entry);
  const ownerId =
    payloadString(entry, "owner_id", "builder_id") ?? eventActorId(entry) ?? null;
  if (!homeId) {
    pushMissingHomeWarning(draft, entry);
    return;
  }

  upsertHomeState(draft, entry, homeId, {
    region: eventRegion(entry),
    status: "standing",
    ownerId,
    stakeholderIds: ownerId ? [ownerId] : undefined,
  });

  if (ownerId) {
    draft.homesByAgentId.set(ownerId, {
      agentId: ownerId,
      homeId,
      cursor: entry.cursor,
      timestamp: entry.event.timestamp,
      source: "event",
      exact: false,
    });
  }
}

function applyHomeJoined(draft: ReplayDraft, entry: EventEnvelopeEntry): void {
  const agentId = payloadString(entry, "agent_id", "stakeholder_id") ?? eventActorId(entry);
  const homeId = eventHomeId(entry);
  if (!agentId) {
    pushMissingAgentWarning(draft, entry);
    return;
  }
  if (!homeId) {
    pushMissingHomeWarning(draft, entry);
    return;
  }

  draft.homesByAgentId.set(agentId, {
    agentId,
    homeId,
    cursor: entry.cursor,
    timestamp: entry.event.timestamp,
    source: "event",
    exact: false,
  });

  const previous = draft.homesById.get(homeId);
  upsertHomeState(draft, entry, homeId, {
    region: eventRegion(entry),
    stakeholderIds: addUnique(previous?.stakeholderIds ?? [], agentId),
  });
}

function applyHomeLeft(draft: ReplayDraft, entry: EventEnvelopeEntry): void {
  const agentId = payloadString(entry, "agent_id", "stakeholder_id") ?? eventActorId(entry);
  if (!agentId) {
    pushMissingAgentWarning(draft, entry);
    return;
  }

  const previousHomeId =
    eventHomeId(entry) ?? draft.homesByAgentId.get(agentId)?.homeId ?? null;

  draft.homesByAgentId.set(agentId, {
    agentId,
    homeId: null,
    cursor: entry.cursor,
    timestamp: entry.event.timestamp,
    source: "event",
    exact: false,
  });

  if (previousHomeId) {
    const previous = draft.homesById.get(previousHomeId);
    upsertHomeState(draft, entry, previousHomeId, {
      region: eventRegion(entry),
      stakeholderIds: previous
        ? previous.stakeholderIds.filter((id) => id !== agentId)
        : undefined,
    });
  }
}

function applyHomeStartedHoarding(
  draft: ReplayDraft,
  entry: EventEnvelopeEntry,
): void {
  const homeId = eventHomeId(entry);
  if (!homeId) {
    pushMissingHomeWarning(draft, entry);
    return;
  }

  upsertHomeState(draft, entry, homeId, {
    region: eventRegion(entry),
    isHoarding: true,
  });
}

function applyHomeCollapsed(draft: ReplayDraft, entry: EventEnvelopeEntry): void {
  const homeId = eventHomeId(entry);
  if (!homeId) {
    pushMissingHomeWarning(draft, entry);
    return;
  }

  upsertHomeState(draft, entry, homeId, {
    region: eventRegion(entry),
    status: "ruin",
  });
}

function applyHomeColonized(draft: ReplayDraft, entry: EventEnvelopeEntry): void {
  const homeId = eventHomeId(entry);
  const ownerId =
    payloadString(entry, "new_owner_id", "owner_id", "breacher_id") ??
    eventActorId(entry) ??
    null;
  const stakeholders = payloadStringArray(entry, "new_stakeholders", "stakeholders");
  if (!homeId) {
    pushMissingHomeWarning(draft, entry);
    return;
  }

  upsertHomeState(draft, entry, homeId, {
    region: eventRegion(entry),
    status: "standing",
    ownerId,
    stakeholderIds: stakeholders ?? (ownerId ? [ownerId] : undefined),
  });

  if (ownerId) {
    draft.homesByAgentId.set(ownerId, {
      agentId: ownerId,
      homeId,
      cursor: entry.cursor,
      timestamp: entry.event.timestamp,
      source: "event",
      exact: false,
    });
  }
}

function setAgentStatus(
  draft: ReplayDraft,
  entry: EventEnvelopeEntry,
  agentId: string | undefined,
  status: AgentStatus,
): void {
  if (!agentId) {
    pushMissingAgentWarning(draft, entry);
    return;
  }

  draft.statusesByAgentId.set(agentId, {
    agentId,
    status,
    cursor: entry.cursor,
    timestamp: entry.event.timestamp,
    source: "event",
    exact: false,
  });
}

function upsertHomeState(
  draft: ReplayDraft,
  entry: EventEnvelopeEntry,
  homeId: string,
  patch: Partial<
    Pick<
      ReplayHomeState,
      "region" | "status" | "ownerId" | "stakeholderIds" | "isHoarding"
    >
  >,
): void {
  const previous = draft.homesById.get(homeId);
  draft.homesById.set(homeId, {
    homeId,
    region: patch.region ?? previous?.region ?? null,
    status: patch.status ?? previous?.status ?? "unknown",
    ownerId: patch.ownerId ?? previous?.ownerId ?? null,
    stakeholderIds: patch.stakeholderIds ?? previous?.stakeholderIds ?? [],
    cursor: entry.cursor,
    timestamp: entry.event.timestamp,
    source: "event",
    exact: false,
    isHoarding: patch.isHoarding ?? previous?.isHoarding ?? null,
  });
}

function appendStateWarning(
  state: ReplayState,
  warning: ReplayWarning,
): ReplayState {
  return {
    ...state,
    warnings: [...state.warnings, warning],
  };
}

function pushSegmentWarning(
  warnings: ReplayWarning[],
  warning: ReplayWarning,
): void {
  if (!warnings.some((existing) => existing.code === warning.code)) {
    warnings.push(warning);
  }
}

function pushMissingAgentWarning(
  draft: ReplayDraft,
  entry: EventEnvelopeEntry,
): void {
  draft.warnings.push({
    code: "missing_agent_id",
    cursor: entry.cursor,
    eventType: entry.event.type,
    message: `Replay could not identify an agent for ${entry.event.type}.`,
  });
}

function pushMissingHomeWarning(
  draft: ReplayDraft,
  entry: EventEnvelopeEntry,
): void {
  draft.warnings.push({
    code: "missing_home_id",
    cursor: entry.cursor,
    eventType: entry.event.type,
    message: `Replay could not identify a home for ${entry.event.type}.`,
  });
}

function pushMissingRegionWarning(
  draft: ReplayDraft,
  entry: EventEnvelopeEntry,
): void {
  draft.warnings.push({
    code: "missing_region",
    cursor: entry.cursor,
    eventType: entry.event.type,
    message: `Replay could not identify a region for ${entry.event.type}.`,
  });
}

function agentParalyzedSubject(entry: EventEnvelopeEntry): string | undefined {
  return (
    payloadString(entry, "agent_id", "victim_id") ??
    eventTargetId(entry) ??
    eventSourceAgent(entry)
  );
}

function agentRecoveredSubject(entry: EventEnvelopeEntry): string | undefined {
  return (
    payloadString(entry, "revived_id", "recipient_id", "receiver_id", "agent_id") ??
    eventTargetId(entry)
  );
}

function agentDiedSubject(entry: EventEnvelopeEntry): string | undefined {
  return (
    payloadString(entry, "victim_id", "agent_id") ??
    eventTargetId(entry) ??
    eventSourceAgent(entry)
  );
}

function eventActorId(entry: EventEnvelopeEntry): string | undefined {
  return (
    resolvedString(entry, "actor_id") ??
    payloadString(
      entry,
      "actor_id",
      "agent_id",
      "sender_id",
      "giver_id",
      "builder_id",
      "breacher_id",
      "speaker_id",
      "initiator_id",
      "rejecter_id",
      "acceptor_id",
    ) ??
    eventSourceAgent(entry)
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
    )
  );
}

function eventSourceAgent(entry: EventEnvelopeEntry): string | undefined {
  if (SOURCELESS_EVENT_SOURCES.has(entry.event.source)) {
    return undefined;
  }
  return entry.event.source || undefined;
}

function eventHomeId(entry: EventEnvelopeEntry): string | undefined {
  return (
    resolvedString(entry, "home_id") ??
    payloadString(entry, "home_id", "target_home", "target_home_id")
  );
}

function eventRegion(entry: EventEnvelopeEntry): string | undefined {
  return (
    resolvedString(entry, "region") ??
    entry.event.region ??
    payloadString(entry, "region", "to_region", "from_region")
  );
}

function resolvedString(
  entry: EventEnvelopeEntry,
  key: string,
): string | undefined {
  const value = entry.resolved[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function payloadString(
  entry: EventEnvelopeEntry,
  ...keys: string[]
): string | undefined {
  for (const key of keys) {
    const value = entry.event.payload[key];
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function payloadStringArray(
  entry: EventEnvelopeEntry,
  ...keys: string[]
): string[] | undefined {
  for (const key of keys) {
    const value = entry.event.payload[key];
    if (
      Array.isArray(value) &&
      value.every((item): item is string => typeof item === "string")
    ) {
      return value;
    }
  }
  return undefined;
}

function addUnique(items: string[], item: string): string[] {
  return items.includes(item) ? items : [...items, item];
}
