import { describe, expect, it, vi } from "vitest";

import type { RegionSnapshot } from "../../../app/schemas";
import type { ProductionAssetLease } from "../assets/productionManifest";
import { createRegionMapIdentity } from "../maps/RegionMapIdentity";
import {
  cloneTrustedRegionMapRecipe,
  parseRegionMapRecipe,
  serializeRegionMapRecipe,
  type RegionMapRecipeV1,
} from "../maps/RegionMapRecipe";
import { NIRVANA_ATLAS_PROFILE } from "./NirvanaAssetProfile";
import { channelFrameIdFor, nirvanaTerrainOverlayFrameIds } from "./NirvanaAtlas";
import { createNirvanaInitialRegionForRecipe, createNirvanaRegionMapRecipe } from "./NirvanaRegionMapRecipe";
import {
  NIRVANA_STATIC_SCENE_PROVIDER,
  createNirvanaStaticScenePlan,
} from "./NirvanaStaticSceneProvider";

describe("Nirvana exact static-scene provider", () => {
  it("publishes every terrain, road, landmark, and exact continuation operation", () => {
    const recipe = nirvanaRecipe();
    const initial = createNirvanaInitialRegionForRecipe(recipe);
    const plan = createNirvanaStaticScenePlan(recipe, atlasLeases());
    const chunks = [...initial.region.chunks.values()];
    // owner-authorised Option A re-baseline, plan §P3: the painter now sweeps FOUR
    // "terrain"-layer categories in order (base fill, corner-masked overlay/waterline,
    // authored dry channel, road), not one — every base tile also carries zero or more
    // overlay/shoreline draws, and the retired flat kinds no longer exist. Counts are
    // still derived from the built region rather than hard-coded, preserving the
    // original test's "every category, correctly ordered and tagged" intent.
    const terrainBaseCount = 96 * 96;
    const overlayCount = chunks.reduce((total, chunk) => total + chunk.terrainCells
      .reduce((subtotal, cell) => subtotal + nirvanaTerrainOverlayFrameIds(cell).length, 0), 0);
    const channelCount = chunks.reduce((total, chunk) => total + chunk.terrainCells
      .filter((cell) => channelFrameIdFor(cell) !== null).length, 0);
    const roadCount = chunks.reduce((total, chunk) => total + chunk.roadCells.length, 0);
    const terrainLayerCount = terrainBaseCount + overlayCount + channelCount + roadCount;
    const landmarkVisualCount = chunks.reduce((total, chunk) => total + chunk.landmarks
      .reduce((subtotal, landmark) => subtotal + landmark.visuals.length, 0), 0);
    // Ground scenery (trees, reeds, boulders, bridge props, …) shares the "scenery"
    // layer with macro landmarks now, foot-sorted together.
    const sceneryCount = chunks.reduce((total, chunk) => total + chunk.scenery.length, 0);
    const sceneryLayerCount = landmarkVisualCount + sceneryCount;
    // The painter's authored grounding pass emits one deterministic image-only
    // accent for each eligible scenery placement. Keep this explicit so a
    // missing/duplicated accent changes the exact-plan contract visibly.
    const groundingAccentCount = 230;

    expect(NIRVANA_STATIC_SCENE_PROVIDER.kind).toBe("nirvana-v2");
    // owner-authorised re-baseline, plan §P3 — landmark recovery
    // (`.superpowers/sdd/nirvana-live-report.md` §D). Nine authored macro landmarks the
    // river had retired now stand at authored alternative homes, so the two-region
    // world's static scene hashes differently. Re-measured from this exact call.
    expect(recipe.presentationProfile!.staticSceneHash).toBe("9a0ff2b7");
    expect(plan.cacheIdentity).toBe(
      `nirvana-v2:2:${recipe.identityHash}:${recipe.presentationProfile!.staticSceneHash}`,
    );
    expect(plan.operations.filter(({ stableId }) => stableId.startsWith("grounding:")))
      .toHaveLength(groundingAccentCount);
    expect(plan.operations).toHaveLength(terrainLayerCount + sceneryLayerCount + groundingAccentCount + 64);
    expect(plan.operations.slice(0, terrainBaseCount).every(({ stableId, layer }) =>
      stableId.startsWith("terrain:") && layer === "terrain")).toBe(true);
    expect(plan.operations.slice(
      terrainBaseCount,
      terrainBaseCount + overlayCount,
    ).every(({ stableId, layer }) =>
      stableId.startsWith("terrain-overlay:") && layer === "terrain")).toBe(true);
    expect(plan.operations.slice(
      terrainBaseCount + overlayCount,
      terrainBaseCount + overlayCount + channelCount,
    ).every(({ stableId, layer }) =>
      stableId.startsWith("terrain-channel:") && layer === "terrain")).toBe(true);
    expect(plan.operations.slice(
      terrainBaseCount + overlayCount + channelCount,
      terrainLayerCount,
    ).every(({ stableId, layer }) =>
      stableId.startsWith("road:") && layer === "terrain")).toBe(true);
    expect(plan.operations.slice(
      terrainLayerCount,
      terrainLayerCount + sceneryLayerCount + groundingAccentCount,
    ).every(({ stableId, layer, pivotY }) =>
      (stableId.startsWith("landmark:") || stableId.startsWith("scenery:") || stableId.startsWith("grounding:"))
      && layer === "scenery" && pivotY !== undefined)).toBe(true);
    expect(plan.operations.slice(-64).every(({ stableId, layer }) =>
      stableId.startsWith("continuation:") && layer === "continuation")).toBe(true);
    expect(new Set(plan.operations.map(({ stableId }) => stableId)).size).toBe(plan.operations.length);
    expect(new Set(plan.operations.map(({ atlasId }) => atlasId))).toEqual(new Set([
      NIRVANA_ATLAS_PROFILE.terrainAtlasId,
      NIRVANA_ATLAS_PROFILE.sceneryAtlasId,
    ]));
  });

  it("globally pivot-sorts landmark operations across all six chunks", () => {
    const plan = createNirvanaStaticScenePlan(nirvanaRecipe(), atlasLeases());
    const landmarks = plan.operations.filter(({ layer }) => layer === "scenery");

    expect(landmarks.length).toBeGreaterThan(0);
    for (let index = 1; index < landmarks.length; index += 1) {
      expect(landmarks[index]!.pivotY).toBeGreaterThanOrEqual(landmarks[index - 1]!.pivotY!);
    }
  });

  it("bounds direct preparation work for trusted clones and exact persisted recipes", () => {
    const identity = nirvanaIdentity();
    const recipe = createNirvanaRegionMapRecipe(identity);
    const candidates = [
      cloneTrustedRegionMapRecipe(recipe),
      parseRegionMapRecipe(
        serializeRegionMapRecipe(recipe),
        identity,
        createNirvanaRegionMapRecipe,
      ),
    ];

    for (const candidate of candidates) {
      const preparation = NIRVANA_STATIC_SCENE_PROVIDER.createPreparation(
        candidate,
        atlasLeases(),
      );
      const operations: unknown[] = [];
      const result = preparation.advance(5, (operation) => operations.push(operation));

      expect(result).toEqual({ done: false, workUnits: 5 });
      expect(operations).toHaveLength(5);
      expect(preparation.cacheIdentity).toBe(
        `nirvana-v2:2:${candidate.identityHash}:${candidate.presentationProfile!.staticSceneHash}`,
      );
      preparation.dispose();
    }
  });

  it("fails closed when an exact-looking shallow clone has no authored-scene sidecar", () => {
    const recipe = nirvanaRecipe();
    const shallowClone = { ...recipe };

    expect(() => NIRVANA_STATIC_SCENE_PROVIDER.createPreparation(
      shallowClone,
      atlasLeases(),
    )).toThrow(/trusted authored-scene sidecar/i);
  });

  it("fails closed for non-exact identity, profile, scene hash, or V2 lease inputs", () => {
    const recipe = nirvanaRecipe();
    const leases = atlasLeases();
    const cases: readonly [string, RegionMapRecipeV1, ReadonlyMap<string, ProductionAssetLease>][] = [
      ["region", alteredRecipe(recipe, { regionId: "nirvana_east" }), leases],
      ["kit", alteredRecipe(recipe, { kit: "dry-scrub" }), leases],
      ["profile", alteredRecipe(recipe, { presentationProfile: undefined }), leases],
      ["version", alteredRecipe(recipe, {
        presentationProfile: { ...recipe.presentationProfile!, atlasProfileVersion: 1 },
      }), leases],
      ["hash", alteredRecipe(recipe, {
        presentationProfile: { ...recipe.presentationProfile!, staticSceneHash: "deadbeef" },
      }), leases],
      ["terrain lease", recipe, new Map([
        [NIRVANA_ATLAS_PROFILE.sceneryAtlasId, leases.get(NIRVANA_ATLAS_PROFILE.sceneryAtlasId)!],
      ])],
      ["scenery lease", recipe, new Map([
        [NIRVANA_ATLAS_PROFILE.terrainAtlasId, leases.get(NIRVANA_ATLAS_PROFILE.terrainAtlasId)!],
      ])],
    ];

    for (const [label, candidate, candidateLeases] of cases) {
      expect(
        () => createNirvanaStaticScenePlan(candidate, candidateLeases),
        label,
      ).toThrow(/nirvana|profile|hash|lease/i);
    }
  });

  it("binds both leases through exact atlas validation instead of accepting arbitrary images", () => {
    const leases = atlasLeases();
    const invalidTerrain = {
      value: { width: 32, height: 32 } as ImageBitmap,
      release: vi.fn(),
    };
    leases.set(NIRVANA_ATLAS_PROFILE.terrainAtlasId, invalidTerrain);

    expect(() => createNirvanaStaticScenePlan(nirvanaRecipe(), leases))
      .toThrow(/terrain.*geometry|geometry.*terrain/i);
  });

  it("returns fresh, deeply frozen deterministic plans without retaining the lease map", () => {
    const recipe = nirvanaRecipe();
    const leases = atlasLeases();
    const first = createNirvanaStaticScenePlan(recipe, leases);
    leases.clear();
    const second = createNirvanaStaticScenePlan(recipe, atlasLeases());

    expect(second).toEqual(first);
    expect(second).not.toBe(first);
    expect(second.operations).not.toBe(first.operations);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.operations)).toBe(true);
    expect(Object.isFrozen(first.operations[0])).toBe(true);
    expect(first.operations[0]!.source).toEqual(expect.objectContaining({ width: 32, height: 32 }));
  });
});

function nirvanaRecipe(): RegionMapRecipeV1 {
  return createNirvanaRegionMapRecipe(nirvanaIdentity());
}

function nirvanaIdentity(): ReturnType<typeof createRegionMapIdentity> {
  const regions: readonly RegionSnapshot[] = [
    region("nirvana", "a once-heavenly landscape, now thinning and picked-over", ["warm_springs"]),
    region("warm_springs", "hot spring lakes", ["nirvana"]),
  ];
  return createRegionMapIdentity(401, regions[0]!, regions);
}

function region(name: string, description: string, connections: readonly string[]): RegionSnapshot {
  return {
    name,
    description,
    connections: [...connections],
    energy_rate: 0.2,
    materials_rate: 0.2,
    current_energy: 40,
    current_materials: 40,
    max_energy: 100,
    max_materials: 100,
  };
}

function atlasLeases(): Map<string, ProductionAssetLease> {
  // owner-authorised Option A re-baseline, plan §P3: real nirvana-v3 atlas geometry
  // (512x800 terrain, 672x1010 scenery) — `createNirvanaAtlasAssets` is not mocked in
  // this file, so it validates these dimensions against the published manifest.
  return new Map([
    [NIRVANA_ATLAS_PROFILE.terrainAtlasId, {
      value: { width: 512, height: 800 } as ImageBitmap,
      release: vi.fn(),
    }],
    [NIRVANA_ATLAS_PROFILE.sceneryAtlasId, {
      value: { width: 672, height: 1010 } as ImageBitmap,
      release: vi.fn(),
    }],
  ]);
}

function alteredRecipe(
  recipe: RegionMapRecipeV1,
  changes: Readonly<Record<string, unknown>>,
): RegionMapRecipeV1 {
  return { ...recipe, ...changes } as RegionMapRecipeV1;
}
