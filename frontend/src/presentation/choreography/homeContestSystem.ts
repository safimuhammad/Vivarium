import type { Direction4, Vec2 } from "../../renderer2d/contracts";
import { tileCenter, type ShelterPlot } from "../../renderer2d/map/regionMap";
import {
  connectNavigationEndpoints,
  findNavigationPath,
  type NavigationGrid,
} from "../../renderer2d/production/navigation/navigation";
import { groundTerrainPointIsOpen } from "../../renderer2d/production/navigation/groundTerrain";
import type { RegionMapRecipeV1 } from "../../renderer2d/production/maps/RegionMapRecipe";
import { stableHash } from "../../renderer2d/production/maps/directedTopology";
import { decideParticipantFallback } from "../../renderer2d/production/failurePolicy";
import { spreadCoincidentTargets } from "../../renderer2d/production/placement/SpatialDirector";
import {
  homeFootprintExclusionRects,
  presentationRouteIsClear,
} from "../../renderer2d/production/productionGeometry";
import {
  exclusionAwareGrid,
  homeExclusionsForRegion,
  recipePlotForDoor,
  structureStandingPoint,
} from "./interactionContact";
import type {
  ActorVisualIntent,
  EffectVisualIntent,
  HomeVisualIntent,
  PresentedObserverFrame,
  PresentedSceneView,
  ProvisionalHomeVisualIntent,
  StoryFocus,
} from "../contracts";
import type { TypedPresentedEvent } from "../eventPayloads";
import type { SceneRuntimeMarker, StoryPhase } from "../SceneSettlementCoordinator";
import {
  sceneMarker,
  type AnyChoreographyDefinition,
  type AnchorRole,
  type ChoreographyContext,
  type ChoreographyDefinition,
  type ChoreographyDiagnostic,
  type ChoreographyPlan,
  type ParticipantRole,
  type ResolvedParticipant,
} from "./contracts";
import { CONTACT_ROUTE_MAX_MS, certifiedProductionRouteBudgetMs } from "./productionLocomotionTiming";

export const HOME_CONTEST_SYSTEM_EVENT_TYPES = Object.freeze([
  "home_built",
  "hearth_used",
  "home_joined",
  "home_left",
  "home_started_hoarding",
  "home_collapsed",
  "home_breached",
  "home_thieved",
  "home_colonized",
  "ruins_scavenged",
  "simulation_started",
] as const);

type FamilyEventType = (typeof HOME_CONTEST_SYSTEM_EVENT_TYPES)[number];

interface PhaseIntents {
  readonly actor?: readonly ActorVisualIntent[];
  readonly home?: readonly HomeVisualIntent[];
  readonly effect?: readonly EffectVisualIntent[];
}

interface PlanInput<T extends FamilyEventType> {
  readonly context: ChoreographyContext<T>;
  readonly regionId: string | null;
  readonly focus: StoryFocus;
  readonly durationMs: number;
  readonly participants: readonly ResolvedParticipant[];
  readonly diagnostics: readonly ChoreographyDiagnostic[];
  readonly intents: Readonly<Partial<Record<StoryPhase, PhaseIntents>>>;
  readonly markers?: readonly SceneRuntimeMarker[];
  readonly retainReducedEffects?: boolean;
  readonly phaseWindows?: ChoreographyPlan["phaseWindows"];
}

interface RouteTiming {
  readonly durationMs: number;
  readonly phaseWindows: ChoreographyPlan["phaseWindows"];
}

type HomeReservation = Omit<ProvisionalHomeVisualIntent, "homeId" | "kind" | "marker">;

const MISSING_PARTICIPANT = Object.freeze({
  required: "nearest-staging-fade-reposition" as const,
  optional: "omit-flourish" as const,
  diagnostic: "missing-home-family-participant",
});

const homeBuilt = definition("home_built", {
  participants: ["actor", "owner", "stakeholder"],
  anchors: ["current-position", "home-plot", "home-door"],
  duration: [4_000, CONTACT_ROUTE_MAX_MS],
  resolve(context) {
    const payload = context.event.payload;
    const reservation = reserveHome(context, payload.home_id, payload.region);
    const participants = compactParticipants([
      participant("actor", [payload.builder_id]),
      participant("owner", [payload.owner_id]),
      participant("stakeholder", payload.stakeholders),
    ]);
    const diagnostics = participantDiagnostics(context.frame, participants);
    diagnostics.push(...reservationDiagnostics(reservation));
    diagnostics.push(diagnostic(
      "provisional-home-required",
      null,
      payload.home_id,
    ));
    const target = reservation.door;
    const route = routeTo(context, payload.builder_id, payload.region, target);
    diagnostics.push(routeDiagnostic(route, payload.builder_id));
    const timing = routeTiming(route, 5_200, 900, 650);
    const physical = route.mode === "physical";
    return plan({
      context,
      regionId: payload.region,
      focus: { kind: "home", id: payload.home_id },
      ...timing,
      participants,
      diagnostics,
      markers: buildMarkers(timing),
      intents: {
        enter: {
          actor: routeEntryIntents(payload.builder_id, route, "home_built:foundation"),
          home: [provisionalHomeIntent(payload.home_id, reservation, "home_built:foundation")],
        },
        hold: {
          actor: physical
            ? [actorIntent(payload.builder_id, "work", target, "home_built:work-contact")]
            : [],
          home: physical ? [homeIntent(payload.home_id, "build", "home_built:work-contact")] : [],
          effect: physical ? [effectIntent("particle", payload.builder_id, payload.home_id)] : [],
        },
        consequence: {
          actor: physical
            ? [actorIntent(payload.builder_id, "work", target, "home_built:consequence")]
            : [],
          home: physical ? [] : [homeIntent(payload.home_id, "build", "home_built:consequence")],
          effect: physical ? [] : [fallbackOutcomeEffect(payload.home_id)],
        },
        recover: {
          actor: routeReturnIntents(payload.builder_id, route, "home_built:return"),
        },
        exit: {
          actor: physical
            ? [actorIntent(payload.builder_id, "idle", routeOrigin(route), "home_built:safe-exit")]
            : [],
        },
      },
    });
  },
});

const hearthUsed = definition("hearth_used", {
  participants: ["actor"],
  anchors: ["current-position", "home-door"],
  duration: [2_800, CONTACT_ROUTE_MAX_MS],
  resolve(context) {
    const payload = context.event.payload;
    const participants = compactParticipants([participant("actor", [payload.agent_id])]);
    const diagnostics = homeDiagnostics(context, payload.home_id, payload.region, participants);
    const target = homeDoor(context, payload.home_id, payload.region);
    const route = routeTo(context, payload.agent_id, payload.region, target);
    diagnostics.push(routeDiagnostic(route, payload.agent_id));
    const timing = routeTiming(route, 3_800, 650, 650);
    const physical = route.mode === "physical";
    return plan({
      context,
      regionId: payload.region,
      focus: { kind: "home", id: payload.home_id },
      ...timing,
      participants,
      diagnostics,
      intents: {
        enter: {
          actor: routeEntryIntents(payload.agent_id, route, "hearth_used:door-open"),
          home: physical ? [homeIntent(payload.home_id, "door", "hearth_used:door-open")] : [],
        },
        hold: {
          actor: physical ? [actorIntent(payload.agent_id, "kneel", target, "hearth_used:contact")] : [],
          effect: physical ? [effectIntent("particle", payload.agent_id, payload.home_id)] : [],
        },
        consequence: {
          home: [homeIntent(payload.home_id, "hearth", "hearth_used:consequence")],
          effect: physical ? [] : [fallbackOutcomeEffect(payload.home_id)],
        },
        recover: { actor: routeReturnIntents(payload.agent_id, route, "hearth_used:return") },
        exit: {
          actor: physical
            ? [actorIntent(payload.agent_id, "idle", routeOrigin(route), "hearth_used:safe-exit")]
            : [],
          home: physical ? [homeIntent(payload.home_id, "door", "hearth_used:door-close")] : [],
        },
      },
    });
  },
});

const homeJoined = definition("home_joined", {
  participants: ["actor", "owner", "stakeholder"],
  anchors: ["current-position", "home-door"],
  duration: [2_000, CONTACT_ROUTE_MAX_MS],
  resolve(context) {
    const payload = context.event.payload;
    return householdPlan(context, payload.home_id, payload.region, payload.agent_id, payload.owner_id,
      payload.stakeholders, "join");
  },
});

const homeLeft = definition("home_left", {
  participants: ["actor", "owner", "stakeholder"],
  anchors: ["current-position", "home-door", "social"],
  duration: [2_200, CONTACT_ROUTE_MAX_MS],
  resolve(context) {
    const payload = context.event.payload;
    return householdPlan(context, payload.home_id, payload.region, payload.agent_id, payload.owner_id,
      payload.stakeholders, "leave");
  },
});

const homeStartedHoarding = definition("home_started_hoarding", {
  participants: ["actor"],
  anchors: ["current-position", "home-door"],
  duration: [2_000, CONTACT_ROUTE_MAX_MS],
  resolve(context) {
    const payload = context.event.payload;
    const participants = compactParticipants([participant("actor", [payload.agent_id])]);
    const diagnostics = homeDiagnostics(context, payload.home_id, payload.region, participants);
    diagnostics.push(diagnostic(
      "durable-home-hoard-at-consequence",
      null,
      String(payload.vault_materials),
    ));
    const target = homeDoor(context, payload.home_id, payload.region);
    const route = routeTo(context, payload.agent_id, payload.region, target);
    diagnostics.push(routeDiagnostic(route, payload.agent_id));
    const timing = routeTiming(route, 3_000, 550, 550);
    const physical = route.mode === "physical";
    return plan({
      context,
      regionId: payload.region,
      focus: { kind: "home", id: payload.home_id },
      ...timing,
      participants,
      diagnostics,
      intents: {
        enter: { actor: routeEntryIntents(payload.agent_id, route, "home_started_hoarding:orient") },
        hold: {
          actor: physical
            ? [actorIntent(payload.agent_id, "reach", target, "home_started_hoarding:contact")]
            : [],
        },
        consequence: {
          actor: physical
            ? [actorIntent(payload.agent_id, "idle", target, "home_started_hoarding:consequence")]
            : [],
          effect: physical ? [] : [fallbackOutcomeEffect(payload.home_id)],
        },
        recover: { actor: routeReturnIntents(payload.agent_id, route, "home_started_hoarding:return") },
        exit: {
          actor: physical
            ? [actorIntent(payload.agent_id, "idle", routeOrigin(route), "home_started_hoarding:safe-exit")]
            : [],
        },
      },
    });
  },
});

const homeCollapsed = definition("home_collapsed", {
  participants: ["owner", "stakeholder"],
  anchors: ["home-plot", "home-door"],
  duration: [4_000, 6_500],
  resolve(context) {
    const payload = context.event.payload;
    const participants = compactParticipants([
      participant("owner", [payload.owner_id]),
      participant("stakeholder", payload.stakeholders),
    ]);
    const diagnostics = homeDiagnostics(context, payload.home_id, payload.region, participants);
    diagnostics.push(diagnostic("terminal-home-priority", null, payload.home_id));
    diagnostics.push(diagnostic("ruin-remnants", null, String(payload.remnant_materials)));
    return plan({
      context,
      regionId: payload.region,
      focus: { kind: "home", id: payload.home_id },
      durationMs: 5_200,
      participants,
      diagnostics,
      intents: {
        enter: { effect: [effectIntent("vignette", payload.owner_id, payload.home_id)] },
        hold: {
          home: [homeIntent(payload.home_id, "collapse", "home_collapsed:contact")],
          // Every other structure-touching event in this family (home_built,
          // hearth_used, home_breached/thieved/colonized, ruins_scavenged) gets a
          // dust particle at contact; collapse previously got only the enter-phase
          // vignette, making a home falling to ruin the visually quietest
          // structural beat despite being one of the more dramatic ones.
          effect: [effectIntent("particle", payload.owner_id, payload.home_id)],
        },
      },
    });
  },
});

const homeBreached = definition("home_breached", {
  participants: ["actor", "breacher"],
  anchors: ["current-position", "home-door"],
  duration: [3_000, CONTACT_ROUTE_MAX_MS],
  resolve(context) {
    const payload = context.event.payload;
    const participants = compactParticipants([
      participant("actor", [payload.breacher_id]),
      participant("breacher", payload.breachers),
    ]);
    const diagnostics = homeDiagnostics(context, payload.home_id, payload.region, participants);
    diagnostics.push(diagnostic("breach-intent", null, payload.intent));
    // `breachers` always includes breacher_id (record_breacher runs before publish);
    // everyone else in it broke in alongside the striker and gets the same "work" pose.
    const supportingBreachers = payload.breachers.filter((id) => id !== payload.breacher_id);
    return contestPlan(context, payload.home_id, payload.region, payload.breacher_id,
      participants, diagnostics, "damage", 4_200, false, [], supportingBreachers, "work");
  },
});

const homeThieved = definition("home_thieved", {
  participants: ["actor", "breacher", "recipient"],
  anchors: ["current-position", "home-door"],
  duration: [3_000, CONTACT_ROUTE_MAX_MS],
  resolve(context) {
    const payload = context.event.payload;
    const participants = compactParticipants([
      participant("actor", [payload.breacher_id]),
      participant("breacher", [payload.breacher_id]),
      participant("recipient", payload.recipients),
    ]);
    const diagnostics = homeDiagnostics(context, payload.home_id, payload.region, participants);
    diagnostics.push(diagnostic(
      pairedBreach(context, payload.home_id, "thieve")
        ? "paired-breach-theft"
        : "standalone-theft-result",
      null,
      payload.home_id,
    ));
    diagnostics.push(diagnostic("loot-materials", null, String(payload.loot.materials)));
    const effects = payload.recipients.map((recipient) =>
      effectIntent("arc", payload.breacher_id, recipient, String(payload.loot_shares[recipient])));
    // `recipients` always includes breacher_id; the others share the loot as
    // witnesses (they already get an individually labeled arc effect below) --
    // gathered and oriented toward the door, not re-battering it.
    const supportingRecipients = payload.recipients.filter((id) => id !== payload.breacher_id);
    return contestPlan(context, payload.home_id, payload.region, payload.breacher_id,
      participants, diagnostics, "loot", 4_000, pairedBreach(context, payload.home_id, "thieve"), effects,
      supportingRecipients, "orient");
  },
});

const homeColonized = definition("home_colonized", {
  participants: ["actor", "breacher", "owner", "stakeholder"],
  anchors: ["current-position", "home-door"],
  duration: [3_000, CONTACT_ROUTE_MAX_MS],
  resolve(context) {
    const payload = context.event.payload;
    const participants = compactParticipants([
      participant("actor", [payload.breacher_id]),
      participant("breacher", [payload.breacher_id]),
      participant("owner", [payload.new_owner_id]),
      participant("stakeholder", payload.new_stakeholders),
    ]);
    const diagnostics = homeDiagnostics(context, payload.home_id, payload.region, participants);
    diagnostics.push(diagnostic(
      pairedBreach(context, payload.home_id, "colonize")
        ? "paired-breach-claim"
        : "standalone-claim-result",
      null,
      `${payload.previous_owner_id}->${payload.new_owner_id}`,
    ));
    // `new_stakeholders` always includes breacher_id (== new_owner_id); the other
    // co-located, previously-homeless breachers who were enrolled are the new
    // household gathering at their newly claimed door, not still battering it.
    const supportingStakeholders = payload.new_stakeholders.filter((id) => id !== payload.breacher_id);
    return contestPlan(context, payload.home_id, payload.region, payload.breacher_id,
      participants, diagnostics, "claim", 4_000, pairedBreach(context, payload.home_id, "colonize"), [],
      supportingStakeholders, "orient");
  },
});

const ruinsScavenged = definition("ruins_scavenged", {
  participants: ["actor"],
  anchors: ["current-position", "ruin"],
  duration: [2_800, CONTACT_ROUTE_MAX_MS],
  resolve(context) {
    const payload = context.event.payload;
    const participants = compactParticipants([participant("actor", [payload.agent_id])]);
    const diagnostics = homeDiagnostics(context, payload.home_id, payload.region, participants);
    diagnostics.push(diagnostic("remnant-materials", null, String(payload.remnant_materials)));
    if (payload.remnant_materials === 0) {
      diagnostics.push(diagnostic("zero-remnant-ruin-persists", null, payload.home_id));
    }
    const target = homeDoor(context, payload.home_id, payload.region);
    const route = routeTo(context, payload.agent_id, payload.region, target);
    diagnostics.push(routeDiagnostic(route, payload.agent_id));
    const timing = routeTiming(route, 3_600, 900, 600);
    const physical = route.mode === "physical";
    return plan({
      context,
      regionId: payload.region,
      focus: { kind: "ruin", id: payload.home_id },
      ...timing,
      participants,
      diagnostics,
      intents: {
        enter: { actor: routeEntryIntents(payload.agent_id, route, "ruins_scavenged:orient") },
        hold: {
          actor: physical ? [actorIntent(payload.agent_id, "gather", target, "ruins_scavenged:contact")] : [],
          home: physical ? [homeIntent(
            payload.home_id,
            "scavenge",
            "ruins_scavenged:contact",
            payload.remnant_materials,
          )] : [],
          effect: physical ? [effectIntent("particle", payload.agent_id, payload.home_id)] : [],
        },
        consequence: {
          actor: physical
            ? [actorIntent(payload.agent_id, "reach", target, "ruins_scavenged:consequence")]
            : [],
          home: physical ? [] : [homeIntent(
            payload.home_id,
            "scavenge",
            "ruins_scavenged:consequence",
            payload.remnant_materials,
          )],
          effect: physical ? [] : [fallbackOutcomeEffect(payload.home_id)],
        },
        recover: { actor: routeReturnIntents(payload.agent_id, route, "ruins_scavenged:return") },
        exit: {
          actor: physical
            ? [actorIntent(payload.agent_id, "idle", routeOrigin(route), "ruins_scavenged:safe-exit")]
            : [],
        },
      },
    });
  },
});

const simulationStarted = definition("simulation_started", {
  participants: ["actor"],
  anchors: ["atlas"],
  duration: [2_000, 3_500],
  resolve(context) {
    const payload = context.event.payload;
    if (payload.run_id !== context.frame.runId) {
      throw new Error(`simulation_started run_id ${payload.run_id} does not match frame ${context.frame.runId}`);
    }
    const participants: readonly ResolvedParticipant[] = [];
    const regionId = firstRegionId(context.frame);
    return plan({
      context,
      regionId,
      focus: { kind: "system", regionId },
      durationMs: 2_800,
      participants,
      diagnostics: [diagnostic("world-establishment", null, String(payload.agent_count))],
      retainReducedEffects: true,
      intents: {
        hold: { effect: [effectIntent("atlas-transition", null, null)] },
      },
    });
  },
});

export const HOME_CONTEST_SYSTEM_CHOREOGRAPHIES = Object.freeze([
  homeBuilt,
  hearthUsed,
  homeJoined,
  homeLeft,
  homeStartedHoarding,
  homeCollapsed,
  homeBreached,
  homeThieved,
  homeColonized,
  ruinsScavenged,
  simulationStarted,
] as const) satisfies readonly AnyChoreographyDefinition[];

function definition<T extends FamilyEventType>(
  eventType: T,
  options: Readonly<{
    participants: readonly ParticipantRole[];
    anchors: readonly AnchorRole[];
    duration: readonly [number, number];
    resolve(context: ChoreographyContext<T>): ChoreographyPlan;
  }>,
): ChoreographyDefinition<T> {
  return deepFreeze({
    eventType,
    participants: [...options.participants],
    requiredAnchors: [...options.anchors],
    contactMarker: contactMarkerFor(eventType),
    consequenceMarker: `${eventType}:consequence`,
    safeCancelMarkers: [`${eventType}:safe-contact`, `${eventType}:safe-exit`],
    duration: { minMs: options.duration[0], maxMs: options.duration[1] },
    missingParticipant: { ...MISSING_PARTICIPANT },
    resolve: options.resolve,
  });
}

function plan<T extends FamilyEventType>(input: PlanInput<T>): ChoreographyPlan {
  const { context } = input;
  const eventType = eventTypeOf(context);
  const visibleAgents = visibleAgentIds(context.frame);
  const missingIds = missingParticipantIds(input.participants, visibleAgents);
  const participantDecision = missingIds[0] === undefined ? null : decideParticipantFallback({
    subjectId: missingIds[0],
    regionId: input.regionId,
    occurrence: 1,
  });
  const participantFallback = participantDecision?.action === "continue"
    && participantDecision.fallback === "region-narration";
  const focus = participantFallback ? regionNarrationFocus(input.regionId) : input.focus;
  const phaseWindows = input.phaseWindows ?? phaseWindowsFor(input.durationMs);
  const phases = phaseWindows.map(({ phase }): PresentedSceneView => {
    const intents = input.intents[phase] ?? {};
    return {
      momentId: context.moment.id,
      regionId: input.regionId,
      phase,
      focus,
      dialogue: null,
      actorIntents: motionModeActorIntents(
        intents.actor ?? [],
        context.reducedMotion,
      ).filter(({ actorId }) => visibleAgents.has(actorId)),
      homeIntents: intents.home ?? [],
      effectIntents: context.reducedMotion && input.retainReducedEffects !== true ? [] : intents.effect ?? [],
      safeCancelMarkers: [`${eventType}:safe-contact`, `${eventType}:safe-exit`],
      reducedMotion: context.reducedMotion,
    };
  });
  const markers = input.markers ?? standardMarkers(eventType, phaseWindows, input.durationMs);
  const participantIds = unique(input.participants.flatMap(({ ids }) => ids));
  return deepFreeze({
    id: `choreography:${eventType}:${context.moment.id}`,
    momentId: context.moment.id,
    eventType,
    regionId: input.regionId,
    phases,
    phaseWindows,
    markers,
    durationMs: input.durationMs,
    contactMarker: contactMarkerFor(eventType),
    consequenceMarker: `${eventType}:consequence`,
    safeCancelMarkers: [`${eventType}:safe-contact`, `${eventType}:safe-exit`],
    participants: input.participants,
    diagnostics: [
      ...input.diagnostics,
      ...participantDiagnostics(context.frame, input.participants).filter((candidate) => (
        !input.diagnostics.some((existing) => (
          existing.code === candidate.code
          && existing.role === candidate.role
          && existing.detail === candidate.detail
        ))
      )),
    ],
    reducedMotionEndpoint: {
      regionId: input.regionId,
      focus,
      participantIds,
      consequenceMarker: `${eventType}:consequence`,
      settleMarker: `${eventType}:settled`,
    },
  });
}

function motionModeActorIntents(
  intents: readonly ActorVisualIntent[],
  reducedMotion: boolean,
): readonly ActorVisualIntent[] {
  if (!reducedMotion) return intents;
  return intents.map((intent) => {
    if (intent.kind !== "move" || intent.target === null) return intent;
    const facing = routeEndpointFacing(intent.waypoints ?? []);
    return {
      actorId: intent.actorId,
      kind: "fade-reposition",
      target: { ...intent.target },
      ...(facing === undefined ? {} : { facing }),
      marker: intent.marker,
    };
  });
}

function routeEndpointFacing(waypoints: readonly Vec2[]): Direction4 | undefined {
  const target = waypoints.at(-1);
  if (target === undefined) return undefined;
  for (let index = waypoints.length - 2; index >= 0; index -= 1) {
    const source = waypoints[index]!;
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    if (dx === 0 && dy === 0) continue;
    return Math.abs(dx) >= Math.abs(dy)
      ? dx >= 0 ? "east" : "west"
      : dy >= 0 ? "south" : "north";
  }
  return undefined;
}

function visibleAgentIds(frame: PresentedObserverFrame): ReadonlySet<string> {
  return new Set(frame.world.agents.flatMap(({ value }) => (
    typeof value.id === "string" ? [value.id] : []
  )));
}

function missingParticipantIds(
  resolved: readonly ResolvedParticipant[],
  visible: ReadonlySet<string>,
): readonly string[] {
  return unique(resolved.flatMap(({ ids }) => ids).filter((id) => id !== "world" && !visible.has(id)));
}

function regionNarrationFocus(regionId: string | null): StoryFocus {
  return regionId === null
    ? { kind: "system", regionId: null }
    : { kind: "region", id: regionId };
}

function householdPlan<T extends "home_joined" | "home_left">(
  context: ChoreographyContext<T>,
  homeId: string,
  regionId: string,
  actorId: string,
  ownerId: string,
  stakeholders: readonly string[],
  action: "join" | "leave",
): ChoreographyPlan {
  const eventType = action === "join" ? "home_joined" : "home_left";
  const participants = compactParticipants([
    participant("actor", [actorId]),
    participant("owner", [ownerId]),
    participant("stakeholder", stakeholders),
  ]);
  const diagnostics = homeDiagnostics(context, homeId, regionId, participants);
  diagnostics.push(diagnostic("authoritative-household-roster", null, stakeholders.join(",")));
  const target = homeDoor(context, homeId, regionId);
  const route = routeTo(context, actorId, regionId, target);
  diagnostics.push(routeDiagnostic(route, actorId));
  const timing = routeTiming(route, action === "join" ? 2_800 : 3_200, 550, 550);
  const physical = route.mode === "physical";
  // The household's other current stakeholders (the roster already excludes a
  // leaver and, for a join, is filtered below to exclude the joiner) turn to
  // face the door -- a light "orient toward the site" reaction from wherever
  // they already stand, never a cross-region walk-in and never a full route.
  const coResidentIds = coPresentCastIds(context.frame, stakeholders, regionId, actorId);
  return plan({
    context,
    regionId,
    focus: { kind: "home", id: homeId },
    ...timing,
    participants,
    diagnostics,
    intents: {
      enter: {
        actor: routeEntryIntents(actorId, route, `${eventType}:door-open`),
        home: physical ? [homeIntent(homeId, "door", `${eventType}:door-open`)] : [],
      },
      hold: {
        actor: [
          ...(physical ? [actorIntent(actorId, "reach", target, `${eventType}:contact`)] : []),
          ...coResidentIds.map((id) => actorIntent(id, "orient", target, `${eventType}:contact`)),
        ],
      },
      consequence: {
        home: physical ? [homeIntent(homeId, "door", `${eventType}:consequence`)] : [],
        effect: physical ? [] : [fallbackOutcomeEffect(homeId)],
      },
      recover: { actor: routeReturnIntents(actorId, route, `${eventType}:return`) },
      exit: {
        actor: physical
          ? [actorIntent(actorId, "idle", routeOrigin(route), `${eventType}:safe-exit`)]
          : [],
        home: physical ? [homeIntent(homeId, "door", `${eventType}:door-close`)] : [],
      },
    },
  });
}

function contestPlan<T extends "home_breached" | "home_thieved" | "home_colonized">(
  context: ChoreographyContext<T>,
  homeId: string,
  regionId: string,
  actorId: string,
  participants: readonly ResolvedParticipant[],
  diagnostics: readonly ChoreographyDiagnostic[],
  kind: "damage" | "loot" | "claim",
  durationMs: number,
  paired: boolean,
  effects: readonly EffectVisualIntent[] = [],
  supportingCastIds: readonly string[] = [],
  supportingPose: "work" | "orient" = "orient",
): ChoreographyPlan {
  const target = homeDoor(context, homeId, regionId);
  const eventType = eventTypeOf(context);
  const route = routeTo(context, actorId, regionId, target);
  // Every OTHER named participant the real payload lists (extra breachers on a
  // breach, extra recipients on a theft split, extra new stakeholders on a
  // colonize) gets staged too -- but only when the current presented frame
  // proves it is co-present in this same region (never teleported in), and
  // only when a genuine collision-open contact route resolves (the "optional"
  // participant contract in MISSING_PARTICIPANT: omit the flourish rather than
  // fade a supporting body in from nowhere).
  const supportingCandidates = coPresentCastIds(context.frame, supportingCastIds, regionId, actorId);
  const supportingCast = resolvePhysicalSupportingCast(context, supportingCandidates, regionId, target);
  const resolvedDiagnostics = [...diagnostics, routeDiagnostic(route, actorId)];
  // The PRIMARY actor's own route alone sizes enter/hold/consequence/recover --
  // a supporting participant never barriers the claim/work from starting (a
  // prior version sized every phase off the SLOWEST mover, leaving the striker
  // idle for as long as ~9.6s on the real C08 colonize fixture while a distant
  // supporting stakeholder was still walking in). Each supporting participant
  // is instead placed into the earliest phase that starts at or after their
  // OWN arrival, so nobody's pose fires before they have physically arrived
  // (see `placeSupportingArrival`); `exitStartMs` stretches only as far as the
  // slowest such participant actually needs.
  const { timing, placements } = resolveContestTiming(
    actorId,
    route,
    supportingCast,
    durationMs,
    900,
    paired ? 900 : 650,
    context.getNavigationGrid?.(regionId) ?? null,
  );
  const physical = route.mode === "physical";
  const contactMarker = `${eventType}:contact`;
  const safeExitMarker = `${eventType}:safe-exit`;
  const outcome = homeIntent(homeId, kind, `${eventType}:${paired ? "consequence" : "contact"}`);
  const supportingByPhase = groupSupportingIntentsByPhase(
    placements, target, supportingPose, contactMarker, `${eventType}:return`, safeExitMarker,
  );
  return plan({
    context,
    regionId,
    focus: { kind: "home", id: homeId },
    ...timing,
    participants,
    diagnostics: resolvedDiagnostics,
    intents: {
      enter: {
        actor: [
          ...routeEntryIntents(actorId, route, `${eventType}:orient`),
          ...supportingCast.flatMap((member) => routeEntryIntents(member.id, member.route, `${eventType}:orient`)),
        ],
      },
      hold: {
        actor: [
          ...(physical ? [actorIntent(actorId, "work", target, contactMarker)] : []),
          ...supportingByPhase.hold,
        ],
        home: physical
          ? paired ? [homeIntent(homeId, "damage", `${eventType}:contact`)] : [outcome]
          : [],
        effect: physical ? [effectIntent("particle", actorId, homeId)] : [],
      },
      consequence: {
        actor: supportingByPhase.consequence,
        home: physical ? paired ? [outcome] : [] : [homeIntent(homeId, kind, `${eventType}:consequence`)],
        effect: physical ? effects : [fallbackOutcomeEffect(homeId)],
      },
      // NO RETURN LEG for a contest beat. The owner's mandate is that a raider
      // STANDS AT the house: marching him back to his staging anchor for the
      // remaining ~15s of a 32s beat -- while the loot/claim chrome is still on
      // screen -- is the opposite of that, and it forced the beat director to
      // frame a widening gap. He stays at the door he broke.
      recover: {
        actor: [
          ...(physical ? [actorIntent(actorId, "idle", route.target, `${eventType}:return`)] : []),
          ...supportingByPhase.recover,
        ],
      },
      exit: {
        actor: [
          ...(physical ? [actorIntent(actorId, "idle", route.target, safeExitMarker)] : []),
          ...supportingByPhase.exit,
        ],
      },
    },
  });
}

function phaseWindowsFor(durationMs: number): ChoreographyPlan["phaseWindows"] {
  const cuts = [0, 0.18, 0.42, 0.62, 0.84, 1].map((value) => Math.round(value * durationMs));
  return (["enter", "hold", "consequence", "recover", "exit"] as const).map((phase, index) => ({
    phase,
    startMs: cuts[index]!,
    endMs: cuts[index + 1]!,
  }));
}

function routeTiming(
  route: HomeRoute,
  minimumDurationMs: number,
  holdMs: number,
  consequenceMs: number,
  returnsToOrigin = true,
): RouteTiming {
  return groupRouteTiming([route], minimumDurationMs, holdMs, consequenceMs, returnsToOrigin);
}

/**
 * Same contract as {@link routeTiming} but certified across every mover in a
 * staged group (the primary actor plus any co-present supporting cast), so the
 * scene's phase windows never close before the slowest participant physically
 * arrives or returns. A single-route call is arithmetically identical to the
 * prior single-actor `routeTiming` (max of one value is that value), so events
 * with no supporting cast see no timing change.
 */
function groupRouteTiming(
  routes: readonly HomeRoute[],
  minimumDurationMs: number,
  holdMs: number,
  consequenceMs: number,
  /**
   * False for a beat whose actor STAYS where it walked to (every contest
   * beat -- see `contestPlan`'s "no return leg" note). The recover window then
   * only has to hold a settle, not a full second traversal, which is what
   * stops a raid from spending half its length walking away from the house it
   * just took while the outcome chrome is still on screen.
   */
  returnsToOrigin = true,
): RouteTiming {
  const arrivalMs = routes.reduce((max, route) => Math.max(max, routeArrivalMs(route)), 600);
  const holdEnd = arrivalMs + holdMs;
  const consequenceEnd = holdEnd + consequenceMs;
  const returnMs = returnsToOrigin
    ? routes.reduce((max, route) => Math.max(max, routeReturnMs(route)), 600)
    : 600;
  const recoverEnd = consequenceEnd + returnMs;
  const durationMs = Math.max(minimumDurationMs, recoverEnd + 600);
  return {
    durationMs,
    phaseWindows: [
      { phase: "enter", startMs: 0, endMs: arrivalMs },
      { phase: "hold", startMs: arrivalMs, endMs: holdEnd },
      { phase: "consequence", startMs: holdEnd, endMs: consequenceEnd },
      { phase: "recover", startMs: consequenceEnd, endMs: recoverEnd },
      { phase: "exit", startMs: recoverEnd, endMs: durationMs },
    ],
  };
}

function routeArrivalMs(route: HomeRoute): number {
  return route.waypoints.length < 2 ? 600 : certifiedProductionRouteBudgetMs(route.waypoints, 48);
}

function routeReturnMs(route: HomeRoute): number {
  const returnWaypoints = route.mode === "physical" ? [...route.waypoints].reverse() : [];
  return returnWaypoints.length < 2 ? 600 : certifiedProductionRouteBudgetMs(returnWaypoints, 48);
}

function contactMarkerFor(eventType: FamilyEventType): string {
  return eventType === "home_built" ? "home_built:work-contact" : `${eventType}:contact`;
}

function standardMarkers(
  eventType: FamilyEventType,
  windows: ChoreographyPlan["phaseWindows"],
  durationMs: number,
): readonly SceneRuntimeMarker[] {
  const start = (phase: StoryPhase): number => windows.find((window) => window.phase === phase)!.startMs;
  return [
    sceneMarker(`${eventType}:contact`, start("hold"), 0, "contact"),
    sceneMarker(`${eventType}:consequence`, start("consequence"), 0, "consequence"),
    sceneMarker(`${eventType}:safe-contact`, start("recover"), 0, "safe-cancel"),
    sceneMarker(`${eventType}:safe-exit`, durationMs, 0, "safe-cancel"),
    sceneMarker(`${eventType}:settled`, durationMs, 1, "settle"),
  ];
}

function buildMarkers(timing: RouteTiming): readonly SceneRuntimeMarker[] {
  const hold = timing.phaseWindows.find(({ phase }) => phase === "hold")!.startMs;
  const consequence = timing.phaseWindows.find(({ phase }) => phase === "consequence")!.startMs;
  const recover = timing.phaseWindows.find(({ phase }) => phase === "recover")!.startMs;
  return [
    sceneMarker("home_built:foundation", hold, 0, "optional-effect"),
    sceneMarker("home_built:work-contact", hold, 1, "contact"),
    sceneMarker("home_built:post", hold + 162, 0, "optional-effect"),
    sceneMarker("home_built:walls", hold + 342, 0, "optional-effect"),
    sceneMarker("home_built:roof", hold + 558, 0, "optional-effect"),
    sceneMarker("home_built:door", hold + 720, 0, "optional-effect"),
    sceneMarker("home_built:hearth", hold + 828, 0, "optional-effect"),
    sceneMarker("home_built:consequence", consequence, 0, "consequence"),
    sceneMarker("home_built:safe-contact", recover, 0, "safe-cancel"),
    sceneMarker("home_built:safe-exit", timing.durationMs, 0, "safe-cancel"),
    sceneMarker("home_built:settled", timing.durationMs, 1, "settle"),
  ];
}

function participant(role: ParticipantRole, ids: readonly string[]): ResolvedParticipant {
  return { role, ids: unique(ids.filter((id) => id.trim().length > 0)) };
}

function compactParticipants(values: readonly ResolvedParticipant[]): readonly ResolvedParticipant[] {
  return values.map((value) => ({ role: value.role, ids: [...value.ids] }));
}

function participantDiagnostics(
  frame: PresentedObserverFrame,
  participants: readonly ResolvedParticipant[],
): ChoreographyDiagnostic[] {
  const visible = new Set(frame.world.agents.flatMap(({ value }) => typeof value.id === "string" ? [value.id] : []));
  const diagnostics: ChoreographyDiagnostic[] = [];
  for (const value of participants) {
    const missing = value.ids.filter((id) => id !== "world" && !visible.has(id));
    if (missing.length > 0) {
      diagnostics.push(diagnostic("missing-required-participant", value.role, missing.join(",")));
    }
  }
  return diagnostics;
}

function homeDiagnostics<T extends FamilyEventType>(
  context: ChoreographyContext<T>,
  homeId: string,
  regionId: string,
  participants: readonly ResolvedParticipant[],
): ChoreographyDiagnostic[] {
  const diagnostics = participantDiagnostics(context.frame, participants);
  const exists = [...context.frame.world.homes, ...context.frame.world.ruins]
    .some(({ value }) => value.home_id === homeId);
  if (!exists) diagnostics.push(diagnostic("missing-home-record", null, homeId));
  diagnostics.push(...homeAnchorDiagnostics(context, homeId, regionId));
  return diagnostics;
}

function homeAnchorDiagnostics<T extends FamilyEventType>(
  context: ChoreographyContext<T>,
  homeId: string,
  regionId: string,
): ChoreographyDiagnostic[] {
  const anchor = resolveHomeReservation(context, homeId, regionId, false);
  if (!anchor) return [diagnostic("missing-home-anchor", null, homeId)];
  return [
    diagnostic("home-plot-anchor", null, anchor.plotId),
    diagnostic("home-door-anchor", null, `${anchor.door.x},${anchor.door.y}`),
  ];
}

function reservationDiagnostics(reservation: HomeReservation): ChoreographyDiagnostic[] {
  return [
    diagnostic("home-plot-anchor", null, reservation.plotId),
    diagnostic("home-door-anchor", null, `${reservation.door.x},${reservation.door.y}`),
  ];
}

function pairedBreach<T extends "home_thieved" | "home_colonized">(
  context: ChoreographyContext<T>,
  homeId: string,
  intent: "thieve" | "colonize",
): boolean {
  if (context.moment.evidence.length !== 2) return false;
  const [breach, outcome] = context.moment.evidence;
  const breachPayload = breach?.event.payload;
  const outcomePayload = outcome?.event.payload;
  return breach?.event.type === "home_breached"
    && outcome?.event.type === eventTypeOf(context)
    && breach.cursor + 1 === outcome.cursor
    && breachPayload?.home_id === homeId
    && outcomePayload?.home_id === homeId
    && breachPayload?.intent === intent
    && outcomePayload?.intent === intent;
}

function homeDoor<T extends FamilyEventType>(
  context: ChoreographyContext<T>,
  homeId: string,
  regionId: string,
): Vec2 | null {
  return resolveHomeReservation(context, homeId, regionId, false)?.door ?? null;
}

function reserveHome<T extends FamilyEventType>(
  context: ChoreographyContext<T>,
  homeId: string,
  regionId: string,
): HomeReservation {
  const reservation = resolveHomeReservation(context, homeId, regionId, true);
  if (reservation === null) {
    throw new Error(`region ${regionId} has no free Task 6 shelter plot for ${homeId}`);
  }
  return reservation;
}

function resolveHomeReservation<T extends FamilyEventType>(
  context: ChoreographyContext<T>,
  homeId: string,
  regionId: string,
  allowUnpresented: boolean,
): HomeReservation | null {
  const recipe = context.recipes.get(regionId);
  if (!recipe) {
    if (allowUnpresented) {
      throw new Error(`home ${homeId} requires the injected Task 6 recipe for ${regionId}`);
    }
    return null;
  }
  const existing = context.placement.homes.get(homeId);
  const presented = [...context.frame.world.homes, ...context.frame.world.ruins];
  const matchingPresented = presented.find(({ value }) => (
    value.home_id === homeId && value.region === regionId
  ));
  if (!existing && !allowUnpresented && matchingPresented === undefined) return null;
  if (existing) {
    const plot = recipe.shelterPlots.find(({ id }) => id === existing.plotId) ?? null;
    if (!plot) return null;
    const door = tileCenter(plot.door);
    if (existing.door.x !== door.x || existing.door.y !== door.y) {
      throw new Error(`home ${homeId} placement door does not match its Task 6 shelter plot`);
    }
    return {
      regionId,
      plotId: plot.id,
      plot: tileCenter(plot.tile),
      door,
      kit: recipe.kit,
    };
  }
  const occupied = new Set([...context.placement.homes.values()]
    .filter((placement) => placement.regionId === regionId)
    .map(({ plotId }) => plotId));
  const pendingIds = unique(presented.flatMap(({ value }) => (
    typeof value.home_id === "string"
      && value.region === regionId
      && !context.placement.homes.has(value.home_id)
      ? [value.home_id]
      : []
  )));
  if (allowUnpresented && !pendingIds.includes(homeId)) pendingIds.push(homeId);
  pendingIds.sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
  for (const pendingId of pendingIds) {
    const plot = firstFreePlot(
      recipe.districts.map(({ shelterPlots }) => shelterPlots),
      occupied,
      pendingId,
    );
    if (!plot) return null;
    occupied.add(plot.id);
    if (pendingId !== homeId) continue;
    return {
      regionId,
      plotId: plot.id,
      plot: tileCenter(plot.tile),
      door: tileCenter(plot.door),
      kit: recipe.kit,
    };
  }
  return null;
}

function firstFreePlot(
  districts: readonly (readonly ShelterPlot[])[],
  occupied: ReadonlySet<string>,
  homeId: string,
): ShelterPlot | null {
  const plots = districts.find((candidates) => candidates.some(({ id }) => !occupied.has(id)));
  if (!plots || plots.length === 0) return null;
  const start = stableHash(homeId) % plots.length;
  for (let offset = 0; offset < plots.length; offset += 1) {
    const candidate = plots[(start + offset) % plots.length];
    if (candidate && !occupied.has(candidate.id)) return candidate;
  }
  return null;
}

interface HomeRoute {
  readonly mode: "physical" | "fade-reposition" | "omitted";
  readonly target: Vec2 | null;
  readonly waypoints: readonly Vec2[];
  readonly reason: string | null;
}

interface SupportingCastMember {
  readonly id: string;
  readonly route: HomeRoute;
}

/**
 * True only when the current EXACT presented frame proves `agentId` stands in
 * `regionId` right now -- the frame-state truth check that keeps a supporting
 * participant from another region out of a scene it does not belong in (never
 * a projected guess, never the payload roster alone).
 */
function coPresentInRegion(
  frame: PresentedObserverFrame,
  agentId: string,
  regionId: string,
): boolean {
  const record = frame.world.agents.find(({ value }) => value.id === agentId);
  return record?.completeness === "exact" && record.value.position === regionId;
}

/** De-duplicated, actor-excluded, frame-co-present candidate ids for a supporting cast. */
function coPresentCastIds(
  frame: PresentedObserverFrame,
  ids: readonly string[],
  regionId: string,
  excludeId: string,
): readonly string[] {
  return unique(ids.filter((id) => id !== excludeId)).filter((id) => coPresentInRegion(frame, id, regionId));
}

/**
 * Resolves a real collision-open contact route (the same `routeTo` helper the
 * primary actor uses) for each frame-proven co-present candidate, keeping only
 * the ones that reach the target physically. A candidate whose route falls
 * back (unreachable, wrong region, no placement) is omitted rather than faded
 * in -- supporting cast is an "optional-flourish" participant per
 * `MISSING_PARTICIPANT`, never a body invented at the door.
 */
function resolvePhysicalSupportingCast<T extends FamilyEventType>(
  context: ChoreographyContext<T>,
  candidateIds: readonly string[],
  regionId: string,
  target: Vec2 | null,
): readonly SupportingCastMember[] {
  const cast: SupportingCastMember[] = [];
  for (const id of candidateIds) {
    const route = routeTo(context, id, regionId, target);
    if (route.mode === "physical") cast.push({ id, route });
  }
  return cast;
}

/** The four story phases a supporting participant's pose/return can land in (never "enter" -- every mover starts walking immediately). */
type SupportingPhaseBucket = "hold" | "consequence" | "recover" | "exit";

interface SupportingPlacement {
  readonly member: SupportingCastMember;
  readonly poseBucket: SupportingPhaseBucket;
  readonly poseAtMs: number;
  readonly returnBucket: SupportingPhaseBucket | null;
}

/**
 * Where a supporting participant's pose fires next after its own return leg,
 * matching the primary actor's own hold -> (consequence, held) -> recover
 * (return) -> exit (settled) shape: an on-time arrival holds through the
 * consequence beat and returns alongside the primary; a late arrival gets one
 * beat of pose before returning; the latest arrivals simply hold their pose
 * through to the end of the scene (no further phase remains to return in).
 */
const SUPPORTING_RETURN_BUCKET: Readonly<Record<SupportingPhaseBucket, SupportingPhaseBucket | null>> = {
  hold: "recover",
  consequence: "recover",
  recover: "exit",
  exit: null,
};

/**
 * Assigns one supporting participant's own route to the EARLIEST story phase
 * that starts at or after their real arrival time, so their pose command
 * never fires while they are still physically mid-route (which would cut the
 * walk short and pose them wherever they happened to be, per
 * `SpriteSheetHumanActor#apply`'s `play-body` handler clearing any in-flight
 * route). `primaryBoundary` supplies the primary actor's own phase-start
 * times; a participant arriving even later than the primary's own exit start
 * still lands in `"exit"`, and the caller widens that phase's actual start to
 * `poseAtMs` for whichever participant needs it latest.
 */
function placeSupportingArrival(
  member: SupportingCastMember,
  timedRoute: HomeRoute,
  primaryBoundary: Readonly<{ hold: number; consequence: number; recover: number; exit: number }>,
): SupportingPlacement {
  const arrivalMs = routeArrivalMs(timedRoute);
  const poseBucket: SupportingPhaseBucket = arrivalMs <= primaryBoundary.hold ? "hold"
    : arrivalMs <= primaryBoundary.consequence ? "consequence"
      : arrivalMs <= primaryBoundary.recover ? "recover"
        : "exit";
  const poseAtMs = poseBucket === "exit" ? Math.max(primaryBoundary.exit, arrivalMs) : primaryBoundary[poseBucket];
  return { member, poseBucket, poseAtMs, returnBucket: SUPPORTING_RETURN_BUCKET[poseBucket] };
}

/**
 * A home-contest scene stages every present participant (the primary plus
 * any supporting cast) toward the SAME literal door point. `SpatialDirector`'s
 * `spreadCoincidentTargets` (invoked from `ProductionSceneCommandResolver.ts`)
 * is the sole owner of resolving that collision at render time -- it displaces
 * every member but the lowest-`stableHash` one onto a small deterministic ring
 * so no two bodies ever render fused together on the door pixel (see
 * `SpatialDirector.ts`'s file header). Critically, *which* participant gets
 * displaced is decided purely by `stableHash(actorId)`, with no notion of this
 * file's own "primary vs. supporting" role -- so the choreography's own
 * PRIMARY actor (whose route alone sizes the enter/hold boundary below) can be
 * the one the resolver moves.
 *
 * The resolver applies that displacement as a plain straight hop appended
 * past the authored route's own final waypoint (`ProductionSceneCommandResolver
 * .ts`'s `actorCommands`, the `"move"` branch's `waypoints.push(spreadPoint)`).
 * Before this function existed, this file's own route-timing math had no way
 * to know that hop was coming, so a displaced participant's `"enter"` (or
 * return-leg) phase window could close before they physically finished
 * walking it -- visibly snapping the actor into its hold-phase contact pose
 * short of the door. This helper calls the exact same deterministic function
 * the resolver calls, over the exact same actor-id/target inputs, purely to
 * PREDICT that outcome at planning time and widen the affected participant's
 * own budget by the predicted hop -- it does not change any authored route or
 * intent (spread resolution itself stays resolver-owned, per SpatialDirector's
 * own design mandate).
 */
function withPredictedSpreadHop(route: HomeRoute, spreadTarget: Vec2 | null): HomeRoute {
  if (route.mode !== "physical" || spreadTarget === null) return route;
  const finalWaypoint = route.waypoints.at(-1) ?? null;
  if (finalWaypoint !== null && finalWaypoint.x === spreadTarget.x && finalWaypoint.y === spreadTarget.y) {
    return route;
  }
  return { ...route, target: spreadTarget, waypoints: [...route.waypoints, spreadTarget] };
}

/**
 * Resolves the full contest-scene timing: phase windows are sized from the
 * PRIMARY actor's own route only (so hold/the claim starts the instant the
 * primary arrives, never barriered on a slower supporting participant), then
 * `exit` is widened only as far as the slowest staged participant's own
 * arrival + settle actually requires -- `max(primary path + hold, slowest
 * participant path + their settle)`, never less (nobody is cut off) and never
 * more than necessary (the primary is never left idling on their account).
 * Every route consulted here is first passed through
 * {@link withPredictedSpreadHop} so a participant the resolver will displace
 * (see that function's doc comment) is budgeted for the hop it will actually
 * have to walk.
 *
 * `spreadGrid` gates the SAME coincident-target ring search's candidate points
 * against real ground legality that `ProductionSceneCommandResolver.ts` uses
 * for its own (render-position-owning) call to `spreadCoincidentTargets` --
 * see `ChoreographyContext.getNavigationGrid`. This call's own output never
 * reaches a render position (only `RouteTiming`/`SupportingPlacement` -- pure
 * timing numbers -- leave this function), so an illegal candidate here was
 * never a placement bug, only a timing-prediction one: the predicted hop
 * could diverge from the resolver's own terrain-aware hop near blocked
 * ground, at worst snapping a supporting participant's pose slightly early
 * or late. Passing the real grid closes that divergence too. `null` (no
 * region, or no `getNavigationGrid` wired) keeps the prior, fully permissive
 * prediction.
 */
function resolveContestTiming(
  actorId: string,
  route: HomeRoute,
  supportingCast: readonly SupportingCastMember[],
  minimumDurationMs: number,
  holdMs: number,
  consequenceMs: number,
  spreadGrid: NavigationGrid | null,
): Readonly<{
  timing: RouteTiming;
  placements: readonly SupportingPlacement[];
  exitStartMs: number;
}> {
  const rawTargets = new Map<string, Vec2>();
  if (route.mode === "physical" && route.target !== null) rawTargets.set(actorId, route.target);
  for (const member of supportingCast) {
    if (member.route.mode === "physical" && member.route.target !== null) {
      rawTargets.set(member.id, member.route.target);
    }
  }
  const spreadTargets = rawTargets.size < 2 ? rawTargets : spreadCoincidentTargets(
    rawTargets,
    spreadGrid === null ? () => true : (point) => groundTerrainPointIsOpen(spreadGrid, point),
  );
  const timedRoute = withPredictedSpreadHop(route, spreadTargets.get(actorId) ?? null);
  const primaryTiming = routeTiming(timedRoute, minimumDurationMs, holdMs, consequenceMs, false);
  const boundary = {
    hold: phaseStart(primaryTiming, "hold"),
    consequence: phaseStart(primaryTiming, "consequence"),
    recover: phaseStart(primaryTiming, "recover"),
    exit: phaseStart(primaryTiming, "exit"),
  };
  const timedMemberRoutes = new Map<string, HomeRoute>(supportingCast.map((member) => (
    [member.id, withPredictedSpreadHop(member.route, spreadTargets.get(member.id) ?? null)]
  )));
  const placements = supportingCast.map((member) => placeSupportingArrival(
    member,
    timedMemberRoutes.get(member.id)!,
    boundary,
  ));
  const exitStartMs = placements.reduce(
    (max, placement) => (placement.poseBucket === "exit" ? Math.max(max, placement.poseAtMs) : max),
    boundary.exit,
  );
  const settleFloors = placements.flatMap((placement) => {
    const timedMemberRoute = timedMemberRoutes.get(placement.member.id)!;
    if (placement.returnBucket === null) return [placement.poseAtMs + 600];
    const returnFiresAtMs = placement.returnBucket === "exit" ? exitStartMs : boundary[placement.returnBucket];
    return [returnFiresAtMs + routeReturnMs(timedMemberRoute) + 600];
  });
  const durationMs = Math.max(primaryTiming.durationMs, exitStartMs + 600, ...settleFloors);
  const phaseWindows: ChoreographyPlan["phaseWindows"] = [
    { phase: "enter", startMs: 0, endMs: boundary.hold },
    { phase: "hold", startMs: boundary.hold, endMs: boundary.consequence },
    { phase: "consequence", startMs: boundary.consequence, endMs: boundary.recover },
    { phase: "recover", startMs: boundary.recover, endMs: exitStartMs },
    { phase: "exit", startMs: exitStartMs, endMs: durationMs },
  ];
  return { timing: { durationMs, phaseWindows }, placements, exitStartMs };
}

function phaseStart(timing: RouteTiming, phase: StoryPhase): number {
  return timing.phaseWindows.find((window) => window.phase === phase)!.startMs;
}

/** Buckets every supporting participant's pose + (if any) return-leg intents by the story phase they actually fire in. */
/** The phase immediately after a given phase in the canonical staging sequence -- used to place a supporting participant's settle/idle one beat after its own return leg, never in the same batch as the return move itself. */
const SUPPORTING_NEXT_BUCKET: Readonly<Record<SupportingPhaseBucket, SupportingPhaseBucket | null>> = {
  hold: "consequence",
  consequence: "recover",
  recover: "exit",
  exit: null,
};

function groupSupportingIntentsByPhase(
  placements: readonly SupportingPlacement[],
  target: Vec2 | null,
  pose: ActorVisualIntent["kind"],
  contactMarker: string,
  returnMarker: string,
  safeExitMarker: string,
): Readonly<Record<SupportingPhaseBucket, readonly ActorVisualIntent[]>> {
  const byPhase: Record<SupportingPhaseBucket, ActorVisualIntent[]> = {
    hold: [], consequence: [], recover: [], exit: [],
  };
  for (const { member, poseBucket, returnBucket } of placements) {
    byPhase[poseBucket].push(actorIntent(member.id, pose, target, contactMarker));
    if (returnBucket === null) continue;
    byPhase[returnBucket].push(...routeReturnIntents(member.id, member.route, returnMarker));
    // A settle/idle beat one phase after the return move -- never in the same
    // batch as the move itself (SpriteSheetHumanActor#apply's "set-face" for
    // idle does not touch route state, but keeping it a beat later matches the
    // primary's own recover(move) -> exit(idle) shape). Only possible when a
    // phase actually remains after the return leg.
    const idleBucket = SUPPORTING_NEXT_BUCKET[returnBucket];
    if (idleBucket !== null) {
      byPhase[idleBucket].push(actorIntent(member.id, "idle", routeOrigin(member.route), safeExitMarker));
    }
  }
  return byPhase;
}

function routeTo<T extends FamilyEventType>(
  context: ChoreographyContext<T>,
  actorId: string,
  regionId: string,
  target: Vec2 | null,
): HomeRoute {
  const placement = context.placement.agents.get(actorId);
  const recipe = context.recipes.get(regionId);
  if (!recipe) {
    return { mode: "omitted", target: null, waypoints: [], reason: "missing-recipe" };
  }
  if (!placement) {
    return fallbackRoute(recipe, target, actorId, "missing-placement");
  }
  if (placement.regionId !== regionId) {
    return fallbackRoute(recipe, target, actorId, "wrong-region");
  }
  if (target === null) {
    return fallbackRoute(recipe, null, actorId, "missing-target");
  }
  // A home's authored door anchor sits inside its 128px render rect: correct
  // for the door art, illegal as a body position under the renderer's own
  // apply-time exclusion gate (the door carve-out is shorter than the measured
  // standing envelope). Routing to it produced a `move` the renderer dropped
  // in silence, so no raider ever reached a house and no resident ever left
  // one -- they played their contact pose wherever they already stood. Resolve
  // the authored anchor to the nearest point a body may legally occupy, in
  // front of the doorway, and verify the whole path the same way the renderer
  // will. See interactionContact.ts.
  // The target structure's OWN footprint is excluded too, even when it is a
  // plot being reserved this very beat (`home_built`) and so is not in the
  // placement ledger yet -- otherwise the builder walks into his own house.
  const plot = recipePlotForDoor(recipe, target);
  const exclusions = [
    ...homeExclusionsForRegion(context.placement, context.recipes, regionId),
    ...(plot === null ? [] : homeFootprintExclusionRects(plot)),
  ];
  const standing = structureStandingPoint(target, plot, recipe, exclusions);
  if (standing === null) {
    return fallbackRoute(recipe, target, actorId, "no-legal-standing-point");
  }
  const start = pointTile(placement.point);
  const grid = exclusionAwareGrid(recipe.grid, exclusions, [start]);
  const result = findNavigationPath(grid, { start, goal: pointTile(standing) });
  if (result.status !== "reached") {
    return fallbackRoute(
      recipe,
      standing,
      actorId,
      result.diagnostic?.code ?? "unreachable",
    );
  }
  const waypoints = connectNavigationEndpoints(grid, result, { start: placement.point });
  if (waypoints === null) return fallbackRoute(recipe, standing, actorId, "invalid-start-connector");
  if (!presentationRouteIsClear(placement.point, waypoints, exclusions)) {
    return fallbackRoute(recipe, standing, actorId, "structure-footprint-blocked");
  }
  return {
    mode: "physical",
    target: waypoints.at(-1) ?? null,
    waypoints,
    reason: null,
  };
}

function fallbackRoute(
  recipe: RegionMapRecipeV1,
  requestedTarget: Vec2 | null,
  actorId: string,
  reason: string,
): HomeRoute {
  const candidates = recipe.stagingPoints
    .filter((point) => {
      const tile = pointTile(point);
      return recipe.grid.collision[tile.row * recipe.grid.columns + tile.column] === 0;
    })
    .map((point) => ({ ...point }));
  candidates.sort((left, right) => {
    if (requestedTarget !== null) {
      const leftDistance = Math.hypot(left.x - requestedTarget.x, left.y - requestedTarget.y);
      const rightDistance = Math.hypot(right.x - requestedTarget.x, right.y - requestedTarget.y);
      if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    }
    const leftRank = stableHash(`${actorId}:${left.x},${left.y}`);
    const rightRank = stableHash(`${actorId}:${right.x},${right.y}`);
    return leftRank - rightRank || left.y - right.y || left.x - right.x;
  });
  const target = candidates[0];
  return target === undefined
    ? { mode: "omitted", target: null, waypoints: [], reason }
    : { mode: "fade-reposition", target: { ...target }, waypoints: [], reason };
}

function pointTile(point: Vec2): Readonly<{ column: number; row: number }> {
  return { column: Math.floor(point.x / 32), row: Math.floor(point.y / 32) };
}

function routeEntryIntents(
  actorId: string,
  route: HomeRoute,
  marker: string,
): readonly ActorVisualIntent[] {
  if (route.mode === "omitted") return [];
  if (route.mode === "fade-reposition") {
    return [actorIntent(actorId, "fade-reposition", route.target, `${marker}:fallback`)];
  }
  // NOT distance-gated, deliberately. A home route ends at a door, and the
  // approach IS the beat: the being ducks in and comes back out, and the
  // renderer's own contest/ruin contracts are written on the being being seen
  // to reach the structure it acted on and to leave it again
  // (`homeContestSystem.test.ts`'s route reversal and "stays at the house it
  // contested" cases). Its length is bounded by the region's plot layout rather
  // than by wherever a resource anchor happened to fall, which is what made the
  // measured 56.5-second harvest unbounded. See `locomotionGate.ts`.
  return [actorIntent(actorId, "move", route.target, marker, route.waypoints)];
}

function routeReturnIntents(
  actorId: string,
  route: HomeRoute,
  marker: string,
): readonly ActorVisualIntent[] {
  if (route.mode !== "physical") return [];
  const waypoints = [...route.waypoints].reverse().map((point) => ({ ...point }));
  // Ungated for the same reason as the entry route it reverses.
  return [actorIntent(actorId, "move", waypoints.at(-1) ?? null, marker, waypoints)];
}

function routeOrigin(route: HomeRoute): Vec2 | null {
  const point = route.mode === "physical" ? route.waypoints[0] : null;
  return point ? { ...point } : null;
}

function actorIntent(
  actorId: string,
  kind: ActorVisualIntent["kind"],
  target: Vec2 | null,
  marker: string,
  waypoints?: readonly Vec2[],
): ActorVisualIntent {
  return {
    actorId,
    kind,
    target: target ? { ...target } : null,
    ...(waypoints === undefined ? {} : { waypoints: waypoints.map((point) => ({ ...point })) }),
    marker,
  };
}

function homeIntent(
  homeId: string,
  kind: HomeVisualIntent["kind"],
  marker: string,
  remnantMaterialsAfter?: number,
): HomeVisualIntent {
  if (kind === "create-provisional") throw new Error("create-provisional requires a typed reservation");
  if (kind === "scavenge") {
    if (typeof remnantMaterialsAfter !== "number"
      || !Number.isFinite(remnantMaterialsAfter)
      || remnantMaterialsAfter < 0) {
      throw new Error("scavenge requires non-negative current-event remnant materials");
    }
    return { homeId, kind, marker, remnantMaterialsAfter };
  }
  if (remnantMaterialsAfter !== undefined) {
    throw new Error("only scavenge may project current-event remnant materials");
  }
  return { homeId, kind, marker };
}

function provisionalHomeIntent(
  homeId: string,
  reservation: HomeReservation,
  marker: string,
): ProvisionalHomeVisualIntent {
  return {
    homeId,
    kind: "create-provisional",
    marker,
    regionId: reservation.regionId,
    plotId: reservation.plotId,
    plot: { ...reservation.plot },
    door: { ...reservation.door },
    kit: reservation.kit,
  };
}

function effectIntent(
  kind: EffectVisualIntent["kind"],
  sourceId: string | null,
  targetId: string | null,
  label?: string,
): EffectVisualIntent {
  return { kind, sourceId, targetId, ...(label === undefined ? {} : { label }) };
}

function fallbackOutcomeEffect(homeId: string): EffectVisualIntent {
  return effectIntent("vignette", null, homeId);
}

function routeDiagnostic(route: HomeRoute, actorId: string): ChoreographyDiagnostic {
  const code = route.mode === "physical" ? "home-route-reached"
    : route.mode === "fade-reposition" ? "home-route-fallback"
      : "home-route-contact-omitted";
  const endpoint = route.target === null ? "none" : `${route.target.x},${route.target.y}`;
  return diagnostic(code, "actor", `${actorId}:${route.reason ?? "reached"}:${endpoint}`);
}

function diagnostic(
  code: string,
  role: ParticipantRole | null,
  detail: string,
): ChoreographyDiagnostic {
  return { code, role, detail };
}

function firstRegionId(frame: PresentedObserverFrame): string | null {
  const values = frame.world.regions.flatMap(({ value }) => typeof value.name === "string" ? [value.name] : []);
  values.sort();
  return values[0] ?? null;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function eventTypeOf<T extends FamilyEventType>(context: ChoreographyContext<T>): T {
  return (context.event as TypedPresentedEvent).type as T;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}
