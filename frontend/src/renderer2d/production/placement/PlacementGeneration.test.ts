import { describe, expect, it } from "vitest";

import type { AgentSnapshot, HomeSnapshot, RegionSnapshot, WorldSnapshot } from "../../../app/schemas";
import { createRegionMapIdentity } from "../maps/RegionMapIdentity";
import {
  cloneTrustedRegionMapRecipe,
  createRegionMapRecipe,
  regionMapRecipeHash,
} from "../maps/RegionMapRecipe";
import { createPlacementGenerationOwner } from "./PlacementGeneration";

const region: RegionSnapshot = {
  name: "meadow", connections: ["grove"], description: "soft grass and flowers",
  energy_rate: 1, materials_rate: 1, current_energy: 50, current_materials: 50,
  max_energy: 100, max_materials: 100,
};
const grove: RegionSnapshot = {
  ...region, name: "grove", connections: [], description: "quiet trees",
};
const regions = [region, grove];
const recipes = regions.map((value) => createRegionMapRecipe(
  createRegionMapIdentity(9, value, regions),
));

describe("PlacementGenerationOwner", () => {
  it("prepares a fresh deterministic ledger without exposing it before commit", () => {
    const initial = snapshot(0, [agent("a")]);
    const owner = createPlacementGenerationOwner(recipes, initial);
    const beforeLedger = owner.current();
    const before = owner.snapshot();
    const prepared = owner.prepareFromSnapshot(snapshot(4, [agent("a"), agent("b")]));

    expect(owner.current()).toBe(beforeLedger);
    expect(owner.snapshot()).toEqual(before);
    expect(prepared).toMatchObject({ runId: "run-a", eventCursor: 4 });

    owner.commitPrepared(prepared);
    expect(owner.current()).not.toBe(beforeLedger);
    expect(owner.snapshot().agents.size).toBe(2);
    owner.rollbackPrepared(prepared);
    expect(owner.current()).toBe(beforeLedger);
    expect(owner.snapshot()).toEqual(before);
  });

  it("owns recipe truth before initial and later placement reconstruction", () => {
    const supplied = recipes.map(cloneTrustedRegionMapRecipe);
    const initial = snapshot(0, [agent("a")]);
    const owner = createPlacementGenerationOwner(supplied, initial);
    const initialLayout = owner.snapshot();
    const ownedRecipeTruth = owner.recipes();
    const expected = createPlacementGenerationOwner([...ownedRecipeTruth.values()], initial);

    for (const district of supplied[0]!.districts) {
      for (const point of district.stagingPoints) {
        (point as { x: number }).x += 1;
      }
    }
    expect(owner.snapshot()).toEqual(initialLayout);

    const replacement = snapshot(4, [agent("a"), agent("b")]);
    const prepared = owner.prepareFromSnapshot(replacement);
    const expectedPrepared = expected.prepareFromSnapshot(replacement);
    owner.commitPrepared(prepared);
    expected.commitPrepared(expectedPrepared);

    expect(owner.snapshot()).toEqual(expected.snapshot());
    expect(owner.recipes()).toEqual(ownedRecipeTruth);
  });

  it("reuses placement for non-spatial recovery but reconstructs membership and region changes", () => {
    const initial = snapshot(0, [agent("a")]);
    initial.homes = [home("standing", "standing")];
    const owner = createPlacementGenerationOwner(recipes, initial);
    const retained = owner.current();
    const energyOnly = snapshot(4, [{ ...agent("a"), energy: 99, materials: 88 }]);
    energyOnly.homes = [{ ...home("standing", "standing"), integrity: 41 }];

    const equivalent = owner.prepareFromSnapshot(energyOnly);
    owner.commitPrepared(equivalent);
    expect(owner.current()).toBe(retained);
    expect(owner.generation()).toBe(1);
    owner.rollbackPrepared(equivalent);
    expect(owner.current()).toBe(retained);
    expect(owner.generation()).toBe(2);

    const membership = owner.prepareFromSnapshot(snapshot(5, [agent("a"), agent("b")]));
    owner.commitPrepared(membership);
    expect(owner.current()).not.toBe(retained);

    const regionOwner = createPlacementGenerationOwner(recipes, initial);
    const beforeRegion = regionOwner.current();
    const moved = snapshot(6, [agent("a", "grove")]);
    moved.homes = [home("standing", "standing")];
    const changedRegion = regionOwner.prepareFromSnapshot(moved);
    regionOwner.commitPrepared(changedRegion);
    expect(regionOwner.current()).not.toBe(beforeRegion);
    expect(regionOwner.snapshot().agents.get("a")?.regionId).toBe("grove");
  });

  it("keeps the active recipe and ledger generations when a resolver returns byte-equivalent recipes", () => {
    const initial = snapshot(0, [agent("a")]);
    const owner = createPlacementGenerationOwner(
      recipes,
      initial,
      () => recipes.map(cloneTrustedRegionMapRecipe),
    );
    const retainedLedger = owner.current();
    const retainedRecipeHash = regionMapRecipeHash(owner.recipes().get("meadow")!);

    const prepared = owner.prepareFromSnapshot({
      ...snapshot(4, [agent("a")]),
      agents: [{ ...agent("a"), energy: 99 }],
    });
    owner.commitPrepared(prepared);

    expect(owner.generation()).toBe(1);
    expect(owner.spatialGeneration()).toBe(0);
    expect(owner.current()).toBe(retainedLedger);
    expect(regionMapRecipeHash(owner.recipes().get("meadow")!)).toBe(retainedRecipeHash);
  });

  it("atomically reconstructs placement when resolved recipe bytes change despite equivalent members", () => {
    const initial = snapshot(0, [agent("a")]);
    const replacementRecipes = regions.map((value) => createRegionMapRecipe(
      createRegionMapIdentity(10, value, regions),
    ));
    const owner = createPlacementGenerationOwner(
      recipes,
      initial,
      (next) => next.event_cursor >= 4 ? replacementRecipes : recipes,
    );
    const retainedLedger = owner.current();
    const retainedRecipes = owner.recipes();
    const prepared = owner.prepareFromSnapshot(snapshot(4, [agent("a")]));

    expect(owner.current()).toBe(retainedLedger);
    expect(owner.recipes()).toEqual(retainedRecipes);
    expect(owner.spatialGeneration()).toBe(0);

    owner.commitPrepared(prepared);
    expect(owner.current()).not.toBe(retainedLedger);
    expect(owner.snapshot().agents.get("a")).toEqual(retainedLedger.snapshot().agents.get("a"));
    expect(owner.recipes().get("meadow")?.identityHash)
      .toBe(replacementRecipes[0]!.identityHash);
    expect(owner.spatialGeneration()).toBe(1);

    owner.rollbackPrepared(prepared);
    expect(owner.current()).toBe(retainedLedger);
    expect(owner.recipes()).toEqual(retainedRecipes);
    expect(owner.spatialGeneration()).toBe(2);
  });

  it("never exposes candidate recipes when resolution or reconstruction fails", () => {
    const initial = snapshot(0, [agent("a")]);
    let mode: "throw" | "missing" = "throw";
    const owner = createPlacementGenerationOwner(
      recipes,
      initial,
      () => {
        if (mode === "throw") throw new Error("resolver failed");
        return recipes.filter((recipe) => recipe.regionId !== "meadow");
      },
    );
    const retainedLedger = owner.current();
    const retainedRecipes = owner.recipes();

    expect(() => owner.prepareFromSnapshot(snapshot(4, [agent("a")])))
      .toThrow(/resolver failed/i);
    mode = "missing";
    expect(() => owner.prepareFromSnapshot(snapshot(5, [agent("a")])))
      .toThrow(/exactly cover|unknown placement region/i);
    expect(owner.current()).toBe(retainedLedger);
    expect(owner.snapshot()).toEqual(retainedLedger.snapshot());
    expect(owner.recipes()).toEqual(retainedRecipes);
    expect(owner.generation()).toBe(0);
    expect(owner.spatialGeneration()).toBe(0);
  });

  it("rejects stale, foreign-run, and disposed candidates without changing active placement", () => {
    const owner = createPlacementGenerationOwner(recipes, snapshot(0, [agent("a")]));
    const first = owner.prepareFromSnapshot(snapshot(2, [agent("a"), agent("b")]));
    const second = owner.prepareFromSnapshot(snapshot(3, [agent("a"), agent("c")]));
    owner.commitPrepared(first);
    const retained = owner.snapshot();

    expect(() => owner.commitPrepared(second)).toThrow(/stale/i);
    expect(() => owner.prepareFromSnapshot({ ...snapshot(4, []), run_id: "run-b" })).toThrow(/active run/i);
    expect(owner.snapshot()).toEqual(retained);

    owner.dispose();
    expect(() => owner.prepareFromSnapshot(snapshot(5, []))).toThrow(/disposed/i);
    expect(owner.snapshot()).toEqual(retained);
  });

  it("retains standing homes and ruins, while a changed run starts with a fresh owner", () => {
    const firstRun = snapshot(0, [agent("a")]);
    firstRun.homes = [home("standing", "standing")];
    firstRun.ruins = [home("ruin", "ruin")];
    const first = createPlacementGenerationOwner(recipes, firstRun);

    expect([...first.snapshot().homes.keys()].sort()).toEqual(["ruin", "standing"]);

    const replacement = { ...snapshot(0, [agent("b")]), run_id: "run-b" };
    replacement.ruins = [home("replacement-ruin", "ruin")];
    const second = createPlacementGenerationOwner(recipes, replacement);
    expect(second.current()).not.toBe(first.current());
    expect([...second.snapshot().agents.keys()]).toEqual(["b"]);
    expect([...second.snapshot().homes.keys()]).toEqual(["replacement-ruin"]);
  });
});

function snapshot(cursor: number, agents: AgentSnapshot[]): WorldSnapshot {
  return {
    schema: 1,
    run_id: "run-a",
    event_cursor: cursor,
    world_time: cursor,
    regions,
    agents,
    homes: [],
    ruins: [],
    pending_proposals: [],
  };
}

function agent(id: string, position = "meadow"): AgentSnapshot {
  return {
    id, name: id, persona: "", position, energy: 20, materials: 10,
    status: "alive", last_mated_at: null, offspring_count: 0, died_at: null,
    home_id: null, is_hoarding: false,
  };
}

function home(id: string, status: "standing" | "ruin"): HomeSnapshot {
  return {
    home_id: id, owner_id: "former-owner", region: "meadow", integrity: status === "ruin" ? 0 : 100,
    max_integrity: 100, built_at: 0, last_upkeep_at: 0, last_integrity_at: 0,
    stakeholders: [], vault_materials: 0, status, ruined_at: status === "ruin" ? 0 : null,
    remnant_materials: 0, breachers: [], is_hoarding: false,
  };
}
