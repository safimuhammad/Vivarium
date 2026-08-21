import { describe, expect, it } from "vitest";

import {
  conditionPresentation,
  getBiomeKit,
  selectBiomeKit,
} from "./biomeKits";

describe("biome kits", () => {
  it("maps all approved archetypes to distinct authored data kits", () => {
    const archetypes = ["worn_heartland", "spring_terraces", "dry_scrub", "ash_waste", "neutral_temperate"] as const;
    const kits = archetypes.map((archetype) => getBiomeKit(selectBiomeKit(archetype)));
    expect(new Set(kits.map((kit) => kit.id))).toHaveLength(5);
    expect(new Set(kits.map((kit) => JSON.stringify(kit)))).toHaveLength(5);
  });

  it("never turns ash terrain green when resource condition improves", () => {
    const ash = getBiomeKit("ash-waste");
    expect(ash.terrainFamily).toBe("ash");
    expect(ash.animatedKinds).not.toContain("grass");
    expect(conditionPresentation(ash.id, { energyRatio: 0, materialsRatio: 0 }).terrainFamily).toBe("ash");
    expect(conditionPresentation(ash.id, { energyRatio: 1, materialsRatio: 1 }).terrainFamily).toBe("ash");
  });

  it("gives every kit a label-free composition signature instead of palette-only identity", () => {
    const ids = ["worn-heartland", "spring-terraces", "dry-scrub", "ash-waste", "neutral-temperate"] as const;
    const grammars = ids.map((id) => getBiomeKit(id).sceneGrammar);

    expect(new Set(grammars.map((grammar) => grammar.signatureRole))).toHaveLength(ids.length);
    expect(new Set(grammars.map((grammar) => JSON.stringify({
      signature: grammar.signatureRole,
      supports: grammar.supportRoles,
      terrain: grammar.terrainPatchRoles,
    })))).toHaveLength(ids.length);
    expect(grammars.every((grammar) => grammar.supportRoles.length >= 2)).toBe(true);
    expect(grammars.every((grammar) =>
      Object.keys(grammar.plannedLandmarksByRole).length >= 3)).toBe(true);
  });

  it("defines the approved grove garden spring outcrop and nuclear grammar vocabularies", () => {
    expect(getBiomeKit("worn-heartland").sceneGrammar).toMatchObject({
      signatureRole: "worn-oak-grove",
      supportRoles: expect.arrayContaining(["broken-fence-garden", "reclaimed-path-shoulder"]),
    });
    expect(getBiomeKit("spring-terraces").sceneGrammar).toMatchObject({
      signatureRole: "connected-spring-terrace",
      supportRoles: expect.arrayContaining(["reed-bank", "wet-stone-willow", "boardwalk-approach"]),
    });
    expect(getBiomeKit("dry-scrub").sceneGrammar).toMatchObject({
      signatureRole: "sun-rock-outcrop",
      supportRoles: expect.arrayContaining(["deadwood-thorn-crescent", "wind-scrub-clump"]),
    });
    expect(getBiomeKit("ash-waste").sceneGrammar).toMatchObject({
      signatureRole: "nuclear-crater-fissure",
      supportRoles: expect.arrayContaining([
        "fractured-industrial-pylon",
        "slag-charred-ridge",
        "ash-debris-fan",
      ]),
      terrainPatchRoles: expect.arrayContaining(["plum-charcoal-ground", "coral-ember-fissure"]),
    });
  });

  it("keeps planned landmark vocabulary typed, role-bound, and impossible to load as an atlas key", () => {
    const ids = ["worn-heartland", "spring-terraces", "dry-scrub", "ash-waste", "neutral-temperate"] as const;
    for (const id of ids) {
      const kit = getBiomeKit(id);
      const grammar = kit.sceneGrammar as any;
      const roles = [
        grammar.signatureRole,
        ...(grammar.detachedSignatureRole === undefined ? [] : [grammar.detachedSignatureRole]),
        ...(grammar.supportRoles as string[]),
      ];
      expect(grammar.plannedLandmarkKinds).toBeUndefined();
      expect(grammar.plannedLandmarksByRole).toBeTypeOf("object");
      for (const role of roles) {
        expect(grammar.plannedLandmarksByRole[role], `${id}:${role}`).toMatchObject({
          recordType: "planned-landmark",
          semanticRole: role,
          runtimeAtlasLookup: false,
        });
        expect(grammar.plannedLandmarksByRole[role].plannedId).toMatch(/^planned:/);
        expect([...kit.blockingScenery, ...kit.passiveScenery])
          .not.toContain(grammar.plannedLandmarksByRole[role].plannedId);
      }
    }
  });

  it("authors typed terrain, visual-path, and occupied-home composition roles per biome", () => {
    const ids = ["worn-heartland", "spring-terraces", "dry-scrub", "ash-waste", "neutral-temperate"] as const;
    const terrainRoleSets = new Set<string>();
    const visualPathRoles = new Set<string>();
    const homeRoles = new Set<string>();
    for (const id of ids) {
      const grammar = getBiomeKit(id).sceneGrammar as any;
      expect(grammar.terrainPatchRoles.length, `${id}:terrain`).toBeGreaterThanOrEqual(2);
      expect(grammar.visualPathRole, `${id}:path`).toMatch(/path|boardwalk|track|route/);
      expect(grammar.occupiedHomeContextRole, `${id}:home`).toMatch(/yard|terrace|scrub|apron|homestead/);
      terrainRoleSets.add(JSON.stringify(grammar.terrainPatchRoles));
      visualPathRoles.add(grammar.visualPathRole);
      homeRoles.add(grammar.occupiedHomeContextRole);
    }
    expect(terrainRoleSets).toHaveLength(ids.length);
    expect(visualPathRoles).toHaveLength(ids.length);
    expect(homeRoles).toHaveLength(ids.length);
  });

  it("forbids every living water or green role from ash at all condition extremes", () => {
    const forbidden = /water|pool|spring|grass|shrub|living|flower|willow|tree|grove|green/i;
    const ash = getBiomeKit("ash-waste");
    const vocabulary = [
      ...ash.animatedKinds,
      ...ash.blockingScenery,
      ...ash.passiveScenery,
      ash.sceneGrammar.signatureRole,
      ...ash.sceneGrammar.supportRoles,
      ...ash.sceneGrammar.terrainPatchRoles,
      ...Object.values(ash.sceneGrammar.plannedLandmarksByRole)
        .flatMap((landmark) => landmark === undefined ? [] : [landmark.plannedId]),
    ];
    expect(vocabulary.filter((role) => forbidden.test(role))).toEqual([]);

    for (const ratio of [Number.NEGATIVE_INFINITY, -1, 0, 0.5, 1, 2, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(conditionPresentation("ash-waste", {
        energyRatio: ratio,
        materialsRatio: ratio,
      }).terrainFamily).toBe("ash");
    }
  });

  it("never propagates non-finite condition ratios into biome presentation", () => {
    expect(conditionPresentation("neutral-temperate", {
      energyRatio: Number.NaN,
      materialsRatio: Number.POSITIVE_INFINITY,
    })).toEqual({
      terrainFamily: "temperate",
      nodeDensity: 1,
      moteDensity: 0,
      vitality: 0,
    });
  });
});
