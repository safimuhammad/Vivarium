import type { FrameIdentity } from "../../presentation/contracts";
import type { Vec2 } from "../contracts";
import type { HumanPrimitiveCommand } from "./actors/LayeredHumanActor";
import type { EnvironmentEffectRequest } from "./environment/EnvironmentSystem";
import type { HomePrimitiveCommand } from "./homes/HomeActor";
import type { RegionKitId } from "./maps/biomeKits";
import type { AgentPlacementContext } from "./placement/PlacementLedger";

interface SceneCommandBase {
  readonly commandId: string;
}

export type ProductionSceneCommand =
  | Readonly<SceneCommandBase & {
    kind: "actor";
    actorId: string;
    command: HumanPrimitiveCommand;
  }>
  | Readonly<SceneCommandBase & {
    kind: "home";
    homeId: string;
    command: HomePrimitiveCommand;
  }>
  | Readonly<SceneCommandBase & {
    kind: "create-provisional-home";
    homeId: string;
    regionId: string;
    plotId: string;
    plot: Vec2;
    door: Vec2;
    kit: RegionKitId;
  }>
  | Readonly<SceneCommandBase & {
    kind: "environment";
    request: EnvironmentEffectRequest;
  }>
  | Readonly<SceneCommandBase & {
    kind: "hit-stop";
    actorIds: readonly string[];
    durationMs: number;
  }>
  | Readonly<SceneCommandBase & {
    kind: "camera-impulse";
    offset: Vec2;
    durationMs: number;
  }>
  | Readonly<SceneCommandBase & {
    kind: "remote-transient";
    motif: "portrait" | "atlas" | "vignette";
    sourceId: string | null;
    targetId: string | null;
    at: Vec2 | null;
  }>
  | Readonly<SceneCommandBase & {
    kind: "placement-hint";
    agentId: string;
    context: Extract<AgentPlacementContext, { kind: "birth" | "arrival" }>;
    arrivalGate?: Vec2;
    requestedFinal?: Vec2;
  }>
  | Readonly<SceneCommandBase & {
    kind: "retain-traveler";
    actorId: string;
    fromRegion: string;
    toRegion: string;
  }>
  | Readonly<SceneCommandBase & {
    /**
     * The door-anchored home-interaction motion contract (SpatialDirector):
     * make an actor already standing at a home's door read as having gone
     * inside for the duration of a hearth/hoarding/join/leave beat's
     * hold-through-consequence window, or reveal it again as the beat's
     * recover phase begins the return walk. Out-of-band, like
     * `"stage-arrival"`/`"placement-hint"` -- applied via
     * `ProductionHumanActor.beginPresenceVanish`/`beginPresenceReveal`
     * rather than through the ordinary `HumanPrimitiveCommand` union, since
     * it is pure presentation state, never simulation truth.
     */
    kind: "presence-fade";
    actorId: string;
    mode: "vanish" | "reveal";
  }>
  | Readonly<SceneCommandBase & {
    kind: "stage-arrival";
    actorId: string;
    fromRegion: string;
    toRegion: string;
    eventType: "agent_entered_region";
    phase: "hold";
    momentId: string;
    programId: string;
  }>
  | Readonly<SceneCommandBase & { kind: "clear-scene" }>;

export interface ProductionSceneCommandBatch {
  readonly identity: FrameIdentity;
  readonly sceneToken: number;
  readonly commands: readonly ProductionSceneCommand[];
}

export type ProductionSceneCommandOutcome =
  | "applied"
  | "duplicate"
  | "ignored"
  | "stale-scene"
  | "stale-identity"
  | "invalid";

/**
 * Why the scene graph refused one command.
 *
 * `blocked-ground` and `object-exclusion` are deliberately separate: they are
 * the two halves of the terrain seam. Ground (water, cliff, thicket, a bridge
 * deck) is judged by the DESTINATION TILE's `grid.collision`; objects (home
 * footprints, tall scenic landmarks) are judged by the being's whole rendered
 * standing envelope against their rects. Seeing which one fired is the
 * difference between "he tried to walk into the river" and "he tried to walk
 * through a house".
 */
export type ProductionSceneCommandRejectionReason =
  | "duplicate"
  | "unknown-actor"
  | "terminal-actor"
  | "paralyzed"
  | "reserved-reposition-reason"
  | "object-exclusion"
  | "blocked-ground"
  | "fallback-not-authorized"
  | "unknown-home"
  | "ruin-command"
  | "missing-evidence-cursor"
  | "invalid-provisional-home"
  | "traveler-not-retainable"
  | "unconsumed-out-of-band"
  | "no-environment"
  | "stale-batch"
  | "frame-rejected";

/**
 * One refused command, with enough context to answer "why did nothing happen"
 * without a debugger.
 *
 * The scene graph used to drop commands by pushing the id onto `ignored` and
 * `continue`-ing, with no diagnostic at all — which is precisely how beings
 * came to mime interaction beats fifteen tiles apart from each other for a
 * whole chronicle (see `.superpowers/sdd/convergence-report.md`). Every
 * `ignored` id now carries one of these.
 */
export interface ProductionSceneCommandRejection {
  readonly commandId: string;
  readonly commandKind: ProductionSceneCommand["kind"];
  /** The actor or home the command addressed, when it addressed one. */
  readonly subjectId: string | null;
  readonly reason: ProductionSceneCommandRejectionReason;
  /** Human-readable specifics — the blocked tile, the offending region, ... */
  readonly detail: string;
}

export interface ProductionSceneCommandResult {
  readonly outcome: ProductionSceneCommandOutcome;
  readonly appliedCommandIds: readonly string[];
  readonly ignoredCommandIds: readonly string[];
  /**
   * One entry per id in {@link ignoredCommandIds}, in the same order, naming
   * why that command was refused. Never silent.
   */
  readonly rejections: readonly ProductionSceneCommandRejection[];
}

/** Native visual signal retained for diagnostics; never a causal settlement signal. */
export interface ProductionSceneSignal {
  readonly serial: number;
  readonly sceneToken: number;
  readonly commandId: string;
  readonly subjectId: string | null;
  readonly marker: string;
  readonly atMs: number;
}
