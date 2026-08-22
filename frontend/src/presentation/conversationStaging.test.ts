import { describe, expect, it } from "vitest";

import type { RegionSnapshot } from "../app/schemas";
import { TILE_SIZE, tileCenter } from "../renderer2d/map/regionMap";
import { createRegionMapIdentity } from "../renderer2d/production/maps/RegionMapIdentity";
import {
  createRegionMapRecipe,
  type RegionMapRecipeV1,
} from "../renderer2d/production/maps/RegionMapRecipe";
import { stableHash } from "../renderer2d/production/maps/directedTopology";
import type { PlacementLedgerSnapshot } from "../renderer2d/production/placement/PlacementLedger";
import { INTERACTION_CONTACT_TOLERANCE_PX } from "../renderer2d/production/placement/SpatialDirector";
import { routeDistancePx } from "./choreography/locomotionGate";
import {
  CONVERSATION_APPROACH_MAX_PX,
  CONVERSATION_GAIT_PX_PER_SECOND,
  CONVERSATION_TOGETHER_PX,
  conversationalDistancePx,
  conversationalFacing,
  createConversationStaging,
  type ConversationStagingOptions,
} from "./conversationStaging";
import type { PresentedStagingBeat, PresentedUtterance, Vec2 } from "./contracts";

const RUN = "conversation-staging-run";
const SPEAKER = "wanderer_003";
const LISTENER = "wanderer_004";
const NOBODY = new Set<string>();

describe("conversational staging", () => {
  it("reuses the world's own contact tolerance and the production gait", () => {
    // Not a tautology: these are the two numbers that must never be privately
    // re-invented here, because the rest of the system already commits to them.
    expect(CONVERSATION_TOGETHER_PX).toBe(INTERACTION_CONTACT_TOLERANCE_PX);
    expect(CONVERSATION_GAIT_PX_PER_SECOND).toBe(48);
    // Bounded well under the choreographed walk ceiling: the words wait for it.
    expect(CONVERSATION_APPROACH_MAX_PX).toBeLessThan(TILE_SIZE * 10);
  });

  it("agrees with the renderer's own orient derivation about which way a being looks", () => {
    // Mirrors `directionFor` in ProductionSceneCommandResolver.ts. Ties on the
    // diagonal resolve east/west exactly as that function does.
    expect(conversationalFacing({ x: 0, y: 0 }, { x: 10, y: 0 })).toBe("east");
    expect(conversationalFacing({ x: 0, y: 0 }, { x: -10, y: 0 })).toBe("west");
    expect(conversationalFacing({ x: 0, y: 0 }, { x: 0, y: 10 })).toBe("south");
    expect(conversationalFacing({ x: 0, y: 0 }, { x: 0, y: -10 })).toBe("north");
    expect(conversationalFacing({ x: 0, y: 0 }, { x: 5, y: 5 })).toBe("east");
    expect(conversationalFacing({ x: 0, y: 0 }, { x: -5, y: 5 })).toBe("west");
  });

  it("walks the addressee to the speaker and holds the words until it arrives", () => {
    const world = twoBeings({ apartTiles: 3 });
    const staging = createConversationStaging(world.options);
    const decided = staging.stage({
      utterance: directedLine(1),
      busyBeingIds: NOBODY,
      nowMs: 0,
    });

    expect(decided.outcome).toBe("approach");
    expect(decided.beats).toHaveLength(1);
    const approach = decided.beats[0]!;
    expect(approach.kind).toBe("approach");
    // THE ADDRESSEE walks, never the speaker: the words are anchored over the
    // speaker's head and a moving anchor is a moving bubble.
    expect(approach.beingId).toBe(LISTENER);
    if (approach.kind !== "approach") throw new Error("expected an approach beat");
    expect(approach.waypoints.length).toBeGreaterThanOrEqual(2);
    expect(approach.waypoints[0]).toEqual(world.listenerPoint);

    // It ends within conversational distance of the speaker, which is the whole
    // point of the beat.
    const destination = approach.waypoints.at(-1)!;
    expect(conversationalDistancePx(destination, world.speakerPoint))
      .toBeLessThanOrEqual(CONVERSATION_TOGETHER_PX);

    // And the words wait exactly as long as those feet take.
    expect(decided.delayMs).toBeGreaterThan(0);
    expect(decided.delayMs).toBeLessThan(4_000);

    // Both turn to look at each other as the words land.
    expect(decided.arrivalBeats.map((beat) => beat.beingId).sort())
      .toEqual([LISTENER, SPEAKER].sort());
    for (const beat of decided.arrivalBeats) expect(beat.kind).toBe("face");
    const listenerFace = faceOf(decided.arrivalBeats, LISTENER);
    const speakerFace = faceOf(decided.arrivalBeats, SPEAKER);
    expect(listenerFace).toBe(conversationalFacing(destination, world.speakerPoint));
    expect(speakerFace).toBe(conversationalFacing(world.speakerPoint, destination));
    expect(listenerFace).not.toBe(speakerFace);
  });

  it("stages nothing at all when the two are already standing together", () => {
    const world = twoBeings({ apartTiles: 1 });
    expect(conversationalDistancePx(world.listenerPoint, world.speakerPoint))
      .toBeLessThanOrEqual(CONVERSATION_TOGETHER_PX);
    const decided = createConversationStaging(world.options).stage({
      utterance: directedLine(1),
      busyBeingIds: NOBODY,
      nowMs: 0,
    });

    expect(decided).toMatchObject({
      outcome: "already-together",
      delayMs: 0,
      beats: [],
      arrivalBeats: [],
    });
  });

  it("does not re-walk a rapid exchange: one approach, then four lines that stage nothing", () => {
    const world = twoBeings({ apartTiles: 5 });
    const staging = createConversationStaging(world.options);

    const opening = staging.stage({
      utterance: directedLine(1),
      busyBeingIds: NOBODY,
      nowMs: 0,
    });
    expect(opening.outcome).toBe("approach");

    // The next four lines land INSIDE the approach's flight time -- the ledger
    // still says the addressee is five tiles away, because a ledger anchor is
    // only refreshed when a walk completes. The pending destination is what
    // keeps this from staging five walks.
    const during = [2, 3, 4, 5].map((cursor) => staging.stage({
      utterance: cursor % 2 === 0 ? replyLine(cursor) : directedLine(cursor),
      busyBeingIds: NOBODY,
      nowMs: 10,
    }));
    expect(during.map((decided) => decided.outcome))
      .toEqual(["already-together", "already-together", "already-together", "already-together"]);
    expect(during.flatMap((decided) => decided.beats)).toEqual([]);
    expect(during.map((decided) => decided.delayMs)).toEqual([0, 0, 0, 0]);

    // And after they have arrived -- the ledger now agreeing with where they
    // stand -- a further line still stages nothing, because they are together.
    world.moveTo(LISTENER, opening.beats[0]!.kind === "approach"
      ? opening.beats[0]!.waypoints.at(-1)!
      : world.listenerPoint);
    const after = staging.stage({
      utterance: directedLine(6),
      busyBeingIds: NOBODY,
      nowMs: opening.delayMs + 1,
    });
    expect(after.outcome).toBe("already-together");
  });

  it("re-approaches once a later beat has moved them apart again", () => {
    const world = twoBeings({ apartTiles: 4 });
    const staging = createConversationStaging(world.options);
    const first = staging.stage({ utterance: directedLine(1), busyBeingIds: NOBODY, nowMs: 0 });
    expect(first.outcome).toBe("approach");
    const destination = first.beats[0]!.kind === "approach"
      ? first.beats[0]!.waypoints.at(-1)!
      : world.listenerPoint;
    world.moveTo(LISTENER, destination);

    // Something else -- a harvest, a home beat, a region walk -- takes the
    // addressee away. Nothing is glued: the geometry is simply re-read.
    world.moveTo(LISTENER, world.openPointNear(world.speakerPoint, 5));
    const later = staging.stage({
      utterance: directedLine(2),
      busyBeingIds: NOBODY,
      nowMs: first.delayMs + 1_000,
    });
    expect(later.outcome).toBe("approach");
  });

  it("truncates a long approach onto its own route instead of walking or cutting the whole thing", () => {
    const world = twoBeings({ apartTiles: 12 });
    const decided = createConversationStaging(world.options).stage({
      utterance: directedLine(1),
      busyBeingIds: NOBODY,
      nowMs: 0,
    });

    expect(decided.outcome).toBe("approach");
    const approach = decided.beats[0]!;
    if (approach.kind !== "approach") throw new Error("expected an approach beat");
    // It IS truncated ...
    expect(approach.cutFrom).toBeDefined();
    // ... to one of the route's own points, which is the entire legality
    // argument: nothing new is asserted about the map.
    expect(approach.waypoints[0]).toEqual(approach.cutFrom);
    // ... the visible tail is inside the budget ...
    expect(routeDistancePx(approach.waypoints))
      .toBeLessThanOrEqual(CONVERSATION_APPROACH_MAX_PX);
    // ... it is still a WALK, never a teleport into a conversation ...
    expect(approach.waypoints.length).toBeGreaterThanOrEqual(2);
    // ... and it still ends beside the speaker.
    expect(conversationalDistancePx(approach.waypoints.at(-1)!, world.speakerPoint))
      .toBeLessThanOrEqual(CONVERSATION_TOGETHER_PX);
    // The words therefore wait for the tail, not for the whole distance.
    expect(decided.delayMs).toBeLessThan(4_000);
  });

  it("does nothing spatial across regions", () => {
    const world = twoBeings({ apartTiles: 4 });
    world.putInRegion(LISTENER, "ridge");
    const decided = createConversationStaging(world.options).stage({
      utterance: directedLine(1),
      busyBeingIds: NOBODY,
      nowMs: 0,
    });

    expect(decided).toMatchObject({
      outcome: "cross-region",
      delayMs: 0,
      beats: [],
      arrivalBeats: [],
    });
  });

  it("fails soft to the cross-region behaviour when the addressee is not rendered", () => {
    const world = twoBeings({ apartTiles: 4 });
    world.unplace(LISTENER);
    const decided = createConversationStaging(world.options).stage({
      utterance: directedLine(1),
      busyBeingIds: NOBODY,
      nowMs: 0,
    });

    expect(decided).toMatchObject({ outcome: "unplaced", delayMs: 0, beats: [] });
  });

  it("never takes a body the active scene already owns", () => {
    const world = twoBeings({ apartTiles: 4 });
    const decided = createConversationStaging(world.options).stage({
      utterance: directedLine(1),
      busyBeingIds: new Set([LISTENER]),
      nowMs: 0,
    });

    expect(decided).toMatchObject({ outcome: "listener-busy", delayMs: 0, beats: [] });
  });

  it("leaves a busy speaker's facing to its own scene while still walking the addressee over", () => {
    const world = twoBeings({ apartTiles: 4 });
    const decided = createConversationStaging(world.options).stage({
      utterance: directedLine(1),
      busyBeingIds: new Set([SPEAKER]),
      nowMs: 0,
    });

    expect(decided.outcome).toBe("approach");
    expect(decided.arrivalBeats.map((beat) => beat.beingId)).toEqual([LISTENER]);
  });

  it("does not ping-pong a being addressed by two others at once", () => {
    const world = threeBeings();
    const staging = createConversationStaging(world.options);
    const first = staging.stage({
      utterance: line({ cursor: 1, speaker: SPEAKER, target: LISTENER }),
      busyBeingIds: NOBODY,
      nowMs: 0,
    });
    expect(first.outcome).toBe("approach");

    const second = staging.stage({
      utterance: line({ cursor: 2, speaker: "wanderer_005", target: LISTENER }),
      busyBeingIds: NOBODY,
      nowMs: 0,
    });
    // The words still land -- they are simply not staged. Nobody is dropped and
    // nobody walks twice.
    expect(second).toMatchObject({ outcome: "approach-pending", delayMs: 0, beats: [] });
  });

  it("stages nothing under reduced motion, and delays nothing either", () => {
    const world = twoBeings({ apartTiles: 4, reducedMotion: true });
    const decided = createConversationStaging(world.options).stage({
      utterance: directedLine(1),
      busyBeingIds: NOBODY,
      nowMs: 0,
    });

    expect(decided).toMatchObject({ outcome: "reduced-motion", delayMs: 0, beats: [] });
  });

  it("ignores undirected speech and private thought entirely", () => {
    const world = twoBeings({ apartTiles: 4 });
    const staging = createConversationStaging(world.options);

    expect(staging.stage({
      utterance: { ...directedLine(1), targetId: null, variant: "spoken" },
      busyBeingIds: NOBODY,
      nowMs: 0,
    }).outcome).toBe("not-directed");
    expect(staging.stage({
      utterance: {
        ...directedLine(2),
        eventType: "self_talk",
        targetId: null,
        variant: "thought",
      },
      busyBeingIds: NOBODY,
      nowMs: 0,
    }).outcome).toBe("not-directed");
    expect(staging.stage({
      utterance: { ...directedLine(3), targetId: SPEAKER },
      busyBeingIds: NOBODY,
      nowMs: 0,
    }).outcome).toBe("not-directed");
  });

  it("forgets in-flight approaches on reset", () => {
    const world = threeBeings();
    const staging = createConversationStaging(world.options);
    expect(staging.stage({ utterance: directedLine(1), busyBeingIds: NOBODY, nowMs: 0 }).outcome)
      .toBe("approach");
    expect(staging.stage({
      utterance: line({ cursor: 2, speaker: "wanderer_005", target: LISTENER }),
      busyBeingIds: NOBODY,
      nowMs: 0,
    }).outcome).toBe("approach-pending");

    staging.reset();
    expect(staging.stage({ utterance: directedLine(3), busyBeingIds: NOBODY, nowMs: 0 }).outcome)
      .toBe("approach");
  });

  it("returns deeply frozen decisions", () => {
    const world = twoBeings({ apartTiles: 4 });
    const decided = createConversationStaging(world.options).stage({
      utterance: directedLine(1),
      busyBeingIds: NOBODY,
      nowMs: 0,
    });
    expect(Object.isFrozen(decided)).toBe(true);
    expect(Object.isFrozen(decided.beats)).toBe(true);
    expect(Object.isFrozen(decided.beats[0])).toBe(true);
    expect(Object.isFrozen(decided.arrivalBeats)).toBe(true);
  });
});

function faceOf(beats: readonly PresentedStagingBeat[], beingId: string): string {
  const beat = beats.find((candidate) => candidate.beingId === beingId);
  if (beat === undefined || beat.kind !== "face") throw new Error(`no face beat for ${beingId}`);
  return beat.facing;
}

function directedLine(cursor: number): PresentedUtterance {
  return line({ cursor, speaker: SPEAKER, target: LISTENER });
}

function replyLine(cursor: number): PresentedUtterance {
  return line({ cursor, speaker: LISTENER, target: SPEAKER });
}

function line(input: {
  cursor: number;
  speaker: string;
  target: string;
}): PresentedUtterance {
  return Object.freeze({
    momentId: `moment-${input.cursor}`,
    cursor: input.cursor,
    beingId: input.speaker,
    targetId: input.target,
    regionId: "spring",
    text: "Between us only -- I've been watching how you tend this place.",
    variant: "whisper" as const,
    eventType: "speak" as const,
  });
}

interface StagedWorld {
  readonly options: ConversationStagingOptions;
  readonly speakerPoint: Vec2;
  readonly listenerPoint: Vec2;
  moveTo(beingId: string, point: Vec2): void;
  putInRegion(beingId: string, regionId: string): void;
  unplace(beingId: string): void;
  openPointNear(anchor: Vec2, tiles: number): Vec2;
}

/**
 * A real region recipe, two real standing points on real open ground.
 *
 * Deliberately NOT a hand-drawn grid: the whole claim this module makes is that
 * an approach it authors is one the renderer's own gates will accept, and only
 * the production recipe's terrain can test that.
 */
function twoBeings(input: {
  apartTiles: number;
  reducedMotion?: boolean;
}): StagedWorld {
  return buildWorld([SPEAKER, LISTENER], input.apartTiles, input.reducedMotion ?? false);
}

function threeBeings(): StagedWorld {
  return buildWorld([SPEAKER, LISTENER, "wanderer_005"], 4, false);
}

function buildWorld(
  beings: readonly string[],
  apartTiles: number,
  reducedMotion: boolean,
): StagedWorld {
  const recipes = new Map<string, RegionMapRecipeV1>([
    ["spring", recipeFor("spring")],
    ["ridge", recipeFor("ridge")],
  ]);
  const spring = recipes.get("spring")!;
  const speakerPoint = tileCenter(spring.stagingAnchors[0]!);
  const listenerPoint = openPointNear(spring, speakerPoint, apartTiles);
  const agents = new Map<string, { regionId: string; point: Vec2; anchorKind: string }>();
  for (const [index, beingId] of beings.entries()) {
    agents.set(beingId, {
      regionId: "spring",
      point: index === 0
        ? speakerPoint
        : index === 1
          ? listenerPoint
          : openPointNear(spring, speakerPoint, apartTiles + 3),
      anchorKind: "staging",
    });
  }
  const placement: PlacementLedgerSnapshot = {
    revision: 1,
    agents,
    homes: new Map(),
    districtsByRegion: new Map(),
  };
  return {
    options: {
      getPlacement: () => placement,
      getRecipes: () => recipes,
      reducedMotion: () => reducedMotion,
    },
    speakerPoint,
    listenerPoint,
    moveTo(beingId, point) {
      const existing = agents.get(beingId)!;
      agents.set(beingId, { ...existing, point: { ...point } });
    },
    putInRegion(beingId, regionId) {
      const existing = agents.get(beingId)!;
      agents.set(beingId, { ...existing, regionId });
    },
    unplace(beingId) {
      agents.delete(beingId);
    },
    openPointNear: (anchor, tiles) => openPointNear(spring, anchor, tiles),
  };
}

/**
 * The nearest collision-open tile centre roughly `tiles` away from `anchor`.
 *
 * Searched on the recipe's own collision mask rather than assumed, so a fixture
 * never places a being inside a river and then blames the router for it.
 */
function openPointNear(
  recipe: RegionMapRecipeV1,
  anchor: Vec2,
  tiles: number,
): Vec2 {
  const origin = {
    column: Math.floor(anchor.x / TILE_SIZE),
    row: Math.floor(anchor.y / TILE_SIZE),
  };
  const { grid } = recipe;
  const isOpen = (column: number, row: number): boolean => (
    column >= 0 && row >= 0 && column < grid.columns && row < grid.rows
    && grid.collision[row * grid.columns + column] === 0
  );
  for (let radius = 0; radius <= grid.columns; radius += 1) {
    for (const [dc, dr] of [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const column = origin.column + dc! * (tiles + radius);
      const row = origin.row + dr! * (tiles + radius);
      if (!isOpen(column, row)) continue;
      const point = tileCenter({ column, row });
      if (conversationalDistancePx(point, anchor) < TILE_SIZE) continue;
      return point;
    }
  }
  throw new Error(`no open tile ${tiles} tiles from ${anchor.x},${anchor.y}`);
}

function recipeFor(regionId: "spring" | "ridge"): RegionMapRecipeV1 {
  const regions = [region("spring", ["ridge"]), region("ridge", [])];
  const target = regions.find((value) => value.name === regionId)!;
  return createRegionMapRecipe(createRegionMapIdentity(stableHash(RUN), target, regions));
}

function region(name: string, connections: readonly string[]): RegionSnapshot {
  return {
    name,
    description: name,
    connections: [...connections],
    energy_rate: 1,
    materials_rate: 1,
    current_energy: 100,
    current_materials: 100,
    max_energy: 100,
    max_materials: 100,
  };
}
