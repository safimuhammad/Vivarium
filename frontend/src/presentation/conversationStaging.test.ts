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
import {
  CONVERSATION_FLASH_STEP_MS,
  CONVERSATION_TOGETHER_PX,
  conversationalDistancePx,
  conversationalFacing,
  createConversationStaging,
  type ConversationStagingDecision,
  type ConversationStagingOptions,
} from "./conversationStaging";
import type { PresentedStagingBeat, PresentedUtterance, Vec2 } from "./contracts";

const RUN = "conversation-staging-run";
const SPEAKER = "wanderer_003";
const LISTENER = "wanderer_004";
const NOBODY = new Set<string>();

describe("conversational staging", () => {
  it("reuses the world's own contact tolerance, and keeps the flash brief", () => {
    // Not a tautology: this is the number that must never be privately
    // re-invented here, because the rest of the system already commits to it.
    expect(CONVERSATION_TOGETHER_PX).toBe(INTERACTION_CONTACT_TOLERANCE_PX);
    // Two 180ms fade phases — the actors' own vanish-and-appear, mirrored here
    // by convention rather than by importing a renderer constant upward. Short
    // enough to read as one deliberate step rather than a disappearance.
    expect(CONVERSATION_FLASH_STEP_MS).toBe(360);
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

  it("flashes the addressee to the speaker's side, in one immediate publication", () => {
    const world = twoBeings({ apartTiles: 3 });
    const staging = createConversationStaging(world.options);
    const decided = staging.stage({
      utterance: directedLine(1),
      busyBeingIds: NOBODY,
      nowMs: 0,
    });

    expect(decided.outcome).toBe("flash-step");
    // Everything this decision does is published at once: there is no second,
    // later batch and no delay channel to hold the words on.
    expect(Object.keys(decided).sort()).toEqual(["beats", "outcome"]);
    expect(decided.beats).toHaveLength(3);

    const step = decided.beats[0]!;
    // The step comes FIRST and the turns follow: a face resolved before the
    // body moved would aim the addressee from where it no longer stands.
    expect(step.kind).toBe("flash-step");
    if (step.kind !== "flash-step") throw new Error("expected a flash-step beat");
    // THE ADDRESSEE moves, never the speaker: the words are anchored over the
    // speaker's head and a moving anchor is a moving bubble.
    expect(step.beingId).toBe(LISTENER);

    // It lands within conversational distance of the speaker, which is the whole
    // point of the beat ...
    const destination = step.to;
    expect(conversationalDistancePx(destination, world.speakerPoint))
      .toBeLessThanOrEqual(CONVERSATION_TOGETHER_PX);
    // ... and it really was a distance worth closing.
    expect(conversationalDistancePx(world.listenerPoint, world.speakerPoint))
      .toBeGreaterThan(CONVERSATION_TOGETHER_PX);

    // Both turn to look at each other in the same instant.
    const turns = decided.beats.slice(1);
    expect(turns.map((beat) => beat.beingId).sort())
      .toEqual([LISTENER, SPEAKER].sort());
    for (const beat of turns) expect(beat.kind).toBe("face");
    const listenerFace = faceOf(turns, LISTENER);
    const speakerFace = faceOf(turns, SPEAKER);
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

    expect(decided).toMatchObject({ outcome: "already-together", beats: [] });
  });

  it("does not re-step a rapid exchange: one flash, then four lines that stage nothing", () => {
    const world = twoBeings({ apartTiles: 5 });
    const staging = createConversationStaging(world.options);

    const opening = staging.stage({
      utterance: directedLine(1),
      busyBeingIds: NOBODY,
      nowMs: 0,
    });
    expect(opening.outcome).toBe("flash-step");
    const destination = flashDestination(opening);

    // The next four lines land BEFORE the ledger has caught up -- it still says
    // the addressee is five tiles away, because its anchor is refreshed a
    // renderer tick later. The memo of where this lane put the being is what
    // keeps that from staging five flashes.
    const during = [2, 3, 4, 5].map((cursor) => staging.stage({
      utterance: cursor % 2 === 0 ? replyLine(cursor) : directedLine(cursor),
      busyBeingIds: NOBODY,
      nowMs: 10,
    }));
    expect(during.map((decided) => decided.outcome))
      .toEqual(["already-together", "already-together", "already-together", "already-together"]);
    expect(during.flatMap((decided) => decided.beats)).toEqual([]);

    // And once the ledger DOES catch up -- the memo retiring on that evidence
    // rather than on any clock -- a further line still stages nothing, because
    // they are genuinely together now.
    world.moveTo(LISTENER, destination);
    const after = staging.stage({
      utterance: directedLine(6),
      busyBeingIds: NOBODY,
      nowMs: 10_000,
    });
    expect(after.outcome).toBe("already-together");
  });

  it("flashes again once a later beat has moved them apart", () => {
    const world = twoBeings({ apartTiles: 4 });
    const staging = createConversationStaging(world.options);
    const first = staging.stage({ utterance: directedLine(1), busyBeingIds: NOBODY, nowMs: 0 });
    expect(first.outcome).toBe("flash-step");
    world.moveTo(LISTENER, flashDestination(first));

    // Something else -- a harvest, a home beat, a region walk -- takes the
    // addressee away. Nothing is glued: the geometry is simply re-read, and the
    // memo retires on the ledger disagreeing with it.
    world.moveTo(LISTENER, world.openPointNear(world.speakerPoint, 5));
    const later = staging.stage({
      utterance: directedLine(2),
      busyBeingIds: NOBODY,
      nowMs: 1_000,
    });
    expect(later.outcome).toBe("flash-step");
  });

  it("costs a far pair nothing extra: the same one step, the same immediate words", () => {
    // Twelve tiles apart -- past anything the old build was willing to walk,
    // which truncated the route and still made the words wait for the tail.
    const world = twoBeings({ apartTiles: 12 });
    expect(conversationalDistancePx(world.listenerPoint, world.speakerPoint))
      .toBeGreaterThan(TILE_SIZE * 10);
    const decided = createConversationStaging(world.options).stage({
      utterance: directedLine(1),
      busyBeingIds: NOBODY,
      nowMs: 0,
    });

    expect(decided.outcome).toBe("flash-step");
    expect(decided.beats).toHaveLength(3);
    const destination = flashDestination(decided);
    // Distance buys no truncation and no wait -- only the endpoint of a route
    // the region's own ground and structures already admitted a body to, which
    // is the entire legality argument.
    expect(conversationalDistancePx(destination, world.speakerPoint))
      .toBeLessThanOrEqual(CONVERSATION_TOGETHER_PX);
    expect(world.isOpenGround(destination)).toBe(true);
  });

  it("does nothing spatial across regions", () => {
    const world = twoBeings({ apartTiles: 4 });
    world.putInRegion(LISTENER, "ridge");
    const decided = createConversationStaging(world.options).stage({
      utterance: directedLine(1),
      busyBeingIds: NOBODY,
      nowMs: 0,
    });

    expect(decided).toMatchObject({ outcome: "cross-region", beats: [] });
  });

  it("fails soft to the cross-region behaviour when the addressee is not rendered", () => {
    const world = twoBeings({ apartTiles: 4 });
    world.unplace(LISTENER);
    const decided = createConversationStaging(world.options).stage({
      utterance: directedLine(1),
      busyBeingIds: NOBODY,
      nowMs: 0,
    });

    expect(decided).toMatchObject({ outcome: "unplaced", beats: [] });
  });

  it("never takes a body the active scene already owns", () => {
    const world = twoBeings({ apartTiles: 4 });
    const decided = createConversationStaging(world.options).stage({
      utterance: directedLine(1),
      busyBeingIds: new Set([LISTENER]),
      nowMs: 0,
    });

    expect(decided).toMatchObject({ outcome: "listener-busy", beats: [] });
  });

  it("leaves a busy speaker's facing to its own scene while still stepping the addressee over", () => {
    const world = twoBeings({ apartTiles: 4 });
    const decided = createConversationStaging(world.options).stage({
      utterance: directedLine(1),
      busyBeingIds: new Set([SPEAKER]),
      nowMs: 0,
    });

    expect(decided.outcome).toBe("flash-step");
    // The step still happens; only the speaker's turn is withheld.
    expect(decided.beats.map((beat) => beat.kind)).toEqual(["flash-step", "face"]);
    expect(decided.beats.map((beat) => beat.beingId)).toEqual([LISTENER, LISTENER]);
  });

  it("does not ping-pong a being addressed by two others at once", () => {
    const world = threeBeings();
    const staging = createConversationStaging(world.options);
    const first = staging.stage({
      utterance: line({ cursor: 1, speaker: SPEAKER, target: LISTENER }),
      busyBeingIds: NOBODY,
      nowMs: 0,
    });
    expect(first.outcome).toBe("flash-step");

    const second = staging.stage({
      utterance: line({ cursor: 2, speaker: "wanderer_005", target: LISTENER }),
      busyBeingIds: NOBODY,
      nowMs: 0,
    });
    // The words still land -- they are simply not staged. Nobody is dropped and
    // nobody strobes between two speakers.
    expect(second).toMatchObject({ outcome: "flash-pending", beats: [] });

    // The guard lasts exactly as long as the flash itself is on screen.
    const later = staging.stage({
      utterance: line({ cursor: 3, speaker: "wanderer_005", target: LISTENER }),
      busyBeingIds: NOBODY,
      nowMs: CONVERSATION_FLASH_STEP_MS,
    });
    expect(later.outcome).toBe("flash-step");
  });

  it("stages nothing under reduced motion, and delays nothing either", () => {
    const world = twoBeings({ apartTiles: 4, reducedMotion: true });
    const decided = createConversationStaging(world.options).stage({
      utterance: directedLine(1),
      busyBeingIds: NOBODY,
      nowMs: 0,
    });

    expect(decided).toMatchObject({ outcome: "reduced-motion", beats: [] });
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

  it("forgets its flashed-standing memos on reset", () => {
    const world = threeBeings();
    const staging = createConversationStaging(world.options);
    expect(staging.stage({ utterance: directedLine(1), busyBeingIds: NOBODY, nowMs: 0 }).outcome)
      .toBe("flash-step");
    expect(staging.stage({
      utterance: line({ cursor: 2, speaker: "wanderer_005", target: LISTENER }),
      busyBeingIds: NOBODY,
      nowMs: 0,
    }).outcome).toBe("flash-pending");

    staging.reset();
    expect(staging.stage({ utterance: directedLine(3), busyBeingIds: NOBODY, nowMs: 0 }).outcome)
      .toBe("flash-step");
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
    for (const beat of decided.beats) expect(Object.isFrozen(beat)).toBe(true);
  });
});

/** The point a decision's flash step lands on, asserting there is exactly one. */
function flashDestination(decided: ConversationStagingDecision): Vec2 {
  const step = decided.beats[0];
  if (step === undefined || step.kind !== "flash-step") {
    throw new Error("expected a flash-step beat first");
  }
  return step.to;
}

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
  /** Whether the region's own collision mask admits a body's feet at this point. */
  isOpenGround(point: Vec2): boolean;
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
    isOpenGround(point) {
      const { grid } = spring;
      const column = Math.floor(point.x / TILE_SIZE);
      const row = Math.floor(point.y / TILE_SIZE);
      return column >= 0 && row >= 0 && column < grid.columns && row < grid.rows
        && grid.collision[row * grid.columns + column] === 0;
    },
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
