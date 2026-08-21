import { describe, expect, it } from "vitest";

// Tracked art-contract fixture. `production-native-contract.json` is the
// hand-authored native art geometry contract and has no generator in this
// repository -- it is an INPUT to `frontend/scripts/pack-2d-production-assets.mjs`.
// It used to be imported from the gitignored `scratchpad/2d-production-art/`
// working tree, which resolved only on an authoring machine, so this file
// collected ZERO tests on CI. It now lives under `../artContract/`,
// byte-identical (615,592 B,
// sha256 20f118b2da1ce3b04a5cf462b36f8ac43672bfafa5fceab0f074d6f5f445a1b5).
// Provenance and refresh procedure are documented once, at the sibling import in
// `../assets/productionManifest.test.ts`.
import nativeContract from "../artContract/production-native-contract.json";

import type { RegionKitId } from "./biomeKits";
import * as scenicLandmarksModule from "./scenicLandmarks";
import {
  LANDMARK_KINDS_BY_KIT,
  SCENIC_LANDMARK_KINDS,
  YARD_SEMANTIC_FRAMES,
  type AuthoredLandmarkVariantGeometry,
  type AuthoredVariantGeometry,
} from "./scenicLandmarks";

const KITS = [
  "worn-heartland",
  "spring-terraces",
  "dry-scrub",
  "ash-waste",
  "neutral-temperate",
] as const satisfies readonly RegionKitId[];

describe("regional composition semantic contract", () => {
  it("maps old-oak grounded trunks to adjacent support cells around the contact pivot", () => {
    const oldOaks = (scenicLandmarksModule as unknown as {
      AUTHORED_LANDMARK_VARIANTS_BY_KIT: Readonly<
        Record<RegionKitId, readonly AuthoredLandmarkVariantGeometry[]>
      >;
    }).AUTHORED_LANDMARK_VARIANTS_BY_KIT["worn-heartland"].filter(
      ({ semanticKind }) => semanticKind === "old-oak-grove-composite",
    );
    expect(oldOaks).toHaveLength(3);
    const expectedSupports: Readonly<Record<string, readonly { x: number; y: number }[]>> = {
      "worn-heartland:broad-crown": [{ x: 0, y: 0 }],
      "worn-heartland:split-crown": [{ x: -1, y: 0 }, { x: 0, y: 0 }],
      "worn-heartland:wind-worn-crown": [{ x: -1, y: 0 }, { x: 0, y: 0 }],
    };
    for (const variant of oldOaks) {
      expect(variant.hardOffsets, variant.variantId).toEqual(expectedSupports[variant.variantId]);
    }
  });

  it("publishes the exact native landmark geometry as immutable per-variant records", () => {
    interface RuntimeLandmarkGeometry {
      readonly kitId: RegionKitId;
      readonly semanticKind: string;
      readonly variantId: string;
      readonly cellIndex: number;
      readonly cellRectPx: Readonly<{ x: number; y: number; width: number; height: number }>;
      readonly orientation: string;
      readonly connectionPorts: readonly unknown[];
      readonly compatibleAdjacency: Readonly<Record<"north" | "east" | "south" | "west", string>>;
      readonly eligibleTopologyKeys: readonly string[];
      readonly contactPivotPx: Readonly<{ x: number; y: number }>;
      readonly opaqueComponentOrdinals: readonly number[];
      readonly recognitionComponentOrdinals: readonly number[];
      readonly opaqueBoundsPx: Readonly<{ x: number; y: number; width: number; height: number }>;
      readonly recognitionBoundsPx: Readonly<{ x: number; y: number; width: number; height: number }>;
      readonly visualFootprint: Readonly<{
        originOffsetTiles: Readonly<{ x: number; y: number }>;
        widthTiles: number;
        heightTiles: number;
      }>;
      readonly hardOffsets: readonly Readonly<{ x: number; y: number }>[];
      readonly interactionExclusionOffsets: readonly Readonly<{ x: number; y: number }>[];
      readonly heightPolicy: "planar" | "tall-static-back-excluded";
      readonly drawLayer: "static-back";
      readonly recognitionTags: readonly string[];
      readonly topologyKey: string;
      readonly geometryHash: string;
    }
    type GeometryBank = Readonly<Record<RegionKitId, readonly RuntimeLandmarkGeometry[]>>;
    const geometryBank = (scenicLandmarksModule as unknown as {
      AUTHORED_LANDMARK_VARIANTS_BY_KIT?: GeometryBank;
    }).AUTHORED_LANDMARK_VARIANTS_BY_KIT;
    expect(geometryBank, "runtime must publish the native landmark geometry bank").toBeDefined();
    if (!geometryBank) return;

    const sourceAtlases = (nativeContract as unknown as {
      atlases: Readonly<Record<string, Readonly<{
        authoredVariants: readonly Readonly<{
          kitId: RegionKitId;
          semanticKind: string;
          variantId: string;
          cellIndex: number;
          cellRectPx: RuntimeLandmarkGeometry["cellRectPx"];
          orientation: RuntimeLandmarkGeometry["orientation"];
          connectionPorts: RuntimeLandmarkGeometry["connectionPorts"];
          compatibleAdjacency: RuntimeLandmarkGeometry["compatibleAdjacency"];
          eligibleTopologyKeys: RuntimeLandmarkGeometry["eligibleTopologyKeys"];
          contactPivotPx: Readonly<{ x: number; y: number }>;
          opaqueComponentOrdinals: RuntimeLandmarkGeometry["opaqueComponentOrdinals"];
          recognitionComponentOrdinals: RuntimeLandmarkGeometry["recognitionComponentOrdinals"];
          opaqueBoundsPx: RuntimeLandmarkGeometry["opaqueBoundsPx"];
          recognitionBoundsPx: RuntimeLandmarkGeometry["recognitionBoundsPx"];
          visualFootprint: RuntimeLandmarkGeometry["visualFootprint"];
          hardOffsets: RuntimeLandmarkGeometry["hardOffsets"];
          interactionExclusionOffsets: RuntimeLandmarkGeometry["interactionExclusionOffsets"];
          heightPolicy: RuntimeLandmarkGeometry["heightPolicy"];
          drawLayer: RuntimeLandmarkGeometry["drawLayer"];
          recognitionTags: RuntimeLandmarkGeometry["recognitionTags"];
          geometryHash: string;
        }>[];
      }>>>;
    }).atlases;

    for (const kit of KITS) {
      const expected = sourceAtlases[`${kit}-landmarks`]!.authoredVariants.map((variant) => ({
        kitId: variant.kitId,
        semanticKind: variant.semanticKind,
        variantId: variant.variantId,
        cellIndex: variant.cellIndex,
        cellRectPx: variant.cellRectPx,
        orientation: variant.orientation,
        connectionPorts: variant.connectionPorts,
        compatibleAdjacency: variant.compatibleAdjacency,
        eligibleTopologyKeys: variant.eligibleTopologyKeys,
        contactPivotPx: variant.contactPivotPx,
        opaqueComponentOrdinals: variant.opaqueComponentOrdinals,
        recognitionComponentOrdinals: variant.recognitionComponentOrdinals,
        opaqueBoundsPx: variant.opaqueBoundsPx,
        recognitionBoundsPx: variant.recognitionBoundsPx,
        visualFootprint: variant.visualFootprint,
        hardOffsets: variant.hardOffsets,
        interactionExclusionOffsets: variant.interactionExclusionOffsets,
        heightPolicy: variant.heightPolicy,
        drawLayer: variant.drawLayer,
        recognitionTags: variant.recognitionTags,
        topologyKey: variant.eligibleTopologyKeys[0],
        geometryHash: variant.geometryHash,
      }));
      expect(geometryBank[kit], kit).toEqual(expected);
      expect(geometryBank[kit]).toHaveLength(8);
      expect(new Set(geometryBank[kit].map(({ variantId }) => variantId)).size).toBe(8);
      expect(Object.isFrozen(geometryBank[kit])).toBe(true);
      expect(Object.isFrozen(geometryBank[kit][0])).toBe(true);
      expect(Object.isFrozen(geometryBank[kit][0]!.hardOffsets)).toBe(true);
      expect(Object.isFrozen(geometryBank[kit][0]!.contactPivotPx)).toBe(true);
      expect(Object.isFrozen(geometryBank[kit][0]!.connectionPorts)).toBe(true);
      expect(Object.isFrozen(geometryBank[kit][0]!.compatibleAdjacency)).toBe(true);
      expect(Object.isFrozen(geometryBank[kit][0]!.opaqueBoundsPx)).toBe(true);
      expect(Object.isFrozen(geometryBank[kit][0]!.recognitionTags)).toBe(true);
    }
  });

  it("closes the exact 18 semantic landmark kinds across five region kits", () => {
    expect(SCENIC_LANDMARK_KINDS).toHaveLength(18);
    expect(new Set(SCENIC_LANDMARK_KINDS).size).toBe(18);
    expect(Object.keys(LANDMARK_KINDS_BY_KIT).sort()).toEqual([...KITS].sort());
    expect(Object.values(LANDMARK_KINDS_BY_KIT).flat()).toEqual(SCENIC_LANDMARK_KINDS);
    expect(YARD_SEMANTIC_FRAMES).toEqual([
      "standing-a-base",
      "standing-b-base",
      "warm-overlay",
      "durable-hoarding-overlay",
      "persistent-ruin-base",
    ]);
    expect(Object.isFrozen(SCENIC_LANDMARK_KINDS)).toBe(true);
    expect(Object.isFrozen(YARD_SEMANTIC_FRAMES)).toBe(true);
    expect(Object.isFrozen(LANDMARK_KINDS_BY_KIT)).toBe(true);
    for (const ownedKinds of Object.values(LANDMARK_KINDS_BY_KIT)) {
      expect(Object.isFrozen(ownedKinds)).toBe(true);
    }
  });

  it("requires the full byte-derived geometry and topology record at the type boundary", () => {
    const complete = {
      kitId: "ash-waste",
      semanticKind: "fractured-industrial-pylon-composite",
      variantId: "ash-pylon-snapped",
      cellIndex: 2,
      cellRectPx: { x: 256, y: 0, width: 128, height: 128 },
      orientation: "none",
      connectionPorts: [],
      compatibleAdjacency: { north: "ash", east: "ash", south: "ash", west: "ash" },
      eligibleTopologyKeys: ["ash-open"],
      contactPivotPx: { x: 64, y: 116 },
      opaqueComponentOrdinals: [0],
      recognitionComponentOrdinals: [0],
      opaqueBoundsPx: { x: 24, y: 8, width: 80, height: 112 },
      recognitionBoundsPx: { x: 24, y: 8, width: 80, height: 112 },
      visualFootprint: { originOffsetTiles: { x: -2, y: -3 }, widthTiles: 4, heightTiles: 4 },
      hardOffsets: [{ x: -1, y: 0 }, { x: 1, y: 0 }],
      interactionExclusionOffsets: [{ x: -1, y: -3 }, { x: 0, y: -3 }],
      drawLayer: "static-back",
      heightPolicy: "tall-static-back-excluded",
      recognitionTags: ["integrated-three-lobed-containment-relief"],
      geometryHash: "a".repeat(64),
    } satisfies AuthoredVariantGeometry;
    expect(complete.contactPivotPx).toEqual({ x: 64, y: 116 });
  });
});
