import { describe, expect, it } from "vitest";

import coreSource from "../../../assets/renderer2d/core/production-core-source.json";
import springRegion from "../../../assets/renderer2d/regions/spring-terraces/pack.json";
// --- Art-contract fixtures: tracked, not scratch ---------------------------
// `production-native-contract.json` is the hand-authored native art geometry
// contract (per-kit `authoredVariants` with `cellRectPx`, `connectionPorts`,
// `contactPivotPx`, `geometryHash`). Nothing in this repository generates it --
// it is an INPUT to `frontend/scripts/pack-2d-production-assets.mjs`, not an
// output. `packing-report.json` is that pipeline's byte-accounting report
// (`pack-2d-production-assets.mjs`, the `evidence/packing-report.json` entry).
//
// Both used to be imported from `../../../../../scratchpad/2d-production-art/`,
// which `.gitignore` excludes wholesale. That resolved on an authoring machine
// and could never resolve on a fresh checkout, so this file collected ZERO tests
// on CI (and `tsc --noEmit`, and therefore `npm run build:frontend`, would have
// failed on the same specifier at the next step). They are now tracked here,
// byte-identical to the working-tree originals:
//   production-native-contract.json  615,592 B
//     sha256 20f118b2da1ce3b04a5cf462b36f8ac43672bfafa5fceab0f074d6f5f445a1b5
//   packing-report.json               70,592 B
//     sha256 ad8ce4d695793df97056871301678b84642e238d7632ab680fb428cba3c06dfd
// To refresh after re-authoring native art: re-run the packing pipeline in the
// scratch tree and copy both files back over the copies in `../artContract/`,
// updating the sizes and hashes above.
import packingReport from "../artContract/packing-report.json";
import nativeContract from "../artContract/production-native-contract.json";
import { getBiomeKit, type RegionKitId } from "../maps/biomeKits";
import * as productionManifestModule from "./productionManifest";
import {
  HUMAN_BODY_ACTIONS,
  HUMAN_EXPRESSIONS,
  PRODUCTION_FACINGS,
  PRODUCTION_RIG_IDS,
  PRODUCTION_ASSET_MANIFEST,
  requireHumanClip,
  resolveClipFacing,
  validateProductionAssetManifest,
} from "./productionManifest";

const REGION_KITS = [
  "worn-heartland",
  "spring-terraces",
  "dry-scrub",
  "ash-waste",
  "neutral-temperate",
] as const satisfies readonly RegionKitId[];

const ANIMATED_KINDS = [
  "water",
  "reed",
  "grass",
  "shrub",
  "tree",
  "ember",
  "smoke-anchor",
] as const;

const cloneManifest = (): any => structuredClone(PRODUCTION_ASSET_MANIFEST);

const rejects = (
  change: (manifest: any) => void,
  pattern: RegExp,
): void => {
  const manifest = cloneManifest();
  change(manifest);
  expect(validateProductionAssetManifest(manifest)).toContainEqual(expect.stringMatching(pattern));
};

describe("production asset manifest", () => {
  it("parses the published scenery variant bank and rejects order, ownership, or range drift", () => {
    type ParsePublishedVariants = (
      kit: RegionKitId,
      primaryCells: Readonly<Record<string, number>>,
      value: unknown,
    ) => Readonly<Record<string, readonly number[]>>;
    const parse = (productionManifestModule as unknown as {
      parsePublishedSceneryVariants?: ParsePublishedVariants;
    }).parsePublishedSceneryVariants;
    expect(parse, "runtime pack JSON must cross an explicit scenery-variant parser").toBeTypeOf("function");
    const data = springRegion as unknown as {
      semanticSceneryCells: Readonly<Record<string, number>>;
      semanticSceneryVariants?: unknown;
      semanticSceneryVariantStride?: unknown;
    };
    const expected = Object.fromEntries(Object.entries(data.semanticSceneryCells).map(([kind, primary]) => [
      kind,
      Array.from({ length: 32 }, (_unused, variant) => primary + variant * 4),
    ]));
    expect(parse?.(
      "spring-terraces",
      data.semanticSceneryCells,
      data.semanticSceneryVariants ?? data.semanticSceneryVariantStride,
    )).toEqual(expected);

    const rejectsPublished = (change: (value: Record<string, number[]>) => void, pattern: RegExp): void => {
      const value = structuredClone(expected) as Record<string, number[]>;
      change(value);
      expect(() => parse?.("spring-terraces", data.semanticSceneryCells, value)).toThrow(pattern);
    };
    rejectsPublished((value) => value.willow!.reverse(), /spring-terraces.*willow.*order/i);
    rejectsPublished((value) => { value.willow![1] = value.willow![0]!; }, /spring-terraces.*willow.*duplicate/i);
    rejectsPublished((value) => { value.willow![31] = 128; }, /spring-terraces.*willow.*range/i);
    rejectsPublished((value) => { value.unowned = [...value.willow!]; }, /spring-terraces.*kind ownership/i);
  });

  it("owns metadata-inclusive totals and rejects malformed or misbound compact anchors", () => {
    const accounting = PRODUCTION_ASSET_MANIFEST.budgets as unknown as {
      readonly coreMetadataCompressedBytes?: number;
      readonly coreMetadataDecodedBytes?: number;
      readonly coreCompressedBytes?: number;
      readonly regionMetadataCompressedBytes?: Readonly<Record<RegionKitId, number>>;
      readonly regionMetadataDecodedBytes?: Readonly<Record<RegionKitId, number>>;
      readonly regionCompressedBytes?: Readonly<Record<RegionKitId, number>>;
      readonly activeCompressedBytes?: Readonly<Record<RegionKitId, number>>;
      readonly exactPeakActiveDecodedBytes?: number | Readonly<Record<RegionKitId, number>>;
    };
    const coreJsonBytes = new TextEncoder().encode(`${JSON.stringify(coreSource)}\n`).byteLength;
    expect.soft(accounting.coreMetadataCompressedBytes).toBe(coreJsonBytes);
    expect.soft(accounting.coreMetadataDecodedBytes).toBe(coreJsonBytes);
    expect.soft(accounting.coreCompressedBytes).toBe(packingReport.coreCompressedBytes);
    expect.soft(PRODUCTION_ASSET_MANIFEST.budgets.exactCoreDecodedBytes)
      .toBe(packingReport.exactCoreDecodedBytes);
    expect.soft(accounting.regionMetadataCompressedBytes)
      .toEqual(packingReport.regionMetadataCompressedBytes);
    expect.soft(accounting.regionMetadataDecodedBytes)
      .toEqual(packingReport.regionMetadataDecodedBytes);
    expect.soft(accounting.regionCompressedBytes).toEqual(packingReport.regionCompressedBytes);
    expect.soft(accounting.activeCompressedBytes).toEqual(packingReport.activeCompressedBytes);
    expect.soft(accounting.exactPeakActiveDecodedBytes)
      .toEqual(packingReport.exactPeakActiveDecodedBytes);

    type ParseBodyFrameAnchors = (value: unknown) => readonly Readonly<[
      number, number, number, number, number, number,
    ]>[];
    const parse = (productionManifestModule as unknown as {
      parseBodyFrameAnchors?: ParseBodyFrameAnchors;
    }).parseBodyFrameAnchors;
    expect.soft(parse, "runtime JSON must cross an explicit compact-anchor parser").toBeTypeOf("function");
    const wishedForParser: ParseBodyFrameAnchors = parse ?? ((value) => value as ReturnType<ParseBodyFrameAnchors>);
    const valid = (coreSource.bodyFrameAnchors as readonly number[][]).map((tuple) => [...tuple]);
    expect.soft(() => wishedForParser(valid.slice(0, 343))).toThrow(/344|count/i);
    expect.soft(() => wishedForParser(valid.map((tuple, index) => (
      index === 0 ? tuple.slice(0, 5) : tuple
    )))).toThrow(/six|arity|tuple/i);
    expect.soft(() => wishedForParser(valid.map((tuple, index) => (
      index === 0 ? [0.5, ...tuple.slice(1)] : tuple
    )))).toThrow(/integer/i);

    const mutated = cloneManifest();
    mutated.human.rigs["human-a"].bodyClips["idle:south"].frames[0].feet.x += 1;
    expect.soft(validateProductionAssetManifest(mutated).join("\n"))
      .toMatch(/anchor|attachment|body.*cell.*tuple/i);

    const permuted = cloneManifest();
    const frames = permuted.human.rigs["human-a"].bodyClips["idle:south"].frames;
    const firstAnchors = {
      feet: structuredClone(frames[0].feet),
      faceAnchor: structuredClone(frames[0].faceAnchor),
      heldAnchor: structuredClone(frames[0].heldAnchor),
    };
    frames[0].feet = structuredClone(frames[1].feet);
    frames[0].faceAnchor = structuredClone(frames[1].faceAnchor);
    frames[0].heldAnchor = structuredClone(frames[1].heldAnchor);
    Object.assign(frames[1], firstAnchors);
    expect.soft(validateProductionAssetManifest(permuted).join("\n"))
      .toMatch(/anchor|attachment|body.*cell.*tuple/i);
  });

  it("consumes every serialized measured body anchor instead of replacing it with constants", () => {
    const bodyFrameAnchors = (coreSource as unknown as {
      bodyFrameAnchors?: readonly Readonly<[
        feetX: number,
        feetY: number,
        faceX: number,
        faceY: number,
        heldX: number,
        heldY: number,
      ]>[];
    }).bodyFrameAnchors;
    expect(bodyFrameAnchors).toHaveLength(344);

    for (const rig of PRODUCTION_RIG_IDS) {
      for (const action of HUMAN_BODY_ACTIONS) {
        for (const facing of PRODUCTION_FACINGS) {
          const clip = requireHumanClip(PRODUCTION_ASSET_MANIFEST, rig, action, facing);
          for (const frame of clip.frames) {
            const atlas = PRODUCTION_ASSET_MANIFEST.atlases[frame.atlasId];
            const cell = Math.floor(frame.rect.y / atlas.cellHeight) * atlas.columns
              + Math.floor(frame.rect.x / atlas.cellWidth);
            const [feetX, feetY, faceX, faceY, heldX, heldY] = bodyFrameAnchors![cell]!;
            expect(frame, `${clip.id}/${cell}`).toMatchObject({
              feet: { x: feetX, y: feetY },
              faceAnchor: { x: faceX, y: faceY },
              heldAnchor: { x: heldX, y: heldY },
            });
          }
        }
      }
    }
  });

  it("RED: imports every face-plane count and hash from byte-derived runtime metadata", () => {
    type CompactFacePlane = readonly [
      maskPixels: number,
      coveredMaskPixels: number,
      leakedPixels: number,
      eyeComponents: number,
      noseDirection: number,
      mouthPixels: number,
      semanticPixelsSha256: string,
      measuredFromSha256: string,
    ];
    const source = coreSource as unknown as {
      facePlaneMetrics?: readonly CompactFacePlane[];
      bodyFacePlaneMetrics?: readonly (readonly [planePixels: number, facialFeaturePixels: number])[];
    };
    expect(source.facePlaneMetrics).toHaveLength(
      PRODUCTION_RIG_IDS.length * PRODUCTION_FACINGS.length * HUMAN_EXPRESSIONS.length,
    );
    expect(source.bodyFacePlaneMetrics).toHaveLength(PRODUCTION_RIG_IDS.length * PRODUCTION_FACINGS.length);

    const faceAtlasSha256 = (coreSource.atlases as readonly { readonly id: string; readonly sha256: string }[])
      .find(({ id }) => id === "core-human-face-planes")!.sha256;
    type ParseFaceMetrics = (
      value: unknown,
      measuredFromSha256: string,
    ) => readonly CompactFacePlane[];
    type ParseBodyMetrics = (
      value: unknown,
    ) => readonly (readonly [planePixels: number, facialFeaturePixels: number])[];
    const parseFaceMetrics = (productionManifestModule as unknown as {
      parseFacePlaneMetrics?: ParseFaceMetrics;
    }).parseFacePlaneMetrics;
    const parseBodyMetrics = (productionManifestModule as unknown as {
      parseBodyFacePlaneMetrics?: ParseBodyMetrics;
    }).parseBodyFacePlaneMetrics;
    expect(parseFaceMetrics).toBeTypeOf("function");
    expect(parseBodyMetrics).toBeTypeOf("function");
    const validMetrics = source.facePlaneMetrics!.map((tuple) => [...tuple]);
    expect(() => parseFaceMetrics?.(validMetrics.map((tuple, index) => (
      index === 0 ? [-1, ...tuple.slice(1)] : tuple
    )), faceAtlasSha256)).toThrow(/count|nonnegative|legal/i);
    expect(() => parseFaceMetrics?.(validMetrics.map((tuple, index) => (
      index === 0 ? [...tuple.slice(0, 3), 3, ...tuple.slice(4)] : tuple
    )), faceAtlasSha256)).toThrow(/eye|component|legal/i);
    expect(() => parseFaceMetrics?.(validMetrics.map((tuple, index) => (
      index === 0 ? [...tuple.slice(0, 6), "not-a-hash", tuple[7]] : tuple
    )), faceAtlasSha256)).toThrow(/sha-256|hash/i);

    const rejectsFaceTuple = (
      index: number,
      change: (tuple: unknown[]) => void,
      pattern: RegExp,
    ): void => {
      const hostile = validMetrics.map((tuple) => [...tuple]);
      change(hostile[index]!);
      expect(() => parseFaceMetrics?.(hostile, faceAtlasSha256)).toThrow(pattern);
    };
    rejectsFaceTuple(0, (tuple) => { tuple[0] = 0; }, /mask.*positive/i);
    rejectsFaceTuple(0, (tuple) => { tuple[1] = Number(tuple[0]) - 1; }, /covered.*mask/i);
    rejectsFaceTuple(0, (tuple) => { tuple[2] = 1; }, /leak/i);
    rejectsFaceTuple(0, (tuple) => { tuple[3] = 1; }, /south.*two eyes/i);
    rejectsFaceTuple(0, (tuple) => { tuple[4] = 1; }, /south.*nose/i);
    rejectsFaceTuple(0, (tuple) => { tuple[5] = 0; }, /south.*mouth/i);
    rejectsFaceTuple(16, (tuple) => { tuple[3] = 2; }, /east.*one eye/i);
    rejectsFaceTuple(16, (tuple) => { tuple[4] = 3; }, /east.*nose/i);
    rejectsFaceTuple(16, (tuple) => { tuple[5] = 0; }, /east.*mouth/i);
    rejectsFaceTuple(32, (tuple) => { tuple[3] = 1; }, /north.*eye/i);
    rejectsFaceTuple(32, (tuple) => { tuple[4] = 2; }, /north.*nose/i);
    rejectsFaceTuple(32, (tuple) => { tuple[5] = 1; }, /north.*mouth/i);
    rejectsFaceTuple(48, (tuple) => { tuple[3] = 2; }, /west.*one eye/i);
    rejectsFaceTuple(48, (tuple) => { tuple[4] = 1; }, /west.*nose/i);
    rejectsFaceTuple(48, (tuple) => { tuple[5] = 0; }, /west.*mouth/i);
    rejectsFaceTuple(0, (tuple) => {
      tuple[7] = "0".repeat(64);
    }, /measured.*face atlas.*sha/i);

    const validBodyMetrics = source.bodyFacePlaneMetrics!.map((tuple) => [...tuple]);
    const rejectsBodyTuple = (change: (tuple: number[]) => void, pattern: RegExp): void => {
      const hostile = validBodyMetrics.map((tuple) => [...tuple]);
      change(hostile[0]!);
      expect(() => parseBodyMetrics?.(hostile)).toThrow(pattern);
    };
    rejectsBodyTuple((tuple) => { tuple[0] = 0; }, /plane.*positive/i);
    rejectsBodyTuple((tuple) => { tuple[1] = 1; }, /feature.*zero/i);

    let cell = 0;
    for (const facing of PRODUCTION_FACINGS) {
      for (const rig of PRODUCTION_RIG_IDS) {
        const bodyIndex = PRODUCTION_RIG_IDS.indexOf(rig) * PRODUCTION_FACINGS.length
          + PRODUCTION_FACINGS.indexOf(facing);
        const [planePixels, facialFeaturePixels] = source.bodyFacePlaneMetrics![bodyIndex]!;
        expect(PRODUCTION_ASSET_MANIFEST.human.rigs[rig].bodyFacePlanes[facing]).toEqual({
          planePixels,
          facialFeaturePixels,
        });
        for (const expression of HUMAN_EXPRESSIONS) {
          const [maskPixels, coveredMaskPixels, leakedPixels, eyes, noseCode, mouthPixels,
            semanticPixelsSha256, measuredFromSha256] = source.facePlaneMetrics![cell]!;
          const plane = PRODUCTION_ASSET_MANIFEST.human.rigs[rig].facePlanes[facing][expression] as typeof PRODUCTION_ASSET_MANIFEST.human.rigs[typeof rig]["facePlanes"][typeof facing][typeof expression] & {
            semanticPixelsSha256?: string;
            measuredFromSha256?: string;
          };
          expect(plane).toMatchObject({
            maskPixels,
            coveredMaskPixels,
            leakedPixels,
            semanticFeaturePixels: {
              eyes,
              noseDirection: ["north-hidden", "east", "south", "west"][noseCode],
              mouthPixels,
            },
            semanticPixelsSha256,
            measuredFromSha256,
          });
          cell += 1;
        }
      }
    }
  });

  it("fails manifest construction closed before exposing a frozen production value", () => {
    type FinalizeManifest = (manifest: typeof PRODUCTION_ASSET_MANIFEST) => typeof PRODUCTION_ASSET_MANIFEST;
    const finalize = (productionManifestModule as unknown as {
      finalizeProductionAssetManifest?: FinalizeManifest;
    }).finalizeProductionAssetManifest;
    expect(finalize).toBeTypeOf("function");
    const hostile = structuredClone(PRODUCTION_ASSET_MANIFEST);
    (hostile.human.rigs["human-a"].facePlanes.east.neutral.frame.faceAnchor as { x: number }).x = 24;
    expect(() => finalize?.(hostile)).toThrow(/manifest.*invalid|face.*anchor/i);

    const mismatchedDescriptor = structuredClone(PRODUCTION_ASSET_MANIFEST);
    const faceAtlasId = mismatchedDescriptor.human.layerAtlases.face;
    (mismatchedDescriptor.atlases[faceAtlasId] as { sha256: string }).sha256 = "0".repeat(64);
    expect(validateProductionAssetManifest(mismatchedDescriptor)).toContainEqual(
      expect.stringMatching(/face.*measured.*descriptor.*sha/i),
    );
    expect(() => finalize?.(mismatchedDescriptor)).toThrow(/manifest.*invalid.*descriptor.*sha/i);
  });

  it("publishes semantic directional anchors on every face-plane frame", () => {
    const expected = {
      south: { x: 24, y: 18 },
      east: { x: 26, y: 19 },
      north: { x: 24, y: 18 },
      west: { x: 22, y: 18 },
    } as const;
    for (const rig of PRODUCTION_RIG_IDS) {
      for (const facing of PRODUCTION_FACINGS) {
        for (const expression of HUMAN_EXPRESSIONS) {
          expect(
            PRODUCTION_ASSET_MANIFEST.human.rigs[rig].facePlanes[facing][expression].frame.faceAnchor,
            `${rig}/${facing}/${expression}`,
          ).toEqual(expected[facing]);
        }
      }
    }
  });

  it("publishes exact named held forms and explicit status frames", () => {
    const human = PRODUCTION_ASSET_MANIFEST.human as unknown as {
      heldForms?: readonly string[];
      heldFrames?: Readonly<Record<string, Readonly<Record<string, {
        atlasId: string;
        rect: Readonly<{ x: number; y: number; width: number; height: number }>;
      }>>>>;
      statusFrames?: Readonly<Record<string, {
        atlasId: string;
        rect: Readonly<{ x: number; y: number; width: number; height: number }>;
      }>>;
    };
    const heldForms = [
      "none", "basket", "wood-bundle", "stone-bundle", "material-crate", "energy-gift",
      "proposal-token", "hammer", "hearth-fuel", "vault-deposit", "vault-withdraw",
      "raid-tool", "loot-crate", "ruin-debris", "resource-handful", "reserve",
    ];
    expect(human.heldForms).toEqual(heldForms);
    for (const [formIndex, form] of heldForms.entries()) {
      for (const [facingIndex, facing] of PRODUCTION_FACINGS.entries()) {
        expect(human.heldFrames?.[form]?.[facing], `${form}/${facing}`).toMatchObject({
          atlasId: "core-human-held",
          rect: { x: formIndex * 48, y: facingIndex * 64, width: 48, height: 64 },
        });
      }
    }
    expect(human.statusFrames).toMatchObject({
      selected: { atlasId: "core-human-status-effects", rect: { x: 0, y: 0, width: 32, height: 32 } },
      paralyzed: { atlasId: "core-human-status-effects", rect: { x: 32, y: 0, width: 32, height: 32 } },
      dead: { atlasId: "core-human-status-effects", rect: { x: 64, y: 0, width: 32, height: 32 } },
    });
  });

  it("declares every rig, action, facing, expression, and independent appearance inventory", () => {
    expect(PRODUCTION_RIG_IDS).toEqual(["human-a", "human-b"]);
    expect(PRODUCTION_FACINGS).toEqual(["south", "east", "north", "west"]);
    expect(HUMAN_BODY_ACTIONS).toEqual([
      "idle",
      "walk",
      "run",
      "turn",
      "stop",
      "reach-give",
      "work",
      "hurt-fall",
      "prone",
      "dead",
    ]);
    expect(HUMAN_EXPRESSIONS).toEqual([
      "neutral",
      "blink-1",
      "blink-2",
      "talk-1",
      "talk-2",
      "weary",
      "hurt",
      "recovery",
    ]);

    expect(PRODUCTION_ASSET_MANIFEST.human.palettes.skin).toHaveLength(6);
    expect(PRODUCTION_ASSET_MANIFEST.human.hairSilhouettes).toHaveLength(8);
    expect(PRODUCTION_ASSET_MANIFEST.human.palettes.hair).toHaveLength(6);
    expect(PRODUCTION_ASSET_MANIFEST.human.clothingSilhouettes).toHaveLength(8);
    expect(PRODUCTION_ASSET_MANIFEST.human.palettes.clothing).toHaveLength(8);

    for (const rig of PRODUCTION_RIG_IDS) {
      for (const action of HUMAN_BODY_ACTIONS) {
        for (const facing of PRODUCTION_FACINGS) {
          expect(requireHumanClip(PRODUCTION_ASSET_MANIFEST, rig, action, facing)).toBeDefined();
        }
      }
    }
    expect(validateProductionAssetManifest(PRODUCTION_ASSET_MANIFEST)).toEqual([]);
  });

  it("binds every face expression to the body's exact facing", () => {
    for (const rig of PRODUCTION_RIG_IDS) {
      const rigManifest = PRODUCTION_ASSET_MANIFEST.human.rigs[rig];
      expect(Object.keys(rigManifest.facePlanes).sort()).toEqual([...PRODUCTION_FACINGS].sort());
      for (const facing of PRODUCTION_FACINGS) {
        const directional = rigManifest.facePlanes[facing];
        expect(Object.keys(directional).sort()).toEqual([...HUMAN_EXPRESSIONS].sort());
        for (const expression of HUMAN_EXPRESSIONS) {
          const plane = directional[expression];
          expect(plane.rig).toBe(rig);
          expect(plane.facing).toBe(facing);
          expect(plane.expression).toBe(expression);
        }
      }
      expect((rigManifest.facePlanes as Record<string, unknown>).neutral).toBeUndefined();
    }
  });

  it("keeps facial-feature pixels out of the body base layer", () => {
    for (const rig of PRODUCTION_RIG_IDS) {
      for (const facing of PRODUCTION_FACINGS) {
        const metrics = PRODUCTION_ASSET_MANIFEST.human.rigs[rig].bodyFacePlanes[facing];
        expect(metrics.planePixels).toBeGreaterThan(0);
        expect(metrics.facialFeaturePixels).toBe(0);
      }
    }
    rejects((manifest) => {
      manifest.human.rigs["human-a"].bodyFacePlanes.east.facialFeaturePixels = 1;
    }, /body.*facial-feature pixels.*human-a.*east/i);
  });

  it("covers the complete directional face plane without leaking baked features", () => {
    for (const rig of PRODUCTION_RIG_IDS) {
      for (const facing of PRODUCTION_FACINGS) {
        const bodyPlane = PRODUCTION_ASSET_MANIFEST.human.rigs[rig].bodyFacePlanes[facing];
        for (const expression of HUMAN_EXPRESSIONS) {
          const face = PRODUCTION_ASSET_MANIFEST.human.rigs[rig].facePlanes[facing][expression];
          expect(face.maskPixels).toBe(bodyPlane.planePixels);
          expect(face.coveredMaskPixels).toBe(face.maskPixels);
          expect(face.leakedPixels).toBe(0);
        }
      }
    }
    rejects((manifest) => {
      manifest.human.rigs["human-b"].facePlanes.west.neutral.coveredMaskPixels -= 1;
    }, /incomplete.*face-plane mask.*human-b.*west.*neutral/i);
  });

  it("switches body and face facing on the same turn marker", () => {
    for (const rig of PRODUCTION_RIG_IDS) {
      for (const facing of PRODUCTION_FACINGS) {
        const turn = requireHumanClip(PRODUCTION_ASSET_MANIFEST, rig, "turn", facing);
        const switches = turn.markers.filter(({ name }) => name === "facing-switch");
        expect(switches).toHaveLength(1);
        expect(turn.layerFacingSwitchFrames).toEqual({
          body: switches[0]?.frame,
          face: switches[0]?.frame,
          hair: switches[0]?.frame,
          clothing: switches[0]?.frame,
          held: switches[0]?.frame,
          status: switches[0]?.frame,
        });
        for (const expression of HUMAN_EXPRESSIONS) {
          expect(PRODUCTION_ASSET_MANIFEST.human.rigs[rig].facePlanes[facing][expression].facing)
            .toBe(facing);
        }
      }
    }
    rejects((manifest) => {
      const turn = requireHumanClip(manifest, "human-a", "turn", "east");
      turn.layerFacingSwitchFrames.face += 1;
    }, /body and face.*same.*facing-switch/i);
  });

  it("preserves the last presented facing for every directionless action", () => {
    for (const rig of PRODUCTION_RIG_IDS) {
      for (const action of ["reach-give", "work", "hurt-fall", "prone", "dead"] as const) {
        for (const facing of PRODUCTION_FACINGS) {
          const clip = requireHumanClip(PRODUCTION_ASSET_MANIFEST, rig, action, facing);
          expect(clip.direction).toBe("none");
          expect(clip.facingPolicy).toBe("preserve");
          expect(resolveClipFacing(clip, facing)).toBe(facing);
        }
      }
    }
  });

  it.each([
    ["expression-only face key", /expression-only.*face/i, (manifest: any) => {
      (manifest.human.rigs["human-a"].facePlanes as Record<string, unknown>).neutral =
        manifest.human.rigs["human-a"].facePlanes.south.neutral;
    }],
    ["south fallback for direction:none", /direction.*none.*preserve|south fallback/i,
      (manifest: any) => {
        const clip = requireHumanClip(manifest, "human-a", "work", "east");
        clip.facingPolicy = "explicit";
        clip.fallbackFacing = "south";
      }],
    ["mismatched face/body facing", /face.*body.*facing|east.*west/i,
      (manifest: any) => {
        manifest.human.rigs["human-a"].facePlanes.east.neutral.facing = "west";
      }],
    ["two front-facing eyes in an east profile", /profile.*one.*eye|east.*eyes/i,
      (manifest: any) => {
        manifest.human.rigs["human-a"].facePlanes.east.neutral.semanticFeaturePixels.eyes = 2;
      }],
    ["two front-facing eyes in a west profile", /profile.*one.*eye|west.*eyes/i,
      (manifest: any) => {
        manifest.human.rigs["human-b"].facePlanes.west.neutral.semanticFeaturePixels.eyes = 2;
      }],
    ["front eye in a north face", /north.*front|north.*eyes/i,
      (manifest: any) => {
        manifest.human.rigs["human-a"].facePlanes.north.neutral.semanticFeaturePixels.eyes = 1;
      }],
    ["front nose in a north face", /north.*front|north.*nose/i,
      (manifest: any) => {
        manifest.human.rigs["human-a"].facePlanes.north.neutral.semanticFeaturePixels.noseDirection = "south";
      }],
    ["front mouth in a north face", /north.*front|north.*mouth/i,
      (manifest: any) => {
        manifest.human.rigs["human-a"].facePlanes.north.neutral.semanticFeaturePixels.mouthPixels = 1;
      }],
    ["partial face-plane mask", /incomplete.*face-plane mask/i,
      (manifest: any) => {
        manifest.human.rigs["human-a"].facePlanes.south.neutral.coveredMaskPixels -= 1;
      }],
  ])("rejects %s", (_label, pattern, change) => {
    rejects(change, pattern);
  });

  it("requires same-rig same-facing silhouette fallbacks without borrowing south anatomy", () => {
    for (const rig of PRODUCTION_RIG_IDS) {
      const fallbacks = PRODUCTION_ASSET_MANIFEST.human.rigs[rig].silhouetteFallbacks;
      for (const facing of PRODUCTION_FACINGS) {
        expect(fallbacks[facing].rig).toBe(rig);
        expect(fallbacks[facing].facing).toBe(facing);
      }
    }
    rejects((manifest) => {
      manifest.human.rigs["human-b"].silhouetteFallbacks.east =
        manifest.human.rigs["human-b"].silhouetteFallbacks.south;
    }, /fallback.*human-b.*east.*same facing/i);
  });

  it("maps every Task 6 biome scenery and animated kind in exactly five lazy region packs", () => {
    expect(Object.keys(PRODUCTION_ASSET_MANIFEST.regions).sort()).toEqual([...REGION_KITS].sort());
    const mappedAnimated = new Set<string>();
    for (const kitId of REGION_KITS) {
      const kit = getBiomeKit(kitId);
      const pack = PRODUCTION_ASSET_MANIFEST.regions[kitId];
      expect(pack.kit).toBe(kitId);
      for (const kind of [...kit.blockingScenery, ...kit.passiveScenery]) {
        expect(pack.staticSceneryFrames[kind], `${kitId}/${kind}`).toBeDefined();
      }
      for (const kind of kit.animatedKinds) {
        expect(pack.animatedFrames[kind], `${kitId}/${kind}`).toBeDefined();
        mappedAnimated.add(kind);
      }
      expect(pack.homeManifest.logicalBounds.width).toBeGreaterThan(48);
      expect(pack.homeManifest.logicalBounds.height).toBeGreaterThan(64);
      expect(pack.homeManifest.doorClearance.width).toBeGreaterThanOrEqual(16);
      expect(pack.homeManifest.doorClearance.height).toBeGreaterThanOrEqual(48);
    }
    expect([...mappedAnimated].sort()).toEqual([...ANIMATED_KINDS].sort());
  });

  it("RED Task12R: binds large regional landmarks and five-state home yards without using semantic names as atlas IDs", () => {
    expect(Object.keys(PRODUCTION_ASSET_MANIFEST.atlases)).toHaveLength(54);
    for (const kitId of REGION_KITS) {
      const pack = PRODUCTION_ASSET_MANIFEST.regions[kitId] as any;
      const landmarkAtlasId = `${kitId}-landmarks`;
      const yardAtlasId = `${kitId}-home-yards`;
      expect(pack.atlasIds).toContain(landmarkAtlasId);
      expect(pack.atlasIds).toContain(yardAtlasId);
      expect(PRODUCTION_ASSET_MANIFEST.atlases[landmarkAtlasId]).toMatchObject({
        group: "region",
        regionKit: kitId,
        width: 512,
        height: 256,
        cellWidth: 128,
        cellHeight: 128,
      });
      expect(PRODUCTION_ASSET_MANIFEST.atlases[yardAtlasId]).toMatchObject({
        group: "home",
        regionKit: kitId,
        width: 960,
        height: 160,
        cellWidth: 192,
        cellHeight: 160,
      });
      expect(Object.keys(pack.landmarkFrames ?? {}).length).toBeGreaterThan(0);
      for (const [semanticKind, binding] of Object.entries(pack.landmarkFrames ?? {}) as any) {
        expect(semanticKind).not.toBe(landmarkAtlasId);
        expect(binding.variants.length).toBeGreaterThan(0);
        expect(binding.variants.every(({ atlasId }: any) => atlasId === landmarkAtlasId)).toBe(true);
        expect(binding.renderSizePx).toEqual({ width: 128, height: 128 });
        expect(binding).not.toHaveProperty("geometryHashes");
        expect(binding).not.toHaveProperty("contactPivotPx");
      }
      expect(pack.homeManifest.yard).toMatchObject({
        atlasId: yardAtlasId,
        renderSizePx: { width: 192, height: 160 },
        plotOffsetPx: { x: -32, y: -16 },
        contactPivotPx: { x: 96, y: 112 },
        southPort: { startPx: 80, widthPx: 32 },
      });
      expect(pack.homeManifest.yard.standingVariants).toHaveLength(2);
      expect(pack.homeManifest.yard.warmFrame.atlasId).toBe(yardAtlasId);
      expect(pack.homeManifest.yard.hoardingFrame.atlasId).toBe(yardAtlasId);
      expect(pack.homeManifest.yard.ruinFrame.atlasId).toBe(yardAtlasId);
    }
  });

  it("publishes one frozen frame-plus-geometry record for every authored landmark variant", () => {
    const sourceAtlases = (nativeContract as unknown as {
      atlases: Readonly<Record<string, Readonly<{
        authoredVariants: readonly Readonly<{
          kitId: RegionKitId;
          semanticKind: string;
          variantId: string;
          cellIndex: number;
          cellRectPx: Readonly<{ x: number; y: number; width: number; height: number }>;
          orientation: string;
          connectionPorts: unknown;
          compatibleAdjacency: unknown;
          eligibleTopologyKeys: readonly string[];
          contactPivotPx: Readonly<{ x: number; y: number }>;
          opaqueComponentOrdinals: unknown;
          recognitionComponentOrdinals: unknown;
          opaqueBoundsPx: unknown;
          recognitionBoundsPx: unknown;
          visualFootprint: unknown;
          hardOffsets: unknown;
          interactionExclusionOffsets: unknown;
          heightPolicy: string;
          drawLayer: string;
          recognitionTags: unknown;
          geometryHash: string;
        }>[];
        sourceSha256: string;
      }>>>;
    }).atlases;

    for (const kit of REGION_KITS) {
      const sourceVariants = sourceAtlases[`${kit}-landmarks`]!.authoredVariants;
      const runtimeVariants = Object.values(PRODUCTION_ASSET_MANIFEST.regions[kit].landmarkFrames)
        .flatMap((binding) => binding?.variants ?? []) as readonly any[];
      expect(runtimeVariants).toHaveLength(8);
      for (const source of sourceVariants) {
        const runtime = runtimeVariants.find(({ variantId }) => variantId === source.variantId);
        expect(runtime, source.variantId).toMatchObject({
          kitId: source.kitId,
          semanticKind: source.semanticKind,
          variantId: source.variantId,
          cellIndex: source.cellIndex,
          atlasId: `${kit}-landmarks`,
          atlasPixelSha256: sourceAtlases[`${kit}-landmarks`]!.sourceSha256,
          rect: source.cellRectPx,
          cellRectPx: source.cellRectPx,
          orientation: source.orientation,
          connectionPorts: source.connectionPorts,
          compatibleAdjacency: source.compatibleAdjacency,
          eligibleTopologyKeys: source.eligibleTopologyKeys,
          contactPivotPx: source.contactPivotPx,
          opaqueComponentOrdinals: source.opaqueComponentOrdinals,
          recognitionComponentOrdinals: source.recognitionComponentOrdinals,
          opaqueBoundsPx: source.opaqueBoundsPx,
          recognitionBoundsPx: source.recognitionBoundsPx,
          visualFootprint: source.visualFootprint,
          hardOffsets: source.hardOffsets,
          interactionExclusionOffsets: source.interactionExclusionOffsets,
          heightPolicy: source.heightPolicy,
          drawLayer: source.drawLayer,
          recognitionTags: source.recognitionTags,
          topologyKey: source.eligibleTopologyKeys[0],
          geometryHash: source.geometryHash,
        });
        expect(Object.isFrozen(runtime)).toBe(true);
        expect(Object.isFrozen(runtime.rect)).toBe(true);
        expect(Object.isFrozen(runtime.feet)).toBe(true);
        expect(Object.isFrozen(runtime.faceAnchor)).toBe(true);
        expect(Object.isFrozen(runtime.heldAnchor)).toBe(true);
        expect(Object.isFrozen(runtime.contactPivotPx)).toBe(true);
        expect(Object.isFrozen(runtime.hardOffsets)).toBe(true);
        expect(Object.isFrozen(runtime.interactionExclusionOffsets)).toBe(true);
      }
    }
  });

  it("RED Task12R: rejects missing, foreign, duplicate, stale, and out-of-range landmark or yard bindings", () => {
    rejects((manifest) => {
      delete manifest.regions["ash-waste"].landmarkFrames["nuclear-crater-fissure-composite"];
    }, /ash-waste.*nuclear-crater-fissure.*missing|required/i);
    rejects((manifest) => {
      manifest.regions["ash-waste"].landmarkFrames["fractured-industrial-pylon-composite"].variants[0].kitId =
        "worn-heartland";
    }, /ash-waste.*pylon.*ownership|foreign.*landmark|kit.*ownership/i);
    rejects((manifest) => {
      manifest.regions["ash-waste"].landmarkFrames["fractured-industrial-pylon-composite"].variants[0].atlasId =
        "worn-heartland-landmarks";
    }, /ash-waste.*pylon.*ownership|foreign.*landmark|atlas.*ownership/i);
    rejects((manifest) => {
      const variants = manifest.regions["ash-waste"].landmarkFrames["fractured-industrial-pylon-composite"].variants;
      variants[1].variantId = variants[0].variantId;
    }, /ash-waste.*pylon.*duplicate.*variant|variant.*identity/i);
    rejects((manifest) => {
      const variants = manifest.regions["ash-waste"].landmarkFrames["fractured-industrial-pylon-composite"].variants;
      variants[0].rect = structuredClone(variants[1].rect);
    }, /ash-waste.*pylon.*frame.*geometry|cell.*rect|atomic.*binding/i);
    rejects((manifest) => {
      manifest.regions["ash-waste"].landmarkFrames["fractured-industrial-pylon-composite"].variants[0].rect.x = 512;
    }, /ash-waste.*pylon.*range|frame.*bounds/i);
    rejects((manifest) => {
      manifest.regions["ash-waste"].landmarkFrames["fractured-industrial-pylon-composite"].variants[0].geometryHash =
        "0".repeat(64);
    }, /ash-waste.*pylon.*geometry.*hash|stale.*hash/i);
    rejects((manifest) => {
      manifest.regions["ash-waste"].landmarkFrames["fractured-industrial-pylon-composite"]
        .variants[0].hardOffsets[0].x += 1;
    }, /ash-waste.*pylon.*geometry.*stale|hard.*offset|atomic.*binding/i);
    rejects((manifest) => {
      manifest.regions["ash-waste"].landmarkFrames["fractured-industrial-pylon-composite"]
        .variants[0].contactPivotPx.x = 64.5;
    }, /ash-waste.*pylon.*pivot.*integer|non-integer.*pivot/i);
    rejects((manifest) => {
      manifest.regions["ash-waste"].landmarkFrames["fractured-industrial-pylon-composite"]
        .variants[0].recognitionTags = ["valid-looking-but-stale"];
    }, /ash-waste.*pylon.*geometry.*stale|recognition.*tag|atomic.*binding/i);
    rejects((manifest) => {
      manifest.atlases["ash-waste-landmarks"].sha256 = "f".repeat(64);
    }, /ash-waste.*landmark.*pixel.*sha|native.*atlas.*sha/i);
    rejects((manifest) => {
      manifest.regions["ash-waste"].homeManifest.yard.atlasId = "spring-terraces-home-yards";
    }, /ash-waste.*yard.*ownership|foreign.*yard/i);
    rejects((manifest) => {
      manifest.regions["ash-waste"].homeManifest.yard.standingVariants[1] =
        structuredClone(manifest.regions["ash-waste"].homeManifest.yard.standingVariants[0]);
    }, /ash-waste.*yard.*duplicate|duplicate.*yard/i);
    rejects((manifest) => {
      manifest.regions["ash-waste"].homeManifest.yard.contactPivotPx.x = 95;
    }, /ash-waste.*yard.*pivot|96.*112/i);
  });

  it("exposes only disjoint named semantic terrain bands and explicit scenery cells", () => {
    const expectedCells = {
      ground: [0, 1, 2, 3, 4, 5, 6, 7],
      path: [8, 9, 10, 11, 12, 13, 14, 15],
      water: [16, 17, 18, 19, 20, 21, 22, 23],
      shore: [24, 25, 26, 27, 28, 29, 30, 31],
      soil: [32, 33, 34, 35],
    } as const;
    for (const kitId of REGION_KITS) {
      const kit = getBiomeKit(kitId);
      const pack = PRODUCTION_ASSET_MANIFEST.regions[kitId] as unknown as {
        terrainFramesByRole?: Readonly<Record<keyof typeof expectedCells, readonly Readonly<{
          cell: number;
          frame: { atlasId: string };
        }>[]>>;
        staticSceneryFrames: Readonly<Record<string, { rect: { x: number; y: number } }>>;
        staticSceneryVariants: Readonly<Record<string, readonly { rect: { x: number; y: number } }[]>>;
      };
      expect(Object.keys(pack.terrainFramesByRole ?? {}).sort(), kitId)
        .toEqual(Object.keys(expectedCells).sort());
      for (const [role, cells] of Object.entries(expectedCells)) {
        expect(pack.terrainFramesByRole?.[role as keyof typeof expectedCells].map(({ cell }) => cell), `${kitId}/${role}`)
          .toEqual(cells);
        expect(pack.terrainFramesByRole?.[role as keyof typeof expectedCells].every(({ frame }) => (
          frame.atlasId === `${kitId}-terrain`
        ))).toBe(true);
      }
      for (const [cell, kind] of [...kit.blockingScenery, ...kit.passiveScenery].entries()) {
        expect(pack.staticSceneryFrames[kind], `${kitId}/${kind}`).toMatchObject({
          rect: { x: cell * 32, y: 0 },
        });
        expect(pack.staticSceneryVariants[kind], `${kitId}/${kind} variants`).toHaveLength(32);
        expect(new Set(pack.staticSceneryVariants[kind].map(({ rect }) => `${rect.x},${rect.y}`)).size)
          .toBe(32);
      }
    }
  });

  it("freezes exact compressed and decoded accounting without omissions or double counts", () => {
    const manifest = PRODUCTION_ASSET_MANIFEST;
    expect(manifest.budgets).toMatchObject({
      coreCompressedMax: 786_432,
      regionCompressedMax: 196_608,
      activeCompressedMax: 1_310_720,
      currentUiCompressedBytes: 0,
    });
    const descriptors = Object.values(manifest.atlases);
    expect(new Set(descriptors.map(({ id }) => id)).size).toBe(descriptors.length);
    expect(new Set(descriptors.map(({ url }) => url.href)).size).toBe(descriptors.length);
    for (const atlas of descriptors) {
      expect(atlas.decodedBytes).toBe(atlas.width * atlas.height * 4);
      expect(atlas.compressedBytes).toBeGreaterThan(0);
      expect(atlas.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
    const core = descriptors.filter(({ group }) => group === "core");
    const coreCompressed = core.reduce(
      (sum, atlas) => sum + atlas.compressedBytes,
      manifest.budgets.coreMetadataCompressedBytes,
    );
    const coreDecoded = core.reduce(
      (sum, atlas) => sum + atlas.decodedBytes,
      manifest.budgets.coreMetadataDecodedBytes,
    );
    expect(coreCompressed).toBeLessThanOrEqual(manifest.budgets.coreCompressedMax);
    expect(coreDecoded).toBe(manifest.budgets.exactCoreDecodedBytes);
    for (const kit of REGION_KITS) {
      const pack = manifest.regions[kit];
      expect(pack.compressedBytes).toBeLessThanOrEqual(manifest.budgets.regionCompressedMax);
      expect(coreCompressed + pack.compressedBytes).toBeLessThanOrEqual(
        manifest.budgets.activeCompressedMax,
      );
      expect(pack.atlasIds).toContain(pack.homeManifest.atlasId);
    }
  });

  it("set-compares every descriptor against exact core and region/home pack membership", () => {
    const expectedCore = [
      "core-human-body-rigs",
      "core-human-face-planes",
      "core-human-hair",
      "core-human-held",
      "core-human-status-effects",
      ...Array.from({ length: 8 }, (_unused, index) =>
        `core-human-clothing-${String(index).padStart(2, "0")}`),
      "core-being-chibi",
    ].sort();
    expect(Object.values(PRODUCTION_ASSET_MANIFEST.atlases)
      .filter(({ group }) => group === "core")
      .map(({ id }) => id)
      .sort()).toEqual(expectedCore);

    for (const kit of REGION_KITS) {
      expect([...PRODUCTION_ASSET_MANIFEST.regions[kit].atlasIds].sort()).toEqual([
        `${kit}-terrain`,
        `${kit}-scenery`,
        `${kit}-environment`,
        `${kit}-landmarks`,
        `${kit}-home-components`,
        `${kit}-home-details`,
        `${kit}-home-ruins`,
        `${kit}-home-yards`,
      ].sort());
    }

    rejects((manifest) => {
      manifest.regions["spring-terraces"].atlasIds = manifest.regions["spring-terraces"]
        .atlasIds.filter((id: string) => id !== "spring-terraces-home-details");
    }, /spring-terraces.*home-details.*omitted|exact.*membership/i);

    rejects((manifest) => {
      manifest.regions["spring-terraces"].atlasIds.push("spring-terraces-home-ruins");
    }, /spring-terraces.*duplicate.*home-ruins|atlas.*counted twice/i);

    rejects((manifest) => {
      manifest.regions["spring-terraces"].atlasIds.push("ash-waste-terrain");
    }, /spring-terraces.*ash-waste|foreign.*atlas|region.*ownership/i);

    rejects((manifest) => {
      manifest.atlases["spring-terraces-home-ruins"].group = "region";
    }, /spring-terraces.*home-ruins.*group|misclassified.*home/i);

    rejects((manifest) => {
      delete manifest.atlases["core-human-status-effects"];
    }, /core-human-status-effects.*missing|exact.*core.*membership/i);
  });

  it("recomputes exact pack, core, and peak-active totals from descriptor membership", () => {
    rejects((manifest) => {
      manifest.regions["dry-scrub"].compressedBytes -= 1;
    }, /dry-scrub.*compressed.*recomput|compressed.*total.*mismatch/i);

    rejects((manifest) => {
      manifest.regions["dry-scrub"].decodedBytes -= 4;
    }, /dry-scrub.*decoded.*recomput|decoded.*total.*mismatch/i);

    rejects((manifest) => {
      manifest.atlases["dry-scrub-home-details"].compressedBytes += 1;
    }, /dry-scrub.*compressed.*recomput|compressed.*total.*mismatch/i);

    rejects((manifest) => {
      manifest.budgets.exactCoreDecodedBytes -= 4;
    }, /exact core decoded bytes mismatch/i);

    rejects((manifest) => {
      manifest.budgets.exactPeakActiveDecodedBytes -= 4;
    }, /peak.*active.*decoded.*mismatch|exact.*active.*decoded/i);

    rejects((manifest) => {
      manifest.atlases["ash-waste-home-components"].regionKit = "spring-terraces";
    }, /ash-waste.*home-components.*region|region.*ownership|misclassified/i);
  });

  it("does not expose mutable aliases from the frozen exported manifest", () => {
    expect(Object.isFrozen(PRODUCTION_ASSET_MANIFEST)).toBe(true);
    expect(Object.isFrozen(PRODUCTION_ASSET_MANIFEST.human)).toBe(true);
    expect(Object.isFrozen(PRODUCTION_ASSET_MANIFEST.human.rigs["human-a"])).toBe(true);
    expect(() => {
      (PRODUCTION_ASSET_MANIFEST.human.palettes.skin as unknown as string[]).push("forbidden");
    }).toThrow();
  });

  it("keys worn-heartland's production home art to the owner-approved hut-kit atlases (H2)", () => {
    const HUT_KIT_ATLAS_SHA256 = {
      // home-cleanup item 3: `door-open`'s flat near-black fill recolored to
      // a gradient recess + soft hearth-glow hint (recolor only; alpha mask,
      // dimensions, and every other frame are byte-identical) -- re-baselined
      // sha256 per the ledger's re-baseline convention.
      components: "23687587900535b1c35f0e08d2236842b41f6d5b251be7ff377a41385a6ac673",
      details: "03ac745420bf56b8def05ce9e155f2661961159a7c60812b5d7a9ac0860602f4",
      ruins: "b83a0b2e3b06041e0156729cf76396f8b2fc022917431f06c6cc2cbdf7c99049",
      yards: "df393d6c9cff482786ecbb4d069eec66a14c591310aa416c7f0327a2682cc520",
    } as const;
    for (const [family, sha256] of Object.entries(HUT_KIT_ATLAS_SHA256)) {
      const atlas = PRODUCTION_ASSET_MANIFEST.atlases[`worn-heartland-home-${family}`];
      expect(atlas?.sha256).toBe(sha256);
      expect(atlas?.url.href).toMatch(/\/homes\/hut\//);
    }
    const homeManifest = PRODUCTION_ASSET_MANIFEST.regions["worn-heartland"].homeManifest;
    expect(homeManifest.atlasId).toBe("worn-heartland-home-components");
    expect(homeManifest.frames["hearth-lit-1"]?.atlasId).toBe("worn-heartland-home-components");
    expect(homeManifest.ruinFrames["rubble-full"]?.atlasId).toBe("worn-heartland-home-ruins");
    expect(homeManifest.yard.hoardingFrame.atlasId).toBe("worn-heartland-home-yards");
  });

  it("keys every RegionKitId's production home art to the SAME owner-approved sprite-scale hut (hut-worldwide)", () => {
    // Safi's 2026-07-24 "SAFI RETURNED" directive: ONE hut design world-wide,
    // derived from the sprite-scale reference (hut-sprite-states.png) --
    // supersedes the prior per-kit palette-swap home art. All 5 kits' 4
    // home-atlas roles must share these exact bytes/sha256 (components.png +
    // ruins.png were re-derived; details.png/yards.png carry over byte-
    // identical from H1/H2, untouched here per the mating-box conflict note).
    const HUT_KIT_ATLAS_SHA256 = {
      // home-cleanup item 3: `door-open`'s flat near-black fill recolored to
      // a gradient recess + soft hearth-glow hint (recolor only; alpha mask,
      // dimensions, and every other frame are byte-identical) -- re-baselined
      // sha256 per the ledger's re-baseline convention.
      components: "23687587900535b1c35f0e08d2236842b41f6d5b251be7ff377a41385a6ac673",
      details: "03ac745420bf56b8def05ce9e155f2661961159a7c60812b5d7a9ac0860602f4",
      ruins: "b83a0b2e3b06041e0156729cf76396f8b2fc022917431f06c6cc2cbdf7c99049",
      yards: "df393d6c9cff482786ecbb4d069eec66a14c591310aa416c7f0327a2682cc520",
    } as const;
    const kits = ["worn-heartland", "spring-terraces", "dry-scrub", "ash-waste", "neutral-temperate"] as const;
    for (const kit of kits) {
      for (const [family, sha256] of Object.entries(HUT_KIT_ATLAS_SHA256)) {
        const atlas = PRODUCTION_ASSET_MANIFEST.atlases[`${kit}-home-${family}`];
        expect(atlas?.sha256).toBe(sha256);
      }
      const homeManifest = PRODUCTION_ASSET_MANIFEST.regions[kit].homeManifest;
      expect(homeManifest.atlasId).toBe(`${kit}-home-components`);
      expect(homeManifest.detailAtlasId).toBe(`${kit}-home-details`);
      expect(homeManifest.ruinAtlasId).toBe(`${kit}-home-ruins`);
      expect(homeManifest.yard.warmFrame.atlasId).toBe(`${kit}-home-yards`);
    }
    // Every kit's atlas id still resolves to a UNIQUE URL (validateProductionAssetManifest's
    // duplicate-URL guard) even though the underlying pixel bytes are shared world-wide.
    const hrefs = kits.map((kit) => PRODUCTION_ASSET_MANIFEST.atlases[`${kit}-home-components`]?.url.href);
    expect(new Set(hrefs).size).toBe(kits.length);
  });
});
