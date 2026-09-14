import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mocked,
} from "vitest";

import {
  createReplayArtifactClient,
  type ReplayArtifacts,
  type ReplayArtifactClient,
} from "../app/replayArtifactClient";
import {
  createReplaySession,
  type ReplaySession,
} from "../app/replaySession";
import type { LiveApiClient } from "../app/client";
import type { CheckpointApiClient } from "../app/checkpointClient";
import type { EventEnvelope } from "../app/schemas";
import {
  createProductionArchiveObserverSession,
  createProductionObserverSession,
  type ProductionArchiveObserverSessionBundle,
  type ProductionObserverSessionBundle,
} from "../app/observer2d/createProductionObserverSession";
import {
  createObserverShellRuntime,
  type ObserverShellRuntime,
} from "../app/observer2d/observerShellRuntime";
import {
  createCheckpointFeed,
  type CheckpointFeed,
} from "../presentation/CheckpointFeed";
import type { PresentationSessionDiagnostics } from "../presentation/PresentationSession";
import {
  CHRONICLE_IDS,
  getChronicleManifest,
  type ChronicleId,
  type ChronicleManifest,
} from "../presentation/fixtures/chronicleCatalog";
import {
  createFixtureTransport,
  type FixtureTransport,
  type FixtureTransportCallbacks,
} from "../presentation/fixtures/FixtureTransport";
import type { PresentationClock } from "../presentation/storyClock";
import { getProductionStageDebugProbe } from "../renderer2d/production/debug";
import type { AtlasCommitScheduler } from "../renderer2d/production/AtlasCommitScheduler";
import {
  createSharedAtlasPool,
  type SharedAtlasPool,
} from "../renderer2d/production/assets/SharedAtlasPool";
import { PRODUCTION_SCENE_MANIFEST } from "../renderer2d/production/ProductionCanvasSceneFactory";
import {
  createC14ChronicleValidationScenario,
  createC15ChronicleValidationScenario,
} from "./chronicleValidationScenarios";

const REQUIRED_API_FILES = Object.freeze([
  "src/qa/chronicleValidationModel.ts",
  "src/qa/chronicleReviewCues.ts",
  "src/qa/chronicleValidationRuntime.ts",
  "src/qa/chronicleValidationScenarios.ts",
  "src/qa/chronicleValidationProduction.ts",
  "src/qa/ChronicleValidationBar.tsx",
  "src/qa/ChronicleValidationApp.tsx",
  "src/qa/chronicleValidationEntry.tsx",
  "qa-chronicle.html",
] as const);

const missingApiFiles = REQUIRED_API_FILES.filter((file) => (
  !existsSync(resolve(process.cwd(), file))
));
const contractIt = it.skipIf(missingApiFiles.length > 0);

type PlaybackSpeed = 0.5 | 1 | 1.5 | 2;
const CHRONICLE_FAILURE_MAX_TIME = 4_102_444_800;
// Stage install owns one initial RAF, six 1,536-draw terrain turns for the
// canonical 96x96 map, one scenery/continuation turn, and one atomic adoption --
// that was 9 turns when exactly ONE region was productionised.
//
// Re-derived 9 -> 14 (2026-07-31), by measurement, not by inflation. The stage sets
// `worldSheetSnapshots: true`, so `ensureBackgroundSnapshotBuild` runs an independent
// atlas acquire + commit for every non-focused region, and there are now four
// productionised regions (nirvana, nirvana_east, nirvana_west, warm_springs) rather
// than one. Instrumenting `flushUntil` with a 500-turn budget and recording
// `turns.evidence()` at the moment the baseline settled gave the SAME answer at all
// five call sites: `executed: 13` (C01 -> atlas 13 / animationFrame 2; C00 -> atlas 12
// / animationFrame 1). `flushUntil` evaluates the predicate at the TOP of each
// iteration, so settling on the 13th executed turn needs a 14th iteration to observe
// it -- hence 14, which is the exact requirement with no slack. Keeping it exact is
// deliberate: this budget is what catches runaway bootstrap work, so it must be
// re-derived (and this comment updated) whenever a region is added, not padded.
const QA_RENDERER_BOOTSTRAP_TURN_BUDGET = 14;
// C01 owns five story phase deadlines and five corresponding renderer RAF handoffs:
// enter, hold, consequence, recover, and exit. The transient adds one deferred
// acceptance, one collaborator retry clock, and one terminal renderer RAF.
const C01_STORY_PHASE_DEADLINE_TURNS = 5;
const C01_PHASE_RENDER_RAF_HANDOFF_TURNS = 5;
const C01_DEFERRED_ACCEPTANCE_TURNS = 1;
const C01_COLLABORATOR_RETRY_CLOCK_TURNS = 1;
const C01_TERMINAL_RENDERER_RAF_TURNS = 1;
// Re-derived 7 -> 10 (2026-07-31) by measurement, alongside the new background term
// below. Both moved for one named, already-shipped reason: the four-region world
// sheet. When these constants were authored exactly ONE region was productionised,
// so the focused region's transition was a generic-kit load; the focused region a
// C01 cue now enters is a productionised exact region drawn in 1_536-draw chunks
// (`CACHE_PREPARATION_DRAW_BUDGET`), which is more `scheduleAtlasCommitPhase` turns.
// Measured by tagging every `atlasCommitScheduler.schedule` call with its source
// frame and running the cue phase under a 500-turn probe: the focused region issues
// exactly 11 commit-phase turns, i.e. 10 preparation + the 1 adoption below.
const C01_REGION_TRANSITION_CACHE_PREPARATION_TURNS = 10;
const C01_REGION_TRANSITION_ATLAS_ADOPTION_TURNS = 1;
// The stage sets `worldSheetSnapshots: true`, so `ensureBackgroundSnapshotBuild`
// (`CanvasPresentationRenderer.ts`) runs an independent, incremental cache
// preparation for every NON-focused productionised region, draining through the same
// `atlasCommitScheduler` -- and `flushUntil` prefers `atlas` tasks, so that work is
// drained inside the cue phase. This term did not exist when this budget was
// authored, because there was nothing to build in the background.
// Measured per region (probe on `advanceBackgroundSnapshotBuild`, cue phase):
// nirvana 11 + nirvana_west 11 + nirvana_east 7 = 29, with `bgCancel` empty --
// zero cancelled/restarted builds, so these are 29 distinct turns of first-time
// work, not duplication. Identical at every call site and across runs.
const C01_BACKGROUND_WORLD_SHEET_SNAPSHOT_TURNS = 29;
const C01_CUE_TURN_BUDGET = C01_STORY_PHASE_DEADLINE_TURNS
  + C01_PHASE_RENDER_RAF_HANDOFF_TURNS
  + C01_DEFERRED_ACCEPTANCE_TURNS
  + C01_COLLABORATOR_RETRY_CLOCK_TURNS
  + C01_TERMINAL_RENDERER_RAF_TURNS
  + C01_REGION_TRANSITION_CACHE_PREPARATION_TURNS
  + C01_REGION_TRANSITION_ATLAS_ADOPTION_TURNS
  + C01_BACKGROUND_WORLD_SHEET_SNAPSHOT_TURNS;
// One fresh generation owns run/world bootstrap, stream installation, observer
// publication, playback activation, atomic binding publication, and two promise/
// React handoffs. This bound must complete while retired generation work is pending.
const QA_GENERATION_READY_MICROTASK_BUDGET = 8;
// A stale producer can schedule at most its producer callback, bridge dispatch,
// tracked-promise finalizer, and one React/external-store observation handoff.
const QA_STALE_PRODUCER_DRAIN_MICROTASK_BUDGET = 4;
const RETAINED_CONSEQUENCE_REVISION_ERROR =
  "consequence frame was not retained at its exact revision";

interface ReviewMarker {
  readonly key: string;
  readonly label: string;
  readonly kind: "event" | "checkpoint";
  readonly cursor: number;
  readonly presentedTime: number;
}

interface CompletedRecoveryReceipt {
  readonly reason: "queue-overflow";
  readonly digest: Readonly<{
    skipped: Readonly<{ firstCursor: 4; lastCursor: 4 }>;
    majorMoments: readonly [];
    compressedAmbientCount: 1;
  }>;
  readonly snappedCursor: 4;
}

interface AuthoredReviewCue extends ReviewMarker {
  readonly instruction: string;
}

interface ChronicleReviewManifest {
  readonly id: ChronicleId;
  readonly slug: string;
  readonly expectedFinalCursor: number;
  readonly authorityKind: string;
  readonly markers: readonly AuthoredReviewCue[];
}

interface ChronicleValidationQuery {
  readonly renderer: "2d";
  readonly chronicleId: ChronicleId;
}

interface ChronicleFailureTokenInput {
  readonly chronicleId: ChronicleId;
  readonly cursor: number;
  readonly presentedTime: number;
  readonly speed: PlaybackSpeed;
  readonly viewport: Readonly<{ width: number; height: number }>;
}

interface ValidationModelModule {
  readonly CHRONICLE_FAILURE_MAX_TIME: 4_102_444_800;
  parseChronicleValidationQuery(search: string): ChronicleValidationQuery;
  projectChronicleReviewManifest(
    manifest: ChronicleManifest,
    cues?: readonly AuthoredReviewCue[],
  ): ChronicleReviewManifest;
  createChronicleFailureToken(input: ChronicleFailureTokenInput): string;
}

interface ReviewCuesModule {
  readonly CHRONICLE_REVIEW_CUES: Readonly<Record<ChronicleId, readonly AuthoredReviewCue[]>>;
  reviewCuesFor(id: ChronicleId): readonly AuthoredReviewCue[];
}

interface PlaybackSnapshot {
  readonly runId: string;
  readonly source: "live" | "archive";
  readonly sourceKey: string;
  readonly presentedCursor: number;
  readonly presentedTime: number;
}

interface ChroniclePlayback {
  readonly ready: Promise<void>;
  start(): void;
  getSnapshot(): PlaybackSnapshot;
  subscribe(listener: () => void): () => void;
  deliverThroughCursor(cursor: number): void;
  deliverToMarker(marker: ReviewMarker): void;
  pause(): void;
  resume(): void;
  setSpeed(speed: PlaybackSpeed): void;
  dispose(): void;
}

interface ValidationScheduler {
  schedule(delayMs: number, callback: () => void): () => void;
}

interface CooperativePresentationClockScheduler {
  scheduleTurn(callback: () => void): () => void;
}

interface RuntimeSnapshot {
  readonly chronicle: ChronicleReviewManifest;
  readonly generation: number;
  readonly status: "loading" | "ready" | "complete" | "error" | "disposed";
  readonly error: string | null;
  readonly playing: boolean;
  readonly speed: PlaybackSpeed;
  readonly presentedCursor: number;
  readonly presentedTime: number;
  readonly markerIndex: number;
  readonly marker: ReviewMarker | null;
  readonly scenario: ChronicleScenarioView | null;
}

interface ChronicleScenarioControl {
  readonly id:
    | "c14-gap-413"
    | "c14-overflow"
    | "c14-replace"
    | "c14-stale-reject"
    | "c15-prime-live-2"
    | "c15-enter-archive-2"
    | "c15-hidden-live-4"
    | "c15-return-live-4";
  readonly label: string;
  readonly enabled: boolean;
}

interface ChronicleScenarioView {
  readonly kind: "C14" | "C15";
  readonly phase: string;
  readonly controls: readonly ChronicleScenarioControl[];
  readonly mechanicEnvelopeCount: 0;
  readonly lastCompletedRecovery: CompletedRecoveryReceipt | null;
}

interface ChronicleScenarioDriver {
  getView(): ChronicleScenarioView;
  run(id: ChronicleScenarioControl["id"]): Promise<void>;
  dispose(): void;
}

interface ChronicleValidationRuntime {
  readonly ready: Promise<void>;
  getSnapshot(): RuntimeSnapshot;
  subscribe(listener: () => void): () => void;
  start(): Promise<void>;
  selectChronicle(id: ChronicleId): Promise<void>;
  pause(): void;
  resume(): void;
  setSpeed(speed: PlaybackSpeed): void;
  restart(): Promise<void>;
  previousMarker(): Promise<void>;
  nextMarker(): Promise<void>;
  runScenarioPhase(id: ChronicleScenarioControl["id"]): Promise<void>;
  copyFailureToken(viewport: Readonly<{ width: number; height: number }>): string;
  dispose(): void;
}

interface ChronicleQaOwnerDiagnostics {
  readonly disposed: boolean;
  readonly observerDisposed: boolean;
  readonly transportDisposed: boolean;
  readonly replayDisposed: boolean;
  readonly checkpointFeedDisposed: boolean;
  readonly scheduledTaskCount: number;
  readonly activeListenerCount: number;
  readonly mechanicEnvelopeCount: number;
  readonly deliveredEnvelopeCursors: readonly number[];
  readonly observer: (PresentationSessionDiagnostics & Readonly<{
    lastCompletedRecovery: CompletedRecoveryReceipt | null;
  }>) | null;
  readonly staleCallback: Readonly<{
    disposition: "rejected";
    before: unknown;
    after: unknown;
  }> | null;
  readonly c14GapEvidence: Readonly<{
    firstMissingCursor: number;
    lastMissingCursor: number;
  }> | null;
}

interface ChronicleQaObserverBinding {
  readonly generation: number;
  readonly observerRuntime: ObserverShellRuntime;
}

interface ProductionChronicleQaOwner {
  readonly observerRuntime: ObserverShellRuntime;
  readonly validationRuntime: ChronicleValidationRuntime;
  readonly rendererAtlasPool?: SharedAtlasPool;
  readonly rendererAtlasCommitScheduler?: AtlasCommitScheduler;
  readonly ready: Promise<void>;
  getObserverBinding(): ChronicleQaObserverBinding | null;
  subscribeObserverBinding(listener: () => void): () => void;
  start(): Promise<void>;
  settle(): Promise<void>;
  runToTerminal(): Promise<void>;
  diagnostics(): ChronicleQaOwnerDiagnostics;
  dispose(): void;
}

interface ProductionModule {
  createProductionChronicleQaOwner(options: Readonly<{
    initialChronicleId: ChronicleId;
    scheduler?: ValidationScheduler;
    presentationClockScheduler?: CooperativePresentationClockScheduler;
    composition?: ProductionComposition;
  }>): ProductionChronicleQaOwner;
}

interface ProductionComposition {
  readonly createObserverShellRuntime: typeof createObserverShellRuntime;
  readonly createProductionObserverSession: typeof createProductionObserverSession;
  readonly createProductionArchiveObserverSession: typeof createProductionArchiveObserverSession;
  readonly createFixtureTransport: typeof createFixtureTransport;
  readonly createCheckpointFeed: typeof createCheckpointFeed;
  readonly createReplayArtifactClient: typeof createReplayArtifactClient;
  readonly createReplaySession: typeof createReplaySession;
  readonly createC14ChronicleValidationScenario: typeof createC14ChronicleValidationScenario;
  readonly createC15ChronicleValidationScenario: typeof createC15ChronicleValidationScenario;
  readonly createOfflineCheckpointHarnessReceipt: (
    source: QaOfflineOwnerSource,
  ) => QaOfflineOwnerReceipt;
  readonly createOfflineLiveBridgeReceipt: (
    source: QaOfflineOwnerSource,
  ) => QaOfflineOwnerReceipt;
  readonly rendererAtlasPool?: SharedAtlasPool;
  readonly rendererAtlasCommitScheduler?: AtlasCommitScheduler;
}

interface QaOfflineOwnerReceipt {
  readonly dispose: ReturnType<typeof vi.fn<() => void>>;
  diagnostics(): Readonly<{
    disposed: boolean;
    pendingTaskCount: number;
  }>;
}

interface QaOfflineOwnerSource {
  dispose(): void;
  pendingTaskCount(): number;
}

interface ChronicleValidationGenerationLifecycle {
  committed(input: Readonly<{
    manifest: ChronicleManifest;
    generation: number;
    playback: ChroniclePlayback;
  }>): void;
  failed(input: Readonly<{
    manifest: ChronicleManifest;
    generation: number;
    error: unknown;
  }>): void;
}

interface RuntimeModule {
  createChronicleValidationRuntime(options: Readonly<{
    initialChronicleId: ChronicleId;
    getManifest(id: ChronicleId): ChronicleManifest;
    createPlayback(input: Readonly<{
      manifest: ChronicleManifest;
      generation: number;
    }>): ChroniclePlayback;
    createScenario?(manifest: ChronicleManifest): ChronicleScenarioDriver | null;
    scheduler: ValidationScheduler;
    generationLifecycle?: ChronicleValidationGenerationLifecycle;
  }>): ChronicleValidationRuntime;
}

interface ScenarioEndpoint {
  readonly source: "live" | "archive";
  readonly runId: string;
  readonly sourceKey: string;
  readonly cursor: number;
  readonly ownerId: string;
}

interface C14ScenarioPort {
  recoverGapAndCheckpoint413(): Promise<Readonly<{
    presentedCursor: 2;
    gap: Readonly<{ firstCursor: 1; lastCursor: 2 }>;
    checkpointStatus: 413;
    checkpointFaultCount: 1;
    recoveryStatus: "frozen-retry";
    recoveryDigest: Readonly<{ firstCursor: 3; lastCursor: 3 }>;
  }>>;
  retryCheckpoint413ThenRecoverOverflow(): Promise<Readonly<{
    checkpointRetryCount: 1;
    checkpointRecoveredCursor: 3;
    presentedCursor: 4;
    overflow: true;
    snapshotRequired: true;
    lastCompletedRecovery: CompletedRecoveryReceipt;
  }>>;
  replaceRun(): Promise<Readonly<{
    previousRunId: string;
    replacementRunId: string;
    supersededGeneration: number;
  }>>;
  dispatchStaleCallback(supersededGeneration: number): Promise<Readonly<{
    accepted: false;
    selected: ScenarioEndpoint;
    live: ScenarioEndpoint & Readonly<{ source: "live" }>;
  }>>;
}

interface C14Scenario {
  recoverGapAndCheckpoint413(): Promise<void>;
  retryCheckpoint413ThenRecoverOverflow(): Promise<void>;
  replaceRun(): Promise<void>;
  rejectStaleCallback(): Promise<void>;
  getSnapshot(): Readonly<{
    kind: "C14";
    phase: string;
    completed: boolean;
    records: readonly Readonly<{ label: string; mechanicEventsFabricated: false }>[];
    selected: ScenarioEndpoint | null;
    live: ScenarioEndpoint | null;
    lastCompletedRecovery: CompletedRecoveryReceipt | null;
  }>;
  dispose(): void;
}

interface C15ScenarioFrame {
  readonly selected: ScenarioEndpoint;
  readonly live: ScenarioEndpoint & Readonly<{ source: "live" }>;
}

interface C15ScenarioPort {
  primeLiveCursor(cursor: 2): Promise<C15ScenarioFrame>;
  enterArchiveAt(cursor: 2): Promise<C15ScenarioFrame>;
  advanceLiveWhileArchived(cursor: 4): Promise<C15ScenarioFrame>;
  returnToLive(): Promise<C15ScenarioFrame>;
}

interface C15Scenario {
  primeLiveCursor(): Promise<void>;
  enterArchive(): Promise<void>;
  advanceLiveWhileArchived(): Promise<void>;
  returnToLive(): Promise<void>;
  getSnapshot(): Readonly<{
    kind: "C15";
    phase: string;
    completed: boolean;
    selected: ScenarioEndpoint | null;
    live: ScenarioEndpoint | null;
  }>;
  dispose(): void;
}

interface ScenariosModule {
  createC14ChronicleValidationScenario(input: Readonly<{
    manifest: ChronicleManifest;
    port: C14ScenarioPort;
  }>): C14Scenario;
  createC15ChronicleValidationScenario(input: Readonly<{
    manifest: ChronicleManifest;
    port: C15ScenarioPort;
  }>): C15Scenario;
}

interface ValidationBarModule {
  ChronicleValidationBar: React.ComponentType<Readonly<{
    runtime: ChronicleValidationRuntime;
    copyText?: (value: string) => Promise<void>;
    readViewport?: () => Readonly<{ width: number; height: number }>;
  }>>;
}

interface ValidationAppModule {
  ChronicleValidationApp: React.ComponentType<Readonly<{
    owner: ProductionChronicleQaOwner;
    copyText?: (value: string) => Promise<void>;
    readViewport?: () => Readonly<{ width: number; height: number }>;
    WorldApp?: React.ComponentType<Readonly<{
      createRuntime: () => ObserverShellRuntime;
    }>>;
  }>>;
}

interface MountedChronicleValidationRoute {
  readonly owner: ProductionChronicleQaOwner;
  unmount(): Promise<void>;
}

interface ValidationRouteModule {
  mountChronicleValidationRoute(options: Readonly<{
    root: HTMLElement;
    composition?: ProductionComposition;
    scheduler?: ValidationScheduler;
    presentationClockScheduler?: CooperativePresentationClockScheduler;
    parseQuery?: ValidationModelModule["parseChronicleValidationQuery"];
  }>): Promise<MountedChronicleValidationRoute>;
  bootChronicleValidationRoute(options?: Readonly<{
    composition?: ProductionComposition;
    scheduler?: ValidationScheduler;
    presentationClockScheduler?: CooperativePresentationClockScheduler;
    parseQuery?: ValidationModelModule["parseChronicleValidationQuery"];
    onMounted?(mounted: MountedChronicleValidationRoute): void;
  }>): Promise<MountedChronicleValidationRoute>;
}

interface ValidationEntryModule {
  readonly chronicleValidationBoot: Promise<MountedChronicleValidationRoute> | null;
}

interface ChronicleValidationBootInjection {
  readonly composition: ProductionComposition;
  readonly presentationClockScheduler?: CooperativePresentationClockScheduler;
  readonly parseQuery: ValidationModelModule["parseChronicleValidationQuery"];
  readonly onMounted: (mounted: MountedChronicleValidationRoute) => void;
}

type InstrumentedFixtureTransport = Mocked<FixtureTransport>;
type InstrumentedObserverRuntime = ObserverShellRuntime & Readonly<{
  qaIdentity: symbol;
  subscriptionDisposals: Array<ReturnType<typeof vi.fn<() => void>>>;
  subscribe: ReturnType<typeof vi.fn<ObserverShellRuntime["subscribe"]>>;
  diagnostics: ReturnType<typeof vi.fn<ObserverShellRuntime["diagnostics"]>>;
  dispose: ReturnType<typeof vi.fn<ObserverShellRuntime["dispose"]>>;
}>;
type InstrumentedCheckpointFeed = Mocked<CheckpointFeed> & Readonly<{
  qaIdentity: symbol;
}>;
type InstrumentedLiveBundle = ProductionObserverSessionBundle & Readonly<{
  session: ProductionObserverSessionBundle["session"] & Readonly<{
    retryRecovery: ReturnType<typeof vi.fn<ProductionObserverSessionBundle["session"]["retryRecovery"]>>;
  }>;
  getPlacementOwner: ReturnType<typeof vi.fn<ProductionObserverSessionBundle["getPlacementOwner"]>>;
  getResources: ReturnType<typeof vi.fn<ProductionObserverSessionBundle["getResources"]>>;
  getRunSeed: ReturnType<typeof vi.fn<ProductionObserverSessionBundle["getRunSeed"]>>;
  replaceRun: ReturnType<typeof vi.fn<ProductionObserverSessionBundle["replaceRun"]>>;
  dispose: ReturnType<typeof vi.fn<ProductionObserverSessionBundle["dispose"]>>;
}>;
type InstrumentedArchiveBundle = ProductionArchiveObserverSessionBundle & Readonly<{
  getPlacementOwner: ReturnType<typeof vi.fn<ProductionArchiveObserverSessionBundle["getPlacementOwner"]>>;
  getResources: ReturnType<typeof vi.fn<ProductionArchiveObserverSessionBundle["getResources"]>>;
  dispose: ReturnType<typeof vi.fn<ProductionArchiveObserverSessionBundle["dispose"]>>;
}>;
type InstrumentedReplayClient = Mocked<ReplayArtifactClient> & Readonly<{
  qaIdentity: symbol;
  dispose: ReturnType<typeof vi.fn<() => void>>;
  diagnostics(): Readonly<{ disposed: boolean }>;
}>;
type InstrumentedReplaySession = Mocked<ReplaySession> & Readonly<{
  qaIdentity: symbol;
}>;
type InstrumentedC14Scenario = ReturnType<typeof createC14ChronicleValidationScenario> & Readonly<{
  dispose: ReturnType<typeof vi.fn<() => void>>;
}>;
type InstrumentedC15Scenario = ReturnType<typeof createC15ChronicleValidationScenario> & Readonly<{
  dispose: ReturnType<typeof vi.fn<() => void>>;
}>;
type InstrumentedOfflineOwnerSource = Readonly<{
  dispose: ReturnType<typeof vi.fn<() => void>>;
  pendingTaskCount(): number;
}>;
type ReceivedReplayArtifacts = ReplayArtifacts & Readonly<{ qaReceipt: symbol }>;
type InstrumentedFixtureProducer = Readonly<{
  callbacks: FixtureTransportCallbacks;
  envelopePayloads: EventEnvelope[];
  checkpointPayloads: Parameters<FixtureTransportCallbacks["onCheckpointAccepted"]>[0][];
}>;

let root: Root | null = null;
let container: HTMLDivElement | null = null;
let reactActWarnings: string[] = [];

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  reactActWarnings = [];
  const originalConsoleError = console.error.bind(console);
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    const message = args.map((value) => String(value)).join(" ");
    if (/not wrapped in act|wrap(?:ped)? .* in act/i.test(message)) {
      reactActWarnings.push(message);
      return;
    }
    originalConsoleError(...args);
  });
  container = document.createElement("div");
  document.body.append(container);
});

afterEach(async () => {
  let cleanupFailure: unknown = null;
  try {
    if (root !== null) await act(async () => root?.unmount());
  } catch (error) {
    cleanupFailure = error;
  }
  root = null;
  container?.remove();
  container = null;
  window.history.replaceState(null, "", "/");
  Reflect.deleteProperty(window, "__vivariumChronicleValidationBootForTest");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  if (cleanupFailure !== null) throw cleanupFailure;
  expect(reactActWarnings, "React external-store updates must remain inside act").toEqual([]);
});

// --- Declared wall-clock bounds for the heavy production-route tests ------------
// Every bound below is a MEASURED cost, re-derived on 2026-08-21 after CI failed six
// tests in this file that all pass locally. Two numbers per test: "isolated" is this
// file run alone on an idle machine (x3); "contended" is the same test inside
// `vitest run` over all 233 files, measured twice with every timeout lifted so nothing
// is truncated and the real cost is visible.
//
//   test                                   isolated x3 (ms)      contended (ms)
//   `yields immediate-clock collaborator…` 1,807/1,832/1,862      4,414 /  4,511
//   `boots C00 through the entry API…`     2,141/2,170/2,159      5,363 /  5,708
//   `route-binds C14 controls…`            2,079/2,022/2,050      5,458 /  5,921
//   `route-binds C15 controls…`            2,195/2,233/2,184      6,163 /  5,888
//   `disposes every C14/C15 owner…`        8,648/8,685/8,729     26,338 / 25,811
//   `sends all C16 envelopes…`             6,812/6,821/6,941     14,993 / 17,701
//
// The GitHub runner is measured at a further **1.5x** this machine: per-test floors
// 1.16-1.48x on the tests CI killed, and whole-file totals 1.25x (this file: 79,116 ms
// here vs 98,521 ms there) and 1.35x (`homeContestSystem.test.ts`). Each bound is
// therefore `ceil(heaviest contended x 1.5 runner factor x 2 run-to-run variance)`.
//
// `disposes every C14/C15 owner…` is the important one: it carried `15_000`, and its
// measured cost inside the full suite is 25,811-26,338 ms. The bound was BELOW the
// test's own contended cost on this machine, so it could only ever have passed when the
// suite happened to be quiet. It is not slow because it is broken -- with the bound
// lifted it passes and the whole file goes 42/42.
//
// These declare wall-clock costs only. No assertion, matcher, fixture or skip changes;
// the other 36 tests in this file keep vitest's 5,000 ms default; and a genuine hang
// still fails at the bound instead of running forever.
const QA_PRODUCTION_ROUTE_BINDING_TIMEOUT_MS = 20_000;
const QA_PRODUCTION_OWNER_DISPOSAL_TIMEOUT_MS = 80_000;
const QA_C16_PRESSURE_TIMEOUT_MS = 55_000;

describe("development-only Chronicle validation route", () => {
  it("declares the complete QA API before dependent contracts execute", () => {
    expect(missingApiFiles, "Chronicle QA API missing; implement only after this RED is reviewed")
      .toEqual([]);
  });

  contractIt("accepts exactly renderer=2d and every frozen C00-C19 ID", async () => {
    const { parseChronicleValidationQuery } = await loadModelModule();

    for (const chronicleId of CHRONICLE_IDS) {
      expect(parseChronicleValidationQuery(
        `?renderer=2d&chronicle=${chronicleId}`,
      )).toEqual({ renderer: "2d", chronicleId });
    }
  });

  contractIt("rejects missing, blank, duplicate, padded, lowercase, unknown, and extra route fields", async () => {
    const { parseChronicleValidationQuery } = await loadModelModule();
    const invalid = [
      "",
      "?renderer=2d",
      "?chronicle=C01",
      "?renderer=2d-slice&chronicle=C01",
      "?renderer=2d&renderer=2d&chronicle=C01",
      "?renderer=2d&chronicle=",
      "?renderer=2d&chronicle=C01&chronicle=C01",
      "?renderer=2d&chronicle=C01&chronicle=C02",
      "?renderer=2d&chronicle=%20C01%20",
      "?renderer=2d&chronicle=c01",
      "?renderer=2d&chronicle=C20",
      "?renderer=2d&chronicle=C01&debug=true",
      "?renderer=2d&chronicle=C01&speed=2",
      "?renderer=2d&chronicle=C01&chronicle%7Csecret=C02",
    ];

    for (const search of invalid) {
      expect(() => parseChronicleValidationQuery(search), search).toThrow(
        /renderer=2d|chronicle|C00-C1[789]/i,
      );
    }
  });

  contractIt("projects bounded authored human cues in chronological playback order", async () => {
    const { projectChronicleReviewManifest } = await loadModelModule();
    const { CHRONICLE_REVIEW_CUES, reviewCuesFor } = await loadReviewCuesModule();
    const projection = projectChronicleReviewManifest(getChronicleManifest("C01"));

    expect(Object.keys(CHRONICLE_REVIEW_CUES)).toEqual(CHRONICLE_IDS);
    for (const id of CHRONICLE_IDS) {
      const manifest = getChronicleManifest(id);
      const cues = reviewCuesFor(id);
      expect(cues.length, `${id} bounded human cues`).toBeGreaterThanOrEqual(1);
      expect(cues.length, `${id} bounded human cues`).toBeLessThanOrEqual(5);
      expect(new Set(cues.map(({ label }) => label)).size).toBe(cues.length);
      expect(new Set(cues.map(({ cursor }) => cursor)).size).toBe(cues.length);
      cues.forEach((cue, index) => {
        expect(cue.label.trim().length).toBeGreaterThan(0);
        expect(cue.instruction.trim().length).toBeGreaterThan(0);
        expect(cue.cursor).toBeGreaterThanOrEqual(0);
        expect(cue.cursor).toBeLessThanOrEqual(
          manifest.expectedTerminal.presentationAuthority.terminal.cursor,
        );
        const exactFixtureAuthority = cue.kind === "event"
          ? manifest.entries.some((entry) => (
              entry.cursor === cue.cursor && entry.event.timestamp === cue.presentedTime
            ))
          : manifest.checkpoints.some((record) => (
              record.checkpoint.event_cursor === cue.cursor
              && record.checkpoint.world_time === cue.presentedTime
            ));
        expect(
          exactFixtureAuthority,
          `${id} ${cue.key} must bind an exact fixture ${cue.kind} cursor and timestamp`,
        ).toBe(true);
        const previous = cues[index - 1];
        if (previous !== undefined) {
          expect([cue.cursor, cue.presentedTime]).toSatisfy(([cursor, time]) => (
            cursor > previous.cursor
            || cursor === previous.cursor && time >= previous.presentedTime
          ));
        }
      });
    }
    expect(projection).toMatchObject({
      id: "C01",
      slug: "movement-local-path",
      expectedFinalCursor: 2,
      authorityKind: "mechanic-story",
      markers: [
        { key: "departure", label: "Departure", kind: "event", cursor: 1 },
        { key: "arrival", label: "Arrival", kind: "event", cursor: 2 },
      ],
    });
    expect(projection.markers).toEqual(reviewCuesFor("C01"));
    expect(Object.isFrozen(projection.markers)).toBe(true);
  });

  contractIt("fails closed when authored human cues are unordered, duplicated, or lack fixture authority", async () => {
    const { projectChronicleReviewManifest } = await loadModelModule();
    const c01 = getChronicleManifest("C01");
    const valid = [
      { key: "departure", label: "Departure", instruction: "See departure.", kind: "event" as const, cursor: 1, presentedTime: 1_800_010_000 },
      { key: "arrival", label: "Arrival", instruction: "See arrival.", kind: "event" as const, cursor: 2, presentedTime: 1_800_010_000 },
    ];
    expect(() => projectChronicleReviewManifest(c01, [...valid].reverse()))
      .toThrow(/chronological|order/i);
    expect(() => projectChronicleReviewManifest(c01, [valid[0]!, { ...valid[1]!, key: "departure" }]))
      .toThrow(/duplicate|unique/i);
    expect(() => projectChronicleReviewManifest(c01, [{ ...valid[0]!, cursor: 99 }]))
      .toThrow(/cue|authority|cursor/i);
    expect(() => projectChronicleReviewManifest(c01, [{
      ...valid[0]!,
      presentedTime: valid[0]!.presentedTime + 0.25,
    }])).toThrow(/cue|authority|timestamp|time/i);
    expect(() => projectChronicleReviewManifest(c01, [{
      ...valid[0]!,
      kind: "checkpoint",
    }])).toThrow(/cue|authority|kind|checkpoint/i);
    expect(() => projectChronicleReviewManifest(c01, [
      valid[1]!,
      { ...valid[1]!, key: "same-cut-again", label: "Same cut again", kind: "checkpoint" },
    ])).toThrow(/duplicate|cursor|review cut/i);
    expect(() => projectChronicleReviewManifest(getChronicleManifest("C02"), [
      {
        key: "last-event",
        label: "Last event",
        instruction: "Review the final event before the checkpoint cut.",
        kind: "event" as const,
        cursor: 20,
        presentedTime: 1_800_020_009,
      },
      {
        key: "later-checkpoint",
        label: "Later checkpoint",
        instruction: "A second cut at the same cursor is not observable by cursor delivery.",
        kind: "checkpoint" as const,
        cursor: 20,
        presentedTime: 1_800_020_010,
      },
    ])).toThrow(/duplicate|cursor|review cut/i);
  });

  contractIt("creates one deterministic compact failure token from allow-listed fields only", async () => {
    const { createChronicleFailureToken } = await loadModelModule();
    const input = {
      chronicleId: "C12",
      cursor: 7,
      presentedTime: 1_800_120_001.25,
      speed: 0.5,
      viewport: { width: 1_280, height: 720 },
      pathname: "/Users/safi/private/world",
      userAgent: "private-agent",
      notes: "secret",
    } as const;

    const first = createChronicleFailureToken(input);
    const second = createChronicleFailureToken({
      viewport: input.viewport,
      speed: input.speed,
      presentedTime: input.presentedTime,
      cursor: input.cursor,
      chronicleId: input.chronicleId,
    });
    expect(first).toBe(
      "VQA1|C12|cursor=7|time=1800120001.25|speed=0.5|viewport=1280x720",
    );
    expect(second).toBe(first);
    expect(first).not.toMatch(/Users|private|agent|secret/i);
  });

  contractIt("rejects unsafe token IDs, delimiters, large integers, time, speeds, and viewports", async () => {
    const model = await loadModelModule();
    const { createChronicleFailureToken } = model;
    expect(model.CHRONICLE_FAILURE_MAX_TIME).toBe(CHRONICLE_FAILURE_MAX_TIME);
    const valid: ChronicleFailureTokenInput = {
      chronicleId: "C01",
      cursor: 1,
      presentedTime: 100,
      speed: 1,
      viewport: { width: 390, height: 844 },
    };
    const invalid = [
      { ...valid, cursor: -1 },
      { ...valid, cursor: 1.5 },
      { ...valid, cursor: Number.MAX_SAFE_INTEGER + 1 },
      { ...valid, presentedTime: -1 },
      { ...valid, presentedTime: -0 },
      { ...valid, presentedTime: Number.NaN },
      { ...valid, presentedTime: Number.POSITIVE_INFINITY },
      { ...valid, presentedTime: Number.NEGATIVE_INFINITY },
      { ...valid, presentedTime: CHRONICLE_FAILURE_MAX_TIME + 0.001 },
      { ...valid, speed: 3 as PlaybackSpeed },
      { ...valid, viewport: { width: 0, height: 844 } },
      { ...valid, viewport: { width: 390.5, height: 844 } },
      { ...valid, viewport: { width: Number.MAX_SAFE_INTEGER + 1, height: 844 } },
      { ...valid, viewport: { width: 390, height: 0 } },
      { ...valid, viewport: { width: 390, height: -844 } },
      { ...valid, viewport: { width: 390, height: 844.5 } },
      { ...valid, viewport: { width: 390, height: Number.MAX_SAFE_INTEGER + 1 } },
      { ...valid, chronicleId: "C01|cursor=99" as ChronicleId },
      { ...valid, chronicleId: " C01" as ChronicleId },
    ];
    for (const input of invalid) {
      expect(() => createChronicleFailureToken(input)).toThrow(
        /chronicle|id|delimiter|cursor|time|speed|viewport/i,
      );
    }
  });

  contractIt("starts in session order and routes pause, resume, and exact supported speeds", async () => {
    const { runtime, scheduler, trace } = await makeRuntime("C01");

    await runtime.start();
    expect(trace.slice(0, 4)).toEqual([
      "create:C01:g1",
      "start:C01:g1",
      "resume:C01:g1",
      "schedule:1000",
    ]);
    runtime.pause();
    expect(trace.slice(-2)).toEqual(["cancel:1000", "pause:C01:g1"]);
    runtime.setSpeed(0.5);
    runtime.resume();
    expect(trace.slice(-3)).toEqual([
      "speed:C01:g1:0.5",
      "resume:C01:g1",
      "schedule:2000",
    ]);
    runtime.setSpeed(1.5);
    runtime.setSpeed(2);
    expect(trace).toContain("speed:C01:g1:1.5");
    expect(trace).toContain("speed:C01:g1:2");
    expect(() => runtime.setSpeed(3 as PlaybackSpeed)).toThrow(/speed/i);

    scheduler.flushNext();
    runtime.dispose();
  });

  contractIt("disposes the old generation before restart and ignores stale callbacks", async () => {
    const { runtime, playbacks, trace } = await makeRuntime("C12");
    await runtime.start();
    const stalePublish = playbacks[0]!.publish;

    await runtime.restart();
    expect(trace.indexOf("unsubscribe:C12:g1"))
      .toBeLessThan(trace.indexOf("dispose:C12:g1"));
    expect(trace.indexOf("dispose:C12:g1"))
      .toBeLessThan(trace.indexOf("create:C12:g2"));
    expect(runtime.getSnapshot().generation).toBe(2);
    stalePublish({
      runId: "stale-run",
      source: "live",
      sourceKey: "live:stale-run",
      presentedCursor: 999,
      presentedTime: 999,
    });
    expect(runtime.getSnapshot()).toMatchObject({
      generation: 2,
      presentedCursor: 0,
    });
    const currentPublish = playbacks[1]!.publish;
    runtime.dispose();
    runtime.dispose();
    expect(trace.filter((item) => item === "unsubscribe:C12:g2")).toHaveLength(1);
    expect(trace.filter((item) => item === "dispose:C12:g2")).toHaveLength(1);
    expect(runtime.getSnapshot().status).toBe("disposed");
    currentPublish({
      runId: "late-current-run",
      source: "live",
      sourceKey: "live:late-current-run",
      presentedCursor: 500,
      presentedTime: 500,
    });
    expect(runtime.getSnapshot()).toMatchObject({ status: "disposed", presentedCursor: 0 });
  });

  contractIt("switches Chronicles through a fresh generation and starts the selected manifest", async () => {
    const { runtime, trace } = await makeRuntime("C01");
    await runtime.start();

    await runtime.selectChronicle("C17");
    expect(trace.indexOf("dispose:C01:g1"))
      .toBeLessThan(trace.indexOf("create:C17:g2"));
    expect(trace).toContain("start:C17:g2");
    expect(runtime.getSnapshot()).toMatchObject({
      chronicle: { id: "C17" },
      generation: 2,
      playing: true,
    });
    runtime.dispose();
  });

  contractIt("makes latest concurrent selection/restart win despite delayed readiness and hostile cancelled callbacks", async () => {
    const firstReady = deferred<void>();
    const selectedReady = deferred<void>();
    const restartedReady = deferred<void>();
    const { runtime, scheduler, playbacks, trace } = await makeRuntime("C01", {
      readyPromises: [firstReady.promise, selectedReady.promise, restartedReady.promise],
    });

    const starting = runtime.start();
    expect(runtime.getSnapshot()).toMatchObject({ status: "loading", generation: 1 });
    const selecting = runtime.selectChronicle("C17");
    const restarting = runtime.restart();
    expect(playbacks).toHaveLength(3);
    expect(runtime.getSnapshot()).toMatchObject({
      status: "loading",
      generation: 3,
      chronicle: { id: "C17" },
    });

    firstReady.resolve(undefined);
    selectedReady.resolve(undefined);
    await Promise.resolve();
    scheduler.invokeEveryRetainedCallback();
    expect(runtime.getSnapshot()).toMatchObject({
      status: "loading",
      generation: 3,
      chronicle: { id: "C17" },
      presentedCursor: 0,
    });
    expect(trace).not.toContain("resume:C01:g1");
    expect(trace).not.toContain("resume:C17:g2");

    restartedReady.resolve(undefined);
    await Promise.all([starting, selecting, restarting]);
    expect(runtime.getSnapshot()).toMatchObject({
      status: "ready",
      generation: 3,
      chronicle: { id: "C17" },
      playing: true,
    });
    scheduler.invokeEveryRetainedCallback();
    expect(playbacks[0]!.deliveredCursors).toEqual([]);
    expect(playbacks[1]!.deliveredCursors).toEqual([]);
    runtime.dispose();
  });

  contractIt("publishes rejected readiness as error, recovers by selection, and stays inert when disposed during start", async () => {
    const rejected = deferred<void>();
    const recovery = deferred<void>();
    const first = await makeRuntime("C01", {
      readyPromises: [rejected.promise, recovery.promise],
    });
    const starting = first.runtime.start();
    rejected.reject(new Error("fixture session rejected"));
    await expect(starting).resolves.toBeUndefined();
    expect(first.runtime.getSnapshot()).toMatchObject({
      status: "error",
      error: "fixture session rejected",
      playing: false,
    });

    const selecting = first.runtime.selectChronicle("C17");
    recovery.resolve(undefined);
    await selecting;
    expect(first.runtime.getSnapshot()).toMatchObject({
      status: "ready",
      error: null,
      chronicle: { id: "C17" },
    });
    first.runtime.dispose();

    const delayed = deferred<void>();
    const second = await makeRuntime("C12", { readyPromises: [delayed.promise] });
    const disposedStart = second.runtime.start();
    second.runtime.dispose();
    second.scheduler.invokeEveryRetainedCallback();
    delayed.resolve(undefined);
    await disposedStart;
    second.scheduler.invokeEveryRetainedCallback();
    expect(second.runtime.getSnapshot()).toMatchObject({
      status: "disposed",
      presentedCursor: 0,
    });
    expect(second.trace).not.toContain("resume:C12:g1");
    expect(second.playbacks[0]!.deliveredCursors).toEqual([]);
  });

  contractIt("seeks checkpoints by exact cursor and world time while event markers retain event-time authority", async () => {
    const c00 = await makeRuntime("C00");
    await c00.runtime.start();
    c00.runtime.pause();
    const checkpoint = c00.runtime.getSnapshot().chronicle.markers[0]!;
    expect(checkpoint).toMatchObject({
      kind: "checkpoint",
      cursor: 0,
      presentedTime: 1_800_000_001,
    });
    await c00.runtime.nextMarker();
    expect(c00.playbacks[0]!.deliveredMarkers).toEqual([{
      kind: "checkpoint",
      cursor: 0,
      presentedTime: 1_800_000_001,
    }]);
    expect(c00.runtime.getSnapshot()).toMatchObject({
      presentedCursor: 0,
      presentedTime: 1_800_000_001,
      marker: checkpoint,
    });
    c00.runtime.dispose();

    const c02 = await makeRuntime("C02");
    await c02.runtime.start();
    c02.runtime.pause();
    await c02.runtime.nextMarker();
    await c02.runtime.nextMarker();
    const event = c02.runtime.getSnapshot().chronicle.markers.at(-1)!;
    expect(event).toMatchObject({
      kind: "event",
      cursor: 20,
      presentedTime: 1_800_020_009,
    });
    expect(c02.playbacks[0]!.deliveredMarkers.at(-1)).toEqual({
      kind: "event",
      cursor: 20,
      presentedTime: 1_800_020_009,
    });
    expect(c02.runtime.getSnapshot()).toMatchObject({
      presentedCursor: 20,
      presentedTime: 1_800_020_009,
      marker: event,
    });
    expect(c02.runtime.getSnapshot().presentedTime).not.toBe(1_800_020_010);
    c02.runtime.dispose();
  });

  contractIt("resumes paused playback before the next marker while validation remains paused", async () => {
    const { runtime, playbacks, scheduler, trace } = await makeRuntime("C01", {
      deferMarkerDelivery: true,
    });
    await runtime.start();
    await runtime.nextMarker();
    playbacks[0]!.flushPendingMarker();
    expect(runtime.getSnapshot()).toMatchObject({
      playing: false,
      presentedCursor: 1,
      presentedTime: 1_800_010_000,
    });

    const beforeSecondCue = trace.length;
    await runtime.nextMarker();
    expect(trace.slice(beforeSecondCue, beforeSecondCue + 3)).toEqual([
      "resume:C01:g1",
      "marker:C01:g1:event:2:1800010000",
      "pause-deferred:C01:g1",
    ]);
    expect(runtime.getSnapshot()).toMatchObject({
      playing: false,
      presentedCursor: 2,
      presentedTime: 1_800_010_000,
    });
    playbacks[0]!.flushPendingMarker();
    expect(playbacks[0]!.getSnapshot()).toMatchObject({
      presentedCursor: 2,
      presentedTime: 1_800_010_000,
    });
    expect(runtime.getSnapshot()).toMatchObject({
      playing: false,
      presentedCursor: 2,
      presentedTime: 1_800_010_000,
    });
    expect(scheduler.pendingTaskCount).toBe(0);
    expect(trace).toContain("pause-applied:C01:g1");
    runtime.dispose();
  });

  contractIt("schedules bounded positive monotonic C16 batches losslessly through cursor 4096", async () => {
    const { runtime, scheduler, playbacks } = await makeRuntime("C16");
    await runtime.start();

    scheduler.flushAll(64);

    const requested = playbacks[0]!.deliveredCursors;
    expect(requested.length).toBeGreaterThan(0);
    expect(requested.length).toBeLessThanOrEqual(4_096);
    expect(requested.at(-1)).toBe(4_096);
    const batchSizes = requested.map((cursor, index) => (
      cursor - (requested[index - 1] ?? 0)
    ));
    expect(requested.every((cursor) => Number.isSafeInteger(cursor) && cursor > 0 && cursor <= 4_096))
      .toBe(true);
    expect(batchSizes.every((size) => size > 0 && size <= 256)).toBe(true);
    expect(scheduler.invokedCallbackCount).toBeLessThanOrEqual(64);
    expect(new Set(requested).size).toBe(requested.length);
    expect(requested.flatMap((cursor, index) => {
      const previous = requested[index - 1] ?? 0;
      return Array.from({ length: cursor - previous }, (_, offset) => previous + offset + 1);
    })).toEqual(Array.from({ length: 4_096 }, (_, index) => index + 1));
    expect(runtime.getSnapshot()).toMatchObject({
      status: "complete",
      presentedCursor: 4_096,
    });
    runtime.dispose();
  });

  contractIt("yields immediate-clock collaborator retries until one-turn-delayed Canvas acceptance settles C01", async () => {
    installRendererBrowserHarness();
    const turns = new CooperativeBrowserTurns();
    turns.installAnimationFrame();
    const network = installNetworkTraps();
    const { createProductionChronicleQaOwner } = await loadProductionModule();
    const { ChronicleValidationApp } = await loadValidationAppModule();
    const composed = productionCompositionSpies(turns);
    const owner = createProductionChronicleQaOwner({
      initialChronicleId: "C01",
      presentationClockScheduler: turns.presentationClockScheduler,
      composition: composed.factories,
    });
    root = createRoot(container as HTMLDivElement);
    await act(async () => root?.render(<ChronicleValidationApp owner={owner} />));
    await act(async () => owner.ready);
    const app = singleElement<HTMLElement>(container, ".vivarium-2d-app");
    const live = composed.liveBundles[0]!;
    try {
      const cue = (await loadReviewCuesModule()).reviewCuesFor("C01")[0]!;
      await establishExactRendererBaseline(turns, app, owner, live);
      expect(turns.turnErrors).toEqual([]);
      turns.resetPhaseEvidence();
      const acceptExactFrame = live.frameAcceptance.markAccepted.bind(live.frameAcceptance);
      let delayedConsequenceFrame: ReturnType<typeof live.session.getFrame> | null = null;
      let targetConsequenceMomentId: string | null = null;
      let deferredAcceptanceApplied = false;
      let deferredFrameAcceptedAtExactTurn = false;
      let acceptanceAloneSettled = false;
      const consequenceAttempts: Array<Readonly<{
        runId: string;
        sourceKey: string;
        revision: number;
        momentId: string;
      }>> = [];
      vi.spyOn(live.frameAcceptance, "markAccepted").mockImplementation((frame) => {
        const candidateMomentId = frame.scene?.phase === "consequence"
          && frame.world.projectedThroughCursor === cue.cursor
          ? frame.scene.momentId
          : null;
        if (
          candidateMomentId === null
          || (targetConsequenceMomentId !== null
            && candidateMomentId !== targetConsequenceMomentId)
        ) {
          acceptExactFrame(frame);
          return;
        }
        targetConsequenceMomentId ??= candidateMomentId;
        const identity = Object.freeze({
          runId: frame.runId,
          sourceKey: frame.sourceKey,
          revision: frame.revision,
          momentId: candidateMomentId,
        });
        consequenceAttempts.push(identity);
        if (delayedConsequenceFrame === null) {
          delayedConsequenceFrame = frame;
          turns.scheduleAcceptance(() => {
            acceptExactFrame(frame);
            deferredAcceptanceApplied = true;
            deferredFrameAcceptedAtExactTurn = live.frameAcceptance.accepts(frame);
            acceptanceAloneSettled = isCueSettled(owner, cue);
          });
          return;
        }
        const expected = delayedConsequenceFrame;
        if (
          frame.runId !== expected.runId
          || frame.sourceKey !== expected.sourceKey
          || frame.revision !== expected.revision
        ) {
          throw new Error("Canvas consequence retry changed the pending exact frame identity");
        }
        acceptExactFrame(frame);
      });

      await act(async () => owner.validationRuntime.nextMarker());
      expect(owner.validationRuntime.getSnapshot().playing).toBe(false);
      await turns.flushUntil(
        () => delayedConsequenceFrame !== null,
        C01_STORY_PHASE_DEADLINE_TURNS
          + C01_PHASE_RENDER_RAF_HANDOFF_TURNS
          + C01_REGION_TRANSITION_CACHE_PREPARATION_TURNS
          + C01_REGION_TRANSITION_ATLAS_ADOPTION_TURNS
          // The background world-sheet builds interleave into this prefix of the cue
          // phase rather than waiting for it: measured 18 of the 29 (nirvana_east 7 +
          // nirvana 11) land before the deferred consequence frame appears, and the
          // remaining 11 (nirvana_west) after it. The split is an interleaving detail
          // the composition cannot name, so the whole term is carried here and the
          // exact total stays pinned by C01_CUE_TURN_BUDGET below.
          + C01_BACKGROUND_WORLD_SHEET_SNAPSHOT_TURNS,
      );
      expect(frameIdentity(owner.observerRuntime.getSnapshot().frame!))
        .toEqual(frameIdentity(delayedConsequenceFrame!));
      expect(owner.observerRuntime.getSnapshot().frame?.world.projectedThroughCursor)
        .toBe(cue.cursor);
      expect(live.frameAcceptance.accepts(delayedConsequenceFrame!)).toBe(false);

      let settlementFailure: unknown = null;
      try {
        await turns.flushUntil(
          () => isCueSettled(owner, cue),
          C01_CUE_TURN_BUDGET - turns.executedTurnCount,
        );
      } catch (error) {
        settlementFailure = error;
      }
      const settled = isCueSettled(owner, cue);

      expect(delayedConsequenceFrame).not.toBeNull();
      expect(targetConsequenceMomentId).toBe(delayedConsequenceFrame!.scene?.momentId);
      expect(delayedConsequenceFrame!.scene?.phase).toBe("consequence");
      expect(deferredAcceptanceApplied).toBe(true);
      expect(deferredFrameAcceptedAtExactTurn).toBe(true);
      expect(acceptanceAloneSettled).toBe(false);
      const expectedIdentity = Object.freeze({
        ...frameIdentity(delayedConsequenceFrame!),
        momentId: targetConsequenceMomentId!,
      });
      expect(consequenceAttempts).toEqual(
        Array.from({ length: consequenceAttempts.length }, () => expectedIdentity),
      );
      expect(turns.acceptanceTurnRequestCount).toBe(C01_DEFERRED_ACCEPTANCE_TURNS);
      expect(turns.executedTurnCount).toBeLessThanOrEqual(C01_CUE_TURN_BUDGET);
      expectNoNetwork(network);
      // Renderer acceptance is expected asynchronous backpressure; it must
      // settle through cooperative retries without escaping to the observer.
      expectTurnErrors(turns, []);
      if (settled) {
        const terminalFrame = live.session.getFrame();
        expect(terminalFrame.scene).toBeNull();
        expect(owner.observerRuntime.getSnapshot().frame).toBe(terminalFrame);
        expect(frameIdentity(owner.observerRuntime.getSnapshot().frame!))
          .toEqual(frameIdentity(terminalFrame));
        expect(live.frameAcceptance.accepts(terminalFrame)).toBe(true);
        expect(owner.observerRuntime.getSnapshot().frame).not.toBe(delayedConsequenceFrame);
        expect(frameIdentity(terminalFrame)).not.toEqual(frameIdentity(delayedConsequenceFrame!));
        expect(live.frameAcceptance.accepts(delayedConsequenceFrame!)).toBe(false);
        expect(turns.clockTurnRequestCount).toBeGreaterThan(0);
        expect(turns.clockTurnRequestCount).toBeLessThanOrEqual(
          C01_STORY_PHASE_DEADLINE_TURNS + C01_COLLABORATOR_RETRY_CLOCK_TURNS,
        );
        expect(turns.fallbackMicrotaskCount).toBe(0);
        expectProductionReviewCut(owner, cue);
        expect(owner.observerRuntime.diagnostics()).toMatchObject({
          director: { pendingMoments: 0, activeSceneCount: 0 },
        });
      } else {
        expect(settlementFailure).toBeInstanceOf(Error);
        expect(
          (turns.clockTurnRequestCount === 0 && turns.fallbackMicrotaskCount > 0)
          || turns.turnErrors.some((error) => (
            error instanceof Error && error.message === RETAINED_CONSEQUENCE_REVISION_ERROR
          )),
        ).toBe(true);
      }
      expect(settled, settlementFailureMessage(settlementFailure)).toBe(true);
    } finally {
      try {
        await act(async () => root?.unmount());
      } finally {
        try {
          root = null;
        } finally {
          try {
            owner.dispose();
          } finally {
            disposeMountedRendererTestResources(app, composed.rendererAtlasPool);
          }
        }
      }
    }
  }, QA_PRODUCTION_ROUTE_BINDING_TIMEOUT_MS);

  contractIt("mounts predecoded C01 and settles its first cue through the real renderer with exact identity", async () => {
    installRendererBrowserHarness();
    const turns = new CooperativeBrowserTurns();
    turns.installAnimationFrame();
    const network = installNetworkTraps();
    const { createProductionChronicleQaOwner } = await loadProductionModule();
    const { ChronicleValidationApp } = await loadValidationAppModule();
    const { reviewCuesFor } = await loadReviewCuesModule();
    const composed = productionCompositionSpies(turns);
    const owner = createProductionChronicleQaOwner({
      initialChronicleId: "C01",
      presentationClockScheduler: turns.presentationClockScheduler,
      composition: composed.factories,
    });
    root = createRoot(container as HTMLDivElement);
    await act(async () => root?.render(<ChronicleValidationApp owner={owner} />));
    await act(async () => owner.ready);
    const app = singleElement<HTMLElement>(container, ".vivarium-2d-app");
    const live = composed.liveBundles[0]!;
    try {
      const cue = reviewCuesFor("C01")[0]!;
      await establishExactRendererBaseline(turns, app, owner, live);
      expect(turns.turnErrors).toEqual([]);
      turns.resetPhaseEvidence();
      await act(async () => owner.validationRuntime.nextMarker());
      await turns.flushUntil(() => isCueSettled(owner, cue), C01_CUE_TURN_BUDGET);

      const exactFrame = live.session.getFrame();
      expect(owner.observerRuntime.getSnapshot().frame).toBe(exactFrame);
      expectProductionReviewCut(owner, cue);
      expect(getProductionStageDebugProbe(app)?.snapshot()).toMatchObject({
        runId: "mock-c01-v1",
        presentedCursor: cue.cursor,
        frameIdentity: {
          runId: exactFrame.runId,
          sourceKey: exactFrame.sourceKey,
          revision: exactFrame.revision,
        },
      });
      expect(owner.observerRuntime.diagnostics()).toMatchObject({
        director: { pendingMoments: 0, activeSceneCount: 0 },
      });
      expect(turns.executedTurnCount).toBeLessThanOrEqual(C01_CUE_TURN_BUDGET);
      expectTurnErrors(turns, []);
      expectNoNetwork(network);
      expect(turns.fallbackMicrotaskCount).toBe(0);
    } finally {
      try {
        await act(async () => root?.unmount());
      } finally {
        try {
          root = null;
        } finally {
          try {
            owner.dispose();
          } finally {
            disposeMountedRendererTestResources(app, composed.rendererAtlasPool);
          }
        }
      }
    }
    expect(owner.diagnostics()).toMatchObject({
      disposed: true,
      observerDisposed: true,
      transportDisposed: true,
      scheduledTaskCount: 0,
      activeListenerCount: 0,
    });
  });

  contractIt("retires every headless generation resource before notifying binding subscribers", async () => {
    const { createProductionChronicleQaOwner } = await loadProductionModule();
    const composed = productionCompositionSpies();
    const owner = createProductionChronicleQaOwner({
      initialChronicleId: "C01",
      composition: composed.factories,
    });
    await owner.ready;
    const oldRuntime = composed.observerRuntimes[0]!;
    const oldLive = composed.liveBundles[0]!;
    const oldFeed = composed.checkpointFeeds[0]!;
    const oldReplay = composed.replayClients[0]!;
    const oldTransport = composed.fixtureTransports[0]!;
    const notifications: Array<Readonly<{
      binding: ChronicleQaObserverBinding | null;
      runtimeDisposals: number;
      liveDisposals: number;
      feedDisposals: number;
      replayDisposals: number;
      transportDisposals: number;
      subscriptionDisposals: readonly number[];
      harnessDisposed: boolean;
      harnessPendingTasks: number;
      bridgeDisposed: boolean;
      bridgePendingTasks: number;
    }>> = [];
    const unsubscribe = owner.subscribeObserverBinding(() => {
      notifications.push(Object.freeze({
        binding: owner.getObserverBinding(),
        runtimeDisposals: oldRuntime.dispose.mock.calls.length,
        liveDisposals: oldLive.dispose.mock.calls.length,
        feedDisposals: oldFeed.dispose.mock.calls.length,
        replayDisposals: oldReplay.dispose.mock.calls.length,
        transportDisposals: oldTransport.dispose.mock.calls.length,
        subscriptionDisposals: oldRuntime.subscriptionDisposals
          .map((dispose) => dispose.mock.calls.length),
        harnessDisposed: composed.offlineCheckpointHarnesses[0]?.diagnostics().disposed ?? false,
        harnessPendingTasks:
          composed.offlineCheckpointHarnesses[0]?.diagnostics().pendingTaskCount ?? -1,
        bridgeDisposed: composed.offlineLiveBridges[0]?.diagnostics().disposed ?? false,
        bridgePendingTasks: composed.offlineLiveBridges[0]?.diagnostics().pendingTaskCount ?? -1,
      }));
    });
    expect(composed.fixtureProducers).toHaveLength(1);
    expect(composed.liveClientGates).toHaveLength(1);
    const oldProducer = composed.fixtureProducers[0];
    const oldGate = composed.liveClientGates[0];
    if (oldProducer === undefined || oldGate === undefined) {
      throw new Error("the pending producer and Live gate must exist before restart");
    }
    const pendingOldEnvelope = oldGate.armNext();
    oldProducer.callbacks.onEnvelopeAccepted({
      schema: 1,
      cursor: 0,
      oldest_cursor: 0,
      next_cursor: 0,
      events: [],
      overflow: false,
      snapshot_required: false,
    });
    expect(await observeWithinMicrotasks(pendingOldEnvelope.entered, 1))
      .toMatchObject({ status: "fulfilled" });
    try {
      await owner.validationRuntime.restart();
      expect.soft(notifications).toEqual([{
        binding: owner.getObserverBinding(),
        runtimeDisposals: 1,
        liveDisposals: 1,
        feedDisposals: 1,
        replayDisposals: 1,
        transportDisposals: 1,
        subscriptionDisposals: oldRuntime.subscriptionDisposals.map(() => 1),
        harnessDisposed: true,
        harnessPendingTasks: 0,
        bridgeDisposed: true,
        bridgePendingTasks: 0,
      }]);
      expect.soft(owner.getObserverBinding()?.observerRuntime).toBe(composed.observerRuntimes[1]);
      expect.soft(owner.getObserverBinding()?.generation).toBe(2);
    } finally {
      pendingOldEnvelope.release();
      await drainBoundedMicrotasksWithoutAct(QA_STALE_PRODUCER_DRAIN_MICROTASK_BUDGET);
      unsubscribe();
      owner.dispose();
      expectReleasedGenerationResources(composed, 0, 0);
      expectReleasedGenerationResources(composed, 1, 1);
      forceReleaseComposition(composed);
    }
  });

  contractIt("isolates and reports a throwing binding listener without undoing the committed handoff", async () => {
    const { createProductionChronicleQaOwner } = await loadProductionModule();
    const composed = productionCompositionSpies();
    const listenerFailure = new Error("binding-listener-fault");
    const reportListenerError = vi.fn<(error: unknown) => void>();
    vi.stubGlobal("reportError", reportListenerError);
    const owner = createProductionChronicleQaOwner({
      initialChronicleId: "C01",
      composition: composed.factories,
    });
    await owner.ready;
    const throwingListener = vi.fn(() => { throw listenerFailure; });
    const peerBindings: Array<ChronicleQaObserverBinding | null> = [];
    const stopThrower = owner.subscribeObserverBinding(throwingListener);
    const stopPeer = owner.subscribeObserverBinding(() => {
      peerBindings.push(owner.getObserverBinding());
    });
    let restartFailure: unknown = null;
    try {
      await owner.validationRuntime.restart();
    } catch (error) {
      restartFailure = error;
    }
    const committed = owner.getObserverBinding();
    try {
      expect.soft(restartFailure).toBeNull();
      expect.soft(throwingListener).toHaveBeenCalledTimes(1);
      expect.soft(reportListenerError).toHaveBeenCalledTimes(1);
      expect.soft(reportListenerError).toHaveBeenCalledWith(listenerFailure);
      expect.soft(peerBindings).toEqual([committed]);
      expect.soft(committed).toMatchObject({
        generation: 2,
        observerRuntime: composed.observerRuntimes[1],
      });
      expect.soft(Object.isFrozen(committed)).toBe(true);
      expectReleasedGenerationResources(composed, 0, 0);
      expect.soft(composed.observerRuntimes[1]?.dispose).not.toHaveBeenCalled();
      expect.soft(composed.fixtureTransports[1]?.dispose).not.toHaveBeenCalled();
      expect.soft(owner.validationRuntime.getSnapshot()).toMatchObject({
        chronicle: { id: "C01" },
        generation: 2,
        status: "ready",
      });
    } finally {
      stopThrower();
      stopPeer();
      owner.dispose();
      expectReleasedGenerationResources(composed, 1, 1);
      forceReleaseComposition(composed);
    }
  });

  contractIt("rolls back synchronous generation factory failures in exact ownership order", async () => {
    const { createProductionChronicleQaOwner } = await loadProductionModule();
    const cases = [
      {
        boundary: "live-bridge-receipt",
        chronicleId: "C01",
        order: ["bridge"],
      },
      {
        boundary: "checkpoint-harness-receipt",
        chronicleId: "C01",
        order: ["harness", "bridge"],
      },
      { boundary: "feed", chronicleId: "C01", order: ["harness", "bridge"] },
      { boundary: "live", chronicleId: "C01", order: ["feed", "harness", "bridge"] },
      { boundary: "replay", chronicleId: "C01", order: ["live", "feed", "harness", "bridge"] },
      {
        boundary: "replay-session",
        chronicleId: "C01",
        order: ["replay", "live", "feed", "harness", "bridge"],
      },
      {
        boundary: "runtime",
        chronicleId: "C01",
        order: ["replay", "live", "feed", "harness", "bridge"],
      },
      {
        boundary: "transport",
        chronicleId: "C01",
        order: ["runtime", "live", "feed", "replay", "harness", "bridge"],
      },
      {
        boundary: "scenario-c14",
        chronicleId: "C14",
        order: ["transport", "runtime", "live", "feed", "replay", "harness", "bridge"],
      },
      {
        boundary: "scenario-c15",
        chronicleId: "C15",
        order: ["transport", "runtime", "live", "feed", "replay", "harness", "bridge"],
      },
    ] as const;

    for (const { boundary, chronicleId, order } of cases) {
      const failure = new Error(`construction-fault:${boundary}`);
      const composed = productionCompositionSpies();
      const network = installNetworkTraps();
      const scheduler = new ObservableValidationScheduler();
      failCompositionFactory(composed, boundary, failure);
      let thrown: unknown = null;
      let unexpectedOwner: ProductionChronicleQaOwner | null = null;
      try {
        unexpectedOwner = createProductionChronicleQaOwner({
          initialChronicleId: chronicleId,
          composition: composed.factories,
          scheduler: scheduler.port,
        });
      } catch (error) {
        thrown = error;
      }
      const cleanup = captureCompositionCleanup(composed);
      const pendingBeforeManualCleanup = scheduler.pendingTaskCount;
      if (boundary === "checkpoint-harness-receipt") {
        const failedHarness = composed.failedOfflineCheckpointSources[0];
        expect.soft(failedHarness, boundary).toBeDefined();
        if (failedHarness !== undefined) {
          expect.soft(failedHarness.dispose, boundary).toHaveBeenCalledTimes(1);
          expect.soft(failedHarness.pendingTaskCount(), boundary).toBe(0);
        }
      } else if (boundary !== "live-bridge-receipt") {
        expect.soft(composed.offlineCheckpointHarnesses[0]?.diagnostics(), boundary).toMatchObject({
          disposed: true,
          pendingTaskCount: 0,
        });
      }
      if (boundary === "live-bridge-receipt") {
        const failedBridge = composed.failedOfflineLiveSources[0];
        expect.soft(failedBridge, boundary).toBeDefined();
        if (failedBridge !== undefined) {
          expect.soft(failedBridge.dispose, boundary).toHaveBeenCalledTimes(1);
          expect.soft(failedBridge.pendingTaskCount(), boundary).toBe(0);
        }
      } else {
        expect.soft(composed.offlineLiveBridges[0]?.diagnostics(), boundary).toMatchObject({
          disposed: true,
          pendingTaskCount: 0,
        });
      }
      unexpectedOwner?.dispose();
      forceReleaseComposition(composed);
      expect.soft(thrown, boundary).toBe(failure);
      expect.soft(cleanup.order, boundary).toEqual(order);
      expect.soft(cleanup.duplicateDisposals, boundary).toEqual([]);
      expect.soft(pendingBeforeManualCleanup, boundary).toBe(0);
      expect.soft(composed.liveBridgeReceipt, boundary).toHaveBeenCalledTimes(1);
      expect.soft(composed.checkpointHarnessReceipt, boundary).toHaveBeenCalledTimes(
        boundary === "live-bridge-receipt" ? 0 : 1,
      );
      expectNoLaterFactoryCalls(composed, boundary);
      if (chronicleId === "C14") expect.soft(composed.c15Scenario).not.toHaveBeenCalled();
      if (chronicleId === "C15") expect.soft(composed.c14Scenario).not.toHaveBeenCalled();
      expectNoNetwork(network);
    }
  });

  contractIt("preserves construction primary first while reverse cleanup continues after throws", async () => {
    const { createProductionChronicleQaOwner } = await loadProductionModule();
    const primary = new Error("transport-construction-primary");
    const runtimeCleanup = new Error("runtime-cleanup-fault");
    const replayCleanup = new Error("replay-cleanup-fault");
    const composed = productionCompositionSpies();
    installThrowingCleanup(composed, "runtime", runtimeCleanup);
    installThrowingCleanup(composed, "replay", replayCleanup);
    failCompositionFactory(composed, "transport", primary);
    let thrown: unknown = null;
    try {
      createProductionChronicleQaOwner({
        initialChronicleId: "C01",
        composition: composed.factories,
      });
    } catch (error) {
      thrown = error;
    }
    const cleanup = captureCompositionCleanup(composed);
    forceReleaseComposition(composed);
    expectExactAggregate(thrown, primary, [runtimeCleanup, replayCleanup]);
    expect.soft(cleanup.order).toEqual([
      "runtime",
      "live",
      "feed",
      "replay",
      "harness",
      "bridge",
    ]);
    expect.soft(cleanup.duplicateDisposals).toEqual([]);
  });

  contractIt("rolls back returned scenarios after unsubscribe and before playback disposal", async () => {
    const { createProductionChronicleQaOwner } = await loadProductionModule();
    for (const chronicleId of ["C14", "C15"] as const) {
      const primary = new Error(`scenario-downstream-snapshot:${chronicleId}`);
      const composed = productionCompositionSpies();
      const network = installNetworkTraps();
      faultPlaybackBoundary(composed, "get-snapshot", primary);
      let thrown: unknown = null;
      try {
        createProductionChronicleQaOwner({
          initialChronicleId: chronicleId,
          composition: composed.factories,
        });
      } catch (error) {
        thrown = error;
      }
      const scenario = chronicleId === "C14"
        ? composed.c14Scenarios[0]
        : composed.c15Scenarios[0];
      const unsubscribe = composed.observerRuntimes[0]?.subscriptionDisposals[1];
      const playbackDispose = composed.fixtureTransports[0]?.dispose;
      const rollbackOrder = captureMockOrder([
        ["unsubscribe", unsubscribe],
        ["scenario", scenario?.dispose],
        ["playback", playbackDispose],
      ]);
      expect.soft(thrown, chronicleId).toBe(primary);
      expect.soft(scenario, chronicleId).toBeDefined();
      expect.soft(rollbackOrder, chronicleId).toEqual([
        "unsubscribe",
        "scenario",
        "playback",
      ]);
      expect.soft(unsubscribe, chronicleId).toHaveBeenCalledTimes(1);
      if (scenario !== undefined) {
        expect.soft(scenario.dispose, chronicleId).toHaveBeenCalledTimes(1);
      }
      expect.soft(playbackDispose, chronicleId).toHaveBeenCalledTimes(1);
      if (chronicleId === "C14") expect.soft(composed.c15Scenario).not.toHaveBeenCalled();
      if (chronicleId === "C15") expect.soft(composed.c14Scenario).not.toHaveBeenCalled();
      expectNoNetwork(network);
      forceReleaseComposition(composed);
    }
  });

  contractIt("rolls back the outer owner when playback subscribe or initial snapshot throws", async () => {
    const { createProductionChronicleQaOwner } = await loadProductionModule();
    for (const boundary of ["subscribe", "get-snapshot"] as const) {
      const failure = new Error(`validation-runtime-fault:${boundary}`);
      const composed = productionCompositionSpies();
      faultPlaybackBoundary(composed, boundary, failure);
      let thrown: unknown = null;
      try {
        createProductionChronicleQaOwner({
          initialChronicleId: "C01",
          composition: composed.factories,
        });
      } catch (error) {
        thrown = error;
      }
      const cleanup = captureCompositionCleanup(composed);
      const subscriptionDisposals = composed.observerRuntimes[0]?.subscriptionDisposals
        .map((dispose) => dispose.mock.calls.length) ?? [];
      expect.soft(composed.fixtureTransports[0]?.dispose).toHaveBeenCalledTimes(1);
      forceReleaseComposition(composed);
      expect(thrown, boundary).toBe(failure);
      expect.soft(cleanup.order, boundary).toEqual([
        "transport",
        "runtime",
        "live",
        "feed",
        "replay",
        "harness",
        "bridge",
      ]);
      expect.soft(cleanup.duplicateDisposals, boundary).toEqual([]);
      expect.soft(subscriptionDisposals, boundary).toEqual(
        boundary === "subscribe" ? [1] : [1, 1],
      );
    }
  });

  contractIt("rolls back a validation generation when its lifecycle commit hook throws", async () => {
    const { createChronicleValidationRuntime } = await loadRuntimeModule();
    const scheduler = new FakeScheduler();
    const trace: string[] = [];
    const playbacks: FakePlaybackHarness[] = [];
    const scenarios: Array<ChronicleScenarioDriver & Readonly<{
      dispose: ReturnType<typeof vi.fn<() => void>>;
    }>> = [];
    const commitObservations: Array<Readonly<{
      generation: number;
      subscribed: boolean;
      snapshotted: boolean;
    }>> = [];
    const primary = new Error("generation-commit-primary");
    const lifecycle: ChronicleValidationGenerationLifecycle = {
      committed: vi.fn(({ manifest, generation }) => {
        commitObservations.push(Object.freeze({
          generation,
          subscribed: trace.includes(`subscribe:${manifest.id}:g${generation}`),
          snapshotted: trace.includes(`snapshot:${manifest.id}:g${generation}`),
        }));
        trace.push(`commit:${manifest.id}:g${generation}`);
        if (generation === 2) throw primary;
      }),
      failed: vi.fn(),
    };
    const runtime = createChronicleValidationRuntime({
      initialChronicleId: "C14",
      getManifest: getChronicleManifest,
      createPlayback({ manifest, generation }) {
        const playback = new FakePlayback(manifest, generation, trace, Promise.resolve(), false);
        const rawSubscribe = playback.subscribe.bind(playback);
        const rawGetSnapshot = playback.getSnapshot.bind(playback);
        Object.defineProperty(playback, "subscribe", {
          configurable: true,
          value: vi.fn((listener: () => void) => {
            trace.push(`subscribe:${manifest.id}:g${generation}`);
            return rawSubscribe(listener);
          }),
        });
        Object.defineProperty(playback, "getSnapshot", {
          configurable: true,
          value: vi.fn(() => {
            trace.push(`snapshot:${manifest.id}:g${generation}`);
            return rawGetSnapshot();
          }),
        });
        playbacks.push(playback);
        return playback;
      },
      createScenario(manifest) {
        const kind = manifest.id === "C15" ? "C15" as const : "C14" as const;
        const scenarioGeneration = scenarios.length + 1;
        const scenario: ChronicleScenarioDriver & Readonly<{
          dispose: ReturnType<typeof vi.fn<() => void>>;
        }> = {
          getView: () => ({
            kind,
            phase: "ready",
            controls: [],
            mechanicEnvelopeCount: 0,
            lastCompletedRecovery: null,
          }),
          run: async () => undefined,
          dispose: vi.fn(() => {
            trace.push(`scenario:${manifest.id}:g${scenarioGeneration}`);
          }),
        };
        scenarios.push(scenario);
        return scenario;
      },
      scheduler: {
        schedule: (delayMs, callback) => scheduler.schedule(delayMs, callback, trace),
      },
      generationLifecycle: lifecycle,
    });
    await runtime.start();
    let thrown: unknown = null;
    try {
      await runtime.selectChronicle("C15");
    } catch (error) {
      thrown = error;
    }
    const c15 = getChronicleManifest("C15");
    expect.soft(thrown).toBe(primary);
    expect.soft(lifecycle.committed).toHaveBeenCalledTimes(2);
    expect.soft(lifecycle.failed).toHaveBeenCalledWith({
      manifest: c15,
      generation: 2,
      error: primary,
    });
    expect.soft(commitObservations).toEqual([
      { generation: 1, subscribed: true, snapshotted: true },
      { generation: 2, subscribed: true, snapshotted: true },
    ]);
    expect.soft(trace.filter((entry) => entry === "dispose:C15:g2")).toEqual([
      "dispose:C15:g2",
    ]);
    const failedCommitIndex = trace.indexOf("commit:C15:g2");
    expect.soft(trace.slice(failedCommitIndex + 1).filter((entry) => (
      entry === "unsubscribe:C15:g2"
      || entry === "scenario:C15:g2"
      || entry === "dispose:C15:g2"
    ))).toEqual([
      "unsubscribe:C15:g2",
      "scenario:C15:g2",
      "dispose:C15:g2",
    ]);
    expect.soft(runtime.getSnapshot()).toMatchObject({
      chronicle: { id: "C15" },
      generation: 2,
      status: "error",
      error: primary.message,
      playing: false,
      presentedCursor: 0,
      presentedTime: c15.initialSnapshot.world_time,
      marker: null,
      scenario: null,
    });
    runtime.dispose();
  });

  contractIt("binds runToTerminal to the generation current at invocation before readiness", async () => {
    const { createProductionChronicleQaOwner } = await loadProductionModule();
    const composed = productionCompositionSpies();
    const readiness = deferred<void>();
    delayFirstObserverReadiness(composed, readiness.promise);
    const owner = createProductionChronicleQaOwner({
      initialChronicleId: "C01",
      composition: composed.factories,
    });
    const traversal = owner.runToTerminal();
    await owner.validationRuntime.selectChronicle("C02");
    readiness.resolve(undefined);
    const outcome = await observeWithinMicrotasks(
      traversal,
      QA_GENERATION_READY_MICROTASK_BUDGET,
    );
    try {
      expect(outcome).toMatchObject({ status: "rejected" });
      if (outcome.status === "rejected") {
        expect(outcome.error).toBeInstanceOf(Error);
        expect((outcome.error as Error).message).toMatch(/generation|active/i);
      }
      expect(composed.fixtureTransports[1]?.deliverThroughCursor).not.toHaveBeenCalled();
      expect(owner.getObserverBinding()?.generation).toBe(2);
    } finally {
      owner.dispose();
      forceReleaseComposition(composed);
    }
  });

  contractIt("imports the pure Chronicle route API without triggering the auto-boot leaf", async () => {
    const composed = productionCompositionSpies();
    const parseQuery = vi.fn(() => ({ renderer: "2d" as const, chronicleId: "C01" as const }));
    const onMounted = vi.fn<(mounted: MountedChronicleValidationRoute) => void>();
    (container as HTMLDivElement).id = "root";
    Reflect.set(window, "__vivariumChronicleValidationBootForTest", {
      composition: composed.factories,
      parseQuery,
      onMounted,
    } satisfies ChronicleValidationBootInjection);
    try {
      const route = await loadValidationRouteModule();
      await drainBoundedMicrotasks(2);
      expect(route.mountChronicleValidationRoute).toBeTypeOf("function");
      expect(route.bootChronicleValidationRoute).toBeTypeOf("function");
      expect(Reflect.has(route, "chronicleValidationBoot")).toBe(false);
      expect(parseQuery).not.toHaveBeenCalled();
      expect(onMounted).not.toHaveBeenCalled();
      expect(composed.observerShell).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(window, "__vivariumChronicleValidationBootForTest");
      forceReleaseComposition(composed);
    }
  });

  contractIt("auto-boot forwards one cooperative presentation scheduler through the real C01 query", async () => {
    installRendererBrowserHarness();
    const turns = new CooperativeBrowserTurns();
    turns.installAnimationFrame();
    const network = installNetworkTraps();
    const model = await loadModelModule();
    const { reviewCuesFor } = await loadReviewCuesModule();
    const composed = productionCompositionSpies(turns);
    const search = "?renderer=2d&chronicle=C01";
    const parseQuery = vi.fn(model.parseChronicleValidationQuery);
    const onMounted = vi.fn<(mounted: MountedChronicleValidationRoute) => void>();
    let mounted: MountedChronicleValidationRoute | null = null;
    let app: HTMLElement | null = null;
    let exactRuntime: InstrumentedObserverRuntime | null = null;
    let bodyFailure: unknown = null;
    let schedulerEvidence: Readonly<{
      typedClockSchedules: number;
      clockTurns: number;
      fallbackTurns: number;
    }> = Object.freeze({ typedClockSchedules: 0, clockTurns: 0, fallbackTurns: 0 });
    let leafExportsRouteApi = true;

    (container as HTMLDivElement).id = "root";
    window.history.replaceState(null, "", `/qa-chronicle.html${search}`);
    Reflect.set(window, "__vivariumChronicleValidationBootForTest", {
      composition: composed.factories,
      presentationClockScheduler: turns.presentationClockScheduler,
      parseQuery,
      onMounted,
    } satisfies ChronicleValidationBootInjection);

    try {
      try {
        const booted = await act(async () => {
          const entry = await loadValidationEntryModule();
          leafExportsRouteApi = Reflect.has(entry, "mountChronicleValidationRoute")
            || Reflect.has(entry, "bootChronicleValidationRoute");
          expect(entry.chronicleValidationBoot).not.toBeNull();
          const route = await entry.chronicleValidationBoot!;
          await route.owner.ready;
          return route;
        });
        mounted = booted;
        expect(onMounted).toHaveBeenCalledOnce();
        expect(onMounted).toHaveBeenCalledWith(booted);
        expect(parseQuery).toHaveBeenCalledOnce();
        expect(parseQuery).toHaveBeenCalledWith(search);
        expect(composed.observerRuntimes).toHaveLength(1);
        expect(composed.liveBundles).toHaveLength(1);

        const owner = booted.owner;
        exactRuntime = composed.observerRuntimes[0]!;
        const exactLive = composed.liveBundles[0]!;
        app = singleElement<HTMLElement>(container, ".vivarium-2d-app");
        expect(owner.observerRuntime).toBe(exactRuntime);
        await establishExactRendererBaseline(turns, app, owner, exactLive);
        expectTurnErrors(turns, []);

        turns.resetPhaseEvidence();
        const cue = reviewCuesFor("C01")[0]!;
        await act(async () => owner.validationRuntime.nextMarker());
        await turns.flushUntil(() => isCueSettled(owner, cue), C01_CUE_TURN_BUDGET);

        const frame = exactLive.session.getFrame();
        expect(owner.validationRuntime.getSnapshot().playing).toBe(false);
        expect(owner.observerRuntime.getSnapshot().frame).toBe(frame);
        expectProductionReviewCut(owner, cue);
        expect(singleElement(container, ".presentation-world-stage").getAttribute("data-ready"))
          .toBe("true");
        expect(singleElement(container, "canvas.presentation-world-stage__canvas")).toBeTruthy();
        expect(getProductionStageDebugProbe(app)?.snapshot()).toMatchObject({
          stageCount: 1,
          liveSessions: 1,
          runId: "mock-c01-v1",
          presentedCursor: cue.cursor,
          frameIdentity: frameIdentity(frame),
        });
        expect(
          (getProductionStageDebugProbe(app)?.snapshot() as {
            session: { qaRuntimeOwner: symbol };
          }).session.qaRuntimeOwner,
        ).toBe(exactRuntime.qaIdentity);
        expect(owner.observerRuntime.diagnostics()).toMatchObject({
          director: { pendingMoments: 0, activeSceneCount: 0 },
        });
        expect(turns.executedTurnCount).toBeLessThanOrEqual(C01_CUE_TURN_BUDGET);
        expectTurnErrors(turns, []);
        expectNoNetwork(network);
        schedulerEvidence = Object.freeze({
          typedClockSchedules: composed.clockBoundary?.scheduleRequestCount ?? 0,
          clockTurns: turns.clockTurnRequestCount,
          fallbackTurns: turns.fallbackMicrotaskCount,
        });
      } catch (error) {
        bodyFailure = error;
      }
    } finally {
      try {
        if (mounted !== null) await act(async () => mounted?.unmount());
      } finally {
        try {
          mounted?.owner.dispose();
        } finally {
          try {
            Reflect.deleteProperty(window, "__vivariumChronicleValidationBootForTest");
          } finally {
            disposeMountedRendererTestResources(
              app ?? (container as HTMLDivElement),
              composed.rendererAtlasPool,
            );
          }
        }
      }
    }

    expect(container?.childElementCount).toBe(0);
    expect(exactRuntime?.getSnapshot().status).toBe("disposed");
    expectProductionCompositionReleasedExactlyOnce(composed);
    if (bodyFailure !== null) throw bodyFailure;
    expect(leafExportsRouteApi, "the side-effect leaf must not export repeatable route APIs")
      .toBe(false);
    expect(
      schedulerEvidence,
      "the real-query entry must forward the injected cooperative clock and never use fallback",
    ).toEqual({
      typedClockSchedules: expect.any(Number),
      clockTurns: expect.any(Number),
      fallbackTurns: 0,
    });
    expect(schedulerEvidence.typedClockSchedules).toBe(schedulerEvidence.clockTurns);
    expect(schedulerEvidence.clockTurns).toBeGreaterThan(0);
  });

  contractIt("restarts terminal C01 with a fresh presentation generation and canonical identity", async () => {
    installRendererBrowserHarness();
    const turns = new CooperativeBrowserTurns();
    turns.installAnimationFrame();
    const network = installNetworkTraps();
    const { createProductionChronicleQaOwner } = await loadProductionModule();
    const { ChronicleValidationApp } = await loadValidationAppModule();
    const { reviewCuesFor } = await loadReviewCuesModule();
    const canonicalManifest = getChronicleManifest("C01");
    const composed = productionCompositionSpies(turns);
    const owner = createProductionChronicleQaOwner({
      initialChronicleId: "C01",
      presentationClockScheduler: turns.presentationClockScheduler,
      composition: composed.factories,
    });
    let app: HTMLElement | null = null;
    let bodyFailure: unknown = null;
    let restartFailure: unknown = null;
    let oldRuntime: InstrumentedObserverRuntime | null = null;
    let oldLive: InstrumentedLiveBundle | null = null;
    let oldTransport: InstrumentedFixtureTransport | null = null;
    let oldFeed: InstrumentedCheckpointFeed | null = null;
    let oldReplay: InstrumentedReplayClient | null = null;
    let pendingOldEnvelope: ReturnType<DeferredStreamEnvelopeGate["armNext"]> | null = null;
    let pendingOldEnvelopeReleased = false;
    const contractDeficiencies: string[] = [];
    const bindingNotifications: Array<ChronicleQaObserverBinding | null> = [];
    let expectedBindingNotificationCount: 0 | 1 = 0;
    let bindingDispose: ReturnType<typeof vi.fn<() => void>> | null = null;

    root = createRoot(container as HTMLDivElement);
    await act(async () => root?.render(<ChronicleValidationApp owner={owner} />));
    try {
      try {
        await act(async () => owner.ready);
        expect(composed.observerRuntimes).toHaveLength(1);
        expect(composed.liveBundles).toHaveLength(1);
        expect(composed.fixtureTransports).toHaveLength(1);
        expect(composed.checkpointFeeds).toHaveLength(1);
        expect(composed.replayClients).toHaveLength(1);

        oldRuntime = composed.observerRuntimes[0]!;
        oldLive = composed.liveBundles[0]!;
        oldTransport = composed.fixtureTransports[0]!;
        oldFeed = composed.checkpointFeeds[0]!;
        oldReplay = composed.replayClients[0]!;
        app = singleElement<HTMLElement>(container, ".vivarium-2d-app");
        const oldApp = app;
        const oldStage = singleElement<HTMLElement>(container, ".presentation-world-stage");
        const stableValidationRuntime = owner.validationRuntime;
        const stableValidationBar = singleElement<HTMLElement>(
          container,
          ".chronicle-validation-bar",
        );
        const bindingPort = observerBindingPort(owner);
        const initialBinding = bindingPort?.get() ?? null;
        if (bindingPort === null || initialBinding === null) {
          contractDeficiencies.push("atomic observer binding port is missing");
        } else {
          expect(Object.isFrozen(initialBinding)).toBe(true);
          expect(initialBinding).toMatchObject({
            generation: owner.validationRuntime.getSnapshot().generation,
            observerRuntime: oldRuntime,
          });
          expect(bindingPort.get()).toBe(initialBinding);
          const rawDispose = bindingPort.subscribe(() => {
            bindingNotifications.push(bindingPort.get());
          });
          bindingDispose = vi.fn(() => rawDispose());
        }
        await establishExactRendererBaseline(turns, oldApp, owner, oldLive);
        expectTurnErrors(turns, []);

        const cues = reviewCuesFor("C01");
        for (const cue of cues) {
          turns.resetPhaseEvidence();
          await act(async () => owner.validationRuntime.nextMarker());
          await turns.flushUntil(() => isCueSettled(owner, cue), C01_CUE_TURN_BUDGET);
          expectProductionReviewCut(owner, cue);
          expect(owner.validationRuntime.getSnapshot().playing).toBe(false);
          expectTurnErrors(turns, []);
          expect(turns.fallbackMicrotaskCount).toBe(0);
          expectNoNetwork(network);
        }

        const terminalGeneration = owner.validationRuntime.getSnapshot().generation;
        const terminalFrame = oldLive.session.getFrame();
        expect(terminalFrame.runId).toBe("mock-c01-v1");
        expect(terminalFrame.sourceKey).toBe("live:mock-c01-v1");
        expect(composed.fixtureProducers).toHaveLength(1);
        expect(composed.liveBridgeClients).toHaveLength(1);
        expect(composed.liveClientGates).toHaveLength(1);
        expect(composed.checkpointHarnessReceipts).toHaveLength(1);
        const oldProducer = composed.fixtureProducers[0]!;
        const pendingPayload = oldProducer.envelopePayloads.at(-1);
        expect(pendingPayload).toBeDefined();
        pendingOldEnvelope = composed.liveClientGates[0]!.armNext();
        oldProducer.callbacks.onEnvelopeAccepted(pendingPayload!);
        expect(await observeWithinMicrotasks(pendingOldEnvelope.entered, 1))
          .toMatchObject({ status: "fulfilled" });

        const restartReceipt: { outcome: BoundedPromiseOutcome<void> } = {
          outcome: Object.freeze({ status: "pending" as const }),
        };
        await act(async () => {
          restartReceipt.outcome = await observeWithinMicrotasksWithoutAct(
            owner.validationRuntime.restart(),
            QA_GENERATION_READY_MICROTASK_BUDGET,
          );
        });
        const restartOutcome = restartReceipt.outcome;
        if (restartOutcome.status === "rejected") restartFailure = restartOutcome.error;
        if (restartOutcome.status === "pending") {
          restartFailure = new Error(
            "fresh generation readiness waited on unresolved retired-generation work",
          );
        }

        expect(owner.validationRuntime).toBe(stableValidationRuntime);
        expect(singleElement(container, ".chronicle-validation-bar")).toBe(stableValidationBar);

        if (restartFailure === null) {
          await act(async () => owner.validationRuntime.pause());
          expect(owner.validationRuntime.getSnapshot().generation).toBe(terminalGeneration + 1);
          expect(composed.observerRuntimes).toHaveLength(2);
          expect(composed.liveBundles).toHaveLength(2);
          expect(composed.fixtureTransports).toHaveLength(2);
          expect(composed.checkpointFeeds).toHaveLength(2);
          expect(composed.replayClients).toHaveLength(2);
          expect(composed.replaySessions).toHaveLength(2);
          expect(composed.fixtureProducers).toHaveLength(2);
          expect(composed.liveBridgeClients).toHaveLength(2);
          expect(composed.liveClientGates).toHaveLength(2);
          expect(composed.checkpointHarnessReceipts).toHaveLength(2);

          const nextRuntime = composed.observerRuntimes[1]!;
          const nextLive = composed.liveBundles[1]!;
          const nextTransport = composed.fixtureTransports[1]!;
          const nextProducer = composed.fixtureProducers[1]!;
          expect(nextRuntime).not.toBe(oldRuntime);
          expect(nextLive).not.toBe(oldLive);
          expect(owner.observerRuntime).toBe(nextRuntime);
          expect(nextLive.session.getFrame()).toMatchObject({
            runId: "mock-c01-v1",
            sourceKey: "live:mock-c01-v1",
            presentedCursor: 0,
          });
          expect(owner.observerRuntime.getSnapshot().frame).toBe(nextLive.session.getFrame());
          expect(nextTransport.start.mock.calls[0]?.[0]).toBe(canonicalManifest);
          expect(getChronicleManifest("C01")).toBe(canonicalManifest);
          expect([...composed.liveBundles].map((bundle) => bundle.session.getFrame().runId))
            .toEqual(["mock-c01-v1", "mock-c01-v1"]);
          expect([...composed.liveBundles].map((bundle) => bundle.session.getFrame().sourceKey))
            .toEqual(["live:mock-c01-v1", "live:mock-c01-v1"]);
          expect(composed.liveBridgeClients[1]).not.toBe(composed.liveBridgeClients[0]);
          expect(composed.liveClientGates[1]).not.toBe(composed.liveClientGates[0]);
          expect(composed.checkpointHarnessReceipts[1]?.scheduler)
            .not.toBe(composed.checkpointHarnessReceipts[0]?.scheduler);

          const nextBinding = bindingPort?.get() ?? null;
          if (initialBinding === null || nextBinding === null || bindingPort === null) {
            contractDeficiencies.push("fresh atomic observer binding was not published");
          } else {
            expect(Object.isFrozen(nextBinding)).toBe(true);
            expect(nextBinding).not.toBe(initialBinding);
            expect(nextBinding).toEqual({
              generation: terminalGeneration + 1,
              observerRuntime: nextRuntime,
            });
            expect(bindingNotifications).toHaveLength(1);
            expect(bindingNotifications[0]).toBe(nextBinding);
            expect(bindingPort.get()).toBe(nextBinding);
            expectedBindingNotificationCount = 1;
          }
          if (bindingDispose === null) {
            contractDeficiencies.push("observer binding subscriber disposer is missing");
          } else {
            bindingDispose();
            expect(bindingDispose).toHaveBeenCalledTimes(1);
          }

          expectInstrumentedGenerationReleasedExactlyOnce({
            runtime: oldRuntime,
            live: oldLive,
            transport: oldTransport,
            feed: oldFeed,
            replay: oldReplay,
          });

          turns.resetPhaseEvidence();
          await act(async () => Promise.resolve());
          const nextApp = singleElement<HTMLElement>(container, ".vivarium-2d-app");
          const nextStage = singleElement<HTMLElement>(container, ".presentation-world-stage");
          expect(singleElement(container, "canvas.presentation-world-stage__canvas")).toBeTruthy();
          expect(nextApp).not.toBe(oldApp);
          expect(nextStage).not.toBe(oldStage);
          expect(owner.validationRuntime).toBe(stableValidationRuntime);
          expect(singleElement(container, ".chronicle-validation-bar"))
            .toBe(stableValidationBar);
          expect(getProductionStageDebugProbe(oldApp)).toBeNull();
          await establishExactRendererBaseline(turns, nextApp, owner, nextLive);
          expect(getProductionStageDebugProbe(nextApp)?.snapshot()).toMatchObject({
            stageCount: 1,
            liveSessions: 1,
            runId: "mock-c01-v1",
            source: "live",
            placementGeneration: nextLive.getResources()?.generation,
            frameIdentity: frameIdentity(nextLive.session.getFrame()),
          });
          expect(
            (getProductionStageDebugProbe(nextApp)?.snapshot() as {
              session: { qaRuntimeOwner: symbol };
            }).session.qaRuntimeOwner,
          ).toBe(nextRuntime.qaIdentity);
          expect(owner.observerRuntime.getSnapshot().placementOwnerId)
            .toBe(nextLive.getResources()?.ownerId);

          const currentSettle = await observeWithinMicrotasks(
            owner.settle(),
            QA_GENERATION_READY_MICROTASK_BUDGET,
          );
          expect(currentSettle).toMatchObject({ status: "fulfilled" });

          turns.resetPhaseEvidence();
          const priorCue = cues[0]!;
          await act(async () => owner.validationRuntime.nextMarker());
          await turns.flushUntil(() => isCueSettled(owner, priorCue), C01_CUE_TURN_BUDGET);
          expectProductionReviewCut(owner, priorCue);
          expect(owner.validationRuntime.getSnapshot().playing).toBe(false);
          expect(owner.observerRuntime.getSnapshot().frame).toBe(nextLive.session.getFrame());
          expect(getProductionStageDebugProbe(nextApp)?.snapshot()).toMatchObject({
            stageCount: 1,
            liveSessions: 1,
            presentedCursor: priorCue.cursor,
            frameIdentity: frameIdentity(nextLive.session.getFrame()),
          });
          expectTurnErrors(turns, []);
          expect(turns.fallbackMicrotaskCount).toBe(0);
          expectNoNetwork(network);

          turns.resetPhaseEvidence();
          const terminalCue = cues[1]!;
          await act(async () => owner.validationRuntime.nextMarker());
          await turns.flushUntil(() => isCueSettled(owner, terminalCue), C01_CUE_TURN_BUDGET);
          expectProductionReviewCut(owner, terminalCue);
          expect(composed.checkpointHarnessReceipts[0]?.clients).toHaveLength(1);
          expect(composed.checkpointHarnessReceipts[1]?.clients).toHaveLength(1);
          expect(composed.checkpointHarnessReceipts[1]?.clients[0])
            .not.toBe(composed.checkpointHarnessReceipts[0]?.clients[0]);
          expectTurnErrors(turns, []);
          expect(turns.fallbackMicrotaskCount).toBe(0);

          const currentBinding = bindingPort?.get() ?? null;
          const beforeStaleDispatch = Object.freeze({
            binding: currentBinding,
            runtime: owner.observerRuntime,
            frame: owner.observerRuntime.getSnapshot().frame,
            placementOwnerId: owner.observerRuntime.getSnapshot().placementOwnerId,
            stage: getProductionStageDebugProbe(nextApp)?.snapshot(),
            validation: owner.validationRuntime.getSnapshot(),
            ownerDiagnostics: owner.diagnostics(),
            checkpointDiagnostics: composed.checkpointFeeds[1]!.diagnostics(),
            scheduledTaskCount: owner.diagnostics().scheduledTaskCount,
          });
          const staleEnvelope = oldProducer.envelopePayloads.at(-1);
          const staleCheckpoint = oldProducer.checkpointPayloads.at(-1);
          expect(staleEnvelope).toBeDefined();
          expect(staleCheckpoint).toBeDefined();
          oldProducer.callbacks.onEnvelopeAccepted(staleEnvelope!);
          oldProducer.callbacks.onCheckpointAccepted(staleCheckpoint!);
          await drainBoundedMicrotasks(QA_STALE_PRODUCER_DRAIN_MICROTASK_BUDGET);
          expect(bindingPort?.get() ?? null).toBe(beforeStaleDispatch.binding);
          expect(owner.observerRuntime).toBe(beforeStaleDispatch.runtime);
          expect(owner.observerRuntime.getSnapshot().frame).toBe(beforeStaleDispatch.frame);
          expect(owner.observerRuntime.getSnapshot().placementOwnerId)
            .toBe(beforeStaleDispatch.placementOwnerId);
          expect(getProductionStageDebugProbe(nextApp)?.snapshot())
            .toEqual(beforeStaleDispatch.stage);
          expect(owner.validationRuntime.getSnapshot()).toBe(beforeStaleDispatch.validation);
          expect(owner.diagnostics()).toEqual(beforeStaleDispatch.ownerDiagnostics);
          expect(composed.checkpointFeeds[1]!.diagnostics())
            .toEqual(beforeStaleDispatch.checkpointDiagnostics);
          expect(owner.diagnostics().scheduledTaskCount)
            .toBe(beforeStaleDispatch.scheduledTaskCount);

          pendingOldEnvelope.release();
          pendingOldEnvelopeReleased = true;
          await drainBoundedMicrotasks(QA_STALE_PRODUCER_DRAIN_MICROTASK_BUDGET);
          expect(bindingPort?.get() ?? null).toBe(beforeStaleDispatch.binding);
          expect(owner.observerRuntime).toBe(beforeStaleDispatch.runtime);
          expect(owner.observerRuntime.getSnapshot().frame).toBe(beforeStaleDispatch.frame);
          expect(owner.observerRuntime.getSnapshot().placementOwnerId)
            .toBe(beforeStaleDispatch.placementOwnerId);
          expect(owner.validationRuntime.getSnapshot()).toBe(beforeStaleDispatch.validation);
          expect(getProductionStageDebugProbe(nextApp)?.snapshot())
            .toEqual(beforeStaleDispatch.stage);
          expect(owner.diagnostics()).toEqual(beforeStaleDispatch.ownerDiagnostics);
          expect(composed.checkpointFeeds[1]!.diagnostics())
            .toEqual(beforeStaleDispatch.checkpointDiagnostics);
          expect(owner.diagnostics().scheduledTaskCount)
            .toBe(beforeStaleDispatch.scheduledTaskCount);
          expect(nextProducer.callbacks).not.toBe(oldProducer.callbacks);
          app = nextApp;
        } else {
          expect(restartFailure).toBeInstanceOf(RangeError);
          expect((restartFailure as Error).message)
            .toBe("same-run reset cannot move behind presented truth");
          expectNoNetwork(network);
          expectTurnErrors(turns, []);
        }
      } catch (error) {
        bodyFailure = error;
      }
    } finally {
      try {
        if (pendingOldEnvelope !== null && !pendingOldEnvelopeReleased) {
          pendingOldEnvelope.release();
          pendingOldEnvelopeReleased = true;
          await drainBoundedMicrotasks(QA_STALE_PRODUCER_DRAIN_MICROTASK_BUDGET);
        }
        if (bindingDispose !== null && bindingDispose.mock.calls.length === 0) bindingDispose();
      } finally {
      try {
          await act(async () => root?.unmount());
        } finally {
          root = null;
          try {
            owner.dispose();
          } finally {
            disposeMountedRendererTestResources(
              app ?? (container as HTMLDivElement),
              composed.rendererAtlasPool,
            );
          }
        }
      }
    }

    expect(container?.childElementCount).toBe(0);
    expect(bindingNotifications).toHaveLength(expectedBindingNotificationCount);
    if (expectedBindingNotificationCount === 1) {
      expect(bindingNotifications).toHaveLength(1);
    }
    if (bindingDispose !== null) expect(bindingDispose).toHaveBeenCalledTimes(1);
    expectProductionCompositionReleasedExactlyOnce(composed);
    expectNoNetwork(network);
    if (bodyFailure !== null) throw bodyFailure;
    expect(
      {
        restartFailure: restartFailure instanceof Error
          ? `${restartFailure.name}: ${restartFailure.message}`
          : restartFailure,
        contractDeficiencies,
      },
      "restart must atomically rotate only the observer generation over canonical mechanic truth",
    ).toEqual({ restartFailure: null, contractDeficiencies: [] });
  });

  contractIt("publishes a coherent null binding after failed replacement and recovers cleanly", async () => {
    const { createProductionChronicleQaOwner } = await loadProductionModule();
    const { ChronicleValidationApp } = await loadValidationAppModule();
    const failure = new Error("replacement-transport-fault");
    const composed = productionCompositionSpies();
    const scheduler = new ObservableValidationScheduler();
    failCompositionFactory(composed, "transport", failure, 2);
    const owner = createProductionChronicleQaOwner({
      initialChronicleId: "C01",
      composition: composed.factories,
      scheduler: scheduler.port,
    });
    const ProbeWorld = ({ createRuntime }: Readonly<{
      createRuntime: () => ObserverShellRuntime;
    }>): React.ReactElement => (
      <div
        className="presentation-world-stage"
        data-runtime-status={createRuntime().getSnapshot().status}
      />
    );
    const notifications: Array<ChronicleQaObserverBinding | null> = [];
    const unsubscribe = owner.subscribeObserverBinding(() => {
      notifications.push(owner.getObserverBinding());
    });
    root = createRoot(container as HTMLDivElement);
    await act(async () => root?.render(
      <ChronicleValidationApp owner={owner} WorldApp={ProbeWorld} />,
    ));
    await act(async () => owner.ready);
    expect(scheduler.pendingTaskCount).toBeGreaterThan(0);
    const stableValidationRuntime = owner.validationRuntime;
    const stableBar = singleElement<HTMLElement>(container, ".chronicle-validation-bar");
    const oldStage = singleElement<HTMLElement>(container, ".presentation-world-stage");
    let replacementFailure: unknown = null;
    try {
      await act(async () => {
        try {
          await owner.validationRuntime.selectChronicle("C02");
        } catch (error) {
          replacementFailure = error;
        }
      });
      const attempted = getChronicleManifest("C02");
      expect.soft(replacementFailure).toBe(failure);
      expect.soft(notifications).toEqual([null]);
      expect.soft(owner.getObserverBinding()).toBeNull();
      expect.soft(() => owner.observerRuntime).toThrow(/unavailable/i);
      expect.soft(container?.querySelector(".presentation-world-stage")).toBeNull();
      expect.soft(owner.validationRuntime).toBe(stableValidationRuntime);
      expect.soft(singleElement(container, ".chronicle-validation-bar")).toBe(stableBar);
      expect.soft(owner.validationRuntime.getSnapshot()).toMatchObject({
        chronicle: { id: "C02" },
        generation: 2,
        status: "error",
        error: failure.message,
        playing: false,
        presentedCursor: 0,
        presentedTime: attempted.initialSnapshot.world_time,
        marker: null,
        scenario: null,
      });
      expect.soft(scheduler.pendingTaskCount).toBe(0);
      expectReleasedGenerationAt(composed, 0, true);
      expectReleasedGenerationAt(composed, 1, false);

      await act(async () => owner.validationRuntime.selectChronicle("C03"));
      const recoveredBinding = owner.getObserverBinding();
      expect.soft(recoveredBinding).toMatchObject({
        generation: owner.validationRuntime.getSnapshot().generation,
        observerRuntime: composed.observerRuntimes[2],
      });
      expect.soft(notifications).toEqual([null, recoveredBinding]);
      const recoveredStage = singleElement<HTMLElement>(container, ".presentation-world-stage");
      expect.soft(recoveredStage).not.toBe(oldStage);
      expect.soft(singleElement(container, ".chronicle-validation-bar")).toBe(stableBar);
      const recovered = getChronicleManifest("C03");
      expect.soft(owner.validationRuntime.getSnapshot()).toMatchObject({
        chronicle: { id: "C03" },
        status: "ready",
      });
      expect.soft(scheduler.pendingTaskCount).toBeGreaterThan(0);
      expect.soft(owner.observerRuntime.getSnapshot().frame).toMatchObject({
        runId: recovered.runId,
        sourceKey: `live:${recovered.runId}`,
      });
    } finally {
      unsubscribe();
      await act(async () => root?.unmount());
      root = null;
      owner.dispose();
      expectReleasedGenerationResources(composed, 0, 0);
      expectReleasedGenerationResources(composed, 1, null);
      expectReleasedGenerationResources(composed, 2, 1);
      forceReleaseComposition(composed);
    }
  });

  contractIt("preserves a mount failure when React root cleanup also throws", async () => {
    const route = await loadValidationRouteModule();
    const primary = new Error("route-render-primary-fault");
    const cleanup = new Error("route-unmount-cleanup-fault");
    const composed = productionCompositionSpies();
    const scratch = document.createElement("div");
    const sampleRoot = createRoot(scratch);
    const rootPrototype = Object.getPrototypeOf(sampleRoot) as {
      render(children: React.ReactNode): void;
      unmount(): void;
    };
    const rawUnmount = rootPrototype.unmount;
    await act(async () => sampleRoot.unmount());
    vi.spyOn(rootPrototype, "render").mockImplementation(() => { throw primary; });
    vi.spyOn(rootPrototype, "unmount").mockImplementation(function throwingUnmount(
      this: typeof rootPrototype,
    ): void {
      rawUnmount.call(this);
      throw cleanup;
    });
    window.history.replaceState(null, "", "/qa-chronicle.html?renderer=2d&chronicle=C01");
    let thrown: unknown = null;
    await act(async () => {
      try {
        await route.mountChronicleValidationRoute({
          root: container as HTMLDivElement,
          composition: composed.factories,
        });
      } catch (error) {
        thrown = error;
      }
    });
    const releasedBeforeManualCleanup = captureCompositionCleanup(composed);
    forceReleaseComposition(composed);
    expectExactAggregate(thrown, primary, [cleanup]);
    expect(releasedBeforeManualCleanup.duplicateDisposals).toEqual([]);
    expect(releasedBeforeManualCleanup.order).toEqual([
      "transport",
      "runtime",
      "live",
      "feed",
      "replay",
      "harness",
      "bridge",
    ]);
  });

  contractIt("unmounts and releases the route when onMounted throws", async () => {
    installRendererBrowserHarness();
    const route = await loadValidationRouteModule();
    const primary = new Error("on-mounted-primary-fault");
    const composed = productionCompositionSpies();
    let received: MountedChronicleValidationRoute | null = null;
    (container as HTMLDivElement).id = "root";
    window.history.replaceState(null, "", "/qa-chronicle.html?renderer=2d&chronicle=C00");
    let thrown: unknown = null;
    try {
      await act(async () => route.bootChronicleValidationRoute({
        composition: composed.factories,
        onMounted(mounted) {
          received = mounted;
          throw primary;
        },
      }));
    } catch (error) {
      thrown = error;
    }
    await drainBoundedMicrotasks(2);
    const releasedBeforeManualCleanup = captureCompositionCleanup(composed);
    const childCountBeforeManualCleanup = container?.childElementCount;
    let cleanupAfterRepeatedUnmount: ReturnType<typeof captureCompositionCleanup>;
    try {
      if (received !== null) await act(async () => received?.unmount());
      cleanupAfterRepeatedUnmount = captureCompositionCleanup(composed);
    } finally {
      forceReleaseComposition(composed);
    }
    expect(thrown).toBe(primary);
    expect(childCountBeforeManualCleanup).toBe(0);
    expect(releasedBeforeManualCleanup.duplicateDisposals).toEqual([]);
    expect(cleanupAfterRepeatedUnmount!).toEqual(releasedBeforeManualCleanup);
    expect(releasedBeforeManualCleanup.order).toEqual([
      "transport",
      "runtime",
      "live",
      "feed",
      "replay",
      "harness",
      "bridge",
    ]);
  });

  contractIt("preserves onMounted primary first when route cleanup throws and repeated unmount is inert", async () => {
    installRendererBrowserHarness();
    const route = await loadValidationRouteModule();
    const primary = new Error("on-mounted-primary-with-cleanup-fault");
    const cleanup = new Error("on-mounted-root-cleanup-fault");
    const composed = productionCompositionSpies();
    const scratch = document.createElement("div");
    const sampleRoot = createRoot(scratch);
    const rootPrototype = Object.getPrototypeOf(sampleRoot) as { unmount(): void };
    const rawUnmount = rootPrototype.unmount;
    await act(async () => sampleRoot.unmount());
    vi.spyOn(rootPrototype, "unmount").mockImplementation(function throwingUnmount(
      this: typeof rootPrototype,
    ): void {
      rawUnmount.call(this);
      throw cleanup;
    });
    let received: MountedChronicleValidationRoute | null = null;
    (container as HTMLDivElement).id = "root";
    window.history.replaceState(null, "", "/qa-chronicle.html?renderer=2d&chronicle=C00");
    let thrown: unknown = null;
    try {
      await act(async () => route.bootChronicleValidationRoute({
        composition: composed.factories,
        onMounted(mounted) {
          received = mounted;
          throw primary;
        },
      }));
    } catch (error) {
      thrown = error;
    }
    const beforeRepeatedUnmount = captureCompositionCleanup(composed);
    let repeatedFailure: unknown = null;
    try {
      if (received !== null) await act(async () => received?.unmount());
    } catch (error) {
      repeatedFailure = error;
    }
    const afterRepeatedUnmount = captureCompositionCleanup(composed);
    forceReleaseComposition(composed);
    expectExactAggregate(thrown, primary, [cleanup]);
    expect(repeatedFailure).toBeNull();
    expect(afterRepeatedUnmount).toEqual(beforeRepeatedUnmount);
    expect(beforeRepeatedUnmount.duplicateDisposals).toEqual([]);
    expect(beforeRepeatedUnmount.order).toEqual([
      "transport",
      "runtime",
      "live",
      "feed",
      "replay",
      "harness",
      "bridge",
    ]);
  });

  contractIt("boots C00 through the entry API and traverses production cues across real queries", async () => {
    installRendererBrowserHarness();
    const turns = new CooperativeBrowserTurns();
    turns.installAnimationFrame();
    const network = installNetworkTraps();
    const model = await loadModelModule();
    const { reviewCuesFor } = await loadReviewCuesModule();
    const routeResources: Array<{
      mounted: MountedChronicleValidationRoute | null;
      composed: ReturnType<typeof productionCompositionSpies>;
      app: HTMLElement | null;
      released: boolean;
    }> = [];
    const releaseRoute = async (record: typeof routeResources[number]): Promise<void> => {
      if (record.released) return;
      record.released = true;
      try {
        if (record.mounted !== null) await act(async () => record.mounted?.unmount());
      } finally {
        record.mounted?.owner.dispose();
        disposeMountedRendererTestResources(
          record.app ?? (container as HTMLDivElement),
          record.composed.rendererAtlasPool,
        );
      }
    };
    const bootComposition = productionCompositionSpies(turns);
    const bootResources: typeof routeResources[number] = {
      mounted: null,
      composed: bootComposition,
      app: null,
      released: false,
    };
    routeResources.push(bootResources);
    const bootSearch = "?renderer=2d&chronicle=C00";
    const bootParseQuery = vi.fn(model.parseChronicleValidationQuery);
    const onMounted = vi.fn<(mounted: MountedChronicleValidationRoute) => void>();
    (container as HTMLDivElement).id = "root";
    window.history.replaceState(null, "", `/qa-chronicle.html${bootSearch}`);
    try {
      const entry = await loadValidationRouteModule();
      const booted = await act(async () => entry.bootChronicleValidationRoute({
        composition: bootComposition.factories,
        presentationClockScheduler: turns.presentationClockScheduler,
        parseQuery: bootParseQuery,
        onMounted,
      }));
      bootResources.mounted = booted;
      await act(async () => booted.owner.ready);
      expect(onMounted).toHaveBeenCalledOnce();
      expect(onMounted).toHaveBeenCalledWith(booted);
      expect(bootParseQuery).toHaveBeenCalledOnce();
      expect(bootParseQuery).toHaveBeenCalledWith(bootSearch);
      const bootRuntime = bootComposition.observerRuntimes.at(-1)!;
      const bootLive = bootComposition.liveBundles.at(-1)!;
      const bootApp = singleElement<HTMLElement>(container, ".vivarium-2d-app");
      bootResources.app = bootApp;
      expect(booted.owner.observerRuntime).toBe(bootRuntime);
      turns.resetPhaseEvidence();
      await establishExactRendererBaseline(turns, bootApp, booted.owner, bootLive);
      turns.resetPhaseEvidence();
      const checkpointCue = reviewCuesFor("C00")[0]!;
      expect(checkpointCue.kind).toBe("checkpoint");
      await act(async () => booted.owner.validationRuntime.nextMarker());
      await turns.flushUntil(
        () => isCueSettled(booted.owner, checkpointCue),
        C01_CUE_TURN_BUDGET,
      );
      expectProductionReviewCut(booted.owner, checkpointCue);
      expect(bootApp.dataset.presentedCursor).toBe(String(checkpointCue.cursor));
      expectTurnErrors(turns, []);
      expect(turns.fallbackMicrotaskCount).toBe(0);
      await releaseRoute(bootResources);
      expectProductionCompositionReleasedExactlyOnce(bootComposition);

      for (const chronicleId of ["C01", "C17"] as const) {
        const composed = productionCompositionSpies(turns);
        const record: typeof routeResources[number] = {
          mounted: null,
          composed,
          app: null,
          released: false,
        };
        routeResources.push(record);
        const search = `?renderer=2d&chronicle=${chronicleId}`;
        window.history.replaceState(null, "", `/qa-chronicle.html${search}`);
        const parseQuery = vi.fn(model.parseChronicleValidationQuery);
        const mounted = await act(async () => entry.mountChronicleValidationRoute({
          root: container as HTMLDivElement,
          composition: composed.factories,
          presentationClockScheduler: turns.presentationClockScheduler,
          parseQuery,
        }));
        record.mounted = mounted;
        const owner = mounted.owner;
        await act(async () => owner.ready);

        expect(parseQuery).toHaveBeenCalledOnce();
        expect(parseQuery).toHaveBeenCalledWith(search);
        expect(parseQuery.mock.results[0]?.value).toEqual({ renderer: "2d", chronicleId });
        const initialRuntime = composed.observerRuntimes.at(-1)!;
        const initialLive = composed.liveBundles.at(-1)!;
        expect(owner.observerRuntime).toBe(initialRuntime);
        let currentApp = singleElement<HTMLElement>(container, ".vivarium-2d-app");
        record.app = currentApp;
        const initialStage = singleElement<HTMLElement>(container, ".presentation-world-stage");
        turns.resetPhaseEvidence();
        await establishExactRendererBaseline(turns, currentApp, owner, initialLive);
        const canvas = singleElement<HTMLCanvasElement>(
          container,
          ".presentation-world-stage > canvas.presentation-world-stage__canvas",
        );
        expect(canvas.getAttribute("aria-label")).toBe("Vivarium world");
        expect(canvas.getAttribute("aria-describedby")).toBe("world-keyboard-help");
        expect(canvas.tabIndex).toBe(0);
        expect(requiredElement<HTMLSelectElement>(container, "select", "Chronicle").value)
          .toBe(chronicleId);

        const cues = reviewCuesFor(chronicleId);
        const traversedCues = chronicleId === "C01" ? cues : cues.slice(0, 1);
        for (const cue of traversedCues) {
          turns.resetPhaseEvidence();
          await act(async () => owner.validationRuntime.nextMarker());
          await turns.flushUntil(() => isCueSettled(owner, cue), C01_CUE_TURN_BUDGET);
          expectProductionReviewCut(owner, cue);
          expect(currentApp.dataset.presentedCursor).toBe(String(cue.cursor));
          expect(getProductionStageDebugProbe(currentApp)?.snapshot()).toMatchObject({
            stageCount: 1,
            presentedCursor: cue.cursor,
          });
          expectTurnErrors(turns, []);
          expect(turns.fallbackMicrotaskCount).toBe(0);
        }

        if (chronicleId === "C01") {
          const terminalCue = cues.at(-1)!;
          const previousCue = cues.at(-2)!;
          const atTerminal = owner.validationRuntime.getSnapshot();
          expect(terminalCue.cursor).toBe(getChronicleManifest("C01")
            .expectedTerminal.presentationAuthority.terminal.cursor);
          turns.resetPhaseEvidence();
          const backwardReceipt: { outcome: BoundedPromiseOutcome<void> } = {
            outcome: Object.freeze({ status: "pending" as const }),
          };
          await act(async () => {
            backwardReceipt.outcome = await observeWithinMicrotasksWithoutAct(
              owner.validationRuntime.previousMarker(),
              QA_GENERATION_READY_MICROTASK_BUDGET,
            );
          });
          const backwardOutcome = backwardReceipt.outcome;
          if (backwardOutcome.status === "rejected") throw backwardOutcome.error;
          expect(backwardOutcome.status).toBe("fulfilled");
          expect(owner.validationRuntime.getSnapshot().generation).toBe(atTerminal.generation + 1);
          const currentRuntime = composed.observerRuntimes.at(-1)!;
          const currentLive = composed.liveBundles.at(-1)!;
          expect(currentRuntime).not.toBe(initialRuntime);
          expect(owner.observerRuntime).toBe(currentRuntime);
          await act(async () => Promise.resolve());
          const replacedApp = singleElement<HTMLElement>(container, ".vivarium-2d-app");
          const replacedStage = singleElement<HTMLElement>(container, ".presentation-world-stage");
          const replacedCanvas = singleElement<HTMLCanvasElement>(
            container,
            ".presentation-world-stage > canvas.presentation-world-stage__canvas",
          );
          expect(replacedApp).not.toBe(currentApp);
          expect(replacedStage).not.toBe(initialStage);
          expect(replacedCanvas).not.toBe(canvas);
          expect(getProductionStageDebugProbe(currentApp)).toBeNull();
          currentApp = replacedApp;
          record.app = replacedApp;
          await turns.flushUntil(() => isCueSettled(owner, previousCue), C01_CUE_TURN_BUDGET);
          expectProductionReviewCut(owner, previousCue);
          expect(replacedStage.dataset.ready).toBe("true");
          expect(getProductionStageDebugProbe(replacedApp)?.snapshot()).toMatchObject({
            stageCount: 1,
            liveSessions: 1,
            presentedCursor: previousCue.cursor,
            frameIdentity: frameIdentity(currentLive.session.getFrame()),
          });
          expect(composed.fixtureTransports.at(-2)?.dispose).toHaveBeenCalledTimes(1);
          expectTurnErrors(turns, []);
          expect(turns.fallbackMicrotaskCount).toBe(0);
        }

        expectNoNetwork(network);
        await releaseRoute(record);
        expectProductionCompositionReleasedExactlyOnce(composed);
      }
      expectNoNetwork(network);
    } finally {
      for (const record of [...routeResources].reverse()) await releaseRoute(record);
    }
  }, QA_PRODUCTION_ROUTE_BINDING_TIMEOUT_MS);

  contractIt("keeps C18 view speed selected through the production observer binding", async () => {
    installRendererBrowserHarness();
    const network = installNetworkTraps();
    const { createProductionChronicleQaOwner } = await loadProductionModule();
    const { ChronicleValidationApp } = await loadValidationAppModule();
    const composed = productionCompositionSpies();
    const owner = createProductionChronicleQaOwner({
      initialChronicleId: "C18",
      composition: composed.factories,
    });
    root = createRoot(container as HTMLDivElement);
    await act(async () => root?.render(<ChronicleValidationApp owner={owner} />));
    await act(async () => owner.ready);
    const app = singleElement<HTMLElement>(container, ".vivarium-2d-app");
    try {
      await clickButton(app, "Chronicle");
      await choose(requiredElement<HTMLSelectElement>(app, "select", "View speed"), "2");

      expect(owner.observerRuntime.diagnostics()).toMatchObject({ speed: 2 });
      expect(owner.observerRuntime.getSnapshot().diagnostics).toMatchObject({ speed: 2 });
      expect(requiredElement<HTMLSelectElement>(app, "select", "View speed").value).toBe("2");
      expectNoNetwork(network);
    } finally {
      try {
        await act(async () => root?.unmount());
      } finally {
        try {
          root = null;
        } finally {
          try {
            owner.dispose();
          } finally {
            disposeMountedRendererTestResources(app, composed.rendererAtlasPool);
          }
        }
      }
    }
  });

  contractIt("C-fix-2 regression: steps C18 cursor-by-cursor through the Nirvana arrival and recovers settlement at cursor 21", async () => {
    // C16-pattern per-checkpoint deliverThroughCursor+settle() loop (the same shape as
    // runToTerminal's manifest.id === "C16" branch above), generalized to walk C18
    // cursor-by-cursor through the region-arrival moment the C-fix investigation found
    // stalling (.superpowers/sdd/c18-fix-report.md, c18-fix2-report.md): wanderer_002
    // (Mae) crossing warm_springs -> nirvana at cursor 21. Every intermediate cursor
    // must fully settle (safeBoundaryAcknowledged + activeSceneCount back to 0) before
    // the next cursor delivers, including cursor 21 itself.
    //
    // Known harness limitation (see c18-fix2-report.md): this headless owner runs on
    // createImmediatePresentationClock, whose schedule() fires every callback via a
    // microtask regardless of the requested deadline and snaps its clock straight to
    // that deadline. That makes the settlement handshake itself exercised and
    // functionally verified here, but makes it structurally blind to the real
    // defect's magnitude (a wall-clock-scale scene duration) -- both the pre-fix and
    // post-fix code settle cursor 21 in this harness. The duration regression itself
    // (the part that actually distinguishes broken from fixed) is anchored at
    // src/presentation/choreography/lifecycleMovementCommunicationResource.test.ts's
    // "C-fix-2" unit test, which asserts the resolved program's durationMs directly
    // and does fail on revert. This test's job is the functional half: prove the
    // handshake reaches full settlement with no leftover pending/active scene state.
    const network = installNetworkTraps();
    const { createProductionChronicleQaOwner } = await loadProductionModule();
    const composed = productionCompositionSpies();
    const owner = createProductionChronicleQaOwner({
      initialChronicleId: "C18",
      composition: composed.factories,
    });
    await owner.start();
    const exactTransport = composed.fixtureTransports[0]!;
    const liveBundle = composed.liveBundles[0]!;
    // Headless Canvas-acceptance stand-in (mirrors runToTerminal's own
    // acceptPresentedFrame subscription): without it every published consequence
    // frame is permanently unaccepted and settlement can never complete, in any
    // chronicle -- that is a property of this harness, not of the moment under test.
    const acceptPresentedFrame = (): void => {
      const frame = owner.observerRuntime.getSnapshot().frame;
      if (frame !== null) liveBundle.frameAcceptance.markAccepted(frame);
    };
    const stopHeadlessAcceptance = owner.observerRuntime.subscribe(acceptPresentedFrame);
    acceptPresentedFrame();
    try {
      for (let cursor = 1; cursor <= 22; cursor += 1) {
        exactTransport.deliverThroughCursor(cursor);
        await owner.settle();
        const delivery = owner.diagnostics();
        expect(delivery.observer?.director.pendingMoments, `cursor ${cursor} pendingMoments`).toBe(0);
        expect(delivery.observer?.director.activeSceneCount, `cursor ${cursor} activeSceneCount`).toBe(0);
        expect(
          delivery.observer?.settlement?.safeBoundaryAcknowledged,
          `cursor ${cursor} safeBoundaryAcknowledged`,
        ).toBe(true);
        expect(
          owner.observerRuntime.getSnapshot().frame?.presentedCursor,
          `cursor ${cursor} presentedCursor`,
        ).toBe(cursor);
      }
    } finally {
      stopHeadlessAcceptance();
      owner.dispose();
    }
    expect(network.fetch).not.toHaveBeenCalled();
  });

  contractIt("sends all C16 envelopes through FixtureTransport and production ingress before terminal settlement", async () => {
    const network = installNetworkTraps();
    const { createProductionChronicleQaOwner } = await loadProductionModule();
    const composed = productionCompositionSpies();
    const owner = createProductionChronicleQaOwner({
      initialChronicleId: "C16",
      composition: composed.factories,
    });
    await owner.start();
    await owner.runToTerminal();
    await owner.settle();

    const exactObserverRuntime = composed.observerRuntimes[0];
    const exactLiveBundle = composed.liveBundles[0];
    const exactTransport = composed.fixtureTransports[0];
    expect(owner.observerRuntime).toBe(exactObserverRuntime);
    expect(owner.observerRuntime.getSnapshot().frame).toBe(exactLiveBundle?.session.getFrame());
    expect(owner.observerRuntime.getSnapshot().placementOwnerId)
      .toBe(exactLiveBundle?.getResources()?.ownerId);
    expect(exactTransport?.start).toHaveBeenCalledWith(getChronicleManifest("C16"));
    expect(exactTransport?.deliverThroughCursor).toHaveBeenCalled();
    expect(exactTransport?.deliverAll).not.toHaveBeenCalled();
    const productionTargets = exactTransport?.deliverThroughCursor.mock.calls
      .map(([cursor]) => cursor) ?? [];
    const productionBatchSizes = productionTargets.map((cursor, index) => (
      cursor - (productionTargets[index - 1] ?? 0)
    ));
    expect(productionTargets).toEqual([1_024, 2_048, 3_072, 4_096]);
    expect(productionBatchSizes).toEqual([1_024, 1_024, 1_024, 1_024]);
    const delivery = owner.diagnostics();
    expect(delivery.deliveredEnvelopeCursors).toEqual(
      Array.from({ length: 4_096 }, (_, index) => index + 1),
    );
    expect(new Set(delivery.deliveredEnvelopeCursors).size).toBe(4_096);
    expect(delivery.mechanicEnvelopeCount).toBe(4_096);
    expect(productionTargets.flatMap((cursor, index) => {
      const previous = productionTargets[index - 1] ?? 0;
      return Array.from({ length: cursor - previous }, (_, offset) => previous + offset + 1);
    })).toEqual(delivery.deliveredEnvelopeCursors);
    expect(owner.observerRuntime.getSnapshot().frame).toMatchObject({
      runId: "mock-c16-v1",
      sourceKey: "live:mock-c16-v1",
      ingestedCursor: 4_096,
      presentedCursor: 4_096,
      backlog: { pendingMoments: 0, state: "caught-up" },
    });
    expect(delivery.observer).toMatchObject({
      ingress: {
        ingestedCursor: 4_096,
        // Re-baselined 0 -> 4_096 (2026-07-31), same era and same cause as the line
        // below. `acceptedCount` is cumulative since the last `reset(identity)`
        // (PresentationIngress.ts:156) -- and that reset ALSO zeroes `ingestedCursor`,
        // `duplicateCount` and `gaps`. This very assertion requires ingestedCursor
        // 4_096, duplicateCount 0 and gaps [], which proves no ingress reset happened,
        // so `acceptedCount` can only be the number accepted: 4_096. It differs from
        // `lifetimeAcceptedCount` only across a reset, and there is none here, so the
        // two are necessarily equal.
        acceptedCount: 4_096,
        // Re-baselined 200 -> 4_096 (2026-07-31). `lifetimeAcceptedCount` is a
        // monotonic sum of accepted batch sizes (PresentationSession.ts:1160,
        // `+= batch.entries.length`), so for a chronicle delivered whole with
        // duplicateCount 0 and no gaps it MUST equal the envelope count. The
        // canonical statement of that invariant is PresentationSession.test.ts:1749
        // -- `lifetimeAcceptedCount: manifest.expectedFinalCursor` -- which is green.
        // C16's expectedFinalCursor is 4_096, and every other count asserted in this
        // very block is already 4_096 (ingestedCursor, deliveredEnvelopeCursors,
        // mechanicEnvelopeCount, presentedCursor). 200 is a leftover from before this
        // pressure chronicle was grown to its 4_096 envelopes -- the fixture is named
        // `C16-pressure-4096-envelopes` -- and it survived only because this file was
        // already red, so the stale assertion was never seen to fail on its own.
        lifetimeAcceptedCount: 4_096,
        duplicateCount: 0,
        lifetimeDuplicateCount: 0,
        gaps: [],
      },
      director: { pendingMoments: 0, activeSceneCount: 0 },
    });
    // Re-baselined 2026-07-31, and strengthened rather than relaxed. This block used
    // to read `expect(checkpointFeeds[0].reset).toHaveBeenCalledTimes(4)`, which is
    // from the same pre-`C16-pressure-4096-envelopes` era as the two numbers
    // re-baselined above -- and it is ARITHMETICALLY INCOMPATIBLE with the
    // `acceptedCount: 4096` five lines up. Every `feed.reset` call site
    // (`PresentationSession.ts:925` via `installSnapshot({resetFeed:true})`, and
    // `:1420` in `finishRecovery`) is immediately preceded by `ingress.reset(...)`,
    // which sets `acceptedCount = 0` (`PresentationIngress.ts:156`). Four re-points
    // spread across the four checkpoint epochs would therefore leave `acceptedCount`
    // far below 4_096; the two assertions could never both hold.
    //
    // Measured: `start` 1, `reset` 0, `lastDeliveredLine` 4,
    // `retainedSafeCheckpoints` 4. Today's C16 is one run delivered linearly, so
    // `installSnapshot` runs exactly once -- from `initializeLive`, with
    // `resetFeed: false` -- which anchors the feed through `start` and never
    // re-points it. The "4" was always about the four checkpoint LINES the feed
    // delivers, and that is now pinned directly. What replaces the old assertion is
    // strictly stronger: it keeps the four-checkpoint claim, adds the exactly-one-
    // anchor claim, and makes `acceptedCount: 4_096` above coherent by proving no
    // ingress epoch boundary occurred mid-run.
    //
    // The re-point behaviour itself is not left unguarded: `PresentationSession`
    // owns it and `PresentationSession.test.ts:2140` pins `feed.resets.at(-1)` after
    // a run replacement, green.
    expect(composed.checkpointFeeds).toHaveLength(1);
    expect(composed.checkpointFeeds[0]?.start).toHaveBeenCalledTimes(1);
    expect(composed.checkpointFeeds[0]?.reset).toHaveBeenCalledTimes(0);
    expect(composed.checkpointFeeds[0]?.diagnostics()).toMatchObject({
      runId: "mock-c16-v1",
      lastDeliveredLine: 4,
      retainedSafeCheckpoints: 4,
      faultCount: 0,
      disposed: false,
    });
    expect(delivery.observer?.director.retainedPressureSummaries).toBeLessThanOrEqual(32);
    owner.dispose();
    expect(owner.diagnostics()).toMatchObject({
      disposed: true,
      observerDisposed: true,
      transportDisposed: true,
      scheduledTaskCount: 0,
      activeListenerCount: 0,
    });
    expect(exactTransport?.dispose).toHaveBeenCalledTimes(1);
    expect(composed.checkpointFeeds[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(composed.replayClients[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(network.fetch).not.toHaveBeenCalled();
    expect(network.eventSource).not.toHaveBeenCalled();
    expect(network.webSocket).not.toHaveBeenCalled();
    expect(network.xmlHttpRequest).not.toHaveBeenCalled();
    // C16 is the pressure chronicle: 4_096 envelopes through the real production
    // ingress, director and settlement handshake. Isolated wall clock on an idle
    // machine: 7_176 / 7_400 / 7_411 / 7_454 ms originally, and 6_812 / 6_821 / 6_941 ms
    // re-measured 2026-08-21 -- i.e. it has always exceeded vitest's 5_000 ms default,
    // and only ever reported a timeout once the stale `checkpointFeeds[0].reset`
    // assertion above stopped throwing first and hiding it.
    //
    // 30_000 was derived as ~4x the ISOLATED cost. Measurement on 2026-08-21 showed
    // that factor is too thin: inside `vitest run` over all 233 files this test costs
    // 14_993 / 17_701 ms, and the GitHub runner is measured at a further 1.5x this
    // machine -- so 30_000 leaves only ~1.1x headroom on CI and this test was next in
    // line to fail. Re-derived the same way as the rest of the suite's declared bounds:
    // 55_000 = ceil(17_701 heaviest contended x 1.5 runner factor x 2 variance).
    // This declares a wall-clock cost; it relaxes no assertion, and a genuine hang
    // still fails here rather than running forever.
  }, QA_C16_PRESSURE_TIMEOUT_MS);

  contractIt("route-binds C14 controls to production recovery and proves stale callback identity is inert", async () => {
    installRendererBrowserHarness();
    const network = installNetworkTraps();
    const { createProductionChronicleQaOwner } = await loadProductionModule();
    const { ChronicleValidationApp } = await loadValidationAppModule();
    const composed = productionCompositionSpies();
    const owner = createProductionChronicleQaOwner({
      initialChronicleId: "C01",
      composition: composed.factories,
    });
    root = createRoot(container as HTMLDivElement);
    await act(async () => root?.render(<ChronicleValidationApp owner={owner} />));
    await act(async () => owner.ready);
    await choose(
      requiredElement<HTMLSelectElement>(container, "select", "Chronicle"),
      "C14",
    );
    await act(async () => owner.settle());

    const exactLiveBundle = composed.liveBundles.at(-1);
    const exactTransport = composed.fixtureTransports.at(-1);
    const exactCheckpointFeed = composed.checkpointFeeds.at(-1);
    const exactReplayClient = composed.replayClients.at(-1);
    expect(owner.observerRuntime).toBe(composed.observerRuntimes.at(-1));
    expect(owner.observerRuntime.getSnapshot().frame).toBe(exactLiveBundle?.session.getFrame());
    expect(owner.observerRuntime.getSnapshot().placementOwnerId)
      .toBe(exactLiveBundle?.getResources()?.ownerId);
    expect(exactTransport?.start).toHaveBeenCalledWith(getChronicleManifest("C14"));
    expect(exactCheckpointFeed?.subscribeFault).toHaveBeenCalled();
    expect(owner.validationRuntime.getSnapshot().scenario).toMatchObject({
      kind: "C14",
      phase: "initial",
      mechanicEnvelopeCount: 0,
    });
    await clickButton(container, "Recover cursor gap and 413");
    await act(async () => owner.settle());
    expect(owner.observerRuntime.getSnapshot().frame).toMatchObject({
      source: "live",
      runId: "mock-c14-v1",
      sourceKey: "live:mock-c14-v1",
      presentedCursor: 2,
    });
    expect(owner.observerRuntime.diagnostics()).toMatchObject({
      ingress: { acceptedCount: 0, gaps: [] },
      checkpoint: { faultCount: 1 },
      recovery: {
        status: "frozen-retry",
        digest: {
          skipped: { firstCursor: 3, lastCursor: 3 },
        },
      },
    });
    expect(owner.diagnostics().c14GapEvidence).toEqual({
      firstMissingCursor: 1,
      lastMissingCursor: 2,
    });
    const consumedCheckpointReceipt = exactCheckpointFeed?.diagnostics.mock.results.at(-1)?.value;
    expect(consumedCheckpointReceipt).toMatchObject({ faultCount: 1 });
    expect((consumedCheckpointReceipt as unknown as { qaReceipt: symbol }).qaReceipt)
      .toBe(exactCheckpointFeed?.qaIdentity);
    expect(exactLiveBundle?.session.retryRecovery).not.toHaveBeenCalled();

    await clickButton(container, "Retry 413, then recover overflow");
    await act(async () => owner.settle());
    const overflowDiagnostics = owner.observerRuntime.diagnostics();
    expect(exactLiveBundle?.session.retryRecovery).toHaveBeenCalledOnce();
    expect(owner.observerRuntime.getSnapshot().frame).toMatchObject({
      presentedCursor: 4,
      world: { projectedThroughCursor: 4 },
    });
    expect(overflowDiagnostics).toMatchObject({
      ingress: { acceptedCount: 0 },
      recovery: { status: "idle" },
      lastCompletedRecovery: {
        reason: "queue-overflow",
        digest: {
          skipped: { firstCursor: 4, lastCursor: 4 },
          majorMoments: [],
          compressedAmbientCount: 1,
        },
        snappedCursor: 4,
      },
    });
    const overflowReceipt = (overflowDiagnostics as typeof overflowDiagnostics & Readonly<{
      lastCompletedRecovery: CompletedRecoveryReceipt;
    }>).lastCompletedRecovery;
    expect(Object.isFrozen(overflowReceipt)).toBe(true);
    expect(Object.isFrozen(overflowReceipt.digest)).toBe(true);
    expect(Object.isFrozen(overflowReceipt.digest.skipped)).toBe(true);
    expect(Object.isFrozen(overflowReceipt.digest.majorMoments)).toBe(true);
    expect(owner.validationRuntime.getSnapshot().scenario?.lastCompletedRecovery)
      .toBe(overflowReceipt);
    await clickButton(container, "Replace run");
    await act(async () => owner.settle());
    expect(owner.observerRuntime.getSnapshot().frame).toMatchObject({
      source: "live",
      runId: "mock-c14-v1-replacement",
      sourceKey: "live:mock-c14-v1-replacement",
      presentedCursor: 0,
    });
    expect(exactLiveBundle?.replaceRun).toHaveBeenCalled();
    expect(exactTransport?.replaceRun).toHaveBeenCalledWith(getChronicleManifest("C14"));
    const externallyObservedBeforeStale = externallyObservedOwnerState(owner);
    await clickButton(container, "Reject stale callback");
    await act(async () => owner.settle());
    const externallyObservedAfterStale = externallyObservedOwnerState(owner);
    expect(externallyObservedAfterStale).toEqual(externallyObservedBeforeStale);

    const diagnostics = owner.diagnostics();
    expect(diagnostics.mechanicEnvelopeCount).toBe(0);
    expect(diagnostics.deliveredEnvelopeCursors).toEqual([]);
    expect(diagnostics.staleCallback).toMatchObject({ disposition: "rejected" });
    expect(diagnostics.staleCallback?.after).toEqual(diagnostics.staleCallback?.before);
    expect(owner.validationRuntime.getSnapshot().scenario).toMatchObject({
      kind: "C14",
      phase: "complete",
      mechanicEnvelopeCount: 0,
    });
    expect(network.fetch).not.toHaveBeenCalled();
    expect(network.eventSource).not.toHaveBeenCalled();
    expect(network.webSocket).not.toHaveBeenCalled();
    expect(network.xmlHttpRequest).not.toHaveBeenCalled();
    await act(async () => root?.unmount());
    root = null;
    await Promise.resolve();
    owner.dispose();
    expect(exactTransport?.dispose).toHaveBeenCalledTimes(1);
    expect(exactCheckpointFeed?.dispose).toHaveBeenCalledTimes(1);
    expect(exactReplayClient?.dispose).toHaveBeenCalledTimes(1);
  }, QA_PRODUCTION_ROUTE_BINDING_TIMEOUT_MS);

  contractIt("route-binds C15 controls to isolated production Live and Archive owners", async () => {
    installRendererBrowserHarness();
    const network = installNetworkTraps();
    const { createProductionChronicleQaOwner } = await loadProductionModule();
    const { ChronicleValidationApp } = await loadValidationAppModule();
    const composed = productionCompositionSpies();
    const owner = createProductionChronicleQaOwner({
      initialChronicleId: "C01",
      composition: composed.factories,
    });
    root = createRoot(container as HTMLDivElement);
    await act(async () => root?.render(<ChronicleValidationApp owner={owner} />));
    await act(async () => owner.ready);
    await choose(
      requiredElement<HTMLSelectElement>(container, "select", "Chronicle"),
      "C15",
    );
    await act(async () => owner.settle());

    const exactLiveBundle = composed.liveBundles.at(-1);
    const exactReplayClient = composed.replayClients.at(-1);
    expect(owner.observerRuntime).toBe(composed.observerRuntimes.at(-1));
    await clickButton(container, "Prime Live cursor 2");
    await act(async () => owner.settle());
    const live2Owner = owner.observerRuntime.getSnapshot().placementOwnerId;
    expect(owner.observerRuntime.getSnapshot().frame).toMatchObject({
      source: "live",
      runId: "mock-c15-v1",
      sourceKey: "live:mock-c15-v1",
      presentedCursor: 2,
    });
    expect(owner.observerRuntime.getSnapshot().frame).toBe(exactLiveBundle?.session.getFrame());
    expect(live2Owner).toBe(exactLiveBundle?.getResources()?.ownerId);
    await clickButton(container, "Enter Archive cursor 2");
    await act(async () => owner.settle());
    const archive2Owner = owner.observerRuntime.getSnapshot().placementOwnerId;
    const exactArchiveBundle = composed.archiveBundles.at(-1);
    expect(archive2Owner).not.toBe(live2Owner);
    expect(archive2Owner).toBe(exactArchiveBundle?.getResources().ownerId);
    expect(owner.observerRuntime.getSnapshot().frame).toMatchObject({
      source: "archive",
      runId: "mock-c15-v1",
      sourceKey: "archive:mock-c15-v1:line-1:window-2-2",
      presentedCursor: 2,
    });
    expect(owner.observerRuntime.getSnapshot().frame).toBe(exactArchiveBundle?.session.getFrame());
    expect(exactReplayClient?.fetchForRun).toHaveBeenCalledWith("mock-c15-v1");
    const exactReplaySession = composed.replaySessions.at(-1);
    const exactReplayArtifacts = composed.replayArtifacts.at(-1);
    const exactArchiveWindow = composed.archiveSession.mock.calls.at(-1)?.[0].window;
    expect(typeof exactReplayClient?.qaIdentity).toBe("symbol");
    expect(typeof exactReplayArtifacts?.qaReceipt).toBe("symbol");
    expect(exactReplaySession?.restore.mock.calls.some(
      ([artifacts]) => artifacts === exactReplayArtifacts,
    )).toBe(true);
    expect(exactReplaySession?.getPresentationWindow.mock.results.some(
      ({ value }) => value === exactArchiveWindow,
    )).toBe(true);
    expect(owner.observerRuntime.getSnapshot().frame).toMatchObject({
      sourceKey: exactArchiveWindow?.sourceKey,
      presentedCursor: exactArchiveWindow?.lastCursor,
      world: {
        exactBaseCursor: exactArchiveWindow?.snapshot.event_cursor,
        worldTime: exactArchiveWindow?.checkpointWorldTime,
      },
    });

    await clickButton(container, "Advance hidden Live to cursor 4");
    await act(async () => owner.settle());
    expect(owner.observerRuntime.getSnapshot()).toMatchObject({
      placementOwnerId: archive2Owner,
      frame: { source: "archive", presentedCursor: 2 },
    });
    expect(exactArchiveBundle?.session.getFrame().presentedCursor).toBe(2);
    expect(exactLiveBundle?.session.getFrame()).toMatchObject({
      source: "live",
      runId: "mock-c15-v1",
      sourceKey: "live:mock-c15-v1",
      presentedCursor: 4,
    });
    expect(exactLiveBundle?.session.diagnostics()).toMatchObject({
      ingress: { ingestedCursor: 4, acceptedCount: 0 },
    });
    await clickButton(container, "Return to Live cursor 4");
    await act(async () => owner.settle());
    expect(owner.observerRuntime.getSnapshot()).toMatchObject({
      placementOwnerId: live2Owner,
      frame: {
        source: "live",
        runId: "mock-c15-v1",
        sourceKey: "live:mock-c15-v1",
        presentedCursor: 4,
      },
    });
    expect(owner.observerRuntime.getSnapshot().frame).toBe(exactLiveBundle?.session.getFrame());
    expect(owner.diagnostics()).toMatchObject({
      mechanicEnvelopeCount: 0,
      deliveredEnvelopeCursors: [],
    });
    expect(network.fetch).not.toHaveBeenCalled();
    expect(network.eventSource).not.toHaveBeenCalled();
    expect(network.webSocket).not.toHaveBeenCalled();
    expect(network.xmlHttpRequest).not.toHaveBeenCalled();
    await act(async () => root?.unmount());
    root = null;
    await Promise.resolve();
    owner.dispose();
    expect(exactLiveBundle?.dispose).toHaveBeenCalledTimes(1);
    expect(exactArchiveBundle?.dispose).toHaveBeenCalledTimes(1);
    expect(composed.fixtureTransports.at(-1)?.dispose).toHaveBeenCalledTimes(1);
    expect(composed.checkpointFeeds.at(-1)?.dispose).toHaveBeenCalledTimes(1);
    expect(exactReplayClient?.dispose).toHaveBeenCalledTimes(1);
  }, QA_PRODUCTION_ROUTE_BINDING_TIMEOUT_MS);

  contractIt("disposes every C14/C15 production owner cleanly from every intermediate phase", async () => {
    const { createProductionChronicleQaOwner } = await loadProductionModule();
    const network = installNetworkTraps();
    const phaseSets = [
      {
        id: "C14" as const,
        phases: [
          "c14-gap-413",
          "c14-overflow",
          "c14-replace",
          "c14-stale-reject",
        ] as const,
      },
      {
        id: "C15" as const,
        phases: [
          "c15-prime-live-2",
          "c15-enter-archive-2",
          "c15-hidden-live-4",
          "c15-return-live-4",
        ] as const,
      },
    ];

    for (const { id, phases } of phaseSets) {
      for (let completedPhases = 0; completedPhases <= phases.length; completedPhases += 1) {
        const composed = productionCompositionSpies();
        const owner = createProductionChronicleQaOwner({
          initialChronicleId: id,
          composition: composed.factories,
        });
        await owner.start();
        for (const phase of phases.slice(0, completedPhases)) {
          await owner.validationRuntime.runScenarioPhase(phase);
          await owner.settle();
        }
        owner.dispose();
        owner.dispose();
        expect(composed.observerRuntimes).toContain(owner.observerRuntime);
        expect(owner.observerRuntime.getSnapshot().status).toBe("disposed");
        for (const runtime of composed.observerRuntimes) {
          expect(runtime.dispose, `${id} observer after ${completedPhases} phases`)
            .toHaveBeenCalledTimes(1);
        }
        for (const bundle of composed.liveBundles) {
          expect(bundle.dispose, `${id} live bundle after ${completedPhases} phases`)
            .toHaveBeenCalledTimes(1);
          expect(bundle.session.diagnostics().disposed).toBe(true);
        }
        for (const bundle of composed.archiveBundles) {
          expect(bundle.dispose, `${id} archive bundle after ${completedPhases} phases`)
            .toHaveBeenCalledTimes(1);
          expect(bundle.session.diagnostics().disposed).toBe(true);
        }
        for (const transport of composed.fixtureTransports) {
          expect(transport.dispose, `${id} transport after ${completedPhases} phases`)
            .toHaveBeenCalledTimes(1);
        }
        for (const feed of composed.checkpointFeeds) {
          expect(feed.dispose, `${id} feed after ${completedPhases} phases`)
            .toHaveBeenCalledTimes(1);
          expect(feed.diagnostics().disposed).toBe(true);
        }
        for (const replay of composed.replayClients) {
          expect(replay.dispose, `${id} replay after ${completedPhases} phases`)
            .toHaveBeenCalledTimes(1);
          expect(replay.diagnostics().disposed).toBe(true);
        }
        expect(owner.diagnostics(), `${id} after ${completedPhases} phases`).toMatchObject({
          disposed: true,
          observerDisposed: true,
          transportDisposed: true,
          checkpointFeedDisposed: true,
          replayDisposed: true,
          scheduledTaskCount: 0,
          activeListenerCount: 0,
        });
      }
    }
    expect(network.fetch).not.toHaveBeenCalled();
    expect(network.eventSource).not.toHaveBeenCalled();
    expect(network.webSocket).not.toHaveBeenCalled();
    expect(network.xmlHttpRequest).not.toHaveBeenCalled();
  }, QA_PRODUCTION_OWNER_DISPOSAL_TIMEOUT_MS);

  contractIt("executes typed C14 gap, 413, overflow, replacement, and stale rejection in order", async () => {
    const { createC14ChronicleValidationScenario } = await loadScenariosModule();
    const selected = endpoint("live", "mock-c14-v1-replacement", 0, "live-owner-2");
    const completionReceipt = completedOverflowReceipt();
    const port: C14ScenarioPort = {
      recoverGapAndCheckpoint413: vi.fn(async () => ({
        presentedCursor: 2 as const,
        gap: { firstCursor: 1 as const, lastCursor: 2 as const },
        checkpointStatus: 413 as const,
        checkpointFaultCount: 1 as const,
        recoveryStatus: "frozen-retry" as const,
        recoveryDigest: { firstCursor: 3 as const, lastCursor: 3 as const },
      })),
      retryCheckpoint413ThenRecoverOverflow: vi.fn(async () => ({
        checkpointRetryCount: 1 as const,
        checkpointRecoveredCursor: 3 as const,
        presentedCursor: 4 as const,
        overflow: true as const,
        snapshotRequired: true as const,
        lastCompletedRecovery: completionReceipt,
      })),
      replaceRun: vi.fn(async () => ({
        previousRunId: "mock-c14-v1",
        replacementRunId: "mock-c14-v1-replacement",
        supersededGeneration: 7,
      })),
      dispatchStaleCallback: vi.fn(async () => ({
        accepted: false as const,
        selected,
        live: { ...selected, source: "live" as const },
      })),
    };
    const scenario = createC14ChronicleValidationScenario({
      manifest: getChronicleManifest("C14"),
      port,
    });

    await scenario.recoverGapAndCheckpoint413();
    await scenario.retryCheckpoint413ThenRecoverOverflow();
    await scenario.replaceRun();
    await scenario.rejectStaleCallback();

    expect(port.dispatchStaleCallback).toHaveBeenCalledWith(7);
    expect(scenario.getSnapshot()).toMatchObject({
      kind: "C14",
      phase: "complete",
      completed: true,
      selected,
      live: selected,
      lastCompletedRecovery: completionReceipt,
      records: [
        { label: "cursor-gap", mechanicEventsFabricated: false },
        { label: "oversized-record-413", mechanicEventsFabricated: false },
        { label: "checkpoint-413-retry", mechanicEventsFabricated: false },
        { label: "overflow-recovery", mechanicEventsFabricated: false },
        { label: "run-replacement", mechanicEventsFabricated: false },
        { label: "stale-old-run-rejected", mechanicEventsFabricated: false },
      ],
    });
    scenario.dispose();
  });

  contractIt("fails closed for C14 order and every gap, status, overflow, run, or stale evidence drift", async () => {
    const { createC14ChronicleValidationScenario } = await loadScenariosModule();
    const outOfOrder = createC14ChronicleValidationScenario({
      manifest: getChronicleManifest("C14"),
      port: validC14Port(),
    });
    await expect(outOfOrder.retryCheckpoint413ThenRecoverOverflow())
      .rejects.toThrow(/gap|413|order/i);
    outOfOrder.dispose();

    const corruptions: readonly Readonly<{
      label: string;
      port: C14ScenarioPort;
      phase: "gap" | "overflow" | "replacement" | "stale";
    }>[] = [
      {
        label: "gap",
        port: validC14Port({
          recoverGapAndCheckpoint413: vi.fn(async () => ({
            ...validC14Gap413Result(),
            gap: { firstCursor: 0, lastCursor: 2 },
          })) as unknown as C14ScenarioPort["recoverGapAndCheckpoint413"],
        }),
        phase: "gap",
      },
      {
        label: "checkpoint status",
        port: validC14Port({
          recoverGapAndCheckpoint413: vi.fn(async () => ({
            ...validC14Gap413Result(),
            checkpointStatus: 500,
          })) as unknown as C14ScenarioPort["recoverGapAndCheckpoint413"],
        }),
        phase: "gap",
      },
      {
        label: "gap presented cursor",
        port: validC14Port({
          recoverGapAndCheckpoint413: vi.fn(async () => ({
            ...validC14Gap413Result(),
            presentedCursor: 1,
          })) as unknown as C14ScenarioPort["recoverGapAndCheckpoint413"],
        }),
        phase: "gap",
      },
      {
        label: "gap last cursor",
        port: validC14Port({
          recoverGapAndCheckpoint413: vi.fn(async () => ({
            ...validC14Gap413Result(),
            gap: { firstCursor: 1, lastCursor: 3 },
          })) as unknown as C14ScenarioPort["recoverGapAndCheckpoint413"],
        }),
        phase: "gap",
      },
      {
        label: "checkpoint fault count",
        port: validC14Port({
          recoverGapAndCheckpoint413: vi.fn(async () => ({
            ...validC14Gap413Result(),
            checkpointFaultCount: 2,
          })) as unknown as C14ScenarioPort["recoverGapAndCheckpoint413"],
        }),
        phase: "gap",
      },
      {
        label: "413 recovery status",
        port: validC14Port({
          recoverGapAndCheckpoint413: vi.fn(async () => ({
            ...validC14Gap413Result(),
            recoveryStatus: "failed",
          })) as unknown as C14ScenarioPort["recoverGapAndCheckpoint413"],
        }),
        phase: "gap",
      },
      {
        label: "413 recovery digest",
        port: validC14Port({
          recoverGapAndCheckpoint413: vi.fn(async () => ({
            ...validC14Gap413Result(),
            recoveryDigest: { firstCursor: 2, lastCursor: 3 },
          })) as unknown as C14ScenarioPort["recoverGapAndCheckpoint413"],
        }),
        phase: "gap",
      },
      {
        label: "checkpoint retry count",
        port: validC14Port({
          retryCheckpoint413ThenRecoverOverflow: vi.fn(async () => ({
            ...validC14RetryOverflowResult(),
            checkpointRetryCount: 2,
          })) as unknown as C14ScenarioPort["retryCheckpoint413ThenRecoverOverflow"],
        }),
        phase: "overflow",
      },
      {
        label: "checkpoint recovered cursor",
        port: validC14Port({
          retryCheckpoint413ThenRecoverOverflow: vi.fn(async () => ({
            ...validC14RetryOverflowResult(),
            checkpointRecoveredCursor: 2,
          })) as unknown as C14ScenarioPort["retryCheckpoint413ThenRecoverOverflow"],
        }),
        phase: "overflow",
      },
      {
        label: "overflow",
        port: validC14Port({
          retryCheckpoint413ThenRecoverOverflow: vi.fn(async () => ({
            ...validC14RetryOverflowResult(),
            overflow: false,
          })) as unknown as C14ScenarioPort["retryCheckpoint413ThenRecoverOverflow"],
        }),
        phase: "overflow",
      },
      {
        label: "overflow presented cursor",
        port: validC14Port({
          retryCheckpoint413ThenRecoverOverflow: vi.fn(async () => ({
            ...validC14RetryOverflowResult(),
            presentedCursor: 3,
          })) as unknown as C14ScenarioPort["retryCheckpoint413ThenRecoverOverflow"],
        }),
        phase: "overflow",
      },
      {
        label: "snapshot required",
        port: validC14Port({
          retryCheckpoint413ThenRecoverOverflow: vi.fn(async () => ({
            ...validC14RetryOverflowResult(),
            snapshotRequired: false,
          })) as unknown as C14ScenarioPort["retryCheckpoint413ThenRecoverOverflow"],
        }),
        phase: "overflow",
      },
      {
        label: "overflow recovery reason",
        port: validC14Port({
          retryCheckpoint413ThenRecoverOverflow: vi.fn(async () => ({
            ...validC14RetryOverflowResult(),
            lastCompletedRecovery: {
              ...completedOverflowReceipt(),
              reason: "cursor-gap",
            },
          })) as unknown as C14ScenarioPort["retryCheckpoint413ThenRecoverOverflow"],
        }),
        phase: "overflow",
      },
      {
        label: "overflow recovery digest",
        port: validC14Port({
          retryCheckpoint413ThenRecoverOverflow: vi.fn(async () => ({
            ...validC14RetryOverflowResult(),
            lastCompletedRecovery: {
              ...completedOverflowReceipt(),
              digest: {
                ...completedOverflowReceipt().digest,
                skipped: { firstCursor: 3, lastCursor: 4 },
              },
            },
          })) as unknown as C14ScenarioPort["retryCheckpoint413ThenRecoverOverflow"],
        }),
        phase: "overflow",
      },
      {
        label: "overflow compressed ambient count",
        port: validC14Port({
          retryCheckpoint413ThenRecoverOverflow: vi.fn(async () => ({
            ...validC14RetryOverflowResult(),
            lastCompletedRecovery: {
              ...completedOverflowReceipt(),
              digest: {
                ...completedOverflowReceipt().digest,
                compressedAmbientCount: 2,
              },
            },
          })) as unknown as C14ScenarioPort["retryCheckpoint413ThenRecoverOverflow"],
        }),
        phase: "overflow",
      },
      {
        label: "overflow major moments",
        port: validC14Port({
          retryCheckpoint413ThenRecoverOverflow: vi.fn(async () => ({
            ...validC14RetryOverflowResult(),
            lastCompletedRecovery: {
              ...completedOverflowReceipt(),
              digest: {
                ...completedOverflowReceipt().digest,
                majorMoments: [{ type: "speak", count: 1 }],
              },
            },
          })) as unknown as C14ScenarioPort["retryCheckpoint413ThenRecoverOverflow"],
        }),
        phase: "overflow",
      },
      {
        label: "overflow snapped cursor",
        port: validC14Port({
          retryCheckpoint413ThenRecoverOverflow: vi.fn(async () => ({
            ...validC14RetryOverflowResult(),
            lastCompletedRecovery: {
              ...completedOverflowReceipt(),
              snappedCursor: 3,
            },
          })) as unknown as C14ScenarioPort["retryCheckpoint413ThenRecoverOverflow"],
        }),
        phase: "overflow",
      },
      {
        label: "run identity",
        port: validC14Port({
          replaceRun: vi.fn(async () => ({
            previousRunId: "wrong-run",
            replacementRunId: "mock-c14-v1-replacement",
            supersededGeneration: 7,
          })),
        }),
        phase: "replacement",
      },
      {
        label: "replacement run identity",
        port: validC14Port({
          replaceRun: vi.fn(async () => ({
            previousRunId: "mock-c14-v1",
            replacementRunId: "wrong-replacement",
            supersededGeneration: 7,
          })),
        }),
        phase: "replacement",
      },
      {
        label: "superseded generation",
        port: validC14Port({
          replaceRun: vi.fn(async () => ({
            previousRunId: "mock-c14-v1",
            replacementRunId: "mock-c14-v1-replacement",
            supersededGeneration: -1,
          })),
        }),
        phase: "replacement",
      },
      {
        label: "stale accepted",
        port: validC14Port({
          dispatchStaleCallback: vi.fn(async () => {
            const selected = endpoint("live", "mock-c14-v1-replacement", 0, "live-owner-2");
            return { accepted: true, selected, live: selected };
          }) as unknown as C14ScenarioPort["dispatchStaleCallback"],
        }),
        phase: "stale",
      },
      ...staleEndpointCorruptions(),
    ];
    for (const corruption of corruptions) {
      const scenario = createC14ChronicleValidationScenario({
        manifest: getChronicleManifest("C14"),
        port: corruption.port,
      });
      await expect(invokeC14Through(scenario, corruption.phase), corruption.label)
        .rejects.toThrow(/gap|413|status|cursor|overflow|snapshot|run|generation|identity|stale|accepted/i);
      scenario.dispose();
    }
  });

  contractIt("keeps C15 Archive 2 selected while isolated Live advances from 2 to 4", async () => {
    const { createC15ChronicleValidationScenario } = await loadScenariosModule();
    const live2 = endpoint("live", "mock-c15-v1", 2, "live-owner");
    const live4 = endpoint("live", "mock-c15-v1", 4, "live-owner");
    const archive2 = endpoint("archive", "mock-c15-v1", 2, "archive-owner");
    const port: C15ScenarioPort = {
      primeLiveCursor: vi.fn(async () => ({ selected: live2, live: live2 as ScenarioEndpoint & { source: "live" } })),
      enterArchiveAt: vi.fn(async () => ({ selected: archive2, live: live2 as ScenarioEndpoint & { source: "live" } })),
      advanceLiveWhileArchived: vi.fn(async () => ({ selected: archive2, live: live4 as ScenarioEndpoint & { source: "live" } })),
      returnToLive: vi.fn(async () => ({ selected: live4, live: live4 as ScenarioEndpoint & { source: "live" } })),
    };
    const scenario = createC15ChronicleValidationScenario({
      manifest: getChronicleManifest("C15"),
      port,
    });

    await expect(scenario.enterArchive()).rejects.toThrow(/prime|live 2|order/i);
    await scenario.primeLiveCursor();
    await scenario.enterArchive();
    expect(scenario.getSnapshot()).toMatchObject({ selected: archive2, live: live2 });
    expect(scenario.getSnapshot().selected?.ownerId)
      .not.toBe(scenario.getSnapshot().live?.ownerId);

    await scenario.advanceLiveWhileArchived();
    expect(scenario.getSnapshot()).toMatchObject({ selected: archive2, live: live4 });
    await scenario.returnToLive();
    expect(scenario.getSnapshot()).toMatchObject({
      phase: "complete",
      completed: true,
      selected: live4,
      live: live4,
    });
    scenario.dispose();
  });

  contractIt("renders mutable subscribed state with fresh controls, markers, statuses, and failure tokens", async () => {
    const { ChronicleValidationBar } = await loadValidationBarModule();
    const runtime = new MutableControlRuntime(controlSnapshot({
      status: "loading",
      playing: false,
      markerIndex: -1,
      marker: null,
    }));
    const copyText = vi.fn(async () => undefined);
    root = createRoot(container as HTMLDivElement);
    await act(async () => root?.render(
      <ChronicleValidationBar
        runtime={runtime}
        copyText={copyText}
        readViewport={() => ({ width: 390, height: 844 })}
      />,
    ));

    const controls = container?.querySelector('[aria-label="Chronicle validation controls"]');
    expect(controls).not.toBeNull();
    const chronicleSelect = requiredElement<HTMLSelectElement>(controls, "select", "Chronicle");
    const speedSelect = requiredElement<HTMLSelectElement>(controls, "select", "Playback speed");
    expect([...chronicleSelect.options].map(({ value }) => value)).toEqual(CHRONICLE_IDS);
    expect(controls?.textContent).toContain("Loading");
    expect(buttonElement(controls, "Play Chronicle").disabled).toBe(true);
    expect(buttonElement(controls, "Previous review marker").disabled).toBe(true);
    expect(buttonElement(controls, "Next review marker").disabled).toBe(true);

    await act(async () => runtime.publish(controlSnapshot({
      status: "ready",
      playing: true,
      markerIndex: 0,
      marker: controlReviewManifest().markers[0]!,
    })));
    expect(controls?.textContent).toContain("C12");
    expect(controls?.textContent).toContain("Cursor 7");
    expect(controls?.textContent).toContain("1800120001.25");
    expect(controls?.textContent).toContain("Attack");

    await clickButton(controls, "Pause Chronicle");
    expect(buttonElement(controls, "Resume Chronicle").disabled).toBe(false);
    await clickButton(controls, "Resume Chronicle");
    await choose(chronicleSelect, "C17");
    expect(controls?.textContent).toContain("C17");
    expect(controls?.textContent).toContain("Generation 2");
    await choose(speedSelect, "0.5");
    await clickButton(controls, "Restart Chronicle");
    expect(controls?.textContent).toContain("Generation 3");
    await clickButton(controls, "Previous review marker");
    await clickButton(controls, "Next review marker");
    await clickButton(controls, "Copy failure token");

    expect(runtime.trace).toEqual(expect.arrayContaining([
      "pause",
      "resume",
      "select:C17",
      "speed:0.5",
      "restart",
      "previous-marker",
      "next-marker",
      "token:390x844",
    ]));
    expect(copyText).toHaveBeenCalledWith(
      "VQA1|C17|cursor=3|time=1800170001|speed=0.5|viewport=390x844",
    );

    await act(async () => runtime.publish({
      ...runtime.getSnapshot(),
      status: "complete",
      playing: false,
      markerIndex: runtime.getSnapshot().chronicle.markers.length - 1,
      marker: runtime.getSnapshot().chronicle.markers.at(-1) ?? null,
    }));
    expect(controls?.textContent).toContain("Complete");
    expect(buttonElement(controls, "Play Chronicle").disabled).toBe(true);
    expect(buttonElement(controls, "Next review marker").disabled).toBe(true);

    await act(async () => runtime.publish({
      ...runtime.getSnapshot(),
      status: "error",
      error: "Fixture playback failed",
      playing: false,
    }));
    expect(controls?.textContent).toContain("Fixture playback failed");
    expect(buttonElement(controls, "Play Chronicle").disabled).toBe(true);
    expect(buttonElement(controls, "Restart Chronicle").disabled).toBe(false);
  });
});

async function loadModelModule(): Promise<ValidationModelModule> {
  return importExisting<ValidationModelModule>("src/qa/chronicleValidationModel.ts");
}

async function loadReviewCuesModule(): Promise<ReviewCuesModule> {
  return importExisting<ReviewCuesModule>("src/qa/chronicleReviewCues.ts");
}

async function loadRuntimeModule(): Promise<RuntimeModule> {
  return importExisting<RuntimeModule>("src/qa/chronicleValidationRuntime.ts");
}

async function loadScenariosModule(): Promise<ScenariosModule> {
  return importExisting<ScenariosModule>("src/qa/chronicleValidationScenarios.ts");
}

async function loadValidationBarModule(): Promise<ValidationBarModule> {
  return importExisting<ValidationBarModule>("src/qa/ChronicleValidationBar.tsx");
}

async function loadProductionModule(): Promise<ProductionModule> {
  return importExisting<ProductionModule>("src/qa/chronicleValidationProduction.ts");
}

async function loadValidationAppModule(): Promise<ValidationAppModule> {
  return importExisting<ValidationAppModule>("src/qa/ChronicleValidationApp.tsx");
}

async function loadValidationEntryModule(): Promise<ValidationEntryModule> {
  return importExisting<ValidationEntryModule>("src/qa/chronicleValidationEntry.tsx");
}

async function loadValidationRouteModule(): Promise<ValidationRouteModule> {
  const pureRouteModule = "./chronicleValidationRoute";
  return vi.importActual<ValidationRouteModule>(pureRouteModule);
}

async function importExisting<T>(relative: string): Promise<T> {
  switch (relative) {
    case "src/qa/chronicleValidationModel.ts":
      return import("./chronicleValidationModel") as Promise<T>;
    case "src/qa/chronicleReviewCues.ts":
      return import("./chronicleReviewCues") as Promise<T>;
    case "src/qa/chronicleValidationRuntime.ts":
      return import("./chronicleValidationRuntime") as Promise<T>;
    case "src/qa/chronicleValidationScenarios.ts":
      return import("./chronicleValidationScenarios") as Promise<T>;
    case "src/qa/ChronicleValidationBar.tsx":
      return import("./ChronicleValidationBar") as Promise<T>;
    case "src/qa/chronicleValidationProduction.ts":
      return import("./chronicleValidationProduction") as Promise<T>;
    case "src/qa/ChronicleValidationApp.tsx":
      return import("./ChronicleValidationApp") as Promise<T>;
    case "src/qa/chronicleValidationEntry.tsx":
      return import("./chronicleValidationEntry") as Promise<T>;
    default:
      throw new Error(`Unknown Chronicle QA module path: ${relative}`);
  }
}

interface FakePlaybackHarness extends ChroniclePlayback {
  readonly deliveredCursors: number[];
  readonly deliveredMarkers: Array<Readonly<{
    kind: ReviewMarker["kind"];
    cursor: number;
    presentedTime: number;
  }>>;
  flushPendingMarker(): void;
  publish(snapshot: PlaybackSnapshot): void;
}

async function makeRuntime(
  initialChronicleId: ChronicleId,
  options: Readonly<{
    readyPromises?: readonly Promise<void>[];
    deferMarkerDelivery?: boolean;
  }> = {},
): Promise<Readonly<{
  runtime: ChronicleValidationRuntime;
  scheduler: FakeScheduler;
  trace: string[];
  playbacks: FakePlaybackHarness[];
}>> {
  const { createChronicleValidationRuntime } = await loadRuntimeModule();
  const scheduler = new FakeScheduler();
  const trace: string[] = [];
  const playbacks: FakePlaybackHarness[] = [];
  const runtime = createChronicleValidationRuntime({
    initialChronicleId,
    getManifest: getChronicleManifest,
    createPlayback({ manifest, generation }) {
      const playback = new FakePlayback(
        manifest,
        generation,
        trace,
        options.readyPromises?.[playbacks.length] ?? Promise.resolve(),
        options.deferMarkerDelivery ?? false,
      );
      playbacks.push(playback);
      return playback;
    },
    scheduler: {
      schedule(delayMs, callback): () => void {
        trace.push(`schedule:${delayMs}`);
        return scheduler.schedule(delayMs, callback, trace);
      },
    },
  });
  return { runtime, scheduler, trace, playbacks };
}

class FakePlayback implements FakePlaybackHarness {
  readonly ready: Promise<void>;
  readonly deliveredCursors: number[] = [];
  readonly deliveredMarkers: Array<Readonly<{
    kind: ReviewMarker["kind"];
    cursor: number;
    presentedTime: number;
  }>> = [];
  readonly publish: (snapshot: PlaybackSnapshot) => void;
  private readonly listeners = new Set<() => void>();
  private snapshot: PlaybackSnapshot;
  private pendingMarker: ReviewMarker | null = null;
  private deferredPause = false;
  private paused = false;

  constructor(
    private readonly manifest: ChronicleManifest,
    private readonly generation: number,
    private readonly trace: string[],
    ready: Promise<void>,
    private readonly deferMarkerDelivery: boolean,
  ) {
    this.ready = ready;
    this.snapshot = playbackSnapshot(manifest, 0);
    this.publish = (snapshot): void => {
      this.snapshot = snapshot;
      for (const listener of [...this.listeners]) listener();
    };
    trace.push(`create:${manifest.id}:g${generation}`);
  }

  start(): void { this.trace.push(`start:${this.manifest.id}:g${this.generation}`); }
  getSnapshot(): PlaybackSnapshot { return this.snapshot; }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.trace.push(`unsubscribe:${this.manifest.id}:g${this.generation}`);
      this.listeners.delete(listener);
    };
  }
  deliverThroughCursor(cursor: number): void {
    this.trace.push(`deliver:${this.manifest.id}:g${this.generation}:${cursor}`);
    this.deliveredCursors.push(cursor);
    this.publish(playbackSnapshot(this.manifest, cursor));
  }
  deliverToMarker(marker: ReviewMarker): void {
    const intent = Object.freeze({
      kind: marker.kind,
      cursor: marker.cursor,
      presentedTime: marker.presentedTime,
    });
    this.trace.push(
      `marker:${this.manifest.id}:g${this.generation}:${intent.kind}:${intent.cursor}:${intent.presentedTime}`,
    );
    this.deliveredMarkers.push(intent);
    if (this.deferMarkerDelivery) {
      this.pendingMarker = marker;
      return;
    }
    this.publish({
      ...playbackSnapshot(this.manifest, marker.cursor),
      presentedTime: marker.presentedTime,
    });
  }
  flushPendingMarker(): void {
    const marker = this.pendingMarker;
    if (marker === null || this.paused) return;
    this.pendingMarker = null;
    this.publish({
      ...playbackSnapshot(this.manifest, marker.cursor),
      presentedTime: marker.presentedTime,
    });
    if (this.deferredPause) {
      this.deferredPause = false;
      this.paused = true;
      this.trace.push(`pause-applied:${this.manifest.id}:g${this.generation}`);
    }
  }
  pause(): void {
    if (this.deferMarkerDelivery && this.pendingMarker !== null) {
      this.deferredPause = true;
      this.trace.push(`pause-deferred:${this.manifest.id}:g${this.generation}`);
      return;
    }
    this.paused = true;
    this.trace.push(`pause:${this.manifest.id}:g${this.generation}`);
  }
  resume(): void {
    this.paused = false;
    this.trace.push(`resume:${this.manifest.id}:g${this.generation}`);
  }
  setSpeed(speed: PlaybackSpeed): void {
    this.trace.push(`speed:${this.manifest.id}:g${this.generation}:${speed}`);
  }
  dispose(): void {
    this.trace.push(`dispose:${this.manifest.id}:g${this.generation}`);
    this.listeners.clear();
  }
}

class FakeScheduler {
  invokedCallbackCount = 0;
  private readonly tasks: Array<{
    readonly delayMs: number;
    readonly callback: () => void;
    readonly trace: string[];
    cancelled: boolean;
  }> = [];

  get pendingTaskCount(): number {
    return this.tasks.filter(({ cancelled }) => !cancelled).length;
  }

  schedule(delayMs: number, callback: () => void, trace: string[]): () => void {
    const task = { delayMs, callback, trace, cancelled: false };
    this.tasks.push(task);
    return () => {
      if (task.cancelled) return;
      task.cancelled = true;
      trace.push(`cancel:${delayMs}`);
    };
  }

  flushNext(): void {
    const task = this.tasks.find((candidate) => !candidate.cancelled);
    if (task === undefined) return;
    task.cancelled = true;
    this.invokedCallbackCount += 1;
    task.callback();
  }

  flushAll(limit = 100): void {
    let calls = 0;
    while (this.tasks.some(({ cancelled }) => !cancelled)) {
      if (calls >= limit) throw new Error(`scheduler exceeded ${limit} callbacks`);
      calls += 1;
      this.flushNext();
    }
  }

  invokeEveryRetainedCallback(): void {
    for (const task of [...this.tasks]) task.callback();
  }
}

class CooperativeBrowserTurns {
  clockTurnRequestCount = 0;
  animationFrameRequestCount = 0;
  acceptanceTurnRequestCount = 0;
  atlasTurnRequestCount = 0;
  fallbackMicrotaskCount = 0;
  executedTurnCount = 0;
  readonly turnErrors: unknown[] = [];
  private nextId = 1;
  private readonly tasks: Array<{
    readonly id: number;
    readonly kind: "clock" | "animation-frame" | "acceptance" | "atlas" | "fallback-microtask";
    readonly callback: () => void;
    cancelled: boolean;
  }> = [];

  readonly presentationClockScheduler: CooperativePresentationClockScheduler = Object.freeze({
    scheduleTurn: (callback: () => void): (() => void) => {
      this.clockTurnRequestCount += 1;
      return this.enqueue("clock", callback);
    },
  });

  readonly atlasCommitScheduler: AtlasCommitScheduler = Object.freeze({
    schedule: (callback: () => void): number => {
      const id = this.nextId;
      this.atlasTurnRequestCount += 1;
      this.enqueue("atlas", callback, id);
      return id;
    },
    cancel: (id: number): void => this.cancel(id),
  });

  installAnimationFrame(): void {
    vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => {
      const id = this.nextId;
      this.animationFrameRequestCount += 1;
      this.enqueue("animation-frame", () => callback(this.executedTurnCount * 16), id);
      return id;
    }));
    vi.stubGlobal("cancelAnimationFrame", vi.fn((id: number) => this.cancel(id)));
  }

  scheduleClockFallback(callback: VoidFunction): void {
    this.fallbackMicrotaskCount += 1;
    this.enqueue("fallback-microtask", callback);
  }

  scheduleAcceptance(callback: () => void): void {
    this.acceptanceTurnRequestCount += 1;
    this.enqueue("acceptance", callback);
  }

  resetPhaseEvidence(): void {
    this.clockTurnRequestCount = 0;
    this.animationFrameRequestCount = 0;
    this.acceptanceTurnRequestCount = 0;
    this.atlasTurnRequestCount = 0;
    this.fallbackMicrotaskCount = 0;
    this.executedTurnCount = 0;
    this.turnErrors.length = 0;
  }

  async flushUntil(predicate: () => boolean, maximumTurns: number): Promise<void> {
    for (let turn = 0; turn < maximumTurns; turn += 1) {
      if (predicate()) return;
      // Zero-delay atlas preparation must drain before advancing a future story
      // deadline, matching the browser's idle interval between authored phases.
      const task = this.tasks.find((candidate) => !candidate.cancelled && candidate.kind === "atlas")
        ?? this.tasks.find((candidate) => !candidate.cancelled);
      if (task === undefined) {
        await act(async () => Promise.resolve());
        if (predicate()) return;
        if (this.tasks.some((candidate) => !candidate.cancelled)) continue;
        throw new Error(
          `cooperative browser scheduler became idle before settlement: ${this.evidence()}`,
        );
      }
      task.cancelled = true;
      this.executedTurnCount += 1;
      await act(async () => {
        try {
          task.callback();
        } catch (error) {
          this.turnErrors.push(error);
        }
        await Promise.resolve();
      });
    }
    throw new Error(
      `cooperative browser scheduler exceeded ${maximumTurns} turns: ${this.evidence()}`,
    );
  }

  private enqueue(
    kind: "clock" | "animation-frame" | "acceptance" | "atlas" | "fallback-microtask",
    callback: () => void,
    requestedId?: number,
  ): () => void {
    const id = requestedId ?? this.nextId;
    this.nextId = Math.max(this.nextId, id + 1);
    const task = { id, kind, callback, cancelled: false };
    this.tasks.push(task);
    return () => { task.cancelled = true; };
  }

  private cancel(id: number): void {
    const task = this.tasks.find((candidate) => candidate.id === id);
    if (task !== undefined) task.cancelled = true;
  }

  private evidence(): string {
    return JSON.stringify({
      executed: this.executedTurnCount,
      clock: this.clockTurnRequestCount,
      animationFrame: this.animationFrameRequestCount,
      acceptance: this.acceptanceTurnRequestCount,
      atlas: this.atlasTurnRequestCount,
      fallbackMicrotask: this.fallbackMicrotaskCount,
      errors: this.turnErrors.map((error) => error instanceof Error ? error.message : String(error)),
      pending: this.tasks.filter(({ cancelled }) => !cancelled).map(({ kind }) => kind),
    });
  }
}

class TypedPresentationClockBoundary {
  scheduleRequestCount = 0;

  constructor(private readonly turns: CooperativeBrowserTurns) {}

  wrapFactory(factory: () => PresentationClock): () => PresentationClock {
    return () => {
      const clock = factory();
      return Object.freeze({
        now: (): number => clock.now(),
        schedule: (deadlineMs: number, callback: () => void): (() => void) => {
          this.scheduleRequestCount += 1;
          const original = globalThis.queueMicrotask;
          globalThis.queueMicrotask = (microtask: VoidFunction): void => {
            this.turns.scheduleClockFallback(microtask);
          };
          try {
            return clock.schedule(deadlineMs, callback);
          } finally {
            globalThis.queueMicrotask = original;
          }
        },
      });
    };
  }
}

class DeferredStreamEnvelopeGate {
  private armed: Readonly<{
    entered: Deferred<void>;
    release: Deferred<void>;
  }> | null = null;

  armNext(): Readonly<{
    entered: Promise<void>;
    release(): void;
  }> {
    if (this.armed !== null) throw new Error("stream envelope gate is already armed");
    const entered = deferred<void>();
    const release = deferred<void>();
    this.armed = Object.freeze({ entered, release });
    return Object.freeze({
      entered: entered.promise,
      release: () => release.resolve(undefined),
    });
  }

  wrap(handler: (envelope: EventEnvelope) => void | Promise<void>): (
    envelope: EventEnvelope,
  ) => Promise<void> {
    return async (envelope): Promise<void> => {
      const armed = this.armed;
      if (armed !== null) {
        this.armed = null;
        armed.entered.resolve(undefined);
        await armed.release.promise;
      }
      await handler(envelope);
    };
  }
}

function playbackSnapshot(manifest: ChronicleManifest, cursor: number): PlaybackSnapshot {
  const entry = manifest.entries[Math.max(0, cursor - 1)];
  const checkpoint = [...manifest.checkpoints]
    .reverse()
    .find((record) => record.checkpoint.event_cursor <= cursor);
  return {
    runId: manifest.runId,
    source: "live",
    sourceKey: `fixture:${manifest.runId}`,
    presentedCursor: cursor,
    presentedTime: entry?.event.timestamp
      ?? checkpoint?.checkpoint.world_time
      ?? manifest.initialSnapshot.world_time,
  };
}

function endpoint(
  source: "live" | "archive",
  runId: string,
  cursor: number,
  ownerId: string,
): ScenarioEndpoint {
  return Object.freeze({
    source,
    runId,
    sourceKey: source === "live"
      ? `live:${runId}`
      : `archive:${runId}:line-1:window-2-2`,
    cursor,
    ownerId,
  });
}

function validC14Gap413Result(): Awaited<
  ReturnType<C14ScenarioPort["recoverGapAndCheckpoint413"]>
> {
  return {
    presentedCursor: 2,
    gap: { firstCursor: 1, lastCursor: 2 },
    checkpointStatus: 413,
    checkpointFaultCount: 1,
    recoveryStatus: "frozen-retry",
    recoveryDigest: { firstCursor: 3, lastCursor: 3 },
  };
}

function completedOverflowReceipt(): CompletedRecoveryReceipt {
  return Object.freeze({
    reason: "queue-overflow" as const,
    digest: Object.freeze({
      skipped: Object.freeze({ firstCursor: 4 as const, lastCursor: 4 as const }),
      majorMoments: Object.freeze([] as const),
      compressedAmbientCount: 1 as const,
    }),
    snappedCursor: 4 as const,
  });
}

function validC14RetryOverflowResult(): Awaited<
  ReturnType<C14ScenarioPort["retryCheckpoint413ThenRecoverOverflow"]>
> {
  return {
    checkpointRetryCount: 1,
    checkpointRecoveredCursor: 3,
    presentedCursor: 4,
    overflow: true,
    snapshotRequired: true,
    lastCompletedRecovery: completedOverflowReceipt(),
  };
}

function validC14Port(overrides: Partial<C14ScenarioPort> = {}): C14ScenarioPort {
  const selected = endpoint("live", "mock-c14-v1-replacement", 0, "live-owner-2");
  return {
    recoverGapAndCheckpoint413: vi.fn(async () => validC14Gap413Result()),
    retryCheckpoint413ThenRecoverOverflow: vi.fn(async () => validC14RetryOverflowResult()),
    replaceRun: vi.fn(async () => ({
      previousRunId: "mock-c14-v1",
      replacementRunId: "mock-c14-v1-replacement",
      supersededGeneration: 7,
    })),
    dispatchStaleCallback: vi.fn(async () => ({
      accepted: false as const,
      selected,
      live: selected as ScenarioEndpoint & Readonly<{ source: "live" }>,
    })),
    ...overrides,
  };
}

function staleEndpointCorruptions(): readonly Readonly<{
  label: string;
  port: C14ScenarioPort;
  phase: "stale";
}>[] {
  const exact = endpoint("live", "mock-c14-v1-replacement", 0, "live-owner-2");
  const mutations = [
    ["source", "archive"],
    ["runId", "wrong-run"],
    ["sourceKey", "live:wrong-source-key"],
    ["cursor", 1],
    ["ownerId", "wrong-owner"],
  ] as const satisfies readonly (readonly [keyof ScenarioEndpoint, string | number])[];
  return (["selected", "live"] as const).flatMap((side) => mutations.map(([field, value]) => {
    const corrupted = { ...exact, [field]: value } as ScenarioEndpoint;
    const changed = (Object.keys(exact) as (keyof ScenarioEndpoint)[])
      .filter((key) => !Object.is(exact[key], corrupted[key]));
    if (changed.length !== 1 || changed[0] !== field) {
      throw new Error(`C14 ${side}.${field} corruption must mutate exactly one leaf`);
    }
    const selected = side === "selected" ? corrupted : exact;
    const live = (side === "live" ? corrupted : exact) as ScenarioEndpoint & {
      source: "live";
    };
    return {
      label: `stale ${side}.${field}`,
      port: validC14Port({
        dispatchStaleCallback: vi.fn(async () => ({
          accepted: false as const,
          selected,
          live,
        })),
      }),
      phase: "stale" as const,
    };
  }));
}

async function invokeC14Through(
  scenario: C14Scenario,
  phase: "gap" | "overflow" | "replacement" | "stale",
): Promise<void> {
  await scenario.recoverGapAndCheckpoint413();
  if (phase === "gap") return;
  await scenario.retryCheckpoint413ThenRecoverOverflow();
  if (phase === "overflow") return;
  await scenario.replaceRun();
  if (phase === "replacement") return;
  await scenario.rejectStaleCallback();
}

function externallyObservedOwnerState(owner: ProductionChronicleQaOwner): unknown {
  const frame = owner.observerRuntime.getSnapshot().frame;
  if (frame === null) throw new Error("production observer frame is missing");
  return Object.freeze({
    runId: frame.runId,
    source: frame.source,
    sourceKey: frame.sourceKey,
    cursor: frame.presentedCursor,
    revision: frame.revision,
    world: frame.world,
    diagnostics: owner.observerRuntime.diagnostics(),
  });
}

function expectProductionReviewCut(
  owner: ProductionChronicleQaOwner,
  cue: AuthoredReviewCue,
): void {
  expect(owner.validationRuntime.getSnapshot()).toMatchObject({
    playing: false,
    presentedCursor: cue.cursor,
    presentedTime: cue.presentedTime,
    marker: {
      key: cue.key,
      kind: cue.kind,
      cursor: cue.cursor,
      presentedTime: cue.presentedTime,
    },
  });
  expect(owner.observerRuntime.getSnapshot().frame).toMatchObject({
    presentedCursor: cue.cursor,
    world: { worldTime: cue.presentedTime },
  });
}

async function establishExactRendererBaseline(
  turns: CooperativeBrowserTurns,
  app: HTMLElement,
  owner: ProductionChronicleQaOwner,
  live: InstrumentedLiveBundle,
): Promise<void> {
  await act(async () => {
    await import("../renderer2d/production/ProductionCanvasSceneFactory");
  });
  const baselineReady = (): boolean => {
    const frame = live.session.getFrame();
    const selected = owner.observerRuntime.getSnapshot().frame;
    const probe = getProductionStageDebugProbe(app)?.snapshot() as Readonly<{
      stageCount: number;
      frameIdentity: Readonly<{ runId: string; sourceKey: string; revision: number }>;
    }> | undefined;
    return app.querySelector<HTMLElement>(".presentation-world-stage")?.dataset.ready === "true"
      && selected === frame
      && probe?.stageCount === 1
      && probe.frameIdentity.runId === frame.runId
      && probe.frameIdentity.sourceKey === frame.sourceKey
      && probe.frameIdentity.revision === frame.revision;
  };
  try {
    await turns.flushUntil(baselineReady, QA_RENDERER_BOOTSTRAP_TURN_BUDGET);
  } catch (error) {
    const frame = live.session.getFrame();
    const selected = owner.observerRuntime.getSnapshot().frame;
    const stage = app.querySelector<HTMLElement>(".presentation-world-stage");
    const probe = getProductionStageDebugProbe(app)?.snapshot();
    throw new Error(`renderer baseline did not settle: ${JSON.stringify({
      stageReady: stage?.dataset.ready ?? null,
      sameFrame: selected === frame,
      frame: frameIdentity(frame),
      probe,
    })}`, { cause: error });
  }

  const frame = live.session.getFrame();
  const stage = singleElement<HTMLElement>(app, ".presentation-world-stage");
  expect(stage.dataset.ready).toBe("true");
  expect(singleElement(app, "canvas.presentation-world-stage__canvas")).toBeTruthy();
  expect(owner.observerRuntime.getSnapshot().frame).toBe(frame);
  expect(getProductionStageDebugProbe(app)?.snapshot()).toMatchObject({
    stageCount: 1,
    liveSessions: 1,
    archiveSessions: 0,
    runId: frame.runId,
    presentedCursor: frame.presentedCursor,
    frameIdentity: frameIdentity(frame),
  });
  expect(turns.executedTurnCount).toBeLessThanOrEqual(QA_RENDERER_BOOTSTRAP_TURN_BUDGET);
}

function isCueSettled(owner: ProductionChronicleQaOwner, cue: AuthoredReviewCue): boolean {
  const diagnostics = owner.observerRuntime.diagnostics();
  const frame = owner.observerRuntime.getSnapshot().frame;
  return frame?.presentedCursor === cue.cursor
    && frame.world.worldTime === cue.presentedTime
    && diagnostics?.director.pendingMoments === 0
    && diagnostics.director.activeSceneCount === 0;
}

function frameIdentity(frame: Readonly<{
  runId: string;
  sourceKey: string;
  revision: number;
}>): Readonly<{ runId: string; sourceKey: string; revision: number }> {
  return Object.freeze({
    runId: frame.runId,
    sourceKey: frame.sourceKey,
    revision: frame.revision,
  });
}

function expectTurnErrors(turns: CooperativeBrowserTurns, expected: readonly string[]): void {
  expect(turns.turnErrors.map((error) => error instanceof Error ? error.message : String(error)))
    .toEqual(expected);
}

function settlementFailureMessage(error: unknown): string {
  return error instanceof Error
    ? `C01 did not settle after attributed cooperative turns: ${error.message}`
    : "C01 did not settle after attributed cooperative turns";
}

function expectNoNetwork(network: ReturnType<typeof installNetworkTraps>): void {
  expect(network.fetch).not.toHaveBeenCalled();
  expect(network.eventSource).not.toHaveBeenCalled();
  expect(network.webSocket).not.toHaveBeenCalled();
  expect(network.xmlHttpRequest).not.toHaveBeenCalled();
}

interface ObserverBindingPort {
  get(): ChronicleQaObserverBinding | null;
  subscribe(listener: () => void): () => void;
}

function observerBindingPort(owner: ProductionChronicleQaOwner): ObserverBindingPort | null {
  const get = Reflect.get(owner, "getObserverBinding") as unknown;
  const subscribe = Reflect.get(owner, "subscribeObserverBinding") as unknown;
  if (typeof get !== "function" || typeof subscribe !== "function") return null;
  return Object.freeze({
    get: () => (get as () => ChronicleQaObserverBinding | null).call(owner),
    subscribe: (listener: () => void) => (
      subscribe as (listener: () => void) => () => void
    ).call(owner, listener),
  });
}

function disposeMountedRendererTestResources(app: HTMLElement, pool: SharedAtlasPool): void {
  let releasedProbe: ReturnType<typeof getProductionStageDebugProbe> | undefined;
  let before: ReturnType<SharedAtlasPool["diagnostics"]> | null = null;
  let after: ReturnType<SharedAtlasPool["diagnostics"]> | null = null;
  try {
    releasedProbe = getProductionStageDebugProbe(app);
    before = pool.diagnostics();
  } finally {
    pool.dispose();
    after = pool.diagnostics();
  }
  expect(releasedProbe).toBeNull();
  expect(before).toMatchObject({
    disposed: false,
    compressedBytes: 0,
    decodedBytes: 0,
    leases: 0,
    inFlightCount: 0,
    waiterCount: 0,
    activeAtlasIds: [],
    entries: [],
  });
  expect(before!.lifecycle.leasesCreated).toBe(before!.lifecycle.leasesReleased);
  expect(after).toMatchObject({
    disposed: true,
    compressedBytes: 0,
    decodedBytes: 0,
    leases: 0,
    inFlightCount: 0,
    waiterCount: 0,
    activeAtlasIds: [],
    entries: [],
  });
}

function expectInstrumentedGenerationReleasedExactlyOnce(input: Readonly<{
  runtime: InstrumentedObserverRuntime;
  live: InstrumentedLiveBundle;
  transport: InstrumentedFixtureTransport;
  feed: InstrumentedCheckpointFeed;
  replay: InstrumentedReplayClient;
}>): void {
  expect(input.runtime.dispose).toHaveBeenCalledTimes(1);
  expect(input.live.dispose).toHaveBeenCalledTimes(1);
  expect(input.transport.dispose).toHaveBeenCalledTimes(1);
  expect(input.feed.dispose).toHaveBeenCalledTimes(1);
  expect(input.replay.dispose).toHaveBeenCalledTimes(1);
  expect(input.runtime.subscriptionDisposals.length).toBeGreaterThan(0);
  for (const dispose of input.runtime.subscriptionDisposals) {
    expect(dispose).toHaveBeenCalledTimes(1);
  }
}

function expectProductionCompositionReleasedExactlyOnce(
  composed: ReturnType<typeof productionCompositionSpies>,
): void {
  expect(composed.observerRuntimes.length).toBeGreaterThan(0);
  expect(composed.liveBundles.length).toBe(composed.observerRuntimes.length);
  expect(composed.fixtureTransports.length).toBe(composed.observerRuntimes.length);
  expect(composed.checkpointFeeds.length).toBe(composed.observerRuntimes.length);
  expect(composed.replayClients.length).toBe(composed.observerRuntimes.length);
  composed.observerRuntimes.forEach((runtime, index) => {
    expectInstrumentedGenerationReleasedExactlyOnce({
      runtime,
      live: composed.liveBundles[index]!,
      transport: composed.fixtureTransports[index]!,
      feed: composed.checkpointFeeds[index]!,
      replay: composed.replayClients[index]!,
    });
  });
  for (const archive of composed.archiveBundles) {
    expect(archive.dispose).toHaveBeenCalledTimes(1);
  }
}

class MutableControlRuntime implements ChronicleValidationRuntime {
  readonly ready = Promise.resolve();
  readonly trace: string[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(private snapshot: RuntimeSnapshot) {}

  publish(snapshot: RuntimeSnapshot): void {
    this.snapshot = snapshot;
    for (const listener of [...this.listeners]) listener();
  }
  getSnapshot(): RuntimeSnapshot { return this.snapshot; }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  async start(): Promise<void> { this.trace.push("start"); }
  async selectChronicle(id: ChronicleId): Promise<void> {
    this.trace.push(`select:${id}`);
    this.publish(controlSnapshot({
      chronicle: controlReviewManifest(id),
      generation: this.snapshot.generation + 1,
      status: "ready",
      error: null,
      playing: true,
      speed: this.snapshot.speed,
      presentedCursor: id === "C17" ? 3 : 0,
      presentedTime: id === "C17" ? 1_800_170_001 : 0,
      markerIndex: 1,
      marker: controlReviewManifest(id).markers[1] ?? controlReviewManifest(id).markers[0] ?? null,
    }));
  }
  pause(): void {
    this.trace.push("pause");
    this.publish({ ...this.snapshot, playing: false });
  }
  resume(): void {
    this.trace.push("resume");
    this.publish({ ...this.snapshot, playing: true });
  }
  setSpeed(speed: PlaybackSpeed): void {
    this.trace.push(`speed:${speed}`);
    this.publish({ ...this.snapshot, speed });
  }
  async restart(): Promise<void> {
    this.trace.push("restart");
    this.publish({ ...this.snapshot, generation: this.snapshot.generation + 1 });
  }
  async previousMarker(): Promise<void> { this.trace.push("previous-marker"); }
  async nextMarker(): Promise<void> { this.trace.push("next-marker"); }
  async runScenarioPhase(id: ChronicleScenarioControl["id"]): Promise<void> {
    this.trace.push(`scenario:${id}`);
  }
  copyFailureToken(viewport: Readonly<{ width: number; height: number }>): string {
    this.trace.push(`token:${viewport.width}x${viewport.height}`);
    return `VQA1|${this.snapshot.chronicle.id}|cursor=${this.snapshot.presentedCursor}`
      + `|time=${this.snapshot.presentedTime}|speed=${this.snapshot.speed}`
      + `|viewport=${viewport.width}x${viewport.height}`;
  }
  dispose(): void {
    this.trace.push("dispose");
    this.publish({ ...this.snapshot, status: "disposed", playing: false });
    this.listeners.clear();
  }
}

function controlSnapshot(overrides: Partial<RuntimeSnapshot> = {}): RuntimeSnapshot {
  const chronicle = overrides.chronicle ?? controlReviewManifest("C12");
  return {
    chronicle,
    generation: 1,
    status: "ready",
    error: null,
    playing: true,
    speed: 1,
    presentedCursor: 7,
    presentedTime: 1_800_120_001.25,
    markerIndex: 0,
    marker: chronicle.markers[0] ?? null,
    scenario: null,
    ...overrides,
  };
}

function controlReviewManifest(id: ChronicleId = "C12"): ChronicleReviewManifest {
  const manifest = getChronicleManifest(id);
  const times = id === "C17"
    ? [1_800_170_000, 1_800_170_001, 1_800_170_002]
    : [1_800_120_001, 1_800_120_001.25, 1_800_120_002];
  const markers = ["Opening", "Attack", "Resolution"].map((label, index) => ({
    key: label.toLowerCase(),
    label,
    instruction: `Review ${label.toLowerCase()}.`,
    kind: "event" as const,
    cursor: index + 1,
    presentedTime: times[index]!,
  }));
  return {
    id,
    slug: manifest.slug,
    expectedFinalCursor: manifest.expectedFinalCursor,
    authorityKind: manifest.expectedTerminal.presentationAuthority.kind,
    markers,
  };
}

function requiredElement<T extends HTMLElement>(
  rootElement: Element | null | undefined,
  tag: string,
  accessibleName: string,
): T {
  const element = [...(rootElement?.querySelectorAll<T>(tag) ?? [])]
    .find((candidate) => candidate.getAttribute("aria-label") === accessibleName);
  if (element === undefined) throw new Error(`${tag} ${accessibleName} is missing`);
  return element;
}

function singleElement<T extends Element = Element>(
  rootElement: Element | null | undefined,
  selector: string,
): T {
  const elements = [...(rootElement?.querySelectorAll<T>(selector) ?? [])];
  expect(elements, `${selector} must identify exactly one production element`).toHaveLength(1);
  return elements[0]!;
}

function buttonElement(
  rootElement: Element | null | undefined,
  name: string,
): HTMLButtonElement {
  const button = [...(rootElement?.querySelectorAll("button") ?? [])]
    .find((candidate) => candidate.getAttribute("aria-label") === name
      || candidate.textContent?.trim() === name);
  if (button === undefined) throw new Error(`button ${name} is missing`);
  return button;
}

async function clickButton(rootElement: Element | null | undefined, name: string): Promise<void> {
  const button = buttonElement(rootElement, name);
  await act(async () => button.dispatchEvent(new MouseEvent("click", { bubbles: true })));
}

async function choose(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function installNetworkTraps(): Readonly<{
  fetch: ReturnType<typeof vi.fn>;
  eventSource: ReturnType<typeof vi.fn>;
  webSocket: ReturnType<typeof vi.fn>;
  xmlHttpRequest: ReturnType<typeof vi.fn>;
}> {
  const fetch = vi.fn(() => { throw new Error("Chronicle QA attempted fetch"); });
  const eventSource = vi.fn(() => { throw new Error("Chronicle QA attempted EventSource"); });
  const webSocket = vi.fn(() => { throw new Error("Chronicle QA attempted WebSocket"); });
  const xmlHttpRequest = vi.fn(() => { throw new Error("Chronicle QA attempted XMLHttpRequest"); });
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("EventSource", eventSource);
  vi.stubGlobal("WebSocket", webSocket);
  vi.stubGlobal("XMLHttpRequest", xmlHttpRequest);
  return { fetch, eventSource, webSocket, xmlHttpRequest };
}

function productionCompositionSpies(turns?: CooperativeBrowserTurns): Readonly<{
  factories: ProductionComposition;
  observerShell: ReturnType<typeof vi.fn<typeof createObserverShellRuntime>>;
  liveSession: ReturnType<typeof vi.fn<typeof createProductionObserverSession>>;
  archiveSession: ReturnType<typeof vi.fn<typeof createProductionArchiveObserverSession>>;
  fixtureTransport: ReturnType<typeof vi.fn<typeof createFixtureTransport>>;
  checkpointFeed: ReturnType<typeof vi.fn<typeof createCheckpointFeed>>;
  replayClient: ReturnType<typeof vi.fn<typeof createReplayArtifactClient>>;
  replaySession: ReturnType<typeof vi.fn<typeof createReplaySession>>;
  c14Scenario: ReturnType<typeof vi.fn<typeof createC14ChronicleValidationScenario>>;
  c15Scenario: ReturnType<typeof vi.fn<typeof createC15ChronicleValidationScenario>>;
  checkpointHarnessReceipt: ReturnType<typeof vi.fn<(source: QaOfflineOwnerSource) => QaOfflineOwnerReceipt>>;
  liveBridgeReceipt: ReturnType<typeof vi.fn<(source: QaOfflineOwnerSource) => QaOfflineOwnerReceipt>>;
  observerRuntimes: InstrumentedObserverRuntime[];
  liveBundles: InstrumentedLiveBundle[];
  archiveBundles: InstrumentedArchiveBundle[];
  fixtureTransports: InstrumentedFixtureTransport[];
  checkpointFeeds: InstrumentedCheckpointFeed[];
  replayClients: InstrumentedReplayClient[];
  replaySessions: InstrumentedReplaySession[];
  replayArtifacts: ReceivedReplayArtifacts[];
  c14Scenarios: InstrumentedC14Scenario[];
  c15Scenarios: InstrumentedC15Scenario[];
  offlineCheckpointHarnesses: QaOfflineOwnerReceipt[];
  offlineLiveBridges: QaOfflineOwnerReceipt[];
  failedOfflineCheckpointSources: InstrumentedOfflineOwnerSource[];
  failedOfflineLiveSources: InstrumentedOfflineOwnerSource[];
  fixtureProducers: InstrumentedFixtureProducer[];
  liveBridgeClients: LiveApiClient[];
  liveClientGates: DeferredStreamEnvelopeGate[];
  checkpointHarnessReceipts: Array<Readonly<{
    scheduler: object | undefined;
    clients: CheckpointApiClient[];
  }>>;
  clockBoundary: TypedPresentationClockBoundary | null;
  rendererAtlasPool: SharedAtlasPool;
}> {
  const observerRuntimes: InstrumentedObserverRuntime[] = [];
  const liveBundles: InstrumentedLiveBundle[] = [];
  const archiveBundles: InstrumentedArchiveBundle[] = [];
  const fixtureTransports: InstrumentedFixtureTransport[] = [];
  const checkpointFeeds: InstrumentedCheckpointFeed[] = [];
  const replayClients: InstrumentedReplayClient[] = [];
  const replaySessions: InstrumentedReplaySession[] = [];
  const replayArtifacts: ReceivedReplayArtifacts[] = [];
  const c14Scenarios: InstrumentedC14Scenario[] = [];
  const c15Scenarios: InstrumentedC15Scenario[] = [];
  const offlineCheckpointHarnesses: QaOfflineOwnerReceipt[] = [];
  const offlineLiveBridges: QaOfflineOwnerReceipt[] = [];
  const failedOfflineCheckpointSources: InstrumentedOfflineOwnerSource[] = [];
  const failedOfflineLiveSources: InstrumentedOfflineOwnerSource[] = [];
  const fixtureProducers: InstrumentedFixtureProducer[] = [];
  const liveBridgeClients: LiveApiClient[] = [];
  const liveClientGates: DeferredStreamEnvelopeGate[] = [];
  const checkpointHarnessReceipts: Array<Readonly<{
    scheduler: object | undefined;
    clients: CheckpointApiClient[];
  }>> = [];
  const clockBoundary = turns === undefined ? null : new TypedPresentationClockBoundary(turns);
  const rendererAtlasPool = createSharedAtlasPool({
    // Must be the SAME composed manifest the production factory hands the renderer.
    // Defaulting to PRODUCTION_ASSET_MANIFEST (the base) meant atlas ids were chosen
    // from the composed manifest but resolved against the base one, so every exact
    // region (nirvana, nirvana_east, nirvana_west, warm_springs) rejected its terrain
    // atlas with `unknown-atlas` before the first frame could ever be accepted.
    manifest: PRODUCTION_SCENE_MANIFEST,
    decode: async (descriptor) => ({
      bitmap: {
        width: descriptor.width,
        height: descriptor.height,
        close: vi.fn(),
      } as unknown as ImageBitmap,
      compressedBytes: descriptor.compressedBytes,
    }),
  });
  const observerShell = vi.fn((...args: Parameters<typeof createObserverShellRuntime>) => {
    const raw = createObserverShellRuntime(...args);
    const qaIdentity = Symbol("exact-observer-runtime");
    const subscriptionDisposals: Array<ReturnType<typeof vi.fn<() => void>>> = [];
    const runtime: InstrumentedObserverRuntime = {
      ...raw,
      qaIdentity,
      subscriptionDisposals,
      subscribe: vi.fn((listener) => {
        const rawDispose = raw.subscribe(listener);
        const dispose = vi.fn(() => rawDispose());
        subscriptionDisposals.push(dispose);
        return dispose;
      }),
      diagnostics: vi.fn(() => {
        const value = raw.diagnostics();
        return value === null ? null : Object.freeze({ ...value, qaRuntimeOwner: qaIdentity });
      }),
      dispose: vi.fn(() => raw.dispose()),
    };
    observerRuntimes.push(runtime);
    return runtime;
  });
  const liveSession = vi.fn((...args: Parameters<typeof createProductionObserverSession>) => {
    const options = args[0] ?? {};
    const bridgeClient = options.clientFactory?.();
    const gate = new DeferredStreamEnvelopeGate();
    if (bridgeClient !== undefined) {
      liveBridgeClients.push(bridgeClient);
      liveClientGates.push(gate);
    }
    const observedClient = bridgeClient === undefined ? undefined : Object.freeze({
      getRun: () => bridgeClient.getRun(),
      getWorld: () => bridgeClient.getWorld(),
      getEvents: (cursor: number) => bridgeClient.getEvents(cursor),
      openEventStream: (
        cursor: number,
        handlers: Parameters<LiveApiClient["openEventStream"]>[1],
      ) => bridgeClient.openEventStream(cursor, {
        ...handlers,
        onEnvelope: gate.wrap(handlers.onEnvelope),
      }),
    } satisfies LiveApiClient);
    const raw = createProductionObserverSession({
      ...options,
      ...(observedClient === undefined ? {} : { clientFactory: () => observedClient }),
      ...(options.clockFactory === undefined || clockBoundary === null
        ? {}
        : { clockFactory: clockBoundary.wrapFactory(options.clockFactory) }),
    });
    const retryRecovery = vi.fn(raw.session.retryRecovery.bind(raw.session));
    Object.defineProperty(raw.session, "retryRecovery", {
      configurable: true,
      enumerable: false,
      value: retryRecovery,
      writable: false,
    });
    const bundle: InstrumentedLiveBundle = {
      ...raw,
      session: raw.session as InstrumentedLiveBundle["session"],
      getPlacementOwner: vi.fn(() => raw.getPlacementOwner()),
      getResources: vi.fn(() => raw.getResources()),
      getRunSeed: vi.fn((runId) => raw.getRunSeed(runId)),
      replaceRun: vi.fn((run, snapshot) => raw.replaceRun(run, snapshot)),
      dispose: vi.fn(() => raw.dispose()),
    };
    liveBundles.push(bundle);
    return bundle;
  });
  const archiveSession = vi.fn((...args: Parameters<typeof createProductionArchiveObserverSession>) => {
    const options = args[0];
    const raw = createProductionArchiveObserverSession({
      ...options,
      ...(options.clockFactory === undefined || clockBoundary === null
        ? {}
        : { clockFactory: clockBoundary.wrapFactory(options.clockFactory) }),
    });
    const bundle: InstrumentedArchiveBundle = {
      ...raw,
      getPlacementOwner: vi.fn(() => raw.getPlacementOwner()),
      getResources: vi.fn(() => raw.getResources()),
      dispose: vi.fn((options) => raw.dispose(options)),
    };
    archiveBundles.push(bundle);
    return bundle;
  });
  const fixtureTransport = vi.fn((...args: Parameters<typeof createFixtureTransport>) => {
    const callbacks = args[0];
    const envelopePayloads: EventEnvelope[] = [];
    const checkpointPayloads: Parameters<FixtureTransportCallbacks["onCheckpointAccepted"]>[0][] = [];
    fixtureProducers.push(Object.freeze({ callbacks, envelopePayloads, checkpointPayloads }));
    const raw = createFixtureTransport({
      ...callbacks,
      onEnvelopeAccepted: (envelope) => {
        envelopePayloads.push(envelope);
        callbacks.onEnvelopeAccepted(envelope);
      },
      onCheckpointAccepted: (record) => {
        checkpointPayloads.push(record);
        callbacks.onCheckpointAccepted(record);
      },
    });
    const transport: InstrumentedFixtureTransport = {
      start: vi.fn((manifest) => raw.start(manifest)),
      deliverThroughCursor: vi.fn((cursor) => raw.deliverThroughCursor(cursor)),
      deliverAll: vi.fn(() => raw.deliverAll()),
      replaceRun: vi.fn((manifest) => raw.replaceRun(manifest)),
      dispose: vi.fn(() => raw.dispose()),
    };
    fixtureTransports.push(transport);
    return transport;
  });
  const checkpointFeed = vi.fn((...args: Parameters<typeof createCheckpointFeed>) => {
    const options = args[0] ?? {};
    const clients: CheckpointApiClient[] = [];
    const receipt = Object.freeze({ scheduler: options.scheduler, clients });
    checkpointHarnessReceipts.push(receipt);
    const raw = createCheckpointFeed({
      ...options,
      ...(options.createClient === undefined ? {} : {
        createClient: (signal: AbortSignal): CheckpointApiClient => {
          const client = options.createClient!(signal);
          if (!clients.includes(client)) clients.push(client);
          return client;
        },
      }),
    });
    const qaIdentity = Symbol("exact-checkpoint-feed");
    const feed: InstrumentedCheckpointFeed = {
      qaIdentity,
      start: vi.fn((identity) => raw.start(identity)),
      subscribe: vi.fn((listener) => raw.subscribe(listener)),
      subscribeFault: vi.fn((listener) => raw.subscribeFault(listener)),
      reset: vi.fn((identity) => raw.reset(identity)),
      diagnostics: vi.fn(() => Object.freeze({
        ...raw.diagnostics(),
        qaReceipt: qaIdentity,
      })),
      dispose: vi.fn(() => raw.dispose()),
    };
    checkpointFeeds.push(feed);
    return feed;
  });
  const replayClient = vi.fn((...args: Parameters<typeof createReplayArtifactClient>) => {
    const raw = createReplayArtifactClient(...args);
    let disposed = false;
    const qaIdentity = Symbol("exact-replay-client");
    const receive = async (result: Promise<ReplayArtifacts>): Promise<ReceivedReplayArtifacts> => {
      const received = Object.freeze({
        ...await result,
        qaReceipt: Symbol("exact-replay-artifacts"),
      });
      replayArtifacts.push(received);
      return received;
    };
    const client: InstrumentedReplayClient = {
      qaIdentity,
      fetchArtifacts: vi.fn(() => receive(raw.fetchArtifacts())),
      fetchForRun: vi.fn((runId) => receive(raw.fetchForRun(runId))),
      fetchOlderArtifacts: vi.fn((artifacts) => receive(raw.fetchOlderArtifacts(artifacts))),
      reconcileSelector: vi.fn((previous, next, selector) => (
        raw.reconcileSelector(previous, next, selector)
      )),
      exportEvents: vi.fn(() => raw.exportEvents()),
      exportSnapshots: vi.fn(() => raw.exportSnapshots()),
      fetchEvents: vi.fn(() => raw.fetchEvents()),
      fetchSnapshots: vi.fn(() => raw.fetchSnapshots()),
      dispose: vi.fn(() => { disposed = true; }),
      diagnostics: () => Object.freeze({ disposed }),
    };
    replayClients.push(client);
    return client;
  });
  const replaySession = vi.fn(() => {
    const raw = createReplaySession();
    const session: InstrumentedReplaySession = {
      qaIdentity: Symbol("exact-replay-session"),
      getState: vi.fn(() => raw.getState()),
      getPresentationWindow: vi.fn(() => raw.getPresentationWindow()),
      restore: vi.fn((artifacts, selector) => raw.restore(artifacts, selector)),
      reset: vi.fn(() => raw.reset()),
      subscribe: vi.fn((listener) => raw.subscribe(listener)),
    };
    replaySessions.push(session);
    return session;
  });
  const c14Scenario = vi.fn((...args: Parameters<typeof createC14ChronicleValidationScenario>) => {
    const raw = createC14ChronicleValidationScenario(...args);
    const scenario: InstrumentedC14Scenario = {
      ...raw,
      dispose: vi.fn(() => raw.dispose()),
    };
    c14Scenarios.push(scenario);
    return scenario;
  });
  const c15Scenario = vi.fn((...args: Parameters<typeof createC15ChronicleValidationScenario>) => {
    const raw = createC15ChronicleValidationScenario(...args);
    const scenario: InstrumentedC15Scenario = {
      ...raw,
      dispose: vi.fn(() => raw.dispose()),
    };
    c15Scenarios.push(scenario);
    return scenario;
  });
  const makeOfflineReceipt = (
    source: QaOfflineOwnerSource,
    target: QaOfflineOwnerReceipt[],
  ): QaOfflineOwnerReceipt => {
    let disposed = false;
    const receipt: QaOfflineOwnerReceipt = {
      dispose: vi.fn(() => {
        source.dispose();
        disposed = true;
      }),
      diagnostics: () => Object.freeze({
        disposed,
        pendingTaskCount: source.pendingTaskCount(),
      }),
    };
    target.push(receipt);
    return receipt;
  };
  const checkpointHarnessReceipt = vi.fn((source: QaOfflineOwnerSource) => (
    makeOfflineReceipt(source, offlineCheckpointHarnesses)
  ));
  const liveBridgeReceipt = vi.fn((source: QaOfflineOwnerSource) => (
    makeOfflineReceipt(source, offlineLiveBridges)
  ));
  return {
    factories: {
      createObserverShellRuntime: observerShell,
      createProductionObserverSession: liveSession,
      createProductionArchiveObserverSession: archiveSession,
      createFixtureTransport: fixtureTransport,
      createCheckpointFeed: checkpointFeed,
      createReplayArtifactClient: replayClient,
      createReplaySession: replaySession,
      createC14ChronicleValidationScenario: c14Scenario,
      createC15ChronicleValidationScenario: c15Scenario,
      createOfflineCheckpointHarnessReceipt: checkpointHarnessReceipt,
      createOfflineLiveBridgeReceipt: liveBridgeReceipt,
      rendererAtlasPool,
      ...(turns === undefined ? {} : { rendererAtlasCommitScheduler: turns.atlasCommitScheduler }),
    },
    observerShell,
    liveSession,
    archiveSession,
    fixtureTransport,
    checkpointFeed,
    replayClient,
    replaySession,
    c14Scenario,
    c15Scenario,
    checkpointHarnessReceipt,
    liveBridgeReceipt,
    observerRuntimes,
    liveBundles,
    archiveBundles,
    fixtureTransports,
    checkpointFeeds,
    replayClients,
    replaySessions,
    replayArtifacts,
    c14Scenarios,
    c15Scenarios,
    offlineCheckpointHarnesses,
    offlineLiveBridges,
    failedOfflineCheckpointSources,
    failedOfflineLiveSources,
    fixtureProducers,
    liveBridgeClients,
    liveClientGates,
    checkpointHarnessReceipts,
    clockBoundary,
    rendererAtlasPool,
  };
}

type ProductionCompositionSpies = ReturnType<typeof productionCompositionSpies>;
type ConstructionFailureBoundary =
  | "checkpoint-harness-receipt"
  | "live-bridge-receipt"
  | "feed"
  | "live"
  | "replay"
  | "replay-session"
  | "runtime"
  | "transport"
  | "scenario-c14"
  | "scenario-c15";

function failCompositionFactory(
  composed: ProductionCompositionSpies,
  boundary: ConstructionFailureBoundary,
  failure: Error,
  failOnCall = 1,
): void {
  let calls = 0;
  const shouldFail = (): boolean => {
    calls += 1;
    return calls === failOnCall;
  };
  switch (boundary) {
    case "checkpoint-harness-receipt":
    case "live-bridge-receipt": {
      const factory = boundary === "checkpoint-harness-receipt"
        ? composed.checkpointHarnessReceipt
        : composed.liveBridgeReceipt;
      const target = boundary === "checkpoint-harness-receipt"
        ? composed.failedOfflineCheckpointSources
        : composed.failedOfflineLiveSources;
      factory.mockImplementation((source) => {
        const rawDispose = source.dispose.bind(source);
        const observed: InstrumentedOfflineOwnerSource = {
          dispose: vi.fn(() => rawDispose()),
          pendingTaskCount: () => source.pendingTaskCount(),
        };
        Object.defineProperty(source, "dispose", {
          configurable: true,
          value: observed.dispose,
        });
        target.push(observed);
        throw failure;
      });
      return;
    }
    case "feed": {
      const delegate = composed.checkpointFeed.getMockImplementation();
      if (delegate === undefined) throw new Error("checkpoint feed delegate is missing");
      composed.checkpointFeed.mockImplementation((...args) => {
        if (shouldFail()) throw failure;
        return delegate(...args);
      });
      return;
    }
    case "live": {
      const delegate = composed.liveSession.getMockImplementation();
      if (delegate === undefined) throw new Error("Live session delegate is missing");
      composed.liveSession.mockImplementation((...args) => {
        if (shouldFail()) throw failure;
        return delegate(...args);
      });
      return;
    }
    case "replay": {
      const delegate = composed.replayClient.getMockImplementation();
      if (delegate === undefined) throw new Error("replay client delegate is missing");
      composed.replayClient.mockImplementation((...args) => {
        if (shouldFail()) throw failure;
        return delegate(...args);
      });
      return;
    }
    case "replay-session": {
      const delegate = composed.replaySession.getMockImplementation();
      if (delegate === undefined) throw new Error("replay session delegate is missing");
      composed.replaySession.mockImplementation((...args) => {
        if (shouldFail()) throw failure;
        return delegate(...args);
      });
      return;
    }
    case "runtime": {
      const delegate = composed.observerShell.getMockImplementation();
      if (delegate === undefined) throw new Error("observer runtime delegate is missing");
      composed.observerShell.mockImplementation((...args) => {
        if (shouldFail()) throw failure;
        return delegate(...args);
      });
      return;
    }
    case "transport": {
      const delegate = composed.fixtureTransport.getMockImplementation();
      if (delegate === undefined) throw new Error("fixture transport delegate is missing");
      composed.fixtureTransport.mockImplementation((...args) => {
        if (shouldFail()) throw failure;
        return delegate(...args);
      });
      return;
    }
    case "scenario-c14": {
      const delegate = composed.c14Scenario.getMockImplementation();
      if (delegate === undefined) throw new Error("C14 scenario delegate is missing");
      composed.c14Scenario.mockImplementation((...args) => {
        if (shouldFail()) throw failure;
        return delegate(...args);
      });
      return;
    }
    case "scenario-c15": {
      const delegate = composed.c15Scenario.getMockImplementation();
      if (delegate === undefined) throw new Error("C15 scenario delegate is missing");
      composed.c15Scenario.mockImplementation((...args) => {
        if (shouldFail()) throw failure;
        return delegate(...args);
      });
    }
  }
}

function faultPlaybackBoundary(
  composed: ProductionCompositionSpies,
  boundary: "subscribe" | "get-snapshot",
  failure: Error,
): void {
  const delegate = composed.observerShell.getMockImplementation();
  if (delegate === undefined) throw new Error("observer runtime delegate is missing");
  composed.observerShell.mockImplementation((...args) => {
    const runtime = delegate(...args) as InstrumentedObserverRuntime;
    if (boundary === "subscribe") {
      const subscribe = runtime.subscribe.getMockImplementation();
      if (subscribe === undefined) throw new Error("observer subscribe delegate is missing");
      let calls = 0;
      runtime.subscribe.mockImplementation((listener) => {
        calls += 1;
        if (calls === 2) throw failure;
        return subscribe(listener);
      });
    } else {
      const rawGetSnapshot = runtime.getSnapshot.bind(runtime);
      let calls = 0;
      Object.defineProperty(runtime, "getSnapshot", {
        configurable: true,
        value: vi.fn(() => {
          calls += 1;
          if (calls === 1) throw failure;
          return rawGetSnapshot();
        }),
      });
    }
    return runtime;
  });
}

function delayFirstObserverReadiness(
  composed: ProductionCompositionSpies,
  ready: Promise<void>,
): void {
  const delegate = composed.observerShell.getMockImplementation();
  if (delegate === undefined) throw new Error("observer runtime delegate is missing");
  let calls = 0;
  composed.observerShell.mockImplementation((...args) => {
    const runtime = delegate(...args);
    calls += 1;
    if (calls === 1) {
      Object.defineProperty(runtime, "ready", {
        configurable: true,
        value: ready,
      });
    }
    return runtime;
  });
}

function captureCompositionCleanup(composed: ProductionCompositionSpies): Readonly<{
  order: readonly string[];
  duplicateDisposals: readonly string[];
}> {
  const calls: Array<Readonly<{
    label: string;
    index: number;
    invocationOrder: readonly number[];
  }>> = [];
  const append = (
    label: string,
    resources: readonly Readonly<{
      dispose: Readonly<{ mock: Readonly<{ invocationCallOrder: readonly number[] }> }>;
    }>[],
  ): void => {
    resources.forEach((resource, index) => {
      calls.push({
        label,
        index,
        invocationOrder: resource.dispose.mock.invocationCallOrder,
      });
    });
  };
  append("runtime", composed.observerRuntimes);
  append("live", composed.liveBundles);
  append("feed", composed.checkpointFeeds);
  append("replay", composed.replayClients);
  append("transport", composed.fixtureTransports);
  append("scenario", [...composed.c14Scenarios, ...composed.c15Scenarios]);
  append("harness", composed.failedOfflineCheckpointSources);
  append("bridge", composed.failedOfflineLiveSources);
  append("harness", composed.offlineCheckpointHarnesses);
  append("bridge", composed.offlineLiveBridges);
  return Object.freeze({
    order: Object.freeze(calls
      .filter(({ invocationOrder }) => invocationOrder.length > 0)
      .sort((left, right) => left.invocationOrder[0]! - right.invocationOrder[0]!)
      .map(({ label }) => label)),
    duplicateDisposals: Object.freeze(calls
      .filter(({ invocationOrder }) => invocationOrder.length > 1)
      .map(({ label, index, invocationOrder }) => `${label}:${index}:${invocationOrder.length}`)),
  });
}

function captureMockOrder(
  entries: readonly (readonly [
    label: string,
    mock: Readonly<{ mock: Readonly<{ invocationCallOrder: readonly number[] }> }> | undefined,
  ])[],
): readonly string[] {
  return Object.freeze(entries
    .filter((entry): entry is readonly [string, NonNullable<typeof entry[1]>] => (
      entry[1] !== undefined && entry[1].mock.invocationCallOrder.length > 0
    ))
    .sort((left, right) => (
      left[1].mock.invocationCallOrder[0]! - right[1].mock.invocationCallOrder[0]!
    ))
    .map(([label]) => label));
}

function expectReleasedGenerationAt(
  composed: ProductionCompositionSpies,
  index: number,
  hasTransport: boolean,
): void {
  expect.soft(composed.observerRuntimes[index]?.dispose).toHaveBeenCalledTimes(1);
  expect.soft(composed.liveBundles[index]?.dispose).toHaveBeenCalledTimes(1);
  expect.soft(composed.checkpointFeeds[index]?.dispose).toHaveBeenCalledTimes(1);
  expect.soft(composed.replayClients[index]?.dispose).toHaveBeenCalledTimes(1);
  if (hasTransport) expect.soft(composed.fixtureTransports[index]?.dispose).toHaveBeenCalledTimes(1);
}

function expectReleasedGenerationResources(
  composed: ProductionCompositionSpies,
  generationIndex: number,
  transportIndex: number | null,
): void {
  expect.soft(composed.observerRuntimes[generationIndex]?.dispose).toHaveBeenCalledTimes(1);
  expect.soft(composed.liveBundles[generationIndex]?.dispose).toHaveBeenCalledTimes(1);
  expect.soft(composed.checkpointFeeds[generationIndex]?.dispose).toHaveBeenCalledTimes(1);
  expect.soft(composed.replayClients[generationIndex]?.dispose).toHaveBeenCalledTimes(1);
  if (transportIndex !== null) {
    expect.soft(composed.fixtureTransports[transportIndex]?.dispose).toHaveBeenCalledTimes(1);
  }
  const subscriptions = composed.observerRuntimes[generationIndex]?.subscriptionDisposals ?? [];
  expect.soft(subscriptions.length).toBeGreaterThan(0);
  for (const dispose of subscriptions) expect.soft(dispose).toHaveBeenCalledTimes(1);
  const harness = composed.offlineCheckpointHarnesses[generationIndex];
  expect.soft(harness).toBeDefined();
  if (harness !== undefined) {
    expect.soft(harness.dispose).toHaveBeenCalledTimes(1);
    expect.soft(harness.diagnostics()).toMatchObject({ disposed: true, pendingTaskCount: 0 });
  }
  const bridge = composed.offlineLiveBridges[generationIndex];
  expect.soft(bridge).toBeDefined();
  if (bridge !== undefined) {
    expect.soft(bridge.dispose).toHaveBeenCalledTimes(1);
    expect.soft(bridge.diagnostics()).toMatchObject({ disposed: true, pendingTaskCount: 0 });
  }
}

function forceReleaseComposition(composed: ProductionCompositionSpies): void {
  const release = (callback: () => void): void => {
    try { callback(); } catch { /* best-effort test cleanup after frozen evidence */ }
  };
  for (const transport of composed.fixtureTransports) release(() => transport.dispose());
  for (const runtime of composed.observerRuntimes) release(() => runtime.dispose());
  for (const replay of composed.replayClients) release(() => replay.dispose());
  for (const live of composed.liveBundles) release(() => live.dispose());
  for (const feed of composed.checkpointFeeds) release(() => feed.dispose());
  for (const archive of composed.archiveBundles) release(() => archive.dispose());
  for (const scenario of composed.c14Scenarios) release(() => scenario.dispose());
  for (const scenario of composed.c15Scenarios) release(() => scenario.dispose());
  for (const harness of composed.failedOfflineCheckpointSources) release(() => harness.dispose());
  for (const bridge of composed.failedOfflineLiveSources) release(() => bridge.dispose());
  for (const harness of composed.offlineCheckpointHarnesses) release(() => harness.dispose());
  for (const bridge of composed.offlineLiveBridges) release(() => bridge.dispose());
  release(() => composed.rendererAtlasPool.dispose());
}

function expectExactAggregate(
  thrown: unknown,
  primary: Error,
  cleanupErrors: readonly Error[],
): void {
  expect.soft(thrown).toBeInstanceOf(AggregateError);
  if (!(thrown instanceof AggregateError)) return;
  expect.soft(thrown.errors).toEqual([primary, ...cleanupErrors]);
  expect.soft(thrown.cause).toBe(primary);
}

function installThrowingCleanup(
  composed: ProductionCompositionSpies,
  boundary: "runtime" | "replay",
  failure: Error,
): void {
  if (boundary === "runtime") {
    const delegate = composed.observerShell.getMockImplementation();
    if (delegate === undefined) throw new Error("observer runtime delegate is missing");
    composed.observerShell.mockImplementation((...args) => {
      const runtime = delegate(...args) as InstrumentedObserverRuntime;
      const rawDispose = runtime.dispose.getMockImplementation();
      if (rawDispose === undefined) throw new Error("observer runtime disposer is missing");
      runtime.dispose.mockImplementation(() => {
        rawDispose();
        throw failure;
      });
      return runtime;
    });
    return;
  }
  const delegate = composed.replayClient.getMockImplementation();
  if (delegate === undefined) throw new Error("replay client delegate is missing");
  composed.replayClient.mockImplementation((...args) => {
    const replay = delegate(...args) as InstrumentedReplayClient;
    const rawDispose = replay.dispose.getMockImplementation();
    if (rawDispose === undefined) throw new Error("replay client disposer is missing");
    replay.dispose.mockImplementation(() => {
      rawDispose();
      throw failure;
    });
    return replay;
  });
}

function expectNoLaterFactoryCalls(
  composed: ProductionCompositionSpies,
  boundary: ConstructionFailureBoundary,
): void {
  const order = [
    "live-bridge-receipt",
    "checkpoint-harness-receipt",
    "feed",
    "live",
    "replay",
    "replay-session",
    "runtime",
    "transport",
    "scenario-c14",
    "scenario-c15",
  ] as const;
  const selected = order.indexOf(boundary);
  const calls = {
    "checkpoint-harness-receipt": composed.checkpointHarnessReceipt.mock.calls.length,
    "live-bridge-receipt": composed.liveBridgeReceipt.mock.calls.length,
    feed: composed.checkpointFeed.mock.calls.length,
    live: composed.liveSession.mock.calls.length,
    replay: composed.replayClient.mock.calls.length,
    "replay-session": composed.replaySession.mock.calls.length,
    runtime: composed.observerShell.mock.calls.length,
    transport: composed.fixtureTransport.mock.calls.length,
    "scenario-c14": composed.c14Scenario.mock.calls.length,
    "scenario-c15": composed.c15Scenario.mock.calls.length,
  };
  for (let index = selected + 1; index < order.length; index += 1) {
    const later = order[index]!;
    expect.soft(calls[later], `${later} must not run after ${boundary}`).toBe(0);
  }
}

class ObservableValidationScheduler {
  private readonly tasks = new Set<Readonly<{ cancel: ReturnType<typeof vi.fn<() => void>> }>>();
  readonly port: ValidationScheduler = Object.freeze({
    schedule: (_delayMs: number, _callback: () => void): (() => void) => {
      let active = true;
      const task = Object.freeze({
        cancel: vi.fn(() => { active = false; }),
        active: () => active,
      });
      this.tasks.add(task);
      return () => task.cancel();
    },
  });
  get pendingTaskCount(): number {
    return [...this.tasks].filter((task) => (
      (task as typeof task & Readonly<{ active(): boolean }>).active()
    )).length;
  }
}

function installRendererBrowserHarness(): void {
  vi.stubGlobal("ResizeObserver", class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  });
  vi.stubGlobal("requestAnimationFrame", vi.fn(() => 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("Image", class {
    complete = true;
    naturalWidth = 1;
    naturalHeight = 1;
    src = "";
    decode(): Promise<void> { return Promise.resolve(); }
    addEventListener(): void {}
    removeEventListener(): void {}
  });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function getContext(
    this: HTMLCanvasElement,
    contextId: string,
  ): RenderingContext | null {
    if (contextId !== "2d") return null;
    const base: Record<PropertyKey, unknown> = {
      canvas: this,
      createPattern: () => ({}),
      // The Proxy below answers every unlisted member with `() => undefined`, so the
      // real production draw path `PixelSurface.toCanvas`
      // (`environment/bubbleGrammar.ts:399`) -- which writes overlay pixels through
      // `createImageData(...).data` -- threw `Cannot read properties of undefined
      // (reading 'data')` on every placed overlay, and `flushUntil` swallowed the
      // TypeError into `turnErrors` where nothing during the cue phase asserted on
      // it. A real 2D context always returns a sized buffer here, so the double must
      // too; `putImageData` stays a Proxy no-op because this harness asserts
      // scheduling and frame identity, never pixels.
      createImageData: (width: number, height: number) => ({
        data: new Uint8ClampedArray(Math.max(0, width) * Math.max(0, height) * 4),
        width,
        height,
        colorSpace: "srgb",
      }),
      getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
      measureText: (text: string) => ({ width: text.length * 8 }),
      imageSmoothingEnabled: false,
      globalAlpha: 1,
      globalCompositeOperation: "source-over",
      filter: "none",
    };
    return new Proxy(base, {
      get(target, property): unknown {
        if (property in target) return target[property];
        return () => undefined;
      },
      set(target, property, value): boolean {
        target[property] = value;
        return true;
      },
    }) as unknown as CanvasRenderingContext2D;
  });
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason?: unknown): void;
}

type BoundedPromiseOutcome<T> =
  | Readonly<{ status: "fulfilled"; value: T }>
  | Readonly<{ status: "rejected"; error: unknown }>
  | Readonly<{ status: "pending" }>;

async function observeWithinMicrotasks<T>(
  promise: Promise<T>,
  maximumHandoffs: number,
): Promise<BoundedPromiseOutcome<T>> {
  let outcome: BoundedPromiseOutcome<T> = Object.freeze({ status: "pending" as const });
  void promise.then(
    (value) => { outcome = Object.freeze({ status: "fulfilled" as const, value }); },
    (error: unknown) => { outcome = Object.freeze({ status: "rejected" as const, error }); },
  );
  for (let handoff = 0; handoff < maximumHandoffs && outcome.status === "pending"; handoff += 1) {
    await act(async () => Promise.resolve());
  }
  return outcome;
}

async function observeWithinMicrotasksWithoutAct<T>(
  promise: Promise<T>,
  maximumHandoffs: number,
): Promise<BoundedPromiseOutcome<T>> {
  let outcome: BoundedPromiseOutcome<T> = Object.freeze({ status: "pending" as const });
  void promise.then(
    (value) => { outcome = Object.freeze({ status: "fulfilled" as const, value }); },
    (error: unknown) => { outcome = Object.freeze({ status: "rejected" as const, error }); },
  );
  for (let handoff = 0; handoff < maximumHandoffs && outcome.status === "pending"; handoff += 1) {
    await Promise.resolve();
  }
  return outcome;
}

async function drainBoundedMicrotasks(maximumHandoffs: number): Promise<void> {
  for (let handoff = 0; handoff < maximumHandoffs; handoff += 1) {
    await act(async () => Promise.resolve());
  }
}

async function drainBoundedMicrotasksWithoutAct(maximumHandoffs: number): Promise<void> {
  for (let handoff = 0; handoff < maximumHandoffs; handoff += 1) await Promise.resolve();
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}
