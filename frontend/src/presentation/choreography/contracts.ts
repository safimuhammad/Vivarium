import type { PlacementLedgerSnapshot } from "../../renderer2d/production/placement/PlacementLedger";
import type { RegionMapRecipeV1 } from "../../renderer2d/production/maps/RegionMapRecipe";
import type { NavigationGrid } from "../../renderer2d/production/navigation/navigation";
import type { StoryMoment } from "../BeatDirector";
import type {
  PresentedObserverFrame,
  PresentedSceneView,
} from "../contracts";
import type {
  PresentedEventType,
  TypedPresentedEvent,
} from "../eventPayloads";
import type {
  SceneMarkerRole,
  SceneRuntimeMarker,
  SceneRuntimeProgram,
} from "../SceneSettlementCoordinator";

export type { SceneMarkerRole, SceneRuntimeMarker } from "../SceneSettlementCoordinator";

/** Semantic participant roles resolved from typed event payloads, never display prose. */
export type ParticipantRole =
  | "actor"
  | "target"
  | "giver"
  | "recipient"
  | "victim"
  | "killer"
  | "initiator"
  | "acceptor"
  | "child"
  | "owner"
  | "breacher"
  | "stakeholder";

/** Renderer-independent anchor roles that a choreography may request. */
export type AnchorRole =
  | "current-position"
  | "social"
  | "resource-energy"
  | "resource-materials"
  | "home-door"
  | "home-plot"
  | "ruin"
  | "arrival-gate"
  | "departure-gate"
  | "atlas";

export type RequiredParticipantFallback = "nearest-staging-fade-reposition";
export type OptionalParticipantFallback = "omit-flourish";

/** Explicit no-invention policy owned by every definition. */
export interface MissingParticipantBehavior {
  readonly required: RequiredParticipantFallback;
  readonly optional: OptionalParticipantFallback;
  readonly diagnostic: string;
}

/** Participant identities retained in the resolved immutable plan. */
export interface ResolvedParticipant {
  readonly role: ParticipantRole;
  readonly ids: readonly string[];
}

/** Stable observer-facing fallback/evidence note; never a causal input. */
export interface ChoreographyDiagnostic {
  readonly code: string;
  readonly role: ParticipantRole | null;
  readonly detail: string;
}

/** Endpoint parity retained across normal and reduced-motion plans. */
export interface ChoreographyEndpoint {
  readonly regionId: string | null;
  readonly focus: PresentedSceneView["focus"];
  readonly participantIds: readonly string[];
  readonly consequenceMarker: string;
  readonly settleMarker: string;
}

/** One fully resolved immutable marker program for an accepted story moment. */
export interface ChoreographyPlan extends SceneRuntimeProgram {
  readonly momentId: string;
  readonly eventType: PresentedEventType;
  readonly regionId: string | null;
  readonly contactMarker: string;
  readonly participants: readonly ResolvedParticipant[];
  readonly diagnostics: readonly ChoreographyDiagnostic[];
  readonly reducedMotionEndpoint: ChoreographyEndpoint;
}

/** Exact evidence and world/placement truth available once at scene start. */
export interface ChoreographyContext<T extends PresentedEventType> {
  readonly moment: StoryMoment;
  readonly event: Extract<TypedPresentedEvent, { readonly type: T }>;
  readonly frame: PresentedObserverFrame;
  readonly placement: PlacementLedgerSnapshot;
  readonly recipes: ReadonlyMap<string, RegionMapRecipeV1>;
  readonly reducedMotion: boolean;
  /**
   * QA-only: route `resource_changed` harvests to the nearest EXISTING resource
   * anchor to the actor's own placement instead of the canonical
   * `stableHash(actorId:resourceType) % anchors.length` pick (see
   * `resolveResourceRoute` in `lifecycleMovementCommunicationResource.ts`).
   * Defaults to `false` everywhere except when a QA harness explicitly opts a
   * chronicle in (currently only C19); never touches recipe data itself.
   */
  readonly compactResourceRouting: boolean;
  /**
   * The named region's live navigation grid, or `null` when unresolvable.
   *
   * Mirrors `ProductionSceneCommandResolverOptions.getNavigationGrid` (see
   * `ProductionSceneCommandResolver.ts` and `PlacementLedger.navigationGridFor`):
   * the same single accessor for a region's frozen recipe grid, reused here rather
   * than duplicated, so a choreography that needs to gate a candidate point
   * against real ground legality (e.g. `homeContestSystem.ts`'s predicted spread
   * hop) reads the exact same terrain the scene graph and command resolver do.
   * Optional and defaults to "no grid known" (spread predictions stay
   * permissive, matching prior behaviour) so fixture-only callers are unaffected.
   */
  readonly getNavigationGrid?: (regionId: string) => NavigationGrid | null;
}

/** Declarative metadata and deterministic resolver for one canonical event type. */
export interface ChoreographyDefinition<T extends PresentedEventType = PresentedEventType> {
  readonly eventType: T;
  readonly participants: readonly ParticipantRole[];
  readonly requiredAnchors: readonly AnchorRole[];
  readonly contactMarker: string;
  readonly consequenceMarker: string;
  readonly safeCancelMarkers: readonly string[];
  readonly duration: Readonly<{ readonly minMs: number; readonly maxMs: number }>;
  readonly missingParticipant: MissingParticipantBehavior;
  resolve(context: ChoreographyContext<T>): ChoreographyPlan;
}

/** Existential union retaining each event definition's correlated resolver input. */
export type AnyChoreographyDefinition = {
  readonly [K in PresentedEventType]: ChoreographyDefinition<K>;
}[PresentedEventType];

/** A registry remains partial until all independently owned families are integrated. */
export type ChoreographyRegistry = Readonly<Partial<{
  readonly [K in PresentedEventType]: ChoreographyDefinition<K>;
}>>;

/** Executor inspection state; diagnostics only and never model authority. */
export interface SceneExecutionSnapshot {
  readonly planId: string | null;
  readonly phase: PresentedSceneView["phase"] | null;
  readonly emittedMarkers: readonly string[];
  readonly consequenceCommitCount: number;
  readonly settled: boolean;
}

/** Compile-time helper ensuring marker declarations use executor-owned roles. */
export function sceneMarker(
  name: string,
  atMs: number,
  order: number,
  role: SceneMarkerRole,
  optional = false,
): SceneRuntimeMarker {
  return Object.freeze({ name, atMs, order, role, optional });
}
