import type { AssetLease } from "../assets/atlasStore";
import type { SpriteClip, SpriteFrame, SpriteLayerManifest, SpriteManifest } from "../assets/spriteManifest";
import { validateSpriteManifest } from "../assets/spriteManifest";
import type { Direction4, Vec2 } from "../contracts";
import { deriveActorAppearance, type ActorAppearance } from "./actorAppearance";

export type LocomotionState = "idle" | "turn" | "walk" | "stop" | "prone" | "dead";
export type ActionState = "none" | "speak" | "work" | "reach" | "hurt";
export type FaceState = "neutral" | "blink" | "talk" | "weary" | "hurt";

export interface ActorChannels {
  locomotion: LocomotionState;
  action: ActionState;
  face: FaceState;
  facing: Direction4;
  heldObject: string | null;
  selected: boolean;
}

export type ActorCommand =
  | { readonly type: "moveTo"; readonly payload: { readonly waypoints: readonly Vec2[]; readonly speedPixelsPerSecond: number } }
  | { readonly type: "face"; readonly payload: { readonly direction: Direction4 } }
  | { readonly type: "action"; readonly payload: { readonly action: ActionState; readonly clipId: string } }
  | { readonly type: "status"; readonly payload: { readonly locomotion: LocomotionState; readonly face?: FaceState } }
  | { readonly type: "selection"; readonly payload: { readonly selected: boolean } };

export interface ActorLayerSnapshot {
  readonly clipId: string;
  readonly frameIndex: number;
  readonly sourceRect: Readonly<SpriteFrame["rect"]>;
}

export interface ActorSnapshot {
  readonly id: string;
  readonly instanceId: number;
  readonly name: string;
  readonly position: Vec2;
  readonly facing: Direction4;
  readonly channels: Readonly<ActorChannels>;
  readonly frameIndex: number;
  readonly distanceTravelled: number;
  readonly stridePhase: number;
  readonly appearance: ActorAppearance;
  readonly layers: Readonly<{
    body: ActorLayerSnapshot;
    face: ActorLayerSnapshot;
    held: ActorLayerSnapshot;
  }>;
}

export type ActorSignal = {
  readonly type: "arrived";
  readonly actorId: string;
  readonly position: Vec2;
};

export interface HumanAtlasLeases {
  readonly body: AssetLease<ImageBitmap>;
  readonly face: AssetLease<ImageBitmap>;
  readonly held: AssetLease<ImageBitmap>;
}

export interface HumanActorOptions {
  readonly id: string;
  readonly name: string;
  readonly position: Vec2;
  readonly facing?: Direction4;
  readonly selected?: boolean;
  readonly manifest: SpriteManifest;
  readonly atlasLeases?: HumanAtlasLeases;
  readonly blinkSeed?: number;
}

export interface HumanActorPort {
  apply(command: ActorCommand): void;
  update(deltaSeconds: number, nowMs: number): void;
  draw(context: CanvasRenderingContext2D, snapshot?: ActorSnapshot): void;
  snapshot(): ActorSnapshot;
  drainSignals(): readonly ActorSignal[];
  nextDeadlineMs(): number | null;
  dispose(): void;
}

const TURN_DURATION_SECONDS = 0.12;
const STOP_DURATION_SECONDS = 0.12;
const PRONE_FRAME_MS = 420;
const BLINK_FRAME_MS = 90;
const BLINK_DURATION_MS = BLINK_FRAME_MS * 3;
const MIN_BLINK_INTERVAL_MS = 3_000;
const BLINK_INTERVAL_SPAN_MS = 4_001;
const EPSILON = 1e-9;
let nextInstanceId = 1;

interface MutableChannels {
  locomotion: LocomotionState;
  action: ActionState;
  facing: Direction4;
  heldObject: string | null;
  selected: boolean;
}

interface LayerSet {
  readonly body: SpriteLayerManifest;
  readonly face: SpriteLayerManifest;
  readonly held: SpriteLayerManifest;
}

const DIRECTIONS: readonly Direction4[] = ["north", "east", "south", "west"];
const FACE_DIRECTIONS: readonly Direction4[] = ["south", "west", "north", "east"];
const LOCOMOTION_STATES: readonly LocomotionState[] = ["idle", "turn", "walk", "stop", "prone", "dead"];
const ACTION_STATES: readonly ActionState[] = ["none", "speak", "work", "reach", "hurt"];
const FACE_STATES: readonly FaceState[] = ["neutral", "blink", "talk", "weary", "hurt"];
const REQUIRED_FACE_EXPRESSIONS = ["neutral", "blink_1", "blink_2", "talk_1", "talk_2", "weary", "hurt"] as const;
const REQUIRED_HELD_CLIPS = ["empty", "basket", "work", "reach"] as const;
const DIRECTIONAL_FRAME_COUNTS = { idle: 4, walk: 6, turn: 2, stop: 2 } as const;
const DIRECTIONAL_SOURCE_ROWS: Readonly<Record<Direction4, number>> = { south: 0, west: 1, north: 2, east: 3 };
const DIRECTIONAL_SOURCE_COLUMNS = {
  idle: [0, 1, 2, 3], walk: [4, 5, 6, 7, 8, 9], turn: [10, 11], stop: [12, 13],
} as const;

function requireLayer(manifest: SpriteManifest, id: SpriteLayerManifest["id"]): SpriteLayerManifest {
  const layer = manifest.layers.find((candidate) => candidate.id === id);
  if (!layer) throw new Error(`Human manifest is missing its ${id} layer.`);
  return layer;
}

function requireClip(layer: SpriteLayerManifest, id: string): SpriteClip {
  const clip = layer.clips[id];
  if (!clip) throw new Error(`Human ${layer.id} layer is missing clip ${id}.`);
  return clip;
}

function requireBoundClip(
  layer: SpriteLayerManifest,
  key: string,
  direction: Direction4 | "none",
  row: number,
  columns: readonly number[],
): SpriteClip {
  const clip = requireClip(layer, key);
  if (clip.id !== key) throw new Error(`Human ${layer.id}/${key} clip id must exactly match its manifest key.`);
  if (clip.direction !== direction) throw new Error(`Human ${layer.id}/${key} direction must be ${direction}.`);
  if (clip.frames.length !== columns.length) {
    throw new Error(`Human ${layer.id}/${key} clip requires exactly ${columns.length} frames.`);
  }
  clip.frames.forEach((frame, index) => {
    if (frame.rect.x !== columns[index]! * 48 || frame.rect.y !== row * 64) {
      throw new Error(`Human ${layer.id}/${key} source binding must use its authoritative atlas cells.`);
    }
  });
  return clip;
}

function validateRequiredActorClips(layers: LayerSet): void {
  for (const direction of DIRECTIONS) {
    for (const [state, count] of Object.entries(DIRECTIONAL_FRAME_COUNTS)) {
      const clipId = `${state}_${direction}`;
      const clip = requireClip(layers.body, clipId);
      if (clip.frames.length !== count) throw new Error(`Human body/${clipId} clip requires exactly ${count} frames.`);
    }
  }
  for (const direction of DIRECTIONS) {
    for (const [state, count] of Object.entries(DIRECTIONAL_FRAME_COUNTS)) {
      const clipId = `${state}_${direction}`;
      const columns = DIRECTIONAL_SOURCE_COLUMNS[state as keyof typeof DIRECTIONAL_SOURCE_COLUMNS];
      const clip = requireBoundClip(layers.body, clipId, direction, DIRECTIONAL_SOURCE_ROWS[direction], columns);
      if (clip.frames.length !== count) throw new Error(`Human body/${clipId} clip requires exactly ${count} frames.`);
    }
  }
  requireBoundClip(layers.body, "reach", "none", 4, [0, 1, 2, 3]);
  const rawFall = requireClip(layers.body, "fall");
  if (rawFall.frames.length < 2) throw new Error("Human body/fall clip requires at least two terminal prone frames.");
  const fall = requireBoundClip(layers.body, "fall", "none", 5, [0, 1, 2, 3]);
  if (fall.frames.length < 2) throw new Error("Human body/fall clip requires at least two terminal prone frames.");
  for (const [row, direction] of FACE_DIRECTIONS.entries()) for (const [column, expression] of REQUIRED_FACE_EXPRESSIONS.entries()) {
    const clipId = `${expression}_${direction}`;
    requireBoundClip(layers.face, clipId, direction, row, [column]);
  }
  const heldBindings = { empty: [0], basket: [1], work: [4, 5], reach: [6] } as const;
  for (const clipId of REQUIRED_HELD_CLIPS) {
    requireBoundClip(layers.held, clipId, "none", 0, heldBindings[clipId]);
  }
}

function finitePoint(point: Vec2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function validateCommand(command: ActorCommand, layers: LayerSet): void {
  const candidate: unknown = command;
  if (!isRecord(candidate) || typeof candidate.type !== "string" || !isRecord(candidate.payload)) {
    throw new TypeError("Actor command requires a known type and object payload.");
  }
  const payload = candidate.payload;
  if (candidate.type === "moveTo") {
    if (!Array.isArray(payload.waypoints) || !payload.waypoints.every((point: unknown) => isRecord(point)
      && typeof point.x === "number" && typeof point.y === "number" && finitePoint(point as unknown as Vec2))) {
      throw new TypeError("Movement waypoints must be finite points.");
    }
    if (typeof payload.speedPixelsPerSecond !== "number" || !Number.isFinite(payload.speedPixelsPerSecond)
      || payload.speedPixelsPerSecond <= 0) {
      throw new RangeError("Movement speed must be positive and finite.");
    }
    return;
  }
  if (candidate.type === "face") {
    if (!DIRECTIONS.includes(payload.direction as Direction4)) throw new TypeError("Face direction is invalid.");
    return;
  }
  if (candidate.type === "status") {
    if (!LOCOMOTION_STATES.includes(payload.locomotion as LocomotionState)) throw new TypeError("Status locomotion is invalid.");
    if (payload.face !== undefined && !FACE_STATES.includes(payload.face as FaceState)) throw new TypeError("Status face is invalid.");
    return;
  }
  if (candidate.type === "selection") {
    if (typeof payload.selected !== "boolean") throw new TypeError("Actor selection must be a boolean.");
    return;
  }
  if (candidate.type === "action") {
    if (!ACTION_STATES.includes(payload.action as ActionState)) throw new TypeError("Actor action is invalid.");
    if (typeof payload.clipId !== "string") throw new TypeError("Actor action clip id is invalid.");
    if (payload.action === "speak") {
      if (payload.clipId !== "talk") throw new Error("Speak action requires the talk face clip.");
      return;
    }
    if (payload.action === "hurt") {
      if (payload.clipId !== "fall") throw new Error("Hurt action requires the fall body clip.");
      return;
    }
    if ((payload.action === "work" || payload.action === "reach") && payload.clipId !== payload.action) {
      throw new Error(`${payload.action} action requires the matching ${payload.action} held clip.`);
    }
    requireClip(layers.held, payload.clipId);
    return;
  }
  throw new TypeError(`Unknown actor command type: ${candidate.type}`);
}

function copyPoint(point: Vec2): Vec2 {
  return { x: point.x, y: point.y };
}

function directionFor(from: Vec2, to: Vec2, fallback: Direction4): Direction4 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) <= EPSILON && Math.abs(dy) <= EPSILON) return fallback;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "east" : "west";
  return dy >= 0 ? "south" : "north";
}

function frameAtElapsed(clip: SpriteClip, elapsedMs: number, loop = clip.loop): number {
  const total = clip.frames.reduce((sum, frame) => sum + frame.durationMs, 0);
  if (total <= 0) return 0;
  let cursor = loop ? ((elapsedMs % total) + total) % total : Math.min(Math.max(0, elapsedMs), total - 1);
  for (let index = 0; index < clip.frames.length; index += 1) {
    cursor -= clip.frames[index]!.durationMs;
    if (cursor < 0) return index;
  }
  return clip.frames.length - 1;
}

function millisecondsUntilNextLoopFrame(clip: SpriteClip, elapsedMs: number): number {
  const total = clip.frames.reduce((sum, frame) => sum + frame.durationMs, 0);
  let cursor = ((elapsedMs % total) + total) % total;
  for (const frame of clip.frames) {
    if (cursor < frame.durationMs) return frame.durationMs - cursor;
    cursor -= frame.durationMs;
  }
  return clip.frames[0]!.durationMs;
}

function nextNonLoopFrameOffsetMs(clip: SpriteClip, elapsedMs: number): number | null {
  let boundaryMs = 0;
  for (let index = 0; index < clip.frames.length - 1; index += 1) {
    boundaryMs += clip.frames[index]!.durationMs;
    if (boundaryMs > elapsedMs) return boundaryMs;
  }
  return null;
}

function layerSnapshot(clip: SpriteClip, frameIndex: number): ActorLayerSnapshot {
  const safeIndex = Math.max(0, Math.min(frameIndex, clip.frames.length - 1));
  const frame = clip.frames[safeIndex]!;
  return {
    clipId: clip.id,
    frameIndex: safeIndex,
    sourceRect: { ...frame.rect },
  };
}

function createRandom(seed: number): () => number {
  let state = seed >>> 0 || 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function hashForBlink(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/** Creates one persistent layered human scene actor. */
export function createHumanActor(options: HumanActorOptions): HumanActorPort {
  const manifestErrors = validateSpriteManifest(options.manifest);
  if (manifestErrors.length > 0) throw new Error(`Invalid human manifest: ${manifestErrors.join("; ")}`);
  if (!finitePoint(options.position)) throw new TypeError("Human position must be finite.");
  const layers: LayerSet = {
    body: requireLayer(options.manifest, "body"),
    face: requireLayer(options.manifest, "face"),
    held: requireLayer(options.manifest, "held"),
  };
  validateRequiredActorClips(layers);
  const instanceId = nextInstanceId;
  nextInstanceId += 1;
  const appearance = deriveActorAppearance(options.id);
  const position = { ...options.position };
  const channels: MutableChannels = {
    locomotion: "idle",
    action: "none",
    facing: options.facing ?? "south",
    heldObject: null,
    selected: options.selected ?? false,
  };
  const random = createRandom(hashForBlink(options.id) ^ (options.blinkSeed ?? 0));
  const signals: ActorSignal[] = [];
  let route: Vec2[] = [];
  let routeIndex = 0;
  let speedPixelsPerSecond = 0;
  let distanceTravelled = 0;
  let stridePhase = 0;
  let turnRemainingSeconds = 0;
  let stopRemainingSeconds = 0;
  let lastNowMs = 0;
  let actionStartedAtMs = 0;
  let heldStartedAtMs = 0;
  let heldWorkActive = false;
  let baseFace: FaceState = "neutral";
  let faceStartedAtMs = 0;
  let frozenIdleFrameIndex: number | null = null;
  let nextBlinkMs = MIN_BLINK_INTERVAL_MS + Math.floor(random() * BLINK_INTERVAL_SPAN_MS);
  let disposed = false;
  let terminalDead = false;

  const scheduleBlinkAfter = (afterMs: number): void => {
    nextBlinkMs = afterMs + MIN_BLINK_INTERVAL_MS + Math.floor(random() * BLINK_INTERVAL_SPAN_MS);
  };

  const discardReachedWaypoints = (): void => {
    while (routeIndex < route.length) {
      const target = route[routeIndex]!;
      if (Math.hypot(target.x - position.x, target.y - position.y) > EPSILON) return;
      routeIndex += 1;
    }
  };

  const prepareSegment = (): boolean => {
    discardReachedWaypoints();
    if (routeIndex >= route.length) return false;
    const desired = directionFor(position, route[routeIndex]!, channels.facing);
    if (desired !== channels.facing) {
      channels.facing = desired;
      channels.locomotion = "turn";
      turnRemainingSeconds = TURN_DURATION_SECONDS;
    } else {
      channels.locomotion = "walk";
    }
    return true;
  };

  const finishRoute = (): void => {
    route = [];
    routeIndex = 0;
    speedPixelsPerSecond = 0;
    channels.locomotion = "stop";
    stopRemainingSeconds = STOP_DURATION_SECONDS;
    signals.push({ type: "arrived", actorId: options.id, position: copyPoint(position) });
  };

  const advanceWalk = (availableSeconds: number): number => {
    let remainingSeconds = availableSeconds;
    while (remainingSeconds > EPSILON && routeIndex < route.length) {
      const target = route[routeIndex]!;
      const dx = target.x - position.x;
      const dy = target.y - position.y;
      const segmentDistance = Math.hypot(dx, dy);
      if (segmentDistance <= EPSILON) {
        routeIndex += 1;
        continue;
      }
      const availableDistance = speedPixelsPerSecond * remainingSeconds;
      const actualDistance = Math.min(availableDistance, segmentDistance);
      position.x += (dx / segmentDistance) * actualDistance;
      position.y += (dy / segmentDistance) * actualDistance;
      if (actualDistance >= segmentDistance - EPSILON) {
        position.x = target.x;
        position.y = target.y;
      }
      distanceTravelled += actualDistance;
      const walkClip = requireClip(layers.body, `walk_${channels.facing}`);
      stridePhase += actualDistance / (walkClip.strideLength ?? 1);
      remainingSeconds = Math.max(0, remainingSeconds - actualDistance / speedPixelsPerSecond);
      if (actualDistance < segmentDistance - EPSILON) return 0;

      routeIndex += 1;
      discardReachedWaypoints();
      if (routeIndex >= route.length) {
        finishRoute();
        return remainingSeconds;
      }
      const desired = directionFor(position, route[routeIndex]!, channels.facing);
      if (desired !== channels.facing) {
        channels.facing = desired;
        channels.locomotion = "turn";
        turnRemainingSeconds = TURN_DURATION_SECONDS;
        return remainingSeconds;
      }
    }
    if (routeIndex >= route.length && channels.locomotion === "walk") finishRoute();
    return remainingSeconds;
  };

  const visibleFace = (): { readonly state: FaceState; readonly clipId: string } => {
    if (channels.action === "speak") {
      const talkFrame = Math.floor(Math.max(0, lastNowMs - actionStartedAtMs) / 180) % 2;
      return { state: "talk", clipId: talkFrame === 0 ? "talk_1" : "talk_2" };
    }
    if (channels.action === "hurt") return { state: "hurt", clipId: "hurt" };
    if (baseFace === "talk") {
      const talkFrame = Math.floor(Math.max(0, lastNowMs - faceStartedAtMs) / 180) % 2;
      return { state: "talk", clipId: talkFrame === 0 ? "talk_1" : "talk_2" };
    }
    if (baseFace === "blink") {
      const blinkFrame = Math.floor(Math.max(0, lastNowMs - faceStartedAtMs) / BLINK_FRAME_MS) % 3;
      return { state: "blink", clipId: blinkFrame === 1 ? "blink_2" : "blink_1" };
    }
    if (!terminalDead && channels.action === "none" && baseFace === "neutral"
      && lastNowMs >= nextBlinkMs && lastNowMs < nextBlinkMs + BLINK_DURATION_MS) {
      const blinkFrame = Math.floor((lastNowMs - nextBlinkMs) / BLINK_FRAME_MS);
      return { state: "blink", clipId: blinkFrame === 1 ? "blink_2" : "blink_1" };
    }
    return { state: baseFace, clipId: baseFace };
  };

  const idleBodyAnimationActive = (): boolean => channels.locomotion === "idle"
    && channels.action !== "reach" && channels.action !== "hurt"
    && baseFace !== "weary" && baseFace !== "hurt";

  const bodyLayer = (): ActorLayerSnapshot => {
    if (channels.locomotion === "dead") {
      const clip = requireClip(layers.body, "fall");
      return layerSnapshot(clip, clip.frames.length - 1);
    }
    if (channels.locomotion === "prone") {
      const clip = requireClip(layers.body, "fall");
      const firstBreathFrame = Math.max(0, clip.frames.length - 2);
      return layerSnapshot(clip, firstBreathFrame + (Math.floor(lastNowMs / PRONE_FRAME_MS) % 2));
    }
    if (channels.action === "reach") {
      const clip = requireClip(layers.body, "reach");
      return layerSnapshot(clip, frameAtElapsed(clip, lastNowMs - actionStartedAtMs));
    }
    if (channels.action === "hurt") {
      const clip = requireClip(layers.body, "fall");
      return layerSnapshot(clip, frameAtElapsed(clip, lastNowMs - actionStartedAtMs));
    }
    if (channels.locomotion === "turn") {
      const clip = requireClip(layers.body, `turn_${channels.facing}`);
      const elapsedMs = (TURN_DURATION_SECONDS - turnRemainingSeconds) * 1_000;
      return layerSnapshot(clip, frameAtElapsed(clip, elapsedMs, false));
    }
    if (channels.locomotion === "stop") {
      const clip = requireClip(layers.body, `stop_${channels.facing}`);
      const elapsedMs = (STOP_DURATION_SECONDS - stopRemainingSeconds) * 1_000;
      return layerSnapshot(clip, frameAtElapsed(clip, elapsedMs, false));
    }
    if (channels.locomotion === "walk") {
      const clip = requireClip(layers.body, `walk_${channels.facing}`);
      const index = Math.floor(stridePhase * clip.frames.length) % clip.frames.length;
      return layerSnapshot(clip, index);
    }
    const clip = requireClip(layers.body, `idle_${channels.facing}`);
    const frameIndex = idleBodyAnimationActive()
      ? frameAtElapsed(clip, lastNowMs, true)
      : frozenIdleFrameIndex ?? 0;
    return layerSnapshot(clip, frameIndex);
  };

  const faceLayer = (body: ActorLayerSnapshot): ActorLayerSnapshot => {
    const face = visibleFace();
    const bodyDirection = requireClip(layers.body, body.clipId).direction;
    const direction = bodyDirection === "none" ? "south" : bodyDirection;
    return layerSnapshot(requireClip(layers.face, `${face.clipId}_${direction}`), 0);
  };

  const heldLayer = (): ActorLayerSnapshot => {
    const clipId = channels.heldObject ?? "empty";
    const clip = requireClip(layers.held, clipId);
    const elapsed = Math.max(0, lastNowMs - heldStartedAtMs);
    return layerSnapshot(clip, heldWorkActive && clipId === "work" ? frameAtElapsed(clip, elapsed, true) : 0);
  };

  const snapshot = (): ActorSnapshot => {
    const body = bodyLayer();
    const face = faceLayer(body);
    const held = heldLayer();
    const faceState = visibleFace().state;
    return {
      id: options.id,
      instanceId,
      name: options.name,
      position: copyPoint(position),
      facing: channels.facing,
      channels: {
        locomotion: channels.locomotion,
        action: channels.action,
        face: faceState,
        facing: channels.facing,
        heldObject: channels.heldObject,
        selected: channels.selected,
      },
      frameIndex: body.frameIndex,
      distanceTravelled,
      stridePhase,
      appearance,
      layers: { body, face, held },
    };
  };

  return {
    apply(command) {
      if (disposed) return;
      const selectionCommand = isRecord(command) && command.type === "selection";
      if (terminalDead && !selectionCommand) return;
      validateCommand(command, layers);
      if (command.type === "selection") {
        channels.selected = command.payload.selected;
        return;
      }
      if (command.type === "moveTo") {
        route = command.payload.waypoints.map(copyPoint);
        routeIndex = 0;
        speedPixelsPerSecond = command.payload.speedPixelsPerSecond;
        stopRemainingSeconds = 0;
        if (!prepareSegment()) finishRoute();
        return;
      }
      if (command.type === "face") {
        if (command.payload.direction !== channels.facing) {
          channels.facing = command.payload.direction;
          channels.locomotion = "turn";
          turnRemainingSeconds = TURN_DURATION_SECONDS;
        }
        return;
      }
      if (command.type === "action") {
        channels.action = command.payload.action;
        actionStartedAtMs = lastNowMs;
        if (command.payload.action === "work") {
          channels.heldObject = command.payload.clipId;
          heldStartedAtMs = lastNowMs;
          heldWorkActive = true;
        } else if (command.payload.action === "reach") {
          channels.heldObject = command.payload.clipId;
          heldWorkActive = false;
        } else if (command.payload.action === "none") {
          channels.heldObject = command.payload.clipId === "empty" ? null : command.payload.clipId;
          heldWorkActive = false;
        } else if (command.payload.action === "hurt") {
          heldWorkActive = false;
        }
        return;
      }

      channels.locomotion = command.payload.locomotion;
      if (command.payload.face) {
        if (command.payload.locomotion === "idle" && (command.payload.face === "weary" || command.payload.face === "hurt")) {
          frozenIdleFrameIndex = frameAtElapsed(requireClip(layers.body, `idle_${channels.facing}`), lastNowMs, true);
        } else {
          frozenIdleFrameIndex = null;
        }
        baseFace = command.payload.face;
        faceStartedAtMs = lastNowMs;
      }
      if (command.payload.locomotion === "dead") {
        baseFace = "hurt";
        faceStartedAtMs = lastNowMs;
        terminalDead = true;
        route = [];
        routeIndex = 0;
        speedPixelsPerSecond = 0;
        channels.action = "none";
        channels.heldObject = null;
        heldWorkActive = false;
      } else if (command.payload.locomotion === "prone") {
        route = [];
        routeIndex = 0;
        speedPixelsPerSecond = 0;
        channels.action = "none";
        actionStartedAtMs = lastNowMs;
        channels.heldObject = null;
        heldWorkActive = false;
        heldStartedAtMs = lastNowMs;
      } else if (command.payload.locomotion === "turn") {
        turnRemainingSeconds = TURN_DURATION_SECONDS;
      } else if (command.payload.locomotion === "stop") {
        stopRemainingSeconds = STOP_DURATION_SECONDS;
      }
    },

    update(deltaSeconds, nowMs) {
      if (disposed) return;
      if (!Number.isFinite(nowMs) || !Number.isFinite(deltaSeconds) || deltaSeconds < 0) return;
      lastNowMs = nowMs;
      if (baseFace === "blink" && lastNowMs - faceStartedAtMs >= BLINK_DURATION_MS) {
        baseFace = "neutral";
        faceStartedAtMs = lastNowMs;
        scheduleBlinkAfter(lastNowMs);
      }
      if (!terminalDead) {
        while (lastNowMs >= nextBlinkMs + BLINK_DURATION_MS) scheduleBlinkAfter(nextBlinkMs + BLINK_DURATION_MS);
      }
      if (terminalDead || channels.locomotion === "prone") return;
      let remainingSeconds = deltaSeconds;
      const transitionLimit = Math.max(8, route.length * 2 + 8);
      for (let transitions = 0; transitions < transitionLimit; transitions += 1) {
        if (channels.locomotion === "turn") {
          if (remainingSeconds + EPSILON < turnRemainingSeconds) {
            turnRemainingSeconds -= remainingSeconds;
            return;
          }
          remainingSeconds = Math.max(0, remainingSeconds - turnRemainingSeconds);
          turnRemainingSeconds = 0;
          channels.locomotion = routeIndex < route.length ? "walk" : "idle";
          if (remainingSeconds <= EPSILON) return;
          continue;
        }
        if (channels.locomotion === "stop") {
          if (remainingSeconds + EPSILON < stopRemainingSeconds) {
            stopRemainingSeconds -= remainingSeconds;
            return;
          }
          remainingSeconds = Math.max(0, remainingSeconds - stopRemainingSeconds);
          stopRemainingSeconds = 0;
          channels.locomotion = "idle";
          return;
        }
        if (channels.locomotion !== "walk" || remainingSeconds <= EPSILON) return;
        remainingSeconds = advanceWalk(remainingSeconds);
        if (remainingSeconds <= EPSILON || channels.locomotion === "walk") return;
      }
      throw new Error("Human actor exceeded its bounded transition budget.");
    },

    draw(context, suppliedSnapshot) {
      if (disposed || !options.atlasLeases) return;
      const current = suppliedSnapshot ?? snapshot();
      const bodyClip = requireClip(layers.body, current.layers.body.clipId);
      const feet = bodyClip.frames[current.layers.body.frameIndex]!.feet;
      const destinationX = Math.round(position.x - feet.x);
      const destinationY = Math.round(position.y - feet.y);
      context.imageSmoothingEnabled = false;
      for (const [lease, layer] of [
        [options.atlasLeases.body, current.layers.body],
        [options.atlasLeases.face, current.layers.face],
        [options.atlasLeases.held, current.layers.held],
      ] as const) {
        const source = layer.sourceRect;
        context.drawImage(
          lease.value,
          source.x,
          source.y,
          source.width,
          source.height,
          destinationX,
          destinationY,
          options.manifest.logicalWidth,
          options.manifest.logicalHeight,
        );
      }
    },

    snapshot,

    drainSignals() {
      if (signals.length === 0) return [];
      return signals.splice(0, signals.length);
    },

    nextDeadlineMs() {
      if (disposed || terminalDead) return null;
      const candidates: number[] = [];
      const add = (deadline: number | null): void => {
        if (deadline !== null && Number.isFinite(deadline) && deadline > lastNowMs) candidates.push(deadline);
      };

      if (channels.locomotion === "prone") {
        add((Math.floor(lastNowMs / PRONE_FRAME_MS) + 1) * PRONE_FRAME_MS);
      } else if (channels.action === "reach" || channels.action === "hurt") {
        const clip = requireClip(layers.body, channels.action === "reach" ? "reach" : "fall");
        const elapsed = Math.max(0, lastNowMs - actionStartedAtMs);
        const offset = nextNonLoopFrameOffsetMs(clip, elapsed);
        add(offset === null ? null : actionStartedAtMs + offset);
      } else if (channels.locomotion === "turn") {
        const clip = requireClip(layers.body, `turn_${channels.facing}`);
        const elapsed = (TURN_DURATION_SECONDS - turnRemainingSeconds) * 1_000;
        const offset = nextNonLoopFrameOffsetMs(clip, elapsed);
        add(offset === null ? null : lastNowMs + (offset - elapsed));
        add(lastNowMs + turnRemainingSeconds * 1_000);
      } else if (channels.locomotion === "stop") {
        const clip = requireClip(layers.body, `stop_${channels.facing}`);
        const elapsed = (STOP_DURATION_SECONDS - stopRemainingSeconds) * 1_000;
        const offset = nextNonLoopFrameOffsetMs(clip, elapsed);
        add(offset === null ? null : lastNowMs + (offset - elapsed));
        add(lastNowMs + stopRemainingSeconds * 1_000);
      } else if (idleBodyAnimationActive()) {
        const clip = requireClip(layers.body, `idle_${channels.facing}`);
        add(lastNowMs + millisecondsUntilNextLoopFrame(clip, lastNowMs));
      }

      if (heldWorkActive) {
        const clip = requireClip(layers.held, "work");
        const elapsed = Math.max(0, lastNowMs - heldStartedAtMs);
        add(lastNowMs + millisecondsUntilNextLoopFrame(clip, elapsed));
      }

      if (channels.action === "speak") {
        const elapsed = Math.max(0, lastNowMs - actionStartedAtMs);
        add(actionStartedAtMs + (Math.floor(elapsed / 180) + 1) * 180);
      } else if (channels.action !== "hurt") {
        if (baseFace === "talk") {
          const elapsed = Math.max(0, lastNowMs - faceStartedAtMs);
          add(faceStartedAtMs + (Math.floor(elapsed / 180) + 1) * 180);
        } else if (baseFace === "blink") {
          const elapsed = Math.max(0, lastNowMs - faceStartedAtMs);
          const boundary = faceStartedAtMs + Math.min(
            BLINK_DURATION_MS,
            (Math.floor(elapsed / BLINK_FRAME_MS) + 1) * BLINK_FRAME_MS,
          );
          add(boundary);
        } else if (baseFace === "neutral" && channels.action === "none") {
          if (lastNowMs >= nextBlinkMs && lastNowMs < nextBlinkMs + BLINK_DURATION_MS) {
            const nextBlinkFrame = Math.floor((lastNowMs - nextBlinkMs) / BLINK_FRAME_MS) + 1;
            add(nextBlinkMs + nextBlinkFrame * BLINK_FRAME_MS);
          } else {
            add(nextBlinkMs);
          }
        }
      }

      return candidates.length === 0 ? null : Math.min(...candidates);
    },

    dispose() {
      if (disposed) return;
      disposed = true;
      options.atlasLeases?.body.release();
      options.atlasLeases?.face.release();
      options.atlasLeases?.held.release();
      route = [];
      signals.length = 0;
    },
  };
}
