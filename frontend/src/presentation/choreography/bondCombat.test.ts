import { describe, expect, it } from "vitest";

import type { AgentSnapshot, EventEnvelopeEntry, RegionSnapshot } from "../../app/schemas";
import { TILE_SIZE, tileCenter } from "../../renderer2d/map/regionMap";
import { LayeredHumanActor } from "../../renderer2d/production/actors/LayeredHumanActor";
import {
  PRODUCTION_ASSET_MANIFEST,
  requireHumanClip,
  type ProductionAssetLease,
} from "../../renderer2d/production/assets/productionManifest";
import { createRegionMapIdentity } from "../../renderer2d/production/maps/RegionMapIdentity";
import {
  createRegionMapRecipe,
  type RegionMapRecipeV1,
} from "../../renderer2d/production/maps/RegionMapRecipe";
import type { PlacementLedgerSnapshot } from "../../renderer2d/production/placement/PlacementLedger";
import { BeatDirector, type StoryMoment } from "../BeatDirector";
import type { ActorVisualIntent, Direction4, PresentedObserverFrame } from "../contracts";
import {
  parsePresentedEvent,
  type PresentedEventType,
  type TypedPresentedEvent,
} from "../eventPayloads";
import { createSceneExecutor } from "./SceneExecutor";
import { BOND_COMBAT_DEFINITIONS } from "./bondCombat";
import { INTERACTION_CONTACT_TOLERANCE_PX } from "./interactionContact";
import type { ChoreographyContext, ChoreographyPlan } from "./contracts";
import { LIFECYCLE_MOVEMENT_COMMUNICATION_RESOURCE_DEFINITIONS } from "./lifecycleMovementCommunicationResource";
import { CONTACT_ROUTE_MAX_MS, certifiedProductionRouteBudgetMs } from "./productionLocomotionTiming";

const FAMILY_TYPES = Object.freeze([
  "mating_initiated",
  "mating_rejected",
  "mating_proposal_invalidated",
  "mating_proposal_timeout",
  "attack",
] as const);

describe("Task 9 bond and combat choreography", () => {
  it("exports exactly five immutable canonical definitions", () => {
    expect(BOND_COMBAT_DEFINITIONS.map((definition) => definition.eventType)).toEqual(FAMILY_TYPES);
    expect(Object.isFrozen(BOND_COMBAT_DEFINITIONS)).toBe(true);
    for (const definition of BOND_COMBAT_DEFINITIONS) {
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.participants)).toBe(true);
      expect(Object.isFrozen(definition.requiredAnchors)).toBe(true);
      expect(Object.isFrozen(definition.safeCancelMarkers)).toBe(true);
      expect(definition.participants.length).toBeGreaterThan(0);
      expect(definition.requiredAnchors.length).toBeGreaterThan(0);
      expect(definition.contactMarker).not.toBe(definition.consequenceMarker);
      expect(definition.safeCancelMarkers.length).toBeGreaterThan(0);
      expect(definition.duration.minMs).toBeGreaterThan(0);
      expect(definition.duration.maxMs).toBeGreaterThanOrEqual(definition.duration.minMs);
    }
  });

  it.each(FAMILY_TYPES)("resolves %s deterministically to a deep-immutable executor-valid program", (type) => {
    const context = contextFor(type);
    const definition = definitionFor(type);
    const first = resolve(definition, context);
    const second = resolve(definition, context);

    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.phases)).toBe(true);
    expect(Object.isFrozen(first.markers)).toBe(true);
    expect(Object.isFrozen(first.participants)).toBe(true);
    expect(Object.isFrozen(first.diagnostics)).toBe(true);
    expect(first.markers.filter((marker) => marker.role === "consequence")).toHaveLength(1);
    expect(first.markers.at(-1)).toMatchObject({ role: "settle", atMs: first.durationMs });
    expect(first.durationMs).toBeGreaterThanOrEqual(definition.duration.minMs);
    expect(first.durationMs).toBeLessThanOrEqual(definition.duration.maxMs);
    expect(first.markers.map((marker) => [marker.atMs, marker.order]))
      .toEqual([...first.markers].sort((left, right) => left.atMs - right.atMs || left.order - right.order)
        .map((marker) => [marker.atMs, marker.order]));

    const executor = createSceneExecutor();
    expect(() => executor.start(
      { moment: context.moment, program: first },
      identity(context.frame),
    )).not.toThrow();
  });

  it("permits physical proposal staging only when the current frame proves co-location", () => {
    const local = definitionFor("mating_initiated").resolve(contextFor("mating_initiated"));
    const remote = definitionFor("mating_initiated").resolve(contextFor("mating_initiated", {
      targetRegion: "ridge",
    }));
    const absent = definitionFor("mating_initiated").resolve(contextFor("mating_initiated", {
      omitTarget: true,
    }));

    expect(kinds(local)).toEqual(expect.arrayContaining(["move", "orient", "reach"]));
    expect(local.phases.flatMap((phase) => phase.effectIntents))
      .not.toContainEqual(expect.objectContaining({ kind: "portrait" }));

    for (const plan of [remote, absent]) {
      expect(kinds(plan)).not.toContain("move");
      expect(kinds(plan)).not.toContain("reach");
      expect(plan.phases.flatMap((phase) => phase.effectIntents)).toContainEqual(
        expect.objectContaining({ kind: "portrait", sourceId: "initiator", targetId: "target" }),
      );
    }
    expect(remote.phases.flatMap((phase) => phase.effectIntents)).toContainEqual({
      kind: "atlas-transition",
      sourceId: "spring",
      targetId: "ridge",
    });
    expect(absent.diagnostics).toContainEqual(expect.objectContaining({ code: "target-not-presented" }));
  });

  // Regression for the live "grey/slate box drawn on a co-located, on-screen
  // participant's own body during a mating beat" defect (mating-box-fix-report.md)
  // and its identical latent form in `attack` (flagged there, fixed here):
  // `contextFor`'s default fixture places the pair only 2 tiles (64px) apart,
  // comfortably inside any physical-motion time budget, so it never exercised a
  // realistic separation. `PlacementLedger.stagingPlacement` (the real production
  // placement source) hashes every agent to its own staging anchor at least 71px
  // apart -- G1's F2 finding for `resource_transferred` hit the identical gap --
  // so a live pair can easily land 5+ tiles apart despite being genuinely
  // co-located and both on screen. Before this fix, `physicalRouteTiming`'s
  // 8_000ms ceiling was too tight for that separation (its round-trip formula
  // budgets the outbound leg AND a second full reversed-route budget for the
  // return, padded by /0.98), so `physical` silently resolved false and the
  // "remote portrait" motif -- designed for a genuinely absent/remote
  // participant -- was drawn directly on top of the very-much-present,
  // co-located participant's own body instead.
  //
  // This table intentionally covers every contact/physical-route definition in
  // this family (every `resolveContactRoute`/`physicalRouteTiming` call site in
  // bondCombat.ts) so a future definition added to that list with its own
  // too-tight ceiling fails here, in CI, rather than shipping a body-anchored
  // portrait box into a live run a third time.
  it.each(["mating_initiated", "mating_rejected", "attack"] as const)(
    "still stages a physical %s scene (no body-anchored portrait box) for a realistic same-region separation",
    (type) => {
      const [moverId, otherId] = contactRouteMoverIds(type);
      const base = contextFor(type);
      // 5 tiles (160px) apart on the same row as the grid's one collision
      // cell (column 3, row 3), forcing an actual routed detour -- matching (and
      // slightly exceeding) the ~161px separation captured live from the real
      // C18 fixture's mating_initiated beat (Dick -> Allen).
      const context = withAgentPoint(
        withAgentPoint(base, moverId, tileCenter({ column: 1, row: 3 })),
        otherId,
        tileCenter({ column: 6, row: 3 }),
      );
      const plan = definitionFor(type).resolve(context as never);

      expect(kinds(plan)).toEqual(expect.arrayContaining(["move", "orient"]));
      expect(plan.phases.flatMap((phase) => phase.effectIntents))
        .not.toContainEqual(expect.objectContaining({ kind: "portrait" }));
      expect(plan.durationMs).toBeLessThanOrEqual(definitionFor(type).duration.maxMs);
      expect(plan.durationMs).toBeLessThanOrEqual(CONTACT_ROUTE_MAX_MS);
    },
  );

  it("delivers rejection from payload rejecter to the original initiator despite drifted hints", () => {
    const context = contextFor("mating_rejected", {
      resolved: { actor_id: "wrong-actor", target_id: "wrong-target" },
    });
    const plan = definitionFor("mating_rejected").resolve(context);

    expect(plan.participants).toEqual([
      { role: "actor", ids: ["rejecter"] },
      { role: "initiator", ids: ["initiator"] },
    ]);
    expect(new Set(plan.phases.flatMap((phase) => phase.actorIntents).map((intent) => intent.actorId)))
      .toEqual(new Set(["rejecter", "initiator"]));
    expect(JSON.stringify(plan)).not.toContain("wrong-");
  });

  it.each(["mating_initiated", "mating_rejected", "mating_proposal_invalidated", "mating_proposal_timeout"] as const)(
    "G1 polish: %s renders the distinct gold bond-token motif, never the generic combat/loot ember arc",
    (type) => {
      const definition = definitionFor(type);
      const plan = resolve(definition, contextFor(type));
      const kindsUsed = plan.phases.flatMap((phase) => phase.effectIntents).map((intent) => intent.kind);

      expect(kindsUsed).toContain("bond-token");
      expect(kindsUsed).not.toContain("arc");
    },
  );

  it("IMPACT: attack now renders two floating numbers (damage on the victim, cost on the attacker), superseding the old generic ember arc; unaffected by the mating bond-token motif", () => {
    const plan = definitionFor("attack").resolve(contextFor("attack"));
    const kindsUsed = plan.phases.flatMap((phase) => phase.effectIntents).map((intent) => intent.kind);

    expect(kindsUsed).toContain("impact");
    expect(kindsUsed).not.toContain("arc");
    expect(kindsUsed).not.toContain("bond-token");
  });

  it.each(["mating_rejected", "mating_proposal_invalidated", "mating_proposal_timeout"] as const)(
    "%s renders a refund cue without inventing balance or pair-bond state",
    (type) => {
      const definition = definitionFor(type);
      const plan = resolve(definition, contextFor(type, { targetRegion: "ridge" }));
      const serialized = JSON.stringify(plan);

      expect(plan.diagnostics).toContainEqual(expect.objectContaining({ code: "refund-from-evidence" }));
      expect(serialized).not.toContain("resources_refunded");
      expect(serialized).not.toContain("energyBalance");
      expect(serialized).not.toContain("materialsBalance");
      expect(serialized).not.toContain("pair-bond");
      expect(serialized).not.toContain("relationship");
      expect(plan.phases.flatMap((phase) => phase.homeIntents)).toEqual([]);
    },
  );

  it("retains a collision-safe non-lethal attack route, one impact, 80ms hit-stop, 1px impulse, legal transient 6px knockback, and recovery", () => {
    const context = contextFor("attack");
    const plan = definitionFor("attack").resolve(context);
    const intents = plan.phases.flatMap((phase) => phase.actorIntents);
    const attackerStart = context.placement.agents.get("attacker")!.point;
    const victimStart = context.placement.agents.get("victim")!.point;
    const approach = intents.find((intent) => intent.actorId === "attacker" && intent.kind === "move")!;
    const knockback = intents.find((intent) => intent.actorId === "victim" && intent.kind === "hurt")!;
    const recovery = intents.find((intent) => intent.actorId === "victim" && intent.kind === "recover")!;
    const contact = plan.markers.find((marker) => marker.name.endsWith(":attack:hit-contact"))!;
    const hitStopEnd = plan.markers.find((marker) => marker.name.endsWith(":attack:hit-stop-end"))!;

    expect(intents).toContainEqual(expect.objectContaining({ actorId: "attacker", kind: "move" }));
    expect(intents).toContainEqual(expect.objectContaining({ actorId: "attacker", kind: "reach" }));
    expect(approach.waypoints!.length).toBeGreaterThanOrEqual(4);
    expect(approach.waypoints![0]).toEqual(attackerStart);
    expect(approach.target).toEqual(approach.waypoints!.at(-1));
    expectLegalCardinalRoute(context.recipes.get("spring")!, approach.waypoints!);
    expect(straightLineCrossesCollision(context.recipes.get("spring")!, attackerStart, victimStart)).toBe(true);
    expect(distance(victimStart, knockback.target!)).toBeCloseTo(6, 5);
    expect(pointIsOpen(context.recipes.get("spring")!, knockback.target!)).toBe(true);
    expect(knockback.target).not.toBe(victimStart);
    expect(recovery.target).toEqual(victimStart);
    expect(context.placement.agents.get("victim")!.point).toEqual(victimStart);
    expect(hitStopEnd.atMs - contact.atMs).toBe(80);
    expect(plan.phases.flatMap((phase) => phase.effectIntents).filter((intent) => intent.kind === "camera-impulse"))
      .toEqual([{ kind: "camera-impulse", sourceId: "attack:1px", targetId: "victim" }]);
    expect(intents.some((intent) => intent.kind === "dead" || intent.kind === "prone")).toBe(false);
    expect(intents.filter((intent) => intent.actorId === "victim" && intent.kind === "recover")).toHaveLength(1);
    expect(plan.markers.filter((marker) => marker.role === "consequence")).toHaveLength(1);
  });

  it("resolves a real strike-fall through its agent_paralyzed representative and Family A exactly once", () => {
    const shared = strikeFallContext();
    expect(shared.moment.representative.event.type).toBe("agent_paralyzed");
    expect(shared.event.type).toBe("agent_paralyzed");
    expect(BOND_COMBAT_DEFINITIONS.some((definition) => definition.eventType === shared.event.type as string))
      .toBe(false);
    const definition = LIFECYCLE_MOVEMENT_COMMUNICATION_RESOURCE_DEFINITIONS.find(
      (candidate) => candidate.eventType === "agent_paralyzed",
    )!;
    const plan = definition.resolve(shared);
    const intents = plan.phases.flatMap((phase) => phase.actorIntents);

    expect(intents.filter((intent) => intent.actorId === "attacker" && intent.kind === "reach")).toHaveLength(1);
    expect(intents.filter((intent) => intent.actorId === "victim" && intent.kind === "hurt")).toHaveLength(1);
    expect(intents.some((intent) => intent.actorId === "victim" && intent.kind === "recover")).toBe(false);
    expect(plan.markers.filter((marker) => marker.role === "consequence")).toHaveLength(1);
  });

  it("preserves endpoints and causal marker order under reduced motion while removing travel, impulse, hit-stop flourish, and knockback", () => {
    const normalContext = contextFor("attack");
    const normal = definitionFor("attack").resolve(normalContext);
    const reduced = definitionFor("attack").resolve({ ...normalContext, reducedMotion: true });
    const reducedIntents = reduced.phases.flatMap((phase) => phase.actorIntents);

    expect(reduced.reducedMotionEndpoint).toEqual(normal.reducedMotionEndpoint);
    expect(reduced.participants).toEqual(normal.participants);
    expect(reduced.markers.map((marker) => [marker.name, marker.role]))
      .toEqual(normal.markers.map((marker) => [marker.name, marker.role]));
    expect(reduced.phases.every((phase) => phase.reducedMotion)).toBe(true);
    expect(reducedIntents.some((intent) => intent.kind === "move")).toBe(false);
    expect(reduced.phases.flatMap((phase) => phase.effectIntents).some((intent) => intent.kind === "camera-impulse"))
      .toBe(false);
    expect(reducedIntents.find((intent) => intent.actorId === "victim" && intent.kind === "hurt")?.target)
      .toBeNull();
    expect(reducedIntents.find((intent) => intent.actorId === "victim" && intent.kind === "recover")?.target)
      .toEqual(normalContext.placement.agents.get("victim")!.point);
  });

  it("falls back diagnostically when combat participants are missing and never invents physical actors", () => {
    const plan = definitionFor("attack").resolve(contextFor("attack", { omitTarget: true }));

    expect(plan.diagnostics).toContainEqual(expect.objectContaining({ code: "victim-not-presented" }));
    expect(kinds(plan)).not.toContain("move");
    expect(kinds(plan)).not.toContain("reach");
    expect(new Set(plan.phases.flatMap((phase) => phase.actorIntents).map((intent) => intent.actorId)))
      .toEqual(new Set(["attacker"]));
    expect(plan.phases.every(({ focus }) => focus.kind === "region" && focus.id === "spring"))
      .toBe(true);

    const corrected = definitionFor("attack").resolve(contextFor("attack"));
    expect(corrected.phases[0]?.focus).toEqual({ kind: "agent", id: "attacker" });
  });

  it.each(["mating_proposal_invalidated", "mating_proposal_timeout"] as const)(
    "%s uses an initiator-only weary token-fade motif and never injury/combat semantics",
    (type) => {
      const plan = resolve(definitionFor(type), contextFor(type, { targetRegion: "ridge" }));
      const actorIntents = plan.phases.flatMap((phase) => phase.actorIntents);
      const serialized = JSON.stringify(plan);

      expect(new Set(actorIntents.map((intent) => intent.actorId))).toEqual(new Set(["initiator"]));
      expect(actorIntents.every((intent) => ["orient", "idle"].includes(intent.kind))).toBe(true);
      expect(actorIntents.some((intent) => intent.marker?.includes("weary-token-fade"))).toBe(true);
      expect(plan.phases.flatMap((phase) => phase.effectIntents)).toContainEqual(
        expect.objectContaining({ kind: "portrait", sourceId: "initiator", targetId: "target" }),
      );
      for (const forbidden of ["hurt", "prone", "dead", "hit-stop", "knockback"]) {
        expect(serialized).not.toContain(`\"${forbidden}\"`);
      }
    },
  );

  it("deep-owns all target and waypoint output without freezing or retaining caller placement points", () => {
    const context = contextFor("attack");
    const attackerPoint = { ...context.placement.agents.get("attacker")!.point };
    const victimPoint = { ...context.placement.agents.get("victim")!.point };
    const agents = new Map(context.placement.agents);
    agents.set("attacker", { regionId: "spring", point: attackerPoint, anchorKind: "test" });
    agents.set("victim", { regionId: "spring", point: victimPoint, anchorKind: "test" });
    const plan = definitionFor("attack").resolve({
      ...context,
      placement: { ...context.placement, agents },
    });
    const coordinates = plan.phases.flatMap((phase) => phase.actorIntents).flatMap((intent) => [
      ...(intent.target === null ? [] : [intent.target]),
      ...(intent.waypoints ?? []),
    ]);

    expect(Object.isFrozen(attackerPoint)).toBe(false);
    expect(Object.isFrozen(victimPoint)).toBe(false);
    expect(coordinates.length).toBeGreaterThan(0);
    expect(coordinates.every((point) => (
      point !== attackerPoint && point !== victimPoint && Object.isFrozen(point)
    ))).toBe(true);
    attackerPoint.x = 999;
    victimPoint.y = 999;
    expect(coordinates.every((point) => point.x !== 999 && point.y !== 999)).toBe(true);
  });

  it.each(["mating_initiated", "attack"] as const)(
    "retains exact collision-open cardinal waypoints for local %s and never a raw Euclidean path",
    (type) => {
      const context = contextFor(type);
      const plan = definitionFor(type).resolve(context as never);
      const moverId = type === "attack" ? "attacker" : "initiator";
      const targetId = type === "attack" ? "victim" : "target";
      const move = plan.phases.flatMap((phase) => phase.actorIntents)
        .find((intent) => intent.actorId === moverId && intent.kind === "move")!;
      const start = context.placement.agents.get(moverId)!.point;
      const target = context.placement.agents.get(targetId)!.point;

      expect(move.waypoints!.length).toBeGreaterThanOrEqual(4);
      expect(move.target).toEqual(move.waypoints!.at(-1));
      expectLegalCardinalRoute(context.recipes.get("spring")!, move.waypoints!);
      expect(straightLineCrossesCollision(context.recipes.get("spring")!, start, target)).toBe(true);
    },
  );

  it.each(["mating_initiated", "attack"] as const)(
    "keeps normal/reduced %s final coordinate, facing, and nonterminal state identical",
    (type) => {
      const normalContext = contextFor(type);
      const normal = definitionFor(type).resolve(normalContext as never);
      const reduced = definitionFor(type).resolve({ ...normalContext, reducedMotion: true } as never);
      const moverId = type === "attack" ? "attacker" : "initiator";
      const normalFinal = finalActorIntent(normal, moverId);
      const reducedFinal = finalActorIntent(reduced, moverId);

      expect(reducedFinal.target).toEqual(normalFinal.target);
      expect(reducedFinal.facing).toBe(normalFinal.facing);
      expect(reducedFinal.kind).toBe(normalFinal.kind);
      expect(normal.phases.flatMap((phase) => phase.actorIntents).some((intent) => intent.kind === "dead" || intent.kind === "prone"))
        .toBe(false);
      expect(reduced.phases.flatMap((phase) => phase.actorIntents).some((intent) => intent.kind === "dead" || intent.kind === "prone"))
        .toBe(false);
    },
  );

  // CONVERGENCE: the mover walks ONE certified route -- to contact -- and then
  // stays there for the rest of the beat. The old shape authored a second,
  // reversed "recovery" move that began a few hundred ms after contact and ran
  // for the whole remaining scene; because the act's chrome lives 2.6-6.0s, the
  // beat was read almost entirely while the two participants were separating,
  // and the beat director had to zoom out to keep both live anchors framed.
  it.each(["mating_initiated", "mating_rejected", "attack"] as const)(
    "walks the certified local %s route to contact at 48px/s and stays there",
    (type) => {
      for (const hz of [30, 60, 120]) {
        const context = contextFor(type);
        const plan = definitionFor(type).resolve(context as never);
        const moverId = type === "attack"
          ? "attacker"
          : type === "mating_rejected" ? "rejecter" : "initiator";
        const otherId = contactRouteMoverIds(type)[1];
        const moverIntents = plan.phases.flatMap((phase) => phase.actorIntents)
          .filter((intent) => intent.actorId === moverId);
        const moves = moverIntents.filter((intent) => intent.kind === "move");
        expect(moves).toHaveLength(1);
        const outbound = moves[0]!;
        const route = outbound.waypoints!;
        const originalPoint = context.placement.agents.get(moverId)!.point;
        const otherPoint = context.placement.agents.get(otherId)!.point;
        const contactPoint = route.at(-1)!;
        const holdWindow = plan.phaseWindows.find((window) => window.phase === "hold")!;
        const exitIntent = plan.phases.find((phase) => phase.phase === "exit")!.actorIntents
          .find((intent) => intent.actorId === moverId)!;

        expect(moverIntents.some((intent) => intent.kind === "fade-reposition")).toBe(false);
        // The contact point is a believable interaction distance from the other
        // party -- one tile, arm's length -- and it is NOT where the mover
        // started.
        expect(distance(contactPoint, otherPoint))
          .toBeLessThanOrEqual(INTERACTION_CONTACT_TOLERANCE_PX);
        expect(distance(contactPoint, originalPoint)).toBeGreaterThan(0);
        // Every phase after the approach keeps the mover at that contact point.
        for (const phase of ["consequence", "recover", "exit"] as const) {
          const intent = plan.phases.find((candidate) => candidate.phase === phase)!.actorIntents
            .find((candidate) => candidate.actorId === moverId);
          if (intent === undefined || intent.target === null) continue;
          expect(intent.kind).not.toBe("move");
          const anchored = intent.kind === "orient" ? otherPoint : contactPoint;
          expect(intent.target).toEqual(anchored);
        }
        expect(holdWindow.endMs - holdWindow.startMs)
          .toBeGreaterThanOrEqual(certifiedReachHandContactBudgetMs(contactFacingFor(outbound)));
        // All three route-bearing bond/combat definitions (mating_initiated,
        // mating_rejected, attack) share the CONTACT_ROUTE_MAX_MS ceiling -- see
        // productionLocomotionTiming.ts's doc comment for the two prior
        // incidents (G1 F2, mating-box-fix) this constant guards against.
        expect(definitionFor(type).duration.maxMs).toBeLessThanOrEqual(CONTACT_ROUTE_MAX_MS);
        expect(exitIntent).toMatchObject({
          actorId: moverId,
          kind: "orient",
          target: otherPoint,
          facing: outbound.facing,
        });

        const actorValue = layeredActor(moverId, route[0]!, outbound.facing ?? "south");
        const speed = 48;
        actorValue.apply({ kind: "move", waypoints: route, speedPixelsPerSecond: speed, gait: "walk" }, 0);
        const sampled = driveTo(actorValue, route.at(-1)!, hz, speed);
        const arrivalMs = sampled.nowMs;
        const contactAt = plan.markers.find((marker) => marker.role === "contact")!.atMs;

        expect(new Set(sampled.positions.map(pointKey)).size).toBeGreaterThanOrEqual(4);
        expect(distance(sampled.positions.at(-1)!, route.at(-1)!)).toBeLessThanOrEqual(0.5);
        expect(contactAt).toBeGreaterThanOrEqual(arrivalMs - (1_000 / hz));
        expect(sampled.maximumSpeed).toBeLessThanOrEqual(speed + 0.01);

        const contactFacing = outbound.facing ?? "south";
        actorValue.apply({ kind: "orient", facing: contactFacing }, arrivalMs);
        actorValue.advance(0.12, arrivalMs + 120);
        actorValue.apply({ kind: "play-body", action: "reach-give" }, arrivalMs + 120);
        const contactSignals = [];
        let contactNowMs = arrivalMs + 120;
        for (let index = 0; index < hz * 2 && contactSignals.length === 0; index += 1) {
          contactNowMs += 1_000 / hz;
          contactSignals.push(...actorValue.advance(1 / hz, contactNowMs).filter((signal) => (
            signal.kind === "marker" && signal.marker === "hand-contact"
          )));
        }
        expect(contactSignals).toHaveLength(1);
        expect(contactNowMs).toBeGreaterThan(arrivalMs);
        expect(contactNowMs - (arrivalMs + 120)).toBeLessThanOrEqual(
          holdWindow.endMs - holdWindow.startMs,
        );

        // Nothing sends the mover away: driving the remainder of the beat
        // leaves it exactly where the act happened.
        actorValue.advance(1, contactNowMs + 1_000);
        const normalFinal = actorValue.snapshot();
        expect(distance(normalFinal.position, contactPoint)).toBeLessThanOrEqual(0.5);
        expect(normalFinal.terminal).toBe(false);

        actorValue.apply({ kind: "orient", facing: exitIntent.facing! }, contactNowMs + 1_001);
        actorValue.advance(1, contactNowMs + 2_001);
        const normalExited = actorValue.snapshot();
        expect(normalExited.facing).toBe(exitIntent.facing);
        expect(distance(normalExited.position, contactPoint)).toBeLessThanOrEqual(0.5);

        const reducedPlan = definitionFor(type).resolve({ ...context, reducedMotion: true } as never);
        const reducedFinalIntent = finalActorIntent(reducedPlan, moverId);
        const reducedActor = layeredActor(
          `${moverId}-reduced`,
          originalPoint,
          oppositeDirection(reducedFinalIntent.facing ?? "south"),
        );
        const reducedMoverIntents = reducedPlan.phases.flatMap((phase) => phase.actorIntents)
          .filter((intent) => intent.actorId === moverId);
        expect(reducedMoverIntents.some((intent) => (
          intent.kind === "move" || intent.kind === "fade-reposition"
        ))).toBe(false);
        reducedActor.apply({ kind: "orient", facing: reducedFinalIntent.facing ?? "south" }, 0);
        reducedActor.advance(1, 1_000);
        const reducedFinal = reducedActor.snapshot();
        expect(reducedFinal.position).toEqual(originalPoint);
        expect(reducedFinal.facing).toBe(normalExited.facing);
        expect(reducedFinal.terminal).toBe(normalExited.terminal);
      }
    },
  );

  it.each(["mating_initiated", "mating_rejected", "attack"] as const)(
    "walks an off-center local %s birth placement into contact without exceeding 48px/s",
    (type) => {
      for (const hz of [30, 60, 120]) {
        const moverId = type === "attack"
          ? "attacker"
          : type === "mating_rejected" ? "rejecter" : "initiator";
        const base = contextFor(type);
        const retained = base.placement.agents.get(moverId)!.point;
        const cellCenter = {
          x: Math.floor(retained.x / TILE_SIZE) * TILE_SIZE + TILE_SIZE / 2,
          y: Math.floor(retained.y / TILE_SIZE) * TILE_SIZE + TILE_SIZE / 2,
        };
        const exactBirthPoint = {
          x: cellCenter.x - 15,
          y: cellCenter.y + 6,
        };
        const context = withAgentPoint(base, moverId, exactBirthPoint);
        const plan = definitionFor(type).resolve(context as never);
        const moverIntents = plan.phases.flatMap((phase) => phase.actorIntents)
          .filter((intent) => intent.actorId === moverId);
        const moves = moverIntents.filter((intent) => intent.kind === "move");

        expect(moves).toHaveLength(1);
        expect(moverIntents.some((intent) => intent.kind === "fade-reposition")).toBe(false);
        const outbound = moves[0]!;
        const outboundRoute = outbound.waypoints!;
        expect(outboundRoute[0]).toEqual(exactBirthPoint);
        expectInitialConnectorThenLegalRoute(
          context.recipes.get("spring")!,
          outboundRoute,
          exactBirthPoint,
        );
        // The off-center start is walked away from and never walked back to.
        expect(outboundRoute.at(-1)).not.toEqual(exactBirthPoint);
        expect(plan.durationMs).toBeLessThanOrEqual(definitionFor(type).duration.maxMs);
        // See the identical comment above: all three route-bearing definitions
        // share the CONTACT_ROUTE_MAX_MS ceiling.
        expect(definitionFor(type).duration.maxMs).toBeLessThanOrEqual(CONTACT_ROUTE_MAX_MS);

        const speed = 48;
        const actorValue = layeredActor(`${moverId}-off-center`, exactBirthPoint, outbound.facing ?? "south");
        actorValue.apply({
          kind: "move",
          waypoints: outboundRoute,
          speedPixelsPerSecond: speed,
          gait: "walk",
        }, 0);
        const outboundResult = driveTo(actorValue, outboundRoute.at(-1)!, hz, speed);
        expect(outboundResult.maximumSpeed).toBeLessThanOrEqual(speed + 0.01);
        expect(plan.markers.find((marker) => marker.role === "contact")!.atMs)
          .toBeGreaterThanOrEqual(outboundResult.nowMs - (1_000 / hz));
        actorValue.advance(1, outboundResult.nowMs + 1_000);
        expect(actorValue.snapshot()).toMatchObject({
          position: outboundRoute.at(-1)!,
          terminal: false,
        });
      }
    },
  );
});

type FamilyType = (typeof FAMILY_TYPES)[number];

/**
 * The (mover, other) agent-id pair for each contact/physical-route definition
 * in this family, i.e. every definition that calls `resolveContactRoute` and
 * `physicalRouteTiming` in bondCombat.ts. Kept as one table so the
 * realistic-separation regression test above stays table-driven: adding a
 * fourth route-bearing definition to this family means adding one line here
 * and one entry to that test's `it.each` array, not writing a new test.
 */
function contactRouteMoverIds(
  type: "mating_initiated" | "mating_rejected" | "attack",
): readonly [moverId: string, otherId: string] {
  switch (type) {
    case "mating_rejected": return ["rejecter", "initiator"];
    case "attack": return ["attacker", "victim"];
    case "mating_initiated": return ["initiator", "target"];
  }
}

function definitionFor<T extends FamilyType>(type: T) {
  const definition = BOND_COMBAT_DEFINITIONS.find((candidate) => candidate.eventType === type);
  if (definition === undefined) throw new Error(`missing definition ${type}`);
  return definition as Extract<typeof BOND_COMBAT_DEFINITIONS[number], { eventType: T }>;
}

function resolve<T extends FamilyType>(
  definition: ReturnType<typeof definitionFor<T>>,
  context: ChoreographyContext<T>,
): ChoreographyPlan {
  return definition.resolve(context as never);
}

interface ContextOptions {
  readonly targetRegion?: string;
  readonly omitTarget?: boolean;
  readonly resolved?: Readonly<Record<string, string>>;
}

function contextFor<T extends FamilyType>(
  type: T,
  options: ContextOptions = {},
): ChoreographyContext<T> {
  const entries = [event(1, type, payloadFor(type), options.resolved)];
  const moment = new BeatDirector().group(entries)[0]!;
  const parsed = parsePresentedEvent(moment.representative);
  if (!parsed.known || parsed.evidence.type !== type) throw new Error(`expected ${type}`);
  const agents = [
    agent("initiator", "spring"),
    agent("rejecter", options.targetRegion ?? "spring"),
    agent("target", options.targetRegion ?? "spring"),
    agent("attacker", "spring"),
    agent("victim", options.targetRegion ?? "spring"),
  ].filter((candidate) => !(options.omitTarget && (candidate.id === "target" || candidate.id === "victim")));
  return {
    moment,
    event: parsed.evidence as Extract<TypedPresentedEvent, { readonly type: T }>,
    frame: frame(agents),
    placement: placement(agents),
    recipes: new Map([
      ["spring", tacticalRecipe("spring")],
      ["ridge", tacticalRecipe("ridge")],
    ]),
    reducedMotion: false,
    compactResourceRouting: false,
  };
}

function strikeFallContext(): ChoreographyContext<"agent_paralyzed"> {
  const entries = [
    event(1, "attack", payloadFor("attack")),
    event(2, "agent_paralyzed", {
      message: "Victim fell.", agent_id: "victim", region: "spring", trigger: "attack",
      energy: 0, victim_id: "victim", attacker_id: "attacker",
    }),
  ];
  const moment = new BeatDirector().group(entries)[0]!;
  const parsed = parsePresentedEvent(moment.representative);
  if (!parsed.known || parsed.evidence.type !== "agent_paralyzed") {
    throw new Error("expected strike-fall paralysis representative");
  }
  const agents = [agent("attacker", "spring"), agent("victim", "spring")];
  return {
    moment,
    event: parsed.evidence,
    frame: frame(agents),
    placement: placement(agents),
    recipes: new Map([
      ["spring", tacticalRecipe("spring")],
      ["ridge", tacticalRecipe("ridge")],
    ]),
    reducedMotion: false,
    compactResourceRouting: false,
  };
}

function payloadFor(type: FamilyType): Record<string, unknown> {
  const message = `${type} happened clearly.`;
  switch (type) {
    case "mating_initiated":
      return { message, initiator_id: "initiator", target_id: "target", resources: { energy: 12, materials: 3 }, proposal_timestamp: 5, initiator_energy: 28, initiator_materials: 2 };
    case "mating_rejected":
      return { message, rejecter_id: "rejecter", initiator_id: "initiator", target_id: "rejecter", resources_refunded: { energy: 12, materials: 3 } };
    case "mating_proposal_invalidated":
      return { message, initiator_id: "initiator", target_id: "target", reason: "initiator_ineligible", resources_refunded: { energy: 12, materials: 3 } };
    case "mating_proposal_timeout":
      return { message, initiator_id: "initiator", target_id: "target", reason: "timeout", resources_refunded: { energy: 12, materials: 3 } };
    case "attack":
      return { message, attacker_id: "attacker", victim_id: "victim", region: "spring", damage: 30, attack_energy_cost: 8, attacker_energy: 32, victim_energy: 10 };
  }
}

function event(
  cursor: number,
  type: PresentedEventType,
  payload: Record<string, unknown>,
  resolved: Readonly<Record<string, string>> = {},
): EventEnvelopeEntry {
  return {
    cursor,
    event: {
      type,
      source: type === "attack" ? "attacker" : "initiator",
      payload,
      scope: type.startsWith("mating_") ? "targeted" : "local",
      region: type === "attack" ? "spring" : null,
      target: type === "attack" ? "victim" : "target",
      timestamp: cursor * 10,
    },
    resolved,
    snapshot_after: null,
  };
}

function agent(id: string, position: string): AgentSnapshot {
  return {
    id, name: id, persona: `${id} persona`, position, energy: 40, materials: 5,
    status: "alive", last_mated_at: null, offspring_count: 0, died_at: null,
    home_id: null, is_hoarding: false,
  };
}

function frame(agents: readonly AgentSnapshot[]): PresentedObserverFrame {
  const regions: readonly RegionSnapshot[] = [region("spring", ["ridge"]), region("ridge", [])];
  return {
    runId: "family-b-run", sourceKey: "fixture:family-b-run", revision: 2,
    firstCursor: 0, lastCursor: 2, source: "fixture", ingestedCursor: 2, presentedCursor: 0,
    world: {
      exactBaseCursor: 0, projectedThroughCursor: 0, worldTime: 0,
      agents: agents.map((value) => ({ completeness: "exact", value })),
      regions: regions.map((value) => ({ completeness: "exact", value })),
      homes: [], ruins: [], pendingProposals: [],
    },
    scene: null, selection: null,
    backlog: { pendingMoments: 1, firstPendingCursor: 1, lastPendingCursor: 2, state: "behind", label: "1 moment" },
    transport: { connection: "live", ingestedCursor: 2, retryable: true },
  };
}

function region(name: string, connections: readonly string[]): RegionSnapshot {
  return {
    name, description: name, connections: [...connections], energy_rate: 1, materials_rate: 1,
    current_energy: 100, current_materials: 100, max_energy: 100, max_materials: 100,
  };
}

function placement(agents: readonly AgentSnapshot[]): PlacementLedgerSnapshot {
  const points: Record<string, Readonly<{ x: number; y: number }>> = {
    initiator: tileCenter({ column: 2, row: 3 }),
    rejecter: tileCenter({ column: 4, row: 3 }),
    target: tileCenter({ column: 4, row: 3 }),
    attacker: tileCenter({ column: 2, row: 3 }),
    victim: tileCenter({ column: 4, row: 3 }),
  };
  return {
    revision: 1,
    agents: new Map(agents.map((value) => [value.id, {
      regionId: value.position, point: points[value.id]!, anchorKind: "staging",
    }])),
    homes: new Map(), districtsByRegion: new Map(),
  };
}

function withAgentPoint<T extends FamilyType>(
  context: ChoreographyContext<T>,
  actorId: string,
  point: Readonly<{ x: number; y: number }>,
): ChoreographyContext<T> {
  const agents = new Map(context.placement.agents);
  const retained = agents.get(actorId);
  if (retained === undefined) throw new Error(`missing placement for ${actorId}`);
  agents.set(actorId, { ...retained, point: { ...point } });
  return {
    ...context,
    placement: { ...context.placement, agents },
  };
}

function identity(frameValue: PresentedObserverFrame) {
  return {
    runId: frameValue.runId, sourceKey: frameValue.sourceKey, revision: frameValue.revision,
    firstCursor: frameValue.firstCursor, lastCursor: frameValue.lastCursor,
  };
}

function kinds(plan: ChoreographyPlan): readonly ActorVisualIntent["kind"][] {
  return plan.phases.flatMap((phase) => phase.actorIntents).map((intent) => intent.kind);
}

function distance(left: Readonly<{ x: number; y: number }>, right: Readonly<{ x: number; y: number }>): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function tacticalRecipe(regionId: "spring" | "ridge"): RegionMapRecipeV1 {
  const base = recipeFor(regionId);
  const collision = new Uint8Array(8 * 8);
  collision[3 * 8 + 3] = 1;
  return Object.freeze({
    ...base,
    grid: Object.freeze({ columns: 8, rows: 8, collision }),
  });
}

function recipeFor(regionId: "spring" | "ridge"): RegionMapRecipeV1 {
  const regions = [region("spring", ["ridge"]), region("ridge", [])];
  const regionValue = regions.find((candidate) => candidate.name === regionId)!;
  return createRegionMapRecipe(createRegionMapIdentity(29, regionValue, regions));
}

function expectLegalCardinalRoute(
  recipe: RegionMapRecipeV1,
  waypoints: readonly Readonly<{ x: number; y: number }>[],
): void {
  for (const point of waypoints) expect(pointIsOpen(recipe, point)).toBe(true);
  for (let index = 1; index < waypoints.length; index += 1) {
    const dx = Math.abs(waypoints[index]!.x - waypoints[index - 1]!.x);
    const dy = Math.abs(waypoints[index]!.y - waypoints[index - 1]!.y);
    expect((dx === TILE_SIZE && dy === 0) || (dx === 0 && dy === TILE_SIZE)).toBe(true);
  }
}

function expectInitialConnectorThenLegalRoute(
  recipe: RegionMapRecipeV1,
  waypoints: readonly Readonly<{ x: number; y: number }>[],
  exactStart: Readonly<{ x: number; y: number }>,
): void {
  expect(waypoints[0]).toEqual(exactStart);
  expect(waypoints.length).toBeGreaterThanOrEqual(2);
  const gridStart = waypoints[1]!;
  expect(pointIsOpen(recipe, exactStart)).toBe(true);
  expect(pointIsOpen(recipe, gridStart)).toBe(true);
  expect(Math.floor(gridStart.x / TILE_SIZE)).toBe(Math.floor(exactStart.x / TILE_SIZE));
  expect(Math.floor(gridStart.y / TILE_SIZE)).toBe(Math.floor(exactStart.y / TILE_SIZE));
  expect(distance(exactStart, gridStart)).toBeLessThan(TILE_SIZE / Math.SQRT2);
  expectLegalCardinalRoute(recipe, waypoints.slice(1));
}

function pointIsOpen(recipe: RegionMapRecipeV1, point: Readonly<{ x: number; y: number }>): boolean {
  const column = Math.floor(point.x / TILE_SIZE);
  const row = Math.floor(point.y / TILE_SIZE);
  return column >= 0 && column < recipe.grid.columns
    && row >= 0 && row < recipe.grid.rows
    && recipe.grid.collision[row * recipe.grid.columns + column] === 0;
}

function straightLineCrossesCollision(
  recipe: RegionMapRecipeV1,
  start: Readonly<{ x: number; y: number }>,
  end: Readonly<{ x: number; y: number }>,
): boolean {
  const steps = Math.ceil(distance(start, end) / 2);
  for (let index = 0; index <= steps; index += 1) {
    const ratio = steps === 0 ? 0 : index / steps;
    const point = {
      x: start.x + (end.x - start.x) * ratio,
      y: start.y + (end.y - start.y) * ratio,
    };
    if (!pointIsOpen(recipe, point)) return true;
  }
  return false;
}

function layeredActor(id: string, position: Readonly<{ x: number; y: number }>, facing: Direction4): LayeredHumanActor {
  const leases = new Map(
    Object.values(PRODUCTION_ASSET_MANIFEST.atlases)
      .filter(({ group }) => group === "core")
      .map(({ id: atlasId }) => [atlasId, {
        value: {} as ImageBitmap,
        release: () => undefined,
      } satisfies ProductionAssetLease]),
  );
  return new LayeredHumanActor({
    id,
    name: id,
    persona: `${id} family B motion test`,
    position,
    facing,
    manifest: PRODUCTION_ASSET_MANIFEST,
    atlasLeases: leases,
  });
}

function contactFacingFor(intent: ActorVisualIntent): Direction4 {
  return intent.facing ?? "south";
}

function certifiedReachHandContactBudgetMs(facing: Direction4): number {
  const clip = requireHumanClip(PRODUCTION_ASSET_MANIFEST, "human-a", "reach-give", facing);
  const marker = clip.markers.find((candidate) => candidate.name === "hand-contact");
  if (marker === undefined) throw new Error("reach-give clip must declare hand-contact");
  const markerOffsetMs = clip.frames.slice(0, marker.frame)
    .reduce((total, frameValue) => total + frameValue.durationMs, 0);
  const certifiedSampleMs = 1_000 / 30;
  return Math.ceil(markerOffsetMs / certifiedSampleMs) * certifiedSampleMs;
}

function driveTo(
  actorValue: LayeredHumanActor,
  target: Readonly<{ x: number; y: number }>,
  hz: number,
  speed: number,
): Readonly<{
  positions: readonly Readonly<{ x: number; y: number }>[];
  nowMs: number;
  maximumSpeed: number;
}> {
  const stepMs = 1_000 / hz;
  const positions = [actorValue.snapshot().position];
  let nowMs = 0;
  let maximumSpeed = 0;
  for (let index = 0; index < hz * 10; index += 1) {
    nowMs += stepMs;
    actorValue.advance(stepMs / 1_000, nowMs);
    const current = actorValue.snapshot().position;
    maximumSpeed = Math.max(maximumSpeed, distance(positions.at(-1)!, current) / (stepMs / 1_000));
    positions.push(current);
    if (distance(current, target) <= Number.EPSILON) break;
  }
  return { positions, nowMs, maximumSpeed };
}

function driveToAt(
  actorValue: LayeredHumanActor,
  target: Readonly<{ x: number; y: number }>,
  hz: number,
  speed: number,
  startMs: number,
): Readonly<{
  positions: readonly Readonly<{ x: number; y: number }>[];
  nowMs: number;
  maximumSpeed: number;
}> {
  const stepMs = 1_000 / hz;
  const positions = [actorValue.snapshot().position];
  let nowMs = startMs;
  let maximumSpeed = 0;
  for (let index = 0; index < hz * 10; index += 1) {
    nowMs += stepMs;
    actorValue.advance(stepMs / 1_000, nowMs);
    const current = actorValue.snapshot().position;
    maximumSpeed = Math.max(maximumSpeed, distance(positions.at(-1)!, current) / (stepMs / 1_000));
    positions.push(current);
    if (distance(current, target) <= Number.EPSILON) break;
  }
  return { positions, nowMs, maximumSpeed };
}

function finalActorIntent(plan: ChoreographyPlan, actorId: string): ActorVisualIntent {
  for (const phase of [...plan.phases].reverse()) {
    const intent = [...phase.actorIntents].reverse().find((candidate) => candidate.actorId === actorId);
    if (intent !== undefined) return intent;
  }
  throw new Error(`missing final actor intent ${actorId}`);
}

function pointKey(point: Readonly<{ x: number; y: number }>): string {
  return `${point.x.toFixed(2)},${point.y.toFixed(2)}`;
}

function oppositeDirection(facing: Direction4): Direction4 {
  if (facing === "north") return "south";
  if (facing === "south") return "north";
  if (facing === "east") return "west";
  return "east";
}
