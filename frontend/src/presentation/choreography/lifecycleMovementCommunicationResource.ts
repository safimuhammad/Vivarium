import type { AgentSnapshot } from "../../app/schemas";
import { TILE_SIZE, tileCenter, type TileCoord } from "../../renderer2d/map/regionMap";
import type { Vec2 } from "../../renderer2d/contracts";
import { stableHash } from "../../renderer2d/production/maps/directedTopology";
import {
  connectNavigationEndpoints,
  findNavigationPath,
} from "../../renderer2d/production/navigation/navigation";
import { decideParticipantFallback } from "../../renderer2d/production/failurePolicy";
import {
  INTERACTION_CONTACT_TOLERANCE_PX,
  homeExclusionsForRegion,
  resolveLegalContactRoute,
} from "./interactionContact";
import type {
  PresentedPayloadByType,
  TypedPresentedEvent,
} from "../eventPayloads";
import { parsePresentedEvent } from "../eventPayloads";
import type {
  ActorVisualIntent,
  DialogueState,
  Direction4,
  EffectVisualIntent,
  HomeVisualIntent,
  PresentedObserverFrame,
  PresentedSceneView,
  StoryFocus,
} from "../contracts";
import {
  sceneMarker,
  type ChoreographyContext,
  type ChoreographyDefinition,
  type ChoreographyDiagnostic,
  type ChoreographyPlan,
  type ParticipantRole,
  type ResolvedParticipant,
} from "./contracts";
import { CONTACT_ROUTE_MAX_MS, certifiedProductionRouteBudgetMs } from "./productionLocomotionTiming";
import { boundLocomotion, gateLocomotion, WALK_MAX_DISTANCE_PX } from "./locomotionGate";

const FAMILY_EVENT_TYPES = [
  "agent_born",
  "agent_died",
  "agent_decayed",
  "agent_paralyzed",
  "agent_recovered",
  "agent_left_region",
  "agent_entered_region",
  "speak",
  "self_talk",
  "resource_changed",
  "resource_transferred",
  "agent_started_hoarding",
] as const;

type FamilyEventType = (typeof FAMILY_EVENT_TYPES)[number];
type StoryPhase = PresentedSceneView["phase"];

const PHASES = Object.freeze([
  "enter",
  "hold",
  "consequence",
  "recover",
  "exit",
] as const satisfies readonly StoryPhase[]);

const MISSING_PARTICIPANT = deepFreeze({
  required: "nearest-staging-fade-reposition" as const,
  optional: "omit-flourish" as const,
  diagnostic: "required participant or anchor uses only the declared observer-safe staging fallback",
});

interface PhaseContent {
  readonly regionId?: string | null;
  readonly actorIntents?: readonly ActorVisualIntent[];
  readonly homeIntents?: readonly HomeVisualIntent[];
  readonly effectIntents?: readonly EffectVisualIntent[];
  readonly dialogue?: DialogueState | null;
  readonly focus?: StoryFocus;
}

interface CausalAppearance {
  readonly actorId: string;
  readonly firstPhase: StoryPhase;
}

interface PlanInput<T extends FamilyEventType> {
  readonly context: ChoreographyContext<T>;
  readonly eventType: T;
  readonly regionId: string | null;
  readonly participants: readonly ResolvedParticipant[];
  readonly diagnostics?: readonly ChoreographyDiagnostic[];
  readonly durationMs: number;
  readonly contactSuffix: string;
  readonly consequenceSuffix: string;
  readonly phaseContent: Readonly<Partial<Record<StoryPhase, PhaseContent>>>;
  readonly causalAppearances?: readonly CausalAppearance[];
}

type DefinitionInput<T extends FamilyEventType> = Omit<
  ChoreographyDefinition<T>,
  "safeCancelMarkers" | "missingParticipant"
>;

/** Lifecycle, movement, communication, and resource definitions in canonical family order. */
export const LIFECYCLE_MOVEMENT_COMMUNICATION_RESOURCE_DEFINITIONS = Object.freeze([
  agentBornDefinition(),
  agentDiedDefinition(),
  agentDecayedDefinition(),
  agentParalyzedDefinition(),
  agentRecoveredDefinition(),
  agentLeftRegionDefinition(),
  agentEnteredRegionDefinition(),
  speakDefinition(),
  selfTalkDefinition(),
  resourceChangedDefinition(),
  resourceTransferredDefinition(),
  agentStartedHoardingDefinition(),
] as const);

function agentBornDefinition(): ChoreographyDefinition<"agent_born"> {
  return definition({
    eventType: "agent_born",
    participants: ["child", "acceptor", "initiator"],
    requiredAnchors: ["current-position", "social"],
    contactMarker: "birth-ready",
    consequenceMarker: "birth-commit",
    duration: { minMs: 2_800, maxMs: 4_800 },
    resolve: (context) => {
      const { payload } = context.event;
      const initiatorRegion = agentRegion(context.frame, payload.initiator_id);
      const acceptorRegion = agentRegion(context.frame, payload.acceptor_id);
      const remoteInitiator = initiatorRegion !== null && initiatorRegion !== payload.region;
      const childPoint = context.placement.agents.get(payload.child_id)?.point ?? null;
      const diagnostics: ChoreographyDiagnostic[] = [];
      if (acceptorRegion !== payload.region) {
        diagnostics.push(diagnostic("acceptor-geography-fallback", "acceptor", "birth remains in payload acceptor region; no other region is invented"));
      }
      if (remoteInitiator) {
        diagnostics.push(diagnostic("remote-initiator-off-map", "initiator", "remote initiator remains outside the birth region"));
      }
      if (childPoint === null) {
        diagnostics.push(diagnostic("birth-placement-deferred", "child", "birth placement must be allocated beside the acceptor by the placement owner"));
      }
      const acceptorReady = actor(payload.acceptor_id, "orient", "birth-ready");
      const childAppears = actor(payload.child_id, "idle", "birth-commit", childPoint);
      const acceptorFocus = { kind: "agent", id: payload.acceptor_id } as const;
      const childFocus = { kind: "agent", id: payload.child_id } as const;
      return plan({
        context,
        eventType: "agent_born",
        regionId: payload.region,
        participants: participants([
          ["child", [payload.child_id]],
          ["acceptor", [payload.acceptor_id]],
          ["initiator", [payload.initiator_id]],
        ]),
        diagnostics,
        durationMs: context.reducedMotion ? 2_800 : 3_600,
        contactSuffix: "birth-ready",
        consequenceSuffix: "birth-commit",
        causalAppearances: [{ actorId: payload.child_id, firstPhase: "consequence" }],
        phaseContent: {
          enter: { actorIntents: [acceptorReady], focus: acceptorFocus },
          hold: { actorIntents: [actor(payload.acceptor_id, "reach", "birth-ready")], focus: acceptorFocus },
          consequence: { actorIntents: [childAppears], effectIntents: context.reducedMotion ? [] : [effect("particle", payload.acceptor_id, payload.child_id)], focus: childFocus },
          recover: { actorIntents: [actor(payload.child_id, "idle", null, childPoint)], focus: childFocus },
          exit: { actorIntents: [actor(payload.child_id, "idle", null, childPoint)], focus: childFocus },
        },
      });
    },
  });
}

function agentDiedDefinition(): ChoreographyDefinition<"agent_died"> {
  return definition({
    eventType: "agent_died",
    participants: ["victim", "killer"],
    requiredAnchors: ["current-position", "social"],
    contactMarker: "fall-contact",
    consequenceMarker: "death-commit",
    duration: { minMs: 3_800, maxMs: 6_000 },
    resolve: (context) => {
      const { payload } = context.event;
      const victimPoint = context.placement.agents.get(payload.victim_id)?.point ?? null;
      const physical = coLocated(context.frame, payload.killer_id, payload.victim_id, payload.region);
      const diagnostics = physical
        ? []
        : [diagnostic("killer-contact-fallback", "killer", "killer contact is omitted unless the presented frame proves co-location")];
      const terminal = actor(payload.victim_id, "dead", "death-commit", victimPoint);
      return plan({
        context,
        eventType: "agent_died",
        regionId: payload.region,
        participants: participants([
          ["victim", [payload.victim_id]],
          ["killer", [payload.killer_id]],
        ]),
        diagnostics,
        durationMs: context.reducedMotion ? 3_800 : 4_800,
        contactSuffix: "fall-contact",
        consequenceSuffix: "death-commit",
        phaseContent: {
          enter: { actorIntents: physical ? [actor(payload.killer_id, "orient", null, victimPoint)] : [] },
          hold: { actorIntents: [
            ...(physical && !context.reducedMotion ? [actor(payload.killer_id, "reach", "fall-contact", victimPoint)] : []),
            actor(payload.victim_id, "hurt", "fall-contact", victimPoint),
          ] },
          consequence: {
            actorIntents: [terminal],
            effectIntents: [
              ...(context.reducedMotion ? [] : [effect("camera-impulse", payload.killer_id, payload.victim_id)]),
              // Loot visibly leaves the corpse and arrives at the killer -- the
              // FLYING ITEM primitive's "loot on agent_died" case. Only when the
              // killer actually looted something (a starvation/decay-triggered
              // agent_died has no killer to loot for) and contact was physical.
              ...(physical && (payload.looted_energy > 0 || payload.looted_materials > 0)
                ? [{
                    kind: "flying-item" as const,
                    sourceId: payload.victim_id,
                    targetId: payload.killer_id,
                    icon: payload.looted_energy >= payload.looted_materials ? "energy" as const : "materials" as const,
                    label: lootLabel(payload.looted_energy, payload.looted_materials),
                  }]
                : []),
            ],
          },
          recover: { actorIntents: [terminal] },
          exit: { actorIntents: [terminal] },
        },
      });
    },
  });
}

function agentDecayedDefinition(): ChoreographyDefinition<"agent_decayed"> {
  return definition({
    eventType: "agent_decayed",
    participants: ["victim"],
    requiredAnchors: ["current-position"],
    contactMarker: "decay-return",
    consequenceMarker: "decay-commit",
    duration: { minMs: 2_200, maxMs: 4_000 },
    resolve: (context) => {
      const { payload } = context.event;
      const corpseExists = hasAgent(context.frame, payload.agent_id);
      return plan({
        context,
        eventType: "agent_decayed",
        regionId: payload.region,
        participants: participants([["victim", [payload.agent_id]]]),
        diagnostics: corpseExists ? [] : [diagnostic("corpse-missing", "victim", "decay remains an effect-only record and never recreates a corpse")],
        durationMs: context.reducedMotion ? 2_200 : 3_000,
        contactSuffix: "decay-return",
        consequenceSuffix: "decay-commit",
        phaseContent: {
          enter: { actorIntents: corpseExists ? [actor(payload.agent_id, "dead")] : [] },
          hold: { actorIntents: corpseExists ? [actor(payload.agent_id, "dead", "decay-return")] : [], effectIntents: context.reducedMotion ? [] : [effect("particle", payload.agent_id, null)] },
          consequence: {},
          recover: {},
          exit: {},
        },
      });
    },
  });
}

function agentParalyzedDefinition(): ChoreographyDefinition<"agent_paralyzed"> {
  return definition({
    eventType: "agent_paralyzed",
    participants: ["victim", "killer"],
    requiredAnchors: ["current-position"],
    contactMarker: "fall-contact",
    consequenceMarker: "paralysis-commit",
    duration: { minMs: 2_400, maxMs: CONTACT_ROUTE_MAX_MS },
    resolve: (context) => {
      const { payload } = context.event;
      const victimId = payload.agent_id;
      const attackerId = payload.trigger === "attack" ? payload.attacker_id : null;
      const groupedStrike = context.moment.chainKind === "strike-fall";
      const priorAttack = groupedStrike ? matchingPriorAttack(context, attackerId, victimId) : null;
      const contactRoute = priorAttack === null
        ? null
        : resolveContactRoute(context, priorAttack.attacker_id, priorAttack.victim_id, priorAttack.region);
      const contactTarget = context.placement.agents.get(victimId)?.point ?? null;
      const resolvedParticipants: ResolvedParticipant[] = [participant("victim", [victimId])];
      if (attackerId !== null) resolvedParticipants.push(participant("killer", [attackerId]));
      const terminal = actor(victimId, "prone", "paralysis-commit");
      return plan({
        context,
        eventType: "agent_paralyzed",
        regionId: payload.region,
        participants: resolvedParticipants,
        diagnostics: groupedStrike
          ? [diagnostic("strike-fall-chain-terminal", "victim", "the matching attack contact is reused; no second strike is authored")]
          : [],
        durationMs: context.reducedMotion ? 2_400 : groupedStrike ? 4_200 : 3_200,
        contactSuffix: "fall-contact",
        consequenceSuffix: "paralysis-commit",
        phaseContent: {
          enter: {
            actorIntents: attackerId === null
              ? []
              : contactRoute?.status === "reached" && !context.reducedMotion
                ? [moveActor(attackerId, contactRoute, null)]
                : [actor(attackerId, "orient", null, contactTarget, undefined, contactRoute?.facing ?? undefined)],
          },
          hold: {
            actorIntents: [
              ...(priorAttack !== null && attackerId !== null
                ? [actor(attackerId, "reach", "strike-contact", contactTarget, undefined, contactRoute?.facing ?? undefined)]
                : []),
              actor(victimId, "hurt", "fall-contact"),
            ],
            // IMPACT: a status flash on the collapsing being, distinguishing an
            // attack-triggered collapse (impact already visible from the strike
            // itself) from a starvation/breath-triggered one (no attacker at
            // all) with the SAME status word either way -- "paralyzed" is the
            // meaning that needs to land, not which cause produced it.
            effectIntents: context.reducedMotion ? [] : [
              { kind: "impact", sourceId: victimId, targetId: attackerId, polarity: "status", label: "PARALYZED" },
            ],
          },
          consequence: { actorIntents: [terminal] },
          recover: { actorIntents: [terminal] },
          exit: { actorIntents: [terminal] },
        },
      });
    },
  });
}

function agentRecoveredDefinition(): ChoreographyDefinition<"agent_recovered"> {
  return definition({
    eventType: "agent_recovered",
    participants: ["giver", "recipient"],
    requiredAnchors: ["current-position", "social"],
    contactMarker: "gift-contact",
    consequenceMarker: "recovery-commit",
    // maxMs raised to the shared CONTACT_ROUTE_MAX_MS ceiling: the giver may
    // now approach the fallen recipient (see `approachRoute` below), the same
    // route-bearing shape as resource_transferred/attack, so this definition
    // needs the same generous route budget they already declare (see
    // productionLocomotionTiming.ts's CONTACT_ROUTE_MAX_MS doc comment for
    // the failure mode this prevents).
    duration: { minMs: 3_000, maxMs: CONTACT_ROUTE_MAX_MS },
    resolve: (context) => {
      const { payload } = context.event;
      const local = coLocated(context.frame, payload.giver_id, payload.recipient_id, payload.region);
      const grouped = context.moment.chainKind === "gift-recovery";
      const recipientPoint = context.placement.agents.get(payload.recipient_id)?.point ?? null;
      // The giver now physically approaches the fallen recipient when not
      // already within contact range, using the SAME immediate/approach
      // distinction and `resolveContactRoute` collision-aware pathfinder
      // resource_transferred and attack already use -- previously a same-
      // region giver only ever turned to face wherever the recipient
      // happened to be independently staged, without ever closing the gap.
      // A cross-region (or otherwise unresolvable) rescue still falls back
      // to the portrait cue exactly as before.
      const immediate = local
        ? withinPhysicalHandoffRange(context, payload.giver_id, payload.recipient_id, payload.region)
        : false;
      const approachRoute = local && !immediate
        ? resolveContactRoute(context, payload.giver_id, payload.recipient_id, payload.region)
        : null;
      const approached = approachRoute?.status === "reached";
      const physical = immediate || approached;
      const approachTarget = approached ? approachRoute!.waypoints.at(-1) ?? null : null;
      const facing = approached ? approachRoute!.facing ?? undefined : undefined;
      return plan({
        context,
        eventType: "agent_recovered",
        regionId: payload.region,
        participants: participants([
          ["giver", [payload.giver_id]],
          ["recipient", [payload.recipient_id]],
        ]),
        diagnostics: [
          ...(grouped ? [diagnostic("gift-recovery-chain", "recipient", "gift contact is rendered before rising despite evidence emission order")] : []),
          ...(!physical ? [diagnostic(
            "recovery-contact-fallback",
            "giver",
            approachRoute !== null
              ? approachRoute.detail
              : "physical rescue is omitted without presented co-location",
          )] : []),
        ],
        durationMs: context.reducedMotion ? 3_000 : 4_200,
        contactSuffix: "gift-contact",
        consequenceSuffix: "recovery-commit",
        phaseContent: {
          enter: {
            actorIntents: [
              actor(payload.recipient_id, "prone", null, recipientPoint),
              ...(physical
                ? (approached
                    ? (context.reducedMotion
                        ? [actor(payload.giver_id, "fade-reposition", null, approachTarget, undefined, facing)]
                        : [moveActor(payload.giver_id, approachRoute!, null)])
                    : [actor(payload.giver_id, "orient", null, recipientPoint)])
                : []),
            ],
          },
          hold: {
            actorIntents: physical
              ? [actor(payload.giver_id, "reach", "gift-contact", recipientPoint, undefined, facing), actor(payload.recipient_id, "prone", null, recipientPoint)]
              : [actor(payload.recipient_id, "prone", null, recipientPoint)],
            // FLYING ITEM: the gift of energy visibly leaves the giver and
            // arrives at the recipient -- supersedes the old particle-only
            // acknowledgment, which never showed anything actually crossing
            // the gap between the two beings.
            effectIntents: physical
              ? (context.reducedMotion ? [] : [{
                  kind: "flying-item" as const,
                  sourceId: payload.giver_id,
                  targetId: payload.recipient_id,
                  icon: "energy" as const,
                  label: `+${payload.amount}`,
                }])
              : [effect("portrait", payload.giver_id, payload.recipient_id)],
          },
          consequence: { actorIntents: [actor(payload.recipient_id, "recover", "recovery-commit", recipientPoint)] },
          recover: { actorIntents: [actor(payload.recipient_id, "recover", null, recipientPoint)] },
          exit: { actorIntents: [actor(payload.recipient_id, "idle", null, recipientPoint)] },
        },
      });
    },
  });
}

function agentLeftRegionDefinition(): ChoreographyDefinition<"agent_left_region"> {
  return definition({
    eventType: "agent_left_region",
    participants: ["actor"],
    requiredAnchors: ["current-position", "departure-gate", "atlas"],
    contactMarker: "departure-gate-reached",
    consequenceMarker: "departure-commit",
    duration: { minMs: 1_800, maxMs: CONTACT_ROUTE_MAX_MS },
    resolve: (context) => movementPlan(context, "agent_left_region"),
  });
}

function agentEnteredRegionDefinition(): ChoreographyDefinition<"agent_entered_region"> {
  return definition({
    eventType: "agent_entered_region",
    participants: ["actor"],
    requiredAnchors: ["arrival-gate", "current-position", "atlas"],
    contactMarker: "arrival-gate-reached",
    consequenceMarker: "arrival-commit",
    duration: { minMs: 2_200, maxMs: CONTACT_ROUTE_MAX_MS },
    resolve: (context) => movementPlan(context, "agent_entered_region"),
  });
}

function movementPlan<T extends "agent_left_region" | "agent_entered_region">(
  context: ChoreographyContext<T>,
  eventType: T,
): ChoreographyPlan {
  const payload = (context.event as unknown as {
    readonly payload: PresentedPayloadByType["agent_left_region"];
  }).payload;
  const entered = eventType === "agent_entered_region";
  const paired = context.moment.chainKind === "travel";
  const regionId = entered ? payload.to_region : payload.from_region;
  const retained = context.placement.agents.get(payload.agent_id) ?? null;
  const suffix = entered ? "arrival-gate-reached" : "departure-gate-reached";
  const consequence = entered ? "arrival-commit" : "departure-commit";
  const arrivalRoute = entered
    ? resolveMovementRoute(context, payload.agent_id, payload.from_region, payload.to_region, true)
    : null;
  const departureRoute = !entered || paired
    ? resolveMovementRoute(context, payload.agent_id, payload.from_region, payload.to_region, false)
    : null;
  const primaryRoute = entered ? arrivalRoute! : departureRoute!;
  const target = primaryRoute.waypoints.at(-1) ?? null;
  const code = entered ? "arrival-placement-deferred" : "departure-placement-missing";
  const diagnostics: ChoreographyDiagnostic[] = [];
  if (primaryRoute.status === "unauthorized") {
    diagnostics.push(diagnostic("unauthorized-directed-edge", "actor", `no declared ${payload.from_region} -> ${payload.to_region} gate exists`));
  } else if (primaryRoute.status === "fallback") {
    diagnostics.push(diagnostic(primaryRoute.code, "actor", primaryRoute.detail));
  } else {
    const waypointCount = (departureRoute?.waypoints.length ?? 0) + (arrivalRoute?.waypoints.length ?? 0);
    diagnostics.push(diagnostic("legal-directed-path", "actor", `${waypointCount} canonical Task 6 waypoints resolve the exact directed edge`));
  }
  if (entered && (retained === null || retained.regionId !== payload.to_region)) {
    diagnostics.push(diagnostic(code, "actor", "arrival gate is exact; final placement remains owned by the consequence placement generation"));
  }
  return plan({
    context,
    eventType,
    regionId,
    participants: participants([["actor", [payload.agent_id]]]),
    diagnostics,
    durationMs: context.reducedMotion ? (entered ? 2_200 : 1_800) : paired ? 6_400 : entered ? 4_200 : 3_200,
    contactSuffix: suffix,
    consequenceSuffix: consequence,
    phaseContent: {
      enter: {
        regionId: payload.from_region,
        actorIntents: departureRoute?.status === "reached"
          ? context.reducedMotion
            ? [actor(payload.agent_id, "fade-reposition", "departure-gate-reached", departureRoute.waypoints.at(-1)!, undefined, departureRoute.facing ?? undefined)]
            : [moveActor(payload.agent_id, departureRoute, "departure-gate-reached", "bound")]
          : entered && arrivalRoute?.status === "reached" && !paired
            ? []
            : [],
      },
      hold: {
        regionId,
        effectIntents: primaryRoute.status === "unauthorized" ? [] : [effect("atlas-transition", payload.from_region, payload.to_region)],
      },
      consequence: {
        regionId,
        actorIntents: arrivalRoute?.status === "reached"
          ? context.reducedMotion
            ? [actor(payload.agent_id, "fade-reposition", consequence, target, undefined, arrivalRoute.facing ?? undefined)]
            : [moveActor(payload.agent_id, arrivalRoute, consequence, "whole")]
          : !entered && target !== null
            ? [actor(payload.agent_id, "idle", consequence, target, undefined, departureRoute?.facing ?? undefined)]
            : [],
      },
      recover: { regionId, actorIntents: target === null ? [] : [actor(payload.agent_id, "idle", null, target, undefined, primaryRoute.facing ?? undefined)] },
      exit: { regionId, actorIntents: target === null ? [] : [actor(payload.agent_id, "idle", null, target, undefined, primaryRoute.facing ?? undefined)] },
    },
  });
}

function speakDefinition(): ChoreographyDefinition<"speak"> {
  return definition({
    eventType: "speak",
    participants: ["actor", "target"],
    requiredAnchors: ["current-position", "social", "atlas"],
    contactMarker: "speech-visible",
    consequenceMarker: "speech-commit",
    // maxMs raised to the shared CONTACT_ROUTE_MAX_MS ceiling: a same-region
    // targeted speaker may now approach the listener (see `approachRoute`
    // below), the same route-bearing shape as resource_transferred/attack, so
    // this definition needs the same generous route budget they already
    // declare (see productionLocomotionTiming.ts's CONTACT_ROUTE_MAX_MS doc
    // comment for the failure mode this prevents).
    duration: { minMs: 3_000, maxMs: CONTACT_ROUTE_MAX_MS },
    resolve: (context) => {
      const { payload } = context.event;
      const targetId = payload.target_id;
      const targetRegion = targetId === null ? null : agentRegion(context.frame, targetId);
      const localTarget = targetId !== null && targetRegion === payload.region;
      const remoteTarget = targetId !== null && targetRegion !== null && targetRegion !== payload.region;
      const dialogue = visibleDialogue(context.frame, payload.speaker_id, payload.message, context.moment.lastCursor);
      const speakerPoint = context.placement.agents.get(payload.speaker_id)?.point ?? null;
      const targetPoint = localTarget && targetId !== null
        ? context.placement.agents.get(targetId)?.point ?? null
        : null;
      // A same-region targeted speaker (whisper or a targeted public line
      // alike) now physically approaches the listener when not already
      // within conversational contact range, using the SAME immediate/
      // approach distinction and `resolveContactRoute` collision-aware
      // pathfinder resource_transferred and attack already use -- previously
      // the speaker only ever turned to face the listener across whatever
      // gap independent staging happened to leave between them, and never
      // closed it. An untargeted public broadcast (no listener at all) and a
      // cross-region whisper (no on-screen listener to walk toward) are left
      // exactly as before -- there is nothing physical to approach.
      const immediate = localTarget && targetId !== null
        ? withinPhysicalHandoffRange(context, payload.speaker_id, targetId, payload.region)
        : false;
      const approachRoute = localTarget && targetId !== null && !immediate
        ? resolveContactRoute(context, payload.speaker_id, targetId, payload.region)
        : null;
      const approached = approachRoute?.status === "reached";
      const approachTarget = approached ? approachRoute!.waypoints.at(-1) ?? null : null;
      const facing = approached ? approachRoute!.facing ?? undefined : undefined;
      const speakerContactPoint = approachTarget ?? speakerPoint;
      const actorIntents = [actor(payload.speaker_id, "speak", "speech-visible", targetPoint, undefined, facing)];
      // The listener now turns to face the speaker (bidirectional facing, target
      // point supplied), mirroring resource_transferred and attack -- previously
      // the listener's own orient carried no target point, so it never turned
      // back even though the speaker turned to face it. Once the speaker has
      // physically approached, the listener faces the speaker's real (post-
      // approach) contact point, not the stale pre-approach placement.
      if (localTarget && targetId !== null) actorIntents.push(actor(targetId, "orient", null, speakerContactPoint));
      return plan({
        context,
        eventType: "speak",
        regionId: payload.region,
        participants: participants([
          ["actor", [payload.speaker_id]],
          ["target", targetId === null ? [] : [targetId]],
        ]),
        diagnostics: [
          ...(targetId === null ? [diagnostic("local-broadcast-no-listener", "target", "public speech animates only its named speaker")] : []),
          ...(remoteTarget ? [diagnostic("remote-whisper-no-teleport", "target", "remote target is represented by portrait and atlas only")] : []),
          ...(targetId !== null && targetRegion === null ? [diagnostic("target-region-unknown", "target", "unknown target geography omits physical target animation")] : []),
          ...(localTarget && targetId !== null && !immediate && !approached ? [diagnostic(
            "speech-contact-fallback",
            "target",
            approachRoute !== null
              ? approachRoute.detail
              : "same-region listener outside contact range remains in place while the bubble narrates the words",
          )] : []),
        ],
        durationMs: speechDuration(payload.message),
        contactSuffix: "speech-visible",
        consequenceSuffix: "speech-commit",
        phaseContent: {
          enter: {
            actorIntents: approached
              ? (context.reducedMotion
                  ? [actor(payload.speaker_id, "fade-reposition", null, approachTarget, undefined, facing)]
                  : [moveActor(payload.speaker_id, approachRoute!, null)])
              : [actor(payload.speaker_id, "orient", null, targetPoint)],
          },
          hold: {
            actorIntents,
            dialogue,
            effectIntents: [
              // A real speech bubble carries the actual words above the
              // speaker's head. A same-region targeted whisper gets the
              // "whisper" variant (smaller, dimmer, tail leaning toward the
              // listener); a public broadcast or a cross-region whisper
              // (which has no physical listener on screen to whisper "at")
              // gets "spoken". Narration text already distinguishes "whispers
              // to you" from "says" (agents/runtime.py); this gives the same
              // distinction a visual, not just a text, difference. Reduced
              // motion still shows the bubble (only animation is suppressed,
              // and this primitive has none to suppress) -- it is the reading
              // surface itself, not a decorative flourish.
              {
                kind: "speech-bubble",
                sourceId: payload.speaker_id,
                targetId,
                text: payload.message,
                variant: localTarget ? "whisper" : "spoken",
              },
              ...(remoteTarget ? [effect("portrait", payload.speaker_id, targetId), effect("atlas-transition", payload.region, targetRegion)] : []),
            ],
          },
          consequence: { actorIntents: [actor(payload.speaker_id, "speak", "speech-commit", speakerContactPoint, undefined, facing)], dialogue },
          recover: { actorIntents: [actor(payload.speaker_id, "idle", null, speakerContactPoint, undefined, facing)], dialogue },
          exit: { actorIntents: [actor(payload.speaker_id, "idle", null, speakerContactPoint, undefined, facing)] },
        },
      });
    },
  });
}

function selfTalkDefinition(): ChoreographyDefinition<"self_talk"> {
  return definition({
    eventType: "self_talk",
    participants: ["actor"],
    requiredAnchors: ["current-position"],
    contactMarker: "thought-visible",
    consequenceMarker: "thought-commit",
    duration: { minMs: 3_000, maxMs: 14_000 },
    resolve: (context) => {
      const { payload } = context.event;
      const selected = context.frame.selection?.kind === "agent" && context.frame.selection.id === payload.agent_id;
      // Dialogue text and the thought-bubble effect are now always populated in
      // the plan, regardless of `selected` at THIS resolve() call. `resolve()`
      // runs exactly once, at the moment the story dequeues this moment -- which
      // can (and in practice regularly does, e.g. autoplay racing ahead of a QA
      // driver, or a viewer selecting the thinker mid-moment) happen BEFORE the
      // viewer has selected the thinker. Gating here permanently freezes
      // "unselected" into the plan and a later selection can never revive it,
      // since nothing re-resolves an already-active moment. Privacy is instead
      // enforced live, at draw/read time, downstream: `selectPresentedDialogue`'s
      // `isMomentVisible` (selectors.ts) already gates dialogue text this way for
      // every other consumer of a private self_talk moment; effectCommands()
      // (ProductionSceneCommandResolver.ts) mirrors that same live check for the
      // thought-bubble effect. See selectors.ts's `isMomentVisible` for the
      // parallel, already-correct precedent this mirrors.
      const dialogue = visibleDialogue(context.frame, payload.agent_id, payload.message, context.moment.lastCursor);
      const visibleActor = selected ? [actor(payload.agent_id, "idle", "thought-visible")] : [];
      // self_talk's own payload carries no region field (the backend never stamps
      // one -- agents/runtime.py:_emit_self_talk -- since the event is PRIVATE and
      // routed nowhere). The thinker's own presented position is still knowable
      // from the frame, so look it up the same way speakDefinition resolves a
      // remote target's region; a hardcoded null here (rather than this lookup)
      // stranded the camera on the region-less "Between Moments" placeholder for
      // every self_talk moment, selected or not.
      const regionId = agentRegion(context.frame, payload.agent_id);
      return plan({
        context,
        eventType: "self_talk",
        regionId,
        participants: participants([["actor", [payload.agent_id]]]),
        diagnostics: [
          ...(selected ? [] : [diagnostic("private-thought-gated", "actor", "private thought remains hidden unless its exact actor is selected")]),
          ...(regionId === null ? [diagnostic("self-talk-region-unknown", "actor", "self-talk falls back to no active region because the thinking agent is not currently presented")] : []),
        ],
        durationMs: speechDuration(payload.message),
        contactSuffix: "thought-visible",
        consequenceSuffix: "thought-commit",
        phaseContent: {
          enter: { actorIntents: visibleActor },
          hold: {
            actorIntents: visibleActor,
            dialogue,
            // The thought-bubble variant carries the thinker's private words;
            // it is baked into the plan unconditionally (not gated on
            // `selected` here -- see the comment above) and privacy is
            // enforced live downstream in `effectCommands()`, mirroring
            // `isMomentVisible`'s live gate on the dialogue text.
            effectIntents: [{
              kind: "speech-bubble",
              sourceId: payload.agent_id,
              targetId: null,
              text: payload.message,
              variant: "thought",
            }],
          },
          consequence: { actorIntents: selected ? [actor(payload.agent_id, "idle", "thought-commit")] : [], dialogue },
          recover: { actorIntents: selected ? [actor(payload.agent_id, "idle")] : [], dialogue },
          exit: {},
        },
      });
    },
  });
}

function resourceChangedDefinition(): ChoreographyDefinition<"resource_changed"> {
  return definition({
    eventType: "resource_changed",
    participants: ["actor"],
    requiredAnchors: ["current-position", "resource-energy", "resource-materials"],
    contactMarker: "work-contact",
    consequenceMarker: "harvest-commit",
    duration: { minMs: 1_800, maxMs: CONTACT_ROUTE_MAX_MS },
    resolve: (context) => {
      const { payload } = context.event;
      const anchor = payload.resource_type === "energy" ? "resource-energy" : "resource-materials";
      const route = resolveResourceRoute(context, payload.agent_id, payload.region, payload.resource_type);
      const target = route.waypoints.at(-1) ?? null;
      const diagnostics = route.status === "reached"
        ? [diagnostic("legal-resource-path", "actor", `${route.waypoints.length} canonical Task 6 waypoints reach the exact ${anchor} patch`)]
        : [diagnostic(`${anchor}-anchor-fallback`, "actor", route.detail)];
      return plan({
        context,
        eventType: "resource_changed",
        regionId: payload.region,
        participants: participants([["actor", [payload.agent_id]]]),
        diagnostics,
        durationMs: context.reducedMotion ? 1_800 : 2_600,
        contactSuffix: "work-contact",
        consequenceSuffix: "harvest-commit",
        phaseContent: {
          enter: {
            actorIntents: route.status !== "reached"
              ? []
              : context.reducedMotion
                ? [actor(payload.agent_id, "fade-reposition", null, target, undefined, route.facing ?? undefined)]
                : [moveActor(payload.agent_id, route, null)],
          },
          hold: { actorIntents: target === null ? [] : [actor(payload.agent_id, "gather", "work-contact", target, undefined, route.facing ?? undefined)] },
          consequence: { actorIntents: target === null ? [] : [actor(payload.agent_id, "idle", "harvest-commit", target, undefined, route.facing ?? undefined)] },
          recover: { actorIntents: target === null ? [] : [actor(payload.agent_id, "idle", null, target, undefined, route.facing ?? undefined)] },
          exit: { actorIntents: target === null ? [] : [actor(payload.agent_id, "idle", null, target, undefined, route.facing ?? undefined)] },
        },
      });
    },
  });
}

function resourceTransferredDefinition(): ChoreographyDefinition<"resource_transferred"> {
  return definition({
    eventType: "resource_transferred",
    participants: ["giver", "recipient"],
    requiredAnchors: ["current-position", "social"],
    contactMarker: "hand-contact",
    consequenceMarker: "transfer-commit",
    // maxMs raised from the original 4_000: an approach walk (see approachRoute
    // below) can legitimately need the same generous route budget every other
    // route-bearing definition in this file already declares (movementPlan,
    // resourceChangedDefinition, agentStartedHoardingDefinition all use the
    // shared CONTACT_ROUTE_MAX_MS ceiling).
    duration: { minMs: 2_200, maxMs: CONTACT_ROUTE_MAX_MS },
    resolve: (context) => {
      const { payload } = context.event;
      // Two independent notions of "close enough": `immediate` is the original,
      // narrow check (already-adjacent placements need no walk at all -- keeps
      // every existing near-endpoint scenario byte-for-byte unchanged). When that
      // fails, `approachRoute` asks the same collision-aware contact-route finder
      // `attack`/`mating_initiated` already use (bondCombat.ts) to walk the giver
      // to a tile beside the recipient, however far apart the two independently-
      // staged placements happen to be within the region.
      //
      // This second path is the actual G1 F2 repair: `withinPhysicalHandoffRange`
      // alone requires the two placements to already sit within one 32px tile,
      // but `PlacementLedger.stagingPlacement` hashes each agent to a *distinct*
      // staging anchor at least 71px apart (`STAGING_POINT_STEP`), and no route
      // was ever authored to close that gap -- so in live replay (unlike the
      // hand-placed unit fixtures below) the "local" branch was structurally
      // almost never reachable, and the transfer mote never appeared.
      const immediate = withinPhysicalHandoffRange(
        context,
        payload.sender_id,
        payload.receiver_id,
        payload.region,
      );
      const sameRegion = coLocated(context.frame, payload.sender_id, payload.receiver_id, payload.region);
      const approachRoute = !immediate && sameRegion
        ? resolveContactRoute(context, payload.sender_id, payload.receiver_id, payload.region)
        : null;
      const approached = approachRoute?.status === "reached";
      const physical = immediate || approached;
      const senderPoint = context.placement.agents.get(payload.sender_id)?.point ?? null;
      const receiverPoint = context.placement.agents.get(payload.receiver_id)?.point ?? null;
      const approachTarget = approached ? approachRoute!.waypoints.at(-1) ?? null : null;
      const senderContactPoint = approachTarget ?? senderPoint;
      const facing = approached ? approachRoute!.facing ?? undefined : undefined;
      const transferFocus = { kind: "agent", id: payload.sender_id } as const;
      const dialogue = visibleDialogue(
        context.frame,
        payload.sender_id,
        transferDialogueText(context.frame, payload),
        context.moment.lastCursor,
      );
      return plan({
        context,
        eventType: "resource_transferred",
        regionId: payload.region,
        participants: participants([
          ["giver", [payload.sender_id]],
          ["recipient", [payload.receiver_id]],
        ]),
        diagnostics: physical ? [] : [diagnostic(
          "transfer-contact-fallback",
          "recipient",
          approachRoute !== null
            ? approachRoute.detail
            : "same-region transfer endpoints outside one-tile contact remain in place while the labeled dialogue narrates the handoff",
        )],
        durationMs: 3_200,
        contactSuffix: "hand-contact",
        consequenceSuffix: "transfer-commit",
        phaseContent: {
          enter: {
            focus: transferFocus,
            actorIntents: immediate
              ? [
                  actor(payload.sender_id, "orient", null, receiverPoint),
                  actor(payload.receiver_id, "orient", null, senderPoint),
                ]
              : approached
                ? [
                    ...(context.reducedMotion
                      ? [actor(payload.sender_id, "fade-reposition", null, approachTarget, undefined, facing)]
                      : [moveActor(payload.sender_id, approachRoute!, null)]),
                    actor(payload.receiver_id, "orient", null, approachTarget),
                  ]
                : [actor(payload.sender_id, "idle")],
          },
          hold: {
            focus: transferFocus,
            dialogue,
            actorIntents: physical
              ? [actor(payload.sender_id, "reach", "hand-contact", receiverPoint, undefined, facing)]
              : [actor(payload.sender_id, "idle")],
            // FLYING ITEM: the resource visibly leaves the sender and arrives
            // at the receiver -- supersedes the old particle-only mote, which
            // never showed anything actually crossing the gap.
            effectIntents: physical && !context.reducedMotion
              ? [{
                  kind: "flying-item" as const,
                  sourceId: payload.sender_id,
                  targetId: payload.receiver_id,
                  icon: payload.resource_type === "energy" ? "energy" as const : "materials" as const,
                  label: `+${payload.amount}`,
                }]
              : [],
          },
          consequence: {
            focus: transferFocus,
            dialogue,
            actorIntents: physical
              ? [
                  actor(payload.sender_id, "idle", "transfer-commit", senderContactPoint, undefined, facing),
                  actor(payload.receiver_id, "idle", null, receiverPoint),
                ]
              : [actor(payload.sender_id, "idle", "transfer-commit")],
          },
          recover: {
            focus: transferFocus,
            actorIntents: physical
              ? [actor(payload.sender_id, "idle", null, senderContactPoint, undefined, facing), actor(payload.receiver_id, "idle", null, receiverPoint)]
              : [actor(payload.sender_id, "idle")],
          },
          exit: {
            focus: transferFocus,
            actorIntents: physical
              ? [actor(payload.sender_id, "idle", null, senderContactPoint, undefined, facing), actor(payload.receiver_id, "idle", null, receiverPoint)]
              : [actor(payload.sender_id, "idle")],
          },
        },
      });
    },
  });
}

function agentStartedHoardingDefinition(): ChoreographyDefinition<"agent_started_hoarding"> {
  return definition({
    eventType: "agent_started_hoarding",
    participants: ["actor", "giver"],
    requiredAnchors: ["current-position"],
    contactMarker: "resource-contact",
    consequenceMarker: "hoard-commit",
    duration: { minMs: 1_400, maxMs: CONTACT_ROUTE_MAX_MS },
    resolve: (context) => {
      const { payload } = context.event;
      const grouped = context.moment.chainKind === "resource-hoard";
      const prior = grouped ? parsePriorEvidence(context) : null;
      const enterActors: ActorVisualIntent[] = [];
      const holdActors: ActorVisualIntent[] = [];
      const holdHomes: HomeVisualIntent[] = [];
      const holdEffects: EffectVisualIntent[] = [];
      if (prior?.type === "resource_changed" && prior.payload.agent_id === payload.agent_id) {
        const route = resolveResourceRoute(
          context,
          prior.payload.agent_id,
          prior.payload.region,
          prior.payload.resource_type,
        );
        const target = route.waypoints.at(-1) ?? null;
        if (route.status === "reached") {
          enterActors.push(context.reducedMotion
            ? actor(payload.agent_id, "fade-reposition", null, target, undefined, route.facing ?? undefined)
            : moveActor(payload.agent_id, route, null));
          holdActors.push(actor(payload.agent_id, "gather", "resource-contact", target, undefined, route.facing ?? undefined));
        }
      } else if (
        prior?.type === "resource_transferred"
        && prior.payload.receiver_id === payload.agent_id
      ) {
        // The giver from the preceding resource_transferred now physically
        // approaches the hoarder when not already within contact range,
        // using the SAME immediate/approach distinction and
        // `resolveContactRoute` collision-aware pathfinder resource_transferred
        // and attack already use -- previously this branch only ever posed
        // the giver already "reach"-ing in place with no move (and, before
        // that, no orient either), regardless of how far apart the two
        // independently-staged placements actually were. A different-region
        // (or otherwise unresolvable) giver still falls back to the portrait
        // cue exactly as before.
        const giverId = prior.payload.sender_id;
        const hoarderId = payload.agent_id;
        const hoardRegion = prior.payload.region;
        const target = context.placement.agents.get(hoarderId)?.point ?? null;
        const local = coLocated(context.frame, giverId, hoarderId, hoardRegion);
        const immediate = local ? withinPhysicalHandoffRange(context, giverId, hoarderId, hoardRegion) : false;
        const approachRoute = local && !immediate
          ? resolveContactRoute(context, giverId, hoarderId, hoardRegion)
          : null;
        const approached = approachRoute?.status === "reached";
        const physical = immediate || approached;
        if (physical) {
          const facing = approached ? approachRoute!.facing ?? undefined : undefined;
          if (approached) {
            enterActors.push(context.reducedMotion
              ? actor(giverId, "fade-reposition", null, approachRoute!.waypoints.at(-1) ?? null, undefined, facing)
              : moveActor(giverId, approachRoute!, null));
          }
          holdActors.push(actor(giverId, "reach", "resource-contact", target, undefined, facing));
        } else {
          holdEffects.push(effect("portrait", giverId, hoarderId));
        }
      } else if (
        prior?.type === "hearth_used"
        && prior.payload.agent_id === payload.agent_id
      ) {
        const target = context.placement.homes.get(prior.payload.home_id)?.door ?? null;
        holdActors.push(actor(payload.agent_id, "kneel", "resource-contact", target));
        holdHomes.push({ homeId: prior.payload.home_id, kind: "hearth", marker: "resource-contact" });
      } else {
        holdActors.push(actor(payload.agent_id, "reach", "resource-contact"));
      }
      const resolvedParticipants: ResolvedParticipant[] = [participant("actor", [payload.agent_id])];
      if (prior?.type === "resource_transferred") {
        resolvedParticipants.push(participant("giver", [prior.payload.sender_id]));
      }
      return plan({
        context,
        eventType: "agent_started_hoarding",
        regionId: payload.region,
        participants: resolvedParticipants,
        diagnostics: grouped ? [diagnostic("resource-hoard-chain-terminal", "actor", "the preceding resource action is retained by the moment and is not replayed as a second harvest")] : [],
        durationMs: context.reducedMotion ? 1_400 : 2_000,
        contactSuffix: "resource-contact",
        consequenceSuffix: "hoard-commit",
        phaseContent: {
          enter: { actorIntents: enterActors.length > 0 ? enterActors : [actor(payload.agent_id, "orient")] },
          hold: { actorIntents: holdActors, homeIntents: holdHomes, effectIntents: holdEffects },
          consequence: { actorIntents: [actor(payload.agent_id, "idle", "hoard-commit")], effectIntents: context.reducedMotion ? [] : [effect("vignette", payload.agent_id, null)] },
          recover: { actorIntents: [actor(payload.agent_id, "idle")] },
          exit: { actorIntents: [actor(payload.agent_id, "idle")] },
        },
      });
    },
  });
}

function definition<T extends FamilyEventType>(input: DefinitionInput<T>): ChoreographyDefinition<T> {
  return deepFreeze({
    ...input,
    participants: [...input.participants],
    requiredAnchors: [...input.requiredAnchors],
    safeCancelMarkers: [`${input.eventType}:scene-safe`, `${input.eventType}:scene-exit`],
    duration: { ...input.duration },
    missingParticipant: MISSING_PARTICIPANT,
  });
}

function plan<T extends FamilyEventType>(input: PlanInput<T>): ChoreographyPlan {
  const prefix = `${input.context.moment.id}:${input.eventType}`;
  const contactMarker = `${prefix}:${input.contactSuffix}`;
  const consequenceMarker = `${prefix}:${input.consequenceSuffix}`;
  const safeAfterConsequence = `${prefix}:scene-safe`;
  const safeAtExit = `${prefix}:scene-exit`;
  const settleMarker = `${prefix}:settled`;
  const timing = routeAwareTiming(input.durationMs, input.phaseContent);
  const boundaries = timing.boundaries;
  const phaseWindows = PHASES.map((phase, index) => ({
    phase,
    startMs: boundaries[index]!,
    endMs: boundaries[index + 1]!,
  }));
  const visibleAgents = visibleAgentIds(input.context.frame);
  const causalAgentIds = new Set((input.causalAppearances ?? []).map(({ actorId }) => actorId));
  const availableParticipants = new Set([...visibleAgents, ...causalAgentIds]);
  const missingIds = missingParticipantIds(input.participants, availableParticipants);
  const participantDecision = missingIds[0] === undefined ? null : decideParticipantFallback({
    subjectId: missingIds[0],
    regionId: input.regionId,
    occurrence: 1,
  });
  const participantFallback = participantDecision?.action === "continue"
    && participantDecision.fallback === "region-narration";
  const focus = participantFallback
    ? regionNarrationFocus(input.regionId)
    : focusFor(input.regionId, input.participants, input.context.moment.focus);
  const phases = PHASES.map((phase): PresentedSceneView => {
    const content = input.phaseContent[phase] ?? {};
    const phaseIndex = PHASES.indexOf(phase);
    const phaseActorIds = new Set([
      ...visibleAgents,
      ...(input.causalAppearances ?? []).flatMap((appearance) => (
        phaseIndex >= PHASES.indexOf(appearance.firstPhase) ? [appearance.actorId] : []
      )),
    ]);
    return {
      momentId: input.context.moment.id,
      regionId: content.regionId === undefined ? input.regionId : content.regionId,
      phase,
      focus: participantFallback ? focus : content.focus ?? focus,
      dialogue: content.dialogue ?? null,
      actorIntents: (content.actorIntents ?? []).filter(({ actorId }) => phaseActorIds.has(actorId)).map((intent) => ({
        ...intent,
        marker: intent.marker === input.contactSuffix
          ? contactMarker
          : intent.marker === input.consequenceSuffix
            ? consequenceMarker
            : intent.marker,
      })),
      homeIntents: (content.homeIntents ?? []).map((intent) => ({
        ...intent,
        marker: intent.marker === input.contactSuffix
          ? contactMarker
          : intent.marker === input.consequenceSuffix
            ? consequenceMarker
            : intent.marker,
      })),
      effectIntents: content.effectIntents ?? [],
      safeCancelMarkers: [safeAfterConsequence, safeAtExit],
      reducedMotion: input.context.reducedMotion,
    };
  });
  const markers = [
    sceneMarker(contactMarker, boundaries[1]!, 0, "contact"),
    sceneMarker(consequenceMarker, boundaries[2]!, 0, "consequence"),
    sceneMarker(safeAfterConsequence, boundaries[3]!, 0, "safe-cancel"),
    sceneMarker(safeAtExit, timing.durationMs, 0, "safe-cancel"),
    sceneMarker(settleMarker, timing.durationMs, 1, "settle"),
  ];
  const endpoint = {
    regionId: input.regionId,
    focus,
    participantIds: input.participants.flatMap((participantValue) => participantValue.ids),
    consequenceMarker,
    settleMarker,
  };
  return deepFreeze({
    id: `choreography:${prefix}`,
    momentId: input.context.moment.id,
    eventType: input.eventType,
    regionId: input.regionId,
    phases,
    phaseWindows,
    markers,
    durationMs: timing.durationMs,
    contactMarker,
    consequenceMarker,
    safeCancelMarkers: [safeAfterConsequence, safeAtExit],
    participants: input.participants,
    diagnostics: [
      ...(input.diagnostics ?? []),
      ...missingParticipantDiagnostics(input.participants, availableParticipants),
    ],
    reducedMotionEndpoint: endpoint,
  });
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
  return uniqueIds(resolved.flatMap(({ ids }) => ids).filter((id) => id !== "world" && !visible.has(id)));
}

function missingParticipantDiagnostics(
  resolved: readonly ResolvedParticipant[],
  visible: ReadonlySet<string>,
): readonly ChoreographyDiagnostic[] {
  return resolved.flatMap(({ role, ids }) => {
    const missing = ids.filter((id) => id !== "world" && !visible.has(id));
    return missing.length === 0
      ? []
      : [diagnostic("missing-required-participant", role, missing.join(","))];
  });
}

function regionNarrationFocus(regionId: string | null): StoryFocus {
  return regionId === null
    ? { kind: "system", regionId: null }
    : { kind: "region", id: regionId };
}

function phaseBoundaries(durationMs: number): readonly number[] {
  const enter = Math.floor(durationMs * 0.18);
  const hold = Math.floor(durationMs * 0.42);
  const consequence = Math.floor(durationMs * 0.58);
  const recover = Math.floor(durationMs * 0.82);
  return [0, enter, hold, consequence, recover, durationMs];
}

function routeAwareTiming(
  minimumDurationMs: number,
  content: Readonly<Partial<Record<StoryPhase, PhaseContent>>>,
): Readonly<{ durationMs: number; boundaries: readonly number[] }> {
  const base = phaseBoundaries(minimumDurationMs);
  const durations = base.slice(1).map((boundary, index) => boundary - base[index]!);
  durations[0] = Math.max(durations[0]!, movementBudgetMs(content.enter?.actorIntents ?? []));
  durations[2] = Math.max(durations[2]!, movementBudgetMs(content.consequence?.actorIntents ?? []));
  const boundaries = [0];
  for (const duration of durations) boundaries.push(boundaries.at(-1)! + duration);
  return { durationMs: boundaries.at(-1)!, boundaries };
}

function movementBudgetMs(intents: readonly ActorVisualIntent[]): number {
  let maximum = 0;
  for (const intent of intents) {
    if (intent.kind !== "move" || intent.waypoints === undefined || intent.waypoints.length < 2) continue;
    maximum = Math.max(maximum, certifiedProductionRouteBudgetMs(intent.waypoints, 48));
  }
  return maximum;
}

function participant(role: ParticipantRole, ids: readonly string[]): ResolvedParticipant {
  return { role, ids: uniqueIds(ids) };
}

function participants(values: readonly (readonly [ParticipantRole, readonly string[]])[]): readonly ResolvedParticipant[] {
  return values.map(([role, ids]) => participant(role, ids)).filter((value) => value.ids.length > 0);
}

function uniqueIds(ids: readonly string[]): readonly string[] {
  return [...new Set(ids.filter((id) => id.trim().length > 0))];
}

function actor(
  actorId: string,
  kind: ActorVisualIntent["kind"],
  marker: string | null = null,
  target: Readonly<{ x: number; y: number }> | null = null,
  waypoints?: readonly Readonly<{ x: number; y: number }>[],
  facing?: Direction4,
): ActorVisualIntent {
  return {
    actorId,
    kind,
    target: target === null ? null : clonePoint(target),
    ...(waypoints === undefined ? {} : { waypoints: waypoints.map(clonePoint) }),
    ...(facing === undefined ? {} : { facing }),
    marker,
  };
}

/**
 * What the one movement seam is allowed to do to a planned walk.
 *
 * - `"gate"` — Safi's distance gate: near enough and the being walks, too far
 *   and the whole beat cuts (`locomotionGate.ts`'s `gateLocomotion`). Every
 *   ordinary walk.
 * - `"bound"` — truncate-then-walk: the walk survives as a walk, but only its
 *   final `WALK_MAX_DISTANCE_PX` is performed; the being is cut to a waypoint of
 *   its own certified route and walks in from there (`boundLocomotion`).
 * - `"whole"` — perform the route exactly as planned.
 *
 * The two halves of a region transition may never be `"gate"`d: a region
 * transition is the only walk that carries transactional continuity — the
 * renderer retains the traveller, commits the destination at the consequence
 * marker and reconciles the arrival across the region change
 * (`CanvasPresentationRenderer`'s `reconcileArrivalContinuity`). A being that
 * appeared *past* its own gate would have entered a region without ever being
 * seen to, and a being that blinked to its gate would leave one without ever
 * being seen to either.
 *
 * Their two halves are bounded by DIFFERENT means, and the asymmetry is forced
 * by which end of the route carries the contract:
 * - The **departure** is `"bound"`. What must be seen is the being reaching its
 *   gate, which is the route's TAIL — so the tail is what is kept.
 * - The **arrival** is `"whole"`. What must be seen is the being emerging from
 *   its gate, which is the route's HEAD, and `lifecycleCommands` publishes that
 *   head verbatim as the placement hint's `arrivalGate`. Truncating an arrival
 *   would move the gate. It is bounded at the point where its GOAL is chosen
 *   instead (`selectDeferredArrivalStagingPoint`) — the only place that can
 *   bound it without breaking the contract.
 */
type LocomotionPolicy = "gate" | "bound" | "whole";

function moveActor(
  actorId: string,
  route: ResolvedRoute,
  marker: string | null,
  policy: LocomotionPolicy = "gate",
): ActorVisualIntent {
  const target = route.waypoints.at(-1) ?? null;
  // Every walk this file plans passes through this ONE seam, so no definition
  // can grow an unbounded walk by accident: `"gate"` is the default, and the two
  // policies that opt out have to say so at the call site and justify it against
  // the contract documented on `LocomotionPolicy`.
  const intent = actor(
    actorId,
    "move",
    marker,
    target,
    route.waypoints,
    route.facing ?? undefined,
  );
  switch (policy) {
    // Safi's distance gate: near enough and the being walks, too far and the
    // whole beat cuts (`locomotionGate.ts`).
    case "gate":
      return gateLocomotion(intent);
    // Truncate-then-walk: the walk survives AS A WALK, reduced to the final
    // `WALK_MAX_DISTANCE_PX` it must be seen performing. Never a cut, because
    // this walk carries the transactional contract.
    case "bound":
      return boundLocomotion(intent);
    // Performed exactly as planned; bounded elsewhere or deliberately not at all.
    case "whole":
      return intent;
  }
}

function clonePoint(point: Readonly<{ x: number; y: number }>): { x: number; y: number } {
  return { x: point.x, y: point.y };
}

function effect(
  kind: EffectVisualIntent["kind"],
  sourceId: string | null,
  targetId: string | null,
): EffectVisualIntent {
  return { kind, sourceId, targetId };
}

function diagnostic(
  code: string,
  role: ParticipantRole | null,
  detail: string,
): ChoreographyDiagnostic {
  return { code, role, detail };
}

function focusFor(
  regionId: string | null,
  resolved: readonly ResolvedParticipant[],
  fallback: StoryFocus,
): StoryFocus {
  const actorId = resolved.find((value) => value.role === "actor")?.ids[0]
    ?? resolved.find((value) => value.role === "victim")?.ids[0]
    ?? resolved.find((value) => value.role === "child")?.ids[0]
    ?? null;
  if (actorId !== null) return { kind: "agent", id: actorId };
  if (regionId !== null) return { kind: "region", id: regionId };
  return fallback;
}

function hasAgent(frame: PresentedObserverFrame, agentId: string): boolean {
  return agentValue(frame, agentId) !== null;
}

function agentRegion(frame: PresentedObserverFrame, agentId: string): string | null {
  const position = agentValue(frame, agentId)?.position;
  return typeof position === "string" && position.trim().length > 0 ? position : null;
}

function agentValue(frame: PresentedObserverFrame, agentId: string): Readonly<Partial<AgentSnapshot>> | null {
  const record = frame.world.agents.find((candidate) => candidate.value.id === agentId);
  return record?.value ?? null;
}

interface ResolvedRoute {
  readonly status: "reached" | "fallback" | "unauthorized";
  readonly waypoints: readonly Readonly<{ x: number; y: number }>[];
  readonly facing: Direction4 | null;
  readonly code: string;
  readonly detail: string;
}

function resolveMovementRoute<T extends "agent_left_region" | "agent_entered_region">(
  context: ChoreographyContext<T>,
  actorId: string,
  fromRegion: string,
  toRegion: string,
  entered: boolean,
): ResolvedRoute {
  const recipe = context.recipes.get(entered ? toRegion : fromRegion);
  if (recipe === undefined) return fallbackRoute("region-recipe-missing", "presented region fields cannot reconstruct the Task 6 recipe");
  const gate = recipe.gates.find((candidate) => (
    candidate.edge.from === fromRegion
    && candidate.edge.to === toRegion
    && candidate.role === (entered ? "arrival" : "departure")
  ));
  if (gate === undefined) return { status: "unauthorized", waypoints: [], facing: null, code: "unauthorized-directed-edge", detail: "the requested directed edge has no matching gate" };

  const placement = context.placement.agents.get(actorId);
  let start: TileCoord;
  let goal: TileCoord;
  let exactStart: Readonly<{ x: number; y: number }> | undefined;
  let exactGoal: Readonly<{ x: number; y: number }> | undefined;
  if (entered) {
    start = gate.tile;
    if (placement?.regionId === toRegion) exactGoal = placement.point;
    else exactGoal = selectDeferredArrivalStagingPoint(
      recipe.stagingPoints,
      tileCenter(gate.tile),
      actorId,
      fromRegion,
    );
    goal = pointTile(exactGoal);
  } else {
    if (placement?.regionId !== fromRegion) return fallbackRoute("actor-placement-missing", "departure actor has no retained origin placement");
    exactStart = placement.point;
    start = pointTile(exactStart);
    goal = gate.tile;
  }
  const result = findNavigationPath(recipe.grid, { start, goal });
  if (result.status !== "reached") {
    return fallbackRoute(result.diagnostic?.code ?? "directed-path-unreachable", "the exact gate route is unavailable; no alternate connector is granted", result.waypoints);
  }
  const waypoints = connectNavigationEndpoints(recipe.grid, result, { start: exactStart, goal: exactGoal });
  if (waypoints === null) {
    return fallbackRoute("directed-endpoint-cell-mismatch", "the exact feet endpoint does not belong to the reached navigation cell", result.waypoints);
  }
  return {
    status: "reached",
    waypoints,
    facing: entered ? facingForRoute(waypoints, gate.facing) : gate.facing,
    code: "legal-directed-path",
    detail: "exact gate route reached",
  };
}

/**
 * Maximum count of gate-nearest staging points considered for a deferred arrival goal.
 *
 * The choreographed arrival walk is provisional -- the consequence placement
 * generation (`PlacementLedger.arrivalPlacement`) owns the agent's real, final,
 * occupancy-aware position once the event actually commits. Bounding the candidate
 * pool to the handful of staging points nearest the arrival gate keeps this
 * provisional walk's distance (and therefore its `routeAwareTiming`-derived scene
 * duration) proportional to a normal local walk, regardless of how large or
 * procedurally grown the destination region's staging-point set is (e.g. Nirvana's
 * population-pressure-driven district growth). Picking the single nearest point
 * unconditionally would remove the actor-id variety a hash gives across arrivals at
 * the same gate; keeping a small nearby pool retains that variety while still
 * bounding worst-case walk distance.
 */
const DEFERRED_ARRIVAL_STAGING_CANDIDATES = 8;

/**
 * Choose a bounded-distance, deterministic provisional arrival goal near a gate.
 *
 * Ranks every staging point by straight-line distance to the arrival gate's tile
 * center, keeps the nearest `DEFERRED_ARRIVAL_STAGING_CANDIDATES` (or all of them,
 * if fewer exist), and selects among that nearby pool with the same
 * actor/from-region hash previously used to select from the entire region. This is
 * the fix for the arrival-placement-deferred settlement stall: selecting from the
 * *entire* region's staging points (some of which can be far across a large or
 * grown region such as Nirvana) produced route lengths whose
 * `certifiedProductionRouteBudgetMs`-derived scene duration could reach tens of
 * seconds of real time, because the "consequence" phase (and the safe-cancel/settle
 * markers that follow it) is stretched to cover the full walk. Bounding the
 * candidate pool by distance bounds that duration without touching the settlement
 * handshake itself.
 */
function selectDeferredArrivalStagingPoint(
  stagingPoints: readonly Readonly<{ x: number; y: number }>[],
  gateCenter: Readonly<{ x: number; y: number }>,
  actorId: string,
  fromRegion: string,
): Readonly<{ x: number; y: number }> {
  const ranked = stagingPoints
    .map((point, index) => ({
      point,
      index,
      distance: Math.hypot(point.x - gateCenter.x, point.y - gateCenter.y),
    }))
    .sort((left, right) => left.distance - right.distance || left.index - right.index);
  // An arrival is the one walk the distance gate may not cut — a being must be
  // seen entering the region it entered — so it is bounded HERE instead, at the
  // only place that can bound it without breaking that: by preferring goals
  // that are a walk away in the first place. Measured before this: two arrivals
  // in a real run leased the stage for ~45 seconds each, because the nearest
  // eight staging points at a Nirvana gate can all still be most of a region
  // away. Variety is preserved wherever more than one goal qualifies, and the
  // old nearest-eight behaviour is the fallback when none does.
  const walkable = ranked.filter(({ distance }) => distance <= WALK_MAX_DISTANCE_PX);
  const pool = walkable.length > 0 ? walkable : ranked;
  const nearby = pool.slice(0, Math.min(DEFERRED_ARRIVAL_STAGING_CANDIDATES, pool.length));
  const selected = nearby[stableHash(`${actorId}:arrival:${fromRegion}`) % nearby.length]!;
  return selected.point;
}

function resolveResourceRoute(
  context: Pick<ChoreographyContext<FamilyEventType>, "placement" | "recipes" | "compactResourceRouting">,
  actorId: string,
  regionId: string,
  resourceType: "energy" | "materials",
): ResolvedRoute {
  const recipe = context.recipes.get(regionId);
  if (recipe === undefined) return fallbackRoute("region-recipe-missing", "presented region fields cannot reconstruct the Task 6 recipe");
  const placement = context.placement.agents.get(actorId);
  if (placement?.regionId !== regionId) return fallbackRoute("actor-placement-missing", "resource actor has no retained placement in the event region");
  const anchors = recipe.resourceAnchors[resourceType];
  const goal = context.compactResourceRouting
    ? nearestResourceAnchor(anchors, placement.point)
    : anchors[stableHash(`${actorId}:${resourceType}`) % anchors.length]!;
  const result = findNavigationPath(recipe.grid, { start: pointTile(placement.point), goal });
  if (result.status !== "reached") {
    return fallbackRoute(result.diagnostic?.code ?? "resource-path-unreachable", "matching resource patch is not legally reachable", result.waypoints);
  }
  const waypoints = connectNavigationEndpoints(recipe.grid, result, { start: placement.point });
  if (waypoints === null) {
    return fallbackRoute("resource-endpoint-cell-mismatch", "the exact feet origin does not belong to the reached navigation cell", result.waypoints);
  }
  return {
    status: "reached",
    waypoints,
    facing: facingForRoute(waypoints, "south"),
    code: "legal-resource-path",
    detail: "matching resource patch reached",
  };
}

function pointTile(point: Readonly<{ x: number; y: number }>): TileCoord {
  return { column: Math.floor(point.x / TILE_SIZE), row: Math.floor(point.y / TILE_SIZE) };
}

/**
 * QA-only: pick whichever of a region's EXISTING resource anchors sits nearest
 * a point, instead of the canonical actor+resource-type hash pick.
 *
 * Only used when `ChoreographyContext.compactResourceRouting` is set (see that
 * field's own doc comment). `anchors` is never bounded by district the way
 * `district.stagingPoints`/`shelterPlots` are for agent/home placement --
 * `resourceAnchors[resourceType]` has one entry per district, not just the
 * actor's own, so the canonical hash pick can legitimately land on the far
 * side of a large region (this is the root cause behind
 * `.superpowers/sdd/c19-staging-report.md`'s reported 20-55s harvest walks).
 * Choosing the nearest EXISTING entry keeps the walk a real, fully-animated,
 * obstacle-respecting navigated route to a real (already scenically dressed)
 * resource patch -- it never invents a new anchor position.
 */
function nearestResourceAnchor(anchors: readonly TileCoord[], point: Vec2): TileCoord {
  return anchors.reduce((best, candidate) => (
    distanceToTileCenter(point, candidate) < distanceToTileCenter(point, best) ? candidate : best
  ));
}

function distanceToTileCenter(point: Vec2, tile: TileCoord): number {
  const center = tileCenter(tile);
  return Math.hypot(point.x - center.x, point.y - center.y);
}

function fallbackRoute(code: string, detail: string, waypoints: readonly Readonly<{ x: number; y: number }>[] = []): ResolvedRoute {
  return { status: "fallback", waypoints: waypoints.map(clonePoint), facing: null, code, detail };
}

function facingForRoute(
  waypoints: readonly Readonly<{ x: number; y: number }>[],
  fallback: Direction4,
): Direction4 {
  for (let index = waypoints.length - 1; index > 0; index -= 1) {
    const current = waypoints[index]!;
    const previous = waypoints[index - 1]!;
    const dx = current.x - previous.x;
    const dy = current.y - previous.y;
    if (Math.abs(dx) > Math.abs(dy) && dx !== 0) return dx > 0 ? "east" : "west";
    if (dy !== 0) return dy > 0 ? "south" : "north";
  }
  return fallback;
}

function parsePriorEvidence<T extends FamilyEventType>(
  context: ChoreographyContext<T>,
): TypedPresentedEvent | null {
  const prior = context.moment.evidence.find((entry) => entry.cursor < context.moment.representative.cursor);
  if (prior === undefined) return null;
  const parsed = parsePresentedEvent(prior);
  return parsed.known ? parsed.evidence : null;
}

function matchingPriorAttack(
  context: ChoreographyContext<"agent_paralyzed">,
  attackerId: string | null,
  victimId: string,
): PresentedPayloadByType["attack"] | null {
  const prior = parsePriorEvidence(context);
  if (
    prior?.type !== "attack"
    || attackerId === null
    || prior.payload.attacker_id !== attackerId
    || prior.payload.victim_id !== victimId
  ) return null;
  return prior.payload;
}

function resolveContactRoute<T extends FamilyEventType>(
  context: ChoreographyContext<T>,
  moverId: string,
  targetId: string,
  regionId: string,
): ResolvedRoute {
  const recipe = context.recipes.get(regionId);
  const mover = context.placement.agents.get(moverId);
  const target = context.placement.agents.get(targetId);
  if (recipe === undefined || mover?.regionId !== regionId || target?.regionId !== regionId) {
    return fallbackRoute("contact-placement-missing", "contact route requires both presented placements in the event region");
  }
  // Goal selection and legality are delegated to the shared resolver so this
  // family asks the renderer's own apply-time question -- home footprints
  // included -- before authoring the walk. A route that only cleared the
  // collision grid was being silently dropped by `presentationRouteIsClear`
  // whenever the other party stood at a home's door, which is why the giver
  // reached for someone fifteen tiles away. See interactionContact.ts.
  const route = resolveLegalContactRoute(
    mover.point,
    target.point,
    recipe,
    homeExclusionsForRegion(context.placement, context.recipes, regionId),
  );
  if (route.status !== "reached" || route.contactPoint === null) {
    return fallbackRoute("contact-path-unreachable", route.detail);
  }
  return {
    status: "reached",
    waypoints: route.waypoints,
    facing: facingToward(pointTile(route.contactPoint), pointTile(target.point)),
    code: "legal-contact-path",
    detail: route.detail,
  };
}

function facingToward(from: TileCoord, to: TileCoord): Direction4 {
  if (to.column > from.column) return "east";
  if (to.column < from.column) return "west";
  if (to.row > from.row) return "south";
  return "north";
}

function withinPhysicalHandoffRange<T extends FamilyEventType>(
  context: ChoreographyContext<T>,
  leftId: string,
  rightId: string,
  requiredRegion: string,
): boolean {
  const leftRegion = agentRegion(context.frame, leftId);
  const rightRegion = agentRegion(context.frame, rightId);
  const left = context.placement.agents.get(leftId);
  const right = context.placement.agents.get(rightId);
  if (
    leftRegion !== requiredRegion
    || rightRegion !== requiredRegion
    || left?.regionId !== requiredRegion
    || right?.regionId !== requiredRegion
  ) return false;
  const separation = Math.hypot(right.point.x - left.point.x, right.point.y - left.point.y);
  // INTERACTION_CONTACT_TOLERANCE_PX (1.5 tiles) rather than exactly one tile:
  // a pair left DIAGONALLY adjacent by a previous beat sits 45.3px apart and
  // is plainly already in an interaction -- making them shuffle sideways to
  // square up reads as a twitch, not as an approach. See the constant's own
  // note for why conversation, combat and a handover all share one distance.
  return Number.isFinite(separation) && separation <= INTERACTION_CONTACT_TOLERANCE_PX;
}

function coLocated(
  frame: PresentedObserverFrame,
  leftId: string,
  rightId: string,
  requiredRegion: string,
): boolean {
  const left = agentRegion(frame, leftId);
  const right = agentRegion(frame, rightId);
  return left === requiredRegion && right === requiredRegion;
}

function transferDialogueText(
  frame: PresentedObserverFrame,
  payload: PresentedPayloadByType["resource_transferred"],
): string {
  const senderName = publicAgentName(frame, payload.sender_id);
  const receiverName = publicAgentName(frame, payload.receiver_id);
  const resource = payload.resource_type === "materials" && payload.amount === 1
    ? "material"
    : payload.resource_type;
  return `${senderName} gave ${payload.amount} ${resource} to ${receiverName}.`;
}

function publicAgentName(frame: PresentedObserverFrame, agentId: string): string {
  const name = agentValue(frame, agentId)?.name;
  return typeof name === "string" && name.trim().length > 0 ? name : agentId;
}

function visibleDialogue(
  frame: PresentedObserverFrame,
  speakerId: string,
  text: string,
  cursor: number,
): DialogueState {
  const name = agentValue(frame, speakerId)?.name;
  return {
    speakerId,
    speakerName: typeof name === "string" && name.trim().length > 0 ? name : speakerId,
    text,
    visibleCharacters: text.length,
    cursor,
    hold: true,
  };
}

function speechDuration(message: string): number {
  return Math.min(14_000, Math.max(3_000, 3_000 + message.length * 80));
}

/** A compact "+N energy, +M materials" label for a FLYING ITEM loot payout, omitting either side that's zero. */
function lootLabel(energy: number, materials: number): string {
  const parts: string[] = [];
  if (energy > 0) parts.push(`+${energy}e`);
  if (materials > 0) parts.push(`+${materials}m`);
  return parts.length > 0 ? parts.join(" ") : "+0";
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

// Compile-time closure: adding a family type without a definition must fail here.
const _familyClosure: readonly FamilyEventType[] = LIFECYCLE_MOVEMENT_COMMUNICATION_RESOURCE_DEFINITIONS.map(
  (value) => value.eventType,
);
void _familyClosure;
