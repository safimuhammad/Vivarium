/**
 * Immutable Task 12R R4 regional-art recipes and proof-scene plans.
 *
 * This module is deliberately inert: it owns reviewable integer data, performs no
 * filesystem work, and exposes no drawing or fallback behavior.
 */

const EXPECTED_KITS = [
  "worn-heartland",
  "spring-terraces",
  "dry-scrub",
  "ash-waste",
  "neutral-temperate",
];

const EXPECTED_LANDMARK_COUNTS = {
  "worn-heartland": {
    "old-oak-grove-composite": 3,
    "broken-fence-garden-composite": 3,
    "reclaimed-path-shoulder-composite": 2,
  },
  "spring-terraces": {
    "connected-spring-terrace-composite": 2,
    "spring-hillside-terrace-composite": 1,
    "reed-bank-composite": 1,
    "wet-stone-willow-composite": 2,
    "short-boardwalk-composite": 2,
  },
  "dry-scrub": {
    "sun-rock-outcrop-composite": 3,
    "deadwood-thorn-tangle-composite": 2,
    "wind-scrub-clump-composite": 3,
  },
  "ash-waste": {
    "nuclear-crater-fissure-composite": 2,
    "fractured-industrial-pylon-composite": 2,
    "slag-charred-ridge-composite": 2,
    "ash-debris-fan-composite": 2,
  },
  "neutral-temperate": {
    "restrained-broad-grove-composite": 3,
    "field-rock-boundary-composite": 2,
    "wildflower-verge-composite": 3,
  },
};

const EXPECTED_YARDS = [
  "standing-a-base",
  "standing-b-base",
  "warm-overlay",
  "durable-hoarding-overlay",
  "persistent-ruin-base",
];

const MATERIALS = {
  "worn-heartland": new Set([
    "olive-dark", "olive-mid", "olive-light", "ochre-earth", "worn-beige", "timber", "faded-flower", "hearth-amber",
  ]),
  "spring-terraces": new Set([
    "mint-dark", "mint-mid", "mineral-stone", "deep-aqua", "shallow-aqua", "reed", "wet-timber", "warm-reflection",
  ]),
  "dry-scrub": new Set([
    "ochre-dark", "ochre-mid", "sand-light", "sandstone", "deadwood", "thorn", "warm-clay", "brazier-amber",
  ]),
  "ash-waste": new Set([
    "plum-ash", "charcoal", "coral-fissure", "oxidized-metal", "containment-concrete", "slag", "vent-warm",
  ]),
  "neutral-temperate": new Set([
    "sage-dark", "sage-mid", "blue-green", "pale-lane", "damp-verge", "field-stone", "wildflower", "window-amber",
  ]),
};

const NATIVE_LANDMARK_IDENTITIES = {
  "worn-heartland": [
    { variantId: "worn-heartland:broad-crown", cell: 0, contactPivotPx: { x: 64, y: 112 }, semanticKind: "old-oak-grove-composite" },
    { variantId: "worn-heartland:split-crown", cell: 1, contactPivotPx: { x: 64, y: 112 }, semanticKind: "old-oak-grove-composite" },
    { variantId: "worn-heartland:wind-worn-crown", cell: 2, contactPivotPx: { x: 64, y: 112 }, semanticKind: "old-oak-grove-composite" },
    { variantId: "worn-heartland:open-south-gap", cell: 3, contactPivotPx: { x: 64, y: 96 }, semanticKind: "broken-fence-garden-composite" },
    { variantId: "worn-heartland:open-east-gap", cell: 4, contactPivotPx: { x: 64, y: 96 }, semanticKind: "broken-fence-garden-composite" },
    { variantId: "worn-heartland:diagonal-reclaimed-boundary", cell: 5, contactPivotPx: { x: 64, y: 96 }, semanticKind: "broken-fence-garden-composite" },
    { variantId: "worn-heartland:left-right-shoulder", cell: 6, contactPivotPx: { x: 64, y: 96 }, semanticKind: "reclaimed-path-shoulder-composite" },
    { variantId: "worn-heartland:top-bottom-shoulder", cell: 7, contactPivotPx: { x: 64, y: 96 }, semanticKind: "reclaimed-path-shoulder-composite" },
  ],
  "spring-terraces": [
    { variantId: "spring-terraces:curved-pool-rim", cell: 0, contactPivotPx: { x: 64, y: 80 }, semanticKind: "connected-spring-terrace-composite" },
    { variantId: "spring-terraces:stepped-pool-rim", cell: 1, contactPivotPx: { x: 64, y: 80 }, semanticKind: "connected-spring-terrace-composite" },
    { variantId: "spring-terraces:two-wet-stone-levels", cell: 2, contactPivotPx: { x: 64, y: 96 }, semanticKind: "spring-hillside-terrace-composite" },
    { variantId: "spring-terraces:broken-sight-gap", cell: 3, contactPivotPx: { x: 64, y: 96 }, semanticKind: "reed-bank-composite" },
    { variantId: "spring-terraces:willow-left", cell: 4, contactPivotPx: { x: 64, y: 112 }, semanticKind: "wet-stone-willow-composite" },
    { variantId: "spring-terraces:willow-right", cell: 5, contactPivotPx: { x: 64, y: 112 }, semanticKind: "wet-stone-willow-composite" },
    { variantId: "spring-terraces:north-south-planks", cell: 6, contactPivotPx: { x: 64, y: 64 }, semanticKind: "short-boardwalk-composite" },
    { variantId: "spring-terraces:east-west-planks", cell: 7, contactPivotPx: { x: 64, y: 64 }, semanticKind: "short-boardwalk-composite" },
  ],
  "dry-scrub": [
    { variantId: "dry-scrub:low-stepped-ridge", cell: 0, contactPivotPx: { x: 64, y: 104 }, semanticKind: "sun-rock-outcrop-composite" },
    { variantId: "dry-scrub:split-outcrop", cell: 1, contactPivotPx: { x: 64, y: 104 }, semanticKind: "sun-rock-outcrop-composite" },
    { variantId: "dry-scrub:wind-cut-diagonal-ridge", cell: 2, contactPivotPx: { x: 64, y: 104 }, semanticKind: "sun-rock-outcrop-composite" },
    { variantId: "dry-scrub:crescent-open-south", cell: 3, contactPivotPx: { x: 64, y: 104 }, semanticKind: "deadwood-thorn-tangle-composite" },
    { variantId: "dry-scrub:crescent-open-side", cell: 4, contactPivotPx: { x: 64, y: 104 }, semanticKind: "deadwood-thorn-tangle-composite" },
    { variantId: "dry-scrub:horizontal-wind", cell: 5, contactPivotPx: { x: 64, y: 96 }, semanticKind: "wind-scrub-clump-composite" },
    { variantId: "dry-scrub:rising-diagonal-wind", cell: 6, contactPivotPx: { x: 64, y: 96 }, semanticKind: "wind-scrub-clump-composite" },
    { variantId: "dry-scrub:falling-diagonal-wind", cell: 7, contactPivotPx: { x: 64, y: 96 }, semanticKind: "wind-scrub-clump-composite" },
  ],
  "ash-waste": [
    { variantId: "ash-waste:offset-crater-branching-fault", cell: 0, contactPivotPx: { x: 64, y: 64 }, semanticKind: "nuclear-crater-fissure-composite" },
    { variantId: "ash-waste:split-crater-service-fracture", cell: 1, contactPivotPx: { x: 64, y: 64 }, semanticKind: "nuclear-crater-fissure-composite" },
    { variantId: "ash-waste:snapped-cross-member", cell: 2, contactPivotPx: { x: 64, y: 116 }, semanticKind: "fractured-industrial-pylon-composite" },
    { variantId: "ash-waste:leaning-fractured-lattice", cell: 3, contactPivotPx: { x: 64, y: 116 }, semanticKind: "fractured-industrial-pylon-composite" },
    { variantId: "ash-waste:slag-ridge-char-stumps", cell: 4, contactPivotPx: { x: 64, y: 104 }, semanticKind: "slag-charred-ridge-composite" },
    { variantId: "ash-waste:industrial-aggregate-ridge", cell: 5, contactPivotPx: { x: 64, y: 104 }, semanticKind: "slag-charred-ridge-composite" },
    { variantId: "ash-waste:narrow-directional-fan", cell: 6, contactPivotPx: { x: 64, y: 88 }, semanticKind: "ash-debris-fan-composite" },
    { variantId: "ash-waste:joined-containment-debris-fan", cell: 7, contactPivotPx: { x: 64, y: 88 }, semanticKind: "ash-debris-fan-composite" },
  ],
  "neutral-temperate": [
    { variantId: "neutral-temperate:broad-crown", cell: 0, contactPivotPx: { x: 64, y: 112 }, semanticKind: "restrained-broad-grove-composite" },
    { variantId: "neutral-temperate:paired-trees", cell: 1, contactPivotPx: { x: 64, y: 112 }, semanticKind: "restrained-broad-grove-composite" },
    { variantId: "neutral-temperate:sparse-open-grove", cell: 2, contactPivotPx: { x: 64, y: 112 }, semanticKind: "restrained-broad-grove-composite" },
    { variantId: "neutral-temperate:boundary-open-south", cell: 3, contactPivotPx: { x: 64, y: 96 }, semanticKind: "field-rock-boundary-composite" },
    { variantId: "neutral-temperate:boundary-open-side", cell: 4, contactPivotPx: { x: 64, y: 96 }, semanticKind: "field-rock-boundary-composite" },
    { variantId: "neutral-temperate:left-verge", cell: 5, contactPivotPx: { x: 64, y: 96 }, semanticKind: "wildflower-verge-composite" },
    { variantId: "neutral-temperate:right-verge", cell: 6, contactPivotPx: { x: 64, y: 96 }, semanticKind: "wildflower-verge-composite" },
    { variantId: "neutral-temperate:diagonal-verge", cell: 7, contactPivotPx: { x: 64, y: 96 }, semanticKind: "wildflower-verge-composite" },
  ],
};

const NATIVE_LANDMARK_BY_ID = new Map(
  Object.values(NATIVE_LANDMARK_IDENTITIES).flat().map((entry) => [entry.variantId, entry]),
);

const SCENERY_KIND_BASES = {
  "worn-heartland": { "old-oak": 0, "worn-stone": 1, "faded-flower": 2, "fallen-fence": 3 },
  "spring-terraces": { "terrace-rock": 0, willow: 1, "spring-flower": 2, "reed-bed": 3 },
  "dry-scrub": { "sun-rock": 0, deadwood: 1, "dry-grass": 2, thorn: 3 },
  "ash-waste": { "charred-trunk": 0, "slag-rock": 1, "ash-pile": 2, "bone-stone": 3 },
  "neutral-temperate": { "broad-tree": 0, "field-rock": 1, wildflower: 2, "soft-grass": 3 },
};

const MAX_CROSS_KIT_GROUND_SIMILARITY = 0.92;
const MAX_GROUND_GRID_AUTOCORRELATION = 0.35;
const MAX_GROUND_GRID_ADJACENCY = 0.22;
const MAX_GROUND_GRID_FAMILY_TRANSITIONS = 0.16;

const EXPECTED_GROUND_FAMILY_MASK_ROWS = {
  "worn-heartland": [
    "000000000000000000000000",
    "000000000000000000000000",
    "000000110000000000011000",
    "000011111000000000111000",
    "000111111100000001111100",
    "001111111100000001111100",
    "001111111110000001111100",
    "001111111110000000111100",
    "000111111110000000111100",
    "000011111100000001111000",
    "000001111000000011111000",
    "000000110000000111111000",
    "000000000000001111111000",
    "000000000000011111110000",
    "000000000000111111100000",
    "000000000001111111000000",
  ],
  "spring-terraces": [
    "000000000000000000000000",
    "000000000000000000000000",
    "000001100000000001100000",
    "000011110000000011100000",
    "000111111000000111100000",
    "001111111100000111110000",
    "011111111110000011110000",
    "011111111110000011111000",
    "001111111100000011111000",
    "000111111000000111110000",
    "000011110000001111110000",
    "000001100000011111110000",
    "000000000000111111100000",
    "000000000001111111000000",
    "000000000011111110000000",
    "000000000111111100000000",
  ],
  "dry-scrub": [
    "000000000000000000000000",
    "000000000000000000000000",
    "000000111000000000011100",
    "000001111100000000111100",
    "000011111100000001111100",
    "000111111110000011111100",
    "001111111110000011111000",
    "011111111110000001111100",
    "001111111100000011111000",
    "000111111000000111111000",
    "000011110000001111110000",
    "000001100000011111110000",
    "000000000000111111100000",
    "000000000001111111000000",
    "000000000011111110000000",
    "000000000111111100000000",
  ],
  "ash-waste": [
    "000000000000000000000000",
    "000000000000000000000000",
    "000001110000000000111000",
    "000011111000000001111000",
    "000111111100000011111000",
    "001111111110000111111000",
    "011111111110000111111000",
    "011111111110000011111100",
    "001111111100000011111000",
    "000111111000000111111000",
    "000011110000001111110000",
    "000001100000011111110000",
    "000000000000111111100000",
    "000000000001111111000000",
    "000000000011111110000000",
    "000000000111111100000000",
  ],
  "neutral-temperate": [
    "000000000000000000000000",
    "000000000000000000000000",
    "000001100000000001100000",
    "000011110000000011100000",
    "000111111000000111100000",
    "001111111100001111110000",
    "011111111110000111111000",
    "011111111110000011111000",
    "001111111100000011111000",
    "000111111000000111110000",
    "000011110000001111110000",
    "000001100000011111110000",
    "000000000000111111100000",
    "000000000001111111000000",
    "000000000011111110000000",
    "000000000111111100000000",
  ],
};

function operation(kind, material, points) {
  return { kind, material, points };
}

function groundRecipe(id, kit, profile, primary, secondary) {
  return {
    id,
    semanticKind: `${kit}-ground`,
    topologyKey: "ground",
    recognitionTags: [profile === "calm" ? "broad-value-mass" : "clustered-material", `${kit}-terrain`],
    materialFamily: `${kit}:${profile}-ground`,
    operations: [
      operation("polygon", [...MATERIALS[kit]][profile === "calm" ? 1 : 0], primary),
      operation("cluster", [...MATERIALS[kit]][2], secondary),
    ],
  };
}

function landmarkRecipe(id, semanticKind, topologyKey, kit, tags, primary, secondary) {
  const nativeIdentity = NATIVE_LANDMARK_BY_ID.get(id);
  if (!nativeIdentity) throw new Error(`Unknown native landmark identity ${id}`);
  return {
    id,
    cell: nativeIdentity.cell,
    contactPivotPx: { ...nativeIdentity.contactPivotPx },
    semanticKind,
    topologyKey,
    recognitionTags: tags,
    materialFamily: `${kit}:landmark`,
    operations: [
      operation("polygon", [...MATERIALS[kit]][0], primary),
      operation("cluster", [...MATERIALS[kit]][3], secondary),
    ],
  };
}

function yardRecipe(id, semanticKind, kit, tags, primary, secondary, materials = [1, 3]) {
  return {
    id,
    semanticKind,
    topologyKey: "home:south-door",
    recognitionTags: tags,
    materialFamily: `${kit}:yard`,
    operations: [
      operation(semanticKind.includes("overlay") ? "cluster" : "polygon", [...MATERIALS[kit]][materials[0]], primary),
      operation("cluster", [...MATERIALS[kit]][materials[1]], secondary),
    ],
  };
}

const WORN_GROUND_RECIPES = [
  groundRecipe("worn:ground:calm-root-shadow", "worn-heartland", "calm", [[1, 4], [9, 2], [17, 5], [12, 10], [3, 9]], [[21, 22], [25, 21]]),
  groundRecipe("worn:ground:calm-tuft-bank", "worn-heartland", "calm", [[2, 17], [6, 12], [15, 13], [20, 19], [11, 23], [4, 22]], [[24, 5], [27, 7], [25, 9]]),
  groundRecipe("worn:ground:calm-ochre-wear", "worn-heartland", "calm", [[2, 9], [8, 5], [17, 7], [25, 5], [30, 10], [24, 13], [15, 11], [7, 14]], [[20, 25], [26, 22], [30, 26], [24, 29]]),
  groundRecipe("worn:ground:calm-meadow-break", "worn-heartland", "calm", [[3, 22], [8, 16], [16, 17], [21, 24], [17, 29], [7, 28], [2, 25]], [[24, 4], [26, 5], [29, 8], [27, 10], [23, 8]]),
  groundRecipe("worn:ground:cluster-rutted-soil", "worn-heartland", "clustered", [[2, 6], [7, 2], [15, 3], [21, 8], [18, 14], [10, 16], [4, 12]], [[23, 19], [29, 18], [27, 23]]),
  groundRecipe("worn:ground:cluster-stone-tuft", "worn-heartland", "clustered", [[1, 19], [5, 14], [12, 12], [19, 15], [23, 21], [16, 27], [8, 28], [3, 24]], [[25, 4], [29, 6], [28, 11], [23, 10]]),
  groundRecipe("worn:ground:cluster-faded-bloom", "worn-heartland", "clustered", [[5, 5], [12, 1], [20, 4], [25, 10], [22, 17], [14, 20], [6, 17], [2, 11]], [[7, 25], [12, 23], [16, 27], [11, 30]]),
  groundRecipe("worn:ground:cluster-eroded-shoulder", "worn-heartland", "clustered", [[2, 25], [4, 18], [10, 13], [18, 11], [25, 15], [29, 22], [24, 28], [14, 30], [7, 29]], [[21, 3], [26, 4], [29, 9], [24, 12], [19, 8]]),
];

const SPRING_GROUND_RECIPES = [
  groundRecipe("spring:ground:calm-mint-shelf", "spring-terraces", "calm", [[2, 5], [10, 2], [18, 4], [20, 10], [12, 12], [4, 10]], [[24, 22], [27, 20]]),
  groundRecipe("spring:ground:calm-mineral-sheen", "spring-terraces", "calm", [[3, 18], [8, 13], [16, 12], [21, 17], [18, 23], [10, 26], [4, 23]], [[24, 5], [29, 7], [26, 10]]),
  groundRecipe("spring:ground:calm-damp-moss", "spring-terraces", "calm", [[5, 3], [14, 2], [21, 7], [19, 14], [11, 16], [4, 12]], [[23, 24], [28, 22], [29, 27], [25, 29]]),
  groundRecipe("spring:ground:calm-cool-clearing", "spring-terraces", "calm", [[2, 23], [7, 17], [15, 15], [23, 19], [26, 25], [19, 29], [9, 28], [3, 26]], [[23, 3], [28, 5], [29, 9], [25, 12], [21, 8]]),
  groundRecipe("spring:ground:cluster-wet-pebble", "spring-terraces", "clustered", [[1, 7], [6, 2], [14, 3], [20, 8], [18, 15], [9, 17], [3, 13]], [[23, 18], [28, 17], [30, 21]]),
  groundRecipe("spring:ground:cluster-runnel-silt", "spring-terraces", "clustered", [[2, 20], [6, 14], [13, 11], [20, 14], [25, 20], [21, 27], [12, 29], [5, 26]], [[24, 4], [29, 6], [27, 12], [22, 10]]),
  groundRecipe("spring:ground:cluster-reed-shadow", "spring-terraces", "clustered", [[4, 5], [11, 1], [19, 3], [25, 9], [23, 16], [16, 21], [8, 19], [2, 13]], [[6, 25], [11, 22], [16, 25], [13, 30]]),
  groundRecipe("spring:ground:cluster-terrace-chips", "spring-terraces", "clustered", [[2, 4], [12, 2], [18, 6], [15, 12], [22, 16], [30, 14], [29, 24], [20, 29], [9, 27], [4, 19]], [[3, 30], [8, 24], [16, 31], [25, 25], [30, 29]]),
];

const DRY_GROUND_RECIPES = [
  groundRecipe("dry:ground:calm-wind-flat", "dry-scrub", "calm", [[1, 6], [8, 2], [16, 4], [19, 10], [11, 12], [3, 10]], [[24, 23], [28, 21]]),
  groundRecipe("dry:ground:calm-sand-shelf", "dry-scrub", "calm", [[2, 18], [7, 12], [15, 11], [22, 16], [19, 23], [10, 26], [3, 23]], [[24, 4], [29, 7], [26, 11]]),
  groundRecipe("dry:ground:calm-crack-pan", "dry-scrub", "calm", [[3, 3], [12, 1], [23, 5], [16, 9], [8, 7], [3, 12]], [[21, 26], [27, 21], [30, 25], [25, 30]]),
  groundRecipe("dry:ground:calm-drift-break", "dry-scrub", "calm", [[2, 24], [6, 18], [14, 15], [22, 18], [27, 24], [20, 29], [10, 30], [3, 27]], [[22, 3], [27, 4], [30, 8], [26, 12], [21, 9]]),
  groundRecipe("dry:ground:cluster-pebble-fan", "dry-scrub", "clustered", [[1, 8], [5, 3], [13, 2], [21, 7], [19, 15], [10, 18], [3, 14]], [[23, 18], [29, 17], [30, 22]]),
  groundRecipe("dry:ground:cluster-thorn-shadow", "dry-scrub", "clustered", [[2, 21], [5, 15], [12, 11], [20, 13], [26, 19], [23, 27], [13, 30], [5, 27]], [[23, 3], [29, 5], [28, 11], [22, 10]]),
  groundRecipe("dry:ground:cluster-wind-ripple", "dry-scrub", "clustered", [[3, 5], [10, 1], [19, 2], [26, 8], [24, 16], [17, 22], [8, 20], [1, 14]], [[5, 26], [10, 23], [16, 26], [12, 30]]),
  groundRecipe("dry:ground:cluster-stone-drift", "dry-scrub", "clustered", [[1, 27], [3, 20], [8, 14], [16, 10], [24, 12], [30, 19], [28, 27], [19, 31], [8, 30]], [[19, 4], [24, 2], [29, 6], [30, 11], [23, 13]]),
];

const ASH_GROUND_RECIPES = [
  groundRecipe("ash:ground:calm-plum-drift", "ash-waste", "calm", [[1, 5], [9, 1], [17, 3], [21, 9], [13, 13], [4, 10]], [[24, 22], [29, 20]]),
  groundRecipe("ash:ground:calm-service-dust", "ash-waste", "calm", [[2, 19], [6, 13], [14, 10], [22, 15], [20, 23], [11, 27], [3, 24]], [[24, 4], [30, 6], [26, 11]]),
  groundRecipe("ash:ground:calm-char-bed", "ash-waste", "calm", [[4, 3], [12, 1], [21, 5], [20, 13], [13, 18], [5, 14]], [[22, 24], [27, 21], [31, 24], [28, 29]]),
  groundRecipe("ash:ground:calm-containment-clear", "ash-waste", "calm", [[1, 24], [5, 17], [13, 14], [22, 17], [28, 23], [22, 29], [11, 31], [3, 28]], [[21, 3], [27, 3], [30, 8], [26, 13], [20, 10]]),
  groundRecipe("ash:ground:cluster-slag-chip", "ash-waste", "clustered", [[1, 7], [5, 2], [14, 1], [22, 6], [20, 15], [11, 19], [3, 15]], [[23, 18], [29, 16], [31, 21]]),
  groundRecipe("ash:ground:cluster-coral-fracture", "ash-waste", "clustered", [[1, 4], [7, 1], [12, 8], [18, 5], [22, 11], [30, 8], [28, 17], [21, 20], [25, 29], [17, 31], [12, 24], [5, 27], [8, 18], [2, 14]], [[2, 31], [7, 23], [13, 17], [19, 11], [25, 4], [31, 1]]),
  groundRecipe("ash:ground:cluster-conduit-scar", "ash-waste", "clustered", [[2, 2], [8, 1], [11, 10], [17, 12], [22, 5], [29, 7], [26, 16], [31, 23], [23, 29], [15, 25], [9, 31], [5, 22], [1, 17], [6, 12]], [[3, 28], [10, 20], [17, 15], [24, 10], [30, 2]]),
  groundRecipe("ash:ground:cluster-ejecta-fan", "ash-waste", "clustered", [[1, 30], [3, 21], [7, 13], [12, 7], [18, 3], [22, 9], [25, 15], [31, 18], [28, 25], [21, 24], [15, 31]], [[2, 6], [8, 2], [12, 13], [18, 17], [24, 28], [30, 31]]),
];

const NEUTRAL_GROUND_RECIPES = [
  groundRecipe("neutral:ground:calm-sage-meadow", "neutral-temperate", "calm", [[1, 4], [8, 1], [16, 3], [20, 9], [12, 13], [3, 10]], [[24, 21], [29, 19]]),
  groundRecipe("neutral:ground:calm-damp-verge", "neutral-temperate", "calm", [[2, 18], [6, 12], [14, 9], [22, 14], [21, 22], [12, 27], [3, 24]], [[24, 3], [30, 6], [26, 11]]),
  groundRecipe("neutral:ground:calm-field-break", "neutral-temperate", "calm", [[2, 10], [7, 5], [15, 3], [24, 6], [30, 12], [26, 18], [18, 16], [12, 22], [5, 19]], [[2, 27], [8, 25], [15, 29], [23, 26], [30, 30]]),
  groundRecipe("neutral:ground:calm-blue-clearing", "neutral-temperate", "calm", [[1, 23], [5, 16], [13, 13], [22, 16], [29, 23], [23, 29], [12, 31], [3, 28]], [[20, 3], [26, 2], [30, 7], [27, 13], [20, 10]]),
  groundRecipe("neutral:ground:cluster-field-stone", "neutral-temperate", "clustered", [[1, 2], [10, 1], [16, 6], [13, 12], [20, 16], [29, 13], [31, 20], [25, 28], [15, 30], [8, 25], [3, 17], [7, 10]], [[2, 30], [9, 21], [17, 25], [24, 8], [30, 3]]),
  groundRecipe("neutral:ground:cluster-wildflower-gap", "neutral-temperate", "clustered", [[2, 22], [4, 15], [11, 10], [20, 11], [28, 18], [26, 27], [15, 31], [5, 28]], [[23, 3], [29, 5], [30, 12], [22, 10]]),
  groundRecipe("neutral:ground:cluster-hedge-shadow", "neutral-temperate", "clustered", [[3, 4], [10, 1], [19, 2], [28, 8], [26, 16], [19, 23], [8, 21], [1, 14]], [[5, 26], [10, 22], [17, 25], [13, 31]]),
  groundRecipe("neutral:ground:cluster-lane-chip", "neutral-temperate", "clustered", [[1, 27], [3, 20], [8, 13], [16, 9], [25, 10], [31, 17], [30, 27], [21, 31], [8, 30]], [[18, 4], [24, 1], [30, 5], [31, 11], [23, 14]]),
];

const WORN_LANDMARK_RECIPES = [
  landmarkRecipe("worn-heartland:broad-crown", "old-oak-grove-composite", "none", "worn-heartland", ["asymmetric-old-oak", "root-mound"], [[7, 93], [18, 61], [42, 28], [77, 17], [116, 48], [121, 91]], [[31, 107], [43, 56], [63, 111], [73, 49]]),
  landmarkRecipe("worn-heartland:split-crown", "old-oak-grove-composite", "none", "worn-heartland", ["split-canopy", "three-grounded-trunks"], [[5, 88], [15, 49], [39, 20], [62, 34], [81, 15], [115, 43], [122, 96]], [[26, 106], [38, 62], [66, 110], [79, 55], [101, 108]]),
  landmarkRecipe("worn-heartland:wind-worn-crown", "old-oak-grove-composite", "none", "worn-heartland", ["wind-worn-canopy", "exposed-roots"], [[4, 98], [11, 62], [29, 31], [55, 18], [83, 25], [105, 18], [124, 55], [117, 103]], [[23, 108], [39, 69], [58, 113], [74, 62], [94, 108], [103, 57]]),
  landmarkRecipe("worn-heartland:open-south-gap", "broken-fence-garden-composite", "south-gap", "worn-heartland", ["broken-fence", "open-south-port"], [[11, 42], [109, 36], [119, 104], [77, 116], [16, 108]], [[17, 48], [17, 103], [48, 103], [82, 103], [112, 103]]),
  landmarkRecipe("worn-heartland:open-east-gap", "broken-fence-garden-composite", "east-gap", "worn-heartland", ["irregular-tilled-rows", "open-east-port"], [[9, 37], [91, 31], [117, 57], [109, 111], [53, 117], [13, 99]], [[16, 44], [16, 108], [75, 108], [111, 78]]),
  landmarkRecipe("worn-heartland:diagonal-reclaimed-boundary", "broken-fence-garden-composite", "diagonal", "worn-heartland", ["reclaimed-boundary", "faded-flower-gaps"], [[8, 105], [20, 67], [47, 42], [76, 51], [101, 24], [121, 43], [111, 91]], [[13, 100], [49, 65], [78, 57], [113, 31], [118, 72]]),
  landmarkRecipe("worn-heartland:left-right-shoulder", "reclaimed-path-shoulder-composite", "east-west", "worn-heartland", ["eroded-shoulder", "rut-stones"], [[0, 47], [31, 43], [62, 51], [93, 44], [127, 49], [127, 82], [91, 77], [60, 84], [28, 76], [0, 80]], [[12, 60], [38, 57], [69, 63], [99, 57]]),
  landmarkRecipe("worn-heartland:top-bottom-shoulder", "reclaimed-path-shoulder-composite", "north-south", "worn-heartland", ["trampled-ribbon", "grass-eroded-edge"], [[47, 0], [80, 0], [77, 30], [85, 62], [78, 96], [81, 127], [45, 127], [50, 96], [43, 63], [50, 29]], [[59, 12], [55, 43], [62, 76], [56, 108], [73, 119]]),
];

const SPRING_LANDMARK_RECIPES = [
  landmarkRecipe("spring-terraces:curved-pool-rim", "connected-spring-terrace-composite", "shore-inlet", "spring-terraces", ["stepped-basin", "visible-inlet-outlet"], [[6, 67], [17, 36], [46, 20], [83, 23], [112, 42], [123, 72], [107, 104], [69, 116], [28, 103]], [[18, 75], [41, 49], [76, 42], [104, 64], [88, 91]]),
  landmarkRecipe("spring-terraces:stepped-pool-rim", "connected-spring-terrace-composite", "shore-outlet", "spring-terraces", ["mineral-depth-edge", "stepped-outlet"], [[8, 59], [25, 28], [60, 18], [91, 29], [119, 54], [116, 88], [92, 110], [52, 118], [21, 99], [7, 77]], [[29, 72], [51, 45], [83, 46], [104, 69], [84, 96], [47, 98]]),
  landmarkRecipe("spring-terraces:two-wet-stone-levels", "spring-hillside-terrace-composite", "south", "spring-terraces", ["mossy-risers", "drainage-runnel"], [[9, 34], [116, 27], [121, 55], [106, 69], [116, 91], [28, 106], [11, 86]], [[62, 31], [69, 54], [61, 78], [70, 106]]),
  landmarkRecipe("spring-terraces:broken-sight-gap", "reed-bank-composite", "east-west", "spring-terraces", ["shore-shaped-bank", "broken-sight-gap"], [[2, 91], [16, 69], [43, 65], [62, 79], [88, 68], [115, 79], [127, 101], [111, 116], [73, 108], [37, 117], [10, 107]], [[12, 98], [24, 53], [44, 101], [58, 48], [79, 103], [99, 50], [116, 99]]),
  landmarkRecipe("spring-terraces:willow-left", "wet-stone-willow-composite", "none", "spring-terraces", ["crooked-willow-left", "bank-contact"], [[6, 98], [14, 42], [31, 18], [61, 8], [89, 17], [121, 45], [112, 86], [88, 111], [45, 116], [15, 108]], [[38, 108], [42, 51], [65, 31], [84, 62], [103, 91]]),
  landmarkRecipe("spring-terraces:willow-right", "wet-stone-willow-composite", "none", "spring-terraces", ["crooked-willow-right", "hanging-frond-gaps"], [[5, 103], [11, 55], [24, 26], [54, 11], [83, 6], [112, 27], [124, 66], [109, 101], [72, 116], [31, 112], [9, 94]], [[91, 109], [87, 52], [63, 29], [41, 61], [21, 94], [74, 79]]),
  landmarkRecipe("spring-terraces:north-south-planks", "short-boardwalk-composite", "north-south", "spring-terraces", ["missing-planks", "wet-dry-crossing"], [[39, 0], [84, 0], [87, 33], [82, 66], [88, 96], [85, 127], [40, 127], [44, 96], [38, 64], [43, 31]], [[46, 9], [80, 12], [45, 37], [79, 42], [47, 69], [81, 75], [45, 103], [78, 110]]),
  landmarkRecipe("spring-terraces:east-west-planks", "short-boardwalk-composite", "east-west", "spring-terraces", ["crooked-posts", "dry-route-port"], [[0, 39], [29, 42], [61, 37], [94, 44], [127, 40], [127, 86], [95, 82], [63, 88], [31, 81], [0, 85]], [[8, 47], [12, 80], [37, 45], [42, 82], [69, 48], [75, 84], [101, 45], [110, 80], [123, 51]]),
];

const DRY_LANDMARK_RECIPES = [
  landmarkRecipe("dry-scrub:low-stepped-ridge", "sun-rock-outcrop-composite", "none", "dry-scrub", ["stratified-sandstone", "low-shadow-pocket"], [[3, 103], [17, 75], [43, 69], [58, 39], [79, 34], [98, 56], [124, 75], [119, 108], [73, 111], [31, 119]], [[19, 91], [48, 73], [71, 48], [91, 70], [112, 91]]),
  landmarkRecipe("dry-scrub:split-outcrop", "sun-rock-outcrop-composite", "none", "dry-scrub", ["split-rock-planes", "deep-shadow-pocket"], [[4, 108], [12, 69], [36, 43], [61, 52], [78, 25], [102, 37], [122, 72], [116, 103], [91, 117], [54, 103], [25, 120]], [[21, 96], [38, 59], [60, 69], [79, 42], [101, 57], [111, 88]]),
  landmarkRecipe("dry-scrub:wind-cut-diagonal-ridge", "sun-rock-outcrop-composite", "east-west", "dry-scrub", ["wind-cut-ridge", "diagonal-plane-break"], [[2, 91], [18, 55], [47, 62], [68, 28], [95, 20], [119, 49], [126, 87], [104, 112], [69, 105], [38, 121], [11, 110], [5, 103]], [[14, 88], [41, 74], [66, 48], [93, 38], [113, 62], [98, 93], [61, 91]]),
  landmarkRecipe("dry-scrub:crescent-open-south", "deadwood-thorn-tangle-composite", "south-gap", "dry-scrub", ["interlocked-deadwood", "crescent-opening-south"], [[5, 101], [17, 70], [42, 57], [67, 75], [93, 49], [119, 69], [126, 105], [99, 118], [70, 103], [43, 119], [12, 112]], [[13, 102], [38, 49], [66, 108], [94, 43], [119, 91]]),
  landmarkRecipe("dry-scrub:crescent-open-side", "deadwood-thorn-tangle-composite", "east-gap", "dry-scrub", ["thorn-lattice", "crescent-opening-east"], [[3, 106], [10, 77], [31, 52], [58, 69], [79, 42], [104, 54], [124, 81], [119, 111], [84, 118], [52, 104], [24, 122], [6, 116]], [[14, 99], [47, 45], [62, 106], [88, 38], [111, 70], [97, 102]]),
  landmarkRecipe("dry-scrub:horizontal-wind", "wind-scrub-clump-composite", "east-west", "dry-scrub", ["one-direction-scrub", "sand-ripples"], [[4, 96], [16, 73], [43, 69], [67, 77], [92, 66], [123, 83], [119, 110], [88, 104], [63, 117], [34, 107], [9, 114]], [[11, 92], [28, 74], [47, 95], [68, 70], [87, 97], [108, 73]]),
  landmarkRecipe("dry-scrub:rising-diagonal-wind", "wind-scrub-clump-composite", "diagonal-rise", "dry-scrub", ["rising-wind-line", "low-shrub-band"], [[3, 111], [12, 86], [36, 77], [59, 65], [82, 54], [111, 43], [126, 58], [119, 82], [92, 91], [64, 105], [31, 119], [9, 121]], [[13, 105], [31, 84], [51, 89], [69, 66], [88, 72], [108, 50], [119, 60]]),
  landmarkRecipe("dry-scrub:falling-diagonal-wind", "wind-scrub-clump-composite", "diagonal-fall", "dry-scrub", ["falling-wind-line", "pebble-fan"], [[2, 53], [17, 43], [42, 52], [65, 64], [90, 74], [117, 88], [126, 111], [103, 121], [72, 108], [43, 99], [16, 85], [5, 70], [1, 62]], [[10, 58], [29, 47], [47, 67], [68, 62], [87, 86], [107, 83], [119, 105], [96, 113]]),
];

const ASH_LANDMARK_RECIPES = [
  landmarkRecipe("ash-waste:offset-crater-branching-fault", "nuclear-crater-fissure-composite", "cluster", "ash-waste", ["industrial-irradiated-crater", "branching-coral-fissure"], [[2, 61], [14, 31], [43, 20], [67, 30], [94, 17], [120, 38], [126, 73], [112, 104], [82, 116], [54, 103], [27, 119], [7, 99]], [[0, 43], [39, 60], [63, 77], [47, 127], [89, 70], [127, 101]]),
  landmarkRecipe("ash-waste:split-crater-service-fracture", "nuclear-crater-fissure-composite", "east-west", "ash-waste", ["containment-scar", "service-fracture"], [[3, 103], [8, 66], [28, 36], [57, 21], [83, 30], [105, 18], [124, 49], [119, 85], [98, 111], [66, 104], [39, 121], [14, 116], [5, 111]], [[0, 102], [38, 77], [61, 82], [79, 127], [91, 51], [127, 29], [105, 89]]),
  landmarkRecipe("ash-waste:snapped-cross-member", "fractured-industrial-pylon-composite", "none", "ash-waste", ["fractured-industrial-lattice", "integrated-containment-relief"], [[16, 112], [29, 18], [44, 17], [40, 42], [84, 21], [99, 104], [116, 116], [89, 123], [53, 116]], [[30, 29], [91, 24], [35, 55], [96, 49], [40, 79], [101, 69]]),
  landmarkRecipe("ash-waste:leaning-fractured-lattice", "fractured-industrial-pylon-composite", "none", "ash-waste", ["leaning-industrial-lattice", "integrated-containment-relief"], [[22, 116], [40, 14], [55, 20], [53, 45], [91, 27], [110, 107], [122, 119], [94, 126], [63, 117], [34, 124]], [[41, 31], [96, 27], [47, 57], [102, 51], [54, 83], [107, 73], [79, 99]]),
  landmarkRecipe("ash-waste:slag-ridge-char-stumps", "slag-charred-ridge-composite", "cluster", "ash-waste", ["slag-ridge", "charred-stump-silhouette"], [[1, 103], [8, 70], [31, 51], [54, 62], [75, 38], [99, 47], [123, 68], [127, 107], [106, 120], [75, 109], [46, 124], [15, 116]], [[18, 102], [12, 38], [50, 108], [58, 28], [88, 105], [96, 24], [113, 103]]),
  landmarkRecipe("ash-waste:industrial-aggregate-ridge", "slag-charred-ridge-composite", "cluster", "ash-waste", ["industrial-aggregate", "oxidized-rebar"], [[2, 111], [6, 83], [24, 58], [48, 45], [70, 59], [91, 35], [116, 51], [126, 83], [119, 112], [91, 123], [61, 111], [33, 126], [10, 121]], [[9, 106], [31, 56], [45, 113], [72, 51], [83, 115], [109, 45], [120, 91], [98, 102]]),
  landmarkRecipe("ash-waste:narrow-directional-fan", "ash-debris-fan-composite", "east", "ash-waste", ["graded-debris", "cable-scrap"], [[2, 108], [10, 73], [37, 54], [67, 63], [89, 42], [118, 55], [127, 91], [114, 118], [76, 108], [48, 123], [17, 118]], [[7, 92], [31, 69], [57, 87], [86, 63], [111, 80]]),
  landmarkRecipe("ash-waste:joined-containment-debris-fan", "ash-debris-fan-composite", "east", "ash-waste", ["joined-containment-relief", "industrial-irradiated-debris"], [[1, 113], [7, 82], [27, 56], [52, 47], [73, 58], [96, 39], [120, 51], [127, 85], [119, 113], [91, 125], [63, 112], [35, 127], [10, 123]], [[4, 117], [33, 49], [49, 96], [69, 43], [83, 101], [106, 45], [124, 94]]),
];

const NEUTRAL_LANDMARK_RECIPES = [
  landmarkRecipe("neutral-temperate:broad-crown", "restrained-broad-grove-composite", "none", "neutral-temperate", ["airy-deciduous-grove", "understory-gaps"], [[7, 97], [17, 57], [39, 25], [69, 14], [101, 25], [121, 54], [116, 96]], [[31, 109], [42, 55], [74, 110], [81, 49]]),
  landmarkRecipe("neutral-temperate:paired-trees", "restrained-broad-grove-composite", "none", "neutral-temperate", ["paired-tree-masses", "open-understory"], [[5, 94], [12, 48], [33, 19], [57, 31], [76, 12], [103, 20], [123, 55], [118, 101]], [[27, 108], [35, 61], [81, 111], [91, 53], [106, 94]]),
  landmarkRecipe("neutral-temperate:sparse-open-grove", "restrained-broad-grove-composite", "none", "neutral-temperate", ["sparse-canopy", "field-lane-view"], [[4, 105], [9, 63], [25, 33], [49, 18], [72, 29], [97, 16], [119, 37], [126, 74], [113, 109]], [[21, 111], [31, 70], [61, 113], [68, 62], [99, 108], [106, 54]]),
  landmarkRecipe("neutral-temperate:boundary-open-south", "field-rock-boundary-composite", "south-gap", "neutral-temperate", ["dry-stone-wall", "open-south-gate"], [[5, 100], [12, 71], [39, 65], [62, 73], [86, 61], [113, 70], [124, 96], [116, 112], [85, 106], [62, 119], [31, 109], [11, 117]], [[12, 64], [31, 56], [51, 59], [81, 57], [102, 63], [116, 73]]),
  landmarkRecipe("neutral-temperate:boundary-open-side", "field-rock-boundary-composite", "east-gap", "neutral-temperate", ["hedgerow-return", "open-east-gate"], [[4, 108], [8, 81], [27, 59], [52, 66], [71, 49], [93, 61], [117, 79], [126, 104], [111, 118], [77, 109], [49, 123], [19, 118], [7, 114]], [[15, 52], [35, 48], [56, 51], [75, 62], [92, 79], [108, 99]]),
  landmarkRecipe("neutral-temperate:left-verge", "wildflower-verge-composite", "east-west", "neutral-temperate", ["mixed-height-verge", "open-flower-gaps"], [[3, 99], [13, 74], [38, 68], [62, 78], [88, 66], [117, 72], [127, 94], [119, 112], [88, 106], [61, 118], [35, 108], [10, 117]], [[12, 90], [31, 77], [49, 98], [68, 75], [88, 96], [110, 78]]),
  landmarkRecipe("neutral-temperate:right-verge", "wildflower-verge-composite", "east-west", "neutral-temperate", ["field-lane-verge", "understory-breaks"], [[2, 108], [8, 81], [31, 70], [55, 80], [78, 65], [104, 69], [124, 88], [127, 109], [99, 119], [72, 108], [43, 122], [17, 116], [5, 113]], [[11, 101], [27, 82], [48, 103], [65, 78], [85, 100], [106, 77], [119, 93]]),
  landmarkRecipe("neutral-temperate:diagonal-verge", "wildflower-verge-composite", "diagonal", "neutral-temperate", ["diagonal-meadow-verge", "visible-field-boundary"], [[3, 113], [12, 87], [31, 75], [52, 61], [74, 53], [96, 38], [119, 40], [127, 61], [109, 75], [88, 86], [63, 101], [35, 116], [10, 122]], [[13, 106], [29, 87], [47, 82], [63, 66], [81, 63], [98, 48], [116, 53], [103, 71]]),
];

const BASE_TAGS = ["foundation-connected", "ragged-apron", "open-south-corridor"];
const OVERLAY_TAGS = ["localized-overlay", "open-south-corridor"];

const WORN_YARD_RECIPES = [
  yardRecipe("worn:yard:standing-a", "standing-a-base", "worn-heartland", [...BASE_TAGS, "trampled-homestead"], [[28,16],[73,8],[103,22],[137,9],[170,26],[187,51],[187,104],[174,132],[147,149],[123,137],[114,120],[113,72],[79,72],[78,118],[68,139],[40,148],[16,125],[4,101],[4,47],[15,31]], [[9, 106], [42, 134], [78, 119]]),
  yardRecipe("worn:yard:standing-b", "standing-b-base", "worn-heartland", [...BASE_TAGS, "broken-fence-wing"], [[18,31],[50,8],[78,38],[101,16],[132,33],[165,21],[187,55],[159,78],[187,109],[162,144],[128,154],[114,122],[113,72],[79,72],[78,125],[65,149],[28,152],[4,114],[27,84],[4,53]], [[14, 118], [47, 139], [151, 136], [179, 103]]),
  yardRecipe("worn:yard:warm", "warm-overlay", "worn-heartland", [...OVERLAY_TAGS, "hearth-spill"], [[50, 104], [68, 98], [77, 109]], [[117, 102], [137, 99]], [7, 7]),
  yardRecipe("worn:yard:hoard", "durable-hoarding-overlay", "worn-heartland", [...OVERLAY_TAGS, "covered-lumber"], [[12, 108], [37, 101], [56, 119], [29, 127]], [[141, 108], [166, 101], [181, 123]], [5, 3]),
  yardRecipe("worn:yard:ruin", "persistent-ruin-base", "worn-heartland", [...BASE_TAGS, "collapsed-fence"], [[37,17],[58,29],[88,10],[113,35],[139,24],[167,41],[187,71],[173,96],[187,125],[159,154],[132,136],[114,115],[113,72],[79,72],[78,122],[64,141],[30,151],[4,115],[4,73],[14,47]], [[13, 121], [52, 146], [139, 145], [178, 116]]),
];

const SPRING_YARD_RECIPES = [
  yardRecipe("spring:yard:standing-a", "standing-a-base", "spring-terraces", [...BASE_TAGS, "wet-stone-apron"], [[28,18],[73,10],[103,19],[137,11],[170,23],[187,49],[187,105],[174,129],[147,151],[123,134],[114,120],[113,72],[79,72],[78,118],[68,136],[40,150],[16,127],[4,99],[4,48],[15,28]], [[9, 123], [47, 146], [138, 143], [179, 113]]),
  yardRecipe("spring:yard:standing-b", "standing-b-base", "spring-terraces", [...BASE_TAGS, "drainage-runnel"], [[18,28],[50,10],[78,38],[101,13],[132,35],[165,18],[187,56],[159,80],[187,110],[162,146],[128,152],[114,122],[113,72],[79,72],[78,125],[65,146],[28,154],[4,115],[27,81],[4,51]], [[10, 132], [57, 149], [128, 146], [181, 126]]),
  yardRecipe("spring:yard:warm", "warm-overlay", "spring-terraces", [...OVERLAY_TAGS, "wet-reflection"], [[42, 124], [62, 119], [70, 127], [54, 132]], [[126, 123], [148, 120], [142, 131]], [7, 7]),
  yardRecipe("spring:yard:hoard", "durable-hoarding-overlay", "spring-terraces", [...OVERLAY_TAGS, "waterproof-storage"], [[14, 104], [31, 80], [47, 105], [34, 124]], [[143, 103], [160, 78], [179, 112], [157, 126]], [5, 3]),
  yardRecipe("spring:yard:ruin", "persistent-ruin-base", "spring-terraces", [...BASE_TAGS, "silted-terrace"], [[37,19],[58,26],[88,12],[113,37],[139,21],[167,43],[187,69],[173,98],[187,126],[159,153],[132,138],[114,115],[113,72],[79,72],[78,122],[64,143],[30,148],[4,116],[4,71],[14,44]], [[8, 133], [51, 151], [132, 147], [182, 118]]),
];

const DRY_YARD_RECIPES = [
  yardRecipe("dry:yard:standing-a", "standing-a-base", "dry-scrub", [...BASE_TAGS, "swept-earth-foundation"], [[28,20],[73,7],[103,21],[137,8],[170,25],[187,50],[187,106],[174,131],[147,148],[123,136],[114,120],[113,72],[79,72],[78,118],[68,138],[40,152],[16,124],[4,100],[4,49],[15,30]], [[8, 126], [47, 148], [139, 145], [182, 119]]),
  yardRecipe("dry:yard:standing-b", "standing-b-base", "dry-scrub", [...BASE_TAGS, "stone-windbreak"], [[18,30],[50,12],[78,38],[101,15],[132,32],[165,20],[187,54],[159,77],[187,111],[162,143],[128,154],[114,122],[113,72],[79,72],[78,125],[65,148],[28,154],[4,116],[27,83],[4,52]], [[9, 137], [60, 151], [129, 146], [183, 129]]),
  yardRecipe("dry:yard:warm", "warm-overlay", "dry-scrub", [...OVERLAY_TAGS, "door-brazier"], [[46, 115], [62, 105], [77, 116], [61, 124], [50, 121]], [[119, 112], [139, 104], [145, 119]], [7, 7]),
  yardRecipe("dry:yard:hoard", "durable-hoarding-overlay", "dry-scrub", [...OVERLAY_TAGS, "weighted-supplies"], [[11, 98], [35, 90], [59, 113], [42, 126]], [[139, 94], [164, 89], [182, 113], [160, 127]], [5, 3]),
  yardRecipe("dry:yard:ruin", "persistent-ruin-base", "dry-scrub", [...BASE_TAGS, "collapsed-windbreak"], [[37,16],[58,28],[88,14],[113,34],[139,23],[167,40],[187,70],[173,100],[187,124],[159,154],[132,135],[114,115],[113,72],[79,72],[78,122],[64,140],[30,150],[4,114],[4,72],[14,46]], [[8, 141], [55, 152], [137, 146], [183, 124]]),
];

const ASH_YARD_RECIPES = [
  yardRecipe("ash:yard:standing-a", "standing-a-base", "ash-waste", [...BASE_TAGS, "fractured-service-apron"], [[28,17],[73,9],[103,18],[137,10],[170,27],[187,51],[187,104],[174,128],[147,150],[123,138],[114,120],[113,72],[79,72],[78,118],[68,140],[40,149],[16,126],[4,101],[4,47],[15,32]], [[7, 139], [55, 151], [137, 147], [184, 127]]),
  yardRecipe("ash:yard:standing-b", "standing-b-base", "ash-waste", [...BASE_TAGS, "cable-trench-windbreak"], [[18,32],[50,9],[78,38],[101,12],[132,34],[165,22],[187,55],[159,79],[187,109],[162,145],[128,154],[114,122],[113,72],[79,72],[78,125],[65,150],[28,153],[4,114],[27,80],[4,53]], [[8, 143], [43, 151], [144, 149], [181, 128]]),
  yardRecipe("ash:yard:warm", "warm-overlay", "ash-waste", [...OVERLAY_TAGS, "sharp-vent-contrast"], [[44, 118], [59, 107], [77, 115], [67, 126], [49, 125], [41, 122]], [[118, 114], [136, 106], [149, 118]], [6, 6]),
  yardRecipe("ash:yard:hoard", "durable-hoarding-overlay", "ash-waste", [...OVERLAY_TAGS, "sealed-filter-boxes"], [[10, 92], [31, 80], [58, 105], [50, 125]], [[138, 82], [164, 76], [183, 108], [162, 129]], [4, 3]),
  yardRecipe("ash:yard:ruin", "persistent-ruin-base", "ash-waste", [...BASE_TAGS, "collapsed-conduit"], [[37,18],[58,30],[88,11],[113,36],[139,20],[167,42],[187,71],[173,97],[187,125],[159,152],[132,137],[114,115],[113,72],[79,72],[78,122],[64,142],[30,152],[4,115],[4,73],[14,43]], [[8, 147], [48, 154], [132, 151], [184, 138]]),
];

const NEUTRAL_YARD_RECIPES = [
  yardRecipe("neutral:yard:standing-a", "standing-a-base", "neutral-temperate", [...BASE_TAGS, "meadow-soil-apron"], [[28,19],[73,6],[103,20],[137,12],[170,24],[187,49],[187,105],[174,130],[147,152],[123,135],[114,120],[113,72],[79,72],[78,118],[68,137],[40,151],[16,123],[4,99],[4,48],[15,29]], [[8, 129], [48, 148], [140, 144], [182, 117]]),
  yardRecipe("neutral:yard:standing-b", "standing-b-base", "neutral-temperate", [...BASE_TAGS, "low-field-stone-edge"], [[18,29],[50,11],[78,38],[101,14],[132,36],[165,19],[187,56],[159,76],[187,110],[162,147],[128,153],[114,122],[113,72],[79,72],[78,125],[65,147],[28,154],[4,115],[27,82],[4,51]], [[9, 137], [57, 151], [129, 147], [183, 128]]),
  yardRecipe("neutral:yard:warm", "warm-overlay", "neutral-temperate", [...OVERLAY_TAGS, "window-seat-cue"], [[45, 111], [61, 101], [76, 108], [69, 120], [51, 122], [42, 117], [43, 113]], [[119, 108], [137, 100], [149, 112]], [7, 7]),
  yardRecipe("neutral:yard:hoard", "durable-hoarding-overlay", "neutral-temperate", [...OVERLAY_TAGS, "harvest-storage"], [[10, 101], [28, 87], [55, 108], [45, 126]], [[140, 88], [163, 82], [182, 111], [160, 129]], [5, 3]),
  yardRecipe("neutral:yard:ruin", "persistent-ruin-base", "neutral-temperate", [...BASE_TAGS, "overgrown-wall"], [[37,20],[58,27],[88,13],[113,33],[139,22],[167,44],[187,69],[173,99],[187,126],[159,154],[132,139],[114,115],[113,72],[79,72],[78,122],[64,144],[30,149],[4,116],[4,71],[14,45]], [[8, 139], [45, 151], [142, 145], [182, 119]]),
];

const WORN_SCENE_PLAN = {
  kitId: "worn-heartland",
  widthTiles: 24,
  heightTiles: 16,
  sentence: ["oak-sheltered-garden", "open-fence-route", "trampled-homestead-terminus"],
  routeGrammar: {
    start: { x: 0, y: 4 },
    turns: [{ x: 6, y: 4 }, { x: 6, y: 7 }, { x: 11, y: 7 }, { x: 11, y: 13 }],
    terminus: { x: 19, y: 13 },
  },
  routeTiles: [
    { x: 0, y: 4 }, { x: 1, y: 4 }, { x: 2, y: 4 }, { x: 3, y: 4 }, { x: 4, y: 4 }, { x: 5, y: 4 }, { x: 6, y: 4 },
    { x: 6, y: 5 }, { x: 6, y: 6 }, { x: 6, y: 7 }, { x: 7, y: 7 }, { x: 8, y: 7 }, { x: 9, y: 7 },
    { x: 10, y: 7 }, { x: 11, y: 7 }, { x: 11, y: 8 }, { x: 11, y: 9 }, { x: 11, y: 10 }, { x: 11, y: 11 },
    { x: 11, y: 12 }, { x: 11, y: 13 }, { x: 12, y: 13 }, { x: 13, y: 13 }, { x: 14, y: 13 },
    { x: 15, y: 13 }, { x: 16, y: 13 }, { x: 17, y: 13 }, { x: 18, y: 13 }, { x: 19, y: 13 },
  ],
  terrainPatches: [
    { id: "worn:patch:tilled-garden", role: "tilled-soil", tiles: [{ x: 5, y: 5 }, { x: 6, y: 5 }, { x: 7, y: 5 }, { x: 8, y: 5 }, { x: 5, y: 6 }, { x: 6, y: 6 }, { x: 7, y: 6 }, { x: 8, y: 6 }, { x: 5, y: 7 }, { x: 6, y: 7 }, { x: 7, y: 7 }, { x: 8, y: 7 }] },
    { id: "worn:patch:trampled-yard-return", role: "ochre-wear", tiles: [{ x: 15, y: 11 }, { x: 16, y: 11 }, { x: 17, y: 11 }, { x: 18, y: 11 }, { x: 15, y: 12 }, { x: 16, y: 12 }, { x: 17, y: 12 }, { x: 18, y: 12 }, { x: 15, y: 13 }, { x: 16, y: 13 }, { x: 17, y: 13 }, { x: 18, y: 13 }] },
  ],
  groundRecipeGrid: [
    [2,1,0,2,3,1,2,3,2,0,2,0,0,2,3,1,1,0,3,1,3,0,1,3],
    [0,3,1,1,0,2,3,0,1,2,0,3,1,0,3,2,2,3,0,2,1,3,0,1],
    [3,0,2,3,2,0,7,5,3,2,1,0,2,3,0,2,1,3,1,4,5,1,3,0],
    [2,1,0,2,6,5,6,7,4,3,0,1,3,1,1,3,0,2,7,7,4,0,2,1],
    [0,2,1,4,5,7,4,5,6,4,3,3,2,0,2,1,3,6,4,5,6,7,1,0],
    [1,3,6,6,4,5,7,4,5,7,1,2,3,2,0,1,0,4,6,4,7,5,3,2],
    [3,0,4,7,5,6,4,7,6,6,4,0,1,2,3,0,1,5,7,7,5,4,2,3],
    [0,2,7,5,6,5,7,6,5,4,6,1,2,3,0,2,3,0,5,4,6,7,1,2],
    [1,0,1,6,7,6,5,4,7,5,6,2,3,1,2,1,0,2,7,6,7,6,3,0],
    [0,3,0,3,4,4,5,5,6,7,1,0,2,3,1,0,2,5,4,5,4,1,2,3],
    [0,3,1,0,2,6,7,4,5,1,2,1,0,2,0,3,4,6,4,7,7,2,3,0],
    [3,2,0,3,2,1,6,5,1,3,0,3,2,0,2,6,5,7,6,5,4,2,1,3],
    [0,3,1,2,3,0,2,1,2,1,1,3,0,2,7,4,6,5,4,6,5,1,3,0],
    [2,1,2,1,2,3,0,2,1,3,0,1,3,7,4,6,7,5,6,4,0,3,2,1],
    [0,3,0,3,1,0,1,0,3,1,0,2,5,6,7,4,5,6,7,1,3,2,3,0],
    [3,1,2,1,3,1,2,3,2,0,3,5,7,7,5,6,4,7,0,2,1,0,1,2],
  ],
  waterTiles: [],
  shoreTiles: [],
  bridgeTiles: [],
  landmarks: [
    { variantId: "worn-heartland:broad-crown", clusterId: "worn-oak-west", role: "old-oak-anchor", x: 32, y: 48, cell: 0 },
    { variantId: "worn-heartland:open-south-gap", clusterId: "worn-garden-gate", role: "garden-route-gate", x: 160, y: 96, cell: 3 },
    { variantId: "worn-heartland:left-right-shoulder", clusterId: "worn-route-shoulder", role: "eroded-route-band", x: 256, y: 144, cell: 6 },
    { variantId: "worn-heartland:split-crown", clusterId: "worn-oak-home", role: "homestead-frame", x: 416, y: 272, cell: 1 },
  ],
  supports: [
    { id: "worn:support:root-a", clusterId: "worn-oak-west", role: "root-mound", landmarkVariantId: "worn-heartland:broad-crown", sceneryKind: "old-oak", variantOrdinal: 1, cell: 4, x: 32, y: 160 },
    { id: "worn:support:tree-a", clusterId: "worn-oak-west", role: "support-tree", landmarkVariantId: "worn-heartland:broad-crown", sceneryKind: "old-oak", variantOrdinal: 2, cell: 8, x: 128, y: 128 },
    { id: "worn:support:fence-a", clusterId: "worn-garden-gate", role: "broken-fence-return", landmarkVariantId: "worn-heartland:open-south-gap", sceneryKind: "fallen-fence", variantOrdinal: 0, cell: 3, x: 160, y: 192 },
    { id: "worn:support:flower-a", clusterId: "worn-garden-gate", role: "faded-flower", landmarkVariantId: "worn-heartland:open-south-gap", sceneryKind: "faded-flower", variantOrdinal: 0, cell: 2, x: 256, y: 192 },
    { id: "worn:support:rut-a", clusterId: "worn-route-shoulder", role: "rut-stone", landmarkVariantId: "worn-heartland:left-right-shoulder", sceneryKind: "worn-stone", variantOrdinal: 0, cell: 1, x: 256, y: 224 },
    { id: "worn:support:tuft-a", clusterId: "worn-route-shoulder", role: "eroded-tuft", landmarkVariantId: "worn-heartland:left-right-shoulder", sceneryKind: "faded-flower", variantOrdinal: 1, cell: 6, x: 352, y: 224 },
    { id: "worn:support:wood-a", clusterId: "worn-oak-home", role: "woodpile", landmarkVariantId: "worn-heartland:split-crown", sceneryKind: "old-oak", variantOrdinal: 3, cell: 12, x: 416, y: 384 },
    { id: "worn:support:stone-a", clusterId: "worn-oak-home", role: "field-stone", landmarkVariantId: "worn-heartland:split-crown", sceneryKind: "worn-stone", variantOrdinal: 1, cell: 5, x: 512, y: 384 },
  ],
  yard: { recipeId: "worn:yard:standing-a", originPx: { x: 528, y: 320 }, contactPivotPx: { x: 96, y: 112 }, connectionPorts: [{ side: "south", startPx: 80, widthPx: 32, role: "path" }], doorClearancePx: { x: 81, y: 73, width: 30, height: 48 } },
  home: { plotTile: { x: 17, y: 10 }, plotCenterPx: { x: 560, y: 336 }, doorTile: { x: 19, y: 13 }, doorCenterPx: { x: 624, y: 432 } },
};

const SPRING_SCENE_PLAN = {
  kitId: "spring-terraces", widthTiles: 24, heightTiles: 16,
  sentence: ["connected-spring-basin", "willow-reed-bank", "boardwalk-wet-dry-route", "terraced-home-terminus"],
  routeGrammar: { start: { x: 0, y: 8 }, turns: [{ x: 8, y: 8 }, { x: 8, y: 11 }, { x: 14, y: 11 }, { x: 14, y: 6 }, { x: 18, y: 6 }], terminus: { x: 18, y: 12 } },
  routeTiles: [
    {x:0,y:8},{x:1,y:8},{x:2,y:8},{x:3,y:8},{x:4,y:8},{x:5,y:8},{x:6,y:8},{x:7,y:8},{x:8,y:8},
    {x:8,y:9},{x:8,y:10},{x:8,y:11},{x:9,y:11},{x:10,y:11},{x:11,y:11},{x:12,y:11},{x:13,y:11},{x:14,y:11},
    {x:14,y:10},{x:14,y:9},{x:14,y:8},{x:14,y:7},{x:14,y:6},{x:15,y:6},{x:16,y:6},{x:17,y:6},{x:18,y:6},
    {x:18,y:7},{x:18,y:8},{x:18,y:9},{x:18,y:10},{x:18,y:11},{x:18,y:12},
  ],
  terrainPatches: [
    { id: "spring:patch:mineral-terrace", role: "cool-mineral-stone", tiles: [{x:9,y:3},{x:10,y:3},{x:11,y:3},{x:12,y:3},{x:9,y:4},{x:10,y:4},{x:11,y:4},{x:12,y:4},{x:9,y:5},{x:10,y:5},{x:11,y:5},{x:12,y:5}] },
    { id: "spring:patch:moist-yard-return", role: "mint-moist-zone", tiles: [{x:15,y:9},{x:16,y:9},{x:17,y:9},{x:18,y:9},{x:15,y:10},{x:16,y:10},{x:17,y:10},{x:18,y:10},{x:15,y:11},{x:16,y:11},{x:17,y:11},{x:18,y:11}] },
  ],
  groundRecipeGrid: [
    [0,1,3,2,3,2,1,0,3,0,1,1,2,0,0,1,3,0,3,2,0,3,3,2],
    [1,0,2,3,1,2,0,3,0,2,3,1,3,2,3,2,0,3,1,0,2,1,3,1],
    [0,3,1,3,0,7,5,0,3,1,0,2,1,3,2,0,2,4,7,1,0,2,1,3],
    [1,2,3,2,7,5,7,6,2,3,2,0,0,1,3,2,7,6,4,2,0,1,2,0],
    [0,3,2,7,6,5,6,4,5,3,1,0,2,1,1,4,4,5,6,1,3,0,1,3],
    [3,1,6,4,5,6,7,5,4,7,2,1,1,2,0,6,5,4,5,6,2,1,3,0],
    [2,4,7,6,5,4,5,6,4,6,7,3,1,0,3,1,7,6,7,5,1,2,1,3],
    [0,6,4,5,6,7,5,4,6,5,4,2,0,2,3,2,4,6,5,7,5,3,1,1],
    [3,2,5,7,4,5,6,7,4,7,2,0,3,0,2,0,7,5,4,5,7,0,0,2],
    [1,3,0,4,5,6,5,4,7,2,1,3,0,1,0,7,5,6,7,6,0,2,1,0],
    [3,2,1,3,4,5,4,6,2,1,0,3,1,2,4,7,4,7,6,4,1,0,2,3],
    [0,3,2,1,2,4,6,0,3,2,1,1,3,7,5,4,6,5,5,7,0,3,1,2],
    [2,0,1,3,0,1,0,2,1,0,2,3,4,6,7,5,4,6,7,2,3,1,3,1],
    [3,1,0,2,1,0,3,1,3,2,1,6,5,7,4,6,5,5,0,1,2,0,3,3],
    [0,2,1,0,3,1,2,3,0,3,7,4,7,5,6,7,6,2,2,3,1,2,1,3],
    [1,3,0,2,2,3,0,1,2,4,6,5,6,4,7,5,0,0,3,0,1,0,2,0],
  ],
  waterTiles: [{x:3,y:8},{x:4,y:8},{x:5,y:8},{x:2,y:9},{x:3,y:9},{x:4,y:9},{x:5,y:9},{x:6,y:9},{x:2,y:10},{x:3,y:10},{x:4,y:10},{x:5,y:10},{x:6,y:10},{x:7,y:10},{x:3,y:11},{x:4,y:11},{x:5,y:11},{x:6,y:11},{x:4,y:12},{x:5,y:12}],
  shoreTiles: [{x:3,y:7},{x:4,y:7},{x:5,y:7},{x:2,y:8},{x:6,y:8},{x:1,y:9},{x:7,y:9},{x:1,y:10},{x:8,y:10},{x:2,y:11},{x:7,y:11},{x:3,y:12},{x:6,y:12},{x:4,y:13},{x:5,y:13}],
  bridgeTiles: [{x:3,y:8},{x:4,y:8},{x:5,y:8}],
  landmarks: [
    { variantId: "spring-terraces:curved-pool-rim", clusterId: "spring-basin-west", role: "connected-basin", x: 32, y: 208, cell: 0 },
    { variantId: "spring-terraces:willow-left", clusterId: "spring-willow-bank", role: "bank-willow", x: 64, y: 240, cell: 4 },
    { variantId: "spring-terraces:broken-sight-gap", clusterId: "spring-reed-outlet", role: "shore-reed-bank", x: 160, y: 224, cell: 3 },
    { variantId: "spring-terraces:east-west-planks", clusterId: "spring-boardwalk-crossing", role: "wet-dry-crossing", x: 80, y: 208, cell: 7 },
  ],
  supports: [
    {id:"spring:support:stone-a",clusterId:"spring-basin-west",role:"wet-stone",landmarkVariantId:"spring-terraces:curved-pool-rim",sceneryKind:"terrace-rock",variantOrdinal:0,cell:0,x:32,y:256},
    {id:"spring:support:ripple-a",clusterId:"spring-basin-west",role:"shallow-ripple",landmarkVariantId:"spring-terraces:curved-pool-rim",sceneryKind:"terrace-rock",variantOrdinal:1,cell:4,x:128,y:288},
    {id:"spring:support:root-a",clusterId:"spring-willow-bank",role:"willow-root",landmarkVariantId:"spring-terraces:willow-left",sceneryKind:"willow",variantOrdinal:0,cell:1,x:64,y:352},
    {id:"spring:support:reed-a",clusterId:"spring-willow-bank",role:"hanging-reed",landmarkVariantId:"spring-terraces:willow-left",sceneryKind:"reed-bed",variantOrdinal:0,cell:3,x:160,y:352},
    {id:"spring:support:reed-b",clusterId:"spring-reed-outlet",role:"shore-reed",landmarkVariantId:"spring-terraces:broken-sight-gap",sceneryKind:"reed-bed",variantOrdinal:1,cell:7,x:192,y:256},
    {id:"spring:support:silt-a",clusterId:"spring-reed-outlet",role:"silt-bank",landmarkVariantId:"spring-terraces:broken-sight-gap",sceneryKind:"terrace-rock",variantOrdinal:2,cell:8,x:256,y:320},
    {id:"spring:support:post-a",clusterId:"spring-boardwalk-crossing",role:"boardwalk-post",landmarkVariantId:"spring-terraces:east-west-planks",sceneryKind:"willow",variantOrdinal:1,cell:5,x:64,y:256},
    {id:"spring:support:plank-a",clusterId:"spring-boardwalk-crossing",role:"missing-plank-edge",landmarkVariantId:"spring-terraces:east-west-planks",sceneryKind:"willow",variantOrdinal:2,cell:9,x:192,y:256},
  ],
  yard: { recipeId: "spring:yard:standing-a", originPx: {x:496,y:288}, contactPivotPx:{x:96,y:112}, connectionPorts:[{side:"south",startPx:80,widthPx:32,role:"path"}], doorClearancePx:{x:81,y:73,width:30,height:48} },
  home: { plotTile:{x:16,y:9}, plotCenterPx:{x:528,y:304}, doorTile:{x:18,y:12}, doorCenterPx:{x:592,y:400} },
};

const DRY_SCENE_PLAN = {
  kitId:"dry-scrub",widthTiles:24,heightTiles:16,
  sentence:["wind-cut-outcrop-bend","thorn-crescent-passage","one-direction-scrub","windbreak-home-terminus"],
  routeGrammar:{start:{x:23,y:3},turns:[{x:18,y:3},{x:18,y:6},{x:12,y:6},{x:12,y:9},{x:20,y:9}],terminus:{x:20,y:11}},
  routeTiles:[{x:23,y:3},{x:22,y:3},{x:21,y:3},{x:20,y:3},{x:19,y:3},{x:18,y:3},{x:18,y:4},{x:18,y:5},{x:18,y:6},{x:17,y:6},{x:16,y:6},{x:15,y:6},{x:14,y:6},{x:13,y:6},{x:12,y:6},{x:12,y:7},{x:12,y:8},{x:12,y:9},{x:13,y:9},{x:14,y:9},{x:15,y:9},{x:16,y:9},{x:17,y:9},{x:18,y:9},{x:19,y:9},{x:20,y:9},{x:20,y:10},{x:20,y:11}],
  terrainPatches:[
    {id:"dry:patch:cracked-pan",role:"cracked-earth",tiles:[{x:3,y:3},{x:4,y:3},{x:5,y:3},{x:6,y:3},{x:3,y:4},{x:4,y:4},{x:5,y:4},{x:6,y:4},{x:3,y:5},{x:4,y:5},{x:5,y:5},{x:6,y:5}]},
    {id:"dry:patch:pebble-fan",role:"wind-scoured-band",tiles:[{x:13,y:10},{x:14,y:10},{x:15,y:10},{x:16,y:10},{x:13,y:11},{x:14,y:11},{x:15,y:11},{x:16,y:11},{x:13,y:12},{x:14,y:12},{x:15,y:12},{x:16,y:12}]},
  ],
  groundRecipeGrid:[
    [0,3,0,1,3,0,1,3,2,1,0,1,3,2,1,3,2,0,3,2,0,3,2,3],
    [2,1,3,0,2,3,2,0,1,2,3,1,2,1,0,2,3,3,0,1,3,0,3,2],
    [1,2,1,3,1,1,6,5,6,1,0,3,0,1,2,0,2,1,3,7,6,5,0,1],
    [3,1,0,2,0,4,7,6,4,6,2,0,2,3,3,1,2,0,7,4,5,7,2,3],
    [2,0,2,1,7,4,5,4,6,7,0,3,1,0,1,2,3,4,5,6,7,5,0,2],
    [0,3,2,6,5,7,6,4,7,5,6,1,3,1,0,3,4,6,4,5,6,4,1,0],
    [1,3,7,5,6,6,4,7,5,4,7,1,2,3,0,2,7,4,5,4,6,2,3,1],
    [2,6,5,4,5,4,5,4,7,7,5,2,0,2,1,3,0,6,7,5,4,7,2,1],
    [0,3,4,7,6,7,6,5,6,5,3,0,1,3,2,0,5,4,7,4,5,1,0,3],
    [1,0,3,5,4,5,7,6,4,1,2,3,1,0,3,6,7,5,6,4,6,2,0,2],
    [3,1,2,0,5,6,4,6,3,0,1,0,2,1,5,7,4,6,5,6,1,0,2,1],
    [0,3,0,2,1,7,5,2,1,3,0,2,3,5,7,4,5,4,6,7,3,1,2,0],
    [1,0,3,1,0,3,2,3,0,2,3,1,6,4,7,5,6,4,7,3,0,2,1,0],
    [0,1,2,0,1,2,0,1,3,1,2,7,4,6,5,7,4,5,3,1,3,0,2,2],
    [3,0,1,2,0,3,2,0,0,3,4,5,7,4,6,7,5,0,2,3,1,2,3,1],
    [1,3,2,3,1,0,3,0,1,7,6,6,5,7,6,5,2,1,0,2,3,3,0,3],
  ],
  waterTiles:[],shoreTiles:[],bridgeTiles:[],
  landmarks:[
    {variantId:"dry-scrub:wind-cut-diagonal-ridge",clusterId:"dry-outcrop-east",role:"track-bend-outcrop",x:512,y:56,cell:2},
    {variantId:"dry-scrub:crescent-open-south",clusterId:"dry-tangle-pass",role:"thorn-opening",x:352,y:120,cell:3},
    {variantId:"dry-scrub:rising-diagonal-wind",clusterId:"dry-scrub-band",role:"one-direction-scrub",x:416,y:208,cell:6},
    {variantId:"dry-scrub:split-outcrop",clusterId:"dry-ridge-home",role:"yard-windbreak-return",x:576,y:152,cell:1},
  ],
  supports:[
    {id:"dry:support:stone-a",clusterId:"dry-outcrop-east",role:"sandstone-chip",landmarkVariantId:"dry-scrub:wind-cut-diagonal-ridge",sceneryKind:"sun-rock",variantOrdinal:0,cell:0,x:512,y:160},
    {id:"dry:support:pebble-a",clusterId:"dry-outcrop-east",role:"pebble-fan",landmarkVariantId:"dry-scrub:wind-cut-diagonal-ridge",sceneryKind:"sun-rock",variantOrdinal:1,cell:4,x:608,y:160},
    {id:"dry:support:root-a",clusterId:"dry-tangle-pass",role:"deadwood-root",landmarkVariantId:"dry-scrub:crescent-open-south",sceneryKind:"deadwood",variantOrdinal:0,cell:1,x:352,y:224},
    {id:"dry:support:thorn-a",clusterId:"dry-tangle-pass",role:"thorn-return",landmarkVariantId:"dry-scrub:crescent-open-south",sceneryKind:"thorn",variantOrdinal:0,cell:3,x:448,y:224},
    {id:"dry:support:scrub-a",clusterId:"dry-scrub-band",role:"wind-scrub",landmarkVariantId:"dry-scrub:rising-diagonal-wind",sceneryKind:"dry-grass",variantOrdinal:0,cell:2,x:416,y:288},
    {id:"dry:support:ripple-a",clusterId:"dry-scrub-band",role:"sand-ripple",landmarkVariantId:"dry-scrub:rising-diagonal-wind",sceneryKind:"dry-grass",variantOrdinal:1,cell:6,x:512,y:288},
    {id:"dry:support:stone-b",clusterId:"dry-ridge-home",role:"windbreak-stone",landmarkVariantId:"dry-scrub:split-outcrop",sceneryKind:"sun-rock",variantOrdinal:2,cell:8,x:576,y:256},
    {id:"dry:support:post-a",clusterId:"dry-ridge-home",role:"shade-post",landmarkVariantId:"dry-scrub:split-outcrop",sceneryKind:"deadwood",variantOrdinal:1,cell:5,x:672,y:256},
  ],
  yard:{recipeId:"dry:yard:standing-a",originPx:{x:560,y:256},contactPivotPx:{x:96,y:112},connectionPorts:[{side:"south",startPx:80,widthPx:32,role:"path"}],doorClearancePx:{x:81,y:73,width:30,height:48}},
  home:{plotTile:{x:18,y:8},plotCenterPx:{x:592,y:272},doorTile:{x:20,y:11},doorCenterPx:{x:656,y:368}},
};

const ASH_SCENE_PLAN = {
  kitId:"ash-waste",widthTiles:24,heightTiles:16,
  sentence:["industrial-irradiated-crater","fractured-service-route","containment-pylon-cluster","slag-shelter-terminus"],
  routeGrammar:{start:{x:4,y:15},turns:[{x:4,y:11},{x:10,y:11},{x:10,y:7},{x:15,y:7},{x:15,y:10},{x:19,y:10}],terminus:{x:19,y:12}},
  routeTiles:[{x:4,y:15},{x:4,y:14},{x:4,y:13},{x:4,y:12},{x:4,y:11},{x:5,y:11},{x:6,y:11},{x:7,y:11},{x:8,y:11},{x:9,y:11},{x:10,y:11},{x:10,y:10},{x:10,y:9},{x:10,y:8},{x:10,y:7},{x:11,y:7},{x:12,y:7},{x:13,y:7},{x:14,y:7},{x:15,y:7},{x:15,y:8},{x:15,y:9},{x:15,y:10},{x:16,y:10},{x:17,y:10},{x:18,y:10},{x:19,y:10},{x:19,y:11},{x:19,y:12}],
  terrainPatches:[
    {id:"ash:patch:crater-ejecta",role:"broad-ash-field",tiles:[{x:2,y:8},{x:3,y:8},{x:4,y:8},{x:5,y:8},{x:2,y:9},{x:3,y:9},{x:4,y:9},{x:5,y:9},{x:2,y:10},{x:3,y:10},{x:4,y:10},{x:5,y:10}]},
    {id:"ash:patch:service-slabs",role:"fractured-service-slab",tiles:[{x:10,y:6},{x:11,y:6},{x:12,y:6},{x:13,y:6},{x:10,y:7},{x:11,y:7},{x:12,y:7},{x:13,y:7},{x:10,y:8},{x:11,y:8},{x:12,y:8},{x:13,y:8}]},
    {id:"ash:patch:slag-return",role:"overlapping-slag",tiles:[{x:16,y:9},{x:17,y:9},{x:18,y:9},{x:19,y:9},{x:16,y:10},{x:17,y:10},{x:18,y:10},{x:19,y:10},{x:16,y:11},{x:17,y:11},{x:18,y:11},{x:19,y:11}]},
  ],
  groundRecipeGrid:[
    [2,1,3,2,0,1,3,2,3,0,3,0,0,1,0,3,2,0,3,1,0,1,3,1],
    [1,3,1,0,2,3,2,0,1,1,2,1,3,0,2,2,0,3,1,0,1,3,2,2],
    [0,2,3,3,1,7,4,6,0,3,2,1,0,1,2,0,1,2,5,4,4,2,0,3],
    [3,0,2,0,7,6,6,5,6,1,0,2,3,3,1,0,3,6,4,7,5,1,2,0],
    [1,2,0,4,5,4,7,6,5,5,3,1,0,2,3,2,5,7,6,4,7,3,1,2],
    [0,3,5,7,4,5,6,4,7,6,5,3,2,0,1,7,4,5,7,6,5,0,2,3],
    [0,6,4,6,7,4,5,7,6,4,7,0,3,1,0,5,4,6,7,4,6,1,3,1],
    [3,5,7,4,6,5,6,4,5,6,4,2,1,2,3,1,6,4,5,7,4,5,1,2],
    [2,1,5,7,4,7,6,7,4,5,3,1,2,0,2,1,7,6,7,5,7,2,0,3],
    [1,0,3,6,5,4,5,6,5,3,0,3,0,1,3,4,4,7,6,4,5,2,1,0],
    [3,2,0,3,4,6,7,5,3,0,1,3,2,0,5,5,7,4,7,6,2,3,2,1],
    [1,3,2,1,3,7,4,3,1,2,3,1,1,6,7,7,6,5,4,7,0,1,3,2],
    [2,1,3,2,1,0,0,2,0,1,0,2,6,4,6,6,7,6,5,1,2,3,0,3],
    [1,2,0,3,2,0,1,3,2,3,0,7,5,7,4,6,6,4,3,2,0,2,3,0],
    [0,1,2,1,0,3,2,0,1,2,6,7,4,5,5,4,7,2,0,0,3,1,2,1],
    [3,2,3,0,1,0,3,2,0,4,4,6,5,6,6,5,3,0,2,1,3,0,1,2],
  ],
  waterTiles:[],shoreTiles:[],bridgeTiles:[],
  landmarks:[
    {variantId:"ash-waste:offset-crater-branching-fault",clusterId:"ash-crater-edge",role:"irradiated-crater",x:64,y:288,cell:0},
    {variantId:"ash-waste:snapped-cross-member",clusterId:"ash-pylon-service",role:"containment-pylon",x:288,y:140,cell:2},
    {variantId:"ash-waste:industrial-aggregate-ridge",clusterId:"ash-slag-crossing",role:"slag-rebar-ridge",x:416,y:216,cell:5},
    {variantId:"ash-waste:joined-containment-debris-fan",clusterId:"ash-shelter-debris",role:"joined-containment-debris",x:544,y:264,cell:7},
  ],
  supports:[
    {id:"ash:support:ejecta-a",clusterId:"ash-crater-edge",role:"crater-ejecta",landmarkVariantId:"ash-waste:offset-crater-branching-fault",sceneryKind:"ash-pile",variantOrdinal:0,cell:2,x:64,y:352},
    {id:"ash:support:fissure-a",clusterId:"ash-crater-edge",role:"coral-fissure",landmarkVariantId:"ash-waste:offset-crater-branching-fault",sceneryKind:"bone-stone",variantOrdinal:0,cell:3,x:160,y:320},
    {id:"ash:support:insulator-a",clusterId:"ash-pylon-service",role:"snapped-insulator",landmarkVariantId:"ash-waste:snapped-cross-member",sceneryKind:"slag-rock",variantOrdinal:0,cell:1,x:288,y:256},
    {id:"ash:support:cable-a",clusterId:"ash-pylon-service",role:"cable-scrap",landmarkVariantId:"ash-waste:snapped-cross-member",sceneryKind:"charred-trunk",variantOrdinal:0,cell:0,x:384,y:256},
    {id:"ash:support:slag-a",clusterId:"ash-slag-crossing",role:"slag-patch",landmarkVariantId:"ash-waste:industrial-aggregate-ridge",sceneryKind:"slag-rock",variantOrdinal:1,cell:5,x:416,y:320},
    {id:"ash:support:rebar-a",clusterId:"ash-slag-crossing",role:"bent-rebar",landmarkVariantId:"ash-waste:industrial-aggregate-ridge",sceneryKind:"charred-trunk",variantOrdinal:1,cell:4,x:512,y:320},
    {id:"ash:support:filter-a",clusterId:"ash-shelter-debris",role:"sealed-filter-box",landmarkVariantId:"ash-waste:joined-containment-debris-fan",sceneryKind:"bone-stone",variantOrdinal:1,cell:7,x:544,y:352},
    {id:"ash:support:conduit-a",clusterId:"ash-shelter-debris",role:"collapsed-conduit",landmarkVariantId:"ash-waste:joined-containment-debris-fan",sceneryKind:"charred-trunk",variantOrdinal:2,cell:8,x:640,y:352},
  ],
  yard:{recipeId:"ash:yard:standing-a",originPx:{x:528,y:288},contactPivotPx:{x:96,y:112},connectionPorts:[{side:"south",startPx:80,widthPx:32,role:"path"}],doorClearancePx:{x:81,y:73,width:30,height:48}},
  home:{plotTile:{x:17,y:9},plotCenterPx:{x:560,y:304},doorTile:{x:19,y:12},doorCenterPx:{x:624,y:400}},
};

const NEUTRAL_SCENE_PLAN = {
  kitId:"neutral-temperate",widthTiles:24,heightTiles:16,
  sentence:["small-field-pond","pale-lane-wall-gate","airy-grove-frame","meadow-home-terminus"],
  routeGrammar:{start:{x:8,y:0},turns:[{x:8,y:4},{x:5,y:4},{x:5,y:8},{x:12,y:8},{x:12,y:13}],terminus:{x:17,y:13}},
  routeTiles:[{x:8,y:0},{x:8,y:1},{x:8,y:2},{x:8,y:3},{x:8,y:4},{x:7,y:4},{x:6,y:4},{x:5,y:4},{x:5,y:5},{x:5,y:6},{x:5,y:7},{x:5,y:8},{x:6,y:8},{x:7,y:8},{x:8,y:8},{x:9,y:8},{x:10,y:8},{x:11,y:8},{x:12,y:8},{x:12,y:9},{x:12,y:10},{x:12,y:11},{x:12,y:12},{x:12,y:13},{x:13,y:13},{x:14,y:13},{x:15,y:13},{x:16,y:13},{x:17,y:13}],
  terrainPatches:[
    {id:"neutral:patch:damp-verge",role:"damp-field-verge",tiles:[{x:2,y:5},{x:3,y:5},{x:4,y:5},{x:5,y:5},{x:2,y:6},{x:3,y:6},{x:4,y:6},{x:5,y:6},{x:2,y:7},{x:3,y:7},{x:4,y:7},{x:5,y:7}]},
    {id:"neutral:patch:meadow-boundary",role:"blue-green-meadow",tiles:[{x:13,y:10},{x:14,y:10},{x:15,y:10},{x:16,y:10},{x:13,y:11},{x:14,y:11},{x:15,y:11},{x:16,y:11},{x:13,y:12},{x:14,y:12},{x:15,y:12},{x:16,y:12}]},
  ],
  groundRecipeGrid:[
    [1,2,3,3,2,1,2,3,1,2,0,1,0,3,0,0,3,0,1,2,3,0,2,1],
    [0,2,0,2,0,3,1,2,0,3,2,3,1,0,1,2,1,2,3,1,0,2,1,0],
    [3,1,3,1,2,5,7,0,3,1,0,2,3,2,1,3,2,6,4,0,2,1,3,0],
    [1,0,2,0,5,7,6,5,1,2,3,0,2,1,3,2,6,7,4,3,1,0,1,3],
    [2,3,1,5,7,6,4,6,7,3,1,2,0,3,0,4,5,6,7,0,3,2,0,1],
    [3,0,4,4,6,5,7,4,6,5,2,3,1,0,4,5,4,5,6,5,1,0,2,2],
    [0,4,6,5,4,6,4,7,6,7,6,0,3,1,3,7,6,4,5,6,5,1,0,1],
    [3,6,7,6,5,4,5,6,4,7,4,2,1,2,0,2,5,6,7,5,7,3,2,3],
    [1,3,4,5,7,5,6,4,7,5,0,3,3,0,1,3,6,5,4,7,5,2,3,0],
    [2,0,3,7,6,4,7,5,4,2,2,3,0,3,2,6,7,4,5,6,2,1,0,3],
    [3,0,1,2,5,4,5,4,0,1,1,0,2,1,7,5,6,7,4,5,3,2,1,1],
    [0,2,0,3,1,5,7,2,1,3,0,1,0,5,6,7,5,7,6,4,1,3,2,3],
    [2,1,3,0,2,3,1,3,2,1,3,2,6,7,4,7,4,5,6,1,2,0,0,1],
    [0,3,2,1,0,2,3,0,3,2,1,6,7,5,4,6,7,4,0,1,0,2,1,2],
    [0,3,0,1,2,0,1,3,2,0,4,5,6,7,7,4,6,0,2,3,2,3,1,2],
    [3,1,3,2,3,1,0,2,3,4,7,6,7,6,5,6,1,0,3,2,0,1,3,0],
  ],
  waterTiles:[{x:3,y:3},{x:2,y:4},{x:3,y:4},{x:4,y:4},{x:3,y:5},{x:4,y:5}],
  shoreTiles:[{x:2,y:3},{x:4,y:3},{x:1,y:4},{x:5,y:4},{x:2,y:5},{x:3,y:6},{x:4,y:6}],
  bridgeTiles:[],
  landmarks:[
    {variantId:"neutral-temperate:broad-crown",clusterId:"neutral-grove-north",role:"airy-grove-frame",x:192,y:16,cell:0},
    {variantId:"neutral-temperate:boundary-open-south",clusterId:"neutral-wall-gate",role:"lane-wall-gate",x:128,y:160,cell:3},
    {variantId:"neutral-temperate:diagonal-verge",clusterId:"neutral-lane-verge",role:"damp-verge-return",x:288,y:192,cell:7},
    {variantId:"neutral-temperate:sparse-open-grove",clusterId:"neutral-grove-home",role:"meadow-home-frame",x:384,y:272,cell:2},
  ],
  supports:[
    {id:"neutral:support:understory-a",clusterId:"neutral-grove-north",role:"open-understory",landmarkVariantId:"neutral-temperate:broad-crown",sceneryKind:"soft-grass",variantOrdinal:0,cell:3,x:192,y:128},
    {id:"neutral:support:tree-a",clusterId:"neutral-grove-north",role:"secondary-tree",landmarkVariantId:"neutral-temperate:broad-crown",sceneryKind:"broad-tree",variantOrdinal:0,cell:0,x:288,y:128},
    {id:"neutral:support:stone-a",clusterId:"neutral-wall-gate",role:"field-stone-return",landmarkVariantId:"neutral-temperate:boundary-open-south",sceneryKind:"field-rock",variantOrdinal:0,cell:1,x:128,y:256},
    {id:"neutral:support:hedge-a",clusterId:"neutral-wall-gate",role:"hedgerow-return",landmarkVariantId:"neutral-temperate:boundary-open-south",sceneryKind:"soft-grass",variantOrdinal:1,cell:7,x:224,y:256},
    {id:"neutral:support:flower-a",clusterId:"neutral-lane-verge",role:"wildflower-gap",landmarkVariantId:"neutral-temperate:diagonal-verge",sceneryKind:"wildflower",variantOrdinal:0,cell:2,x:288,y:288},
    {id:"neutral:support:verge-a",clusterId:"neutral-lane-verge",role:"damp-verge",landmarkVariantId:"neutral-temperate:diagonal-verge",sceneryKind:"soft-grass",variantOrdinal:2,cell:11,x:384,y:288},
    {id:"neutral:support:bench-a",clusterId:"neutral-grove-home",role:"plain-bench",landmarkVariantId:"neutral-temperate:sparse-open-grove",sceneryKind:"broad-tree",variantOrdinal:1,cell:4,x:384,y:384},
    {id:"neutral:support:herb-a",clusterId:"neutral-grove-home",role:"herb-bed",landmarkVariantId:"neutral-temperate:sparse-open-grove",sceneryKind:"wildflower",variantOrdinal:1,cell:6,x:480,y:384},
  ],
  yard:{recipeId:"neutral:yard:standing-a",originPx:{x:464,y:320},contactPivotPx:{x:96,y:112},connectionPorts:[{side:"south",startPx:80,widthPx:32,role:"path"}],doorClearancePx:{x:81,y:73,width:30,height:48}},
  home:{plotTile:{x:15,y:10},plotCenterPx:{x:496,y:336},doorTile:{x:17,y:13},doorCenterPx:{x:560,y:432}},
};

function deepFreeze(value, visited = new Set()) {
  if (value === null || typeof value !== "object" || visited.has(value)) return value;
  visited.add(value);
  for (const child of Object.values(value)) deepFreeze(child, visited);
  return Object.freeze(value);
}

function isDeepFrozen(value, visited = new Set()) {
  if (value === null || typeof value !== "object" || visited.has(value)) return true;
  visited.add(value);
  return Object.isFrozen(value) && Object.values(value).every((child) => isDeepFrozen(child, visited));
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalGeometry(recipe) {
  return canonical({
    semanticKind: recipe.semanticKind,
    topologyKey: recipe.topologyKey,
    operations: recipe.operations.map((entry) => {
      if (entry.kind === "polygon" || entry.kind === "cluster") return { kind: entry.kind, points: entry.points };
      if (entry.kind === "rect") return { kind: entry.kind, x: entry.x, y: entry.y, width: entry.width, height: entry.height };
      return { kind: entry.kind, from: entry.from, to: entry.to, width: entry.width };
    }),
  });
}

function operationPoints(entry) {
  if (entry.kind === "polygon" || entry.kind === "cluster") return entry.points;
  if (entry.kind === "rect") return [[entry.x, entry.y], [entry.x + entry.width, entry.y + entry.height]];
  if (entry.kind === "line") return [entry.from, entry.to];
  return [];
}

function normalizedGeometrySignature(recipe) {
  const pointsByOperation = recipe.operations.map(operationPoints);
  const allPoints = pointsByOperation.flat();
  if (allPoints.length === 0) return `empty:${recipe.semanticKind}:${recipe.topologyKey}`;
  const candidates = [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => {
    const transformed = allPoints.map(([x, y]) => [x * sx, y * sy]);
    const minX = Math.min(...transformed.map(([x]) => x));
    const minY = Math.min(...transformed.map(([, y]) => y));
    let cursor = 0;
    const operations = recipe.operations.map((entry, index) => {
      const points = transformed.slice(cursor, cursor + pointsByOperation[index].length)
        .map(([x, y]) => [x - minX, y - minY])
        .sort(([ax, ay], [bx, by]) => ax - bx || ay - by);
      cursor += pointsByOperation[index].length;
      return { kind: entry.kind, width: entry.width ?? null, points };
    }).sort((left, right) => canonical(left).localeCompare(canonical(right)));
    return canonical({ semanticKind: recipe.semanticKind, topologyKey: recipe.topologyKey, operations });
  });
  return candidates.sort()[0];
}

function normalizedOperationGeometrySignature(recipe) {
  return normalizedGeometrySignature({
    ...recipe,
    semanticKind: "yard-geometry",
    topologyKey: "yard-geometry",
  });
}

function stringValues(value, visited = new Set()) {
  if (typeof value === "string") return [value];
  if (value === null || typeof value !== "object" || visited.has(value)) return [];
  visited.add(value);
  return Object.values(value).flatMap((child) => stringValues(child, visited));
}

function semanticTokens(value) {
  return stringValues(value).flatMap((entry) => entry.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean));
}

function polygonContains(points, x, y) {
  let inside = false;
  for (let index = 0, previous = points.length - 1; index < points.length; previous = index, index += 1) {
    const [xi, yi] = points[index];
    const [xj, yj] = points[previous];
    if (((yi > y) !== (yj > y)) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function groundMask(recipe) {
  if (!Array.isArray(recipe?.operations)) return null;
  const mask = new Set();
  for (const entry of recipe.operations) {
    if (!Array.isArray(entry?.points) || entry.points.some((point) => (
      !Array.isArray(point) || point.length !== 2 || !point.every(Number.isFinite)
    ))) return null;
    if (entry.kind === "polygon") {
      for (let y = 0; y < 32; y += 1) for (let x = 0; x < 32; x += 1) {
        if (polygonContains(entry.points, x + 0.5, y + 0.5)) mask.add(`${x},${y}`);
      }
    } else if (entry.kind === "cluster") {
      for (const [x, y] of entry.points) {
        mask.add(`${x},${y}`);
        mask.add(`${x + (x + 1 < 32 ? 1 : -1)},${y}`);
        mask.add(`${x},${y + (y + 1 < 32 ? 1 : -1)}`);
      }
    } else return null;
  }
  return [...mask].map((entry) => entry.split(",").map(Number));
}

function normalizedMaskVariants(recipe) {
  const mask = groundMask(recipe);
  if (!mask || mask.length === 0) return null;
  return [[1, 1], [-1, 1], [1, -1], [-1, -1]].map(([sx, sy]) => {
    const transformed = mask.map(([x, y]) => [x * sx, y * sy]);
    const minX = Math.min(...transformed.map(([x]) => x));
    const minY = Math.min(...transformed.map(([, y]) => y));
    return new Set(transformed.map(([x, y]) => `${x - minX},${y - minY}`));
  });
}

function jaccard(left, right) {
  let intersection = 0;
  for (const key of left) if (right.has(key)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function groundGeometrySimilarity(left, right) {
  const leftMasks = normalizedMaskVariants(left);
  const rightMasks = normalizedMaskVariants(right);
  if (!leftMasks || !rightMasks) return null;
  return Math.max(...leftMasks.flatMap((leftMask) => rightMasks.map((rightMask) => jaccard(leftMask, rightMask))));
}

function binaryCorrelation(pairs) {
  let sumLeft = 0;
  let sumRight = 0;
  let sumBoth = 0;
  for (const [left, right] of pairs) {
    sumLeft += left;
    sumRight += right;
    sumBoth += left * right;
  }
  const count = pairs.length;
  const numerator = count * sumBoth - sumLeft * sumRight;
  const denominator = Math.sqrt(
    (count * sumLeft - sumLeft ** 2) * (count * sumRight - sumRight ** 2),
  );
  return denominator === 0 ? 1 : numerator / denominator;
}

function groundFamilyMaskRows(grid) {
  return grid.map((row) => row.map((variant) => Number(variant >= 4)).join(""));
}

function findWithinFamilyCheckerboards(grid) {
  const coordinates = [];
  for (let y = 0; y <= grid.length - 4; y += 1) for (let x = 0; x <= grid[0].length - 4; x += 1) {
    const family = grid[y][x] >= 4;
    let oneFamily = true;
    let repeatsX = true;
    let repeatsY = true;
    for (let offsetY = 0; offsetY < 4; offsetY += 1) for (let offsetX = 0; offsetX < 4; offsetX += 1) {
      if ((grid[y + offsetY][x + offsetX] >= 4) !== family) oneFamily = false;
      if (offsetX < 2 && grid[y + offsetY][x + offsetX] !== grid[y + offsetY][x + offsetX + 2]) repeatsX = false;
      if (offsetY < 2 && grid[y + offsetY][x + offsetX] !== grid[y + offsetY + 2][x + offsetX]) repeatsY = false;
    }
    if (oneFamily && repeatsX && repeatsY) coordinates.push(`${x},${y}`);
  }
  return coordinates;
}

/** Return every exact whole-grid cardinal translation period from two through eight. */
export function findRegionalR4TranslatedPeriods(grid) {
  if (!Array.isArray(grid) || grid.length === 0 || !Array.isArray(grid[0]) || grid[0].length === 0) return [];
  const height = grid.length;
  const width = grid[0].length;
  if (grid.some((row) => !Array.isArray(row) || row.length !== width)) return [];
  const periods = [];
  for (let shift = 2; shift <= 8; shift += 1) for (const [dx, dy, axis] of [[shift, 0, "x"], [0, shift, "y"]]) {
    let comparisons = 0;
    let exact = true;
    for (let y = 0; y < height - dy && exact; y += 1) for (let x = 0; x < width - dx; x += 1) {
      comparisons += 1;
      if (grid[y][x] !== grid[y + dy][x + dx]) {
        exact = false;
        break;
      }
    }
    if (exact && comparisons > 0) periods.push(`${axis}${shift}`);
  }
  return periods;
}

function groundGridMetrics(recipes, grid) {
  if (!Array.isArray(recipes) || recipes.length !== 8) return null;
  const masks = [];
  for (const recipe of recipes) {
    const points = groundMask(recipe);
    if (!points || points.length === 0) return null;
    const occupied = new Set(points.map(([x, y]) => `${x},${y}`));
    masks.push(Uint8Array.from({ length: 32 * 32 }, (_unused, pixel) => (
      occupied.has(`${pixel % 32},${Math.floor(pixel / 32)}`) ? 1 : 0
    )));
  }
  const shifts = [];
  for (let shift = 1; shift <= 8; shift += 1) for (const [dx, dy, axis] of [[shift, 0, "x"], [0, shift, "y"]]) {
    const pixelPairs = [];
    let coordinatePairs = 0;
    let sameVariantPairs = 0;
    for (let y = 0; y < 16 - dy; y += 1) for (let x = 0; x < 24 - dx; x += 1) {
      const leftVariant = grid[y][x];
      const rightVariant = grid[y + dy][x + dx];
      coordinatePairs += 1;
      if (leftVariant === rightVariant) sameVariantPairs += 1;
      for (let pixel = 0; pixel < 32 * 32; pixel += 1) {
        pixelPairs.push([masks[leftVariant][pixel], masks[rightVariant][pixel]]);
      }
    }
    shifts.push({
      axis,
      shift,
      coordinatePairs,
      sameVariantPairs,
      sameVariantRatio: sameVariantPairs / coordinatePairs,
      autocorrelation: Math.abs(binaryCorrelation(pixelPairs)),
    });
  }
  const counts = Array(8).fill(0);
  for (const row of grid) for (const variant of row) counts[variant] += 1;
  let maximumCardinalRun = 1;
  for (const row of grid) {
    let run = 1;
    for (let x = 1; x < row.length; x += 1) {
      run = row[x] === row[x - 1] ? run + 1 : 1;
      maximumCardinalRun = Math.max(maximumCardinalRun, run);
    }
  }
  for (let x = 0; x < grid[0].length; x += 1) {
    let run = 1;
    for (let y = 1; y < grid.length; y += 1) {
      run = grid[y][x] === grid[y - 1][x] ? run + 1 : 1;
      maximumCardinalRun = Math.max(maximumCardinalRun, run);
    }
  }
  let monochromeTwoByTwoCount = 0;
  for (let y = 0; y < 15; y += 1) for (let x = 0; x < 23; x += 1) {
    if (new Set([grid[y][x], grid[y][x + 1], grid[y + 1][x], grid[y + 1][x + 1]]).size === 1) {
      monochromeTwoByTwoCount += 1;
    }
  }
  let minimumFourByFourVariety = 8;
  for (let y = 0; y <= 12; y += 1) for (let x = 0; x <= 20; x += 1) {
    const variants = new Set();
    for (let offsetY = 0; offsetY < 4; offsetY += 1) for (let offsetX = 0; offsetX < 4; offsetX += 1) {
      variants.add(grid[y + offsetY][x + offsetX]);
    }
    minimumFourByFourVariety = Math.min(minimumFourByFourVariety, variants.size);
  }
  const materialZoneCounts = [Array(8).fill(0), Array(8).fill(0)];
  const materialZoneTotals = [0, 0];
  let familyAdjacentPairs = 0;
  let familyTransitions = 0;
  for (let y = 0; y < 16; y += 1) for (let x = 0; x < 24; x += 1) {
    const variant = grid[y][x];
    const family = variant >= 4 ? 1 : 0;
    materialZoneCounts[family][variant] += 1;
    materialZoneTotals[family] += 1;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      if (y + dy >= 16 || x + dx >= 24) continue;
      familyAdjacentPairs += 1;
      if ((grid[y + dy][x + dx] >= 4 ? 1 : 0) !== family) familyTransitions += 1;
    }
  }
  const adjacent = shifts.filter(({ shift }) => shift === 1);
  return {
    maximumVariantShare: Math.max(...counts) / 384,
    maximumMaterialZoneShare: Math.max(
      ...materialZoneCounts.map((zoneCounts, family) => Math.max(...zoneCounts) / materialZoneTotals[family]),
    ),
    clusteredMaterialShare: materialZoneTotals[1] / 384,
    familyTransitionRatio: familyTransitions / familyAdjacentPairs,
    adjacentSameVariantRatio: adjacent.reduce((sum, entry) => sum + entry.sameVariantPairs, 0)
      / adjacent.reduce((sum, entry) => sum + entry.coordinatePairs, 0),
    maximumCardinalRun,
    monochromeTwoByTwoCount,
    minimumFourByFourVariety,
    maximumAutocorrelation: Math.max(...shifts.map(({ autocorrelation }) => autocorrelation)),
    shifts,
  };
}

function validateGroundGrid(errors, prefix, recipes, grid, expectedFamilyMaskRows) {
  if (canonical(groundFamilyMaskRows(grid)) !== canonical(expectedFamilyMaskRows)) {
    errors.push(`${prefix}: ground-grid calm/cluster family-mask drifted (cross-zone leakage/global shuffle)`);
  }
  const checkerboards = findWithinFamilyCheckerboards(grid);
  if (checkerboards.length > 0) {
    errors.push(`${prefix}: ground-grid within-family checkerboard/short period at ${checkerboards[0]}`);
  }
  const metrics = groundGridMetrics(recipes, grid);
  if (metrics === null) {
    errors.push(`${prefix}: ground-grid metrics require eight valid rendered ground masks`);
    return;
  }
  if (metrics.maximumVariantShare > 0.22) errors.push(`${prefix}: ground-grid variant dominance exceeds 0.22`);
  if (metrics.adjacentSameVariantRatio > MAX_GROUND_GRID_ADJACENCY) errors.push(`${prefix}: ground-grid adjacency exceeds ${MAX_GROUND_GRID_ADJACENCY}`);
  if (metrics.maximumAutocorrelation > MAX_GROUND_GRID_AUTOCORRELATION) errors.push(`${prefix}: ground-grid autocorrelation exceeds ${MAX_GROUND_GRID_AUTOCORRELATION}`);
  if (metrics.maximumMaterialZoneShare > 0.5) errors.push(`${prefix}: ground-grid recipe dominates its calm or clustered zone`);
  if (metrics.clusteredMaterialShare < 0.3 || metrics.clusteredMaterialShare > 0.42) errors.push(`${prefix}: ground-grid calm/cluster zone balance drifted`);
  if (metrics.familyTransitionRatio > MAX_GROUND_GRID_FAMILY_TRANSITIONS) errors.push(`${prefix}: ground-grid zones were globally shuffled`);
  if (metrics.maximumCardinalRun > 2) errors.push(`${prefix}: ground-grid cardinal same-ID run exceeds two`);
  if (metrics.monochromeTwoByTwoCount > 0) errors.push(`${prefix}: ground-grid contains a monochrome 2x2`);
  if (metrics.minimumFourByFourVariety < 3) errors.push(`${prefix}: ground-grid interior 4x4 lacks three compatible variants`);
  for (const shift of metrics.shifts) {
    if (shift.coordinatePairs <= 0 || shift.sameVariantPairs <= 0 || shift.sameVariantPairs >= shift.coordinatePairs) {
      errors.push(`${prefix}: ground-grid ${shift.axis}${shift.shift} cycle non-vacuity failed`);
    }
  }
  for (const period of findRegionalR4TranslatedPeriods(grid)) {
    errors.push(`${prefix}: ground-grid exact translated period ${period}`);
  }
}

function exactKeys(value, expected) {
  return value !== null && typeof value === "object"
    && canonical(Object.keys(value).sort()) === canonical([...expected].sort());
}

function semanticCounts(recipes) {
  const result = {};
  for (const recipe of recipes) result[recipe.semanticKind] = (result[recipe.semanticKind] ?? 0) + 1;
  return result;
}

function hasFunction(value, visited = new Set()) {
  if (typeof value === "function") return true;
  if (value === null || typeof value !== "object" || visited.has(value)) return false;
  visited.add(value);
  return Object.values(value).some((child) => hasFunction(child, visited));
}

function recipePointBounds(family) {
  if (family === "ground") return { width: 32, height: 32 };
  if (family === "landmarks") return { width: 128, height: 128 };
  return { width: 192, height: 160 };
}

function validateOperation(errors, kit, family, recipe, entry, operationIndex) {
  const prefix = `${kit}/${recipe.id}/operation ${operationIndex}`;
  const bounds = recipePointBounds(family);
  if (entry === null || typeof entry !== "object") {
    errors.push(`${prefix}: operation must be an object`);
    return;
  }
  const schemas = {
    polygon: ["kind", "material", "points"],
    cluster: ["kind", "material", "points"],
    rect: ["kind", "material", "x", "y", "width", "height"],
    line: ["kind", "material", "from", "to", "width"],
  };
  const expectedKeys = schemas[entry.kind];
  if (!expectedKeys) {
    errors.push(`${prefix}: unknown operation kind ${String(entry.kind)}`);
    return;
  }
  const extras = Object.keys(entry).filter((key) => !expectedKeys.includes(key));
  const missing = expectedKeys.filter((key) => !(key in entry));
  if (extras.length > 0 || missing.length > 0) {
    errors.push(`${prefix}: unknown operation key or missing field (${[...extras, ...missing].join(",")})`);
  }
  if (!MATERIALS[kit].has(entry.material)) errors.push(`${prefix}: unknown material ${String(entry.material)}`);
  let points = [];
  if (entry.kind === "polygon" || entry.kind === "cluster") {
    if (!Array.isArray(entry.points) || entry.points.length < 2) errors.push(`${prefix}: nonempty points are required`);
    else points = entry.points;
  } else if (entry.kind === "rect") {
    const values = [entry.x, entry.y, entry.width, entry.height];
    if (!values.every(Number.isInteger)) errors.push(`${prefix}: rect values must be integer`);
    if (!(entry.width > 0 && entry.height > 0)) errors.push(`${prefix}: rect dimensions must be positive`);
    points = [[entry.x, entry.y], [entry.x + entry.width - 1, entry.y + entry.height - 1]];
  } else {
    const values = [...(Array.isArray(entry.from) ? entry.from : []), ...(Array.isArray(entry.to) ? entry.to : []), entry.width];
    if (values.length !== 5 || !values.every(Number.isInteger)) errors.push(`${prefix}: line endpoints and width must be integer`);
    if (!(entry.width > 0)) errors.push(`${prefix}: line width must be positive`);
    points = [entry.from, entry.to];
  }
  for (const point of points) {
    if (!Array.isArray(point) || point.length !== 2 || !point.every(Number.isInteger)) {
      errors.push(`${prefix}: point coordinates must be integer`);
      continue;
    }
    if (point[0] < 0 || point[1] < 0 || point[0] >= bounds.width || point[1] >= bounds.height) {
      errors.push(`${prefix}: point ${point.join(",")} is outside ${bounds.width}x${bounds.height}`);
    }
  }
}

function deriveRouteGrammar(routeTiles) {
  if (!Array.isArray(routeTiles) || routeTiles.length === 0) return null;
  const turns = [];
  let priorDirection = null;
  for (let index = 1; index < routeTiles.length; index += 1) {
    const prior = routeTiles[index - 1];
    const current = routeTiles[index];
    const direction = { x: current.x - prior.x, y: current.y - prior.y };
    if (Math.abs(direction.x) + Math.abs(direction.y) !== 1) return null;
    if (priorDirection !== null && (direction.x !== priorDirection.x || direction.y !== priorDirection.y)) {
      turns.push(prior);
    }
    priorDirection = direction;
  }
  return { start: routeTiles[0], turns, terminus: routeTiles.at(-1) };
}

function tileSetConnected(tiles) {
  if (!Array.isArray(tiles) || tiles.length === 0) return false;
  const remaining = new Set(tiles.map(({ x, y }) => `${x},${y}`));
  const first = remaining.values().next().value;
  const queue = [first];
  remaining.delete(first);
  while (queue.length > 0) {
    const [x, y] = queue.shift().split(",").map(Number);
    for (const key of [`${x - 1},${y}`, `${x + 1},${y}`, `${x},${y - 1}`, `${x},${y + 1}`]) {
      if (remaining.delete(key)) queue.push(key);
    }
  }
  return remaining.size === 0;
}

function rectsTouchOrOverlap(left, right) {
  return left.x <= right.x + right.width
    && left.x + left.width >= right.x
    && left.y <= right.y + right.height
    && left.y + left.height >= right.y;
}

function validateScenePlan(errors, kit, plan, recipes) {
  const prefix = `${kit} scene`;
  if (!plan || typeof plan !== "object") {
    errors.push(`${prefix}: scene plan is required`);
    return;
  }
  if (plan.kitId !== kit) errors.push(`${prefix}: kit ownership mismatch`);
  if (plan.widthTiles !== 24 || plan.heightTiles !== 16) errors.push(`${prefix}: proof geometry must be 24x16`);
  if (!Array.isArray(plan.groundRecipeGrid) || plan.groundRecipeGrid.length !== 16
    || plan.groundRecipeGrid.some((row) => !Array.isArray(row) || row.length !== 24
      || row.some((cell) => !Number.isInteger(cell) || cell < 0 || cell > 7))) {
    errors.push(`${prefix}: explicit ground placement grid must be 16x24 integers 0-7`);
  } else {
    if (new Set(plan.groundRecipeGrid.flat()).size !== 8) errors.push(`${prefix}: explicit ground placement grid must use all eight recipes`);
    validateGroundGrid(errors, prefix, recipes.ground, plan.groundRecipeGrid, EXPECTED_GROUND_FAMILY_MASK_ROWS[kit]);
  }
  const derivedGrammar = deriveRouteGrammar(plan.routeTiles);
  if (derivedGrammar === null) errors.push(`${prefix}: route must be nonempty and cardinally contiguous`);
  else if (canonical(derivedGrammar) !== canonical(plan.routeGrammar)) errors.push(`${prefix}: route grammar must equal derived start/turn/terminus geometry`);
  if (!plan.routeTiles?.some(({ x, y }) => x === 0 || x === 23 || y === 0 || y === 15)) errors.push(`${prefix}: route must enter from an edge`);
  if (!Array.isArray(plan.terrainPatches) || plan.terrainPatches.length < 2 || plan.terrainPatches.length > 3) errors.push(`${prefix}: two or three terrain patches are required`);

  const wet = kit === "spring-terraces" || kit === "neutral-temperate";
  if (wet) {
    if (!Array.isArray(plan.waterTiles) || plan.waterTiles.length === 0) errors.push(`${prefix}: ${kit} water truth is required`);
    if (!Array.isArray(plan.shoreTiles) || plan.shoreTiles.length === 0) errors.push(`${prefix}: ${kit} shore truth is required`);
    if (plan.waterTiles?.length > 0 && !tileSetConnected(plan.waterTiles)) errors.push(`${prefix}: water tiles must be connected`);
    const waterKeys = new Set((plan.waterTiles ?? []).map(({ x, y }) => `${x},${y}`));
    if (plan.shoreTiles?.some(({ x, y }) => ![[-1,0],[1,0],[0,-1],[0,1]].some(([dx,dy]) => waterKeys.has(`${x + dx},${y + dy}`)))) {
      errors.push(`${prefix}: every shore tile must truthfully touch water`);
    }
  } else if ((plan.waterTiles?.length ?? 0) > 0 || (plan.shoreTiles?.length ?? 0) > 0) {
    errors.push(`${prefix}: ${kit} must remain waterless with empty water and shore arrays`);
  }

  const recipeIds = new Set(recipes.landmarks.map(({ id }) => id));
  if (!Array.isArray(plan.landmarks) || plan.landmarks.length < 4) errors.push(`${prefix}: at least four landmark placements are required`);
  const landmarkContacts = new Map();
  for (const landmark of plan.landmarks ?? []) {
    if (Object.keys(landmark).some((key) => /bounds/i.test(key))) errors.push(`${prefix}: landmark ${landmark.variantId} alternate bounds authority is forbidden`);
    if (!exactKeys(landmark, ["variantId", "clusterId", "role", "x", "y", "cell"])) errors.push(`${prefix}: landmark ${landmark.variantId} placement keys are not closed`);
    if (!recipeIds.has(landmark.variantId)) errors.push(`${prefix}: landmark ${landmark.variantId} is not owned by ${kit}`);
    if (typeof landmark.clusterId !== "string" || !/^[a-z][a-z0-9-]*$/.test(landmark.clusterId)) errors.push(`${prefix}: landmark ${landmark.variantId} clusterId must be a hyphen token`);
    if (typeof landmark.role !== "string" || !/^[a-z]+(?:-[a-z]+)*$/.test(landmark.role)) errors.push(`${prefix}: landmark ${landmark.variantId} role must be a hyphen token`);
    const placementIntegers = [landmark.x, landmark.y, landmark.cell].every(Number.isInteger);
    if (!placementIntegers) errors.push(`${prefix}: landmark ${landmark.variantId} requires explicit integer x, y, and cell`);
    const nativeIdentity = NATIVE_LANDMARK_BY_ID.get(landmark.variantId);
    if (!nativeIdentity || nativeIdentity.semanticKind !== recipes.landmarks.find(({ id }) => id === landmark.variantId)?.semanticKind) {
      errors.push(`${prefix}: landmark ${landmark.variantId} requires preserved native identity`);
    } else if (placementIntegers) {
      if (landmark.cell !== nativeIdentity.cell) errors.push(`${prefix}: landmark ${landmark.variantId} cell must equal native cell ${nativeIdentity.cell}`);
      const contactX = landmark.x + nativeIdentity.contactPivotPx.x;
      const contactY = landmark.y + nativeIdentity.contactPivotPx.y;
      landmarkContacts.set(landmark.variantId, {
        x: contactX - 48,
        y: contactY - 32,
        width: 96,
        height: 64,
      });
    }
  }
  for (const support of plan.supports ?? []) {
    if (Object.keys(support).some((key) => /bounds/i.test(key))) errors.push(`${prefix}: support ${support.id} alternate bounds authority is forbidden`);
    if (!exactKeys(support, ["id", "clusterId", "role", "landmarkVariantId", "sceneryKind", "variantOrdinal", "cell", "x", "y"])) errors.push(`${prefix}: support ${support.id} placement keys are not closed`);
    const owner = (plan.landmarks ?? []).find(({ clusterId, variantId }) => (
      clusterId === support.clusterId && variantId === support.landmarkVariantId
    ));
    if (!owner) errors.push(`${prefix}: support ${support.id} has orphan owner or cluster`);
    if (typeof support.clusterId !== "string" || !/^[a-z][a-z0-9-]*$/.test(support.clusterId)) errors.push(`${prefix}: support ${support.id} clusterId must be a hyphen token`);
    if (typeof support.role !== "string" || !/^[a-z]+(?:-[a-z]+)*$/.test(support.role) || support.role === "support") errors.push(`${prefix}: support ${support.id} needs a kit-specific hyphen-token role`);
    const placementIntegers = [support.x, support.y, support.cell].every(Number.isInteger);
    if (!placementIntegers) errors.push(`${prefix}: support ${support.id} requires explicit integer x, y, and cell`);
    const baseCell = SCENERY_KIND_BASES[kit]?.[support.sceneryKind];
    if (!Number.isInteger(baseCell) || !Number.isInteger(support.variantOrdinal)
      || support.variantOrdinal < 0 || support.variantOrdinal > 31) {
      errors.push(`${prefix}: support ${support.id} requires a valid semantic scenery kind and variant ordinal 0-31`);
    } else if (placementIntegers && support.cell !== baseCell + support.variantOrdinal * 4) {
      errors.push(`${prefix}: support ${support.id} cell must equal semantic scenery bank base+4n`);
    }
    const contactNeighborhood = landmarkContacts.get(support.landmarkVariantId);
    if (owner && contactNeighborhood && placementIntegers && !rectsTouchOrOverlap(
      { x: support.x, y: support.y, width: 32, height: 32 },
      contactNeighborhood,
    )) errors.push(`${prefix}: support ${support.id} does not touch owner ${support.landmarkVariantId}`);
  }
  for (const landmark of plan.landmarks ?? []) {
    const owners = (plan.supports ?? []).filter(({ clusterId, landmarkVariantId }) => (
      clusterId === landmark.clusterId && landmarkVariantId === landmark.variantId
    ));
    if (owners.length < 2) errors.push(`${prefix}: landmark ${landmark.variantId} needs at least two support owners`);
  }

  const { home, yard } = plan;
  if (!home || !yard) {
    errors.push(`${prefix}: home and yard are required`);
    return;
  }
  const expectedPlotCenter = { x: home.plotTile.x * 32 + 16, y: home.plotTile.y * 32 + 16 };
  const expectedDoorTile = { x: home.plotTile.x + 2, y: home.plotTile.y + 3 };
  const expectedDoorCenter = { x: expectedPlotCenter.x + 64, y: expectedPlotCenter.y + 96 };
  const expectedYardOrigin = { x: expectedPlotCenter.x - 32, y: expectedPlotCenter.y - 16 };
  if (canonical(home.plotCenterPx) !== canonical(expectedPlotCenter)
    || canonical(home.doorTile) !== canonical(expectedDoorTile)
    || canonical(home.doorCenterPx) !== canonical(expectedDoorCenter)
    || canonical(yard.originPx) !== canonical(expectedYardOrigin)
    || canonical(plan.routeTiles?.at(-1)) !== canonical(home.doorTile)) {
    errors.push(`${prefix}: yard/home door equality D=P+(64,96), O=P+(-32,-16), and route terminus is broken`);
  }
  if (canonical(yard.contactPivotPx) !== canonical({ x: 96, y: 112 })) errors.push(`${prefix}: yard pivot must be 96,112`);
  if (canonical(yard.connectionPorts) !== canonical([{ side: "south", startPx: 80, widthPx: 32, role: "path" }])) errors.push(`${prefix}: yard south port must be [80,112)`);
  if (canonical(yard.doorClearancePx) !== canonical({ x: 81, y: 73, width: 30, height: 48 })) errors.push(`${prefix}: yard door clearance must be [81,111)x[73,121)`);
}

export const REGIONAL_R4_KITS = deepFreeze([...EXPECTED_KITS]);

export const REGIONAL_R4_VARIANT_RECIPES = deepFreeze({
  "worn-heartland": { ground: WORN_GROUND_RECIPES, landmarks: WORN_LANDMARK_RECIPES, yards: WORN_YARD_RECIPES },
  "spring-terraces": { ground: SPRING_GROUND_RECIPES, landmarks: SPRING_LANDMARK_RECIPES, yards: SPRING_YARD_RECIPES },
  "dry-scrub": { ground: DRY_GROUND_RECIPES, landmarks: DRY_LANDMARK_RECIPES, yards: DRY_YARD_RECIPES },
  "ash-waste": { ground: ASH_GROUND_RECIPES, landmarks: ASH_LANDMARK_RECIPES, yards: ASH_YARD_RECIPES },
  "neutral-temperate": { ground: NEUTRAL_GROUND_RECIPES, landmarks: NEUTRAL_LANDMARK_RECIPES, yards: NEUTRAL_YARD_RECIPES },
});

export const REGIONAL_R4_SCENE_PLANS = deepFreeze({
  "worn-heartland": WORN_SCENE_PLAN,
  "spring-terraces": SPRING_SCENE_PLAN,
  "dry-scrub": DRY_SCENE_PLAN,
  "ash-waste": ASH_SCENE_PLAN,
  "neutral-temperate": NEUTRAL_SCENE_PLAN,
});

const DEFAULT_SPEC = deepFreeze({
  kits: REGIONAL_R4_KITS,
  variantRecipes: REGIONAL_R4_VARIANT_RECIPES,
  scenePlans: REGIONAL_R4_SCENE_PLANS,
});

/** Validate the complete inert R4 data contract and return every discovered error. */
export function validateRegionalR4Spec(candidate = DEFAULT_SPEC) {
  const errors = [];
  if (!candidate || typeof candidate !== "object") return ["R4 spec must be an object"];
  if (!isDeepFrozen(candidate)) errors.push("R4 spec exports must be recursively frozen");
  if (canonical(candidate.kits) !== canonical(EXPECTED_KITS)) errors.push("R4 kit order must remain exact");
  if (canonical(Object.keys(candidate.variantRecipes ?? {})) !== canonical(EXPECTED_KITS)) errors.push("R4 recipe kit ownership must remain exact");
  if (canonical(Object.keys(candidate.scenePlans ?? {})) !== canonical(EXPECTED_KITS)) errors.push("R4 scene-plan kit ownership must remain exact");
  if (hasFunction(candidate)) errors.push("R4 spec must contain no executable or function-valued operations");

  const allRecipes = [];
  for (const kit of EXPECTED_KITS) {
    const families = candidate.variantRecipes?.[kit];
    if (!families) {
      errors.push(`${kit}: recipe families are required`);
      continue;
    }
    if (!exactKeys(families, ["ground", "landmarks", "yards"])) errors.push(`${kit}: recipe family keys must be ground, landmarks, yards`);
    for (const [family, expectedLength] of [["ground", 8], ["landmarks", 8], ["yards", 5]]) {
      const recipes = families[family];
      if (!Array.isArray(recipes) || recipes.length !== expectedLength) {
        errors.push(`${kit}/${family}: exact inventory must contain ${expectedLength} recipes`);
        continue;
      }
      for (const recipe of recipes) {
        allRecipes.push(recipe);
        const recipeKeys = ["id", "semanticKind", "topologyKey", "recognitionTags", "materialFamily", "operations"];
        if (family === "landmarks") recipeKeys.push("cell", "contactPivotPx");
        if (!exactKeys(recipe, recipeKeys)) errors.push(`${kit}/${recipe.id}: recipe keys are not closed`);
        const idPrefix = family === "landmarks" ? `${kit}:` : `${kit.split("-")[0]}:`;
        if (typeof recipe.id !== "string" || !recipe.id.startsWith(idPrefix)) errors.push(`${kit}/${String(recipe.id)}: stable kit-owned recipe ID required`);
        if (!Array.isArray(recipe.recognitionTags) || recipe.recognitionTags.length < 2) errors.push(`${kit}/${recipe.id}: at least two recognition tags required`);
        if (!Array.isArray(recipe.operations) || recipe.operations.length < 2) errors.push(`${kit}/${recipe.id}: nonempty explicit operations required`);
        else recipe.operations.forEach((entry, index) => validateOperation(errors, kit, family, recipe, entry, index));
        if (family === "landmarks") {
          if (!Number.isInteger(recipe.cell) || recipe.cell < 0 || recipe.cell > 7) errors.push(`${kit}/${recipe.id}: native landmark cell must be integer 0-7`);
          if (!exactKeys(recipe.contactPivotPx, ["x", "y"])
            || ![recipe.contactPivotPx?.x, recipe.contactPivotPx?.y].every(Number.isInteger)
            || recipe.contactPivotPx.x < 0 || recipe.contactPivotPx.x >= 128
            || recipe.contactPivotPx.y < 0 || recipe.contactPivotPx.y >= 128) {
            errors.push(`${kit}/${recipe.id}: authoritative contact pivot must be integer and inside 128px cell`);
          }
        }
      }
    }
    if (Array.isArray(families.landmarks) && canonical(semanticCounts(families.landmarks)) !== canonical(EXPECTED_LANDMARK_COUNTS[kit])) {
      errors.push(`${kit}: landmark semantic multiplicities drifted`);
    }
    if (Array.isArray(families.landmarks)) {
      const identityRows = families.landmarks.map(({ id, cell, contactPivotPx, semanticKind }) => ({
        variantId: id,
        cell,
        contactPivotPx,
        semanticKind,
      }));
      if (canonical(identityRows) !== canonical(NATIVE_LANDMARK_IDENTITIES[kit])) errors.push(`${kit}: native landmark identity, cell order, or contact pivot drifted`);
    }
    if (Array.isArray(families.yards) && canonical(families.yards.map(({ semanticKind }) => semanticKind)) !== canonical(EXPECTED_YARDS)) {
      errors.push(`${kit}: yard semantic order drifted`);
    }
    if (Array.isArray(families.ground)) {
      const calm = families.ground.filter(({ materialFamily }) => materialFamily === `${kit}:calm-ground`).length;
      const clustered = families.ground.filter(({ materialFamily }) => materialFamily === `${kit}:clustered-ground`).length;
      if (calm !== 4 || clustered !== 4) errors.push(`${kit}: ground inventory requires four calm and four clustered recipes`);
    }
    if (Array.isArray(families.yards) && families.yards.length === 5) {
      if (normalizedOperationGeometrySignature(families.yards[0]) === normalizedOperationGeometrySignature(families.yards[1])) errors.push(`${kit}: standing yard bases must remain distinct`);
      if (normalizedOperationGeometrySignature(families.yards[0]) === normalizedOperationGeometrySignature(families.yards[4])) errors.push(`${kit}: standing and ruin yards must remain distinct`);
      for (const yard of families.yards) {
        const forbiddenTokens = new Set(["ring", "socket", "pedestal", "circle", "radial"]);
        if (semanticTokens(yard).some((token) => forbiddenTokens.has(token))) errors.push(`${kit}/${yard.id}: yard ring or socket semantics are forbidden`);
        if (!yard.recognitionTags?.includes("open-south-corridor")) errors.push(`${kit}/${yard.id}: open south corridor tag required`);
      }
    }
  }

  if (allRecipes.length !== 105) errors.push(`R4 exact total inventory must be 105, received ${allRecipes.length}`);
  const ids = allRecipes.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) errors.push("R4 recipe IDs must be globally unique");
  const canonicalRecipes = allRecipes.map(canonical);
  if (new Set(canonicalRecipes).size !== canonicalRecipes.length) errors.push("R4 duplicate canonical recipe detected");
  const canonicalGeometries = allRecipes.map(canonicalGeometry);
  if (new Set(canonicalGeometries).size !== canonicalGeometries.length) errors.push("R4 duplicate id/material-stripped geometry detected");
  const normalizedGeometries = allRecipes.map(normalizedGeometrySignature);
  if (new Set(normalizedGeometries).size !== normalizedGeometries.length) errors.push("R4 duplicate translation/reflection-normalized geometry detected");

  for (let leftKitIndex = 0; leftKitIndex < EXPECTED_KITS.length; leftKitIndex += 1) {
    for (let rightKitIndex = leftKitIndex + 1; rightKitIndex < EXPECTED_KITS.length; rightKitIndex += 1) {
      const leftKit = EXPECTED_KITS[leftKitIndex];
      const rightKit = EXPECTED_KITS[rightKitIndex];
      const leftGround = candidate.variantRecipes?.[leftKit]?.ground ?? [];
      const rightGround = candidate.variantRecipes?.[rightKit]?.ground ?? [];
      for (const left of leftGround) for (const right of rightGround) {
        const similarity = groundGeometrySimilarity(left, right);
        if (similarity !== null && similarity > MAX_CROSS_KIT_GROUND_SIMILARITY) {
          errors.push(`R4 cross-kit ground-mask similarity ${similarity.toFixed(4)} exceeds ${MAX_CROSS_KIT_GROUND_SIMILARITY}: ${left.id}/${right.id}`);
        }
      }
    }
  }

  const ashPlan = candidate.scenePlans?.["ash-waste"] ?? {};
  const ashSemanticValues = {
    recipes: candidate.variantRecipes?.["ash-waste"] ?? {},
    kitId: ashPlan.kitId,
    sentence: ashPlan.sentence,
    terrainPatches: ashPlan.terrainPatches?.map(({ id, role }) => ({ id, role })),
    landmarks: ashPlan.landmarks?.map(({ variantId, clusterId, role }) => ({ variantId, clusterId, role })),
    supports: ashPlan.supports?.map(({ id, clusterId, role, landmarkVariantId }) => ({ id, clusterId, role, landmarkVariantId })),
    yardRecipeId: ashPlan.yard?.recipeId,
  };
  const ashTokens = semanticTokens(ashSemanticValues);
  if (!ashTokens.includes("industrial") || !(ashTokens.includes("irradiated") || ashTokens.includes("containment"))) errors.push("ash-waste: industrial irradiated containment identity is required");
  const forbiddenAshTokens = new Set(["living", "water", "spring", "garden", "moss", "flower", "barrel", "sign", "glow", "fantasy", "wizard", "rune", "medieval"]);
  if (ashTokens.some((token) => forbiddenAshTokens.has(token))) errors.push("ash-waste: living, water, fantasy, barrel, sign, and glow roles are forbidden");

  const plans = [];
  for (const kit of EXPECTED_KITS) {
    const plan = candidate.scenePlans?.[kit];
    if (plan) plans.push(plan);
    validateScenePlan(errors, kit, plan, candidate.variantRecipes?.[kit] ?? { landmarks: [] });
  }
  const routeGrammars = plans.map(({ routeGrammar }) => canonical(routeGrammar));
  if (new Set(routeGrammars).size !== plans.length) errors.push("R4 route grammar duplicate detected");
  const coordinateFamilies = [
    ["route", plans.map(({ routeTiles }) => canonical(routeTiles))],
    ["landmark", plans.map(({ landmarks }) => canonical(landmarks))],
    ["support", plans.map(({ supports }) => canonical(supports))],
    ["scene", plans.map((plan) => canonical({ routeTiles: plan.routeTiles, terrainPatches: plan.terrainPatches, groundRecipeGrid: plan.groundRecipeGrid, waterTiles: plan.waterTiles, shoreTiles: plan.shoreTiles, landmarks: plan.landmarks, supports: plan.supports, yard: plan.yard, home: plan.home }))],
  ];
  for (const [label, entries] of coordinateFamilies) if (new Set(entries).size !== entries.length) errors.push(`R4 ${label} coordinate geometry duplicate detected`);
  const spring = candidate.scenePlans?.["spring-terraces"];
  const neutral = candidate.scenePlans?.["neutral-temperate"];
  if (spring && neutral) {
    if (canonical(spring.waterTiles) === canonical(neutral.waterTiles) || canonical(spring.shoreTiles) === canonical(neutral.shoreTiles)) errors.push("spring and neutral wet signatures must be materially different");
    if (!(spring.waterTiles.length > neutral.waterTiles.length)) errors.push("spring basin must remain larger than neutral pond");
  }
  const worn = candidate.scenePlans?.["worn-heartland"];
  if (worn && neutral && (canonical(worn.routeTiles) === canonical(neutral.routeTiles)
    || canonical(worn.landmarks) === canonical(neutral.landmarks)
    || canonical(worn.supports) === canonical(neutral.supports))) {
    errors.push("neutral must remain structurally distinct from worn, not a tint");
  }
  return errors;
}
