/**
 * Pure R5 atlas-cell scene composition.
 *
 * This module is deliberately bounded by encoded atlas bytes and a detached,
 * closed placement authority. It performs no filesystem writes.
 */

import { createHash } from "node:crypto";

import sharp from "sharp";

const SCENE_WIDTH = 768;
const SCENE_HEIGHT = 512;
const CHANNELS = 4;
const KITS = Object.freeze([
  "ash-waste",
  "dry-scrub",
  "neutral-temperate",
  "spring-terraces",
  "worn-heartland",
]);
const FAMILIES = Object.freeze(["terrain", "scenery", "landmarks", "home-yards"]);
const MASTER_NAMES = Object.freeze(KITS.flatMap((kit) => (
  FAMILIES.map((family) => `${kit}-${family}`)
)).sort(compareText));
const DIRECT_SCENE_SOURCE_COUNTS = Object.freeze({
  "ash-waste": 11,
  "dry-scrub": 6,
  "neutral-temperate": 12,
  "spring-terraces": 25,
  "worn-heartland": 5,
});
const MASTER_GEOMETRY = Object.freeze({
  terrain: Object.freeze({ width: 256, height: 256, cellWidth: 32, cellHeight: 32, columns: 8, rows: 8 }),
  scenery: Object.freeze({ width: 512, height: 256, cellWidth: 32, cellHeight: 32, columns: 16, rows: 8 }),
  landmarks: Object.freeze({ width: 512, height: 256, cellWidth: 128, cellHeight: 128, columns: 4, rows: 2 }),
  "home-yards": Object.freeze({ width: 960, height: 160, cellWidth: 192, cellHeight: 160, columns: 5, rows: 1 }),
});

const MASTER_PNG_SHA256 = Object.freeze({
  "ash-waste-home-yards": "434ac4f67869661e3b2b93afc92c4181fb515a2dc23657425579a63a09cb9102",
  "ash-waste-landmarks": "adc535b0f2848705651f8fbf6d60d55c3a8dfaae77fa9d066a74eb68d85fef90",
  "ash-waste-scenery": "9fa1b6df261fd9f2b98e9346f166adf728cb287b9eb80d978f131bdb91fc4a16",
  "ash-waste-terrain": "a89d5f52c896ce5aab2e036f0ee7e109b6020222f7d2ae9d18f72c47a29407f1",
  "dry-scrub-home-yards": "5663ea6f8292fb4d17ddc556246570d2ab18f6ad41b0e5381f59bcc5432ab460",
  "dry-scrub-landmarks": "85f35ce7b6ee70ca75e81dff086ab382724d267fd4da689acbf9833503f6b444",
  "dry-scrub-scenery": "97ac17d12862051902a5c504bd34f0424941b66f66844eda02258e2512b08b73",
  "dry-scrub-terrain": "e52ca60c85ae04ce3ea5d6ade2b0601cd33c8e83580ac60cc1ed49c005031af9",
  "neutral-temperate-home-yards": "13e17622f3375d1242c8d9881ccd4205f78ec6df55464f0df615ae3a4f8242c2",
  "neutral-temperate-landmarks": "ec4712c5dbc6f250b96bae4c9581667de2faa87287ab606cb3bfdd74f542e1dd",
  "neutral-temperate-scenery": "4dee213a455a50f4a3870364e00bed40ab49ae78f4d5f7c76ffa229dd112b6b9",
  "neutral-temperate-terrain": "94e1c955959376363d6f4ad1757bae3ab0f08765b3816f8072d4e2722af23f12",
  "spring-terraces-home-yards": "587c46cd7bfe54fcb96ca0e36dd34732d63b15b74c8c14b3ee260b720281451e",
  "spring-terraces-landmarks": "0bc3a8d438163689aebeb93ba7e3edf2ae20d9166bae95e3c112ae91d8fa84e8",
  "spring-terraces-scenery": "ac3d9563d76ed4a47227dc56c3199efc8054a31e2296781a94d35cdf372f4bc8",
  "spring-terraces-terrain": "e00b7a9078030be6de36563b581b3a8f2944d0100b58d76f046dcffa0da349f5",
  "worn-heartland-home-yards": "bdadc63113ecd94e517cf12c3b279a9f581a09b7ca84a057ef4ac0259af09dae",
  "worn-heartland-landmarks": "8adf2b03d92f6c7f724a7098255cc0f3dbdaf19becd922dfc790f5a482585c4c",
  "worn-heartland-scenery": "2d35b4dbd44b9fb53f57e0bcdcf1752b1c47ce6e8b22d11cd644f9f5da62050b",
  "worn-heartland-terrain": "4746a72bc80088fdfbee37786b5b084223a2cddb96d064d26e74e4d58c6eb2c4",
});
const V3_MASTER_PNG_SHA256 = Object.freeze({
  "ash-waste-home-yards": "434ac4f67869661e3b2b93afc92c4181fb515a2dc23657425579a63a09cb9102",
  "ash-waste-landmarks": "b53c379927e7ae2a49ad2302db98a6caca10de009ceb71fae8ce510422d1abea",
  "ash-waste-scenery": "9c9da56ef160b91522a851941a61ae6cca037cdec189e9c07d0cd0bf798ffb6f",
  "ash-waste-terrain": "a89d5f52c896ce5aab2e036f0ee7e109b6020222f7d2ae9d18f72c47a29407f1",
  "dry-scrub-home-yards": "5663ea6f8292fb4d17ddc556246570d2ab18f6ad41b0e5381f59bcc5432ab460",
  "dry-scrub-landmarks": "ed8d75cbc64d90413d8228ac13efd4fc2211f6a73a70f2b63f4effc4cd135d0e",
  "dry-scrub-scenery": "5cfc442fc39e668281a9889cc591681a9b1ff2dddab5b64b9b0a502d6a898c92",
  "dry-scrub-terrain": "e52ca60c85ae04ce3ea5d6ade2b0601cd33c8e83580ac60cc1ed49c005031af9",
  "neutral-temperate-home-yards": "13e17622f3375d1242c8d9881ccd4205f78ec6df55464f0df615ae3a4f8242c2",
  "neutral-temperate-landmarks": "768332e554ac37af9f4069c35865c165fc1568912d25a1fae93297295a7dc1a2",
  "neutral-temperate-scenery": "e6d8fb85b951f0a22e4817482d0b95b279fcdd9e9612ad84cd561f0fb8af0b40",
  "neutral-temperate-terrain": "94e1c955959376363d6f4ad1757bae3ab0f08765b3816f8072d4e2722af23f12",
  "spring-terraces-home-yards": "587c46cd7bfe54fcb96ca0e36dd34732d63b15b74c8c14b3ee260b720281451e",
  "spring-terraces-landmarks": "f8e7e6e6f22310ac1db95324493ef5d3bb39b5d9b4864d1be23ff2f82cfd61b1",
  "spring-terraces-scenery": "37b3a2db70a0da16a6bba4f48bc3be66f985edcff62bd1e9da2c746d1021c12a",
  "spring-terraces-terrain": "e00b7a9078030be6de36563b581b3a8f2944d0100b58d76f046dcffa0da349f5",
  "worn-heartland-home-yards": "bdadc63113ecd94e517cf12c3b279a9f581a09b7ca84a057ef4ac0259af09dae",
  "worn-heartland-landmarks": "3ffe17aa59c5a1be858a747af9137caf4481b67aadac7db0b50fd4c5d843a6ed",
  "worn-heartland-scenery": "36804d363d8113e4e2af548fea1dd1927e0fdc94af8cc05a6ca14cb2f73d7281",
  "worn-heartland-terrain": "4746a72bc80088fdfbee37786b5b084223a2cddb96d064d26e74e4d58c6eb2c4",
});

const LITERALS = Object.freeze({
  "worn-heartland": Object.freeze({
    terrainRows: Object.freeze([
      "020100020301020302000200000203010100030103000103",
      "000301010002030001020003010003020203000201030001",
      "030002030200070503020100020300020103010405010300",
      "020100020605060704030001030101030002070704000201",
      "0808080808080C0506040303020002010306040506070100",
      "010306060422092021070102030200010004060407050302",
      "030004070523092122060400010203000105070705040203",
      "0002070506200A080808080C020300020300050406070102",
      "010001060706050407050609030102010002070607060300",
      "000300030404050506070109020301000205040504010203",
      "000301000206070405010209000200030406040707020300",
      "030200030201060501030009020002222320210504020103",
      "000301020300020102010109000207232021220605010300",
      "02010201020300020103000A080808080808080800030201",
      "000300030100010003010002050607040506070103020300",
      "030102010301020302000305070705060407000201000102",
    ]),
    landmarks: Object.freeze([
      [0, 128, 0, "old-oak-anchor"], [1, 198, 8, "homestead-frame"],
      [2, 172, 24, "wind-worn-frame"], [3, 118, 142, "garden-route-gate"],
      [4, 228, 142, "garden-east-return"], [5, 270, 210, "reclaimed-diagonal"],
      [6, 384, 340, "eroded-route-band"], [7, 304, 232, "trampled-north-south"],
    ]),
    supports: Object.freeze([
      [4, 128, 102, "root-mound"], [8, 134, 134, "support-tree"],
      [3, 150, 128, "broken-fence-return"], [2, 131, 102, "faded-flower"],
      [1, 341, 244, "rut-stone"], [6, 332, 217, "eroded-tuft"],
      [12, 448, 396, "woodpile"], [5, 480, 428, "field-stone"],
      [1, 55, 128, "wind-root-return"], [6, 64, 157, "wind-tree-return"],
      [19, 141, 109, "garden-fence-return"], [23, 157, 137, "garden-flower-return"],
      [83, 435, 365, "boundary-post-return"], [87, 456, 393, "boundary-stone-return"],
      [85, 322, 346, "route-stone-return"], [89, 350, 327, "route-flower-return"],
    ]),
    identities: Object.freeze({
      r4ScenePlanSha256: "83a3a59282f25cd8a3d1ac9a6b4b42350151095cfde87e14b8464fed23b6e30c",
      r4VariantRecipeSha256: "d9a04e4076983714cca3bab96e16ed22a5cce2b43e196b32216f58ee96825b34",
      mechanicsScenePlanSha256: "83a3a59282f25cd8a3d1ac9a6b4b42350151095cfde87e14b8464fed23b6e30c",
      homeActorRgbaSha256: "3ed48928df32d08ec72d90e1ae69401c7d2b86bea0cf315403ee7f12391dbb5c",
      productionHumanRgbaSha256: "4bcdc9f7fc15ab203eb96e99cb1108c3b884e198be284c6b958170f9f5f67e0e",
      humanPlacementsSha256: "5359979e61045e50f00cd9a0badc8dd52d315aa76fe42672f3a026e4c951b0d7",
    }),
  }),
  "spring-terraces": Object.freeze({
    terrainRows: Object.freeze([
      "000103020302010003000101020000010300030200030302",
      "010002030102000300020301030203020003010002010301",
      "000301030007050003010002010302000204070100020103",
      "010203020705070602202122230103020706040200010200",
      "000302070605060405212223200101040405060103000103",
      "030106040506070504222320210200060504050602010300",
      "02040706050405060406070301000B0808080C0501020103",
      "0006041E181E050406050402000209020406090705030101",
      "08080808080808080C070200030009000705090507000002",
      "011E13161616141F09020103000109202122090600020100",
      "031E12161616161609010003010209212223090401000203",
      "00031F121616151F0A08080808080D222320090700030102",
      "0200011F12151F0201000203040607050406090203010301",
      "030100021E1E030103020106050704060505000102000303",
      "000201000301020300030704070506070602020301020103",
      "010300020203000102040605060407050000030001000200",
    ]),
    landmarks: Object.freeze([
      [0, 112, 344, "connected-basin"], [1, 24, 200, "connected-outlet"],
      [2, 272, 228, "wet-stone-risers"], [3, 224, 336, "shore-reed-bank"],
      [4, 8, 328, "bank-willow"], [5, 472, 216, "bank-willow-return"],
      [6, 360, 288, "wet-dry-north-south"], [7, 88, 232, "wet-dry-crossing"],
    ]),
    supports: Object.freeze([
      [0, 200, 400, "stone-bank"], [4, 224, 432, "ripple-return"],
      [16, 48, 232, "upper-lip"], [20, 136, 248, "fall-foam"],
      [64, 280, 276, "wet-slab"], [68, 376, 304, "stone-riser"],
      [7, 232, 392, "reed-root"], [8, 320, 416, "silt-bank"],
      [1, 72, 400, "root-return"], [3, 88, 424, "hanging-reed"],
      [69, 480, 304, "root-return"], [73, 520, 328, "reed-return"],
      [69, 390, 320, "bank-junction"], [73, 438, 356, "stone-return"],
      [69, 56, 264, "west-abutment"], [73, 216, 264, "east-abutment"],
    ]),
    identities: Object.freeze({
      r4ScenePlanSha256: "e049521adb7417f38a3884177bb9f65ada27699bc22878d0cbaea90faa474b49",
      r4VariantRecipeSha256: "2471cce41ab0b87a5450f4862215372d12a097cd8fb718ad4c959f168a5c840e",
      mechanicsScenePlanSha256: "e049521adb7417f38a3884177bb9f65ada27699bc22878d0cbaea90faa474b49",
      homeActorRgbaSha256: "b6daf61464f18fa94598487a8af1d8686711d386c39f91b29920585cc41f1951",
      productionHumanRgbaSha256: "4bcdc9f7fc15ab203eb96e99cb1108c3b884e198be284c6b958170f9f5f67e0e",
      humanPlacementsSha256: "efaf8909bc93be07b31dd320848744ab9ca027ce488663d2017059a549215923",
    }),
  }),
  "dry-scrub": Object.freeze({
    terrainRows: Object.freeze([
      "000300010300010302010001030201030200030200030203",
      "020103000203020001020301020100020303000103000302",
      "010201030101060506010003000102000201030706050001",
      "0301002223202106040602000203030102000B0808080808",
      "020002232021220406070003010001020304090607050002",
      "000302202122230407050601030100030406090506040100",
      "0103070506060407050407010B08080808080D0406020301",
      "020605040504050407070502090201030006070504070201",
      "000304070607060506050300090302000504070405010003",
      "0100030504050706040102030A080808080808080C020002",
      "030102000506040603000100022320212206050609000201",
      "000300020107050201030002032021222304060709010200",
      "010003010003020300020301062122232004070300020100",
      "000102000102000103010207040605070405030103000202",
      "030001020003020000030405070406070500020301020301",
      "010302030100030001070606050706050201000203030003",
    ]),
    landmarks: Object.freeze([
      [0, 600, 128, "sandstone-west"], [1, 576, 152, "yard-windbreak-return"],
      [2, 512, 56, "track-bend-outcrop"], [3, 352, 120, "thorn-opening"],
      [4, 312, 280, "thorn-east-opening"], [5, 296, 240, "horizontal-scrub"],
      [6, 416, 208, "one-direction-scrub"], [7, 592, 232, "falling-scrub"],
    ]),
    supports: Object.freeze([
      [0, 607, 74, "sandstone-chip"], [4, 575, 102, "pebble-fan"],
      [9, 433, 182, "deadwood-root"], [11, 459, 206, "thorn-return"],
      [2, 521, 226, "wind-scrub"], [6, 495, 262, "sand-ripple"],
      [8, 545, 224, "windbreak-stone"], [5, 516, 196, "shade-post"],
      [16, 593, 144, "ridge-stone-return"], [20, 612, 170, "ridge-pebble-return"],
      [65, 356, 276, "deadwood-return"], [69, 383, 259, "scrub-return"],
      [82, 386, 263, "wind-grass-return"], [86, 415, 292, "sand-ripple-return"],
      [98, 560, 313, "south-grass-return"], [102, 591, 318, "south-stone-return"],
    ]),
    identities: Object.freeze({
      r4ScenePlanSha256: "6c7e5f5c3a6eb5419333a38f40d335c31cf000c40d9ee38ebc86bcb10366a065",
      r4VariantRecipeSha256: "cc4b0074aae0358348a53ec8dd589137089db4842e9cd9fb6845cd899aee5c3e",
      mechanicsScenePlanSha256: "6c7e5f5c3a6eb5419333a38f40d335c31cf000c40d9ee38ebc86bcb10366a065",
      homeActorRgbaSha256: "d8bb9c946aeffc036bba4b19fa9d324951b50ad31b071a01f1695dcae197a98f",
      productionHumanRgbaSha256: "4bcdc9f7fc15ab203eb96e99cb1108c3b884e198be284c6b958170f9f5f67e0e",
      humanPlacementsSha256: "30ec19fe37eadd19512fb4caa1a2b3a7d2353dc1881914128468bcabf202fee7",
    }),
  }),
  "ash-waste": Object.freeze({
    terrainRows: Object.freeze([
      "020103020001030203000300000100030200030100010301",
      "010301000203020001010201030002020003010001030202",
      "000203030107040600030201000102000102050404020003",
      "030002000706060506010002030301000306040705010200",
      "010200040504070605050301000203020507060407030102",
      "000305070405060407060503020001070405070605000203",
      "000604060704050706042021222300050406070406010301",
      "030507040605060405060B080808080C0604050704050102",
      "020122232021060704050923202102090706070507020003",
      "010023202122050605030903000103092122232005020100",
      "0302202122230705030009030200050A0808080C02030201",
      "010302010B08080808080D01010607072320210900010302",
      "020103020900000200010002060406060706050902030003",
      "010200030900010302030007050704060604030200020300",
      "000102010903020001020607040505040702000003010201",
      "030203000900030200040406050606050300020103000102",
    ]),
    landmarks: Object.freeze([
      [0, 64, 288, "irradiated-crater"], [1, 272, 104, "split-service-fracture"],
      [2, 288, 140, "containment-pylon"], [3, 160, 32, "leaning-containment-pylon"],
      [4, 504, 160, "charred-ridge"], [5, 416, 216, "slag-rebar-ridge"],
      [6, 536, 344, "directional-debris"], [7, 544, 264, "joined-containment-debris"],
    ]),
    supports: Object.freeze([
      [2, 141, 365, "crater-ejecta"], [3, 130, 336, "coral-fissure"],
      [1, 387, 198, "snapped-insulator"], [0, 356, 194, "cable-scrap"],
      [5, 470, 228, "slag-patch"], [4, 454, 198, "bent-rebar"],
      [7, 643, 376, "sealed-filter-box"], [8, 616, 361, "collapsed-conduit"],
      [18, 296, 231, "crater-ejecta-return"], [22, 320, 253, "fissure-return"],
      [65, 241, 128, "pylon-slag-return"], [69, 263, 145, "pylon-cable-return"],
      [81, 472, 253, "slag-stone-return"], [85, 501, 251, "rebar-return"],
      [96, 606, 362, "debris-char-return"], [100, 635, 385, "debris-filter-return"],
    ]),
    identities: Object.freeze({
      r4ScenePlanSha256: "091a8e04e8b6fcaceb5666c0358aebbfa15a76574cfff00a4e7462507929f57d",
      r4VariantRecipeSha256: "579f4bc5c97a877ea8858a712c854714eea51ce922dee80e5be288c3f725d984",
      mechanicsScenePlanSha256: "091a8e04e8b6fcaceb5666c0358aebbfa15a76574cfff00a4e7462507929f57d",
      homeActorRgbaSha256: "5acdf0f9e09bea26bde7ef9219100ccac968ac1f80236ef48117e7214431d18e",
      productionHumanRgbaSha256: "4bcdc9f7fc15ab203eb96e99cb1108c3b884e198be284c6b958170f9f5f67e0e",
      humanPlacementsSha256: "5f8b8028ed6bb18b6356d3cdec053385bb54a18fd6ae34b0b14c9b1f57073921",
    }),
  }),
  "neutral-temperate": Object.freeze({
    terrainRows: Object.freeze([
      "010203030201020309020001000300000300010203000201",
      "000200020003010209030203010001020102030100020100",
      "030103010205070009010002030201030206040002010300",
      "01001F161F07060509020300020103020607040301000103",
      "021F1616140B08080D030102000300040506070003020001",
      "03001F121509070406050203010004050405060501000202",
      "0004201E1E09040706070600030103070604050605010001",
      "030621222309050604070402010200020506070507030203",
      "01030405070A0808080808080C0001030605040705020300",
      "020003070604070504020203090302060704050602010003",
      "030001020504050400010100092320212207040503020101",
      "000200030105070201030001092021222307060401030203",
      "020103000203010302010302092122232005060102000001",
      "0003020100020300030201060A0808080808000100020102",
      "000300010200010302000405060707040600020302030102",
      "030103020301000203040706070605060100030200010300",
    ]),
    landmarks: Object.freeze([
      [0, 192, 16, "airy-grove-frame"], [1, 40, 80, "paired-grove"],
      [2, 384, 272, "meadow-home-frame"], [3, 128, 160, "lane-wall-gate"],
      [4, 408, 192, "field-wall-side-gap"], [5, 112, 136, "left-wildflower-verge"],
      [6, 312, 344, "right-wildflower-verge"], [7, 288, 192, "damp-verge-return"],
    ]),
    supports: Object.freeze([
      [3, 160, 96, "open-understory"], [0, 128, 70, "secondary-tree"],
      [9, 202, 267, "field-stone-return"], [11, 192, 235, "hedgerow-return"],
      [10, 256, 257, "wildflower-gap"], [11, 225, 225, "damp-verge"],
      [4, 372, 279, "plain-bench"], [6, 364, 255, "herb-bed"],
      [16, 96, 73, "grove-tree-return"], [20, 124, 64, "grove-understory-return"],
      [65, 399, 235, "wall-stone-return"], [69, 413, 255, "wall-gap-return"],
      [82, 151, 144, "verge-flower-return"], [86, 128, 119, "verge-herb-return"],
      [98, 420, 394, "south-flower-return"], [102, 429, 395, "south-stone-return"],
    ]),
    identities: Object.freeze({
      r4ScenePlanSha256: "5485ba39fe6041295c198592ca6068441569c87d298adf5ac3799a1a48f43d4c",
      r4VariantRecipeSha256: "99f2cc084321a899b94e6585bf714236759083208c9fb93b0b3d4a6e30a8f276",
      mechanicsScenePlanSha256: "5485ba39fe6041295c198592ca6068441569c87d298adf5ac3799a1a48f43d4c",
      homeActorRgbaSha256: "d8639ba21b1495b0e2144cdf9d8665db5a66e8295caed690ea68ceea0131d8a9",
      productionHumanRgbaSha256: "4bcdc9f7fc15ab203eb96e99cb1108c3b884e198be284c6b958170f9f5f67e0e",
      humanPlacementsSha256: "6c5b471f4fdd1ff97640184d820ebf9c8352c223714da2174153c74722f96eaa",
    }),
  }),
});

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value).sort(compareText).map((key) => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(",")}}`;
  }
  return JSON.stringify(value);
}

function canonicalDigest(value) {
  return sha256(Buffer.from(canonicalJson(value)));
}

function familyOf(atlasId) {
  return FAMILIES.find((family) => atlasId.endsWith(`-${family}`));
}

function geometryOf(atlasId) {
  const family = familyOf(atlasId);
  return family ? MASTER_GEOMETRY[family] : undefined;
}

function terrainCells(rows, kit) {
  if (rows.length !== 16 || rows.some((row) => !/^(?:[A-Fa-f0-9]{2}){24}$/u.test(row))) {
    throw new Error(`${kit}: invalid closed terrain rows`);
  }
  return rows.flatMap((row, y) => Array.from({ length: 24 }, (_unused, x) => ({
    id: `r5-atlas-only/${kit}/terrain/${y}/${x}`,
    role: "terrain-foundation",
    atlasId: `${kit}-terrain`,
    cell: Number.parseInt(row.slice(x * 2, x * 2 + 2), 16),
    destination: { x: x * 32, y: y * 32 },
  })));
}

function objectCells(rows, kit, family, label) {
  return rows.map(([cell, x, y, role], index) => ({
    id: `r5-atlas-only/${kit}/${label}/${index}`,
    role,
    atlasId: `${kit}-${family}`,
    cell,
    destination: { x, y },
  }));
}

const AUTHORITY_BODY = Object.freeze({
  schema: "regional-r5-atlas-only-placement-authority/v1",
  scenes: Object.freeze(Object.fromEntries(KITS.map((kit) => {
    const literal = LITERALS[kit];
    const visibleStaticLayers = [
      ...terrainCells(literal.terrainRows, kit),
      ...objectCells(literal.landmarks, kit, "landmarks", "landmark"),
      ...objectCells(literal.supports, kit, "scenery", "support"),
    ];
    if (visibleStaticLayers.length !== 408) throw new Error(`${kit}: closed layer count drift`);
    return [kit, Object.freeze({
      kit,
      visibleStaticLayers: Object.freeze(visibleStaticLayers.map(Object.freeze)),
      identities: literal.identities,
    })];
  }))),
});
const AUTHORITY = Object.freeze({
  ...AUTHORITY_BODY,
  canonicalSha256: canonicalDigest(AUTHORITY_BODY),
});
const MASTER_SET_SHA256 = canonicalDigest(MASTER_PNG_SHA256);
const V3_SUPPORT_CELLS = Object.freeze({
  "worn-heartland": Object.freeze([4,8,3,2,1,6,12,5,65,70,19,23,83,87,85,89]),
  "spring-terraces": Object.freeze([0,4,16,20,64,68,7,8,1,3,69,73,70,74,71,75]),
  "dry-scrub": Object.freeze([0,4,9,11,2,6,8,5,16,20,65,69,82,86,98,102]),
  "ash-waste": Object.freeze([2,3,1,0,5,4,7,8,18,22,65,69,81,85,96,100]),
  "neutral-temperate": Object.freeze([3,0,9,11,10,12,4,6,16,20,65,69,82,86,98,102]),
});
const V3_AUTHORITY_BODY = Object.freeze({
  schema: "regional-r5-v3-atlas-only-placement-authority/v1",
  scenes: Object.freeze(Object.fromEntries(KITS.map((kit) => {
    let supportIndex = 0;
    const scene = AUTHORITY_BODY.scenes[kit];
    const visibleStaticLayers = scene.visibleStaticLayers.map((layer) => {
      if (!layer.id.includes("/support/")) return layer;
      return Object.freeze({ ...layer, cell: V3_SUPPORT_CELLS[kit][supportIndex++] });
    });
    return [kit, Object.freeze({ ...scene, visibleStaticLayers: Object.freeze(visibleStaticLayers) })];
  }))),
});
const V3_AUTHORITY = Object.freeze({
  ...V3_AUTHORITY_BODY,
  canonicalSha256: canonicalDigest(V3_AUTHORITY_BODY),
});
const V3_COMPOSITOR_IDENTITY_SHA256 = canonicalDigest({
  schema: "regional-r5-v3-atlas-only-compositor-identity/v1",
  scene: Object.freeze({ width: SCENE_WIDTH, height: SCENE_HEIGHT, channels: CHANNELS }),
  masterGeometry: MASTER_GEOMETRY,
  painter: "opaque-source-cell-over",
  clippedToSceneBounds: true,
  visibleStaticLayersPerScene: 408,
});
const V3_INTEGRATION_IDENTITY_BODY = Object.freeze({
  generation: "v3",
  v2Status: "unpublished-diagnostic-only",
  sourceSchema: "regional-r5-v3-atomic-source-masters/v1",
  placementSchema: V3_AUTHORITY.schema,
  staticSchema: "regional-r5-atlas-only-scenes/v1",
  dynamicSchema: "regional-r5-dynamic-presentation-scenes/v1",
  compositorIdentitySha256: V3_COMPOSITOR_IDENTITY_SHA256,
});
const V3_INTEGRATION_IDENTITY = Object.freeze({
  ...V3_INTEGRATION_IDENTITY_BODY,
  canonicalSha256: canonicalDigest(V3_INTEGRATION_IDENTITY_BODY),
});
const V3_AUTHORING_IDENTITY_BODY_SHA256 = "226c2a76866c4d1ab52228e7391baebf60ae2339fa5504b2f1d3e4f2df2aec6a";
const V3_AUTHORING_IDENTITY_SHA256 = "89a6d80c477c615cdb738c7a239340973f490e29a959ab3bf0d8574389518cad";
const V3_LANDMARK_PORT_RECEIPT_SHA256 = "c37c435218ba17e3023102228ef43bd6c00def9d9d2dab78946b1bc9bef18ea9";

/** Typed failure at the atlas-only input boundary. */
export class RegionalR5AtlasOnlySceneError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = "RegionalR5AtlasOnlySceneError";
    this.code = code;
    if (details) Object.assign(this, details);
  }
}

function fail(code, message, details = undefined) {
  throw new RegionalR5AtlasOnlySceneError(code, message, details);
}

function looksLikeDirectSceneSource(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return KITS.every((kit) => {
    const scene = value[kit];
    return scene && Array.isArray(scene.terrainRows)
      && Array.isArray(scene.landmarkLayers) && Array.isArray(scene.humanLayers);
  });
}

function assertClosedInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    fail("CALLER_SOURCE_FORBIDDEN", "Atlas-only caller input accepts only masterBuffers and placements.");
  }
  const keys = Reflect.ownKeys(input);
  if (keys.some((key) => typeof key !== "string")) {
    fail("CALLER_SOURCE_FORBIDDEN", "Atlas-only caller source is forbidden; only the generation-specific closed input is accepted.");
  }
  keys.sort(compareText);
  const generation = input.authoringIdentity?.schema === "regional-r5-v4-authoring-identity/v1"
    ? "v4" : Object.hasOwn(input, "authoringIdentity") ? "v3" : "v2";
  const expected = generation === "v3" || generation === "v4"
    ? ["authoringIdentity", "masterBuffers", "placements"]
    : ["masterBuffers", "placements"];
  if (canonicalJson(keys) !== canonicalJson(expected.sort(compareText))) {
    fail("CALLER_SOURCE_FORBIDDEN", "Atlas-only caller source is forbidden; only the generation-specific closed input is accepted.");
  }
  return generation;
}

function assertPlacements(placements, generation, v4Trust) {
  if (looksLikeDirectSceneSource(placements)) {
    fail(
      "DIRECT_SCENE_SOURCE_FORBIDDEN",
      "Atlas-only composition rejects every direct scene source.",
      { directSceneSourceCounts: { ...DIRECT_SCENE_SOURCE_COUNTS } },
    );
  }
  if (!placements || typeof placements !== "object" || Array.isArray(placements)
      || typeof placements.canonicalSha256 !== "string") {
    fail(generation === "v3" ? "V3_PLACEMENT_IDENTITY_MISMATCH" : "PLACEMENT_AUTHORITY_INVALID",
      "Closed placement authority requires its canonical placement hash.");
  }
  if (generation === "v3" || generation === "v4") {
    const placementAuthority = generation === "v4" ? v4Trust?.placements : V3_AUTHORITY;
    if (canonicalJson(placements) !== canonicalJson(placementAuthority)) {
      fail("V3_PLACEMENT_IDENTITY_MISMATCH", "V3 requires its exact detached placement authority.");
    }
    return generation === "v4" ? v4Trust?.masterPngSha256 : V3_MASTER_PNG_SHA256;
  }
  if (canonicalJson(placements) === canonicalJson(AUTHORITY)) return MASTER_PNG_SHA256;
  fail("PLACEMENT_AUTHORITY_INVALID", "Closed placement authority canonical hash, kit inventory, or placement content drifted.");
}

function assertV4AuthoringIdentity(authoringIdentity, trust) {
  if (canonicalJson(authoringIdentity) !== canonicalJson(trust.authoringIdentity)
      || authoringIdentity.canonicalSha256 !== canonicalDigest(Object.fromEntries(
        Object.entries(authoringIdentity).filter(([key]) => key !== "canonicalSha256"),
      ))) {
    fail("V4_AUTHORING_IDENTITY_MISMATCH",
      "V4 authoring identity does not match the registered scene-first builder output.");
  }
}

function assertV3AuthoringIdentity(authoringIdentity) {
  if (!authoringIdentity || typeof authoringIdentity !== "object" || Array.isArray(authoringIdentity)
      || authoringIdentity.schema !== "regional-r5-v3-authoring-identity/v1"
      || authoringIdentity.landmarkPortReceiptSha256 !== V3_LANDMARK_PORT_RECEIPT_SHA256
      || authoringIdentity.masterSetSha256 !== canonicalDigest(V3_MASTER_PNG_SHA256)
      || authoringIdentity.placementSha256 !== V3_AUTHORITY.canonicalSha256
      || authoringIdentity.canonicalSha256 !== V3_AUTHORING_IDENTITY_BODY_SHA256
      || canonicalDigest(authoringIdentity) !== V3_AUTHORING_IDENTITY_SHA256) {
    fail("V3_AUTHORING_IDENTITY_MISMATCH", "V3 authoring identity does not match the atomic-source builder output.");
  }
}

function assertMasterInventory(masterBuffers, expectedHashes, generation) {
  if (!masterBuffers || typeof masterBuffers !== "object" || Array.isArray(masterBuffers)) {
    fail("MASTER_INVENTORY_INVALID", "Atlas-only composition requires exactly 20 encoded master buffers.");
  }
  const names = Object.keys(masterBuffers).sort(compareText);
  const missing = MASTER_NAMES.filter((name) => !names.includes(name));
  const unexpected = names.filter((name) => !MASTER_NAMES.includes(name));
  if (names.length !== 20 || missing.length > 0 || unexpected.length > 0) {
    fail(
      "MASTER_INVENTORY_INVALID",
      `Atlas-only composition requires exactly 20 encoded masters; missing ${missing.join(", ") || "none"}; unexpected or renamed ${unexpected.join(", ") || "none"}.`,
    );
  }
  for (const name of MASTER_NAMES) {
    if (!Buffer.isBuffer(masterBuffers[name])) {
      fail("MASTER_INVENTORY_INVALID", `${name}: encoded master must be a Buffer.`);
    }
    if (sha256(masterBuffers[name]) !== expectedHashes[name]) {
      fail(generation === "v3" ? "V3_MASTER_SET_IDENTITY_MISMATCH" : "MASTER_HASH_MISMATCH",
        `${name}: encoded master hash does not match the closed authority.`);
    }
  }
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Buffer.isBuffer(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

async function decodeMasters(masterBuffers) {
  return Object.fromEntries(await Promise.all(MASTER_NAMES.map(async (atlasId) => {
    const geometry = geometryOf(atlasId);
    const { data, info } = await sharp(masterBuffers[atlasId])
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.width !== geometry.width || info.height !== geometry.height || info.channels !== CHANNELS) {
      fail("MASTER_GEOMETRY_INVALID", `${atlasId}: decoded master geometry is invalid.`);
    }
    for (let offset = 3; offset < data.length; offset += CHANNELS) {
      if (data[offset] !== 0 && data[offset] !== 255) {
        fail("MASTER_ALPHA_INVALID", `${atlasId}: decoded master alpha must be binary.`);
      }
    }
    return [atlasId, { data, width: info.width }];
  })));
}

function sourceCell(decoded, geometry, cell, atlasId) {
  if (!Number.isSafeInteger(cell) || cell < 0 || cell >= geometry.columns * geometry.rows) {
    fail("PLACEMENT_AUTHORITY_INVALID", `${atlasId}: placement cell is outside its atlas.`);
  }
  const column = cell % geometry.columns;
  const row = Math.floor(cell / geometry.columns);
  const sourceRect = {
    x: column * geometry.cellWidth,
    y: row * geometry.cellHeight,
    width: geometry.cellWidth,
    height: geometry.cellHeight,
  };
  const data = Buffer.alloc(sourceRect.width * sourceRect.height * CHANNELS);
  for (let y = 0; y < sourceRect.height; y += 1) {
    const sourceStart = ((sourceRect.y + y) * decoded.width + sourceRect.x) * CHANNELS;
    decoded.data.copy(data, y * sourceRect.width * CHANNELS, sourceStart,
      sourceStart + sourceRect.width * CHANNELS);
  }
  return {
    cell: { column, index: cell, row },
    data,
    sourceRect,
  };
}

function placeLayer(output, layer, decodedMasters, masterBuffers) {
  const geometry = geometryOf(layer.atlasId);
  const source = sourceCell(decodedMasters[layer.atlasId], geometry, layer.cell, layer.atlasId);
  let contributedOpaquePixels = 0;
  for (let y = 0; y < source.sourceRect.height; y += 1) {
    for (let x = 0; x < source.sourceRect.width; x += 1) {
      const sourceOffset = (y * source.sourceRect.width + x) * CHANNELS;
      if (source.data[sourceOffset + 3] === 0) continue;
      const destinationX = layer.destination.x + x;
      const destinationY = layer.destination.y + y;
      if (destinationX < 0 || destinationY < 0
          || destinationX >= SCENE_WIDTH || destinationY >= SCENE_HEIGHT) continue;
      contributedOpaquePixels += 1;
      source.data.copy(output, (destinationY * SCENE_WIDTH + destinationX) * CHANNELS,
        sourceOffset, sourceOffset + CHANNELS);
    }
  }
  if (contributedOpaquePixels === 0) {
    fail("MASTER_CELL_EMPTY", `${layer.atlasId} cell ${layer.cell}: placement contributes no opaque pixels.`);
  }
  return {
    id: layer.id,
    role: layer.role,
    destination: {
      x: layer.destination.x,
      y: layer.destination.y,
      width: source.sourceRect.width,
      height: source.sourceRect.height,
    },
    contributedOpaquePixels,
    provenance: {
      atlasId: layer.atlasId,
      cell: source.cell,
      masterPngSha256: sha256(masterBuffers[layer.atlasId]),
      sourceRect: source.sourceRect,
      sourceRgbaSha256: sha256(source.data),
    },
  };
}

/** Return a detached copy of the only accepted placement authority. */
export function regionalR5AtlasOnlyScenePlacementsInternal() {
  return structuredClone(AUTHORITY);
}

/** Return the immutable identity binding the V3 source, placement, and compositor schemas. */
export function regionalR5V3IntegrationIdentityInternal() {
  return structuredClone(V3_INTEGRATION_IDENTITY);
}

/** Compose five scenes without publication or access to any raster source besides masters. */
export async function buildRegionalR5AtlasOnlyScenesInternal(input, masterBuffers, placements, v4Trust = null) {
  const generation = assertClosedInput(input);
  const expectedHashes = assertPlacements(placements, generation, v4Trust);
  if (generation === "v3") assertV3AuthoringIdentity(input.authoringIdentity);
  if (generation === "v4") assertV4AuthoringIdentity(input.authoringIdentity, v4Trust);
  assertMasterInventory(masterBuffers, expectedHashes, generation);
  const decodedMasters = await decodeMasters(masterBuffers);
  const scenes = {};
  for (const kit of KITS) {
    const placement = placements.scenes[kit];
    const data = Buffer.alloc(SCENE_WIDTH * SCENE_HEIGHT * CHANNELS);
    const visibleStaticLayers = placement.visibleStaticLayers.map((layer) => (
      placeLayer(data, layer, decodedMasters, masterBuffers)
    ));
    scenes[kit] = {
      kit,
      raw: { data, width: SCENE_WIDTH, height: SCENE_HEIGHT, channels: CHANNELS },
      rgbaSha256: sha256(data),
      visibleStaticLayers,
      identities: structuredClone(placement.identities),
    };
  }
  const masterSetSha256 = generation === "v4"
    ? v4Trust.authoringIdentity.masterSetSha256
    : generation === "v3" ? canonicalDigest(V3_MASTER_PNG_SHA256) : MASTER_SET_SHA256;
  const baseResult = {
    schema: "regional-r5-atlas-only-scenes/v1",
    atlasOnly: true,
    published: false,
    generation,
    diagnosticOnly: generation === "v2",
    task6Ready: false,
    masterCount: MASTER_NAMES.length,
    masterNames: [...MASTER_NAMES],
    masterSetSha256,
    placementSha256: placements.canonicalSha256,
    scenes,
  };
  if (generation === "v2") return baseResult;
  if (generation === "v4") {
    const trust = v4Trust;
    const visibleStaticReceipts = Object.fromEntries(KITS.map((kit) => (
      [kit, scenes[kit].visibleStaticLayers]
    )));
    const staticTrustBody = {
      schema: "regional-r5-v4-static-trust/v1",
      generation: "v4",
      integrationIdentitySha256: trust.integrationIdentity.canonicalSha256,
      atomicIntakeReceiptSha256: trust.receipt.atomicIntakeReceiptSha256,
      landmarkPortReceiptSha256: trust.receipt.landmarkPortReceiptSha256,
      authoritySha256: trust.receipt.authoritySha256,
      receiptSha256: trust.receipt.canonicalSha256,
      masterSetSha256,
      placementSha256: trust.placementSha256,
      visibleLayerReceiptSha256: canonicalDigest(visibleStaticReceipts),
      sceneRgbaSha256: Object.fromEntries(KITS.map((kit) => [kit, scenes[kit].rgbaSha256])),
    };
    return {
      ...baseResult,
      integrationIdentitySha256: trust.integrationIdentity.canonicalSha256,
      compositorIdentitySha256: trust.integrationIdentity.compositorIdentitySha256,
      visibleStaticReceiptSha256: staticTrustBody.visibleLayerReceiptSha256,
      authoringIdentitySha256: canonicalDigest(input.authoringIdentity),
      trustedV4: deepFreeze({
        ...staticTrustBody,
        canonicalSha256: canonicalDigest(staticTrustBody),
      }),
    };
  }
  const visibleStaticReceipt = KITS.flatMap((kit) => scenes[kit].visibleStaticLayers
    .map((layer) => ({ kit, ...layer })));
  const authoringIdentitySha256 = canonicalDigest(input.authoringIdentity);
  const trustBody = {
    schema: "regional-r5-v3-static-trust/v1",
    masterSetSha256,
    placementSha256: placements.canonicalSha256,
    authoringIdentitySha256,
    landmarkPortReceiptSha256: V3_LANDMARK_PORT_RECEIPT_SHA256,
    integrationIdentitySha256: V3_INTEGRATION_IDENTITY.canonicalSha256,
    compositorIdentitySha256: V3_INTEGRATION_IDENTITY.compositorIdentitySha256,
    visibleStaticReceiptSha256: canonicalDigest(visibleStaticReceipt),
    sceneRgbaSha256: Object.fromEntries(KITS.map((kit) => [kit, scenes[kit].rgbaSha256])),
  };
  return {
    ...baseResult,
    integrationIdentitySha256: V3_INTEGRATION_IDENTITY.canonicalSha256,
    compositorIdentitySha256: V3_INTEGRATION_IDENTITY.compositorIdentitySha256,
    visibleStaticReceiptSha256: trustBody.visibleStaticReceiptSha256,
    authoringIdentitySha256,
    trustedV3: deepFreeze({ ...trustBody, canonicalSha256: canonicalDigest(trustBody) }),
  };
}
