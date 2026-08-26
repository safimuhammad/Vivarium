/// <reference types="vite/client" />
/**
 * @fileoverview `SpriteSheetHumanActor` — whole-pose sprite-sheet human
 * actor: locomotion, pose grammar, and deterministic per-being palette.
 *
 * Replaces `LayeredHumanActor`'s runtime layer-composition approach with a
 * single blitted frame from the approved chibi villager atlas
 * (`beingChibiAtlas.ts`). This file covers the locomotion/scheduling heart
 * of the actor (distance-driven stride, facing, fallback-reposition fade,
 * deadline scheduling), faithful storage of every command the renderer
 * grammar issues, and the pose grammar itself: talk/reach/work alternate
 * or hold on the atlas's named pose frames (kneel and gather hold their own
 * dedicated `pose-kneel`/`pose-crouch` frames statically), and hurt/fall/
 * prone/dead/recover are rendered as rotation + tint overlays on the
 * ordinary standing frame (the atlas has no dedicated fallen sprite).
 * Per-being garment recoloring is delegated to `beingPalette.ts`.
 */

import type { Vec2 } from "../../contracts";
import {
  PRODUCTION_FACINGS,
  requireHumanClip,
  type HumanBodyAction,
  type HumanExpression,
  type ProductionAssetLease,
  type ProductionAssetManifest,
  type ProductionFacing,
  type ProductionRigId,
} from "../assets/productionManifest";
import { decideAssetFallback } from "../failurePolicy";
import { deriveHumanAppearance, type HumanAppearance } from "./appearance";
import {
  createPaletteVariantSource,
  resolveBeingPaletteVariant,
  type BeingPaletteVariant,
} from "./beingPalette";
import {
  BEING_CHIBI_ATLAS_ID,
  beingChibiFrameRect,
  beingChibiIdleStrideIndex,
  beingChibiWalkCycle,
  BEING_CHIBI_GEOMETRY,
  DEFAULT_BEING_CHARACTER_ID,
  type BeingCharacterId,
  type BeingChibiWalkDirection,
} from "./beingChibiAtlas";
import type {
  HumanPrimitiveCommand,
  HumanRepositionReason,
  HumanSemanticAction,
  LayeredHumanActorOptions,
  LayeredHumanLayerSnapshot,
  LayeredHumanSnapshot,
  ProductionActorSignal,
} from "./LayeredHumanActor";
import type { ProductionHumanActor } from "./ProductionHumanActor";

/**
 * `HumanBodyAction` minus the locomotion/orientation-internal states, plus
 * `kneel`/`gather` — the two chibi-atlas pose-grammar verbs this actor
 * renders from the `pose-kneel`/`pose-crouch` frames (`being-chibi.json`)
 * with no equivalent in the packed layered-rig atlas. Mirrors
 * `LayeredHumanActor`'s private alias.
 */
type PlayableBodyAction = Exclude<HumanBodyAction, "idle" | "walk" | "run" | "turn" | "stop">
  | "kneel"
  | "gather";

type SpriteHumanStatus = "alive" | "paralyzed" | "dead";

/** Frames the walk cycle steps through per world pixel travelled. Verbatim per the Task 3 brief. */
const WALK_STRIDE_PX = 9;
const WALK_CYCLE_LENGTH = 4;
/**
 * The stride index that represents the idle "passing" pose, derived from
 * `being-chibi.json`'s own `idleFrame` (see `beingChibiIdleStrideIndex`)
 * rather than a duplicated literal — so a future re-pack that moves the
 * idle convention off frame 1 is picked up automatically instead of
 * silently drifting from a hardcoded constant here.
 */
const IDLE_STRIDE_INDEX = beingChibiIdleStrideIndex();
const WALKING_DEADLINE_MS = 1_000 / 30;
const MIN_BLINK_INTERVAL_MS = 3_000;
const BLINK_INTERVAL_SPAN_MS = 4_001;
const FALLBACK_FADE_PHASE_MS = 180;
const FALLBACK_FADE_FRAME_MS = 1_000 / 60;
const MAX_TRANSIENT_OFFSET_PX = 8;
/**
 * Fallback turn-commit duration used only if the manifest's `turn` clip is
 * ever unavailable (`turnCommitDurationMs` below always prefers the live
 * manifest clip — the same one `LayeredHumanActor#currentBodyClip` reads —
 * which today is `ACTION_FRAME_COUNTS.turn = 2` frames
 * (`productionManifest.ts:333`) at 120ms/frame = 240ms). This is a defensive
 * floor only, not the primary source of truth.
 */
const TURN_COMMIT_FALLBACK_MS = 320;
const EPSILON = 1e-9;
const REPOSITION_REASONS = new Set<HumanRepositionReason>([
  "reduced-motion",
  "fallback",
  "region-transition",
  "distance-cut",
  "conversation-flash",
]);
/**
 * The reasons performed as a vanish-and-appear fade rather than an instant placement.
 *
 * Mirrors `LayeredHumanActor.ts`'s identical set — see `HumanRepositionReason`
 * for why `conversation-flash` is in it: a flash step is the one reposition
 * authored to be watched, so it must not read as a dropped frame.
 */
const FADED_REPOSITION_REASONS = new Set<HumanRepositionReason>([
  "fallback",
  "conversation-flash",
]);

/**
 * Pose-grammar timing/visual constants. Values are adapted from the
 * approved pilot template's authored performances (the reference build
 * under `frontend/scripts/character-pipeline/`,
 * `PERFS.talk/build/hurt/fall/prone/rescue/dead`) rather than copied
 * verbatim frame-for-frame — this actor blits one pose sprite per draw
 * instead of the pilot's continuous per-frame `tick` callbacks, so each
 * curve is re-expressed as a closed-form function of elapsed time.
 */
const BLINK_VISIBLE_MS = 150;
const TALK_ALTERNATE_MS = 200;
const WORK_ALTERNATE_MS = 1_000 / 3;
/** Redraw cadence for a bounded pose-transform animation in progress (hurt stagger, fall ease, recovery ease, prone pulse). */
const POSE_ANIMATION_TICK_MS = WALKING_DEADLINE_MS;
const BREATH_SCALE_AMPLITUDE = 0.012;
const BREATH_FREQUENCY_RAD_PER_MS = 2.2 / 1_000;
const HURT_TINT_MAX_ALPHA = 0.5;
const HURT_TINT_DECAY_MS = 500;
const HURT_ROTATION_AMPLITUDE = 0.09;
const HURT_ROTATION_FREQUENCY_RAD_PER_MS = 14 / 1_000;
const HURT_ROTATION_DURATION_MS = 1_200;
const FALL_ROTATION_DURATION_MS = 550;
const PRONE_TINT = "rgba(60,60,80,0.35)";
const PRONE_ALPHA_BASE = 0.88;
const PRONE_ALPHA_AMPLITUDE = 0.1;
const PRONE_ALPHA_FREQUENCY_RAD_PER_MS = 1.8 / 1_000;
const RECOVER_ROTATION_DURATION_MS = 900;
/** The shared "lying flat at the feet anchor" rotation both dead and settled-prone bodies rest at. */
const FALLEN_ROTATION = Math.PI / 2;
const DEAD_TINT = "rgba(30,25,20,0.55)";

/** Resolved rotation/tint/alpha overlay for one draw, on top of the selected sprite frame. */
interface PoseTransform {
  readonly rotation: number;
  readonly tint: string | null;
  readonly alphaMultiplier: number;
}

const IDENTITY_POSE_TRANSFORM: PoseTransform = Object.freeze({ rotation: 0, tint: null, alphaMultiplier: 1 });

function hurtTintColor(alpha: number): string {
  return `rgba(196,44,28,${alpha.toFixed(3)})`;
}

/** One shared offscreen scratch canvas every actor instance composites its tint overlay onto. */
let tintScratch: HTMLCanvasElement | null = null;

/**
 * Lazily create (once, process-wide) the offscreen canvas used to
 * pre-composite a hurt/paralyzed/dead tint onto an isolated copy of the
 * current sprite frame before blitting it to the real destination context —
 * mirroring the approved pilot's singleton `scratch`/`scx` canvas.
 *
 * A shared singleton is safe here because tinting is fully synchronous
 * within one `draw()` call (draw the untinted frame in, `source-atop` the
 * tint fill, then immediately consume the result) — no actor's draw can
 * interleave with another's mid-composite. Applying the tint fill directly
 * to the real destination context instead would incorrectly stain whatever
 * was already painted behind the actor (terrain, other actors), since
 * `source-atop` composites against *all* existing opaque destination
 * pixels, not just this sprite's own silhouette.
 */
function tintScratchCanvas(): HTMLCanvasElement {
  if (tintScratch === null) {
    tintScratch = document.createElement("canvas");
    tintScratch.width = BEING_CHIBI_GEOMETRY.frameWidth;
    tintScratch.height = BEING_CHIBI_GEOMETRY.frameHeight;
  }
  return tintScratch;
}

let nextInstanceId = 1;

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
  /**
   * When true, completing the `"fade-out"` phase does NOT auto-advance to
   * `"fade-in"` the way an ordinary presentation-fallback teleport does —
   * the actor instead holds at zero opacity, in place, indefinitely, until
   * something explicitly calls {@link SpriteSheetHumanActor.beginPresenceReveal}
   * or an ordinary command supersedes it (`#supersedeFallbackReposition`,
   * already called by every move/orient/status/death/paralysis path).
   * Backs the door-anchored home-interaction "duck inside" motion contract
   * (see `beginPresenceVanish`'s doc comment); never set by the ordinary
   * `"reposition"`/`"fallback"` primitive command.
   */
  readonly sustained: boolean;
}

function finitePoint(point: Vec2): boolean {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
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

function walkDirectionForFacing(facing: ProductionFacing): BeingChibiWalkDirection {
  if (facing === "south") return "down";
  if (facing === "north") return "up";
  return "side";
}

/**
 * Real turn-commit duration for one facing change, read from the same
 * manifest `turn` clip `LayeredHumanActor#currentBodyClip` reads (summing
 * its frames' `durationMs`), so this actor's choreography-arrival timing
 * stays in parity with `LayeredHumanActor` automatically as the manifest
 * evolves. Falls back to {@link TURN_COMMIT_FALLBACK_MS} only if the clip is
 * ever unavailable.
 */
function turnCommitDurationMs(
  manifest: ProductionAssetManifest,
  rig: ProductionRigId,
  facing: ProductionFacing,
): number {
  try {
    const turnClip = requireHumanClip(manifest, rig, "turn", facing);
    const duration = turnClip.frames.reduce((sum, clipFrame) => sum + clipFrame.durationMs, 0);
    return duration > 0 ? duration : TURN_COMMIT_FALLBACK_MS;
  } catch {
    return TURN_COMMIT_FALLBACK_MS;
  }
}

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

/** FNV-1a hash of an agent id; the sole seed for this actor's deterministic idle micro-timing. */
function hashAgentId(id: string): number {
  let hash = 2_166_136_261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

/**
 * Pure, deterministic next-blink deadline: a function of the agent id and
 * how many blinks have already elapsed, never of wall-clock time or
 * `Math.random`. Reproducible per-agent phase, matching every other
 * determinism seam in this codebase.
 */
function blinkDeadlineAfter(id: string, blinkIndex: number, afterMs: number): number {
  const seed = (hashAgentId(id) ^ Math.imul(blinkIndex + 1, 0x9e3779b1)) >>> 0;
  const span = seed % BLINK_INTERVAL_SPAN_MS;
  return afterMs + MIN_BLINK_INTERVAL_MS + span;
}

/**
 * `LayeredHumanActorOptions` plus the one field only the roster-aware
 * sprite-sheet actor understands. Extended locally (rather than adding
 * `characterId` to the shared `LayeredHumanActorOptions` interface itself)
 * so `LayeredHumanActor` — which has no concept of the chibi roster —
 * stays untouched.
 */
export interface SpriteSheetHumanActorOptions extends LayeredHumanActorOptions {
  /**
   * Which packed roster character this being's sprite is drawn from.
   * Defaults to {@link DEFAULT_BEING_CHARACTER_ID} (`"m1"`, the shipped
   * base) when omitted — the roster-context-free default every
   * pre-roster-integration construction (including every existing actor
   * test) relies on for zero behavioral/visual change. Production spawn
   * code resolves this deterministically per agent via
   * `resolveBeingCharacter(appearance)` (`beingChibiAtlas.ts`) and passes
   * it explicitly; this actor never resolves it on its own.
   */
  readonly characterId?: BeingCharacterId;
}

/**
 * Sprite-sheet-backed production human actor.
 *
 * A concrete `ProductionHumanActor` painting one blitted frame from the
 * `core-being-chibi` atlas per draw, feet-anchored, mirroring the side
 * sheet for west-facing via `scale(-1, 1)` around the feet pivot.
 */
export class SpriteSheetHumanActor implements ProductionHumanActor {
  readonly #id: string;
  readonly #instanceId: number;
  readonly #appearance: HumanAppearance;
  readonly #manifest: ProductionAssetManifest;
  readonly #leases: ReadonlyMap<string, ProductionAssetLease>;
  readonly #reducedMotion: boolean;
  readonly #artFallback: "person-marker" | null;
  /** This being's deterministic garment palette family, resolved once from its appearance (see `beingPalette.ts`). */
  readonly #paletteVariant: BeingPaletteVariant;
  /** Which packed roster character this being's sprite frames are read from (see `SpriteSheetHumanActorOptions.characterId`). */
  readonly #characterId: BeingCharacterId;

  #position: MutablePoint;
  #visualOffset: MutablePoint = { x: 0, y: 0 };
  #facing: ProductionFacing;
  #status: SpriteHumanStatus = "alive";
  #poseAction: PlayableBodyAction | null = null;
  #recovering = false;
  #faceExpression: HumanExpression = "neutral";
  #heldId: string | null = null;
  #selected = false;
  #route: Vec2[] = [];
  #routeIndex = 0;
  #speedPixelsPerSecond = 0;
  #gait: "walk" | "run" = "walk";
  #distanceTravelled = 0;
  /** Remaining hold time (ms) before locomotion may resume after a facing change. */
  #turnHoldRemainingMs = 0;
  /** `#lastNowMs` at which the current `#poseAction`/paralysis/recovery began — the elapsed-time zero point every pose-transform decay curve is measured from. */
  #poseStartMs = 0;
  #opacity = 1;
  #reposition: ActiveFallbackReposition | null = null;
  #lastNowMs = 0;
  #blinkIndex = 0;
  #nextBlinkMs: number;
  /** The `#nextBlinkMs` deadline most recently crossed, or `-Infinity` before the first blink ever triggers — the window `[#lastBlinkMs, #lastBlinkMs + BLINK_VISIBLE_MS)` is when `pose-blink` renders. */
  #lastBlinkMs = Number.NEGATIVE_INFINITY;
  #queuedSignals: ProductionActorSignal[] = [];
  #terminal = false;
  #disposed = false;

  constructor(options: SpriteSheetHumanActorOptions) {
    if (!finitePoint(options.position)) throw new TypeError("Sprite human position must be finite.");
    if (!PRODUCTION_FACINGS.includes((options.facing ?? "south") as ProductionFacing)) {
      throw new TypeError("Sprite human facing must be cardinal.");
    }
    this.#id = options.id;
    this.#instanceId = nextInstanceId;
    nextInstanceId += 1;
    this.#appearance = options.appearance ?? deriveHumanAppearance(options.id, options.persona);
    this.#manifest = options.manifest;
    this.#leases = new Map(options.atlasLeases);
    this.#reducedMotion = options.reducedMotion ?? false;
    this.#position = copyMutablePoint(options.position);
    this.#facing = (options.facing ?? "south") as ProductionFacing;
    this.#nextBlinkMs = blinkDeadlineAfter(this.#id, 0, 0);
    this.#characterId = options.characterId ?? DEFAULT_BEING_CHARACTER_ID;
    this.#artFallback = this.#resolveArtFallback();
    this.#paletteVariant = resolveBeingPaletteVariant(this.#appearance, this.#characterId);
  }

  /**
   * Consult the shared asset-fallback policy (`decideAssetFallback`, the
   * same one `LayeredHumanActor#requiresPersonMarker` reads) rather than
   * unconditionally degrading to `"person-marker"` whenever the atlas lease
   * or manifest entry is missing — so a future policy change (or a
   * different failure disposition) is honored uniformly by both actors.
   */
  #resolveArtFallback(): "person-marker" | null {
    const missing = !this.#leases.has(BEING_CHIBI_ATLAS_ID)
      || this.#manifest.atlases[BEING_CHIBI_ATLAS_ID] === undefined;
    if (!missing) return null;
    const decision = decideAssetFallback({
      failure: "missing-character-art",
      subjectId: this.#id,
      regionId: null,
      occurrence: 1,
    });
    return decision.action === "continue" && decision.fallback === "person-silhouette"
      ? "person-marker"
      : null;
  }

  /** Atomically adopt a prepared scene position and return an idempotent transient-state rollback. */
  stagePosition(position: Vec2): (() => void) | null {
    if (this.#disposed || this.#terminal) return null;
    if (!finitePoint(position)) throw new TypeError("Sprite human staged position must be finite.");
    if (this.#status !== "alive") return null;
    const checkpoint = {
      position: copyMutablePoint(this.#position),
      visualOffset: copyMutablePoint(this.#visualOffset),
      route: this.#route.map(copyMutablePoint),
      routeIndex: this.#routeIndex,
      speedPixelsPerSecond: this.#speedPixelsPerSecond,
      poseAction: this.#poseAction,
      recovering: this.#recovering,
      turnHoldRemainingMs: this.#turnHoldRemainingMs,
      poseStartMs: this.#poseStartMs,
      opacity: this.#opacity,
      reposition: copyFallbackReposition(this.#reposition),
    };
    this.#supersedeFallbackReposition();
    this.#position = copyMutablePoint(position);
    this.#visualOffset = { x: 0, y: 0 };
    this.#route = [];
    this.#routeIndex = 0;
    this.#speedPixelsPerSecond = 0;
    this.#clearPose();
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
      this.#poseAction = checkpoint.poseAction;
      this.#recovering = checkpoint.recovering;
      this.#turnHoldRemainingMs = checkpoint.turnHoldRemainingMs;
      this.#poseStartMs = checkpoint.poseStartMs;
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

  /**
   * Begin fading this being to fully invisible in place (no position
   * change), holding at zero opacity indefinitely until
   * {@link beginPresenceReveal} or an ordinary command supersedes it.
   *
   * Out-of-band scene-graph method (mirrors {@link stagePosition}'s own
   * "extra surface beyond the primitive-command union" precedent), driven
   * by `ProductionSceneGraph.ts`'s `"presence-fade"` command — the
   * door-anchored home-interaction motion contract: a being walks to a
   * home's door on its own ordinary `"move"` command, then this call makes
   * it read as having gone *inside* for the duration of the interaction,
   * without any invented occupancy state (see `SpatialDirector.ts`'s file
   * header) — the vanish/reveal window is driven purely by the
   * choreography beat's own phase lifecycle.
   *
   * A no-op when disposed, terminal, or not currently alive (nothing to
   * fade) — matching every other transient-state method's guard.
   */
  beginPresenceVanish(): void {
    if (this.#disposed || this.#terminal || this.#status !== "alive") return;
    if (this.#reposition !== null && this.#reposition.sustained) return;
    this.#beginFallbackReposition(this.#position, true);
  }

  /**
   * Begin fading a {@link beginPresenceVanish}-held being back to fully
   * visible, in place. A no-op when the being is not currently held
   * invisible by a sustained presence-fade (nothing to reveal).
   */
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
      poseAction: this.#poseAction,
      faceExpression: this.#faceExpression,
      heldId: this.#heldId,
      status: this.#status,
      selected: this.#selected,
      route: this.#route.map(copyMutablePoint),
      routeIndex: this.#routeIndex,
      speedPixelsPerSecond: this.#speedPixelsPerSecond,
      gait: this.#gait,
      distanceTravelled: this.#distanceTravelled,
      turnHoldRemainingMs: this.#turnHoldRemainingMs,
      poseStartMs: this.#poseStartMs,
      lastNowMs: this.#lastNowMs,
      blinkIndex: this.#blinkIndex,
      nextBlinkMs: this.#nextBlinkMs,
      lastBlinkMs: this.#lastBlinkMs,
      queuedSignals: [...this.#queuedSignals],
      terminal: this.#terminal,
      recovering: this.#recovering,
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
      this.#poseAction = checkpoint.poseAction;
      this.#faceExpression = checkpoint.faceExpression;
      this.#heldId = checkpoint.heldId;
      this.#status = checkpoint.status;
      this.#selected = checkpoint.selected;
      this.#route = checkpoint.route;
      this.#routeIndex = checkpoint.routeIndex;
      this.#speedPixelsPerSecond = checkpoint.speedPixelsPerSecond;
      this.#gait = checkpoint.gait;
      this.#distanceTravelled = checkpoint.distanceTravelled;
      this.#turnHoldRemainingMs = checkpoint.turnHoldRemainingMs;
      this.#poseStartMs = checkpoint.poseStartMs;
      this.#lastNowMs = checkpoint.lastNowMs;
      this.#blinkIndex = checkpoint.blinkIndex;
      this.#nextBlinkMs = checkpoint.nextBlinkMs;
      this.#lastBlinkMs = checkpoint.lastBlinkMs;
      this.#queuedSignals = checkpoint.queuedSignals;
      this.#terminal = checkpoint.terminal;
      this.#recovering = checkpoint.recovering;
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
      throw new RangeError("Sprite human command time must be finite and monotonic.");
    }
    this.#lastNowMs = nowMs;
    this.#settleBlinkSchedule();
    if (this.#status === "paralyzed"
      && (command.kind === "move" || command.kind === "orient" || command.kind === "play-body")) {
      return;
    }
    switch (command.kind) {
      case "move": {
        if (!Number.isFinite(command.speedPixelsPerSecond) || command.speedPixelsPerSecond <= 0) {
          throw new RangeError("Sprite human movement speed must be positive and finite.");
        }
        if (!command.waypoints.every(finitePoint)) {
          throw new TypeError("Sprite human movement waypoints must be finite points.");
        }
        this.#supersedeFallbackReposition();
        this.#route = command.waypoints.map(copyPoint);
        this.#routeIndex = 0;
        this.#speedPixelsPerSecond = command.speedPixelsPerSecond;
        this.#gait = command.gait;
        this.#status = "alive";
        this.#clearPose();
        const firstTarget = this.#route[0];
        if (firstTarget !== undefined) {
          const desired = directionFor(this.#position, firstTarget, this.#facing);
          if (desired !== this.#facing) {
            this.#facing = desired;
            this.#turnHoldRemainingMs = this.#turnCommitMs(desired);
          }
        }
        return;
      }
      case "orient": {
        if (!PRODUCTION_FACINGS.includes(command.facing as ProductionFacing)) {
          throw new TypeError("Sprite human orient facing must be cardinal.");
        }
        this.#route = [];
        this.#routeIndex = 0;
        this.#speedPixelsPerSecond = 0;
        this.#turnHoldRemainingMs = 0;
        this.#facing = command.facing as ProductionFacing;
        return;
      }
      case "play-body": {
        this.#supersedeFallbackReposition();
        this.#route = [];
        this.#routeIndex = 0;
        this.#speedPixelsPerSecond = 0;
        this.#turnHoldRemainingMs = 0;
        if (command.action === "dead") {
          this.#becomeDead(nowMs);
          return;
        }
        if (command.action === "prone") {
          this.#becomeParalyzed(nowMs);
          return;
        }
        this.#status = "alive";
        this.#poseAction = command.action;
        this.#poseStartMs = nowMs;
        this.#recovering = false;
        return;
      }
      case "set-face":
        this.#faceExpression = command.expression;
        return;
      case "set-held":
        this.#heldId = command.heldId;
        return;
      case "set-status":
        this.#supersedeFallbackReposition();
        if (command.status === "dead") this.#becomeDead(nowMs);
        else if (command.status === "paralyzed") this.#becomeParalyzed(nowMs);
        else {
          this.#status = "alive";
          this.#clearPose();
        }
        return;
      case "recover":
        if (this.#status !== "paralyzed") return;
        this.#supersedeFallbackReposition();
        this.#status = "alive";
        this.#route = [];
        this.#routeIndex = 0;
        this.#speedPixelsPerSecond = 0;
        this.#turnHoldRemainingMs = 0;
        this.#heldId = null;
        this.#faceExpression = "recovery";
        this.#poseAction = "hurt-fall";
        this.#poseStartMs = nowMs;
        this.#recovering = true;
        return;
      case "reposition":
        if (!REPOSITION_REASONS.has(command.reason)) {
          throw new Error("Invalid sprite human reposition reason.");
        }
        if (!finitePoint(command.position)) {
          throw new TypeError("Sprite human reposition position must be finite.");
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
        if (!finitePoint(command.offset)) throw new TypeError("Sprite human visual offset must be finite.");
        if (Math.hypot(command.offset.x, command.offset.y) > MAX_TRANSIENT_OFFSET_PX) {
          throw new RangeError("Sprite human visual offset cannot exceed 8 pixels.");
        }
        if (this.#status !== "alive") return;
        this.#visualOffset = copyMutablePoint(command.offset);
        return;
      case "set-selected":
        this.#selected = command.selected;
        return;
      default: {
        const _exhaustive: never = command;
        if (import.meta.env.DEV) {
          throw new Error(`Unhandled sprite human command: ${JSON.stringify(_exhaustive)}`);
        }
        return;
      }
    }
  }

  advance(deltaSeconds: number, nowMs: number): readonly ProductionActorSignal[] {
    if (this.#disposed || this.#terminal) return [];
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0 || !Number.isFinite(nowMs)
      || nowMs < this.#lastNowMs) {
      throw new RangeError("Sprite human advance requires non-negative delta and monotonic finite time.");
    }
    this.#lastNowMs = nowMs;
    this.#settleBlinkSchedule();
    const signals = this.#queuedSignals.splice(0, this.#queuedSignals.length);
    const remainingMs = deltaSeconds * 1_000;

    if (this.#reposition !== null) {
      this.#advanceFallbackReposition(remainingMs, signals);
      return deepFreeze(signals);
    }
    if (this.#status === "alive") this.#advanceMovement(remainingMs, signals);
    return deepFreeze(signals);
  }

  draw(context: CanvasRenderingContext2D): void {
    if (this.#disposed) return;
    context.imageSmoothingEnabled = false;
    if (this.#artFallback !== null) return;
    const lease = this.#leases.get(BEING_CHIBI_ATLAS_ID);
    if (!lease) return;
    const frameName = this.#currentFrameName();
    const rect = beingChibiFrameRect(frameName, this.#characterId);
    const mirror = this.#facing === "west";
    const feetX = Math.round(this.#position.x + this.#visualOffset.x);
    const feetY = Math.round(this.#position.y + this.#visualOffset.y);
    const transform = this.#poseTransform();
    const breathScale = this.#breathingScale();
    const baseSource = this.#recoloredSource(lease.value);
    let source: CanvasImageSource = baseSource;
    let sourceX = rect.x;
    let sourceY = rect.y;
    if (transform.tint !== null) {
      const scratch = tintScratchCanvas();
      const scratchContext = scratch.getContext("2d");
      if (scratchContext !== null) {
        scratchContext.clearRect(0, 0, BEING_CHIBI_GEOMETRY.frameWidth, BEING_CHIBI_GEOMETRY.frameHeight);
        scratchContext.drawImage(
          baseSource,
          rect.x,
          rect.y,
          BEING_CHIBI_GEOMETRY.frameWidth,
          BEING_CHIBI_GEOMETRY.frameHeight,
          0,
          0,
          BEING_CHIBI_GEOMETRY.frameWidth,
          BEING_CHIBI_GEOMETRY.frameHeight,
        );
        scratchContext.globalCompositeOperation = "source-atop";
        scratchContext.fillStyle = transform.tint;
        scratchContext.fillRect(0, 0, BEING_CHIBI_GEOMETRY.frameWidth, BEING_CHIBI_GEOMETRY.frameHeight);
        scratchContext.globalCompositeOperation = "source-over";
        source = scratch;
        sourceX = 0;
        sourceY = 0;
      }
    }
    context.save();
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = this.#opacity * transform.alphaMultiplier;
    context.translate(feetX, feetY);
    context.rotate(transform.rotation);
    context.scale((mirror ? -1 : 1) * breathScale, breathScale);
    context.drawImage(
      source,
      sourceX,
      sourceY,
      BEING_CHIBI_GEOMETRY.frameWidth,
      BEING_CHIBI_GEOMETRY.frameHeight,
      -BEING_CHIBI_GEOMETRY.feet.x,
      -BEING_CHIBI_GEOMETRY.feet.y,
      BEING_CHIBI_GEOMETRY.frameWidth,
      BEING_CHIBI_GEOMETRY.frameHeight,
    );
    context.restore();
    context.imageSmoothingEnabled = false;
  }

  snapshot(): LayeredHumanSnapshot {
    const frameName = this.#currentFrameName();
    const index = this.#currentStrideIndex();
    const singleLayer: LayeredHumanLayerSnapshot = {
      clipId: this.#selected ? `${frameName}:selected` : frameName,
      frameIndex: index,
      facing: this.#facing,
      fallback: this.#artFallback !== null,
    };
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
      stridePhase: index,
      terminal: this.#terminal,
      routeActive: this.#routeActive(),
      opacity: this.#opacity,
      reposition: this.#reposition === null ? null : {
        phase: this.#reposition.phase,
        reason: "fallback",
        target: copyPoint(this.#reposition.target),
      },
      activeAction: this.#semanticAction(),
      artFallback: this.#artFallback,
      layers: {
        body: singleLayer,
        clothing: singleLayer,
        face: singleLayer,
        hair: singleLayer,
        held: singleLayer,
        status: singleLayer,
      },
    });
  }

  nextDeadlineMs(): number | null {
    if (this.#disposed || this.#terminal) return null;
    if (this.#reposition !== null) {
      const remaining = Math.max(0, FALLBACK_FADE_PHASE_MS - this.#reposition.elapsedMs);
      const candidate = this.#lastNowMs + Math.min(FALLBACK_FADE_FRAME_MS, remaining);
      return candidate > this.#lastNowMs ? candidate : null;
    }
    if (this.#isTurning()) {
      const candidate = this.#lastNowMs + this.#turnHoldRemainingMs;
      return candidate > this.#lastNowMs ? candidate : null;
    }
    if (this.#routeActive()) return this.#lastNowMs + WALKING_DEADLINE_MS;
    const poseDeadline = this.#poseVisualDeadlineMs();
    if (poseDeadline !== undefined) return poseDeadline;
    // The remaining static states — a steady `reach-give` pose, or
    // (defensively) any non-"alive" status not already claimed by
    // `#poseVisualDeadlineMs` above — have no animation timer: nothing
    // about their pose-transform changes over time.
    if (this.#status !== "alive" || this.#poseAction !== null) return null;
    if (this.#reducedMotion) return null;
    if (this.#isBlinking()) return this.#lastBlinkMs + BLINK_VISIBLE_MS;
    return this.#nextBlinkMs > this.#lastNowMs ? this.#nextBlinkMs : null;
  }

  /**
   * Redraw cadence owned by an actively time-varying pose transform (hurt
   * tint decay + rotation stagger, fall-ease-then-prone-pulse, recovery
   * rotation ease, work/talk pose alternation). Returns `undefined` when
   * the current semantic action owns no such timer, so the caller falls
   * through to the ordinary idle/blink scheduling below.
   *
   * The scene-graph contract (`ProductionHumanActor.nextDeadlineMs`)
   * requires a strictly-future deadline for as long as a visual is still
   * changing on its own — every branch here honors that for its state's
   * active window, matching {@link poseTransform}'s own duration constants.
   */
  #poseVisualDeadlineMs(): number | null | undefined {
    const action = this.#semanticAction();
    const elapsed = Math.max(0, this.#lastNowMs - this.#poseStartMs);
    switch (action) {
      case "hurt": {
        const remaining = Math.max(HURT_TINT_DECAY_MS, HURT_ROTATION_DURATION_MS) - elapsed;
        return remaining > EPSILON
          ? this.#lastNowMs + Math.min(remaining, POSE_ANIMATION_TICK_MS)
          : null;
      }
      case "prone": {
        if (elapsed < FALL_ROTATION_DURATION_MS) {
          return this.#lastNowMs + Math.min(FALL_ROTATION_DURATION_MS - elapsed, POSE_ANIMATION_TICK_MS);
        }
        // Settled prone: the alpha pulse animates for as long as paralysis lasts.
        return this.#lastNowMs + POSE_ANIMATION_TICK_MS;
      }
      case "recovering": {
        const remaining = RECOVER_ROTATION_DURATION_MS - elapsed;
        return remaining > EPSILON ? this.#lastNowMs + Math.min(remaining, POSE_ANIMATION_TICK_MS) : null;
      }
      case "speaking":
      case "working":
        return this.#lastNowMs + POSE_ANIMATION_TICK_MS;
      default:
        return undefined;
    }
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

  #clearPose(): void {
    this.#poseAction = null;
    this.#recovering = false;
    this.#turnHoldRemainingMs = 0;
    this.#poseStartMs = 0;
  }

  #routeActive(): boolean {
    return !this.#terminal
      && this.#status === "alive"
      && this.#speedPixelsPerSecond > 0
      && this.#routeIndex < this.#route.length;
  }

  #currentStrideIndex(): number {
    if (!this.#isWalking()) return IDLE_STRIDE_INDEX;
    return Math.floor(this.#distanceTravelled / WALK_STRIDE_PX) % WALK_CYCLE_LENGTH;
  }

  /**
   * The walk-cycle/idle-stance frame for the current facing and stride —
   * distance-driven while walking (`#currentStrideIndex`), the idle
   * "passing" frame otherwise. This is also the base standing frame every
   * rotated state (hurt/prone/recovering/dead) is drawn from, since the
   * atlas has no dedicated fallen sprite: those states rotate this same
   * frame around the feet anchor instead.
   */
  #locomotionFrame(): string {
    const cycle = beingChibiWalkCycle(walkDirectionForFacing(this.#facing), this.#characterId);
    const index = this.#currentStrideIndex() % cycle.length;
    return cycle[index]!;
  }

  /**
   * Resolve which atlas frame to blit for the being's current semantic
   * state — the pose-grammar frame dispatcher. Mirrors `#semanticAction`'s
   * own priority order exactly, since both derive from the same underlying
   * state machine: a state that reports as "speaking" (say) renders its
   * speaking frame regardless of what `#poseAction` happens to also hold.
   */
  #currentFrameName(): string {
    switch (this.#semanticAction()) {
      case "speaking":
        return this.#talkFrame();
      case "reaching":
        return "pose-reach";
      case "working":
        return this.#workFrame();
      case "kneeling":
        return "pose-kneel";
      case "gathering":
        return "pose-crouch";
      case null:
        return this.#idleFrame();
      // "moving" / "orienting" use the ordinary walk cycle; "hurt" / "prone"
      // / "recovering" / "dead" have no dedicated pose sprite in the atlas —
      // they rotate this same standing frame via `#poseTransform` instead.
      default:
        return this.#locomotionFrame();
    }
  }

  /** `pose-talk` alternating with the idle stance at a per-agent deterministic cadence while speaking. */
  #talkFrame(): string {
    const phase = hashAgentId(this.#id) % TALK_ALTERNATE_MS;
    const toggle = Math.floor((this.#lastNowMs + phase) / TALK_ALTERNATE_MS) % 2;
    return toggle === 0 ? this.#locomotionFrame() : "pose-talk";
  }

  /** `pose-crouch` alternating with `pose-reach` at a per-agent deterministic cadence while working. */
  #workFrame(): string {
    const phase = hashAgentId(this.#id) % WORK_ALTERNATE_MS;
    const toggle = Math.floor((this.#lastNowMs + phase) / WORK_ALTERNATE_MS) % 2;
    return toggle === 0 ? "pose-crouch" : "pose-reach";
  }

  /** The idle stance, swapped briefly for `pose-blink` during a scheduled blink window (never under `reducedMotion`). */
  #idleFrame(): string {
    if (!this.#reducedMotion && this.#isBlinking()) return "pose-blink";
    return this.#locomotionFrame();
  }

  #isBlinking(): boolean {
    return this.#lastNowMs >= this.#lastBlinkMs && this.#lastNowMs < this.#lastBlinkMs + BLINK_VISIBLE_MS;
  }

  /**
   * Breathing scale applied only while truly idle (no active pose, not
   * moving/orienting/talking) and not `reducedMotion`: a subtle ±1.2% sine
   * modulation of `context.scale`, deliberately anchored to `#lastNowMs`
   * alone (no per-agent phase offset) so it evaluates to exactly `1` at
   * `#lastNowMs === 0` — keeping a freshly constructed, never-advanced
   * actor's draw output pixel-identical to before this behavior existed.
   */
  #breathingScale(): number {
    if (this.#reducedMotion || this.#semanticAction() !== null) return 1;
    return 1 + Math.sin(this.#lastNowMs * BREATH_FREQUENCY_RAD_PER_MS) * BREATH_SCALE_AMPLITUDE;
  }

  /**
   * Resolve the rotation/tint/alpha overlay for the current semantic
   * action, layered on top of whichever sprite frame `#currentFrameName`
   * selected. Every curve is a pure function of `#lastNowMs - #poseStartMs`
   * (never wall-clock time), so it is fully deterministic and replayable.
   *
   * "dead" is rendered statically (no easing): once `#terminal` is set,
   * `apply`/`advance` both short-circuit and `#lastNowMs` can never advance
   * again, so an elapsed-time-based ease-in would freeze at its very first
   * frame forever rather than reaching its resting pose.
   */
  #poseTransform(): PoseTransform {
    const action = this.#semanticAction();
    const elapsed = Math.max(0, this.#lastNowMs - this.#poseStartMs);
    switch (action) {
      case "dead":
        return { rotation: FALLEN_ROTATION, tint: DEAD_TINT, alphaMultiplier: 1 };
      case "recovering": {
        const u = Math.min(1, elapsed / RECOVER_ROTATION_DURATION_MS);
        return { rotation: FALLEN_ROTATION * (1 - u), tint: null, alphaMultiplier: 1 };
      }
      case "prone": {
        if (elapsed < FALL_ROTATION_DURATION_MS) {
          const u = elapsed / FALL_ROTATION_DURATION_MS;
          return { rotation: u * u * FALLEN_ROTATION, tint: null, alphaMultiplier: 1 };
        }
        const phase = hashAgentId(this.#id) % 1_000;
        const pulse = PRONE_ALPHA_BASE
          + Math.sin((this.#lastNowMs + phase) * PRONE_ALPHA_FREQUENCY_RAD_PER_MS) * PRONE_ALPHA_AMPLITUDE;
        return { rotation: FALLEN_ROTATION, tint: PRONE_TINT, alphaMultiplier: pulse };
      }
      case "hurt": {
        const tintAlpha = elapsed < HURT_TINT_DECAY_MS
          ? HURT_TINT_MAX_ALPHA * (1 - elapsed / HURT_TINT_DECAY_MS)
          : 0;
        const rotation = elapsed < HURT_ROTATION_DURATION_MS
          ? Math.sin(elapsed * HURT_ROTATION_FREQUENCY_RAD_PER_MS) * HURT_ROTATION_AMPLITUDE
            * (1 - elapsed / HURT_ROTATION_DURATION_MS)
          : 0;
        return { rotation, tint: tintAlpha > 0 ? hurtTintColor(tintAlpha) : null, alphaMultiplier: 1 };
      }
      default:
        return IDENTITY_POSE_TRANSFORM;
    }
  }

  /**
   * Best-effort per-agent recolor of the base atlas bitmap via
   * `beingPalette.ts`. Falls back to the untouched base image if the
   * runtime source lacks real pixel dimensions (a minimal test double, or a
   * canvas-less environment) — recoloring is a cosmetic enhancement, never
   * a precondition for drawing at all.
   */
  #recoloredSource(base: CanvasImageSource): CanvasImageSource {
    try {
      return createPaletteVariantSource(base, this.#paletteVariant, this.#characterId);
    } catch {
      return base;
    }
  }

  #semanticAction(): HumanSemanticAction {
    if (this.#terminal) return "dead";
    if (this.#recovering) return "recovering";
    if (this.#status === "paralyzed") return "prone";
    if (this.#faceExpression === "talk-1" || this.#faceExpression === "talk-2") return "speaking";
    if (this.#isTurning()) return "orienting";
    if (this.#routeActive()) return "moving";
    switch (this.#poseAction) {
      case "reach-give":
        return "reaching";
      case "work":
        return "working";
      case "hurt-fall":
        return "hurt";
      case "prone":
        return "prone";
      case "dead":
        return "dead";
      case "kneel":
        return "kneeling";
      case "gather":
        return "gathering";
      case null:
        return null;
    }
  }

  #settleBlinkSchedule(): void {
    while (this.#lastNowMs >= this.#nextBlinkMs) {
      this.#lastBlinkMs = this.#nextBlinkMs;
      this.#blinkIndex += 1;
      this.#nextBlinkMs = blinkDeadlineAfter(this.#id, this.#blinkIndex, this.#nextBlinkMs);
    }
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
    this.#visualOffset = { x: 0, y: 0 };
    this.#clearPose();
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

  #advanceFallbackReposition(remainingMs: number, signals: ProductionActorSignal[]): void {
    const reposition = this.#reposition;
    if (reposition === null || remainingMs <= EPSILON) return;
    const availableMs = Math.max(0, FALLBACK_FADE_PHASE_MS - reposition.elapsedMs);
    reposition.elapsedMs += Math.min(remainingMs, availableMs);
    if (reposition.phase === "fade-out") {
      this.#opacity = Math.max(0, 1 - reposition.elapsedMs / FALLBACK_FADE_PHASE_MS);
      if (reposition.elapsedMs + EPSILON < FALLBACK_FADE_PHASE_MS) return;
      this.#opacity = 0;
      if (reposition.sustained) {
        // Presence-fade "vanish": hold invisible in place indefinitely --
        // do NOT teleport to `target` (it already equals the current
        // position for a vanish) or auto-advance to "fade-in". See
        // `beginPresenceVanish`/`beginPresenceReveal`.
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

  #becomeDead(nowMs: number): void {
    this.#supersedeFallbackReposition();
    this.#status = "dead";
    this.#terminal = true;
    this.#route = [];
    this.#routeIndex = 0;
    this.#speedPixelsPerSecond = 0;
    this.#turnHoldRemainingMs = 0;
    this.#heldId = null;
    this.#faceExpression = "hurt";
    this.#visualOffset = { x: 0, y: 0 };
    this.#poseAction = "dead";
    this.#poseStartMs = nowMs;
    this.#recovering = false;
  }

  #becomeParalyzed(nowMs: number): void {
    this.#supersedeFallbackReposition();
    this.#status = "paralyzed";
    this.#route = [];
    this.#routeIndex = 0;
    this.#speedPixelsPerSecond = 0;
    this.#turnHoldRemainingMs = 0;
    this.#heldId = null;
    this.#faceExpression = "hurt";
    this.#visualOffset = { x: 0, y: 0 };
    this.#poseAction = "prone";
    this.#poseStartMs = nowMs;
    this.#recovering = false;
  }

  /**
   * Turn-commit hold for a facing change; 0 under `reducedMotion` (commits
   * synchronously, no hold).
   *
   * INTENTIONAL a11y divergence from `LayeredHumanActor`: here,
   * `reducedMotion` skips the hold entirely for *both* a standalone
   * `orient` command and a move-triggered mid-route facing change alike.
   * That is broader than the reference — `LayeredHumanActor` only skips its
   * turn hold under `reducedMotion` for the standalone `orient` command;
   * a move-triggered turn there (`#prepareMovementSegment` → `#startTurn`)
   * never consults `#reducedMotion` at all and still pays the full `turn`
   * clip duration (240ms today) even under reduced motion. This actor
   * chose the simpler, more permissive rule — reduced motion means no
   * turn-hold stalls, full stop — rather than replicating that asymmetry.
   */
  #turnCommitMs(desired: ProductionFacing): number {
    if (this.#reducedMotion) return 0;
    return turnCommitDurationMs(this.#manifest, this.#appearance.rig, desired);
  }

  #isTurning(): boolean {
    return this.#turnHoldRemainingMs > EPSILON;
  }

  #isWalking(): boolean {
    return this.#routeActive() && !this.#isTurning();
  }

  #advanceMovement(remainingMsInput: number, signals: ProductionActorSignal[]): void {
    let remainingMs = remainingMsInput;
    if (this.#speedPixelsPerSecond <= 0 || this.#routeIndex >= this.#route.length) return;

    if (this.#turnHoldRemainingMs > EPSILON) {
      const consumed = Math.min(remainingMs, this.#turnHoldRemainingMs);
      this.#turnHoldRemainingMs = Math.max(0, this.#turnHoldRemainingMs - consumed);
      // Orientation boundary: never spend leftover frame time on displacement
      // in the tick a turn hold is still resolving (or just completed),
      // mirroring LayeredHumanActor's turn-completion contract — the next
      // advance() starts locomotion moving-to-moving.
      return;
    }

    while (remainingMs > EPSILON && this.#routeIndex < this.#route.length) {
      const target = this.#route[this.#routeIndex]!;
      const desired = directionFor(this.#position, target, this.#facing);
      if (desired !== this.#facing) {
        this.#facing = desired;
        const holdMs = this.#turnCommitMs(desired);
        if (holdMs > EPSILON) {
          this.#turnHoldRemainingMs = holdMs;
          return;
        }
        // reducedMotion: commits synchronously — no stall, reuse this tick's
        // remaining time for locomotion instead of losing a frame to a
        // zero-length hold.
        continue;
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
      this.#position.x += dx / segmentDistance * travelled;
      this.#position.y += dy / segmentDistance * travelled;
      this.#distanceTravelled += travelled;
      remainingMs = Math.max(0, remainingMs - travelled / this.#speedPixelsPerSecond * 1_000);
      if (travelled + EPSILON < segmentDistance) return;
      this.#position = copyMutablePoint(target);
      this.#routeIndex += 1;
    }
    if (this.#routeIndex >= this.#route.length && this.#route.length > 0) {
      this.#finishRoute(signals);
    }
  }

  #finishRoute(signals: ProductionActorSignal[]): void {
    this.#route = [];
    this.#routeIndex = 0;
    this.#speedPixelsPerSecond = 0;
    signals.push(deepFreeze({ kind: "arrived", actorId: this.#id, position: copyPoint(this.#position) }));
  }
}
