import type { ChronicleManifest } from "../presentation/fixtures/chronicleCatalog";
import type { CompletedRecoveryReceipt } from "../presentation/PresentationSession";

export interface ScenarioEndpoint {
  readonly source: "live" | "archive";
  readonly runId: string;
  readonly sourceKey: string;
  readonly cursor: number;
  readonly ownerId: string;
}

export interface C14ScenarioPort {
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

export interface C15ScenarioFrame {
  readonly selected: ScenarioEndpoint;
  readonly live: ScenarioEndpoint & Readonly<{ source: "live" }>;
}

export interface C15ScenarioPort {
  primeLiveCursor(cursor: 2): Promise<C15ScenarioFrame>;
  enterArchiveAt(cursor: 2): Promise<C15ScenarioFrame>;
  advanceLiveWhileArchived(cursor: 4): Promise<C15ScenarioFrame>;
  returnToLive(): Promise<C15ScenarioFrame>;
}

/** Creates the typed C14 transport-recovery validation sequence. */
export function createC14ChronicleValidationScenario(input: Readonly<{
  manifest: ChronicleManifest;
  port: C14ScenarioPort;
}>): Readonly<{
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
}> {
  if (input.manifest.id !== "C14") throw new Error("C14 scenario requires Chronicle C14");
  let phase = 0;
  let disposed = false;
  let supersededGeneration: number | null = null;
  let selected: ScenarioEndpoint | null = null;
  let live: ScenarioEndpoint | null = null;
  let lastCompletedRecovery: CompletedRecoveryReceipt | null = null;
  const records: Array<Readonly<{ label: string; mechanicEventsFabricated: false }>> = [];
  const requirePhase = (expected: number, message: string): void => {
    if (disposed) throw new Error("C14 scenario is disposed");
    if (phase !== expected) throw new Error(`C14 scenario order requires ${message}`);
  };
  return {
    async recoverGapAndCheckpoint413(): Promise<void> {
      requirePhase(0, "cursor gap and 413 first");
      const result = await input.port.recoverGapAndCheckpoint413();
      if (
        result.presentedCursor !== 2
        || result.gap.firstCursor !== 1
        || result.gap.lastCursor !== 2
        || result.checkpointStatus !== 413
        || result.checkpointFaultCount !== 1
        || result.recoveryStatus !== "frozen-retry"
        || result.recoveryDigest.firstCursor !== 3
        || result.recoveryDigest.lastCursor !== 3
      ) throw new Error("C14 gap cursor or checkpoint 413 evidence drifted");
      records.push(record("cursor-gap"), record("oversized-record-413"));
      phase = 1;
    },
    async retryCheckpoint413ThenRecoverOverflow(): Promise<void> {
      requirePhase(1, "gap and 413 before retry and overflow");
      const result = await input.port.retryCheckpoint413ThenRecoverOverflow();
      if (
        result.checkpointRetryCount !== 1
        || result.checkpointRecoveredCursor !== 3
        || result.presentedCursor !== 4
        || result.overflow !== true
        || result.snapshotRequired !== true
        || result.lastCompletedRecovery.reason !== "queue-overflow"
        || result.lastCompletedRecovery.digest.skipped.firstCursor !== 4
        || result.lastCompletedRecovery.digest.skipped.lastCursor !== 4
        || result.lastCompletedRecovery.digest.majorMoments.length !== 0
        || result.lastCompletedRecovery.digest.compressedAmbientCount !== 1
        || result.lastCompletedRecovery.snappedCursor !== 4
      ) throw new Error("C14 checkpoint retry or overflow recovery evidence drifted");
      lastCompletedRecovery = result.lastCompletedRecovery;
      records.push(record("checkpoint-413-retry"), record("overflow-recovery"));
      phase = 2;
    },
    async replaceRun(): Promise<void> {
      requirePhase(2, "overflow before run replacement");
      const result = await input.port.replaceRun();
      if (
        result.previousRunId !== "mock-c14-v1"
        || result.replacementRunId !== "mock-c14-v1-replacement"
        || !Number.isSafeInteger(result.supersededGeneration)
        || result.supersededGeneration < 0
      ) throw new Error("C14 run replacement identity or generation drifted");
      supersededGeneration = result.supersededGeneration;
      records.push(record("run-replacement"));
      phase = 3;
    },
    async rejectStaleCallback(): Promise<void> {
      requirePhase(3, "run replacement before stale rejection");
      if (supersededGeneration === null) throw new Error("C14 superseded generation is missing");
      const result = await input.port.dispatchStaleCallback(supersededGeneration);
      validateC14StaleResult(result);
      selected = Object.freeze({ ...result.selected });
      live = Object.freeze({ ...result.live });
      records.push(record("stale-old-run-rejected"));
      phase = 4;
    },
    getSnapshot() {
      return Object.freeze({
        kind: "C14" as const,
        phase: ["initial", "gap-413", "overflow", "replacement", "complete"][phase]!,
        completed: phase === 4,
        records: Object.freeze([...records]),
        selected,
        live,
        lastCompletedRecovery,
      });
    },
    dispose(): void { disposed = true; },
  };
}

/** Creates the typed C15 isolated Live/Archive validation sequence. */
export function createC15ChronicleValidationScenario(input: Readonly<{
  manifest: ChronicleManifest;
  port: C15ScenarioPort;
}>): Readonly<{
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
}> {
  if (input.manifest.id !== "C15") throw new Error("C15 scenario requires Chronicle C15");
  let phase = 0;
  let disposed = false;
  let selected: ScenarioEndpoint | null = null;
  let live: ScenarioEndpoint | null = null;
  const requirePhase = (expected: number, message: string): void => {
    if (disposed) throw new Error("C15 scenario is disposed");
    if (phase !== expected) throw new Error(`C15 scenario order requires ${message}`);
  };
  const accept = (frame: C15ScenarioFrame, expected: Readonly<{
    selectedSource: "live" | "archive";
    selectedCursor: number;
    liveCursor: number;
  }>): void => {
    validateEndpoint(frame.selected);
    validateEndpoint(frame.live);
    if (
      frame.selected.source !== expected.selectedSource
      || frame.selected.cursor !== expected.selectedCursor
      || frame.live.source !== "live"
      || frame.live.cursor !== expected.liveCursor
      || frame.selected.runId !== "mock-c15-v1"
      || frame.live.runId !== "mock-c15-v1"
    ) throw new Error("C15 Live/Archive cursor or identity evidence drifted");
    if (expected.selectedSource === "archive" && frame.selected.ownerId === frame.live.ownerId) {
      throw new Error("C15 Archive and Live placement owner identity must remain isolated");
    }
    selected = Object.freeze({ ...frame.selected });
    live = Object.freeze({ ...frame.live });
  };
  return {
    async primeLiveCursor(): Promise<void> {
      requirePhase(0, "Live 2 first");
      accept(await input.port.primeLiveCursor(2), {
        selectedSource: "live", selectedCursor: 2, liveCursor: 2,
      });
      phase = 1;
    },
    async enterArchive(): Promise<void> {
      requirePhase(1, "prime Live 2 before Archive 2");
      accept(await input.port.enterArchiveAt(2), {
        selectedSource: "archive", selectedCursor: 2, liveCursor: 2,
      });
      phase = 2;
    },
    async advanceLiveWhileArchived(): Promise<void> {
      requirePhase(2, "Archive 2 before hidden Live 4");
      accept(await input.port.advanceLiveWhileArchived(4), {
        selectedSource: "archive", selectedCursor: 2, liveCursor: 4,
      });
      phase = 3;
    },
    async returnToLive(): Promise<void> {
      requirePhase(3, "hidden Live 4 before return");
      accept(await input.port.returnToLive(), {
        selectedSource: "live", selectedCursor: 4, liveCursor: 4,
      });
      phase = 4;
    },
    getSnapshot() {
      return Object.freeze({
        kind: "C15" as const,
        phase: ["initial", "live-2", "archive-2", "hidden-live-4", "complete"][phase]!,
        completed: phase === 4,
        selected,
        live,
      });
    },
    dispose(): void { disposed = true; },
  };
}

function record(label: string): Readonly<{ label: string; mechanicEventsFabricated: false }> {
  return Object.freeze({ label, mechanicEventsFabricated: false as const });
}

function validateC14StaleResult(result: Readonly<{
  accepted: false;
  selected: ScenarioEndpoint;
  live: ScenarioEndpoint & Readonly<{ source: "live" }>;
}>): void {
  if (result.accepted !== false) throw new Error("C14 stale callback must not be accepted");
  validateEndpoint(result.selected);
  validateEndpoint(result.live);
  const expected = {
    source: "live",
    runId: "mock-c14-v1-replacement",
    sourceKey: "live:mock-c14-v1-replacement",
    cursor: 0,
  } as const;
  for (const endpoint of [result.selected, result.live]) {
    if (
      endpoint.source !== expected.source
      || endpoint.runId !== expected.runId
      || endpoint.sourceKey !== expected.sourceKey
      || endpoint.cursor !== expected.cursor
    ) throw new Error("C14 stale selected/live identity drifted");
  }
  if (result.selected.ownerId !== result.live.ownerId) {
    throw new Error("C14 stale selected/live owner identity drifted");
  }
}

function validateEndpoint(endpoint: ScenarioEndpoint): void {
  if (
    (endpoint.source !== "live" && endpoint.source !== "archive")
    || endpoint.runId.trim() === ""
    || endpoint.sourceKey.trim() === ""
    || !Number.isSafeInteger(endpoint.cursor)
    || endpoint.cursor < 0
    || endpoint.ownerId.trim() === ""
  ) throw new Error("Scenario endpoint identity is invalid");
}
