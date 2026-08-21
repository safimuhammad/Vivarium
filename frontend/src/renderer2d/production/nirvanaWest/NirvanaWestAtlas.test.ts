/**
 * @fileoverview Frame-id grammar and lease-binding tests for the `nirvana-west-v1` atlas.
 *
 * Exercises the four id families (`t.` / `e.` / `w.` / `s.`) against the REAL published
 * frame table (`NIRVANA_WEST_ATLAS_PROFILE.frames`), the same way
 * `nirvana/NirvanaAtlas.test.ts` proves its own frame-id builders against real published
 * ids rather than a synthetic fixture — a builder that emits a plausible-looking id no
 * artist actually drew would otherwise pass a unit test and fail only at draw time.
 *
 * RE-PINNED for the composition-B republish: the field-material set changed (`brine`
 * dropped from base/edge coverage, `slab`/`spoil` added), the void family shrank to
 * `ember`/`emberdim`, and four scenery species (`slab`/`apron`/`spill`/`rimecluster`)
 * were retired -- 27 species remain, each carrying a measured ground-contact rect.
 */

import { describe, expect, it } from "vitest";

import publishedAtlas from "../../../assets/renderer2d/regions/nirvana-west-v1/atlas.json";
import {
  NIRVANA_WEST_ATLAS_PROFILE,
  NIRVANA_WEST_BLOCKING_MATERIALS,
  NIRVANA_WEST_MATERIALS as PROFILE_MATERIALS,
  NIRVANA_WEST_RIM_MATERIALS as PROFILE_RIM_MATERIALS,
  NIRVANA_WEST_VOID_MATERIALS,
} from "./NirvanaWestAssetProfile";
import {
  BLOCKING_NIRVANA_WEST_MATERIALS,
  NIRVANA_WEST_EDGE_VARIANTS,
  NIRVANA_WEST_MATERIALS as FIELD_MATERIALS_TABLE,
  NIRVANA_WEST_PLAIN_TIERS,
  NIRVANA_WEST_RIM_MATERIALS as FIELD_RIM_MATERIALS,
  NIRVANA_WEST_VOID_FAMILY,
} from "./NirvanaWestMaterials";
import {
  createNirvanaWestAtlasAssets,
  NIRVANA_WEST_SCENERY_SPECIES,
  nirvanaWestBaseFrameId,
  nirvanaWestEdgeFrameId,
  nirvanaWestFrameHasFootprint,
  nirvanaWestRimFrameId,
  nirvanaWestSceneryFrameId,
  NirvanaWestAtlasError,
  requireNirvanaWestFrame,
  requireNirvanaWestSceneryFrame,
} from "./NirvanaWestAtlas";

const terrainImage = { width: 512, height: 960 } as CanvasImageSource;
const sceneryImage = { width: 640, height: 1_600 } as CanvasImageSource;

describe("NirvanaWestAtlas", () => {
  /**
   * THE REGRESSION TEST FOR THE HALF-MERGE.
   *
   * Nirvana West carries the material vocabulary twice on purpose:
   * `NirvanaWestAssetProfile.ts` pins it to validate the published manifest at module
   * load, and `NirvanaWestMaterials.ts` owns it dependency-free for the terrain field
   * and the painter. Two concurrent build sessions left those two copies disagreeing —
   * `NirvanaWestMaterials.ts` still held the pilot stack (`brine`/`rime` present,
   * `slab`/`spoil` absent) while the profile, the atlas, the painter and the SHIPPED ART
   * had all moved on. Nothing crashed, because the corner field happens never to sample
   * the four materials in dispute; it would have crashed at paint time the moment it did.
   *
   * Duplication is only safe when the copies are pinned to each other. This is that pin,
   * and it closes the loop: the profile is asserted against `atlas.json` at load, and
   * this asserts the field table against the profile — so both are transitively bound to
   * the published art.
   */
  it("keeps the field material table and the atlas profile's own copy in exact agreement", () => {
    expect([...FIELD_MATERIALS_TABLE]).toEqual([...PROFILE_MATERIALS]);
    expect([...BLOCKING_NIRVANA_WEST_MATERIALS]).toEqual([...NIRVANA_WEST_BLOCKING_MATERIALS]);
    expect([...NIRVANA_WEST_VOID_FAMILY]).toEqual([...NIRVANA_WEST_VOID_MATERIALS]);
    expect([...FIELD_RIM_MATERIALS]).toEqual([...PROFILE_RIM_MATERIALS]);
    // ...and the field table's edge-variant counts are pinned straight to the SHIPPED
    // atlas, key for key, which is the tightest binding available here: the profile
    // does not republish `edgeVariants`, so this is what stops the field table asking
    // for a variant index the art never drew.
    expect(Object.keys(NIRVANA_WEST_EDGE_VARIANTS).sort())
      .toEqual([...PROFILE_MATERIALS].sort());
    expect(NIRVANA_WEST_EDGE_VARIANTS).toEqual(publishedAtlas.edgeVariants);
    expect(publishedAtlas.materials).toEqual([...FIELD_MATERIALS_TABLE]);
    expect(publishedAtlas.blockingMaterials).toEqual([...BLOCKING_NIRVANA_WEST_MATERIALS]);
    expect(publishedAtlas.voidMaterials).toEqual([...NIRVANA_WEST_VOID_FAMILY]);
    expect(publishedAtlas.rimMaterials).toEqual([...FIELD_RIM_MATERIALS]);
    expect(publishedAtlas.plainTiers).toEqual([...NIRVANA_WEST_PLAIN_TIERS]);
  });

  it("binds the two decoded sheets to the published frame table", () => {
    const assets = createNirvanaWestAtlasAssets(terrainImage, sceneryImage);
    expect(assets.terrain).toBe(terrainImage);
    expect(assets.scenery).toBe(sceneryImage);
    expect(assets.frames.size).toBe(551);
    expect(assets.frames).toEqual(new Map(Object.entries(NIRVANA_WEST_ATLAS_PROFILE.frames)));
  });

  it("resolves a known frame and fails closed on a missing one", () => {
    const assets = createNirvanaWestAtlasAssets(terrainImage, sceneryImage);
    const frame = requireNirvanaWestFrame(assets, "t.ember.0");
    expect(frame.image).toBe("terrain");
    expect(frame.atlasId).toBe("nirvana-west-v1-terrain");

    expect(() => requireNirvanaWestFrame(assets, "t.nonexistent.0"))
      .toThrow(NirvanaWestAtlasError);
    expect(() => requireNirvanaWestFrame(assets, "t.nonexistent.0"))
      .toThrow(/t\.nonexistent\.0/);
  });

  it("builds base-fill ids that resolve for every field material's 8 variants, including the new slab/spoil tiers", () => {
    const assets = createNirvanaWestAtlasAssets(terrainImage, sceneryImage);
    const fieldMaterials = NIRVANA_WEST_ATLAS_PROFILE.materials.filter((m) => m !== "causeway");
    expect(fieldMaterials).toContain("slab");
    expect(fieldMaterials).toContain("spoil");
    for (const material of fieldMaterials) {
      for (let variant = 0; variant < 8; variant += 1) {
        const id = nirvanaWestBaseFrameId(material, variant);
        expect(requireNirvanaWestFrame(assets, id).image, id).toBe("terrain");
      }
    }
  });

  it("brine and rime were retired -- neither owns a base-fill frame anymore", () => {
    const assets = createNirvanaWestAtlasAssets(terrainImage, sceneryImage);
    expect(NIRVANA_WEST_ATLAS_PROFILE.materials).not.toContain("brine");
    expect(NIRVANA_WEST_ATLAS_PROFILE.materials).not.toContain("rime");
    expect(() => requireNirvanaWestFrame(assets, "t.brine.0")).toThrow(NirvanaWestAtlasError);
    expect(() => requireNirvanaWestFrame(assets, "t.rime.0")).toThrow(NirvanaWestAtlasError);
  });

  it("causeway publishes no base-fill frame — it is carried purely as scenery", () => {
    const assets = createNirvanaWestAtlasAssets(terrainImage, sceneryImage);
    expect(() => requireNirvanaWestFrame(assets, nirvanaWestBaseFrameId("causeway", 0)))
      .toThrow(NirvanaWestAtlasError);
  });

  it("builds corner-masked edge ids that resolve across all 14 masks", () => {
    const assets = createNirvanaWestAtlasAssets(terrainImage, sceneryImage);
    // `glass` and the new `slab`/`spoil` tiers were published with 2 edge variants per mask.
    for (const material of ["glass", "slab", "spoil"] as const) {
      for (let mask = 1; mask <= 14; mask += 1) {
        expect(requireNirvanaWestFrame(assets, nirvanaWestEdgeFrameId(material, mask, 0)).image)
          .toBe("terrain");
        expect(requireNirvanaWestFrame(assets, nirvanaWestEdgeFrameId(material, mask, 1)).image)
          .toBe("terrain");
      }
    }
  });

  it("mask 15 (total coverage) is never a drawn edge frame — the base fill serves it instead", () => {
    const assets = createNirvanaWestAtlasAssets(terrainImage, sceneryImage);
    expect(() => requireNirvanaWestFrame(assets, nirvanaWestEdgeFrameId("glass", 15, 0)))
      .toThrow(NirvanaWestAtlasError);
  });

  it("builds rim-line ids that resolve for exactly the three rim materials, across all 14 masks", () => {
    const assets = createNirvanaWestAtlasAssets(terrainImage, sceneryImage);
    expect(NIRVANA_WEST_ATLAS_PROFILE.rimMaterials).toEqual(["cinder", "ashpale", "clinker"]);
    for (const material of NIRVANA_WEST_ATLAS_PROFILE.rimMaterials) {
      for (let mask = 1; mask <= 14; mask += 1) {
        for (let variant = 0; variant < 2; variant += 1) {
          const id = nirvanaWestRimFrameId(material, mask, variant);
          expect(requireNirvanaWestFrame(assets, id).image, id).toBe("terrain");
        }
      }
    }
  });

  it("a non-rim material never owns a rim-line frame", () => {
    const assets = createNirvanaWestAtlasAssets(terrainImage, sceneryImage);
    expect(NIRVANA_WEST_ATLAS_PROFILE.rimMaterials).not.toContain("glass");
    expect(() => requireNirvanaWestFrame(assets, nirvanaWestRimFrameId("glass", 1, 0)))
      .toThrow(NirvanaWestAtlasError);
  });

  it("builds scenery ids that resolve for every published species' first variant", () => {
    const assets = createNirvanaWestAtlasAssets(terrainImage, sceneryImage);
    expect(NIRVANA_WEST_SCENERY_SPECIES).toHaveLength(27);
    expect(NIRVANA_WEST_SCENERY_SPECIES).not.toContain("slab");
    expect(NIRVANA_WEST_SCENERY_SPECIES).not.toContain("apron");
    expect(NIRVANA_WEST_SCENERY_SPECIES).not.toContain("spill");
    expect(NIRVANA_WEST_SCENERY_SPECIES).not.toContain("rimecluster");
    for (const species of NIRVANA_WEST_SCENERY_SPECIES) {
      const id = nirvanaWestSceneryFrameId(species, 0);
      expect(requireNirvanaWestFrame(assets, id).image, id).toBe("scenery");
    }
  });

  it("fails closed on a scenery variant nobody drew", () => {
    const assets = createNirvanaWestAtlasAssets(terrainImage, sceneryImage);
    // `coolingtower` was published with exactly 2 variants (0, 1).
    expect(() => requireNirvanaWestFrame(assets, nirvanaWestSceneryFrameId("coolingtower", 2)))
      .toThrow(NirvanaWestAtlasError);
  });

  it("requireNirvanaWestSceneryFrame narrows to a scenery frame and rejects a terrain id", () => {
    const assets = createNirvanaWestAtlasAssets(terrainImage, sceneryImage);
    const frame = requireNirvanaWestSceneryFrame(assets, "s.snag.0");
    expect(frame.contact).toEqual({ x: 9, y: 66, width: 15, height: 5 });
    expect(() => requireNirvanaWestSceneryFrame(assets, "t.ember.0")).toThrow(NirvanaWestAtlasError);
    expect(() => requireNirvanaWestSceneryFrame(assets, "t.ember.0"))
      .toThrow(/not a scenery frame/);
  });

  it("reports contact footprint correctly: real footprint, zero-area decal, and terrain", () => {
    const assets = createNirvanaWestAtlasAssets(terrainImage, sceneryImage);
    expect(nirvanaWestFrameHasFootprint(requireNirvanaWestFrame(assets, "s.snag.0"))).toBe(true);
    // `emberwisp` is a flat decal published with a zero-area contact rect.
    expect(nirvanaWestFrameHasFootprint(requireNirvanaWestFrame(assets, "s.emberwisp.0"))).toBe(false);
    expect(nirvanaWestFrameHasFootprint(requireNirvanaWestFrame(assets, "t.ember.0"))).toBe(false);
  });
});
