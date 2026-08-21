import {
  Activity,
  Archive,
  ChevronLeft,
  Clock3,
  Home,
  Skull,
  Sprout,
  Users,
  Wifi,
  WifiOff,
} from "lucide-react";
import {
  type CSSProperties,
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";


import type {
  AgentSnapshot,
  EventEnvelopeEntry,
  HomeSnapshot,
  PendingProposalSnapshot,
  RegionSnapshot,
  RunMetadata,
  WorldSnapshot,
} from "./schemas";
import type { ChronicleHistoryEntry, ConnectionState } from "./store";
import { useLiveRun, useWorldStore } from "./useLiveRun";
import {
  eventPresentationContextFromSnapshots,
  presentEventChainDetail,
  type EventChainDetailPresentation,
  type EventPresentationLookup,
  type EventPresentationContext,
} from "./eventPresentation";
import { rememberEventContextFallbackSnapshot } from "./eventContextSnapshots";
import {
  selectHistoryForSelection,
  selectLiveChronicleItems,
  selectPresentedHistory,
  summarizeLiveNowCues,
  summarizeLivePulse,
  summarizeSelectedFocusPulse,
  summarizeHistoryTimeline,
  type LiveNowCue,
  type LivePulseSummary,
  type PresentedHistoryItem,
  type SelectedFocusPulseSummary,
} from "./historySelectors";
import {
  replayArtifactIdentityKey,
  useReplayMetadata,
  type ReplayArchiveChronicle,
  type ReplayArchiveChronicleItem,
  type ReplayMetadata,
} from "./replayMetadata";
import {
  buildReplayScrubberModel,
  replayCheckpointOptionLabel,
  replayCheckpointOptionValue,
  replayCheckpointSelectorFromValue,
} from "./replayScrubber";
import {
  buildReplayModeEntry,
  type ReplayModeEntry,
} from "./replayMode";
import {
  createLazyEventDemoClient,
  isEventDemoSource,
} from "./lazyEventDemoClient";
import type { ReplaySessionCheckpointSelector } from "./replaySession";
import { BeatDirector } from "../events/beatDirector";
import {
  getEventVisualMetadata,
  type EventVisualIconKey,
} from "../events/eventVisualCatalog";
import {
  FALLBACK_EVENT_VISUAL_ICON_KEY,
  getEventVisualIconDefinition,
  type EventVisualIconDefinition,
} from "../events/eventVisualIcons";
import type {
  RendererSelection,
  WorldRenderer as WorldRendererInstance,
} from "../renderer/WorldRenderer";
import { cleanVisibleText } from "../shared/visibleText";
import { LivingAtlasChrome } from "./livingAtlas/LivingAtlasChrome";
import { StoryRibbon } from "./livingAtlas/StoryRibbon";
import {
  WorldPresencePanelError,
  WorldPresencePanelFallback,
} from "./livingAtlas/WorldPresencePanelFallback";
import {
  focusTargetForBeat,
  selectStoryRibbonBeats,
  type NarrativeBeat,
  type NarrativeViewport,
} from "./livingAtlas/narrativeBeat";
import {
  livingAtlasOverlayReducer,
  type AtlasSelection,
  type LivingAtlasSurface,
} from "./livingAtlas/overlayState";

const FALLBACK_MATING_COOLDOWN_SECONDS = 300;
const FALLBACK_RUINS_PERSIST_SECONDS = 120;
const FALLBACK_HOME_UPKEEP_MATERIALS_PER_SECOND = 0.1;
const INSPECTOR_WORLD_RECENT_LIMIT = 4;
const INSPECTOR_SELECTION_TRAIL_LIMIT = 8;
const INSPECTOR_REGION_TRAIL_LIMIT = 160;
const FALLBACK_EVENT_ACCENT = "#d6b96f";
const FALLBACK_EVENT_GLYPH = "EV";
const FALLBACK_EVENT_ICON_LABEL = "Event";
const FALLBACK_EVENT_MEDALLION_LABEL = "Event";

type WorldPresencePanelModule = typeof import("./livingAtlas/WorldPresencePanel");

type WorldPresencePanelLoadState =
  | { status: "loading" }
  | { status: "ready"; module: WorldPresencePanelModule }
  | { status: "error" };

let worldPresencePanelPromise: Promise<WorldPresencePanelModule> | null = null;
let worldPresencePanelRetryUrl: string | null = null;
let worldPresencePanelRetryGeneration = 0;

function importWorldPresencePanel() {
  return import("./livingAtlas/WorldPresencePanel");
}

function importWorldPresencePanelRetry(): Promise<WorldPresencePanelModule> {
  if (worldPresencePanelRetryUrl === null) {
    return importWorldPresencePanel();
  }
  const url = new URL(worldPresencePanelRetryUrl);
  worldPresencePanelRetryGeneration += 1;
  url.searchParams.set("vivarium_retry", String(worldPresencePanelRetryGeneration));
  return import(/* @vite-ignore */ url.href) as Promise<WorldPresencePanelModule>;
}

function loadWorldPresencePanel(retry = false): Promise<WorldPresencePanelModule> {
  if (worldPresencePanelPromise === null) {
    const request = retry ? importWorldPresencePanelRetry() : importWorldPresencePanel();
    const guarded = request.then(
      (module) => {
        worldPresencePanelRetryUrl = null;
        return module;
      },
      (error: unknown) => {
        worldPresencePanelRetryUrl = retryUrlFromImportError(error)
          ?? worldPresencePanelRetryUrl;
        if (worldPresencePanelPromise === guarded) {
          worldPresencePanelPromise = null;
        }
        throw error;
      },
    );
    worldPresencePanelPromise = guarded;
  }
  return worldPresencePanelPromise;
}

function retryUrlFromImportError(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error);
  const match = message.match(/https?:\/\/[^\s)'",]+/u);
  if (!match) {
    return null;
  }
  try {
    const url = new URL(match[0]);
    return url.origin === window.location.origin ? url.href : null;
  } catch {
    return null;
  }
}

function preloadWorldPresencePanel(): void {
  void loadWorldPresencePanel().catch(() => undefined);
}

function resetWorldPresencePanelLoad(): void {
  worldPresencePanelPromise = null;
}

function WorldPresencePanelSlot({
  agents,
  snapshot,
  onSelect,
}: {
  agents: AgentSnapshot[];
  snapshot: WorldSnapshot | null;
  onSelect(id: string): void;
}) {
  const [attempt, setAttempt] = useState(0);
  const [loadState, setLoadState] = useState<WorldPresencePanelLoadState>({
    status: "loading",
  });
  useEffect(() => {
    let cancelled = false;
    setLoadState({ status: "loading" });
    void loadWorldPresencePanel(attempt > 0).then(
      (module) => {
        if (!cancelled) {
          setLoadState({ status: "ready", module });
        }
      },
      () => {
        if (!cancelled) {
          setLoadState({ status: "error" });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (loadState.status === "loading") {
    return <WorldPresencePanelFallback />;
  }
  if (loadState.status === "error") {
    return (
      <WorldPresencePanelError
        onRetry={() => {
          resetWorldPresencePanelLoad();
          setLoadState({ status: "loading" });
          setAttempt((current) => current + 1);
        }}
      />
    );
  }
  const Panel = loadState.module.WorldPresencePanel;
  return <Panel agents={agents} snapshot={snapshot} onSelect={onSelect} />;
}

export interface FrontendTimingConstants {
  matingCooldownSeconds: number;
  ruinsPersistSeconds: number;
  homeUpkeepMaterialsPerSecond: number;
}

function visibleBackendText(
  value: string | null | undefined,
  fallback = "unknown",
): string {
  const text = typeof value === "string" && value.trim().length > 0
    ? value
    : fallback;
  return cleanVisibleText(text);
}

function visibleIdentifier(
  value: string | null | undefined,
  fallback = "unknown",
): string {
  const text = typeof value === "string" && value.trim().length > 0
    ? value.replaceAll("_", " ")
    : fallback;
  return cleanVisibleText(text);
}

function visibleArtifactLabel(value: string): string {
  return value === "none" ? value : visibleIdentifier(value);
}

type Selection = AtlasSelection | null;

type AppSourceMode = "live-api" | "event-demo";

interface WorldFocusRequest {
  key: number;
  selection: RendererSelection;
}

export function LivingAtlasApp() {
  const store = useWorldStore();
  const sourceMode = useMemo<AppSourceMode>(
    () => (isEventDemoSource(window.location.search) ? "event-demo" : "live-api"),
    [],
  );
  const liveClient = useMemo(
    () => (sourceMode === "event-demo" ? createLazyEventDemoClient() : undefined),
    [sourceMode],
  );
  const state = useLiveRun({ store, client: liveClient });
  const [overlayState, dispatchOverlay] = useReducer(livingAtlasOverlayReducer, {
    surface: { kind: "closed" },
  });
  const selection: Selection = overlayState.surface.kind === "selection"
    ? overlayState.surface.selection
    : null;
  const [worldFocusRequest, setWorldFocusRequest] = useState<WorldFocusRequest | null>(null);
  const focusRequestKeyRef = useRef(0);
  const requestWorldFocus = useCallback((nextSelection: RendererSelection) => {
    focusRequestKeyRef.current += 1;
    setWorldFocusRequest({ key: focusRequestKeyRef.current, selection: nextSelection });
  }, []);
  const selectWorldItem = useCallback((nextSelection: Selection) => {
    if (nextSelection === null) {
      dispatchOverlay({ type: "close" });
      return;
    }
    requestWorldFocus(nextSelection);
    dispatchOverlay({ type: "select", selection: nextSelection });
  }, [requestWorldFocus]);
  const [narrativeViewport, setNarrativeViewport] = useState<NarrativeViewport>("desktop");
  const [replayCheckpointSelector, setReplayCheckpointSelector] =
    useState<ReplaySessionCheckpointSelector | null>(null);
  const [archiveWindowStart, setArchiveWindowStart] = useState(0);
  const artifactIdentityKey = replayArtifactIdentityKey(state.run);
  const eventContextSnapshotCacheRef = useRef<{
    artifactIdentityKey: string | null;
    snapshots: WorldSnapshot[];
  }>({ artifactIdentityKey, snapshots: [] });
  useEffect(() => {
    setReplayCheckpointSelector(null);
    setArchiveWindowStart(0);
  }, [artifactIdentityKey]);
  const replayMetadata = useReplayMetadata(
    state.snapshot && sourceMode !== "event-demo" ? state.run : null,
    {
      selector: replayCheckpointSelector,
      archiveWindowStart,
      onSelectorReconciled: setReplayCheckpointSelector,
    },
  );
  const replayModeEntry = buildReplayModeEntry(replayMetadata);
  const replayArtifactIdentityCurrent =
    replayMetadata.artifactIdentityKey === artifactIdentityKey;
  const archiveStageReady = overlayState.surface.kind === "archive"
    && replayModeEntry.status === "ready"
    && replayMetadata.runId === state.run?.run_id
    && replayArtifactIdentityCurrent;
  const stageSource = archiveStageReady ? "archive" : "live";
  const stageSnapshot = archiveStageReady
    ? replayModeEntry.renderSnapshot
    : state.snapshot;
  const stageEventBeats = archiveStageReady ? [] : state.eventBeats;
  const stageSourceKey = archiveStageReady
    ? [
        "archive",
        replayMetadata.runId,
        artifactIdentityKey ?? "none",
        replayMetadata.workingSetRevision,
        replayModeEntry.checkpointIdentityKind ?? "none",
        replayModeEntry.checkpointIdentity ?? "none",
      ].join(":")
    : `live:${state.run?.run_id ?? "pending"}`;
  const archiveObserverLabel = overlayState.surface.kind === "archive"
    ? archiveStageReady
      ? "Archive view"
      : !replayArtifactIdentityCurrent || replayMetadata.status === "loading"
        ? "Archive loading"
        : replayMetadata.status === "error"
          ? "Archive unavailable"
          : "Archive"
    : null;
  const agents = useMemo(() => [...state.agentsById.values()], [state.agentsById]);
  const regions = useMemo(() => [...state.regionsByName.values()], [state.regionsByName]);
  const homes = useMemo(() => [...state.homesById.values()], [state.homesById]);
  const ruins = useMemo(() => [...state.ruinsById.values()], [state.ruinsById]);
  const eventContextFallbackSnapshots =
    eventContextSnapshotCacheRef.current.artifactIdentityKey === artifactIdentityKey
      ? eventContextSnapshotCacheRef.current.snapshots
      : [];
  const eventPresentationIdentity = useMemo(
    () => JSON.stringify({
      agents: agents.map(({ id, name, position }) => [id, name, position]),
      homes: homes.map(({ home_id, owner_id, region, status, stakeholders }) => (
        [home_id, owner_id, region, status, stakeholders]
      )),
      regions: regions.map(({ name }) => name),
      ruins: ruins.map(({ home_id, owner_id, region, status }) => (
        [home_id, owner_id, region, status]
      )),
    }),
    [agents, homes, regions, ruins],
  );
  const eventContext = useMemo<EventPresentationContext>(
    () => (
      state.snapshot
        ? eventPresentationContextFromSnapshots(state.snapshot, eventContextFallbackSnapshots)
        : {
            agentsById: state.agentsById,
            homesById: state.homesById,
            ruinsById: state.ruinsById,
            regionsByName: state.regionsByName,
          }
    ),
    [artifactIdentityKey, eventPresentationIdentity],
  );
  const presentedHistory = useMemo(
    () => selectPresentedHistory(state.chronicleHistory, eventContext),
    [eventContext, state.chronicleHistory],
  );
  const presentedHistoryRef = useRef(presentedHistory);
  presentedHistoryRef.current = presentedHistory;
  const storyBeats = useMemo(
    () => selectStoryRibbonBeats(presentedHistory, narrativeViewport),
    [narrativeViewport, presentedHistory],
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 700px), (max-height: 420px)");
    const update = () => setNarrativeViewport(media.matches ? "mobile" : "desktop");
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (eventContextSnapshotCacheRef.current.artifactIdentityKey !== artifactIdentityKey) {
      eventContextSnapshotCacheRef.current = { artifactIdentityKey, snapshots: [] };
    }
    if (!state.snapshot) {
      return;
    }
    const snapshot = state.snapshot;
    const previous = eventContextSnapshotCacheRef.current.snapshots;
    eventContextSnapshotCacheRef.current.snapshots =
      rememberEventContextFallbackSnapshot(previous, snapshot);
  }, [artifactIdentityKey, state.snapshot]);
  const retainedGapCount = useMemo(
    () => state.chronicleHistory.filter((item) => item.kind === "gap").length,
    [state.chronicleHistory],
  );
  const liveStatus = useMemo(
    () => buildLiveStatus({
      connection: state.connection,
      needsSnapshot: state.needsSnapshot,
      hasSnapshot: state.snapshot !== null,
      eventCursor: state.eventCursor,
      retainedGapCount,
    }),
    [
      state.connection,
      state.eventCursor,
      state.needsSnapshot,
      state.snapshot,
      retainedGapCount,
    ],
  );
  const chooseStoryBeat = useCallback((beat: NarrativeBeat) => {
    dispatchOverlay({ type: "open", surface: { kind: "chronicle", cursor: beat.cursor } });
    if (beat.focus) {
      requestWorldFocus(beat.focus);
    }
  }, [requestWorldFocus]);
  const chooseWorldBubble = useCallback((cursor: number) => {
    dispatchOverlay({ type: "open", surface: { kind: "chronicle", cursor } });
    const current = presentedHistoryRef.current.find(
      (item) => item.kind === "event" && item.cursor === cursor,
    );
    if (!current || current.kind !== "event") {
      return;
    }
    const focus = focusTargetForBeat(current);
    if (focus) {
      requestWorldFocus(focus);
    }
  }, [requestWorldFocus]);
  const chooseChronicleSelection = useCallback((nextSelection: AtlasSelection) => {
    requestWorldFocus(nextSelection);
    dispatchOverlay({ type: "select", selection: nextSelection });
  }, [requestWorldFocus]);

  const renderInspector = (inspectorSelection: Selection) => (
    <Inspector
      selection={inspectorSelection}
      agents={agents}
      regions={regions}
      homes={homes}
      ruins={ruins}
      pendingProposals={state.snapshot?.pending_proposals ?? []}
      history={state.chronicleHistory}
      context={eventContext}
      eventCursor={state.eventCursor}
      worldTime={state.snapshot?.world_time ?? state.run?.world_time ?? 0}
      artifacts={state.run?.artifacts ?? null}
      replayMetadata={replayMetadata}
      selectedReplayCheckpointSelector={replayCheckpointSelector}
      onReplayCheckpointSelect={setReplayCheckpointSelector}
      constants={state.run?.constants ?? null}
      liveStatus={liveStatus}
    />
  );

  return (
    <main className="observatory" data-source={sourceMode}>
      <section className="world-band" aria-label="Vivarium world">
        <div className="world-stack">
          <WorldStage
            snapshot={stageSnapshot}
            eventBeats={stageEventBeats}
            source={stageSource}
            sourceKey={stageSourceKey}
            selection={selection}
            reducedMotion={sourceMode === "event-demo" ? true : "auto"}
            effectDetail={sourceMode === "event-demo" ? "tour" : "full"}
            onSelect={selectWorldItem}
            onBeatSelect={chooseWorldBubble}
            focusRequest={worldFocusRequest}
            surface={overlayState.surface}
          />
          <StoryRibbon
            beats={overlayState.surface.kind === "archive" ? [] : storyBeats}
            onChoose={chooseStoryBeat}
          />
          <ReplayArtifactDiagnostics metadata={replayMetadata} />
        </div>
      </section>
      <LivingAtlasChrome
        surface={overlayState.surface}
        archiveAvailable={replayMetadata.status !== "idle"}
        onSurfaceIntent={(kind) => {
          if (kind === "world") {
            preloadWorldPresencePanel();
          }
        }}
        onOpen={(surface) => dispatchOverlay({ type: "open", surface })}
        onClose={() => dispatchOverlay({ type: "close" })}
        hud={(
          <TopHud
            agentCount={agents.length}
            livingCount={agents.filter((agent) => agent.status !== "dead").length}
            homeCount={homes.length}
            ruinCount={ruins.length}
            worldTime={state.snapshot?.world_time ?? state.run?.world_time ?? 0}
            liveStatus={liveStatus}
            archiveObserverLabel={archiveObserverLabel}
          />
        )}
        world={(
          <div className="atlas-world-content">
            <WorldPresencePanelSlot
              agents={agents}
              snapshot={state.snapshot}
              onSelect={(id) => selectWorldItem({ kind: "agent", id })}
            />
            {renderInspector(null)}
          </div>
        )}
        chronicle={(
          <Chronicle
            history={state.chronicleHistory}
            context={eventContext}
            currentCursor={overlayState.surface.kind === "chronicle"
              ? overlayState.surface.cursor
              : undefined}
            onChooseSelection={chooseChronicleSelection}
          />
        )}
        selection={renderInspector(selection)}
        archive={(
          <div className="atlas-archive-content">
            <ReplayPreviewPanel entry={replayModeEntry} />
            <ArchiveChroniclePanel
              metadata={replayMetadata}
              onWindowStartChange={setArchiveWindowStart}
            />
            {renderInspector(null)}
          </div>
        )}
      />
    </main>
  );
}

function ReplayArtifactDiagnostics({ metadata }: { metadata: ReplayMetadata }) {
  const diagnostics = metadata.loadDiagnostics;
  return (
    <div
      hidden
      data-testid="replay-artifact-diagnostics"
      data-artifact-load-status={diagnostics.lastSettledStatus}
      data-artifact-load-generation={diagnostics.currentRequestId ?? "none"}
      data-artifact-active-load-generation={diagnostics.activeRequestId ?? "none"}
      data-artifact-completed-load-count={diagnostics.completedLoadCount}
      data-artifact-stale-dropped-load-count={diagnostics.staleDropCount}
      data-artifact-last-completed-generation={diagnostics.lastCompletedRequestId ?? "none"}
      data-artifact-last-settled-generation={diagnostics.lastSettledRequestId ?? "none"}
      data-artifact-last-stale-dropped-generation={diagnostics.lastStaleRequestId ?? "none"}
    />
  );
}

function ArchiveChroniclePanel({
  metadata,
  onWindowStartChange,
}: {
  metadata: ReplayMetadata;
  onWindowStartChange(windowStart: number): void;
}) {
  if (metadata.status === "idle") {
    return null;
  }

  const archive = metadata.archiveChronicle;
  const countLabel = metadata.status === "ready"
    ? archiveChronicleCountLabel(archive)
    : replayArtifactStatusLabel(metadata);

  return (
    <aside
      className={`archive-chronicle archive-chronicle-${metadata.status}`}
      data-testid="archive-chronicle"
      data-archive-window-start={archive.window.windowStart}
      data-archive-window-end={archive.window.windowEnd}
      data-archive-window-size={archive.window.windowSize}
      data-archive-window-count={archive.window.itemCount}
      data-archive-visible-count={archive.visibleCount}
      data-archive-event-count={archive.eventCount}
      data-archive-has-previous={String(archive.window.hasPrevious)}
      data-archive-has-next={String(archive.window.hasNext)}
      data-archive-order={archive.window.order}
      data-archive-raw-cursor-start={archive.window.rawCursorStart ?? "none"}
      data-archive-raw-cursor-end={archive.window.rawCursorEnd ?? "none"}
      data-archive-visible-cursor-start={archive.window.visibleCursorStart ?? "none"}
      data-archive-visible-cursor-end={archive.window.visibleCursorEnd ?? "none"}
      data-archive-status={metadata.status}
      data-archive-error-source={replayArchiveErrorSource(metadata)}
      data-archive-error-present={metadata.error === null ? "false" : "true"}
      aria-label="Archive chronicle"
    >
      <div className="panel-title">
        <span>Archive</span>
        <b>{countLabel}</b>
      </div>
      {metadata.status === "ready" && archive.visibleCount > archive.window.windowSize ? (
        <ArchiveWindowSelect
          archive={archive}
          onWindowStartChange={onWindowStartChange}
        />
      ) : null}
      {metadata.status === "ready" && archive.items.length > 0 ? (
        <div className="archive-event-list">
          {archive.items.map((item) => (
            <ArchiveHistoryRow key={historyItemKey(item)} item={item} />
          ))}
        </div>
      ) : (
        <p>{archiveChronicleMessage(metadata)}</p>
      )}
    </aside>
  );
}

function ArchiveWindowSelect({
  archive,
  onWindowStartChange,
}: {
  archive: ReplayArchiveChronicle;
  onWindowStartChange(windowStart: number): void;
}) {
  const options = archiveWindowOptions(archive);
  if (options.length <= 1) {
    return null;
  }

  return (
    <label className="archive-window-select">
      <span>Window</span>
      <select
        data-testid="archive-window-selector"
        aria-label="Archive window"
        value={String(archive.window.windowStart)}
        onChange={(event) => onWindowStartChange(Number(event.currentTarget.value))}
      >
        {options.map((windowStart) => (
          <option key={windowStart} value={windowStart}>
            {archiveWindowOptionLabel(archive, windowStart)}
          </option>
        ))}
      </select>
    </label>
  );
}

function ArchiveHistoryRow({ item }: { item: ReplayArchiveChronicleItem }) {
  return (
    <HistoryRow
      item={item}
      eventAttributes={archiveProvenanceDataAttributes(item.provenance)}
    >
      <span className="archive-row-provenance">
        {archiveProvenanceLabel(item.provenance)}
      </span>
    </HistoryRow>
  );
}

function ReplayPreviewPanel({
  entry,
}: {
  entry: ReplayModeEntry;
}) {
  if (entry.status !== "ready") {
    return null;
  }

  const exactness = entry.exactness === "exact" ? "Exact" : "Approx";
  const point =
    entry.renderedEventCursor === null || entry.renderedWorldTime === null
      ? "none"
      : `${entry.renderedEventCursor} @ ${formatTime(entry.renderedWorldTime)}`;

  return (
    <aside
      className="replay-preview"
      data-testid="replay-preview"
      data-replay-mode={entry.mode}
      data-replay-entry-status={entry.status}
      data-replay-exactness={entry.exactness}
      data-replay-checkpoint-identity-kind={entry.checkpointIdentityKind ?? "none"}
      data-replay-checkpoint-identity={entry.checkpointIdentity ?? "none"}
      data-replay-checkpoint-index={entry.selectedCheckpointIndex ?? "none"}
      data-replay-checkpoint-line={entry.selectedCheckpointLineNumber ?? "none"}
      data-replay-checkpoint-cursor={entry.checkpointEventCursor ?? "none"}
      data-replay-rendered-cursor={entry.renderedEventCursor ?? "none"}
      aria-label="Archive view"
    >
      <div className="replay-preview-heading">
        <span className="eyebrow">Archive view</span>
        <b>{exactness}</b>
      </div>
      <dl className="replay-preview-point">
        <dt>Last shown point</dt>
        <dd>{point}</dd>
      </dl>
    </aside>
  );
}

function TopHud({
  agentCount,
  livingCount,
  homeCount,
  ruinCount,
  worldTime,
  liveStatus,
  archiveObserverLabel,
}: {
  agentCount: number;
  livingCount: number;
  homeCount: number;
  ruinCount: number;
  worldTime: number;
  liveStatus: LiveStatusModel;
  archiveObserverLabel: string | null;
}) {
  const connected = liveStatus.tone === "live";
  return (
    <header className="top-hud">
      <div className="brand-mark">
        <Activity aria-hidden="true" />
        <span>VIVARIUM</span>
      </div>
      <HudChip icon={<Clock3 aria-hidden="true" />} label="Time" value={worldTime.toFixed(1)} />
      <HudChip icon={<Users aria-hidden="true" />} label="Beings" value={`${livingCount}/${agentCount}`} />
      <HudChip icon={<Home aria-hidden="true" />} label="Homes" value={String(homeCount)} />
      <HudChip icon={<Skull aria-hidden="true" />} label="Ruins" value={String(ruinCount)} />
      {archiveObserverLabel ? (
        <div
          className="observer-source-pill"
          data-observer-source="archive"
          aria-label={archiveObserverLabel}
        >
          <Archive aria-hidden="true" />
          <span>{archiveObserverLabel}</span>
        </div>
      ) : null}
      <div
        className={`connection-pill connection-${liveStatus.tone} ${connected ? "is-live" : ""}`}
        data-live-state={liveStatus.state}
        title={liveStatus.detail}
      >
        {connected ? <Wifi aria-hidden="true" /> : <WifiOff aria-hidden="true" />}
        <span className="connection-label">{liveStatus.shortLabel}</span>
      </div>
    </header>
  );
}

function HudChip({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="hud-chip">
      {icon}
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}

function WorldStage({
  snapshot,
  eventBeats,
  source,
  sourceKey,
  selection,
  reducedMotion,
  effectDetail,
  onSelect,
  onBeatSelect,
  focusRequest,
  surface,
}: {
  snapshot: WorldSnapshot | null;
  eventBeats: EventEnvelopeEntry[];
  source: "live" | "archive";
  sourceKey: string;
  selection: Selection;
  reducedMotion?: boolean | "auto";
  effectDetail?: "full" | "tour";
  onSelect(selection: Selection): void;
  onBeatSelect(cursor: number): void;
  focusRequest: WorldFocusRequest | null;
  surface: LivingAtlasSurface;
}) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<WorldRendererInstance | null>(null);
  const onSelectRef = useRef(onSelect);
  const onBeatSelectRef = useRef(onBeatSelect);
  const latestSnapshotRef = useRef<WorldSnapshot | null>(snapshot);
  const latestSelectionRef = useRef<Selection>(selection);
  const latestFocusRequestRef = useRef<WorldFocusRequest | null>(focusRequest);
  const lastAppliedFocusRequestRef = useRef(0);
  const scheduleSafeFrameRef = useRef<() => void>(() => undefined);
  const beatDirectorRef = useRef(new BeatDirector());
  const pendingDirectorResultsRef = useRef<ReturnType<BeatDirector["drain"]>[]>([]);
  const lastSeenCursorRef = useRef(0);
  const flushTimerRef = useRef<number | undefined>(undefined);

  latestSnapshotRef.current = snapshot;
  latestSelectionRef.current = selection;
  latestFocusRequestRef.current = focusRequest;
  onSelectRef.current = onSelect;
  onBeatSelectRef.current = onBeatSelect;

  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage) {
      return undefined;
    }
    let frame: number | null = null;
    const measure = () => {
      frame = null;
      const renderer = rendererRef.current;
      const canvas = stage.querySelector<HTMLCanvasElement>("canvas");
      if (!renderer || !canvas) {
        return;
      }
      const atlasSurface = stage.ownerDocument.querySelector<HTMLElement>(
        '[data-atlas-surface][data-open="true"]',
      );
      renderer.setSafeFrame(atlasSurface
        ? safeFrameInsetsForIntersection(
            canvas.getBoundingClientRect(),
            atlasSurface.getBoundingClientRect(),
          )
        : EMPTY_SAFE_FRAME);
      const request = latestFocusRequestRef.current;
      if (
        request
        && request.key !== lastAppliedFocusRequestRef.current
        && renderer.focusSelection(request.selection)
      ) {
        lastAppliedFocusRequestRef.current = request.key;
      }
    };
    const schedule = () => {
      if (frame !== null) {
        return;
      }
      frame = window.requestAnimationFrame(measure);
    };
    scheduleSafeFrameRef.current = schedule;
    const observer = new ResizeObserver(schedule);
    observer.observe(stage);
    const atlasSurface = stage.ownerDocument.querySelector<HTMLElement>("[data-atlas-surface]");
    if (atlasSurface) {
      observer.observe(atlasSurface);
    }
    window.addEventListener("resize", schedule);
    schedule();
    return () => {
      scheduleSafeFrameRef.current = () => undefined;
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      if (frame !== null) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, []);

  useLayoutEffect(() => {
    scheduleSafeFrameRef.current();
  }, [focusRequest?.key, surface.kind]);

  function clearFlushTimer() {
    if (flushTimerRef.current !== undefined) {
      window.clearTimeout(flushTimerRef.current);
      flushTimerRef.current = undefined;
    }
  }

  function applyDirectorResult(result: ReturnType<BeatDirector["drain"]>) {
    const renderer = rendererRef.current;
    if (!renderer) {
      if (result.handledCursors.length > 0 || result.visualBeats.length > 0) {
        pendingDirectorResultsRef.current.push(result);
      }
      return;
    }
    const chainDetails = new Map<number, EventChainDetailPresentation>();
    for (const group of result.visualBeatGroups) {
      const chainDetail = presentEventChainDetail(group.visual, group.entries);
      if (chainDetail) {
        chainDetails.set(group.visual.cursor, chainDetail);
      }
    }
    for (const beat of result.visualBeats) {
      renderer.applyEventBeat(beat, {
        chainDetail: chainDetails.get(beat.cursor),
      });
    }
    for (const cursor of result.handledCursors) {
      renderer.markEventCursorHandled(cursor);
    }
  }

  function scheduleDirectorFlush() {
    clearFlushTimer();
    const nextFlushInMs = beatDirectorRef.current.nextFlushInMs();
    if (nextFlushInMs === null) {
      return;
    }
    flushTimerRef.current = window.setTimeout(() => {
      flushTimerRef.current = undefined;
      applyDirectorResult(beatDirectorRef.current.drain());
      scheduleDirectorFlush();
    }, nextFlushInMs + 8);
  }

  function drainDirector() {
    applyDirectorResult(beatDirectorRef.current.drain());
    scheduleDirectorFlush();
  }

  function flushPendingDirectorResults() {
    const pending = pendingDirectorResultsRef.current.splice(0);
    for (const result of pending) {
      applyDirectorResult(result);
    }
  }

  useEffect(() => {
    if (!stageRef.current) {
      return undefined;
    }
    clearFlushTimer();
    beatDirectorRef.current.clear();
    pendingDirectorResultsRef.current = [];
    lastSeenCursorRef.current = latestSnapshotRef.current?.event_cursor ?? 0;
    let cancelled = false;
    void import("../renderer/WorldRenderer").then(({ WorldRenderer }) => {
      if (cancelled || !stageRef.current) {
        return;
      }
      const renderer = new WorldRenderer(stageRef.current, {
        reducedMotion,
        effectDetail,
        renderMode: source === "archive" ? "demand" : "live",
        onSelect: (item: RendererSelection) => {
          onSelectRef.current(item);
        },
        onBeatSelect: (cursor: number) => onBeatSelectRef.current(cursor),
      });
      rendererRef.current = renderer;
      const initialSnapshot = latestSnapshotRef.current;
      renderer.updateSnapshot(initialSnapshot);
      if (initialSnapshot) {
        renderer.markSnapshotCursorHandled(initialSnapshot.event_cursor);
      }
      renderer.setSelected(latestSelectionRef.current);
      scheduleSafeFrameRef.current();
      flushPendingDirectorResults();
      applyDirectorResult(beatDirectorRef.current.drain());
      scheduleDirectorFlush();
    });
    return () => {
      cancelled = true;
      clearFlushTimer();
      beatDirectorRef.current.clear();
      pendingDirectorResultsRef.current = [];
      rendererRef.current?.dispose();
      rendererRef.current = null;
    };
  }, [effectDetail, reducedMotion, source, sourceKey]);

  useEffect(() => {
    rendererRef.current?.updateSnapshot(snapshot);
    const snapshotCursor = snapshot?.event_cursor ?? 0;
    beatDirectorRef.current.advanceCursor(snapshotCursor);
    if (snapshotCursor > lastSeenCursorRef.current) {
      rendererRef.current?.markSnapshotCursorHandled(snapshotCursor);
      lastSeenCursorRef.current = snapshotCursor;
    }
    scheduleDirectorFlush();
  }, [snapshot]);

  useEffect(() => {
    rendererRef.current?.setSelected(selection);
  }, [selection]);

  useEffect(() => {
    const newBeats = eventBeats
      .filter((beat) => beat.cursor > lastSeenCursorRef.current)
      .sort((left, right) => left.cursor - right.cursor);
    if (newBeats.length === 0) {
      return;
    }
    beatDirectorRef.current.enqueue(newBeats);
    lastSeenCursorRef.current = Math.max(lastSeenCursorRef.current, ...newBeats.map((beat) => beat.cursor));
    drainDirector();
  }, [eventBeats]);

  return (
    <div
      ref={stageRef}
      className="world-stage"
      data-testid="world-stage"
      data-stage-source={source}
      role="group"
      tabIndex={0}
      aria-label="Three dimensional Vivarium world"
      onPointerDown={(event) => event.currentTarget.focus({ preventScroll: true })}
    />
  );
}

const EMPTY_SAFE_FRAME = { top: 0, right: 0, bottom: 0, left: 0 } as const;

function safeFrameInsetsForIntersection(
  canvas: DOMRect,
  surface: DOMRect,
): { top: number; right: number; bottom: number; left: number } {
  const intersectionLeft = Math.max(canvas.left, surface.left);
  const intersectionRight = Math.min(canvas.right, surface.right);
  const intersectionTop = Math.max(canvas.top, surface.top);
  const intersectionBottom = Math.min(canvas.bottom, surface.bottom);
  const width = Math.max(0, intersectionRight - intersectionLeft);
  const height = Math.max(0, intersectionBottom - intersectionTop);
  if (width === 0 || height === 0 || canvas.width <= 0 || canvas.height <= 0) {
    return EMPTY_SAFE_FRAME;
  }
  const sideIntersection = height / canvas.height >= width / canvas.width;
  if (sideIntersection) {
    return intersectionLeft + width / 2 >= canvas.left + canvas.width / 2
      ? { ...EMPTY_SAFE_FRAME, right: canvas.right - intersectionLeft }
      : { ...EMPTY_SAFE_FRAME, left: intersectionRight - canvas.left };
  }
  return intersectionTop + height / 2 >= canvas.top + canvas.height / 2
    ? { ...EMPTY_SAFE_FRAME, bottom: canvas.bottom - intersectionTop }
    : { ...EMPTY_SAFE_FRAME, top: intersectionBottom - canvas.top };
}

function Chronicle({
  history,
  context,
  currentCursor,
  onChooseSelection,
}: {
  history: ChronicleHistoryEntry[];
  context: EventPresentationContext;
  currentCursor?: number;
  onChooseSelection(selection: AtlasSelection): void;
}) {
  const chronicleRef = useRef<HTMLElement | null>(null);
  const lastScrolledCursorRef = useRef<number | undefined>(undefined);
  const visible = useMemo(
    () => selectLiveChronicleItems(history, context, { currentCursor }),
    [context, currentCursor, history],
  );
  const pulse = useMemo(() => summarizeLivePulse(history, context), [context, history]);
  const nowCues = useMemo(() => summarizeLiveNowCues(history, context), [context, history]);
  useLayoutEffect(() => {
    if (currentCursor === undefined || lastScrolledCursorRef.current === currentCursor) {
      return;
    }
    const current = chronicleRef.current?.querySelector<HTMLElement>(
      `.event-row[data-event-cursor="${currentCursor}"]`,
    );
    if (!current) {
      return;
    }
    current.scrollIntoView?.({ block: "nearest" });
    lastScrolledCursorRef.current = currentCursor;
  }, [currentCursor, visible]);
  return (
    <aside className="chronicle" ref={chronicleRef}>
      <div className="panel-title">
        <span>Chronicle</span>
        <b>{history.length}</b>
      </div>
      <LivePulse summary={pulse} />
      <LiveNowCues cues={nowCues} />
      <div className="event-list">
        {visible.map((item) => (
          <HistoryRow
            key={historyItemKey(item)}
            item={item}
            current={item.kind === "event" && item.cursor === currentCursor}
            onChooseSelection={onChooseSelection}
          />
        ))}
      </div>
    </aside>
  );
}

function LivePulse({ summary }: { summary: LivePulseSummary }) {
  const dominant = summary.dominantGroup;
  const latest = summary.latestImportantBeat;
  const hasGap = summary.gaps.state === "recent" && summary.gaps.count > 0;
  return (
    <section
      className="live-pulse"
      data-testid="live-pulse"
      data-pulse-state={summary.totalRecentGroupedEventCount > 0 ? "active" : "quiet"}
      data-pulse-count={summary.totalRecentGroupedEventCount}
      data-pulse-window={summary.cursorWindow.label}
      data-pulse-dominant-group={dominant?.group ?? "none"}
      data-pulse-gap-state={summary.gaps.state}
      data-pulse-gap-count={summary.gaps.count}
      data-pulse-retention-state={latest ? "retained" : hasGap ? "gap" : "quiet"}
      data-pulse-retained-event-type={latest?.type ?? "none"}
      data-pulse-retained-event-cursor={latest?.cursor ?? "none"}
      data-pulse-retained-event-label={latest?.label ?? "none"}
    >
      <div className="live-pulse-head">
        <span>World pulse</span>
        <b>{dominant?.label ?? "Quiet"}</b>
        <em>{beatCountLabel(summary.totalRecentGroupedEventCount)}</em>
      </div>
      {summary.topGroups.length > 0 ? (
        <div className="live-pulse-groups">
          {summary.topGroups.map((group) => (
            <LivePulseGroup key={group.group} group={group} />
          ))}
        </div>
      ) : null}
      <div className="live-pulse-footer">
        <span>cursor {summary.cursorWindow.label}</span>
        {hasGap ? (
          <span
            className="live-pulse-gap"
            data-pulse-gap-reason={summary.gaps.reason ?? "none"}
          >
            {summary.gaps.count === 1 ? historyGapLabel(summary.gaps.reason ?? "overflow") : `${summary.gaps.count} breaks`}
          </span>
        ) : null}
      </div>
      {latest ? <LivePulseLatest item={latest} /> : null}
    </section>
  );
}

function LivePulseGroup({
  group,
}: {
  group: LivePulseSummary["topGroups"][number];
}) {
  const visual = eventVisualPresentation(group.latestEventType);
  return (
    <span
      className="live-pulse-group"
      data-pulse-group={group.group}
      data-pulse-group-count={group.count}
      data-pulse-latest-cursor={group.latestCursor}
      data-pulse-event-type={group.latestEventType}
      data-pulse-event-label={group.latestEventLabel}
      data-event-glyph={visual.glyph}
      data-event-icon={visual.iconKey}
      data-event-icon-label={visual.iconLabel}
      data-event-medallion-label={visual.medallionLabel}
      data-event-priority={visual.priority}
      data-event-accent={visual.accent}
      style={visual.style}
    >
      <EventMedallion visual={visual} />
      <span className="live-pulse-group-label">{group.label}</span>
      <b>{group.count}</b>
    </span>
  );
}

function LivePulseLatest({ item }: { item: Extract<PresentedHistoryItem, { kind: "event" }> }) {
  const visual = eventVisualPresentation(item.type);
  const compactDetail = item.compactDetail;
  const chainDetail = item.chainDetail;
  return (
    <div
      className="live-pulse-latest"
      data-pulse-latest="true"
      data-pulse-retention-state="retained"
      data-pulse-event-type={item.type}
      data-pulse-event-group={item.group}
      data-pulse-event-tone={item.tone}
      data-pulse-event-cursor={item.cursor}
      data-pulse-detail-kind={compactDetail?.kind ?? "none"}
      data-pulse-detail-text={compactDetail?.text ?? "none"}
      data-pulse-chain-kind={chainDetail?.kind ?? "none"}
      data-pulse-chain-count={chainDetail?.count ?? 0}
      data-pulse-chain-window={chainDetail?.window ?? "none"}
      data-pulse-chain-text={chainDetail?.text ?? "none"}
      data-event-glyph={visual.glyph}
      data-event-icon={visual.iconKey}
      data-event-icon-label={visual.iconLabel}
      data-event-medallion-label={visual.medallionLabel}
      data-event-priority={visual.priority}
      data-event-accent={visual.accent}
      style={visual.style}
    >
      <EventMedallion visual={visual} />
      <span className="live-pulse-latest-copy">
        <span>{item.label}</span>
        {compactDetail ? <small>{compactDetail.text}</small> : null}
        {chainDetail ? <em>{chainDetail.text}</em> : null}
      </span>
    </div>
  );
}

function LiveNowCues({ cues }: { cues: LiveNowCue[] }) {
  const retainedCue = cues.reduce<LiveNowCue | null>(
    (latest, cue) => latest === null || cue.cursor > latest.cursor ? cue : latest,
    null,
  );
  return (
    <section
      className="live-now"
      data-testid="live-now"
      data-now-state={cues.length > 0 ? "active" : "quiet"}
      data-now-count={cues.length}
      data-now-retention-state={retainedCue ? "retained" : "quiet"}
      data-now-retained-event-type={retainedCue?.eventType ?? "none"}
      data-now-retained-event-cursor={retainedCue?.cursor ?? "none"}
      data-now-retained-event-label={retainedCue?.label ?? "none"}
    >
      <div className="live-now-head">
        <span>Now</span>
        <b>{cues.length > 0 ? `${cues.length} cues` : "Quiet"}</b>
      </div>
      {cues.length > 0 ? (
        <div className="live-now-cues">
          {cues.map((cue) => (
            <LiveNowCueChip key={cue.slot} cue={cue} />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function LiveNowCueChip({ cue }: { cue: LiveNowCue }) {
  const visual = eventVisualPresentation(cue.eventType);
  const compactDetail = cue.item.compactDetail;
  const chainDetail = cue.item.chainDetail;
  return (
    <span
      className="live-now-cue"
      data-now-retention-state="retained"
      data-now-slot={cue.slot}
      data-now-slot-label={cue.slotLabel}
      data-now-event-type={cue.eventType}
      data-now-cursor={cue.cursor}
      data-now-label={cue.label}
      data-now-detail={cue.detail}
      data-now-detail-kind={compactDetail?.kind ?? "none"}
      data-now-detail-text={compactDetail?.text ?? "none"}
      data-now-chain-kind={chainDetail?.kind ?? "none"}
      data-now-chain-count={chainDetail?.count ?? 0}
      data-now-chain-window={chainDetail?.window ?? "none"}
      data-now-chain-text={chainDetail?.text ?? "none"}
      data-event-glyph={visual.glyph}
      data-event-icon={visual.iconKey}
      data-event-icon-label={visual.iconLabel}
      data-event-medallion-label={visual.medallionLabel}
      data-event-priority={visual.priority}
      data-event-accent={visual.accent}
      style={visual.style}
    >
      <EventMedallion visual={visual} />
      <span className="live-now-slot">{cue.slotLabel}</span>
      <span className="live-now-cue-copy">
        <b>{cue.label}</b>
        {compactDetail ? <small>{compactDetail.text}</small> : null}
        {chainDetail ? <em>{chainDetail.text}</em> : null}
      </span>
    </span>
  );
}

function Inspector({
  selection,
  agents,
  regions,
  homes,
  ruins,
  pendingProposals,
  history,
  context,
  eventCursor,
  worldTime,
  artifacts,
  replayMetadata,
  selectedReplayCheckpointSelector,
  onReplayCheckpointSelect,
  constants,
  liveStatus,
}: {
  selection: Selection;
  agents: AgentSnapshot[];
  regions: RegionSnapshot[];
  homes: HomeSnapshot[];
  ruins: HomeSnapshot[];
  pendingProposals: PendingProposalSnapshot[];
  history: ChronicleHistoryEntry[];
  context: EventPresentationContext;
  eventCursor: number;
  worldTime: number;
  artifacts: RunMetadata["artifacts"] | null;
  replayMetadata: ReplayMetadata;
  selectedReplayCheckpointSelector: ReplaySessionCheckpointSelector | null;
  onReplayCheckpointSelect(selector: ReplaySessionCheckpointSelector): void;
  constants: RunMetadata["constants"] | null;
  liveStatus: LiveStatusModel;
}) {
  const timingConstants = useMemo(() => resolveTimingConstants(constants), [constants]);
  const model = useMemo(
    () => buildInspectorModel({
      selection,
      agents,
      regions,
      homes,
      ruins,
      pendingProposals,
      history,
      context,
      worldTime,
      timingConstants,
    }),
    [
      agents,
      context,
      history,
      homes,
      pendingProposals,
      regions,
      ruins,
      selection,
      timingConstants,
      worldTime,
    ],
  );
  return (
    <footer className="inspector" data-selection-kind={model.kind}>
      <div className="inspector-heading">
        <span className="eyebrow">{model.eyebrow}</span>
        <strong>{model.title}</strong>
        <p>{model.subtitle}</p>
      </div>
      <div className="inspector-facts">
        {model.metrics.map((metric) => (
          <FactPill key={metric.label} label={metric.label} value={metric.value} tone={metric.tone} />
        ))}
      </div>
      <div className="inspector-sections">
        {model.sections.map((section) => (
          <section key={section.title} className="fact-section">
            <span>{section.title}</span>
            {section.rows.map((row) => (
              <dl key={row.label}>
                <dt>{row.label}</dt>
                <dd>{row.value}</dd>
              </dl>
            ))}
          </section>
        ))}
      </div>
      <div className="inspector-recent">
        <span className="eyebrow">{model.kind === "world" ? "Recent" : "Recent trail"}</span>
        {model.focusPulse ? (
          <FocusPulse summary={model.focusPulse} selection={selection} selectionKind={model.kind} />
        ) : null}
        {model.recent.length > 0 ? (
          model.recent.map((item) => <HistorySummary key={historyItemKey(item)} item={item} />)
        ) : (
          <p>No retained events for this selection.</p>
        )}
      </div>
      {selection === null ? (
        <div className="inspector-metrics">
          <LiveStatusStrip status={liveStatus} />
          <TimelineStrip
            history={history}
            eventCursor={eventCursor}
            worldTime={worldTime}
            artifacts={artifacts}
            replayMetadata={replayMetadata}
            selectedReplayCheckpointSelector={selectedReplayCheckpointSelector}
            onReplayCheckpointSelect={onReplayCheckpointSelect}
          />
          <Metric icon={<Sprout aria-hidden="true" />} label="Offers" value={pendingProposals.length} />
          <Metric icon={<Activity aria-hidden="true" />} label="Live" value={liveStatus.shortLabel} />
        </div>
      ) : null}
    </footer>
  );
}

function FocusPulse({
  summary,
  selection,
  selectionKind,
}: {
  summary: SelectedFocusPulseSummary;
  selection: Selection;
  selectionKind: InspectorModel["kind"];
}) {
  const latest = summary.latestEvent;
  const dominant = summary.dominantGroup;
  const hasGap = summary.gaps.state === "recent" && summary.gaps.count > 0;
  return (
    <section
      className="focus-pulse"
      data-testid="selected-focus-activity-pulse"
      data-focus-state={summary.state}
      data-focus-kind={selectionKind}
      data-focus-selection-kind={selection?.kind ?? "world"}
      data-focus-selection-id={selection?.id ?? "none"}
      data-focus-count={summary.totalSelectedGroupedEventCount}
      data-focus-window={summary.cursorWindow.label}
      data-focus-dominant-group={dominant?.group ?? "none"}
      data-focus-gap-state={summary.gaps.state}
      data-focus-gap-count={summary.gaps.count}
      data-focus-latest-type={latest?.type ?? "none"}
      data-focus-latest-cursor={latest?.cursor ?? "none"}
      data-focus-pulse-state={summary.state}
      data-focus-pulse-selection-kind={selectionKind}
      data-focus-pulse-count={summary.totalSelectedGroupedEventCount}
      data-focus-pulse-window={summary.cursorWindow.label}
      data-focus-pulse-dominant-group={dominant?.group ?? "none"}
      data-focus-pulse-gap-state={summary.gaps.state}
      data-focus-pulse-gap-count={summary.gaps.count}
      data-focus-pulse-event-type={latest?.type ?? "none"}
      data-focus-pulse-event-cursor={latest?.cursor ?? "none"}
      data-focus-pulse-event-label={latest?.label ?? "none"}
      data-focus-retention-state={latest ? "retained" : hasGap ? "gap" : "quiet"}
      data-focus-retained-event-type={latest?.type ?? "none"}
      data-focus-retained-event-cursor={latest?.cursor ?? "none"}
      data-focus-retained-event-label={latest?.label ?? "none"}
    >
      <div className="focus-pulse-head">
        <span>Focus pulse</span>
        <b>{latest?.label ?? (hasGap ? historyGapLabel(summary.gaps.reason ?? "overflow") : "Quiet")}</b>
        <em>{beatCountLabel(summary.totalSelectedGroupedEventCount)}</em>
      </div>
      {summary.topGroups.length > 0 ? (
        <div className="focus-pulse-groups">
          {summary.topGroups.map((group) => (
            <FocusPulseGroup key={group.group} group={group} />
          ))}
        </div>
      ) : null}
      {latest ? (
        <FocusPulseLatest item={latest} />
      ) : (
        <p>{hasGap ? "Trail break retained." : "Quiet trail."}</p>
      )}
    </section>
  );
}

function FocusPulseGroup({
  group,
}: {
  group: SelectedFocusPulseSummary["topGroups"][number];
}) {
  const visual = eventVisualPresentation(group.latestEventType);
  return (
    <span
      className="focus-pulse-group"
      data-focus-pulse-group={group.group}
      data-focus-group={group.group}
      data-focus-pulse-group-count={group.count}
      data-focus-group-count={group.count}
      data-focus-pulse-latest-cursor={group.latestCursor}
      data-focus-group-latest-cursor={group.latestCursor}
      data-focus-pulse-event-type={group.latestEventType}
      data-focus-group-latest-type={group.latestEventType}
      data-focus-pulse-event-label={group.latestEventLabel}
      data-event-glyph={visual.glyph}
      data-event-icon={visual.iconKey}
      data-event-icon-label={visual.iconLabel}
      data-event-medallion-label={visual.medallionLabel}
      data-event-priority={visual.priority}
      data-event-accent={visual.accent}
      style={visual.style}
    >
      <EventMedallion visual={visual} />
      <span className="focus-pulse-group-label">{group.label}</span>
      <b>{group.count}</b>
    </span>
  );
}

function FocusPulseLatest({ item }: { item: Extract<PresentedHistoryItem, { kind: "event" }> }) {
  const visual = eventVisualPresentation(item.type);
  const compactDetail = item.compactDetail;
  const chainDetail = item.chainDetail;
  return (
    <div
      className="focus-pulse-latest"
      data-focus-pulse-latest="true"
      data-focus-retention-state="retained"
      data-focus-pulse-event-type={item.type}
      data-focus-pulse-event-group={item.group}
      data-focus-pulse-event-tone={item.tone}
      data-focus-pulse-event-cursor={item.cursor}
      data-focus-latest-type={item.type}
      data-focus-latest-group={item.group}
      data-focus-latest-cursor={item.cursor}
      data-focus-pulse-detail-kind={compactDetail?.kind ?? "none"}
      data-focus-pulse-detail-text={compactDetail?.text ?? "none"}
      data-focus-pulse-chain-kind={chainDetail?.kind ?? "none"}
      data-focus-pulse-chain-count={chainDetail?.count ?? 0}
      data-focus-pulse-chain-window={chainDetail?.window ?? "none"}
      data-focus-pulse-chain-text={chainDetail?.text ?? "none"}
      data-event-glyph={visual.glyph}
      data-event-icon={visual.iconKey}
      data-event-icon-label={visual.iconLabel}
      data-event-medallion-label={visual.medallionLabel}
      data-event-priority={visual.priority}
      data-event-accent={visual.accent}
      style={visual.style}
    >
      <EventMedallion visual={visual} />
      <span className="focus-pulse-latest-copy">
        <span>{item.label}</span>
        {compactDetail ? <small>{compactDetail.text}</small> : null}
        {chainDetail ? <em>{chainDetail.text}</em> : null}
      </span>
      <em>{item.group}</em>
    </div>
  );
}

type LiveStatusTone = "live" | "opening" | "recovering" | "paused" | "offline";

interface LiveStatusModel {
  state: ConnectionState | "recovery-paused" | "syncing";
  tone: LiveStatusTone;
  label: string;
  shortLabel: string;
  detail: string;
  note: string;
}

function LiveStatusStrip({ status }: { status: LiveStatusModel }) {
  return (
    <section
      className={`live-status-strip live-status-${status.tone}`}
      data-testid="live-status-strip"
      data-live-state={status.state}
    >
      <div>
        <span className="eyebrow">Live state</span>
        <b>{status.label}</b>
      </div>
      <p>{status.detail}</p>
      <span>{status.note}</span>
    </section>
  );
}

function buildLiveStatus({
  connection,
  needsSnapshot,
  hasSnapshot,
  eventCursor,
  retainedGapCount,
}: {
  connection: ConnectionState;
  needsSnapshot: boolean;
  hasSnapshot: boolean;
  eventCursor: number;
  retainedGapCount: number;
}): LiveStatusModel {
  const cursor = eventCursor > 0 ? `cursor ${eventCursor}` : "first light";
  const retained = retainedGapCount === 1
    ? "1 retained break"
    : `${retainedGapCount} retained breaks`;

  if (needsSnapshot && connection === "error") {
    return {
      state: "recovery-paused",
      tone: "paused",
      label: "Recovery paused",
      shortLabel: "paused",
      detail: "The last world view remains visible while the missing span waits for a fresh view.",
      note: retainedGapCount > 0 ? retained : "World view pending",
    };
  }

  if (needsSnapshot) {
    return {
      state: "syncing",
      tone: "recovering",
      label: "Recovering view",
      shortLabel: "recovering",
      detail: "The live trail moved ahead; the world view is catching up.",
      note: retainedGapCount > 0 ? retained : "Fresh view pending",
    };
  }

  switch (connection) {
    case "live":
      return {
        state: "live",
        tone: "live",
        label: "Live",
        shortLabel: "live",
        detail: `Caught up at ${cursor}.`,
        note: retainedGapCount > 0 ? retained : "No retained breaks",
      };
    case "reconnecting":
      return {
        state: "reconnecting",
        tone: hasSnapshot ? "recovering" : "opening",
        label: hasSnapshot ? "Rejoining" : "Opening view",
        shortLabel: hasSnapshot ? "rejoining" : "opening",
        detail: hasSnapshot
          ? "Holding the last world view while the live trail reconnects."
          : "Waiting for the first world view.",
        note: hasSnapshot ? `Last seen ${cursor}` : "World view pending",
      };
    case "connecting":
    case "idle":
      return {
        state: connection,
        tone: "opening",
        label: "Opening view",
        shortLabel: "opening",
        detail: "Waiting for the first world view.",
        note: "World view pending",
      };
    case "error":
      return {
        state: "error",
        tone: "paused",
        label: hasSnapshot ? "Live paused" : "World unavailable",
        shortLabel: "attention",
        detail: hasSnapshot
          ? "The last world view remains visible while the live trail waits."
          : "The first world view did not arrive.",
        note: hasSnapshot ? `Last seen ${cursor}` : "World view missing",
      };
    case "offline":
      return {
        state: "offline",
        tone: "offline",
        label: "Offline",
        shortLabel: "offline",
        detail: "The live view is no longer connected.",
        note: hasSnapshot ? `Last seen ${cursor}` : "No world view retained",
      };
  }
}

function TimelineStrip({
  history,
  eventCursor,
  worldTime,
  artifacts,
  replayMetadata,
  selectedReplayCheckpointSelector,
  onReplayCheckpointSelect,
}: {
  history: ChronicleHistoryEntry[];
  eventCursor: number;
  worldTime: number;
  artifacts: RunMetadata["artifacts"] | null;
  replayMetadata: ReplayMetadata;
  selectedReplayCheckpointSelector: ReplaySessionCheckpointSelector | null;
  onReplayCheckpointSelect(selector: ReplaySessionCheckpointSelector): void;
}) {
  const timeline = useMemo(
    () => summarizeHistoryTimeline(history, eventCursor, worldTime, artifacts),
    [artifacts, eventCursor, history, worldTime],
  );
  return (
    <div className="timeline-strip" aria-label="Live timeline">
      <span>Live tail</span>
      <dl>
        <dt>Cursor</dt>
        <dd>{timeline.liveEdgeCursor}</dd>
      </dl>
      <dl>
        <dt>Window</dt>
        <dd>{timeline.cursorWindowLabel}</dd>
      </dl>
      <dl>
        <dt>Time</dt>
        <dd>{formatTime(timeline.worldTime)}</dd>
      </dl>
      <dl>
        <dt>Events</dt>
        <dd>{timeline.eventWindowLabel}</dd>
      </dl>
      <dl>
        <dt>Gaps</dt>
        <dd>{timeline.gapCount}</dd>
      </dl>
      <dl>
        <dt>World view</dt>
        <dd>{visibleArtifactLabel(timeline.snapshotArtifactLabel)}</dd>
      </dl>
      <dl>
        <dt>Archive</dt>
        <dd title={replayArtifactStatusTitle(replayMetadata)}>
          {replayArtifactStatusLabel(replayMetadata)}
        </dd>
      </dl>
      <dl>
        <dt>Lines</dt>
        <dd>{replayEventLinesLabel(replayMetadata)}</dd>
      </dl>
      <dl>
        <dt>Points</dt>
        <dd>{replayCheckpointsLabel(replayMetadata)}</dd>
      </dl>
      <dl>
        <dt>First</dt>
        <dd>{replayCheckpointPointLabel(
          replayMetadata,
          replayMetadata.firstCheckpointEventCursor,
          replayMetadata.firstCheckpointWorldTime,
        )}</dd>
      </dl>
      <dl>
        <dt>Last</dt>
        <dd>{replayCheckpointPointLabel(
          replayMetadata,
          replayMetadata.lastCheckpointEventCursor,
          replayMetadata.lastCheckpointWorldTime,
        )}</dd>
      </dl>
      <dl>
        <dt>Proof</dt>
        <dd title={replayRestoreCapabilityTitle(replayMetadata)}>
          {replayRestoreCapabilityLabel(replayMetadata)}
        </dd>
      </dl>
      <dl>
        <dt>Preview</dt>
        <dd title={replayPreviewTitle(replayMetadata)}>
          {replayPreviewLabel(replayMetadata)}
        </dd>
      </dl>
      <ArchivePointSelect
        metadata={replayMetadata}
        selectedSelector={selectedReplayCheckpointSelector}
        onSelect={onReplayCheckpointSelect}
      />
      {replayMetadata.hasOlderCheckpoints ? (
        <button
          type="button"
          className="archive-load-older"
          data-testid="archive-load-older"
          disabled={replayMetadata.olderPageStatus === "loading"}
          title={replayMetadata.olderPageError ?? "Load earlier archive points"}
          onClick={replayMetadata.loadOlderCheckpoints}
        >
          <ChevronLeft aria-hidden="true" size={14} strokeWidth={2} />
          <span>
            {replayMetadata.olderPageStatus === "loading" ? "Loading" : "Earlier points"}
          </span>
        </button>
      ) : null}
      <ArchivePointScrubber
        metadata={replayMetadata}
        selectedSelector={selectedReplayCheckpointSelector}
        onSelect={onReplayCheckpointSelect}
      />
    </div>
  );
}

function ArchivePointSelect({
  metadata,
  selectedSelector,
  onSelect,
}: {
  metadata: ReplayMetadata;
  selectedSelector: ReplaySessionCheckpointSelector | null;
  onSelect(selector: ReplaySessionCheckpointSelector): void;
}) {
  const scrubber = buildReplayScrubberModel(metadata, selectedSelector);
  if (scrubber.status !== "ready") {
    return null;
  }

  return (
    <label className="archive-point-select">
      <span>Archive point</span>
      <select
        data-testid="archive-point-selector"
        aria-label="Archive point"
        value={scrubber.selectedValue}
        onChange={(event) => {
          const selector = replayCheckpointSelectorFromValue(event.currentTarget.value);
          if (selector) {
            onSelect(selector);
          }
        }}
      >
        {metadata.checkpointOptions.map((option) => (
          <option key={`${option.index}:${option.lineNumber ?? "index"}`} value={replayCheckpointOptionValue(option) ?? ""}>
            {replayCheckpointOptionLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function ArchivePointScrubber({
  metadata,
  selectedSelector,
  onSelect,
}: {
  metadata: ReplayMetadata;
  selectedSelector: ReplaySessionCheckpointSelector | null;
  onSelect(selector: ReplaySessionCheckpointSelector): void;
}) {
  const scrubber = buildReplayScrubberModel(metadata, selectedSelector);
  if (scrubber.status !== "ready") {
    return null;
  }

  const selectedPoint = scrubber.selectedPoint;
  return (
    <label
      className="archive-point-scrubber"
      data-testid="archive-point-scrubber"
      data-archive-scrub-status="ready"
      data-archive-scrub-point-count={scrubber.pointCount}
      data-archive-scrub-min={scrubber.min}
      data-archive-scrub-max={scrubber.max}
      data-archive-scrub-step={scrubber.step}
      data-archive-scrub-selected-index={scrubber.selectedIndex}
      data-archive-scrub-selected-value={scrubber.selectedValue}
      data-archive-scrub-selected-checkpoint-index={selectedPoint.checkpointIndex}
      data-archive-scrub-selected-identity-kind={selectedPoint.identityKind}
      data-archive-scrub-selected-identity={selectedPoint.identity}
      data-archive-scrub-selected-line={selectedPoint.lineNumber ?? "none"}
      data-archive-scrub-selected-cursor={selectedPoint.eventCursor}
      data-archive-scrub-selected-time={selectedPoint.worldTime}
      data-archive-scrub-cursor-start={scrubber.cursorStart}
      data-archive-scrub-cursor-end={scrubber.cursorEnd}
      data-archive-scrub-time-start={scrubber.timeStart}
      data-archive-scrub-time-end={scrubber.timeEnd}
    >
      <span>Archive point</span>
      <input
        data-testid="archive-point-scrubber-input"
        type="range"
        min={scrubber.min}
        max={scrubber.max}
        step={scrubber.step}
        value={scrubber.selectedIndex}
        aria-label="Archive point"
        onChange={(event) => {
          const point = scrubber.points[Number(event.currentTarget.value)];
          if (point) {
            onSelect(point.selector);
          }
        }}
      />
      <b>{selectedPoint.label}</b>
    </label>
  );
}

function archiveChronicleCountLabel(archive: ReplayArchiveChronicle): string {
  if (archive.visibleCount === 0) {
    return `0/${archive.eventCount}`;
  }
  if (archive.window.itemCount === archive.visibleCount) {
    return `${archive.visibleCount}/${archive.eventCount}`;
  }
  return `${archive.window.windowStart + 1}-${archive.window.windowEnd}/${archive.visibleCount}`;
}

function archiveWindowOptions(archive: ReplayArchiveChronicle): number[] {
  const windowSize = Math.max(1, archive.window.windowSize);
  const options: number[] = [];
  for (let windowStart = 0; windowStart < archive.visibleCount; windowStart += windowSize) {
    options.push(windowStart);
  }
  return options;
}

function archiveWindowOptionLabel(
  archive: ReplayArchiveChronicle,
  windowStart: number,
): string {
  const windowEnd = Math.min(windowStart + archive.window.windowSize, archive.visibleCount);
  return `${windowStart + 1}-${windowEnd} of ${archive.visibleCount}`;
}

function archiveProvenanceDataAttributes(
  provenance: ReplayArchiveChronicleItem["provenance"],
): EventRowDataAttributes {
  const primary = provenance.primary;
  const source = provenance.presentationSource;
  return {
    "data-archive-context-primary-kind": primary?.sourceKind ?? "none",
    "data-archive-context-primary-index": primary?.checkpointIndex ?? "none",
    "data-archive-context-primary-line": primary?.lineNumber ?? "none",
    "data-archive-context-primary-cursor": primary?.eventCursor ?? "none",
    "data-archive-context-source-kind": source?.sourceKind ?? "none",
    "data-archive-context-source-index": source?.checkpointIndex ?? "none",
    "data-archive-context-source-line": source?.lineNumber ?? "none",
    "data-archive-context-source-cursor": source?.eventCursor ?? "none",
    "data-archive-context-fallback-count": provenance.fallbacks.length,
  };
}

function archiveProvenanceLabel(
  provenance: ReplayArchiveChronicleItem["provenance"],
): string {
  const source = provenance.presentationSource;
  if (!source) {
    return "context none";
  }
  const fallbackSuffix = provenance.fallbacks.length > 0
    ? ` +${provenance.fallbacks.length}`
    : "";
  return `context ${archiveContextSourceLabel(source)}${fallbackSuffix}`;
}

function archiveContextSourceLabel(
  source: NonNullable<ReplayArchiveChronicleItem["provenance"]["presentationSource"]>,
): string {
  const identity = source.sourceKind === "preview_snapshot"
    ? "preview"
    : source.lineNumber === null
      ? `#${(source.checkpointIndex ?? 0) + 1}`
      : `line ${source.lineNumber}`;
  return `${identity} @ ${formatTime(source.worldTime)}`;
}

function archiveChronicleMessage(metadata: ReplayMetadata): string {
  if (metadata.status === "loading") {
    return "Reading archive.";
  }
  if (metadata.status === "error") {
    return "Archive unavailable.";
  }
  return metadata.eventCount > 0 ? "No visible archive lines." : "No archive lines.";
}

function replayArchiveErrorSource(metadata: ReplayMetadata): string {
  if (metadata.status !== "error") {
    return "none";
  }
  return metadata.preview.errorSource ?? "unknown";
}

function replayArtifactStatusLabel(metadata: ReplayMetadata): string {
  if (metadata.status === "error") {
    return "unavailable";
  }
  if (metadata.status === "idle") {
    return "waiting";
  }
  return metadata.status;
}

function replayArtifactStatusTitle(metadata: ReplayMetadata): string | undefined {
  return metadata.status === "error" ? "Archive unavailable" : undefined;
}

function replayEventLinesLabel(metadata: ReplayMetadata): string {
  if (metadata.status === "ready") {
    const range = replayRangeLabel(
      metadata.eventLineCursorStart,
      metadata.eventLineCursorEnd,
    );
    return `${range} (${metadata.eventCount})`;
  }
  return replayPendingLabel(metadata);
}

function replayCheckpointsLabel(metadata: ReplayMetadata): string {
  if (metadata.status !== "ready") {
    return replayPendingLabel(metadata);
  }
  const repeats =
    metadata.duplicateCheckpointCursorCount > 0
      ? `, ${metadata.duplicateCheckpointCursors
          .map((item) => `${item.eventCursor}x${item.count}`)
          .join(",")}`
      : "";
  return `${metadata.checkpointCount} points${repeats}`;
}

function replayCheckpointPointLabel(
  metadata: ReplayMetadata,
  eventCursor: number | null,
  worldTime: number | null,
): string {
  if (metadata.status !== "ready") {
    return replayPendingLabel(metadata);
  }
  if (eventCursor === null || worldTime === null) {
    return "none";
  }
  return `${eventCursor} @ ${formatTime(worldTime)}`;
}

function replayRestoreCapabilityLabel(metadata: ReplayMetadata): string {
  const capability = metadata.restoreCapability;
  if (metadata.status !== "ready") {
    return capability.status === "error" ? "error" : replayPendingLabel(metadata);
  }
  if (capability.status === "none") {
    return "none";
  }
  if (capability.status === "error") {
    return "error";
  }

  const point =
    capability.eventCursor === null || capability.worldTime === null
      ? "checkpoint"
      : `${capability.eventCursor} @ ${formatTime(capability.worldTime)}`;
  const suffix = replayRestoreCapabilitySuffix(metadata);
  return `verified ${point}${suffix}`;
}

function replayRestoreCapabilitySuffix(metadata: ReplayMetadata): string {
  const capability = metadata.restoreCapability;
  if (capability.status !== "ready") {
    return "";
  }
  if (capability.stopReason) {
    return `, ${visibleBackendText(capability.stopReason)}`;
  }
  if (capability.eventOverlayApplied) {
    return `, +${capability.appliedEventCount ?? 0}`;
  }
  return capability.finalStateExact ? ", exact" : "";
}

function replayRestoreCapabilityTitle(metadata: ReplayMetadata): string | undefined {
  const capability = metadata.restoreCapability;
  if (capability.status === "error") {
    return "Proof unavailable";
  }
  if (capability.status !== "ready") {
    return undefined;
  }

  const details = [
    `checkpoint index ${capability.selectedCheckpointIndex}`,
    capability.selectedCheckpointLineNumber === null
      ? null
      : `line ${capability.selectedCheckpointLineNumber}`,
    `applied ${capability.appliedEventCount ?? 0}`,
    `next ${capability.nextExpectedCursor ?? "unknown"}`,
    capability.stoppedBeforeCursor === null
      ? null
      : `stopped before ${capability.stoppedBeforeCursor}`,
    capability.stopReason === null ? null : `stop ${visibleBackendText(capability.stopReason)}`,
    capability.finalStateExact ? "final exact" : "final approximate",
  ].filter((item): item is string => item !== null);

  return details.join("; ");
}

function replayPreviewLabel(metadata: ReplayMetadata): string {
  const preview = metadata.preview;
  if (metadata.status !== "ready") {
    return preview.status === "error" ? "error" : replayPendingLabel(metadata);
  }
  if (preview.status === "none") {
    return "none";
  }
  if (preview.status === "error") {
    return "error";
  }

  const point =
    preview.renderedEventCursor === null || preview.renderedWorldTime === null
      ? "point"
      : `${preview.renderedEventCursor} @ ${formatTime(preview.renderedWorldTime)}`;
  const exactPreview = preview.finalStateExact === true &&
    preview.eventOverlayApplied === false &&
    preview.selectedCheckpointIndex !== null;
  return `${exactPreview ? "ready" : "metadata"} ${point}${replayPreviewSuffix(metadata)}`;
}

function replayPreviewSuffix(metadata: ReplayMetadata): string {
  const preview = metadata.preview;
  if (preview.status !== "ready") {
    return "";
  }
  if (preview.stopReason) {
    return `, ${visibleBackendText(preview.stopReason)}`;
  }
  if (preview.eventOverlayApplied) {
    return `, +${preview.appliedEventCount ?? 0}`;
  }
  return preview.finalStateExact ? ", exact" : "";
}

function replayPreviewTitle(metadata: ReplayMetadata): string | undefined {
  const preview = metadata.preview;
  if (preview.status === "error") {
    return "Preview unavailable";
  }
  if (preview.status !== "ready") {
    return undefined;
  }

  const details = [
    `point index ${preview.selectedCheckpointIndex ?? "unknown"}`,
    preview.selectedCheckpointLineNumber === null
      ? null
      : `line ${preview.selectedCheckpointLineNumber}`,
    preview.checkpointEventCursor === null || preview.checkpointWorldTime === null
      ? null
      : `point ${preview.checkpointEventCursor} @ ${formatTime(preview.checkpointWorldTime)}`,
    preview.renderedEventCursor === null || preview.renderedWorldTime === null
      ? null
      : `shown ${preview.renderedEventCursor} @ ${formatTime(preview.renderedWorldTime)}`,
    `applied ${preview.appliedEventCount ?? 0}`,
    preview.stoppedBeforeCursor === null
      ? null
      : `stopped before ${preview.stoppedBeforeCursor}`,
    preview.stopReason === null ? null : `stop ${visibleBackendText(preview.stopReason)}`,
    preview.finalStateExact ? "exact" : "approximate",
    `unshown beings ${preview.unrenderedAgentCount}`,
    `unshown homes ${preview.unrenderedHomeCount}`,
    `estimated homes ${preview.synthesizedHomeCount}`,
  ].filter((item): item is string => item !== null);

  return details.join("; ");
}

function replayPendingLabel(metadata: ReplayMetadata): string {
  if (metadata.status === "idle") {
    return "waiting";
  }
  if (metadata.status === "loading") {
    return "loading";
  }
  return "unavailable";
}

function replayRangeLabel(start: number | null, end: number | null): string {
  return start === null || end === null ? "none" : `${start}-${end}`;
}

function Metric({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <span className="metric">
      {icon}
      <span>{label}</span>
      <b>{value}</b>
    </span>
  );
}

function FactPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: string;
}) {
  return (
    <span className={`fact-pill ${tone ? `fact-${tone}` : ""}`}>
      <span>{label}</span>
      <b>{value}</b>
    </span>
  );
}

interface InspectorMetric {
  label: string;
  value: string | number;
  tone?: string;
}

interface InspectorSection {
  title: string;
  rows: Array<{ label: string; value: string }>;
}

interface InspectorModel {
  kind: "world" | "being" | "region" | "home" | "ruin" | "missing";
  eyebrow: string;
  title: string;
  subtitle: string;
  metrics: InspectorMetric[];
  sections: InspectorSection[];
  recent: PresentedHistoryItem[];
  focusPulse: SelectedFocusPulseSummary | null;
}

function buildInspectorModel({
  selection,
  agents,
  regions,
  homes,
  ruins,
  pendingProposals,
  history,
  context,
  worldTime,
  timingConstants,
}: {
  selection: Selection;
  agents: AgentSnapshot[];
  regions: RegionSnapshot[];
  homes: HomeSnapshot[];
  ruins: HomeSnapshot[];
  pendingProposals: PendingProposalSnapshot[];
  history: ChronicleHistoryEntry[];
  context: EventPresentationContext;
  worldTime: number;
  timingConstants: FrontendTimingConstants;
}): InspectorModel {
  const recent = (target: Selection | null) => (
    selectHistoryForSelection(
      history,
      target,
      context,
      inspectorRecentLimit(target),
    )
  );
  const focusPulseFor = (target: NonNullable<Selection>) => (
    summarizeSelectedFocusPulse(selectHistoryForSelection(history, target, context))
  );

  if (!selection) {
    const living = agents.filter((agent) => agent.status !== "dead").length;
    return {
      kind: "world",
      eyebrow: "World",
      title: "Vivarium",
      subtitle: `${living}/${agents.length} living beings across ${regions.length} regions`,
      metrics: [
        { label: "Homes", value: homes.length },
        { label: "Ruins", value: ruins.length },
        { label: "Offers", value: pendingProposals.length },
        { label: "Vault", value: formatNumber(homes.reduce((sum, home) => sum + home.vault_materials, 0)) },
      ],
      sections: [
        {
          title: "Retained state",
          rows: [
            { label: "Regions", value: regions.map((region) => visibleIdentifier(region.name)).join(", ") || "none" },
            { label: "Hoarding beings", value: String(agents.filter((agent) => agent.is_hoarding).length) },
            { label: "Heavy vaults", value: String(homes.filter((home) => home.is_hoarding).length) },
          ],
        },
      ],
      recent: recent(null),
      focusPulse: null,
    };
  }

  if (selection.kind === "agent") {
    const selectedRecent = recent(selection);
    const focusPulse = focusPulseFor(selection);
    const agent = agents.find((item) => item.id === selection.id);
    if (!agent) {
      return missingModel(selection, selectedRecent, focusPulse);
    }
    const offers = pendingProposals.filter(
      (proposal) => proposal.initiator_id === agent.id || proposal.target_id === agent.id,
    );
    const home = homes.find((item) => item.home_id === agent.home_id || item.stakeholders.includes(agent.id));
    return {
      kind: "being",
      eyebrow: "Being",
      title: visibleBackendText(agent.name),
      subtitle: `${visibleBackendText(agent.status)} in ${visibleIdentifier(agent.position)}`,
      metrics: [
        { label: "Energy", value: formatNumber(agent.energy), tone: agent.energy <= 5 ? "danger" : undefined },
        { label: "Materials", value: formatNumber(agent.materials) },
        { label: "Flame", value: flameState(agent), tone: agent.status === "paralyzed" ? "warn" : undefined },
        { label: "Hoard", value: agent.is_hoarding ? "yes" : "no", tone: agent.is_hoarding ? "gold" : undefined },
      ],
      sections: [
        {
          title: "State",
          rows: [
            { label: "Place", value: visibleIdentifier(agent.position) },
            { label: "Home stake", value: home ? visibleIdentifier(home.home_id) : "none" },
            { label: "Offspring", value: String(agent.offspring_count) },
            { label: "Cooldown", value: matingCooldown(agent, worldTime, timingConstants) },
          ],
        },
        {
          title: "Pending offers",
          rows: offers.length > 0
            ? offers.map((offer) => ({
                label: offer.initiator_id === agent.id ? "Offered to" : "From",
                value: offerSummary(offer, worldTime, context, agent.id),
              }))
            : [{ label: "Offers", value: "none" }],
        },
      ],
      recent: selectedRecent,
      focusPulse,
    };
  }

  if (selection.kind === "region") {
    const selectedRecent = recent(selection);
    const focusPulse = focusPulseFor(selection);
    const region = regions.find((item) => item.name === selection.id);
    if (!region) {
      return missingModel(selection, selectedRecent, focusPulse);
    }
    const occupants = agents.filter((agent) => agent.position === region.name);
    const localHomes = homes.filter((home) => home.region === region.name);
    const localRuins = ruins.filter((home) => home.region === region.name);
    return {
      kind: "region",
      eyebrow: "Region",
      title: visibleIdentifier(region.name),
      subtitle: visibleBackendText(region.description),
      metrics: [
        { label: "Energy", value: `${formatNumber(region.current_energy)}/${formatNumber(region.max_energy)}` },
        { label: "Materials", value: `${formatNumber(region.current_materials)}/${formatNumber(region.max_materials)}` },
        { label: "Beings", value: occupants.length },
        { label: "Biome", value: biomeLabel(region) },
      ],
      sections: [
        {
          title: "Pools",
          rows: [
            { label: "Energy regen", value: `${formatNumber(region.energy_rate)}/tick` },
            { label: "Material regen", value: `${formatNumber(region.materials_rate)}/tick` },
            { label: "Connections", value: region.connections.map((connection) => visibleIdentifier(connection)).join(", ") || "none" },
          ],
        },
        {
          title: "Occupants",
          rows: [
            { label: "Beings", value: occupants.map((agent) => visibleBackendText(agent.name)).join(", ") || "none" },
            { label: "Homes", value: localHomes.map((home) => visibleIdentifier(home.home_id)).join(", ") || "none" },
            { label: "Ruins", value: localRuins.map((home) => visibleIdentifier(home.home_id)).join(", ") || "none" },
          ],
        },
      ],
      recent: selectedRecent,
      focusPulse,
    };
  }

  const selectedRecent = recent(selection);
  const focusPulse = focusPulseFor(selection);
  const home = homes.find((item) => item.home_id === selection.id);
  if (home) {
    return homeModel(home, false, pendingProposals, worldTime, context, timingConstants, selectedRecent, focusPulse);
  }
  const ruin = ruins.find((item) => item.home_id === selection.id);
  if (ruin) {
    return homeModel(ruin, true, pendingProposals, worldTime, context, timingConstants, selectedRecent, focusPulse);
  }
  return missingModel(selection, selectedRecent, focusPulse);
}

function inspectorRecentLimit(selection: Selection): number {
  if (!selection) {
    return INSPECTOR_WORLD_RECENT_LIMIT;
  }
  return selection.kind === "region"
    ? INSPECTOR_REGION_TRAIL_LIMIT
    : INSPECTOR_SELECTION_TRAIL_LIMIT;
}

function homeModel(
  home: HomeSnapshot,
  ruined: boolean,
  pendingProposals: PendingProposalSnapshot[],
  worldTime: number,
  context: EventPresentationContext,
  timingConstants: FrontendTimingConstants,
  recent: PresentedHistoryItem[],
  focusPulse: SelectedFocusPulseSummary | null,
): InspectorModel {
  const owner = agentName(home.owner_id, context);
  const stakeholderNames = home.stakeholders.map((id) => agentName(id, context));
  const breachers = home.breachers.map((id) => agentName(id, context));
  const health = home.max_integrity > 0 ? Math.round((home.integrity / home.max_integrity) * 100) : 0;
  if (ruined) {
    return {
      kind: "ruin",
      eyebrow: "Ruin",
      title: visibleIdentifier(home.home_id),
      subtitle: `ruin in ${visibleIdentifier(home.region)}`,
      metrics: [
        { label: "Remnant", value: formatNumber(home.remnant_materials), tone: home.remnant_materials > 0 ? "gold" : undefined },
        { label: "Fell at", value: home.ruined_at === null ? "unknown" : formatTime(home.ruined_at) },
        { label: "Age", value: home.ruined_at === null ? "unknown" : formatTime(Math.max(0, worldTime - home.ruined_at)) },
        { label: "Recent", value: recent.filter((item) => item.kind === "event" && item.type === "ruins_scavenged").length },
      ],
      sections: [
        {
          title: "Remains",
          rows: [
            { label: "Former owner", value: owner },
            { label: "Region", value: visibleIdentifier(home.region) },
            { label: "Scavengeable", value: home.remnant_materials > 0 ? "yes" : "picked clean" },
            { label: "Fading", value: ruinSweep(home, worldTime, timingConstants) },
          ],
        },
      ],
      recent,
      focusPulse,
    };
  }
  const homeOffers = pendingProposals.filter((proposal) => home.stakeholders.includes(proposal.initiator_id) || home.stakeholders.includes(proposal.target_id));
  return {
    kind: "home",
    eyebrow: "Home",
    title: visibleIdentifier(home.home_id),
    subtitle: `${visibleBackendText(home.status)} in ${visibleIdentifier(home.region)} · kept by ${owner}`,
    metrics: [
      { label: "Health", value: `${health}%`, tone: health <= 25 ? "warn" : undefined },
      { label: "Vault", value: formatNumber(home.vault_materials), tone: home.is_hoarding ? "gold" : undefined },
      { label: "Tenders", value: home.stakeholders.length },
      { label: "Breachers", value: home.breachers.length, tone: home.breachers.length > 0 ? "danger" : undefined },
    ],
    sections: [
        {
          title: "Household",
          rows: [
            { label: "Owner", value: owner },
            { label: "Stakeholders", value: stakeholderNames.join(", ") || "none" },
            { label: "Pending offers", value: homeOffers.length > 0 ? homeOffers.map((offer) => offerSummary(offer, worldTime, context)).join("; ") : "none" },
          ],
        },
      {
        title: "Upkeep",
        rows: [
          { label: "Integrity", value: `${formatNumber(home.integrity)}/${formatNumber(home.max_integrity)}` },
          { label: "Arrears age", value: formatTime(Math.max(0, worldTime - home.last_upkeep_at)) },
          { label: "Repair direction", value: homeRepairDirection(home, context, worldTime, timingConstants) },
          { label: "Breach state", value: breachers.length > 0 ? breachers.join(", ") : "clear" },
          { label: "Hearth", value: "brief glow on use" },
        ],
      },
    ],
    recent,
    focusPulse,
  };
}

function missingModel(
  selection: NonNullable<Selection>,
  recent: PresentedHistoryItem[],
  focusPulse: SelectedFocusPulseSummary | null,
): InspectorModel {
  return {
    kind: "missing",
    eyebrow: selectionKindLabel(selection),
    title: selection.kind === "agent" ? "Missing being" : visibleIdentifier(selection.id),
    subtitle: "No current snapshot",
    metrics: [],
    sections: [],
    recent,
    focusPulse,
  };
}

function selectionKindLabel(selection: NonNullable<Selection>): string {
  switch (selection.kind) {
    case "agent":
      return "Being";
    case "home":
      return "Home";
    case "region":
      return "Region";
  }
}

type EventRowDataAttributes = Record<`data-${string}`, string | number>;
type EventColorStyle = CSSProperties & { "--event-color": string };

function eventVisualPresentation(type: string): {
  glyph: string;
  iconKey: EventVisualIconKey;
  iconLabel: string;
  medallionLabel: string;
  iconDefinition: EventVisualIconDefinition;
  priority: "ambient" | "featured" | "drama";
  accent: string;
  style: EventColorStyle;
} {
  const metadata = getEventVisualMetadata(type);
  const accent = metadata?.accent ?? FALLBACK_EVENT_ACCENT;
  const iconKey = metadata?.iconKey ?? FALLBACK_EVENT_VISUAL_ICON_KEY;
  return {
    glyph: metadata?.glyph ?? FALLBACK_EVENT_GLYPH,
    iconKey,
    iconLabel: metadata?.iconLabel ?? FALLBACK_EVENT_ICON_LABEL,
    medallionLabel: metadata?.medallionLabel ?? FALLBACK_EVENT_MEDALLION_LABEL,
    iconDefinition: getEventVisualIconDefinition(iconKey),
    priority: metadata?.priority ?? "ambient",
    accent,
    style: { "--event-color": accent },
  };
}

function EventMedallion({
  visual,
}: {
  visual: ReturnType<typeof eventVisualPresentation>;
}) {
  return (
    <span
      className="event-medallion"
      aria-hidden="true"
      data-event-icon={visual.iconKey}
      data-event-icon-label={visual.iconLabel}
      data-event-medallion-label={visual.medallionLabel}
    >
      <svg
        className="event-medallion-icon"
        viewBox={visual.iconDefinition.viewBox}
        aria-hidden="true"
        focusable="false"
      >
        {visual.iconDefinition.paths.map((path, index) => (
          <path key={`${visual.iconKey}-${index}`} d={path.d} />
        ))}
      </svg>
    </span>
  );
}

function HistoryRow({
  item,
  eventAttributes = {},
  children,
  current = false,
  onChooseSelection,
}: {
  item: PresentedHistoryItem;
  eventAttributes?: EventRowDataAttributes;
  children?: ReactNode;
  current?: boolean;
  onChooseSelection?(selection: AtlasSelection): void;
}) {
  if (item.kind === "gap") {
    return (
      <article className="event-row event-gap" data-event-kind="gap">
        <div className="event-row-header">
          <span className="event-type">{historyGapLabel(item.reason)}</span>
          <time>{cursorRange(item.afterCursor, item.nextCursor)}</time>
        </div>
        <p>{item.message}</p>
      </article>
    );
  }
  const visual = eventVisualPresentation(item.type);
  const chainDetail = item.chainDetail;
  const focus = focusTargetForBeat(item);
  const content = (
    <>
      <span className="event-row-header">
        <EventMedallion visual={visual} />
        <span className="event-type">{item.label}</span>
        <span className="event-group">{item.group}</span>
        <time>{item.timestampLabel}</time>
      </span>
      <span className="event-row-detail">{item.detail}</span>
      {chainDetail ? (
        <span className="event-row-chain">{chainDetail.text}</span>
      ) : null}
      {children}
    </>
  );
  return (
    <article
      className={`event-row event-tone-${item.group} event-mood-${item.tone}${focus && onChooseSelection ? " event-row-actionable" : ""}${current ? " event-row-current" : ""}`}
      aria-current={current ? "true" : undefined}
      data-current={current ? "true" : undefined}
      data-event-kind="event"
      data-event-type={item.type}
      data-event-group={item.group}
      data-event-tone={item.tone}
      data-event-cursor={item.cursor}
      data-event-glyph={visual.glyph}
      data-event-icon={visual.iconKey}
      data-event-icon-label={visual.iconLabel}
      data-event-medallion-label={visual.medallionLabel}
      data-event-priority={visual.priority}
      data-event-accent={visual.accent}
      data-event-chain-kind={chainDetail?.kind ?? "none"}
      data-event-chain-count={chainDetail?.count ?? 0}
      data-event-chain-window={chainDetail?.window ?? "none"}
      data-event-chain-text={chainDetail?.text ?? "none"}
      style={visual.style}
      {...eventAttributes}
    >
      {focus && onChooseSelection ? (
        <button
          className="event-row-action"
          type="button"
          data-event-focus-kind={focus.kind}
          data-event-focus-id={focus.id}
          aria-label={`Focus ${item.label}`}
          onClick={() => onChooseSelection(focus)}
        >
          {content}
        </button>
      ) : content}
    </article>
  );
}

function HistorySummary({ item }: { item: PresentedHistoryItem }) {
  if (item.kind === "gap") {
    return (
      <article className="event-summary event-gap" data-event-kind="gap">
        <div className="event-summary-header">
          <b>{historyGapLabel(item.reason)}</b>
          <time>{cursorRange(item.afterCursor, item.nextCursor)}</time>
        </div>
        <p>{item.message}</p>
      </article>
    );
  }
  const visual = eventVisualPresentation(item.type);
  const compactDetail = item.compactDetail;
  const chainDetail = item.chainDetail;
  return (
    <article
      className={`event-summary event-tone-${item.group} event-mood-${item.tone}${compactDetail ? " event-summary-with-detail" : ""}${chainDetail ? " event-summary-with-chain" : ""}`}
      data-event-kind="event"
      data-event-type={item.type}
      data-event-group={item.group}
      data-event-tone={item.tone}
      data-event-cursor={item.cursor}
      data-event-glyph={visual.glyph}
      data-event-icon={visual.iconKey}
      data-event-icon-label={visual.iconLabel}
      data-event-medallion-label={visual.medallionLabel}
      data-event-priority={visual.priority}
      data-event-accent={visual.accent}
      data-event-detail-kind={compactDetail?.kind ?? "none"}
      data-event-detail-text={compactDetail?.text ?? "none"}
      data-event-chain-kind={chainDetail?.kind ?? "none"}
      data-event-chain-count={chainDetail?.count ?? 0}
      data-event-chain-window={chainDetail?.window ?? "none"}
      data-event-chain-text={chainDetail?.text ?? "none"}
      style={visual.style}
    >
      <div className="event-summary-header">
        <EventMedallion visual={visual} />
        <b>{item.label}</b>
        <span>{item.group}</span>
        <time>{item.timestampLabel}</time>
      </div>
      {compactDetail ? (
        <small className="event-summary-detail">{compactDetail.text}</small>
      ) : null}
      <p>{item.detail}</p>
      {chainDetail ? (
        <em className="event-summary-chain">{chainDetail.text}</em>
      ) : null}
    </article>
  );
}

function historyItemKey(item: PresentedHistoryItem): string {
  return item.kind === "gap" ? item.id : `${item.cursor}-${item.type}`;
}

function beatCountLabel(count: number): string {
  return `${count} beat${count === 1 ? "" : "s"}`;
}

function cursorRange(from: number, to: number): string {
  return `${from}-${to}`;
}

function historyGapLabel(reason: "overflow" | "snapshot_required"): string {
  return reason === "overflow" ? "trail break" : "view refresh";
}

function agentName(id: string | undefined, context: EventPresentationContext): string {
  if (!id) {
    return "unknown";
  }
  return visibleBackendText(lookupValue(context.agentsById, id)?.name, "Unknown being");
}

function lookupValue<T>(
  lookup: EventPresentationLookup<T> | undefined,
  key: string,
): T | undefined {
  if (!lookup) {
    return undefined;
  }
  if (typeof (lookup as ReadonlyMap<string, T>).get === "function") {
    return (lookup as ReadonlyMap<string, T>).get(key);
  }
  return (lookup as Readonly<Record<string, T | undefined>>)[key];
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1);
}

function formatTime(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return "unknown";
  }
  return `${value.toFixed(1)}s`;
}

function flameState(agent: AgentSnapshot): string {
  if (agent.status === "dead") {
    return "out";
  }
  if (agent.status === "paralyzed" || agent.energy <= 5) {
    return "fallen";
  }
  if (agent.energy < 20) {
    return "guttering";
  }
  return "steady";
}

function matingCooldown(
  agent: AgentSnapshot,
  worldTime: number,
  timingConstants: FrontendTimingConstants,
): string {
  if (agent.last_mated_at === null) {
    return "ready";
  }
  const remaining = timingConstants.matingCooldownSeconds - Math.max(0, worldTime - agent.last_mated_at);
  return remaining <= 0 ? "ready" : `${formatTime(remaining)} left`;
}

function ruinSweep(
  home: HomeSnapshot,
  worldTime: number,
  timingConstants: FrontendTimingConstants,
): string {
  if (home.ruined_at === null) {
    return "unknown";
  }
  const remaining = timingConstants.ruinsPersistSeconds - Math.max(0, worldTime - home.ruined_at);
  return remaining <= 0 ? "waiting for sweep" : `${formatTime(remaining)} left`;
}

function resolveTimingConstants(
  constants: RunMetadata["constants"] | null,
): FrontendTimingConstants {
  return {
    matingCooldownSeconds: constantOrFallback(
      constants,
      "mating_cooldown_seconds",
      FALLBACK_MATING_COOLDOWN_SECONDS,
    ),
    ruinsPersistSeconds: constantOrFallback(
      constants,
      "ruins_persist_seconds",
      FALLBACK_RUINS_PERSIST_SECONDS,
    ),
    homeUpkeepMaterialsPerSecond: constantOrFallback(
      constants,
      "home_upkeep_materials_per_second",
      FALLBACK_HOME_UPKEEP_MATERIALS_PER_SECOND,
    ),
  };
}

function constantOrFallback(
  constants: RunMetadata["constants"] | null,
  key: string,
  fallback: number,
): number {
  const value = constants?.[key];
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}

function biomeLabel(region: RegionSnapshot): string {
  const text = region.description.toLowerCase();
  if (text.includes("spring")) {
    return "spring refuge";
  }
  if (text.includes("barren") || text.includes("struggling")) {
    return "dry scrub";
  }
  if (text.includes("nuclear") || text.includes("wasteland")) {
    return "ash shard";
  }
  if (text.includes("heavenly") || text.includes("picked")) {
    return "worn green";
  }
  return "temperate";
}

function resourceBundle(resources: Record<string, number>): string {
  const pairs = Object.entries(resources)
    .filter(([, value]) => Number.isFinite(value))
    .map(([key, value]) => `${formatNumber(value)} ${visibleIdentifier(key)}`);
  return pairs.length > 0 ? pairs.join(", ") : "no resources";
}

function offerSummary(
  offer: PendingProposalSnapshot,
  worldTime: number,
  context: EventPresentationContext,
  selectedAgentId?: string,
): string {
  const counterpartId = selectedAgentId
    ? offer.initiator_id === selectedAgentId ? offer.target_id : offer.initiator_id
    : offer.target_id;
  const counterpart = selectedAgentId
    ? agentName(counterpartId, context)
    : `${agentName(offer.initiator_id, context)} to ${agentName(offer.target_id, context)}`;
  const age = typeof offer.timestamp === "number" && Number.isFinite(offer.timestamp)
    ? `open ${formatTime(Math.max(0, worldTime - offer.timestamp))}`
    : "open";
  return `${counterpart} · ${resourceBundle(offer.resources)} · ${age}`;
}

export function homeRepairDirection(
  home: HomeSnapshot,
  context: EventPresentationContext,
  worldTime: number,
  timingConstants: FrontendTimingConstants,
): "contested" | "sound" | "mending" | "wearing down" {
  if (home.breachers.length > 0) {
    return "contested";
  }
  if (home.integrity >= home.max_integrity) {
    return "sound";
  }
  const owed = timingConstants.homeUpkeepMaterialsPerSecond * Math.max(0, worldTime - home.last_upkeep_at);
  const livingStakeholderMaterials = home.stakeholders.reduce(
    (summary, stakeholderId) => {
      const stakeholder = lookupValue(context.agentsById, stakeholderId);
      if (!stakeholder || stakeholder.status === "dead") {
        return summary;
      }
      return {
        count: summary.count + 1,
        materials: summary.materials + stakeholder.materials,
      };
    },
    { count: 0, materials: 0 },
  );
  if (livingStakeholderMaterials.count > 0 && livingStakeholderMaterials.materials >= owed) {
    return "mending";
  }
  return "wearing down";
}
