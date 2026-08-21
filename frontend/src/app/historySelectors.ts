import { BeatDirector } from "../events/beatDirector";
import { getEventVisualMetadata } from "../events/eventVisualCatalog";
import {
  presentEvent,
  presentEventBubbleDetail,
  presentEventChainDetail,
  type EventBubbleDetailPresentation,
  type EventChainDetailPresentation,
  type EventPresentation,
  type EventPresentationContext,
  type EventPresentationGroup,
} from "./eventPresentation";
import type { EventEnvelopeEntry } from "./schemas";

export type ChronicleGapReason = "overflow" | "snapshot_required";

export interface ChronicleHistoryGap {
  kind: "gap";
  id: string;
  reason: ChronicleGapReason;
  afterCursor: number;
  beforeCursor: number;
  nextCursor: number;
  message: string;
  timestamp: number | null;
}

export interface ChronicleHistoryEvent {
  kind: "event";
  entry: EventEnvelopeEntry;
}

export type ChronicleHistoryEntry = ChronicleHistoryEvent | ChronicleHistoryGap;

export type PresentedHistoryEvent = EventPresentation & {
  kind: "event";
  cursor: number;
  type: string;
  entry: EventEnvelopeEntry;
  compactDetail?: EventBubbleDetailPresentation;
  chainDetail?: EventChainDetailPresentation;
};

export interface PresentedHistoryGap {
  kind: "gap";
  id: string;
  reason: ChronicleGapReason;
  message: string;
  afterCursor: number;
  beforeCursor: number;
  nextCursor: number;
  timestamp: number | null;
  sortCursor: number;
}

export type PresentedHistoryItem = PresentedHistoryEvent | PresentedHistoryGap;

export type HistorySelection =
  | { kind: "agent"; id: string }
  | { kind: "region"; id: string }
  | { kind: "home"; id: string }
  | null;

export interface HistoryTimelineSummary {
  liveEdgeCursor: number;
  worldTime: number;
  firstRetainedCursor: number | null;
  lastRetainedCursor: number | null;
  eventTimeStart: number | null;
  eventTimeEnd: number | null;
  gapCount: number;
  canSeek: false;
  cursorWindowLabel: string;
  eventWindowLabel: string;
  snapshotArtifactLabel: string;
}

export type HistoryArtifacts = Partial<Record<string, string>> | null;
export type EventPresentationContextSource =
  | EventPresentationContext
  | ((entry: EventEnvelopeEntry) => EventPresentationContext);

export interface ArchiveChronicleWindowOptions {
  windowStart?: number;
  windowSize?: number;
}

export interface PresentedArchiveChronicleWindow {
  items: PresentedHistoryEvent[];
  totalVisibleCount: number;
  windowStart: number;
  windowEnd: number;
  windowSize: number;
}

export interface LiveChronicleOptions {
  recentCount?: number;
  retainedCount?: number;
  maxCount?: number;
  currentCursor?: number;
}

export interface LivePulseOptions {
  recentCount?: number;
  topGroupLimit?: number;
}

export interface LivePulseCursorWindow {
  startCursor: number | null;
  endCursor: number | null;
  label: string;
}

export interface LivePulseGroupCount {
  group: EventPresentationGroup;
  label: string;
  count: number;
  latestCursor: number;
  latestEventType: string;
  latestEventLabel: string;
}

export interface LivePulseGapSummary {
  state: "none" | "recent";
  count: number;
  reason: ChronicleGapReason | null;
  reasons: ChronicleGapReason[];
  latest: PresentedHistoryGap | null;
}

export interface LivePulseSummary {
  totalRecentGroupedEventCount: number;
  cursorWindow: LivePulseCursorWindow;
  topGroups: LivePulseGroupCount[];
  dominantGroup: LivePulseGroupCount | null;
  latestImportantBeat: PresentedHistoryEvent | null;
  gaps: LivePulseGapSummary;
}

export interface SelectedFocusPulseOptions {
  recentCount?: number;
  topGroupLimit?: number;
}

export interface SelectedFocusPulseSummary {
  state: "quiet" | "gap" | "active";
  totalSelectedGroupedEventCount: number;
  cursorWindow: LivePulseCursorWindow;
  topGroups: LivePulseGroupCount[];
  dominantGroup: LivePulseGroupCount | null;
  latestEvent: PresentedHistoryEvent | null;
  gaps: LivePulseGapSummary;
}

export type LiveNowCueSlot = "voice" | "bond" | "life" | "home" | "conflict" | "world";

export interface LiveNowCue {
  slot: LiveNowCueSlot;
  slotLabel: string;
  item: PresentedHistoryEvent;
  eventType: string;
  label: string;
  detail: string;
  cursor: number;
}

export interface LiveNowCueOptions {
  maxCues?: number;
}

const DEFAULT_LIVE_CHRONICLE_RECENT_COUNT = 10;
const DEFAULT_LIVE_CHRONICLE_RETAINED_COUNT = 2;
const DEFAULT_LIVE_CHRONICLE_MAX_COUNT = 12;
const DEFAULT_LIVE_PULSE_RECENT_COUNT = 24;
const MAX_LIVE_PULSE_RECENT_COUNT = 100;
const DEFAULT_LIVE_PULSE_TOP_GROUP_LIMIT = 3;
const MIN_LIVE_PULSE_TOP_GROUP_LIMIT = 2;
const MAX_LIVE_PULSE_TOP_GROUP_LIMIT = 4;

const LIVE_PULSE_GROUP_LABELS: Record<EventPresentationGroup, string> = {
  movement: "Movement",
  speech: "Speech",
  thought: "Thought",
  resource: "Resources",
  life: "Life",
  bond: "Bonds",
  home: "Homes",
  contest: "Conflict",
  system: "World",
};

const LIVE_NOW_SLOT_ORDER = ["voice", "bond", "life", "home", "conflict", "world"] as const;
const DEFAULT_LIVE_NOW_MAX_CUES = LIVE_NOW_SLOT_ORDER.length;

const LIVE_NOW_SLOT_LABELS: Record<LiveNowCueSlot, string> = {
  voice: "Voice",
  bond: "Bond",
  life: "Life",
  home: "Home",
  conflict: "Conflict",
  world: "World",
};

const LIVE_NOW_EVENT_SLOTS: Readonly<Record<string, LiveNowCueSlot>> = {
  simulation_started: "world",
  agent_left_region: "world",
  agent_entered_region: "world",
  resource_changed: "world",
  resource_transferred: "world",
  agent_started_hoarding: "world",
  speak: "voice",
  self_talk: "voice",
  mating_initiated: "bond",
  mating_rejected: "bond",
  mating_proposal_invalidated: "bond",
  mating_proposal_timeout: "bond",
  agent_born: "bond",
  agent_paralyzed: "life",
  agent_recovered: "life",
  agent_died: "life",
  agent_decayed: "life",
  home_built: "home",
  hearth_used: "home",
  home_joined: "home",
  home_left: "home",
  home_started_hoarding: "home",
  home_collapsed: "home",
  ruins_scavenged: "home",
  attack: "conflict",
  home_breached: "conflict",
  home_thieved: "conflict",
  home_colonized: "conflict",
};

export function selectPresentedHistory(
  history: readonly ChronicleHistoryEntry[],
  context: EventPresentationContext = {},
): PresentedHistoryItem[] {
  return selectPresentedHistoryGroups(history, context).map((group) => group.item);
}

export function selectLiveChronicleItems(
  history: readonly ChronicleHistoryEntry[],
  context: EventPresentationContext = {},
  options: LiveChronicleOptions = {},
): PresentedHistoryItem[] {
  const groups = selectPresentedHistoryGroups(history, context);
  const maxCount = normalizedCount(options.maxCount, DEFAULT_LIVE_CHRONICLE_MAX_COUNT);
  if (maxCount <= 0) {
    return [];
  }

  const recentCount = Math.min(
    normalizedCount(options.recentCount, DEFAULT_LIVE_CHRONICLE_RECENT_COUNT),
    maxCount,
  );
  const retainedCount = normalizedCount(
    options.retainedCount,
    DEFAULT_LIVE_CHRONICLE_RETAINED_COUNT,
  );
  const selected: PresentedHistoryItem[] = [];
  const selectedKeys = new Set<string>();

  for (const group of groups.slice(0, recentCount)) {
    addLiveChronicleItem(selected, selectedKeys, group.item);
  }

  const retentionBudget = Math.min(retainedCount, maxCount - selected.length);
  if (retentionBudget <= 0) {
    return pinCurrentLiveChronicleItem(
      selected,
      groups,
      options.currentCursor,
      maxCount,
    );
  }

  let retained = 0;
  for (const group of groups.slice(recentCount)) {
    if (group.kind !== "event" || !isLiveChronicleSalient(group.item)) {
      continue;
    }
    if (addLiveChronicleItem(selected, selectedKeys, group.item)) {
      retained += 1;
    }
    if (retained >= retentionBudget) {
      break;
    }
  }

  return pinCurrentLiveChronicleItem(
    selected,
    groups,
    options.currentCursor,
    maxCount,
  );
}

function pinCurrentLiveChronicleItem(
  selected: PresentedHistoryItem[],
  groups: readonly PresentedHistoryGroup[],
  currentCursor: number | undefined,
  maxCount: number,
): PresentedHistoryItem[] {
  if (!Number.isFinite(currentCursor) || maxCount <= 0) {
    return selected;
  }
  const current = groups.find((group) => (
    group.kind === "event" && group.item.cursor === currentCursor
  ));
  if (
    !current
    || selected.some((item) => item.kind === "event" && item.cursor === currentCursor)
  ) {
    return selected;
  }
  const pinned = selected.length >= maxCount
    ? selected.slice(0, maxCount - 1)
    : [...selected];
  pinned.push(current.item);
  return pinned;
}

export function summarizeLivePulse(
  history: readonly ChronicleHistoryEntry[],
  context: EventPresentationContext = {},
  options: LivePulseOptions = {},
): LivePulseSummary {
  const recentCount = boundedLivePulseRecentCount(options.recentCount);
  const topGroupLimit = boundedLivePulseTopGroupLimit(options.topGroupLimit);
  const recentGroups = selectPresentedHistoryGroups(history, context).slice(0, recentCount);
  const eventGroups = recentGroups.filter(isEventHistoryGroup);
  const gapGroups = recentGroups.filter(isGapHistoryGroup);
  const cursorBounds = recentGroups.flatMap(livePulseCursorBounds);
  const startCursor = minOrNull(cursorBounds.map(([start]) => start));
  const endCursor = maxOrNull(cursorBounds.map(([, end]) => end));
  const topGroups = livePulseTopGroups(eventGroups, topGroupLimit);
  const latestGap = gapGroups[0]?.item ?? null;
  const gapReasons = uniqueValues(gapGroups.map((group) => group.item.reason));

  return {
    totalRecentGroupedEventCount: eventGroups.length,
    cursorWindow: {
      startCursor,
      endCursor,
      label: formatCursorWindow(startCursor, endCursor),
    },
    topGroups,
    dominantGroup: topGroups[0] ?? null,
    latestImportantBeat: (
      eventGroups.find((group) => isLivePulseImportant(group.item)) ?? eventGroups[0]
    )?.item ?? null,
    gaps: {
      state: gapGroups.length > 0 ? "recent" : "none",
      count: gapGroups.length,
      reason: latestGap?.reason ?? null,
      reasons: gapReasons,
      latest: latestGap,
    },
  };
}

export function summarizeLiveNowCues(
  history: readonly ChronicleHistoryEntry[],
  context: EventPresentationContext = {},
  options: LiveNowCueOptions = {},
): LiveNowCue[] {
  const selectedBySlot = new Map<LiveNowCueSlot, LiveNowCue>();

  for (const group of selectPresentedHistoryGroups(history, context)) {
    if (group.kind === "gap") {
      continue;
    }

    const slot = LIVE_NOW_EVENT_SLOTS[group.item.type];
    if (!slot || selectedBySlot.has(slot)) {
      continue;
    }

    selectedBySlot.set(slot, liveNowCue(slot, group.item));
  }

  const maxCues = normalizedCount(options.maxCues, DEFAULT_LIVE_NOW_MAX_CUES);
  return LIVE_NOW_SLOT_ORDER
    .flatMap((slot) => selectedBySlot.get(slot) ?? [])
    .slice(0, maxCues);
}

export function summarizeSelectedFocusPulse(
  selectedHistory: readonly PresentedHistoryItem[],
  options: SelectedFocusPulseOptions = {},
): SelectedFocusPulseSummary {
  if (selectedHistory.length === 0) {
    return emptySelectedFocusPulse();
  }

  const recentCount = boundedLivePulseRecentCount(options.recentCount);
  const topGroupLimit = boundedLivePulseTopGroupLimit(options.topGroupLimit);
  const selected = applyLimit([...selectedHistory], recentCount);
  const eventItems = selected.filter(isPresentedHistoryEvent);
  const gapItems = selected.filter(isPresentedHistoryGap);
  const cursorBounds = selected.flatMap(selectedFocusCursorBounds);
  const startCursor = minOrNull(cursorBounds.map(([start]) => start));
  const endCursor = maxOrNull(cursorBounds.map(([, end]) => end));
  const topGroups = selectedFocusTopGroups(eventItems, topGroupLimit);
  const latestGap = gapItems[0] ?? null;
  const gapReasons = uniqueValues(gapItems.map((gap) => gap.reason));

  return {
    state: eventItems.length > 0 ? "active" : gapItems.length > 0 ? "gap" : "quiet",
    totalSelectedGroupedEventCount: eventItems.length,
    cursorWindow: {
      startCursor,
      endCursor,
      label: formatCursorWindow(startCursor, endCursor),
    },
    topGroups,
    dominantGroup: topGroups[0] ?? null,
    latestEvent: eventItems[0] ?? null,
    gaps: {
      state: gapItems.length > 0 ? "recent" : "none",
      count: gapItems.length,
      reason: latestGap?.reason ?? null,
      reasons: gapReasons,
      latest: latestGap,
    },
  };
}

export function selectPresentedArchiveChronicle(
  events: readonly EventEnvelopeEntry[],
  context: EventPresentationContextSource = {},
  limit?: number,
): PresentedHistoryEvent[] {
  return selectPresentedArchiveChronicleWindow(events, context, {
    windowSize: limit,
  }).items;
}

export function selectPresentedArchiveChronicleWindow(
  events: readonly EventEnvelopeEntry[],
  context: EventPresentationContextSource = {},
  options: ArchiveChronicleWindowOptions = {},
): PresentedArchiveChronicleWindow {
  const orderedEvents = [...events].sort((left, right) => left.cursor - right.cursor);
  const representativeGroups = archiveRepresentativeGroups(orderedEvents);
  const totalVisibleCount = representativeGroups.length;
  const windowSize = archiveWindowSize(options.windowSize);
  const windowStart = archiveWindowStart(
    options.windowStart ?? 0,
    totalVisibleCount,
    windowSize,
  );
  const windowEnd = windowSize <= 0
    ? windowStart
    : Math.min(windowStart + windowSize, totalVisibleCount);
  const items = representativeGroups
    .slice(windowStart, windowEnd)
    .map((group) => presentHistoryEvent(
      group.visual,
      contextForEntry(context, group.visual),
      group.entries,
    ));

  return {
    items,
    totalVisibleCount,
    windowStart,
    windowEnd,
    windowSize,
  };
}

export function selectHistoryForSelection(
  history: readonly ChronicleHistoryEntry[],
  selection: HistorySelection,
  context: EventPresentationContext = {},
  limit?: number,
): PresentedHistoryItem[] {
  const groups = selectPresentedHistoryGroups(history, context);
  const filtered = selection
    ? groups.filter((group) => matchesHistorySelectionGroup(group, selection, context))
    : groups;

  return applyLimit(filtered.map((group) => group.item), limit);
}

type PresentedHistoryGroup =
  | { kind: "gap"; item: PresentedHistoryGap }
  | { kind: "event"; item: PresentedHistoryEvent; entries: EventEnvelopeEntry[] };

type PresentedEventHistoryGroup = Extract<PresentedHistoryGroup, { kind: "event" }>;
type PresentedGapHistoryGroup = Extract<PresentedHistoryGroup, { kind: "gap" }>;

export function summarizeHistoryTimeline(
  history: readonly ChronicleHistoryEntry[],
  eventCursor: number,
  worldTime: number,
  artifacts: HistoryArtifacts = null,
): HistoryTimelineSummary {
  const cursorBounds = history.flatMap(historyCursorBounds);
  const timestamps = history.flatMap(historyTimestamp);
  const firstRetainedCursor = minOrNull(cursorBounds.map(([start]) => start));
  const lastRetainedCursor = maxOrNull(cursorBounds.map(([, end]) => end));
  const eventTimeStart = minOrNull(timestamps);
  const eventTimeEnd = maxOrNull(timestamps) ?? finiteNumberOrNull(worldTime);

  return {
    liveEdgeCursor: eventCursor,
    worldTime,
    firstRetainedCursor,
    lastRetainedCursor,
    eventTimeStart,
    eventTimeEnd,
    gapCount: history.filter((item) => item.kind === "gap").length,
    canSeek: false,
    cursorWindowLabel: formatCursorWindow(firstRetainedCursor, lastRetainedCursor),
    eventWindowLabel: formatEventWindow(eventTimeStart, eventTimeEnd),
    snapshotArtifactLabel: shortArtifact(artifacts?.snapshots),
  };
}

type HistorySegment =
  | { kind: "events"; entries: EventEnvelopeEntry[] }
  | { kind: "gap"; gap: ChronicleHistoryGap };

function historySegments(history: readonly ChronicleHistoryEntry[]): HistorySegment[] {
  const segments: HistorySegment[] = [];
  let pendingEvents: EventEnvelopeEntry[] = [];

  for (const item of history) {
    if (item.kind === "event") {
      pendingEvents.push(item.entry);
      continue;
    }
    if (pendingEvents.length > 0) {
      segments.push({ kind: "events", entries: pendingEvents });
      pendingEvents = [];
    }
    segments.push({ kind: "gap", gap: item });
  }

  if (pendingEvents.length > 0) {
    segments.push({ kind: "events", entries: pendingEvents });
  }

  return segments;
}

function selectPresentedHistoryGroups(
  history: readonly ChronicleHistoryEntry[],
  context: EventPresentationContext,
): PresentedHistoryGroup[] {
  const segments = historySegments(history);
  return segments
    .reverse()
    .flatMap((segment): PresentedHistoryGroup[] => (
      segment.kind === "gap"
        ? [{ kind: "gap", item: presentGap(segment.gap) }]
        : presentEventSegmentGroups(segment.entries, context)
    ));
}

function presentEventSegment(
  entries: EventEnvelopeEntry[],
  context: EventPresentationContextSource,
): PresentedHistoryEvent[] {
  return presentEventSegmentGroups(entries, context).map((group) => group.item);
}

function presentEventSegmentGroups(
  entries: EventEnvelopeEntry[],
  context: EventPresentationContextSource,
): Array<Extract<PresentedHistoryGroup, { kind: "event" }>> {
  return visualGroupsForEntries(entries)
    .map((group) => {
      const entry = group.visual;
      const groupedEntries = group.entries;
      return {
        kind: "event" as const,
        item: presentHistoryEvent(entry, contextForEntry(context, entry), groupedEntries),
        entries: groupedEntries,
      };
    })
    .sort((left, right) => right.item.cursor - left.item.cursor);
}

function archiveRepresentativeGroups(
  entries: EventEnvelopeEntry[],
): Array<{ visual: EventEnvelopeEntry; entries: EventEnvelopeEntry[] }> {
  return visualGroupsForEntries(entries)
    .sort((left, right) => right.visual.cursor - left.visual.cursor);
}

function visualGroupsForEntries(
  entries: EventEnvelopeEntry[],
): Array<{ visual: EventEnvelopeEntry; entries: EventEnvelopeEntry[] }> {
  if (entries.length === 0) {
    return [];
  }
  const director = new BeatDirector();
  director.enqueue([...entries].sort((left, right) => left.cursor - right.cursor), 0);
  return director
    .drain(Number.MAX_SAFE_INTEGER, { flush: true })
    .visualBeatGroups.map((group) => ({
      visual: group.visual,
      entries: [...group.entries].sort((left, right) => left.cursor - right.cursor),
    }));
}

function presentHistoryEvent(
  entry: EventEnvelopeEntry,
  context: EventPresentationContext,
  chainEntries: readonly EventEnvelopeEntry[] = [entry],
): PresentedHistoryEvent {
  const compactDetail = presentEventBubbleDetail(entry, context);
  const chainDetail = presentEventChainDetail(entry, chainEntries);
  return {
    ...presentEvent(entry, context),
    kind: "event",
    cursor: entry.cursor,
    type: entry.event.type,
    entry,
    ...(compactDetail ? { compactDetail } : {}),
    ...(chainDetail ? { chainDetail } : {}),
  };
}

function contextForEntry(
  source: EventPresentationContextSource,
  entry: EventEnvelopeEntry,
): EventPresentationContext {
  return typeof source === "function" ? source(entry) : source;
}

function presentGap(gap: ChronicleHistoryGap): PresentedHistoryGap {
  return {
    kind: "gap",
    id: gap.id,
    reason: gap.reason,
    message: gap.message,
    afterCursor: gap.afterCursor,
    beforeCursor: gap.beforeCursor,
    nextCursor: gap.nextCursor,
    timestamp: gap.timestamp,
    sortCursor: gapSortCursor(gap),
  };
}

function matchesSelection(
  event: PresentedHistoryEvent,
  selection: NonNullable<HistorySelection>,
): boolean {
  switch (selection.kind) {
    case "agent":
      return event.related.agentIds.includes(selection.id);
    case "region":
      return event.related.regionNames.includes(selection.id);
    case "home":
      return event.related.homeIds.includes(selection.id);
  }
}

function matchesHistorySelectionGroup(
  group: PresentedHistoryGroup,
  selection: NonNullable<HistorySelection>,
  context: EventPresentationContext,
): boolean {
  if (group.kind === "gap") {
    return true;
  }
  if (matchesSelection(group.item, selection)) {
    return true;
  }
  return group.entries.some((entry) => matchesSelection(
    presentHistoryEvent(entry, context),
    selection,
  ));
}

function applyLimit<T>(items: T[], limit: number | undefined): T[] {
  if (limit === undefined) {
    return items;
  }
  if (!Number.isFinite(limit) || limit <= 0) {
    return [];
  }
  return items.slice(0, Math.floor(limit));
}

function normalizedCount(value: number | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.floor(value);
}

function addLiveChronicleItem(
  selected: PresentedHistoryItem[],
  selectedKeys: Set<string>,
  item: PresentedHistoryItem,
): boolean {
  const key = presentedHistoryItemKey(item);
  if (selectedKeys.has(key)) {
    return false;
  }
  selectedKeys.add(key);
  selected.push(item);
  return true;
}

function isLiveChronicleSalient(item: PresentedHistoryEvent): boolean {
  return getEventVisualMetadata(item.type)?.salient ?? false;
}

function isLivePulseImportant(item: PresentedHistoryEvent): boolean {
  const metadata = getEventVisualMetadata(item.type);
  return metadata
    ? metadata.salient || metadata.priority === "featured" || metadata.priority === "drama"
    : false;
}

function isEventHistoryGroup(
  group: PresentedHistoryGroup,
): group is PresentedEventHistoryGroup {
  return group.kind === "event";
}

function isGapHistoryGroup(
  group: PresentedHistoryGroup,
): group is PresentedGapHistoryGroup {
  return group.kind === "gap";
}

function isPresentedHistoryEvent(item: PresentedHistoryItem): item is PresentedHistoryEvent {
  return item.kind === "event";
}

function isPresentedHistoryGap(item: PresentedHistoryItem): item is PresentedHistoryGap {
  return item.kind === "gap";
}

function livePulseTopGroups(
  eventGroups: readonly PresentedEventHistoryGroup[],
  limit: number,
): LivePulseGroupCount[] {
  const counts = new Map<EventPresentationGroup, LivePulseGroupCount>();

  for (const group of eventGroups) {
    const existing = counts.get(group.item.group);
    if (existing) {
      existing.count += 1;
      if (group.item.cursor > existing.latestCursor) {
        existing.latestCursor = group.item.cursor;
        existing.latestEventType = group.item.type;
        existing.latestEventLabel = group.item.label;
      }
      continue;
    }
    counts.set(group.item.group, {
      group: group.item.group,
      label: LIVE_PULSE_GROUP_LABELS[group.item.group],
      count: 1,
      latestCursor: group.item.cursor,
      latestEventType: group.item.type,
      latestEventLabel: group.item.label,
    });
  }

  return [...counts.values()]
    .sort((left, right) => (
      right.count - left.count ||
      right.latestCursor - left.latestCursor ||
      left.label.localeCompare(right.label)
    ))
    .slice(0, limit);
}

function selectedFocusTopGroups(
  eventItems: readonly PresentedHistoryEvent[],
  limit: number,
): LivePulseGroupCount[] {
  const counts = new Map<EventPresentationGroup, LivePulseGroupCount>();

  for (const item of eventItems) {
    const existing = counts.get(item.group);
    if (existing) {
      existing.count += 1;
      if (item.cursor > existing.latestCursor) {
        existing.latestCursor = item.cursor;
        existing.latestEventType = item.type;
        existing.latestEventLabel = item.label;
      }
      continue;
    }
    counts.set(item.group, {
      group: item.group,
      label: LIVE_PULSE_GROUP_LABELS[item.group],
      count: 1,
      latestCursor: item.cursor,
      latestEventType: item.type,
      latestEventLabel: item.label,
    });
  }

  return [...counts.values()]
    .sort((left, right) => (
      right.count - left.count ||
      right.latestCursor - left.latestCursor ||
      left.label.localeCompare(right.label)
    ))
    .slice(0, limit);
}

function livePulseCursorBounds(group: PresentedHistoryGroup): Array<[number, number]> {
  if (group.kind === "gap") {
    return [[
      Math.min(group.item.afterCursor, group.item.beforeCursor),
      Math.max(group.item.beforeCursor, group.item.nextCursor),
    ]];
  }
  const cursors = group.entries.map((entry) => entry.cursor);
  return [[
    minOrNull(cursors) ?? group.item.cursor,
    maxOrNull(cursors) ?? group.item.cursor,
  ]];
}

function selectedFocusCursorBounds(item: PresentedHistoryItem): Array<[number, number]> {
  if (item.kind === "gap") {
    return [[
      Math.min(item.afterCursor, item.beforeCursor),
      Math.max(item.beforeCursor, item.nextCursor),
    ]];
  }
  if (item.chainDetail) {
    return [[item.chainDetail.startCursor, item.chainDetail.endCursor]];
  }
  return [[item.cursor, item.cursor]];
}

function boundedLivePulseRecentCount(value: number | undefined): number {
  if (value === undefined) {
    return DEFAULT_LIVE_PULSE_RECENT_COUNT;
  }
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  return Math.min(Math.floor(value), MAX_LIVE_PULSE_RECENT_COUNT);
}

function boundedLivePulseTopGroupLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_LIVE_PULSE_TOP_GROUP_LIMIT;
  }
  return Math.min(
    Math.max(Math.floor(value), MIN_LIVE_PULSE_TOP_GROUP_LIMIT),
    MAX_LIVE_PULSE_TOP_GROUP_LIMIT,
  );
}

function liveNowCue(slot: LiveNowCueSlot, item: PresentedHistoryEvent): LiveNowCue {
  return {
    slot,
    slotLabel: LIVE_NOW_SLOT_LABELS[slot],
    item,
    eventType: item.type,
    label: cueVisibleText(item.label),
    detail: cueVisibleText(item.compactDetail?.text ?? item.label),
    cursor: item.cursor,
  };
}

function emptySelectedFocusPulse(): SelectedFocusPulseSummary {
  return {
    state: "quiet",
    totalSelectedGroupedEventCount: 0,
    cursorWindow: {
      startCursor: null,
      endCursor: null,
      label: "none",
    },
    topGroups: [],
    dominantGroup: null,
    latestEvent: null,
    gaps: {
      state: "none",
      count: 0,
      reason: null,
      reasons: [],
      latest: null,
    },
  };
}

function cueVisibleText(value: string): string {
  return value.replace(/\b(agent|home)_([a-z0-9]+)\b/gi, (_, prefix: string, suffix: string) => (
    `${prefix.toLowerCase() === "agent" ? "being" : "home"} ${suffix}`
  ));
}

function uniqueValues<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function presentedHistoryItemKey(item: PresentedHistoryItem): string {
  return item.kind === "gap" ? `gap:${item.id}` : `event:${item.cursor}`;
}

function archiveWindowSize(windowSize: number | undefined): number {
  if (windowSize === undefined) {
    return Number.MAX_SAFE_INTEGER;
  }
  if (!Number.isFinite(windowSize) || windowSize <= 0) {
    return 0;
  }
  return Math.floor(windowSize);
}

function archiveWindowStart(
  requestedWindowStart: number,
  totalVisibleCount: number,
  windowSize: number,
): number {
  if (!Number.isInteger(requestedWindowStart) || requestedWindowStart < 0) {
    return 0;
  }
  if (totalVisibleCount === 0 || windowSize <= 0) {
    return 0;
  }
  const maxWindowStart = Math.floor((totalVisibleCount - 1) / windowSize) * windowSize;
  const requestedPageStart = Math.floor(requestedWindowStart / windowSize) * windowSize;
  return Math.min(requestedPageStart, maxWindowStart);
}

function gapSortCursor(gap: ChronicleHistoryGap): number {
  return gap.beforeCursor;
}

function historyCursorBounds(item: ChronicleHistoryEntry): Array<[number, number]> {
  if (item.kind === "event") {
    return [[item.entry.cursor, item.entry.cursor]];
  }
  return [[Math.min(item.afterCursor, item.beforeCursor), Math.max(item.beforeCursor, item.nextCursor)]];
}

function historyTimestamp(item: ChronicleHistoryEntry): number[] {
  const timestamp = item.kind === "event" ? item.entry.event.timestamp : item.timestamp;
  const finite = finiteNumberOrNull(timestamp);
  return finite === null ? [] : [finite];
}

function minOrNull(values: number[]): number | null {
  return values.length ? Math.min(...values) : null;
}

function maxOrNull(values: number[]): number | null {
  return values.length ? Math.max(...values) : null;
}

function finiteNumberOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function formatCursorWindow(start: number | null, end: number | null): string {
  return start === null || end === null ? "none" : `${start}-${end}`;
}

function formatEventWindow(start: number | null, end: number | null): string {
  return start === null || end === null ? "none" : `${formatTime(start)}-${formatTime(end)}`;
}

function formatTime(value: number): string {
  return `${value.toFixed(1)}s`;
}

function shortArtifact(path: string | undefined): string {
  if (!path) {
    return "none";
  }
  return path.split("/").at(-1) ?? path;
}
