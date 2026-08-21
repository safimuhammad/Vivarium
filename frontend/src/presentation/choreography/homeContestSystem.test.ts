import { describe, expect, it } from "vitest";

import type { AgentSnapshot, HomeSnapshot, RegionSnapshot } from "../../app/schemas";
import { tileCenter } from "../../renderer2d/map/regionMap";
import { createRegionMapIdentity } from "../../renderer2d/production/maps/RegionMapIdentity";
import { createRegionMapRecipe, type RegionMapRecipeV1 } from "../../renderer2d/production/maps/RegionMapRecipe";
import { stableHash } from "../../renderer2d/production/maps/directedTopology";
import { PlacementLedger } from "../../renderer2d/production/placement/PlacementLedger";
import type { PlacementLedgerSnapshot } from "../../renderer2d/production/placement/PlacementLedger";
import { LayeredHumanActor } from "../../renderer2d/production/actors/LayeredHumanActor";
import {
  PRODUCTION_ASSET_MANIFEST,
  type ProductionAssetLease,
} from "../../renderer2d/production/assets/productionManifest";
import { createProductionSceneCommandResolver } from "../../renderer2d/production/ProductionSceneCommandResolver";
import type { NavigationGrid } from "../../renderer2d/production/navigation/navigation";
import { BeatDirector, type StoryMoment } from "../BeatDirector";
import type {
  PresentedObserverFrame,
  PresentedRecord,
  PresentedWorldView,
  ProvisionalHomeVisualIntent,
} from "../contracts";
import { parsePresentedEvent, type PresentedEventType, type TypedPresentedEvent } from "../eventPayloads";
import {
  CHRONICLE_CATALOG,
  type ChronicleManifest,
} from "../fixtures/chronicleCatalog";
import { PresentedWorldModel } from "../PresentedWorldModel";
import { createSceneExecutor } from "./SceneExecutor";
import type { ChoreographyContext, ChoreographyDefinition, ChoreographyPlan } from "./contracts";
import { HOME_CONTEST_SYSTEM_CHOREOGRAPHIES } from "./homeContestSystem";
import { homeFootprintExclusionRects } from "../../renderer2d/production/productionGeometry";
import {
  homeExclusionsForRegion,
  recipePlotForDoor,
  structureStandingPoint,
} from "./interactionContact";
import { LIFECYCLE_MOVEMENT_COMMUNICATION_RESOURCE_DEFINITIONS } from "./lifecycleMovementCommunicationResource";
import { certifiedProductionRouteBudgetMs } from "./productionLocomotionTiming";

const TYPES = [
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
] as const;

/**
 * Contest beats: their primary actor walks to the structure and STAYS there
 * (see `contestPlan`'s "no return leg" note), unlike every other home beat,
 * whose actor still walks back after using its own home.
 */
const CONTEST_CASES = [
  ["C07", "home_breached"],
  ["C07", "home_thieved"],
  ["C08", "home_colonized"],
] as const;

/**
 * Where a home beat's actor actually stands.
 *
 * NOT the authored door anchor: that point sits inside the shelter's 128px
 * render rect and, measured against the standing envelope, is illegal under
 * the renderer's own apply-time exclusion gate -- routing bodies to it
 * produced moves the renderer dropped in silence. `structureStandingPoint`
 * resolves it to the nearest legal spot in front of the doorway; these tests
 * assert against that same resolution rather than re-deriving it.
 */
/** {@link doorStandingPointFor} for a door whose home may not be in the ledger yet. */
function standingPointForDoor(
  recipe: RegionMapRecipeV1,
  door: Readonly<{ x: number; y: number }>,
): Readonly<{ x: number; y: number }> {
  const plot = recipePlotForDoor(recipe, door);
  const standing = structureStandingPoint(
    door,
    plot,
    recipe,
    plot === null ? [] : homeFootprintExclusionRects(plot),
  );
  if (standing === null) throw new Error(`no legal standing point for door ${door.x},${door.y}`);
  return standing;
}

function doorStandingPointFor(
  context: Readonly<{
    placement: PlacementLedgerSnapshot;
    recipes: ReadonlyMap<string, RegionMapRecipeV1>;
  }>,
  homeId: string,
  regionId: string,
): Readonly<{ x: number; y: number }> {
  const door = context.placement.homes.get(homeId)!.door;
  const recipe = context.recipes.get(regionId)!;
  const plot = recipePlotForDoor(recipe, door);
  const exclusions = [
    ...homeExclusionsForRegion(context.placement, context.recipes, regionId),
    ...(plot === null ? [] : homeFootprintExclusionRects(plot)),
  ];
  const standing = structureStandingPoint(door, plot, recipe, exclusions);
  if (standing === null) throw new Error(`no legal standing point for ${homeId}`);
  return standing;
}

describe("home, contest, ruin, and system choreographies", () => {
  it("exports exactly eleven immutable canonical definitions", () => {
    expect(HOME_CONTEST_SYSTEM_CHOREOGRAPHIES.map(({ eventType }) => eventType)).toEqual(TYPES);
    expect(Object.isFrozen(HOME_CONTEST_SYSTEM_CHOREOGRAPHIES)).toBe(true);
    for (const definition of HOME_CONTEST_SYSTEM_CHOREOGRAPHIES) {
      expect(Object.isFrozen(definition)).toBe(true);
      expect(Object.isFrozen(definition.participants)).toBe(true);
      expect(Object.isFrozen(definition.requiredAnchors)).toBe(true);
      expect(Object.isFrozen(definition.duration)).toBe(true);
      expect(definition.contactMarker).not.toBe(definition.consequenceMarker);
      expect(definition.safeCancelMarkers.length).toBeGreaterThan(0);
    }
  });

  it("resolves every home, contest, ruin, and system plan through the production executor", () => {
    const cases = [
      ["C06", "home_built"],
      ["C06", "hearth_used"],
      ["C06", "home_joined"],
      ["C06", "home_left"],
      ["C06", "home_started_hoarding"],
      ["C09", "home_collapsed"],
      ["C07", "home_breached"],
      ["C07", "home_thieved"],
      ["C08", "home_colonized"],
      ["C09", "ruins_scavenged"],
    ] as const;

    for (const [chronicleId, type] of cases) {
      const context = contextFor(chronicleId, type);
      const program = definitionFor(type).resolve(context as never);
      expectExecutorValid(context.frame, context.moment, program);
    }

    const event = syntheticSimulationStarted("fixture-run");
    const moment = singleMoment(event);
    const frame = frameFor("fixture-run");
    const program = definitionFor("simulation_started").resolve({
      moment,
      event,
      frame,
      placement: placement([], []),
      recipes: new Map(),
      reducedMotion: false,
      compactResourceRouting: false,
    });
    expectExecutorValid(frame, moment, program);
  }, 15_000);

  it("reserves a real free Task 6 plot from the untouched C06 placement for a provisional same-ID home", () => {
    const context = contextFor("C06", "home_built");
    const before = [...context.placement.homes];
    const plan = definitionFor("home_built").resolve(context);
    const provisional = plan.phases.flatMap(({ homeIntents }) => homeIntents)
      .find(({ kind }) => kind === "create-provisional") as unknown as Readonly<{
        homeId: string;
        kind: string;
        regionId: string;
        plotId: string;
        plot: Readonly<{ x: number; y: number }>;
        door: Readonly<{ x: number; y: number }>;
      }>;
    const recipe = context.recipes.get("warm_springs")!;
    const shelterPlot = recipe.shelterPlots.find(({ id }) => id === provisional.plotId)!;

    expect([...context.placement.homes]).toEqual(before);
    expect(provisional).toMatchObject({
      homeId: "home_b86b89df",
      kind: "create-provisional",
      regionId: "warm_springs",
      plot: tileCenter(shelterPlot.tile),
      door: tileCenter(shelterPlot.door),
    });
    expect(before.some(([, placement]) => placement.plotId === provisional.plotId)).toBe(false);
    expect(plan.markers.map(({ name }) => name)).toEqual([
      "home_built:foundation",
      "home_built:work-contact",
      "home_built:post",
      "home_built:walls",
      "home_built:roof",
      "home_built:door",
      "home_built:hearth",
      "home_built:consequence",
      "home_built:safe-contact",
      "home_built:safe-exit",
      "home_built:settled",
    ]);
    expect(plan.markers.map(({ name }) => name)).toContain(plan.contactMarker);
    expect(plan.phases.flatMap(({ homeIntents }) => homeIntents)).toContainEqual({
      homeId: "home_b86b89df",
      kind: "build",
      marker: "home_built:work-contact",
    });
    expect(plan.phases.flatMap(({ actorIntents }) => actorIntents)).toContainEqual(expect.objectContaining({
      actorId: "wanderer_001",
      kind: "work",
      target: tileCenter(shelterPlot.door),
    }));
    expect(plan.diagnostics).toContainEqual({
      code: "home-plot-anchor",
      role: null,
      detail: provisional.plotId,
    });
    expect(plan.diagnostics).not.toContainEqual(expect.objectContaining({ code: "missing-home-anchor" }));
    assertOneConsequence(plan);
  });

  it("uses door, hearth, glow, and smoke without inventing occupancy", () => {
    const plan = resolve("C06", "hearth_used");
    expect(plan.phases.flatMap(({ homeIntents }) => homeIntents)).toEqual(expect.arrayContaining([
      { homeId: "home_b86b89df", kind: "door", marker: "hearth_used:door-open" },
      { homeId: "home_b86b89df", kind: "hearth", marker: "hearth_used:consequence" },
      { homeId: "home_b86b89df", kind: "door", marker: "hearth_used:door-close" },
    ]));
    expect(plan.phases.flatMap(({ effectIntents }) => effectIntents).map(({ kind }) => kind))
      .toContain("particle");
    expect(JSON.stringify(plan)).not.toMatch(/occupant|occupancy|inside|resident/i);
  });

  it("narrates a missing home participant at region scope and accepts later checkpoint correction", () => {
    const exact = contextFor("C06", "home_joined");
    const actorId = exact.event.payload.agent_id;
    const missing = {
      ...exact,
      frame: {
        ...exact.frame,
        world: {
          ...exact.frame.world,
          agents: exact.frame.world.agents.filter(({ value }) => value.id !== actorId),
        },
      },
    };
    const fallback = definitionFor("home_joined").resolve(missing);
    const corrected = definitionFor("home_joined").resolve(exact);

    expect(fallback.phases.every(({ focus }) => (
      focus.kind === "region" && focus.id === exact.event.payload.region
    ))).toBe(true);
    expect(fallback.phases.flatMap(({ actorIntents }) => actorIntents)
      .some((intent) => intent.actorId === actorId)).toBe(false);
    expect(fallback.diagnostics).toContainEqual(expect.objectContaining({
      code: "missing-required-participant",
      role: "actor",
    }));
    expect(corrected.phases[0]?.focus).toEqual({ kind: "home", id: exact.event.payload.home_id });
  });

  it.each(["home_joined", "home_left"] as const)(
    "%s retains only authoritative owner and stakeholder IDs from payload",
    (type) => {
      const plan = resolve("C06", type);
      const payload = typedEvent("C06", type).payload;
      const ids = plan.participants.flatMap(({ ids }) => ids);
      expect(ids).toContain(payload.agent_id);
      expect(ids).toContain(payload.owner_id);
      for (const stakeholder of payload.stakeholders) expect(ids).toContain(stakeholder);
      expect(plan.phases.flatMap(({ homeIntents }) => homeIntents).every(({ kind }) => kind === "door"))
        .toBe(true);
    },
  );

  it("leaves home hoard pixels to the consequence snapshot", () => {
    const plan = resolve("C06", "home_started_hoarding");
    expect(plan.phases.flatMap(({ actorIntents }) => actorIntents)).toContainEqual(expect.objectContaining({
      actorId: "wanderer_001",
      kind: "reach",
    }));
    expect(plan.phases.flatMap(({ homeIntents }) => homeIntents).map(({ kind }) => kind))
      .not.toContain("loot");
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({
      code: "durable-home-hoard-at-consequence",
    }));
  });

  it("issues every timed home semantic once so consequence cannot restart it", () => {
    const cases = [
      [resolve("C06", "home_built"), "build"],
      [resolve("C09", "home_collapsed"), "collapse"],
      [resolve("C09", "ruins_scavenged"), "scavenge"],
    ] as const;
    for (const [plan, kind] of cases) {
      expect(plan.phases.flatMap(({ homeIntents }) => homeIntents).filter((intent) => intent.kind === kind))
        .toHaveLength(1);
    }
  });

  it("creates a blank provisional command then starts exactly one native build from hold", () => {
    const context = contextFor("C06", "home_built");
    const plan = definitionFor("home_built").resolve(context);
    const enter = resolvePhaseCommands(context.frame, context.placement, plan, "enter");
    const hold = resolvePhaseCommands(context.frame, context.placement, plan, "hold");
    const create = enter.commands.find(({ kind }) => kind === "create-provisional-home") as unknown as {
      command?: unknown;
    };
    expect(create).toBeDefined();
    expect(create).not.toHaveProperty("command");
    expect(hold.commands.filter((command) =>
      command.kind === "home" && command.command.kind === "build")).toHaveLength(1);
  });

  it("gives collapse terminal priority and commits one matching ruin", () => {
    const plan = resolve("C09", "home_collapsed");
    const homeIds = plan.phases.flatMap(({ homeIntents }) => homeIntents.map(({ homeId }) => homeId));
    expect(new Set(homeIds)).toEqual(new Set(["home_c09"]));
    expect(plan.phases.flatMap(({ homeIntents }) => homeIntents)).toContainEqual({
      homeId: "home_c09",
      kind: "collapse",
      marker: "home_collapsed:contact",
    });
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({ code: "terminal-home-priority" }));
    assertOneConsequence(plan);
  });

  it("G1 polish: gives home_collapsed a dust particle like every sibling structure event", () => {
    const context = contextFor("C09", "home_collapsed");
    const plan = definitionFor("home_collapsed").resolve(context as never);
    const reduced = definitionFor("home_collapsed").resolve({ ...context, reducedMotion: true } as never);

    expect(plan.phases.flatMap(({ effectIntents }) => effectIntents)).toContainEqual({
      kind: "particle",
      sourceId: context.event.payload.owner_id,
      targetId: context.event.payload.home_id,
    });
    expect(reduced.phases.flatMap(({ effectIntents }) => effectIntents)).toEqual([]);
  });

  it("pairs breach outcomes only with a contiguous matching home and intent", () => {
    const theft = resolve("C07", "home_thieved");
    const claim = resolve("C08", "home_colonized");
    expect(theft.diagnostics).toContainEqual(expect.objectContaining({ code: "paired-breach-theft" }));
    expect(claim.diagnostics).toContainEqual(expect.objectContaining({ code: "paired-breach-claim" }));
    expect(theft.phases.flatMap(({ homeIntents }) => homeIntents).map(({ kind }) => kind))
      .toEqual(["damage", "loot"]);
    expect(claim.phases.flatMap(({ homeIntents }) => homeIntents).map(({ kind }) => kind))
      .toEqual(["damage", "claim"]);

    const standalone = resolve("C07", "home_thieved", { single: true });
    expect(standalone.diagnostics).toContainEqual(expect.objectContaining({ code: "standalone-theft-result" }));
    expect(standalone.diagnostics).not.toContainEqual(expect.objectContaining({ code: "paired-breach-theft" }));
  });

  it("binds exact unequal theft shares to their recipients without reciprocal or absent cues", () => {
    const context = contextFor("C07", "home_thieved");
    const payload = {
      ...context.event.payload,
      loot: { materials: 40 },
      loot_shares: { wanderer_002: 13, wanderer_004: 27 },
      recipients: ["wanderer_002", "wanderer_004"],
    };
    const plan = definitionFor("home_thieved").resolve({
      ...context,
      event: { ...context.event, payload },
    });
    expect(plan.participants.find(({ role }) => role === "recipient")?.ids).toEqual(payload.recipients);
    const arcs = plan.phases.flatMap(({ effectIntents }) => effectIntents)
      .filter(({ kind }) => kind === "arc");
    expect(arcs).toEqual([
      { kind: "arc", sourceId: payload.breacher_id, targetId: "wanderer_002", label: "13" },
      { kind: "arc", sourceId: payload.breacher_id, targetId: "wanderer_004", label: "27" },
    ]);
    expect(arcs.reduce((sum, cue) => sum + Number((cue as { label?: string }).label), 0))
      .toBe(payload.loot.materials);
    expect(arcs.some(({ targetId }) => targetId === "wanderer_003")).toBe(false);
    expect(arcs.some(({ sourceId }) => sourceId !== payload.breacher_id)).toBe(false);
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({
      code: "loot-materials",
      detail: String(payload.loot.materials),
    }));
  });

  it("uses exact colonization owner/roster and never emits theft intents", () => {
    const plan = resolve("C08", "home_colonized");
    const payload = typedEvent("C08", "home_colonized").payload;
    expect(plan.participants.find(({ role }) => role === "owner")?.ids).toEqual([payload.new_owner_id]);
    expect(plan.participants.find(({ role }) => role === "stakeholder")?.ids)
      .toEqual(payload.new_stakeholders);
    expect(plan.phases.flatMap(({ homeIntents }) => homeIntents).map(({ kind }) => kind))
      .not.toContain("loot");
    expect(JSON.stringify(plan)).not.toContain("loot-crate");
  });

  it.each([
    ["C07", "home_breached", "home_c07"],
    ["C07", "home_thieved", "home_c07"],
    ["C08", "home_breached", "home_c08"],
    ["C08", "home_colonized", "home_c08"],
  ] as const)(
    "routes %s %s physically from its untouched cursor-zero home truth",
    (chronicleId, type, homeId) => {
      const snapshot = CHRONICLE_CATALOG[chronicleId].initialSnapshot;
      const home = snapshot.homes.find(({ home_id: id }) => id === homeId);
      expect(home).toMatchObject({
        home_id: homeId,
        owner_id: "wanderer_001",
        integrity: 50,
        vault_materials: 40,
        status: "standing",
      });

      const context = contextFor(chronicleId, type);
      expect(context.placement.homes.has(homeId)).toBe(true);
      expect(context.frame.world.homes.some(({ value }) => value.home_id === homeId)).toBe(true);
      const plan = definitionFor(type).resolve(context as never);
      const actorIntents = plan.phases.flatMap(({ actorIntents: intents }) => intents);

      expect(plan.diagnostics).toContainEqual(expect.objectContaining({ code: "home-route-reached" }));
      expect(plan.diagnostics).not.toContainEqual(expect.objectContaining({
        code: "missing-home-record",
      }));
      expect(plan.diagnostics).not.toContainEqual(expect.objectContaining({
        code: "missing-home-anchor",
      }));
      expect(plan.diagnostics).not.toContainEqual(expect.objectContaining({
        code: "home-route-fallback",
      }));
      expect(actorIntents.some(({ kind }) => kind === "move")).toBe(true);
      expect(actorIntents.some(({ kind }) => kind === "fade-reposition")).toBe(false);
    },
  );

  it("derives C09 ruin scavenging from the real collapse and travel prefix", () => {
    const context = contextFor("C09", "ruins_scavenged");
    const payload = context.event.payload;
    const priorTypes = CHRONICLE_CATALOG.C09.entries
      .filter(({ cursor }) => cursor < context.event.entry.cursor)
      .map(({ event }) => event.type);

    expect(priorTypes).toEqual([
      "home_collapsed",
      "home_collapsed",
      "agent_left_region",
      "agent_entered_region",
    ]);
    expect(context.frame).toMatchObject({
      firstCursor: 2,
      lastCursor: 4,
      ingestedCursor: 4,
      presentedCursor: 4,
      world: {
        exactBaseCursor: 2,
        projectedThroughCursor: 4,
      },
    });
    expect(context.frame.world.homes.some(({ value }) => value.home_id === payload.home_id)).toBe(false);
    expect(context.frame.world.ruins.find(({ value }) => value.home_id === payload.home_id)?.value)
      .toMatchObject({
        home_id: payload.home_id,
        region: payload.region,
        status: "ruin",
      });
    expect(context.frame.world.agents.find(({ value }) => value.id === payload.agent_id)?.value)
      .toMatchObject({ id: payload.agent_id, position: payload.region });
    expect(context.placement.agents.get(payload.agent_id)).toMatchObject({
      regionId: payload.region,
    });
    expect(context.placement.homes.get(payload.home_id)).toMatchObject({
      regionId: payload.region,
    });

    const plan = definitionFor("ruins_scavenged").resolve(context);
    const actorIntents = plan.phases.flatMap(({ actorIntents: intents }) => intents);
    const outbound = actorIntents.find(({ kind }) => kind === "move");
    expect(plan.phases[0]?.focus).toEqual({ kind: "ruin", id: payload.home_id });
    expect(plan.diagnostics).toContainEqual(expect.objectContaining({ code: "home-route-reached" }));
    expect(plan.diagnostics).not.toContainEqual(expect.objectContaining({ code: "missing-home-record" }));
    expect(plan.diagnostics).not.toContainEqual(expect.objectContaining({ code: "missing-home-anchor" }));
    expect(plan.diagnostics).not.toContainEqual(expect.objectContaining({ code: "home-route-fallback" }));
    expect(outbound?.waypoints?.[0]).toEqual(context.placement.agents.get(payload.agent_id)?.point);
    expect(outbound?.waypoints?.at(-1))
      .toEqual(doorStandingPointFor(context, payload.home_id, payload.region));
    expect(actorIntents.some(({ kind }) => kind === "fade-reposition")).toBe(false);
  });

  it("returns both C09 ruin occurrences to the committed arrival origin before each scene settles", () => {
    const manifest = CHRONICLE_CATALOG.C09;
    const recipes = recipesFor(manifest.seed, manifest.initialSnapshot.regions);
    const arrival = typedEvent("C09", "agent_entered_region");
    const arrivalMoment = new BeatDirector().group(manifest.entries)
      .find((candidate) => candidate.representative.cursor === arrival.entry.cursor);
    if (arrivalMoment === undefined) throw new Error("C09 arrival moment is missing");
    const arrivalCausal = causalPrefixBefore(manifest, arrival.entry.cursor, recipes);
    const arrivalDefinition = LIFECYCLE_MOVEMENT_COMMUNICATION_RESOURCE_DEFINITIONS
      .find(({ eventType }) => eventType === "agent_entered_region");
    if (arrivalDefinition === undefined) throw new Error("arrival choreography is missing");
    const arrivalPlan = arrivalDefinition.resolve({
      moment: arrivalMoment,
      event: arrival,
      frame: arrivalCausal.frame,
      placement: arrivalCausal.placement,
      recipes,
      reducedMotion: false,
    } as never);
    const actorId = arrival.payload.agent_id;
    const committedOrigin = arrivalPlan.phases
      .flatMap(({ actorIntents }) => actorIntents)
      .filter((intent) => intent.actorId === actorId && intent.target !== null)
      .at(-1)?.target ?? null;
    if (committedOrigin === null) throw new Error("C09 arrival has no committed endpoint");

    const actor = layeredActor(actorId, committedOrigin);
    const executor = createSceneExecutor();
    const settledCursors: number[] = [];
    let actorClockMs = 0;
    for (const occurrence of [0, 1] as const) {
      const base = contextFor("C09", "ruins_scavenged", { occurrence });
      const retained = base.placement.agents.get(actorId);
      if (retained === undefined) throw new Error(`C09 scavenger placement ${occurrence} is missing`);
      const placementAtArrival = {
        ...base.placement,
        agents: new Map(base.placement.agents).set(actorId, {
          ...retained,
          point: committedOrigin,
          anchorKind: `arrival:${arrival.payload.from_region}`,
        }),
      };
      const context = { ...base, placement: placementAtArrival };
      const plan = definitionFor("ruins_scavenged").resolve(context);
      const moves = plan.phases.flatMap(({ actorIntents }) => actorIntents)
        .filter(({ actorId: candidate, kind }) => candidate === actorId && kind === "move");
      expect(actor.snapshot().position, `occurrence ${occurrence} visual origin`).toEqual(committedOrigin);
      expect(moves, `occurrence ${occurrence} route pair`).toHaveLength(2);
      expect(moves[0]!.waypoints?.[0], `occurrence ${occurrence} outbound origin`).toEqual(committedOrigin);
      expect(moves[1]!.waypoints, `occurrence ${occurrence} reversed return`)
        .toEqual([...(moves[0]!.waypoints ?? [])].reverse());
      expect(moves[1]!.target, `occurrence ${occurrence} return target`).toEqual(committedOrigin);
      if (occurrence === 1) {
        expect(context.event.payload.remnant_materials).toBe(0);
        expect(plan.diagnostics).toContainEqual(expect.objectContaining({
          code: "zero-remnant-ruin-persists",
        }));
        expect(plan.phases.flatMap(({ homeIntents }) => homeIntents)).toContainEqual({
          homeId: context.event.payload.home_id,
          kind: "scavenge",
          marker: "ruins_scavenged:contact",
          remnantMaterialsAfter: 0,
        });
      }

      const token = executor.start({ moment: context.moment, program: plan }, {
        runId: context.frame.runId,
        sourceKey: context.frame.sourceKey,
        revision: context.frame.revision,
        firstCursor: context.frame.firstCursor,
        lastCursor: context.frame.lastCursor,
      });
      const consequenceAt = plan.markers.find(({ role }) => role === "consequence")!.atMs;
      expect(executor.advance(consequenceAt)).toContainEqual(expect.objectContaining({
        kind: "consequence-marker",
        sceneToken: token,
      }));
      executor.acknowledgePublishedConsequence(token, context.frame.revision + 1, false, 0);

      for (const phase of plan.phaseWindows) {
        const batch = resolvePhaseCommands(context.frame, context.placement, plan, phase.phase);
        for (const command of batch.commands) {
          if (command.kind === "actor" && command.actorId === actorId) {
            actor.apply(command.command, actorClockMs + phase.startMs);
          }
        }
        driveActorUntil(
          actor,
          actorClockMs + phase.endMs,
          60,
          actorClockMs + phase.startMs,
        );
      }

      expect(actor.snapshot(), `occurrence ${occurrence} pre-settlement actor`).toMatchObject({
        position: committedOrigin,
        activeAction: null,
        terminal: false,
      });
      expect(executor.snapshot().settled).toBe(false);
      expect(executor.advance(plan.durationMs)).toContainEqual({
        kind: "scene-settled",
        sceneToken: token,
      });
      settledCursors.push(context.event.entry.cursor);
      actorClockMs += plan.durationMs + 100;
    }
    expect(settledCursors).toEqual(
      typedEvents("C09", "ruins_scavenged").map(({ entry }) => entry.cursor),
    );
  });

  it("scavenges the exact ruin while retaining zero-remnant rubble", () => {
    const zero = resolve("C09", "ruins_scavenged", { occurrence: 1 });
    const payload = typedEvents("C09", "ruins_scavenged")[1]!.payload as Extract<
      TypedPresentedEvent,
      { readonly type: "ruins_scavenged" }
    >["payload"];
    expect(payload.remnant_materials).toBe(0);
    expect(zero.phases.flatMap(({ homeIntents }) => homeIntents)).toContainEqual({
      homeId: payload.home_id,
      kind: "scavenge",
      marker: "ruins_scavenged:contact",
      remnantMaterialsAfter: 0,
    });
    expect(zero.diagnostics).toContainEqual(expect.objectContaining({ code: "zero-remnant-ruin-persists" }));
    expect(JSON.stringify(zero)).not.toMatch(/remove|delete|sweep/);
  });

  it("retains legal Task 6 home and ruin routes before contact", () => {
    const cases = [
      ["C06", "home_built"],
      ["C06", "hearth_used"],
      ["C06", "home_joined"],
      ["C06", "home_left"],
      ["C06", "home_started_hoarding"],
      ["C07", "home_breached"],
      ["C07", "home_thieved"],
      ["C08", "home_colonized"],
      ["C09", "ruins_scavenged"],
    ] as const;
    for (const [chronicleId, type] of cases) {
      const context = contextFor(chronicleId, type);
      const plan = definitionFor(type).resolve(context as never);
      const phaseIndex = plan.phases.findIndex(({ actorIntents }) =>
        actorIntents.some(({ kind }) => kind === "move"));
      const move = plan.phases[phaseIndex]!.actorIntents.find(({ kind }) => kind === "move")!;
      const contactIndex = plan.phases.findIndex(({ actorIntents }) =>
        actorIntents.some(({ kind }) => (
          kind === "work" || kind === "reach" || kind === "kneel" || kind === "gather"
        )));
      const recipe = context.recipes.get(plan.regionId!)!;
      expect(move.waypoints?.length, type).toBeGreaterThanOrEqual(4);
      expect(contactIndex, type).toBeGreaterThan(phaseIndex);
      assertLegalWaypoints(move.waypoints ?? [], recipe);
    }
  });

  it("reuses the deterministic build plot while a projected home awaits durable placement", () => {
    const buildContext = contextFor("C06", "home_built");
    const buildPlan = definitionFor("home_built").resolve(buildContext);
    const provisional = buildPlan.phases.flatMap(({ homeIntents }) => homeIntents)
      .find(({ kind }) => kind === "create-provisional") as ProvisionalHomeVisualIntent;
    const base = contextFor("C06", "home_joined");
    const home = fixtureHome(base.event.payload.home_id, base.event.payload.region);
    const context = {
      ...base,
      frame: {
        ...base.frame,
        world: {
          ...base.frame.world,
          homes: [projected(home)],
        },
      },
      placement: {
        ...base.placement,
        homes: new Map(),
      },
    };
    const plan = definitionFor("home_joined").resolve(context);
    const move = plan.phases.find(({ phase }) => phase === "enter")!.actorIntents
      .find(({ kind }) => kind === "move");

    expect(move?.waypoints?.[0]).toEqual(base.placement.agents.get(base.event.payload.agent_id)!.point);
    // The route ends at the plot's own legal standing point in front of the
    // doorway, never on the authored door anchor itself -- that point is inside
    // the shelter's render rect and illegal for a body. The plot is resolved
    // from the RECIPE so a home still awaiting durable placement is excluded
    // too (otherwise the visitor walks into a house that is about to exist).
    expect(move?.waypoints?.at(-1)).toEqual(standingPointForDoor(
      base.recipes.get(base.event.payload.region)!,
      provisional.door,
    ));
    expect(plan.diagnostics).toContainEqual({
      code: "home-door-anchor",
      role: null,
      detail: `${provisional.door.x},${provisional.door.y}`,
    });
    expect(plan.diagnostics).not.toContainEqual(expect.objectContaining({
      code: "home-route-fallback",
    }));
  });

  it("allocates multiple projected homes in the same deterministic order as the live ledger", () => {
    const base = contextFor("C06", "home_joined");
    const target = fixtureHome(base.event.payload.home_id, base.event.payload.region);
    const district = base.recipes.get(target.region)!.districts[0]!;
    const targetStart = stableHash(target.home_id) % district.shelterPlots.length;
    const earlierId = Array.from({ length: 1_000 }, (_, index) => `a_projected_home_${index}`)
      .find((candidate) => stableHash(candidate) % district.shelterPlots.length === targetStart);
    if (earlierId === undefined) throw new Error("failed to construct a projected plot collision");
    const earlier = { ...fixtureHome(earlierId, target.region), built_at: target.built_at };
    const recipes = [...base.recipes.values()];
    const expectedLedger = PlacementLedger.reconstruct(recipes, {
      agents: CHRONICLE_CATALOG.C06.initialSnapshot.agents,
      homes: [earlier, target],
    });
    const expected = expectedLedger.snapshot().homes.get(target.home_id)!;
    const context = {
      ...base,
      frame: {
        ...base.frame,
        world: {
          ...base.frame.world,
          homes: [projected(target), projected(earlier)],
        },
      },
      placement: { ...base.placement, homes: new Map() },
    };
    const plan = definitionFor("home_joined").resolve(context);
    const outbound = plan.phases.find(({ phase }) => phase === "enter")!.actorIntents
      .find(({ kind }) => kind === "move")!;

    expect(outbound.waypoints?.at(-1)).toEqual(standingPointForDoor(
      base.recipes.get(target.region)!,
      expected.door,
    ));
  });

  it("preserves an exact off-center birth placement through outbound and reversed home travel", () => {
    const base = contextFor("C06", "home_joined");
    const actorId = base.event.payload.agent_id;
    const retained = base.placement.agents.get(actorId)!;
    const exactStart = { x: retained.point.x + 8, y: retained.point.y };
    const context = {
      ...base,
      placement: {
        ...base.placement,
        agents: new Map(base.placement.agents).set(actorId, {
          ...retained,
          point: exactStart,
          anchorKind: "birth:wanderer_001",
        }),
      },
    };
    const plan = definitionFor("home_joined").resolve(context);
    const moves = plan.phases.flatMap(({ actorIntents }) => actorIntents)
      .filter(({ kind }) => kind === "move");

    expect(moves).toHaveLength(2);
    expect(moves[0]?.waypoints?.[0]).toEqual(exactStart);
    expect(moves[1]?.waypoints?.at(-1)).toEqual(exactStart);
    expect(moves[1]?.waypoints).toEqual([...(moves[0]?.waypoints ?? [])].reverse());
  });

  it("reverses every physical home and ruin route before the scene can settle", () => {
    const cases = [
      ["C06", "home_built"],
      ["C06", "hearth_used"],
      ["C06", "home_joined"],
      ["C06", "home_left"],
      ["C06", "home_started_hoarding"],
      ["C09", "ruins_scavenged"],
    ] as const;
    for (const [chronicleId, type] of cases) {
      const context = contextFor(chronicleId, type);
      const plan = definitionFor(type).resolve(context as never);
      const outbound = plan.phases.find(({ phase }) => phase === "enter")!.actorIntents
        .find(({ kind }) => kind === "move")!;
      const returning = plan.phases.flatMap(({ actorIntents }) => actorIntents)
        .find((intent) => intent.kind === "move" && intent.actorId === outbound.actorId && intent !== outbound);
      const recover = plan.phaseWindows.find(({ phase }) => phase === "recover")!;

      expect(returning?.waypoints, `${type} return route`).toEqual([...(outbound.waypoints ?? [])].reverse());
      expect(returning?.target, `${type} return target`).toEqual(outbound.waypoints?.[0]);
      expect(recover.endMs - recover.startMs, `${type} return budget`)
        .toBeGreaterThanOrEqual(certifiedProductionRouteBudgetMs(returning?.waypoints ?? [], 48));
    }
  });

  // CONVERGENCE: a contest beat's raider STAYS at the house it breached, looted
  // or claimed. The old shape walked him back to his staging anchor for the
  // second half of the beat, while the loot/claim chrome was still on screen --
  // the exact opposite of the owner's "raider stands AT the house" mandate, and
  // the reason the beat director had to frame a widening gap.
  it("keeps every contest primary at the house it contested instead of walking it home", () => {
    for (const [chronicleId, type] of CONTEST_CASES) {
      const context = contextFor(chronicleId, type);
      const plan = definitionFor(type).resolve(context as never);
      const outbound = plan.phases.find(({ phase }) => phase === "enter")!.actorIntents
        .find(({ kind }) => kind === "move")!;
      const primaryMoves = plan.phases.flatMap(({ actorIntents }) => actorIntents)
        .filter((intent) => intent.kind === "move" && intent.actorId === outbound.actorId);
      const contactPoint = outbound.waypoints!.at(-1)!;

      expect(primaryMoves, `${type} primary walks once`).toHaveLength(1);
      for (const phase of ["recover", "exit"] as const) {
        const intent = plan.phases.find((candidate) => candidate.phase === phase)!.actorIntents
          .find((candidate) => candidate.actorId === outbound.actorId);
        expect(intent?.kind, `${type} ${phase} kind`).toBe("idle");
        expect(intent?.target, `${type} ${phase} target`).toEqual(contactPoint);
      }
    }
  });

  it("replaces reduced-motion travel with endpoint- and facing-identical repositioning", () => {
    const cases = [
      ["C06", "home_built"],
      ["C06", "hearth_used"],
      ["C06", "home_joined"],
      ["C06", "home_left"],
      ["C06", "home_started_hoarding"],
      ["C07", "home_breached"],
      ["C07", "home_thieved"],
      ["C08", "home_colonized"],
      ["C09", "ruins_scavenged"],
    ] as const;
    for (const [chronicleId, type] of cases) {
      const context = contextFor(chronicleId, type);
      const standard = definitionFor(type).resolve(context as never);
      const reduced = definitionFor(type).resolve({ ...context, reducedMotion: true } as never);
      const standardMoves = standard.phases.flatMap(({ actorIntents }) => actorIntents)
        .filter(({ kind }) => kind === "move");
      const reducedIntents = reduced.phases.flatMap(({ actorIntents }) => actorIntents);
      const reducedRepositions = reducedIntents.filter(({ kind }) => kind === "fade-reposition");

      // Contest events may stage a co-present supporting cast; the primary
      // actor always has an outbound/return pair, but a supporting participant
      // who arrives late enough to land in the terminal "exit" bucket holds
      // its pose through to the end of the scene with no separate return leg
      // (G2 review round 2: giving every supporting participant a return leg
      // regardless of how late they arrived would force choosing between
      // firing that return before they finish arriving -- a cutoff -- or
      // barrier-waiting the whole scene on them again).
      const moverIds = [...new Set(standardMoves.map(({ actorId }) => actorId))];
      const primaryMoverId = standardMoves[0]!.actorId;
      for (const moverId of moverIds) {
        const moves = standardMoves.filter((move) => move.actorId === moverId);
        expect(moves.length, `${type} ${moverId} outbound(/return)`).toBeGreaterThanOrEqual(1);
        expect(moves.length, `${type} ${moverId} outbound(/return)`).toBeLessThanOrEqual(2);
      }
      // A contest primary stays at the house (one move); every other home
      // beat's primary still walks home afterwards (outbound + return).
      const contest = CONTEST_CASES.some(([, contestType]) => contestType === type);
      expect(standardMoves.filter((move) => move.actorId === primaryMoverId), `${type} primary legs`)
        .toHaveLength(contest ? 1 : 2);
      expect(reducedIntents.some(({ kind }) => kind === "move"), `${type} reduced travel`).toBe(false);
      expect(reducedRepositions, `${type} reduced endpoints`).toEqual(standardMoves.map((move) => ({
        actorId: move.actorId,
        kind: "fade-reposition",
        target: move.target,
        facing: routeEndpointFacing(move.waypoints ?? []),
        marker: move.marker,
      })));
      expect(reduced.durationMs).toBe(standard.durationMs);
      expect(reduced.phaseWindows).toEqual(standard.phaseWindows);
      expect(reduced.markers).toEqual(standard.markers);

      const primaryMoves = standardMoves.filter(({ actorId }) => actorId === standardMoves[0]!.actorId);
      const reducedActor = layeredActor(
        primaryMoves[0]!.actorId,
        primaryMoves[0]!.waypoints![0]!,
        "south",
        true,
      );
      // A contest primary has no recover leg to reposition -- it stays at the
      // house -- so only its arrival is compared across motion modes.
      for (const phase of (contest ? ["enter"] : ["enter", "recover"]) as readonly ("enter" | "recover")[]) {
        const batch = resolvePhaseCommands(context.frame, context.placement, reduced, phase);
        expect(batch.commands).toContainEqual(expect.objectContaining({
          kind: "actor",
          command: expect.objectContaining({ kind: "reposition", reason: "reduced-motion" }),
        }));
        expect(batch.commands.some((command) => (
          command.kind === "actor" && command.command.kind === "move"
        ))).toBe(false);
        const phaseStartMs = reduced.phaseWindows.find((window) => window.phase === phase)!.startMs;
        for (const command of batch.commands) {
          if (command.kind === "actor" && command.actorId === primaryMoves[0]!.actorId) {
            reducedActor.apply(command.command, phaseStartMs);
          }
        }
        // Ground truth is the STANDARD (full-motion) plan's own RESOLVED move
        // command for this phase -- not the plan's raw, pre-resolver actor
        // intent. `SpatialDirector.spreadCoincidentTargets`
        // (ProductionSceneCommandResolver.ts, wired in by
        // `.superpowers/sdd/motion-bugs-report.md`'s SpatialDirector build) can
        // displace a home-contest participant's rendered endpoint off of the
        // literal door point when another present participant's independently
        // -computed target collides with it (a real, common shape for these
        // exact multi-participant contest fixtures -- both C07 home_breached
        // supporting-cast members route to the identical door tile). The
        // reduced-motion reposition must land wherever the resolved standard
        // walk would actually have arrived, spread included, or the two motion
        // modes would visibly disagree on the being's final position.
        const standardBatch = resolvePhaseCommands(context.frame, context.placement, standard, phase);
        const standardMoveCommand = standardBatch.commands.find((command) => (
          command.kind === "actor"
          && command.actorId === primaryMoves[0]!.actorId
          && command.command.kind === "move"
        ));
        if (
          standardMoveCommand === undefined
          || standardMoveCommand.kind !== "actor"
          || standardMoveCommand.command.kind !== "move"
        ) {
          throw new Error(`missing resolved ${type} ${phase} move command`);
        }
        const resolvedWaypoints = standardMoveCommand.command.waypoints;
        expect(reducedActor.snapshot()).toMatchObject({
          position: resolvedWaypoints.at(-1),
          facing: routeEndpointFacing(resolvedWaypoints),
          activeAction: null,
        });
        expect(reducedActor.nextDeadlineMs()).toBeNull();
      }
    }
  });

  it("uses the exact frozen Chronicle seed for every injected C06-C09 recipe", () => {
    for (const [chronicleId, type] of [
      ["C06", "home_built"],
      ["C07", "home_thieved"],
      ["C08", "home_colonized"],
      ["C09", "ruins_scavenged"],
    ] as const) {
      const context = contextFor(chronicleId, type);
      const manifest = CHRONICLE_CATALOG[chronicleId];
      for (const region of manifest.initialSnapshot.regions) {
        const expected = createRegionMapRecipe(createRegionMapIdentity(
          manifest.seed,
          region,
          manifest.initialSnapshot.regions,
        ));
        expect(context.recipes.get(region.name)?.identityHash).toBe(expected.identityHash);
      }
    }
  });

  it("fits every standard-motion C home/ruin route before Director hold at 48px/s under 30/60/120Hz clocks", () => {
    const cases = [
      ["C06", "home_built"],
      ["C06", "hearth_used"],
      ["C06", "home_joined"],
      ["C06", "home_left"],
      ["C06", "home_started_hoarding"],
      ["C07", "home_breached"],
      ["C07", "home_thieved"],
      ["C08", "home_colonized"],
      ["C09", "ruins_scavenged"],
    ] as const;
    for (const [chronicleId, type] of cases) {
        const context = contextFor(chronicleId, type);
        const plan = definitionFor(type).resolve(context as never);
        const enter = plan.phases.find(({ phase }) => phase === "enter")!;
        const move = enter.actorIntents.find(({ kind }) => kind === "move")!;
        const route = move.waypoints!;
        const holdAt = plan.phaseWindows.find(({ phase }) => phase === "hold")!.startMs;
        const expectedTravelMs = routeDistance(route) / 48 * 1_000;
        expect(holdAt, `${type} declared route fit`).toBeGreaterThan(expectedTravelMs);
        expect(plan.durationMs).toBeLessThanOrEqual(definitionFor(type).duration.maxMs);

        // Ground truth for arrival is the RESOLVED move command's own final
        // waypoint, not the plan's raw pre-resolver `route`. A multi-
        // participant contest scene routes every present participant (primary
        // and supporting cast alike) to the literal same door point;
        // `SpatialDirector.spreadCoincidentTargets`
        // (ProductionSceneCommandResolver.ts, from `.superpowers/sdd/
        // motion-bugs-report.md`'s SpatialDirector build) is the sole owner of
        // displacing whichever of them collides onto a small ring so they
        // don't render fused together -- appended as an extra hop past the
        // authored route's own endpoint. `resolveContestTiming`
        // (homeContestSystem.ts) predicts that same deterministic hop to
        // widen the affected participant's own arrival/return budget
        // (`withPredictedSpreadHop`), so "does the actor arrive in time" must
        // be judged against the same resolved endpoint the budget was sized
        // for, not the pre-spread door point.
        const enterBatch = resolvePhaseCommands(context.frame, context.placement, plan, "enter");
        const moveCommand = enterBatch.commands.find((command) =>
          command.kind === "actor" && command.actorId === move.actorId && command.command.kind === "move");
        if (!moveCommand || moveCommand.kind !== "actor" || moveCommand.command.kind !== "move") {
          throw new Error(`missing ${type} move command`);
        }
        const resolvedTarget = moveCommand.command.waypoints.at(-1)!;

        for (const hz of [30, 60, 120]) {
          for (const initialFacing of ["north", "east", "south", "west"] as const) {
            const actor = layeredActor(move.actorId, route[0]!, initialFacing);
            actor.apply(moveCommand.command, 0);
            driveActorUntil(actor, holdAt, hz);
            expect(distance(actor.snapshot().position, resolvedTarget), `${type} ${hz}Hz ${initialFacing} arrival`)
              .toBeLessThanOrEqual(0.5);

            const holdBatch = resolvePhaseCommands(context.frame, context.placement, plan, "hold");
            const contactCommands = holdBatch.commands.filter((command) =>
              command.kind === "actor" && command.actorId === move.actorId
              && command.command.kind === "play-body");
            expect(contactCommands, `${type} ${hz}Hz contact`).toHaveLength(1);
            actor.apply((contactCommands[0] as Extract<typeof contactCommands[number], { kind: "actor" }>).command, holdAt);
            expect(distance(actor.snapshot().position, resolvedTarget)).toBeLessThanOrEqual(0.5);

            const recover = plan.phaseWindows.find(({ phase }) => phase === "recover")!;
            const recoverBatch = resolvePhaseCommands(context.frame, context.placement, plan, "recover");
            const returnCommand = recoverBatch.commands.find((command) =>
              command.kind === "actor" && command.actorId === move.actorId && command.command.kind === "move");
            if (CONTEST_CASES.some(([, contestType]) => contestType === type)) {
              // A contest primary has no return leg: it stays at the house it
              // contested, and the recover phase must not walk it anywhere.
              expect(returnCommand, `${type} contest primary stays`).toBeUndefined();
              expect(distance(actor.snapshot().position, resolvedTarget)).toBeLessThanOrEqual(0.5);
              continue;
            }
            if (!returnCommand || returnCommand.kind !== "actor" || returnCommand.command.kind !== "move") {
              throw new Error(`missing ${type} return command`);
            }
            const resolvedReturnTarget = returnCommand.command.waypoints.at(-1)!;
            actor.apply(returnCommand.command, recover.startMs);
            driveActorUntil(actor, recover.endMs, hz, recover.startMs);
            expect(distance(actor.snapshot().position, resolvedReturnTarget), `${type} ${hz}Hz ${initialFacing} return`)
              .toBeLessThanOrEqual(0.5);
          }
        }
    }
  }, 15_000);

  it.each([
    ["C06", "home_built", "builder_id", "build"],
    ["C07", "home_thieved", "breacher_id", "loot"],
    ["C09", "ruins_scavenged", "agent_id", "scavenge"],
  ] as const)(
    "uses observer-safe staging without false contact when %s %s has no actor placement",
    (chronicleId, type, actorField, durableKind) => {
      const base = contextFor(chronicleId, type);
      const actorId = String((base.event.payload as unknown as Record<string, unknown>)[actorField]);
      const context = {
        ...base,
        placement: {
          ...base.placement,
          agents: new Map([...base.placement.agents].filter(([id]) => id !== actorId)),
        },
      };
      const plan = definitionFor(type).resolve(context as never);

      assertObserverSafeRouteFallback(context, plan, actorId, "missing-placement", durableKind);
    },
  );

  it("uses observer-safe staging without false contact for a wrong-region contest actor", () => {
    const base = contextFor("C08", "home_colonized");
    const actorId = base.event.payload.breacher_id;
    const retained = base.placement.agents.get(actorId)!;
    const context = {
      ...base,
      placement: {
        ...base.placement,
        agents: new Map(base.placement.agents).set(actorId, {
          ...retained,
          regionId: "wrong-region",
        }),
      },
    };
    const plan = definitionFor("home_colonized").resolve(context);

    assertObserverSafeRouteFallback(context, plan, actorId, "wrong-region", "claim");
  });

  it("uses observer-safe staging without false contact when the declared home path is unreachable", () => {
    const base = contextFor("C09", "ruins_scavenged");
    const actorId = base.event.payload.agent_id;
    const regionId = base.event.payload.region;
    const recipe = base.recipes.get(regionId)!;
    const collision = new Uint8Array(recipe.grid.collision.length).fill(1);
    const actorPoint = base.placement.agents.get(actorId)!.point;
    const homePoint = base.placement.homes.get(base.event.payload.home_id)!.door;
    for (const point of [actorPoint, homePoint, ...recipe.stagingAnchors.map(tileCenter)]) {
      const column = Math.floor(point.x / 32);
      const row = Math.floor(point.y / 32);
      collision[row * recipe.grid.columns + column] = 0;
    }
    const blockedRecipe: RegionMapRecipeV1 = {
      ...recipe,
      grid: { ...recipe.grid, collision },
    };
    const context = {
      ...base,
      recipes: new Map(base.recipes).set(regionId, blockedRecipe),
    };
    const plan = definitionFor("ruins_scavenged").resolve(context);

    // With every tile but the actor's own, the raw door tile and the staging
    // anchors blocked, there is no tile a body may legally STAND on to work
    // the ruin (the authored door anchor itself is inside the structure's
    // exclusion), so the beat degrades to observer-safe staging with no false
    // contact -- the same outcome the pre-existing "goal-unreachable" shape
    // produced, reported with the reason that is actually true.
    assertObserverSafeRouteFallback(context, plan, actorId, "no-legal-standing-point", "scavenge");
  });

  it("omits the local actor entirely when no legal staging fallback can be resolved", () => {
    const base = contextFor("C07", "home_breached");
    const actorId = base.event.payload.breacher_id;
    const context = {
      ...base,
      recipes: new Map([...base.recipes].filter(([regionId]) => regionId !== base.event.payload.region)),
    };
    const plan = definitionFor("home_breached").resolve(context);

    expect(plan.diagnostics).toContainEqual(expect.objectContaining({
      code: "home-route-contact-omitted",
      role: "actor",
      detail: expect.stringContaining(`${actorId}:missing-recipe`),
    }));
    expect(plan.phases.flatMap(({ actorIntents }) => actorIntents)
      .filter((intent) => intent.actorId === actorId)).toEqual([]);
    expect(plan.phases.find(({ phase }) => phase === "hold")?.homeIntents).toEqual([]);
    expect(plan.phases.find(({ phase }) => phase === "consequence")?.homeIntents)
      .toContainEqual(expect.objectContaining({ kind: "damage" }));
    expect(plan.phases.find(({ phase }) => phase === "consequence")?.effectIntents)
      .toContainEqual(expect.objectContaining({ kind: "vignette" }));
  });

  it("validates simulation run identity and keeps a participant-free static atlas hold in reduced motion", () => {
    const event = syntheticSimulationStarted("run-c00");
    const matching = resolveEvidence(event, frameFor("run-c00"), singleMoment(event));
    const reduced = resolveEvidence(event, frameFor("run-c00"), singleMoment(event), true);
    expect(matching.participants).toEqual([]);
    expect(matching.phases.flatMap(({ actorIntents }) => actorIntents)).toEqual([]);
    expect(matching.phases.flatMap(({ homeIntents }) => homeIntents)).toEqual([]);
    expect(matching.phases.flatMap(({ effectIntents }) => effectIntents)).toContainEqual({
      kind: "atlas-transition",
      sourceId: null,
      targetId: null,
    });
    expect(reduced.phases.find(({ phase }) => phase === "hold")?.effectIntents).toContainEqual({
      kind: "atlas-transition",
      sourceId: null,
      targetId: null,
    });
    expect(reduced.reducedMotionEndpoint).toEqual(matching.reducedMotionEndpoint);
    expect(JSON.stringify(matching)).not.toMatch(/provider|model|latency|token|telemetry/i);
    expect(() => resolveEvidence(event, frameFor("other-run"), singleMoment(event))).toThrow(/run_id/i);
  });

  it("deep-owns deterministic plans and keeps reduced-motion endpoint/markers identical", () => {
    const context = contextFor("C07", "home_thieved");
    const definition = definitionFor("home_thieved");
    const first = definition.resolve(context as never);
    const repeat = definition.resolve(context as never);
    const reduced = definition.resolve({ ...context, reducedMotion: true } as never);

    expect(first).toEqual(repeat);
    expect(first).not.toBe(repeat);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.phases)).toBe(true);
    expect(Object.isFrozen(first.markers)).toBe(true);
    expect(first.reducedMotionEndpoint).toEqual(reduced.reducedMotionEndpoint);
    expect(first.markers).toEqual(reduced.markers);
    expect(reduced.phases.flatMap(({ effectIntents }) => effectIntents)).toEqual([]);
    expect(first.durationMs).toBeGreaterThanOrEqual(definition.duration.minMs);
    expect(first.durationMs).toBeLessThanOrEqual(definition.duration.maxMs);
    assertOneConsequence(first);
  });

  // G2 -- collective staging. A coordinated raid/household event names every
  // participant in its real payload (breachers/recipients/new_stakeholders/
  // stakeholders); prior to G2 only the single primary actor ever animated,
  // so a 2-breacher raid read on-screen exactly like a lone raider.

  it("G2: stages every named breacher approaching and working the door, not just the striker", () => {
    const context = contextFor("C07", "home_breached");
    const payload = context.event.payload;
    expect(payload.breachers).toEqual(["wanderer_002", "wanderer_004"]);
    const supportingId = "wanderer_004";
    const door = context.placement.homes.get(payload.home_id)!.door;

    const plan = definitionFor("home_breached").resolve(context as never);
    const actorIntents = plan.phases.flatMap(({ actorIntents: intents }) => intents);
    const supportingIntents = actorIntents.filter((intent) => intent.actorId === supportingId);
    const supportingMoves = supportingIntents.filter(({ kind }) => kind === "move");

    // The striker still leads: its own outbound move is authored first.
    expect(actorIntents.find(({ kind }) => kind === "move")?.actorId).toBe(payload.breacher_id);
    // On the real C07 fixture wanderer_004's own approach (~15s) lands after
    // the primary's full recover leg starts (a long primary route pushes
    // that phase's floor out) -- it holds its pose through to the end of
    // the scene rather than being cut off mid-route to squeeze in a return.
    expect(supportingMoves).toHaveLength(1);
    expect(supportingMoves[0]?.waypoints?.at(-1))
      .toEqual(doorStandingPointFor(context, payload.home_id, payload.region));
    expect(supportingIntents).toContainEqual(expect.objectContaining({
      actorId: supportingId,
      kind: "work",
      target: door,
      marker: "home_breached:contact",
    }));
  });

  it("G2: stages every named theft recipient gathered and oriented at the door, not re-battering it", () => {
    const context = contextFor("C07", "home_thieved");
    const payload = context.event.payload;
    expect(payload.recipients).toEqual(["wanderer_002", "wanderer_004"]);
    const supportingId = "wanderer_004";
    const door = context.placement.homes.get(payload.home_id)!.door;

    const plan = definitionFor("home_thieved").resolve(context as never);
    const actorIntents = plan.phases.flatMap(({ actorIntents: intents }) => intents);
    const supportingIntents = actorIntents.filter((intent) => intent.actorId === supportingId);

    expect(supportingIntents.filter(({ kind }) => kind === "move")).toHaveLength(1);
    expect(supportingIntents).toContainEqual(expect.objectContaining({
      actorId: supportingId,
      kind: "orient",
      target: door,
      marker: "home_thieved:contact",
    }));
    expect(supportingIntents.some(({ kind }) => kind === "work")).toBe(false);
    // Each recipient still gets its own individually labeled loot arc (G1, unchanged).
    const arcs = plan.phases.flatMap(({ effectIntents }) => effectIntents).filter(({ kind }) => kind === "arc");
    expect(arcs.some(({ targetId }) => targetId === supportingId)).toBe(true);
  });

  it("G2: stages every named new stakeholder gathered at the newly claimed home", () => {
    const context = contextFor("C08", "home_colonized");
    const payload = context.event.payload;
    expect(payload.new_stakeholders).toEqual(["wanderer_002", "wanderer_004"]);
    const supportingId = "wanderer_004";
    const door = context.placement.homes.get(payload.home_id)!.door;

    const plan = definitionFor("home_colonized").resolve(context as never);
    const actorIntents = plan.phases.flatMap(({ actorIntents: intents }) => intents);
    const supportingIntents = actorIntents.filter((intent) => intent.actorId === supportingId);

    expect(supportingIntents.filter(({ kind }) => kind === "move")).toHaveLength(1);
    expect(supportingIntents).toContainEqual(expect.objectContaining({
      actorId: supportingId,
      kind: "orient",
      target: door,
      marker: "home_colonized:contact",
    }));
    expect(supportingIntents.some(({ kind }) => kind === "work")).toBe(false);
  });

  // G2 review round 2 -- dead-waiting fix. groupRouteTiming used to size
  // hold/consequence/recover off the SLOWEST mover, so the primary striker
  // stood idle waiting for a distant supporting participant before its own
  // claim/work could even start. contestPlan now sizes those phases off the
  // PRIMARY's own route only, and slots each supporting participant into the
  // earliest phase that starts at or after their OWN real arrival.

  it("G2 review: hold starts at the primary striker's own arrival, never barriered on a slower supporting participant (C08 colonize)", () => {
    const context = contextFor("C08", "home_colonized");
    const payload = context.event.payload;
    const plan = definitionFor("home_colonized").resolve(context as never);
    const holdStartMs = plan.phaseWindows.find(({ phase }) => phase === "hold")!.startMs;
    // Ground truth for "own arrival" is the RESOLVED move command's own
    // waypoints, not the plan's raw pre-resolver intent. C08 home_colonized
    // is a real coincident-target fixture: the primary striker and
    // "wanderer_004" both independently route to the identical door point,
    // so `SpatialDirector.spreadCoincidentTargets`
    // (ProductionSceneCommandResolver.ts) can displace either one of them --
    // here, the primary itself -- onto a small ring, a hop
    // `resolveContestTiming`'s `withPredictedSpreadHop` (homeContestSystem.ts)
    // already budgets for. Judging "own arrival" against the pre-spread
    // waypoints would silently drop that budgeted hop from the expectation.
    const enterBatch = resolvePhaseCommands(context.frame, context.placement, plan, "enter");
    const resolvedMoveWaypoints = (actorId: string): readonly Readonly<{ x: number; y: number }>[] => {
      const command = enterBatch.commands.find((candidate) => (
        candidate.kind === "actor" && candidate.actorId === actorId && candidate.command.kind === "move"
      ));
      if (command === undefined || command.kind !== "actor" || command.command.kind !== "move") {
        throw new Error(`missing resolved move command for ${actorId}`);
      }
      return command.command.waypoints;
    };
    const primaryArrivalMs = certifiedProductionRouteBudgetMs(resolvedMoveWaypoints(payload.breacher_id), 48);
    const supportingArrivalMs = certifiedProductionRouteBudgetMs(resolvedMoveWaypoints("wanderer_004"), 48);

    // (a) hold starts exactly at the primary's own arrival -- not sooner (it
    // cannot claim before it physically gets there) and not later (no barrier).
    expect(holdStartMs).toBe(primaryArrivalMs);
    // The supporting participant is real and genuinely slower here -- this is
    // the exact scenario the barrier used to wait on.
    expect(supportingArrivalMs).toBeGreaterThan(primaryArrivalMs);
    expect(holdStartMs).toBeLessThan(supportingArrivalMs);
  });

  it("G2 review: no staged participant idles more than 5s between its own arrival and its pose (C08 colonize)", () => {
    const context = contextFor("C08", "home_colonized");
    const plan = definitionFor("home_colonized").resolve(context as never);
    const actorIntents = plan.phases.flatMap((phase) => (
      phase.actorIntents.map((intent) => ({ phase: phase.phase, intent }))
    ));
    const supportingMove = actorIntents.find(({ intent }) => (
      intent.actorId === "wanderer_004" && intent.kind === "move"
    ))!;
    const supportingArrivalMs = certifiedProductionRouteBudgetMs(supportingMove.intent.waypoints ?? [], 48);
    const supportingPose = actorIntents.find(({ intent }) => (
      intent.actorId === "wanderer_004" && (intent.kind === "orient" || intent.kind === "work")
    ))!;
    const poseAtMs = plan.phaseWindows.find(({ phase }) => phase === supportingPose.phase)!.startMs;

    expect(poseAtMs).toBeGreaterThanOrEqual(supportingArrivalMs);
    expect(poseAtMs - supportingArrivalMs).toBeLessThanOrEqual(5_000);
  });

  // TRACKED item (`.superpowers/sdd/terrain-seam-report.md` / `spread-legality-report.md`
  // Concerns #1): `resolveContestTiming`'s own `spreadCoincidentTargets` call predicted a
  // coincident-target ring hop with the same hardcoded `() => true` legality predicate the
  // resolver's real (render-position-owning) call used to have, before that one was threaded to
  // real ground legality. This one's output never reaches a render position -- only
  // `RouteTiming`/`SupportingPlacement` timing numbers leave `resolveContestTiming` -- so the
  // worst case was always a cosmetic timing-prediction desync, never an illegal placement
  // (verified directly: `groupSupportingIntentsByPhase` and every `actorIntent(...)` call in
  // `contestPlan` read `member.route`/`route.target`, the UNTOUCHED original routes, never
  // `resolveContestTiming`'s internal `timedRoute`). It is now threaded via
  // `ChoreographyContext.getNavigationGrid`, mirroring `PlacementLedger.navigationGridFor`.
  it("threads a real navigation grid into the predicted coincident-target spread hop (C08 colonize)", () => {
    // A real coincident-target fixture (see the G2 tests above): the primary striker and
    // "wanderer_004" both independently route to the identical door point.
    const context = contextFor("C08", "home_colonized");
    const regionId = context.event.payload.region;
    const realGrid = context.recipes.get(regionId)!.grid;
    const openGrid: NavigationGrid = {
      columns: realGrid.columns,
      rows: realGrid.rows,
      collision: new Uint8Array(realGrid.collision.length),
    };
    // Every real-world tile resolves out of bounds against a zero-sized grid, and an
    // out-of-bounds tile is treated as blocked (`groundTerrainTileIsOpen`) -- so this rejects
    // every ring candidate without depending on any real recipe's specific geometry.
    const impossibleGrid: NavigationGrid = { columns: 0, rows: 0, collision: new Uint8Array(0) };

    const withoutGrid = definitionFor("home_colonized").resolve(context as never);
    const withOpenGrid = definitionFor("home_colonized").resolve({
      ...context,
      getNavigationGrid: () => openGrid,
    } as never);
    const withImpossibleGrid = definitionFor("home_colonized").resolve({
      ...context,
      getNavigationGrid: () => impossibleGrid,
    } as never);

    // Preserved behaviour: a genuinely open grid reproduces the exact pre-existing (unwired)
    // plan -- no fixture-only caller that omits `getNavigationGrid` is affected by this change.
    expect(withOpenGrid.durationMs).toBe(withoutGrid.durationMs);
    expect(withOpenGrid.phaseWindows).toEqual(withoutGrid.phaseWindows);

    // The predicate is genuinely consulted: forcing every ring candidate illegal makes
    // `spreadCoincidentTargets` fall back to each participant's ORIGINAL (unhopped) point
    // instead of the ring's nearest legal candidate, which changes the predicted timing --
    // proof the grid reaches the actual call, not just the options plumbing.
    expect(withImpossibleGrid.phaseWindows).not.toEqual(withoutGrid.phaseWindows);
  });

  it.each([
    ["C07", "home_breached", "work"],
    ["C07", "home_thieved", "orient"],
    ["C08", "home_colonized", "orient"],
  ] as const)(
    "G2 review: %s %s never poses a supporting participant before its own approach route fully completes",
    (chronicleId, type, poseKind) => {
      const context = contextFor(chronicleId, type);
      const plan = definitionFor(type).resolve(context as never);
      const door = context.placement.homes.get(context.event.payload.home_id)!.door;
      const actorIntents = plan.phases.flatMap((phase) => (
        phase.actorIntents.map((intent) => ({ phase: phase.phase, intent }))
      ));
      const supportingMove = actorIntents.find(({ intent }) => (
        intent.actorId === "wanderer_004" && intent.kind === "move"
      ))!;
      const supportingPose = actorIntents.find(({ intent }) => (
        intent.actorId === "wanderer_004" && intent.kind === poseKind
      ))!;
      const arrivalMs = certifiedProductionRouteBudgetMs(supportingMove.intent.waypoints ?? [], 48);
      const poseAtMs = plan.phaseWindows.find(({ phase }) => phase === supportingPose.phase)!.startMs;

      // (c) late arrivals complete: the route is never truncated (it still
      // ends exactly at the door's own legal standing point) and the pose
      // never fires before that route would have finished walking.
      expect(supportingMove.intent.waypoints?.at(-1))
        .toEqual(doorStandingPointFor(context, context.event.payload.home_id, context.event.payload.region));
      expect(door).not.toEqual(supportingMove.intent.waypoints?.at(-1));
      expect(poseAtMs).toBeGreaterThanOrEqual(arrivalMs);
    },
  );

  it("G2: turns the existing co-resident to face the door on a join, without walking them in", () => {
    const context = contextFor("C06", "home_joined");
    const payload = context.event.payload;
    expect(payload.stakeholders).toEqual(["wanderer_001", "wanderer_002"]);
    const coResidentId = "wanderer_001";
    const door = context.placement.homes.get(payload.home_id)!.door;

    const plan = definitionFor("home_joined").resolve(context as never);
    const coResidentIntents = plan.phases.flatMap(({ actorIntents }) => actorIntents)
      .filter((intent) => intent.actorId === coResidentId);

    expect(coResidentIntents).toEqual([
      expect.objectContaining({ actorId: coResidentId, kind: "orient", target: door, marker: "home_joined:contact" }),
    ]);
  });

  it("G2: turns the remaining co-resident to face the door on a departure, without walking them in", () => {
    const context = contextFor("C06", "home_left");
    const payload = context.event.payload;
    expect(payload.stakeholders).toEqual(["wanderer_002"]);
    const coResidentId = "wanderer_002";
    const door = context.placement.homes.get(payload.home_id)!.door;

    const plan = definitionFor("home_left").resolve(context as never);
    const coResidentIntents = plan.phases.flatMap(({ actorIntents }) => actorIntents)
      .filter((intent) => intent.actorId === coResidentId);

    expect(coResidentIntents).toEqual([
      expect.objectContaining({ actorId: coResidentId, kind: "orient", target: door, marker: "home_left:contact" }),
    ]);
  });

  it("G2: never stages a supporting participant the frame proves is in a different region", () => {
    const base = contextFor("C07", "home_breached");
    const payload = base.event.payload;
    const supportingId = "wanderer_004";
    const context = {
      ...base,
      frame: {
        ...base.frame,
        world: {
          ...base.frame.world,
          agents: base.frame.world.agents.map((record) => (
            record.value.id === supportingId
              ? { ...record, value: { ...record.value, position: "nirvana" } }
              : record
          )),
        },
      },
    };
    const plan = definitionFor("home_breached").resolve(context as never);
    const actorIntents = plan.phases.flatMap(({ actorIntents: intents }) => intents);

    expect(actorIntents.some((intent) => intent.actorId === supportingId)).toBe(false);
    // The striker's own staging is unaffected by an absent supporting cast.
    expect(actorIntents).toContainEqual(expect.objectContaining({
      actorId: payload.breacher_id,
      kind: "work",
    }));
  });
});

function definitionFor<T extends (typeof TYPES)[number]>(type: T): ChoreographyDefinition<T> {
  const definition = HOME_CONTEST_SYSTEM_CHOREOGRAPHIES.find((candidate) => candidate.eventType === type);
  if (!definition) throw new Error(`missing definition ${type}`);
  return definition as unknown as ChoreographyDefinition<T>;
}

function resolve<T extends (typeof TYPES)[number]>(
  chronicleId: "C06" | "C07" | "C08" | "C09",
  type: T,
  options: Readonly<{ single?: boolean; occurrence?: number }> = {},
): ChoreographyPlan {
  const context = contextFor(chronicleId, type, options);
  return definitionFor(type).resolve(context as never);
}

function contextFor<T extends (typeof TYPES)[number]>(
  chronicleId: "C06" | "C07" | "C08" | "C09",
  type: T,
  options: Readonly<{ single?: boolean; occurrence?: number }> = {},
): ChoreographyContext<T> {
  const events = typedEvents(chronicleId, type);
  const evidence = events[options.occurrence ?? 0];
  if (!evidence) throw new Error(`missing ${type}`);
  const entries = CHRONICLE_CATALOG[chronicleId].entries;
  const grouped = new BeatDirector().group(entries);
  const groupedMoment = grouped.find((moment) => moment.representative.cursor === evidence.entry.cursor);
  const moment = options.single || !groupedMoment ? singleMoment(evidence) : groupedMoment;
  const manifest = CHRONICLE_CATALOG[chronicleId];
  const recipes = recipesFor(manifest.seed, manifest.initialSnapshot.regions);
  const causal = causalPrefixBefore(manifest, evidence.entry.cursor, recipes);
  return {
    moment,
    event: evidence as unknown as Extract<TypedPresentedEvent, { readonly type: T }>,
    frame: causal.frame,
    placement: causal.placement,
    recipes,
    reducedMotion: false,
    compactResourceRouting: false,
  };
}

function causalPrefixBefore(
  manifest: ChronicleManifest,
  eventCursor: number,
  recipes: ReadonlyMap<string, RegionMapRecipeV1>,
): Readonly<{
  frame: PresentedObserverFrame;
  placement: PlacementLedgerSnapshot;
}> {
  const checkpoint = [...manifest.checkpoints]
    .filter((record) => (
      record.safety === "safe-world-tick"
      && record.checkpoint.event_cursor < eventCursor
    ))
    .sort((left, right) => (
      left.checkpoint.event_cursor - right.checkpoint.event_cursor
      || left.line - right.line
    ))
    .at(-1);
  const snapshot = checkpoint?.checkpoint.snapshot ?? manifest.initialSnapshot;
  const precedingEntries = manifest.entries.filter(({ cursor }) => (
    cursor > snapshot.event_cursor && cursor < eventCursor
  ));
  precedingEntries.forEach((entry, index) => {
    const expectedCursor = snapshot.event_cursor + index + 1;
    if (entry.cursor !== expectedCursor) {
      throw new Error(
        `${manifest.id} causal prefix expected cursor ${expectedCursor}, received ${entry.cursor}`,
      );
    }
  });

  const model = new PresentedWorldModel(snapshot, {
    runId: manifest.runId,
    sourceKey: `fixture:${manifest.runId}`,
    revision: 1,
    firstCursor: snapshot.event_cursor,
    lastCursor: snapshot.event_cursor,
  });
  if (precedingEntries.length > 0) model.applyEvidence(precedingEntries);
  const world = model.getView();
  const agents = world.agents.map(({ value }) => requirePlacementAgent(value, manifest.id));
  const homes = [...world.homes, ...world.ruins].map(({ value }) => (
    requirePlacementHome(value, manifest.id)
  ));
  const placement = PlacementLedger.reconstruct([...recipes.values()], { agents, homes }).snapshot();

  return {
    frame: frameFromPresentedWorld(manifest.runId, world),
    placement,
  };
}

function requirePlacementAgent(
  value: Readonly<Partial<AgentSnapshot>>,
  chronicleId: string,
): AgentSnapshot {
  if (typeof value.id !== "string" || typeof value.position !== "string") {
    throw new Error(`${chronicleId} causal prefix contains an incomplete placement agent`);
  }
  return value as AgentSnapshot;
}

function requirePlacementHome(
  value: Readonly<Partial<HomeSnapshot>>,
  chronicleId: string,
): HomeSnapshot {
  if (typeof value.home_id !== "string" || typeof value.region !== "string") {
    throw new Error(`${chronicleId} causal prefix contains an incomplete placement home`);
  }
  if (typeof value.built_at === "number") return value as HomeSnapshot;
  if (chronicleId !== "C06") {
    throw new Error(`${chronicleId} must not synthesize a C07-C09 home placement`);
  }
  // C06's public home_built event intentionally exposes only projected fields;
  // complete only placement-irrelevant fields for deterministic plot allocation.
  return { ...fixtureHome(value.home_id, value.region), ...value } as HomeSnapshot;
}

function typedEvent<T extends PresentedEventType>(
  chronicleId: "C06" | "C07" | "C08" | "C09",
  type: T,
): Extract<TypedPresentedEvent, { readonly type: T }> {
  return typedEvents(chronicleId, type)[0]! as unknown as Extract<
    TypedPresentedEvent,
    { readonly type: T }
  >;
}

function typedEvents<T extends PresentedEventType>(
  chronicleId: "C06" | "C07" | "C08" | "C09",
  type: T,
): TypedPresentedEvent[] {
  return CHRONICLE_CATALOG[chronicleId].entries
    .filter((entry) => entry.event.type === type)
    .map((entry) => {
      const parsed = parsePresentedEvent(entry);
      if (!parsed.known || parsed.evidence.type !== type) throw new Error(`invalid ${type}`);
      return parsed.evidence;
    });
}

function singleMoment(event: TypedPresentedEvent): StoryMoment {
  return new BeatDirector().group([event.entry])[0]!;
}

function resolveEvidence(
  evidence: TypedPresentedEvent,
  frame: PresentedObserverFrame,
  moment: StoryMoment,
  reducedMotion = false,
): ChoreographyPlan {
  const eventType = evidence.type as (typeof TYPES)[number];
  return definitionFor(eventType).resolve({
    moment,
    event: evidence,
    frame,
    placement: placement([], []),
    recipes: new Map(),
    reducedMotion,
  } as never);
}

function syntheticSimulationStarted(runId: string): Extract<TypedPresentedEvent, { type: "simulation_started" }> {
  const entry = {
    cursor: 1,
    event: {
      type: "simulation_started",
      source: "world",
      target: null,
      region: null,
      scope: "global" as const,
      timestamp: 100,
      payload: { message: "Simulation started.", run_id: runId, agent_count: 4, world_time: 100 },
    },
    resolved: {},
    snapshot_after: null,
  };
  const parsed = parsePresentedEvent(entry);
  if (!parsed.known || parsed.evidence.type !== "simulation_started") throw new Error("bad synthetic");
  return parsed.evidence;
}

function frameFor(runId: string): PresentedObserverFrame {
  return frameFromSnapshot(runId, [], [], [], []);
}

function frameFromPresentedWorld(
  runId: string,
  world: PresentedWorldView,
): PresentedObserverFrame {
  return {
    runId,
    sourceKey: `fixture:${runId}`,
    revision: 1,
    firstCursor: world.exactBaseCursor,
    lastCursor: world.projectedThroughCursor,
    source: "fixture",
    ingestedCursor: world.projectedThroughCursor,
    presentedCursor: world.projectedThroughCursor,
    world,
    scene: null,
    selection: null,
    backlog: {
      pendingMoments: 0,
      firstPendingCursor: null,
      lastPendingCursor: null,
      state: "caught-up",
      label: "Live",
    },
    transport: {
      connection: "live",
      ingestedCursor: world.projectedThroughCursor,
      retryable: false,
    },
  };
}

function frameFromSnapshot(
  runId: string,
  agents: readonly AgentSnapshot[],
  regions: readonly RegionSnapshot[],
  homes: readonly HomeSnapshot[],
  ruins: readonly HomeSnapshot[],
): PresentedObserverFrame {
  return {
    runId,
    sourceKey: `fixture:${runId}`,
    revision: 1,
    firstCursor: 0,
    lastCursor: 0,
    source: "fixture",
    ingestedCursor: 0,
    presentedCursor: 0,
    world: {
      exactBaseCursor: 0,
      projectedThroughCursor: 0,
      worldTime: 100,
      agents: agents.map(exact),
      regions: regions.map(exact),
      homes: homes.map(exact),
      ruins: ruins.map(exact),
      pendingProposals: [],
    },
    scene: null,
    selection: null,
    backlog: { pendingMoments: 0, firstPendingCursor: null, lastPendingCursor: null, state: "caught-up", label: "Live" },
    transport: { connection: "live", ingestedCursor: 0, retryable: false },
  };
}

function exact<T>(value: T): PresentedRecord<T> {
  return { completeness: "exact", value };
}

function projected<T>(value: T): PresentedRecord<T> {
  return { completeness: "projected-partial", value };
}

function placement(
  agents: readonly AgentSnapshot[],
  homes: readonly HomeSnapshot[],
): PlacementLedgerSnapshot {
  return {
    revision: 1,
    agents: new Map(agents.map((agent, index) => [agent.id, {
      regionId: agent.position,
      point: { x: 64 + index * 16, y: 96 + index * 16 },
      anchorKind: "checkpoint",
    }])),
    homes: new Map(homes.map((home, index) => [home.home_id, {
      regionId: home.region,
      plotId: `plot:${home.home_id}`,
      door: { x: 256 + index * 16, y: 320 + index * 16 },
    }])),
    districtsByRegion: new Map(),
  };
}

function recipesFor(seed: number, regions: readonly RegionSnapshot[]): ReadonlyMap<string, RegionMapRecipeV1> {
  return new Map(regions.map((region) => {
    const recipe = createRegionMapRecipe(createRegionMapIdentity(seed, region, regions));
    return [region.name, recipe] as const;
  }));
}

function fixtureHome(homeId: string, region: string): HomeSnapshot {
  return {
    home_id: homeId,
    owner_id: "fixture-owner",
    region,
    integrity: 100,
    max_integrity: 100,
    built_at: 1,
    last_upkeep_at: 1,
    last_integrity_at: 1,
    stakeholders: ["fixture-owner"],
    vault_materials: 0,
    status: "standing",
    ruined_at: null,
    remnant_materials: 0,
    breachers: [],
    is_hoarding: false,
  };
}

function expectExecutorValid(
  frame: PresentedObserverFrame,
  moment: StoryMoment,
  program: ChoreographyPlan,
): void {
  expect(program.markers.filter(({ role }) => role === "safe-cancel").at(-1)).toMatchObject({
    atMs: program.durationMs,
    order: 0,
  });
  expect(program.markers.at(-1)).toMatchObject({
    role: "settle",
    atMs: program.durationMs,
    order: 1,
  });
  const executor = createSceneExecutor();
  expect(() => executor.start({ moment, program }, {
    runId: frame.runId,
    sourceKey: frame.sourceKey,
    revision: frame.revision,
    firstCursor: frame.firstCursor,
    lastCursor: frame.lastCursor,
  })).not.toThrow();
}

function assertOneConsequence(plan: ChoreographyPlan): void {
  expect(plan.markers.filter(({ role }) => role === "consequence")).toEqual([
    expect.objectContaining({ name: plan.consequenceMarker, optional: false }),
  ]);
}

function assertObserverSafeRouteFallback(
  context: ChoreographyContext<(typeof TYPES)[number]>,
  plan: ChoreographyPlan,
  actorId: string,
  reason: string,
  durableKind: string,
): void {
  expect(plan.diagnostics).toContainEqual(expect.objectContaining({
    code: "home-route-fallback",
    role: "actor",
    detail: expect.stringContaining(`${actorId}:${reason}`),
  }));
  const actorIntents = plan.phases.flatMap(({ actorIntents }) => actorIntents)
    .filter((intent) => intent.actorId === actorId);
  expect(actorIntents.some(({ kind }) => kind === "fade-reposition")).toBe(true);
  expect(actorIntents.some(({ kind }) => (
    kind === "work" || kind === "reach" || kind === "kneel" || kind === "gather"
  ))).toBe(false);
  expect(actorIntents.some(({ marker }) => marker?.includes(":contact") === true)).toBe(false);

  const recipe = context.recipes.get(plan.regionId!)!;
  const legalStaging = new Set(recipe.stagingPoints.map((point) => `${point.x},${point.y}`));
  const fallback = actorIntents.find(({ kind }) => kind === "fade-reposition")!;
  expect(legalStaging.has(`${fallback.target?.x},${fallback.target?.y}`)).toBe(true);

  const hold = plan.phases.find(({ phase }) => phase === "hold")!;
  expect(hold.homeIntents.some(({ kind }) => kind === durableKind)).toBe(false);
  const consequence = plan.phases.find(({ phase }) => phase === "consequence")!;
  expect(consequence.homeIntents.some(({ kind }) => kind === durableKind)).toBe(true);
  expect(consequence.effectIntents).toContainEqual(expect.objectContaining({ kind: "vignette" }));

  const commands = plan.phases.flatMap((phase) =>
    resolvePhaseCommands(context.frame, context.placement, plan, phase.phase).commands);
  expect(commands.some((command) =>
    command.kind === "actor" && command.actorId === actorId
      && command.command.kind === "play-body")).toBe(false);
  expect(commands).toContainEqual(expect.objectContaining({
    kind: "actor",
    actorId,
    command: expect.objectContaining({ kind: "reposition", reason: "fallback" }),
  }));
}

function assertLegalWaypoints(
  waypoints: readonly Readonly<{ x: number; y: number }>[],
  recipe: RegionMapRecipeV1,
): void {
  for (const [index, point] of waypoints.entries()) {
    const column = Math.floor(point.x / 32);
    const row = Math.floor(point.y / 32);
    expect(recipe.grid.collision[row * recipe.grid.columns + column], `blocked waypoint ${index}`)
      .toBe(0);
    if (index === 0) continue;
    const prior = waypoints[index - 1]!;
    const priorColumn = Math.floor(prior.x / 32);
    const priorRow = Math.floor(prior.y / 32);
    if (column === priorColumn && row === priorRow) {
      expect(Math.hypot(point.x - prior.x, point.y - prior.y), `same-cell connector ${index}`)
        .toBeLessThan(32 * Math.SQRT2);
      continue;
    }
    expect(Math.abs(point.x - prior.x) + Math.abs(point.y - prior.y), `non-cardinal segment ${index}`)
      .toBe(32);
  }
}

function routeEndpointFacing(
  waypoints: readonly Readonly<{ x: number; y: number }>[],
): "north" | "east" | "south" | "west" | undefined {
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

function resolvePhaseCommands(
  frame: PresentedObserverFrame,
  placementValue: PlacementLedgerSnapshot,
  plan: ChoreographyPlan,
  phase: PresentedObserverFrame["scene"] extends infer _Scene
    ? "enter" | "hold" | "consequence" | "recover" | "exit"
    : never,
) {
  const sceneValue = plan.phases.find((candidate) => candidate.phase === phase)!;
  const resolver = createProductionSceneCommandResolver({ getPlacement: () => placementValue });
  const batch = resolver({
    ...frame,
    scene: {
      ...sceneValue,
      execution: { sceneToken: 91, programId: plan.id },
    },
  });
  if (batch === null) throw new Error(`resolver dropped ${plan.eventType}:${phase}`);
  return batch;
}

function layeredActor(
  id: string,
  position: Readonly<{ x: number; y: number }>,
  facing: "north" | "east" | "south" | "west" = "south",
  reducedMotion = false,
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
    persona: `${id} Family C timing test`,
    position,
    facing,
    manifest: PRODUCTION_ASSET_MANIFEST,
    atlasLeases: leases,
    reducedMotion,
  });
}

function driveActorUntil(
  actor: LayeredHumanActor,
  deadlineMs: number,
  hz: number,
  startMs = 0,
): void {
  const stepMs = 1_000 / hz;
  let nowMs = startMs;
  while (nowMs < deadlineMs) {
    const nextMs = Math.min(deadlineMs, nowMs + stepMs);
    actor.advance((nextMs - nowMs) / 1_000, nextMs);
    nowMs = nextMs;
  }
}

function routeDistance(points: readonly Readonly<{ x: number; y: number }>[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += distance(points[index - 1]!, points[index]!);
  }
  return total;
}

function distance(
  left: Readonly<{ x: number; y: number }>,
  right: Readonly<{ x: number; y: number }>,
): number {
  return Math.hypot(left.x - right.x, left.y - right.y);
}
