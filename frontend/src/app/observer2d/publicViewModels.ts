import type { AgentSnapshot, HomeSnapshot, RegionSnapshot } from "../schemas";
import { formatRuinAge } from "./ruinAge";
import { formatPublicNumber } from "./formatPublicNumber";
import type { StoryMoment } from "../../presentation/BeatDirector";
import {
  EVENT_VISUAL_EVENT_TYPES,
  type EventVisualEventType,
} from "../../events/eventVisualCatalog";
import type {
  PresentedObserverFrame,
  PresentedRecord,
  PresentationGap,
} from "../../presentation/contracts";
import {
  selectLivingAtlas,
  selectPresentedChronicle,
  selectPresentedDialogue,
  selectPresentedHud,
  selectPresentedSelection,
  type PresentedChronicleWindow,
  type RedactedUpcomingMoment,
} from "../../presentation/selectors";
import {
  frameEntityIdDenylist,
  momentEntityIdDenylist,
  safePublicCopy,
  safePublicEntityName,
  type EntityIdDenylist,
} from "./publicCopy";

export interface ObserverHudView {
  readonly worldTime: number;
  readonly regionDisplayName: string;
  readonly humanTimeLabel: string;
  readonly livingAgents: number;
  readonly deadAgents: number;
  readonly unresolvedAgentStatuses: number;
  readonly homes: number;
  readonly ruins: number;
  readonly connection: PresentedObserverFrame["transport"]["connection"];
  readonly retryable: boolean;
  readonly presentedCursor: number;
  readonly receivedCursor: number;
  readonly pendingMoments: number;
  readonly backlogState: PresentedObserverFrame["backlog"]["state"];
  readonly backlogLabel: string;
}

export interface ObserverAtlasEdgeView {
  /** Opaque callback/React key. Never render this value. */
  readonly key: string;
  readonly displayName: string;
}

export interface ObserverAtlasRegionView {
  /** Opaque callback/React key. Never render this value. */
  readonly key: string;
  readonly displayName: string;
  readonly description: string;
  readonly connections: readonly ObserverAtlasEdgeView[];
  readonly livingAgents: number;
  readonly unresolvedAgentStatuses: number;
  readonly homes: number;
  readonly ruins: number;
  /** False means numeric counts are presented lower bounds, not exact totals. */
  readonly countsComplete: boolean;
  readonly queuedImportance: Readonly<{ ambient: number; featured: number; drama: number }>;
  readonly active: boolean;
  readonly observed: boolean;
  readonly completeness: "exact" | "projected-partial";
}

export interface ObserverAtlasView {
  /** Opaque state keys used by the shell, not public copy. */
  readonly activeStoryRegionId: string | null;
  readonly observedRegionId: string | null;
  readonly regions: readonly ObserverAtlasRegionView[];
}

export interface DialogueNowView {
  /** Opaque callback key. Never render this value. */
  readonly speakerKey: string;
  readonly speakerName: string;
  /** Opaque callback key. Never render this value. */
  readonly targetKey: string | null;
  readonly targetName: string | null;
  readonly regionName: string | null;
  readonly visibleText: string;
  readonly remote: boolean;
  readonly hold: boolean;
  readonly phase: NonNullable<PresentedObserverFrame["scene"]>["phase"];
  readonly priority: StoryMoment["priority"];
}

export interface PublicFactView {
  readonly label: string;
  readonly value: string;
}

export interface ChronicleMomentRowView {
  /** Opaque callback key. Never render this value. */
  readonly key: string;
  readonly firstCursor: number;
  readonly lastCursor: number;
  readonly priority: StoryMoment["priority"];
  readonly regionName: string | null;
  readonly focusLabel: string;
  readonly timestamp: number;
  readonly title: string;
  readonly summary: string;
  /** Present only for the active Now card. */
  readonly details?: readonly PublicFactView[];
}

export interface ChronicleView {
  readonly now: ChronicleMomentRowView | null;
  readonly previous: readonly ChronicleMomentRowView[];
  /** Exact three-key future disclosure boundary. */
  readonly upcoming: readonly RedactedUpcomingMoment[];
  readonly gaps: readonly PresentationGap[];
}

export type StoryNowView =
  | Readonly<{
      readonly kind: "moment";
      readonly state: "active" | "latest";
      readonly moment: ChronicleMomentRowView;
    }>
  | Readonly<{
      readonly kind: "checkpoint";
      readonly state: "checkpoint";
      readonly regionName: string;
      readonly title: string;
      readonly summary: string;
      readonly segmentIndex: number;
      readonly segmentCount: number;
    }>;

export interface SelectionView {
  readonly kind: "agent" | "home" | "ruin" | "region" | "moment";
  /** Opaque callback key. Never render this value. */
  readonly key: string;
  readonly title: string;
  readonly subtitle: string;
  readonly completeness: "exact" | "projected-partial";
  readonly qualifier: string | null;
  readonly facts: readonly PublicFactView[];
}

export interface ArchiveCheckpointView {
  /** Stable opaque callback key. Never render this value. */
  readonly key: string;
  readonly label: string;
  readonly worldTime: number;
  readonly eventCursor: number;
  readonly reason: string;
  readonly selected: boolean;
}

export type ArchiveCatalogueView =
  | { readonly state: "loading" | "empty"; readonly checkpoints: readonly []; readonly hasMore: false }
  | { readonly state: "error"; readonly checkpoints: readonly []; readonly hasMore: false; readonly message: string }
  | { readonly state: "ready"; readonly checkpoints: readonly ArchiveCheckpointView[]; readonly hasMore: boolean };

export type ArchiveCatalogueProjectionInput =
  | { readonly state: "loading" | "empty" }
  | { readonly state: "error"; readonly message?: string }
  | {
      readonly state: "ready";
      readonly records: readonly {
        /** Stable opaque transport key. */
        readonly key: string;
        readonly worldTime: number;
        readonly eventCursor: number;
        readonly reason: string;
        readonly selected: boolean;
      }[];
      readonly hasMore: boolean;
    };

/**
 * The schema's world clock is untagged: local runs record Unix seconds, while
 * deterministic recordings use elapsed seconds. Preserve those short clocks;
 * values from 2000 onward are presented as UTC dates, never as fictional run age.
 */
export function formatWorldTime(worldSeconds: number): string {
  if (!Number.isFinite(worldSeconds) || worldSeconds < 0) {
    throw new RangeError("world seconds must be a non-negative finite number");
  }
  const wholeSeconds = Math.floor(worldSeconds);
  const day = Math.floor(wholeSeconds / 86_400) + 1;
  const secondsWithinDay = wholeSeconds % 86_400;
  const hour24 = Math.floor(secondsWithinDay / 3_600);
  const minute = Math.floor((secondsWithinDay % 3_600) / 60);
  const hour12 = hour24 % 12 || 12;
  const period = hour24 < 12 ? "AM" : "PM";
  const clock = `${hour12}:${String(minute).padStart(2, "0")} ${period}`;
  if (wholeSeconds >= 946_684_800 && wholeSeconds <= 253_402_300_799) {
    const date = new Date(wholeSeconds * 1_000);
    const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getUTCMonth()];
    return `${month} ${date.getUTCDate()}, ${date.getUTCFullYear()} · ${clock} UTC`;
  }
  return `Day ${day}, ${clock}`;
}

/** Projects compact HUD copy from exactly one selected observer frame. */
export function projectObserverHud(
  frame: PresentedObserverFrame,
  observedRegionId: string | null = null,
): ObserverHudView {
  const hud = selectPresentedHud(frame);
  const deniedIds = frameEntityIdDenylist(frame);
  const configuredRegionIds = new Set(frame.world.regions.flatMap((record) => (
    typeof record.value.name === "string" ? [record.value.name] : []
  )));
  const preferredRegionId = [observedRegionId, frame.scene?.regionId]
    .find((regionId): regionId is string => (
      regionId !== null && regionId !== undefined && configuredRegionIds.has(regionId)
    )) ?? [...configuredRegionIds][0] ?? null;
  return Object.freeze({
    worldTime: frame.world.worldTime,
    regionDisplayName: preferredRegionId === null
      ? "Unknown region"
      : regionDisplayName(preferredRegionId),
    humanTimeLabel: formatWorldTime(frame.world.worldTime),
    livingAgents: hud.livingAgents,
    deadAgents: hud.deadAgents,
    unresolvedAgentStatuses: hud.unresolvedAgentStatuses,
    homes: hud.homes,
    ruins: hud.ruins,
    connection: hud.transport.connection,
    retryable: frame.transport.retryable,
    presentedCursor: hud.presentedCursor,
    receivedCursor: hud.ingestedCursor,
    pendingMoments: hud.backlog.pendingMoments,
    backlogState: hud.backlog.state,
    backlogLabel: safePublicCopy(hud.backlog.label, "The story is catching up.", deniedIds),
  });
}

/** Projects the directed Atlas from presented regions and already-redacted Chronicle data. */
export function projectLivingAtlas(
  frame: PresentedObserverFrame,
  chronicle: PresentedChronicleWindow,
  observedRegionId: string | null,
): ObserverAtlasView {
  const safeChronicle = selectPresentedChronicle(frame, chronicle);
  const atlas = selectLivingAtlas(frame, safeChronicle);
  const deniedIds = frameEntityIdDenylist(frame);
  const completenessByRegion = new Map(
    frame.world.regions.flatMap((record) => (
      typeof record.value.name === "string"
        ? [[record.value.name, record.completeness] as const]
        : []
    )),
  );
  const displayNames = new Map(atlas.regions.map((region) => (
    [region.id, regionDisplayName(region.id)] as const
  )));
  const activeStoryRegionId = frame.scene?.regionId ?? null;
  return Object.freeze({
    activeStoryRegionId,
    observedRegionId,
    regions: Object.freeze(atlas.regions.map((region): ObserverAtlasRegionView => Object.freeze({
      key: region.id,
      displayName: displayNames.get(region.id) ?? "Unknown region",
      description: region.description === null
        ? "Details awaiting a checkpoint"
        : safePublicCopy(region.description, "Details awaiting a checkpoint", deniedIds),
      connections: Object.freeze(region.connections.map((id) => Object.freeze({
        key: id,
        displayName: displayNames.get(id) ?? "Unknown region",
      }))),
      livingAgents: region.livingAgents,
      unresolvedAgentStatuses: unresolvedStatusesInRegion(frame, region.id),
      homes: region.homes,
      ruins: region.ruins,
      countsComplete: regionCountsComplete(frame, region.id, completenessByRegion.get(region.id)),
      queuedImportance: region.queuedImportance,
      active: activeStoryRegionId === region.id,
      observed: observedRegionId === region.id,
      completeness: completenessByRegion.get(region.id) ?? "projected-partial",
    }))),
  });
}

/** Projects active dialogue only when scene, Chronicle, privacy, and presented cursor agree. */
export function projectDialogueNow(
  frame: PresentedObserverFrame,
  chronicle: PresentedChronicleWindow,
): DialogueNowView | null {
  const safeChronicle = selectPresentedChronicle(frame, chronicle);
  const dialogue = selectPresentedDialogue(frame, safeChronicle);
  const moment = safeChronicle.now;
  const scene = frame.scene;
  if (dialogue === null || moment === null || scene === null) return null;

  const deniedIds = momentEntityIdDenylist(frame, moment);
  const names = agentNameMap(frame, deniedIds);
  const targetKey = momentTargetId(moment);
  const speakerRegion = agentRegion(frame, dialogue.speakerId);
  const targetRegion = targetKey === null ? null : agentRegion(frame, targetKey);
  const visibleText = safePublicCopy(
    dialogue.text.slice(0, clampVisibleCharacters(dialogue.visibleCharacters, dialogue.text.length)),
    "…",
    deniedIds,
  );
  return Object.freeze({
    speakerKey: dialogue.speakerId,
    speakerName: safePublicEntityName(
      deniedIds,
      dialogue.speakerName,
      names.get(dialogue.speakerId),
    ),
    targetKey,
    targetName: targetKey === null ? null : names.get(targetKey) ?? "Unknown being",
    regionName: scene.regionId === null ? null : regionDisplayName(scene.regionId),
    visibleText,
    remote: moment.representative.event.scope === "targeted"
      && speakerRegion !== null
      && targetRegion !== null
      && speakerRegion !== targetRegion,
    hold: dialogue.hold,
    phase: scene.phase,
    priority: moment.priority,
  });
}

/** Projects active, settled, future-redacted, and gap Chronicle rows. */
export function projectChronicle(
  frame: PresentedObserverFrame,
  chronicle: PresentedChronicleWindow,
): ChronicleView {
  const safeChronicle = selectPresentedChronicle(frame, chronicle);
  return Object.freeze({
    now: safeChronicle.now === null ? null : momentRow(frame, safeChronicle.now, true),
    previous: Object.freeze(
      safeChronicle.previous
        .map((moment) => momentRow(frame, moment, false))
        .sort((left, right) => left.firstCursor - right.firstCursor),
    ),
    upcoming: Object.freeze(safeChronicle.upcoming.map((row) => Object.freeze({
      sequence: row.sequence,
      regionId: row.regionId,
      urgency: row.urgency,
    }))),
    gaps: Object.freeze(safeChronicle.gaps.map((gap) => Object.freeze({ ...gap }))),
  });
}

/** Projects the one current story cue from already-presented, public-safe state. */
export function projectStoryNow(
  frame: PresentedObserverFrame,
  chronicle: ChronicleView,
): StoryNowView | null {
  const focus = frame.checkpointFocus ?? null;
  if (focus !== null) {
    const regionName = regionDisplayName(focus.regionId);
    const copy = checkpointStoryCopy(focus.kind, focus.removed, regionName);
    return Object.freeze({
      kind: "checkpoint",
      state: "checkpoint",
      regionName,
      title: copy.title,
      summary: copy.summary,
      segmentIndex: focus.segmentIndex,
      segmentCount: focus.segmentCount,
    });
  }
  if (chronicle.now !== null) {
    return Object.freeze({ kind: "moment", state: "active", moment: chronicle.now });
  }
  const latest = chronicle.previous.reduce<ChronicleMomentRowView | null>((current, row) => {
    if (current === null) return row;
    if (row.lastCursor !== current.lastCursor) {
      return row.lastCursor > current.lastCursor ? row : current;
    }
    if (row.timestamp !== current.timestamp) return row.timestamp > current.timestamp ? row : current;
    return row.firstCursor > current.firstCursor ? row : current;
  }, null);
  return latest === null
    ? null
    : Object.freeze({ kind: "moment", state: "latest", moment: latest });
}

/** Projects the selected record without exposing partial records or StoryMoment evidence. */
export function projectSelection(
  frame: PresentedObserverFrame,
  chronicle: PresentedChronicleWindow,
): SelectionView | null {
  const safeChronicle = selectPresentedChronicle(frame, chronicle);
  const selection = selectPresentedSelection(frame, safeChronicle);
  if (selection === null) return null;
  switch (selection.kind) {
    case "agent":
      return agentSelection(frame, selection.id, selection.record);
    case "home":
      return homeSelection(frame, "home", selection.id, selection.record);
    case "ruin":
      return homeSelection(frame, "ruin", selection.id, selection.record);
    case "region":
      return regionSelection(frame, selection.id, selection.record);
    case "moment": {
      const row = momentRow(frame, selection.moment, false);
      return Object.freeze({
        kind: "moment",
        key: selection.id,
        title: row.title,
        subtitle: "Shown moment",
        completeness: "exact",
        qualifier: null,
        facts: Object.freeze([
          fact("Summary", row.summary),
          fact("Shown range", cursorRange(row.firstCursor, row.lastCursor)),
          fact("Place", row.regionName ?? "Unknown"),
        ]),
      });
    }
  }
}

/** Narrows bounded Archive catalogue metadata to authored public copy. */
export function projectArchiveCatalogue(
  input: ArchiveCatalogueProjectionInput,
): ArchiveCatalogueView {
  switch (input.state) {
    case "loading": return Object.freeze({ state: "loading", checkpoints: emptyCheckpoints(), hasMore: false });
    case "empty": return Object.freeze({ state: "empty", checkpoints: emptyCheckpoints(), hasMore: false });
    case "error": return Object.freeze({
      state: "error",
      checkpoints: emptyCheckpoints(),
      hasMore: false,
      message: input.message === undefined
        ? "The Archive is resting."
        : safePublicCopy(input.message, "The Archive is resting."),
    });
    case "ready": return Object.freeze({
      state: "ready",
      checkpoints: Object.freeze(input.records.map((record) => Object.freeze({
        key: record.key,
        label: `Shown moment ${record.eventCursor}`,
        worldTime: record.worldTime,
        eventCursor: record.eventCursor,
        reason: safePublicCopy(record.reason, "World checkpoint"),
        selected: record.selected,
      }))),
      hasMore: input.hasMore,
    });
  }
}

function emptyCheckpoints(): readonly [] {
  return Object.freeze([]) as readonly [];
}

function agentSelection(
  frame: PresentedObserverFrame,
  id: string,
  record: PresentedRecord<AgentSnapshot>,
): SelectionView {
  const value = record.value;
  const deniedIds = frameEntityIdDenylist(frame);
  const home = typeof value.home_id === "string"
    ? frame.world.homes.find((candidate) => candidate.value.home_id === value.home_id)
    : null;
  return Object.freeze({
    kind: "agent",
    key: id,
    title: safePublicEntityName(deniedIds, value.name),
    subtitle: "Being",
    completeness: record.completeness,
    qualifier: partialQualifier(record.completeness),
    facts: Object.freeze([
      fact("Identity", optionalSafeText(value.persona, deniedIds)),
      fact("Status", optionalEnum(value.status)),
      fact("Region", optionalRegion(value.position)),
      ...(value.spatial === undefined ? [] : [fact("Journey", physicalJourney(frame, value.spatial))]),
      fact("Energy", optionalQuantity(value.energy)),
      fact("Materials", optionalQuantity(value.materials)),
      fact("Home", home === null || home === undefined ? optionalRelationship(value.home_id) : homeTitle(home.value)),
      fact("Offspring", optionalNumber(value.offspring_count)),
      fact("Hoarding", optionalBoolean(value.is_hoarding)),
    ]),
  });
}

function physicalJourney(frame: PresentedObserverFrame, spatial: NonNullable<AgentSnapshot["spatial"]>): string {
  const region = frame.world.regions.find((candidate) => candidate.value.name === spatial.region_id);
  const destinationId = spatial.travel?.destination_id ?? spatial.at_landmark;
  const landmark = region?.value.spatial?.landmarks.find((site) => site.id === destinationId);
  const name = landmark === undefined ? "the destination" : safePublicCopy(landmark.name, "the destination");
  if (spatial.travel === null) return landmark === undefined ? "Standing on the path" : `At ${name}`;
  const at = frame.spatialPlayback?.sampledAt ?? spatial.observed_at;
  const remaining = Math.max(0, Math.ceil(spatial.travel.arrives_at - at));
  if (remaining === 0) return `At ${name}`;
  return `Walking to ${name} · ${remaining}s remaining${frame.spatialPlayback?.paused === true ? " · view paused" : ""}`;
}

function homeSelection(
  frame: PresentedObserverFrame,
  kind: "home" | "ruin",
  id: string,
  record: PresentedRecord<HomeSnapshot>,
): SelectionView {
  const value = record.value;
  const names = agentNameMap(frame);
  const ownerName = typeof value.owner_id === "string"
    ? names.get(value.owner_id) ?? "Unknown being"
    : "Unknown";
  const relationshipIds = kind === "home" ? value.stakeholders : value.breachers;
  const relationshipLabel = kind === "home" ? "Stakeholders" : "Known breachers";
  return Object.freeze({
    kind,
    key: id,
    title: kind === "home" ? `${ownerName}'s home` : `${ownerName}'s former home`,
    subtitle: kind === "home" ? "Shelter" : "Ruin",
    completeness: record.completeness,
    qualifier: partialQualifier(record.completeness),
    facts: Object.freeze([
      fact("Owner", ownerName),
      fact("Region", optionalRegion(value.region)),
      fact("Integrity", ratio(value.integrity, value.max_integrity)),
      fact(relationshipLabel, relationshipNames(relationshipIds, names)),
      fact(kind === "home" ? "Vault materials" : "Remnant materials", optionalQuantity(
        kind === "home" ? value.vault_materials : value.remnant_materials,
      )),
      fact("Status", optionalEnum(value.status)),
      fact("Hoarding", optionalBoolean(value.is_hoarding)),
      ...(kind === "ruin" ? [fact("Ruin age", formatRuinAge(frame.world.worldTime, value.ruined_at))] : []),
    ]),
  });
}

function regionSelection(
  frame: PresentedObserverFrame,
  id: string,
  record: PresentedRecord<RegionSnapshot>,
): SelectionView {
  const value = record.value;
  const deniedIds = frameEntityIdDenylist(frame);
  return Object.freeze({
    kind: "region",
    key: id,
    title: regionDisplayName(id),
    subtitle: "Region",
    completeness: record.completeness,
    qualifier: partialQualifier(record.completeness),
    facts: Object.freeze([
      fact("Description", optionalSafeText(value.description, deniedIds)),
      fact("Connections", Array.isArray(value.connections)
        ? value.connections.map(regionDisplayName).join(", ") || "None known"
        : "Unknown"),
      fact("Energy", ratio(value.current_energy, value.max_energy)),
      fact("Materials", ratio(value.current_materials, value.max_materials)),
      fact("Energy regeneration", optionalNumber(value.energy_rate)),
      fact("Materials regeneration", optionalNumber(value.materials_rate)),
    ]),
  });
}

function momentRow(
  frame: PresentedObserverFrame,
  moment: StoryMoment,
  active: boolean,
): ChronicleMomentRowView {
  const regionId = momentRegion(moment);
  const descriptor = momentDescriptor(frame, moment);
  const row: ChronicleMomentRowView = {
    key: moment.id,
    firstCursor: moment.firstCursor,
    lastCursor: moment.lastCursor,
    priority: moment.priority,
    regionName: regionId === null ? null : regionDisplayName(regionId),
    focusLabel: focusLabel(frame, moment),
    timestamp: finiteNumber(moment.representative.event.timestamp) ?? 0,
    title: descriptor.title,
    summary: descriptor.summary,
    ...(active ? { details: Object.freeze([
      fact("Place", regionId === null ? "Unknown" : regionDisplayName(regionId)),
      fact("Shown range", cursorRange(moment.firstCursor, moment.lastCursor)),
      fact("Importance", titleCase(moment.priority)),
    ]) } : {}),
  };
  return Object.freeze(row);
}

interface MomentDescriptor {
  readonly title: string;
  readonly summary: string;
}

const PRESENTED_EVENT_TYPES: ReadonlySet<string> = new Set(EVENT_VISUAL_EVENT_TYPES);

function momentDescriptor(frame: PresentedObserverFrame, moment: StoryMoment): MomentDescriptor {
  const type = moment.representative.event.type;
  if (!PRESENTED_EVENT_TYPES.has(type)) {
    return Object.freeze({ title: "Something changed", summary: "The world changed." });
  }
  return knownMomentDescriptor(frame, moment, type as EventVisualEventType);
}

function knownMomentDescriptor(
  frame: PresentedObserverFrame,
  moment: StoryMoment,
  type: EventVisualEventType,
): MomentDescriptor {
  const actor = actorNameForMoment(frame, moment);
  const target = targetNameForMoment(frame, moment);
  const amount = payloadFiniteNumber(moment, "amount");
  const resource = payloadString(moment, "resource_type") === "energy" ? "energy" : "materials";
  switch (type) {
    case "agent_born": {
      const child = payloadPublicName(frame, moment, "child_name") ?? target ?? "A new being";
      return descriptor("A new life", `${child} joined the world.`);
    }
    case "agent_died": {
      const victim = payloadPublicName(frame, moment, "victim_name")
        ?? agentNameForPayload(frame, moment, "victim_id")
        ?? target
        ?? actor;
      return descriptor("A journey ended", `${victim}'s journey ended.`);
    }
    case "agent_decayed": return descriptor("A final fading", `${actor}'s remains returned to the world.`);
    case "agent_paralyzed": return descriptor("A sudden fall", `${actor} was left unable to move.`);
    case "agent_recovered": {
      const revived = agentNameForPayload(frame, moment, "revived_id", "recipient_id") ?? target ?? actor;
      return descriptor("Strength restored", `${revived} recovered.`);
    }
    case "agent_left_region": {
      const from = regionDisplayName(payloadString(moment, "from_region") ?? momentRegion(moment) ?? "unknown");
      return descriptor("A departure", `${actor} set out from ${from}.`);
    }
    case "agent_entered_region": {
      const destination = regionDisplayName(payloadString(moment, "to_region") ?? momentRegion(moment) ?? "unknown");
      return descriptor("An arrival", `${actor} arrived in ${destination}.`);
    }
    case "speak": return descriptor(
      "A quiet exchange",
      target === null ? `${actor} spoke.` : `${actor} reached out to ${target}.`,
    );
    case "self_talk": return descriptor("A private reflection", `${actor} reflected quietly.`);
    case "resource_changed": {
      const quantity = Math.abs(amount ?? 0);
      return amount !== null && amount < 0
        ? descriptor("Resources spent", `${actor} spent ${resourceQuantity(quantity, resource)}.`)
        : descriptor("Resources gathered", `${actor} gathered ${resourceQuantity(quantity, resource)}.`);
    }
    case "resource_transferred": return descriptor(
      "A gift shared",
      target === null
        ? `${actor} shared ${resourceQuantity(amount ?? 0, resource)}.`
        : `${actor} shared ${resourceQuantity(amount ?? 0, resource)} with ${target}.`,
    );
    case "agent_started_hoarding": return descriptor(
      "Resources held close",
      `${actor} began keeping resources close.`,
    );
    case "mating_initiated": return descriptor(
      "A bond proposed",
      target === null ? `${actor} proposed a bond.` : `${actor} proposed a bond with ${target}.`,
    );
    case "mating_rejected": {
      const rejecter = agentNameForPayload(frame, moment, "rejecter_id") ?? actor;
      const initiator = agentNameForPayload(frame, moment, "initiator_id") ?? target;
      return descriptor(
        "A bond refused",
        initiator === null ? `${rejecter} refused a bond.` : `${rejecter} refused ${initiator}'s bond.`,
      );
    }
    case "mating_proposal_invalidated": return descriptor(
      "A bond broken",
      "A proposed bond could no longer continue.",
    );
    case "mating_proposal_timeout": return descriptor(
      "A bond unanswered",
      "A proposed bond faded with time.",
    );
    case "attack": return descriptor(
      "A struggle",
      target === null
        ? `${actor} struck for ${quantityLabel(payloadFiniteNumber(moment, "damage") ?? 0, "damage")}.`
        : `${actor} struck ${target} for ${quantityLabel(payloadFiniteNumber(moment, "damage") ?? 0, "damage")}.`,
    );
    case "home_built": return descriptor("Shelter raised", `${actor} completed a shelter.`);
    case "hearth_used": return descriptor(
      "Hearth tended",
      `${actor} warmed at a hearth and gained ${quantityLabel(payloadFiniteNumber(moment, "energy_gained") ?? 0, "energy")}.`,
    );
    case "home_joined": return descriptor("A shared shelter", `${actor} joined a shelter.`);
    case "home_left": return descriptor("Shelter left behind", `${actor} left a shelter.`);
    case "home_started_hoarding": return descriptor(
      "A guarded vault",
      "A shelter began holding its materials close.",
    );
    case "home_collapsed": return descriptor(
      "Shelter lost",
      `A shelter fell into ruin, leaving ${resourceQuantity(
        payloadFiniteNumber(moment, "remnant_materials") ?? 0,
        "materials",
      )} behind.`,
    );
    case "home_breached": return descriptor(
      "Shelter breached",
      `${actor} damaged a shelter by ${quantityLabel(
        payloadFiniteNumber(moment, "integrity_damage") ?? 0,
        "integrity",
      )}.`,
    );
    case "home_thieved": return descriptor(
      "Shelter raided",
      `${actor} took ${resourceQuantity(payloadNestedFiniteNumber(moment, "loot", "materials") ?? 0, "materials")} from a shelter.`,
    );
    case "home_colonized": {
      const owner = agentNameForPayload(frame, moment, "new_owner_id") ?? actor;
      return descriptor("Shelter claimed", `${owner} claimed a shelter.`);
    }
    case "ruins_scavenged": return descriptor(
      "Ruins scavenged",
      `${actor} recovered ${resourceQuantity(amount ?? 0, "materials")} from a ruin.`,
    );
    case "simulation_started": {
      const count = payloadFiniteNumber(moment, "agent_count") ?? 0;
      return descriptor("The world awakens", `${quantityLabel(count, "being", "beings")} entered a new world.`);
    }
  }
}

function descriptor(title: string, summary: string): MomentDescriptor {
  return Object.freeze({ title, summary });
}

function checkpointStoryCopy(
  kind: "home" | "ruin" | "region",
  removed: boolean,
  regionName: string,
): MomentDescriptor {
  if (removed) return descriptor(
    "A structure is gone",
    `A structure no longer remains in ${regionName}.`,
  );
  switch (kind) {
    case "home": return descriptor(
      "A shelter has changed",
      `${regionName} now holds a changed shelter.`,
    );
    case "ruin": return descriptor(
      "A ruin has changed",
      `${regionName} now holds a changed ruin.`,
    );
    case "region": return descriptor(
      "The land has changed",
      `${regionName} has settled into a new shape.`,
    );
  }
}

function focusLabel(frame: PresentedObserverFrame, moment: StoryMoment): string {
  const focus = moment.focus;
  const names = agentNameMap(frame, momentEntityIdDenylist(frame, moment));
  switch (focus.kind) {
    case "agent": return names.get(focus.id) ?? "Unknown being";
    case "home": {
      const homeId = focus.id;
      const record = [...frame.world.homes, ...frame.world.ruins]
        .find((candidate) => candidate.value.home_id === homeId);
      return record === undefined ? "Unknown shelter" : homeTitle(record.value, frame);
    }
    case "region": return regionDisplayName(focus.id);
    case "ruin": return "A ruin";
    case "system": return focus.regionId === null ? "The world" : regionDisplayName(focus.regionId);
  }
}

function actorNameForMoment(frame: PresentedObserverFrame, moment: StoryMoment): string {
  const id = moment.representative.resolved.actor_id
    ?? payloadString(moment, "agent_id", "speaker_id", "attacker_id", "builder_id")
    ?? moment.representative.event.source;
  return agentNameMap(frame, momentEntityIdDenylist(frame, moment)).get(id) ?? "A being";
}

function targetNameForMoment(frame: PresentedObserverFrame, moment: StoryMoment): string | null {
  const id = momentTargetId(moment);
  return id === null
    ? null
    : agentNameMap(frame, momentEntityIdDenylist(frame, moment)).get(id) ?? "another being";
}

function momentTargetId(moment: StoryMoment): string | null {
  return moment.representative.resolved.target_id
    ?? payloadString(moment, "target_id", "receiver_id", "recipient_id", "victim_id", "acceptor_id")
    ?? moment.representative.event.target;
}

function momentRegion(moment: StoryMoment): string | null {
  return moment.representative.resolved.region
    ?? payloadString(moment, "region", "to_region", "from_region")
    ?? moment.representative.event.region;
}

function payloadString(moment: StoryMoment, ...keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = moment.representative.event.payload[key];
    if (typeof value === "string") return value;
  }
  return null;
}

function payloadFiniteNumber(moment: StoryMoment, key: string): number | null {
  const value = moment.representative.event.payload[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function payloadNestedFiniteNumber(
  moment: StoryMoment,
  objectKey: string,
  numberKey: string,
): number | null {
  const value = moment.representative.event.payload[objectKey];
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = (value as Readonly<Record<string, unknown>>)[numberKey];
  return typeof candidate === "number" && Number.isFinite(candidate) ? candidate : null;
}

function payloadPublicName(
  frame: PresentedObserverFrame,
  moment: StoryMoment,
  key: string,
): string | null {
  const value = payloadString(moment, key);
  return value === null
    ? null
    : safePublicCopy(value, "Unknown being", momentEntityIdDenylist(frame, moment));
}

function agentNameForPayload(
  frame: PresentedObserverFrame,
  moment: StoryMoment,
  ...keys: readonly string[]
): string | null {
  const id = payloadString(moment, ...keys);
  return id === null
    ? null
    : agentNameMap(frame, momentEntityIdDenylist(frame, moment)).get(id) ?? "another being";
}

function resourceQuantity(value: number, resource: "energy" | "materials"): string {
  if (resource === "energy") return quantityLabel(value, "energy");
  return quantityLabel(value, "material", "materials");
}

function quantityLabel(value: number, singular: string, plural: string = singular): string {
  const safe = Number.isFinite(value) ? Math.abs(value) : 0;
  const formatted = formatPublicNumber(safe);
  return `${formatted} ${formatted === "1" ? singular : plural}`;
}

function agentNameMap(
  frame: PresentedObserverFrame,
  deniedIds: EntityIdDenylist = frameEntityIdDenylist(frame),
): ReadonlyMap<string, string> {
  const names = new Map<string, string>();
  for (const record of frame.world.agents) {
    if (typeof record.value.id !== "string") continue;
    names.set(record.value.id, safePublicEntityName(deniedIds, record.value.name));
  }
  return names;
}

function agentRegion(frame: PresentedObserverFrame, id: string): string | null {
  const record = frame.world.agents.find((candidate) => candidate.value.id === id);
  return typeof record?.value.position === "string" ? record.value.position : null;
}

function unresolvedStatusesInRegion(
  frame: PresentedObserverFrame,
  regionId: string,
): number {
  return frame.world.agents.filter((record) => (
    record.value.position === regionId
    && record.value.status !== "alive"
    && record.value.status !== "paralyzed"
    && record.value.status !== "dead"
  )).length;
}

function regionCountsComplete(
  frame: PresentedObserverFrame,
  regionId: string,
  regionCompleteness: "exact" | "projected-partial" | undefined,
): boolean {
  if (regionCompleteness !== "exact") return false;
  return !frame.world.agents.some((record) => (
    record.value.position === regionId
    && (record.completeness === "projected-partial" || record.value.status === undefined)
  )) && !frame.world.homes.some((record) => (
    record.value.region === regionId && record.completeness === "projected-partial"
  )) && !frame.world.ruins.some((record) => (
    record.value.region === regionId && record.completeness === "projected-partial"
  ));
}

function homeTitle(value: Readonly<Partial<HomeSnapshot>>, frame?: PresentedObserverFrame): string {
  if (frame !== undefined && typeof value.owner_id === "string") {
    const owner = agentNameMap(frame).get(value.owner_id);
    if (owner !== undefined) return `${owner}'s home`;
  }
  return "Known shelter";
}

function relationshipNames(
  ids: readonly string[] | undefined,
  names: ReadonlyMap<string, string>,
): string {
  if (!Array.isArray(ids)) return "Unknown";
  if (ids.length === 0) return "None known";
  return ids.map((id) => names.get(id) ?? "Unknown being").join(", ");
}

function regionDisplayName(id: string): string {
  if (!isSafeRegionKey(id)) return "Unknown region";
  const words = id.trim().replace(/[_-]+/g, " ").replace(/\s+/g, " ");
  return words.split(" ").map(titleCase).join(" ");
}

function optionalSafeText(value: string | undefined, deniedIds: EntityIdDenylist): string {
  return value === undefined ? "Unknown" : safePublicCopy(value, "Unknown", deniedIds);
}

function optionalRegion(value: string | undefined): string {
  return value === undefined ? "Unknown" : regionDisplayName(value);
}

function optionalRelationship(value: string | null | undefined): string {
  if (value === undefined) return "Unknown";
  return value === null ? "None" : "Known shelter";
}

function optionalNumber(value: number | null | undefined): string {
  const number = finiteNumber(value);
  return number === null ? "Unknown" : String(number);
}

function optionalQuantity(value: number | null | undefined): string {
  const number = finiteNumber(value);
  return number === null ? "Unknown" : formatPublicNumber(number);
}

function optionalBoolean(value: boolean | undefined): string {
  return value === undefined ? "Unknown" : value ? "Yes" : "No";
}

function optionalEnum(value: string | undefined): string {
  return value === undefined ? "Unknown" : titleCase(value);
}

function ratio(value: number | undefined, maximum: number | undefined): string {
  const left = finiteNumber(value);
  const right = finiteNumber(maximum);
  if (left === null && right === null) return "Unknown";
  return `${left === null ? "Unknown" : formatPublicNumber(left)} / ${right === null ? "Unknown" : formatPublicNumber(right)}`;
}

function finiteNumber(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function partialQualifier(completeness: "exact" | "projected-partial"): string | null {
  return completeness === "projected-partial" ? "Observed; awaiting exact record" : null;
}

function fact(label: string, value: string): PublicFactView {
  return Object.freeze({ label, value });
}

function cursorRange(first: number, last: number): string {
  return first === last ? String(first) : `${first}–${last}`;
}

function clampVisibleCharacters(value: number, max: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(max, Math.floor(value))) : 0;
}

function titleCase(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1).toLowerCase();
}

const SENSITIVE_REGION_KEY = /(?:\b(?:provider|model|system[ _-]?prompt|prompt|context[ _-]?window|tokens?|latency|backend exception|source[ _-]?key|run[ _-]?id|raw json)\b|(?:^|[\s"'])(?:\/[^\s]+|[A-Za-z]:\\[^\s]+)|\b(?:ollama|gemini|qwen\d*)\b)/i;

function isSafeRegionKey(value: string): boolean {
  return value.trim().length > 0
    && value.length <= 80
    && /^[a-zA-Z][a-zA-Z0-9 _-]*$/.test(value)
    && !SENSITIVE_REGION_KEY.test(value);
}
