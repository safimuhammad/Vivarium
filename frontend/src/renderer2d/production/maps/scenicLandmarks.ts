import type { Rect, Vec2 } from "../../contracts";
import type { RegionKitId } from "./biomeKits";

/** Closed semantic vocabulary for large, region-owned scene compositions. */
export const SCENIC_LANDMARK_KINDS = Object.freeze([
  "old-oak-grove-composite",
  "broken-fence-garden-composite",
  "reclaimed-path-shoulder-composite",
  "connected-spring-terrace-composite",
  "spring-hillside-terrace-composite",
  "reed-bank-composite",
  "wet-stone-willow-composite",
  "short-boardwalk-composite",
  "sun-rock-outcrop-composite",
  "deadwood-thorn-tangle-composite",
  "wind-scrub-clump-composite",
  "nuclear-crater-fissure-composite",
  "fractured-industrial-pylon-composite",
  "slag-charred-ridge-composite",
  "ash-debris-fan-composite",
  "restrained-broad-grove-composite",
  "field-rock-boundary-composite",
  "wildflower-verge-composite",
] as const);

export type ScenicLandmarkKind = (typeof SCENIC_LANDMARK_KINDS)[number];

/** Closed, order-sensitive native yard frames shared by all regional yard atlases. */
export const YARD_SEMANTIC_FRAMES = Object.freeze([
  "standing-a-base",
  "standing-b-base",
  "warm-overlay",
  "durable-hoarding-overlay",
  "persistent-ruin-base",
] as const);

export type YardSemanticFrame = (typeof YARD_SEMANTIC_FRAMES)[number];

/** Exact kit ownership. Array order is the canonical 18-kind order above. */
export const LANDMARK_KINDS_BY_KIT: Readonly<Record<RegionKitId, readonly ScenicLandmarkKind[]>> = Object.freeze({
  "worn-heartland": Object.freeze([
    "old-oak-grove-composite",
    "broken-fence-garden-composite",
    "reclaimed-path-shoulder-composite",
  ] as const),
  "spring-terraces": Object.freeze([
    "connected-spring-terrace-composite",
    "spring-hillside-terrace-composite",
    "reed-bank-composite",
    "wet-stone-willow-composite",
    "short-boardwalk-composite",
  ] as const),
  "dry-scrub": Object.freeze([
    "sun-rock-outcrop-composite",
    "deadwood-thorn-tangle-composite",
    "wind-scrub-clump-composite",
  ] as const),
  "ash-waste": Object.freeze([
    "nuclear-crater-fissure-composite",
    "fractured-industrial-pylon-composite",
    "slag-charred-ridge-composite",
    "ash-debris-fan-composite",
  ] as const),
  "neutral-temperate": Object.freeze([
    "restrained-broad-grove-composite",
    "field-rock-boundary-composite",
    "wildflower-verge-composite",
  ] as const),
});

export type LandmarkOrientation =
  | "none"
  | "north"
  | "east"
  | "south"
  | "west"
  | "north-south"
  | "east-west";

export type LandmarkPortRole = "path" | "shore" | "water" | "cluster";

export interface LandmarkConnectionPort {
  readonly side: "north" | "east" | "south" | "west";
  readonly startPx: number;
  readonly widthPx: number;
  readonly role: LandmarkPortRole;
}

export interface TileVisualFootprint {
  readonly originOffsetTiles: Vec2;
  readonly widthTiles: number;
  readonly heightTiles: number;
}

export type LandmarkHeightPolicy = "planar" | "tall-static-back-excluded";

/** Runtime-owned geometry for one exact native landmark atlas cell. */
export interface AuthoredLandmarkVariantGeometry {
  readonly kitId: RegionKitId;
  readonly semanticKind: ScenicLandmarkKind;
  readonly variantId: string;
  readonly cellIndex: number;
  readonly cellRectPx: Rect;
  readonly orientation: LandmarkOrientation;
  readonly connectionPorts: readonly LandmarkConnectionPort[];
  readonly compatibleAdjacency: Readonly<Record<"north" | "east" | "south" | "west", string>>;
  readonly eligibleTopologyKeys: readonly string[];
  readonly contactPivotPx: Vec2;
  readonly opaqueComponentOrdinals: readonly number[];
  readonly recognitionComponentOrdinals: readonly number[];
  readonly opaqueBoundsPx: Rect;
  readonly recognitionBoundsPx: Rect;
  readonly visualFootprint: TileVisualFootprint;
  readonly hardOffsets: readonly Vec2[];
  readonly interactionExclusionOffsets: readonly Vec2[];
  readonly drawLayer: "static-back";
  readonly heightPolicy: LandmarkHeightPolicy;
  readonly recognitionTags: readonly string[];
  /** Source-compatible shortcut retained for deterministic recipe selection. */
  readonly topologyKey: string;
  readonly geometryHash: string;
}

/**
 * Full native authoring record. Bounds and component ordinals are measured from PNG
 * alpha; geometryHash binds the atlas bytes to every remaining field.
 */
export interface AuthoredVariantGeometry {
  readonly kitId: RegionKitId;
  readonly semanticKind: ScenicLandmarkKind | YardSemanticFrame;
  readonly variantId: string;
  readonly cellIndex: number;
  readonly cellRectPx: Rect;
  readonly orientation: LandmarkOrientation;
  readonly connectionPorts: readonly LandmarkConnectionPort[];
  readonly compatibleAdjacency: Readonly<Record<"north" | "east" | "south" | "west", string>>;
  readonly eligibleTopologyKeys: readonly string[];
  readonly contactPivotPx: Vec2;
  readonly opaqueComponentOrdinals: readonly number[];
  readonly recognitionComponentOrdinals: readonly number[];
  readonly opaqueBoundsPx: Rect;
  readonly recognitionBoundsPx: Rect;
  readonly visualFootprint: TileVisualFootprint;
  readonly hardOffsets: readonly Vec2[];
  readonly interactionExclusionOffsets: readonly Vec2[];
  readonly drawLayer: "static-back" | "home-back";
  readonly heightPolicy: LandmarkHeightPolicy | "home-apron";
  readonly recognitionTags: readonly string[];
  readonly geometryHash: string;
}

type CompactLandmarkGeometry = readonly [
  semanticKind: ScenicLandmarkKind,
  variantId: string,
  contactPivotY: number,
  hardOffsets: readonly (readonly [x: number, y: number])[],
  heightPolicy: LandmarkHeightPolicy,
  topologyKey: string,
  geometryHash: string,
];

const COMPACT_LANDMARK_GEOMETRY = {
  "worn-heartland": [
    ["old-oak-grove-composite", "worn-heartland:broad-crown", 112, [[0, 0]], "tall-static-back-excluded", "none", "93259a1cd7cc844f4d6bdec5fecf2407a1f9a48761e892adb558e0bb4864a366"],
    ["old-oak-grove-composite", "worn-heartland:split-crown", 112, [[-1, 0], [0, 0]], "tall-static-back-excluded", "none", "b5d9b21ac2264c520323aff02a9aa27416e7f3f2b579edde75205e2925c5142c"],
    ["old-oak-grove-composite", "worn-heartland:wind-worn-crown", 112, [[-1, 0], [0, 0]], "tall-static-back-excluded", "none", "56c33f37f5c678333d79b3e50abca5d06fd9a717f41f86ba30e40e673797d485"],
    ["broken-fence-garden-composite", "worn-heartland:open-south-gap", 96, [[-1, 0]], "planar", "south-gap", "205f2381f73e709002b03f1f6db22528881e0902e20e7a210248226cd383aabe"],
    ["broken-fence-garden-composite", "worn-heartland:open-east-gap", 96, [[-1, 0]], "planar", "east-gap", "fc6be902614424cf435a7fa38284d19675631377e9de950c5603c59055ff579c"],
    ["broken-fence-garden-composite", "worn-heartland:diagonal-reclaimed-boundary", 96, [[-1, 0]], "planar", "diagonal", "fee9f9866e02f643de3e0927d299f3efa31ec1b82d5b51ed87f990cc9a16fabc"],
    ["reclaimed-path-shoulder-composite", "worn-heartland:left-right-shoulder", 96, [], "planar", "east-west", "b0bc39d54cd25184260313c4cb6f66b682be689e8b716d4ea0491d90eee32fad"],
    ["reclaimed-path-shoulder-composite", "worn-heartland:top-bottom-shoulder", 96, [], "planar", "north-south", "fc3b38a7ed933c9a2a5a3932ff6e726fe491cdf7ae472c568e9eb6925b1793cc"],
  ],
  "spring-terraces": [
    ["connected-spring-terrace-composite", "spring-terraces:curved-pool-rim", 80, [], "planar", "spring-terraces:connected-spring-terrace-composite:none", "23f83d63c401cc33525e813fbe989a9394391a19c76359747bc5ff85f25a17c1"],
    ["connected-spring-terrace-composite", "spring-terraces:stepped-pool-rim", 80, [], "planar", "spring-terraces:connected-spring-terrace-composite:none", "5d39aef8d75f97e96d78ad498396b92c847ae9056e56733a0bd075766e9b7377"],
    ["spring-hillside-terrace-composite", "spring-terraces:two-wet-stone-levels", 96, [], "planar", "spring-terraces:spring-hillside-terrace-composite:south", "f1d01193358c3f2e8a29365068c13f7c0b81d13de863d981bf6bf5aba49312a6"],
    ["reed-bank-composite", "spring-terraces:broken-sight-gap", 96, [], "planar", "spring-terraces:reed-bank-composite:east-west", "b6b21d41969a58b78b49558deb4a08be3374a03a73290eb14ffd6b5cf389f56e"],
    ["wet-stone-willow-composite", "spring-terraces:willow-left", 112, [[0, 0], [1, 0]], "tall-static-back-excluded", "spring-terraces:wet-stone-willow-composite:none", "48bc5492ecdc16340d6fbcebeff368f54b38914306f97e486e0dcee498d136e8"],
    ["wet-stone-willow-composite", "spring-terraces:willow-right", 112, [[0, 0], [1, 0]], "tall-static-back-excluded", "spring-terraces:wet-stone-willow-composite:none", "2a4a3118a7966d154dfb3f88696059fadfc1b7d09130b55598c4ae864272fddd"],
    ["short-boardwalk-composite", "spring-terraces:north-south-planks", 64, [], "planar", "spring-terraces:short-boardwalk-composite:north-south", "7875b6fd3f127a6006165cfcd7f4cc33611f2fe5388942c89b84b56acab6fc3f"],
    ["short-boardwalk-composite", "spring-terraces:east-west-planks", 64, [], "planar", "spring-terraces:short-boardwalk-composite:east-west", "3ceceaecb09edfefc37b0aeafdc118b2e8a87f6757cfc778ea5c8e3fb5b5013c"],
  ],
  "dry-scrub": [
    ["sun-rock-outcrop-composite", "dry-scrub:low-stepped-ridge", 104, [[-1, 0], [0, 0]], "planar", "dry-scrub:sun-rock-outcrop-composite:none", "a55545cc8b07edddd57b4acdba7176b6b8f101f66cccfecfa03527ae5a0b966c"],
    ["sun-rock-outcrop-composite", "dry-scrub:split-outcrop", 104, [[-1, 0], [0, 0]], "planar", "dry-scrub:sun-rock-outcrop-composite:none", "def52c326c5ef60056fe8f6fc1be2112b6d2aaecd023b8029ba86ab56839a1ff"],
    ["sun-rock-outcrop-composite", "dry-scrub:wind-cut-diagonal-ridge", 104, [[-1, 0], [0, 0]], "planar", "dry-scrub:sun-rock-outcrop-composite:east-west", "b8b8f4ec9adaa31fdc3fe490d8f077fe7d13a3a7d6668631195c0ab7ec8a5ee0"],
    ["deadwood-thorn-tangle-composite", "dry-scrub:crescent-open-south", 104, [[-1, 0]], "planar", "dry-scrub:deadwood-thorn-tangle-composite:south", "6c1bfccfcb815e454b547eea4f43c6b0800e50b6c24ecb4ca78a1bad513e5260"],
    ["deadwood-thorn-tangle-composite", "dry-scrub:crescent-open-side", 104, [[-1, 0]], "planar", "dry-scrub:deadwood-thorn-tangle-composite:east", "fe64aab44ee0cb2bc385a9021cd4e515e1aeaa18ab5fcbbd57e10319053085e8"],
    ["wind-scrub-clump-composite", "dry-scrub:horizontal-wind", 96, [], "planar", "dry-scrub:wind-scrub-clump-composite:none", "ae8d3ad4e3196f3fbf0b1e1b478f85fb6c5e46b3d88376bf85c212ac0edaefed"],
    ["wind-scrub-clump-composite", "dry-scrub:rising-diagonal-wind", 96, [], "planar", "dry-scrub:wind-scrub-clump-composite:none", "e7af57a46ccca1f999fb293f8301e41400e7df30a4b5a524a24c7680e6af04c1"],
    ["wind-scrub-clump-composite", "dry-scrub:falling-diagonal-wind", 96, [], "planar", "dry-scrub:wind-scrub-clump-composite:none", "5484af99901d42966daec159b80006330e1c9572c9c41bdb01c946993a9e39f3"],
  ],
  "ash-waste": [
    ["nuclear-crater-fissure-composite", "ash-waste:offset-crater-branching-fault", 64, [], "planar", "ash-waste:nuclear-crater-fissure-composite:none", "8c50c413c73349528fd833adbdc268229042e5925b5750d2b5520d2adb91e6c4"],
    ["nuclear-crater-fissure-composite", "ash-waste:split-crater-service-fracture", 64, [], "planar", "ash-waste:nuclear-crater-fissure-composite:east-west", "367ffa4c152a20ba9e4cf611784e4b611ccf4b4cf22be0b65354cb9f3255a04d"],
    ["fractured-industrial-pylon-composite", "ash-waste:snapped-cross-member", 116, [[-1, 0], [1, 0]], "tall-static-back-excluded", "ash-waste:fractured-industrial-pylon-composite:none", "861ada0e1f6ffbda7fe0f68de5d2c21db6b7a66af22cd101703163bd77683af4"],
    ["fractured-industrial-pylon-composite", "ash-waste:leaning-fractured-lattice", 116, [[-1, 0], [1, 0]], "tall-static-back-excluded", "ash-waste:fractured-industrial-pylon-composite:none", "2ec6e5f86d751b072584b3a58c7dd1a1cb9229fa4ebe9c1a1c91f5192b14d4e1"],
    ["slag-charred-ridge-composite", "ash-waste:slag-ridge-char-stumps", 104, [[-1, 0], [0, 0]], "planar", "ash-waste:slag-charred-ridge-composite:none", "bd9d32ab4b453240d0bc36db586dbe44c4577d2dd61c3299f5135ce7b0c4b541"],
    ["slag-charred-ridge-composite", "ash-waste:industrial-aggregate-ridge", 104, [[-1, 0], [0, 0]], "planar", "ash-waste:slag-charred-ridge-composite:none", "c010352c2906614806c8e4b4328ecec924072248cdc294cfa4114ffd74d4476b"],
    ["ash-debris-fan-composite", "ash-waste:narrow-directional-fan", 88, [], "planar", "ash-waste:ash-debris-fan-composite:east", "ae7cee68041502f6a11614daec9c546a8c12ffb73398c32a3ef0b7a5d66ecd40"],
    ["ash-debris-fan-composite", "ash-waste:joined-containment-debris-fan", 88, [], "planar", "ash-waste:ash-debris-fan-composite:east", "18a42433b247c2fbcbeea0605977f36dd7ddc536d09c8da66a1afa18de1f04ed"],
  ],
  "neutral-temperate": [
    ["restrained-broad-grove-composite", "neutral-temperate:broad-crown", 112, [[-1, 0], [1, 0]], "tall-static-back-excluded", "neutral-temperate:restrained-broad-grove-composite:none", "f5862f39b1dcfaa4ca50579151712ed89b7de0058470c94eb59bd3fba4b7c397"],
    ["restrained-broad-grove-composite", "neutral-temperate:paired-trees", 112, [[-1, 0], [1, 0]], "tall-static-back-excluded", "neutral-temperate:restrained-broad-grove-composite:none", "e1a91646a540c05f5b96d327c77f5457232ed42957f9d5dc633796f482cfeb1f"],
    ["restrained-broad-grove-composite", "neutral-temperate:sparse-open-grove", 112, [[-1, 0], [1, 0]], "tall-static-back-excluded", "neutral-temperate:restrained-broad-grove-composite:none", "c2c36c96730755c84fdab60b64ca46f9fa12e9c7afca472886dacdb1f2fcfef9"],
    ["field-rock-boundary-composite", "neutral-temperate:boundary-open-south", 96, [[-1, 0]], "planar", "neutral-temperate:field-rock-boundary-composite:south", "0ede08900376168d4bc7be76bdcfd5b92756338141161e629966f686f7f00ee5"],
    ["field-rock-boundary-composite", "neutral-temperate:boundary-open-side", 96, [[-1, 0]], "planar", "neutral-temperate:field-rock-boundary-composite:east", "0814eed137f6f67796e95468a39d527dedb011ff3d8ff6d1b91a12ca8279dfc4"],
    ["wildflower-verge-composite", "neutral-temperate:left-verge", 96, [], "planar", "neutral-temperate:wildflower-verge-composite:none", "272fd373c12ed66d55e350725c853c2bfccaf4d5b04bcbbd8b5016c96bccd9fb"],
    ["wildflower-verge-composite", "neutral-temperate:right-verge", 96, [], "planar", "neutral-temperate:wildflower-verge-composite:none", "adb8367761e0c18764e0de1b719db700780c31b21f7043e0f96327d9137853fd"],
    ["wildflower-verge-composite", "neutral-temperate:diagonal-verge", 96, [], "planar", "neutral-temperate:wildflower-verge-composite:none", "aadfebf49e5d7c036f2748990feb1b8b1e0b1318a043c77b8ed7f89665fa3b0b"],
  ],
} as const satisfies Readonly<Record<RegionKitId, readonly CompactLandmarkGeometry[]>>;

type CompactLandmarkNativeDetail = readonly [
  orientation: LandmarkOrientation,
  connectionPorts: readonly (readonly [
    side: LandmarkConnectionPort["side"],
    startPx: number,
    widthPx: number,
    role: LandmarkPortRole,
  ])[],
  opaqueComponentOrdinals: readonly number[],
  recognitionComponentOrdinals: readonly number[],
  opaqueBounds: readonly [x: number, y: number, width: number, height: number],
  recognitionBounds: readonly [x: number, y: number, width: number, height: number],
  recognitionTags: readonly string[],
];

const COMPACT_LANDMARK_NATIVE_DETAILS = {
  "worn-heartland": [
    ["none", [], [0], [0], [11, 0, 107, 112], [11, 0, 107, 112], ["asymmetric-old-oak", "root-mound"]],
    ["none", [], [0], [0], [12, 0, 104, 112], [12, 0, 104, 112], ["split-canopy", "three-grounded-trunks"]],
    ["none", [], [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], [0, 3, 6], [8, 0, 112, 112], [8, 0, 112, 112], ["wind-worn-canopy", "exposed-roots"]],
    ["south", [["south", 48, 32, "path"]], [0, 1], [0, 1], [0, 4, 128, 123], [0, 4, 128, 123], ["broken-fence", "open-south-port"]],
    ["east", [["east", 48, 32, "path"]], [0], [0], [6, 0, 117, 128], [6, 0, 117, 128], ["irregular-tilled-rows", "open-east-port"]],
    ["east-west", [["east", 48, 32, "path"], ["west", 48, 32, "path"]], [0, 1], [0, 1], [0, 6, 128, 120], [0, 6, 128, 120], ["reclaimed-boundary", "faded-flower-gaps"]],
    ["east-west", [["east", 48, 32, "path"], ["west", 48, 32, "path"]], [0], [0], [0, 6, 128, 120], [0, 6, 128, 120], ["eroded-shoulder", "rut-stones"]],
    ["north-south", [["north", 48, 32, "path"], ["south", 48, 32, "path"]], [0], [0], [11, 0, 107, 128], [11, 0, 107, 128], ["trampled-ribbon", "grass-eroded-edge"]],
  ],
  "spring-terraces": [
    ["none", [], [0], [0], [12, 28, 105, 85], [12, 28, 105, 85], ["connected-spring-terrace-composite"]],
    ["none", [], [0], [0], [12, 28, 105, 85], [12, 28, 105, 85], ["connected-spring-terrace-composite"]],
    ["south", [["south", 48, 32, "shore"]], [0], [0], [14, 35, 100, 71], [14, 35, 100, 71], ["spring-hillside-terrace-composite"]],
    ["east-west", [["east", 48, 32, "shore"], ["west", 48, 32, "shore"]], [0], [0], [12, 50, 105, 60], [12, 50, 105, 60], ["reed-bank-composite"]],
    ["none", [], [0], [0], [16, 8, 97, 109], [16, 8, 97, 109], ["wet-stone-willow-composite"]],
    ["none", [], [0], [0], [16, 8, 97, 109], [16, 8, 97, 109], ["wet-stone-willow-composite"]],
    ["north-south", [["north", 48, 32, "path"], ["south", 48, 32, "path"]], [0], [0], [19, 0, 91, 128], [19, 0, 91, 128], ["short-boardwalk-composite"]],
    ["east-west", [["east", 48, 32, "path"], ["west", 48, 32, "path"]], [0], [0], [0, 19, 128, 91], [0, 19, 128, 91], ["short-boardwalk-composite"]],
  ],
  "dry-scrub": [
    ["none", [], [0], [0], [8, 44, 112, 71], [8, 44, 112, 71], ["sun-rock-outcrop-composite"]],
    ["none", [], [0], [0], [9, 44, 112, 71], [9, 44, 112, 71], ["sun-rock-outcrop-composite"]],
    ["east-west", [["east", 48, 32, "cluster"], ["west", 48, 32, "cluster"]], [0], [0], [8, 44, 112, 71], [8, 44, 112, 71], ["sun-rock-outcrop-composite"]],
    ["south", [["south", 48, 32, "cluster"]], [0], [0], [13, 38, 103, 73], [13, 38, 103, 73], ["deadwood-thorn-tangle-composite"]],
    ["east", [["east", 48, 32, "cluster"]], [0], [0], [13, 38, 103, 73], [13, 38, 103, 73], ["deadwood-thorn-tangle-composite"]],
    ["none", [], [0], [0], [8, 67, 115, 49], [8, 67, 115, 49], ["wind-scrub-clump-composite"]],
    ["none", [], [0], [0], [8, 66, 115, 50], [8, 66, 115, 50], ["wind-scrub-clump-composite"]],
    ["none", [], [0], [0], [8, 67, 115, 49], [8, 67, 115, 49], ["wind-scrub-clump-composite"]],
  ],
  "ash-waste": [
    ["none", [], [0], [0], [0, 28, 128, 85], [0, 28, 128, 85], ["nuclear-crater-fissure-composite"]],
    ["east-west", [["east", 48, 32, "cluster"], ["west", 48, 32, "cluster"]], [0], [0], [0, 28, 128, 85], [0, 28, 128, 85], ["nuclear-crater-fissure-composite"]],
    ["none", [], [0, 1], [0, 1], [0, 5, 126, 116], [0, 5, 126, 116], ["fractured-industrial-lattice", "integrated-three-lobed-containment-relief"]],
    ["none", [], [0], [0], [2, 5, 124, 116], [2, 5, 124, 116], ["fractured-industrial-lattice", "integrated-three-lobed-containment-relief"]],
    ["none", [], [0], [0], [0, 28, 128, 92], [0, 28, 128, 92], ["slag-charred-ridge-composite"]],
    ["none", [], [0, 1], [0, 1], [0, 28, 128, 92], [0, 28, 128, 92], ["slag-charred-ridge-composite"]],
    ["east", [["east", 48, 32, "cluster"]], [0], [0], [0, 28, 128, 91], [0, 28, 128, 91], ["ash-debris-fan-composite"]],
    ["east", [["east", 48, 32, "cluster"]], [0], [0], [0, 28, 128, 91], [0, 28, 128, 91], ["joined-containment-debris", "integrated-three-lobed-containment-relief"]],
  ],
  "neutral-temperate": [
    ["none", [], [0], [0], [10, 12, 104, 103], [10, 12, 104, 103], ["restrained-broad-grove-composite"]],
    ["none", [], [0], [0], [10, 12, 104, 103], [10, 12, 104, 103], ["restrained-broad-grove-composite"]],
    ["none", [], [0], [0], [10, 12, 104, 103], [10, 12, 104, 103], ["restrained-broad-grove-composite"]],
    ["south", [["south", 48, 32, "cluster"]], [0, 1], [0, 1], [3, 33, 121, 73], [3, 33, 121, 73], ["field-rock-boundary-composite"]],
    ["east", [["east", 48, 32, "cluster"]], [0], [0], [6, 38, 113, 68], [6, 38, 113, 68], ["field-rock-boundary-composite"]],
    ["none", [], [0, 1], [0, 1], [7, 66, 114, 50], [7, 66, 114, 50], ["wildflower-verge-composite"]],
    ["none", [], [0], [0], [7, 67, 114, 49], [7, 67, 114, 49], ["wildflower-verge-composite"]],
    ["none", [], [0], [0], [7, 67, 114, 49], [7, 67, 114, 49], ["wildflower-verge-composite"]],
  ],
} as const satisfies Readonly<Record<RegionKitId, readonly CompactLandmarkNativeDetail[]>>;

/** Native landmark PNG pixel digests; geometry is invalid if its owning atlas differs. */
export const LANDMARK_ATLAS_PIXEL_SHA256_BY_KIT: Readonly<Record<RegionKitId, string>> = Object.freeze({
  "worn-heartland": "e66db44bc88e532189562826b100de7afc389703e7ee9528b47b3f768e444957",
  "spring-terraces": "8bc44603a7a2100446f59635e617b1c5a3e3e6ba395b428d9ec36cc0410e3917",
  "dry-scrub": "55150f6eb36e1be22d7f9b2fe7896ec6839cb069f04deccdb5048bcd6ecc97c6",
  "ash-waste": "1b24d1473dc3452f3e5f31e2f1cab38a40db06bc8bfff08338fbdbe22c2a70c5",
  "neutral-temperate": "8530342a1c550e7c4daae9212f43d0ec10385f69f1ce8e46cfbed80a4a4e2eda",
});

const TALL_INTERACTION_EXCLUSIONS: readonly Vec2[] = Object.freeze(
  Array.from({ length: 4 }, (_unused, row) => Array.from({ length: 4 }, (_other, column) =>
    Object.freeze({ x: column - 2, y: row - 3 }))).flat(),
);

function freezeGeometry(
  kitId: RegionKitId,
  cellIndex: number,
  compact: CompactLandmarkGeometry,
  detail: CompactLandmarkNativeDetail,
): AuthoredLandmarkVariantGeometry {
  const [semanticKind, variantId, contactPivotY, hardOffsets, heightPolicy, topologyKey, geometryHash] = compact;
  const [
    orientation,
    connectionPorts,
    opaqueComponentOrdinals,
    recognitionComponentOrdinals,
    opaqueBounds,
    recognitionBounds,
    recognitionTags,
  ] = detail;
  const tall = heightPolicy === "tall-static-back-excluded";
  const rect = (values: readonly [number, number, number, number]): Rect => Object.freeze({
    x: values[0],
    y: values[1],
    width: values[2],
    height: values[3],
  });
  const ground = `${kitId}:ground`;
  return Object.freeze({
    kitId,
    semanticKind,
    variantId,
    cellIndex,
    cellRectPx: Object.freeze({
      x: (cellIndex % 4) * 128,
      y: Math.floor(cellIndex / 4) * 128,
      width: 128,
      height: 128,
    }),
    orientation,
    connectionPorts: Object.freeze(connectionPorts.map(([side, startPx, widthPx, role]) =>
      Object.freeze({ side, startPx, widthPx, role }))),
    compatibleAdjacency: Object.freeze({ north: ground, east: ground, south: ground, west: ground }),
    eligibleTopologyKeys: Object.freeze([topologyKey]),
    contactPivotPx: Object.freeze({ x: 64, y: contactPivotY }),
    opaqueComponentOrdinals: Object.freeze([...opaqueComponentOrdinals]),
    recognitionComponentOrdinals: Object.freeze([...recognitionComponentOrdinals]),
    opaqueBoundsPx: rect(opaqueBounds),
    recognitionBoundsPx: rect(recognitionBounds),
    visualFootprint: Object.freeze({
      originOffsetTiles: Object.freeze({ x: -2, y: tall ? -3 : -2 }),
      widthTiles: 4,
      heightTiles: 4,
    }),
    hardOffsets: Object.freeze(hardOffsets.map(([x, y]) => Object.freeze({ x, y }))),
    interactionExclusionOffsets: tall ? TALL_INTERACTION_EXCLUSIONS : Object.freeze([]),
    drawLayer: "static-back",
    heightPolicy,
    recognitionTags: Object.freeze([...recognitionTags]),
    topologyKey,
    geometryHash,
  });
}

/** Exact immutable native geometry, indexed by owning region kit and atlas cell. */
export const AUTHORED_LANDMARK_VARIANTS_BY_KIT: Readonly<
  Record<RegionKitId, readonly AuthoredLandmarkVariantGeometry[]>
> = Object.freeze(Object.fromEntries(
  (Object.entries(COMPACT_LANDMARK_GEOMETRY) as Array<[
    RegionKitId,
    readonly CompactLandmarkGeometry[],
  ]>).map(([kitId, variants]) => [
    kitId,
    Object.freeze(variants.map((variant, cellIndex) => freezeGeometry(
      kitId,
      cellIndex,
      variant,
      COMPACT_LANDMARK_NATIVE_DETAILS[kitId][cellIndex]!,
    ))),
  ]),
) as Record<RegionKitId, readonly AuthoredLandmarkVariantGeometry[]>);
