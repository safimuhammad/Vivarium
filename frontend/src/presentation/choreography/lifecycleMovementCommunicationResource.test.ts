import { describe, expect, it } from "vitest";

import type { AgentSnapshot, EventEnvelopeEntry, RegionSnapshot } from "../../app/schemas";
import { TILE_SIZE, tileCenter } from "../../renderer2d/map/regionMap";
import { LayeredHumanActor } from "../../renderer2d/production/actors/LayeredHumanActor";
import {
  PRODUCTION_ASSET_MANIFEST,
  type ProductionAssetLease,
} from "../../renderer2d/production/assets/productionManifest";
import { createRegionMapIdentity } from "../../renderer2d/production/maps/RegionMapIdentity";
import { createRegionMapRecipe } from "../../renderer2d/production/maps/RegionMapRecipe";
import {
  connectNavigationEndpoints,
  findNavigationPath,
} from "../../renderer2d/production/navigation/navigation";
import { stableHash } from "../../renderer2d/production/maps/directedTopology";
import {
  PlacementLedger,
  type PlacementLedgerSnapshot,
} from "../../renderer2d/production/placement/PlacementLedger";
import { BeatDirector, type StoryMoment } from "../BeatDirector";
import { routeDistancePx, WALK_MAX_DISTANCE_PX } from "./locomotionGate";
import type { ActorVisualIntent, PresentedObserverFrame } from "../contracts";
import {
  parsePresentedEvent,
  type PresentedEventType,
  type TypedPresentedEvent,
} from "../eventPayloads";
import { createSceneExecutor } from "./SceneExecutor";
import type { ChoreographyContext, ChoreographyPlan } from "./contracts";
import { getChronicleManifest, type ChronicleId } from "../fixtures/chronicleCatalog";
import { LIFECYCLE_MOVEMENT_COMMUNICATION_RESOURCE_DEFINITIONS } from "./lifecycleMovementCommunicationResource";
import { createProductionSceneCommandResolver } from "../../renderer2d/production/ProductionSceneCommandResolver";
import {
  bubbleTextLifetimeMs,
  TEXT_FADE_OUT_MS,
} from "../../renderer2d/production/environment/EnvironmentSystem";
import { spokenCharacterCount } from "../../shared/speechLifetime";

/**
 * A real median-length utterance: exactly 385 characters, the measured median
 * message length the 5-7s band saturates at (rounded to 400 in the curve).
 * This is the length the drift showed up at live.
 */
const MEDIAN_UTTERANCE = "I drift, content. The world outside is a distant, flickering memory; "
  + "here, in the sanctuary of the warm springs, there is only the rhythmic pulse "
  + "of our breathing. I am held by the presence of my companions, and by the "
  + "quiet that has settled over this place since the morning, and I find that I "
  + "want nothing else from the day than to stay exactly here and let it pass "
  + "over me unhurried";

const FAMILY_TYPES = Object.freeze([
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
] as const);

describe("Task 9 lifecycle, movement, communication, and resource choreography", () => {
  it("exports exactly twelve immutable real definitions in canonical family order", () => {
    expect(LIFECYCLE_MOVEMENT_COMMUNICATION_RESOURCE_DEFINITIONS.map((definition) => definition.eventType))
      .toEqual(FAMILY_TYPES);
    expect(Object.isFrozen(LIFECYCLE_MOVEMENT_COMMUNICATION_RESOURCE_DEFINITIONS)).toBe(true);
    for (const definition of LIFECYCLE_MOVEMENT_COMMUNICATION_RESOURCE_DEFINITIONS) {
      expect(definition.participants.length).toBeGreaterThan(0);
      expect(definition.requiredAnchors.length).toBeGreaterThan(0);
      expect(definition.contactMarker).not.toBe(definition.consequenceMarker);
      expect(definition.safeCancelMarkers.length).toBeGreaterThan(0);
      expect(definition.duration.minMs).toBeGreaterThan(0);
      expect(definition.duration.maxMs).toBeGreaterThanOrEqual(definition.duration.minMs);
    }
  });

  it.each(FAMILY_TYPES)("resolves %s to an executor-valid deterministic deep-immutable marker program", (type) => {
    const context = contextFor(type);
    const definition = definitionFor(type);
    const first = resolve(definition, context);
    const second = resolve(definition, context);

    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.phases)).toBe(true);
    expect(Object.isFrozen(first.markers)).toBe(true);
    expect(Object.isFrozen(first.participants)).toBe(true);
    expect(first.markers.filter((marker) => marker.role === "consequence")).toHaveLength(1);
    expect(first.markers.at(-1)).toMatchObject({ role: "settle", atMs: first.durationMs });
    expect(first.durationMs).toBeGreaterThanOrEqual(definition.duration.minMs);
    expect(first.durationMs).toBeLessThanOrEqual(definition.duration.maxMs);

    const executor = createSceneExecutor();
    expect(() => executor.start(
      { moment: context.moment, program: first },
      identity(context.frame),
    )).not.toThrow();
  });

  it.each(FAMILY_TYPES)("places %s markers on the phase starts they semantically commit", (type) => {
    const context = contextFor(type);
    const plan = resolve(definitionFor(type), context);
    const phaseStart = new Map(plan.phaseWindows.map(({ phase, startMs }) => [phase, startMs]));
    const markerFor = (role: ChoreographyPlan["markers"][number]["role"], occurrence = 0) => (
      plan.markers.filter((marker) => marker.role === role)[occurrence]
    );

    expect(markerFor("contact")?.atMs).toBe(phaseStart.get("hold"));
    expect(markerFor("consequence")?.atMs).toBe(phaseStart.get("consequence"));
    expect(markerFor("safe-cancel")?.atMs).toBe(phaseStart.get("recover"));
    expect(markerFor("safe-cancel", 1)?.atMs).toBe(plan.durationMs);
    expect(markerFor("settle")?.atMs).toBe(plan.durationMs);
  });

  it.each([false, true])(
    "places entered-region gate contact at destination hold before its consequence commit (reduced=%s)",
    (reducedMotion) => {
    const plan = resolve(
      definitionFor("agent_entered_region"),
      contextFor("agent_entered_region", reducedMotion),
    );
    const holdStart = plan.phaseWindows.find(({ phase }) => phase === "hold")?.startMs;
    const consequenceStart = plan.phaseWindows.find(({ phase }) => phase === "consequence")?.startMs;

    expect(plan.markers.find(({ role }) => role === "contact")).toMatchObject({
      atMs: holdStart,
      order: 0,
    });
    expect(plan.markers.find(({ role }) => role === "consequence")).toMatchObject({
      atMs: consequenceStart,
      order: 0,
    });
    expect(holdStart).toBeLessThan(consequenceStart!);
    },
  );

  it.each(FAMILY_TYPES)("keeps %s normal/reduced terminal endpoints and causal markers identical", (type) => {
    const normalContext = contextFor(type, false);
    const reducedContext = { ...normalContext, reducedMotion: true };
    const definition = definitionFor(type);
    const normal = resolve(definition, normalContext);
    const reduced = resolve(definition, reducedContext);

    expect(reduced.reducedMotionEndpoint).toEqual(normal.reducedMotionEndpoint);
    expect(reduced.participants).toEqual(normal.participants);
    expect(reduced.contactMarker).toBe(normal.contactMarker);
    expect(reduced.consequenceMarker).toBe(normal.consequenceMarker);
    expect(reduced.markers.map((marker) => [marker.name, marker.role]))
      .toEqual(normal.markers.map((marker) => [marker.name, marker.role]));
    expect(reduced.phases.every((phase) => phase.reducedMotion)).toBe(true);
  });

  it("uses payload victim/killer truth for lethal death and keeps the terminal victim dead", () => {
    const context = contextFor("agent_died");
    const plan = definitionFor("agent_died").resolve(context);

    expect(plan.participants).toEqual([
      { role: "victim", ids: ["victim"] },
      { role: "killer", ids: ["killer"] },
    ]);
    expect(plan.phases.find((phase) => phase.phase === "consequence")?.actorIntents)
      .toContainEqual(expect.objectContaining({ actorId: "victim", kind: "dead" }));
    expect(plan.phases.at(-1)?.actorIntents)
      .not.toContainEqual(expect.objectContaining({ actorId: "victim", kind: "recover" }));
  });

  it("distinguishes attack paralysis from breath paralysis without inventing an attacker", () => {
    const attack = definitionFor("agent_paralyzed").resolve(contextFor("agent_paralyzed"));
    const breath = definitionFor("agent_paralyzed").resolve(contextFor("agent_paralyzed", false, {
      payload: { trigger: "breath", attacker_id: undefined, victim_id: undefined },
    }));

    expect(attack.participants).toEqual([
      { role: "victim", ids: ["victim"] },
      { role: "killer", ids: ["killer"] },
    ]);
    expect(breath.participants).toEqual([{ role: "victim", ids: ["victim"] }]);
    expect(breath.phases.flatMap((phase) => phase.actorIntents).map((intent) => intent.actorId))
      .not.toContain("killer");
  });

  it("IMPACT: paralysis flashes a 'PARALYZED' status on the collapsing being, same word for an attack or a breath collapse, suppressed under reduced motion", () => {
    const attack = definitionFor("agent_paralyzed").resolve(contextFor("agent_paralyzed"));
    const breath = definitionFor("agent_paralyzed").resolve(contextFor("agent_paralyzed", false, {
      payload: { trigger: "breath", attacker_id: undefined, victim_id: undefined },
    }));
    const reduced = definitionFor("agent_paralyzed").resolve(contextFor("agent_paralyzed", true));

    expect(attack.phases.flatMap((phase) => phase.effectIntents)).toContainEqual({
      kind: "impact", sourceId: "victim", targetId: "killer", polarity: "status", label: "PARALYZED",
    });
    expect(breath.phases.flatMap((phase) => phase.effectIntents)).toContainEqual({
      kind: "impact", sourceId: "victim", targetId: null, polarity: "status", label: "PARALYZED",
    });
    expect(reduced.phases.flatMap((phase) => phase.effectIntents)).not.toContainEqual(
      expect.objectContaining({ kind: "impact" }),
    );
  });

  it("FLYING ITEM: agent_died sends looted resources from the victim to the killer only when something was actually looted and contact was physical", () => {
    const lethal = definitionFor("agent_died").resolve(contextFor("agent_died"));
    // Default fixture payload: looted_energy=4, looted_materials=2 -- energy is
    // the larger share, so that's the icon; both amounts appear in the label.
    expect(lethal.phases.flatMap((phase) => phase.effectIntents)).toContainEqual({
      kind: "flying-item", sourceId: "victim", targetId: "killer", icon: "energy", label: "+4e +2m",
    });

    const noLoot = definitionFor("agent_died").resolve(contextFor("agent_died", false, {
      payload: { looted_energy: 0, looted_materials: 0 },
    }));
    expect(noLoot.phases.flatMap((phase) => phase.effectIntents)).not.toContainEqual(
      expect.objectContaining({ kind: "flying-item" }),
    );
  });

  it("places birth in acceptor geography and keeps a remote initiator off the visible map", () => {
    const context = contextFor("agent_born");
    const plan = definitionFor("agent_born").resolve(context);

    expect(plan.regionId).toBe("spring");
    expect(plan.participants).toEqual([
      { role: "child", ids: ["child"] },
      { role: "acceptor", ids: ["acceptor"] },
      { role: "initiator", ids: ["initiator"] },
    ]);
    expect(plan.phases.slice(0, 2).flatMap((phase) => phase.actorIntents).map((intent) => intent.actorId))
      .not.toContain("child");
    expect(plan.phases.flatMap((phase) => phase.actorIntents).map((intent) => intent.actorId))
      .not.toContain("initiator");
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({ code: "remote-initiator-off-map" }));
  });

  it("treats an absent newborn as a causal consequence appearance without hiding a missing acceptor", () => {
    const exact = contextFor("agent_born");
    const withoutChild = {
      ...exact,
      frame: {
        ...exact.frame,
        world: {
          ...exact.frame.world,
          agents: exact.frame.world.agents.filter(({ value }) => value.id !== "child"),
        },
      },
      placement: {
        ...exact.placement,
        agents: new Map([...exact.placement.agents].filter(([id]) => id !== "child")),
      },
    };
    const birth = definitionFor("agent_born").resolve(withoutChild);
    const phases = Object.fromEntries(birth.phases.map((phase) => [phase.phase, phase]));

    expect(phases.enter?.focus).toEqual({ kind: "agent", id: "acceptor" });
    expect(phases.hold?.focus).toEqual({ kind: "agent", id: "acceptor" });
    for (const phase of ["consequence", "recover", "exit"] as const) {
      expect(phases[phase]?.focus).toEqual({ kind: "agent", id: "child" });
      expect(phases[phase]?.actorIntents).toContainEqual(expect.objectContaining({
        actorId: "child",
        kind: "idle",
      }));
    }
    expect(phases.enter?.actorIntents.map(({ actorId }) => actorId)).not.toContain("child");
    expect(phases.hold?.actorIntents.map(({ actorId }) => actorId)).not.toContain("child");
    expect(phases.consequence?.actorIntents).toContainEqual(expect.objectContaining({
      actorId: "child",
      marker: birth.consequenceMarker,
    }));
    expect(birth.diagnostics).not.toContainEqual(expect.objectContaining({
      code: "missing-required-participant",
      role: "child",
    }));

    const missingAcceptor = definitionFor("agent_born").resolve({
      ...withoutChild,
      frame: {
        ...withoutChild.frame,
        world: {
          ...withoutChild.frame.world,
          agents: withoutChild.frame.world.agents.filter(({ value }) => value.id !== "acceptor"),
        },
      },
    });
    expect(missingAcceptor.phases.every(({ focus }) => (
      focus.kind === "region" && focus.id === "spring"
    ))).toBe(true);
    expect(missingAcceptor.diagnostics).toContainEqual(expect.objectContaining({
      code: "missing-required-participant",
      role: "acceptor",
    }));
  });

  it("narrates a missing lifecycle participant at region scope and accepts later checkpoint correction", () => {
    const exact = contextFor("resource_changed");
    const missing = {
      ...exact,
      frame: { ...exact.frame, world: { ...exact.frame.world, agents: [] } },
    };
    const fallback = definitionFor("resource_changed").resolve(missing);
    const corrected = definitionFor("resource_changed").resolve(exact);

    expect(fallback.phases.every(({ focus }) => (
      focus.kind === "region" && focus.id === "spring"
    ))).toBe(true);
    expect(fallback.phases.flatMap(({ actorIntents }) => actorIntents)).toEqual([]);
    expect(fallback.diagnostics).toContainEqual(expect.objectContaining({
      code: "missing-required-participant",
      role: "actor",
    }));
    expect(corrected.phases[0]?.focus).toEqual({ kind: "agent", id: "harvester" });
    expect(corrected.phases.flatMap(({ actorIntents }) => actorIntents).length).toBeGreaterThan(0);
  });

  it("RED: resolves resource geometry from the exact shared recipe instead of reconstructing from runId", () => {
    const context = contextFor("resource_changed");
    const canonical = recipeFor("spring");
    const exactEnergyAnchor = canonical.socialAnchors[0]!;
    const exactRecipe = Object.freeze({
      ...canonical,
      resourceAnchors: Object.freeze({
        energy: Object.freeze([exactEnergyAnchor]),
        materials: canonical.resourceAnchors.materials,
      }),
    });
    const recipes = new Map([
      ["spring", exactRecipe],
      ["ridge", recipeFor("ridge")],
    ]);
    const plan = definitionFor("resource_changed").resolve({
      ...context,
      recipes,
    } as never);
    const target = plan.phases
      .flatMap((phase) => phase.actorIntents)
      .find((intent) => intent.kind === "gather")?.target;

    expect(target).toEqual(tileCenter(exactEnergyAnchor));
  });

  it("renders one travel chain with exact directed atlas identities and leaves standalone halves truthful", () => {
    const paired = contextFor("agent_entered_region", false, { chain: "travel" });
    const journey = definitionFor("agent_entered_region").resolve(paired);
    const departure = definitionFor("agent_left_region").resolve(contextFor("agent_left_region"));

    expect(journey.regionId).toBe("ridge");
    expect(journey.phases.flatMap((phase) => phase.effectIntents)).toContainEqual({
      kind: "atlas-transition",
      sourceId: "spring",
      targetId: "ridge",
    });
    expect(journey.phases.flatMap((phase) => phase.actorIntents)
      .filter((intent) => intent.kind === "move")
      .every((intent) => intent.waypoints !== undefined && intent.waypoints.length > 1))
      .toBe(true);
    expect(journey.phases.flatMap((phase) => phase.actorIntents).every((intent) => intent.actorId === "traveler"))
      .toBe(true);
    expect(departure.regionId).toBe("spring");
    const departureMove = departure.phases.flatMap((phase) => phase.actorIntents)
      .find((intent) => intent.kind === "move");
    expect(departureMove?.target).toEqual(departureMove?.waypoints?.at(-1));
  });

  it("rejects an undeclared reverse edge instead of selecting another gate or teleporting", () => {
    const context = contextFor("agent_entered_region", false, {
      payload: { from_region: "ridge", to_region: "spring" },
    });
    const plan = definitionFor("agent_entered_region").resolve(context);

    expect(plan.diagnostics).toContainEqual(expect.objectContaining({ code: "unauthorized-directed-edge" }));
    expect(plan.phases.flatMap((phase) => phase.effectIntents)).not.toContainEqual(
      expect.objectContaining({ kind: "atlas-transition" }),
    );
    expect(plan.phases.flatMap((phase) => phase.actorIntents).some((intent) => intent.kind === "move"))
      .toBe(false);
  });

  it("animates only a local speaker and uses remote portraits without teleporting either endpoint", () => {
    const local = definitionFor("speak").resolve(contextFor("speak", false, {
      payload: { target_id: null },
    }));
    const remote = definitionFor("speak").resolve(contextFor("speak"));

    expect(new Set(local.phases.flatMap((phase) => phase.actorIntents).map((intent) => intent.actorId)))
      .toEqual(new Set(["speaker"]));
    expect(remote.phases.flatMap((phase) => phase.effectIntents)).toContainEqual({
      kind: "portrait",
      sourceId: "speaker",
      targetId: "listener",
    });
    expect(remote.phases.flatMap((phase) => phase.effectIntents)).toContainEqual({
      kind: "atlas-transition",
      sourceId: "spring",
      targetId: "ridge",
    });
    expect(remote.phases.flatMap((phase) => phase.actorIntents).map((intent) => intent.actorId))
      .not.toContain("listener");
  });

  it("renders a real speech bubble carrying the actual words at the speaker, local or remote, and it is NOT suppressed by reduced motion", () => {
    // Overlay contract: reduced motion means no ANIMATION, not less time (or no
    // chance at all) to read the words -- unlike the old one-shot speech-arc
    // ripple, which reduced motion suppressed outright.
    const local = definitionFor("speak").resolve(contextFor("speak", false, {
      payload: { target_id: null },
    }));
    const remote = definitionFor("speak").resolve(contextFor("speak"));
    const reduced = definitionFor("speak").resolve(contextFor("speak", true, {
      payload: { target_id: null },
    }));

    expect(local.phases.flatMap((phase) => phase.effectIntents)).toContainEqual({
      kind: "speech-bubble",
      sourceId: "speaker",
      targetId: null,
      text: "speak happened clearly.",
      variant: "spoken",
    });
    expect(remote.phases.flatMap((phase) => phase.effectIntents)).toContainEqual({
      kind: "speech-bubble",
      sourceId: "speaker",
      targetId: "listener",
      text: "speak happened clearly.",
      variant: "spoken",
    });
    expect(reduced.phases.flatMap((phase) => phase.effectIntents)).toContainEqual(
      expect.objectContaining({ kind: "speech-bubble", variant: "spoken" }),
    );
  });

  it("a same-region targeted whisper renders the distinct 'whisper' bubble variant and the listener turns to face the speaker", () => {
    // "killer" is alive and co-located with "speaker" in "spring" -- a genuine
    // same-region whisper, distinct from both the public (target null) and
    // cross-region ("listener" @ "ridge") cases already covered above.
    const whisper = definitionFor("speak").resolve(contextFor("speak", false, {
      payload: { target_id: "killer" },
    }));

    expect(whisper.phases.flatMap((phase) => phase.effectIntents)).toContainEqual({
      kind: "speech-bubble",
      sourceId: "speaker",
      targetId: "killer",
      text: "speak happened clearly.",
      variant: "whisper",
    });
    expect(whisper.phases.flatMap((phase) => phase.effectIntents)).not.toContainEqual(
      expect.objectContaining({ kind: "portrait" }),
    );

    // Bidirectional facing: the listener's own "orient" now carries a real
    // target point (the speaker's), matching resource_transferred/attack -- not
    // the pre-repair `orient(null)` that resolved to zero facing commands.
    const listenerOrient = whisper.phases.flatMap((phase) => phase.actorIntents)
      .find((intent) => intent.actorId === "killer" && intent.kind === "orient");
    expect(listenerOrient?.target).not.toBeNull();
  });

  it("APPROACH: a same-region targeted speaker physically walks to the listener instead of only turning across the gap", () => {
    // "speaker" and "killer" are hashed to distinct staging anchors (>1 tile
    // apart, same invariant resource_transferred's own G1 repair test relies
    // on) -- before this repair, speak only ever authored an "orient" for the
    // speaker, so the two independently-staged endpoints never actually
    // closed the gap between them.
    const context = contextFor("speak", false, { payload: { target_id: "killer" } });
    const speakerPlacement = context.placement.agents.get("speaker")!;
    const listenerPlacement = context.placement.agents.get("killer")!;
    expect(distance(speakerPlacement.point, listenerPlacement.point)).toBeGreaterThan(TILE_SIZE);

    const plan = definitionFor("speak").resolve(context);
    const actorIntents = plan.phases.flatMap((phase) => phase.actorIntents);
    const speakerMove = actorIntents.find((intent) => intent.actorId === "speaker" && intent.kind === "move");

    expect(speakerMove).toBeDefined();
    expect(speakerMove?.waypoints?.length ?? 0).toBeGreaterThan(1);
    expect(speakerMove?.waypoints?.at(-1)).not.toEqual(speakerPlacement.point);
    expect(plan.diagnostics).not.toContainEqual(expect.objectContaining({ code: "speech-contact-fallback" }));
  });

  it("APPROACH: an untargeted broadcast speaker never gains a move -- there is no listener to walk toward", () => {
    const context = contextFor("speak", false, { payload: { target_id: null } });
    const plan = definitionFor("speak").resolve(context);

    expect(plan.phases.flatMap((phase) => phase.actorIntents).some((intent) => intent.kind === "move")).toBe(false);
  });

  // ---------------------------------------------------------------------------
  // DRIFT GUARD: the scene clock and the bubble clock are ONE clock.
  //
  // These two durations have now drifted apart twice -- once when the bubble was
  // floored at the scene length, and again when `dfba968` cut the bubble to the
  // owner's hard 5-7s band and left the scene on its old `clamp(3000 + 80 x
  // chars, 3000, 14000)` curve. At the measured median (385 chars) that gave a
  // 14_000 ms scene against a 6_925 ms bubble: the being stood there for the
  // last 7_075 ms -- more than half its own moment -- with nothing above its
  // head. Safi's decision (2026-08-26) was to bring the SCENE down to the
  // BUBBLE. These tests are what make the third drift impossible: they call the
  // renderer's REAL exported bubble rule, so a change to either formula fails
  // here rather than showing up live months later.
  // ---------------------------------------------------------------------------

  it.each([
    // chars -> the one duration BOTH clocks produce, beside what the RETIRED
    // 3-14s scene curve, `clamp(3000 + 80 x chars, 3000, 14000)`, used to give.
    { chars: 3, message: "Hm.", expectedMs: 5_015, retiredSceneMs: 3_240 },
    { chars: 40, message: "a".repeat(40), expectedMs: 5_200, retiredSceneMs: 6_200 },
    { chars: 385, message: MEDIAN_UTTERANCE, expectedMs: 6_925, retiredSceneMs: 14_000 },
    { chars: 400, message: "a".repeat(400), expectedMs: 7_000, retiredSceneMs: 14_000 },
    { chars: 1_153, message: "a".repeat(1_153), expectedMs: 7_000, retiredSceneMs: 14_000 },
  ])(
    "a speech scene ends when its words do: $chars chars -> $expectedMs ms, not the retired $retiredSceneMs ms",
    ({ chars, message, expectedMs, retiredSceneMs }) => {
      expect(spokenCharacterCount(message)).toBe(chars);
      // The pinned value IS the bubble's own rule, evaluated by the renderer.
      expect(bubbleTextLifetimeMs(chars, false)).toBe(expectedMs);
      // ... and the retired curve, kept as arithmetic so the size of the gap
      // that was closed stays legible.
      expect(Math.min(14_000, Math.max(3_000, 3_000 + message.length * 80))).toBe(retiredSceneMs);

      // An UNTARGETED broadcast has no approach walk, so `routeAwareTiming`
      // leaves the base duration alone and the scene is exactly the curve.
      const spoken = definitionFor("speak").resolve(
        contextFor("speak", false, { payload: { message, target_id: null } }),
      );
      expect(spoken.durationMs).toBe(expectedMs);

      // self_talk is deliberately NOT diverged: a private thought is carried by
      // the same bubble through the same rule, so a separate curve would simply
      // recreate this drift for thoughts. Nothing walks, so it is exact too.
      const thought = definitionFor("self_talk").resolve(
        contextFor("self_talk", false, { payload: { message } }),
      );
      expect(thought.durationMs).toBe(expectedMs);
    },
  );

  it("keeps the scene out of the bubble's reduced-motion carve-out, deliberately", () => {
    // Reduced motion stretches the BUBBLE by 1.3 (6.5-9.1s). That is an
    // accessibility contract on the reading surface -- less animation, never
    // less information -- not a property of the utterance, and it is the benign
    // direction: words outliving the moment was never the failure. The scene
    // does not follow, so `speechDuration` stays context-free and no
    // reduced-motion capture budget moves.
    const message = MEDIAN_UTTERANCE;
    const chars = spokenCharacterCount(message);
    expect(bubbleTextLifetimeMs(chars, true)).toBe(9_003);
    expect(bubbleTextLifetimeMs(chars, true)).toBeGreaterThan(bubbleTextLifetimeMs(chars, false));

    for (const reducedMotion of [false, true]) {
      expect(definitionFor("speak").resolve(
        contextFor("speak", reducedMotion, { payload: { message, target_id: null } }),
      ).durationMs).toBe(6_925);
      expect(definitionFor("self_talk").resolve(
        contextFor("self_talk", reducedMotion, { payload: { message } }),
      ).durationMs).toBe(6_925);
    }
  });

  it("keeps the 5s floor above the smallest scene its own phases can carry", () => {
    // The old floor was 3_000. The bubble band raises it to 5_000, and there is
    // no per-phase absolute minimum to collide with: `phaseBoundaries` is purely
    // proportional (18/24/16/24/18%), and `routeAwareTiming` only ever STRETCHES
    // enter/consequence to cover a real walk. So the real floor is 5_000 ms
    // (5_005 for the shortest utterance that is not literally empty), which buys
    // 900/1_202/800/1_202/901 ms -- every phase wider than the 400 ms bubble
    // fade and the 180 ms actor vanish/appear it has to contain.
    const definition = definitionFor("speak");
    expect(definition.duration.minMs).toBe(5_000);
    expect(definitionFor("self_talk").duration).toEqual({ minMs: 5_000, maxMs: 7_000 });

    const plan = definition.resolve(
      contextFor("speak", false, { payload: { message: ".", target_id: null } }),
    );
    expect(plan.durationMs).toBe(5_005);
    const spans = plan.phaseWindows.map(({ endMs, startMs }) => endMs - startMs);
    expect(spans).toEqual([900, 1_202, 800, 1_202, 901]);
    expect(Math.min(...spans)).toBeGreaterThan(TEXT_FADE_OUT_MS);
  });

  it("BUBBLE-FIX: bakes private-thought dialogue into the plan regardless of selection at resolve() time", () => {
    // resolve() runs exactly once, at the moment the story dequeues this moment
    // (StoryDirector.startNextIfIdle) -- which can happen before a viewer ever
    // selects the thinker (autoplay racing ahead, or a selection made mid-moment).
    // Gating dialogue on `selected`-at-resolve-time froze "hidden" into the plan
    // forever; nothing re-resolves an already-active moment, so a later selection
    // could never revive it. Privacy is enforced live downstream instead:
    // `isMomentVisible` (presentation/selectors.ts) already gates the dialogue
    // TEXT this way for every consumer -- this proves the plan no longer starves
    // that live gate by omitting the data before it even reaches it. The
    // "private-thought-gated" diagnostic is retained as an honest, informational
    // note that this particular resolve() snapshot was not yet selected.
    const hidden = definitionFor("self_talk").resolve(contextFor("self_talk"));
    const visibleContext = contextFor("self_talk");
    const visible = definitionFor("self_talk").resolve({
      ...visibleContext,
      frame: { ...visibleContext.frame, selection: { kind: "agent", id: "thinker" } },
    });

    expect(hidden.phases.some((phase) => phase.dialogue !== null)).toBe(true);
    expect(hidden.diagnostics).toContainEqual(expect.objectContaining({ code: "private-thought-gated" }));
    expect(visible.phases.some((phase) => phase.dialogue !== null)).toBe(true);
    expect(visible.phases.flatMap((phase) => phase.actorIntents).map((intent) => intent.actorId))
      .toEqual(expect.arrayContaining(["thinker"]));
  });

  it("BUBBLE-FIX: bakes the 'thought' speech-bubble effect intent into the plan regardless of selection at resolve() time, NOT suppressed under reduced motion", () => {
    const hidden = definitionFor("self_talk").resolve(contextFor("self_talk"));
    const visible = definitionFor("self_talk").resolve({
      ...contextFor("self_talk"),
      frame: { ...contextFor("self_talk").frame, selection: { kind: "agent", id: "thinker" } },
    });
    const reduced = definitionFor("self_talk").resolve(contextFor("self_talk", true));

    const bubble = {
      kind: "speech-bubble",
      sourceId: "thinker",
      targetId: null,
      text: "self_talk happened clearly.",
      variant: "thought",
    };
    expect(hidden.phases.flatMap((phase) => phase.effectIntents)).toContainEqual(bubble);
    expect(visible.phases.flatMap((phase) => phase.effectIntents)).toContainEqual(bubble);
    // Privacy is enforced live downstream (effectCommands' selection gate), not by
    // omitting the intent at plan time -- reduced motion must never be conflated
    // with the privacy gate. The bubble stays in the plan either way.
    expect(reduced.phases.flatMap((phase) => phase.effectIntents)).toContainEqual(bubble);
  });

  it("SELF_TALK RENDERS OPENLY: a baked thought draws for every viewer, selected or not", () => {
    // OWNER DECISION (Safi, 2026-07-25) -- recorded in .superpowers/sdd/progress.md
    // ("SELF_TALK RENDERS OPENLY") and docs/frontend/BUBBLE_UI.md §11.1.
    //
    // This test previously asserted the opposite: that the thought bubble stayed
    // hidden until the viewer selected the thinker. That draw-time selection gate
    // (added by the bubble-fix task, in ProductionSceneCommandResolver's
    // effectCommands) has been REVERSED on purpose. `ScopeType.PRIVATE` means
    // other BEINGS do not perceive a thought -- self_talk is never routed to
    // another agent's inbox -- and the viewer is not a being. Simulation privacy
    // is untouched; viewer visibility is granted, and the thought silhouette
    // (dashed cloud, 88% opacity, narrowest line budget) is what keeps a private
    // thought quiet rather than hidden.
    //
    // Do NOT restore the gate here as a regression fix. The MECHANISM the
    // bubble-fix task proved -- gate live, per resolver call, never inside the
    // choreography plan's one-shot resolve() -- remains correct and is still
    // available for any future kind that genuinely must stay hidden. It is the
    // POLICY, not the mechanism, that the owner reversed.
    const context = contextFor("self_talk");
    const plan = definitionFor("self_talk").resolve(context);
    const hold = plan.phases.find(({ phase }) => phase === "hold")!;
    const resolver = createProductionSceneCommandResolver({
      getPlacement: () => context.placement,
    });
    const sceneFor = (selection: PresentedObserverFrame["selection"], revision: number) => resolver({
      ...context.frame,
      revision: context.frame.revision + revision,
      selection,
      scene: { ...hold, execution: { sceneToken: 801, programId: plan.id } },
    });

    const isThoughtBubble = (command: { kind: string; request?: { kind: string; variant?: string } }): boolean => (
      command.kind === "environment" && command.request?.kind === "speech-bubble" && command.request.variant === "thought"
    );

    const beforeSelection = sceneFor(null, 1);
    expect(beforeSelection?.commands.some(isThoughtBubble)).toBe(true);

    const wrongSelection = sceneFor({ kind: "agent", id: "someone-else" }, 2);
    expect(wrongSelection?.commands.some(isThoughtBubble)).toBe(true);

    const afterLateSelection = sceneFor({ kind: "agent", id: "thinker" }, 3);
    expect(afterLateSelection?.commands).toContainEqual(expect.objectContaining({
      kind: "environment",
      request: expect.objectContaining({ kind: "speech-bubble", variant: "thought" }),
    }));
  });

  it("G1 repair: resolves self_talk's region from the thinker's own presented position, selected or not", () => {
    // self_talk's payload has no region field at all (unlike every other event in
    // this family) -- a prior hardcoded `regionId: null` stranded the camera on
    // the region-less "Between Moments" placeholder for every self_talk moment.
    const hidden = definitionFor("self_talk").resolve(contextFor("self_talk"));
    const visibleContext = contextFor("self_talk");
    const visible = definitionFor("self_talk").resolve({
      ...visibleContext,
      frame: { ...visibleContext.frame, selection: { kind: "agent", id: "thinker" } },
    });

    expect(hidden.regionId).toBe("spring");
    expect(visible.regionId).toBe("spring");
    expect(hidden.phases.every((phase) => phase.regionId === "spring")).toBe(true);
    expect(hidden.diagnostics).not.toContainEqual(expect.objectContaining({ code: "self-talk-region-unknown" }));
  });

  it("G1 repair: falls back to a null region with an honest diagnostic when the thinker is not presented", () => {
    const base = contextFor("self_talk");
    const context = {
      ...base,
      frame: {
        ...base.frame,
        world: {
          ...base.frame.world,
          agents: base.frame.world.agents.filter(({ value }) => value.id !== "thinker"),
        },
      },
    };
    const plan = definitionFor("self_talk").resolve(context);

    expect(plan.regionId).toBeNull();
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({ code: "self-talk-region-unknown" }));
  });

  it("declares the real resource patch, does not invent its coordinate, and chooses its real prop", () => {
    const energy = definitionFor("resource_changed").resolve(contextFor("resource_changed"));
    const materials = definitionFor("resource_changed").resolve(contextFor("resource_changed", false, {
      payload: { resource_type: "materials" },
    }));

    expect(definitionFor("resource_changed").requiredAnchors).toContain("resource-energy");
    expect(energy.phases.flatMap((phase) => phase.actorIntents)
      .filter((intent) => intent.kind === "move" || intent.kind === "fade-reposition"))
      .toHaveLength(1);
    const energyTarget = relocation(energy)?.target;
    const materialsTarget = relocation(materials)?.target;
    const recipe = recipeFor("spring");
    expect(recipe.resourceAnchors.energy.map(tileCenter)).toContainEqual(energyTarget);
    expect(recipe.resourceAnchors.materials.map(tileCenter)).toContainEqual(materialsTarget);
  });

  it("routes to the nearest EXISTING resource anchor under compactResourceRouting, not the canonical hash pick", () => {
    const canonicalContext = contextFor("resource_changed");
    const compactContext = { ...canonicalContext, compactResourceRouting: true };
    const recipe = recipeFor("spring");
    const actorPlacement = canonicalContext.placement.agents.get(canonicalContext.event.payload.agent_id)!;

    // Independent oracle: the literal nearest anchor to the actor's own placement.
    const expectedNearest = [...recipe.resourceAnchors.energy].sort((left, right) => (
      Math.hypot(tileCenter(left).x - actorPlacement.point.x, tileCenter(left).y - actorPlacement.point.y)
      - Math.hypot(tileCenter(right).x - actorPlacement.point.x, tileCenter(right).y - actorPlacement.point.y)
    ))[0]!;
    // This recipe must have more than one district-worth of energy anchors for
    // this test to actually prove anything (otherwise "nearest" and "canonical
    // hash pick" would trivially coincide).
    expect(recipe.resourceAnchors.energy.length).toBeGreaterThan(1);

    const canonicalPlan = definitionFor("resource_changed").resolve(canonicalContext);
    const compactPlan = definitionFor("resource_changed").resolve(compactContext as never);
    const canonicalTarget = relocation(canonicalPlan)?.target;
    const compactTarget = relocation(compactPlan)?.target;

    expect(compactTarget).toEqual(tileCenter(expectedNearest));
    // The canonical (non-compact) pick is untouched -- proving this is a
    // routing-time branch, not a change to the underlying recipe/hash formula.
    const canonicalAnchorIndex = stableHash(`${canonicalContext.event.payload.agent_id}:energy`)
      % recipe.resourceAnchors.energy.length;
    expect(canonicalTarget).toEqual(tileCenter(recipe.resourceAnchors.energy[canonicalAnchorIndex]!));
  });

  it("leaves compactResourceRouting off by default (canonical context omits the field)", () => {
    const context = contextFor("resource_changed");
    expect(context.compactResourceRouting).toBe(false);
  });

  it.each([false, true])(
    "G1 repair (F2): a far same-region transfer now closes the distance to the receiver and plays a real handoff (reduced=%s)",
    (reducedMotion) => {
    // This reproduces the exact live C03 chronicle scenario: the giver harvested
    // first (G3's `gather` route leaves them far across the map from the
    // receiver's untouched staging point). Before this repair,
    // `withinPhysicalHandoffRange`'s static 32px-tile check was the *only* notion
    // of "close enough", and `PlacementLedger.stagingPlacement` hashes every
    // agent to a staging anchor at least 71px from its neighbors -- so this exact
    // shape (a real post-harvest transfer) could never satisfy it, and the
    // transfer mote (F2) never appeared live despite Task 6 having wired it.
    const context = c03TransferContext(reducedMotion);
    const senderId = context.event.payload.sender_id;
    const receiverId = context.event.payload.receiver_id;
    const senderPlacement = context.placement.agents.get(senderId)!;
    const receiverPlacement = context.placement.agents.get(receiverId)!;
    const plan = definitionFor("resource_transferred").resolve(context);

    expect(senderPlacement).toMatchObject({
      regionId: "warm_springs",
      point: { x: 1_936, y: 176 },
    });
    expect(receiverPlacement).toMatchObject({
      regionId: "warm_springs",
      point: { x: 304, y: 112 },
    });
    expect(distance(senderPlacement.point, receiverPlacement.point)).toBeGreaterThan(1_600);
    expect(plan.phases.every(({ focus }) => (
      focus?.kind === "agent" && focus.id === senderId
    ))).toBe(true);
    expect(plan.diagnostics).not.toContainEqual(expect.objectContaining({ code: "transfer-contact-fallback" }));

    const actorIntents = plan.phases.flatMap(({ actorIntents: intents }) => intents);
    expect(actorIntents.some(({ kind }) => kind === "reach")).toBe(true);
    // 1,632px apart is far past any walk that reads as one, so the giver now
    // CUTS to the receiver rather than trudging the width of Warm Springs. What
    // G1/F2 repaired — that the two are brought into real physical contact and
    // a real handoff plays — is unchanged and asserted throughout the rest.
    expect(distance(senderPlacement.point, receiverPlacement.point))
      .toBeGreaterThan(WALK_MAX_DISTANCE_PX);
    expect(actorIntents.some(({ kind }) => kind === "fade-reposition")).toBe(true);

    const hold = plan.phases.find(({ phase }) => phase === "hold")!;
    const consequence = plan.phases.find(({ phase }) => phase === "consequence")!;
    for (const phase of [hold, consequence]) {
      expect(phase.dialogue).toMatchObject({
        speakerId: senderId,
        speakerName: "Joe",
        text: "Joe gave 1 material to Mae.",
        hold: true,
      });
    }
    // The FLYING ITEM (F2, now superseding the old particle mote): present
    // under full motion, suppressed under reduced motion, matching every
    // other head/flight effect in this family.
    if (reducedMotion) {
      expect(hold.effectIntents).toEqual([]);
    } else {
      expect(hold.effectIntents).toContainEqual({
        kind: "flying-item",
        sourceId: senderId,
        targetId: receiverId,
        icon: "materials",
        label: "+1",
      });
    }

    const resolver = createProductionSceneCommandResolver({
      getPlacement: () => context.placement,
    });
    const enter = plan.phases.find(({ phase }) => phase === "enter")!;
    let sawApproach = false;
    let sawReachGive = false;
    for (const [index, phase] of [enter, hold, consequence].entries()) {
      const batch = resolver({
        ...context.frame,
        revision: context.frame.revision + index + 1,
        scene: {
          ...phase,
          execution: { sceneToken: 701, programId: plan.id },
        },
      });
      if (batch?.commands.some((command) => command.kind === "actor" && (
        command.command.kind === "move" || command.command.kind === "reposition"
      ))) sawApproach = true;
      if (batch?.commands.some((command) => command.kind === "actor" && (
        command.command.kind === "play-body" && command.command.action === "reach-give"
      ))) sawReachGive = true;
    }
    expect(sawApproach).toBe(true);
    expect(sawReachGive).toBe(true);
    },
  );

  it("RED C03 repair: preserves a physical handoff for genuinely near same-region endpoints", () => {
    const farContext = c03TransferContext(false);
    const senderId = farContext.event.payload.sender_id;
    const receiverId = farContext.event.payload.receiver_id;
    const agents = new Map(farContext.placement.agents);
    agents.set(senderId, {
      regionId: "warm_springs",
      point: { x: 304, y: 112 },
      anchorKind: "test-near-transfer",
    });
    agents.set(receiverId, {
      regionId: "warm_springs",
      point: { x: 328, y: 112 },
      anchorKind: "test-near-transfer",
    });
    const context = {
      ...farContext,
      placement: { ...farContext.placement, agents },
    };
    const plan = definitionFor("resource_transferred").resolve(context);
    const hold = plan.phases.find(({ phase }) => phase === "hold")!;

    expect(hold.actorIntents).toContainEqual(expect.objectContaining({
      actorId: senderId,
      kind: "reach",
      target: agents.get(receiverId)!.point,
    }));
    expect(plan.phases.flatMap(({ actorIntents }) => actorIntents).some(({ kind }) => (
      kind === "move" || kind === "fade-reposition"
    ))).toBe(false);
    expect(plan.phases.flatMap(({ effectIntents }) => effectIntents).some(({ kind }) => (
      kind === "portrait"
    ))).toBe(false);
    expect(plan.phases.filter(({ phase }) => phase === "hold" || phase === "consequence")
      .every(({ dialogue }) => dialogue?.text === "Joe gave 1 material to Mae.")).toBe(true);

    const batch = createProductionSceneCommandResolver({
      getPlacement: () => context.placement,
    })({
      ...context.frame,
      revision: context.frame.revision + 1,
      scene: {
        ...hold,
        execution: { sceneToken: 702, programId: plan.id },
      },
    });
    expect(batch?.commands).toContainEqual(expect.objectContaining({
      kind: "actor",
      actorId: senderId,
      command: { kind: "play-body", action: "reach-give" },
    }));
    expect(plan.phases.flatMap(({ effectIntents }) => effectIntents)).toContainEqual({
      kind: "flying-item",
      sourceId: senderId,
      targetId: receiverId,
      icon: "materials",
      label: "+1",
    });
  });

  it("suppresses the local transfer flying-item under reduced motion", () => {
    const farContext = c03TransferContext(true);
    const senderId = farContext.event.payload.sender_id;
    const receiverId = farContext.event.payload.receiver_id;
    const agents = new Map(farContext.placement.agents);
    agents.set(senderId, { regionId: "warm_springs", point: { x: 304, y: 112 }, anchorKind: "test-near-transfer" });
    agents.set(receiverId, { regionId: "warm_springs", point: { x: 328, y: 112 }, anchorKind: "test-near-transfer" });
    const plan = definitionFor("resource_transferred").resolve({
      ...farContext,
      placement: { ...farContext.placement, agents },
    });

    expect(plan.phases.flatMap(({ effectIntents }) => effectIntents)).not.toContainEqual(
      expect.objectContaining({ kind: "particle" }),
    );
  });

  it.each([
    [TILE_SIZE, true],
    [TILE_SIZE + 0.001, false],
  ])(
    "G1 repair: uses the immediate no-move fast path only within TILE_SIZE; a hair beyond it still resolves physical via the approach route (separation=%s, immediate=%s)",
    (separation, immediate) => {
      const base = c03TransferContext(false);
      const senderId = base.event.payload.sender_id;
      const receiverId = base.event.payload.receiver_id;
      const senderPoint = { x: 304, y: 112 };
      const receiverPoint = { x: senderPoint.x + separation, y: senderPoint.y };
      const agents = new Map(base.placement.agents);
      agents.set(senderId, { regionId: "warm_springs", point: senderPoint, anchorKind: "boundary" });
      agents.set(receiverId, { regionId: "warm_springs", point: receiverPoint, anchorKind: "boundary" });
      const plan = definitionFor("resource_transferred").resolve({
        ...base,
        placement: { ...base.placement, agents },
      });
      const reaches = plan.phases.flatMap(({ actorIntents }) => actorIntents).filter(({ kind }) => (
        kind === "reach"
      ));

      // Both separations now resolve to a physical handoff: the G1 fix is exactly
      // that a same-region transfer is no longer abandoned just past one tile of
      // static separation -- a legal contact route is always attempted first.
      expect(reaches).toHaveLength(1);
      if (immediate) {
        // Already-adjacent placements take the immediate fast path: no redundant
        // approach move is authored for a walk that isn't needed.
        expect(plan.phases.flatMap(({ actorIntents }) => actorIntents).some(({ kind }) => (
          kind === "move" || kind === "fade-reposition"
        ))).toBe(false);
      }
      expect(plan.phases.flatMap(({ effectIntents }) => effectIntents).some(({ kind }) => (
        kind === "portrait"
      ))).toBe(false);
    },
  );

  it("renders a flying gift item for a local same-region recovery, and never under reduced motion", () => {
    const local = definitionFor("agent_recovered").resolve(contextFor("agent_recovered"));
    const reduced = definitionFor("agent_recovered").resolve(contextFor("agent_recovered", true));

    expect(local.phases.flatMap(({ effectIntents }) => effectIntents)).toContainEqual({
      kind: "flying-item",
      sourceId: "giver",
      targetId: "receiver",
      icon: "energy",
      label: "+12",
    });
    expect(reduced.phases.flatMap(({ effectIntents }) => effectIntents)).not.toContainEqual(
      expect.objectContaining({ kind: "flying-item" }),
    );
  });

  it("APPROACH: the giver physically walks to the fallen recipient instead of only reaching in place", () => {
    // "giver" and "receiver" are hashed to distinct staging anchors (>1 tile
    // apart, same invariant resource_transferred's own G1 repair test relies
    // on) -- before this repair, a same-region recovery only ever authored an
    // "orient" (or, once approach was omitted, nothing at all) for the
    // giver, so the two independently-staged endpoints never actually closed
    // the gap between them.
    const context = contextFor("agent_recovered");
    const giverPlacement = context.placement.agents.get("giver")!;
    const recipientPlacement = context.placement.agents.get("receiver")!;
    expect(distance(giverPlacement.point, recipientPlacement.point)).toBeGreaterThan(TILE_SIZE);

    const plan = definitionFor("agent_recovered").resolve(context);
    const actorIntents = plan.phases.flatMap((phase) => phase.actorIntents);
    const giverMove = actorIntents.find((intent) => intent.actorId === "giver" && intent.kind === "move");

    expect(giverMove).toBeDefined();
    expect(giverMove?.waypoints?.length ?? 0).toBeGreaterThan(1);
    expect(actorIntents.some((intent) => intent.actorId === "giver" && intent.kind === "reach")).toBe(true);
    expect(plan.diagnostics).not.toContainEqual(expect.objectContaining({ code: "recovery-contact-fallback" }));
    expect(plan.phases.flatMap((phase) => phase.effectIntents)).not.toContainEqual(
      expect.objectContaining({ kind: "portrait" }),
    );
  });

  it("recognizes gift-recovery order without moving either endpoint", () => {
    const recovery = definitionFor("agent_recovered").resolve(contextFor("agent_recovered", false, {
      chain: "gift-recovery",
    }));

    const recoveryIntents = recovery.phases.flatMap((phase) => phase.actorIntents);
    expect(recoveryIntents.findIndex((intent) => intent.actorId === "giver" && intent.kind === "reach"))
      .toBeLessThan(recoveryIntents.findIndex((intent) => intent.actorId === "receiver" && intent.kind === "recover"));
  });

  it("credits only the named hoarder and retains the preceding harvest in a resource-hoard chain", () => {
    const plan = definitionFor("agent_started_hoarding").resolve(contextFor("agent_started_hoarding", false, {
      chain: "resource-hoard",
    }));

    expect(plan.participants).toEqual([{ role: "actor", ids: ["hoarder"] }]);
    expect(new Set(plan.phases.flatMap((phase) => phase.actorIntents).map((intent) => intent.actorId)))
      .toEqual(new Set(["hoarder"]));
    expect(plan.phases.flatMap((phase) => phase.actorIntents).some((intent) => intent.kind === "gather"))
      .toBe(true);
    const gatherPhase = plan.phases.findIndex((phase) => phase.actorIntents.some((intent) => intent.kind === "gather"));
    const consequencePhase = plan.phases.findIndex((phase) => phase.actorIntents.some((intent) => intent.marker?.includes("hoard-commit")));
    expect(gatherPhase).toBeLessThan(consequencePhase);
  });

  it("RED repair C1/I1: resolves a real C02 representative as departure route then atlas then arrival route", () => {
    const context = chronicleContext("C02", "travel", "agent_entered_region");
    const plan = definitionFor("agent_entered_region").resolve(context);
    const origin = context.event.payload.from_region;
    const destination = context.event.payload.to_region;
    const originGate = context.recipes.get(origin)!.gates.find((gate) => (
      gate.role === "departure" && gate.edge.from === origin && gate.edge.to === destination
    ))!;
    const destinationRecipe = context.recipes.get(destination)!;
    const arrivalGate = destinationRecipe.gates.find((gate) => (
      gate.role === "arrival" && gate.edge.from === origin && gate.edge.to === destination
    ))!;
    const ordered = plan.phases.flatMap((phase, phaseIndex) => (
      phase.actorIntents.filter((intent) => intent.kind === "move").map((intent) => ({ phaseIndex, intent }))
    ));

    expect(context.moment.representative.event.type).toBe("agent_entered_region");
    expect(plan.phases.map(({ phase, regionId }) => [phase, regionId])).toEqual([
      ["enter", origin],
      ["hold", destination],
      ["consequence", destination],
      ["recover", destination],
      ["exit", destination],
    ]);
    expect(ordered).toHaveLength(2);
    expect(ordered[0]!.phaseIndex).toBeLessThan(ordered[1]!.phaseIndex);
    expect(ordered[0]!.intent.waypoints?.at(-1)).toEqual(tileCenter(originGate.tile));
    expect(ordered[1]!.intent.waypoints?.[0]).toEqual(tileCenter(arrivalGate.tile));
    expect(ordered[1]!.intent.waypoints?.at(-1)).toEqual(
      nearestStagingPointFixture(destinationRecipe.stagingPoints, tileCenter(arrivalGate.tile))(
        `${context.event.payload.agent_id}:arrival:${origin}`,
      ),
    );
    expect(plan.phases.findIndex((phase) => phase.effectIntents.some((intent) => intent.kind === "atlas-transition")))
      .toBeGreaterThan(ordered[0]!.phaseIndex);
    expect(plan.phases.findIndex((phase) => phase.effectIntents.some((intent) => intent.kind === "atlas-transition")))
      .toBeLessThan(ordered[1]!.phaseIndex);
    expect(ordered.every(({ intent }) => Object.isFrozen(intent.waypoints))).toBe(true);
  });

  it("TRUNCATE-THEN-WALK: bounds the DEPARTURE half of a real travel chain without cutting it away", () => {
    // The one remaining unbounded scene after the two-lane split. Measured on
    // the real recording (`runs/seed-20260710-*`): two paired departures walked
    // 1,521px and 1,506px -- ~31s each at the 48px/s production gait, and 42%
    // of everything the stage still demanded. It may not simply be cut: a being
    // must be SEEN leaving through its own gate. So the middle is elided.
    const context = chronicleContext("C02", "travel", "agent_entered_region");
    const plan = definitionFor("agent_entered_region").resolve(context);
    const origin = context.event.payload.from_region;
    const destination = context.event.payload.to_region;
    const originGate = context.recipes.get(origin)!.gates.find((gate) => (
      gate.role === "departure" && gate.edge.from === origin && gate.edge.to === destination
    ))!;
    const departure = plan.phases.flatMap((phase) => phase.actorIntents)
      .find((intent) => intent.kind === "move" && intent.marker?.includes("departure") === true);

    // Still a WALK, still ending exactly on its own departure gate: the being
    // is seen leaving. This is the contract the distance gate may not break.
    expect(departure?.kind).toBe("move");
    expect(departure?.waypoints?.at(-1)).toEqual(tileCenter(originGate.tile));
    expect(departure?.target).toEqual(tileCenter(originGate.tile));
    expect((departure?.waypoints ?? []).length).toBeGreaterThanOrEqual(2);

    // ...and bounded.
    expect(routeDistancePx(departure?.waypoints ?? [])).toBeLessThanOrEqual(WALK_MAX_DISTANCE_PX);

    // Non-vacuity: this real departure genuinely needed truncating, and the
    // elision is declared rather than implied.
    expect(departure?.cutFrom).toEqual(departure?.waypoints?.[0]);
  });

  it("TRUNCATE-THEN-WALK: never truncates the ARRIVAL, whose first waypoint IS the gate the placement hint reads", () => {
    // `lifecycleCommands` publishes `arrivalGate: arrival.waypoints[0]`, and
    // `reconcileArrivalContinuity` reconciles the body across the region change
    // from it. Cutting an arrival's head would move the gate. The arrival is
    // bounded at `selectDeferredArrivalStagingPoint` instead.
    const context = chronicleContext("C02", "travel", "agent_entered_region");
    const plan = definitionFor("agent_entered_region").resolve(context);
    const destinationRecipe = context.recipes.get(context.event.payload.to_region)!;
    const arrivalGate = destinationRecipe.gates.find((gate) => (
      gate.role === "arrival"
      && gate.edge.from === context.event.payload.from_region
      && gate.edge.to === context.event.payload.to_region
    ))!;
    const arrival = plan.phases.flatMap((phase) => phase.actorIntents)
      .find((intent) => intent.kind === "move" && intent.marker?.includes("arrival") === true);

    expect(arrival?.waypoints?.[0]).toEqual(tileCenter(arrivalGate.tile));
    expect(arrival?.cutFrom).toBeUndefined();
  });

  it("TRUNCATE-THEN-WALK: a truncated departure walks a contiguous SUFFIX of the route the pathfinder certified", () => {
    // The whole legality argument. The renderer accepts a reposition only to a
    // point whose standing envelope clears every home footprint and tall
    // landmark and whose tile is open ground -- and `presentationRouteIsClear`
    // already swept every waypoint of the untruncated route when it accepted
    // it. Cutting to one of ITS OWN waypoints therefore asserts nothing new
    // about the map.
    const context = chronicleContext("C02", "travel", "agent_entered_region");
    const origin = context.event.payload.from_region;
    const destination = context.event.payload.to_region;
    const originGate = context.recipes.get(origin)!.gates.find((gate) => (
      gate.role === "departure" && gate.edge.from === origin && gate.edge.to === destination
    ))!;
    const start = context.placement.agents.get(context.event.payload.agent_id)!;
    const certified = connectNavigationEndpoints(
      context.recipes.get(origin)!.grid,
      findNavigationPath(context.recipes.get(origin)!.grid, {
        start: { column: Math.floor(start.point.x / 32), row: Math.floor(start.point.y / 32) },
        goal: originGate.tile,
      }),
      { start: start.point },
    )!;
    const plan = definitionFor("agent_entered_region").resolve(context);
    const departure = plan.phases.flatMap((phase) => phase.actorIntents)
      .find((intent) => intent.kind === "move" && intent.marker?.includes("departure") === true)!;

    const cutIndex = certified.findIndex((point) =>
      point.x === departure.waypoints![0]!.x && point.y === departure.waypoints![0]!.y);
    expect(cutIndex).toBeGreaterThan(0);
    expect(departure.waypoints).toEqual(certified.slice(cutIndex));
  });

  it("C-fix-2: bounds a deferred single-chain arrival's scene duration for the real C18 Nirvana crossing (cursor 21)", () => {
    // Reproduces the exact settlement-stall moment from .superpowers/sdd/c18-fix-report.md:
    // wanderer_002 (Mae) crossing warm_springs -> nirvana at C18 cursor 21. Before the
    // fix, resolveMovementRoute's deferred arrival goal was hash-selected from nirvana's
    // *entire* stagingPoints set, which could land far across the region; routeAwareTiming
    // then stretched the "consequence" phase (and every marker after it, incl. the safe
    // -cancel/settle boundary the SceneSettlementCoordinator waits on) to cover that walk
    // -- tens of real seconds at rate=1. This test asserts the resolved program duration
    // stays within a normal single-arrival budget regardless of region size/growth.
    const context = c18RegionCrossingContext("wanderer_002", "nirvana");
    expect(context.moment.chainKind).toBe("single");
    const plan = definitionFor("agent_entered_region").resolve(context);

    expect(context.event.payload.agent_id).toBe("wanderer_002");
    expect(context.event.payload.to_region).toBe("nirvana");
    // Pre-fix this was 42045ms (the real, live-reproduced C18 cursor-21 stall
    // duration -- see .superpowers/sdd/c18-fix-report.md and c18-fix2-report.md).
    // 15s is a generous bound: comfortably above a genuinely bounded nearby walk,
    // nowhere near the unbounded, region-size-scaling duration the bug produced.
    expect(plan.durationMs).toBeLessThanOrEqual(15_000);

    const destinationRecipe = context.recipes.get("nirvana")!;
    const arrivalGate = destinationRecipe.gates.find((gate) => (
      gate.role === "arrival"
      && gate.edge.from === context.event.payload.from_region
      && gate.edge.to === "nirvana"
    ))!;
    const arrivalMove = plan.phases.flatMap((phase) => phase.actorIntents).filter((intent) => (
      intent.actorId === "wanderer_002" && intent.kind === "move"
    )).at(-1);
    expect(arrivalMove?.waypoints?.at(-1)).toEqual(
      nearestStagingPointFixture(destinationRecipe.stagingPoints, tileCenter(arrivalGate.tile))(
        `wanderer_002:arrival:${context.event.payload.from_region}`,
      ),
    );
  });

  it.each(["harvest", "transfer", "hearth"] as const)(
    "RED repair C1: retains exact preceding %s mechanic before a resource-hoard consequence",
    (variant) => {
      const context = resourceHoardContext(variant);
      const plan = definitionFor("agent_started_hoarding").resolve(context);
      const phases = plan.phases;
      const reserveIndex = phases.findIndex((phase) => phase.actorIntents.some((intent) => (
        intent.actorId === "hoarder" && intent.marker?.includes("hoard-commit")
      )));
      const priorIndex = phases.findIndex((phase) => (
        variant === "harvest"
          ? phase.actorIntents.some((intent) => intent.kind === "gather")
          : variant === "transfer"
            ? phase.actorIntents.some((intent) => intent.actorId === "sender" && intent.kind === "reach")
            : phase.homeIntents.some((intent) => intent.homeId === "home-1" && intent.kind === "hearth")
      ));

      expect(context.moment.representative.event.type).toBe("agent_started_hoarding");
      expect(priorIndex).toBeGreaterThanOrEqual(0);
      expect(priorIndex).toBeLessThan(reserveIndex);
      expect(plan.markers.filter((marker) => marker.role === "consequence")).toHaveLength(1);
      if (variant === "hearth") {
        // G3 reclassified hearth_used's tending pose from "reach" to "kneel"; the
        // hearth-triggered hoard chain replays that same prior action's pose, so it
        // must follow, not the stale "reach" it hardcoded before this repair.
        expect(phases.flatMap((phase) => phase.actorIntents)).toContainEqual(expect.objectContaining({
          actorId: "hoarder",
          kind: "kneel",
        }));
        expect(phases.flatMap((phase) => phase.actorIntents).some((intent) => (
          intent.actorId === "hoarder" && intent.kind === "reach"
        ))).toBe(false);
      }
    },
  );

  it("APPROACH: the resource-hoard chain's giver physically walks to the hoarder instead of reaching in place with no motion", () => {
    // "hoarder" and "sender" are hashed to distinct staging anchors (>1 tile
    // apart, the same PlacementLedger.stagingPlacement invariant
    // resource_transferred's own G1 repair test relies on) -- before this
    // repair, this branch authored ONLY a "reach" for the giver (not even an
    // "orient"), regardless of how far apart the two independently-staged
    // placements actually were.
    const context = resourceHoardContext("transfer");
    const giverPlacement = context.placement.agents.get("sender")!;
    const hoarderPlacement = context.placement.agents.get("hoarder")!;
    expect(distance(giverPlacement.point, hoarderPlacement.point)).toBeGreaterThan(TILE_SIZE);

    const plan = definitionFor("agent_started_hoarding").resolve(context);
    const actorIntents = plan.phases.flatMap((phase) => phase.actorIntents);
    const giverMove = actorIntents.find((intent) => intent.actorId === "sender" && intent.kind === "move");

    expect(giverMove).toBeDefined();
    expect(giverMove?.waypoints?.length ?? 0).toBeGreaterThan(1);
    expect(actorIntents.some((intent) => intent.actorId === "sender" && intent.kind === "reach")).toBe(true);
    expect(plan.phases.flatMap((phase) => phase.effectIntents)).not.toContainEqual(
      expect.objectContaining({ kind: "portrait" }),
    );
  });

  it.each(["C10", "C12"] as const)(
    "RED repair C1: real %s representative retains attacker contact exactly once before one fall",
    (chronicleId) => {
      const context = chronicleContext(chronicleId, "strike-fall", "agent_paralyzed");
      const plan = definitionFor("agent_paralyzed").resolve(context);
      const attackerId = context.event.payload.trigger === "attack"
        ? context.event.payload.attacker_id
        : "unreachable";
      const intents = plan.phases.flatMap((phase) => phase.actorIntents);
      const attackerContacts = intents.filter((intent) => intent.actorId === attackerId && intent.kind === "reach");
      const falls = intents.filter((intent) => intent.actorId === context.event.payload.agent_id && intent.kind === "hurt");

      expect(context.moment.representative.event.type).toBe("agent_paralyzed");
      expect(attackerContacts).toHaveLength(1);
      expect(falls).toHaveLength(1);
      expect(intents.indexOf(attackerContacts[0]!)).toBeLessThan(intents.indexOf(falls[0]!));
    },
  );

  it("RED repair I1: retains every legal resource waypoint and begins gathering only in a later phase", () => {
    const context = nearHarvestContext();
    const plan = definitionFor("resource_changed").resolve(context);
    const movePhase = plan.phases.findIndex((phase) => phase.actorIntents.some((intent) => intent.kind === "move"));
    const gatherPhase = plan.phases.findIndex((phase) => phase.actorIntents.some((intent) => intent.kind === "gather"));
    const move = plan.phases[movePhase]!.actorIntents.find((intent) => intent.kind === "move")!;

    expect(move.waypoints!.length).toBeGreaterThanOrEqual(4);
    expect(move.target).toEqual(move.waypoints!.at(-1));
    expect(gatherPhase).toBeGreaterThan(movePhase);
    expectLegalCardinalRoute(context.recipes.get("spring")!, move.waypoints!);
  });

  it.each([false, true])(
    "connects an extreme same-cell resource origin without snapping (reduced=%s)",
    (reducedMotion) => {
      const base = nearHarvestContext(reducedMotion);
      const retained = base.placement.agents.get("harvester")!;
      const exactStart = {
        x: Math.floor(retained.point.x / TILE_SIZE) * TILE_SIZE + 1,
        y: Math.floor(retained.point.y / TILE_SIZE) * TILE_SIZE + TILE_SIZE - 1,
      };
      const agents = new Map(base.placement.agents);
      agents.set("harvester", { ...retained, point: exactStart });
      const context = { ...base, placement: { ...base.placement, agents } };
      const plan = definitionFor("resource_changed").resolve(context);
      const spatial = plan.phases.flatMap(({ actorIntents }) => actorIntents).find((intent) => (
        intent.kind === "move" || intent.kind === "fade-reposition"
      ))!;

      if (reducedMotion) {
        expect(spatial.kind).toBe("fade-reposition");
      } else {
        expect(spatial.kind).toBe("move");
        expect(spatial.waypoints?.[0]).toEqual(exactStart);
        expect(Math.floor(spatial.waypoints![1]!.x / TILE_SIZE))
          .toBe(Math.floor(exactStart.x / TILE_SIZE));
        expect(Math.floor(spatial.waypoints![1]!.y / TILE_SIZE))
          .toBe(Math.floor(exactStart.y / TILE_SIZE));
      }
      expect(spatial.target).toEqual(
        plan.phases.flatMap(({ actorIntents }) => actorIntents).at(-1)?.target,
      );
    },
  );

  it.each([30, 60, 120])(
    "RED repair I7: drives a real actor over the resource route at %s Hz with bounded speed and exact endpoint",
    (hz) => {
      const context = nearHarvestContext();
      const plan = definitionFor("resource_changed").resolve(context);
      const move = plan.phases.flatMap((phase) => phase.actorIntents).find((intent) => intent.kind === "move")!;
      const route = move.waypoints!;
      const actor = layeredActor("harvester", route[0]!);
      const speed = 80;
      actor.apply({ kind: "move", waypoints: route, speedPixelsPerSecond: speed, gait: "walk" }, 0);
      const stepMs = 1_000 / hz;
      const positions = [actor.snapshot().position];
      let nowMs = 0;
      const routeLength = route.slice(1).reduce(
        (total, point, index) => total + distance(route[index]!, point),
        0,
      );
      const maximumSteps = Math.ceil(((routeLength / speed) + 1) * hz);
      for (let index = 0; index < maximumSteps; index += 1) {
        nowMs += stepMs;
        actor.advance(stepMs / 1_000, nowMs);
        positions.push(actor.snapshot().position);
        if (distance(actor.snapshot().position, route.at(-1)!) <= 0.5) break;
      }

      expect(new Set(positions.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`)).size).toBeGreaterThanOrEqual(4);
      expect(distance(positions.at(-1)!, route.at(-1)!)).toBeLessThanOrEqual(0.5);
      for (let index = 1; index < positions.length; index += 1) {
        expect(distance(positions[index - 1]!, positions[index]!) / (stepMs / 1_000)).toBeLessThanOrEqual(speed + 0.01);
      }
    },
  );

  it.each([30, 60, 120])(
    "FINAL RED: fits representative Family A plan phases at production speed before the next phase at %s Hz",
    (hz) => {
      const cases = [
        chronicleContext("C02", "travel", "agent_entered_region"),
        contextFor("resource_changed"),
        resourceHoardContext("harvest"),
        chronicleContext("C10", "strike-fall", "agent_paralyzed"),
      ] as unknown as readonly ChoreographyContext<FamilyType>[];
      for (const base of cases) {
        for (const reducedMotion of [false, true]) {
          const context = { ...base, reducedMotion } as ChoreographyContext<FamilyType>;
          const plan = definitionFor(context.event.type).resolve(context as never);
          for (const window of plan.phaseWindows) {
            const phase = plan.phases.find((candidate) => candidate.phase === window.phase)!;
            const spatial = phase.actorIntents.find((intent) =>
              intent.kind === "move" || intent.kind === "fade-reposition");
            if (spatial === undefined || spatial.target === null) continue;
            const route = spatial.waypoints ?? [spatial.target];
            for (const initialFacing of ["north", "east", "south", "west"] as const) {
              const actor = layeredActor(spatial.actorId, route[0]!, initialFacing);
              const resolver = createProductionSceneCommandResolver({
                getPlacement: () => context.placement,
              });
              const batch = resolver({
                ...context.frame,
                revision: context.frame.revision + 1,
                scene: {
                  ...phase,
                  execution: { sceneToken: 501, programId: plan.id },
                },
              });
              const commands = batch?.commands.filter((command) =>
                command.kind === "actor" && command.actorId === spatial.actorId) ?? [];
              expect(commands.length, `${plan.eventType}:${window.phase}:commands`).toBeGreaterThan(0);
              for (const command of commands) {
                if (command.kind !== "actor") continue;
                if (command.command.kind === "move") {
                  expect(command.command.speedPixelsPerSecond).toBe(48);
                }
                actor.apply(command.command, 0);
              }
              const phaseDuration = window.endMs - window.startMs;
              const stepMs = 1_000 / hz;
              let elapsedMs = 0;
              while (elapsedMs < phaseDuration) {
                const next = Math.min(phaseDuration, elapsedMs + stepMs);
                actor.advance((next - elapsedMs) / 1_000, next);
                elapsedMs = next;
              }
              expect(distance(actor.snapshot().position, spatial.target), `${plan.eventType}:${window.phase}:${hz}Hz:${reducedMotion}:${initialFacing}`)
                .toBeLessThanOrEqual(0.5);
              actor.advance(stepMs / 1_000, phaseDuration + stepMs);
              expect(distance(actor.snapshot().position, spatial.target)).toBeLessThanOrEqual(0.5);
            }
          }
        }
      }
    },
  );

  it("RED repair I5: deep-owns every output coordinate without freezing or retaining caller placement", () => {
    const context = contextFor("agent_recovered");
    const mutablePoint = { x: 160, y: 192 };
    const placements = new Map(context.placement.agents);
    placements.set("receiver", { regionId: "spring", point: mutablePoint, anchorKind: "test" });
    const plan = definitionFor("agent_recovered").resolve({
      ...context,
      placement: { ...context.placement, agents: placements },
    });
    const outputTargets = plan.phases.flatMap((phase) => phase.actorIntents)
      .map((intent) => intent.target)
      .filter((point): point is Readonly<{ x: number; y: number }> => point !== null);

    expect(Object.isFrozen(mutablePoint)).toBe(false);
    expect(outputTargets.length).toBeGreaterThan(0);
    expect(outputTargets.every((point) => point !== mutablePoint && Object.isFrozen(point))).toBe(true);
    mutablePoint.x = 999;
    expect(outputTargets.every((point) => point.x !== 999)).toBe(true);
  });

  it("RED repair M1: remote speech never uses the remote agent map coordinate as an actor target", () => {
    const context = contextFor("speak");
    const remotePoint = context.placement.agents.get("listener")!.point;
    const plan = definitionFor("speak").resolve(context);

    expect(plan.phases.flatMap((phase) => phase.actorIntents)
      .filter((intent) => intent.actorId === "speaker")
      .every((intent) => intent.target === null || intent.target !== remotePoint && intent.target.x !== remotePoint.x && intent.target.y !== remotePoint.y))
      .toBe(true);
  });

  it("RED repair I7: reduced travel preserves final coordinate, facing, and terminal intent", () => {
    const normalContext = contextFor("agent_entered_region", false, { chain: "travel" });
    const reducedContext = { ...normalContext, reducedMotion: true };
    const normal = definitionFor("agent_entered_region").resolve(normalContext);
    const reduced = definitionFor("agent_entered_region").resolve(reducedContext);
    const normalFinal = finalActorIntent(normal, "traveler");
    const reducedFinal = finalActorIntent(reduced, "traveler");

    expect(reducedFinal.target).toEqual(normalFinal.target);
    expect(reducedFinal.facing).toBe(normalFinal.facing);
    expect(reducedFinal.kind).toBe(normalFinal.kind);
  });

  it.each([
    ["agent_born", "child"],
    ["agent_died", "victim"],
    ["agent_paralyzed", "victim"],
    ["agent_recovered", "receiver"],
    ["agent_left_region", "traveler"],
    ["resource_changed", "harvester"],
  ] as const)(
    "RED repair I7: %s reduced motion retains the same coordinate, facing, and terminal intent",
    (type, actorId) => {
      const normalContext = contextFor(type, false);
      const normal = resolve(definitionFor(type), normalContext);
      const reduced = resolve(definitionFor(type), { ...normalContext, reducedMotion: true });
      const normalFinal = finalActorIntent(normal, actorId);
      const reducedFinal = finalActorIntent(reduced, actorId);

      expect(reducedFinal.target).toEqual(normalFinal.target);
      expect(reducedFinal.facing).toBe(normalFinal.facing);
      expect(reducedFinal.kind).toBe(normalFinal.kind);
    },
  );
});

type FamilyType = (typeof FAMILY_TYPES)[number];

function definitionFor<T extends FamilyType>(type: T) {
  const definition = LIFECYCLE_MOVEMENT_COMMUNICATION_RESOURCE_DEFINITIONS.find(
    (candidate) => candidate.eventType === type,
  );
  if (definition === undefined) throw new Error(`missing definition ${type}`);
  return definition as Extract<typeof LIFECYCLE_MOVEMENT_COMMUNICATION_RESOURCE_DEFINITIONS[number], { eventType: T }>;
}

function resolve<T extends FamilyType>(
  definition: ReturnType<typeof definitionFor<T>>,
  context: ChoreographyContext<T>,
): ChoreographyPlan {
  return definition.resolve(context as never);
}

/**
 * The relocation an actor performs in a plan, whichever way the plan chose it.
 *
 * Since the 2026-07-31 distance gate (`locomotionGate.ts`), a route beyond the
 * walk threshold is planned as a `fade-reposition` to the same destination
 * rather than a `move` along it. Tests whose subject is WHERE a being ends up —
 * which anchor was chosen, whether a coordinate was invented — must not care
 * which of the two it was.
 */
function relocation(plan: Readonly<{ phases: readonly { actorIntents: readonly ActorVisualIntent[] }[] }>) {
  return plan.phases.flatMap((phase) => phase.actorIntents)
    .find((intent) => intent.kind === "move" || intent.kind === "fade-reposition");
}

/**
 * A harvest whose patch is near enough to walk.
 *
 * The canonical fixture hashes its harvester to a staging anchor far across the
 * region from its resource patch — exactly the case the distance gate now cuts,
 * and exactly why one measured `resource_changed` leased the stage for 56.5
 * seconds. Tests about the ROUTE ITSELF (waypoint legality, actor traversal,
 * sub-tile origins) need a route, so this stands the harvester within the walk
 * threshold of the patch it is going to, trying successive offsets until the
 * planner returns a real walk.
 */
function nearHarvestContext(reducedMotion = false) {
  // The search always plans under full motion: reduced motion replaces the walk
  // with a reposition by policy, so it can never report whether a placement is
  // within walking distance. The chosen placement is then handed to the caller's
  // own context.
  const base = contextFor("resource_changed", false);
  const target = relocation(definitionFor("resource_changed").resolve(base))?.target;
  if (target === undefined || target === null) throw new Error("fixture harvest has no destination");
  const offsets = [3, 4, 5, 6, 7, 8].flatMap((tiles) => [
    { x: 0, y: tiles * TILE_SIZE },
    { x: 0, y: -tiles * TILE_SIZE },
    { x: tiles * TILE_SIZE, y: 0 },
    { x: -tiles * TILE_SIZE, y: 0 },
  ]);
  for (const offset of offsets) {
    const agents = new Map(base.placement.agents);
    const harvester = agents.get("harvester")!;
    agents.set("harvester", {
      ...harvester,
      point: { x: target.x + offset.x, y: target.y + offset.y },
    });
    const candidate = { ...base, placement: { ...base.placement, agents } };
    const move = definitionFor("resource_changed").resolve(candidate)
      .phases.flatMap((phase) => phase.actorIntents)
      .find((intent) => intent.kind === "move");
    if (move !== undefined && (move.waypoints?.length ?? 0) >= 4) {
      return {
        ...contextFor("resource_changed", reducedMotion),
        placement: { ...base.placement, agents },
      };
    }
  }
  throw new Error("no legal near-harvest placement found beside the fixture patch");
}

function contextFor<T extends FamilyType>(
  type: T,
  reducedMotion = false,
  overrides: Readonly<{
    payload?: Readonly<Record<string, unknown>>;
    chain?: StoryMoment["chainKind"];
  }> = {},
): ChoreographyContext<T> {
  const evidence = entriesFor(type, overrides.payload, overrides.chain);
  const moment = new BeatDirector().group(evidence)[0]!;
  const parsed = parsePresentedEvent(moment.representative);
  if (!parsed.known || parsed.evidence.type !== type) throw new Error(`expected ${type}`);
  return {
    moment,
    event: parsed.evidence as Extract<TypedPresentedEvent, { readonly type: T }>,
    frame: frame(defaultAgents(type)),
    placement: placement(defaultAgents(type), type === "agent_entered_region"),
    recipes: new Map([
      ["spring", recipeFor("spring")],
      ["ridge", recipeFor("ridge")],
    ]),
    reducedMotion,
    compactResourceRouting: false,
  };
}

function chronicleContext<T extends "agent_entered_region" | "agent_paralyzed">(
  chronicleId: ChronicleId,
  chainKind: StoryMoment["chainKind"],
  type: T,
): ChoreographyContext<T> {
  const manifest = getChronicleManifest(chronicleId);
  const moment = new BeatDirector().group(manifest.entries).find((candidate) => candidate.chainKind === chainKind);
  if (moment === undefined) throw new Error(`missing ${chainKind} in ${chronicleId}`);
  const parsed = parsePresentedEvent(moment.representative);
  if (!parsed.known || parsed.evidence.type !== type) throw new Error(`expected representative ${type}`);
  const recipes = new Map(manifest.initialSnapshot.regions.map((regionValue) => {
    const recipe = createRegionMapRecipe(createRegionMapIdentity(
      manifest.seed,
      regionValue,
      manifest.initialSnapshot.regions,
    ));
    return [regionValue.name, recipe] as const;
  }));
  const ledger = PlacementLedger.reconstruct([...recipes.values()], {
    agents: manifest.initialSnapshot.agents,
    homes: manifest.initialSnapshot.homes,
  });
  return {
    moment,
    event: parsed.evidence as Extract<TypedPresentedEvent, { readonly type: T }>,
    frame: frameFromSnapshot(manifest.initialSnapshot),
    placement: ledger.snapshot(),
    recipes,
    reducedMotion: false,
    compactResourceRouting: false,
  };
}

/**
 * Finds the exact C18 grand-tour `agent_entered_region` moment for one agent/destination,
 * grouped exactly as the real fixture/production ingress groups it: one envelope (one
 * entry) at a time, which is the *only* reachable chainKind ("single") for this event in
 * any Chronicle QA route or live delivery path (see .superpowers/sdd/c18-fix-report.md's
 * "Reproduction" section) -- grouping the *whole* manifest at once would let BeatDirector
 * pair it into an unreachable "travel" chain instead.
 */
function c18RegionCrossingContext(
  agentId: string,
  toRegion: string,
): ChoreographyContext<"agent_entered_region"> {
  const manifest = getChronicleManifest("C18");
  const entry = manifest.entries.find((candidate) => {
    const parsed = parsePresentedEvent(candidate);
    return parsed.known
      && parsed.evidence.type === "agent_entered_region"
      && parsed.evidence.payload.agent_id === agentId
      && parsed.evidence.payload.to_region === toRegion;
  });
  if (entry === undefined) {
    throw new Error(`missing agent_entered_region ${agentId} -> ${toRegion} in C18`);
  }
  const moment = new BeatDirector().group([entry])[0];
  if (moment === undefined) {
    throw new Error(`missing agent_entered_region ${agentId} -> ${toRegion} in C18`);
  }
  const parsed = parsePresentedEvent(moment.representative);
  if (!parsed.known || parsed.evidence.type !== "agent_entered_region") {
    throw new Error("expected agent_entered_region representative");
  }
  const recipes = new Map(manifest.initialSnapshot.regions.map((regionValue) => {
    const recipe = createRegionMapRecipe(createRegionMapIdentity(
      manifest.seed,
      regionValue,
      manifest.initialSnapshot.regions,
    ));
    return [regionValue.name, recipe] as const;
  }));
  const ledger = PlacementLedger.reconstruct([...recipes.values()], {
    agents: manifest.initialSnapshot.agents,
    homes: manifest.initialSnapshot.homes,
  });
  return {
    moment,
    event: parsed.evidence,
    frame: frameFromSnapshot(manifest.initialSnapshot),
    placement: ledger.snapshot(),
    recipes,
    reducedMotion: false,
    compactResourceRouting: false,
  };
}

function c03TransferContext(
  reducedMotion: boolean,
): ChoreographyContext<"resource_transferred"> {
  const manifest = getChronicleManifest("C03");
  const moment = new BeatDirector().group(manifest.entries).find((candidate) => (
    candidate.representative.event.type === "resource_transferred"
  ));
  if (moment === undefined) throw new Error("missing resource_transferred in C03");
  const parsed = parsePresentedEvent(moment.representative);
  if (!parsed.known || parsed.evidence.type !== "resource_transferred") {
    throw new Error("expected C03 resource_transferred representative");
  }
  const recipes = new Map(manifest.initialSnapshot.regions.map((regionValue) => {
    const recipe = createRegionMapRecipe(createRegionMapIdentity(
      manifest.seed,
      regionValue,
      manifest.initialSnapshot.regions,
    ));
    return [regionValue.name, recipe] as const;
  }));
  const ledger = PlacementLedger.reconstruct([...recipes.values()], {
    agents: manifest.initialSnapshot.agents,
    homes: manifest.initialSnapshot.homes,
  });
  const agents = new Map(ledger.snapshot().agents);
  agents.set("wanderer_001", {
    regionId: "warm_springs",
    point: { x: 1_936, y: 176 },
    anchorKind: "observed-c03-harvest-endpoint",
  });
  agents.set("wanderer_002", {
    regionId: "warm_springs",
    point: { x: 304, y: 112 },
    anchorKind: "observed-c03-retained-endpoint",
  });
  return {
    moment,
    event: parsed.evidence,
    frame: frameFromSnapshot(manifest.initialSnapshot),
    placement: { ...ledger.snapshot(), agents },
    recipes,
    reducedMotion,
    compactResourceRouting: false,
  };
}

function resourceHoardContext(
  variant: "harvest" | "transfer" | "hearth",
): ChoreographyContext<"agent_started_hoarding"> {
  const prior = variant === "harvest"
    ? event(1, "resource_changed", {
        ...payloadFor("resource_changed"),
        agent_id: "hoarder",
      }, "hoarder", "spring")
    : variant === "transfer"
      ? event(1, "resource_transferred", {
          ...payloadFor("resource_transferred"),
          sender_id: "sender",
          receiver_id: "hoarder",
        }, "sender", "spring")
      : event(1, "hearth_used", {
          message: "Hoarder warmed at home-1.",
          agent_id: "hoarder",
          home_id: "home-1",
          target_home: "home-1",
          region: "spring",
          materials_burned: 1,
          energy_gained: 8,
          agent_energy: 500,
          agent_materials: 45,
        }, "hoarder", "spring");
  const moment = new BeatDirector().group([
    prior,
    event(2, "agent_started_hoarding", payloadFor("agent_started_hoarding"), "hoarder", "spring"),
  ])[0]!;
  const parsed = parsePresentedEvent(moment.representative);
  if (!parsed.known || parsed.evidence.type !== "agent_started_hoarding") {
    throw new Error("expected resource-hoard representative");
  }
  const agents = [agent("hoarder", "spring"), agent("sender", "spring")];
  return {
    moment,
    event: parsed.evidence,
    frame: frame(agents),
    placement: placement(agents),
    recipes: new Map([
      ["spring", recipeFor("spring")],
      ["ridge", recipeFor("ridge")],
    ]),
    reducedMotion: false,
    compactResourceRouting: false,
  };
}

function frameFromSnapshot(snapshot: ReturnType<typeof getChronicleManifest>["initialSnapshot"]): PresentedObserverFrame {
  return {
    runId: snapshot.run_id,
    sourceKey: `fixture:${snapshot.run_id}`,
    revision: 1,
    firstCursor: 0,
    lastCursor: 0,
    source: "fixture",
    ingestedCursor: snapshot.event_cursor,
    presentedCursor: snapshot.event_cursor,
    world: {
      exactBaseCursor: snapshot.event_cursor,
      projectedThroughCursor: snapshot.event_cursor,
      worldTime: snapshot.world_time,
      agents: snapshot.agents.map((value) => ({ completeness: "exact", value })),
      regions: snapshot.regions.map((value) => ({ completeness: "exact", value })),
      homes: snapshot.homes.map((value) => ({ completeness: "exact", value })),
      ruins: snapshot.ruins.map((value) => ({ completeness: "exact", value })),
      pendingProposals: snapshot.pending_proposals,
    },
    scene: null,
    selection: null,
    backlog: { pendingMoments: 1, firstPendingCursor: 1, lastPendingCursor: 2, state: "behind", label: "1 moment" },
    transport: { connection: "live", ingestedCursor: snapshot.event_cursor, retryable: true },
  };
}

function expectLegalCardinalRoute(
  recipe: ReturnType<typeof recipeFor>,
  waypoints: readonly Readonly<{ x: number; y: number }>[],
): void {
  for (const point of waypoints) {
    const column = Math.floor(point.x / 32);
    const row = Math.floor(point.y / 32);
    expect(recipe.grid.collision[row * recipe.grid.columns + column]).toBe(0);
  }
  for (let index = 1; index < waypoints.length; index += 1) {
    const dx = Math.abs(waypoints[index]!.x - waypoints[index - 1]!.x);
    const dy = Math.abs(waypoints[index]!.y - waypoints[index - 1]!.y);
    expect((dx === 32 && dy === 0) || (dx === 0 && dy === 32)).toBe(true);
  }
}

function layeredActor(
  id: string,
  position: Readonly<{ x: number; y: number }>,
  facing: "north" | "east" | "south" | "west" = "east",
): LayeredHumanActor {
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
    persona: `${id} motion test`,
    position,
    facing,
    manifest: PRODUCTION_ASSET_MANIFEST,
    atlasLeases: leases,
  });
}

function distance(
  left: Readonly<{ x: number; y: number }>,
  right: Readonly<{ x: number; y: number }>,
): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function finalActorIntent(plan: ChoreographyPlan, actorId: string) {
  for (const phase of [...plan.phases].reverse()) {
    const intent = [...phase.actorIntents].reverse().find((candidate) => candidate.actorId === actorId);
    if (intent !== undefined) return intent;
  }
  throw new Error(`missing final actor intent ${actorId}`);
}

function entriesFor(
  type: FamilyType,
  payloadOverrides: Readonly<Record<string, unknown>> | undefined,
  chain: StoryMoment["chainKind"] | undefined,
): readonly EventEnvelopeEntry[] {
  if (chain === "travel") {
    return [
      event(1, "agent_left_region", payloadFor("agent_left_region"), "traveler", "spring"),
      event(2, "agent_entered_region", payloadFor("agent_entered_region"), "traveler", "ridge"),
    ];
  }
  if (chain === "gift-recovery") {
    return [
      event(1, "agent_recovered", payloadFor("agent_recovered"), "giver", null),
      event(2, "resource_transferred", payloadFor("resource_transferred"), "giver", "spring"),
    ];
  }
  if (chain === "resource-hoard") {
    return [
      event(1, "resource_changed", { ...payloadFor("resource_changed"), agent_id: "hoarder" }, "hoarder", "spring"),
      event(2, "agent_started_hoarding", payloadFor("agent_started_hoarding"), "hoarder", "spring"),
    ];
  }
  const payload = { ...payloadFor(type), ...payloadOverrides };
  for (const [key, value] of Object.entries(payload)) if (value === undefined) delete payload[key];
  return [event(1, type, payload, sourceFor(type), regionFor(type))];
}

function payloadFor(type: FamilyType): Record<string, unknown> {
  const message = `${type} happened clearly.`;
  switch (type) {
    case "agent_born": return { message, child_id: "child", child_name: "Child", parent_ids: ["initiator", "acceptor"], initiator_id: "initiator", acceptor_id: "acceptor", region: "spring", committed_resources: { energy: 12, materials: 3 }, child_resources: { energy: 20, materials: 4 }, offspring_multiplier: 1 };
    case "agent_died": return { message, victim_id: "victim", victim_name: "Victim", killer_id: "killer", killer: "Killer", region: "spring", attack_damage: 30, attack_energy_cost: 8, victim_was_paralyzed: false, looted_energy: 4, looted_materials: 2 };
    case "agent_decayed": return { message, agent_id: "victim", agent_name: "Victim", region: "spring", died_at: 10, decayed_at: 20 };
    case "agent_paralyzed": return { message, agent_id: "victim", region: "spring", trigger: "attack", energy: 0, victim_id: "victim", attacker_id: "killer" };
    case "agent_recovered": return { message, giver_id: "giver", recipient_id: "receiver", revived_id: "receiver", region: "spring", resource_type: "energy", amount: 12, giver_energy: 30, revived_energy: 12 };
    case "agent_left_region":
    case "agent_entered_region": return { message, agent_id: "traveler", from_region: "spring", to_region: "ridge", move_energy_cost: 5, agent_energy: 45 };
    case "speak": return { message, speaker_id: "speaker", target_id: "listener", region: "spring", speak_energy_cost: 2 };
    case "self_talk": return { message, agent_id: "thinker" };
    case "resource_changed": return { message, agent_id: "harvester", region: "spring", resource_type: "energy", amount: 9, agent_energy: 59, agent_materials: 6, region_energy: 91, region_materials: 80 };
    case "resource_transferred": return { message, sender_id: "sender", receiver_id: "receiver", region: "spring", resource_type: "energy", amount: 12, sender_energy: 30, sender_materials: 5, receiver_energy: 32, receiver_materials: 4 };
    case "agent_started_hoarding": return { message, agent_id: "hoarder", region: "spring", energy: 500, materials: 45 };
  }
}

function event(
  cursor: number,
  type: PresentedEventType,
  payload: Record<string, unknown>,
  source: string,
  region: string | null,
): EventEnvelopeEntry {
  return {
    cursor,
    event: { type, source, payload, scope: type === "self_talk" ? "private" : "local", region, target: null, timestamp: cursor * 10 },
    resolved: type === "agent_died" ? { actor_id: "victim" } : {},
    snapshot_after: null,
  };
}

function sourceFor(type: FamilyType): string {
  switch (type) {
    case "agent_born": return "child";
    case "agent_died": return "victim";
    case "agent_decayed": return "system";
    case "agent_paralyzed": return "system";
    case "agent_recovered": return "giver";
    case "agent_left_region":
    case "agent_entered_region": return "traveler";
    case "speak": return "speaker";
    case "self_talk": return "thinker";
    case "resource_changed": return "harvester";
    case "resource_transferred": return "sender";
    case "agent_started_hoarding": return "hoarder";
  }
}

function regionFor(type: FamilyType): string | null {
  if (type === "self_talk" || type === "agent_recovered") return null;
  if (type === "agent_entered_region") return "ridge";
  return "spring";
}

function defaultAgents(type: FamilyType): readonly AgentSnapshot[] {
  const base = [
    agent("child", "spring"), agent("acceptor", "spring"), agent("initiator", "ridge"),
    agent("victim", "spring", "dead"), agent("killer", "spring"),
    agent("giver", "spring"), agent("receiver", "spring", "paralyzed"),
    agent("traveler", type === "agent_entered_region" ? "spring" : "spring"),
    agent("speaker", "spring"), agent("listener", "ridge"), agent("thinker", "spring"),
    agent("harvester", "spring"), agent("sender", "spring"), agent("hoarder", "spring"),
  ];
  return base;
}

function agent(id: string, position: string, status: AgentSnapshot["status"] = "alive"): AgentSnapshot {
  return { id, name: id, persona: `${id} persona`, position, energy: 40, materials: 5, status, last_mated_at: null, offspring_count: 0, died_at: status === "dead" ? 10 : null, home_id: null, is_hoarding: false };
}

function frame(agents: readonly AgentSnapshot[]): PresentedObserverFrame {
  const regions: readonly RegionSnapshot[] = [region("spring", ["ridge"]), region("ridge", [])];
  return {
    runId: "family-a-run", sourceKey: "fixture:family-a-run", revision: 2,
    firstCursor: 0, lastCursor: 1, source: "fixture", ingestedCursor: 1, presentedCursor: 0,
    world: {
      exactBaseCursor: 0, projectedThroughCursor: 0, worldTime: 0,
      agents: agents.map((value) => ({ completeness: "exact", value })),
      regions: regions.map((value) => ({ completeness: "exact", value })),
      homes: [], ruins: [], pendingProposals: [],
    },
    scene: null, selection: null,
    backlog: { pendingMoments: 1, firstPendingCursor: 1, lastPendingCursor: 1, state: "behind", label: "1 moment" },
    transport: { connection: "live", ingestedCursor: 1, retryable: true },
  };
}

function region(name: string, connections: readonly string[]): RegionSnapshot {
  return { name, description: name, connections: [...connections], energy_rate: 1, materials_rate: 1, current_energy: 100, current_materials: 100, max_energy: 100, max_materials: 100 };
}

function placement(agents: readonly AgentSnapshot[], arriving = false): PlacementLedgerSnapshot {
  const springRecipe = recipeFor("spring");
  const ridgeRecipe = recipeFor("ridge");
  return {
    revision: 1,
    agents: new Map(agents.map((value, index) => {
      const regionId = value.id === "traveler" && arriving ? "ridge" : value.position;
      const recipe = regionId === "ridge" ? ridgeRecipe : springRecipe;
      const point = tileCenter(recipe.stagingAnchors[index % recipe.stagingAnchors.length]!);
      return [value.id, { regionId, point, anchorKind: "staging" }];
    })),
    homes: new Map(), districtsByRegion: new Map(),
  };
}

function recipeFor(regionId: "spring" | "ridge") {
  const regions = [region("spring", ["ridge"]), region("ridge", [])];
  const target = regions.find((value) => value.name === regionId)!;
  return createRegionMapRecipe(createRegionMapIdentity(stableHash("family-a-run"), target, regions));
}

/**
 * Independent oracle mirroring `selectDeferredArrivalStagingPoint`'s nearest-8,
 * hash-tie-broken selection (C-fix-2: bounded-distance deferred arrival goal).
 */
function nearestStagingPointFixture(
  stagingPoints: readonly Readonly<{ x: number; y: number }>[],
  gateCenter: Readonly<{ x: number; y: number }>,
) {
  const ranked = stagingPoints
    .map((point, index) => ({
      point,
      index,
      distance: Math.hypot(point.x - gateCenter.x, point.y - gateCenter.y),
    }))
    .sort((left, right) => left.distance - right.distance || left.index - right.index);
  const nearby = ranked.slice(0, Math.min(8, ranked.length));
  return (hashSeed: string): Readonly<{ x: number; y: number }> =>
    nearby[stableHash(hashSeed) % nearby.length]!.point;
}

function identity(frameValue: PresentedObserverFrame) {
  return {
    runId: frameValue.runId, sourceKey: frameValue.sourceKey, revision: frameValue.revision,
    firstCursor: frameValue.firstCursor, lastCursor: frameValue.lastCursor,
  };
}
