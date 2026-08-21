import type { Direction4, Rect, Vec2 } from "../../contracts";
import {
  getBiomeKit,
  type AnimatedEnvironmentKind,
  type RegionKitId,
} from "../maps/biomeKits";
import {
  AUTHORED_LANDMARK_VARIANTS_BY_KIT,
  LANDMARK_ATLAS_PIXEL_SHA256_BY_KIT,
  LANDMARK_KINDS_BY_KIT,
  SCENIC_LANDMARK_KINDS,
  YARD_SEMANTIC_FRAMES,
  type AuthoredLandmarkVariantGeometry,
  type ScenicLandmarkKind,
  type YardSemanticFrame,
} from "../maps/scenicLandmarks";

import coreSource from "../../../assets/renderer2d/core/production-core-source.json";
import ashRegion from "../../../assets/renderer2d/regions/ash-waste/pack.json";
import dryRegion from "../../../assets/renderer2d/regions/dry-scrub/pack.json";
import neutralRegion from "../../../assets/renderer2d/regions/neutral-temperate/pack.json";
import springRegion from "../../../assets/renderer2d/regions/spring-terraces/pack.json";
import wornRegion from "../../../assets/renderer2d/regions/worn-heartland/pack.json";
// hut-worldwide: every RegionKitId's home slot renders Safi's owner-approved,
// sprite-scale-derived hut (frontend/assets/character-claude/roster/hut-kit/,
// re-derived from hut-sprite-states.png; promoted to
// src/assets/renderer2d/homes/hut/ plus one byte-identical copy per other kit
// at src/assets/renderer2d/homes/hut-<kit>/ -- validateProductionAssetManifest
// requires every atlas id to resolve to a UNIQUE URL, so the 4 non-worn-heartland
// kits each get their own physical copy of the same 4 PNGs rather than sharing
// worn-heartland's URLs directly). One hut design world-wide, per Safi's
// 2026-07-24 directive. Each kit's ORIGINAL home atlases remain untouched on
// disk at src/assets/renderer2d/homes/<kit>/ but are no longer imported.
import ashHome from "../../../assets/renderer2d/homes/hut-ash-waste/pack.json";
import dryHome from "../../../assets/renderer2d/homes/hut-dry-scrub/pack.json";
import neutralHome from "../../../assets/renderer2d/homes/hut-neutral-temperate/pack.json";
import springHome from "../../../assets/renderer2d/homes/hut-spring-terraces/pack.json";
import wornHome from "../../../assets/renderer2d/homes/hut/pack.json";

export const PRODUCTION_RIG_IDS = ["human-a", "human-b"] as const;
export const PRODUCTION_FACINGS = ["south", "east", "north", "west"] as const;
export const HUMAN_BODY_ACTIONS = [
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
] as const;
export const HUMAN_EXPRESSIONS = [
  "neutral",
  "blink-1",
  "blink-2",
  "talk-1",
  "talk-2",
  "weary",
  "hurt",
  "recovery",
] as const;

export type ProductionRigId = (typeof PRODUCTION_RIG_IDS)[number];
export type ProductionFacing = (typeof PRODUCTION_FACINGS)[number];
export type HumanBodyAction = (typeof HUMAN_BODY_ACTIONS)[number];
export type HumanExpression = (typeof HUMAN_EXPRESSIONS)[number];
export type HumanLayerId = "body" | "face" | "hair" | "clothing" | "held" | "status";
export type HumanStatusFrameId = "selected" | "paralyzed" | "dead";
export type TerrainRole = "ground" | "path" | "water" | "shore" | "soil";
export type ProductionMarkerName =
  | "foot-contact"
  | "facing-switch"
  | "hand-contact"
  | "work-contact"
  | "fall-contact"
  | "settled";

export interface ProductionAssetLease<T = ImageBitmap> {
  readonly value: T;
  release(): void;
}

export interface NativeFrameRef {
  readonly atlasId: string;
  readonly rect: Readonly<{ x: number; y: number; width: number; height: number }>;
  readonly durationMs: number;
  readonly feet: Vec2;
  readonly faceAnchor: Vec2;
  readonly heldAnchor: Vec2;
}

export interface ProductionClip {
  readonly id: string;
  readonly rig: ProductionRigId;
  readonly action: HumanBodyAction;
  readonly facing: ProductionFacing;
  readonly direction: Direction4 | "none";
  facingPolicy: "explicit" | "preserve";
  fallbackFacing?: ProductionFacing;
  readonly frames: readonly NativeFrameRef[];
  readonly loop: boolean;
  readonly strideLength: number | null;
  readonly markers: readonly Readonly<{ frame: number; name: ProductionMarkerName }>[];
  readonly cancelFrames: readonly number[];
  readonly layerFacingSwitchFrames: Record<HumanLayerId, number>;
}

export interface DirectionalFacePlane {
  readonly rig: ProductionRigId;
  readonly facing: ProductionFacing;
  readonly expression: HumanExpression;
  readonly frame: NativeFrameRef;
  readonly maskPixels: number;
  readonly coveredMaskPixels: number;
  readonly leakedPixels: number;
  readonly semanticPixelsSha256: string;
  readonly measuredFromSha256: string;
  readonly semanticFeaturePixels: Readonly<{
    eyes: 0 | 1 | 2;
    noseDirection: "north-hidden" | "east" | "south" | "west";
    mouthPixels: number;
  }>;
}

export interface ProductionAtlasDescriptor {
  readonly id: string;
  readonly url: Readonly<{ href: string }>;
  readonly group: "core" | "region" | "home";
  readonly regionKit: RegionKitId | null;
  readonly width: number;
  readonly height: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly columns: number;
  readonly rows: number;
  readonly compressedBytes: number;
  readonly decodedBytes: number;
  readonly sha256: string;
}

interface SilhouetteFallback {
  readonly rig: ProductionRigId;
  readonly facing: ProductionFacing;
  readonly frameId: string;
  readonly frame: NativeFrameRef;
}

interface HumanRigManifest {
  readonly bodyClips: Readonly<Record<string, ProductionClip>>;
  readonly facePlanes: Readonly<Record<ProductionFacing, Readonly<Record<HumanExpression, DirectionalFacePlane>>>>;
  readonly bodyFacePlanes: Readonly<Record<ProductionFacing, Readonly<{
    planePixels: number;
    facialFeaturePixels: number;
  }>>>;
  readonly silhouetteFallbacks: Readonly<Record<ProductionFacing, SilhouetteFallback>>;
}

export interface HumanAssetManifest {
  readonly rigs: Readonly<Record<ProductionRigId, HumanRigManifest>>;
  readonly layerAtlases: Readonly<Record<Exclude<HumanLayerId, "clothing">, string>>;
  readonly clothingAtlasBySilhouette: Readonly<Record<string, string>>;
  readonly heldForms: readonly string[];
  readonly heldFrames: Readonly<Record<string, Readonly<Record<ProductionFacing, NativeFrameRef>>>>;
  readonly statusFrames: Readonly<Record<HumanStatusFrameId, NativeFrameRef>>;
  readonly palettes: Readonly<{
    skin: readonly string[];
    hair: readonly string[];
    clothing: readonly string[];
  }>;
  readonly hairSilhouettes: readonly string[];
  readonly clothingSilhouettes: readonly string[];
}

export interface HomeComponentManifest {
  readonly atlasId: string;
  readonly detailAtlasId: string;
  readonly ruinAtlasId: string;
  readonly kit: RegionKitId;
  readonly logicalBounds: Readonly<{ width: number; height: number }>;
  readonly doorClearance: Rect;
  readonly backComponents: readonly string[];
  readonly frontComponents: readonly string[];
  readonly frames: Readonly<Record<string, NativeFrameRef>>;
  readonly detailFrames: Readonly<Record<string, NativeFrameRef>>;
  readonly ruinFrames: Readonly<Record<string, NativeFrameRef>>;
  readonly yard: HomeYardManifest;
}

export interface HomeYardManifest {
  readonly atlasId: string;
  readonly renderSizePx: Readonly<{ width: 192; height: 160 }>;
  readonly plotOffsetPx: Readonly<{ x: -32; y: -16 }>;
  readonly contactPivotPx: Readonly<{ x: 96; y: 112 }>;
  readonly southPort: Readonly<{ startPx: 80; widthPx: 32 }>;
  readonly standingVariants: readonly NativeFrameRef[];
  readonly warmFrame: NativeFrameRef;
  readonly hoardingFrame: NativeFrameRef;
  readonly ruinFrame: NativeFrameRef;
  readonly geometryHashes: Readonly<Record<YardSemanticFrame, string>>;
}

export type LandmarkAssetVariant = NativeFrameRef & AuthoredLandmarkVariantGeometry & Readonly<{
  atlasPixelSha256: string;
}>;

export interface LandmarkAssetBinding {
  readonly kind: ScenicLandmarkKind;
  readonly variants: readonly LandmarkAssetVariant[];
  readonly renderSizePx: Readonly<{ width: 128; height: 128 }>;
  readonly drawLayer: "static-back";
}

export interface RegionAssetPackManifest {
  readonly kit: RegionKitId;
  readonly atlasIds: readonly string[];
  readonly terrainFramesByRole: Readonly<Record<TerrainRole, readonly Readonly<{
    cell: number;
    frame: NativeFrameRef;
  }>[]>>;
  readonly staticSceneryFrames: Readonly<Record<string, NativeFrameRef>>;
  readonly staticSceneryVariants: Readonly<Record<string, readonly NativeFrameRef[]>>;
  readonly animatedFrames: Readonly<Record<AnimatedEnvironmentKind, NativeFrameRef>>;
  readonly landmarkFrames: Readonly<Partial<Record<ScenicLandmarkKind, LandmarkAssetBinding>>>;
  readonly homeManifest: HomeComponentManifest;
  readonly compressedBytes: number;
  readonly decodedBytes: number;
}

export interface ProductionAssetManifest {
  readonly version: 1;
  readonly atlases: Readonly<Record<string, ProductionAtlasDescriptor>>;
  readonly human: HumanAssetManifest;
  readonly regions: Readonly<Record<RegionKitId, RegionAssetPackManifest>>;
  readonly budgets: Readonly<{
    coreCompressedMax: 786_432;
    regionCompressedMax: 196_608;
    activeCompressedMax: 1_310_720;
    currentUiCompressedBytes: number;
    currentUiDecodedBytes: number;
    coreMetadataCompressedBytes: number;
    coreMetadataDecodedBytes: number;
    coreCompressedBytes: number;
    exactCoreDecodedBytes: number;
    regionMetadataCompressedBytes: Readonly<Record<RegionKitId, number>>;
    regionMetadataDecodedBytes: Readonly<Record<RegionKitId, number>>;
    regionCompressedBytes: Readonly<Record<RegionKitId, number>>;
    activeCompressedBytes: Readonly<Record<RegionKitId, number>>;
    exactPeakActiveDecodedBytes: Readonly<Record<RegionKitId, number>>;
  }>;
}

type PackedAtlasData = {
  readonly id: string;
  readonly path: string;
  readonly group: string;
  readonly regionKit: string | null;
  readonly width: number;
  readonly height: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly columns: number;
  readonly rows: number;
  readonly compressedBytes: number;
  readonly decodedBytes: number;
  readonly sha256: string;
};

const ATLAS_URLS: Readonly<Record<string, URL>> = {
  "core-human-body-rigs": new URL("../../../assets/renderer2d/core/human-body-rigs.png", import.meta.url),
  "core-human-face-planes": new URL("../../../assets/renderer2d/core/human-face-planes.png", import.meta.url),
  "core-human-hair": new URL("../../../assets/renderer2d/core/human-hair.png", import.meta.url),
  "core-human-held": new URL("../../../assets/renderer2d/core/human-held.png", import.meta.url),
  "core-human-status-effects": new URL("../../../assets/renderer2d/core/human-status-effects.png", import.meta.url),
  "core-human-clothing-00": new URL("../../../assets/renderer2d/core/human-clothing-00.png", import.meta.url),
  "core-human-clothing-01": new URL("../../../assets/renderer2d/core/human-clothing-01.png", import.meta.url),
  "core-human-clothing-02": new URL("../../../assets/renderer2d/core/human-clothing-02.png", import.meta.url),
  "core-human-clothing-03": new URL("../../../assets/renderer2d/core/human-clothing-03.png", import.meta.url),
  "core-human-clothing-04": new URL("../../../assets/renderer2d/core/human-clothing-04.png", import.meta.url),
  "core-human-clothing-05": new URL("../../../assets/renderer2d/core/human-clothing-05.png", import.meta.url),
  "core-human-clothing-06": new URL("../../../assets/renderer2d/core/human-clothing-06.png", import.meta.url),
  "core-human-clothing-07": new URL("../../../assets/renderer2d/core/human-clothing-07.png", import.meta.url),
  "core-being-chibi": new URL("../../../assets/renderer2d/core/being-chibi.png", import.meta.url),
  "worn-heartland-terrain": new URL("../../../assets/renderer2d/regions/worn-heartland/terrain.png", import.meta.url),
  "worn-heartland-scenery": new URL("../../../assets/renderer2d/regions/worn-heartland/scenery.png", import.meta.url),
  "worn-heartland-environment": new URL("../../../assets/renderer2d/regions/worn-heartland/environment.png", import.meta.url),
  "worn-heartland-landmarks": new URL("../../../assets/renderer2d/regions/worn-heartland/landmarks.png", import.meta.url),
  "worn-heartland-home-components": new URL("../../../assets/renderer2d/homes/hut/components.png", import.meta.url),
  "worn-heartland-home-details": new URL("../../../assets/renderer2d/homes/hut/details.png", import.meta.url),
  "worn-heartland-home-ruins": new URL("../../../assets/renderer2d/homes/hut/ruins.png", import.meta.url),
  "worn-heartland-home-yards": new URL("../../../assets/renderer2d/homes/hut/yards.png", import.meta.url),
  "spring-terraces-terrain": new URL("../../../assets/renderer2d/regions/spring-terraces/terrain.png", import.meta.url),
  "spring-terraces-scenery": new URL("../../../assets/renderer2d/regions/spring-terraces/scenery.png", import.meta.url),
  "spring-terraces-environment": new URL("../../../assets/renderer2d/regions/spring-terraces/environment.png", import.meta.url),
  "spring-terraces-landmarks": new URL("../../../assets/renderer2d/regions/spring-terraces/landmarks.png", import.meta.url),
  "spring-terraces-home-components": new URL("../../../assets/renderer2d/homes/hut-spring-terraces/components.png", import.meta.url),
  "spring-terraces-home-details": new URL("../../../assets/renderer2d/homes/hut-spring-terraces/details.png", import.meta.url),
  "spring-terraces-home-ruins": new URL("../../../assets/renderer2d/homes/hut-spring-terraces/ruins.png", import.meta.url),
  "spring-terraces-home-yards": new URL("../../../assets/renderer2d/homes/hut-spring-terraces/yards.png", import.meta.url),
  "dry-scrub-terrain": new URL("../../../assets/renderer2d/regions/dry-scrub/terrain.png", import.meta.url),
  "dry-scrub-scenery": new URL("../../../assets/renderer2d/regions/dry-scrub/scenery.png", import.meta.url),
  "dry-scrub-environment": new URL("../../../assets/renderer2d/regions/dry-scrub/environment.png", import.meta.url),
  "dry-scrub-landmarks": new URL("../../../assets/renderer2d/regions/dry-scrub/landmarks.png", import.meta.url),
  "dry-scrub-home-components": new URL("../../../assets/renderer2d/homes/hut-dry-scrub/components.png", import.meta.url),
  "dry-scrub-home-details": new URL("../../../assets/renderer2d/homes/hut-dry-scrub/details.png", import.meta.url),
  "dry-scrub-home-ruins": new URL("../../../assets/renderer2d/homes/hut-dry-scrub/ruins.png", import.meta.url),
  "dry-scrub-home-yards": new URL("../../../assets/renderer2d/homes/hut-dry-scrub/yards.png", import.meta.url),
  "ash-waste-terrain": new URL("../../../assets/renderer2d/regions/ash-waste/terrain.png", import.meta.url),
  "ash-waste-scenery": new URL("../../../assets/renderer2d/regions/ash-waste/scenery.png", import.meta.url),
  "ash-waste-environment": new URL("../../../assets/renderer2d/regions/ash-waste/environment.png", import.meta.url),
  "ash-waste-landmarks": new URL("../../../assets/renderer2d/regions/ash-waste/landmarks.png", import.meta.url),
  "ash-waste-home-components": new URL("../../../assets/renderer2d/homes/hut-ash-waste/components.png", import.meta.url),
  "ash-waste-home-details": new URL("../../../assets/renderer2d/homes/hut-ash-waste/details.png", import.meta.url),
  "ash-waste-home-ruins": new URL("../../../assets/renderer2d/homes/hut-ash-waste/ruins.png", import.meta.url),
  "ash-waste-home-yards": new URL("../../../assets/renderer2d/homes/hut-ash-waste/yards.png", import.meta.url),
  "neutral-temperate-terrain": new URL("../../../assets/renderer2d/regions/neutral-temperate/terrain.png", import.meta.url),
  "neutral-temperate-scenery": new URL("../../../assets/renderer2d/regions/neutral-temperate/scenery.png", import.meta.url),
  "neutral-temperate-environment": new URL("../../../assets/renderer2d/regions/neutral-temperate/environment.png", import.meta.url),
  "neutral-temperate-landmarks": new URL("../../../assets/renderer2d/regions/neutral-temperate/landmarks.png", import.meta.url),
  "neutral-temperate-home-components": new URL("../../../assets/renderer2d/homes/hut-neutral-temperate/components.png", import.meta.url),
  "neutral-temperate-home-details": new URL("../../../assets/renderer2d/homes/hut-neutral-temperate/details.png", import.meta.url),
  "neutral-temperate-home-ruins": new URL("../../../assets/renderer2d/homes/hut-neutral-temperate/ruins.png", import.meta.url),
  "neutral-temperate-home-yards": new URL("../../../assets/renderer2d/homes/hut-neutral-temperate/yards.png", import.meta.url),
};

const REGION_DATA = {
  "worn-heartland": { region: wornRegion, home: wornHome },
  "spring-terraces": { region: springRegion, home: springHome },
  "dry-scrub": { region: dryRegion, home: dryHome },
  "ash-waste": { region: ashRegion, home: ashHome },
  "neutral-temperate": { region: neutralRegion, home: neutralHome },
} as const;

function serializedJsonBytes(value: unknown): number {
  return new TextEncoder().encode(`${JSON.stringify(value)}\n`).byteLength;
}

const ACTION_FRAME_COUNTS: Readonly<Record<HumanBodyAction, number>> = {
  idle: 4,
  walk: 6,
  run: 8,
  turn: 2,
  stop: 2,
  "reach-give": 6,
  work: 6,
  "hurt-fall": 6,
  prone: 2,
  dead: 1,
};
const DIRECTIONLESS_ACTIONS = new Set<HumanBodyAction>(["reach-give", "work", "hurt-fall", "prone", "dead"]);
const HAIR_SILHOUETTES = ["crop", "messy", "waves", "bob", "braid", "bun", "coils", "short-curls"] as const;
const CLOTHING_SILHOUETTES = [
  "work-shirt-sash",
  "short-jacket",
  "field-vest",
  "apron-wrap",
  "scarf-overshirt",
  "rolled-tunic",
  "utility-smock",
  "travel-shirt",
] as const;
const PRODUCTION_REGION_KIT_IDS = [
  "worn-heartland",
  "spring-terraces",
  "dry-scrub",
  "ash-waste",
  "neutral-temperate",
] as const satisfies readonly RegionKitId[];
const CORE_ATLAS_IDS = [
  "core-human-body-rigs",
  "core-human-face-planes",
  "core-human-hair",
  "core-human-held",
  "core-human-status-effects",
  ...Array.from({ length: 8 }, (_unused, index) =>
    `core-human-clothing-${String(index).padStart(2, "0")}`),
  "core-being-chibi",
] as const;
const HOME_COMPONENT_IDS = [
  "foundation", "post", "wall-intact", "wall-cracked", "wall-broken", "wall-falling",
  "roof-intact", "roof-damaged", "roof-falling", "door-closed", "door-opening-1",
  "door-opening-2", "door-opening-3", "door-open", "door-breached", "door-falling",
  "window-cold", "window-lit", "window-broken", "hearth-cold", "hearth-lit-1",
  "hearth-lit-2", "chimney", "dust",
] as const;
const HOME_RUIN_IDS = [
  "rubble-full", "rubble-full-scavenge", "rubble-picked", "rubble-picked-scavenge",
  "rubble-bare", "rubble-bare-scavenge", "collapse-debris", "snapshot-sweep-dissolve",
] as const;
const HOME_BACK_COMPONENT_IDS = [
  "foundation", "post", "wall-intact", "wall-cracked", "wall-broken", "wall-falling",
  "window-cold", "window-lit", "window-broken", "hearth-cold", "hearth-lit-1",
  "hearth-lit-2", "chimney",
] as const;
const HOME_FRONT_COMPONENT_IDS = [
  "roof-intact", "roof-damaged", "roof-falling", "door-closed", "door-opening-1",
  "door-opening-2", "door-opening-3", "door-open", "door-breached", "door-falling", "dust",
] as const;

function descriptor(data: PackedAtlasData): ProductionAtlasDescriptor {
  const url = ATLAS_URLS[data.id];
  if (!url) throw new Error(`Production atlas ${data.id} has no statically analyzable URL.`);
  return {
    id: data.id,
    url: { href: url.href },
    group: data.group as ProductionAtlasDescriptor["group"],
    regionKit: data.regionKit as RegionKitId | null,
    width: data.width,
    height: data.height,
    cellWidth: data.cellWidth,
    cellHeight: data.cellHeight,
    columns: data.columns,
    rows: data.rows,
    compressedBytes: data.compressedBytes,
    decodedBytes: data.decodedBytes,
    sha256: data.sha256,
  };
}

type BodyFrameAnchorTuple = readonly [
  feetX: number,
  feetY: number,
  faceX: number,
  faceY: number,
  heldX: number,
  heldY: number,
];

type BodyFacePlaneMetricTuple = readonly [planePixels: number, facialFeaturePixels: number];
type FacePlaneMetricTuple = readonly [
  maskPixels: number,
  coveredMaskPixels: number,
  leakedPixels: number,
  eyeComponents: number,
  noseDirection: number,
  mouthPixels: number,
  semanticPixelsSha256: string,
  measuredFromSha256: string,
];
const FACE_NOSE_DIRECTIONS = ["north-hidden", "east", "south", "west"] as const;
export const PRODUCTION_DIRECTIONAL_FACE_ANCHORS: Readonly<Record<ProductionFacing, Vec2>> = Object.freeze({
  south: Object.freeze({ x: 24, y: 18 }),
  east: Object.freeze({ x: 26, y: 19 }),
  north: Object.freeze({ x: 24, y: 18 }),
  west: Object.freeze({ x: 22, y: 18 }),
});

/** Validate and detach compact runtime body anchors at the generated-JSON boundary. */
export function parseBodyFrameAnchors(value: unknown): readonly BodyFrameAnchorTuple[] {
  if (!Array.isArray(value) || value.length !== 344) {
    throw new TypeError("Body frame anchor metadata requires exactly 344 tuples.");
  }
  return Object.freeze(value.map((candidate, index) => {
    if (!Array.isArray(candidate) || candidate.length !== 6) {
      throw new TypeError(`Body frame anchor ${index} requires a six-value tuple.`);
    }
    if (!candidate.every(Number.isInteger)) {
      throw new TypeError(`Body frame anchor ${index} values must be integers.`);
    }
    return Object.freeze([...candidate]) as unknown as BodyFrameAnchorTuple;
  }));
}

/** Validate compact byte-derived body face-plane metrics at the generated-JSON boundary. */
export function parseBodyFacePlaneMetrics(value: unknown): readonly BodyFacePlaneMetricTuple[] {
  if (!Array.isArray(value) || value.length !== PRODUCTION_RIG_IDS.length * PRODUCTION_FACINGS.length) {
    throw new TypeError("Body face-plane metadata requires exactly eight tuples.");
  }
  return Object.freeze(value.map((candidate, index) => {
    if (!Array.isArray(candidate) || candidate.length !== 2
      || !candidate.every((metric) => Number.isInteger(metric) && metric >= 0)) {
      throw new TypeError(`Body face-plane metric ${index} requires two nonnegative integer values.`);
    }
    if (candidate[0] <= 0) {
      throw new TypeError(`Body face-plane metric ${index} requires a positive plane pixel count.`);
    }
    if (candidate[1] !== 0) {
      throw new TypeError(`Body face-plane metric ${index} facial-feature pixels must be zero.`);
    }
    return Object.freeze([...candidate]) as unknown as BodyFacePlaneMetricTuple;
  }));
}

/**
 * Validate compact byte-derived directional face metrics at the generated-JSON boundary.
 *
 * The packer derives semanticPixelsSha256 from decoded image bytes. This browser-side
 * boundary has no decoded atlas bytes, so it validates the hash shape and binds every
 * tuple's measuredFromSha256 to the packed face-atlas source hash.
 */
export function parseFacePlaneMetrics(
  value: unknown,
  expectedMeasuredFromSha256: string,
): readonly FacePlaneMetricTuple[] {
  const expected = PRODUCTION_RIG_IDS.length * PRODUCTION_FACINGS.length * HUMAN_EXPRESSIONS.length;
  if (!/^[a-f0-9]{64}$/.test(expectedMeasuredFromSha256)) {
    throw new TypeError("Face-plane metadata requires the measured face atlas SHA-256.");
  }
  if (!Array.isArray(value) || value.length !== expected) {
    throw new TypeError(`Face-plane metadata requires exactly ${expected} tuples.`);
  }
  return Object.freeze(value.map((candidate, index) => {
    if (!Array.isArray(candidate) || candidate.length !== 8) {
      throw new TypeError(`Face-plane metric ${index} requires an eight-value tuple.`);
    }
    if (!candidate.slice(0, 6).every((metric) => Number.isInteger(metric) && metric >= 0)
      || candidate[3] > 2
      || candidate[4] >= FACE_NOSE_DIRECTIONS.length) {
      throw new TypeError(`Face-plane metric ${index} requires legal nonnegative counts, eye components, and direction.`);
    }
    if (![candidate[6], candidate[7]].every((hash) => (
      typeof hash === "string" && /^[a-f0-9]{64}$/.test(hash)
    ))) {
      throw new TypeError(`Face-plane metric ${index} requires two SHA-256 hashes.`);
    }
    const facingIndex = Math.floor(
      index / (PRODUCTION_RIG_IDS.length * HUMAN_EXPRESSIONS.length),
    );
    const facing = PRODUCTION_FACINGS[facingIndex]!;
    const [maskPixels, coveredMaskPixels, leakedPixels, eyes, noseDirection, mouthPixels]
      = candidate as unknown as readonly number[];
    if (maskPixels! <= 0) {
      throw new TypeError(`Face-plane metric ${index} mask pixel count must be positive.`);
    }
    if (coveredMaskPixels !== maskPixels) {
      throw new TypeError(`Face-plane metric ${index} covered pixels must equal its mask.`);
    }
    if (leakedPixels !== 0) {
      throw new TypeError(`Face-plane metric ${index} leaked pixels must be zero.`);
    }
    const expectedFeatures = {
      south: { eyes: 2, nose: 2, mouthVisible: true },
      east: { eyes: 1, nose: 1, mouthVisible: true },
      north: { eyes: 0, nose: 0, mouthVisible: false },
      west: { eyes: 1, nose: 3, mouthVisible: true },
    }[facing];
    if (eyes !== expectedFeatures.eyes) {
      const eyeCount = expectedFeatures.eyes === 0
        ? "zero eyes"
        : expectedFeatures.eyes === 1
          ? "one eye"
          : "two eyes";
      throw new TypeError(`Face-plane metric ${index} ${facing} requires exactly ${eyeCount}.`);
    }
    if (noseDirection !== expectedFeatures.nose) {
      throw new TypeError(`Face-plane metric ${index} ${facing} nose direction is invalid.`);
    }
    if ((expectedFeatures.mouthVisible && mouthPixels! <= 0)
      || (!expectedFeatures.mouthVisible && mouthPixels !== 0)) {
      throw new TypeError(`Face-plane metric ${index} ${facing} mouth visibility is invalid.`);
    }
    if (candidate[7] !== expectedMeasuredFromSha256) {
      throw new TypeError(`Face-plane metric ${index} measured face atlas SHA does not match.`);
    }
    return Object.freeze([...candidate]) as unknown as FacePlaneMetricTuple;
  }));
}

const BODY_FRAME_ANCHORS = parseBodyFrameAnchors(coreSource.bodyFrameAnchors);
const BODY_FACE_PLANE_METRICS = parseBodyFacePlaneMetrics(coreSource.bodyFacePlaneMetrics);
const FACE_ATLAS_SOURCE_SHA256 = (coreSource.atlases as readonly PackedAtlasData[])
  .find(({ id }) => id === "core-human-face-planes")?.sha256;
if (!FACE_ATLAS_SOURCE_SHA256) throw new Error("Packed core metadata is missing the face atlas SHA-256.");
const FACE_PLANE_METRICS = parseFacePlaneMetrics(
  coreSource.facePlaneMetrics,
  FACE_ATLAS_SOURCE_SHA256,
);

function frame(
  atlasId: string,
  index: number,
  columns: number,
  cellWidth: number,
  cellHeight: number,
  durationMs = 160,
  anchors?: BodyFrameAnchorTuple,
  overlayFaceAnchor?: Vec2,
): NativeFrameRef {
  const [feetX, feetY, faceX, faceY, heldX, heldY] = anchors ?? [
    cellWidth === 48 ? 24 : Math.floor(cellWidth / 2),
    cellHeight === 64 ? 61 : cellHeight - 1,
    cellWidth === 48 ? 24 : Math.floor(cellWidth / 2),
    cellHeight === 64 ? 18 : Math.floor(cellHeight / 2),
    cellWidth === 48 ? 34 : Math.floor(cellWidth / 2),
    cellHeight === 64 ? 38 : Math.floor(cellHeight / 2),
  ];
  return {
    atlasId,
    rect: {
      x: (index % columns) * cellWidth,
      y: Math.floor(index / columns) * cellHeight,
      width: cellWidth,
      height: cellHeight,
    },
    durationMs,
    feet: { x: feetX, y: feetY },
    faceAnchor: overlayFaceAnchor
      ? { x: overlayFaceAnchor.x, y: overlayFaceAnchor.y }
      : { x: faceX, y: faceY },
    heldAnchor: { x: heldX, y: heldY },
  };
}

function actionOffset(action: HumanBodyAction): number {
  let offset = 0;
  for (const candidate of HUMAN_BODY_ACTIONS) {
    if (candidate === action) return offset;
    offset += ACTION_FRAME_COUNTS[candidate];
  }
  throw new Error(`Unknown body action ${action}`);
}

function markersFor(action: HumanBodyAction, count: number): ProductionClip["markers"] {
  if (action === "turn") return [{ frame: 1, name: "facing-switch" }];
  if (action === "walk" || action === "run") return [{ frame: Math.min(1, count - 1), name: "foot-contact" }];
  if (action === "reach-give") return [{ frame: 3, name: "hand-contact" }];
  if (action === "work") return [{ frame: 3, name: "work-contact" }];
  if (action === "hurt-fall") return [{ frame: 4, name: "fall-contact" }];
  if (action === "stop") return [{ frame: count - 1, name: "settled" }];
  return [];
}

function clip(rig: ProductionRigId, action: HumanBodyAction, facing: ProductionFacing): ProductionClip {
  const count = ACTION_FRAME_COUNTS[action];
  const rigOffset = PRODUCTION_RIG_IDS.indexOf(rig) * 172;
  const directionOffset = PRODUCTION_FACINGS.indexOf(facing) * 43;
  const start = rigOffset + directionOffset + actionOffset(action);
  const switchFrame = action === "turn" ? 1 : 0;
  return {
    id: `${rig}:${action}:${facing}`,
    rig,
    action,
    facing,
    direction: DIRECTIONLESS_ACTIONS.has(action) ? "none" : facing,
    facingPolicy: DIRECTIONLESS_ACTIONS.has(action) ? "preserve" : "explicit",
    frames: Array.from({ length: count }, (_unused, index) => {
      const cell = start + index;
      const anchors = BODY_FRAME_ANCHORS[cell];
      if (!anchors) throw new Error(`Missing measured body anchors for cell ${cell}.`);
      return frame(
        "core-human-body-rigs",
        cell,
        16,
        48,
        64,
        action === "idle" ? 240 : 120,
        anchors,
      );
    }),
    loop: action === "idle" || action === "walk" || action === "run" || action === "prone",
    strideLength: action === "walk" ? 12 : action === "run" ? 18 : null,
    markers: markersFor(action, count),
    cancelFrames: Array.from({ length: count }, (_unused, index) => index),
    layerFacingSwitchFrames: {
      body: switchFrame,
      face: switchFrame,
      hair: switchFrame,
      clothing: switchFrame,
      held: switchFrame,
      status: switchFrame,
    },
  };
}

function rigManifest(rig: ProductionRigId): HumanRigManifest {
  const rigIndex = PRODUCTION_RIG_IDS.indexOf(rig);
  const clips = Object.fromEntries(HUMAN_BODY_ACTIONS.flatMap((action) => PRODUCTION_FACINGS.map((facing) => [
    `${action}:${facing}`,
    clip(rig, action, facing),
  ]))) as Record<string, ProductionClip>;
  const bodyFacePlanes = Object.fromEntries(PRODUCTION_FACINGS.map((facing, facingIndex) => {
    const [planePixels, facialFeaturePixels] = BODY_FACE_PLANE_METRICS[
      rigIndex * PRODUCTION_FACINGS.length + facingIndex
    ]!;
    return [facing, { planePixels, facialFeaturePixels }];
  })) as HumanRigManifest["bodyFacePlanes"];
  const facePlanes = Object.fromEntries(PRODUCTION_FACINGS.map((facing, facingIndex) => [
    facing,
    Object.fromEntries(HUMAN_EXPRESSIONS.map((expression, expressionIndex) => {
      const metricIndex = facingIndex * PRODUCTION_RIG_IDS.length * HUMAN_EXPRESSIONS.length
        + rigIndex * HUMAN_EXPRESSIONS.length + expressionIndex;
      const [maskPixels, coveredMaskPixels, leakedPixels, eyes, noseDirectionIndex,
        mouthPixels, semanticPixelsSha256, measuredFromSha256] = FACE_PLANE_METRICS[metricIndex]!;
      const plane: DirectionalFacePlane = {
        rig,
        facing,
        expression,
        frame: frame(
          "core-human-face-planes",
          facingIndex * 16 + rigIndex * 8 + expressionIndex,
          16,
          48,
          64,
          180,
          undefined,
          PRODUCTION_DIRECTIONAL_FACE_ANCHORS[facing],
        ),
        maskPixels,
        coveredMaskPixels,
        leakedPixels,
        semanticPixelsSha256,
        measuredFromSha256,
        semanticFeaturePixels: {
          eyes: eyes as 0 | 1 | 2,
          noseDirection: FACE_NOSE_DIRECTIONS[noseDirectionIndex]!,
          mouthPixels,
        },
      };
      return [expression, plane];
    })),
  ])) as HumanRigManifest["facePlanes"];
  const silhouetteFallbacks = Object.fromEntries(PRODUCTION_FACINGS.map((facing) => {
    const idle = clips[`idle:${facing}`]!;
    return [facing, { rig, facing, frameId: `${rig}:silhouette:${facing}`, frame: idle.frames[0]! }];
  })) as HumanRigManifest["silhouetteFallbacks"];
  return { bodyClips: clips, facePlanes, bodyFacePlanes, silhouetteFallbacks };
}

function homeManifest(kit: RegionKitId, homeData: typeof wornHome): HomeComponentManifest {
  const packed = homeData as unknown as {
    atlases: readonly PackedAtlasData[];
    yardGeometry?: unknown;
    yardVariants?: unknown;
  };
  const componentAtlas = packed.atlases.find(({ id }) => id.endsWith("home-components"));
  const detailAtlas = packed.atlases.find(({ id }) => id.endsWith("home-details"));
  const ruinAtlas = packed.atlases.find(({ id }) => id.endsWith("home-ruins"));
  const yardAtlas = packed.atlases.find(({ id }) => id.endsWith("home-yards"));
  if (!componentAtlas || !detailAtlas || !ruinAtlas || !yardAtlas) throw new Error(`${kit} home atlas inventory is incomplete.`);
  return {
    atlasId: componentAtlas.id,
    detailAtlasId: detailAtlas.id,
    ruinAtlasId: ruinAtlas.id,
    kit,
    logicalBounds: { width: 112, height: 104 },
    doorClearance: { x: 49, y: 57, width: 30, height: 48 },
    backComponents: HOME_BACK_COMPONENT_IDS,
    frontComponents: HOME_FRONT_COMPONENT_IDS,
    frames: Object.fromEntries(HOME_COMPONENT_IDS.map((id, index) => [id, frame(componentAtlas.id, index, 6, 128, 128)])),
    detailFrames: Object.fromEntries(Array.from({ length: 32 }, (_unused, index) => [`home-detail-${index}`, frame(detailAtlas.id, index, 8, 32, 32)])),
    ruinFrames: Object.fromEntries(HOME_RUIN_IDS.map((id, index) => [id, frame(ruinAtlas.id, index, 4, 128, 128)])),
    yard: parseHomeYard(kit, yardAtlas.id, packed.yardGeometry, packed.yardVariants),
  };
}

/** Parse and validate the exact scenery variant arrays published by one runtime region pack. */
export function parsePublishedSceneryVariants(
  kit: RegionKitId,
  primaryCells: Readonly<Record<string, number>>,
  value: unknown,
): Readonly<Record<string, readonly number[]>> {
  if (value === 4) {
    return Object.freeze(Object.fromEntries(Object.entries(primaryCells).map(([kind, primary]) => [
      kind,
      Object.freeze(Array.from({ length: 32 }, (_unused, variant) => primary + variant * 4)),
    ])));
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${kit} scenery variants must be a published kind record`);
  }
  const record = value as Readonly<Record<string, unknown>>;
  const kinds = Object.keys(primaryCells);
  const publishedKinds = Object.keys(record);
  if (publishedKinds.length !== kinds.length || publishedKinds.some((kind) => !kinds.includes(kind))) {
    throw new Error(`${kit} scenery variant kind ownership must exactly match semantic scenery cells`);
  }
  return Object.freeze(Object.fromEntries(kinds.map((kind) => {
    const primary = primaryCells[kind];
    const cells = record[kind];
    if (!Number.isInteger(primary) || !Array.isArray(cells) || cells.length !== 32) {
      throw new Error(`${kit} scenery variant ${kind} must publish exactly 32 cells`);
    }
    if (cells.some((cell) => !Number.isInteger(cell) || (cell as number) < 0 || (cell as number) >= 128)) {
      throw new Error(`${kit} scenery variant ${kind} contains an out-of-range cell`);
    }
    if (new Set(cells).size !== cells.length) {
      throw new Error(`${kit} scenery variant ${kind} contains a duplicate cell`);
    }
    if (cells.some((cell, variant) => cell !== primary + variant * 4)) {
      throw new Error(`${kit} scenery variant ${kind} order drifted from its native contract`);
    }
    return [kind, Object.freeze([...cells] as number[])];
  })));
}

type CompactLandmarkVariant = readonly [
  kindIndex: number,
  cellIndex: number,
  pivotX: number,
  pivotY: number,
  geometryHash: string,
];

type CompactYardVariant = readonly [cellIndex: number, geometryHash: string];

function parseLandmarkBindings(
  kit: RegionKitId,
  atlasId: string,
  value: unknown,
): Readonly<Partial<Record<ScenicLandmarkKind, LandmarkAssetBinding>>> {
  if (!Array.isArray(value) || value.length !== 8) {
    throw new Error(`${kit} landmark metadata must publish exactly eight variants`);
  }
  const tuples = value as readonly CompactLandmarkVariant[];
  const cells = new Set<number>();
  const bindings = new Map<ScenicLandmarkKind, LandmarkAssetVariant[]>();
  for (const [tupleIndex, tuple] of tuples.entries()) {
    if (!Array.isArray(tuple) || tuple.length !== 5 || !tuple.slice(0, 4).every(Number.isInteger)
      || !/^[a-f0-9]{64}$/.test(tuple[4] ?? "")) {
      throw new Error(`${kit} landmark tuple ${tupleIndex} is malformed`);
    }
    const [kindIndex, cellIndex, pivotX, pivotY, geometryHash] = tuple;
    const kind = SCENIC_LANDMARK_KINDS[kindIndex];
    if (!kind || !LANDMARK_KINDS_BY_KIT[kit].includes(kind)) {
      throw new Error(`${kit} landmark tuple ${tupleIndex} has foreign semantic kind`);
    }
    if (cellIndex < 0 || cellIndex >= 8 || cells.has(cellIndex)) {
      throw new Error(`${kit} landmark tuple ${tupleIndex} has duplicate or out-of-range cell`);
    }
    cells.add(cellIndex);
    const geometry = AUTHORED_LANDMARK_VARIANTS_BY_KIT[kit][cellIndex];
    if (!geometry || geometry.semanticKind !== kind || geometry.kitId !== kit) {
      throw new Error(`${kit} landmark tuple ${tupleIndex} has foreign or stale native geometry`);
    }
    if (geometry.contactPivotPx.x !== pivotX || geometry.contactPivotPx.y !== pivotY
      || geometry.geometryHash !== geometryHash) {
      throw new Error(`${kit} landmark ${kind} frame and geometry binding is stale`);
    }
    const nativeFrame = frame(atlasId, cellIndex, 4, 128, 128);
    const variant = Object.freeze({
      ...nativeFrame,
      rect: Object.freeze({ ...nativeFrame.rect }),
      feet: Object.freeze({ ...nativeFrame.feet }),
      faceAnchor: Object.freeze({ ...nativeFrame.faceAnchor }),
      heldAnchor: Object.freeze({ ...nativeFrame.heldAnchor }),
      ...geometry,
      atlasPixelSha256: LANDMARK_ATLAS_PIXEL_SHA256_BY_KIT[kit],
    });
    const prior = bindings.get(kind) ?? [];
    prior.push(variant);
    bindings.set(kind, prior);
  }
  for (const required of LANDMARK_KINDS_BY_KIT[kit]) {
    if (!bindings.has(required)) throw new Error(`${kit} required landmark ${required} is missing`);
  }
  return Object.freeze(Object.fromEntries([...bindings.entries()].map(([kind, variants]) => [kind, Object.freeze({
    kind,
    variants: Object.freeze([...variants]),
    renderSizePx: Object.freeze({ width: 128 as const, height: 128 as const }),
    drawLayer: "static-back" as const,
  })])));
}

function parseHomeYard(
  kit: RegionKitId,
  atlasId: string,
  geometryValue: unknown,
  variantsValue: unknown,
): HomeYardManifest {
  if (!Array.isArray(geometryValue) || geometryValue.length !== 4
    || geometryValue.some((value) => !Number.isInteger(value))
    || geometryValue[0] !== 96 || geometryValue[1] !== 112
    || geometryValue[2] !== 80 || geometryValue[3] !== 32) {
    throw new Error(`${kit} yard geometry must bind pivot 96,112 and south port [80,112)`);
  }
  if (!Array.isArray(variantsValue) || variantsValue.length !== 5) {
    throw new Error(`${kit} yard metadata must publish exactly five variants`);
  }
  const tuples = variantsValue as readonly CompactYardVariant[];
  const hashes: Partial<Record<YardSemanticFrame, string>> = {};
  for (const [index, tuple] of tuples.entries()) {
    if (!Array.isArray(tuple) || tuple.length !== 2 || tuple[0] !== index
      || !/^[a-f0-9]{64}$/.test(tuple[1] ?? "")) {
      throw new Error(`${kit} yard tuple ${index} has wrong order, cell, or geometry hash`);
    }
    hashes[YARD_SEMANTIC_FRAMES[index]!] = tuple[1];
  }
  const cells = tuples.map(([cell]) => frame(atlasId, cell, 5, 192, 160));
  return Object.freeze({
    atlasId,
    renderSizePx: { width: 192 as const, height: 160 as const },
    plotOffsetPx: { x: -32 as const, y: -16 as const },
    contactPivotPx: { x: 96 as const, y: 112 as const },
    southPort: { startPx: 80 as const, widthPx: 32 as const },
    standingVariants: Object.freeze(cells.slice(0, 2)),
    warmFrame: cells[2]!,
    hoardingFrame: cells[3]!,
    ruinFrame: cells[4]!,
    geometryHashes: Object.freeze(hashes as Record<YardSemanticFrame, string>),
  });
}

function regionPack(kit: RegionKitId, data: typeof REGION_DATA[RegionKitId]): RegionAssetPackManifest {
  const regionDescriptors = data.region.atlases as readonly PackedAtlasData[];
  const homeDescriptors = data.home.atlases as readonly PackedAtlasData[];
  const terrain = regionDescriptors.find(({ id }) => id.endsWith("terrain"));
  const scenery = regionDescriptors.find(({ id }) => id.endsWith("scenery"));
  const environment = regionDescriptors.find(({ id }) => id.endsWith("environment"));
  const landmarks = regionDescriptors.find(({ id }) => id.endsWith("landmarks"));
  if (!terrain || !scenery || !environment || !landmarks) throw new Error(`${kit} region atlas inventory is incomplete.`);
  const packedRegion = data.region as unknown as {
    semanticSceneryCells: Readonly<Record<string, number>>;
    semanticSceneryVariants?: unknown;
    semanticSceneryVariantStride?: unknown;
    semanticTerrainRoles?: Readonly<Record<string, readonly number[]>>;
    landmarkVariants?: unknown;
  };
  const kitData = getBiomeKit(kit);
  const staticKinds = [...kitData.blockingScenery, ...kitData.passiveScenery];
  const publishedSceneryVariants = parsePublishedSceneryVariants(
    kit,
    packedRegion.semanticSceneryCells,
    packedRegion.semanticSceneryVariants ?? packedRegion.semanticSceneryVariantStride,
  );
  const terrainRoleCells = packedRegion.semanticTerrainRoles ?? {
    ground: [0, 1, 2, 3, 4, 5, 6, 7],
    path: [8, 9, 10, 11, 12, 13, 14, 15],
    water: [16, 17, 18, 19, 20, 21, 22, 23],
    shore: [24, 25, 26, 27, 28, 29, 30, 31],
    soil: [32, 33, 34, 35],
  } as const;
  const terrainFramesByRole = Object.fromEntries(Object.entries(terrainRoleCells).map(
    ([role, cells]) => [role, cells.map((cell) => ({
      cell,
      frame: frame(terrain.id, cell, 8, 32, 32),
    }))],
  )) as unknown as RegionAssetPackManifest["terrainFramesByRole"];
  const animatedFrames = Object.fromEntries(kitData.animatedKinds.map((kind, index) => [
    kind,
    frame(environment.id, index * 4, 8, 32, 32),
  ])) as Readonly<Record<AnimatedEnvironmentKind, NativeFrameRef>>;
  const allDescriptors = [...regionDescriptors, ...homeDescriptors];
  const metadataBytes = serializedJsonBytes(data.region) + serializedJsonBytes(data.home);
  return {
    kit,
    atlasIds: allDescriptors.map(({ id }) => id),
    terrainFramesByRole,
    staticSceneryFrames: Object.fromEntries(staticKinds.map((kind) => [
      kind,
      frame(scenery.id, packedRegion.semanticSceneryCells[kind]!, 16, 32, 32),
    ])),
    staticSceneryVariants: Object.fromEntries(staticKinds.map((kind) => [
      kind,
      publishedSceneryVariants[kind]!.map((cell) => frame(
        scenery.id,
        cell,
        16,
        32,
        32,
      )),
    ])),
    animatedFrames,
    landmarkFrames: parseLandmarkBindings(kit, landmarks.id, packedRegion.landmarkVariants),
    homeManifest: homeManifest(kit, data.home),
    compressedBytes: allDescriptors.reduce((sum, atlas) => sum + atlas.compressedBytes, metadataBytes),
    decodedBytes: allDescriptors.reduce((sum, atlas) => sum + atlas.decodedBytes, metadataBytes),
  };
}

/**
 * Packed atlas data for the `core-being-chibi` v2 sprite-sheet atlas — the
 * full 7-character roster (`m1` base plus `f1`/`f2`/`f3`/`m2`/`m3`/`m4`),
 * each stacked in its own 4-row (down/up/side walk + one pose row) block at
 * the shared 22x48 cell size (5 columns).
 *
 * Unlike the other core atlases (sourced from the cell-grid
 * `production-core-source.json`), this atlas is packed by
 * `scripts/pack-being-chibi-atlas.mjs` from the approved chibi villager
 * source frames into its own named-frame JSON
 * (`assets/renderer2d/core/being-chibi.json`, consumed via
 * `actors/beingChibiAtlas.ts` by the sprite-sheet being actor). These
 * fields mirror the packer's printed `--check` output verbatim; regenerate
 * via the script, never hand-edit.
 */
const BEING_CHIBI_ATLAS: PackedAtlasData = {
  id: "core-being-chibi",
  path: "core/being-chibi.png",
  group: "core",
  regionKit: null,
  width: 110,
  height: 1344,
  cellWidth: 22,
  cellHeight: 48,
  columns: 5,
  rows: 28,
  compressedBytes: 13136,
  decodedBytes: 591360,
  sha256: "119e71437fcf626aa28f866565f2fa3a0a433aa3016f62bc9c6e018122052d27",
};

const allPackedData: readonly PackedAtlasData[] = [
  ...(coreSource.atlases as readonly PackedAtlasData[]),
  BEING_CHIBI_ATLAS,
  ...Object.values(REGION_DATA).flatMap(({ region, home }) => [
    ...(region.atlases as readonly PackedAtlasData[]),
    ...(home.atlases as readonly PackedAtlasData[]),
  ]),
];
const atlases = Object.fromEntries(allPackedData.map((data) => [data.id, descriptor(data)]));
const clothingAtlasBySilhouette = Object.fromEntries(CLOTHING_SILHOUETTES.map((silhouette, index) => [
  silhouette,
  `core-human-clothing-${String(index).padStart(2, "0")}`,
]));
const heldForms = [...coreSource.heldForms];
const heldFrames = Object.fromEntries(heldForms.map((formId, formIndex) => [
  formId,
  Object.fromEntries(PRODUCTION_FACINGS.map((facing, facingIndex) => [
    facing,
    frame("core-human-held", facingIndex * heldForms.length + formIndex, 16, 48, 64),
  ])) as Readonly<Record<ProductionFacing, NativeFrameRef>>,
])) as Readonly<Record<string, Readonly<Record<ProductionFacing, NativeFrameRef>>>>;
const statusCells = coreSource.statusCells as Readonly<Record<HumanStatusFrameId, number>>;
const statusFrames = Object.fromEntries((Object.entries(statusCells) as Array<
  [HumanStatusFrameId, number]
>).map(([statusId, cell]) => [
  statusId,
  frame("core-human-status-effects", cell, 16, 32, 32),
])) as Readonly<Record<HumanStatusFrameId, NativeFrameRef>>;
const regions: Readonly<Record<RegionKitId, RegionAssetPackManifest>> = {
  "worn-heartland": regionPack("worn-heartland", REGION_DATA["worn-heartland"]),
  "spring-terraces": regionPack("spring-terraces", REGION_DATA["spring-terraces"]),
  "dry-scrub": regionPack("dry-scrub", REGION_DATA["dry-scrub"]),
  "ash-waste": regionPack("ash-waste", REGION_DATA["ash-waste"]),
  "neutral-temperate": regionPack("neutral-temperate", REGION_DATA["neutral-temperate"]),
};
const coreMetadataBytes = serializedJsonBytes(coreSource);
const coreArt = Object.values(atlases).filter(({ group }) => group === "core");
const coreCompressedBytes = coreArt.reduce(
  (sum, atlas) => sum + atlas.compressedBytes,
  coreMetadataBytes,
);
const exactCoreDecodedBytes = coreArt.reduce(
  (sum, atlas) => sum + atlas.decodedBytes,
  coreMetadataBytes,
);
const regionMetadataBytes = Object.fromEntries(PRODUCTION_REGION_KIT_IDS.map((kit) => [
  kit,
  serializedJsonBytes(REGION_DATA[kit].region) + serializedJsonBytes(REGION_DATA[kit].home),
])) as Readonly<Record<RegionKitId, number>>;
const regionCompressedBytes = Object.fromEntries(PRODUCTION_REGION_KIT_IDS.map((kit) => [
  kit,
  regions[kit].compressedBytes,
])) as Readonly<Record<RegionKitId, number>>;
const activeCompressedBytes = Object.fromEntries(PRODUCTION_REGION_KIT_IDS.map((kit) => [
  kit,
  coreCompressedBytes + regions[kit].compressedBytes,
])) as Readonly<Record<RegionKitId, number>>;
const exactPeakActiveDecodedBytes = Object.fromEntries(PRODUCTION_REGION_KIT_IDS.map((kit) => [
  kit,
  exactCoreDecodedBytes + regions[kit].decodedBytes,
])) as Readonly<Record<RegionKitId, number>>;

const mutableManifest: ProductionAssetManifest = {
  version: 1,
  atlases,
  human: {
    rigs: { "human-a": rigManifest("human-a"), "human-b": rigManifest("human-b") },
    layerAtlases: {
      body: "core-human-body-rigs",
      face: "core-human-face-planes",
      hair: "core-human-hair",
      held: "core-human-held",
      status: "core-human-status-effects",
    },
    clothingAtlasBySilhouette,
    heldForms,
    heldFrames,
    statusFrames,
    palettes: {
      skin: ["porcelain", "warm", "tan", "brown", "deep", "umber"],
      hair: ["espresso", "chestnut", "gold", "copper", "charcoal", "silver"],
      clothing: ["olive", "teal", "ochre", "rust", "slate", "plum", "cream", "denim"],
    },
    hairSilhouettes: [...HAIR_SILHOUETTES],
    clothingSilhouettes: [...CLOTHING_SILHOUETTES],
  },
  regions,
  budgets: {
    coreCompressedMax: 786_432,
    regionCompressedMax: 196_608,
    activeCompressedMax: 1_310_720,
    currentUiCompressedBytes: 0,
    currentUiDecodedBytes: 0,
    coreMetadataCompressedBytes: coreMetadataBytes,
    coreMetadataDecodedBytes: coreMetadataBytes,
    coreCompressedBytes,
    exactCoreDecodedBytes,
    regionMetadataCompressedBytes: regionMetadataBytes,
    regionMetadataDecodedBytes: regionMetadataBytes,
    regionCompressedBytes,
    activeCompressedBytes,
    exactPeakActiveDecodedBytes,
  },
};

function deepFreeze<T>(value: T): T {
  if (typeof value !== "object" || value === null || Object.isFrozen(value)) return value;
  for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  return Object.freeze(value);
}

/** Validate and deeply freeze a production manifest before it can be published. */
export function finalizeProductionAssetManifest(
  manifest: ProductionAssetManifest,
): ProductionAssetManifest {
  const errors = validateProductionAssetManifest(manifest);
  if (errors.length > 0) {
    throw new Error(`Production asset manifest is invalid: ${errors.join("; ")}`);
  }
  return deepFreeze(manifest);
}

export const PRODUCTION_ASSET_MANIFEST: ProductionAssetManifest = finalizeProductionAssetManifest(
  mutableManifest,
);

/** Resolve one required body clip from its explicit rig/action/facing tuple. */
export function requireHumanClip(
  manifest: ProductionAssetManifest,
  rig: ProductionRigId,
  action: HumanBodyAction,
  facing: ProductionFacing,
): ProductionClip {
  const clipValue = manifest.human.rigs[rig]?.bodyClips[`${action}:${facing}`];
  if (!clipValue) throw new Error(`Missing production human clip ${rig}/${action}/${facing}.`);
  return clipValue;
}

/** Resolve a clip's visible facing without ever inventing a south fallback. */
export function resolveClipFacing(clipValue: ProductionClip, retainedFacing: ProductionFacing): ProductionFacing {
  if (clipValue.direction === "none") {
    if (clipValue.facingPolicy !== "preserve") throw new Error("direction:none clip must preserve facing; south fallback is forbidden.");
    return retainedFacing;
  }
  return clipValue.direction;
}

/** Return one immutable production atlas descriptor. */
export function requireProductionAtlas(id: string): ProductionAtlasDescriptor {
  const found = PRODUCTION_ASSET_MANIFEST.atlases[id];
  if (!found) throw new Error(`Unknown production atlas ${id}.`);
  return found;
}

/** Return one immutable lazy region asset pack. */
export function requireRegionAssetPack(kit: RegionKitId): RegionAssetPackManifest {
  return PRODUCTION_ASSET_MANIFEST.regions[kit];
}

/** Validate structural direction, inventory, geometry, and budget invariants. */
export function validateProductionAssetManifest(manifest: ProductionAssetManifest): readonly string[] {
  const errors: string[] = [];
  const facingSet = new Set(PRODUCTION_FACINGS);
  const faceAtlasDescriptorSha256 = manifest.atlases[manifest.human.layerAtlases.face]?.sha256;
  for (const rig of PRODUCTION_RIG_IDS) {
    const rigValue = manifest.human.rigs[rig];
    if (!rigValue) {
      errors.push(`missing human rig ${rig}`);
      continue;
    }
    for (const key of Object.keys(rigValue.facePlanes)) {
      if (!facingSet.has(key as ProductionFacing)) errors.push(`expression-only face key ${key} is forbidden for ${rig}`);
    }
    for (const facing of PRODUCTION_FACINGS) {
      const bodyPlane = rigValue.bodyFacePlanes[facing];
      if (!bodyPlane || bodyPlane.planePixels <= 0) errors.push(`body face plane missing for ${rig} ${facing}`);
      if (bodyPlane?.facialFeaturePixels !== 0) errors.push(`body facial-feature pixels must be zero for ${rig} ${facing}`);
      const fallback = rigValue.silhouetteFallbacks[facing];
      if (!fallback || fallback.rig !== rig || fallback.facing !== facing) {
        errors.push(`fallback ${rig} ${facing} must use the same facing and rig`);
      }
      for (const expression of HUMAN_EXPRESSIONS) {
        const face = rigValue.facePlanes[facing]?.[expression];
        if (!face) {
          errors.push(`missing face plane ${rig} ${facing} ${expression}`);
          continue;
        }
        if (face.rig !== rig || face.facing !== facing) errors.push(`face/body facing mismatch ${rig} ${facing} ${expression}`);
        const expectedFaceAnchor = PRODUCTION_DIRECTIONAL_FACE_ANCHORS[facing];
        if (face.frame.faceAnchor.x !== expectedFaceAnchor.x
          || face.frame.faceAnchor.y !== expectedFaceAnchor.y) {
          errors.push(`face anchor mismatch ${rig} ${facing} ${expression}`);
        }
        if (face.maskPixels !== bodyPlane?.planePixels || face.coveredMaskPixels !== face.maskPixels) {
          errors.push(`incomplete face-plane mask ${rig} ${facing} ${expression}`);
        }
        if (face.leakedPixels !== 0) errors.push(`face-plane leaked pixels ${rig} ${facing} ${expression}`);
        if (face.measuredFromSha256 !== faceAtlasDescriptorSha256) {
          errors.push(`face measured descriptor SHA mismatch ${rig} ${facing} ${expression}`);
        }
        const features = face.semanticFeaturePixels;
        const expectedFeatures = {
          south: { eyes: 2, noseDirection: "south", mouthVisible: true },
          east: { eyes: 1, noseDirection: "east", mouthVisible: true },
          north: { eyes: 0, noseDirection: "north-hidden", mouthVisible: false },
          west: { eyes: 1, noseDirection: "west", mouthVisible: true },
        }[facing];
        if (features.eyes !== expectedFeatures.eyes) {
          errors.push(`${facing} face eyes mismatch for ${rig} ${expression}`);
        }
        if (features.noseDirection !== expectedFeatures.noseDirection) {
          errors.push(`${facing} face nose direction mismatch for ${rig} ${expression}`);
        }
        if ((expectedFeatures.mouthVisible && features.mouthPixels <= 0)
          || (!expectedFeatures.mouthVisible && features.mouthPixels !== 0)) {
          errors.push(`${facing} face mouth visibility mismatch for ${rig} ${expression}`);
        }
      }
      for (const action of HUMAN_BODY_ACTIONS) {
        const bodyClip = rigValue.bodyClips[`${action}:${facing}`];
        if (!bodyClip) {
          errors.push(`missing clip ${rig} ${action} ${facing}`);
          continue;
        }
        if (bodyClip.direction === "none" && bodyClip.facingPolicy !== "preserve") {
          errors.push(`direction none must preserve facing; south fallback forbidden in ${rig} ${action} ${facing}`);
        }
        const unsafe = bodyClip as ProductionClip & { fallbackFacing?: string };
        if (bodyClip.direction === "none" && unsafe.fallbackFacing !== undefined) {
          errors.push(`south fallback is forbidden for direction none clip ${rig} ${action} ${facing}`);
        }
        if (action === "turn") {
          const switches = bodyClip.markers.filter(({ name }) => name === "facing-switch");
          if (switches.length !== 1) errors.push(`turn requires one facing-switch ${rig} ${facing}`);
          const expected = switches[0]?.frame;
          if (Object.values(bodyClip.layerFacingSwitchFrames).some((frameValue) => frameValue !== expected)) {
            errors.push(`body and face must switch on the same facing-switch marker for ${rig} ${facing}`);
          }
        }
      }
    }
  }
  if (manifest.human.palettes.skin.length !== 6) errors.push("human inventory requires six skin ramps");
  if (manifest.human.hairSilhouettes.length !== 8) errors.push("human inventory requires eight hair silhouettes");
  if (manifest.human.palettes.hair.length !== 6) errors.push("human inventory requires six hair ramps");
  if (manifest.human.clothingSilhouettes.length !== 8) errors.push("human inventory requires eight clothing silhouettes");
  if (manifest.human.palettes.clothing.length !== 8) errors.push("human inventory requires eight clothing palettes");
  if (Object.keys(manifest.human.clothingAtlasBySilhouette).length !== 8) errors.push("clothingAtlasBySilhouette requires eight exact entries");
  if (manifest.human.heldForms.length !== coreSource.heldForms.length
    || manifest.human.heldForms.some((form, index) => form !== coreSource.heldForms[index])) {
    errors.push("human held forms must preserve the exact authored order");
  }
  for (const [formIndex, formId] of coreSource.heldForms.entries()) {
    for (const [facingIndex, facing] of PRODUCTION_FACINGS.entries()) {
      const heldFrame = manifest.human.heldFrames[formId]?.[facing];
      const expectedX = formIndex * 48;
      const expectedY = facingIndex * 64;
      if (!heldFrame || heldFrame.atlasId !== "core-human-held"
        || heldFrame.rect.x !== expectedX || heldFrame.rect.y !== expectedY
        || heldFrame.rect.width !== 48 || heldFrame.rect.height !== 64) {
        errors.push(`human held frame ${formId}/${facing} must use its exact authored cell`);
      }
    }
  }
  for (const [statusId, expectedCell] of Object.entries(coreSource.statusCells) as Array<
    [HumanStatusFrameId, number]
  >) {
    const statusFrame = manifest.human.statusFrames[statusId];
    if (!statusFrame || statusFrame.atlasId !== "core-human-status-effects"
      || statusFrame.rect.x !== expectedCell * 32 || statusFrame.rect.y !== 0
      || statusFrame.rect.width !== 32 || statusFrame.rect.height !== 32) {
      errors.push(`human status frame ${statusId} must use its explicit authored cell`);
    }
  }

  const expectedRegionAtlasIds = (kit: RegionKitId): readonly string[] => [
    `${kit}-terrain`,
    `${kit}-scenery`,
    `${kit}-environment`,
    `${kit}-landmarks`,
    `${kit}-home-components`,
    `${kit}-home-details`,
    `${kit}-home-ruins`,
    `${kit}-home-yards`,
  ];
  const expectedAtlasIds = [
    ...CORE_ATLAS_IDS,
    ...PRODUCTION_REGION_KIT_IDS.flatMap((kit) => expectedRegionAtlasIds(kit)),
  ];
  const expectedAtlasIdSet = new Set<string>(expectedAtlasIds);
  const atlasEntries = Object.entries(manifest.atlases);
  const atlasValues = atlasEntries.map(([, atlas]) => atlas);
  const descriptorIds = atlasValues.map(({ id }) => id);
  if (new Set(descriptorIds).size !== descriptorIds.length) errors.push("duplicate production atlas ID");

  for (const [key, atlas] of atlasEntries) {
    if (key !== atlas.id) errors.push(`${key}: descriptor key/id mismatch (${atlas.id})`);
    if (!expectedAtlasIdSet.has(key)) errors.push(`${key}: foreign atlas outside exact production membership`);
    if (atlas.decodedBytes !== atlas.width * atlas.height * 4) errors.push(`${atlas.id}: decoded bytes mismatch`);
    if (atlas.compressedBytes <= 0) errors.push(`${atlas.id}: compressed bytes must be positive`);
    if (!/^[a-f0-9]{64}$/.test(atlas.sha256)) errors.push(`${atlas.id}: invalid sha256`);
  }

  for (const expectedId of expectedAtlasIds) {
    if (!manifest.atlases[expectedId]) errors.push(`${expectedId}: missing from exact atlas membership`);
  }

  const hrefOwners = new Map<string, string>();
  for (const atlas of atlasValues) {
    const href = atlas.url?.href;
    if (!href) {
      errors.push(`${atlas.id}: missing atlas URL`);
      continue;
    }
    const priorOwner = hrefOwners.get(href);
    if (priorOwner) errors.push(`${atlas.id}: duplicate atlas URL also used by ${priorOwner}`);
    else hrefOwners.set(href, atlas.id);
  }

  let coreArtCompressed = 0;
  let coreArtDecoded = 0;
  for (const id of CORE_ATLAS_IDS) {
    const atlas = manifest.atlases[id];
    if (!atlas) continue;
    if (atlas.id !== id || atlas.group !== "core" || atlas.regionKit !== null) {
      errors.push(`${id}: exact core membership requires group core and no region ownership`);
    }
    coreArtCompressed += atlas.compressedBytes;
    coreArtDecoded += atlas.decodedBytes;
  }
  const expectedCoreMetadataBytes = serializedJsonBytes(coreSource);
  const coreCompressed = coreArtCompressed + expectedCoreMetadataBytes;
  const coreDecoded = coreArtDecoded + expectedCoreMetadataBytes;
  if (manifest.budgets.coreMetadataCompressedBytes !== expectedCoreMetadataBytes
    || manifest.budgets.coreMetadataDecodedBytes !== expectedCoreMetadataBytes) {
    errors.push("core metadata byte accounting mismatch");
  }
  if (manifest.budgets.coreCompressedBytes !== coreCompressed) {
    errors.push(`core compressed bytes mismatch; recomputed ${coreCompressed}`);
  }
  if (coreCompressed > manifest.budgets.coreCompressedMax) errors.push("core compressed budget exceeded");
  if (coreDecoded !== manifest.budgets.exactCoreDecodedBytes) errors.push("exact core decoded bytes mismatch");

  const exactRegionKitSet = new Set<string>(PRODUCTION_REGION_KIT_IDS);
  const regionKeys = Object.keys(manifest.regions);
  for (const kit of PRODUCTION_REGION_KIT_IDS) {
    if (!manifest.regions[kit]) errors.push(`${kit}: missing from exact region pack membership`);
  }
  for (const key of regionKeys) {
    if (!exactRegionKitSet.has(key)) errors.push(`${key}: foreign region pack outside exact membership`);
  }

  const requireAtlasReference = (owner: string, atlasId: string): void => {
    if (!manifest.atlases[atlasId]) errors.push(`${owner}: missing atlas reference ${atlasId}`);
  };
  const validateFrameReferences = (
    owner: string,
    frames: readonly NativeFrameRef[],
    expectedAtlasId: string,
  ): void => {
    for (const frameValue of frames) {
      requireAtlasReference(owner, frameValue.atlasId);
      if (frameValue.atlasId !== expectedAtlasId) {
        errors.push(`${owner}: atlas ownership requires ${expectedAtlasId}, received ${frameValue.atlasId}`);
      }
    }
  };
  const expectedHumanLayerAtlases: Readonly<Record<Exclude<HumanLayerId, "clothing">, string>> = {
    body: "core-human-body-rigs",
    face: "core-human-face-planes",
    hair: "core-human-hair",
    held: "core-human-held",
    status: "core-human-status-effects",
  };
  for (const [layer, expectedId] of Object.entries(expectedHumanLayerAtlases)) {
    const atlasId = manifest.human.layerAtlases[layer as Exclude<HumanLayerId, "clothing">];
    requireAtlasReference(`human ${layer} layer`, atlasId);
    if (atlasId !== expectedId) errors.push(`human ${layer} layer must reference ${expectedId}`);
  }
  for (const [index, silhouette] of CLOTHING_SILHOUETTES.entries()) {
    const atlasId = manifest.human.clothingAtlasBySilhouette[silhouette];
    const expectedId = `core-human-clothing-${String(index).padStart(2, "0")}`;
    requireAtlasReference(`clothing silhouette ${silhouette}`, atlasId);
    if (atlasId !== expectedId) errors.push(`clothing silhouette ${silhouette} must reference ${expectedId}`);
  }
  for (const rig of PRODUCTION_RIG_IDS) {
    const rigValue = manifest.human.rigs[rig];
    if (!rigValue) continue;
    for (const facing of PRODUCTION_FACINGS) {
      const fallback = rigValue.silhouetteFallbacks[facing];
      if (fallback) {
        validateFrameReferences(
          `${rig} ${facing} silhouette fallback`,
          [fallback.frame],
          "core-human-body-rigs",
        );
      }
      for (const expression of HUMAN_EXPRESSIONS) {
        const faceValue = rigValue.facePlanes[facing]?.[expression];
        if (faceValue) {
          validateFrameReferences(
            `${rig} ${facing} ${expression} face plane`,
            [faceValue.frame],
            "core-human-face-planes",
          );
        }
      }
      for (const action of HUMAN_BODY_ACTIONS) {
        const clipValue = rigValue.bodyClips[`${action}:${facing}`];
        if (clipValue) {
          validateFrameReferences(
            `${rig} ${action} ${facing} clip`,
            clipValue.frames,
            "core-human-body-rigs",
          );
          const bodyAtlas = manifest.atlases["core-human-body-rigs"];
          if (bodyAtlas) {
            for (const frameValue of clipValue.frames) {
              const column = frameValue.rect.x / bodyAtlas.cellWidth;
              const row = frameValue.rect.y / bodyAtlas.cellHeight;
              const cell = row * bodyAtlas.columns + column;
              const tuple = Number.isInteger(cell) ? BODY_FRAME_ANCHORS[cell] : undefined;
              const matches = tuple !== undefined
                && frameValue.feet.x === tuple[0]
                && frameValue.feet.y === tuple[1]
                && frameValue.faceAnchor.x === tuple[2]
                && frameValue.faceAnchor.y === tuple[3]
                && frameValue.heldAnchor.x === tuple[4]
                && frameValue.heldAnchor.y === tuple[5];
              if (!matches) {
                errors.push(`${rig} ${action} ${facing}: body cell ${cell} attachment anchor tuple mismatch`);
              }
            }
          }
        }
      }
    }
  }

  const recomputedPeakDecoded = {} as Record<RegionKitId, number>;
  for (const kit of PRODUCTION_REGION_KIT_IDS) {
    const pack = manifest.regions[kit];
    if (!pack) continue;
    if (pack.kit !== kit) errors.push(`region pack key mismatch ${kit}`);
    const expectedPackIds = expectedRegionAtlasIds(kit);
    const expectedPackIdSet = new Set(expectedPackIds);
    const packIdCounts = new Map<string, number>();
    for (const atlasId of pack.atlasIds) {
      packIdCounts.set(atlasId, (packIdCounts.get(atlasId) ?? 0) + 1);
      if (!manifest.atlases[atlasId]) errors.push(`${kit}: missing atlas reference ${atlasId}`);
      if (!expectedPackIdSet.has(atlasId)) errors.push(`${kit}: foreign atlas ${atlasId} violates region ownership`);
    }
    for (const expectedId of expectedPackIds) {
      const count = packIdCounts.get(expectedId) ?? 0;
      if (count === 0) errors.push(`${kit}: ${expectedId} omitted from exact membership`);
      if (count > 1) errors.push(`${kit}: duplicate ${expectedId}; atlas counted twice`);
    }

    for (const expectedId of expectedPackIds) {
      const atlas = manifest.atlases[expectedId];
      if (!atlas) continue;
      const expectedGroup: ProductionAtlasDescriptor["group"] = expectedId.includes("-home-")
        ? "home"
        : "region";
      if (atlas.group !== expectedGroup) {
        errors.push(`${expectedId}: group ${atlas.group} misclassified; expected ${expectedGroup}`);
      }
      if (atlas.regionKit !== kit) {
        errors.push(`${expectedId}: region ownership mismatch; expected ${kit}, received ${atlas.regionKit ?? "none"}`);
      }
    }

    const biome = getBiomeKit(kit);
    for (const kind of [...biome.blockingScenery, ...biome.passiveScenery]) {
      if (!pack.staticSceneryFrames[kind]) errors.push(`${kit}: missing static scenery ${kind}`);
      const variants = pack.staticSceneryVariants[kind];
      if (!variants || variants.length !== 32) errors.push(`${kit}: static scenery ${kind} requires 32 variants`);
    }
    for (const kind of biome.animatedKinds) {
      if (!pack.animatedFrames[kind]) errors.push(`${kit}: missing animated environment ${kind}`);
    }
    const expectedTerrainCells: Readonly<Record<TerrainRole, readonly number[]>> = {
      ground: [0, 1, 2, 3, 4, 5, 6, 7],
      path: [8, 9, 10, 11, 12, 13, 14, 15],
      water: [16, 17, 18, 19, 20, 21, 22, 23],
      shore: [24, 25, 26, 27, 28, 29, 30, 31],
      soil: [32, 33, 34, 35],
    };
    const terrainBindings = Object.entries(pack.terrainFramesByRole ?? {});
    if (terrainBindings.length !== Object.keys(expectedTerrainCells).length) {
      errors.push(`${kit}: semantic terrain roles must be exactly ground, path, water, shore, and soil`);
    }
    const terrainCells = new Set<number>();
    for (const [role, expectedCells] of Object.entries(expectedTerrainCells)) {
      const bindings = pack.terrainFramesByRole?.[role as TerrainRole];
      if (!bindings || bindings.length !== expectedCells.length
        || bindings.some(({ cell }, index) => cell !== expectedCells[index])) {
        errors.push(`${kit}: semantic terrain role ${role} has an invalid legal cell band`);
        continue;
      }
      for (const { cell } of bindings) {
        if (cell > 35 || terrainCells.has(cell)) errors.push(`${kit}: terrain cell ${cell} is reserved or duplicated`);
        terrainCells.add(cell);
      }
    }
    validateFrameReferences(
      `${kit} terrain frames`,
      terrainBindings.flatMap(([_role, bindings]) => bindings.map(({ frame: terrainFrame }) => terrainFrame)),
      `${kit}-terrain`,
    );
    validateFrameReferences(
      `${kit} static scenery frames`,
      Object.values(pack.staticSceneryFrames),
      `${kit}-scenery`,
    );
    validateFrameReferences(
      `${kit} static scenery variant frames`,
      Object.values(pack.staticSceneryVariants).flat(),
      `${kit}-scenery`,
    );
    validateFrameReferences(
      `${kit} animated environment frames`,
      Object.values(pack.animatedFrames),
      `${kit}-environment`,
    );
    const expectedLandmarkKinds = LANDMARK_KINDS_BY_KIT[kit];
    const landmarkAtlas = manifest.atlases[`${kit}-landmarks`];
    const expectedLandmarkPixelSha = LANDMARK_ATLAS_PIXEL_SHA256_BY_KIT[kit];
    if (!landmarkAtlas || landmarkAtlas.sha256 !== expectedLandmarkPixelSha) {
      errors.push(`${kit}: landmark atlas pixel SHA must match its native geometry source`);
    }
    const publishedLandmarkKinds = Object.keys(pack.landmarkFrames ?? {});
    for (const key of publishedLandmarkKinds) {
      if (!expectedLandmarkKinds.includes(key as ScenicLandmarkKind)) {
        errors.push(`${kit}: foreign landmark semantic key ${key}`);
      }
    }
    for (const kind of expectedLandmarkKinds) {
      const binding = pack.landmarkFrames[kind];
      if (!binding) {
        errors.push(`${kit}: required landmark ${kind} is missing`);
        continue;
      }
      if (binding.kind !== kind || binding.kind === `${kit}-landmarks`) {
        errors.push(`${kit}: landmark ${kind} semantic identity is invalid`);
      }
      if (binding.drawLayer !== "static-back"
        || binding.renderSizePx.width !== 128 || binding.renderSizePx.height !== 128) {
        errors.push(`${kit}: landmark ${kind} has invalid layer or size`);
      }
      const expectedVariants = AUTHORED_LANDMARK_VARIANTS_BY_KIT[kit]
        .filter(({ semanticKind }) => semanticKind === kind);
      if (binding.variants.length !== expectedVariants.length) {
        errors.push(`${kit}: landmark ${kind} requires every exact authored variant`);
      }
      const variantIds = binding.variants.map(({ variantId }) => variantId);
      if (new Set(variantIds).size !== variantIds.length) {
        errors.push(`${kit}: landmark ${kind} has a duplicate variant identity`);
      }
      const geometryHashes = binding.variants.map(({ geometryHash }) => geometryHash);
      if (new Set(geometryHashes).size !== geometryHashes.length
        || geometryHashes.some((hash) => !/^[a-f0-9]{64}$/.test(hash))) {
        errors.push(`${kit}: landmark ${kind} requires unique valid geometry hashes`);
      }
      const rectKeys = binding.variants.map(({ rect }) => `${rect.x},${rect.y},${rect.width},${rect.height}`);
      if (new Set(rectKeys).size !== rectKeys.length
        || binding.variants.some(({ rect }) => rect.x < 0 || rect.y < 0
          || rect.width !== 128 || rect.height !== 128 || rect.x + rect.width > 512 || rect.y + rect.height > 256)) {
        errors.push(`${kit}: landmark ${kind} has duplicate or out-of-range frame`);
      }
      validateFrameReferences(`${kit} landmark ${kind}`, binding.variants, `${kit}-landmarks`);
      for (const variant of binding.variants) {
        if (variant.atlasPixelSha256 !== expectedLandmarkPixelSha
          || variant.atlasPixelSha256 !== landmarkAtlas?.sha256) {
          errors.push(`${kit}: landmark ${kind} pixel SHA binding is stale`);
        }
        if (!Number.isInteger(variant.contactPivotPx?.x) || !Number.isInteger(variant.contactPivotPx?.y)) {
          errors.push(`${kit}: landmark ${kind} pivot must use integer native pixels`);
        }
        if (variant.kitId !== kit || variant.semanticKind !== kind) {
          errors.push(`${kit}: landmark ${kind} kit ownership is foreign`);
        }
        const expected = AUTHORED_LANDMARK_VARIANTS_BY_KIT[kit][variant.cellIndex];
        if (!expected || variant.variantId !== expected.variantId) {
          errors.push(`${kit}: landmark ${kind} variant identity is stale`);
          continue;
        }
        const expectedRect = {
          x: (expected.cellIndex % 4) * 128,
          y: Math.floor(expected.cellIndex / 4) * 128,
          width: 128,
          height: 128,
        };
        if (JSON.stringify(variant.rect) !== JSON.stringify(expectedRect)) {
          errors.push(`${kit}: landmark ${kind} frame geometry does not match its native cell`);
        }
        if (variant.geometryHash !== expected.geometryHash) {
          errors.push(`${kit}: landmark ${kind} geometry hash is stale`);
        }
        const exactGeometry = {
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
          drawLayer: variant.drawLayer,
          heightPolicy: variant.heightPolicy,
          recognitionTags: variant.recognitionTags,
          topologyKey: variant.topologyKey,
          geometryHash: variant.geometryHash,
        };
        if (JSON.stringify(exactGeometry) !== JSON.stringify(expected)) {
          errors.push(`${kit}: landmark ${kind} atomic geometry is stale`);
        }
      }
    }
    const expectedHomeAtlasId = `${kit}-home-components`;
    const expectedDetailAtlasId = `${kit}-home-details`;
    const expectedRuinAtlasId = `${kit}-home-ruins`;
    const expectedYardAtlasId = `${kit}-home-yards`;
    if (pack.homeManifest.kit !== kit) errors.push(`${kit}: home manifest region ownership mismatch`);
    for (const [role, atlasId, expectedId] of [
      ["components", pack.homeManifest.atlasId, expectedHomeAtlasId],
      ["details", pack.homeManifest.detailAtlasId, expectedDetailAtlasId],
      ["ruins", pack.homeManifest.ruinAtlasId, expectedRuinAtlasId],
      ["yards", pack.homeManifest.yard.atlasId, expectedYardAtlasId],
    ] as const) {
      requireAtlasReference(`${kit} home ${role}`, atlasId);
      if (atlasId !== expectedId) errors.push(`${kit}: home ${role} ownership must reference ${expectedId}`);
    }
    validateFrameReferences(
      `${kit} home component frames`,
      Object.values(pack.homeManifest.frames),
      expectedHomeAtlasId,
    );
    validateFrameReferences(
      `${kit} home detail frames`,
      Object.values(pack.homeManifest.detailFrames),
      expectedDetailAtlasId,
    );
    validateFrameReferences(
      `${kit} home ruin frames`,
      Object.values(pack.homeManifest.ruinFrames),
      expectedRuinAtlasId,
    );
    const yard = pack.homeManifest.yard;
    const yardFrames = [...yard.standingVariants, yard.warmFrame, yard.hoardingFrame, yard.ruinFrame];
    validateFrameReferences(`${kit} home yard frames`, yardFrames, expectedYardAtlasId);
    const yardRectKeys = yardFrames.map(({ rect }) => `${rect.x},${rect.y},${rect.width},${rect.height}`);
    if (yard.standingVariants.length !== 2) errors.push(`${kit}: yard requires exactly two standing variants`);
    if (new Set(yardRectKeys).size !== 5) errors.push(`${kit}: duplicate yard frame`);
    if (yardFrames.some(({ rect }) => rect.y !== 0 || rect.width !== 192 || rect.height !== 160
      || rect.x < 0 || rect.x + rect.width > 960)) errors.push(`${kit}: yard frame is out of range`);
    if (yard.renderSizePx.width !== 192 || yard.renderSizePx.height !== 160
      || yard.plotOffsetPx.x !== -32 || yard.plotOffsetPx.y !== -16
      || yard.contactPivotPx.x !== 96 || yard.contactPivotPx.y !== 112
      || yard.southPort.startPx !== 80 || yard.southPort.widthPx !== 32) {
      errors.push(`${kit}: yard size, origin, pivot, or south port is invalid`);
    }
    const expectedYard = regions[kit].homeManifest.yard;
    if (JSON.stringify(yard.geometryHashes) !== JSON.stringify(expectedYard.geometryHashes)) {
      errors.push(`${kit}: yard geometry hash is stale`);
    }

    const expectedRegionMetadataBytes = serializedJsonBytes(REGION_DATA[kit].region)
      + serializedJsonBytes(REGION_DATA[kit].home);
    let recomputedCompressedBytes = expectedRegionMetadataBytes;
    let recomputedDecodedBytes = expectedRegionMetadataBytes;
    for (const atlasId of pack.atlasIds) {
      const atlas = manifest.atlases[atlasId];
      if (!atlas) continue;
      recomputedCompressedBytes += atlas.compressedBytes;
      recomputedDecodedBytes += atlas.decodedBytes;
    }
    if (pack.compressedBytes !== recomputedCompressedBytes) {
      errors.push(`${kit}: compressed total mismatch; recomputed ${recomputedCompressedBytes}`);
    }
    if (pack.decodedBytes !== recomputedDecodedBytes) {
      errors.push(`${kit}: decoded total mismatch; recomputed ${recomputedDecodedBytes}`);
    }
    if (manifest.budgets.regionMetadataCompressedBytes[kit] !== expectedRegionMetadataBytes
      || manifest.budgets.regionMetadataDecodedBytes[kit] !== expectedRegionMetadataBytes) {
      errors.push(`${kit}: region metadata byte accounting mismatch`);
    }
    if (manifest.budgets.regionCompressedBytes[kit] !== recomputedCompressedBytes) {
      errors.push(`${kit}: region compressed budget total mismatch`);
    }
    if (recomputedCompressedBytes > manifest.budgets.regionCompressedMax) errors.push(`${kit}: region compressed budget exceeded`);
    const activeCompressed = coreCompressed + recomputedCompressedBytes
      + manifest.budgets.currentUiCompressedBytes;
    if (manifest.budgets.activeCompressedBytes[kit] !== activeCompressed) {
      errors.push(`${kit}: active compressed bytes mismatch; recomputed ${activeCompressed}`);
    }
    if (activeCompressed > manifest.budgets.activeCompressedMax) {
      errors.push(`${kit}: active compressed budget exceeded`);
    }
    recomputedPeakDecoded[kit] = coreDecoded + recomputedDecodedBytes
      + manifest.budgets.currentUiDecodedBytes;
    if (manifest.budgets.exactPeakActiveDecodedBytes[kit] !== recomputedPeakDecoded[kit]) {
      errors.push(`${kit}: exact peak active decoded bytes mismatch; recomputed ${recomputedPeakDecoded[kit]}`);
    }
  }
  if (typeof manifest.budgets.exactPeakActiveDecodedBytes !== "object"
    || manifest.budgets.exactPeakActiveDecodedBytes === null) {
    errors.push("exact peak active decoded bytes must be owned per region");
  }
  return errors;
}
