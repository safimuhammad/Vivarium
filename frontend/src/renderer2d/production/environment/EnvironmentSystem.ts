import type {
  OverlayFamily,
  OverlayGlyph,
  OverlayTier,
} from "../../../presentation/eventLegibilityMap";
import { OVERLAY_TIER_HOLD_MS, OVERLAY_TIER_RANK } from "../../../presentation/eventLegibilityMap";
import type { Rect, Vec2 } from "../../contracts";
import {
  type NativeFrameRef,
  type ProductionAssetLease,
  type ProductionAssetManifest,
} from "../assets/productionManifest";
import {
  conditionPresentation,
  type AnimatedEnvironmentKind,
  type BiomeKit,
  type RegionKitId,
} from "../maps/biomeKits";
import type { RegionCondition } from "../maps/RegionMapIdentity";
import {
  cloneTrustedRegionMapRecipe,
  type AnimatedEnvironmentPlacement,
  type RegionMapRecipeV1,
} from "../maps/RegionMapRecipe";
import {
  bubbleScale,
  buildBurst,
  buildCap,
  buildGather,
  buildMark,
  buildPip,
  buildStud,
  buildTextBubble,
  layoutMessage,
  messageColumns,
  OVERLAY_FAMILY_ACCENT,
  OVERLAY_PALETTE,
  PixelSurface,
  TEXT_KIND_METRICS,
  TEXT_ZOOM_THRESHOLD,
  textBubbleScale,
  type MessageLayout,
  type TextBubbleKind,
} from "./bubbleGrammar";

export interface EnvironmentEffectLabel {
  readonly recipientId: string;
  readonly value: string;
}

/**
 * The three text silhouettes of the legibility grammar
 * (`docs/frontend/BUBBLE_UI.md` §3): a solid balloon spoken aloud, a dashed
 * balloon whispered at someone, a scalloped cloud thought privately.
 */
export type SpeechBubbleVariant = TextBubbleKind;

/** Icon glyph carried by a `flying-item` in flight. */
export type CarriableIconKind = "energy" | "materials" | "loot" | "gift";

/**
 * A dotted aim-thread from a mark to a receiver cap above whoever the event was
 * aimed at, so "who it happened to" never needs a label. `severed` halts the
 * thread at 55% and strikes it through with two cut-ticks: a refusal is a bond
 * that stops, not a gift with a different word attached.
 */
export interface OverlayThread {
  readonly to: Vec2;
  /** The being or structure aimed at, so the cap follows them while they move. */
  readonly toId?: string;
  readonly mode: "aim" | "severed";
  /** Family accent — the colour of a severed thread's cut-ticks. */
  readonly accent: string;
  /** The receiver's own identity hue, which cores their cap. */
  readonly hue: string;
}

export type EnvironmentEffectRequest =
  | Readonly<{ kind: "footstep"; at: Vec2; tint: string; label?: EnvironmentEffectLabel }>
  | Readonly<{ kind: "smoke" | "ember" | "dust"; at: Vec2; tint: string; label?: EnvironmentEffectLabel }>
  | Readonly<{
      kind: "speech-bubble";
      at: Vec2;
      /** The speaking being; a new bubble for the same being replaces their prior one. */
      speakerId: string;
      variant: SpeechBubbleVariant;
      /** Verbatim event-payload `message`. Shown in FULL, never rewritten. */
      text: string;
      /** Tail lean in world px toward the addressee; clamped to ±14 at build time. */
      tailLean: number;
      /** The speaker's identity hue, which fills the tail. */
      hue: string;
      /** This bubble's family accent. */
      accent: string;
      tier: OverlayTier;
      /** Aim-thread + receiver cap, for a whisper or any addressed line. */
      thread?: OverlayThread;
      /**
       * The being this line was addressed to, when the payload named one.
       *
       * Drives the bubble's opening `to <name>` tag and keeps the bubble off the
       * addressee's own body. Undirected speech and private self-talk leave both
       * undefined — nothing about an audience is ever inferred.
       */
      targetId?: string;
      /** Public display name of {@link targetId}, already scrubbed for public copy. */
      targetName?: string;
    }>
  | Readonly<{
      kind: "event-mark";
      at: Vec2;
      /** The being or home this banner is planted on; one live mark per owner. */
      ownerId: string;
      glyph: OverlayGlyph;
      family: OverlayFamily;
      tier: OverlayTier;
      /** Exact number or short word from the payload. Never invented. */
      micro?: string;
      threads?: readonly OverlayThread[];
    }>
  | Readonly<{
      kind: "event-burst";
      /** Centre of the affected thing — a victim's torso, a breached wall. */
      at: Vec2;
      glyph: OverlayGlyph;
      family: OverlayFamily;
      /** Ink field, bone glyph. Death and home collapse only. */
      invert?: boolean;
      /** The wider, 9-spike star: birth, the one *light* knell. */
      light?: boolean;
    }>
  | Readonly<{
      kind: "event-gather";
      at: Vec2;
      /** The being visibly producing something; replaced by their resolved form. */
      ownerId: string;
    }>
  | Readonly<{
      kind: "flying-item";
      /** Departure point (leaves the giver/loser/home). */
      from: Vec2;
      /** Arrival point (reaches the receiver/gainer). */
      to: Vec2;
      icon: CarriableIconKind;
      label?: string;
    }>;

/**
 * The camera state the overlay pass needs to blit 1x chrome at an integer scale
 * in screen space.
 *
 * Passed explicitly rather than read back from the canvas CTM: `getTransform`
 * is available on no recording stub this renderer's tests use, and the
 * authoritative mapping during a draw is the renderer's own bounds-clamped
 * raster origin (`CanvasPresentationRenderer`), not the camera's unclamped one.
 * Omitting it draws the chrome in the ambient world space at scale 1, which is
 * what unit tests observe.
 */
export interface OverlayViewport {
  readonly zoom: number;
  readonly originX: number;
  readonly originY: number;
  /** Canvas size in CSS px. Bounds every bubble; omitted means "unbounded". */
  readonly width?: number;
  readonly height?: number;
  /** HUD chrome the overlay must stay clear of, in CSS px. */
  readonly insets?: Readonly<{ top: number; right: number; bottom: number; left: number }>;
}

export interface EnvironmentDiagnostics {
  readonly disposed: boolean;
  readonly kit: RegionKitId;
  readonly terrainFamily: BiomeKit["terrainFamily"];
  readonly vitality: number;
  readonly activeWater: number;
  readonly activeWind: number;
  readonly activeSmoke: number;
  readonly activeFootsteps: number;
  readonly activeEffects: number;
  readonly capacities: Readonly<{
    water: number;
    wind: number;
    smoke: number;
    footsteps: number;
  }>;
  readonly allocatedSlots: Readonly<{
    water: number;
    wind: number;
    smoke: number;
    footsteps: number;
  }>;
  readonly nextDeadlineMs: number | null;
  readonly droppedEffects: number;
  readonly suppressedEffects: number;
  readonly neutralDiagnostics: number;
  readonly activeBubbles: number;
  /**
   * Frame-draws of a bubble too large for the viewer's safe frame even at blit
   * scale 1, which is pinned to the frame's corner rather than cropped.
   *
   * Counted per draw, not per bubble, so it is a "how much of the run looked
   * like this" number rather than a bubble count. It is the one remaining way a
   * message can go partly unread, and it should stay at zero on any viewport a
   * human actually uses.
   */
  readonly overflowingBubbles: number;
  readonly activeMarkers: number;
  readonly activeBursts: number;
  readonly activeGathers: number;
  readonly activeFlyingItems: number;
  /** Residue pips currently lingering at beings' shoulders. */
  readonly activeResidue: number;
  readonly missingKinds: readonly AnimatedEnvironmentKind[];
  readonly missingAtlasIds: readonly string[];
  readonly resolvedKinds: readonly AnimatedEnvironmentKind[];
  readonly resolvedAtlasIds: readonly string[];
  readonly frameSignature: string;
  readonly phaseSignature: string;
  readonly effectSignature: string;
}

/**
 * The MINIMUM headroom the `smoke` pool keeps above the largest permanent ambient budget
 * any region declares, for transient smoke / ember / dust particles.
 *
 * 16 is carried forward from the pool's previous sizing, and it is a floor rather than a
 * measurement of demand — the honest measurement is that at the old capacity of 48 a
 * 100-particle burst on a 32-placement region seated 16 and DROPPED 52. The pool is now
 * far larger for a different reason (one region declares 320 ambient placements), so that
 * burst fits with room to spare; this constant exists so a future region raising its
 * ambient budget can never eat the transient layer entirely.
 */
export const TRANSIENT_SMOKE_SLOTS = 16;

/**
 * Fixed slot counts per ambient/effect pool.
 *
 * **The `smoke` pool is the one that is not a round number, and the reason is structural.**
 * `poolFor` routes BOTH `ember` and `smoke-anchor` here, and the `ash-waste` kit declares
 * exactly `["ember", "smoke-anchor"]` (`biomeKits.ts:163`) — so it is the one kit whose
 * ENTIRE animated environment competes for this single pool. Every other kit spreads its
 * kinds across `water` and `wind` and seats roughly 8-11 here.
 *
 * The pool has been sized wrong twice, both times silently, and both times the symptom was
 * invisible because `insertFirstEmpty` returns false and only a counter moves:
 *
 *  1. **16, against 32 placements.** Half of Nirvana West's fire never drew at all, and
 *     because the pool was then permanently full of ambient slots, every transient
 *     particle a being emitted in that region was dropped too, forever.
 *  2. **48, against a region that now declares 384.** Fixed here, and fixed so it cannot
 *     recur: the capacity is `MAX_EXACT_ANIMATED_ENVIRONMENT_BUDGET + TRANSIENT_SMOKE_SLOTS`,
 *     asserted against `RegionMapRecipe.ts`'s own budget table by this module's suite. A
 *     region that raises its budget without raising this fails a test instead of quietly
 *     dropping its own signature.
 *
 * **What the larger pool costs every OTHER region**, measured rather than assumed: 400
 * pointer-sized array entries (~3.2 KB) and 400 `if (!isAmbient(value)) continue`
 * iterations per air pass — sub-microsecond, against a `drawAmbientPool` whose real work
 * is 1.87 microseconds of `drawImage` per SEATED slot (measured in Chrome: 0.06 ms/frame
 * at 32 seated, 0.72 ms at 384, dead linear).
 */
export const ENVIRONMENT_POOL_CAPACITIES = Object.freeze({
  water: 32,
  wind: 32,
  smoke: 384 + TRANSIENT_SMOKE_SLOTS,
  footsteps: 24,
} as const);

type AmbientPool = "water" | "wind" | "smoke";
type DrawPass = "ground" | "air";

interface AmbientSlot {
  readonly id: string;
  readonly kind: AnimatedEnvironmentKind;
  readonly at: Vec2;
  readonly phaseSeed: number;
  readonly frame: NativeFrameRef | null;
  readonly neutralDiagnostic: boolean;
}

type ParticleKind = "footstep" | "smoke" | "ember" | "dust";

interface EffectSlot {
  readonly sequence: number;
  readonly kind: ParticleKind;
  readonly at: Vec2;
  readonly tint: string;
  readonly label: EnvironmentEffectLabel | null;
  readonly startedAtMs: number;
  readonly expiresAtMs: number;
}

/** One item visibly in flight between two points — leaves `from`, arrives at `to`, then disappears. */
interface FlyingItemSlot {
  readonly sequence: number;
  readonly from: Vec2;
  readonly to: Vec2;
  readonly icon: CarriableIconKind;
  readonly label: string | null;
  readonly startedAtMs: number;
  readonly expiresAtMs: number;
}

/** Shared shape of every live overlay: a bounded, owned, tiered piece of chrome. */
interface OverlaySlotBase {
  readonly sequence: number;
  readonly at: Vec2;
  readonly tier: OverlayTier;
  readonly startedAtMs: number;
  readonly expiresAtMs: number;
}

/** One live speech / whisper / thought bubble. Layout is fixed at emit time. */
interface TextOverlaySlot extends OverlaySlotBase {
  readonly kind: "text";
  readonly ownerId: string;
  readonly variant: SpeechBubbleVariant;
  readonly built: PixelSurface;
  readonly layout: MessageLayout;
  readonly accent: string;
  readonly hue: string;
  readonly thread: OverlayThread | null;
  /** Whoever this line was addressed to, so the bubble never lands on them. */
  readonly targetId: string | null;
  /** Low-zoom form: a quote mark for speech/whisper, an ellipsis for thought. */
  readonly studGlyph: OverlayGlyph;
}

/** One live action mark: a tapered banner on a rigid post. */
interface MarkOverlaySlot extends OverlaySlotBase {
  readonly kind: "mark";
  readonly ownerId: string;
  readonly glyph: OverlayGlyph;
  readonly family: OverlayFamily;
  readonly built: PixelSurface;
  readonly threads: readonly OverlayThread[];
}

/** One live impact burst. It sits *on* the thing it happened to and never stacks. */
interface BurstOverlaySlot extends OverlaySlotBase {
  readonly kind: "burst";
  readonly glyph: OverlayGlyph;
  readonly family: OverlayFamily;
  readonly invert: boolean;
  readonly built: PixelSurface;
}

/** A bubble's opening phase: three dots filling left to right above a being. */
interface GatherSlot extends OverlaySlotBase {
  readonly kind: "gather";
  readonly ownerId: string;
}

/** Residue: what a live overlay collapses into so a viewer who looked away is not lost. */
interface ResidueSlot {
  readonly sequence: number;
  readonly ownerId: string;
  readonly at: Vec2;
  readonly glyph: OverlayGlyph;
  readonly accent: string;
  readonly invert: boolean;
  readonly startedAtMs: number;
  readonly expiresAtMs: number;
}

const ANIMATED_FRAME_COUNT = 4;
const NEUTRAL_DIAGNOSTIC_TINT = "#a39992";
const ASH_TINT = "#e46c64";
/**
 * Vertical offset from an actor's feet anchor to the drawn area above its chibi
 * head. Retained at 40 for the shoulder-anchored residue pips; the *connector
 * tip* wants 50 (see {@link CONNECTOR_TIP_OFFSET_Y}).
 */
const HEAD_EFFECT_OFFSET_Y = 40;
/**
 * Where a connector (tail, post, puff trail) touches the world.
 *
 * The placement ledger's agent point is **feet**; the chibi frame is 46px tall,
 * so anchoring at `feet − 50` lands the tip just above the crown of the head
 * instead of planting it in the hair, which is what `HEAD_EFFECT_OFFSET_Y = 40`
 * did for the rejected overlay.
 */
const CONNECTOR_TIP_OFFSET_Y = 50;
const EFFECT_DURATION_MS: Readonly<Record<ParticleKind, number>> = {
  footstep: 600,
  smoke: 960,
  ember: 560,
  dust: 720,
};

/** Flight time for a `flying-item`, within the brief's ~0.8-1.2s window. */
const FLYING_ITEM_DURATION_MS = 1_000;
/** Peak arc height (world px) a flying item rises above the straight line between its two points. */
const FLYING_ITEM_ARC_HEIGHT = 14;

const CARRIABLE_ICON_TINT: Readonly<Record<CarriableIconKind, string>> = {
  energy: "#e8b23d",
  materials: "#8a6a43",
  loot: "#c9a227",
  gift: "#d98a8a",
};

const TEXT_OVERLAY_POOL_CAPACITY = 12;
const MARK_OVERLAY_POOL_CAPACITY = 12;
const BURST_OVERLAY_POOL_CAPACITY = 8;
const GATHER_POOL_CAPACITY = 8;
const RESIDUE_POOL_CAPACITY = 24;
const FLYING_ITEM_POOL_CAPACITY = 12;

/**
 * Bubble lifetime is **wall-clock** and is deliberately NOT divided by the
 * simulation speed multiplier.
 *
 * This inverts RimWorld's Interaction Bubbles convention on purpose: a bubble
 * that blinks out faster than the world runs is worse than a world that runs
 * slightly ahead of its captions. At 2x speed the sim outpaces the bubbles and
 * the residue pips carry the tail of memory, so nothing is lost.
 *
 * **Owner decision (Safi, 2026-08-26), replacing the reading-budget model:**
 *
 * > *"if another message comes in then the prev should fade away if not then
 * > keep it for 5-7sec based on length on message longer message means max
 * > time."*
 *
 * So a bubble is no longer sized to be *read* in place — it lives 5s to 7s and
 * then fades, and the Chronicle feed carries the full text for reading. The
 * curve is the simplest one that honours "longer message means max time": a
 * flat 5s floor plus 5ms a character, saturating at 7s once a message reaches
 * {@link TEXT_LIFETIME_FULL_LENGTH_CHARS}, which is the measured MEDIAN message
 * length — so a typical line already earns close to the ceiling and only the
 * genuinely short ones sit at the floor.
 */
const TEXT_LIFETIME_MIN_MS = 5_000;
const TEXT_LIFETIME_MAX_MS = 7_000;
const TEXT_LIFETIME_BASE_MS = TEXT_LIFETIME_MIN_MS;
/** Where the 5s→7s ramp saturates: the measured median message (385 chars), rounded. */
const TEXT_LIFETIME_FULL_LENGTH_CHARS = 400;
/** 5ms a character — the ramp derived from the band and its saturation length, never guessed. */
const TEXT_LIFETIME_PER_CHAR_MS =
  (TEXT_LIFETIME_MAX_MS - TEXT_LIFETIME_MIN_MS) / TEXT_LIFETIME_FULL_LENGTH_CHARS;
/**
 * How long a bubble takes to dissolve, in milliseconds.
 *
 * Applies to BOTH ends of a bubble's life — the ordinary 5-7s expiry and a
 * supersede — because the owner's rule is "fade away", never blink out. A
 * superseded bubble simply has its deadline pulled forward into this tail, so
 * there is one code path and one visual language for a bubble leaving.
 *
 * Deliberately shorter than the actors' own 180ms x 2 vanish-and-appear: chrome
 * that lingers while the next line is already up reads as a leak, not a fade.
 */
export const TEXT_FADE_OUT_MS = 400;
/** Reduced motion extends every lifetime: less animation, never less information. */
const REDUCED_MOTION_LIFETIME_FACTOR = 1.3;
const RESIDUE_LIFETIME_MS = 6_000;
const RESIDUE_PER_OWNER = 3;
/** A gather is bounded even if its resolved form never arrives (a cancelled scene). */
const GATHER_LIFETIME_MS = 2_400;
/** How long the three gather dots take to fill left to right. */
const GATHER_FILL_MS = 620;

/**
 * The chibi being frame in world px, standing on its feet anchor.
 *
 * Mirrors the sprite the actors draw (`docs/frontend/BUBBLE_UI.md` §5: "the
 * chibi frame is 46px tall"). Used only to keep a bubble off the speaker's and
 * the addressee's own bodies.
 */
const BEING_BODY_WIDTH = 22;
const BEING_BODY_HEIGHT = 46;

/** Crowd solver: candidate rects snap to this screen lattice. */
const CROWD_LATTICE_PX = 8;
const CROWD_MAX_LIFTS = 5;
/**
 * Lift budget for a TEXT bubble, which since 2026-08-21 carries a whole message
 * and is therefore tall.
 *
 * A being is 46 world px; five 8px lifts cannot clear one, so a bubble aimed at
 * someone standing just above its speaker had nowhere to go. Lifting is the
 * right escape for text (the tail keeps its column, so the bubble reads as
 * floating higher, not as belonging to someone else) — it just needs enough
 * rungs to clear a body.
 */
const CROWD_MAX_TEXT_LIFTS = 14;
const CROWD_LATERAL_SHIFT_PX = 12;
/** Global budget of live *text* bubbles on screen; the rest demote to pips. */
const CROWD_TEXT_BUDGET = 6;

/**
 * Deterministic, scheduler-free regional ambient and restrained-particle state,
 * plus the world's legibility overlay (`docs/frontend/BUBBLE_UI.md`).
 *
 * The system deep-owns trusted Task 6 placement data, resolves frames exclusively from
 * the active production pack, and exposes absolute wake deadlines to its outer renderer.
 *
 * Overlay chrome lives in its own pools, entirely separate from the
 * ground-ambience particle pools, and is therefore **exclusion-exempt by
 * construction**: exclusion zones exist to keep grass and tree sprites off a
 * character's face, so applying them to head-anchored chrome would only ever
 * hide it. That separation is the one piece of the rejected overlay's plumbing
 * kept wholesale (see `.superpowers/sdd/legibility-overlay-report.md` §8).
 */
export class EnvironmentSystem {
  private readonly kit: RegionKitId;
  private readonly terrainFamily: BiomeKit["terrainFamily"];
  private readonly atlasLeases: ReadonlyMap<string, ProductionAssetLease>;
  private readonly water: Array<AmbientSlot | null>;
  private readonly wind: Array<AmbientSlot | null>;
  private readonly smoke: Array<AmbientSlot | EffectSlot | null>;
  private readonly footsteps: Array<EffectSlot | null>;
  private readonly texts: Array<TextOverlaySlot | null>;
  private readonly marks: Array<MarkOverlaySlot | null>;
  private readonly bursts: Array<BurstOverlaySlot | null>;
  private readonly gathers: Array<GatherSlot | null>;
  private readonly residue: Array<ResidueSlot | null>;
  private readonly flyingItems: Array<FlyingItemSlot | null>;
  private readonly missingKinds = new Set<AnimatedEnvironmentKind>();
  private readonly missingAtlasIds = new Set<string>();
  private readonly resolvedKinds = new Set<AnimatedEnvironmentKind>();
  private readonly resolvedAtlasIds = new Set<string>();
  private readonly reducedMotion: boolean;
  private presentation: ReturnType<typeof conditionPresentation>;
  private exclusionZones: Rect[] = [];
  private anchorPositions: ReadonlyMap<string, Vec2> = new Map();
  private nowMs = 0;
  private effectSequence = 0;
  private droppedEffects = 0;
  private suppressedEffects = 0;
  private neutralDiagnostics = 0;
  private overflowingBubbles = 0;
  private disposed = false;

  constructor(options: Readonly<{
    regionId: string;
    recipe: RegionMapRecipeV1;
    condition: RegionCondition;
    manifest: ProductionAssetManifest;
    atlasLeases: ReadonlyMap<string, ProductionAssetLease>;
    reducedMotion?: boolean;
  }>) {
    const ownedRecipe = cloneTrustedRegionMapRecipe(options.recipe);
    if (ownedRecipe.regionId !== options.regionId) {
      throw new Error(`environment region ${options.regionId} does not match recipe ${ownedRecipe.regionId}`);
    }
    const pack = options.manifest.regions[ownedRecipe.kit];
    if (!pack || pack.kit !== ownedRecipe.kit) {
      throw new Error(`production environment pack ${ownedRecipe.kit} is unavailable`);
    }

    this.kit = ownedRecipe.kit;
    this.presentation = conditionPresentation(this.kit, copyCondition(options.condition));
    this.terrainFamily = this.presentation.terrainFamily;
    this.atlasLeases = new Map(options.atlasLeases);
    this.reducedMotion = options.reducedMotion ?? false;
    this.water = fixedPool<AmbientSlot>(ENVIRONMENT_POOL_CAPACITIES.water);
    this.wind = fixedPool<AmbientSlot>(ENVIRONMENT_POOL_CAPACITIES.wind);
    this.smoke = fixedPool<AmbientSlot | EffectSlot>(ENVIRONMENT_POOL_CAPACITIES.smoke);
    this.footsteps = fixedPool<EffectSlot>(ENVIRONMENT_POOL_CAPACITIES.footsteps);
    this.texts = fixedPool<TextOverlaySlot>(TEXT_OVERLAY_POOL_CAPACITY);
    this.marks = fixedPool<MarkOverlaySlot>(MARK_OVERLAY_POOL_CAPACITY);
    this.bursts = fixedPool<BurstOverlaySlot>(BURST_OVERLAY_POOL_CAPACITY);
    this.gathers = fixedPool<GatherSlot>(GATHER_POOL_CAPACITY);
    this.residue = fixedPool<ResidueSlot>(RESIDUE_POOL_CAPACITY);
    this.flyingItems = fixedPool<FlyingItemSlot>(FLYING_ITEM_POOL_CAPACITY);

    const activeFrames = pack.animatedFrames as Partial<
      Readonly<Record<AnimatedEnvironmentKind, NativeFrameRef>>
    >;
    const placements = [...ownedRecipe.animatedEnvironment].sort(comparePlacements);
    for (const placement of placements) {
      const sourceFrame = activeFrames[placement.kind];
      const frame = sourceFrame ? copyNativeFrame(sourceFrame) : null;
      if (frame) {
        this.resolvedKinds.add(placement.kind);
        this.resolvedAtlasIds.add(frame.atlasId);
      } else {
        this.missingKinds.add(placement.kind);
        this.neutralDiagnostics += 1;
      }
      const slot: AmbientSlot = {
        id: placement.id,
        kind: placement.kind,
        at: {
          x: placement.tile.column * 32,
          y: placement.tile.row * 32,
        },
        phaseSeed: placement.phaseSeed,
        frame,
        neutralDiagnostic: frame === null,
      };
      if (!insertFirstEmpty(this[poolFor(placement.kind)], slot)) this.droppedEffects += 1;
    }
  }

  /** Reconcile abundance presentation without changing the authored regional pack. */
  reconcile(condition: RegionCondition): void {
    if (this.disposed) return;
    this.presentation = conditionPresentation(this.kit, copyCondition(condition));
  }

  /** Replace particle exclusion rectangles with detached copies. */
  setExclusionZones(zones: readonly Rect[]): void {
    if (this.disposed) return;
    this.exclusionZones = zones.map(copyRect);
  }

  /**
   * Publish the live world position of every being and structure that overlay
   * chrome can hang on.
   *
   * A bubble's *content* is fixed at emit time, but its *anchor* must not be:
   * a speaker now physically approaches the being it is addressing, and a scene
   * can run for tens of seconds, so chrome pinned to the emit-time point visibly
   * detaches from the head it belongs to. Positions are refreshed by the scene
   * graph on the same tick it refreshes exclusion zones, from the actors it has
   * already ordered — no new source of truth, and an id that is absent simply
   * keeps its last known point rather than inventing one.
   */
  setAnchorPositions(positions: ReadonlyMap<string, Vec2>): void {
    if (this.disposed) return;
    this.anchorPositions = new Map(
      [...positions].map(([id, point]) => [id, snapPoint(point)]),
    );
  }

  /** The live point for an owned overlay, falling back to where it was emitted. */
  private anchorFor(ownerId: string, emitted: Vec2): Vec2 {
    return this.anchorPositions.get(ownerId) ?? emitted;
  }

  /** Add a bounded transient effect, or record deterministic suppression/saturation. */
  emit(request: EnvironmentEffectRequest, nowMs: number): void {
    if (this.disposed || !Number.isFinite(nowMs)) return;
    this.advanceTo(nowMs);
    switch (request.kind) {
      case "speech-bubble":
        this.emitText(request);
        return;
      case "event-mark":
        this.emitMark(request);
        return;
      case "event-burst":
        this.emitBurst(request);
        return;
      case "event-gather":
        this.emitGather(request);
        return;
      case "flying-item":
        this.emitFlyingItem(request);
        return;
      default:
        break;
    }
    // Ground-ambience particle kinds only, from here on (footstep/smoke/ember/dust).
    const at = snapPoint(request.at);
    if (this.intersectsExclusion(effectFootprint(request.kind, at))) {
      this.suppressedEffects += 1;
      return;
    }
    const pool = request.kind === "footstep" ? this.footsteps : this.smoke;
    const availableIndex = pool.indexOf(null);
    if (availableIndex < 0) {
      this.droppedEffects += 1;
      return;
    }
    const duration = this.reducedMotion
      ? Math.min(180, EFFECT_DURATION_MS[request.kind])
      : EFFECT_DURATION_MS[request.kind];
    const slot: EffectSlot = {
      sequence: this.effectSequence,
      kind: request.kind,
      at,
      tint: request.tint,
      label: request.label === undefined
        ? null
        : {
            recipientId: request.label.recipientId,
            value: request.label.value,
          },
      startedAtMs: this.nowMs,
      expiresAtMs: this.nowMs + duration,
    };
    this.effectSequence += 1;
    pool[availableIndex] = slot;
  }

  /**
   * Add or replace one being's speech / whisper / thought bubble.
   *
   * A new bubble for the same being replaces their previous one — one head, one
   * bubble — and so does one from the being it is addressing, when that being
   * was addressing it back ({@link supersedeTexts}). A superseded bubble FADES
   * and then demotes to a residue pip; nothing pops. Any gather this being had
   * open resolves into it.
   */
  private emitText(request: Extract<EnvironmentEffectRequest, { kind: "speech-bubble" }>): void {
    const at = snapPoint(request.at);
    const metrics = TEXT_KIND_METRICS[request.variant];
    // The addressee tag is a fact from the payload, never prose parsing: it
    // exists exactly when the event named a target, and it is the addressee's
    // public display name, already scrubbed upstream.
    const tag = request.targetName === undefined || request.targetName.trim().length === 0
      ? undefined
      : `to ${request.targetName.trim()}`;
    const { surface, layout: built } = buildTextBubble({
      kind: request.variant,
      text: request.text,
      hue: request.hue,
      accent: request.accent,
      lean: request.tailLean,
      ...(tag === undefined ? {} : { tag }),
    });
    const layout = built ?? layoutMessage(
      request.text,
      messageColumns(request.text.length, metrics.minColumns, metrics.maxColumns),
    );
    this.resolveGather(request.speakerId);
    this.retireOwnedMarks(request.speakerId);
    this.supersedeTexts(request.speakerId, request.targetId ?? null);
    // Superseded bubbles now linger for their fade instead of freeing their slot
    // at once, so a busy region can find the pool full. The line that just
    // arrived is the one thing that must never be the casualty of that: reclaim
    // whichever bubble is closest to gone rather than dropping the newcomer.
    const availableIndex = this.texts.indexOf(null) >= 0
      ? this.texts.indexOf(null)
      : this.reclaimFadingText();
    if (availableIndex < 0) {
      this.droppedEffects += 1;
      return;
    }
    this.texts[availableIndex] = {
      kind: "text",
      sequence: this.effectSequence,
      ownerId: request.speakerId,
      at,
      tier: request.tier,
      variant: request.variant,
      built: surface,
      layout,
      accent: request.accent,
      hue: request.hue,
      thread: request.thread === undefined ? null : copyThread(request.thread),
      targetId: request.targetId ?? null,
      studGlyph: request.variant === "thought" ? "ellipsis" : "quote",
      startedAtMs: this.nowMs,
      expiresAtMs: this.nowMs + this.textLifetimeMs(layout),
    };
    this.effectSequence += 1;
  }

  /** Add or replace one owner's action mark. */
  private emitMark(request: Extract<EnvironmentEffectRequest, { kind: "event-mark" }>): void {
    const at = snapPoint(request.at);
    const accent = OVERLAY_FAMILY_ACCENT[request.family];
    const { surface } = buildMark({
      glyph: request.glyph,
      accent,
      ...(request.micro === undefined ? {} : { micro: request.micro }),
    });
    this.resolveGather(request.ownerId);
    this.retireOwnedMarks(request.ownerId);
    this.supersedeTexts(request.ownerId, null);
    const availableIndex = this.marks.indexOf(null);
    if (availableIndex < 0) {
      this.droppedEffects += 1;
      return;
    }
    this.marks[availableIndex] = {
      kind: "mark",
      sequence: this.effectSequence,
      ownerId: request.ownerId,
      at,
      tier: request.tier,
      glyph: request.glyph,
      family: request.family,
      built: surface,
      threads: (request.threads ?? []).map(copyThread),
      startedAtMs: this.nowMs,
      expiresAtMs: this.nowMs + this.tierLifetimeMs(request.tier),
    };
    this.effectSequence += 1;
  }

  /** Add one impact burst. Bursts never replace one another — violence stacks. */
  private emitBurst(request: Extract<EnvironmentEffectRequest, { kind: "event-burst" }>): void {
    const at = snapPoint(request.at);
    const invert = request.invert === true;
    const light = request.light === true;
    const { surface } = buildBurst({
      glyph: request.glyph,
      accent: OVERLAY_FAMILY_ACCENT[request.family],
      invert,
      big: invert || light,
      spikes: light ? 9 : 11,
      seed: (this.effectSequence % 17) + 2,
    });
    const availableIndex = this.bursts.indexOf(null);
    if (availableIndex < 0) {
      this.droppedEffects += 1;
      return;
    }
    this.bursts[availableIndex] = {
      kind: "burst",
      sequence: this.effectSequence,
      at,
      tier: "knell",
      glyph: request.glyph,
      family: request.family,
      invert,
      built: surface,
      startedAtMs: this.nowMs,
      expiresAtMs: this.nowMs + this.tierLifetimeMs(invert || light ? "knell" : "strike"),
    };
    this.effectSequence += 1;
  }

  /**
   * Open one being's gather cloud — the bubble's first phase.
   *
   * A bubble is not an object that appears; it is a gesture with a beginning.
   * The gather is emitted when a scene enters, and is resolved (replaced) by
   * whatever the being actually produced. Re-emitting for the same being is
   * idempotent so a re-resolved scene does not restart the dots.
   */
  private emitGather(request: Extract<EnvironmentEffectRequest, { kind: "event-gather" }>): void {
    for (const gather of this.gathers) {
      if (gather?.ownerId === request.ownerId) return;
    }
    const availableIndex = this.gathers.indexOf(null);
    if (availableIndex < 0) {
      this.droppedEffects += 1;
      return;
    }
    this.gathers[availableIndex] = {
      kind: "gather",
      sequence: this.effectSequence,
      ownerId: request.ownerId,
      at: snapPoint(request.at),
      tier: "murmur",
      startedAtMs: this.nowMs,
      expiresAtMs: this.nowMs + GATHER_LIFETIME_MS,
    };
    this.effectSequence += 1;
  }

  /** Add one item visibly in flight from `from` to `to`. Never suppressed by exclusion. */
  private emitFlyingItem(request: Extract<EnvironmentEffectRequest, { kind: "flying-item" }>): void {
    const availableIndex = this.flyingItems.indexOf(null);
    if (availableIndex < 0) {
      this.droppedEffects += 1;
      return;
    }
    const duration = this.reducedMotion ? Math.min(180, FLYING_ITEM_DURATION_MS) : FLYING_ITEM_DURATION_MS;
    this.flyingItems[availableIndex] = {
      sequence: this.effectSequence,
      from: snapPoint(request.from),
      to: snapPoint(request.to),
      icon: request.icon,
      label: request.label ?? null,
      startedAtMs: this.nowMs,
      expiresAtMs: this.nowMs + duration,
    };
    this.effectSequence += 1;
  }

  /** Close one being's open gather without leaving residue — it became the real thing. */
  private resolveGather(ownerId: string): void {
    for (let index = 0; index < this.gathers.length; index += 1) {
      if (this.gathers[index]?.ownerId === ownerId) this.gathers[index] = null;
    }
  }

  /** Collapse an owner's live action marks into residue so a replaced beat is not simply lost. */
  private retireOwnedMarks(ownerId: string): void {
    for (let index = 0; index < this.marks.length; index += 1) {
      const slot = this.marks[index];
      if (slot?.ownerId !== ownerId) continue;
      this.pushResidue(slot);
      this.marks[index] = null;
    }
  }

  /**
   * Begin fading every live bubble one new utterance supersedes.
   *
   * **The rule, owner-set (Safi, 2026-08-26):** a new utterance supersedes the
   * previous one **from the same being**, and the previous one **from that
   * being's conversation partner** — the being it is addressing, when that
   * being's live bubble was itself addressed back at the speaker. Those two are
   * the pair currently exchanging, and a reply clearing the line it answers is
   * the whole point of the rule.
   *
   * Everything else in the world is deliberately untouched. Utterances do not
   * clear each other by mere adjacency in time: a being speaking in Nirvana must
   * never wipe a bubble in Warm Springs, and a bubble addressed to a THIRD being
   * is not part of this exchange.
   *
   * A superseded bubble is not removed — its deadline is pulled forward into
   * {@link TEXT_FADE_OUT_MS}, so it dissolves on exactly the same path as one
   * that simply ran out of time, and leaves the same residue pip when it lands.
   */
  private supersedeTexts(speakerId: string, targetId: string | null): void {
    for (let index = 0; index < this.texts.length; index += 1) {
      const slot = this.texts[index];
      if (slot === null || slot === undefined) continue;
      const own = slot.ownerId === speakerId;
      const partner = targetId !== null
        && slot.ownerId === targetId
        && slot.targetId === speakerId;
      if (!own && !partner) continue;
      const expiresAtMs = Math.min(slot.expiresAtMs, this.nowMs + TEXT_FADE_OUT_MS);
      if (expiresAtMs === slot.expiresAtMs) continue;
      this.texts[index] = { ...slot, expiresAtMs };
    }
  }

  /**
   * Free the bubble closest to gone, returning its index, or `-1` if none is
   * fading.
   *
   * The last resort under pool exhaustion, and the ONE place a bubble may leave
   * without finishing its fade: dropping an already-dissolving bubble a few
   * frames early is invisible, while dropping the message that arrived is not.
   * Its residue pip is pushed exactly as an ordinary expiry would.
   */
  private reclaimFadingText(): number {
    let chosen = -1;
    let earliest = Number.POSITIVE_INFINITY;
    for (let index = 0; index < this.texts.length; index += 1) {
      const slot = this.texts[index];
      if (slot === null || slot === undefined) continue;
      if (slot.expiresAtMs - this.nowMs > TEXT_FADE_OUT_MS) continue;
      if (slot.expiresAtMs >= earliest) continue;
      earliest = slot.expiresAtMs;
      chosen = index;
    }
    if (chosen < 0) return -1;
    this.pushResidue(this.texts[chosen]!);
    this.texts[chosen] = null;
    return chosen;
  }

  /**
   * Turn one expired or replaced overlay into a residue pip at its owner's
   * shoulder, keeping at most {@link RESIDUE_PER_OWNER} — oldest first out.
   */
  private pushResidue(slot: TextOverlaySlot | MarkOverlaySlot): void {
    const glyph = slot.kind === "mark" ? slot.glyph : slot.studGlyph;
    const accent = slot.kind === "mark"
      ? OVERLAY_FAMILY_ACCENT[slot.family]
      : OVERLAY_PALETTE.inkSoft;
    const owned: number[] = [];
    for (let index = 0; index < this.residue.length; index += 1) {
      if (this.residue[index]?.ownerId === slot.ownerId) owned.push(index);
    }
    while (owned.length >= RESIDUE_PER_OWNER) {
      const oldest = owned.reduce((low, index) => (
        this.residue[index]!.sequence < this.residue[low]!.sequence ? index : low
      ), owned[0]!);
      this.residue[oldest] = null;
      owned.splice(owned.indexOf(oldest), 1);
    }
    const availableIndex = this.residue.indexOf(null);
    if (availableIndex < 0) return;
    this.residue[availableIndex] = {
      sequence: this.effectSequence,
      ownerId: slot.ownerId,
      at: slot.at,
      glyph,
      accent,
      invert: false,
      startedAtMs: this.nowMs,
      expiresAtMs: this.nowMs + RESIDUE_LIFETIME_MS,
    };
    this.effectSequence += 1;
  }

  /**
   * How long a bubble stays up before it fades, in milliseconds.
   *
   * `clamp(5000 + 5 x visibleChars, 5000, 7000)` — wall-clock, and deliberately
   * NOT divided by the simulation speed multiplier. Owner-set band (see
   * {@link TEXT_LIFETIME_BASE_MS}): a bubble is the live pulse of a conversation,
   * not the record of it, and it saturates at 7s once a message reaches the
   * measured median length.
   *
   * The previous model asked a bubble to be *readable in place* — up to 30s,
   * and floored at the length of the speaker's own scene — and the owner has
   * replaced it after watching a live run. The consequence is deliberate and
   * accepted: a long line is no longer fully readable above a head, and the
   * Chronicle feed is where it is read.
   *
   * Reduced motion still stretches the result by
   * {@link REDUCED_MOTION_LIFETIME_FACTOR}. That is the one carve-out kept from
   * the old model, and it is an accessibility contract rather than a reading
   * budget: less animation, never less information.
   */
  private textLifetimeMs(layout: MessageLayout): number {
    const visible = layout.lines.reduce((total, line) => total + line.length, 0);
    const held = Math.min(
      TEXT_LIFETIME_MAX_MS,
      Math.max(TEXT_LIFETIME_MIN_MS, TEXT_LIFETIME_BASE_MS + visible * TEXT_LIFETIME_PER_CHAR_MS),
    );
    return Math.round(held * (this.reducedMotion ? REDUCED_MOTION_LIFETIME_FACTOR : 1));
  }

  private tierLifetimeMs(tier: OverlayTier): number {
    return Math.round(
      OVERLAY_TIER_HOLD_MS[tier] * (this.reducedMotion ? REDUCED_MOTION_LIFETIME_FACTOR : 1),
    );
  }

  /** Advance absolute presentation time and expire bounded transient slots. */
  advanceTo(nowMs: number): void {
    if (this.disposed || !Number.isFinite(nowMs) || nowMs < this.nowMs) return;
    this.nowMs = nowMs;
    expireEffects(this.footsteps, nowMs);
    expireEffects(this.smoke, nowMs);
    this.expireOverlays(this.texts, nowMs);
    this.expireOverlays(this.marks, nowMs);
    expireByDeadline(this.bursts, nowMs);
    expireByDeadline(this.gathers, nowMs);
    expireByDeadline(this.residue, nowMs);
    expireByDeadline(this.flyingItems, nowMs);
  }

  /** Expire owned overlays, leaving a residue pip behind rather than nothing. */
  private expireOverlays<T extends TextOverlaySlot | MarkOverlaySlot>(
    pool: Array<T | null>,
    nowMs: number,
  ): void {
    for (let index = 0; index < pool.length; index += 1) {
      const slot = pool[index];
      if (slot === null || slot === undefined || slot.expiresAtMs > nowMs) continue;
      this.pushResidue(slot);
      pool[index] = null;
    }
  }

  /**
   * Draw one deterministic environment pass using native integer atlas cells.
   *
   * The overlay is the last thing in the "air" pass and is drawn in **screen
   * space** at an integer scale when a {@link OverlayViewport} is supplied, so
   * its 1x pixel chrome is never resampled by the camera's continuous zoom.
   */
  draw(context: CanvasRenderingContext2D, pass: DrawPass, view?: OverlayViewport): void {
    if (this.disposed) return;
    context.imageSmoothingEnabled = false;
    context.save();
    context.globalAlpha = ambientAlpha(this.presentation.vitality);
    if (pass === "ground") {
      this.drawAmbientPool(context, this.water);
      this.drawEffects(context, this.footsteps);
    } else {
      this.drawAmbientPool(context, this.wind);
      this.drawAmbientPool(context, this.smoke);
      this.drawEffects(context, this.smoke);
      this.drawFlyingItems(context);
    }
    context.restore();
    if (pass === "air") this.drawOverlay(context, view);
  }

  /**
   * The absolute time at which the LAST currently-live piece of legibility chrome expires,
   * or `null` when no overlay is on screen.
   *
   * This is the overlay layer's own clock, published so the camera can hold a beat's framing
   * for exactly as long as that beat's chrome is readable instead of racing it. Before this
   * existed the only outward deadline signal was {@link nextDeadlineMs}, which is a *minimum*
   * polluted by 60/120ms animation ticks -- it answers "when should I wake", never "when does
   * this bubble die", so a camera built on it re-framed mid-sentence.
   *
   * Counts the five chrome pools a viewer is asked to *read* (bubbles, marks, bursts, gathers
   * and a flying item in transit). Residue pips are deliberately excluded: they are the fading
   * trace left *after* a mark has been read, so holding a frame for them would pin the camera
   * on a beat whose statement is already over.
   */
  overlayHoldUntilMs(): number | null {
    if (this.disposed) return null;
    let latest: number | null = null;
    const consider = (candidate: number): void => {
      if (!Number.isFinite(candidate) || candidate <= this.nowMs) return;
      if (latest === null || candidate > latest) latest = candidate;
    };
    for (const pool of [this.texts, this.marks, this.bursts, this.gathers]) {
      for (const slot of pool) if (slot !== null) consider(slot.expiresAtMs);
    }
    for (const item of this.flyingItems) if (item !== null) consider(item.expiresAtMs);
    return latest;
  }

  /**
   * The world-space rect covering every anchor the currently-live chrome is drawn at (and every
   * point it reaches to), or `null` when no overlay is on screen.
   *
   * This is the honest answer to "what must be in frame for this beat to be legible", and it is
   * strictly better than guessing from a scene's actor intents: at the consequence beat the being
   * an event happened *to* frequently carries no intent of its own, while a bystander does -- so
   * an intent-derived cast both omits the victim and admits scenery. The overlay layer, by
   * contrast, already knows exactly where it put the striker's mark, the victim's burst, a
   * thread's far cap and an item in flight, and keeps those anchors live as beings walk (see
   * {@link setAnchorPositions}).
   *
   * Points only -- the chrome's own drawn extent is screen-space and scale-dependent, so callers
   * pad this rect for the silhouette and its lift rather than having it baked in here.
   */
  overlayFocusRect(): Rect | null {
    if (this.disposed) return null;
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    const consider = (point: Vec2 | undefined): void => {
      if (point === undefined || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return;
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    };
    for (const slot of this.texts) {
      if (slot === null) continue;
      consider(slot.at);
      consider(slot.thread?.to);
    }
    for (const slot of this.marks) {
      if (slot === null) continue;
      consider(slot.at);
      for (const thread of slot.threads) consider(thread.to);
    }
    for (const slot of this.bursts) if (slot !== null) consider(slot.at);
    for (const slot of this.gathers) if (slot !== null) consider(slot.at);
    for (const item of this.flyingItems) {
      if (item === null) continue;
      consider(item.from);
      consider(item.to);
    }
    if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  /** Return the next absolute animation/expiry boundary, always future or null. */
  nextDeadlineMs(): number | null {
    if (this.disposed) return null;
    let deadline: number | null = null;
    if (!this.reducedMotion) {
      deadline = minimumAmbientDeadline(this.water, deadline, this.nowMs);
      deadline = minimumAmbientDeadline(this.wind, deadline, this.nowMs);
      deadline = minimumAmbientDeadline(this.smoke, deadline, this.nowMs);
    }
    const hasActiveEffect = hasEffect(this.smoke) || hasEffect(this.footsteps);
    deadline = minimumEffectDeadline(this.smoke, deadline, this.nowMs);
    deadline = minimumEffectDeadline(this.footsteps, deadline, this.nowMs);
    if (hasActiveEffect && !this.reducedMotion) {
      deadline = minimumFuture(deadline, nextMultipleAfter(this.nowMs, 120), this.nowMs);
    }
    for (const pool of [this.texts, this.marks, this.bursts, this.gathers, this.residue]) {
      for (const slot of pool) {
        if (slot !== null) deadline = minimumFuture(deadline, slot.expiresAtMs, this.nowMs);
      }
    }
    for (const item of this.flyingItems) {
      if (item !== null) deadline = minimumFuture(deadline, item.expiresAtMs, this.nowMs);
    }
    // A dissolving bubble animates its own opacity, and unlike every other
    // animated piece of chrome it must keep doing so under reduced motion: a
    // cross-fade is the gentlest transition there is, and skipping the ticks
    // would turn the owner's "fade away" back into a pop for exactly the
    // viewers who asked for less abruptness.
    if (this.texts.some((slot) => (
      slot !== null && slot.expiresAtMs - this.nowMs <= TEXT_FADE_OUT_MS
    ))) {
      deadline = minimumFuture(deadline, nextMultipleAfter(this.nowMs, 60), this.nowMs);
    }
    // A filling gather animates; wake often enough to advance its dots.
    if (hasAnyActive(this.gathers) && !this.reducedMotion) {
      deadline = minimumFuture(deadline, nextMultipleAfter(this.nowMs, 120), this.nowMs);
    }
    if (hasAnyActive(this.flyingItems) && !this.reducedMotion) {
      deadline = minimumFuture(deadline, nextMultipleAfter(this.nowMs, 60), this.nowMs);
    }
    return deadline;
  }

  /** Return a detached diagnostic snapshot for review and renderer instrumentation. */
  diagnostics(): EnvironmentDiagnostics {
    const ambient = this.ambientSlots();
    const effects = this.effectSlots();
    return {
      disposed: this.disposed,
      kit: this.kit,
      terrainFamily: this.terrainFamily,
      vitality: this.presentation.vitality,
      activeWater: countActive(this.water),
      activeWind: countActive(this.wind),
      activeSmoke: countActive(this.smoke),
      activeFootsteps: countActive(this.footsteps),
      activeEffects: effects.length,
      capacities: { ...ENVIRONMENT_POOL_CAPACITIES },
      allocatedSlots: {
        water: this.water.length,
        wind: this.wind.length,
        smoke: this.smoke.length,
        footsteps: this.footsteps.length,
      },
      nextDeadlineMs: this.nextDeadlineMs(),
      droppedEffects: this.droppedEffects,
      suppressedEffects: this.suppressedEffects,
      neutralDiagnostics: this.neutralDiagnostics,
      activeBubbles: countActive(this.texts),
      overflowingBubbles: this.overflowingBubbles,
      activeMarkers: countActive(this.marks),
      activeBursts: countActive(this.bursts),
      activeGathers: countActive(this.gathers),
      activeFlyingItems: countActive(this.flyingItems),
      activeResidue: countActive(this.residue),
      missingKinds: [...this.missingKinds].sort(),
      missingAtlasIds: [...this.missingAtlasIds].sort(),
      resolvedKinds: [...this.resolvedKinds].sort(),
      resolvedAtlasIds: [...this.resolvedAtlasIds].sort(),
      frameSignature: ambient.map(frameKey).join("|"),
      phaseSignature: ambient.map((slot) => `${slot.id}:${phaseIndex(slot, this.nowMs)}`).join("|"),
      effectSignature: effects.map(effectKey).join("|"),
    };
  }

  /** Release every distinct structural lease exactly once and make future calls inert. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.water.fill(null);
    this.wind.fill(null);
    this.smoke.fill(null);
    this.footsteps.fill(null);
    this.texts.fill(null);
    this.marks.fill(null);
    this.bursts.fill(null);
    this.gathers.fill(null);
    this.residue.fill(null);
    this.flyingItems.fill(null);
    this.exclusionZones = [];
    for (const lease of new Set(this.atlasLeases.values())) lease.release();
  }

  private drawAmbientPool(
    context: CanvasRenderingContext2D,
    pool: readonly (AmbientSlot | EffectSlot | null)[],
  ): void {
    for (const value of pool) {
      if (!isAmbient(value)) continue;
      if (value.neutralDiagnostic) {
        if (!this.intersectsExclusion({ x: value.at.x, y: value.at.y, width: 32, height: 32 })) {
          context.fillStyle = NEUTRAL_DIAGNOSTIC_TINT;
          context.fillRect(value.at.x + 14, value.at.y + 14, 4, 4);
        }
        continue;
      }
      const frame = value.frame;
      if (!frame) continue;
      if (this.intersectsExclusion({
        x: value.at.x,
        y: value.at.y,
        width: frame.rect.width,
        height: frame.rect.height,
      })) continue;
      const lease = this.atlasLeases.get(frame.atlasId);
      if (!lease) {
        this.missingAtlasIds.add(frame.atlasId);
        continue;
      }
      const phase = this.reducedMotion ? seededSettledPhase(value.phaseSeed) : phaseIndex(value, this.nowMs);
      const sourceX = frame.rect.x + phase * frame.rect.width;
      context.drawImage(
        lease.value,
        sourceX,
        frame.rect.y,
        frame.rect.width,
        frame.rect.height,
        value.at.x,
        value.at.y,
        frame.rect.width,
        frame.rect.height,
      );
    }
  }

  /** Draw every active ground-ambience particle (footstep/smoke/ember/dust). */
  private drawEffects(
    context: CanvasRenderingContext2D,
    pool: readonly (AmbientSlot | EffectSlot | null)[],
  ): void {
    for (const value of pool) {
      if (!isEffect(value)) continue;
      const at = effectPosition(value, this.nowMs, this.reducedMotion);
      const footprint = effectFootprint(value.kind, at);
      if (this.intersectsExclusion(footprint)) continue;
      context.fillStyle = this.kit === "ash-waste" ? ASH_TINT : value.tint;
      context.fillRect(footprint.x, footprint.y, footprint.width, footprint.height);
    }
  }

  /** Draw every item currently in flight, interpolated along its arc from `from` to `to`. */
  private drawFlyingItems(context: CanvasRenderingContext2D): void {
    for (const item of this.flyingItems) {
      if (item === null) continue;
      const age = Math.max(0, this.nowMs - item.startedAtMs);
      const duration = Math.max(1, item.expiresAtMs - item.startedAtMs);
      const progress = this.reducedMotion ? 1 : Math.min(1, age / duration);
      const arc = Math.sin(Math.PI * progress) * FLYING_ITEM_ARC_HEIGHT;
      const at = {
        x: Math.round(item.from.x + (item.to.x - item.from.x) * progress),
        y: Math.round(item.from.y + (item.to.y - item.from.y) * progress - arc),
      };
      context.fillStyle = CARRIABLE_ICON_TINT[item.icon];
      drawCarriableGlyph(context, at);
    }
  }

  // -------------------------------------------------------------------------
  // the legibility overlay
  // -------------------------------------------------------------------------

  /**
   * Draw the whole overlay in one screen-space pass.
   *
   * Order matters: threads and caps sit under the chrome that owns them,
   * residue is a step smaller and below live chrome because it is secondary
   * information, bursts sit on their subject, and text/marks are placed last by
   * the crowd solver so nothing occludes a word.
   */
  private drawOverlay(context: CanvasRenderingContext2D, view: OverlayViewport | undefined): void {
    if (!this.hasOverlay()) return;
    const zoom = view === undefined ? 1 : view.zoom;
    const originX = view === undefined ? 0 : view.originX;
    const originY = view === undefined ? 0 : view.originY;
    const scale = bubbleScale(zoom);
    const screenSpace = view !== undefined && typeof context.setTransform === "function";
    const toScreenX = (worldX: number): number => Math.round(worldX * zoom + originX);
    const toScreenY = (worldY: number): number => Math.round(worldY * zoom + originY);

    context.save();
    if (screenSpace) context.setTransform(1, 0, 0, 1, 0, 0);
    context.imageSmoothingEnabled = false;
    context.globalAlpha = 1;

    // The zoom ladder only applies when there is a real camera to reason about:
    // with no viewport the chrome draws at its authored 1x, full grammar.
    const withText = view === undefined || view.zoom >= TEXT_ZOOM_THRESHOLD;
    const live = this.orderedOverlays();

    // 1. threads + receiver caps, under everything they connect.
    for (const slot of live) {
      const threads = slot.kind === "mark"
        ? slot.threads
        : slot.thread === null ? [] : [slot.thread];
      const from = this.anchorFor(slot.ownerId, slot.at);
      for (const thread of threads) {
        const to = thread.toId === undefined ? thread.to : this.anchorFor(thread.toId, thread.to);
        this.drawThread(
          context,
          toScreenX(from.x),
          toScreenY(from.y - CONNECTOR_TIP_OFFSET_Y + 4),
          toScreenX(to.x),
          toScreenY(to.y - CONNECTOR_TIP_OFFSET_Y - 9),
          thread,
          scale,
        );
        buildCap(thread.hue).surface.blit(
          context,
          toScreenX(to.x),
          toScreenY(to.y - CONNECTOR_TIP_OFFSET_Y - 2),
          scale,
        );
      }
    }

    // 2. residue pips — a step smaller, so they read as history, not news.
    const residueScale = Math.max(1, scale - 1);
    const shoulders = new Map<string, number>();
    for (const pip of [...this.residue].filter((slot): slot is ResidueSlot => slot !== null)
      .sort((left, right) => left.sequence - right.sequence)) {
      const column = shoulders.get(pip.ownerId) ?? 0;
      shoulders.set(pip.ownerId, column + 1);
      const age = this.nowMs - pip.startedAtMs;
      const alpha = Math.max(0.15, 1 - age / RESIDUE_LIFETIME_MS);
      const at = this.anchorFor(pip.ownerId, pip.at);
      buildPip(pip.glyph, pip.accent, pip.invert).surface.blit(
        context,
        toScreenX(at.x + 9) + column * (14 * residueScale),
        toScreenY(at.y - Math.round(HEAD_EFFECT_OFFSET_Y * 0.55)),
        residueScale,
        alpha,
      );
    }

    // 3. bursts — on the thing it happened to, never above a head.
    for (const burst of this.bursts) {
      if (burst === null) continue;
      burst.built.blit(context, toScreenX(burst.at.x), toScreenY(burst.at.y), scale);
    }

    // 4. gathers — the opening phase, rebuilt each frame as its dots fill.
    // Below the text threshold a gather has nothing to gather toward: the
    // resolved form is itself only a glyph stud there, so an opening cloud
    // would be noise over a world already reduced to coloured intent.
    if (withText) {
      for (const gather of this.gathers) {
        if (gather === null) continue;
        const phase = this.reducedMotion
          ? 1
          : Math.min(1, (this.nowMs - gather.startedAtMs) / GATHER_FILL_MS);
        const at = this.anchorFor(gather.ownerId, gather.at);
        buildGather(phase).surface.blit(
          context,
          toScreenX(at.x),
          toScreenY(at.y - CONNECTOR_TIP_OFFSET_Y),
          scale,
        );
      }
    }

    // 5. text + marks, deterministically de-collided.
    this.drawPlacedOverlays(
      context,
      live,
      scale,
      withText,
      zoom,
      safeFrame(view),
      canvasRect(view),
      toScreenX,
      toScreenY,
    );

    if (screenSpace) context.restore();
    else context.restore();
  }

  private hasOverlay(): boolean {
    return hasAnyActive(this.texts)
      || hasAnyActive(this.marks)
      || hasAnyActive(this.bursts)
      || hasAnyActive(this.gathers)
      || hasAnyActive(this.residue);
  }

  /**
   * Live text + mark overlays in placement order: **tier descending, then event
   * sequence ascending**. No float tie-breaks — identical input produces an
   * identical layout, which replay requires.
   */
  private orderedOverlays(): readonly (TextOverlaySlot | MarkOverlaySlot)[] {
    const live: Array<TextOverlaySlot | MarkOverlaySlot> = [];
    for (const slot of this.texts) if (slot !== null) live.push(slot);
    for (const slot of this.marks) if (slot !== null) live.push(slot);
    return live.sort((left, right) => (
      OVERLAY_TIER_RANK[right.tier] - OVERLAY_TIER_RANK[left.tier]
      || left.sequence - right.sequence
    ));
  }

  /**
   * Place and draw every live text/mark with the deterministic crowd solver of
   * `BUBBLE_UI.md` §7: snap to an 8px lattice, lift one row at a time, then
   * shift laterally, then **demote to a pip** — never shrink text, because
   * readability beats completeness. A KNELL is never demoted.
   */
  private drawPlacedOverlays(
    context: CanvasRenderingContext2D,
    live: readonly (TextOverlaySlot | MarkOverlaySlot)[],
    scale: number,
    withText: boolean,
    zoom: number,
    frame: Rect | null,
    canvas: Rect | null,
    toScreenX: (worldX: number) => number,
    toScreenY: (worldY: number) => number,
  ): void {
    const placed: Rect[] = [];
    let textsPlaced = 0;
    for (const slot of live) {
      const isText = slot.kind === "text";
      // A bubble already dissolving is a ghost: it is drawn, but it neither
      // blocks the crowd solver nor spends the text budget. Otherwise the very
      // line that superseded it would be lifted a row (or demoted to a stud)
      // for the length of the fade and then drop back — a jump exactly where
      // the viewer is looking.
      const fade = isText ? textFadeAlpha(slot, this.nowMs) : 1;
      const dissolving = fade < 1;
      const overBudget = isText && !dissolving
        && textsPlaced >= CROWD_TEXT_BUDGET && slot.tier !== "knell";
      // Below the text threshold EVERY silhouette collapses to a glyph stud on a
      // short stem -- speech to a quote mark, thought to an ellipsis, an action
      // to its verb glyph -- so a wide view reads as a field of coloured intent
      // rather than a wall of chrome larger than the beings under it.
      const surface = withText
        ? slot.built
        : slot.kind === "text"
          ? buildStud(slot.studGlyph, slot.hue).surface
          : buildStud(slot.glyph, OVERLAY_FAMILY_ACCENT[slot.family]).surface;
      const at = this.anchorFor(slot.ownerId, slot.at);
      const anchorX = toScreenX(at.x);
      const anchorY = toScreenY(at.y - CONNECTOR_TIP_OFFSET_Y);
      if (overBudget) {
        this.drawDemoted(context, slot, anchorX, anchorY, scale, fade);
        continue;
      }
      // A text bubble carries the whole message, so its own scale is a separate
      // decision from the chrome's: the length ladder steps the type down to the
      // legibility floor, and a frame too small for the result steps it down
      // further rather than letting words fall off the screen.
      const blitScale = isText && withText
        ? textBubbleScale(zoom, slot.layout.total, surface, frame ?? { width: Infinity, height: Infinity })
        : scale;
      const width = surface.width * blitScale;
      const height = surface.height * blitScale;
      // The connector must stay exactly on its being's crown, so the anchor is
      // never snapped: a lattice applied to a screen x makes every bubble jitter
      // sideways under a panning camera. The 8px lattice governs the LIFT steps
      // (below), which is where it buys the deterministic, non-overlapping layout
      // replay needs.
      const baseX = anchorX - surface.ax * blitScale;
      const baseY = anchorY - (surface.height - surface.ay) * blitScale - height;
      // A bubble is only pulled back on screen when its OWNER is on screen. For a
      // being outside the view there is no crown for the connector to sit on, and
      // dragging its words into the middle of the map would attribute them to
      // nobody — the grammar's one hard rule.
      const anchored = frame !== null && canvas !== null
        && anchorX >= canvas.x && anchorX <= canvas.x + canvas.width
        && anchorY >= canvas.y && anchorY <= canvas.y + canvas.height
        ? frame
        : null;
      // The two beings this bubble is ABOUT are blockers for this slot alone --
      // never for the whole crowd, or a busy region would mass-demote. Words
      // must not land on the mouth that said them, nor on the ear they were
      // said into.
      const bodies = isText
        ? [slot.ownerId, slot.targetId]
            .filter((id): id is string => id !== null)
            .map((id) => this.bodyRect(id, toScreenX, toScreenY, zoom))
            .filter((rect): rect is Rect => rect !== null)
        : [];
      const lateralSteps = [0, CROWD_LATERAL_SHIFT_PX, -CROWD_LATERAL_SHIFT_PX];
      const maxLifts = isText ? CROWD_MAX_TEXT_LIFTS : CROWD_MAX_LIFTS;
      const search = (avoidBodies: boolean): Rect | null => {
        for (const lateral of lateralSteps) {
          for (let lift = 0; lift <= maxLifts; lift += 1) {
            const settled = clampIntoFrame({
              x: baseX + lateral * blitScale,
              y: baseY - lift * CROWD_LATTICE_PX * blitScale,
              width,
              height,
            }, anchored);
            if (placed.some((other) => rectanglesIntersect(settled, other))) continue;
            if (avoidBodies && bodies.some((body) => rectanglesIntersect(settled, body))) continue;
            return settled;
          }
        }
        return null;
      };
      // Two passes, and the order IS the priority: keeping the words off the two
      // bodies is a strong preference, but a message nobody can read is worse
      // than one drawn across the speaker's shoulder, so a corner with nowhere
      // clear left still gets its bubble rather than a demotion to a stud.
      const chosen = search(true) ?? search(false);
      let settled = chosen;
      if (settled === null) {
        if (slot.tier !== "knell") {
          this.drawDemoted(context, slot, anchorX, anchorY, scale, fade);
          continue;
        }
        settled = clampIntoFrame({ x: baseX, y: baseY, width, height }, anchored);
      }
      if (isText && frame !== null && (width > frame.width || height > frame.height)) {
        this.overflowingBubbles += 1;
      }
      if (!dissolving) {
        placed.push(settled);
        if (isText) textsPlaced += 1;
      }
      const alpha = (slot.kind === "text" ? TEXT_KIND_METRICS[slot.variant].alpha : 1) * fade;
      surface.blit(
        context,
        settled.x + surface.ax * blitScale,
        settled.y + surface.ay * blitScale,
        blitScale,
        alpha,
      );
    }
  }

  /**
   * One being's drawn body in screen px, or `null` when it is not on stage.
   *
   * The chibi frame is 22x46 world px standing on the placement ledger's feet
   * point, which is the same anchor {@link CONNECTOR_TIP_OFFSET_Y} measures from.
   */
  private bodyRect(
    id: string,
    toScreenX: (worldX: number) => number,
    toScreenY: (worldY: number) => number,
    zoom: number,
  ): Rect | null {
    const at = this.anchorPositions.get(id);
    if (at === undefined) return null;
    return {
      x: toScreenX(at.x - BEING_BODY_WIDTH / 2),
      y: toScreenY(at.y - BEING_BODY_HEIGHT),
      width: Math.max(1, BEING_BODY_WIDTH * zoom),
      height: Math.max(1, BEING_BODY_HEIGHT * zoom),
    };
  }

  /** A demoted overlay still says *something*: its glyph stud, on a short stem. */
  private drawDemoted(
    context: CanvasRenderingContext2D,
    slot: TextOverlaySlot | MarkOverlaySlot,
    anchorX: number,
    anchorY: number,
    scale: number,
    fade = 1,
  ): void {
    const glyph = slot.kind === "mark" ? slot.glyph : slot.studGlyph;
    const accent = slot.kind === "mark"
      ? OVERLAY_FAMILY_ACCENT[slot.family]
      : slot.hue;
    buildStud(glyph, accent).surface.blit(
      context,
      anchorX,
      anchorY,
      Math.max(1, scale - 1),
      0.9 * fade,
    );
  }

  /**
   * A 1px dotted ink line from a mark to a receiver cap. A `severed` thread
   * stops at 55% and carries two hard cut-ticks in the family accent — a
   * proposal refused is visibly a bond that *stopped*, not a gift relabelled.
   */
  private drawThread(
    context: CanvasRenderingContext2D,
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
    thread: OverlayThread,
    scale: number,
  ): void {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const length = Math.hypot(dx, dy) || 1;
    const stop = thread.mode === "severed" ? length * 0.55 : length - 4 * scale;
    context.fillStyle = OVERLAY_PALETTE.ink;
    for (let distance = 4 * scale; distance < stop; distance += 4 * scale) {
      const t = distance / length;
      context.fillRect(Math.round(fromX + dx * t), Math.round(fromY + dy * t), scale, scale);
    }
    if (thread.mode !== "severed") return;
    const t = stop / length;
    const tipX = fromX + dx * t;
    const tipY = fromY + dy * t;
    const normalX = -dy / length;
    const normalY = dx / length;
    const unitX = dx / length;
    const unitY = dy / length;
    for (const offset of [-2, 2]) {
      for (let step = -4; step <= 4; step += 1) {
        context.fillStyle = Math.abs(step) > 3 ? OVERLAY_PALETTE.ink : thread.accent;
        context.fillRect(
          Math.round(tipX + normalX * step * scale + unitX * offset * scale),
          Math.round(tipY + normalY * step * scale + unitY * offset * scale),
          scale,
          scale,
        );
      }
    }
  }

  private ambientSlots(): AmbientSlot[] {
    if (this.disposed) return [];
    return [...this.water, ...this.wind, ...this.smoke]
      .filter(isAmbient)
      .sort((left, right) => compareText(left.id, right.id));
  }

  private effectSlots(): EffectSlot[] {
    if (this.disposed) return [];
    return [...this.smoke, ...this.footsteps]
      .filter(isEffect)
      .sort((left, right) => left.sequence - right.sequence);
  }

  private intersectsExclusion(rect: Rect): boolean {
    return this.exclusionZones.some((zone) => rectanglesIntersect(rect, zone));
  }
}

/**
 * The rectangle the overlay may draw into: the canvas minus the viewer's HUD
 * insets, or `null` when the caller supplied no bounds (unit tests, and the
 * ambient 1x path that has no camera to reason about).
 */
function safeFrame(view: OverlayViewport | undefined): Rect | null {
  if (view === undefined || view.width === undefined || view.height === undefined) return null;
  const insets = view.insets ?? { top: 0, right: 0, bottom: 0, left: 0 };
  const width = view.width - insets.left - insets.right;
  const height = view.height - insets.top - insets.bottom;
  if (!(width > 0) || !(height > 0)) return null;
  return { x: insets.left, y: insets.top, width, height };
}

/**
 * Slide a candidate rect back inside the safe frame.
 *
 * A TRANSLATION, never a crop and never a resize: a message that had to move to
 * stay on screen is still whole. When the bubble is larger than the frame in an
 * axis it pins to that edge, so the reader still starts at the first word —
 * `textBubbleScale` is what makes that essentially unreachable.
 */
/** The whole canvas in screen px, or `null` when the caller supplied no bounds. */
function canvasRect(view: OverlayViewport | undefined): Rect | null {
  if (view === undefined || view.width === undefined || view.height === undefined) return null;
  if (!(view.width > 0) || !(view.height > 0)) return null;
  return { x: 0, y: 0, width: view.width, height: view.height };
}

function clampIntoFrame(rect: Rect, frame: Rect | null): Rect {
  if (frame === null) return rect;
  const maxX = frame.x + Math.max(0, frame.width - rect.width);
  const maxY = frame.y + Math.max(0, frame.height - rect.height);
  return {
    x: Math.round(Math.min(Math.max(rect.x, frame.x), maxX)),
    y: Math.round(Math.min(Math.max(rect.y, frame.y), maxY)),
    width: rect.width,
    height: rect.height,
  };
}

function copyThread(thread: OverlayThread): OverlayThread {
  return {
    to: snapPoint(thread.to),
    ...(thread.toId === undefined ? {} : { toId: thread.toId }),
    mode: thread.mode,
    accent: thread.accent,
    hue: thread.hue,
  };
}

function copyCondition(condition: RegionCondition): RegionCondition {
  return {
    energyRatio: finiteOrZero(condition.energyRatio),
    materialsRatio: finiteOrZero(condition.materialsRatio),
  };
}

function copyPoint(point: Vec2): Vec2 {
  return { x: finiteOrZero(point.x), y: finiteOrZero(point.y) };
}

function snapPoint(point: Vec2): Vec2 {
  const copied = copyPoint(point);
  return { x: Math.round(copied.x), y: Math.round(copied.y) };
}

function copyNativeFrame(frame: NativeFrameRef): NativeFrameRef {
  return {
    atlasId: frame.atlasId,
    rect: {
      x: frame.rect.x,
      y: frame.rect.y,
      width: frame.rect.width,
      height: frame.rect.height,
    },
    durationMs: frame.durationMs,
    feet: { x: frame.feet.x, y: frame.feet.y },
    faceAnchor: { x: frame.faceAnchor.x, y: frame.faceAnchor.y },
    heldAnchor: { x: frame.heldAnchor.x, y: frame.heldAnchor.y },
  };
}

function copyRect(rect: Rect): Rect {
  return {
    x: finiteOrZero(rect.x),
    y: finiteOrZero(rect.y),
    width: Math.max(0, finiteOrZero(rect.width)),
    height: Math.max(0, finiteOrZero(rect.height)),
  };
}

function finiteOrZero(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function fixedPool<T>(capacity: number): Array<T | null> {
  return Array.from({ length: capacity }, () => null);
}

function comparePlacements(left: AnimatedEnvironmentPlacement, right: AnimatedEnvironmentPlacement): number {
  return compareText(left.id, right.id)
    || compareText(left.kind, right.kind)
    || left.tile.row - right.tile.row
    || left.tile.column - right.tile.column
    || left.phaseSeed - right.phaseSeed;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function poolFor(kind: AnimatedEnvironmentKind): AmbientPool {
  if (kind === "water") return "water";
  if (kind === "smoke-anchor" || kind === "ember") return "smoke";
  return "wind";
}

function insertFirstEmpty<T>(pool: Array<T | null>, value: T): boolean {
  const index = pool.indexOf(null);
  if (index < 0) return false;
  pool[index] = value;
  return true;
}

function expireEffects(
  pool: Array<AmbientSlot | EffectSlot | null> | Array<EffectSlot | null>,
  nowMs: number,
): void {
  for (let index = 0; index < pool.length; index += 1) {
    const value = pool[index];
    if (isEffect(value) && value.expiresAtMs <= nowMs) pool[index] = null;
  }
}

/** Generic bounded-lifetime expiry for pools that leave nothing behind. */
function expireByDeadline<T extends { readonly expiresAtMs: number }>(pool: Array<T | null>, nowMs: number): void {
  for (let index = 0; index < pool.length; index += 1) {
    const value = pool[index];
    if (value !== null && value.expiresAtMs <= nowMs) pool[index] = null;
  }
}

function hasAnyActive<T>(pool: readonly (T | null)[]): boolean {
  return pool.some((value) => value !== null);
}

function isAmbient(value: AmbientSlot | EffectSlot | null): value is AmbientSlot {
  return value !== null && "phaseSeed" in value;
}

function isEffect(value: AmbientSlot | EffectSlot | null): value is EffectSlot {
  return value !== null && "expiresAtMs" in value;
}

function minimumAmbientDeadline(
  pool: readonly (AmbientSlot | EffectSlot | null)[],
  current: number | null,
  nowMs: number,
): number | null {
  let deadline = current;
  for (const slot of pool) {
    if (!isAmbient(slot)) continue;
    const frameDuration = slot.frame?.durationMs ?? 240;
    deadline = minimumFuture(deadline, nextPhaseDeadline(nowMs, slot.phaseSeed, frameDuration), nowMs);
  }
  return deadline;
}

function minimumEffectDeadline(
  pool: readonly (AmbientSlot | EffectSlot | null)[],
  current: number | null,
  nowMs: number,
): number | null {
  let deadline = current;
  for (const slot of pool) {
    if (isEffect(slot)) deadline = minimumFuture(deadline, slot.expiresAtMs, nowMs);
  }
  return deadline;
}

function hasEffect(pool: readonly (AmbientSlot | EffectSlot | null)[]): boolean {
  for (const slot of pool) {
    if (isEffect(slot)) return true;
  }
  return false;
}

function countActive(values: readonly unknown[]): number {
  return values.filter((value) => value !== null).length;
}

function phaseIndex(slot: AmbientSlot, nowMs: number): number {
  const duration = slot.frame?.durationMs ?? 240;
  const cycle = duration * ANIMATED_FRAME_COUNT;
  const phaseOffset = slot.phaseSeed % cycle;
  return Math.floor((nowMs + phaseOffset) / duration) % ANIMATED_FRAME_COUNT;
}

function seededSettledPhase(seed: number): number {
  return seed % ANIMATED_FRAME_COUNT;
}

function nextPhaseDeadline(nowMs: number, phaseSeed: number, durationMs: number): number {
  const remainder = (nowMs + (phaseSeed % durationMs)) % durationMs;
  return nowMs + (remainder === 0 ? durationMs : durationMs - remainder);
}

function nextMultipleAfter(nowMs: number, stepMs: number): number {
  return (Math.floor(nowMs / stepMs) + 1) * stepMs;
}

function minimumFuture(current: number | null, candidate: number, nowMs: number): number | null {
  if (!Number.isFinite(candidate) || candidate <= nowMs) return current;
  return current === null || candidate < current ? candidate : current;
}

function ambientAlpha(vitality: number): number {
  return 0.55 + Math.max(0, Math.min(1, vitality)) * 0.45;
}

function frameKey(slot: AmbientSlot): string {
  const frame = slot.frame;
  if (!frame) return `${slot.id}:${slot.kind}:neutral`;
  return `${slot.id}:${slot.kind}:${frame.atlasId}:${frame.rect.x},${frame.rect.y},${frame.rect.width},${frame.rect.height}`;
}

function effectKey(slot: EffectSlot): string {
  const label = slot.label === null ? "" : `:${slot.label.recipientId}=${slot.label.value}`;
  return `${slot.sequence}:${slot.kind}:${slot.at.x},${slot.at.y}:${slot.startedAtMs}-${slot.expiresAtMs}${label}`;
}

/**
 * How opaque a bubble is right now: 1 until its last {@link TEXT_FADE_OUT_MS},
 * then a linear ramp to 0 at its deadline.
 *
 * One function for both ways a bubble leaves — running out of its 5-7s, or
 * being superseded (which simply pulls the deadline into this tail). Nothing
 * pops.
 */
export function textFadeAlpha(
  slot: Readonly<Pick<TextOverlaySlot, "expiresAtMs">>,
  nowMs: number,
): number {
  const remaining = slot.expiresAtMs - nowMs;
  if (remaining >= TEXT_FADE_OUT_MS) return 1;
  return Math.max(0, Math.min(1, remaining / TEXT_FADE_OUT_MS));
}

function effectPosition(slot: EffectSlot, nowMs: number, reducedMotion: boolean): Vec2 {
  if (reducedMotion || slot.kind === "footstep") return snapPoint(slot.at);
  const age = Math.max(0, nowMs - slot.startedAtMs);
  const drift = Math.floor(age / 160);
  const direction = slot.sequence % 2 === 0 ? -1 : 1;
  return {
    x: Math.round(slot.at.x + direction * Math.floor(drift / 2)),
    y: Math.round(slot.at.y - drift),
  };
}

function effectFootprint(kind: ParticleKind, at: Vec2): Rect {
  const snapped = snapPoint(at);
  if (kind === "footstep") {
    return { x: snapped.x - 2, y: snapped.y - 1, width: 4, height: 2 };
  }
  return { x: snapped.x - 1, y: snapped.y - 1, width: 3, height: 3 };
}

/** A small pixel-art diamond glyph — shared silhouette for flying items, tinted per icon. */
function drawCarriableGlyph(context: CanvasRenderingContext2D, at: Vec2): void {
  for (let row = -2; row <= 2; row += 1) {
    const halfWidth = 2 - Math.abs(row);
    context.fillRect(at.x - halfWidth, at.y + row, halfWidth * 2 + 1, 1);
  }
}

function rectanglesIntersect(left: Rect, right: Rect): boolean {
  return left.width > 0
    && left.height > 0
    && right.width > 0
    && right.height > 0
    && left.x < right.x + right.width
    && left.x + left.width > right.x
    && left.y < right.y + right.height
    && left.y + left.height > right.y;
}
