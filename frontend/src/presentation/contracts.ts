import type { SnapshotCheckpoint } from "../app/replayArtifacts";
import type { PresentedEventType } from "./eventPayloads";
import type {
  AgentSnapshot,
  EventEnvelopeEntry,
  HomeSnapshot,
  PendingProposalSnapshot,
  RegionPressureHighWater,
  RegionSnapshot,
  RunStatus,
} from "../app/schemas";
import type {
  CameraMode,
  DialogueState,
  Direction4,
  SafeFrameInsets,
  Vec2,
} from "../renderer2d/contracts";
import type { RegionKitId } from "../renderer2d/production/maps/biomeKits";

export type { CameraMode, DialogueState, Direction4, SafeFrameInsets, Vec2 };

export type PresentationSource = "live" | "archive" | "fixture";

export interface CursorRange {
  readonly firstCursor: number;
  readonly lastCursor: number;
}

export interface FrameIdentity extends CursorRange {
  readonly runId: string;
  readonly sourceKey: string;
  readonly revision: number;
}

export type StoryFocus =
  | { readonly kind: "agent" | "home" | "ruin" | "region"; readonly id: string }
  | { readonly kind: "system"; readonly regionId: string | null };

/**
 * WHERE a moment happened, carried with the moment so it can be navigated to
 * after it has left the stage.
 *
 * A moment focus request used to be resolvable only against the scene the
 * renderer happened to be playing at that instant, so every Chronicle card
 * except the one on stage was a silent dead click: the handler fired, the focus
 * request was published, and the renderer resolved it to nothing. The anchor is
 * the moment's own place -- the being or structure its story focus named, and
 * the region its evidence happened in -- resolved once by the presentation (the
 * only layer that still holds the moment) and carried on the selection so the
 * renderer can travel there long afterwards.
 *
 * Optional on the selection so every seam that predates it, and every caller
 * that only means "select this moment", is unaffected.
 */
export interface MomentAnchor {
  /** The being or structure the moment's story focus named, when it named one. */
  readonly entity: Readonly<{
    readonly kind: "agent" | "home" | "ruin";
    readonly id: string;
  }> | null;
  /** The region the moment happened in, when its evidence named one. */
  readonly regionId: string | null;
  /**
   * True while this moment is the world's present tense: the moment on stage,
   * or -- between beats -- the newest one the Chronicle still keeps.
   *
   * Viewing the present must not take the camera away from the director, which
   * is the same rule the Chronicle feed already applies to its own playhead when
   * its leading card is clicked. Every other moment is a journey away from the
   * live edge, and takes framing with it.
   */
  readonly atLiveEdge: boolean;
}

export type ObserverSelection =
  | { readonly kind: "agent" | "home" | "ruin" | "region"; readonly id: string }
  | {
      readonly kind: "moment";
      readonly id: string;
      readonly firstCursor: number;
      readonly lastCursor: number;
      readonly anchor?: MomentAnchor;
    }
  | null;

export interface PresentedRecord<T> {
  readonly completeness: "exact" | "projected-partial";
  readonly value: Readonly<Partial<T>>;
}

export interface PresentedWorldView {
  readonly exactBaseCursor: number;
  readonly projectedThroughCursor: number;
  readonly worldTime: number;
  /** Exact checkpoint partitions retained beside the projected visible records. */
  readonly exactHomes?: readonly HomeSnapshot[];
  readonly exactRuins?: readonly HomeSnapshot[];
  readonly agents: readonly PresentedRecord<AgentSnapshot>[];
  readonly regions: readonly PresentedRecord<RegionSnapshot>[];
  readonly homes: readonly PresentedRecord<HomeSnapshot>[];
  readonly ruins: readonly PresentedRecord<HomeSnapshot>[];
  readonly pendingProposals: readonly PendingProposalSnapshot[];
  /** Exact checkpoint truth; event projection never synthesizes historical maxima. */
  readonly regionPressure?: readonly RegionPressureHighWater[];
}

export type ActorVisualIntentKind =
  | "orient"
  | "move"
  | "idle"
  | "speak"
  | "reach"
  | "work"
  | "kneel"
  | "gather"
  | "hurt"
  | "prone"
  | "recover"
  | "dead"
  | "fade-reposition";

export interface ActorVisualIntent {
  readonly actorId: string;
  readonly kind: ActorVisualIntentKind;
  /**
   * Why a `fade-reposition` is not a walk.
   *
   * Only `distance-cut` is ever declared: the deliberate choice
   * (`choreography/locomotionGate.ts`) that this destination was too far for a
   * walk to read as anything but trudging. Absent, a reposition keeps its older
   * reading — a motion preference, or a route that could not be planned.
   */
  readonly repositionReason?: "distance-cut";
  readonly target: Readonly<{ x: number; y: number }> | null;
  /** Exact immutable Task 6 route retained for movement commands; target remains its endpoint. */
  readonly waypoints?: readonly Vec2[];
  /**
   * Where a truncated walk is cut to before it walks the part worth watching.
   *
   * Declared only on a `move` whose route was bounded by
   * `choreography/locomotionGate.ts`'s `boundLocomotion` — today, the departure
   * half of a region transition, which may not be cut away entirely (a being
   * must be *seen* leaving through its own gate) but may not cost the stage
   * thirty seconds either. The being is repositioned to this point and then
   * walks the remaining route from it.
   *
   * **It is always one of `waypoints`' own points, and always the first of
   * them.** That is the whole legality argument: the renderer accepts a
   * reposition to any point whose standing envelope is clear, and
   * `presentationRouteIsClear` already swept every waypoint's envelope when it
   * accepted the untruncated route. So a truncated walk is legal exactly when
   * the walk it was cut from was legal — nothing new is asserted about the map.
   */
  readonly cutFrom?: Readonly<{ x: number; y: number }>;
  /** Cardinal endpoint orientation when the choreography has authoritative gate/route facing. */
  readonly facing?: Direction4;
  readonly marker: string | null;
}

interface HomeVisualIntentBase {
  readonly homeId: string;
  readonly marker: string | null;
}

/** A transient build reservation rendered before any durable home is published. */
export interface ProvisionalHomeVisualIntent extends HomeVisualIntentBase {
  readonly kind: "create-provisional";
  readonly regionId: string;
  readonly plotId: string;
  readonly plot: Vec2;
  readonly door: Vec2;
  readonly kit: RegionKitId;
}

export type HomeVisualIntent =
  | ProvisionalHomeVisualIntent
  | Readonly<HomeVisualIntentBase & {
    readonly kind:
      | "build"
      | "door"
      | "hearth"
      | "damage"
      | "loot"
      | "claim"
      | "collapse";
  }>
  | Readonly<HomeVisualIntentBase & {
    readonly kind: "scavenge";
    /** Current-event truth used only until an exact checkpoint confirms the ruin. */
    readonly remnantMaterialsAfter: number;
  }>;

export interface EffectVisualIntent {
  readonly kind:
    | "particle"
    | "arc"
    | "portrait"
    | "atlas-transition"
    | "camera-impulse"
    | "vignette"
    | "bond-token"
    | "speech-bubble"
    | "flying-item"
    | "impact"
    | "carried-badge"
    | "structure-beat";
  readonly sourceId: string | null;
  readonly targetId: string | null;
  /** Exact evidence label, such as a recipient's unequal material share. */
  readonly label?: string;
  /** `speech-bubble` only: verbatim event-payload text, never invented. */
  readonly text?: string;
  /** `speech-bubble` only: spoken (aloud/broadcast), thought (private self_talk), or whisper (same-region targeted). */
  readonly variant?: "spoken" | "thought" | "whisper";
  /** `bond-token` only: forming (a proposal standing) or breaking (rejected/invalidated/timed out). */
  readonly tokenState?: "forming" | "breaking";
  /** `flying-item` / `carried-badge` only: which glyph to render. */
  readonly icon?: "energy" | "materials" | "loot" | "gift";
  /** `impact` only: which side of the impact this floating number/label represents. */
  readonly polarity?: "damage" | "cost" | "status";
  /** `carried-badge` only: `true` clears the actor's badge (deposited/transferred); otherwise starts or refreshes it. */
  readonly clearBadge?: boolean;
  /** `structure-beat` only: which home-lifecycle beat this icon marks. */
  readonly structureIcon?:
    | "build" | "hearth" | "join" | "leave" | "hoard" | "collapse" | "breach" | "claim" | "scavenge";
}

export interface PresentedSceneView {
  readonly momentId: string;
  readonly regionId: string | null;
  readonly phase: "enter" | "hold" | "consequence" | "recover" | "exit";
  readonly focus: StoryFocus;
  readonly dialogue: DialogueState | null;
  readonly actorIntents: readonly ActorVisualIntent[];
  readonly homeIntents: readonly HomeVisualIntent[];
  readonly effectIntents: readonly EffectVisualIntent[];
  readonly safeCancelMarkers: readonly string[];
  readonly reducedMotion: boolean;
  /** Runtime identity is attached only when the retained plan becomes an observer frame. */
  readonly execution?: SceneExecutionIdentity;
}

export interface SceneExecutionIdentity {
  readonly sceneToken: number;
  readonly programId: string;
  /** Typed current-event authority; legacy deterministic seams may omit it. */
  readonly eventType?: PresentedEventType;
}

/**
 * One display-only beat: words over a being's head that occupy no body.
 *
 * The second lane of the 2026-07-31 presentation split. An utterance never
 * books stage time, never queues, and never stops the being it belongs to from
 * walking while it is up; it is raised as an overlay with its own clock and
 * fades on its own. Its being may be mid-scene, mid-walk, or doing nothing at
 * all — the overlay is anchored to the being, not to a scene.
 *
 * Frames carry a small rolling window of the most recent utterances rather than
 * a one-shot delivery, so a re-published or deduplicated frame cannot lose one.
 * Consumers dedupe on `momentId` + `cursor`.
 */
export interface PresentedUtterance {
  readonly momentId: string;
  readonly cursor: number;
  /** Whose head the words appear over. */
  readonly beingId: string;
  /** The addressee, when the words had one, else null. */
  readonly targetId: string | null;
  readonly regionId: string | null;
  readonly text: string;
  readonly variant: "spoken" | "thought" | "whisper";
  readonly eventType: "speak" | "self_talk";
}

/**
 * One out-of-band physical beat that stages a conversation, and nothing else.
 *
 * The third thing a frame can carry, after the scene (one body, serialised) and
 * the utterance overlay (no body at all). A staging beat DOES occupy a body —
 * a being walks — but it takes no stage lease, books no settlement handshake
 * and is published on the same non-advancing scene token the utterance lane
 * uses, so it can never block, delay or disturb a running scene.
 *
 * It exists because the backend publishes a region and an action but never a
 * position: if two beings are talking to each other, only the frontend can
 * decide that they should be standing together while they do it. See
 * `conversationStaging.ts` for the rule, and why an approach that is not
 * legal, not local, or not free is simply not staged rather than forced.
 *
 * Frames carry a bounded rolling window of the newest beats, exactly like
 * `utterances`, so a deduplicated republication cannot lose one. Consumers
 * dedupe on `id`.
 */
export type PresentedStagingBeat =
  | Readonly<{
    readonly id: string;
    readonly kind: "flash-step";
    /** The being that moves — always the ADDRESSEE, never the speaker. */
    readonly beingId: string;
    readonly regionId: string;
    /**
     * The legal standing point beside the speaker the addressee appears at.
     *
     * The END of a route resolved by `interactionContact.ts`'s
     * `resolveLegalContactRoute` — the same primitive every two-participant
     * beat already walks on — so the renderer's own apply-time gates cannot
     * silently veto it. Only the traversal is dropped; the destination is
     * chosen exactly as it was when the addressee walked there.
     */
    readonly to: Readonly<{ x: number; y: number }>;
  }>
  | Readonly<{
    readonly id: string;
    readonly kind: "face";
    readonly beingId: string;
    readonly regionId: string;
    readonly facing: Direction4;
  }>;

export interface PresentationBacklog {
  readonly pendingMoments: number;
  readonly firstPendingCursor: number | null;
  readonly lastPendingCursor: number | null;
  readonly state: "caught-up" | "behind" | "paused" | "overflow";
  readonly label: string;
}

export interface PresentationGap {
  readonly firstCursor: number;
  readonly lastCursor: number;
  readonly chapter: "while-away" | "world-moved-ahead";
  readonly archiveAvailable: boolean;
}

export interface ObserverTransportState {
  readonly connection:
    | "connecting"
    | "live"
    | "rejoining"
    | "recovery-paused"
    | "offline"
    | "error";
  readonly ingestedCursor: number;
  readonly retryable: boolean;
}

/**
 * A fault the presentation absorbed but a watcher must still be told about.
 *
 * Everything on this list was, before it existed, silent: an unpresentable
 * moment vanished into `PresentationIngress`'s isolation catch and a Canvas that
 * would not sign a receipt froze the stage while the chrome read "live". A
 * silent zero is the worst failure mode a live view has, so absorbed faults are
 * counted and published rather than swallowed.
 */
export interface PresentationNotice {
  readonly kind:
    /** Canvas never signed the receipt for a consequence frame; the barrier gave up. */
    | "canvas-receipt"
    /** A moment could not be resolved into a scene and was dropped, not performed. */
    | "unpresentable-moment"
    /**
     * The viewer asked to be taken to a moment that cannot be reached: it has
     * left what the Chronicle keeps, or it happened nowhere the world can show.
     *
     * Retired the instant a later request succeeds, because unlike the two
     * faults above this one is about the click a viewer just made, not about a
     * fault the run absorbed. A dead click IS the complaint this exists for.
     */
    | "unreachable-moment";
  /** One short, watcher-safe sentence. Never raw payload text. */
  readonly detail: string;
  readonly firstCursor: number | null;
  readonly lastCursor: number | null;
  /** How many times this kind has fired since the run was joined. */
  readonly count: number;
}

/**
 * Whether a silent world is thinking, lagging, unreachable, or over.
 *
 * In this world twenty minutes of silence is normal, and the sim self-terminates
 * at `duration`. Without these facts a finished run, a dead socket and four
 * beings deep in thought are the same picture.
 */
export interface PresentationLiveness {
  /**
   * Run lifecycle exactly as the run-metadata endpoint reports it.
   *
   * The whole vocabulary, not a subset: the run-lifecycle API reports
   * `starting`, `stopping` and `failed` on the ordinary path, and narrowing them
   * away here would make a run that ended read as one still thinking.
   */
  readonly runStatus: RunStatus;
  /**
   * Presentation-clock reading of the newest signal from the stream — an event
   * batch OR a heartbeat. `null` before the first one arrives.
   */
  readonly lastSignalAtMs: number | null;
  /** Whether that newest signal was a heartbeat rather than events. */
  readonly lastSignalWasHeartbeat: boolean;
  /** World time the newest heartbeat reported, `null` if none has arrived. */
  readonly heartbeatWorldTime: number | null;
}

export type LiveCutSafety = "safe-world-tick" | "archive-event" | "archive-manual";

export interface ClassifiedCheckpointRecord {
  readonly line: number;
  readonly checkpoint: SnapshotCheckpoint;
  readonly safety: LiveCutSafety;
}

export interface PresentationIngressFault {
  readonly kind: "cursor-gap" | "run-mismatch";
  readonly firstMissingCursor: number;
  readonly lastMissingCursor: number;
}

export interface AcceptedEvidenceBatch extends CursorRange {
  readonly runId: string;
  readonly sourceKey: string;
  readonly entries: readonly EventEnvelopeEntry[];
}

export interface PresentationIngressSnapshot {
  readonly runId: string | null;
  readonly sourceKey: string | null;
  readonly ingestedCursor: number;
  readonly acceptedCount: number;
  readonly duplicateCount: number;
  readonly gaps: readonly PresentationIngressFault[];
}

/**
 * The presentation playback sample used to draw backend-recorded spatial
 * routes.  It is intentionally separate from `world.worldTime`: that value is
 * an exact checkpoint fact and must not become an advancing archive clock.
 */
export interface PresentedSpatialPlayback {
  /** Simulation seconds sampled from the session's real playback clock. */
  readonly sampledAt: number;
  /** Current viewer playback multiplier. */
  readonly speed: number;
  /** True while the viewer has frozen playback. */
  readonly paused: boolean;
}

export interface PresentedObserverFrame extends FrameIdentity {
  readonly source: PresentationSource;
  /** Actual run metadata; omitted where a recording does not identify its model. */
  readonly inference?: Readonly<{ provider: string; model: string }>;
  readonly ingestedCursor: number;
  readonly presentedCursor: number;
  readonly world: PresentedWorldView;
  /** Present only while the exact session snapshot declares a spatial map. */
  readonly spatialPlayback?: PresentedSpatialPlayback;
  readonly scene: PresentedSceneView | null;
  /**
   * The overlay lane: display-only beats published without a stage lease.
   *
   * A rolling, bounded window of the newest utterances rather than a one-shot
   * delivery, so a deduplicated republication cannot drop one. Optional because
   * every deterministic seam that builds a frame literal predates the lane and
   * simply has none.
   */
  readonly utterances?: readonly PresentedUtterance[];
  /**
   * The staging lane: conversational approaches published without a stage lease.
   *
   * A bounded rolling window for the same reason `utterances` is one. Optional
   * because every deterministic seam that builds a frame literal predates the
   * lane and simply has none.
   */
  readonly staging?: readonly PresentedStagingBeat[];
  /**
   * Observer-only checkpoint camera beat. Production sessions always publish this
   * field; older deterministic seams may omit it while migrating frame literals.
   */
  readonly checkpointFocus?: CheckpointFocusTarget | null;
  readonly selection: ObserverSelection;
  readonly backlog: PresentationBacklog;
  readonly transport: ObserverTransportState;
  /**
   * Absorbed-but-loud faults. Optional because every deterministic seam that
   * builds a frame literal predates the channel and simply has none.
   */
  readonly notices?: readonly PresentationNotice[];
  /** Quiet/behind/disconnected/ended evidence. Optional for the same reason. */
  readonly liveness?: PresentationLiveness;
}

/** One bounded, readable structural target selected from a silent checkpoint correction. */
export interface CheckpointFocusTarget {
  readonly regionId: string;
  readonly kind: "home" | "ruin" | "region";
  readonly entityId: string | null;
  /** Zero-based position in the current checkpoint's deterministic focus sequence. */
  readonly segmentIndex: number;
  readonly segmentCount: number;
  /** Region targets use this to mean corrected structures disappeared from the exact cut. */
  readonly removed: boolean;
}

/** Throws when an identity could admit a stale or internally inverted frame. */
export function assertValidFrameIdentity(identity: FrameIdentity): void {
  if (identity.runId.trim().length === 0) {
    throw new Error("runId must not be empty");
  }
  if (identity.sourceKey.trim().length === 0) {
    throw new Error("sourceKey must not be empty");
  }
  if (!Number.isSafeInteger(identity.revision) || identity.revision < 0) {
    throw new Error("revision must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(identity.firstCursor) || identity.firstCursor < 0) {
    throw new Error("firstCursor must be a non-negative safe integer");
  }
  if (!Number.isSafeInteger(identity.lastCursor) || identity.lastCursor < 0) {
    throw new Error("lastCursor must be a non-negative safe integer");
  }
  if (identity.firstCursor > identity.lastCursor) {
    throw new Error("firstCursor must not exceed lastCursor");
  }
}
