export interface CaptureCommitObservation {
  readonly reactCommitCount: number;
  readonly acceptedPublicState: string;
}

export interface EventMarkerExpectation {
  readonly marker: string;
  readonly cursor: number;
  readonly eventType: string;
  readonly movement: Readonly<{
    actorId: string;
    fromRegion: string;
    toRegion: string;
  }> | null;
}

export interface MarkerBoundaryObservation {
  readonly phase: string | null;
  readonly consequenceCommitted: boolean;
  readonly frameIdentity: Readonly<{ firstCursor: number; lastCursor: number }> | null;
  readonly cameraMode: string;
  readonly focusSelectionKey: string | null;
  readonly actors: readonly Readonly<{ id: string; safeFrameVisible: boolean }>[];
}

export interface PresentationTerminalEndpoint {
  readonly source: "live";
  readonly runId: string;
  readonly sourceKey: string;
  readonly cursor: number;
}

export interface ObservedPresentationState {
  readonly runId: string;
  readonly sourceKey: string;
  readonly ingestedCursor: number;
  readonly presentedCursor: number;
  readonly canvasLastCursor: number;
  readonly activeSceneCount: number;
  readonly pendingMoments: number;
}

export interface CaptureRenderedActorState {
  readonly activeAction: string | null;
  readonly reposition: Readonly<Record<string, unknown>> | null;
}

export interface CaptureSettlementReadiness {
  readonly minimumFrameCountReached: boolean;
  readonly terminalReached: boolean;
  readonly expectedMarkersReached: boolean;
  readonly checkpointHoldActive: boolean;
  readonly actors: readonly CaptureRenderedActorState[];
}

export interface C03ResourceTransferWitnessObservation {
  readonly senderId: string;
  readonly receiverId: string;
  readonly resourceType: string;
  readonly amount: number;
  readonly phase: string | null;
  readonly focusSelectionKey: string | null;
  readonly dialogue: Readonly<{
    speakerId: string;
    speakerName: string;
    text: string;
    hold: boolean;
  }> | null;
  readonly dialogueNow: Readonly<{
    speakerName: string;
    targetName: string | null;
    direction: "→" | null;
    text: string;
    bounds: Readonly<{ x: number; y: number; width: number; height: number }>;
  }> | null;
  readonly viewport: Readonly<{ width: number; height: number }>;
  readonly actors: readonly Readonly<{ id: string; safeFrameVisible: boolean }>[];
  /** Maximum simultaneously owned canvas effects across the captured Chronicle. */
  readonly maximumActiveEffects: number;
  readonly transferFrames: readonly Readonly<{
    frameIndex: number;
    phase: string;
    sender: Readonly<{
      id: string;
      position: Readonly<{ x: number; y: number }>;
      activeAction: string | null;
      safeFrameVisible: boolean;
    }>;
    receiver: Readonly<{
      id: string;
      position: Readonly<{ x: number; y: number }>;
      activeAction: string | null;
      safeFrameVisible: boolean;
    }>;
  }>[];
  readonly readingHoldMs: number;
}

export interface C03ResourceTransferWitnessEvidence {
  readonly senderId: "wanderer_001";
  readonly senderName: "Joe";
  readonly receiverId: "wanderer_002";
  readonly receiverName: "Mae";
  readonly resourceType: "materials";
  readonly amount: 1;
  readonly direction: "→";
  readonly text: "Joe gave 1 material to Mae.";
  readonly focusSelectionKey: "agent:wanderer_001";
  readonly senderSafeFrameVisible: true;
  readonly maximumActiveEffects: 0;
  readonly transferFrameCount: number;
  readonly senderPosition: Readonly<{ x: 1936; y: 176 }>;
  readonly receiverPosition: Readonly<{ x: 304; y: 112 }>;
  readonly readingHoldMs: number;
  readonly dialogueBounds: Readonly<{
    x: number;
    y: number;
    width: number;
    height: number;
  }>;
}

const C03_TRANSFER = Object.freeze({
  senderId: "wanderer_001",
  senderName: "Joe",
  receiverId: "wanderer_002",
  receiverName: "Mae",
  resourceType: "materials",
  amount: 1,
  senderPosition: Object.freeze({ x: 1_936, y: 176 }),
  receiverPosition: Object.freeze({ x: 304, y: 112 }),
  direction: "→",
  text: "Joe gave 1 material to Mae.",
  focusSelectionKey: "agent:wanderer_001",
} as const);
const C03_PHASES = ["enter", "hold", "consequence", "recover", "exit"] as const;

/** Certify the exact C03 transfer marker as one DOM story with no canvas duplicate. */
export function assertC03ResourceTransferWitness(
  observation: C03ResourceTransferWitnessObservation,
): C03ResourceTransferWitnessEvidence {
  const sender = observation.actors.find((actor) => (
    isRecord(actor) && actor.id === C03_TRANSFER.senderId
  ));
  const dialogue = observation.dialogue;
  const panel = observation.dialogueNow;
  const bounds = isRecord(panel) && isExactBounds(panel.bounds) ? panel.bounds : undefined;
  const transferFramesExact = exactC03TransferFrames(observation.transferFrames);
  const panelInsideViewport = bounds !== undefined
    && isExactViewport(observation.viewport)
    && bounds.x >= 0
    && bounds.y >= 0
    && bounds.x + bounds.width <= observation.viewport.width
    && bounds.y + bounds.height <= observation.viewport.height;
  const exact = observation.senderId === C03_TRANSFER.senderId
    && observation.receiverId === C03_TRANSFER.receiverId
    && observation.resourceType === C03_TRANSFER.resourceType
    && observation.amount === C03_TRANSFER.amount
    && observation.phase === "consequence"
    && observation.focusSelectionKey === C03_TRANSFER.focusSelectionKey
    && isRecord(dialogue)
    && dialogue.speakerId === C03_TRANSFER.senderId
    && dialogue.speakerName === C03_TRANSFER.senderName
    && dialogue.text === C03_TRANSFER.text
    && dialogue.hold === true
    && isRecord(panel)
    && panel.speakerName === C03_TRANSFER.senderName
    && panel.targetName === C03_TRANSFER.receiverName
    && panel.direction === C03_TRANSFER.direction
    && panel.text === C03_TRANSFER.text
    && sender !== undefined
    && sender.safeFrameVisible === true
    && isNonNegativeSafeInteger(observation.maximumActiveEffects)
    && observation.maximumActiveEffects === 0
    && transferFramesExact
    && typeof observation.readingHoldMs === "number"
    && Number.isFinite(observation.readingHoldMs)
    && observation.readingHoldMs >= 750
    && panelInsideViewport;
  if (!exact || bounds === undefined) {
    throw new Error("C03 resource-transfer witness must be exact, readable, camera-safe, and transient-free");
  }
  return Object.freeze({
    ...C03_TRANSFER,
    senderSafeFrameVisible: true,
    maximumActiveEffects: 0,
    transferFrameCount: observation.transferFrames.length,
    readingHoldMs: observation.readingHoldMs,
    dialogueBounds: Object.freeze({ ...bounds }),
  });
}

function exactC03TransferFrames(
  frames: C03ResourceTransferWitnessObservation["transferFrames"],
): boolean {
  if (!Array.isArray(frames) || frames.length < C03_PHASES.length) return false;
  let phaseIndex = 0;
  let previousFrameIndex: number | null = null;
  for (const candidate of frames) {
    if (!isRecord(candidate)
      || !isNonNegativeSafeInteger(candidate.frameIndex)
      || (previousFrameIndex !== null && candidate.frameIndex !== previousFrameIndex + 1)
      || typeof candidate.phase !== "string") return false;
    if (candidate.phase !== C03_PHASES[phaseIndex]) {
      if (phaseIndex >= C03_PHASES.length - 1
        || candidate.phase !== C03_PHASES[phaseIndex + 1]) return false;
      phaseIndex += 1;
    }
    if (!exactC03Endpoint(
      candidate.sender,
      C03_TRANSFER.senderId,
      C03_TRANSFER.senderPosition,
      true,
    ) || !exactC03Endpoint(
      candidate.receiver,
      C03_TRANSFER.receiverId,
      C03_TRANSFER.receiverPosition,
      false,
    )) return false;
    previousFrameIndex = candidate.frameIndex;
  }
  return phaseIndex === C03_PHASES.length - 1;
}

function exactC03Endpoint(
  endpoint: unknown,
  expectedId: string,
  expectedPosition: Readonly<{ x: number; y: number }>,
  requireSafeFrame: boolean,
): boolean {
  if (!isRecord(endpoint)
    || typeof endpoint.id !== "string"
    || endpoint.id !== expectedId
    || !isRecord(endpoint.position)
    || typeof endpoint.position.x !== "number"
    || typeof endpoint.position.y !== "number"
    || !Number.isFinite(endpoint.position.x)
    || !Number.isFinite(endpoint.position.y)
    || endpoint.position.x !== expectedPosition.x
    || endpoint.position.y !== expectedPosition.y
    || !isExactAction(endpoint.activeAction)
    || forbiddenFarTransferAction(endpoint.activeAction)) return false;
  return !requireSafeFrame || endpoint.safeFrameVisible === true;
}

function isExactAction(action: unknown): action is string | null {
  return action === null || typeof action === "string";
}

function forbiddenFarTransferAction(action: string | null): boolean {
  return action !== null && /move|reposition|reach|walk|run|teleport/i.test(action);
}

function isExactBounds(value: unknown): value is Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}> {
  return isRecord(value)
    && typeof value.x === "number"
    && typeof value.y === "number"
    && typeof value.width === "number"
    && typeof value.height === "number"
    && [value.x, value.y, value.width, value.height].every(Number.isFinite)
    && value.width > 0
    && value.height > 0;
}

function isExactViewport(value: unknown): value is Readonly<{ width: number; height: number }> {
  return isRecord(value)
    && typeof value.width === "number"
    && typeof value.height === "number"
    && Number.isFinite(value.width)
    && Number.isFinite(value.height)
    && value.width > 0
    && value.height > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Retains measured observer cursors without substituting mechanic authority. */
export function observedCursorAuthority(
  observation: ObservedPresentationState,
): Readonly<{
  acceptedCursor: number;
  presentedCursor: number;
  publicCursor: number;
  motionCursor: number;
}> {
  return Object.freeze({
    acceptedCursor: observation.ingestedCursor,
    presentedCursor: observation.presentedCursor,
    publicCursor: observation.presentedCursor,
    motionCursor: observation.presentedCursor,
  });
}

/** Requires exact visible Live identity, cursor, Canvas acceptance, and settled queues. */
export function presentationTerminalReached(
  terminal: PresentationTerminalEndpoint,
  observation: ObservedPresentationState,
): boolean {
  return terminal.source === "live"
    && observation.runId === terminal.runId
    && observation.sourceKey === terminal.sourceKey
    && observation.ingestedCursor === terminal.cursor
    && observation.presentedCursor === terminal.cursor
    && observation.canvasLastCursor === terminal.cursor
    && observation.activeSceneCount === 0
    && observation.pendingMoments === 0;
}

/** Keeps capture evidence open until rendered route and fallback motion has settled. */
export function captureReadyToSettle(readiness: CaptureSettlementReadiness): boolean {
  return readiness.minimumFrameCountReached
    && readiness.terminalReached
    && readiness.expectedMarkersReached
    && !readiness.checkpointHoldActive
    && readiness.actors.every((actor) => (
      actor.reposition === null
      && actor.activeAction !== "moving"
      && actor.activeAction !== "orienting"
    ));
}

/** Extract exact marker cursor and movement subject truth from Chronicle event entries. */
export function buildEventMarkerExpectations(
  entries: readonly unknown[],
  declaredMarkers?: readonly string[],
): ReadonlyMap<string, EventMarkerExpectation> {
  const eventTypeCounts = new Map<string, number>();
  for (const value of entries) {
    if (!isRecord(value) || !Number.isSafeInteger(value.cursor) || !isRecord(value.event)
      || typeof value.event.type !== "string" || value.event.type.trim().length === 0) continue;
    eventTypeCounts.set(value.event.type, (eventTypeCounts.get(value.event.type) ?? 0) + 1);
  }
  const occurrenceQualifiedTypes = declaredMarkers === undefined
    ? new Set([...eventTypeCounts].filter(([, count]) => count > 1).map(([eventType]) => eventType))
    : new Set(declaredMarkers.flatMap((marker) => {
        const match = /^event:([^@]+)@cursor:\d+$/.exec(marker);
        return match?.[1] === undefined ? [] : [match[1]];
      }));
  const result = new Map<string, EventMarkerExpectation>();
  for (const value of entries) {
    if (!isRecord(value) || !Number.isSafeInteger(value.cursor) || !isRecord(value.event)
      || typeof value.event.type !== "string" || value.event.type.trim().length === 0) continue;
    const marker = eventTypeCounts.get(value.event.type) === 1
      || !occurrenceQualifiedTypes.has(value.event.type)
      ? `event:${value.event.type}`
      : `event:${value.event.type}@cursor:${value.cursor}`;
    if (result.has(marker)) continue;
    const payload = isRecord(value.event.payload) ? value.event.payload : null;
    const movementEvent = value.event.type === "agent_left_region"
      || value.event.type === "agent_entered_region";
    const movement = movementEvent ? movementExpectation(payload) : null;
    if (movementEvent && movement === null) continue;
    result.set(marker, Object.freeze({
      marker,
      cursor: value.cursor as number,
      eventType: value.event.type,
      movement,
    }));
  }
  return result;
}

/** Decide an event marker only from committed scene state and its exact payload subject. */
export function eventMarkerBoundaryReached(
  expectation: EventMarkerExpectation,
  observation: MarkerBoundaryObservation,
): boolean {
  const identity = observation.frameIdentity;
  if (observation.phase !== "consequence" || observation.consequenceCommitted !== true
    || identity === null || identity.firstCursor > expectation.cursor
    || identity.lastCursor < expectation.cursor) return false;
  if (expectation.movement === null) return true;
  const actorId = expectation.movement.actorId;
  return observation.cameraMode === "story"
    && observation.focusSelectionKey === `agent:${actorId}`
    && observation.actors.some((actor) => (
      actor.id === actorId && actor.safeFrameVisible === true
    ));
}

function movementExpectation(
  payload: Readonly<Record<string, unknown>> | null,
): EventMarkerExpectation["movement"] {
  if (payload === null || typeof payload.agent_id !== "string"
    || typeof payload.from_region !== "string" || typeof payload.to_region !== "string"
    || payload.agent_id.trim().length === 0 || payload.from_region.trim().length === 0
    || payload.to_region.trim().length === 0) return null;
  return Object.freeze({
    actorId: payload.agent_id,
    fromRegion: payload.from_region,
    toRegion: payload.to_region,
  });
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Counts React work only when an isolated Canvas probe leaves accepted/public bytes unchanged. */
export function frameDrivenCommitDelta(
  before: CaptureCommitObservation,
  after: CaptureCommitObservation,
): number {
  if (before.acceptedPublicState !== after.acceptedPublicState) return 0;
  return Math.max(0, after.reactCommitCount - before.reactCommitCount);
}

/** Fails capture immediately when byte-identical isolated Canvas ticks commit React work. */
export function assertNoFrameDrivenReactCommits(
  before: CaptureCommitObservation,
  after: CaptureCommitObservation,
): number {
  const delta = frameDrivenCommitDelta(before, after);
  if (delta !== 0) throw new Error("frame-driven React commits are forbidden");
  return delta;
}

/** Return the exact expected marker set in captured frame chronology. */
export function orderCapturedMarkerIds(
  expectedMarkers: readonly string[],
  markerFrames: ReadonlyMap<string, number>,
): readonly string[] {
  const expectedSet = new Set(expectedMarkers);
  if (expectedSet.size !== expectedMarkers.length) {
    throw new Error("expected capture marker IDs must be unique");
  }
  if (markerFrames.size !== expectedMarkers.length
      || [...markerFrames.keys()].some((marker) => !expectedSet.has(marker))) {
    throw new Error("captured markers must bind the exact expected set");
  }
  for (const marker of expectedMarkers) {
    const frameIndex = markerFrames.get(marker);
    if (!Number.isInteger(frameIndex) || frameIndex! < 0) {
      throw new Error(`captured marker ${marker} frame must be a non-negative integer`);
    }
  }
  const declarationIndex = new Map(expectedMarkers.map((marker, index) => [marker, index]));
  return Object.freeze([...expectedMarkers].sort((left, right) => (
    markerFrames.get(left)! - markerFrames.get(right)!
      || declarationIndex.get(left)! - declarationIndex.get(right)!
  )));
}
