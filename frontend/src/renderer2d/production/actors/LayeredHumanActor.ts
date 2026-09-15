import type { Direction4, Vec2 } from "../../contracts";
import {
  PRODUCTION_DIRECTIONAL_FACE_ANCHORS,
  PRODUCTION_FACINGS,
  requireHumanClip,
  resolveClipFacing,
  type HumanBodyAction,
  type HumanExpression,
  type HumanLayerId,
  type NativeFrameRef,
  type ProductionAssetLease,
  type ProductionAssetManifest,
  type ProductionClip,
  type ProductionFacing,
  type ProductionMarkerName,
} from "../assets/productionManifest";
import {
  CLOTHING_PALETTES,
  CLOTHING_SILHOUETTES,
  HAIR_RAMPS,
  HAIR_SILHOUETTES,
  PERSONA_ACCENTS,
  RIGS,
  SKIN_RAMPS,
  deriveHumanAppearance,
  type HumanAppearance,
} from "./appearance";
import { decideAssetFallback } from "../failurePolicy";
import type { AuthoritativeMotionSample, ProductionHumanActor } from "./ProductionHumanActor";

/**
 * `HumanBodyAction` minus the locomotion/orientation-internal states, plus
 * `kneel`/`gather` — two chibi-atlas-only poses (`SpriteSheetHumanActor`'s
 * `pose-kneel`/`pose-crouch`) with no measured frames in this legacy rig's
 * packed 344-cell body atlas. This actor is superseded in production by
 * `SpriteSheetHumanActor` (see that file's header) but still degrades both
 * gracefully — see `legacyBodyAction` below — instead of widening the
 * packed anchor table, which would require new measured art.
 */
type PlayableBodyAction = Exclude<HumanBodyAction, "idle" | "walk" | "run" | "turn" | "stop">
  | "kneel"
  | "gather";
type HumanStatus = "alive" | "paralyzed" | "dead";
/**
 * Why a being was moved rather than walked.
 *
 * `distance-cut` is the deliberate one (`choreography/locomotionGate.ts`): the
 * destination was too far for a walk to read as anything but trudging, so the
 * being is placed where it acted. `conversation-flash` is the other deliberate
 * one (`presentation/conversationStaging.ts`): a being addressed from across
 * the region arrives at conversational distance at once, and — being the one
 * reason authored purely to be *watched* — it is performed with the same
 * fade-out/fade-in vanish-and-appear a `fallback` uses, so it reads as a
 * deliberate flash step rather than a dropped frame. The remaining two are
 * concessions — a motion preference, and a route that could not be planned.
 */
export type HumanRepositionReason =
  | "reduced-motion"
  | "fallback"
  | "region-transition"
  | "distance-cut"
  | "conversation-flash";

export type HumanPrimitiveCommand =
  | Readonly<{
    kind: "move";
    waypoints: readonly Vec2[];
    speedPixelsPerSecond: number;
    gait: "walk" | "run";
  }>
  | Readonly<{ kind: "orient"; facing: Direction4 }>
  | Readonly<{ kind: "play-body"; action: PlayableBodyAction }>
  /** End a transient body pose without changing locomotion or lifecycle status. */
  | Readonly<{ kind: "clear-body" }>
  | Readonly<{ kind: "set-face"; expression: HumanExpression }>
  | Readonly<{ kind: "set-held"; heldId: string | null }>
  | Readonly<{ kind: "set-status"; status: HumanStatus }>
  | Readonly<{ kind: "recover" }>
  | Readonly<{ kind: "reposition"; position: Vec2; reason: HumanRepositionReason }>
  | Readonly<{ kind: "set-offset"; offset: Vec2 }>
  | Readonly<{ kind: "set-selected"; selected: boolean }>;

export interface LayeredHumanActorOptions {
  readonly id: string;
  readonly name: string;
  readonly persona?: string;
  readonly appearance?: HumanAppearance;
  readonly paletteMode?: "derived" | "authored";
  readonly position: Vec2;
  readonly facing?: Direction4;
  readonly manifest: ProductionAssetManifest;
  readonly atlasLeases: ReadonlyMap<string, ProductionAssetLease>;
  readonly reducedMotion?: boolean;
}

export interface LayeredHumanLayerSnapshot {
  readonly clipId: string;
  readonly frameIndex: number;
  readonly facing: ProductionFacing;
  readonly fallback: boolean;
}

export interface LayeredHumanSnapshot {
  readonly id: string;
  readonly instanceId: number;
  readonly position: Vec2;
  readonly facing: ProductionFacing;
  readonly appearance: HumanAppearance;
  readonly distanceTravelled: number;
  readonly stridePhase: number;
  readonly terminal: boolean;
  /** True while a validated route still owns future locomotion, independent of visible semantics. */
  readonly routeActive: boolean;
  /** Composite opacity shared by every visible layer and marker primitive. */
  readonly opacity: number;
  /** Active presentation-only fallback relocation, if one is crossing its hidden midpoint. */
  readonly reposition: Readonly<{
    readonly phase: "fade-out" | "fade-in";
    readonly reason: "fallback";
    readonly target: Vec2;
  }> | null;
  readonly activeAction: HumanSemanticAction;
  readonly artFallback: "person-marker" | null;
  readonly layers: Readonly<Record<HumanLayerId, LayeredHumanLayerSnapshot>>;
}

export type HumanSemanticAction =
  | "moving"
  | "orienting"
  | "speaking"
  | "reaching"
  | "working"
  | "hurt"
  | "prone"
  | "recovering"
  | "dead"
  | "kneeling"
  | "gathering"
  | null;

export type ProductionActorSignal =
  | Readonly<{
    kind: "marker";
    actorId: string;
    marker: ProductionMarkerName | "recovery-contact";
    action: HumanBodyAction;
    frameIndex: number;
  }>
  | Readonly<{ kind: "arrived"; actorId: string; position: Vec2 }>
  | Readonly<{
    kind: "repositioned";
    actorId: string;
    position: Vec2;
    reason: HumanRepositionReason;
  }>;

interface ResolvedLayer {
  readonly snapshot: LayeredHumanLayerSnapshot;
  readonly atlasId: string;
  readonly frame: NativeFrameRef | undefined;
  readonly visible: boolean;
}

interface MutablePoint {
  x: number;
  y: number;
}

interface ActiveFallbackReposition {
  phase: "fade-out" | "fade-in";
  /** One of {@link FADED_REPOSITION_REASONS} — the reason reported on the `repositioned` signal. */
  readonly reason: HumanRepositionReason;
  readonly originPosition: MutablePoint;
  readonly originOffset: MutablePoint;
  readonly target: MutablePoint;
  elapsedMs: number;
  /** See `SpriteSheetHumanActor.ts`'s identical field: holds at zero opacity instead of auto-advancing to "fade-in" when set. Backs `beginPresenceVanish`/`beginPresenceReveal`. */
  readonly sustained: boolean;
}

const LAYER_ORDER = ["body", "clothing", "face", "hair", "held", "status"] as const;
const EPSILON = 1e-9;
const BLINK_FRAME_MS = 90;
const BLINK_DURATION_MS = BLINK_FRAME_MS * 3;
const MIN_BLINK_INTERVAL_MS = 3_000;
const BLINK_INTERVAL_SPAN_MS = 4_001;
const MAX_TRANSIENT_OFFSET_PX = 8;
const FALLBACK_FADE_PHASE_MS = 180;
const FALLBACK_FADE_FRAME_MS = 1_000 / 60;
const REPOSITION_REASONS = new Set<HumanRepositionReason>([
  "reduced-motion",
  "fallback",
  "region-transition",
  "distance-cut",
  "conversation-flash",
]);
/** The reasons performed as a vanish-and-appear fade rather than an instant placement. */
const FADED_REPOSITION_REASONS = new Set<HumanRepositionReason>([
  "fallback",
  "conversation-flash",
]);
/** A backend route owns no local waypoint queue, but still needs regular redraws. */
const AUTHORITATIVE_MOTION_DEADLINE_MS = 1_000 / 60;
const SKIN_FILTERS: Readonly<Record<HumanAppearance["skinRamp"], string>> = Object.freeze({
  porcelain: "sepia(0.08) saturate(0.72) brightness(1.12)",
  warm: "sepia(0.18) saturate(0.92) brightness(1.04)",
  tan: "sepia(0.28) saturate(1.08) brightness(0.96)",
  brown: "sepia(0.38) saturate(1.12) brightness(0.82)",
  deep: "sepia(0.42) saturate(1.08) brightness(0.68)",
  umber: "sepia(0.52) saturate(1.18) brightness(0.58)",
});
const HAIR_FILTERS: Readonly<Record<HumanAppearance["hairRamp"], string>> = Object.freeze({
  espresso: "sepia(0.35) saturate(0.72) brightness(0.48)",
  chestnut: "sepia(0.62) saturate(1.24) brightness(0.72)",
  gold: "sepia(0.78) saturate(1.48) brightness(1.08)",
  copper: "sepia(0.82) saturate(1.68) hue-rotate(338deg) brightness(0.92)",
  charcoal: "grayscale(0.92) brightness(0.48)",
  silver: "grayscale(0.82) brightness(1.18)",
});
const CLOTHING_FILTERS: Readonly<Record<HumanAppearance["clothingPalette"], string>> = Object.freeze({
  olive: "sepia(0.28) saturate(0.92) hue-rotate(34deg)",
  teal: "saturate(1.16) hue-rotate(126deg)",
  ochre: "sepia(0.48) saturate(1.38) hue-rotate(350deg)",
  rust: "sepia(0.58) saturate(1.46) hue-rotate(322deg)",
  slate: "saturate(0.44) hue-rotate(156deg) brightness(0.84)",
  plum: "saturate(1.12) hue-rotate(244deg) brightness(0.82)",
  cream: "sepia(0.18) saturate(0.52) brightness(1.18)",
  denim: "saturate(0.92) hue-rotate(164deg) brightness(0.86)",
});
const ACCENT_PAINTS: Readonly<Record<NonNullable<HumanAppearance["secondaryAccent"]>, string>>
  = Object.freeze({
    "thread-ochre": "#d8a840",
    "thread-teal": "#35a7a0",
    "thread-plum": "#87558f",
    "thread-clay": "#b6634b",
  });
const immutableManifestCache = new WeakMap<ProductionAssetManifest, ProductionAssetManifest>();
let nextInstanceId = 1;

function finitePoint(point: Vec2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}

/**
 * Degrade `kneel`/`gather` onto the nearest clip this rig's packed atlas
 * actually has measured anchors for, since neither pose exists in
 * `HUMAN_BODY_ACTIONS`/`ACTION_FRAME_COUNTS` (`productionManifest.ts`) —
 * `kneel` (a bending-down gesture) reads closest to the authored
 * `reach-give` clip; `gather` (a crouched harvesting motion) reads closest
 * to the authored `work` clip. Every other `PlayableBodyAction` member is
 * already a `HumanBodyAction` and passes through unchanged.
 */
function legacyBodyAction(action: Exclude<PlayableBodyAction, "dead" | "prone">): HumanBodyAction {
  if (action === "kneel") return "reach-give";
  if (action === "gather") return "work";
  return action;
}

function copyPoint(point: Vec2): Vec2 {
  return { x: point.x, y: point.y };
}

function copyMutablePoint(point: Vec2): MutablePoint {
  return { x: point.x, y: point.y };
}

function copyFallbackReposition(
  reposition: ActiveFallbackReposition | null,
): ActiveFallbackReposition | null {
  return reposition === null ? null : {
    phase: reposition.phase,
    reason: "fallback",
    originPosition: copyMutablePoint(reposition.originPosition),
    originOffset: copyMutablePoint(reposition.originOffset),
    target: copyMutablePoint(reposition.target),
    elapsedMs: reposition.elapsedMs,
    sustained: reposition.sustained,
  };
}

function directionFor(from: Vec2, to: Vec2, retained: ProductionFacing): ProductionFacing {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) <= EPSILON && Math.abs(dy) <= EPSILON) return retained;
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "east" : "west";
  return dy >= 0 ? "south" : "north";
}

function clipDurationMs(clip: ProductionClip): number {
  let duration = 0;
  for (const frame of clip.frames) duration += frame.durationMs;
  return duration;
}

function minimumFutureDeadline(current: number | null, candidate: number, floor: number): number | null {
  if (!Number.isFinite(candidate) || candidate <= floor) return current;
  return current === null || candidate < current ? candidate : current;
}

function frameAtElapsed(clip: ProductionClip, elapsedMs: number, loop = clip.loop): number {
  const duration = clipDurationMs(clip);
  if (duration <= 0) return 0;
  let cursor = loop
    ? ((elapsedMs % duration) + duration) % duration
    : Math.min(Math.max(0, elapsedMs), Math.max(0, duration - Number.EPSILON));
  for (let index = 0; index < clip.frames.length; index += 1) {
    cursor -= clip.frames[index]!.durationMs;
    if (cursor < 0) return index;
  }
  return clip.frames.length - 1;
}

function frameBoundaryMs(clip: ProductionClip, frameIndex: number): number {
  let boundary = 0;
  for (let index = 0; index < frameIndex; index += 1) boundary += clip.frames[index]!.durationMs;
  return boundary;
}

function millisecondsUntilNextFrame(clip: ProductionClip, elapsedMs: number): number {
  const duration = clipDurationMs(clip);
  if (duration <= 0) return Number.POSITIVE_INFINITY;
  let cursor = ((elapsedMs % duration) + duration) % duration;
  for (const frame of clip.frames) {
    if (cursor < frame.durationMs) return frame.durationMs - cursor;
    cursor -= frame.durationMs;
  }
  return clip.frames[0]!.durationMs;
}

function stableHash(value: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

interface StatefulRandom {
  next(): number;
  snapshot(): number;
  restore(state: number): void;
}

function createRandom(seed: number): StatefulRandom {
  let state = seed >>> 0 || 0x6d2b79f5;
  return {
    next: (): number => {
      state = (state + 0x6d2b79f5) | 0;
      let value = Math.imul(state ^ (state >>> 15), 1 | state);
      value ^= value + Math.imul(value ^ (value >>> 7), 61 | value);
      return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
    },
    snapshot: (): number => state,
    restore: (restoredState: number): void => {
      state = restoredState;
    },
  };
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

function immutableAppearanceOverride(appearance: HumanAppearance): HumanAppearance {
  const valid = RIGS.includes(appearance.rig)
    && SKIN_RAMPS.includes(appearance.skinRamp)
    && HAIR_SILHOUETTES.includes(appearance.hairSilhouette)
    && HAIR_RAMPS.includes(appearance.hairRamp)
    && CLOTHING_SILHOUETTES.includes(appearance.clothingSilhouette)
    && CLOTHING_PALETTES.includes(appearance.clothingPalette)
    && (appearance.secondaryAccent === null
      || PERSONA_ACCENTS.includes(appearance.secondaryAccent));
  if (!valid) throw new TypeError("Layered human appearance override is outside authored inventory.");
  return Object.freeze({ ...appearance });
}

function immutableManifestView(manifest: ProductionAssetManifest): ProductionAssetManifest {
  const cached = immutableManifestCache.get(manifest);
  if (cached) return cached;
  const snapshot = deepFreeze(structuredClone(manifest));
  immutableManifestCache.set(manifest, snapshot);
  return snapshot;
}

/** A concrete manifest-driven six-channel production human state machine. */
export class LayeredHumanActor implements ProductionHumanActor {
  readonly #id: string;
  readonly #name: string;
  readonly #instanceId: number;
  readonly #appearance: HumanAppearance;
  readonly #paletteMode: "derived" | "authored";
  readonly #manifest: ProductionAssetManifest;
  readonly #leases: ReadonlyMap<string, ProductionAssetLease>;
  readonly #reducedMotion: boolean;
  readonly #random: StatefulRandom;
  readonly #personMarker: boolean;

  #position: MutablePoint;
  #visualOffset: MutablePoint = { x: 0, y: 0 };
  #facing: ProductionFacing;
  #pendingFacing: ProductionFacing | null = null;
  #bodyAction: HumanBodyAction = "idle";
  #bodyElapsedMs = 0;
  #faceExpression: HumanExpression = "neutral";
  #heldId: string | null = null;
  #status: HumanStatus = "alive";
  #selected = false;
  #route: Vec2[] = [];
  #routeIndex = 0;
  #speedPixelsPerSecond = 0;
  /** True while exact backend route samples, not renderer choreography, own the feet. */
  #authoritativeMotion = false;
  #gait: "walk" | "run" = "walk";
  #distanceTravelled = 0;
  #stridePhase = 0;
  #opacity = 1;
  #reposition: ActiveFallbackReposition | null = null;
  #lastNowMs = 0;
  #nextBlinkMs: number;
  #emittedTemporalMarkers = new Set<string>();
  #queuedSignals: ProductionActorSignal[] = [];
  #terminal = false;
  #recovering = false;
  #recoveryMarkerSent = false;
  #disposed = false;

  constructor(options: LayeredHumanActorOptions) {
    if (!finitePoint(options.position)) throw new TypeError("Layered human position must be finite.");
    if (!PRODUCTION_FACINGS.includes((options.facing ?? "south") as ProductionFacing)) {
      throw new TypeError("Layered human facing must be cardinal.");
    }
    this.#id = options.id;
    this.#name = options.name;
    this.#instanceId = nextInstanceId;
    nextInstanceId += 1;
    if (options.paletteMode !== undefined
      && options.paletteMode !== "derived"
      && options.paletteMode !== "authored") {
      throw new TypeError("Layered human palette mode must be derived or authored.");
    }
    this.#appearance = options.appearance === undefined
      ? deriveHumanAppearance(options.id, options.persona)
      : immutableAppearanceOverride(options.appearance);
    this.#paletteMode = options.paletteMode ?? "derived";
    this.#manifest = immutableManifestView(options.manifest);
    this.#leases = new Map(options.atlasLeases);
    this.#personMarker = this.#requiresPersonMarker();
    this.#reducedMotion = options.reducedMotion ?? false;
    this.#position = copyMutablePoint(options.position);
    this.#facing = (options.facing ?? "south") as ProductionFacing;
    this.#random = createRandom(stableHash(`${options.id}\0idle-microcycle`));
    this.#nextBlinkMs = this.#newBlinkDeadline(0);
  }

  /**
   * Adopt an exact backend route sample without building a renderer route.
   *
   * Lifecycle state, expression, held item, and stationary body clips remain
   * intact. Only renderer-owned locomotion and fallback relocation are
   * cleared, so no staged arrival or flash-step can occur between samples.
   */
  sampleAuthoritativeMotion(sample: AuthoritativeMotionSample, nowMs: number): void {
    if (this.#disposed || this.#terminal) return;
    if (!finitePoint(sample.position) || typeof sample.traveling !== "boolean") {
      throw new TypeError("Authoritative human motion sample must contain finite feet and a traveling flag.");
    }
    if (!Number.isFinite(nowMs) || nowMs < this.#lastNowMs) {
      throw new RangeError("Authoritative human motion time must be finite and monotonic.");
    }
    const prior = copyMutablePoint(this.#position);
    this.#lastNowMs = nowMs;
    this.#settleBlinkSchedule();
    this.#supersedeFallbackReposition();
    this.#position = copyMutablePoint(sample.position);
    this.#visualOffset = { x: 0, y: 0 };
    this.#route = [];
    this.#routeIndex = 0;
    this.#speedPixelsPerSecond = 0;
    this.#pendingFacing = null;
    const travelled = Math.hypot(sample.position.x - prior.x, sample.position.y - prior.y);
    if (travelled > EPSILON) {
      this.#distanceTravelled += travelled;
      this.#stridePhase = this.#distanceTravelled / (this.#currentBodyClip().strideLength ?? 1);
      if (sample.traveling) this.#facing = directionFor(prior, sample.position, this.#facing);
    }
    // These four states can only have been created by presentation locomotion.
    // Keep work/reach/hurt and every durable status as the snapshot supplied it.
    if (this.#bodyAction === "walk" || this.#bodyAction === "run"
      || this.#bodyAction === "turn" || this.#bodyAction === "stop") {
      this.#bodyAction = "idle";
      this.#bodyElapsedMs = 0;
      this.#emittedTemporalMarkers.clear();
    }
    this.#queuedSignals = this.#queuedSignals.filter(({ kind }) => kind !== "arrived" && kind !== "repositioned");
    this.#authoritativeMotion = sample.traveling && this.#status === "alive";
  }

  /** Atomically adopt a prepared scene position and return an idempotent transient-state rollback. */
  stagePosition(position: Vec2): (() => void) | null {
    if (this.#disposed || this.#terminal) return null;
    if (!finitePoint(position)) throw new TypeError("Human staged position must be finite.");
    if (this.#status !== "alive") return null;
    const checkpoint = {
      position: copyMutablePoint(this.#position),
      visualOffset: copyMutablePoint(this.#visualOffset),
      route: this.#route.map(copyMutablePoint),
      routeIndex: this.#routeIndex,
      speedPixelsPerSecond: this.#speedPixelsPerSecond,
      authoritativeMotion: this.#authoritativeMotion,
      pendingFacing: this.#pendingFacing,
      bodyAction: this.#bodyAction,
      bodyElapsedMs: this.#bodyElapsedMs,
      emittedTemporalMarkers: new Set(this.#emittedTemporalMarkers),
      recovering: this.#recovering,
      recoveryMarkerSent: this.#recoveryMarkerSent,
      opacity: this.#opacity,
      reposition: copyFallbackReposition(this.#reposition),
    };
    this.#supersedeFallbackReposition();
    this.#position = copyMutablePoint(position);
    this.#visualOffset = { x: 0, y: 0 };
    this.#route = [];
    this.#routeIndex = 0;
    this.#speedPixelsPerSecond = 0;
    this.#authoritativeMotion = false;
    this.#pendingFacing = null;
    this.#beginBodyAction("idle");
    let available = true;
    return () => {
      if (!available) return;
      available = false;
      if (this.#disposed) return;
      this.#position = checkpoint.position;
      this.#visualOffset = checkpoint.visualOffset;
      this.#route = checkpoint.route;
      this.#routeIndex = checkpoint.routeIndex;
      this.#speedPixelsPerSecond = checkpoint.speedPixelsPerSecond;
      this.#authoritativeMotion = checkpoint.authoritativeMotion;
      this.#pendingFacing = checkpoint.pendingFacing;
      this.#bodyAction = checkpoint.bodyAction;
      this.#bodyElapsedMs = checkpoint.bodyElapsedMs;
      this.#emittedTemporalMarkers = checkpoint.emittedTemporalMarkers;
      this.#recovering = checkpoint.recovering;
      this.#recoveryMarkerSent = checkpoint.recoveryMarkerSent;
      this.#opacity = checkpoint.opacity;
      this.#reposition = checkpoint.reposition;
    };
  }

  /** Cancel a presentation fallback owned by a stale scene and restore its visual origin. */
  cancelFallbackReposition(): void {
    if (this.#disposed || this.#reposition === null) return;
    this.#position = copyMutablePoint(this.#reposition.originPosition);
    this.#visualOffset = copyMutablePoint(this.#reposition.originOffset);
    this.#reposition = null;
    this.#opacity = 1;
  }

  /** See `SpriteSheetHumanActor.beginPresenceVanish` (identical contract, mirrored for `ProductionHumanActor` conformance). */
  beginPresenceVanish(): void {
    if (this.#disposed || this.#terminal || this.#status !== "alive") return;
    if (this.#reposition !== null && this.#reposition.sustained) return;
    this.#beginFallbackReposition(this.#position, true);
  }

  /** See `SpriteSheetHumanActor.beginPresenceReveal` (identical contract, mirrored for `ProductionHumanActor` conformance). */
  beginPresenceReveal(): void {
    if (this.#disposed) return;
    if (this.#reposition === null || !this.#reposition.sustained || this.#opacity !== 0) return;
    this.#reposition = { ...this.#reposition, phase: "fade-in", elapsedMs: 0, sustained: false };
  }

  /** Apply a prepared command set and return an idempotent full-state rollback. */
  stageCommands(commands: readonly HumanPrimitiveCommand[], nowMs: number): () => void {
    const checkpoint = {
      position: copyMutablePoint(this.#position),
      visualOffset: copyMutablePoint(this.#visualOffset),
      facing: this.#facing,
      pendingFacing: this.#pendingFacing,
      bodyAction: this.#bodyAction,
      bodyElapsedMs: this.#bodyElapsedMs,
      faceExpression: this.#faceExpression,
      heldId: this.#heldId,
      status: this.#status,
      selected: this.#selected,
      route: this.#route.map(copyMutablePoint),
      routeIndex: this.#routeIndex,
      speedPixelsPerSecond: this.#speedPixelsPerSecond,
      authoritativeMotion: this.#authoritativeMotion,
      gait: this.#gait,
      distanceTravelled: this.#distanceTravelled,
      stridePhase: this.#stridePhase,
      lastNowMs: this.#lastNowMs,
      nextBlinkMs: this.#nextBlinkMs,
      randomState: this.#random.snapshot(),
      emittedTemporalMarkers: new Set(this.#emittedTemporalMarkers),
      queuedSignals: [...this.#queuedSignals],
      terminal: this.#terminal,
      recovering: this.#recovering,
      recoveryMarkerSent: this.#recoveryMarkerSent,
      opacity: this.#opacity,
      reposition: copyFallbackReposition(this.#reposition),
    };
    let available = true;
    const rollback = (): void => {
      if (!available) return;
      available = false;
      if (this.#disposed) return;
      this.#position = checkpoint.position;
      this.#visualOffset = checkpoint.visualOffset;
      this.#facing = checkpoint.facing;
      this.#pendingFacing = checkpoint.pendingFacing;
      this.#bodyAction = checkpoint.bodyAction;
      this.#bodyElapsedMs = checkpoint.bodyElapsedMs;
      this.#faceExpression = checkpoint.faceExpression;
      this.#heldId = checkpoint.heldId;
      this.#status = checkpoint.status;
      this.#selected = checkpoint.selected;
      this.#route = checkpoint.route;
      this.#routeIndex = checkpoint.routeIndex;
      this.#speedPixelsPerSecond = checkpoint.speedPixelsPerSecond;
      this.#authoritativeMotion = checkpoint.authoritativeMotion;
      this.#gait = checkpoint.gait;
      this.#distanceTravelled = checkpoint.distanceTravelled;
      this.#stridePhase = checkpoint.stridePhase;
      this.#lastNowMs = checkpoint.lastNowMs;
      this.#nextBlinkMs = checkpoint.nextBlinkMs;
      this.#random.restore(checkpoint.randomState);
      this.#emittedTemporalMarkers = checkpoint.emittedTemporalMarkers;
      this.#queuedSignals = checkpoint.queuedSignals;
      this.#terminal = checkpoint.terminal;
      this.#recovering = checkpoint.recovering;
      this.#recoveryMarkerSent = checkpoint.recoveryMarkerSent;
      this.#opacity = checkpoint.opacity;
      this.#reposition = checkpoint.reposition;
    };
    try {
      for (const command of commands) this.apply(command, nowMs);
    } catch (error) {
      rollback();
      throw error;
    }
    return rollback;
  }

  apply(command: HumanPrimitiveCommand, nowMs: number): void {
    if (this.#disposed || this.#terminal) return;
    if (!Number.isFinite(nowMs) || nowMs < this.#lastNowMs) {
      throw new RangeError("Human command time must be finite and monotonic.");
    }
    this.#lastNowMs = nowMs;
    this.#settleBlinkSchedule();
    if (command.kind === "move" || command.kind === "orient" || command.kind === "reposition"
      || command.kind === "set-offset") this.#authoritativeMotion = false;
    if (this.#status === "paralyzed"
      && (command.kind === "move" || command.kind === "orient" || command.kind === "play-body")) {
      return;
    }
    switch (command.kind) {
      case "move": {
        if (!Number.isFinite(command.speedPixelsPerSecond) || command.speedPixelsPerSecond <= 0) {
          throw new RangeError("Movement speed must be positive and finite.");
        }
        if (!command.waypoints.every(finitePoint)) {
          throw new TypeError("Movement waypoints must be finite points.");
        }
        this.#supersedeFallbackReposition();
        this.#route = command.waypoints.map(copyPoint);
        this.#routeIndex = 0;
        this.#speedPixelsPerSecond = command.speedPixelsPerSecond;
        this.#gait = command.gait;
        this.#status = "alive";
        this.#prepareMovementSegment();
        return;
      }
      case "orient":
        if (!PRODUCTION_FACINGS.includes(command.facing as ProductionFacing)) {
          throw new TypeError("Orient facing must be cardinal.");
        }
        this.#route = [];
        this.#routeIndex = 0;
        this.#speedPixelsPerSecond = 0;
        if (this.#reducedMotion) {
          this.#pendingFacing = null;
          this.#commitFacing(command.facing);
          this.#beginBodyAction("idle");
          return;
        }
        if (command.facing !== this.#facing) this.#startTurn(command.facing);
        return;
      case "play-body":
        this.#supersedeFallbackReposition();
        if (command.action === "dead") {
          this.#becomeDead();
          return;
        }
        if (command.action === "prone") {
          this.#becomeParalyzed();
          return;
        }
        this.#status = "alive";
        this.#route = [];
        this.#routeIndex = 0;
        this.#speedPixelsPerSecond = 0;
        this.#beginBodyAction(legacyBodyAction(command.action));
        return;
      case "clear-body":
        if (this.#status !== "alive" || this.#recovering
          || this.#bodyAction === "walk" || this.#bodyAction === "run"
          || this.#bodyAction === "turn" || this.#bodyAction === "stop") return;
        this.#beginBodyAction("idle");
        return;
      case "set-face":
        this.#faceExpression = command.expression;
        return;
      case "set-held":
        this.#heldId = command.heldId;
        return;
      case "set-status":
        this.#supersedeFallbackReposition();
        if (command.status === "dead") this.#becomeDead();
        else if (command.status === "paralyzed") this.#becomeParalyzed();
        else {
          this.#status = "alive";
          this.#beginBodyAction("idle");
        }
        return;
      case "recover":
        if (this.#status !== "paralyzed") return;
        this.#supersedeFallbackReposition();
        this.#status = "alive";
        this.#route = [];
        this.#routeIndex = 0;
        this.#speedPixelsPerSecond = 0;
        this.#pendingFacing = null;
        this.#heldId = null;
        this.#faceExpression = "recovery";
        this.#beginBodyAction("hurt-fall", true);
        return;
      case "reposition":
        if (!REPOSITION_REASONS.has(command.reason)) {
          throw new Error("Invalid human reposition reason.");
        }
        if (!finitePoint(command.position)) {
          throw new TypeError("Human reposition position must be finite.");
        }
        if (this.#status !== "alive") return;
        if (FADED_REPOSITION_REASONS.has(command.reason)) {
          this.#beginFallbackReposition(command.position, false, command.reason);
          return;
        }
        if (this.stagePosition(command.position) === null) return;
        this.#queuedSignals.push(deepFreeze({
          kind: "repositioned",
          actorId: this.#id,
          position: copyPoint(this.#position),
          reason: command.reason,
        }));
        return;
      case "set-offset":
        if (!finitePoint(command.offset)) throw new TypeError("Human visual offset must be finite.");
        if (Math.hypot(command.offset.x, command.offset.y) > MAX_TRANSIENT_OFFSET_PX) {
          throw new RangeError("Human visual offset cannot exceed 8 pixels.");
        }
        if (this.#status !== "alive") return;
        this.#visualOffset = copyMutablePoint(command.offset);
        return;
      case "set-selected":
        this.#selected = command.selected;
    }
  }

  advance(deltaSeconds: number, nowMs: number): readonly ProductionActorSignal[] {
    if (this.#disposed || this.#terminal) return [];
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0 || !Number.isFinite(nowMs)
      || nowMs < this.#lastNowMs) {
      throw new RangeError("Human advance requires non-negative delta and monotonic finite time.");
    }
    this.#lastNowMs = nowMs;
    this.#settleBlinkSchedule();
    const signals = this.#queuedSignals.splice(0, this.#queuedSignals.length);
    let remainingMs = deltaSeconds * 1_000;

    if (this.#reposition !== null) {
      this.#advanceFallbackReposition(remainingMs, signals);
      return deepFreeze(signals);
    }

    if (this.#status === "paralyzed") {
      if (!this.#reducedMotion) this.#bodyElapsedMs += remainingMs;
      return deepFreeze(signals);
    }

    const transitionLimit = Math.max(16, this.#route.length * 3 + 16);
    for (let transitions = 0; transitions < transitionLimit && remainingMs > EPSILON; transitions += 1) {
      if (this.#bodyAction === "walk" || this.#bodyAction === "run") {
        remainingMs = this.#advanceMovement(remainingMs, signals);
        continue;
      }
      if (this.#bodyAction === "idle") break;
      const clip = this.#currentBodyClip();
      const durationMs = clipDurationMs(clip);
      const availableMs = Math.max(0, durationMs - this.#bodyElapsedMs);
      const consumedMs = Math.min(remainingMs, availableMs);
      const previousMs = this.#bodyElapsedMs;
      this.#bodyElapsedMs += consumedMs;
      remainingMs -= consumedMs;
      if (this.#recovering) {
        this.#emitRecoveryMarker(clip, previousMs, this.#bodyElapsedMs, signals);
      } else {
        this.#emitTemporalMarkers(clip, previousMs, this.#bodyElapsedMs, signals);
      }
      if (this.#bodyElapsedMs + EPSILON < durationMs) break;

      if (this.#bodyAction === "turn") {
        if (this.#pendingFacing !== null) this.#commitFacing(this.#pendingFacing);
        this.#pendingFacing = null;
        this.#emittedTemporalMarkers.clear();
        if (!this.#prepareMovementSegment()) this.#beginBodyAction("idle");
        // A turn-completion snapshot is an orientation boundary, never a movement
        // sample. Begin the selected gait now and spend no leftover frame time on
        // displacement; the next advance starts locomotion moving-to-moving.
        remainingMs = 0;
      } else if (this.#bodyAction === "stop") {
        this.#beginBodyAction("idle");
      } else {
        const completedRecovery = this.#recovering;
        this.#beginBodyAction("idle");
        if (completedRecovery) this.#faceExpression = "neutral";
      }
      if (consumedMs <= EPSILON && remainingMs > EPSILON) break;
    }
    return deepFreeze(signals);
  }

  draw(context: CanvasRenderingContext2D): void {
    if (this.#disposed) return;
    context.imageSmoothingEnabled = false;
    if (this.#personMarker) {
      this.#drawPersonMarker(context);
      return;
    }
    const layers = this.#resolveLayers();
    const body = layers.body;
    if (!body.frame) throw new Error("Required body frame is unavailable.");
    const bodyLeft = Math.round(this.#position.x + this.#visualOffset.x - body.frame.feet.x);
    const bodyTop = Math.round(this.#position.y + this.#visualOffset.y - body.frame.feet.y);
    for (const layerId of LAYER_ORDER) {
      const layer = layers[layerId];
      if (!layer.visible || !layer.frame) continue;
      const lease = this.#leases.get(layer.atlasId);
      if (!lease) continue;
      const { rect } = layer.frame;
      const [destinationX, destinationY] = this.#layerDestination(
        layerId,
        layer,
        body.frame,
        bodyLeft,
        bodyTop,
      );
      context.save();
      context.filter = this.#filterForLayer(layerId);
      context.globalCompositeOperation = "source-over";
      context.globalAlpha = this.#opacity;
      context.drawImage(
        lease.value,
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        destinationX,
        destinationY,
        rect.width,
        rect.height,
      );
      context.restore();
    }
    if (this.#appearance.secondaryAccent !== null) {
      context.save();
      context.filter = "none";
      context.globalCompositeOperation = "source-over";
      context.globalAlpha = this.#opacity;
      context.fillStyle = ACCENT_PAINTS[this.#appearance.secondaryAccent];
      context.fillRect(bodyLeft + 5, bodyTop + 31, 2, 2);
      context.restore();
    }
    context.imageSmoothingEnabled = false;
  }

  snapshot(): LayeredHumanSnapshot {
    const resolved = this.#resolveLayers();
    const layers = Object.fromEntries(LAYER_ORDER.map((layerId) => [layerId, {
      ...resolved[layerId].snapshot,
    }])) as Record<HumanLayerId, LayeredHumanLayerSnapshot>;
    return deepFreeze({
      id: this.#id,
      instanceId: this.#instanceId,
      position: {
        x: this.#position.x + this.#visualOffset.x,
        y: this.#position.y + this.#visualOffset.y,
      },
      facing: this.#facing,
      appearance: this.#appearance,
      distanceTravelled: this.#distanceTravelled,
      stridePhase: this.#stridePhase,
      terminal: this.#terminal,
      routeActive: !this.#terminal
        && this.#status === "alive"
        && (this.#authoritativeMotion || (this.#speedPixelsPerSecond > 0
          && this.#routeIndex < this.#route.length)),
      opacity: this.#opacity,
      reposition: this.#reposition === null ? null : {
        phase: this.#reposition.phase,
        reason: "fallback",
        target: copyPoint(this.#reposition.target),
      },
      activeAction: this.#semanticAction(),
      artFallback: this.#personMarker ? "person-marker" : null,
      layers,
    });
  }

  #semanticAction(): HumanSemanticAction {
    if (this.#terminal || this.#bodyAction === "dead") return "dead";
    if (this.#recovering) return "recovering";
    if (this.#status === "paralyzed" || this.#bodyAction === "prone") return "prone";
    if (this.#faceExpression === "talk-1" || this.#faceExpression === "talk-2") return "speaking";
    switch (this.#bodyAction) {
      case "walk":
      case "run":
        return "moving";
      case "turn":
        return "orienting";
      case "reach-give":
        return "reaching";
      case "work":
        return "working";
      case "hurt-fall":
        return "hurt";
      default:
        return this.#authoritativeMotion ? "moving" : null;
    }
  }

  nextDeadlineMs(): number | null {
    if (this.#disposed || this.#terminal) return null;
    let deadline: number | null = null;

    if (this.#authoritativeMotion) {
      deadline = minimumFutureDeadline(
        deadline,
        this.#lastNowMs + AUTHORITATIVE_MOTION_DEADLINE_MS,
        this.#lastNowMs,
      );
    }

    if (this.#reposition !== null) {
      const remaining = Math.max(0, FALLBACK_FADE_PHASE_MS - this.#reposition.elapsedMs);
      return minimumFutureDeadline(
        null,
        this.#lastNowMs + Math.min(FALLBACK_FADE_FRAME_MS, remaining),
        this.#lastNowMs,
      );
    }

    if (this.#status === "paralyzed") {
      if (this.#reducedMotion) return null;
      return minimumFutureDeadline(
        null,
        this.#lastNowMs + millisecondsUntilNextFrame(this.#currentBodyClip(), this.#bodyElapsedMs),
        this.#lastNowMs,
      );
    }
    if (this.#bodyAction !== "idle" && this.#bodyAction !== "walk" && this.#bodyAction !== "run") {
      const clip = this.#currentBodyClip();
      const frameIndex = frameAtElapsed(clip, this.#bodyElapsedMs, false);
      const boundary = frameBoundaryMs(clip, Math.min(frameIndex + 1, clip.frames.length));
      if (boundary > this.#bodyElapsedMs) {
        deadline = minimumFutureDeadline(
          deadline,
          this.#lastNowMs + boundary - this.#bodyElapsedMs,
          this.#lastNowMs,
        );
      }
      const duration = clipDurationMs(clip);
      if (duration > this.#bodyElapsedMs) {
        deadline = minimumFutureDeadline(
          deadline,
          this.#lastNowMs + duration - this.#bodyElapsedMs,
          this.#lastNowMs,
        );
      }
    }
    if (!this.#reducedMotion && this.#bodyAction === "idle") {
      const clip = this.#currentBodyClip();
      deadline = minimumFutureDeadline(
        deadline,
        this.#lastNowMs + millisecondsUntilNextFrame(clip, this.#lastNowMs),
        this.#lastNowMs,
      );
      if (this.#faceExpression === "neutral") {
        if (this.#lastNowMs < this.#nextBlinkMs) {
          deadline = minimumFutureDeadline(deadline, this.#nextBlinkMs, this.#lastNowMs);
        } else if (this.#lastNowMs < this.#nextBlinkMs + BLINK_DURATION_MS) {
          const blinkFrame = Math.floor((this.#lastNowMs - this.#nextBlinkMs) / BLINK_FRAME_MS) + 1;
          deadline = minimumFutureDeadline(
            deadline,
            this.#nextBlinkMs + blinkFrame * BLINK_FRAME_MS,
            this.#lastNowMs,
          );
        }
      }
    }
    return deadline;
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    for (const lease of new Set(this.#leases.values())) lease.release();
    this.#route = [];
    this.#queuedSignals.length = 0;
    this.#reposition = null;
    this.#opacity = 1;
  }

  #requiresPersonMarker(): boolean {
    const bodyAtlasId = this.#manifest.human.layerAtlases.body;
    let missing = !this.#manifest.atlases[bodyAtlasId] || !this.#leases.has(bodyAtlasId);
    const rig = this.#manifest.human.rigs[this.#appearance.rig];
    for (const facing of PRODUCTION_FACINGS) {
      const fallbackAtlasId = rig.silhouetteFallbacks[facing].frame.atlasId;
      if (!this.#manifest.atlases[fallbackAtlasId] || !this.#leases.has(fallbackAtlasId)) {
        missing = true;
      }
    }
    if (!missing) return false;
    const decision = decideAssetFallback({
      failure: "missing-character-art",
      subjectId: this.#id,
      regionId: null,
      occurrence: 1,
    });
    return decision.action === "continue" && decision.fallback === "person-silhouette";
  }

  #drawPersonMarker(context: CanvasRenderingContext2D): void {
    const left = Math.round(this.#position.x + this.#visualOffset.x - 9);
    const top = Math.round(this.#position.y + this.#visualOffset.y - 31);
    context.save();
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = this.#opacity;
    context.filter = "none";
    context.fillStyle = this.#status === "dead" ? "#62645f" : "#d0a878";
    context.fillRect(left + 4, top, 10, 10);
    context.fillStyle = this.#status === "dead" ? "#555854" : "#52645a";
    context.fillRect(left + 2, top + 10, 14, 14);
    context.fillRect(left + 3, top + 24, 5, 7);
    context.fillRect(left + 10, top + 24, 5, 7);
    context.fillStyle = "#2f2925";
    if (this.#facing === "south") {
      context.fillRect(left + 6, top + 4, 2, 2);
      context.fillRect(left + 11, top + 4, 2, 2);
    } else if (this.#facing === "east") {
      context.fillRect(left + 11, top + 4, 2, 2);
    } else if (this.#facing === "west") {
      context.fillRect(left + 5, top + 4, 2, 2);
    }
    if (this.#selected) {
      context.strokeStyle = "#f2df7a";
      context.lineWidth = 1;
      context.strokeRect(left + 0.5, top - 1.5, 17, 33);
    }
    context.restore();
    context.imageSmoothingEnabled = false;
  }

  #filterForLayer(layerId: HumanLayerId): string {
    if (this.#paletteMode === "authored") return "none";
    if (layerId === "body" || layerId === "face") return SKIN_FILTERS[this.#appearance.skinRamp];
    if (layerId === "hair") return HAIR_FILTERS[this.#appearance.hairRamp];
    if (layerId === "clothing") return CLOTHING_FILTERS[this.#appearance.clothingPalette];
    return "none";
  }

  #layerDestination(
    layerId: HumanLayerId,
    layer: ResolvedLayer,
    bodyFrame: NativeFrameRef,
    bodyLeft: number,
    bodyTop: number,
  ): readonly [number, number] {
    const frame = layer.frame;
    if (!frame) return [bodyLeft, bodyTop];
    if (layer.snapshot.fallback || layerId === "body" || layerId === "clothing") {
      return [bodyLeft, bodyTop];
    }
    if (layerId === "face" || layerId === "hair") {
      return [
        Math.round(bodyLeft + bodyFrame.faceAnchor.x - frame.faceAnchor.x),
        Math.round(bodyTop + bodyFrame.faceAnchor.y - frame.faceAnchor.y),
      ];
    }
    if (layerId === "held") {
      return [
        Math.round(bodyLeft + bodyFrame.heldAnchor.x - frame.heldAnchor.x),
        Math.round(bodyTop + bodyFrame.heldAnchor.y - frame.heldAnchor.y),
      ];
    }
    return [
      Math.round(this.#position.x - frame.feet.x),
      Math.round(this.#position.y - frame.feet.y),
    ];
  }

  #newBlinkDeadline(afterMs: number): number {
    return afterMs + MIN_BLINK_INTERVAL_MS
      + Math.floor(this.#random.next() * BLINK_INTERVAL_SPAN_MS);
  }

  #settleBlinkSchedule(): void {
    while (this.#lastNowMs >= this.#nextBlinkMs + BLINK_DURATION_MS) {
      this.#nextBlinkMs = this.#newBlinkDeadline(this.#nextBlinkMs + BLINK_DURATION_MS);
    }
  }

  #visibleExpression(): HumanExpression {
    if (this.#terminal) return "hurt";
    if (this.#faceExpression !== "neutral" || this.#reducedMotion || this.#bodyAction !== "idle") {
      return this.#faceExpression;
    }
    if (this.#lastNowMs < this.#nextBlinkMs || this.#lastNowMs >= this.#nextBlinkMs + BLINK_DURATION_MS) {
      return "neutral";
    }
    const frame = Math.floor((this.#lastNowMs - this.#nextBlinkMs) / BLINK_FRAME_MS);
    return frame === 1 ? "blink-2" : "blink-1";
  }

  #beginBodyAction(action: HumanBodyAction, recovering = false): void {
    this.#bodyAction = action;
    this.#bodyElapsedMs = 0;
    this.#emittedTemporalMarkers.clear();
    this.#recovering = recovering;
    this.#recoveryMarkerSent = false;
  }

  #beginFallbackReposition(
    target: Vec2,
    sustained = false,
    reason: HumanRepositionReason = "fallback",
  ): void {
    this.#supersedeFallbackReposition();
    const originPosition = copyMutablePoint(this.#position);
    const originOffset = copyMutablePoint(this.#visualOffset);
    this.#route = [];
    this.#routeIndex = 0;
    this.#speedPixelsPerSecond = 0;
    this.#pendingFacing = null;
    this.#visualOffset = { x: 0, y: 0 };
    this.#beginBodyAction("idle");
    this.#opacity = 1;
    this.#reposition = {
      phase: "fade-out",
      reason,
      originPosition,
      originOffset,
      target: copyMutablePoint(target),
      elapsedMs: 0,
      sustained,
    };
  }

  #supersedeFallbackReposition(): void {
    if (this.#reposition === null) return;
    this.#reposition = null;
    this.#opacity = 1;
  }

  #advanceFallbackReposition(
    remainingMs: number,
    signals: ProductionActorSignal[],
  ): void {
    const reposition = this.#reposition;
    if (reposition === null || remainingMs <= EPSILON) return;
    const availableMs = Math.max(0, FALLBACK_FADE_PHASE_MS - reposition.elapsedMs);
    reposition.elapsedMs += Math.min(remainingMs, availableMs);
    if (reposition.phase === "fade-out") {
      this.#opacity = Math.max(0, 1 - reposition.elapsedMs / FALLBACK_FADE_PHASE_MS);
      if (reposition.elapsedMs + EPSILON < FALLBACK_FADE_PHASE_MS) return;
      this.#opacity = 0;
      if (reposition.sustained) {
        reposition.elapsedMs = FALLBACK_FADE_PHASE_MS;
        return;
      }
      this.#position = copyMutablePoint(reposition.target);
      this.#visualOffset = { x: 0, y: 0 };
      reposition.phase = "fade-in";
      reposition.elapsedMs = 0;
      signals.push(deepFreeze({
        kind: "repositioned",
        actorId: this.#id,
        position: copyPoint(this.#position),
        reason: reposition.reason,
      }));
      return;
    }
    this.#opacity = Math.min(1, reposition.elapsedMs / FALLBACK_FADE_PHASE_MS);
    if (reposition.elapsedMs + EPSILON < FALLBACK_FADE_PHASE_MS) return;
    this.#opacity = 1;
    this.#reposition = null;
  }

  #startTurn(target: ProductionFacing): void {
    this.#pendingFacing = target;
    this.#beginBodyAction("turn");
  }

  #commitFacing(target: ProductionFacing): void {
    this.#facing = target;
  }

  #becomeParalyzed(): void {
    this.#supersedeFallbackReposition();
    this.#status = "paralyzed";
    this.#route = [];
    this.#routeIndex = 0;
    this.#speedPixelsPerSecond = 0;
    this.#pendingFacing = null;
    this.#heldId = null;
    this.#faceExpression = "hurt";
    this.#visualOffset = { x: 0, y: 0 };
    this.#beginBodyAction("prone");
  }

  #becomeDead(): void {
    this.#supersedeFallbackReposition();
    this.#status = "dead";
    this.#terminal = true;
    this.#route = [];
    this.#routeIndex = 0;
    this.#speedPixelsPerSecond = 0;
    this.#pendingFacing = null;
    this.#heldId = null;
    this.#faceExpression = "hurt";
    this.#visualOffset = { x: 0, y: 0 };
    this.#beginBodyAction("dead");
  }

  #discardReachedWaypoints(): void {
    while (this.#routeIndex < this.#route.length) {
      const target = this.#route[this.#routeIndex]!;
      if (Math.hypot(target.x - this.#position.x, target.y - this.#position.y) > EPSILON) return;
      this.#routeIndex += 1;
    }
  }

  #prepareMovementSegment(): boolean {
    this.#discardReachedWaypoints();
    if (this.#routeIndex >= this.#route.length) return false;
    const target = this.#route[this.#routeIndex]!;
    const desired = directionFor(this.#position, target, this.#facing);
    if (desired !== this.#facing) this.#startTurn(desired);
    else this.#beginBodyAction(this.#gait);
    return true;
  }

  #finishRoute(signals: ProductionActorSignal[]): void {
    this.#route = [];
    this.#routeIndex = 0;
    this.#speedPixelsPerSecond = 0;
    this.#beginBodyAction("stop");
    signals.push(deepFreeze({ kind: "arrived", actorId: this.#id, position: copyPoint(this.#position) }));
  }

  #advanceMovement(remainingMs: number, signals: ProductionActorSignal[]): number {
    this.#discardReachedWaypoints();
    if (this.#routeIndex >= this.#route.length) {
      this.#finishRoute(signals);
      return 0;
    }
    while (remainingMs > EPSILON && this.#routeIndex < this.#route.length) {
      const target = this.#route[this.#routeIndex]!;
      const desired = directionFor(this.#position, target, this.#facing);
      if (desired !== this.#facing) {
        this.#startTurn(desired);
        return 0;
      }
      const dx = target.x - this.#position.x;
      const dy = target.y - this.#position.y;
      const segmentDistance = Math.hypot(dx, dy);
      if (segmentDistance <= EPSILON) {
        this.#routeIndex += 1;
        continue;
      }
      const availableDistance = this.#speedPixelsPerSecond * remainingMs / 1_000;
      const travelled = Math.min(segmentDistance, availableDistance);
      const oldDistance = this.#distanceTravelled;
      this.#position.x += dx / segmentDistance * travelled;
      this.#position.y += dy / segmentDistance * travelled;
      this.#distanceTravelled += travelled;
      const clip = this.#currentBodyClip();
      const stride = clip.strideLength ?? 1;
      const oldPhase = oldDistance / stride;
      this.#stridePhase = this.#distanceTravelled / stride;
      this.#emitDistanceMarkers(clip, oldPhase, this.#stridePhase, signals);
      remainingMs = Math.max(0, remainingMs - travelled / this.#speedPixelsPerSecond * 1_000);
      if (travelled + EPSILON < segmentDistance) return 0;

      this.#position = copyMutablePoint(target);
      this.#routeIndex += 1;
      this.#discardReachedWaypoints();
      if (this.#routeIndex >= this.#route.length) {
        // Preserve the gait through the displacement snapshot. The next advance
        // observes the exhausted route, transitions to stop, and emits arrival
        // without changing position.
        return 0;
      }
      const nextTarget = this.#route[this.#routeIndex]!;
      const nextFacing = directionFor(this.#position, nextTarget, this.#facing);
      if (nextFacing !== this.#facing) {
        // The corner-arrival sample remains moving. Materialize the turn on the
        // following zero-displacement advance so action and position cannot cross.
        return 0;
      }
    }
    return remainingMs;
  }

  #emitTemporalMarkers(
    clip: ProductionClip,
    previousMs: number,
    currentMs: number,
    signals: ProductionActorSignal[],
  ): void {
    const markers = [...clip.markers].sort((left, right) => left.frame - right.frame
      || left.name.localeCompare(right.name));
    for (const marker of markers) {
      const boundary = frameBoundaryMs(clip, marker.frame);
      const key = `${marker.frame}:${marker.name}`;
      if (boundary > previousMs + EPSILON && boundary <= currentMs + EPSILON
        && !this.#emittedTemporalMarkers.has(key)) {
        this.#emittedTemporalMarkers.add(key);
        if (marker.name === "facing-switch" && this.#pendingFacing !== null) {
          this.#commitFacing(this.#pendingFacing);
        }
        signals.push(deepFreeze({
          kind: "marker",
          actorId: this.#id,
          marker: marker.name,
          action: clip.action,
          frameIndex: marker.frame,
        }));
      }
    }
  }

  #emitRecoveryMarker(
    clip: ProductionClip,
    previousMs: number,
    currentMs: number,
    signals: ProductionActorSignal[],
  ): void {
    const firstReverseBoundary = clip.frames.at(-1)?.durationMs ?? 0;
    if (this.#recoveryMarkerSent || firstReverseBoundary <= previousMs + EPSILON
      || firstReverseBoundary > currentMs + EPSILON) return;
    this.#recoveryMarkerSent = true;
    signals.push(deepFreeze({
      kind: "marker",
      actorId: this.#id,
      marker: "recovery-contact",
      action: clip.action,
      frameIndex: Math.max(0, clip.frames.length - 2),
    }));
  }

  #emitDistanceMarkers(
    clip: ProductionClip,
    previousPhase: number,
    currentPhase: number,
    signals: ProductionActorSignal[],
  ): void {
    const crossings: Array<{ phase: number; marker: ProductionClip["markers"][number] }> = [];
    for (const marker of clip.markers) {
      const withinStride = marker.frame / clip.frames.length;
      for (let cycle = Math.floor(previousPhase) - 1; cycle <= Math.ceil(currentPhase); cycle += 1) {
        const phase = cycle + withinStride;
        if (phase > previousPhase + EPSILON && phase <= currentPhase + EPSILON) {
          crossings.push({ phase, marker });
        }
      }
    }
    crossings.sort((left, right) => left.phase - right.phase
      || left.marker.frame - right.marker.frame
      || left.marker.name.localeCompare(right.marker.name));
    for (const { marker } of crossings) {
      signals.push(deepFreeze({
        kind: "marker",
        actorId: this.#id,
        marker: marker.name,
        action: clip.action,
        frameIndex: marker.frame,
      }));
    }
  }

  #currentBodyClip(): ProductionClip {
    const clipFacing = this.#facing;
    const clip = requireHumanClip(
      this.#manifest,
      this.#appearance.rig,
      this.#bodyAction,
      clipFacing,
    );
    const resolvedFacing = resolveClipFacing(clip, this.#facing);
    if (clip.direction === "none" && resolvedFacing !== this.#facing) {
      throw new Error("Directionless human action changed retained facing.");
    }
    return clip;
  }

  #bodyFrame(): { readonly clip: ProductionClip; readonly frameIndex: number; readonly frame: NativeFrameRef } {
    const clip = this.#currentBodyClip();
    let frameIndex: number;
    if (this.#bodyAction === "walk" || this.#bodyAction === "run") {
      frameIndex = Math.floor(this.#stridePhase * clip.frames.length) % clip.frames.length;
    } else if (this.#bodyAction === "idle") {
      frameIndex = this.#reducedMotion ? 0 : frameAtElapsed(clip, this.#lastNowMs);
    } else if (this.#terminal) {
      frameIndex = clip.frames.length - 1;
    } else if (this.#recovering) {
      frameIndex = clip.frames.length - 1 - frameAtElapsed(clip, this.#bodyElapsedMs);
    } else {
      frameIndex = frameAtElapsed(clip, this.#bodyElapsedMs);
    }
    frameIndex = Math.max(0, Math.min(frameIndex, clip.frames.length - 1));
    return { clip, frameIndex, frame: clip.frames[frameIndex]! };
  }

  #nativeFrame(
    atlasId: string,
    cellIndex: number,
    durationMs = 160,
    overlayFaceAnchor?: Vec2,
  ): NativeFrameRef | undefined {
    const atlas = this.#manifest.atlases[atlasId];
    if (!atlas) return undefined;
    return {
      atlasId,
      rect: {
        x: cellIndex % atlas.columns * atlas.cellWidth,
        y: Math.floor(cellIndex / atlas.columns) * atlas.cellHeight,
        width: atlas.cellWidth,
        height: atlas.cellHeight,
      },
      durationMs,
      feet: {
        x: atlas.cellWidth === 48 ? 24 : Math.floor(atlas.cellWidth / 2),
        y: atlas.cellHeight === 64 ? 61 : atlas.cellHeight - 1,
      },
      faceAnchor: overlayFaceAnchor
        ? { x: overlayFaceAnchor.x, y: overlayFaceAnchor.y }
        : {
            x: atlas.cellWidth === 48 ? 24 : Math.floor(atlas.cellWidth / 2),
            y: atlas.cellHeight === 64 ? 18 : Math.floor(atlas.cellHeight / 2),
          },
      heldAnchor: {
        x: atlas.cellWidth === 48 ? 34 : Math.floor(atlas.cellWidth / 2),
        y: atlas.cellHeight === 64 ? 38 : Math.floor(atlas.cellHeight / 2),
      },
    };
  }

  #optionalLayer(
    clipId: string,
    frameIndex: number,
    facing: ProductionFacing,
    atlasId: string,
    frame: NativeFrameRef | undefined,
  ): ResolvedLayer {
    if (!frame || !this.#manifest.atlases[atlasId] || !this.#leases.has(atlasId)) {
      return {
        snapshot: { clipId, frameIndex, facing, fallback: false },
        atlasId,
        frame: undefined,
        visible: false,
      };
    }
    return {
      snapshot: { clipId, frameIndex, facing, fallback: false },
      atlasId,
      frame,
      visible: true,
    };
  }

  #hairPhase(bodyFrameIndex: number): number {
    switch (this.#bodyAction) {
      case "walk":
      case "run":
        return 2 + bodyFrameIndex % 2;
      case "work":
      case "reach-give":
        return 4;
      case "hurt-fall":
      case "prone":
      case "dead":
        return 5;
      default:
        return bodyFrameIndex % 2;
    }
  }

  #resolveLayers(): Record<HumanLayerId, ResolvedLayer> {
    if (this.#personMarker) {
      const marker = (layerId: HumanLayerId): ResolvedLayer => ({
        snapshot: {
          clipId: `person-marker:${this.#facing}`,
          frameIndex: 0,
          facing: this.#facing,
          fallback: true,
        },
        atlasId: "",
        frame: undefined,
        visible: layerId === "body",
      });
      return {
        body: marker("body"),
        clothing: marker("clothing"),
        face: marker("face"),
        hair: marker("hair"),
        held: marker("held"),
        status: marker("status"),
      };
    }
    const body = this.#bodyFrame();
    const facing = this.#facing;
    const bodyLayer: ResolvedLayer = {
      snapshot: { clipId: body.clip.id, frameIndex: body.frameIndex, facing, fallback: false },
      atlasId: body.frame.atlasId,
      frame: body.frame,
      visible: true,
    };

    const facePlane = this.#manifest.human.rigs[this.#appearance.rig]
      .facePlanes[facing]?.[this.#visibleExpression()];
    const faceAtlas = this.#manifest.human.layerAtlases.face;
    const face = this.#optionalLayer(
      `${this.#appearance.rig}:${facing}:${this.#visibleExpression()}`,
      0,
      facing,
      faceAtlas,
      facePlane?.frame,
    );

    const hairAtlas = this.#manifest.human.layerAtlases.hair;
    const hairSilhouette = this.#manifest.human.hairSilhouettes.indexOf(this.#appearance.hairSilhouette);
    const facingIndex = PRODUCTION_FACINGS.indexOf(facing);
    const hairPhase = this.#hairPhase(body.frameIndex);
    const hairCell = hairSilhouette * 24 + facingIndex * 6 + hairPhase;
    const hairFrame = hairSilhouette < 0
      ? undefined
      : this.#nativeFrame(
          hairAtlas,
          hairCell,
          160,
          PRODUCTION_DIRECTIONAL_FACE_ANCHORS[facing],
        );
    const hair = this.#optionalLayer(
      `${this.#appearance.hairSilhouette}:${facing}:${hairPhase}`,
      hairPhase,
      facing,
      hairAtlas,
      hairFrame,
    );

    const clothingAtlas = this.#manifest.human
      .clothingAtlasBySilhouette[this.#appearance.clothingSilhouette];
    const bodyAtlas = this.#manifest.atlases[body.frame.atlasId]!;
    const bodyCell = Math.floor(body.frame.rect.y / bodyAtlas.cellHeight) * bodyAtlas.columns
      + Math.floor(body.frame.rect.x / bodyAtlas.cellWidth);
    const clothingCell = bodyCell % 172;
    const clothingFrame = clothingAtlas ? this.#nativeFrame(clothingAtlas, clothingCell) : undefined;
    const clothing = this.#optionalLayer(
      `${this.#appearance.clothingSilhouette}:${this.#bodyAction}:${facing}`,
      body.frameIndex,
      facing,
      clothingAtlas ?? "",
      clothingFrame,
    );

    const heldAtlas = this.#manifest.human.layerAtlases.held;
    const requestedHeldForm = this.#heldId ?? "none";
    const heldForm = this.#manifest.human.heldFrames[requestedHeldForm] ? requestedHeldForm : "none";
    const heldFormIndex = this.#manifest.human.heldForms.indexOf(heldForm);
    const heldFrame = heldForm === "none"
      ? undefined
      : this.#manifest.human.heldFrames[heldForm]?.[facing];
    const held = heldForm === "none"
      ? {
          snapshot: {
            clipId: `none:${facing}`,
            frameIndex: Math.max(0, heldFormIndex),
            facing,
            fallback: false,
          },
          atlasId: heldAtlas,
          frame: undefined,
          visible: false,
        }
      : this.#optionalLayer(
          `${heldForm}:${facing}`,
          Math.max(0, heldFormIndex),
          facing,
          heldAtlas,
          heldFrame,
        );

    const statusAtlas = this.#manifest.human.layerAtlases.status;
    const statusId = this.#status === "dead"
      ? "dead"
      : this.#status === "paralyzed"
        ? "paralyzed"
        : this.#selected
          ? "selected"
          : null;
    let status: ResolvedLayer;
    if (!this.#manifest.atlases[statusAtlas] || !this.#leases.has(statusAtlas)) {
      status = {
        snapshot: {
          clipId: `${statusId ?? "alive"}:${facing}`,
          frameIndex: 0,
          facing,
          fallback: false,
        },
        atlasId: statusAtlas,
        frame: undefined,
        visible: false,
      };
    } else if (statusId === null) {
      status = {
        snapshot: { clipId: `alive:${facing}`, frameIndex: 0, facing, fallback: false },
        atlasId: statusAtlas,
        frame: undefined,
        visible: false,
      };
    } else {
      const statusFrame = this.#manifest.human.statusFrames[statusId];
      status = this.#optionalLayer(
        `${statusId}:${facing}`,
        ["selected", "paralyzed", "dead"].indexOf(statusId),
        facing,
        statusAtlas,
        statusFrame,
      );
    }

    return { body: bodyLayer, face, hair, clothing, held, status };
  }
}
