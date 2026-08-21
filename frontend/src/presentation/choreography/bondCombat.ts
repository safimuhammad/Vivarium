import type { AgentSnapshot } from "../../app/schemas";
import { TILE_SIZE, type TileCoord } from "../../renderer2d/map/regionMap";
import { decideParticipantFallback } from "../../renderer2d/production/failurePolicy";
import type {
  ActorVisualIntent,
  Direction4,
  EffectVisualIntent,
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
import { homeExclusionsForRegion, resolveLegalContactRoute } from "./interactionContact";
import { gateLocomotion } from "./locomotionGate";

const FAMILY_EVENT_TYPES = Object.freeze([
  "mating_initiated",
  "mating_rejected",
  "mating_proposal_invalidated",
  "mating_proposal_timeout",
  "attack",
] as const);

type FamilyEventType = (typeof FAMILY_EVENT_TYPES)[number];
type BondEventType = Exclude<FamilyEventType, "attack">;
type StoryPhase = PresentedSceneView["phase"];
type Point = Readonly<{ x: number; y: number }>;

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
  diagnostic: "physical staging is omitted unless the current presented frame proves every participant",
});

interface PhaseContent {
  readonly actorIntents?: readonly ActorVisualIntent[];
  readonly effectIntents?: readonly EffectVisualIntent[];
  readonly focus?: StoryFocus;
}

interface AdditionalMarker {
  readonly name: string;
  readonly atMs: number;
  readonly order: number;
  readonly role: "optional-effect";
  readonly optional: true;
}

interface PlanInput<T extends FamilyEventType> {
  readonly context: ChoreographyContext<T>;
  readonly eventType: T;
  readonly regionId: string | null;
  readonly participants: readonly ResolvedParticipant[];
  readonly diagnostics: readonly ChoreographyDiagnostic[];
  readonly durationMs: number;
  readonly contactSuffix: string;
  readonly consequenceSuffix: string;
  readonly phaseContent: Readonly<Partial<Record<StoryPhase, PhaseContent>>>;
  readonly additionalMarkers?: readonly AdditionalMarker[];
  readonly timeline?: Readonly<{
    readonly contactAtMs: number;
    readonly consequenceAtMs: number;
    readonly safeAtMs: number;
  }>;
}

interface PairGeography {
  readonly sourcePresent: boolean;
  readonly targetPresent: boolean;
  readonly sourceRegion: string | null;
  readonly targetRegion: string | null;
  readonly coLocated: boolean;
}

interface ResolvedRoute {
  readonly status: "reached" | "fallback";
  readonly waypoints: readonly Point[];
  readonly facing: Direction4 | null;
  readonly detail: string;
}

/** Bond and combat choreography definitions in canonical family order. */
export const BOND_COMBAT_DEFINITIONS = Object.freeze([
  matingInitiatedDefinition(),
  matingRejectedDefinition(),
  matingInvalidatedDefinition(),
  matingTimeoutDefinition(),
  attackDefinition(),
] as const);

function matingInitiatedDefinition(): ChoreographyDefinition<"mating_initiated"> {
  return definition({
    eventType: "mating_initiated",
    participants: ["initiator", "target"],
    requiredAnchors: ["current-position", "social", "atlas"],
    contactMarker: "proposal-contact",
    consequenceMarker: "proposal-commit",
    duration: { minMs: 2_800, maxMs: CONTACT_ROUTE_MAX_MS },
    resolve: (context) => {
      const { initiator_id: initiatorId, target_id: targetId } = context.event.payload;
      const geography = pairGeography(context.frame, initiatorId, targetId);
      const initiatorPoint = context.placement.agents.get(initiatorId)?.point ?? null;
      const targetPoint = context.placement.agents.get(targetId)?.point ?? null;
      const route = geography.coLocated
        ? resolveContactRoute(context, initiatorId, targetId, geography.sourceRegion)
        : fallbackRoute("presented geography does not prove co-location");
      const physicalTiming = geography.coLocated
        && initiatorPoint !== null
        && targetPoint !== null
        && route.status === "reached"
        ? physicalRouteTiming(route, {
            contactAtMs: 3_150,
            consequenceAtMs: 3_550,
            safeAtMs: 3_850,
            minimumDurationMs: 5_000,
            // 8_000 was too tight for realistic staged-agent separations: the
            // round-trip budget (outbound contact window + a second full-length
            // reversed-route budget for the return, padded by /0.98) exceeds 8s
            // for any pair much beyond a couple of tiles apart, so even a
            // genuinely co-located, on-screen, ~5-tile-apart pair (as
            // `PlacementLedger.stagingPlacement` routinely produces -- staging
            // anchors are hashed >=71px apart, per G1's identical F2 finding for
            // resource_transferred) silently fell back to `physical: false` and
            // rendered the "remote portrait" placeholder directly on the
            // participant's own body instead of the intended walk-and-propose
            // scene. Raised to the shared CONTACT_ROUTE_MAX_MS ceiling (see its
            // doc comment for the full failure-mode history), matching the same
            // ceiling G1 already proved safe for resource_transferred's
            // analogous "close enough for a physical scene" gate
            // (duration.maxMs 4_000 -> 120_000).
            maximumDurationMs: CONTACT_ROUTE_MAX_MS,
          })
        : null;
      const physical = physicalTiming !== null;
      const contactPoint = physical ? route.waypoints.at(-1) ?? null : null;
      const remoteEffects = physical && !context.reducedMotion
        ? []
        : pairMotif(initiatorId, targetId, geography);
      return plan({
        context,
        eventType: "mating_initiated",
        regionId: geography.sourceRegion,
        participants: participants([
          ["initiator", [initiatorId]],
          ["target", [targetId]],
        ]),
        diagnostics: [
          ...pairDiagnostics(geography, "initiator", "target"),
          ...(physical ? [] : [diagnostic(
            "proposal-remote-no-teleport",
            "target",
            `proposal uses an evidence-bound portrait/atlas motif because no legal contact route is available: ${route.detail}`,
          )]),
          diagnostic(
            "proposal-no-pair-bond",
            null,
            "the proposal consequence reflects escrow evidence only and creates no relationship or acceptance state",
          ),
        ],
        durationMs: context.reducedMotion
          ? 2_800
          : physical ? physicalTiming.durationMs : 4_000,
        contactSuffix: "proposal-contact",
        consequenceSuffix: "proposal-commit",
        timeline: context.reducedMotion
          ? { contactAtMs: 900, consequenceAtMs: 1_200, safeAtMs: 1_500 }
          : physical
            ? physicalTiming
            : undefined,
        phaseContent: {
          enter: {
            // RECIPROCITY: the target turns toward where the initiator will
            // actually END UP, not the staging anchor it is walking away from,
            // so the two are facing each other by the time the proposal fires.
            actorIntents: physical
              ? [
                  actor(initiatorId, "orient", null, targetPoint, undefined, route.facing ?? undefined),
                  actor(targetId, "orient", null, contactPoint ?? initiatorPoint, undefined, oppositeFacing(route.facing)),
                  ...(!context.reducedMotion && contactPoint !== null
                    ? [moveActor(initiatorId, route)]
                    : []),
                ]
              : [],
          },
          hold: {
            actorIntents: physical && !context.reducedMotion
              ? [actor(initiatorId, "reach", "proposal-contact", targetPoint, undefined, route.facing ?? undefined)]
              : [],
            effectIntents: remoteEffects,
          },
          consequence: {
            actorIntents: physical
              ? [
                  actor(initiatorId, "idle", "proposal-commit", contactPoint, undefined, route.facing ?? undefined),
                  actor(targetId, "idle", null, targetPoint, undefined, oppositeFacing(route.facing)),
                ]
              : [],
            // OFFER TOKEN: a proposal standing between the two beings, distinct
            // from the generic combat/loot ember arc it previously reused (a
            // proposal, a punch, and a stolen-materials payout used to look
            // identical). "forming" grows -- see matingRejectedDefinition and
            // refundOnlyDefinition for the "breaking" counterpart.
            effectIntents: [{ kind: "bond-token", sourceId: initiatorId, targetId, tokenState: "forming" }],
          },
          // NO RETURN LEG. The initiator walked here to say something; he
          // stays. Marching him back to his staging anchor started 300ms after
          // contact and ran for the whole rest of the scene, while the bond
          // token -- which lives 2.6-6.0s -- was still on screen: the beat was
          // read almost entirely during the retreat, and the beat director,
          // correctly framing both live chrome anchors, had to zoom out to
          // hold a widening gap. Staying also means the NEXT beat between
          // these two starts already in contact.
          recover: {
            actorIntents: physical
              ? [
                  actor(initiatorId, "idle", null, contactPoint ?? initiatorPoint, undefined, route.facing ?? undefined),
                  actor(targetId, "idle", null, targetPoint, undefined, oppositeFacing(route.facing)),
                ]
              : [],
          },
          exit: {
            actorIntents: physical
              ? [
                  actor(initiatorId, "orient", null, targetPoint, undefined, route.facing ?? undefined),
                  actor(targetId, "idle", null, targetPoint, undefined, oppositeFacing(route.facing)),
                ]
              : [],
          },
        },
      });
    },
  });
}

function matingRejectedDefinition(): ChoreographyDefinition<"mating_rejected"> {
  return definition({
    eventType: "mating_rejected",
    participants: ["actor", "initiator"],
    requiredAnchors: ["current-position", "social", "atlas"],
    contactMarker: "reject-visible",
    consequenceMarker: "reject-commit",
    duration: { minMs: 2_200, maxMs: CONTACT_ROUTE_MAX_MS },
    resolve: (context) => {
      const { rejecter_id: rejecterId, initiator_id: initiatorId } = context.event.payload;
      const geography = pairGeography(context.frame, rejecterId, initiatorId);
      const rejecterPoint = context.placement.agents.get(rejecterId)?.point ?? null;
      const initiatorPoint = context.placement.agents.get(initiatorId)?.point ?? null;
      const route = geography.coLocated
        ? resolveContactRoute(context, rejecterId, initiatorId, geography.sourceRegion)
        : fallbackRoute("presented geography does not prove co-location");
      const physicalTiming = geography.coLocated
        && rejecterPoint !== null
        && initiatorPoint !== null
        && route.status === "reached"
        ? physicalRouteTiming(route, {
            contactAtMs: 3_150,
            consequenceAtMs: 3_550,
            safeAtMs: 3_750,
            minimumDurationMs: 4_000,
            // See matingInitiatedDefinition's identical comment: 8_000 was too
            // tight for realistic staged-agent separations and silently forced
            // co-located, on-screen rejection pairs into the "remote portrait"
            // fallback. Raised to the shared CONTACT_ROUTE_MAX_MS ceiling,
            // matching G1's F2 precedent (resource_transferred).
            maximumDurationMs: CONTACT_ROUTE_MAX_MS,
          })
        : null;
      const physical = physicalTiming !== null;
      const contactPoint = physical ? route.waypoints.at(-1) ?? null : null;
      return plan({
        context,
        eventType: "mating_rejected",
        regionId: geography.sourceRegion,
        participants: participants([
          ["actor", [rejecterId]],
          ["initiator", [initiatorId]],
        ]),
        diagnostics: [
          ...pairDiagnostics(geography, "actor", "initiator"),
          ...(physical ? [] : [diagnostic(
            "rejection-remote-no-teleport",
            "initiator",
            `rejection is delivered with portraits and atlas geography instead of an unavailable legal contact route: ${route.detail}`,
          )]),
          refundDiagnostic(),
        ],
        durationMs: context.reducedMotion
          ? 2_200
          : physical ? physicalTiming.durationMs : 3_200,
        contactSuffix: "reject-visible",
        consequenceSuffix: "reject-commit",
        timeline: context.reducedMotion
          ? { contactAtMs: 750, consequenceAtMs: 1_000, safeAtMs: 1_250 }
          : physical
            ? physicalTiming
            : undefined,
        phaseContent: {
          enter: {
            // RECIPROCITY: the initiator faces where the rejecter will end up.
            actorIntents: physical
              ? [
                  actor(rejecterId, "orient", null, initiatorPoint, undefined, route.facing ?? undefined),
                  actor(initiatorId, "orient", null, contactPoint ?? rejecterPoint, undefined, oppositeFacing(route.facing)),
                  ...(!context.reducedMotion ? [moveActor(rejecterId, route)] : []),
                ]
              : [],
          },
          hold: {
            actorIntents: physical && !context.reducedMotion
              ? [actor(rejecterId, "reach", "reject-visible", initiatorPoint, undefined, route.facing ?? undefined)]
              : [],
            effectIntents: physical && !context.reducedMotion
              ? []
              : pairMotif(rejecterId, initiatorId, geography),
          },
          consequence: {
            actorIntents: physical
              ? [
                  actor(rejecterId, "idle", "reject-commit", contactPoint, undefined, route.facing ?? undefined),
                  actor(initiatorId, "idle", null, initiatorPoint, undefined, oppositeFacing(route.facing)),
                ]
              : [],
            // OFFER TOKEN "breaking": the same token shrinks apart rather than
            // growing, so a rejection reads as visually distinct from a
            // proposal forming (matingInitiatedDefinition).
            effectIntents: [{ kind: "bond-token", sourceId: rejecterId, targetId: initiatorId, tokenState: "breaking" }],
          },
          // NO RETURN LEG -- see matingInitiatedDefinition's note.
          recover: { actorIntents: physical ? [
            actor(rejecterId, "idle", null, contactPoint ?? rejecterPoint, undefined, route.facing ?? undefined),
            actor(initiatorId, "idle", null, initiatorPoint, undefined, oppositeFacing(route.facing)),
          ] : [] },
          exit: { actorIntents: physical ? [
            actor(rejecterId, "orient", null, initiatorPoint, undefined, route.facing ?? undefined),
            actor(initiatorId, "idle", null, initiatorPoint, undefined, oppositeFacing(route.facing)),
          ] : [] },
        },
      });
    },
  });
}

function matingInvalidatedDefinition(): ChoreographyDefinition<"mating_proposal_invalidated"> {
  return refundOnlyDefinition(
    "mating_proposal_invalidated",
    "invalidation-visible",
    "invalidation-commit",
    "proposal was invalidated because the initiator became ineligible; no target response is authored",
  );
}

function matingTimeoutDefinition(): ChoreographyDefinition<"mating_proposal_timeout"> {
  return refundOnlyDefinition(
    "mating_proposal_timeout",
    "timeout-visible",
    "timeout-commit",
    "proposal timed out; the token motif fades without physical delivery or a target response",
  );
}

function refundOnlyDefinition<T extends "mating_proposal_invalidated" | "mating_proposal_timeout">(
  eventType: T,
  contactMarker: string,
  consequenceMarker: string,
  truthfulDetail: string,
): ChoreographyDefinition<T> {
  return definition({
    eventType,
    participants: ["initiator", "target"],
    requiredAnchors: ["current-position", "atlas"],
    contactMarker,
    consequenceMarker,
    duration: { minMs: 2_000, maxMs: 3_600 },
    resolve: (context) => {
      const { initiator_id: initiatorId, target_id: targetId } = (
        context.event as unknown as Readonly<{
          payload: Readonly<{ initiator_id: string; target_id: string }>;
        }>
      ).payload;
      const geography = pairGeography(context.frame, initiatorId, targetId);
      const initiatorPoint = context.placement.agents.get(initiatorId)?.point ?? null;
      return plan({
        context,
        eventType,
        regionId: geography.sourceRegion,
        participants: participants([
          ["initiator", [initiatorId]],
          ["target", [targetId]],
        ]),
        diagnostics: [
          ...pairDiagnostics(geography, "initiator", "target"),
          diagnostic(`${eventType}-initiator-only`, "target", truthfulDetail),
          refundDiagnostic(),
        ],
        durationMs: context.reducedMotion ? 2_000 : 2_800,
        contactSuffix: contactMarker,
        consequenceSuffix: consequenceMarker,
        phaseContent: {
          enter: {
            actorIntents: geography.sourcePresent
              ? [actor(initiatorId, "orient", null, initiatorPoint)]
              : [],
          },
          hold: {
            actorIntents: geography.sourcePresent
              ? [actor(initiatorId, "idle", "weary-token-fade", initiatorPoint)]
              : [],
            effectIntents: pairMotif(initiatorId, targetId, geography),
          },
          consequence: {
            actorIntents: geography.sourcePresent
              ? [actor(initiatorId, "idle", consequenceMarker, initiatorPoint)]
              : [],
            // refundOnlyDefinition backs both mating_proposal_invalidated and
            // mating_proposal_timeout -- both are the same "the bond attempt is
            // fading" beat, so both get the OFFER TOKEN's "breaking" (shrinking)
            // state rather than the combat/loot ember.
            effectIntents: [{ kind: "bond-token", sourceId: initiatorId, targetId, tokenState: "breaking" }],
          },
          recover: {
            actorIntents: geography.sourcePresent ? [actor(initiatorId, "idle", null, initiatorPoint)] : [],
          },
          exit: {
            actorIntents: geography.sourcePresent ? [actor(initiatorId, "idle", null, initiatorPoint)] : [],
          },
        },
      });
    },
  });
}

function attackDefinition(): ChoreographyDefinition<"attack"> {
  return definition({
    eventType: "attack",
    participants: ["killer", "victim"],
    requiredAnchors: ["current-position", "social"],
    contactMarker: "hit-contact",
    consequenceMarker: "attack-commit",
    duration: { minMs: 2_400, maxMs: CONTACT_ROUTE_MAX_MS },
    resolve: (context) => {
      if (
        context.moment.chainKind !== "single"
        || context.moment.representative.cursor !== context.event.entry.cursor
        || context.moment.representative.event.type !== "attack"
      ) {
        throw new Error("attack choreography resolves only a standalone attack representative");
      }
      const { attacker_id: attackerId, victim_id: victimId, region, damage, attack_energy_cost: attackEnergyCost } = context.event.payload;
      const geography = pairGeography(context.frame, attackerId, victimId, region);
      const attackerPoint = context.placement.agents.get(attackerId)?.point ?? null;
      const victimPoint = context.placement.agents.get(victimId)?.point ?? null;
      const route = geography.coLocated
        ? resolveContactRoute(context, attackerId, victimId, region)
        : fallbackRoute("presented geography does not prove co-location");
      const physicalTiming = geography.coLocated
        && attackerPoint !== null
        && victimPoint !== null
        && route.status === "reached"
        ? physicalRouteTiming(route, {
            contactAtMs: 3_150,
            consequenceAtMs: 3_550,
            safeAtMs: 3_750,
            minimumDurationMs: 4_200,
            // `attackDefinition` shares the byte-identical physicalRouteTiming
            // call shape as the two mating definitions above and was flagged
            // (mating-box-fix-report.md, "Other consumers of the same broken
            // mechanism") as having the same latent susceptibility to the
            // identical bug: an attacker/victim pair staged far enough apart
            // (PlacementLedger.stagingPlacement routinely produces >=71px, often
            // 160px+ separations) would silently fall back to `physical: false`
            // and render the body-anchored "remote portrait" placeholder on a
            // genuinely co-located, on-screen victim during a combat beat. Fixed
            // here by adopting the same CONTACT_ROUTE_MAX_MS ceiling already
            // proven safe for resource_transferred (G1 F2) and the two mating
            // definitions (mating-box-fix).
            maximumDurationMs: CONTACT_ROUTE_MAX_MS,
          })
        : null;
      const physical = physicalTiming !== null;
      const contactPoint = physical ? route.waypoints.at(-1) ?? null : null;
      const knockbackPoint = physical && victimPoint !== null && !context.reducedMotion
        ? legalTransientKnockback(context, region, victimPoint, route.waypoints.at(-1)!, 6)
        : null;
      const durationMs = context.reducedMotion
        ? 2_400
        : physical ? physicalTiming.durationMs : 3_600;
      const timeline = markerTimeline(durationMs, context.reducedMotion
        ? { contactAtMs: 800, consequenceAtMs: 1_050, safeAtMs: 1_300 }
        : physical
          ? physicalTiming
          : undefined);
      const hitStopEnd = timeline.contactAt + 80;
      const victimReaction = physical
        ? actor(
            victimId,
            "hurt",
            "hit-contact",
            context.reducedMotion ? null : knockbackPoint,
          )
        : null;
      const returnIntent = victimPoint === null
        ? null
        : actor(victimId, "recover", null, victimPoint, undefined, oppositeFacing(route.facing));
      return plan({
        context,
        eventType: "attack",
        regionId: region,
        participants: participants([
          ["killer", [attackerId]],
          ["victim", [victimId]],
        ]),
        diagnostics: [
          ...pairDiagnostics(geography, "killer", "victim"),
          ...(physical ? [] : [diagnostic(
            "attack-contact-fallback",
            "victim",
            `attack remains evidence-visible but creates no physical contact without a legal injected-recipe route: ${route.detail}`,
          )]),
          ...(physical && !context.reducedMotion && knockbackPoint === null ? [diagnostic(
            "knockback-omitted",
            "victim",
            "the transient offset was omitted because its 4-8 px endpoint was not collision-open",
          )] : []),
          ...(context.reducedMotion ? [diagnostic(
            "reduced-motion-hit-stop-omitted",
            null,
            "reduced motion preserves the hit and durable endpoints while omitting lunge, impulse, hit-stop, and knockback flourish",
          )] : []),
          diagnostic(
            "attack-nonlethal",
            "victim",
            "standalone attack never authors death; lethal death remains standalone lifecycle evidence",
          ),
        ],
        durationMs,
        contactSuffix: "hit-contact",
        consequenceSuffix: "attack-commit",
        timeline: context.reducedMotion
          ? { contactAtMs: 800, consequenceAtMs: 1_050, safeAtMs: 1_300 }
          : physical
            ? physicalTiming
            : undefined,
        additionalMarkers: [{
          name: "hit-stop-end",
          atMs: hitStopEnd,
          order: 0,
          role: "optional-effect",
          optional: true,
        }],
        phaseContent: {
          enter: {
            // RECIPROCITY: the victim turns toward the tile the attacker is
            // arriving on, not the anchor he is leaving -- so the strike lands
            // between two beings who are facing each other.
            actorIntents: physical
              ? [
                  actor(attackerId, "orient", null, victimPoint, undefined, route.facing ?? undefined),
                  actor(victimId, "orient", null, contactPoint ?? attackerPoint, undefined, oppositeFacing(route.facing)),
                  ...(!context.reducedMotion
                    ? [moveActor(attackerId, route)]
                    : []),
                ]
              : geography.sourcePresent ? [actor(attackerId, "orient")] : [],
          },
          hold: {
            actorIntents: physical
              ? [
                  ...(!context.reducedMotion ? [actor(attackerId, "reach", "hit-contact", victimPoint)] : []),
                  ...(victimReaction === null ? [] : [victimReaction]),
                ]
              : [],
            // IMPACT: supersedes the generic combat/loot ember arc, which
            // carried no actual number -- the owner's own complaint ("attacks
            // have no impact") named this exact gap. Two floating numbers:
            // damage rising off the victim, cost rising off the attacker who
            // paid it, both landing at contact regardless of whether the
            // approach itself resolved to a physical route.
            effectIntents: [
              { kind: "impact", sourceId: victimId, targetId: attackerId, polarity: "damage", label: `-${damage}` },
              { kind: "impact", sourceId: attackerId, targetId: victimId, polarity: "cost", label: `-${attackEnergyCost}` },
              ...(physical && !context.reducedMotion ? [effect("camera-impulse", "attack:1px", victimId)] : []),
              ...(physical ? [] : [effect("portrait", attackerId, victimId)]),
            ],
          },
          consequence: {
            actorIntents: [
              ...(geography.sourcePresent ? [actor(
                attackerId,
                "idle",
                "attack-commit",
                contactPoint ?? attackerPoint,
                undefined,
                route.facing ?? undefined,
              )] : []),
            ],
          },
          // NO RETURN LEG. The attacker stands over the being he struck. The
          // old recover-phase walk home began 400ms after contact and ran for
          // the whole remaining scene, so the damage number, the strike mark
          // and the impact burst -- all of which live 2.6-6.0s -- were read
          // almost entirely while the two were separating.
          recover: {
            actorIntents: [
              ...(geography.sourcePresent
                ? [actor(attackerId, "idle", null, contactPoint ?? attackerPoint, undefined, route.facing ?? undefined)]
                : []),
              ...(returnIntent !== null ? [returnIntent] : []),
            ],
          },
          exit: {
            actorIntents: [
              ...(geography.sourcePresent ? [actor(
                attackerId,
                physical ? "orient" : "idle",
                null,
                physical ? victimPoint : attackerPoint,
                undefined,
                route.facing ?? undefined,
              )] : []),
              ...(returnIntent === null
                ? []
                : [actor(victimId, "idle", null, victimPoint, undefined, oppositeFacing(route.facing))]),
            ],
          },
        },
      });
    },
  });
}

function definition<T extends FamilyEventType>(
  input: Omit<ChoreographyDefinition<T>, "safeCancelMarkers" | "missingParticipant">,
): ChoreographyDefinition<T> {
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
  const timeline = markerTimeline(input.durationMs, input.timeline);
  const phaseWindows = PHASES.map((phase, index) => ({
    phase,
    startMs: timeline.boundaries[index]!,
    endMs: timeline.boundaries[index + 1]!,
  }));
  const visibleAgents = visibleAgentIds(input.context.frame);
  const missingIds = missingParticipantIds(input.participants, visibleAgents);
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
    return {
      momentId: input.context.moment.id,
      regionId: input.regionId,
      phase,
      focus: participantFallback ? focus : content.focus ?? focus,
      dialogue: null,
      actorIntents: (content.actorIntents ?? []).filter(({ actorId }) => visibleAgents.has(actorId)).map((intent) => ({
        ...intent,
        marker: intent.marker === input.contactSuffix
          ? contactMarker
          : intent.marker === input.consequenceSuffix
            ? consequenceMarker
            : intent.marker,
      })),
      homeIntents: [],
      effectIntents: content.effectIntents ?? [],
      safeCancelMarkers: [safeAfterConsequence, safeAtExit],
      reducedMotion: input.context.reducedMotion,
    };
  });
  const additional = (input.additionalMarkers ?? []).map((marker) => sceneMarker(
    `${prefix}:${marker.name}`,
    marker.atMs,
    marker.order,
    marker.role,
    marker.optional,
  ));
  const markers = [
    sceneMarker(contactMarker, timeline.contactAt, 0, "contact"),
    ...additional,
    sceneMarker(consequenceMarker, timeline.consequenceAt, 0, "consequence"),
    sceneMarker(safeAfterConsequence, timeline.safeAt, 0, "safe-cancel"),
    sceneMarker(safeAtExit, input.durationMs, 0, "safe-cancel"),
    sceneMarker(settleMarker, input.durationMs, 1, "settle"),
  ].sort((left, right) => left.atMs - right.atMs || left.order - right.order);
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
    durationMs: input.durationMs,
    contactMarker,
    consequenceMarker,
    safeCancelMarkers: [safeAfterConsequence, safeAtExit],
    participants: input.participants,
    diagnostics: input.diagnostics,
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
  return [...new Set(resolved.flatMap(({ ids }) => ids).filter((id) => id !== "world" && !visible.has(id)))];
}

function regionNarrationFocus(regionId: string | null): StoryFocus {
  return regionId === null
    ? { kind: "system", regionId: null }
    : { kind: "region", id: regionId };
}

function markerTimeline(
  durationMs: number,
  exact?: Readonly<{
    readonly contactAtMs: number;
    readonly consequenceAtMs: number;
    readonly safeAtMs: number;
  }>,
): Readonly<{
  boundaries: readonly number[];
  contactAt: number;
  consequenceAt: number;
  safeAt: number;
}> {
  const contactAt = exact?.contactAtMs ?? Math.floor(durationMs * 0.34);
  const consequenceAt = exact?.consequenceAtMs ?? Math.floor(durationMs * 0.50);
  const safeAt = exact?.safeAtMs ?? Math.floor(durationMs * 0.62);
  const recoverEnd = Math.floor(durationMs * 0.98);
  if (!(0 < contactAt && contactAt < consequenceAt && consequenceAt < safeAt && safeAt < recoverEnd)) {
    throw new RangeError("bond/combat marker timing must remain ordered inside the scene duration");
  }
  return {
    boundaries: [0, contactAt, consequenceAt, safeAt, recoverEnd, durationMs],
    contactAt,
    consequenceAt,
    safeAt,
  };
}

function participants(
  values: readonly (readonly [ParticipantRole, readonly string[]])[],
): readonly ResolvedParticipant[] {
  return values.map(([role, ids]) => ({
    role,
    ids: [...new Set(ids.filter((id) => id.trim().length > 0))],
  }));
}

function actor(
  actorId: string,
  kind: ActorVisualIntent["kind"],
  marker: string | null = null,
  target: Point | null = null,
  waypoints?: readonly Point[],
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

function moveActor(actorId: string, route: ResolvedRoute): ActorVisualIntent {
  // Distance-gated like every other walk in the system: near enough and the
  // being crosses to its partner or its target; too far and the beat cuts.
  return gateLocomotion(actor(
    actorId,
    "move",
    null,
    route.waypoints.at(-1) ?? null,
    route.waypoints,
    route.facing ?? undefined,
  ));
}

/**
 * How long the two participants stand together AFTER the act has committed,
 * before the beat's own settle.
 *
 * Nothing walks away at the end of an interaction any more, so this window no
 * longer has to contain a return route -- it only has to keep the scene's
 * recover/exit phases non-degenerate and give the settle pose room. The
 * beings themselves simply remain in contact for as long as the next beat
 * leaves them there, which is what lets the overlay grammar (2.6-6.0s of
 * chrome) be read on two adjacent bodies.
 */
const CONTACT_SETTLE_MS = 900;

function durationAfterContact(minimumDurationMs: number, safeAtMs: number): number {
  return Math.max(minimumDurationMs, Math.ceil((safeAtMs + CONTACT_SETTLE_MS) / 0.98));
}

function clonePoint(point: Point): { x: number; y: number } {
  return { x: point.x, y: point.y };
}

function effect(
  kind: EffectVisualIntent["kind"],
  sourceId: string | null,
  targetId: string | null,
): EffectVisualIntent {
  return { kind, sourceId, targetId };
}

function pairMotif(sourceId: string, targetId: string, geography: PairGeography): readonly EffectVisualIntent[] {
  return [
    effect("portrait", sourceId, targetId),
    ...(geography.sourceRegion !== null
      && geography.targetRegion !== null
      && geography.sourceRegion !== geography.targetRegion
      ? [effect("atlas-transition", geography.sourceRegion, geography.targetRegion)]
      : []),
  ];
}

function pairGeography(
  frame: PresentedObserverFrame,
  sourceId: string,
  targetId: string,
  requiredRegion: string | null = null,
): PairGeography {
  const source = exactAgent(frame, sourceId);
  const target = exactAgent(frame, targetId);
  const sourceRegion = agentRegion(source);
  const targetRegion = agentRegion(target);
  const shared = sourceRegion !== null && sourceRegion === targetRegion;
  return {
    sourcePresent: source !== null,
    targetPresent: target !== null,
    sourceRegion,
    targetRegion,
    coLocated: shared && (requiredRegion === null || sourceRegion === requiredRegion),
  };
}

function pairDiagnostics(
  geography: PairGeography,
  sourceRole: ParticipantRole,
  targetRole: ParticipantRole,
): readonly ChoreographyDiagnostic[] {
  return [
    ...(!geography.sourcePresent
      ? [diagnostic(`${sourceRole}-not-presented`, sourceRole, "source participant is absent from the current exact presented frame")]
      : []),
    ...(!geography.targetPresent
      ? [diagnostic(`${targetRole}-not-presented`, targetRole, "target participant is absent from the current exact presented frame")]
      : []),
    ...(geography.sourcePresent && geography.targetPresent && !geography.coLocated
      ? [diagnostic("participants-not-colocated", targetRole, "TARGETED delivery does not prove physical co-location")]
      : []),
  ];
}

function exactAgent(
  frame: PresentedObserverFrame,
  agentId: string,
): Readonly<Partial<AgentSnapshot>> | null {
  const record = frame.world.agents.find((candidate) => candidate.value.id === agentId);
  return record?.completeness === "exact" ? record.value : null;
}

function agentRegion(agentValue: Readonly<Partial<AgentSnapshot>> | null): string | null {
  const position = agentValue?.position;
  return typeof position === "string" && position.trim().length > 0 ? position : null;
}

/**
 * Walk `moverId` to a tile beside `targetId` and face them.
 *
 * Delegates goal selection and legality to the shared
 * {@link resolveLegalContactRoute} so this family asks the renderer's own
 * apply-time question (`presentationRouteIsClear`, home footprints included)
 * BEFORE authoring the walk -- see `interactionContact.ts` for why a route
 * that only satisfied the collision grid was being silently dropped.
 */
function resolveContactRoute<T extends FamilyEventType>(
  context: ChoreographyContext<T>,
  moverId: string,
  targetId: string,
  regionId: string | null,
): ResolvedRoute {
  if (regionId === null) return fallbackRoute("contact region is unknown");
  const recipe = context.recipes.get(regionId);
  const mover = context.placement.agents.get(moverId);
  const target = context.placement.agents.get(targetId);
  if (recipe === undefined || mover?.regionId !== regionId || target?.regionId !== regionId) {
    return fallbackRoute("exact injected recipe and both regional placements are required");
  }
  const route = resolveLegalContactRoute(
    mover.point,
    target.point,
    recipe,
    homeExclusionsForRegion(context.placement, context.recipes, regionId),
  );
  if (route.status !== "reached" || route.contactPoint === null) return fallbackRoute(route.detail);
  return {
    status: "reached",
    waypoints: route.waypoints,
    facing: facingToward(pointTile(route.contactPoint), pointTile(target.point)),
    detail: route.detail,
  };
}

interface PhysicalRouteTiming {
  readonly contactAtMs: number;
  readonly consequenceAtMs: number;
  readonly safeAtMs: number;
  readonly durationMs: number;
}

function physicalRouteTiming(
  route: ResolvedRoute,
  baseline: Readonly<{
    readonly contactAtMs: number;
    readonly consequenceAtMs: number;
    readonly safeAtMs: number;
    readonly minimumDurationMs: number;
    readonly maximumDurationMs: number;
  }>,
): PhysicalRouteTiming | null {
  if (route.status !== "reached") return null;
  const contactAtMs = Math.max(
    baseline.contactAtMs,
    certifiedProductionRouteBudgetMs(route.waypoints, 48),
  ) + Math.ceil(1_000 / 30);
  const consequenceAtMs = contactAtMs + baseline.consequenceAtMs - baseline.contactAtMs;
  const safeAtMs = contactAtMs + baseline.safeAtMs - baseline.contactAtMs;
  const durationMs = durationAfterContact(baseline.minimumDurationMs, safeAtMs);
  return durationMs <= baseline.maximumDurationMs
    ? { contactAtMs, consequenceAtMs, safeAtMs, durationMs }
    : null;
}

function legalTransientKnockback<T extends FamilyEventType>(
  context: ChoreographyContext<T>,
  regionId: string,
  victim: Point,
  awayFrom: Point,
  distance: number,
): Point | null {
  if (distance < 4 || distance > 8) return null;
  const recipe = context.recipes.get(regionId);
  if (recipe === undefined) return null;
  const dx = victim.x - awayFrom.x;
  const dy = victim.y - awayFrom.y;
  const magnitude = Math.hypot(dx, dy);
  const candidate = magnitude === 0
    ? { x: victim.x + distance, y: victim.y }
    : {
        x: victim.x + (dx / magnitude) * distance,
        y: victim.y + (dy / magnitude) * distance,
      };
  return tileIsOpen(recipe.grid, pointTile(candidate)) ? candidate : null;
}

function pointTile(point: Point): TileCoord {
  return {
    column: Math.floor(point.x / TILE_SIZE),
    row: Math.floor(point.y / TILE_SIZE),
  };
}

function tileIsOpen(
  grid: Readonly<{ columns: number; rows: number; collision: Uint8Array }>,
  tile: TileCoord,
): boolean {
  return tile.column >= 0 && tile.column < grid.columns
    && tile.row >= 0 && tile.row < grid.rows
    && grid.collision[tile.row * grid.columns + tile.column] === 0;
}

function facingToward(from: TileCoord, to: TileCoord): Direction4 {
  if (to.column > from.column) return "east";
  if (to.column < from.column) return "west";
  if (to.row > from.row) return "south";
  return "north";
}

function oppositeFacing(facing: Direction4 | null): Direction4 | undefined {
  if (facing === null) return undefined;
  if (facing === "north") return "south";
  if (facing === "south") return "north";
  if (facing === "east") return "west";
  return "east";
}

function fallbackRoute(detail: string): ResolvedRoute {
  return { status: "fallback", waypoints: [], facing: null, detail };
}

function diagnostic(
  code: string,
  role: ParticipantRole | null,
  detail: string,
): ChoreographyDiagnostic {
  return { code, role, detail };
}

function refundDiagnostic(): ChoreographyDiagnostic {
  return diagnostic(
    "refund-from-evidence",
    "initiator",
    "refund is represented as a cue only; balances remain exclusively consequence-frame truth",
  );
}

function focusFor(
  regionId: string | null,
  resolved: readonly ResolvedParticipant[],
  fallback: StoryFocus,
): StoryFocus {
  const actorId = resolved.find((value) => value.role === "actor")?.ids[0]
    ?? resolved.find((value) => value.role === "killer")?.ids[0]
    ?? resolved.find((value) => value.role === "initiator")?.ids[0]
    ?? null;
  if (actorId !== null) return { kind: "agent", id: actorId };
  if (regionId !== null) return { kind: "region", id: regionId };
  return fallback;
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

const _familyClosure: readonly FamilyEventType[] = BOND_COMBAT_DEFINITIONS.map(
  (definitionValue) => definitionValue.eventType,
);
void _familyClosure;
void (null as unknown as BondEventType);
